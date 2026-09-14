#!/usr/bin/env python3
"""a7_precheck.py -- the A7 pre-check instrument (open ledger 69).

Origin: HARRIS-1 ran this check from an untracked script whose only surviving trace is
`A7-precheck.log`. Open ledger 69 is that absence. This is the tracked instrument, with the
same question and the same output order, so the reading is reproducible and reviewable.

The contract, in ten lines -- each stage is written to --out as it completes, so a stop
leaves a partial log rather than none:

  1. `id source:` path, sha256, MATCH, bytes / lines; `N distinct ids loaded`.
  2. `SCOPES:` the literal read-only scope this client holds.
  3. `read_at:` one ISO-8601 wall-clock line -- a reading, not an assertion.
  4. `worksheet census:` count, then every title in Sheet order tagged live or archive;
     every --union-tabs title and the --control-tab must be present, else exit 4.
  5. `POSITIVE CONTROL first:` the control id's occurrences in --control-tab, printed
     before any zero; 0 means `control did not fire`, exit 3, no per-id line written.
  6. `per tab (live):` rows, id-column presence, non-empty and distinct id counts.
  7. `per id (live):` every id's count in every live tab holding the id column, then
     `ids with a nonzero count: K` and each nonzero as (id, tab, count).
  8. `UNION distinct ids across --union-tabs:` the number, as a reading only.
  9. `per tab (archive):` rows, non-empty, distinct, and how many are among the N ids.
 10. `A7 VERDICT:` PASS -- 0 nonzero, exit 0, iff the control fired and K = 0; else
     FAIL -- K nonzero, exit 2.

This program opens no worksheet for writing, calls nothing but read methods, and writes no
file but --out. Exit codes: 0 pass, 2 fail, 3 control did not fire, 4 premise failure.
"""

import argparse
import datetime
import hashlib
import json
import os
import sys


SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']

EXIT_OK = 0
EXIT_FAIL = 2
EXIT_CONTROL = 3
EXIT_PREMISE = 4


class Log:
    """Writes each stage as it completes, to --out and to stdout."""

    def __init__(self, path, echo=True):
        self.fh = open(path, 'w', encoding='utf-8')
        self.echo = echo

    def emit(self, line=''):
        self.fh.write(line + '\n')
        self.fh.flush()
        if self.echo:
            print(line)

    def close(self):
        self.fh.close()


def open_sheet(sheet_id, creds_file=None, creds_dict=None):
    """Authenticate and open the sheet. Mirrors sync_overrides.open_sheet (L84-110):
    the same lazy imports, the same three credential sources in the same order, the same
    read-only SCOPES, the same gspread.authorize -> open_by_key. Same auth path, same
    library, so check_sheet_scopes (EDIT-SAFE-1/S2) sees a read-only client."""
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("Missing deps. Run: pip install gspread google-auth", file=sys.stderr)
        sys.exit(EXIT_PREMISE)

    if creds_dict:
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    elif creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    else:
        env = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set "
                             "GOOGLE_SHEETS_CREDENTIALS env var.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)

    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


def sha256_file(path):
    """One read, one hash. The only file this hashes is the curated id fixture, which is
    small by construction (47 lines); a chunked loop bought nothing, and the hash-object
    update call it needed read to check_sheet_scopes' static scan as a Sheet write verb,
    because that scan matches attribute-call names and cannot see the receiver's type
    (ledger 132)."""
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def load_ids(path, expect_sha, expect_count, log):
    """Hash the fixture BEFORE reading it. A mismatch stops everything: the id set is the
    premise of every count below, so an unverified fixture makes the whole reading void."""
    if not os.path.exists(path):
        log.emit("id source: %s -- ABSENT" % path)
        return None
    got = sha256_file(path)
    if got != expect_sha:
        log.emit("id source: %s" % path)
        log.emit("  sha256: %s | MATCH: False | expected %s" % (got, expect_sha))
        log.emit("  the ids file is not the file this run was told to read; nothing else ran")
        return None
    nbytes = os.path.getsize(path)
    with open(path, encoding='utf-8') as f:
        raw = f.read()
    nlines = raw.count('\n')
    ids = []
    seen = set()
    for line in raw.split('\n'):
        tok = line.strip()
        if not tok or tok in seen:
            continue
        seen.add(tok)
        ids.append(tok)
    log.emit("id source: %s" % path)
    log.emit("  sha256: %s | MATCH: True | %d B / %d L" % (got, nbytes, nlines))
    log.emit("  %d distinct ids loaded" % len(ids))
    if len(ids) != expect_count:
        log.emit("  expected %d distinct ids; the fixture is not the set this run premises on"
                 % expect_count)
        return None
    return ids


def is_archive(title, prefix):
    return title.strip().lower().startswith(prefix.strip().lower())


def tab_facts(ws, id_column):
    """Read one worksheet: (rows, has_id_column, values). Read methods only.

    Raw cell values, not gspread's record parsing. get_all_records() raises on a header
    row carrying duplicates -- which the Sheet's own 'README' tab does, its header being
    two empty cells -- and a prose tab must be reported and skipped, never crash a run
    whose question is about two other tabs entirely. Reading the header ourselves also
    makes the id-column test the same fact the skip message reports.
    """
    vals = ws.get_all_values()
    if not vals:
        return 0, False, []
    header = vals[0]
    body = vals[1:]
    if id_column not in header:
        return len(body), False, []
    idx = header.index(id_column)
    values = []
    for r in body:
        v = r[idx].strip() if idx < len(r) else ''
        if v:
            values.append(v)
    return len(body), True, values


def run(sheet, cfg, log):
    ids = load_ids(cfg.ids_file, cfg.ids_sha256, cfg.ids_count, log)
    if ids is None:
        return EXIT_PREMISE
    id_set = set(ids)

    log.emit()
    log.emit("SCOPES: %s" % SCOPES)
    log.emit("read_at: %s" % datetime.datetime.now().astimezone().isoformat(timespec='seconds'))

    sheets = sheet.worksheets()
    log.emit()
    log.emit("worksheet census: %d" % len(sheets))
    live, archive = [], []
    for ws in sheets:
        kind = 'archive' if is_archive(ws.title, cfg.archive_prefix) else 'live'
        log.emit("  %-8s %r" % (kind, ws.title))
        if kind == 'archive':
            archive.append(ws)
        else:
            live.append(ws)

    titles = [ws.title for ws in sheets]
    union_tabs = [t.strip() for t in cfg.union_tabs.split(',') if t.strip()]
    missing = [t for t in union_tabs + [cfg.control_tab] if t not in titles]
    if missing:
        log.emit("  MISSING required worksheet(s): %s -- no count was taken" % missing)
        return EXIT_PREMISE
    log.emit("  every --union-tabs title and the --control-tab are present")

    by_title = {}
    for ws in sheets:
        by_title[ws.title] = ws

    # 5. POSITIVE CONTROL, before any zero is printed.
    _, ctrl_has_col, ctrl_values = tab_facts(by_title[cfg.control_tab], cfg.id_column)
    ctrl_n = sum(1 for v in ctrl_values if v == cfg.control_id)
    log.emit()
    log.emit("POSITIVE CONTROL first: %r in %r -> %d occurrence(s) | fires: %s"
             % (cfg.control_id, cfg.control_tab, ctrl_n, ctrl_n >= 1))
    if not ctrl_has_col:
        log.emit("  the control tab has no %r column -- the control could not be taken"
                 % cfg.id_column)
        return EXIT_PREMISE
    if ctrl_n < 1:
        log.emit("  control did not fire -- no per-id reading is trustworthy; none written")
        return EXIT_CONTROL

    # 6. per tab (live)
    log.emit()
    log.emit("per tab (live):")
    live_facts = {}
    for ws in live:
        rows, has_col, values = tab_facts(ws, cfg.id_column)
        if not has_col:
            log.emit("  %-28r %5d rows | no id column -- skipped" % (ws.title, rows))
            continue
        live_facts[ws.title] = values
        log.emit("  %-28r %5d rows | %5d non-empty %r | %5d distinct"
                 % (ws.title, rows, len(values), cfg.id_column, len(set(values))))

    # 7. per id (live)
    log.emit()
    log.emit("per id (live):")
    nonzero = []
    for wid in ids:
        for title in live_facts:
            n = sum(1 for v in live_facts[title] if v == wid)
            if n:
                nonzero.append((wid, title, n))
    log.emit("  ids with a nonzero count: %d" % len(nonzero))
    for wid, title, n in nonzero:
        log.emit("    %r in %r: %d" % (wid, title, n))
    if not nonzero:
        log.emit("    ALL %d ARE 0 ACROSS EVERY LIVE TAB" % len(ids))

    # 8. union, as a reading
    union = set()
    for t in union_tabs:
        union |= set(live_facts.get(t, []))
    log.emit()
    log.emit("UNION distinct ids across %s: %d" % (union_tabs, len(union)))

    # 9. per tab (archive)
    log.emit()
    log.emit("per tab (archive):")
    for ws in archive:
        rows, has_col, values = tab_facts(ws, cfg.id_column)
        if not has_col:
            log.emit("  %-28r %5d rows | no id column -- skipped" % (ws.title, rows))
            continue
        among = sum(1 for v in values if v in id_set)
        log.emit("  %-28r %5d rows | %5d non-empty | %5d distinct | among the %d: %d"
                 % (ws.title, rows, len(values), len(set(values)), len(ids), among))

    # 10. verdict
    log.emit()
    if nonzero:
        log.emit("A7 VERDICT: FAIL -- %d nonzero" % len(nonzero))
        return EXIT_FAIL
    log.emit("A7 VERDICT: PASS -- 0 nonzero")
    return EXIT_OK


# ---------------------------------------------------------------------------
# --self-test: no network. A fake client with the same method names the live path uses.
# ---------------------------------------------------------------------------
class _FakeWS:
    def __init__(self, title, header, rows):
        self.title = title
        self._header = list(header)
        self._rows = [list(r) for r in rows]

    def get_all_values(self):
        if not self._header:
            return []
        out = [list(self._header)]
        for r in self._rows:
            out.append(list(r))
        return out


class _FakeSheet:
    def __init__(self, tabs):
        self._tabs = tabs

    def worksheets(self):
        return list(self._tabs)


class _Cfg:
    def __init__(self, **kw):
        for k in kw:
            setattr(self, k, kw[k])


def self_test():
    import tempfile
    t = []

    def ok(name, cond):
        t.append((name, bool(cond)))

    tmpdir = tempfile.mkdtemp()
    ids_path = os.path.join(tmpdir, 'ids.txt')
    with open(ids_path, 'w', encoding='utf-8') as f:
        f.write('alpha\nbravo\ncharlie\n')
    ids_sha = sha256_file(ids_path)
    out_path = os.path.join(tmpdir, 'out.log')

    def cfg(**kw):
        base = dict(ids_file=ids_path, ids_sha256=ids_sha, ids_count=3,
                    id_column='donor_id', control_id='ctrl', control_tab='Donor Clusters',
                    union_tabs='Donor Overrides,Donor Clusters', archive_prefix='Archive')
        for k in kw:
            base[k] = kw[k]
        return _Cfg(**base)

    def sheet(overrides_rows, clusters_rows, extra=None, ov_header=('donor_id',)):
        tabs = [_FakeWS('Donor Overrides', list(ov_header), overrides_rows),
                _FakeWS('Donor Clusters', ['donor_id'], clusters_rows)]
        if extra:
            tabs = tabs + list(extra)
        return _FakeSheet(tabs)

    def go(sh, c):
        lg = Log(out_path, echo=False)
        try:
            code = run(sh, c, lg)
        finally:
            lg.close()
        with open(out_path, encoding='utf-8') as f:
            return code, f.read()

    # 1. control fires and is printed before any zero
    code, text = go(sheet([['zulu']], [['ctrl']]), cfg())
    ok('control fires and PASS with no id present', code == EXIT_OK)
    ok('verdict is PASS -- 0 nonzero', 'A7 VERDICT: PASS -- 0 nonzero' in text)
    ok('POSITIVE CONTROL is printed before the per-id section',
       text.index('POSITIVE CONTROL first:') < text.index('per id (live):'))

    # 2. a control at 0 exits 3 before any per-id line
    code, text = go(sheet([['zulu']], [['nobody']]), cfg())
    ok('control at 0 exits 3', code == EXIT_CONTROL)
    ok('control at 0 writes no per-id section', 'per id (live):' not in text)
    ok('control at 0 says so', 'control did not fire' in text)

    # 3. an id present once in a live tab yields FAIL, K = 1, exit 2
    code, text = go(sheet([['alpha']], [['ctrl']]), cfg())
    ok('one live hit exits 2', code == EXIT_FAIL)
    ok('one live hit reports K = 1', 'ids with a nonzero count: 1' in text)
    ok('one live hit names the (id, tab, count)', "'alpha' in 'Donor Overrides': 1" in text)

    # 4. ids-file sha mismatch exits 4 without reading the file
    code, text = go(sheet([['zulu']], [['ctrl']]), cfg(ids_sha256='0' * 64))
    ok('sha mismatch exits 4', code == EXIT_PREMISE)
    ok('sha mismatch reports MATCH: False', 'MATCH: False' in text)
    ok('sha mismatch takes no census', 'worksheet census:' not in text)

    # 5. ids-count mismatch exits 4
    code, text = go(sheet([['zulu']], [['ctrl']]), cfg(ids_count=47))
    ok('ids-count mismatch exits 4', code == EXIT_PREMISE)

    # 6. a live tab lacking the id column is skipped, not zeroed
    nocol = _FakeWS('Person Links', ['person_id'], [['alpha']])
    code, text = go(sheet([['zulu']], [['ctrl']], extra=[nocol]), cfg())
    ok('a live tab with no id column is skipped', 'no id column -- skipped' in text)
    ok('the skipped tab does not make alpha a hit', code == EXIT_OK)

    # 7. an Archive-prefixed title is classified archive, case-insensitively
    arch = _FakeWS('archive - Donor Overrides', ['donor_id'], [['alpha'], ['alpha']])
    code, text = go(sheet([['zulu']], [['ctrl']], extra=[arch]), cfg())
    ok('lowercase archive prefix classifies as archive',
       "archive  'archive - Donor Overrides'" in text)
    ok('an archive hit does not count as a live nonzero', code == EXIT_OK)
    ok('archive rows are counted against the id set', 'among the 3: 2' in text)

    # 7b. a prose tab whose header row is empty cells is skipped, not crashed
    prose = _FakeWS('README', ['', ''], [['how to use this sheet', ''], ['alpha', '']])
    code, text = go(sheet([['zulu']], [['ctrl']], extra=[prose]), cfg())
    ok('a prose tab with an empty-cell header is skipped, not crashed', code == EXIT_OK)
    ok('the prose tab reports no id column', "'README'" in text and 'no id column' in text)
    ok('a token in a prose tab is not counted as a live hit',
       'ids with a nonzero count: 0' in text)

    # 8. the union is computed only over --union-tabs
    other = _FakeWS('Committee Tags', ['donor_id'], [['delta'], ['echo']])
    code, text = go(sheet([['zulu']], [['ctrl']], extra=[other]), cfg())
    ok('union counts only the union tabs', "'Donor Clusters']: 2" in text)

    # 9. a missing union tab exits 4 before any count
    only = _FakeSheet([_FakeWS('Donor Clusters', ['donor_id'], [['ctrl']])])
    code, text = go(only, cfg())
    ok('a missing union tab exits 4', code == EXIT_PREMISE)
    ok('a missing union tab takes no control reading', 'POSITIVE CONTROL' not in text)

    fails = [n for n, good in t if not good]
    for n in fails:
        print('  FAILED: %s' % n, file=sys.stderr)
    print('self-test: %d checks · ' % len(t)
          + ('ALL PASS' if not fails else 'FAILED %d' % len(fails)))
    return EXIT_OK if not fails else EXIT_FAIL


def main():
    ap = argparse.ArgumentParser(description='A7 pre-check (open ledger 69).')
    ap.add_argument('--sheet-id', default=os.environ.get('SHEET_ID'))
    ap.add_argument('--creds-file', help='Path to service account JSON key')
    ap.add_argument('--ids-file', help='the id fixture, one id per line')
    ap.add_argument('--ids-sha256', help='the fixture sha256, checked before it is read')
    ap.add_argument('--ids-count', type=int, default=47)
    ap.add_argument('--id-column', default='donor_id')
    ap.add_argument('--control-id', default='friends-of-michelle-a-harris')
    ap.add_argument('--control-tab', default='Donor Clusters')
    ap.add_argument('--union-tabs', default='Donor Overrides,Donor Clusters')
    ap.add_argument('--archive-prefix', default='Archive')
    ap.add_argument('--out', help='the log this run writes; the only file it writes')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()

    if a.self_test:
        return self_test()

    for name, val in (('--ids-file', a.ids_file), ('--ids-sha256', a.ids_sha256),
                      ('--out', a.out)):
        if not val:
            print('Missing %s' % name, file=sys.stderr)
            return EXIT_PREMISE
    if not a.sheet_id:
        print("Missing --sheet-id (or SHEET_ID env var)", file=sys.stderr)
        return EXIT_PREMISE

    log = Log(a.out)
    try:
        sheet = open_sheet(a.sheet_id, a.creds_file)
        code = run(sheet, a, log)
    finally:
        log.close()
    return code


if __name__ == '__main__':
    sys.exit(main())
