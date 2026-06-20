# Single source of truth for all three rollups. IE-aware: works with zero IEs
# (direct-only) now, and fills the independent layer once ingest_ie has run.
import json, os, sys, re, unicodedata
from collections import Counter
from datetime import datetime, timezone

EXCLUDED_CYCLES={'pre-2011','undated'}

# election-windows.json lives beside race-map.json in elections/; it buckets a finance
# row to an election by FILING DATE (the SBE 'cycle' field is the useless 4-year bucket).
WINDOWS_PATH=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','elections','election-windows.json')

def _office_type(office):
    return 'school_board' if office and office.startswith('school_board') else None

_NAME_DROP={'jr','sr','ii','iii','iv','mr','mrs','ms','dr'}
def _name_key(n):
    if not n: return frozenset()
    n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower()
    return frozenset(t for t in re.findall(r'[a-z]+',n) if t not in _NAME_DROP and len(t)>1)

def _split_name(n):
    """(surname-tokens, given-tokens). Donor names are stored 'Last, First'; candidate
    names 'First [M.] Last [Suffix]'. With a comma, family=pre-comma; else family=last
    non-suffix token. Used for the committee-scoped self-funding match (surname + given
    subset), which is robust to nickname/middle-name drift (e.g. 'Deborah "Debby" Pope'
    vs donor 'Pope, Debby')."""
    if not n: return frozenset(), frozenset()
    n=unicodedata.normalize('NFKD',n).encode('ascii','ignore').decode().lower()
    if ',' in n:
        fam_s,_,giv_s=n.partition(',')
        fam=frozenset(t for t in re.findall(r'[a-z]+',fam_s) if t not in _NAME_DROP and len(t)>1)
        giv=frozenset(t for t in re.findall(r'[a-z]+',giv_s) if t not in _NAME_DROP and len(t)>1)
    else:
        toks=[t for t in re.findall(r'[a-z]+',n) if t not in _NAME_DROP and len(t)>1]
        fam=frozenset(toks[-1:]); giv=frozenset(toks[:-1])
    return fam,giv

def _self_match(donor_name, ctoks, ctype):
    """The ONE relational self-funding predicate (3b rule): a contribution is self IFF the
    donor identity-matches the RECIPIENT candidate -- committee-scoped surname match AND
    (>=1 given/nick token shared OR a Loan Received). NOT self merely because the donor is
    a Candidate-type / self-funding-flagged person in their own race. Used to stamp
    is_self; candidateContributors (embed) READS that stamp, so render can't diverge."""
    if not ctoks or not donor_name: return False
    dfam,dgiv=_split_name(donor_name)
    if dfam & ctoks and ((dgiv and dgiv<=ctoks) or ctype=='Loan Received'): return True
    return False

def _bucket(date,wins):
    if not date: return None
    for w in wins:
        s=w.get('start'); e=w.get('end')
        if (s is None or date>=s) and (e is None or date<=e): return w
    return None

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

    by_parent={}; by_industry={}; by_alder={}; by_candidate={}; by_race={}
    # Election artifacts carry races[]/candidates[]; council data does not. The new
    # by_candidate/by_race buckets are attached only when those exist, so the
    # council rollup shape (by_parent/by_industry/by_alder) stays identical.
    election_mode=bool(d.get('candidates')) or bool(d.get('races'))
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
        # by_alder direct: only contributions to candidate committees with a ward
        rc=comms.get(c['committee_id'])
        if rc and rc.get('type')=='candidate' and rc.get('ward') is not None:
            add(by_alder,str(rc['ward']),cyc,'direct',amt)
        # by_candidate / by_race direct: ward-less (school-board / mayoral) money
        # lands here, so it is never dropped just because the recipient has no ward.
        if rc and rc.get('candidate_id'):
            add(by_candidate,rc['candidate_id'],cyc,'direct',amt)
        if rc and rc.get('race_id'):
            add(by_race,rc['race_id'],cyc,'direct',amt)

    # ---- independent expenditures (the independent layer) ----
    for ie in ies:
        if ie.get('cycle') in EXCLUDED_CYCLES: continue
        amt=ie.get('amount') or 0.0; cyc=ie['cycle']
        sp=comms.get(ie.get('spender_committee_id'))
        # by_industry independent: editorial tag on the SPENDER (decision 4), count under each
        for tag in (sp.get('industry_tags',[]) if sp else []):
            add(by_industry,tag,cyc,'independent',amt)
        # by_alder: support/oppose split (only when the IE targets a ward)
        field='ie_support' if ie.get('stance')=='support' else 'ie_oppose'
        if ie.get('target_ward') is not None:
            add(by_alder,str(ie['target_ward']),cyc,field,amt)
        # by_candidate / by_race: ward-less IEs (school-board / mayoral) bucket here.
        if ie.get('target_candidate_id'):
            add(by_candidate,ie['target_candidate_id'],cyc,field,amt)
        if ie.get('target_race_id'):
            add(by_race,ie['target_race_id'],cyc,field,amt)

    # ---- by_candidate_election (ADDITIVE, election-guarded) ----
    # Per-candidate, per-election buckets with the FOUR streams kept SEPARATE and never
    # summed: contributions, self_funding, ie_support, ie_oppose. Rows are bucketed by
    # FILING DATE via election-windows.json (NOT the 4-year 'cycle' bucket). Self-funding
    # = donor is the candidate (normalized name match), kept distinct from contributions.
    # Computed only in election_mode and attached only in election_mode below, so the
    # council rollup shape is provably untouched (council data has no candidates/races).
    by_candidate_election={}
    if election_mode:
        try:
            windows=json.load(open(WINDOWS_PATH))
        except (OSError,json.JSONDecodeError):
            windows={}
        cands={c['id']:c for c in d.get('candidates',[])}
        race_office={r['id']:r.get('office') for r in d.get('races',[])}
        # Stamp the ONE relational self-funding decision on each candidate-recipient
        # contribution row (election-only; council rows get NO stamp). candidateContributors
        # READS c['is_self'] instead of deciding from donor-global attributes -> render
        # cannot diverge from this aggregate.
        cand_toks={cid:_name_key(c.get('name')) for cid,c in cands.items()}
        for c in contribs:
            rc=comms.get(c['committee_id'])
            if rc and rc.get('candidate_id') in cand_toks:
                c['is_self']=_self_match((donors.get(c.get('donor_id')) or {}).get('name'),
                                         cand_toks[rc['candidate_id']], c.get('contribution_type'))
        def wins_for(cid):
            c=cands.get(cid)
            if not c: return None
            ot=_office_type(race_office.get(c.get('race_id')))
            return windows.get(ot) if ot else None
        def slot(cid,date):
            wins=wins_for(cid)
            if not wins: return None
            w=_bucket(date,wins)
            if not w: return None
            pe=cands[cid].get('prior_election') or {}
            label=pe['label'] if pe.get('election')==w['id'] and pe.get('label') else w['label']
            return by_candidate_election.setdefault(cid,{}).setdefault(w['id'],{
                'label':label,'contributions':{'amount':0.0,'count':0},
                'self_funding':{'amount':0.0,'count':0},
                'ie_support':{'amount':0.0,'count':0},'ie_oppose':{'amount':0.0,'count':0}})
        for c in contribs:
            if c.get('is_aggregate'): continue
            if c['cycle'] in EXCLUDED_CYCLES: continue
            if c.get('contribution_type')=='IE Committee Dues Transfer': continue
            rc=comms.get(c['committee_id'])
            if not (rc and rc.get('candidate_id')): continue
            eb=slot(rc['candidate_id'],c.get('date'))
            if eb is None: continue
            stream='self_funding' if c.get('is_self') else 'contributions'
            eb[stream]['amount']=rnd(eb[stream]['amount']+(c.get('amount') or 0.0)); eb[stream]['count']+=1
        for ie in ies:
            if ie.get('cycle') in EXCLUDED_CYCLES: continue
            tc=ie.get('target_candidate_id')
            if not tc: continue
            eb=slot(tc,ie.get('date'))
            if eb is None: continue
            stream='ie_support' if ie.get('stance')=='support' else 'ie_oppose'
            eb[stream]['amount']=rnd(eb[stream]['amount']+(ie.get('amount') or 0.0)); eb[stream]['count']+=1

    for pid,r in by_parent.items():
        r['committees']=len(pcom.get(pid,()))
    d.setdefault('rollups',{})
    d['rollups']['by_parent']=by_parent
    d['rollups']['by_industry']=by_industry
    d['rollups']['by_alder']=by_alder
    if election_mode:
        d['rollups']['by_candidate']=by_candidate
        d['rollups']['by_race']=by_race
        d['rollups']['by_candidate_election']=by_candidate_election
    # build_rollups runs last in both the build_all derived step and ingest_ie, so
    # this is the single place that always fires on a (re)build. Stamp real build
    # time — the field was previously static and falsely read as "stale".
    d['generated_at']=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    return {'by_parent':len(by_parent),'by_industry':len(by_industry),
            'by_alder':len(by_alder),'ies':len(ies),
            'by_candidate':len(by_candidate),'by_race':len(by_race),
            'by_candidate_election':len(by_candidate_election)}

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
