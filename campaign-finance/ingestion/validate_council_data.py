#!/usr/bin/env python3
"""validate_council_data.py — integrity gate for council-data.json.

Run inside build_all.sh AFTER the file is written but BEFORE git commit. Exits
non-zero on any ERROR so the build aborts and nothing bad reaches the repo. The
existing gate already checks "valid JSON" + "no conflict markers"; this adds the
*semantic* checks that would have caught the rollup-130 corruption (a sheet
duplicate-id collision) and prints a summary so silent issues (e.g. industry
tags that never synced) are visible at a glance.

  usage:  python3 validate_council_data.py path/to/council-data.json
          python3 validate_council_data.py path/to/council-data.json --strict
          (add --strict to also fail on WARNINGS)

ERRORS (always abort the build):
  - cluster canonical_id not among its members            (rollup-130 signature)
  - cluster has != 1 'parent' role
  - cluster 'roles' references an id that isn't a member  (rollup-130 signature)
  - cluster has < 2 members
  - a member id doesn't exist in donors
  - a donor belongs to more than one cluster
WARNINGS (printed; abort only with --strict):
  - cluster.total doesn't equal sum(member_totals) within $1
  - an independent-expenditure committee has a blank committee_name
"""
import json, sys, argparse, re
from collections import defaultdict


def validate(d):
    errors, warnings = [], []
    donors = d.get('donors', {})
    clusters = d.get('donor_clusters', {})
    comms = d.get('committees', {})

    seen_member = {}  # donor_id -> first cluster_id that claimed it
    for cid, cl in clusters.items():
        members = cl.get('members', []) or []
        roles = cl.get('roles', {}) or {}
        canon = cl.get('canonical_id')
        mset = set(members)

        if len(members) < 2:
            errors.append(f"{cid}: only {len(members)} member(s); a cluster needs >=2")
        if canon not in mset:
            errors.append(f"{cid}: canonical_id '{canon}' is not in members {members}")
        parents = [m for m, r in roles.items() if r == 'parent']
        if len(parents) != 1:
            errors.append(f"{cid}: has {len(parents)} 'parent' roles (need exactly 1): {parents}")
        stray = [m for m in roles if m not in mset]
        if stray:
            errors.append(f"{cid}: roles reference non-members {stray} "
                          f"(duplicate cluster_id collision in the sheet?)")
        for m in members:
            if m not in donors:
                errors.append(f"{cid}: member '{m}' does not exist in donors")
            if m in seen_member:
                errors.append(f"{cid}: member '{m}' is already in cluster "
                              f"'{seen_member[m]}' (a donor may belong to only one)")
            else:
                seen_member[m] = cid

        # arithmetic drift between the stored total and the per-member breakdown
        mt = cl.get('member_totals')
        if mt is not None and 'total' in cl:
            s = round(sum(mt.values()), 2)
            if abs(s - round(cl['total'], 2)) > 1.0:
                warnings.append(f"{cid}: total {cl['total']} != sum(member_totals) {s}")

    for k, c in comms.items():
        if c.get('type') == 'independent_expenditure' and not (c.get('committee_name') or '').strip():
            warnings.append(f"committee {k}: independent_expenditure with blank committee_name "
                            f"(would render as a nameless recipient)")

    cotag = [k for k, r in donors.items()
             if r.get('industries') and 'unclassified' in r['industries']
             and any(t != 'unclassified' for t in r['industries'])]
    if cotag:
        errors.append(f"co-tag violation: 'unclassified' alongside substantive tags: {cotag}")

    errors.extend(validate_person_links(d))
    errors.extend(validate_election_ids(d))
    errors.extend(validate_committee_linkage(d))
    errors.extend(validate_aggregate_absence(d))
    errors.extend(validate_donor_referential(d))
    return errors, warnings


# The four-predicate DETECTION SURFACE of PS-96's un-keyed class — the single source for
# both the check below and `--emit-predicates`, which the elections gate compares against
# its own copy ([AGG/PS-96-PARITY], REPAIR-AGG-1 rider F5). The list is NOT the class
# definition (PS-96 defines the class as un-keyed money); it is how un-keyed rows are
# recognised in today's bytes, and it is expected to change as the substrate does. Two
# failure names, because the causes differ and demand different responses: predicates 1-3
# fire only on a data-source change (the class woke); the small-dollar tag fires on a Sheet
# edit that makes ITEMIZED money render as aggregate (a false display claim).
AGG_PREDICATES = [
    {'name': 'AGG/PS-96', 'kind': 'row', 'field': 'is_aggregate', 'test': 'truthy', 'value': None,
     'message': "[AGG/PS-96] {n} contribution row(s) carry is_aggregate "
                "(first: {first}) — the un-keyed class woke; read RULINGS.md §PS-96"},
    {'name': 'AGG/PS-96', 'kind': 'row', 'field': 'contribution_type', 'test': 'equals', 'value': 'Aggregate',
     'message': "[AGG/PS-96] {n} contribution row(s) carry contribution_type "
                "'Aggregate' (first: {first}) — read RULINGS.md §PS-96"},
    {'name': 'AGG/PS-96', 'kind': 'donor', 'field': 'type', 'test': 'equals', 'value': 'Aggregate',
     'message': "[AGG/PS-96] {n} donor(s) typed 'Aggregate' "
                "(first: {first}) — read RULINGS.md §PS-96"},
    {'name': 'AGG/PS-96-TAG', 'kind': 'donor', 'field': 'industries', 'test': 'contains', 'value': 'small-dollar',
     'message': "[AGG/PS-96-TAG] {n} donor(s) carry the 'small-dollar' industry "
                "tag (first: {first}) — an editorial tag makes ITEMIZED money render "
                "as an aggregate line; not the class waking. Read RULINGS.md §PS-96"},
]

# The wire form the parity check compares — message text deliberately excluded, since
# wording is per-language and only the PREDICATES must agree.
AGG_PREDICATE_KEYS = ('name', 'kind', 'field', 'test', 'value')


def _agg_test(p, obj):
    v = obj.get(p['field'])
    if p['test'] == 'truthy':
        return bool(v)
    if p['test'] == 'equals':
        return v == p['value']
    if p['test'] == 'contains':
        return p['value'] in (v or [])
    raise ValueError(f"unknown predicate test {p['test']!r}")


def validate_aggregate_absence(d):
    """[AGG/PS-96] LEDGER-0 — the un-keyed-money class is asserted ABSENT, class-level.
    Artifact-agnostic: runs at the terminal step of BOTH canonical chains (council and
    elections feed the same validator), so either artifact waking fails its build. The
    predicate list is the DETECTION SURFACE, not the class definition (PS-96), and the
    causes carry distinct names: predicates 1-3 ([AGG/PS-96]) fire only on a data-source
    change reintroducing un-keyed rows/donors; the small-dollar tag ([AGG/PS-96-TAG])
    fires on a Sheet edit that makes ITEMIZED money render as aggregate — a false
    display claim, not the class waking. Read RULINGS.md §PS-96 before touching this."""
    errors = []
    rows = d.get('contributions', [])
    donors = d.get('donors', {})
    for p in AGG_PREDICATES:
        if p['kind'] == 'row':
            hits = [c.get('id') for c in rows if _agg_test(p, c)]
        else:
            hits = [k for k, v in donors.items() if _agg_test(p, v)]
        if hits:
            errors.append(p['message'].format(n=len(hits), first=hits[:3]))
    return errors


def validate_donor_referential(d):
    """[AGG/PS-96-DEFECT] LEDGER-0 / D15(b) — PS-96's carve boundary: a donor key that
    SHOULD have resolved and did not is NOT un-keyed money. The donor-grain consumers
    skip such a row with the same silent continue as the aggregate skip, so this is the
    one loud path. Distinct name from [AGG/PS-96] so a failure distinguishes 'the class
    woke' from 'a key failed to resolve'."""
    donors = d.get('donors', {})
    bad = [c.get('id') for c in d.get('contributions', [])
           if not c.get('donor_id') or c.get('donor_id') not in donors]
    if bad:
        return [f"[AGG/PS-96-DEFECT] {len(bad)} contribution row(s) whose donor_id fails to "
                f"resolve in donors (first: {bad[:3]}) — key-missing-by-defect is OUTSIDE the "
                f"un-keyed class and must fail loudly (RULINGS.md §PS-96)"]
    return []


def validate_person_links(d):
    """HALT-P1-C — the person-entity firewall, as four STRUCTURAL invariants (relations that
    hold at any data vintage, never pinned dollars — so the Q2 re-ingest can't false-trip them).
    Election-only: returns [] when by_person is absent (council data has none)."""
    errs = []
    roll = d.get('rollups') or {}
    bp = roll.get('by_person')
    if not bp:
        return errs
    bc = roll.get('by_candidate') or {}
    cands = {c['id']: c for c in d.get('candidates', [])}

    def elec_of(cid):
        # SCOPE-PIPE: one-hop read of the stamped field (HALT-F5-SEED). Not circular
        # per PS-82: no INV-ELECT check consumes this — election_mismatches derives its
        # own resolution from races — and INV-ELECT-1 pins stamp==race in this same run.
        c = cands.get(cid)
        return c.get('election_id') if c else None

    def rkeys(o):
        s = set()
        if isinstance(o, dict):
            for k, v in o.items():
                s.add(k); s |= rkeys(v)
        elif isinstance(o, list):
            for v in o:
                s |= rkeys(v)
        return s

    # INV-PERSON-2: the firewall — NO 'independent' (nor IE streams) anywhere, recursively.
    leaked = {'independent', 'ie_support', 'ie_oppose'} & rkeys(bp)
    if leaked:
        errs.append(f"INV-PERSON-2: firewalled key(s) present in by_person: {sorted(leaked)}")

    prior_members = set()
    for pid, p in bp.items():
        membs = p.get('members') or []
        # INV-PERSON-3: membership referential integrity.
        if not membs:
            errs.append(f"INV-PERSON-3: person '{pid}' has no members")
        if not (p.get('display_name') or '').strip():
            errs.append(f"INV-PERSON-3: person '{pid}' has empty display_name")
        for m in membs:
            cid = m.get('candidacy_id')
            if cid not in cands:
                errs.append(f"INV-PERSON-3: person '{pid}' member '{cid}' is not a candidate record")
            elif m.get('election_id') != elec_of(cid):
                errs.append(f"INV-PERSON-3: person '{pid}' member '{cid}' election_id "
                            f"{m.get('election_id')!r} != actual {elec_of(cid)!r}")
        # INV-PERSON-1: dedup identity — total is the deduped committee sum, never per-candidacy.
        owned = [m['candidacy_id'] for m in membs if m.get('owns_committee')]
        sig = round(sum((bc.get(c, {}).get('all', {}) or {}).get('direct', 0.0) for c in owned), 2)
        tot = round((p.get('direct', {}) or {}).get('total', 0.0), 2)
        if abs(sig - tot) > 0.01:
            errs.append(f"INV-PERSON-1: person '{pid}' direct.total {tot} != Σ by_candidate owned "
                        f"direct {sig} (double-count / dedup break)")
        if len(membs) >= 2 and tot > 0:
            # Money-aware prior_members (HALT-Q2R: D1 unchanged, implementation corrected).
            # Couple on_current_record ONLY when the PRIOR election window itself carries money.
            # A returner whose prior candidacy has no itemized money (committee_no_itemized — e.g.
            # a shared committee that only filed in the current cycle) is legitimately NOT
            # on_current_record and must be exempt. by_election is keyed by 4-digit year.
            earliest_m = sorted(membs, key=lambda m: m.get('election_id') or '')[0]
            prior_year = (earliest_m.get('election_id') or '').split('-')[0]
            byel = (p.get('direct', {}) or {}).get('by_election', {})
            if byel.get(prior_year, 0) > 0:
                prior_members.add(earliest_m['candidacy_id'])

    # INV-PERSON-4: the facet<->link biconditional (the documentary cohort coupling, enforced).
    facet = {c['id'] for c in d.get('candidates', []) if c.get('finance_facet') == 'on_current_record'}
    only_facet = facet - prior_members
    only_link = prior_members - facet
    if only_facet:
        errs.append(f"INV-PERSON-4: on_current_record candidacies with no money-carrying person "
                    f"link on the prior side: {sorted(only_facet)}")
    if only_link:
        errs.append(f"INV-PERSON-4: person-link prior members not flagged on_current_record: "
                    f"{sorted(only_link)}")
    return errs


# --- HALT-F5-SEED (PS-81): election-identity mismatch checks — ONE implementation ----
# Imported by build_election_seed.py (mint-time, fatal, nothing written on failure) AND
# run below as the durable INV-ELECT chain gate. One function, one source of truth
# (PS-81/F-b: two copies that agree today are the P4-shaped drift defect). Coverage,
# stated per PS-81: catches cross-namespace and 2024-cohort misfilings; does NOT catch
# same-election wrong-district errors (a separate class, banked with the ruling).

def _election_of_race_id_namespace(rid):
    """Race-id namespace convention -> election_id, or None (no claim)."""
    if not rid:
        return None
    if rid.startswith('sb-2024-'):
        return '2024-school-board'
    if rid.startswith('sb-'):
        return '2026-school-board'
    if rid.startswith('ward-') or rid in ('mayor', 'city-clerk', 'city-treasurer'):
        return '2027-municipal'
    return None


def _election_of_candidate_id_convention(cid):
    """Candidate-id naming convention -> election_id, or None. CONSERVATIVE: asserts only
    where a pattern definitively fires — a false positive here breaks a build over a
    naming convention (PS-81/F-d), so unknown shapes make no claim."""
    if not cid:
        return None
    if 'sb-2024-' in cid:
        return '2024-school-board'
    if re.match(r'inc-ward-\d+$', cid):
        return '2027-municipal'
    if re.match(r'inc-sb-d\d+$', cid):
        return '2026-school-board'
    if re.search(r'(^|-)sb-(d\d+|president)$', cid):
        return '2026-school-board'
    if re.search(r'-ward-\d+$', cid):
        return '2027-municipal'
    return None


def election_mismatches(candidates, races_by_id):
    """PS-81 shared checks. Returns (errors, stats); stats carries INV-ELECT-4's
    claim/no-claim split so the check's real reach is a stated number, not an
    assumption (PS-81/F-d)."""
    errs = []
    stats = {'checked': 0, 'inv4_claimed': 0, 'inv4_no_claim': 0}
    for c in candidates:
        cid, rid = c.get('id'), c.get('race_id')
        stats['checked'] += 1
        race = races_by_id.get(rid)
        if race is None:
            errs.append(f"INV-ELECT-1: candidate '{cid}' race_id {rid!r} resolves to no race")
            continue
        resolved = race.get('election_id')
        stamped = c.get('election_id')
        if stamped is not None and stamped != resolved:
            errs.append(f"INV-ELECT-1: candidate '{cid}' stamped election_id {stamped!r} "
                        f"!= race {rid!r}'s {resolved!r}")
        ns = _election_of_race_id_namespace(rid)
        if ns is not None and ns != resolved:
            errs.append(f"INV-ELECT-2: candidate '{cid}' race_id {rid!r} namespace says "
                        f"{ns!r} but the race resolves to {resolved!r}")
        if (c.get('result') is not None or c.get('finance_facet') is not None) \
                and resolved != '2024-school-board':
            errs.append(f"INV-ELECT-3: candidate '{cid}' carries 2024-signature keys "
                        f"(result/finance_facet) but resolves to {resolved!r}")
        conv = _election_of_candidate_id_convention(cid)
        if conv is None:
            stats['inv4_no_claim'] += 1
        else:
            stats['inv4_claimed'] += 1
            if conv != resolved:
                errs.append(f"INV-ELECT-4: candidate id '{cid}' convention says {conv!r} "
                            f"but race {rid!r} resolves to {resolved!r}")
    return errs, stats


def validate_election_ids(d):
    """Durable INV-ELECT gate — election-only (council data has no candidates/races)."""
    cands = d.get('candidates') or []
    races = d.get('races') or []
    if not cands or not races:
        return []
    errs, stats = election_mismatches(cands, {r['id']: r for r in races})
    print(f"[validate] INV-ELECT coverage: {stats['checked']} candidates checked; "
          f"INV-ELECT-4 claims {stats['inv4_claimed']}, no-claim {stats['inv4_no_claim']}")
    return errs


# --- HALT-F1 (PS-77/PS-84): committee-linkage ownership checks -------------------------
# PS-82-independent by construction: the EXPECTATION is recomputed from
# candidates[].committee_id CLAIMS (race-map-authored, seed-written) ordered by election
# recency, via ingest.py's ONE shared resolver; the SUBJECT is ingest's stamp on
# committees{}, the by_candidate keying, and by_person owns_committee — different fields,
# different writers. COVERAGE LIMIT (PS-81, stated here): if race-map mis-authors a
# claim, claim and stamp are wrong together — that residual belongs to the authoring
# layer and is guarded by INV-ELECT's namespace/convention checks, not by this block.

def _load_committee_resolver():
    import importlib.util, os
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ingest.py')
    spec = importlib.util.spec_from_file_location('ingest', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.resolve_committee_claimants


def validate_committee_linkage(d):
    """Durable INV-LINK gate — election-only (council data has no candidates/races)."""
    cands = d.get('candidates') or []
    if not cands or not d.get('races'):
        return []
    errs = []
    winners = _load_committee_resolver()(cands, d.get('elections'))
    cand_by_id = {c['id']: c for c in cands}
    comms = d.get('committees') or {}

    # INV-LINK-1: every candidate-type committee's stamp equals the resolved winner.
    for key, cm in comms.items():
        if cm.get('type') != 'candidate' or not cm.get('sbe_committee_id'):
            continue
        win = winners.get(str(cm['sbe_committee_id']))
        if win and cm.get('candidate_id') != win.get('id'):
            errs.append(f"INV-LINK-1: committee '{key}' stamped candidate_id "
                        f"{cm.get('candidate_id')!r} != resolved most-recent claimant {win.get('id')!r}")

    # INV-LINK-2: candidacy-grain money requires a candidacy whose OWN claim reaches the
    # committee the money came through (no money without a matching claim).
    stamped_by_cand = {}
    for key, cm in comms.items():
        if cm.get('candidate_id'):
            stamped_by_cand.setdefault(cm['candidate_id'], []).append(cm)
    bc = (d.get('rollups') or {}).get('by_candidate') or {}
    for cid, v in bc.items():
        if not ((v.get('all') or {}).get('direct', 0)):
            continue
        claim = str(cand_by_id.get(cid, {}).get('committee_id') or '')
        if not any(claim and claim == str(cm.get('sbe_committee_id') or '')
                   for cm in stamped_by_cand.get(cid, [])):
            errs.append(f"INV-LINK-2: by_candidate['{cid}'] carries money but no committee "
                        f"stamped to it is claimed by its own candidate record")

    # INV-LINK-3: owns_committee agrees with the resolved winners.
    owner_ids = {w.get('id') for w in winners.values()}
    for pid, p in ((d.get('rollups') or {}).get('by_person') or {}).items():
        for m in (p.get('members') or []):
            cid = m.get('candidacy_id')
            expect = bool(cand_by_id.get(cid, {}).get('committee_id')) and cid in owner_ids
            if bool(m.get('owns_committee')) != expect:
                errs.append(f"INV-LINK-3: person '{pid}' member '{cid}' owns_committee "
                            f"{m.get('owns_committee')!r} != resolved {expect!r}")
    return errs


def summary(d):
    donors = d.get('donors', {})
    classified = sum(1 for o in donors.values()
                     if o.get('industries') and 'unclassified' not in o['industries'])
    contribs = d.get('contributions', [])
    dues = sum(1 for c in contribs if c.get('contribution_type') == 'IE Committee Dues Transfer')
    ie = sum(1 for c in comms.values() if c.get('type') == 'independent_expenditure') \
        if (comms := d.get('committees', {})) is not None else 0
    return (f"  generated_at : {d.get('generated_at')}\n"
            f"  donors       : {len(donors):,}  ({classified:,} classified, "
            f"{100*classified//max(len(donors),1)}%)\n"
            f"  clusters     : {len(d.get('donor_clusters', {})):,}\n"
            f"  contributions: {len(contribs):,}\n"
            f"  IE committees: {ie}  |  dues-transfer rows typed: {dues:,}")


def main():
    # [AGG/PS-96-PARITY] (F5): emit the detection surface so the elections gate can compare
    # it against its own copy. The list lives twice, in two languages; this is what keeps
    # the two from drifting silently. `path` is not required for this mode.
    if '--emit-predicates' in sys.argv:
        print(json.dumps([{k: p[k] for k in AGG_PREDICATE_KEYS} for p in AGG_PREDICATES],
                         sort_keys=True))
        return 0

    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--strict', action='store_true', help='also fail on warnings')
    ap.add_argument('--emit-predicates', action='store_true',
                    help='print the [AGG/PS-96] detection surface as JSON and exit')
    a = ap.parse_args()

    try:
        d = json.load(open(a.path))
    except Exception as e:
        print(f"[validate] FATAL: could not parse {a.path}: {e}", file=sys.stderr)
        sys.exit(2)

    errors, warnings = validate(d)
    print("[validate] council-data.json summary:")
    print(summary(d))

    for w in warnings:
        print(f"[validate] WARNING  {w}")
    for e in errors:
        print(f"[validate] ERROR    {e}", file=sys.stderr)

    fail = bool(errors) or (a.strict and bool(warnings))
    if fail:
        print(f"[validate] FAILED: {len(errors)} error(s), {len(warnings)} warning(s). "
              f"Build aborted — nothing committed.", file=sys.stderr)
        sys.exit(1)
    print(f"[validate] OK: 0 errors, {len(warnings)} warning(s).")
    sys.exit(0)


if __name__ == '__main__':
    main()
