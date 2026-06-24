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
from urllib.parse import urlsplit, parse_qs

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
sys.path.insert(0, str(HERE))                 # so we can import the shared composer constants
import compose                                # noqa: E402  STARTER_ENTITY_TYPES (shared vocab seed)
DEFAULT_SHEET_ID = '1tUJNv7S611xM-VO7LcZlOStbJ8O7LQ5deYjsHeVAwQ8'
DEFAULT_CREDS = SHEETS_DIR / 'creds.json'


# ============================================================
# READ MODEL
# ============================================================
_LOAD_CACHE: dict[str, dict] = {}


def load(path: Path) -> dict:
    """Read + cache a data JSON. Memoized so the worklist payload AND the master
    donor index (build_donor_index) share one parse of each large file."""
    p = str(path)
    if p not in _LOAD_CACHE:
        with open(path) as f:
            _LOAD_CACHE[p] = json.load(f)
    return _LOAD_CACHE[p]


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
    (no Sheet needed). Returns {industries:[{key,label}], flags:[{key,label}],
    severities:[…]}. severities are the live distinct values (for vocab-add — read,
    don't hardcode)."""
    inds, flags, sev = [], [], set()
    for key, v in (data.get('industry_tags') or {}).items():
        inds.append({'key': key, 'label': (v or {}).get('label', key)})
    for key, v in (data.get('flag_types') or {}).items():
        flags.append({'key': key, 'label': (v or {}).get('label', key)})
        s = (v or {}).get('severity')
        if s:
            sev.add(s)
    # entity_types: UNION of the code-constant starter set with the operator-added
    # 'Entity Types' tab (data['entity_types']). Constant WINS for starter keys; the
    # tab contributes only NEW keys -> core can't be clobbered, labels can't disagree.
    ent = {}
    for e in compose.STARTER_ENTITY_TYPES:
        ent[e['key']] = {'key': e['key'], 'label': e['label']}
    for key, v in (data.get('entity_types') or {}).items():
        if key not in ent:
            ent[key] = {'key': key, 'label': (v or {}).get('label', key)}
    inds.sort(key=lambda x: x['label'].lower())
    flags.sort(key=lambda x: x['label'].lower())
    ents = sorted(ent.values(), key=lambda x: x['label'].lower())
    return {'industries': inds, 'flags': flags, 'severities': sorted(sev),
            'entity_types': ents}


def build_payload() -> dict:
    """Read both files and assemble the full read-only worklist payload."""
    donor_rows, committee_rows = {}, {}
    per_file_meta = {}
    vocab_ind, vocab_flag, vocab_sev, vocab_ent = {}, {}, set(), {}
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
        for it in v['entity_types']:
            vocab_ent.setdefault(it['key'], it)        # constant-first order preserved
        vocab_sev.update(v['severities'])

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
             'flags': sorted(vocab_flag.values(), key=lambda x: x['label'].lower()),
             'entity_types': sorted(vocab_ent.values(), key=lambda x: x['label'].lower()),
             'severities': sorted(vocab_sev)}
    return {'meta': meta, 'donors': donors, 'committees': committees, 'vocab': vocab}


# ============================================================
# MASTER DONOR INDEX  (read-only — the lookup surface, NOT gated by
# is_unclassified). The worklist (build_payload) stays unclassified-only; this
# indexes the FULL donor universe so ANY donor — classified or not — is reachable
# for editing. It carries each donor's CURRENT (flat) classification straight from
# the data JSON (industries/flags/notes), which the editor shows as un-curated
# current state. No primary/additional split lives here (the data JSON has none —
# that split exists only in the live Sheet, read separately via /api/live); the
# curator owns promoting a flat value to primary. Read-only: no write surface.
# ============================================================
def _is_classified(inds) -> bool:
    return any(x and x != 'unclassified' for x in (inds or []))


def _donor_rows_for(tool: str, data: dict) -> list[dict]:
    """Every non-aggregate donor in one file, with giving aggregated in a SINGLE
    pass over contributions (the full set is too large for the worklist's
    per-donor contribution scan). Dues transfers excluded — same footprint rule as
    build_worklist, so a donor's dollars/count match the worklist where they
    overlap. Carries the donor's current flat classification verbatim."""
    totals, counts, cmtes = {}, {}, {}
    for c in data.get('contributions', []):
        did = c.get('donor_id')
        if not did:
            continue
        if c.get('contribution_type') == 'IE Committee Dues Transfer':
            continue
        totals[did] = totals.get(did, 0) + (c.get('amount', 0) or 0)
        counts[did] = counts.get(did, 0) + 1
        cmtes.setdefault(did, set()).add(c.get('committee_id'))

    c2a = {}
    for cid, cm in data.get('committees', {}).items():
        nm, wd = cm.get('alder_name', ''), cm.get('ward', '')
        c2a[cid] = (f"Ward {wd} — {nm}" if nm else
                    f"Ward {wd}" if wd else (cm.get('committee_name') or cid))

    rows = []
    for did, donor in data.get('donors', {}).items():
        if did.startswith('_'):
            continue
        funded = sorted(set(c2a.get(x, x) for x in cmtes.get(did, set()) if x))
        rows.append({
            'donor_id': did,
            'name': donor.get('name', '') or '',
            'occupation': donor.get('occupation', '') or '',
            'employer': donor.get('employer', '') or '',
            'city': donor.get('city', '') or '',
            'total_given': totals.get(did, 0),
            'contribution_count': counts.get(did, 0),
            'committees_funded': '; '.join(funded),
            # CURRENT classification (flat) — what the editor shows as un-curated state
            'industries': donor.get('industries', []) or [],
            'flags': donor.get('flags', []) or [],
            'notes': donor.get('notes') or '',
            'entity_type': donor.get('entity_type', '') or '',   # for filter/display (clustering)
            'last_edited_by': donor.get('_last_edited_by', '') or '',
            'tool': tool,
        })
    return rows


def build_donor_index() -> list[dict]:
    """Full donor universe unioned across both files, keyed by donor_id. Headline
    total_given is MAX across tools (same ranking rule as union_donors). The current
    classification is the classified industries list where the tools disagree (an
    auto/curated tag in either file wins over a blank/unclassified one)."""
    merged: dict[str, dict] = {}
    for tool, path in DATA_FILES.items():
        for r in _donor_rows_for(tool, load(path)):
            did = r['donor_id']
            m = merged.get(did)
            if m is None:
                m = {k: v for k, v in r.items() if k != 'tool'}
                m['tools'] = [tool]
                m['per_tool'] = {tool: {'total_given': r['total_given'],
                                        'contribution_count': r['contribution_count']}}
                m['suggested_industry'] = ''      # lookup donors carry no heuristic hint
                m['suggested_reason'] = ''
                merged[did] = m
                continue
            m['tools'].append(tool)
            m['per_tool'][tool] = {'total_given': r['total_given'],
                                   'contribution_count': r['contribution_count']}
            if r['total_given'] > m['total_given']:
                m['total_given'] = r['total_given']
                m['contribution_count'] = r['contribution_count']
                m['committees_funded'] = r['committees_funded']
            if (not _is_classified(m['industries'])) and _is_classified(r['industries']):
                m['industries'] = r['industries']
            if not m['flags'] and r['flags']:
                m['flags'] = r['flags']
            if not m['notes'] and r['notes']:
                m['notes'] = r['notes']
            for k in ('name', 'occupation', 'employer', 'city', 'last_edited_by', 'entity_type'):
                if not m[k] and r[k]:
                    m[k] = r[k]
    return list(merged.values())


def search_donor_index(index: list[dict], q: str, cap: int = 100,
                       ind: str = '', etype: str = '', browse: bool = False) -> list[dict]:
    """Substring/id search over the master index, with optional industry-tag and
    entity_type FILTERS (for the clustering discovery surface: filter to e.g. all
    labor-teachers donors and browse without typing). Exact donor_id match is pinned
    first; the rest rank by total_given. With NO query and NO filter, returns nothing
    (lookup is explicit, not the default queue) UNLESS browse=True (Cluster-tab
    render-on-open), which returns the top donors by total_given as a candidate pool;
    a filter alone is a valid browse."""
    q = (q or '').strip().lower()
    ind = (ind or '').strip()
    etype = (etype or '').strip()
    if not q and not ind and not etype:
        if browse:
            return sorted(index, key=lambda r: -r['total_given'])[:cap]
        return []
    scored = []
    for r in index:
        if ind and ind not in (r.get('industries') or []):
            continue
        if etype and (r.get('entity_type') or '') != etype:
            continue
        if q:
            if r['donor_id'].lower() == q:
                scored.append((0, r)); continue
            hay = ' '.join((r['donor_id'], r['name'], r['employer'],
                            r['occupation'], r['city'])).lower()
            if q not in hay:
                continue
            scored.append((1, r))
        else:
            scored.append((1, r))            # filter-only browse
    scored.sort(key=lambda t: (t[0], -t[1]['total_given']))
    return [r for _, r in scored[:cap]]


# ============================================================
# CLUSTER ROLLUP PREVIEW  (HALT-3a) — the dry-run's per-file dollar figure, computed
# the SAME way the rendered rollup is: build_rollups.by_parent sums each present
# member's contributions EXCLUDING is_aggregate / EXCLUDED_CYCLES / dues / Aggregate-
# type donors. We mirror that filter EXACTLY so the dry-run number equals what the
# build will render, and so the gate-4 hand-sum matches. No union total, ever — each
# file's figure is that file's present members only.
# ============================================================
def _excluded_cycles() -> set:
    """Single source: build_rollups.EXCLUDED_CYCLES (imported, not duplicated)."""
    try:
        import build_rollups as br
        return set(br.EXCLUDED_CYCLES)
    except Exception:
        return {'pre-2011', 'undated'}


def per_file_donor_totals() -> dict:
    """{tool: {donor_id: dues/cycle/aggregate-excluded total}} — one pass per file,
    using build_rollups.by_parent's exact exclusion set so a cluster preview equals
    the rendered rollup."""
    excl = _excluded_cycles()
    out = {}
    for tool, path in DATA_FILES.items():
        data = load(path)
        donors = data.get('donors', {})
        agg = {k for k, v in donors.items() if v.get('type') == 'Aggregate'}
        t = {}
        for c in data.get('contributions', []):
            if c.get('is_aggregate'):
                continue
            if c.get('cycle') in excl:
                continue
            if c.get('contribution_type') == 'IE Committee Dues Transfer':
                continue
            did = c.get('donor_id')
            if not did or did in agg or did not in donors:
                continue
            t[did] = t.get(did, 0) + (c.get('amount') or 0)
        out[tool] = t
    return out


def cluster_preview(plan: dict, per_file_totals: dict) -> dict:
    """Per-file rollup + cross-dataset resolution for a cluster plan's members. Mirrors
    apply_clusters: members absent from a file are dropped; <2 present => the cluster
    won't form in that file; the parent reparents to the first present member when the
    chosen parent is absent. The total is Σ present members' (dues/cycle/aggregate-
    excluded) contributions — recomputed per file, never a stored/union total."""
    members, parent = plan['members'], plan['parent']
    per_file = {}
    for tool, path in DATA_FILES.items():
        donors = load(path).get('donors', {})
        totals = per_file_totals.get(tool, {})
        present = [m for m in members if m in donors]
        eff_parent = parent if parent in present else (present[0] if present else None)
        per_file[tool] = {
            'present': present,
            'present_count': len(present),
            'absent': [m for m in members if m not in donors],
            'rolled_up_dollars': round(sum(totals.get(m, 0) for m in present), 2),
            'forms_cluster': len(present) >= 2,
            'parent_present': parent in donors,
            'effective_parent': eff_parent,          # who apply_clusters will reparent to
            'reparented': bool(eff_parent and eff_parent != parent),
        }
    return {'per_file': per_file, 'dues_excluded': True,
            'basis': 'by_parent filter: excludes IE Committee Dues Transfer, '
                     'pre-2011/undated cycles, aggregate rows & Aggregate-type donors; '
                     'present members only, recomputed per file (no union total)'}


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
                  'notes', 'last_edited_by', 'entity_type']   # entity_type read by name (absent-tolerant)
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
    donor_index: list = []                   # master lookup set (full universe), cached
    per_file_totals: dict = {}               # {tool:{donor_id: dues-excl total}} for cluster preview
    sheet_id: str = DEFAULT_SHEET_ID
    creds_file = DEFAULT_CREDS
    _live_cache: bytes = None               # lazy: first /api/live request reads the Sheet
    _clusters_cache: bytes = None           # lazy: first /api/clusters read; invalidated on a cluster write

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
        elif path in ('/api/donor', '/api/donor/'):
            self._send(200, self._donor_search_json(), 'application/json; charset=utf-8')
        elif path in ('/api/live', '/api/live/'):
            self._send(200, self._live_json(), 'application/json; charset=utf-8')
        elif path in ('/api/clusters', '/api/clusters/'):
            self._send(200, self._clusters_json(), 'application/json; charset=utf-8')
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
            do_write = (path == '/api/write')
            plans, results, blocked = {}, {}, False

            # CLUSTER write path (HALT-3a) — dedicated multi-row writer, NOT the
            # single-key spec machinery. Runs before/alongside the spec loop; cluster
            # items never match a SPECS kind so the loop ignores them.
            cluster_items = [b for b in batch if b.get('kind') == 'cluster']
            if cluster_items:
                existing_ids = wo.read_cluster_ids(sheet)      # fresh-read collision guard basis
                cplans = []
                for it in cluster_items:
                    cp = wo.build_cluster_plan(it, existing_ids)
                    cp['preview'] = cluster_preview(cp, cls.per_file_totals)
                    if cp['blocked']:
                        blocked = True
                    if do_write and not cp['blocked']:
                        cp['result'] = wo.execute_cluster_plan(sheet, cp)
                        existing_ids.append(cp['cluster_id'])  # next mint in same batch sees it
                        cls._clusters_cache = None             # a new cluster landed -> /api/clusters must re-read
                    cplans.append(cp)
                plans['cluster'] = cplans

            # CLUSTER EDIT path (HALT-EDIT-1) — modify EXISTING clusters. Inverted guard:
            # operate on a fresh grouped read; the writer re-reads raw rows for key-addressed
            # row ops. Parent-integrity enforced in the plan; preview = resulting rollup.
            edit_items = [b for b in batch if b.get('kind') == 'cluster-edit']
            if edit_items:
                clusters = wo.read_clusters(sheet)             # fresh grouped read
                by_cid = {c['cluster_id']: c for c in clusters}
                by_donor = {m['donor_id']: {'cluster_id': c['cluster_id'], 'cluster_name': c['cluster_name']}
                            for c in clusters for m in c['members']}
                eplans = []
                for it in edit_items:
                    ep = wo.build_cluster_edit_plan(it, by_cid.get((it.get('cluster_id') or '').strip()), by_donor)
                    res = ep.get('resulting') or {}
                    # delete_cluster: preview the rollup that is REMOVED (over the deleted members),
                    # not the empty post-delete membership.
                    if ep.get('op') == 'delete_cluster':
                        dm = ep.get('deleted_members') or []
                        ep['preview'] = cluster_preview({'members': dm, 'parent': dm[0] if dm else ''}, cls.per_file_totals)
                    else:
                        ep['preview'] = cluster_preview({'members': res.get('members', []),
                                                         'parent': res.get('parent', '')}, cls.per_file_totals)
                    if ep['blocked']:
                        blocked = True
                    if do_write and not ep['blocked']:
                        ep['result'] = wo.execute_cluster_edit_plan(sheet, ep)
                        cls._clusters_cache = None             # membership changed -> /api/clusters must re-read
                    eplans.append(ep)
                plans['cluster-edit'] = eplans

            # CLUSTER MERGE path (HALT-MERGE) — combine B into survivor A in ONE ordered plan
            # (appends → A-row updates → delete B LAST). Composes the EDIT-1/EDIT-2 primitives.
            merge_items = [b for b in batch if b.get('kind') == 'cluster-merge']
            if merge_items:
                clusters = wo.read_clusters(sheet)             # fresh grouped read of both clusters
                by_cid = {c['cluster_id']: c for c in clusters}
                by_donor = {m['donor_id']: {'cluster_id': c['cluster_id'], 'cluster_name': c['cluster_name']}
                            for c in clusters for m in c['members']}
                mplans = []
                for it in merge_items:
                    mp = wo.build_cluster_merge_plan(it, by_cid.get((it.get('cluster_id') or '').strip()),
                                                     by_cid.get((it.get('absorb_id') or '').strip()), by_donor)
                    res = mp.get('resulting') or {}
                    mp['preview'] = cluster_preview({'members': res.get('members', []),
                                                     'parent': res.get('parent', '')}, cls.per_file_totals)
                    if mp['blocked']:
                        blocked = True
                    if do_write and not mp['blocked']:
                        mp['result'] = wo.execute_cluster_merge_plan(sheet, mp)
                        cls._clusters_cache = None             # membership changed -> /api/clusters must re-read
                    mplans.append(mp)
                plans['cluster-merge'] = mplans

            # split by surface; each tab gets its OWN fresh read immediately before
            for kind, spec in wo.SPECS.items():
                items = [b for b in batch if b.get('kind', 'donor') == kind]
                if not items:
                    continue
                live = wo.read_live_rows(sheet, spec)
                # union-aware add-only guard: seed the code-constant starter keys into
                # the live read so build_plan's existing collision check treats them as
                # already-existing (no machinery change). Only specs with seed_keys
                # (entity_vocab) carry these; for entity_type the seed dedupes the
                # starter set against inline-adds.
                for sk in spec.get('seed_keys', []):
                    live.setdefault(sk, {'label': ''})
                plan = wo.build_plan(items, live, spec)
                plans[kind] = plan
                if plan['blocked']:
                    blocked = True
                if do_write and not plan['blocked']:
                    results[kind] = wo.execute_plan(sheet, plan, spec)
            mode = ('BLOCKED' if (do_write and blocked)
                    else 'LIVE-WRITE' if do_write else 'DRY-RUN')
            out = {'mode': mode, 'plans': plans, 'results': results}
            self._send(200, json.dumps(out, ensure_ascii=False).encode('utf-8'),
                       'application/json; charset=utf-8')
        except Exception as e:
            self._send(200, json.dumps({'mode': 'ERROR', 'error': f'{type(e).__name__}: {e}'}).encode('utf-8'),
                       'application/json; charset=utf-8')

    def _donor_search_json(self) -> bytes:
        """GET /api/donor?q=<id-or-name> — master-view lookup over the FULL donor
        set (read-only; NOT gated by is_unclassified). Returns each hit's current
        classification so the editor can render it. Empty q -> no hits, UNLESS
        &browse=1 (Cluster-tab render-on-open): then an empty query returns the top
        donors by total_given as a candidate pool. Lookup/Find-donor never sends
        browse, so their explicit-lookup default is unchanged."""
        qs = parse_qs(urlsplit(self.path).query)
        q = (qs.get('q', ['']) or [''])[0]
        ind = (qs.get('ind', ['']) or [''])[0]
        etype = (qs.get('etype', ['']) or [''])[0]
        browse = (qs.get('browse', ['']) or [''])[0] in ('1', 'true')
        hits = search_donor_index(type(self).donor_index, q, ind=ind, etype=etype, browse=browse)
        return json.dumps({'q': q, 'ind': ind, 'etype': etype, 'browse': browse,
                           'count': len(hits), 'hits': hits},
                          ensure_ascii=False).encode('utf-8')

    def _clusters_json(self) -> bytes:
        """GET /api/clusters — READ-ONLY snapshot of existing clusters + a by_donor index
        so the Cluster tab can show what is already clustered and hard-block duplicate
        mints (FIX-3a-2). No write verb (sync_overrides.open_sheet is READONLY-scoped).
        Cached per-process; invalidated when the editor writes a new cluster."""
        cls = type(self)
        if cls._clusters_cache is None:
            try:
                import sync_overrides as so                  # lazy: gspread only on demand
                import write_overrides as wo
                sheet = so.open_sheet(cls.sheet_id, creds_file=str(cls.creds_file))
                clusters = wo.read_clusters(sheet)
                # READ-ONLY name-join (HALT-EDIT-1): the Donor Clusters tab has no name
                # column, so resolve each member's display name from the in-memory donor
                # index (built at startup). Pure read; no write, no extra fetch.
                names = {d['donor_id']: d.get('name', '') for d in (cls.donor_index or [])}
                by_donor = {}                                # donor_id -> its cluster (last wins; overlaps are now 0)
                for c in clusters:
                    for m in c['members']:
                        m['name'] = names.get(m['donor_id'], '')
                        by_donor[m['donor_id']] = {'cluster_id': c['cluster_id'],
                                                   'cluster_name': c['cluster_name'],
                                                   'role': m['role'],
                                                   'name': names.get(m['donor_id'], '')}
                cls._clusters_cache = json.dumps({'ok': True, 'count': len(clusters),
                                                  'clusters': clusters, 'by_donor': by_donor},
                                                 ensure_ascii=False).encode('utf-8')
            except Exception as e:                           # surface, don't crash the server
                return json.dumps({'ok': False,
                                   'error': f'{type(e).__name__}: {e}'}).encode('utf-8')
        return cls._clusters_cache

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
    print("Building master donor index (full universe — lookup surface)…")
    WorklistHandler.donor_index = build_donor_index()
    print("Computing per-file dues-excluded totals (cluster preview)…")
    WorklistHandler.per_file_totals = per_file_donor_totals()
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
    print(f"  master index: {len(WorklistHandler.donor_index):,} donors reachable by lookup "
          f"(classified + unclassified)")

    srv = ThreadingHTTPServer((args.host, args.port), WorklistHandler)
    print(f"\nServing read-only worklist on http://{args.host}:{args.port}/  (Ctrl-C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        srv.server_close()


if __name__ == '__main__':
    main()
