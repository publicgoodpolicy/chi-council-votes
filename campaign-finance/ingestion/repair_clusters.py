import json, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else 'campaign-finance/election-data.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

d = json.load(open(SRC))
donors = d['donors']
dc = d.get('donor_clusters', {})

# Authoritative repair for post-re-ingest cluster state. Two behaviors:
#
#  (1) FLAG-STRIP (original, unchanged): for every cluster, re-stamp the cluster_*
#      fields on each PRESENT member donor from the block (source of truth).
#      Idempotent -- healthy clusters (all members present) are rewritten to
#      identical values and appear in neither the reparented/dissolved/pruned lists.
#
#  (2) ABSENT-MEMBER CHURN (added): a re-ingest can drop or rename member donors,
#      leaving the block referencing donors no longer in the data. Deterministic
#      handling:
#        - >=2 members still present: keep the cluster on the present members; if
#          the canonical itself is absent, REPARENT to the FIRST present member
#          (members-list order) -- matching apply_clusters / serve.py cluster_preview
#          (serve.py:525 `present[0]`), so repair and the live Sheet-apply agree.
#        - <2 members present (1): DISSOLVE -- strip cluster fields from the lone
#          present member, prune the block.
#        - 0 members present: PRUNE the stale block (nothing to strip).

CLUSTER_FIELDS = ('cluster_id', 'cluster_is_parent', 'cluster_name', 'cluster_role')


def strip_cluster(v):
    for f in CLUSTER_FIELDS:
        v.pop(f, None)


restamped, reparented, dissolved, pruned = [], [], [], []
to_delete = []

for cid, cl in dc.items():
    canon = cl.get('canonical_id')
    members = cl.get('members', [])
    roles = cl.get('roles', {})
    cname = cl.get('name')
    present = [m for m in members if m in donors]
    absent = [m for m in members if m not in donors]

    if not present:
        to_delete.append(cid)
        pruned.append(cid)
        continue

    if len(present) < 2:
        for m in present:
            strip_cluster(donors[m])
        to_delete.append(cid)
        dissolved.append((cid, list(present)))
        continue

    # >=2 present. Reparent only if the canonical is the one that vanished.
    new_canon = canon if canon in present else present[0]  # first-present convention
    if new_canon != canon:
        reparented.append((cid, canon, new_canon))
    if absent or new_canon != canon:
        cl['members'] = present
        cl['canonical_id'] = new_canon
        cl['roles'] = {m: roles.get(m, 'parent' if m == new_canon else 'related') for m in present}
        roles = cl['roles']

    for mid in present:
        v = donors[mid]
        before = (v.get('cluster_id'), v.get('cluster_is_parent'),
                  v.get('cluster_name'), v.get('cluster_role'))
        v['cluster_id'] = cid
        v['cluster_is_parent'] = (mid == new_canon)
        v['cluster_name'] = cname
        v['cluster_role'] = roles.get(mid, 'parent' if mid == new_canon else 'related')
        after = (v.get('cluster_id'), v.get('cluster_is_parent'),
                 v.get('cluster_name'), v.get('cluster_role'))
        if before != after:
            restamped.append((cid, mid, before, after))

for cid in to_delete:
    del dc[cid]

json.dump(d, open(OUT, 'w'), indent=2, ensure_ascii=True)

# --- action report (feeds the Step-4 cluster audit) ---
touched = set(r[0] for r in restamped) | set(r[0] for r in reparented) \
    | set(c for c, _ in dissolved) | set(pruned)
untouched = len(dc) + len(to_delete) - len(touched)
print('repair_clusters: %d clusters | dissolved=%d reparented=%d pruned=%d re-stamped=%d untouched=%d'
      % (len(dc) + len(to_delete), len(dissolved), len(reparented),
         len(pruned), len(set(r[0] for r in restamped)), untouched))
for cid, present in dissolved:
    print('  DISSOLVE  %-12s (<2 present) members-kept=%s' % (cid, present))
for cid, old, new in reparented:
    print('  REPARENT  %-12s canonical %s -> %s (first-present)' % (cid, old, new))
for cid in pruned:
    print('  PRUNE     %-12s (0 present)' % cid)
