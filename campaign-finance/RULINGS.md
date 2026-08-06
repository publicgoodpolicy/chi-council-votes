# Rulings Register

**What this is.** The authority of record for the text of every ruling in force in this
repository (PS-75, widened by PS-87). On commit, ruling text lives here; lane archives and
handover revisions are **provenance, not authority**. A discrepancy between this register and
an archive is a provenance note, not a correctness defect — **the register wins** (PS-75).
`MECHANISM_REFERENCE.md` §8's RULED pointers resolve to entries in this file, in-repo, for
any reader holding only a clone.

**Form.** Each entry is two-tier, matching the reference: the ruling text, transcribed
**verbatim** from its banked source as a quoted block — figures included, because the
quotation is a sha-anchored historical record whose integrity is the register's value — then
a provenance line naming the originating record, its sha256, the extracted line range, and
the ratification date where a record states one. Everything the register itself authors
(titles, provenance lines, this header) carries no state figures; where a number matters it
is cited to its source. Transcription is never harmonization: where a ruling's text reads
inconsistently with later practice, the text stands and the provenance line carries the note.

**Superseded revisions.** An entry carries only the authority revision's text. A supersession
chain is recorded in the provenance line by sha, never transcribed (a superseded revision's
bytes may be replaced on disk by ruling, as PS-86's were).

**Ordering.** Numbered rulings by id, then rulings ratified without an id under stable
descriptive headings.

---

## Numbered rulings

### PS-9 — a′ field scope of record

> **PS-9 — a′ field scope of record.** Ruled in two parts, stated both ways, softened neither:
> 1. Field granularity: exactly `{entity_type, _last_edited_by}`. No other **field** shares the step-8-only-restored position, closed by writer sweep.
> 2. `industries == ['unclassified']` shares the property without sharing the position. It is step-8-only-restored at **value** granularity — lost on any step-8-less run, restored only by the Sheet round-trip, because the union deliberately re-classifies the bare marker. It is **not preserve-eligible** (preserving it wholesale would break legitimate re-classification of a stale unclassified org), and **by ruling it routes to the 1a editorial-state arc, not to a′.**
>
> *Provenance: handover rev E, 2026-07-30. Recorded in the reference at C2.10.*

*Provenance: handover rev E, 2026-07-30 (uncommitted); text as supplied verbatim in the DOCS-M3 brief §4, 2026-08-04 — no on-disk byte source exists for this ruling. Cited by reference C2.10.*

### PS-12 — non-industry members of the label space

> **PS-12 — non-industry members of the label space.** The industry label space contains **at least two non-industry members**: `individual` (a name-format fallback) and `candidate-account` (a money *type*). Rendering either as an industry label on a published surface is **one category error, not two coincidences**. Routes to 1a with a P1-R detector note.
>
> *Provenance: handover rev E, 2026-07-30. Recorded in the reference at C3.4.*

*Provenance: handover rev E, 2026-07-30 (uncommitted); text as supplied verbatim in the DOCS-M3 brief §4, 2026-08-04 — no on-disk byte source exists for this ruling. Whether `self-funding` is a further ruled non-industry member is an open question, recorded at the DOCS-M3 lane, not settled here. Cited by reference C3.4.*

### PS-23 — citation-freshness check (ratified proposal)

> - **Proposals section:** PS-23's freshness check and PS-32's population trip-wire, each with failure modes and, for PS-23, both semantics options (hard-fail vs review-required) unresolved; PS-49's chain-consistency check; PS-33's naming of the invisible-defect detector class, now four members. Prose only — build nothing.

*Provenance: DOCS-M1 G1 authorization (`docs-m1-g1-authorization.md`), sha256 `4df351879a2e7d1172f2bfadb2d9a4497b6958a2efbf6e58dd977c95b4a7ba0b`, line 51; drafted 2026-07-26. The cited record carries PS-23 at mention level (its issued text predates the banked set); the proposal's full statement is in the reference's Proposals section [P2]. Cited by reference P2.*

### PS-25 — ordering-authority inversion

> - **The runbook itself HOLDS the canonical chain** at `PIPELINE_RUNBOOK.md:215-230` ("order is load-bearing") — it does not *cite* build_all.sh, it *states* the order. Under PS-25 the mechanism reference becomes the ordering authority, so the runbook's chain section is the **largest** authority-transfer question (defer to / repoint at §1). This is a **distinct PS-25 decision** outside the build_all.sh-referent list — flagged for ratification, not assumed.

*Provenance: DOCS-M1 G0 report (`g0-report.md`), sha256 `d9420b12db1d737318403f299460b5696aa6bcb0cbe2345abdff4e29502e5e94`, line 96. The ratified pointer target carries PS-25 as an applied statement; the issued ruling text predates the banked set. Cited by reference C1.1.*

### PS-29 — a′ closed (Option B); 8a ruled

> - **a′ is CLOSED (Option B); 8a is RULED.** The `entity_type` / `_last_edited_by` preserve-list is not open work and must not be reopened.

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), § ratified-rulings-in-force, line 38; drafted 2026-07-26. The bullet does not name the id; the DOCS-M3 G0 lane report records the identification. Cited by reference C1.10.*

### PS-32 — population trip-wire (ratified proposal)

> - **Proposals section:** PS-23's freshness check and PS-32's population trip-wire, each with failure modes and, for PS-23, both semantics options (hard-fail vs review-required) unresolved; PS-49's chain-consistency check; PS-33's naming of the invisible-defect detector class, now four members. Prose only — build nothing.

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 51; drafted 2026-07-26. Mention-level carriage, as PS-23; the proposal's full statement is in the reference's Proposals section [P3]. Cited by reference P3.*

### PS-33 — the invisible-defect detector class

> The class has four members:
>
> 1. **The fused-per-candidate render detector** (FW-1) — the member missing from your inputs.
> 2. PS-23 — citation-freshness check.
> 3. PS-32 — `entity_type` / `_last_edited_by` population trip-wire.
> 4. PS-49 — chain-consistency check.

*Provenance: DOCS-M1 G1.0 resolution (`docs-m1-g1-0-resolution.md`), sha256 `f7473cf26ffdfb6d380c73e9388de49913ce4c4c89a2574615a368b3602212c2`, lines 45–50 (the class membership as completed by PS-54); drafted 2026-07-26. PS-33's issued naming of the class predates the banked set. Cited by the reference's detector-class row.*

### PS-44 — runbook canonical-chain transfer

> - **PS-44 — the runbook canonical-chain transfer happens in this lane**, on a split principle. Leaving the runbook asserting ordering authority while the reference claims it is the split-authority state PS-25 exists to end. **The reference holds the ordering requirements, their dependencies, and what breaks otherwise — the *why*. The runbook holds the operational sequence with flags and cites the reference as authority.** Different content types on one subject; not duplication if disciplined.

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 31; drafted 2026-07-26. Cited by reference C1.1.*

### PS-45 — positional ordering requirement

> - **PS-45** — Q3 is moot, but record the *reason* as a §1 ordering requirement, not trivia: the absence of a cluster lag is **positional**, holding only because `apply_clusters` (`sync_overrides.py:507`) runs after the transforms and before rollups. It is therefore fragile to any future reordering — exactly the class PS-31 says §1 records as a requirement on callers. (Note for the record: `sync_overrides.py:507` and `ingest.py:506` are different files; the adjacent numbers mean nothing.)

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 32; drafted 2026-07-26. Cited by reference C1.7.*

### PS-49 — chain-consistency check (ratified proposal)

> - **PS-49 — propose, do not build** — a chain-consistency check: express the canonical chain as a machine-readable block in the reference, diffable against the runbook's copy and against the actual invocation order in `build_all.sh`. **The block itself is content and goes in. The checker is a written proposal only.** Fourth member of the invisible-defect detector class (PS-33).

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 35; drafted 2026-07-26. Cited by reference P4.*

### PS-54 — the detector class's fourth member named

> ## PS-54 — PS-33's fourth member named; input gap closed
>
> The class has four members:
>
> 1. **The fused-per-candidate render detector** (FW-1) — the member missing from your inputs.
> 2. PS-23 — citation-freshness check.
> 3. PS-32 — `entity_type` / `_last_edited_by` population trip-wire.
> 4. PS-49 — chain-consistency check.
>
> Member 1 is sourceable from the FW-1 archive, authorized under PS-41. Pin it there. If FW-1's bytes do not support the characterization, mark it **UNVERIFIED-gap** and report — do not reconcile it against this file, which is planner prose, not a source.
>
> **Provenance note for the record:** this member was named when the class was first defined and never propagated into the brief or the authorization. Planner-side propagation failure, same class as the `508-510` citation and PS-34's citation target.

*Provenance: DOCS-M1 G1.0 resolution, sha256 `f7473cf2…` (full sha at §PS-33), lines 43–54; drafted 2026-07-26. Cited by the reference's detector-class row.*

### PS-58 — RULED-pointer fallback for planner-sitting rulings

> **PS-58 — PS-55 amends.** A RULED claim's ratification pointer is:
>
> - the ruling ID plus the **sha'd gate record**, where one exists; otherwise
> - the ruling ID plus the **handover revision carrying the ruling**, which is the artifact of record for conversationally-ratified rulings.

*Provenance: DOCS-M1 pre-G4 items (`docs-m1-pre-g4-items.md`), sha256 `6037b3473cdcfa84377ccf5d220c9bced6fb351f49a1a46c07d9f5f80295035e`, lines 43–46; drafted 2026-07-26. Mechanism superseded: PS-75 makes this register the pointer target and retires the handover-fallback route; the ruling stands as history. Cited by the reference §8 form header.*

### PS-60 — the mechanical check's worded-count blind spot

> ## PS-60 — two edits to the reference
>
> ### (a) Required — disclose the mechanical check's blind spot
>
> PS-57's full-power grep matches **digit runs**. It therefore cannot see a count spelled as a word, and the document deliberately spells its structural constants that way.
>
> Record in **§6's known-risk section** (the audit-only home, since documentation drift is audit-only by the document's own taxonomy):
>
> - what PS-57's clean result does and does not establish — **no count appears in digit form in the prose tier; it does not establish that the scope rule is fully enforced**;
> - the failure shape, with the fixture available in this arc: **the invisible-defect detector class grew from three members to four inside a single arc**, so a worded count can go stale with nothing detecting it;
> - that the mitigation is stating properties rather than quantities, per (b), not a stronger grep.
>
> Wording is yours. The three points above are the requirement.
>
> ### (b) Two claims restated as properties rather than quantities
>
> Both are strictly more durable and neither is a count once restated:
>
> - **The detector class** — enumerate the members **by name**, drop the count. Names are not counts; this is the same treatment §3 already gives the Sheet-only labels.
> - **The render-path claim** — state the **property**: the paths are separate, hand-maintained, and firewall compliance is therefore a per-path property. Drop the number, which a third tool in 2027 falsifies.
>
> Apply the same treatment to any other worded count the edit surfaces. Report what you found.

*Provenance: DOCS-M1 closing amend (`docs-m1-closing-amend.md`), sha256 `daf8a0f0083651a17d39378600c64ced64d2a685e2db140a6075bf611cb6bfc8`, lines 15–36 (the section's post-edit asserts excluded as lane mechanics); drafted 2026-07-26. Cited by reference C6.5.*

### PS-65 — RULED-pointer artifact class widened

> Widen the header's three-label definition. A **RULED** pointer resolves to a ruling ID plus **any hashed, on-disk, immutable lane artifact** — gate reports **and** governing input briefs (`g0-report`, the G1 authorization, the G1.0 resolution, the closing-amend file) — with **the handover revision as fallback** for conversationally-ratified rulings.
>
> This aligns the definition with the practice already accepted at G2/G3. The planner's PS-58 phrasing said "sha'd gate record," which was narrower than the document's own contents.

*Provenance: DOCS-M1 final pre-push amend (`docs-m1-final-amend.md`), sha256 `25387ecc84ea7d2cb1d7f832178c9adad7436ac2f00f899df790b89052173b3d`, lines 38–40; drafted 2026-07-26. Widens PS-58; superseded with it by PS-75, as PS-58's entry records. Cited by the reference §8 form header.*

### PS-71 — pointer cells are tenseless and prose-free

> ## PS-71 — Pointer cells are tenseless and prose-free
>
> A pointer in `MECHANISM_REFERENCE.md` §8's RULED table carries exactly two things: the **ruling id** and the **resolving artifact** (sha, archive id, or named revision). No tense, no status, no narrative, no justification.
>
> - In force: `C3.4 | PS-12 | handover rev E`
> - Barred: `PS-12 — pointer per PS-58 fallback: ratified in a planner sitting… Resolves at rev E… deferred-by-design, not an open defect.`
>
> Discipline 31 ("cite IDs, do not restate content or status") generalized into the PS-55/PS-58 label scheme, where it was not previously applied to the pointer cell. Where a pointer's kind matters — lane artifact vs handover fallback — that is a property of the artifact named and does not need saying.

*Provenance: PS-71/72/73 ratification record (`ps71-73-ratification-record.md`), sha256 `d2eca539223a2d64d1ffa292c716d17f5aa41935f6d967ca8ddd7309428d8fb6`, lines 10–17; ratified 2026-07-31. Governs the reference §8 pointer form.*

### PS-72 — a pointer to a nonexistent artifact is not a pointer

> ## PS-72 — A pointer to a nonexistent artifact is not a pointer
>
> While a resolving artifact does not exist, the claim carries **no pointer row**. It sits in the UNVERIFIED register with its PS-42 sub-class (*gap* | *deferred-by-design*), and the pointer row is added when the artifact lands.
>
> Consequences, ratified knowingly:
> - C3.4 and C2.10 were ineligible for pointer rows at DOCS-M1; the correct form was two register entries and two empty pointer slots.
> - The register's **population** becomes load-bearing and must be maintained as such. Per PS-62 that count is rule-logic, not a PS-34/PS-38 count.
> - PS-42's sub-classes are class names, not tense, and survive PS-71 untouched.

*Provenance: PS-71/72/73 ratification record, sha256 `d2eca539…` (full sha at §PS-71), lines 19–26; ratified 2026-07-31. Governs the reference §8 pointer form.*

### PS-73 — pointer-form and path-existence checker

> ## PS-73 — Pointer-form and path-existence checker
>
> One script, two rules, docs-only, no external state:
>
> 1. **Structural** — a §8 pointer cell must match the PS-71 shape. Any prose in a pointer cell is the finding, whatever it says. Structural check, not lexical: a word list is evadable by synonym.
> 2. **Lexical, register only** — flag forward-looking status language (`resolves at`, `resolves in`, `pending`, `will`, `scheduled`, `not yet`, `forthcoming`, `expected`, `TBD`, `once … lands`), with `gap` and `deferred-by-design` allowlisted as exact tokens.
> 3. **Path existence** — a path named in any repo markdown document exists on disk. Merged in from the ORIENT-1a findings, where it accounts for three of four contradictions.
>
> **Semantics: hard-fail, ruled as such** — deliberately unlike PS-23, whose semantics stay unresolved. PS-23 fires on external state drift the author may not be able to fix in the moment, so a routinely-overridden gate is the live risk. This fires on prose form and repo contents the author controls entirely, fixable in the same commit.
>
> **Scope:** the reference and the runbook's copy of the chain block. Not the handover, which is not under the no-tense rule and should not be.
>
> **Build obligation, ratified with the rule:** PS-73 is not discharged by being named. It ships in DOCS-M3 as the PS-33 class's first built member. A ruled-but-unbuilt detector is PS-66's counted failure mode.

*Provenance: PS-71/72/73 ratification record, sha256 `d2eca539…` (full sha at §PS-71), lines 28–40; ratified 2026-07-31. Build obligation ratified with the rule; scheduled as DOCS-M4, this lane's successor.*

### PS-74 — (question; resolved)

*PS-74 was a question — pointer custody for planner-sitting rulings — resolved by PS-75. Recorded as resolved, not as a standing rule; it has no ruling text.*

### PS-75 — the rulings register

> ## The ruling
>
> Ruling text of record lives in a committed in-repo register. Handovers and lane archives become **provenance**, not authority. `MECHANISM_REFERENCE.md` §8 pointers resolve to register entries, in-repo, for any reader holding only a clone.
>
> ---
>
> ## Four scope decisions, with recommendations
>
> ### 1. Backfill — YES, scoped to §8's pointer rows only
>
> Not "every ruling ever," which is unbounded and mostly not load-bearing. **Scope is exactly the rulings §8 cites** — the twelve rows, roughly ten distinct rulings — because those are precisely what makes the reference's asserted authority conditional on documents outside the repo. A ruling the reference never cites costs a repo-only reader nothing.
>
> Go-forward-only leaves the census at 0/10/2 forever and improves only the margin. Backfill moves it to **12/0/0** and is finite: ten transcriptions, four source files, one handover.
>
> ### 2. Full text — YES
>
> A pointer target that does not contain the ruling reproduces PS-66's failure mode ("ruling content not reaching the artifact that governs the work"). I made that argument for the PS-71/73 ratification record and it binds here identically. Stubs would rebuild the same defect one indirection further out.
>
> **The register inherits the reference's no-state-figures rule.** Rulings are rules, not state — that is the whole reason B′ beats A. Where a ruling's original text carries a count or sha, cite it to its archive source rather than restating it.
>
> ### 3. Path — `campaign-finance/RULINGS.md`, beside the reference
>
> Adjacency matters more than tidiness: the two documents are read together, and one `CLAUDE.md` pointer update covers both. It inherits the reference's existing scope oddity (repo-wide authority living in a subdirectory) rather than creating a second one. Two-tier form, matching the reference: entry text, then a provenance line naming the originating archive or handover.
>
> ### 4. Transcription — executor work, in-lane
>
> The ten archive rows resolve to four files under `~/docs-m1-2026-07-24/`, on the executor's machine. The planner has no access; this cannot be planner drafting. PS-9 and PS-12 are the exception — their full text is in rev E and is relayed with the lane brief, so the executor transcribes rather than reconstructs.
>
> ## The clause that removes the drift objection
>
> The standing objection to B′ was that a transcription is a copy and copies drift. **Answered by ruling, not by a checker:** on commit, the register becomes the **authority of record** for ruling text; the archive and handover become provenance. There is no second authority to drift from. A discrepancy between register and archive is a provenance note, not a correctness defect — and the register wins.
>
> This is why B′ needs no P4-shaped consistency check, unlike the chain block, which genuinely has two authorities (documented and implemented).
>
> ## Lane sequencing — and a split recommendation
>
> PS-71/72/73 and PS-75 are **inseparable and must share a lane.** PS-72 forbids a pointer row whose artifact does not exist; committing the register is what brings those artifacts into existence. Reform the pointers before the register exists and ten rows must be deleted, then re-added.
>
> **DOCS-M3 = rulings register + §8 pointer reform + ledger 3(a)/(b).** One commit, discipline 33 satisfied.
> **DOCS-M4 = the PS-73 checker** (pointer form + register lexical + path existence), immediately following.
>
> Split because the checker validates the form M3 establishes; building it first means building against a shape that does not exist yet. **The split is not a deferral** — PS-73's build obligation was ratified with the rule, and M4 is scheduled as M3's successor, not banked. If M4 slips, that is the seventh instance of PS-66's counted pattern and should be called that.
>
> ## Residual for PS-75's own pointer
>
> PS-71–73 resolve to the ratification record (`d2eca539…`, archive-class). PS-75 will resolve the same way until DOCS-M3 lands — at which point all four transcribe into the register as its first entries and the pointers become in-repo. **The register's first act is to contain the rulings that created it.**

*Provenance: PS-75 draft (`ps75-draft.md`), sha256 `80af71b836de2bc46760f52449b647be41937dcd32a6d2763140012016b5d7ad`, lines 8–53; drafted for ratification and ratified as drafted (the file's title says draft; its content is in force — DOCS-M3 brief §1 lists it among rulings in force). Scope decision 1 (§8-rows-only backfill) is widened by PS-87. Governs this register.*

### PS-76 — guard removal is the second half of a swap

> ## PS-76 — The aggregate guard is removed as the second half of a swap, never as a standalone edit
>
> The guard is a crude proxy for election scoping: it excludes one election by id because nothing scopes properly. Removal is authorized only once the mechanisms it stands in for exist, and must then be **proved as a no-op**, not treated as an unlock.
>
> **Two independent prerequisites, each sufficient alone to block removal:**
>
> 1. **Election-scoped consumers.** Removal admits 10 races and 47 candidacies into the ranked spend roster, the grouped view's shared bar scales, and the industry/flag cross-tabs. A ranked roster and a shared industry denominator spanning 2024 and 2026 is cross-cycle aggregation — forbidden by `p1d-design-inputs` §1, the constraint the guard currently satisfies by brute force.
> 2. **F1 fixed.** The guard masks the Hargrove misattribution on all three guarded surfaces: the guard reads the candidate record's own `race_id` (`data.js:1063`), which F1 never touches, so the 2024 candidacy resolves cleanly and is excluded while the 2026 candidacy shows $0 and is dropped by the has-money filter at L1067. **Removing the guard before F1 is fixed converts a hidden misattribution into a displayed one.**
>
> **Proof obligation.** The removal lane's baseline cannot be byte-identity — the removal is intended to change what renders. The proof is that every newly admitted row is election-scoped and correctly attributed, checkable only after both prerequisites. The dormancy baseline superseded is the recorded gate **run report**, not the tool (G1 contradiction C2), plus the live charter-schools dollar checks.
>
> **Registered against re-derivation:** any future reading of the guard as "dormant, therefore free to remove" is wrong. It is dormant in the sense of changing no bytes today and load-bearing in the sense of suppressing a live defect.

*Provenance: PS-76/77/78 ratification record (`ps76-78-ratification-record.md`), sha256 `1b3b250fa15364e30e2f8a0467e37e9b2a0581af5d053c28f0afcb3859130e3b`, lines 11–22; ratified 2026-08-01. Discharged at HALT-GUARD (the removal lane ran with both prerequisites satisfied). Referenced in reference §5 (C5.6 occasion).*

### PS-77 — shared-committee ownership: the current candidacy owns

> ## PS-77 — Shared-committee ownership: the current candidacy owns the committee
>
> **Rule.** Where one SBE committee is claimed by multiple candidacies of the same person across elections, the **most recent candidacy owns the linkage**. The prior candidacy's `committee_id` is nulled and its `finance_facet` set to `on_current_record` — the Biggs pattern, made general and deterministic rather than iteration-order-dependent.
>
> **Recovered, not invented.** The shipped returner pointer already ratifies the editorial position: campaign finance for a returning candidate is reported under their current committee. PS-77 makes the data layer do what the display layer already tells readers.
>
> **Scope limits, stated so they are not read in:**
> - Same person only. A committee claimed by candidacies of **different people** is out of scope and is a **stop-and-report**, not a case for this rule.
> - "Most recent" is by election, not by filing date or iteration order. Determinism is the point; the current defect is that luck decides.
>
> **Ordering consequence — F2 before F1, or the same commit.** Fixing F1 moves the disputed money onto a 2026 candidacy, where the window-less path at `data.js:848-851` would render pre-2025 money in an unlabeled 2026 total. Fixing F1 first trades a masked misattribution for a displayed cross-election fusion.
>
> **Attribution only; nothing granted to display.** Ownership determines linkage. What appears on a per-election surface remains window-scoped. Ownership is not authority to show a committee's full history on any single candidacy's surface.
>
> **Validator obligation.** INV-PERSON passes on the current defect because it derives from the same stamped linkage it should be checking. A fix leaving that circularity intact fixes one row, not the class. The F1 lane ships an independent assertion: no candidacy-grain money without a candidacy whose own `race_id` matches the committee's stamped election.

*Provenance: PS-76/77/78 ratification record, sha256 `1b3b250f…` (full sha at §PS-76), lines 24–38; ratified 2026-08-01. Letter amended by PS-84 (the facet clause is conditional). Cited by reference C4.7.*

### PS-78 — planner mechanism claims carry a source label

> ## PS-78 — Planner mechanism claims carry a source label
>
> Every mechanism claim in a planner artifact — brief, triage, authorization, ruling — is labeled **SOURCED** (file, line, sha, or reference claim-id), **RULED** (ruling id), or **UNVERIFIED**. The reference's own three-label taxonomy, applied to planner output.
>
> **Occasion.** Five planner errors in this arc; four share one shape — a mechanism detail supplied from inference and stated as fact:
>
> | # | claim | reality |
> |---|---|---|
> | 1 | `ingest_ie` must be re-run after any `build_all.sh` | chain-scoped; false for routine `build_all.sh` |
> | 2 | layer 1 is `ingestion/` + `sheets-sync/` | elections chain begins in `elections/` |
> | 3 | `inAggScope` is in `render.js` | `data.js`; inherited from `p1d-design-inputs` §3 and propagated unverified |
> | 4 | the **committed** `.DS_Store` | untracked, as are all 46 scraps |
> | 5 | `!race` means F1's rows pass the guard | F1's ids resolve; the guard masks F1 |
>
> Each was caught by the executor at a gate before any mutation — the system working. But the executor catches them because it reads source and the planner does not. An UNVERIFIED label costs one word and routes the claim to whoever can check it; errors 1, 3, and 5 were each checkable against the reference already in the planner's context.
>
> **Not a detector.** Nothing mechanical exists to check in a planner sitting. This is a drafting discipline, enforced by the executor's existing flag-at-gate behavior.

*Provenance: PS-76/77/78 ratification record, sha256 `1b3b250f…` (full sha at §PS-76), lines 40–56; ratified 2026-08-01. A planner drafting discipline; not cited by a reference claim row.*

### PS-79 — windowing: every race takes its election's window; a missing window is an error

> ## 3. PS-79 — RATIFIED 2026-08-01 (A1 + B1)
>
> **(a) What window does a race get?**
> - **A1 — RATIFIED.** Every race takes its own election's window, always. The combined view survives only as an explicit, labeled opt-in on races that have a counterpart. Windowing becomes a property of the election, which is what it always was.
> - ~~A2 (patch)~~ — not taken. Pass the election window at 848-851 for non-toggle races; leave the coupling intact. Smaller diff, leaves the same defect available to the next feature that forgets the list.
>
> **(b) What happens when no window resolves?** [SOURCED — G1 F4]
> `election-windows.json` has no `municipal` key, and `build_rollups.py:143-144` degrades a missing or corrupt windows file to `windows={}` **without erroring**. F2 and F4 are the same failure shape: *absent window silently means no filter*.
> - **B1 — RATIFIED.** A missing window is an **error**, never an empty filter. A per-candidate surface that cannot resolve its window does not render an unwindowed total. Fail loud, at the surface.
> - ~~B2~~ — not taken. Render with an explicit "all dates" label. Honest, but it makes the fused view reachable by omission — the exact shape §1 forbids.
>
> B1 is the structural-over-conventional choice, and the reason F2 existed is that the current behavior is B-none: absent window, no filter, no label, no error.
>
> **(c) F4's municipal key is NOT fixed here — ratified as scoped out.** The 50 municipal candidacies are latent behind a coming-soon short-circuit. Under B1 they fail loud rather than fuse, which is the correct interim state. F4's own lane adds the key and fixes the silent degradation in `build_rollups.py`. **Flagged so the failure is chosen, not discovered.**

*Provenance: HALT-F2 brief (`halt-f2-brief.md`), sha256 `7460c77f98a8019ad4cc2bf448b32305e206e23823bf55d87369f7f32ad987d3`, lines 31–44 (§3, ratified in place 2026-08-01). Region: §3 in full, including the not-taken branches and the F4 scope-out that are part of the ratified statement; the brief's remaining sections are lane mechanics and were excluded. Referenced in reference §5 prose (C5.5).*

### PS-80 — chain truncation is permitted; C1.1 binds order, not completeness

> ## PS-80 — Chain truncation is permitted; C1.1 binds order, not completeness
>
> A lane may run a **contiguous truncation** of a canonical chain where every omitted step provably touches nothing the lane changes. C1.1 constrains the **order** of steps that run; it does not require that all run.
>
> **Conditions, all required:**
> 1. The omission is justified per-step in the lane report, naming what each omitted step writes and why the lane's change cannot reach it.
> 2. No omitted step is *reordered* relative to those that run — truncation only.
> 3. **The executed chain is recorded in the lane record — the G2 report and the commit message, against the produced artifact's sha — so a later reader does not infer a full-chain vintage.**
>
> **Condition 3 amended per F-a, which was a planner drafting defect.** The original text ("the artifact produced is labeled with the chain actually executed") reads as requiring an in-artifact field, which would violate the exhaustive delta list and silently make every truncated-chain lane a schema change. The intent was always record-keeping. The executor was right to refuse to add an artifact key without an amendment, and right that the two clauses could not both be satisfied.
>
> *Banked separately, not ruled here:* whether the artifact should carry a provenance field naming its producing chain. It is a real gap — an artifact's chain is not recoverable from the artifact — but it is a schema decision with stale-deploy consequences, not a rider on a truncation rule.
>
> **This rule is not a licence to trim by convenience.** Reference C1.5 and the `ingest_ie` re-run rule exist because skipping steps has burned this repo before. Condition 1 is the whole of the rule.

*Provenance: HALT-F5-SEED ruling record (`ps-80-81-ruling.md`), sha256 `bd25b641b682ec12a950ef64ade8561d65e483ceb7b11fc3dee26942a410cde6`, lines 8–21; ratified 2026-08-03 (G2 proceeded under it). Region: the rule and its conditions; the record's applied-here instance was excluded as lane state. Cited by reference C1.11.*

### PS-81 — stamped identity fields carry a mismatch validator

> ## PS-81 — Stamped identity fields carry a mismatch validator
>
> A field stamped onto a record from a resolved pointer ships with a validator checking it against every independent redundancy available, and the validator's coverage is stated with it. A stamped field with no check is a confident assertion of something never verified.
>
> **Coverage here, as the ruling's own limit:** namespace prefix, candidate-id conventions, and the 2024-signature keys (`result` / `finance_facet`, cohort-scoped). Catches cross-namespace and 2024-cohort misfilings. Does **not** catch same-election wrong-district errors — a separate class, separately banked.
>
> **Precedent for the field name:** `by_person.members[]` already carries `election_id`. Same name, same meaning, one artifact.
>
> **Route B constraint, ratified with this rule:** if the race-map schema route is ever taken, the 93 hand-authored entries are authored **from source documents**, never backfilled from `race_id`. A circular backfill retires the validator while keeping the defect, which is worse than not taking the route.

*Provenance: HALT-F5-SEED ruling record, sha256 `bd25b641…` (full sha at §PS-80), lines 25–33; ratified 2026-08-03. The coverage limit and Route B constraint are part of the ruling as drafted. Cited by reference C4.5 (validator requirement).*

### PS-82 — a guard does not consume the field it guards

> ## 5. PS-82 (draft) — A guard does not consume the field it guards
>
> A validator, gate check, or guard must not derive its expectation from the value it is checking, or from a field whose correctness it exists to establish. Its inputs must be independent of its subject.
>
> **Instances this arc, which is why it is worth ruling rather than repeating:**
> - **INV-PERSON** passes on the F1 misattribution because it derives from the same stamped linkage it should be checking (G1 census; banked in PS-77).
> - **`gate_bundle` `[F2]`** would have acquired this defect had the stamp conversion been applied — §2 above.
> - **`elec_of` → INV-ELECT** would have acquired it had the conversion reached those checks — the §3 circularity check, which came back clean.
>
> Three near-misses in one arc, two of them caught only because a brief asked the question explicitly. **The rule makes the question standing rather than remembered.**
>
> **Corollary:** a check that must read its subject is not a check; it is a restatement. Where no independent input exists, the honest form is to record the claim as UNVERIFIED rather than to ship a check that cannot fail.

*Provenance: SCOPE-PIPE G1 ruling record (`ps-82-ruling.md`), sha256 `4a164c9716cbb67713ac1424b3605f41517789660da7df84eb3ca64b972628f8`, lines 42–53; ratified 2026-08-03. Cited by reference C6.6.*

### PS-83 — self-caused citation drift is repaired in the causing commit

> **Ruling.** Where a lane's own edit shifts lines cited by a §8 row, that row is re-lined in the same commit, whether or not its legend sha is re-pinned. Discipline 33's principle — the documentation update rides the commit that changes the thing documented — extends to line coordinates the commit itself moved.
>
> **Scope limit:** this is *not* a duty to refresh unrelated stale citations, which would make every lane a documentation lane. It is a duty not to *create* stale citations. The distinction is authorship: drift you caused, in the commit that caused it.

*Provenance: SCOPE-PIPE G2 attestation (`scope-pipe-g2-attestation.md`), sha256 `a81acca92f3de3a1880b09358e0caec7bd0c5945d79f008cef73602894d850fd`, lines 37–39 (§4). Region: the ruling and scope-limit paragraphs; §4's occasion and second-order finding are lane commentary and were excluded. Drafted 2026-08-03, applying from the next lane per its own terms; in force (applied from HALT-F5-SEED onward). A process rule; not cited by a reference claim row.*

### PS-84 — the facet clause is conditional on prior-window money

> INV-PERSON-4 firing is the *symptom*, not the argument. The validator encodes the precondition correctly; the letter of PS-77 omitted it because PS-77 was written from the Biggs case, where the precondition happened to hold. **A rule generalized from one instance carries that instance's preconditions whether or not they were written down.**
>
> **Ruled: the facet clause is conditional.** Prior candidacy's `committee_id` nulls unconditionally; `finance_facet` becomes `on_current_record` **iff prior-window money exists on the shared committee**, otherwise the existing facet stands. Drafted as PS-84, amending PS-77 rather than reinterpreting it — the ruling text was wrong as written and should be corrected in the record, not glossed.

*Provenance: HALT-F1 G1 ruling record (`ps-84-85-ruling.md`), sha256 `03721efcf0fe4d744ad580106627a4b3dafd9c65f6ce1c2b28bd833be793756c`, lines 16–18 (§1); ratified 2026-08-03. Region: the generalization principle and the ruled clause; §1's case analysis is lane state and was excluded. Amends PS-77's letter. Cited by reference C4.7.*

### PS-85 — an unexplained coverage change is the stop

> **Ruled generally, as PS-85:** a coverage-count stop condition is *"an unexplained change is a stop."* Where a lane's own edit is expected to move a guard's coverage, the expected counts are **pre-ruled at the authorizing gate**, and the gate compares against the ruled expectation rather than against the pre-fix state. Comparing against a defect-inflated baseline makes the defect's removal look like a regression.

*Provenance: HALT-F1 G1 ruling record, sha256 `03721efc…` (full sha at §PS-84), line 37 (§3); ratified 2026-08-03. Region: the general ruling sentence; §3's pre-ruled counts for that lane are lane state and were excluded. Cited by the reference's coverage-count row.*

### PS-86 — surface class determines scoping (rev 3)

> ## 2. PS-86 (draft) — Surface class determines scoping rule
>
> **A surface is scoped by what it presents, not by what it looks like.** Under C5.5, a surface presenting **money** is window-scoped; a surface presenting **navigation among entities** is entity-scoped. Where a control resembles navigation but organizes money — a grouping, a section list, a dropdown over a money view — **it follows the money rule.**
>
> **Frame and contents are scoped separately.** Where a selector picks an entity, that entity establishes the **frame**, and the frame is entity-scoped because the selector is: **every member of the selected entity is present regardless of money.** What appears in the frame from *other* entities is contents, and is window-scoped: **it appears iff it carries in-window money.**
>
> The reason is asymmetric and is the rule's substance. **Inside the frame, absence is information** — a race the reader chose to look at, showing nothing, is a finding, and a visible zero beats an absent row on a transparency tool. **Outside the frame, presence must be earned** — an entity the reader did not select, carrying no money in view, is noise.
>
> **Corollary, which is the rule's practical teeth:** a scoping change that makes money unreachable on a surface where it was reachable is a regression regardless of how principled the scoping argument sounds. Money moving between surfaces is a display decision; money leaving all surfaces is a defect.
>
> **Occasion:** the race-section list reads as navigation and is money, and the entity-scoped reading would have dropped $4.0M of returner money from every reachable view while appearing to enforce C5.5 — while the purely money-derived reading would have dropped in-frame zero-money races, deleting a true finding.

> **Ruled: in-frame sections first, then out-of-frame; each group internally ordered as today.**
>
> Follows directly from PS-86's frame/contents distinction — the frame is what the reader selected, so it leads. **No new ordering convention is invented**; the existing `raceOrderKey` continues to order within each group. The change is a group-precedence comparator ahead of it.

*Provenance, first block: HALT-GUARD G1 ruling record (`ps-86-ruling.md`), sha256 `c8c05654e97d92d97c4bc7c11ee4cac0c77e4e153c439f4f465449213f2ca962`, lines 44–54 (§2); rev 3, ratified 2026-08-03 — supersedes rev 2 (`7b43b20f…`) and rev 1 (`9a4ba9ac…`), each replaced on disk as ruled.*
*Provenance, second block (in-frame-first section order): HALT-GUARD fold-in authorization (`halt-guard-foldin-authorization.md`), sha256 `4700bd5930232a017abb8b443a3ec006ec8164ce949f017ffc492d7d89967565`, lines 9–11 (§1's ruled ordering paragraphs); ratified by Ishan 2026-08-03. Cited by reference C5.6.*

### PS-87 — the register carries every ruling in force

> PS-75 scoped backfill to §8's pointer rows. **G0's observation is correct and the consequence is untenable: under that scope the register would not contain PS-71, PS-72, PS-73, or PS-75 — the rulings that define the register itself.** A document whose own governing rules are unresolvable in-repo reproduces the defect it exists to close, one level up.
>
> **Ruled: the register carries every ruling in force**, whether or not §8 cites it. A ruling in force that a repo-only reader cannot find is a rule governing work that the work cannot see — PS-75's argument applied without the arbitrary §8 boundary.
>
> **Scope consequence:** the 23 §8-cited entries, plus **PS-71, PS-72, PS-73, PS-75, PS-76, PS-77, PS-78, PS-79, PS-83** from §1's supplied records, plus **PS-87 itself**. PS-74 is recorded as **a question resolved by PS-75**, not as a standing rule — one line, no ruling text.

*Provenance: DOCS-M3 G1 ruling (`docs-m3-g1-ruling.md`), sha256 `3f4f816facf42bd1bf7fa750e8874afa44c34f073252d860f719e537057d3dc6`, lines 28–32 (§2); ratified by Ishan 2026-08-04. Widens PS-75 scope decision 1. Governs this register.*

### PS-89 — a surface may be framed by an entity the selector does not select (rev 2)

> ## PS-89 (rev 2) — A surface may be framed by an entity the selector does not select
>
> **Parent: PS-86 rev 3.** This ruling extends PS-86; it does not revise it, and PS-86's text
> is unchanged. **Rev 2 supersedes rev 1** and adds only the deep-link clause; the frame
> reasoning is unaltered.
>
> Where a surface presents a **single entity that spans elections**, that entity establishes
> the frame, even though the election selector does not select it. PS-86's frame/contents
> split applies one level up.
>
> Applied to the by-person surface: **the person is the framed entity, and the person's member
> candidacies are the frame.** Every member renders regardless of money — inside the frame,
> absence is information, which is PS-86's reason and is inherited here rather than restated
> as a new rule. The money within each member section is **contents**, window-scoped to that
> member's own election under PS-79/A1. Nothing from other entities appears, so the contents
> half is satisfied by construction.
>
> **The selector neither filters such a surface nor is contradicted by it.** The surface is
> *reached* from wherever navigation places it and *scoped* by its framing entity.
>
> **Corollary, and the clause with teeth:** a surface framed by its own entity must **not**
> inherit the window of the container it was opened from. Where the existing mechanism passes
> a container's window to what it opens, an entity-framed surface takes a deliberate
> exemption, and that exemption is asserted, not assumed — a surface that renders differently
> depending on which card opened it is not framed by its entity.
>
> **Rev 2 — the deep-link path is the exemption's proof, not an assertion about it.** An
> entity-framed surface reached by direct link has **no container to inherit from**. Where such
> a surface is addressable, the direct-link path is the structural demonstration that the frame
> is the entity's own: the exemption stops being a rule the code remembers to follow and
> becomes a path on which inheritance is impossible. The equivalence assertion — that the
> surface renders identically whether reached by link or from a container of either window —
> is the test that the two paths agree.
>
> **Why this is not the entity-scoped reading PS-86 warned about:** narrowing the person
> surface to the selected election would make the cross-election connection unreachable, and
> PS-86's corollary holds — money moving between surfaces is a display decision, money leaving
> all surfaces is a defect.

*Provenance: P1D-PERSON G1 addendum (`g1-addendum-ps89-91-d4-d6.md`), sha256 `9352a5f9b59af5106db9587be49dcef412fb3561ea29ef5e375be1c16b544564`, lines 20–58; rev 2 ratified by Ishan 2026-08-04 — supersedes rev 1, recorded in the issuing record `d1a77ebcf2e56a4172318b77f2f84585d857ae116da84dcdd0919f0cbdcf3e13` §1 and never transcribed. Parent: PS-86 rev 3 (extends, does not revise). Cited by reference C5.7.*

### PS-90 — independent expenditures are deferred from the by-person surface; the exclusion is deferral-scoped

> ## PS-90 — IE is deferred from the by-person surface until P1-E re-routes, and the exclusion carries its own lifetime
>
> **The deferral.** Independent expenditures are **not rendered** on the by-person surface at
> this vintage. Every school-board IE row is 2024-window money keyed to a **2026** candidacy
> id, so it is 2024 by window and 2026 by key and fits neither member section. Placing it
> inside a member section asserts an association the rows do not carry. SCOPE-UI ruled this
> divergence a symptom whose resolution is upstream, and that the lane **records the
> divergence rather than papering over it**; nesting mis-keyed money under the heading that
> makes it look correct is papering over it.
>
> **The deferral is a commitment, not a decision against the display.** IE support and IE
> oppose **are displayed on the by-person surface** — money spent supporting a candidate and
> money spent against them are both part of what the surface exists to show. They are held
> only until P1-E re-routes 2024 IE to 2024 candidacy ids, at which point placement is
> coherent. The obligation is carried on P1-E's ledger entry, not only here.
>
> **Deferring is not a regression under PS-86's corollary:** the money remains reachable on
> the 2024-scope spend tab and on committee profiles, so it moves between surfaces rather than
> leaving them.
>
> **Two exclusions, two lifetimes, and they do not ship as one check.**
>
> 1. **INV-PERSON-2** — no `independent` key anywhere in `by_person`, asserted recursively at
>    the artifact layer — is a **permanent firewall invariant** and is never removed.
> 2. **The person view-model IE exclusion**, at the render layer, is **deferral-scoped**. The
>    lane that ships IE supersedes it consciously, and its removal is **not** a firewall
>    regression.
>
> A check must state its own lifetime where its lifetime is not permanent. An undifferentiated
> "no IE on the person surface" assertion leaves the later lane unable to tell which exclusion
> it is permitted to touch — the PS-76 failure shape, applied before the guard exists rather
> than after.
>
> **Banked form for when IE arrives**, so the firewall reasoning is not re-derived in a lane
> whose subject is routing: IE renders in **its own component**, never nested inside a member
> section, never sharing a total, a denominator, or a stacked geometry with direct money, and
> on its own scale. Support and oppose remain structurally separate streams.

*Provenance: PS-89/90/91 ruling record (`ps-89-91-ratification-record.md`), sha256 `d1a77ebc…` (full sha at §PS-89), lines 52–88; ratified by Ishan 2026-08-04 (D3, option A). The display obligation after P1-E re-routes is carried on P1-E's ledger entry. Cited by reference C5.7.*

### PS-91 — person-level cross-election totals are permitted (rev 2; rev 1 withdrawn)

> ## PS-91 (rev 2) — Person-level cross-election totals are permitted; rev 1 is withdrawn
>
> **Rev 1 is withdrawn.** It ruled that `by_person.direct.total` never renders and never
> enters the person view-model. That ruling is **not in force** and no check implements it.
>
> **Ruled: a direct-receipts total spanning a person's candidacies may be rendered, and may be
> sorted on**, on surfaces framed by the person or listing people. The cross-cycle constraint
> of `p1d-design-inputs` §1 — no view may sum, rank, or share a denominator across cycles —
> binds **district- and race-level** aggregation across disjoint namespaces. It does not bind
> the person. §1's own next sentence names the person as the entity that persists across
> redistricting and the legitimate carrier of cross-cycle connection; the prohibition and the
> carve-out are adjacent clauses of one position, and rev 1 applied the first while treating
> the second as context.
>
> **Why rev 1 was wrong, recorded so the question is not re-litigated:**
>
> - It read PS-79's rejection of B2 as evidence of a strict reading of §1. B2 was an
>   **unwindowed, unlabelled** all-dates figure — "reachable by omission." A labelled total on
>   a surface whose subject is one person is not that shape, and the analogy could not carry
>   the weight placed on it.
> - It used the surface's motivating phrase — "all the money a candidate has taken" — as an
>   argument *against* the figure the surface exists to provide. The hazard in that phrase is
>   that it pulls toward **including independent expenditures**, and that hazard is held by
>   INV-PERSON-2 and the firewall permanently, whether or not a direct-only total renders.
>   Rev 1 collapsed two constraints and let the firewall's caution operate under the
>   cross-cycle rule's name.
>
> **What is unchanged, and is the boundary this ruling does not cross.** The total is **direct
> receipts only**. No independent-expenditure value enters it, shares a denominator with it,
> or is summed into it. INV-PERSON-2 remains a permanent invariant. **PS-90 is untouched** —
> its deferral-scoped exclusion is a separate check with a separate lifetime, and the
> withdrawal of rev 1 does not loosen it. That the two were ruled as separate checks is what
> makes this withdrawal safe to perform one lane after the ruling.
>
> **Ranking honesty is carried structurally, not by caveat.** Where people are ranked by a
> cross-election total, the surface displays each person's **candidacy count in the dataset**
> as its own field, because a total spanning an unstated number of candidacies invites a
> comparison the number does not support. A displayed count discharges this; a footnote does
> not.

*Provenance: P1D-PERSON G1 addendum, sha256 `9352a5f9…` (full sha at §PS-89), lines 61–99; rev 2 ratified by Ishan 2026-08-04. Rev 1 is withdrawn, recorded in the issuing record `d1a77ebc…` §3 and never transcribed. Cited by reference C5.7.*

### PS-92 — a cross-election identity claim rests on person-identity evidence, never on district correspondence

> ## PS-92 — A cross-election identity claim rests on person-identity evidence, never on district correspondence
>
> Where two candidacies in different elections are claimed to be the same person, the claim
> rests on **evidence about the person** — name identity, and human approval of it. District
> adjacency, numbering similarity, or apparent lineage between the two candidacies' districts
> is **not evidence of identity and is never the basis of a link.**
>
> 2024 and 2026 district keys are disjoint namespaces with no crosswalk and no geometry. A
> linkage rule keyed on district lineage would import that crosswalk as evidence and make the
> person layer depend on the correspondence the data model denies — the same claim
> `p1d-design-inputs` §1 forbids at the display layer, entering through the identity layer
> instead.
>
> **District context may be recorded, never relied on.** A link's structured evidence fields
> may carry each candidacy's district string as context, alongside the verbatim name strings
> Phase 1 §8.5 already ratified. Recording is not relying: the fields document what a human
> saw; they do not constitute the basis.
>
> **Name identity alone is a candidate for approval, not an approval.** Full-string name
> identity after normalization is the strongest mechanical signal available and is not
> sufficient by itself: distinct people share names, and a matcher keyed on less than the full
> string produces false pairs — the `(williams, l)` collision between two different people is
> the standing fixture. Every cross-election person link requires human approval on the record.
>
> **A schema that cannot express a decline cannot record a human's judgment.** Where the link
> structure admits approvals only, silence and never-examined are byte-identical, and a pair
> once examined and rejected re-surfaces indefinitely as an unresolved gap. A link structure
> used for human adjudication carries a status vocabulary that can express refusal.

*Provenance: P1D-PERSON G2 ratification record (`g2-ratification-record.md`), sha256 `54920c73983cca04579dbfd61300dd50bbbc29737f7e15aad6341f78ae3ae25e`, lines 73–101; ratified by Ishan 2026-08-05, in force generally (the linkage lane is its first application, not its scope). The record states its text byte-identical to the issuing record `c71ae536…` lines 60–87. Not yet cited by a reference claim row; governs the linkage lane's evidence class.*


---

## Rulings ratified without an id

### Discipline 29 — field closure needs a writer sweep

> - **Disciplines 28** (citations carry file shas), **29** (field closure needs a writer sweep), **30** (planner attests gate compliance; only Ishan attests bytes).

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 37; drafted 2026-07-26. The line also states disciplines 28 and 30; discipline 29 is the clause the reference cites. Cited by reference C2.9.*

### DOCS-M1 C6.4 — documentation drift is audit-only

> - **§6** states once, permanently: **green reconciles and byte-identical artifacts are not evidence about audit-only or render-visible defects.** Fixture: `entity_type` / `_last_edited_by`, dollar-invisible by construction. Carry the repairability axis separately with a named fixture on each side. **Add: documentation drift is itself an audit-only defect** — no dollar moves, no reconcile fails, no gate fires — which is why PS-48 and PS-49 exist and why "we'll remember to keep them in sync" fails structurally.

*Provenance: DOCS-M1 G1 authorization, sha256 `4df35187…` (full sha at §PS-23), line 49 (the §6 requirement; the ruled content is the “documentation drift is itself an audit-only defect” clause); drafted 2026-07-26. Ruled at DOCS-M1 without a PS id. Cited by reference C6.4.*

### SCOPE-PIPE G1 §3 — C4.6 disposition: document the trap

> ## 3. F3 — disposition (c), document the trap
>
> Ruled as recommended. `by_candidate.all` is load-bearing as INV-PERSON-1's dedup identity — the committee-lifetime sum at person grain. The defect was never that fused keys exist; it is that nothing tells the next consumer which key is which, and `by_candidate_election` already serves the election-grain need.
>
> (a) would break INV-PERSON-1, move bytes, forfeit this lane's proof, and destroy the identity role the key exists to serve — to solve a problem no current consumer has. **Banked** against the day a consumer needs an election-keyed *ranking* rollup that `by_candidate_election` cannot serve.
>
> (b) is correctly dismissed: a validator cannot see consumers.
>
> **The reference claim must state both halves** — that the keys are election-fused by construction *and* that election-grain consumers read `by_candidate_election`. A documented trap without a documented alternative just relocates the trap into prose.

*Provenance: SCOPE-PIPE G1 ruling record, sha256 `4a164c97…` (full sha at §PS-82), lines 24–32 (§3); planner ruling, effective with PS-82's ratification per the record's header, 2026-08-03. Ruled without a PS id. Cited by the reference's C4.6-disposition row.*

### SCOPE-UI G1/G3 — display rulings: money/nav semantics; B1–B7; B7 amendment

> - **Navigation is entity-scoped.** The 2024 scope lists races *belonging to* the 2024 election.
> - **Money is window-scoped.** The 2024 scope's aggregate surfaces show the 2024 *window*.
>
> These coincide for everything except money booked on a candidacy of one election inside another election's window — the returners' shared-committee class, which exists because of F1 and the P1-B IE matching, not because of the selector.
>
> **Ruled:** the divergence is a symptom, not a design choice. **Do not resolve it by narrowing the money view to entity scope** — that would hide $663,609 / $401,217 / $340,740-class dollars entirely rather than relocate them. **Do not resolve it by widening navigation to the window** — that puts 2026 races in a 2024 view. The correct resolution is upstream: F1 (PS-77) and P1-E. This lane records the divergence and does not paper over it.

> ## B1. Does the selector expose 2027-municipal?
>
> The artifact holds **53 municipal races**, latent behind coming-soon, zero finance. §1 names the selector as "2026 | 2024" and is silent on municipal.
>
> - **(a) Two options — `2026 | 2024`.** Municipal stays unreachable until it has data. *Recommended.*
> - **(b) Three options, third disabled** — municipal visible but not selectable, signalling what is coming.
> - **(c) Three options, live** — 53 coming-soon shells reachable.
>
> **Recommendation (a).** A selector option leading to 53 empty shells teaches readers the control is unreliable. (b) is defensible if you want the roadmap visible, and is a one-line change later; (c) is not — under PS-79/B1 municipal has no window key, so any figure surface there fails loud, which is correct but not a reader experience.
>
> ## B2. Selector labels
>
> - **(a) `2026` · `2024`** — bare years.
> - **(b) `2026 Election` · `2024 Election`.**
> - **(c) `2026 School Board` · `2024 School Board`.** *Recommended.*
>
> **Recommendation (c).** Bare years read as a date filter, which is exactly the wrong mental model — the ruled model is that elections are entities and races belong to them. Naming the body makes the entity concrete and pre-empts "why doesn't 2025 exist." It also survives B1(b) later without rewording. Cost: longer pills.
>
> ## B3. What a 2024-scoped view is called in prose
>
> **Recommended: "the 2024 school board election"** in running prose, "2024 election" where space is short. **Avoid "cycle"** — it is a pipeline term that cannot express election membership (`'2027'` spans three elections) and should not leak into reader-facing copy.
>
> ## B4. Section ordering within a scope
>
> - **(a) Preserve today's ordering** minus the cross-election interleave. *Recommended.*
> - **(b) Re-sort by district number.**
>
> **Recommendation (a).** Ordering is not this lane's subject, and 2024's null `geo_key` currently sorts those chips first — an artifact of interleaving that disappears once scoped. Report at G2 what the within-scope order actually becomes; if it comes out arbitrary, that is a finding worth a small follow-on, not a redesign here.
>
> ## B5. What replaces the toggle where it sits
>
> Every 2026 race carries a toggle affordance today; 21 sections lose it.
>
> - **(a) Nothing — the space closes up.** *Recommended.*
> - **(b) A static line naming the election scope.**
> - **(c) A link to the same district's other-cycle race where one exists.**
>
> **Recommendation (a).** The toggle asserted a district-level correspondence the data model denies (§8.1 — disjoint namespaces, no crosswalk, geo None). **(c) reintroduces exactly that false assertion** and should not be taken. (b) is redundant once the global selector states the scope. Cross-cycle connection belongs at the person level, which is the by-person surface's job.
>
> ## B6. Empty and pending states a scoped view can reach
>
> Scoping creates states the unscoped view could not: an election with no races matching a filter; a scope where a previously-visible race is absent.
>
> **Recommended:** state visible by default, in the pattern the challenged-status fix established (`p1d-design-inputs` §4). Say what scope is active and that nothing matches it — **not** a bare empty region, which reads as a broken load. Exact strings proposed at G2 against the real states enumerated there.
>
> ## B7. The re-homed returner pointer
>
> The shipped string: *"Campaign finance for this candidate is reported under their current committee — see their 2026 race entry."*
>
> It is the **interim** by-person surface and retires only when the alias is live — a later lane. Re-homing it now must not upgrade it into something harder to retire.
>
> - **(a) Re-home verbatim.** *Recommended.*
> - **(b) Reword for the scoped context** (e.g. naming the 2026 election rather than "race entry").
> - **(c) Make it a link into the 2026-scoped view.**
>
> **Recommendation (a).** It is a ratified editorial string and this lane is not the place to reopen it; verbatim keeps the retirement clean. **(c) is the one to avoid** — a cross-scope link from a 2024 card into 2026 is a navigational cross-cycle assertion of exactly the shape B5(c) is rejected for, and it would make the string load-bearing as a link rather than a note. If the pointer reads poorly once re-homed, that is a finding for the by-person lane, which owns its replacement.

> ## F-2 (editorial half) — B7 amended. **RATIFIED by Ishan 2026-08-03: option (b).**
>
> The report is right that this is stronger than B7's "reads poorly" clause. It is **accuracy**.
>
> The shipped pointer says: *"Campaign finance for this candidate is reported under their current committee — see their 2026 race entry."* After this lane, the 2026 race entry shows only 2026-window money. **The 2024 dollars the pointer exists to explain are not there** — they are in the 2024-scoped spend tab, under the 2026 candidacy's name. The pointer would direct a reader to a place the money is not: a defect **introduced by this lane**, not inherited.
>
> B7(a) was ratified on a premise F-2 falsifies. "Chosen not discovered" covers accepting an interim gap; it does not cover shipping an actively misdirecting instruction.
>
> **Ruled — the destination clause is deleted.** The string at `render.js:647` (`FINANCE_FACET.on_current_record`) becomes:
>
> > **Campaign finance for this candidate is reported under their current committee.**
>
> The em-dash clause "— see their 2026 race entry" is **retired**.
>
> **Implementation constraints:**
> - **Deletion only. No new words.** The surviving text is the already-ratified wording, unmodified — do not reflow, re-punctuate beyond terminating the sentence, or "improve" it.
> - The exact post-edit string is pulled **verbatim from the diff** at G3 and reported as such, never reconstructed from this document.
> - **B7(a)'s no-op finding still stands for everything else:** the facet pointer is otherwise untouched, and it continues to render on the base path where it does today.
> - This supersedes B7(a) **only** as to the destination clause. The by-person lane still owns the pointer's eventual replacement, and this deletion deliberately leaves that unconstrained.
>
> **Why a deletion rather than a repoint:** the true half survives and the false half goes, so no new editorial claim enters the record and nothing beyond the deletion needs ratifying. Repointing at the 2024-scoped spend tab would have made a new navigational claim that the by-person lane would then retire again.

*Provenance, first block (money/nav semantics): SCOPE-UI G3 authorization (`scope-ui-g3-authorization.md`), sha256 `118e06103e266997c9373334675560ce2f5625e73261fc46d1c2475176fbb882`, lines 22–27 (§F-2 mechanism half); ruled 2026-08-03.*
*Provenance, second block (B1–B7): SCOPE-UI G1 display decisions (`g1-display-decisions.md`), sha256 `e2f687ce63649c168fd0f7765434017949d68acc3a5613b9101212b5b413ae25`, lines 42–97 (Part B); ratified by Ishan (the G3 authorization proceeds under them), with each decision's recommended option taken. Ruled without PS ids.*
*Provenance, third block (B7 destination-clause amendment): SCOPE-UI G3 authorization, sha256 `118e0610…` (above), lines 29–49 (§F-2 editorial half); option (b) ratified by Ishan 2026-08-03. Supersedes B7(a) as to the destination clause only. Cited by reference C5.5.*

### P1D-PERSON G1/G2 — display decisions D1–D14 and strings 1–12

The corrected decision map (the addendum `9352a5f9…` silently redefined two ratified ids; cite this map, per the G2 record):

> **Ids are not reused. The corrected map, with (iii) scope applied:**
>
> | id | subject | status | lane |
> |---|---|---|---|
> | D1 | frame under PS-86 → PS-89 rev 2 | ratified | this |
> | D2 | `direct.total` disposition → PS-91 rev 1, **withdrawn** by rev 2 | superseded | — |
> | D3 | IE deferral → PS-90 | ratified | this (display after P1-E) |
> | D4 | navigation; addressable person surface; durable-link clause | ratified | this |
> | **D5** | **naming and identity across elections** | **ratified, in force, not deferred** | this |
> | **D6** | **candidacy layout** — per-member sections, most recent first | **ratified, in force, not replaced** | this |
> | D7 | prior-run context; retire the banked sentences, no rewrite | ratified | this |
> | D8 | returner pointer retires, conditional on the affordance | ratified | this |
> | D9 | empty and pending states | ratified | this |
> | D10 | strings — 1–7 and 11 here; 8, 9, 10 defer | ratified | split |
> | **D11** | **`Person Links` editor column** | deferred | linkage lane (probable) |
> | **D12** | **searchable, sortable people index** | ratified | **index lane** |
> | **D13** | **index de-duplication — one human, one row** | **ratified** | **index lane** |
> | **D14** | **career-total semantics** (§2 below) | **ratified** | this, inherited by index |
>
> The addendum's §3 headings "D4 and D6 as amended" read as **D4 and D12**; its "D5 — deferred to
> its own lane" reads as **D11**. Cite this record for the map.

D14, the career-total semantics:

> **The rule:** the career total is Σ, over a person's member candidacies, of each member's
> own-election-window direct figure.
>
> Its load-bearing claim is SOURCED as of `probe-links-report.md` `969fd9f2…`: none of the five
> out-of-window singles has a counterpart candidacy at any match tier, no committee is claimed by
> two candidacies anywhere in the artifact, and no decline exists to point the other way.
>
> **Recorded so it is not re-argued:**
>
> - For the 18 returners it equals `by_person.direct.total` exactly at this vintage, and G3 asserts
>   that equality so a future divergence fires loudly rather than drifting.
> - For the five singles it excludes out-of-window money, and the exclusion rests on a verified
>   absence of a counterpart candidacy rather than on absence of a link.
> - Index total ≡ Σ of the person page's member sections — the reconciliation a reader can perform,
>   and PS-89's frame arithmetic.
> - The excluded money does not leave all surfaces: the 2024-scope spend tab and committee profiles
>   render it, untouched. PS-86's corollary holds.
>
> **The alternative is recorded as considered and not taken:** committee-lifetime
> (`by_candidate.all.direct`) matches the committee's filed total but breaks the column's own label
> in five live cases and makes the index disagree with the person page.
>
> **Substrate limitation, stated and not inferred past:** the `founded` field exists and is null
> for all 68 committees, so the artifact cannot distinguish a committee predating its candidate's
> race from a prior unattested candidacy. Bannon's rows begin 2022-09-29, before either
> school-board election in the artifact. The rule is correct either way, because it turns on
> attested candidacies rather than committee origin.

The ratified strings (the proposal text, transcribed verbatim from the issuing package):

> 1. **Member section heading, current:** `2026 school board election — District N`
> 2. **Member section heading, prior:** `2024 school board election — District N`
>    (B3's ruled prose form; "cycle" avoided.)
> 3. **Prior election, no itemized money:** `No itemized contributions reported for this election.`
> 4. **Divergent prior name** *(conditional on D5; ships only if the state occurs)*:
>    `Listed in 2024 as {name}.`
> 5. **Prior-run qualifier / notes:** rendered **verbatim from the data**, no wrapper sentence.
> 6. **IE disclosure line, under D3(A)** — *the only new editorial claim in this package*:
>    `Independent expenditures are reported separately and are not included in these totals.`

Dispositions as ratified at the G3 authorization (string 12's text is part of the ratification):

> | # | subject | source | disposition |
> |---|---|---|---|
> | 1 | member section heading, current | `abeefe80…` L299 | ships |
> | 2 | member section heading, prior | `abeefe80…` L300–301 | ships |
> | 3 | prior election, no itemized money | `abeefe80…` L302 | ships |
> | 4 | divergent prior name | `abeefe80…` L303–304 | **does not ship this lane** — §2 |
> | 5 | prior-run qualifier / notes (verbatim from data, no wrapper) | `abeefe80…` L305 | ships |
> | 6 | IE disclosure line | `abeefe80…` L306–307 | ships |
> | 7 | unresolvable person id | `9352a5f9…` §3 | ships |
> | 11 | out-of-window remainder | `54920c73…` §3 | ships, fires on exactly 5 |
> | 12 | person-surface career total label | this record | ships — text below |
>
> **String 12, ratified:** `Total direct contributions`

String 4's non-ship disposition:

> **Ratified: the divergent-name line is not built.** The render path is omitted from this
> lane's diff; the string remains drafted and unshipped.

*Provenance, five sources: strings — G1 decision package (`p1d-person-g1-decisions.md`), sha256 `abeefe80e29aebe992a49f40862b473c99f9feaca50ae4a601b6597a10d017ad`, lines 299–307; D-map and D14 — G2 ratification record, sha256 `54920c73…` (full sha at §PS-92), lines 39–59 and 106–132; dispositions and string 4's non-ship — G3 authorization record (`p1d-person-g3-authorization.md`), sha256 `1dbda314e31147b8f063015bcf1d9d8dd944e10af2ceb80e2ba5f618b61a0e01`, lines 24–36 and 47–48; D1–D10 issued at `d1a77ebc…` §4 (ratified by Ishan 2026-08-04); D11–D14 and sequencing (iii) ratified by Ishan 2026-08-05 at `54920c73…`; final dispositions ratified by Ishan 2026-08-06 at `1dbda314…`. Entry ruled by the G3 authorization §3, answering the G2 statement's flagged question. Cited by reference C5.7 (career-total rule).*
