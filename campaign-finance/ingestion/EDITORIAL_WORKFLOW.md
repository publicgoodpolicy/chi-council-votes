# Editorial Workflow: Classifying Unclassified Donors

When ingestion runs, some donors don't match any auto-classification pattern
and get tagged `unclassified`. This script helps editors work through them
quickly, prioritized by dollar amount.

## Workflow

### 1. Run the export

After your latest ingestion cycle, generate the unclassified-donor CSV:

```bash
cd ~/chi-council-votes
python3 campaign-finance/ingestion/export_unclassified.py
```

This writes `unclassified_donors.csv` to your current folder and prints a
summary like:

```
Wrote unclassified_donors.csv: 423 donors
  Donors with suggested classification: 89 (21%)
  Total unclassified money: $1,247,330.50
  Top 10 unclassified donors = $312,840.00 (25% of unclassified total)
  Top 50 unclassified donors = $891,200.00 (71% of unclassified total)

Suggested classifications (by donor count):
  real-estate          47 donors  $   320,150
  restaurant           18 donors  $   142,000
  ...
```

The 80/20 principle holds: the top 50 unclassified donors typically account
for ~70-80% of the unclassified dollar volume. Focus there first.

### Optional flags

```bash
# Only the top 50 donors by amount
python3 campaign-finance/ingestion/export_unclassified.py --top 50

# Only donors who've given $500 or more
python3 campaign-finance/ingestion/export_unclassified.py --min-amount 500

# Output to a specific location
python3 campaign-finance/ingestion/export_unclassified.py --output ~/Desktop/work.csv
```

### 2. Open the CSV in Google Sheets

`File → Import → Upload → unclassified_donors.csv → Replace current sheet`.

Sort by `total_given` descending if not already. You'll see columns:

- `donor_id` — used to add the override to the live Sheet later
- `name` — the donor's name as in SBE
- `total_given` — total $ given across all alders in our dataset
- `contribution_count` — number of separate contributions
- `committees_funded` — which alders' committees they gave to
- `occupation`, `employer`, `city` — from SBE data (if individual)
- `suggested_industry` — script's best guess (may be blank)
- `suggested_reason` — why the script suggested that industry
- `primary_industry` — **YOU FILL THIS IN**
- `additional_industries` — optional, comma-separated
- `flags` — optional, see below
- `notes` — optional, free text

### 3. Classify each donor

For each row, decide on the `primary_industry`. Options (from the Industry
Tags tab in your live Sheet):

| Key | Use for |
|---|---|
| labor-teachers | CTU, federation of teachers, education unions |
| labor-service | SEIU, hospital workers, nurses' unions |
| labor-public | AFSCME, public-sector unions |
| labor-trades | Carpenters, ironworkers, IBEW, operating engineers, generic unions |
| progressive-pol | UWF, IPO, DSA, Reclaim Chicago, other progressive PACs |
| establishment-pol | Generic PACs not in any other category |
| real-estate | Developers, realtors, BOMA, property management LLCs |
| restaurant | Restaurant PACs, individual restaurants, bars, music venues |
| finance | Banks, investment firms, financial services |
| tech | Tech companies, software, telecom (Comcast PAC) |
| legal | Law firms, lobbying firms (often LLPs) |
| healthcare | Hospitals, pharma, non-union medical |
| charter-schools | KIPP, Noble Network, INOCS |
| fossil-fuels | ComEd, Peoples Gas, oil & gas |
| cannabis | Dispensaries, cannabis companies |
| police-fop | FOP, police unions |
| self-funding | Candidate giving to their own committee |
| individual | Individual donor with no industry alignment |
| unclassified | Couldn't determine even after research |

If the `suggested_industry` looks right, copy it into `primary_industry`. If
wrong, write the correct one. If you can't tell, leave blank and move on.

### 4. Add flags for notable patterns (optional)

The `flags` column accepts sourced editorial flags. Format:
`flag_type|source_url|note`

Example: `aipac-donor|https://www.fec.gov/data/...|Gave $5K to AIPAC PAC 2024`

Flag types are defined in the Flag Types tab of your live Sheet.

### 5. Push the classifications to the live Sheet

When you've worked through a batch:

1. Open your live IPG Council Data Google Sheet
2. Go to the **Donor Overrides** tab
3. For each classified row in your CSV, **paste a new row into the Donor
   Overrides tab** with:
   - `donor_id` (exactly as in CSV)
   - `primary_industry` (your classification)
   - `additional_industries`, `flags`, `notes` (if you added any)
   - `last_edited_by` (your email)

4. Save the Sheet.

5. Trigger the nightly sync workflow manually (Actions tab → "Sync council
   data" → Run workflow) to update the live site immediately. Otherwise it
   updates within ~24 hours via the nightly schedule.

### 6. Repeat next quarter

After each ingestion cycle, run the script again. New unclassified donors
will appear; previously-classified ones won't (the override sheet keeps
their tags persistent across ingestions).

## Tips for fast classification

- **Trust the script's suggestion when it has one.** The patterns are
  conservative — they only suggest when there's a clear signal.
- **Use Google to look up unknown names.** Most unclassified donors are
  one of: a local business (real-estate or restaurant), a law firm
  (legal), or a specific person (individual).
- **Donors that span multiple committees are higher-priority.** A donor
  giving to 6 alders is exerting more influence than one giving to 1.
  Sort by `contribution_count` desc as a secondary view.
- **"Not Yet Classified" is OK.** If you can't figure out who someone is,
  leave it as unclassified rather than guessing. Wrong classifications
  create misleading patterns.
- **Self-funding catches:** anything where `name` matches a substring of
  an alder's name is auto-detected during ingestion. If it slips through,
  use `self-funding` as the primary industry.

## What this script does NOT do

- Doesn't write to your live Sheet automatically. You're the human in the
  loop for editorial calls.
- Doesn't classify everything. Patterns catch ~15-30% of unclassifieds;
  the rest need research.
- Doesn't preserve any work you do in the CSV across re-runs. If you run
  it again, you get a fresh CSV with no in-progress classifications. So
  finish a batch and push it to the live Sheet before re-running, or
  rename the CSV to keep your work.

## Refining the auto-classification patterns

If you find yourself classifying the same kind of donor name pattern over
and over, the script's heuristics can be expanded. Open
`campaign-finance/ingestion/export_unclassified.py`, look at
`EMPLOYER_AND_NAME_RULES` and `OCCUPATION_RULES`, add new regex patterns,
commit and push. The same patterns can also be added to `ingest.py`'s
`INDUSTRY_RULES` so they auto-classify on next ingestion.
