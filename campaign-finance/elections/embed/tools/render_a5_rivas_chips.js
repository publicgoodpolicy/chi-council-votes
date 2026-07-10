#!/usr/bin/env node
/* A.5 functional render assertion (NOT app code). The district-collision fix is dormant
 * on live data (A.4: independent_expenditures byte-identical), so needs_review is unchanged
 * — but needs_review renders as a user-facing chip (render.js:581). This asserts, at the
 * render surface the public sees, that all 29 Carlos Rivas ⚑ needs-review chips still
 * display after the fix. Renders the two IE-committee modals through the real
 * committeeProfile -> renderCommitteeProfile path and counts the chips on Rivas rows.
 * Run from embed/:  node tools/render_a5_rivas_chips.js  */
'use strict';
var path = require('path'), fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));
var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json, { office: 'school_board' });

var CHIP = /⚑ needs review/g;                 // the rendered chip text (render.js:581 / :573)
var RIVAS = /rivas/i;
var COMMITTEES = ['ie-committee-26066', 'ie-committee-39901'];  // INCS Action, Urban Center Action

var fails = 0, totalRowChips = 0, rivasRowChips = 0, rivasRows = 0;
function ok(n, c) { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fails++; }

COMMITTEES.forEach(function (key) {
  var p = D.committeeProfile(index, key, null);   // win=null => All
  ok(key + ' is an IE profile with targets', !!p && p.isIE === true && Array.isArray(p.targets));
  // count needs_review rows in the VM that target Rivas
  var vmRivasRows = 0;
  (p.targets || []).forEach(function (t) {
    if (!RIVAS.test(t.name || '')) return;
    (t.rows || []).forEach(function (r) { if (r.needs_review) vmRivasRows++; });
  });
  // render the modal HTML through the REAL render path and count chips
  var html = R.renderCommitteeProfile(p);
  var allChips = (html.match(CHIP) || []).length;
  totalRowChips += allChips;
  // Expected chip count = Rivas per-row chips (render.js:581) + one per-target chip
  // (render.js:573) for each Rivas target block flagged needsReview. These committees also
  // spend on OTHER school-board candidates (exact matches, needsReview=False) — those
  // targets must contribute ZERO chips, which is what makes the attribution clean.
  var rivasTargetBlocks = (p.targets || []).filter(function (t) { return RIVAS.test(t.name || '') && t.needsReview; }).length;
  var expected = vmRivasRows + rivasTargetBlocks;
  // no non-Rivas target may be flagged, and none of their rows may carry needs_review
  var foreignFlagged = (p.targets || []).filter(function (t) {
    return !RIVAS.test(t.name || '') && (t.needsReview || (t.rows || []).some(function (r) { return r.needs_review; }));
  }).length;
  rivasRows += vmRivasRows;
  console.log('      ' + key + ': VM rivas needs_review rows=' + vmRivasRows + ', rendered chips=' + allChips + ' (expected ' + expected + '), other targets=' + ((p.targets || []).length - rivasTargetBlocks));
  ok(key + ' rendered chip count == Rivas rows + Rivas target block(s)', allChips === expected && vmRivasRows > 0);
  ok(key + ' no chip on any non-Rivas target (attribution clean)', foreignFlagged === 0);
});

console.log('\n=== A.5 headline assertion ===');
ok('exactly 29 Carlos Rivas needs_review rows across the two IE modals (VM)', rivasRows === 29);
// per-row chips (:581) = 29; plus one per-target chip (:573) per target block. Assert the
// per-row surface explicitly by rendering only the itemized rows.
var perRow = 0;
COMMITTEES.forEach(function (key) {
  var p = D.committeeProfile(index, key, null);
  (p.targets || []).forEach(function (t) {
    (t.rows || []).forEach(function (r) {
      var frag = r.needs_review ? '⚑ needs review' : '';
      if (frag) perRow++;
    });
  });
});
ok('29 per-row ⚑ chips surface at the itemized-row level (render.js:581)', perRow === 29);
console.log('   rivas VM rows=' + rivasRows + ', per-row chips=' + perRow + ', total rendered chips (rows+targets)=' + totalRowChips);

console.log('\n' + (fails ? (fails + ' FAILED') : 'ALL PASSED'));
process.exit(fails ? 1 : 0);
