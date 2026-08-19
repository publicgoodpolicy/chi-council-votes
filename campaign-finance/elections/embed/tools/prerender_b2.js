#!/usr/bin/env node
/* B2 verification harness (NOT app code). Exercises the pure data + render
 * layers exactly as the future SEO pre-render will: load election-data.json,
 * render the school_board page (sb-d03 / District 2A active) and assert the
 * prototype-fidelity output. Run from embed/:
 *   node tools/prerender_b2.js
 *
 * GATED at SBE-RERUN-1 F as [RENDER/B2], and READ-ONLY as of the same commit. It had
 * been invoked by nothing in code — only by DEPLOY.md:59's "Verify before pasting"
 * ritual — and it had been FAILING three assertions while outstanding paste debt sat in
 * front of it. Two were a stale DeBerry pin (eda9d31's recency ingest, repinned below
 * with the cause); the third was a LIVE double-space regression in a committee name that
 * this harness alone caught, fixed at source in commit D and now asserted by [NAMES/WS].
 * The unconditional write of tools/preview_b2.html was removed — see the note at the
 * former write site. Its 120 assertions cover ten subjects no other check does, which is
 * why it was repaired rather than deleted.
 *
 * HALT-P1-C: District 2A (sb-d03) is now a TOGGLE race (its returners Leon+DeBerry
 * carry verified person-links), so the page renders the This/Last/All view. The
 * District-2A block below asserts the figures/drill-downs under the COMBINED ('all')
 * tab, where the all-years totals live — same numbers, toggle DOM. Base-view DOM
 * coverage (flat cards, cand-…-slug, d- bars) is preserved by the sb-d01 fixture
 * (a non-toggle race) in the B2-BASEVIEW block.
 */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });   // the embed is per-office
var indexAll = D.loadData(json);                            // unscoped, for scope comparison

var OFFICE = 'school_board';
var W24 = { start: null, end: '2024-12-31' };
var omVM = D.viewModels.officeRaces(index, OFFICE);
var rv = D.viewModels.raceView(index, index.raceBySlug['district-2a'], null);
// District 2A is a TOGGLE race (HALT-P1-C): render the COMBINED ('all') election tab, whose
// per-candidate combined cards carry the all-years totals the base view used to show.
var page = R.renderPage({ office: OFFICE, topView: 'byrace', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv,
  selector: { options: D.selectorOptions(OFFICE), active: '2026' } });

// The preview WRITE was removed at SBE-RERUN-1 F. It wrote tools/preview_b2.html
// unconditionally and BEFORE the first assertion — nothing in the repo referenced the
// output, DEPLOY.md asks for the assertions and not a file, and the eyeball affordance is
// superseded by build_preview.js --bundle, whose preview is vintage-stamped and is what
// the gate loads. It was also the only structural bar to running this harness as a gate
// line: a check must not write. R.styles() is still exercised below via the render path.

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }

// [DATA/ONEPASS] PORTED from smoke_b1.js at SBE-RERUN-1 G. Ishan's instruction was to
// port it into validate_council_data alongside the parent_id check; it cannot live there.
// The invariant is a property of the JS data layer's load — loadData records what it
// actually visited in index._stats — and the Python validator has no access to it. This is
// its correct home: an already-gated harness that calls D.loadData on the real artifact.
// It asserts loadData makes exactly ONE pass over each row collection; a regression to a
// nested scan would still produce right answers while going quadratic on a 7.9 MB artifact,
// which is the kind of defect no output check would ever notice.
console.log('=== B2 data-layer invariants (ported from smoke_b1.js) ===');
ok('[DATA/ONEPASS] single pass over contributions (' + indexAll._stats.contributionRowsVisited +
   ' === ' + json.contributions.length + ')',
   indexAll._stats.contributionRowsVisited === json.contributions.length);
ok('[DATA/ONEPASS] single pass over IEs (' + indexAll._stats.ieRowsVisited + ' === ' +
   json.independent_expenditures.length + ')',
   indexAll._stats.ieRowsVisited === json.independent_expenditures.length);

console.log('\n=== B2 render assertions (school_board, District 2A active) ===');
ok('renders DeBerry card', /Ebony DeBerry/.test(page));
ok('renders Leon card', /Bruce Leon/.test(page));
ok('neutral order: DeBerry before Leon', page.indexOf('Ebony DeBerry') < page.indexOf('Bruce Leon'));
// SCOPE-UI / F-2: the combined all-years figures no longer render on race pages —
// district-2a is scoped to the 2026 window. Leon's money is entirely 2024-window, so
// his honest 2026 card shows $0 (the largest F-2 instance); DeBerry shows her
// 2026-window rows. The same dollars are pinned at the DATA layer, per window.
ok('scoped page: Leon renders WITHOUT the 2024-window $620,403 (F-2 pinned)', /Bruce Leon/.test(page) && page.indexOf('$620,403') < 0);
ok('scoped page: DeBerry 2026-window contributions render ($2,781)', page.indexOf('$2,781') >= 0);
ok('Leon 2024-window figures intact at the data layer ($620,403 / self $620,025 / third $378 / ieS $24,766)',
  (function () { var f = D.candidateFigures(index, 'leon-sb-d03', null, W24);
    return Math.round(f.contributions.total) === 620403 && Math.round(f.contributions.selfFunded) === 620025 &&
           Math.round(f.contributions.thirdParty) === 378 && Math.round(f.independentSupport) === 24766; })());
// The support half was PORTED from smoke_b1.js at SBE-RERUN-1 G — a THIRD uncovered
// subject, found while confirming the other 11 before deleting that file. Opposition was
// already asserted here; support == 0 was asserted nowhere. An opposed-only candidate
// whose support silently became non-zero is exactly the kind of firewall leak the
// separate-streams rule exists to prevent, so the zero is the load-bearing half.
ok('DeBerry 2024-window IE intact at the data layer (support $0 / opposition $126,078)',
  D.candidateFigures(index, 'deberry-sb-d03', null, W24).independentSupport === 0 &&
  Math.round(D.candidateFigures(index, 'deberry-sb-d03', null, W24).independentOpposition) === 126078);
ok('three figure bars present', /From contributors/.test(page) && /Independent support/.test(page) && /Independent opposition/.test(page));
// "Mostly self-funded" is a base-view chip (absent from the toggle DOM); assert the
// underlying fact at the data layer instead — Leon's self-funding dwarfs his third-party gifts.
(function () {
  var lc = D.candidateContributors(index, 'leon-sb-d03', null);
  var self = lc.lines.filter(function (l) { return l.isSelf; }).reduce(function (s, l) { return s + l.total; }, 0);
  var other = lc.lines.filter(function (l) { return !l.isSelf; }).reduce(function (s, l) { return s + l.total; }, 0);
  ok('Leon is mostly self-funded (data: self $' + Math.round(self) + ' >> third-party $' + Math.round(other) + ')', self > other * 10);
})();
ok('DeBerry "Incumbent" chip', /chip-inc/.test(page));
ok('exact disclaimer copy (footer)', /separately and never added together/.test(page));
ok('SCOPE-UI: global selector renders (no per-race toggle control)', /data-election="2026"/.test(page) && page.indexOf('data-electionview') < 0);
ok('scoped base card id: cand-bruce-leon-district-2a (combined blocks retired)', /id="cand-bruce-leon-district-2a"/.test(page));
ok('District 2A chip is active', /data-slug="district-2a" aria-pressed="true"/.test(page));
ok('coming-soon races marked (· soon)', /· soon/.test(page));
ok('President + districts in ONE selector (no office sub-tabs)',
  /data-slug="school-board-president"/.test(page) && /data-slug="district-2a"/.test(page) && page.indexOf('aria-label="Office section"') < 0);
ok('figures NOT summed (no grand-total markup)', page.indexOf('Total raised') < 0 && page.indexOf('grand total') < 0);

console.log('\n=== B2-BASEVIEW assertions (a non-toggle race still renders the flat base view) ===');
// sb-d01 (District 1A: Bannon, Luczak) has no person-linked returner, so it stays a base-view
// race — preserving the flat-card coverage District 2A gave before it became a toggle race.
var rv1 = D.viewModels.raceView(index, index.raceBySlug['district-1a'], null);
ok('sb-d01 (like every race post-toggle) has no elections VM key', rv1.elections === undefined);
var page1 = R.renderPage({ office: OFFICE, topView: 'byrace', officeRaces: omVM, activeSlug: 'district-1a', raceView: rv1 });
ok('base view renders candidate cards (Bannon)', /Ed Bannon/.test(page1));
ok('base-view slug scheme: cand-ed-bannon-district-1a', /id="cand-ed-bannon-district-1a"/.test(page1));
// HALT-F2 (PS-79 A1): base-view figures are scoped to the race's own election window,
// and the meta names that election — "all years" would now be a mislabel here.
ok('base view: election-scoped meta ("· 2026 election"), NO election toggle', /· 2026 election/.test(page1) && page1.indexOf('data-electionview') < 0);
ok('base view: contributor panel + clickable d- bars', /class="contrib"/.test(page1) && /class="barrow click"/.test(page1) && /aria-controls="d-/.test(page1));
ok('base view: candidate Sunshine link present', /Illinois Sunshine ↗/.test(page1));
ok('base view: figures NOT summed (no grand-total)', page1.indexOf('Total raised') < 0 && page1.indexOf('grand total') < 0);

console.log('\n=== B2-FIXES assertions ===');
// Vacating incumbents: Custer (sb-d02 / District 1B) and Biggs (sb-d12 / District 6B)
var d02 = R.renderRaceView(D.viewModels.raceView(index, index.raceBySlug['district-1b'], null));
var d12 = R.renderRaceView(D.viewModels.raceView(index, index.raceBySlug['district-6b'], null));
var pres = R.renderRaceView(D.viewModels.raceView(index, index.raceBySlug['school-board-president'], null));
ok('sb-d02 does NOT show a Custer candidate card', d02.indexOf('cand-jennifer-custer') < 0);
ok('sb-d02 still lists its real candidates (Peralta/Pierre)', /Peralta/.test(d02) && /Pierre/.test(d02));
ok('sb-d02 vacating note: Custer -> Board President (links to president race)',
  /Current member <b>Jennifer Custer<\/b> is running for/.test(d02) && /data-slug="school-board-president"/.test(d02));
ok('sb-d12 does NOT show a Biggs candidate card', d12.indexOf('cand-jessica-biggs') < 0);
ok('sb-d12 vacating note: Biggs -> Board President',
  /Current member <b>Jessica Biggs<\/b> is running for/.test(d12) && /data-slug="school-board-president"/.test(d12));
ok('sb-president (now toggle) lists Custer AND Biggs as candidates',
  /Jennifer Custer/.test(pres) && /Jessica Biggs/.test(pres) && pres.indexOf('data-electionview') < 0);

// View toggle: active chip + view move on topView change
var spendPage = R.renderPage({ office: OFFICE, topView: 'spend', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv });
ok('toggle: spend view renders its coming-soon placeholder', /Election spend — coming soon/.test(spendPage));
ok('toggle: Election-spend tab active when topView=spend',
  /data-view="spend" aria-selected="true"/.test(spendPage) && /data-view="byrace" aria-selected="false"/.test(spendPage));
ok('toggle: By-race tab active when topView=byrace',
  /data-view="byrace" aria-selected="true"/.test(page) && /data-view="spend" aria-selected="false"/.test(page));

// Cycle label
ok('race-view meta names the election (\u00b7 2026 election), never "current cycle"', /\u00b7 2026 election/.test(page) && page.indexOf('current cycle') < 0);

console.log('\n=== B3 assertions (drill-downs + Sunshine) ===');
function sumLines(cd) { return Math.round(cd.lines.reduce(function (s, l) { return s + l.total; }, 0)); }
var leonC = D.candidateContributors(index, 'leon-sb-d03', null);
var debC = D.candidateContributors(index, 'deberry-sb-d03', null);
ok('Leon contributor lines sum EXACTLY to $620,403', sumLines(leonC) === 620403 && Math.round(leonC.total) === 620403);
// REPINNED 534950 -> 537306 at SBE-RERUN-1 F, cause identified and ratified: eda9d31
// (HALT-Q2R, "Q2 recency ingest") added +13 rows / +$2,356.26 to DeBerry — exactly what a
// recency ingest does. Walked the artifact history to date it: 534,950.12 / 200 rows held
// from 96cdce1 through dd30588 (HALT-SLUG-A) and became 537,306.38 / 213 rows at eda9d31.
// DeBerry's committee 39821 is UNMOVED across the SBE-RERUN-1 refresh ($537,306.38 both
// sides), so today's run is not involved. The pin was never updated because nothing ran
// this harness. Benign and explained — the [EXCL/SEIU] discipline's clean case.
ok('DeBerry contributor lines sum EXACTLY to $537,306', sumLines(debC) === 537306 && Math.round(debC.total) === 537306);
ok('Leon contributor list flags a self/loan line', leonC.lines.some(function (l) { return l.isSelf; }));
ok('contributor list has NO small-dollar aggregate line (every contribution itemized)', leonC.lines.some(function (l) { return l.isAggregate; }) === false && debC.lines.some(function (l) { return l.isAggregate; }) === false);

var debOpp = D.candidateIE(index, 'deberry-sb-d03', 'oppose', null);
ok('DeBerry opposition drill-down totals $126,078 with >=1 spender', Math.round(debOpp.total) === 126078 && debOpp.spenders.length >= 1);
ok('DeBerry opposition spender surfaces SECOND-HOP funders', debOpp.spenders[0].topFunders.length >= 1 && debOpp.spenders[0].funderTotal > 0);
console.log('       (lead funders: ' + debOpp.spenders[0].topFunders.map(function (f) { return f.name; }).join(', ') + ')');

var debMeta = D.committeeMeta(index, 'deberry-sb-d03');
ok('DeBerry committee Sunshine URL builds', /^https:\/\/illinoissunshine\.org\/committees\/.+\/$/.test(debMeta.sunshineUrl));
ok('IE spender Sunshine URL builds (encoded sbe id)', !!debOpp.spenders[0].sunshineUrl && /illinoissunshine\.org\/committees\//.test(debOpp.spenders[0].sunshineUrl));

ok('page renders contributor panels', /class="contrib"/.test(page) && /Who gave to this campaign/.test(page));
ok('bars are clickable disclosures (caret + aria-controls)', /class="barrow click"/.test(page) && /aria-controls="d-/.test(page));
ok('candidate committee Sunshine link present in card', /Illinois Sunshine ↗/.test(page));

console.log('\n=== B3-REVISE assertions (three tiers + footprint + tags) ===');
var sp0 = debOpp.spenders[0];
// Tier 1: committee, amount, stance, Sunshine — NOT the funders yet
// F-2 FULL EXTENT, PINNED: no race page renders an IE panel at this vintage — every
// school-board IE row is 2024-window and targets a 2026 candidacy id (P1-B matching),
// so in-window IE is zero on every reachable race card in BOTH scopes. The Tier-1/2/3
// IE-panel DOM returns to race pages when P1-E re-routes 2024 targets; until then the
// IE surfaces are the 2024-scope spend tab + committee profiles (gate_bundle-covered).
ok('F-2 PINNED: no IE-panel DOM (ie-cmte-toggle) on either scoped page', page.indexOf('ie-cmte-toggle') < 0 && page1.indexOf('ie-cmte-toggle') < 0);
ok('Tier-2 invariants intact at the data layer (spender + second-hop funders + receipt-vs-spend)',
  sp0.topFunders.length >= 1 && sp0.funderTotal > 0);
ok('Tier 2 funder rows are clickable (data-funder) -> Tier 3', /class="crow funder-row" type="button" data-funder="/.test(page));
// Funder amounts are PAC RECEIPTS, not race spend: top funder gave the PAC far
// more than the PAC spent opposing DeBerry ($126,078).
ok('funder amount is a PAC receipt, not the race spend', sp0.topFunders[0].total !== sp0.amount && sp0.funderTotal > sp0.amount);
// Tier 3: donor footprint resolves for a funder (committee -> its funders -> footprint)
var topFunderId = sp0.funders[0].parent_id;
var fp = D.donorFootprint(index, topFunderId);
ok('Tier 3 footprint resolves to >=1 recipient committee/candidate', fp.committees.length >= 1 && fp.total > 0);
ok('Tier 3 footprint is election-scoped (modal copy says so)',
  /Donor footprint · this election only/.test(R.renderFunderModal(fp)) && /Council-side giving is a separate/.test(R.renderFunderModal(fp)));
// Tags/flags surface (uncategorized never blank)
ok('funder rows render industry tag(s) (uncategorized if none)', /class="tagchip ind">/.test(page));
ok('tags helper shows "uncategorized" rather than blank for an empty donor',
  /class="tagchip ind">uncategorized<\/span>/.test(R.renderFunderModal(D.donorFootprint(index, sp0.funders[0].parent_id))) ||
  R.renderFunderModal(fp).indexOf('tagchip ind') >= 0);

console.log('\n=== B3-REVISE-2 assertions (unified donor rows) ===');
var debCd = D.candidateContributors(index, 'deberry-sb-d03', null);
var realLine = debCd.lines.filter(function (l) { return !l.isSelf && !l.isAggregate; })[0];
var selfLine = debCd.lines.filter(function (l) { return l.isSelf; })[0] || leonC.lines.filter(function (l) { return l.isSelf; })[0];
ok('DeBerry has a real (non-self, non-aggregate) contributor line', !!realLine && !!realLine.parent_id);
// A real contributor row renders EXACTLY like a PAC funder row: clickable + tagged.
var realRow = R.donorRow(realLine);
ok('real contributor row is clickable (funder-row + data-funder) and tagged',
  /class="crow funder-row" type="button" data-funder="/.test(realRow) && /class="tagchip ind"/.test(realRow));
// Exceptions stay non-clickable + no industry tag.
var selfRow = R.donorRow(selfLine);
ok('self-funding/loan line is a plain labeled line (no button, no industry tag)',
  /class="crow plain"/.test(selfRow) && selfRow.indexOf('funder-row') < 0 && selfRow.indexOf('tagchip ind') < 0);
ok('no small-dollar aggregate line exists (every contribution itemized)',
  debCd.lines.some(function (l) { return l.isAggregate; }) === false);
// The same shared row path means contributor + funder rows are byte-identical for a donor.
ok('contributor row == funder row for the same donor (one shared path)',
  R.donorRow({ parent_id: 'x', name: 'Acme PAC', industries: ['labor-trades'], flags: [], total: 100, count: 1 }) ===
  R.donorRow({ parent_id: 'x', name: 'Acme PAC', industries: ['labor-trades'], flags: [], total: 100, count: 1 }));

// Footprint spans BOTH lenses (direct candidate gifts + IE-committee funding),
// regardless of which lens it was opened from (it's keyed only by parent_id).
var multiFp = null;
for (var pid in index.parentRollup) {
  if (!index.parentRollup.hasOwnProperty(pid)) continue;
  var f = D.donorFootprint(index, pid);
  if (f.committees.some(function (x) { return x.kind === 'candidate'; }) &&
      f.committees.some(function (x) { return x.kind === 'ie'; })) { multiFp = f; break; }
}
ok('a donor footprint aggregates BOTH lenses (direct candidate + IE funding)', !!multiFp);
if (multiFp) console.log('       (example multi-lens donor: ' + multiFp.name + ' → ' + multiFp.committees.length + ' recipients across both)');
ok('footprint is keyed only by parent_id (identical from either lens)',
  D.donorFootprint(index, realLine.parent_id).parent_id === realLine.parent_id);

console.log('\n=== B3-REVISE-3 assertions (named committees + committee profile + tail) ===');
// 1) Footprint committees show a name/identity, never the bare placeholder id.
// Use a donor whose footprint includes an IE committee (multiFp from above).
var fpMulti = multiFp || fp;
var fpModal = R.renderFunderModal(fpMulti);
ok('footprint IE committee row shows identity ("Funded primarily by"), not bare id',
  /Funded primarily by /.test(fpModal) && fpModal.indexOf('>IE committee ') < 0);
ok('footprint committee rows are clickable (data-committee)', /data-committee="/.test(fpModal));
ok('footprint candidate committee shows its real name', /Michelle Pierre|Ebony DeBerry|Bruce Leon/.test(fpModal) || /class="kind cand"/.test(fpModal));

// 2) Committee-profile modal resolves support/oppose + funders for an IE committee.
var prof = D.committeeProfile(index, 'ie-committee-26066');
ok('IE committee profile resolves spend (support+oppose) + funders',
  prof.isIE && prof.total > 0 && prof.targets.length >= 1 && prof.funders.length >= 1);
ok('IE committee profile splits support vs opposition across candidates', prof.support > 0 && prof.oppose > 0);
var profHtml = R.renderCommitteeProfile(prof);
ok('committee-profile modal renders "What it spent on" + "Who funds this committee"',
  /What it spent on/.test(profHtml) && /Who funds this committee/.test(profHtml));
ok('committee-profile funders are clickable donorRows (back to footprint)', /class="crow funder-row" type="button" data-funder=/.test(profHtml));
// candidate committee profile (other content type, same modal)
var candProf = D.committeeProfile(index, index.committeeKeyByCandidate['deberry-sb-d03']);
ok('candidate committee profile shows raised + contributors', candProf.kind === 'candidate' && candProf.raised > 0 && candProf.funders.length >= 1);

// 3) ONE modal mount/close path (no fork): single openModal/closeModal in app.js,
// and BOTH modal types carry the same close affordances.
var appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
ok('app.js has exactly one openModal and one closeModal (no fork)',
  (appSrc.match(/function openModal\(/g) || []).length === 1 && (appSrc.match(/function closeModal\(/g) || []).length === 1);
ok('both modal types use the same close affordances (data-modal-close + overlay)',
  /data-modal-close/.test(fpModal) && /data-modal-overlay/.test(fpModal) &&
  /data-modal-close/.test(profHtml) && /data-modal-overlay/.test(profHtml));

// 1.5) "Show all" expands the full remainder; rows clickable; sums hold.
var debCd2 = D.candidateContributors(index, 'deberry-sb-d03', null);
var debPanel = R.contributorPanel(debCd2, 'tst');
var realCount = debCd2.lines.filter(function (l) { return !l.isSelf && !l.isAggregate; }).length;
var funderBtns = (debPanel.match(/class="crow funder-row" type="button" data-funder=/g) || []).length;
ok('every real donor (top 25 + expanded remainder) is a clickable row', funderBtns === realCount && realCount > 25);
ok('"Show all N donors" toggle reveals the remainder inline', /Show all \d+ donors/.test(debPanel) && /class="contrib tall"/.test(debPanel));
ok('NO small-dollar aggregate line in the panel (every contribution itemized)',
  debPanel.indexOf('class="crow plain"><div class="who">Small-dollar donors') < 0 &&
  debCd2.lines.some(function (l) { return l.isAggregate; }) === false);
// REPINNED 534950 -> 537306, same cause as :126 above (eda9d31 HALT-Q2R). Same figure
// reached a second way — through the expanded panel's line set rather than cd.total.
ok('full set (real + self) sums EXACTLY to the headline ($537,306)',
  Math.round(debCd2.lines.reduce(function (s, l) { return s + l.total; }, 0)) === 537306);

console.log('\n=== B3-REVISE-4 assertions (resolved IE committee names) ===');
// Real name resolved at the source (enrich), shown primary + funder subtitle.
var prof26066 = D.committeeProfile(index, 'ie-committee-26066');
ok('IE committee 26066 carries a real name (enriched, not placeholder)', prof26066.name === 'INCS Action Independent Committee');
var prof26066Html = R.renderCommitteeProfile(prof26066);
ok('committee-profile shows real name primary + "Funded primarily by" + no bare id',
  /INCS Action Independent Committee/.test(prof26066Html) && /Funded primarily by /.test(prof26066Html) && prof26066Html.indexOf('IE committee 26066') < 0);
// Footprint modal IE row: name primary + subtitle, never the bare placeholder.
var frankId = (function () { for (var p in index.parentRollup) if (/James S\. Frank/.test((index.donors[p] || {}).name)) return p; })();
var frankHtml = R.renderFunderModal(D.donorFootprint(index, frankId));
ok('footprint IE row shows resolved name + "Funded primarily by" subtitle',
  /INCS Action Independent Committee/.test(frankHtml) && /class="sub">Funded primarily by/.test(frankHtml));
ok('footprint IE row no longer shows the bare placeholder text', frankHtml.indexOf('>IE committee 26066') < 0);
// IE drill-down on the page shows the resolved name (DeBerry opposition spender = 26066).
ok('IE committee name resolves (INCS Action Independent Committee)', D.committeeProfile(index, 'ie-committee-26066').name === 'INCS Action Independent Committee');
// Genuinely-unnamed committee (39901) keeps the framed-identity fallback, never a bare id.
var prof39901Html = R.renderCommitteeProfile(D.committeeProfile(index, 'ie-committee-39901'));
ok('genuinely-unnamed IE (39901) falls back to framed identity, never a bare id',
  prof39901Html.indexOf('IE committee 39901') < 0 && /Funded primarily by |Independent-expenditure committee/.test(prof39901Html));
// "Show all N" count == clickable real-donor rows (excl. self + small-dollar).
(function () {
  var cd = D.candidateContributors(index, 'deberry-sb-d03', null), panel = R.contributorPanel(cd, 'x');
  var m = panel.match(/Show all (\d+) donors/), N = m ? +m[1] : -1;
  var btns = (panel.match(/class="crow funder-row" type="button" data-funder=/g) || []).length;
  var real = cd.lines.filter(function (l) { return !l.isSelf && !l.isAggregate; }).length;
  ok('"Show all N" N excludes self/small-dollar and equals the clickable rows (' + N + '=' + real + '=' + btns + ')',
    N === real && btns === real);
})();

console.log('\n=== B3-REVISE-5 assertions (school-board scope + spender guard + Bannon) ===');
function ieCount(idx) { var n = 0; for (var c in idx.ieByCandidate) n += idx.ieByCandidate[c].support.length + idx.ieByCandidate[c].oppose.length; return n; }
ok('unscoped index keeps all IEs incl. council (' + ieCount(indexAll) + ' = ' + json.independent_expenditures.length + ')', ieCount(indexAll) === json.independent_expenditures.length);
ok('school-board scope keeps ONLY school-board IEs (110), drops council (218)', ieCount(index) === 110);
var councilTarget = false;
for (var cc in index.ieByCandidate) { var r5 = index.raceById[(index.candidateById[cc] || {}).race_id] || {}; if (r5.office === 'alderperson' || r5.office === 'mayor') councilTarget = true; }
ok('no council/municipal IE target survives school-board scope', !councilTarget);
var scopedSpenders = Object.keys(index.iesBySpender);
ok('council candidate committees (26023 Villegas / 19830 Sposato) are NOT scoped IE spenders',
  scopedSpenders.indexOf('ie-committee-26023') < 0 && scopedSpenders.indexOf('ie-committee-19830') < 0);
ok('scoped school-board IE spenders are real IE PACs (e.g. INCS 26066)', scopedSpenders.indexOf('ie-committee-26066') >= 0);
// item 5 structural guard: no ELECTION candidate committee is ever an IE spender (even unscoped)
var candKeys = {}; Object.keys(indexAll.committeeKeyByCandidate).forEach(function (cId) { candKeys[indexAll.committeeKeyByCandidate[cId]] = 1; });
ok('guard: no election candidate committee appears as an IE spender',
  Object.keys(indexAll.iesBySpender).every(function (k) { return !candKeys[k]; }));
// scoped footprint excludes council-only IE committees, keeps in-scope + direct
var frankId5 = (function () { for (var p5 in index.parentRollup) if (/James S\. Frank/.test((index.donors[p5] || {}).name)) return p5; })();
var frankScoped = D.donorFootprint(index, frankId5);
ok('scoped footprint drops council-only IE committee (26023)',
  frankScoped.committees.every(function (x) { return x.committee_id !== 'ie-committee-26023'; }));
ok('scoped footprint keeps in-scope IE (26066) + the direct candidate gift',
  frankScoped.committees.some(function (x) { return x.committee_id === 'ie-committee-26066'; }) &&
  frankScoped.committees.some(function (x) { return x.kind === 'candidate'; }));
// Bannon count locked: button N == clickable rows == real donors; self/small-dollar excluded
(function () {
  var cd = D.candidateContributors(index, 'bannon-sb-d01', null), panel = R.contributorPanel(cd, 'b');
  var m = panel.match(/Show all (\d+) donors/), N = m ? +m[1] : -1;
  var btns = (panel.match(/class="crow funder-row" type="button" data-funder=/g) || []).length;
  var real = cd.lines.filter(function (l) { return !l.isSelf && !l.isAggregate; }).length;
  ok('Bannon: button N == clickable == real (' + N + '=' + btns + '=' + real + '), self/small-dollar excluded', N === btns && btns === real);
})();

console.log('\n=== B3-REVISE-6 assertions (resolved names + funder-tail expansion) ===');
// All 3 formerly-unnamed committees now resolved from Illinois Sunshine (at source).
ok('39901 -> "Urban Center Action" (Leon support spender, now named)', D.committeeProfile(index, 'ie-committee-39901').name === 'Urban Center Action');
ok('resolved names reach the render layer via committee profiles (Urban Center Action)', /Urban Center Action/.test(R.renderCommitteeProfile(D.committeeProfile(index, 'ie-committee-39901', W24))));
ok('539 -> "Illinois Farm Bureau ACTIVATOR"', (json.committees['ie-committee-539'] || {}).committee_name === 'Illinois Farm Bureau ACTIVATOR');
ok('36936 -> "Areyto Political Action Committee"', (json.committees['ie-committee-36936'] || {}).committee_name === 'Areyto Political Action Committee');
ok('NO IE committee remains a bare placeholder', Object.keys(json.committees).every(function (k) {
  var cm = json.committees[k]; return cm.type !== 'independent_expenditure' || !/^IE committee \d+$/.test(cm.committee_name || '');
}));
// Tier-2 funder tail expands to ALL funders, each a clickable donorRow.
var ieDebOpp = D.candidateIE(index, 'deberry-sb-d03', 'oppose', null);
var iePanelHtml = R.iePanel(ieDebOpp, 'Ebony DeBerry', 'tst');
var totalFunders = ieDebOpp.spenders.reduce(function (s, sp) { return s + sp.funders.length; }, 0);
var funderRows = (iePanelHtml.match(/class="crow funder-row" type="button" data-funder=/g) || []).length;
ok('IE funder tail has a "Show all N funders" toggle', /Show all \d+ funders/.test(iePanelHtml));
ok('IE funder tail reveals ALL funders as clickable rows (' + funderRows + ' = ' + totalFunders + ')', funderRows === totalFunders && totalFunders > 10);

console.log('\n=== B4 assertions (Election Spend subtabs) ===');
var donorsVM = D.spendSubtab(index, 'school_board', 'donors');
var candsVM = D.spendSubtab(index, 'school_board', 'candidates');
var indsVM = D.spendSubtab(index, 'school_board', 'industries');
var ixcVM = D.spendSubtab(index, 'school_board', 'industry-candidate');
var flagsVM = D.spendSubtab(index, 'school_board', 'flags');
ok('browse-donors resolves with donor rows (2026 scope; IE rows live in the 2024 window)',
  donorsVM.rows.length > 0 && donorsVM.rows.some(function (r) { return r.kind === 'donor'; }));
ok('browse-donors under the 2024 window resolves BOTH donor rows and IE-PAC spender rows',
  (function () { var v = D.spendSubtab(index, 'school_board', 'donors', null, '2024');
    return v.rows.some(function (r) { return r.kind === 'donor'; }) && v.rows.some(function (r) { return r.kind === 'ie'; }); })());
ok('spend-by-candidate resolves (grouped API: race groups + candidates within)',
  candsVM.groups.length > 0 && candsVM.groups.reduce(function (s, g) { return s + g.candidates.length; }, 0) > 0);
ok('industry-totals resolves and includes uncategorized (never folded)',
  indsVM.industries.length > 0 && indsVM.industries.some(function (x) { return x.industry === 'unclassified' || x.industry === 'uncategorized'; }));
ok('industries-by-candidate resolves', ixcVM.rows.length > 0);
ok('flag-totals resolves (array; may be empty for this office)', Array.isArray(flagsVM.flags));
// KEY (fixture-injected): spend-by-candidate surfaces IE money for a COMMITTEE-LESS
// candidate. Every real committee-less candidate carries $0 IE, so this invariant is
// vacuous against live data and would silently lose value on any data shift. We exercise
// it against an in-memory fixture instead: one obviously-synthetic committee-less
// candidate given synthetic IE support, run through the same load + spendSubtab path.
// The fixture is a deep copy — real `json` is never mutated.
(function () {
  var fx = JSON.parse(JSON.stringify(json));
  var FX_RACE = 'sb-d13', FX_ID = 'zzz-fixture-cmteless-cand', FX_IE = 98765;   // synthetic
  fx.candidates.push({ id: FX_ID, race_id: FX_RACE, name: 'Zzy Fixturetest (SYNTHETIC)',
    committee_id: null, status: 'filed', incumbent: false,
    vacating_for: null, bio: {}, positions: null });
  // date sits inside the school_board election window (real rows are cycle 2027 / dated 2024)
  fx.independent_expenditures.push({ id: 'ie-fixture-synth-1', spender_committee_id: 'ie-committee-22729',
    target_committee_id: null, target_candidate_id: FX_ID, target_race_id: FX_RACE, target_ward: null,
    match_method: 'exact', needs_review: false, stance: 'support', amount: FX_IE, date: '2024-09-26',
    cycle: '2027', source_filing: '9B', filed_doc_id: 'fixture', purpose: 'SYNTHETIC fixture' });
  // SCOPE-UI: the injected IE is dated 2024-09-26, so its money's window is '2024' (F-2 semantics).
  var fvm = D.spendSubtab(D.loadData(fx, { office: 'school_board' }), 'school_board', 'candidates', null, '2024');
  var fc = null; fvm.groups.forEach(function (g) { g.candidates.forEach(function (c) { if (c.id === FX_ID) fc = c; }); });
  ok('spend-by-candidate surfaces IE money for a committee-LESS candidate (fixture-injected)',
    !!fc && fc.hasCommittee === false && Math.round(fc.figures.independentSupport) === FX_IE);
  if (fc) console.log('       (synthetic committee-less candidate surfaced with $' + Math.round(fc.figures.independentSupport) + ' IE support)');
})();
// three figures shown separately (never summed)
var candHtml = R.renderSpend(candsVM);
ok('spend-by-candidate shows three separate figures (contrib/support/oppose)',
  /contrib<\/span>/.test(candHtml) && /support<\/span>/.test(candHtml) && /oppose<\/span>/.test(candHtml));
// Ordering (E-7): candidates are ranked by DESCENDING direct contributions.total within
// each race group, and IE is DELIBERATELY EXCLUDED from the rank — ranking by a fused
// direct+IE figure would be a per-candidate stream fusion, firewall-inconsistent. Assert
// both halves positively: (1) every group is contributions.total-descending; (2) the
// exclusion is active — some group has a lower-ranked candidate carrying a LARGER IE
// figure than the one above it (proving IE does not drive rank). Both computed from data.
var allDesc = candsVM.groups.every(function (g) {
  for (var i = 0; i < g.candidates.length - 1; i++) {
    if (g.candidates[i].figures.contributions.total < g.candidates[i + 1].figures.contributions.total) return false;
  }
  return true;
});
ok('candidates ranked by descending direct contributions within each race group', allDesc);
var ieExcludedPair = null;
// SCOPE-UI: rank-vs-IE divergence needs IE in-window — use the 2024 selection (F-2: the
// school-board IE is all 2024-window).
var cands24VM = D.spendSubtab(index, 'school_board', 'candidates', null, '2024');
cands24VM.groups.forEach(function (g) {
  for (var i = 0; i < g.candidates.length - 1; i++) {
    if (!ieExcludedPair && g.candidates[i + 1].figures.independentSupport > g.candidates[i].figures.independentSupport) {
      ieExcludedPair = { race: g.race.label, higher: g.candidates[i].name, lower: g.candidates[i + 1].name };
    }
  }
});
ok('IE is excluded from rank (a lower-ranked candidate carries larger IE than the one above)', !!ieExcludedPair);
if (ieExcludedPair) console.log('       (' + ieExcludedPair.race + ': ' + ieExcludedPair.higher + ' ranks above ' + ieExcludedPair.lower + ', who has larger IE)');
// office scope: every group is a school-board race (president or member); the school_board
// page spans two offices, and no ward/council/mayor race may leak in. (Race info lives at
// the group level in the grouped API; candidates no longer carry raceSlug.)
ok('spend-by-candidate is office-scoped (all groups are school_board races)',
  candsVM.groups.length > 0 && candsVM.groups.every(function (g) { return /^school_board/.test(g.race.office); }));
// browse-donors rows open the RIGHT modal
var donorsHtml = R.renderSpend(donorsVM);
ok('browse-donors: donor rows open the footprint modal (data-funder)', /class="crow funder-row" type="button" data-funder=/.test(donorsHtml));
ok('browse-donors: IE-PAC rows open the committee-profile modal (data-committee — 2024 window, where the IE rows live)',
  /class="crow funder-row" type="button" data-committee=/.test(R.renderSpend(D.spendSubtab(index, 'school_board', 'donors', null, '2024'))));
// industries-by-candidate: uncategorized shown, never blank
var ixcHtml = R.renderSpend(ixcVM);
ok('industries-by-candidate surfaces uncategorized (never blank/folded)',
  /uncategorized/.test(ixcHtml) && ixcVM.rows.every(function (r) { return r.industries.length > 0; }));
// subtab nav present + the spend view replaces the placeholder
var spendPage = R.renderPage({ office: 'school_board', topView: 'spend', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv, spend: donorsVM });
ok('spend view renders the subtab nav (5 tabs) instead of coming-soon',
  /data-spendtab="donors"/.test(spendPage) && /data-spendtab="candidates"/.test(spendPage) &&
  /data-spendtab="industries"/.test(spendPage) && /data-spendtab="industry-candidate"/.test(spendPage) &&
  /data-spendtab="flags"/.test(spendPage) && spendPage.indexOf('Election spend — coming soon') < 0);

console.log('\n=== B5 assertions (year filter + office param + Recoleta) ===');
var cyclesAvail = D.availableCycles(index);
ok('available cycles include the data cycle (2027)', cyclesAvail.indexOf('2027') >= 0);
var pageCyc = R.renderPage({ office: 'school_board', topView: 'byrace', cycles: cyclesAvail, cycle: null, officeRaces: omVM, activeSlug: 'district-2a', raceView: rv });
ok('cycle pills REMOVED from election views (election toggle is the sole time control)',
  pageCyc.indexOf('data-cycle') < 0 && pageCyc.indexOf('cycle-bar') < 0 &&
  Math.round(D.candidateFigures(index, 'leon-sb-d03', null).contributions.total) === 620403);
ok('cycle data functions still accept a cycle arg (data layer intact)', cyclesAvail.indexOf('2027') >= 0);
ok('cycle filter degrades cleanly (single cycle: 2027 == current)',
  Math.round(D.candidateFigures(index, 'deberry-sb-d03', '2027').contributions.total) === Math.round(D.candidateFigures(index, 'deberry-sb-d03', null).contributions.total));
(function () {
  // SCOPE-UI: thread under the 2024 selection — its window spans the 2023 + 2027 SBE cycles,
  // so the cycle argument is differentiable (the 2026 window holds cycle-2027 rows only).
  function dir(cyc) { return D.spendSubtab(index, 'school_board', 'industries', cyc, '2024').industries.reduce(function (s, x) { return s + x.direct; }, 0); }
  ok('spend subtabs genuinely thread cycle (industries direct @2027 < all-time, both > 0)',
    dir('2027') > 0 && dir('2027') < dir(null) && dir('bogus-cycle') === 0);
})();
// MUNI-ENABLE-1 G4, RE-EXPRESSED at ELEC-IDENTITY-1 S1 revision 2 (Ishan, option C).
//
// THE RETIRED PREMISE, recorded rather than deleted. G4's case asserted "no municipal
// candidacy owns a committee" as the precondition of the coming-soon rendering, so that
// coming-soon could not "silently become a claim about the wrong cause", and it said of
// itself: "if a municipal committee id ever lands, this case fails loudly instead of
// quietly still passing." ELEC-IDENTITY-1 R1 landed exactly that — 50 alderperson
// candidacies now carry a committee id derived from ward-map.json — and the case failed
// loudly, as designed. It is re-expressed here, not weakened and not deleted.
//
// WHAT REPLACES IT (S1 i–ii). `render.js` is NOT changed and no reader-facing display
// outcome is ratified: readiness still keys on committee presence, so city_council now
// renders its by-race listing rather than coming-soon, with every figure zero. That state
// is PINNED as the measured present of an emission no page serves. The display decision —
// coming-soon vs pending-cards vs otherwise — is deferred to the moment it is ripe, and
// the zero-money assertion below is the tripwire that forces it: the day windowed
// municipal money first exists, this file fails loudly and the decision goes to Ishan by
// the lane that lands the money, with real data in view. That is G4's own move, re-armed
// against the boundary that now matters.
var MUNI_OFFICES = ['alderperson', 'mayor', 'city_clerk', 'city_treasurer'];
var raceOfficeById = {};
json.races.forEach(function (r) { raceOfficeById[r.id] = r.office; });
var muniCands = json.candidates.filter(function (c) {
  return MUNI_OFFICES.indexOf(raceOfficeById[c.race_id]) >= 0; });

// S1 (ii) — presence where the derivation IS defined. R1 is alderperson-scoped.
var alderCands = muniCands.filter(function (c) { return raceOfficeById[c.race_id] === 'alderperson'; });
var alderWithId = alderCands.filter(function (c) { return c.committee_id != null; }).length;
ok('S1(ii): every alderperson candidacy carries a derived committee id (' +
   alderWithId + ' of ' + alderCands.length + ', expected 50 of 50)',
  alderCands.length === 50 && alderWithId === 50);

// S1 (ii) — absence where it is NOT defined. Vacuously true while those offices carry no
// candidacies at all; the assertion exists for the day one lands, so a mayoral row
// arriving with a committee id is revisited by the lane that lands it.
var nonAlderWithId = muniCands.filter(function (c) {
  return raceOfficeById[c.race_id] !== 'alderperson' && c.committee_id != null; });
ok('S1(ii): no municipal candidacy outside alderperson carries a committee id (' +
   nonAlderWithId.length + ' found) — the derivation\'s scope boundary; a mayoral or ' +
   'clerk/treasurer row arriving with one must be revisited by the lane that lands it',
  nonAlderWithId.length === 0);

// S1 (i) — THE TRIPWIRE. Windowed on DATES, never on the cycle-2027 label (which spans
// 2023-05-15 onward and would count 2023-2026 money as 2027's). The window literal mirrors
// data.js's municipal table, which [MUNI/WINDOW] pins against its own oracle — two
// statements, one oracle, per PS-82.
var MUNI_WIN = { start: '2023-05-15', end: '2027-12-31' };
var muniCmteIds = {};
muniCands.forEach(function (c) { if (c.committee_id != null) muniCmteIds[c.committee_id] = 1; });
var muniMoney = { rows: 0, total: 0 };
(json.contributions || []).forEach(function (c) {
  if (!muniCmteIds[c.committee_id]) return;
  if (!c.date || c.date < MUNI_WIN.start || c.date > MUNI_WIN.end) return;
  muniMoney.rows++; muniMoney.total += c.amount || 0;
});
ok('S1(i) TRIPWIRE: zero windowed municipal contribution money at this vintage (' +
   muniMoney.rows + ' rows, ' + muniMoney.total + ', by DATE ' + MUNI_WIN.start + '..' +
   MUNI_WIN.end + ') — WHEN THIS FAILS, municipal money exists and the reader-facing ' +
   'display decision (coming-soon vs pending-cards vs otherwise) is due to Ishan from the ' +
   'lane that lands it; do not edit this assertion to accommodate the money',
  muniMoney.rows === 0 && muniMoney.total === 0);

// S1 (i) — the pinned present, city_council: readiness TRUE, by-race listing rendered.
(function () {
  var oi = D.loadData(json, { office: 'city_council' });
  var om = D.viewModels.officeRaces(oi, 'city_council');
  var pg = R.renderPage({ office: 'city_council', topView: 'byrace', cycles: D.availableCycles(oi), cycle: null, officeRaces: om, activeSlug: null, raceView: null });
  var ready = om.groups.some(function (g) { return g.races.some(function (r) { return r.hasFinance; }); });
  ok('S1(i): city_council readiness is TRUE and the by-race listing renders, not coming-soon ' +
     '— pinned as the measured present; no display outcome is ratified by this assertion',
    ready === true && !/coming soon/i.test(pg) && pg.indexOf('<div class="wrap">') >= 0 && pg.length > 600);
  var worst = 0;
  om.groups.forEach(function (g) { g.races.forEach(function (r) {
    var rv = D.viewModels.raceView(oi, oi.raceBySlug[r.slug], null);
    (rv && rv.candidates || []).forEach(function (c) {
      var t = (c.figures && c.figures.total) || 0; if (t > worst) worst = t; });
  }); });
  ok('S1(i): every city_council candidate surface is live-shaped and ZERO-valued (largest ' +
     'candidate total ' + worst + ') — the state the tripwire above guards', worst === 0);
})();

// S1 (i) — mayor: readiness FALSE, coming-soon still rendered. The absence side of (ii),
// visible in the render layer.
(function () {
  var oi = D.loadData(json, { office: 'mayor' });
  var om = D.viewModels.officeRaces(oi, 'mayor');
  var pg = R.renderPage({ office: 'mayor', topView: 'byrace', cycles: D.availableCycles(oi), cycle: null, officeRaces: om, activeSlug: null, raceView: null });
  var ready = om.groups.some(function (g) { return g.races.some(function (r) { return r.hasFinance; }); });
  ok('S1(i): mayor readiness is FALSE and a clean coming-soon renders (no crash, full page)',
    ready === false && /coming soon/i.test(pg) && pg.indexOf('<div class="wrap">') >= 0 && pg.length > 600);
})();
// ---- MUNI-ENABLE-1 G6 ----
// D-24 (PS-114): the grouped view's comparator and the nav's must order the municipal race set
// identically. Compared as ORDERS, not as key values — the two return different things (a sort
// key vs a comparator) and only their resulting sequence is the ratified fact. The citywide trio
// is unreachable through the view models (no page maps more than one municipal office), so the
// comparators are exercised directly; see the _ordering export note in data.js.
(function () {
  var MUNI = ['alderperson', 'mayor', 'city_clerk', 'city_treasurer'];
  var races = json.races.filter(function (r) { return MUNI.indexOf(r.office) >= 0; });
  var byNav = races.slice().sort(D._ordering.byRaceOrder).map(function (r) { return r.id; });
  var byGrouped = races.slice().sort(function (a, b) {
    return D._ordering.raceOrderKey(a) - D._ordering.raceOrderKey(b); }).map(function (r) { return r.id; });
  ok('D-24: nav and grouped orderings agree across the whole municipal race set (' + races.length + ' races)',
    byNav.join(',') === byGrouped.join(','));
  ok('D-24: the citywide trio leads, in ballot-prominence order (mayor, clerk, treasurer)',
    byGrouped.slice(0, 3).join(',') === 'mayor,city-clerk,city-treasurer');
  ok('D-24: wards follow the trio, ascending by number',
    byGrouped.slice(3).join(',') === json.races.filter(function (r) { return r.office === 'alderperson'; })
      .map(function (r) { return r.ward | 0; }).sort(function (a, b) { return a - b; })
      .map(function (n) { return 'ward-' + String(n).padStart(2, '0'); }).join(','));
  ok('D-24: no municipal race falls into the 9999 tie-bucket any more',
    races.every(function (r) { return D._ordering.raceOrderKey(r) !== 9999; }));
  // school-board ordering is unchanged — the president still leads its own office's set
  var sb = json.races.filter(function (r) { return String(r.office).indexOf('school_board') === 0; });
  ok('D-24: school-board ordering is unchanged (president still leads)',
    sb.slice().sort(function (a, b) { return D._ordering.raceOrderKey(a) - D._ordering.raceOrderKey(b); })[0].id === 'sb-president');
})();

// D-25 (PS-115): NO municipal carve-out on the person surface. This is a no-code decision — its
// implementation is the ABSENCE of an exception at resolvePersonRef — so the fixture is the only
// thing that can hold it. A future edit re-adding a municipal exception would make a municipal
// ref resolve to null again, and this case is what would catch it.
(function () {
  var ro = {};
  json.races.forEach(function (r) { ro[r.id] = r.office; });
  var muni = json.candidates.filter(function (c) {
    return ['alderperson', 'mayor', 'city_clerk', 'city_treasurer'].indexOf(ro[c.race_id]) >= 0; })[0];
  var idx = D.loadData(json, { office: 'city_council' });
  var vm = D.personView(idx, muni.id);
  ok('D-25: a municipal candidacy RESOLVES on the person surface (no carve-out)', !!vm);
  ok('D-25: it renders one member section with honest zeros, not a fabricated total',
    !!vm && vm.sections.length === 1 && vm.careerTotal === 0 && vm.sections[0].contributions.total === 0);
  ok('D-25: its section carries the municipal office type, so the ratified noun applies',
    !!vm && vm.sections[0].officeType === 'municipal');
  ok('D-25: PS-90 holds — no IE value enters the municipal person view-model',
    !!vm && !('ieSupport' in vm.sections[0]) && !('ieOppose' in vm.sections[0]));
  // and the school-board person surface is untouched by the removal of the gate
  var isb = D.loadData(json, { office: 'school_board' });
  var pid = Object.keys(isb.rollups.by_person)[0];
  ok('D-25: the school-board person surface still resolves as before',
    !!D.personView(isb, pid) && D.personView(isb, pid).sections.length > 0);
})();

ok('real Recoleta @font-face present (onlinewebfonts CDN) + Georgia fallback',
  /@font-face\{font-family:"Recoleta";src:url\("https:\/\/db\.onlinewebfonts\.com/.test(R.styles()) && /--display:Recoleta,Georgia/.test(R.styles()));

console.log('\n' + (fails ? (fails + ' ASSERTION(S) FAILED') : 'ALL ASSERTIONS PASSED'));
process.exit(fails ? 1 : 0);
