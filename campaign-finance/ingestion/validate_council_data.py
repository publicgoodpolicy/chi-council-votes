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
import json, sys, argparse
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
    return errors, warnings


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
    races = {r['id']: r for r in d.get('races', [])}

    def elec_of(cid):
        c = cands.get(cid)
        return races.get(c.get('race_id'), {}).get('election_id') if c else None

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
            earliest = sorted(membs, key=lambda m: m.get('election_id') or '')[0]['candidacy_id']
            prior_members.add(earliest)

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
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--strict', action='store_true', help='also fail on warnings')
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
