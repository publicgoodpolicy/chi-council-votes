# ROADMAP — chi-council-votes

Five tools, two cross-cutting requirements, and where each stands. Updated at arc
boundaries only, in the boundary lane's commit; between boundaries this file is dated,
not current. **This file is a map, not an authority: ruling text lives in
`campaign-finance/RULINGS.md`, mechanism in `campaign-finance/MECHANISM_REFERENCE.md`, state in the
current handover — this file wins on nothing.** Last updated: 2026-09-02
(ARC-BOUNDARY-3).

## The five tools

| # | tool | status | mount |
|---|---|---|---|
| 1 | Alder Voting History | live | `/alder-voting-history` |
| 2 | School Board Voting History | live with data, roster, President page, Board Rule attribution, funding methodology | `/school-board-voting-history` |
| 3 | School Board Elections finance | live | `/school-board-elections` |
| 4 | City Council Elections finance | live | `/city-council` |
| 5 | Mayoral Elections finance | ready: code-enabled, data-empty, methodology ratified, identification attested; page not created (R7, 2026-08-31) | none |

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

**4 — City Council Elections finance.** Live since CNCL-DATA-1 (P1 identification on the
2026-08-20 sealed vintage; P2 the reader-facing lane: council money in front of readers with
a methodology that is register text checked against the register at gate time; PATHS-1;
TOBON-1). The council data arc (PS-105 arc 2) closed at ARC-BOUNDARY-3. Open against it:
per-office `dues_excluded` and per-election reconcile scoping (open ledger 49); the
`cand-tobon-ward-01` re-mint at the next full ingest (58) and the ward-encoding id scheme
note (59); the `[data-election]` selector probe (57); the funder-of-funders surface (33)
and 41217's linkage (34), both behind the petition roster; IE `needs_review` 29 (45).
Updates: the next data update runs the full ingest chain on a new sealed vintage, with
`run.data_through` re-derived and `CHI_VINTAGE_ROOT` resolution exercised on a second
vintage.

**5 — Mayoral Elections finance.** PS-105 arc 3, calendar-gated on 2027 filings reaching
SBE by dates, never the cycle label, ~Q4 2026 at the earliest to be meaningful. Ready:
code-enabled, methodology ratified as register text, committee-candidate-office
identification attested for the mayoral side (not in the repo, by D-17); the `/mayor` page
is not created by ruling (R7) and is created only when its data arc lands. The arc inherits
F3/F5 as built, C5's pattern as the M-set's data-currency string, the paste-first ordering
(R12), and the seed of 34 parked mayoral committees (open ledger 46); the candidacy row is
authored only from the SBE D-1 source Ishan attested.

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

## The boundary lane (ARC-BOUNDARY-3, 2026-09-01/02)

Two commits and the north-star review. The register commit amended `CNCL-DATA-1 P2 — R8
and R9 as applied` (the seam and the third element) and opened the planner error ledger as
its own file beside the register, `campaign-finance/ERROR_LEDGER.md`, from entry 115 (1–114
live in the handover chain). The documentation commit is this file and
`campaign-finance/elections/embed/DEPLOY.md` (the paste record and the two measured deploy
windows). Discharged at the review: open ledger
1, 38, 40, 42, 51, 52, 54, 55, 56, 60.

**Next lanes, in order:** (1) the next data update — the full ingest chain on a new sealed
vintage, the Tobon re-mint (58), the school-board C5 equivalent as register text before it
ships (50), the pull-probe pattern (47); (2) HARRIS-1 — the tool-1 regeneration (37); (3)
the hygiene lane carried unexecuted from ARC-BOUNDARY-2, re-entered as open ledger 62: the
pin checker and PS-129 generalization (20), the checker-grammar items (26–28), the
direct-branch shadowing guard (31, measured unguarded at this boundary's G0), the
OUTSTANDING-pair recount, the `build_all.sh` `RAW` path (48) — sequenced before the homepage
lane because the harness debt (24) and the pin checker are its prerequisites; (4) the
homepage design lane — feed-led layout, Political Spend as a homepage feature (4, 41, 33);
(5) item 49 as its own small lane; (6) MAYOR-DATA (46, 59), calendar-gated; the
school-board attendance and time-dimensioned roster (18, 19) on the November 2026 →
January 2027 seating. Small carried, unsequenced: the D6 apostrophe candidate (53), the
dormant selector label (6), the dead-vocabulary sweep (13). Ishan's own act, in its own
lane: the two 2026-06-04 stashes' disposal (61).

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
