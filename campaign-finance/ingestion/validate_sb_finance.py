# validate_sb_finance.py — SBFIN-1 / HALT-SBF-A, A.3. The finance artifact's examination.
#
# Check names are STABLE: SBF-1..SBF-16. A rename is a lane decision, not an edit,
# because the gate line and the lane reports cite them. SBFIN-2 A.3 ADDED names (9..13)
# rather than repointing existing ones, so every pre-existing citation still resolves.
#
# RETIRED at SBFIN-2 B, with the flat `donors`/`coverage` pair they read:
#   SBF-6      -> semantic reinstated as SBF-6c on donors_by_election
#   SBF-7a-d   -> semantics reinstated as SBF-13a-d on coverage_by_election
#   SBF-8      -> semantic reinstated as SBF-13g on coverage_by_election
# Nothing was dropped: each retired name's rule is asserted on the new basis, and SBF-14
# asserts the retired keys stay gone so they cannot return unguarded. A check disappearing
# needs the same accounting as one appearing.
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
import argparse, hashlib, json, os, re, sys

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

        # SBF-6b — the SBFIN-2 shape. NOT `or {}`: an empty LIST is falsy, and coercing it
        # would hide exactly the pre-SBFIN-2 shape this check exists to catch.
        dmap = {} if m.get("donors_by_election") is None else m["donors_by_election"]
        r.ok(f"SBF-6b seat {seat}: donors_by_election is a map, never a flat list",
             isinstance(dmap, dict), f"got {type(dmap).__name__}")

        # SBF-6c — SBF-6's SEMANTIC, reinstated on the new basis. SBF-6 itself was retired
        # at HALT-SBF2-B with the flat list it read, but "donor detail iff person-anchored"
        # was never a property OF that list — only measured through it. Retiring the check
        # without reinstating the rule would have been coverage loss wearing the costume of
        # coverage retirement.
        n_rows = sum(len(v) for v in dmap.values()) if isinstance(dmap, dict) else -1
        r.ok(f"SBF-6c seat {seat}: donor detail iff person-anchored",
             bool(m.get("has_donor_detail")) == (kind == "person" and n_rows > 0),
             f"kind={kind} has_donor_detail={m.get('has_donor_detail')} rows={n_rows}")

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

        # SBF-7a-d and SBF-8 were RETIRED at HALT-SBF2-B with the flat `donors`/`coverage`
        # pair they read. Their semantics are not lost: SBF-13a-d and SBF-13g assert the
        # identical properties on the per-election pair, which is now the only basis.
        # SBF-14 — the retirement made structural. If the flat pair ever comes back, the
        # checks that guarded it are gone, so say so here rather than let it return
        # unguarded.
        r.ok(f"SBF-14 seat {seat}: the superseded flat donors/coverage pair is absent",
             "donors" not in m and "coverage" not in m,
             f"found {[k for k in ('donors', 'coverage') if k in m]}")

        # SBF-13 — the coverage reconciliation, per election.
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

    # SBF-15 — the vocabulary slices. A label the render cannot resolve is a raw internal
    # key shown to a reader (the F2 shape, one artifact over), so resolvability is asserted
    # rather than hoped for; and a cluster_id pointing at nothing is a referential defect,
    # not an empty panel.
    vocab = art.get("industry_tags") or {}
    used_inds, used_clusters = set(), set()
    for d in dmaps:
        for v in d.values():
            for x in v:
                used_inds.update(x.get("industries") or [])
                if x.get("cluster_id"):
                    used_clusters.add(x["cluster_id"])
    r.ok("SBF-15a every industry on a donor row has a vocabulary entry",
         not (used_inds - set(vocab)), f"missing {sorted(used_inds - set(vocab))}")
    r.ok("SBF-15b every vocabulary entry carries a label and a colour",
         all(v.get("label") and v.get("color") for v in vocab.values()),
         f"incomplete {sorted(k for k, v in vocab.items() if not (v.get('label') and v.get('color')))}")
    r.ok("SBF-15c the vocabulary carries no unused entries",
         not (set(vocab) - used_inds), f"unused {sorted(set(vocab) - used_inds)}")
    clusters = art.get("donor_clusters") or {}
    r.ok("SBF-15d every cluster_id on a donor row resolves",
         not (used_clusters - set(clusters)), f"dangling {sorted(used_clusters - set(clusters))}")
    r.ok("SBF-15e no donor family carries a stream-total field",
         not any(("total" in c) or ("member_totals" in c) for c in clusters.values()),
         "cluster totals are elections-wide and would trip SBF-5c")

    # ---- SBF-17 — the IE slice (SBFIN-3 A.4) --------------------------------
    ie = art.get("ie_spenders") or {}
    labels = art.get("election_labels") or {}
    member_cands = {c for m in members for c in (m.get("candidacies") or [])}
    seat_of = {c: m.get("seat") for m in members for c in (m.get("candidacies") or [])}

    # SBF-17d's oracle. NOT a second copy of the bucketing rule: the builder SELECTS a
    # bucket, this asserts CONTAINMENT of every row's date in the bucket it was filed
    # under. An independent property, which is what a validator owes.
    wins = {}
    try:
        wp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                          "elections", "election-windows.json")
        for w in (json.load(open(wp)).get("school_board") or []):
            wins[w["id"]] = (w.get("start"), w.get("end"))
    except (OSError, json.JSONDecodeError, KeyError):
        wins = {}
    r.ok("SBF-17d0 the election-windows file was readable (the containment oracle exists)",
         bool(wins), "without it SBF-17d asserts nothing")

    ie_rows_total = 0
    for ek, spenders in ie.items():
        # SBF-17d1 — the trap's front door. If the builder ever keys on `cycle` instead of
        # date, the bucket is named "2027" and every containment test below would be
        # SKIPPED for want of a window. An unknown bucket key must therefore fail loudly
        # on its own, before containment is even reachable.
        r.ok(f"SBF-17d1 {ek}: the IE bucket is a known election window, not a cycle value",
             (not wins) or ek in wins, f"known windows {sorted(wins)}")
        r.ok(f"SBF-17g {ek}: the IE bucket is a list of spenders",
             isinstance(spenders, list), f"got {type(spenders).__name__}")
        for sp in (spenders if isinstance(spenders, list) else []):
            sid = sp.get("committee_id")
            sup = round(float(sp["support"]["amount"]), 2)
            opp = round(float(sp["oppose"]["amount"]), 2)
            # SBF-17a — no fused field. The two streams may never be added into a stored
            # key, and no total-shaped name may appear at spender or target level.
            banned = BANNED_TOTAL_KEYS & set(sp)
            r.ok(f"SBF-17a {ek} {sid}: spender carries no total-shaped key",
                 not banned, f"found {sorted(banned)}")
            fused = round(sup + opp, 2)
            offenders = [k for k, v in sp.items()
                         if k not in ("support", "oppose") and isinstance(v, (int, float))
                         and fused and abs(float(v) - fused) < CENT]
            r.ok(f"SBF-17a {ek} {sid}: no spender field equals support+oppose",
                 not offenders, f"fields {offenders}")
            tsup = topp = 0.0
            tsupc = toppc = 0
            for t in (sp.get("targets") or []):
                tb = BANNED_TOTAL_KEYS & set(t)
                r.ok(f"SBF-17a {ek} {sid} {t.get('seat')}: target carries no total-shaped key",
                     not tb, f"found {sorted(tb)}")
                tf = round(float(t["support"]["amount"]) + float(t["oppose"]["amount"]), 2)
                toff = [k for k, v in t.items()
                        if k not in ("support", "oppose") and isinstance(v, (int, float))
                        and tf and abs(float(v) - tf) < CENT]
                r.ok(f"SBF-17a {ek} {sid} {t.get('seat')}: no target field equals support+oppose",
                     not toff, f"fields {toff}")
                # SBF-17c — every target is a seated member's candidacy, on that member's seat.
                r.ok(f"SBF-17c {ek} {sid} {t.get('seat')}: target resolves to a seated candidacy",
                     t.get("candidacy_id") in member_cands
                     and seat_of.get(t.get("candidacy_id")) == t.get("seat"),
                     f"candidacy={t.get('candidacy_id')} seat={t.get('seat')}")
                # SBF-17f — rows reconcile to the target's own figures, both streams.
                rs = {"support": 0.0, "oppose": 0.0}
                rc = {"support": 0, "oppose": 0}
                for row in (t.get("rows") or []):
                    st = row.get("stance")
                    r.ok(f"SBF-17h {ek} {sid} {t.get('seat')}: row stance is support or oppose",
                         st in ("support", "oppose"), f"stance={st!r}")
                    if st in rs:
                        rs[st] = round(rs[st] + float(row.get("amount") or 0.0), 2)
                        rc[st] += 1
                    # SBF-17d — the cycle/date trap, asserted by containment.
                    d = row.get("date")
                    r.ok(f"SBF-17d {ek} {sid} {t.get('seat')} {d}: row is dated ISO",
                         isinstance(d, str) and ISO_DATE.match(d or ""), f"date={d!r}")
                    if wins and ek in wins and isinstance(d, str):
                        st_, en_ = wins[ek]
                        r.ok(f"SBF-17d {ek} {sid} {t.get('seat')} {d}: date lies inside the "
                             f"election's own window",
                             (st_ is None or d >= st_) and (en_ is None or d <= en_),
                             f"window=({st_},{en_})")
                    ie_rows_total += 1
                for st in ("support", "oppose"):
                    r.ok(f"SBF-17f {ek} {sid} {t.get('seat')} {st}: rows sum to the target figure",
                         abs(rs[st] - round(float(t[st]["amount"]), 2)) < CENT,
                         f"rows={rs[st]} target={t[st]['amount']}")
                    r.ok(f"SBF-17f {ek} {sid} {t.get('seat')} {st}: row count matches",
                         rc[st] == int(t[st]["count"]), f"rows={rc[st]} target={t[st]['count']}")
                tsup = round(tsup + float(t["support"]["amount"]), 2)
                topp = round(topp + float(t["oppose"]["amount"]), 2)
                tsupc += int(t["support"]["count"]); toppc += int(t["oppose"]["count"])
            r.ok(f"SBF-17f {ek} {sid}: targets sum to the spender's support",
                 abs(tsup - sup) < CENT, f"targets={tsup} spender={sup}")
            r.ok(f"SBF-17f {ek} {sid}: targets sum to the spender's oppose",
                 abs(topp - opp) < CENT, f"targets={topp} spender={opp}")
            r.ok(f"SBF-17f {ek} {sid}: target counts sum to the spender's",
                 tsupc == int(sp["support"]["count"]) and toppc == int(sp["oppose"]["count"]),
                 f"{tsupc}/{toppc} vs {sp['support']['count']}/{sp['oppose']['count']}")

    # SBF-17b — reconcile to the SOURCE rows, not just internally.
    if ed:
        src = {}
        for x in ed.get("independent_expenditures", []):
            if x.get("target_candidate_id") not in member_cands:
                continue
            if x.get("cycle") in ("pre-2011", "undated"):
                continue
            k = x.get("spender_committee_id")
            e = src.setdefault(k, {"support": 0.0, "oppose": 0.0, "n": 0})
            st = "oppose" if x.get("stance") == "oppose" else "support"
            e[st] = round(e[st] + float(x.get("amount") or 0.0), 2)
            e["n"] += 1
        got = {}
        for spenders in ie.values():
            for sp in spenders:
                g = got.setdefault(sp["committee_id"], {"support": 0.0, "oppose": 0.0})
                g["support"] = round(g["support"] + float(sp["support"]["amount"]), 2)
                g["oppose"] = round(g["oppose"] + float(sp["oppose"]["amount"]), 2)
        r.ok("SBF-17b the spender set equals the source's", set(got) == set(src),
             f"artifact={sorted(got)} source={sorted(src)}")
        for k in sorted(set(got) & set(src)):
            for st in ("support", "oppose"):
                r.ok(f"SBF-17b {k} {st}: equals the source rows",
                     abs(got[k][st] - src[k][st]) < CENT,
                     f"artifact={got[k][st]} source={src[k][st]}")
        r.ok("SBF-17b every source IE row for a seated member is carried",
             ie_rows_total == sum(v["n"] for v in src.values()),
             f"artifact={ie_rows_total} source={sum(v['n'] for v in src.values())}")

    # SBF-17e — the RATIFIED measured totals, pinned to this vintage. Same shape as
    # SBF-1e's ratified population: it is meant to fail on a data refresh, because an
    # unexplained change in these figures is the stop, not the update (PS-85). Keyed on the
    # SBE id so a slug rename does not silently disarm it.
    RATIFIED_IE = {
        "26066": {"support": 444453.78, "oppose": 366064.00, "rows": 28},
        "39901": {"support": 375117.96, "oppose": 0.00, "rows": 49},
    }
    if ie:
        seen_ie = {}
        for spenders in ie.values():
            for sp in spenders:
                k = str(sp.get("sbe_committee_id"))
                e = seen_ie.setdefault(k, {"support": 0.0, "oppose": 0.0, "rows": 0})
                e["support"] = round(e["support"] + float(sp["support"]["amount"]), 2)
                e["oppose"] = round(e["oppose"] + float(sp["oppose"]["amount"]), 2)
                e["rows"] += sum(len(t.get("rows") or []) for t in (sp.get("targets") or []))
        r.ok("SBF-17e the ratified spender set is exactly the two measured committees",
             set(seen_ie) == set(RATIFIED_IE), f"got {sorted(seen_ie)}")
        for k, want in RATIFIED_IE.items():
            got = seen_ie.get(k)
            if got is None:
                continue
            for f in ("support", "oppose"):
                r.ok(f"SBF-17e {k} {f}: equals the ratified measured figure",
                     abs(got[f] - want[f]) < CENT, f"got={got[f]} ratified={want[f]}")
            r.ok(f"SBF-17e {k}: row count equals the ratified measured count",
                 got["rows"] == want["rows"], f"got={got['rows']} ratified={want['rows']}")
        grand = round(sum(v["support"] + v["oppose"] for v in seen_ie.values()), 2)
        grows = sum(v["rows"] for v in seen_ie.values())
        r.ok("SBF-17e the whole IE slice equals the ratified $1,185,635.74 over 77 rows",
             abs(grand - 1185635.74) < CENT and grows == 77,
             f"got ${grand} over {grows} rows")

    # SBF-18 — the election-wide label (A.3) and the bug it fixes.
    used_elections = {k for m in members for k in (m.get("elections") or {})}
    r.ok("SBF-18a election_labels covers every election a member has",
         not (used_elections - set(labels)), f"missing {sorted(used_elections - set(labels))}")
    dist = [k for k, v in labels.items() if "District" in str(v)]
    r.ok("SBF-18b no election-wide label carries a district (the R.4 regression)",
         not dist, f"district-bearing labels {dist}")

    # SBF-19 — ratification 8, asserted rather than trusted: the coverage/threshold figures
    # are DONOR-only and the IE addition did not move them. Recomputed from donor rows
    # alone and compared to what is stored.
    for m in members:
        dm = m.get("donors_by_election")
        cm = m.get("coverage_by_election")
        if not isinstance(dm, dict) or not isinstance(cm, dict):
            continue
        for ek, rows in dm.items():
            cov = cm.get(ek)
            if not isinstance(cov, dict):
                continue
            buckets = {"substantive": 0.0, "individual_only": 0.0, "unclassified": 0.0}
            for x in rows:
                buckets[x.get("industry_class", "unclassified")] = round(
                    buckets[x.get("industry_class", "unclassified")] + float(x["amount"]), 2)
            tot = round(sum(float(x["amount"]) for x in rows), 2)
            share = (buckets["substantive"] / tot) if tot else 0.0
            r.ok(f"SBF-19 seat {m.get('seat')} {ek}: coverage buckets are donor-only",
                 all(abs(buckets[k] - round(float(cov["dollars"][k]), 2)) < CENT for k in buckets),
                 f"recomputed={buckets} stored={cov['dollars']}")
            r.ok(f"SBF-19 seat {m.get('seat')} {ek}: substantive share unmoved by the IE slice",
                 abs(share - float(cov["substantive_share"])) < 1e-6,
                 f"recomputed={share} stored={cov['substantive_share']}")

    # SBF-16 — the two-step replace, closed. Asserted from the artifact, not assumed from
    # a diff: A's intermediate marker and the keys it described are both gone.
    r.ok("SBF-16a superseded_keys is absent (the two-step replace is closed)",
         "superseded_keys" not in art, "A's intermediate marker survived into B")

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


def _sha256_file(path):
    """None when the file cannot be read — the caller reports that as a SKIP, not a pass."""
    try:
        with open(path, "rb") as f:
            h = hashlib.sha256()
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
            return h.hexdigest()
    except OSError:
        return None


def sync_verdict(art, paths, sha=_sha256_file):
    """[SBF/SYNC] — the vintage assert. PURE apart from `sha`, so the self-test can drive
    every path without a filesystem.

    `build_sb_finance.py:6` states that both inputs are hashed into `_sync` "so the vintage
    is never inferred" — and until SBE-RERUN-1 this validator never read that stamp. It
    opened the finance artifact and whatever `--elections` file it was handed and compared
    their CONTENTS, with nothing establishing they were the pair the artifact was built
    from. That is the [PREVIEW/VINTAGE] shape: a build product read as a stand-in for its
    subject, with no tie between the vintages.

    It bites harder here than it did on the preview. This validator is the gate's largest
    line (7,500+ checks), and SBF-17e — the RATIFIED pinned IE totals — lives inside it. A
    contiguous truncation that skips `build_sb_finance`, which C1.11 expressly permits with
    justification, would have run every one of those checks against a stale finance
    artifact, and SBF-17e would have reported a vintage no longer in the tree. Green.

    Rules, fail-closed:
      * `_sync.inputs` absent or malformed -> FAIL. A stamp that can go missing and still
        pass is not a stamp.
      * a named input that IS readable and whose sha differs -> FAIL.
      * a named input that cannot be read -> SKIP, reported by name. `--elections` is
        documented as omittable; an unverifiable input must be visible, not silently
        treated as agreeing.
    Returns (ok, [report lines]).
    """
    sync = art.get("_sync")
    inputs = (sync or {}).get("inputs")
    if not isinstance(sync, dict) or not isinstance(inputs, dict) or not inputs:
        return False, ["SBF/SYNC: artifact carries no usable `_sync.inputs` — cannot "
                       "establish it was built from these files. Rebuild with "
                       "build_sb_finance.py."]
    lines, ok = [], True
    for name in sorted(inputs):
        want = (inputs.get(name) or {}).get("sha256")
        path = paths.get(name)
        if not want:
            ok = False
            lines.append(f"SBF/SYNC: `_sync.inputs[{name}]` carries no sha256")
            continue
        if path is None:
            ok = False
            lines.append(f"SBF/SYNC: `_sync` names input {name} but this validator was "
                         f"given no path for it")
            continue
        got = sha(path)
        if got is None:
            lines.append(f"SBF/SYNC: SKIP {name} — {path} not readable, so its stamp "
                         f"({want[:12]}…) is UNVERIFIED")
            continue
        if got != want:
            ok = False
            lines.append(f"SBF/SYNC: {name} STALE PAIR — artifact was built from "
                         f"{want[:12]}… but {path} is {got[:12]}…. Re-run "
                         f"build_sb_finance.py, or validate against the matching input.")
        else:
            lines.append(f"SBF/SYNC: {name} matches {got[:12]}…")
    return ok, lines


def self_test():
    """Each case proves a check BITES — a validator whose failure path never runs is a
    green that means nothing (the validate_votes false-green lesson, SBVOTE-1 HALT-A)."""
    base = {"industry_threshold": 0.5, "members": [
        {"seat": "1A", "name": "X", "candidacy_ref": "a-1", "ref_kind": "candidate",
         "has_donor_detail": False, "donors_by_election": {}, "elections": {
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
    # SBF-13's biting cases. These were lost to an over-greedy edit while retiring the
    # SBF-8 case and restored the moment the old/new check-name diff surfaced it — the
    # same accounting the retirements themselves get. A check whose failure path never
    # runs is a green that means nothing, and that applies to checks that KEEP their name
    # just as much as to ones that lose it.
    t.append(("SBF-13b bites: donor rows not summing to the coverage total fails",
              any(not ok and n.startswith("SBF-13b") for n, ok, _ in
                  run({**base, "members": [person_member(coverage_by_election={"2024": {
                      "donor_total": 99.0, "donor_count": 1,
                      "dollars": {"substantive": 99.0, "individual_only": 0.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 1.0, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 1.0, "meets_industry_threshold": True}})]}).checks)))
    t.append(("SBF-13f bites: a flat (pre-SBFIN-2) coverage record fails as a shape error",
              any(not ok and n.startswith("SBF-13f") for n, ok, _ in
                  run({**base, "members": [person_member(coverage_by_election={
                      "donor_total": 0.0, "donor_count": 0,
                      "dollars": {"substantive": 0.0, "individual_only": 0.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 1.0, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 1.0,
                      "meets_industry_threshold": True})]}).checks)))
    t.append(("SBF-13g bites: a threshold flag disagreeing with its share fails",
              any(not ok and n.startswith("SBF-13g") for n, ok, _ in
                  run({**base, "members": [person_member(coverage_by_election={"2024": {
                      "donor_total": 10.0, "donor_count": 1,
                      "dollars": {"substantive": 10.0, "individual_only": 0.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 0.1, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 0.1,
                      "meets_industry_threshold": True}})]}).checks)))
    t.append(("SBF-6c bites: claimed donor detail with no rows fails",
              any(not ok and n.startswith("SBF-6c") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0],
                                            "has_donor_detail": True}]}).checks)))

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
    # ---- SBFIN-3 A.4: the IE slice, the labels, the donor-only coverage ----
    def ie_member(**over):
        mm = {"seat": "3B", "name": "R", "candidacy_ref": "person-r", "ref_kind": "person",
              "finance_state": "full", "has_donor_detail": False,
              "candidacies": ["riv-2024"], "donors_by_election": {}, "coverage_by_election": {},
              "elections": {"2024": {"label": "L", "direct": {"amount": 0.0, "count": 0},
                                     "self_funding": {"amount": 0.0, "count": 0},
                                     "ie_support": {"amount": 0.0, "count": 0},
                                     "ie_oppose": {"amount": 0.0, "count": 0},
                                     "candidacies": ["riv-2024"]}}}
        mm.update(over)
        return mm
    def ie_art(bucket, **over):
        a = {**base, "members": [ie_member()],
             "election_labels": {"2024": "2024", "2026": "2026"},
             "ie_spenders": bucket}
        a.update(over)
        return a
    def spender(**over):
        sp = {"committee_id": "ie-c-1", "name": "S", "sbe_committee_id": "1",
              "industries": ["charter-schools"],
              "support": {"amount": 100.0, "count": 1},
              "oppose": {"amount": 40.0, "count": 1},
              "targets": [{"seat": "3B", "member_id": "r", "name": "R",
                           "candidacy_id": "riv-2024",
                           "support": {"amount": 100.0, "count": 1},
                           "oppose": {"amount": 40.0, "count": 1},
                           "rows": [{"date": "2024-10-01", "amount": 100.0, "stance": "support",
                                     "match_method": "exact", "needs_review": False},
                                    {"date": "2024-10-02", "amount": 40.0, "stance": "oppose",
                                     "match_method": "exact", "needs_review": False}]}]}
        sp.update(over)
        return sp
    # The control. SBF-17e is deliberately EXCLUDED: it is a vintage assert about the two
    # real committees and their ratified figures, so it fires on any synthetic artifact by
    # design. Every other 17/18/19 check is a shape or reconciliation rule and must be
    # silent on a well-formed one.
    t.append(("the correct IE shape raises NO SBF-17/18/19 error (17e excepted, see note)",
              not any(not ok and not n.startswith("SBF-17e")
                      and (n.startswith("SBF-17") or n.startswith("SBF-18")
                           or n.startswith("SBF-19"))
                      for n, ok, _ in run(ie_art({"2024": [spender()]})).checks)))
    # THE CYCLE/DATE TRAP, as a test case. Every school-board IE row carries cycle 2027 and
    # a 2024 date; a builder keying on cycle files them under "2027". Two checks must fire:
    # the bucket is not a window (17d1), and — were the bucket named plausibly — the dates
    # would not be contained (17d).
    t.append(("SBF-17d1 bites: a cycle-2027 bucket holding 2024-dated rows fails",
              any(not ok and n.startswith("SBF-17d1") for n, ok, _ in
                  run(ie_art({"2027": [spender()]})).checks)))
    t.append(("SBF-17d bites: a 2024-dated row filed under the 2026 window fails",
              any(not ok and n.startswith("SBF-17d ") for n, ok, _ in
                  run(ie_art({"2026": [spender()]})).checks)))
    t.append(("SBF-17a bites: a stored field equal to support+oppose fails",
              any(not ok and n.startswith("SBF-17a") for n, ok, _ in
                  run(ie_art({"2024": [spender(deployed=140.0)]})).checks)))
    t.append(("SBF-17a bites: a total-shaped key on a spender fails",
              any(not ok and n.startswith("SBF-17a") for n, ok, _ in
                  run(ie_art({"2024": [spender(total=999.0)]})).checks)))
    t.append(("SBF-17c bites: a target that is not a seated candidacy fails",
              any(not ok and n.startswith("SBF-17c") for n, ok, _ in
                  run(ie_art({"2024": [spender(targets=[{**spender()["targets"][0],
                                                         "candidacy_id": "not-a-member"}])]})).checks)))
    t.append(("SBF-17f bites: rows not summing to the target figure fails",
              any(not ok and n.startswith("SBF-17f") for n, ok, _ in
                  run(ie_art({"2024": [spender(targets=[{**spender()["targets"][0],
                                                         "support": {"amount": 999.0, "count": 1}}])]})).checks)))
    t.append(("SBF-17h bites: a row with a stance that is neither support nor oppose fails",
              any(not ok and n.startswith("SBF-17h") for n, ok, _ in
                  run(ie_art({"2024": [spender(targets=[{**spender()["targets"][0],
                      "rows": [{"date": "2024-10-01", "amount": 100.0, "stance": "neutral"}]}])]})).checks)))
    t.append(("SBF-17e bites: a spender total drifting from the ratified figure fails",
              any(not ok and n.startswith("SBF-17e") for n, ok, _ in
                  run(ie_art({"2024": [spender(sbe_committee_id="26066",
                                               support={"amount": 1.0, "count": 1})]})).checks)))
    t.append(("SBF-18a bites: an election with no election-wide label fails",
              any(not ok and n.startswith("SBF-18a") for n, ok, _ in
                  run({**ie_art({"2024": [spender()]}), "election_labels": {"2026": "2026"}}).checks)))
    t.append(("SBF-18b bites: a district-bearing election-wide label fails (the R.4 bug)",
              any(not ok and n.startswith("SBF-18b") for n, ok, _ in
                  run({**ie_art({"2024": [spender()]}),
                       "election_labels": {"2024": "2024: District 10", "2026": "2026"}}).checks)))
    t.append(("SBF-19 bites: coverage buckets that do not come from the donor rows fail",
              any(not ok and n.startswith("SBF-19") for n, ok, _ in
                  run({**base, "members": [person_member(coverage_by_election={"2024": {
                      "donor_total": 10.0, "donor_count": 1,
                      "dollars": {"substantive": 4.0, "individual_only": 6.0,
                                  "unclassified": 0.0},
                      "shares": {"substantive": 1.0, "individual_only": 0.0,
                                 "unclassified": 0.0},
                      "substantive_share": 1.0, "meets_industry_threshold": True}})]}).checks)))

    # ---- SBFIN-2 B: the two-step replace closed, and the vocabulary slices ----
    t.append(("SBF-14 bites: the flat donors key coming back fails",
              any(not ok and n.startswith("SBF-14") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "donors": []}]}).checks)))
    t.append(("SBF-14 bites: the flat coverage key coming back fails",
              any(not ok and n.startswith("SBF-14") for n, ok, _ in
                  run({**base, "members": [{**base["members"][0], "coverage": None}]}).checks)))
    t.append(("SBF-16a bites: A's superseded_keys marker surviving into B fails",
              any(not ok and n.startswith("SBF-16a") for n, ok, _ in
                  run({**base, "superseded_keys": {"x": "y"}}).checks)))
    vocab_ok = {**base, "members": [person_member()],
                "industry_tags": {"substantive-tag": {"label": "L", "color": "#000"}},
                "donor_clusters": {}}
    t.append(("the vocabulary shape raises NO SBF-15 error when it matches the rows",
              not any(not ok and n.startswith("SBF-15") for n, ok, _ in
                      run({**vocab_ok, "members": [person_member(donors_by_election={"2024": [
                          {"donor_id": "d-give", "amount": 10.0, "count": 2,
                           "industry_class": "substantive", "industries": ["substantive-tag"],
                           "items": [{"date": "2024-01-02", "amount": 6.0},
                                     {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-15a bites: an industry with no vocabulary entry fails",
              any(not ok and n.startswith("SBF-15a") for n, ok, _ in
                  run({**vocab_ok, "members": [person_member(donors_by_election={"2024": [
                      {"donor_id": "d-give", "amount": 10.0, "count": 2,
                       "industry_class": "substantive", "industries": ["no-such-tag"],
                       "items": [{"date": "2024-01-02", "amount": 6.0},
                                 {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-15b bites: a vocabulary entry missing its colour fails",
              any(not ok and n.startswith("SBF-15b") for n, ok, _ in
                  run({**base, "industry_tags": {"t": {"label": "L"}},
                       "members": [person_member()]}).checks)))
    t.append(("SBF-15c bites: an unused vocabulary entry fails",
              any(not ok and n.startswith("SBF-15c") for n, ok, _ in
                  run({**base, "industry_tags": {"never-used": {"label": "L", "color": "#000"}},
                       "members": [person_member()]}).checks)))
    t.append(("SBF-15d bites: a cluster_id pointing at nothing fails",
              any(not ok and n.startswith("SBF-15d") for n, ok, _ in
                  run({**base, "donor_clusters": {}, "members": [person_member(
                      donors_by_election={"2024": [
                          {"donor_id": "d-give", "amount": 10.0, "count": 2,
                           "industry_class": "substantive", "cluster_id": "rollup-nope",
                           "items": [{"date": "2024-01-02", "amount": 6.0},
                                     {"date": "2024-02-03", "amount": 4.0}]}]})]}).checks)))
    t.append(("SBF-15e bites: a donor family carrying a total field fails",
              any(not ok and n.startswith("SBF-15e") for n, ok, _ in
                  run({**base, "donor_clusters": {"r-1": {"name": "F", "total": 5.0}},
                       "members": [person_member()]}).checks)))
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

    # ---- [SBF/SYNC] the vintage assert. Every failure path is driven, because this
    # check exists BECAUSE a stamp that was written but never read produced a green.
    ROSTER, ELECT = "school-board-data.json", "election-data.json"
    SR, SE = "a" * 64, "b" * 64
    synced = {"_sync": {"inputs": {ROSTER: {"sha256": SR}, ELECT: {"sha256": SE}}}}
    P = {ROSTER: "/roster", ELECT: "/elect"}
    fake = lambda table: (lambda p: table.get(p))

    t.append(("SBF/SYNC passes when both inputs match their stamps",
              sync_verdict(synced, P, fake({"/roster": SR, "/elect": SE}))[0] is True))
    t.append(("SBF/SYNC bites: a wrong ELECTIONS sha fails",
              sync_verdict(synced, P, fake({"/roster": SR, "/elect": "c" * 64}))[0] is False))
    t.append(("SBF/SYNC bites: a wrong ROSTER sha fails",
              sync_verdict(synced, P, fake({"/roster": "d" * 64, "/elect": SE}))[0] is False))
    t.append(("SBF/SYNC bites: an ABSENT _sync fails (fail-closed)",
              sync_verdict({}, P, fake({}))[0] is False and
              sync_verdict({"_sync": {}}, P, fake({}))[0] is False and
              sync_verdict({"_sync": {"inputs": {}}}, P, fake({}))[0] is False))
    t.append(("SBF/SYNC bites: a stamped input with no sha256 fails",
              sync_verdict({"_sync": {"inputs": {ROSTER: {}}}}, P, fake({"/roster": SR}))[0] is False))
    # An unreadable input is a SKIP, not a pass-by-silence: it must be named in the report.
    _ok, _lines = sync_verdict(synced, P, fake({"/roster": SR}))
    t.append(("SBF/SYNC: an unreadable input is reported UNVERIFIED, not silently agreed",
              _ok is True and any("UNVERIFIED" in l and ELECT in l for l in _lines)))
    # The real artifact on disk must be self-consistent with the real inputs beside it.
    _here = os.path.dirname(os.path.abspath(__file__))
    _root = os.path.join(_here, "..")
    try:
        _art = json.load(open(os.path.join(_root, "school-board-finance.json")))
        t.append(("SBF/SYNC: the committed artifact matches the committed inputs",
                  sync_verdict(_art, {ROSTER: os.path.join(_root, ROSTER),
                                      ELECT: os.path.join(_root, ELECT)})[0] is True))
    except OSError:
        t.append(("SBF/SYNC: the committed artifact matches the committed inputs", False))

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
    ap.add_argument("--school-board", default="school-board-data.json",
                    help="the roster input, for the [SBF/SYNC] vintage assert only")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="print every executed check")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())

    art = json.load(open(a.artifact))

    # [SBF/SYNC] BEFORE anything else. See sync_verdict's docstring: every check below
    # reads this artifact as though it were built from the files on disk right now, and
    # until this landed nothing established that. Hard-exit rather than degrade — a
    # mismatched pair makes all 7,500+ results describe a vintage that is not in the tree.
    ok, lines = sync_verdict(art, {"school-board-data.json": a.school_board,
                                   "election-data.json": a.elections})
    for ln in lines:
        print("[validate_sb_finance] " + ln, file=(sys.stderr if not ok else sys.stdout))
    if not ok:
        print("[validate_sb_finance] REFUSING TO VALIDATE — the artifact was not built "
              "from these inputs; no checks were run.", file=sys.stderr)
        sys.exit(1)

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
