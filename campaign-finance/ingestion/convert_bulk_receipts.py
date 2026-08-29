#!/usr/bin/env python3
"""convert_bulk_receipts.py -- SBE bulk receipts -> per-committee CSVs in the
format the pipeline expects. UNIFIED bulk-pathway converter (HALT-BULK-A, 2026-07-22),
superseding the MIG-1 registry-selection engine per the G1a-ext ruling.

RULED SELECTION (single engine, both lanes -- HALT-BULK-A G1a-ext, Ishan 2026-07-22):
  a committee's contribution set is the rows with receipts.Archived == 'False'.
  SBE marks superseded receipt rows Archived=True (amendment supersession AND A-1
  absorption both flow through it); the committee-search export is the Archived=='False'
  view. This is SBE's own authoritative supersession marker -- PROBE-BULK proved it
  reproduces the committee-search export exactly (36/36 elections, modulo two ruled
  riders), and G1a-ext proved it authoritative over the registry heuristic on the one
  divergent committee (15622: export == Archived, 1611/1611).

  reconcile.build_filing_registry (final D-2 + post-final A-1 tail, overlap-supersede)
  is RETAINED AS A CROSS-CHECK TRIP-WIRE, not the selection: both are computed and any
  per-committee disagreement is flagged loudly (never a silent choice). 15622 is the
  one known armed instance (2003 Semiannual-vs-Pre-election overlap where the registry's
  window+receipt-order heuristic guesses opposite to SBE's Archived flag); its firing on
  a council rebuild is designed behavior, resolved in the council-correction HALT.

PARSE: reassembly-first (PROBE-BULK 3c). Record boundaries come from an ID-anchor span
  rule (a record starts where the first two tab-fields are both all-digits: ID+CommitteeID),
  so embedded-newline records reassemble; field extraction is csv-semantic per record to
  match the historical whole-file csv.reader byte-for-byte. Global accounting assert
  (header + sum(span line counts) == total physical lines) and a quarantine with an
  over-broad committee-id clearance assert (no requested committee id may appear anywhere
  in a non-reassembling record's raw text) guard against a malformed span hiding a wanted row.

TRANSFORMS (bulk cp1252 -> UTF-8 CSV):
  LastOnlyName + FirstName -> "Last, First" (comma only when FirstName present) ;
  D2Part code -> name (1A..5A bijection) ; RcvDate 'YYYY-MM-DD HH:MM:SS' -> 'M/D/YYYY'
  (parse_sbe_date accepts only that) ; CommitteeName injected from the committee map
  (ingest13) or the committees bulk (export26) ; source_filing = the kept row's DocName.

OUTPUT FORMATS (--format):
  ingest13  -- the 13-column set ingest.py reads (council lane; DEFAULT; unchanged bytes).
  export26  -- the 26-column committee-search-export format (elections lane; adds
               Address/Zip/Vendor/Election/RptPd/FiledRcvdDate via the FiledDocs join),
               so downstream consumes it exactly as a committee-search export.

Committee set (COUNCIL MODE is now the tracked artifact, CNCL-DATA-1 P1.2):
  --council-list  campaign-finance/ingestion/council-2027-committees.tsv -- the ruled,
                  curated selection (ids + wards). The run prints its sha256 and row
                  count, so every rebuild names the set it ran against. This replaces
                  deriving the council set from council-data.json, which stated no
                  identity at run time.
  --committee-map council-data.json (the older council derivation; unchanged, still
                  available, mutually exclusive with --council-list).
  --committee-ids <file> (explicit id list, one per line; export26/elections).
  Names for export26 come from --committees (the committees bulk, committees.Name).

REVIEW QUEUE (--queue-since YYYY-MM-DD, D3): each run can report the Chicago committees of
  ANY type that took a receipt since the stated last-run date and are NOT on the selection
  list. Activity-keyed with no creation-date clause -- see build_review_queue.
"""
import argparse
import collections
import csv
import hashlib
import io
import json
import os
import re
import sys
import unicodedata

csv.field_size_limit(10 ** 9)  # bulk has occasional oversized fields
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import reconcile as rc  # noqa: E402  (shared filing-registry machinery -- cross-check trip-wire)

D2PART_NAME = {
    '1A': 'Individual Contribution',
    '2A': 'Transfer In',
    '3A': 'Loan Received',
    '4A': 'Other Receipt',
    '5A': 'In-kind Contribution',
}
# Receipts bulk 29-column order (index map for reassembled records).
RECEIPTS_COLUMNS = ['ID', 'CommitteeID', 'FiledDocID', 'ETransID', 'LastOnlyName', 'FirstName',
                    'RcvDate', 'Amount', 'AggregateAmount', 'LoanAmount', 'Occupation', 'Employer',
                    'Address1', 'Address2', 'City', 'State', 'Zip', 'D2Part', 'Description',
                    'VendorLastOnlyName', 'VendorFirstName', 'VendorAddress1', 'VendorAddress2',
                    'VendorCity', 'VendorState', 'VendorZip', 'Archived', 'Country', 'RedactionRequested']
RX = {c: i for i, c in enumerate(RECEIPTS_COLUMNS)}
NFIELDS = len(RECEIPTS_COLUMNS)

OUT13 = ['CommitteeID', 'CommitteeName', 'ContributedBy', 'RcvdDate', 'Amount',
         'D2Part', 'LoanAmount', 'DocName', 'Occupation', 'Employer', 'City',
         'State', 'Description']
OUT26 = ['CommitteeID', 'CommitteeName', 'ContributedBy', 'RcvdDate', 'Amount', 'LoanAmount',
         'Occupation', 'Employer', 'Address1', 'Address2', 'City', 'State', 'Zip', 'D2Part',
         'Description', 'VendorName', 'VendorAddress1', 'VendorAddress2', 'VendorCity',
         'VendorState', 'VendorZip', 'DocName', 'Election', 'RptPdBegDate', 'RptPdEndDate',
         'FiledRcvdDate']

# SBE bulk exports are Windows-1252 (cp1252). cp1252 has FIVE unmapped bytes that crash a
# strict decode; we pre-scan so a future pull carrying one fails LOUDLY rather than corrupt.
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
    return m


def build_council_selection(list_path):
    """COUNCIL MODE selection: read the tracked artifact council-2027-committees.tsv.

    Replaces deriving the council set from council-data.json. That derivation stated no
    identity at run time -- nothing recorded which committees it had selected, or why --
    so a rebuild could not be tied to the set it was built from. This reads a curated,
    ruled file and returns its identity with it, so every run names what it ran against.

    Returns (map, identity) where map is sbe_id -> {'name', 'ward'} (ward None when the
    row's office_scope is not a ward, e.g. council-unspecified) and identity is
    {'path', 'sha256', 'rows'}.
    """
    h = hashlib.sha256()
    with open(list_path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    m = {}
    with open(list_path, newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            cid = (r.get('committee_id') or '').strip()
            if not cid:
                continue
            scope = (r.get('office_scope') or '').strip()
            mo = re.match(r'^ward-(\d+)$', scope)
            m[cid] = {'name': (r.get('name') or '').strip() or None,
                      'ward': int(mo.group(1)) if mo else None}
    return m, {'path': list_path, 'sha256': h.hexdigest(), 'rows': len(m)}


def build_committees_name_map(committees_path, ids):
    """committees.ID -> committees.Name, for the requested ids (export26 name join)."""
    want = set(ids)
    out = {}
    for idx, row in rc._read_tsv(committees_path):
        if len(row) <= idx['Name']:  # skip blank/short lines (committees bulk has one blank line)
            continue
        if row[idx['ID']] in want:
            out[row[idx['ID']]] = row[idx['Name']]
    return out


# ---------------------------------------------------------------------------
# Reassembly-first parse (PROBE-BULK 3c): ID-anchor spans + csv-semantic fields.
# ---------------------------------------------------------------------------
def _is_record_start(line_no_nl):
    body = line_no_nl.rstrip(b'\r')
    parts = body.split(b'\t', 2)
    return len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit()


def _fields_from_span(span_bytes):
    """csv-semantic field extraction (matches the historical whole-file csv.reader).

    ADMIT-AND-GUARD (CNCL-DATA-1 P1.2). This used to return None for any span that did not
    parse to exactly NFIELDS columns, which sent SHORT records -- real receipt rows missing
    only their trailing fields -- to the quarantine alongside genuinely unreassembled ones.
    A short record now returns its fields right-padded to NFIELDS, so every RX index is
    safe: the absent tail fields are genuinely absent, not shifted.

    Records LONGER than NFIELDS are a different animal and are NOT admitted. An extra tab
    shifts every field after the break, so their tails cannot be trusted and emitting them
    would be silent corruption; they stay in the quarantine, where the over-broad clearance
    assert still fails the run loudly if one belongs to a requested committee.

    Returns (fields, kind), kind in 'exact' | 'short' | 'overlong' | 'unreassembled'.
    """
    text = b'\n'.join(span_bytes).decode('cp1252')
    rows = list(csv.reader(io.StringIO(text), delimiter='\t'))
    if len(rows) != 1:
        return None, 'unreassembled'
    row = rows[0]
    if len(row) == NFIELDS:
        return row, 'exact'
    if len(row) < NFIELDS:
        return row + [''] * (NFIELDS - len(row)), 'short'
    return row, 'overlong'


def reassembly_parse(bulk_path, wanted_ids, queue_since=None):
    """Return {committee_id: [record(list of NFIELDS str)]} for wanted_ids, with the
    3c global accounting assert and the quarantine over-broad clearance assert.

    queue_since (YYYY-MM-DD) additionally accumulates, for EVERY committee in the file and
    not just the wanted ones, the latest RcvDate at or after that date -- the activity
    signal the D3 review queue keys on. Costs one dict; avoids a second pass over 1 GB."""
    wanted = set(wanted_ids)
    wanted_bytes = {w.encode('ascii') for w in wanted}
    rows = {w: [] for w in wanted}
    total_physical = 1  # header
    sum_span_lines = 0
    emitted = 0
    quarantined = 0
    n_short = 0
    n_short_wanted = 0
    n_overlong = 0
    active_since = {}
    clearance_hits = []

    with open(bulk_path, 'rb') as f:
        header = f.readline()
        hcols, _hkind = _fields_from_span([header.rstrip(b'\n')])
        if hcols != RECEIPTS_COLUMNS:
            raise SystemExit('FATAL: receipts header does not match the expected 29-column layout')
        cur = []

        def process(span):
            nonlocal emitted, quarantined, n_short, n_short_wanted, n_overlong
            sp = [s.rstrip(b'\r') for s in span] if len(span) == 1 else span
            fs, kind = _fields_from_span(sp)
            if fs is not None and kind != 'overlong':
                emitted += 1
                if kind == 'short':
                    n_short += 1
                cid = fs[RX['CommitteeID']]
                if queue_since:
                    d = fs[RX['RcvDate']][:10]
                    if d >= queue_since and d > active_since.get(cid, ''):
                        active_since[cid] = d
                if cid in rows:
                    rows[cid].append(fs)
                    if kind == 'short':
                        n_short_wanted += 1
                return
            quarantined += 1
            if kind == 'overlong':
                n_overlong += 1
            raw = b'\n'.join(span)
            for wb, w in zip(wanted_bytes, wanted):
                if wb in raw:
                    clearance_hits.append((w, raw[:120].decode('cp1252', 'replace')))

        for raw in f:
            total_physical += 1
            lb = raw.rstrip(b'\n')
            if _is_record_start(lb):
                if cur:
                    sum_span_lines += len(cur)
                    process(cur)
                cur = [lb]
            else:
                cur.append(lb)
        if cur:
            sum_span_lines += len(cur)
            process(cur)

    if sum_span_lines != total_physical - 1:
        raise SystemExit('FATAL: 3c accounting assert failed: header(1)+span_lines(%d) != total_physical(%d)'
                         % (sum_span_lines, total_physical))
    if clearance_hits:
        raise SystemExit('FATAL: 3c quarantine clearance assert failed -- requested committee id in a '
                         'non-reassembling record: %s' % clearance_hits[:10])
    return rows, {'total_physical': total_physical, 'emitted': emitted, 'quarantined': quarantined,
                  'short': n_short, 'short_wanted': n_short_wanted, 'overlong': n_overlong,
                  'active_since': active_since}


# ---------------------------------------------------------------------------
# Registry cross-check metadata + FiledDocs join (for export26).
# ---------------------------------------------------------------------------
def registry_meta(fileddocs_path, wanted_ids):
    wanted = set(wanted_ids)
    finals, _, _, _ = rc.build_filing_registry(fileddocs_path, wanted)
    final_docids = {s: set(fin.values()) for s, fin in finals.items()}
    last_end = {s: max((e for (b, e) in fin), default='0000-00-00') for s, fin in finals.items()}
    a1 = {s: set() for s in wanted}
    docmeta = {}
    for idx, row in rc._read_tsv(fileddocs_path):
        c = row[idx['CommitteeID']]
        if c in wanted:
            did = row[idx['ID']]
            docmeta[did] = {
                'DocName': row[idx['DocName']],
                'ElectionType': row[idx['ElectionType']],
                'ElectionYear': row[idx['ElectionYear']],
                'RptPdBegDate': row[idx['RptPdBegDate']],
                'RptPdEndDate': row[idx['RptPdEndDate']],
                'RcvdDateTime': row[idx['RcvdDateTime']],
            }
            if row[idx['DocName']] == 'A-1':
                a1[c].add(did)
    return final_docids, last_end, a1, docmeta


def _contributed_by(last, first):
    last, first = last.strip(), first.strip()
    return ('%s, %s' % (last, first)) if first else last


def emit_ingest13(row, cmap_name, docmeta):
    fd = row[RX['FiledDocID']]
    return {
        'CommitteeID': row[RX['CommitteeID']],
        'CommitteeName': cmap_name or '',
        'ContributedBy': _contributed_by(row[RX['LastOnlyName']], row[RX['FirstName']]),
        'RcvdDate': to_mdy(row[RX['RcvDate']]),
        'Amount': row[RX['Amount']],
        'D2Part': D2PART_NAME[row[RX['D2Part']]],
        'LoanAmount': row[RX['LoanAmount']],
        'DocName': docmeta.get(fd, {}).get('DocName', ''),
        'Occupation': row[RX['Occupation']],
        'Employer': row[RX['Employer']],
        'City': row[RX['City']],
        'State': row[RX['State']],
        'Description': row[RX['Description']],
    }


def emit_export26(row, cname, docmeta):
    fd = row[RX['FiledDocID']]
    md = docmeta.get(fd, {})
    return {
        'CommitteeID': row[RX['CommitteeID']],
        'CommitteeName': cname or '',
        'ContributedBy': _contributed_by(row[RX['LastOnlyName']], row[RX['FirstName']]),
        'RcvdDate': to_mdy(row[RX['RcvDate']]),
        'Amount': row[RX['Amount']],
        'LoanAmount': row[RX['LoanAmount']],
        'Occupation': row[RX['Occupation']],
        'Employer': row[RX['Employer']],
        'Address1': row[RX['Address1']],
        'Address2': row[RX['Address2']],
        'City': row[RX['City']],
        'State': row[RX['State']],
        'Zip': row[RX['Zip']],
        'D2Part': D2PART_NAME[row[RX['D2Part']]],
        'Description': row[RX['Description']],
        'VendorName': _contributed_by(row[RX['VendorLastOnlyName']], row[RX['VendorFirstName']]),
        'VendorAddress1': row[RX['VendorAddress1']],
        'VendorAddress2': row[RX['VendorAddress2']],
        'VendorCity': row[RX['VendorCity']],
        'VendorState': row[RX['VendorState']],
        'VendorZip': row[RX['VendorZip']],
        'DocName': md.get('DocName', ''),
        # FiledDocs.ElectionType -> the output column named 'Election'. The carriage is kept,
        # but the source field is mostly empty and effectively dead: measured on the sealed
        # 2026-08-20 vintage, 198,883 of 953,044 FiledDocs rows carry a value (20.9%), and the
        # latest row that carries one was received 2020-10-28 -- population collapses after
        # 2011 (734 rows that year, then a trickle of 197/68/167/83/5/4 through 2017 and a
        # single 2020 row). NO CONSUMER MAY CONDITION ON IT: an absent value here means the
        # filing predates or skipped the field, never that the filing has no election.
        'Election': md.get('ElectionType', ''),
        'RptPdBegDate': to_mdy(md.get('RptPdBegDate', '')),
        'RptPdEndDate': to_mdy(md.get('RptPdEndDate', '')),
        'FiledRcvdDate': to_mdy(md.get('RcvdDateTime', '')),
    }


# ---------------------------------------------------------------------------
# --verify-against: sampled-reproduction guard (the standing per-future-pull
# check, in the tool). Re-derives one committee (export26) and asserts it ==
# the given same-day committee-search export, modulo the two ruled riders
# (quote-mangling where the tool is authoritative; redaction City/State blanks).
# Exits non-zero on any UNEXPLAINED divergence -- catches encoding/parse/selection
# drift mechanically, not in prose.
# ---------------------------------------------------------------------------
READ13 = ['CommitteeID', 'CommitteeName', 'ContributedBy', 'RcvdDate', 'Amount', 'D2Part',
          'LoanAmount', 'Occupation', 'Employer', 'City', 'State', 'DocName', 'Description']


def _nt(s):
    return unicodedata.normalize('NFC', (s or '').strip())


def _nd(d):
    p = (d or '').strip().split('/')
    if len(p) == 3:
        try:
            return '%d/%d/%d' % (int(p[0]), int(p[1]), int(p[2]))
        except ValueError:
            return (d or '').strip()
    return (d or '').strip()


def _na(a):
    try:
        return round(float((a or '0').strip() or 0), 2)
    except ValueError:
        return a


def _t13key(r):
    return tuple(_na(r[k]) if k in ('Amount', 'LoanAmount')
                else (_nd(r[k]) if k == 'RcvdDate' else _nt(r.get(k, '')))
                for k in READ13)


def verify_against(export_path, bulk, fileddocs, committees):
    with open(export_path, newline='', encoding='utf-8') as f:
        erows = [r for r in csv.DictReader(f) if any((v or '').strip() for v in r.values())]
    if not erows:
        raise SystemExit('verify: export %s has no data rows' % export_path)
    cid = (erows[0].get('CommitteeID') or '').strip()
    if not cid:
        raise SystemExit('verify: export first row carries no CommitteeID')

    final_docids, last_end, a1, docmeta = registry_meta(fileddocs, {cid})
    rows_by_c, _ = reassembly_parse(bulk, {cid})
    name = build_committees_name_map(committees, {cid}).get(cid) if committees else None
    tool = [emit_export26(r, name, docmeta)
            for r in rows_by_c.get(cid, [])
            if r[RX['D2Part']] in D2PART_NAME and r[RX['Archived']].strip() == 'False']

    if len(tool) != len(erows):
        raise SystemExit('VERIFY FAIL committee %s: row count tool=%d != export=%d'
                         % (cid, len(tool), len(erows)))

    tt13 = collections.Counter(_t13key(r) for r in tool)
    et13 = collections.Counter(_t13key(r) for r in erows)
    QUOTE = '"'
    ci, si = READ13.index('City'), READ13.index('State')
    cbi, cni = READ13.index('ContributedBy'), READ13.index('CommitteeName')
    unexplained, nq, nr = [], 0, 0
    for k in (tt13 - et13):
        ek = next((e for e in et13 if (e[2], e[3], e[4]) == (k[2], k[3], k[4])), None)
        if ek is None:
            ek = next((e for e in et13 if (e[3], e[4]) == (k[3], k[4])
                       and (QUOTE in k[cbi] or QUOTE in e[cbi] or QUOTE in k[cni] or QUOTE in e[cni])), None)
        if ek is None:
            unexplained.append(('no_export_counterpart', k[2], k[3], k[4]))
            continue
        diffs = [READ13[i] for i in range(len(READ13)) if k[i] != ek[i]]
        qf = [f for f in diffs if f in ('ContributedBy', 'CommitteeName')]
        cs = [f for f in diffs if f in ('City', 'State')]
        other = [f for f in diffs if f not in ('ContributedBy', 'CommitteeName', 'City', 'State')]
        qok = (not qf) or (QUOTE in k[cbi] or QUOTE in ek[cbi] or QUOTE in k[cni] or QUOTE in ek[cni])
        csok = (not cs) or (k[ci] == '' and ek[ci] != '') or (k[si] == '' and ek[si] != '')
        if other or not qok or not csok:
            unexplained.append(('unexplained_fields', diffs, k[2]))
        else:
            nq += 1 if qf else 0
            nr += 1 if cs else 0

    if unexplained:
        print('VERIFY FAIL committee %s: %d unexplained diff(s)' % (cid, len(unexplained)), file=sys.stderr)
        for u in unexplained[:10]:
            print('   ', u, file=sys.stderr)
        sys.exit(1)
    print('VERIFY PASS committee %s: tool export26 == export modulo ruled riders '
          '(rows=%d, quote-mangling=%d, redaction City/State=%d)' % (cid, len(tool), nq, nr))
    sys.exit(0)


def build_review_queue(committees_path, active_since, selected_ids, since):
    """The D3 standing review queue, activity-keyed.

    Ratified shape: committees with City == Chicago, ANY type, at least one receipt dated in
    the window since the stated last-run date, and NOT on the selection list. There is
    deliberately no creation-date clause -- the earlier queue carried one, and the miss-trace
    showed exactly what that costs: 39590 (Laura Yepez) was created in 2023, so a
    creation-2026 clause could never have surfaced her however active she was. Activity is
    the signal that generalizes; creation date is not.

    Returns a list of dicts sorted by last receipt date descending, then committee id.
    """
    out = []
    for idx, row in rc._read_tsv(committees_path):
        if len(row) <= idx['Purpose']:
            continue
        cid = row[idx['ID']]
        if cid in selected_ids or cid not in active_since:
            continue
        if row[idx['City']].strip() != 'Chicago':
            continue
        out.append({'committee_id': cid,
                    'name': _tsv_safe(row[idx['Name']]),
                    'type': row[idx['TypeOfCommittee']].strip(),
                    'status': row[idx['Status']].strip(),
                    'creation_date': row[idx['CreationDate']].strip()[:10],
                    'last_receipt_date': active_since[cid],
                    'window_since': since})
    out.sort(key=lambda r: (r['last_receipt_date'], r['committee_id']), reverse=True)
    return out


QUEUE_COLUMNS = ['committee_id', 'name', 'type', 'status', 'creation_date',
                 'last_receipt_date', 'window_since']


def _tsv_safe(v):
    """Collapse any tab/CR/LF in a bulk field to a space so the row stays one TSV line.

    The queue is written QUOTE_NONE, matching the selection artifact: a committee name
    legitimately carrying a double quote (SBE has several -- Che "Rhymefest" Smith) must
    not make the writer quote the whole field and change the file's shape mid-file.
    """
    return ' '.join((v or '').split('\t'))[:300].replace('\r', ' ').replace('\n', ' ').strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bulk', required=True, help='SBE bulk receipts .txt (cp1252)')
    ap.add_argument('--fileddocs', required=True, help='SBE FiledDocs .txt')
    ap.add_argument('--format', choices=['ingest13', 'export26'], default='ingest13',
                    help='output column format (default ingest13 = council lane)')
    ap.add_argument('--committee-map', help='council-data.json (sbe -> name/ward); ingest13/council')
    ap.add_argument('--council-list', help='COUNCIL MODE: the tracked selection artifact '
                    'campaign-finance/ingestion/council-2027-committees.tsv (ids + wards). '
                    'Replaces the --committee-map derivation and states the selection identity')
    ap.add_argument('--queue-since', metavar='YYYY-MM-DD',
                    help='D3 review queue: report Chicago committees of ANY type with a receipt '
                    'dated on/after this (the last-run date) that are NOT on the selection list; '
                    'requires --committees')
    ap.add_argument('--committee-ids', help='explicit committee-id list, one per line; export26/elections')
    ap.add_argument('--committees', help='SBE committees bulk .txt for the export26 name join')
    ap.add_argument('--out-dir', default='raw/receipts-council',
                    help='output dir for per-committee CSVs')
    ap.add_argument('--verify-against', help='a same-day committee-search export CSV; re-derive '
                    'that committee (export26) and assert == the export modulo the ruled riders, '
                    'then exit (sampled-reproduction guard; requires --committees for the name join)')
    args = ap.parse_args()

    # Encoding safety (preserved): cp1252 strict, fail loudly on unmapped bytes.
    unmapped = prescan_unmapped(args.bulk)
    if unmapped:
        print('FATAL: %d cp1252-unmapped byte(s) in %s -- first 10: %s'
              % (len(unmapped), args.bulk, unmapped[:10]), file=sys.stderr)
        sys.exit(2)
    print('encoding pre-scan: 0 cp1252-unmapped bytes (safe for strict cp1252 decode)')

    if args.verify_against:
        verify_against(args.verify_against, args.bulk, args.fileddocs, args.committees)
        return  # verify_against exits

    # Committee set + names.
    cmap = {}
    selection = None
    if args.council_list:
        if args.committee_map:
            raise SystemExit('--council-list and --committee-map are two derivations of the same '
                             'council set; pass one, not both')
        cmap, selection = build_council_selection(args.council_list)
        print('selection: %s' % selection['path'])
        print('  sha256 %s' % selection['sha256'])
        print('  %d committees on the list' % selection['rows'])
    elif args.committee_map:
        cmap = build_committee_map(args.committee_map)
        print('selection: derived from %s (no stated identity -- see --council-list)'
              % args.committee_map)
    ids = set(cmap)
    if args.committee_ids:
        with open(args.committee_ids) as f:
            ids |= {ln.strip() for ln in f if ln.strip()}
    if not ids:
        raise SystemExit('no committees selected: pass --committee-map and/or --committee-ids')
    name_map = {c: (cmap.get(c, {}) or {}).get('name') for c in ids}
    if args.format == 'export26':
        if not args.committees:
            raise SystemExit('export26 requires --committees (committees bulk) for the name join')
        cn = build_committees_name_map(args.committees, ids)
        for c in ids:
            if cn.get(c):
                name_map[c] = cn[c]

    if args.queue_since and not args.committees:
        raise SystemExit('--queue-since requires --committees (the committees bulk) for City/type')

    # Registry metadata (cross-check trip-wire + export26 FiledDocs join).
    final_docids, last_end, a1, docmeta = registry_meta(args.fileddocs, ids)

    # Parse (reassembly-first).
    rows_by_c, stats = reassembly_parse(args.bulk, ids, queue_since=args.queue_since)
    print('reassembly parse: total_physical=%d emitted=%d quarantined=%d (clearance CLEAR)'
          % (stats['total_physical'], stats['emitted'], stats['quarantined']))
    print('  row admission: a span parsing to ONE csv row is admitted whatever its field count; '
          'short rows are right-padded to %d fields (%d admitted, %d of them on a requested '
          'committee); rows LONGER than %d are quarantined unemitted because an extra tab shifts '
          'their tail (%d such)'
          % (NFIELDS, stats['short'], stats['short_wanted'], NFIELDS, stats['overlong']))

    # Select (Archived == 'False'), compute registry cross-check, emit.
    os.makedirs(args.out_dir, exist_ok=True)
    disagreements = []
    totals = {}
    written = 0
    emit = emit_export26 if args.format == 'export26' else emit_ingest13
    columns = OUT26 if args.format == 'export26' else OUT13
    for c in sorted(ids, key=lambda s: (len(s), s)):
        contrib = [r for r in rows_by_c.get(c, []) if r[RX['D2Part']] in D2PART_NAME]
        sel_ids, reg_ids = set(), set()
        out_rows = []
        tot = 0.0
        for r in contrib:
            rid = r[RX['ID']]
            archived_keep = r[RX['Archived']].strip() == 'False'
            fd = r[RX['FiledDocID']]
            dt = r[RX['RcvDate']][:10]
            registry_keep = fd in final_docids.get(c, ()) or (fd in a1.get(c, ()) and dt > last_end.get(c, 'z'))
            if archived_keep:
                sel_ids.add(rid)
            if registry_keep:
                reg_ids.add(rid)
            if archived_keep:
                if args.format == 'export26':
                    out_rows.append(emit_export26(r, name_map.get(c), docmeta))
                else:
                    out_rows.append(emit_ingest13(r, name_map.get(c), docmeta))
                try:
                    tot += float(r[RX['Amount']] or 0)
                except ValueError:
                    pass
        if sel_ids != reg_ids:
            disagreements.append({'committee': c, 'archived_only': len(sel_ids - reg_ids),
                                  'registry_only': len(reg_ids - sel_ids)})
        totals[c] = (len(out_rows), round(tot, 2))
        if out_rows:
            path = os.path.join(args.out_dir, '%s council.csv' % c if args.format == 'ingest13'
                                else '%s export.csv' % c)
            with open(path, 'w', newline='', encoding='utf-8') as fo:
                w = csv.DictWriter(fo, fieldnames=columns)
                w.writeheader()
                w.writerows(out_rows)
            written += 1

    # Cross-check trip-wire: registry disagreement is flagged loudly, never silent.
    if disagreements:
        print('\n*** REGISTRY CROSS-CHECK TRIP-WIRE: %d committee(s) where Archived-selection != '
              'registry-selection (selection is Archived, ruled authoritative; review): ***'
              % len(disagreements), file=sys.stderr)
        for d in disagreements:
            print('    committee %s: archived_only=%d registry_only=%d'
                  % (d['committee'], d['archived_only'], d['registry_only']), file=sys.stderr)
    else:
        print('registry cross-check: 0 disagreements (Archived == registry on all requested committees)')

    field = round(sum(t[1] for t in totals.values()), 2)
    print('=== convert_bulk_receipts (%s): %d committees, %d CSVs -> %s ==='
          % (args.format, len(ids), written, args.out_dir))
    print('  FIELD TOTAL: $%s' % format(field, ',.2f'))

    # D3 standing review queue (activity-keyed; no creation-date clause).
    if args.queue_since:
        q = build_review_queue(args.committees, stats['active_since'], ids, args.queue_since)
        qpath = os.path.join(args.out_dir, 'review-queue.tsv')
        with open(qpath, 'w', newline='', encoding='utf-8') as fo:
            w = csv.DictWriter(fo, fieldnames=QUEUE_COLUMNS, delimiter='\t',
                               lineterminator='\n', extrasaction='ignore',
                               quoting=csv.QUOTE_NONE, quotechar='')
            w.writeheader()
            w.writerows(q)
        print('review queue (since %s): %d Chicago committee(s) of any type took a receipt in '
              'the window and are NOT on the selection list -> %s'
              % (args.queue_since, len(q), qpath))


if __name__ == '__main__':
    main()
