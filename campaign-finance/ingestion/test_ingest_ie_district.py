"""Unit tests for the ward-absent/district-present collision fix in ingest_ie._resolve.

These are non-optional precisely BECAUSE the fix is dormant on live data: no real
expenditure resolves into a same-name school-board cohort, so the A.4 full-dataset run
(independent_expenditures byte-identical, incl. every ward match) proves the fix changes
nothing — but only these synthetic fixtures prove the ACTIVE path behaves when a collision
does exist. Run: python3 test_ingest_ie_district.py   (plain stdlib, no pytest).

Covers the brief's required cases:
  (a) same-name / different-district  -> resolves to the district-corroborated candidate
  (b) same-name / same-district-token -> falls through flagged, never arbitrary
  (c) ward path                       -> unchanged (ward-broken + single-hit identity)
  (d) missing row-side geo            -> declines to name_fallback
plus extractor decline/anchor behavior and the president<->member dormancy invariant.
PS-140 date routing and PS-154 confirmation-file cases follow, each under its own heading.
"""
import importlib.util, sys, os, json

_HERE=os.path.dirname(os.path.abspath(__file__))
spec=importlib.util.spec_from_file_location("ingest_ie",os.path.join(_HERE,"ingest_ie.py"))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

def E(cid,race,ward=None,district=None,cmte=None):
    # minimal registry entry as _resolve/_tgt consume it
    return {'candidate_id':cid,'race_id':race,'ward':ward,'district':district,
            'committee_id':cmte,'office':'school_board_member','surname':None,'given':set()}

PASS=0; FAIL=0
def check(name,got,exp):
    global PASS,FAIL
    ok = got==exp
    print(("PASS " if ok else "FAIL "),name)
    if not ok:
        print("      got:",got); print("      exp:",exp)
    PASS+= ok; FAIL+= (not ok)

# ---- extractor / normalizer ------------------------------------------------
ed=m.extract_district; dk=m._district_key
check("extract 'School Board District 12'", ed("School Board District 12"), "12")
check("extract 'Opposing X, District 1A'",  ed("Opposing X, District 1A"),  "1a")
check("extract '...10B seat'",              ed("D. Smith 10B seat"),        "10b")
check("extract declines bare number",       ed("candidate raised 5 dollars"), None)
check("extract declines ward text",         ed("Ward 5 alderman"),          None)
check("extract declines no-geo",            ed("Carlos Rivas for the board"),None)
check("key 'District 1A'->'1a'",            dk("District 1A"),              "1a")
check("key 'District 10B'->'10b'",          dk("District 10B"),             "10b")
check("key '12'->'12'",                     dk("12"),                       "12")
check("key None->None (president)",         dk(None),                       None)

# ---- (a) same-name, different district: district-corroborated resolution ----
hits_ab=[E('riv-1a','sb-d01a',district='District 1A'),
         E('riv-2a','sb-d02a',district='District 2A')]
r=m._resolve(list(hits_ab),'School Board District 2A','Carlos Rivas','exact')
check("(a) district-corroborated -> d2a candidate", r['target_candidate_id'], 'riv-2a')
check("(a) method preserved (not name_fallback)",   r['match_method'],        'exact')
check("(a) flagged needs_review True",              r['needs_review'],        True)

# ---- (b) same-name, token matches >1 hit: NEVER arbitrary, falls through ----
hits_bb=[E('a1','sb-d01a',district='District 1A'),
         E('a2','sb-d01a',district='District 1A')]   # two candidacies share the token
r=m._resolve(list(hits_bb),'School Board District 1A','Ambiguous Name','exact')
check("(b) ambiguous token -> name_fallback",       r['match_method'],        'name_fallback')
check("(b) did NOT pick a district-corroborated hit (method not 'exact')",
      r['match_method']!='exact', True)
check("(b) still flagged needs_review True",         r['needs_review'],        True)

# ---- (c) ward path: unchanged (ward-broken + single-hit identity) -----------
hits_c=[E('w5','ward-05',ward=5),E('w10','ward-10',ward=10)]
r=m._resolve(list(hits_c),'Alderperson Ward 5','Some Alder','exact')
check("(c) ward-broken -> ward-5 candidate",         r['target_candidate_id'],'w5')
check("(c) ward-broken method preserved",            r['match_method'],       'exact')
check("(c) ward-broken needs_review True",           r['needs_review'],       True)
r1=m._resolve([E('solo','ward-07',ward=7)],'Alderperson Ward 7','Solo','exact')
check("(c) single hit -> identity, needs_review False", r1['needs_review'],   False)
check("(c) single hit method preserved",             r1['match_method'],      'exact')

# ---- (d) missing row-side geo: decline to name_fallback --------------------
r=m._resolve(list(hits_ab),'School Board','Carlos Rivas','exact')  # no ward, no district token
check("(d) no geo -> name_fallback",                 r['match_method'],       'name_fallback')
check("(d) no geo -> hits[0] (deterministic, not arbitrary)", r['target_candidate_id'],'riv-1a')
check("(d) no geo needs_review True",                r['needs_review'],       True)

# ---- president<->member dormancy invariant (registry same-person collision) -
pm=[E('pres','sb-president',district=None),E('mem','sb-d12',district='District 12')]
r=m._resolve(list(pm),'School Board District 12','Jessica Biggs','exact')
check("(pm) token=12 -> member (president has no district token)", r['target_candidate_id'],'mem')
r=m._resolve(list(pm),'School Board President','Jessica Biggs','exact')
check("(pm) no token -> name_fallback hits[0]",      r['match_method'],       'name_fallback')

# ---- PS-140: date-routed school-board targets (P1-E) --------------------------
# A synthetic registry: one person holding a 2024 AND a 2026 school-board candidacy (same name,
# shared committee id), a 2024-only candidate, and an alderperson. The windows are read from
# the committed election-windows.json (2024: 2024-01-01..2024-12-31; 2026: 2025-01-01..).
# PS-128 declaration: MODE E. The registry and the rows are constructed; the windows are live,
# read from election-windows.json, and the first (E7) case asserts that premise before any
# case depends on it.
check("(E7) premise: the school-board windows read are 2024 and 2026 as committed", m._sb_windows(),
      {'2024-school-board':('2024-01-01','2024-12-31'),'2026-school-board':('2025-01-01','2026-12-31')})
D={'races':[{'id':'sb-2024-d4','office':'school_board_member','district':'4'},
            {'id':'sb-d07','office':'school_board_member','district':'District 7'},
            {'id':'sb-2024-d9','office':'school_board_member','district':'9'},
            {'id':'ward-05','office':'alderperson','ward':'5'}],
   'candidates':[{'id':'z-2024','name':'Karen Zaccor','race_id':'sb-2024-d4','election_id':'2024-school-board','committee_id':'777'},
                 {'id':'z-2026','name':'Karen Zaccor','race_id':'sb-d07','election_id':'2026-school-board','committee_id':'777'},
                 {'id':'l-2024','name':'Miquel Lewis','race_id':'sb-2024-d9','election_id':'2024-school-board','committee_id':None},
                 {'id':'inc-ward-05','name':'Some Alder','race_id':'ward-05','election_id':'2027-municipal','committee_id':'555'}]}
IX=m.build_target_index(D)
def row(name,office='Board of Education',cid=None):
    r={'CandidateName':name,'Office':office}
    if cid: r['TargetCommitteeID']=cid
    return r
def tgt(r,date):
    t=m.match_target_registry(r,*IX,date=date); return t['target_candidate_id'] if t else None
check("(E7) 2024-dated row on a returner -> the 2024 candidacy", tgt(row('Karen Zaccor'),'2024-10-02'), 'z-2024')
check("(E7) the same name dated 2026 -> the 2026 candidacy",     tgt(row('Karen Zaccor'),'2026-02-02'), 'z-2026')
t=m.match_target_registry(row('Karen Zaccor'),*IX,date='2024-10-02')
check("(E7) one eligible hit is identity-grade: needs_review False", t['needs_review'], False)
check("(E7) a 2024-only candidate dated 2024 -> matched",         tgt(row('Miquel Lewis'),'2024-10-01'), 'l-2024')
check("(E7) a 2024-only candidate dated 2026 -> unmatched",       tgt(row('Miquel Lewis'),'2026-01-15'), None)
check("(E7) a school-board name dated outside every window -> unmatched", tgt(row('Karen Zaccor'),'2023-01-05'), None)
check("(E7) ...and date=None (the report path only) finds it",   tgt(row('Karen Zaccor'),None) is not None, True)
check("(E7) the shared committee id resolves by date: 2024",     tgt(row('Nobody','x','777'),'2024-06-01'), 'z-2024')
check("(E7) the shared committee id resolves by date: 2026",     tgt(row('Nobody','x','777'),'2025-06-01'), 'z-2026')
check("(E7) an alderperson carries no window: a 2019 row still matches", tgt(row('Some Alder','Alderperson Ward 5'),'2019-02-01'), 'inc-ward-05')
try:
    m.build_target_index({'races':[{'id':'sb-x','office':'school_board_member'}],
                          'candidates':[{'id':'x','name':'A B','race_id':'sb-x','election_id':'2030-school-board'}]})
    check("(E7) a school-board candidacy with no window is refused", False, True)
except SystemExit as e:
    check("(E7) a school-board candidacy with no window is refused", 'PS-140' in str(e), True)
OPEN=[{'candidate_id':'a','win':(None,'2024-12-31')},{'candidate_id':'b','win':('2025-01-01',None)}]
check("(E7) a null start or end is open-ended, as election-windows.json allows",
      [[e['candidate_id'] for e in m._eligible(OPEN,dt)] for dt in ('2019-05-01','2031-05-01')], [['a'],['b']])

# ---- PS-154: the confirmation file and the lookup (PS-150's pairs) ------------------------
# PS-128 declaration: MODE E on the axes declared above (the registry D and the rows are
# constructed; the windows are live, their premise asserted at the first E7 case). Every
# confirmation file is constructed too: a temp file the case writes and hands to the loader.
# One case alone reads the tracked file, and asserts only that the loader accepts it. The cases
# that look at WRITTEN rows run ingest() whole, so build_rollups reads the two tracked files it
# always reads (election-windows.json, own-committee-transfers.json); no data artifact is read.
# Karen Zaccor stands in for PS-150's Carlos Rivas: one filed name, a 2024 and a 2026 candidacy,
# the row's date deciding which.
import tempfile
_TD=tempfile.mkdtemp(prefix='ie-conf-')
HDR='filed_name\tcandidate_id\tstatus\truled\tseen_as'
def conf(*lines,name='conf.tsv',raw=None):
    p=os.path.join(_TD,name)
    with open(p,'wb') as f: f.write(raw if raw is not None else ''.join(l+'\n' for l in lines).encode('utf-8'))
    return p
def stops(p):
    # None when the loader accepts the file; else the message it stopped with
    try: m.load_confirmations(p); return None
    except SystemExit as e: return str(e)
def stopped(p,*needles): s=stops(p); return s is not None and 'PS-154' in s and p in s and all(n in s for n in needles)
GOOD=('# a comment line','# another',HDR,
      'miquel d lewis\tl-2024\tconfirmed\t2026-10-10\t"Mike D. Lewis | Miquel "Mike" D. Lewis',
      '# a comment between rows',
      'karen a zaccor\tz-2024\tconfirmed\t2026-10-10\tKaren A. Zaccor | Karen A Zaccor')
P=m.load_confirmations(conf(*GOOD))
check("(C) control: a valid file loads, comments skipped; a seen_as opening with an unclosed double quote swallows no row", P,
      {('karen a zaccor','z-2024'),('miquel d lewis','l-2024')})
check("(C) control: the same file with no final newline loads the same", m.load_confirmations(conf(raw='\n'.join(GOOD).encode())), P)
check("(C) control: one filed name confirmed for two candidacies is two pairs, not a repeat",
      len(m.load_confirmations(conf(HDR,'karen a zaccor\tz-2024\tconfirmed\tx\ty','karen a zaccor\tz-2026\tconfirmed\tx\ty'))), 2)
check("(C) control: a header and no pair is an empty set, not a stop", m.load_confirmations(conf(HDR)), set())
check("(C) control: a CRLF copy of the file loads the same pairs (line endings are not content)",
      m.load_confirmations(conf(raw='\r\n'.join(GOOD+('',)).encode())), P)
check("(C) control: only a line break ends a row: a seen_as holding U+2028 or a form feed is one field",
      len(m.load_confirmations(conf(HDR,'karen a zaccor\tz-2024\tconfirmed\tx\tKaren\u2028A.\x0cZaccor'))), 1)
check("(C) the tracked file is one the loader accepts", stops(m.CONFIRMATIONS_PATH), None)
def flag(name,date,pairs=P):
    # the lookup as ingest() applies it: only a flagged match is put to the file
    t=m.match_target_registry(row(name),*IX,date=date)
    lifted=t['needs_review'] and m.confirmed(pairs,name,t['target_candidate_id'])
    return (t['target_candidate_id'],t['match_method'],t['needs_review'] and not lifted)
check("(C) premise: with no pair in the file the filed variant is a flagged surname_plus_given match",
      flag('Karen A. Zaccor','2024-10-02',set()), ('z-2024','surname_plus_given',True))
check("(C) a confirmed pair arrives unflagged, its candidacy and method as matched",
      flag('Karen A. Zaccor','2024-10-02'), ('z-2024','surname_plus_given',False))
check("(C) the key is the name through norm(): case, punctuation and spacing do not matter",
      flag('  KAREN  A ZACCOR,','2024-10-02'), ('z-2024','surname_plus_given',False))
check("(C) the same filed name matched to another candidacy arrives flagged",
      flag('Karen A. Zaccor','2026-02-02'), ('z-2026','surname_plus_given',True))
check("(C) a new spelling of a confirmed candidate arrives flagged",
      flag('Karen Ann Zaccor','2024-10-02'), ('z-2024','surname_plus_given',True))
check("(C) an exact, unflagged row is untouched", flag('Karen Zaccor','2024-10-02'), ('z-2024','exact',False))
check("(C) confirmed() is the pair and nothing looser: the candidacy alone, or the name alone, is not enough",
      [m.confirmed(P,'Karen Zaccor','z-2024'),m.confirmed(P,'Karen A. Zaccor','l-2024'),m.confirmed(P,None,'z-2024')], [False]*3)
# each stop condition stops, naming the file and the line
OK1='karen a zaccor\tz-2024\tconfirmed\t2026-10-10\tKaren A. Zaccor'
check("(C) stop: the file is missing",                   stopped(os.path.join(_TD,'absent.tsv'),'missing or unreadable'), True)
check("(C) stop: the path is unreadable (a directory)",  stopped(_TD,'missing or unreadable'), True)
check("(C) stop: the file is not UTF-8 text",            stopped(conf(raw=(HDR+'\n'+OK1+' \xe9\n').encode('latin-1')),'missing or unreadable'), True)
check("(C) stop: no header at all (comments only)",      stopped(conf('# only a comment'),'no header line'), True)
check("(C) stop: an empty file",                         stopped(conf(raw=b''),'no header line'), True)
check("(C) stop: the header's columns in another order", stopped(conf('candidate_id\tfiled_name\tstatus\truled\tseen_as',OK1),'line 1','header'), True)
check("(C) stop: a header of four columns",              stopped(conf('filed_name\tcandidate_id\tstatus\truled',OK1),'line 1','header'), True)
check("(C) stop: a first row where the header should be",stopped(conf('# c',OK1),'line 2','header'), True)
check("(C) stop: a header split on spaces, not tabs",    stopped(conf(HDR.replace('\t',' '),OK1),'line 1','header'), True)
check("(C) stop: a header of six columns",               stopped(conf(HDR+'\tnote',OK1+'\tx'),'line 1','header'), True)
check("(C) stop: a header cell padded with a space",     stopped(conf(HDR.replace('status','status '),OK1),'line 1','header'), True)
check("(C) stop: a header in capitals",                  stopped(conf(HDR.upper(),OK1),'line 1','header'), True)
check("(C) stop: a byte-order mark before the header",   stopped(conf(raw=b'\xef\xbb\xbf'+(HDR+'\n'+OK1+'\n').encode()),'line 1','header'), True)
check("(C) stop: an indented # line is a row, not a comment", stopped(conf(HDR,OK1,' # not a comment'),'line 3','1 tab-separated'), True)
check("(C) stop: two newlines at the end (the second is an empty row)", stopped(conf(raw=(HDR+'\n'+OK1+'\n\n').encode()),'line 3','1 tab-separated'), True)
check("(C) stop: a row of four fields",                  stopped(conf(HDR,'karen a zaccor\tz-2024\tconfirmed\t2026-10-10'),'line 2','4 tab-separated'), True)
check("(C) stop: a row of six fields",                   stopped(conf(HDR,OK1+'\textra'),'line 2','6 tab-separated'), True)
check("(C) stop: an empty line among the rows",          stopped(conf(HDR,OK1,'','miquel d lewis\tl-2024\tconfirmed\tx\ty'),'line 3','1 tab-separated'), True)
check("(C) stop: an empty line before the header",       stopped(conf('',HDR,OK1),'line 1','header'), True)
for bad in ('Karen A Zaccor','karen a. zaccor',' karen a zaccor','karen  a zaccor','karen a zaccor ','zaccor, karen'):
    check(f"(C) stop: a filed name not in norm()'s form: {bad!r}", stopped(conf(HDR,OK1.replace('karen a zaccor',bad,1)),'line 2','could never match'), True)
check("(C) stop: a pair appears twice",                  stopped(conf(HDR,OK1,'# c',OK1.replace('2026-10-10','2026-10-11')),'line 4','appears twice'), True)
for bad in ('struck','Confirmed','','confirmed '):
    check(f"(C) stop: a status other than confirmed: {bad!r}", stopped(conf(HDR,OK1.replace('confirmed',bad)),'line 2','status'), True)
# ingest() itself, over temp expenditures files: the election run reads the file before any row
# and counts what it confirmed; the council run never opens it.
def exp(*rows,name='exp.txt'):
    # rows: (candidate name, date[, office]); every other field fixed, so two equal rows are exact duplicates
    p=os.path.join(_TD,name)
    with open(p,'w',encoding='cp1252',newline='') as f:
        f.write('\t'.join(m.FIELD_MAP['exp'].values())+'\r\n')
        for nm,dt,*off in rows:
            f.write('\t'.join(['900','100.00',dt+' 00:00:00',nm,(off or ['Board of Education'])[0],'True','False','1','9B','Mail','Payee','','False'])+'\r\n')
    return p
EXP=exp(('Karen A. Zaccor','2024-10-02'),('Karen A. Zaccor','2026-02-02'),('Karen Zaccor','2024-10-03'))
# IEA-1/2/3: the alias list and the dispositions are the registry's, so every case here reads
# its own (empty unless a case says otherwise) and writes its report into the temp folder.
import ie_unmatched as U
def iea_lists(aliases=(),dispositions=()):
    a=os.path.join(_TD,'aliases.tsv'); b=os.path.join(_TD,'dispositions.tsv')
    with open(a,'w',encoding='utf-8') as f: f.write('\t'.join(U.ALIASES_HEADER)+'\n'+''.join(l+'\n' for l in aliases))
    with open(b,'w',encoding='utf-8') as f: f.write('\t'.join(U.DISPOSITIONS_HEADER)+'\n'+''.join(l+'\n' for l in dispositions))
    return a,b
def run(d,path,exp_path=None,rec=None,dry_run=True):
    # the stats (dry run) or the written document; the SystemExit message if the run stopped
    keep=(m.CONFIRMATIONS_PATH,U.ALIASES_PATH,U.DISPOSITIONS_PATH,U.REPORT_PATH); m.CONFIRMATIONS_PATH=path
    U.ALIASES_PATH,U.DISPOSITIONS_PATH=iea_lists(); U.REPORT_PATH=os.path.join(_TD,'report.json')
    d=dict(json.loads(json.dumps(d)),cycles={'2027':{'start':'2023-05-16','end':'2027-05-15'}},donors={},contributions=[])
    d.setdefault('committees',{})
    try: s=m.ingest(d,exp_path or EXP,rec,dry_run=dry_run,progress=False)
    except SystemExit as e: return str(e)
    finally: m.CONFIRMATIONS_PATH,U.ALIASES_PATH,U.DISPOSITIONS_PATH,U.REPORT_PATH=keep
    return s if dry_run else d
def dry(d,path,exp_path=None): return run(d,path,exp_path)
s=dry(D,conf(*GOOD))
check("(C) ingest(): of three matched rows the file confirms one, one stays flagged, the exact row is neither",
      (s['matched_to_current_alders'],s['confirmed_by_file'],s['flagged_needs_review']), (3,1,1))
s=dry(D,conf(*GOOD,'karen zaccor\tz-2024\tconfirmed\t2026-10-10\tKaren Zaccor'))
check("(C) ingest(): a pair naming the exact row confirms nothing more: a row that was not flagged is not put to the file",
      (s['confirmed_by_file'],s['flagged_needs_review']), (1,1))
s=dry(D,conf(HDR))
check("(C) ingest(): with no pair in the file both variant rows stay flagged", (s['confirmed_by_file'],s['flagged_needs_review']), (0,2))
s=dry(D,conf(*GOOD),exp(('Karen A. Zaccor','2024-10-02'),('Karen A. Zaccor','2026-02-02'),('Karen Zaccor','2024-10-03'),('Karen Ann Zaccor','2024-10-04'),name='exp4.txt'))
check("(C) ingest(): a lifted flag does not leak to a later row: a new spelling after the confirmed row stays flagged",
      (s['matched_to_current_alders'],s['confirmed_by_file'],s['flagged_needs_review']), (4,1,2))
s=dry(D,conf(*GOOD),exp(('Karen A. Zaccor','2024-10-02'),('Karen A. Zaccor','2024-10-02'),name='expdup.txt'))
check("(C) ingest(): an exact duplicate of a confirmed row is collapsed before the lookup, not confirmed twice",
      (s['matched_to_current_alders'],s['exact_dups_collapsed'],s['confirmed_by_file'],s['flagged_needs_review']), (1,1,1,0))
ABSENT=os.path.join(_TD,'absent.tsv')
s=dry(D,ABSENT)
check("(C) ingest(): the election run stops on a missing file", isinstance(s,str) and 'PS-154' in s, True)
s=dry(D,ABSENT,exp(('Karen Zaccor','2024-10-03'),('Miquel Lewis','2024-10-01'),name='expexact.txt'))
check("(C) ingest(): ...before it matches a row: it stops though no row would have been flagged", isinstance(s,str) and 'PS-154' in s, True)
s=dry(D,ABSENT,exp(name='expnone.txt'))
check("(C) ingest(): ...and though the expenditures file holds no row at all", isinstance(s,str) and 'PS-154' in s, True)
s=dry({},ABSENT)
check("(C) ingest(): the council run does not read the file (a missing one is no stop)",
      isinstance(s,dict) and 'confirmed_by_file' not in s and s['exp_ie_nonarchived']==3, True)
# ...and as a full run, looking at the rows it WRITES (a receipts file of a header and no row).
REC=os.path.join(_TD,'rec.txt')
with open(REC,'w',encoding='cp1252',newline='') as f: f.write('\t'.join(dict.fromkeys(m.FIELD_MAP['rec'].values()))+'\r\n')
EXPW=exp(('  Karen A. Zaccor ','2024-10-02'),('Karen Ann Zaccor','2024-10-04'),('Karen A. Zaccor','2026-02-02'),('Karen Zaccor','2024-10-03'),name='expw.txt')
ONE=conf(HDR,OK1,name='one.tsv')
w=run(D,ONE,EXPW,REC,dry_run=False); rows=w['independent_expenditures'] if isinstance(w,dict) else []
check("(C) written rows: the flag on the row is the lifted one, and the name is as filed with only its ends trimmed",
      [(r['needs_review'],r.get('filed_candidate_name')) for r in rows],
      [(False,'Karen A. Zaccor'),(True,'Karen Ann Zaccor'),(True,'Karen A. Zaccor'),(False,'Karen Zaccor')])
check("(C) written rows: the field sits directly after needs_review on every row",
      [list(r)[list(r).index('needs_review')+1] for r in rows], ['filed_candidate_name']*4)
w0=run(D,conf(HDR,name='none.tsv'),EXPW,REC,dry_run=False); rows0=w0['independent_expenditures'] if isinstance(w0,dict) else []
check("(C) written rows: against a file with no pair, the one confirmed row's flag is all that differs (id, order, match, method stand)",
      [{k for k in a if a[k]!=b[k]} for a,b in zip(rows0,rows)] if len(rows0)==4 else w0, [{'needs_review'},set(),set(),set()])
CO={'committees':{'ward-05':{'id':'ward-05','type':'candidate','ward':5,'alder_name':'Some Alder','committee_name':'Friends of Some Alder','sbe_committee_id':'555'}}}
wc=run(CO,ABSENT,exp(('Some Alder','2024-10-02','Alderman, Ward 5'),name='expco.txt'),REC,dry_run=False)
crow=wc['independent_expenditures'] if isinstance(wc,dict) else wc
check("(C) written rows: a council row carries neither the field nor a flag (and the run read no confirmation file)",
      [sorted(set(r)&{'filed_candidate_name','needs_review'}) for r in crow] if isinstance(crow,list) else crow, [[]])
import shutil; shutil.rmtree(_TD)

# ---- council matcher: the "ward" council signal (CRX-1) ------------------------
# Council mode needs a council signal before any name match. "ward" is one of the
# three signals; before CRX-1 the pattern held a literal backslash and never matched,
# so a row filed only as "Ward 15" was dropped. The surname must still be
# corroborated by the ward number or the first name.
_AC={'w15':{'type':'candidate','ward':15,'alder_name':'Raymond A. Lopez'},
     'w2':{'type':'candidate','ward':2,'alder_name':'Brian Hopkins'},
     'w33':{'type':'candidate','ward':33,'alder_name':'Rossana Rodriguez Sanchez'},
     'ie':{'type':'independent_expenditure','ward':None,'alder_name':None}}
_AL=m.build_matcher(_AC); mt=m.match_target
check("council: 'Ward 15' alone is a council signal", mt('Raymond A Lopez','Ward 15',_AL), ('15','w15'))
check("council: 'Chicago Ward 2'", mt('Brian Hopkins','Chicago Ward 2',_AL), ('2','w2'))
check("council: 'alderperson' signal unchanged", mt('Brian Hopkins','Alderperson',_AL), ('2','w2'))
check("council: no signal -> no match", mt('Brian Hopkins','State Representative',_AL), (None,None))
check("council: 'Howard' is not the word 'ward'", mt('Brian Hopkins','Howard County Board',_AL), (None,None))
check("council: 'Ward 7' surname, wrong ward, no first name -> no match", mt('Jane Lopez','Ward 7',_AL), (None,None))
check("council: other city's ward, no alder of that name", mt('Tom Suffredin','City of Evanston Ward 6',_AL), (None,None))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
