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
 */
'use strict';
var fs = require('fs'), path = require('path');

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

// ====================================================================
// FIXTURES — one block per office. Office-SPECIFIC data ONLY. Add council /
// mayor blocks here when their cohorts land; the assertion functions below are
// office-agnostic and consume one of these blocks unchanged.
// ====================================================================
var FIXTURES = {
  school_board: {
    office: 'school_board',
    presidentSlug: 'school-board-president',
    minRaces: 11,                       // President + the sb-d04..d12 district cohort (districts split a/b)
    subtabs: ['donors', 'candidates', 'industries', 'industry-candidate', 'flags'],
    filter: { allLabel: /All elections/, thisLabel: /This election \(2026\)/, lastLabel: /Last election \(2024\)/,
              allId: 'all', thisId: '2026', lastId: '2024' },
    windowEnd: '2026-12-31',
    incs: {
      committee: 'ie-committee-26066',  // INCS Action Independent Committee
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
    parity: { support: 663609, oppose: 401217 },
    // self-funding negative case (relational is_self, 8f148b2): a funder who self-funds
    // their OWN race must NOT be flagged self in another candidate's drill.
    selfLeak: { funder: 'Leon', leakRace: 'Rosenfeld', ownRace: 'Leon' },
    // Browse-Donors filters (E-1): a search term that hits a known rollup, and a donor type.
    browseFilters: { search: 'frank', searchHit: 'Frank', type: 'Individual' },
    // Industry-tag color + curated label (E-5): canonical color + curated label, not the slug.
    tagColor: { industry: 'real-estate', hex: '#a23a2e', label: 'Real Estate / Developers', slugText: '>real estate<' },
    // Industry three-level drill (E-6): the IE-funded industry, its IE spender, a direct industry.
    industryDrill: { ieIndustry: 'charter-schools', ieSpender: 'ie-committee-26066', directIndustry: 'labor-teachers' },
    // Grouped spend-by-candidate (E-7): President first, district order, within-race ranking, race filter.
    candidateGroups: { firstRaceText: 'President', raceCount: 21,
      presidentOrder: ['Jennifer Custer', 'Sendhil Revuluri', 'Jessica Biggs', 'Victor Henderson'], singleRace: 'sb-d06' }
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
    tab: function (v) { var b = root().querySelector('[data-electionview="' + v + '"]'); if (b) click(b); return !!b; },
    cardByName: function (n) { return [].slice.call(root().querySelectorAll('article.card')).filter(function (a) { return a.innerHTML.indexOf(n) >= 0; })[0]; },
    slugs: function () { return [].slice.call(doc.querySelectorAll('[data-slug]')).map(function (e) { return e.getAttribute('data-slug'); }); },
    closeModal: async function () { var c = modal() && modal().querySelector('[data-modal-close]'); if (c) { click(c); await wait(30); } },
    spend: async function () { click(doc.querySelector('[data-view="spend"]')); await wait(70); },
    setFilter: function (id) { click([].slice.call(root().querySelectorAll('[data-spendelection]')).filter(function (b) { return b.getAttribute('data-spendelection') === id; })[0]); },
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

// (1) This/Last/All toggle wiring.  [origin: bundle_gate #2-5]
async function assertToggleWiring(T, ctx, fx) {
  await ctx.closeModal();
  ctx.nav(fx.presidentSlug); await ctx.wait(60);
  T.ok('[toggle] This/Last/All buttons present',
    !!ctx.root().querySelector('[data-electionview="' + fx.filter.thisId + '"]') &&
    !!ctx.root().querySelector('[data-electionview="' + fx.filter.lastId + '"]') &&
    !!ctx.root().querySelector('[data-electionview="all"]'));
  ctx.tab(fx.filter.lastId); await ctx.wait(50); var hLast = ctx.root().innerHTML;
  T.ok('[toggle] Last selected via click', ctx.root().querySelector('[data-electionview="' + fx.filter.lastId + '"]').getAttribute('aria-selected') === 'true');
  ctx.tab(fx.filter.thisId); await ctx.wait(50);
  T.ok('[toggle] This selected + content changed', ctx.root().querySelector('[data-electionview="' + fx.filter.thisId + '"]').getAttribute('aria-selected') === 'true' && hLast !== ctx.root().innerHTML);
  ctx.tab('all'); await ctx.wait(50);
  T.ok('[toggle] All selected', ctx.root().querySelector('[data-electionview="all"]').getAttribute('aria-selected') === 'true');
}

// (3) per-election drill-down reachable.  [origin: bundle_gate #6-7]
async function assertPerElectionDrill(T, ctx, fx) {
  await ctx.closeModal();
  ctx.nav(fx.presidentSlug); await ctx.wait(60); ctx.tab(fx.filter.lastId); await ctx.wait(50);
  var drill = [].slice.call(ctx.root().querySelectorAll('[aria-controls]')).filter(function (b) {
    var p = ctx.doc.getElementById(b.getAttribute('aria-controls')); return p && /contrib/.test(p.className);
  })[0];
  T.ok('[drill] a per-election drill toggle exists', !!drill);
  if (drill) {
    var panel = ctx.doc.getElementById(drill.getAttribute('aria-controls'));
    ctx.click(drill); await ctx.wait(40);
    T.ok('[drill] clicking it opens the drill panel (.open)', panel.classList.contains('open'));
  }
}

// (4) self-funding renders separately + named-case no-leak.  [origin: bundle_gate #8-11]
async function assertSelfFundingNoLeak(T, ctx, fx) {
  await ctx.closeModal();
  var leakSlug = await ctx.findRaceWith(fx.selfLeak.leakRace);
  T.ok('[self] found ' + fx.selfLeak.leakRace + ' race (' + leakSlug + ')', !!leakSlug);
  ctx.nav(leakSlug); await ctx.wait(60); ctx.tab('all'); await ctx.wait(50);
  var card = ctx.cardByName(fx.selfLeak.leakRace) || { innerHTML: '' };
  T.ok('[self] ' + fx.selfLeak.leakRace + ' self-funding renders separately (own money / loans)',
    /own money|tagchip self|candidate’s own money/.test(card.innerHTML));
  var leak = [].slice.call((ctx.cardByName(fx.selfLeak.leakRace) || ctx.doc.createElement('div')).querySelectorAll('.crow,.selfline'))
    .filter(function (r) { return new RegExp(fx.selfLeak.funder).test(r.textContent) && /own money|tagchip self/.test(r.innerHTML); });
  T.ok('[self] NO LEAK: no ' + fx.selfLeak.funder + ' row in ' + fx.selfLeak.leakRace + ' marked self (relational is_self)', leak.length === 0);
  var ownSlug = await ctx.findRaceWith(fx.selfLeak.ownRace);
  ctx.nav(ownSlug); await ctx.wait(60); ctx.tab('all'); await ctx.wait(50);
  T.ok('[self] ' + fx.selfLeak.ownRace + ' OWN race shows self-funding distinctly',
    /own money|candidate’s own money/.test((ctx.cardByName(fx.selfLeak.ownRace) || { innerHTML: '' }).innerHTML));
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
  var R = ctx.root().innerHTML;
  T.ok('[spend.A] election filter nav present (data-spendelection)', R.indexOf('data-spendelection') >= 0);
  fx.subtabs.forEach(function (t) { T.ok('[spend.A] subtab present: ' + t, R.indexOf('data-spendtab="' + t + '"') >= 0); });
  T.ok('[spend.A] browse-donors list shows IE PAC spenders', /IE PAC/.test(R));
  T.ok('[spend.A] browse note (donors+spenders) present', /funded an independent-expenditure committee/.test(R));
  // B — election filter defaults to All, reslices
  var fbtns = [].slice.call(ctx.root().querySelectorAll('[data-spendelection]'));
  var active = fbtns.filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0];
  T.ok('[spend.B] default selected = All elections', active && active.getAttribute('data-spendelection') === fx.filter.allId && fx.filter.allLabel.test(active.textContent));
  T.ok('[spend.B] filter has This + Last', fbtns.some(function (b) { return fx.filter.thisLabel.test(b.textContent); }) && fbtns.some(function (b) { return fx.filter.lastLabel.test(b.textContent); }));
  ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(60);
  var indAll = ctx.root().querySelector('.spend-body').textContent;
  ctx.setFilter(fx.filter.thisId); await ctx.wait(60);
  var indThis = ctx.root().querySelector('.spend-body').textContent;
  T.ok('[spend.B] switching to This reslices the industry totals (content changes)', indAll !== indThis);
  T.ok('[spend.B] This now the selected filter', ctx.root().querySelector('[data-spendelection="' + fx.filter.thisId + '"]').getAttribute('aria-selected') === 'true');
  // C — firewall drill (exact lines)
  ctx.setFilter(fx.filter.allId); await ctx.wait(60);
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
  // D — deep drill: sub-funder -> footprint, window-scoped
  var winRe = new RegExp('data-win-end="' + fx.windowEnd + '"');
  T.ok('[spend.D] committee-profile modal carries the active window (data-win-end)', winRe.test(M));
  var funderRow = ctx.modal().querySelector('[data-funder]');
  T.ok('[spend.D] INCS has clickable funder rows (data-funder, rollup by parent_id)', !!funderRow);
  ctx.click(funderRow); await ctx.wait(80);
  var FM = ctx.modal().innerHTML;
  T.ok('[spend.D] clicking a sub-funder opens the donor footprint (Tier-3)', /Donor footprint/.test(FM));
  T.ok('[spend.D] footprint modal is election-scoped (carries window)', winRe.test(FM));
}

// (5) IE for/against firewall — every named target renders as a clickable for/against
// fact.  [origin: bundle_gate #13-17]
async function assertFirewallFiveNames(T, ctx, fx) {
  await ctx.closeModal();
  await ctx.spend(); ctx.setFilter(fx.filter.allId); await ctx.wait(50);
  var opened = await ctx.openCommittee(fx.incs.committee);
  if (!opened) { T.ok('[firewall] INCS drill opens under All', false); return; }
  fx.incs.fiveNames.forEach(function (nm) {
    var row = [].slice.call(ctx.modal().querySelectorAll('.crow')).filter(function (r) { return r.textContent.indexOf(nm) >= 0; })[0];
    T.ok('[firewall] INCS drill: ' + nm + ' renders as for/against fact', !!row && /(for|against)/.test(row.textContent));
  });
}

// (2) All == This + Last per stream.  [origin: bundle_gate #19-20]
async function assertParity(T, ctx, fx) {
  await ctx.closeModal();
  await ctx.spend();
  ctx.setFilter(fx.filter.allId); await ctx.wait(50); var oAll = await ctx.openCommittee(fx.incs.committee);
  var all = oAll ? ctx.ieSummary() : { sup: 0, opp: 0 };
  ctx.setFilter(fx.filter.thisId); await ctx.wait(50); var oThis = await ctx.openCommittee(fx.incs.committee);
  var thisE = oThis ? ctx.ieSummary() : { sup: 0, opp: 0 };   // INCS absent in 2026 -> {0,0} (see fixture note)
  ctx.setFilter(fx.filter.lastId); await ctx.wait(50); var oLast = await ctx.openCommittee(fx.incs.committee);
  var lastE = oLast ? ctx.ieSummary() : { sup: 0, opp: 0 };
  console.log('   INCS support  All=' + all.sup + '  This=' + thisE.sup + '  Last=' + lastE.sup);
  console.log('   INCS oppose   All=' + all.opp + '  This=' + thisE.opp + '  Last=' + lastE.opp);
  // NOTE: This(2026) leg is 0 by absence (INCS only spent in 2024), so this parity is
  // trivially All == Last. It is the FIREWALL sum check, not independent 2026 confirmation.
  T.ok('[parity] All == This + Last per stream (support)', all.sup === thisE.sup + lastE.sup && all.sup === fx.parity.support);
  T.ok('[parity] All == This + Last per stream (oppose)', all.opp === thisE.opp + lastE.opp && all.opp === fx.parity.oppose);
}

// (E-1) Browse-Donors filters: present, apply, compose (AND), flag-excludes-IE, uncategorized
// honest, and compose with the time window.  [NEW coverage — the original 44 are blind to this]
async function assertBrowseFilters(T, ctx, fx) {
  var bf = fx.browseFilters;
  await ctx.closeModal();
  await ctx.spend(); ctx.setFilter(fx.filter.allId); await ctx.wait(40);
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
  setSel('[data-donor-type]', bf.type); await ctx.wait(50); var typeAll = donorRows();
  ctx.setFilter(fx.filter.lastId); await ctx.wait(50);
  T.ok('[filters] composes with the time window (type persists + re-slices on Last)',
    ctx.root().querySelector('[data-donor-type]').value === bf.type && donorRows() > 0 && donorRows() <= typeAll);
  ctx.setFilter(fx.filter.allId); await ctx.wait(40); ctx.click(ctx.root().querySelector('[data-clear-filters]')); await ctx.wait(40);
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
  await ctx.closeModal();
  await ctx.spend(); ctx.setFilter(fx.filter.allId); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-spendtab="industries"]')); await ctx.wait(70);
  // Level 1 — the chart
  T.ok('[E6.L1] industry chart renders (sorted clickable bars)',
    !!ctx.root().querySelector('.indchart') && !!ctx.root().querySelector('[data-industry-drill]'));
  var bars = [].slice.call(ctx.root().querySelectorAll('[data-industry-drill]'));
  T.ok('[E6.L1] charter-schools is largest (first bar) + distinguished as independent',
    bars[0].getAttribute('data-industry-drill') === d.ieIndustry && /independent/.test(bars[0].textContent) && !!bars[0].querySelector('.seg.indep'));
  T.ok('[E6.L1] no support/oppose split at Level 1 (aggregate only)',
    ctx.root().querySelector('.spend-body').innerHTML.indexOf('Spent to support') < 0);
  // Level 1 -> 2: click the IE industry bar -> filtered spender list
  ctx.click(bars.filter(function (b) { return b.getAttribute('data-industry-drill') === d.ieIndustry; })[0]); await ctx.wait(80);
  T.ok('[E6.L2] industry bar click -> Browse Donors filtered to that industry',
    ctx.root().querySelector('[data-donor-industry]') && ctx.root().querySelector('[data-donor-industry]').value === d.ieIndustry);
  var incsRow = ctx.root().querySelector('.spend-body [data-committee="' + d.ieSpender + '"]');
  T.ok('[E6.L2] IE industry spenders include the IE committee (INCS)', !!incsRow);
  // Level 2 -> 3: IE spender -> support/oppose SEPARATE
  ctx.click(incsRow); await ctx.wait(70);
  var M = ctx.modal() ? ctx.modal().innerHTML : '';
  T.ok('[E6.L3] IE spender -> support + oppose SEPARATE boxes (firewall)', /Spent to support/.test(M) && /Spent to oppose/.test(M));
  await ctx.closeModal();
  // Direct industry -> donor spender -> footprint with NO empty support/oppose boxes
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
}

// (E-7) Grouped spend-by-candidate: sections ordered President -> d01..d20, within-race ranking
// by contributions.total (single-stream), full roster (committee-less shown), race filter composes
// with time, three figures stay separate (firewall).  [NEW surface]
async function assertCandidateGroups(T, ctx, fx) {
  var cg = fx.candidateGroups;
  await ctx.closeModal();
  await ctx.spend(); ctx.setFilter(fx.filter.allId); await ctx.wait(40);
  ctx.click(ctx.root().querySelector('[data-spendtab="candidates"]')); await ctx.wait(80);
  var groups = [].slice.call(ctx.root().querySelectorAll('.racegroup'));
  var heads = [].slice.call(ctx.root().querySelectorAll('.racehead')).map(function (h) { return h.textContent; });
  T.ok('[E7] grouped into all ' + cg.raceCount + ' school-board race sections', groups.length === cg.raceCount);
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
  ctx.setFilter(fx.filter.lastId); await ctx.wait(70);
  T.ok('[E7] race filter composes with time window (still one section, value retained)',
    ctx.root().querySelector('[data-race-filter]').value === cg.singleRace && ctx.root().querySelectorAll('.racegroup').length === 1);
  var rs = ctx.root().querySelector('[data-race-filter]'); rs.value = 'all'; rs.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); await ctx.wait(40);
  ctx.setFilter(fx.filter.allId); await ctx.wait(40);
}

(async function () {
  var html = fs.readFileSync(PREVIEW, 'utf8');
  var dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  var ctx = makeCtx(dom.window);
  var fx = FIXTURES.school_board;
  var T = { n: 0, fail: 0, ok: function (name, cond) { this.n++; if (!cond) this.fail++; console.log((cond ? 'PASS  ' : 'FAIL  ') + name); } };

  await assertBoot(T, ctx, fx);
  await assertRaceSet(T, ctx, fx);
  await assertToggleWiring(T, ctx, fx);
  await assertPerElectionDrill(T, ctx, fx);
  await assertSelfFundingNoLeak(T, ctx, fx);
  await assertSpendTabFeatures(T, ctx, fx);
  await assertFirewallFiveNames(T, ctx, fx);
  await assertParity(T, ctx, fx);
  await assertBrowseFilters(T, ctx, fx);
  await assertIndustryDrill(T, ctx, fx);
  await assertCandidateGroups(T, ctx, fx);

  console.log('\n' + T.n + ' checks · ' + (T.fail ? ('FAILED ' + T.fail) : 'ALL PASS'));
  process.exit(T.fail ? 1 : 0);
})();
