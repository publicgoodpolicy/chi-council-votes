# Mechanism Reference

**Scope: the whole repo** — the tools (council and elections), the votes pipeline, and the
shared editorial layer. It lives under `campaign-finance/` because that directory is the de
facto home of the entire pipeline, votes included; the path does not scope the content.

**What this is.** The durable how-it-works record for existing tooling: the answers a probe
would otherwise re-derive. The other document classes structurally cannot hold this content —
the handover supersedes itself every cycle, the ledger is a queue, the disciplines are
process. This document holds mechanism.

**Scope rule — NO STATE FIGURES.** No row counts, dollar totals, baselines, reconcile counts,
artifact hashes, or cycle-current numbers anywhere in the prose. Those live in the handover
and are designed to rot. Admission test: *would this claim still be true after a data
refresh?* Mechanism claims survive refreshes; state figures do not. Where a mechanism claim
needs a number to stand, the prose states the mechanism and cites the number's source: current
state → the handover; a historical finding → the sha'd report that established it.

**Amend, never supersede.** This document is edited in place. A superseded mechanism claim is
struck with its replacement adjacent, not silently overwritten. An edit that changes a
documented mechanism carries its documentation update **in the same commit** (discipline 33) —
there is no window in which code and this document disagree.

**Form — the tier split and the label set.** Tier 1 is durable prose: behavior described by function
and effect, **no line numbers**. Tier 2 is the citation appendix (§8), which carries the
precision and is expected to age; ageing is detected, not prevented. Every Tier-1 claim
carries a claim-id (`[C…]`) and exactly one label:

- **SOURCED** — resolves to a §8 appendix row (file, line, file sha).
- **RULED** — normative content established by ratification; carries a ratification pointer
  in §8 in place of an appendix row: ruling ID + **any hashed, on-disk, immutable lane
  artifact carrying the ruling** — gate reports and governing input briefs alike — with the
  handover revision as fallback for conversationally-ratified rulings (PS-58, widened by
  PS-65).
- **UNVERIFIED** — no supporting bytes; sub-class stated: *gap* (should be closed, isn't) or
  *deferred-by-design* (deliberately parked, owned by another lane).

**Citation direction.** The operator runbook cites this document as the ordering authority;
this document never cites the runbook. One-way, by rule.

**Relationship to executor memory.** `MEMORY.md` and lane files are one executor's working
record; they do not survive context resets or reach the planner. This document is the shared
authority of record. Where they disagree, this document wins and the disagreement is a flag.

**Non-goals:** current state, queues, process discipline, operating procedures (runbook),
design intent and editorial rulings (design doc / handover rulings).

---

## §1 — Build chains and orchestration

**The ordering below is a requirement on callers, not a description.** [C1.1, RULED] Any
script, lane, or person invoking these steps must preserve the stated order; a new caller
that reorders them re-opens defects this section exists to prevent. Known callers at
ratification: the canonical council chain, the canonical elections chain, and `build_all.sh`
— all aligned.

### The chains (machine-readable block) [C1.1, RULED]

```chains
council-canonical:
  convert_bulk_receipts -> ingest -> repair_clusters -> transform_slice1
  -> transform_slice2 -> ingest_ie -> enrich_committee_names -> sync_overrides
  -> build_rollups -> build_shards -> validate_council_data

elections-canonical:
  build_election_seed -> ingest -> transform_slice1 -> transform_slice2
  -> ingest_ie -> enrich_committee_names -> sync_overrides -> build_rollups
  -> validate_council_data

build_all.sh (votes builder; finance section conforms to council-canonical,
omitting by design: convert_bulk_receipts, repair_clusters, ingest_ie,
enrich_committee_names):
  sync_bios -> ingest_votes -> sync_allvotes -> [ingest, gated on staged receipts]
  -> transform_slice1 -> transform_slice2 -> sync_overrides -> build_rollups
  -> build_shards -> validate
```

This block is the ordering authority of record; `build_all.sh` and the runbook's operational
sequence are implementations of it. Citing an implementation as the *source* of the order
would re-invert the authority. The appendix records that `build_all.sh` **conforms to** this
block as of this commit — a conformance record, not a source citation [C1.9, SOURCED]. The
proposed chain-consistency check (Proposals) diffs implementations against this block.

### Truncation vs order [C1.11, RULED]

A lane may run a **contiguous truncation** of a canonical chain where every omitted step
provably touches nothing the lane changes — C1.1 binds the **order** of the steps that run,
not completeness. Conditions, all required: per-step justification in the lane report,
naming what each omitted step writes and why the lane's change cannot reach it; truncation
only, never reordering; and the executed chain recorded in the lane record — gate report
and commit message, against the produced artifact's sha — so a later reader does not infer
a full-chain vintage. This is not a licence to trim by convenience: C1.5 and the IE re-run
rule exist because skipped steps have burned this pipeline before (PS-80).

### What `build_all.sh` is [C1.2, SOURCED]

The repo's **only shell orchestrator and the sole end-to-end builder of the votes pipeline**.
It syncs the alder roster, fetches roll-call votes (the fetch nothing else invokes), syncs
the All Votes tab, optionally ingests staged finance receipts, rebuilds the derived layers,
and ends in a validation gate. There is **no CI**: no workflow files exist, and the script's
own header records that it replaced a nightly GitHub Action that could not fetch votes from
datacenter IPs [C1.8, SOURCED]. It runs on a human's machine, by hand.

### Ordering constraints and why each exists

- **`sync_overrides` after `ingest`** [C1.3, SOURCED]. Ingest's donor-union rebuilds each
  donor from the fresh parse and carries forward only a preserved subset of prior fields.
  Sheet-owned fields — the donor's entity type and the last-editor stamp — are not in
  that subset, so ingest clears them and the Sheet re-apply is their **sole restorer**.
  Run before ingest, the re-apply is destroyed by the very step it exists to survive. This
  ordering defect shipped and was fixed on this script; the fix holds only while callers
  respect this constraint. The absence of a code-side preserve for those fields is a
  **closed ruling, not open work**: step-8 re-apply is the intended architecture [C1.10,
  RULED].
- **`sync_overrides` before `build_rollups`** [C1.4, SOURCED]. Rollups aggregate by donor
  classification and by cluster-parent attribution. Run before the Sheet apply, rollups
  compute on unsynced classifications and an empty IE-industry layer — published aggregates
  that silently ignore the editorial layer.
- **`transform_slice1` before `ingest_ie`** [C1.5, SOURCED]. `ingest_ie` runs an internal
  rollup pass at its end, and rollups must never run while any donor lacks a parent
  attribution; slice1 guarantees every donor carries one.
- **`repair_clusters` after `ingest`, before the transforms (council)** [C1.6, SOURCED].
  A re-ingest can drop or rename donors a Sheet cluster references, leaving cluster blocks
  pointing at absent members; the repair re-stamps, reparents, or dissolves deterministically
  before anything derives from cluster state.
- **The cluster-refresh position is load-bearing** [C1.7, SOURCED; requirement framing
  RULED]. The Sheet apply's cluster pass writes parent attribution **directly** onto donors,
  after the transforms and before rollups — it is the *last* parent-attribution writer in
  the chain. That position is the only reason a Sheet cluster edit reaches the same run's
  rollups (slice1's earlier derivation uses prior-run cluster state and is superseded within
  the run). Any future reordering that moves the cluster pass off this position re-opens a
  one-run cluster lag. Positional, therefore fragile, therefore recorded here.

---

## §2 — Donor field ownership map

Ownership of every donor field with editorial character. "Union-preserved" means ingest's
donor-union carries the existing value across a re-ingest; "step-8 re-applied" means the
Sheet apply rewrites it from the Sheet each run. The precision (functions, lines) is in §8.

| field | writer(s) | union-preserved? | step-8 re-applied (Sheet tab · column) | with step 8 | without step 8 |
|---|---|---|---|---|---|
| `industries` [C2.1, SOURCED] | ingest auto-classifier; editor via Sheet | **partial** — preserved unless the stored value is exactly the bare unclassified marker, which is dropped and re-classified | yes (Donor Overrides · primary_industry + additional_industries); last writer wins | Sheet value governs | auto-classifier governs |
| `flags` [C2.2, SOURCED] | editor via Sheet | yes (if non-empty) | yes (Donor Overrides · flags) | Sheet flags present | survives via union |
| `notes` [C2.2, SOURCED] | editor via Sheet | yes (if non-empty) | yes (Donor Overrides · notes) | Sheet notes present | survives via union |
| `entity_type` [C2.3, SOURCED] | **editor via Sheet only** | **no** | **yes — sole restorer** (Donor Overrides · entity_type) | restored | **cleared, never restored** |
| `_last_edited_by` [C2.3, SOURCED] | **editor via Sheet only** | **no** | **yes — sole restorer** (Donor Overrides · last_edited_by) | restored | **cleared, never restored** |
| cluster fields + `parent_id` [C2.4, SOURCED] | Sheet apply's cluster pass; `parent_id` also transforms | yes (guarded cluster-field carry) | yes — reset then re-tag (Donor Clusters tab) | authoritative from tab | survive one run via union |
| `aka` [C2.5, SOURCED] | Sheet apply's merge pass | no | **recomputed** each run (Donor Merges tab) | rebuilt | dropped, rebuilt next step-8 run |
| `slug_aliases` [C2.6, SOURCED] | Sheet apply's alias matcher | n/a | recomputed each run | rebuilt | absent |
| `ie_funding`, `type`, identity fields (name, city, occupation, employer) [C2.7, SOURCED] | ingest / IE ingest (machine-derived) | overwritten by fresh parse | no | machine facts | machine facts |

**The split that matters:** every field above is Sheet-owned or machine-derived — and the
step-8-only-restored set is exactly the fields marked "sole restorer" — no other **field**
shares the position (closed by writer sweep).

**A value-class shares the property without sharing the position** [C2.10, SOURCED;
routing RULED]: `industries == ['unclassified']` is step-8-only-restored at **value**
granularity — lost on any step-8-less run, restored only by the Sheet round-trip, because
the union deliberately re-classifies the bare marker (§3). It is **not preserve-eligible**:
preserving it wholesale would break the legitimate re-classification of a *stale*
unclassified org. By ruling it is **routed to the 1a editorial-state arc, not to a′** — the
field-granularity closure above is untouched by it.

Fields resolved as *not* in the position, and why (negative results are half this table's
value): `parent_id` is both union-preserved and transform-recomputed; `aka` is recomputed
from its tab every run. Neither needs — or can meaningfully take — a code-side preserve.
[C2.4, C2.5]

**Sheet-owned writer set, by name** [C2.8, SOURCED]: `primary_industry` +
`additional_industries` (→ `industries`), `flags`, `notes`, `entity_type`, `last_edited_by`
(→ `_last_edited_by`). Nothing the pipeline derives is ever written back to the Sheet in the
donor-editorial domain (§3).

**Method note of record (discipline 29)** [C2.9, method RULED; fixture SOURCED]: closing a
field census requires a **writer sweep** — every assignment site in every writer — not a
populated-key census of the artifact. A populated-key census cannot see fields that are
currently unpopulated or recomputed. Fixture: `aka` — populated on zero donors at census
time, invisible to the key census, caught by the writer sweep, resolved as recomputed.

---

## §3 — Classification mechanics

**The fallback buckets, and neither is a classification.** [C3.1, C3.2, SOURCED] The
`individual` label is assigned by a **name-format short-circuit** — a comma-form name
without org tokens is tagged `individual` *before any industry rule is consulted*. It is a
statement about the name's shape, not the donor's industry. (Ruled fixture: the w-r-weiss
question — answered: fallback bucket, not classification.) The `unclassified` label is the
**org-side no-match fallback**: a non-individual name matching no industry rule. These
buckets are where donors land *absent* evidence, not because of it.

**The Sheet-only label tail — editors own most label diversity.** [C3.3, SOURCED] The
auto-classifier emits materially fewer labels than the artifact carries; the difference
enters exclusively through the Sheet, so the classifier cannot reproduce the published label
space from raw data. The Sheet-only labels at the establishing census (names, not counts;
the emitted-vs-carried numbers and per-label figures live in the sha'd census report, §8):
`business-general`, `business-lobby`, `candidate-account`, `construction`, `corporate`,
`corporate-legal`, `corporate-tech`, `labor`, `lobby-business`, `lobby-general`, `media`,
`tourism`, `utilities`.

**Members of the label space that are not industries.** [C3.4, SOURCED; display ruling
pointer per PS-58 — see §8] `individual` is a name-format bucket (above), and
`self-funding` is a **money-type** — it records that the money is the candidate's own, not
what industry it came from. (`candidate-account`, Sheet-only, is likewise a money-type by
name.) Rendering any of these as an industry is one category error, not a coincidence
(ruling PS-12).

**The deliberate blank is inexpressible.** [C3.5, SOURCED] An editor cannot mark a donor
"examined — genuinely no industry" in a way the code can distinguish from "never examined":

- **Empty cell:** the Sheet reader only carries non-empty cells, so an empty
  `primary_industry` produces no override; the merge falls through to the existing value —
  which after ingest is the auto-classifier's. **The classifier wins.** A deliberate empty
  cell and an unexamined one are byte-identical inputs.
- **Literal `unclassified` string:** carried and applied like any override, so it survives —
  but **only via the step-8 round-trip**, because ingest's union deliberately drops a bare
  unclassified marker and re-classifies (that drop is what lets a *stale* unclassified org
  pick up a rule match on later runs). The Sheet string is the only durable carrier.

**Unclassified-precedence merge, by behavior** [C3.6, SOURCED]: the merge takes the Sheet's
primary industry when present, else keeps the existing first industry; additional industries
append without duplication. Combined with the union rule above, "unclassified" is stable
only as an explicit Sheet value, never as an artifact-resident state.

**Direction of flow** [C3.7, SOURCED]: in the donor-editorial domain, values flow
Sheet → artifact only; no pipeline value returns to the Sheet. Qualifier so no one
over-generalizes: the votes tab **is** machine-written — the vote sync clears and rewrites
the machine vote columns while reading and re-emitting the editor columns. That is a
votes-domain scaffolding write, not classification write-back.

---

## §4 — Cross-surface identity and reachability

**How classification reaches every tool surface** [C4.1, C4.2, SOURCED]: donor identity is
a **pipeline-minted slug of the donor's name** — stable across runs, which is what keeps
Sheet overrides attached. The tools read the same master Sheet, so an editorial
classification propagates to any surface whose donor slug matches. Established fixture: a
single Sheet reclassification propagated into the elections artifact's industry rollups via
the shared Sheet (the establishing lane record is pinned in §8).

**Name-form duality and the alias rule** [C4.4, SOURCED]: Illinois files the same person's
name differently by form — direct contributions as "Last, First", IE-committee funder receipts as
"First Last" — so the IE ingest can mint a second donor id for a person the Sheet already
knows. The alias matcher maps a Sheet id to its election donor by sorted-token key, **gated
by uniqueness**: no match → skip; exactly one → alias; two or more → editorial worklist,
never a guess. **The minted donor id is never rewritten** — aliasing, not rewriting, is the
rule, and both filed spellings stay visible.

**Candidate election identity is stamped, and checked** [C4.5, SOURCED; validator
requirement RULED]: elections-artifact candidate records carry `election_id`, stamped by
the seed from the resolved race at record construction and verified by a **single shared
mismatch implementation** (stamped-vs-resolved, race-id namespace, 2024-signature cohort,
conservative candidate-id conventions with a no-claim default) run at mint — seed, fatal,
nothing written on failure — and at the chain gate (the INV-ELECT block). The seed's
unknown-race-id check is likewise fatal; warn-and-emit is retired. Per PS-81 the coverage
limit travels with the mechanism: it catches cross-namespace and 2024-cohort misfilings,
**not** same-election wrong-district errors (a separate, separately banked class). Field
name and meaning match `by_person.members[].election_id` — one artifact, one vocabulary.

**The fused rollups are fused by construction, and the election-grain key already exists**
[C4.6, SOURCED; disposition RULED]: `rollups.by_candidate` and `rollups.by_race` are
committee-lifetime sums keyed without election — deliberately: `by_candidate.all` is the
dedup identity INV-PERSON-1 pins. They must not be read where election grain matters;
election-grain consumers read `by_candidate_election`, which exists for exactly that need.
Ruled disposition (SCOPE-PIPE): documented, not re-keyed — re-keying would destroy the
identity role while serving a need the election-keyed rollup already meets.

**Committee ownership is resolved, not ordered** [C4.7, SOURCED; ownership rule RULED]:
a candidate committee claimed by more than one candidacy belongs to the **most recent
claimant by election date**, resolved by ONE shared implementation
(`ingest.resolve_committee_claimants`) with three callers — ingest's linkage map, the
idempotent artifact re-stamp (`restamp_committee_linkage.py`, which carries no logic of
its own and so cannot drift), and the INV-LINK gate's expectation — never by iteration
order, which was F1's defect. The prior candidacy's claim is nulled; its `finance_facet`
becomes `on_current_record` **only when prior-window money exists on the shared
committee** (PS-84's conditional — the facet is a reader-facing sentence and must stay
true; PS-77's letter is amended, not glossed). INV-LINK-1..3 check the stamp, the
money-requires-a-claim rule, and `owns_committee` against expectations recomputed from
`candidates[].committee_id` claims (PS-82: different fields, different writers; the
coverage limit is stated at the check's site — a mis-authored claim defeats both sides
and belongs to the authoring layer, guarded by INV-ELECT).

**Known reachability failure — the `ie-committee-*` suffix gap** [C4.3, UNVERIFIED —
**deferred-by-design**]: committee-derived donor identifiers that carry an appended
committee suffix fall outside the plain name-slug identity space, creating a reachability
gap for Sheet edits. It has its own queued lane, which owns `ingest_ie.py` as an edit
surface; the mechanism is deliberately **not** characterized here — describing its existence
and boundary is this document's job, deriving its internals is that lane's. (The one
in-tree ordering referent living in that file — an argparse help string — is likewise
deferred to that lane, since help-string text is program-visible data outside a docs lane's
reach.)

---

## §5 — Render paths

**The render paths are fully separate, and each is hand-maintained.** [C5.1, SOURCED]
The council embed and the elections embed share no component; a fix applied to one does
not exist in the other. **Firewall compliance is therefore a per-path property** — it must
be established, and re-established, per embed, and a new tool brings its own path with its
own compliance obligation.

**What each reads** [C5.2, SOURCED]: the council embed fetches the council artifact
(`council-data.json`), with an optional sharded mode reading the index and contributions
shards; the elections embed renders the elections artifact (`election-data.json`) and
deploys as a single inlined file. Neither renders the donor entity-type or last-editor
fields — established by sweep at the lane of record (§8).

**Corollary of record** [C5.3, SOURCED]: **data-layer firewall asserts do not cover
render-layer sums.** The artifact can keep direct and independent spending cleanly separated
while a render site fuses them in display — that class shipped past every gate precisely
because the gate checked rendered values, not fused-on-per-candidate structure. The proposed
fused-per-candidate detector (Proposals) exists to close that seam.

**The elections path renders election-first** [C5.5, SOURCED; money/nav semantics RULED]:
a global election selector (labels from the ratified `{year} {body}` pattern — a future
election is a data addition, never a copy edit) scopes race enumeration to one election;
per-race figures are windowed to the race's own election (PS-79/A1); the per-race
cross-cycle toggle and the per-tab union time scope are retired, so **no cross-election
window is resolvable from any UI surface**. Money surfaces are **window-scoped** while
navigation is **entity-scoped** (ruled at SCOPE-UI): activity booked on another election's
candidacy ids inside the selected window renders on the money surfaces, and that
divergence resolves upstream (F1/PS-77, P1-E) — never by narrowing money to entity scope
or widening navigation to the window.

**Surface class determines scoping rule** [C5.6, RULED; shape SOURCED]: a surface is
scoped by **what it presents, not what it looks like** — a control that resembles
navigation but organizes money (a grouping, a section list, a dropdown over a money view)
follows the money rule. **Frame and contents scope separately**: the selector's chosen
election establishes the frame, and every in-frame race is present money or not —
in-frame absence is information (a visible zero is a finding on a transparency tool) —
while an out-of-frame race appears **iff** it carries in-window money (presence must be
earned; out-of-frame empty sections are impossible). Corollary: a scoping change that
makes money unreachable on a surface where it was reachable is a regression regardless of
how principled the argument sounds. (PS-86. The occasion: the aggregate scope guard — the
last exclusion-based scoping mechanism — was removed under PS-76 once the selector's
window replaced it structurally; the grouped money view's section list follows this
frame+contents shape, each section labeled with its race's election via the shipped
pattern.) Section **order** follows the same distinction: in-frame sections precede
out-of-frame ones — the frame is what the reader selected, so it leads — and no new
within-group convention exists; the pre-existing order continues inside each group
(fold-in ruling on PS-86, ratified 2026-08-03).

**Sizing note** [C5.4, SOURCED]: the tools present multiple distinct public surfaces,
which multiplies render paths, not merely classification consumers. The surface count is
current state and lives in the handover, not here.

---

## §6 — Defect visibility classes

Every mechanism defect falls into one or more [C6.1, SOURCED]:

- **Dollar-visible** — moves published figures; reconciles and gates can see it.
- **Render-visible** — changes what a reader sees without moving a dollar; gates
  historically could not see it (§5's corollary).
- **Audit-only** — moves neither; provenance or editorial-state loss.

**The rule this taxonomy exists to state, once and permanently** [C6.2, SOURCED]:
**green reconciles and byte-identical artifacts are not evidence about audit-only or
render-visible defects.** Fixture: loss of the donor entity-type and last-editor fields is
dollar-invisible **by construction** — no amount of reconcile green proves it never
happened, in either direction.

**The repairability axis is separate from visibility and sizes severity** [C6.3, SOURCED]:

- **Sheet-sourced → transient.** A field the Sheet fully owns is restored completely by the
  next canonical run; the defect is a bounded published-artifact window. Fixture: the
  entity-type / last-editor clear — repairable, and repaired, by any chain run.
- **No Sheet source → permanent.** A field written only in the artifact has no repair path;
  a clobber is unrecoverable. Fixture: the legacy committee-notes strip — severe precisely
  because nothing re-sourced what it deleted.

**Documentation drift is itself an audit-only defect** [C6.4, RULED]: when code and its
documentation diverge, no dollar moves, no reconcile fails, no gate fires — which is why
same-commit documentation (discipline 33) and the proposed consistency checks exist, and why
"we'll remember to keep them in sync" fails structurally.

**Known risk — what this document's own mechanical check cannot see** [C6.5, RULED]: the
scope-rule check greps the prose for **digit runs**, and this document deliberately states
its structural facts as properties or spelled words. A clean result therefore establishes
that **no count appears in digit form in the prose tier — not that the scope rule is fully
enforced**: a count spelled as a word is invisible to it, and can go stale with nothing
detecting it. The failure shape is documented from this document's own founding arc: the
invisible-defect detector class grew from three members to four within a single arc — a
worded size would have silently lied. The mitigation is **stating properties rather than
quantities** (separate/hand-maintained rather than a path count; members by name rather
than a member count), not a stronger grep — the audit-only taxonomy above is exactly where
this risk lives.

**A guard does not consume the field it guards** [C6.6, RULED]: a validator, gate check,
or guard derives its expectation from inputs independent of its subject — never from the
value it checks or a field whose correctness it exists to establish. Corollary: a check
that must read its subject is a restatement, not a check; where no independent input
exists, the claim is recorded UNVERIFIED rather than shipped as a check that cannot fail.
(PS-82. Instances of record: INV-PERSON passing on the F1 misattribution because it
derives from the same stamped linkage; two near-misses caught at SCOPE-PIPE's gates.)

---

## §7 — Glossary of overloaded terms

- **"mapped"** [C7.1, SOURCED] — overloaded senses. (1) *Race-map membership*: a committee present
  in the elections race-map's mappings, which defines refresh scope — "unmapped" committees
  are untouched by a mapped-scope refresh, not absent. (2) *SBE-id mapping*: a committee
  record carrying its SBE committee id, which drives the reconcile join. A committee can be
  sbe-mapped while race-map-unmapped; conflating the senses misstates scope.
- **"step 8"** [C7.2, SOURCED] — positional name for the Sheet apply (`sync_overrides`) from
  its slot in the canonical chains (§1). The name survives even where an implementation's
  own numbering differs; it always means "the Sheet re-apply that runs after ingest and
  before rollups."
- **"unclassified"** [C7.3, SOURCED] — senses the pipeline cannot distinguish (§3): the
  org-side no-match fallback the classifier emits, and an editor's deliberate
  "examined, none" verdict. Only the latter's explicit Sheet string survives rebuilds.
- **"preserve-list"** [C7.4, SOURCED] — the set of prior-donor fields ingest's union carries
  across a re-ingest. Not an allow-list of editorial fields generally: Sheet-owned fields
  (the entity type and the last-editor stamp) are deliberately outside it (§2), by closed
  ruling.
- **"behind"** [C7.5, UNVERIFIED — **gap**] — used in lane records for artifact/comparator
  staleness; no banked byte source defines its senses. Left undefined rather than inferred.

---

## Proposals — detectors proposed, not built

**The invisible-defect detector class** (ruled; members enumerated below by name): checks
that catch defect classes the existing gates structurally cannot see.

1. **Fused-per-candidate render detector** [P1, SOURCED] — proposed at the firewall lane of
   record: gate-level detection of fused direct+IE figures appearing on per-candidate
   surfaces (structure, not values — the gate's historical blind spot, §5).
2. **Citation-freshness check** [P2, RULED] — verifies §8 appendix rows still match the
   files at HEAD. **Open design question, deliberately unresolved:** *hard-fail* (blocks on
   any stale row; risk: routine overrides normalize ignoring it, and a gate routinely
   overridden is worse than no gate) vs *review-required* (flags for human judgment; risk:
   flags accumulate unactioned and the appendix silently rots). Both failure modes stated;
   semantics to be ruled when built.
3. **Population trip-wire** [P3, RULED] — post-build check that the entity-type /
   last-editor population has not collapsed versus the Sheet (the audit-only loss §6
   fixtures). Failure mode: population legitimately shrinks when Sheet rows are removed, so
   a naive threshold false-positives; the check must compare against the Sheet, not history.
4. **Chain-consistency check** [P4, RULED] — diffs §1's machine-readable block against
   the runbook's operational copy and against the actual invocation order in `build_all.sh`
   (the conformance record in §8 is its baseline). Failure mode: parsing shell reliably is
   hard; a checker that only pattern-matches invocation lines can be fooled by refactors —
   scope it to the named steps, not general shell semantics.

---

## §8 — Citation appendix (Tier 2)

**File sha legend** (sha256 at the commit that authored/last amended each row):

| tag | file | sha256 |
|---|---|---|
| S-ing | `campaign-finance/ingestion/ingest.py` | `5e2c2e2175fa8ed4de0d4a7dd2ffdd70208c5df206b50200faf6225359a7d4cf` |
| S-syn | `campaign-finance/sheets-sync/sync_overrides.py` | `5162f700c72f1fc02b40e65ecf0bbdf3d4955a712eb8525055aa7a0cc06a6098` |
| S-bld | `campaign-finance/build_all.sh` | `c652ab26b6d4ea58bfffd3b6f4f13e19c70dc05d958553a1a94ce3e48c2db053` |
| S-t1 | `campaign-finance/ingestion/transform_slice1.py` | `5f807b26245ee22173d3903b9b8a3825f224c47c4f2d7ad11042ee87a6ccb68d` |
| S-ie | `campaign-finance/ingestion/ingest_ie.py` | `242caca31d35adfd962f5f1c2897c07345afe1a26286f2cc6ffd779376847158` |
| S-rep | `campaign-finance/ingestion/repair_clusters.py` | `90cc6912647479510d10d505debb84d18fbd28557bf5996b01a992eb1ddf283c` |
| S-rol | `campaign-finance/ingestion/build_rollups.py` | `a37a9ee4a1fe93a66dae7c6ecb50e3face70f05078e7fbc97e088a4cafb4fe89` |
| S-seed | `campaign-finance/elections/build_election_seed.py` | `a2122eab99c8e6db401801a97e43537a4eea62ae1f7b4f13cdb03e8a761a20f7` |
| S-vld | `campaign-finance/ingestion/validate_council_data.py` | `6c83c3d5ab25b0ea402f06ae3a0d1e456d0497f23f91527f8ce7276d19900538` |
| S-rst | `campaign-finance/ingestion/restamp_committee_linkage.py` | `6ceb82f9bbcffa08fdb21904b8585982a6bff7e3982e0b810937e2958019d06e` |
| S-av | `campaign-finance/sync_allvotes.py` | `2ca09ee7323741919f048e61062d54a62719f56f88f71f99b721fe965c753f69` |
| S-cemb | `campaign-finance/elections/reference/council-embed.html` | `f1451fa9900a7a645fec202f7226b26b95597b008c119be28747de81b89be111` |
| S-eemb | `campaign-finance/elections/embed/elections-embed.html` | `8fb04287a9a542f15c3d28e65bd3c1a400edd08ceef697e985bd0491f74359f9` |
| S-edat | `campaign-finance/elections/embed/data.js` | `3fb88346eb67dafd476868bf8b3bcd15e0001888205fd69a81febd50a447e47a` |
| S-eren | `campaign-finance/elections/embed/render.js` | `bb4e28f761bb812de6a99c76c7c4af49de14f50a1203418f36a01d525cc691bc` |
| S-eapp | `campaign-finance/elections/embed/app.js` | `ec42983763f18ca5d6f134bcd51a7578858e79787cbaba9b716daea2714c8f7c` |
| A-probe | `~/probe-sync-2026-07-24/probe-report.md` | `4c678cf0c14dd370f8b52744bf473000340ce16449a5365841b6ac92d8e5f9bb` |
| A-add | `~/probe-sync-a-2026-07-24/addendum-a-report.md` | `468ba24f4f418f72c2720608353c83e52694c41637cf9ff16a9b267d37e49ed6` |
| A-ba1g0 | `~/halt-ba-1-2026-07-24/g0-report.md` | `9aeaa793fd5f4afe59d9ac504f7f00dd219f4417cbafdd3403e5a44f661e812e` |
| A-ba1g2 | `~/halt-ba-1-2026-07-24/g2-g3-report.md` | `05746b6bad73da0bc1eb9df3f4fa87e725b143ca129b5e4621162e58da3922d1` |
| A-fw1 | `~/halt-fw-1-2026-07-23/g0-consolidated-report.md` | `43dc9f2b2e76bdf914dbbacbe0b06006485c4aa70d26b9393192bd34a55d8239` |
| A-bbg0 | `~/halt-bulk-b-2026-07-22/g0-report.md` | `d6a65529623c7928a80ef2016f1f905af93d359a749e37dd3f150e5471aa6dc1` |
| A-bbg1 | `~/halt-bulk-b-2026-07-22/g1-report.md` | `594c8c4da6db7a1a6d1768ff0d81eedd0c1030e3d20b56285c9a5166d96c5846` |

**SOURCED rows** (`claim-id | file | line(s)`):

| claim | file | line(s) |
|---|---|---|
| C1.2 | S-bld | 3-8 (header: one local builder), 49 (the vote fetch) |
| C1.2 | A-ba1g0 | 25-42 (§G0.1 sole-orchestrator census: only .sh, no CI, fetch invoked nowhere else) |
| C1.3 | S-ing | 488-509 (donor-union; preserved subset 492-500, 506-508) |
| C1.3 | S-syn | 570-581 (sole-restorer writes) |
| C1.3 | A-ba1g0 | 44-54 (§G0.2 the firing configuration), 56-66 (§G0.3) |
| C1.4 | S-seed | 57-61 (rollups-last rationale), 63-70 (governing rule) |
| C1.4 | S-rol | 284-285 (runs-last comment) |
| C1.5 | S-ie | 15 (imports rollups), 335 (internal rollup call) |
| C1.5 | S-seed | 63-65 (must-never-run-without-parent rule) |
| C1.5 | S-t1 | 10-16 (parent derivation from cluster state) |
| C1.6 | S-rep | 10-24 (post-re-ingest repair: re-stamp / reparent / dissolve) |
| C1.7 | S-syn | 449-466 (reset), 506-511 (cluster pass writes parent directly) |
| C1.7 | S-t1 | 10-16 (prior-run derivation it supersedes) |
| C1.8 | S-bld | 4-8 (replaced the nightly Action) |
| C1.9 | S-bld | 62, 79, 80, 86, 87, 88, 92-94 (invocation order conforming to the block; executable content verified byte-identical, comment-stripped, to the pre-amend revision recorded in the BA-1 lane) |
| C2.1 | S-ing | 86-127 (rules), 130-141 (classifier), 314-320 (assignment), 492-496 (partial preserve) |
| C2.1 | S-syn | 564-570 (merge) |
| C2.2 | S-ing | 497-500; S-syn 161-165, 572-575 |
| C2.3 | S-ing | 506-508 (absent from carry); S-syn 166-171, 576-581 (sole restorer) |
| C2.4 | S-ing | 501-508 (guarded carry); S-syn 449-466, 506-511; S-t1 10-16 |
| C2.5 | S-syn | 415-417 (recompute); A-add 146-160 (§A4.2 writer sweep, census-invisible) |
| C2.6 | S-syn | 590-630 (alias matcher) |
| C2.7 | S-ing | 294-306 (type), 316-334 (identity fields) |
| C2.8 | S-syn | 146-173 (tab reader: the writer-set columns) |
| C2.9 | A-add | 141-160 (§A4: sweep method, aka fixture) |
| C2.10 | A-add | 87-98 (§A2.3: the value-granularity qualifier — property shared, position not) |
| C3.1 | S-ing | 130-141 (short-circuit before rules), 182-189 (name-format heuristic) |
| C3.1 | A-probe | 96-118 (§P3: fallback characterization, w-r-weiss answered) |
| C3.2 | S-ing | 141 (org no-match fallback) |
| C3.3 | A-add | 116-139 (§A3.4: label census; Sheet-only enumeration; numbers live here) |
| C3.4 | S-ing | 130-141 (individual = name shape), 311-312 (self-funding = money provenance) |
| C3.5 | S-syn | 156 (empty cell carried only if non-empty), 565 (fall-through); S-ing 492-496 (union re-classifies bare marker) |
| C3.5 | A-probe | 74-94 (§P2, both representations) |
| C3.6 | S-syn | 564-570 |
| C3.7 | S-syn | 101, 108, 119 (read-only Sheet access); S-av 40-42, 85-96, 99-101 (votes-tab machine write, editor columns preserved) |
| C3.7 | A-probe | 120-130 ((b) universality + qualifier) |
| C4.1 | S-ing | 147-156 (slug minting; stability rationale in situ) |
| C4.2 | A-bbg1 | 38-40 (SEIU propagation fixture: shared Sheet → elections artifact) |
| C4.3 | A-probe | 152 (banked open-thread naming; mechanism deliberately not characterized here) |
| C4.4 | S-syn | 590-630 (uniqueness-gated alias; never rewrite) |
| C4.5 | S-seed | 257, 284, 309 (the three stamp sites), 354-359 (fatal unknown-race-id), 362-368 (mint-time shared check, fatal) |
| C4.5 | S-vld | 175-241 (the ONE shared implementation: namespace/convention resolvers + election_mismatches), 244-255 (durable INV-ELECT gate), 82 (wired into validate) |
| C4.7 | S-ing | 681-706 (resolve_committee_claimants — the ONE resolver), 585-599 (deterministic linkage build consuming it) |
| C4.7 | S-rst | whole script (claims-derived re-stamp; ruled-four-fields write; fifth-field fail-loud; idempotent) |
| C4.7 | S-vld | 253-319 (INV-LINK-1..3 + coverage-limit statement), 83 (wired into validate) |
| C4.6 | S-rol | 109-112, 127-130 (by_candidate/by_race keyed (id, cycle) — no election), 132-204 (by_candidate_election, the election-keyed variant) |
| C4.6 | S-vld | 135-141 (INV-PERSON-1 pins by_candidate.all as dedup identity) |
| C5.1 | A-fw1 | 7-16 (fix sites exist only in the elections path; artifact layer separate) |
| C5.2 | S-cemb | 42-52 (dataUrl + optional sharded mode); S-eemb 19-24 (elections artifact + inlined deploy) |
| C5.2 | A-ba1g2 | 49 (Rider 2: neither embed renders entity-type / last-editor) |
| C5.5 | S-edat | 110-116 (selectorOptions — the {year} {body} pattern), 812-830 (officeRaces election scoping via the year-prefix join), 761 (the race's window rides the VM), 778 (priorElection re-homed to the base VM) |
| C5.5 | S-eren | 791-797 (selectorNav), 647 (the amended on_current_record string — destination clause retired per the SCOPE-UI B7 amendment), 684-686 (the verbatim prior-note) |
| C5.5 | S-eapp | 136-146 (selector state + read-only ?election= boot), 198-207 (scope switch resets the active race — the ruled B6 resolution) |
| C5.3 | A-fw1 | 14-16 (artifact not fused), 60-62 (gates check values, not structure) |
| C5.4 | A-probe | 152 (banked sizing item: multiple surfaces, per-path render compliance) |
| C6.1 | A-ba1g0 | 56-66 (dollar/repairability distinctions); A-ba1g2 49 (render-invisibility distinction) |
| C6.2 | A-ba1g0 | 56-66 (§G0.3 dollar-invisible by construction); A-add A1.7 caution (see §A1) |
| C6.3 | A-ba1g0 | 56-66 (both fixtures: Sheet-repairable vs the notes strip with no repair path) |
| C7.1 | A-bbg0 | 8-15 (race-map sense); S-ing 583 + S-syn joins (sbe-id sense via committee sbe ids) |
| C7.2 | this document §1 (positional definition) + A-probe 42-72 (§P1 usage of record) |
| C7.3 | A-probe | 74-94 (§P2), 90 (the overload stated) |
| C7.4 | S-ing | 506-508 (the carry set) |
| P1 | A-fw1 | 60-62 (proposed fused-per-candidate detector, not built) |

**RULED pointers** (`claim-id | ruling | sha'd record`):

| claim | ruling | record |
|---|---|---|
| C1.1 (chains as requirement; authority inversion) | PS-25 / PS-44 | DOCS-M1 g0-report `d9420b12db1d737318403f299460b5696aa6bcb0cbe2345abdff4e29502e5e94` |
| C1.7 (positional-requirement framing) | PS-45 | DOCS-M1 G1 authorization `4df351879a2e7d1172f2bfadb2d9a4497b6958a2efbf6e58dd977c95b4a7ba0b` |
| C1.10 (step-8 re-apply is the intended architecture; not open work) | PS-29 (a′ Option B; 8a ruled) | recorded in the G1 authorization `4df35187…` (§ rulings-in-force) |
| C1.11 (truncation vs order) | PS-80 | HALT-F5-SEED ruling record `bd25b641b682ec12a950ef64ade8561d65e483ceb7b11fc3dee26942a410cde6` |
| C4.5 validator requirement (stamped fields carry a mismatch validator; Route B from-source constraint) | PS-81 | same HALT-F5-SEED ruling record `bd25b641…` |
| C6.6 (a guard does not consume the field it guards) | PS-82 | SCOPE-PIPE ruling record `4a164c9716cbb67713ac1424b3605f41517789660da7df84eb3ca64b972628f8` |
| C4.6 disposition (F3 documented, not re-keyed) | ruled at SCOPE-PIPE G1 §3 | same SCOPE-PIPE ruling record `4a164c97…` |
| C5.5 money/nav semantics (window-scoped money, entity-scoped navigation; divergence resolves upstream) + B1-B7 display ratifications + B7 destination-clause amendment | ruled/ratified at SCOPE-UI G1/G3 | SCOPE-UI decision record `e2f687ce63649c168fd0f7765434017949d68acc3a5613b9101212b5b413ae25` (banked `~/scope-ui-2026-08-03/g1-display-decisions.md`; the G3 authorization carrying the B7 amendment anchors on it) |
| C4.7 ownership rule (most-recent-by-election; PS-84's conditional facet, amending PS-77's letter) | PS-84 | HALT-F1 ruling record `03721efcf0fe4d744ad580106627a4b3dafd9c65f6ce1c2b28bd833be793756c` |
| coverage-count stop conditions (pre-ruled expectations, "an unexplained change is a stop") | PS-85 | same HALT-F1 ruling record `03721efc…` |
| C5.6 surface-class rule (frame entity-scoped, contents window-scoped; money-unreachable corollary; in-frame-first section order) | PS-86 (rev 3, shape 3′ — supersedes rev 2 `7b43b20f…` and rev 1 `9a4ba9ac…`, each replaced on disk as ruled) | HALT-GUARD ruling record `c8c05654e97d92d97c4bc7c11ee4cac0c77e4e153c439f4f465449213f2ca962` |
| C2.9 (writer-sweep method) | discipline 29 | G1 authorization `4df35187…` |
| C6.4 (documentation drift is audit-only) | ruled this lane | G1 authorization `4df35187…` (§G1 §6 requirement) |
| C6.5 (mechanical check's worded-count blind spot) | PS-60 | closing amend `daf8a0f0083651a17d39378600c64ced64d2a685e2db140a6075bf611cb6bfc8` |
| C2.10 routing (value-class → 1a arc, not a′) | **PS-9 — PS-58/PS-65 fallback**: planner-sitting ruling, no lane artifact carries it; the pointer resolves to the handover revision. **Resolves at rev E**, alongside PS-12 — deferred-by-design, not a defect. The mechanism half is SOURCED above. |
| detector class (members by name) | PS-33 / PS-54 | G1.0 resolution `f7473cf26ffdfb6d380c73e9388de49913ce4c4c89a2574615a368b3602212c2` |
| P2 (freshness check, as ratified proposal) | PS-23 | G1 authorization `4df35187…` |
| P3 (population trip-wire, as ratified proposal) | PS-32 | G1 authorization `4df35187…` |
| P4 (chain-consistency check, as ratified proposal) | PS-49 | G1 authorization `4df35187…` |
| C3.4 display ruling | **PS-12 — pointer per PS-58 fallback**: ratified in a planner sitting, no gate record exists; the pointer resolves to the handover revision carrying the ruling. **Resolves at rev E** (drafted after this lane closes, by ratified sequencing) — a scheduled resolution, deferred-by-design, not an open defect. The mechanism claim itself is SOURCED above. |

**Conformance record:** `build_all.sh` (S-bld, sha above) conforms to the §1 chain block as
of this commit. Its executable content is byte-identical (comment-stripped comparison) to
the revision the BA-1 lane shipped; only inert comment text differs. This row is the
baseline for the proposed chain-consistency check [P4].

**UNVERIFIED register:** C4.3 `ie-committee-*` mechanism — *deferred-by-design* (own queued
lane; owns the same file's help-string repoint). C3.4's PS-12 ruling pointer and C2.10's
PS-9 routing pointer — *deferred-by-design* per PS-58/PS-65 (planner-sitting rulings; the
pointers resolve to the handover revision at rev E). C7.5 "behind" — *gap* (no byte
source). §5 surface enumeration — not carried here; the count is current state and routes
to the handover.
