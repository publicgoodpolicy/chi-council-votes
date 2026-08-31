#!/usr/bin/env python3
"""Validate reconciliation-report.json — its provenance stamp and its structure.

RECONCILE-2 HALT-A. This artifact had NO validator and no gate coverage of any kind:
RECONCILE-1 H4 measured that nothing in the tree asserted its presence, its parseability
or its freshness. That is the wrong artifact to leave unguarded, because it is the only
one this project publishes that reaches readers **with no paste in the way** — the
elections embed fetches it from the CDN, so a push is a publication.

The checks are the `CHECKS` tuple below, and the reported count derives from it rather
than from a literal — so this list, the code, and the run agree by construction instead of
by care. Deliberately narrow:

  [RECON/SHAPE]  the report parses and carries the expected top-level key inventory.
  [RECON/SYNC]   every input named in `run.inputs` still hashes to the recorded sha256.
  [RECON/CLAIM]  the known-gaps claim resolves through that same stamped input.

This paragraph read "Two checks" over three for as long as [RECON/CLAIM] has existed: the
count was a literal in three places and the docstring a fourth statement of it, so nothing
tied them together and the prose rotted silently. `--self-test` now asserts that every name
in `CHECKS` appears here and that this list names no other `RECON/` check, which is what
keeps the sentence above honest when the next check lands.

What this does NOT do: re-derive any figure. It is a provenance and structure check, not
a second reconcile. The arithmetic is reconcile.py's to own; this establishes that the
artifact on disk was built from the files it claims, which is the thing nothing else
could tell you.

The [SBF/SYNC] precedent is followed on construction — a pure verdict function with the
hasher injected, so the self-test drives every branch with no filesystem — and departed
from on hosting: there was no existing validator to put it inside, so this file is the
new invoker.

Usage:
  validate_reconcile.py campaign-finance/elections/reconciliation-report.json [--self-test]

Exit: 0 clean; 1 on any failure.
"""
import argparse
import hashlib
import json
import os
import re
import sys

# The artifact-run checks, in the order main() evaluates them. THE source of the reported
# count: main() derives both the total and the pass count from this tuple, and the module
# docstring is asserted against it by `--self-test`, so the count cannot drift from the code
# and the prose cannot drift from either. Adding a check means adding its name here and its
# verdict in main() — nothing else states the number.
CHECKS = ('RECON/SHAPE', 'RECON/SYNC', 'RECON/CLAIM')

EXPECTED_TOP = {'run', 'headline', 'no_sbe_id_committees', 'join_failures',
                'filings_missing_totals', 'disclosed', 'stale_annotations', 'committees'}
EXPECTED_RUN = {'data_file', 'd2totals_file', 'fileddocs_file', 'pulled', 'threshold',
                'scope', 'inputs'}


def _sha256_file(path, _chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(_chunk), b''):
            h.update(block)
    return h.hexdigest()


# The repo root: the directory that `run.data_file`'s relative path is written against.
# reconcile.py records `campaign-finance/election-data.json`, which is repo-root-relative,
# while the bulk inputs are absolute. Resolving relative paths against the CWD instead made
# the check pass or fail depending on where it was invoked from — caught by the ABSENT
# branch on the first real run, from campaign-finance/ingestion.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def _resolve(path, root=None):
    """Absolute paths as given; relative paths against the repo root, never the CWD."""
    return path if os.path.isabs(path) else os.path.join(root or REPO_ROOT, path)


def sync_verdict(report, sha=_sha256_file, exists=os.path.exists, root=None):
    """[RECON/SYNC] — the provenance assert. PURE apart from `sha` and `exists`.

    Fail-closed rules, in order:

      * `run.inputs` absent, not a dict, or empty -> FAIL. A stamp that can go missing and
        still pass is not a stamp (the [SBF/SYNC] formulation, and the reason it is quoted
        rather than paraphrased is that the failure mode is identical).
      * an entry missing `sha256` or `path` -> FAIL. Both are load-bearing: the sha is the
        anchor, the path is what makes it resolvable.
      * a recorded input that is ABSENT on disk -> FAIL, reported as absent. This is the
        case the brief asked to be handled honestly. Two of the three inputs live outside
        the repo in sealed bulk archives, so absence is normal on a machine that never held
        that pull — and passing silently there would make the check vacuous exactly where
        it is most needed. It fails, and says which file and where it was expected.
      * a present input whose content hash differs from the record -> FAIL, naming the
        input and both hashes.

    Returns (ok, lines, failed) — `failed` is the set of input names that failed, which the
    known-failures layer consumes. `ok` is the RAW verdict, before pinning.
    """
    run = report.get('run') if isinstance(report, dict) else None
    inputs = (run or {}).get('inputs') if isinstance(run, dict) else None
    if not isinstance(inputs, dict) or not inputs:
        return False, ['RECON/SYNC: report carries no usable `run.inputs` — cannot establish '
                       'what it was built from. Rebuild with reconcile.py.'], set()
    lines, ok, failed = [], True, set()
    for name in sorted(inputs):
        rec = inputs.get(name)
        if not isinstance(rec, dict) or not rec.get('sha256') or not rec.get('path'):
            lines.append(f'RECON/SYNC: `{name}` entry is malformed — needs both `sha256` and `path`')
            ok = False; failed.add(name)
            continue
        want, path = rec['sha256'], _resolve(rec['path'], root)
        if not exists(path):
            lines.append(f'RECON/SYNC: `{name}` recorded at {path} is ABSENT on this machine — '
                         f'cannot verify sha256 {want[:12]}…')
            ok = False; failed.add(name)
            continue
        got = sha(path)
        if got != want:
            lines.append(f'RECON/SYNC: `{name}` MOVED — recorded {want[:12]}… but {path} '
                         f'now hashes {got[:12]}…')
            ok = False; failed.add(name)
        else:
            lines.append(f'RECON/SYNC: `{name}` matches {want[:12]}…')
    return ok, lines, failed


KNOWN_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'reconcile_known_failures.json')


def apply_known(failed_inputs, known):
    """SHRINK-ONLY known-failures, mirroring check_docs (PS-73) and check_encoding.

    `failed_inputs` is the set of input names [RECON/SYNC] found failing. Returns
    (unknown, stale, lines): failures NOT pinned, pins that no longer fail, and the report
    lines. The gate is green only when both are empty.

    Enforced in code, so a pin cannot quietly widen:
      * `entries` longer than `max_entries` -> GREW, fails. A second moved input is NOT
        absorbed by a pin written for the first.
      * an entry lacking `owner` or `removal_condition` -> fails. The ruling requires the
        removal condition to live in the file: a pinned red nobody remembers the reason for
        is worse than a visible red.
      * an entry that no longer fails -> STALE, fails. That is how HALT-B's refresh forces
        the pin's removal rather than leaving it to memory.
    """
    lines, unknown, stale = [], [], []
    entries = (known or {}).get('entries') or []
    maxn = (known or {}).get('max_entries')
    if not isinstance(maxn, int) or len(entries) > maxn:
        lines.append(f'RECON/KNOWN: known-failures GREW ({len(entries)} > {maxn}) — SHRINK-ONLY')
        return failed_inputs, [], lines
    for e in entries:
        if not e.get('owner') or not e.get('removal_condition'):
            lines.append(f"RECON/KNOWN: entry {e.get('input')!r} lacks an owner or a "
                         f"removal_condition — both are required")
            return failed_inputs, [], lines
    pinned = {e.get('input') for e in entries}
    unknown = sorted(set(failed_inputs) - pinned)
    stale = sorted(pinned - set(failed_inputs))
    for s in stale:
        lines.append(f'RECON/KNOWN: pinned input {s!r} NO LONGER fails — remove it (shrink). '
                     f'Its removal condition has been met.')
    for p in sorted(pinned & set(failed_inputs)):
        e = [x for x in entries if x.get('input') == p][0]
        lines.append(f'RECON/KNOWN: {p!r} failing as pinned — {e.get("owner")}')
    return unknown, stale, lines


def claim_verdict(report, gaps, tol=0.005):
    """[RECON/CLAIM] — the disclosed total reconciles against the residual.

    RECONCILE-2 C. The figures in this report were guarded from HALT-A; the CLAIM the
    elections embed makes ABOUT them was not. Its methodology tab renders that every
    divergence is individually accounted for, followed by the known-gaps count and their
    summed magnitude — so that sentence is true only while the ledger's total equals the
    residual. Nothing asserted it. `reconcile.py` exits 1 on `over_threshold` /
    `coverage_miss_committees` / `stale_annotations`, and it caught this lane's blocker for
    that reason, but exit status is not a gate line and the relationship itself is not among
    its triggers: a future refresh could move the residual without tripping any of them and
    leave the published sentence stale.

    PARITY WITH THE EMBED — BROKEN DELIBERATELY, CNCL-DATA-1 P1.4 Z-1 (2026-08-30). The left
    side used to be computed exactly as the embed computes it, `sum(Math.abs(g.amount || 0))`
    (`app.js:51`, inlined at elections-embed.inlined.html:2779), so that the check and the page
    could not disagree about what "the disclosed total" means. That parity was sound while every
    ledger entry carried the same sign. The third and fourth entry classes introduce POSITIVE
    amounts — periods where our itemized rows exceed the sworn cover — and `abs()` then ADDS
    what the arithmetic must SUBTRACT: 8,400.00 + 78,841.50 + 1,200.00 + 1,499.25 sums to
    89,940.75 under `abs()`, where the signed sum is -84,542.25, the residual exactly.

    So this check now sums SIGNED amounts and compares them to the SIGNED residual. The identity
    it asserts is the true one. The consequence is stated rather than hidden: **the page's own
    figure at `app.js:51` is still an absolute sum and now overstates the disclosed total.** The
    page-side correction, and the methodology sentence's clauses for the two new classes, ride
    P2 with the single paste. Until then the check is right and the page is not, which is the
    safer direction for the two to disagree in.

    What this does NOT assert: that any individual annotation is correct, or that a
    divergence deserves disclosure. It asserts only that the published arithmetic closes.
    Judging an annotation is editorial and has an evidence requirement the ledger states in
    its own `description`.
    """
    h = (report or {}).get('headline') if isinstance(report, dict) else None
    if not isinstance(h, dict) or 'residual' not in h:
        return False, ['RECON/CLAIM: report has no `headline.residual` — cannot check the claim']
    entries = (gaps or {}).get('gaps')
    if not isinstance(entries, list):
        return False, ['RECON/CLAIM: known-gaps carries no `gaps` list']
    disclosed = round(sum(float(g.get('amount') or 0) for g in entries), 2)
    residual = round(float(h['residual']), 2)
    if abs(disclosed - residual) > tol:
        return False, [f'RECON/CLAIM: disclosed total (signed) ${disclosed:,.2f} across '
                       f'{len(entries)} gap(s) does NOT equal the signed residual '
                       f'${residual:,.2f} — the methodology tab\'s "every divergence is '
                       f'individually accounted for" is FALSE by '
                       f'${abs(residual - disclosed):,.2f}']
    return True, [f'RECON/CLAIM: disclosed (signed) ${disclosed:,.2f} across {len(entries)} '
                  f'gap(s) == signed residual ${residual:,.2f}']


def shape_verdict(report):
    """[RECON/SHAPE] — the report parses and carries the expected inventory.

    Nothing asserted this artifact was even parseable before. The inventory is pinned at
    the top level and inside `run` only: per-committee record shape is reconcile.py's
    business, and pinning it here would make this file a second schema to maintain.
    """
    if not isinstance(report, dict):
        return False, ['RECON/SHAPE: report is not a JSON object']
    lines, ok = [], True
    missing = EXPECTED_TOP - set(report)
    extra = set(report) - EXPECTED_TOP
    if missing:
        lines.append('RECON/SHAPE: missing top-level key(s): ' + ', '.join(sorted(missing)))
        ok = False
    if extra:
        lines.append('RECON/SHAPE: unexpected top-level key(s): ' + ', '.join(sorted(extra)))
        ok = False
    run = report.get('run')
    if not isinstance(run, dict):
        lines.append('RECON/SHAPE: `run` is not an object')
        ok = False
    else:
        rmissing = EXPECTED_RUN - set(run)
        rextra = set(run) - EXPECTED_RUN
        if rmissing:
            lines.append('RECON/SHAPE: `run` missing key(s): ' + ', '.join(sorted(rmissing)))
            ok = False
        if rextra:
            lines.append('RECON/SHAPE: `run` has unexpected key(s): ' + ', '.join(sorted(rextra)))
            ok = False
    if ok:
        lines.append(f'RECON/SHAPE: {len(EXPECTED_TOP)} top-level and {len(EXPECTED_RUN)} '
                     f'`run` keys as expected')
    return ok, lines


# ---------------------------------------------------------------- self-test
def _self_test():
    t, fails = [], 0

    def ok(name, cond):
        nonlocal fails
        t.append((name, cond))
        if not cond:
            fails += 1

    good = {'run': {k: 'x' for k in EXPECTED_RUN}, 'headline': {},
            'no_sbe_id_committees': [], 'join_failures': [], 'filings_missing_totals': [],
            'disclosed': [], 'stale_annotations': [], 'committees': {}}
    good['run']['inputs'] = {'a.json': {'sha256': 'abc', 'path': '/tmp/a.json'}}

    H = lambda p: 'abc'
    E = lambda p: True

    ok('sync: matching sha passes', sync_verdict(good, sha=H, exists=E)[0])
    ok('sync: absent `inputs` fails',
       not sync_verdict({'run': {}}, sha=H, exists=E)[0])
    ok('sync: empty `inputs` fails',
       not sync_verdict({'run': {'inputs': {}}}, sha=H, exists=E)[0])
    ok('sync: `inputs` not a dict fails',
       not sync_verdict({'run': {'inputs': []}}, sha=H, exists=E)[0])
    ok('sync: entry missing sha256 fails',
       not sync_verdict({'run': {'inputs': {'a': {'path': '/tmp/a'}}}}, sha=H, exists=E)[0])
    ok('sync: entry missing path fails',
       not sync_verdict({'run': {'inputs': {'a': {'sha256': 'abc'}}}}, sha=H, exists=E)[0])
    ok('sync: absent file fails rather than passing silently',
       not sync_verdict(good, sha=H, exists=lambda p: False)[0])
    ok('sync: absent file names the file',
       'ABSENT' in ' '.join(sync_verdict(good, sha=H, exists=lambda p: False)[1]))
    ok('sync: drifted sha fails',
       not sync_verdict(good, sha=lambda p: 'zzz', exists=E)[0])
    ok('sync: drifted sha names the input',
       'MOVED' in ' '.join(sync_verdict(good, sha=lambda p: 'zzz', exists=E)[1]))
    ok('sync: no report at all fails', not sync_verdict(None, sha=H, exists=E)[0])
    # the CWD-dependence the first real run caught
    ok('sync: a relative path resolves against the repo root, not the CWD',
       sync_verdict({'run': {'inputs': {'a': {'sha256': 'abc', 'path': 'sub/a.json'}}}},
                    sha=H, exists=lambda p: p == os.path.join('/ROOT', 'sub/a.json'),
                    root='/ROOT')[0])
    ok('sync: an absolute path is used as given',
       sync_verdict({'run': {'inputs': {'a': {'sha256': 'abc', 'path': '/abs/a.json'}}}},
                    sha=H, exists=lambda p: p == '/abs/a.json', root='/ROOT')[0])

    ok('shape: expected inventory passes', shape_verdict(good)[0])
    ok('shape: missing top-level key fails',
       not shape_verdict({k: v for k, v in good.items() if k != 'committees'})[0])
    ok('shape: unexpected top-level key fails',
       not shape_verdict(dict(good, surprise=1))[0])
    ok('shape: missing `run` key fails',
       not shape_verdict(dict(good, run={k: 'x' for k in EXPECTED_RUN if k != 'inputs'}))[0])
    ok('shape: unexpected `run` key fails',
       not shape_verdict(dict(good, run=dict(good['run'], generated_at='2026-01-01')))[0])
    ok('shape: non-object report fails', not shape_verdict([])[0])

    # ---- known-failures layer (shrink-only), the ruling's two conditions ----
    PIN = {'max_entries': 1, 'entries': [
        {'input': 'election-data.json', 'owner': 'o', 'removal_condition': 'HALT-B refresh'}]}
    ok('known: a pinned failure is absorbed', apply_known({'election-data.json'}, PIN)[:2] == ([], []))
    ok('known: a SECOND moved input is NOT absorbed by the pin',
       apply_known({'election-data.json', 'd2totals'}, PIN)[0] == ['d2totals'])
    ok('known: growth beyond max_entries fails',
       'GREW' in ' '.join(apply_known(set(), {'max_entries': 1, 'entries': [
           {'input': 'a', 'owner': 'o', 'removal_condition': 'r'},
           {'input': 'b', 'owner': 'o', 'removal_condition': 'r'}]})[2]))
    ok('known: an entry lacking removal_condition fails',
       'removal_condition' in ' '.join(apply_known(set(), {'max_entries': 1, 'entries': [
           {'input': 'a', 'owner': 'o'}]})[2]))
    ok('known: an entry lacking owner fails',
       'owner' in ' '.join(apply_known(set(), {'max_entries': 1, 'entries': [
           {'input': 'a', 'removal_condition': 'r'}]})[2]))
    ok('known: a pin that no longer fails is STALE (forces removal at HALT-B)',
       apply_known(set(), PIN)[1] == ['election-data.json'])
    ok('known: no pins and no failures is clean', apply_known(set(), {'max_entries': 0, 'entries': []})[:2] == ([], []))

    # ---- [RECON/CLAIM] ----
    R={'headline':{'residual':-8400.0}}
    G={'gaps':[{'amount':-500.0},{'amount':-250.0},{'amount':-7650.0}]}
    ok('claim: disclosed total equals the signed residual', claim_verdict(R,G)[0])
    ok('claim: a changed gap amount fails', not claim_verdict(R,{'gaps':[{'amount':-500.0},{'amount':-250.0},{'amount':-7000.0}]})[0])
    ok('claim: a removed gap fails', not claim_verdict(R,{'gaps':[{'amount':-500.0},{'amount':-250.0}]})[0])
    ok('claim: a moved residual fails', not claim_verdict({'headline':{'residual':-9000.0}},G)[0])
    # CNCL-DATA-1 P1.4 Z-1. This case asserted the OPPOSITE until 2026-08-30 — that sign was
    # ignored, |amount| summed "as the embed does". The third and fourth entry classes introduced
    # positive amounts, and under abs() a positive entry ADDS where it must SUBTRACT. Sign is now
    # honoured, and the inverted case is kept as the bite: all-positive gaps against a negative
    # residual must FAIL.
    ok('claim: sign is HONOURED — all-positive gaps against a negative residual now fail',
       not claim_verdict(R,{'gaps':[{'amount':500.0},{'amount':250.0},{'amount':7650.0}]})[0])
    ok('claim: a MIXED-sign ledger summing to the residual passes (the ratified shape)',
       claim_verdict({'headline':{'residual':-6400.0}},
                     {'gaps':[{'amount':-8400.0},{'amount':1200.0},{'amount':800.0}]})[0])
    ok('claim: BITE — one positive entry\'s sign flipped breaks the identity',
       not claim_verdict({'headline':{'residual':-6400.0}},
                         {'gaps':[{'amount':-8400.0},{'amount':-1200.0},{'amount':800.0}]})[0])
    ok('claim: absent residual fails', not claim_verdict({'headline':{}},G)[0])
    ok('claim: absent gaps list fails', not claim_verdict(R,{})[0])
    ok('claim: the failure names the shortfall',
       'FALSE by' in ' '.join(claim_verdict(R,{'gaps':[{'amount':-500.0}]})[1]))

    # HYG-B2 commit D — the docstring is pinned to CHECKS, in BOTH directions. The prose read
    # "Two checks" over three because nothing tied it to the code; a one-way check would let
    # the reverse rot return (a name lingering here after its check is deleted).
    _doc = __doc__ or ''
    ok('count: the docstring names every check in CHECKS',
       all(('[' + c + ']') in _doc for c in CHECKS))
    ok('count: the docstring names no RECON/ check absent from CHECKS',
       set(re.findall(r'\[(RECON/[A-Z]+)\]', _doc)) == set(CHECKS))

    for n, c in t:
        print(('  PASS ' if c else '  FAIL ') + n)
    print(f"self-test: {len(t)} checks · " + ("ALL PASS" if not fails else f"FAILED {fails}"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description='Validate reconciliation-report.json (RECONCILE-2 A).')
    ap.add_argument('report', nargs='?', help='reconciliation-report.json path')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()

    if a.self_test:
        sys.exit(_self_test())
    if not a.report:
        ap.error('report path required (or pass --self-test)')

    try:
        report = json.load(open(a.report))
    except OSError as e:
        print(f'[validate_reconcile] ERROR cannot open {a.report}: {e}', file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f'[validate_reconcile] ERROR {a.report} is not valid JSON: {e}', file=sys.stderr)
        sys.exit(1)

    try:
        known = json.load(open(KNOWN_PATH))
    except OSError:
        known = {'max_entries': 0, 'entries': []}

    sok, slines = shape_verdict(report)
    _raw_ok, ylines, failed = sync_verdict(report)
    unknown, stale, klines = apply_known(failed, known)
    yok = not unknown and not stale

    # [RECON/CLAIM] resolves known-gaps through the SAME stamped input the other checks use,
    # so it inherits run.inputs' path resolution rather than carrying its own.
    gp = ((report.get('run') or {}).get('inputs') or {}).get('known-gaps.json') or {}
    gaps, clines = None, []
    if gp.get('path'):
        try:
            gaps = json.load(open(_resolve(gp['path'])))
        except (OSError, json.JSONDecodeError) as e:
            clines = [f'RECON/CLAIM: known-gaps not readable at {gp["path"]}: {e}']
    else:
        clines = ['RECON/CLAIM: `run.inputs` names no known-gaps.json — cannot check the claim']
    if gaps is not None:
        cok, clines = claim_verdict(report, gaps)
    else:
        cok = False

    # ONE SOURCE OF TRUTH for the count (HYG-B2 commit D). It used to be the literal `3` at
    # three sites with `n_ok` summed separately beside them, so a fourth verdict meant four
    # hand-edits and missing one would misreport silently — the drift class a recount exists
    # to catch, surviving only because the literal happened to be right. Both the total and
    # the pass count now derive from this one pairing of CHECKS to its verdicts.
    verdicts = dict(zip(CHECKS, (sok, yok, cok)))
    n_checks, n_ok = len(CHECKS), sum(1 for v in verdicts.values() if v)
    bad = n_ok != n_checks
    for ln in slines + ylines + klines + clines:
        print('[validate_reconcile] ' + ln, file=(sys.stderr if bad else sys.stdout))
    for u in unknown:
        print(f'[validate_reconcile] RECON/KNOWN: {u!r} is failing and is NOT pinned — '
              f'either fix it or ratify a pin', file=sys.stderr)
    print(f'[validate_reconcile] {n_checks} checks · '
          + ('OK: 0 errors' if not bad else f'FAILED {n_checks - n_ok}')
          + (f' · {len(failed)} pinned' if failed and yok else ''))
    sys.exit(0 if not bad else 1)


if __name__ == '__main__':
    main()
