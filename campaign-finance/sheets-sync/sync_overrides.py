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
  4. "Donor Merges"     alias_id | canonical_id        (NEW — same-entity dedupe)
  5. "Donor Clusters"   cluster_id | cluster_name | donor_id | relationship (NEW — related entities)

ENTITY RESOLUTION (new)
-----------------------
MERGE  (Donor Merges tab): collapse duplicate records of the SAME entity. Every
       contribution from an alias is reassigned to the canonical donor, the
       alias's industries/flags are folded into the canonical record, and the
       alias donor is removed. Applied BEFORE overrides so editor tags on the
       canonical land correctly; override rows keyed to an alias are remapped.
       (Suggestions come from probe_donor_dupes.py -> donor_merges_suggested.csv.)
CLUSTER (Donor Clusters tab): link DISTINCT-but-related entities (e.g. a person,
       their spouse, and a PAC they fund). Not merged — annotated with a shared
       cluster id and surfaced as a top-level `donor_clusters` map for the embed.

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
from pathlib import Path
from typing import Optional


SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
DEFAULT_DATA_PATH = Path(__file__).parent.parent / 'council-data.json'


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
    """Return get_all_records() for a tab, or [] if the tab is absent."""
    try:
        import gspread
        ws = sheet.worksheet(name)
    except Exception as e:  # gspread.WorksheetNotFound, or gspread not imported in tests
        if e.__class__.__name__ != 'WorksheetNotFound':
            # re-raise anything that isn't a missing-tab situation
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
    """Read the Donor Clusters tab -> {cluster_id: {name, relationship, members[]}}."""
    rows = _worksheet_records(sheet, 'Donor Clusters')
    if rows is None:
        return {}
    groups: dict[str, dict] = {}
    for row in rows:
        cid = (str(row.get('cluster_id') or '')).strip()
        did = (str(row.get('donor_id') or '')).strip()
        if not cid or not did:
            continue
        g = groups.setdefault(cid, {'name': '', 'relationship': '', 'members': []})
        nm = (str(row.get('cluster_name') or '')).strip()
        if nm:
            g['name'] = nm
        rel = (str(row.get('relationship') or '')).strip()
        if rel:
            g['relationship'] = rel
        if did not in g['members']:
            g['members'].append(did)
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
    # Only act on pairs where BOTH endpoints exist after resolution.
    valid = {a: c for a, c in mapfinal.items()
             if a in donors and c in donors and a != c}
    skipped = {a for a in mapfinal if a not in valid}
    changes['skipped'] = len(skipped)

    # 1) reassign contributions
    for c in contribs:
        did = c.get('donor_id')
        if did in valid:
            c['donor_id'] = valid[did]
            changes['contributions_reassigned'] += 1

    # 2) fold alias metadata into canonical, then delete alias
    for alias, canon in valid.items():
        if alias not in donors or canon not in donors:
            continue
        a, c = donors[alias], donors[canon]
        # union industries (canonical first)
        ci = c.get('industries') or ([c['industry']] if c.get('industry') else [])
        ai = a.get('industries') or ([a['industry']] if a.get('industry') else [])
        merged = list(dict.fromkeys([*ci, *ai]))
        if merged:
            c['industries'] = merged
        # concat flags
        if a.get('flags'):
            c.setdefault('flags', []).extend(a['flags'])
        # remember the alias name so the embed can note "also seen as…"
        c.setdefault('aka', [])
        if a.get('name') and a['name'] != c.get('name') and a['name'] not in c['aka']:
            c['aka'].append(a['name'])
        del donors[alias]
        changes['merged'] += 1

    return changes, valid


def apply_clusters(data: dict, clusters: dict, mergemap: dict) -> dict:
    """Annotate related (distinct) donors with a shared cluster id."""
    donors = data.get('donors', {})
    out = {}
    changes = {'clusters': 0, 'members': 0}
    for cid, info in clusters.items():
        members = []
        for m in info.get('members', []):
            m2 = mergemap.get(m, m)   # resolve through any merges
            if m2 in donors and m2 not in members:
                members.append(m2)
        if len(members) >= 2:
            out[cid] = {'name': info.get('name', ''),
                        'relationship': info.get('relationship', ''),
                        'members': members}
            for m in members:
                donors[m]['cluster_id'] = cid
                if info.get('name'):
                    donors[m]['cluster_name'] = info['name']
            changes['clusters'] += 1
            changes['members'] += len(members)
    data['donor_clusters'] = out
    return changes


# ============================================================
# MERGE LOGIC (existing overrides + vocab)
# ============================================================
def merge_overrides(data: dict, overrides: dict[str, dict],
                    industry_vocab: dict, flag_vocab: dict,
                    mergemap: Optional[dict] = None) -> dict:
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

    for did, override in overrides.items():
        did = mergemap.get(did, did)   # an override keyed to a merged alias lands on canonical
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
    merges = read_donor_merges(sheet)
    print(f"  {len(merges)} donor-merge pairs")
    clusters = read_donor_clusters(sheet)
    print(f"  {len(clusters)} donor clusters")

    print("Applying merges (dedupe)…")
    merge_changes, mergemap = apply_merges(data, merges)
    print(f"  {merge_changes}")

    print("Merging overrides + vocab…")
    changes = merge_overrides(data, overrides, industry_vocab, flag_vocab, mergemap)
    print(f"  {changes}")

    print("Applying clusters (relate)…")
    cluster_changes = apply_clusters(data, clusters, mergemap)
    print(f"  {cluster_changes}")

    if args.dry_run:
        print("Dry run — not writing.")
        return

    with open(data_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {data_path}")


if __name__ == '__main__':
    main()
