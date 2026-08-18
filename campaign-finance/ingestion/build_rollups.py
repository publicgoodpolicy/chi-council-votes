# Single source of truth for all three rollups. IE-aware: works with zero IEs
# (direct-only) now, and fills the independent layer once ingest_ie has run.
import json, os, sys, re, unicodedata
from collections import Counter
from datetime import datetime, timezone

EXCLUDED_CYCLES={'pre-2011','undated'}

# ELEC-FIGURE-1 R1 — the dues-exclusion magnitude, emitted rather than discarded.
# This module is the single implementation serving BOTH artifacts, so the accumulator
# sits AT the exclusion predicate (all three sites below) and the field it feeds is
# emitted into whichever artifact build() was handed.
DUES_TYPE='IE Committee Dues Transfer'

# ELEC-FIGURE-1 §2 (widening relay) — this module now OWNS council-data.json's
# schema_version. Before this lane the value was an unowned literal: written by no code,
# read by no code, unmoved since the file was created — so a schema change could land with
# the version silently stale, which is the drift this ownership closes.
#
# CONDITIONED ON THE FIELD'S PRESENCE, not on a filename, and the choice is forced rather
# than preferred: build() receives a loaded document, never a path (ingest_ie calls
# build(d) directly with no filename in scope), so presence is the only signal available at
# the point the write must happen. It also preserves R1 (iv)'s "if any" exactly —
# election-data.json carries no version field, so none is written and none is invented.
COUNCIL_SCHEMA_VERSION='2.1'
# Keyed by id() of the row, NOT appended: the three predicate sites are three passes
# over the SAME contributions list, so a row excluded by all three must still count
# once (R1 i). id() is stable for the lifetime of the loaded document, which is the
# lifetime of one build() call — and the dict is cleared at build() entry because
# build() runs more than once per pipeline run (ingest_ie calls it, then the
# orchestrator calls it again). Without that reset the second invocation would
# accumulate on top of the first.
_DUES_SKIPPED={}
def _dues_record(c):
    _DUES_SKIPPED[id(c)]=round(float(c.get('amount') or 0.0),2)
def dues_excluded_total():
    """R1: {amount, count} over every row the dues predicate excluded this build.

    Zero rows is a real answer, not a missing one — PS-101 attaches the disclosure
    obligation at every magnitude, $0.00 included, so this is emitted unconditionally.
    float() explicitly: an empty accumulator sums to int 0, which would serialise as
    `0` where every other money amount in these artifacts is `0.0`.
    """
    return {'amount':round(float(sum(_DUES_SKIPPED.values())),2),'count':len(_DUES_SKIPPED)}

# election-windows.json lives beside race-map.json in elections/; it buckets a finance
# row to an election by FILING DATE (the SBE 'cycle' field is the useless 4-year bucket).
WINDOWS_PATH=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','elections','election-windows.json')

# D-18 (PS-108): the office-type table replacing the prefix test. Mirrors data.js's
# OFFICE_TYPE token for token — same table, two languages. They cannot share one predicate
# across languages, so [MUNI/TABLE] pins both to one independently stated oracle rather than
# deriving either from the other (PS-82). Enumerates both keyspaces the callers pass: the
# page office and race.office. city_clerk / city_treasurer are table entries only; their
# races remain reachable from no page.
OFFICE_TYPE={
    'school_board':'school_board',
    'school_board_president':'school_board',
    'school_board_member':'school_board',
    'city_council':'municipal',
    'alderperson':'municipal',
    'mayor':'municipal',
    'city_clerk':'municipal',
    'city_treasurer':'municipal',
}
def _office_type(office):
    return OFFICE_TYPE.get(office)


def load_windows():
    """D-19 (PS-109): a missing or corrupt windows file is an ERROR, never an empty filter.

    PS-79/B1 ("a missing window is an error, never an empty filter") was enforced in JS and
    silently violated here: `windows={}` produced no buckets at all, so by_candidate_election
    came out empty and nothing said why. PS-79(c) scoped the municipal key out to "F4's own
    lane"; MUNI-ENABLE-1 is that lane (D-19), so the degradation is fixed in the same arc that
    makes municipal windows real."""
    try:
        with open(WINDOWS_PATH) as f:
            w=json.load(f)
    except OSError as e:
        raise SystemExit('FATAL [PS-109] election-windows.json unreadable at %s: %s\n'
                         '  Refusing to bucket with an empty window table: a missing window is '
                         'an error, never an empty filter (PS-79/B1).' % (WINDOWS_PATH,e))
    except json.JSONDecodeError as e:
        raise SystemExit('FATAL [PS-109] election-windows.json is not valid JSON at %s: %s\n'
                         '  Refusing to bucket with an empty window table.' % (WINDOWS_PATH,e))
    if not isinstance(w,dict) or not [k for k,v in w.items()
                                      if not k.startswith('_') and isinstance(v,list) and v]:
        raise SystemExit('FATAL [PS-109] election-windows.json at %s carries no office-type '
                         'window list.\n  Refusing to bucket with an empty window table.'
                         % WINDOWS_PATH)
    return w

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
    >=1 given/nick token shared. A Loan Received no longer independently satisfies the
    match: a same-surname relative's loan (e.g. a spouse) is NOT the candidate's own
    self-funding, so a loan must still clear the given-name test like any other row.
    NOT self merely because the donor is a Candidate-type / self-funding-flagged person
    in their own race. Used to stamp is_self; candidateContributors (embed) READS that
    stamp, so render can't diverge. (ctype retained for signature/call-site stability.)"""
    if not ctoks or not donor_name: return False
    dfam,dgiv=_split_name(donor_name)
    if dfam & ctoks and (dgiv and dgiv<=ctoks): return True
    return False

def _bucket(date,wins):
    if not date: return None
    for w in wins:
        s=w.get('start'); e=w.get('end')
        if (s is None or date>=s) and (e is None or date<=e): return w
    return None

def build(d):
    _DUES_SKIPPED.clear()   # R1 (i): reset at every build() entry — build() runs more than once per pipeline run
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
        if c.get('contribution_type')==DUES_TYPE: _dues_record(c); continue
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
        windows=load_windows()   # D-19 (PS-109): fail loud, never windows={}
        cands={c['id']:c for c in d.get('candidates',[])}
        race_office={r['id']:r.get('office') for r in d.get('races',[])}
        # Prior-election bucket labels for by_candidate_election DERIVE FROM PERSON LINKS
        # (HALT-P1-C: the prior_election.label field is retired). For each returner, the 2024
        # window of the CURRENT (2026) candidacy is labelled from the LINKED 2024 candidacy's
        # race district — reproducing "2024: District N" byte-for-byte for the 9 formerly-
        # annotated returners and extending the same label to the 8 newly signed off (D2).
        _races_by_id={r['id']:r for r in d.get('races',[])}
        prior_win_label={}   # current(2026) candidacy_id -> {window_id: "YYYY: District N"}
        for _pid,_g in (d.get('person_links') or {}).items():
            _ms=sorted(_g.get('candidacies',[]),key=lambda m:m['election_id'] or '')
            if len(_ms)<2: continue
            _cur=_ms[-1]['candidacy_id']; _pri=_ms[0]
            _pr=_races_by_id.get((cands.get(_pri['candidacy_id']) or {}).get('race_id'),{})
            _yr=(_pri['election_id'] or '').split('-')[0]
            if _pr.get('district'):
                prior_win_label.setdefault(_cur,{})[_yr]=f"{_yr}: {_pr['district']}"
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
            label=prior_win_label.get(cid,{}).get(w['id']) or w['label']
            return by_candidate_election.setdefault(cid,{}).setdefault(w['id'],{
                'label':label,'contributions':{'amount':0.0,'count':0},
                'self_funding':{'amount':0.0,'count':0},
                'ie_support':{'amount':0.0,'count':0},'ie_oppose':{'amount':0.0,'count':0}})
        for c in contribs:
            if c.get('is_aggregate'): continue
            if c['cycle'] in EXCLUDED_CYCLES: continue
            if c.get('contribution_type')==DUES_TYPE: _dues_record(c); continue
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

        # ---- by_person (HALT-P1-C, ADDITIVE, election-only) ----
        # The Person entity: DIRECT receipts ONLY. There is NO 'independent' key anywhere in
        # by_person, recursively (the firewall) — IE display is a separate P1-D stream. Money is
        # DEDUPED over the person's committee set: each committee is counted once. A returner's
        # 2024 candidacy owns no committee (its money already sits on the 2026 sibling, split by
        # date window), so it is never re-added — the single contributions pass below keys on the
        # committee, so double-counting is structurally impossible. C4/C5 carriage (prior label/
        # office/qualifier) DERIVES from the linked prior candidacy record (ratified: derive,
        # don't store — never read the retired prior_election field).
        by_person={}
        plinks=d.get('person_links') or {}
        if plinks:
            races_by_id={r['id']:r for r in d.get('races',[])}
            # committee slug by owning candidate_id -> reverse to slug->person + per-slug windows
            cbyc={cm.get('candidate_id'):slug for slug,cm in comms.items() if cm.get('candidate_id')}
            slug_person={}; slug_wins={}
            for ppid,g in plinks.items():
                for m in g.get('candidacies',[]):
                    slug=cbyc.get(m['candidacy_id'])
                    if not slug: continue
                    slug_person[slug]=ppid
                    crec=cands.get((comms.get(slug) or {}).get('candidate_id'))
                    ot=_office_type(race_office.get(crec.get('race_id'))) if crec else None
                    slug_wins[slug]=windows.get(ot) if ot else None
            acc={ppid:{'total':0.0,'by_election':{},'by_year':{},
                       'don_total':{},'don_elec':{},'don_year':{}} for ppid in plinks}
            # ONE contributions pass over person-owned committees (same filters as by_candidate
            # 'direct'), so acc['total'] independently reproduces Σ by_candidate[c].direct — the
            # dedup identity the validator (INV-PERSON-1) then asserts.
            for c in contribs:
                if c.get('is_aggregate'): continue
                if c['cycle'] in EXCLUDED_CYCLES: continue
                if c.get('contribution_type')==DUES_TYPE: _dues_record(c); continue
                slug=c.get('committee_id'); ppid=slug_person.get(slug)
                if not ppid: continue
                dv=donors.get(c.get('donor_id'))
                if dv is None or c['donor_id'] in agg: continue
                amt=c.get('amount') or 0.0; did=c['donor_id']; date=c.get('date') or ''
                yr=date[:4] if len(date)>=4 and date[:4].isdigit() else 'undated'
                w=_bucket(date,slug_wins.get(slug)) if slug_wins.get(slug) else None
                eid=w['id'] if w else None
                a=acc[ppid]
                a['total']=rnd(a['total']+amt)
                a['by_year'][yr]=rnd(a['by_year'].get(yr,0.0)+amt)
                dt=a['don_total'].setdefault(did,{'amount':0.0,'count':0}); dt['amount']=rnd(dt['amount']+amt); dt['count']+=1
                dy=a['don_year'].setdefault(yr,{}).setdefault(did,{'amount':0.0,'count':0}); dy['amount']=rnd(dy['amount']+amt); dy['count']+=1
                if eid:
                    a['by_election'][eid]=rnd(a['by_election'].get(eid,0.0)+amt)
                    de=a['don_elec'].setdefault(eid,{}).setdefault(did,{'amount':0.0,'count':0}); de['amount']=rnd(de['amount']+amt); de['count']+=1
            for ppid,g in plinks.items():
                membs=sorted(g.get('candidacies',[]),key=lambda m:m['election_id'] or '')
                members=[{'candidacy_id':m['candidacy_id'],'election_id':m['election_id'],
                          'owns_committee':m['candidacy_id'] in cbyc} for m in membs]
                recent=membs[-1]['candidacy_id'] if membs else None
                display_name=(cands.get(recent) or {}).get('name')
                prior=None
                if len(membs)>=2:                       # earliest linked candidacy = the prior one
                    pc=cands.get(membs[0]['candidacy_id']) or {}
                    pr=races_by_id.get(pc.get('race_id'),{})
                    yr=(membs[0]['election_id'] or '').split('-')[0]
                    prior={'label':(f"{yr}: {pr['district']}" if pr.get('district') else yr),
                           'office':pr.get('office'),'qualifier':pc.get('election_note') or ''}
                a=acc[ppid]
                by_person[ppid]={'display_name':display_name,'members':members,'prior':prior,
                    'direct':{'total':a['total'],'by_election':a['by_election'],'by_year':a['by_year']},
                    'donors':{'total':a['don_total'],'by_election':a['don_elec'],'by_year':a['don_year']}}

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
        d['rollups']['by_person']=by_person
    # build_rollups runs last (ordering authority: MECHANISM_REFERENCE.md §1) in both
    # the build_all derived step and ingest_ie, so
    # this is the single place that always fires on a (re)build. Stamp real build
    # time — the field was previously static and falsely read as "stale".
    d['generated_at']=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    # ELEC-FIGURE-1 R1 — emitted at every magnitude including zero (R1 ii), per-artifact
    # (R1 iii): this reflects the exclusions from THIS document's substrate, this build.
    d['dues_excluded']=dues_excluded_total()
    # ELEC-FIGURE-1 §2 — the version is written here, so it is a build product rather than
    # a hand-carried literal. String type preserved. See COUNCIL_SCHEMA_VERSION above for
    # why this keys off the field's presence rather than the artifact's name.
    if 'schema_version' in d:
        d['schema_version']=COUNCIL_SCHEMA_VERSION
    return {'by_parent':len(by_parent),'by_industry':len(by_industry),
            'by_alder':len(by_alder),'ies':len(ies),
            'by_candidate':len(by_candidate),'by_race':len(by_race),
            'by_candidate_election':len(by_candidate_election),
            'by_person':len(d['rollups'].get('by_person',{}))}

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
