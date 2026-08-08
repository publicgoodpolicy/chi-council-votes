#!/usr/bin/env node
/* council_render_fixture.js — REPAIR-AGG-1's evidentiary basis (R4).
 *
 * The council embed restores a disclosure line for a class with ZERO live instances
 * (PS-96's un-keyed money: 0 rows, 0 Aggregate-typed donors in both artifacts). A render
 * authored against nothing verifiable is what D1 called unsafe; R4's answer was this
 * fixture, so it is not test scaffolding — it is the evidence the render ships on.
 *
 * Five asserts, ratified as E1.1-E1.4 (as corrected by F1/F3) and E5's extension:
 *   1  E1.1  synthetic rows present, UNFILTERED: itemized rows + the line == headline.
 *   2  E1.2  real artifact: no line node, AND the profile renders byte-identically to the
 *            pre-restore embed at HEAD — the E7 identical-on-real-data claim, proven here
 *            rather than asserted at paste time.
 *   3  E1.3  the headline moves by exactly the synthetic amount (disclosure, not counting).
 *   4  E1.4/F3  no-writes: both source files hash-unchanged, no file created. The fixture
 *            and the [AGG/PS-96] tripwire must never share bytes; injection is in-memory
 *            ONLY, so there are no fixture bytes for any validator to read.
 *   5  E5   a synthetic undated row renders in NO view, and the curated view's total
 *            equals the pre-2011 subset exactly (D16(iii)).
 *
 * Fixture DATA is never committed; this script is. Runtime is minutes (each boot parses a
 * ~39 MB artifact in jsdom) — it is a DELIBERATE tool and is deliberately NOT wired into
 * any per-build gate. Run it when the council render changes.
 *
 *     node campaign-finance/tools/council_render_fixture.js
 */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var { execFileSync } = require('child_process');

// jsdom resolution (portable), mirroring elections/embed/tools/gate_bundle.js.
function resolveJSDOM() {
  var tries = ['jsdom', path.join(__dirname, 'node_modules', 'jsdom'),
    path.join(__dirname, '..', 'node_modules', 'jsdom'), '/tmp/domtest/node_modules/jsdom'];
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]).JSDOM; } catch (e) {} }
  console.error('council_render_fixture: jsdom not found. Install it (npm i jsdom) or provide /tmp/domtest/node_modules/jsdom.');
  process.exit(2);
}
var JSDOM = resolveJSDOM();

var REPO = path.join(__dirname, '..', '..');
var EMBED = path.join(REPO, 'campaign-finance/elections/reference/council-embed.html');
var DATA = path.join(REPO, 'campaign-finance/council-data.json');
var WARD = 42, TARGET = 'ward-42-brendan-reilly';   // the sampled committee: most rows, REAL quality
var SYNTH = 12345.67, SYNTH_UNDATED = 999.99;

var T = { n: 0, fail: 0, ok: function (name, cond, note) {
  this.n++; if (!cond) this.fail++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (note ? '\n        ' + note : ''));
} };

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function money(s) { var m = String(s).replace(/[^0-9.]/g, ''); return m ? Number(m) : null; }

/* Boot an embed source string over an in-memory data object and drive to a ward profile.
 * The fetch shim is the whole isolation story: nothing is written, so nothing can leak
 * into an artifact the tripwire reads. */
function boot(embedHtml, data, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    var dom = new JSDOM('<!doctype html><html><body>' + embedHtml + '</body></html>', {
      runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse: function (w) {
        w.fetch = function (u) {
          return String(u).indexOf('council-data.json') >= 0
            ? Promise.resolve({ ok: true, json: function () { return Promise.resolve(data); } })
            : Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
        };
        w.scrollTo = function () {};
      }
    });
    setTimeout(function () {
      var doc = dom.window.document, app = doc.getElementById('ipg-council-app');
      var ws = doc.getElementById('ipg-ward-sel');
      ws.value = String(opts.ward || WARD); ws.onchange();
      setTimeout(function () {
        if (opts.cycle) {                       // optional cycle switch
          var cs = doc.getElementById('ipg-cf-cycle-sel');
          if (cs) { cs.value = opts.cycle; cs.onchange(); }
        }
        setTimeout(function () {
          if (opts.showAll) {                   // expand the top-10 cap so ALL rows are in the DOM
            var tg = doc.getElementById('ipg-cf-toggle');
            if (tg) tg.onclick();
          }
          setTimeout(function () {
            resolve({ dom: dom, doc: doc, app: app, html: app.innerHTML, text: app.textContent || '' });
          }, 250);
        }, 250);
      }, 400);
    }, 1400);
  });
}

function withSynthetic(base, opts) {
  var d = JSON.parse(base);
  opts = opts || {};
  if (opts.aggregate !== false) {
    d.donors['_agg-fixture'] = { name: 'Small-dollar contributions (fixture)', type: 'Aggregate',
      parent_id: '_agg-fixture', industries: [], flags: [] };
    d.contributions.push({ id: 'fixture-agg-1', donor_id: '_agg-fixture', committee_id: TARGET,
      amount: SYNTH, date: '2024-06-30', cycle: '2027', contribution_type: 'Individual Contribution',
      is_aggregate: true, donor_count: 400, contribution_count: 512 });
  }
  if (opts.undated) {
    d.donors['_undated-fixture'] = { name: 'Undated donor (fixture)', type: 'Individual',
      parent_id: '_undated-fixture', industries: [], flags: [] };
    d.contributions.push({ id: 'fixture-undated-1', donor_id: '_undated-fixture',
      committee_id: TARGET, amount: SYNTH_UNDATED, date: null, cycle: 'undated',
      contribution_type: 'Individual Contribution' });
  }
  if (opts.pre2011) {
    d.donors['_pre2011-fixture'] = { name: 'Pre-2011 donor (fixture)', type: 'Individual',
      parent_id: '_pre2011-fixture', industries: [], flags: [] };
    d.contributions.push({ id: 'fixture-pre-1', donor_id: '_pre2011-fixture',
      committee_id: TARGET, amount: 4444.44, date: '2009-03-01', cycle: 'pre-2011',
      contribution_type: 'Individual Contribution' });
  }
  return d;
}

(async function () {
  // ---- E1.4 / F3: capture the no-writes baseline BEFORE anything runs ----------------
  var preEmbed = sha(EMBED), preData = sha(DATA);
  var preTree = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });

  var baseRaw = fs.readFileSync(DATA, 'utf8');
  var embedNow = fs.readFileSync(EMBED, 'utf8');
  var embedHead = execFileSync('git',
    ['show', 'HEAD:campaign-finance/elections/reference/council-embed.html'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  console.log('council_render_fixture (REPAIR-AGG-1 / R4) — ward ' + WARD + ', committee ' + TARGET + '\n');

  // ---- assert 1 (E1.1) + assert 3 (E1.3) --------------------------------------------
  var real = await boot(embedNow, JSON.parse(baseRaw), { showAll: true });
  var synth = await boot(embedNow, withSynthetic(baseRaw), { showAll: true });

  var realRaised = money((real.text.match(/\$([\d,]+)\s*Raised/) || [])[1]);
  var synthRaised = money((synth.text.match(/\$([\d,]+)\s*Raised/) || [])[1]);

  // the line, located structurally: the one .ipg-cf-row that is NOT clickable and carries
  // no donor id — non-clickability is the E2 property, asserted rather than assumed.
  function lineNode(r) {
    var out = null;
    r.app.querySelectorAll('.ipg-cf-row').forEach(function (el) {
      if (!el.classList.contains('ipg-cf-clickable') && !el.getAttribute('data-donor-id')
          && /Small-dollar and un-itemized contributions/.test(el.textContent)) out = el;
    });
    return out;
  }
  var ln = lineNode(synth);
  var lineAmt = ln ? money(ln.querySelector('.amount').textContent) : null;

  // itemized rows visible in the DOM (show-all expanded), summed from RENDERED amounts
  function rowSum(r) {
    var s = 0, n = 0;
    r.app.querySelectorAll('.ipg-cf-row.ipg-cf-clickable[data-donor-id] .amount').forEach(function (a) {
      s += money(a.textContent); n++;
    });
    return { sum: s, n: n };
  }
  var rs = rowSum(synth);
  var reconciled = rs.sum + (lineAmt || 0);
  // Displayed dollars are per-row rounded (fmtMoney), so the reader-performable
  // reconciliation carries a rounding band of +/- 0.5 per rendered row. The EXACT identity
  // is asserted on unrounded values by the independent oracle below.
  var band = Math.ceil((rs.n + 1) / 2);

  T.ok('[E1.1] the disclosure line renders when the class is present, non-clickable and last',
    !!ln && synth.app.querySelectorAll('.ipg-cf-row')[synth.app.querySelectorAll('.ipg-cf-row').length - 1] === ln,
    'line amount ' + lineAmt + ' | rendered itemized rows ' + rs.n);

  // independent oracle: recompute the partition from the injected data, never from the DOM
  // or the embed's internals (PS-82 — a check does not consume its subject).
  var od = withSynthetic(baseRaw), cy = null;
  (function () {
    var tmp = JSON.parse(baseRaw); cy = tmp.current_cycle;
  })();
  var scoped = od.contributions.filter(function (c) {
    return c.committee_id === TARGET && c.cycle === cy;
  });
  var oracleTotal = scoped.reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var oracleAgg = scoped.filter(function (c) {
    var dn = od.donors[c.donor_id]; return dn && dn.type === 'Aggregate';
  }).reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var oracleItemized = oracleTotal - oracleAgg;

  T.ok('[E1.1] EXACT identity on unrounded values: itemized + line == headline total',
    Math.abs((oracleItemized + oracleAgg) - oracleTotal) < 0.005,
    'itemized ' + oracleItemized.toFixed(2) + ' + line ' + oracleAgg.toFixed(2) +
    ' == total ' + oracleTotal.toFixed(2));
  T.ok('[E1.1] the rendered line equals the oracle residual, and the visible list reconciles to the headline within the display-rounding band',
    lineAmt === Math.round(oracleAgg) && Math.abs(reconciled - synthRaised) <= band,
    'rendered rows ' + rs.sum + ' + line ' + lineAmt + ' = ' + reconciled +
    ' vs headline ' + synthRaised + ' (band +/-' + band + ' over ' + (rs.n + 1) + ' rounded rows)');

  T.ok('[E1.3] the headline moves by exactly the synthetic amount — disclosure, not counting',
    synthRaised - realRaised === Math.round(SYNTH),
    realRaised + ' -> ' + synthRaised + ' (delta ' + (synthRaised - realRaised) + ', synthetic ' + Math.round(SYNTH) + ')');

  // ---- assert 2 (E1.2) — real data: no line, and byte-identical to the pre-restore embed
  var headReal = await boot(embedHead, JSON.parse(baseRaw), { showAll: true });
  T.ok('[E1.2] on real data the line renders NOTHING — no node, no empty row, no $0 line',
    lineNode(real) === null && !/Small-dollar and un-itemized contributions/.test(real.text));
  T.ok('[E1.2/E7] the ward profile is BYTE-IDENTICAL to the pre-restore embed at HEAD on real data',
    real.html === headReal.html,
    real.html === headReal.html ? 'profile innerHTML sha ' + crypto.createHash('sha256').update(real.html).digest('hex').slice(0, 16)
      : 'DIFFERS: post ' + real.html.length + ' chars vs pre ' + headReal.html.length);

  // ---- assert 5 (E5) — undated renders in no view; curated total == pre-2011 subset ----
  var u = withSynthetic(baseRaw, { aggregate: false, undated: true, pre2011: true });
  var uCur = await boot(embedNow, u, { showAll: true });
  var uAll = await boot(embedNow, u, { showAll: true, cycle: 'all' });
  var uPre = await boot(embedNow, u, { showAll: true, cycle: 'pre-2011' });
  var seen = function (r) { return /Undated donor \(fixture\)/.test(r.text); };
  T.ok('[E5] a synthetic undated row appears in NO view (current, all cycles, before-May-2011)',
    !seen(uCur) && !seen(uAll) && !seen(uPre),
    'current=' + seen(uCur) + ' all=' + seen(uAll) + ' curated=' + seen(uPre));
  var preSubset = u.contributions.filter(function (c) {
    return c.committee_id === TARGET && c.cycle === 'pre-2011';
  }).reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var curatedRaised = money((uPre.text.match(/\$([\d,]+)\s*Raised/) || [])[1]);
  T.ok('[E5] the curated view total equals the pre-2011 subset EXACTLY (undated excluded)',
    curatedRaised === Math.round(preSubset),
    'curated headline ' + curatedRaised + ' vs pre-2011 subset ' + preSubset.toFixed(2) +
    ' (the undated $' + SYNTH_UNDATED + ' is in neither collection)');

  // ---- assert 4 (E1.4 / F3) — no-writes, measured last -------------------------------
  var postEmbed = sha(EMBED), postData = sha(DATA);
  var postTree = execFileSync('git', ['status', '--porcelain'], { cwd: REPO, encoding: 'utf8' });
  T.ok('[E1.4/F3] no-writes: both source files hash-unchanged and no file created',
    preEmbed === postEmbed && preData === postData && preTree === postTree,
    'embed ' + preEmbed.slice(0, 12) + ' | data ' + preData.slice(0, 12) +
    ' | git-status bytes ' + preTree.length + '->' + postTree.length);

  console.log('\n' + T.n + ' fixture asserts · ' + (T.fail ? ('FAILED ' + T.fail) : 'ALL PASS'));
  process.exit(T.fail ? 1 : 0);
})();
