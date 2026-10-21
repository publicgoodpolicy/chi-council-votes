#!/usr/bin/env python3
"""Build campaign-finance/homepage-data.json, the homepage's own small data file.

HOMEPAGE-1, rulings of 2026-10-07 (1a, 2a, 10a) and 2026-10-14 (2a, 3a, 4a, 6a).
Reads the two finance artifacts and the school-board votes artifact; writes one
file. Reads nothing else: no Sheet, no network, no vintage.

What it carries:
  * donors   - every parent donor whose counted giving since the cycle floor is
               $1,000 or more, with its giving split by cycle and by stream
               (council candidates, school-board candidates, mayoral candidates,
               outside-spending groups), and the marks a row carries: the
               candidate's own money (is_self, PS-136), loans (PS-147), and a
               candidate's other committee (is_own_committee, PS-142);
  * groups   - each outside-spending group's own spending, by cycle (its row in
               the ranking is marked "spent");
  * items    - the itemized gifts of every parent donor at $50,000 or more;
  * recipients - every committee an item names, with its office and the person
               it belongs to (mayoral committees tied by the candidate key in
               mayor-<key>-<committee id>, ruling 2a of 2026-10-14);
  * feed     - the ten newest votes from both bodies that are key votes, or
               split votes carrying a tag from the Sheet (rulings 6a and 11b).

Counting rules (each from the register; the register wins):
  * the floor is the start of the earliest cycle the artifacts carry
    (2011-05-17); a row before it is not counted;
  * a row typed Other Receipt or IE Committee Dues Transfer is in no figure
    (PS-147, PS-95), except a row of a listed own-committee pair, which keeps
    PS-142's treatment whatever its type;
  * a gift to an outside-spending group counts in full (PS-138, ruling 2a of
    2026-10-07);
  * in-kind and loans are counted; a loan is marked;
  * outside-spending groups' receipts are merged from both artifacts by
    content - (committee, donor, date, amount, type) with multiplicity - never
    by id, because the two artifacts number those receipts independently;
  * candidate-committee receipts are read from election-data.json alone, which
    carries every council candidate-committee row council-data.json carries
    (measured 2026-10-14: 71,282 shared rows, 0 differing); a council-data
    candidate row absent from election-data.json stops the build;
  * a donor's parent is its parent in either artifact; where one artifact
    groups it under another donor and the other leaves it alone, the grouping
    stands; two different groupings stop the build.

Usage (from the repository root):
  python3 -B campaign-finance/ingestion/build_homepage_data.py \
      --elections campaign-finance/election-data.json \
      --council campaign-finance/council-data.json \
      --school-board campaign-finance/school-board-data.json \
      --out campaign-finance/homepage-data.json
"""
import argparse
import collections
import datetime
import hashlib
import json
import re
import sys
import urllib.parse

SCHEMA_VERSION = "1.0"
DONOR_FLOOR = 1000.0
ITEMIZE_FLOOR = 50000.0
FEED_SIZE = 10
COUNCIL_SPLIT_MIN = 3

NOT_COUNTED = {"Other Receipt", "IE Committee Dues Transfer"}
IE_RECEIPT_TYPES = {"IE Committee Receipt"}
LOAN_TYPE = "Loan Received"
# Ruling 35-i b (2026-10-14): the own-committee rule applies only to the twenty donor
# families ratified 2026-10-14 (rulings 27b-34a), by each family's canonical donor id.
FAMILY_PARENTS = frozenset((
    "afscme-council-31",
    "american-federation-of-teachers-cope-voluntary-a-c",
    "carpentry-advancement-pac",
    "chicago-federation-of-labor-and-industrial-union-council-pac",
    "chicago-firefighters-union-local-2",
    "chicago-land-operators-joint-labor-management-pac",
    "chicago-teachers-union",
    "cook-county-college-teachers-union",
    "democratic-party-of-illinois",
    "ibew-local-134",
    "illinois-association-of-realtors",
    "ipace",
    "ironworkers-local-union-1",
    "jmb-realty",
    "liuna-chicago-laborers-district-council-pac",
    "seiu-il-council",
    "teamsters-volunteers-in-politics",
    "ua-union-plumbers-pipefitters-vote-pac",
    "ufcw-local-881",
    "united-working-families-pac",
))

TYPE_CODE = {
    "Individual Contribution": "C",
    "Transfer In": "T",
    "In-kind Contribution": "K",
    "Loan Received": "L",
    "IE Committee Receipt": "G",
    "Other Receipt": "O",
}
OFFICE_STREAM = {
    "alderperson": "council",
    "school_board_member": "school_board",
    "school_board_president": "school_board",
    "mayor": "mayor",
}
# order of the per-cycle vector each donor carries
VECTOR = ["council", "school_board", "mayor", "groups", "own_money", "loans", "own_committee"]
MAYOR_ID = re.compile(r"^mayor-([a-z]+)(?:-[0-9]+)?$")


def stop(msg):
    sys.stderr.write("STOP: " + msg + "\n")
    sys.exit(2)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def cents(x):
    return round(x + 0.0, 2)


def cycle_table(cycles):
    rows = sorted((v["start"], v["end"], k) for k, v in cycles.items())
    for a, b in zip(rows, rows[1:]):
        if a[1] >= b[0]:
            stop("cycles overlap: %s and %s" % (a[2], b[2]))
    return rows


def cycle_of(rows, date):
    for start, end, key in rows:
        if start <= date <= end:
            return key
    return None


def parent_map(e, c):
    """Union of the two artifacts' parent attribution (see the docstring)."""
    out = {}
    ids = set(e["donors"]) | set(c["donors"])
    for did in ids:
        pe = (e["donors"].get(did) or {}).get("parent_id") or did
        pc = (c["donors"].get(did) or {}).get("parent_id") or did
        if pe == pc:
            out[did] = pe
        elif pe == did:
            out[did] = pc
        elif pc == did:
            out[did] = pe
        elif ((e["donors"].get(did) or {}).get("cluster_id")
              and (e["donors"][did].get("cluster_id")
                   == (c["donors"].get(did) or {}).get("cluster_id"))):
            # one Sheet group in both artifacts, whose canonical donor the council
            # artifact does not carry: the elections artifact's parent is the group's
            out[did] = pe
        else:
            stop("donor %s has parent %s in election-data.json and %s in council-data.json"
                 % (did, pe, pc))
    return out


def donor_record(e, c, did):
    return e["donors"].get(did) or c["donors"].get(did) or {}


def cluster_names(e, c):
    names = {}
    for art in (c, e):  # elections last, so its name wins where both carry one
        for cl in (art.get("donor_clusters") or {}).values():
            cid = cl.get("canonical_id")
            if cid and cl.get("name"):
                names[cid] = cl["name"]
    return names


def own_groups(e, c, ie_ids, parent):
    """Each outside-spending committee's own donor, by its parent: the donor the committee
    record names (donor_id), or a donor whose record names the committee (committee_id).
    Two different parents for one committee stop the build."""
    out = {}
    for k in sorted(ie_ids):
        links = set()
        for art in (e, c):
            com = art["committees"].get(k) or {}
            if com.get("donor_id"):
                links.add(com["donor_id"])
            for did, d in art["donors"].items():
                if d.get("committee_id") == k:
                    links.add(did)
        pars = {parent.get(d, d) for d in links}
        if len(pars) > 1:
            stop("outside-spending committee %s belongs to more than one donor: %s" % (k, sorted(pars)))
        if pars:
            out[k] = pars.pop()
    return out


def own_pairs(e):
    pairs = set()
    for c in e["contributions"]:
        if c.get("is_own_committee"):
            pairs.add(c["id"])
    return pairs


def build(e, c, sb, inputs):
    cyc = cycle_table(e["cycles"])
    floor = cyc[0][0]
    parent = parent_map(e, c)
    cnames = cluster_names(e, c)

    committees = dict(c["committees"])
    committees.update(e["committees"])  # elections' record wins for shared ids
    ie_ids = {k for k, v in committees.items() if v.get("type") == "independent_expenditure"}

    # --- the rows ---------------------------------------------------------
    e_by_id = {r["id"]: r for r in e["contributions"]}
    for r in c["contributions"]:
        if r["committee_id"] in ie_ids:
            continue
        m = e_by_id.get(r["id"])
        if m is None:
            stop("council candidate-committee row %s is not in election-data.json" % r["id"])
        for fld in ("donor_id", "date", "amount", "contribution_type"):
            if m.get(fld) != r.get(fld):
                stop("council candidate-committee row %s differs from election-data.json in %s" % (r["id"], fld))

    rows = []
    for r in e["contributions"]:
        if r["committee_id"] not in ie_ids:
            rows.append(r)

    def ie_key(r):
        return (r["committee_id"], r["donor_id"], r["date"], cents(r["amount"]), r["contribution_type"])

    ie_e = collections.defaultdict(list)
    ie_c = collections.defaultdict(list)
    for r in e["contributions"]:
        if r["committee_id"] in ie_ids:
            ie_e[ie_key(r)].append(r)
    for r in c["contributions"]:
        if r["committee_id"] in ie_ids:
            ie_c[ie_key(r)].append(r)
    merged_from_council = 0
    for k in sorted(set(ie_e) | set(ie_c)):
        a, b = ie_e.get(k, []), ie_c.get(k, [])
        rows.extend(a)
        if len(b) > len(a):
            rows.extend(b[len(a):])
            merged_from_council += len(b) - len(a)

    # --- per-donor figures ------------------------------------------------
    vec = collections.defaultdict(lambda: collections.defaultdict(lambda: [0.0] * len(VECTOR)))
    counted = [0.0] * len(VECTOR)
    counted_rows = 0
    items = collections.defaultdict(list)
    used_committees = set()
    excluded = {"before_floor": [0, 0.0], "not_counted_type": [0, 0.0], "to_own_group": [0, 0.0]}
    own_group = own_groups(e, c, ie_ids, parent)
    latest = ""
    for r in rows:
        amt = r["amount"]
        typ = r["contribution_type"]
        if r["date"] < floor:
            excluded["before_floor"][0] += 1
            excluded["before_floor"][1] += amt
            continue
        if typ in NOT_COUNTED and not r.get("is_own_committee"):
            excluded["not_counted_type"][0] += 1
            excluded["not_counted_type"][1] += amt
            continue
        # Rulings 35b and 35-i b (2026-10-14): money a donor family moves to its own
        # outside-spending committee is not a gift; it is counted where it leaves (the
        # committee's own gifts, and its spending in the groups section).
        if (r["committee_id"] in own_group and own_group[r["committee_id"]] in FAMILY_PARENTS
                and own_group[r["committee_id"]] == parent.get(r["donor_id"], r["donor_id"])):
            excluded["to_own_group"][0] += 1
            excluded["to_own_group"][1] += amt
            continue
        cy = cycle_of(cyc, r["date"])
        if cy is None:
            stop("row %s dated %s falls in no cycle" % (r["id"], r["date"]))
        com = committees.get(r["committee_id"])
        if com is None:
            stop("row %s names committee %s, which neither artifact carries" % (r["id"], r["committee_id"]))
        if r["committee_id"] in ie_ids:
            stream = "groups"
        else:
            stream = OFFICE_STREAM.get(com.get("office"))
            if stream is None:
                stop("committee %s has office %r" % (r["committee_id"], com.get("office")))
        p = parent.get(r["donor_id"], r["donor_id"])
        v = vec[p][cy]
        v[VECTOR.index(stream)] += amt
        counted[VECTOR.index(stream)] += amt
        counted_rows += 1
        if r.get("is_self"):
            v[VECTOR.index("own_money")] += amt
        if typ == LOAN_TYPE:
            v[VECTOR.index("loans")] += amt
        if r.get("is_own_committee"):
            v[VECTOR.index("own_committee")] += amt
        if r["date"] > latest:
            latest = r["date"]
        flags = ""
        if r.get("is_self"):
            flags += "s"
        if r.get("is_own_committee"):
            flags += "o"
        items[p].append([r["date"], r["committee_id"], cents(amt), TYPE_CODE.get(typ, "?"), flags, r["id"]])

    def total(p):
        return sum(sum(x[:4]) for x in vec[p].values())

    # --- outside-spending groups' own spending ----------------------------
    spent = collections.defaultdict(lambda: collections.defaultdict(float))
    # The two artifacts number expenditures independently (ids collide and
    # differ), so they are merged by content, with multiplicity:
    # (spender, date, amount, filed document id).
    def x_key(x):
        return (x["spender_committee_id"], x["date"], cents(x["amount"]), x.get("filed_doc_id"))
    x_e = collections.defaultdict(list)
    x_c = collections.defaultdict(list)
    for x in e.get("independent_expenditures") or []:
        x_e[x_key(x)].append(x)
    for x in c.get("independent_expenditures") or []:
        x_c[x_key(x)].append(x)
    ie_rows = []
    for k in sorted(set(x_e) | set(x_c)):
        ie_rows.extend(x_e.get(k, []))
        ie_rows.extend(x_c.get(k, [])[len(x_e.get(k, [])):])
    for x in ie_rows:
        if x["date"] < floor:
            continue
        cy = cycle_of(cyc, x["date"])
        if cy is None:
            stop("expenditure %s dated %s falls in no cycle" % (x["id"], x["date"]))
        spent[x["spender_committee_id"]][cy] += x["amount"]

    # --- assemble ----------------------------------------------------------
    cycle_keys = [k for _, _, k in cyc]
    donors = []
    for p in vec:
        t = total(p)
        if t + 1e-9 < DONOR_FLOOR:
            continue
        rec = donor_record(e, c, p)
        by_cycle = {}
        for k in cycle_keys:
            if k in vec[p]:
                by_cycle[k] = [cents(x) for x in vec[p][k]]
        donors.append({
            "id": p,
            "name": cnames.get(p) or rec.get("name") or p,
            "type": rec.get("type"),
            "industries": rec.get("industries") or [],
            "flags": rec.get("flags") or [],
            "total": cents(t),
            "by_cycle": by_cycle,
        })
    donors.sort(key=lambda d: (-d["total"], d["id"]))

    groups = []
    for gid in sorted(spent, key=lambda g: (-sum(spent[g].values()), g)):
        com = committees.get(gid) or {}
        groups.append({
            "id": gid,
            "name": com.get("committee_name") or gid,
            "industries": com.get("industry_tags") or [],
            "spent_total": cents(sum(spent[gid].values())),
            "spent_by_cycle": {k: cents(spent[gid][k]) for k in cycle_keys if k in spent[gid]},
        })

    out_items = {}
    for d in donors:
        if d["total"] + 1e-9 >= ITEMIZE_FLOOR:
            lst = sorted(items[d["id"]], key=lambda i: (i[0], i[1], -i[2], i[5]))
            out_items[d["id"]] = [i[:5] for i in lst]
            for i in lst:
                used_committees.add(i[1])

    # recipients: committees named by an item, with office and person
    cand_by_committee = {}
    for cand in e["candidates"]:
        cid = cand.get("committee_id")
        if cid:
            cand_by_committee.setdefault(cid, []).append(cand)
    person_of_candidacy = {}
    for pid, pl in (e.get("person_links") or {}).items():
        for m in pl.get("candidacies") or []:
            person_of_candidacy[m.get("candidacy_id")] = pid
    sbe_to_key = {}
    for k, v in committees.items():
        if v.get("sbe_committee_id"):
            sbe_to_key.setdefault(str(v["sbe_committee_id"]), k)

    recipients = {}
    for k in sorted(used_committees):
        com = committees[k]
        entry = {
            "name": com.get("committee_name") or k,
            "sbe_committee_id": com.get("sbe_committee_id"),
        }
        if k in ie_ids:
            entry["office"] = "group"
        else:
            entry["office"] = OFFICE_STREAM.get(com.get("office"))
            cands = cand_by_committee.get(com.get("sbe_committee_id")) or []
            if not cands and com.get("candidate_id"):
                cands = [x for x in e["candidates"] if x.get("id") == com["candidate_id"]]
            if cands:
                cand = sorted(cands, key=lambda x: x["id"])[-1]
                m = MAYOR_ID.match(cand["id"])
                if cand.get("race_id") == "mayor":
                    if not m:
                        stop("mayoral candidacy id %s does not read mayor-<key>-<id>" % cand["id"])
                    entry["person"] = "mayor-" + m.group(1)
                else:
                    entry["person"] = person_of_candidacy.get(cand["id"], cand["id"])
                entry["candidate"] = cand.get("name")
            else:
                entry["candidate"] = com.get("alder_name")
        recipients[k] = entry

    feed = build_feed(c, sb)

    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "_inputs": inputs,
        "floor": floor,
        "data_through": latest,
        "cycles": {k: e["cycles"][k] for k in cycle_keys},
        "vector": VECTOR,
        "thresholds": {"donor": DONOR_FLOOR, "itemized": ITEMIZE_FLOOR},
        "counts": {
            "donors": len(donors),
            "itemized_donors": len(out_items),
            "items": sum(len(v) for v in out_items.values()),
            "groups": len(groups),
            "group_receipts_merged_from_council": merged_from_council,
        },
        "counted_all_donors": {"rows": counted_rows, "by_stream": {VECTOR[i]: cents(counted[i]) for i in range(4)}},
        "excluded": {k: {"rows": v[0], "amount": cents(v[1])} for k, v in excluded.items()},
        "donors": donors,
        "groups": groups,
        "recipients": recipients,
        "items": out_items,
        "feed": feed,
    }


def build_feed(c, sb):
    key_ids = {m["vote_id"]: m for m in c.get("votemeta") or [] if m.get("vote_id")}
    out = []
    for v in c["rollcall"]["votes"]:
        t = v.get("tally") or {}
        split = (t.get("yes", 0) >= COUNCIL_SPLIT_MIN and t.get("no", 0) >= COUNCIL_SPLIT_MIN
                 and bool(str(v.get("tag") or "").strip()))
        meta = key_ids.get(v["id"])
        if not (meta or split):
            continue
        out.append({
            "body": "council",
            "id": v["id"],
            "date": v["date"],
            "title": (meta or {}).get("full") or v.get("title"),
            "key": bool(meta),
            "tag": (meta or {}).get("tag") or v.get("tag"),
            "result": v.get("result"),
            "tally": {"yes": t.get("yes", 0), "no": t.get("no", 0)},
            "link": "/alder-voting-history",
            "source_url": v.get("source_url"),
        })
    meta_sb = {m["vote_id"]: m for m in sb.get("votemeta") or [] if m.get("vote_id")}
    for v in sb["rollcall"]["votes"]:
        meta = meta_sb.get(v["id"]) or {}
        key = bool(meta.get("featured"))
        split = v.get("outcome") == "Split" and bool(str(v.get("tag") or "").strip())
        if not (key or split):
            continue
        pos = list((v.get("positions") or {}).values())
        out.append({
            "body": "school_board",
            "id": v["id"],
            "date": v["date"],
            "title": meta.get("full") or v.get("title"),
            "key": key,
            "tag": meta.get("tag") or v.get("tag"),
            "result": v.get("outcome"),
            "tally": {"yes": pos.count("Affirmative"), "no": pos.count("Oppositional")},
            "link": "/school-board-voting-history?vote=" + urllib.parse.quote(v["id"], safe=""),
            "source_url": v.get("source_url"),
        })
    out.sort(key=lambda x: (x["date"], x["body"], x["id"]), reverse=True)
    return out[:FEED_SIZE]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--elections", required=True)
    ap.add_argument("--council", required=True)
    ap.add_argument("--school-board", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    inputs = {}
    for name, path in (("election-data.json", a.elections), ("council-data.json", a.council),
                       ("school-board-data.json", a.school_board)):
        inputs[name] = sha256_of(path)
    with open(a.elections, encoding="utf-8") as f:
        e = json.load(f)
    with open(a.council, encoding="utf-8") as f:
        c = json.load(f)
    with open(a.school_board, encoding="utf-8") as f:
        sb = json.load(f)
    out = build(e, c, sb, inputs)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    n = out["counts"]
    print("homepage-data.json: %d donors, %d itemized donors, %d items, %d groups, %d group receipts merged from council-data.json"
          % (n["donors"], n["itemized_donors"], n["items"], n["groups"], n["group_receipts_merged_from_council"]))
    print("floor %s, data through %s; excluded %s" % (out["floor"], out["data_through"], json.dumps(out["excluded"])))
    print("feed: " + ", ".join("%s %s %s" % (x["date"], x["body"], x["id"]) for x in out["feed"]))


if __name__ == "__main__":
    main()
