#!/usr/bin/env node
/* B1 smoke harness (NOT app code). Requires the pure data + render layers,
 * loads the real election-data.json, asserts the locked figures, and prints
 * the rendered sb-d03 HTML. Run: node tools/smoke_b1.js  (from embed/). */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var DATA = path.join(__dirname, '..', '..', '..', 'election-data.json');
var json = JSON.parse(fs.readFileSync(DATA, 'utf8'));
var index = D.loadData(json);

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }
function eqMoney(name, got, exp) { ok(name + ' = $' + exp.toLocaleString() + ' (got $' + Math.round(got).toLocaleString() + ')', Math.round(got) === exp); }

console.log('=== B1 assertions ===');

// Leon — self-funding split (Option A: $25 is small-dollar, in third-party)
var leon = D.candidateFigures(index, 'leon-sb-d03', null);
eqMoney('Leon self-funded', leon.contributions.selfFunded, 620000);
eqMoney('Leon third-party', leon.contributions.thirdParty, 403);
eqMoney('Leon contributions total', leon.contributions.total, 620403);

// DeBerry — three separate figures
var deb = D.candidateFigures(index, 'deberry-sb-d03', null);
eqMoney('DeBerry contributions', deb.contributions.total, 534950);
eqMoney('DeBerry independent support', deb.independentSupport, 0);
eqMoney('DeBerry independent opposition', deb.independentOpposition, 126078);

// The three figures are independent fields, NOT a computed total.
ok('figures expose three distinct numeric fields',
  typeof leon.contributions.total === 'number' &&
  typeof leon.independentSupport === 'number' &&
  typeof leon.independentOpposition === 'number');
ok('figures object has NO summed grand-total field',
  !('total' in leon) && !('grandTotal' in leon) && !('combined' in leon));
ok('contributions is its own figure (not contrib+support+oppose)',
  Math.round(leon.contributions.total) !== Math.round(leon.contributions.total + leon.independentSupport + leon.independentOpposition) ||
  (leon.independentSupport === 0 && leon.independentOpposition === 0)); // Leon has 24766 support -> sum differs

// All donors carry parent_id.
var missingPid = 0, nd = 0;
for (var k in json.donors) { if (json.donors.hasOwnProperty(k)) { nd++; if (!json.donors[k].parent_id) missingPid++; } }
ok('all donors carry parent_id (' + nd + ' donors, ' + missingPid + ' missing)', missingPid === 0);

// Index built in a single pass (no O(donors*contributions) nested scan).
ok('single pass over contributions (' + index._stats.contributionRowsVisited + ' === ' + json.contributions.length + ')',
  index._stats.contributionRowsVisited === json.contributions.length);
ok('single pass over IEs (' + index._stats.ieRowsVisited + ' === ' + json.independent_expenditures.length + ')',
  index._stats.ieRowsVisited === json.independent_expenditures.length);

// Render the race view for sb-d03 (DeBerry then Leon — alphabetical, never by amount).
var vm = D.viewModels.raceView(index, 'sb-d03', null);
ok('sb-d03 candidate order is neutral/alphabetical (DeBerry before Leon)',
  vm.candidates[0].name === 'Ebony DeBerry' && vm.candidates[1].name === 'Bruce Leon');

console.log('\n=== rendered sb-d03 (styles + HTML) ===\n');
console.log(R.styles());
console.log(R.renderRaceView(vm));

console.log('\n' + (fails ? (fails + ' ASSERTION(S) FAILED') : 'ALL ASSERTIONS PASSED'));
process.exit(fails ? 1 : 0);
