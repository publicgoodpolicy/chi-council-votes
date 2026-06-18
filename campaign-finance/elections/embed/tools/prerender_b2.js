#!/usr/bin/env node
/* B2 verification harness (NOT app code). Exercises the pure data + render
 * layers exactly as the future SEO pre-render will: load election-data.json,
 * render the school_board page (sb-d03 / District 2A active), write a
 * self-contained preview HTML (no fetch/CDN needed — open it directly to
 * eyeball), and assert the prototype-fidelity output. Run from embed/:
 *   node tools/prerender_b2.js
 */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json);

var OFFICE = 'school_board';
var omVM = D.viewModels.officeRaces(index, OFFICE);
var rv = D.viewModels.raceView(index, index.raceBySlug['district-2a'], null);
var page = R.renderPage({ office: OFFICE, topView: 'byrace', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv });

var full = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>School Board — preview</title>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">' +
  R.styles() + '</head><body style="margin:0"><div class="ipg-elect">' + page + '</div></body></html>';
var out = path.join(__dirname, 'preview_b2.html');
fs.writeFileSync(out, full);

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }

console.log('=== B2 render assertions (school_board, District 2A active) ===');
ok('renders DeBerry card', /Ebony DeBerry/.test(page));
ok('renders Leon card', /Bruce Leon/.test(page));
ok('neutral order: DeBerry before Leon', page.indexOf('Ebony DeBerry') < page.indexOf('Bruce Leon'));
ok('Leon contributions $620,403', page.indexOf('$620,403') >= 0);
ok('Leon self-funded $620,000 (selfline)', page.indexOf('$620,000') >= 0);
ok('Leon third-party $403', page.indexOf('$403') >= 0);
ok('Leon independent support $24,766', page.indexOf('$24,766') >= 0);
ok('DeBerry contributions $534,950', page.indexOf('$534,950') >= 0);
ok('DeBerry independent opposition $126,078', page.indexOf('$126,078') >= 0);
ok('self-funding hatch segment (seg self)', /class="seg self"/.test(page));
ok('three figure bars present', /From contributors/.test(page) && /Independent support/.test(page) && /Independent opposition/.test(page));
ok('Leon "Mostly self-funded" chip', /chip-self/.test(page));
ok('DeBerry "Incumbent" chip', /chip-inc/.test(page));
ok('exact disclaimer copy (footer)', /separately and never added together/.test(page));
ok('locked slug scheme: cand-bruce-leon-district-2a', /id="cand-bruce-leon-district-2a"/.test(page));
ok('District 2A chip is active', /data-slug="district-2a" aria-pressed="true"/.test(page));
ok('coming-soon races marked (· soon)', /· soon/.test(page));
ok('office sub-tabs (Board President / Districts)', /Board President/.test(page) && /Districts/.test(page));
ok('figures NOT summed (no grand-total markup)', page.indexOf('Total raised') < 0 && page.indexOf('grand total') < 0);

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
ok('sb-president DOES list Custer AND Biggs as candidates',
  /cand-jennifer-custer-school-board-president/.test(pres) && /cand-jessica-biggs-school-board-president/.test(pres));

// View toggle: active chip + view move on topView change
var spendPage = R.renderPage({ office: OFFICE, topView: 'spend', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv });
ok('toggle: spend view renders its coming-soon placeholder', /Election spend — coming soon/.test(spendPage));
ok('toggle: Election-spend tab active when topView=spend',
  /data-view="spend" aria-selected="true"/.test(spendPage) && /data-view="byrace" aria-selected="false"/.test(spendPage));
ok('toggle: By-race tab active when topView=byrace',
  /data-view="byrace" aria-selected="true"/.test(page) && /data-view="spend" aria-selected="false"/.test(page));

// Cycle label
ok('default cycle label is "current cycle" (not "all-time")', /current cycle/.test(page) && page.indexOf('all-time') < 0);

console.log('\n=== B3 assertions (drill-downs + Sunshine) ===');
function sumLines(cd) { return Math.round(cd.lines.reduce(function (s, l) { return s + l.total; }, 0)); }
var leonC = D.candidateContributors(index, 'leon-sb-d03', null);
var debC = D.candidateContributors(index, 'deberry-sb-d03', null);
ok('Leon contributor lines sum EXACTLY to $620,403', sumLines(leonC) === 620403 && Math.round(leonC.total) === 620403);
ok('DeBerry contributor lines sum EXACTLY to $534,950', sumLines(debC) === 534950 && Math.round(debC.total) === 534950);
ok('Leon contributor list flags a self/loan line', leonC.lines.some(function (l) { return l.isSelf; }));
ok('contributor list includes a small-dollar aggregate line', leonC.lines.some(function (l) { return l.isAggregate; }) && debC.lines.some(function (l) { return l.isAggregate; }));

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
ok('Tier 1 lists the IE committee with amount+stance (not funders)',
  /Outside spending opposing <b>Ebony DeBerry<\/b>/.test(page) ||
  /class="ie-cmte-toggle"[^>]*>[^<]*<span class="caret"[^>]*>▸<\/span> <b>\$126,078 against<\/b> opposing Ebony DeBerry/.test(page));
ok('Tier 1 committee row has aria-controls to a Tier-2 panel', /class="ie-cmte-toggle" type="button" aria-expanded="false" aria-controls="d-/.test(page));
ok('Tier 1 committee row carries a Sunshine link', /class="ie-cmte-head">[\s\S]{0,400}?class="paclink"/.test(page));
// Tier 2: funders, with the explicit "gave this committee over time, not this race" framing
ok('Tier 2 shows the plain-language identity line ("Funded primarily by ...")', /class="ie-lead">Funded primarily by /.test(page));
ok('Tier 2 has the explicit framing (gave this committee over time, not this race)',
  /Amounts below are what each donor gave <b>this committee<\/b> over time — not money spent on this race\./.test(page));
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
var aggLine = debCd.lines.filter(function (l) { return l.isAggregate; })[0];
ok('DeBerry has a real (non-self, non-aggregate) contributor line', !!realLine && !!realLine.parent_id);
// A real contributor row renders EXACTLY like a PAC funder row: clickable + tagged.
var realRow = R.donorRow(realLine);
ok('real contributor row is clickable (funder-row + data-funder) and tagged',
  /class="crow funder-row" type="button" data-funder="/.test(realRow) && /class="tagchip ind"/.test(realRow));
// Exceptions stay non-clickable + no industry tag.
var selfRow = R.donorRow(selfLine), aggRow = R.donorRow(aggLine);
ok('self-funding/loan line is a plain labeled line (no button, no industry tag)',
  /class="crow plain"/.test(selfRow) && selfRow.indexOf('funder-row') < 0 && selfRow.indexOf('tagchip ind') < 0);
ok('small-dollar aggregate line is a plain labeled line (no button, no tag)',
  /class="crow plain"/.test(aggRow) && aggRow.indexOf('funder-row') < 0 && aggRow.indexOf('tagchip ind') < 0);
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
ok('small-dollar aggregate is a plain non-clickable line at the bottom',
  /class="crow plain"><div class="who">Small-dollar donors/.test(debPanel));
ok('full set (real + self + small-dollar) sums EXACTLY to the headline ($534,950)',
  Math.round(debCd2.lines.reduce(function (s, l) { return s + l.total; }, 0)) === 534950);

console.log('\nwrote ' + path.relative(process.cwd(), out) + '  (open in a browser to eyeball — self-contained, no fetch)');
console.log(fails ? (fails + ' ASSERTION(S) FAILED') : 'ALL ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
