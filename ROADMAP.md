# ROADMAP — chi-council-votes

Five tools, two cross-cutting requirements, and where each stands. Updated at arc
boundaries only, in the boundary lane's commit; between boundaries this file is dated,
not current. **This file is a map, not an authority: ruling text lives in
`campaign-finance/RULINGS.md`, mechanism in `campaign-finance/MECHANISM_REFERENCE.md`, state in the
current handover — this file wins on nothing.** Last updated: 2026-08-19
(ARC-BOUNDARY-2).

## The five tools

| # | tool | status | mount |
|---|---|---|---|
| 1 | Alder Voting History | live | `/alder-voting-history` |
| 2 | School Board Voting History | live with data, roster, President page, Board Rule attribution, funding methodology | `/school-board-voting-history` |
| 3 | School Board Elections finance | live | `/school-board-elections` |
| 4 | City Council Elections finance | ready: code-enabled, data-empty, methodology ratified, gated; page not created by decision | none |
| 5 | Mayoral Elections finance | ready: code-enabled, data-empty, methodology ratified, identification attested; page not created | none |

## Delivery arcs, by tool

**1 — Alder Voting History.** Live since the alder arcs. Open against it: the roster-tab
design ratified at SBV-BOARD-1 (PS-127, R1a, the D-R2 set) is ratified to carry here and
is not built — two implementations of one design, since the embeds diverge structurally
(open ledger 23); a council render harness is arguably its prerequisite, since the gate
carries zero render checks for this embed, and the harness debt has grown by name — the
dues-disclosure check from ELEC-FIGURE-1 and fixture coverage of the re-expressed
municipal block from ELEC-IDENTITY-1 (open ledger 24); the overflow-band / box-sizing
audit (open ledger 11); the donor click-in modal renders the individual transactions,
on the school-board pattern — inside the editorial firewall: direct receipts only on
per-person surfaces, streams never fused (open ledger 29, entered ARC-BOUNDARY-2); alder
attendance, from the same source the Sheet's council votes are pulled from (open ledger
30, entered ARC-BOUNDARY-2).

**2 — School Board Voting History.** Data port SBV-PORT-1; board surfaces SBV-BOARD-1
(closing report sha `c678f60e…`, of record in handover rev S's manifest). Calendar
context: the November 2026 school-board elections seat a new board in January 2027 — the
roster changes on seating, which is what makes the time-dimensioned roster and
attendance work matter on a schedule. Open against it: the attendance dataset lane (open
ledger 18, ratified behind the council/mayoral data arcs); the time-dimensioned roster
(open ledger 19); the dead per-member vote payload (open ledger 22); the SBV-BOARD-1
mechanism-claims facet of open ledger 20 (ratified deferral, in the current hygiene
lane).

**3 — School Board Elections finance.** Live and stable. Open against it: the IE ingest
arc (open ledger 10 — donor→IE edge, click-ins, funder clustering, the Walton un-merge;
the dues surface goes live automatically when its funder join lands); the known-gaps
class field (open ledger 12); the silent-fallback window loads in the finance builder
(open ledger 5).

**4 and 5 — City Council and Mayoral Elections finance.** PS-105 governs delivery in
three arcs: code enablement (done), council data, mayoral data — the data arcs
calendar-gated on 2027 filings reaching SBE by dates, never the cycle label, ~Q4 2026 at
the earliest to be meaningful. **The readiness program is complete — three lanes of
three** (ELEC-FIGURE-1, ELEC-IDENTITY-1, ELEC-METH-1): both methodologies ratified as
register text behind the PS-112 gate; committee-candidate-office identification attested
for the mayoral side (not in the repo, by D-17); the council methodology figure repaired
on the artifact-rendered model. "Ready" is achieved and the calendar does the waiting.
The data-arc briefs inherit by name: the methodology-view office parameterization and
office-scoped figure path (F3, F5), the dues-field bindings (C4, M4), the reader-facing
display decision tripwired to the first windowed dollar, and the mayoral candidacy row
authored only the day a 2027 candidacy source exists.

## Cross-cutting requirements

**Scalable update pipelines.** SBE bulk pulls are manual — SBE blocks automation and
archives arrive sealed read-only; DataMade Councilmatic blocks datacenter IPs and runs
locally. Every data arc plans around both constraints rather than against them. Votes
updating, by tool: council votes flow into the Sheet from their source and out of the
Sheet into the artifacts — both legs kept simple; school-board votes flow out of the
Sheet into the artifacts, and feeding the Sheet is manual by design.

**Editorial layer.** The Google Sheet is the single editorial surface; pipeline programs
hold read-only scopes against editorial tabs, enforced by checker. The Sheet now also
carries three ingest-read voting tabs, pinned in the sync configuration. Auto-classified
industry values do not persist back across full runs — unclassified donors require
editorial entries. Multi-party Sheet editing is not formally designed (open ledger 15).

## The boundary hygiene lane (this boundary)

One lane, contents ratified at the ARC-BOUNDARY-2 review: open ledger 20 (pin checker;
SBV-BOARD-1 mechanism claims; the finance-builder legend row; the PS-129 generalization
to executor-side transcription anchors); open ledger 26–28 (WEAK-PASS fallback;
untracked-file invisibility documentation home; known-failures ceiling); the
OUTSTANDING-pair recount, position-named per tool. Small carried items not in this lane:
the hub/rollup cross-election surface (4), the dormant municipal selector label (6), the
dead-vocabulary sweep (13).

## Standing disciplines that govern all of the above

The editorial firewall (correlation never causation; streams never fused per-candidate;
dues transfers excluded; largest-remainder totals). The relay conventions carried by the
current handover. The three-role model: Ishan decides, attests, pushes, pastes; the
planner drafts; the executor measures. Measurement note: the elections render harness
reports its check count only in its own run output, not in the gate summary —
re-attesting that count requires a separate read-only run.

## Review cadence

At each arc boundary: re-read this file against the current handover and the open
ledger; discharge, enlarge, or re-sequence; update this file in the boundary commit.
Meta-lanes are bounded to arc boundaries.
