"""ingest_ie.py — add independent expenditures + IE-committee funding from the
Illinois SBE bulk Expenditures/Receipts .txt files. Tab-delimited, latin-1, \\r\\n.

Scoping decisions baked in (flag to change):
  * Only expenditures with Supporting/Opposing flag are IEs.
  * Archived rows are amendments/superseded -> dropped.
  * Targets are matched by CANDIDATE NAME to the current 50 alders (ward used to
    disambiguate). IEs naming a *former* alder of a ward are out of scope, just
    like pre-2011 contributions.
  * Exact-duplicate rows (same committee+payee+candidate+amount+date+purpose) are
    collapsed once -> handles the 8x-dupe artifact and B-1/quarterly re-reports.
"""
import json, re, csv, sys, os, argparse, unicodedata
from collections import defaultdict
import build_rollups
from ingest import slug  # shared donor-id slug ([:80] cap) — keeps election donor_ids
                         # identical to council so one Sheet classification feeds both.
from convert_bulk_receipts import _contributed_by  # the receipts path's OWN name
                         # builder (LastOnlyName, FirstName) -> 'Last, First'; imported
                         # ABOVE the csv.field_size_limit line below, which re-raises
                         # the limit that module's import lowers. Order is load-bearing.
csv.field_size_limit(min(sys.maxsize, 2**31-1))

FIELD_MAP={
  "exp":{"committee_id":"CommitteeID","amount":"Amount","date":"ExpendedDate",
         "candidate":"CandidateName","office":"Office","supporting":"Supporting",
         "opposing":"Opposing","filed_doc_id":"FiledDocID","d2part":"D2Part",
         "purpose":"Purpose","payee_last":"LastOnlyName","payee_first":"FirstName",
         "archived":"Archived"},
  "rec":{"committee_id":"CommitteeID","last":"LastOnlyName","first":"FirstName",
         "amount":"Amount","date":"RcvDate","archived":"Archived","d2part":"D2Part"},
}
TRUTHY={"true","t","1","y","yes"}
def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',(s or '').lower())).strip()
def truthy(v): return str(v).strip().lower() in TRUTHY
def extract_ward(blob):
    m=re.search(r'(\d{1,2})(?:st|nd|rd|th)?\s*ward',blob,re.I) or re.search(r'ward\s*(\d{1,2})',blob,re.I)
    return int(m.group(1)) if m else None
def _district_key(s):
    # Normalize a registry district value to a bare compare-token: "District 1A" -> "1a",
    # "12" -> "12", "District 5" -> "5", None/president -> None. School-board members carry
    # a subdistrict LABEL (District 1A..10B) — the numeric+optional-letter is the identity.
    if not s: return None
    m=re.search(r'(\d{1,2})\s*([ab])?',str(s),re.I)
    return (m.group(1)+(m.group(2) or '').lower()) if m else None
def extract_district(blob):
    # Best-effort district token from free-text Office/CandidateName; DECLINE (None) on
    # absence. Anchored on the word "district" (or an explicit subdistrict-letter form like
    # "1A"/"10B") so a bare number is NOT read as a district — mirrors extract_ward's keyword
    # anchor. Used only to break a ward-absent/district-present same-name collision.
    m=re.search(r'district\s*(\d{1,2})\s*([ab])?',blob,re.I) or re.search(r'\b(\d{1,2})([ab])\b',blob,re.I)
    return (m.group(1)+(m.group(2) or '').lower()) if m else None
def cycle_for(date,cycles):
    if not date: return 'undated'
    rs=sorted(((k,c['start'],c['end']) for k,c in cycles.items()),key=lambda r:r[1])
    for k,s,e in rs:
        if s<=date<=e: return k
    return 'pre-2011' if date<rs[0][1] else rs[-1][0]
# SBE bulk exports are Windows-1252 (cp1252), NOT latin-1. The two agree on 0x00-0x7F and
# 0xA0-0xFF and disagree on 0x80-0x9F, where cp1252 carries real punctuation and latin-1
# carries C1 controls. latin-1 NEVER raises, so reading a cp1252 file as latin-1 is a SILENT
# mis-decode: 0x92 (a curly apostrophe) became U+0092, a control character, and rode into the
# artifact as a display name — `Daniel O\x92Keefe`, live on the deployed elections tool.
#
# The remedy is convert_bulk_receipts.py's, not a swapped encoding string: strict cp1252 with
# a byte pre-scan, so a future pull carrying one of the five unmapped bytes fails LOUDLY
# rather than corrupting quietly. A decoder that cannot fail is worse than one that can.
CP1252_UNMAPPED = {0x81, 0x8D, 0x8F, 0x90, 0x9D}


def prescan_unmapped(path):
    """Byte pre-scan: locate any cp1252-unmapped bytes. Returns [(offset, hexbyte), ...]."""
    hits, off = [], 0
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            for i, b in enumerate(chunk):
                if b in CP1252_UNMAPPED:
                    hits.append((off + i, hex(b)))
            off += len(chunk)
    return hits


def read_tsv(path):
    bad = prescan_unmapped(path)
    if bad:
        raise SystemExit(
            f"FATAL: {len(bad)} cp1252-unmapped byte(s) in {path} -- first 10: {bad[:10]}\n"
            f"  These bytes have no cp1252 character. Decoding would corrupt or crash.\n"
            f"  Inspect the source pull; do NOT fall back to latin-1, which hides this.")
    with open(path,encoding='cp1252',newline='') as f:
        r=csv.DictReader((line.replace('\r\n','\n') for line in f),delimiter='\t')
        for row in r: yield row

# ---- COUNCIL matcher: candidate name -> current alder (ward disambiguates) ----
def build_matcher(comms):
    alders=[]
    for k,c in comms.items():
        if c.get('type')!='candidate' or c.get('ward') is None or not c.get('alder_name'): continue
        toks=norm(c['alder_name']).split()
        if not toks: continue
        alders.append({'ward':int(c['ward']),'key':k,'surname':toks[-1],'first':toks[0],'toks':set(toks)})
    return alders
_COUNCIL=re.compile(r'alder|city council|\\bward\\b',re.I)
def match_target(cand,office,alders):
    # Require a council signal, then a surname match CORROBORATED by either the
    # alder's ward number or first name. Surname-alone is rejected -> prevents
    # cross-city collisions (e.g., Evanston "Lee Cabot" -> Chicago Nicole Lee).
    if not _COUNCIL.search((office or '')+' '+(cand or '')): return None,None
    ctoks=set(norm(cand).split()); ward=extract_ward((office or '')+' '+(cand or ''))
    hits=[a for a in alders if a['surname'] in ctoks]
    strong=[a for a in hits if (ward is not None and a['ward']==ward) or (a['first'] in ctoks)]
    if ward is not None:
        w=[a for a in strong if a['ward']==ward]
        if len(w)==1: return str(w[0]['ward']),w[0]['key']
    if len(strong)==1: return str(strong[0]['ward']),strong[0]['key']
    return None,None

# ---- ELECTION matcher: target -> candidate registry (candidates[]+races[]) ----
# SBE expenditure rows carry NO target committee identifier (only the SPENDER's
# CommitteeID); the target is free-text CandidateName + Office. So the authority
# is a controlled name match against the known candidate registry — per race the
# candidate set is small, so Office/ward disambiguates collisions. A defensive
# committee-id index is built too in case a target committee id ever appears.
# Election-only name helpers (do NOT touch the shared norm()): accent-fold to ASCII
# THEN apply norm, and tokenize dropping generational suffixes + lone middle initials.
_SUFFIX={'jr','sr','ii','iii','iv'}
def _fold(s): return unicodedata.normalize('NFKD',(s or '')).encode('ascii','ignore').decode()
def _foldnorm(s): return norm(_fold(s))
def _mtoks(s): return [t for t in _foldnorm(s).split() if t not in _SUFFIX and len(t)>1]
# P1-E (PS-140): a school-board candidacy is an IE target only for spending dated inside its
# election's window. The HALT-P1-B guard this replaces kept every 2024 school-board candidacy
# out of the index, so 2024-dated IE on a returner landed on the 2026 candidacy and IE on a
# 2024-only candidate matched nothing (the numbers audit's W7: 110 rows / $1,613,335.66 and
# 87 rows / $1,425,962.99 at the 2026-09-13 vintage). With every candidacy indexed, the
# window is what keeps a returner's two candidacies from colliding: a row's date admits one
# election, so the cross-election collision never forms (same-election ones resolve as before).
# Other offices carry no window and stay eligible for every row, as today (PS-140).
def _sb_windows():
    # {election_id: (start, end)} from election-windows.json, through build_rollups' fail-loud
    # reader (D-19 / PS-109): a missing window is an error, never an empty filter.
    return {f"{w['id']}-school-board": (w['start'], w['end'])
            for w in build_rollups.load_windows().get('school_board', [])}
def _eligible(entries, date):
    # A school-board entry is eligible only when `date` falls inside its window (a null start or
    # end is open-ended, as election-windows.json allows); an entry with no window (any other
    # office) is always eligible. date=None disables the filter: ingest() uses it only to REPORT.
    if date is None: return list(entries)
    return [e for e in entries if e.get('win') is None or ((e['win'][0] is None or e['win'][0] <= date) and (e['win'][1] is None or date <= e['win'][1]))]
def build_target_index(d):
    races_by_id={r['id']:r for r in d.get('races',[])}
    sbwin=_sb_windows()
    by_committee=defaultdict(list); by_name=defaultdict(list); by_folded=defaultdict(list); by_surname=defaultdict(list)
    for cand in d.get('candidates',[]):
        r=races_by_id.get(cand.get('race_id'),{})
        w=r.get('ward'); ward=int(w) if w not in (None,'') else None
        mt=_mtoks(cand.get('name'))
        is_sb=(r.get('office') or '').startswith('school_board')
        entry={'candidate_id':cand.get('id'),'race_id':cand.get('race_id'),
               'office':r.get('office'),'ward':ward,'district':r.get('district'),
               'committee_id':cand.get('committee_id'),
               'surname':(mt[-1] if mt else None),'given':set(mt[:-1]),
               'win':(sbwin.get(cand.get('election_id')) if is_sb else None)}
        if is_sb and entry['win'] is None:
            raise SystemExit(f"FATAL [PS-140] school-board candidacy {cand.get('id')!r} carries "
                             f"election_id {cand.get('election_id')!r}, which has no window in "
                             f"election-windows.json; refusing to index it without one")
        nm=norm(cand.get('name'))
        if nm: by_name[nm].append(entry)
        if cand.get('committee_id'): by_committee[str(cand['committee_id'])].append(entry)
        # SCOPE (HALT-3b Option A): the robust rungs (accent-fold + surname
        # corroboration + multi-name guard) are indexed ONLY for school_board targets,
        # so ward/mayor keep exact-only (Rung 0) = committed behavior. DEFERRED root
        # cause: the election target index shouldn't carry the 70 ward/incumbent stubs
        # at all; this structurally contains that until the registry is narrowed.
        if (r.get('office') or '').startswith('school_board'):
            fn=_foldnorm(cand.get('name'))
            if fn: by_folded[fn].append(entry)
            if entry['surname']: by_surname[entry['surname']].append(entry)
    return by_committee,by_name,by_folded,by_surname
def _tgt(e,method,needs_review):
    return {'target_committee_id':e['committee_id'],'target_candidate_id':e['candidate_id'],
            'target_race_id':e['race_id'],'target_ward':e['ward'],
            'match_method':method,'needs_review':needs_review}
def _resolve(hits,office,cand,method):
    # one hit = identity-grade (needs_review False); a same-name COLLISION broken by
    # ward/district/Office is flagged for review; an unresolved collision -> name_fallback.
    if len(hits)==1: return _tgt(hits[0],method,False)
    blob=(office or '')+' '+(cand or '')
    ward=extract_ward(blob)
    if ward is not None:
        w=[e for e in hits if e['ward']==ward]
        if len(w)==1: return _tgt(w[0],method,True)
    # WARD-ABSENT / DISTRICT-PRESENT: school-board hits carry `district`, not `ward`, so the
    # ward branch above can never break a same-name school-board collision. Break it on an
    # EXACT district-token match instead (best-effort; decline on absence). Vintage-safe by
    # construction: a row token that doesn't equal the entry's district-key simply declines
    # to name_fallback. Preventive — no current expenditure resolves into a same-name cohort,
    # so this is dormant until such a collision exists (cohort B).
    dk=extract_district(blob)
    if dk is not None:
        dd=[e for e in hits if _district_key(e.get('district'))==dk]
        if len(dd)==1: return _tgt(dd[0],method,True)
    return _tgt(hits[0],'name_fallback',True)
def match_target_registry(row,by_committee,by_name,by_folded,by_surname,date=None):
    # PS-140: every rung sees only the entries eligible for the row's date (_eligible).
    F=FIELD_MAP['exp']
    # 0) defensive committee-id (SBE exp rows carry only the SPENDER id today)
    tcid=row.get('CandidateID') or row.get('TargetCommitteeID')
    if tcid and str(tcid) in by_committee:
        ce=_eligible(by_committee[str(tcid)],date)
        if len(ce)==1: return _tgt(ce[0],'exact',False)
    cand=row.get(F['candidate']); office=row.get(F['office'])
    if not norm(cand): return None
    # Rung 0 — exact normalized full name (identity-grade)
    hits=_eligible(by_name.get(norm(cand),[]),date)
    if hits: return _resolve(hits,office,cand,'exact')
    # Rung 1 — equal after accent-folding (differed only by accents; identity-grade)
    fhits=_eligible(by_folded.get(_foldnorm(cand),[]),date)
    if fhits: return _resolve(fhits,office,cand,'accent_fold_exact')
    # MULTI-NAME GUARD — a beneficiary field naming >1 DISTINCT registry surname
    # (e.g. "Carlos Rivas, ... Michelle N. Pierre") must NOT single-match: route to
    # review without auto-attributing (return None; reported, not persisted).
    bt=_mtoks(cand)
    if len({t for t in bt if _eligible(by_surname.get(t,[]),date)})>1: return None
    # Rung 2 — surname + >=1 corroborating token (a given-name token OR Office/ward).
    # Surname-alone is rejected; no fuzzy / edit-distance.
    bsur=bt[-1] if bt else None; bgiven=set(bt[:-1])
    cohort=_eligible(by_surname.get(bsur,[]),date) if bsur else []
    if not cohort: return None
    g=[e for e in cohort if e['given'] & bgiven]
    if len(g)==1: return _tgt(g[0],'surname_plus_given',True)
    ward=extract_ward((office or '')+' '+(cand or ''))
    o=[e for e in cohort if ward is not None and e['ward']==ward]
    if len(o)==1: return _tgt(o[0],'surname_plus_office',True)
    return None

def ingest(d, exp_path, rec_path, dry_run=False, progress=True):
    cycles=d['cycles']; comms=d['committees']; donors=d['donors']
    # Election mode (races[]+candidates[] present) resolves IE targets against the
    # candidate registry; council mode keeps the current-50-alders matcher unchanged.
    election_mode=bool(d.get('races')) and bool(d.get('candidates'))
    if election_mode:
        by_committee,by_name,by_folded,by_surname=build_target_index(d)
        sb_races={r['id'] for r in d.get('races',[]) if (r.get('office') or '').startswith('school_board')}
    else:
        alders=build_matcher(comms)
    # precomputed indexes (built once)
    sbe_idx={c['sbe_committee_id']:k for k,c in comms.items() if c.get('sbe_committee_id')}
    cname_idx={norm(c.get('committee_name') or ''):k for k,c in comms.items()}
    dname_idx={norm(v.get('name') or ''):vid for vid,v in donors.items()}

    def promote(sbe,name):
        if sbe and sbe in sbe_idx: return sbe_idx[sbe]
        if norm(name) in cname_idx: return cname_idx[norm(name)]
        key=re.sub(r'[^a-z0-9]+','-',norm(name)).strip('-') or ('cmte-'+str(sbe))
        b=key; i=2
        while key in comms: key=b+'-'+str(i); i+=1
        donor_id=dname_idx.get(norm(name))
        comms[key]={'id':key,'type':'independent_expenditure','committee_name':name,
            'sbe_committee_id':sbe,'ward':None,'alder_name':None,'industry_tags':[],
            'donor_id':donor_id,'data_quality':'INGESTED_IE'}
        if sbe: sbe_idx[sbe]=key
        cname_idx[norm(name)]=key
        if donor_id: donors[donor_id]['committee_id']=key
        return key
    def resolve_donor(name,dtype):
        n=norm(name)
        if n in dname_idx: return dname_idx[n]
        # Shared donor-id: use ingest.slug (with its [:80] cap) so long-name donors
        # get the SAME id the council ingest would assign — that's what lets one
        # Sheet classification key both tools. (Was a local slug lacking the cap.)
        did=slug(name) or 'donor'
        b=did; i=2
        while did in donors: did=b+'-'+str(i); i+=1
        donors[did]={'id':did,'name':name,'type':dtype or 'Other','industries':[],'flags':[],
            'notes':None,'city':None,'parent_id':did,'committee_id':None}
        dname_idx[n]=did
        return did

    F=FIELD_MAP['exp']; seen={}; raw=0; matched=0; dups=0; unmatched=0; spenders={}; cand_spender_skipped=0
    method_counts=defaultdict(int); review_n=0; sb_outside=0; sb_outside_amt=0.0
    ies=[]
    for i,row in enumerate(read_tsv(exp_path)):
        if progress and i%500000==0 and i: sys.stderr.write(f'  ..exp {i:,}\n')
        if truthy(row.get(F['archived'])): continue
        sup=truthy(row.get(F['supporting'])); opp=truthy(row.get(F['opposing']))
        if not (sup or opp): continue
        raw+=1
        if election_mode:
            _date=(row.get(F['date']) or '')[:10]
            tgt=match_target_registry(row,by_committee,by_name,by_folded,by_surname,date=_date)
            if tgt is None:
                # PS-140's report: a row that matches a school-board candidacy only with the window
                # lifted stays unmatched and is COUNTED (here, before de-duplication and the skip).
                t2=match_target_registry(row,by_committee,by_name,by_folded,by_surname,date=None)
                if t2 and t2.get('target_race_id') in sb_races:
                    sb_outside+=1; sb_outside_amt+=float(row.get(F['amount']) or 0)
        else:
            ward,tcmte=match_target(row.get(F['candidate']),row.get(F['office']),alders)
            tgt=None if ward is None else {'target_committee_id':tcmte,'target_candidate_id':None,
                'target_race_id':None,'target_ward':ward,'match_method':'alder_ward','needs_review':False}
        if tgt is None: unmatched+=1; continue
        amt=float(row.get(F['amount']) or 0); date=(row.get(F['date']) or '')[:10]
        payee=norm((row.get(F['payee_first']) or '')+' '+(row.get(F['payee_last']) or ''))
        sbe=row.get(F['committee_id'])
        # A candidate/alder committee is never an independent spender. If the filer
        # resolves to an existing non-IE committee in the registry, this expenditure is
        # its own campaign spend (or a candidate-to-candidate transfer), not an IE —
        # don't emit it. (Council: Friends-of-X ward committees. Elections: any seeded
        # school-board candidate committee.)
        _spk = sbe_idx.get(sbe); _cm = comms.get(_spk) if _spk else None
        if _cm and _cm.get('type') != 'independent_expenditure':
            cand_spender_skipped += 1; continue
        dk=(sbe,payee,norm(row.get(F['candidate'])),round(amt,2),date,norm(row.get(F['purpose'])))
        if dk in seen: dups+=1; continue
        seen[dk]=1; matched+=1
        method_counts[tgt['match_method']]+=1
        if tgt['needs_review']: review_n+=1
        spenders.setdefault(sbe,0); spenders[sbe]+=amt
        if not dry_run:
            spk=promote(sbe,'IE committee '+str(sbe))
            base={'id':'ie-'+str(sbe)+'-'+str(row.get(F['filed_doc_id']))+'-'+str(matched),
                'spender_committee_id':spk}
            if election_mode:
                base.update({'target_committee_id':tgt['target_committee_id'],
                    'target_candidate_id':tgt['target_candidate_id'],
                    'target_race_id':tgt['target_race_id'],'target_ward':tgt['target_ward'],
                    'match_method':tgt['match_method'],'needs_review':tgt['needs_review']})
            else:
                # council shape unchanged: target_ward + target_committee_id only
                base.update({'target_ward':tgt['target_ward'],
                    'target_committee_id':tgt['target_committee_id']})
            base.update({'stance':'support' if sup else 'oppose','amount':amt,'date':date,
                'cycle':cycle_for(date,cycles),'source_filing':row.get(F['d2part']),
                'filed_doc_id':row.get(F['filed_doc_id']),'purpose':row.get(F['purpose'])})
            ies.append(base)
    stats={'exp_ie_nonarchived':raw,'matched_to_current_alders':matched,
           'exact_dups_collapsed':dups,'ie_committees':len(spenders),'candidate_cmte_spender_skipped':cand_spender_skipped,
           'matched_total':round(sum(spenders.values()),2)}
    if election_mode:
        stats.update({'mode':'election','unmatched':unmatched,
            'matched_by_committee_id':method_counts.get('committee_id',0),
            'matched_by_registry_name':method_counts.get('registry_name',0),
            'matched_by_name_fallback':method_counts.get('name_fallback',0),
            'flagged_needs_review':review_n,
            'sb_outside_window':sb_outside,'sb_outside_window_total':round(sb_outside_amt,2)})
    if dry_run: return stats

    # IDEMPOTENCY: drop any IE-committee receipt rows from a previous run before
    # re-adding this run's. ingest_ie APPENDS receipts, so without this a re-run
    # (or running on a base that already carries IE data, e.g. the committed file)
    # silently doubles/triples them. The IE committees (promote) and funder donors
    # (resolve_donor) are reused by sbe/name, so they don't multiply — only these
    # contributions do. 'independent_expenditures' is reassigned below, not appended.
    _before=len(d['contributions'])
    d['contributions']=[c for c in d['contributions']
                        if not str(c.get('contribution_type','')).startswith('IE Committee')]
    stats['prior_ie_receipts_cleared']=_before-len(d['contributions'])

    d['independent_expenditures']=ies
    # pull IE committees' OWN funders -> contributions rows
    G=FIELD_MAP['rec']; want={comms[k]['sbe_committee_id']:k for k in
        {ie['spender_committee_id'] for ie in ies} if comms[k].get('sbe_committee_id')}
    # A union transferring its OWN member dues into its OWN PAC is internal funding,
    # not Council spend. The SBE labels these with a descriptor ("dues"/"membership"/
    # "member contributions"). We keep the rows (auditable, and some are cluster
    # members) but TYPE them distinctly so build_rollups + the embed can exclude them
    # from spend/donor totals. We do NOT use org-name overlap to detect self-funding:
    # that pulls in surname collisions (e.g. "Peter Villegas" -> a Gilbert Villegas
    # committee) and would wrongly drop genuine third-party IE funders (James Frank
    # -> INCS, the Sacks -> Chicago Forward), which are exactly the money we surface.
    DUES_RE=re.compile(r'\b(dues|membership|member\s+contributions?)\b',re.I)
    added=0; dues_rows=0
    for i,row in enumerate(read_tsv(rec_path)):
        if progress and i%1000000==0 and i: sys.stderr.write(f'  ..rec {i:,}\n')
        sbe=row.get(G['committee_id'])
        if sbe not in want: continue
        if truthy(row.get(G['archived'])): continue
        # IE-NAMES-1 (open ledger 73): build the funder name in the receipts ingest's
        # form -- convert_bulk_receipts._contributed_by (convert_bulk_receipts.py:323)
        # is the SAME function that builds 'ContributedBy', which ingest.py:292 hands
        # to the shared slug. One function, so the two paths cannot diverge again.
        nm=_contributed_by(row.get(G['last']) or '', row.get(G['first']) or '')
        is_dues=bool(DUES_RE.search(nm))
        did=resolve_donor(nm,'Other'); date=(row.get(G['date']) or '')[:10]
        if is_dues:
            dues_rows+=1
            dn=donors[did]; dn['ie_funding']='dues'   # downstream-exclusion marker
            if not any(f.get('type')=='pac_dues_funding' for f in dn.get('flags',[])):
                dn.setdefault('flags',[]).append({'type':'pac_dues_funding',
                    'note':"Member-dues transfer into the committee's own PAC; not Council spend."})
        d['contributions'].append({'id':'ie-rec-'+str(sbe)+'-'+str(added),'donor_id':did,
            'committee_id':want[sbe],'amount':float(row.get(G['amount']) or 0),'date':date,
            'cycle':cycle_for(date,cycles),
            'contribution_type':'IE Committee Dues Transfer' if is_dues else 'IE Committee Receipt',
            'source_filing':'Receipts'})
        added+=1
    stats['funder_receipts_added']=added; stats['dues_transfer_rows']=dues_rows
    build_rollups.build(d)
    # IE-NAMES-1 (open ledger 73), ruling 4: prune donors THIS RUN orphaned.
    # ingest_ie clears and re-adds its own rows above; a donor whose only rows were
    # IE rows under a retired id is left with none, and nothing downstream removes
    # donor records -- ingest.py's orphan prune (ingest.py:530-538) runs UPSTREAM of
    # this step. Referenced is over ALL contributions, so a receipts-side donor can
    # never be pruned. Placed AFTER build_rollups.build(d) deliberately: that call
    # indexes donors[dv['parent_id']] directly (build_rollups.py:171), and donors
    # carried over from a prior sync can name a retired id as their cluster parent,
    # so pruning before it would KeyError. Its rollups are intermediate and the
    # chain's own build_rollups (step 7) overwrites them after sync_overrides.
    _referenced={c.get('donor_id') for c in d['contributions']}
    _orphans=[did for did in d['donors'] if did not in _referenced]
    for did in _orphans: del d['donors'][did]
    stats['donors_pruned_rowless']=len(_orphans)
    return stats

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--council',required=True); ap.add_argument('--expenditures',required=True)
    ap.add_argument('--receipts'); ap.add_argument('--out'); ap.add_argument('--dry-run',action='store_true')
    ap.add_argument('--shards',help='shards dir; if given, rebuild shards from --out after IE '
                    '(keeps shards in sync — build_all builds shards BEFORE this step, so '
                    'without this the shards miss IE/dues data)')
    a=ap.parse_args()
    d=json.load(open(a.council))
    s=ingest(d,a.expenditures,a.receipts,dry_run=a.dry_run)
    print('[ingest_ie]',json.dumps(s,indent=2))
    if not a.dry_run and a.out:
        json.dump(d,open(a.out,'w'),indent=2,ensure_ascii=True); print('[write]',a.out)
        if a.shards:
            import subprocess, os
            bs=os.path.join(os.path.dirname(os.path.abspath(__file__)),'build_shards.py')
            print('[ingest_ie] rebuilding shards from',a.out,'->',a.shards)
            subprocess.run([sys.executable,bs,a.out,a.shards],check=True)
