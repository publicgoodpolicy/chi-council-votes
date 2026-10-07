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
  -> build_rollups -> apply_cash_on_hand -> build_shards -> validate_council_data

elections-canonical:
  build_election_seed -> ingest -> transform_slice1 -> transform_slice2
  -> ingest_ie -> enrich_committee_names -> sync_overrides -> build_rollups
  -> build_sb_finance -> validate_council_data
  (build_sb_finance also requires ingest_sb_votes: it reads the school-board
   roster's candidacy_ref bridge as well as rollups.*, and hashes both inputs)

build_all.sh (votes builder; finance section conforms to council-canonical,
omitting by design: convert_bulk_receipts, repair_clusters, ingest_ie,
enrich_committee_names, apply_cash_on_hand):
  sync_bios -> ingest_votes -> sync_allvotes -> [ingest, gated on staged receipts]
  -> transform_slice1 -> transform_slice2 -> sync_overrides -> build_rollups
  -> build_shards -> validate
```

**Where each chain's artifact comes from** [C1.19, SOURCED]: neither canonical chain rebuilds its artifact from the sealed vintage. `campaign-finance/ingestion/ingest.py` reads the artifact on disk and replaces each committee's own rows into it; `campaign-finance/elections/build_election_seed.py` reads the existing artifact and preserves its committees, donors, contributions and independent expenditures on a re-run. A change to how a donor id is minted therefore lands by regenerating the IE layer and everything downstream of it on the artifacts at the previous commit, and `campaign-finance/ingestion/ingest_ie.py` prunes the donor records its re-key orphans (§2, C2.11), because the only other donor prune, in `campaign-finance/ingestion/ingest.py`, runs upstream of it. Measured at IE-NAMES-1.

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
mechanism this rule exists to close — ~~**neither has ever deleted a key**~~ — **amended at
HYGIENE-1: until then neither deleted a key; since then `apply_featured` prunes every
per-alder code the rebuilt `votemeta` no longer carries, and `merge_bios` carries forward
only codes that still resolve to a `votemeta` entry, so un-featuring or renaming a vote
leaves no orphan for the single-source assertion below to reject** — while `votemeta` is
authoritatively rebuilt each run. A renamed vote code therefore left its old key on every
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
slug scope, aggregate, excluded cycles, dues, other receipts (C5.16: a bare skip through the
rollup builder's imported test, with no counter), donor resolution, self-funding, window — and
the order is load-bearing for that counter, not incidental. The exclusion is nevertheless vacuous
here **by disjointness rather than by luck**: `ie_slice()` reads the spend side
(independent expenditures) while the dues predicate reads funding-side contributions, so no
dues row is in the set the slice sums and the excluded total is $0.00 for this dataset. That
is a property of the two sides, not of the data, and it is why a non-zero figure here would
be a finding about the slice rather than about dues. Built at SBV-BOARD-1, on the data port
SBV-PORT-1 landed.

### Feasibility floor for material operations [C1.18, RULED — see PS-133]

**A dispatch directing material operations premises resource feasibility against measured
inputs — sum of sizes against free space — before the first byte moves, and measured free
space on the working volume at ≥ 5 GiB is a hard stop on the dispatch's enumerated stop
conditions.** Below the floor the executor holds and reports both the reading and the
operation's derived need; it does not proceed on re-derived headroom. PS-133 is the ruling
of record; cite it rather than restating a number here or in any dispatch.

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

**IE funder identity** [C2.11, SOURCED]: an IE funder's donor id is minted from a name built by the receipts ingest's own builder — the "Last, First" form assembled in `campaign-finance/ingestion/convert_bulk_receipts.py` from SBE's LastOnlyName and FirstName — handed to the shared slug, so a person filed on both the receipts side and the IE side resolves to one id; `campaign-finance/ingestion/ingest_ie.py` imports that builder rather than carrying a second rule. After re-adding its rows the IE ingest prunes every donor left with zero contribution rows, counted as donors_pruned_rowless; a receipts-side donor can never be pruned because the referenced set is over all contributions. Ruled at IE-NAMES-1 (the register entry of that name). The `ie-committee-*` suffix gap (C4.3) is a different mechanism and is not characterized by this row.

**A ward committee's cash on hand is pipeline-written from its latest D-2** [C2.12, SOURCED]: `campaign-finance/ingestion/apply_cash_on_hand.py` writes `cash_on_hand`, its as-of date, the same report's investments and its FiledDocs id on every ward committee, from the final version of the committee's latest D-2 period report in the sealed vintage — "final" exactly as `reconcile.build_filing_registry` resolves it, imported rather than restated. It replaces an editor-entered value, and a committee with no D-2 period report gets no figure rather than a stale one. `campaign-finance/ingestion/ingest.py` updates an existing committee's factual fields and leaves these four alone, so a council rebuild keeps them; nothing else writes them. The council embed renders the figure and its date on the Political Spend tab, and the investments as a second line only where they are non-zero.

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
**IE renders in its own component** (PS-90's banked form, shipped by P1-E B under PS-141): one
row per member election, support and opposition separate, below the member sections — never
inside one, never in the career total or across elections; the deferral-scoped exclusion is
superseded, and the permanent firewall invariant remains INV-PERSON-2 at the artifact layer,
expressly distinct. A 2024 card whose receipts were filed on the committee its person uses
later reads that committee's in-window receipts, found by id (M3, PS-141). An out-of-window
disclosure line renders when the owning committee carries money outside every member
election's window, computed as a **boolean** — no unwindowed figure is materialised in
render scope. Person resolution is **by id, never by name** (PS-92), and a candidacy id
belonging to a linked person resolves to that person (the durable-link rule), so shared
links survive later linking. The retired returner-pointer card carries the person
affordance in the deleted string's place (SCOPE-UI B7's retirement condition, discharged);
the affordance's label is the ratified string 13 — the arrow is part of the ratified text,
and the candidate name is not composed into it (HALT-S13; the register's P1D-PERSON entry).

**Own money and other-committee money are two per-row stamps, and every surface reads them**
[C5.15, RULED — see PS-142 and PS-143; sites SOURCED]. `build_rollups` writes both. `is_self`
is the relational name match of PS-135, stamped in election mode only. `is_own_committee`
marks a transfer from another committee of the same person and is stamped in both artifacts
from one closed, ruled list, `campaign-finance/ingestion/own-committee-transfers.json`: a
pair is the receiving committee typed `candidate`, by its SBE id, and the giving donor's id.
The list loads fail-loud, and at every build the stamp is set on the listed pairs' rows and
removed from every other row, so the stamp is the list. `validate_council_data`'s
`[OWN/COMMITTEE]` refuses a stamp outside the list, a listed pair's row without the stamp, a
listed pair with no row, a listed giver that shares a donor cluster, and a row carrying both
stamps; each artifact is held to the whole list. No rollup moves: the money stays in
`direct` and in the `contributions` stream. The elections tool's card figures split raised
into own money (`is_self`), other-committee money (`is_own_committee`) and other donors; the
donor-wide test the cards once used is retired, so the card and its donor list read one stamp.
A donor line is still marked at the grain of the rolled-up parent, so a cluster that joined a
candidate to another donor would chip the whole line; the validator keeps listed givers out of
clusters, and nothing yet does the same for a candidate's own donor record.
The council tool reads the same stamp for its line under the tiles, its chips and the donor
profile's recipient row. The three display strings are PS-142's.

**A committee's other receipts are in no figure, are stated where its money is shown, and are
published by magnitude** [C5.16, RULED — see PS-147; sites SOURCED]. A contribution row whose
filed type is `Other Receipt` and that is not stamped `is_own_committee` is excluded wherever the
dues transfers are. `build_rollups` tests it with one function, `is_other_receipt`, at the three
sites of the dues test, and `build_sb_finance` imports that function. Each embed adds the test to
its one shared exclusion predicate, `cfCountable` in the council embed and `excludedType` in the
elections embed's `data.js`, so the set still binds as a set (C5.8). The stamp is read with the
type: a listed own-committee pair's row is counted whatever its filed type (PS-142), and
`stamp_own_committee` runs at `build()` entry, before any site reads the stamp. The builder emits
the magnitude as `other_receipts_excluded` in both artifacts at every build;
`validate_council_data` recounts it under a predicate stated in the validator, and holds every
`by_parent` entry to a recount that leaves these rows out. The surfaces state what they leave out.
The council embed's alder profile sets the rows aside before any sum and renders them as a line
that opens a list of payers. The elections embed's `candidateFigures` returns them beside the
card's figures, for the card, the person view and a campaign committee's pop-up to render as a
line. The elections embed's methodology states a figure of its own for each page:
`otherReceiptsOnPage` sums the lines of the page's cards, each read through `candidateFigures` for
the card's funding candidacy in its race's own window, because the artifact's field covers every
office the artifact holds and every date in the subject, and a page would state money none of its
cards show; the council embed's methodology states its artifact's field. A loan is not in the set:
it stays counted, and the council embed marks a donor row whose money includes one, summing loans
over the same rows its totals count. `editor/serve.py`'s cluster preview imports the builder's
test, so its dry-run figure still equals the rendered rollup (C5.9); the editor's work-queue
totals and the classification export do not apply it and are not published figures.

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
earliest school-board election window was open-start until FIX-1 set it to 2024-01-01
(PS-134), and even so **the protection on windowed figures is the cycle filter, not the
window**, asserted at gate. **The exclusion set is larger than cycles, and it
binds as a set** (PS-94): dues transfers between political committees are excluded from
every published total while their rows stay in the substrate, typed distinctly (PS-95 —
the rule's first text of record; it governed as FW-1's rule (c) pre-register), a committee's
other receipts joined the set at AUDIT-2 M2 (C5.16), and every
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

**The elections embed's methodology view branches on office, and the branch it takes for
`city_council` is composed from register text** [C5.13, SOURCED]: `methodologyView()` on the
elections embed took no office until CNCL-DATA-1 P2.1 — the D-22 / PS-112 gate chose between
rendering it and rendering coming-soon, and the body behind the gate was a single school-board
composition. It now takes an office and emits, for `city_council`, the shared frame, eight `<p>`
carrying the ratified strings C1, C2, C5, C3, C4, C6, C7, C8 in that order with no `<h3>` before any of them,
then the verification section. The frame and that section are single expressions used by both
branches, so their byte-identity across offices holds by construction rather than by a copy kept
in step; so, since AUDIT-2 M2, are C7 and C8, which the school-board branch emits under a heading
of its own after its itemization paragraph (C5.16). No school-board section is carried across to
the council branch, which `[MUNI/SUBJ]` enforces by requiring each
member office's rendered methodology to name its own subject and neither other office's. Three
gate lines guard the arrangement and they are not interchangeable: `[MUNI/METH]` asserts that only
an office with a ratified methodology renders one at all, `[MUNI/SUBJ]` that a member office's
copy is its own, and `[METH/REGISTER]` that the copy IS the register's text — extracted from
`RULINGS.md` by heading at run time and compared character for character after the register's
quoting and line wrapping are normalized away. The first two can both pass while the rendered
words have drifted from the ratified words; only the third closes that.

**The school-board funding methodology renders unconditionally within the methodology
view** [C5.12, SOURCED]: the SFM fold sits inside `methodologyView()`, reached as the
router's terminal else, rendering the SFM strings in their ratified order with the
all-elections disclosure re-emitted from its own string-table entry and the dues figure
substituted from `duesFigure()` behind a loading fallback — a data-readiness branch, not
an office branch. Office-gated methodology rendering is the elections embed's behavior,
implemented as the D-22 / PS-112 gate in its own `render.js` and asserted by the gate's
`[MUNI/METH]` line; no such gate exists on this single-office surface.

**The elections data+render harness is the pre-paste check of the pure layers** [C5.14,
SOURCED]: `campaign-finance/elections/embed/tools/prerender_b2.js` loads the committed
`campaign-finance/election-data.json` and exercises
`campaign-finance/elections/embed/data.js` and `campaign-finance/elections/embed/render.js`
as a server-side pre-render would — no DOM, no preview file, and since SBE-RERUN-1 it writes
nothing. Its assertions pin subjects no other check covers, among them the donor footprint
modal's kicker, grouping sentence and office groups, the scoped footprint's exclusion of IE
committees that never spent in the page's office, the coming-soon states, and the display
face; the gate runs it whole as `[RENDER/B2]`, so it is both the verify-before-paste step in
`campaign-finance/elections/embed/DEPLOY.md` and a gate line. It reads the sources, not the
bundles: a bundle rebuilt by `campaign-finance/elections/embed/tools/build_embed.js` renders
what it asserts, and a hand-edited bundle is invisible to it.

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
| S-ing | `campaign-finance/ingestion/ingest.py` | `5f84efb279c3d7f37bc7cea4bffb003d0d77f05831b77ced67aa89c308966347` |
| S-syn | `campaign-finance/sheets-sync/sync_overrides.py` | `0bac13ab7c15a02197822b77b7c1144ad3b12655b37322208476a3b0d3d73913` |
| S-bld | `campaign-finance/build_all.sh` | `a7b1675cdf0cb34130bd0df6d865d5575ab596d8cff4f816722b12ab55edefe6` |
| S-t1 | `campaign-finance/ingestion/transform_slice1.py` | `5f807b26245ee22173d3903b9b8a3825f224c47c4f2d7ad11042ee87a6ccb68d` |
| S-ie | `campaign-finance/ingestion/ingest_ie.py` | `69ac0f3a5d1db24a8c6d6ca90424199bffd8fbde0da31926ecb1e5221e8976c6` |
| S-rep | `campaign-finance/ingestion/repair_clusters.py` | `90cc6912647479510d10d505debb84d18fbd28557bf5996b01a992eb1ddf283c` |
| S-rol | `campaign-finance/ingestion/build_rollups.py` | `688f95dd6f1342daf47a57bf8cbd11a3505cd0370a7c11aac152e9c84766f323` |
| S-own | `campaign-finance/ingestion/own-committee-transfers.json` | `341baf4287cacbc2c2d783efaf7f56a6b9335e8d6b96adad9acca7cd046ad4e2` |
| S-seed | `campaign-finance/elections/build_election_seed.py` | `b4e079602f10625b67cd1df74cc2457bd27d329628939d35a178f122888686ed` |
| S-vld | `campaign-finance/ingestion/validate_council_data.py` | `095977689ae8972d726deb9ce48009c0bb1e3711e3c08484006a79493fa6cb3f` |
| S-sbv | `campaign-finance/ingest_sb_votes.py` | `d4d7f6050b1f7dac07e07d27067fbf35ffe4f29a05e6cee74687412338a110b3` |
| S-rst | `campaign-finance/ingestion/restamp_committee_linkage.py` | `6ceb82f9bbcffa08fdb21904b8585982a6bff7e3982e0b810937e2958019d06e` |
| S-cbr | `campaign-finance/ingestion/convert_bulk_receipts.py` | `6062d0dfea8802f17a3434bef8e88097b7ad932bc17811f14d75055dfc3269ce` |
| S-av | `campaign-finance/sync_allvotes.py` | `489ece598a942f9e2c205e229ce4b97e3e51687dc03313243c893ace41f5c40c` |
| S-cemb | `campaign-finance/elections/reference/council-embed.html` | `93c50534103789c942c37878f900a1ef1639bc50dbeb00334af30ba26764c2e1` |
| S-sbemb | `campaign-finance/school-board/school-board-embed.html` | `a80351a91bc51fad203330629e8016ea2a48d1b74827cd4d1e0fb638621402e9` |
| S-eemb | `campaign-finance/elections/embed/elections-embed.html` | `8e76a38ad11562fe8de5bee1c2ff339ea60251795171bdd37f9aa29da2e0b82a` |
| S-edat | `campaign-finance/elections/embed/data.js` | `0157d27831f07d24184405f0faaf2e8e8cd5c2b01071b7914d614658bd021414` |
| S-eren | `campaign-finance/elections/embed/render.js` | `80f20e421a5e7a12160136216b6aade596101275d61606b236dc14e84f6a6159` |
| S-eapp | `campaign-finance/elections/embed/app.js` | `adaeb1192a4292945cf46feec8cd5fa5426275dc2022603f9d3f928f148d0d37` |
| S-srv | `campaign-finance/editor/serve.py` | `3adcdf6dca88b969f0a62de7fd696d26def569abe2bd613f60b74ec122720e2b` |
| S-rec | `campaign-finance/ingestion/reconcile.py` | `363c3c19341508463d6f5563e2fe2defa3fb59e7626b48b3e31b13e0180acb50` |
| S-egate | `campaign-finance/elections/embed/tools/gate_bundle.js` | `a8bfad7c9f6262fe814cdd46572324902dc3219ac8ac92553b2b4f1916bbce8b` |
| S-chk | `campaign-finance/tools/check_sheet_scopes.py` | `9c980fd7362351a7df8a889ba60dc1a38d4fcee397200903a4f7d1b7bc620e94` |
| S-sbf | `campaign-finance/ingestion/build_sb_finance.py` | `0b7e72af86d9588661b9d3bd6caac0ed9aaaf6990cd0d645e9ef400a8e7a70ee` |
| S-a7 | `campaign-finance/sheets-sync/a7_precheck.py` | `a9d7e4669a4dc7b614d5d85939432a3317e3718d9a91cc9a9f0d50ca9ef73374` |
| S-iv | `campaign-finance/ingest_votes.py` | `167757809a654effaddaf79f62e3ea82881dfe85e555b9acaa90532eb63b0ef1` |
| S-bios | `campaign-finance/sheets-sync/sync_bios.py` | `0bce2d545e884fedd07fa814f69381582f7487cc12734c1b8c4152a83d89722a` |
| S-bemit | `campaign-finance/elections/embed/tools/build_embed.js` | `727955e51eb4739646ea81b6d007135eec13fe16de2acc92c95db904dd6c370e` |
| S-b2 | `campaign-finance/elections/embed/tools/prerender_b2.js` | `c34259ae687e4db35412e3be9760532bf2bdd5046ad2b7b5d11cb1b28697f4c2` |
| S-coh | `campaign-finance/ingestion/apply_cash_on_hand.py` | `fc6593ad330c80f611ba6af54fb371aef17324eb8815b850e1f23e34e0e7fc73` |
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
| C1.4 | S-rol | 461-464 (runs-last comment) |
| C1.5 | S-ie | 15 (imports rollups), 402 (internal rollup call) |
| C1.5 | S-seed | 63-65 (must-never-run-without-parent rule) |
| C1.5 | S-t1 | 10-16 (parent derivation from cluster state) |
| C1.6 | S-rep | 10-24 (post-re-ingest repair: re-stamp / reparent / dissolve) |
| C1.7 | S-syn | 405-422 (reset), 462-467 (cluster pass writes parent directly) |
| C1.7 | S-t1 | 10-16 (prior-run derivation it supersedes) |
| C1.8 | S-bld | 4-8 (replaced the nightly Action) |
| C1.9 | S-bld | 62, 79, 80, 86, 87, 88, 92-94 (invocation order conforming to the block; executable content verified byte-identical, comment-stripped, to the pre-amend revision recorded in the BA-1 lane) |
| C1.12 | S-cbr | 624 (the `Archived == 'False'` selection), 440 (same predicate on the registry cross-check input), 656-661 (the disagreement trip-wire; selection ruled authoritative) |
| C1.12 | S-ie | 286 (expenditure side), 377 (receipts/funder side) |
| C1.13 | S-ie | 288 (archived), 289-290 (not Supporting/Opposing), 305 (unmatched target), 314-316 (candidate-committee spender skip), 318 (exact-duplicate collapse), 340-349 (the per-run `stats`, not persisted); 53-58 (`cycle_for`, the label minted for a dateless or out-of-range row) |
| C1.13 | A-l0g0 | §5 (the Supporting/Opposing volume, measured over the expenditures bulk; the archived volumes, measured per collection) |
| C1.14 | S-cbr | 72-78 (`D2PART_NAME`, the five itemizable codes), 440 and 618 (the selection pass and the reassembly pass, both requiring membership) |
| C1.14 | A-l0g0 | §5 (the D2Part tally over the receipts bulk: the out-of-map values are field-shifted artifacts, not types) |
| C1.15 | S-vld | 204-321 (`validate_votes` — VOTES-ROSTER + VOTES-1..8, the single-source assertion at VOTES-5), 146-201 (`ROSTER_FIELDS`, `ROSTER_SCHEMAS` and `_roster` — the parameterization point: absence distinguishable from emptiness, and each shape declaring its position key and optional column contract), 87 (wired into validate) |
| C1.15 | S-av | 159-161 (the seed map, flip-free), 195-253 (apply_featured: votemeta rebuilt whole, then every per-alder code it no longer carries pruned — the asymmetry the rule named, closed), 256-267 (_prune_positions), 270-340 (self_test — the un-feature fixture across both writers, with its bite) |
| C1.15 | S-vld | 429-484 (`validate_shard_freshness` — the two-namespace stamp discriminator and the deep total assert), 1812-1815 (the `--shards` opt-in), 1281-1787 (`self_test` — the roster-and-votes fixtures, incl. the undeclared-shape false-green case and MEMBER-1..7), 1791-1794 + 1809-1811 (its pre-argparse handler and the `--self-test` flag) |
| C1.15 | S-bld | 114 (the validator invoked with `--shards`) |
| C1.15 | S-iv | 265-285 (populate_featured — positions written set-only from the featured map; the prune downstream in sync_allvotes removes what it leaves) |
| C1.15 | S-bios | 91-119 (merge_bios — the rebuilt roster carries forward only codes resolving to a votemeta entry) |
| C1.15 | S-egate | 2748-2757 ([AV/SELF]) |
| C1.16 | S-sbv | whole file (`ingest_sb_votes.py` — the school-board ingest: read-only scope by construction, no write verb anywhere; `mint_member_id` the D-3 slug rule with the four ratified examples as `--self-test` cases; `read_votes` the blank→marker mapping, the fatal unknown-token branch, the structural header contract and the `Outcomes`/`Featured` validation (PS-122, PS-123); `read_cast_by` the optional third tab and its five fatalities (PS-121); `build` the artifact assembly, own-namespace stamps, the `candidacy_ref` carry-through, and the outcome, featured and cast-by carry) |
| C1.16 | S-vld | 324-426 (`validate_members` — MEMBER-1..7, the roster column contract, deliberately outside `validate_votes`' early return), 88 (wired into validate), 158-179 (`ROSTER_SCHEMAS` — the per-shape declaration the contract hangs on), 181 (`_ISO_DATE`, the date predicate a′ names) |
| C1.16 | S-chk | `EDITORIAL_TABS` (all three school-board source tabs declared, the third optional at ingest per PS-121) + `ROLES` (`ingest_sb_votes.py` classified `pipeline-reader`) — the pair that makes the read-only property structural rather than promised |
| C1.17 | S-sbf | 70 (`DUES_TYPE`, the constant the predicate keys on), 289-294 (the single dues-exclusion site — a bare `continue`, with R4a's counter at that same predicate) |
| C1.17 | S-sbf | 283-306 (the filter order, load-bearing for that counter: slug scope 283, aggregate 285, excluded cycles 287, dues 289, other receipts 295, donor 298, self 300, window 304-306) |
| C1.17 | S-sbf | 401 (`ie_slice` — the spend side, disjoint from the funding-side dues predicate, which is what makes the exclusion vacuous at $0.00) |
| C1.19 | S-ing | 586 (reads the artifact on disk), 523-528 (replaces that committee's rows), 688-689 (writes it back) |
| C1.19 | S-seed | 429-435, 447-451 (preserves committees, donors, contributions, independent_expenditures on re-run) |
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
| C2.11 | S-ie | 18 (imports the receipts name builder above the csv field-size line; the order is load-bearing), 386 (funder name in the receipts form), 413-416 (row-less prune after the re-add) |
| C2.11 | S-cbr | 323-325 (the "Last, First" name builder) |
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
| C4.5 | S-vld | 637-703 (the ONE shared implementation: namespace/convention resolvers + election_mismatches), 706-715 (durable INV-ELECT gate), 82 (wired into validate) |
| C4.7 | S-ing | 693-718 (resolve_committee_claimants — the ONE resolver), 597-611 (deterministic linkage build consuming it) |
| C4.7 | S-rst | whole script (claims-derived re-stamp; ruled-four-fields write; fifth-field fail-loud; idempotent) |
| C4.7 | S-vld | 736-780 (INV-LINK-1..3), 718-725 (the PS-82-independence rationale and the coverage-limit statement, which live in the block header rather than in the function — the pre-amend row cited only the function while describing both), 83 (wired into validate) |
| C4.6 | S-rol | 271-276, 290-294 (by_candidate/by_race keyed (id, cycle) — no election), 296-380 (by_candidate_election, the election-keyed variant) |
| C4.6 | S-vld | 598-604 (INV-PERSON-1 pins by_candidate.all as dedup identity) |
| C4.8 | S-syn | 67-68 (the artifact list + known-failures path), 606-630 (shrink-only loader: growth and owner-less entries fail in code), 632-657 (`resolvable_donor_ids` — the union across artifacts, disk reads only), 659-685 (`check_tag_continuity` — unresolved ids, and a listed entry that no longer fails), 788-817 (the call site: runs before the write, aborts on failure) |
| C4.8 | A-esg0 | §3 (the orphan census against the union, and the re-mint signature it caught) |
| C4.9 | S-syn | 691-713 (`coverage_figure`), 801-809 (the per-artifact report and its stated collection scope) |
| C4.9 | A-esg0 | §2 (pull-model established from bytes; the coverage gap and its collection scope) |
| C5.1 | A-fw1 | 7-16 (fix sites exist only in the elections path; artifact layer separate) |
| C5.2 | S-cemb | 47 (dataUrl at the `refs/heads/main/` form), 48-52 (sharded mode, present-but-commented), 68 (feedback endpoint), 3579+3597 (subject prefix) |
| C5.2 | S-sbemb | 66-70 (the `refs/heads/main/` rationale in situ, then `dataUrl` and `financeUrl` — TWO artifacts since SBFIN-1, where this row previously named one), 3031+3041 (the two artifact fetches), 81+83 (feedback endpoint + subject prefix), 3011 (the POST) |
| C5.13 | S-eren | 140 (METHODOLOGY_OFFICES — the D-22 allowlist, city_council enlisted), 1098-1114 (the three shared expressions — the frame, the verification section and the artifact-links paragraph — as single expressions used by both branches), 1133-1175 (methodologyView's council branch: C1/C2/C5/C3/C4, since M5 C6, and since M2 C7 and C8, with no `<h3>` before any of them, then the verification section and the links paragraph), 1194-1201 (methodologyView's school-board branch: SB-METH-1's C5 as its own paragraph, bare values, whole or not at all, following the filing-deadline paragraph), 1507 (the call site passing office, the dues figures and the page's own other-receipts figures) |
| C5.13 | S-egate | 1981-2027 ([MUNI/METH]), 2029-2106 ([MUNI/SUBJ]), 2344-2619 ([METH/REGISTER] — register-derived for the C-strings, R11 and, since M2, the school-board branch's section; sibling-branch-pinned for the links paragraph; normalization stated in situ), 2180-2265 ([COUNCIL/CAND]), 2267-2342 ([COUNCIL/DONOR]) |
| C5.2 | S-eapp | 21 (DEFAULT_SRC at the ratified refs/heads/main/ form), 25-27 (ART_BASE + the two verification artifacts), 328 (src resolution: data-src → window.IPG_DATA_URL → baked default) |
| C5.2 | S-eemb | 17-18 (data-src override documented), 19-24 (artifact + the code-only inlining: data.js/render.js/app.js + styles into one Code Block) |
| C5.2 | A-ba1g2 | 49 (Rider 2: neither embed renders entity-type / last-editor — a TWO-embed sweep, predating the school-board path; the third was measured at REF-C52 and agrees) |
| C5.5 | S-edat | 158-162 (selectorOptions — the {year} {body} pattern), 975-986 (officeRaces election scoping via the year-prefix join), 899-901 (the race's window rides the VM), 922-924 (priorElection re-homed to the base VM) |
| C5.5 | S-eren | 996-1004 (selectorNav), 866-874 (the verbatim prior-note; the formerly-cited on_current_record string is DELETED — its retirement is C5.7's affordance clause) |
| C5.5 | S-eapp | 164-184 (selector state + read-only ?election= boot), 240-252 (scope switch resets the active race — the ruled B6 resolution) |
| C5.7 | S-edat | 1034-1140 (resolvePersonRef 1040 — id-only resolution + durable link; personView 1073 — member sections, window-scoped figures, career total, boolean out-of-window condition, no IE key in any section; ieByElection 1120-1139 — the IE component's own array, one row per member election, PS-141), 822-848 (fundingCandidacy — the M3 funding candidacy, by id through by_person; hasAnyFinance reads it, PS-141), 902-947 (raceView: a borrowed card reads contributions through the funding candidacy and IE through itself, both in the race's window; filedNote; pre-window receipts left on the committee's own card), 1545 (exports) |
| C5.7 | S-eren | 711-768 (renderPersonModal — per-member sections + ratified strings; the IE component 735-756, PS-141), 770-776 (renderPersonMissing — string 7), 801-808 (facet map with on_current_record retired), 813-821 (personAffordance — string 13 label), 875-879 (the M3 filed-on line, PS-141), 880-883 (card affordance, also on a borrowed card), 906-917 (pendingCard explicit on_current_record branch) |
| C5.7 | S-eapp | 102-106 (openPerson — no window parameter), 118-119 (data-person dispatch, no winFromEl), 309-318 (read-only ?person= boot — the deep-link path) |
| C5.8 | S-edat | 527-531 (spenderFunders exclusion — the funder-rollup gap closed), 577-581 (donorFootprint exclusion — load-bearing for the windowless opener) |
| C5.8 | S-eren | 522-523 (iePanel basis label + string-2 empty state), 685-690 (committee-profile basis label, string-2 empty state, structural no-identity-claim) |
| C5.8 | S-cemb | 1083-1096 (cfInSubject + cfDuesRow + cfOtherReceipt + cfCountable — the shared full-set predicates), 1416-1427 (donor-index split: dues and other receipts out first, then in-subject totals + separate before-May-2011 accumulator), 1515/1574/1594/1701/1771/2008/2048/3277 (full-set call sites: the PS-139 timeframe line, industry, per-alder industry, flags, IE funders, the PS-139 industry headline, industry-detail, correlation index; IE spender sums filtered in situ), 1691-1699 (flag rows seeded from flagged donors — a fully-excluded flag renders zero, never vanishes), 2211-2216 (string 7 on the structural zero), 2754 (string 8, methodology), 1195-1213 (alder-profile in-subject views + curated option + string 4), 1810-1832 (pre2011SubView — strings 3/4, display-only rows), 1893-1898 (strings 5/6 on the ranked list), 3202-3206 (view bindings) |
| C5.3 | A-fw1 | 14-16 (artifact not fused), 60-62 (gates check values, not structure) |
| C5.4 | A-probe | 152 (banked sizing item: multiple surfaces, per-path render compliance) |
| C6.1 | A-ba1g0 | 56-66 (dollar/repairability distinctions); A-ba1g2 49 (render-invisibility distinction) |
| C6.2 | A-ba1g0 | 56-66 (§G0.3 dollar-invisible by construction); A-add A1.7 caution (see §A1) |
| C6.3 | A-ba1g0 | 56-66 (both fixtures: Sheet-repairable vs the notes strip with no repair path) |
| C7.1 | A-bbg0 | 8-15 (race-map sense); S-ing 595 + S-syn joins (sbe-id sense via committee sbe ids) |
| C7.2 | this document §1 (positional definition) + A-probe 42-72 (§P1 usage of record) |
| C7.3 | A-probe | 74-94 (§P2), 90 (the overload stated) |
| C7.4 | S-ing | 518-520 (the carry set) |
| C5.9 | S-rol | 226 (the Aggregate-donor set), 240 (member counts exclude it), 244-252 (the one direct-layer loop: row-flag and donor-set skips governing by_parent/by_industry/by_alder/by_candidate/by_race), 363 (by_candidate_election's row-flag-only skip), 411-419 (by_person's paired skips) |
| C5.9 | S-t1 | 67-73 (slice1 by_parent paired skips), 90-93 (the [8-check] oracle mirrors both) |
| C5.9 | S-ing | 530-533 (the retired underscore-prefix marking, comment of record) |
| C5.10 | S-sbemb | 958-960 (`seatVisible` — the one seat filter every seat-iterating surface shares), 961-977 (PS-127 (i)'s sole exception and its single-caller constraint), 1139-1151 (`seatSelector`, the vacancy present by design at 1142-1145), 1190-1197 (the vacancy card — a seat notice, never a member page) |
| C5.10 | S-sbv | 250 (`read_votes` reads `source_url` as a fixed column), 378 + 393 (the carry into the artifact, roster and vote sides) |
| C5.10 | S-sbemb | 1210 (the per-vote Source link on the meta surface), 1264 (the vote card's Source link) |
| C5.10 | S-sbemb | 60-64 (the enumerated N=2 fetch statement the gate asserts by count, so a third fetch fails rather than drifting silently) |
| C5.11 | S-sbemb | 2704-2740 (`render` — the view router; its terminal `else` at 2733 falls through to `methodologyView` rather than throwing) |
| C5.11 | S-sbemb | 2713-2716 (the member, record, matrix and spend tests), 2732 (the board test — the fifth named view) |
| C5.11 | S-bemit | 34-38 (OFFICES — the enumerated office map), 41-45 (the refusal to emit a bundle for an office outside it) |
| C5.12 | S-sbemb | 2651-2702 (`methodologyView` — the view the terminal else reaches), 2684-2693 (the SFM fold: heading through f6, with `SF.allElectionsDisclosure` re-emitted at 2686 and the `duesFigure` loading fallback at 2688-2691) |
| C5.12 | S-sbemb | 674-681 (the SFM string declarations) |
| C5.9 | S-srv | 470-522 (cluster-preview totals mirror the rollup exclusion set exactly) |
| C5.9 | S-rec | 40, 208-209 (contribution-type set-aside, excluded from the itemized compare) |
| C5.9 | S-edat | 485-518 (contributor rollup counts every row; the broader render marking incl. small-dollar), 607 (row-flag carriage into the footprint VM) |
| C5.9 | S-eren | 448-479 (the labeled, non-clickable pinned aggregate line; rows sum to the headline), 551 (the aggregate-of-N row chip) |
| C5.9 | S-cemb | 1246-1254 (alder-profile headline counts the tail into totals and stats), 1311-1330 (the restored disclosure line and its superseded HALT-MIG-1 comment of record), 3279 (correlation-index donor-type skip) |
| P1 | A-fw1 | 60-62 (proposed fused-per-candidate detector, not built) |
| C5.14 | S-b2 | 2-24 (the header: pure layers, gated as [RENDER/B2], writes nothing), 114, 151 (the coming-soon states), 209 (the footprint modal's kicker, grouping sentence and office groups), 345-346 (the scoped footprint drops an IE committee that never spent in the page's office), 696-697 (the display face) |
| C5.14 | S-egate | 1820-1835 ([RENDER/B2] — the harness run whole) |
| C2.12 | S-coh | 77-110 (compute — the ward committees, the registry's finals, the latest period, the D2Totals join and its refusal), 113-117 (apply — the four fields replaced), 137-218 (self_test) |
| C2.12 | S-rec | 69-125 (build_filing_registry — the resolution of the final report the step imports) |
| C2.12 | S-ing | 457-468 (the existing-committee branch: factual fields updated, the rest left) |
| C2.12 | S-cemb | 1258-1259 (the tile and its investments line), 1366 (statCash) |
| C2.12 | S-egate | 2759-2768 ([COH/SELF]) |
| C5.15 | S-own | 1-47 (the closed list: six pairs, each a receiving committee's SBE id and a giving donor's id) |
| C5.15 | S-rol | 88-127 (the list's path, its fail-loud loader and `stamp_own_committee` — set on the listed pairs' rows, removed from every other), 225 (called at build() entry, both artifacts), 341-346 (the `is_self` stamp, election mode only) |
| C5.15 | S-vld | 1178-1262 (`validate_own_committee` — the four rules, premise first), 93 (wired into validate), 1742-1782 (its self-test cases), 476 (the shard check compares the stamped rows) |
| C5.15 | S-edat | 392-416 (candidateFigures: own money by `is_self`, other-committee money by `is_own_committee`, other donors the remainder; since M2, other receipts set aside and returned beside them), 511 (the contributor line's other-committee mark), 1266 (the browse row names a listed giver before any scope filter), 605 (the footprint row carries the stamp) |
| C5.15 | S-eren | 833-840 (ownMoneyLine — the card sentence, OC-E1; the person surface calls it too), 851-852 (the bar's three segments), 897-904 (the legend and its conditional swatch), 445 (the giver line's chip), 548 (the item chip), 1327 (the browse-row chip) |
| C5.15 | S-cemb | 878-893 (the three strings and `cfOwnCommittee`, which reads the stamp into a pair set and a giver set), 1266-1268 (OC-V1, the line under the tiles), 921 (aggregateByDonor carries the row flag), 1357 (the alder donor row's chip), 1926 and 2142 (the Browse and industry-list chips), 2416 (the donor profile's recipient row), 851 (the cache reset when contributions arrive), 2734 (the methodology item) |
| C5.15 | S-egate | 2621-2746 ([OWN/FIGURES], its bite, and [OWN/RENDER]), 575-580 (the [self] group's positive leg, on a card whose own money is stamped) |
| C5.16 | S-rol | 45-52 (`OTHER_RECEIPT_TYPE`, the accumulator, `is_other_receipt` and `other_receipts_excluded_total`), 221 (the accumulator cleared at build() entry), 250, 366, 415 (the three skip sites, each directly after the dues site), 469 (the field emitted, at every magnitude, into whichever artifact build() was handed), 25 (`COUNCIL_SCHEMA_VERSION`) |
| C5.16 | S-sbf | 68 (the import of `is_other_receipt`), 295-296 (the skip, after the dues site and before donor resolution) |
| C5.16 | S-vld | 793 (`OTHER_RECEIPT_TYPE_CHECK`, stated here rather than imported), 827-847 (`_other_recount`), 1063-1100 (`validate_other_receipts_excluded` — the premise rule, then the value rule), 90 (wired into validate), 1146-1147 (the [IE/SPLIT] recount leaves other receipts off the own-committee list out), 1519-1566 (its self-test cases), 799 (`COUNCIL_SCHEMA_VERSION_CHECK`) |
| C5.16 | S-edat | 46-48 (`OTHER_RECEIPT_TYPE`, `isOtherReceipt` and `excludedType` — the one predicate), 265/459/494/527/577/782/1112/1172/1267/1431 (its ten call sites: the index's in-scope test, the pre-window figure, the contributor list, the funder rollup, the footprint, the industry breakdown, the out-of-window condition, the in-kind share, Browse donors, Industries by candidate), 418-443 (`otherReceiptsOnPage`: the page's own magnitude, the sum of its cards' lines), 725 (committeeProfile: the committee's other receipts in the pop-up's window), 401 (candidateFigures: set aside after the window test, never counted), 412 (returned as `otherReceipts`) |
| C5.16 | S-eren | 829-832 (otherReceiptsLine — OR-E1), 891 (the card places it under the bars and the own-money sentence), 727 (the person surface calls it too), 680 (a campaign committee's pop-up, under its raised figure), 1115-1131 (C7 and C8, single expressions used by both branches; C7 whole or not at all), 1169 (the council branch's eight strings), 1207-1209 (the school-board branch's section: its heading, then C7 and C8) |
| C5.16 | S-eapp | 179 (the page's figure, taken once from `otherReceiptsOnPage` onto the render state), 195 (handed to the render with the dues figures) |
| C5.16 | S-cemb | 1095 (cfOtherReceipt, inside cfCountable on the next line), 1148-1150 (the alder profile sets the rows aside before any sum), 1216-1234 (the rows of the selected view, and otherLine — OR-V1, the line and the list it opens), 1269 (the line placed under the other-committee line), 897-914 (cfLoanChip and cfLoans — OR-V2, loans summed over the rows the totals count), 1357/1926/2142/2418 (the chip on the alder's donor row, in Browse donors, in an industry's donor list and on a donor profile's recipient row), 1419/1770/3277 (the three row loops that restate the test: the donor index, the IE funders, the correlation index), 1112-1116 (otherReceiptsDisclosure — the artifact's magnitude, whole or not at all), 2735-2736 (the two methodology items, OR-V3), 3100-3101 (the control's binding) |
| C5.16 | S-egate | 1191-1192 ([DUES/UNIF]'s fixture: one other receipt on each committee type, beside the dues rows), 3029-3400 ([M2/FIGURES], [M2/MAGNITUDE], [M2/LISTS], [M2/RENDER], [M2/REGISTER] and its bite, and [M2/PAGE] through the shipped bundle) |
| C5.16 | S-srv | 487-493 (`_other_receipt_test` — the builder's test, imported), 515-516 (applied in the cluster preview's one pass) |

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
| C5.7 IE on the person surface; the M3 cards | PS-141 | `RULINGS.md` §PS-141 |
| C5.15 other-committee transfers | PS-142 | `RULINGS.md` §PS-142 |
| C5.15 one own-money test | PS-143 | `RULINGS.md` §PS-143 |
| C5.16 other receipts and the loan mark | PS-147 | `RULINGS.md` §PS-147 |
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
| C1.18 | PS-133 | `RULINGS.md` §PS-133 |

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
