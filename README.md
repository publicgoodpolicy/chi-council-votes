# IPG Campaign Finance Data Pipeline

This folder owns the campaign-finance data layer of the IPG Chicago City Council
Accountability Tool. It is **separate from the Squarespace embed**: the embed
fetches `campaign-finance.json` from a public URL at runtime, so this pipeline
can be re-run quarterly without touching the website.

## Schema v1.1 — what's in the data file

Top-level keys in `campaign-finance.json`:

| Key | What it is |
|---|---|
| `cycles` | Definitions of election cycles. Chicago aldermanic elections every 4 years; current schema tracks the 2015, 2019, 2023, and 2027 cycles. |
| `current_cycle` | Key into `cycles` for the cycle currently being raised into. Default UI filter. |
| `industry_tags` | Controlled vocabulary for industry chips on donor rows. |
| `flag_types` | Controlled vocabulary for sourced "flag" labels. |
| `donors` | Master donor list, keyed by stable slug. Each donor: `name`, `type`, `industry`, `flags`, optional `city`, `occupation`, `employer`. |
| `committees` | One entry per ward. Each committee: ward, alder, SBE/Sunshine IDs, `data_quality`, `cash_on_hand`, `cash_on_hand_as_of`, `last_updated`, notes. |
| `contributions` | Flat list of contribution events. Aggregate small-dollar rows carry `is_aggregate: true` and `donor_count: N`. |

## Editorial display rules baked into the schema

These choices reduce legal exposure and match civic-tech best practice:

- **Individual donors itemized only when >= $1,000.** Below that threshold,
  contributions are aggregated into a single "Small-dollar donors" row per
  cycle, with the donor count visible.
- **Address granularity: city/state only.** Street addresses must be stripped
  during ingestion. Illinois Sunshine does the same.
- **Employer/occupation surfaced when filed.** Required disclosure for gifts
  >= $500; useful for accountability and downstream industry tagging.
- **Cash on hand displayed as a current snapshot**, not a cycle-specific
  figure. It's the most recent quarterly report value.

## Files

| File | What it is | Who edits it |
|---|---|---|
| `campaign-finance.json` | The data the website reads. Generated. | Don't edit by hand — run `ingest.py`. |
| `ingest.py` | The Python script that pulls from the Illinois SBE and writes the JSON. | Engineers, when SBE data updates or roster changes. |
| `industry-tags.json` | Controlled vocabulary of industry chips. | IPG editorial. |
| `flag-types.json` | Controlled vocabulary of sourced "flag" labels. | IPG editorial. |
| `donor-overrides.json` *(optional)* | Manual industry / flag assignments that survive re-ingest. | IPG editorial. |

## How the data flows

```
   Illinois State Board of Elections
     (elections.il.gov — public-record campaign disclosures)
                  │
                  ▼
              ingest.py        ◀── runs quarterly (after each filing deadline)
                  │
                  ▼
        campaign-finance.json  ◀── committed to this repo
                  │
                  ▼
   raw.githubusercontent.com/.../campaign-finance.json
                  │
                  ▼
       Squarespace embed fetches it on page load
```

## Quick start — first-time setup

1. **Get a committee ID for each ward.** This is a one-time research task,
   about an hour for all 50 wards.
   - Go to https://elections.il.gov/CampaignDisclosure/CommitteeSearch.aspx
   - Search the alder's committee (e.g., "Neighbors for Daniel La Spata")
   - Copy the numeric ID from the resulting URL
   - Fill into `WARD_COMMITTEES` at the top of `ingest.py`

2. **Install dependencies.**
   ```bash
   pip install requests beautifulsoup4 lxml
   ```

3. **Wire up the SBE fetcher.** `ingest.py` ships with stubs for the actual
   data-fetch step. Two recommended paths:
   - Vendor in DataMade's `election-money` library (powers Illinois Sunshine).
   - Or use the SBE's quarterly bulk download ZIP and filter to our 50 committees.

4. **Run it.**
   ```bash
   python ingest.py                 # all wards, current term
   python ingest.py --ward 1        # one ward (good for debugging)
   python ingest.py --since 2011-05-17  # all 4 cycles
   python ingest.py --dry-run       # report without writing
   ```

5. **Publish.** Commit `campaign-finance.json`, push to GitHub. The embed reads
   from the raw URL on the next page load.

## When the JSON gets big — sharding by committee

The current schema is one bundled file. For a few wards with current-cycle data
it's ~30 KB. With all 50 wards x 4 cycles x ~100-500 donors each, you'll be at
1-5 MB. At that size, page load on the embed will start to feel slow.

The shard-by-committee path is straightforward when you need it:

1. Generate one file per committee: `committees/ward-N.json`.
2. Keep a thin index `campaign-finance-index.json` with cycles, industry
   tags, flag types, and committee directory (summary stats, no contribution
   rows).
3. Update the embed to lazy-load the per-committee file when a user opens an
   alder.

`ingest.py` is structured so this is a one-function change in the output stage.

## How editorial classification works

After `ingest.py` writes new donor records, every new donor has
`industry: "unclassified"` by default (or an auto-guess from name patterns —
e.g., "CTU PAC" → labor-teachers). Editors then review and reclassify either
directly in the JSON or via a `donor-overrides.json` companion file that
`ingest.py` preserves across runs.

## On flags and legal safety

Flags appear on the public website. They must be:
- **Factually sourced.** Every flag carries a `source_url` to a primary record.
- **Specifically worded.** "Funded BCH opposition" not "anti-housing."
- **Tied to public conduct.** A donor's giving pattern is public record;
  characterizations of motive are not.

The `flag_types` vocabulary controls what labels exist; you cannot create a
free-text flag. This is on purpose — it forces editorial consistency.

## Data freshness

- **Reporting cadence:** quarterly reports due Jan 31, Apr 15, Jul 31, Oct 15.
- **Practical update cadence for IPG:** run `ingest.py` ~5 days after each
  deadline, plus once mid-cycle if a major election is near.

## Data quality flags

Each committee record carries a `data_quality` field:
- `REAL` — pulled from SBE in the last ingestion run.
- `DEMO` — illustrative placeholder data.
- `PARTIAL` — committee found but data import was incomplete.
- `EMPTY` — committee not yet researched / ingested.

The embed renders different UI states for each, so users always know what
they're looking at.
