import json, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'campaign-finance/election-data.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

d = json.load(open(SRC))
donors = d['donors']
dc = d.get('donor_clusters', {})

# Authoritative repair: for every cluster defined in donor_clusters, re-stamp the
# cluster_* fields on each member donor from the block (the source of truth).
# Idempotent: healthy donors are rewritten to identical values.
repaired = []
for cid, cl in dc.items():
    canon = cl.get('canonical_id')
    members = cl.get('members', [])
    roles = cl.get('roles', {})
    cname = cl.get('name')
    for mid in members:
        v = donors.get(mid)
        if v is None:
            continue
        before = (v.get('cluster_id'), v.get('cluster_is_parent'),
                  v.get('cluster_name'), v.get('cluster_role'))
        v['cluster_id'] = cid
        v['cluster_is_parent'] = (mid == canon)
        v['cluster_name'] = cname
        v['cluster_role'] = roles.get(mid, 'parent' if mid == canon else 'related')
        after = (v.get('cluster_id'), v.get('cluster_is_parent'),
                 v.get('cluster_name'), v.get('cluster_role'))
        if before != after:
            repaired.append((cid, mid, before, after))

json.dump(d, open(OUT, 'w'), indent=2, ensure_ascii=True)
print("repaired %d donor records across %d clusters" %
      (len(repaired), len({r[0] for r in repaired})))
for cid, mid, b, a in repaired:
    print("  %-12s %-50s %s -> %s" % (cid, mid, b, a))
