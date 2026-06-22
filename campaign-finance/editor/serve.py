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


def build_payload() -> dict:
    """Read both files and assemble the full read-only worklist payload."""
    donor_rows, committee_rows = {}, {}
    per_file_meta = {}
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

    donors = union_donors(donor_rows)
    committees = union_committees(committee_rows)

    # overlap reconciliation: union = A + B - overlap  ->  overlap = A + B - union
    d_overlap = sum(len(v) for v in donor_rows.values()) - len(donors)
    c_overlap = sum(len(v) for v in committee_rows.values()) - len(committees)

    meta = {
        'per_file': per_file_meta,
        'donors': {
            'union_count': len(donors),
            'union_total': round(sum(r['total_given'] for r in donors), 2),
            'overlap_count': d_overlap,
        },
        'committees': {
            'union_count': len(committees),
            'union_total': round(sum(r['received_total'] for r in committees), 2),
            'overlap_count': c_overlap,
        },
    }
    return {'meta': meta, 'donors': donors, 'committees': committees}


# ============================================================
# SERVER (read-only; GET only)
# ============================================================
class WorklistHandler(BaseHTTPRequestHandler):
    payload_json: bytes = b'{}'              # set in main() once, cached

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
        elif path in ('/', '/index.html'):
            if INDEX_HTML.exists():
                self._send(200, INDEX_HTML.read_bytes(), 'text/html; charset=utf-8')
            else:
                self._send(404, b'index.html not found', 'text/plain; charset=utf-8')
        else:
            self._send(404, b'not found', 'text/plain; charset=utf-8')

    def log_message(self, fmt, *args):       # quieter console
        sys.stderr.write("  %s - %s\n" % (self.address_string(), fmt % args))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--port', type=int, default=8765)
    ap.add_argument('--host', default='127.0.0.1')
    args = ap.parse_args()

    print("Building worklist payload (council + election)…")
    payload = build_payload()
    WorklistHandler.payload_json = json.dumps(payload, ensure_ascii=False).encode('utf-8')

    m = payload['meta']
    print(f"  council : {m['per_file']['council']['donor_count']} donors  "
          f"${m['per_file']['council']['donor_total']:,.2f}")
    print(f"  election: {m['per_file']['election']['donor_count']} donors  "
          f"${m['per_file']['election']['donor_total']:,.2f}")
    print(f"  UNION   : {m['donors']['union_count']} donors "
          f"(overlap {m['donors']['overlap_count']})  ${m['donors']['union_total']:,.2f}")
    print(f"  committees union: {m['committees']['union_count']} "
          f"(overlap {m['committees']['overlap_count']})")

    srv = ThreadingHTTPServer((args.host, args.port), WorklistHandler)
    print(f"\nServing read-only worklist on http://{args.host}:{args.port}/  (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        srv.server_close()


if __name__ == '__main__':
    main()
