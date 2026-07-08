#!/usr/bin/env python3
"""reconcile.py -- source-fidelity reconciliation of our itemized contributions
against candidate committees' own sworn SBE D-2 quarterly totals.

Read-only. Never mutates any data file: it reads election-data.json plus the two
SBE bulk exports (D2Totals, FiledDocs) and writes a single reconciliation report
to --out. For each candidate committee it compares, per filed reporting period,
the itemized receipts we hold against the totals the committee itself swore to on
its D-2 filings (amendments superseded by RcvdDateTime), and assigns a state.

v1 scope: elections candidate committees only. The IE-committee lane (typed
'IE Committee Receipt' / 'IE Committee Dues Transfer') and the council lane are
deferred to v2 -- see PIPELINE_RUNBOOK.md.

SBE bulk exports are Windows-1252 encoded; both raw files are read as latin-1.

CLI:
  python3 reconcile.py \
    --data campaign-finance/election-data.json \
    --d2totals raw/sbe-summary/'D2Totals - 7.6.26.txt' \
    --fileddocs raw/sbe-summary/'FiledDocs - 7.6.26.txt' \
    --out campaign-finance/elections/reconciliation-report.json \
    --pulled 2026-07-06 --threshold 500

Exit codes: 0 = clean (no committee over threshold, no coverage miss);
1 = threshold exceedance or coverage-miss flag; 2 = structural failure
(missing files, malformed --pulled, or FiledDocID join failures).
"""
import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime

D2_PERIOD_DOCNAMES = {'Quarterly', 'Semiannual', 'Pre-election', 'Annual', 'Final'}
ITEMIZED_TYPES = {'Individual Contribution', 'Transfer In', 'Loan Received', 'Other Receipt'}
INKIND_TYPE = 'In-kind Contribution'
AGGREGATE_TYPE = 'Aggregate'
RAW_ENCODING = 'latin-1'  # SBE bulk exports are Windows-1252, not UTF-8
CENT = 1.0               # reconciliation tolerance: |residual| < $1 counts as clean


def _num(v):
    """Parse an SBE numeric cell; blanks -> 0.0. (Verified: no separators/negatives.)"""
    v = (v or '').strip()
    return float(v) if v else 0.0


def _read_tsv(path):
    """Yield rows of a tab-separated SBE export as (header_index, row_list)."""
    with open(path, newline='', encoding=RAW_ENCODING) as f:
        r = csv.reader(f, delimiter='\t')
        header = next(r)
        idx = {h: i for i, h in enumerate(header)}
        for row in r:
            yield idx, row


def build_filing_registry(fileddocs_path, sbe_ids):
    """From FiledDocs, per SBE committee, resolve D-2 period reports to a final
    comparison set in two passes:
      pass 1 -- exact-tuple amendment dedupe: group by (RptPdBegDate, RptPdEndDate),
                keep the max RcvdDateTime (the final version of that filing).
      pass 2 -- overlap-supersede: among the pass-1 finals, a later-received filing
                whose period window overlaps an earlier-received one supersedes it.
                SBE carries no amendment-linkage column, and a later-received
                overlapping filing has been observed to hold the corrected Schedule
                A while the superseded original retains none; window + receipt order
                is the best available key.
    Returns:
      finals    : sbe_id -> {(beg, end): final FiledDocs.ID}
      superseded: sbe_id -> count of pass-1 amendments dropped
      all_doc_ids: every FiledDocs.ID for our committees (any DocName)
      overlap_superseded: sbe_id -> [ {superseded_doc, superseded_period,
                    superseding_doc, superseding_period, superseding_rcvd} ]
    RcvdDateTime is fixed-width 'YYYY-MM-DD HH:MM:SS', so lexicographic order is
    chronological order.
    """
    groups = defaultdict(lambda: defaultdict(list))  # sbe -> (beg,end) -> [(rcvd, id)]
    all_doc_ids = set()  # every FiledDocs.ID for our committees (any DocName)
    for idx, row in _read_tsv(fileddocs_path):
        cid = row[idx['CommitteeID']]
        if cid not in sbe_ids:
            continue
        all_doc_ids.add(row[idx['ID']])
        if row[idx['DocName']] in D2_PERIOD_DOCNAMES:
            period = (row[idx['RptPdBegDate']][:10], row[idx['RptPdEndDate']][:10])
            groups[cid][period].append((row[idx['RcvdDateTime']], row[idx['ID']]))
    finals, superseded, overlap_superseded = {}, {}, {}
    for cid, per in groups.items():
        # pass 1: exact-tuple amendment dedupe (max RcvdDateTime per identical window)
        pass1, sup = {}, 0
        for period, filings in per.items():
            filings.sort()
            pass1[period] = (filings[-1][0], filings[-1][1])  # (rcvd, docid)
            sup += len(filings) - 1
        # pass 2: overlap-supersede -- a later-received final filing whose window
        # overlaps an earlier-received one supersedes it (windows: b1<=e2 and b2<=e1)
        fin, ovsup = {}, []
        for period, (rcvd, docid) in pass1.items():
            laters = [(p2, r2, d2) for p2, (r2, d2) in pass1.items()
                      if d2 != docid and r2 > rcvd
                      and period[0] <= p2[1] and p2[0] <= period[1]]
            if laters:
                sp, sr, sd = max(laters, key=lambda t: t[1])  # latest-received superseder
                ovsup.append({'superseded_doc': docid, 'superseded_period': list(period),
                              'superseding_doc': sd, 'superseding_period': list(sp),
                              'superseding_rcvd': sr})
            else:
                fin[period] = docid
        finals[cid] = fin
        superseded[cid] = sup
        if ovsup:
            overlap_superseded[cid] = ovsup
    return finals, superseded, all_doc_ids, overlap_superseded


def build_d2_amounts(d2totals_path, sbe_ids, final_ids_by_committee, all_doc_ids,
                     extra_doc_ids=frozenset()):
    """From D2Totals, join each committee's final D-2 filings to their sworn
    itemized + in-kind totals via FiledDocID -> FiledDocs.ID. Returns:
      d2_item : sbe_id -> {(beg,end): itemized total}
      d2_ink  : sbe_id -> {(beg,end): in-kind itemized total}
      join_failures: D2Totals rows whose FiledDocID resolves to no FiledDocs.ID
                     (the structural integrity check; expected: none)
      missing_totals: final D-2 period filings that have no D2Totals row -- a
                      filed-but-empty report, treated as $0 (informational, not
                      a failure; never silently dropped)
      extra_amount: docid -> (itemized, in-kind) for the docids in extra_doc_ids
                    (the overlap-superseded filings), so the report can disclose
                    the sworn amount that the supersede removed from the compare.
    itemized = IndivContribI + XferInI + LoanRcvI + OtherRctI.
    """
    # docid -> (sbe, period) for our final filings only
    doc_to_period = {}
    for sbe, periods in final_ids_by_committee.items():
        for period, docid in periods.items():
            doc_to_period[docid] = (sbe, period)
    seen_amount = {}  # docid -> (item, ink)
    extra_amount = {}
    join_failures = []
    for idx, row in _read_tsv(d2totals_path):
        cid = row[idx['CommitteeID']]
        if cid not in sbe_ids:
            continue
        docid = row[idx['FiledDocID']]
        if docid not in all_doc_ids:  # D2Totals row -> FiledDocs.ID join
            join_failures.append({'sbe_committee_id': cid,
                                  'd2totals_id': row[idx['ID']],
                                  'filed_doc_id': docid})
        is_final = doc_to_period.get(docid, (None,))[0] == cid
        is_extra = docid in extra_doc_ids
        if not (is_final or is_extra):
            continue
        item = (_num(row[idx['IndivContribI']]) + _num(row[idx['XferInI']])
                + _num(row[idx['LoanRcvI']]) + _num(row[idx['OtherRctI']]))
        pair = (item, _num(row[idx['InKindI']]))
        if is_final:
            seen_amount[docid] = pair
        if is_extra:
            extra_amount[docid] = pair
    d2_item = defaultdict(dict)
    d2_ink = defaultdict(dict)
    missing_totals = []
    for sbe, periods in final_ids_by_committee.items():
        for period, docid in periods.items():
            if docid in seen_amount:
                d2_item[sbe][period], d2_ink[sbe][period] = seen_amount[docid]
            else:
                d2_item[sbe][period] = 0.0
                d2_ink[sbe][period] = 0.0
                missing_totals.append({'sbe_committee_id': sbe, 'period': list(period),
                                       'filed_doc_id': docid})
    return d2_item, d2_ink, join_failures, missing_totals, extra_amount


def reconcile_committee(periods, contribs, d2_item, d2_ink, threshold):
    """Compare one committee's contributions against its sworn per-period totals.

    Each contribution is assigned to the first period (chronologically) whose
    [beg, end] window contains its date, so it counts once. Overlapping windows
    are resolved upstream by build_filing_registry's overlap-supersede pass; this
    first-match assignment remains as a belt-and-suspenders against any residual
    overlap.
    """
    last_end = max(e for _, e in periods)
    ours_item = defaultdict(float)   # period -> our itemized
    ours_ink = defaultdict(float)    # period -> our in-kind
    aggregate = 0.0                  # our-side only; SBE D-2 has no aggregate line
    pending = 0.0                    # itemized dated after the last filed period end
    for c in contribs:
        ctype = c.get('contribution_type')
        date = c.get('date')
        amt = c.get('amount') or 0.0
        if ctype == AGGREGATE_TYPE:
            aggregate += amt
            continue
        if ctype not in ITEMIZED_TYPES and ctype != INKIND_TYPE:
            continue  # IE-lane and any other types excluded from the compare (v2)
        if date and ctype in ITEMIZED_TYPES and date > last_end:
            pending += amt
        if not date:
            continue
        for (beg, end) in periods:  # periods are sorted; first match wins
            if beg <= date <= end:
                if ctype in ITEMIZED_TYPES:
                    ours_item[(beg, end)] += amt
                else:
                    ours_ink[(beg, end)] += amt
                break

    per_period = []
    all_reconciled = True
    coverage_miss_periods = []
    for period in periods:
        di = round(d2_item.get(period, 0.0), 2)
        dk = round(d2_ink.get(period, 0.0), 2)
        oi = round(ours_item.get(period, 0.0), 2)
        ok = round(ours_ink.get(period, 0.0), 2)
        resid = round(oi - di, 2)
        combined = round((oi + ok) - (di + dk), 2)  # in-kind included, per spec
        if abs(combined) >= CENT:
            all_reconciled = False
        miss = (oi == 0.0 and di > 0.0)  # SBE swore money for a period we have nothing in
        if miss:
            coverage_miss_periods.append({'beg': period[0], 'end': period[1], 'd2_itemized': di})
        per_period.append({
            'beg': period[0], 'end': period[1],
            'd2_itemized': di, 'ours_itemized': oi, 'residual': resid,
            'd2_inkind': dk, 'ours_inkind': ok,
            'coverage_miss': miss,
        })

    tot_d2_item = round(sum(d2_item.get(p, 0.0) for p in periods), 2)
    tot_ours_item = round(sum(ours_item.values()), 2)
    tot_d2_ink = round(sum(d2_ink.get(p, 0.0) for p in periods), 2)
    tot_ours_ink = round(sum(ours_ink.values()), 2)
    residual = round(tot_ours_item - tot_d2_item, 2)

    state = 'RECONCILED' if all_reconciled else 'RESIDUAL'
    flags = []
    if pending > 0:
        flags.append('PENDING-A1')
    if abs(residual) > threshold:
        flags.append('OVER-THRESHOLD')
    if coverage_miss_periods:
        flags.append('COVERAGE-MISS')

    return {
        'state': state,
        'flags': flags,
        'periods_count': len(periods),
        'd2_itemized': tot_d2_item,
        'ours_itemized': tot_ours_item,
        'residual': residual,
        'd2_inkind': tot_d2_ink,
        'ours_inkind': tot_ours_ink,
        'inkind_delta': round(tot_ours_ink - tot_d2_ink, 2),
        'aggregate': round(aggregate, 2),
        'pending': round(pending, 2),
        'last_period_end': last_end,
        'coverage_miss_periods': coverage_miss_periods,
        'per_period': per_period,
    }


def run(data_path, d2totals_path, fileddocs_path, pulled, threshold, known_gaps_path=None):
    data = json.load(open(data_path))
    committees = data.get('committees', {})
    contributions = data.get('contributions', [])

    # Known-gaps ledger: investigated SBE-side divergences to disclose. Exact-match
    # on (committee, period, residual); no auto-annotate path exists by design.
    known_gaps = json.load(open(known_gaps_path)).get('gaps', []) if known_gaps_path else []
    gap_matched = [False] * len(known_gaps)

    # 1. Candidate committees; split by SBE-id presence (NO-SBE-ID never dropped).
    cand = {k: v for k, v in committees.items() if k.startswith('cand-')}
    sbe_to_internal = {}
    no_sbe_id = []
    for k, v in cand.items():
        sbe = v.get('sbe_committee_id')
        if sbe:
            sbe_to_internal[sbe] = k
        else:
            no_sbe_id.append(k)
    sbe_ids = set(sbe_to_internal)

    # 2-3. Filing registry (exact-tuple amendment dedupe, then overlap-supersede).
    finals, superseded, all_doc_ids, overlap_superseded = build_filing_registry(
        fileddocs_path, sbe_ids)
    superseded_docs = {e['superseded_doc'] for lst in overlap_superseded.values() for e in lst}
    # 4. Sworn totals joined by FiledDocID (+ superseded filings, for disclosure).
    d2_item, d2_ink, join_failures, missing_totals, extra_amount = build_d2_amounts(
        d2totals_path, sbe_ids, finals, all_doc_ids, superseded_docs)
    # enrich the overlap-supersede disclosures with the superseded filing's sworn total
    for lst in overlap_superseded.values():
        for e in lst:
            e['superseded_itemized'] = round(extra_amount.get(e['superseded_doc'], (0.0, 0.0))[0], 2)

    contribs_by_committee = defaultdict(list)
    for c in contributions:
        cid = c.get('committee_id')
        if cid in cand:
            contribs_by_committee[cid].append(c)

    committees_out = {}
    tot_d2 = tot_ours = tot_pending = tot_agg = tot_d2_ink = tot_ours_ink = 0.0
    n_reconciled = n_residual = n_too_new = 0
    over_threshold = []
    coverage_miss = []
    disclosed_committees = []

    for sbe, internal in sorted(sbe_to_internal.items(), key=lambda kv: kv[1]):
        meta = cand[internal]
        periods = sorted(finals.get(sbe, {}).keys())
        block = {
            'committee_name': meta.get('committee_name'),
            'sbe_committee_id': sbe,
            'superseded_filings': superseded.get(sbe, 0),
        }
        if sbe in overlap_superseded:
            block['overlap_superseded'] = overlap_superseded[sbe]
        if not periods:
            block['state'] = 'TOO-NEW'
            block['flags'] = []
            block['periods_count'] = 0
            n_too_new += 1
            committees_out[internal] = block
            continue
        rec = reconcile_committee(periods, contribs_by_committee[internal],
                                  d2_item.get(sbe, {}), d2_ink.get(sbe, {}), threshold)
        block.update(rec)
        committees_out[internal] = block

        tot_d2 += rec['d2_itemized']; tot_ours += rec['ours_itemized']
        tot_pending += rec['pending']; tot_agg += rec['aggregate']
        tot_d2_ink += rec['d2_inkind']; tot_ours_ink += rec['ours_inkind']
        if rec['state'] == 'RECONCILED':
            n_reconciled += 1
        else:
            n_residual += 1
        # Known-gaps disclosure: match per-period residuals against the ledger on
        # (committee, period, residual-to-the-cent). Matched periods become DISCLOSED
        # and are excluded from the over-threshold / coverage-miss exit triggers.
        disclosed = []
        for pp in rec['per_period']:
            for gi, g in enumerate(known_gaps):
                if (g['committee'] == internal and g['period_beg'] == pp['beg']
                        and g['period_end'] == pp['end']
                        and abs(round(g['amount'], 2) - pp['residual']) < 0.005):
                    gap_matched[gi] = True
                    disclosed.append({'beg': pp['beg'], 'end': pp['end'],
                                      'residual': pp['residual'], 'reason': g['reason'],
                                      'annotated': g.get('annotated')})
        if disclosed:
            block['disclosed'] = disclosed
            block['flags'].append('DISCLOSED')
            disclosed_committees.append({'committee': internal, 'periods': disclosed})
        disc_resid = round(sum(p['residual'] for p in disclosed), 2)
        disc_set = {(p['beg'], p['end']) for p in disclosed}
        eff_resid = round(rec['residual'] - disc_resid, 2)
        if abs(eff_resid) > threshold:
            over_threshold.append({'committee': internal, 'residual': eff_resid})
        cov_nondisc = [p for p in rec['coverage_miss_periods']
                       if (p['beg'], p['end']) not in disc_set]
        if cov_nondisc:
            coverage_miss.append({'committee': internal, 'periods': cov_nondisc})

    # Stale annotations: ledger entries that matched no current flag. These fail
    # loudly (exit 1) — an annotation may never silently absorb drift.
    stale_annotations = [g for gi, g in enumerate(known_gaps) if not gap_matched[gi]]

    tot_d2 = round(tot_d2, 2); tot_ours = round(tot_ours, 2)
    residual = round(tot_ours - tot_d2, 2)
    match_pct = round(100 * tot_ours / tot_d2, 2) if tot_d2 else None

    report = {
        'run': {
            'data_file': data_path,
            'd2totals_file': d2totals_path,
            'fileddocs_file': fileddocs_path,
            'pulled': pulled,
            'threshold': threshold,
            'scope': 'elections candidate committees (v1); IE and council lanes deferred',
        },
        'headline': {
            'd2_itemized_total': tot_d2,
            'ours_itemized_total': tot_ours,
            'residual': residual,
            'dollar_weighted_match_pct': match_pct,
            'committees_candidate': len(cand),
            'committees_with_sbe_id': len(sbe_ids),
            'committees_no_sbe_id': len(no_sbe_id),
            'committees_with_periods': n_reconciled + n_residual,
            'reconciled': n_reconciled,
            'residual_state': n_residual,
            'too_new': n_too_new,
            'pending_a1_total': round(tot_pending, 2),
            'aggregate_total': round(tot_agg, 2),
            'inkind_d2_total': round(tot_d2_ink, 2),
            'inkind_ours_total': round(tot_ours_ink, 2),
            'over_threshold': over_threshold,
            'coverage_miss_committees': coverage_miss,
            'join_failures': len(join_failures),
            'filings_missing_totals': len(missing_totals),
            'overlap_superseded': sum(len(v) for v in overlap_superseded.values()),
            'disclosed': len(disclosed_committees),
            'stale_annotations': len(stale_annotations),
        },
        'no_sbe_id_committees': sorted(no_sbe_id),
        'join_failures': join_failures,
        'filings_missing_totals': missing_totals,
        'disclosed': disclosed_committees,
        'stale_annotations': stale_annotations,
        'committees': committees_out,
    }
    return report


def print_summary(report, threshold):
    h = report['headline']
    print('=' * 72)
    print('  RECONCILIATION -- itemized data vs SBE D-2 sworn totals')
    print(f"  data pulled {report['run']['pulled']}  |  threshold ${threshold:,.0f}")
    print('=' * 72)
    print(f"  D-2 itemized total : ${h['d2_itemized_total']:>14,.2f}")
    print(f"  ours itemized total: ${h['ours_itemized_total']:>14,.2f}")
    print(f"  residual (ours-D2) : ${h['residual']:>14,.2f}")
    print(f"  dollar-weighted match: {h['dollar_weighted_match_pct']}%")
    print(f"  committees: {h['committees_candidate']} candidate "
          f"({h['committees_with_sbe_id']} w/ SBE id, {h['committees_no_sbe_id']} NO-SBE-ID) "
          f"| {h['committees_with_periods']} w/ periods")
    print(f"  states: {h['reconciled']} RECONCILED, {h['residual_state']} RESIDUAL, "
          f"{h['too_new']} TOO-NEW")
    print(f"  pending (A-1 only): ${h['pending_a1_total']:>14,.2f}   "
          f"aggregate: ${h['aggregate_total']:,.2f}")
    print(f"  in-kind: D2 ${h['inkind_d2_total']:,.2f}  ours ${h['inkind_ours_total']:,.2f}")
    print(f"  join failures: {h['join_failures']}   "
          f"filed-but-empty D-2s (treated $0): {h['filings_missing_totals']}   "
          f"overlap-superseded: {h['overlap_superseded']}")
    print(f"  disclosed (annotated SBE-side gaps): {h['disclosed']}   "
          f"stale annotations: {h['stale_annotations']}")
    print('-' * 72)
    print(f"  {'committee':<28}{'state':<11}{'D-2':>12}{'ours':>12}{'residual':>11}")
    print('-' * 72)
    rows = [(k, v) for k, v in report['committees'].items()]
    rows.sort(key=lambda kv: (kv[1].get('residual') or 0.0))
    for internal, v in rows:
        if v['state'] == 'TOO-NEW':
            print(f"  {internal:<28}{'TOO-NEW':<11}{'':>12}{'':>12}{'':>11}")
            continue
        fl = ''.join('*' if f == 'OVER-THRESHOLD' else '' for f in v['flags'])
        fl += ' PEND' if 'PENDING-A1' in v['flags'] else ''
        fl += ' MISS' if 'COVERAGE-MISS' in v['flags'] else ''
        fl += ' DISC' if 'DISCLOSED' in v['flags'] else ''
        print(f"  {internal:<28}{v['state']:<11}{v['d2_itemized']:>12,.2f}"
              f"{v['ours_itemized']:>12,.2f}{v['residual']:>11,.2f}{fl}")
    print('-' * 72)
    if h['over_threshold']:
        print("  OVER THRESHOLD:")
        for o in h['over_threshold']:
            print(f"    {o['committee']}  residual ${o['residual']:,.2f}")
    if h['coverage_miss_committees']:
        print("  COVERAGE-MISS (SBE swore money for a period we have nothing in):")
        for c in h['coverage_miss_committees']:
            for p in c['periods']:
                print(f"    {c['committee']}  {p['beg']}..{p['end']}  D-2 ${p['d2_itemized']:,.2f}")
    if report.get('disclosed'):
        print("  DISCLOSED (annotated SBE-side gaps -- excluded from exit triggers):")
        for c in report['disclosed']:
            for p in c['periods']:
                print(f"    {c['committee']}  {p['beg']}..{p['end']}  residual ${p['residual']:,.2f}")
    if report.get('stale_annotations'):
        print(f"  *** STALE ANNOTATIONS: {len(report['stale_annotations'])} ledger "
              f"entr{'y' if len(report['stale_annotations'])==1 else 'ies'} match no current "
              f"flag -- re-investigate (annotations may not absorb drift)")
    print('=' * 72)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--data', required=True, help='election-data.json path')
    ap.add_argument('--d2totals', required=True, help='SBE D2Totals bulk export (TSV)')
    ap.add_argument('--fileddocs', required=True, help='SBE FiledDocs bulk export (TSV)')
    ap.add_argument('--out', required=True, help='reconciliation report JSON output path')
    ap.add_argument('--threshold', type=float, default=500.0,
                    help='per-committee |residual| dollars that flags OVER-THRESHOLD (default 500)')
    ap.add_argument('--pulled', required=True,
                    help='date the SBE bulk files were pulled (YYYY-MM-DD); embedded as '
                         'the report\'s "data current as of" stamp')
    ap.add_argument('--known-gaps', default=None,
                    help='optional known-gaps ledger JSON; matched SBE-side gaps become '
                         'DISCLOSED (excluded from exit triggers); stale entries fail loudly')
    args = ap.parse_args()

    try:
        datetime.strptime(args.pulled, '%Y-%m-%d')
    except ValueError:
        print(f"error: --pulled must be YYYY-MM-DD, got {args.pulled!r}", file=sys.stderr)
        sys.exit(2)

    try:
        report = run(args.data, args.d2totals, args.fileddocs, args.pulled, args.threshold,
                     args.known_gaps)
    except FileNotFoundError as e:
        print(f"error: missing input file: {e}", file=sys.stderr)
        sys.exit(2)

    with open(args.out, 'w') as f:
        json.dump(report, f, indent=2, ensure_ascii=True)

    print_summary(report, args.threshold)
    print(f"report written: {args.out}")

    h = report['headline']
    if h['join_failures'] > 0:
        print(f"STRUCTURAL: {h['join_failures']} FiledDocID join failure(s)", file=sys.stderr)
        sys.exit(2)
    if h['stale_annotations'] > 0:
        print(f"STALE: {h['stale_annotations']} known-gaps annotation(s) match no current "
              f"flag -- re-investigate", file=sys.stderr)
        sys.exit(1)
    if h['over_threshold'] or h['coverage_miss_committees']:
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()
