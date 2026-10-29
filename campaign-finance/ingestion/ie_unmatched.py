"""ie_unmatched.py — the election run's closed alias list, its ruled dispositions for spending
that is not ours, and the unmatched-spending gate (IEA-1, IEA-2, IEA-3; Ishan, 2026-10-28).

Three things, each a closed list ruled by Ishan, never a guess:
  * ALIASES — (spender SBE id, candidate name as filed) -> candidacy. ingest_ie tries this
    before its own rungs. The key carries the spender, so a new spender filing the same
    nickname is a new row in the report, not a silent match.
  * DISPOSITIONS — (spender SBE id, name as filed, office as filed) -> not_ours | joint.
    not_ours: another jurisdiction's race, or a candidate's own committee. joint: one row
    naming several candidates, which the ingest never splits (IEA-3-3a).
  * THE GATE — every IN-SCOPE row the matcher leaves unmatched must be disposed of; one that is
    not stops the run before anything is written (IEA-2-3a). In scope (IEA-2-2b, IEA-3-1a):
    filed by any committee that is not a candidate committee in the registry, filed against an
    office naming one of the tool's three races, dated inside an election window the tool
    shows. Suggestions in the report are hints for the ruling and never attribute money.

Plain stdlib. Paths are fixed relative to this script, as ingest_ie fixes its confirmation file.
"""
import os, re, json, unicodedata

_HERE = os.path.dirname(os.path.abspath(__file__))
_REF = os.path.join(_HERE, '..', 'elections', 'reference')
ALIASES_PATH = os.path.join(_REF, 'ie-target-aliases.tsv')
DISPOSITIONS_PATH = os.path.join(_REF, 'ie-unmatched-dispositions.tsv')
REPORT_PATH = os.path.join(_HERE, '..', 'elections', 'ie-unmatched-report.json')
ALIASES_HEADER = ['spender_sbe_id', 'filed_name', 'candidate_id', 'ruled', 'ruling', 'seen_as']
DISPOSITIONS_HEADER = ['spender_sbe_id', 'filed_name', 'filed_office', 'disposition', 'ruled', 'ruling']
DISPOSITIONS = ('not_ours', 'joint')


def norm(s):   # ingest_ie.norm, byte for byte (the keys are written in its form)
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', (s or '').lower())).strip()


def _fold(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()


def _read_tsv(path, header, tag):
    def stop(why):
        raise SystemExit(f"FATAL [{tag}] {path}: {why}\n  Refusing to ingest with a list that cannot be trusted.")
    try:
        with open(path, encoding='utf-8') as f:
            lines = f.read().split('\n')
    except (OSError, UnicodeDecodeError) as e:
        stop(f"missing or unreadable: {e}")
    if lines and lines[-1] == '':
        lines.pop()
    rows, seen_header = [], False
    for n, line in enumerate(lines, 1):
        if line.startswith('#'):
            continue
        c = line.split('\t')
        if not seen_header:
            if c != header:
                stop(f"line {n}: the header is {line!r}, not {' '.join(header)}")
            seen_header = True
            continue
        if len(c) != len(header):
            stop(f"line {n}: {len(c)} tab-separated field(s), not {len(header)}: {line!r}")
        rows.append((n, dict(zip(header, c))))
    if not seen_header:
        stop("no header line")
    return rows, stop


def load_aliases(known_candidates, path=None):
    """{(spender_sbe_id, filed_name): [candidate_id, ...]}. One key may name several candidacies
    (a returner aliased in two elections); the row's window picks one, and two eligible for one
    row is a stop in ingest_ie. Each refusal names the line."""
    rows, stop = _read_tsv(path or ALIASES_PATH, ALIASES_HEADER, 'IEA-1')
    out = {}
    for n, r in rows:
        k = (r['spender_sbe_id'], r['filed_name'])
        if not r['spender_sbe_id'].isdigit():
            stop(f"line {n}: spender_sbe_id {r['spender_sbe_id']!r} is not an SBE committee id")
        if r['filed_name'] != norm(r['filed_name']) or not r['filed_name']:
            stop(f"line {n}: filed_name {r['filed_name']!r} is not in norm()'s form ({norm(r['filed_name'])!r})")
        if r['candidate_id'] not in known_candidates:
            stop(f"line {n}: candidate_id {r['candidate_id']!r} is not a candidacy in the registry")
        if not r['ruling']:
            stop(f"line {n}: no ruling named")
        if r['candidate_id'] in out.get(k, []):
            stop(f"line {n}: the pair {k!r} -> {r['candidate_id']!r} appears twice")
        out.setdefault(k, []).append(r['candidate_id'])
    return out


def load_dispositions(path=None):
    """{(spender_sbe_id, filed_name, filed_office): disposition}."""
    rows, stop = _read_tsv(path or DISPOSITIONS_PATH, DISPOSITIONS_HEADER, 'IEA-3')
    out = {}
    for n, r in rows:
        k = (r['spender_sbe_id'], r['filed_name'], r['filed_office'])
        if not r['spender_sbe_id'].isdigit():
            stop(f"line {n}: spender_sbe_id {r['spender_sbe_id']!r} is not an SBE committee id")
        for f in ('filed_name', 'filed_office'):
            if r[f] != norm(r[f]):
                stop(f"line {n}: {f} {r[f]!r} is not in norm()'s form ({norm(r[f])!r})")
        if r['disposition'] not in DISPOSITIONS:
            stop(f"line {n}: disposition {r['disposition']!r} is not one of {DISPOSITIONS}")
        if not r['ruling']:
            stop(f"line {n}: no ruling named")
        if k in out:
            stop(f"line {n}: the key {k!r} appears twice")
        out[k] = r['disposition']
    return out


# ---- scope (IEA-2-2b, IEA-3-1a) -----------------------------------------------------------
_SB_OFFICE = re.compile(r'SCHOOL|EDUCATION|\bBOE\b|\bCPS\b', re.I)
_MUNI_OFFICE = re.compile(r'ALDER|\bWARDS?\b|CITY COUNCIL|\bMAYOR', re.I)   # whole words: 'WARD' inside HOWARD is not a ward


def office_kind(office):
    # IEA-3-1a: the OFFICE as filed names the race; the candidate's name is never read here
    # (a "Ward" surname or a committee named for schools is not an office)
    if _SB_OFFICE.search(office or ''):
        return 'school_board'
    if _MUNI_OFFICE.search(office or ''):
        return 'municipal'
    return None


def in_window(kind, date, windows):
    for w in windows.get(kind, []):
        if (w.get('start') is None or w['start'] <= date) and (w.get('end') is None or date <= w['end']):
            return True
    return False


# ---- suggestions (hints for the ruling; never a match) ------------------------------------
_SUFFIX = {'jr', 'sr', 'ii', 'iii', 'iv'}
NICKNAMES = [
    {'pete', 'peter'}, {'bill', 'billy', 'will', 'william', 'willie'}, {'bob', 'bobby', 'rob', 'robert'},
    {'jim', 'jimmy', 'james'}, {'mike', 'michael'}, {'tony', 'anthony'}, {'theresa', 'therese', 'teresa'},
    {'dan', 'danny', 'daniel'}, {'tom', 'tommy', 'thomas'}, {'joe', 'joseph'}, {'chris', 'christopher'},
    {'kate', 'katie', 'katherine', 'kathryn', 'catherine'}, {'liz', 'beth', 'elizabeth'},
    {'sam', 'samantha', 'samuel'}, {'nick', 'nicholas'}, {'matt', 'matthew'}, {'dave', 'david'},
    {'steve', 'steven', 'stephen'}, {'ed', 'eddie', 'edward'}, {'ron', 'ronnie', 'ronald'},
    {'greg', 'gregory'}, {'gil', 'gilbert'}, {'jessie', 'jessica'}, {'leo', 'leonardo'},
    {'tim', 'timmy', 'timothy'}, {'ray', 'raymond'}, {'al', 'alan', 'albert'}, {'andy', 'andrew'},
    {'pat', 'patrick', 'patricia'}, {'jen', 'jenny', 'jennifer'}, {'deb', 'debbie', 'debra', 'deborah'},
    {'sue', 'susan'}, {'rick', 'richard', 'dick'}, {'dj', 'dennis'}]


def _toks(s):
    return [t for t in norm(_fold(s)).split() if t not in _SUFFIX and len(t) > 1]


def _nick(a, b):
    return a == b or any(a in g and b in g for g in NICKNAMES)


def _lev(a, b):
    p = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        c = [i]
        for j, y in enumerate(b, 1):
            c.append(min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (x != y)))
        p = c
    return p[-1]


def suggest(filed_name, registry):
    """[(reason, candidate_id, name)] for a filed name; registry = [{'id','name'}]."""
    t = _toks(filed_name)
    if not t:
        return []
    g, s = set(t[:-1]), t[-1]
    out = []
    for e in registry:
        et = _toks(e['name'])
        if not et:
            continue
        eg, es = set(et[:-1]), et[-1]
        gi = bool(g and eg and any(_nick(a, b) for a in g for b in eg))
        gs = bool(g and eg and any(_lev(a, b) <= 2 and min(len(a), len(b)) >= 4 for a in g for b in eg))
        why = None
        if s == es and not (g & eg) and gi:
            why = 'nickname'
        elif s == es and not (g & eg) and gs:
            why = 'given-name spelling'
        elif s != es and s in et and (g & eg or gi):
            why = 'part of a compound surname'
        elif s != es and len(s) >= 4 and _lev(s, es) <= 2 and (g & eg or gi):
            why = 'surname spelling'
        elif s != es and es in t and (g & eg or gi):
            why = 'surname order or extra name'
        if why:
            out.append((why, e['id'], e['name']))
    return out


def report(groups, registry, path=None):
    """Write the unmatched-in-scope report; return the undisposed groups."""
    rows = []
    for k, v in sorted(groups.items(), key=lambda kv: (kv[1]['disposition'] is not None, -kv[1]['amount'])):
        rows.append({'spender_sbe_id': k[0], 'filed_name': v['filed_name'], 'filed_office': v['filed_office'],
                     'key': list(k), 'stance': sorted(v['stances']), 'rows': v['rows'],
                     'amount': round(v['amount'], 2), 'first': v['first'], 'last': v['last'],
                     'disposition': v['disposition'],
                     'suggestions': [] if v['disposition'] else
                     [{'reason': a, 'candidate_id': b, 'name': c} for a, b, c in suggest(v['filed_name'], registry)]})
    undisposed = [r for r in rows if r['disposition'] is None]
    doc = {'_doc': 'IE rows in scope that matched no candidacy (IEA-2). A row with no disposition stops '
                   'the election run of ingest_ie before it writes; suggestions are hints, never matches.',
           'undisposed': len(undisposed),
           'undisposed_amount': round(sum(r['amount'] for r in undisposed), 2),
           'disposed': len(rows) - len(undisposed),
           'groups': rows}
    with open(path or REPORT_PATH, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=True)
        f.write('\n')
    return undisposed
