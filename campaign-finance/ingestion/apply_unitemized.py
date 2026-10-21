#!/usr/bin/env python3
"""apply_unitemized.py — each candidate committee's unitemized individual contributions, by
D-2 report period (ruling 74a; display ruled as 76b, amended).

Illinois reports a donor's gifts by name once they pass $150 in a reporting period. Smaller
gifts are reported on the D-2 cover as one figure per report, `IndivContribNI`, with no donor.
Until this step that money reached no figure the tools show. Ruling 74a: it is added per
candidate committee as its own line, counted in Raised and never as a donor.

PS-96 governs it. It is un-keyed money: it carries no donor identity, so it is never written
as a contribution row or a donor (the AGG/PS-96 assertions stay class-level and stay green).
It is written as a committee field, and only figures at candidate or committee grain count it.

RULE: for every candidate committee (type 'candidate', an SBE committee id), take the final
version of each D-2 period report and write

  unitemized_periods   [{"beg", "end", "amount", "d2_doc"}, ...] for every final report
                       whose IndivContribNI is not zero, ordered by period; amount is
                       IndivContribNI rounded half-up to cents from its decimal text
  unitemized_total     the sum of those amounts, to cents

WHICH REPORT IS "FINAL": exactly `reconcile.build_filing_registry` (one implementation, the
same one apply_cash_on_hand.py and the reconcile use). A committee with no final report
carrying unitemized money gets `[]` and 0.0.

A final report with no D2Totals row is a filed-but-empty report and counts $0, as the
reconcile treats it; their number is printed. FAILS CLOSED, writing nothing, when: no
candidate committee is found; a D2Totals row for a wanted report names another committee; an
input is missing. The artifact is written as the chain writes it — `json.dumps(indent=2,
ensure_ascii=True)`, no trailing newline — via a temp file and an atomic replace, and nothing
but the two fields on candidate committees changes. `generated_at` is not advanced.

USAGE (from the repository root):
    python3 campaign-finance/ingestion/apply_unitemized.py <artifact.json> \\
        --fileddocs <vintage>/FiledDocs.txt --d2totals <vintage>/D2Totals.txt [--dry-run]
    python3 campaign-finance/ingestion/apply_unitemized.py --self-test
"""
import argparse
import json
import os
import sys
import tempfile
from decimal import Decimal, ROUND_HALF_UP

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import reconcile as R  # noqa: E402  build_filing_registry, _read_tsv

FIELDS = ('unitemized_periods', 'unitemized_total')


class UnitemizedError(Exception):
    pass


def cents(cell):
    """An SBE numeric cell to dollars and cents, half-up from its decimal text; blank is 0.0."""
    v = (cell or '').strip()
    return float(Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)) if v else 0.0


def candidate_committees(data):
    """committee key -> SBE id, for every candidate committee carrying an SBE id."""
    out = {}
    for key, cm in (data.get('committees') or {}).items():
        if cm.get('type') == 'candidate' and cm.get('sbe_committee_id'):
            out[key] = str(cm['sbe_committee_id'])
    return out


def compute(data, fileddocs_path, d2totals_path):
    """Return {committee key: {two fields}} without touching `data`."""
    cc = candidate_committees(data)
    if not cc:
        raise UnitemizedError('no candidate committee found in the artifact')
    sbe_ids = set(cc.values())
    finals, _sup, _all, _ov = R.build_filing_registry(fileddocs_path, sbe_ids)
    doc_period = {doc: (sbe, period) for sbe, per in finals.items() for period, doc in per.items()}
    amounts = {}
    for idx, row in R._read_tsv(d2totals_path):
        doc = row[idx['FiledDocID']]
        if doc in doc_period:
            if row[idx['CommitteeID']] != doc_period[doc][0]:
                raise UnitemizedError(f'D2Totals row for FiledDocID {doc} names committee '
                                      f'{row[idx["CommitteeID"]]}, not {doc_period[doc][0]}')
            amounts[doc] = cents(row[idx['IndivContribNI']])
    # A final report with no D2Totals row is a filed-but-empty report: $0, never dropped
    # silently -- the same treatment and the same count reconcile.py reports.
    missing = sorted(set(doc_period) - set(amounts))
    for doc in missing:
        amounts[doc] = 0.0
    compute.filed_but_empty = missing
    out = {}
    for key, sbe in cc.items():
        periods = []
        for (beg, end), doc in sorted((finals.get(sbe) or {}).items()):
            amt = amounts[doc]
            if amt != 0.0:
                periods.append({'beg': beg[:10], 'end': end[:10], 'amount': amt, 'd2_doc': doc})
        total = float(sum(Decimal(str(p['amount'])) for p in periods))
        out[key] = {'unitemized_periods': periods, 'unitemized_total': round(total, 2)}
    return out


def apply(data, values):
    for key, vals in values.items():
        cm = data['committees'][key]
        for f in FIELDS:
            cm[f] = vals[f]


def dumps(data):
    return json.dumps(data, indent=2, ensure_ascii=True)


def write_atomic(path, text):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.unitem-', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='ascii') as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def self_test():
    """PS-128 mode B: a constructed oracle over synthetic SBE files, no repository state."""
    checks, fails = 0, 0

    def t(label, cond):
        nonlocal checks, fails
        checks += 1
        if not cond:
            fails += 1
            print('  FAIL', label)

    fd_hdr = 'ID\tCommitteeID\tDocName\tRptPdBegDate\tRptPdEndDate\tRcvdDateTime\n'
    d2_hdr = 'ID\tCommitteeID\tFiledDocID\tIndivContribNI\n'
    fd_rows = [
        ('1', '100', 'Quarterly', '2026-01-01 00:00:00', '2026-03-31 00:00:00', '2026-04-10 10:00:00'),
        ('2', '100', 'Quarterly', '2026-04-01 00:00:00', '2026-06-30 00:00:00', '2026-07-10 10:00:00'),
        ('3', '100', 'Quarterly', '2026-04-01 00:00:00', '2026-06-30 00:00:00', '2026-08-01 10:00:00'),  # amends 2
        ('4', '100', 'Statement of Organization', '', '', '2026-08-02 10:00:00'),
        ('5', '200', 'Quarterly', '2026-01-01 00:00:00', '2026-03-31 00:00:00', '2026-04-11 10:00:00'),
        ('6', '300', 'Quarterly', '2026-01-01 00:00:00', '2026-03-31 00:00:00', '2026-04-11 10:00:00'),
    ]
    d2_rows = [('11', '100', '1', '10.005'), ('12', '100', '2', '20'), ('13', '100', '3', '30.555'),
               ('15', '200', '5', '0'), ('16', '300', '6', '')]
    data = {'committees': {
        'ward-1': {'id': 'ward-1', 'type': 'candidate', 'ward': 1, 'sbe_committee_id': '100'},
        'sb-2': {'id': 'sb-2', 'type': 'candidate', 'ward': None, 'sbe_committee_id': '200'},
        'mayor-3': {'id': 'mayor-3', 'type': 'candidate', 'ward': None, 'sbe_committee_id': '300'},
        'ward-4': {'id': 'ward-4', 'type': 'candidate', 'ward': 4, 'sbe_committee_id': '400'},
        'pac-9': {'id': 'pac-9', 'type': 'political', 'ward': None, 'sbe_committee_id': '100'},
    }}
    with tempfile.TemporaryDirectory() as td:
        fdp, d2p = os.path.join(td, 'FiledDocs.txt'), os.path.join(td, 'D2Totals.txt')

        def write(rows_fd, rows_d2):
            with open(fdp, 'w', encoding='cp1252', newline='') as f:
                f.write(fd_hdr + ''.join('\t'.join(r) + '\r\n' for r in rows_fd))
            with open(d2p, 'w', encoding='cp1252', newline='') as f:
                f.write(d2_hdr + ''.join('\t'.join(r) + '\r\n' for r in rows_d2))

        write(fd_rows, d2_rows)
        v = compute(data, fdp, d2p)
        t('control: the four candidate committees are selected, the PAC is not',
          sorted(v) == ['mayor-3', 'sb-2', 'ward-1', 'ward-4'])
        t('ward-1: both periods, the amendment wins (30.56, not 20), half-up 10.005 -> 10.01',
          v['ward-1']['unitemized_periods'] == [
              {'beg': '2026-01-01', 'end': '2026-03-31', 'amount': 10.01, 'd2_doc': '1'},
              {'beg': '2026-04-01', 'end': '2026-06-30', 'amount': 30.56, 'd2_doc': '3'}])
        t('ward-1 total 40.57', v['ward-1']['unitemized_total'] == 40.57)
        t('a zero or blank IndivContribNI writes no period', v['sb-2']['unitemized_periods'] == []
          and v['mayor-3']['unitemized_periods'] == [] and v['mayor-3']['unitemized_total'] == 0.0)
        t('no D-2 on file -> [] and 0.0', v['ward-4'] == {'unitemized_periods': [], 'unitemized_total': 0.0})
        d = json.loads(json.dumps(data))
        apply(d, v)
        t('apply writes the two fields and touches no other committee',
          d['committees']['ward-1']['unitemized_total'] == 40.57 and d['committees']['pac-9'] == data['committees']['pac-9'])
        real = R.build_filing_registry

        def naive(path, ids):
            fin, sup, alld, ov = real(path, ids)
            return ({c: {p: ('2' if x == '3' else x) for p, x in per.items()} for c, per in fin.items()}, sup, alld, ov)
        R.build_filing_registry = naive
        try:
            vb = compute(data, fdp, d2p)
        finally:
            R.build_filing_registry = real
        t('bite: with amendments ignored, ward-1 reads the original 20.0 — the assertion bites',
          vb['ward-1']['unitemized_periods'][1]['amount'] == 20.0 and vb['ward-1'] != v['ward-1'])
        t('bite restored', R.build_filing_registry is real)
        write(fd_rows, [r for r in d2_rows if r[2] != '3'])
        ve = compute(data, fdp, d2p)
        t('a final report with no D2Totals row counts $0 and is reported as filed-but-empty',
          compute.filed_but_empty == ['3'] and ve['ward-1']['unitemized_total'] == 10.01)
        write(fd_rows, [('13', '200', '3', '1')] + [r for r in d2_rows if r[2] != '3'])
        try:
            compute(data, fdp, d2p)
            t('fails closed when a wanted D2Totals row names another committee', False)
        except UnitemizedError:
            t('fails closed when a wanted D2Totals row names another committee', True)
        try:
            compute({'committees': {}}, fdp, d2p)
            t('fails closed with no candidate committee', False)
        except UnitemizedError:
            t('fails closed with no candidate committee', True)
    print(f'self-test: {checks} checks · ' + ('ALL PASS' if not fails else f'{fails} FAILED'))
    return 0 if not fails else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description='Candidate committees\' unitemized individual contributions (74a).')
    ap.add_argument('data', nargs='?')
    ap.add_argument('--fileddocs')
    ap.add_argument('--d2totals')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args(argv)
    if a.self_test:
        return self_test()
    for p in (a.data, a.fileddocs, a.d2totals):
        if not p or not os.path.exists(p):
            print(f'  !! missing input: {p!r}', file=sys.stderr)
            return 1
    with open(a.data, encoding='ascii') as f:
        data = json.load(f)
    try:
        values = compute(data, a.fileddocs, a.d2totals)
    except UnitemizedError as e:
        print(f'  !! ABORT, nothing written: {e}', file=sys.stderr)
        return 1
    withm = sum(1 for v in values.values() if v['unitemized_periods'])
    total = float(sum(Decimal(str(v['unitemized_total'])) for v in values.values()))
    print(f'  filed-but-empty final D-2 reports (counted $0): {len(compute.filed_but_empty)}')
    print(f'  candidate committees: {len(values)} · with unitemized money: {withm} · without: {len(values) - withm}')
    print(f'  total unitemized individual contributions: {total:.2f} over '
          f'{sum(len(v["unitemized_periods"]) for v in values.values())} report(s)')
    for key in sorted(values, key=lambda k: -values[k]['unitemized_total'])[:20]:
        v = values[key]
        print(f'  {key:<40} {v["unitemized_total"]:>12.2f}  {len(v["unitemized_periods"])} report(s)')
    if a.dry_run:
        print('  --dry-run: nothing written.')
        return 0
    apply(data, values)
    write_atomic(a.data, dumps(data))
    print(f'  wrote {a.data}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
