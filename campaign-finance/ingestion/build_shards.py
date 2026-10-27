"""Split council-data into a small index + a contributions shard so the embed
gets a fast first paint and streams the heavy detail. Backward compatible:
the embed falls back to the monolith if index/contrib URLs aren't configured."""
import json, os, gzip, sys
SRC=sys.argv[1] if len(sys.argv)>1 else 'council-data.json'; OUT=sys.argv[2] if len(sys.argv)>2 else 'shards'
os.makedirs(OUT,exist_ok=True)
d=json.load(open(SRC))

# --- votes file (F-1b, rulings 164a, 165-1a, P17-1a): what the votes views and the methodology need
# for a first paint; the embed then loads the monolith unchanged. Taken before anything below pops or
# slims a key. ---
VOTES_KEYS=('schema_version','generated_at','alders','votemeta','rollcall','council_committees',
            'dues_excluded','other_receipts_excluded')
json.dump({k:d[k] for k in VOTES_KEYS}, open(f'{OUT}/council-votes.json','w'),
          indent=2, ensure_ascii=True)

# --- contributions shard (the biggest chunk; needed only for drill-down views) ---
contribs=d.pop('contributions')
json.dump({'contributions':contribs}, open(f'{OUT}/council-contributions.json','w'),
          indent=2, ensure_ascii=True)

# --- by_parent: slim for the index (drop by_cycle); keep full by_cycle in its own shard ---
bp=d['rollups']['by_parent']
by_parent_cycles={pid:r['by_cycle'] for pid,r in bp.items()}
slim={pid:{k:r[k] for k in ('name','type','industries','direct','independent',
           'total','count','committees','members')} for pid,r in bp.items()}
d['rollups']['by_parent']=slim
json.dump(by_parent_cycles, open(f'{OUT}/council-by_parent_cycles.json','w'),
          indent=2, ensure_ascii=True)   # not fetched yet; for future cycle filtering

# --- index = everything else ---
json.dump(d, open(f'{OUT}/council-index.json','w'), indent=2, ensure_ascii=True)

def sz(p):
    raw=os.path.getsize(p)
    gz=len(gzip.compress(open(p,'rb').read()))
    return raw,gz
print(f"{'file':34s}{'raw':>10s}{'gzip (wire)':>14s}")
for f in ['council-votes.json','council-index.json','council-contributions.json','council-by_parent_cycles.json']:
    raw,gz=sz(f'{OUT}/{f}')
    print(f'{f:34s}{raw/1e6:8.1f}MB{gz/1e6:11.2f}MB')
mono_raw,mono_gz=sz(SRC)
print(f'{"(monolith for comparison)":34s}{mono_raw/1e6:8.1f}MB{mono_gz/1e6:11.2f}MB')
print(f'\nVotes-first payload (council-votes.json, F-1b) gzipped: {sz(OUT+"/council-votes.json")[1]/1e6:.2f}MB; '
      f'the embed then loads the monolith.')
print(f'Sharded-mode payload (index) gzipped: {sz(OUT+"/council-index.json")[1]/1e6:.2f}MB '
      f'vs {mono_gz/1e6:.2f}MB monolith — contributions stream after.')
