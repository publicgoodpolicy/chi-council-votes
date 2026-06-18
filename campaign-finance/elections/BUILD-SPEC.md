# Elections tool — build spec

The canonical "what and why" for the IPG Elections tool. Locks the architecture
decisions and the forward-looking requirements so the broader build doesn't lose
them. Companion to IMPLEMENTATION_BRIEF.md (which covers the data pipeline).

## Status

- v1 scope: **who's running** (factual bio) + **who funds them** (contributions,
  independent support/opposition, partial c4/advertising layer). "What they stand
  for" is v2; the schema reserves a `positions` slot.
- Pipeline: complete and verified end-to-end on real data (9 school-board
  committees ingested; IE for/against resolving; shared donor classification +
  clusters behaving across the master Sheet).
- Design: prototype approved (election variant of the council design system; the
  self-funding split, for/against framing, and drill-down patterns are signed off).
- Now building: the real multi-page tool against live `election-data.json`.

## Information architecture

Three office pages plus a cover page. **One codebase, parameterized per office**
(a config selecting the office) — not three separate tools. Same
`election-data.json`. Embed via Squarespace **Code Block (inline)**, never an
iframe (iframe content does not count toward the page's SEO).

```
/  (cover / meta)   aggregate Chicago election spend + "who's spending" summary
                    + entry to the three office tools
/school-board       Board President + 20 districts (1A–10B) + School Board spend
/city-council       50 wards + City Council spend
/mayor              Mayor + Mayor spend
```

Rationale: a live election is searched by office and by candidate name, and most
crawlers don't run client-side JS well. Three distinct URLs with their own
titles/H1/meta target how people actually search; a single client-rendered page
would hide all content behind one URL.

## Per-office Election Spend (subtabs)

On each office page, mirroring the council tool's Political Spend tab, scoped to
that office:
- **Browse donors** — ranked by total; click a donor to see who they fund (`by_parent`).
- **Spend by candidate** — `by_candidate`.
- **Industry totals** — `by_industry`.
- **Industries by candidate** — industry × candidate cross-tab (may need a
  `build_rollups` addition; confirm against the data).
- **Flag totals** — aggregated donor flags (may need a `build_rollups` addition).

The **cross-office aggregate** ("all Chicago election spend" + "who's spending"
quick-stats/graphics) lives on the **cover page**, not per office. Deferred build,
but the IA reserves the root for it.

**Deferred — cover-page "biggest spenders" ranking.** A leaderboard of the largest
money-movers across **all** Chicago elections (school board + municipal), aggregated
by `parent_id` and ranked by **total money moved** — combining a parent's direct
contributions to candidates AND its funding of IE committees (the donor-footprint
total the embed already computes). Threshold around **$1M+**. Mix unions, IE PACs,
corporations, and individuals in one ranking; each row links into that donor's
footprint modal (reuse the B3 footprint). This is the cover-page counterpart to the
per-office "Election spend" tab — cross-office, parent-aggregated, deferred with the
rest of the cover page (do not foreclose: the data layer's `donorFootprint` /
parent rollups already support it).

## Multi-cycle / year filtering (first-class, build-in-now)

The tool must hold many election cycles over time and filter by year/cycle. The
data model already carries this dimension:
- `elections[]` — each cycle is an entry (2026 school board, 2027 municipal,
  future 2028/2030…).
- races carry `election_id`; contributions are cycle-stamped; `build_rollups`
  emits `by_cycle` breakdowns.

So the year filter is UI on an existing dimension, not a schema change. Two notes:
- Distinguish the **election-year filter** (which election a candidate is running
  in) from the SBE **4-year cycle** bucket used for giving history — the filter
  scopes by election/year, not the coarse SBE cycle.
- **DECIDED:** election pages default to the full committee money on file; the
  year/cycle filter narrows to a specific cycle. (Committees carry money across
  past runs — e.g., DeBerry's and Leon's current totals are largely from their
  2024 race — so the unfiltered total is the default and the filter scopes down.)
  **Default label = "All years"**: the data already spans 4 SBE cycles
  (2015/2019/2023/2027 — funder receipts + prior committee money), so the
  unfiltered default genuinely shows all-time money; "All years" is the honest
  label (an earlier "current cycle" label was dropped — it read as a single year
  next to the per-cycle chips). Label only — the data scope and filter mechanism
  are unchanged.

## Per-candidate SEO pre-render (deferred, committed — do not forget)

The high-value SEO unlock: an indexable page per candidate (and per race) so
"[candidate] campaign finance" searches land here. School-board candidates first.
A client-rendered embed can't produce this; it needs a static pre-render step that
reads `election-data.json` and emits crawlable HTML per candidate/race with the
name in `<title>`/H1, hosted crawlably (static files + sitemap).

**Preserve the door now, build later.** Two architectural constraints the
productionization must honor so the pre-render reuses, not reimplements:
1. Render functions are **pure data → HTML string**, separable from event/DOM
   wiring, so the same functions run at build time to emit static pages.
2. Candidate and race **slugs are stable and URL-safe** (e.g.
   `bruce-leon-district-2a`), suitable as page paths.

## Feature set (approved in prototype)

- Race view: three money figures shown **separately, never summed** —
  contributions (teal), independent support (sage), independent opposition (coral).
- **Self-funding split**: within contributions, candidate self-funding/loans
  (derived from `is_loan`) rendered distinctly from third-party money.
- **Contributor drill-down**: click contributions → rolled-up donor list (`by_parent`).
- **IE drill-down**: click independent support/opposition → the spender
  committees, and the **second hop** (who funds those committees).
- **Illinois Sunshine link** per committee: `illinoissunshine.org/committees/<SBE
  committee_id>/` — reuse the council embed's proven link construction.
- **Partial-field honesty**: races render whoever is loaded and mark the field as
  still-populating; uncategorized donors shown as uncategorized.

## Design

Election variant of the council system: cream `#F6EFE9`, ink `#342828`, tan
`#EBDAC6`, teal `#044127`, sage `#508F88`, Recoleta (display) / Poppins (body),
plus **coral `#B0553A` for opposition** — the one color the accountability tool
doesn't need. The per-candidate money composition is the signature element.

## Editorial / c3 invariants

Nonpartisan, equal treatment across the full field; no scoring or ranking of
candidates. Correlation, not causation — and not endorsement. For/against shown as
the spender's own characterization from the filing. Self-funding shown distinctly
so it never reads as community support. Funding disclosure is not a claim about how
a candidate would act in office.

## Data foundation

`election-data.json` from the pipeline: candidates joined to committees via
`race-map.json` mappings; donor classification and clusters shared with the
council tool through the master Sheet and the shared `ingest.slug` donor_id.

## Build sequence

0. Read-only diagnostic dump (ranked donors, IE spenders + their funders,
   industry/flag rollup availability) — feeds the real Election Spend + drill-downs.
1. Productionization brief → Claude Code: multi-page tool wired to
   `election-data.json`, Sunshine links, both drill-downs, per-office spend
   subtabs, year filter, pure-render structure for future pre-render.
2. Deferred: cover page + cross-office aggregate; per-candidate static pre-render
   (school board first); additional cycles as 2027 municipal data lands.
