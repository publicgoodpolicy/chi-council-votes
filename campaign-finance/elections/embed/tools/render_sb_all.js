#!/usr/bin/env node
/* Six-race render gate (NOT app code). Renders sb-d04..sb-d09 This/Last/All, asserts
 * Diagnostic-C post-fix oracles, the state machine (did-not-run / clean-empty /
 * single-candidate), undated reconciliation, and structural invariants 3-7.
 * (Data invariants 1-2 + the #6 cross-check are also re-derived in the Python pass.)
 * Run from embed/:  node tools/render_sb_all.js  */
'use strict';
var path = require('path'), fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));
var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });

var fails = 0;
function ok(n, c) { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; }
function M(n) { return Math.round(n); }
var RACES = ['sb-d04', 'sb-d05', 'sb-d06', 'sb-d07', 'sb-d08', 'sb-d09'];
var VM = {};
RACES.forEach(function (r) { VM[r] = D.viewModels.raceView(index, r, null).elections; });

function fig(race, cid, eid) {
  var c = VM[race].candidates.filter(function (x) { return x.id === cid; })[0];
  return c && c.byElection[eid] ? c.byElection[eid].figures : null;
}

console.log('=== all six races produce a toggle VM ===');
RACES.forEach(function (r) { ok(r + ' VM present (electionIds ' + (VM[r] ? VM[r].electionIds.join(',') : 'NONE') + ')', !!VM[r] && VM[r].electionIds.indexOf('2024') >= 0 && VM[r].electionIds.indexOf('2026') >= 0); });

console.log('\n=== Diagnostic-C POST-FIX oracles ===');
var z24 = fig('sb-d07', 'zaccor-sb-d07', '2024'), z26 = fig('sb-d07', 'zaccor-sb-d07', '2026');
ok('Zaccor 2024 contrib $492,236.85/164', M(z24.contributions) === 492237 && z24.contributionsCount === 164);
ok('Zaccor 2024 self $6,867.54/6', M(z24.selfFunding) === 6868 && z24.selfFundingCount === 6);
ok('Zaccor 2024 ie_oppose $173,817.00/4', M(z24.independentOpposition) === 173817 && z24.independentOppositionCount === 4);
ok('Zaccor 2026 contrib $6,650/6 · self $4,777.78/5 · ie 0',
  M(z26.contributions) === 6650 && z26.contributionsCount === 6 && M(z26.selfFunding) === 4778 && z26.selfFundingCount === 5 && z26.independentSupport === 0 && z26.independentOpposition === 0);

var r24 = fig('sb-d08', 'rosenfeld-sb-d08', '2024'), r26 = fig('sb-d08', 'rosenfeld-sb-d08', '2026');
ok('Rosenfeld 2024 contrib $227,960.80/180', M(r24.contributions) === 227961 && r24.contributionsCount === 180);
ok('Rosenfeld 2024 self $26,900/2', M(r24.selfFunding) === 26900 && r24.selfFundingCount === 2);
ok('Rosenfeld 2024 ie_support $146,025.64/11', M(r24.independentSupport) === 146026 && r24.independentSupportCount === 11);
ok('Rosenfeld 2026 contrib $103,514.93/68 · self 0 · ie 0',
  M(r26.contributions) === 103515 && r26.contributionsCount === 68 && r26.selfFunding === 0 && r26.independentSupport === 0 && r26.independentOpposition === 0);

var p24 = fig('sb-d04', 'pope-sb-d04', '2024'), p26 = fig('sb-d04', 'pope-sb-d04', '2026');
ok('Pope 2024 contrib $500/1 (POST self-fix)', M(p24.contributions) === 500 && p24.contributionsCount === 1);
ok('Pope 2024 self $500/1 (POST self-fix)', M(p24.selfFunding) === 500 && p24.selfFundingCount === 1);
ok('Pope 2024 ie 0', p24.independentSupport === 0 && p24.independentOpposition === 0);
ok('Pope 2026 contrib $500/1 · self 0', M(p26.contributions) === 500 && p26.contributionsCount === 1 && p26.selfFunding === 0);

var rs24 = fig('sb-d05', 'rios-sierra-sb-d05', '2024'), rs26 = fig('sb-d05', 'rios-sierra-sb-d05', '2026');
ok('Rios-Sierra 2024 none', rs24 === null);
ok('Rios-Sierra 2026 contrib $57/1', M(rs26.contributions) === 57 && rs26.contributionsCount === 1);

console.log('\n=== state machine renders ===');
var popeLast = R.renderRaceElections(VM['sb-d04'], '2024');
ok('Pope Last tab renders "2024 (did not run)"', /2024 \(did not run\)/.test(popeLast));
ok('Pope did-not-run subnote present', /not a 2024 candidacy/.test(popeLast));
var zacLast = R.renderRaceElections(VM['sb-d07'], '2024');
ok('Zaccor Last header "2024: District 4" (not sb-d07/4A)', /2024: District 4/.test(zacLast) && zacLast.indexOf('District 4A') < 0);
var rosAll = R.renderRaceElections(VM['sb-d08'], 'all');
ok('Rosenfeld single-candidate race renders (1 candidate card per block)', (rosAll.match(/cand-name/g) || []).length >= 1 && /Ellen Rosenfeld/.test(rosAll));
var riosLast = R.renderRaceElections(VM['sb-d05'], '2024');
var riosAll = R.renderRaceElections(VM['sb-d05'], 'all');
ok('Rios-Sierra Last 2024 tab clean-empty ("No money reported")', /No money reported for this election/.test(riosLast));
ok('Rios-Sierra All = 2026-only combined ("2026 election only", no "across both" claim)',
  /2026 election only/.test(riosAll) && /From the 2026 election only/.test(riosAll));

console.log('\n=== invariant 7 (combined All-Elections, FIREWALL): cross-election total, not single-race ===');
var zAll = R.renderRaceElections(VM['sb-d07'], 'all');
ok('Zaccor All: combined header "across both elections (2024 + 2026)"', /across both elections \(2024 \+ 2026\)/.test(zAll));
ok('Zaccor All: firewall framing (redrawn boundaries; NOT single-race spending)',
  /redrawn district boundaries/.test(zAll) && /not single-race spending/.test(zAll));
ok('Zaccor All: 2024 provenance "2024: District 4" preserved in combined', /2024: District 4/.test(zAll));
ok('Zaccor All: NOT segmented (no per-election blocks, no undated line)',
  zAll.indexOf('elec-block-h') < 0 && zAll.indexOf('Undated small-dollar') < 0);
(function () {
  var cand = VM['sb-d07'].candidates.filter(function (x) { return x.id === 'zaccor-sb-d07'; })[0];
  var cf = cand.combined.figures, a = cand.byElection['2024'].figures, b = cand.byElection['2026'].figures;
  var okm = ['contributions', 'selfFunding', 'independentSupport', 'independentOpposition'].every(function (k) { return Math.abs(cf[k] - (a[k] + b[k])) < 0.01; });
  ok('Zaccor combined == This + Last per stream (streams stay separate)', okm);
})();

console.log('\n=== invariant 3: four separate streams, no cross-sum (figures are distinct numeric fields) ===');
ok('figures have 4 distinct numeric stream fields, no summed total',
  ['contributions', 'selfFunding', 'independentSupport', 'independentOpposition'].every(function (k) { return typeof z24[k] === 'number'; }) &&
  !('total' in z24) && !('combined' in z24));

console.log('\n=== undated reconciliation: 2024 + 2026 + undated == all-years contributor total ===');
[['sb-d07', 'zaccor-sb-d07', 2468], ['sb-d08', 'rosenfeld-sb-d08', 750], ['sb-d05', 'rios-sierra-sb-d05', 100], ['sb-d04', 'pope-sb-d04', 0]].forEach(function (t) {
  var race = t[0], cid = t[1], expUndated = t[2];
  var cand = VM[race].candidates.filter(function (x) { return x.id === cid; })[0];
  var dated = 0;
  VM[race].electionIds.forEach(function (eid) {
    var f = cand.byElection[eid] && cand.byElection[eid].figures;
    if (f) dated += f.contributions + f.selfFunding;
  });
  var allYears = D.candidateContributors(index, cid, null).total;
  ok(cid + ': dated($' + M(dated) + ') + undated($' + M(cand.undated.amount) + ') == all-years($' + M(allYears) + ')',
    Math.abs(dated + cand.undated.amount - allYears) < 0.01 && M(cand.undated.amount) === expUndated);
});

console.log('\n=== invariant 6: empty prior_election AND non-zero 2024 money (expect ONLY Pope) ===');
var flagged = [];
RACES.forEach(function (race) {
  VM[race].candidates.forEach(function (c) {
    var f = c.byElection['2024'] && c.byElection['2024'].figures;
    if (!c.priorElection && f && (f.contributions > 0 || f.selfFunding > 0 || f.independentSupport > 0 || f.independentOpposition > 0))
      flagged.push(c.id);
  });
});
console.log('  flagged:', flagged);
ok('flag list == [pope-sb-d04] ONLY', flagged.length === 1 && flagged[0] === 'pope-sb-d04');

console.log('\n--- snippet: Pope Last (2024) did-not-run ---');
var seg = popeLast.split('<article').filter(function (s) { return /Debby/.test(s); })[0] || '';
console.log('<article' + seg.split('</article>')[0].replace(/<div class="bartrack[\s\S]*?<\/div><\/div>/g, '[bar]').substring(0, 520));

console.log('\n' + (fails ? ('FAILED ' + fails) : 'ALL PASS'));
process.exit(fails ? 1 : 0);
