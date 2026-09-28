#!/usr/bin/env python3
"""apply_cash_on_hand.py — each ward committee's cash on hand, from its latest D-2 (COH-1).

The council tool's Political Spend tab renders a "Cash on hand" tile whenever a ward
committee carries `cash_on_hand` (`council-embed.html`, the summary-stats block). Until
COH-1 that field was editor-entered and set on one committee of fifty. The repository's
README already defines it: "the most recent quarterly report value". This step makes
that definition true from the sealed SBE vintage the rest of the artifact is built from.

RULE (ruled by Ishan 2026-09-28): for every ward committee (type 'candidate', a ward,
an SBE committee id), take the final version of its latest D-2 period report and write

  cash_on_hand              EndFundsAvail of that report, rounded to cents
  cash_on_hand_as_of        the report's period end date (YYYY-MM-DD)
  cash_on_hand_investments  TotalInvest of the same report, rounded to cents (recorded;
                            not rendered — a second line on the tile is a display change
                            for a later commit)
  cash_on_hand_d2_doc       the SBE FiledDocs.ID of that report (provenance)

An editor-entered value is REPLACED (ruled 2026-09-28). A committee with no final D-2
period report in the vintage gets all four fields set to None — no tile, never a stale
number.

WHICH REPORT IS "FINAL": exactly `reconcile.build_filing_registry` — the D-2 period
DocNames, amendments deduped by identical window (latest received wins), then a later-
received overlapping window supersedes an earlier one. One implementation, two callers;
this file does not restate it. "Latest" is the final report with the greatest period
end (ties by period begin).

FAILS CLOSED, writing nothing, when: no ward committee is found; a final report has no
D2Totals row (the FiledDocID join fails); an input file is missing. The artifact is
written as the chain writes it — `json.dumps(indent=2, ensure_ascii=True)`, no trailing
newline — via a temp file and an atomic replace, and nothing but the four fields on
ward committees changes. The dollars stamp `generated_at` is NOT advanced: no
contribution moved. Shards are rebuilt afterwards by `build_shards.py`, unchanged.

USAGE (from campaign-finance/):
    python3 ingestion/apply_cash_on_hand.py council-data.json \\
        --fileddocs <vintage>/FiledDocs.txt --d2totals <vintage>/D2Totals.txt [--dry-run]
    python3 ingestion/apply_cash_on_hand.py --self-test
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
import reconcile as R  # noqa: E402  build_filing_registry, _read_tsv, _num

FIELDS = ('cash_on_hand', 'cash_on_hand_as_of', 'cash_on_hand_investments', 'cash_on_hand_d2_doc')


class CashOnHandError(Exception):
    pass


def cents(cell):
    """An SBE numeric cell to dollars and cents, half-up from its decimal text (never binary
    `round`, which takes 30.555 to 30.55); a blank cell is 0.0."""
    v = (cell or '').strip()
    return float(Decimal(v).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)) if v else 0.0


def ward_committees(data):
    """committee key -> SBE id, for every ward committee."""
    out = {}
    for key, cm in (data.get('committees') or {}).items():
        if cm.get('type') == 'candidate' and cm.get('ward') is not None and cm.get('sbe_committee_id'):
            out[key] = str(cm['sbe_committee_id'])
    return out


def compute(data, fileddocs_path, d2totals_path):
    """Return {committee key: {four fields}} without touching `data`."""
    wc = ward_committees(data)
    if not wc:
        raise CashOnHandError('no ward committee found in the artifact')
    sbe_ids = set(wc.values())
    finals, _sup, _all, _ov = R.build_filing_registry(fileddocs_path, sbe_ids)
    latest = {}
    for sbe, per in finals.items():
        if per:
            period = max(per, key=lambda p: (p[1], p[0]))
            latest[sbe] = (period, per[period])
    wanted = {doc for (_p, doc) in latest.values()}
    rows = {}
    for idx, row in R._read_tsv(d2totals_path):
        doc = row[idx['FiledDocID']]
        if doc in wanted:
            if row[idx['CommitteeID']] not in sbe_ids:
                raise CashOnHandError(f'D2Totals row for FiledDocID {doc} names committee '
                                      f'{row[idx["CommitteeID"]]}, not a ward committee')
            rows[doc] = (cents(row[idx['EndFundsAvail']]), cents(row[idx['TotalInvest']]))
    missing = sorted(wanted - set(rows))
    if missing:
        raise CashOnHandError(f'{len(missing)} final D-2 report(s) have no D2Totals row: {missing[:5]}')
    out = {}
    for key, sbe in wc.items():
        if sbe in latest:
            (beg, end), doc = latest[sbe]
            end_funds, invest = rows[doc]
            out[key] = {'cash_on_hand': end_funds, 'cash_on_hand_as_of': end[:10],
                        'cash_on_hand_investments': invest, 'cash_on_hand_d2_doc': doc}
        else:
            out[key] = {f: None for f in FIELDS}
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
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.coh-', suffix='.tmp')
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
    d2_hdr = 'ID\tCommitteeID\tFiledDocID\tEndFundsAvail\tTotalInvest\n'
    fd_rows = [
        ('1', '100', 'Quarterly', '2026-01-01 00:00:00', '2026-03-31 00:00:00', '2026-04-10 10:00:00'),
        ('2', '100', 'Quarterly', '2026-04-01 00:00:00', '2026-06-30 00:00:00', '2026-07-10 10:00:00'),
        ('3', '100', 'Quarterly', '2026-04-01 00:00:00', '2026-06-30 00:00:00', '2026-08-01 10:00:00'),  # amendment of 2
        ('4', '100', 'Statement of Organization', '', '', '2026-08-02 10:00:00'),                        # not a D-2
        ('5', '200', 'Quarterly', '2026-01-01 00:00:00', '2026-03-31 00:00:00', '2026-04-11 10:00:00'),
    ]
    d2_rows = [('11', '100', '1', '10.004', '0'), ('12', '100', '2', '20', '0'),
               ('13', '100', '3', '30.555', '7.5'), ('15', '200', '5', '55', '')]
    data = {'committees': {
        'ward-1': {'id': 'ward-1', 'type': 'candidate', 'ward': 1, 'sbe_committee_id': '100',
                   'cash_on_hand': 999.0, 'cash_on_hand_as_of': '2025-12-31'},
        'ward-2': {'id': 'ward-2', 'type': 'candidate', 'ward': 2, 'sbe_committee_id': '200',
                   'cash_on_hand': None, 'cash_on_hand_as_of': None},
        'ward-3': {'id': 'ward-3', 'type': 'candidate', 'ward': 3, 'sbe_committee_id': '300',
                   'cash_on_hand': 5.0, 'cash_on_hand_as_of': '2025-12-31'},
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
        t('control: the three ward committees are selected, the PAC is not', sorted(v) == ['ward-1', 'ward-2', 'ward-3'])
        t('latest period wins, and its amendment wins: ward-1 = 30.56 as of 2026-06-30',
          v['ward-1'] == {'cash_on_hand': 30.56, 'cash_on_hand_as_of': '2026-06-30',
                          'cash_on_hand_investments': 7.5, 'cash_on_hand_d2_doc': '3'})
        t('a blank TotalInvest reads as 0.0', v['ward-2']['cash_on_hand_investments'] == 0.0)
        t('ward-2 = 55.0 as of 2026-03-31', v['ward-2']['cash_on_hand'] == 55.0 and v['ward-2']['cash_on_hand_as_of'] == '2026-03-31')
        t('no D-2 on file -> all four None (the editor value is not kept)', v['ward-3'] == {f: None for f in FIELDS})
        d = json.loads(json.dumps(data))
        apply(d, v)
        t('apply replaces the editor-entered value', d['committees']['ward-1']['cash_on_hand'] == 30.56)
        t('apply touches no non-ward committee', d['committees']['pac-9'] == data['committees']['pac-9'])
        # bite: replace the registry with one that keeps the EARLIEST filing per window (no
        # amendment dedupe) and prove the amendment assertion above would have failed.
        real = R.build_filing_registry
        def naive(path, ids):
            fin, sup, alld, ov = real(path, ids)
            fin = {c: {p: ('2' if d == '3' else d) for p, d in per.items()} for c, per in fin.items()}
            return fin, sup, alld, ov
        R.build_filing_registry = naive
        try:
            vb = compute(data, fdp, d2p)
        finally:
            R.build_filing_registry = real
        t('bite: with amendments ignored, ward-1 reads the original 20.0 — the assertion bites',
          vb['ward-1']['cash_on_hand'] == 20.0 and vb['ward-1'] != v['ward-1'])
        t('bite restored: the real registry is back', R.build_filing_registry is real)
        t('half-up cents from text: 30.555 -> 30.56, 10.004 -> 10.0', cents('30.555') == 30.56 and cents('10.004') == 10.0)
        write(fd_rows, [r for r in d2_rows if r[2] != '3'])
        try:
            compute(data, fdp, d2p)
            t('fails closed when a final report has no D2Totals row', False)
        except CashOnHandError:
            t('fails closed when a final report has no D2Totals row', True)
        try:
            compute({'committees': {}}, fdp, d2p)
            t('fails closed with no ward committee', False)
        except CashOnHandError:
            t('fails closed with no ward committee', True)
    print(f'self-test: {checks} checks · ' + ('ALL PASS' if not fails else f'{fails} FAILED'))
    return 0 if not fails else 1


def main(argv=None):
    ap = argparse.ArgumentParser(description='Ward committees\' cash on hand from the latest D-2 (COH-1).')
    ap.add_argument('data', nargs='?', default='council-data.json')
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
    except CashOnHandError as e:
        print(f'  !! ABORT, nothing written: {e}', file=sys.stderr)
        return 1
    written = sum(1 for v in values.values() if v['cash_on_hand'] is not None)
    asof = {}
    for v in values.values():
        asof[v['cash_on_hand_as_of']] = asof.get(v['cash_on_hand_as_of'], 0) + 1
    total = round(sum(v['cash_on_hand'] or 0 for v in values.values()), 2)
    invest = round(sum(v['cash_on_hand_investments'] or 0 for v in values.values()), 2)
    print(f'  ward committees: {len(values)} · with a D-2: {written} · without: {len(values) - written}')
    print(f'  as-of distribution: {dict(sorted(asof.items(), key=lambda t: str(t[0])))}')
    print(f'  total cash on hand: {total:.2f} · total investments recorded: {invest:.2f}')
    for key in sorted(values, key=lambda k: data['committees'][k]['ward']):
        v = values[key]
        print(f'  ward {data["committees"][key]["ward"]:>2} {key:<36} {v["cash_on_hand"]!s:>12} '
              f'{v["cash_on_hand_as_of"]!s:<10} inv {v["cash_on_hand_investments"]!s:>10} doc {v["cash_on_hand_d2_doc"]}')
    if a.dry_run:
        print('  --dry-run: nothing written.')
        return 0
    apply(data, values)
    write_atomic(a.data, dumps(data))
    print(f'  wrote {a.data}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
