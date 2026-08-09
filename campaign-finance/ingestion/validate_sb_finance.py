# validate_sb_finance.py — SBFIN-1 / HALT-SBF-A, A.3. The finance artifact's examination.
#
# Check names are STABLE: SBF-1..SBF-13. A rename is a lane decision, not an edit,
# because the gate line and the lane reports cite them. SBFIN-2 A.3 ADDED names (9..13)
# rather than repointing existing ones, so every pre-existing citation still resolves.
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
#   SBF-9  (SBFIN-2 A.3) the F1 identity: a donor list whose basis differs from the Raised
#          figure it renders beside. F1 shipped because nothing asserted that the two
#          agreed. SBF-9a asserts they do; SBF-9b asserts they are not the OTHER basis
#          (direct + self_funding), so the defect cannot return by the same route. The
#          pair is deliberate — 9a alone would pass on a list that is right by luck in the
#          members whose self-funding happens to be zero.
#   SBF-10 (SBFIN-2 A.3) itemized rows: every one dated, and each donor's rows summing and
#          counting to that donor's per-election aggregate — a cross-source reconciliation
#          between this builder's own contributions scan and build_rollups' by_election.
#
#     python3 campaign-finance/ingestion/validate_sb_finance.py \
#         school-board-finance.json [--elections election-data.json] [--self-test]
import argparse, json, re, sys

STREAMS = ("direct", "self_funding", "ie_support", "ie_oppose")
# Any key whose value equals a sum of two or more streams would be a fused total; these
# names are additionally banned outright so one cannot be introduced with a zero value and
# populated later.
BANNED_TOTAL_KEYS = {"total", "combined", "all", "raised", "total_raised", "funded",
                     "grand_total", "money", "sum"}
CENT = 0.005
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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
        # Still keyed to the SUPERSEDED flat list, which is what has_donor_detail tracks
        # until HALT-SBF2-B removes it. Names are stable: this check is unchanged.
        r.ok(f"SBF-6 seat {seat}: donor detail iff person-anchored",
             bool(m.get("has_donor_detail")) == (kind == "person" and bool(m.get("donors"))),
             f"kind={kind} has_donor_detail={m.get('has_donor_detail')} n={len(m.get('donors') or [])}")

        # SBF-6b — the SBFIN-2 shape. NOT `or {}`: an empty LIST is falsy, and coercing it
        # would hide exactly the pre-SBFIN-2 shape this check exists to catch.
        dmap = {} if m.get("donors_by_election") is None else m["donors_by_election"]
        r.ok(f"SBF-6b seat {seat}: donors_by_election is a map, never a flat list",
             isinstance(dmap, dict), f"got {type(dmap).__name__}")

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

        # SBF-7 / SBF-8 — coverage reconciliation on the SUPERSEDED flat pair. Unchanged
        # names, unchanged semantics; removed with the keys at HALT-SBF2-B.
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
            r.ok(f"SBF-8 seat {seat}: threshold flag agrees with substantive share",
                 bool(cov["meets_industry_threshold"]) ==
                 (float(cov["substantive_share"]) >= float(art.get("industry_threshold", 0.5))),
                 f"share={cov['substantive_share']} flag={cov['meets_industry_threshold']}")

        # SBF-13 — the same reconciliation on the per-election pair, which is the basis
        # the render moves to at B. Distinct names because the two coexist for one commit.
        covmap = m.get("coverage_by_election") or {}
        r.ok(f"SBF-13e seat {seat}: coverage_by_election is a map",
             isinstance(covmap, dict), f"got {type(covmap).__name__}")
        for election, cv in (covmap.items() if isinstance(covmap, dict) else []):
            # A flat coverage record iterates as scalars here; report the shape rather
            # than raising, so a wrong-shaped artifact yields a finding not a traceback.
            if not isinstance(cv, dict) or "dollars" not in cv:
                r.ok(f"SBF-13f seat {seat}: coverage_by_election['{election}'] is a record",
                     False, f"got {type(cv).__name__} — flat (pre-SBFIN-2) coverage shape?")
                continue
            rows = (dmap.get(election) or []) if isinstance(dmap, dict) else []
            rowsum = round(sum(float(x["amount"]) for x in rows), 2)
            bucketsum = round(sum(float(v) for v in cv["dollars"].values()), 2)
            r.ok(f"SBF-13a seat {seat} {election}: coverage dollars sum to donor total",
                 abs(bucketsum - float(cv["donor_total"])) < CENT,
                 f"buckets={bucketsum} total={cv['donor_total']}")
            r.ok(f"SBF-13b seat {seat} {election}: donor rows sum to donor total",
                 abs(rowsum - float(cv["donor_total"])) < CENT,
                 f"rows={rowsum} total={cv['donor_total']}")
            r.ok(f"SBF-13c seat {seat} {election}: donor count matches rows",
                 int(cv["donor_count"]) == len(rows))
            sh = sum(float(v) for v in cv["shares"].values())
            r.ok(f"SBF-13d seat {seat} {election}: shares sum to 1",
                 abs(sh - 1.0) < 1e-6 or not rows, f"shares sum={sh}")
            r.ok(f"SBF-13g seat {seat} {election}: threshold flag agrees with its share",
                 bool(cv["meets_industry_threshold"]) ==
                 (float(cv["substantive_share"]) >= float(art.get("industry_threshold", 0.5))),
                 f"share={cv['substantive_share']} flag={cv['meets_industry_threshold']}")

        # ---- SBF-9 — the F1 identity, made unrepresentable -----------------------
        # The defect: a donor list on one basis rendered beside a Raised figure on
        # another. 9a pins the list to `direct`. 9b proves it is not the other basis,
        # and fires only where self_funding is non-zero, because where it is zero the
        # two bases coincide and the check would assert nothing.
        elections = m.get("elections") or {}
        if isinstance(dmap, dict) and m.get("finance_state") == "full":
            r.ok(f"SBF-9c seat {seat}: donor elections == figure elections",
                 set(dmap) == set(elections),
                 f"donors={sorted(dmap)} elections={sorted(elections)}")
            for election, e in elections.items():
                rows = dmap.get(election) or []
                rowsum = round(sum(float(x["amount"]) for x in rows), 2)
                direct = round(float(e["direct"]["amount"]), 2)
                selff = round(float(e["self_funding"]["amount"]), 2)
                r.ok(f"SBF-9a seat {seat} {election}: donor rows sum EXACTLY to direct",
                     abs(rowsum - direct) < CENT, f"rows={rowsum} direct={direct}")
                if selff > 0:
                    r.ok(f"SBF-9b seat {seat} {election}: donor rows are NOT direct+self_funding",
                         abs(rowsum - round(direct + selff, 2)) >= CENT,
                         f"rows={rowsum} direct+self={round(direct + selff, 2)}")
                # SBF-9d — the donor-grain drop's sufficiency condition.
                selfids = set(m.get("self_funder_donor_ids") or [])
                bleed = selfids & {x["donor_id"] for x in rows}
                r.ok(f"SBF-9d seat {seat} {election}: no self-funder appears as a donor row",
                     not bleed, f"bleed={sorted(bleed)}")
            # SBF-11 — the census's residual-$0.00 property, asserted rather than recalled.
            allrows = round(sum(float(x["amount"]) for v in dmap.values() for x in v), 2)
            alldirect = round(sum(float(e["direct"]["amount"]) for e in elections.values()), 2)
            r.ok(f"SBF-11 seat {seat}: per-election donor sums reconstruct total direct",
                 abs(allrows - alldirect) < CENT, f"rows={allrows} direct={alldirect}")

        # ---- SBF-10 — itemized rows -------------------------------------------
        for election, rows in (dmap.items() if isinstance(dmap, dict) else []):
            for x in rows:
                items = x.get("items")
                did = x.get("donor_id")
                r.ok(f"SBF-10a seat {seat} {election} {did}: itemized rows present",
                     isinstance(items, list) and len(items) > 0, f"items={items!r}")
                if not isinstance(items, list):
                    continue
                bad = [i.get("date") for i in items
                       if not (isinstance(i.get("date"), str) and ISO_DATE.match(i["date"]))]
                r.ok(f"SBF-10b seat {seat} {election} {did}: every item dated ISO",
                     not bad, f"bad dates {bad}")
                isum = round(sum(float(i.get("amount") or 0.0) for i in items), 2)
                r.ok(f"SBF-10c seat {seat} {election} {did}: items sum to the donor amount",
                     abs(isum - round(float(x["amount"]), 2)) < CENT,
                     f"items={isum} donor={x['amount']}")
                r.ok(f"SBF-10d seat {seat} {election} {did}: item count equals the donor count",
                     len(items) == int(x.get("count") or -1),
                     f"items={len(items)} count={x.get('count')}")
                r.ok(f"SBF-10e seat {seat} {election} {did}: no item carries is_self",
                     not any("is_self" in i for i in items),
                     "is_self is structurally false after the donor-grain drop")

    r.ok("SBF-1e ratified population: 13 person / 3 candidate / 4 none / 1 vacancy",
         kinds.get("person") == 13 and kinds.get("candidate") == 3
         and kinds.get("none") == 4 and kinds.get("vacancy") == 1, str(kinds))

    # SBF-12 — the artifact's own counts are a recount, not a claim. A number in a header
    # that nothing re-derives is a number that drifts silently.
    counts = art.get("counts") or {}
    dmaps = [m.get("donors_by_election") for m in members]
    dmaps = [d for d in dmaps if isinstance(d, dict)]
    n_donor = sum(len(v) for d in dmaps for v in d.values())
    n_items = sum(len(x.get("items") or []) for d in dmaps for v in d.values() for x in v)
    r.ok("SBF-12a counts.donor_rows equals the recount",
         int(counts.get("donor_rows", -1)) == n_donor,
         f"header={counts.get('donor_rows')} recount={n_donor}")
    r.ok("SBF-12b counts.itemized_rows equals the recount",
         int(counts.get("itemized_rows", -1)) == n_items,
         f"header={counts.get('itemized_rows')} recount={n_items}")

    # SBF-9e — the self-funder set re-derived from the SOURCE, not trusted from the
    # artifact. This is the check that would catch a builder that simply forgot to drop:
    # SBF-9d only proves the artifact is internally consistent with its own list.
    if ed:
        comms = ed.get("committees", {})
        for m in members:
            if m.get("finance_state") != "full":
                continue
            want = set(m.get("candidacies") or [])
            slugs = {s for s, cm in comms.items() if cm.get("candidate_id") in want}
            src_self = {c["donor_id"] for c in ed.get("contributions", [])
                        if c.get("committee_id") in slugs and c.get("is_self")}
            rowids = {x["donor_id"] for v in (m.get("donors_by_election") or {}).values() for x in v}
            r.ok(f"SBF-9e seat {m.get('seat')}: source self-funders absent from donor rows",
                 not (src_self & rowids), f"leaked {sorted(src_self & rowids)}")
            r.ok(f"SBF-9f seat {m.get('seat')}: recorded self-funder set equals the source",
                 set(m.get("self_funder_donor_ids") or []) == src_self,
                 f"artifact={sorted(m.get('self_funder_donor_ids') or [])} source={sorted(src_self)}")
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
         "has_donor_detail": False, "donors": {}, "coverage": {}, "elections": {
             "2024": {"label": "L", "direct": {"amount": 10.0, "count": 1},
                      "self_funding": {"amount": 5.0, "count": 0},
                      "ie_support": {"amount": 0.0, "count": 0},
                      "ie_oppose": {"amount": 0.0, "count": 0}, "candidacies": ["a-1"]}}}]}

    # A person-anchored member whose donor rows are CORRECT: they sum to direct (10.0),
    # exclude the self-funder, and each row's items reconcile. Every SBF-9/10 case below
    # perturbs exactly one property of this, so a pass means the check saw that property.
    def person_member(**over):
        mm = {"seat": "2A", "name": "P", "candidacy_ref": "person-p", "ref_kind": "person",
              "finance_state": "full", "has_donor_detail": True,
              "self_funder_donor_ids": ["d-self"],
              "donors": [{"donor_id": "d-give", "amount": 15.0, "count": 3,
                          "industry_class": "substantive"}],
              "coverage": {"donor_total": 15.0, "donor_count": 1,
                           "dollars": {"substantive": 15.0, "individual_only": 0.0,
                                       "unclassified": 0.0},
                           "shares": {"substantive": 1.0, "individual_only": 0.0,
                                      "unclassified": 0.0},
                           "substantive_share": 1.0, "meets_industry_threshold": True},
              "donors_by_election": {"2024": [{"donor_id": "d-give", "amount": 10.0, "count": 2,
                                   "industry_class": "substantive",
                                   "items": [{"date": "2024-01-02", "amount": 6.0},
                                             {"date": "2024-02-03", "amount": 4.0}]}]},
              "coverage_by_election": {"2024": {"donor_total": 10.0, "donor_count": 1,
                                    "dollars": {"substantive": 10.0, "individual_only": 0.0,
                                                "unclassified": 0.0},
                                    "shares": {"substantive": 1.0, "individual_only": 0.0,
                                               "unclassified": 0.0},
                                    "substantive_share": 1.0,
                                    "meets_industry_threshold": True}},
              "elections": {"2024": {"label": "L", "direct": {"amount": 10.0, "count": 2},
                                     "self_funding": {"amount": 5.0, "count": 1},
                                     "ie_support": {"amount": 0.0, "count": 0},
                                     "ie_oppose": {"amount": 0.0, "count": 0},
                                     "candidacies": ["a-1"]}}}
        mm.update(over)
        return mm
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
    t.append(("SBF-8 bites: a flat threshold flag disagreeing with its share fails",
              any(not ok and n.startswith("SBF-8") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "coverage": {
                      "donor_total": 0.0, "donor_count": 0,
                      "dollars": {"substantive": 0.0, "individual_only": 0.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 0.1, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 0.1, "meets_industry_threshold": True}}]}).checks)))
    t.append(("SBF-13g bites: a per-election threshold flag disagreeing with its share fails",
              any(not ok and n.startswith("SBF-13g") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "coverage_by_election": {"2024": {
                      "donor_total": 0.0, "donor_count": 0,
                      "dollars": {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0},
                      "shares": {"substantive": 0.1, "individual_only": 0.0, "unclassified": 0.0},
                      "substantive_share": 0.1, "meets_industry_threshold": True}}}]}).checks)))
    t.append(("SBF-13f bites: a flat coverage_by_election record fails as a shape error",
              any(not ok and n.startswith("SBF-13f") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "coverage_by_election": {
                      "donor_total": 0.0, "donor_count": 0,
                      "dollars": {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0},
                      "shares": {"substantive": 1.0, "individual_only": 0.0, "unclassified": 0.0},
                      "substantive_share": 1.0, "meets_industry_threshold": True}}]}).checks)))
    t.append(("SBF-13b bites: donor rows not summing to the coverage total fails",
              any(not ok and n.startswith("SBF-13b") for n, ok, _ in
                  run({**base, "members": [person_member(coverage_by_election={"2024": {
                      "donor_total": 99.0, "donor_count": 1,
                      "dollars": {"substantive": 99.0, "individual_only": 0.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 1.0, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 1.0, "meets_industry_threshold": True}})]}).checks)))

    # ---- SBFIN-2 A.3: the F1 identity and the itemized rows ---------------------
    t.append(("the correct person shape raises NO SBF-9/10 error",
              not any(not ok and (n.startswith("SBF-9") or n.startswith("SBF-10"))
                      for n, ok, _ in run({**base, "members": [person_member()]}).checks)))
    # F1 itself, as a test case: donor rows on the direct+self_funding basis.
    f1 = person_member(donors_by_election={"2024": [{"donor_id": "d-give", "amount": 10.0, "count": 2,
                                         "industry_class": "substantive",
                                         "items": [{"date": "2024-01-02", "amount": 6.0},
                                                   {"date": "2024-02-03", "amount": 4.0}]},
                                        {"donor_id": "d-self", "amount": 5.0, "count": 1,
                                         "industry_class": "individual_only",
                                         "items": [{"date": "2024-03-04", "amount": 5.0}]}]})
    f1res = run({**base, "members": [f1]}).checks
    t.append(("SBF-9a bites: the F1 shape (rows == direct + self_funding) fails",
              any(not ok and n.startswith("SBF-9a") for n, ok, _ in f1res)))
    t.append(("SBF-9d bites: the F1 shape leaks a self-funder into the donor rows",
              any(not ok and n.startswith("SBF-9d") for n, ok, _ in f1res)))
    t.append(("SBF-9b bites: rows equal to direct+self_funding fail the not-that-basis check",
              any(not ok and n.startswith("SBF-9b") for n, ok, _ in
                  run({**base, "members": [person_member(elections={"2024": {
                      "label": "L", "direct": {"amount": 5.0, "count": 1},
                      "self_funding": {"amount": 5.0, "count": 1},
                      "ie_support": {"amount": 0.0, "count": 0},
                      "ie_oppose": {"amount": 0.0, "count": 0},
                      "candidacies": ["a-1"]}})]}).checks)))
    t.append(("SBF-9b is silent where self_funding is zero (it would assert nothing)",
              not any(n.startswith("SBF-9b") for n, ok, _ in
                      run({**base, "members": [person_member(elections={"2024": {
                          "label": "L", "direct": {"amount": 10.0, "count": 2},
                          "self_funding": {"amount": 0.0, "count": 0},
                          "ie_support": {"amount": 0.0, "count": 0},
                          "ie_oppose": {"amount": 0.0, "count": 0},
                          "candidacies": ["a-1"]}})]}).checks)))
    t.append(("SBF-9c bites: a donor election the figures do not know fails",
              any(not ok and n.startswith("SBF-9c") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={
                      "2024": person_member()["donors_by_election"]["2024"], "2099": []})]}).checks)))
    t.append(("SBF-11 bites: per-election sums not reconstructing total direct fails",
              any(not ok and n.startswith("SBF-11") for n, ok, _ in f1res)))
    t.append(("SBF-10a bites: a donor row with no itemized rows fails",
              any(not ok and n.startswith("SBF-10a") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 2,
                       "industry_class": "substantive", "items": []}]})]}).checks)))
    t.append(("SBF-10b bites: an undated item fails",
              any(not ok and n.startswith("SBF-10b") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 2,
                       "industry_class": "substantive",
                       "items": [{"date": None, "amount": 6.0},
                                 {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-10c bites: items not summing to the donor amount fails",
              any(not ok and n.startswith("SBF-10c") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 2,
                       "industry_class": "substantive",
                       "items": [{"date": "2024-01-02", "amount": 6.0},
                                 {"date": "2024-02-03", "amount": 999.0}]}]})]}).checks)))
    t.append(("SBF-10d bites: an item count disagreeing with the donor count fails",
              any(not ok and n.startswith("SBF-10d") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 7,
                       "industry_class": "substantive",
                       "items": [{"date": "2024-01-02", "amount": 6.0},
                                 {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-10e bites: an item carrying is_self fails",
              any(not ok and n.startswith("SBF-10e") for n, ok, _ in
                  run({**base, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 2,
                       "industry_class": "substantive",
                       "items": [{"date": "2024-01-02", "amount": 6.0, "is_self": False},
                                 {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-6b bites: a populated flat donors_by_election (the pre-A shape) fails",
              any(not ok and n.startswith("SBF-6b") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "donors_by_election": [
                      {"donor_id": "d", "amount": 1.0, "count": 1}]}]}).checks)))
    t.append(("SBF-6b bites on an EMPTY flat list too (falsy, and the coercion trap)",
              any(not ok and n.startswith("SBF-6b") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0],
                                            "donors_by_election": []}]}).checks)))
    t.append(("SBF-12a bites: a header donor_rows count that lies fails",
              any(not ok and n.startswith("SBF-12a") for n, ok, _ in
                  run({**base, "counts": {"donor_rows": 999, "itemized_rows": 3},
                       "members": [person_member()]}).checks)))
    t.append(("SBF-12b bites: a header itemized_rows count that lies fails",
              any(not ok and n.startswith("SBF-12b") for n, ok, _ in
                  run({**base, "counts": {"donor_rows": 1, "itemized_rows": 999},
                       "members": [person_member()]}).checks)))
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
