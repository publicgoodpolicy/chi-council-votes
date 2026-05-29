# IPG Campaign Finance Data Pipeline

This folder owns the campaign-finance data layer of the IPG Chicago City Council
Accountability Tool. It is **separate from the Squarespace embed**: the embed
fetches `campaign-finance.json` from a public URL at runtime, so this pipeline
can be re-run quarterly without touching the website.

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
   - Vendor in [DataMade's `election-money`](https://github.com/datamade/election-money)
     (the library behind Illinois Sunshine — well-tested, handles edge cases).
   - Or use the SBE's quarterly bulk download ZIP, parse it once, and filter to
     our 50 committees.
   The function `fetch_sbe_committee(sbe_id, since)` is where this lives.

4. **Run it.**
   ```bash
   python ingest.py                 # all wards, current term
   python ingest.py --ward 1        # one ward (good for debugging)
   python ingest.py --dry-run       # report without writing
   ```

5. **Publish.** Commit `campaign-finance.json`, push to GitHub. The embed reads
   from the raw URL on the next page load.

## How editorial classification works

After `ingest.py` writes new donor records, every new donor has
`industry: "unclassified"` by default (or an auto-guess from name patterns —
e.g., "CTU PAC" → `labor-teachers`). Editors then review and reclassify in two
ways:

**Option A — directly in campaign-finance.json:** edit a donor's `industry`
field, and `ingest.py` will preserve your edit on the next run.

**Option B — via donor-overrides.json (recommended for editor workflows):** keep
a small JSON file mapping donor slugs to industry/flags. `ingest.py` applies
these every run, so they never get clobbered:
```json
{
  "illinois-realtors-rpac": {
    "industry": "real-estate",
    "flags": [
      {
        "type": "anti-bch",
        "source_url": "https://illinoissunshine.org/contributions/...",
        "note": "Contributed $X to the anti-BCH 'Chicago Forward' campaign."
      }
    ]
  }
}
```

## On flags and legal safety

Flags appear on the public website. They must be:
- **Factually sourced.** Every flag carries a `source_url` to a primary record.
- **Specifically worded.** "Funded BCH opposition" not "anti-housing."
- **Tied to public conduct.** A donor's giving pattern is public record;
  characterizations of motive are not.

The `flag_types` vocabulary controls what labels exist; you cannot create a
free-text flag. This is on purpose — it forces editorial consistency.

## Data freshness

Illinois Sunshine and the SBE publish data daily as filings come in, but
committees file quarterly reports plus large-contribution notices within 5
business days of a $1,000+ gift. So:

- **Reporting cadence:** quarterly reports due Jan 31, Apr 15, Jul 31, Oct 15.
- **Practical update cadence for IPG:** run `ingest.py` ~5 days after each
  deadline, plus once mid-cycle if a major election is near.
- **What to tell users:** "Last updated [date] · Reflects filings through [most
  recent quarter end]" — the embed already shows this from
  `committees[cid].last_updated`.

## Data quality flags on each committee

Each committee record carries a `data_quality` field:
- `REAL` — pulled from SBE in the last ingestion run.
- `DEMO` — illustrative placeholder data (e.g., Ward 1 in the initial build).
- `PARTIAL` — committee found but data import was incomplete.
- `EMPTY` — committee not yet researched / ingested.

The embed renders different UI states for each, so users always know what
they're looking at.

## A note on sustainability

Illinois Sunshine is wonderful but it's a single third party. If they shut down
or change their site structure, anything depending on them breaks. The SBE is
a state agency required by law to publish this data; depending on it directly
is a much more durable contract. That's why this script targets SBE-first.

If SBE site structure ever changes, `fetch_sbe_committee` is the only function
that needs updating.
