# Single source of truth for all three rollups. IE-aware: works with zero IEs
# (direct-only) now, and fills the independent layer once ingest_ie has run.
import json, os, sys
from collections import Counter

EXCLUDED_CYCLES={'pre-2011','undated'}

def build(d):
    donors=d['donors']; comms=d['committees']; contribs=d['contributions']
    ies=d.get('independent_expenditures',[])
    agg={k for k,v in donors.items() if v.get('type')=='Aggregate'}
    rnd=lambda x:round(x,2)

    def add(bucket,key,cyc,field,amt):
        b=bucket.setdefault(key,{'all':{},'by_cycle':{}})
        b['all'][field]=rnd(b['all'].get(field,0)+amt)
        c=b['by_cycle'].setdefault(cyc,{})
        c[field]=rnd(c.get(field,0)+amt)

    by_parent={}; by_industry={}; by_alder={}
    members=Counter(v['parent_id'] for v in donors.values() if v.get('type')!='Aggregate')
    pcom={}  # parent_id -> set of recipient committee_ids

    # ---- contributions (the direct layer) ----
    for c in contribs:
        if c.get('is_aggregate'): continue
        if c['cycle'] in EXCLUDED_CYCLES: continue
        # Internal union-dues transfers into a committee's own PAC fund the PAC; they
        # are not giving/spend on the Council. ingest_ie types them distinctly.
        if c.get('contribution_type')=='IE Committee Dues Transfer': continue
        dv=donors.get(c.get('donor_id'))
        if dv is None or c['donor_id'] in agg: continue
        amt=c.get('amount') or 0.0; cyc=c['cycle']
        # by_parent (giving lens; independent stays 0 here by design)
        pid=dv['parent_id']; p=donors[pid]
        r=by_parent.setdefault(pid,{'name':p.get('cluster_name') or p.get('name'),
            'type':p.get('type'),'industries':p.get('industries',[]),
            'direct':0.0,'independent':0.0,'total':0.0,'count':0,
            'committees':0,'members':members.get(pid,1),'by_cycle':{}})
        r['direct']=rnd(r['direct']+amt); r['total']=rnd(r['total']+amt); r['count']+=1
        pcom.setdefault(pid,set()).add(c['committee_id'])
        b=r['by_cycle'].setdefault(cyc,{'direct':0.0,'independent':0.0,'total':0.0,'count':0})
        b['direct']=rnd(b['direct']+amt); b['total']=rnd(b['total']+amt); b['count']+=1
        # by_industry direct: count under EACH of the donor's tags ("associated with")
        for tag in dv.get('industries',[]):
            add(by_industry,tag,cyc,'direct',amt)
        # by_alder direct: only contributions to candidate committees
        rc=comms.get(c['committee_id'])
        if rc and rc.get('type')=='candidate' and rc.get('ward') is not None:
            add(by_alder,str(rc['ward']),cyc,'direct',amt)

    # ---- independent expenditures (the independent layer) ----
    for ie in ies:
        if ie.get('cycle') in EXCLUDED_CYCLES: continue
        amt=ie.get('amount') or 0.0; cyc=ie['cycle']
        sp=comms.get(ie.get('spender_committee_id'))
        # by_industry independent: editorial tag on the SPENDER (decision 4), count under each
        for tag in (sp.get('industry_tags',[]) if sp else []):
            add(by_industry,tag,cyc,'independent',amt)
        # by_alder: support/oppose split
        field='ie_support' if ie.get('stance')=='support' else 'ie_oppose'
        add(by_alder,str(ie['target_ward']),cyc,field,amt)

    for pid,r in by_parent.items():
        r['committees']=len(pcom.get(pid,()))
    d.setdefault('rollups',{})
    d['rollups']['by_parent']=by_parent
    d['rollups']['by_industry']=by_industry
    d['rollups']['by_alder']=by_alder
    return {'by_parent':len(by_parent),'by_industry':len(by_industry),
            'by_alder':len(by_alder),'ies':len(ies)}

if __name__=='__main__':
    SRC=sys.argv[1] if len(sys.argv)>1 else 'council-data.json'; OUT=sys.argv[2] if len(sys.argv)>2 else SRC
    d=json.load(open(SRC)); stats=build(d)
    json.dump(d,open(OUT,'w'),indent=2,ensure_ascii=True)
    print('[build_rollups]',stats)
    # spot checks
    bi=d['rollups']['by_industry']; ba=d['rollups']['by_alder']
    top=sorted(bi.items(),key=lambda kv:kv[1]['all'].get('direct',0),reverse=True)[:5]
    print('top industries (direct, all cycles):')
    for t,v in top: print(f'   {v["all"].get("direct",0):>12,.0f}  {t}')
    print('sample by_alder (ward 22):',json.dumps(ba.get('22'),indent=2))
    print(f'[write] {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)')
