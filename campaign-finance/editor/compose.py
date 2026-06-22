#!/usr/bin/env python3
"""
Editor row composer + parser round-trip proof (H2)
===================================================
Composes the EXACT 'Donor Overrides' / 'Committee Tags' cell strings that the
editor would stage for writing, and proves they reconstruct the intended
classification when read back through sync_overrides' own parsers.

This is the canonical composer the H3 write harness will reuse, and the proof H3
rests on: a row is only safe to write if, fed through the live reader, it parses
back to exactly what the editor intended. The browser UI (index.html) mirrors
these two compose functions; a parity check confirms the UI emits identical cells.

READ ONLY: imports only the PURE parsers from sync_overrides (parse_list_cell,
parse_flag_cell, read_donor_overrides, read_committee_tags). gspread is lazy-
loaded inside sync_overrides.open_sheet only, so importing the parsers needs no
gspread and touches no Sheet. There is no write path in this module.

    python compose.py            # run the built-in round-trip self-test
"""
from __future__ import annotations
import sys
from pathlib import Path

# Pure parsers live in sheets-sync/sync_overrides.py — import them, don't copy.
SHEETS = Path(__file__).resolve().parent.parent / 'sheets-sync'
sys.path.insert(0, str(SHEETS))
import re                                          # noqa: E402
from sync_overrides import (                       # noqa: E402 (path set above)
    parse_list_cell,
    parse_flag_cell,
    read_donor_overrides,
    read_committee_tags,
    read_vocab,
)

# Stamp distinct from ingest's 'auto-suggest', so a human-applied classification
# is attributable in the Sheet's last_edited_by column.
EDITOR_STAMP = 'editor-ui'

# Sheet column orders (must match sync_overrides' documented schema / live tabs).
DONOR_COLUMNS = ['donor_id', 'primary_industry', 'additional_industries',
                 'flags', 'notes', 'last_edited_by']
COMMITTEE_COLUMNS = ['committee_id', 'committee_name', 'industry_tags']
INDUSTRY_VOCAB_COLUMNS = ['key', 'label', 'color']
FLAG_VOCAB_COLUMNS = ['key', 'label', 'severity']


def slug(label: str) -> str:
    """Vocab key from a label — the SAME normalization ingest.py.slug uses
    (lowercase, non-alphanumeric runs -> '-', trimmed), so a key composed here
    matches the rest of the vocab (e.g. 'Real Estate' -> 'real-estate')."""
    return re.sub(r'[^a-z0-9]+', '-', (label or '').lower()).strip('-')


# ============================================================
# COMPOSE  (staged item -> exact Sheet cells)
# ============================================================
def _clean_seg(s: str) -> str:
    """A flag cell is delimited by ';' (between flags) and '|' (between a flag's
    type/url/note). sync_overrides.parse_flag_cell has NO escaping, so those two
    characters cannot appear inside a segment without corrupting the row. Strip
    them so the composed cell always round-trips. (The free-text `notes` COLUMN is
    parsed whole and is unaffected — put semicolon-bearing prose there.)"""
    return (s or '').replace(';', ' ').replace('|', ' ').strip()


def _flag_cell_one(f: dict) -> str:
    """Encode one flag as 'type|url|note', dropping trailing empty segments so it
    round-trips through parse_flag_cell (which splits ';' then '|')."""
    t = _clean_seg(f.get('type') or '')
    u = _clean_seg(f.get('source_url') or '')
    n = _clean_seg(f.get('note') or '')
    if n:
        return f'{t}|{u}|{n}'
    if u:
        return f'{t}|{u}'
    return t


def compose_donor_cells(item: dict) -> dict:
    """staged donor item -> {column: cell string} for the Donor Overrides tab."""
    addl = [a.strip() for a in (item.get('additional_industries') or []) if a and a.strip()]
    flags = [_flag_cell_one(f) for f in (item.get('flags') or []) if (f.get('type') or '').strip()]
    return {
        'donor_id': item['donor_id'],
        'primary_industry': (item.get('primary_industry') or '').strip(),
        'additional_industries': ','.join(addl),
        'flags': ';'.join(flags),
        'notes': (item.get('notes') or '').strip(),
        'last_edited_by': EDITOR_STAMP,
    }


def compose_committee_cells(item: dict) -> dict:
    """staged committee item -> {column: cell string} for the Committee Tags tab."""
    tags = [t.strip() for t in (item.get('industry_tags') or []) if t and t.strip()]
    return {
        'committee_id': item['committee_id'],
        'committee_name': item.get('committee_name', '') or '',
        'industry_tags': ','.join(tags),
    }


# ============================================================
# EXPECTED  (what the live reader SHOULD produce for an item)
# ============================================================
def expected_donor_override(item: dict) -> dict:
    """The override dict read_donor_overrides should yield for this item — the
    'editor's intended classification' the round-trip must reproduce."""
    o = {}
    primary = (item.get('primary_industry') or '').strip()
    if primary:
        o['primary_industry'] = primary
    addl = [a.strip() for a in (item.get('additional_industries') or []) if a and a.strip()]
    if addl:
        o['additional_industries'] = addl
    flags = []
    for f in (item.get('flags') or []):
        t = _clean_seg(f.get('type') or '')
        if not t:
            continue
        fl = {'type': t, 'source': 'override'}
        if _clean_seg(f.get('source_url') or ''):
            fl['source_url'] = _clean_seg(f['source_url'])
        if _clean_seg(f.get('note') or ''):
            fl['note'] = _clean_seg(f['note'])
        flags.append(fl)
    if flags:
        o['flags'] = flags
    notes = (item.get('notes') or '').strip()
    if notes:
        o['notes'] = notes
    o['last_edited_by'] = EDITOR_STAMP
    return o


def expected_committee_tags(item: dict) -> list:
    return [t.strip() for t in (item.get('industry_tags') or []) if t and t.strip()]


def sanitization_notes(item: dict) -> dict:
    """Report where _clean_seg would alter a flag field (a ';' or '|' in a segment).

    type/note changes are WARN — sanitized but still writable ("typed X → stored Y").
    A source_url change is HOLD — a sanitized URL is wrong, so the row is held out of
    the writable batch until the curator fixes it (not silently cleaned).
    Returns {'warn':[{flag_index,field,typed,stored}], 'hold':[…]}.
    """
    warn, hold = [], []
    for i, f in enumerate(item.get('flags') or []):
        for field in ('type', 'source_url', 'note'):
            typed = (f.get(field) or '')
            stored = _clean_seg(typed)
            if typed.strip() != stored:
                rec = {'flag_index': i, 'field': field, 'typed': typed, 'stored': stored}
                (hold if field == 'source_url' else warn).append(rec)
    return {'warn': warn, 'hold': hold}


# ============================================================
# VOCAB-ADD  (Industry Tags / Flag Types — ADD only, key from label)
# ============================================================
def compose_vocab_cells(item: dict, columns: list) -> dict:
    """staged vocab item -> {column: cell}. key is slugified from the label; the
    other columns (color / severity) are taken verbatim. Flat — no encoding."""
    out = {}
    for c in columns:
        out[c] = slug(item.get('label', '')) if c == 'key' else (item.get(c) or '').strip()
    return out


def expected_vocab_entry(item: dict, columns: list) -> dict:
    """What read_vocab(..., 'key') should yield for this item: the non-key columns
    with non-empty values (read_vocab drops blanks)."""
    cells = compose_vocab_cells(item, columns)
    return {c: cells[c] for c in columns if c != 'key' and cells[c] != ''}


def roundtrip_vocab(items: list, tab: str, columns: list, key_field: str = 'key') -> list:
    """Compose each vocab row and read it back through sync_overrides.read_vocab —
    the same reader the sync uses — asserting it parses to the intended entry."""
    rows = [compose_vocab_cells(it, columns) for it in items]
    parsed = read_vocab(_FakeSheet({tab: rows}), tab, key_field)
    out = []
    for it, cells in zip(items, rows):
        got = parsed.get(cells['key'])
        exp = expected_vocab_entry(it, columns)
        out.append({'id': cells['key'], 'cells': cells, 'match': got == exp,
                    'got': got, 'expected': exp})
    return out


# ============================================================
# ROUND-TRIP  (compose -> live reader -> compare to intended)
# ============================================================
class _FakeSheet:
    """Minimal stand-in for a gspread Spreadsheet so the REAL read_* functions can
    parse our composed rows with zero Sheet/network access."""
    def __init__(self, tabs: dict):
        self._tabs = tabs

    def worksheet(self, name):
        if name not in self._tabs:
            raise _WorksheetNotFound(name)
        return _FakeWS(self._tabs[name])


class _WorksheetNotFound(Exception):
    pass


class _FakeWS:
    def __init__(self, records):
        self._records = records

    def get_all_records(self):
        return self._records


def roundtrip_donors(items: list[dict]) -> list[dict]:
    """Compose each donor item, read it back through read_donor_overrides, and
    compare to the intended override. Returns one result dict per item with a
    'match' bool and the composed cells (for diff display / debugging)."""
    rows = [compose_donor_cells(it) for it in items]
    parsed = read_donor_overrides(_FakeSheet({'Donor Overrides': rows}))
    out = []
    for it, cells in zip(items, rows):
        got = parsed.get(cells['donor_id'])
        exp = expected_donor_override(it)
        # belt-and-suspenders: the cells also parse standalone via the pure helpers
        addl_ok = parse_list_cell(cells['additional_industries']) == exp.get('additional_industries', [])
        flags_ok = parse_flag_cell(cells['flags']) == exp.get('flags', [])
        out.append({
            'id': cells['donor_id'], 'cells': cells,
            'match': got == exp and addl_ok and flags_ok,
            'got': got, 'expected': exp,
        })
    return out


def roundtrip_committees(items: list[dict]) -> list[dict]:
    rows = [compose_committee_cells(it) for it in items]
    parsed = read_committee_tags(_FakeSheet({'Committee Tags': rows}))
    out = []
    for it, cells in zip(items, rows):
        got = parsed.get(cells['committee_id'], [])
        exp = expected_committee_tags(it)
        direct_ok = parse_list_cell(cells['industry_tags']) == exp
        out.append({
            'id': cells['committee_id'], 'cells': cells,
            'match': got == exp and direct_ok,
            'got': got, 'expected': exp,
        })
    return out


# ============================================================
# SELF-TEST
# ============================================================
def _selftest():
    donors = [
        {'kind': 'donor', 'donor_id': 'acme-realty', 'primary_industry': 'real-estate'},
        {'kind': 'donor', 'donor_id': 'big-law-llp', 'primary_industry': 'legal',
         'additional_industries': ['finance'],
         'flags': [{'type': 'lobbyist', 'source_url': 'https://example.org/x',
                    'note': 'registered 2024'}],
         'notes': 'paused, pending research'},
        {'kind': 'donor', 'donor_id': 'union-local', 'primary_industry': 'labor-trades',
         'additional_industries': ['progressive-pol', 'labor-public'],
         'flags': [{'type': 'self-funded'}, {'type': 'dark-money', 'note': 'no url'}]},
    ]
    committees = [
        {'kind': 'committee', 'committee_id': 'cmte-1', 'committee_name': 'Friends of X',
         'industry_tags': ['real-estate', 'finance']},
        {'kind': 'committee', 'committee_id': 'cmte-2', 'committee_name': 'Y PAC',
         'industry_tags': ['labor-trades']},
    ]
    dres = roundtrip_donors(donors)
    cres = roundtrip_committees(committees)
    n = len(dres) + len(cres)
    bad = [r for r in dres + cres if not r['match']]
    print(f"round-trip self-test: {n} rows, {len(bad)} mismatches")
    for r in dres + cres:
        print(f"  [{'ok' if r['match'] else 'FAIL'}] {r['id']:14s} "
              f"flags={r['cells'].get('flags','')!r} addl={r['cells'].get('additional_industries', r['cells'].get('industry_tags',''))!r}")
    for r in bad:
        print(f"  MISMATCH {r['id']}: got={r['got']} expected={r['expected']}")
    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(_selftest())
