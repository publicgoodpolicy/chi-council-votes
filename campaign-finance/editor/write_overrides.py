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
DONOR_COLUMNS = compose.DONOR_COLUMNS     # ['donor_id', ...,'last_edited_by'] — single source
KEY_COLUMN = 'donor_id'
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
# READ the live tab (write path's own fresh read)
# ============================================================
def read_live_donor_rows(sheet) -> dict:
    """Fresh {donor_id: {col: cell}} read of the Donor Overrides tab — used both for
    the dry-run NEW/UPDATE recompute and the concurrent-edit guard."""
    ws = sheet.worksheet(DONOR_TAB)
    rows = ws.get_all_records()
    cols = [c for c in DONOR_COLUMNS if c != KEY_COLUMN]
    out = {}
    for r in rows:
        did = str(r.get(KEY_COLUMN, '') or '').strip()
        if did:
            out[did] = {c: str(r.get(c, '') or '') for c in cols}
    return out


# ============================================================
# MERGE + PLAN  (compose once via compose.py; column-map driven)
# ============================================================
def _merged_item(item: dict, live_row) -> dict:
    """Staged edits over the live row: edited columns take staged values, the rest
    keep their live values (parsed). This is the intended final row state."""
    ed = set(item.get('edited') or [])
    base = {
        'primary_industry': (live_row or {}).get('primary_industry', ''),
        'additional_industries': compose.parse_list_cell((live_row or {}).get('additional_industries', '')),
        'flags': compose.parse_flag_cell((live_row or {}).get('flags', '')),
        'notes': (live_row or {}).get('notes', ''),
    }
    return {
        'donor_id': item['donor_id'],
        'primary_industry': item.get('primary_industry', '') if 'primary_industry' in ed else base['primary_industry'],
        'additional_industries': item.get('additional_industries', []) if 'additional_industries' in ed else base['additional_industries'],
        'flags': item.get('flags', []) if 'flags' in ed else base['flags'],
        'notes': item.get('notes', '') if 'notes' in ed else base['notes'],
    }


def _candidate_cols(item: dict) -> list:
    """Columns an UPDATE may write: the ones the curator edited, plus the stamp.
    Everything else is left at its live value (no clobber)."""
    ed = set(item.get('edited') or [])
    return [c for c in DONOR_COLUMNS
            if c != KEY_COLUMN and (c == 'last_edited_by' or c in ed)]


def build_plan(batch: list, live: dict) -> dict:
    """Compose each staged item once (compose.py), classify NEW/UPDATE against the
    fresh `live` read, compute minimal changed cells, apply the per-cell
    concurrent-edit guard, surface flag sanitization, and gate on the round-trip.

    batch item: {donor_id, primary_industry, additional_industries[], flags[],
                 notes, edited[], snapshot:{col:cell}|None}  (snapshot = live row
                 captured when the curator staged; None if it was absent then).
    """
    writable, held, rt_items = [], [], []
    for item in batch:
        did = item['donor_id']
        san = compose.sanitization_notes(item)
        fresh = live.get(did)
        snap = item.get('snapshot')

        # source_url with ;/|  -> HOLD (don't silently clean a URL)
        if san['hold']:
            held.append(_rec(item, 'HELD', fresh, san,
                             reason='source_url contains ; or | — edit the URL before writing'))
            continue

        merged = _merged_item(item, fresh)
        composed = compose.compose_donor_cells(merged)

        if fresh is None:
            # genuinely new (also covers the re-run case where our own append is gone — n/a)
            rt_items.append(merged)
            writable.append(_rec(item, 'NEW', None, san, cells=composed,
                                 changed=dict(composed)))
            continue

        # fresh read found the row -> UPDATE (this is also what reclassifies a
        # staged-NEW whose row has since appeared, so a double-run can't duplicate)
        changed, conflicts = {}, []
        for col in _candidate_cols(item):
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
            held.append(_rec(item, 'CONFLICT', fresh, san, changed={}, cells=composed,
                             reason='cell(s) changed in the Sheet since you loaded them: '
                                    + ', '.join(conflicts)))
            continue
        rt_items.append(merged)
        writable.append(_rec(item, 'UPDATE', fresh, san, cells=composed, changed=changed))

    rt = compose.roundtrip_donors(rt_items)
    mism = [r for r in rt if not r['match']]
    return {
        'writable': writable, 'held': held,
        'round_trip': {'rows': len(rt_items), 'mismatches': len(mism),
                       'failed': [r['id'] for r in mism]},
        'blocked': len(mism) > 0,
    }


def _rec(item, status, fresh, san, cells=None, changed=None, reason=''):
    return {'donor_id': item['donor_id'], 'status': status, 'before': fresh,
            'cells': cells or {}, 'changed': changed if changed is not None else {},
            'warn': san['warn'], 'hold': san['hold'], 'reason': reason}


# ============================================================
# EXECUTE  (the only mutation; Donor Overrides tab only)
# ============================================================
def execute_plan(sheet, plan: dict) -> dict:
    """NEW -> append a full row; UPDATE -> write ONLY the changed cells (RAW).
    Never writes held/conflict rows. Returns a per-row result."""
    if plan.get('blocked'):
        raise RuntimeError(f"batch blocked: round-trip mismatches {plan['round_trip']['failed']}")
    from gspread.utils import rowcol_to_a1
    ws = sheet.worksheet(DONOR_TAB)
    header = ws.row_values(1)
    colidx = {name: i + 1 for i, name in enumerate(header) if name}
    rowof = {}
    for i, v in enumerate(ws.col_values(colidx[KEY_COLUMN])):
        if i and v:                          # skip header (row 1)
            rowof.setdefault(str(v).strip(), i + 1)

    results = []
    for rec in plan['writable']:
        did = rec['donor_id']
        if rec['status'] == 'NEW' and did not in rowof:
            row = [rec['cells'].get(c, '') for c in header]
            ws.append_row(row, value_input_option='RAW')
            results.append({'donor_id': did, 'action': 'appended'})
        else:
            r = rowof.get(did)
            if not r:
                results.append({'donor_id': did, 'action': 'skipped-missing'})
                continue
            data = [{'range': rowcol_to_a1(r, colidx[col]), 'values': [[val]]}
                    for col, val in rec['changed'].items() if col in colidx]
            if data:
                ws.batch_update(data, value_input_option='RAW')
            results.append({'donor_id': did, 'action': 'updated' if data else 'no-change',
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
        sheet = open_sheet_rw(args.sheet_id, args.creds_file)
        live = read_live_donor_rows(sheet)          # fresh read immediately before plan/write
        plan = build_plan(batch, live)
        summary = {'writable': len(plan['writable']), 'held': len(plan['held']),
                   'round_trip': plan['round_trip'], 'blocked': plan['blocked']}
        if args.confirm and not plan['blocked']:
            results = execute_plan(sheet, plan)
            print(json.dumps({'mode': 'LIVE-WRITE', 'summary': summary, 'results': results}))
        else:
            print(json.dumps({'mode': 'DRY-RUN', 'summary': summary, 'plan': plan}))
