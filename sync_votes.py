#!/usr/bin/env python3
"""
IPG Votes & Alder Bios — Google Sheets Sync
============================================
Reads the IPG Council Sheet's three voting-related tabs and merges them into
council-data.json. Runs nightly via GitHub Actions alongside sync_overrides.py.

OVERVIEW
--------
This script reads three tabs:

  1. "Alder Bios" — one row per alder, columns:
       ward | name | first_elected | party | neighborhoods | bio
       | tenure_note | email | website | committees

  2. "Votes" — wide format, one row per alder, columns:
       ward | alder | <CODE_1> | <CODE_2> | ...
     The vote code columns are dynamic — whatever codes exist in the Vote
     Metadata tab will be read from here. Position values must be:
       "Affirmative", "Oppositional", "Neutral", or "-" (or blank for no data)

  3. "Vote Metadata" — one row per vote, columns:
       code | full_name | tag | year | reverse_coded | source_url | description

Adding a new vote = (1) add a column to the Votes tab with the new code as
the header, (2) add a row to Vote Metadata with the same code. The script
auto-discovers the columns.

USAGE
-----
    python sync_votes.py --sheet-id ABC123 --creds-file ./creds.json
    python sync_votes.py --dry-run         # report what would change

DEPENDENCIES
------------
    pip install gspread google-auth
"""

from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path
from typing import Optional

try:
    import gspread
    from google.oauth2.service_account import Credentials
except ImportError:
    print("Missing deps. Run: pip install gspread google-auth", file=sys.stderr)
    sys.exit(1)


SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly']
DEFAULT_DATA_PATH = Path(__file__).parent.parent / 'council-data.json'

# Valid vote position values
VALID_POSITIONS = {'Affirmative', 'Oppositional', 'Neutral', '-'}


# ============================================================
# AUTH / SHEET OPEN — shared pattern with sync_overrides.py
# ============================================================
def open_sheet(sheet_id: str, creds_file: Optional[str] = None):
    if creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    else:
        env = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set "
                             "GOOGLE_SHEETS_CREDENTIALS env var.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


# ============================================================
# SHEET PARSING
# ============================================================
def read_vote_metadata(sheet) -> list[dict]:
    """Read the Vote Metadata tab. Returns list of vote definition dicts."""
    try:
        ws = sheet.worksheet('Vote Metadata')
    except gspread.WorksheetNotFound:
        print("  ! No 'Vote Metadata' tab found, skipping votes sync.")
        return []
    rows = ws.get_all_records()
    out = []
    for row in rows:
        code = (row.get('code') or '').strip()
        if not code:
            continue
        # Coerce reverse_coded to bool. Sheets returns "TRUE"/"FALSE" as strings.
        rc = row.get('reverse_coded')
        if isinstance(rc, bool):
            reverse = rc
        elif isinstance(rc, str):
            reverse = rc.strip().lower() in ('true', '1', 'yes', 'y')
        else:
            reverse = bool(rc)
        out.append({
            'code': code,
            'full': (row.get('full_name') or '').strip(),
            'tag': (row.get('tag') or '').strip(),
            'year': str(row.get('year') or '').strip(),
            'reverse_coded': reverse,
            'source_url': (row.get('source_url') or '').strip() or None,
            'desc': (row.get('description') or '').strip(),
        })
    return out


def read_votes(sheet, vote_codes: list[str]) -> dict[int, dict]:
    """Read the Votes tab into a {ward: {code: position}} dict.

    Only columns whose header matches a code in vote_codes are read — extra
    columns in the sheet are ignored. Missing codes for an alder become '-'.
    """
    try:
        ws = sheet.worksheet('Votes')
    except gspread.WorksheetNotFound:
        print("  ! No 'Votes' tab found, skipping votes sync.")
        return {}
    rows = ws.get_all_records()
    out = {}
    for row in rows:
        try:
            ward = int(row.get('ward', 0))
        except (ValueError, TypeError):
            continue
        if not ward:
            continue
        votes = {}
        for code in vote_codes:
            val = row.get(code)
            if val is None or val == '':
                votes[code] = '-'
                continue
            val = str(val).strip()
            if val not in VALID_POSITIONS:
                # Try common aliases — case-insensitive, "Y"/"N" → A/O
                vlow = val.lower()
                if vlow in ('y', 'yes', 'aye', 'affirmative'):
                    val = 'Affirmative'
                elif vlow in ('n', 'no', 'nay', 'oppositional'):
                    val = 'Oppositional'
                elif vlow in ('p', 'present', 'abstain', 'mixed', 'neutral'):
                    val = 'Neutral'
                else:
                    print(f"  ! Ward {ward}, vote '{code}': unrecognized value "
                          f"{val!r} — defaulting to '-'")
                    val = '-'
            votes[code] = val
        out[ward] = votes
    return out


def read_alder_bios(sheet) -> dict[int, dict]:
    """Read the Alder Bios tab into a {ward: alder_dict} mapping."""
    try:
        ws = sheet.worksheet('Alder Bios')
    except gspread.WorksheetNotFound:
        print("  ! No 'Alder Bios' tab found, skipping bios sync.")
        return {}
    rows = ws.get_all_records()
    out = {}
    for row in rows:
        try:
            ward = int(row.get('ward', 0))
        except (ValueError, TypeError):
            continue
        if not ward:
            continue
        # first_elected as int (or None)
        fe = row.get('first_elected')
        try:
            first_elected = int(fe) if fe not in (None, '') else None
        except (ValueError, TypeError):
            first_elected = None
        # Bio: if blank, embed will template it from neighborhoods + first_elected
        bio = (row.get('bio') or '').strip() or None
        out[ward] = {
            'ward': ward,
            'name': (row.get('name') or '').strip(),
            'firstElected': first_elected,
            'party': (row.get('party') or '').strip() or None,
            'neighborhoods': (row.get('neighborhoods') or '').strip() or None,
            'bio': bio,
            'tenureNote': (row.get('tenure_note') or '').strip() or None,
            'email': (row.get('email') or '').strip() or None,
            'website': (row.get('website') or '').strip() or None,
            'committees': (row.get('committees') or '').strip() or None,
        }
    return out


# ============================================================
# MERGE LOGIC
# ============================================================
def merge_into_data(data: dict, vote_metadata: list[dict],
                    votes: dict[int, dict], bios: dict[int, dict]) -> dict:
    """Merge sheet data into council-data.json structure.

    Strategy:
      - If Vote Metadata is present, REPLACE data['votemeta'] entirely.
      - If Alder Bios is present, REPLACE data['alders'] entirely (using bios
        as the canonical roster and joining votes onto each alder).
      - If only one of votes/bios is present, preserve the other from existing
        data (so partial syncs don't wipe things out).
    """
    changes = {'votes_updated': 0, 'bios_updated': 0, 'votemeta_updated': 0}

    # Vote metadata: editor wins
    if vote_metadata:
        data['votemeta'] = vote_metadata
        changes['votemeta_updated'] = len(vote_metadata)

    # If we have bios, rebuild the alders list from them + join in votes
    if bios:
        new_alders = []
        for ward in sorted(bios.keys()):
            alder = dict(bios[ward])
            # Attach votes from the votes sheet (or empty if no votes data)
            alder['votes'] = votes.get(ward, {})
            new_alders.append(alder)
            changes['bios_updated'] += 1
            if ward in votes:
                changes['votes_updated'] += 1
        data['alders'] = new_alders
    elif votes:
        # Bios not synced this round, but votes are. Update votes on existing alders.
        for alder in data.get('alders', []):
            ward = alder.get('ward')
            if ward in votes:
                alder['votes'] = votes[ward]
                changes['votes_updated'] += 1

    return changes


# ============================================================
# MAIN
# ============================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet-id', default=os.environ.get('SHEET_ID'),
                    help='Google Sheet ID (or set SHEET_ID env var)')
    ap.add_argument('--creds-file', help='Path to service account JSON key')
    ap.add_argument('--data-file', default=str(DEFAULT_DATA_PATH))
    ap.add_argument('--dry-run', action='store_true',
                    help="Report changes but don't write")
    args = ap.parse_args()

    if not args.sheet_id:
        raise SystemExit("Missing --sheet-id (or SHEET_ID env var)")

    data_path = Path(args.data_file)
    if not data_path.exists():
        raise SystemExit(f"Data file not found: {data_path}")

    print(f"Loading data from {data_path}…")
    data = json.load(open(data_path))
    print(f"  Existing: {len(data.get('alders', []))} alders, "
          f"{len(data.get('votemeta', []))} votes")

    print(f"Opening sheet {args.sheet_id}…")
    sheet = open_sheet(args.sheet_id, creds_file=args.creds_file)

    print("Reading 'Vote Metadata' tab…")
    vote_metadata = read_vote_metadata(sheet)
    print(f"  {len(vote_metadata)} vote definitions")
    vote_codes = [vm['code'] for vm in vote_metadata]

    print("Reading 'Votes' tab…")
    votes = read_votes(sheet, vote_codes) if vote_codes else {}
    print(f"  {len(votes)} wards with vote records")

    print("Reading 'Alder Bios' tab…")
    bios = read_alder_bios(sheet)
    print(f"  {len(bios)} alder bios")

    print("Merging…")
    changes = merge_into_data(data, vote_metadata, votes, bios)
    print(f"  {changes}")

    if args.dry_run:
        print("Dry run — not writing.")
        return

    with open(data_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {data_path}")


if __name__ == '__main__':
    main()
