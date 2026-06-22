#!/usr/bin/env python3
"""
Editor Worklist Viewer — read-only JSON backend (H1)
=====================================================
Serves the dollar-ranked UNCLASSIFIED worklist — donors AND committees — as JSON
over localhost, for the static viewer in index.html.

READ ONLY by construction: this file imports the shared read model from
ingestion/export_unclassified.py, reads the two committed data JSONs, and serves
them. There are NO write routes, NO Google Sheet access, and NO credentials
anywhere in this module. (Staging + diff preview is H2; the write harness is H3.)

DONOR WORKLIST — the UNION across council-data.json and election-data.json, keyed
and de-duped by donor_id. Each row is stamped with which tool(s) it appears in
(`tools`) and keeps the per-file figures (`per_tool`). Per-file counts and totals
are produced by the SAME build_worklist() the CSV exporter uses, so they match
export_unclassified.py exactly.

  Why MAX, not SUM, for a shared donor's headline total: a donor present in both
  files carries the SAME contribution records in each (the election dataset
  overlaps council's), so summing would double-count. The union row's
  `total_given` is therefore the max across the tools it appears in; the honest
  per-file breakdown stays in `per_tool`.

COMMITTEE WORKLIST — the parallel list: committees that LACK industry_tags (from
each file's data['committees']), unioned by committee_id and ranked by the total
dollars they received. A committee classifies via the Committee Tags tab, a path
separate from donor overrides — hence its own list.

USAGE
    python serve.py [--port 8765]
    # then open http://localhost:8765/  (serve.py also serves index.html at /)
    # or open index.html directly — the JSON endpoint sends permissive CORS.

The payload is built ONCE at startup and cached; restart the server to pick up
fresh data. Standard library only — no pip install.
"""
from __future__ import annotations
import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# The shared read model lives in ingestion/ — import it rather than copy logic.
CF_ROOT = Path(__file__).resolve().parent.parent          # campaign-finance/
sys.path.insert(0, str(CF_ROOT / 'ingestion'))
from export_unclassified import (   # noqa: E402  (path set above)
    build_worklist,
    is_unclassified,
    suggest_industry,
)

# council first so its metadata wins when a donor appears in both (council is the
# canonical, larger dataset). Dict insertion order is significant below.
DATA_FILES = {
    'council':  CF_ROOT / 'council-data.json',
    'election': CF_ROOT / 'election-data.json',
}

HERE = Path(__file__).resolve().parent
INDEX_HTML = HERE / 'index.html'

# Live Sheet read (READ ONLY) — for the H2 diff preview's NEW-vs-UPDATE check.
# Reuses sync_overrides.open_sheet, whose SCOPES are spreadsheets.READONLY and
# whose gspread import is lazy, so the offline endpoints work without creds. The
# default sheet id matches build_all.sh; creds are the existing readonly key.
SHEETS_DIR = CF_ROOT / 'sheets-sync'
sys.path.insert(0, str(SHEETS_DIR))           # so read_live_tabs can import sync_overrides
DEFAULT_SHEET_ID = '1tUJNv7S611xM-VO7LcZlOStbJ8O7LQ5deYjsHeVAwQ8'
DEFAULT_CREDS = SHEETS_DIR / 'creds.json'


# ============================================================
# READ MODEL
# ============================================================
def load(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


def committee_worklist(data: dict) -> list[dict]:
    """Committees LACKING industry_tags, ranked by total dollars received.

    A committee classifies through the Committee Tags tab (by SBE committee_id),
    so 'lacking' means the `industry_tags` key is absent or an empty list — the
    same emptiness apply_committee_tags would leave. Received total is summed in
    one pass over contributions by committee_id.
    """
    received, contrib_n = {}, {}
    for c in data.get('contributions', []):
        cid = c.get('committee_id')
        if not cid:
            continue
        # Exclude internal union-dues transfers — not Council giving/spend; same
        # rule as build_rollups.py / sync_overrides._contribution_totals and the
        # donor worklist in export_unclassified.build_worklist.
        if c.get('contribution_type') == 'IE Committee Dues Transfer':
            continue
        received[cid] = received.get(cid, 0) + (c.get('amount', 0) or 0)
        contrib_n[cid] = contrib_n.get(cid, 0) + 1

    out = []
    for cid, cm in data.get('committees', {}).items():
        if cm.get('industry_tags'):          # non-empty tags -> already classified
            continue
        ward = cm.get('ward', '')
        name = cm.get('committee_name') or cm.get('alder_name') or cid
        out.append({
            'committee_id': cid,
            'name': name,
            'alder_name': cm.get('alder_name', ''),
            'ward': ward,
            'received_total': received.get(cid, 0),
            'contribution_count': contrib_n.get(cid, 0),
        })
    out.sort(key=lambda x: -x['received_total'])
    return out


def union_donors(per_tool: dict[str, list[dict]]) -> list[dict]:
    """Merge each tool's worklist rows into one row per donor_id.

    Headline `total_given` is the MAX across the tools the donor appears in (see
    module docstring — shared contributions are identical across files, so a sum
    would double-count). Each tool's own figures are preserved under `per_tool`.
    """
    merged: dict[str, dict] = {}
    for tool, rows in per_tool.items():      # council iterated first
        for r in rows:
            did = r['donor_id']
            m = merged.get(did)
            if m is None:
                m = {
                    'donor_id': did,
                    'name': r['name'],
                    'occupation': r['occupation'],
                    'employer': r['employer'],
                    'city': r['city'],
                    'suggested_industry': r['suggested_industry'],
                    'suggested_reason': r['suggested_reason'],
                    'tools': [],
                    'per_tool': {},
                    'total_given': 0,
                    'contribution_count': 0,
                    'committees_funded': r['committees_funded'],
                }
                merged[did] = m
            m['tools'].append(tool)
            m['per_tool'][tool] = {
                'total_given': r['total_given'],
                'contribution_count': r['contribution_count'],
                'committees_funded': r['committees_funded'],
            }
            # headline = the larger per-tool total; carry that tool's detail
            if r['total_given'] > m['total_given']:
                m['total_given'] = r['total_given']
                m['contribution_count'] = r['contribution_count']
                m['committees_funded'] = r['committees_funded']
            # backfill any metadata council left blank from the other tool
            for k in ('name', 'occupation', 'employer', 'city',
                      'suggested_industry', 'suggested_reason'):
                if not m[k] and r[k]:
                    m[k] = r[k]

    rows = list(merged.values())
    rows.sort(key=lambda x: -x['total_given'])
    return rows


def union_committees(per_tool: dict[str, list[dict]]) -> list[dict]:
    """Same union treatment for committees, keyed by committee_id (max received)."""
    merged: dict[str, dict] = {}
    for tool, rows in per_tool.items():
        for r in rows:
            cid = r['committee_id']
            m = merged.get(cid)
            if m is None:
                m = {**r, 'tools': [], 'per_tool': {}}
                merged[cid] = m
            m['tools'].append(tool)
            m['per_tool'][tool] = {
                'received_total': r['received_total'],
                'contribution_count': r['contribution_count'],
            }
            if r['received_total'] > m['received_total']:
                m['received_total'] = r['received_total']
                m['contribution_count'] = r['contribution_count']
            if not m.get('name') and r.get('name'):
                m['name'] = r['name']

    rows = list(merged.values())
    rows.sort(key=lambda x: -x['received_total'])
    return rows


def read_vocab(data: dict) -> dict:
    """Pull the editor's dropdown vocab from the data JSON itself — industry_tags
    and flag_types are baked there by sync_overrides, so the UI stays offline
    (no Sheet needed). Returns {industries:[{key,label}], flags:[{key,label}]}."""
    inds, flags = [], []
    for key, v in (data.get('industry_tags') or {}).items():
        inds.append({'key': key, 'label': (v or {}).get('label', key)})
    for key, v in (data.get('flag_types') or {}).items():
        flags.append({'key': key, 'label': (v or {}).get('label', key)})
    inds.sort(key=lambda x: x['label'].lower())
    flags.sort(key=lambda x: x['label'].lower())
    return {'industries': inds, 'flags': flags}


def build_payload() -> dict:
    """Read both files and assemble the full read-only worklist payload."""
    donor_rows, committee_rows = {}, {}
    per_file_meta = {}
    vocab_ind, vocab_flag = {}, {}
    for tool, path in DATA_FILES.items():
        if not path.exists():
            raise SystemExit(f"Data file not found: {path}")
        data = load(path)
        d_rows = build_worklist(data, min_amount=0)        # same read model as the CSV
        c_rows = committee_worklist(data)
        donor_rows[tool] = d_rows
        committee_rows[tool] = c_rows
        per_file_meta[tool] = {
            'donor_count': len(d_rows),
            'donor_total': round(sum(r['total_given'] for r in d_rows), 2),
            'committee_count': len(c_rows),
            'committee_total': round(sum(r['received_total'] for r in c_rows), 2),
        }
        v = read_vocab(data)                                # union vocab across files
        for it in v['industries']:
            vocab_ind[it['key']] = it
        for it in v['flags']:
            vocab_flag[it['key']] = it

    donors = union_donors(donor_rows)
    committees = union_committees(committee_rows)

    # overlap reconciliation: union = A + B - overlap  ->  overlap = A + B - union
    d_overlap = sum(len(v) for v in donor_rows.values()) - len(donors)
    c_overlap = sum(len(v) for v in committee_rows.values()) - len(committees)

    meta = {
        'per_file': per_file_meta,
        'donors': {
            # NO single union dollar: council & election contributions for a shared
            # donor are not the same rows (direct giving is file-specific; the IE
            # layer is duplicated across files with unstable ids), so neither sum
            # nor max is a sound combined total. The headline reports the two
            # per-file totals (per_file.*.donor_total — exact, matching
            # export_unclassified.py); `max` survives only as the row-ranking key.
            'union_count': len(donors),
            'overlap_count': d_overlap,
            'basis': 'per-file totals; rows ranked by max(council,election)',
        },
        'committees': {
            # committee sets ARE disjoint across files (ward vs candidate ids,
            # overlap 0), so a union total here is sound.
            'union_count': len(committees),
            'union_total': round(sum(r['received_total'] for r in committees), 2),
            'overlap_count': c_overlap,
        },
    }
    vocab = {'industries': sorted(vocab_ind.values(), key=lambda x: x['label'].lower()),
             'flags': sorted(vocab_flag.values(), key=lambda x: x['label'].lower())}
    return {'meta': meta, 'donors': donors, 'committees': committees, 'vocab': vocab}


def read_live_tabs(sheet_id: str, creds_file) -> dict:
    """READ ONLY snapshot of the current Donor Overrides + Committee Tags tabs, so
    the diff preview can mark NEW vs UPDATE and show before→after per cell.

    Only get_all_records() (a read) is called — there is NO write verb here.
    Auth/scope come from sync_overrides.open_sheet (spreadsheets.READONLY)."""
    import sync_overrides as so                              # lazy: gspread only loads on demand
    sheet = so.open_sheet(sheet_id, creds_file=str(creds_file))

    def rows(name):
        try:
            ws = sheet.worksheet(name)
        except Exception:
            return []
        return ws.get_all_records()

    donor_cols = ['primary_industry', 'additional_industries', 'flags',
                  'notes', 'last_edited_by']
    donors = {}
    for r in rows('Donor Overrides'):
        did = str(r.get('donor_id') or '').strip()
        if did:
            donors[did] = {k: str(r.get(k, '') or '') for k in donor_cols}
    comms = {}
    for r in rows('Committee Tags'):
        cid = str(r.get('committee_id') or '').strip()
        if cid:
            comms[cid] = {'committee_name': str(r.get('committee_name', '') or ''),
                          'industry_tags': str(r.get('industry_tags', '') or '')}
    return {'donor_overrides': donors, 'committee_tags': comms}


# ============================================================
# SERVER — GET is read-only; POST is the H3 guarded write surface
# (POST /api/write-plan = dry-run, POST /api/write = live write; both via
#  write_overrides, which writes only the Donor Overrides tab).
# ============================================================
class WorklistHandler(BaseHTTPRequestHandler):
    payload_json: bytes = b'{}'              # set in main() once, cached
    sheet_id: str = DEFAULT_SHEET_ID
    creds_file = DEFAULT_CREDS
    _live_cache: bytes = None               # lazy: first /api/live request reads the Sheet

    def _send(self, status, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')   # let file:// index.html fetch
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path in ('/api/worklist', '/api/worklist/'):
            self._send(200, self.payload_json, 'application/json; charset=utf-8')
        elif path in ('/api/live', '/api/live/'):
            self._send(200, self._live_json(), 'application/json; charset=utf-8')
        elif path in ('/', '/index.html'):
            if INDEX_HTML.exists():
                self._send(200, INDEX_HTML.read_bytes(), 'text/html; charset=utf-8')
            else:
                self._send(404, b'index.html not found', 'text/plain; charset=utf-8')
        else:
            self._send(404, b'not found', 'text/plain; charset=utf-8')

    def do_POST(self):
        # The ONLY mutating surface (H3). /api/write-plan is dry-run (no write);
        # /api/write performs the guarded live write. Both re-read the live tab
        # fresh immediately before planning/writing (the concurrent-edit guard).
        path = self.path.split('?', 1)[0]
        if path not in ('/api/write-plan', '/api/write'):
            self._send(404, b'not found', 'text/plain; charset=utf-8'); return
        try:
            n = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n) or b'{}')
            batch = body.get('batch', [])
            import write_overrides as wo
            cls = type(self)
            sheet = wo.open_sheet_rw(cls.sheet_id, cls.creds_file)
            live = wo.read_live_donor_rows(sheet)          # fresh read, immediately before
            plan = wo.build_plan(batch, live)
            if path == '/api/write':
                if plan['blocked']:
                    out = {'mode': 'BLOCKED', 'round_trip': plan['round_trip'], 'plan': plan}
                else:
                    out = {'mode': 'LIVE-WRITE', 'results': wo.execute_plan(sheet, plan),
                           'plan': plan}
            else:
                out = {'mode': 'DRY-RUN', 'plan': plan}
            self._send(200, json.dumps(out, ensure_ascii=False).encode('utf-8'),
                       'application/json; charset=utf-8')
        except Exception as e:
            self._send(200, json.dumps({'mode': 'ERROR', 'error': f'{type(e).__name__}: {e}'}).encode('utf-8'),
                       'application/json; charset=utf-8')

    def _live_json(self) -> bytes:
        cls = type(self)
        if cls._live_cache is None:
            try:
                live = read_live_tabs(cls.sheet_id, cls.creds_file)
                cls._live_cache = json.dumps({'ok': True, **live},
                                             ensure_ascii=False).encode('utf-8')
            except Exception as e:                          # surface, don't crash the server
                return json.dumps({'ok': False,
                                   'error': f'{type(e).__name__}: {e}'}).encode('utf-8')
        return cls._live_cache

    def log_message(self, fmt, *args):       # quieter console
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--sheet-id', default=DEFAULT_SHEET_ID,
                    help='Sheet read (read-only) for the diff preview NEW/UPDATE check')
    ap.add_argument('--creds-file', default=str(DEFAULT_CREDS))
    args = ap.parse_args()

    print("Building worklist payload (council + election)…")
    payload = build_payload()
    WorklistHandler.payload_json = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    WorklistHandler.sheet_id = args.sheet_id
    WorklistHandler.creds_file = args.creds_file

    m = payload['meta']
    print(f"  council : {m['per_file']['council']['donor_count']} donors  "
          f"${m['per_file']['council']['donor_total']:,.2f}")
    print(f"  election: {m['per_file']['election']['donor_count']} donors  "
          f"${m['per_file']['election']['donor_total']:,.2f}")
    print(f"  UNION   : {m['donors']['union_count']} distinct donors "
          f"(overlap {m['donors']['overlap_count']}) — headline uses per-file totals")
    print(f"  committees union: {m['committees']['union_count']} "
          f"(overlap {m['committees']['overlap_count']})")
    print(f"  vocab: {len(payload['vocab']['industries'])} industries, "
          f"{len(payload['vocab']['flags'])} flag types")

    srv = ThreadingHTTPServer((args.host, args.port), WorklistHandler)
    print(f"\nServing read-only worklist on http://{args.host}:{args.port}/  (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        srv.server_close()


if __name__ == '__main__':
    main()
