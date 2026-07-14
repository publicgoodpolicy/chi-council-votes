#!/usr/bin/env python3
"""
IPG Donor Overrides — Google Sheets Sync
=========================================
Reads the IPG Donor Overrides Google Sheet and merges editorial tags / flags /
entity-resolution into council-data.json. Runs nightly via GitHub Actions.

TABS THIS SCRIPT READS
----------------------
  1. "Donor Overrides"  donor_id | primary_industry | additional_industries |
                        flags | notes | last_edited_by
  2. "Industry Tags"    key | label | color
  3. "Flag Types"       key | label | severity
  4. "Donor Merges"     alias_id | canonical_id        (same-entity dedupe / exact dups)
  5. "Donor Clusters"   cluster_id | cluster_name | canonical_id | donor_id |
                        role | relationship            (ROLLUPS — parent + members)

ENTITY RESOLUTION
-----------------
MERGE  (Donor Merges tab): collapse duplicate records of the SAME entity. Every
       contribution from an alias is reassigned to the canonical donor, the
       alias's industries/flags are folded into the canonical record, and the
       alias donor is removed. Reserved for genuine same-SBE-record duplicates
       (a re-ingest, a trailing space) — the rollup builder flags these as
       "exact-dup → merge". Applied BEFORE overrides and clusters.

ROLLUP (Donor Clusters tab): group a donor's variants under one PARENT
       (canonical_id) WITHOUT deleting anything. Every member record stays in
       the data, traceable to its SBE source; the cluster adds a display layer.
       This script:
         - resolves members + the canonical through any merges, de-dupes,
         - tags each member donor with cluster_id / cluster_name / cluster_role
           / cluster_is_parent,
         - precomputes the rolled-up total (sum of every member's contributions)
           and a per-member breakdown, so the embed can show "Parent gave $X"
           with an expandable, auditable breakdown.
       Rollups are annotation + aggregation only — no record is removed.
       'role' values: parent | alt-name | affiliated-pac | subsidiary | related.

Idempotent: ingest.py recreates raw donors each run; this script re-applies the
merge/cluster maps on top every night.

USAGE
    python sync_overrides.py --sheet-id ABC123 --creds-file ./creds.json
    python sync_overrides.py --dry-run

DEPENDENCIES
    pip install gspread google-auth
"""

from __future__ import annotations
import argparse, json, os, sys
from collections import defaultdict
from pathlib import Path
from typing import Optional


SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
DEFAULT_DATA_PATH = Path(__file__).parent.parent / 'council-data.json'

# Recognized rollup roles; anything else falls back to 'related'.
VALID_ROLES = {'parent', 'alt-name', 'affiliated-pac', 'subsidiary', 'related'}

# Recognized person-link evidence classes (HALT-P1-C, ratified 2026-07-13). 'shared-committee'
# is primary. 'name-match' is deliberately NOT a class — name agreement is corroboration
# recorded inside the `evidence` cell, never the class (4 returner pairs carry name variance).
# Unlike VALID_ROLES, an unknown class does NOT fall back: the Person Links tab is authority
# for a firewalled entity (by_person, direct-only), so a typo must STOP the build loudly.
VALID_PERSON_EVIDENCE_CLASSES = {'shared-committee', 'district-lineage', 'documented'}


# ============================================================
# SHEET PARSING
# ============================================================
def open_sheet(sheet_id: str, creds_file: Optional[str] = None,
               creds_dict: Optional[dict] = None):
    """Authenticate with Google and open the sheet by ID.

    gspread/google-auth are imported lazily so the rest of this module (the pure
    merge logic) can be imported and unit-tested without the cloud deps present.
    """
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("Missing deps. Run: pip install gspread google-auth", file=sys.stderr)
        sys.exit(1)

    if creds_dict:
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    elif creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    else:
        env = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set "
                             "GOOGLE_SHEETS_CREDENTIALS env var.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)

    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


def _worksheet_records(sheet, name):
    """Return get_all_records() for a tab, or None if the tab is absent."""
    try:
        import gspread
        ws = sheet.worksheet(name)
    except Exception as e:  # gspread.WorksheetNotFound, or gspread not imported in tests
        if e.__class__.__name__ != 'WorksheetNotFound':
            try:
                import gspread as _g
                if not isinstance(e, _g.WorksheetNotFound):
                    raise
            except ImportError:
                raise
        print(f"  ! No '{name}' tab found, skipping.")
        return None
    return ws.get_all_records()


def parse_flag_cell(cell: str) -> list[dict]:
    if not cell or not cell.strip():
        return []
    out = []
    for raw in cell.split(';'):
        raw = raw.strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split('|')]
        flag = {'type': parts[0], 'source': 'override'}
        if len(parts) > 1 and parts[1]:
            flag['source_url'] = parts[1]
        if len(parts) > 2 and parts[2]:
            flag['note'] = parts[2]
        out.append(flag)
    return out


def parse_list_cell(cell: str) -> list[str]:
    if not cell:
        return []
    return [s.strip() for s in cell.split(',') if s.strip()]


def read_donor_overrides(sheet) -> dict[str, dict]:
    rows = _worksheet_records(sheet, 'Donor Overrides')
    if rows is None:
        return {}
    out = {}
    for row in rows:
        did = (row.get('donor_id') or '').strip()
        if not did:
            continue
        override = {}
        if row.get('primary_industry'):
            override['primary_industry'] = row['primary_industry'].strip()
        addl = parse_list_cell(row.get('additional_industries', ''))
        if addl:
            override['additional_industries'] = addl
        flags = parse_flag_cell(row.get('flags', ''))
        if flags:
            override['flags'] = flags
        if row.get('notes'):
            override['notes'] = row['notes'].strip()
        if row.get('last_edited_by'):
            override['last_edited_by'] = row['last_edited_by'].strip()
        # entity_type — WHAT the donor is (orthogonal to industry). Read by NAME, so
        # tolerated-absent on a 6-column tab; only carried when the cell is non-empty.
        if row.get('entity_type'):
            override['entity_type'] = str(row['entity_type']).strip()
        out[did] = override
    return out


def read_vocab(sheet, tab_name: str, key_field: str) -> dict[str, dict]:
    rows = _worksheet_records(sheet, tab_name)
    if rows is None:
        return {}
    out = {}
    for row in rows:
        key = (row.get(key_field) or '').strip()
        if not key:
            continue
        entry = {k: v for k, v in row.items() if k != key_field and v != ''}
        out[key] = entry
    return out


def read_committee_tags(sheet) -> dict:
    """Read the 'Committee Tags' tab -> {committee_id: [industry_tag, ...]}.
    Columns: committee_id | committee_name | industry_tags (comma-separated).
    committee_name is for the editor's reference only; matching is by id."""
    rows = _worksheet_records(sheet, 'Committee Tags')
    if rows is None:
        return {}
    out = {}
    for row in rows:
        cid = (row.get('committee_id') or '').strip()
        if not cid:
            continue
        out[cid] = parse_list_cell(row.get('industry_tags', ''))
    return out


def apply_committee_tags(data: dict, ctags: dict, industry_vocab: dict) -> dict:
    """Set each committee's industry_tags from the Committee Tags tab, validating
    every tag against the known vocabulary (the Industry Tags tab plus whatever is
    already in the data). Unknown tags are skipped and reported, so a typo can't
    silently spawn a junk industry that fragments the By-industry lens."""
    known = set(industry_vocab or {}) | set(data.get('industry_tags', {}))
    comms = data.get('committees', {})
    stats = {'committees_tagged': 0, 'tags_applied': 0,
             'unknown_tags': [], 'missing_committees': []}
    for cid, tags in ctags.items():
        if cid not in comms:
            stats['missing_committees'].append(cid)
            continue
        valid = []
        for t in tags:
            if known and t not in known:
                stats['unknown_tags'].append(f'{cid}:{t}')
            else:
                valid.append(t)
        comms[cid]['industry_tags'] = valid
        if valid:
            stats['committees_tagged'] += 1
            stats['tags_applied'] += len(valid)
    return stats


def read_donor_merges(sheet) -> list[tuple]:
    """Read the Donor Merges tab -> list of (alias_id, canonical_id) pairs.

    Presence of a row = apply the merge (editors curate the tab; rejected
    suggestions simply aren't in it). An optional 'KEEP? (y/n)' column, if
    present, must be affirmative.
    """
    rows = _worksheet_records(sheet, 'Donor Merges')
    if rows is None:
        return []
    pairs = []
    for row in rows:
        a = (str(row.get('alias_id') or '')).strip()
        c = (str(row.get('canonical_id') or '')).strip()
        keep_col = row.get('KEEP? (y/n)', row.get('keep', None))
        if keep_col is not None and str(keep_col).strip() != '':
            if str(keep_col).strip().lower() not in ('y', 'yes', '1', 'true'):
                continue
        if a and c and a != c:
            pairs.append((a, c))
    return pairs


def read_donor_clusters(sheet) -> dict[str, dict]:
    """Read the Donor Clusters (rollup) tab.

    Returns {cluster_id: {name, relationship, canonical_id, members[], roles{}}}.

    Columns: cluster_id | cluster_name | canonical_id | donor_id | role | relationship
    Backward compatible with the old (canonical_id/role-less) shape:
      - if 'canonical_id' is absent, the member whose role == 'parent' is used;
        failing that, apply_clusters falls back to the first surviving member.
      - if 'role' is absent, members default to 'related'.
    """
    rows = _worksheet_records(sheet, 'Donor Clusters')
    if rows is None:
        return {}
    groups: dict[str, dict] = {}
    for row in rows:
        cid = (str(row.get('cluster_id') or '')).strip()
        did = (str(row.get('donor_id') or '')).strip()
        if not cid or not did:
            continue
        g = groups.setdefault(cid, {'name': '', 'relationship': '',
                                    'canonical_id': '', 'members': [], 'roles': {}})
        nm = (str(row.get('cluster_name') or '')).strip()
        if nm:
            g['name'] = nm
        rel = (str(row.get('relationship') or '')).strip()
        if rel:
            g['relationship'] = rel
        can = (str(row.get('canonical_id') or '')).strip()
        if can:
            if g['canonical_id'] and g['canonical_id'] != can:
                print(f"  !! cluster_id '{cid}' has conflicting canonical_id rows: "
                      f"'{g['canonical_id']}' vs '{can}' — duplicate cluster_id in the "
                      f"sheet? (last one wins; fix the sheet)", file=sys.stderr)
            g['canonical_id'] = can
        role = (str(row.get('role') or '')).strip().lower()
        if did not in g['members']:
            g['members'].append(did)
        if role:
            if role not in VALID_ROLES:
                role = 'related'
            g['roles'][did] = role
            # a 'parent' row nominates the canonical when the column is missing
            if role == 'parent' and not g['canonical_id']:
                g['canonical_id'] = did
    return groups


def _candidacy_election_index(data):
    """{candidate_id: election_id}, resolved candidate.race_id -> race.election_id.
    The substrate for the person-link role trip-wire."""
    race_elec = {r['id']: r.get('election_id') for r in data.get('races', [])}
    return {c['id']: race_elec.get(c.get('race_id')) for c in data.get('candidates', [])}


def read_person_links(sheet, data):
    """Read the Person Links tab (HALT-P1-C). Membership model: ONE row per
    (person, candidacy). Columns:
      person_id | candidacy_id | role | evidence_class | evidence | approved_by | approved_date | notes

    Returns {person_id: {'candidacies': [ {candidacy_id, election_id, evidence_class,
             evidence, approved_by, approved_date, notes}, ... ]}}.

    Modeled on read_donor_clusters, with THREE loud trip-wires — SystemExit, never a
    warning: the Person Links tab is authority for by_person (a firewalled, direct-only
    entity), so a bad row must stop the build, not silently degrade it.
      1. candidacy_id must resolve to a candidate record;
      2. role must EQUAL that candidacy's election id VERBATIM (ratified: role is the
         election id, machine-asserted here so nothing goes stale at cycle turnover);
      3. evidence_class must be in VALID_PERSON_EVIDENCE_CLASSES.
    Absent tab is tolerated (returns {}), consistent with _worksheet_records.
    """
    rows = _worksheet_records(sheet, 'Person Links')
    if rows is None:
        return {}
    elec_of = _candidacy_election_index(data)
    groups: dict[str, dict] = {}
    for i, row in enumerate(rows, start=2):  # sheet row 1 is the header
        pid = (str(row.get('person_id') or '')).strip()
        cand = (str(row.get('candidacy_id') or '')).strip()
        if not pid and not cand:
            continue  # fully blank spacer row
        if not pid or not cand:
            raise SystemExit(f"[person-links] row {i}: person_id and candidacy_id are both "
                             f"required (got person_id={pid!r} candidacy_id={cand!r})")
        role = (str(row.get('role') or '')).strip()
        ecl = (str(row.get('evidence_class') or '')).strip()
        if cand not in elec_of:
            raise SystemExit(f"[person-links] row {i}: candidacy_id {cand!r} resolves to no "
                             f"candidate record")
        actual = elec_of[cand]
        if role != actual:
            raise SystemExit(f"[person-links] row {i}: role {role!r} != candidacy {cand!r}'s "
                             f"election id {actual!r} (role must be the election id verbatim)")
        if ecl not in VALID_PERSON_EVIDENCE_CLASSES:
            raise SystemExit(f"[person-links] row {i}: evidence_class {ecl!r} not in "
                             f"{sorted(VALID_PERSON_EVIDENCE_CLASSES)}")
        g = groups.setdefault(pid, {'candidacies': []})
        if any(m['candidacy_id'] == cand for m in g['candidacies']):
            raise SystemExit(f"[person-links] row {i}: duplicate candidacy_id {cand!r} for "
                             f"person {pid!r}")
        g['candidacies'].append({
            'candidacy_id': cand, 'election_id': role, 'evidence_class': ecl,
            'evidence': (str(row.get('evidence') or '')).strip(),
            'approved_by': (str(row.get('approved_by') or '')).strip(),
            'approved_date': (str(row.get('approved_date') or '')).strip(),
            'notes': (str(row.get('notes') or '')).strip(),
        })
    return groups


# ============================================================
# ENTITY RESOLUTION
# ============================================================
def resolve_merge_map(pairs: list[tuple]) -> dict:
    """Collapse alias->canonical pairs, following chains, breaking cycles."""
    direct = {}
    for a, c in pairs:
        if a and c and a != c:
            direct[a] = c

    def final(x):
        seen = set()
        while x in direct and x not in seen:
            seen.add(x)
            x = direct[x]
        return x

    return {a: final(a) for a in direct}


def apply_merges(data: dict, pairs: list[tuple]) -> dict:
    """Reassign contributions to canonical, fold metadata, drop alias donors."""
    donors = data.get('donors', {})
    contribs = data.get('contributions', [])
    changes = {'merged': 0, 'contributions_reassigned': 0, 'skipped': 0}

    mapfinal = resolve_merge_map(pairs)
    valid = {a: c for a, c in mapfinal.items()
             if a in donors and c in donors and a != c}
    skipped = {a for a in mapfinal if a not in valid}
    changes['skipped'] = len(skipped)

    for c in contribs:
        did = c.get('donor_id')
        if did in valid:
            c['donor_id'] = valid[did]
            changes['contributions_reassigned'] += 1

    for alias, canon in valid.items():
        if alias not in donors or canon not in donors:
            continue
        a, c = donors[alias], donors[canon]
        ci = c.get('industries') or ([c['industry']] if c.get('industry') else [])
        ai = a.get('industries') or ([a['industry']] if a.get('industry') else [])
        merged = list(dict.fromkeys([*ci, *ai]))
        if merged:
            c['industries'] = merged
        if a.get('flags'):
            c.setdefault('flags', []).extend(a['flags'])
        c.setdefault('aka', [])
        if a.get('name') and a['name'] != c.get('name') and a['name'] not in c['aka']:
            c['aka'].append(a['name'])
        del donors[alias]
        changes['merged'] += 1

    return changes, valid


def _contribution_totals(contribs: list) -> dict:
    """Sum contribution amounts by (post-merge) donor_id."""
    totals = defaultdict(float)
    for c in contribs:
        if c.get('contribution_type') == 'IE Committee Dues Transfer':
            continue  # internal union-dues transfer, not Council spend
        totals[c.get('donor_id')] += c.get('amount', 0) or 0
    return totals


def apply_clusters(data: dict, clusters: dict, mergemap: dict) -> dict:
    """Build ROLLUPS: parent + members, with per-member roles and a precomputed
    rolled-up total. Records are kept (not merged); this only annotates.

    Output written to data['donor_clusters'][cluster_id] =
        {name, relationship, canonical_id,
         members:[ordered ids, parent first],
         roles:{id: role},
         member_totals:{id: dollars},
         total: dollars}                      # sum across all members
    and each member donor is tagged with cluster_id / cluster_name /
    cluster_role / cluster_is_parent for quick lookup in the embed.
    """
    donors = data.get('donors', {})

    # RESET stale cluster state before re-applying from the sheet.
    # apply_clusters only SETS tags on donors that appear in the Clusters tab; it
    # never cleared them. So a donor removed from the sheet kept its old cluster_id
    # / parent_id baked into the committed base file, and the derived-layer step
    # ([1]/[1b]) re-consumed those stale tags every build — which is how a cleaned
    # sheet still produced the corrupt rollup-130. Wiping first makes "remove from
    # the sheet" actually un-cluster a donor, and the re-tag loop below restores
    # tags only for donors the sheet still places. Idempotent.
    reset = 0
    for did, dv in donors.items():
        if any(k in dv for k in ('cluster_id', 'cluster_name', 'cluster_role',
                                 'cluster_is_parent')) or dv.get('parent_id') != did:
            reset += 1
        dv.pop('cluster_id', None)
        dv.pop('cluster_name', None)
        dv.pop('cluster_role', None)
        dv.pop('cluster_is_parent', None)
        dv['parent_id'] = did      # singleton until a cluster claims it below

    totals = _contribution_totals(data.get('contributions', []))
    out = {}
    changes = {'clusters': 0, 'members': 0, 'rolled_up_dollars': 0.0,
               'missing_members': 0, 'stale_tags_reset': reset}

    for cid, info in clusters.items():
        # resolve members through any merges, drop unknowns, de-dupe (keep order)
        members, seen = [], set()
        for m in info.get('members', []):
            m2 = mergemap.get(m, m)
            if m2 not in donors:
                changes['missing_members'] += 1
                continue
            if m2 not in seen:
                seen.add(m2)
                members.append(m2)
        if len(members) < 2:
            continue

        # resolve the nominated parent; fall back to first surviving member
        canon = mergemap.get(info.get('canonical_id', ''), info.get('canonical_id', ''))
        if canon not in seen:
            canon = members[0]

        # order members with the parent first
        ordered = [canon] + [m for m in members if m != canon]

        roles_in = info.get('roles', {})
        roles, member_totals, cluster_total = {}, {}, 0.0
        for m in ordered:
            role = 'parent' if m == canon else (roles_in.get(m) or 'related')
            if role not in VALID_ROLES:
                role = 'related'
            roles[m] = role
            t = float(totals.get(m, 0.0))
            member_totals[m] = t
            cluster_total += t
            # annotate the donor record
            donors[m]['cluster_id'] = cid
            donors[m]['parent_id'] = canon
            if info.get('name'):
                donors[m]['cluster_name'] = info['name']
            donors[m]['cluster_role'] = role
            donors[m]['cluster_is_parent'] = (m == canon)

        out[cid] = {
            'name': info.get('name', ''),
            'relationship': info.get('relationship', '') or 'affiliated entities',
            'canonical_id': canon,
            'members': ordered,
            'roles': roles,
            'member_totals': member_totals,
            'total': round(cluster_total, 2),
        }
        changes['clusters'] += 1
        changes['members'] += len(ordered)
        changes['rolled_up_dollars'] = round(changes['rolled_up_dollars'] + cluster_total, 2)

    data['donor_clusters'] = out
    return changes


# ============================================================
# MERGE LOGIC (existing overrides + vocab)
# ============================================================
def merge_overrides(data: dict, overrides: dict[str, dict],
                    industry_vocab: dict, flag_vocab: dict,
                    mergemap: Optional[dict] = None,
                    entity_vocab: Optional[dict] = None) -> dict:
    mergemap = mergemap or {}
    changes = {'donors_updated': 0, 'donors_skipped': 0, 'vocab_updated': 0}

    if industry_vocab:
        for k, v in industry_vocab.items():
            data.setdefault('industry_tags', {})[k] = {**data.get('industry_tags', {}).get(k, {}), **v}
            changes['vocab_updated'] += 1
    if flag_vocab:
        for k, v in flag_vocab.items():
            data.setdefault('flag_types', {})[k] = {**data.get('flag_types', {}).get(k, {}), **v}
            changes['vocab_updated'] += 1
    # entity_type vocab — operator-added types from the 'Entity Types' tab. The
    # code-constant starter set is NOT baked here (it lives in compose/serve and is
    # unioned at serve time); only the tab's growth tail lands in the data.
    if entity_vocab:
        for k, v in entity_vocab.items():
            data.setdefault('entity_types', {})[k] = {**data.get('entity_types', {}).get(k, {}), **v}
            changes['vocab_updated'] += 1

    for did, override in overrides.items():
        did = mergemap.get(did, did)
        if did not in data.get('donors', {}):
            print(f"  ! Override for unknown donor '{did}' — skipping.")
            changes['donors_skipped'] += 1
            continue
        donor = data['donors'][did]

        existing = donor.get('industries', [donor.get('industry', 'unclassified')])
        primary = override.get('primary_industry') or existing[0]
        merged_inds = [primary]
        for ind in override.get('additional_industries', []):
            if ind and ind not in merged_inds:
                merged_inds.append(ind)
        donor['industries'] = merged_inds

        if 'flags' in override:
            donor['flags'] = override['flags']
        if 'notes' in override:
            donor['notes'] = override['notes']
        if 'entity_type' in override:
            # DISTINCT key from ingest's `type` (build_rollups keys off type=='Aggregate');
            # entity_type is editorial-only and never read by the rollup/render path yet.
            donor['entity_type'] = override['entity_type']
        if 'last_edited_by' in override:
            donor['_last_edited_by'] = override['last_edited_by']
        changes['donors_updated'] += 1

    return changes


# ============================================================
# MAIN
# ============================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet-id', required=False, default=os.environ.get('SHEET_ID'))
    ap.add_argument('--creds-file', help='Path to service account JSON key')
    ap.add_argument('--data-file', default=str(DEFAULT_DATA_PATH))
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    if not args.sheet_id:
        raise SystemExit("Missing --sheet-id (or SHEET_ID env var)")
    data_path = Path(args.data_file)
    if not data_path.exists():
        raise SystemExit(f"Data file not found: {data_path}")

    print(f"Loading data from {data_path}…")
    with open(data_path) as f:
        data = json.load(f)
    print(f"  {len(data.get('donors', {}))} donors, {len(data.get('committees', {}))} committees")

    print(f"Opening sheet {args.sheet_id}…")
    sheet = open_sheet(args.sheet_id, creds_file=args.creds_file)

    overrides = read_donor_overrides(sheet)
    print(f"  {len(overrides)} override entries")
    industry_vocab = read_vocab(sheet, 'Industry Tags', 'key')
    flag_vocab = read_vocab(sheet, 'Flag Types', 'key')
    entity_vocab = read_vocab(sheet, 'Entity Types', 'key')   # absent tab -> {} (tolerated)
    print(f"  {len(entity_vocab)} operator-added entity types")
    merges = read_donor_merges(sheet)
    print(f"  {len(merges)} donor-merge pairs")
    clusters = read_donor_clusters(sheet)
    print(f"  {len(clusters)} donor clusters (rollups)")

    print("Applying merges (dedupe)…")
    merge_changes, mergemap = apply_merges(data, merges)
    print(f"  {merge_changes}")

    print("Merging overrides + vocab…")
    changes = merge_overrides(data, overrides, industry_vocab, flag_vocab, mergemap,
                              entity_vocab=entity_vocab)
    print(f"  {changes}")

    print("Tagging committees (industry)…")
    committee_tags = read_committee_tags(sheet)
    ctag_changes = apply_committee_tags(data, committee_tags, industry_vocab)
    print(f"  {ctag_changes}")

    print("Applying rollups (clusters)…")
    cluster_changes = apply_clusters(data, clusters, mergemap)
    print(f"  {cluster_changes}")

    # Person links (HALT-P1-C) — elections-only: guarded on candidates so the SAME Sheet
    # served to the council build (no candidates/races) never trips the candidacy trip-wires.
    if data.get('candidates'):
        person_links = read_person_links(sheet, data)
        n_rows = sum(len(g['candidacies']) for g in person_links.values())
        print(f"  {len(person_links)} persons / {n_rows} person-link rows")
        data['person_links'] = person_links

    if args.dry_run:
        print("Dry run — not writing.")
        return

    with open(data_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {data_path}")


if __name__ == '__main__':
    main()
