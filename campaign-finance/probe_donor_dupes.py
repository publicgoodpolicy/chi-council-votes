#!/usr/bin/env python3
"""
probe_donor_dupes.py — Find likely duplicate donors (to MERGE) and related
donors (to RELATE) in council-data.json, for editor review.

TWO OUTPUTS, TWO DIFFERENT OPERATIONS
-------------------------------------
MERGE  = same real entity recorded more than once. Collapse to one canonical
         record; reassign contributions; sum totals.
         e.g. two "Michael Sacks" rows; "CTU PAC" vs "Chicago Teachers Union PAC".
RELATE = distinct entities that are connected. Link as a named cluster; do NOT
         merge (they're genuinely different).
         e.g. Michael Sacks + Cari Sacks + Common Ground Collective.

This script only PROPOSES. You confirm the real ones into two Sheet tabs:
    donor_merges    (alias_id, canonical_id, canonical_name, reason)
    donor_clusters  (cluster_id, cluster_name, donor_id, relationship, note)
ingest.py then applies merges (reassign + sum) and the embed shows clusters as
"related entities."

WHY NOT AUTO-MERGE: two different people can share a name, and only an editor
knows that a person and a PAC are linked. So every suggestion shows the
distinguishing fields (type, employer, city) and the dollars at stake.

Standard library only. Reads council-data.json locally (no network).

USAGE
    python3 probe_donor_dupes.py --data ./council-data.json
    python3 probe_donor_dupes.py --min-jaccard 0.6 --out probe_out
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict

# Broad stoplist for token-overlap (Jaccard), surname, and containment checks.
ORG_STOP = set("""pac committee fund friends of for the citizens inc llc llp co corp
corporation union political action campaign ltd lp company assoc association group
holdings""".split())
# Minimal stoplist for ACRONYM/abbreviation matching — must keep meaningful words
# like "chicago"/"teachers"/"union" so "Chicago Teachers Union" -> "CTU" works.
ACRO_STOP = set("""of the for and a an pac committee fund friends citizens political
action campaign""".split())
INDIV_TYPES = {"Individual"}
ORG_TYPES = {"PAC", "Union", "Corporation", "Other"}


def norm(name):
    s = (name or "").lower()
    s = re.sub(r"[.,/&'\"()-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def core_tokens(name):
    return [t for t in norm(name).split() if t not in ORG_STOP and len(t) > 1]


def core(name):
    return " ".join(core_tokens(name))


def acronym(name):
    toks = [t for t in norm(name).split() if t not in ACRO_STOP and len(t) > 1]
    return "".join(t[0] for t in toks)


def compact(name):
    toks = [t for t in norm(name).split() if t not in ACRO_STOP and len(t) > 1]
    return "".join(toks)


def jaccard(a, b):
    sa, sb = set(core_tokens(a)), set(core_tokens(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def surname(name):
    toks = norm(name).split()
    return toks[-1] if toks else ""


def acronym_match(a, b):
    """True if one name is an acronym/compact form of the other (CTU <-> Chicago Teachers Union)."""
    ca, cb = compact(a), compact(b)
    aa, ab = acronym(a), acronym(b)
    if not ca or not cb:
        return False
    # one side collapses to a short token equal to the other's acronym
    if len(ca) <= 5 and ca == ab:
        return True
    if len(cb) <= 5 and cb == aa:
        return True
    return False


def load(data_path):
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    donors = data.get("donors", {})
    contribs = data.get("contributions", [])
    totals = defaultdict(lambda: [0.0, 0])  # donor_id -> [sum, count]
    for c in contribs:
        t = totals[c.get("donor_id")]
        t[0] += c.get("amount", 0) or 0
        t[1] += 1
    # normalize donor dicts to a common shape
    out = {}
    for did, d in donors.items():
        out[did] = {
            "id": d.get("id", did),
            "name": d.get("name", ""),
            "type": d.get("type", "Other"),
            "employer": d.get("employer", "") or "",
            "occupation": d.get("occupation", "") or "",
            "city": d.get("city", "") or "",
            "total": totals.get(did, [0, 0])[0],
            "count": totals.get(did, [0, 0])[1],
        }
    return out, data


def fmt(d):
    bits = [d["type"]]
    if d["employer"]:
        bits.append("emp:" + d["employer"])
    if d["occupation"]:
        bits.append(d["occupation"])
    if d["city"]:
        bits.append(d["city"])
    return f"${int(d['total']):,} / {d['count']}x · " + " · ".join(b for b in bits if b)


# --------------------------------------------------------------------------
def find_merges(donors, min_jaccard):
    """Same-entity duplicates. Grouped within donor type."""
    ids = list(donors)
    suggestions = []  # each: {confidence, reason, members:[ids], canonical}

    # 1) exact normalized-name groups (within type)
    by_norm = defaultdict(list)
    for did in ids:
        d = donors[did]
        by_norm[(d["type"], norm(d["name"]))].append(did)
    seen_pairs = set()
    for (typ, _), grp in by_norm.items():
        if len(grp) > 1:
            conf = "high" if typ in ORG_TYPES else "review"  # two same-named people may differ
            suggestions.append(_mk(donors, grp, conf,
                "identical name" + ("" if typ in ORG_TYPES else " — confirm same person, not two people")))
            for i in range(len(grp)):
                for j in range(i + 1, len(grp)):
                    seen_pairs.add(frozenset((grp[i], grp[j])))

    # 2) acronym / compact-form matches + high token overlap (within type)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            if frozenset((a, b)) in seen_pairs:
                continue
            da, db = donors[a], donors[b]
            if da["type"] != db["type"]:
                continue
            if norm(da["name"]) == norm(db["name"]):
                continue
            reason = None
            conf = None
            if da["type"] in ORG_TYPES and acronym_match(da["name"], db["name"]):
                reason, conf = "acronym / abbreviation match", "high"
            else:
                jac = jaccard(da["name"], db["name"])
                if jac >= min_jaccard:
                    # one set ⊆ other is stronger than partial overlap
                    sa, sb = set(core_tokens(da["name"])), set(core_tokens(db["name"]))
                    subset = sa <= sb or sb <= sa
                    reason = f"name overlap (Jaccard {jac:.2f}{', subset' if subset else ''})"
                    conf = "high" if (subset and da["type"] in ORG_TYPES) else "review"
            if reason:
                suggestions.append(_mk(donors, [a, b], conf, reason))
                seen_pairs.add(frozenset((a, b)))
    # rank: dollars at stake, then confidence
    order = {"high": 0, "review": 1}
    suggestions.sort(key=lambda s: (order.get(s["confidence"], 9), -s["dollars"]))
    return suggestions


def _mk(donors, ids, conf, reason):
    members = sorted(ids, key=lambda i: -donors[i]["total"])
    canonical = members[0]  # highest-dollar as default canonical; editor can change
    return {
        "confidence": conf, "reason": reason,
        "canonical_id": canonical, "canonical_name": donors[canonical]["name"],
        "dollars": sum(donors[i]["total"] for i in members),
        "members": [{"id": i, "name": donors[i]["name"], "detail": fmt(donors[i])} for i in members],
    }


def find_clusters(donors):
    """Distinct-but-related entities. Lower confidence; editor curates."""
    ids = list(donors)
    clusters = []

    # A) shared employer (individuals) — likely same household/firm bloc
    by_emp = defaultdict(list)
    for did in ids:
        d = donors[did]
        if d["type"] in INDIV_TYPES and len(norm(d["employer"])) >= 3:
            by_emp[norm(d["employer"])].append(did)
    for emp, grp in by_emp.items():
        if len(grp) >= 2:
            clusters.append(_mkcluster(donors, grp, "shared employer", donors[grp[0]]["employer"]))

    # B) shared surname (individuals) — possible family; editor confirms
    by_sur = defaultdict(list)
    for did in ids:
        d = donors[did]
        if d["type"] in INDIV_TYPES and len(surname(d["name"])) >= 4:
            by_sur[surname(d["name"])].append(did)
    for sur, grp in by_sur.items():
        if len(grp) >= 2:
            clusters.append(_mkcluster(donors, grp, "shared surname (possible family)", sur.title()))

    # C) person name appearing inside an org name, or org/person name containment cross-type
    #    (e.g. an individual whose name is embedded in a PAC they fund)
    for i in range(len(ids)):
        for j in range(len(ids)):
            if i == j:
                continue
            a, b = ids[i], ids[j]
            da, db = donors[a], donors[b]
            if da["type"] in INDIV_TYPES and db["type"] in ORG_TYPES:
                na = set(core_tokens(da["name"]))
                nb = set(core_tokens(db["name"]))
                if na and na <= nb:  # person's tokens all inside the org name
                    clusters.append(_mkcluster(donors, [a, b], "name appears in org", da["name"]))
                # or the person's employer matches the org name
                elif da["employer"] and core(da["employer"]) and core(da["employer"]) == core(db["name"]):
                    clusters.append(_mkcluster(donors, [a, b], "employer == org name", db["name"]))

    # de-dup clusters that cover the same member set
    uniq, seen = [], set()
    for c in clusters:
        key = (c["relationship"], frozenset(m["id"] for m in c["members"]))
        if key not in seen:
            seen.add(key); uniq.append(c)
    uniq.sort(key=lambda c: -c["dollars"])
    return uniq


def _mkcluster(donors, ids, relationship, label):
    members = sorted(set(ids), key=lambda i: -donors[i]["total"])
    return {
        "relationship": relationship, "label": label,
        "dollars": sum(donors[i]["total"] for i in members),
        "members": [{"id": i, "name": donors[i]["name"], "detail": fmt(donors[i])} for i in members],
    }


# --------------------------------------------------------------------------
def run(data_path, out_dir, min_jaccard, show):
    if not os.path.exists(data_path):
        print(f"  Could not find {data_path}"); return 1
    donors, _ = load(data_path)
    print(f"  Loaded {len(donors)} donors.")
    if not donors:
        print("  No donors in this file."); return 0

    merges = find_merges(donors, min_jaccard)
    clusters = find_clusters(donors)

    print("\n" + "=" * 70 + f"\n  MERGE candidates (same entity, dedupe): {len(merges)}\n" + "=" * 70)
    print("  Confirm the real ones into a `donor_merges` Sheet tab.\n")
    for m in merges[:show]:
        print(f"  [{m['confidence'].upper()}] {m['reason']}  (${int(m['dollars']):,} combined)")
        print(f"     canonical: {m['canonical_name']}  [{m['canonical_id']}]")
        for mem in m["members"]:
            tag = "  <- canonical" if mem["id"] == m["canonical_id"] else ""
            print(f"       - {mem['name']}  ({mem['detail']})  [{mem['id']}]{tag}")
        print()
    if len(merges) > show:
        print(f"  … {len(merges) - show} more in the JSON/CSV.\n")

    print("=" * 70 + f"\n  RELATE candidates (distinct but connected): {len(clusters)}\n" + "=" * 70)
    print("  Confirm the real ones into a `donor_clusters` Sheet tab.\n")
    for c in clusters[:show]:
        print(f"  {c['relationship']}: {c['label']}  (${int(c['dollars']):,} across {len(c['members'])})")
        for mem in c["members"]:
            print(f"       - {mem['name']}  ({mem['detail']})  [{mem['id']}]")
        print()
    if len(clusters) > show:
        print(f"  … {len(clusters) - show} more in the JSON/CSV.\n")

    # ---- write review files + prefilled Sheet-ready CSVs ----
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "donor_dedupe_review.json"), "w") as f:
        json.dump({"merges": merges, "clusters": clusters}, f, indent=2, default=str)

    # donor_merges.csv — one row per non-canonical member (alias -> canonical)
    with open(os.path.join(out_dir, "donor_merges_suggested.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["alias_id", "alias_name", "canonical_id", "canonical_name", "confidence", "reason", "KEEP? (y/n)"])
        for m in merges:
            for mem in m["members"]:
                if mem["id"] != m["canonical_id"]:
                    w.writerow([mem["id"], mem["name"], m["canonical_id"], m["canonical_name"],
                                m["confidence"], m["reason"], ""])

    # donor_clusters.csv — one row per member, grouped by a cluster id
    with open(os.path.join(out_dir, "donor_clusters_suggested.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["cluster_id", "cluster_name", "donor_id", "donor_name", "relationship", "KEEP? (y/n)"])
        for idx, c in enumerate(clusters, 1):
            cid = f"cluster-{idx:03d}"
            for mem in c["members"]:
                w.writerow([cid, c["label"], mem["id"], mem["name"], c["relationship"], ""])

    print("  -> " + os.path.join(out_dir, "donor_dedupe_review.json"))
    print("  -> " + os.path.join(out_dir, "donor_merges_suggested.csv")
          + "   (review, mark KEEP, paste into the donor_merges Sheet tab)")
    print("  -> " + os.path.join(out_dir, "donor_clusters_suggested.csv")
          + " (same, for donor_clusters)")
    print("\n  NOTE: a person <-> their PAC link (e.g. Sacks <-> Common Ground Collective)")
    print("  usually isn't inferable from SBE fields alone — add those by hand in the")
    print("  clusters tab. The probe catches name/employer overlaps; you supply knowledge.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Find duplicate/related donors for review.")
    ap.add_argument("--data", default="./council-data.json")
    ap.add_argument("--out", default="probe_out")
    ap.add_argument("--min-jaccard", type=float, default=0.6,
                    help="Token-overlap threshold for near-duplicate names (0-1). Default 0.6.")
    ap.add_argument("--show", type=int, default=25, help="How many of each to print. Default 25.")
    args = ap.parse_args()
    try:
        return run(args.data, args.out, args.min_jaccard, args.show)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
