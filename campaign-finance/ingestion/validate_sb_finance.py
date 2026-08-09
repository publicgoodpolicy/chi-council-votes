# validate_sb_finance.py — SBFIN-1 / HALT-SBF-A, A.3. The finance artifact's examination.
#
# Check names are STABLE: SBF-1..SBF-8. A rename is a lane decision, not an edit, because
# the gate line and the lane reports cite them.
#
# What this exists to catch, in order of how badly it would hurt:
#   SBF-5  a fused stream total appearing anywhere in the artifact — the firewall's
#          structural assert, and the one the council's own Spend-by-Alder surface lacks
#          (G1b S2-a). Nothing else in this repo would notice.
#   SBF-4  a figure drifting from its by_candidate_election source, or being sourced from
#          by_candidate, whose committee-lifetime values inflate a labeled election (S2-b).
#   SBF-2  an inc- placeholder accepted as a resolution — 55 of them exist, they carry no
#          committee and no money, and they look like real ids (G1b/G1 R3-b).
#   SBF-3  a member anchored at kind (b) who HAS a by_person entry — silent thinning.
#
#     python3 campaign-finance/ingestion/validate_sb_finance.py \
#         school-board-finance.json [--elections election-data.json] [--self-test]
import argparse, json, sys

STREAMS = ("direct", "self_funding", "ie_support", "ie_oppose")
# Any key whose value equals a sum of two or more streams would be a fused total; these
# names are additionally banned outright so one cannot be introduced with a zero value and
# populated later.
BANNED_TOTAL_KEYS = {"total", "combined", "all", "raised", "total_raised", "funded",
                     "grand_total", "money", "sum"}
CENT = 0.005


class R:
    def __init__(self):
        self.errors, self.checks = [], []

    def ok(self, name, cond, detail=""):
        self.checks.append((name, bool(cond), detail))
        if not cond:
            self.errors.append(f"{name}: {detail}" if detail else name)
        return bool(cond)


def _subset_sums(vals):
    """Every sum of 2+ of the four stream amounts."""
    out = []
    n = len(vals)
    for mask in range(1, 1 << n):
        if bin(mask).count("1") < 2:
            continue
        out.append(round(sum(vals[i] for i in range(n) if mask >> i & 1), 2))
    return out


def validate(art, ed=None):
    r = R()
    members = art.get("members", [])
    r.ok("SBF-1a member count is 21", len(members) == 21, f"got {len(members)}")

    cand_ids = set()
    bp = bce = None
    if ed:
        cand_ids = {c["id"] for c in ed.get("candidates", [])}
        bp = ed["rollups"].get("by_person", {})
        bce = ed["rollups"].get("by_candidate_election", {})

    kinds = {}
    for m in members:
        seat = m.get("seat")
        ref, kind = m.get("candidacy_ref", ""), m.get("ref_kind")
        kinds[kind] = kinds.get(kind, 0) + 1

        # SBF-1 — the three-way sentinel plus the vacancy blank, and nothing else.
        r.ok(f"SBF-1 seat {seat}: ref is one of the ratified kinds",
             kind in ("person", "candidate", "none", "vacancy"), f"kind={kind!r}")
        if kind == "vacancy":
            r.ok(f"SBF-1b seat {seat}: only a vacancy may be blank",
                 (m.get("name") or "").strip() == "", "blank ref on a named member")

        # SBF-2 — inc- is fatal, always, in any kind.
        r.ok(f"SBF-2 seat {seat}: ref is not an inc- placeholder",
             not ref.startswith("inc-"), f"ref={ref!r}")

        if ed and kind == "candidate":
            # No id-shape assumption: resolution is membership in candidates[].id, not a
            # prefix test (17/148 carry `cand-`).
            r.ok(f"SBF-1c seat {seat}: candidate ref resolves in candidates[].id",
                 ref in cand_ids, f"ref={ref!r}")
            # SBF-3 — the richest-anchor rule. A kind (b) ref for someone who has a
            # by_person entry silently thins that member.
            inp = [p for p, v in bp.items()
                   if any(x["candidacy_id"] == ref for x in v.get("members", []))]
            r.ok(f"SBF-3 seat {seat}: kind (b) only where no by_person entry exists",
                 not inp, f"ref {ref!r} appears in by_person {inp}")
        if ed and kind == "person":
            r.ok(f"SBF-1d seat {seat}: person ref resolves in rollups.by_person",
                 ref in bp, f"ref={ref!r}")

        # SBF-6 — donor detail presence must equal by_person membership, both ways.
        r.ok(f"SBF-6 seat {seat}: donor detail iff person-anchored",
             bool(m.get("has_donor_detail")) == (kind == "person" and bool(m.get("donors"))),
             f"kind={kind} has_donor_detail={m.get('has_donor_detail')} n={len(m.get('donors') or [])}")

        for election, e in (m.get("elections") or {}).items():
            vals = [round(float(e[s]["amount"]), 2) for s in STREAMS]

            # SBF-5 — structural streams-separate. No key in the election record may hold
            # a sum of two or more streams, and no total-shaped key may exist at all.
            banned = BANNED_TOTAL_KEYS & set(e)
            r.ok(f"SBF-5a seat {seat} {election}: no total-shaped key",
                 not banned, f"found {sorted(banned)}")
            sums = set(_subset_sums(vals))
            offenders = []
            for k, v in e.items():
                if k in ("label", "candidacies"):
                    continue
                amt = v.get("amount") if isinstance(v, dict) else v
                if not isinstance(amt, (int, float)):
                    continue
                if k not in STREAMS and any(abs(amt - s) < CENT for s in sums if s):
                    offenders.append(k)
            r.ok(f"SBF-5b seat {seat} {election}: no field equals a sum of streams",
                 not offenders, f"fields {offenders}")

            # SBF-4 — every figure equals its by_candidate_election source, unrounded.
            if bce is not None:
                exp = {s: 0.0 for s in STREAMS}
                expc = {s: 0 for s in STREAMS}
                for cid in e.get("candidacies", []):
                    rec = (bce.get(cid) or {}).get(election) or {}
                    for src, dst in (("contributions", "direct"), ("self_funding", "self_funding"),
                                     ("ie_support", "ie_support"), ("ie_oppose", "ie_oppose")):
                        exp[dst] += float((rec.get(src) or {}).get("amount") or 0.0)
                        expc[dst] += int((rec.get(src) or {}).get("count") or 0)
                for s in STREAMS:
                    r.ok(f"SBF-4 seat {seat} {election} {s}: equals by_candidate_election source",
                         abs(float(e[s]["amount"]) - round(exp[s], 2)) < CENT,
                         f"artifact={e[s]['amount']} source={round(exp[s], 2)}")
                    r.ok(f"SBF-4c seat {seat} {election} {s}: count equals source",
                         int(e[s]["count"]) == expc[s],
                         f"artifact={e[s]['count']} source={expc[s]}")

        # SBF-7 — coverage buckets must reconcile to the donor rows exactly.
        cov = m.get("coverage")
        if cov:
            rows = m.get("donors") or []
            rowsum = round(sum(float(x["amount"]) for x in rows), 2)
            bucketsum = round(sum(float(v) for v in cov["dollars"].values()), 2)
            r.ok(f"SBF-7a seat {seat}: coverage dollars sum to donor total",
                 abs(bucketsum - float(cov["donor_total"])) < CENT,
                 f"buckets={bucketsum} total={cov['donor_total']}")
            r.ok(f"SBF-7b seat {seat}: donor rows sum to donor total",
                 abs(rowsum - float(cov["donor_total"])) < CENT,
                 f"rows={rowsum} total={cov['donor_total']}")
            r.ok(f"SBF-7c seat {seat}: donor count matches rows",
                 int(cov["donor_count"]) == len(rows))
            sh = sum(float(v) for v in cov["shares"].values())
            r.ok(f"SBF-7d seat {seat}: shares sum to 1", abs(sh - 1.0) < 1e-6 or not rows,
                 f"shares sum={sh}")
            # SBF-8 — the ratified threshold boolean must agree with its own share.
            r.ok(f"SBF-8 seat {seat}: threshold flag agrees with substantive share",
                 bool(cov["meets_industry_threshold"]) ==
                 (float(cov["substantive_share"]) >= float(art.get("industry_threshold", 0.5))),
                 f"share={cov['substantive_share']} flag={cov['meets_industry_threshold']}")

    r.ok("SBF-1e ratified population: 13 person / 3 candidate / 4 none / 1 vacancy",
         kinds.get("person") == 13 and kinds.get("candidate") == 3
         and kinds.get("none") == 4 and kinds.get("vacancy") == 1, str(kinds))
    # SBF-5c — the ban applies to the whole document, not only election records.
    blob = json.dumps(art)
    r.ok("SBF-5c no total-shaped key anywhere in the artifact",
         not any(f'"{k}"' in blob for k in BANNED_TOTAL_KEYS), "scan of serialized artifact")
    return r


def self_test():
    """Each case proves a check BITES — a validator whose failure path never runs is a
    green that means nothing (the validate_votes false-green lesson, SBVOTE-1 HALT-A)."""
    base = {"industry_threshold": 0.5, "members": [
        {"seat": "1A", "name": "X", "candidacy_ref": "a-1", "ref_kind": "candidate",
         "has_donor_detail": False, "donors": [], "elections": {
             "2024": {"label": "L", "direct": {"amount": 10.0, "count": 1},
                      "self_funding": {"amount": 5.0, "count": 0},
                      "ie_support": {"amount": 0.0, "count": 0},
                      "ie_oppose": {"amount": 0.0, "count": 0}, "candidacies": ["a-1"]}}}]}
    t = []

    def run(art):
        return validate(json.loads(json.dumps(art)), ed=None)

    t.append(("SBF-5b bites: a field equal to direct+self_funding fails",
              any(not ok and n.startswith("SBF-5b") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "elections": {
                      "2024": {**base["members"][0]["elections"]["2024"],
                               "headline": {"amount": 15.0}}}}]}).checks)))
    t.append(("SBF-5a bites: a total-shaped key fails",
              any(not ok and n.startswith("SBF-5a") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "elections": {
                      "2024": {**base["members"][0]["elections"]["2024"],
                               "total": {"amount": 999.0}}}}]}).checks)))
    t.append(("SBF-2 bites: an inc- ref fails",
              any(not ok and n.startswith("SBF-2") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0],
                                            "candidacy_ref": "inc-sb-d13"}]}).checks)))
    t.append(("SBF-1 bites: an unknown kind fails",
              any(not ok and n.startswith("SBF-1 ") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "ref_kind": "wat"}]}).checks)))
    t.append(("SBF-6 bites: claimed donor detail with no rows fails",
              any(not ok and n.startswith("SBF-6") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0],
                                            "has_donor_detail": True}]}).checks)))
    t.append(("SBF-8 bites: a threshold flag disagreeing with its share fails",
              any(not ok and n.startswith("SBF-8") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "coverage": {
                      "donor_total": 0.0, "donor_count": 0,
                      "dollars": {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0},
                      "shares": {"substantive": 0.1, "individual_only": 0.0, "unclassified": 0.0},
                      "substantive_share": 0.1, "meets_industry_threshold": True}}]}).checks)))
    t.append(("SBF-7b bites: donor rows not summing to the total fails",
              any(not ok and n.startswith("SBF-7b") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "ref_kind": "person",
                      "has_donor_detail": True,
                      "donors": [{"donor_id": "d", "amount": 5.0, "count": 1}],
                      "coverage": {"donor_total": 99.0, "donor_count": 1,
                                   "dollars": {"substantive": 99.0, "individual_only": 0.0,
                                               "unclassified": 0.0},
                                   "shares": {"substantive": 1.0, "individual_only": 0.0,
                                              "unclassified": 0.0},
                                   "substantive_share": 1.0,
                                   "meets_industry_threshold": True}}]}).checks)))
    t.append(("SBF-1e bites: a wrong population split fails",
              any(not ok and n.startswith("SBF-1e") for n, ok, _ in run(base).checks)))
    t.append(("clean minimal artifact raises no SBF-5 error",
              not any(not ok and n.startswith("SBF-5") for n, ok, _ in run(base).checks)))
    t.append(("_subset_sums covers all 2+ combinations", len(_subset_sums([1, 2, 4, 8])) == 11))

    fails = 0
    for name, ok in t:
        print(("SELF-TEST PASS  " if ok else "SELF-TEST FAIL  ") + name)
        fails += (not ok)
    print(f"self-test: {len(t)} checks · " + ("ALL PASS" if not fails else f"FAILED {fails}"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description="Validate school-board-finance.json (SBFIN-1 A.3).")
    ap.add_argument("artifact", nargs="?", default="school-board-finance.json")
    ap.add_argument("--elections", default="election-data.json",
                    help="cross-check figures against their source; omit to skip SBF-4/1c/1d/3")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="print every executed check")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())

    art = json.load(open(a.artifact))
    ed = None
    try:
        ed = json.load(open(a.elections))
    except OSError:
        print(f"[validate_sb_finance] NOTE: {a.elections} not readable; "
              f"source cross-checks skipped", file=sys.stderr)
    r = validate(art, ed)
    if a.verbose:
        for n, ok, d in r.checks:
            print(("  PASS " if ok else "  FAIL ") + n + ((" — " + d) if d and not ok else ""))
    for e in r.errors:
        print("[validate_sb_finance] ERROR " + e, file=sys.stderr)
    print(f"[validate_sb_finance] {len(r.checks)} checks · "
          + (f"OK: 0 errors" if not r.errors else f"FAILED {len(r.errors)}"))
    sys.exit(1 if r.errors else 0)


if __name__ == "__main__":
    main()
