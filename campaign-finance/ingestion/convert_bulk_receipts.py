#!/usr/bin/env python3
"""convert_bulk_receipts.py -- SBE bulk receipts -> per-committee CSVs in the
format ingest.py expects, implementing the ruled council-migration semantics
(PROBE-MIG-1 / MIG-1). Reusable ritual infrastructure, not a one-off shim.

RULED SCOPE -- a committee's contribution set is:
  (1) rows attached (via FiledDocID) to its FINAL D-2 filings -- the five period
      DocNames {Quarterly, Semiannual, Pre-election, Annual, Final}, exact-tuple
      dedupe then overlap-supersede (reconcile.build_filing_registry's rule), PLUS
  (2) rows on A-1 filings dated AFTER the committee's last final-filing period end
      (the post-final pending tail -- reconcile's PENDING-A1 worldview).
There are NO row-level (date, amount, name) keys anywhere -- that naive method's
+$1.43M amendment over-count is exactly what this scope avoids.

TRANSFORMS (bulk latin-1 -> UTF-8 CSV matching ingest.REQUIRED_COLUMNS):
  LastOnlyName + FirstName -> "Last, First" (comma only when FirstName present;
    org names, which carry no FirstName, pass through as-is so is_individual_name
    reads them as orgs) ; D2Part code -> name ; RcvDate 'YYYY-MM-DD HH:MM:SS' ->
    'M/D/YYYY' (parse_sbe_date accepts only that) ; CommitteeName injected from the
    committee map ; source_filing carried as the kept filing's DocName.

Committee map is read from council-data.json (sbe -> committee_name, ward), plus
the ward-28 committee (SBE 23112, "Citizens for Ervin", ward 28 -- Ishan-ruled).

Output goes to a dedicated dir (default raw/receipts-council/), NOT raw/receipts/
which holds the bulk .txt that ingest_ie still needs; ingest then runs with
--raw-dir pointed at the converter output.
"""
import argparse
import csv
import json
import os
import sys

csv.field_size_limit(10 ** 9)  # bulk has occasional oversized fields
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reconcile as rc  # noqa: E402  (shared filing-registry machinery)

D2PART_NAME = {
    '1A': 'Individual Contribution',
    '2A': 'Transfer In',
    '3A': 'Loan Received',
    '4A': 'Other Receipt',
    '5A': 'In-kind Contribution',
}
OUT_COLUMNS = ['CommitteeID', 'CommitteeName', 'ContributedBy', 'RcvdDate', 'Amount',
               'D2Part', 'LoanAmount', 'DocName', 'Occupation', 'Employer', 'City',
               'State', 'Description']
# ward-28: no sbe id / name in council-data; Ishan-ruled to SBE 23112 "Citizens for Ervin".
WARD28 = {'23112': {'name': 'Citizens for Ervin', 'ward': 28}}

# SBE bulk exports are Windows-1252 (cp1252), NOT latin-1: latin-1 mis-decodes the
# 0x80-0x9F range (e.g. 0x92 smart apostrophe in O'Connor). cp1252 decodes them
# correctly but has FIVE unmapped bytes that crash a strict decode; we pre-scan for
# them so a future pull carrying one fails LOUDLY here rather than corrupting names.
CP1252_UNMAPPED = {0x81, 0x8D, 0x8F, 0x90, 0x9D}


def prescan_unmapped(path):
    """Byte pre-scan: locate any cp1252-unmapped bytes. Returns [(offset, byte), ...]."""
    hits = []
    off = 0
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(1 << 20)
            if not chunk:
                break
            for i, b in enumerate(chunk):
                if b in CP1252_UNMAPPED:
                    hits.append((off + i, hex(b)))
            off += len(chunk)
    return hits


def to_mdy(rcvdate):
    """'2024-04-15 00:00:00' -> '4/15/2024'; '' / malformed -> '' (ingest treats as undated)."""
    d = (rcvdate or '')[:10]
    parts = d.split('-')
    if len(parts) != 3:
        return ''
    y, m, dd = parts
    try:
        return '%d/%d/%s' % (int(m), int(dd), y)
    except ValueError:
        return ''


def build_committee_map(council_data_path):
    d = json.load(open(council_data_path))
    m = {}
    for k, v in d['committees'].items():
        if v.get('type') == 'candidate' and v.get('sbe_committee_id'):
            m[v['sbe_committee_id']] = {'name': v.get('committee_name'), 'ward': v.get('ward')}
    m.update(WARD28)
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bulk', required=True, help='SBE bulk receipts .txt (latin-1)')
    ap.add_argument('--fileddocs', required=True, help='SBE FiledDocs .txt (latin-1)')
    ap.add_argument('--committee-map', required=True, help='council-data.json (sbe -> name/ward)')
    ap.add_argument('--out-dir', default='raw/receipts-council',
                    help='output dir for per-committee CSVs (NOT raw/receipts/ -- bulk lives there)')
    args = ap.parse_args()

    # Encoding safety: cp1252 strict, but fail loudly on unmapped bytes rather than
    # silently corrupt (latin-1's only virtue was never crashing).
    unmapped = prescan_unmapped(args.bulk)
    if unmapped:
        print('FATAL: %d cp1252-unmapped byte(s) in %s -- first 10: %s'
              % (len(unmapped), args.bulk, unmapped[:10]), file=sys.stderr)
        sys.exit(2)
    print('encoding pre-scan: 0 cp1252-unmapped bytes (safe for strict cp1252 decode)')

    cmap = build_committee_map(args.committee_map)
    sbeids = set(cmap)

    # Ruled filing registry: final D-2 filings (overlap-supersede) + A-1 + docid->DocName.
    finals, _, _, _ = rc.build_filing_registry(args.fileddocs, sbeids)
    final_docids = {s: set(fin.values()) for s, fin in finals.items()}
    last_end = {s: max((e for (b, e) in fin), default='0000-00-00') for s, fin in finals.items()}
    docid2doc = {}
    a1 = {s: set() for s in sbeids}
    for idx, row in rc._read_tsv(args.fileddocs):
        c = row[idx['CommitteeID']]
        if c in sbeids:
            did, dn = row[idx['ID']], row[idx['DocName']]
            docid2doc[did] = dn
            if dn == 'A-1':
                a1[c].add(did)

    rows_by_sbe = {s: [] for s in sbeids}
    totals = {s: 0.0 for s in sbeids}
    with open(args.bulk, newline='', encoding='cp1252') as f:  # name-bearing read
        r = csv.reader(f, delimiter='\t')
        h = next(r)
        ix = {x: i for i, x in enumerate(h)}
        for row in r:
            if len(row) <= ix['RedactionRequested']:
                continue
            c = row[ix['CommitteeID']]
            if c not in sbeids:
                continue
            part = row[ix['D2Part']]
            if part not in D2PART_NAME:
                continue
            fd = row[ix['FiledDocID']]
            dt = row[ix['RcvDate']][:10]
            if fd in final_docids.get(c, ()):
                docname = docid2doc.get(fd)
            elif fd in a1[c] and dt > last_end.get(c, 'z'):
                docname = 'A-1'
            else:
                continue  # not in ruled scope
            last = row[ix['LastOnlyName']].strip()
            first = row[ix['FirstName']].strip()
            contributed_by = ('%s, %s' % (last, first)) if first else last
            rows_by_sbe[c].append({
                'CommitteeID': c,
                'CommitteeName': cmap[c]['name'] or '',
                'ContributedBy': contributed_by,
                'RcvdDate': to_mdy(row[ix['RcvDate']]),
                'Amount': row[ix['Amount']],
                'D2Part': D2PART_NAME[part],
                'LoanAmount': row[ix['LoanAmount']],
                'DocName': docname,
                'Occupation': row[ix['Occupation']],
                'Employer': row[ix['Employer']],
                'City': row[ix['City']],
                'State': row[ix['State']],
                'Description': row[ix['Description']],
            })
            try:
                totals[c] += float(row[ix['Amount']] or 0)
            except ValueError:
                pass

    os.makedirs(args.out_dir, exist_ok=True)
    written = 0
    for sbe in sorted(sbeids):
        rows = rows_by_sbe[sbe]
        if not rows:
            continue
        path = os.path.join(args.out_dir, '%s council.csv' % sbe)
        with open(path, 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
            w.writeheader()
            w.writerows(rows)
        written += 1

    print('=== convert_bulk_receipts: per-committee ruled totals ===')
    field = 0.0
    for sbe in sorted(sbeids, key=lambda s: -totals[s]):
        n = len(rows_by_sbe[sbe])
        field += totals[sbe]
        print('  %-8s %-28s rows=%-6d $%s' % (sbe, (cmap[sbe]['name'] or '')[:28], n,
                                              format(round(totals[sbe], 2), ',.2f')))
    print('  FIELD TOTAL: $%s  across %d committees (%d CSVs written to %s)'
          % (format(round(field, 2), ',.2f'), len(sbeids), written, args.out_dir))


if __name__ == '__main__':
    main()
