# editorial_snapshot.py — SBFIN-4 / the SBE re-run lane.
#
# WHY THIS EXISTS. `sync_overrides` re-reads EVERY editorial tab on every run, so a refresh
# picks up every Sheet edit since the last build — not only the one the lane intends. That
# set is unknown before the run, and re-reading the artifact afterwards to work out what
# moved is a recollection, not a measurement.
#
# So the before-side is captured as its own hashed artifact, BEFORE the pull lands. It is
# also the rollback reference if the chain goes sideways mid-run.
#
# THE FIELD SET IS READ FROM THE WRITER, not guessed. Every field below is one
# sheets-sync/sync_overrides.py writes:
#   donors[*].industries            <- Donor Overrides (primary + additional)
#   donors[*].flags                 <- Donor Overrides
#   donors[*].notes                 <- Donor Overrides
#   donors[*].entity_type           <- Donor Overrides
#   donors[*]._last_edited_by       <- Donor Overrides
#   donors[*].slug_aliases          <- build_slug_alias_map
#   donors[*].cluster_id/_name/_role/_is_parent, parent_id   <- apply_clusters
#   donor_clusters{}                <- Donor Clusters tab
#   committees[*].industry_tags     <- Committee Tags tab
#   industry_tags{} flag_types{} entity_types{}              <- the vocab tabs
#   person_links{}                  <- Person Links tab
#
#     python3 campaign-finance/tools/editorial_snapshot.py --out snapshot.json
#     python3 campaign-finance/tools/editorial_snapshot.py --diff before.json
import argparse, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ART = ('election-data.json', 'council-data.json',
       'school-board-finance.json', 'school-board-data.json')

# TIER 1 — UNAMBIGUOUSLY EDITORIAL. Only sync_overrides writes these, so any movement is a
# Sheet edit and nothing else.
DONOR_FIELDS = ('flags', 'notes', 'entity_type', '_last_edited_by', 'slug_aliases',
                'cluster_id', 'cluster_name', 'cluster_role', 'cluster_is_parent',
                'parent_id')
# TIER 2 — MIXED PROVENANCE, reported separately and never folded into the editorial delta.
#
# `industries` is written by INGEST's classifier AND by a Donor Override, and THE ARTIFACT
# CANNOT TELL THEM APART. It is present on 100% of donors (4,532 elections / 24,227 council)
# while only 135 / 463 carry `_last_edited_by`. Folding it into tier 1 would drown a handful
# of real Sheet edits in classifier churn from a refresh — a diff that is technically
# complete and useless.
#
# THE SPLIT IS A HEURISTIC, labelled as one because that is what it is: for a donor carrying
# `_last_edited_by`, an industries move is PROBABLY editorial; for one that does not, it is
# PROBABLY the classifier. Neither is certain from the artifact alone, and no amount of care
# here makes it certain.
#
# WHY the artifact cannot distinguish them — Cross-cutting Requirement 2's gap, surfacing:
# auto-classified industry values do not persist back to the editorial Sheet, so there is no
# record of which writer set a given value. Not this lane's to fix. Named here so it is not
# rediscovered a third time.
MIXED_FIELDS = ('industries',)
COLLECTIONS = ('donor_clusters', 'industry_tags', 'flag_types', 'entity_types',
               'person_links')


def sha_file(p):
    with open(p, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def editorial_of(path):
    d = json.load(open(path))
    out = {'donors': {}, 'committees': {}, 'mixed': {}}
    for did, dv in (d.get('donors') or {}).items():
        # EMPTY DEFAULTS ARE INGEST'S, NOT EDITORIAL. `flags: []`, `notes: null` and
        # `parent_id: <self>` are written by ingest on EVERY donor. Carrying them would make
        # the "editorial" delta as wide as the donor table and bury the real Sheet edits in
        # no-ops. Only a field carrying a VALUE counts.
        #
        # MEASURED, because the difference is the difference between a readable diff and an
        # unreadable one: excluding empty defaults drops the tier-1 population from
        #   council   24,227 -> 4,279
        #   elections  4,532 ->   595
        rec = {}
        for f in DONOR_FIELDS:
            if f not in dv:
                continue
            v = dv[f]
            if v in (None, [], {}, ''):
                continue
            if f == 'parent_id' and v == did:
                continue
            rec[f] = v
        if rec:
            out['donors'][did] = rec
        mix = {f: dv.get(f) for f in MIXED_FIELDS if f in dv}
        if mix:
            mix['_edited'] = '_last_edited_by' in dv
            out['mixed'][did] = mix
    for cid, cv in (d.get('committees') or {}).items():
        if 'industry_tags' in cv:
            out['committees'][cid] = {'industry_tags': cv.get('industry_tags')}
    for coll in COLLECTIONS:
        if coll in d:
            out[coll] = d[coll]
    return out


def snapshot(root):
    snap = {'artifacts': {}, 'editorial': {}}
    for a in ART:
        p = os.path.join(root, a)
        if not os.path.exists(p):
            continue
        snap['artifacts'][a] = {'sha256': sha_file(p), 'bytes': os.path.getsize(p)}
        if a in ('election-data.json', 'council-data.json'):
            snap['editorial'][a] = editorial_of(p)
    return snap


def walk(node, path=''):
    """Flatten to {dotted.path: leaf} so a diff names the exact field that moved."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield from walk(v, path + '/' + str(k))
    elif isinstance(node, list):
        yield path, json.dumps(node, sort_keys=True)
    else:
        yield path, node


def diff(before, after):
    added, removed, changed = [], [], []
    for art in sorted(set(before.get('editorial', {})) | set(after.get('editorial', {}))):
        bb = dict(before.get('editorial', {}).get(art, {}))
        aa = dict(after.get('editorial', {}).get(art, {}))
        bb.pop('mixed', None); aa.pop('mixed', None)     # tier 2 is reported on its own
        b = dict(walk(bb))
        a = dict(walk(aa))
        for k in sorted(set(a) - set(b)):
            added.append((art, k, a[k]))
        for k in sorted(set(b) - set(a)):
            removed.append((art, k, b[k]))
        for k in sorted(set(a) & set(b)):
            if a[k] != b[k]:
                changed.append((art, k, b[k], a[k]))
    return added, removed, changed


def main():
    ap = argparse.ArgumentParser(description='Capture / diff the editorial-derived field set.')
    ap.add_argument('--root', default=os.path.join(HERE, '..'))
    ap.add_argument('--out')
    ap.add_argument('--diff', help='a previously captured snapshot to compare against')
    a = ap.parse_args()

    snap = snapshot(a.root)
    if a.diff:
        before = json.load(open(a.diff))
        added, removed, changed = diff(before, snap)
        print('=== ARTIFACT SHAS ===')
        for k, v in sorted(snap['artifacts'].items()):
            was = (before.get('artifacts', {}).get(k) or {}).get('sha256')
            mark = 'UNMOVED' if was == v['sha256'] else 'MOVED  '
            print(f"  {mark} {k:28} {v['sha256']}")
            if was != v['sha256']:
                print(f"          was      {was}")
        print(f"\n=== EDITORIAL DELTA === added {len(added)} · removed {len(removed)} "
              f"· changed {len(changed)}")
        for art, k, v in added:
            print(f"  + {art}{k} = {v!r}")
        for art, k, v in removed:
            print(f"  - {art}{k} (was {v!r})")
        for art, k, b, c in changed:
            print(f"  ~ {art}{k}: {b!r} -> {c!r}")
        total = len(added) + len(removed) + len(changed)
        print(f"\nTOTAL tier-1 (unambiguously editorial) field movements: {total}")

        # Tier 2, separately and never folded in.
        print('\n=== TIER 2: `industries` — MIXED PROVENANCE (classifier or override) ===')
        for art in sorted(set(before.get('editorial', {})) | set(snap.get('editorial', {}))):
            bm = (before.get('editorial', {}).get(art, {}) or {}).get('mixed', {})
            am = (snap.get('editorial', {}).get(art, {}) or {}).get('mixed', {})
            moved = [k for k in sorted(set(bm) & set(am))
                     if json.dumps(bm[k].get('industries'), sort_keys=True)
                     != json.dumps(am[k].get('industries'), sort_keys=True)]
            ed = [k for k in moved if am[k].get('_edited') or bm[k].get('_edited')]
            print(f"  {art}: {len(moved)} donor(s) changed industries — "
                  f"{len(ed)} carry _last_edited_by (probably editorial), "
                  f"{len(moved) - len(ed)} do not (probably the classifier)")
            for k in ed[:20]:
                print(f"    ~ {k}: {bm[k].get('industries')} -> {am[k].get('industries')}")
            if len(ed) > 20:
                print(f"    ... and {len(ed) - 20} more edited-donor changes")
        sys.exit(0)

    text = json.dumps(snap, indent=1, sort_keys=True)
    if a.out:
        open(a.out, 'w').write(text + '\n')
        print(f"[editorial_snapshot] wrote {a.out}")
        print(f"[editorial_snapshot] sha256 {hashlib.sha256((text + chr(10)).encode()).hexdigest()}")
    for k, v in sorted(snap['artifacts'].items()):
        print(f"  {k:28} {v['sha256']}  {v['bytes']:>10,} B")
    ed = snap.get('editorial', {})
    for art, e in sorted(ed.items()):
        print(f"  {art}: donors-with-editorial={len(e.get('donors', {}))} "
              f"committees-tagged={len(e.get('committees', {}))} "
              f"clusters={len(e.get('donor_clusters', {}))} "
              f"person_links={len(e.get('person_links', {}))} "
              f"industry_tags={len(e.get('industry_tags', {}))} "
              f"flag_types={len(e.get('flag_types', {}))} "
              f"| tier2-mixed={len(e.get('mixed', {}))}")


if __name__ == '__main__':
    main()
