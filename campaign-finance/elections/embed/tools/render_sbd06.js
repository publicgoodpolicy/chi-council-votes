#!/usr/bin/env node
/* sb-d06 render gate (NOT app code). Loads the real election-data.json, builds the
 * raceElections view model, renders the This / Last / All views, asserts the
 * Diagnostic-B oracle, and prints the rendered name/figure snippets.
 * Run from embed/:  node tools/render_sbd06.js  */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });
var rv = D.viewModels.raceView(index, 'sb-d06', null);
var vm = rv.elections;

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }
function money(n) { return Math.round(n); }

function fig(candId, eid) {
  var c = vm.candidates.filter(function (x) { return x.id === candId; })[0];
  return c.byElection[eid].figures;
}

console.log('=== sb-d06 raceElections VM present ===');
ok('vm exists with 2 elections [2026,2024]', !!vm && vm.electionIds.join(',') === '2026,2024');
ok('toggle labels This(2026)/Last(2024)',
  vm.toggles[0].label === 'This election (2026)' && vm.toggles[1].label === 'Last election (2024)');

console.log('\n=== Last election (2024) — Diagnostic-B oracle ===');
var rivas24 = fig('rivas-sb-d06', '2024'), dones24 = fig('dones-sb-d06', '2024');
ok('IE-oppose Dones 2024 = $35,153', money(dones24.independentOpposition) === 35153);
ok('IE-support Rivas 2024 = $340,740.08 (29 rows, post HALT-3b robust match)',
  money(rivas24.independentSupport) === 340740 && rivas24.independentSupportCount === 29);
ok('IE-oppose Rivas 2024 = $0 (Rivas has support only; 26066 now supports Rivas post HALT-3b)',
  rivas24.independentOpposition === 0);
ok('Dones 2024 IE-support = $0', dones24.independentSupport === 0);

console.log('\n=== This election (2026) ===');
var rivas26 = fig('rivas-sb-d06', '2026'), dones26 = fig('dones-sb-d06', '2026');
ok('IE-oppose Dones 2026 = $0', dones26.independentOpposition === 0);
ok('IE-support Rivas 2026 = $0', rivas26.independentSupport === 0);

console.log('\n=== contribution / self-funding splits (reported) ===');
console.log('  Rivas 2024: contrib $' + money(rivas24.contributions) + ' (' + rivas24.contributionsCount + ') · self $' +
  money(rivas24.selfFunding) + ' (' + rivas24.selfFundingCount + ')');
console.log('  Rivas 2026: contrib $' + money(rivas26.contributions) + ' (' + rivas26.contributionsCount + ') · self $' +
  money(rivas26.selfFunding) + ' (' + rivas26.selfFundingCount + ')');
console.log('  Dones 2024: contrib $' + money(dones24.contributions) + ' (' + dones24.contributionsCount + ') · self $' +
  money(dones24.selfFunding) + ' (' + dones24.selfFundingCount + ')');
console.log('  Dones 2026: contrib $' + money(dones26.contributions) + ' (' + dones26.contributionsCount + ') · self $' +
  money(dones26.selfFunding) + ' (' + dones26.selfFundingCount + ')');

console.log('\n=== labels + streams-not-summed ===');
ok('2024 block label is "2024: District 3" (never sb-d06)',
  vm.candidates[0].byElection['2024'].label === '2024: District 3');
ok('2026 label is "2026"', vm.candidates[0].byElection['2026'].label === '2026');
ok('figures expose 4 SEPARATE stream fields (no summed total)',
  ['contributions', 'selfFunding', 'independentSupport', 'independentOpposition'].every(function (k) { return typeof rivas24[k] === 'number'; }) &&
  !('total' in rivas24) && !('combined' in rivas24));

console.log('\n=== render: This / Last / All ===');
var thisHtml = R.renderRaceElections(vm, '2026');
var lastHtml = R.renderRaceElections(vm, '2024');
var allHtml = R.renderRaceElections(vm, 'all');
ok('This view selects 2026 tab', /data-electionview="2026" aria-selected="true"/.test(thisHtml));
ok('Last view selects 2024 tab', /data-electionview="2024" aria-selected="true"/.test(lastHtml));
ok('All view selects all tab', /data-electionview="all" aria-selected="true"/.test(allHtml));
ok('Last view shows $35,153 (oppose Dones)', allHtml.indexOf('$35,153') >= 0 && lastHtml.indexOf('$35,153') >= 0);
ok('Last view shows $340,740 (support Rivas)', lastHtml.indexOf('$340,740') >= 0);
ok('Last view labels "2024: District 3"', lastHtml.indexOf('2024: District 3') >= 0);
ok('All view = combined cross-election ("across both elections (2024 + 2026)")', /across both elections \(2024 \+ 2026\)/.test(allHtml));
ok('All view FIREWALL: redrawn boundaries, NOT single-race, "2024: District 3" provenance',
  /redrawn district boundaries/.test(allHtml) && /not single-race spending/.test(allHtml) && /2024: District 3/.test(allHtml));
ok('All view NOT segmented (no per-election block headers)', allHtml.indexOf('elec-block-h') < 0);
ok('All view combined: Rivas IE-support $340,740 (2024 + 2026)', allHtml.indexOf('$340,740') >= 0);
ok('four separate stream bars present', /From contributors/.test(lastHtml) && /Candidate self-funding/.test(lastHtml) &&
  /Independent support/.test(lastHtml) && /Independent opposition/.test(lastHtml));

console.log('\n--- snippet: Last election (2024), Dones card ---');
var seg = lastHtml.substring(lastHtml.indexOf('elec-jason') >= 0 ? lastHtml.indexOf('id="elec-jason') : 0);
var dblock = lastHtml.split('<article').filter(function (s) { return /Jason D/.test(s); })[0] || '';
console.log('<article' + dblock.split('</article>')[0].replace(/<div class="bartrack[\s\S]*?<\/div><\/div>/g, '[bar]').substring(0, 700));

console.log('\n' + (fails ? ('FAILED ' + fails) : 'ALL PASS'));
process.exit(fails ? 1 : 0);
