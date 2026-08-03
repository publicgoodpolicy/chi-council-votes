#!/usr/bin/env node
/* sb-d06 gate (NOT app code) — REPURPOSED at SCOPE-UI (A2: oracles preserved, surface
 * moved). The per-race This/Last/All toggle is retired; the Diagnostic-B dollar oracles
 * now pin the by_candidate_election BUCKETS (the data these views read) plus the scoped
 * base-path render. The F-2 ruled consequence is pinned explicitly: 2024-window IE on
 * 2026-candidacy ids does NOT render on the 2026-scoped race page (it lives on the
 * 2024-scope spend/committee surfaces until P1-E re-routes targets).
 * Run from embed/:  node tools/render_sbd06.js  */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });
var bce = (json.rollups || {}).by_candidate_election || {};

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }
function money(n) { return Math.round(n); }
function bk(cid, eid) { return (bce[cid] || {})[eid] || null; }

console.log('=== Diagnostic-B oracle — by_candidate_election buckets (2024) ===');
var rivas24 = bk('rivas-sb-d06', '2024'), dones24 = bk('dones-sb-d06', '2024');
ok('IE-oppose Dones 2024 = $35,153', !!dones24 && money(dones24.ie_oppose.amount) === 35153);
ok('IE-support Rivas 2024 = $340,740.08 (29 rows, post HALT-3b robust match)',
  !!rivas24 && money(rivas24.ie_support.amount) === 340740 && rivas24.ie_support.count === 29);
ok('IE-oppose Rivas 2024 = $0', !!rivas24 && rivas24.ie_oppose.amount === 0);
ok('Dones 2024 IE-support = $0', !!dones24 && dones24.ie_support.amount === 0);
ok('2024 bucket label is "2024: District 3" (never sb-d06)', !!rivas24 && rivas24.label === '2024: District 3');

console.log('\n=== 2026 window (the scoped race page) ===');
var W26 = { start: '2025-01-01', end: '2026-12-31' };
var rf26 = D.candidateFigures(index, 'rivas-sb-d06', null, W26);
var df26 = D.candidateFigures(index, 'dones-sb-d06', null, W26);
ok('IE-support Rivas 2026 window = $0', rf26.independentSupport === 0);
ok('IE-oppose Dones 2026 window = $0', df26.independentOpposition === 0);
ok('figures expose SEPARATE stream fields, no summed total',
  typeof rf26.independentSupport === 'number' && typeof rf26.independentOpposition === 'number' &&
  !('total' in rf26) && !('combined' in rf26));

console.log('\n=== scoped base-path render (post-toggle) ===');
var vm = D.viewModels.raceView(index, 'sb-d06', null);
var html = R.renderRaceView(vm);
ok('sb-d06 renders the scoped base view (no toggle affordance)', html.indexOf('data-electionview') < 0 && /race-scope/.test(html));
ok('container stamps the 2026 window', /data-win-start="2025-01-01" data-win-end="2026-12-31"/.test(html));
ok('meta names the election ("2026 election")', html.indexOf('2026 election') >= 0);
ok('F-2 PINNED: the 2024-window $340,740 does NOT render on the 2026-scoped page', html.indexOf('$340,740') < 0);
ok('F-2 PINNED: the 2024-window $35,153 does NOT render on the 2026-scoped page', html.indexOf('$35,153') < 0);
// Where the money went (data-layer): the 2024 window still carries it in full.
var W24 = { start: null, end: '2024-12-31' };
ok('2024 window carries Rivas support in full ($340,740)', money(D.candidateFigures(index, 'rivas-sb-d06', null, W24).independentSupport) === 340740);
ok('2024 window carries Dones opposition in full ($35,153)', money(D.candidateFigures(index, 'dones-sb-d06', null, W24).independentOpposition) === 35153);

console.log('\n' + (fails ? ('FAILED ' + fails) : 'ALL PASS'));
process.exit(fails ? 1 : 0);
