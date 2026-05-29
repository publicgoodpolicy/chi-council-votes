#!/usr/bin/env python3
"""
IPG Donor Overrides — Google Sheets Sync
=========================================
Reads the IPG Donor Overrides Google Sheet and merges the editorial tags / flags
into campaign-finance.json. Runs nightly via GitHub Actions (see .github/workflows/).

OVERVIEW
--------
The sheet has three tabs that this script reads:

  1. "Donor Overrides" — one row per donor, columns:
       donor_id | additional_industries | flags | source_urls | notes | last_edited_by
     Where flags is a semicolon-separated list of "flag_type|source_url|note" triples,
     or just "flag_type" for simple flags.

  2. "Industry Tags" — controlled vocabulary, columns:
       key | label | color

  3. "Flag Types" — controlled vocabulary, columns:
       key | label | severity

After reading, this script:
  - Updates `donors[*].industries` (preserves the primary industry from ingestion,
    appends any additional_industries from overrides)
  - Replaces `donors[*].flags` with override-sourced flags (editor wins)
  - Updates `industry_tags` and `flag_types` from the sheet's vocabulary tabs

SETUP
-----
First-time configuration (done once per repo):

1. Create a Google Sheet from the template (see sheet-template.md in this folder).
2. Create a Google Cloud service account:
     - https://console.cloud.google.com/iam-admin/serviceaccounts
     - Create a new service account named "ipg-sheets-sync"
     - Create a JSON key, download it
3. Share the Sheet with the service account's email (Viewer access is enough).
4. In your GitHub repo, add two secrets (Settings → Secrets → Actions):
     - GOOGLE_SHEETS_CREDENTIALS: paste the entire JSON key file contents
     - SHEET_ID: the long ID from the Sheet's URL
5. Enable the workflow in .github/workflows/sync-overrides.yml

USAGE
-----
    python sync_overrides.py --sheet-id ABC123 --creds-file ./creds.json
    python sync_overrides.py --dry-run         # report what would change, don't write

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


# ============================================================
# SHEET PARSING
# ============================================================
def open_sheet(sheet_id: str, creds_file: Optional[str] = None,
               creds_dict: Optional[dict] = None):
    """Authenticate with Google and open the sheet by ID."""
    if creds_dict:
        creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    elif creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
    else:
        # Fall back to env var (used by GitHub Actions)
        env = os.environ.get('GOOGLE_SHEETS_CREDENTIALS')
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set "
                             "GOOGLE_SHEETS_CREDENTIALS env var.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=SCOPES)

    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


def parse_flag_cell(cell: str) -> list[dict]:
    """Parse the 'flags' cell into a list of flag dicts.

    Each flag is "flag_type|source_url|note", separated by ';'. The pipe
    delimiters after the type are optional — "anti-bch" by itself is fine.
    """
    if not cell or not cell.strip():
        return []
    out = []
    for raw in cell.split(';'):
        raw = raw.strip()
        if not raw:
            continue
        parts = [p.strip() for p in raw.split('|')]
        flag = {'type': parts[0], 'source': 'override'}
        if len(parts) > 1 and parts[1]:
            flag['source_url'] = parts[1]
        if len(parts) > 2 and parts[2]:
            flag['note'] = parts[2]
        out.append(flag)
    return out


def parse_list_cell(cell: str) -> list[str]:
    """Parse a comma-separated cell into a list of trimmed strings."""
    if not cell:
        return []
    return [s.strip() for s in cell.split(',') if s.strip()]


def read_donor_overrides(sheet) -> dict[str, dict]:
    """Read the Donor Overrides tab into a dict keyed by donor_id."""
    try:
        ws = sheet.worksheet('Donor Overrides')
    except gspread.WorksheetNotFound:
        print("  ! No 'Donor Overrides' tab found, skipping.")
        return {}

    rows = ws.get_all_records()
    out = {}
    for row in rows:
        did = (row.get('donor_id') or '').strip()
        if not did:
            continue
        override = {}
        if row.get('primary_industry'):
            override['primary_industry'] = row['primary_industry'].strip()
        addl = parse_list_cell(row.get('additional_industries', ''))
        if addl:
            override['additional_industries'] = addl
        flags = parse_flag_cell(row.get('flags', ''))
        if flags:
            override['flags'] = flags
        if row.get('notes'):
            override['notes'] = row['notes'].strip()
        if row.get('last_edited_by'):
            override['last_edited_by'] = row['last_edited_by'].strip()
        out[did] = override
    return out


def read_vocab(sheet, tab_name: str, key_field: str) -> dict[str, dict]:
    """Read a vocabulary tab (Industry Tags or Flag Types)."""
    try:
        ws = sheet.worksheet(tab_name)
    except gspread.WorksheetNotFound:
        print(f"  ! No '{tab_name}' tab found, skipping.")
        return {}
    rows = ws.get_all_records()
    out = {}
    for row in rows:
        key = (row.get(key_field) or '').strip()
        if not key:
            continue
        entry = {k: v for k, v in row.items() if k != key_field and v != ''}
        out[key] = entry
    return out


# ============================================================
# MERGE LOGIC
# ============================================================
def merge_overrides(data: dict, overrides: dict[str, dict],
                    industry_vocab: dict, flag_vocab: dict) -> dict:
    """Merge sheet data into the campaign-finance.json structure."""
    changes = {'donors_updated': 0, 'donors_skipped': 0, 'vocab_updated': 0}

    # Vocabulary updates (only set fields present in the sheet)
    if industry_vocab:
        for k, v in industry_vocab.items():
            data['industry_tags'][k] = {**data['industry_tags'].get(k, {}), **v}
            changes['vocab_updated'] += 1
    if flag_vocab:
        for k, v in flag_vocab.items():
            data['flag_types'][k] = {**data['flag_types'].get(k, {}), **v}
            changes['vocab_updated'] += 1

    # Donor-level overrides
    for did, override in overrides.items():
        if did not in data['donors']:
            print(f"  ! Override for unknown donor '{did}' — skipping.")
            changes['donors_skipped'] += 1
            continue
        donor = data['donors'][did]

        # Industries:
        #   - If 'primary_industry' is set in the sheet, REPLACE the primary
        #     (editor's classification wins over ingestion's auto-guess).
        #   - Then append any 'additional_industries' from the sheet.
        #   - If no primary_industry in sheet, keep whatever ingestion guessed.
        existing = donor.get('industries', [donor.get('industry', 'unclassified')])
        primary = override.get('primary_industry') or existing[0]
        merged_inds = [primary]
        for ind in override.get('additional_industries', []):
            if ind and ind not in merged_inds:
                merged_inds.append(ind)
        donor['industries'] = merged_inds

        # Flags: editor wins. Replace entirely with override-sourced flags.
        if 'flags' in override:
            donor['flags'] = override['flags']

        # Notes and editor metadata
        if 'notes' in override:
            donor['notes'] = override['notes']
        if 'last_edited_by' in override:
            donor['_last_edited_by'] = override['last_edited_by']

        changes['donors_updated'] += 1

    return changes


# ============================================================
# MAIN
# ============================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sheet-id', required=False, default=os.environ.get('SHEET_ID'),
                    help='Google Sheet ID (or set SHEET_ID env var)')
    ap.add_argument('--creds-file', help='Path to service account JSON key')
    ap.add_argument('--data-file', default=str(DEFAULT_DATA_PATH),
                    help='Path to campaign-finance.json')
    ap.add_argument('--dry-run', action='store_true',
                    help="Report changes but don't write")
    args = ap.parse_args()

    if not args.sheet_id:
        raise SystemExit("Missing --sheet-id (or SHEET_ID env var)")

    data_path = Path(args.data_file)
    if not data_path.exists():
        raise SystemExit(f"Data file not found: {data_path}")

    print(f"Loading data from {data_path}…")
    with open(data_path) as f:
        data = json.load(f)
    print(f"  {len(data.get('donors', {}))} donors, {len(data.get('committees', {}))} committees")

    print(f"Opening sheet {args.sheet_id}…")
    sheet = open_sheet(args.sheet_id, creds_file=args.creds_file)

    print("Reading 'Donor Overrides' tab…")
    overrides = read_donor_overrides(sheet)
    print(f"  {len(overrides)} override entries")

    print("Reading 'Industry Tags' tab…")
    industry_vocab = read_vocab(sheet, 'Industry Tags', 'key')
    print(f"  {len(industry_vocab)} industry tags")

    print("Reading 'Flag Types' tab…")
    flag_vocab = read_vocab(sheet, 'Flag Types', 'key')
    print(f"  {len(flag_vocab)} flag types")

    print("Merging…")
    changes = merge_overrides(data, overrides, industry_vocab, flag_vocab)
    print(f"  {changes}")

    if args.dry_run:
        print("Dry run — not writing.")
        return

    with open(data_path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Wrote {data_path}")


if __name__ == '__main__':
    main()
