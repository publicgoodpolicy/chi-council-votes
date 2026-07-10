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

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
