# Elections tool — data foundation

This folder seeds the IPG **Elections tool**, a companion to the Alder Voting
History tool. Same pipeline, same donor universe, different artifact and
different (election-time, c3-strict) editorial posture.

v1 scope: **who is running** (factual bios) and **who funds them** (direct
contributions + independent support/opposition + a labelled, partial c4/
advertising layer). "What they stand for" is deferred to v2; the schema reserves
a `positions` slot for it so nothing has to be re-architected.

## `election-data.json` schema

One new editorial layer sits on top of the **unchanged** council finance keys.

```jsonc
{
  "elections": [
    { "id": "2026-school-board", "label": "...", "date": "2026-11-03", "runoff_date": null }
  ],
  "races": [
    { "id": "sb-d12", "election_id": "2026-school-board",
      "office": "school_board_member", "district": "District 6b",
      "label": "School Board, District 6b",
      "geo_key": 12,                // joins to DISTRICT (school) / ward (council) in the geojson
      "geo_source": "schoolboard.geojson",
      "status": "forming | filed | certified" }
  ],
  "candidates": [
    { "id": "rivera-sb-d12", "race_id": "sb-d12", "name": "...",
      "committee_id": "<SBE id>",   // the single join into the finance layer
      "status": "declared | filed | certified | withdrawn | disqualified",
      "incumbent": true,
      "bio": { "occupation": "...", "neighborhood": "...",
               "current_roles": [...], "links": {} },
      "positions": null }           // reserved for v2
  ],

  // --- reused, unchanged from the council pipeline ---
  "committees": [...],
  "donors": [...],
  "contributions": [...],
  "independent_expenditures": [...],
  "rollups": {...},
  "industry_tags": [...]
}
```

`race.status` and `candidate.status` drive the phased rollout inside the one
unified tool: a `forming` race renders its declared candidates with a "field not
final" note, then flips to `filed` after the Oct 19–26 2026 filing window and to
`certified` once objections clear in early November. Same code, data-driven.

## How the donor work feeds BOTH tools (no re-classification)

`donor_id` is a deterministic slug of the contributor name. All classification —
overrides, clusters, merges, industry tags — lives in the master Sheet keyed to
`donor_id`. So classification is a property of the donor, not the tool. To keep
it shared for free:

1. **Ingest election finance with the same `ingest.py` / `ingest_ie.py`.** Same
   slug → identical `donor_id`s across both artifacts.
2. **Apply classification with the same `sync_overrides.py` against the same
   Sheet.** It writes into `election-data.json` exactly as it does for
   `council-data.json`.
3. **Run `export_classification_worklist.py` over the union of both files**
   (dedup by `donor_id`) so the worklist and classified-% stay honest as the
   election tool pulls in new donors.

Net effect: a donor you classify today for the alder tool is already classified
in the elections tool the moment they appear in a candidate or IE committee, and
any new election-only donor you classify flows back to the alder tool too.

Do **not** add a classification step to the election build. The seed script
delegates ingestion to the existing modules precisely so the slug — and thus the
shared classification — is never duplicated or re-derived.

## Run order

The election build reuses the council pipeline, with one ordering difference (the
governing rule below). Export `$REPO`; paths are relative to the repo root.

```
0.  cp ../ipg-rep-finder/{schoolboard,wards}.geojson campaign-finance/elections/   # boundary reuse
0b. seed_incumbents.py ../ipg-rep-finder/index.html   # one-time / on roster refresh: 70 incumbent stubs
1.  build_election_seed.py                                   # seed: races/candidates + dict-shaped
                                                            #   finance keys + a cycles block
2.  ingest.py    --data-file campaign-finance/election-data.json --raw-dir raw/receipts-elections
                                                            # direct contributions; donors have no parent_id yet
3.  transform_slice1.py  campaign-finance/election-data.json # parent_id on ALL donors
4.  transform_slice2.py  campaign-finance/election-data.json # committee registry (election-aware guard)
5.  ingest_ie.py --council campaign-finance/election-data.json \
        --expenditures <SBE Expenditures> --receipts <SBE Receipts> \
        --out campaign-finance/election-data.json            # IE layer; internal build_rollups now safe
5b. enrich_committee_names.py --council campaign-finance/election-data.json \
        --committees reference/ie-committee-names.tsv --out campaign-finance/election-data.json
                                                            # resolve IE spender ids -> real names
                                                            #   (ingest_ie only knows the id). Same step
                                                            #   council runs. reference/ie-committee-names.tsv
                                                            #   holds all 15 (12 from council-data.json + 3
                                                            #   pulled from Illinois Sunshine); or pass the
                                                            #   full SBE Committees.txt when refreshing.
6.  sync_overrides.py    --data-file campaign-finance/election-data.json \
        --sheet-id <ID> --creds-file <path>                  # shared classification + clusters
                                                            #   + IE-committee industry tags
7.  build_rollups.py     campaign-finance/election-data.json # LAST: rollups reflect the synced
                                                            #   tags/classifications (see below)
8.  validate_council_data.py  campaign-finance/election-data.json   # shared gate (positional arg)
```

**Governing rule — why slice1/slice2 come before `ingest_ie`.** `build_rollups`,
*including the copy `ingest_ie` runs at its end*, must never run while any donor
lacks `parent_id`. `transform_slice1` (step 3) guarantees that, so it sits before
`ingest_ie` here. This is the one difference from the council chain (ordering
authority: `campaign-finance/MECHANISM_REFERENCE.md` §1), where slice1/slice2 run
*after* a prior full build has already assigned `parent_id`.

**`build_rollups` runs LAST, after `sync_overrides`** (per the ordering authority,
`MECHANISM_REFERENCE.md` §1). Only then do the rollups reflect the Sheet: `by_industry`'s
`independent`/IE layer is keyed off the IE committees' `industry_tags` (set by
`sync_overrides`), and `by_*` direct totals reflect the synced donor classifications.
A `build_rollups` run *before* `sync_overrides` produces a rollup with an empty IE/
industry layer and pre-Sheet classification counts — so the step-5 internal
`build_rollups` is intermediate only and is overwritten by step 7. (`sync_overrides`
sets `parent_id` on clustered donors directly, so no slice1 re-run is needed.)

**Regen chain for a seed-only change (no finance re-ingest).** When only the seed
layer changes (e.g. a candidate display-name fix) and the diff against the committed
artifact must stay clean, run `build_election_seed → transform_slice1 →
transform_slice2 → build_rollups` (step 7). `build_rollups` is required, not optional:
`transform_slice1`'s `[8] by_parent` is a lean intermediate (no `committees`/`members`
fields, no IE `independent`) that `build_rollups` overwrites with the canonical
rollup. Stopping after slice1/slice2 leaves that intermediate in place and produces a
spurious ~6.5k-line `by_parent` diff that is not real drift.

- **`transform_slice1`** self-parents donors on election data (no clusters →
  `parent_id = id` for every donor) and tolerates a zero-contribution seed.
- **`transform_slice2`** carries an election-aware guard: no 50-candidate floor for
  election artifacts, while the bridge-integrity check is preserved in both modes.
- **`validate_council_data.py`** takes the data file as a **positional** argument;
  its cluster-integrity logic is not council-specific, so one validator gates both
  artifacts.

## Reused from ipg-rep-finder (no rebuild needed)

- `schoolboard.geojson` (DISTRICT 1–20, the 1a–10b subdistricts) and
  `wards.geojson` (ward 1–50, 2023 redistricting). Drop both into this folder;
  `build_election_seed.py` reads their properties to label the school/ward races
  and set each race's `geo_key`. Note: per the rep-finder README, CPS may
  republish school boundaries for the fully-elected 2026 map — confirm labels
  against the certified ballot before launch.
- The point-in-polygon resolver in the rep-finder `index.html` (`containsLocation`
  with the DISTRICT/ward property fallback) lifts straight over to power an
  address → `race_id` lookup, matching on the same `geo_key`. That's the "find
  the races on your ballot" entry point.
- `REPS.ward` (50 sitting alders) and `REPS.school` (current board) supply
  incumbent names/contact. `seed_incumbents.py` parses them out of the rep-finder
  `index.html` and writes 70 entries into the `incumbent_stubs` block of
  `race-map.json` — each with `committee_id: null` and `status:
  "incumbent-pending"`. They are current officeholders, not declared or filed
  candidates (we have no declaration data), so `incumbent-pending` is used rather
  than `declared` to avoid implying either a declaration or a filing; rename it
  if you prefer different wording. School subdistricts map `1a–10b` → `DISTRICT`
  `1–20`, matching the geojson and the `sb-d01…sb-d20` race ids.

## Files here

- `race-map.json` — the candidate registry, in two parts:
  `mappings` (committee_id → confirmed candidate, the `ward-map.json` analog and
  the finance join) and `incumbent_stubs` (candidate_id → current officeholder,
  `committee_id` null). Hand-maintain `mappings` as you identify each candidate's
  SBE committee; when a sitting incumbent files, move them from a stub into
  `mappings` under their real committee_id and the build skips the stub. Remove
  the `_EXAMPLE_*` rows before a real run.
- `seed_incumbents.py` — regenerates `incumbent_stubs` from the rep-finder
  `index.html`. Idempotent; re-run after any roster change. Leaves `mappings`
  untouched.
- `build_election_seed.py` — assembles the candidate/race layer from both
  `mappings` and `incumbent_stubs`; derives race labels + `geo_key` from the
  geojson; prints a verification summary; safe to re-run (preserves ingested
  finance).
