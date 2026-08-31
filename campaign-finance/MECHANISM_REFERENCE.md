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
  in §8 in place of an appendix row: ruling ID + its entry in **`RULINGS.md`**, the committed
  register that is the authority of record for ruling text; lane archives and handover
  revisions are provenance, recorded in the register's entries (PS-75, widened by PS-87; the
  prior archive-and-handover-fallback pointer scheme — PS-58, widened by PS-65 — is
  superseded, and both rulings' text is in the register).
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
  -> build_sb_finance -> validate_council_data
  (build_sb_finance also requires ingest_sb_votes: it reads the school-board
   roster's candidacy_ref bridge as well as rollups.*, and hashes both inputs)

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

**Qualifier added at SBVOTE-1/B, when it stopped being the only votes builder** [C1.2]: the
claim above is now specifically about the **council** votes pipeline. The school-board votes
ingest is a **second, unorchestrated builder** — a single hand-run step with no chain block
and no shell caller, because a one-step chain has no order to constrain. Its validation is
therefore not reached by any chain: it runs at the gate instead, which is why that assertion
is a gate line rather than a pipeline step. A future lane wiring it into an orchestrator
inherits C1.1's ordering requirement the moment it acquires a second step.

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

### Source-row selection: what the ingest steps admit

Three selection rules decide which raw SBE rows enter the pipeline at all. They run
upstream of every classification, rollup and exclusion in this document — a row these
rules drop is not excluded from a figure, it never becomes a row — and none of them had a
record before LEDGER-0. Each is named here by its predicate; **the phrase "IE item-4/5
drops", used in earlier lane records, is retired rather than resolved — it resolves to no
byte** (D10). Anchors are in §8; per-run and bulk-population figures are state and live in
the sha'd report that measured them, with their collection named at each.

- **Archived rows are dropped, at three sites** [C1.12, SOURCED]. The SBE marks a receipt
  or expenditure row `Archived` when a later filing supersedes it — amendment supersession
  and A-1 absorption both flow through that flag — so the live set is the non-archived
  rows. The bulk converter keeps only non-archived rows as its selection and uses the same
  predicate when assembling the registry cross-check input; the IE ingest applies it
  independently on both the expenditure side and the receipts/funder side. **The rule is
  authoritative over the alternative:** HALT-BULK-A ruled the `Archived` selection to
  govern where it disagrees with the registry window-and-order heuristic, and the converter
  carries a trip-wire that reports any committee where the two selections differ. This is
  the highest-volume rule in the pipeline — it drops a large fraction of both bulk files,
  measured by collection (receipts and expenditures separately) in the LEDGER-0 G0 report
  [A-l0g0].
- **The IE lane admits a row only by surviving five drops, in order** [C1.13, SOURCED],
  each stated by its predicate because the set has been miscited as a numbered list before:
  **archived** (above, applied first); **not marked Supporting or Opposing** — the
  definition of an independent expenditure, and by volume the rule that does nearly all the
  work, since only a small minority of non-archived expenditure rows carry either flag
  [figure and collection in A-l0g0]; **unmatched target** — an expenditure naming no
  candidate the registry resolves is out of scope, the same doctrine that puts a former
  officeholder's IEs outside the subject; **candidate-committee spender** — a filer that
  resolves to a non-IE committee in the registry is spending its own campaign money, not
  making an independent expenditure, so the row is skipped; and **exact-duplicate
  collapse** — the same committee, payee, candidate, amount, date and purpose emitted once,
  because filers re-report an expenditure across successive filings. The first two are
  admission rules on the raw file; the last three are resolution rules that need the
  registry. Per-run counts for the last three are recorded in the ingest step's own `stats`
  and are **not persisted into either artifact**, so they are recoverable only from a run's
  output or a lane record.
- **The converter admits only the five itemizable D2Part codes, and the rule has two
  characters** [C1.14, SOURCED]. Its map names the receipt types the pipeline itemizes
  (individual contribution, transfer in, loan received, other receipt, in-kind), and both
  the selection pass and the reassembly pass require membership in it. **As a selection it
  is dormant** — every well-formed row in the bulk receipts file carries one of those
  codes, so the predicate excludes nothing a reader would miss [measured over the receipts
  bulk, A-l0g0]. **As a well-formedness guard it is live**: the bulk format's occasional
  field-shifted rows carry values in the D2Part position that are not codes at all, and
  this is the predicate that drops them. Reading it as selection-only would invite
  "widening" it to admit more types and silently re-admit malformed rows with them.

### Vote provenance: what the votes tier admits [C1.15, RULED; sites SOURCED]

The dollars family's selection rules above have a votes-family counterpart, and it is a
**scope rule rather than a filter**: **every published vote position comes from the vote
ingest.** Hand-entry is retired — no position enters the artifact by hand, and content that
existed only by hand-entry was removed rather than legitimized (PS-99). The stated
consequence: **a vote absent from the ingest source is absent from the tool** until the
source carries it.

Two writers set per-alder positions, both keyed on the current featured set, and — the
mechanism this rule exists to close — **neither has ever deleted a key**, while `votemeta`
is authoritatively rebuilt each run. A renamed vote code therefore left its old key on every
alder permanently, and the vocabularies forked silently: the artifact accumulated codes that
resolved to no `votemeta` entry, one pair drifting to different values for the same vote.
Nothing detected it, because the votes family had **no validator of any kind** while the
dollars family carried INV-\* and `[AGG/\*]`.

The `validate_votes` family closes that: rollcall id uniqueness and declared-count agreement,
every `votemeta` entry resolving to a rollcall vote, and — the single-source assertion —
**every per-alder vote code resolving to a `votemeta` entry, with no hand-entered exemption,
because under PS-99 no hand-entered class exists.** ~~It is parameterized on the artifact, so
a second votes source is a client rather than a second exception~~ — **struck at SBVOTE-1/A as
false when written. The family splits: the rollcall and `votemeta` checks are genuinely
shape-independent, while the two roster-dependent checks (the single-source assertion and the
position-key check) resolve their roster through one named accessor, and that accessor's known
field names are the parameterization point — a second votes source becomes a client by being
named there, not by the family already being general. Before that accessor existed, an
artifact whose roster sat under a different field name made both checks examine an empty list
and report success. A missing roster and an empty one are now separately loud under one stable
check name; neither is a silent pass.** An artifact with no votes
tier is in scope and passes.

**The second client is real, and the parameterization is now a declaration** [C1.16,
SOURCED; ratified properties RULED — see the register's SBVOTE-1 entries]: the school-board
votes tier is minted by its own ingest from two hand-authored Sheet tabs (a roster and a
wide-format position grid, one column per seat) into its **own artifact**, with no coupling
to either finance artifact. It is a client of the same family rather than a second
exception, which is what PS-99 exists to make possible. Each roster shape **declares
itself** — the field name it lives under, the roster field a position key resolves by
(`ward` for the council, the seat for the school board), and optionally a column contract —
so naming a new shape is what admits it, and a shape that declares no contract is stated as
such rather than silently skipped. The **column contract is enforced outside the votes
checks**, deliberately: those early-return on an artifact with no votes tier, and a roster
that ships before its first vote would otherwise be examined by nothing at all. The
positions are stored as the **semantic** set exactly as entered, the sole ingest-time
mapping being blank → the not-recorded marker; any other cell value is fatal and names row
and column, and no display map exists at ingest, because an ingest-time translation is what
would let a position silently mis-map. Roster identity is a **pipeline-minted slug** that
strips honorifics, bare initials and quoted nicknames while keeping generational suffixes,
and the deferred candidacy bridge rides an explicit reference column rather than slug
matching. A seat with no member is a real seat: it carries no minted identity and no term
dates, and the predicate "this row describes a member" governs identity minting and date
strictness alike, so vacancy semantics live in exactly one place.

The retired semantic-inversion flag is asserted **absent**, and
`rollcall.votes[].type`'s stringified-list shape is pinned because a writer switching it to a
real list would change what every consumer parses.

**Two `generated_at` namespaces exist and are never conflated**: the top-level stamp is the
dollars stamp (advanced by the rollup builder, and therefore by the IE ingest's internal
rollup); `rollcall.generated_at` is the votes stamp. The shard-staleness check reads only the
former.

**The school-board finance builder excludes union dues at exactly one site, and for this
dataset the exclusion is structurally vacuous** [C1.17, SOURCED; the $0.00 case RULED — see
PS-101]: `build_sb_finance.py` applies the dues exclusion in a single place, a bare
`continue` inside `scan_committee_rows()` keyed on the `DUES_TYPE` constant, and the R4a
counter sits at that same predicate so the figure reports what THIS exclusion removes rather
than what earlier predicates already dropped. The contribution filters run in a fixed order —
slug scope, aggregate, excluded cycles, dues, donor resolution, self-funding, window — and the
order is load-bearing for that counter, not incidental. The exclusion is nevertheless vacuous
here **by disjointness rather than by luck**: `ie_slice()` reads the spend side
(independent expenditures) while the dues predicate reads funding-side contributions, so no
dues row is in the set the slice sums and the excluded total is $0.00 for this dataset. That
is a property of the two sides, not of the data, and it is why a non-zero figure here would
be a finding about the slice rather than about dues. Built at SBV-BOARD-1, on the data port
SBV-PORT-1 landed.

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
| `aka` [C2.5, SOURCED] | ~~Sheet apply's merge pass~~ **NO WRITER — the merge pass was its only one, removed at REFRESH-1 (PS-97)** | no | ~~recomputed each run (Donor Merges tab)~~ **never written** | — | — |
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
value): `parent_id` is both union-preserved and transform-recomputed; `aka` ~~is recomputed
from its tab every run~~ **has no writer at all since the merge pass was removed (PS-97) —
it is retained in the schema, written by nothing, and populated on no donor**. Neither
needs — or can meaningfully take — a code-side preserve. [C2.4, C2.5]

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
RULED — see §8] `individual` is a name-format bucket (above), and
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

**Direction of flow, and it is scope-enforced rather than conventional** [C3.7, SOURCED]:
in the donor-editorial domain, values flow Sheet → artifact only; no pipeline value returns
to the Sheet. **The guarantee is structural**: every pipeline program that reads an
editorial tab holds a **read-only** Sheets credential, so a future edit adding a write
fails at the API rather than at review, and the one pipeline program that does hold a write
scope targets a tab **disjoint** from every editorial tab. The editor application is the
deliberate exception — it is the human write path this property exists to protect — and it
writes **cell-scoped**, building one range per changed column of a matched row, never
rewriting a row wholesale and never clearing a tab; a row it cannot match is reported
rather than guessed at. The property is asserted **statically at build time** (§8's
scope-check row; both gate invokers, no network): an unclassified Sheet-touching program, a
scope upgrade on an editorial reader, a write verb aimed at an editorial tab, a second
editorial writer, or an undeclared tab name each fail the build. It is a property the
project already had and would not have noticed losing.

Qualifier so no one over-generalizes: the votes tab **is** machine-written — the vote sync
clears and rewrites the whole tab, preserving the editor columns by reading them first and
re-emitting them. That is a votes-domain scaffolding write, not classification write-back.
**Because preservation depends on that read, the read is fail-loud**: a read that *fails* is
an error and aborts before the clear, while a successful read returning nothing and an
absent tab are separate, named branches. Collapsing the three — as a bare
catch-all-and-return-empty did — turns a transient API error into a silent overwrite of the
editor columns with seeded values, which is dollar-invisible and render-invisible both (§6).

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

**Sheet-edit reachability is asserted at sync time, against the union of artifacts**
[C4.8, SOURCED]: an editorial row keys to a donor by the minted slug (C4.1) and is applied
by **exact match**, so a row whose id matches no donor is silently inert — the tag reaches
nothing, and nothing reports it. The Sheet apply therefore asserts that every Sheet donor id
(overrides plus cluster members) resolves in **at least one artifact**, and fails **before
the artifact write** when one does not. **The union is load-bearing, not a convenience:**
the Sheet is shared across both tools, so an id absent from the artifact being synced is
usually just the other tool's donor — a per-artifact orphan count is *misleading*, not
merely narrower, and reporting one would manufacture alarm. The check lives here rather than
in the terminal validator because this is the only step holding the Sheet and an artifact in
one process, and the validator must never acquire a network dependency. Residual orphans sit
in a **shrink-only** known-failures file that names an owning lane per entry: growth fails,
and an entry that *stops* failing fails too, so the file cannot outlive its cause. The
signature it exists for is the **re-mint**: one filer spelling a name several ways, each
spelling minting its own slug, and only one of them carrying the human's tag — the tagged
one then stops accruing, invisibly.

**Editorial coverage is pull-model, and it is reported rather than gated** [C4.9, SOURCED]:
nothing in the pipeline appends a new donor row to the Sheet — the apply holds a read-only
credential and therefore *cannot* — so a new donor becomes taggable only when a human runs
the unclassified export, whose own docstring states that workflow. Completeness thus depends
on a remembered manual step. Each run reports, per artifact, how many donors carry no Sheet
row and what those donors received, with its collection scope stated in the same breath. It
is a **reported figure and never a gate**: it is non-zero by construction today, and a check
that fails every build is the routinely-overridden gate PS-23 leaves unresolved for exactly
this reason. The push-model exporter that would close the gap belongs to the refresh-runbook
lane, not here.

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

**Hand-maintenance leaves residue, and residue reads as evidence** [C5.1, SOURCED; measured at
SBVOTE-2 G1]: the council embed carries four CSS rules for a brand lockup that no markup uses —
`#ipg-council-app .ipg-brand`, `.ipg-brand svg`, `.ipg-brand .wm`, `.ipg-brand .wm small` —
while the header renders an `h1` and a subtitle paragraph and nothing else. The styles are
dead. A design census read them as evidence of a rendered lockup and a downstream
authorization inherited the over-read, instructing that an SVG be copied that does not exist
(planner error 34). The correction of record: **any future lockup work starts from asset
creation, not from copying markup that was never there** — and on a hand-maintained path, a
selector's presence in a stylesheet is not evidence that anything renders it.

**What each reads** [C5.2, SOURCED]: **three embeds now, three separate paths.** The council
embed fetches the council artifact (`council-data.json`) from the raw-CDN `refs/heads/main/`
form, with an optional sharded mode (index + contributions shards) that ships
present-but-unconfigured — the code path exists and the URLs are commented out, so the
monolith is what actually loads. The school-board embed fetches the school-board artifact
(`school-board-data.json`) from the same `refs/heads/main/` form. The elections embed fetches
the elections artifact (`election-data.json`) from the bare `main/` form — overridable per
mount (`data-src`, then `window.IPG_DATA_URL`, then the baked default) where the other two are
baked only — and fetches two verification artifacts at runtime besides
(`elections/reconciliation-report.json`, `elections/known-gaps.json`), so the methodology
figures cannot drift from the artifacts they cite. **URL form is therefore not uniform across
the three: two use `refs/heads/main/`, one uses `main/`.** **None of the three** renders the
donor entity-type or last-editor fields — established by sweep at the lane of record (§8) for
the first two, and re-measured across all three sources at this lane.

**"Inlined" describes the elections embed's code, never its data** [C5.2, SOURCED]: the
inlining folds `data.js` / `render.js` / `app.js` + styles into one Code Block. The artifact
still arrives over the network at runtime, exactly as the other two do. It could not be
otherwise at the sizes involved — roughly 7.8 MB of artifact against a ~191 KB embed — so the
prior two-embed phrasing *"deploys as a single inlined file"* is a true statement about code
that must not be read as a statement about data. **No embed inlines an artifact.**

**Outbound, so the enumeration is not silently one-directional:** C5.2 is a reads row, and
reads are not the whole of an embed's traffic. The council and school-board embeds each POST
feedback to one shared Formspree endpoint (`https://formspree.io/f/xjgdkkrk`), separated only
by subject prefix (`[IPG Council Tool] ` / `[IPG School Board Tool] `); no credential ships,
and the destination cannot reach the editorial Sheet. The elections embed has no outbound POST.

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

**The elections path renders a person surface** [C5.7, SOURCED; frame, deferral, total,
and identity rules RULED]: a modal reached from an affordance on returner cards and by a
read-only person URL parameter — the deep-link path, on which container-window inheritance
is impossible because the one open function takes no window argument (PS-89's exemption,
structural on both counts: the modal mounts outside every windowed container and no window
is passed). The surface is **framed by the person** (PS-89, extending PS-86 one level up):
every member candidacy renders as its own section, most recent first, money or not —
in-frame absence is information — and each section's money is **direct-only and
window-scoped to that member's own election** (PS-79/A1), computed from the owning
candidacy's rows independently of `by_person`'s stored money values (C6.6: the gate's
equality check must not read its subject). The **career total is the sum of the member
own-window figures** (the ratified career-total rule; the register's P1D-PERSON entry),
asserted equal to `by_person.direct.total` at gate so divergence fires rather than drifts.
**No IE value enters the person view-model** — a **deferral-scoped** exclusion (PS-90) that
the lane shipping IE display after P1-E supersedes consciously; the permanent firewall
invariant remains INV-PERSON-2 at the artifact layer, expressly distinct. An out-of-window
disclosure line renders when the owning committee carries money outside every member
election's window, computed as a **boolean** — no unwindowed figure is materialised in
render scope. Person resolution is **by id, never by name** (PS-92), and a candidacy id
belonging to a linked person resolves to that person (the durable-link rule), so shared
links survive later linking. The retired returner-pointer card carries the person
affordance in the deleted string's place (SCOPE-UI B7's retirement condition, discharged);
the affordance's label is the ratified string 13 — the arrow is part of the ratified text,
and the candidate name is not composed into it (HALT-S13; the register's P1D-PERSON entry).

**The cycle exclusion is subject scope, applied at every unchosen figure** [C5.8, RULED;
sites SOURCED]: money dated before the floor of the modeled council eras (the `CYCLES`
table; the term seated May 2011) is **outside the tool's subject** (PS-93 — the doctrine,
the cutoff's honest provenance, and the labelling rule live in the register entry). Every
consumer that computes a figure from raw contribution or IE rows, **in both embeds**,
applies `EXCLUDED_CYCLES`; the previously unfiltered consumers (the elections funder
rollup and donor footprint; the council shard-fed donor index, industry and flag
cross-tabs, IE funder and spender sums, industry-detail, and correlation index) are
closed, with the elections side gate-asserted and the council side lane-proofed.
**Explicit selection is disclosure, not violation**: the council's deliberate
before-May-2011 option and list view are named as outside the tool's cycles, offered by
design where such rows exist (never as an enumeration artifact), and never aggregate with
in-subject money. **Non-window figures state their basis** using the ratified term-basis
strings — the phrase names the term seated May 2011, never "post-2011", because the floor
is mid-May and January-to-May 2011 money is excluded too. One precision of record: the
earliest school-board election window is open-start, so a pre-2011 date passes that
window predicate by itself — **the protection on windowed figures is the cycle filter,
not the window**, asserted at gate. **The exclusion set is larger than cycles, and it
binds as a set** (PS-94): dues transfers between political committees are excluded from
every published total while their rows stay in the substrate, typed distinctly (PS-95 —
the rule's first text of record; it governed as FW-1's rule (c) pre-register), and every
row-aggregating consumer applies the **full** set through one shared predicate per embed
— a repeated condition is how the second gap of this class happened. The exclusion is
**disclosed by magnitude** at methodology level (PS-95's clause), and a flag that marks an
excluded class **renders its structural zero with the ratified line rather than
disappearing** — the flag/exclusion coextension is contingent, and a non-zero on that row
is a tell worth keeping visible.

**Un-keyed money: donor-grain figures omit it and owe a disclosed residual; committee-grain
figures count it** [C5.9, RULED; sites SOURCED]: money can sit inside a figure's subject
while lacking the key that figure is grouped on — the un-itemized aggregate roll-up row,
which carries no donor identity (PS-96 states the class, the classifying test against
exclusions, the residual-disclosure obligation, and the carve; this claim cites the
register and does not restate it). **The convention:** figures grouped on donor identity —
the pipeline's donor-grain rollups, the council correlation index, the editor's
cluster-preview totals, and the reconcile compare — omit such rows and donors; committee-
and candidate-grain figures in both embeds count the same money, because at that grain no
key is missing. Both halves are correct; the split is not a defect. **Four recognition
predicates exist and are not coextensive** — the row flag, the donor type, reconcile's
contribution-type, and the elections render's marking (donor type OR the small-dollar
industry tag, strictly broader, and Sheet-editable) — and no code establishes or checks
any coupling among them; they are the detection surface, never the class definition
(PS-96). **Known gap in that surface:** a retired convention once carried the small-dollar
aggregate donor under an underscore-prefixed donor id, and no live code tests the prefix,
so a data source restoring the id convention without the type or flag is invisible to the
predicates. ~~**The residual-disclosure treatments diverge between the embeds:** the
elections contributor panel renders the labeled, non-clickable aggregate line pinned
beneath the real donors, its rows summing to the headline; the council alder profile's
line was removed at the bulk-source migration while its headline kept counting — the
standing non-conformance PS-96 names, owned by REPAIR-AGG-1.~~ **Superseded at
REPAIR-AGG-1, the commit that retired it: the treatments no longer diverge.** Both embeds
render the residual as a labeled, non-clickable line pinned beneath the real donors, and
in both the visible rows plus that line reconcile to the headline — the council line was
restored on the donor-type partition, amount only, and renders nothing at all when the
class is absent, so a surface with no un-keyed money is unchanged by its presence. PS-96's
one named standing non-conformance is discharged. The class is asserted absent
at build time, class-level, per artifact, and the three causes carry distinct failure
names because they demand different responses: un-keyed rows or donors present
(`[AGG/PS-96]`, predicates one to three — fires only on a data-source change, the class
waking); a donor carrying the small-dollar industry tag (`[AGG/PS-96-TAG]` — fires on a
Sheet edit, and the condition is an editorial tag making *itemized* money render as an
aggregate line, a false display claim rather than the class waking); and a donor key that
should have resolved and did not (`[AGG/PS-96-DEFECT]`, the referential-integrity
assertion — **outside** the class, must fail loudly; both embeds otherwise treat such a
row divergently, the council headline counting what its list hides and the elections
panel rendering a fallback line).

**Sizing note** [C5.4, SOURCED]: the tools present multiple distinct public surfaces,
which multiplies render paths, not merely classification consumers. The surface count is
current state and lives in the handover, not here.

**The school-board board surfaces treat a vacancy as a real seat, and every vote carries its
source** [C5.10, SOURCED; display decisions RULED — see the register's SBV-BOARD-1 entries]:
the roster, seat selector and member surfaces of the school-board embed share ONE seat filter,
so an omission cannot be implemented in one view and forgotten in another. A vacant seat
**appears** in the selector — the seat is a real fact about the board — and selecting it
reaches a seat notice rather than a member page, while the President is filtered from
vote-enumerating surfaces for as long as its column records nothing (PS-125), with the roster
surface the single ruled exception (PS-127 (i)) whose sole-caller constraint is asserted by a
check rather than left to a comment. Each vote's `source_url` is carried from the ingest's
fixed column through the artifact to both render sites, so a rendered position is one click
from the record it came from. The embed makes an **enumerated** two fetches, both
school-board-family artifacts, which a gate check asserts by count so a third is a failure
rather than a silent drift. Landed at SBV-BOARD-1 over the SBV-PORT-1 data port.

**The school-board embed's `render()` is a view router, and no branch of it throws**
[C5.11, SOURCED]: `render()` dispatches on `state.view` across five named views — member,
record, matrix, spend, board — and its terminal `else` falls through to
`methodologyView()` rather than throwing. The embed carries no office concept, and its
President handling is `presidentRenders()` plus `seatVisible()` — a PS-125 filter, not an
office branch. The throws-on-unknown-office behavior recorded near this surface belongs
elsewhere: the build-time emitter `campaign-finance/elections/embed/tools/build_embed.js`
refuses to emit a bundle for an office outside its enumerated map, and the gate's
`[BUNDLE/VINTAGE:bite]` line asserts that refusal — a build-time guard on neither embed's
render path.

**The school-board funding methodology renders unconditionally within the methodology
view** [C5.12, SOURCED]: the SFM fold sits inside `methodologyView()`, reached as the
router's terminal else, rendering the SFM strings in their ratified order with the
all-elections disclosure re-emitted from its own string-table entry and the dues figure
substituted from `duesFigure()` behind a loading fallback — a data-readiness branch, not
an office branch. Office-gated methodology rendering is the elections embed's behavior,
implemented as the D-22 / PS-112 gate in its own `render.js` and asserted by the gate's
`[MUNI/METH]` line; no such gate exists on this single-office surface.

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
this risk lives. **A second thing no repo-side check can see** (HYG-B2): §8's archive
pins name lane reports held outside the repo, so no check here can hash their contents
and none ever will — `check_ref_pins.py` provides **visibility, not verification** for
that set, reporting each pin out-of-reach by name on every run. An unverifiable pin that
announces itself is honest; one that vanishes from the output reads as verified.

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

## Proposals — the invisible-defect detector class (P5 and P6 built; P1–P4 proposed, not built)

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
5. **Docs-form checker: pointer form, register lexical, path existence** [P5, RULED —
   **BUILT**] (PS-73) — `campaign-finance/tools/check_docs.py`, one implementation with two
   invokers: `build_all.sh`'s validation gate and `gate_bundle`. Checks that §8's RULED
   pointer cells match the PS-71 shape structurally and resolve to `RULINGS.md` headings;
   that §8's UNVERIFIED register carries no forward-looking status language (PS-42's class
   names allowlisted as exact tokens); and that backticked paths in tracked markdown resolve
   on disk, with a committed shrink-only known-failures file whose entries each name an
   owning lane (`tools/docs_check_known_failures.json`). Hard-fail, ruled with PS-73;
   self-test mode fires every rule on a synthetic violation. **Extended at
   REGISTER-COHORT-1 with a fourth rule, `[REG/PS-N]`:** every `PS-N` id cited in either
   authority document's **own voice** resolves to a `### PS-N` register heading (PS-87 —
   a ruling in force that a repo-only reader cannot find is a rule the work cannot see).
   Its boundary is deliberately narrower than the path rule's: only the register's
   **verbatim quoted blocks** are exempt, because quoted ruling text is a historical
   record transferred whole under the D8 convention rather than the register asserting a
   pointer — provenance lines, prose and the whole reference stay in scope. It carries
   its **own** shrink-only known-failures file (`tools/reg_check_known_failures.json`),
   pinned at **zero**: the transcriptions that would populate it landed in the same
   commit, so any future headless citation fails the build by construction.
   **What rule 3 cannot see, and the asymmetry inside it** (HYG-B2, item 27): both of
   rule 3's universes are `git ls-files`-derived at two distinct call sites — `md_files()`
   for the SUBJECT universe (which documents get checked) and rule 3's own `git ls-files`
   for the TARGET universe (what a basename may resolve to). An **untracked** candidate
   file is therefore invisible to the check and returns a meaningless green, so stage
   before running any tracked-file checker. The two resolution paths are also
   asymmetric: direct resolution consults the **filesystem**, while the basename
   fallback consults the **git index** — an untracked-but-present file satisfies a
   direct citation yet can never be a fallback target. §8's archive pins are tilde
   paths, which `classify_token()` skips, so they sit outside every rule here; since
   HYG-B2 they are guarded in shape by `campaign-finance/tools/check_ref_pins.py`,
   which reports each one out-of-reach **by name** on every run rather than passing
   over it in silence.
6. **No-editorial-writeback checker** [P6, RULED — **BUILT**] (PS-33's fifth member, added by
   the PS-54 pattern) — `campaign-finance/tools/check_sheet_scopes.py`, one implementation with
   the same two invokers as P5. Static and network-free: it discovers every Sheet-touching
   program in the repo rather than reading a hand list, then requires each to be classified, a
   pipeline reader of an editorial tab to hold only a read-only scope, a pipeline writer to name
   no editorial tab, no pipeline program to write-verb an editorial tab, the editorial-writer
   allowlist to hold exactly the editor app, and every tab a pipeline program names to be
   declared. Hard-fail; `--self-test` fires each rule on a synthetic violation plus a
   negative control. It belongs to this class because the defect it catches is invisible to
   every other gate: a scope upgrade on an editorial reader moves no dollar, changes no
   rendered byte, and fails no reconcile — it is discovered when an editor's work is already
   gone.

---

## §8 — Citation appendix (Tier 2)

**File sha legend** (sha256 at the commit that authored/last amended each row):

| tag | file | sha256 |
|---|---|---|
| S-ing | `campaign-finance/ingestion/ingest.py` | `7fe43b0d919d6d80edb1b3661d343b826881b63e6613421b6150d6e7f4bd3b5b` |
| S-syn | `campaign-finance/sheets-sync/sync_overrides.py` | `0bac13ab7c15a02197822b77b7c1144ad3b12655b37322208476a3b0d3d73913` |
| S-bld | `campaign-finance/build_all.sh` | `e034a6052cacd26b15fc1e682584fd9d8cc6d2a9430d2f456c1b98de24e81d56` |
| S-t1 | `campaign-finance/ingestion/transform_slice1.py` | `5f807b26245ee22173d3903b9b8a3825f224c47c4f2d7ad11042ee87a6ccb68d` |
| S-ie | `campaign-finance/ingestion/ingest_ie.py` | `d7ee840225cb805bc6b9a83e01ac157efbbd80f2a2bc857406d078cc8e1fdb9d` |
| S-rep | `campaign-finance/ingestion/repair_clusters.py` | `90cc6912647479510d10d505debb84d18fbd28557bf5996b01a992eb1ddf283c` |
| S-rol | `campaign-finance/ingestion/build_rollups.py` | `3497822e951cd6257aa55a50440b25a976f3059316f0f29be03cbba7ce941df9` |
| S-seed | `campaign-finance/elections/build_election_seed.py` | `7ba72ad8d638755b0c1b85a586beaa34dc7ff773e54fc7667063b9551842807c` |
| S-vld | `campaign-finance/ingestion/validate_council_data.py` | `d69ac28dc299c9a19764719d7953985de32a94278acb8484a21d80a004540282` |
| S-sbv | `campaign-finance/ingest_sb_votes.py` | `d4d7f6050b1f7dac07e07d27067fbf35ffe4f29a05e6cee74687412338a110b3` |
| S-rst | `campaign-finance/ingestion/restamp_committee_linkage.py` | `6ceb82f9bbcffa08fdb21904b8585982a6bff7e3982e0b810937e2958019d06e` |
| S-cbr | `campaign-finance/ingestion/convert_bulk_receipts.py` | `6062d0dfea8802f17a3434bef8e88097b7ad932bc17811f14d75055dfc3269ce` |
| S-av | `campaign-finance/sync_allvotes.py` | `a0c4f23df6e4f012e683088e012dc91692fe65399e6fcae2acd1ec9b40e61384` |
| S-cemb | `campaign-finance/elections/reference/council-embed.html` | `69e107cb4ad3caf1ed87d1a0b6e31b87608f811ea479f3ca9bcbabb59da8c7de` |
| S-sbemb | `campaign-finance/school-board/school-board-embed.html` | `e3bb4d40abef7cd5335150257c493eb9a913ad1d29b2353fdc37f11fd94e7956` |
| S-eemb | `campaign-finance/elections/embed/elections-embed.html` | `8fb04287a9a542f15c3d28e65bd3c1a400edd08ceef697e985bd0491f74359f9` |
| S-edat | `campaign-finance/elections/embed/data.js` | `7ae3cfc313d1e409a7506b942f83cf914e5754bc329ff7013b8de2a34d8d6502` |
| S-eren | `campaign-finance/elections/embed/render.js` | `c661c5de123781199df623b90b8e5a481be0910ca415065a59ddeb42e4481a7b` |
| S-eapp | `campaign-finance/elections/embed/app.js` | `4c4df660ffa73510b53f632576cfb38035bc037b30047c828a6b8cd1f1771f25` |
| S-srv | `campaign-finance/editor/serve.py` | `f430f67b2d2367893ab4cb37a1c25ff84d71bb93b53a23b78f253ec17dccaa3a` |
| S-rec | `campaign-finance/ingestion/reconcile.py` | `7d7b9a62cdbcf18bef5c23e55bb439a8d9f88786323ae3ec4990ee50b66efa6f` |
| S-chk | `campaign-finance/tools/check_sheet_scopes.py` | `e45c063d5b19ad0c25695257a5e0a71bdbd7fcf618789ac18d36da9bc065b191` |
| S-sbf | `campaign-finance/ingestion/build_sb_finance.py` | `566e15999c29359d66c7e6c87b5f44c982e8df0fe5cd9c309ecb644bf6769553` |
| A-probe | `~/probe-sync-2026-07-24/probe-report.md` | `4c678cf0c14dd370f8b52744bf473000340ce16449a5365841b6ac92d8e5f9bb` |
| A-add | `~/probe-sync-a-2026-07-24/addendum-a-report.md` | `468ba24f4f418f72c2720608353c83e52694c41637cf9ff16a9b267d37e49ed6` |
| A-ba1g0 | `~/halt-ba-1-2026-07-24/g0-report.md` | `9aeaa793fd5f4afe59d9ac504f7f00dd219f4417cbafdd3403e5a44f661e812e` |
| A-ba1g2 | `~/halt-ba-1-2026-07-24/g2-g3-report.md` | `05746b6bad73da0bc1eb9df3f4fa87e725b143ca129b5e4621162e58da3922d1` |
| A-fw1 | `~/halt-fw-1-2026-07-23/g0-consolidated-report.md` | `43dc9f2b2e76bdf914dbbacbe0b06006485c4aa70d26b9393192bd34a55d8239` |
| A-bbg0 | `~/halt-bulk-b-2026-07-22/g0-report.md` | `d6a65529623c7928a80ef2016f1f905af93d359a749e37dd3f150e5471aa6dc1` |
| A-bbg1 | `~/halt-bulk-b-2026-07-22/g1-report.md` | `594c8c4da6db7a1a6d1768ff0d81eedd0c1030e3d20b56285c9a5166d96c5846` |
| A-l0g0 | `~/ledger-0-2026-08-07/ledger-0-g0-report.md` | `39f5f5bcef4592b5823e7320d5fb6766890675c25a3befa559fc8e3e3fa0ede4` |
| A-esg0 | `~/edit-safe-1-2026-08-07/edit-safe-1-g0-report.md` | `1ff6960b4ec218063755dddb90b462ccc3aea9a8c51176d1296ad1c94921c74e` |

**SOURCED rows** (`claim-id | file | line(s)`):

| claim | file | line(s) |
|---|---|---|
| C1.2 | S-bld | 3-8 (header: one local builder), 49 (the vote fetch) |
| C1.2 | A-ba1g0 | 25-42 (§G0.1 sole-orchestrator census: only .sh, no CI, fetch invoked nowhere else) |
| C1.3 | S-ing | 500-521 (donor-union; preserved subset 504-512, 518-520) |
| C1.3 | S-syn | 526-537 (sole-restorer writes) |
| C1.3 | A-ba1g0 | 44-54 (§G0.2 the firing configuration), 56-66 (§G0.3) |
| C1.4 | S-seed | 57-61 (rollups-last rationale), 63-70 (governing rule) |
| C1.4 | S-rol | 361-363 (runs-last comment) |
| C1.5 | S-ie | 15 (imports rollups), 369 (internal rollup call) |
| C1.5 | S-seed | 63-65 (must-never-run-without-parent rule) |
| C1.5 | S-t1 | 10-16 (parent derivation from cluster state) |
| C1.6 | S-rep | 10-24 (post-re-ingest repair: re-stamp / reparent / dissolve) |
| C1.7 | S-syn | 405-422 (reset), 462-467 (cluster pass writes parent directly) |
| C1.7 | S-t1 | 10-16 (prior-run derivation it supersedes) |
| C1.8 | S-bld | 4-8 (replaced the nightly Action) |
| C1.9 | S-bld | 62, 79, 80, 86, 87, 88, 92-94 (invocation order conforming to the block; executable content verified byte-identical, comment-stripped, to the pre-amend revision recorded in the BA-1 lane) |
| C1.12 | S-cbr | 624 (the `Archived == 'False'` selection), 440 (same predicate on the registry cross-check input), 656-661 (the disagreement trip-wire; selection ruled authoritative) |
| C1.12 | S-ie | 267 (expenditure side), 352 (receipts/funder side) |
| C1.13 | S-ie | 267 (archived), 268-269 (not Supporting/Opposing), 277 (unmatched target), 286-288 (candidate-committee spender skip), 290 (exact-duplicate collapse), 312-314 (the per-run `stats`, not persisted); 49-54 (`cycle_for`, the label minted for a dateless or out-of-range row) |
| C1.13 | A-l0g0 | §5 (the Supporting/Opposing volume, measured over the expenditures bulk; the archived volumes, measured per collection) |
| C1.14 | S-cbr | 72-78 (`D2PART_NAME`, the five itemizable codes), 440 and 618 (the selection pass and the reassembly pass, both requiring membership) |
| C1.14 | A-l0g0 | §5 (the D2Part tally over the receipts bulk: the out-of-map values are field-shifted artifacts, not types) |
| C1.15 | S-vld | 201-318 (`validate_votes` — VOTES-ROSTER + VOTES-1..8, the single-source assertion at VOTES-5), 143-198 (`ROSTER_FIELDS`, `ROSTER_SCHEMAS` and `_roster` — the parameterization point: absence distinguishable from emptiness, and each shape declaring its position key and optional column contract), 87 (wired into validate) |
| C1.15 | S-av | 156-158 (the seed map, flip-free), 221-238 (apply_featured: votemeta rebuilt whole, positions set-only — the asymmetry the rule closes) |
| C1.15 | S-vld | 426-476 (`validate_shard_freshness` — the two-namespace stamp discriminator and the deep total assert), 1419-1422 (the `--shards` opt-in), 1045-1394 (`self_test` — the roster-and-votes fixtures, incl. the undeclared-shape false-green case and MEMBER-1..7), 1398-1401 + 1416-1418 (its pre-argparse handler and the `--self-test` flag) |
| C1.15 | S-bld | 114 (the validator invoked with `--shards`) |
| C1.16 | S-sbv | whole file (`ingest_sb_votes.py` — the school-board ingest: read-only scope by construction, no write verb anywhere; `mint_member_id` the D-3 slug rule with the four ratified examples as `--self-test` cases; `read_votes` the blank→marker mapping, the fatal unknown-token branch, the structural header contract and the `Outcomes`/`Featured` validation (PS-122, PS-123); `read_cast_by` the optional third tab and its five fatalities (PS-121); `build` the artifact assembly, own-namespace stamps, the `candidacy_ref` carry-through, and the outcome, featured and cast-by carry) |
| C1.16 | S-vld | 321-423 (`validate_members` — MEMBER-1..7, the roster column contract, deliberately outside `validate_votes`' early return), 88 (wired into validate), 155-177 (`ROSTER_SCHEMAS` — the per-shape declaration the contract hangs on), 178 (`_ISO_DATE`, the date predicate a′ names) |
| C1.16 | S-chk | `EDITORIAL_TABS` (all three school-board source tabs declared, the third optional at ingest per PS-121) + `ROLES` (`ingest_sb_votes.py` classified `pipeline-reader`) — the pair that makes the read-only property structural rather than promised |
| C1.17 | S-sbf | 70 (`DUES_TYPE`, the constant the predicate keys on), 274-279 (the single dues-exclusion site — a bare `continue`, with R4a's counter at that same predicate) |
| C1.17 | S-sbf | 268-289 (the filter order, load-bearing for that counter: slug scope 268, aggregate 270, excluded cycles 272, dues 274, donor 281, self 283, window 287-289) |
| C1.17 | S-sbf | 384 (`ie_slice` — the spend side, disjoint from the funding-side dues predicate, which is what makes the exclusion vacuous at $0.00) |
| C2.1 | S-ing | 86-127 (rules), 130-141 (classifier), 314-320 (assignment), 504-508 (partial preserve) |
| C2.1 | S-syn | 520-526 (merge) |
| C2.2 | S-ing | 509-512; S-syn 170-174, 528-531 |
| C2.3 | S-ing | 518-520 (absent from carry); S-syn 175-180, 532-537 (sole restorer) |
| C2.4 | S-ing | 513-520 (guarded carry); S-syn 405-422, 462-467; S-t1 10-16 |
| C2.5 | S-syn | 241-263 (`assert_donor_merges_empty` — the tripwire standing where the writer was; the merge pass that recomputed `aka` is removed, so the field has no writer); A-add 146-160 (§A4.2 writer sweep, census-invisible) |
| C2.6 | S-syn | 546-586 (alias matcher) |
| C2.7 | S-ing | 294-306 (type), 316-334 (identity fields) |
| C2.8 | S-syn | 155-182 (tab reader: the writer-set columns) |
| C2.9 | A-add | 141-160 (§A4: sweep method, aka fixture) |
| C2.10 | A-add | 87-98 (§A2.3: the value-granularity qualifier — property shared, position not) |
| C3.1 | S-ing | 130-141 (short-circuit before rules), 182-189 (name-format heuristic) |
| C3.1 | A-probe | 96-118 (§P3: fallback characterization, w-r-weiss answered) |
| C3.2 | S-ing | 141 (org no-match fallback) |
| C3.3 | A-add | 116-139 (§A3.4: label census; Sheet-only enumeration; numbers live here) |
| C3.4 | S-ing | 130-141 (individual = name shape), 311-312 (self-funding = money provenance) |
| C3.5 | S-syn | 165 (empty cell carried only if non-empty), 521 (fall-through); S-ing 504-508 (union re-classifies bare marker) |
| C3.5 | A-probe | 74-94 (§P2, both representations) |
| C3.6 | S-syn | 520-526 |
| C3.7 | S-syn | 110, 117, 128 (read-only Sheet access); S-av 51-57 (the editor-column set, `reverse_coded` retired out of it), 93-100 (the named read-failure type), 102-115 (get_or_make_tab's created flag), 118-135 (fail-loud read: raise on failure, empty only on a successful read), 137-139 (write_tab's clear+update — what the abort protects, and what removes the retired column on the next run), 268-289 (the three named branches at the call site) |
| C3.7 | S-chk | whole script (the static no-editorial-writeback check: role classification, reader-scope, writer-disjointness, write-verb, allowlist-integrity and tab-declaration rules; `--self-test` fires each on a synthetic violation) |
| C3.7 | S-bld | 108 (the build_all.sh invoker) |
| C3.7 | A-probe | 120-130 ((b) universality + qualifier) |
| C4.1 | S-ing | 147-156 (slug minting; stability rationale in situ) |
| C4.2 | A-bbg1 | 38-40 (SEIU propagation fixture: shared Sheet → elections artifact) |
| C4.3 | A-probe | 152 (banked open-thread naming; mechanism deliberately not characterized here) |
| C4.4 | S-syn | 546-586 (uniqueness-gated alias; never rewrite) |
| C4.5 | S-seed | 287, 314, 339 (the three stamp sites), 410-417 (fatal unknown-race-id), 419-427 (mint-time shared check, fatal) |
| C4.5 | S-vld | 629-695 (the ONE shared implementation: namespace/convention resolvers + election_mismatches), 698-707 (durable INV-ELECT gate), 82 (wired into validate) |
| C4.7 | S-ing | 693-718 (resolve_committee_claimants — the ONE resolver), 597-611 (deterministic linkage build consuming it) |
| C4.7 | S-rst | whole script (claims-derived re-stamp; ruled-four-fields write; fifth-field fail-loud; idempotent) |
| C4.7 | S-vld | 728-776 (INV-LINK-1..3), 710-717 (the PS-82-independence rationale and the coverage-limit statement, which live in the block header rather than in the function — the pre-amend row cited only the function while describing both), 83 (wired into validate) |
| C4.6 | S-rol | 187-192, 206-210 (by_candidate/by_race keyed (id, cycle) — no election), 212-282 (by_candidate_election, the election-keyed variant) |
| C4.6 | S-vld | 590-595 (INV-PERSON-1 pins by_candidate.all as dedup identity) |
| C4.8 | S-syn | 67-68 (the artifact list + known-failures path), 606-630 (shrink-only loader: growth and owner-less entries fail in code), 632-657 (`resolvable_donor_ids` — the union across artifacts, disk reads only), 659-685 (`check_tag_continuity` — unresolved ids, and a listed entry that no longer fails), 788-817 (the call site: runs before the write, aborts on failure) |
| C4.8 | A-esg0 | §3 (the orphan census against the union, and the re-mint signature it caught) |
| C4.9 | S-syn | 691-713 (`coverage_figure`), 801-809 (the per-artifact report and its stated collection scope) |
| C4.9 | A-esg0 | §2 (pull-model established from bytes; the coverage gap and its collection scope) |
| C5.1 | A-fw1 | 7-16 (fix sites exist only in the elections path; artifact layer separate) |
| C5.2 | S-cemb | 47 (dataUrl at the `refs/heads/main/` form), 48-52 (sharded mode, present-but-commented), 68 (feedback endpoint), 3425+3443 (subject prefix) |
| C5.2 | S-sbemb | 66-70 (the `refs/heads/main/` rationale in situ, then `dataUrl` and `financeUrl` — TWO artifacts since SBFIN-1, where this row previously named one), 2979+2989 (the two artifact fetches), 81+83 (feedback endpoint + subject prefix), 2959 (the POST) |
| C5.2 | S-eapp | 21 (DEFAULT_SRC at the ratified refs/heads/main/ form), 25-27 (ART_BASE + the two verification artifacts), 301 (src resolution: data-src → window.IPG_DATA_URL → baked default) |
| C5.2 | S-eemb | 17-18 (data-src override documented), 19-24 (artifact + the code-only inlining: data.js/render.js/app.js + styles into one Code Block) |
| C5.2 | A-ba1g2 | 49 (Rider 2: neither embed renders entity-type / last-editor — a TWO-embed sweep, predating the school-board path; the third was measured at REF-C52 and agrees) |
| C5.5 | S-edat | 146-150 (selectorOptions — the {year} {body} pattern), 855-866 (officeRaces election scoping via the year-prefix join), 802-804 (the race's window rides the VM), 819-821 (priorElection re-homed to the base VM) |
| C5.5 | S-eren | 899-907 (selectorNav), 784-791 (the verbatim prior-note; the formerly-cited on_current_record string is DELETED — its retirement is C5.7's affordance clause) |
| C5.5 | S-eapp | 143-158 (selector state + read-only ?election= boot), 213-222 (scope switch resets the active race — the ruled B6 resolution) |
| C5.7 | S-edat | 915-1000 (resolvePersonRef 919 — id-only resolution + durable link; personView 950 — member sections, window-scoped figures, career total, boolean out-of-window condition, no IE key), 1363 (exports) |
| C5.7 | S-eren | 668-704 (renderPersonModal — per-member sections + ratified strings), 706-712 (renderPersonMissing — string 7), 737-747 (facet map with on_current_record retired), 752-757 (personAffordance — string 13 label), 793-795 (card affordance), 811-822 (pendingCard explicit on_current_record branch) |
| C5.7 | S-eapp | 81-85 (openPerson — no window parameter), 97-98 (data-person dispatch, no winFromEl), 282-291 (read-only ?person= boot — the deep-link path) |
| C5.8 | S-edat | 454-458 (spenderFunders exclusion — the funder-rollup gap closed), 504-508 (donorFootprint exclusion — load-bearing for the windowless opener) |
| C5.8 | S-eren | 484-485 (iePanel basis label + string-2 empty state), 646-651 (committee-profile basis label, string-2 empty state, structural no-identity-claim) |
| C5.8 | S-cemb | 1019-1026 (cfInSubject + cfDuesRow + cfCountable — the shared full-set predicates), 1316-1321 (donor-index split: dues out first, then in-subject totals + separate before-May-2011 accumulator), 1440/1460/1567/1636/1905/3123 (full-set call sites: industry, per-alder industry, flags, IE funders, industry-detail, correlation index; IE spender sums filtered in situ), 1557-1565 (flag rows seeded from flagged donors — a fully-excluded flag renders zero, never vanishes), 2067-2076 (string 7 on the structural zero), 2602 (string 8, methodology), 1115-1133 (alder-profile in-subject views + curated option + string 4), 1675-1698 (pre2011SubView — strings 3/4, display-only rows), 1758-1760 (strings 5/6 on the ranked list), 3048-3052 (view bindings) |
| C5.3 | A-fw1 | 14-16 (artifact not fused), 60-62 (gates check values, not structure) |
| C5.4 | A-probe | 152 (banked sizing item: multiple surfaces, per-path render compliance) |
| C6.1 | A-ba1g0 | 56-66 (dollar/repairability distinctions); A-ba1g2 49 (render-invisibility distinction) |
| C6.2 | A-ba1g0 | 56-66 (§G0.3 dollar-invisible by construction); A-add A1.7 caution (see §A1) |
| C6.3 | A-ba1g0 | 56-66 (both fixtures: Sheet-repairable vs the notes strip with no repair path) |
| C7.1 | A-bbg0 | 8-15 (race-map sense); S-ing 595 + S-syn joins (sbe-id sense via committee sbe ids) |
| C7.2 | this document §1 (positional definition) + A-probe 42-72 (§P1 usage of record) |
| C7.3 | A-probe | 74-94 (§P2), 90 (the overload stated) |
| C7.4 | S-ing | 518-520 (the carry set) |
| C5.9 | S-rol | 143 (the Aggregate-donor set), 157 (member counts exclude it), 161-168 (the one direct-layer loop: row-flag and donor-set skips governing by_parent/by_industry/by_alder/by_candidate/by_race), 265 (by_candidate_election's row-flag-only skip), 312-319 (by_person's paired skips) |
| C5.9 | S-t1 | 67-73 (slice1 by_parent paired skips), 90-93 (the [8-check] oracle mirrors both) |
| C5.9 | S-ing | 530-533 (the retired underscore-prefix marking, comment of record) |
| C5.10 | S-sbemb | 954-956 (`seatVisible` — the one seat filter every seat-iterating surface shares), 957-970 (PS-127 (i)'s sole exception and its single-caller constraint), 1135-1147 (`seatSelector`, the vacancy present by design at 1138-1141), 1187-1191 (the vacancy card — a seat notice, never a member page) |
| C5.10 | S-sbv | 250 (`read_votes` reads `source_url` as a fixed column), 378 + 393 (the carry into the artifact, roster and vote sides) |
| C5.10 | S-sbemb | 1206 (the per-vote Source link on the meta surface), 1256 (the vote card's Source link) |
| C5.10 | S-sbemb | 60-64 (the enumerated N=2 fetch statement the gate asserts by count, so a third fetch fails rather than drifting silently) |
| C5.11 | S-sbemb | 2654-2690 (`render` — the view router; its terminal `else` at 2683 falls through to `methodologyView` rather than throwing) |
| C5.11 | S-sbemb | 2663-2666 (the member, record, matrix and spend tests), 2682 (the board test — the fifth named view) |
| C5.12 | S-sbemb | 2601-2652 (`methodologyView` — the view the terminal else reaches), 2634-2643 (the SFM fold: heading through f6, with `SF.allElectionsDisclosure` re-emitted at 2636 and the `duesFigure` loading fallback at 2638-2641) |
| C5.12 | S-sbemb | 672-679 (the SFM string declarations) |
| C5.9 | S-srv | 471-508 (cluster-preview totals mirror the rollup exclusion set exactly) |
| C5.9 | S-rec | 39, 207-208 (contribution-type set-aside, excluded from the itemized compare) |
| C5.9 | S-edat | 415-441 (contributor rollup counts every row; the broader render marking incl. small-dollar), 534 (row-flag carriage into the footprint VM) |
| C5.9 | S-eren | 413-422 (the labeled, non-clickable pinned aggregate line; rows sum to the headline), 512 (the aggregate-of-N row chip) |
| C5.9 | S-cemb | 1145-1153 (alder-profile headline counts the tail into totals and stats), 1192-1212 (the restored disclosure line and its superseded HALT-MIG-1 comment of record), 3125 (correlation-index donor-type skip) |
| P1 | A-fw1 | 60-62 (proposed fused-per-candidate detector, not built) |

**RULED pointers** (`claim-id | ruling | register entry`; ruling text and provenance live in
`RULINGS.md`, the authority of record per PS-75/PS-87):

| claim | ruling | register entry |
|---|---|---|
| C1.1 | PS-25 / PS-44 | `RULINGS.md` §PS-25, §PS-44 |
| C1.7 | PS-45 | `RULINGS.md` §PS-45 |
| C1.10 | PS-29 | `RULINGS.md` §PS-29 |
| C1.11 | PS-80 | `RULINGS.md` §PS-80 |
| C4.5 validator requirement | PS-81 | `RULINGS.md` §PS-81 |
| C6.6 | PS-82 | `RULINGS.md` §PS-82 |
| C4.6 disposition | SCOPE-PIPE G1 §3 | `RULINGS.md` §SCOPE-PIPE G1 §3 |
| C5.5 display semantics | SCOPE-UI G1/G3 | `RULINGS.md` §SCOPE-UI G1/G3 |
| C4.7 ownership rule | PS-84 | `RULINGS.md` §PS-84 |
| coverage-count stop conditions | PS-85 | `RULINGS.md` §PS-85 |
| C5.6 | PS-86 rev 3 | `RULINGS.md` §PS-86 |
| C5.7 frame | PS-89 rev 2 | `RULINGS.md` §PS-89 |
| C5.7 IE deferral | PS-90 | `RULINGS.md` §PS-90 |
| C5.7 career total | PS-91 rev 2 | `RULINGS.md` §PS-91 |
| C5.7 career-total rule | P1D-PERSON G1/G2 | `RULINGS.md` §P1D-PERSON G1/G2 |
| C5.7 identity rule | PS-92 | `RULINGS.md` §PS-92 |
| C5.8 | PS-93 | `RULINGS.md` §PS-93 |
| C5.8 full-set rule | PS-94 | `RULINGS.md` §PS-94 |
| C5.8 dues exclusion | PS-95 | `RULINGS.md` §PS-95 |
| C5.8 strings | EXCL-UNIFORM G1 | `RULINGS.md` §EXCL-UNIFORM G1 |
| C5.9 | PS-96 | `RULINGS.md` §PS-96 |
| C1.15 | PS-99 | `RULINGS.md` §PS-99 |
| C2.5 aka retirement | PS-97 | `RULINGS.md` §PS-97 |
| C2.9 | discipline 29 | `RULINGS.md` §Discipline 29 |
| C6.4 | DOCS-M1 (no id) | `RULINGS.md` §DOCS-M1 C6.4 |
| C6.5 | PS-60 | `RULINGS.md` §PS-60 |
| C2.10 routing | PS-9 | `RULINGS.md` §PS-9 |
| detector class | PS-33 / PS-54 | `RULINGS.md` §PS-33, §PS-54 |
| P2 | PS-23 | `RULINGS.md` §PS-23 |
| P3 | PS-32 | `RULINGS.md` §PS-32 |
| P4 | PS-49 | `RULINGS.md` §PS-49 |
| C3.4 display ruling | PS-12 | `RULINGS.md` §PS-12 |

**Conformance record:** `build_all.sh` (S-bld, sha above) conforms to the §1 chain block as
of this commit. ~~Its executable content is byte-identical (comment-stripped comparison) to
the revision the BA-1 lane shipped; only inert comment text differs.~~ Superseded at DOCS-M4:
its executable delta from the BA-1 revision is exactly one appended validation-gate line —
the PS-73 docs-form check [P5] — verified by comment-stripped diff at that lane; the chain
steps and their order are unchanged. This row is the baseline for the proposed
chain-consistency check [P4].

**UNVERIFIED register:** C4.3 `ie-committee-*` mechanism — *deferred-by-design* (own queued
lane; owns the same file's help-string repoint). C7.5 "behind" — *gap* (no byte
source). §5 surface enumeration — not carried here; the count is current state and routes
to the handover.
