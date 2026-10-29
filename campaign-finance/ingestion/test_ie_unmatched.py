"""Biting cases for the election run's alias rung and unmatched-spending gate (IEA-1, IEA-2, IEA-3).

Every registry, row and list here is constructed; the one data-free tracked file read is
election-windows.json (through build_rollups, as ingest_ie reads it). Each case states what it
proves: a gate that never fires is a green that means nothing. Plain stdlib, no pytest.
Run: python3 test_ie_unmatched.py
"""
import importlib.util, sys, os, json, tempfile, shutil, io, contextlib

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
spec = importlib.util.spec_from_file_location("ingest_ie", os.path.join(_HERE, "ingest_ie.py"))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
import ie_unmatched as U

PASS = 0; FAIL = 0
def check(name, got, exp):
    global PASS, FAIL
    ok = got == exp
    print(("PASS " if ok else "FAIL "), name)
    if not ok:
        print("      got:", got); print("      exp:", exp)
    PASS += ok; FAIL += (not ok)

_TD = tempfile.mkdtemp(prefix='iea-')
D = {'races': [{'id': 'sb-d05', 'office': 'school_board_member', 'district': '3A'},
               {'id': 'sb-2024-d3', 'office': 'school_board_member', 'district': '3'},
               {'id': 'ward-33', 'office': 'alderperson', 'ward': '33'},
               {'id': 'ward-34', 'office': 'alderperson', 'ward': '34'},
               {'id': 'mayor', 'office': 'mayor'}],
     'candidates': [{'id': 'g-2026', 'name': 'Peter Gonzales', 'race_id': 'sb-d05', 'election_id': '2026-school-board', 'committee_id': '41125'},
                    {'id': 'g-2024', 'name': 'Peter Gonzales', 'race_id': 'sb-2024-d3', 'election_id': '2024-school-board', 'committee_id': None},
                    {'id': 'inc-ward-33', 'name': 'Rossana Rodriguez Sanchez', 'race_id': 'ward-33', 'election_id': '2027-municipal', 'committee_id': '34611'},
                    {'id': 'inc-ward-34', 'name': 'Some Alder', 'race_id': 'ward-34', 'election_id': '2027-municipal', 'committee_id': None},
                    {'id': 'm-1', 'name': 'Brandon Johnson', 'race_id': 'mayor', 'election_id': '2027-municipal', 'committee_id': None}],
     'committees': {'c-34611': {'id': 'c-34611', 'type': 'candidate', 'sbe_committee_id': '34611', 'committee_name': 'Friends of Rossana'}}}
IDS = {c['id'] for c in D['candidates']}

def lists(aliases=(), dispositions=()):
    a = os.path.join(_TD, 'a.tsv'); b = os.path.join(_TD, 'b.tsv')
    with open(a, 'w', encoding='utf-8') as f: f.write('\t'.join(U.ALIASES_HEADER) + '\n' + ''.join(l + '\n' for l in aliases))
    with open(b, 'w', encoding='utf-8') as f: f.write('\t'.join(U.DISPOSITIONS_HEADER) + '\n' + ''.join(l + '\n' for l in dispositions))
    return a, b

def exp(*rows):
    # rows: (spender, candidate as filed, office as filed, date, amount)
    p = os.path.join(_TD, 'exp.txt')
    with open(p, 'w', encoding='cp1252', newline='') as f:
        f.write('\t'.join(m.FIELD_MAP['exp'].values()) + '\r\n')
        for i, (sp, nm, off, dt, amt, *st) in enumerate(rows):
            sup = (st or ['support'])[0] == 'support'
            f.write('\t'.join([sp, '%.2f' % amt, (dt + ' 00:00:00') if dt else '', nm, off, str(sup), str(not sup), str(100 + i), '9B', 'Mail', 'Payee', '', 'False']) + '\r\n')
    return p

class Stopped(str):
    # a run the gate stopped: still the message (for 'in'), and any stats key reads 'STOPPED',
    # so a case expecting figures FAILS by name rather than crashing the file
    def __getitem__(self, k): return 'STOPPED' if isinstance(k, str) else str.__getitem__(self, k)
def run(rows, aliases=(), dispositions=(), committees=None, dry_run=True, keep_d=None):
    keep = (U.ALIASES_PATH, U.DISPOSITIONS_PATH, U.REPORT_PATH)
    U.ALIASES_PATH, U.DISPOSITIONS_PATH = lists(aliases, dispositions)
    U.REPORT_PATH = os.path.join(_TD, 'report.json')
    d = dict(json.loads(json.dumps(D)), cycles={'2027': {'start': '2023-05-16', 'end': '2027-05-15'}}, donors={}, contributions=[])
    if committees: d['committees'].update(committees)
    if keep_d is not None: keep_d.append(d)
    try:
        # the gate runs before the dry-run return (dry) and before any write (non-dry)
        # the run's own listing of undisposed groups goes to stderr; kept off this file's output,
        # so its last line is its verdict (the gate prints that line)
        with contextlib.redirect_stderr(io.StringIO()):
            res = m.ingest(d, exp(*rows), None, dry_run=dry_run, progress=False)
        return res, _report()
    except SystemExit as e:
        return Stopped(str(e)), _report()
    finally:
        U.ALIASES_PATH, U.DISPOSITIONS_PATH, U.REPORT_PATH = keep

_rep = {}
_orig_report = U.report
def _capture(groups, registry, path=None):
    out = _orig_report(groups, registry, path=os.path.join(_TD, 'report.json'))
    _rep['doc'] = json.load(open(os.path.join(_TD, 'report.json')))
    return out
U.report = _capture
def _report():
    r = _rep.pop('doc', None); return r

PETE = ('26066', 'Pete Gonzales', 'School Board, District 3A', '2026-09-28', 28540.0)
ALIAS_PETE = '26066\tpete gonzales\tg-2026\t2026-10-28\tIEA-1-2a\tPete Gonzales'

# ---- the alias rung ----------------------------------------------------------------------
s, r = run([PETE])
check("(A) premise: with no alias, the nickname row matches nothing and the gate stops the run",
      isinstance(s, str) and 'FATAL [IEA-2]' in s and '$28,540.00' in s, True)
check("(A) ...and the report names it, undisposed, with the nickname suggestion",
      (r['undisposed'], r['groups'][0]['filed_name'], [x['candidate_id'] for x in r['groups'][0]['suggestions']]),
      (1, 'Pete Gonzales', ['g-2026', 'g-2024']))
s, r = run([PETE], aliases=[ALIAS_PETE])
check("(A) with the alias, the row matches that candidacy by the alias rung and the gate passes",
      (s['matched_to_current_alders'], s['matched_by_alias'], s['unmatched_in_scope_undisposed']), (1, 1, 0))
s, r = run([('41012',) + PETE[1:]], aliases=[ALIAS_PETE])
check("(A) the key carries the spender: another spender's identical filing is NOT matched by it",
      isinstance(s, str) and 'FATAL [IEA-2]' in s, True)
s, r = run([PETE[:3] + ('2023-09-28', 100.0)], aliases=[ALIAS_PETE])
check("(A) the alias respects the window (PS-140): a 2023 row is not matched, and is out of scope",
      (s['matched_by_alias'], s['unmatched_in_scope_groups']), (0, 0))
s, r = run([('26066', '  PETE  GONZALES,', 'School Board, District 3A', '2026-09-28', 5.0)], aliases=[ALIAS_PETE])
check("(A) the name is keyed through norm(): case, spacing and punctuation do not matter", s['matched_by_alias'], 1)
s, r = run([('37052', 'Rossana Rodriguez', '33rd Ward Alder', '2025-08-31', 500.0)],
           aliases=['37052\trossana rodriguez\tinc-ward-33\t2026-10-28\tIEA-3-2a\tRossana Rodriguez'])
check("(A) an alias reaches a council candidacy, which the robust rungs never index", s['matched_by_alias'], 1)

# ---- the gate's scope --------------------------------------------------------------------
NOT = '25064\tclare kelly\tcity of evanston ward 1\tnot_ours\t2026-10-28\tIEA-3-4a'
EV = ('25064', 'Clare Kelly', 'City of Evanston Ward 1', '2025-03-10', 7677.95)
s, r = run([EV])
check("(G) an in-window ward race elsewhere is in scope: undisposed, it stops the run", isinstance(s, str) and 'IEA-2' in s, True)
s, r = run([EV], dispositions=[NOT])
check("(G) ...and a ruled not_ours disposition lets the run through, the group reported as disposed",
      (s['unmatched_in_scope_disposed'], s['unmatched_in_scope_undisposed'], r['groups'][0]['disposition']), (1, 0, 'not_ours'))
s, r = run([EV], dispositions=[NOT.replace('city of evanston ward 1', 'city of evanston ward 2')])
check("(G) the disposition key carries the office: another office's row is not disposed by it", isinstance(s, str) and 'IEA-2' in s, True)
JOINT = '40109\tmichelle n pierre kate doyle\tchicago school board\tjoint\t2026-10-28\tIEA-3-3a'
s, r = run([('40109', 'Michelle N. Pierre; Kate Doyle', 'Chicago School Board', '2024-10-28', 23940.9)], dispositions=[JOINT])
check("(G) a joint disposition passes and attributes nothing", (s['matched_to_current_alders'], s['unmatched_in_scope_undisposed']), (0, 0))
s, r = run([('25064', 'Somebody', 'Howard Township Trustee', '2026-10-14', 3875.0)])
check("(G) 'ward' inside HOWARD is not a ward: an office naming Howard Township is out of scope", s['unmatched_in_scope_groups'], 0)
s, r = run([('25064', 'Someone Else', 'Illinois House District 9', '2026-09-01', 50.0)])
check("(G) an office naming none of the three races is out of scope", (s['unmatched_in_scope_groups'], s['unmatched_out_of_scope']), (0, 1))
s, r = run([('25064', 'Somebody', 'Alderman 12th Ward', '2019-02-01', 50.0)])
check("(G) a municipal row dated before the 2027 window is out of scope", s['unmatched_in_scope_groups'], 0)
s, r = run([('25064', 'Somebody', 'Chicago Board of Education 2B', '2023-12-31', 50.0)])
check("(G) a school-board row dated before the 2024 window is out of scope", s['unmatched_in_scope_groups'], 0)
s, r = run([('34611', 'Some Opponent', '33rd Ward Alderperson', '2025-01-01', 50.0)])
check("(G) a candidate committee's own spend is out of scope (IEA-3-5a)", s['unmatched_in_scope_groups'], 0)
s, r = run([EV, EV])
check("(G) an exact duplicate is counted once in the report, as the matched rows are collapsed once",
      (r['groups'][0]['rows'], r['groups'][0]['amount']), (1, 7677.95))

# ---- review round 1 (each a mutation that survived) --------------------------------------
s, r = run([PETE], aliases=[ALIAS_PETE])
check("(A) an alias match is not flagged for review: it is a ruling", s['flagged_needs_review'], 0)
s, r = run([('26066', 'Peter Gonzales', 'School Board, District 3A', '2026-09-28', 1.0)],
           aliases=['26066\tpeter gonzales\tinc-ward-33\t2026-10-28\tTEST\tx'])
check("(A) the alias rung runs BEFORE the others: it wins over an exact name match", s['matched_by_alias'], 1)
RET = [ALIAS_PETE, ALIAS_PETE.replace('g-2026', 'g-2024')]
s, r = run([PETE, PETE[:3] + ('2024-10-01', 10.0)], aliases=RET)
check("(A) one key may name a returner's two candidacies; each row's window picks one", (s['matched_by_alias'], s['unmatched_in_scope_groups']), (2, 0))
check("(L) control: ...and the loader holds both", U.load_aliases(IDS, lists(RET)[0]), {('26066', 'pete gonzales'): ['g-2026', 'g-2024']})
AMB = ['26066\tsome guy\tinc-ward-33\t2026-10-28\tTEST\tx', '26066\tsome guy\tinc-ward-34\t2026-10-28\tTEST\tx']
s, r = run([('26066', 'Some Guy', '33rd Ward', '2025-01-01', 1.0)], aliases=AMB)
check("(A) a key naming two candidacies eligible for one row stops the run", isinstance(s, str) and 'FATAL [IEA-1]' in s, True)
MAY = ['38833\tbrandon jonson\tm-1\t2026-10-28\tTEST\tBrandon Jonson']
s, r = run([('38833', 'Brandon Jonson', 'Chicago Mayor', '2023-06-04', 2000.0)], aliases=MAY)
check("(A) a mayor alias matches a row filed against the mayor's office", s['matched_by_alias'], 1)
s, r = run([('38833', 'Brandon Jonson', 'Cook County Board', '2023-06-04', 2000.0)], aliases=MAY)
check("(A) ...and not one filed against another office (MAYOR-1's office scope)", s['matched_by_alias'], 0)
s, r = run([PETE], committees={'ie-26066': {'id': 'ie-26066', 'type': 'independent_expenditure', 'sbe_committee_id': '26066'}})
check("(G) a spender already in the registry as an IE committee stays in scope", isinstance(s, str) and 'IEA-2' in s, True)
s, r = run([('25064', 'Somebody', 'Mayor of Chicago', '2025-01-01', 1.0)])
check("(G) a mayor's office is in scope", isinstance(s, str) and 'IEA-2' in s, True)
s, r = run([('25064', 'Somebody', 'CPS BOE', '2026-01-01', 1.0)])
check("(G) 'CPS' / 'BOE' offices are in scope", isinstance(s, str) and 'IEA-2' in s, True)
s, r = run([('25064', 'Jeanette Ward', 'State Senate', '2025-01-01', 1.0), ('615', 'Jonak for Kane County Schools', 'Regional Superintendent', '2026-09-09', 66.5)])
check("(G) the candidate's name is never read for scope: a 'Ward' surname or a 'Schools' committee is not an office", s['unmatched_in_scope_groups'], 0)
s, r = run([('25064', 'Somebody', 'Alderman 12th Ward', '', 1.0)])
check("(G) an undated row is out of scope", s['unmatched_in_scope_groups'], 0)
s, r = run([EV[:5] + ('oppose',)])
check("(G) the report carries the row's stance", r['groups'][0]['stance'], ['oppose'])
DD = []
s, r = run([PETE], dry_run=False, keep_d=DD)
check("(G) a NON-dry run stops too, before writing: no outside spending is put in the document, the report is on disk",
      (isinstance(s, str) and 'IEA-2' in s and 'see ' in s, 'independent_expenditures' in DD[0], r and r['undisposed']), (True, False, 1))
s, r = run([PETE])
check("(G) a dry run's stop says its report is not written", isinstance(s, str) and 'dry run: the report is not written' in s, True)

# ---- the loaders refuse what they cannot trust -------------------------------------------
def stops(fn, *lines, raw=None):
    p = os.path.join(_TD, 'x.tsv')
    with open(p, 'wb') as f: f.write(raw if raw is not None else ''.join(l + '\n' for l in lines).encode('utf-8'))
    try: fn(p); return None
    except SystemExit as e: return str(e)
LA = lambda p: U.load_aliases(IDS, p)
LD = lambda p: U.load_dispositions(p)
AH = '\t'.join(U.ALIASES_HEADER); DH = '\t'.join(U.DISPOSITIONS_HEADER)
check("(L) control: a valid alias list loads", U.load_aliases(IDS, lists([ALIAS_PETE])[0]), {('26066', 'pete gonzales'): ['g-2026']})
check("(L) control: a valid disposition list loads", U.load_dispositions(lists((), [NOT])[1]),
      {('25064', 'clare kelly', 'city of evanston ward 1'): 'not_ours'})
for label, fn, lines, needle in [
    ("a missing alias file", LA, None, 'missing or unreadable'),
    ("an alias to a candidacy the registry does not hold", LA, (AH, ALIAS_PETE.replace('g-2026', 'g-2099')), 'not a candidacy'),
    ("an alias name not in norm()'s form", LA, (AH, ALIAS_PETE.replace('pete gonzales', 'Pete Gonzales')), "norm()'s form"),
    ("an alias with no ruling", LA, (AH, ALIAS_PETE.replace('IEA-1-2a', '')), 'no ruling'),
    ("the same alias pair twice", LA, (AH, ALIAS_PETE, ALIAS_PETE), 'appears twice'),
    ("an alias spender that is not an SBE id", LA, (AH, ALIAS_PETE.replace('26066', 'INCS')), 'not an SBE'),
    ("an alias header out of order", LA, (AH.replace('filed_name\tcandidate_id', 'candidate_id\tfiled_name'), ALIAS_PETE), 'header'),
    ("a disposition other than not_ours or joint", LD, (DH, NOT.replace('not_ours', 'ignore')), 'disposition'),
    ("a disposition office not in norm()'s form", LD, (DH, NOT.replace('city of evanston ward 1', 'City of Evanston Ward 1')), "norm()'s form"),
    ("a disposition key twice", LD, (DH, NOT, NOT), 'appears twice'),
    ("a disposition row of five fields", LD, (DH, NOT.rsplit('\t', 1)[0]), '5 tab-separated')]:
    if lines is None:
        try: fn(os.path.join(_TD, 'absent.tsv')); msg = None
        except SystemExit as e: msg = str(e)
    else:
        msg = stops(fn, *lines)
    check("(L) stop: " + label, msg is not None and needle in msg, True)

shutil.rmtree(_TD)
print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
