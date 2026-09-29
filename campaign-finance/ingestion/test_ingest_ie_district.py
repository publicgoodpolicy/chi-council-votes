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
"""
import importlib.util, sys, os

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

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
