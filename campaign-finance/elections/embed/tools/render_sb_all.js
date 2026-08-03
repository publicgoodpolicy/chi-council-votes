#!/usr/bin/env node
/* Six-race gate (NOT app code) — REPURPOSED at SCOPE-UI (A2: oracles preserved, surface
 * moved). The toggle VM is retired; the Diagnostic-C dollar oracles now pin the
 * by_candidate_election BUCKETS directly. The four 2026-leg pins marked TOOLS-ORACLE-1
 * were STALE at HEAD before this lane (pre-attributed vintage drift, HALT-F2 G2 report);
 * per the diagnose-before-refresh ruling their VALUES are carried VERBATIM and continue
 * to fail until that lane explains them. Do NOT refresh them here.
 * Run from embed/:  node tools/render_sb_all.js  */
'use strict';
var path = require('path'), fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));
var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });
var bce = (json.rollups || {}).by_candidate_election || {};

var fails = 0;
function ok(n, c) { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; }
function M(n) { return Math.round(n); }
function bk(cid, eid) { return (bce[cid] || {})[eid] || null; }
var W24 = { start: null, end: '2024-12-31' }, W26 = { start: '2025-01-01', end: '2026-12-31' };

console.log('=== Diagnostic-C POST-FIX oracles (by_candidate_election buckets) ===');
var z24 = bk('zaccor-sb-d07', '2024'), z26 = bk('zaccor-sb-d07', '2026');
ok('Zaccor 2024 contrib $494,641.85/202', !!z24 && M(z24.contributions.amount) === 494642 && z24.contributions.count === 202);
ok('Zaccor 2024 self $6,930.54/8', !!z24 && M(z24.self_funding.amount) === 6931 && z24.self_funding.count === 8);
ok('Zaccor 2024 ie_oppose $173,817.00/4', !!z24 && M(z24.ie_oppose.amount) === 173817 && z24.ie_oppose.count === 4);
// TOOLS-ORACLE-1 (stale at HEAD pre-lane; carried verbatim, expected to FAIL until diagnosed):
ok('Zaccor 2026 contrib $6,650/6 · self $4,777.78/5 · ie 0',
  !!z26 && M(z26.contributions.amount) === 6650 && z26.contributions.count === 6 && M(z26.self_funding.amount) === 4778 && z26.self_funding.count === 5 && z26.ie_support.amount === 0 && z26.ie_oppose.amount === 0);

var r24 = bk('rosenfeld-sb-d08', '2024'), r26 = bk('rosenfeld-sb-d08', '2026');
ok('Rosenfeld 2024 contrib $228,710.80/188', !!r24 && M(r24.contributions.amount) === 228711 && r24.contributions.count === 188);
ok('Rosenfeld 2024 self $26,900/2', !!r24 && M(r24.self_funding.amount) === 26900 && r24.self_funding.count === 2);
ok('Rosenfeld 2024 ie_support $146,025.64/11', !!r24 && M(r24.ie_support.amount) === 146026 && r24.ie_support.count === 11);
// TOOLS-ORACLE-1 (stale, carried verbatim):
ok('Rosenfeld 2026 contrib $103,514.93/68 · self 0 · ie 0',
  !!r26 && M(r26.contributions.amount) === 103515 && r26.contributions.count === 68 && r26.self_funding.amount === 0 && r26.ie_support.amount === 0 && r26.ie_oppose.amount === 0);

var p24 = bk('pope-sb-d04', '2024'), p26 = bk('pope-sb-d04', '2026');
ok('Pope 2024 contrib $500/1 (POST self-fix)', !!p24 && M(p24.contributions.amount) === 500 && p24.contributions.count === 1);
ok('Pope 2024 self $500/1 (POST self-fix)', !!p24 && M(p24.self_funding.amount) === 500 && p24.self_funding.count === 1);
ok('Pope 2024 ie 0', !!p24 && p24.ie_support.amount === 0 && p24.ie_oppose.amount === 0);
// TOOLS-ORACLE-1 (stale, carried verbatim):
ok('Pope 2026 contrib $500/1 · self 0', !!p26 && M(p26.contributions.amount) === 500 && p26.contributions.count === 1 && p26.self_funding.amount === 0);

var rs24 = bk('rios-sierra-sb-d05', '2024'), rs26 = bk('rios-sierra-sb-d05', '2026');
ok('Rios-Sierra 2024 none', rs24 === null);
// TOOLS-ORACLE-1 (stale, carried verbatim):
ok('Rios-Sierra 2026 contrib $157/2', !!rs26 && M(rs26.contributions.amount) === 157 && rs26.contributions.count === 2);

console.log('\n=== scoped renders (post-toggle state machine) ===');
var zvm = D.viewModels.raceView(index, 'sb-d07', null), zhtml = R.renderRaceView(zvm);
ok('Zaccor 2026 card carries the re-homed prior-note "2024: District 4" (verbatim, no dollars)',
  /<p class="committee prior-note">2024: District 4/.test(zhtml) && !/prior-note">[^<]*\$/.test(zhtml));
ok('sb-d07 scoped page: no toggle affordance, window stamped',
  zhtml.indexOf('data-electionview') < 0 && /data-win-end="2026-12-31"/.test(zhtml));
var rsvm = D.viewModels.raceView(index, 'sb-d05', null), rshtml = R.renderRaceView(rsvm);
ok('Rios Sierra renders on the scoped page (2026-only money, clean)', /Norma Rios Sierra/.test(rshtml));
var pvm = D.viewModels.raceView(index, 'sb-d04', null), phtml = R.renderRaceView(pvm);
ok('Pope (no person-link) carries NO prior-note (invariant-6 discriminator intact)',
  !/Debby[\s\S]{0,600}prior-note/.test(phtml));

console.log('\n=== dated-legs reconciliation: 2024w + 2026w == all-years (zero undated at vintage) ===');
[['zaccor-sb-d07'], ['rosenfeld-sb-d08'], ['rios-sierra-sb-d05'], ['pope-sb-d04']].forEach(function (t) {
  var cid = t[0];
  var f24 = D.candidateFigures(index, cid, null, W24), f26 = D.candidateFigures(index, cid, null, W26);
  var dated = f24.contributions.total + f26.contributions.total;
  var allYears = D.candidateContributors(index, cid, null).total;
  ok(cid + ': dated($' + M(dated) + ') == all-years($' + M(allYears) + ')', Math.abs(dated - allYears) < 0.01);
});

console.log('\n=== invariant 6: NO person-link prior AND non-zero 2024 bucket (expect ONLY Pope) ===');
var flagged = [];
['sb-d04', 'sb-d05', 'sb-d06', 'sb-d07', 'sb-d08', 'sb-d09'].forEach(function (race) {
  var vm = D.viewModels.raceView(index, race, null);
  vm.candidates.forEach(function (c) {
    var b = bk(c.id, '2024');
    if (!c.priorElection && b && (b.contributions.amount > 0 || b.self_funding.amount > 0 || b.ie_support.amount > 0 || b.ie_oppose.amount > 0))
      flagged.push(c.id);
  });
});
console.log('  flagged:', flagged);
ok('flag list == [pope-sb-d04] ONLY', flagged.length === 1 && flagged[0] === 'pope-sb-d04');

console.log('\n' + (fails ? ('FAILED ' + fails) : 'ALL PASS'));
process.exit(fails ? 1 : 0);
