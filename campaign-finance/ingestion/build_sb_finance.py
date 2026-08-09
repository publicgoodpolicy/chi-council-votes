# build_sb_finance.py — SBFIN-1 / HALT-SBF-A. Mints school-board-finance.json.
#
# PLACEMENT: elections-canonical, immediately after build_rollups (it reads rollups.*).
# It also reads school-board-data.json for the bridge, which ingest_sb_votes owns; running
# it before build_rollups would read a stale rollup layer, and running it before
# ingest_sb_votes would read stale refs. Both inputs are hashed into _sync so the vintage
# is never inferred.
#
# THE FIREWALL, STRUCTURALLY. Four money streams are carried as four separate keys per
# election — direct, self_funding, ie_support, ie_oppose. **No fused total field exists
# anywhere in this artifact, and none may be added.** A render that wants a combined
# figure would have to compute it, which is exactly the act the firewall forbids;
# validate_sb_finance asserts no field equals any sum of the four (SBF-5).
#
# THE ANCHOR (D-B as amended, mixed anchor). members[].candidacy_ref holds ONE of:
#   person-*  -> identity anchor; candidacies derived from by_person.members[], donor
#                detail from by_person.donors, figures from by_candidate_election
#   <cand id> -> only where no by_person entry exists; candidate-level totals, no donors
#   'none'    -> no candidacy, or only inc- placeholders
#   ''        -> the vacancy row, and nowhere else
#
# by_candidate is used for RESOLUTION ONLY. No figure is ever sourced from it: its values
# are committee-lifetime totals bucketed under a single cycle key, so a per-election figure
# taken from it is wrong in the inflating direction (G1b S2-b).
#
# DONOR DETAIL IS PER-ELECTION AND SELF-FUNDING-FREE (SBFIN-2 / HALT-SBF2-A, A.1+A.2).
# `donors_by_election` and `coverage_by_election` are keyed by election. The all-elections
# view is derived by summation at render and is NEVER stored — a stored cross-election
# donor list is the shape that produced F1.
#
# TWO-STEP REPLACE, DELIBERATE AND TEMPORARY. A.1 said "replace". The superseded flat
# `donors` / `coverage` keys survive this ONE commit because the embed reads them and
# deleting them here fails [SBV/RENDER] (measured: 4 checks plus a TypeError in
# financeSection). Artifact shape and render are coupled; the deletion lands at
# HALT-SBF2-B with the render rebase. `superseded_keys` in the artifact says so in the
# file itself. The end state is exactly as ratified.
#
# What F1 was: the member page's Donors tile, coverage bar and Top-donors list read one
# all-elections, self-funding-INCLUSIVE list while the Raised tile beside them was
# election-scoped and self-funding-EXCLUSIVE, so a self-funder rendered both as a top
# donor and as the "not included in Raised" tile. The repair is structural — the basis
# the render can reach is the only correct basis:
#
#   Σ donors_by_election[e][*].amount  ==  elections[e].direct.amount      EXACTLY
#   Σ donors_by_election[e][*].amount  !=  direct + self_funding            (SBF-9a/9b)
#
# Self-funding is removed at DONOR grain, not row grain. That is sufficient because no
# donor carries both stamps within a member — measured at the G2 R0 pre-flight over all
# 13 person-anchored members, 26 election buckets, zero mixed donors. The row-level split
# was measured unnecessary, not skipped; if a mixed donor ever appears, SBF-9d fires.
#
# Each donor row carries its ITEMIZED ROWS: one entry per contribution, every one dated.
# Optional flags (loan, in-kind, aggregate) are emitted ONLY when the source row carries
# them, so a class that is absent today costs zero bytes and appears automatically if it
# wakes. `is_self` is not carried at all — after the donor-grain drop it would be false on
# every row, and a field that can only hold one value is not evidence.
#
#     python3 campaign-finance/ingestion/build_sb_finance.py \
#         --school-board school-board-data.json --elections election-data.json \
#         --out school-board-finance.json [--self-test] [--dry-run]
import argparse, hashlib, json, os, sys
from datetime import datetime, timezone

# ONE implementation of the window rule and the exclusion set, imported rather than
# retyped: this builder must bucket a contribution to an election exactly as
# build_rollups bucketed the aggregates it reconciles against, and a second copy of
# `_bucket` is a divergence waiting to happen.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_rollups import EXCLUDED_CYCLES, WINDOWS_PATH, _bucket, _office_type  # noqa: E402

DUES_TYPE = "IE Committee Dues Transfer"

# 1.0 -> 1.1 at SBFIN-2 A: `donors` and `coverage` became per-election maps and donor rows
# carry itemized dated entries. A shape change under an unchanged version number is a trap.
SCHEMA_VERSION = 1.1
# Tags that carry no interest-group signal. The council's correlation card isolates the
# complement of this set via its exclude-individual / exclude-unclassified toggles; the
# ratified >=50% industry-bar gate is computed against 'substantive' below.
NON_SUBSTANTIVE = {"individual", "small-dollar", "unclassified"}
STREAMS = ("direct", "self_funding", "ie_support", "ie_oppose")


def sha256_file(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def classify_ref(ref):
    """The three kinds plus the vacancy blank. Shape is never assumed beyond these."""
    if ref == "":
        return "vacancy"
    if ref == "none":
        return "none"
    if ref.startswith("person-"):
        return "person"
    return "candidate"


def industry_class(donor):
    """substantive | individual_only | unclassified, from the merged artifact field."""
    inds = [i for i in (donor.get("industries") or []) if i]
    if not inds or set(inds) <= {"unclassified"}:
        return "unclassified"
    if set(inds) <= NON_SUBSTANTIVE:
        return "individual_only"
    return "substantive"


def elections_for(candidacy_ids, bce):
    """Per-election, per-stream aggregation across a member's candidacies.

    Sources every figure from by_candidate_election, which is the only election-scoped
    money structure in the elections artifact. Amount AND count are carried per stream so
    the member page's Contributions/Donors tiles do not have to re-derive them."""
    out = {}
    for cid in candidacy_ids:
        for election, rec in (bce.get(cid) or {}).items():
            slot = out.setdefault(election, {
                "label": rec.get("label") or election,
                "direct": {"amount": 0.0, "count": 0},
                "self_funding": {"amount": 0.0, "count": 0},
                "ie_support": {"amount": 0.0, "count": 0},
                "ie_oppose": {"amount": 0.0, "count": 0},
                "candidacies": [],
            })
            # 'contributions' is by_candidate_election's name for the direct stream.
            for src, dst in (("contributions", "direct"), ("self_funding", "self_funding"),
                             ("ie_support", "ie_support"), ("ie_oppose", "ie_oppose")):
                v = rec.get(src) or {}
                slot[dst]["amount"] += float(v.get("amount") or 0.0)
                slot[dst]["count"] += int(v.get("count") or 0)
            slot["candidacies"].append(cid)
    for slot in out.values():
        slot["candidacies"].sort()
        for s in STREAMS:
            # Re-round only the accumulation, never a sourced single value (SBF-4 compares
            # single-candidacy members against their source exactly).
            slot[s]["amount"] = round(slot[s]["amount"], 2)
    return out


SHARE_SCALE = 1000000  # shares are stored at 6dp


def apportion_shares(buckets, total):
    """Largest-remainder apportionment so the stored shares sum EXACTLY to 1.

    Three independently-rounded quotients need not sum to 1 — measured on real data at
    HALT-SBF-A (Biggs's three shares summed to 0.999999 and SBF-7d bit). This is the same
    remedy the elections render layer already applies to its industry bar, for the same
    reason: displayed parts must sum to the displayed whole. Ordering is by remainder then
    bucket name, so the result is deterministic across runs."""
    if not total:
        return {k: 0.0 for k in buckets}
    exact = {k: (v / total) * SHARE_SCALE for k, v in buckets.items()}
    floors = {k: int(x) for k, x in exact.items()}
    short = SHARE_SCALE - sum(floors.values())
    order = sorted(exact, key=lambda k: (-(exact[k] - floors[k]), k))
    for i in range(short):
        floors[order[i % len(order)]] += 1
    return {k: v / SHARE_SCALE for k, v in floors.items()}


def coverage_for(rows):
    """The industry-coverage rollup over one election's donor rows.

    Coverage is carried as DATA (dollars and shares) so the ratified >=50% gate is
    computable at render and assertable at the gate, rather than recomputed in the embed.
    Per-election since SBFIN-2 A.1: a coverage figure whose basis differs from the donor
    list it describes is F1 in another costume."""
    buckets = {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0}
    for r in rows:
        buckets[r["industry_class"]] += r["amount"]
    total = round(sum(r["amount"] for r in rows), 2)
    buckets = {k: round(v, 2) for k, v in buckets.items()}
    shares = apportion_shares(buckets, total)
    return {
        "donor_total": total,
        "donor_count": len(rows),
        "dollars": buckets,
        "shares": shares,
        # The ratified gate lives here as a computed boolean so render and gate agree.
        "substantive_share": shares["substantive"],
        "meets_industry_threshold": shares["substantive"] >= 0.50,
    }


# Emitted on an item only when the source row carries the field. A class that is absent
# today (the un-keyed aggregate, PS-96) therefore costs nothing and appears the moment a
# data source restores it — the dormant-correct pattern, not a hardcoded absence.
ITEM_OPTIONAL = ("is_loan", "is_in_kind", "in_kind_description",
                 "is_aggregate", "contribution_count")


def scan_committee_rows(ed, candidacy_ids):
    """One pass over the member's own committees' contributions.

    Returns (items, self_donor_ids, mixed_donor_ids) where items maps
    (election, donor_id) -> list of itemized rows.

    The row filters are EXACTLY build_rollups' by_person filters — Aggregate-typed
    donors, EXCLUDED_CYCLES, dues transfers, unresolvable donors — because these rows are
    reconciled cent-for-cent against the aggregates that pass produced. A filter that
    differs by one predicate makes the reconciliation assert a coincidence rather than an
    identity.

    is_self rows are collected separately, never emitted: they belong to the self_funding
    stream, which has its own tile. `mixed` records any donor seen on BOTH sides — the
    condition that would make the donor-grain drop insufficient (currently empty; SBF-9d
    asserts it stays empty)."""
    comms = ed.get("committees", {})
    cands = {c["id"]: c for c in ed.get("candidates", [])}
    race_office = {r["id"]: r.get("office") for r in ed.get("races", [])}
    donors = ed.get("donors", {})
    aggregate_ids = {k for k, v in donors.items() if v.get("type") == "Aggregate"}
    try:
        windows = json.load(open(WINDOWS_PATH))
    except (OSError, json.JSONDecodeError):
        windows = {}

    wanted = set(candidacy_ids)
    slug_wins = {}
    for slug, cm in comms.items():
        cid = cm.get("candidate_id")
        if cid not in wanted:
            continue
        crec = cands.get(cid) or {}
        ot = _office_type(race_office.get(crec.get("race_id")))
        slug_wins[slug] = windows.get(ot) if ot else None

    items, self_ids, nonself_ids = {}, set(), set()
    for c in ed.get("contributions", []):
        slug = c.get("committee_id")
        if slug not in slug_wins:
            continue
        if c.get("is_aggregate"):
            continue
        if c.get("cycle") in EXCLUDED_CYCLES:
            continue
        if c.get("contribution_type") == DUES_TYPE:
            continue
        did = c.get("donor_id")
        if did is None or did not in donors or did in aggregate_ids:
            continue
        if c.get("is_self"):
            self_ids.add(did)
            continue
        wins = slug_wins.get(slug)
        w = _bucket(c.get("date"), wins) if wins else None
        if w is None:
            continue
        nonself_ids.add(did)
        row = {"date": c.get("date"),
               "amount": round(float(c.get("amount") or 0.0), 2),
               "contribution_type": c.get("contribution_type")}
        for k in ITEM_OPTIONAL:
            if k in c:
                row[k] = c[k]
        items.setdefault((w["id"], did), []).append(row)
    for lst in items.values():
        lst.sort(key=lambda r: (r["date"] or "", -r["amount"]))
    return items, self_ids, (self_ids & nonself_ids)


def donor_detail_flat(person, donors):
    """The PRE-SBFIN-2 all-elections donor rows + coverage. SUPERSEDED, retained for
    exactly one commit.

    Why this still exists after A.1 said "replace": the embed reads `donors` and
    `coverage`, and removing them in the same commit that adds the per-election keys
    crashes the render fixture ([SBV/RENDER], measured: 4 failing checks plus a
    TypeError in financeSection). The artifact shape and the render are coupled, so the
    replace lands in two steps — A adds, B rebases the render and deletes these. Every
    ratified property of the end state is unchanged; only the deletion moves by one
    commit. This basis is the F1 basis (all elections, self-funding INCLUSIVE) and no new
    surface may read it."""
    rows = []
    for did, v in (person.get("donors", {}).get("total") or {}).items():
        d = donors.get(did) or {}
        rows.append({
            "donor_id": did,
            "name": d.get("name"),
            "type": d.get("type"),
            "amount": round(float(v.get("amount") or 0.0), 2),
            "count": int(v.get("count") or 0),
            "industries": [i for i in (d.get("industries") or []) if i],
            "industry_class": industry_class(d),
        })
    rows.sort(key=lambda r: (-r["amount"], r["donor_id"]))
    return rows, coverage_for(rows)


def donor_detail_by_election(person, donors, elections, items, self_ids):
    """Per-election donor rows + per-election coverage for a person-anchored member.

    Reads `by_person.donors.by_election`, which build_rollups already computes, drops the
    self-funder donors whole, and attaches each donor's itemized rows for that election.
    A key is emitted for EVERY election the member has, empty list included: in-frame
    absence is information, and a missing key would render as a missing surface."""
    by_election = (person.get("donors", {}).get("by_election") or {})
    rows_out, cov_out = {}, {}
    for election in elections:
        rows = []
        for did, v in (by_election.get(election) or {}).items():
            if did in self_ids:
                continue
            d = donors.get(did) or {}
            rows.append({
                "donor_id": did,
                "name": d.get("name"),
                "type": d.get("type"),
                "amount": round(float(v.get("amount") or 0.0), 2),
                "count": int(v.get("count") or 0),
                "industries": [i for i in (d.get("industries") or []) if i],
                "industry_class": industry_class(d),
                "items": items.get((election, did), []),
            })
        rows.sort(key=lambda r: (-r["amount"], r["donor_id"]))
        rows_out[election] = rows
        cov_out[election] = coverage_for(rows)
    return rows_out, cov_out


def build_member(m, ed):
    bp = ed["rollups"].get("by_person", {})
    bc = ed["rollups"].get("by_candidate", {})
    bce = ed["rollups"].get("by_candidate_election", {})
    donors = ed.get("donors", {})

    ref = (m.get("candidacy_ref") or "").strip()
    kind = classify_ref(ref)
    out = {
        "member_id": m.get("member_id"),
        "name": m.get("name"),
        "seat": m.get("seat"),
        "seat_type": m.get("seat_type"),
        "candidacy_ref": ref,
        "ref_kind": kind,
        "candidacies": [],
        "elections": {},
        # SUPERSEDED by donors_by_election / coverage_by_election; deleted at HALT-SBF2-B
        # once the render reads the new keys. Kept for one commit so the shape change and
        # the render change can be separate commits (see donor_detail_flat).
        "donors": [],
        "coverage": None,
        # The repaired basis: per-election, self-funding-free, itemized. Empty dicts,
        # never empty lists — the shape is the same whether or not a member has detail.
        "donors_by_election": {},
        "coverage_by_election": {},
        # The ratified thinness state, carried as data rather than inferred at render.
        "has_donor_detail": False,
        "self_funder_donor_ids": [],
        "finance_state": None,
    }

    if kind == "vacancy":
        out["finance_state"] = "vacancy"
        return out
    if kind == "none":
        out["finance_state"] = "no_record"
        return out

    if kind == "person":
        person = bp.get(ref)
        if person is None:
            raise SystemExit(f"[build_sb_finance] FATAL: person ref {ref!r} "
                             f"(seat {m.get('seat')}) not in rollups.by_person")
        out["display_name"] = person.get("display_name")
        out["candidacies"] = sorted(x["candidacy_id"] for x in person.get("members", []))
        # Elections first: the donor lists are keyed by them, and a donor election that
        # the figures do not know about is a defect, not a key to invent (SBF-9c).
        out["elections"] = elections_for(out["candidacies"], bce)
        items, self_ids, mixed = scan_committee_rows(ed, out["candidacies"])
        if mixed:
            raise SystemExit(
                f"[build_sb_finance] FATAL: seat {m.get('seat')} has donor(s) carrying BOTH "
                f"is_self and non-self rows {sorted(mixed)}; the donor-grain self-funding "
                f"drop is no longer sufficient and a row-grain split is required")
        flat_rows, flat_cov = donor_detail_flat(person, donors)
        out["donors"], out["coverage"] = flat_rows, flat_cov
        rows, cov = donor_detail_by_election(person, donors, out["elections"].keys(),
                                             items, self_ids)
        out["donors_by_election"], out["coverage_by_election"] = rows, cov
        out["has_donor_detail"] = bool(flat_rows)
        out["self_funder_donor_ids"] = sorted(self_ids)
        out["finance_state"] = "full"
        return out

    # Kind (b). by_candidate is consulted ONLY to confirm the id resolves; its
    # figures are never read (S2-b).
    out["candidacies"] = [ref]
    out["resolves_in_by_candidate"] = ref in bc
    out["finance_state"] = "totals_only"
    out["elections"] = elections_for(out["candidacies"], bce)
    return out


def build(sb, ed, sb_sha, ed_sha, stamp):
    members = [build_member(m, ed) for m in sb.get("members", [])]
    by_state = {}
    for m in members:
        by_state[m["finance_state"]] = by_state.get(m["finance_state"], 0) + 1
    # Carried so the gate asserts a recount rather than trusting a number in a report.
    donor_rows = sum(len(v) for m in members
                     for v in (m.get("donors_by_election") or {}).values())
    itemized_rows = sum(len(r.get("items") or []) for m in members
                        for v in (m.get("donors_by_election") or {}).values() for r in v)
    return {
        "schema_version": SCHEMA_VERSION,
        # Own namespace: this artifact's vintage is not school-board-data's and not
        # election-data's, and inferring either from the other has burned this repo before.
        "generated_at": stamp,
        "source": "derived: school-board-data.json (bridge) x election-data.json (rollups)",
        "_sync": {
            "generated_at": stamp,
            "inputs": {
                "school-board-data.json": {"sha256": sb_sha},
                "election-data.json": {"sha256": ed_sha},
            },
            "convention": ("figures are election-labeled and sourced from "
                           "rollups.by_candidate_election; by_candidate is resolution-only; "
                           "the four streams are never summed in this artifact"),
        },
        "streams": list(STREAMS),
        # Self-describing intermediate state: a reader opening this file between A and B
        # must not have to guess which donor list is authoritative.
        "superseded_keys": {
            "members[].donors": "members[].donors_by_election",
            "members[].coverage": "members[].coverage_by_election",
            "note": ("the superseded pair is all-elections and self-funding-inclusive "
                     "(the F1 basis); it is read only by the pre-SBFIN-2-B render and is "
                     "deleted at HALT-SBF2-B. No new surface may read it."),
        },
        "industry_threshold": 0.50,
        "counts": {"members": len(members), "by_finance_state": by_state,
                   "donor_rows": donor_rows, "itemized_rows": itemized_rows},
        "members": members,
    }


def self_test():
    """Cases that would otherwise only be caught by a live Sheet + full artifact."""
    t = [("classify person", classify_ref("person-biggs-j") == "person"),
         ("classify candidate", classify_ref("bannon-sb-d01") == "candidate"),
         ("classify none", classify_ref("none") == "none"),
         ("classify vacancy blank", classify_ref("") == "vacancy"),
         # A cand- prefixed id is kind (b), not a special shape (17/148 carry it).
         ("cand- prefix is still candidate kind",
          classify_ref("cand-hargrove-sb-d10") == "candidate"),
         ("industry: substantive", industry_class({"industries": ["labor-teachers"]}) == "substantive"),
         ("industry: individual only", industry_class({"industries": ["individual"]}) == "individual_only"),
         ("industry: mixed counts as substantive",
          industry_class({"industries": ["individual", "real-estate"]}) == "substantive"),
         ("industry: empty is unclassified", industry_class({"industries": []}) == "unclassified"),
         ("industry: explicit unclassified", industry_class({"industries": ["unclassified"]}) == "unclassified"),
         ]
    # elections_for keeps the four streams separate and never emits a total
    bce = {"x-1": {"2024": {"label": "2024: D1",
                            "contributions": {"amount": 10.0, "count": 1},
                            "self_funding": {"amount": 5.0, "count": 1},
                            "ie_support": {"amount": 2.0, "count": 1},
                            "ie_oppose": {"amount": 3.0, "count": 1}}}}
    e = elections_for(["x-1"], bce)
    t.append(("elections_for carries four streams",
              all(s in e["2024"] for s in STREAMS)))
    t.append(("elections_for emits NO total-shaped key",
              not any(k in e["2024"] for k in ("total", "all", "combined", "raised"))))
    t.append(("elections_for sums nothing across streams",
              e["2024"]["direct"]["amount"] == 10.0 and e["2024"]["ie_oppose"]["amount"] == 3.0))
    # two candidacies in one election aggregate per stream
    bce2 = {"a": {"2024": {"label": "L", "contributions": {"amount": 1.5, "count": 1},
                           "self_funding": {"amount": 0, "count": 0},
                           "ie_support": {"amount": 0, "count": 0},
                           "ie_oppose": {"amount": 0, "count": 0}}},
            "b": {"2024": {"label": "L", "contributions": {"amount": 2.25, "count": 2},
                           "self_funding": {"amount": 0, "count": 0},
                           "ie_support": {"amount": 0, "count": 0},
                           "ie_oppose": {"amount": 0, "count": 0}}}}
    e2 = elections_for(["a", "b"], bce2)
    t.append(("multi-candidacy aggregation, amount", e2["2024"]["direct"]["amount"] == 3.75))
    t.append(("multi-candidacy aggregation, count", e2["2024"]["direct"]["count"] == 3))
    t.append(("multi-candidacy records both ids", e2["2024"]["candidacies"] == ["a", "b"]))
    # Largest-remainder: the real shape that made SBF-7d bite, plus the edges.
    # The invariant is exact in INTEGER units; re-summing the divided floats can differ by
    # one ulp, which no apportionment can remove, so the unit sum is what is asserted.
    def units(b, tot):
        return sum(round(v * SHARE_SCALE) for v in apportion_shares(b, tot).values())
    t.append(("share units sum exactly to scale on the measured failing shape",
              units({"substantive": 15500.0, "individual_only": 185659.0,
                     "unclassified": 28448.84}, 229607.84) == SHARE_SCALE))
    t.append(("share units sum exactly to scale on a thirds split",
              units({"a": 1.0, "b": 1.0, "c": 1.0}, 3.0) == SHARE_SCALE))
    t.append(("float re-sum lands within one ulp of 1",
              abs(sum(apportion_shares({"substantive": 15500.0, "individual_only": 185659.0,
                                        "unclassified": 28448.84}, 229607.84).values()) - 1.0) < 1e-9))
    t.append(("zero total yields zero shares, not a divide",
              sum(apportion_shares({"a": 0.0, "b": 0.0}, 0.0).values()) == 0.0))
    t.append(("apportionment is deterministic across runs",
              apportion_shares({"a": 1.0, "b": 2.0}, 3.0) == apportion_shares({"a": 1.0, "b": 2.0}, 3.0)))

    # ---- SBFIN-2 A: per-election donor rows, self-funding-free, itemized ----------
    person = {"donors": {"by_election": {
        "2024": {"d-give": {"amount": 100.0, "count": 2},
                 "d-self": {"amount": 40.0, "count": 1}},
        "2026": {"d-give": {"amount": 7.0, "count": 1}}}}}
    dons = {"d-give": {"name": "Giver", "type": "PAC", "industries": ["labor-trades"]},
            "d-self": {"name": "Self", "type": "Individual", "industries": ["individual"]}}
    it = {("2024", "d-give"): [{"date": "2024-03-01", "amount": 60.0,
                                "contribution_type": "Individual Contribution"},
                               {"date": "2024-05-01", "amount": 40.0,
                                "contribution_type": "Individual Contribution"}],
          ("2026", "d-give"): [{"date": "2026-02-01", "amount": 7.0,
                                "contribution_type": "Transfer In"}]}
    rows, cov = donor_detail_by_election(person, dons, ["2024", "2026"], it, {"d-self"})
    t.append(("donor rows are keyed by election, not flat",
              set(rows) == {"2024", "2026"} and isinstance(rows["2024"], list)))
    t.append(("the self-funder donor is dropped whole",
              [r["donor_id"] for r in rows["2024"]] == ["d-give"]))
    t.append(("the dropped self dollars leave the election's donor total",
              cov["2024"]["donor_total"] == 100.0))
    t.append(("itemized rows attach to their own donor and election",
              len(rows["2024"][0]["items"]) == 2 and len(rows["2026"][0]["items"]) == 1))
    t.append(("items sum to their donor's per-election amount",
              round(sum(x["amount"] for x in rows["2024"][0]["items"]), 2)
              == rows["2024"][0]["amount"]))
    t.append(("no item carries an is_self key",
              not any("is_self" in x for v in rows.values() for r in v for x in r["items"])))
    t.append(("an election with no donor rows still gets a key",
              donor_detail_by_election(person, dons, ["2024", "2026", "2028"], it, set())[0]["2028"] == []))
    t.append(("an all-self election yields an empty list and a zero coverage, not a missing key",
              donor_detail_by_election({"donors": {"by_election": {"2030": {"d-self": {"amount": 5.0, "count": 1}}}}},
                                       dons, ["2030"], {}, {"d-self"})[1]["2030"]["donor_total"] == 0.0))
    t.append(("coverage classes follow the surviving rows only",
              cov["2024"]["dollars"]["substantive"] == 100.0
              and cov["2024"]["dollars"]["individual_only"] == 0.0))
    # The all-elections view is DERIVED, never stored — summation must reproduce it.
    t.append(("all-elections total is reconstructable by summation",
              round(sum(r["amount"] for v in rows.values() for r in v), 2) == 107.0))
    t.append(("ITEM_OPTIONAL omits absent flags rather than emitting false",
              "is_loan" not in rows["2024"][0]["items"][0]))

    fails = 0
    for name, ok in t:
        print(("SELF-TEST PASS  " if ok else "SELF-TEST FAIL  ") + name)
        fails += (not ok)
    print(f"self-test: {len(t)} checks · " + ("ALL PASS" if not fails else f"FAILED {fails}"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description="Mint school-board-finance.json (SBFIN-1).")
    ap.add_argument("--school-board", default="school-board-data.json")
    ap.add_argument("--elections", default="election-data.json")
    ap.add_argument("--out", default="school-board-finance.json")
    ap.add_argument("--self-test", action="store_true", help="run unit cases and exit; reads nothing")
    ap.add_argument("--dry-run", action="store_true", help="build and report; write no file")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())

    for p in (a.school_board, a.elections):
        if not os.path.exists(p):
            print(f"[build_sb_finance] FATAL: missing input {p}", file=sys.stderr)
            sys.exit(2)
    sb = json.load(open(a.school_board))
    ed = json.load(open(a.elections))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    art = build(sb, ed, sha256_file(a.school_board), sha256_file(a.elections), stamp)

    c = art["counts"]
    print(f"[build_sb_finance] {c['members']} members · " +
          " · ".join(f"{k}={v}" for k, v in sorted(c["by_finance_state"].items())))
    print(f"[build_sb_finance] {c['donor_rows']} donor-election rows · "
          f"{c['itemized_rows']} itemized rows")
    withcov = [m for m in art["members"] if m.get("has_donor_detail")]
    if withcov:
        # Per-election since A.1, so the threshold is reported per election bucket rather
        # than per member — one member can clear it in one election and not the other.
        buckets = [(m, e, cov) for m in withcov
                   for e, cov in (m.get("coverage_by_election") or {}).items()]
        meets = sum(1 for _, _, cov in buckets if cov["meets_industry_threshold"])
        print(f"[build_sb_finance] donor detail on {len(withcov)} members / {len(buckets)} "
              f"election buckets; {meets} meet the {art['industry_threshold']:.0%} "
              f"industry threshold")
    if a.dry_run:
        print("[build_sb_finance] --dry-run: nothing written")
        return
    with open(a.out, "w") as fh:
        json.dump(art, fh, indent=2)
        fh.write("\n")
    print(f"[build_sb_finance] wrote {a.out}")


if __name__ == "__main__":
    main()
