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

function assertBundleVintage(T, window) {
  var expect = sha256Buf(Buffer.from(BUNDLE_MOD.render(), 'utf8'));
  var actual = fs.existsSync(BUNDLE_MOD.OUT) ? sha256Buf(fs.readFileSync(BUNDLE_MOD.OUT)) : null;
  var v = bundleVintageVerdict(expect, actual, window.PREVIEW_BUNDLE_SHA);
  T.ok('[BUNDLE/VINTAGE] the shipped bundle recomposes from data.js + render.js + app.js, ' +
    'and the preview was spliced from it — ' + v.reason, v.ok);

  // BITING CASES. The first is the real one: mutate ONE source in memory and recompose,
  // so the failure is produced by an actually-different bundle rather than by a doctored
  // comparison. The rest drive each remaining branch.
  BUNDLE_MOD.SOURCES.forEach(function (f) {
    var over = {}; over[f] = '/* [BUNDLE/VINTAGE] biting case */';
    var mutated = sha256Buf(Buffer.from(BUNDLE_MOD.render(over), 'utf8'));
    var got = bundleVintageVerdict(mutated, actual, window.PREVIEW_BUNDLE_SHA);
    T.ok('[BUNDLE/VINTAGE:bite] a one-source change in ' + f + ' recomposes to a different ' +
      'bundle and is rejected', mutated !== actual && got.ok === false && /STALE/.test(got.reason));
  });
  T.ok('[BUNDLE/VINTAGE:bite] a MISSING bundle is rejected (fail-closed)',
    bundleVintageVerdict('a'.repeat(64), null, 'a'.repeat(64)).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] an ABSENT preview bundle-stamp is rejected (fail-closed)',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), undefined).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] a preview spliced from a DIFFERENT bundle is rejected',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)).ok === false);
  T.ok('[BUNDLE/VINTAGE:bite] the all-matching case passes',
    bundleVintageVerdict('a'.repeat(64), 'a'.repeat(64), 'a'.repeat(64)).ok === true);

  return v;
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
// D-20's ratified municipal values. `start` is the 2027 council-era cycle boundary, NOT the
// school-board `start: null` idiom — see the ruling and the note in election-windows.json.
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
  methodologyOffices: { school_board: 1 }
};

var FIXTURES = {
  school_board: {
    office: 'school_board',
    presidentSlug: 'school-board-president',
    minRaces: 11,                       // President + the sb-d04..d12 district cohort (districts split a/b)
    subtabs: ['donors', 'candidates', 'industries', 'industry-candidate', 'flags'],
    // SCOPE-UI: the GLOBAL election selector (ratified {year} {body} labels). The former
    // per-spend-tab This/Last/All filter and the per-race toggle are retired; 'all' (the
    // union window) is not resolvable from any UI surface.
    selector: { ids: ['2026', '2024'], def: '2026',
                labels: { '2026': /2026 School Board/, '2024': /2024 School Board/ },
                scopeRaces: { '2026': 21, '2024': 10 } },
    // HALT-F2 oracle: the office's per-election windows, stated INDEPENDENTLY of data.js
    // (mirrors election-windows.json). If data.js's ELECTION_WINDOWS drifts from these,
    // the [F2] window-scoping checks fail — that drift is the defect being caught.
    windows: { '2024': { start: null, end: '2024-12-31' },
               '2026': { start: '2025-01-01', end: '2026-12-31' } },
    incs: {
      committee: 'ie-committee-26066',  // INCS Action Independent Committee (2024-window spender)
      scope: '2024',                    // SCOPE-UI: its money is 2024-window; drills run in the 2024 scope
      // exact-figure firewall lines (election label + stance + amount), checked precisely:
      exactLines: [
        { name: 'Jason Dónes', label: '2024: District 3', amount: '$35,153', stance: 'against' },
        { name: 'Carlos A. Rivas', label: '2024: District 3', amount: '$234,231', stance: 'for' }
      ],
      // broader coverage: every name must render as a clickable for/against fact:
      fiveNames: ['Carlos A. Rivas', 'Karen Zaccor', 'Ebony DeBerry', 'Anusha Thotakura', 'Jason Dónes']
    },
    // INCS All-vs-(This+Last) parity. INCS spent ONLY in 2024, so the 2026 leg is 0
    // by absence (the spender row is correctly missing from the 2026 browse list) —
    // the parity is therefore trivially All == 2024 (see note at assertParity); it is
    // NOT independent 2026 confirmation. Figures are post-rounding display dollars.
    // Data-layer parity (SCOPE-UI A2): re-expressed off the UI — per-stream, per-election
    // windowed figures must sum to the union computed at the data layer (no UI union
    // surface exists). INCS pins keep the old tripwire: its 2026 leg is 0 by absence.
    parity: { support: 663608.78, oppose: 401217 },
    // self-funding negative case (relational is_self, 8f148b2): a funder who self-funds
    // their OWN race must NOT be flagged self in another candidate's drill.
    // ownRace anchor made specific (HALT-Q2R): after Q2, the bare 'Leon' substring also
    // matches a donor card in the President race, so cardByName('Leon') resolved there first.
    // 'Bruce Leon' anchors to his own race uniquely. (substring-anchor fragility -> P1-R runbook.)
    selfLeak: { funder: 'Leon', leakRace: 'Rosenfeld', ownRace: 'Bruce Leon' },
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
    industryDrill: { scope: '2024', topBarTotal: 1632335.66,
      hasDirectSeg: true, ieDirectVal: 19000, ieSupportVal: 1212118.66, ieOpposeVal: 401217,
      ieIndustry: 'charter-schools', ieRank: 2, ieSpender: 'ie-committee-26066',
      directIndustry: 'labor-teachers' },
    // Grouped spend-by-candidate (E-7): President first, district order, within-race ranking, race filter.
    candidateGroups: { firstRaceText: 'President', raceCount: 21, raceCount2024Scope: 21,
      presidentOrder: ['Victor Henderson', 'Sendhil Revuluri', 'Jessica Biggs', 'Jennifer Custer'], singleRace: 'sb-d06' },
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
      // The five verified out-of-window singles (probe-links-report 969fd9f2: no
      // counterpart candidacy at any tier). string 11 fires on EXACTLY these.
      outOfWindowIds: ['bannon-sb-d01', 'pope-sb-d04', 'hernandez-sb-2024-d1',
                       'smith-sb-2024-d6', 'thomas-sb-2024-d9']
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
  var leakSlug = await ctx.findRaceWith(fx.selfLeak.leakRace);
  T.ok('[self] found ' + fx.selfLeak.leakRace + ' race (' + leakSlug + ')', !!leakSlug);
  ctx.nav(leakSlug); await ctx.wait(60);
  var card = ctx.cardByName(fx.selfLeak.leakRace) || { innerHTML: '' };
  T.ok('[self] ' + fx.selfLeak.leakRace + ' self-funding renders separately (own money / loans)',
    /own money|tagchip self|candidate\u2019s own money/.test(card.innerHTML));
  var leak = [].slice.call((ctx.cardByName(fx.selfLeak.leakRace) || ctx.doc.createElement('div')).querySelectorAll('.crow,.selfline'))
    .filter(function (r) { return new RegExp(fx.selfLeak.funder).test(r.textContent) && /own money|tagchip self/.test(r.innerHTML); });
  T.ok('[self] NO LEAK: no ' + fx.selfLeak.funder + ' row in ' + fx.selfLeak.leakRace + ' marked self (relational is_self)', leak.length === 0);
  // The own-money leg moved with the money (F-2 ruled semantics): Leon's self-funding is
  // 2024-window, so its render surface is the 2024-scope spend/candidates tab.
  ctx.selectElection('2024'); await ctx.wait(60);
  await ctx.spend();
  ctx.click(ctx.root().querySelector('[data-spendtab="candidates"]')); await ctx.wait(80);
  var body = ctx.root().querySelector('.spend-body').textContent;
  T.ok('[self] ' + fx.selfLeak.ownRace + ' 2024-window money renders on the 2024-scope spend tab ($620,403)',
    body.indexOf(fx.selfLeak.ownRace) >= 0 && body.indexOf('$620,403') >= 0);
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
  fx.subtabs.forEach(function (t) { T.ok('[spend.A] subtab present: ' + t, R.indexOf('data-spendtab="' + t + '"') >= 0); });
  T.ok('[spend.A] browse list renders donor rows under the default (2026) scope', /data-funder/.test(R));
  // (the 'IE PAC' STRING legitimately remains in the stable facet dropdown; the assert is on ROWS)
  T.ok('[spend.A] zero IE-committee ROWS under 2026 (all school-board IE is 2024-window)',
    ctx.root().querySelectorAll('.spend-body [data-committee]').length === 0);
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
  T.ok('[spend.C] IE provenance ⚑ needs review surfaces on a line', /needs review/.test(spentSection));
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
  var wU = { start: null, end: fx.windows['2026'].end };   // union, constructed from the FIXTURE
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
  T.ok('[filters] 4 controls present (search + type/industry/flag)',
    !!ctx.root().querySelector('[data-browse-search]') && !!ctx.root().querySelector('[data-donor-type]') &&
    !!ctx.root().querySelector('[data-donor-industry]') && !!ctx.root().querySelector('[data-donor-flag]'));
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
  var flagOpt = [].slice.call(ctx.root().querySelector('[data-donor-flag]').options).filter(function (o) { return o.value !== 'All'; })[0];
  if (flagOpt) { setSel('[data-donor-flag]', flagOpt.value); await ctx.wait(50);
    T.ok('[filters] flag filter applies AND excludes IE rows (IE carry no donor flags)', ieRows() === 0);
    ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(50); }
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
  // HALT-GUARD stop-condition assert: the IE layer did NOT move — charter-schools'
  // support/oppose are byte-equal to the pre-removal pins; only direct joined.
  T.ok('[E6.L1] charter-schools IE figures UNCHANGED (support ' + fmt(d.ieSupportVal) + ' / oppose ' + fmt(d.ieOpposeVal) + ')',
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
          return x.committee_id === key && x.date && (w.start == null || x.date >= w.start) && (w.end == null || x.date <= w.end) && x.contribution_type !== 'IE Committee Dues Transfer';
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
  (idx.races || []).forEach(function (r) {
    if (String(r.office || '').indexOf(fx.office) !== 0) return;
    var vm = ED.viewModels.raceView(idx, r.id, null);
    if (!vm || vm.elections) return;   // toggle races: per-election panels carry their own windows (asserted above)
    var yr = (/^(\d{4})-/.exec(r.election_id || '') || [])[1];
    var w = (yr && fx.windows[yr]) || null;
    vm.candidates.forEach(function (c) {
      if (!c.hasFinance || !c.figures) return;
      checked++;
      var fWin = ED.candidateFigures(idx, c.id, null, w);
      var fAll = ED.candidateFigures(idx, c.id, null);
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
  var seiu = ED.spenderFunders(idx, 'ie-committee-18574');
  T.ok('[EXCL/SEIU] SEIU PAC funder total == 215075.25 in-subject (was 11513949.64 pre-exclusion; ' +
    're-pinned from 121825.25, ratified 2026-08-09) and top funder is SEIU Healthcare IL IN PAC',
    seiu.total === 215075.25 && seiu.funders[0] && seiu.funders[0].name === 'SEIU Healthcare IL IN PAC');

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
  // row and one pre-2011 row on each committee type renders ZERO from every money entry
  // point. (The class is the subject: the next ruled exclusion joins this fixture, not a
  // new check.)
  var cp3 = JSON.parse(JSON.stringify(RAW));
  var candK = Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'candidate'; });
  var ieK = Object.keys(RAW.committees).find(function (k) { return RAW.committees[k].type === 'independent_expenditure'; });
  var don0 = Object.keys(RAW.donors)[0];
  cp3.contributions = [
    { donor_id: don0, committee_id: candK, amount: 1111, date: '2025-06-01', cycle: '2027', contribution_type: 'IE Committee Dues Transfer' },
    { donor_id: don0, committee_id: ieK, amount: 2222, date: '2025-06-01', cycle: '2027', contribution_type: 'IE Committee Dues Transfer' },
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
  T.ok('[DUES/UNIF] the FULL exclusion set (dues + excluded cycles): a dues+pre-2011-only artifact renders ZERO from every money entry point' +
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
      if (ED.EXCLUDED_CYCLES[c.cycle] || c.contribution_type === 'IE Committee Dues Transfer') return;
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

  // --- 4. [PERSON/PS-90] the view-model IE exclusion. DEFERRAL-SCOPED (PS-90): the lane
  // that ships IE display after P1-E re-routes supersedes THIS CHECK consciously; its
  // removal then is NOT a firewall regression. The permanent invariant is INV-PERSON-2
  // at the artifact layer — expressly not this check.
  function ieKeys(o, found) {
    if (o && typeof o === 'object') {
      Object.keys(o).forEach(function (k) {
        if (/independent|ie[_A-Z]/.test(k)) found.push(k);
        ieKeys(o[k], found);
      });
    }
    return found;
  }
  var leaked = [];
  Object.keys(bp).concat(pf.outOfWindowIds).forEach(function (ref) {
    ieKeys(ED.personView(idx, ref), leaked);
  });
  T.ok('[PERSON/PS-90] no IE value enters the person view-model (deferral-scoped exclusion)' +
    (leaked.length ? ' — LEAKED: ' + leaked.join(',') : ''), leaked.length === 0);

  // --- 5. [PERSON/S11] the out-of-window condition fires on EXACTLY the five verified
  // singles (a boolean by construction — personView materialises no unwindowed figure).
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
  T.ok('[PERSON/S11] string-11 condition fires on exactly the five verified singles' +
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

  // [IE/DIST] the ingest_ie ward-absent/district-present collision cases (IE-DIST-1).
  // Its own docstring: "These are non-optional precisely BECAUSE the fix is dormant on
  // live data" — no real expenditure resolves into a same-name school-board cohort, so
  // the full-dataset run proves the fix changes NOTHING, and these synthetic fixtures are
  // the only proof the ACTIVE path behaves when a collision does exist. Nothing in the
  // repo ran them. A dormant guard with no exercised test is a guard nobody has checked
  // still works. Plain stdlib, no pytest, reads no artifact. 26 cases, green at adoption.
  (function () {
    var res = require('child_process').spawnSync('python3',
      [path.join(__dirname, '..', '..', '..', 'ingestion', 'test_ingest_ie_district.py')],
      { encoding: 'utf8' });
    var tail = ((res.stdout || '') + (res.stderr || '')).trim().split('\n').pop();
    T.ok('[IE/DIST] ingest_ie district-collision cases green — ' + tail, res.status === 0);
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
  // sweep: validate_shard_freshness (validate_council_data.py:420) is the good precedent
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
  // in code — only by DEPLOY.md:59's "Verify before pasting" ritual — and FAILING, with
  // paste debt outstanding in front of it. It covers ten subjects no other check does
  // (the ie-cmte-toggle absence pin, coming-soon for city_council/mayor, the "· soon"
  // marking, footer disclaimer copy, the elections embed's Recoleta @font-face, single
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
        verify: { reconUrl: 'x', gapsUrl: 'y' } });
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
    T.ok('[MUNI/METH] the methodology tab renders only for an office with a ratified ' +
      'methodology — ' + (bad.length ? bad.join('; ')
        : 'school_board renders it; city_council and mayor render coming-soon carrying no school-board copy'),
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

  console.log('\n' + T.n + ' checks · ' + (T.fail ? ('FAILED ' + T.fail) : 'ALL PASS'));
  process.exit(T.fail ? 1 : 0);
})();
