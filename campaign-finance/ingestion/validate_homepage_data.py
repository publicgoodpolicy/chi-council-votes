#!/usr/bin/env python3
"""Validate campaign-finance/homepage-data.json against the artifacts it was built from.

An independent recount (HOMEPAGE-1). It does not import build_homepage_data.py:
it reads the three input artifacts and the built file, recounts by its own
path, and fails on any difference.

  python3 -B campaign-finance/ingestion/validate_homepage_data.py \
      --elections campaign-finance/election-data.json \
      --council campaign-finance/council-data.json \
      --school-board campaign-finance/school-board-data.json \
      --data campaign-finance/homepage-data.json
  python3 -B campaign-finance/ingestion/validate_homepage_data.py ... --self-test

Checks (HP-n):
  HP-1  each input's sha256 equals the file's _inputs stamp
  HP-2  the counted money by stream equals the recount (candidate rows by id
        from election-data.json; outside-group receipts as the multiset union
        of the two artifacts' rows, computed by Counter subtraction)
  HP-3  the donor list is exactly the parent donors whose recounted total is
        $1,000 or more, each at its recounted total and per-cycle vector
  HP-4  the list is ranked by total, then id
  HP-5  itemized donors are exactly those at $50,000 or more, and each donor's
        items sum to its total
  HP-6  every item's committee is in recipients; every mayoral recipient's
        person is mayor-<key>, the key read from its candidacy id
  HP-7  each group's spent figure equals the recount of independent
        expenditures from the floor
  HP-8  the feed is the ten newest qualifying votes under the stated rule,
        newest first, and each school-board link carries its vote's id
"""
import argparse
import collections
import copy
import hashlib
import json
import sys
import urllib.parse

NOT_COUNTED = ("Other Receipt", "IE Committee Dues Transfer")
STREAM = {"alderperson": 0, "school_board_member": 1, "school_board_president": 1, "mayor": 2}


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def r2(x):
    return round(x, 2)


def recount(e, c, sb):
    cyc = sorted((v["start"], v["end"], k) for k, v in e["cycles"].items())
    floor = cyc[0][0]

    def cy(d):
        for a, b, k in cyc:
            if a <= d <= b:
                return k
        raise ValueError("no cycle for " + d)

    ie = set()
    office = {}
    for art in (c, e):
        for k, v in art["committees"].items():
            if v.get("type") == "independent_expenditure":
                ie.add(k)
            else:
                office[k] = v.get("office")

    def par(did):
        a = (e["donors"].get(did) or {}).get("parent_id") or did
        b = (c["donors"].get(did) or {}).get("parent_id") or did
        return a if a != did else b

    def key(r):
        return (r["committee_id"], r["donor_id"], r["date"], round(r["amount"], 2), r["contribution_type"])

    ce = collections.Counter(key(r) for r in e["contributions"] if r["committee_id"] in ie)
    cc = collections.Counter(key(r) for r in c["contributions"] if r["committee_id"] in ie)
    extra = cc - ce
    own_by_key = {}
    for r in e["contributions"] + c["contributions"]:
        if r["committee_id"] in ie:
            own_by_key[key(r)] = (bool(r.get("is_self")), bool(r.get("is_own_committee")))

    vec = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0] * 7))
    total_by_stream = [0.0] * 4

    def add(did, comm, date, amt, typ, is_self, is_own):
        if date < floor:
            return
        if typ in NOT_COUNTED and not is_own:
            return
        s = 3 if comm in ie else STREAM[office[comm]]
        v = vec[par(did)][cy(date)]
        v[s] += amt
        total_by_stream[s] += amt
        if is_self:
            v[4] += amt
        if typ == "Loan Received":
            v[5] += amt
        if is_own:
            v[6] += amt

    for r in e["contributions"]:
        add(r["donor_id"], r["committee_id"], r["date"], r["amount"], r["contribution_type"],
            bool(r.get("is_self")), bool(r.get("is_own_committee")))
    for k, n in extra.items():
        s, o = own_by_key[k]
        for _ in range(n):
            add(k[1], k[0], k[2], k[3], k[4], s, o)

    def xk(x):
        return (x["spender_committee_id"], x["date"], round(x["amount"], 2), x.get("filed_doc_id"))
    xe = collections.Counter(xk(x) for x in e.get("independent_expenditures") or [])
    xc = collections.Counter(xk(x) for x in c.get("independent_expenditures") or [])
    spent = collections.defaultdict(float)
    for k, n in (xe + (xc - xe)).items():
        if k[1] >= floor:
            spent[k[0]] += k[2] * n
    return floor, vec, total_by_stream, spent


def feed_expected(c, sb):
    km = {m["vote_id"]: m for m in c.get("votemeta") or []}
    sm = {m["vote_id"]: m for m in sb.get("votemeta") or []}
    q = []
    for v in c["rollcall"]["votes"]:
        t = v.get("tally") or {}
        tagged = bool(str(v.get("tag") or "").strip())
        if v["id"] in km or (tagged and t.get("yes", 0) >= 3 and t.get("no", 0) >= 3):
            q.append((v["date"], "council", v["id"]))
    for v in sb["rollcall"]["votes"]:
        tagged = bool(str(v.get("tag") or "").strip())
        if (sm.get(v["id"]) or {}).get("featured") or (tagged and v.get("outcome") == "Split"):
            q.append((v["date"], "school_board", v["id"]))
    q.sort(reverse=True)
    return q[:10]


def check(h, e, c, sb, shas):
    fails = []

    def f(code, msg):
        fails.append("%s %s" % (code, msg))

    for name, s in shas.items():
        if h.get("_inputs", {}).get(name) != s:
            f("HP-1", "%s sha256 differs from the stamp" % name)

    floor, vec, tbs, spent = recount(e, c, sb)
    names = ["council", "school_board", "mayor", "groups"]
    for i, n in enumerate(names):
        got = h["counted_all_donors"]["by_stream"].get(n)
        if got is None or abs(got - r2(tbs[i])) > 0.005:
            f("HP-2", "%s %s != recount %s" % (n, got, r2(tbs[i])))

    tot = {p: sum(sum(x[:4]) for x in cyv.values()) for p, cyv in vec.items()}
    want = {p for p, t in tot.items() if t + 1e-9 >= 1000}
    have = {d["id"] for d in h["donors"]}
    if want != have:
        f("HP-3", "donor set differs: missing %d, extra %d" % (len(want - have), len(have - want)))
    for d in h["donors"]:
        p = d["id"]
        if p not in tot:
            continue
        if abs(d["total"] - r2(tot[p])) > 0.005:
            f("HP-3", "%s total %s != %s" % (p, d["total"], r2(tot[p])))
        for k, v in vec[p].items():
            got = d["by_cycle"].get(k)
            exp = [r2(x) for x in v]
            if got is None or any(abs(a - b) > 0.005 for a, b in zip(got, exp)):
                f("HP-3", "%s cycle %s %s != %s" % (p, k, got, exp))
    order = [(-d["total"], d["id"]) for d in h["donors"]]
    if order != sorted(order):
        f("HP-4", "donors are not ranked by total, then id")

    want_items = {d["id"] for d in h["donors"] if d["total"] + 1e-9 >= 50000}
    if set(h["items"]) != want_items:
        f("HP-5", "itemized set differs")
    dt = {d["id"]: d["total"] for d in h["donors"]}
    for p, lst in h["items"].items():
        s = sum(i[2] for i in lst)
        if p in dt and abs(s - dt[p]) > 0.01:
            f("HP-5", "%s items sum %s != total %s" % (p, r2(s), dt[p]))
        for i in lst:
            if i[1] not in h["recipients"]:
                f("HP-6", "item committee %s missing from recipients" % i[1])

    cand = {x.get("committee_id"): x["id"] for x in e["candidates"] if x.get("race_id") == "mayor" and x.get("committee_id")}
    for k, r in h["recipients"].items():
        if r.get("office") == "mayor":
            sbe = r.get("sbe_committee_id")
            cid = cand.get(sbe)
            if not cid:
                f("HP-6", "mayoral recipient %s has no candidacy" % k)
                continue
            if r.get("person") != "mayor-" + cid.split("-")[1]:
                f("HP-6", "mayoral recipient %s person %s, candidacy %s" % (k, r.get("person"), cid))

    pl = {}
    for pid, p in (e.get("person_links") or {}).items():
        for m in p.get("candidacies") or []:
            pl[m["candidacy_id"]] = pid
    cands = {x.get("committee_id"): x["id"] for x in e["candidates"] if x.get("race_id") != "mayor" and x.get("committee_id")}
    for k, r in h["recipients"].items():
        cid = cands.get(r.get("sbe_committee_id"))
        if r.get("office") in ("council", "school_board") and cid and cid in pl and r.get("person") != pl[cid]:
            f("HP-6", "recipient %s person %s, person link %s" % (k, r.get("person"), pl[cid]))

    for g in h["groups"]:
        if abs(g["spent_total"] - r2(spent.get(g["id"], 0.0))) > 0.005:
            f("HP-7", "%s spent %s != %s" % (g["id"], g["spent_total"], r2(spent.get(g["id"], 0.0))))
    if {g["id"] for g in h["groups"]} != {k for k, v in spent.items() if v}:
        f("HP-7", "group set differs")

    exp = feed_expected(c, sb)
    got = [(x["date"], x["body"], x["id"]) for x in h["feed"]]
    if got != exp:
        f("HP-8", "feed %s != expected %s" % (got, exp))
    for x in h["feed"]:
        if x["body"] == "school_board" and x["link"] != "/school-board-voting-history?vote=" + urllib.parse.quote(x["id"], safe=""):
            f("HP-8", "link for %s is %s" % (x["id"], x["link"]))
    return fails


def self_test(h, e, c, sb, shas):
    base = check(h, e, c, sb, shas)
    if base:
        print("self-test: the real file fails, so the bites are not meaningful")
        return False
    bites = []

    def bite(name, fn, code):
        g = copy.deepcopy(h)
        fn(g)
        res = check(g, e, c, sb, shas)
        ok = any(x.startswith(code) for x in res)
        bites.append((name, code, ok))

    bite("stamp", lambda g: g["_inputs"].__setitem__("election-data.json", "0" * 64), "HP-1")
    bite("stream", lambda g: g["counted_all_donors"]["by_stream"].__setitem__("mayor", 1.0), "HP-2")
    bite("total", lambda g: g["donors"][0].__setitem__("total", g["donors"][0]["total"] + 1), "HP-3")
    bite("drop donor", lambda g: g["donors"].pop(), "HP-3")
    bite("order", lambda g: g["donors"].reverse(), "HP-4")
    bite("drop item", lambda g: g["items"][g["donors"][0]["id"]].pop(), "HP-5")
    bite("person", lambda g: [r.__setitem__("person", "mayor-x") for r in g["recipients"].values() if r.get("office") == "mayor"][:1], "HP-6")
    bite("link", lambda g: [r.__setitem__("person", "x") for r in g["recipients"].values() if str(r.get("person", "")).startswith("person-")][:1], "HP-6")
    bite("spent", lambda g: g["groups"][0].__setitem__("spent_total", 0.0), "HP-7")
    bite("feed order", lambda g: g["feed"].reverse(), "HP-8")
    for name, code, ok in bites:
        print("  bite %-11s %s %s" % (name, code, "caught" if ok else "NOT CAUGHT"))
    n = sum(1 for b in bites if b[2])
    print("self-test: %d of %d bites caught" % (n, len(bites)))
    return n == len(bites)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--elections", required=True)
    ap.add_argument("--council", required=True)
    ap.add_argument("--school-board", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    shas = {"election-data.json": sha(a.elections), "council-data.json": sha(a.council),
            "school-board-data.json": sha(a.school_board)}
    e = json.load(open(a.elections, encoding="utf-8"))
    c = json.load(open(a.council, encoding="utf-8"))
    sb = json.load(open(a.school_board, encoding="utf-8"))
    h = json.load(open(a.data, encoding="utf-8"))
    if a.self_test:
        sys.exit(0 if self_test(h, e, c, sb, shas) else 1)
    fails = check(h, e, c, sb, shas)
    for x in fails[:50]:
        print("FAIL " + x)
    print("validate_homepage_data: %d donors, %d groups, %d feed items · %s"
          % (len(h["donors"]), len(h["groups"]), len(h["feed"]), "ALL PASS" if not fails else "%d FAILED" % len(fails)))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
