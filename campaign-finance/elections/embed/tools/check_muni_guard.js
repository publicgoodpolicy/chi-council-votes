#!/usr/bin/env node
/* tools/check_muni_guard.js — the D-17 / PS-107 guard, built BEFORE the change it guards.
 *
 * SUBJECT, stated so the name does not over-read the body (PS-100): for every candidacy
 * whose race office is municipal, `committee_id` is null UNLESS the render path can window
 * municipal money. Nothing else. It does not check that windows are CORRECT, that municipal
 * copy is right, or that any municipal surface renders well — only that municipal finance
 * cannot reach a surface that has no window table to scope it with.
 *
 * WHY THIS EXISTS. PS-107 (D-17) rules code-before-data: no municipal committee id is
 * authored into any local registry before `officeType()` and `ELECTION_WINDOWS` carry
 * municipal support. The hazard it rules against is measured, not hypothetical —
 * `requireWin()` throws for any race whose office resolves to no window table, and its
 * throw is latent, gated solely on `committee_id` being null. THREE call sites reach it,
 * all in data.js, all re-derived by name at build time by the probe below rather than
 * pinned to line numbers:
 *     1. viewModels.raceView   — the per-race candidate cards
 *     2. viewModels.raceBrowse — the browse-layer roster
 *     3. personView            — the person surface (reachable only once officeType resolves)
 * The guard cites all three because a fix that satisfied one and not the others would
 * still ship a throw.
 *
 * HOW IT DECIDES "municipal support exists", and why it probes rather than introspects.
 * `officeType` and `ELECTION_WINDOWS` are closed over inside data.js and deliberately not
 * exported. Exporting them to let this check read them would change data.js, which changes
 * the recomposed bundle, which stales the live page — a paste debt incurred purely to let a
 * test see a private. So this check probes their JOINT EFFECT through the public API: it
 * deep-copies the real artifact in memory, gives one real municipal candidacy a committee
 * id, and drives all three call sites. If none throws PS-79/B1, municipal support exists.
 * The probe is in-memory only; no file is written and the real artifact is never mutated.
 *
 * IT HAS ALREADY RETIRED ITSELF, and that is recorded rather than assumed. Built at G3, the
 * unless-branch was false and the guard held because no municipal committee id existed. G4
 * landed the office-type table and the municipal window table, so the branch is now true and
 * this same body — unchanged — is the standing invariant "municipal finance never renders
 * without a window table". Phrasing it as a conditional rather than as "there are no
 * municipal committee ids" is what let the role change without a rewrite.
 *
 * WHAT IT STILL CATCHES, post-G4: an edit that drops or breaks municipal windows while
 * municipal committee ids exist. With support present AND zero offenders the check would
 * otherwise pass for two reasons at once, so self-test bite 5 removes the window table in
 * memory and requires the injected id to fail again.
 *
 * THE MUNICIPAL OFFICE SET IS STATED INDEPENDENTLY of data.js, on the same reasoning the
 * window fixture in gate_bundle.js states window values independently: an oracle that reads
 * its expectation from its subject checks nothing (PS-82). If data.js's office table and
 * this list ever disagree, that disagreement is a defect and this check is where it surfaces.
 *
 * ANTI-VACUITY. A conditional whose antecedent is empty passes for free, and an empty
 * antecedent can arise from the artifact changing shape (a renamed race office) rather than
 * from the rule holding. So the body also asserts the municipal candidacy population is
 * non-empty, and the pass line reports both halves — offender count AND support state — so a
 * green line never conceals which branch carried it.
 *
 *   node tools/check_muni_guard.js              (check the tracked artifact)
 *   node tools/check_muni_guard.js --self-test  (bite cases)
 */
'use strict';
var fs = require('fs'), path = require('path');

var DATA = path.join(__dirname, '..', '..', '..', 'election-data.json');
var D = require(path.join(__dirname, '..', 'data.js'));

// Stated independently of data.js — see the header note. These are `race.office` values,
// the keyspace raceWin/resolvePersonRef pass to officeType (G2 item 1.5).
var MUNICIPAL_RACE_OFFICES = ['alderperson', 'mayor', 'city_clerk', 'city_treasurer'];
var B1 = /\[PS-79\/B1\]/;   // the fail-loud marker requireWin throws with

function raceOfficeById(json) {
  var m = {};
  (json.races || []).forEach(function (r) { m[r.id] = r.office; });
  return m;
}

function municipalCandidacies(json) {
  var ro = raceOfficeById(json);
  return (json.candidates || []).filter(function (c) {
    return MUNICIPAL_RACE_OFFICES.indexOf(ro[c.race_id]) >= 0;
  });
}

/* Offenders: municipal candidacies carrying a committee id. This is the antecedent. */
function offenders(json) {
  return municipalCandidacies(json).filter(function (c) { return c.committee_id != null; })
    .map(function (c) { return { id: c.id, race_id: c.race_id, committee_id: c.committee_id }; });
}

/* Drive one call site, classifying the outcome three ways. `unreachable` is NOT a failure:
 * a surface that cannot be reached cannot render unwindowed money. Only a PS-79/B1 throw
 * means "municipal finance would render without a window". Any OTHER throw is reported as
 * `error` and fails loudly rather than being counted as support — a probe that swallowed an
 * unexpected exception would report support that does not exist. */
function drive(fn) {
  try {
    var out = fn();
    return out === null || out === undefined ? { state: 'unreachable' } : { state: 'ok' };
  } catch (e) {
    var msg = String((e && e.message) || e);
    return { state: B1.test(msg) ? 'threw' : 'error', msg: msg };
  }
}

/* Probe municipal render support by giving one real municipal candidacy a committee id in a
 * deep copy. Returns per-site outcomes plus a rolled-up boolean. */
function probeSupport(json) {
  var muni = municipalCandidacies(json);
  if (!muni.length) return { supported: false, sites: {}, note: 'no municipal candidacy to probe' };
  var probe = JSON.parse(JSON.stringify(json));
  var target = probe.candidates.filter(function (c) { return c.id === muni[0].id; })[0];
  target.committee_id = 'MUNI-GUARD-PROBE';
  probe.committees = probe.committees || {};
  probe.committees['muni-guard-probe'] = {
    id: 'muni-guard-probe', candidate_id: target.id, committee_name: 'Muni Guard Probe',
    sbe_committee_id: 'MUNI-GUARD-PROBE', type: 'candidate', ward: null, alder_name: null
  };
  var ro = raceOfficeById(probe);
  var office = ro[target.race_id] === 'alderperson' ? 'city_council' : 'mayor';
  var idx = D.loadData(probe, { office: office });
  var sites = {
    raceView: drive(function () { return D.viewModels.raceView(idx, target.race_id, null); }),
    raceBrowse: drive(function () { return D.viewModels.raceBrowse(idx, office, null); }),
    personView: drive(function () { return D.personView(idx, target.id); })
  };
  var bad = Object.keys(sites).filter(function (k) { return sites[k].state !== 'ok'; });
  var errored = Object.keys(sites).filter(function (k) { return sites[k].state === 'error'; });
  return {
    supported: bad.length === 0, sites: sites, errored: errored,
    probedCandidacy: target.id, probedOffice: office
  };
}

/* The check. Returns {pass, fails[], stats}. */
function evaluate(json) {
  var fails = [];
  var muni = municipalCandidacies(json);
  var off = offenders(json);
  var sup = probeSupport(json);

  if (!muni.length) {
    fails.push('[MUNI/GUARD] VACUOUS: the artifact carries no municipal candidacy at all, so ' +
      'the guard\'s antecedent is empty for a reason other than the rule holding. Municipal ' +
      'race offices expected: ' + MUNICIPAL_RACE_OFFICES.join(', '));
  }
  if (sup.errored && sup.errored.length) {
    fails.push('[MUNI/GUARD] the support probe threw a NON-PS-79/B1 error at ' +
      sup.errored.join(', ') + ' — the probe cannot vouch for support either way: ' +
      (sup.sites[sup.errored[0]] || {}).msg);
  }
  if (off.length && !sup.supported) {
    fails.push('[MUNI/GUARD] PS-107 (D-17) violated: ' + off.length + ' municipal candidac' +
      (off.length === 1 ? 'y carries' : 'ies carry') + ' a committee id while the render path ' +
      'cannot window municipal money. Offending: ' +
      off.slice(0, 5).map(function (o) { return o.id + '(' + o.committee_id + ')'; }).join(', ') +
      (off.length > 5 ? ', +' + (off.length - 5) + ' more' : '') +
      '. Sites still throwing: ' + Object.keys(sup.sites).filter(function (k) {
        return sup.sites[k].state === 'threw'; }).join(', ') +
      '. Land officeType + ELECTION_WINDOWS municipal support (G4) before authoring the id.');
  }
  return {
    pass: fails.length === 0, fails: fails,
    stats: { municipalCandidacies: muni.length, offenders: off.length,
             supported: sup.supported, sites: sup.sites }
  };
}

// ---------------------------------------------------------------- self-test
/* HERMETIC BY CONSTRUCTION, and this was a caught defect rather than a design instinct.
 * The first draft read the tracked artifact directly, so a bite-test that dirtied
 * election-data.json made [MUNI/SELF] fail alongside [MUNI/GUARD] — two failures for one
 * cause, with the self-test reporting on the artifact instead of on the checker. The
 * self-test's subject is the CHECKER; the artifact's state is [MUNI/GUARD]'s subject, and a
 * check whose expectation moves with an unrelated file's contents is the PS-82 shape. So the
 * base below is NORMALIZED — every municipal committee id stripped — making the control
 * clean by construction and every bite deterministic no matter what is on disk. The real
 * artifact still supplies the SHAPE, which is what makes these bites realistic. */
function normalizedBase() {
  var json = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var ro = raceOfficeById(json);
  (json.candidates || []).forEach(function (c) {
    if (MUNICIPAL_RACE_OFFICES.indexOf(ro[c.race_id]) >= 0) c.committee_id = null;
  });
  return json;
}

function selfTest() {
  var json = normalizedBase();
  var checks = 0, fails = 0;
  function ok(label, cond) {
    checks++;
    if (!cond) { fails++; console.log('FAIL  ' + label); } else { console.log('ok    ' + label); }
  }
  function clone() { return JSON.parse(JSON.stringify(json)); }
  function firstMuni(j) {
    var ro = raceOfficeById(j);
    return j.candidates.filter(function (c) { return MUNICIPAL_RACE_OFFICES.indexOf(ro[c.race_id]) >= 0; })[0];
  }

  // control — a municipal-committee-id-free base satisfies the guard. NOT a claim about the
  // tracked artifact: that is [MUNI/GUARD]'s subject, deliberately not duplicated here.
  var base = evaluate(json);
  ok('control: a normalized base (no municipal committee ids) passes', base.pass);
  ok('control: normalization left the antecedent population intact',
    base.stats.municipalCandidacies > 0 && base.stats.offenders === 0);
  ok('control: the pass line reports BOTH halves (offenders and support state)',
    typeof base.stats.offenders === 'number' && typeof base.stats.supported === 'boolean');

  // bite 1 — THE UNLESS-BRANCH, now real. Municipal support exists as of G4, so an injected
  // municipal committee id must PASS. Pre-G4 this same case asserted the opposite and was
  // carried by an in-memory simulation of the post-G4 code; the simulation is retired because
  // the state it simulated is the state on disk.
  var b1 = clone(); firstMuni(b1).committee_id = 'SYNTHETIC-MUNI-CMTE';
  ok('bite: with municipal support present, an injected municipal committee id PASSES',
    evaluate(b1).pass);

  // bite 2 — the probe observes support at all three requireWin sites. Asserted rather than
  // assumed, so a regression that removes municipal support from any ONE site is caught by
  // name instead of surfacing as a distant render failure.
  ok('bite: the support probe reports ok at raceView',
    base.stats.sites.raceView && base.stats.sites.raceView.state === 'ok');
  ok('bite: the support probe reports ok at raceBrowse',
    base.stats.sites.raceBrowse && base.stats.sites.raceBrowse.state === 'ok');
  ok('bite: the support probe reports ok at personView (reachable since the office-type table)',
    base.stats.sites.personView && base.stats.sites.personView.state === 'ok');

  // bite 3 — SCOPE: a school-board committee id must NOT trip a municipal guard
  var b3 = clone();
  var ro3 = raceOfficeById(b3);
  var sb = b3.candidates.filter(function (c) {
    return String(ro3[c.race_id] || '').indexOf('school_board') === 0 && c.committee_id == null; })[0];
  if (sb) sb.committee_id = 'SYNTHETIC-SB-CMTE';
  ok('bite: a school-board committee id does NOT trip the guard (scope holds)',
    evaluate(b3).pass);

  // bite 4 — anti-vacuity: strip municipal races and the guard FAILS rather than passing free
  var b4 = clone();
  b4.races = b4.races.filter(function (r) { return MUNICIPAL_RACE_OFFICES.indexOf(r.office) < 0; });
  var r4 = evaluate(b4);
  ok('bite: with no municipal candidacy the guard FAILS as VACUOUS, not passes',
    !r4.pass && r4.fails.join(' ').indexOf('VACUOUS') >= 0);

  // bite 5 — THE DIRECTION THAT CAN STILL GO WRONG, and the reason this check is not vacuous
  // post-G4. With municipal support present and no offenders the guard passes for two reasons
  // at once, so the biting case has to remove one of them: strip the municipal window table
  // in memory and the SAME injected id must fail again. This is the standing invariant the
  // guard became — "municipal finance never renders without a window table" — and it is what
  // would catch a future edit that dropped municipal windows while municipal ids existed.
  var stripped = simulateWindowsRemoved();
  if (stripped) {
    ok('bite: with the municipal window table removed, an injected municipal id FAILS again',
      !stripped.evaluate(stripped.withInjectedId()).pass);
    ok('bite: with municipal windows removed but NO offender, the guard still PASSES ' +
       '(the antecedent governs, not support alone)',
      stripped.evaluate(json).pass);
  } else {
    ok('bite: window-removal simulation could not be built (anchors moved — re-derive)', false);
  }

  console.log('\nself-test: ' + checks + ' checks · ' + (fails ? fails + ' FAILED' : 'ALL PASS'));
  return fails;
}

/* Build an in-memory data.js with the MUNICIPAL WINDOW TABLE REMOVED, and return an evaluate()
 * bound to it. Bite 5 uses it to keep the guard non-vacuous now that municipal support is real:
 * with both support present and zero offenders the guard would pass for two reasons at once, so
 * the biting case removes one.
 *
 * DISPOSITION NOTE (MUNI-ENABLE-1 G4). This replaces simulateSupportedData(), which patched
 * municipal support INTO an in-memory data.js so the pre-G4 self-test could prove the guard's
 * unless-branch before that state existed. G4 put that state on disk, so the old simulation's
 * anchors no longer matched and its assertion had inverted; it is retired rather than repaired,
 * and the direction that can still go wrong is simulated instead.
 *
 * Anchors are matched exactly and their absence is REPORTED (bite 5 fails loudly) rather than
 * silently skipped — the failure mode that would otherwise turn this bite into a no-op the next
 * time these lines move. Nothing is written. */
function simulateWindowsRemoved() {
  var Module = require('module');
  var srcPath = path.join(__dirname, '..', 'data.js');
  var src = fs.readFileSync(srcPath, 'utf8');
  var MUNI = "    municipal: {\n      '2027': { start: '2023-05-15', end: '2027-12-31' } } };";
  if (src.indexOf(MUNI) < 0) return null;
  src = src.replace(MUNI, "    /* municipal window table removed by the muni-guard bite */ };");
  var m = new Module('muni-guard-sim');
  m.paths = Module._nodeModulePaths(path.dirname(srcPath));
  m._compile(src, srcPath.replace(/\.js$/, '.sim.js'));
  var SIM = m.exports, realD = D;
  var json = normalizedBase();   // hermetic, per the self-test note above
  return {
    withInjectedId: function () {
      var j = JSON.parse(JSON.stringify(json));
      var ro = raceOfficeById(j);
      var t = j.candidates.filter(function (c) { return MUNICIPAL_RACE_OFFICES.indexOf(ro[c.race_id]) >= 0; })[0];
      t.committee_id = 'SYNTHETIC-MUNI-CMTE';
      return j;
    },
    evaluate: function (j) { D = SIM; try { return evaluate(j); } finally { D = realD; } }
  };
}

// ---------------------------------------------------------------- main
if (require.main === module) {
  if (process.argv.indexOf('--self-test') >= 0) {
    process.exit(selfTest() ? 1 : 0);
  }
  var json = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var r = evaluate(json);
  r.fails.forEach(function (f) { console.log(f); });
  var siteStates = Object.keys(r.stats.sites).map(function (k) {
    return k + '=' + r.stats.sites[k].state; }).join(' ');
  console.log('[check_muni_guard] ' + r.stats.municipalCandidacies + ' municipal candidac' +
    (r.stats.municipalCandidacies === 1 ? 'y' : 'ies') + ' · ' + r.stats.offenders +
    ' with a committee id · municipal render support: ' +
    (r.stats.supported ? 'PRESENT' : 'ABSENT') + ' (' + siteStates + ') · ' +
    (r.pass ? 'OK: 0 errors' : r.fails.length + ' error(s)'));
  process.exit(r.pass ? 0 : 1);
}

module.exports = { evaluate: evaluate, offenders: offenders, probeSupport: probeSupport,
                   MUNICIPAL_RACE_OFFICES: MUNICIPAL_RACE_OFFICES };
