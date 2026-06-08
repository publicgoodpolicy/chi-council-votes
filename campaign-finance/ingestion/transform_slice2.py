import json, re, os, sys
from collections import Counter

SRC=sys.argv[1] if len(sys.argv)>1 else 'council-data.json'; OUT=sys.argv[2] if len(sys.argv)>2 else SRC
d=json.load(open(SRC)); donors=d['donors']; comms=d['committees']
rep=[]; log=lambda *a:(rep.append(' '.join(map(str,a))), print(*a))

def norm(s):
    s=re.sub(r'[^a-z0-9 ]',' ',(s or '').lower())
    return re.sub(r'\s+',' ',s).strip()

# --- generalize the existing 50 candidate committees ---
for c in comms.values():
    c.setdefault('type','candidate')
    c.setdefault('industry_tags',[])
    c.setdefault('donor_id',None)
log(f'[reg] generalized {len(comms)} candidate committees (+type/industry_tags/donor_id)')

# --- add committee_id=null to every donor for schema uniformity ---
for v in donors.values():
    v.setdefault('committee_id',None)

# --- reusable bridge matcher: donor -> existing committee (sbe id, then name) ---
name_idx={}
for k,c in comms.items():
    for nm in (c.get('committee_name'), c.get('alder_name')):
        if nm: name_idx.setdefault(norm(nm),k)
sbe_idx={c['sbe_committee_id']:k for k,c in comms.items() if c.get('sbe_committee_id')}

def find_committee(donor):
    sid=donor.get('sbe_committee_id')
    if sid and sid in sbe_idx: return sbe_idx[sid]
    return name_idx.get(norm(donor.get('name')))

# --- bridge committee-type donors that ARE one of the 50 ---
bridged=0; collisions=[]
for v in donors.values():
    if v['type'] not in ('Candidate','PAC'): continue
    ck=find_committee(v)
    if ck:
        if comms[ck].get('donor_id') and comms[ck]['donor_id']!=v['id']:
            collisions.append((ck, comms[ck]['donor_id'], v['id']))
        comms[ck]['donor_id']=v['id']
        v['committee_id']=ck
        bridged+=1
log(f'[bridge] linked {bridged} committee-type donors to existing committees'
    + (f'  COLLISIONS={collisions}' if collisions else '  (no collisions)'))

# --- validation ---
errs=[]
for k,c in comms.items():
    did=c.get('donor_id')
    if did is not None and did not in donors: errs.append(f'committee {k}.donor_id->{did} missing')
for vid,v in donors.items():
    ck=v.get('committee_id')
    if ck is not None and ck not in comms: errs.append(f'donor {vid}.committee_id->{ck} missing')
    if ck is not None and comms[ck].get('donor_id')!=vid: errs.append(f'bridge not symmetric: {vid}<->{ck}')
n_cand=sum(1 for c in comms.values() if c.get('type')=='candidate')
log(f'[validate] committees={len(comms)} (candidate={n_cand}, others incl. IE={len(comms)-n_cand}) | '
    f'bridge integrity errors: {len(errs)}')
if errs: log('   ', errs[:10])
assert n_cand>=50 and not errs

json.dump(d,open(OUT,'w'),indent=2,ensure_ascii=True)
log(f'[write] {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)')
open('/tmp/slice2_report.txt','w').write('\n'.join(rep))
