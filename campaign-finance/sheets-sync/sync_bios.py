#!/usr/bin/env python3
"""
IPG Alder Bios — Google Sheets Sync   (replaces the old sync_votes.py)
======================================================================
Reads ONLY the "Alder Bios" tab and rebuilds the alder roster in
council-data.json. Vote positions and vote definitions are NO LONGER managed
here — they come entirely from the roll-call pipeline (ingest_votes.py +
sync_allvotes.py / the "All Votes" tab). The old "Votes" and "Vote Metadata"
tabs are retired.

CRITICAL: this PRESERVES each alder's existing `votes` when rebuilding from
bios. The vote pipeline can be skipped on a given night (the Datasette host
blocks datacenter IPs), so we must not wipe positions just because bios synced.

"Alder Bios" columns:
    ward | name | first_elected | party | neighborhoods | bio
    | tenure_note | email | website | committees | photo_url

USAGE
    python sync_bios.py --sheet-id ABC123 --creds-file ./creds.json
    python sync_bios.py --dry-run

DEPENDENCIES
    pip install gspread google-auth
"""

from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path
from typing import Optional

SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
DEFAULT_DATA_PATH = Path(__file__).parent.parent / 'council-data.json'


def open_sheet(sheet_id: str, creds_file: Optional[str] = None):
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("Missing deps. Run: pip install gspread google-auth", file=sys.stderr)
        sys.exit(1)
    if creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    else:
        env = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set "
                             "GOOGLE_SHEETS_CREDENTIALS env var.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)
    import gspread
    return gspread.authorize(creds).open_by_key(sheet_id)


def read_alder_bios(sheet) -> dict:
    import gspread
    try:
        ws = sheet.worksheet('Alder Bios')
    except gspread.WorksheetNotFound:
        print("  ! No 'Alder Bios' tab found.")
        return {}
    out = {}
    for row in ws.get_all_records():
        try:
            ward = int(row.get('ward', 0))
        except (ValueError, TypeError):
            continue
        if not ward:
            continue
        fe = row.get('first_elected')
        try:
            first_elected = int(fe) if fe not in (None, '') else None
        except (ValueError, TypeError):
            first_elected = None
        out[ward] = {
            'ward': ward,
            'name': (row.get('name') or '').strip(),
            'firstElected': first_elected,
            'party': (row.get('party') or '').strip() or None,
            'neighborhoods': (row.get('neighborhoods') or '').strip() or None,
            'bio': (row.get('bio') or '').strip() or None,
            'tenureNote': (row.get('tenure_note') or '').strip() or None,
            'email': (row.get('email') or '').strip() or None,
            'website': (row.get('website') or '').strip() or None,
            'committees': (row.get('committees') or '').strip() or None,
            'photoUrl': (row.get('photo_url') or '').strip() or None,
        }
    return out


def merge_bios(data: dict, bios: dict) -> dict:
    """Rebuild alders from bios, PRESERVING each ward's existing votes."""
    changes = {'bios_updated': 0, 'votes_preserved': 0}
    if not bios:
        print("  No bios to merge.")
        return changes
    existing_votes = {}
    for a in data.get('alders', []):
        try:
            existing_votes[int(a.get('ward'))] = a.get('votes', {}) or {}
        except (TypeError, ValueError):
            pass
    new_alders = []
    for ward in sorted(bios):
        alder = dict(bios[ward])
        alder['votes'] = existing_votes.get(ward, {})   # preserve roll-call positions
        if alder['votes']:
            changes['votes_preserved'] += 1
        new_alders.append(alder)
        changes['bios_updated'] += 1
    data['alders'] = new_alders
    return changes


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet-id', default=os.environ.get('SHEET_ID'))
    ap.add_argument('--creds-file')
    ap.add_argument('--data-file', default=str(DEFAULT_DATA_PATH))
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()
    if not args.sheet_id:
        raise SystemExit("Missing --sheet-id (or SHEET_ID env var)")
    data_path = Path(args.data_file)
    if not data_path.exists():
        raise SystemExit(f"Data file not found: {data_path}")

    with open(data_path) as f:
        data = json.load(f)
    print(f"Existing: {len(data.get('alders', []))} alders")
    sheet = open_sheet(args.sheet_id, creds_file=args.creds_file)
    bios = read_alder_bios(sheet)
    print(f"  {len(bios)} alder bios")
    changes = merge_bios(data, bios)
    print(f"  {changes}")
    if args.dry_run:
        print("Dry run — not writing.")
        return
    with open(data_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {data_path}")


if __name__ == '__main__':
    main()
