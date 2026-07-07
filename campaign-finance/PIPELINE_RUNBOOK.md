# Vote sync — operator runbook

How to run, test, and fall back on the Chicago council vote pipeline.
Written for "future me." The data only changes when the Council actually
votes, so you do NOT need to babysit this — a manual run after meeting days
is enough if the nightly schedule ever gives you trouble.

---

## Prerequisite (one time): the workflow must exist on GitHub

The Action lives at `.github/workflows/sync-council-data.yml`. It only appears
in the Actions tab once that file is committed **on GitHub**.

If it isn't there yet, the cleanest way to add it (avoids the Personal Access
Token `workflow`-scope error) is GitHub's web UI:

1. Repo page → **Add file → Create new file**
2. Filename: `.github/workflows/sync-council-data.yml`
   (typing the slashes creates the folders)
3. Paste the workflow contents → **Commit**

Web-UI commits don't need the `workflow` token scope. (Pushing the same file
from the terminal does — that's the error you hit before.)

---

## Running the workflow manually (the real test)

1. Go to the repo on GitHub → **Actions** tab.
2. Left sidebar → **Sync council votes**.
3. Click **Run workflow** (top right) → confirm **Run workflow**.
   (This button exists because the YAML has `workflow_dispatch`.)
4. A run appears in a few seconds. Click into it → click the **sync** job to
   watch the live log.

### What success looks like
- The **Run vote sync** step prints the SYNC REPORT (Tier 2 count, the six
  featured votes with position breakdowns).
- The **Commit if changed** step either commits `council-data.json` or prints
  `No changes in council-data.json — nothing to commit.`
- Both are success. If it committed, the live tool updates on its next fetch.

### What failure looks like — and the one likely cause
If it fails at the **Run vote sync** step with a connectivity error at
`SELECT 1` (HTTP 403 / blocked / timeout), that is **bot detection**.
GitHub's runners use datacenter IPs, which `puddle.datamade.us` tends to block.
Your local machine works because it's on a residential IP.

Fixes, in order of preference:
1. **Just run it locally by hand** (see below). Simplest, and fine — the data
   only changes on meeting days.
2. **Self-hosted runner**: set up a small always-on box on a normal IP, then
   change `runs-on: ubuntu-latest` to your runner's label in the YAML.
3. **Switch the source to Legistar's API** instead of the Datasette (same
   upstream data) — a code change to `ingest_votes.py` we can add if needed.

---

## Running the sync by hand (local fallback)

From the repo, on your own machine (residential IP clears the bot wall):

```
cd campaign-finance
# preview first — writes nothing:
python3 ingest_votes.py --data ./council-data.json --map ./featured_vote_map.json --dry-run
# then for real (backs up to council-data.json.bak, re-validates before writing):
python3 ingest_votes.py --data ./council-data.json --map ./featured_vote_map.json
```

Then publish:

```
git add campaign-finance/council-data.json
git commit -m "Council vote sync $(date -u +%Y-%m-%d)"
git push
```

Sanity check after: load the live tool and confirm one known position
(e.g. Ward 2 → Snap Curfew → Affirmative; Hopkins championed it).

---

## Other operational notes

- **Adding a new featured vote**: add it to `votemeta`, then run
  `match_featured_manual.py` once to map it to its OCD vote id. The sync
  populates positions from then on. Votes with no divided roll call stay
  hand-entered (currently GSH, Southshore CBA).
- **Roster changed** (appointment / election): re-run `probe_memberships.py`
  to refresh the crosswalk and surface any succession/merged-record edge cases.
  (Outstanding: spot-check Ward 27 / Burnett before any historical backfill.)
- **Backfill to 2011**: run the sync per historical session
  (`--term 2019`, etc.). The crosswalk already spans those terms.
- **Caucuses** are NOT in the feed — edit `caucuses.json` by hand from public
  rosters. The sync never touches it.
- The sync only ever writes the machine-owned keys (`rollcall`,
  `council_committees`, `_sync`, and positions for mapped featured votes).
  Donors, bios, vote definitions, and unmapped votes are never touched.

---

## Reconciliation vs SBE D-2 sworn totals (`reconcile.py`)

`reconcile.py` is a **read-only** confidence instrument: it compares the itemized
contributions we hold against each candidate committee's own sworn quarterly D-2
totals, per reporting period. Run it **after every data refresh, before push** —
a clean run is the evidence that our itemization matches what committees filed.

```
python3 campaign-finance/ingestion/reconcile.py \
  --data campaign-finance/election-data.json \
  --d2totals raw/sbe-summary/'D2Totals - <date>.txt' \
  --fileddocs raw/sbe-summary/'FiledDocs - <date>.txt' \
  --out campaign-finance/elections/reconciliation-report.json \
  --pulled YYYY-MM-DD --threshold 500
```

**The two raw inputs** are SBE bulk exports (`D2Totals`, `FiledDocs`) downloaded
from the Illinois State Board of Elections. Pull them after the quarterly filing
deadlines — the **16th–20th of Jan / Apr / Jul / Oct** — once committees' D-2s
for the closed quarter have posted. They live in the gitignored `raw/sbe-summary/`.
**SBE bulk exports are Windows-1252 encoded; `reconcile.py` reads them as
`latin-1`** (a UTF-8 read crashes on the en-dash byte).

**`--pulled` is required** (`YYYY-MM-DD`): the date you pulled the bulk files. It
is embedded in the report as the "data current as of" stamp the methodology page
publishes — never omit or fudge it.

**How it works**: FiledDocs gives each committee's D-2 period reports (DocName ∈
Quarterly / Semiannual / Pre-election / Annual / Final); amendments are deduped
per `(RptPdBegDate, RptPdEndDate)` keeping the latest `RcvdDateTime`. D2Totals
supplies the sworn itemized total (`IndivContribI + XferInI + LoanRcvI +
OtherRctI`) per filing, joined by `FiledDocID`. Our side sums contributions typed
Individual Contribution / Transfer In / Loan Received / Other Receipt dated inside
each period; in-kind is compared separately, `Aggregate` is totalled separately.

**Committee states** (published on the methodology page — names are load-bearing):
- `RECONCILED` — every closed period reconciles to within $1 (in-kind included).
- `RESIDUAL` — some period differs by ≥ $1; the report lists per-period residuals
  and flags the committee `OVER-THRESHOLD` if its total |residual| exceeds
  `--threshold` (default **$500**).
- `PENDING-A1` — a flag (co-occurs with either state above): the committee has
  contributions dated after its last filed period end, awaiting the next D-2.
- `TOO-NEW` — no D-2 period reports on file yet.
- Separately, a **coverage-miss** flag marks any period where the committee swore
  money (D-2 > 0) but we hold nothing — a possible coverage gap worth chasing even
  when the dollar residual is under threshold.

**Exit codes** (support future CI gating; not gated on today): `0` clean; `1` a
committee exceeds threshold **or** a coverage-miss was flagged; `2` structural
failure (missing input file, malformed `--pulled`, or a `FiledDocID` that joins to
no filing).

**v2 (not yet built)**: the **IE-committee lane** — receipts typed
`IE Committee Receipt` and `IE Committee Dues Transfer`, which map differently and
carry decades-long D-2 histories — and the **council lane** are deliberately out of
v1 scope. v1 covers elections candidate committees only.
