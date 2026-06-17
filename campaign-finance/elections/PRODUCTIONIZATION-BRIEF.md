# Productionization brief — elections tool embed

Hand this to Claude Code with the repo open. It builds the real multi-page
elections tool against live `election-data.json`. Read alongside
`campaign-finance/elections/BUILD-SPEC.md` (design rationale + locked decisions)
and `IMPLEMENTATION_BRIEF.md` (pipeline). This brief is the execution authority;
BUILD-SPEC is the "why."

## How this runs

Planner-reviewer method, same as the pipeline work. **This brief opens with HALT 1
(investigate + plan, no code).** Do not build until that plan is approved.
Subsequent halts are drafted after each report comes back — do not invent them or
run ahead. Halt-and-report is the default; each build halt is one commit.

## What's being built (in scope)

A single self-contained HTML/JS embed, **parameterized per office**, deployed as
three Squarespace Code Blocks (School Board / City Council / Mayor). It fetches
`election-data.json` from the GitHub raw CDN at runtime (same pattern as the
council embed fetching `council-data.json`).

Per office page:
- **Race browse** — the office's races (School Board: president + 20 districts
  1A–10B; City Council: 50 wards; Mayor: one race), each rendering its candidate
  field.
- **Race view per candidate** — the three money figures shown **separately, never
  summed**: contributions (teal), independent support (sage), independent
  opposition (coral); self-funding split inside contributions; contributor
  drill-down; IE drill-down with the second hop; Illinois Sunshine link.
- **Election Spend** (this office) — subtabs: browse donors (→ who they fund),
  spend by candidate, industry totals, industries by candidate, flag totals.
- **Year/cycle filter** — default **all-time**, narrows to a specific cycle.

## Deferred (NOT this brief — but don't foreclose)

- Cover/meta page + cross-office aggregate ("all Chicago election spend" +
  who's-spending quick-stats). Reserve the root URL for it.
- Per-candidate / per-race **static SEO pre-render**. Not built now, but the
  architecture below must let a future Node build step reuse the exact data +
  render code to emit one crawlable HTML page per candidate (school board first).

## Invariants

1. **Pipeline frozen.** Do not modify `ingest.py`, `ingest_ie.py`,
   `build_rollups.py`, the transforms, or any pipeline file. The two rollups the
   spec mentioned (industry×candidate, flag-per-candidate) are **derived
   client-side** from the data already in `election-data.json` — the dataset is
   small (≈3,093 donors / 7,330 contributions / 312 IEs), so a single-pass index
   computes them instantly. No server-side rollup change, no council-tool risk.
   (If HALT 1 finds a reason client-side derivation is wrong, raise it — don't
   silently edit the pipeline.)
2. **Three-layer architecture (this is what enables the SEO pre-render):**
   - **data layer** — pure functions: load `election-data.json`, build one
     memoized index, derive all view models (per race, per candidate, per spend
     subtab, filtered by cycle). No DOM, no browser globals.
   - **render layer** — pure functions: view model → HTML string. No DOM, no events.
   - **app layer** — thin: fetch, mount, wire events, handle the office param.
     Browser-only.
   The data + render layers must run unchanged in Node, so the future pre-render
   reuses them. Keep candidate and race **slugs stable and URL-safe**.
3. **c3 / nonpartisan.** Equal treatment across the full field; order candidates
   neutrally (alphabetical or ballot order, **never by amount** — no leaderboard
   within a race). For/against is the spender's own characterization. Self-funding
   shown distinctly so it never reads as community support. No scoring, ranking, or
   language implying how a candidate would act. Correlation, not causation, not
   endorsement.
4. **Partial-field honesty.** Render whatever candidates/races are loaded; mark
   fields still-populating; show uncategorized donors as uncategorized (not folded
   into a category). Today only School Board has mapped committees (9 candidates);
   City Council and Mayor pages render mostly "coming soon" — that's correct.
5. **Performance.** Build the index once, single pass (the council tool's
   Compare-by-Donor regressed to ~27s from an O(donors×contributions) nested scan;
   the memoized single-pass index fixed it to ~200ms). Browse-donors and the
   cross-tabs must use the index, not nested scans.
6. **Validation.** `node --check` the script; render against the real
   `election-data.json` and smoke-test each view before calling a halt done.

## Data contract (read from election-data.json)

- `races[]`: `{id, election_id, office, district|ward, geo_key, label, status}`.
- `candidates[]`: `{id, race_id, name, committee_id, status, incumbent, bio,
  positions:null}`. `committee_id` joins to finance; null = registered, no finance.
- `committees{}`: includes `sbe_committee_id`, `industry_tags`, `candidate_id`,
  `race_id`, `office`. **Illinois Sunshine link** =
  `https://illinoissunshine.org/committees/<sbe_committee_id>/` — reuse the council
  embed's exact construction; verify one school-board id resolves in HALT 1.
- `contributions[]`: `{donor_id, committee_id, amount, date, cycle,
  contribution_type, ...}`. **Self-funded** = loan rows + contributions from the
  candidate themselves; **third-party** = direct − self-funded. Confirm the exact
  markers against real data in HALT 1 (loans were tagged on ingest; Leon's 6
  self-rows vs his $378 third-party row are the test case).
- `independent_expenditures[]`: `{spender_committee_id, target_candidate_id,
  target_race_id, target_ward, stance, amount, cycle, match_method, needs_review,
  ...}`. **Second hop** = the spender's own funders are the `contributions` rows
  where `committee_id` == that spender (types `IE Committee Receipt` /
  `IE Committee Dues Transfer`). The IE drill-down **leads with who funds the
  spender**, because committee names are placeholders and the funders identify them
  (e.g., "funded primarily by Illinois REALTORS"). Exclude `IE Committee Dues
  Transfer` from spend totals (already typed).
- `donors{}`: `{name, type, industries[], flags[], parent_id, cluster_id?,
  cluster_name?, ...}`. Roll up by `parent_id` for browse-donors and contributor
  drill-down. Industry/flag cross-tabs derive from `industries`/`flags`.
- `rollups`: `by_parent / by_industry / by_alder / by_candidate / by_race`, each
  with `by_cycle`. Use as a cross-check; the embed derives its own view models from
  the raw arrays so the year filter and the two extra cross-tabs work uniformly.
- `cycle` on contributions/IEs drives the year filter. Distinguish the
  election-year selection from the SBE 4-year `cycle` bucket — confirm in HALT 1
  which field the filter should key on for "this election" vs "this cycle."

## Design

Election variant of the council system: cream `#F6EFE9`, ink `#342828`, tan
`#EBDAC6`, teal `#044127`, sage `#508F88`, **coral `#B0553A` for opposition**.
Recoleta (display) / Poppins (body) — **use the council embed's real Recoleta
source**, not the prototype's Fraunces stand-in. The approved prototype
(`elections-embed-prototype.html`, the single-race + spend view) is the visual
reference for the race view, self-funding hatch, and for/against treatment.

## Deploy

Three Squarespace **Code Blocks** (inline, never iframe — iframe content doesn't
count for the page's SEO). Same HTML/JS on each; the office is set per embed (e.g.
a single `const OFFICE = 'school_board' | 'city_council' | 'mayor'` or a data
attribute the app layer reads). Each Squarespace page gets its own title/H1/meta.

## HALT 1 — investigate + plan (NO code, read-only)

Read BUILD-SPEC.md, this brief, and the live `campaign-finance/election-data.json`.
Then report:

1. **Data contract confirmation against real data:** the exact field(s) marking
   self-funding / candidate-self contributions (validate on Leon: ~$620,025 self vs
   $378 third-party); that each IE's spender funders are reachable as contributions
   on the spender committee (second hop); that
   `illinoissunshine.org/committees/<sbe_committee_id>/` resolves for a real
   school-board committee; which `cycle`/`election_id` field the year filter keys on.
2. **Architecture plan:** the three-layer split (pure data / pure render / thin
   app), the file/module layout, the office-param mechanism, the single memoized
   index, how the year filter recomputes view models, and confirmation that
   industry×candidate + flag-per-candidate derive cleanly client-side (or a reasoned
   case if not).
3. **SEO-readiness:** confirm the data + render layers will run in Node unchanged
   (no browser globals), and the slug scheme for candidates/races.
4. **Proposed build-halt breakdown** for my review — where you'd put the
   boundaries (e.g., data+render core → race view → IE/contributor drill-downs →
   Election Spend subtabs → office parameterization + deploy), each one commit.

Then STOP. Do not write the embed. Wait for approval, after which I'll authorize
the build halts one at a time.

Constraints: read-only this halt; one terminal command at a time; `REPO` exported.
```
