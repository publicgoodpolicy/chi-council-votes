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
import json, os, sys, argparse, re
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
    errors.extend(validate_donor_parentage(d))
    errors.extend(validate_votes(d))
    errors.extend(validate_members(d))
    errors.extend(validate_dues_excluded(d))
    errors.extend(validate_alder_linkage(d))
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


# The roster field names this validator knows, in resolution order. A votes-carrying
# artifact must present exactly one of them.
#
# `members` joined at SBVOTE-1/B, in the commit that added the school-board artifact —
# the claim became exercised the moment it became true, which is the discipline the A
# repair existed to restore.
ROSTER_FIELDS = ('alders', 'members')

# What each roster shape declares about itself. This is the parameterization point the
# docstring below now claims and no longer overstates: a second votes source becomes a
# client of the votes family by being declared HERE, not by the family being magically
# general.
#
#   position_key — the roster field a `rollcall.votes[].positions` key resolves to.
#   contract     — the column contract MEMBER-* enforces. OPTIONAL, and its absence is
#                  a stated fact rather than a silent skip: `alders` declares none
#                  because the council roster predates this mechanism and inventing a
#                  contract for it is not the school-board lane's to do.
ROSTER_SCHEMAS = {
    'alders': {
        'position_key': 'ward',
    },
    'members': {
        'position_key': 'seat',
        'contract': {
            # Every row carries every one of these keys, present-but-empty included.
            'required': ('member_id', 'name', 'seat', 'seat_type', 'term_start',
                         'term_end', 'source_url', 'candidacy_ref'),
            # THE governing predicate (D-2 as amended, a'): "this row describes a
            # member". One predicate governs both `member_id` minting and date
            # strictness, so vacancy semantics live in exactly one place.
            'member_when': 'name',
            'identity': 'member_id',
            'seat_types': ('elected', 'appointed'),
            # ISO wherever present; required only on a member row.
            'dates': ('term_start', 'term_end'),
            'dates_required_on_member': ('term_start',),
        },
    },
}

_ISO_DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _roster(d):
    """The roster accessor, lifted so ABSENCE and EMPTINESS stay distinguishable.

    Returns `(field_name, rows)`. `field_name` is None when the artifact carries no
    roster field at all — the state the old `d.get('alders') or []` collapsed into
    "empty list", which is precisely what let VOTES-5 and VOTES-6 report zero errors
    having examined nothing on any artifact not shaped like the council's.

    The distinction is the whole of the repair: an absent field is a different fact
    from a present-but-empty one, only the caller can decide what each means, and a
    caller handed `[]` for both cannot decide anything. Same silent-degradation shape
    EDIT-SAFE-1 closed at S1/F4, closed the same way.
    """
    for f in ROSTER_FIELDS:
        if f in d:
            rows = d.get(f)
            return f, (rows if isinstance(rows, list) else [])
    return None, []


def validate_votes(d):
    """[VOTES/*] REFRESH-1 D2 — the votes family, asserting PS-99 single-source.

    The votes family had no validator at all before this: nothing checked rollcall,
    votemeta, or per-alder positions, while the dollars side carried INV-* and
    [AGG/*]. Its absence is how a legacy code vocabulary forked and drifted unseen.

    An artifact with no votes tier is in scope and passes: absence is not a violation.

    SHAPE DEPENDENCE, STATED ACCURATELY (corrected at SBVOTE-1/A, PS-48). A previous
    revision of this docstring claimed the family was "parameterized on the artifact,
    never council-hardcoded". That was false as written and the claim is withdrawn:

      * VOTES-1, -2, -3, -4, -7, -8 read only `rollcall` and `votemeta` and are
        genuinely shape-independent.
      * VOTES-5 and VOTES-6 need a ROSTER, and a roster is council-shaped. They
        resolve it through `_roster`/`ROSTER_FIELDS`, which is the one parameterization
        point; a second votes source becomes a client by being named there, not by
        this function already being general.

    Before that resolution existed, a non-council artifact made both checks examine an
    empty list and report success — a false green, demonstrated at SBVOTE-1 G2. The
    absent and empty cases are now both loud, and distinctly so, under VOTES-ROSTER.
    """
    errs = []
    rc = d.get('rollcall') or {}
    votes = rc.get('votes') or []
    votemeta = d.get('votemeta') or []
    if not votes and not votemeta:
        return errs                       # no votes tier in this artifact

    # VOTES-ROSTER: a votes tier requires a roster for its positions to resolve against.
    # ONE stable check name, two distinct messages — the name never varies with the data
    # (PS-88), while the message says which of the two states was found. When it fires,
    # VOTES-5 and VOTES-6 do NOT run: they would turn one root cause into a flood of
    # derived noise, and a check with nothing to resolve against is a restatement rather
    # than a check (C6.6/PS-82).
    roster_field, alders = _roster(d)
    roster_ok = True
    if roster_field is None:
        roster_ok = False
        errs.append(f"VOTES-ROSTER: the artifact carries a votes tier but no roster field "
                    f"(looked for: {', '.join(ROSTER_FIELDS)}) — VOTES-5 and VOTES-6 cannot "
                    f"resolve positions and are NOT run. This state previously reported zero "
                    f"errors having checked nothing")
    elif not alders:
        roster_ok = False
        errs.append(f"VOTES-ROSTER: roster field `{roster_field}` is present but EMPTY while a "
                    f"votes tier exists — no position can resolve. Distinct from an absent "
                    f"field, and reported distinctly")

    # VOTES-1: rollcall vote ids are unique — the join key for everything below.
    ids = [v.get('id') for v in votes]
    if len(ids) != len(set(ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        errs.append(f"VOTES-1: duplicate rollcall vote id(s): {dupes[:5]}")

    # VOTES-2: the declared count matches the list it declares.
    if rc.get('term_votes') is not None and rc.get('term_votes') != len(votes):
        errs.append(f"VOTES-2: rollcall.term_votes {rc.get('term_votes')} != "
                    f"len(votes) {len(votes)}")

    # VOTES-3: every rollcall vote carries a date — the window key every consumer uses.
    undated = [v.get('id') for v in votes if not v.get('date')]
    if undated:
        errs.append(f"VOTES-3: {len(undated)} rollcall vote(s) carry no date: {undated[:3]}")

    # VOTES-4: every votemeta entry resolves to a rollcall vote. PS-99's first half —
    # a featured vote with no ingest provenance is exactly the hand-entered class.
    idset = set(ids)
    orphan_meta = [m.get('code') for m in votemeta if m.get('vote_id') not in idset]
    if orphan_meta:
        errs.append(f"VOTES-4: votemeta entr(ies) resolving to no rollcall vote: "
                    f"{orphan_meta[:5]} (PS-99: every position comes from the vote ingest)")

    # VOTES-5: SINGLE-SOURCE. Every per-alder vote code resolves to a votemeta entry.
    # No hand-entered exemption exists, because under PS-99 no hand-entered class exists.
    # Runs only against a resolved roster — VOTES-ROSTER owns the absent/empty case.
    if roster_ok:
        codes = {m.get('code') for m in votemeta}
        stray = sorted({c for a in alders for c in (a.get('votes') or {}) if c not in codes})
        if stray:
            errs.append(f"VOTES-5: alder vote code(s) resolving to no votemeta entry: {stray} "
                        f"(PS-99 single-source: no hand-entered class exists, so there is no "
                        f"exemption — a code with no ingest provenance is a defect)")

    # VOTES-6: every position key resolves to a roster row this artifact knows.
    # The `if wards:` guard is REMOVED (SBVOTE-1/A.2). It made an empty roster mean
    # "nothing to check" instead of "cannot check", so the one case the check most needed
    # to catch was the one case it skipped in silence.
    #
    # The key a position resolves BY is declared per roster shape (SBVOTE-1/B): `ward`
    # for the council, `seat` for the school board — which is the V6/D-4 reconciliation,
    # the referential key being the SEAT, because a real seat can have no member and
    # therefore no minted identity.
    if roster_ok:
        pkey = (ROSTER_SCHEMAS.get(roster_field) or {}).get('position_key', 'ward')
        known = {str(a.get(pkey)) for a in alders}
        badw = sorted({w for v in votes for w in (v.get('positions') or {}) if w not in known})
        if badw:
            errs.append(f"VOTES-6: position key(s) resolving to no known `{pkey}`: {badw[:8]}")

    # VOTES-7: `reverse_coded` is RETIRED (REFRESH-1). Absent-or-inert: its presence
    # anywhere means a writer reintroduced the semantic-inversion path this lane removed.
    rc_present = [m.get('code') for m in votemeta if 'reverse_coded' in m]
    if rc_present:
        errs.append(f"VOTES-7: retired field `reverse_coded` present on votemeta entr(ies) "
                    f"{rc_present[:5]} — the flip path was removed at REFRESH-1")

    # VOTES-8: vote.type's stringified-list shape pinned. It is stored as a STRING
    # (e.g. '["ordinance"]'), not a list; a writer switching to a real list would change
    # what every consumer parses, silently.
    badtype = [v.get('id') for v in votes if v.get('type') is not None
               and not isinstance(v.get('type'), str)]
    if badtype:
        errs.append(f"VOTES-8: rollcall vote.type must be a string (the stringified-list "
                    f"shape of record); non-string on {badtype[:3]}")
    return errs


def validate_members(d):
    """[MEMBER/*] SBVOTE-1/B — the roster column contract, implementing D-2 as amended.

    DELIBERATELY OUTSIDE `validate_votes`. That function early-returns on an artifact
    with no votes tier, and the school-board artifact is born with a full roster and
    zero votes — so a roster check living inside it would never run on exactly the
    artifact it exists to examine. These checks are what makes the born artifact's
    green non-vacuous (the amendment's adoption 1: green-at-zero is reported by
    enumeration, never by colour).

    D-2 as amended (a'), which is the ruling this implements:
      * `seat_type` is lowercase `elected` | `appointed`, exactly.
      * Dates are ISO `YYYY-MM-DD` **wherever present**.
      * `term_start` is required-and-ISO **iff `name` is non-blank**. A vacancy row
        carries no `term_start` and its blank is conforming — an accurate fact about a
        seat with no member (D-4).
      * `term_end` is ISO-if-present and always optional; a sitting member has no
        known term end.
    Every violation is fatal and names the row. Nothing is normalized here or at
    ingest: a strict assert gives an editor immediate feedback where silent
    normalization would accept drift and hide it.
    """
    errs = []
    field, rows = _roster(d)
    if field is None:
        return errs                       # no roster at all — VOTES-ROSTER's business
    contract = (ROSTER_SCHEMAS.get(field) or {}).get('contract')
    if not contract:
        return errs                       # shape declares no column contract (see ROSTER_SCHEMAS)

    name_key = contract['member_when']
    id_key = contract['identity']
    seen_ids, seen_seats = {}, {}

    for i, r in enumerate(rows):
        where = f"{field}[{i}]"
        if not isinstance(r, dict):
            errs.append(f"MEMBER-1: {where} is not an object")
            continue
        seat = str(r.get('seat') or '').strip()
        label = f"{where} (seat {seat or '?'})"

        # MEMBER-1: the column contract. Present-but-empty is fine; ABSENT is not,
        # because an absent key and a deliberate blank are different facts.
        missing = [k for k in contract['required'] if k not in r]
        if missing:
            errs.append(f"MEMBER-1: {label} is missing required key(s) {missing}")
            continue

        is_member = bool(str(r.get(name_key) or '').strip())

        # MEMBER-2: seat_type vocabulary, lowercase exactly.
        st = r.get('seat_type')
        if st not in contract['seat_types']:
            errs.append(f"MEMBER-2: {label} seat_type {st!r} is not one of "
                        f"{list(contract['seat_types'])} (lowercase, exactly)")

        # MEMBER-3: dates are ISO wherever present.
        for dk in contract['dates']:
            dv = str(r.get(dk) or '').strip()
            if dv and not _ISO_DATE.match(dv):
                errs.append(f"MEMBER-3: {label} {dk} {dv!r} is present but not ISO "
                            f"YYYY-MM-DD")

        # MEMBER-4: a date required on a member row is present there, and absent on a
        # vacancy. Both directions, because a vacancy carrying a term start is as wrong
        # as a member lacking one — a seat with no member has no term.
        for dk in contract['dates_required_on_member']:
            dv = str(r.get(dk) or '').strip()
            if is_member and not dv:
                errs.append(f"MEMBER-4: {label} describes a member (`{name_key}` "
                            f"non-blank) but carries no {dk}")
            if not is_member and dv:
                errs.append(f"MEMBER-4: {label} is a vacancy (`{name_key}` blank) but "
                            f"carries {dk} {dv!r} — a seat with no member has no term")

        # MEMBER-5: identity is minted iff the row describes a member — THE predicate,
        # the same one governing dates above.
        mid = str(r.get(id_key) or '').strip()
        if is_member and not mid:
            errs.append(f"MEMBER-5: {label} describes a member but mints no {id_key}")
        if not is_member and mid:
            errs.append(f"MEMBER-5: {label} is a vacancy but carries {id_key} {mid!r}")

        # MEMBER-6: minted identities are unique.
        if mid:
            if mid in seen_ids:
                errs.append(f"MEMBER-6: {id_key} {mid!r} is claimed by {label} and by "
                            f"{field}[{seen_ids[mid]}] — two rows, one identity")
            else:
                seen_ids[mid] = i

        # MEMBER-7: the seat is the referential key (V6 reconciled with D-4), so it must
        # exist and be unique whether or not anyone holds it.
        if not seat:
            errs.append(f"MEMBER-7: {where} carries no seat")
        elif seat in seen_seats:
            errs.append(f"MEMBER-7: seat {seat!r} appears at {where} and at "
                        f"{field}[{seen_seats[seat]}] — seats are unique")
        else:
            seen_seats[seat] = i

    return errs


def validate_shard_freshness(d, shards_dir):
    """[SHARD/STALE] REFRESH-1 D3 — the shard-vs-monolith staleness check.

    The trap `ingest_ie.py` documents on itself: build_all builds shards BEFORE the
    hand-run IE step, so without `--shards` (or a re-run) the shards silently miss
    IE and dues data. Nothing caught it — the gate JSON-parsed the shards and
    validated the monolith, and never compared them.

    The stamp is the discriminator: `ingest_ie` advances the monolith's top-level
    `generated_at` through its internal build_rollups, and leaves the index shard's
    behind. TWO NAMESPACES, NEVER CONFLATED: top-level `generated_at` is the dollars
    stamp; `rollcall.generated_at` is the votes stamp. This check reads only the
    former. The total comparison behind it is the deep assert.
    """
    import os
    errs = []
    idx_path = os.path.join(shards_dir, 'council-index.json')
    con_path = os.path.join(shards_dir, 'council-contributions.json')
    if not (os.path.exists(idx_path) and os.path.exists(con_path)):
        return [f"SHARD/STALE: shards not found under {shards_dir}"]
    try:
        idx = json.load(open(idx_path))
        con = json.load(open(con_path))
    except Exception as e:
        return [f"SHARD/STALE: could not parse shards: {type(e).__name__}: {e}"]

    mono_stamp, idx_stamp = d.get('generated_at'), idx.get('generated_at')
    if mono_stamp != idx_stamp:
        errs.append(f"SHARD/STALE: monolith generated_at {mono_stamp!r} != index shard "
                    f"{idx_stamp!r} — the shards were built from an older artifact. "
                    f"Re-run build_shards (or pass ingest_ie --shards).")

    mc, cc = d.get('contributions', []), con.get('contributions', [])
    if len(mc) != len(cc):
        errs.append(f"SHARD/STALE: contribution rows monolith {len(mc):,} != shard {len(cc):,}")
    else:
        def tot(rows):
            s = 0.0
            for r in rows:
                try:
                    s += float(r.get('amount') or 0)
                except (TypeError, ValueError):
                    pass
            return round(s, 2)
        if tot(mc) != tot(cc):
            errs.append(f"SHARD/STALE: contribution dollars monolith {tot(mc)} != shard {tot(cc)}")
    for key in ('donors', 'committees'):
        if len(d.get(key, {})) != len(idx.get(key, {})):
            errs.append(f"SHARD/STALE: {key} monolith {len(d.get(key, {})):,} != "
                        f"index {len(idx.get(key, {})):,}")
    return errs


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


def validate_donor_parentage(d):
    """[DONOR/PARENT] SBE-RERUN-1 G — every donor carries parent_id.

    PORTED from smoke_b1.js, which asserted it and was invoked by nothing. transform_slice1
    writes parent_id on ALL donors and MECHANISM_REFERENCE §1 makes that a precondition of
    ingest_ie's internal build_rollups; a donor without one is silently dropped from parent
    attribution, so every rollup that keys by parent — and the funder rows built on it —
    quietly under-counts. Nothing asserted it: the gate's rollup checks would probably
    break if it happened, but 'probably breaks something downstream' is not an assertion.

    Collection-absent is a clean skip, not a pass-by-accident: school-board-data.json has
    no donors at all, and this validator is shared across all three artifacts.
    """
    donors = d.get('donors')
    if not isinstance(donors, dict) or not donors:
        return []
    bad = [k for k, v in donors.items() if not (v or {}).get('parent_id')]
    if bad:
        return [f"[DONOR/PARENT] {len(bad)} donor(s) carry no parent_id (first: {bad[:3]}) — "
                f"transform_slice1 writes it on ALL donors; without it the donor is dropped "
                f"from parent attribution and every by_parent rollup under-counts"]
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


# ELEC-FIGURE-1 R2 — the dues-exclusion field, pinned at the validator level.
#
# The predicate and the cycle set are stated HERE rather than imported from
# build_rollups, deliberately: this is the [MUNI/TABLE] / [AGG/PS-96-PARITY] shape under
# PS-82 — a check that derives its expectation from the code it checks proves only that
# the code equals itself. Two statements, one oracle, and they are pinned against each
# other by the value rule below.
DUES_TYPE_CHECK = 'IE Committee Dues Transfer'
EXCLUDED_CYCLES_CHECK = {'pre-2011', 'undated'}

# ELEC-FIGURE-1 §2 — the schema version this lane's shape requires, asserted at the other
# end of the ownership build_rollups now holds. Stated here rather than imported, for the
# PS-82 reason the predicate above is stated here. Presence-conditional to match the
# builder: election-data.json carries no version field and none is invented.
COUNCIL_SCHEMA_VERSION_CHECK = '2.1'


def _dues_recount(contribs):
    """Independent recount of what the dues predicate actually excludes.

    SCOPE, measured rather than assumed: the builder's accumulator sits at the dues
    predicate, which every rollup pass reaches only AFTER the is_aggregate and
    excluded-cycle filters. A row those filters already dropped was never excluded *by
    the dues predicate*, so counting it here would compare two different populations.
    That distinction is not academic: at this vintage council-data.json's two readings
    coincide (252 rows either way) but election-data.json's do not — one dues row sits in
    an excluded cycle, so a naive all-dues recount would report 103 rows against the
    builder's 102 and fail a correct build.
    """
    amount, count = 0.0, 0
    for c in contribs:
        if c.get('is_aggregate'):
            continue
        if c.get('cycle') in EXCLUDED_CYCLES_CHECK:
            continue
        if c.get('contribution_type') != DUES_TYPE_CHECK:
            continue
        amount += round(float(c.get('amount') or 0.0), 2)
        count += 1
    return round(float(amount), 2), count


def _invert_ward_map_check(raw):
    """Independent inversion for the check side. Raises on a non-1:1 map, as R1 requires.

    Stated here rather than imported from build_election_seed for the PS-82 reason the
    dues predicate is: a check that derives its expectation from the code it checks proves
    only that the code equals itself.
    """
    by_ward, seen = {}, {}
    for cmte, ward in raw.items():
        if str(cmte).startswith('_'):
            continue
        w = str(ward)
        if w in by_ward or cmte in seen:
            raise ValueError('ward-map inversion is not 1:1')
        by_ward[w] = str(cmte)
        seen[cmte] = w
    return by_ward


def validate_alder_linkage(d, ward_map_raw=None):
    """ELEC-IDENTITY-1 R1's pin: each alderperson candidacy's derived committee_id.

    PS-128 declaration: MODE B — live-derived, premise asserted by the check itself. The
    premise (the artifact carries races and candidates, and a ward map is available to
    invert) is asserted before any value is compared, so a missing input fails loudly
    instead of passing vacuously over an empty population.

    POPULATION, stated as the code's rather than as the concept's: the candidacies the
    derivation reaches — those whose race is `alderperson` AND carries a ward. A ward with
    no mapping row derives null and is asserted to BE null; that is the derivation's own
    zero, not an exemption.
    """
    errors = []
    if 'races' not in d or 'candidates' not in d:
        return errors                      # not an elections-shaped artifact
    if ward_map_raw is None:
        # ward-map.json sits beside this validator, in campaign-finance/ingestion/.
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ward-map.json')
        if not os.path.exists(p):
            return errors                  # no map on disk: nothing to pin against
        with open(p, encoding='utf-8') as f:
            ward_map_raw = json.load(f)
    try:
        by_ward = _invert_ward_map_check(ward_map_raw)
    except ValueError as e:
        errors.append(f"alder linkage: {e} — the derivation's source is unusable")
        return errors

    rid_to_ward = {r['id']: r.get('ward') for r in d.get('races', [])
                   if r.get('office') == 'alderperson' and r.get('ward') is not None}
    if not rid_to_ward:
        return errors                      # no alder races in this artifact
    for c in d.get('candidates', []):
        rid = c.get('race_id')
        if rid not in rid_to_ward:
            continue
        expected = by_ward.get(str(rid_to_ward[rid]))
        actual = c.get('committee_id')
        if actual != expected:
            errors.append(
                f"alder linkage: candidacy {c.get('id')} on race {rid} (ward "
                f"{rid_to_ward[rid]}) carries committee_id {actual!r}, expected "
                f"{expected!r} from the inverted ward map")
    return errors


def validate_dues_excluded(d):
    """R2 (i) premise rule and (ii) value rule. Errors, never skips.

    PS-128 declaration: MODE B — live-derived, premise asserted by the check itself.
    The premise (the field is present and well-formed) is asserted before the value is
    compared, so an artifact that simply lacks the field fails loudly here instead of
    passing vacuously. This is the [C3] shape lifted to the validator level.
    """
    errors = []
    if 'contributions' not in d:
        return errors          # not a contributions-bearing artifact; nothing to assert

    # §2 — the version half of the premise. An artifact carrying schema_version must carry
    # the version this lane's shape requires; the field is now a build product, so a stale
    # value means the artifact was not built by the current builder.
    if 'schema_version' in d and d['schema_version'] != COUNCIL_SCHEMA_VERSION_CHECK:
        errors.append(f"schema_version {d['schema_version']!r} != "
                      f"{COUNCIL_SCHEMA_VERSION_CHECK!r} — the dues_excluded field's shape "
                      f"requires it, and build_rollups writes it (ELEC-FIGURE-1)")

    dx = d.get('dues_excluded')

    # (i) premise rule — absence or malformation is an ERROR, never a skip.
    if dx is None:
        errors.append("dues_excluded: field absent — the dues-exclusion magnitude must be "
                      "emitted at every magnitude including zero (ELEC-FIGURE-1 R1/R2)")
        return errors
    if not isinstance(dx, dict):
        errors.append(f"dues_excluded: expected an object, got {type(dx).__name__}")
        return errors
    amt, cnt = dx.get('amount'), dx.get('count')
    if not isinstance(amt, (int, float)) or isinstance(amt, bool):
        errors.append(f"dues_excluded.amount: expected a number, got {amt!r}")
    elif amt < 0:
        errors.append(f"dues_excluded.amount: negative ({amt})")
    if not isinstance(cnt, int) or isinstance(cnt, bool):
        errors.append(f"dues_excluded.count: expected an integer, got {cnt!r}")
    elif cnt < 0:
        errors.append(f"dues_excluded.count: negative ({cnt})")
    if errors:
        return errors

    # (ii) value rule — to the cent, against the validator's own recount.
    exp_amt, exp_cnt = _dues_recount(d.get('contributions', []))
    if round(float(amt), 2) != exp_amt:
        errors.append(f"dues_excluded.amount {amt} != independent recount {exp_amt} "
                      f"(to the cent, over this artifact's own contributions)")
    if cnt != exp_cnt:
        errors.append(f"dues_excluded.count {cnt} != independent recount {exp_cnt}")
    return errors


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


def self_test():
    """[VOTES/*] SBVOTE-1/A.4 — fire the repair on the population it will actually meet.

    The G2 false-green demonstration made permanent. Before this lane a members-shaped
    artifact carrying votes ran VOTES-5 and VOTES-6 against an empty list and returned
    zero errors; that scenario is the first case below, and it is the reason this
    self-test exists rather than a one-time proof in a lane report.

    Synthetic fixtures only — no artifact on disk is read here. The real council
    artifact is validated directly at the gate, which is the stronger negative control.
    """
    results = []

    def case(name, artifact, expect):
        """expect: a substring that must appear in some error, or None for 'must pass'.

        Runs the whole roster-and-votes surface — `validate_votes` AND
        `validate_members` — because they are one family split across two entry points
        for the early-return reason `validate_members` documents, and a fixture that
        exercised only one of them would miss the seam between them.
        """
        errs = validate_votes(artifact) + validate_members(artifact)
        if expect is None:
            ok = not errs
        else:
            ok = any(expect in e for e in errs)
        results.append((name, ok))
        print(f"SELF-TEST {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"          expected {expect!r}, got: {errs}")

    # A council-shaped artifact that is correct in every respect — the shape every
    # positive case below is a single deliberate mutation away from.
    def council(**over):
        a = {
            'rollcall': {'term_votes': 1, 'votes': [
                {'id': 'v1', 'date': '2026-01-01', 'type': '["ordinance"]',
                 'positions': {'1': 'yes'}}]},
            'votemeta': [{'code': 'c1', 'vote_id': 'v1'}],
            'alders': [{'ward': 1, 'votes': {'c1': 'yes'}}],
        }
        a.update(over)
        return a

    # The undeclared-shape artifact: a roster under a field name no schema declares,
    # WITH votes — the population the A repair was built for.
    #
    # SUPERSEDED FIXTURE, recorded rather than quietly swapped: at SBVOTE-1/A this
    # fixture used `members`, which was then undeclared. B declared `members`, so the
    # same bytes no longer test the same thing — an unknown shape must be a name no
    # schema knows, and `trustees` is that name. The A-phase cases keep their meaning;
    # only the field they use to mean it changed. A declared-and-well-formed `members`
    # artifact is covered separately below, which is the case B adds.
    unknown_shaped = {
        'rollcall': {'term_votes': 1, 'votes': [
            {'id': 'v1', 'date': '2026-01-01', 'type': '["ordinance"]',
             'positions': {'1A': 'Affirmative'}}]},
        'votemeta': [{'code': 'c1', 'vote_id': 'v1'}],
        'trustees': [{'seat': '1A', 'votes': {'c1': 'Affirmative'}}],
    }

    # 1-2. THE FALSE GREEN, both halves. It must fire, and it must fire by name.
    case("undeclared roster shape WITH votes is no longer a false green (errors non-empty)",
         unknown_shaped, "VOTES-ROSTER")
    assert validate_votes(unknown_shaped), "the false-green fixture must not return []"

    # 3. Absence and emptiness are DIFFERENT, and reported differently (A.1).
    case("absent roster field names what it looked for",
         unknown_shaped, "no roster field")
    case("present-but-EMPTY roster is a distinct message, not the same one",
         council(alders=[]), "present but EMPTY")

    # 4. A.2's teeth: an empty roster used to make VOTES-6 skip in silence.
    case("empty roster no longer silently skips the position check",
         council(alders=[]), "VOTES-ROSTER")

    # 5-6. The checks still work on the population they were written for.
    case("VOTES-5 still fires on a stray alder vote code (council shape)",
         council(alders=[{'ward': 1, 'votes': {'ghost': 'yes'}}]), "VOTES-5")
    case("VOTES-6 still fires on an unknown position ward key (council shape)",
         council(rollcall={'term_votes': 1, 'votes': [
             {'id': 'v1', 'date': '2026-01-01', 'type': '["ordinance"]',
              'positions': {'99': 'yes'}}]}), "VOTES-6")

    # 7-8. Negative controls. The documented no-votes-tier behaviour is preserved, and a
    # well-formed council artifact is untouched by the repair.
    case("an artifact with NO votes tier still passes (absence is not a violation)",
         {'donors': {}}, None)
    case("a well-formed council-shaped artifact passes untouched", council(), None)

    # ---- SBVOTE-1/B: the school-board roster contract (D-2 as amended, a').
    # A school-board-shaped roster, correct — one deliberate mutation away from each
    # MEMBER-* case below.
    def sb(**over):
        m = {'member_id': 'jane-doe', 'name': 'Jane Doe', 'seat': '1A',
             'seat_type': 'elected', 'term_start': '2025-01-16', 'term_end': '',
             'source_url': 'https://example.org/roster', 'candidacy_ref': '', 'votes': {}}
        for k, v in over.items():
            m[k] = v
        vac = {'member_id': '', 'name': '', 'seat': '10B', 'seat_type': 'appointed',
               'term_start': '', 'term_end': '', 'source_url': 'https://example.org/roster',
               'candidacy_ref': '', 'votes': {}}
        return {'members': [m, vac]}

    def sb_rows(*rows):
        return {'members': list(rows)}

    case("MEMBER-* : a well-formed school-board roster passes (born-artifact shape)",
         sb(), None)
    case("MEMBER-1 fires on a missing required column",
         sb_rows({'member_id': 'x', 'name': 'X', 'seat': '1A', 'seat_type': 'elected'}),
         "MEMBER-1")
    case("MEMBER-2 fires on a capitalised seat_type (D-2 vocabulary is exact)",
         sb(seat_type='Elected'), "MEMBER-2")
    case("MEMBER-3 fires on a present-but-non-ISO date",
         sb(term_start='Jan 16, 2025'), "MEMBER-3")
    case("MEMBER-4 fires on a MEMBER row with no term_start (a' required-iff-named)",
         sb(term_start=''), "MEMBER-4")
    case("MEMBER-4 fires on a VACANCY carrying a term_start (the other direction)",
         sb_rows({'member_id': '', 'name': '', 'seat': '10B', 'seat_type': 'appointed',
                  'term_start': '2025-01-16', 'term_end': '',
                  'source_url': 'u', 'candidacy_ref': ''}), "MEMBER-4")
    case("MEMBER-4 does NOT fire on a blank term_end (always optional under a')",
         sb(term_end=''), None)
    case("MEMBER-5 fires when a member row mints no member_id",
         sb(member_id=''), "MEMBER-5")
    case("MEMBER-5 fires when a vacancy carries a member_id",
         sb_rows({'member_id': 'ghost', 'name': '', 'seat': '10B',
                  'seat_type': 'appointed', 'term_start': '', 'term_end': '',
                  'source_url': 'u', 'candidacy_ref': ''}), "MEMBER-5")
    case("MEMBER-6 fires on two rows minting one member_id",
         sb_rows(
             {'member_id': 'dup', 'name': 'A', 'seat': '1A', 'seat_type': 'elected',
              'term_start': '2025-01-16', 'term_end': '', 'source_url': 'u', 'candidacy_ref': ''},
             {'member_id': 'dup', 'name': 'B', 'seat': '1B', 'seat_type': 'elected',
              'term_start': '2025-01-16', 'term_end': '', 'source_url': 'u', 'candidacy_ref': ''}),
         "MEMBER-6")
    case("MEMBER-7 fires on a duplicate seat (the referential key)",
         sb_rows(
             {'member_id': 'a', 'name': 'A', 'seat': '1A', 'seat_type': 'elected',
              'term_start': '2025-01-16', 'term_end': '', 'source_url': 'u', 'candidacy_ref': ''},
             {'member_id': 'b', 'name': 'B', 'seat': '1A', 'seat_type': 'elected',
              'term_start': '2025-01-16', 'term_end': '', 'source_url': 'u', 'candidacy_ref': ''}),
         "MEMBER-7")
    case("MEMBER-* do not touch the council shape (alders declares no contract)",
         council(), None)

    # VOTES-6 now resolves by the roster shape's declared position key.
    case("VOTES-6 resolves by `seat` on the members shape",
         {'rollcall': {'term_votes': 1, 'votes': [
             {'id': 'v1', 'date': '2026-01-01', 'type': '["x"]',
              'positions': {'99Z': 'Affirmative'}}]},
          'votemeta': [{'code': 'c1', 'vote_id': 'v1'}],
          'members': [{'member_id': 'a', 'name': 'A', 'seat': '1A',
                       'seat_type': 'elected', 'term_start': '2025-01-16',
                       'term_end': '', 'source_url': 'u', 'candidacy_ref': '',
                       'votes': {'c1': 'Affirmative'}}]},
         "no known `seat`")

    # [DONOR/PARENT] biting cases (SBE-RERUN-1 G). Ported from smoke_b1.js along with the
    # assertion itself; the assertion is only worth having if its failure path runs.
    def pcase(name, artifact, should_fail):
        errs = validate_donor_parentage(artifact)
        ok = bool(errs) == should_fail
        results.append((name, ok))
        print(f"SELF-TEST {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"          should_fail={should_fail}, got: {errs}")

    pcase("[DONOR/PARENT] bites: a donor with NO parent_id fails",
          {'donors': {'a': {'parent_id': 'a'}, 'b': {}}}, True)
    pcase("[DONOR/PARENT] bites: an EMPTY parent_id fails (not just a missing key)",
          {'donors': {'a': {'parent_id': ''}}}, True)
    pcase("[DONOR/PARENT] bites: a null parent_id fails",
          {'donors': {'a': {'parent_id': None}}}, True)
    pcase("[DONOR/PARENT] passes when every donor is parented (self-parent is valid)",
          {'donors': {'a': {'parent_id': 'a'}, 'b': {'parent_id': 'a'}}}, False)
    pcase("[DONOR/PARENT] a donors-less artifact SKIPS cleanly (school-board shape)",
          {'members': []}, False)
    pcase("[DONOR/PARENT] an empty donors map skips rather than passing vacuously",
          {'donors': {}}, False)

    # ELEC-FIGURE-1 R2 (iii) — the dues-exclusion rules, fired on synthetic fixtures.
    # PS-128 declaration: MODE A — pinned independently of live repo state. No artifact
    # on disk is read; each fixture is a literal, and every negative case is proved to
    # fail before the positive cases are trusted.
    def dcase(name, artifact, expect):
        """expect: a substring that must appear in some error, or None for 'must pass'."""
        errs = validate_dues_excluded(artifact)
        ok = (not errs) if expect is None else any(expect in e for e in errs)
        results.append((name, ok))
        print(f"SELF-TEST {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"          expected {expect!r}, got: {errs}")

    _row = {'contribution_type': 'IE Committee Dues Transfer', 'amount': 100.0, 'cycle': '2027'}
    _other = {'contribution_type': 'IE Committee Receipt', 'amount': 5.0, 'cycle': '2027'}

    dcase("[DUES/PREMISE] a contributions-bearing artifact with NO dues_excluded errors",
          {'contributions': [_row]}, "field absent")
    dcase("[DUES/PREMISE] a non-object dues_excluded errors",
          {'contributions': [_row], 'dues_excluded': 100.0}, "expected an object")
    dcase("[DUES/PREMISE] a non-numeric amount errors",
          {'contributions': [_row], 'dues_excluded': {'amount': '100', 'count': 1}},
          "expected a number")
    dcase("[DUES/PREMISE] a non-integer count errors",
          {'contributions': [_row], 'dues_excluded': {'amount': 100.0, 'count': 1.5}},
          "expected an integer")
    dcase("[DUES/PREMISE] a negative amount errors",
          {'contributions': [], 'dues_excluded': {'amount': -1.0, 'count': 0}}, "negative")
    dcase("[DUES/VALUE] a mismatched amount errors",
          {'contributions': [_row], 'dues_excluded': {'amount': 99.0, 'count': 1}},
          "!= independent recount")
    dcase("[DUES/VALUE] a mismatched count errors",
          {'contributions': [_row], 'dues_excluded': {'amount': 100.0, 'count': 2}},
          "count 2 != independent recount 1")
    dcase("[DUES/VALUE] the correct pair passes",
          {'contributions': [_row, _other], 'dues_excluded': {'amount': 100.0, 'count': 1}},
          None)
    dcase("[DUES/VALUE] zero rows with a zero field passes (PS-101: zero is a real answer)",
          {'contributions': [_other], 'dues_excluded': {'amount': 0.0, 'count': 0}}, None)
    dcase("[DUES/VALUE] a dues row in an EXCLUDED cycle is not counted — the row the "
          "predicate never reaches",
          {'contributions': [dict(_row, cycle='pre-2011')],
           'dues_excluded': {'amount': 0.0, 'count': 0}}, None)
    dcase("[DUES/VALUE] an is_aggregate dues row is not counted either",
          {'contributions': [dict(_row, is_aggregate=True)],
           'dues_excluded': {'amount': 0.0, 'count': 0}}, None)
    dcase("[DUES/PREMISE] an artifact with no contributions key SKIPS cleanly",
          {'members': []}, None)
    # §2 — the version assertion, both ways.
    dcase("[DUES/SCHEMA] the ruled schema_version passes",
          {'contributions': [_row], 'schema_version': '2.1',
           'dues_excluded': {'amount': 100.0, 'count': 1}}, None)
    dcase("[DUES/SCHEMA] a stale schema_version errors",
          {'contributions': [_row], 'schema_version': '2.0',
           'dues_excluded': {'amount': 100.0, 'count': 1}}, "schema_version '2.0' !=")

    # ELEC-IDENTITY-1 R1 (iii) — the alder-linkage rules on synthetic fixtures.
    # PS-128 declaration: MODE A — pinned independently of live repo state. No artifact
    # and no ward map on disk is read; every fixture and every map is a literal.
    def acase(name, artifact, ward_map, expect):
        errs = validate_alder_linkage(artifact, ward_map)
        ok = (not errs) if expect is None else any(expect in e for e in errs)
        results.append((name, ok))
        print(f"SELF-TEST {'PASS' if ok else 'FAIL'}  {name}")
        if not ok:
            print(f"          expected {expect!r}, got: {errs}")

    _races = [{'id': 'ward-01', 'office': 'alderperson', 'ward': '1'},
              {'id': 'ward-02', 'office': 'alderperson', 'ward': '2'},
              {'id': 'sb-d01', 'office': 'school_board_member'}]
    _wm = {'11111': 1}          # ward 1 mapped; ward 2 deliberately unmapped

    acase("[ALDER/LINK] a correctly derived committee id passes",
          {'races': _races, 'candidates': [{'id': 'inc-ward-01', 'race_id': 'ward-01',
                                            'committee_id': '11111'}]}, _wm, None)
    acase("[ALDER/LINK] a WRONG committee id errors",
          {'races': _races, 'candidates': [{'id': 'inc-ward-01', 'race_id': 'ward-01',
                                            'committee_id': '99999'}]}, _wm,
          "expected '11111'")
    acase("[ALDER/LINK] a ward with NO mapping row derives null, and null passes",
          {'races': _races, 'candidates': [{'id': 'inc-ward-02', 'race_id': 'ward-02',
                                            'committee_id': None}]}, _wm, None)
    acase("[ALDER/LINK] an unmapped ward carrying a committee id errors "
          "(the derivation's zero is asserted, not exempted)",
          {'races': _races, 'candidates': [{'id': 'inc-ward-02', 'race_id': 'ward-02',
                                            'committee_id': '11111'}]}, _wm, "expected None")
    acase("[ALDER/LINK] a NON-1:1 inversion (two committees claiming one ward) errors",
          {'races': _races, 'candidates': []}, {'11111': 1, '22222': 1}, "not 1:1")
    # The committee-side duplicate (one committee mapped to two wards) is UNREACHABLE from
    # a JSON object — object keys are unique by construction, so a committee cannot appear
    # twice. The guard for it is kept as defence against a future non-dict source, and what
    # is testable here is that near-miss keys are NOT silently merged: '11111' and '11111 '
    # are distinct committees, so they collide on the ward side and error.
    acase("[ALDER/LINK] near-miss committee keys are not merged; they collide on the ward",
          {'races': _races, 'candidates': []}, {'11111': 1, '11111 ': 1}, "not 1:1")
    acase("[ALDER/LINK] a non-alder candidacy is outside the population",
          {'races': _races, 'candidates': [{'id': 'cand-x', 'race_id': 'sb-d01',
                                            'committee_id': '77777'}]}, _wm, None)
    acase("[ALDER/LINK] an artifact with no races SKIPS cleanly",
          {'candidates': []}, _wm, None)

    bad = [n for n, ok in results if not ok]
    print(f"self-test: {len(results)} checks · "
          + ("ALL PASS" if not bad else f"FAILED {len(bad)}"))
    return 1 if bad else 0


def main():
    # SBVOTE-1/A.4: the votes-family self-test. Handled before argparse, like
    # --emit-predicates, because `path` is not required for this mode.
    if '--self-test' in sys.argv:
        return sys.exit(self_test())

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
    ap.add_argument('--self-test', action='store_true',
                    help='fire the votes-family checks on synthetic fixtures and exit '
                         '(SBVOTE-1/A.4); reads no artifact')
    ap.add_argument('--shards', metavar='DIR',
                    help='shards dir; when given, assert the shards are not stale against '
                         'this artifact (REFRESH-1 D3). Opt-in by argument rather than a '
                         'derived sibling path, so the coupling is explicit at every caller.')
    a = ap.parse_args()

    try:
        d = json.load(open(a.path))
    except Exception as e:
        print(f"[validate] FATAL: could not parse {a.path}: {e}", file=sys.stderr)
        sys.exit(2)

    errors, warnings = validate(d)
    if a.shards:
        errors.extend(validate_shard_freshness(d, a.shards))
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
