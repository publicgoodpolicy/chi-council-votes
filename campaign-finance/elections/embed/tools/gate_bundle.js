#!/usr/bin/env node
/* tools/gate_bundle.js — consolidated real-click gate for the SHIPPED bundle.
 *
 * PRE-DEPLOY RITUAL (decision 1, HALT 2): the bundle couples ONLY to data.js /
 * render.js / app.js, never to finance re-ingest (probe A3). So this gate is NOT
 * part of the per-commit ritual — run it as a deliberate step before any push /
 * deploy:
 *     node tools/build_embed.js                  (rebuild elections-embed.inlined.html)
 *     node tools/build_preview.js --bundle       (regenerate the --bundle preview)
 *     node tools/gate_bundle.js                  (this gate, against that preview)
 *
 * It loads preview/elections-preview.html (which --bundle mode fills from the
 * shipped bundle + a fetch shim) into jsdom and drives REAL clicks through the
 * bundle's own production app.js delegation — so it tests what ships, not the
 * sources. Consolidates the former ad-hoc /tmp/gate_spend.js (24 checks) and the
 * reconstructed /tmp/bundle_gate.js (5-item set) into one committed, fixture-driven
 * gate. Read-only: touches no source, artifact, or election-data.json.
 *
 * [PREVIEW/VINTAGE] (SBE-RERUN-1). This gate does NOT build its own input, and the
 * preview is a build product of election-data.json. Before SBE-RERUN-1 nothing tied
 * the two together: a gate run straight after a data change read whatever preview was
 * last built and reported greens about that older vintage. It happened — the preview
 * was 2 days stale, every PREVIEW_DATA check ([F2], [EXCL/*], [AGG/PS-96], [PERSON/*],
 * [E6], [E7], parity) attested the pre-refresh data, and the run came back ALL PASS
 * while a pinned figure had actually moved. So the gate now refuses to attest a
 * vintage it cannot vouch for: build_preview.js stamps window.PREVIEW_SOURCE_SHA and
 * this gate hard-exits(2) unless it equals the sha256 of election-data.json on disk.
 * Deliberately a staleness ASSERT, not an embedded build step — the gate's job is to
 * verify, and a gate that silently regenerates its own input can still be handed a
 * mismatched pair without saying so. An absent stamp fails too (fail-closed: a preview
 * predating this check cannot be vouched for either).
 *
 * [BUNDLE/VINTAGE] (SBE-RERUN-1, the same sweep). The data axis was only half of it. The
 * preview is spliced from elections-embed.inlined.html, which is itself a build product of
 * data.js + render.js + app.js — so editing render.js and running this gate without
 * `build_embed.js` attested the PREVIOUS render code, with the same ~110 DOM checks
 * reporting green about it. Because build_embed inlines the three sources verbatim, the
 * tie is computable: this gate calls build_embed.render() (one implementation, two
 * invokers — it keeps no copy of the template) and compares, then checks
 * window.PREVIEW_BUNDLE_SHA so the middle link is bound too. Both hard-exit(2) before any
 * DOM check, and both are reported before exiting so a broken run names every stale link.
 * The full chain is now asserted end to end:
 *     data.js + render.js + app.js  --[BUNDLE/VINTAGE] 1--> elections-embed.inlined.html
 *     elections-embed.inlined.html  --[BUNDLE/VINTAGE] 2--> preview
 *     election-data.json            --[PREVIEW/VINTAGE]---> preview
 */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');

// jsdom resolution (portable): project/global install, else the ad-hoc /tmp sandbox.
function resolveJSDOM() {
  var tries = ['jsdom', path.join(__dirname, 'node_modules', 'jsdom'),
    path.join(__dirname, '..', 'node_modules', 'jsdom'), '/tmp/domtest/node_modules/jsdom'];
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]).JSDOM; } catch (e) {} }
  console.error('gate_bundle: jsdom not found. Install it (npm i jsdom) or provide /tmp/domtest/node_modules/jsdom.');
  process.exit(2);
}
var JSDOM = resolveJSDOM();

// PREREQUISITE: the --bundle preview must already exist (build it via the ritual above).
var PREVIEW = path.join(__dirname, '..', 'preview', 'elections-preview.html');
if (!fs.existsSync(PREVIEW)) {
  console.error('gate_bundle: preview not found at ' + PREVIEW + '\n' +
    'Run the pre-deploy ritual first:\n' +
    '  node tools/build_embed.js\n  node tools/build_preview.js --bundle');
  process.exit(2);
}

// --------------------------------------------------------------------
// [BUNDLE/VINTAGE] — the CODE half of the same assert. See the header note.
//
// [PREVIEW/VINTAGE] closed preview -> election-data.json. It did not close the rest of
// the chain: data.js + render.js + app.js -> elections-embed.inlined.html -> preview.
// build_embed.js inlines the three sources VERBATIM and stamps nothing, so editing
// render.js and running this gate without rebuilding attested the PREVIOUS render code
// — and the ~110 DOM checks below are exactly the ones that would have reported green
// about it. Because the inlining is verbatim the tie is computable: recompute the
// bundle from the sources and compare. Two links, both asserted:
//   1. sources -> bundle   recompute via build_embed.render() (one implementation, two
//                          invokers — no second copy of the template here)
//   2. bundle  -> preview  window.PREVIEW_BUNDLE_SHA, stamped by build_preview --bundle
// Link 2 exists because link 1 alone leaves a gap: rebuild the bundle but not the
// preview and both other asserts still pass while the preview carries the old code.
// --------------------------------------------------------------------
var ARTIFACT = path.join(__dirname, '..', '..', '..', 'election-data.json');
var BUNDLE_MOD = require('./build_embed.js');   // exports render(); writes nothing on require

function sha256Buf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// PURE, like previewVintageVerdict below.
function bundleVintageVerdict(expectSha, actualSha, stampSha) {
  if (!actualSha) {
    return { ok: false, reason: 'elections-embed.inlined.html is missing — build it ' +
      '(node tools/build_embed.js)' };
  }
  if (expectSha !== actualSha) {
    return { ok: false, reason: 'elections-embed.inlined.html is ' + actualSha.slice(0, 12) +
      '… but data.js + render.js + app.js recompose to ' + expectSha.slice(0, 12) +
      '… — the bundle is STALE against its sources; rebuild it (node tools/build_embed.js) ' +
      'and then the preview' };
  }
  if (!stampSha) {
    return { ok: false, reason: 'preview carries NO window.PREVIEW_BUNDLE_SHA — it predates ' +
      'the bundle stamp; rebuild it (node tools/build_preview.js --bundle)' };
  }
  if (stampSha !== actualSha) {
    return { ok: false, reason: 'preview was spliced from bundle ' + stampSha.slice(0, 12) +
      '… but the bundle on disk is ' + actualSha.slice(0, 12) + '… — the preview is STALE ' +
      'against the bundle; rebuild it (node tools/build_preview.js --bundle)' };
  }
  return { ok: true, reason: 'sources -> bundle -> preview all at ' + actualSha.slice(0, 12) + '…' };
}

// D-16 (PS-106), G7: THREE emissions, one per office. Link 1 (sources -> bundle) is asserted
// for each; link 2 (bundle -> preview) stays SCHOOL-BOARD ONLY, because build_preview splices
// elections-embed.inlined.html and no preview exists for the other two. Saying that out loud
// matters: a reader could otherwise read three green lines as three previews being vouched for.
function assertBundleVintage(T, window) {
  var offices = Object.keys(BUNDLE_MOD.OFFICES);
  var shas = {}, verdict = null;
  offices.forEach(function (office) {
    var expect = sha256Buf(Buffer.from(BUNDLE_MOD.render(office), 'utf8'));
    var out = BUNDLE_MOD.outFor(office);
    var actual = fs.existsSync(out) ? sha256Buf(fs.readFileSync(out)) : null;
    shas[office] = actual;
    // Only school board has a preview to be stale against; the others pass a matching stamp so
    // the shared verdict function drives link 1 alone rather than being forked into a variant.
    var stamp = office === 'school_board' ? window.PREVIEW_BUNDLE_SHA : actual;
    var v = bundleVintageVerdict(expect, actual, stamp);
    if (office === 'school_board') verdict = v;
    T.ok('[BUNDLE/VINTAGE] the ' + office + ' bundle recomposes from data.js + render.js + ' +
      'app.js' + (office === 'school_board' ? ', and the preview was spliced from it' : '') +
      ' — ' + v.reason, v.ok);
  });

  // The payload is office-INVARIANT by construction — the office reaches only the mount
  // attribute and the paste instruction. Pinned because it is the property that makes three
  // emissions cheap: if a future edit ever made render output office-dependent below the
  // wrapper, three bundles would silently become three codebases.
  var payloads = offices.map(function (office) {
    var html = BUNDLE_MOD.render(office);
    return sha256Buf(Buffer.from(html.slice(html.indexOf('<script>')), 'utf8'));
  });
  T.ok('[BUNDLE/VINTAGE] the payload below the mount wrapper is identical across all ' +
    offices.length + ' offices — ' + (payloads[0] || '').slice(0, 12) + '…',
    payloads.every(function (h) { return h === payloads[0]; }));

  // BITING CASES. The first is the real one: mutate ONE source in memory and recompose,
  // so the failure is produced by an actually-different bundle rather than by a doctored
  // comparison. Run per OFFICE now, since a one-source edit must invalidate every emission,
  // not just the one that happens to be checked first.
  offices.forEach(function (office) {
    BUNDLE_MOD.SOURCES.forEach(function (f) {
      var over = {}; over[f] = '/* [BUNDLE/VINTAGE] biting case */';
      var mutated = sha256Buf(Buffer.from(BUNDLE_MOD.render(office, over), 'utf8'));
      var stamp = office === 'school_board' ? window.PREVIEW_BUNDLE_SHA : shas[office];
      var got = bundleVintageVerdict(mutated, shas[office], stamp);
      T.ok('[BUNDLE/VINTAGE:bite] a one-source change in ' + f + ' recomposes to a different ' +
        office + ' bundle and is rejected',
        mutated !== shas[office] && got.ok === false && /STALE/.test(got.reason));
    });
  });

  // NEW failure mode three files introduce, and the one a human paster can actually cause:
  // the RIGHT bytes in the WRONG place. Emitting city_council's bundle to school board's path
  // must be rejected — the payloads are identical, so only the wrapper distinguishes them and
  // a check comparing payloads alone would wave this through.
  offices.forEach(function (a) {
    offices.forEach(function (b) {
      if (a === b) return;
      var wrong = sha256Buf(Buffer.from(BUNDLE_MOD.render(b), 'utf8'));
      var expectA = sha256Buf(Buffer.from(BUNDLE_MOD.render(a), 'utf8'));
      T.ok('[BUNDLE/VINTAGE:bite] the ' + b + ' bundle sitting at the ' + a + ' path is rejected',
        wrong !== expectA && bundleVintageVerdict(expectA, wrong, wrong).ok === false);
    });
  });

  // An unknown office must not silently produce school-board bytes under another name.
  var threw = false;
  try { BUNDLE_MOD.render('comptroller'); } catch (e) { threw = /unknown office/.test(e.message); }
  T.ok('[BUNDLE/VINTAGE:bite] rendering an UNKNOWN office throws rather than defaulting', threw);
  T.ok('[BUNDLE/VINTAGE:bite] a MISSING bundle is rejected (fail-closed)',
    bundleVintageVerdict('a'.repeat(64), null, 'a'.repeat(64)).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] an ABSENT preview bundle-stamp is rejected (fail-closed)',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), undefined).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] a preview spliced from a DIFFERENT bundle is rejected',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] the all-matching case passes',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), 'a'.repeat(64)).ok === true);

  return verdict;   // school board's — the only emission with a preview behind it
}

// PURE, so the biting cases below can drive it without a filesystem or a DOM.
function previewVintageVerdict(diskSha, stampSha) {
  if (!stampSha) {
    return { ok: false, reason: 'preview carries NO window.PREVIEW_SOURCE_SHA — it predates ' +
      'the vintage stamp; rebuild it (node tools/build_preview.js --bundle)' };
  }
  if (stampSha !== diskSha) {
    return { ok: false, reason: 'preview was built from election-data.json ' + stampSha.slice(0, 12) +
      '… but the tree now holds ' + diskSha.slice(0, 12) + '… — STALE; rebuild it ' +
      '(node tools/build_preview.js --bundle)' };
  }
  return { ok: true, reason: 'preview matches election-data.json ' + diskSha.slice(0, 12) + '…' };
}

function assertPreviewVintage(T, window, JSDOMref) {
  var diskSha = crypto.createHash('sha256').update(fs.readFileSync(ARTIFACT)).digest('hex');
  var v = previewVintageVerdict(diskSha, window.PREVIEW_SOURCE_SHA);
  T.ok('[PREVIEW/VINTAGE] the preview was built from the election-data.json now on disk — ' +
    v.reason, v.ok);

  // BITING CASES — this assert exists because the gate was green against stale data,
  // so it must be proved capable of failing. Three, covering both failure modes and
  // the pass, with the third driven end-to-end through the real read path (a jsdom
  // document carrying a wrong stamp) rather than the pure function alone.
  T.ok('[PREVIEW/VINTAGE:bite] a DIFFERENT sha is rejected',
    previewVintageVerdict('a'.repeat(64), 'b'.repeat(64)).ok === false);
  T.ok('[PREVIEW/VINTAGE:bite] an ABSENT stamp is rejected (fail-closed)',
    previewVintageVerdict('a'.repeat(64), undefined).ok === false &&
    previewVintageVerdict('a'.repeat(64), '').ok === false);
  (function () {
    var stale = new JSDOMref('<!doctype html><script>window.PREVIEW_SOURCE_SHA=' +
      JSON.stringify('c'.repeat(64)) + ';</script>', { runScripts: 'dangerously' });
    var got = previewVintageVerdict(diskSha, stale.window.PREVIEW_SOURCE_SHA);
    T.ok('[PREVIEW/VINTAGE:bite] a real stale-stamped document read through the same path ' +
      'is rejected', got.ok === false && /STALE/.test(got.reason));
  })();

  return v;
}

// ====================================================================
// FIXTURES — one block per office. Office-SPECIFIC data ONLY. Add council /
// mayor blocks here when their cohorts land; the assertion functions below are
// office-agnostic and consume one of these blocks unchanged.
// ====================================================================
// CROSS-OFFICE ORACLES (MUNI-ENABLE-1 G4, D-18/PS-108 and D-20/PS-110). Stated here
// INDEPENDENTLY of every implementation, on the same reasoning the per-office `windows` block
// below states window values independently: an oracle that reads its expectation from its
// subject checks nothing (PS-82). D-18 puts the office-type table in two languages that cannot
// share a predicate, so they share this oracle instead — [MUNI/TABLE] asserts BOTH against it
// rather than either against the other, which is what makes a one-sided edit a failure instead
// of a silent divergence. Deliberately NOT inside FIXTURES.school_board: the subject spans
// offices, and burying a cross-office fact in a per-office block is how it goes stale.
var OFFICE_TYPE_ORACLE = {
  school_board: 'school_board',
  school_board_president: 'school_board',
  school_board_member: 'school_board',
  city_council: 'municipal',
  alderperson: 'municipal',
  mayor: 'municipal',
  city_clerk: 'municipal',
  city_treasurer: 'municipal'
};
// D-20's ratified municipal values. `start` is the 2027 council-era cycle boundary, NOT an
// open `start: null` — see the ruling and the note in election-windows.json. (School board's
// open 2024 start was retired by FIX-1 E1.)
var MUNICIPAL_WINDOWS_ORACLE = { '2027': { start: '2023-05-15', end: '2027-12-31' } };

// D-21 (PS-111) + D-22 (PS-112), MUNI-ENABLE-1 G5. The ratified display strings, transcribed
// here from the ratification package and stated independently of render.js for the same PS-82
// reason as the tables above. Every school-board entry is BYTE-IDENTICAL to what shipped before
// G5; if one of them ever changes, [MUNI/COPY] fails and the change has to be ratified rather
// than absorbed. The methodology allowlist is part of the same oracle because D-22's gate is a
// copy decision: it governs which office may show which methodology.
var RATIFIED_COPY_ORACLE = {
  browseFraming: 'Everyone who gave to a candidate or funded an independent-expenditure committee in these races, by affiliation.',
  raceFilterAll: {
    school_board: 'All school-board races',
    city_council: 'All City Council races',
    mayor: 'All mayoral races'
  },
  personElectionNoun: { school_board: 'school board election', municipal: 'municipal election' },
  methodologyOffices: { school_board: 1, city_council: 1 }
};

// [MUNI/SUBJ] oracle (ELEC-METH-1 G2, ruling: "### ELEC-METH-1 — methodology figure posture
// and the member-branch subject invariant", clause (ii)). One discriminating subject token per
// office. Each is a verbatim substring of ratified text, taken by file-read at authoring, never
// relayed or recalled: school_board's from the shipped methodology copy in render.js (the
// sentence "This tool tracks campaign finance for Chicago's school board elections.");
// city_council's from register string C1; mayor's from register string M1. The tokens are
// chosen to avoid apostrophes and the register's line wrapping so they compare byte-for-byte
// against rendered HTML, and they are asserted mutually disjoint below rather than assumed —
// a token that is a substring of another office's token would make the "no other office's
// token" half unfalsifiable.
var METHODOLOGY_SUBJECT_ORACLE = {
  school_board: 'school board elections',
  city_council: 'city council elections',
  mayor: 'mayoral election'
};

var FIXTURES = {
  school_board: {
    office: 'school_board',
    presidentSlug: 'school-board-president',
    minRaces: 11,                       // President + the sb-d04..d12 district cohort (districts split a/b)
    subtabs: ['donors', 'candidates', 'industries', 'industry-candidate'],   // 'flags' retired: flags off (rulings 45b, 67a)
    // SCOPE-UI: the GLOBAL election selector (ratified {year} {body} labels). The former
    // per-spend-tab This/Last/All filter and the per-race toggle are retired; 'all' (the
    // union window) is not resolvable from any UI surface.
    selector: { ids: ['2026', '2024'], def: '2026',
                labels: { '2026': /2026 School Board/, '2024': /2024 School Board/ },
                scopeRaces: { '2026': 21, '2024': 10 } },
    // HALT-F2 oracle: the office's per-election windows, stated INDEPENDENTLY of data.js
    // (mirrors election-windows.json). If data.js's ELECTION_WINDOWS drifts from these,
    // the [F2] window-scoping checks fail — that drift is the defect being caught.
    windows: { '2024': { start: '2024-01-01', end: '2024-12-31' },   // FIX-1 E1
               '2026': { start: '2025-01-01', end: '2026-12-31' } },
    incs: {
      committee: 'ie-committee-26066',  // INCS Action Independent Committee (2024-window spender)
      scope: '2024',                    // SCOPE-UI: its money is 2024-window; drills run in the 2024 scope
      // exact-figure firewall lines (election label + stance + amount), checked precisely:
      // P1-E (PS-140) re-pin: the 2024 rows ride the 2024 candidacies, which carry the name as
      // filed in 2024 ('Jason C. Dones', 'Ebony L. DeBerry'); the label and amounts are unchanged.
      exactLines: [
        { name: 'Jason C. Dones', label: '2024: District 3', amount: '$35,153', stance: 'against' },
        { name: 'Carlos A. Rivas', label: '2024: District 3', amount: '$234,231', stance: 'for' }
      ],
      // broader coverage: every name must render as a clickable for/against fact:
      fiveNames: ['Carlos A. Rivas', 'Karen Zaccor', 'Ebony L. DeBerry', 'Anusha Thotakura', 'Jason C. Dones']
    },
    // INCS All-vs-(This+Last) parity. INCS spent ONLY in 2024, so the 2026 leg is 0
    // by absence (the spender row is correctly missing from the 2026 browse list) —
    // the parity is therefore trivially All == 2024 (see note at assertParity); it is
    // NOT independent 2026 confirmation. Figures are post-rounding display dollars.
    // Data-layer parity (SCOPE-UI A2): re-expressed off the UI — per-stream, per-election
    // windowed figures must sum to the union computed at the data layer (no UI union
    // surface exists). INCS pins keep the old tripwire: its 2026 leg is 0 by absence.
    // P1-E (PS-140) re-pin: INCS's 42 of the 87 rows recovered on 2024-only candidacies join its
    // 2024 figures (support +$1,033,846.57, oppose +$153,107.00), measured on the planner's simulation of the
    // 2026-09-13 vintage under PS-140 routing; still union == 2024, its 2026 leg 0 by absence.
    parity: { support: 3237734.35, oppose: 1093652 },   // re-pinned on the 2026-10-20 pull; support re-pinned at IEA-1 (+382,857: INCS's four aliased groups)
    // self-funding negative case (relational is_self, 8f148b2): a funder who self-funds
    // their OWN race must NOT be flagged self in another candidate's drill.
    // ownRace anchor made specific (HALT-Q2R): after Q2, the bare 'Leon' substring also
    // matches a donor card in the President race, so cardByName('Leon') resolved there first.
    // 'Bruce Leon' anchors to his own race uniquely. (substring-anchor fragility -> P1-R runbook.)
    // R40: the [self] group resolves by ID, never by name substring — a donor named
    // 'Rosenfeld' filing into the President race captured the old cardByName walk
    // (A2 1.4). leakRaceSlug/leakCardId are measured, not assumed.
    // M5 (PS-143): the cards read the is_self stamp, so the leak race's own card no longer
    // claims own money — the $8,750 it showed was three gifts from other people named
    // Rosenfeld. The "renders separately" leg therefore reads a 2026 card whose own money is
    // stamped (ownCard*, measured, resolved by id); the NO LEAK leg stays on the leak card.
    selfLeak: { funder: 'Leon', leakRace: 'Rosenfeld', ownRace: 'Bruce Leon',
                leakRaceSlug: 'district-4b', leakCardId: 'cand-ellen-rosenfeld-district-4b',
                ownCardName: 'Henderson', ownCardRaceSlug: 'school-board-president',
                ownCardId: 'cand-victor-henderson-school-board-president' },
    // Browse-Donors filters (E-1): a search term that hits a known rollup, and a donor type.
    browseFilters: { search: 'frank', searchHit: 'Frank', type: 'Individual' },
    // Industry-tag color + curated label (E-5): canonical color + curated label, not the slug.
    tagColor: { industry: 'real-estate', hex: '#a23a2e', label: 'Real Estate / Developers', slugText: '>real estate<' },
    // Industry three-level drill (E-6): the IE-funded industry, its IE spender, a direct industry.
    // HALT-Q2R repin: individual became the top bar; charter-schools -> #2.
    // HALT-BULK-B repin (6337339): individual +$6,300 (weinberg-david, 39786 recency) -> $2,159,769.
    // HALT-FW-1 relabel+decompose: the Level-1 bar is the ruled 'total deployed' figure
    //   (direct+support+oppose), labeled as such (never 'independent'), with the three streams shown as
    //   default-visible labeled segments + a breakdown line whose parts sum EXACTLY to the total
    //   (largest-remainder). Values byte-unchanged; ieVal repinned to the rendered total $1,629,547 (of
    //   which only $16,212 is direct — the old 'independent'-tagged fused display was the defect).
    // HALT-GUARD re-pin: the 2024-scope cross-tab now includes the admitted 2024
    // candidacies' direct money, so charter-schools gains a $19,000 direct segment
    // (rank 2 behind labor-teachers) while its IE figures are UNCHANGED — asserted.
    // P1-E (PS-140) re-pin: the recovered 2024 IE (INCS and Urban Center Action, both tagged
    // charter-schools) makes charter-schools #1 at $3,058,298.65 total deployed; direct $19,000 unchanged.
    industryDrill: { scope: '2024', topBarTotal: 3058298.65,
      hasDirectSeg: true, ieDirectVal: 19000, ieSupportVal: 2484974.65, ieOpposeVal: 554324,
      ieIndustry: 'charter-schools', ieRank: 1, ieSpender: 'ie-committee-26066',
      directIndustry: 'labor-teachers' },
    // Grouped spend-by-candidate (E-7): President first, district order, within-race ranking, race filter.
    candidateGroups: { firstRaceText: 'President', raceCount: 21, raceCount2024Scope: 21,
      presidentOrder: ['Jessica Biggs', 'Sendhil Revuluri', 'Victor Henderson', 'Jennifer Custer'], singleRace: 'sb-d06' },   // presidentOrder re-pinned on the 2026-10-20 pull
    // Fold-in ordering ruling (PS-86 frame/contents): the WITHIN-group sequences pinned
    // verbatim from the pre-amend run (fe3fd1c-content preview, captured 2026-08-04).
    // The comparator may only change group PRECEDENCE; these sequences must not move.
    sectionOrder: {
      '2026': {
        inFrame: ["School Board President (citywide)",
                    "School Board, District 1A",
                    "School Board, District 1B",
                    "School Board, District 2A",
                    "School Board, District 2B",
                    "School Board, District 3A",
                    "School Board, District 3B",
                    "School Board, District 4A",
                    "School Board, District 4B",
                    "School Board, District 5A",
                    "School Board, District 5B",
                    "School Board, District 6A",
                    "School Board, District 6B",
                    "School Board, District 7A",
                    "School Board, District 7B",
                    "School Board, District 8A",
                    "School Board, District 8B",
                    "School Board, District 9A",
                    "School Board, District 9B",
                    "School Board, District 10A",
                    "School Board, District 10B"],
        outOfFrame: ["School Board, District 1 (2024)",
                    "School Board, District 6 (2024)",
                    "School Board, District 9 (2024)"]
      },
      '2024': {
        inFrame: ["School Board, District 1 (2024)",
                    "School Board, District 2 (2024)",
                    "School Board, District 3 (2024)",
                    "School Board, District 4 (2024)",
                    "School Board, District 5 (2024)",
                    "School Board, District 6 (2024)",
                    "School Board, District 7 (2024)",
                    "School Board, District 8 (2024)",
                    "School Board, District 9 (2024)",
                    "School Board, District 10 (2024)"],
        outOfFrame: ["School Board President (citywide)",
                    "School Board, District 1A",
                    "School Board, District 1B",
                    "School Board, District 2A",
                    "School Board, District 2B",
                    "School Board, District 3B",
                    "School Board, District 4A",
                    "School Board, District 4B",
                    "School Board, District 5A",
                    "School Board, District 5B",
                    "School Board, District 6A",
                    "School Board, District 7A",
                    "School Board, District 7B",
                    "School Board, District 8A",
                    "School Board, District 9B",
                    "School Board, District 10A"]
      }
    },
    // P1D-PERSON: the person surface (PS-89 frame; D14 career totals; PS-90 deferral;
    // D8 retirement; strings 7/11/12). Biggs anchors the equivalence check because her two
    // cards live in different scopes AND different window containers — real teeth.
    person: {
      pid: 'person-biggs-j',
      card2026: { id: 'biggs-sb-president', slug: 'school-board-president' },
      card2024: { id: 'biggs-sb-2024-d6', slug: '2024-district-6' },
      // D8: the RETIRED pointer string (SCOPE-UI B7 as amended; deleted at P1D-PERSON).
      retiredString: 'is reported under their current committee',
      careerLabel: 'Total direct contributions',                        // string 12
      s13: 'Campaign finance for this candidate →',                     // string 13 (HALT-S13, ratified label)
      s7: 'No person matches this link.',                               // string 7
      s11: "outside this election's window",                        // string 11 (anchor; ratified straight apostrophe)
      // The verified out-of-window singles (probe-links-report 969fd9f2: no counterpart
      // candidacy at any tier). string 11 fires on EXACTLY these. FIX-1 E1 adds
      // williams-sb-2024-d9: the 2024 window's fixed start puts his committee's
      // 2022 receipts ($213,831.35, 38 rows) outside every member window.
      outOfWindowIds: ['bannon-sb-d01', 'pope-sb-d04', 'hernandez-sb-2024-d1',
                       'smith-sb-2024-d6', 'thomas-sb-2024-d9', 'williams-sb-2024-d9'],
      // P1-E B (PS-141): the person surface's IE component and the M3 card line, as ratified.
      ieHeading: 'Independent expenditures',
      m3Line: 'contributions were filed on this committee, which the candidate also uses for',
      // M3's subject, pinned (mode A on the set): the 17 on_current_record 2024 candidacies,
      // measured at c761a5ab… against the sealed 2026-09-13 vintage.
      m3Ids: ['ayala-sb-2024-d7', 'biggs-sb-2024-d6', 'blaise-sb-2024-d5', 'boyle-sb-2024-d9',
              'brown-sb-2024-d5', 'custer-sb-2024-d1', 'deberry-sb-2024-d2', 'dones-sb-2024-d3',
              'gutierrez-sb-2024-d8', 'leon-sb-2024-d2', 'lopez-sb-2024-d7', 'pierre-sb-2024-d1',
              'rivas-sb-2024-d3', 'rosenfeld-sb-2024-d4', 'smith-sb-2024-d10', 'thotakura-sb-2024-d6',
              'zaccor-sb-2024-d4']
    }
  }
};

// ====================================================================
// Office-agnostic assertion functions — each consumes (ctx, fx). One shared jsdom
// bootstrap (the dedup): ctx wraps the single document + click/nav helpers.
// ====================================================================
function makeCtx(window) {
  var doc = window.document;
  var wait = function (ms) { return new Promise(function (r) { window.setTimeout(r, ms); }); };
  var click = function (el) { return el && el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); };
  var root = function () { return doc.getElementById('ipg-elect-root'); };
  var modal = function () { return doc.getElementById('ipg-elect-modal'); };
  var ctx = {
    doc: doc, window: window, wait: wait, click: click, root: root, modal: modal,
    q: function (sel) { return doc.querySelector(sel); },
    nav: function (slug) { click(doc.querySelector('[data-slug="' + slug + '"]')); },
    selectElection: function (id) { var b = doc.querySelector('[data-election="' + id + '"]'); if (b) click(b); return !!b; },
    cardByName: function (n) { return [].slice.call(root().querySelectorAll('article.card')).filter(function (a) { return a.innerHTML.indexOf(n) >= 0; })[0]; },
    slugs: function () { return [].slice.call(doc.querySelectorAll('[data-slug]')).map(function (e) { return e.getAttribute('data-slug'); }); },
    closeModal: async function () { var c = modal() && modal().querySelector('[data-modal-close]'); if (c) { click(c); await wait(30); } },
    spend: async function () { click(doc.querySelector('[data-view="spend"]')); await wait(70); },

    openCommittee: async function (id) {
      click(root().querySelector('[data-spendtab="donors"]')); await wait(40);
      var r = root().querySelector('[data-committee="' + id + '"]'); if (!r) return false;
      click(r); await wait(60); return true;
    },
    ieSummary: function () {
      // Reads the E-3 IE summary boxes: <div class="num">$N</div><div class="lab">Spent to support|oppose</div>.
      var html = modal() ? modal().innerHTML : '';
      var grab = function (lab) { var m = html.match(new RegExp('([\\d,]+)</div><div class="lab">' + lab)); return m ? +m[1].replace(/,/g, '') : 0; };
      return { sup: grab('Spent to support'), opp: grab('Spent to oppose') };
    }
  };
  ctx.findRaceWith = async function (name) {
    var ss = ctx.slugs();
    for (var i = 0; i < ss.length; i++) {
      // HALT-P1-B: the 2024 school-board backfill races are nav-visible (ratified Option A)
      // but these gates assert the CURRENT (2026) election surfaces. Skip the backfill slugs
      // (prefixed "2024-") so a name shared by a returner's 2024 candidacy resolves to their
      // 2026 race, not the 2024 pointer card. (Product proven byte-identical for sb-d08/sb-d03.)
      if (/^2024-/.test(ss[i])) continue;
      ctx.nav(ss[i]); await wait(40); if (ctx.cardByName(name)) return ss[i];
    }
    return null;
  };
  return ctx;
}

// (b1) boot — bundle assembles + delegation is live.  [origin: bundle_gate #1]
async function assertBoot(T, ctx, fx) {
  await ctx.wait(700);
  T.ok('[boot] bundle mounts + delegation live (root populated)', (ctx.root().innerHTML || '').length > 500);
}

// (race set) fixture-driven: the expected cohort exists. [fixture-driven addition]
async function assertRaceSet(T, ctx, fx) {
  var slugs = ctx.slugs();
  T.ok('[races] President race present', slugs.indexOf(fx.presidentSlug) >= 0);
  T.ok('[races] district cohort present (>= ' + fx.minRaces + ' races: sb-d04..d12 + President)', slugs.length >= fx.minRaces);
}

// (SCOPE-UI) Global election selector: presence, ratified labels, default, scope switch,
// isolation (never interleaved), active-race reset, drill still reachable in 2024 scope.
// Replaces the retired toggle-wiring + per-election-drill families; expressed over scope
// COUNTS and slug NAMESPACES, not enumerated race lists.
async function assertSelector(T, ctx, fx) {
  await ctx.closeModal();
  var sel = fx.selector;
  var pills = [].slice.call(ctx.doc.querySelectorAll('[data-election]'));
  T.ok('[selector] two pills present with ratified {year} {body} labels',
    pills.length === 2 && sel.ids.every(function (id) {
      return pills.some(function (p) { return p.getAttribute('data-election') === id && sel.labels[id].test(p.textContent); });
    }));
  var active = pills.filter(function (p) { return p.getAttribute('aria-selected') === 'true'; })[0];
  T.ok('[selector] default = ' + sel.def, !!active && active.getAttribute('data-election') === sel.def);
  var chips = function () { return [].slice.call(ctx.root().querySelectorAll('.districts [data-slug]')).map(function (e) { return e.getAttribute('data-slug'); }); };
  var c26 = chips();
  T.ok('[selector] 2026 scope: ' + sel.scopeRaces['2026'] + ' race chips, no 2024- slug',
    c26.length === sel.scopeRaces['2026'] && c26.every(function (s2) { return !/^2024-/.test(s2); }));
  ctx.selectElection('2024'); await ctx.wait(70);
  var c24 = chips();
  T.ok('[selector] 2024 scope: ' + sel.scopeRaces['2024'] + ' race chips, every slug 2024-prefixed',
    c24.length === sel.scopeRaces['2024'] && c24.every(function (s2) { return /^2024-/.test(s2); }));
  T.ok('[selector] scope switch resets the active race into the new scope',
    (function () { var a = ctx.root().querySelector('.districts [aria-pressed="true"]'); return !!a && /^2024-/.test(a.getAttribute('data-slug')); })());
  // per-election drill survives on a scoped race card (the retired drill family's coverage)
  var drill = [].slice.call(ctx.root().querySelectorAll('[aria-controls]')).filter(function (b) {
    var p2 = ctx.doc.getElementById(b.getAttribute('aria-controls')); return p2 && /contrib/.test(p2.className);
  })[0];
  T.ok('[selector] contributor drill toggle exists on a 2024-scope card', !!drill);
  if (drill) {
    var panel = ctx.doc.getElementById(drill.getAttribute('aria-controls'));
    ctx.click(drill); await ctx.wait(40);
    T.ok('[selector] clicking it opens the drill panel (.open)', panel.classList.contains('open'));
  }
  T.ok('[selector] no toggle / per-tab filter affordance anywhere (data-electionview, data-spendelection, "All elections")',
    ctx.root().innerHTML.indexOf('data-electionview') < 0 && ctx.root().innerHTML.indexOf('data-spendelection') < 0 &&
    ctx.root().innerHTML.indexOf('All elections') < 0);
  ctx.selectElection('2026'); await ctx.wait(60);
  T.ok('[selector] switch back to 2026 restores the 2026 chip set', chips().length === sel.scopeRaces['2026']);
}

// (4) self-funding renders separately + named-case no-leak.  [origin: bundle_gate #8-11]
async function assertSelfFundingNoLeak(T, ctx, fx) {
  await ctx.closeModal();
  ctx.selectElection('2026'); await ctx.wait(60);
  var leakSlug = fx.selfLeak.leakRaceSlug;                       // R40: pinned, not name-walked
  T.ok('[self] found ' + fx.selfLeak.leakRace + ' race (' + leakSlug + ')', ctx.slugs().indexOf(leakSlug) >= 0);
  // M5 (PS-143): the positive leg, on a card whose own money is stamped.
  ctx.nav(fx.selfLeak.ownCardRaceSlug); await ctx.wait(60);
  var ownCard = ctx.root().querySelector('article.card[id="' + fx.selfLeak.ownCardId + '"]') || { innerHTML: '' };
  T.ok('[self] ' + fx.selfLeak.ownCardName + ' self-funding renders separately (own money / loans)',
    /class="selfline"/.test(ownCard.innerHTML) && /tagchip self/.test(ownCard.innerHTML) &&
    /candidate\u2019s own money or loans/.test(ownCard.innerHTML));
  ctx.nav(leakSlug); await ctx.wait(60);
  var leak = [].slice.call((ctx.root().querySelector('article.card[id="' + fx.selfLeak.leakCardId + '"]') || ctx.doc.createElement('div')).querySelectorAll('.crow,.selfline'))
    .filter(function (r) { return new RegExp(fx.selfLeak.funder).test(r.textContent) && /own money|tagchip self/.test(r.innerHTML); });
  T.ok('[self] NO LEAK: no ' + fx.selfLeak.funder + ' row in ' + fx.selfLeak.leakRace + ' marked self (relational is_self)', leak.length === 0);
  // The own-money leg moved with the money (F-2 ruled semantics): Leon's self-funding is
  // 2024-window, so its render surface is the 2024-scope spend/candidates tab.
  ctx.selectElection('2024'); await ctx.wait(60);
  await ctx.spend();
  ctx.click(ctx.root().querySelector('[data-spendtab="candidates"]')); await ctx.wait(80);
  var body = ctx.root().querySelector('.spend-body').textContent;
  T.ok('[self] ' + fx.selfLeak.ownRace + ' 2024-window money renders on the 2024-scope spend tab ($620,025)',   // M2: $620,403 less one other receipt of $378
    body.indexOf(fx.selfLeak.ownRace) >= 0 && body.indexOf('$620,025') >= 0);
  ctx.selectElection('2026'); await ctx.wait(50);
}

// Full Spend-tab feature set: the former gate_spend A/B/C/D 24 checks. The INCS
// "present + modal opens" (bundle_gate #12) and "streams SEPARATE" (bundle_gate #18)
// checks are DELIBERATELY DEDUPED here (the granular C row-present/modal-opened and
// the C streams-separate assertions below subsume them).  [origin: gate_spend 24]
async function assertSpendTabFeatures(T, ctx, fx) {
  await ctx.closeModal();
  // A — tab + feature set
  var spendBtn = ctx.q('[data-view="spend"]');
  T.ok('[spend.A] top-nav has a Spend view button', !!spendBtn);
  ctx.click(spendBtn); await ctx.wait(80);
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(50);
  var R = ctx.root().innerHTML;
  T.ok('[spend.A] NO per-tab election filter (global selector governs; data-spendelection retired)', R.indexOf('data-spendelection') < 0);
  fx.subtabs.forEach(function (t) { T.ok('[spend.A] subtab present: ' + t, R.indexOf('data-spendtab="' + t + '"') >= 0); }); T.ok('[spend.A] no Flag totals subtab (flags off, rulings 45b, 67a)', R.indexOf('data-spendtab="flags"') < 0 && R.indexOf('Flag totals') < 0);
  T.ok('[spend.A] browse list renders donor rows under the default (2026) scope', /data-funder/.test(R));
  // (the 'IE PAC' STRING legitimately remains in the stable facet dropdown; the assert is on ROWS)
  T.ok('[spend.A] IE-committee ROWS under 2026 equal the spenders with 2026 school-board IE (4; 10-20 vintage)',
    ctx.root().querySelectorAll('.spend-body [data-committee]').length === 4);
  // B — the GLOBAL selector governs the spend window and reslices
  ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(60);
  var ind26 = ctx.root().querySelector('.spend-body').textContent;
  ctx.selectElection('2024'); await ctx.wait(70);
  await ctx.spend(); ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(60);
  var ind24 = ctx.root().querySelector('.spend-body').textContent;
  T.ok('[spend.B] switching scope 2026 -> 2024 reslices the industry totals (content changes)', ind26 !== ind24);
  T.ok('[spend.B] 2024 now the selected scope', (function () { var a = ctx.doc.querySelector('[data-election="2024"]'); return a && a.getAttribute('aria-selected') === 'true'; })());
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(50);
  var R24 = ctx.root().innerHTML;
  T.ok('[spend.A/B] browse under 2024 scope shows IE PAC spenders (their money\u2019s window)', /IE PAC/.test(R24));
  T.ok('[spend.A/B] browse note (donors+spenders) present under 2024', /funded an independent-expenditure committee/.test(R24));
  // [FIX1/E4] — mode A (PS-128): pinned subject — Bruce Leon's 2024 row (parent leon-bruce;
  // $620,025 of $621,025 is his own, share 0.998, measured at 8b752224) stays in the ranked list
  // and carries the ratified partial chip.
  var leonRow = ctx.root().querySelector('.spend-body [data-funder="leon-bruce"]');
  T.ok('[FIX1/E4] a candidate\u2019s own money stays ranked and is marked: Leon row carries \u201cPartly candidate\u2019s own money / loans\u201d',
    !!leonRow && leonRow.innerHTML.indexOf('Partly candidate\u2019s own money / loans') >= 0);
  // C — firewall drill (exact lines) under the 2024 scope (INCS is a 2024-window spender)
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(60);
  var incsRow = ctx.root().querySelector('[data-committee="' + fx.incs.committee + '"]');
  T.ok('[spend.C] INCS Action row present in browse list', !!incsRow);
  ctx.click(incsRow); await ctx.wait(80);
  T.ok('[spend.C] committee-profile modal opened', !!ctx.modal());
  var M = ctx.modal().innerHTML;
  var spentSection = (M.split('What it spent on')[1] || '').split('Who funds this committee')[0];
  var spentText = spentSection.replace(/<[^>]+>/g, ' ');
  fx.incs.exactLines.forEach(function (L) {
    var re = new RegExp(L.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + L.label + '[\\s\\S]*?' + L.amount.replace('$', '\\$') + ' ' + L.stance);
    T.ok('[spend.C] ' + L.name + ' line: ' + L.label + ' + ' + L.stance + ' ' + L.amount, re.test(spentText));
  });
  T.ok('[spend.C] streams SEPARATE (for/against shown, never a summed "funded" total)',
    spentSection.indexOf(' for') >= 0 && spentSection.indexOf(' against') >= 0 && spentSection.indexOf('funded') < 0);
  T.ok('[spend.C] firewall note present (separate streams + election label)', M.indexOf('never summed') >= 0);
  // The review chip, on a CONSTRUCTED row (PS-154): once the ingest reads the confirmation file no
  // live row need be flagged, so a live chip is not there to find. PS-128 mode E — constructed: the
  // document (a deep copy of the registry alone, holding one outside-spending row and no
  // contribution) and the row's flag; live: the committee, and the row's target and date (a live
  // INCS row inside the window is the seed) — premise asserted: the seed exists and the row's own
  // purpose text renders in both variants. Each variant is the other's control.
  var chip = function (flagged) {
    var W = ctx.window, RAW = W.PREVIEW_DATA, w = fx.windows[fx.incs.scope];
    var seed = (RAW.independent_expenditures || []).filter(function (x) {
      return x.spender_committee_id === fx.incs.committee && !W.ElectData.EXCLUDED_CYCLES[x.cycle] && x.date >= w.start && x.date <= w.end; })[0];
    if (!seed) return { rendered: false, chips: -1 };
    var cp = JSON.parse(JSON.stringify({ races: RAW.races, candidates: RAW.candidates, committees: RAW.committees, donors: {}, contributions: [],
      rollups: { by_candidate_election: (RAW.rollups || {}).by_candidate_election }, independent_expenditures: [seed] }));
    var row = cp.independent_expenditures[0];
    row.id = 'zz-spendC-chip'; row.purpose = 'ZZ spend.C chip fixture'; row.match_method = 'surname_plus_given'; row.needs_review = flagged;
    var html = W.ElectRender.renderCommitteeProfile(W.ElectData.committeeProfile(W.ElectData.loadData(cp, { office: fx.office }), fx.incs.committee, w));
    var sec = (html.split('What it spent on')[1] || '').split('Who funds this committee')[0];
    return { rendered: sec.indexOf('ZZ spend.C chip fixture') >= 0, chips: sec.split('⚑ needs review').length - 1 };
  };
  var chipOn = chip(true), chipOff = chip(false);
  T.ok('[spend.C] IE provenance: a flagged row shows ⚑ needs review on its candidate line and on its own row (constructed; ' + chipOn.chips + ' chips)',
    chipOn.rendered && chipOn.chips === 2);
  T.ok('[spend.C] IE provenance: the same row unflagged, as a confirmed pair arrives, renders and shows no chip (' + chipOff.chips + ' chips)',
    chipOff.rendered && chipOff.chips === 0);
  // (E-3) IE summary boxes: support + oppose render as SEPARATE stat cards (firewall, box level).
  var ieHead = M.split('What it spent on')[0];
  T.ok('[spend.E3] IE summary boxes — support + oppose SEPARATE cards (+ total + targeted), never fused',
    /elect-statgrid/.test(ieHead) && /Spent to support/.test(ieHead) && /Spent to oppose/.test(ieHead) &&
    /Total independent spend/.test(ieHead) && /Candidates? targeted/.test(ieHead));
  // D — deep drill: sub-funder -> footprint, window-scoped to the ACTIVE (2024) scope
  var winRe = new RegExp('data-win-end="' + fx.windows[fx.incs.scope].end + '"');
  T.ok('[spend.D] committee-profile modal carries the active window (data-win-end)', winRe.test(M));
  var funderRow = ctx.modal().querySelector('[data-funder]');
  T.ok('[spend.D] INCS has clickable funder rows (data-funder, rollup by parent_id)', !!funderRow);
  ctx.click(funderRow); await ctx.wait(80);
  var FM = ctx.modal().innerHTML;
  T.ok('[spend.D] clicking a sub-funder opens the donor footprint (Tier-3)', /Donor footprint/.test(FM));
  T.ok('[spend.D] footprint modal is election-scoped (carries window)', winRe.test(FM));
  await ctx.closeModal();
  ctx.selectElection('2026'); await ctx.wait(50);
}

// (5) IE for/against firewall — every named target renders as a clickable for/against
// fact.  [origin: bundle_gate #13-17]
async function assertFirewallFiveNames(T, ctx, fx) {
  await ctx.closeModal();
  ctx.selectElection(fx.incs.scope); await ctx.wait(60);
  await ctx.spend(); await ctx.wait(40);
  var opened = await ctx.openCommittee(fx.incs.committee);
  if (!opened) { T.ok('[firewall] INCS drill opens under the ' + fx.incs.scope + ' scope', false); return; }
  fx.incs.fiveNames.forEach(function (nm) {
    var row = [].slice.call(ctx.modal().querySelectorAll('.crow')).filter(function (r) { return r.textContent.indexOf(nm) >= 0; })[0];
    T.ok('[firewall] INCS drill: ' + nm + ' renders as for/against fact', !!row && /(for|against)/.test(row.textContent));
  });
  await ctx.closeModal();
  ctx.selectElection('2026'); await ctx.wait(50);
}

// (SCOPE-UI A2) Parity, re-expressed at the DATA LAYER: per-election windowed figures
// must sum, per stream, to the union computed at the data layer — no UI union surface
// exists any more, and none is needed to keep the invariant checked. The INCS pins keep
// the old tripwire semantics (its 2026 leg is 0 by absence, so union == 2024 leg).
async function assertParity(T, ctx, fx) {
  var W = ctx.window, ED = W.ElectData, RAW = W.PREVIEW_DATA;
  if (!ED || !RAW) { T.ok('[parity] ElectData + PREVIEW_DATA reachable', false); return; }
  var idx = ED.loadData(RAW, { office: fx.office });
  var w24 = fx.windows['2024'], w26 = fx.windows['2026'];
  var wU = { start: fx.windows['2024'].start, end: fx.windows['2026'].end };   // union, constructed from the FIXTURE (FIX-1 E1: the earliest start)
  var bce = (RAW.rollups || {}).by_candidate_election || {};
  function r2(x) { return Math.round(x * 100) / 100; }
  var checked = 0, bad = [];
  Object.keys(bce).forEach(function (cid) {
    checked++;
    var f24 = ED.candidateFigures(idx, cid, null, w24), f26 = ED.candidateFigures(idx, cid, null, w26), fU = ED.candidateFigures(idx, cid, null, wU);
    if (r2(f24.contributions.total + f26.contributions.total) !== r2(fU.contributions.total)) bad.push(cid + ':contrib');
    if (r2(f24.independentSupport + f26.independentSupport) !== r2(fU.independentSupport)) bad.push(cid + ':ieS');
    if (r2(f24.independentOpposition + f26.independentOpposition) !== r2(fU.independentOpposition)) bad.push(cid + ':ieO');
  });
  T.ok('[parity] per-election figures sum to the data-layer union, per stream (' + checked + ' candidates)' +
       (bad.length ? ' — BAD: ' + bad.slice(0, 4).join(', ') : ''), checked > 0 && bad.length === 0);
  var pU = ED.committeeProfile(idx, fx.incs.committee, wU);
  var p26 = ED.committeeProfile(idx, fx.incs.committee, w26);
  var p24 = ED.committeeProfile(idx, fx.incs.committee, w24);
  console.log('   INCS support  Union=' + pU.support + '  2026=' + p26.support + '  2024=' + p24.support);
  console.log('   INCS oppose   Union=' + pU.oppose + '  2026=' + p26.oppose + '  2024=' + p24.oppose);
  T.ok('[parity] INCS support: union == 2026 + 2024 == pinned', r2(pU.support) === r2(p26.support + p24.support) && r2(pU.support) === fx.parity.support);
  T.ok('[parity] INCS oppose: union == 2026 + 2024 == pinned', r2(pU.oppose) === r2(p26.oppose + p24.oppose) && r2(pU.oppose) === fx.parity.oppose);
}

// (E-1) Browse-Donors filters: present, apply, compose (AND), flag-excludes-IE, uncategorized
// honest, and compose with the time window.  [NEW coverage — the original 44 are blind to this]
async function assertBrowseFilters(T, ctx, fx) {
  var bf = fx.browseFilters;
  await ctx.closeModal();
  ctx.selectElection('2026'); await ctx.wait(50);
  await ctx.spend(); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(50);
  var donorRows = function () { return ctx.root().querySelectorAll('.spend-body [data-funder]').length; };
  var ieRows = function () { return ctx.root().querySelectorAll('.spend-body [data-committee]').length; };
  var setSel = function (sel, val) { var e = ctx.root().querySelector(sel); e.value = val; e.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); };
  var typeSearch = async function (val) { var s = ctx.root().querySelector('[data-browse-search]'); s.value = val; s.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); await ctx.wait(260); };
  T.ok('[filters] 3 controls present (search + type/industry) and no flag filter (flags off, rulings 45b, 67a)',
    !!ctx.root().querySelector('[data-browse-search]') && !!ctx.root().querySelector('[data-donor-type]') &&
    !!ctx.root().querySelector('[data-donor-industry]') && !ctx.root().querySelector('[data-donor-flag]'));
  T.ok('[filters] no donor-flag chip renders in the donor list (flags off, rulings 45b, 67a)',
    !/\u2691 (Outside Chicago|Out of state|funded trump ballroom|pac_dues_funding)/.test(ctx.root().querySelector('.spend-body').textContent));
  var base = donorRows();
  await typeSearch(bf.search);
  var afterSearch = donorRows();
  T.ok('[filters] search "' + bf.search + '" applies (fewer rows, box retains value)',
    afterSearch > 0 && afterSearch < base && ctx.root().querySelector('[data-browse-search]').value === bf.search);
  T.ok('[filters] search hit present (' + bf.searchHit + ')', new RegExp(bf.searchHit, 'i').test(ctx.root().querySelector('.spend-body').textContent));
  T.ok('[filters] active-filter note shows Clear filters', !!ctx.root().querySelector('[data-clear-filters]'));
  ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(50);
  T.ok('[filters] Clear filters resets to base rows', donorRows() === base);
  setSel('[data-donor-type]', bf.type); await ctx.wait(50);
  var afterType = donorRows();
  T.ok('[filters] type=' + bf.type + ' applies (rows reduced)', afterType > 0 && afterType < base);
  await typeSearch(bf.search);
  T.ok('[filters] compose type + search = AND (subset of type-only)', donorRows() > 0 && donorRows() <= afterType);
  ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(50);
  // (the flag-filter leg retired with the flag filter: flags off, rulings 45b, 67a;
  //  the two lines above assert the filter and the donor-flag chips are absent)
  var hasUncat = [].slice.call(ctx.root().querySelector('[data-donor-industry]').options).some(function (o) { return o.value === 'uncategorized'; });
  T.ok('[filters] industry offers "uncategorized" (firewall: unclassified filterable)', hasUncat);
  if (hasUncat) { setSel('[data-donor-industry]', 'uncategorized'); await ctx.wait(50);
    T.ok('[filters] uncategorized renders rows OR an honest empty state (never blank)',
      donorRows() > 0 || /No donors or spenders match/.test(ctx.root().querySelector('.spend-body').textContent));
    ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(50); }
  setSel('[data-donor-type]', bf.type); await ctx.wait(50); var type26 = donorRows();
  ctx.selectElection('2024'); await ctx.wait(70);
  await ctx.spend(); await ctx.wait(30); ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(50);
  T.ok('[filters] composes with the scope window (type persists + re-slices under 2024)',
    ctx.root().querySelector('[data-donor-type]').value === bf.type && donorRows() > 0 && donorRows() !== type26);
  ctx.selectElection('2026'); await ctx.wait(60); await ctx.spend(); await ctx.wait(30);
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(40);
  // (E-5) industry pill renders canonical color + curated label, not the dasherized slug.
  setSel('[data-donor-industry]', fx.tagColor.industry); await ctx.wait(50);
  var body = ctx.root().querySelector('.spend-body').innerHTML;
  T.ok('[tagcolor] industry pill = canonical color + curated label, NOT the slug',
    body.indexOf('background:' + fx.tagColor.hex) >= 0 && body.indexOf(fx.tagColor.label) >= 0 && body.indexOf(fx.tagColor.slugText) < 0);
  ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(40);
}

// (E-6) Industry three-level drill: Level 1 chart -> Level 2 spenders -> Level 3 per-candidate,
// dispatch-by-kind, streams separate, no empty boxes (the firewall checks).  [NEW surface]
async function assertIndustryDrill(T, ctx, fx) {
  var d = fx.industryDrill;
  function fmt(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  await ctx.closeModal();
  // The union ('all') surface retired with the global selector; the IE-industry drill runs
  // in the scope that holds the money (2024 — charter-schools is entirely 2024-window).
  ctx.selectElection(d.scope); await ctx.wait(60);
  await ctx.spend(); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(70);
  T.ok('[E6.L1] industry chart renders (sorted clickable bars)',
    !!ctx.root().querySelector('.indchart') && !!ctx.root().querySelector('[data-industry-drill]'));
  var bars = [].slice.call(ctx.root().querySelectorAll('[data-industry-drill]'));
  T.ok('[E6.L1] ' + d.ieIndustry + ' is #' + d.ieRank + ' at ' + fmt(d.topBarTotal) + ' TOTAL DEPLOYED, not "independent" (FW-1 form)',
    bars[d.ieRank - 1].getAttribute('data-industry-drill') === d.ieIndustry &&
    bars[d.ieRank - 1].textContent.indexOf(fmt(d.topBarTotal)) >= 0 &&
    /total deployed/.test(bars[d.ieRank - 1].textContent) && !bars[d.ieRank - 1].querySelector('.indep-tag'));
  T.ok('[E6.L1] ' + d.ieIndustry + ' decomposed: direct+support+oppose segments + visible breakdown ' + fmt(d.ieDirectVal) + ' / ' + fmt(d.ieSupportVal) + ' / ' + fmt(d.ieOpposeVal),
    !!bars[d.ieRank - 1].querySelector('.seg.support') && !!bars[d.ieRank - 1].querySelector('.seg.oppose') &&
    (d.hasDirectSeg ? !!bars[d.ieRank - 1].querySelector('.seg.third') : true) &&
    bars[d.ieRank - 1].textContent.indexOf(fmt(d.ieSupportVal)) >= 0 && bars[d.ieRank - 1].textContent.indexOf(fmt(d.ieOpposeVal)) >= 0);
  // HALT-GUARD's stop-condition assert, re-expressed by P1-E (PS-140): the IE layer DID move, by
  // ruling, so this now pins charter-schools' support/oppose to the measured post-routing figures.
  T.ok('[E6.L1] charter-schools IE figures as measured under PS-140 routing (support ' + fmt(d.ieSupportVal) + ' / oppose ' + fmt(d.ieOpposeVal) + ')',
    bars[d.ieRank - 1].textContent.indexOf(fmt(d.ieSupportVal)) >= 0 && bars[d.ieRank - 1].textContent.indexOf(fmt(d.ieOpposeVal)) >= 0);
  T.ok('[E6.L1] all bars: parts sum EXACTLY to total, zero "independent" labels, no per-candidate phrasing (rule a+b, firewall)',
    ctx.root().querySelector('.spend-body').innerHTML.indexOf('Spent to support') < 0 && bars.length > 0 && bars.every(function (b) {
      if (b.querySelector('.indep-tag')) return false;
      var mt = b.querySelector('.indbar-val').textContent.match(/\$[\d,]+/);
      var tot = mt ? parseInt(mt[0].replace(/[^0-9]/g, ''), 10) : -1;
      var parts = [].slice.call(b.querySelectorAll('.indbar-breakdown .bd')).map(function (s2) { var m = s2.textContent.match(/\$[\d,]+/); return m ? parseInt(m[0].replace(/[^0-9]/g, ''), 10) : 0; });
      return parts.length > 0 && parts.reduce(function (a, c) { return a + c; }, 0) === tot;
    }));
  ctx.click(bars.filter(function (b) { return b.getAttribute('data-industry-drill') === d.ieIndustry; })[0]); await ctx.wait(80);
  T.ok('[E6.L2] industry bar click -> Browse Donors filtered to that industry',
    ctx.root().querySelector('[data-donor-industry]') && ctx.root().querySelector('[data-donor-industry]').value === d.ieIndustry);
  var incsRow = ctx.root().querySelector('.spend-body [data-committee="' + d.ieSpender + '"]');
  T.ok('[E6.L2] IE industry spenders include the IE committee (INCS)', !!incsRow);
  ctx.click(incsRow); await ctx.wait(70);
  var M = ctx.modal() ? ctx.modal().innerHTML : '';
  T.ok('[E6.L3] IE spender -> support + oppose SEPARATE boxes (firewall)', /Spent to support/.test(M) && /Spent to oppose/.test(M));
  await ctx.closeModal();
  ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(70);
  ctx.click([].slice.call(ctx.root().querySelectorAll('[data-industry-drill]')).filter(function (b) { return b.getAttribute('data-industry-drill') === d.directIndustry; })[0]); await ctx.wait(80);
  var donorRow = ctx.root().querySelector('.spend-body [data-funder]');
  T.ok('[E6.L2] direct industry -> donor spenders present', !!donorRow);
  ctx.click(donorRow); await ctx.wait(70);
  var FM = ctx.modal() ? ctx.modal().innerHTML : '';
  T.ok('[E6.L3] donor spender -> direct footprint, NO empty support/oppose boxes (honest absence)',
    FM.indexOf('Spent to support') < 0 && FM.indexOf('Spent to oppose') < 0 && /Total given/.test(FM));
  await ctx.closeModal();
  ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(40);
  ctx.selectElection('2026'); await ctx.wait(50);
}

// (E-7) Grouped spend-by-candidate: sections ordered President -> d01..d20, within-race ranking
// by contributions.total (single-stream), full roster (committee-less shown), race filter composes
// with time, three figures stay separate (firewall).  [NEW surface]
async function assertCandidateGroups(T, ctx, fx) {
  var cg = fx.candidateGroups;
  await ctx.closeModal();
  ctx.selectElection('2026'); await ctx.wait(50);
  await ctx.spend(); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-spendtab="candidates"]')); await ctx.wait(80);
  var groups = [].slice.call(ctx.root().querySelectorAll('.racegroup'));
  var heads = [].slice.call(ctx.root().querySelectorAll('.racehead')).map(function (h) { return h.textContent; });
  // HALT-GUARD (PS-86 shape 3', ruled three-part equivalence) — expectations recomputed
  // from RAW rows + FIXTURE windows (PS-82: never from the removed guard's field).
  function shape3Check(T2, ctx2, sel) {
    var W2 = ctx2.window, ED = W2.ElectData, RAW = W2.PREVIEW_DATA;
    var w = fx.windows[sel];
    var races = RAW.races.filter(function (r) { return String(r.office || '').indexOf(fx.office) === 0; });
    var candByRace = {};
    RAW.candidates.forEach(function (c) { (candByRace[c.race_id] = candByRace[c.race_id] || []).push(c); });
    var comKey = {}; Object.keys(RAW.committees).forEach(function (k) { var cm = RAW.committees[k]; if (cm.candidate_id) comKey[cm.candidate_id] = k; });
    function raceHasWinMoney(r) {
      return (candByRace[r.id] || []).some(function (c) {
        var key = comKey[c.id];
        if (key && RAW.contributions.some(function (x) {
          return x.committee_id === key && x.date && (w.start == null || x.date >= w.start) && (w.end == null || x.date <= w.end) && x.contribution_type !== 'IE Committee Dues Transfer' && !(x.contribution_type === 'Other Receipt' && !x.is_own_committee);   // M2
        })) return true;
        return RAW.independent_expenditures.some(function (ie) {
          return ie.target_candidate_id === c.id && ie.date && (w.start == null || ie.date >= w.start) && (w.end == null || ie.date <= w.end);
        });
      });
    }
    function yearOf(r) { return ((/^(\d{4})-/.exec(r.election_id || '') || [])[1]); }
    var domIds = [].slice.call(ctx2.root().querySelectorAll('.racegroup .racehead')).map(function (h) { return h.textContent; });
    var domByLabel = {}; domIds.forEach(function (t) { domByLabel[t.replace(/ \u00b7 \d{4} election$/, '')] = t; });
    var missFrame = [], missMoney = [], unearned = [], badLabel = [], inFrameEmpty = 0;
    races.forEach(function (r) {
      var inF = yearOf(r) === sel, hasM = raceHasWinMoney(r), dom = domByLabel[r.label];
      if (inF && !dom) missFrame.push(r.id);
      if (!inF && hasM && !dom) missMoney.push(r.id);
      if (dom && !inF && !hasM) unearned.push(r.id);
      if (dom && !(new RegExp('\u00b7 ' + yearOf(r) + ' election$').test(dom))) badLabel.push(r.id);
      if (inF && dom && !hasM) inFrameEmpty++;
    });
    T2.ok('[E7/3\'] (' + sel + ') frame complete: every selected-election race has a section', missFrame.length === 0);
    T2.ok('[E7/3\'] (' + sel + ') no money stranded: every out-of-frame race with in-window money has a section', missMoney.length === 0);
    T2.ok('[E7/3\'] (' + sel + ') nothing unearned: every section is in-frame or carries in-window money' + (unearned.length ? ' — BAD: ' + unearned.join(',') : ''), unearned.length === 0);
    T2.ok('[E7/3\'] (' + sel + ') every section header names its race\'s election', badLabel.length === 0);
    // Fold-in ordering ruling: in-frame sections precede out-of-frame ones (the frame is
    // what the reader selected); WITHIN each group the order is pinned to the pre-amend run.
    var seq = domIds.map(function (t) {
      var m = /\u00b7 (\d{4}) election$/.exec(t);
      return { label: t.replace(/ \u00b7 \d{4} election$/, ''), inF: !!m && m[1] === sel };
    });
    var lastIn = -1, firstOut = -1;
    seq.forEach(function (s, i) { if (s.inF) lastIn = i; else if (firstOut < 0) firstOut = i; });
    T2.ok('[E7/ord] (' + sel + ') every in-frame section precedes every out-of-frame section',
      firstOut < 0 || lastIn < firstOut);
    var pin = fx.sectionOrder[sel];
    T2.ok('[E7/ord] (' + sel + ') in-frame within-group order unchanged from the pre-amend run',
      JSON.stringify(seq.filter(function (s) { return s.inF; }).map(function (s) { return s.label; })) === JSON.stringify(pin.inFrame));
    T2.ok('[E7/ord] (' + sel + ') out-of-frame within-group order unchanged from the pre-amend run',
      JSON.stringify(seq.filter(function (s) { return !s.inF; }).map(function (s) { return s.label; })) === JSON.stringify(pin.outOfFrame));
    console.log('   [E7/3\'] (' + sel + ') sections=' + domIds.length + ' inFrameEmpty=' + inFrameEmpty + ' (the visible-zero finding)');
  }
  shape3Check(T, ctx, '2026');
  T.ok('[E7] President section FIRST', new RegExp(cg.firstRaceText).test(heads[0] || ''));
  T.ok('[E7] districts ascending after President (1A, 1B, ...) — not a string sort',
    /District 1A/.test(heads[1] || '') && /District 1B/.test(heads[2] || ''));
  var ph = groups[0].innerHTML, idxs = cg.presidentOrder.map(function (n) { return ph.indexOf(n); });
  T.ok('[E7] within-race ranked by raised: ' + cg.presidentOrder.join(' > '),
    idxs.every(function (x, i) { return x >= 0 && (i === 0 || x > idxs[i - 1]); }));
  T.ok('[E7] FIREWALL: ranking figure (raised) + three figures SEPARATE (contrib/support/oppose), no fused total',
    /rankfig/.test(ph) && /raised<\/span>/.test(ph) && /figrow/.test(ph) && / contrib/.test(ph) && / support/.test(ph) && / oppose/.test(ph));
  T.ok('[E7] full roster: committee-less candidates rendered + labeled (not dropped)',
    /no committee registered/.test(ctx.root().innerHTML));
  // race filter -> single section, then compose with the time window
  var sel = ctx.root().querySelector('[data-race-filter]');
  T.ok('[E7] race filter present (data-race-filter)', !!sel);
  sel.value = cg.singleRace; sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); await ctx.wait(70);
  T.ok('[E7] race filter -> single race section (graceful)', ctx.root().querySelectorAll('.racegroup').length === 1);
  // Compose with the SCOPE: the race filter persists across a selector switch.
  ctx.selectElection('2024'); await ctx.wait(70);
  await ctx.spend(); await ctx.wait(30); ctx.click(ctx.root().querySelector('[data-spendtab="candidates"]')); await ctx.wait(70);
  T.ok('[E7] race filter composes with the scope switch (single section retained under 2024)',
    ctx.root().querySelector('[data-race-filter]').value === cg.singleRace && ctx.root().querySelectorAll('.racegroup').length === 1);
  // Shape 3' proven in the 2024 scope too (frame = the 10 2024 races; contents = 2026
  // races carrying 2024-window money — the F-2/C5.5 semantics, now guard-free).
  var rs = ctx.root().querySelector('[data-race-filter]'); rs.value = 'all'; rs.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); await ctx.wait(60);
  shape3Check(T, ctx, '2024');
  ctx.selectElection('2026'); await ctx.wait(60);
}

// (F2) HALT-F2 / PS-79: EVERY race's per-candidate figures are window-scoped — expressed
// over the race SET, never an enumerated race list (a hardcoded list of today's races
// would be TOGGLE_RACES wearing a different name; that coupling was the defect's root).
// Oracle windows come from the FIXTURE above. Also proves B1: finance on a race whose
// election has no window entry must throw loud, never render an unwindowed total.
async function assertWindowScoping(T, ctx, fx) {
  var W = ctx.window, ED = W.ElectData, RAW = W.PREVIEW_DATA;
  if (!ED || !RAW) { T.ok('[F2] ElectData + PREVIEW_DATA reachable in page scope', false); return; }
  var idx = ED.loadData(RAW, { office: fx.office });
  var checked = 0, unscoped = [], teeth = 0, teethLeaks = [];
  // P1-E B (M3, PS-141): the EXPECTED funding candidacy, derived from PREVIEW_DATA alone
  // (PS-82 — never from the view model under test): a candidacy with its own committee funds
  // itself; an on_current_record candidacy is funded by its by_person owner.
  var f2Owner = {};
  Object.keys((RAW.rollups || {}).by_person || {}).forEach(function (pid) {
    var ms = RAW.rollups.by_person[pid].members || [], own = null;
    ms.forEach(function (m) { if (m.owns_committee) own = m.candidacy_id; });
    ms.forEach(function (m) { f2Owner[m.candidacy_id] = own; });
  });
  function expectedFunding(cid) {
    var rc = (RAW.candidates || []).filter(function (x) { return x.id === cid; })[0] || {};
    if (rc.committee_id) return cid;
    return rc.finance_facet === 'on_current_record' ? (f2Owner[cid] || null) : null;
  }
  (idx.races || []).forEach(function (r) {
    if (String(r.office || '').indexOf(fx.office) !== 0) return;
    var vm = ED.viewModels.raceView(idx, r.id, null);
    if (!vm || vm.elections) return;   // toggle races: per-election panels carry their own windows (asserted above)
    var yr = (/^(\d{4})-/.exec(r.election_id || '') || [])[1];
    var w = (yr && fx.windows[yr]) || null;
    vm.candidates.forEach(function (c) {
      if (!c.hasFinance || !c.figures) return;
      checked++;
      // P1-E B (M3, PS-141): a borrowed card reads contributions through its funding
      // candidacy and IE through itself, so the oracle does the same, with the funding id it
      // derives independently above; the VM's fundingId must equal it on every card.
      var fWin = ED.candidateFigures(idx, c.id, null, w);
      var fAll = ED.candidateFigures(idx, c.id, null);
      var xf = expectedFunding(c.id);
      if (c.fundingId !== xf) unscoped.push(r.id + '/' + c.id + ':funding');
      if (xf && xf !== c.id) {
        var fw2 = ED.candidateFigures(idx, xf, null, w), fa2 = ED.candidateFigures(idx, xf, null);
        fWin = { contributions: fw2.contributions, independentSupport: fWin.independentSupport, independentOpposition: fWin.independentOpposition };
        fAll = { contributions: fa2.contributions };
      }
      var scoped = c.figures.contributions.total === fWin.contributions.total &&
                   c.figures.independentSupport === fWin.independentSupport &&
                   c.figures.independentOpposition === fWin.independentOpposition;
      if (!scoped) unscoped.push(r.id + '/' + c.id);
      if (fAll.contributions.total !== fWin.contributions.total) {
        teeth++;
        if (c.figures.contributions.total === fAll.contributions.total) teethLeaks.push(r.id + '/' + c.id);
      }
    });
  });
  T.ok('[F2] every non-toggle race candidate figure is window-scoped (' + checked + ' checked)' +
       (unscoped.length ? ' — UNSCOPED: ' + unscoped.join(', ') : ''), checked > 0 && unscoped.length === 0);
  // Teeth: at least one candidate must carry out-of-window rows that the window excludes —
  // otherwise this check could pass vacuously. If this ever fires with teeth=0, the
  // dataset itself changed shape; re-establish the oracle before weakening the assert.
  T.ok('[F2] teeth: cross-window money exists and is excluded (' + teeth + ' candidates)',
       teeth >= 1 && teethLeaks.length === 0);
  // B1: synthesize a race in a year NO window table knows (survives F4 adding municipal
  // windows), give it a finance-bearing candidate in a DEEP COPY, expect the loud throw.
  var b1 = 'no-throw';
  try {
    var cp = JSON.parse(JSON.stringify(RAW));
    var offc = ((idx.races || []).filter(function (r) { return String(r.office || '').indexOf(fx.office) === 0; })[0] || {}).office;
    cp.races.push({ id: 'zz-f2-b1-race', election_id: '1999-zz-fixture', office: offc, label: 'B1 fixture race' });
    cp.candidates.push({ id: 'zz-f2-b1', race_id: 'zz-f2-b1-race', name: 'ZZ F2 B1 Fixture', committee_id: '99999' });
    ED.viewModels.raceView(ED.loadData(cp), 'zz-f2-b1-race', null);
  } catch (e) { b1 = /PS-79\/B1/.test(String(e && e.message)) ? 'threw-b1' : 'threw-other: ' + (e && e.message); }
  T.ok('[F2/B1] finance without a resolvable window throws loud, never an unwindowed total [' + b1 + ']',
       b1 === 'threw-b1');
  // FIX-1 E1 (ratified): receipts dated before the office's earliest window are stated on the
  // card as their own line, never folded into a windowed figure.
  // [FIX1/E1] — mode A (PS-128): the subject is pinned independently of live state — the
  // candidacy williams-sb-2024-d9, its amount $213,831.35 (38 rows, 2022-03..2022-07, measured
  // at 8b752224 against the sealed 2026-09-13 vintage) and the ratified string.
  var ER = W.ElectRender;
  var wvm = ED.viewModels.raceView(idx, 'sb-2024-d9', null);
  var wc = wvm && wvm.candidates.filter(function (c) { return c.id === 'williams-sb-2024-d9'; })[0];
  var wHtml = (wvm && ER) ? ER.renderRaceView(wvm) : '';
  T.ok('[FIX1/E1] pre-window receipts stated on the card: Williams, Raised before 2024 (outside this election): $213,831',
    !!wc && !!wc.preWindow && wc.preWindow.total === 213831.35 && wc.preWindow.count === 38 &&
    wHtml.indexOf('Raised before 2024 (outside this election): <b>$213,831</b>') >= 0);
  // [FIX1/E1-MUNI] — mode B (PS-128): live-derived over every city-council race, premise
  // asserted by the check itself — at least one municipal candidate's committee holds receipts
  // dated before the municipal window start (so the absence below has teeth) — and no
  // municipal card carries the line (E1 reaches school board only).
  var mIdx = ED.loadData(RAW, { office: 'city_council' });
  var mStart = ED.ELECTION_WINDOWS.municipal['2027'].start, mTeeth = 0, mLines = [];
  (mIdx.races || []).forEach(function (r) {
    if (r.office !== 'alderperson') return;
    var mv = ED.viewModels.raceView(mIdx, r.id, null);
    (mv ? mv.candidates : []).forEach(function (c) {
      if (!c.hasFinance) return;
      var early = (mIdx.directByCandidate[c.id] || []).some(function (x) { return x.date && x.date < mStart && x.cycle !== 'pre-2011' && x.cycle !== 'undated'; });
      if (early) mTeeth++;
      if (c.preWindow) mLines.push(c.id);
    });
  });
  T.ok('[FIX1/E1-MUNI] no municipal card states pre-window receipts (' + mTeeth + ' candidates hold them)' +
    (mLines.length ? ' — CARRIED: ' + mLines.slice(0, 4).join(', ') : ''), mTeeth >= 1 && mLines.length === 0);
  // [M3/CARD] — P1-E B (PS-141). PS-128 mode E: the SUBJECT SET is constructed (pinned,
  // fixture m3Ids, and asserted equal to the live on_current_record set first, so a vintage
  // that changes it fires here rather than passing on a stale list); the FIGURES are live and
  // recomputed from PREVIEW_DATA rows by an oracle that reads neither raceView nor by_person
  // (PS-82): each card's contributions = the owning candidacy's committee receipts in the
  // 2024 window; its IE = its own rows in that window. Each renders a full card carrying the
  // ratified line, and not the pre-window line (stated on the committee's own card), and no
  // 2024 race is left marked "soon".
  var pf = fx.person, live = [];
  (RAW.candidates || []).forEach(function (c) { if (c.finance_facet === 'on_current_record') live.push(c.id); });
  var ownerOf = {};
  Object.keys((RAW.rollups || {}).by_person || {}).forEach(function (pid) {
    var ms = RAW.rollups.by_person[pid].members || [], own = null;
    ms.forEach(function (m) { if (m.owns_committee) own = m.candidacy_id; });
    ms.forEach(function (m) { ownerOf[m.candidacy_id] = own; });
  });
  var ckOf = {};
  Object.keys(RAW.committees || {}).forEach(function (k) { var cid = RAW.committees[k].candidate_id; if (cid) ckOf[cid] = k; });
  var w24 = fx.windows['2024'];
  function inW(d) { return !!d && (w24.start == null || d >= w24.start) && (w24.end == null || d <= w24.end); }
  var m3bad = [], m3n = 0;
  pf.m3Ids.forEach(function (id) {
    var c = (RAW.candidates || []).filter(function (x) { return x.id === id; })[0];
    var vm = c && ED.viewModels.raceView(idx, c.race_id, null);
    var vc = vm && vm.candidates.filter(function (x) { return x.id === id; })[0];
    var ck = ckOf[ownerOf[id]];
    var oc = 0, os = 0, oo = 0;
    (RAW.contributions || []).forEach(function (x) {
      if (x.committee_id !== ck || ED.EXCLUDED_CYCLES[x.cycle] || x.contribution_type === 'IE Committee Dues Transfer' || (x.contribution_type === 'Other Receipt' && !x.is_own_committee)) return;   // M2
      if (inW(x.date)) oc += x.amount || 0;
    });
    (RAW.independent_expenditures || []).forEach(function (x) {
      if (x.target_candidate_id !== id || ED.EXCLUDED_CYCLES[x.cycle] || !inW(x.date)) return;
      if (x.stance === 'oppose') oo += x.amount || 0; else os += x.amount || 0;
    });
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var html = vm ? ER.renderRaceView(vm) : '';
    var art = html.split('<article class="card"').filter(function (a) { return a.indexOf('data-person="' + id + '"') >= 0; })[0] || '';
    var ok = !!vc && vc.hasFinance && vc.fundingId === ownerOf[id] &&
      vc.figures.contributions.total === r2(oc) && vc.figures.independentSupport === r2(os) && vc.figures.independentOpposition === r2(oo) &&
      art.indexOf(pf.m3Line) >= 0 && art.indexOf('still populating') < 0 && art.indexOf('class="bars"') >= 0 &&
      vc.preWindow === null && art.indexOf('class="committee prewin"') < 0;
    if (ok) m3n++; else m3bad.push(id);
  });
  var soon24 = [];
  var om = ED.viewModels.officeRaces(idx, fx.office, '2024');
  om.groups.forEach(function (g) { g.races.forEach(function (r) { if (!r.hasFinance) soon24.push(r.id); }); });
  T.ok('[M3/CARD] the ' + pf.m3Ids.length + ' on_current_record 2024 cards render full, oracle-equal figures with the ratified line; no 2024 race marked soon' +
    (m3bad.length ? ' — BAD: ' + m3bad.join(', ') : '') + (soon24.length ? ' — SOON: ' + soon24.join(', ') : ''),
    JSON.stringify(live.slice().sort()) === JSON.stringify(pf.m3Ids.slice().sort()) && m3n === pf.m3Ids.length && soon24.length === 0);
}

// (EXCL) EXCL-UNIFORM / PS-93: out-of-subject money (pre-2011/undated) never enters an
// unchosen figure. Four checks, additions only (pre-ruled: 104 -> 108, zero rewrites).
async function assertExclusionUniformity(T, ctx, fx) {
  var W = ctx.window, ED = W.ElectData, ER = W.ElectRender, RAW = W.PREVIEW_DATA;
  if (!ED || !ER || !RAW) { T.ok('[EXCL] ElectData/ElectRender/PREVIEW_DATA reachable', false); return; }
  var idx = ED.loadData(RAW, { office: fx.office });

  // 1. [EXCL/UNIF] the uniformity assertion — the check that would have caught the
  // original gap. A synthetic artifact whose ONLY money is one pre-2011 row on each
  // committee type must produce zero/empty output from EVERY money-computing entry point.
  var cp = JSON.parse(JSON.stringify(RAW));
  cp.contributions = [
    { donor_id: Object.keys(RAW.donors)[0], committee_id: Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'candidate'; }),
      amount: 5000, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual' },
    { donor_id: Object.keys(RAW.donors)[0], committee_id: Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'independent_expenditure'; }),
      amount: 7000, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual' }];
  cp.independent_expenditures = [];
  var xi = ED.loadData(cp, { office: fx.office });
  var candId = (RAW.committees[cp.contributions[0].committee_id] || {}).candidate_id;
  var ieKey = cp.contributions[1].committee_id;
  var leaks = [];
  if (ED.candidateFigures(xi, candId, null, null).contributions.total !== 0) leaks.push('candidateFigures');
  if (ED.spenderFunders(xi, ieKey).total !== 0) leaks.push('spenderFunders');
  var fp0 = ED.donorFootprint(xi, cp.contributions[0].donor_id, null);
  if (fp0 && fp0.total !== 0) leaks.push('donorFootprint');
  if (ED.browseDonors(xi, null, null, { search: '', type: 'All', industry: 'All', flag: 'All' })
        .some(function (r) { return r.total > 0; })) leaks.push('browseDonors');
  var prof = ED.committeeProfile(xi, ieKey, null);
  if (prof.funderTotal !== 0) leaks.push('committeeProfile.funders');
  T.ok('[EXCL/UNIF] a pre-2011-only artifact renders ZERO from every money entry point' +
    (leaks.length ? ' — LEAKED: ' + leaks.join(',') : ''), leaks.length === 0);

  // 2. [EXCL/SEIU] the live fixture at its post-fix value: the funder total drops from
  // $11,513,949.64 (incl. $11,392,124.39 pre-2011) to the in-subject remainder, and the
  // identity (top funder) is no longer a pre-2011-only entity.
  //
  // RE-PINNED 121825.25 -> 215075.25 at SBE-RERUN-1 (2026-08-09), RATIFIED BY ISHAN as
  // class 1 — a data movement, not a drift. This is a ratified change, not a quiet edit;
  // the evidence is recorded here so a later reader does not have to re-derive it:
  //   * +$93,250.00 in-subject, from 12 new NON-DUES funder rows all dated 2026-07-15
  //     (one Q2 2026 filing) — Mary Beth Canty for Illinois $30,000, Friends of Robyn
  //     Gabel $20,000, IL Democratic County Chairs Assoc $10,000, and nine more at
  //     $6,250 and below. That sum is the delta TO THE CENT.
  //   * separately, one same-donor same-date DUES row corrected by SBE,
  //     seiu-il-council-dues 2026-04-15 $600,750.00 -> $750.00. Invisible to THIS pin
  //     by design — dues are excluded ([DUES/UNIF] working) — which is why the gross
  //     funder receipts FELL $506,750 while the in-subject total ROSE $93,250. A drop
  //     in gross alongside a rise here is the expected shape, not a contradiction.
  //   * the pre-2011 bucket was verified UNMOVED: 201 rows, $11,392,124.39, delta
  //     $0.00. The exclusion machinery is intact; only in-subject money moved.
  // The identity half of the assertion never moved: top funder stayed SEIU Healthcare
  // IL IN PAC at $34,000. Funders 33 -> 43.
  // CNCL-DATA-1 P1.4 ruling 4 (revised 2026-08-30). The identity half used to read the funder's
  // donor `name` — the RAW FILED STRING off whichever receipts row created the donor. The SBE
  // export carries BOTH spellings of this filer: 'SEIU HealthCare IL IN PAC' 121 rows and
  // 'SEIU Healthcare IL IN PAC' 120, and `resolve_donor` slugs them to one id, so `ingest.py:318`
  // records whichever it reached first. That ordering changed when the committee set grew 68 -> 135
  // and the assertion flipped — with no curated file and no Sheet cell having moved. The pin was
  // right; the read was wrong. It now resolves the funder's parent_id to its Donor Clusters
  // CANONICAL name, which is editor-owned and stable. The dollar half is untouched.
  var seiu = ED.spenderFunders(idx, 'ie-committee-18574');
  var seiuTop = seiu.funders[0];
  var seiuCanonical = (function (pid) {
    var cl = (RAW.donor_clusters) || {};
    for (var k in cl) {
      if (!cl[k]) continue;
      if (cl[k].canonical_id === pid) return cl[k].name;
      if ((cl[k].members || []).indexOf(pid) >= 0) return cl[k].name;
    }
    return null;
  })(seiuTop && seiuTop.parent_id);
  // Ruling 61 (2026-10-16): the name is re-pinned to the family's name under PS-155; the figure is unchanged.
  T.ok('[EXCL/SEIU] SEIU PAC funder total == 215075.25 in-subject (was 11513949.64 pre-exclusion; ' +
    're-pinned from 121825.25, ratified 2026-08-09) and top funder resolves to the cluster ' +
    'canonical name SEIU (read: ' + seiuCanonical + ')',
    seiu.total === 215075.25 && seiuCanonical === 'SEIU');

  // 3. [EXCL/WMT] Welcome Wal-Mart: 100% pre-2011 receipts -> empty funder set, the
  // ratified string 2 renders, and NO identity claim appears (E3, structural).
  var wmt = ED.spenderFunders(idx, 'ie-committee-22729');
  var wmtHtml = ER.renderCommitteeProfile(ED.committeeProfile(idx, 'ie-committee-22729', null));
  T.ok('[EXCL/WMT] Welcome Wal-Mart: empty funder set + string 2 + no "Funded primarily by" claim',
    wmt.total === 0 && wmt.count === 0 &&
    wmtHtml.indexOf('No contributions in the cycles this tool covers.') >= 0 &&
    wmtHtml.indexOf('Funded primarily by') < 0 &&
    wmtHtml.indexOf('Total since the 2011 city council term') >= 0);

  // 4. [EXCL/WIN-GUARD] precision the lane surfaced: the 2024 school-board window is
  // OPEN-START (start:null), so a pre-2011 date passes the window predicate BY ITSELF —
  // the protection on windowed figures is the cycle filter, not the window. Assert it.
  var cp2 = JSON.parse(JSON.stringify(RAW));
  var sbCmte = Object.keys(RAW.committees).find(function (k) {
    var cm = RAW.committees[k]; if (cm.type !== 'candidate' || !cm.candidate_id) return false;
    var cd = (RAW.candidates || []).filter(function (c) { return c.id === cm.candidate_id; })[0];
    return cd && /school-board/.test(cd.election_id || '');
  });
  var sbCand = cp2.committees[sbCmte].candidate_id;
  cp2.contributions.push({ donor_id: Object.keys(RAW.donors)[0], committee_id: sbCmte,
    amount: 999999, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual' });
  var xi2 = ED.loadData(cp2, { office: fx.office });
  var before = ED.candidateFigures(idx, sbCand, null, fx.windows['2024']).contributions.total;
  var after = ED.candidateFigures(xi2, sbCand, null, fx.windows['2024']).contributions.total;
  T.ok('[EXCL/WIN-GUARD] a pre-2011 row inside the open-start 2024 window is excluded by CYCLE, not by the window (figure unmoved)',
    after === before);

  // 5. [DUES/UNIF] HALT-DUES / PS-94+PS-95 — CLASS-LEVEL per the brief's preference: the
  // FULL exclusion set, not dues alone. A synthetic artifact whose only money is one dues
  // row, one other receipt and one pre-2011 row on each committee type renders ZERO from every
  // money entry point. (The class is the subject: the next ruled exclusion joins this fixture,
  // not a new check. AUDIT-2 M2's other receipts joined it on that instruction.)
  var cp3 = JSON.parse(JSON.stringify(RAW));
  var candK = Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'candidate'; });
  var ieK = Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'independent_expenditure'; });
  var don0 = Object.keys(RAW.donors)[0];
  cp3.contributions = [
    { donor_id: don0, committee_id: candK, amount: 1111, date: '2025-06-01', cycle: '2027', contribution_type: 'IE Committee Dues Transfer' },
    { donor_id: don0, committee_id: ieK, amount: 2222, date: '2025-06-01', cycle: '2027', contribution_type: 'IE Committee Dues Transfer' },
    { donor_id: don0, committee_id: candK, amount: 5555, date: '2025-06-01', cycle: '2027', contribution_type: 'Other Receipt' },
    { donor_id: don0, committee_id: ieK, amount: 6666, date: '2025-06-01', cycle: '2027', contribution_type: 'Other Receipt' },
    { donor_id: don0, committee_id: candK, amount: 3333, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual' },
    { donor_id: don0, committee_id: ieK, amount: 4444, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual' }];
  cp3.independent_expenditures = [];
  var xi3 = ED.loadData(cp3, { office: fx.office });
  var candId3 = (RAW.committees[candK] || {}).candidate_id;
  var leaks3 = [];
  if (ED.candidateFigures(xi3, candId3, null, null).contributions.total !== 0) leaks3.push('candidateFigures');
  if (ED.candidateContributors(xi3, candId3, null, null).total !== 0) leaks3.push('candidateContributors');
  if (ED.spenderFunders(xi3, ieK).total !== 0) leaks3.push('spenderFunders');
  var fp3 = ED.donorFootprint(xi3, don0, null);
  if (fp3 && fp3.total !== 0) leaks3.push('donorFootprint');
  if (ED.browseDonors(xi3, null, null, { search: '', type: 'All', industry: 'All', flag: 'All' })
        .some(function (r) { return r.total > 0; })) leaks3.push('browseDonors');
  if (ED.committeeProfile(xi3, ieK, null).funderTotal !== 0) leaks3.push('committeeProfile.funders');
  T.ok('[DUES/UNIF] the FULL exclusion set (dues + other receipts + excluded cycles): an artifact holding only such rows renders ZERO from every money entry point' +
    (leaks3.length ? ' — LEAKED: ' + leaks3.join(',') : ''), leaks3.length === 0);
}

// (AGG) LEDGER-0 / PS-96: the un-keyed-money class is asserted ABSENT from the SHIPPED
// elections artifact, class-level. The predicate list is the DETECTION SURFACE, not the
// class definition (PS-96), and the causes carry DISTINCT names (D15's purpose): the
// class waking on a data-source change ([AGG/PS-96], predicates 1-3) is a different
// condition from a Sheet edit whose small-dollar tag makes ITEMIZED money render as an
// aggregate line ([AGG/PS-96-TAG], a false display claim). Read RULINGS.md §PS-96
// before touching either. Council's twins live in validate_council_data.py, per D4(b).
// The JS copy of the detection surface. It lives twice, in two languages — Python's copy
// is validate_council_data.AGG_PREDICATES — and [AGG/PS-96-PARITY] below is what stops the
// two drifting silently (REPAIR-AGG-1 rider F5). `label` is display-only and not compared.
var AGG_PREDICATES = [
  { name: 'AGG/PS-96', kind: 'row', field: 'is_aggregate', test: 'truthy', value: null, label: 'row-flag' },
  { name: 'AGG/PS-96', kind: 'row', field: 'contribution_type', test: 'equals', value: 'Aggregate', label: 'row-type' },
  { name: 'AGG/PS-96', kind: 'donor', field: 'type', test: 'equals', value: 'Aggregate', label: 'donor-type' },
  { name: 'AGG/PS-96-TAG', kind: 'donor', field: 'industries', test: 'contains', value: 'small-dollar', label: 'donor-industry' }
];
var AGG_PREDICATE_KEYS = ['field', 'kind', 'name', 'test', 'value'];

function aggTest(p, obj) {
  var v = obj[p.field];
  if (p.test === 'truthy') return !!v;
  if (p.test === 'equals') return v === p.value;
  if (p.test === 'contains') return (v || []).indexOf(p.value) >= 0;
  throw new Error('unknown predicate test ' + p.test);
}

async function assertAggAbsence(T, ctx) {
  var RAW = ctx.window.PREVIEW_DATA;
  if (!RAW) { T.ok('[AGG/PS-96] PREVIEW_DATA reachable', false); return; }
  var rows = RAW.contributions || [], donors = RAW.donors || {}, hits = [], tagHits = [];
  AGG_PREDICATES.forEach(function (p) {
    var into = p.name === 'AGG/PS-96-TAG' ? tagHits : hits;
    if (p.kind === 'row') {
      rows.forEach(function (c) { if (aggTest(p, c)) into.push(p.label + ':' + c.id); });
    } else {
      Object.keys(donors).forEach(function (k) { if (aggTest(p, donors[k] || {})) into.push(p.label + ':' + k); });
    }
  });
  T.ok('[AGG/PS-96] un-keyed class absent from the elections artifact (predicates 1-3: ' +
    rows.length + ' rows, ' + Object.keys(donors).length + ' donors)' +
    (hits.length ? ' — WOKE (read RULINGS.md §PS-96): ' + hits.slice(0, 4).join(',') : ''),
    hits.length === 0);
  T.ok('[AGG/PS-96-TAG] no donor carries the small-dollar industry tag (which renders itemized money as aggregate)' +
    (tagHits.length ? ' — TAGGED (read RULINGS.md §PS-96): ' + tagHits.slice(0, 4).join(',') : ''),
    tagHits.length === 0);

  // [AGG/PS-96-PARITY] (F5) — the detection surface exists in two languages and can drift.
  // PS-94 does not bind PS-96, but the repeated-condition hazard PS-94 was earned over
  // applies to this list. Shells out to the Python home (the check_docs precedent below).
  var norm = function (list) {
    return JSON.stringify(list.map(function (p) {
      var o = {}; AGG_PREDICATE_KEYS.forEach(function (k) { o[k] = p[k] === undefined ? null : p[k]; });
      return o;
    }));
  };
  var vpath = path.join(__dirname, '..', '..', '..', 'ingestion', 'validate_council_data.py');
  var res = require('child_process').spawnSync('python3', [vpath, '--emit-predicates'], { encoding: 'utf8' });
  var pyList = null;
  try { pyList = JSON.parse((res.stdout || '').trim()); } catch (e) { pyList = null; }
  var agree = pyList !== null && norm(pyList) === norm(AGG_PREDICATES);
  T.ok('[AGG/PS-96-PARITY] the JS detection surface equals the Python one (' +
    AGG_PREDICATES.length + ' predicates)' +
    (agree ? '' : ' — DRIFTED: py=' + (pyList === null ? '(unreadable)' : norm(pyList)) +
      ' js=' + norm(AGG_PREDICATES)), agree);
}

// (PERSON) P1D-PERSON: the person surface. Seven checks, pre-ruled at G2 (97 -> 104).
async function assertPersonSurface(T, ctx, fx) {
  var W = ctx.window, ED = W.ElectData, ER = W.ElectRender, RAW = W.PREVIEW_DATA;
  var pf = fx.person;
  if (!ED || !ER || !RAW || !ED.personView) { T.ok('[PERSON] ElectData.personView + ElectRender reachable', false); return; }
  var idx = ED.loadData(RAW, { office: fx.office });
  var bp = (RAW.rollups && RAW.rollups.by_person) || {};

  // --- 1. [PERSON/EQ] PS-89 rev 2 equivalence: the pure render (== the deep-link path;
  // openPerson passes no window and boot calls the same function) must byte-match the
  // modal opened from a 2026 card AND from a 2024 card (whose container carries a
  // DIFFERENT [data-win-*] window — the teeth). Also: the modal itself carries no
  // window attributes to inherit from.
  var pure = ER.renderPersonModal(ED.personView(idx, pf.pid));
  // DOM-normalize the pure string (valueless attributes serialize as attr="") so the
  // three-way comparison is apples-to-apples; the bytes injected are `pure` either way.
  var tmpEl = ctx.doc.createElement('div'); tmpEl.innerHTML = pure;
  var pureN = tmpEl.innerHTML;
  ctx.click(ctx.doc.querySelector('[data-view="byrace"]')); await ctx.wait(60);
  ctx.selectElection('2026'); await ctx.wait(60);
  ctx.nav(pf.card2026.slug); await ctx.wait(50);
  var b26 = ctx.root().querySelector('[data-person="' + pf.card2026.id + '"]');
  var from2026 = null;
  if (b26) { ctx.click(b26); await ctx.wait(50); from2026 = ctx.modal() && ctx.modal().innerHTML; await ctx.closeModal(); }
  ctx.selectElection('2024'); await ctx.wait(70);
  ctx.nav(pf.card2024.slug); await ctx.wait(50);
  var b24 = ctx.root().querySelector('[data-person="' + pf.card2024.id + '"]');
  var from2024 = null, inWinContainer = !!(b24 && b24.closest('[data-win-end]'));
  if (b24) { ctx.click(b24); await ctx.wait(50); from2024 = ctx.modal() && ctx.modal().innerHTML; await ctx.closeModal(); }
  T.ok('[PERSON/EQ] renders identically: deep-link(pure) == 2026-card == 2024-card, 2024 card inside a window container, no data-win on the modal',
    !!from2026 && from2026 === pureN && from2024 === pureN && inWinContainer && !/data-win-(start|end)/.test(pure));
  ctx.selectElection('2026'); await ctx.wait(60);

  // --- 2. [PERSON/D14] returner equality: careerTotal (computed render-side as the sum of
  // member own-window figures) equals by_person.direct.total for ALL 18 — the identity
  // that fires loudly if a future vintage carries money in a window with no member.
  var d14bad = [];
  Object.keys(bp).forEach(function (pid) {
    var vm = ED.personView(idx, pid);
    if (!vm || Math.abs(vm.careerTotal - bp[pid].direct.total) > 0.01) d14bad.push(pid);
  });
  T.ok('[PERSON/D14] career total == by_person.direct.total for all ' + Object.keys(bp).length + ' returners' +
    (d14bad.length ? ' — BAD: ' + d14bad.join(',') : ''), Object.keys(bp).length === 18 && d14bad.length === 0);

  // --- 3. [PERSON/GRAIN] surface-grain: every member section's figure equals a sum
  // recomputed HERE from PREVIEW_DATA contributions + the FIXTURE's windows (PS-82: the
  // expectation reads neither personView nor by_person).
  var slugByCand = {};
  Object.keys(RAW.committees || {}).forEach(function (k) {
    var cid = RAW.committees[k].candidate_id; if (cid) slugByCand[cid] = k;
  });
  function oracleSum(ownerId, yr) {
    var w = fx.windows[yr], s = 0;
    (RAW.contributions || []).forEach(function (c) {
      if (c.committee_id !== slugByCand[ownerId]) return;
      if (ED.EXCLUDED_CYCLES[c.cycle] || c.contribution_type === 'IE Committee Dues Transfer' || (c.contribution_type === 'Other Receipt' && !c.is_own_committee)) return;   // M2
      var d = c.date || '';
      if ((w.start == null || d >= w.start) && (w.end == null || d <= w.end)) s += (c.amount || 0);
    });
    return Math.round(s * 100) / 100;
  }
  var grainChecked = 0, grainBad = [];
  Object.keys(bp).forEach(function (pid) {
    var vm = ED.personView(idx, pid);
    var owner = null;
    bp[pid].members.forEach(function (m) { if (m.owns_committee) owner = m.candidacy_id; });
    vm.sections.forEach(function (s) {
      grainChecked++;
      if (Math.abs(s.contributions.total - oracleSum(owner, s.year)) > 0.01) grainBad.push(pid + '/' + s.year);
    });
  });
  T.ok('[PERSON/GRAIN] every member-section figure equals the independent oracle recompute (' +
    grainChecked + ' sections)' + (grainBad.length ? ' — BAD: ' + grainBad.join(',') : ''),
    grainChecked >= 36 && grainBad.length === 0);

  // --- 4. [PERSON/IE-FW] P1-E B (PS-141) SUPERSEDES the deferral-scoped [PERSON/PS-90]
  // exclusion consciously, as PS-90 provided; its removal is not a firewall regression. The
  // permanent invariant remains INV-PERSON-2 at the artifact layer. What replaces it is the
  // banked form's firewall: IE lives ONLY in ieByElection — no IE key anywhere in `sections`,
  // the career total untouched (asserted by [PERSON/D14] above), and in the render the IE
  // component follows every member section and no member section carries IE copy.
  // PS-128 mode B: live-derived over every person, premise asserted by the check itself — at
  // least one person carries non-zero IE, so the absence below has teeth.
  function ieKeys(o, found) {
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) {
        if (/independent|ie[_A-Z]|^support$|^oppose$/.test(k)) found.push(k);
        ieKeys(o[k], found);
      });
    }
    return found;
  }
  var leaked = [], withIE = 0, singlesIE = 0, orderBad = [];
  Object.keys(bp).concat(pf.outOfWindowIds).forEach(function (ref) {
    var vm = ED.personView(idx, ref);
    if (!vm) { orderBad.push(ref + ':no-vm'); return; }
    ieKeys(vm.sections, leaked);
    if ((vm.ieByElection || []).some(function (e) { return e.support.total > 0 || e.oppose.total > 0; })) {
      if (bp.hasOwnProperty(ref)) withIE++; else singlesIE++;
    }
    var h = ER.renderPersonModal(vm), iIE = h.indexOf('class="person-ie"');
    var members = h.split('class="person-member"').slice(1);
    var headAt = h.indexOf('<p class="contrib-h person-ie-h">' + pf.ieHeading + '</p>');
    if (iIE < 0 || h.lastIndexOf('class="person-member"') > iIE || headAt < iIE || headAt > iIE + 40 ||
        members.some(function (m) { var body = m.split('class="person-ie"')[0]; return /Independent (support|opposition)|IE PAC/.test(body); }))
      orderBad.push(ref);
  });
  T.ok('[PERSON/IE-FW] IE renders only in its own component after the member sections; none in any section (' + withIE +
    ' linked persons and ' + singlesIE + ' single candidacies carry IE)' +
    (leaked.length ? ' — LEAKED: ' + leaked.join(',') : '') + (orderBad.length ? ' — ORDER: ' + orderBad.join(',') : ''),
    withIE >= 1 && leaked.length === 0 && orderBad.length === 0);

  // --- 4b. [PERSON/IE-GRAIN] every IE row equals an independent recompute from PREVIEW_DATA's
  // IE rows + the FIXTURE's windows (PS-82: reads neither personView's figures nor by_person).
  // PS-128 mode B: live-derived; its premise (at least one non-zero row) asserted in-check.
  var ieChecked = 0, ieNonZero = 0, ieBad = [];
  Object.keys(bp).forEach(function (pid) {
    var pv = ED.personView(idx, pid);
    if (!pv) { ieBad.push(pid + ':no-vm'); return; }
    var rowIds = pv.ieByElection.map(function (e) { return e.candidacyId; }).sort();
    var memIds = bp[pid].members.map(function (m) { return m.candidacy_id; }).sort();
    if (JSON.stringify(rowIds) !== JSON.stringify(memIds)) ieBad.push(pid + ':rows-vs-members');
    pv.ieByElection.forEach(function (e) {
      ieChecked++;
      var w = fx.windows[e.year], sup = 0, opp = 0;
      if (!w) { ieBad.push(pid + '/' + e.year + ':no-fixture-window'); return; }
      (RAW.independent_expenditures || []).forEach(function (x) {
        if (x.target_candidate_id !== e.candidacyId || ED.EXCLUDED_CYCLES[x.cycle]) return;
        var d = x.date || '';
        if (!d || (w.start != null && d < w.start) || (w.end != null && d > w.end)) return;
        if (x.stance === 'oppose') opp += x.amount || 0; else sup += x.amount || 0;
      });
      sup = Math.round(sup * 100) / 100; opp = Math.round(opp * 100) / 100;
      if (sup || opp) ieNonZero++;
      if (Math.abs(e.support.total - sup) > 0.01 || Math.abs(e.oppose.total - opp) > 0.01) ieBad.push(pid + '/' + e.year);
    });
  });
  // The window's teeth, in a DEEP COPY (the [F2/B1] pattern): an IE row dated outside its
  // candidacy's election window is added to a linked member, and that member's row must not move.
  var biteOk = false;
  try {
    var bcp = JSON.parse(JSON.stringify(RAW)), bpid = Object.keys(bp)[0];
    var bmem = bp[bpid].members[0].candidacy_id;
    var before = ED.personView(idx, bpid).ieByElection.filter(function (e) { return e.candidacyId === bmem; })[0];
    bcp.independent_expenditures.push({ id: 'zz-ie-grain-bite', spender_committee_id: (RAW.independent_expenditures[0] || {}).spender_committee_id,
      target_candidate_id: bmem, stance: 'support', amount: 12345.67, date: '2015-06-01', cycle: '2015', match_method: 'exact', needs_review: false });
    var after = ED.personView(ED.loadData(bcp, { office: fx.office }), bpid).ieByElection.filter(function (e) { return e.candidacyId === bmem; })[0];
    biteOk = !!before && !!after && after.support.total === before.support.total;
  } catch (e) { biteOk = false; }
  T.ok('[PERSON/IE-GRAIN] every person IE row equals the independent oracle recompute, one row per member (' + ieChecked + ' rows, ' + ieNonZero +
    ' non-zero); an out-of-window row in a deep copy does not move its row' +
    (ieBad.length ? ' — BAD: ' + ieBad.join(',') : '') + (biteOk ? '' : ' — WINDOW BITE FAILED'),
    ieChecked >= 36 && ieNonZero >= 1 && ieBad.length === 0 && biteOk);

  // --- 5. [PERSON/S11] the out-of-window condition fires on EXACTLY the verified singles
  // (a boolean by construction — personView materialises no unwindowed figure).
  var linkedIds = {};
  Object.keys(bp).forEach(function (pid) { bp[pid].members.forEach(function (m) { linkedIds[m.candidacy_id] = 1; }); });
  var fired = [];
  Object.keys(bp).forEach(function (pid) { if (ED.personView(idx, pid).hasOutOfWindow) fired.push(pid); });
  (RAW.candidates || []).forEach(function (c) {
    var race = idx.raceById[c.race_id] || {};
    if (String(race.office || '').indexOf(fx.office) !== 0 || c.vacating_for || linkedIds[c.id]) return;
    var vm = ED.personView(idx, c.id);
    if (vm && vm.hasOutOfWindow) fired.push(c.id);
  });
  T.ok('[PERSON/S11] string-11 condition fires on exactly the ' + pf.outOfWindowIds.length + ' verified singles' +
    ' (fired: ' + fired.length + ')',
    JSON.stringify(fired.slice().sort()) === JSON.stringify(pf.outOfWindowIds.slice().sort()) &&
    ER.renderPersonModal(ED.personView(idx, pf.outOfWindowIds[0])).indexOf(pf.s11) >= 0 &&
    pure.indexOf(pf.s11) < 0);

  // --- 6. [PERSON/S7] an unresolvable ref: personView returns null and the ratified
  // string-7 state renders (an explicit state, never a bare empty region).
  T.ok('[PERSON/S7] unresolvable person ref -> null VM + the ratified missing state',
    ED.personView(idx, 'zz-no-such-person') === null &&
    ER.renderPersonMissing().indexOf(pf.s7) >= 0);

  // --- 7. [PERSON/D8] the retirement AND the replacement: the ruled pointer string is
  // GONE from both scopes' rendered pages, the returner 2024 card does NOT fall through to
  // "still populating", and the affordance on that same card reads EXACTLY string 13's
  // ratified label (HALT-S13) — the check's subject grew with the ratification, so this is
  // the discipline-25 REWRITE of the G3 check, not a supplement (104 -> 104).
  // (G3 finding stands: no pre-G3 gate check covered the pointer string.)
  var page26 = ctx.root().innerHTML;
  ctx.selectElection('2024'); await ctx.wait(70);
  ctx.nav(pf.card2024.slug); await ctx.wait(50);
  var page24 = ctx.root().innerHTML;
  var aff24 = ctx.root().querySelector('[data-person="' + pf.card2024.id + '"]');
  var card24 = aff24 && aff24.closest('article.card');
  T.ok('[PERSON/D8] pointer retired from both scopes; no false fallback; same-card affordance reads string 13 verbatim',
    page26.indexOf(pf.retiredString) < 0 && page24.indexOf(pf.retiredString) < 0 &&
    !!card24 && card24.innerHTML.indexOf('still populating') < 0 &&
    !!aff24 && aff24.textContent === pf.s13 &&
    pure.indexOf(pf.careerLabel) >= 0);
  ctx.selectElection('2026'); await ctx.wait(60);
}

(async function () {
  var html = fs.readFileSync(PREVIEW, 'utf8');
  var dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  var ctx = makeCtx(dom.window);
  var fx = FIXTURES.school_board;
  var T = { n: 0, fail: 0, ok: function (name, cond) { this.n++; if (!cond) this.fail++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name); } };

  // FIRST, and hard-exiting: everything below reads PREVIEW_DATA. If the preview is
  // not this artifact's, the greens below would describe a vintage that is not in the
  // tree — worse than a red, because it reads as attestation. Refuse to continue.
  // Both links of the chain, sources -> bundle -> preview -> data. Run BOTH before
  // exiting so a broken run reports every stale link, not just the first.
  var bundle = assertBundleVintage(T, dom.window);
  var vintage = assertPreviewVintage(T, dom.window, JSDOM);
  if (!bundle.ok || !vintage.ok) {
    console.error('\ngate_bundle: REFUSING TO ATTEST — ' +
      [bundle.ok ? null : bundle.reason, vintage.ok ? null : vintage.reason]
        .filter(Boolean).join('\n                             AND — ') +
      '\nNo further checks were run; the ' + T.n + ' above are the vintage asserts and their ' +
      'biting cases only.');
    process.exit(2);
  }

  await assertBoot(T, ctx, fx);
  await assertRaceSet(T, ctx, fx);
  await assertSelector(T, ctx, fx);
  await assertSelfFundingNoLeak(T, ctx, fx);
  await assertSpendTabFeatures(T, ctx, fx);
  await assertFirewallFiveNames(T, ctx, fx);
  await assertParity(T, ctx, fx);
  await assertBrowseFilters(T, ctx, fx);
  await assertIndustryDrill(T, ctx, fx);
  await assertCandidateGroups(T, ctx, fx);
  await assertWindowScoping(T, ctx, fx);
  await assertPersonSurface(T, ctx, fx);
  await assertExclusionUniformity(T, ctx, fx);
  await assertAggAbsence(T, ctx);

  // [DOCS] PS-73 docs-form checker (DOCS-M4): one implementation (campaign-finance/
  // tools/check_docs.py), two invokers — build_all.sh's validation gate and this line.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_docs.py')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[DOCS] check_docs (PS-73) green — ' + tail, res.status === 0);
  })();

  // [DOCS/SELF] check_docs's OWN biting cases. Found unrun at SBE-RERUN-1's inverse sweep
  // (which asked what INVOKES each checker, the complement of the sweep that asked what
  // each checker READS): both invokers above call check_docs.py bare, so its 19 cases —
  // every rule firing, shrink-only, owner-required — proved nothing at gate time. A
  // checker whose failure paths never execute is the same green-that-means-nothing its
  // known-failures discipline exists to prevent. Green at adoption.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_docs.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[DOCS/SELF] check_docs self-test green — ' + tail, res.status === 0);
  })();

  // [SHEET/SCOPE] no-editorial-writeback (EDIT-SAFE-1/S2): one implementation
  // (campaign-finance/tools/check_sheet_scopes.py), two invokers — build_all.sh's
  // validation gate and this line, mirroring [DOCS] above. Static and network-free:
  // it reads code and declared scopes, never the live Sheet.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_sheet_scopes.py')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SHEET/SCOPE] no-editorial-writeback holds — ' + tail, res.status === 0);
  })();

  // [SHEET/SELF] check_sheet_scopes's own biting cases — the [DOCS/SELF] case exactly,
  // found by the same sweep. Nine cases, including a real-repo negative control, so the
  // suite proves both that each rule fires AND that the live tree is clean by that rule.
  // Also network-free. Green at adoption.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_sheet_scopes.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SHEET/SELF] check_sheet_scopes self-test green — ' + tail, res.status === 0);
  })();

  // [REF/PINS] the §8 citation-appendix pin checker (HYG-B2 commit B, open ledger 20 f1).
  // §8 pins every cited file by sha256 and hangs line-coordinates off those pins through a
  // TAG, and until this lane nothing verified any of it: HYG-B2's H0 measured 10 of 22
  // in-repo pins drifted off their files, with 32 of the 74 legend-anchored SOURCED rows
  // scoped to bytes that had moved. Commit A restored the truth; this line is what keeps it
  // true, and its absence WAS the ledger item. Same two-line shell-out shape as [DOCS].
  //
  // It verifies IDENTITY and STRUCTURE, never CLAIMS — whether a row's parenthetical still
  // describes the code is human re-verification (commit A's protocol), and the checker's own
  // header says so rather than letting a green imply coverage it does not have.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_ref_pins.py')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[REF/PINS] §8 pins are current and every tag resolves — ' + tail, res.status === 0);
  })();

  // [REF/PINS-SELF] check_ref_pins's own biting cases — the [DOCS/SELF] shape. A pin checker
  // that never fires is the green-that-means-nothing this lane exists to retire: its bites
  // are in-memory mutations over a pure verdict function with the file resolver injected, so
  // apply-and-restore is structural and no bite can leave residue. Green at adoption.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'tools', 'check_ref_pins.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[REF/PINS-SELF] check_ref_pins self-test green — ' + tail, res.status === 0);
  })();

  // [IE/DIST] ingest_ie's unit cases: the ward-absent/district-present collision (IE-DIST-1),
  // PS-140's date routing, and PS-154's confirmation file and lookup. The collision cases'
  // own docstring: "These are non-optional precisely BECAUSE the fix is dormant on live data"
  // — a dormant guard with no exercised test is a guard nobody has checked still works.
  // Plain stdlib, no pytest. The registry, rows and confirmation files are constructed; it
  // reads no data artifact, and three tracked files: election-windows.json, the confirmation
  // file (one case: the loader accepts it) and, where a case runs ingest() whole, own-committee-transfers.json.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'test_ingest_ie_district.py')],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[IE/DIST] ingest_ie district-collision, date-routing and confirmation-file cases green — ' + tail, res.status === 0);
  })();

  // [IE/UNMATCHED] (IEA-1, IEA-2, IEA-3): the alias rung and the unmatched-spending gate. Three
  // parts: the biting cases (constructed rows and lists; they fire the gate, the alias rung and
  // each scope rule); the two tracked lists load against the candidacies in election-data.json
  // (an alias to a candidacy that no longer exists is a stop, not a silent no-op); and the
  // tracked report the last election run wrote shows no undisposed in-scope group.
  (function () {
    var ing = path.join(__dirname, '..', '..', '..', 'ingestion');
    var res = require('child_process').spawnSync('python3', [path.join(ing, 'test_ie_unmatched.py')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[IE/UNMATCHED] alias-rung and unmatched-gate cases green — ' + tail, res.status === 0);
    var py = 'import sys,json; sys.path.insert(0,sys.argv[1]); import ie_unmatched as U; ' +
      'd=json.load(open(sys.argv[2])); a=U.load_aliases({c["id"] for c in d["candidates"]}); b=U.load_dispositions(); ' +
      'print(len(a),len(b))';
    var ld = require('child_process').spawnSync('python3', ['-c', py, ing,
      path.join(__dirname, '..', '..', '..', 'election-data.json')], { encoding: 'utf8' });
    T.ok('[IE/UNMATCHED] the tracked alias and disposition lists load against election-data.json (' +
      ((ld.stdout || '').trim() || (ld.stderr || '').trim().split('\n').pop()) + ')', ld.status === 0);
    // The report is the last election run's; it is read against the CURRENT lists, so a report
    // left behind by an older list (a disposition since struck or changed) is not a green.
    var rp = path.join(__dirname, '..', '..', 'ie-unmatched-report.json');
    var py2 = 'import sys,json; sys.path.insert(0,sys.argv[1]); import ie_unmatched as U; ' +
      'r=json.load(open(sys.argv[2])); b=U.load_dispositions(); g=r["groups"]; ' +
      'bad=[x["key"] for x in g if not x["disposition"] or b.get(tuple(x["key"]))!=x["disposition"]]; ' +
      'used={tuple(x["key"]) for x in g}; unused=[k for k in b if k not in used]; ' +
      'print(r["undisposed"],len(g),len(bad),len(unused)); sys.exit(0 if (r["undisposed"]==0 and not bad and not unused) else 1)';
    var rr = require('child_process').spawnSync('python3', ['-c', py2, ing, rp], { encoding: 'utf8' });
    var f4 = (rr.stdout || '').trim().split(' ');
    T.ok('[IE/UNMATCHED] the tracked report shows no undisposed in-scope outside spending, and every group\'s ' +
      'disposition is the current list\'s, none unused (' + (rr.status === 0 || f4.length === 4
        ? f4[0] + ' undisposed, ' + f4[1] + ' groups, ' + f4[2] + ' out of step, ' + f4[3] + ' unused'
        : 'report missing or unreadable: ' + (rr.stderr || '').trim().split('\n').pop()) + ')', rr.status === 0);
  })();

  // [VOTES/SELF] the votes-family self-test (SBVOTE-1/A.4), third invoker of the same
  // shell-out shape as [DOCS] and [SHEET/SCOPE] above. It fires the repaired VOTES-ROSTER
  // / VOTES-5 / VOTES-6 on synthetic fixtures — including a members-shaped artifact WITH
  // votes, the population that produced a false green before this lane. Synthetic only:
  // it reads no artifact, so it stays fast and cannot go stale with the data.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'validate_council_data.py'),
       '--self-test'], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[VOTES/SELF] votes-family self-test green — ' + tail, res.status === 0);
  })();

  // [SBV/SELF] the school-board ingest's own self-test (SBVOTE-1/B). D-3 ratifies four
  // slug examples as COMMITTED TEST CASES; a committed test case that no gate runs is a
  // test that rots. This is what keeps the minting rule honest.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingest_sb_votes.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBV/SELF] school-board ingest self-test green — ' + tail, res.status === 0);
  })();

  // [SBV/ROSTER] green-at-zero, made standing rather than one-time. The born artifact
  // carries a full roster and zero votes, so validate_votes early-returns and VOTES-*
  // do not execute on it — MEMBER-1..7 are its real examination, and this line is what
  // asserts they keep passing. The ENUMERATION of what executed belongs to the lane
  // report; this asserts the roster contract holds (amendment adoption 1).
  (function () {
    var art = path.join(__dirname, '..', '..', '..', 'school-board-data.json');
    if (!fs.existsSync(art)) {
      T.ok('[SBV/ROSTER] school-board artifact present', false);
      return;
    }
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'validate_council_data.py'), art],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBV/ROSTER] born school-board artifact validates clean — ' + tail,
         res.status === 0);
  })();

  // [ELECT/VALID] the elections artifact validated — the gap the inverse sweep left last.
  // This gate is ABOUT election-data.json and never validated it. council-data.json came in
  // at [SHARD/STALE] and the roster at [SBV/ROSTER]; the elections artifact was checked only
  // as chain step 9, at build time — the validate_shard_freshness shape, on the primary
  // subject. Every invariant the shared validator carries (cluster integrity, INV-ELECT
  // stamping, person-links, committee linkage, [AGG/PS-96-DEFECT], and [DONOR/PARENT]
  // ported here from smoke_b1.js at SBE-RERUN-1 G) now holds at gate time, not only at
  // build time. No --shards: the elections artifact has no shard tier, the embed fetches
  // it whole (MECHANISM_REFERENCE C5.2).
  (function () {
    var root = path.join(__dirname, '..', '..', '..');
    var res = require('child_process').spawnSync('python3',
      [path.join(root, 'ingestion', 'validate_council_data.py'),
       path.join(root, 'election-data.json')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[ELECT/VALID] election-data.json validates clean — ' + tail, res.status === 0);
  })();

  // [SBF/SELF] + [SBF/ARTIFACT] the finance layer (SBFIN-1/HALT-SBF-A). Two lines, the
  // [SBV/SELF] + [SBV/ROSTER] shape exactly: the builder's own unit cases, then the minted
  // artifact's examination against its source.
  //
  // The artifact line is the one that matters. Its SBF-5 assert — no field anywhere equals
  // a sum of the four money streams — is the structural never-summed check that the
  // council's own Spend-by-Alder surface does NOT have (G1b S2-a): nothing in this repo
  // would notice if that surface fused its three columns tomorrow. The mirror is therefore
  // gated where its source is not, which is the intended direction.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'build_sb_finance.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBF/SELF] school-board finance builder self-test green — ' + tail, res.status === 0);
  })();

  // [ENC] SBFIN-4: no persisted display name carries a C1 control or an unmapped byte.
  // A decoder bug is invisible by construction — latin-1 never raises — so the artifact is
  // the only place it can be caught. SHRINK-ONLY known-failures: the one live instance
  // (`Daniel O\x92Keefe`, live on the deployed elections tool) is pinned at 1, and the
  // checker FAILS if a listed entry stops failing, so the re-run that clears it must also
  // remove the pin.
  (function () {
    var root = path.join(__dirname, '..', '..', '..');
    var chk = path.join(root, 'tools', 'check_encoding.py');
    var res = require('child_process').spawnSync('python3', [chk], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[ENC] no persisted name carries a C1/unmapped byte — ' + tail, res.status === 0);
    var st = require('child_process').spawnSync('python3', [chk, '--self-test'],
                                                { encoding: 'utf8' });
    var stail = ((st.stdout || '') + (st.stderr || '')).trim().split('\n').pop();
    T.ok('[ENC/SELF] check_encoding self-test green — ' + stail, st.status === 0);
  })();

  // [NAMES/WS] + [NAMES/SELF] displayed-name hygiene on the names WE own (SBE-RERUN-1 E).
  // Added because NO gate line asserted committee names at all — which is how
  // 'Illinois Farm Bureau  ACTIVATOR' (double space) shipped to the deployed tool in
  // 85f71c6, caught only by prerender_b2.js, an UNWIRED harness. Scoped to committees +
  // donor_clusters, the names this project authors or curates; donor names are the filer's
  // own string as SBE recorded it (74 carry double spaces) and are deliberately out — see
  // check_names.py's scope note. This asserts a PROPERTY; a pin on the 15 exact values is
  // banked for ratification, since a legitimate rename must not read as a failure.
  (function () {
    var chk = path.join(__dirname, '..', '..', '..', 'tools', 'check_names.py');
    var res = require('child_process').spawnSync('python3', [chk], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[NAMES/WS] no curated display name carries a double space or edge whitespace — ' +
      tail, res.status === 0);
    var st = require('child_process').spawnSync('python3', [chk, '--self-test'],
                                                { encoding: 'utf8' });
    var stail = ((st.stdout || '') + (st.stderr || '')).trim().split('\n').pop();
    T.ok('[NAMES/SELF] check_names self-test green — ' + stail, st.status === 0);
  })();

  // [RECON/ARTIFACT] + [RECON/SELF] the reconciliation report (RECONCILE-2 A).
  //
  // Until this landed, NOTHING in the tree asserted this artifact's presence, its
  // parseability or its freshness — measured at RECONCILE-1 H4. It is the wrong artifact
  // to leave unguarded: the elections embed fetches it from the CDN, so it is the only
  // thing this project publishes where a PUSH reaches readers with no paste in the way.
  //
  // The line is GREEN WITH ONE PINNED RED inside it. The report is stamped with its TRUE
  // inputs — the 07-23 vintage it was actually built from — while the tree holds the 08-10
  // election-data.json, because SBE-RERUN-1 refreshed the artifact and reconcile was never
  // re-run. A truthful stamp and a matching guard are incompatible until HALT-B's refresh,
  // so that single divergence is pinned SHRINK-ONLY in reconcile_known_failures.json with
  // its removal condition named in the file. The other three inputs are NOT pinned and
  // match on disk today. Ratified 2026-08-12; planner error 82 records the conflict.
  (function () {
    var root = path.join(__dirname, '..', '..', '..');
    var vr = path.join(root, 'ingestion', 'validate_reconcile.py');
    var art = path.join(root, 'elections', 'reconciliation-report.json');
    if (!fs.existsSync(art)) {
      T.ok('[RECON/ARTIFACT] reconciliation report present', false);
      return;
    }
    var res = require('child_process').spawnSync('python3', [vr, art], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[RECON/ARTIFACT] reconciliation report parses and its stamped inputs still hash as recorded — '
      + tail, res.status === 0);
    var rst = require('child_process').spawnSync('python3', [vr, '--self-test'],
                                                 { encoding: 'utf8' });
    var rtail = ((rst.stdout || '') + (rst.stderr || '')).trim().split('\n').pop();
    T.ok('[RECON/SELF] validate_reconcile self-test green — ' + rtail, rst.status === 0);
  })();

  // [SBF/NOSHEET] the scope silence made an asserted absence (HALT-B addendum 3).
  // check_sheet_scopes discovers files by SHEET_MARKERS; a builder that touches no
  // Sheet is simply not discovered, so its 8/8 green says nothing about it either
  // way. This asserts the absence directly, so "it doesn't touch the Sheet" stops
  // being an inference from a checker that never looked.
  (function () {
    var src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'ingestion',
                                        'build_sb_finance.py'), 'utf8');
    var MARKERS = ['gspread', 'auth/spreadsheets', '.worksheet('];
    var hit = MARKERS.filter(function (m) { return src.indexOf(m) >= 0; });
    T.ok('[SBF/NOSHEET] the finance builder contains no Sheet marker (asserted, not inferred)',
         hit.length === 0, hit.join(','));
  })();

  (function () {
    var root = path.join(__dirname, '..', '..', '..');
    var art = path.join(root, 'school-board-finance.json');
    if (!fs.existsSync(art)) {
      T.ok('[SBF/ARTIFACT] school-board finance artifact present', false);
      return;
    }
    // --school-board is passed for [SBF/SYNC]'s benefit: the validator hard-exits before
    // any of its 7,500+ checks unless the artifact's `_sync.inputs` shas match BOTH files
    // on disk. Without the flag the roster half would be reported UNVERIFIED rather than
    // checked.
    var res = require('child_process').spawnSync('python3',
      [path.join(root, 'ingestion', 'validate_sb_finance.py'), art,
       '--elections', path.join(root, 'election-data.json'),
       '--school-board', path.join(root, 'school-board-data.json')],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBF/ARTIFACT] finance artifact validates against its source — ' + tail,
         res.status === 0);
  })();

  // [SBF/VSELF] the finance VALIDATOR's own biting cases. Found unrun at the SBE-RERUN-1
  // vacuity sweep: validate_sb_finance.py --self-test was invoked from nowhere in the
  // repo, so its bites — including [SBF/SYNC]'s — proved nothing at gate time. A self-test
  // no gate runs is the same green-that-means-nothing its own docstring warns about.
  // [SBF/SELF] above is the BUILDER's self-test; this is the validator's. Both now run.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'validate_sb_finance.py'),
       '--self-test'], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBF/VSELF] school-board finance VALIDATOR self-test green — ' + tail,
         res.status === 0);
  })();

  // [SHARD/STALE] council shards vs the council monolith. RATIFIED at the SBE-RERUN-1
  // sweep: validate_shard_freshness (in validate_council_data.py) is the good precedent
  // for a build-product vintage tie — it compares the index shard's generated_at to the
  // monolith's and then the totals behind it — but it runs only `if a.shards`, and NO
  // gate passed the flag. Freshness verified solely inside build_all.sh means this gate
  // could be green while the shards on disk are stale. The gate's job is to attest the
  // tree, and the shards are in the tree. Measured cost at adoption: 0.68 s for the
  // 40 MB monolith plus the three shards — the ~39 MB parse that keeps the council RENDER
  // fixture ungated is not a reason to skip a parse this cheap.
  (function () {
    var root = path.join(__dirname, '..', '..', '..');
    var res = require('child_process').spawnSync('python3',
      [path.join(root, 'ingestion', 'validate_council_data.py'),
       path.join(root, 'council-data.json'), '--shards', path.join(root, 'shards')],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SHARD/STALE] council shards are current with council-data.json — ' + tail,
         res.status === 0);
  })();

  // [RENDER/B2] the elections data+render harness (SBE-RERUN-1 F). 120 assertions over the
  // pure data + render layers. Wired because the inverse sweep found it invoked by nothing
  // in code — only by DEPLOY.md's "Verify before pasting" ritual — and FAILING, with
  // paste debt outstanding in front of it. It covers ten subjects no other check does
  // (the ie-cmte-toggle absence pin, coming-soon for city_council/mayor, the "· soon"
  // marking, footer disclaimer copy, the display face (Georgia, no @font-face — D1), single
  // openModal/closeModal, cycle pills removed, the cycle data-layer arg, the IE scope
  // counts 110/218/328, and the Custer/Biggs vacating notes), which is why it was repaired
  // rather than deleted. It reads election-data.json directly — no preview, so
  // [PREVIEW/VINTAGE] does not apply — and as of F it writes nothing.
  (function () {
    var res = require('child_process').spawnSync('node',
      [path.join(__dirname, 'prerender_b2.js')], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[RENDER/B2] elections data+render harness green — ' + tail, res.status === 0);
  })();

  // [SBV/RENDER] the school-board embed's render fixture (SBVOTE-1/C). It boots the real
  // embed in jsdom and asserts every birth state: string 1 on zero votes, string 3 on a
  // member with no positions, the vacancy as a seat with NO member page, `-` as
  // not-recorded rather than Neutral, and a stated error on fetch failure.
  //
  // The council render fixture is deliberately UNGATED because each boot parses a ~39 MB
  // artifact. That cost does not exist here — the school-board artifact is ~7.6 KB — so
  // the precedent's rule (a fixture is the evidence the render ships on) is kept while
  // its cost-driven exception is not. Deliberate divergence, not an oversight.
  (function () {
    var res = require('child_process').spawnSync('node',
      [path.join(__dirname, '..', '..', '..', 'school-board', 'sb_render_fixture.js')],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[SBV/RENDER] school-board embed render fixture green — ' + tail, res.status === 0);
  })();

  // [MUNI/GUARD] + [MUNI/SELF] the D-17 / PS-107 code-before-data guard (MUNI-ENABLE-1 G3),
  // built BEFORE the change it guards. It asserts one conditional: a municipal candidacy may
  // carry a committee id only where the render path can window municipal money. The hazard is
  // measured — requireWin() throws for an office with no window table, latent behind
  // committee_id being null, at THREE call sites (raceView, raceBrowse, personView), all of
  // which the checker drives. Same two-line shell-out shape as [DOCS] and [RENDER/B2].
  //
  // It probes rather than introspects: officeType/ELECTION_WINDOWS are closed over in data.js
  // and exporting them to let a test read them would move the bundle and stale the live page
  // for a test's convenience. So the checker deep-copies the artifact in memory, grants one
  // municipal candidacy a committee id, and reads the joint effect off the public API.
  //
  // ALREADY RETIRED ITSELF (G4). Built at G3 the unless-branch was false and the guard held
  // because no municipal committee id existed; G4 landed the office-type and municipal window
  // tables, so the branch is true and this same body — unchanged — is now the standing
  // invariant "municipal finance never renders without a window table". What it still catches
  // is an edit that drops municipal windows while municipal ids exist, which self-test bite 5
  // pins by removing the window table in memory and requiring the injected id to fail again.
  // [ELECT/URL] the data host, asserted on EVERY EMITTED FILE rather than on app.js: what ships
  // is what gets pasted, and there are three pasted surfaces. Ruling 123 (2026-10-22) moved the
  // data from raw.githubusercontent.com, D-26's refs/heads/main/ form, to GitHub Pages; this check
  // carried D-26 and now carries 123. Mirrors sb_render_fixture's [MAP] for the school-board
  // embed and check_homepage's host check.
  //
  // Both directions: every emission must carry the Pages election-data URL, AND none may carry a
  // raw.githubusercontent URL at all. A one-sided check would pass a file that kept an old-host
  // URL beside the new one, and the old host is the one ruling 123 retired for load.
  //
  // DEPLOY.md stays in scope (CNCL-DATA-1 P2.1 W10, R13 (a)): it is the deploy instruction a human
  // follows, so an old-host URL in it is one a paster will copy. Its presence assertion stands, so
  // deleting the URLs or the file fails rather than passing an empty sweep.
  (function () {
    var PAGES = 'https://publicgoodpolicy.github.io/chi-council-votes/campaign-finance/election-data.json';
    var OLD = /raw\.githubusercontent\.com/;
    var bad = [];
    Object.keys(BUNDLE_MOD.OFFICES).forEach(function (office) {
      var out = BUNDLE_MOD.outFor(office);
      if (!fs.existsSync(out)) { bad.push(office + ': emission missing'); return; }
      var html = fs.readFileSync(out, 'utf8');
      if (html.indexOf("'" + PAGES + "'") < 0) bad.push(office + ': the Pages election-data URL is absent (check went vacuous)');
      // F-1 (128-3): the two office files, each by its full address, in every emission (the
      // payload is one across the three bundles; data-office picks the address at runtime).
      ['election-data.school-board.json', 'election-data.city-council.json'].forEach(function (f) {
        if (html.indexOf("'" + PAGES.replace(/election-data\.json$/, f) + "'") < 0) bad.push(office + ': the Pages URL for ' + f + ' is absent');
      });
      if (OLD.test(html)) bad.push(office + ': still carries a raw.githubusercontent URL');
    });
    var DEPLOY = path.join(__dirname, '..', 'DEPLOY.md');
    if (!fs.existsSync(DEPLOY)) {
      bad.push('DEPLOY.md: absent — the widened branch has nothing to sweep');
    } else {
      var dtext = fs.readFileSync(DEPLOY, 'utf8');
      if (dtext.indexOf(PAGES) < 0) bad.push('DEPLOY.md: no Pages URL present (sweep went hollow)');
      if (OLD.test(dtext)) bad.push('DEPLOY.md: carries a raw.githubusercontent URL');
    }
    T.ok('[ELECT/URL] every emission AND DEPLOY.md fetch from the ruled GitHub Pages host (123) ' +
      'and none carries a raw.githubusercontent URL — ' +
      (bad.length ? bad.join('; ') : Object.keys(BUNDLE_MOD.OFFICES).length +
        ' emissions + DEPLOY.md clean'),
      bad.length === 0);
  })();
  // [OFFICE/SLICE] F-1 (rulings 128-3, 131-1, 132-2, 134-1): each elections page loads its own
  // office's file (election-data.school-board.json, election-data.city-council.json), built by
  // tools/build_office_data.js from the full file, which stays for the mayor bundle. The claim is
  // that the page is the same on its office file as on the full file, but for the donor pop-up,
  // which holds this office's giving only and lists the other offices' totals. Proved here by
  // building every view the page builds from both files with the same data.js:
  //   1. both committed office files are what the builder makes from the committed full file;
  //   2. race browse, office races, every race view x cycle, every spend tab x election, every
  //      candidate's figures, every committee profile x window and every person view are equal,
  //      and the donor facets are equal but for industries no donor in the office file carries
  //      (134-1: they had no giving on the page);
  //   3. every donor pop-up, every parent x window: this office's rows equal the full pop-up's
  //      rows for this office, and its total plus its other-office lines equal the full total;
  //   4. every window the page draws (each race's, each selector option's) names a window id;
  //   5. the pop-up renders each other-office line with its link (131-1);
  //   6. a bite: one other-office total moved by a cent fails 3.
  (function () {
    var CF = path.join(__dirname, '..', '..', '..');
    var ED = require(path.join(__dirname, '..', 'data.js'));
    var ER = require(path.join(__dirname, '..', 'render.js'));
    var BOD = require(path.join(__dirname, 'build_office_data.js'));
    var full = JSON.parse(fs.readFileSync(path.join(CF, 'election-data.json'), 'utf8'));
    var OFFNAME = { alderperson: 'city_council', mayor: 'mayor', school_board_president: 'school_board', school_board_member: 'school_board' };
    var J = JSON.stringify;
    var fresh = [];
    BOD.OFFICES.forEach(function (o) {
      var p = path.join(CF, o.file), cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      if (cur !== J(BOD.build(full, o.office)) + '\n') fresh.push(o.file + (cur == null ? ' absent' : ' differs from its rebuild'));
    });
    T.ok('[OFFICE/SLICE] both office files are what build_office_data.js makes from election-data.json — ' +
      (fresh.length ? fresh.join('; ') : BOD.OFFICES.map(function (o) { return o.file; }).join(' + ') + ' fresh'), fresh.length === 0);
    BOD.OFFICES.forEach(function (o) {
      var office = o.office, sl = JSON.parse(fs.readFileSync(path.join(CF, o.file), 'utf8'));
      var A = ED.loadData(full, { office: office }), B = ED.loadData(sl, { office: office });
      var EW = ED.ELECTION_WINDOWS[ED.OFFICE_TYPE[office]], ids = Object.keys(EW).sort();
      var W = [null].concat(ids.map(function (k) { return EW[k]; })), sels = [null].concat(ids);
      var n = 0, bad = [];
      var eq = function (what, a, b) { n++; if (J(a) !== J(b) && bad.length < 4) bad.push(what); };
      var cyc = ED.availableCycles(A); eq('cycles', cyc, ED.availableCycles(B));
      [null].concat(cyc).forEach(function (c) {
        eq('raceBrowse ' + c, ED.viewModels.raceBrowse(A, office, c), ED.viewModels.raceBrowse(B, office, c));
        sl.races.forEach(function (r) { eq('raceView ' + r.id + ' ' + c, ED.viewModels.raceView(A, r.id, c), ED.viewModels.raceView(B, r.id, c)); });
        sl.candidates.forEach(function (cd) { eq('candidateFigures ' + cd.id + ' ' + c, ED.candidateFigures(A, cd.id, c), ED.candidateFigures(B, cd.id, c)); });
      });
      var dropped = {};
      sels.forEach(function (s) {
        eq('officeRaces ' + s, ED.viewModels.officeRaces(A, office, s), ED.viewModels.officeRaces(B, office, s));
        ['donors', 'candidates', 'industries', 'industry-candidate', 'flags'].forEach(function (tab) {
          var a = ED.spendSubtab(A, office, tab, null, s), b = ED.spendSubtab(B, office, tab, null, s);
          var fa = a.facets, fb = b.facets, a2 = Object.assign({}, a), b2 = Object.assign({}, b);
          delete a2.facets; delete b2.facets; eq('spend ' + tab + ' ' + s, a2, b2);
          if (fa || fb) {
            eq('facet types ' + s, fa.types, fb.types); eq('facet flags ' + s, fa.flags, fb.flags);
            var ib = {}; fb.industries.forEach(function (x) { ib[x.id] = 1; });
            fb.industries.forEach(function (x) { n++; if (!fa.industries.some(function (y) { return J(y) === J(x); }) && bad.length < 4) bad.push('facet industry ' + x.id + ' not on the full file'); });
            fa.industries.forEach(function (x) {
              if (ib[x.id]) return; dropped[x.id] = 1; n++;
              var carried = Object.keys(sl.donors).some(function (d) { return (sl.donors[d].industries || []).indexOf(x.id) >= 0; });
              if (carried && bad.length < 4) bad.push('facet industry ' + x.id + ' dropped though a donor in the file carries it');
            });
          }
        });
      });
      Object.keys(sl.committees).forEach(function (k) { W.forEach(function (w) { eq('committeeProfile ' + k, ED.committeeProfile(A, k, w), ED.committeeProfile(B, k, w)); }); });
      Object.keys(sl.rollups.by_person).forEach(function (p) { eq('personView ' + p, ED.personView(A, p), ED.personView(B, p)); });
      T.ok('[OFFICE/SLICE] ' + office + ': every view the page builds is the same on its office file as on the full file — ' +
        (bad.length ? bad.join('; ') : n + ' comparisons equal' + (Object.keys(dropped).length ? '; industry filter drops ' + Object.keys(dropped).sort().join(', ') + ' (no donor in the file carries them, 134-1)' : '')),
        bad.length === 0 && n > 0);
      // 3 and 6: the pop-ups.
      var parents = {}; Object.keys(sl.donors).forEach(function (d) { parents[sl.donors[d].parent_id || d] = 1; });
      var fpCheck = function (index, perturb) {
        var m = 0, fb2 = [];
        Object.keys(parents).forEach(function (p) {
          W.forEach(function (w) {
            var fa = ED.donorFootprint(A, p, w), fb = ED.donorFootprint(index, p, w);
            var keep = fa.committees.filter(function (x) { return !(x.kind === 'candidate' && (OFFNAME[x.office] || x.office) !== office); });
            var oth = 0; (fb.otherOffices || []).forEach(function (l) { oth += l.total; });
            m++;
            var ok = fa.otherOffices === null && Array.isArray(fb.otherOffices) && J(keep) === J(fb.committees) &&
              Math.abs(Math.round((fb.total + oth) * 100) / 100 - fa.total) < 0.005;
            if (!ok && fb2.length < 3) fb2.push(p + ' @ ' + (w ? ED.windowId(office, w) : 'all'));
          });
        });
        return { n: m, bad: fb2 };
      };
      var r = fpCheck(B);
      T.ok('[OFFICE/SLICE] ' + office + ': every donor pop-up holds this office\'s rows as on the full file, and its total plus its other-office lines is the full total — ' +
        (r.bad.length ? r.bad.join('; ') : r.n + ' parent x window pop-ups'), r.bad.length === 0 && r.n > 0);
      // the bite: move one other-office total by a cent
      var p0 = Object.keys(sl.other_office_giving)[0], w0 = Object.keys(sl.other_office_giving[p0])[0], o0 = Object.keys(sl.other_office_giving[p0][w0])[0];
      var sl2 = JSON.parse(J(sl)); sl2.other_office_giving[p0][w0][o0] = Math.round((sl2.other_office_giving[p0][w0][o0] + 0.01) * 100) / 100;
      var savedParents = parents; parents = {}; parents[p0] = 1;
      var rb = fpCheck(ED.loadData(sl2, { office: office })); parents = savedParents;
      T.ok('[OFFICE/SLICE:bite] ' + office + ': one other-office total moved by a cent fails the pop-up check', rb.bad.length > 0);
      // 4: every drawn window has an id.
      var miss = [];
      sels.forEach(function (s) { var w = ED.electionWindow(office, s); if (s != null && ED.windowId(office, w) == null) miss.push('selector ' + s); });
      sl.races.forEach(function (rr) { var w = ED.ELECTION_WINDOWS[ED.OFFICE_TYPE[rr.office]] && ED.ELECTION_WINDOWS[ED.OFFICE_TYPE[rr.office]][(/^(\d{4})/.exec(rr.election_id || '') || [])[1]]; if (w && ED.windowId(office, w) == null) miss.push('race ' + rr.id); });
      T.ok('[OFFICE/SLICE] ' + office + ': every window the page draws names a window id in the office file — ' + (miss.length ? miss.slice(0, 4).join('; ') : sels.length - 1 + ' selector windows, ' + sl.races.length + ' races'), miss.length === 0);
      // 5: the rendered lines.
      var pr = Object.keys(sl.other_office_giving).filter(function (p) { return sl.other_office_giving[p].all; })[0];
      var fpx = ED.donorFootprint(B, pr, null), html = ER.renderFunderModal(fpx), rbad = [];
      var HREF = { city_council: '/city-council?donor=', school_board: '/school-board-elections?donor=', mayor: '/who-is-funding-the-27-mayoral-race' };
      fpx.otherOffices.forEach(function (l) {
        if (html.indexOf('href="' + HREF[l.office] + (l.office === 'mayor' ? '' : encodeURIComponent(pr))) < 0) rbad.push(l.office + ' link');
      });
      if (html.indexOf('across every office') >= 0) rbad.push('the full-file note');
      if ((html.match(/class="ipg-other-office"/g) || []).length !== fpx.otherOffices.length) rbad.push('line count');
      T.ok('[OFFICE/SLICE] ' + office + ': the pop-up renders one "Also gave" line per other office, each with its link (131-1) — ' +
        (rbad.length ? rbad.join('; ') : pr + ': ' + fpx.otherOffices.map(function (l) { return l.office; }).join(', ')), rbad.length === 0 && fpx.otherOffices.length > 0);
    });
  })();
  // [BRAND/MARK] rulings 120b and 121b (2026-10-22): the FinTrack mark above the masthead title, on
  // EVERY EMITTED FILE, exactly once each, decorative (aria-hidden) with the brand name as text.
  // Presence is asserted, so losing the mark from a pasted surface fails rather than passing.
  (function () {
    var MARK = /<p class="track"><svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" focusable="false">.*?<\/svg><span><b>Fin<\/b>Track<\/span><\/p><p class="eyebrow">/g;
    var bad = [];
    Object.keys(BUNDLE_MOD.OFFICES).forEach(function (office) {
      var out = BUNDLE_MOD.outFor(office);
      if (!fs.existsSync(out)) { bad.push(office + ': emission missing'); return; }
      var n = (fs.readFileSync(out, 'utf8').match(MARK) || []).length;
      if (n !== 1) bad.push(office + ': ' + n + ' FinTrack marks');
    });
    T.ok('[BRAND/MARK] every emission carries the FinTrack mark exactly once, before the eyebrow, decorative (120b, 121b) — ' +
      (bad.length ? bad.join('; ') : Object.keys(BUNDLE_MOD.OFFICES).length + ' emissions, one mark each'),
      bad.length === 0);
  })();

  // [MUNI/COPY] the D-21 (PS-111) ratified display strings. Two halves, because a table that
  // matches its oracle while nothing renders from it is the vacuity PS-100 warns about: the
  // check asserts render.js's table equals RATIFIED_COPY_ORACLE token for token in BOTH
  // directions, AND that a really rendered page carries the strings. The school-board entries
  // are the ones that must not move — they shipped before G5 and nothing already ratified was
  // reworded — so a silent edit to any of them fails here rather than reaching a reader.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var got = R._ratified || {};
    var mismatch = [];
    // Compare on ANY primitive, not just strings. The first draft tested `typeof === 'string'`
    // and so silently passed a removed numeric entry — methodologyOffices carries 1, not "1",
    // and Object.keys(1) is empty, so a missing key compared clean. Caught by bite 5, which
    // revoked school_board's methodology and watched this line stay green while [MUNI/METH]
    // failed. A checker that only bites on the types it happened to be written against is the
    // PS-100 shape one layer down.
    function isObj(v) { return v !== null && typeof v === 'object'; }
    function cmp(label, a, b) {
      if (!isObj(a) || !isObj(b)) {
        if (a !== b) mismatch.push(label + ': ' + JSON.stringify(b) + '≠' + JSON.stringify(a));
        return;
      }
      Object.keys(a).forEach(function (k) { cmp(label + '.' + k, a[k], b[k]); });
      Object.keys(b).forEach(function (k) { if (!(k in a)) mismatch.push(label + '.' + k + ': extra ' + JSON.stringify(b[k])); });
    }
    cmp('browseFraming', RATIFIED_COPY_ORACLE.browseFraming, got.browseFraming);
    cmp('raceFilterAll', RATIFIED_COPY_ORACLE.raceFilterAll, got.raceFilterAll);
    cmp('personElectionNoun', RATIFIED_COPY_ORACLE.personElectionNoun, got.personElectionNoun);
    cmp('methodologyOffices', RATIFIED_COPY_ORACLE.methodologyOffices, got.methodologyOffices);

    // rendered-reach half: the strings must actually appear in real output, not just in a table
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var reach = [];
    var isb = D.loadData(json, { office: 'school_board' });
    var spend = D.spendSubtab(isb, 'school_board', 'donors', null, '2026',
      { search: '', type: 'All', industry: 'All', flag: 'All' }, 'all', null);
    var page = R.renderPage({ office: 'school_board', topView: 'spend', cycles: D.availableCycles(isb),
      cycle: null, officeRaces: D.viewModels.officeRaces(isb, 'school_board', '2026'), activeSlug: null,
      raceView: null, spend: spend, selector: { options: D.selectorOptions('school_board'), active: '2026' }, verify: {} });
    if (page.indexOf(RATIFIED_COPY_ORACLE.browseFraming) < 0) reach.push('browseFraming absent from a rendered Browse-donors page');
    ['school_board', 'city_council', 'mayor'].forEach(function (off) {
      var idx = D.loadData(json, { office: off });
      var sv = D.spendSubtab(idx, off, 'candidates', null, null,
        { search: '', type: 'All', industry: 'All', flag: 'All' }, 'all', null);
      var html = R.renderSpend(sv, off);
      var m = html.match(/<option value="all"[^>]*>([^<]*)</);
      if (!m || m[1] !== RATIFIED_COPY_ORACLE.raceFilterAll[off]) {
        reach.push(off + ' race-filter default rendered ' + JSON.stringify(m && m[1]) +
          ', expected ' + JSON.stringify(RATIFIED_COPY_ORACLE.raceFilterAll[off]));
      }
    });
    T.ok('[MUNI/COPY] the ratified display strings match the oracle and reach real output — ' +
      (mismatch.length || reach.length
        ? 'DRIFT [' + mismatch.join('; ') + '] UNREACHED [' + reach.join('; ') + ']'
        : Object.keys(RATIFIED_COPY_ORACLE.raceFilterAll).length + ' race-filter labels + framing + ' +
          Object.keys(RATIFIED_COPY_ORACLE.personElectionNoun).length + ' election nouns, all pinned and rendered'),
      mismatch.length === 0 && reach.length === 0);
  })();

  // [MUNI/METH] the D-22 (PS-112) methodology gate, asserted on RENDERED output rather than on
  // the allowlist alone. The failure it exists to prevent is specific and was measured before
  // the gate landed: methodologyView renders ahead of the readiness test, so all three offices
  // shipped a methodology saying the tool tracks school board elections. Both directions are
  // checked — school board must still render its methodology (the gate must not have broken the
  // one office that has one), and the other two must render coming-soon carrying no school-board
  // copy at all.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var bad = [];
    ['school_board', 'city_council', 'mayor'].forEach(function (off) {
      var idx = D.loadData(json, { office: off });
      var html = R.renderPage({ office: off, topView: 'methodology', cycles: D.availableCycles(idx),
        cycle: null, officeRaces: D.viewModels.officeRaces(idx, off, null), activeSlug: null,
        raceView: null, spend: null, selector: { options: D.selectorOptions(off), active: null },
        // CNCL-DATA-1 P2.1 W8: duesExcluded threaded so these checks exercise the page the app
        // actually renders (C4 included), not a four-paragraph shadow of it.
        duesExcluded: idx.duesExcluded, verify: { reconUrl: 'x', gapsUrl: 'y' } });
      var isMeth = html.indexOf('How this tool is built') >= 0;
      var soon = /— coming soon<\/h2>/.test(html);
      var saysSB = /school board/i.test(html);
      if (RATIFIED_COPY_ORACLE.methodologyOffices[off]) {
        if (!isMeth || soon) bad.push(off + ' has a ratified methodology but did not render it');
      } else {
        if (isMeth) bad.push(off + ' rendered a methodology it has not ratified');
        if (!soon) bad.push(off + ' did not render coming-soon on the methodology tab');
        if (saysSB) bad.push(off + ' methodology tab still carries school-board copy');
      }
    });
    // The summary is DERIVED from the oracle, not written as prose. It used to name the offices
    // by hand — "city_council and mayor render coming-soon" — and P2.1's flip made that sentence
    // false while the check itself stayed correct: a green line describing the wrong world. A pass
    // message that cannot follow the thing it reports on is a small instance of the same class the
    // register's own pin-and-coordinate rule exists to prevent.
    var members = ['school_board', 'city_council', 'mayor'].filter(function (o) {
      return !!RATIFIED_COPY_ORACLE.methodologyOffices[o]; });
    var nonmembers = ['school_board', 'city_council', 'mayor'].filter(function (o) {
      return !RATIFIED_COPY_ORACLE.methodologyOffices[o]; });
    T.ok('[MUNI/METH] the methodology tab renders only for an office with a ratified ' +
      'methodology — ' + (bad.length ? bad.join('; ')
        : members.join(', ') + ' render it; ' +
          (nonmembers.length ? nonmembers.join(', ') + ' render coming-soon carrying no ' +
            'school-board copy' : 'no office is outside the allowlist')),
      bad.length === 0);
  })();

  // [MUNI/SUBJ] the member-branch subject invariant — ELEC-METH-1 R4(ii), decision D'.
  //
  // PS-128 derivation mode: **E (hybrid), both axes named.** CONSTRUCTED axis — the per-office
  // subject tokens in METHODOLOGY_SUBJECT_ORACLE, stated in this file independently of live repo
  // state. LIVE axis — the rendered methodology output, produced by render.js against
  // election-data.json, and the allowlist membership read from render.js's own _ratified export.
  // Not mode A (the rendered side is live), not mode B (the tokens are not derived from the
  // subject under test), and not mode C/D (the premises are asserted here, by this check, not by
  // a sibling).
  //
  // Why it exists, measured rather than supposed: [MUNI/METH]'s anti-school-board-copy assertion
  // lives only in its NON-member branch, so it evaporates for exactly the office an enlisting
  // commit adds. Simulated at ELEC-METH-1 G0 (finding F2): with city_council in both the
  // allowlist and the copy oracle, [MUNI/METH] returned PASS while the council methodology tab
  // rendered verbatim school-board copy. This check is what makes that state fail.
  //
  // Premise assertions run BEFORE any containment assertion, so the check cannot pass while
  // measuring nothing (PS-128 (i), (v)): the token table must cover exactly the three offices,
  // the tokens must be mutually disjoint, the member set must be non-empty, and every rendered
  // page measured must be non-empty.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var OFFICES = ['school_board', 'city_council', 'mayor'];
    var bad = [];

    // --- premise 1: the token table covers exactly the offices under test
    var tokKeys = Object.keys(METHODOLOGY_SUBJECT_ORACLE).sort();
    if (tokKeys.join(',') !== OFFICES.slice().sort().join(',')) {
      bad.push('subject-token table covers [' + tokKeys.join(',') + '], expected [' + OFFICES.slice().sort().join(',') + ']');
    }
    // --- premise 2: tokens mutually disjoint, or "contains no other office's token" is hollow
    OFFICES.forEach(function (a) {
      OFFICES.forEach(function (b) {
        if (a !== b && METHODOLOGY_SUBJECT_ORACLE[b] &&
            METHODOLOGY_SUBJECT_ORACLE[b].indexOf(METHODOLOGY_SUBJECT_ORACLE[a]) >= 0) {
          bad.push('token for ' + a + ' is a substring of the token for ' + b + ' — not discriminating');
        }
      });
    });
    // --- premise 3: the member set is non-empty (an empty set would pass every member assertion)
    var members = OFFICES.filter(function (o) { return !!(R._ratified || {}).methodologyOffices[o]; });
    if (members.length === 0) bad.push('no member office in the methodology allowlist — nothing measured');

    // --- the invariant itself, per MEMBER office, on rendered output
    var checked = 0;
    members.forEach(function (off) {
      var idx = D.loadData(json, { office: off });
      var html = R.renderPage({ office: off, topView: 'methodology', cycles: D.availableCycles(idx),
        cycle: null, officeRaces: D.viewModels.officeRaces(idx, off, null), activeSlug: null,
        raceView: null, spend: null, selector: { options: D.selectorOptions(off), active: null },
        // CNCL-DATA-1 P2.1 W8: duesExcluded threaded so these checks exercise the page the app
        // actually renders (C4 included), not a four-paragraph shadow of it.
        duesExcluded: idx.duesExcluded, verify: { reconUrl: 'x', gapsUrl: 'y' } });
      // --- premise 4: this page rendered something
      if (!html || html.length === 0) { bad.push(off + ' rendered an empty methodology page'); return; }
      checked++;
      var own = METHODOLOGY_SUBJECT_ORACLE[off];
      if (html.indexOf(own) < 0) {
        bad.push(off + ' is a member but its methodology does not name its own subject (' + JSON.stringify(own) + ')');
      }
      OFFICES.forEach(function (other) {
        if (other === off) return;
        if (html.indexOf(METHODOLOGY_SUBJECT_ORACLE[other]) >= 0) {
          bad.push(off + ' methodology carries ' + other + "'s subject copy (" +
            JSON.stringify(METHODOLOGY_SUBJECT_ORACLE[other]) + ')');
        }
      });
    });
    if (checked !== members.length) bad.push('measured ' + checked + ' of ' + members.length + ' member offices');

    T.ok('[MUNI/SUBJ] every member office renders a methodology naming its own subject and no ' +
      'other office\'s — ' + (bad.length ? bad.join('; ')
        : checked + ' member office(s) [' + members.join(',') + '] checked against ' +
          tokKeys.length + ' disjoint subject tokens'),
      bad.length === 0);
  })();

  // [MUNI/TABLE] the D-18 (PS-108) cross-language drift oracle. The office-type table exists
  // in two languages — data.js OFFICE_TYPE and build_rollups.py OFFICE_TYPE — because one
  // predicate cannot span both. Each is asserted against OFFICE_TYPE_ORACLE above, never
  // against the other: comparing them only to each other would pass while both drifted the
  // same way, and comparing either to the oracle alone would let the other rot unwatched.
  // Both directions of set difference are checked, so an ADDED token fails as loudly as a
  // missing one — the failure mode where a ninth office is enumerated in one language only.
  (function () {
    // data.js required from source. Sound because [BUNDLE/VINTAGE] above already pins that
    // the shipped bundle recomposes from these exact sources, so source and shipped cannot
    // disagree without that check failing first.
    var EDsrc = require(path.join(__dirname, '..', 'data.js'));
    var expect = OFFICE_TYPE_ORACLE;
    var jsTable = EDsrc.OFFICE_TYPE || {};
    var py = require('child_process').spawnSync('python3',
      ['-c', 'import sys,json; sys.path.insert(0,' +
        JSON.stringify(path.join(__dirname, '..', '..', '..', 'ingestion')) +
        '); import build_rollups; print(json.dumps(build_rollups.OFFICE_TYPE))'],
      { encoding: 'utf8' });
    var pyTable = {};
    try { pyTable = JSON.parse((py.stdout || '{}').trim()); } catch (e) {}
    function diff(a, b) {
      var out = [];
      Object.keys(a).forEach(function (k) { if (a[k] !== b[k]) out.push(k + ':' + a[k] + '≠' + (b[k] === undefined ? 'absent' : b[k])); });
      Object.keys(b).forEach(function (k) { if (!(k in a)) out.push(k + ':absent≠' + b[k]); });
      return out;
    }
    var dJs = diff(expect, jsTable), dPy = diff(expect, pyTable);
    T.ok('[MUNI/TABLE] the office-type table agrees with the oracle in BOTH languages (' +
      Object.keys(expect).length + ' tokens) — ' +
      (dJs.length || dPy.length
        ? 'DRIFT js[' + dJs.join(', ') + '] py[' + dPy.join(', ') + ']'
        : 'data.js and build_rollups.py both match'),
      py.status === 0 && dJs.length === 0 && dPy.length === 0);
  })();

  // [MUNI/WINDOW] the D-20 (PS-110) municipal window values, in all three places they live:
  // data.js's ELECTION_WINDOWS object, election-windows.json's array, and the oracle above.
  // The two shapes differ (object-keyed-by-id vs ordered array with an id field), so the
  // check normalizes before comparing rather than pretending they are the same structure.
  (function () {
    var EDsrc = require(path.join(__dirname, '..', 'data.js'));
    var expect = MUNICIPAL_WINDOWS_ORACLE;
    var js = (EDsrc.ELECTION_WINDOWS || {}).municipal || {};
    var jsonPath = path.join(__dirname, '..', '..', 'election-windows.json');
    var arr = [];
    try { arr = (JSON.parse(fs.readFileSync(jsonPath, 'utf8')) || {}).municipal || []; } catch (e) {}
    var fromJson = {};
    arr.forEach(function (w) { fromJson[w.id] = { start: w.start, end: w.end }; });
    function norm(o) {
      return Object.keys(o).sort().map(function (k) {
        return k + '[' + (o[k].start === null ? 'null' : o[k].start) + '..' + o[k].end + ']'; }).join(',');
    }
    var e = norm(expect), a = norm(js), b = norm(fromJson);
    T.ok('[MUNI/WINDOW] municipal window values agree across data.js, election-windows.json ' +
      'and the oracle — oracle ' + e + (e === a && e === b ? ' (both match)' :
        ' | data.js ' + (a || 'ABSENT') + ' | json ' + (b || 'ABSENT')),
      e === a && e === b);
  })();

  (function () {
    var chk = path.join(__dirname, 'check_muni_guard.js');
    var res = require('child_process').spawnSync('node', [chk], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[MUNI/GUARD] no municipal committee id outruns municipal window support — ' + tail,
      res.status === 0);
    var st = require('child_process').spawnSync('node', [chk, '--self-test'], { encoding: 'utf8' });
    var stail = ((st.stdout || '') + (st.stderr || '')).trim().split('\n').pop();
    T.ok('[MUNI/SELF] muni-guard self-test green — ' + stail, st.status === 0);
  })();

  // ---- CNCL-DATA-1 P2.1 ----
  // [COUNCIL/CAND] the council candidate surface resolves and reconciles.
  //
  // PS-128 DERIVATION MODE: **E (hybrid), both axes named.** CONSTRUCTED axis — the floor figure
  // and the window, stated here independently of data.js's tables (they mirror PS-110's window and
  // the S1(i) FLOOR that [RENDER/B2] pins). LIVE axis — the view models, built by data.js from
  // election-data.json, and the per-candidate figures render.js reads.
  //
  // WHY IT EXISTS: G0 measured that council candidate surfaces had SHAPE coverage (S1(i) asserts
  // readiness and that figures resolve) and no coverage of the VALUES a reader sees. D-25's rule
  // is that an independent recomputation must be able to disagree somewhere, so this walks the
  // view models the page walks and re-sums the windowed money by a DIFFERENT path — straight from
  // the artifact's contribution rows through the committee join — and requires the two to agree.
  // The bite mutates one candidacy's committee linkage, which moves the view-model side and not
  // the artifact side, so agreement is a real constraint rather than a restatement.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8');
    var FLOOR = 23769132.31, WIN = { start: '2023-05-15', end: '2027-12-31' };

    function walk(json) {
      var idx = D.loadData(json, { office: 'city_council' });
      var om = D.viewModels.officeRaces(idx, 'city_council', null);
      var seen = 0, resolved = 0, largest = 0;
      om.groups.forEach(function (g) { g.races.forEach(function (r) {
        var rv = D.viewModels.raceView(idx, idx.raceBySlug[r.slug], null);
        (rv && rv.candidates || []).forEach(function (c) {
          seen++;
          if (c.figures && c.figures.contributions) resolved++;
          var t = (c.figures && c.figures.contributions && c.figures.contributions.total) || 0;
          if (t > largest) largest = t;
        });
      }); });
      // The independent path: SBE-id join, direct rows only, windowed by DATE — never the cycle
      // label, which spans 2023 onward and would sweep four years of other elections in.
      var muniCmte = {};
      var raceOffice = {};
      (json.races || []).forEach(function (r) { raceOffice[r.id] = r.office; });
      (json.candidates || []).forEach(function (c) {
        if (raceOffice[c.race_id] === 'alderperson' && c.committee_id != null) muniCmte[c.committee_id] = 1;
      });
      var sbeOf = {};
      Object.keys(json.committees || {}).forEach(function (k) {
        var rec = json.committees[k];
        if (rec && rec.sbe_committee_id) sbeOf[k] = String(rec.sbe_committee_id);
      });
      var sum = 0, rows = 0;
      (json.contributions || []).forEach(function (c) {
        if (!muniCmte[sbeOf[c.committee_id]]) return;
        if (String(c.contribution_type || '').indexOf('IE Committee') === 0 || (c.contribution_type === 'Other Receipt' && !c.is_own_committee)) return;   // M2
        if (!c.date || c.date < WIN.start || c.date > WIN.end) return;
        rows++; sum += c.amount || 0;
      });
      return { seen: seen, resolved: resolved, largest: largest,
               sum: Math.round(sum * 100) / 100, rows: rows };
    }

    var m = walk(JSON.parse(raw));
    var ok = m.seen > 0 && m.resolved === m.seen && m.largest > 0 && m.sum >= FLOOR;
    T.ok('[COUNCIL/CAND] every council candidacy resolves a figure and the windowed sum holds the ' +
      'floor — ' + m.resolved + ' of ' + m.seen + ' resolve, largest ' + m.largest + ', ' +
      m.rows + ' rows summing ' + m.sum + ' >= ' + FLOOR, ok);

    // BITE AT BIRTH — apply and restore inside ONE command boundary, on an in-memory copy so no
    // file is touched at all. Breaking one candidacy's committee linkage drops that committee's
    // money from the independent sum while the view models still list the candidacy: the two
    // paths then disagree, which is the disagreement D-25 requires a real check to be capable of.
    var bit = JSON.parse(raw);
    var victim = null;
    for (var i = 0; i < bit.candidates.length && !victim; i++) {
      var rc = bit.races.filter(function (r) { return r.id === bit.candidates[i].race_id; })[0];
      if (rc && rc.office === 'alderperson' && bit.candidates[i].committee_id != null) victim = bit.candidates[i];
    }
    var before = walk(JSON.parse(raw));
    victim.committee_id = null;
    var after = walk(bit);
    T.ok('[COUNCIL/CAND:bite] breaking one candidacy\'s committee linkage makes the check fire — ' +
      'resolved ' + before.resolved + '/' + before.seen + ' -> ' + after.resolved + '/' + after.seen +
      ', sum ' + before.sum + ' -> ' + after.sum,
      !(after.seen > 0 && after.resolved === after.seen && after.largest > 0 && after.sum >= FLOOR));
    // restore verified against the pin: the untouched parse must still pass
    var restored = walk(JSON.parse(raw));
    T.ok('[COUNCIL/CAND:bite] restore verified — the unmutated artifact passes again (' +
      restored.resolved + '/' + restored.seen + ', ' + restored.sum + ')',
      restored.seen > 0 && restored.resolved === restored.seen && restored.sum >= FLOOR);
  })();

  // [COUNCIL/DONOR] the council donor surface excludes what the exclusions say it excludes.
  //
  // PS-128 DERIVATION MODE: **A (live-only).** Both sides are read from the artifact and the view
  // models built from it: the check asserts a property of the rendered donor rows (no dues-typed
  // money, no excluded-cycle money, no out-of-office IE committee), not a pinned figure. There is
  // no constructed oracle because the correct row count changes with every refresh.
  //
  // WHY IT EXISTS: G0 measured ZERO harness coverage of the council donor surfaces while they are
  // large and live in code — thousands of donor and browse rows (the live counts print on the PASS line below). The three
  // properties asserted are the ones the code enforces in three different places (the DUES_TYPE
  // skip, EXCLUDED_CYCLES, and the office-scope filter on IE committees), so a regression in any
  // of them shows up here rather than on a reader's screen.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8');
    var DUES_TYPE = 'Member Dues';

    function measure(json) {
      var idx = D.loadData(json, { office: 'city_council' });
      var vm = D.spendSubtab(idx, 'city_council', 'donors', null, '2027');
      var rows = (vm && vm.rows) || [];
      var total = rows.reduce(function (s, r) { return s + (r.total || 0); }, 0);
      var ieOutOfScope = rows.filter(function (r) {
        var cm = idx.committees[r.parent_id] || {};
        return cm.type === 'independent_expenditure' && !idx.inScopeIE[r.parent_id];
      }).length;
      var html = R.renderSpend(vm, 'city_council');
      return { n: rows.length, total: Math.round(total * 100) / 100,
               ieOutOfScope: ieOutOfScope, bytes: html.length };
    }

    var base = measure(JSON.parse(raw));
    // PREMISE FIRST (PS-128 (i)): a surface that measured nothing would satisfy every assertion
    // below vacuously, so its non-emptiness is asserted before anything is asserted about it.
    var premise = base.n > 0 && base.total > 0 && base.bytes > 0;
    T.ok('[COUNCIL/DONOR] the council donor surface is non-empty and carries no out-of-scope IE ' +
      'committee — ' + base.n + ' rows, ' + base.total + ', ' + base.ieOutOfScope + ' out-of-scope IE',
      premise && base.ieOutOfScope === 0);

    // BITE AT BIRTH, in memory: a dues-typed row and an out-of-scope IE committee injected on the
    // council surface must each move something. The dues row must NOT change the total (it is
    // excluded by type); the IE committee, given a kept council row, must appear and be caught.
    var bit = JSON.parse(raw);
    var anyCouncilCmte = null;
    var raceOffice = {}; bit.races.forEach(function (r) { raceOffice[r.id] = r.office; });
    var alderCmteIds = {};
    bit.candidates.forEach(function (c) {
      if (raceOffice[c.race_id] === 'alderperson' && c.committee_id != null) alderCmteIds[c.committee_id] = 1;
    });
    Object.keys(bit.committees).forEach(function (k) {
      var rec = bit.committees[k];
      if (!anyCouncilCmte && rec && rec.sbe_committee_id && alderCmteIds[String(rec.sbe_committee_id)]) anyCouncilCmte = k;
    });
    var donorId = Object.keys(bit.donors)[0];
    bit.contributions.push({ committee_id: anyCouncilCmte, donor_id: donorId, parent_id: donorId,
      amount: 999999.99, date: '2026-01-15', cycle: '2027', contribution_type: DUES_TYPE });
    var withDues = measure(bit);
    T.ok('[COUNCIL/DONOR:bite] a dues-typed council row is excluded from the surface total — ' +
      base.total + ' -> ' + withDues.total + ' (unmoved)', withDues.total === base.total);

    var bit2 = JSON.parse(raw);
    bit2.committees['ie-committee-99999'] = { id: 'ie-committee-99999', type: 'independent_expenditure',
      committee_name: 'BITE IE', sbe_committee_id: '99999' };
    bit2.contributions.push({ committee_id: 'ie-committee-99999', donor_id: donorId, parent_id: donorId,
      amount: 12345.67, date: '2026-01-15', cycle: '2027', contribution_type: 'Individual Contribution' });
    var withIE = measure(bit2);
    T.ok('[COUNCIL/DONOR:bite] an out-of-scope IE committee injected on the council surface is ' +
      'filtered out — total ' + base.total + ' -> ' + withIE.total + ' (unmoved), out-of-scope count ' +
      withIE.ieOutOfScope, withIE.total === base.total && withIE.ieOutOfScope === 0);

    var restored = measure(JSON.parse(raw));
    T.ok('[COUNCIL/DONOR:bite] restore verified — the unmutated artifact measures as before (' +
      restored.n + ' rows, ' + restored.total + ')',
      restored.n === base.n && restored.total === base.total);
  })();

  // [METH/REGISTER] the rendered methodology copy IS the register's text.
  //
  // PS-128 DERIVATION MODE: **register-derived** (a mode D sibling: the oracle is neither
  // constructed in this file nor read from the subject under test, but extracted from a THIRD
  // artifact — `campaign-finance/RULINGS.md`, the authority of record). Declared as its own mode
  // because it is not A (the oracle is not live repo state under test), not B (nothing is stated
  // here), and not E (there is no constructed axis at all).
  //
  // WHY IT EXISTS: R14 ruled that ratified copy enters the register BEFORE it ships, so that
  // P2.1's oracle cites register text. That is a claim about a relationship, and until something
  // asserts it the relationship is a convention — render.js could drift from the register by one
  // character and every other check would stay green, which is precisely the class of defect the
  // register exists to prevent.
  //
  // NORMALIZATION, stated because a comparison is only as honest as its normalization. The
  // register carries each C-string inside a `>`-quoted block, inside backticks, wrapped across
  // lines at the register's own width, and C4/C5 carry `{PLACEHOLDER}` tokens. So: strip the `> `
  // quote marker; take the backticked span following the `**Cn, …:**` label; collapse the
  // register's line-wrap whitespace to single spaces. NOTHING ELSE is altered — in particular the
  // ASCII apostrophes in C1 and C3 are the register's own bytes and are compared as such, and the
  // rendered side is compared with its tags stripped but its characters untouched (no entity
  // decoding, because the council branch deliberately does not run these strings through esc()).
  // R11's sentence is compared the same way, with its placeholders bound to the same `verify` the
  // page used.
  //
  // THE LINKS PARAGRAPH IS PINNED TO THE SIBLING BRANCH, NOT TO THE REGISTER (D3, 2026-08-31).
  // It is not ratified copy — it predates this lane and lives only in render.js — so there is no
  // register text to compare it against. What the ruling requires is that the council branch's
  // copy of it be the school-board branch's copy, which is asserted here by rendering both for
  // the SAME state and requiring byte-identity. Saying so explicitly matters: a reader of this
  // check must not conclude that everything it guards is register-derived.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var REG = path.join(__dirname, '..', '..', '..', 'RULINGS.md');
    var reg = fs.readFileSync(REG, 'utf8').split('\n');

    function entry(heading) {
      var i = reg.indexOf(heading);
      if (i < 0) return null;
      var j = i + 1;
      while (j < reg.length && reg[j].indexOf('### ') !== 0) j++;
      return reg.slice(i, j).map(function (l) {
        return l.indexOf('> ') === 0 ? l.slice(2) : (l === '>' ? '' : l);
      }).join('\n');
    }
    var cEntry = entry('### ELEC-METH-1 — council methodology strings C1–C4');
    var rEntry = entry('### CNCL-DATA-1 P2 — the verify sentence (R11)');
    // R47: the school-board branch's one ratified string is its OWN register entry, not a sixth
    // item in the council set — so it is a second extraction target, extracted by the same form.
    var sEntry = entry('### SB-METH-1 — school-board methodology string C5');
    // M5 (R3): C6, the own-committee paragraph, is ratified as an amendment inside the R8/R9
    // composition entry. It is extracted from that block: the lines after "C6 reads:", up to
    // the next blank line, joined on single spaces.
    var c6Entry = entry('### CNCL-DATA-1 P2 — R8 and R9 as applied');
    var C6 = null;
    if (c6Entry) {
      var c6l = c6Entry.split('\n'), c6i = -1;
      for (var q = 0; q < c6l.length; q++) if (/C6 reads:$/.test(c6l[q])) c6i = q;
      if (c6i >= 0) {
        var c6j = c6i + 1; while (c6j < c6l.length && c6l[c6j] === '') c6j++;
        var c6k = c6j; while (c6k < c6l.length && c6l[c6k] !== '') c6k++;
        C6 = c6l.slice(c6j, c6k).join(' ').replace(/\s+/g, ' ').trim();
      }
    }
    // AUDIT-2 M2: C7 and C8 are ratified as a third amendment inside the same entry and are read
    // in C6's form: the lines after "C7 reads:" (or "C8 reads:"), up to the next blank line,
    // joined on single spaces. The school-board section's heading is the amendment's one bold
    // phrase following the words "under the heading".
    function readsAfter(label) {
      if (!c6Entry) return null;
      var l = c6Entry.split('\n'), at = -1;
      for (var q2 = 0; q2 < l.length; q2++) if (new RegExp(label + ' reads:$').test(l[q2])) at = q2;
      if (at < 0) return null;
      var j2 = at + 1; while (j2 < l.length && l[j2] === '') j2++;
      var k2 = j2; while (k2 < l.length && l[k2] !== '') k2++;
      return l.slice(j2, k2).join(' ').replace(/\s+/g, ' ').trim() || null;
    }
    var C7 = readsAfter('C7'), C8 = readsAfter('C8');
    var sbHead = c6Entry ? ((/under the heading \*\*([^*]+)\*\*/.exec(c6Entry.replace(/\s+/g, ' ')) || [])[1] || null) : null;
    // AUDIT-2 (R4): C9, C10, S1 and S2 are ratified as a fourth amendment inside the same entry and
    // are read in C6's form. Three more things are read from that amendment's own words: the
    // reworded heading (the bold phrase after "becomes") and the heading it replaces (in the
    // register's backticks before it); the sentence C10 follows; and the words of the sentence S2
    // replaces. Nothing about the new composition is stated in this file that the register states.
    var C9 = readsAfter('C9'), C10 = readsAfter('C10'), S1 = readsAfter('S1'), S2 = readsAfter('S2');
    var r4 = c6Entry ? c6Entry.replace(/\s+/g, ' ') : '';
    var r4head = /the heading that reads `([^`]+)` becomes \*\*([^*]+)\*\*/.exec(r4) || [];
    var oldHead = r4head[1] || null, newHead = r4head[2] || null;
    var c10After = (/gains C10 as its last sentence, after \u201c([^\u201d]+)\u201d;/.exec(r4) || [])[1] || null;
    var oldPending = (/filings are \u201c([^\u201d]+)\u201d, is replaced by S2\./.exec(r4) || [])[1] || null;
    // The fifth amendment (small gifts; rulings 74a, 76b, 82a, ratified 2026-10-20 as ruling 85): C11 in
    // C6's form, and the school-board section's heading, the bold phrase after "a section headed".
    var C11 = readsAfter('C11');
    var sgHead = (/a section headed \*\*([^*]+)\*\*/.exec(r4) || [])[1] || null;

    var bad = [];
    // --- premise 1: both entries resolve by heading, and neither is empty
    if (!cEntry) bad.push('the C1–C4 entry does not resolve by heading in the register');
    if (!rEntry) bad.push('the R11 entry does not resolve by heading in the register');
    if (!sEntry) bad.push('the SB-METH-1 entry does not resolve by heading in the register');
    if (!C6) bad.push('C6 not found in the R8/R9 composition entry\'s amendment');
    if (!C7) bad.push('C7 not found in the R8/R9 composition entry\'s third amendment');
    if (!C8) bad.push('C8 not found in the R8/R9 composition entry\'s third amendment');
    if (!sbHead) bad.push('the school-board section\'s heading not found in the third amendment');
    if (!C11) bad.push('C11 not found in the R8/R9 composition entry\'s fifth amendment');
    if (!sgHead) bad.push('the small-gifts section\'s heading not found in the fifth amendment');
    [['C9', C9], ['C10', C10], ['S1', S1], ['S2', S2], ['the reworded heading', newHead], ['the heading it replaces', oldHead],
     ['the sentence C10 follows', c10After], ['the words S2 replaces', oldPending]].forEach(function (x) {
      if (!x[1]) bad.push(x[0] + ' not found in the R8/R9 composition entry\'s fourth amendment');
    });
    var C = {};
    if (cEntry) {
      [1, 2, 3, 4, 5].forEach(function (n) {
        var m = new RegExp('\\*\\*C' + n + '[^*]*\\*\\*\\s*`([^`]*)`').exec(cEntry);
        if (!m) { bad.push('C' + n + ' not found in the register entry'); return; }
        C[n] = m[1].replace(/\s+/g, ' ').trim();
      });
    }
    // --- premise 2: five strings extracted, none empty (an empty oracle passes vacuously)
    var SBC5 = null;
    if (sEntry) {
      var sm = /\*\*C5[^*]*\*\*\s*`([^`]*)`/.exec(sEntry);
      if (!sm) bad.push('SB C5 not found in the SB-METH-1 entry');
      else SBC5 = sm[1].replace(/\s+/g, ' ').trim();
      if (SBC5 === '') bad.push('SB C5 extracted empty');
    }
    if (Object.keys(C).length !== 5) bad.push('extracted ' + Object.keys(C).length + ' C-strings, expected 5');
    Object.keys(C).forEach(function (k) { if (!C[k]) bad.push('C' + k + ' extracted empty'); });

    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var recon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'reconciliation-report.json'), 'utf8'));
    var gaps = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'known-gaps.json'), 'utf8'));
    var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'];
    function fmtPulled(iso) {
      var p = String(iso || '').split('-');
      return (p.length === 3 && MON[+p[1] - 1]) ? (MON[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0]) : null;
    }
    var g = gaps.gaps, h = recon.headline, run = recon.run;
    var verify = { reconUrl: 'x', gapsUrl: 'y', pulled: fmtPulled(run.pulled),
      matchRate: h.dollar_weighted_match_pct, nCommittees: h.committees_with_sbe_id, nGaps: g.length,
      gapsNet: g.reduce(function (s, x) { return s + (x.amount || 0); }, 0),
      gapsGross: g.reduce(function (s, x) { return s + Math.abs(x.amount || 0); }, 0),
      gapsUnder: g.filter(function (x) { return (x.amount || 0) < 0; }).length,
      gapsOver: g.filter(function (x) { return (x.amount || 0) > 0; }).length,
      dataThrough: fmtPulled(run.data_through) };
    var idx = D.loadData(json, { office: 'city_council' });
    var sbIdx = D.loadData(json, { office: 'school_board' });
    // AUDIT-2 M2: C7's two figures, recounted HERE from the artifact's rows for one page: the sum
    // of the lines on the page's cards. Every card of every election the page offers (walked
    // through the view models) contributes its committee's rows that are filed as other receipts,
    // off the own-committee list, in an in-subject cycle and dated inside that election's
    // window. The page's own figures come from data.js's otherReceiptsOnPage; this does not
    // read them.
    var otherMemo = {};
    function otherFor(office) {
      if (otherMemo[office]) return otherMemo[office];
      var ix = office === 'school_board' ? sbIdx : idx, type = office === 'school_board' ? 'school_board' : 'municipal', ck = {}, a = 0, n = 0;
      Object.keys(json.committees || {}).forEach(function (k) { var cid = json.committees[k].candidate_id; if (cid) ck[cid] = k; });
      var others = (json.contributions || []).filter(function (c) {
        return c.cycle !== 'pre-2011' && c.cycle !== 'undated' && c.contribution_type === 'Other Receipt' && !c.is_own_committee;
      });
      D.selectorOptions(office).forEach(function (opt) {
        var w = (D.ELECTION_WINDOWS[type] || {})[opt.id];
        (D.viewModels.officeRaces(ix, office, opt.id).groups || []).forEach(function (g) { (g.races || []).forEach(function (r) {
          var rv = D.viewModels.raceView(ix, ix.raceBySlug[r.slug], null);
          ((rv && rv.candidates) || []).forEach(function (c) {
            if (!c.hasFinance) return;
            others.forEach(function (x) {
              if (x.committee_id !== ck[c.fundingId] || !w || !x.date) return;
              if ((w.start != null && x.date < w.start) || (w.end != null && x.date > w.end)) return;
              a += Math.round((x.amount || 0) * 100); n++;
            });
          });
        }); });
      });
      return (otherMemo[office] = { amount: a / 100, count: n });
    }
    function bindOther(s, office) {
      var o = otherFor(office);
      return s == null ? null : s.replace('{OTHER_AMOUNT}', R._moneyCents(o.amount)).replace('{OTHER_COUNT}', o.count.toLocaleString('en-US'));
    }

    // Bind the register's placeholders exactly as R9 and R11's Bindings paragraphs state.
    function bind(s) {
      return s.replace('{DUES_AMOUNT}', R._moneyCents(idx.duesExcluded.amount))
              .replace('{DUES_COUNT}', idx.duesExcluded.count.toLocaleString('en-US'))
              .replace('{DATA_THROUGH}', verify.dataThrough)
              .replace('{PULL_DATE}', verify.pulled);
    }
    function bindR11(s) {
      return s.replace('{PULLED}', verify.pulled)
              .replace('{MATCH_RATE}', String(verify.matchRate))
              .replace('{N_COMMITTEES}', String(verify.nCommittees))
              .replace('{N_GAPS}', String(verify.nGaps))
              .replace('{NET_TOTAL}', R._moneySigned(verify.gapsNet))
              .replace('{GROSS_TOTAL}', R._money(verify.gapsGross))
              .replace('{N_UNDER}', String(verify.gapsUnder))
              .replace('{N_OVER}', String(verify.gapsOver));
    }

    function paras(html) {
      var out = [], re = /<p>([\s\S]*?)<\/p>/g, m;
      while ((m = re.exec(html))) out.push(m[1].replace(/<[^>]+>/g, ''));
      return out;
    }
    function check(html) {
      var p = paras(html), fails = [];
      var want = [bind(C[1]), bind(C[2]), bind(C[5]), bind(C[3]), bind(C[4]), C6, bindOther(C7, 'city_council'), C8, C11, C9, C10];   // fifth amendment: C11 after C8   // M5 (R3): C6 after C4; M2: C7 and C8 after C6; AUDIT-2 (R4): C9 and C10 after C8
      // --- premise 3: the page rendered the ten C-paragraphs (C6 added at M5, C7 and C8 at M2, C9 and C10 at R4), the verification
      // paragraph, and the artifact-links paragraph (D3). The count is asserted, not assumed, because every
      // comparison below is positional: a page one paragraph short would otherwise compare C4
      // against the verification text and report a difference that is really a shape change.
      if (p.length !== 13) { fails.push('rendered ' + p.length + ' <p>, expected 13'); return fails; }
      want.forEach(function (w, i) {
        if (p[i] !== w) fails.push('C-paragraph ' + (i + 1) + ' differs from the register');
      });
      var r11 = rEntry.split('\n').filter(function (l) { return l.indexOf('Every data update') === 0; })[0];
      // R11's ruling text wraps; rebuild it from the block up to the Bindings paragraph.
      var block = rEntry.split('\n**Bindings**')[0].split('\n');
      var start = block.findIndex(function (l) { return l.indexOf('Every data update') === 0; });
      var sentence = block.slice(start).join(' ').replace(/\s+/g, ' ').trim();
      if (p[11] !== bindR11(sentence)) fails.push('the verify paragraph differs from the register');
      return fails;
    }

    var html = R.methodologyView(verify, 'city_council', idx.duesExcluded, D.otherReceiptsOnPage(idx));
    bad = bad.concat(check(html));

    // D3: the council branch's artifact-links paragraph is the school-board branch's, byte for
    // byte, for the same state. Premise first — both branches must actually emit one, or the
    // comparison is two absences agreeing.
    var LINKS = /<p>Both verification artifacts are public:[\s\S]*?<\/p>/;
    var sbHtml = R.methodologyView(verify, 'school_board', null, D.otherReceiptsOnPage(sbIdx));
    // R47: the school-board branch carries SB-METH-1's C5 as its own paragraph. Positional,
    // like the council side: the count is asserted before the index is read, so a page one
    // paragraph short reports a shape change and not a text difference.
    // AUDIT-2 M2: it also carries one section, the register's heading and then C7 and C8, directly
    // after the "Itemization follows the filings" paragraph (its fifth), with C7's two figures
    // bound for the school-board page.
    // AUDIT-2 (R4): seventeen <p>. C9 is the sixth, directly after the itemization paragraph and
    // directly before the section's heading (the M2 adjacency, as that amendment is amended); C10
    // is the end of the ninth, after the sentence the register names and one space; S1 is the
    // twelfth, the last <p> before the reworded heading; S2 is the end of the thirteenth, under
    // that heading. The heading it replaces and the words S2 replaces are on the page nowhere.
    function sbCheck(h) {
      var sp = paras(h), f = [];
      // Fifth amendment: eighteen <p>; C11 is the ninth, the one paragraph of its own section directly
      // after C8, so every later index moves by one.
      if (sp.length !== 18) { f.push('the school-board branch rendered ' + sp.length + ' <p>, expected 18'); return f; }
      if (sp[8] !== C11 || sgHead == null || h.indexOf('<p>' + C8 + '</p><h3>' + sgHead + '</h3><p>' + C11 + '</p><h3>') < 0)
        f.push('the small-gifts section is not directly after C8, under the register\'s heading, with C11 its one paragraph');
      if (SBC5 == null) f.push('SB C5 was not extracted, so the school-board paragraph cannot be compared');
      else if (sp[3] !== bind(SBC5)) f.push('the school-board C5 paragraph differs from the register');
      if (sp[6] !== bindOther(C7, 'school_board') || sp[7] !== C8) f.push('the school-board C7 or C8 differs from the register');
      if (sp[5] !== C9) f.push('the school-board C9 differs from the register');
      if (sbHead == null || h.indexOf('summarize away donors it does.</p><p>' + C9 + '</p><h3>' + sbHead + '</h3><p>' + bindOther(C7, 'school_board') + '</p><p>' + C8 + '</p><h3>') < 0) {
        f.push('the school-board section is not C9 directly after the itemization paragraph, then the register\'s heading, C7 and C8');
      }
      var tail10 = c10After + ' ' + C10;
      if (!c10After || !C10 || sp[9].slice(-tail10.length) !== tail10) f.push('the named-two-ways paragraph does not end with the register\'s sentence, one space and C10');
      if (sp[12] !== S1 || h.indexOf('<p>' + S1 + '</p><h3>' + newHead + '</h3><p>') < 0) f.push('S1 is not the last paragraph before the reworded heading, in the register\'s words');
      if (!newHead || h.split('<h3>' + newHead + '</h3>').length !== 2) f.push('the reworded heading is not rendered exactly once');
      if (!S2 || sp[13].slice(-(S2.length + 2)) !== '. ' + S2 || h.indexOf(S2 + '</p><h3>') < 0) f.push('the paragraph under the reworded heading does not end with S2');
      if (!oldHead || h.indexOf(oldHead) >= 0) f.push('the heading the register replaced is still rendered');
      if (!oldPending || h.indexOf(oldPending) >= 0) f.push('the sentence S2 replaced is still rendered');
      [C9, C10, S1, S2, C11].forEach(function (x, i) {
        if (x && h.split(x).length !== 2) f.push(['C9', 'C10', 'S1', 'S2', 'C11'][i] + ' is not rendered exactly once on the school-board branch');
      });
      return f;
    }
    bad = bad.concat(sbCheck(sbHtml));
    var cLinks = LINKS.exec(html), sLinks = LINKS.exec(sbHtml);
    if (!cLinks) bad.push('the council branch renders no artifact-links paragraph');
    if (!sLinks) bad.push('the school-board branch renders no artifact-links paragraph');
    if (cLinks && sLinks && cLinks[0] !== sLinks[0]) {
      bad.push('the council artifact-links paragraph differs from the school-board branch\'s');
    }
    T.ok('[METH/REGISTER] every rendered council methodology paragraph equals the register\'s ' +
      'ratified text — ' + (bad.length ? bad.join('; ')
        : '11 C-strings + R11 on the council branch; SB-METH-1\'s C5, C9, the section "' + sbHead +
          '" (C7, C8), the section "' + sgHead + '" (C11), C10, S1 and, under "' + newHead + '", S2 on the school-board branch; extracted by heading from RULINGS.md, ' +
          'character-identical, C7 bound per page to ' + R._moneyCents(otherFor('city_council').amount) + ' / ' +
          otherFor('city_council').count + ' and ' + R._moneyCents(otherFor('school_board').amount) + ' / ' +
          otherFor('school_board').count + '; the artifact-links paragraph byte-identical across the two branches'),
      bad.length === 0 && otherFor('city_council').count > 0 && otherFor('school_board').count > 0);

    // BITE AT BIRTH: a one-character edit to a C-string in the RENDER OUTPUT must fire. Applied to
    // an in-memory copy of the html only — no file is touched, so there is nothing to restore.
    var mutated = html.replace('city council elections.', 'city council election.');
    T.ok('[METH/REGISTER:bite] a one-character edit to a rendered C-string makes the check fire',
      mutated !== html && check(mutated).length > 0);

    // D3's bite, on the half the register cannot pin: a one-character edit to the council links
    // paragraph must break the sibling-branch comparison.
    var mutLinks = html.replace('Both verification artifacts are public',
                                'Both verification artifacts are publi');
    var mc = LINKS.exec(mutLinks);
    T.ok('[METH/REGISTER:bite] a one-character edit to the council artifact-links paragraph makes ' +
      'the sibling-branch comparison fire',
      mutLinks !== html && (!mc || (sLinks && mc[0] !== sLinks[0])));
    // Fifth amendment: the same bite on C11, on both branches.
    var mutC11c = C11 ? html.split(C11).join(C11.slice(0, -1)) : html;
    var mutC11s = C11 ? sbHtml.split(C11).join(C11.slice(0, -1)) : sbHtml;
    T.ok('[METH/REGISTER:bite] C11 with its last character removed makes the check fire, on the council branch and on the school-board branch',
      !!C11 && mutC11c !== html && check(mutC11c).length > 0 && mutC11s !== sbHtml && sbCheck(mutC11s).length > 0 && sbCheck(sbHtml).length === 0);
    // M5 (R3): the same bite on C6, the paragraph the amendment added.
    var mutC6 = html.replace('We mark only committees', 'We mark only committee');
    T.ok('[METH/REGISTER:bite] a one-character edit to the rendered C6 makes the check fire',
      mutC6 !== html && check(mutC6).length > 0);
    // AUDIT-2 M2: the same bite on C7 (a figure moved by one cent on the council branch) and on C8
    // (one character, on the school-board branch), and on the school-board heading.
    var c7fig = R._moneyCents(otherFor('city_council').amount);
    var mutC7 = html.replace(c7fig, R._moneyCents(otherFor('city_council').amount + 0.01));
    var mutC8 = sbHtml.replace('it is not a gift.', 'it is not a gift');
    var mutH = sbHead == null ? sbHtml : sbHtml.replace('<h3>' + sbHead + '</h3>', '<h3>' + sbHead + 's</h3>');
    T.ok('[METH/REGISTER:bite] C7 with its figure moved by one cent, C8 with one character removed on the school-board ' +
      'branch, and the school-board heading altered each make the check fire',
      mutC7 !== html && check(mutC7).length > 0 && mutC8 !== sbHtml && sbCheck(mutC8).length > 0 &&
      mutH !== sbHtml && sbCheck(mutH).length > 0 && sbCheck(sbHtml).length === 0);
    // AUDIT-2 (R4): one bite per string the amendment added, each one character, each on every
    // branch that carries it; then the reworded heading altered, the two things the register
    // removed put back, and C9 moved. `fires` requires the unmutated page to be clean and the
    // mutated one to report the named failure, so a bite cannot pass on some other difference.
    var cut = function (h, x) { return x ? h.split(x).join(x.slice(0, -1)) : h; };
    var fires = function (fn, h0, h1, re) {
      return h1 !== h0 && fn(h0).length === 0 && fn(h1).some(function (x) { return re.test(x); });
    };
    T.ok('[METH/REGISTER:bite] C9 with its last character removed makes the check fire, on the council branch and on the school-board branch',
      fires(check, html, cut(html, C9), /C-paragraph 10 /) && fires(sbCheck, sbHtml, cut(sbHtml, C9), /C9 differs/));   // fifth amendment: C11 before C9
    T.ok('[METH/REGISTER:bite] C10 with its last character removed makes the check fire, on the council branch and on the school-board branch',
      fires(check, html, cut(html, C10), /C-paragraph 11 /) && fires(sbCheck, sbHtml, cut(sbHtml, C10), /one space and C10/));
    T.ok('[METH/REGISTER:bite] S1 with its last character removed makes the school-board check fire',
      fires(sbCheck, sbHtml, cut(sbHtml, S1), /S1 is not the last paragraph/));
    T.ok('[METH/REGISTER:bite] S2 with its last character removed makes the school-board check fire',
      fires(sbCheck, sbHtml, cut(sbHtml, S2), /does not end with S2/));
    T.ok('[METH/REGISTER:bite] the reworded heading altered, the heading it replaced put back, the sentence S2 replaced put ' +
      'back, and C9 moved below the section\'s heading each make the school-board check fire',
      !!newHead && !!oldHead && !!oldPending && !!sbHead &&
      fires(sbCheck, sbHtml, sbHtml.replace('<h3>' + newHead + '</h3>', '<h3>' + newHead + 's</h3>'), /reworded heading is not rendered exactly once/) &&
      fires(sbCheck, sbHtml, sbHtml.replace(/<\/div>$/, '<h3>' + oldHead + '</h3></div>'), /heading the register replaced is still rendered/) &&
      fires(sbCheck, sbHtml, sbHtml.replace('<h3>What it covers</h3><p>', '<h3>What it covers</h3><p>' + oldPending + ' '), /sentence S2 replaced is still rendered/) &&
      fires(sbCheck, sbHtml, sbHtml.replace('<p>' + C9 + '</p><h3>' + sbHead + '</h3>', '<h3>' + sbHead + '</h3><p>' + C9 + '</p>'), /C9 directly after the itemization paragraph/));
    // [METH/CREDIT] PS-162 (rulings 143a to 148a): the design credit. Register-derived, like the
    // check above: the sentence is the quoted line of PS-162's entry, extracted by heading, its
    // quotation marks taken off. It must be the LAST paragraph of the methodology on both offices'
    // branches (directly before the frame's closing </div>), carry the class that keeps it out of the
    // positional <p> counts above, and occur exactly once on each branch. A credit paragraph that is
    // not a plain <p> is invisible to paras(), so these counts stay 13 and 18 by construction.
    var pEntry = (function () {
      for (var q = 0; q < reg.length; q++) if (/^### PS-\d+ — each tool's methodology ends with who designed and built it$/.test(reg[q])) return entry(reg[q]);
      return null;
    })();
    var CREDIT = pEntry ? ((/^"(Designed [^"]+)"$/m.exec(pEntry) || [])[1] || null) : null;
    function creditCheck(h, label) {
      var f = [];
      if (!CREDIT) { f.push('the credit sentence not found in the register\'s PS-162 entry'); return f; }
      var want = '<p class="meth-credit">' + CREDIT + '</p></div>';
      if (h.slice(-want.length) !== want) f.push('the ' + label + ' methodology does not end with the register\'s credit paragraph');
      if (h.split(CREDIT).length !== 2) f.push('the credit is not rendered exactly once on the ' + label + ' branch');
      return f;
    }
    var credBad = creditCheck(html, 'council').concat(creditCheck(sbHtml, 'school-board'));
    T.ok('[METH/CREDIT] each office\'s methodology ends with PS-162\'s sentence, extracted by heading from RULINGS.md, ' +
      'character-identical, once, as the last paragraph — ' + (credBad.length ? credBad.join('; ') : JSON.stringify(CREDIT)),
      credBad.length === 0);
    var credMoved = CREDIT ? sbHtml.replace('<p class="meth-credit">' + CREDIT + '</p></div>', '</div>')
      .replace('<h3>Correlation, not causation</h3>', '<p class="meth-credit">' + CREDIT + '</p><h3>Correlation, not causation</h3>') : sbHtml;
    T.ok('[METH/CREDIT:bite] the credit with its last character removed makes the check fire on both branches, and the credit moved above the school-board branch\'s last section makes it fire there',
      !!CREDIT && creditCheck(html, 'council').length === 0 && creditCheck(sbHtml, 'school-board').length === 0 &&
      creditCheck(cut(html, CREDIT), 'council').some(function (x) { return /does not end with/.test(x); }) &&
      creditCheck(cut(sbHtml, CREDIT), 'school-board').some(function (x) { return /does not end with/.test(x); }) &&
      credMoved !== sbHtml && credMoved.split(CREDIT).length === 2 &&
      creditCheck(credMoved, 'school-board').some(function (x) { return /does not end with/.test(x); }));
  })();

  // [SG/*] — PS-161 (rulings 74a, 76b as amended, 82a, 83a, 84a as amended): small gifts on the elections
  // tool. PS-128 mode A with a restated oracle: each card's small gifts are recounted HERE from the
  // committee field `unitemized_periods` by the period END in the race's window (82a), never read from
  // data.js; Raised is the card's itemized figure plus that recount; the comparison is the race's own
  // live candidates, by dollars, largest first. The bite constructs one report and moves Raised by it.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var NOTE = 'Gifts of $150 or less in a reporting period, which Illinois reports as one total, not by donor.';
    var ck = {}; Object.keys(json.committees || {}).forEach(function (k) { var cid = json.committees[k].candidate_id; if (cid) ck[cid] = k; });
    var EXCL = { 'pre-2011': 1, undated: 1 }, cyc = json.cycles || {};
    function cycleOf(d) { var e = null; for (var c in cyc) { var y = cyc[c] || {}; if (y.start && (e === null || y.start < e)) e = y.start;
      if ((y.start == null || d >= y.start) && (y.end == null || d <= y.end)) return c; } return (e !== null && d < e) ? 'pre-2011' : 'undated'; }
    function oracle(fid, w) {
      var cm = (json.committees || {})[ck[fid]] || {}, s = 0;
      (cm.unitemized_periods || []).forEach(function (p) {
        if (EXCL[cycleOf(p.end)] || !w || p.end < w.start || p.end > w.end) return;
        s += Math.round(Number(p.amount || 0) * 100);
      });
      return s / 100;
    }
    var bad = [], cards = 0, withSg = 0, cmpRaces = 0, noCmpRaces = 0, cmpBad = [];
    [['city_council', 'municipal'], ['school_board', 'school_board'], ['mayor', 'municipal']].forEach(function (o) {
      var ix = D.loadData(json, { office: o[0] });
      D.selectorOptions(o[0]).forEach(function (opt) {
        var w = (D.ELECTION_WINDOWS[o[1]] || {})[opt.id];
        (D.viewModels.officeRaces(ix, o[0], opt.id).groups || []).forEach(function (g) { (g.races || []).forEach(function (r) {
          var rv = D.viewModels.raceView(ix, ix.raceBySlug[r.slug], null); if (!rv) return;
          var live = (rv.candidates || []).filter(function (c) { return c.hasFinance; });
          var html = R.renderRaceView(rv);
          var arts = html.match(/<article class="card" id="cand-[^"]*">[\s\S]*?<\/article>/g) || [];   // live cards, in the view model's order
          live.forEach(function (c, li) {
            cards++;
            var f = c.figures, want = oracle(c.fundingId, rv.win);
            if (Math.abs((f.smallGifts.total || 0) - want) > 0.005) bad.push(o[0] + ' ' + c.id + ': small gifts ' + f.smallGifts.total + ' vs recount ' + want);
            if (Math.abs(f.raised - (f.contributions.total + want)) > 0.005) bad.push(o[0] + ' ' + c.id + ': raised is not itemized + small gifts');
            if (want > 0) withSg++;
            var card = arts[li] || '';
            if (card.indexOf('<p class="smallgifts">') < 0 || card.indexOf(NOTE) < 0 || card.indexOf('<span class="sg-v">' + R._money(want) + '</span>') < 0)
              bad.push(o[0] + ' ' + c.id + ': the card does not carry the small-gifts tile with its figure and note');
            var barWant = f.raised > 0 ? '<div class="barval">' + R._money(f.raised) : '<div class="barval"><span class="zero">none reported</span>';
            if (card.indexOf(barWant) < 0) bad.push(o[0] + ' ' + c.id + ': the contributors bar does not read Raised');
          });
          var cmp = (/<section class="sg-compare"[\s\S]*?<\/section>/.exec(html) || [])[0];
          var anySg = live.some(function (c) { return oracle(c.fundingId, rv.win) > 0; });
          var people = {}; live.forEach(function (c) { people[c.slug] = 1; });
          if (Object.keys(people).length >= 2 && anySg) {
            cmpRaces++;
            if (!cmp) { cmpBad.push(r.slug + ' has no comparison'); return; }
            var names = (cmp.match(/<span class="sg-name">([^<]*)<\/span>/g) || []).map(function (x) { return x.replace(/<[^>]+>/g, ''); });
            var amts = (cmp.match(/<span class="sg-amt">\$([\d,]+)<\/span>/g) || []).map(function (x) { return +x.replace(/[^\d]/g, ''); });
            var seenP = {}, wantNames = live.filter(function (c) { if (seenP[c.slug]) return false; seenP[c.slug] = 1; return true; })
              .map(function (c) { return R._esc(c.name); }).sort();   // one row per person, as rendered (escaped)
            if (JSON.stringify(names.slice().sort()) !== JSON.stringify(wantNames)) cmpBad.push(r.slug + ': the comparison is not exactly the race\'s candidates');
            if (amts.some(function (a, i) { return i > 0 && a > amts[i - 1]; })) cmpBad.push(r.slug + ': not largest first');
            if (/%/.test(cmp.replace(NOTE, '').replace(/width:[\d.e+-]+%/g, ''))) cmpBad.push(r.slug + ': the comparison prints a share');
          } else {
            noCmpRaces++;
            if (cmp) cmpBad.push(r.slug + ' renders a comparison with fewer than two candidates or no small gifts');
          }
        }); });
      });
    });
    T.ok('[SG/CARD] every live card carries the small-gifts tile with its recounted figure and the ruled note, and its contributors bar reads Raised = itemized + small gifts (82a by period end) — ' +
      (bad.length ? bad.slice(0, 4).join('; ') : cards + ' cards, ' + withSg + ' with small gifts'), bad.length === 0 && withSg > 0);
    T.ok('[SG/COMPARE] a race with two or more live candidates and any small gifts carries one comparison of exactly its own candidates, by dollars, largest first, with no share; no other race carries one — ' +
      (cmpBad.length ? cmpBad.slice(0, 4).join('; ') : cmpRaces + ' races compared, ' + noCmpRaces + ' without'), cmpBad.length === 0 && cmpRaces > 0);
    // Bite: one constructed $1,234 report on one live card's committee, dated inside its window.
    var ixb = D.loadData(json, { office: 'city_council' }), w27 = D.ELECTION_WINDOWS.municipal['2027'];
    var rvb = D.viewModels.raceView(ixb, ixb.raceBySlug['ward-48'], null), cb = (rvb.candidates || []).filter(function (c) { return c.hasFinance; })[0];
    var jb = JSON.parse(JSON.stringify(json)), kb = ck[cb.fundingId];
    jb.committees[kb].unitemized_periods = (jb.committees[kb].unitemized_periods || []).concat([{ beg: '2026-07-01', end: '2026-09-30', amount: 1234, d2_doc: 'gate' }]);
    var rvb2 = D.viewModels.raceView(D.loadData(jb, { office: 'city_council' }), ixb.raceBySlug['ward-48'], null);
    var cb2 = rvb2.candidates.filter(function (c) { return c.id === cb.id; })[0];
    T.ok('[SG/BITE] a constructed $1,234 report moves the card\'s Raised and small gifts by exactly $1,234 and leaves its itemized figure and contributor lines alone',
      Math.abs(cb2.figures.raised - cb.figures.raised - 1234) < 0.005 && Math.abs(cb2.figures.smallGifts.total - cb.figures.smallGifts.total - 1234) < 0.005 &&
      cb2.figures.contributions.total === cb.figures.contributions.total && cb2.contributors.lines.length === cb.contributors.lines.length);
  })();

  // [OWN/FIGURES] + [OWN/RENDER] — M5 (PS-142, PS-143).
  // PS-128 modes. [OWN/FIGURES] is mode A: the live artifact, with the oracle recounted HERE
  // from each card's own rows by their stamps (the committee the card reads, the race's window,
  // the excluded cycles, the dues type and, since M2, the other receipts are restated below, not
  // taken from candidateFigures).
  // [OWN/RENDER] is mode E: a constructed axis. It stamps rows in in-memory copies of the live
  // artifact, so each ratified form renders whatever the live data holds that day; the three
  // ratified strings are stated here and their source is the register (PS-142).
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
    var TYPE = { city_council: 'municipal', mayor: 'municipal', school_board: 'school_board' };
    var DUES = 'IE Committee Dues Transfer', EXCL = { 'pre-2011': 1, 'undated': 1 };
    function inWin(c, win) {
      return !!c.date && (win.start == null || c.date >= win.start) && (win.end == null || c.date <= win.end);
    }
    function cents(a, b) { return Math.abs(a - b) <= 0.011; }
    function eachCard(doc, fn) {
      ['city_council', 'school_board', 'mayor'].forEach(function (office) {
        var idx = D.loadData(doc, { office: office });
        D.selectorOptions(office).forEach(function (opt) {
          var win = (D.ELECTION_WINDOWS[TYPE[office]] || {})[opt.id];
          var om = D.viewModels.officeRaces(idx, office, opt.id);
          (om.groups || []).forEach(function (g) { (g.races || []).forEach(function (r) {
            var rv = D.viewModels.raceView(idx, idx.raceBySlug[r.slug], null);
            ((rv && rv.candidates) || []).forEach(function (c) {
              if (c.hasFinance) fn({ office: office, sel: opt.id, win: win, idx: idx, race: r, c: c });
            });
          }); });
        });
      });
    }
    function rowsOf(x) {
      return (x.idx.directByCandidate[x.c.fundingId] || []).filter(function (c) {
        return !EXCL[c.cycle] && c.contribution_type !== DUES && !(c.contribution_type === 'Other Receipt' && !c.is_own_committee) && x.win && inWin(c, x.win);   // M2
      });
    }
    function measure(doc) {
      var out = { cards: 0, bad: [], withOwn: 0, stamped: 0, raised: {}, ownOther: {} };
      (doc.contributions || []).forEach(function (c) { if (c.is_own_committee) out.stamped++; });
      eachCard(doc, function (x) {
        out.cards++;
        var f = x.c.figures.contributions, tot = 0, self = 0, own = 0, rows = rowsOf(x);
        rows.forEach(function (c) {
          var a = c.amount || 0; tot += a;
          if (c.is_self) self += a; else if (c.is_own_committee) own += a;
          // M2: a listed pair's row filed as an other receipt is counted only because it is stamped
          if (c.is_own_committee && c.contribution_type === 'Other Receipt') out.ownOther[x.office + '|' + x.sel + '|' + x.c.id] = (out.ownOther[x.office + '|' + x.sel + '|' + x.c.id] || 0) + a;
        });
        out.raised[x.office + '|' + x.sel + '|' + x.c.id] = f.total;
        if (!cents(tot, f.total) || !cents(self, f.selfFunded) || !cents(own, f.ownCommittee) ||
            !cents(tot - self - own, f.thirdParty) || rows.length !== f.count) out.bad.push(x.c.id);
        if (f.ownCommittee > 0) out.withOwn++;
      });
      return out;
    }
    var m = measure(json);
    T.ok('[OWN/FIGURES] every card\'s raised, own-money, other-committee and other-donor figures equal a recount of its own ' +
      'rows by their stamps — ' + m.cards + ' cards, ' + m.withOwn + ' with other-committee money, ' + m.stamped +
      ' stamped rows' + (m.bad.length ? '; DIFFERING: ' + m.bad.slice(0, 4).join(',') : ''),
      m.cards > 0 && m.stamped > 0 && m.bad.length === 0);
    // BITE: strip the stamp from every row of an in-memory copy. No card may then show
    // other-committee money. Since M2 a card's raised figure is the one it had LESS the listed
    // pairs' rows it holds that were filed as other receipts: PS-142 keeps those counted "as
    // filed" because they are stamped, and with the stamp gone they are other receipts like any
    // other. Every other card's raised figure must be unmoved.
    var stripped = JSON.parse(JSON.stringify(json));
    stripped.contributions.forEach(function (c) { delete c.is_own_committee; });
    var ms = measure(stripped);
    var ownOtherCards = Object.keys(m.ownOther).length, raisedOff = Object.keys(m.raised).filter(function (k) {
      return !cents(ms.raised[k], m.raised[k] - (m.ownOther[k] || 0));
    });
    T.ok('[OWN/FIGURES:bite] with the stamps stripped no card shows other-committee money, and every raised figure is ' +
      'unmoved but for the listed pairs\' rows filed as other receipts, which then leave it — ' + ownOtherCards +
      ' card(s) hold such rows' + (raisedOff.length ? '; OFF: ' + raisedOff.slice(0, 4).join(',') : ''),
      m.stamped > 0 && ms.stamped === 0 && ms.withOwn === 0 && ms.bad.length === 0 &&
      Object.keys(ms.raised).length === Object.keys(m.raised).length && raisedOff.length === 0);

    // The constructed axis: the first council card holding in-window rows from two different
    // donor lines. Row A becomes the candidate's own money, row B an other-committee transfer.
    var host = null;
    eachCard(stripped, function (x) {
      if (host || x.office !== 'city_council') return;
      var rows = rowsOf(x).slice().sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
      var pidOf = function (c) { return (x.idx.donors[c.donor_id] || {}).parent_id || c.donor_id; };
      for (var i = 1; i < rows.length; i++) {
        if (pidOf(rows[i]) !== pidOf(rows[0])) { host = { race: x.race.slug, slug: x.c.slug, a: rows[0].id, b: rows[i].id, bParent: pidOf(rows[i]), win: x.win, sel: x.sel }; break; }
      }
    });
    var probs = [];
    function variant(selfId, ownId) {
      var doc = JSON.parse(JSON.stringify(stripped));
      doc.contributions.forEach(function (c) {
        if (c.id === host.a || c.id === host.b) delete c.is_self;
        if (selfId && c.id === selfId) c.is_self = true;
        if (ownId && c.id === ownId) c.is_own_committee = true;
      });
      var idx = D.loadData(doc, { office: 'city_council' });
      var page = R.renderRaceView(D.viewModels.raceView(idx, idx.raceBySlug[host.race], null));
      var card = (page.split('<article class="card" id="cand-' + host.slug + '">')[1] || '').split('</article>')[0];
      return { idx: idx, page: page, card: card,
               sentence: ((/<p class="selfline">(.*?)<\/p>/.exec(card) || [])[1] || '').replace(/<[^>]+>/g, '') };
    }
    var FROM = 'From the candidate’s other committee', GIVER = 'Candidate’s other committee',
        ROW = 'candidate’s other committee';
    if (!host) probs.push('premise: no council card holds in-window rows from two donor lines');
    else {
      var both = variant(host.a, host.b), only = variant(null, host.b), none = variant(null, null);
      if (!/^\$[\d,]+ is the candidate’s own money or loans · \$[\d,]+ from the candidate’s other committee · \$[\d,]+ from other donors$/.test(both.sentence)) probs.push('three-part sentence reads: ' + both.sentence);
      if (!/class="seg third"[^>]*><\/div><div class="seg owncmte"[^>]*><\/div><div class="seg self"/.test(both.card)) probs.push('the bar is not other donors, other committee, own money in that order');
      if (both.card.indexOf('<span class="tagchip owncmte">' + FROM + '</span>') < 0) probs.push('the giver line carries no chip');
      if (both.page.indexOf('<i class="sw owncmte"></i>' + FROM + '</span>') < 0) probs.push('the legend carries no other-committee swatch');
      if (!/^\$[\d,]+ is from the candidate’s other committee · \$[\d,]+ from other donors$/.test(only.sentence)) probs.push('two-part sentence reads: ' + only.sentence);
      if (none.sentence !== '' || none.page.indexOf('owncmte"') >= 0 || none.page.indexOf(FROM) >= 0) probs.push('a race view with no such money still shows the sentence, a segment, a chip or the swatch');
      var browse = R.renderSpend(D.spendSubtab(only.idx, 'city_council', 'donors', null, host.sel), 'city_council');
      if (browse.indexOf('<span class="tagchip owncmte">' + GIVER + '</span>') < 0) probs.push('the browse row of the giver carries no chip');
      var browse0 = R.renderSpend(D.spendSubtab(none.idx, 'city_council', 'donors', null, host.sel), 'city_council');
      if (browse0.indexOf(GIVER) >= 0) probs.push('a browse row carries the chip with no stamped row');
      var modal = R.renderFunderModal(D.donorFootprint(only.idx, host.bParent, host.win));
      if ((modal.split('<span class="ichip owncmte">' + ROW + '</span>').length - 1) !== 1) probs.push('the donor profile does not mark exactly the one stamped row');
    }
    T.ok('[OWN/RENDER] the three ratified strings render where PS-142 puts them — the three-part and two-part card ' +
      'sentence, the bar order, the giver chip, the conditional legend swatch, the browse chip and the profile row chip — ' +
      (probs.length ? probs.join('; ') : 'constructed on ' + host.slug), probs.length === 0);
  })();

  // [AV/SELF] the all-votes un-feature fixture (HYGIENE-1, open ledger 76 / row 58). PS-128 mode B:
  // a constructed artifact with the ingest layer patched in memory, so no Sheet and no Datasette.
  // It un-features one of two votes and asserts the code is pruned from every alder by
  // apply_featured and by sync_bios.merge_bios, with a bite proving the prune is what removes it.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'sync_allvotes.py'), '--self-test'], { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[AV/SELF] all-votes un-feature self-test green — ' + tail, res.status === 0);
  })();

  // [COH/SELF] the cash-on-hand step's self-test (COH-1). PS-128 mode B over synthetic SBE
  // exports: the latest D-2 period wins, its final amendment wins, a committee with no D-2 gets
  // no figure, and the step refuses when a final report has no D2Totals row.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'apply_cash_on_hand.py'), '--self-test'],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[COH/SELF] cash-on-hand self-test green — ' + tail, res.status === 0);
  })();

  // [M1/*] AUDIT-2 M1 — the elections tool's donor list: three filed figures per row, and an
  // outside-spending group's funders counted only where the group spent on the page's races inside
  // the selected election's window.
  //
  // PS-128 DERIVATION MODES. [M1/SPLIT] and [M1/POPUP] are **A (live-only)**: both sides come from
  // the artifact, and what is asserted is an agreement between two readers of it, not a pinned
  // figure. [M1/SPLIT]'s recount is this block's own code over each donor's raw rows: it calls
  // neither recipInScope nor ieActiveForOffice, the two functions under test. It does borrow from
  // the code under test the index (parentRollup, iesBySpender, which is already office-scoped),
  // the window, EXCLUDED_CYCLES and OFFICE_RACE_OFFICES, so the office half of the scope test is
  // NOT recounted here; [RENDER/B2] and [COUNCIL/DONOR] are what read it. [M1/POPUP] has no
  // recount: it compares two readers, donorFootprint and browseDonors. [M1/SCOPE] is **E (live
  // host, constructed axis)**: a real committee and its real funders, its own in-window spending
  // rows removed from an in-memory copy, with one constructed spending row whose date is the only
  // thing that moves. [M1/RENDER] reads the rendered list against the view model it was rendered
  // from. [M1/REGISTER] is **register-derived**, as [METH/REGISTER] is.
  //
  // WHY IT EXISTS: the numbers audit (finding M1) measured $9,193,017.72 of funders' money ranked
  // on /city-council against $0.00 its outside-spending groups had spent there in the window, with
  // one undivided figure per row and a pop-up that listed gifts the row left out. Nothing in this
  // gate read the scope test, the split, or the agreement of the row with its pop-up.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8');
    var json = JSON.parse(raw);
    var LISTS = [['school_board', '2026'], ['school_board', '2024'], ['city_council', '2027']];
    var DUES = 'IE Committee Dues Transfer';
    var cents = function (x) { return Math.round((x || 0) * 100); };
    var usd = function (c) { return '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    var inWin = function (d, w) { return !!d && (w.start == null || d >= w.start) && (w.end == null || d <= w.end); };

    // One list, measured: the view model's rows beside this block's own recount of every donor.
    function measure(doc, office, sel) {
      var idx = D.loadData(doc, { office: office });
      var vm = D.spendSubtab(idx, office, 'donors', null, sel), win = vm.win;
      var offs = D.OFFICE_RACE_OFFICES[office] || [];   // the race offices this page covers
      var spentInWin = {};   // IE committee -> it has a spending row on this office dated inside the window
      Object.keys(idx.iesBySpender).forEach(function (k) {
        spentInWin[k] = idx.iesBySpender[k].some(function (ie) { return inWin(ie.date, win); });
      });
      var recount = {}, giftsTo = {}, giversTo = {};
      Object.keys(idx.parentRollup).forEach(function (pid) {
        var direct = 0, via = 0;
        idx.parentRollup[pid].rows.forEach(function (c) {
          if (c.contribution_type === DUES || (c.contribution_type === 'Other Receipt' && !c.is_own_committee) || D.EXCLUDED_CYCLES[c.cycle] || !inWin(c.date, win)) return;   // M2
          var cm = idx.committees[c.committee_id] || {}, a = cents(c.amount);
          if (cm.candidate_id) {
            var race = idx.raceById[(idx.candidateById[cm.candidate_id] || {}).race_id] || {};
            if (offs.indexOf(race.office) >= 0) direct += a;
          } else if (cm.type === 'independent_expenditure') {
            giftsTo[c.committee_id] = (giftsTo[c.committee_id] || 0) + a;
            (giversTo[c.committee_id] || (giversTo[c.committee_id] = {}))[pid] = 1;
            if (spentInWin[c.committee_id]) via += a;
          }
        });
        if (direct + via > 0) recount[pid] = { direct: direct, via: via };
      });
      var out = { idx: idx, vm: vm, win: win, offs: offs, n: 0, direct: 0, via: 0, total: 0, withVia: 0,
                  bad: [], giftsTo: giftsTo, giversTo: giversTo, spentInWin: spentInWin, donors: [], unordered: 0 };
      for (var q = 1; q < vm.rows.length; q++) if (cents(vm.rows[q].total) > cents(vm.rows[q - 1].total)) out.unordered++;
      vm.rows.forEach(function (r) {
        if (r.kind === 'ie') return;
        out.n++; out.donors.push(r);
        var d = cents(r.direct), v = cents(r.independent), t = cents(r.total), rc = recount[r.parent_id];
        out.direct += d; out.via += v; out.total += t; if (v > 0) out.withVia++;
        if (d + v !== t || !rc || rc.direct !== d || rc.via !== v) out.bad.push(r.parent_id);
      });
      Object.keys(recount).forEach(function (pid) {     // a donor the recount finds and the list omits
        if (!out.donors.some(function (r) { return r.parent_id === pid; })) out.bad.push('absent:' + pid);
      });
      return out;
    }

    // The pop-up a row opens is donorFootprint at the row's window. Its groups span every office
    // and its own total spans them too (DESIGN-1c (ii)), so the comparison is by part: its
    // candidates in this page's races against the row's first figure, its outside-spending groups
    // against the second. A donor with no row must have a pop-up with neither part.
    function popupDiffers(m, pid) {
      var r = m.donors.filter(function (x) { return x.parent_id === pid; })[0] || { direct: 0, independent: 0 };
      var fp = D.donorFootprint(m.idx, pid, m.win), dir = 0, ie = 0;
      (fp.committees || []).forEach(function (c) {
        if (c.kind === 'ie') ie += cents(c.total);
        else if (c.kind === 'candidate' && m.offs.indexOf(c.office) >= 0) dir += cents(c.total);
      });
      return { differs: dir !== cents(r.direct) || ie !== cents(r.independent), ie: ie };
    }

    var base = LISTS.map(function (l) { return measure(json, l[0], l[1]); });
    var line = base.map(function (m, i) {
      return LISTS[i][0] + ' ' + LISTS[i][1] + ': ' + m.n + ' rows, ' + usd(m.direct) + ' + ' + usd(m.via) + ' = ' + usd(m.total);
    }).join('; ');
    var bad = base.reduce(function (a, m) { return a.concat(m.bad); }, []);
    var unordered = base.reduce(function (a, m) { return a + m.unordered; }, 0);
    // PREMISE FIRST (PS-128 (i)): every list has rows, and the split is exercised on both sides.
    var premise = base.every(function (m) { return m.n > 0 && m.direct > 0; }) &&
      base.some(function (m) { return m.withVia > 0; });
    T.ok('[M1/SPLIT] every Browse donors row carries what the donor gave candidates in these races and what it gave ' +
      'outside-spending groups in scope, the two sum to its total, each equals a recount of the donor\'s own rows, and ' +
      'the list is ranked by total — ' + line + (bad.length ? '; DIFFERING: ' + bad.slice(0, 4).join(',') : '') +
      (unordered ? '; ' + unordered + ' rows out of order' : ''), premise && bad.length === 0 && unordered === 0);

    // [M1/SCOPE] On each page: a real committee that has spent on the page's races and has funders
    // inside the selected window. In an in-memory copy its own spending rows dated inside the
    // window are removed, so its funders must not count; one constructed spending row is then
    // dated at four places around the window's two edges, in each stance. Removing the rows is
    // what keeps this check standing when the committee later reports spending in the window.
    function addDays(iso, n) { var t = new Date(iso + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
    var scopeProbs = [], scopeNote = [];
    [['school_board', '2026'], ['city_council', '2027']].forEach(function (l) {
      var tag = l[0] + ' ' + l[1], live = measure(json, l[0], l[1]), win = live.win;
      var cands = Object.keys(live.idx.iesBySpender).sort().filter(function (k) {
        return live.idx.iesBySpender[k].length > 0 && (live.giftsTo[k] || 0) > 0;
      });
      // prefer a committee whose funders do not count as the data stands; otherwise strip one that does
      var host = cands.filter(function (k) { return !live.spentInWin[k]; })[0] || cands[0];
      if (!host) { scopeProbs.push(tag + ': no outside-spending group on this page has funders inside the window (the premise)'); return; }
      var G = live.giftsTo[host], seed = live.idx.iesBySpender[host][0], givers = Object.keys(live.giversTo[host]);
      var build = function (date, stance) {
        var doc = JSON.parse(raw);
        doc.independent_expenditures = doc.independent_expenditures.filter(function (ie) {
          return !(ie.spender_committee_id === host && inWin(ie.date, win));
        });
        if (date) {
          var row = JSON.parse(JSON.stringify(seed));
          row.id = seed.id + '-m1'; row.date = date; row.amount = 1; row.stance = stance;
          doc.independent_expenditures.push(row);
        }
        var m = measure(doc, l[0], l[1]);
        if (m.bad.length) scopeProbs.push(tag + ' ' + (date || 'stripped') + ': the split differs on ' + m.bad[0]);
        var pop = givers.filter(function (pid) { return popupDiffers(m, pid).differs; });
        if (pop.length) scopeProbs.push(tag + ' ' + (date || 'stripped') + ': the pop-up differs from the row on ' + pop[0]);
        return m.total;
      };
      var T0 = build(null);
      if (!live.spentInWin[host] && T0 !== live.total) scopeProbs.push(tag + ': removing nothing moved the total');
      [['the day before the window', addDays(win.start, -1), 0], ['the window\'s first day', win.start, G],
       ['the window\'s last day', win.end, G], ['the day after the window', addDays(win.end, 1), 0]].forEach(function (c) {
        ['support', 'oppose'].forEach(function (stance) {
          var got = build(c[1], stance) - T0;
          if (got !== c[2]) scopeProbs.push(tag + ': ' + stance + ' spending dated ' + c[0] + ' adds ' + usd(got) + ', not ' + usd(c[2]));
        });
      });
      scopeNote.push(tag + ' on ' + host + ' (' + usd(G) + ' from ' + givers.length + ' funders)');
    });
    T.ok('[M1/SCOPE] an outside-spending group\'s funders count on a page only where the group spent on that page\'s races ' +
      'inside the selected election\'s window: not counted with no spending in the window, nor with spending dated a day ' +
      'outside either edge; counted in full with spending dated on either edge, for or against; and the funders\' pop-ups ' +
      'agree with their rows in every case — ' +
      (scopeProbs.length ? scopeProbs.slice(0, 4).join('; ') : scopeNote.join('; ')), scopeProbs.length === 0 && scopeNote.length === 2);

    // [M1/POPUP] Every donor row of the three lists against the pop-up it opens (popupDiffers).
    var popProbs = [], popRows = 0, popVia = 0;
    base.forEach(function (m, i) {
      m.donors.forEach(function (r) {
        var p = popupDiffers(m, r.parent_id);
        popRows++; if (p.ie > 0) popVia++;
        if (p.differs) popProbs.push(LISTS[i].join(' ') + ':' + r.parent_id);
      });
    });
    T.ok('[M1/POPUP] a donor\'s row and the pop-up it opens count the same money, part by part: the pop-up\'s candidates in ' +
      'these races equal the row\'s first figure and its outside-spending groups equal the second — ' + popRows +
      ' rows on three lists, ' + popVia + ' with outside-spending groups' +
      (popProbs.length ? '; DIFFERING: ' + popProbs.slice(0, 4).join(',') : ''),
      popRows > 0 && popVia > 0 && popProbs.length === 0);

    // [M1/RENDER] The rendered list against the view model it was rendered from, and the pop-up's
    // note with and without an election window.
    var rat = R._ratified || {}, COLS = rat.browseCols || [], DISC = rat.browseDisclose || '';
    var IN_ELECTION = rat.footprintScopeElection || '', IN_OFFICE = rat.footprintScopeOffice || '';
    var money0 = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    var count = function (hay, needle) { return needle ? hay.split(needle).length - 1 : -1; };
    var rProbs = [], rRows = 0, rIE = 0;
    var head = '<div class="browse-colhead"><div>Donor</div><div class="amt3">' +
      COLS.map(function (c) { return '<div>' + c + '</div>'; }).join('') + '</div></div>';
    var disc = '<p class="contrib-note browse-disclose">' + DISC + '</p>';
    base.forEach(function (m, i) {
      var tag = LISTS[i].join(' '), html = R.renderSpend(m.vm, LISTS[i][0]);
      if (COLS.length !== 3 || count(html, head) !== 1) rProbs.push(tag + ': the head row is not rendered exactly once');
      if (count(html, disc) !== 1 || html.indexOf(disc + head) < 0) rProbs.push(tag + ': the disclosure line is not rendered once, directly above the head row');
      var cell = function (k, v, cls) { return '<div class="v' + (cls ? ' ' + cls : '') + '"><span class="lab">' + COLS[k] + '</span>' + money0(v) + '</div>'; };
      m.vm.rows.forEach(function (r) {   // every row, those behind "show more" included: all are in the markup
        var open = r.kind === 'ie' ? 'data-committee="' + r.committee_id + '">' : 'data-funder="' + r.parent_id + '">';
        var at = html.indexOf('<button class="crow funder-row" type="button" ' + open);
        var row = at < 0 ? '' : html.slice(at, html.indexOf('</button>', at));
        var want = r.kind === 'ie'
          ? '<div class="amt3"><div class="v"></div><div class="v"></div><div class="v tot">' + money0(r.total) + '<span class="spent">spent</span></div></div>'
          : '<div class="amt3">' + cell(0, r.direct) + cell(1, r.independent) + cell(2, r.total, 'tot') + '</div>';
        if (r.kind === 'ie') rIE++; else rRows++;
        if (row.slice(-want.length) !== want && rProbs.length < 6) rProbs.push(tag + ': row ' + (r.parent_id || r.committee_id) + ' does not end in its three figures');
      });
      // a filter that matches nothing: the empty state, with no head row and no disclosure line
      var none = D.spendSubtab(m.idx, LISTS[i][0], 'donors', null, LISTS[i][1], { search: 'zz-no-such-donor-zz', type: 'All', industry: 'All', flag: 'All' });
      var html0 = R.renderSpend(none, LISTS[i][0]);
      if (none.rows.length !== 0 || count(html0, 'browse-colhead') !== 0 || count(html0, 'browse-disclose') !== 0) rProbs.push(tag + ': the empty list draws a head row or a disclosure line');
      // the pop-up's note: the election clause where a window applies, DESIGN-1c (v)'s clause where none does
      var first = m.donors[0];
      var withWin = first ? R.renderFunderModal(D.donorFootprint(m.idx, first.parent_id, m.win)) : '';
      var noWin = first ? R.renderFunderModal(D.donorFootprint(m.idx, first.parent_id, null)) : '';
      if (count(withWin, IN_ELECTION) !== 1 || count(withWin, IN_OFFICE) !== 0) rProbs.push(tag + ': the pop-up opened with a window does not carry the election clause alone');
      if (count(noWin, IN_OFFICE) !== 1 || count(noWin, IN_ELECTION) !== 0) rProbs.push(tag + ': the pop-up opened with no window does not carry the office clause alone');
    });
    // the styles the layout ruling rests on: labels hidden beside a head row, shown under 640px where the head row is hidden
    var css = typeof R.styles === 'function' ? R.styles() : String(R.styles || '');
    // (the narrow-screen block is pinned whole, braces included, so that its rules cannot sit outside it)
    ['.ipg-elect .amt3 .lab{display:none;}', '.ipg-elect .browse-colhead{display:grid;',
     '@media (max-width:640px){.ipg-elect .browse-colhead{display:none;}' +
     '.ipg-elect .amt3{grid-column:1 / -1;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.25fr);gap:8px;text-align:left;}' +
     '.ipg-elect .amt3 .lab{display:block;font-size:10.5px;color:var(--ink-soft);font-weight:500;white-space:normal;line-height:1.25;margin-bottom:2px;}}'
    ].forEach(function (rule) {
      if (count(css, rule) !== 1) rProbs.push('the stylesheet does not carry `' + rule.slice(0, 60) + '` once');
    });
    T.ok('[M1/RENDER] Browse donors renders the head row once with the disclosure line directly above it, three figures on ' +
      'every donor row equal to its split, an outside-spending group\'s own figure marked "spent" under the total, no head ' +
      'row on an empty list, the narrow-screen labels, and the pop-up\'s note in its ratified words with and without a ' +
      'window — ' + rRows + ' donor rows and ' + rIE + ' group rows on three lists' +
      (rProbs.length ? '; ' + rProbs.join('; ') : ''), rRows > 0 && rIE > 0 && rProbs.length === 0);

    // [M1/REGISTER] The display strings are the register's words. The register is read with the
    // `> ` quote marker stripped and its line-wrap collapsed to single spaces; nothing else is
    // altered. The entry is found by the disclosure line, which no other entry carries in bold;
    // the other six strings must be in bold in THAT entry, so that an older entry's bold
    // "Total giving" (PS-138) cannot stand in for this one's. The no-window clause is
    // DESIGN-1c (v)'s and must be there, in that entry's backticks.
    var regRaw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'RULINGS.md'), 'utf8');
    var sections = regRaw.split(/\n(?=##+ )/).map(function (sec) {
      return sec.split('\n').map(function (ln) { return ln.replace(/^> ?/, ''); }).join(' ').replace(/\s+/g, ' ');
    });
    var bold = function (x) { return '**' + x + '**'; };
    var strings = ['Donor'].concat(COLS, ['spent', DISC, IN_ELECTION]);
    // the finder: which of the seven are NOT in bold in the entry text it is given
    var notIn = function (entry) { return strings.filter(function (x) { return !x || entry.indexOf(bold(x)) < 0; }); };
    var mine = sections.filter(function (sec) { return DISC && sec.indexOf(bold(DISC)) >= 0; });
    // its own numbered heading, then at once the entry's first words: an entry whose heading line is
    // lost merges into the entry above it, whose own text would sit between the two
    var numbered = mine.length === 1 && /^### PS-\d+ — (?:(?!\*\*).)* \*\*What was found\.\*\* The numbers audit \(finding M1\)/.test(mine[0]);
    var missing = mine.length === 1 ? notIn(mine[0]) : strings;
    var d1c = sections.filter(function (sec) { return sec.indexOf('### DESIGN-1c ') === 0; });
    var officeOk = d1c.length === 1 && IN_OFFICE.slice(-1) === '.' && d1c[0].indexOf('` — ' + IN_OFFICE.slice(0, -1) + '`') >= 0;
    var amended = d1c.length === 1 && d1c[0].indexOf('**Amendment (2026-10-05, the scoping rule).**') >= 0;
    T.ok('[M1/REGISTER] the head row\'s four words, "spent", the disclosure line and the pop-up\'s election clause are in ' +
      'bold in one numbered register entry, character for character; the pop-up\'s no-window clause is DESIGN-1c (v)\'s; ' +
      'and DESIGN-1c carries its amendment — ' + (strings.length - missing.length) + ' of ' + strings.length + ' in ' +
      mine.length + ' entry' +
      (missing.length ? '; NOT FOUND: ' + missing.map(function (x) { return JSON.stringify(String(x).slice(0, 40)); }).join(', ') : '') +
      (numbered ? '' : '; the entry is not under a PS heading') + (officeOk ? '' : '; the no-window clause is not DESIGN-1c (v)\'s') +
      (amended ? '' : '; DESIGN-1c carries no amendment note'),
      strings.length === 7 && numbered && missing.length === 0 && officeOk && amended);
    // BITE, in memory: alter the last character of each string in a copy of the entry, one at a
    // time; the finder must then report exactly that string.
    var unbitten = mine.length !== 1 ? strings : strings.filter(function (x) {
      var got = notIn(mine[0].split(bold(x)).join(bold(x.slice(0, -1) + 'x')));
      return got.length !== 1 || got[0] !== x;
    });
    T.ok('[M1/REGISTER:bite] with any one of the seven strings altered by one character in a copy of the entry, the finder ' +
      'reports that string and no other — ' + (strings.length - unbitten.length) + ' of ' + strings.length,
      mine.length === 1 && unbitten.length === 0);
  })();

  // [M2/*] AUDIT-2 M2 — a committee's "other receipts" leave every figure and every list of the
  // elections tool, and each card states them on a line of its own.
  //
  // PS-128 DERIVATION MODES. [M2/FIGURES] and [M2/MAGNITUDE] are **A (live-only)**: the artifact
  // is on both sides, and the recount is this block's own code over the raw rows. The committee a
  // card reads, the election's window, the excluded cycles, the dues type and the other-receipts
  // test are restated here; none is taken from data.js. The block does borrow the page-to-office
  // map (OFFICE_RACE_OFFICES), the window table and the view models' walk of races and cards.
  // [M2/LISTS] and [M2/RENDER] are **E (live host, constructed axis)**: one constructed row on a
  // real card, from a donor that card already lists, where the row's filed type and its stamp
  // are the only things that move. [M2/REGISTER] is **register-derived**, as [M1/REGISTER] is.
  //
  // WHY IT EXISTS: the numbers audit (finding M2) found other receipts counted as donations. The
  // exclusion is applied at eleven sites in data.js through one predicate; [DUES/UNIF] above
  // proves a constructed artifact holding nothing else renders zero, and this block proves the
  // same of the live one: every card's line equals a recount; each page's stated magnitude is
  // the sum of its cards' lines, and the cards, the receipts outside every card's window and the
  // rest account for the artifact's own field; and a constructed other receipt, in each of the
  // shapes that reaches a different site, moves nothing on any surface but the line.
  (function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8');
    var json = JSON.parse(raw);
    var OTHER = 'Other Receipt', DUES = 'IE Committee Dues Transfer', EXCL = { 'pre-2011': 1, 'undated': 1 };
    var TYPE = { city_council: 'municipal', mayor: 'municipal', school_board: 'school_board' };
    var OFFICES = ['city_council', 'school_board', 'mayor'];
    var c100 = function (x) { return Math.round((x || 0) * 100); };
    var usd = function (c) { return '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
    var isOther = function (c) { return c.contribution_type === OTHER && !c.is_own_committee; };
    var inWin = function (d, w) { return !!w && !!d && (w.start == null || d >= w.start) && (w.end == null || d <= w.end); };
    // a view model that has lost its other-receipts figures compares unequal to everything, and
    // the check that reads it fails; it does not throw
    var orOf = function (f) { return (f && f.otherReceipts) || { total: NaN, count: NaN }; };
    function ckMap(doc) {      // candidacy id -> the committee key that names it, from the raw committees map
      var m = {};
      Object.keys(doc.committees || {}).forEach(function (k) { var cid = doc.committees[k].candidate_id; if (cid) m[cid] = k; });
      return m;
    }
    function eachCard(doc, fn) {
      OFFICES.forEach(function (office) {
        var idx = D.loadData(doc, { office: office });
        D.selectorOptions(office).forEach(function (opt) {
          var win = (D.ELECTION_WINDOWS[TYPE[office]] || {})[opt.id];
          var om = D.viewModels.officeRaces(idx, office, opt.id);
          (om.groups || []).forEach(function (g) { (g.races || []).forEach(function (r) {
            var rv = D.viewModels.raceView(idx, idx.raceBySlug[r.slug], null);
            ((rv && rv.candidates) || []).forEach(function (c) {
              if (c.hasFinance) fn({ office: office, sel: opt.id, win: win, idx: idx, race: r, rv: rv, c: c });
            });
          }); });
        });
      });
    }
    // One committee's rows inside one window, split as M2 splits them: counted, and other receipts.
    function split(doc, ck, win) {
      var o = { counted: 0, n: 0, other: 0, on: 0 };
      (doc.contributions || []).forEach(function (c) {
        if (c.committee_id !== ck || EXCL[c.cycle] || c.contribution_type === DUES || !inWin(c.date, win)) return;
        if (isOther(c)) { o.other += c100(c.amount); o.on++; } else { o.counted += c100(c.amount); o.n++; }
      });
      return o;
    }

    // [M2/FIGURES] every card, and every section of every person view.
    function figures(doc) {
      var ck = ckMap(doc), out = { cards: 0, withOther: 0, otherCents: 0, bad: [], sections: 0, sWith: 0, sbad: [], byOffice: {}, twoOwners: 0 };
      eachCard(doc, function (x) {
        out.cards++;
        var s = split(doc, ck[x.c.fundingId], x.win), f = x.c.figures, o = orOf(f);
        if (c100(o.total) !== s.other || o.count !== s.on || c100(f.contributions.total) !== s.counted || f.contributions.count !== s.n) out.bad.push(x.c.id);
        if (s.on > 0) { out.withOther++; out.otherCents += s.other; out.byOffice[x.office] = (out.byOffice[x.office] || 0) + 1; }
      });
      var all = D.loadData(doc, {}), bp = (doc.rollups || {}).by_person || {};
      Object.keys(bp).forEach(function (pid) {
        // the person's owning candidacy: of the members that own a committee, the one of the
        // earliest election (the rule personView applies; no person holds two today)
        var owner = null, owners = (bp[pid].members || []).filter(function (m) { return m.owns_committee; })
          .sort(function (a, b) { return (a.election_id || '') < (b.election_id || '') ? -1 : 1; });
        if (owners.length) owner = owners[0].candidacy_id;
        if (owners.length > 1) out.twoOwners++;
        var vm = D.personView(all, pid);
        ((vm && vm.sections) || []).forEach(function (sec) {
          out.sections++;
          var win = (D.ELECTION_WINDOWS[sec.officeType] || {})[sec.year];
          var s = owner ? split(doc, ck[owner], win) : { other: 0, on: 0 }, o = orOf(sec);
          if (c100(o.total) !== s.other || o.count !== s.on) out.sbad.push(pid + '/' + sec.year);
          if (s.on > 0) out.sWith++;
        });
      });
      return out;
    }
    var fg = figures(json);
    T.ok('[M2/FIGURES] every card\'s other-receipts line and its raised figure, and every person section\'s line, equal a ' +
      'recount of the committee\'s own rows in the election\'s window — ' + fg.cards + ' cards, ' + fg.withOther +
      ' with other receipts (' + usd(fg.otherCents) + '; city_council ' + (fg.byOffice.city_council || 0) + ', school_board ' +
      (fg.byOffice.school_board || 0) + '); ' + fg.sections + ' person sections, ' + fg.sWith + ' with other receipts' +
      (fg.twoOwners ? '; ' + fg.twoOwners + ' person(s) hold two owning candidacies' : '') +
      (fg.bad.length ? '; CARDS DIFFERING: ' + fg.bad.slice(0, 4).join(',') : '') +
      (fg.sbad.length ? '; SECTIONS DIFFERING: ' + fg.sbad.slice(0, 4).join(',') : ''),
      // PREMISE FIRST (PS-128 (i)): the line is exercised on both pages and on the person surface.
      fg.cards > 0 && (fg.byOffice.city_council || 0) > 0 && (fg.byOffice.school_board || 0) > 0 && fg.sWith > 0 &&
      fg.bad.length === 0 && fg.sbad.length === 0);

    // [M2/MAGNITUDE] the figure each page's methodology states, and the artifact's own field.
    // A page states the sum of the lines on its cards (R2). Recounted here from the rows: every
    // in-subject other receipt is tested against every card of every page (the card's committee
    // and its election's window), and must fall on at most one. What a page states is the rows
    // on its cards. The rest of the artifact's field is accounted for row by row: receipts of a
    // page's committees dated outside every card's window, receipts of committees on no page,
    // and the rows flagged is_aggregate, which the builder's passes drop before they reach the
    // test. The four together are the artifact's field exactly, in cents and in rows.
    function magnitude(doc) {
      var ck = ckMap(doc), raceOff = {}, candOff = {}, rows = [], per = {}, off = {}, rest = { a: 0, n: 0 }, agg = { a: 0, n: 0 }, twice = 0;
      OFFICES.forEach(function (o) { per[o] = { a: 0, n: 0 }; off[o] = { a: 0, n: 0 }; });
      (doc.races || []).forEach(function (r) { raceOff[r.id] = r.office; });
      (doc.candidates || []).forEach(function (c) { candOff[c.id] = raceOff[c.race_id]; });
      (doc.contributions || []).forEach(function (c) { if (!EXCL[c.cycle] && isOther(c)) rows.push({ c: c, cards: 0 }); });
      eachCard(doc, function (x) {
        rows.forEach(function (r) {
          if (r.c.committee_id !== ck[x.c.fundingId] || !inWin(r.c.date, x.win)) return;
          r.cards++; per[x.office].a += c100(r.c.amount); per[x.office].n++;
        });
      });
      rows.forEach(function (r) {
        var a = c100(r.c.amount), cm = (doc.committees || {})[r.c.committee_id] || {}, o2 = cm.candidate_id ? candOff[cm.candidate_id] : null, hit = null;
        OFFICES.forEach(function (o) { if (o2 && D.OFFICE_RACE_OFFICES[o].indexOf(o2) >= 0) hit = o; });
        if (r.cards > 1) twice++;
        if (r.c.is_aggregate) { agg.a += a; agg.n++; }
        if (r.cards === 0) { if (hit) { off[hit].a += a; off[hit].n++; } else { rest.a += a; rest.n++; } }
      });
      return { per: per, off: off, rest: rest, agg: agg, twice: twice };
    }
    var mg = magnitude(json), art = json.other_receipts_excluded, mgBad = [];
    OFFICES.forEach(function (o) {
      var x = D.otherReceiptsOnPage(D.loadData(json, { office: o })) || {};
      if (c100(x.amount) !== mg.per[o].a || x.count !== mg.per[o].n) mgBad.push(o + ' states ' + usd(c100(x.amount)) + ' / ' + x.count);
    });
    if (mg.twice) mgBad.push(mg.twice + ' receipt(s) fall on two cards');
    var sumA = OFFICES.reduce(function (s, o) { return s + mg.per[o].a + mg.off[o].a; }, 0) + mg.rest.a - mg.agg.a;
    var sumN = OFFICES.reduce(function (s, o) { return s + mg.per[o].n + mg.off[o].n; }, 0) + mg.rest.n - mg.agg.n;
    var artOk = !!art && typeof art.amount === 'number' && typeof art.count === 'number';
    if (!artOk) mgBad.push('the artifact carries no well-formed other_receipts_excluded');
    else if (c100(art.amount) !== sumA || art.count !== sumN) mgBad.push('the cards, the receipts outside them, the rest and the flagged rows come to ' + usd(sumA) + ' / ' + sumN + ', the artifact says ' + usd(c100(art.amount)) + ' / ' + art.count);
    var pg = function (o) { return usd(mg.per[o].a) + ' / ' + mg.per[o].n + ' on its cards (' + usd(mg.off[o].a) + ' / ' + mg.off[o].n + ' outside every card\'s window)'; };
    T.ok('[M2/MAGNITUDE] each page\'s stated other-receipts figure is the sum of its cards\' lines, recounted from the rows, no ' +
      'receipt falls on two cards, and the cards, the receipts outside them and the rest account for the artifact\'s own field — ' +
      'city_council ' + pg('city_council') + ', school_board ' + pg('school_board') + ', mayor ' + pg('mayor') +
      ', on no page ' + usd(mg.rest.a) + ' / ' + mg.rest.n + ', flagged is_aggregate ' + usd(mg.agg.a) + ' / ' + mg.agg.n +
      '; artifact ' + (artOk ? usd(c100(art.amount)) + ' / ' + art.count : 'absent') + (mgBad.length ? '; ' + mgBad.join('; ') : ''),
      // PREMISE FIRST: both pages state a figure above zero, and one page holds receipts its cards do not show,
      // so "the cards' lines" and "every receipt of the page's committees" are told apart on live data.
      mg.per.city_council.n > 0 && mg.per.school_board.n > 0 && (mg.off.city_council.n + mg.off.school_board.n) > 0 && mgBad.length === 0);

    // [M2/LISTS] The constructed axis. On each of two pages: the first card, by id, that holds a
    // counted row inside its window and whose person view reports no receipt outside its
    // elections. One row is added to an in-memory copy, into that card's committee, from the
    // donor of that card's first counted row, for an amount no real row carries. Filed as an
    // other receipt it must move nothing but the line, in each of five shapes, each of which
    // reaches a site the plain one does not: dated as the host row is; flagged in-kind (the
    // in-kind share); stamped the candidate's own money (the own-money figure); in a cycle no
    // real row carries (the cycle list); and dated before every election of the office (the
    // pre-window figure and the person view's out-of-window sentence). Each shape has its
    // control: the same row filed as a contribution must move the surfaces named for it.
    // Filed as an other receipt and stamped is_own_committee it must be counted (PS-142).
    var SENT = 987654.32, lProbs = [], lNote = [], rProbs = [], cardLine = null;
    var noLine = function (k, v) { return k === 'otherReceipts' ? undefined : v; };
    var GIFT = 'Individual Contribution', NOVEL = 'm2-fixture-cycle';
    [['school_board', '2026'], ['city_council', '2027']].forEach(function (l) {
      var tag = l[0] + ' ' + l[1], ck = ckMap(json), host = null;
      eachCard(json, function (x) {
        if (x.office !== l[0] || x.sel !== l[1]) return;
        var rows = (json.contributions || []).filter(function (c) {
          return c.committee_id === ck[x.c.fundingId] && !EXCL[c.cycle] && c.contribution_type !== DUES && !isOther(c) && inWin(c.date, x.win);
        }).sort(function (a, b) { return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0); });
        var pv = rows.length ? D.personView(x.idx, x.c.id) : null;
        if (rows.length && pv && pv.hasOutOfWindow === false && (!host || x.c.id < host.id)) {
          host = { id: x.c.id, fid: x.c.fundingId, slug: x.c.slug, race: x.race.slug, win: x.win, ck: ck[x.c.fundingId], row: rows[0] };
        }
      });
      if (!host) { lProbs.push(tag + ': premise: no card holds a counted row in its window and nothing outside its elections'); return; }
      var pid = (json.donors[host.row.donor_id] || {}).parent_id || host.row.donor_id;
      // the day before the office's earliest window opens
      var wins = D.ELECTION_WINDOWS[TYPE[l[0]]], first = Object.keys(wins).map(function (k) { return wins[k].start; }).sort()[0];
      var dayBefore = new Date(Date.parse(first + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      function snap(spec) {
        var doc = JSON.parse(raw);
        if (spec) {
          var row = { id: 'm2-fixture-1', donor_id: host.row.donor_id, committee_id: host.ck, amount: SENT, date: spec.pre ? dayBefore : host.row.date,
            cycle: spec.novel ? NOVEL : host.row.cycle, contribution_type: spec.type };
          if (spec.own) row.is_own_committee = true;
          if (spec.inKind) row.is_in_kind = true;
          if (spec.self) row.is_self = true;
          doc.contributions.push(row);
        }
        var idx = D.loadData(doc, { office: l[0] }), rv = D.viewModels.raceView(idx, idx.raceBySlug[host.race], null);
        var card = rv.candidates.filter(function (c) { return c.id === host.id; })[0];
        var page = R.renderRaceView(rv), pop = D.committeeProfile(idx, host.ck, host.win), popAll = D.committeeProfile(idx, host.ck, null);
        var s = { card: card, page: page, pop: pop, popAll: popAll, popHtml: R.renderCommitteeProfile(pop),
          html: (page.split('<article class="card" id="cand-' + host.slug + '">')[1] || '').split('</article>')[0] };
        // every surface is compared with the line's own figures left out (noLine): the line is what
        // is allowed to move, wherever a view model carries it
        s.surf = { raceView: JSON.stringify(rv, noLine), contributors: JSON.stringify(D.candidateContributors(idx, host.fid, null, host.win), noLine),
          footprint: JSON.stringify(D.donorFootprint(idx, pid, host.win), noLine), footprintAll: JSON.stringify(D.donorFootprint(idx, pid, null), noLine),
          committee: JSON.stringify(pop, noLine), committeeAll: JSON.stringify(popAll, noLine),
          person: JSON.stringify(D.personView(idx, host.id), noLine), cycles: JSON.stringify(D.availableCycles(idx)),
          tallies: JSON.stringify([idx.industryByCandidate[host.fid] || null, idx.flagByCandidate[host.fid] || null]) };
        ['donors', 'candidates', 'industries', 'industry-candidate', 'flags'].forEach(function (t) {
          s.surf[t] = JSON.stringify(D.spendSubtab(idx, l[0], t, null, l[1]), noLine);
        });
        return s;
      }
      var base = snap(null), names = Object.keys(base.surf), f0 = base.card.figures;
      var moved = function (a, b) { return names.filter(function (n) { return a.surf[n] !== b.surf[n]; }); };
      var lineBy = function (a, b, cents) {      // did the line's figures move by exactly this much, and by one receipt (or none)?
        return c100(orOf(a).total) === c100(orOf(b).total) + cents && orOf(a).count === orOf(b).count + (cents ? 1 : 0);
      };
      // the five shapes: [name, other-receipt spec, control spec, the surfaces the control must move, compared against]
      var plain = snap({ type: GIFT });
      var shapes = [
        ['dated as the host row', { type: OTHER }, { type: GIFT }, names.filter(function (n) { return n !== 'flags' && n !== 'cycles'; }), base],
        ['flagged in-kind', { type: OTHER, inKind: true }, { type: GIFT, inKind: true }, ['raceView', 'committee', 'committeeAll'], plain],
        ['stamped the candidate\'s own money', { type: OTHER, self: true }, { type: GIFT, self: true }, ['raceView', 'person', 'candidates'], plain],
        ['in a cycle no real row carries', { type: OTHER, novel: true }, { type: GIFT, novel: true }, ['cycles'], base],
        ['dated before every election of the office', { type: OTHER, pre: true }, { type: GIFT, pre: true }, l[0] === 'school_board' ? ['person', 'raceView'] : ['person'], base]
      ];
      var oth = null, gift = plain;
      shapes.forEach(function (sh) {
        var o = snap(sh[1]), g = sh[2] === shapes[0][2] ? plain : snap(sh[2]), inW = !sh[1].pre;
        if (sh === shapes[0]) oth = o;
        var mv = moved(o, base);
        if (mv.length) lProbs.push(tag + ': an other receipt ' + sh[0] + ' moved ' + mv.join(', '));
        // the line: on the card and in the committee's pop-up for the same window, by the row when the row is dated
        // inside the window and not at all when it is not; in the pop-up opened without a window, always by the row
        if (!lineBy(o.card.figures, f0, inW ? c100(SENT) : 0) || !lineBy(o.pop, base.pop, inW ? c100(SENT) : 0) || !lineBy(o.popAll, base.popAll, c100(SENT))) {
          lProbs.push(tag + ': with an other receipt ' + sh[0] + ' the line did not move as the row\'s date requires');
        }
        // the control: the same row filed as a contribution is seen by the surfaces this shape is here for
        var still = sh[3].filter(function (n) { return g.surf[n] === sh[4].surf[n]; });
        if (still.length) lProbs.push(tag + ': a contribution ' + sh[0] + ' left ' + still.join(', ') + ' unmoved, so the comparison cannot see a counted row there');
      });
      var own = snap({ type: OTHER, own: true }), f2 = gift.card.figures, f3 = own.card.figures, f1 = oth.card.figures;
      if (c100(f2.contributions.total) !== c100(f0.contributions.total) + c100(SENT) || !lineBy(f2, f0, 0)) lProbs.push(tag + ': a constructed contribution was not counted in raised');
      if (c100(f3.contributions.total) !== c100(f0.contributions.total) + c100(SENT) || c100(f3.contributions.ownCommittee) !== c100(f0.contributions.ownCommittee) + c100(SENT) ||
          !lineBy(f3, f0, 0)) lProbs.push(tag + ': a stamped other receipt was not counted as other-committee money');
      lNote.push(tag + ' on ' + host.slug + ' (' + names.length + ' surfaces, ' + shapes.length + ' shapes)');

      // [M2/RENDER], on the same constructed card: the line, its place and its figure; and the
      // same line under "raised" in the committee's pop-up.
      var want = '<p class="otherline">Other receipts, not counted above: <b>' + R._money(orOf(f1).total) + '</b></p>';
      if ((oth.html.split('<p class="otherline">').length - 1) !== 1 || oth.html.indexOf(want) < 0) rProbs.push(tag + ': the constructed card does not carry the line once, with its figure');
      else if (!/<\/div>(<p class="selfline">[\s\S]*?<\/p>)?<p class="otherline">/.test(oth.html) || oth.html.indexOf('<p class="otherline">') > oth.html.indexOf('<p class="caption">')) rProbs.push(tag + ': the line is not directly under the bars and the own-money sentence');
      if (!(orOf(f0).total > 0) && base.html.indexOf('otherline') >= 0) rProbs.push(tag + ': a card with no other receipts carries the line');
      if (!(orOf(f0).total > 0) && gift.html.indexOf('otherline') >= 0) rProbs.push(tag + ': a card with a constructed contribution carries the line');
      if ((oth.popHtml.split('<p class="otherline">').length - 1) !== 1 || oth.popHtml.indexOf(' raised</div>' + want) < 0) rProbs.push(tag + ': the committee\'s pop-up does not carry the line once, directly under its raised figure');
      if (!(orOf(base.pop).total > 0) && base.popHtml.indexOf('otherline') >= 0) rProbs.push(tag + ': a committee\'s pop-up with no other receipts carries the line');
      cardLine = cardLine || want.replace(/<[^>]+>/g, '').replace(R._money(orOf(f1).total), '$X');
    });
    T.ok('[M2/LISTS] a constructed other receipt on a real card moves the line and nothing else, in five shapes (dated as a real ' +
      'row; flagged in-kind; stamped the candidate\'s own money; in a cycle no real row carries; dated before every election of ' +
      'the office): the race view, the contributor list, the donor\'s pop-up and the committee\'s pop-up with and without a window, ' +
      'the person view, the cycle list, the index\'s industry and flag tallies, and Browse donors, Spend by candidate, Industry ' +
      'totals, Industries by candidate and Flag totals are byte for byte what they were; the same row filed as a contribution ' +
      'moves the surfaces each shape is there for; and filed as an other receipt and stamped, it is counted — ' +
      (lProbs.length ? lProbs.join('; ') : lNote.join('; ')), lNote.length === 2 && lProbs.length === 0);

    // [M2/RENDER], live half: across every race view and every person view the artifact renders,
    // the line appears exactly once per card or section that has other receipts, and nowhere else.
    var liveCards = 0, liveLines = 0, seenRace = {}, popLines = 0, popBad = 0, ckLive = ckMap(json), both = 0, bothBad = 0;
    eachCard(json, function (x) {
      var key = x.office + '|' + x.race.slug, has = orOf(x.c.figures).total > 0;
      if (has) liveCards++;
      // the committee's pop-up, opened in the card's window: one line where the card has one
      var pl = R.renderCommitteeProfile(D.committeeProfile(x.idx, ckLive[x.c.fundingId], x.win)).split('<p class="otherline">').length - 1;
      popLines += pl; if (pl !== (has ? 1 : 0)) popBad++;
      if (!seenRace[key]) { seenRace[key] = R.renderRaceView(x.rv); liveLines += seenRace[key].split('<p class="otherline">').length - 1; }
      // a card that carries both the own-money sentence and the line: the sentence directly under the
      // bars, the line directly under the sentence. The constructed cards above need not have both.
      var art = (seenRace[key].split('<article class="card" id="cand-' + x.c.slug + '">')[1] || '').split('</article>')[0];
      if (has && art.indexOf('<p class="selfline">') >= 0) {
        both++;
        if (!/<\/div><p class="selfline">(?:(?!<\/p>)[\s\S])*<\/p><p class="otherline">/.test(art)) bothBad++;
      }
    });
    var allIdx = D.loadData(json, {}), pSecs = 0, pLines = 0;
    Object.keys((json.rollups || {}).by_person || {}).forEach(function (pid) {
      var vm = D.personView(allIdx, pid); if (!vm) return;
      vm.sections.forEach(function (s) { if (orOf(s).total > 0) pSecs++; });
      pLines += R.renderPersonModal(vm).split('<p class="otherline">').length - 1;
    });
    if (liveLines !== liveCards) rProbs.push('race views render ' + liveLines + ' lines for ' + liveCards + ' cards with other receipts');
    if (pLines !== pSecs) rProbs.push('person views render ' + pLines + ' lines for ' + pSecs + ' sections with other receipts');
    if (bothBad) rProbs.push(bothBad + ' of ' + both + ' live cards with both an own-money sentence and the line do not carry the sentence first and the line directly under it');
    if (popBad || popLines !== liveCards) rProbs.push('committee pop-ups render ' + popLines + ' lines for ' + liveCards + ' cards with other receipts (' + popBad + ' pop-up(s) off)');
    T.ok('[M2/RENDER] the line renders once on each card, person section and committee pop-up that has other receipts, on the ' +
      'card directly under the bars and the own-money sentence and in the pop-up directly under its raised figure, with its ' +
      'figure in whole dollars, and on none without them — ' +
      (rProbs.length ? rProbs.join('; ') : liveLines + ' lines on ' + liveCards + ' live cards, ' + popLines + ' in their committees\' pop-ups, ' + pLines + ' on ' + pSecs + ' live person sections, and the constructed cards; ' + both + ' live cards carry the own-money sentence and the line, the sentence first'),
      liveCards > 0 && pSecs > 0 && both > 0 && rProbs.length === 0);

    // [M2/REGISTER] The line's words are the register's. Read as [M1/REGISTER] reads: the `> `
    // quote marker stripped and the line-wrap collapsed to single spaces, nothing else altered.
    // The entry is found by the line itself, in bold; it must sit under its own numbered heading
    // and open with the finding it answers.
    var regRaw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'RULINGS.md'), 'utf8');
    var sections = regRaw.split(/\n(?=##+ )/).map(function (sec) {
      return sec.split('\n').map(function (ln) { return ln.replace(/^> ?/, ''); }).join(' ').replace(/\s+/g, ' ');
    });
    var bold = function (x) { return '**' + x + '**'; };
    var finder = function (list) { return list.filter(function (sec) { return !!cardLine && sec.indexOf(bold(cardLine)) >= 0; }); };
    var mine = finder(sections);
    var numbered = mine.length === 1 && /^### PS-\d+ — (?:(?!\*\*).)* \*\*What was found\.\*\* The numbers audit \(finding M2\)/.test(mine[0]);
    T.ok('[M2/REGISTER] the card\'s line is in bold, character for character, in one numbered register entry that opens with ' +
      'finding M2 — ' + JSON.stringify(cardLine) + ' in ' + mine.length + ' entry' + (numbered ? '' : '; the entry is not under a PS heading that opens with the finding'),
      !!cardLine && numbered);
    // BITE, in memory: one character of the line altered in a copy of the entry; the finder must lose it.
    var bitten = mine.length === 1 ? finder([mine[0].split(bold(cardLine)).join(bold(cardLine.slice(0, -1) + 'x'))]) : [null];
    T.ok('[M2/REGISTER:bite] with one character of the line altered in a copy of the entry, the finder no longer finds it',
      mine.length === 1 && bitten.length === 0);
  })();

  // [M2/PAGE] The same two things in the SHIPPED bundle, by real clicks. The checks above call
  // data.js and render.js directly; this one goes through app.js, which carries the index's
  // figures to the methodology view and draws the cards. PS-128 mode A: the expectation is a
  // recount of PREVIEW_DATA's rows for the school-board page's cards, in this block's own code.
  await (async function () {
    var D = require(path.join(__dirname, '..', 'data.js')), R = require(path.join(__dirname, '..', 'render.js'));
    var RAW = ctx.window.PREVIEW_DATA, probs = [];
    var idx = D.loadData(RAW, { office: 'school_board' }), sel = D.selectorOptions('school_board')[0].id, pick = null, a = 0, n = 0, ckP = {};
    Object.keys(RAW.committees || {}).forEach(function (k) { var cid = RAW.committees[k].candidate_id; if (cid) ckP[cid] = k; });
    var others = (RAW.contributions || []).filter(function (c) {
      return c.cycle !== 'pre-2011' && c.cycle !== 'undated' && c.contribution_type === 'Other Receipt' && !c.is_own_committee;
    });
    // every card of every election the page offers: its committee's other receipts dated inside
    // that election's window, recounted from PREVIEW_DATA's rows; and, in the default election, a
    // race with a card that has some
    D.selectorOptions('school_board').forEach(function (opt) {
      var w = D.ELECTION_WINDOWS.school_board[opt.id];
      (D.viewModels.officeRaces(idx, 'school_board', opt.id).groups || []).forEach(function (g) { (g.races || []).forEach(function (r) {
        var rv = D.viewModels.raceView(idx, idx.raceBySlug[r.slug], null), fin = ((rv && rv.candidates) || []).filter(function (c) { return c.hasFinance; });
        fin.forEach(function (c) {
          others.forEach(function (x) {
            if (x.committee_id !== ckP[c.fundingId] || !x.date || x.date < w.start || x.date > w.end) return;
            a += Math.round((x.amount || 0) * 100); n++;
          });
        });
        var k = fin.filter(function (c) { return ((c.figures || {}).otherReceipts || {}).total > 0; });
        if (opt.id === sel && !pick && k.length) pick = { slug: r.slug, cards: k };
      }); });
    });
    await ctx.closeModal();
    ctx.click(ctx.doc.querySelector('[data-view="byrace"]')); await ctx.wait(60);
    ctx.selectElection(sel); await ctx.wait(60);
    if (!pick) probs.push('premise: no ' + sel + ' school-board card has other receipts');
    else {
      ctx.nav(pick.slug); await ctx.wait(80);
      var page = ctx.root().innerHTML;
      if ((page.split('<p class="otherline">').length - 1) !== pick.cards.length) probs.push('the race view ' + pick.slug + ' does not carry one line per card with other receipts');
      pick.cards.forEach(function (c) {
        if (page.indexOf('<p class="otherline">Other receipts, not counted above: <b>' + R._money(c.figures.otherReceipts.total) + '</b></p>') < 0) probs.push('no line with its figure for ' + c.id);
      });
    }
    ctx.click(ctx.doc.querySelector('[data-view="methodology"]')); await ctx.wait(80);
    var meth = ctx.root().innerHTML;
    var sentence = 'Across the elections on this page they account for ' + R._moneyCents(a / 100) + ' in ' + n.toLocaleString('en-US') + ' receipts.</p><p>A loan to a committee';
    if (meth.indexOf('<h3>Other receipts and loans</h3><p>Committees also report money') < 0 || meth.indexOf(sentence) < 0) probs.push('the Methodology tab does not carry the section with this page\'s figure (' + R._moneyCents(a / 100) + ' / ' + n + ')');
    ctx.click(ctx.doc.querySelector('[data-view="byrace"]')); await ctx.wait(40);
    T.ok('[M2/PAGE] in the shipped bundle, by real clicks, a race view carries the line on each card that has other receipts and ' +
      'the Methodology tab carries the section with this page\'s own figure, the sum of its cards\' lines — ' +
      (probs.length ? probs.join('; ') : pick.slug + ', ' + pick.cards.length + ' card(s); ' + R._moneyCents(a / 100) + ' in ' + n + ' receipts'),
      n > 0 && probs.length === 0);
  })();

  // [THROUGH/*], [IND/*], [GROUP/*], [ESC/NAME], [REVIEW/CHIP] — AUDIT-2, the elections-tool package:
  // PS-156 (the data-through line), the IND-MULTI-1 amendment (the Industry totals line), PS-155 (a
  // grouped donor prints the group's name, and search finds it by any member's), ruling 10 (names are
  // escaped once) and the review mark on the two surfaces [spend.C] does not read.
  //
  // PS-128 DERIVATION MODES.
  // [THROUGH/REGISTER] and the strings of [IND/ALL] are **register-derived**, as [METH/REGISTER]
  // is: the line's words are the bold text of one register entry, read with the `> ` marker
  // stripped and the line-wrap collapsed, nothing else altered. No copy of them is kept here.
  // [THROUGH/LINE] is **A**: the two dates are recounted HERE from the artifact's rows by
  // build_sb_finance.data_through()'s rule, restated below, and compared besides with the field
  // that builder wrote into school-board-finance.json. It calls neither data.js's noteThrough nor
  // render.js's longDate. [THROUGH/MISSING] is **E** (live host, constructed axis): the artifact
  // with one kind of report removed, or one row with a constructed date added, in a shallow
  // in-memory copy.
  // [IND/ALL] is **A**: three readers must agree to the cent, the streams the Industry totals tab
  // is given (data.js streamTotals), the sum of each figure over every row of the Spend by
  // candidate tab for the same election (candidateFigures; that tab's sections for the other
  // election's races that carry money in the window are rows of it, so the By race cards of the
  // selected election can sum lower), and a recount of the artifact's rows in this block's own
  // code. Its zero-stream half, [IND/ZERO], is **B**: every combination of zero and non-zero
  // streams, stated here, on constructed view-models; no live list is required to hold a zero.
  // No check here reads git history. That this change moved printed names and no figure, row or
  // order, against the data.js it replaced, is a landing proof run once outside this gate.
  // The bites of [GROUP/NAME], [GROUP/SEARCH] and [GROUP/OWN] put the page back as it read before
  // in memory: the same index with the table the name resolver reads emptied (`blind`).
  // [GROUP/NAME] is **A** with an oracle the subject does not read: the page takes the group's
  // name from `donor_clusters[*].name`; the expectation here is `donors[*].cluster_name`, the
  // artifact's other carrier of it, and a group's members are found by `parent_id`, not by the
  // cluster's own member list. [GROUP/OWN] and [ESC/NAME] are **E**: one constructed group name
  // on a live host, since no live own-money line carries a group whose name differs from its
  // record's, and no live name carries markup. [ESC/NAME]'s host is also where a group's name
  // after "Funded primarily by" is asserted, so that no live funder need be a renamed group.
  // [REVIEW/CHIP] is **E** in [spend.C]'s manner: constructed, the document (the registry alone,
  // one outside-spending row, no contribution) and the row's flag; live, the row itself.
  // [GROUP/SEARCH] is **A**; the queries are chosen from the artifact by rule, not pinned.
  // The :PAGE checks drive the SHIPPED bundles by real clicks, through app.js, which is what
  // carries the index's dates to the header and tests a card's rows against its search box.
  //
  // WHY THEY EXIST: the numbers audit found a tool that did not say how current it was (S3), an
  // Industry totals note that spoke of a total the tab did not print, and grouped donors printed
  // under one member's filed spelling and findable by no other (C4).
  await (async function () {
    var R = require(path.join(__dirname, '..', 'render.js'));
    var D = require(path.join(__dirname, '..', 'data.js'));
    var ROOT = path.join(__dirname, '..', '..', '..');
    var json = JSON.parse(fs.readFileSync(path.join(ROOT, 'election-data.json'), 'utf8'));
    var LISTS = [['school_board', '2026'], ['school_board', '2024'], ['city_council', '2027']];
    var VIEWS = ['byrace', 'spend', 'methodology'];
    var cents = function (x) { return Math.round((x || 0) * 100); };
    var money0 = function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    var count = function (hay, needle) { return needle ? hay.split(needle).length - 1 : -1; };
    var escH = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
    // markup parsed into a detached element of ONE scratch document: a document per parse is never
    // collected, and these checks parse some thousand fragments
    var scratch = new JSDOM('<!doctype html><body></body>').window.document;
    var parse = function (html) { var d = scratch.createElement('div'); d.innerHTML = html; return d; };
    var all = function (node, sel) { return [].slice.call(node.querySelectorAll(sel)); };
    var byId = function (node, id) { return node.querySelector('[id="' + id + '"]'); };
    // the name a row prints: the text of its `.who` before the first chip
    var printed = function (row) { var w = row.querySelector('.who'), t = w && w.firstChild; return (t && t.nodeType === 3) ? t.nodeValue.trim() : null; };
    var idxOf = {}; ['school_board', 'city_council', 'mayor'].forEach(function (o) { idxOf[o] = D.loadData(json, { office: o }); });
    // One page as app.js draws it, for a view and an election.
    function pageOf(Dx, idx, office, view, el, tab) {
      var om = Dx.viewModels.officeRaces(idx, office, el), slug = null;
      om.groups.forEach(function (g) { g.races.forEach(function (r) { if (slug === null && r.hasFinance) slug = r.slug; }); });
      return R.renderPage({ office: office, duesExcluded: idx.duesExcluded, otherExcluded: Dx.otherReceiptsOnPage(idx), dataThrough: idx.dataThrough,
        topView: view, cycles: Dx.availableCycles(idx), cycle: null, officeRaces: om, activeSlug: slug,
        raceView: slug ? Dx.viewModels.raceView(idx, idx.raceBySlug[slug], null) : null,
        spend: view === 'spend' ? Dx.spendSubtab(idx, office, tab || 'donors', null, el, null, 'all', null) : null,
        selector: { options: Dx.selectorOptions(office), active: el }, verify: { reconUrl: 'x', gapsUrl: 'y' } });
    }
    // A shipped bundle booted on a given artifact, as the preview boots school board's: the bundle's
    // own three scripts, with fetch answering every URL with the data (so `verify` stays empty).
    async function boot(office, data) {
      var dom = new JSDOM(fs.readFileSync(BUNDLE_MOD.outFor(office), 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
        beforeParse: function (w) { w.fetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } }); }; } });
      var c = makeCtx(dom.window);
      for (var i = 0; i < 100 && !c.root().querySelector('.masthead'); i++) await c.wait(50);
      return c;
    }

    // ---- the register ----
    var regRaw = fs.readFileSync(path.join(ROOT, 'RULINGS.md'), 'utf8');
    var sections = regRaw.split(/\n(?=##+ )/).map(function (sec) {
      return sec.split('\n').map(function (ln) { return ln.replace(/^> ?/, ''); }).join(' ').replace(/\s+/g, ' ');
    });
    var bolds = function (sec) { var out = [], re = /\*\*([^*]+)\*\*/g, m; while ((m = re.exec(sec))) out.push(m[1]); return out; };
    var holding = function (test) { return sections.filter(function (sec) { return bolds(sec).some(test); }); };

    // ================= PS-156: the data-through line =================
    // [THROUGH/REGISTER] The line is the one bold string, in one numbered entry, that carries the
    // two date placeholders and nothing after "large gifts." (PS-152's line for the school-board
    // voting page carries a third date and is a different string).
    var isThrough = function (b) { return /^Contributions through \{quarterly date\} .*\{large-gift date\}.* large gifts\.$/.test(b); };
    // Exactly once in the entry headed `### PS-156 `; a later entry may quote the line, so the
    // register as a whole is not asked to hold it once.
    var tSecs = sections.filter(function (sec) { return sec.indexOf('### PS-156 ') === 0; });
    var tHits = tSecs.length === 1 ? bolds(tSecs[0]).filter(isThrough) : [];
    var tTpl = tHits.length === 1 ? tHits[0] : null;
    T.ok('[THROUGH/REGISTER] the data-through line is in bold exactly once in the register entry headed PS-156 — ' +
      (tTpl ? JSON.stringify(tTpl) : tHits.length + ' bold strings in ' + tSecs.length + ' entries'),
      !!tTpl && count(tTpl, '{quarterly date}') === 1 && count(tTpl, '{large-gift date}') === 1);

    // the two dates, recounted: the filing kind exactly, a date that is a ten-character string, the greatest
    function throughOf(js) {
      var out = {};
      [['quarterly', 'Quarterly'], ['large_gift', 'A-1']].forEach(function (k) {
        var best = null;
        (js.contributions || []).forEach(function (c) {
          if (c.source_filing === k[1] && typeof c.date === 'string' && c.date.length === 10 && (best === null || c.date > best)) best = c.date;
        });
        out[k[0]] = best;
      });
      return out;
    }
    var MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    // a day the calendar holds, or null: an impossible date counts as missing (PS-156 as built)
    function mdy(iso) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
      if (!m || !MONTH[+m[2] - 1]) return null;
      var y = +m[1], feb = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28;
      var len = { 1: 31, 2: feb, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 }[+m[2]];
      return (+m[3] >= 1 && +m[3] <= len) ? MONTH[+m[2] - 1] + ' ' + String(+m[3]) + ', ' + m[1] : null;
    }
    var tLive = throughOf(json);
    var sbf = JSON.parse(fs.readFileSync(path.join(ROOT, 'school-board-finance.json'), 'utf8')).data_through || {};
    var tWant = (tTpl && mdy(tLive.quarterly) && mdy(tLive.large_gift))
      ? tTpl.replace('{quarterly date}', mdy(tLive.quarterly)).replace('{large-gift date}', mdy(tLive.large_gift)) : null;
    // The header's part of a page, and what is wrong with it against the line it should carry
    // (`want` a string) or should not carry (`want` null).
    var mastOf = function (html) { return html.slice(html.indexOf('<header class="masthead">'), html.indexOf('</header>')); };
    function mastProblems(html, want) {
      var m = mastOf(html), f = [];
      if (count(html, '<header class="masthead">') !== 1 || !m) return ['no header'];
      if (count(html, 'class="data-through"') !== (want ? 1 : 0)) f.push('the line is drawn ' + count(html, 'class="data-through"') + ' times');
      if (want) {
        var at = /<p class="lede">(?:(?!<\/p>)[\s\S])*<\/p><p class="data-through">([^<]*)<\/p><div class="topnav"/.exec(m);
        if (!at) f.push('the line is not a paragraph of its own between the lede and the tabs');
        else if (at[1] !== want) f.push('the line reads ' + JSON.stringify(at[1]));
      } else if (m.indexOf('on quarterly reports') >= 0 || m.indexOf('Contributions through') >= 0) f.push('part of the line is drawn');
      return f;
    }
    var tProbs = [], tPages = 0, tMayor = 0, tText = {};
    if (!tWant) tProbs.push('premise: the artifact holds no dated row of one kind, or the register line was not read');
    LISTS.forEach(function (L) {
      VIEWS.forEach(function (v) {
        var html = pageOf(D, idxOf[L[0]], L[0], v, L[1]);
        mastProblems(html, tWant).forEach(function (p) { tProbs.push(L.join(' ') + ' ' + v + ': ' + p); });
        tText[(/<p class="data-through">([^<]*)<\/p>/.exec(html) || [])[1]] = 1; tPages++;
      });
    });
    VIEWS.forEach(function (v) {
      mastProblems(pageOf(D, idxOf.mayor, 'mayor', v, '2027'), null).forEach(function (p) { tProbs.push('mayor ' + v + ': ' + p); });
      tMayor++;
    });
    // The day does not depend on the machine's time zone. Rendered again with the zone set west of
    // Greenwich, where a date read as an instant falls on the day before; set here, so that this
    // bites whatever zone the gate is run in, and put back.
    (function () {
      var had = Object.prototype.hasOwnProperty.call(process.env, 'TZ'), tz0 = process.env.TZ;
      try {
        ['America/Chicago', 'Pacific/Pago_Pago'].forEach(function (z) {
          process.env.TZ = z;
          mastProblems(pageOf(D, idxOf.school_board, 'school_board', 'byrace', '2026'), tWant).forEach(function (p) { tProbs.push('with the zone set to ' + z + ': ' + p); });
        });
      } finally { if (had) process.env.TZ = tz0; else delete process.env.TZ; }
    })();
    T.ok('[THROUGH/LINE] on every top view of /school-board-elections (both elections) and /city-council the header carries the ' +
      'register\'s line once, directly under the lede, with the latest date of a contribution filed on a quarterly report and of one ' +
      'filed on a report of a large gift across the whole artifact, recounted here by build_sb_finance\'s rule and equal to the ' +
      'dates that builder wrote; it reads the same on every election and in a time zone west of Greenwich; the mayor\'s page carries none — ' +
      (tProbs.length ? tProbs.slice(0, 5).join('; ') : JSON.stringify(tWant) + ' (' + tLive.quarterly + ', ' + tLive.large_gift + ') on ' + tPages + ' pages; absent on ' + tMayor + ' mayor pages'),
      !!tWant && tProbs.length === 0 && Object.keys(tText).length === 1 &&
      sbf.quarterly === tLive.quarterly && sbf.large_gift === tLive.large_gift);

    // [THROUGH/MISSING] the line prints whole or not at all.
    var without = function (kind) { return Object.assign({}, json, { contributions: json.contributions.filter(function (c) { return c.source_filing !== kind; }) }); };
    var plus = function (row) { return Object.assign({}, json, { contributions: json.contributions.concat([row]) }); };
    var host = json.contributions.filter(function (c) { return c.source_filing === 'A-1' && c.date === tLive.large_gift; })[0] || {};
    var mProbs = [], liveMast = {};
    ['school_board', 'city_council'].forEach(function (o) { liveMast[o] = mastOf(pageOf(D, idxOf[o], o, 'byrace', D.selectorOptions(o)[0].id)); });
    [['no row filed on a report of a large gift', without('A-1'), null],
     ['no row filed on a quarterly report', without('Quarterly'), null],
     ['a large-gift row dated 2026-13-01, later than every other and not a date', plus(Object.assign({}, host, { date: '2026-13-01' })), null],
     ['a large-gift row dated 9999-12-3, not ten characters (the rule passes over it)', plus(Object.assign({}, host, { date: '9999-12-3' })), tWant],
     ['a later row of another kind of report (the kind is matched exactly)', plus(Object.assign({}, host, { date: '2099-01-01', source_filing: 'Quarterly A-1' })), tWant],
     // a day the calendar does not hold counts as missing; a leap day in a leap year is a day
     ['a large-gift row dated 2027-02-31, the latest and no day', plus(Object.assign({}, host, { date: '2027-02-31' })), null],
     ['a large-gift row dated 2027-02-29, the latest and no day (2027 is no leap year)', plus(Object.assign({}, host, { date: '2027-02-29' })), null],
     ['a large-gift row dated 2028-02-29, the latest and a day', plus(Object.assign({}, host, { date: '2028-02-29' })),
       tTpl && mdy(tLive.quarterly) ? tTpl.replace('{quarterly date}', mdy(tLive.quarterly)).replace('{large-gift date}', 'February 29, 2028') : null]
    ].forEach(function (c, ci) {
      if (ci === 7 && !c[2]) mProbs.push('premise: the leap-day expectation was not built');
      ['school_board', 'city_council'].forEach(function (o) {
        var ix = D.loadData(c[1], { office: o }), el = D.selectorOptions(o)[0].id;
        VIEWS.forEach(function (v) {
          var html = pageOf(D, ix, o, v, el);
          mastProblems(html, c[2]).forEach(function (p) { mProbs.push(c[0] + ', ' + o + ' ' + v + ': ' + p); });
        });
        // nothing else in the header moves: it is the live header with the line taken out, or with the line expected in its place
        var m0 = mastOf(pageOf(D, ix, o, 'byrace', el));
        if (m0 !== liveMast[o].replace('<p class="data-through">' + tWant + '</p>', c[2] ? '<p class="data-through">' + c[2] + '</p>' : '')) mProbs.push(c[0] + ', ' + o + ': the rest of the header changed');
      });
    });
    T.ok('[THROUGH/MISSING] with either date missing, or the latest one not a day the calendar holds (a thirteenth month, ' +
      '2027-02-31, 2027-02-29), the whole line is left off every view and the rest of the header stands; a date that is not ten ' +
      'characters and a later row of another kind do not move it; and 2028-02-29 prints as February 29, 2028 — ' +
      (mProbs.length ? mProbs.slice(0, 4).join('; ') : '8 constructed artifacts, two pages, three views each'),
      !!tWant && !!host.date && mProbs.length === 0 && mdy('2028-02-29') === 'February 29, 2028' && mdy('2027-02-29') === null && mdy('2100-02-29') === null && mdy('2000-02-29') !== null);
    // BITES, in memory, on a live page: a date a day out; the line below the tabs; the line where none is wanted; none where one is.
    var tPage = pageOf(D, idxOf.school_board, 'school_board', 'byrace', '2026');
    var tLineHtml = '<p class="data-through">' + tWant + '</p>';
    var tDay = mdy(tLive.large_gift) || '', tDayOut = tDay.replace(/\d+,/, function (d) { return (parseInt(d, 10) === 1 ? 2 : parseInt(d, 10) - 1) + ','; });
    var tBites = [
      mastProblems(tPage.replace(tDay, tDayOut), tWant),
      mastProblems(tPage.replace(tLineHtml, '').replace('</header>', tLineHtml + '</header>'), tWant),
      mastProblems(tPage, null),
      mastProblems(tPage.replace(tLineHtml, ''), tWant),
      mastProblems(tPage.replace(tLineHtml, '<p class="lede">' + tWant + '</p>'), tWant)];
    T.ok('[THROUGH/LINE:bite] a date one day out, the line moved below the tabs, the line drawn where none is wanted, the line ' +
      'missing where one is, and its words set inside a second lede each make the check fire — ' +
      tBites.filter(function (b) { return b.length > 0; }).length + ' of ' + tBites.length,
      !!tWant && mastProblems(tPage, tWant).length === 0 && tBites.every(function (b) { return b.length > 0; }));

    // ================= IND-MULTI-1 amendment: the Industry totals line =================
    var isAllTpl = function (b) { return b.indexOf('{direct}') >= 0 && b.indexOf('{support}') >= 0 && b.indexOf('{oppose}') >= 0; };
    var iSecs = holding(isAllTpl);
    var iTpl = iSecs.length === 1 ? bolds(iSecs[0]).filter(isAllTpl)[0] : null;
    var iNote = iSecs.length === 1 ? (bolds(iSecs[0]).filter(function (b) { return /^A donor tagged with more than one industry is listed under each; /.test(b); })[0] || null) : null;
    var iEntry = iSecs.length === 1 && iSecs[0].indexOf('### IND-MULTI-1 — count once, list under both, as ruled') === 0;
    // the sentence the amendment rewords, as clause (ii) of the same entry quotes it
    var iOld = iSecs.length === 1 ? ((/renders this sentence beside its total: "([^"]+)"/.exec(iSecs[0]) || [])[1] || null) : null;
    // the template's four pieces: its opening, and one part per stream, joined by the register's own separator
    var iHead = iTpl ? iTpl.slice(0, iTpl.indexOf('{direct}')) : '', iParts = iTpl ? iTpl.slice(iHead.length).replace(/\.$/, '').split(' · ') : [];
    function allLine(s) {
      var keys = ['direct', 'support', 'oppose'], out = [];
      keys.forEach(function (k, i) { if (s[k] > 0) out.push(iParts[i].replace('{' + k + '}', money0(s[k]))); });
      return out.length ? iHead + out.join(' · ') + '.' : null;
    }
    // what is wrong with a rendered Industry totals tab against the streams it should state
    function indProblems(html, s) {
      var f = [], want = allLine(s), note = (/<p class="contrib-note">((?:(?!<\/p>)[\s\S])*)<\/p><div class="ind-legend"/.exec(html) || [])[1];
      if (!note || note.slice(-(iNote.length + 1)) !== ' ' + iNote) f.push('the note above the bars does not end with the register\'s sentence');
      if (iOld && html.indexOf(iOld.slice(iOld.indexOf('; ') + 2)) >= 0) f.push('the clause the amendment reworded is still printed');
      if (count(html, 'All industries together') !== (want ? 1 : 0)) f.push('the line is drawn ' + count(html, 'All industries together') + ' times');
      if (want) {
        var at = /<\/button><\/div><p class="contrib-note ind-all">([^<]*)<\/p><\/div><\/div>$/.exec(html) || /<div class="indchart"><\/div><p class="contrib-note ind-all">([^<]*)<\/p><\/div><\/div>$/.exec(html);
        if (!at) f.push('the line is not the one paragraph directly under the bars');
        else if (at[1] !== want) f.push('the line reads ' + JSON.stringify(at[1]) + ', not ' + JSON.stringify(want));
      }
      return f;
    }
    var iProbs = [], iSeen = [];
    if (!iTpl || !iNote || !iEntry || !iOld || iParts.length !== 3) iProbs.push('premise: the amendment\'s two strings were not read from the IND-MULTI-1 entry (' + iSecs.length + ' entries hold the line)');
    else LISTS.forEach(function (L) {
      var off = L[0], el = L[1], idx = idxOf[off], tag = L.join(' ');
      var vm = D.spendSubtab(idx, off, 'industries', null, el, null, 'all', null), s = vm.streams || {}, win = vm.win;
      // reader 2: the figures on the Spend-by-candidate rows, summed
      var cards = { direct: 0, support: 0, oppose: 0 }, nCards = 0;
      D.spendSubtab(idx, off, 'candidates', null, el, null, 'all', null).groups.forEach(function (g) { g.candidates.forEach(function (c) {
        cards.direct += cents(c.figures.contributions.total); cards.support += cents(c.figures.independentSupport); cards.oppose += cents(c.figures.independentOpposition); nCards++;
      }); });
      // reader 3: the artifact's rows, in this block's own code. A candidate of the page's races that is
      // not a pointer to another race; its committee's contributions that are not dues, not other
      // receipts off the own-committee list and not in an out-of-subject cycle, dated in the window;
      // and the spending aimed at it by a committee that is no candidate's own.
      var offs = D.OFFICE_RACE_OFFICES[off], ro = {}, on = {}, own = {}, rows = { direct: 0, support: 0, oppose: 0 };
      json.races.forEach(function (r) { ro[r.id] = r.office; });
      json.candidates.forEach(function (c) { if (offs.indexOf(ro[c.race_id]) >= 0 && !c.vacating_for) on[c.id] = 1; });
      Object.keys(json.committees).forEach(function (k) { if (json.committees[k].candidate_id) own[k] = json.committees[k].candidate_id; });
      var inW = function (d) { return !!d && (win.start == null || d >= win.start) && (win.end == null || d <= win.end); };
      var cyc = function (c) { return c.cycle !== 'pre-2011' && c.cycle !== 'undated'; };
      json.contributions.forEach(function (c) {
        if (!on[own[c.committee_id]] || !cyc(c) || !inW(c.date)) return;
        if (c.contribution_type === 'IE Committee Dues Transfer' || (c.contribution_type === 'Other Receipt' && !c.is_own_committee)) return;
        rows.direct += cents(c.amount);
      });
      json.independent_expenditures.forEach(function (ie) {
        if (own[ie.spender_committee_id] || !on[ie.target_candidate_id] || !cyc(ie) || !inW(ie.date)) return;
        rows[ie.stance === 'oppose' ? 'oppose' : 'support'] += cents(ie.amount);
      });
      ['direct', 'support', 'oppose'].forEach(function (k) {
        if (cents(s[k]) !== cards[k] || cents(s[k]) !== rows[k]) iProbs.push(tag + ': ' + k + ' is ' + cents(s[k]) + ' cents on the tab, ' + cards[k] + ' over the Spend by candidate tab\'s rows, ' + rows[k] + ' recounted');
      });
      var bars = vm.industries.reduce(function (a, x) { return a + cents(x.direct); }, 0);
      if (bars < cents(s.direct)) iProbs.push(tag + ': the bars\' direct amounts sum to less than the direct total');
      var html = R.renderSpend(vm, off);
      indProblems(html, s).forEach(function (p) { iProbs.push(tag + ': ' + p); });
      if (count(pageOf(D, idx, off, 'spend', el, 'industries'), '<p class="contrib-note ind-all">' + allLine(s) + '</p>') !== 1) iProbs.push(tag + ': the page does not carry the line');
      iSeen.push(tag + ' ' + ['direct', 'support', 'oppose'].map(function (k) { return money0(s[k]); }).join(' / ') + ' on ' + nCards + ' rows (bars\' direct ' + money0((bars - cents(s.direct)) / 100) + ' more)');
    });
    T.ok('[IND/ALL] the Industry totals note ends with the register\'s sentence and one line directly under the bars states, in ' +
      'the register\'s words and whole dollars, what the page\'s candidates were given directly and what outside groups spent for ' +
      'and against them; each of the three equals, to the cent, that figure summed over every row of the Spend by candidate tab ' +
      'for the same election (its sections for the other election\'s races included) and a recount of the artifact\'s rows, on ' +
      'every election of both pages; a stream that is zero on a list is left out with its separator — ' +
      (iProbs.length ? iProbs.slice(0, 4).join('; ') : iSeen.join('; ')),
      iProbs.length === 0 && iSeen.length === LISTS.length);
    // The zero half, stated on constructed view-models: every combination of the three streams at zero
    // or not, with no bar and with one. No page's money is a premise of it.
    var zProbs = [], zN = 0;
    if (iTpl && iNote && iParts.length === 3) {
      [[], [{ industry: 'zz-constructed', direct: 1, support: 0, oppose: 0, total: 1 }]].forEach(function (barsVm) {
        [0, 1].forEach(function (a) { [0, 1].forEach(function (b) { [0, 1].forEach(function (c) {
          var s = { direct: a * 1234.4, support: b * 56.5, oppose: c * 7 }, html = R.renderSpend({ tab: 'industries', industries: barsVm, streams: s }, 'school_board');
          var n = a + b + c, want = allLine(s), tag = [a, b, c].join('') + (barsVm.length ? ' under a bar' : ''); zN++;
          if ((n === 0) !== (want === null) || (want && count(want, ' \u00b7 ') !== n - 1)) zProbs.push('the expectation for ' + tag + ' is malformed');
          indProblems(html, s).forEach(function (p) { zProbs.push(tag + ': ' + p); });
          if (/\$0 in /.test(html)) zProbs.push(tag + ': a zero stream is printed');
          if (n === 0 && html.indexOf('ind-all') >= 0) zProbs.push(tag + ': a line is drawn with all three at zero');
        }); }); });
      });
    }
    T.ok('[IND/ZERO] a stream at zero is left out together with its separator, in every one of the eight combinations, with no ' +
      'bar above the line and with one, and with all three at zero no line is drawn — ' +
      (zProbs.length ? zProbs.slice(0, 4).join('; ') : zN + ' constructed view-models'), zN === 16 && zProbs.length === 0);
    (function () {
      if (!iTpl || !iNote) { T.ok('[IND/ALL:bite] (the strings were not read)', false); return; }
      // on the first list's own bars, with three constructed streams, so that no live list need carry all three
      var L = LISTS[0], vm = { tab: 'industries', industries: D.spendSubtab(idxOf[L[0]], L[0], 'industries', null, L[1]).industries, streams: { direct: 1234.4, support: 56.5, oppose: 7 } };
      var s = vm.streams, html = R.renderSpend(vm, L[0]);
      var line = '<p class="contrib-note ind-all">' + allLine(s) + '</p>';
      var bites = [
        html.replace(line, line.replace(money0(s.support), money0(s.support + 1))),                       // one figure a dollar out
        html.replace(line, line.replace(' · ' + iParts[2].replace('{oppose}', money0(s.oppose)), '')), // a stream left out that is not zero
        html.replace(line, '').replace('<div class="indchart">', line + '<div class="indchart">'),          // the line above the bars
        html.replace(line, ''),                                                                              // no line
        html.replace('donor’s money once.</p>', 'donor\'s money once.</p>'),                         // the straight apostrophe
        html.replace(iNote, iOld.slice(0, -1) + '.')                                                         // the sentence as it read before
      ].map(function (h) { return h !== html && indProblems(h, s).length > 0; });
      var zeroPrinted = indProblems(R.renderSpend({ tab: 'industries', industries: [], streams: { direct: 5, support: 0, oppose: 0 } }, 'school_board')
        .replace('in direct contributions.', 'in direct contributions · $0 in independent support.'), { direct: 5, support: 0, oppose: 0 }).length > 0;
      T.ok('[IND/ALL:bite] one figure a dollar out, a stream left out, the line above the bars, no line, the clause with a straight ' +
        'apostrophe, the sentence as it read before, and a zero stream printed each make the check fire — ' +
        (bites.filter(Boolean).length + (zeroPrinted ? 1 : 0)) + ' of ' + (bites.length + 1),
        !!L && indProblems(html, s).length === 0 && bites.every(Boolean) && zeroPrinted);
    })();

    // ================= PS-155: group names =================
    // The expectation, from the artifact's other carrier of the group's name.
    var dn = json.donors || {};
    var stored = function (pid) { return (dn[pid] && dn[pid].name) || pid; };
    var groupName = function (pid) { return (dn[pid] && dn[pid].cluster_name) || null; };
    var expName = function (pid) { return groupName(pid) || stored(pid); };
    var kids = {};   // rolled-up id -> every record the artifact holds under it
    Object.keys(dn).forEach(function (id) { var p = dn[id].parent_id || id; (kids[p] || (kids[p] = [])).push(id); });
    // every name a donor is found by: a grouped donor's group and its members' stored names; else its own
    var namesOf = function (pid) {
      var out = [expName(pid)];
      if (groupName(pid)) (kids[pid] || []).forEach(function (m) { if (out.indexOf(stored(m)) < 0) out.push(stored(m)); });
      return out;
    };
    var sameSet = function (a, b) { return a.length === b.length && a.slice().sort().join('\n') === b.slice().sort().join('\n'); };

    // The page as it read before PS-155, for the bites: the same index with the table the name resolver
    // reads emptied, in a shallow copy. Rows still roll up by parent_id; the group's name and its
    // members' names are out of the page's reach, as they were.
    var blindOf = function (idx) { return Object.assign({}, idx, { clusterByParent: {} }); };
    // The view-models of one list: the five Election spend tabs, every race view, and the pop-ups of
    // every grouped donor row, every twentieth other row and every outside-spending group's row.
    function vmsOf(Dx, idx, L) {
      var off = L[0], el = L[1], o = { races: {}, pop: {}, cmte: {} };
      ['donors', 'candidates', 'industries', 'industry-candidate', 'flags'].forEach(function (t) { o[t] = Dx.spendSubtab(idx, off, t, null, el, null, 'all', null); });
      Dx.viewModels.officeRaces(idx, off, el).groups.forEach(function (g) { g.races.forEach(function (r) { o.races[r.slug] = Dx.viewModels.raceView(idx, idx.raceBySlug[r.slug], null); }); });
      o.donors.rows.forEach(function (r, i) {
        if (r.kind === 'ie') o.cmte[r.committee_id] = Dx.committeeProfile(idx, r.committee_id, o.donors.win);
        else if (groupName(r.parent_id) || i % 20 === 0) o.pop[r.parent_id] = Dx.donorFootprint(idx, r.parent_id, o.donors.win);
      });
      return o;
    }
    function named(v, out) {   // every object that names a donor, in order
      if (Array.isArray(v)) v.forEach(function (x) { named(x, out); });
      else if (v && typeof v === 'object') { if ('parent_id' in v && 'name' in v) out.push(v); Object.keys(v).forEach(function (k) { named(v[k], out); }); }
      return out;
    }
    // [GROUP/NAME] every printed donor name, in the view-models and in the markup rendered from them.
    var newStat = function () { return { rows: 0, lines: 0, own: 0, funders: 0, primarily: 0, pops: 0, members: 0, renamed: 0, memberDiffers: 0, primarilyRenamed: 0, attrs: 0 }; };
    var nProbs = [], nStat = newStat(), nBite = [];
    var note = function (p) { if (nProbs.length < 8) nProbs.push(p); };
    var primarilyOf = function (funders) { return funders.slice(0, 3).map(function (f) { return expName(f.parent_id); }); };
    function nameProblems(L, vm, say, nStat) {
      var tag = L.join(' ');
      // the view-models: every object that names a donor
      named(vm, []).forEach(function (x) { if (x.name !== expName(x.parent_id)) say(tag + ': the view-model names ' + x.parent_id + ' ' + JSON.stringify(x.name) + ', not ' + JSON.stringify(expName(x.parent_id))); });
      // Browse donors
      var bdoc = parse(R.renderSpend(vm.donors, L[0])), brow = all(bdoc, '.spend-body button[data-funder]'), irow = all(bdoc, '.spend-body button[data-committee]');
      var drows = vm.donors.rows.filter(function (r) { return r.kind === 'donor'; }), irows = vm.donors.rows.filter(function (r) { return r.kind === 'ie'; });
      if (brow.length !== drows.length || irow.length !== irows.length) say(tag + ': Browse donors renders ' + brow.length + ' donor rows for ' + drows.length);
      else {
        brow.forEach(function (el, k) {
          var pid = el.getAttribute('data-funder'); nStat.rows++;
          if (pid !== drows[k].parent_id || printed(el) !== expName(pid)) say(tag + ': Browse donors prints ' + JSON.stringify(printed(el)) + ' for ' + pid);
          if (expName(pid) !== stored(pid)) nStat.renamed++;
        });
        irow.forEach(function (el, k) {
          var want = primarilyOf(D.spenderFunders(idxOf[L[0]], irows[k].committee_id).funders), sub = el.querySelector('.who .sub');
          if (want.length && (!sub || sub.textContent !== 'Funded primarily by ' + want.join(', '))) say(tag + ': the group row ' + irows[k].committee_id + ' reads ' + JSON.stringify(sub && sub.textContent));
          if (want.length) { nStat.primarily++; if (want.some(function (n, j) { return n !== stored(D.spenderFunders(idxOf[L[0]], irows[k].committee_id).funders[j].parent_id); })) nStat.primarilyRenamed++; }
        });
      }
      // every race view: a card's contributor lines (its own-money line among them), and its outside-spending groups' funders
      Object.keys(vm.races).forEach(function (slug) {
        var rv = vm.races[slug], doc = parse(R.renderRaceView(rv));
        (rv.candidates || []).forEach(function (c) {
          if (!c.hasFinance) return;
          var panel = byId(doc, 'd-' + c.slug + '-c'), lines = c.contributors.lines;
          var clickable = lines.filter(function (l) { return !l.isSelf && !l.isAggregate; }), plain = lines.filter(function (l) { return l.isSelf || l.isAggregate; });
          var got = panel ? all(panel, 'button.crow[data-funder]') : [], gotPlain = panel ? all(panel, '.crow.plain:not(.smallgift)') : [];   // 74a: the small-gifts line is not a contributor line (PS-96)
          if (got.length !== clickable.length || gotPlain.length !== plain.length) { say(tag + ' ' + c.id + ': the card does not render one row per contributor line'); return; }
          got.forEach(function (el, k) {
            var pid = el.getAttribute('data-funder'), attr = el.getAttribute('data-names'); nStat.lines++;
            if (pid !== clickable[k].parent_id || printed(el) !== expName(pid)) say(tag + ' ' + c.id + ': the contributor line of ' + pid + ' prints ' + JSON.stringify(printed(el)));
            // the names the card's search box reads: every name of a grouped donor, and nothing on a donor in no group
            if (namesOf(pid).length > 1) { nStat.attrs++; if (attr == null || !sameSet(attr.split('\n'), namesOf(pid))) say(tag + ' ' + c.id + ': the line of ' + pid + ' does not carry its group\'s names'); }
            else if (attr != null) say(tag + ' ' + c.id + ': the line of ' + pid + ', in no group, carries names');
          });
          if (!sameSet(gotPlain.map(printed), plain.map(function (l) { return expName(l.parent_id); }))) say(tag + ' ' + c.id + ': an own-money or small-dollar line prints another name');
          nStat.own += plain.filter(function (l) { return l.isSelf; }).length;
          [['s', c.ieSupportDetail], ['o', c.ieOpposeDetail]].forEach(function (d) {
            ((d[1] || {}).spenders || []).forEach(function (sp, n) {
              var t2 = byId(doc, 'd-' + c.slug + '-' + d[0] + '-' + n), lead = t2 && t2.querySelector('.ie-lead'), want = primarilyOf(sp.funders);
              if (!t2) { say(tag + ' ' + c.id + ': no funder list for ' + sp.spender_committee_id); return; }
              if (want.length && (!lead || lead.textContent !== 'Funded primarily by ' + want.join(', ') + '.')) say(tag + ' ' + c.id + ': ' + sp.spender_committee_id + ' reads ' + JSON.stringify(lead && lead.textContent));
              var fr = all(t2, 'button.crow[data-funder]');
              if (fr.length !== sp.funders.length) say(tag + ' ' + c.id + ': ' + sp.spender_committee_id + ' renders ' + fr.length + ' funder rows for ' + sp.funders.length);
              else fr.forEach(function (el, k) { nStat.funders++; if (el.getAttribute('data-funder') !== sp.funders[k].parent_id || printed(el) !== expName(sp.funders[k].parent_id)) say(tag + ' ' + c.id + ': a funder line of ' + sp.spender_committee_id + ' prints ' + JSON.stringify(printed(el))); });
            });
          });
        });
      });
      // the donor's pop-up: its title, the sentence under it, and its members under their own names
      Object.keys(vm.pop).forEach(function (pid) {
        var fp = vm.pop[pid], doc = parse(R.renderFunderModal(fp)), title = doc.querySelector('.modal-name'), b = doc.querySelector('.modal-note b'); nStat.pops++;
        if (!title || title.textContent !== expName(pid) || !b || b.textContent !== expName(pid)) say(tag + ': the pop-up of ' + pid + ' is titled ' + JSON.stringify(title && title.textContent));
        var mem = all(doc, '.elect-rollup-name').map(function (e) { return e.textContent; }), wantMem = fp.rollup ? fp.rollup.members.map(function (m) { return stored(m.id); }) : [];
        if (mem.join('\n') !== wantMem.join('\n')) say(tag + ': the pop-up of ' + pid + ' does not list its members under their stored names');
        nStat.members += mem.length; if (mem.some(function (n) { return n !== expName(pid); })) nStat.memberDiffers++;
        all(doc, 'button[data-committee] .who .sub').forEach(function (sub) {
          var key = sub.parentNode.parentNode.getAttribute('data-committee'), want = primarilyOf(D.spenderFunders(idxOf[L[0]], key).funders);
          if (sub.textContent !== 'Funded primarily by ' + want.join(', ')) say(tag + ': in the pop-up of ' + pid + ', ' + key + ' reads ' + JSON.stringify(sub.textContent));
        });
      });
      // an outside-spending group's pop-up: the names after "Funded primarily by", and its funders' lines
      Object.keys(vm.cmte).forEach(function (key) {
        var p = vm.cmte[key], doc = parse(R.renderCommitteeProfile(p)), noteEl = doc.querySelector('.modal-note'), want = primarilyOf(p.funders);
        var lead = 'Funded primarily by ' + want.join(', ') + '. ';
        if (want.length && (!noteEl || noteEl.textContent.slice(0, lead.length) !== lead)) say(tag + ': the pop-up of ' + key + ' reads ' + JSON.stringify(noteEl && noteEl.textContent.slice(0, 90)));
        all(doc, 'button.crow[data-funder]').forEach(function (el, k) { nStat.funders++; if (el.getAttribute('data-funder') !== p.funders[k].parent_id || printed(el) !== expName(p.funders[k].parent_id)) say(tag + ': a funder line of ' + key + ' prints ' + JSON.stringify(printed(el))); });
      });
    }
    var NOF = { search: '', type: 'All', industry: 'All', flag: 'All' };
    var sProbs = [], sSeen = [], sOldMiss = 0, sOldAsked = 0;
    var found = function (Dx, idx, L, q) { return Dx.spendSubtab(idx, L[0], 'donors', null, L[1], Object.assign({}, NOF, { search: q }), 'all', null).rows.map(function (r) { return r.parent_id || r.committee_id; }); };
    function searchOf(L, donorsVm, blind) {
      var tag = L.join(' '), U = donorsVm.rows, win = donorsVm.win, idx = idxOf[L[0]];
      var has = function (hay, q) { return String(hay || '').toLowerCase().indexOf(q.toLowerCase()) >= 0; };
      var want = function (q) { return U.filter(function (r) { return r.kind === 'ie' ? has(r.name, q) : namesOf(r.parent_id).some(function (n) { return has(n, q); }); }).map(function (r) { return r.parent_id || r.committee_id; }); };
      var inWin = {}; json.contributions.forEach(function (c) { if (c.date && c.date >= win.start && c.date <= win.end) inWin[c.donor_id] = 1; });
      var grouped = U.filter(function (r) { return r.kind === 'donor' && groupName(r.parent_id); });
      // a member's stored name that is found in neither the printed name nor the canonical record's name
      var foreign = function (r, test) { return (kids[r.parent_id] || []).filter(function (m) { return m !== r.parent_id && !has(r.name, stored(m)) && !has(stored(r.parent_id), stored(m)) && (!test || test(m)); })[0]; };
      var a = grouped.filter(function (r) { return r.name !== stored(r.parent_id) && !has(stored(r.parent_id), r.name); })[0];
      var b = grouped.filter(function (r) { return foreign(r); })[0];
      var c = grouped.filter(function (r) { return foreign(r, function (m) { return !inWin[m]; }); })[0];
      var plainRow = U.filter(function (r) { return r.kind === 'donor' && !groupName(r.parent_id); })[0];
      if (!a || !b || !c || !plainRow) { sProbs.push(tag + ': premise: the list offers no grouped row for one of the three kinds of name, or no row in no group'); return; }
      var cases = [
        ['the group\'s name', a.name.toUpperCase(), a.parent_id, true],
        ['a member\'s stored name', stored(foreign(b)).toLowerCase(), b.parent_id, true],
        ['the stored name of a member with no gift in the election', stored(foreign(c, function (m) { return !inWin[m]; })).toUpperCase(), c.parent_id, true],
        ['a donor in no group, by its name', plainRow.name.toLowerCase(), plainRow.parent_id, false],
        ['the printed text of a row, in part', a.name.slice(1, 7), a.parent_id, null],
        ['"frank"', 'frank', null, null],
        ['a text no name holds', 'zz-no-such-donor-zz', null, null]];
      cases.forEach(function (k) {
        var got = found(D, idx, L, k[1]), exp = want(k[1]);
        if (got.join('\n') !== exp.join('\n')) sProbs.push(tag + ': ' + k[0] + ' ' + JSON.stringify(k[1]) + ' returns ' + got.length + ' rows, expected ' + exp.length);
        if (k[2] && got.indexOf(k[2]) < 0) sProbs.push(tag + ': ' + k[0] + ' ' + JSON.stringify(k[1]) + ' does not find ' + k[2]);
        // BITE, and the control beside it: the blind page does not find the donor in the three group cases;
        // and for every text the rows it finds that are not grouped donors are the rows found now (a donor
        // in no group, and an outside-spending group, are found as before)
        var was = found(D, blind, L, k[1]);
        if (k[3] === true) { sOldAsked++; if (was.indexOf(k[2]) < 0) sOldMiss++; }
        if (was.filter(function (id) { return !groupName(id); }).join('\n') !== got.filter(function (id) { return !groupName(id); }).join('\n')) sProbs.push(tag + ': ' + k[0] + ': the rows found that are not grouped donors changed');
      });
      // Constructed (mode E), on the first grouped row: a member the artifact holds with no row of its own
      // (the ingest prunes such records today, so no live group has one) is still a name the group is
      // found by: a group's members are all the members the data file holds for it. Only the member's
      // record and its place in the group's list are added, in a shallow copy.
      var g0 = grouped[0], g0cid = (dn[g0.parent_id] || {}).cluster_id, ghost = 'zz-gate-member-with-no-row', ghostName = 'Zz Gate Member With No Row';
      var gd = Object.assign({}, json.donors), gc = Object.assign({}, json.donor_clusters);
      gd[ghost] = Object.assign({}, dn[g0.parent_id], { id: ghost, name: ghostName, parent_id: g0.parent_id });
      gc[g0cid] = Object.assign({}, gc[g0cid], { members: ((gc[g0cid] || {}).members || []).concat([ghost]) });
      var gx = D.loadData(Object.assign({}, json, { donors: gd, donor_clusters: gc }), { office: L[0] });
      var gGot = found(D, gx, L, ghostName.toLowerCase());
      if (!g0cid || gGot.length !== 1 || gGot[0] !== g0.parent_id) sProbs.push(tag + ': a member with no row of its own does not find its group (' + gGot.length + ' rows)');
      sOldAsked++; if (found(D, blindOf(gx), L, ghostName.toLowerCase()).length === 0) sOldMiss++;
      if (L[0] === 'school_board' && !found(D, idx, L, 'frank').length) sProbs.push(tag + ': "frank" finds nothing');
      if (found(D, idx, L, 'zz-no-such-donor-zz').length) sProbs.push(tag + ': a text no name holds finds a row');
      sSeen.push(tag + ': ' + cases.slice(0, 3).map(function (k) { return JSON.stringify(k[1]) + ' → ' + JSON.stringify(expName(k[2])); }).join(', ') + '; "frank" ' + found(D, idx, L, 'frank').length + ' rows');
    }
    // One list at a time, and nothing kept of it: the three lists' view-models, twice over, are more
    // than this gate should hold at once. The hosts of the constructed checks below are noted as the
    // lists go by.
    var ownHost = null, escHost = null;
    LISTS.forEach(function (L) {
      var b = vmsOf(D, idxOf[L[0]], L), blind = blindOf(idxOf[L[0]]);
      nameProblems(L, b, note, nStat);
      searchOf(L, b.donors, blind);
      // [GROUP/OWN]'s host: the card, lowest by candidate id, that has an own-money line
      Object.keys(b.races).forEach(function (slug) { (b.races[slug].candidates || []).forEach(function (c) {
        var l = c.hasFinance ? c.contributors.lines.filter(function (x) { return x.isSelf; })[0] : null;
        if (l && (!ownHost || c.id < ownHost.id)) ownHost = { L: L, slug: slug, id: c.id, cslug: c.slug, pid: l.parent_id };
      }); });
      // [ESC/NAME]'s host: the first outside-spending group's row whose leading funder has a row on the same list
      if (!escHost) b.donors.rows.forEach(function (x) {
        var f = (!escHost && x.kind === 'ie') ? D.spenderFunders(idxOf[L[0]], x.committee_id).funders[0] : null;
        if (f && b.donors.rows.some(function (y) { return y.kind === 'donor' && y.parent_id === f.parent_id; })) escHost = { L: L, key: x.committee_id, pid: f.parent_id };
      });
      // [GROUP/NAME]'s bite: the blind page's view-models, read the same way
      b = null;
      var n = 0; nameProblems(L, vmsOf(D, blind, L), function () { n++; }, newStat()); nBite.push(n);
    });
    T.ok('[GROUP/NAME] wherever the tool prints a donor, a donor IPG has grouped prints the group\'s name as the artifact carries it ' +
      'on the donor\'s own record, and a donor in no group prints its stored name: Browse donors rows, candidates\' contributor ' +
      'lines (own-money and small-dollar lines among them), outside-spending groups\' funder lines and the names after "Funded ' +
      'primarily by", the donor pop-up\'s title and sentence; the pop-up\'s member rows keep each member\'s stored name; a grouped ' +
      'donor\'s line on a card carries every name of the group, and no other line carries any — ' +
      (nProbs.length ? nProbs.join('; ') : nStat.rows + ' donor rows (' + nStat.renamed + ' under a group\'s name that is not the record\'s), ' + nStat.lines +
        ' contributor lines (' + nStat.attrs + ' carrying names), ' + nStat.own + ' own-money lines, ' + nStat.funders + ' funder lines, ' + nStat.primarily +
        ' "Funded primarily by" (' + nStat.primarilyRenamed + ' naming a group; the constructed case is [ESC/NAME]\'s), ' + nStat.pops + ' pop-ups, ' + nStat.members + ' member rows (' +
        nStat.memberDiffers + ' pop-ups with a member named otherwise than the title)'),
      nProbs.length === 0 && nStat.renamed > 0 && nStat.attrs > 0 && nStat.memberDiffers > 0 && nStat.pops > 0);
    // BITE: the same reading of the page as it read before (the resolver's table emptied) must report, on every list.
    T.ok('[GROUP/NAME:bite] read the same way, the page with the groups\' names out of its reach, as it read before, is reported ' +
      'on every list — ' + nBite.join(', ') + ' findings',
      nBite.length === LISTS.length && nBite.every(function (n) { return n > 0; }));

    T.ok('[GROUP/SEARCH] the Browse donors box finds a grouped donor by the group\'s name, by a member\'s stored name, by the ' +
      'name of a member that gave nothing in the election on screen and (constructed) by the name of a member with no row at all, ' +
      'whatever the capitals; a donor in no group is found as ' +
      'before; and for every text tried the rows returned are exactly the rows one of whose names holds it — ' +
      (sProbs.length ? sProbs.slice(0, 4).join('; ') : sSeen.join('; ')), sProbs.length === 0 && sSeen.length === LISTS.length);
    T.ok('[GROUP/SEARCH:bite] asked the same, the page with the groups\' names out of its reach, as it read before, does not find ' +
      'the grouped donor in any of the group cases — ' + sOldMiss + ' of ' + sOldAsked + ' not found', sOldAsked === 4 * LISTS.length && sOldMiss === sOldAsked);

    // A constructed group name on a live host. `renamed(js, pid, name)` is the artifact with the donor's
    // group renamed (or, for a donor in no group, a group of one made for it), on both carriers of the
    // name, in a shallow copy: only the name moves.
    var MARK = 'Zed <i data-gate-esc="1">&amp; & Sons</i> "Group"';
    function renamed(js, pid, name) {
      var dc = Object.assign({}, js.donor_clusters), dd = Object.assign({}, js.donors), cid = (js.donors[pid] || {}).cluster_id || 'rollup-gate';
      dc[cid] = Object.assign({ canonical_id: pid, members: [pid], roles: {}, relationship: 'affiliated entities' }, dc[cid] || {}, { name: name });
      (dc[cid].members || []).forEach(function (m) { if (dd[m]) dd[m] = Object.assign({}, dd[m], { cluster_id: cid, cluster_name: name }); });
      return Object.assign({}, js, { donor_clusters: dc, donors: dd });
    }
    // markup made from the name, anywhere in a document, and the name as text in a node
    var marked = function (doc) { return doc.querySelectorAll('[data-gate-esc]').length; };
    var reads = function (node) { return !!node && node.textContent.indexOf(MARK) >= 0; };

    // [GROUP/OWN] the candidate's own-money line: the card, lowest by candidate id, of either page that
    // has one (noted above), its donor's group given a name of its own.
    (function () {
      var hostC = ownHost;
      if (!hostC) { T.ok('[GROUP/OWN] (premise: no card of either page has an own-money line)', false); T.ok('[GROUP/OWN:bite] (no host)', false); return; }
      var ix = D.loadData(renamed(json, hostC.pid, MARK), { office: hostC.L[0] });
      var rv = D.viewModels.raceView(ix, ix.raceBySlug[hostC.slug], null), doc = parse(R.renderRaceView(rv));
      var lx = idxOf[hostC.L[0]], cardEl = byId(doc, 'cand-' + hostC.cslug), live = byId(parse(R.renderRaceView(D.viewModels.raceView(lx, lx.raceBySlug[hostC.slug], null))), 'cand-' + hostC.cslug);
      var line = cardEl ? all(cardEl, '.crow.plain').filter(function (el) { return !!el.querySelector('.tagchip.self'); })[0] : null;
      var liveLine = live ? all(live, '.crow.plain').filter(function (el) { return !!el.querySelector('.tagchip.self'); })[0] : null;
      T.ok('[GROUP/OWN] the line for a candidate\'s own money prints the donor\'s group\'s name, as text, with its chip and its ' +
        'figure unchanged — ' + hostC.id + ' (' + hostC.L.join(' ') + '), donor ' + hostC.pid + ', live ' + JSON.stringify(liveLine && printed(liveLine)),
        !!line && !!liveLine && printed(line) === MARK && printed(liveLine) === expName(hostC.pid) && marked(doc) === 0 &&
        line.querySelector('.amt').textContent === liveLine.querySelector('.amt').textContent &&
        cardEl.querySelector('.selfline').textContent === live.querySelector('.selfline').textContent);
      // BITE: the same card from the same constructed artifact, on the page as it read before.
      var ox = blindOf(ix);
      var oCard = byId(parse(R.renderRaceView(D.viewModels.raceView(ox, ox.raceBySlug[hostC.slug], null))), 'cand-' + hostC.cslug);
      var oLine = oCard ? all(oCard, '.crow.plain').filter(function (el) { return !!el.querySelector('.tagchip.self'); })[0] : null;
      T.ok('[GROUP/OWN:bite] from the same constructed artifact, the page with the groups\' names out of its reach prints the ' +
        'record\'s stored name on that line, not the group\'s', !!oLine && printed(oLine) === stored(hostC.pid) && printed(oLine) !== MARK);
    })();

    // [ESC/NAME] (ruling 10): a name that carries markup prints as text. The host is the leading funder
    // of the first outside-spending group's row whose leading funder has a row on the same list; the name is set on its
    // group, so it reaches every place a funder is named. Each surface is rendered, parsed, and must
    // hold no element made from the name and must read the name itself, character for character
    // (which a name escaped twice does not).
    (function () {
      if (!escHost) { T.ok('[ESC/NAME] (premise: no outside-spending group\'s row has a leading funder with a row of its own)', false); T.ok('[ESC/NAME:bite] (no host)', false); return; }
      var L = escHost.L, key = escHost.key, pid = escHost.pid;
      var surfaces = function (js) {
        var ix = D.loadData(js, { office: L[0] }), vm = D.spendSubtab(ix, L[0], 'donors', null, L[1], null, 'all', null), win = vm.win, out = [];
        var bdoc = parse(R.renderSpend(vm, L[0]));
        out.push(['the group\'s row on Browse donors', bdoc, bdoc.querySelector('button[data-committee="' + key + '"] .who')]);
        out.push(['the funder\'s row on Browse donors', bdoc, bdoc.querySelector('button[data-funder="' + pid + '"] .who')]);
        var prof = D.committeeProfile(ix, key, win), pdoc = parse(R.renderCommitteeProfile(prof));
        out.push(['the group\'s pop-up, after "Funded primarily by"', pdoc, pdoc.querySelector('.modal-note')]);
        out.push(['the group\'s pop-up, its title', pdoc, pdoc.querySelector('.modal-name')]);
        out.push(['the group\'s pop-up, the funder\'s line', pdoc, pdoc.querySelector('button[data-funder="' + pid + '"] .who')]);
        var fdoc = parse(R.renderFunderModal(D.donorFootprint(ix, pid, win)));
        out.push(['the funder\'s pop-up, its title', fdoc, fdoc.querySelector('.modal-name')]);
        out.push(['the funder\'s pop-up, its sentence', fdoc, fdoc.querySelector('.modal-note b')]);
        out.push(['the funder\'s pop-up, the group\'s row', fdoc, fdoc.querySelector('button[data-committee="' + key + '"] .who')]);
        var t = prof.targets.filter(function (x) { return !!x.candidate_id; })[0], cand = t ? ix.candidateById[t.candidate_id] : null;
        var d = cand ? D.candidateIE(ix, cand.id, t.support > 0 ? 'support' : 'oppose', null, win) : null;
        var idoc = d ? parse(R.iePanel(d, cand.name, 'gate')) : null, n = d ? d.spenders.map(function (s) { return s.spender_committee_id; }).indexOf(key) : -1;
        out.push(['a card\'s outside-spending panel, the group\'s head', idoc, idoc && n >= 0 ? all(idoc, '.ie-cmte-toggle')[n] : null]);
        out.push(['a card\'s outside-spending panel, after "Funded primarily by"', idoc, idoc && n >= 0 ? idoc.querySelector('#gate-' + n + ' .ie-lead') : null]);
        out.push(['a card\'s outside-spending panel, the funder\'s line', idoc, idoc && n >= 0 ? idoc.querySelector('#gate-' + n + ' button[data-funder="' + pid + '"] .who') : null]);
        return out;
      };
      // twice: the group under its own name, and with no name resolved for it, where the funders' names stand in its place
      var named1 = renamed(json, pid, MARK);
      var anon = Object.assign({}, named1, { committees: Object.assign({}, named1.committees) });
      anon.committees[key] = Object.assign({}, anon.committees[key], { committee_name: 'IE committee 1' });
      var eProbs = [], eN = 0;
      // in which of these the name is expected: wherever the funder is named. Under its own name the group's
      // title and head name the group only; with no name resolved they carry the funders' names instead.
      [['named', named1, { 'the group\'s pop-up, its title': 0, 'a card\'s outside-spending panel, the group\'s head': 0 }], ['with no name resolved', anon, {}]].forEach(function (c) {
        surfaces(c[1]).forEach(function (s) {
          eN++;
          if (!s[1] || !s[2]) { eProbs.push(c[0] + ': ' + s[0] + ' was not rendered'); return; }
          if (marked(s[1])) eProbs.push(c[0] + ': ' + s[0] + ' is in a document where the name became markup');
          if ((c[2][s[0]] !== 0) && !reads(s[2])) eProbs.push(c[0] + ': ' + s[0] + ' does not read the name as text (' + JSON.stringify(s[2].textContent.slice(0, 70)) + ')');
        });
      });
      // BITE, on the rendered pop-up: the name put in unescaped, as the line read before; and the name escaped twice.
      var ixb = D.loadData(named1, { office: L[0] }), ph = R.renderCommitteeProfile(D.committeeProfile(ixb, key, D.spendSubtab(ixb, L[0], 'donors', null, L[1]).win));
      var rawDoc = parse(ph.split(escH(MARK)).join(MARK)), twiceDoc = parse(ph.split(escH(MARK)).join(escH(escH(MARK))));
      T.ok('[ESC/NAME] a funder\'s group, given a constructed name that carries <, &, quotation marks and an entity, prints under ' +
        'that name, as text and once escaped, wherever a funder is named, the names after "Funded primarily by" among them: on Browse donors, in the outside-spending group\'s pop-up and after its "Funded primarily by", in the ' +
        'funder\'s own pop-up, and in a card\'s outside-spending panel; with the group named and with no name resolved for it — ' +
        (eProbs.length ? eProbs.slice(0, 4).join('; ') : eN + ' surfaces, ' + key + ' and its funder ' + pid + ' (' + L.join(' ') + ')'),
        eN === 22 && eProbs.length === 0 && count(ph, escH(MARK)) >= 2);
      T.ok('[ESC/NAME:bite] the pop-up with the name put in unescaped holds markup made from it, and with the name escaped twice ' +
        'does not read it',
        marked(parse(ph)) === 0 && reads(parse(ph).querySelector('.modal-note')) && marked(rawDoc) > 0 && !reads(twiceDoc.querySelector('.modal-note')));
    })();

    // [GROUP/SEARCH] the Browse donors box. For a typed text, the rows the list returns are exactly the
    // rows of the unfiltered list that the text is found in, case-blind: for a donor, any one of its
    // names (namesOf); for an outside-spending group, its own name. The texts are taken from the list
    // itself by rule: the first row, by rank, that offers each kind.
    // [REVIEW/CHIP] the review mark on the two surfaces [spend.C] does not read: an outside-spending
    // group's head on its candidate's card (render.js, iePanel) and the group's row in the person
    // pop-up. In [spend.C]'s manner, PS-128 mode E. Constructed: the document (a deep copy of the
    // registry alone, holding one outside-spending row and no contribution) and the row's flag.
    // Live: the row, which is the first in the artifact's order, aimed at a school-board candidate
    // with a committee, that the page draws in both places. Premise asserted: the group's head and
    // its person-pop-up row render in both variants. Each variant is the other's control.
    (function () {
      var office = 'school_board', CHIP = '⚑ needs review';
      var offs = D.OFFICE_RACE_OFFICES[office], ro = {}, cById = {};
      json.races.forEach(function (r) { ro[r.id] = r.office; });
      json.candidates.forEach(function (c) { cById[c.id] = c; });
      var seeds = (json.independent_expenditures || []).filter(function (x) {
        var c = cById[x.target_candidate_id];
        return !!c && !!c.committee_id && !c.vacating_for && offs.indexOf(ro[c.race_id]) >= 0 &&
          !(json.committees[x.spender_committee_id] || {}).candidate_id && !D.EXCLUDED_CYCLES[x.cycle];
      });
      function variant(seed, flagged) {
        var cp = JSON.parse(JSON.stringify({ races: json.races, candidates: json.candidates, committees: json.committees, donors: {}, contributions: [],
          rollups: { by_candidate_election: (json.rollups || {}).by_candidate_election, by_person: (json.rollups || {}).by_person }, independent_expenditures: [seed] }));
        var row = cp.independent_expenditures[0];
        row.id = 'zz-review-chip'; row.match_method = 'surname_plus_given'; row.needs_review = flagged;
        var ix = D.loadData(cp, { office: office }), cand = ix.candidateById[seed.target_candidate_id];
        var rvw = D.viewModels.raceView(ix, cand.race_id, null), raceHtml = R.renderRaceView(rvw);
        var vmc = rvw.candidates.filter(function (c) { return c.id === cand.id; })[0];
        var cardEl = vmc ? byId(parse(raceHtml), 'cand-' + vmc.slug) : null, heads = cardEl ? all(cardEl, '.ie-cmte-toggle') : [];
        var pv = D.personView(ix, cand.id), personHtml = pv ? R.renderPersonModal(pv) : '';
        var prow = all(parse(personHtml), 'button.person-ie-cmte[data-committee="' + seed.spender_committee_id + '"]');
        var chips = function (els) { return els.reduce(function (n, e) { return n + all(e, '.tagchip.flag').filter(function (t) { return t.textContent === CHIP; }).length; }, 0); };
        return { rendered: heads.length === 1 && prow.length === 1, card: chips(heads), person: chips(prow), whole: count(raceHtml, CHIP) + count(personHtml, CHIP) };
      }
      var seed = null, off = { rendered: false, card: -1, person: -1, whole: -1 }, on = off;
      for (var k = 0; k < seeds.length && !seed; k++) { var v = variant(seeds[k], false); if (v.rendered) { seed = seeds[k]; off = v; } }
      if (seed) on = variant(seed, true);
      T.ok('[REVIEW/CHIP] a flagged outside-spending row shows ⚑ needs review on its group\'s head on the candidate\'s card and on ' +
        'the group\'s row in the person pop-up, once each and nowhere else (constructed; ' + on.card + ' and ' + on.person + ' chips' +
        (seed ? '; ' + seed.spender_committee_id + ' on ' + seed.target_candidate_id : '; premise: no row is drawn in both places') + ')',
        !!seed && on.rendered && on.card === 1 && on.person === 1 && on.whole === 2);
      T.ok('[REVIEW/CHIP] the same row unflagged, as a confirmed pair arrives, renders in both places and shows no chip (' +
        off.card + ' and ' + off.person + ' chips)', !!seed && off.rendered && off.card === 0 && off.person === 0 && off.whole === 0);
    })();

    // ================= the shipped bundles, by real clicks =================
    // What a booted page shows, view by view and election by election.
    async function clickThrough(c, office, want, probs) {
      var els = D.selectorOptions(office).map(function (o) { return o.id; }), n = 0;
      for (var v = 0; v < VIEWS.length; v++) {
        for (var e = 0; e < els.length; e++) {
          c.click(c.doc.querySelector('[data-view="' + VIEWS[v] + '"]')); await c.wait(60);
          c.selectElection(els[e]); await c.wait(60);
          var line = all(c.root(), '.data-through'), mast = c.root().querySelector('.masthead'); n++;
          if (!mast) { probs.push(office + ' ' + VIEWS[v] + ' ' + els[e] + ': no header'); continue; }
          if (!want) { if (line.length || /Contributions through/.test(mast.textContent)) probs.push(office + ' ' + VIEWS[v] + ' ' + els[e] + ': the line is drawn'); continue; }
          if (line.length !== 1 || line[0].textContent !== want || line[0].tagName !== 'P' || line[0].children.length !== 0 ||
              !line[0].previousElementSibling || !line[0].previousElementSibling.classList.contains('lede') ||
              !line[0].nextElementSibling || !line[0].nextElementSibling.classList.contains('topnav')) {
            probs.push(office + ' ' + VIEWS[v] + ' ' + els[e] + ': the header does not carry the line once, as plain text, between the lede and the tabs');
          }
        }
      }
      c.click(c.doc.querySelector('[data-view="byrace"]')); await c.wait(40);
      return n;
    }
    // the Industry totals tab of a booted page, for each of its elections
    async function clickIndustries(c, office, probs, adjust) {
      var els = D.selectorOptions(office).map(function (o) { return o.id; }), n = 0;
      for (var e = 0; e < els.length; e++) {
        c.selectElection(els[e]); await c.wait(60);
        await c.spend(); c.click(c.root().querySelector('[data-spendtab="industries"]')); await c.wait(80);
        var st = D.spendSubtab(idxOf[office], office, 'industries', null, els[e]).streams;
        var want = allLine(adjust ? adjust(st) : st), got = all(c.root(), '.spend-body .ind-all'); n++;
        if (got.length !== 1 || got[0].textContent !== want || got[0].children.length !== 0 || !got[0].previousElementSibling || !got[0].previousElementSibling.classList.contains('indchart') || got[0].nextElementSibling) {
          probs.push(office + ' ' + els[e] + ': the tab does not end with the line ' + JSON.stringify(want));
        }
      }
      c.click(c.root().querySelector('[data-spendtab="donors"]')); await c.wait(40);
      c.selectElection(els[0]); await c.wait(40);
      c.click(c.doc.querySelector('[data-view="byrace"]')); await c.wait(40);
      return n;
    }
    await ctx.closeModal();
    var pProbs = [], pN = 0, iPageProbs = [], iN = 0;
    pN += await clickThrough(ctx, 'school_board', tWant, pProbs);
    iN += await clickIndustries(ctx, 'school_board', iPageProbs);
    var cc = await boot('city_council', json);
    pN += await clickThrough(cc, 'city_council', tWant, pProbs);
    iN += await clickIndustries(cc, 'city_council', iPageProbs);
    cc.window.close();
    var my = await boot('mayor', json);
    var myN = await clickThrough(my, 'mayor', null, pProbs);
    my.window.close();
    // and the school-board bundle on an artifact with no row filed on a report of a large gift
    var bare = await boot('school_board', without('A-1'));
    var bareN = await clickThrough(bare, 'school_board', null, pProbs);
    if (!bare.root().querySelector('.masthead .lede') || !bare.root().querySelector('article.card')) pProbs.push('the page without a date did not draw its header and cards');
    bare.window.close();
    T.ok('[THROUGH/PAGE] in the shipped bundles, by real clicks: the school-board and city-council pages carry the line on By ' +
      'race, Election spend and Methodology, the same on every election; the mayor bundle carries none; and the school-board ' +
      'bundle on an artifact with no large-gift row draws its page with the line left off — ' +
      (pProbs.length ? pProbs.slice(0, 4).join('; ') : pN + ' views with the line, ' + myN + ' mayor views and ' + bareN + ' views of the constructed page without'),
      !!tWant && pProbs.length === 0 && pN === 9 && myN === 3 && bareN === 6);
    T.ok('[IND/PAGE] in the shipped bundles, by real clicks, the Industry totals tab ends with the line for the election on ' +
      'screen, on every election of both pages — ' + (iPageProbs.length ? iPageProbs.join('; ') : iN + ' tabs'),
      !!iTpl && iPageProbs.length === 0 && iN === 3);
    // BITES, on the live school-board page: the same clicks, held to a line a day out and to no line; and the
    // Industry totals tab held to a direct figure a dollar out and to a support figure a dollar out.
    var b1 = [], b2 = [], b3 = [], b4 = [];
    var bN = await clickThrough(ctx, 'school_board', tWant ? tWant.replace(tDay, tDayOut) : null, b1);
    await clickThrough(ctx, 'school_board', null, b2);
    var bI = await clickIndustries(ctx, 'school_board', b3, function (st) { return { direct: st.direct + 1, support: st.support, oppose: st.oppose }; });
    await clickIndustries(ctx, 'school_board', b4, function (st) { return { direct: st.direct, support: st.support + 1, oppose: st.oppose }; });
    T.ok('[THROUGH/PAGE:bite] held to a date one day out, and to no line, the clicked-through school-board page is reported on ' +
      'every view — ' + b1.length + ' and ' + b2.length + ' findings on ' + bN + ' views',
      !!tWant && tDayOut !== tDay && bN === 6 && b1.length === bN && b2.length === bN);
    T.ok('[IND/PAGE:bite] held to a direct figure a dollar out, and to a support figure a dollar out, the clicked-through Industry ' +
      'totals tab is reported on every election — ' + b3.length + ' and ' + b4.length + ' findings on ' + bI + ' tabs',
      bI === 2 && b3.length === bI && b4.length === bI);

    // [GROUP/PAGE] the two search boxes and the pop-up, in the school-board bundle. The subjects are
    // chosen from PREVIEW_DATA by the same rules as above, in the default election.
    await (async function () {
      var el = D.selectorOptions('school_board')[0].id, sx = idxOf.school_board, vm = { donors: D.spendSubtab(sx, 'school_board', 'donors', null, el, null, 'all', null), races: {} };
      D.viewModels.officeRaces(sx, 'school_board', el).groups.forEach(function (g) { g.races.forEach(function (r) { vm.races[r.slug] = D.viewModels.raceView(sx, sx.raceBySlug[r.slug], null); }); });
      var has = function (hay, q) { return String(hay || '').toLowerCase().indexOf(q.toLowerCase()) >= 0; };
      var gProbs = [], seen = [];
      var type = async function (input, val, ms) { input.value = val; input.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); await ctx.wait(ms); };
      // (a) Browse donors: a grouped row with more than one giving member, found by the stored name of a
      // member that is in neither the printed name nor the canonical record's name
      var subj = null;
      vm.donors.rows.forEach(function (r) {
        if (subj || r.kind !== 'donor' || !groupName(r.parent_id) || !(r.entities > 1)) return;
        var m = (kids[r.parent_id] || []).filter(function (x) { return x !== r.parent_id && !has(r.name, stored(x)) && !has(stored(r.parent_id), stored(x)); })[0];
        if (m) subj = { row: r, q: stored(m).toLowerCase() };
      });
      await ctx.closeModal();
      ctx.selectElection(el); await ctx.wait(60); await ctx.spend();
      ctx.click(ctx.root().querySelector('[data-spendtab="donors"]')); await ctx.wait(60);
      if (!subj) gProbs.push('premise: no grouped row with two giving members and a member named otherwise');
      else {
        await type(ctx.root().querySelector('[data-browse-search]'), subj.q, 280);
        var hit = ctx.root().querySelector('.spend-body button[data-funder="' + subj.row.parent_id + '"]');
        var wantIds = vm.donors.rows.filter(function (r) { return r.kind === 'ie' ? has(r.name, subj.q) : namesOf(r.parent_id).some(function (n) { return has(n, subj.q); }); }).length;
        var shown = all(ctx.root(), '.spend-body button[data-funder], .spend-body button[data-committee]').length;
        if (!hit || printed(hit) !== expName(subj.row.parent_id) || shown !== wantIds) gProbs.push('Browse donors, searched for ' + JSON.stringify(subj.q) + ', shows ' + shown + ' rows (expected ' + wantIds + ') and ' + (hit ? 'prints ' + JSON.stringify(printed(hit)) : 'not the group\'s row'));
        else {
          ctx.click(hit); await ctx.wait(80);
          var md = ctx.modal(), title = md && md.querySelector('.modal-name'), b = md && md.querySelector('.modal-note b');
          var mem = md ? all(md, '.elect-rollup-name').map(function (e) { return e.textContent; }) : [];
          var fp = D.donorFootprint(idxOf.school_board, subj.row.parent_id, vm.donors.win);
          if (!title || title.textContent !== expName(subj.row.parent_id) || !b || b.textContent !== expName(subj.row.parent_id)) gProbs.push('the pop-up is titled ' + JSON.stringify(title && title.textContent));
          if (!fp.rollup || mem.join('\n') !== fp.rollup.members.map(function (m) { return stored(m.id); }).join('\n')) gProbs.push('the pop-up does not list the members under their stored names');
          seen.push('Browse donors ' + JSON.stringify(subj.q) + ' → ' + JSON.stringify(expName(subj.row.parent_id)) + ' (' + mem.length + ' member rows)');
          await ctx.closeModal();
        }
        var clr = ctx.root().querySelector('[data-clear-filters]'); if (clr) { ctx.click(clr); await ctx.wait(60); }
      }
      // (b) the search box inside a card: the first race, in the page's order, with a card that has the box
      // and a grouped contributor one of whose members is named otherwise and gave this candidate nothing
      var cardSubj = null;
      Object.keys(vm.races).forEach(function (slug) {
        (vm.races[slug].candidates || []).forEach(function (c) {
          if (cardSubj || !c.hasFinance) return;
          var lines = c.contributors.lines, real = lines.filter(function (l) { return !l.isAggregate && !l.isSelf; });
          if (real.length <= 8) return;
          var ck = idxOf.school_board.committeeKeyByCandidate[c.fundingId], gave = {};
          json.contributions.forEach(function (x) { if (x.committee_id === ck) gave[x.donor_id] = 1; });
          real.forEach(function (l) {
            if (cardSubj || !groupName(l.parent_id)) return;
            var m = (kids[l.parent_id] || []).filter(function (x) { return !gave[x] && !has(l.name, stored(x)); })[0];
            var other = real.filter(function (o) { return o !== l && !groupName(o.parent_id) && !namesOf(l.parent_id).some(function (n) { return has(n, o.name); }); })[0];
            if (m && other) cardSubj = { slug: slug, c: c, pid: l.parent_id, q: stored(m).toLowerCase(), other: other };
          });
        });
      });
      var bitten = false;
      if (!cardSubj) gProbs.push('premise: no card with a search box holds a grouped contributor with a member named otherwise that did not give to it');
      else {
        ctx.click(ctx.doc.querySelector('[data-view="byrace"]')); await ctx.wait(60);
        ctx.nav(cardSubj.slug); await ctx.wait(80);
        var panel = ctx.doc.getElementById('d-' + cardSubj.c.slug + '-c'), box = panel && panel.querySelector('[data-donor-search]');
        var rows = panel ? all(panel, '.crow') : [];
        var vis = function () { return rows.filter(function (r) { return r.style.display !== 'none'; }); };
        var rowOf = function (pid) { return rows.filter(function (r) { return r.getAttribute('data-funder') === pid; })[0]; };
        // the rows a text should leave: those whose printed text, or one of whose carried names, holds it
        var should = function (q) { return rows.filter(function (r) { var pid = r.getAttribute('data-funder'); return has(r.textContent, q) || (pid && namesOf(pid).some(function (n) { return has(n, q); })); }); };
        var same = function (a, b) { return a.length === b.length && a.every(function (x, k) { return x === b[k]; }); };
        if (!box || !rowOf(cardSubj.pid) || !rowOf(cardSubj.other.parent_id)) gProbs.push('the card of ' + cardSubj.c.id + ' has no search box or not its rows');
        else {
          var target = rowOf(cardSubj.pid), steps = [
            ['a member\'s stored name, of a member that did not give to this candidate', cardSubj.q, target],
            ['the group\'s name', expName(cardSubj.pid).toUpperCase(), target],
            ['the printed text of a donor in no group', cardSubj.other.name.toLowerCase(), rowOf(cardSubj.other.parent_id)]];
          for (var s = 0; s < steps.length; s++) {
            await type(box, steps[s][1], 30);
            var v1 = vis();
            if (v1.indexOf(steps[s][2]) < 0 || !same(v1, should(steps[s][1])) || v1.length === rows.length) gProbs.push('in the card of ' + cardSubj.c.id + ', ' + steps[s][0] + ' ' + JSON.stringify(steps[s][1]) + ' leaves ' + v1.length + ' of ' + rows.length + ' rows, expected ' + should(steps[s][1]).length);
          }
          await type(box, 'zz-no-such-donor-zz', 30);
          if (vis().length !== 0) gProbs.push('a text no name holds leaves rows');
          await type(box, '', 30);
          if (vis().length !== rows.length) gProbs.push('an empty box does not show every row');
          // BITE: without the names it carries, the row is not found by the member's name (the box as it was)
          var kept = target.getAttribute('data-names'); target.removeAttribute('data-names');
          await type(box, cardSubj.q, 30);
          bitten = !!kept && vis().indexOf(target) < 0;
          target.setAttribute('data-names', kept); await type(box, '', 30);
          bitten = bitten && vis().length === rows.length;
          seen.push('the card of ' + cardSubj.c.id + ' ' + JSON.stringify(cardSubj.q) + ' → ' + JSON.stringify(expName(cardSubj.pid)) + ' among ' + rows.length + ' rows');
        }
      }
      ctx.click(ctx.doc.querySelector('[data-view="byrace"]')); await ctx.wait(40);
      T.ok('[GROUP/PAGE:bite] with the names its row carries taken off, the card\'s search box no longer finds the grouped donor by ' +
        'its member\'s name', bitten);
      T.ok('[GROUP/PAGE] in the shipped bundle, by real clicks: the Browse donors box finds a grouped donor by a member\'s stored ' +
        'name and prints the group\'s name on its row; the pop-up it opens is titled with the group\'s name and lists the members ' +
        'under their own; the search box inside a card finds a grouped donor by the name of a member that did not give to that ' +
        'candidate and by the group\'s name, still finds a donor by its printed text, and leaves exactly the rows that hold the ' +
        'text typed — ' + (gProbs.length ? gProbs.join('; ') : seen.join('; ')), gProbs.length === 0 && seen.length === 2);
    })();
  })();

  console.log('\n' + T.n + ' checks · ' + (T.fail ? ('FAILED ' + T.fail) : 'ALL PASS'));
  process.exit(T.fail ? 1 : 0);
})();
