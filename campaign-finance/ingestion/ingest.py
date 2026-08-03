#!/usr/bin/env python3
"""
IPG Campaign-Finance Ingestion
================================
Reads SBE bulk-data receipts files (CSV/TSV) and updates council-data.json
with real contribution data.

WORKFLOW
--------
1. Editor downloads receipts files for one or more committees from
   elections.il.gov, saving CSV (or TXT/TSV) format.
2. Editor places downloaded files in `raw/receipts/` directory.
3. Editor runs `python ingest.py` to process all files there.
4. Script merges results into council-data.json, preserving donor IDs across
   runs so editor overrides in the Google Sheet stay attached to the right
   records.
5. Editor commits and pushes; the sync_overrides.py workflow then applies
   Sheet-based tags/flags on top.

SCHEMA EXPECTATIONS (validated at runtime)
------------------------------------------
SBE Receipts files have these columns (case-sensitive):
  CommitteeID, CommitteeName, ContributedBy, RcvdDate, Amount, LoanAmount,
  Occupation, Employer, Address1, Address2, City, State, Zip, D2Part,
  Description, VendorName, VendorAddress1, VendorAddress2, VendorCity,
  VendorState, VendorZip, DocName, Election, RptPdBegDate, RptPdEndDate,
  FiledRcvdDate

If any REQUIRED column is missing, the script fails loudly. If new columns
appear, they're silently ignored (forward-compatible).

CONTRIBUTION TYPES (D2Part)
---------------------------
  Individual Contribution → itemized as 'Individual'
  Transfer In             → itemized as 'PAC' (committee-to-committee)
  In-kind Contribution    → itemized as Individual or Other (non-cash)
  Loan Received           → flagged separately; included in totals
  Other Receipt           → rare, classified as Other

USAGE
-----
    python ingest.py                              # process all files in raw/receipts/
    python ingest.py --file raw/receipts/x.csv   # single file
    python ingest.py --dry-run                    # report changes, don't write
    python ingest.py --data-file path.json        # alternate data file location
"""

from __future__ import annotations
import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

# ============================================================
# CONFIG
# ============================================================
DEFAULT_RAW_DIR = Path('raw/receipts')
DEFAULT_DATA_FILE = Path('council-data.json')

REQUIRED_COLUMNS = {
    'CommitteeID', 'CommitteeName', 'ContributedBy',
    'RcvdDate', 'Amount', 'D2Part',
}

# Election-cycle boundaries (Chicago municipal). Used to assign each
# contribution to a cycle based on RcvdDate.
CYCLES = {
    '2015': {'start': '2011-05-17', 'end': '2015-05-17'},
    '2019': {'start': '2015-05-18', 'end': '2019-05-19'},
    '2023': {'start': '2019-05-20', 'end': '2023-05-14'},
    '2027': {'start': '2023-05-15', 'end': '2027-05-17'},
}

# ============================================================
# DONOR AUTO-CLASSIFICATION
# ============================================================
# Patterns are matched against the donor name (lowercased). First match wins,
# so order matters: more specific patterns should come before general ones.
# Editors can override any classification via the Google Sheet's Donor
# Overrides tab — the `primary_industry` column wins over these rules.
INDUSTRY_RULES = [
    # Labor — most specific first
    (r'\b(ctu|chicago teachers union|cook county college teachers|teachers? union|federation of teachers|education association)\b', 'labor-teachers'),
    (r'\b(seiu|hospital workers|nurses?|healthcare workers?)\b', 'labor-service'),
    (r'\b(afscme|public employees? union)\b', 'labor-public'),
    (r'\b(carpenters|laborers|ironworkers|electricians|operating engineers|operators? joint|pipe(?:fitters?|trades?)|sheet metal|plasterers|painters|teamsters|building trades)\b', 'labor-trades'),
    (r'\b(union|local \d+|council \d+|brotherhood|cope|ibew|atu|cwa)\b', 'labor-trades'),  # generic union fallback

    # Progressive political orgs
    (r'\b(united working families|uwf|ipo|independent political org|reclaim chicago|grassroots|justice democrats)\b', 'progressive-pol'),

    # Real estate / developers
    (r'\b(real estate|realty|realtors?|developers?|properties|building owners|apartment association|boma)\b', 'real-estate'),
    (r'\b(construction|builders|contractors? association)\b', 'real-estate'),

    # Restaurant industry (relevant given 1FW vote)
    (r'\b(restaurant|cafe|brewery|hospitality|bar association|illinois restaurant)\b', 'restaurant'),

    # Finance / banking — require specific finance-context words, not bare "financial"
    (r'\b(bank|jpmorgan|chase|citigroup|wells fargo|credit union|investment management|hedge fund|private equity)\b', 'finance'),

    # Tech
    (r'\b(google|microsoft|amazon|tech|software|ai|cloud)\b', 'tech'),

    # Police / FOP
    (r'\b(fop|fraternal order of police|police union)\b', 'police-fop'),

    # Charter schools
    (r'\b(charter|kipp|noble network|illinois network of charter schools)\b', 'charter-schools'),

    # Fossil fuels / utilities
    (r'\b(comed|peoples gas|nicor|chevron|exxon|bp |conoco|petroleum)\b', 'fossil-fuels'),

    # Cannabis
    (r'\b(cannabis|dispensary|cresco|green thumb|verano)\b', 'cannabis'),

    # Healthcare (non-labor)
    (r'\b(hospital|medical center|pharmaceutical|pharma|advocate health)\b', 'healthcare'),

    # Establishment political (catch-all for PACs not matched above)
    (r'\bpac\b', 'establishment-pol'),
]


def classify_donor(name: str, is_individual: bool) -> str:
    """Return the primary industry tag for a donor based on name.

    is_individual: True for "Last, First" style names; False for orgs.
    """
    if is_individual:
        return 'individual'
    name_lower = name.lower()
    for pattern, industry in INDUSTRY_RULES:
        if re.search(pattern, name_lower):
            return industry
    return 'unclassified'


# ============================================================
# NORMALIZATION HELPERS
# ============================================================
def slug(name: str) -> str:
    """Stable donor ID from name.

    The same input always produces the same slug, which means donor records
    persist across ingestion runs. This is critical for editor overrides:
    if "United Working Families" gets slug 'united-working-families' on every
    run, editor overrides keyed by that slug remain attached.
    """
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return s[:80]  # cap length to keep keys readable


def parse_sbe_date(date_str: str) -> Optional[str]:
    """Convert SBE's M/D/YYYY format to ISO YYYY-MM-DD.

    Returns None if the date is unparseable (rare but possible)."""
    if not date_str or not date_str.strip():
        return None
    try:
        dt = datetime.strptime(date_str.strip(), '%m/%d/%Y')
        return dt.strftime('%Y-%m-%d')
    except ValueError:
        return None


def determine_cycle(iso_date: Optional[str]) -> Optional[str]:
    """Which Chicago municipal election cycle does this date fall into?"""
    if not iso_date:
        return None
    for code, span in CYCLES.items():
        if span['start'] <= iso_date <= span['end']:
            return code
    return None  # outside any defined cycle (very old or future)


def is_individual_name(name: str) -> bool:
    """SBE convention: individuals are 'Last, First'; orgs are 'Org Name'.

    Not perfect — some orgs have commas, some individuals don't — but it's a
    reasonable starting heuristic. Editors can correct via the Sheet."""
    return ',' in name and not any(
        x in name.lower() for x in ['inc.', 'llc', 'ltd', 'corp', 'pac', 'union', 'committee', 'group']
    )


def normalize_zip(zip_str: str) -> Optional[str]:
    """Strip whitespace, keep first 5 digits."""
    if not zip_str:
        return None
    z = re.sub(r'\D', '', zip_str.strip())
    return z[:5] if z else None


# ============================================================
# PARSE ONE RECEIPTS FILE
# ============================================================
def parse_receipts_file(path: Path) -> dict:
    """Read one SBE receipts file. Returns dict with parsed data.

    Returns:
        {
            'committee_id': '34616',
            'committee_name': 'Neighbors for Daniel La Spata',
            'donors': {slug: donor_dict, ...},
            'contributions': [contribution_dict, ...],
            'row_count': int,
            'total_amount': float,
        }
    """
    if not path.exists():
        raise SystemExit(f"File not found: {path}")

    print(f"  Reading {path.name}…")

    # Try comma-delimited first, fall back to tab-delimited
    with open(path, encoding='utf-8') as f:
        sample = f.read(2048)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=',\t')
        except csv.Error:
            dialect = csv.excel  # default to comma
        reader = csv.DictReader(f, dialect=dialect)
        rows = [r for r in reader if any(v.strip() for v in r.values() if v)]

    if not rows:
        raise SystemExit(f"{path}: file is empty (no data rows)")

    # Schema validation — fail loudly if expected columns are missing
    actual_columns = set(rows[0].keys())
    missing = REQUIRED_COLUMNS - actual_columns
    if missing:
        raise SystemExit(
            f"{path}: missing required columns: {missing}.\n"
            f"  Got: {sorted(actual_columns)}\n"
            f"  This usually means SBE changed their export format.\n"
            f"  Check elections.il.gov for the current file structure."
        )

    # First-pass: identify the committee
    committee_id = rows[0].get('CommitteeID', '').strip()
    committee_name = rows[0].get('CommitteeName', '').strip()
    if not committee_id:
        raise SystemExit(f"{path}: first row has no CommitteeID")

    # Sanity: verify all rows are for the same committee
    other_committees = {r.get('CommitteeID', '').strip() for r in rows} - {committee_id}
    if other_committees:
        print(f"  ! Warning: file contains multiple committees: "
              f"{committee_id} + {other_committees}")

    donors: dict[str, dict] = {}
    contributions: list[dict] = []
    skipped = 0
    total_amount = 0.0

    for i, row in enumerate(rows, start=2):  # row 1 is header
        try:
            amount = float(row.get('Amount', '0') or 0)
        except ValueError:
            skipped += 1
            continue

        if amount <= 0:
            # Some rows have zero amount (e.g., voided entries). Skip.
            skipped += 1
            continue

        donor_name_raw = (row.get('ContributedBy') or '').strip()
        if not donor_name_raw:
            skipped += 1
            continue

        iso_date = parse_sbe_date(row.get('RcvdDate', ''))
        cycle = determine_cycle(iso_date)
        d2_part = (row.get('D2Part') or '').strip()
        loan_amount = float(row.get('LoanAmount', '0') or 0)
        is_loan = loan_amount > 0 or d2_part == 'Loan Received'

        # Detect self-funding: candidate giving to their own committee
        # Pattern: donor name matches a portion of the committee name
        # Crude but catches most cases (La Spata, Daniel → Neighbors for Daniel La Spata)
        is_self_funding = self_funding_check(donor_name_raw, committee_name)

        is_indiv = is_individual_name(donor_name_raw) and not is_self_funding
        donor_id = slug(donor_name_raw)

        # Determine donor type for display
        if is_self_funding:
            donor_type = 'Candidate'
        elif d2_part == 'Individual Contribution':
            donor_type = 'Individual'
        elif d2_part == 'Transfer In':
            donor_type = 'PAC'
        elif d2_part == 'In-kind Contribution':
            donor_type = 'Individual' if is_indiv else 'Other'
        elif d2_part == 'Loan Received':
            donor_type = 'Candidate' if is_self_funding else 'Individual'
        else:
            donor_type = 'Other'

        # Build/update donor record
        if donor_id not in donors:
            # Classify industry. Self-funding gets its own category.
            if is_self_funding:
                primary_industry = 'self-funding'
            else:
                primary_industry = classify_donor(donor_name_raw, is_indiv)

            donor = {
                'id': donor_id,
                'name': donor_name_raw,
                'type': donor_type,
                'industries': [primary_industry],
                'flags': [],
                'notes': None,
            }
            # Optional fields if present
            occ = (row.get('Occupation') or '').strip()
            emp = (row.get('Employer') or '').strip()
            city = (row.get('City') or '').strip()
            state = (row.get('State') or '').strip()
            if occ:
                donor['occupation'] = occ
            if emp:
                donor['employer'] = emp
            if city:
                donor['city'] = f"{city}, {state}" if state else city
            donors[donor_id] = donor

        # Build contribution record
        contribution = {
            'id': f"c-{committee_id}-{i:05d}",
            'donor_id': donor_id,
            'committee_id': f"ward-x-{committee_id}",  # placeholder; mapped to ward later
            'amount': round(amount, 2),
            'date': iso_date,
            'cycle': cycle,
            'contribution_type': d2_part or 'Other',
            'source_filing': (row.get('DocName') or '').strip() or 'Quarterly',
        }
        if is_loan:
            contribution['is_loan'] = True
        if d2_part == 'In-kind Contribution':
            contribution['is_in_kind'] = True
            desc = (row.get('Description') or '').strip()
            if desc:
                contribution['in_kind_description'] = desc

        contributions.append(contribution)
        total_amount += amount

    return {
        'committee_id': committee_id,
        'committee_name': committee_name,
        'donors': donors,
        'contributions': contributions,
        'row_count': len(rows),
        'parsed_count': len(contributions),
        'skipped_count': skipped,
        'total_amount': round(total_amount, 2),
    }


def self_funding_check(donor_name: str, committee_name: str) -> bool:
    """Detect candidate giving to their own committee.

    Heuristic: if any 2+ chars of the donor's last name appear as a word in
    the committee name, treat as self-funding. False positives possible but
    rare; editors can override via Sheet.
    """
    if not donor_name or not committee_name:
        return False
    # Donor name format: "Last, First" — extract last name
    if ',' in donor_name:
        last = donor_name.split(',')[0].strip()
    else:
        return False  # only individuals self-fund typically
    if len(last) < 3:
        return False
    # Check if last name appears in committee name (case-insensitive, word boundary)
    return bool(re.search(r'\b' + re.escape(last) + r'\b', committee_name, re.I))


# ============================================================
# MERGE INTO COUNCIL-DATA.JSON
# ============================================================
def _apply_linkage(cm: dict, linkage: dict) -> None:
    """Write election candidate/race linkage fields onto a committee record.

    Extends (does not replace) the committee record produced for the council
    tool. `ward` comes from the linkage and may be None (school-board / mayoral
    races have no ward). `type='candidate'` is set so build_rollups treats the
    committee as a candidate recipient (by_candidate / by_race buckets).
    """
    cm['candidate_id'] = linkage.get('candidate_id')
    cm['race_id'] = linkage.get('race_id')
    cm['office'] = linkage.get('office')
    cm['district'] = linkage.get('district')
    cm['ward'] = linkage.get('ward')  # nullable
    cm.setdefault('type', 'candidate')
    cm.setdefault('industry_tags', [])


def merge_into_data(data: dict, parsed: dict, ward, linkage: dict = None) -> dict:
    """Merge one committee's parsed data into the data file.

    Strategy:
    - Look up the existing committee record. In council mode, the join key is
      the ward number. In election mode (linkage given), ward may be None, so we
      join on sbe_committee_id instead — this also avoids colliding with the many
      ward=None independent-expenditure committees.
    - If no existing record, create one with a generated ID.
    - In election mode, write the candidate/race linkage (candidate_id, race_id,
      office, district, nullable ward) onto the committee record.
    - Donors: union by ID. Editor-set industries[]/flags/notes win.
    - Contributions: full replacement for this committee (deletes old demo
      data, adds new ingested data).
    - Orphaned donors (zero contributions left in any committee) are removed.
    """
    today = datetime.now().strftime('%Y-%m-%d')

    # 1. Find existing committee record.
    #    Election mode (linkage) joins on sbe_committee_id (ward may be None);
    #    council mode joins on ward number, exactly as before.
    existing_cmt_id = None
    if linkage is not None:
        for cid, cm in data['committees'].items():
            if cm.get('sbe_committee_id') == parsed['committee_id']:
                existing_cmt_id = cid
                break
    else:
        for cid, cm in data['committees'].items():
            if cm.get('ward') == ward:
                existing_cmt_id = cid
                break

    # 2. Determine the canonical committee_id to use
    if existing_cmt_id:
        committee_id_str = existing_cmt_id
        cm = data['committees'][committee_id_str]
        # Update factual fields from SBE, preserve editor fields
        cm['sbe_committee_id'] = parsed['committee_id']
        cm['committee_name'] = parsed['committee_name']
        cm['data_quality'] = 'REAL'
        cm['last_updated'] = today
        cm['il_sunshine_url'] = f"https://illinoissunshine.org/committees/{parsed['committee_id']}/"
        # Preserve cash_on_hand (editor-entered)
        if linkage is not None:
            _apply_linkage(cm, linkage)
    else:
        if linkage is not None:
            _cid = linkage.get('candidate_id')
            # HALT-Q2R: don't re-prefix candidate_ids that already begin 'cand-' (committee-less
            # stubs promoted to mappings keep the cand- prefix; f"cand-{cand-...}" would double it).
            committee_id_str = (_cid if str(_cid).startswith('cand-') else f"cand-{_cid}") if _cid \
                else f"cmte-{parsed['committee_id']}"
        else:
            committee_id_str = f"ward-{ward}-{slug(parsed['committee_name'])}"
        cm = {
            'id': committee_id_str,
            'ward': ward,
            'alder_name': None,
            'committee_name': parsed['committee_name'],
            'sbe_committee_id': parsed['committee_id'],
            'il_sunshine_url': f"https://illinoissunshine.org/committees/{parsed['committee_id']}/",
            'founded': None,
            'data_quality': 'REAL',
            'last_updated': today,
            'cash_on_hand': None,
            'cash_on_hand_as_of': None,
            'notes': f"Ingested from SBE on {today}.",
        }
        if linkage is not None:
            _apply_linkage(cm, linkage)
        data['committees'][committee_id_str] = cm

    # 3. Rewrite contribution committee_ids to the canonical ID
    for c in parsed['contributions']:
        c['committee_id'] = committee_id_str

    # 4. Union donors (preserve editor-set industries/flags/notes/clusters)
    for did, donor in parsed['donors'].items():
        if did in data['donors']:
            existing = data['donors'][did]
            existing_industries = existing.get('industries') or [existing.get('industry', 'unclassified')]
            if existing_industries and existing_industries != ['unclassified']:
                if len(existing_industries) > 1:
                    existing_industries = [t for t in existing_industries if t != 'unclassified']
                donor['industries'] = existing_industries
            if existing.get('flags'):
                donor['flags'] = existing['flags']
            if existing.get('notes'):
                donor['notes'] = existing['notes']
            # Sheet-owned cluster fields (set by sync_overrides). The fresh parse
            # has none of these; without this, re-ingest orphans clustered donors
            # by stripping the parent flag (see repair_clusters.py). The
            # `is not None` guard is REQUIRED: cluster_is_parent is legitimately
            # False for members and must be preserved, not dropped.
            for f in ('cluster_id', 'cluster_is_parent', 'cluster_name', 'cluster_role', 'parent_id'):
                if existing.get(f) is not None:
                    donor[f] = existing[f]
        data['donors'][did] = donor

    # 5. Replace all contributions for this committee
    data['contributions'] = [
        c for c in data['contributions']
        if c.get('committee_id') != committee_id_str
    ]
    data['contributions'].extend(parsed['contributions'])

    # 6. Remove orphaned donors (zero contributions in any committee). The old
    # `not did.startswith('_')` guard protected the small-dollar aggregate donor
    # during the merge transient; with aggregation removed there is no such donor,
    # so a zero-contribution '_'-prefixed record is a true orphan (ITEM-1).
    contrib_donor_ids = {c['donor_id'] for c in data['contributions']}
    orphans = [did for did in list(data['donors'].keys())
               if did not in contrib_donor_ids]
    for did in orphans:
        del data['donors'][did]
    if orphans:
        print(f"  Removed {len(orphans)} orphaned donor record(s).")

    return data


# ============================================================
# MAIN
# ============================================================
def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('--raw-dir', type=Path, default=DEFAULT_RAW_DIR,
                    help='Directory containing SBE receipts files')
    ap.add_argument('--file', type=Path, action='append', default=[],
                    help='Single file (can be specified multiple times)')
    ap.add_argument('--data-file', type=Path, default=DEFAULT_DATA_FILE,
                    help='Path to council-data.json')
    ap.add_argument('--ward-map', type=Path,
                    help='JSON file mapping SBE committee IDs to ward numbers. '
                         'If not provided, prompts for each unknown committee.')
    ap.add_argument('--dry-run', action='store_true',
                    help="Report changes but don't write")
    args = ap.parse_args()

    # Resolve file list
    if args.file:
        files = list(args.file)
    elif args.raw_dir.exists():
    	# Match any .csv, .txt, or .tsv file. Filename doesn't matter —
   	 # the script reads CommitteeID from inside each file.
    	files = sorted(args.raw_dir.glob('*.csv')) \
            	+ sorted(args.raw_dir.glob('*.txt')) \
            	+ sorted(args.raw_dir.glob('*.tsv'))
    else:
        raise SystemExit(f"No --file specified and {args.raw_dir} doesn't exist.")

    if not files:
        raise SystemExit(f"No receipts files found in {args.raw_dir}.")

    print(f"Found {len(files)} receipts file(s) to process.")

    # Load existing data
    if not args.data_file.exists():
        raise SystemExit(f"Data file not found: {args.data_file}")
    data = json.load(open(args.data_file))
    print(f"Loaded {args.data_file}: {len(data.get('alders', []))} alders, "
          f"{len(data.get('committees', {}))} committees, "
          f"{len(data.get('donors', {}))} donors, "
          f"{len(data.get('contributions', []))} contributions")

    # Election mode: the data file carries races[] + candidates[]. Build the
    # committee->candidate/race linkage from the data itself (no interactive
    # prompt, ward may be None for school-board / mayoral committees).
    election_mode = bool(data.get('races')) and bool(data.get('candidates'))
    linkage_map: dict = {}
    if election_mode:
        races_by_id = {r['id']: r for r in data['races']}
        # HALT-F1 (PS-77/PS-84): committee ownership is resolved DETERMINISTICALLY —
        # most recent claimant by election date — never by iteration order (the
        # last-write-wins defect this replaces assigned ownership by luck).
        for cmte_key, cand in resolve_committee_claimants(data['candidates'], data.get('elections')).items():
            r = races_by_id.get(cand.get('race_id'), {})
            w = r.get('ward')
            linkage_map[cmte_key] = {
                'candidate_id': cand.get('id'),
                'race_id': cand.get('race_id'),
                'office': r.get('office'),
                'ward': int(w) if w not in (None, '') else None,
                'district': r.get('district'),
            }
        print(f"Election mode: {len(data['races'])} races, {len(data['candidates'])} "
              f"candidates, {len(linkage_map)} committee linkages")

    # Load committee-to-ward mapping if available
    ward_map: dict = {}
    if args.ward_map and args.ward_map.exists():
        ward_map = {str(k): int(v) for k, v in json.load(open(args.ward_map)).items()}
        print(f"Loaded ward map: {len(ward_map)} mappings")

    # Process each file
    total_changes = {'committees': 0, 'donors': 0, 'contributions': 0}
    for file_path in files:
        print(f"\n--- {file_path.name} ---")
        parsed = parse_receipts_file(file_path)
        print(f"  Committee: {parsed['committee_id']} — {parsed['committee_name']}")
        print(f"  Rows parsed: {parsed['parsed_count']} / {parsed['row_count']} "
              f"({parsed['skipped_count']} skipped)")
        print(f"  Total amount: ${parsed['total_amount']:,.2f}")
        print(f"  Distinct donors: {len(parsed['donors'])}")

        # Determine ward / linkage
        link = None
        if election_mode:
            # Election committees are linked from the data, never prompted.
            link = linkage_map.get(str(parsed['committee_id']))
            if link is None:
                print(f"  ! No candidate linkage for committee {parsed['committee_id']} "
                      f"in election data; skipping.")
                continue
            ward = link['ward']  # may be None (school-board / mayoral)
            print(f"  Linked → candidate {link['candidate_id']} / race {link['race_id']} "
                  f"(office={link['office']}, ward={ward})")
        else:
            ward = ward_map.get(parsed['committee_id'])
            if ward is None:
                # Prompt for it
                print(f"  ! No ward mapping for committee {parsed['committee_id']}")
                answer = input(f"  Which ward does this committee represent? (1-50, or 'skip'): ").strip()
                if answer.lower() in ('skip', 's', ''):
                    print("  Skipping.")
                    continue
                try:
                    ward = int(answer)
                    if not 1 <= ward <= 50:
                        raise ValueError
                except ValueError:
                    print("  Invalid ward number. Skipping.")
                    continue

        # Merge (all rows itemized — no small-dollar aggregation; SBE's own
        # Schedule A boundary is adopted, ITEM-1 2026-07-07)
        merge_into_data(data, parsed, ward, linkage=link)
        total_changes['committees'] += 1
        total_changes['donors'] += len(parsed['donors'])
        total_changes['contributions'] += len(parsed['contributions'])

    # Sanity check
    print(f"\n=== Merge summary ===")
    print(f"  Committees touched:  {total_changes['committees']}")
    print(f"  Donors written:      {total_changes['donors']}")
    print(f"  Contributions written: {total_changes['contributions']}")
    print(f"  Final state: {len(data['donors'])} donors, "
          f"{len(data['contributions'])} contributions")

    if args.dry_run:
        print("\nDry run — not writing.")
        return

    # Update metadata
    data['generated_at'] = datetime.now().strftime('%Y-%m-%dT%H:%M:%SZ')
    data['source'] = (
        'Ingested from Illinois State Board of Elections bulk data. '
        'Editorial tags/flags applied via Google Sheet sync.'
    )

    # Write
    with open(args.data_file, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"\nWrote {args.data_file}")


def resolve_committee_claimants(candidates, elections):
    """HALT-F1 (PS-77 as amended by PS-84): deterministic committee ownership — for each
    claimed SBE committee id, the MOST RECENT candidacy BY ELECTION DATE owns the
    linkage; never iteration order. ONE implementation, TWO+ callers (PS-81/F-b): also
    imported by restamp_committee_linkage.py (artifact repair) and
    validate_council_data.py (the INV-LINK expectation) — never copy this logic.
    COVERAGE LIMIT (PS-82, stated at the site): the expectation derives from
    candidates[].committee_id CLAIMS (race-map-authored, seed-written) plus stamped
    election recency. If race-map mis-authors a claim, claim and stamp are wrong
    together; that residual belongs to the authoring layer (INV-ELECT's namespace and
    convention checks), not to this resolver.
    Returns {sbe_committee_id_str: winning candidate record}."""
    date_of = {e.get('id'): (e.get('date') or '') for e in (elections or [])}
    winners = {}
    for cand in (candidates or []):
        cmte = cand.get('committee_id')
        if not cmte:
            continue
        key = str(cmte)
        cur = winners.get(key)
        if cur is None or date_of.get(cand.get('election_id'), '') > date_of.get(cur.get('election_id'), ''):
            winners[key] = cand
    return winners


if __name__ == '__main__':
    main()
