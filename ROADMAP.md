
# ROADMAP — chi-council-votes

Five tools, two cross-cutting requirements, and where each stands. Updated at arc
boundaries only, in the boundary lane's commit; between boundaries this file is dated,
not current. **This file is a map, not an authority: ruling text lives in
`campaign-finance/RULINGS.md`, mechanism in `campaign-finance/MECHANISM_REFERENCE.md`, state in the
current handover — this file wins on nothing.** Last updated: 2026-08-18
(ARC-BOUNDARY-1).

## The five tools

| # | tool | status | mount |
|---|---|---|---|
| 1 | Alder Voting History | live | `/alder-voting-history` |
| 2 | School Board Voting History | live with data, roster, President page, Board Rule attribution, funding methodology | `/school-board-voting-history` |
| 3 | School Board Elections finance | live | `/school-board-elections` |
| 4 | City Council Elections finance | code-enabled, data-empty; emission committed, page not created | none |
| 5 | Mayoral Elections finance | code-enabled, data-empty; emission committed, page not created | none |

## Delivery arcs, by tool

**1 — Alder Voting History.** Live since the alder arcs. Open against it: the roster-tab
design ratified at SBV-BOARD-1 (PS-127, R1a, the D-R2 set) is ratified to carry here and
is not built — two implementations of one design, since the embeds diverge structurally
(open ledger 23); a council render harness is arguably its prerequisite, since the gate
carries zero render checks for this embed (open ledger 24); the overflow-band /
box-sizing audit (open ledger 11).

**2 — School Board Voting History.** Data port SBV-PORT-1; board surfaces SBV-BOARD-1
(closing report sha `c678f60e…`, of record in handover rev S's manifest). Calendar
context: January 2027 board seating. Open against it: the attendance dataset lane (open
ledger 18, ratified behind the council/mayoral data arcs); the time-dimensioned roster
(open ledger 19); the dead per-member vote payload (open ledger 22); reference
documentation of the SBV-BOARD-1 mechanisms (open ledger 20, ratified deferral).

**3 — School Board Elections finance.** Live and stable. Open against it: the IE ingest
arc (open ledger 10 — donor→IE edge, click-ins, funder clustering, the Walton un-merge;
`{DUES}` goes live automatically when its funder join lands); the known-gaps `class`
field (open ledger 12).

**4 and 5 — City Council and Mayoral Elections finance.** PS-105 governs delivery in
three arcs: code enablement (done), council data, mayoral data — the data arcs
calendar-gated on 2027 filings reaching SBE, ~Q4 2026 at the earliest to be meaningful.
**Ratified priority (2026-08-17): readiness prep for both.** "Ready" means everything not
gated on the data is done before it lands: methodology ratified under PS-112,
committee↔candidate↔race identification designed, the unpinned council methodology
figure repaired on the artifact-rendered model (open ledger 25), page-creation display
decision put to Ishan (open ledger 3). The mayoral side additionally owes its registry
from scratch (open ledger 2).

## Cross-cutting requirements

**Scalable update pipelines.** SBE bulk pulls are manual — SBE blocks automation and
archives arrive sealed read-only; DataMade Councilmatic blocks datacenter IPs and runs
locally. Every data arc plans around both constraints rather than against them.

**Editorial layer.** The Google Sheet is the single editorial surface; pipeline programs
hold read-only scopes against editorial tabs, enforced by checker. Auto-classified
industry values do not persist back across full runs — unclassified donors require
editorial entries. Multi-party Sheet editing is not formally designed (open ledger 15).

## Standing disciplines that govern all of the above

The editorial firewall (correlation never causation; streams never fused per-candidate;
dues transfers excluded; largest-remainder totals). The relay conventions carried by the
current handover. The three-role model: Ishan decides, attests, pushes, pastes; the
planner drafts; the executor measures.

## Review cadence

At each arc boundary: re-read this file against the current handover and the open
ledger; discharge, enlarge, or re-sequence; update this file in the boundary commit.
Meta-lanes are bounded to arc boundaries.

