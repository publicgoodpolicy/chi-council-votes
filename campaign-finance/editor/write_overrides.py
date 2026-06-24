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
import re
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


# ============================================================
# CLUSTER WRITE PATH  (HALT-3a) — multi-row, NOT the single-key kind-spec machinery.
# Donor Clusters is N rows per cluster sharing a cluster_id; build_plan/execute_plan
# are single-row upserts keyed on one column and CANNOT model it. This is a dedicated
# create-only writer: mint a fresh id, validate the write contract, append N member
# rows. Non-destructive (append only; never rewrites/deletes existing rows or touches
# any other tab). The total is recomputed per-file by apply_clusters at build time —
# NO dollar column is ever written here (contract item 5).
# ============================================================
CLUSTER_TAB = 'Donor Clusters'
CLUSTER_COLUMNS = ['cluster_id', 'cluster_name', 'canonical_id',
                   'donor_id', 'role', 'relationship']
CLUSTER_ID_RE = re.compile(r'^rollup-ed-(\d+)$')   # shape-strict editor namespace
# VALID_ROLES mirrors sync_overrides (single source of the role vocabulary).
CLUSTER_VALID_ROLES = {'parent', 'alt-name', 'affiliated-pac', 'subsidiary', 'related'}
DEFAULT_RELATIONSHIP = 'affiliated entities'

# B4 — entity_type read-only structural guard: the cluster writer targets a tab with
# NO entity_type column, so it structurally cannot write entity_type. Assert it so a
# future schema change can't silently let clustering stamp entity_type.
assert 'entity_type' not in CLUSTER_COLUMNS, 'cluster writer must never touch entity_type'


def read_cluster_ids(sheet) -> list:
    """Fresh read of every existing cluster_id (the concurrent-edit guard's basis)."""
    ws = sheet.worksheet(CLUSTER_TAB)
    return [str(r.get('cluster_id') or '').strip()
            for r in ws.get_all_records() if str(r.get('cluster_id') or '').strip()]


def read_clusters(sheet) -> list:
    """READ-ONLY: every existing cluster as grouped membership, so the editor's Cluster
    tab can SEE what is already clustered and refuse to mint a duplicate (FIX-3a-2). Same
    get_all_records() read as read_cluster_ids — NO write verb. Covers BOTH the build's
    rollup-NNN block and the editor's rollup-ed-NNN namespace (no id filtering). Returns
    [{cluster_id, cluster_name, canonical_id, members:[{donor_id, role, relationship}]}],
    in first-seen order."""
    ws = sheet.worksheet(CLUSTER_TAB)
    groups, order = {}, []
    for r in ws.get_all_records():
        cid = str(r.get('cluster_id') or '').strip()
        did = str(r.get('donor_id') or '').strip()
        if not cid or not did:
            continue
        g = groups.get(cid)
        if g is None:
            g = groups[cid] = {'cluster_id': cid,
                               'cluster_name': str(r.get('cluster_name') or '').strip(),
                               'canonical_id': str(r.get('canonical_id') or '').strip(),
                               'members': []}
            order.append(cid)
        elif not g['cluster_name'] and r.get('cluster_name'):
            g['cluster_name'] = str(r.get('cluster_name')).strip()
        g['members'].append({'donor_id': did,
                             'role': str(r.get('role') or '').strip(),
                             'relationship': str(r.get('relationship') or '').strip()})
    return [groups[c] for c in order]


def mint_cluster_id(existing_ids) -> str:
    """Next id in the editor namespace: rollup-ed-NNN, floor 001. Shape-strict scan —
    only rollup-ed-<digits> contributes to the max; any other id (incl. the build's
    rollup-NNN block) is ignored, so editor and build namespaces never collide."""
    mx = 0
    for c in existing_ids:
        m = CLUSTER_ID_RE.match(str(c))
        if m:
            mx = max(mx, int(m.group(1)))
    return 'rollup-ed-%03d' % (mx + 1)


def build_cluster_plan(item: dict, existing_ids) -> dict:
    """Validate one cluster item against the write contract (1-6), mint a fresh id,
    and compose the N member rows. Returns {cluster_id, rows, members, parent, errors,
    contract, blocked}. Pure/Sheet-free except for the supplied existing_ids."""
    errors = []
    name = (item.get('cluster_name') or '').strip()
    # dedupe members, preserve order
    seen, members = set(), []
    for m in (item.get('members') or []):
        m = (m or '').strip()
        if m and m not in seen:
            seen.add(m); members.append(m)
    parent = (item.get('parent_id') or '').strip()
    rel = (item.get('relationship') or DEFAULT_RELATIONSHIP).strip() or DEFAULT_RELATIONSHIP
    roles_in = item.get('roles') or {}

    if not name:
        errors.append('cluster_name is required')
    if len(members) < 2:
        errors.append('a cluster needs >= 2 distinct members')
    if parent and parent not in members:
        errors.append('parent must be one of the selected members')
    if not parent and members:
        parent = members[0]

    existing = set(str(c) for c in existing_ids)
    cid = mint_cluster_id(existing_ids)
    if cid in existing:                       # fresh-read collision guard (belt-and-suspenders)
        errors.append(f'cluster_id collision: {cid} already exists')

    rows, nparent = [], 0
    for m in members:
        role = 'parent' if m == parent else (roles_in.get(m) or 'related')
        if role not in CLUSTER_VALID_ROLES:
            role = 'related'
        if role == 'parent':
            nparent += 1
        rows.append({'cluster_id': cid, 'cluster_name': name, 'canonical_id': parent,
                     'donor_id': m, 'role': role, 'relationship': rel})
    if nparent != 1:
        errors.append(f'exactly one parent row required (got {nparent})')

    contract = {
        '1_shared_cluster_id': len({r['cluster_id'] for r in rows}) == 1 if rows else False,
        '2_consistent_canonical': len({r['canonical_id'] for r in rows}) == 1 if rows else False,
        '3_exactly_one_parent': nparent == 1,
        '4_cluster_name_present': bool(name),
        # structural no-dollar guard: every row key is a contract column (none is a $ field)
        '5_no_dollar_column': all(set(r) <= set(CLUSTER_COLUMNS) for r in rows),
        '6_min_two_members': len(members) >= 2,
    }
    blocked = bool(errors) or not all(contract.values())
    return {'cluster_id': cid, 'rows': rows, 'members': members, 'parent': parent,
            'relationship': rel, 'errors': errors, 'contract': contract, 'blocked': blocked}


def execute_cluster_plan(sheet, plan: dict) -> dict:
    """Append the cluster's member rows (RAW), in the live header's column order.
    Append-only: existing rows and all other tabs are never touched. Refuses a blocked
    plan. B4: asserts no row carries an entity_type cell before writing."""
    if plan.get('blocked'):
        raise RuntimeError('cluster blocked: ' + '; '.join(plan.get('errors') or ['contract failed']))
    for r in plan['rows']:                     # B4 runtime guard
        assert 'entity_type' not in r, 'cluster row must never carry entity_type'
    ws = sheet.worksheet(CLUSTER_TAB)
    header = ws.row_values(1)
    body = [[r.get(c, '') for c in header] for r in plan['rows']]
    ws.append_rows(body, value_input_option='RAW')
    return {'cluster_id': plan['cluster_id'], 'appended': len(body),
            'rows': len(plan['rows'])}


# ============================================================
# CLUSTER EDIT  (HALT-EDIT-1) — modify an EXISTING cluster's rows under its existing
# cluster_id (NOT a fresh mint). The INVERSE of the create guard: the id must be
# PRESENT. One writer, four ops (add_member / remove_member / change_role / rename);
# the future MERGE tool composes these same primitives in bulk. Parent-integrity is
# ENFORCED: every op must leave EXACTLY ONE parent (never zero, never two). Touches
# ONLY Donor Clusters rows — never contributions, never entity_type.
# ============================================================
CLUSTER_EDIT_OPS = {'add_member', 'remove_member', 'change_role', 'rename', 'delete_cluster'}
_NONPARENT_ROLES = CLUSTER_VALID_ROLES - {'parent'}


def _cluster_state(cluster: dict):
    """From a grouped cluster {cluster_name, canonical_id, members:[{donor_id,role,
    relationship}]}, derive (members[ordered], roles{}, parent, name, relationship).
    Parent = the role=='parent' member, falling back to canonical_id."""
    members = [m['donor_id'] for m in cluster['members']]
    roles = {m['donor_id']: ((m.get('role') or '').strip().lower() or 'related')
             for m in cluster['members']}
    name = (cluster.get('cluster_name') or '').strip()
    canon = (cluster.get('canonical_id') or '').strip()
    parent = next((d for d in members if roles.get(d) == 'parent'), '') or canon
    rel = ((cluster['members'][0].get('relationship') if cluster['members'] else '')
           or DEFAULT_RELATIONSHIP)
    return members, roles, parent, name, rel


def build_cluster_edit_plan(op_item: dict, cluster, all_by_donor=None) -> dict:
    """Plan ONE edit op against an EXISTING cluster (grouped, from read_clusters).
    Pure / Sheet-free. Returns {op, cluster_id, ops:[row-ops], resulting{members,roles,
    parent,name}, parent_integrity, errors, blocked}. ENFORCES exactly-one-parent and
    >=2 members; blocks (does not warn) on violation."""
    op = (op_item.get('op') or '').strip()
    cid = (op_item.get('cluster_id') or '').strip()
    if op not in CLUSTER_EDIT_OPS:
        return {'op': op, 'cluster_id': cid, 'ops': [], 'errors': [f'unknown op: {op!r}'], 'blocked': True}
    if not cluster:
        return {'op': op, 'cluster_id': cid, 'ops': [],
                'errors': [f'cluster {cid!r} not found — edit requires an existing cluster'], 'blocked': True}

    members, roles, parent, name, rel = _cluster_state(cluster)

    # delete_cluster removes the WHOLE cluster. The parent-integrity guard below exists for
    # clusters that CONTINUE to exist (a survivor must have exactly one parent) — a deleted
    # cluster is gone, not parentless. So this RETURNS EARLY, bypassing that guard, and emits a
    # single scope:'all' delete of every row matching cluster_id. Members revert to unclustered
    # on the next build (apply_clusters no longer sees them). Contributions are never touched.
    if op == 'delete_cluster':
        return {'op': op, 'cluster_id': cid, 'cluster_name': name, 'relationship': rel,
                'ops': [{'action': 'delete', 'scope': 'all'}],
                'resulting': {'members': [], 'roles': {}, 'parent': '', 'name': name},
                'deleted_members': list(members),
                'parent_integrity': {'whole_cluster_delete': True, 'exactly_one_parent': None,
                                     'note': 'whole-cluster delete — zero parents is the intended end state'},
                'errors': [], 'blocked': False}

    r_members, r_roles, r_parent, r_name = list(members), dict(roles), parent, name
    ops, errors = [], []

    if op == 'rename':
        new = (op_item.get('cluster_name') or '').strip()
        if not new:
            errors.append('cluster_name is required')
        else:
            r_name = new
            ops.append({'action': 'update', 'field': 'cluster_name', 'to': new, 'scope': 'all'})

    elif op == 'add_member':
        did = (op_item.get('donor_id') or '').strip()
        role = (op_item.get('role') or 'related').strip().lower()
        if role not in _NONPARENT_ROLES:
            role = 'related'                                   # add never sets the parent
        if not did:
            errors.append('donor_id is required')
        elif did in members:
            errors.append(f'{did} is already in this cluster')
        else:
            other = (all_by_donor or {}).get(did)
            if other and other.get('cluster_id') != cid:
                errors.append(f'{did} is already in cluster {other.get("cluster_id")} '
                              f'({other.get("cluster_name", "")}) — combine via merge, not a second cluster')
            else:
                r_members.append(did); r_roles[did] = role
                ops.append({'action': 'append', 'donor_id': did, 'role': role})

    elif op == 'remove_member':
        did = (op_item.get('donor_id') or '').strip()
        nominate = (op_item.get('nominate_parent') or '').strip()
        if did not in members:
            errors.append(f'{did} is not in this cluster')
        elif len(members) - 1 < 2:
            errors.append('a cluster needs >= 2 members; removing this would leave <2 — '
                          'delete the whole cluster instead (a separate, future op)')
        else:
            r_members = [m for m in r_members if m != did]; r_roles.pop(did, None)
            ops.append({'action': 'delete', 'donor_id': did})
            if did == parent:                                  # removing the parent -> must nominate
                if not nominate:
                    errors.append('removing the parent requires nominating a replacement parent')
                elif nominate not in r_members:
                    errors.append(f'nominated parent {nominate!r} is not a remaining member')
                else:
                    r_parent = nominate; r_roles[nominate] = 'parent'
                    ops.append({'action': 'update', 'field': 'role', 'donor_id': nominate, 'to': 'parent'})
                    ops.append({'action': 'update', 'field': 'canonical_id', 'to': nominate, 'scope': 'all'})

    elif op == 'change_role':
        did = (op_item.get('donor_id') or '').strip()
        role = (op_item.get('role') or '').strip().lower()
        demote = (op_item.get('demote_role') or 'alt-name').strip().lower()
        if demote not in _NONPARENT_ROLES:
            demote = 'alt-name'
        if did not in members:
            errors.append(f'{did} is not in this cluster')
        elif role not in CLUSTER_VALID_ROLES:
            errors.append(f'invalid role: {role!r}')
        elif role == 'parent':
            if did != parent:                                  # promote: demote the old parent in the same op
                r_roles[parent] = demote; r_roles[did] = 'parent'; r_parent = did
                ops.append({'action': 'update', 'field': 'role', 'donor_id': parent, 'to': demote})
                ops.append({'action': 'update', 'field': 'role', 'donor_id': did, 'to': 'parent'})
                ops.append({'action': 'update', 'field': 'canonical_id', 'to': did, 'scope': 'all'})
        elif did == parent:
            errors.append('cannot demote the parent directly — promote another member to parent '
                          '(that demotes this one in the same op)')
        else:
            r_roles[did] = role
            ops.append({'action': 'update', 'field': 'role', 'donor_id': did, 'to': role})

    # PARENT-INTEGRITY (enforced): exactly one parent, >= 2 members in the result.
    nparent = sum(1 for m in r_members if r_roles.get(m) == 'parent')
    integ = {'old_parent': parent, 'new_parent': r_parent, 'parent_count': nparent,
             'exactly_one_parent': nparent == 1, 'canonical_rewritten': r_parent != parent,
             'demoted_to': (r_roles.get(parent) if r_parent != parent else None)}
    if nparent != 1:
        errors.append(f'parent-integrity violated: result has {nparent} parents (must be exactly 1)')
    if len(r_members) < 2:
        errors.append('parent-integrity: result has < 2 members')

    return {'op': op, 'cluster_id': cid, 'cluster_name': r_name, 'relationship': rel, 'ops': ops,
            'resulting': {'members': r_members, 'roles': r_roles, 'parent': r_parent, 'name': r_name},
            'parent_integrity': integ, 'errors': errors, 'blocked': bool(errors)}


def execute_cluster_edit_plan(sheet, plan: dict) -> dict:
    """Apply the planned row ops to the EXISTING cluster, addressing rows by the
    (cluster_id, donor_id) KEY from a FRESH read — never a cached index. Order: appends
    (to the end, no shift) -> cell updates (by row number) -> deletes (descending, so
    numbers stay valid). Refuses a blocked plan. B4: the tab has no entity_type column."""
    if plan.get('blocked'):
        raise RuntimeError('cluster edit blocked: ' + '; '.join(plan.get('errors') or ['contract failed']))
    from gspread.utils import rowcol_to_a1
    cid = plan['cluster_id']
    ws = sheet.worksheet(CLUSTER_TAB)
    header = ws.row_values(1)
    colidx = {name: i + 1 for i, name in enumerate(header) if name}
    assert 'entity_type' not in colidx, 'cluster tab must never carry entity_type'   # B4
    records = ws.get_all_records()
    rownum, cid_rows, rel = {}, [], DEFAULT_RELATIONSHIP
    for i, r in enumerate(records):
        if str(r.get('cluster_id') or '').strip() == cid:
            n = i + 2                                          # +2: 1-based + header row
            cid_rows.append(n)
            rownum[str(r.get('donor_id') or '').strip()] = n
            if r.get('relationship'):
                rel = str(r.get('relationship')).strip()
    batch, deletes, appended = [], [], 0
    for o in plan['ops']:
        if o['action'] == 'append':
            row = {'cluster_id': cid, 'cluster_name': plan['resulting']['name'],
                   'canonical_id': plan['resulting']['parent'], 'donor_id': o['donor_id'],
                   'role': o['role'], 'relationship': rel}
            assert 'entity_type' not in row, 'cluster row must never carry entity_type'
            ws.append_row([row.get(c, '') for c in header], value_input_option='RAW')
            appended += 1
        elif o['action'] == 'update':
            if o.get('scope') == 'all':
                for n in cid_rows:
                    batch.append({'range': rowcol_to_a1(n, colidx[o['field']]), 'values': [[o['to']]]})
            else:
                n = rownum.get(o['donor_id'])
                if n:
                    batch.append({'range': rowcol_to_a1(n, colidx[o['field']]), 'values': [[o['to']]]})
        elif o['action'] == 'delete':
            if o.get('scope') == 'all':                        # whole-cluster delete: every row of this cluster_id
                deletes.extend(cid_rows)
            else:
                n = rownum.get(o['donor_id'])
                if n:
                    deletes.append(n)
    if batch:
        ws.batch_update(batch, value_input_option='RAW')
    deletes = sorted(set(deletes), reverse=True)               # descending so row numbers stay valid
    # B4: every row we delete belongs to the TARGET cluster_id (no other cluster touched).
    assert all(n in cid_rows for n in deletes), 'delete targeted a row outside the cluster'
    for n in deletes:
        ws.delete_rows(n)
    return {'cluster_id': cid, 'op': plan['op'], 'appended': appended,
            'updated': len(batch), 'deleted': len(deletes)}


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
