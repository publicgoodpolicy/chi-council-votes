#!/usr/bin/env python3
"""
IPG Campaign Finance Ingestion Script
======================================
Pulls Chicago alder campaign committee data from the Illinois State Board of
Elections (SBE), normalizes into IPG's schema, and writes campaign-finance.json
for consumption by the Squarespace embed.

USAGE
    python ingest.py                   # fetch all 50 wards, write JSON
    python ingest.py --ward 1          # fetch one ward
    python ingest.py --since 2023-05-15  # only contributions since date
    python ingest.py --dry-run         # don't write, just report

DATA SOURCE
    The Illinois State Board of Elections publishes campaign finance data
    electronically. All political committees with >$5,000 receipts or
    expenditures in a year must file. Anything >$150 must be itemized.

    The SBE site (elections.il.gov) has search and export endpoints.
    Illinois Sunshine (illinoissunshine.org) is a friendlier UI on the same
    upstream data. This script can target either; SBE-direct is preferred for
    long-term sustainability since Sunshine is a third party.

DEPENDENCIES
    pip install requests beautifulsoup4 lxml

LICENSE
    This script is public; the data it retrieves is public-record under the
    Illinois Campaign Disclosure Act (10 ILCS 5/9).
"""

from __future__ import annotations
import argparse, json, re, sys, time
from dataclasses import dataclass, field, asdict
from datetime import datetime, date
from pathlib import Path
from typing import Optional

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Missing deps. Run: pip install requests beautifulsoup4 lxml", file=sys.stderr)
    sys.exit(1)


# ============================================================
# COMMITTEE ROSTER
# ============================================================
# Map each Chicago ward to its alder's campaign committee at the SBE.
# Fill in `sbe_id` once per committee (it's the numeric ID in URLs like
# https://www.elections.il.gov/CampaignDisclosure/CommitteeDetail.aspx?id=...).
# Sunshine IDs are also useful as a cross-reference.
#
# To find a committee ID:
#   1. Go to https://elections.il.gov/CampaignDisclosure/CommitteeSearch.aspx
#   2. Search the alder's committee name (e.g., "Neighbors for Daniel La Spata")
#   3. Click into the committee detail; the URL's ID parameter is the SBE ID.
#
# This is a one-time research task (~1 hour for all 50 wards).

WARD_COMMITTEES: dict[int, dict] = {
    1: {
        "alder": "Daniel La Spata",
        "committee_name": "Neighbors for Daniel La Spata",
        "sunshine_id": "34616",
        "sbe_id": None,  # TODO: fill from elections.il.gov
    },
    # Add the other 49 here as you research them.
    # 2: {"alder":"Brian Hopkins","committee_name":"...","sunshine_id":"...","sbe_id":None},
    # ...
}


# ============================================================
# DATA MODEL (mirrors campaign-finance.json schema v1.0)
# ============================================================
@dataclass
class Donor:
    id: str
    name: str
    type: str            # "Individual" | "PAC" | "Corporation" | "Union" | "Other"
    industry: str = "unclassified"  # key from industry_tags.json
    flags: list = field(default_factory=list)
    notes: Optional[str] = None

@dataclass
class Contribution:
    id: str
    donor_id: str
    committee_id: str
    amount: float
    date: str            # ISO YYYY-MM-DD
    cycle: str
    contribution_type: str
    source_filing: str   # SBE filing ID for audit trail


# ============================================================
# UTILITIES
# ============================================================
def slugify(s: str) -> str:
    """Stable donor ID. Same name + same address → same slug. We use name only
    for the demo; production should incorporate address to disambiguate."""
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")[:80]

def cycle_for(d: str) -> str:
    """Map a date to an election cycle. Chicago aldermanic elections are every
    4 years (2019, 2023, 2027). A cycle is the period leading to that election."""
    y = int(d[:4])
    if y <= 2019: return "2019"
    if y <= 2023: return "2023"
    if y <= 2027: return "2025"  # the current cycle's "money-in" period
    return "2027"


# ============================================================
# SOURCE: ILLINOIS SUNSHINE (placeholder fetcher)
# ============================================================
# Sunshine is convenient but the donation tables render via JavaScript, which
# means you can't pull them with simple requests. Three options to handle this:
#
#   A) Use a headless browser (playwright/selenium) to scrape the rendered DOM.
#   B) Reverse-engineer Sunshine's underlying API calls (the page is React-y).
#   C) Skip Sunshine and go straight to SBE — see fetch_sbe_committee() below.
#
# Option C is what we recommend for production.

def fetch_sunshine_committee(sunshine_id: str) -> list[dict]:
    """Stub. Implement with playwright if you want to use Sunshine as the source."""
    raise NotImplementedError(
        "Sunshine fetching not implemented. Use SBE direct (fetch_sbe_committee) "
        "or implement this with a headless browser."
    )


# ============================================================
# SOURCE: ILLINOIS STATE BOARD OF ELECTIONS (preferred)
# ============================================================
# The SBE publishes raw filing data. For each committee, the relevant filings
# are quarterly D-2 reports plus A-1 large-contribution notices (>$1,000 within
# 30 days of an election).
#
# The data download endpoints aren't a documented REST API; they're standard
# ASP.NET search pages that return HTML tables. Two well-tested parsers exist:
#
#   - github.com/datamade/election-money  (the lib behind Illinois Sunshine)
#   - github.com/newsapps/ilcampaignfinance  (older, simpler)
#
# Rather than reimplement, you can either:
#   1. Vendor one of those libraries into this script, or
#   2. Use the SBE bulk download (a quarterly all-state ZIP — overkill for our
#      50 committees but eliminates per-committee scraping).
#
# Either way, this function is the seam where that integration lives.

SBE_BASE = "https://www.elections.il.gov/CampaignDisclosure"

def fetch_sbe_committee(sbe_id: str, since: Optional[date] = None) -> list[dict]:
    """Return list of contribution dicts for one committee.

    Each dict: {
      'donor_name': str, 'donor_address': str, 'donor_type': str,
      'amount': float, 'date': 'YYYY-MM-DD',
      'contribution_type': str, 'filing_id': str,
    }
    """
    # Placeholder. In production this either calls into election-money or
    # parses the SBE committee-detail page itself.
    raise NotImplementedError(
        "SBE fetcher not yet implemented. Recommended path:\n"
        "  pip install git+https://github.com/datamade/election-money\n"
        "  then call its committee-receipt API here."
    )


# ============================================================
# CLASSIFICATION HELPERS (auto-tag by name pattern)
# ============================================================
# After ingestion, donors are 'unclassified' by default. Editors classify them
# manually via industry-tags.json. This auto-tagger gives them a head start by
# pattern-matching common names — they review and override.

AUTO_INDUSTRY_PATTERNS = [
    (r"\b(teachers? union|CTU|IFT|AFT)\b",           "labor-teachers"),
    (r"\bSEIU\b",                                     "labor-service"),
    (r"\b(IBEW|carpenters?|laborers?|operating engineers?|pipefitters?|plumbers?|sheet metal)\b", "labor-trades"),
    (r"\b(AFSCME|police|fire|firefighters?)\b",       "labor-public"),
    (r"\b(realtors?|real estate|building owners|developers?|BOMA)\b", "real-estate"),
    (r"\b(restaurant|tavern|hospitality|IRMA|illinois retail)\b", "restaurant"),
    (r"\b(FOP|fraternal order of police|police PAC)\b", "police-fop"),
    (r"\b(charter school|noble network)\b",           "charter-schools"),
    (r"\b(comed|exxon|peoples gas|nicor|utility)\b",  "fossil-fuels"),
    (r"\b(cannabis|dispensary|cresco|verano|green thumb)\b", "cannabis"),
    (r"\b(United Working Families|UWF|progress|bernie|reclaim)\b", "progressive-pol"),
    (r"\b(democratic party|cook county democrats)\b", "establishment-pol"),
]

def auto_classify(donor_name: str, donor_type: str) -> str:
    if donor_type.lower() == "individual":
        return "individual-other"
    for pattern, tag in AUTO_INDUSTRY_PATTERNS:
        if re.search(pattern, donor_name, re.IGNORECASE):
            return tag
    return "unclassified"


# ============================================================
# MAIN PIPELINE
# ============================================================
def ingest(wards: list[int], since: date, dry_run: bool, out_path: Path) -> None:
    # Load existing data so we preserve editor-added industry tags / flags / notes
    existing_donors: dict[str, dict] = {}
    existing_committees: dict[str, dict] = {}
    if out_path.exists():
        with open(out_path) as f:
            existing = json.load(f)
        existing_donors = existing.get("donors", {})
        existing_committees = existing.get("committees", {})
        print(f"Loaded existing data: {len(existing_donors)} donors, "
              f"{len(existing_committees)} committees")

    donors: dict[str, dict] = {}
    contributions: list[dict] = []
    committees: dict[str, dict] = dict(existing_committees)  # start from existing

    for ward in wards:
        if ward not in WARD_COMMITTEES:
            print(f"  Ward {ward}: no committee registered, skipping")
            continue
        info = WARD_COMMITTEES[ward]
        cid = f"ward-{ward}-{slugify(info['alder'])}"
        print(f"  Ward {ward}: {info['alder']} ({info['committee_name']})")

        try:
            if info.get("sbe_id"):
                raw = fetch_sbe_committee(info["sbe_id"], since=since)
            else:
                print(f"    SKIP — no sbe_id configured")
                continue
        except NotImplementedError as e:
            print(f"    SKIP — {e}")
            continue
        except Exception as e:
            print(f"    ERROR — {e}")
            continue

        committees[cid] = {
            "id": cid, "ward": ward,
            "alder_name": info["alder"],
            "committee_name": info["committee_name"],
            "sbe_committee_id": info["sbe_id"],
            "il_sunshine_url": (f"https://illinoissunshine.org/committees/"
                                f"{info['sunshine_id']}/" if info.get("sunshine_id") else None),
            "founded": None,
            "data_quality": "REAL",
            "last_updated": date.today().isoformat(),
            "notes": None,
        }

        for r in raw:
            d_slug = slugify(r["donor_name"])
            # Preserve any editor-assigned industry / flags from existing data
            if d_slug in existing_donors:
                donor = existing_donors[d_slug]
            else:
                donor = {
                    "id": d_slug,
                    "name": r["donor_name"],
                    "type": r["donor_type"],
                    "industry": auto_classify(r["donor_name"], r["donor_type"]),
                    "flags": [],
                    "notes": None,
                }
            donors[d_slug] = donor

            contributions.append({
                "id": f"c-{cid}-{r['filing_id']}",
                "donor_id": d_slug,
                "committee_id": cid,
                "amount": float(r["amount"]),
                "date": r["date"],
                "cycle": cycle_for(r["date"]),
                "contribution_type": r["contribution_type"],
                "source_filing": r["filing_id"],
            })
        time.sleep(1)  # be polite to the source

    # Merge donors: keep editor-added donors that weren't in this run
    for d_slug, d in existing_donors.items():
        if d_slug not in donors:
            donors[d_slug] = d

    out = {
        "schema_version": "1.0",
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source": "Illinois State Board of Elections",
        "cycles_included": ["2023", "2025"],
        "industry_tags": _load_industry_tags(),
        "flag_types":    _load_flag_types(),
        "donors": donors,
        "committees": committees,
        "contributions": contributions,
    }

    print(f"\nResult: {len(donors)} donors, {len(committees)} committees, "
          f"{len(contributions)} contributions")
    if dry_run:
        print("  --dry-run: not writing.")
        return
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {out_path} ({out_path.stat().st_size:,} bytes)")


def _load_industry_tags() -> dict:
    p = Path(__file__).parent / "industry-tags.json"
    if p.exists():
        return json.loads(p.read_text())
    return {}

def _load_flag_types() -> dict:
    p = Path(__file__).parent / "flag-types.json"
    if p.exists():
        return json.loads(p.read_text())
    return {}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ward", type=int, action="append", help="Single ward to fetch (repeatable). Default: all.")
    ap.add_argument("--since", default="2023-05-15", help="Earliest contribution date (YYYY-MM-DD)")
    ap.add_argument("--out", default="campaign-finance.json", help="Output file")
    ap.add_argument("--dry-run", action="store_true", help="Don't write output")
    args = ap.parse_args()

    wards = args.ward or sorted(WARD_COMMITTEES.keys())
    since = date.fromisoformat(args.since)
    out = Path(args.out)
    print(f"Ingesting wards: {wards}\n  since: {since}\n  → {out}\n")
    ingest(wards, since, args.dry_run, out)


if __name__ == "__main__":
    main()
