#!/usr/bin/env python3
"""
Export Unclassified Donors for Editorial Review
================================================
Reads council-data.json, finds donors that auto-classification couldn't tag,
aggregates their giving patterns across the dataset, generates suggested
classifications based on employer/occupation/name patterns, and writes a CSV
sorted by total dollars given.

WORKFLOW
--------
1. Run this script after each ingestion cycle:
       python export_unclassified.py
   (Writes unclassified_donors.csv to the working directory.)

2. Open the CSV in Google Sheets. Sort/filter to taste; the file is already
   sorted by total $ given (biggest unclassified donors first).

3. For each donor you want to classify, fill in the `primary_industry`
   column with a key from the Industry Tags tab of your live Sheet
   (e.g., real-estate, labor-teachers, restaurant).

4. When you have a batch ready, copy the relevant rows
   (donor_id + primary_industry, plus optional flags/notes) into the
   Donor Overrides tab of your live Google Sheet.

5. The nightly sync workflow picks up your changes; the live site updates
   within ~10 hours, or run the workflow manually to update immediately.

You don't need to classify every donor. Focus on the top of the list — the
biggest unclassified donors carry most of the dollar weight, so a couple
hours' work covers 80%+ of the unclassified money.

HEURISTICS
----------
The script suggests an industry when:
  - The donor's `employer` field matches a known pattern
    (e.g., "ABC Real Estate Group" → real-estate)
  - The donor's `occupation` field matches a known pattern
    (e.g., "Restaurant Owner" → restaurant)
  - The donor's name matches an extended pattern not caught by ingestion
    (e.g., "Smith Construction Inc" → real-estate)
  - The donor name is "Last, First" format → individual (fallback)

The `suggested_industry` column is just a hint — always editorial judgment
in the final review. Reasons for each suggestion are listed in
`suggested_reason` so editors can see why and accept or override quickly.

DEPENDENCIES
------------
Python 3.8+ standard library only. No pip install needed.
"""

from __future__ import annotations
import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path

DEFAULT_DATA_FILE = Path(__file__).parent.parent / 'council-data.json'
DEFAULT_OUTPUT = Path('unclassified_donors.csv')


# ============================================================
# SUGGESTION HEURISTICS
# ============================================================
# These rules try harder than ingest.py's name-based classifier.
# Run against employer, occupation, and (as fallback) donor name.
# Order matters — first match wins. Patterns are case-insensitive.
EMPLOYER_AND_NAME_RULES = [
    # Labor (most specific first)
    (r'\b(teachers?\s*union|federation of teachers|ctu|chicago teachers|education association)\b', 'labor-teachers'),
    (r'\b(seiu|hospital workers?|nurses?\s*union)\b', 'labor-service'),
    (r'\b(afscme|public employees? union)\b', 'labor-public'),
    (r'\b(carpenters|laborers|ironworkers|electricians|operating engineers|operators? joint|pipe(?:fitters?|trades?)|sheet metal|plasterers|painters|teamsters|building trades|ibew|iuoe)\b', 'labor-trades'),
    (r'\b(federation of labor|labor council|labor federation|workers united|aflcio|afl.cio)\b', 'labor-trades'),
    (r'\b(union|local \d+|brotherhood|cope|atu|cwa)\b', 'labor-trades'),

    # Progressive political organizations
    (r'\b(united working families|uwf|reclaim chicago|grassroots|justice democrats|indivisible|peoples action|democratic socialists|dsa\b|\bdsa\s+of)\b', 'progressive-pol'),

    # Real estate / construction / development
    (r'\b(real estate|realty|realtors?|properties|property management|developers?|brokers?|leasing|boma)\b', 'real-estate'),
    (r'\b(construction|builders|contracting|architects?|engineering firm|engineers? llc|civil engineering)\b', 'real-estate'),
    (r'\b(landlord|residential|commercial property|apartments?\s*llc|reit|management llc|management group|flat iron)\b', 'real-estate'),

    # Restaurant / hospitality / nightlife
    (r'\b(restaurant|cafe|tavern|brewery|brewing|hospitality|catering|hotel|inn\s|bar\s+&|grill\s|kitchen\s+llc|diner|bistro|pizzeria|eatery|dining)\b', 'restaurant'),
    (r'\b(illinois restaurant|nightlife|club\s+llc|venue|music hall|concert venue)\b', 'restaurant'),

    # Finance / banking
    (r'\b(bank|jpmorgan|chase|citigroup|wells fargo|credit union|investments?|hedge fund|private equity|wealth management|asset management|broker.dealer|insurance group|mortgage)\b', 'finance'),

    # Tech
    (r'\b(technology|software|google|microsoft|amazon|tech\s*(inc|llc|corp)|cloud|systems\s*llc|saas|ai\s*(inc|labs))\b', 'tech'),

    # Police / FOP
    (r'\b(fop|fraternal order of police|police officers? association|police union)\b', 'police-fop'),

    # Charter schools
    (r'\b(charter|kipp|noble network|illinois network of charter schools|inocs)\b', 'charter-schools'),

    # Fossil fuels / utilities
    (r'\b(comed|peoples gas|nicor|chevron|exxon|bp\s+(plc|inc|america)|conoco|petroleum|gas company|exelon)\b', 'fossil-fuels'),

    # Cannabis
    (r'\b(cannabis|dispensary|cresco|green thumb|verano|cookies\s+llc)\b', 'cannabis'),

    # Healthcare (non-labor)
    (r'\b(hospital|medical center|pharmaceutical|pharma|advocate health|northwestern medicine|rush\s+university|biotech|pharma\s*(inc|corp))\b', 'healthcare'),

    # Legal (lobbying-adjacent)
    (r'\b(law firm|attorneys?\s+(at law|llp|llc)|legal services|lobbyists?|\bllp\b)\b', 'legal'),

    # Self-employed / Retired indicators (fallback to individual)
    (r'\b(self.employed|self employed|retired|homemaker|not employed|unemployed|n/a|none)\b', 'individual'),
]

OCCUPATION_RULES = [
    (r'\b(broker|real estate|realtor)\b', 'real-estate'),
    (r'\b(developer|builder|construction|architect|landlord)\b', 'real-estate'),
    (r'\b(restaurateur|restaurant owner|chef|bartender|hospitality)\b', 'restaurant'),
    (r'\b(banker|investment|financial advisor|trader|hedge fund|portfolio manager|wealth manager)\b', 'finance'),
    (r'\b(physician|doctor|nurse|medical)\b', 'healthcare'),
    (r'\b(attorney|lawyer|counsel|paralegal)\b', 'legal'),
    (r'\b(teacher|professor|educator|principal)\b', 'labor-teachers'),
    (r'\b(police officer|detective|patrolman|sergeant)\b', 'police-fop'),
    (r'\b(union\b|labor organizer)\b', 'labor-trades'),
    (r'\b(engineer\b|software|developer|programmer)\b', 'tech'),
    (r'\b(retired|homemaker|self.employed|student|self)\b', 'individual'),
]


def suggest_industry(donor):
    """Return (suggested_industry, reason) or (None, None) if no clean guess."""
    employer = (donor.get('employer') or '').lower()
    occupation = (donor.get('occupation') or '').lower()
    name = (donor.get('name') or '').lower()

    # Employer is the strongest signal — try first
    if employer:
        for pattern, industry in EMPLOYER_AND_NAME_RULES:
            if re.search(pattern, employer, re.I):
                return industry, f'employer: "{employer[:50]}"'

    # Occupation next
    if occupation:
        for pattern, industry in OCCUPATION_RULES:
            if re.search(pattern, occupation, re.I):
                return industry, f'occupation: "{occupation[:40]}"'

    # Extended name patterns (for orgs that ingest.py missed)
    if ',' not in name and name:
        for pattern, industry in EMPLOYER_AND_NAME_RULES:
            if re.search(pattern, name, re.I):
                return industry, f'name pattern'

    # Default for individual-formatted names with no other signal
    if ',' in name:
        return 'individual', 'name format (Last, First)'

    return None, None


def is_unclassified(donor):
    """A donor auto-classification couldn't tag: no industries, or only 'unclassified'.
    The single shared definition — used for the main file AND the dedup file so the two
    worklists stay consistent."""
    inds = donor.get('industries', [])
    # unclassified iff no substantive tag present (empty or all-'unclassified'); a real co-tag reads classified
    return (not inds) or all(t == 'unclassified' for t in inds)


def worklist_id_set(data, min_amount=0.0):
    """The set of donor_ids THIS exporter would surface for `data`: non-aggregate,
    unclassified, with total contributions >= min_amount. This is the file's worklist
    MEMBERSHIP (not merely its donor universe), so a second file can dedup against the
    donors council actually surfaces — the union-aware exclusion. Totals are summed in a
    single pass over contributions (same per-donor_id sum, dues included, as the main loop)."""
    totals = {}
    for c in data.get('contributions', []):
        did = c.get('donor_id')
        if did:
            totals[did] = totals.get(did, 0) + (c.get('amount', 0) or 0)
    out = set()
    for did, donor in data.get('donors', {}).items():
        if did.startswith('_'):
            continue
        if not is_unclassified(donor):
            continue
        if totals.get(did, 0) < min_amount:
            continue
        out.add(did)
    return out


# ============================================================
# WORKLIST (shared read model)
# ============================================================
def build_worklist(data, min_amount=0, dedup_ids=None):
    """Build the enriched, dollar-sorted unclassified worklist for `data`.

    Extracted verbatim from main()'s per-donor enrichment loop so the same read
    model can back the CSV export AND the read-only editor viewer. Returns the
    same row dicts main() writes to CSV.

    dedup_ids, when given, is a set of donor_ids to exclude (e.g. council's
    worklist membership for the election-only cut). Iteration order matches
    data['donors'] insertion order, and the final sort is by total given
    descending (stable — ties keep that order), so output is deterministic.
    """
    dedup_ids = dedup_ids or set()

    non_aggregate = [(did, d) for did, d in data['donors'].items() if not did.startswith('_')]
    unclassified = [(did, d) for did, d in non_aggregate if is_unclassified(d)]
    if dedup_ids:
        unclassified = [(did, d) for did, d in unclassified if did not in dedup_ids]

    # Build committee_id → friendly alder name map
    committee_to_alder = {}
    for cid, cm in data['committees'].items():
        name = cm.get('alder_name', '')
        ward = cm.get('ward', '')
        if name:
            committee_to_alder[cid] = f"Ward {ward} — {name}"
        elif ward:
            committee_to_alder[cid] = f"Ward {ward}"
        else:                                  # elections: committees have a candidate, not a ward
            committee_to_alder[cid] = cm.get('committee_name') or cid

    # Aggregate each donor's giving across all their contributions
    enriched = []
    for did, donor in unclassified:
        contribs = [c for c in data['contributions'] if c.get('donor_id') == did]
        # Internal union-dues transfers fund a committee's own PAC — not giving on
        # the Council — and every other figure in the tool excludes them. Same rule
        # as build_rollups.py and sync_overrides._contribution_totals. Filtering here
        # (before total/count/committees) keeps a donor's footprint internally
        # consistent: the dollars and the count describe the same set of rows.
        contribs = [c for c in contribs
                    if c.get('contribution_type') != 'IE Committee Dues Transfer']
        total = sum(c.get('amount', 0) for c in contribs)
        if total < min_amount:
            continue
        committee_names = sorted(set(
            committee_to_alder.get(c['committee_id'], c['committee_id'])
            for c in contribs
        ))

        suggested, reason = suggest_industry(donor)

        enriched.append({
            'donor_id': did,
            'name': donor.get('name', ''),
            'total_given': total,
            'contribution_count': len(contribs),
            'committees_funded': '; '.join(committee_names),
            'occupation': donor.get('occupation', ''),
            'employer': donor.get('employer', ''),
            'city': donor.get('city', ''),
            'suggested_industry': suggested or '',
            'suggested_reason': reason or '',
            # Empty columns for editor to fill in
            'primary_industry': '',
            'additional_industries': '',
            'flags': '',
            'notes': '',
        })

    # Sort by total given, descending — biggest money first
    enriched.sort(key=lambda x: -x['total_given'])
    return enriched


# ============================================================
# MAIN
# ============================================================
def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('--data-file', type=Path, default=DEFAULT_DATA_FILE)
    ap.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    ap.add_argument('--top', type=int, default=None,
                    help='Only export top N by total given (default: all)')
    ap.add_argument('--min-amount', type=float, default=0,
                    help='Only export donors with total >= this amount (default: 0)')
    ap.add_argument('--dedup-against', type=Path, default=None,
                    help='Exclude donors already surfaced by THIS file\'s worklist (e.g. '
                         'council-data.json). Use for the ELECTION-ONLY cut: a shared '
                         'unclassified donor stays on council\'s worklist and is not '
                         'double-listed here. Dedup uses the same unclassified rule and '
                         'surfaces council\'s full unclassified set (no dollar cutoff).')
    args = ap.parse_args()

    if not args.data_file.exists():
        raise SystemExit(f"Data file not found: {args.data_file}")

    print(f"Reading {args.data_file}…")
    data = json.load(open(args.data_file))

    # Identify unclassified donors (same "classified" definition for every file). IE
    # committees live in data['committees'], NOT data['donors'], so they never appear here —
    # they classify via the Committee Tags tab (SBE-id), a separate path from donor-slug overrides.
    non_aggregate = [(did, d) for did, d in data['donors'].items() if not did.startswith('_')]
    start_count = len(non_aggregate)
    unclassified = [(did, d) for did, d in non_aggregate if is_unclassified(d)]
    print(f"  Stage 1 — donors in {args.data_file.name} (excl. _aggregates, IE cmtes not in donors): {start_count}")
    print(f"  Stage 2 — minus already-classified  ->  unclassified: {len(unclassified)}")

    # ELECTION-ONLY cut: drop donors already on the dedup file's (council's) worklist, so a
    # shared unclassified donor isn't double-surfaced (the union-aware exclusion — council's
    # worklist MEMBERSHIP, not just its donor universe).
    dedup_ids = None
    if args.dedup_against:
        if not args.dedup_against.exists():
            raise SystemExit(f"--dedup-against file not found: {args.dedup_against}")
        council = json.load(open(args.dedup_against))
        dedup_ids = worklist_id_set(council, 0.0)   # council surfaces its FULL unclassified set
        before = len(unclassified)
        unclassified = [(did, d) for did, d in unclassified if did not in dedup_ids]
        print(f"  Stage 3 — minus donors already on {args.dedup_against.name}'s worklist "
              f"({before - len(unclassified)} shared-unclassified removed)  ->  election-only: {len(unclassified)}")
    else:
        print(f"  Stage 3 — no --dedup-against: this IS the primary worklist for {args.data_file.name}")

    # The dollar-ranked rows themselves come from the shared read model.
    enriched = build_worklist(data, args.min_amount, dedup_ids)

    if args.top:
        enriched = enriched[:args.top]
        print(f"  Trimmed to top {args.top}")

    print(f"  Stage 4 — final list (after min-amount/top filters): {len(enriched)} rows")

    if not enriched:
        print("\nNo unclassified donors to export. Either everything is classified, "
              "or your filters are too strict.")
        return

    # Write CSV (currency-formatted total_given for readability)
    with open(args.output, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            'donor_id', 'name', 'total_given', 'contribution_count',
            'committees_funded', 'occupation', 'employer', 'city',
            'suggested_industry', 'suggested_reason',
            'primary_industry', 'additional_industries', 'flags', 'notes',
        ])
        w.writeheader()
        for row in enriched:
            w.writerow({**row, 'total_given': f"${row['total_given']:,.0f}"})

    print(f"\nWrote {args.output}: {len(enriched)} donors")

    # Print useful stats
    with_sugg = sum(1 for x in enriched if x['suggested_industry'])
    total_money = sum(x['total_given'] for x in enriched)
    print(f"  Donors with suggested classification: {with_sugg} "
          f"({with_sugg*100//len(enriched)}%)")
    print(f"  Total unclassified money: ${total_money:,.2f}")

    if len(enriched) >= 10:
        top10_money = sum(x['total_given'] for x in enriched[:10])
        top50_money = sum(x['total_given'] for x in enriched[:50]) if len(enriched) >= 50 else None
        print(f"  Top 10 unclassified donors = ${top10_money:,.2f} "
              f"({top10_money*100/total_money:.0f}% of unclassified total)")
        if top50_money is not None:
            print(f"  Top 50 unclassified donors = ${top50_money:,.2f} "
                  f"({top50_money*100/total_money:.0f}% of unclassified total)")

    # Breakdown of suggested categories — helps editor see what's likely big
    print(f"\nSuggested classifications (by donor count):")
    sugg_counts = Counter(x['suggested_industry'] for x in enriched if x['suggested_industry'])
    sugg_money = Counter()
    for x in enriched:
        if x['suggested_industry']:
            sugg_money[x['suggested_industry']] += x['total_given']
    for industry, count in sugg_counts.most_common():
        money = sugg_money[industry]
        print(f"  {industry:20s}  {count:4d} donors  ${money:>14,.0f}")

    # Unsuggested = no good heuristic match
    no_sugg = [x for x in enriched if not x['suggested_industry']]
    if no_sugg:
        no_sugg_money = sum(x['total_given'] for x in no_sugg)
        print(f"  {'(no suggestion)':20s}  {len(no_sugg):4d} donors  ${no_sugg_money:>14,.0f}")
        print(f"\n  These need editorial research. Top 10 by amount:")
        for x in no_sugg[:10]:
            ident = x['name'][:50]
            if x.get('employer'):
                ident += f" / {x['employer'][:30]}"
            print(f"    ${x['total_given']:>10,.0f}  {ident}")


if __name__ == '__main__':
    main()
