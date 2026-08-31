# Pipeline runbook — operator procedures for both ingestion families

How to refresh, verify, and publish this repo's data. Written for "future me."

**Two ingestion families, one document.** **Dollars** come from SBE bulk exports;
**votes** come from DataMade's Councilmatic Datasette. They share the derived layers,
the editorial Sheet, and the validation gate, so they share a runbook.

**Ordering authority of record: `campaign-finance/MECHANISM_REFERENCE.md` §1** (PS-25/PS-44).
This document holds the **operational sequence with its flags**; the reference holds the
*requirements* behind the order — which dependencies make it load-bearing and what breaks
when it is violated. Citation is **one-way**: this runbook cites the reference; the reference
never cites this runbook (PS-47). If the two ever disagree, **the reference wins**, and the
disagreement is a defect fixed in the same commit as whatever caused it (discipline 33).

---

## The one orchestrator

**`campaign-finance/build_all.sh` is the repo's only shell orchestrator and the sole
end-to-end builder of the votes pipeline.** There is **no CI** — no workflow files exist. It
runs on a human's machine, by hand, because the vote source blocks datacenter IPs (below).

```
bash campaign-finance/build_all.sh
```

It pulls, syncs the roster, fetches votes, syncs the All Votes tab, **optionally** ingests
staged finance receipts, rebuilds the derived layers, and ends in a hard validation gate. It
does **not** commit — it prints the commands and stops, on purpose.

> **Historical note, so old lane records do not mislead.** A nightly GitHub Action — its
> workflow file named sync-council-data.yml, deliberately un-backticked here because **no such
> file exists** — once ran this. It was **retired**: datacenter
> IPs are blocked by the vote source, and its commits collided with manual pushes.
> `build_all.sh` replaced it. Any instruction to "run the workflow" is obsolete.

### What is *not* in `build_all.sh`, by design

`convert_bulk_receipts`, `repair_clusters`, `ingest_ie`, and `enrich_committee_names` are
omitted — they need the multi-gigabyte SBE bulk files and run quarterly. The script conforms
to the reference's chain block with exactly those omissions.

---

## Refreshing votes

Votes change only when the Council actually votes, so a manual run after meeting days is
enough. `build_all.sh` covers the whole path; run it and stop at the gate.

**The source** is DataMade's Councilmatic Datasette (`puddle.datamade.us`). **It blocks
datacenter IPs** — that is the bot wall, and it is the reason there is no CI. A residential
IP clears it. If the fetch fails at `SELECT 1` with HTTP 403 or a timeout, that is the wall,
not a code fault.

> **The 403 belongs to the VOTES source only.** It has been mis-attributed to the SBE /
> `elections.il.gov` side; that is wrong, and the dollars section below states what is
> actually true there.

**Positions are single-source (PS-99).** Every published vote position comes from the vote
ingest. **Hand-entry is retired** — no position enters the artifact by hand, and content that
existed only by hand-entry was removed rather than legitimized. A vote absent from the ingest
source is **absent from the tool** until the source carries it.

- Featured votes are defined by the **All Votes tab**: check `featured`, give it a `code`.
  `votemeta` is rebuilt from that set every run, so un-checking removes a vote.
- The `tag` column on any row attaches to that rollcall vote, featured or not.
- **`reverse_coded` is retired.** Positions are written exactly as the position map yields
  them; the semantic-inversion path is gone, and the column leaves the All Votes tab on the
  next sync.
- **Enforcement:** `validate_votes` (VOTES-1..8) fails the build if any per-alder vote code
  resolves to no `votemeta` entry. There is **no hand-entered exemption**, because under
  PS-99 no hand-entered class exists.

**Where positions actually live, because the obvious guess is wrong:** the embed reads
`rollcall.votes[].positions`, joined through `votemeta.vote_id`. **`alders[].votes` is read by
no surface.** Do not reason about what readers see from that map.

**Caucuses** are not in the feed — edit `caucuses.json` by hand from public rosters. The sync
never touches it.

**Roster changes** (appointment / election): re-run `probe_memberships.py` to refresh the
crosswalk and surface succession edge cases.

**Backfill** to earlier terms: run the sync per historical session (`--term 2019`, etc.).

---

## Refreshing dollars

### Preconditions — check these before starting

1. **A fresh, same-pull set of four SBE bulk files**: Receipts, Expenditures, `D2Totals`,
   `FiledDocs`. Pull them after the quarterly deadlines — the 16th–20th of Jan / Apr / Jul /
   Oct. **Never mix files across pulls in one rebuild** (see the archival rule at the end).
2. **`raw/` is expected to be present and empty between refreshes.** It is gitignored and holds
   only the staged pull. `build_all.sh` skips the finance ingest when it is empty — that is the
   safe default, not a failure. The directories themselves stay in place: `check_docs` rule 3
   resolves every documented path, so removing `raw/receipts-council/` reddens the gate.
3. Staged council CSVs go in **`raw/receipts-council/`**, not `raw/receipts/` — the latter
   holds the bulk `.txt` that `ingest_ie` needs, and globbing both breaks `ingest`'s column
   check.

### The pull is manual, and *why* matters

The SBE download page is reachable and **does not block scripted access** — a single request
with an honest user-agent from a local machine is admitted, HTTP 200 [SOURCED — the REFRESH-1
G2 probe]. **The pull is manual because no downloader was ever built, not because one is
blocked.** Two facts shape any future downloader:

- There is **no static bulk-file URL**. The page is an ASP.NET postback: a client must GET the
  page, parse `__VIEWSTATE` / `__EVENTVALIDATION`, and POST the chosen filename.
- Cloudflare bot management fronts the site. The local case was admitted; the
  **datacenter-origin case is untested** and must not be inferred from the local result.

### Traps, and the check that catches each

The order in the chain below is load-bearing. These are the ways it has actually broken:

| trap | what happens | what catches it |
|---|---|---|
| `sync_overrides` runs **before** `ingest` | ingest's donor-union clears the Sheet-only fields and nothing restores them | **P3**, fail-loud at sync time |
| a chain runs **without** `sync_overrides` | same loss; dollar-invisible, so no reconcile or diff can see it | **P3** |
| `ingest_ie` run by hand **after** `build_all.sh` | shards were built before it, so they miss IE and dues data | **`validate_council_data --shards`** (stamp + totals). Remedy: pass `ingest_ie --shards`, or re-run `build_all.sh` |
| `transform_slice1` skipped before `ingest_ie` | its internal rollup runs with donors lacking `parent_id` | order only — run the chain as written |
| `repair_clusters` skipped after a re-ingest | cluster blocks point at absent members | the validator's cluster family |
| a Donor Merges row is added | the mechanism is **deprecated (PS-97)** and destructive | the sync **stops** on any row |
| a legacy vote code reappears | vocabularies fork silently, as they did before | **VOTES-5** |
| shards published stale | readers get an older dataset than the monolith | **`--shards`**, wired into the gate |

**A re-ingest does NOT strip the IE layer.** `ingest.py` never touches
`independent_expenditures`, and its contribution replacement is per-committee, so IE rows are
never in the removed set. Earlier records said otherwise; they were wrong.

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
**SBE bulk exports are Windows-1252 (cp1252) encoded.** The correct read depends
on what fields you consume: **name-bearing reads must use `cp1252`** — latin-1
mis-decodes the `0x80-0x9F` range (e.g. `0x92`, the smart apostrophe in
`O'Connor`, becomes a control char and corrupts the donor name). **latin-1 is
acceptable only for ASCII-content fields**: `reconcile.py` reads `D2Totals` /
`FiledDocs` as latin-1 because the fields it consumes (ids, dates, DocNames,
amounts) are ASCII, so the distinction never bites there. cp1252 has five
unmapped bytes (`0x81, 0x8D, 0x8F, 0x90, 0x9D`) that crash a strict decode;
`convert_bulk_receipts.py` pre-scans for them and fails loudly rather than
silently corrupt (see the council-migration section).

**`--pulled` is required** (`YYYY-MM-DD`): the date you pulled the bulk files. It
is embedded in the report as the "data current as of" stamp the methodology page
publishes — never omit or fudge it.

**How it works**: FiledDocs gives each committee's D-2 period reports (DocName ∈
Quarterly / Semiannual / Pre-election / Annual / Final), resolved to a final set in
two passes: (1) **exact-tuple amendment dedupe** — same `(RptPdBegDate,
RptPdEndDate)`, keep the latest `RcvdDateTime`; (2) **overlap-supersede** — a
later-received filing whose period window overlaps an earlier-received one
supersedes it. Pass 2 exists because SBE provides no amendment-linkage column, and
a later-received overlapping filing has been observed to carry the corrected
Schedule A substance while the superseded original retains none (e.g. a full-quarter
report replaced by a narrower re-file). Overlap-superseded filings are disclosed
per committee in the report (`overlap_superseded`, with the superseding filing and
the sworn amount removed). D2Totals supplies the sworn itemized total
(`IndivContribI + XferInI + LoanRcvI + OtherRctI`) per filing, joined by
`FiledDocID`. Our side sums contributions typed Individual Contribution / Transfer
In / Loan Received / Other Receipt dated inside each period; in-kind is compared
separately, `Aggregate` is totalled separately.

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
committee exceeds threshold **or** a coverage-miss was flagged **or** a known-gaps
annotation is stale; `2` structural failure (missing input file, malformed
`--pulled`, or a `FiledDocID` that joins to no filing).

**Known-gaps ledger (`elections/known-gaps.json`, public by design).** Some
residuals are SBE-side: a committee's sworn D-2 cover total exceeds its own filed
Schedule A itemization, so no ingest or source change can close them. Pass
`--known-gaps` and reconcile matches each flag against the ledger on
`(committee, period, residual-to-the-cent)`; a match becomes the `DISCLOSED` state,
excluded from the exit-code triggers and listed distinctly. **Lifecycle:**
*discovery* — the monthly reconcile run flags a period (a previously-RECONCILED
committee can start flagging); *investigation* — the falsification ladder: is the
row in raw? → ingest lane; filed after our pull? → re-pull; sworn with no Schedule A
rows in any SBE source? → SBE-side; *annotation* — an **editorial act requiring the
SBE-side verdict plus evidence**, never a way to silence an undiagnosed flag. Match
is exact to the cent, so any drift re-fires the flag; a ledger entry that matches no
current flag is **stale** and fails loudly (exit 1) — annotations may never silently
absorb drift. There is no auto-annotate path by design.

**v2 (not yet built)**: the **IE-committee lane** — receipts typed
`IE Committee Receipt` and `IE Committee Dues Transfer`, which map differently and
carry decades-long D-2 histories — and the **council lane** are deliberately out of
v1 scope. v1 covers elections candidate committees only.

---

## Council contribution source: SBE bulk migration (`convert_bulk_receipts.py`)

Council contributions are sourced from the **SBE bulk Receipts export**, not the
old per-committee CSVs (which are unrecoverable). `convert_bulk_receipts.py`
converts the bulk into per-committee CSVs that `ingest.py` consumes unchanged.

**Ruled scope** (what a committee's contribution set is): rows attached (by
`FiledDocID`) to its **final D-2 filings** — the five period DocNames, exact-tuple
amendment dedupe then overlap-supersede (`reconcile.build_filing_registry`) —
**plus** rows on **A-1 filings dated after the committee's last final-period end**
(the pending tail). There are **no** row-level `(date, amount, name)` keys; that
naive method over-counts amendments by ~$1.43M.

**Output goes to `raw/receipts-council/`**, NOT `raw/receipts/` — the latter holds
the bulk `.txt` that `ingest_ie` still needs, and globbing both would fail
`ingest`'s `REQUIRED_COLUMNS`. `ingest` then runs with `--raw-dir raw/receipts-council/`.

**Encoding**: the converter reads the bulk as `cp1252` (name-bearing) after a
byte pre-scan for the five cp1252-unmapped values — a future pull carrying one
fails loudly instead of corrupting a name. See the reconcile encoding note above.

### The canonical council rebuild chain (order is load-bearing)

**Ordering authority of record: `campaign-finance/MECHANISM_REFERENCE.md` §1** (PS-25/PS-44).
This section is the operational sequence — run these commands in this order. The
*requirements* behind the order — which dependencies make it load-bearing and what breaks
when it is violated — live in the reference, which governs. If this section and the
reference ever disagree, the reference wins and the disagreement is a defect, fixed in
the same commit as whatever change caused it (discipline 33).

```
convert_bulk_receipts.py  --bulk <receipts.txt> --fileddocs <FiledDocs.txt> \
                          --committee-map council-data.json --out-dir raw/receipts-council
ingest.py                 --raw-dir raw/receipts-council --ward-map ward-map.json --data-file council-data.json
repair_clusters.py        council-data.json      # absent-member churn from re-ingest
transform_slice1.py       council-data.json      # parent_id on ALL donors — MUST precede ingest_ie
transform_slice2.py       council-data.json
ingest_ie.py              --council … (re-applies the IE layer, which the direct re-ingest strips)
enrich_committee_names.py --council …
sync_overrides.py         --data-file council-data.json …   # clusters re-apply from the Sheet
build_rollups.py          council-data.json      # rollups LAST — after overrides
build_shards.py           council-data.json campaign-finance/shards
validate_council_data.py  council-data.json      # hard-fail guard, 0/0
```

Notes: `transform_slice1` must precede `ingest_ie` (its internal `build_rollups`
reads `parent_id` on every donor); `repair_clusters` must precede `slice1` (a
re-ingest can orphan a cluster's parent donor). `ward-map.json` must map **every**
council committee's SBE id → ward (council-mode `ingest` matches by ward), or an
unmapped committee hits an interactive prompt. `build_rollups` / `build_shards`
run last because cluster membership feeds parent attribution and the shards are
the embed's deploy surface.

### Pull-set archival rule

A council rebuild is pinned to **one dated pull-set of four SBE bulk files**
(Receipts + Expenditures + `D2Totals` + `FiledDocs`), all from the same pull.
Archive them together, dated, in gitignored `raw/` — they are the migration's
source-of-record and the only way to reproduce a given build's vintage. Never
mix files across pulls in one rebuild.

**`raw/` is expected present and empty between refreshes** — it holds only the staged pull, and
`build_all.sh` skips the finance ingest when it is empty. Archive the pull-set somewhere
durable *outside* `raw/` once a rebuild lands, because the next refresh's staging will not
preserve it. **Known gap, stated rather than discovered later:** the sealed archives on the
operator's machine today are split across two pull dates, so no single same-pull four-file
set exists locally — a reproduction from local material would violate this rule.
