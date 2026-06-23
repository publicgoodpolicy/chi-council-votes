#!/usr/bin/env python3
"""
Editor write surface — guarded write to the Donor Overrides tab (H3)
====================================================================
The editor's ONLY mutating path. It writes solely to the Sheet's 'Donor Overrides'
tab — never the data JSON, never the SBE seed, never any other tab. The batch is
composed once by compose.py (the canonical composer), gated behind a parser
round-trip + a dry-run that re-reads the live tab, and written cell-by-cell so
untouched cells keep their live values (no clobber).

ISOLATION FROM THE SYNC
-----------------------
sync_overrides.open_sheet stays spreadsheets.READONLY and is NOT modified. This
module has its OWN write-scoped open (open_sheet_rw, scope spreadsheets) using the
same service-account creds. The SA must be shared as Editor on the Sheet for the
write to resolve; a Viewer share read-opens fine but 403s on write.

COLUMN-MAP DRIVEN  (§7/§9)
--------------------------
Reads/writes are generic over DONOR_COLUMNS: the header row in the live tab maps
column name -> column index, and the plan diffs by column name. Adding a future
field is additive — extend DONOR_COLUMNS (and compose.py) and nothing else here
changes.

    python write_overrides.py --batch batch.json --dry-run     # plan only
    python write_overrides.py --batch batch.json --confirm     # live write
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CF_ROOT = HERE.parent
SHEETS_DIR = CF_ROOT / 'sheets-sync'
sys.path.insert(0, str(HERE))            # compose.py
import compose                           # noqa: E402  (canonical composer + parsers)

WRITE_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
DONOR_TAB = 'Donor Overrides'
DONOR_COLUMNS = compose.DONOR_COLUMNS         # ['donor_id', ...,'last_edited_by'] — single source
KEY_COLUMN = 'donor_id'
COMMITTEE_TAB = 'Committee Tags'
COMMITTEE_COLUMNS = compose.COMMITTEE_COLUMNS  # ['committee_id','committee_name','industry_tags']
COMMITTEE_KEY = 'committee_id'
DEFAULT_SHEET_ID = '1tUJNv7S611xM-VO7LcZlOStbJ8O7LQ5deYjsHeVAwQ8'
DEFAULT_CREDS = SHEETS_DIR / 'creds.json'


# ============================================================
# WRITE-SCOPED OPEN  (separate from sync_overrides.open_sheet / .readonly)
# ============================================================
def open_sheet_rw(sheet_id: str, creds_file):
    """Open the Sheet read/WRITE with the editor's own write scope. gspread and
    google-auth are imported lazily so the rest of editor/ stays import-light."""
    import gspread
    from google.oauth2.service_account import Credentials
    creds = Credentials.from_service_account_file(str(creds_file), scopes=WRITE_SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


def confirm_write_access(sheet) -> dict:
    """No-op write probe: read A1 of the Donor Overrides tab and write the SAME
    value back. Succeeds (net-zero change) only if the SA holds Editor — proving
    the share resolved without polluting any data."""
    ws = sheet.worksheet(DONOR_TAB)
    a1 = ws.acell('A1').value
    ws.update_acell('A1', a1 if a1 is not None else '')   # idempotent write -> 403 if Viewer-only
    return {'tab': DONOR_TAB, 'a1': a1, 'writable': True}


# ============================================================
# READ the live tab (write path's own fresh read) — column-map driven
# ============================================================
def read_live_rows(sheet, spec: dict) -> dict:
    """Fresh {key: {col: cell}} read of a tab — used for the dry-run NEW/UPDATE
    recompute and the concurrent-edit guard. Generic over spec (tab/key/columns)."""
    ws = sheet.worksheet(spec['tab'])
    rows = ws.get_all_records()
    key = spec['key']
    cols = [c for c in spec['columns'] if c != key]
    out = {}
    for r in rows:
        k = str(r.get(key, '') or '').strip()
        if k:
            out[k] = {c: str(r.get(c, '') or '') for c in cols}
    return out


def read_live_donor_rows(sheet) -> dict:
    return read_live_rows(sheet, DONOR_SPEC)


def read_live_committee_rows(sheet) -> dict:
    return read_live_rows(sheet, COMMITTEE_SPEC)


# ============================================================
# MERGE  (staged edits over live; per kind)
# ============================================================
def _merged_donor_item(item: dict, live_row) -> dict:
    """Donor: edited columns take staged values, the rest keep their parsed live
    values (no clobber). The intended final row state."""
    ed = set(item.get('edited') or [])
    base = {
        'primary_industry': (live_row or {}).get('primary_industry', ''),
        'additional_industries': compose.parse_list_cell((live_row or {}).get('additional_industries', '')),
        'flags': compose.parse_flag_cell((live_row or {}).get('flags', '')),
        'notes': (live_row or {}).get('notes', ''),
        # entity_type — preserve the live cell unless explicitly edited (orthogonal
        # to industry; a single scalar, no parse). Never inferred.
        'entity_type': (live_row or {}).get('entity_type', ''),
    }
    return {
        'donor_id': item['donor_id'],
        'primary_industry': item.get('primary_industry', '') if 'primary_industry' in ed else base['primary_industry'],
        'additional_industries': item.get('additional_industries', []) if 'additional_industries' in ed else base['additional_industries'],
        'flags': item.get('flags', []) if 'flags' in ed else base['flags'],
        'notes': item.get('notes', '') if 'notes' in ed else base['notes'],
        'entity_type': item.get('entity_type', '') if 'entity_type' in ed else base['entity_type'],
    }


def _merged_committee_item(item: dict, live_row) -> dict:
    """Committee: industry_tags edited -> staged, else parsed live. committee_name
    is reference (kept from live on UPDATE; from staged/data on NEW)."""
    ed = set(item.get('edited') or [])
    base_tags = compose.parse_list_cell((live_row or {}).get('industry_tags', ''))
    name = (live_row or {}).get('committee_name', '') or item.get('committee_name', '')
    return {
        'committee_id': item['committee_id'],
        'committee_name': name,
        'industry_tags': item.get('industry_tags', []) if 'industry_tags' in ed else base_tags,
    }


def _merged_vocab_item(item: dict, live_row) -> dict:
    """Vocab-add is ADD-only (collision guard blocks existing keys), so there is no
    merge against live — the staged item IS the row."""
    return dict(item)


INDUSTRY_VOCAB_TAB = 'Industry Tags'
FLAG_VOCAB_TAB = 'Flag Types'
ENTITY_VOCAB_TAB = 'Entity Types'
INDUSTRY_VOCAB_COLUMNS = compose.INDUSTRY_VOCAB_COLUMNS   # key | label | color
FLAG_VOCAB_COLUMNS = compose.FLAG_VOCAB_COLUMNS           # key | label | severity
ENTITY_VOCAB_COLUMNS = compose.ENTITY_VOCAB_COLUMNS       # key | label
# Starter entity types are a CODE constant (compose). The add-only collision guard
# must be UNION-AWARE: an inline-add of a starter key (e.g. 'labor') is a collision
# even though the tab itself may not contain it. serve.py seeds these into the live
# read before build_plan so the existing guard fires — no machinery change.
ENTITY_VOCAB_SEED_KEYS = [e['key'] for e in compose.STARTER_ENTITY_TYPES]

# Kind specs — the ONLY per-surface knobs. Adding a future field is additive:
# extend the columns/compose in compose.py; the plan/execute machinery is generic.
# key_of(item): how to derive the row key (worklist id, or slug(label) for vocab).
# add_only: collision guard — an existing key blocks instead of becoming an UPDATE.
DONOR_SPEC = {
    'kind': 'donor', 'tab': DONOR_TAB, 'columns': DONOR_COLUMNS, 'key': KEY_COLUMN,
    'key_of': lambda i: i['donor_id'], 'stamp_col': 'last_edited_by', 'add_only': False,
    'merge': _merged_donor_item, 'compose': compose.compose_donor_cells,
    'sanitize': compose.sanitization_notes, 'roundtrip': compose.roundtrip_donors,
}
COMMITTEE_SPEC = {
    'kind': 'committee', 'tab': COMMITTEE_TAB, 'columns': COMMITTEE_COLUMNS, 'key': COMMITTEE_KEY,
    'key_of': lambda i: i['committee_id'], 'stamp_col': None, 'add_only': False,
    'merge': _merged_committee_item, 'compose': compose.compose_committee_cells,
    # committee tags are vocab-only (no free text), so nothing to sanitize/hold
    'sanitize': lambda item: {'warn': [], 'hold': []},
    'roundtrip': compose.roundtrip_committees,
}
INDUSTRY_VOCAB_SPEC = {
    'kind': 'industry_vocab', 'tab': INDUSTRY_VOCAB_TAB, 'columns': INDUSTRY_VOCAB_COLUMNS, 'key': 'key',
    'key_of': lambda i: compose.slug(i.get('label', '')), 'stamp_col': None, 'add_only': True,
    'merge': _merged_vocab_item,
    'compose': lambda it: compose.compose_vocab_cells(it, INDUSTRY_VOCAB_COLUMNS),
    'sanitize': lambda item: {'warn': [], 'hold': []},
    'roundtrip': lambda items: compose.roundtrip_vocab(items, INDUSTRY_VOCAB_TAB, INDUSTRY_VOCAB_COLUMNS),
}
FLAG_VOCAB_SPEC = {
    'kind': 'flag_vocab', 'tab': FLAG_VOCAB_TAB, 'columns': FLAG_VOCAB_COLUMNS, 'key': 'key',
    'key_of': lambda i: compose.slug(i.get('label', '')), 'stamp_col': None, 'add_only': True,
    'merge': _merged_vocab_item,
    'compose': lambda it: compose.compose_vocab_cells(it, FLAG_VOCAB_COLUMNS),
    'sanitize': lambda item: {'warn': [], 'hold': []},
    'roundtrip': lambda items: compose.roundtrip_vocab(items, FLAG_VOCAB_TAB, FLAG_VOCAB_COLUMNS),
}
ENTITY_VOCAB_SPEC = {
    'kind': 'entity_vocab', 'tab': ENTITY_VOCAB_TAB, 'columns': ENTITY_VOCAB_COLUMNS, 'key': 'key',
    'key_of': lambda i: compose.slug(i.get('label', '')), 'stamp_col': None, 'add_only': True,
    'merge': _merged_vocab_item,
    'compose': lambda it: compose.compose_vocab_cells(it, ENTITY_VOCAB_COLUMNS),
    'sanitize': lambda item: {'warn': [], 'hold': []},
    'roundtrip': lambda items: compose.roundtrip_vocab(items, ENTITY_VOCAB_TAB, ENTITY_VOCAB_COLUMNS),
    # union-aware add-only guard: starter keys count as already-existing (serve seeds them)
    'seed_keys': ENTITY_VOCAB_SEED_KEYS,
}
SPECS = {'donor': DONOR_SPEC, 'committee': COMMITTEE_SPEC,
         'industry_vocab': INDUSTRY_VOCAB_SPEC, 'flag_vocab': FLAG_VOCAB_SPEC,
         'entity_vocab': ENTITY_VOCAB_SPEC}


# ============================================================
# PLAN  (compose once via compose.py; column-map driven; per-cell guard)
# ============================================================
def _candidate_cols(item: dict, spec: dict) -> list:
    """Columns an UPDATE may write: the ones the curator edited, plus the stamp
    column if the surface has one. Everything else is left at its live value."""
    ed = set(item.get('edited') or [])
    stamp = spec.get('stamp_col')
    return [c for c in spec['columns']
            if c != spec['key'] and (c == stamp or c in ed)]


def _rec(item, spec, status, fresh, san, cells=None, changed=None, reason=''):
    return {'id': spec['key_of'](item), 'kind': spec['kind'], 'status': status, 'before': fresh,
            'cells': cells or {}, 'changed': changed if changed is not None else {},
            'warn': san['warn'], 'hold': san['hold'], 'reason': reason}


def build_plan(batch: list, live: dict, spec: dict = DONOR_SPEC) -> dict:
    """Compose each staged item once (compose.py), classify NEW/UPDATE against the
    fresh `live` read, compute minimal changed cells, apply the per-cell
    concurrent-edit guard, surface sanitization, and gate on the round-trip.

    batch item: {<key>, ...staged fields..., edited[], snapshot:{col:cell}|None}
    (snapshot = live row captured when the curator staged; None if absent then).
    Generic over `spec` — DONOR_SPEC or COMMITTEE_SPEC.
    """
    writable, held, rt_items = [], [], []
    for item in batch:
        k = spec['key_of'](item)
        san = spec['sanitize'](item)
        fresh = live.get(k)
        snap = item.get('snapshot')

        # sanitization HOLD (donor source_url with ;/|) — never silently clean
        if san['hold']:
            held.append(_rec(item, spec, 'HELD', fresh, san,
                             reason='source_url contains ; or | — edit the URL before writing'))
            continue

        # collision guard (vocab is ADD-only): an existing key blocks — never a
        # silent upsert; an "update" to a vocab row would be a rename/recolor (out
        # of scope). This is also H5's idempotency: re-adding the same key is held.
        if spec.get('add_only') and fresh is not None:
            held.append(_rec(item, spec, 'COLLISION', fresh, san,
                             reason=f"'{k}' already exists — use it, or pick a different label"))
            continue

        merged = spec['merge'](item, fresh)
        composed = spec['compose'](merged)

        if fresh is None:
            rt_items.append(merged)
            writable.append(_rec(item, spec, 'NEW', None, san, cells=composed,
                                 changed=dict(composed)))
            continue

        # fresh read found the row -> UPDATE (also reclassifies a staged-NEW whose
        # row has since appeared, so a double-run can't append a duplicate)
        changed, conflicts = {}, []
        for col in _candidate_cols(item, spec):
            T = composed.get(col, '')
            F = fresh.get(col, '')
            S = None if snap is None else snap.get(col, '')
            if F == T:
                continue                     # already our target (incl. our own prior write)
            if S is not None and F == S:
                changed[col] = T             # untouched since staging -> safe to write
            else:
                conflicts.append(col)        # changed under us (or no baseline) -> conflict
        if conflicts:
            held.append(_rec(item, spec, 'CONFLICT', fresh, san, changed={}, cells=composed,
                             reason='cell(s) changed in the Sheet since you loaded them: '
                                    + ', '.join(conflicts)))
            continue
        rt_items.append(merged)
        writable.append(_rec(item, spec, 'UPDATE', fresh, san, cells=composed, changed=changed))

    rt = spec['roundtrip'](rt_items)
    mism = [r for r in rt if not r['match']]
    return {
        'writable': writable, 'held': held, 'kind': spec['kind'],
        'round_trip': {'rows': len(rt_items), 'mismatches': len(mism),
                       'failed': [r['id'] for r in mism]},
        'blocked': len(mism) > 0,
    }


# ============================================================
# EXECUTE  (the only mutation; writes solely to spec['tab'])
# ============================================================
def execute_plan(sheet, plan: dict, spec: dict = DONOR_SPEC) -> list:
    """NEW -> append a full row; UPDATE -> write ONLY the changed cells (RAW).
    Never writes held/conflict rows. Generic over `spec`."""
    if plan.get('blocked'):
        raise RuntimeError(f"batch blocked: round-trip mismatches {plan['round_trip']['failed']}")
    from gspread.utils import rowcol_to_a1
    ws = sheet.worksheet(spec['tab'])
    header = ws.row_values(1)
    colidx = {name: i + 1 for i, name in enumerate(header) if name}
    rowof = {}
    for i, v in enumerate(ws.col_values(colidx[spec['key']])):
        if i and v:                          # skip header (row 1)
            rowof.setdefault(str(v).strip(), i + 1)

    results = []
    for rec in plan['writable']:
        k = rec['id']
        if rec['status'] == 'NEW' and k not in rowof:
            row = [rec['cells'].get(c, '') for c in header]
            ws.append_row(row, value_input_option='RAW')
            results.append({'id': k, 'action': 'appended'})
        else:
            r = rowof.get(k)
            if not r:
                results.append({'id': k, 'action': 'skipped-missing'})
                continue
            data = [{'range': rowcol_to_a1(r, colidx[col]), 'values': [[val]]}
                    for col, val in rec['changed'].items() if col in colidx]
            if data:
                ws.batch_update(data, value_input_option='RAW')
            results.append({'id': k, 'action': 'updated' if data else 'no-change',
                            'cells': list(rec['changed'].keys())})
    return results


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet-id', default=DEFAULT_SHEET_ID)
    ap.add_argument('--creds-file', default=str(DEFAULT_CREDS))
    ap.add_argument('--check-access', action='store_true',
                    help='Stage-1 probe: confirm the SA-Editor share resolved (no-op write).')
    ap.add_argument('--batch', help='Path to a staged-batch JSON (list of items).')
    ap.add_argument('--kind', choices=['donor', 'committee'], default='donor',
                    help='Which surface the batch targets (default: donor).')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--dry-run', action='store_true', help='Plan only — re-reads live, writes nothing (default).')
    g.add_argument('--confirm', action='store_true', help='Perform the live write.')
    args = ap.parse_args()

    if args.check_access:
        sheet = open_sheet_rw(args.sheet_id, args.creds_file)
        print(json.dumps(confirm_write_access(sheet)))
        sys.exit(0)

    if args.batch:
        batch = json.load(open(args.batch))
        spec = SPECS[args.kind]
        sheet = open_sheet_rw(args.sheet_id, args.creds_file)
        live = read_live_rows(sheet, spec)          # fresh read immediately before plan/write
        plan = build_plan(batch, live, spec)
        summary = {'kind': spec['kind'], 'writable': len(plan['writable']),
                   'held': len(plan['held']), 'round_trip': plan['round_trip'],
                   'blocked': plan['blocked']}
        if args.confirm and not plan['blocked']:
            results = execute_plan(sheet, plan, spec)
            print(json.dumps({'mode': 'LIVE-WRITE', 'summary': summary, 'results': results}))
        else:
            print(json.dumps({'mode': 'DRY-RUN', 'summary': summary, 'plan': plan}))
