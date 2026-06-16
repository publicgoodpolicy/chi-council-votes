# Implementation brief — election-aware finance ingest

Hand this to Claude Code with the repo open. It is the design authority for the
change. Where a genuine fork isn't resolved here, **stop and surface it** rather
than guessing (see "Stop-and-ask forks" at the end).

## Context

You are extending the IPG campaign-finance pipeline so it also produces data for
a new **Elections tool** (Chicago school board Nov 3 2026 + municipal Feb 23
2027), without changing the existing council tool.

- Repo root is `$REPO` (`~/chi-council-votes`). Set it before any run.
- Files to edit: `campaign-finance/ingestion/ingest.py`,
  `campaign-finance/ingestion/ingest_ie.py`,
  `campaign-finance/ingestion/build_rollups.py`.
- New artifact: `campaign-finance/election-data.json` — already produced by
  `campaign-finance/elections/build_election_seed.py`. It has `elections[]`,
  `races[]`, `candidates[]` (each candidate has `committee_id`, `race_id`,
  `incumbent`, `status`, `bio`, `positions:null`) plus empty finance keys
  (`committees`, `donors`, `contributions`, `independent_expenditures`,
  `rollups`, `industry_tags`). Races carry `office`, `ward` or `district`, and a
  `geo_key`. School-board and mayoral races have **no ward**.
- Council artifact: `campaign-finance/council-data.json` — must keep building
  identically after your changes.

## Invariants you must not break

1. **Shared donor IDs.** Every `donor_id` in `election-data.json` must come from
   `ingest.slug()`, the same function that keys `council-data.json`. That is what
   lets one classification in the master Sheet feed both tools. In `ingest_ie.py`,
   `resolve_donor` currently rolls its own slug (`re.sub(...).strip('-')` on a
   pre-normalized name) which **lacks the `[:80]` cap** `ingest.slug` has — for
   long names this yields different IDs and silently breaks classification. Fix:
   `from ingest import slug` and use it.
2. **Council tool unchanged.** `council-data.json` must build with the same shape
   and keys as today. Gate every new behavior so that when the data has no
   `races`/`candidates`, the old code path runs exactly as before.
3. **ingest_ie idempotency.** Keep the step that drops prior `IE Committee*`
   contribution rows before re-adding, and keep `d['independent_expenditures']`
   reassigned (not appended).
4. **Dues-transfer exclusion.** Keep typing internal dues transfers as
   `'IE Committee Dues Transfer'` and excluding them from totals.
5. **Data only, nonpartisan.** You are adding data fields, not editorial
   judgment — no scoring, ranking, or for/against valence beyond the spender's
   own support/oppose flag already in the filing.
6. **Validation.** `ast.parse` each edited file; run each step with `--dry-run`
   before writing; after a real run,
   `python3 campaign-finance/ingestion/validate_council_data.py campaign-finance/election-data.json`
   must pass.

## Change 1 — `ingest.py`: ward-less candidate committees, no interactive prompt

Problem: around lines 627–641, ward is resolved from `ward_map` and otherwise
falls to an interactive `input()` prompt; answering `skip` skips the whole file.
School-board and mayoral committees have no ward, so they cannot be ingested.

Do:
- **Detect election mode**: the loaded data has non-empty `data['races']` and
  `data['candidates']`.
- In election mode, build a linkage map from the data itself: for each candidate
  with a `committee_id`, `linkage[committee_id] = {candidate_id, race_id}` and,
  from the matching race, add `office`, `ward` (may be `None`), `district`.
- In the per-file loop, when in election mode, look up `parsed['committee_id']`
  in the linkage map. If found, ingest with that linkage (ward may be `None`) and
  **do not prompt**. If not found, print a warning and skip — never call
  `input()`. Leave the existing `ward_map` + prompt path untouched for the
  non-election (council) case.
- `merge_into_data(data, parsed, ward)` → add an optional `linkage=None` kwarg.
  When present, write `candidate_id`, `race_id`, `office`, `district` onto the
  committee record and take `ward` from the linkage (nullable). Keep the council
  call site passing `ward` positionally as today. Confirm the committee field
  names match what `merge_into_data` already writes and **extend**, don't replace.
- **Avoid cross-contamination.** `ingest.py` processes everything in
  `raw/receipts/`, which the council tool also uses. Put election receipt files
  in a separate directory (e.g. `raw/receipts-elections/`) and run election
  ingest with `--raw-dir raw/receipts-elections`, so the two tools never feed
  each other's committees.

Verify: `--dry-run` on a single school-board committee file; confirm it reports
the committee with `ward=None` and no prompt fires.

## Change 2 — `ingest_ie.py`: election-aware target resolver

The current `build_matcher`/`match_target` resolve the target only against the
**current 50 alders** (committees with `type=='candidate'` and a non-null ward),
disambiguating by ward number. That matches zero school-board IEs, zero mayoral
IEs, and no council challengers — i.e. exactly the spend the elections tool
exists to show.

**First, inspect the real expenditure columns.** `FIELD_MAP['exp']` maps the
TARGET only via `CandidateName` + `Office` (free text) and the SPENDER via
`CommitteeID`. Confirm against the actual file whether IE expenditure rows carry
any **target** committee identifier (a candidate committee ID / `CandidateID`).
This decides the primary path:

- **If a target committee identifier exists** → deterministic primary: match it
  to a `committee_id` in `election-data.json` `candidates[]` →
  `target_candidate_id` / `target_race_id`. `match_method='committee_id'`.
- **If not** (likely, given the name-based current matcher) → the authority is a
  **controlled name match against the candidate registry** (`candidates[]`, each
  tied to a `committee_id` and a race), NOT the open alder roster. Per race the
  candidate set is small and known, so disambiguate using the race's `office` and
  `district`/`ward`. Unambiguous → trust (`match_method='registry_name'`).
  Ambiguous / low-confidence → still record the best guess but set
  `needs_review=true` (`match_method='name_fallback'`).

Replace `build_matcher`/`match_target`:
- Build a target index from `election-data.json` `candidates`+`races`: a
  committee-id index (if a target committee id exists) and a normalized-name
  index `norm(candidate_name) -> [ {candidate_id, race_id, office, ward,
  district, committee_id} ]` using the existing `norm()`.
- New `match_target(row)` returns a dict: `{target_committee_id,
  target_candidate_id, target_race_id, target_ward (nullable), match_method,
  needs_review}`. Resolution order: committee-id (if available) → controlled-name
  unambiguous → controlled-name ambiguous (flagged). Keep the existing
  support/oppose, archived, and exact-duplicate handling.

IE record shape: replace the ward-only target with `target_committee_id`,
`target_candidate_id`, `target_race_id`, `target_ward` (nullable — only when the
race has one), `match_method`, `needs_review`. Keep `id`, `spender_committee_id`,
`stance`, `amount`, `date`, `cycle`, `source_filing`, `filed_doc_id`, `purpose`.

Slug: `from ingest import slug`; in `resolve_donor`, `donor_id = slug(name)`.
Drop the local variant. Keep the rest of `resolve_donor` (record shape,
`dname_idx`) and keep spender promotion, dues-transfer detection/typing, and the
`build_rollups.build(d)` call at the end.

Verify: `--dry-run` against the real expenditures file; print counts — matched by
`committee_id`, by `registry_name`, flagged `needs_review`, and unmatched.
Spot-check that a school-board IE resolves to a `target_race_id` with
`target_ward=None`.

## Change 3 — `build_rollups.py`: `by_race` / `by_candidate`, stop dropping ward-less money

Problem: `by_alder` only counts contributions to committees with
`type=='candidate'` **and** `ward is not None`, and the IE layer buckets by
`target_ward`. School-board/mayoral money has no ward and is silently dropped.

Do (additive and shape-detecting, so one function serves both artifacts):
- Add `by_candidate` and `by_race` rollups. Direct layer: when a recipient
  committee has a `candidate_id`/`race_id`, add its contributions under
  `by_candidate[candidate_id]` and `by_race[race_id]` using the same
  `direct`/`by_cycle` structure already used elsewhere. Keep the existing
  `by_alder` path for committees that have a ward.
- IE layer: bucket `independent_expenditures` by `target_candidate_id` and
  `target_race_id` with `ie_support`/`ie_oppose`, mirroring the current
  `target_ward` logic. Keep `target_ward` buckets when present.
- Never drop a contribution or IE solely because `ward is None`.
  `EXCLUDED_CYCLES` and the dues-transfer exclusion stay.
- `by_parent`, `by_industry`, `by_alder` remain for the council artifact; just
  add the new buckets when `candidates`/`races` exist.

Verify: after a real election ingest, `by_race`/`by_candidate` are populated for
school-board races; `council-data.json` still produces identical
`by_alder`/`by_parent`/`by_industry`.

## Validation run order (election)

```
export REPO=~/chi-council-votes
# election-data.json already seeded by build_election_seed.py
# download SBE receipts for the target committees into raw/receipts-elections/
python3 campaign-finance/ingestion/ingest.py --data-file campaign-finance/election-data.json --raw-dir raw/receipts-elections --dry-run
python3 campaign-finance/ingestion/ingest.py --data-file campaign-finance/election-data.json --raw-dir raw/receipts-elections
python3 campaign-finance/ingestion/ingest_ie.py --council campaign-finance/election-data.json --expenditures <SBE Expenditures file> --receipts <SBE Receipts file> --out campaign-finance/election-data.json --dry-run
python3 campaign-finance/ingestion/ingest_ie.py --council campaign-finance/election-data.json --expenditures <SBE Expenditures file> --receipts <SBE Receipts file> --out campaign-finance/election-data.json
python3 campaign-finance/ingestion/build_rollups.py campaign-finance/election-data.json
python3 campaign-finance/sheets-sync/sync_overrides.py --data-file campaign-finance/election-data.json --sheet-id <ID> --creds-file <path>
python3 campaign-finance/ingestion/validate_council_data.py campaign-finance/election-data.json
```

Then the regression check that protects the council tool: re-run the normal
council build and confirm `council-data.json`'s rollup keys and shape are
unchanged.

## Stop-and-ask forks (surface to the human; do not guess)

- Expenditure rows carry **no** target committee identifier **and** controlled
  name matching is ambiguous for a large share of rows → report the ambiguous
  rate before tuning any heuristics.
- `validate_council_data.py` rejects `election-data.json` on a cluster/parent
  rule that assumes the council shape → report which check; it may need an
  election-aware mode (separate change).
- `merge_into_data` can't accept `ward=None` without a deeper refactor → report
  the specific assumption rather than forcing it.
- The elections embed turns out to need shards (`build_shards.py`) → confirm
  before wiring `--shards` into `ingest_ie`.
- Donor-slug change alters any existing council `donor_id` → stop; that would
  mean `ingest_ie` was already diverging on council data and needs a careful,
  separately-reviewed migration.
