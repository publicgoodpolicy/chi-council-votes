#!/usr/bin/env node
/* F-1 (rulings 128-3, 131-1, 132-2, 134-1): the per-office data files for the two elections pages.
 *
 *   node campaign-finance/elections/embed/tools/build_office_data.js [--check]
 *
 * Reads campaign-finance/election-data.json (the full file, which stays and which the mayor
 * bundle reads) and writes, beside it:
 *   election-data.school-board.json   (/school-board-elections)
 *   election-data.city-council.json   (/city-council)
 *
 * Run after build_rollups.py (README step 7c). --check rebuilds in memory and exits 1 if either
 * committed file differs from the rebuild, byte for byte.
 *
 * Each file holds the office's races and candidates, their committees, every independent-
 * expenditure committee and IE (data.js scopes those itself, as on the full file), every
 * contribution to those committees, the donors those contributions name with their parents and
 * cluster members, by_person for the office's people and by_candidate_election for its
 * committees. Three fields keep the page what it is on the full file (data.js loadData):
 *   parent_order          the full file's parent order, so equal totals keep their order
 *   own_committee_givers  parents with any own-committee gift, to any office (the M5 chip)
 *   other_office_giving   {parent: {windowId|'all': {office: total}}}, from data.js's own
 *                         donorFootprint on the full file, so the pop-up's "Also gave" lines are
 *                         that pop-up's own arithmetic.
 * [OFFICE/SLICE] in gate_bundle proves every view the page builds is the same on both files.
 */
'use strict';
var fs = require('fs'), path = require('path');
var CF = path.resolve(__dirname, '../../..');
var ED = require(path.join(CF, 'elections/embed/data.js'));
var OFFICES = [
  { office: 'school_board', file: 'election-data.school-board.json' },
  { office: 'city_council', file: 'election-data.city-council.json' }];
var OFFICE_OF_RACE = { alderperson: 'city_council', mayor: 'mayor', school_board_president: 'school_board', school_board_member: 'school_board' };

function build(full, office) {
  var races = {}, cands = {};
  full.races.forEach(function (r) { races[r.id] = r; });
  full.candidates.forEach(function (c) { cands[c.id] = c; });
  var offs = {}; ED.OFFICE_RACE_OFFICES[office].forEach(function (o) { offs[o] = 1; });
  var raceOffice = function (candId) { var c = cands[candId]; return c ? ((races[c.race_id] || {}).office || null) : null; };
  var keepCm = {};
  Object.keys(full.committees).forEach(function (k) {
    var cm = full.committees[k];
    if (cm.candidate_id ? offs[raceOffice(cm.candidate_id)] : cm.type === 'independent_expenditure') keepCm[k] = 1;
  });
  var candidates = full.candidates.filter(function (c) { return offs[(races[c.race_id] || {}).office]; });
  var keepCand = {}; candidates.forEach(function (c) { keepCand[c.id] = 1; });
  var contributions = full.contributions.filter(function (c) { return keepCm[c.committee_id]; });
  var dIds = {};
  contributions.forEach(function (c) { dIds[c.donor_id] = 1; });
  Object.keys(dIds).forEach(function (id) { var p = (full.donors[id] || {}).parent_id; if (p) dIds[p] = 1; });
  var clusters = full.donor_clusters || {};
  Object.keys(clusters).forEach(function (k) {
    var cl = clusters[k];
    if (dIds[cl.canonical_id] || (cl.members || []).some(function (m) { return dIds[m]; })) {
      dIds[cl.canonical_id] = 1; (cl.members || []).forEach(function (m) { dIds[m] = 1; });
    }
  });
  var donors = {}; Object.keys(full.donors).forEach(function (id) { if (dIds[id]) donors[id] = full.donors[id]; });
  var committees = {}; Object.keys(full.committees).forEach(function (k) { if (keepCm[k]) committees[k] = full.committees[k]; });
  var parents = {}; Object.keys(donors).forEach(function (id) { parents[donors[id].parent_id || id] = 1; });
  var bp = full.rollups.by_person || {}, byPerson = {};
  Object.keys(bp).forEach(function (k) { if ((bp[k].members || []).some(function (m) { return keepCand[m.candidacy_id]; })) byPerson[k] = bp[k]; });
  var bce = full.rollups.by_candidate_election || {}, byCE = {};
  Object.keys(bce).forEach(function (k) { if (keepCm[k] || keepCand[k]) byCE[k] = bce[k]; });

  // The full file's own index: its parent order, its own-committee givers, its pop-ups.
  var idx = ED.loadData(full, { office: office });
  var parentOrder = Object.keys(idx.parentRollup).filter(function (p) { return parents[p]; });
  var ownGivers = parentOrder.filter(function (p) { return idx.parentRollup[p].rows.some(function (c) { return c.is_own_committee; }); });
  var EW = ED.ELECTION_WINDOWS[ED.OFFICE_TYPE[office]], wins = [{ id: 'all', win: null }];
  Object.keys(EW).sort().forEach(function (id) { wins.push({ id: id, win: EW[id] }); });
  var other = {};
  parentOrder.forEach(function (p) {
    wins.forEach(function (w) {
      var fp = ED.donorFootprint(idx, p, w.win), g = null;
      fp.committees.forEach(function (m) {
        if (m.kind !== 'candidate') return;
        var o = OFFICE_OF_RACE[m.office] || m.office;
        if (o === office) return;
        g = g || {}; g[o] = Math.round(((g[o] || 0) + m.total) * 100) / 100;
      });
      if (g) (other[p] = other[p] || {})[w.id] = g;
    });
  });

  var out = {};
  Object.keys(full).forEach(function (k) {
    if (k === 'person_links') return;   // not read by the elections pages
    out[k] = full[k];
  });
  out.races = full.races.filter(function (r) { return offs[r.office]; });
  out.candidates = candidates; out.committees = committees; out.donors = donors;
  out.contributions = contributions;
  out.rollups = { by_person: byPerson, by_candidate_election: byCE };
  out.office_slice = office;
  out.parent_order = parentOrder;
  out.own_committee_givers = ownGivers;
  out.other_office_giving = other;
  return out;
}

function main() {
  var check = process.argv.indexOf('--check') >= 0;
  var full = JSON.parse(fs.readFileSync(path.join(CF, 'election-data.json'), 'utf8'));
  var bad = 0;
  OFFICES.forEach(function (o) {
    var txt = JSON.stringify(build(full, o.office)) + '\n', p = path.join(CF, o.file);
    if (check) {
      var cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      var ok = cur === txt; if (!ok) bad++;
      console.log((ok ? 'FRESH ' : 'STALE ') + o.file + ' ' + Buffer.byteLength(txt) + ' B');
    } else { fs.writeFileSync(p, txt); console.log('wrote ' + o.file + ' ' + Buffer.byteLength(txt) + ' B'); }
  });
  if (bad) process.exit(1);
}
if (require.main === module) main();
module.exports = { build: build, OFFICES: OFFICES };
