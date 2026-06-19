import json, os, sys
from collections import Counter

SRC=sys.argv[1] if len(sys.argv)>1 else 'council-data.json'; OUT=sys.argv[2] if len(sys.argv)>2 else SRC
d=json.load(open(SRC)); donors=d['donors']; contribs=d['contributions']; cycles=d['cycles']
rep=[]; log=lambda *a:(rep.append(' '.join(map(str,a))), print(*a))

PRE='pre-2011'; UND='undated'; EXCLUDED_CYCLES={PRE,UND}

# 1. parent_id
cl2p={v['cluster_id']:v['id'] for v in donors.values() if v.get('cluster_id') and v.get('cluster_is_parent')}
assert not ({v['cluster_id'] for v in donors.values() if v.get('cluster_id')} - set(cl2p))
nc=0
for v in donors.values():
    if v.get('cluster_id'): v['parent_id']=cl2p[v['cluster_id']]; nc+=1
    else: v['parent_id']=v['id']
log(f'[1] parent_id on {len(donors)} donors ({nc} clustered/{len(cl2p)} parents, {len(donors)-nc} singletons)')

# 1b. canonical_id + roles on donor_clusters (so the embed modal labels the true parent)
roles_by_cluster={}
for v in donors.values():
    cid=v.get('cluster_id')
    if cid: roles_by_cluster.setdefault(cid,{})[v['id']]=v.get('cluster_role') or ('parent' if v.get('cluster_is_parent') else 'related')
nca=0
for cid,cl in d.get('donor_clusters',{}).items():
    if cid in cl2p:
        roles=roles_by_cluster.get(cid,{})
        ordered={m: roles[m] for m in cl.get('members', []) if m in roles}
        for k in roles:
            if k not in ordered:
                ordered[k]=roles[k]
        cl['canonical_id']=cl2p[cid]; cl['roles']=ordered; nca+=1
log(f'[1b] canonical_id+roles on {nca} clusters')

# 3. current_cycle + default_cycle
latest=max(cycles.items(),key=lambda kv:kv[1]['election_date'])[0]
d['current_cycle']=latest; d['default_cycle']='all'
log(f'[3] current_cycle={latest!r} (derived) | default_cycle="all"')

# 2. cycle assignment (NO clamp into a real cycle for out-of-range)
ranges=sorted(((k,v['start'],v['end']) for k,v in cycles.items()),key=lambda r:r[1])
e_start=ranges[0][1]; l_end=ranges[-1][2]; l_key=ranges[-1][0]
def assign(dt):
    if not dt: return UND
    for k,s,e in ranges:
        if s<=dt<=e: return k
    if dt<e_start: return PRE
    if dt>l_end:   return l_key   # future-dated -> latest (none expected)
    return UND
# validate against existing non-null assignments
m=mm=0
for c in contribs:
    if c.get('cycle') and c.get('date'):
        if assign(c['date'])==c['cycle']: m+=1
        else: mm+=1
pct=f'{100*m/(m+mm):.2f}%' if (m+mm) else 'n/a'  # zero dated rows (fresh election file) -> no denominator
log(f'[2-validate] rule matches existing on {m}/{m+mm} dated rows ({pct})  mismatches={mm}')
fills=Counter()
for c in contribs:
    if not c.get('cycle'):
        c['cycle']=assign(c.get('date')); fills[c['cycle']]+=1
assert all(c.get('cycle') for c in contribs)
log(f'[2] filled {sum(fills.values())} null rows -> {dict(fills)} | zero nulls remain OK')

# 8. rollups.by_parent  (exclude aggregates AND excluded-cycle rows)
agg={k for k,v in donors.items() if v.get('type')=='Aggregate'}
bp={}; sk_a=sk_c=0
for c in contribs:
    if c.get('is_aggregate'): sk_a+=1; continue
    if c['cycle'] in EXCLUDED_CYCLES: sk_c+=1; continue
    dv=donors.get(c.get('donor_id'))
    if dv is None or c['donor_id'] in agg: continue
    pid=dv['parent_id']; p=donors[pid]; amt=c.get('amount') or 0.0; cy=c['cycle']
    r=bp.get(pid)
    if r is None:
        r=bp[pid]={'name':p.get('cluster_name') or p.get('name'),'type':p.get('type'),
                   'industries':p.get('industries',[]),'direct':0.0,'independent':0.0,
                   'total':0.0,'count':0,'by_cycle':{}}
    r['direct']+=amt; r['total']+=amt; r['count']+=1
    b=r['by_cycle'].setdefault(cy,{'direct':0.0,'independent':0.0,'total':0.0,'count':0})
    b['direct']+=amt; b['total']+=amt; b['count']+=1
for r in bp.values():
    for f in('direct','independent','total'): r[f]=round(r[f],2)
    for b in r['by_cycle'].values():
        for f in('direct','independent','total'): b[f]=round(b[f],2)
d.setdefault('rollups',{})['by_parent']=bp
log(f'[8] by_parent: {len(bp)} parents (skipped {sk_a} aggregate, {sk_c} excluded-cycle rows)')

raw=round(sum((c.get('amount') or 0) for c in contribs if not c.get('is_aggregate')
              and c['cycle'] not in EXCLUDED_CYCLES
              and donors.get(c.get('donor_id')) is not None
              and donors[c['donor_id']].get('type')!='Aggregate'),2)
roll=round(sum(r['total'] for r in bp.values()),2)
log(f'[8-check] sum(by_parent.total)={roll:,.2f} vs raw in-scope sum={raw:,.2f}  {"OK" if abs(roll-raw)<.01 else "MISMATCH"}')
log(f'[8-note] pre-2011 dollars excluded from rollup: '
    f'{sum((c.get("amount") or 0) for c in contribs if c["cycle"]==PRE):,.0f} across {fills.get(PRE,0)} rows')

json.dump(d,open(OUT,'w'),indent=2,ensure_ascii=True)
log(f'[write] {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB, src {os.path.getsize(SRC)/1e6:.1f} MB)')
open('/tmp/slice1_report.txt','w').write('\n'.join(rep))
