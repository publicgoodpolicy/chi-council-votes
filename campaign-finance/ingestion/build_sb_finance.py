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
#     python3 campaign-finance/ingestion/build_sb_finance.py \
#         --school-board school-board-data.json --elections election-data.json \
#         --out school-board-finance.json [--self-test] [--dry-run]
import argparse, hashlib, json, os, sys
from datetime import datetime, timezone

SCHEMA_VERSION = 1.0
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


def donor_detail(person, donors):
    """Itemized donors for a person-anchored member, plus the industry-coverage rollup.

    Coverage is carried as DATA (dollars and shares) so the ratified >=50% gate is
    computable at render and assertable at the gate, rather than recomputed in the embed."""
    rows, buckets = [], {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0}
    for did, v in (person.get("donors", {}).get("total") or {}).items():
        d = donors.get(did) or {}
        amount = round(float(v.get("amount") or 0.0), 2)
        cls = industry_class(d)
        buckets[cls] += amount
        rows.append({
            "donor_id": did,
            "name": d.get("name"),
            "type": d.get("type"),
            "amount": amount,
            "count": int(v.get("count") or 0),
            "industries": [i for i in (d.get("industries") or []) if i],
            "industry_class": cls,
        })
    rows.sort(key=lambda r: (-r["amount"], r["donor_id"]))
    total = round(sum(r["amount"] for r in rows), 2)
    buckets = {k: round(v, 2) for k, v in buckets.items()}
    shares = apportion_shares(buckets, total)
    return rows, {
        "donor_total": total,
        "donor_count": len(rows),
        "dollars": buckets,
        "shares": shares,
        # The ratified gate lives here as a computed boolean so render and gate agree.
        "substantive_share": shares["substantive"],
        "meets_industry_threshold": shares["substantive"] >= 0.50,
    }


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
        "donors": [],
        "coverage": None,
        # The ratified thinness state, carried as data rather than inferred at render.
        "has_donor_detail": False,
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
        rows, cov = donor_detail(person, donors)
        out["donors"], out["coverage"] = rows, cov
        out["has_donor_detail"] = bool(rows)
        out["finance_state"] = "full"
    else:
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
        "industry_threshold": 0.50,
        "counts": {"members": len(members), "by_finance_state": by_state},
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
    withcov = [m for m in art["members"] if m.get("coverage")]
    if withcov:
        meets = sum(1 for m in withcov if m["coverage"]["meets_industry_threshold"])
        print(f"[build_sb_finance] donor detail on {len(withcov)}; "
              f"{meets} meet the {art['industry_threshold']:.0%} industry threshold")
    if a.dry_run:
        print("[build_sb_finance] --dry-run: nothing written")
        return
    with open(a.out, "w") as fh:
        json.dump(art, fh, indent=2)
        fh.write("\n")
    print(f"[build_sb_finance] wrote {a.out}")


if __name__ == "__main__":
    main()
