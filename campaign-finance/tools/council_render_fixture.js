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
 * M5 added two asserts on the other-committee line and chips. AUDIT-2 M2 added ten: the
 * other-receipts line in the current cycle, in the other views, before 2011 and on a committee
 * with nothing else; the loan chips on a constructed row and on the real data's other lists; a
 * listed pair's row filed as an other receipt; the methodology's figure; and the tool's other
 * tabs with their bite. The oracles below
 * leave other receipts out of every sum, as the page does.
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
  // AUDIT-2 M2: an other receipt is in no total, unless it is a listed pair's row (PS-142). Restated
  // here, not read from the embed.
  function isOther(c) { return c.contribution_type === 'Other Receipt' && !c.is_own_committee; }
  var scoped = od.contributions.filter(function (c) {
    return c.committee_id === TARGET && c.cycle === cy && !isOther(c);
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

  // AUDIT-2 M2: restated on the oracle. The assert compared the two rounded headlines' difference
  // to the rounded synthetic amount, which holds only when the real total's cents round the same
  // way before and after the amount is added; it held at every vintage until other receipts left
  // the total. Each headline is now compared to the oracle's own sum, rounded as the page rounds.
  T.ok('[E1.3] the headline moves by exactly the synthetic amount — disclosure, not counting',
    synthRaised === Math.round(oracleTotal) && realRaised === Math.round(oracleTotal - oracleAgg) &&
    Math.abs(oracleAgg - SYNTH) < 0.005,
    realRaised + ' -> ' + synthRaised + ' (oracle ' + (oracleTotal - oracleAgg).toFixed(2) + ' -> ' + oracleTotal.toFixed(2) +
    ', synthetic ' + SYNTH + ')');

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
    return c.committee_id === TARGET && c.cycle === 'pre-2011' && !isOther(c);   // M2
  }).reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var curatedRaised = money((uPre.text.match(/\$([\d,]+)\s*Raised/) || [])[1]);
  T.ok('[E5] the curated view total equals the pre-2011 subset EXACTLY (undated excluded)',
    curatedRaised === Math.round(preSubset),
    'curated headline ' + curatedRaised + ' vs pre-2011 subset ' + preSubset.toFixed(2) +
    ' (the undated $' + SYNTH_UNDATED + ' is in neither collection)');

  // ---- M5 (PS-142) — the other-committee line and chips, on a constructed row -------------
  // A synthetic donor gives the target committee one stamped row. The stamp is what the page
  // reads; the closed list and the builder that writes the stamp are the validator's subject.
  var OWN_AMT = 7777;
  var od = JSON.parse(baseRaw);
  od.donors['_own-fixture'] = { name: 'Own-committee donor (fixture)', type: 'PAC',
    parent_id: '_own-fixture', industries: [], flags: [] };
  od.contributions.push({ id: 'fixture-own-1', donor_id: '_own-fixture', committee_id: TARGET,
    amount: OWN_AMT, date: '2024-06-30', cycle: '2027', contribution_type: 'Transfer In',
    is_own_committee: true });
  var own = await boot(embedNow, od, { showAll: true });
  var ownLine = own.app.querySelector('.ipg-cf-ownline');
  var ownChips = [].slice.call(own.app.querySelectorAll('.ipg-cf-own'));
  var ownRow = own.app.querySelector('.ipg-cf-row[data-donor-id="_own-fixture"]');
  T.ok('[M5/OWN] the line under the tiles states the stamped money in whole dollars, and Raised includes it',
    !!ownLine && ownLine.textContent === 'From the candidate\u2019s other committee: $7,777, included in Raised.' &&
    money((own.text.match(/\$([\d,]+)\s*Raised/) || [])[1]) === realRaised + OWN_AMT,
    ownLine ? ownLine.textContent : 'no line');
  T.ok('[M5/OWN] exactly the stamped donor\u2019s row carries the chip, and unstamped data renders neither line nor chip',
    ownChips.length === 1 && !!ownRow && ownRow.contains(ownChips[0]) &&
    ownChips[0].textContent === 'From the candidate\u2019s other committee' &&
    real.app.querySelectorAll('.ipg-cf-own, .ipg-cf-ownline').length === 0,
    ownChips.length + ' chip(s) on the constructed data, ' +
    real.app.querySelectorAll('.ipg-cf-own, .ipg-cf-ownline').length + ' on the real ward');

  // ---- AUDIT-2 M2 — the other-receipts line, the loan chips, and a listed pair's row --------
  // One constructed boot. Four synthetic donors give the target committee, in the current cycle:
  // an other receipt; a loan; a gift and a loan; and an other receipt stamped is_own_committee.
  // Every expectation is recomputed here from the rows, real and constructed.
  var M2_OTHER = 5555.55, M2_LOAN = 4000, M2_GIFT = 1000, M2_PART = 2500, M2_OWN = 3333;
  var md = JSON.parse(baseRaw);
  [['_m2-other', 'Other-receipt payer (fixture)', 'Business'], ['_m2-loan', 'Lender (fixture)', 'Individual'],
   ['_m2-mixed', 'Lender and donor (fixture)', 'Individual'], ['_m2-own', 'Own-committee payer (fixture)', 'PAC']].forEach(function (x) {
    md.donors[x[0]] = { name: x[1], type: x[2], parent_id: x[0], industries: [], flags: [] };
  });
  function m2row(id, donor, amount, type, extra) {
    var r = { id: id, donor_id: donor, committee_id: TARGET, amount: amount, date: '2024-06-30', cycle: cy, contribution_type: type };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    md.contributions.push(r);
  }
  m2row('fixture-m2-other-1', '_m2-other', M2_OTHER, 'Other Receipt');
  m2row('fixture-m2-loan-1', '_m2-loan', M2_LOAN, 'Loan Received', { is_loan: true });
  m2row('fixture-m2-mixed-1', '_m2-mixed', M2_GIFT, 'Individual Contribution');
  m2row('fixture-m2-mixed-2', '_m2-mixed', M2_PART, 'Loan Received', { is_loan: true });
  m2row('fixture-m2-own-1', '_m2-own', M2_OWN, 'Other Receipt', { is_own_committee: true });
  var mRows = md.contributions.filter(function (c) { return c.committee_id === TARGET && c.cycle === cy; });
  var mOther = mRows.filter(isOther), mCounted = mRows.filter(function (c) { return !isOther(c); });
  var mOtherAmt = mOther.reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var mRaised = mCounted.reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var mCountedReal = JSON.parse(baseRaw).contributions.filter(function (c) { return c.committee_id === TARGET && c.cycle === cy && !isOther(c); })
    .reduce(function (s, c) { return s + (c.amount || 0); }, 0);
  var loanBy = {}, totalBy = {};
  mCounted.forEach(function (c) {
    totalBy[c.donor_id] = (totalBy[c.donor_id] || 0) + (c.amount || 0);
    if (c.is_loan) loanBy[c.donor_id] = (loanBy[c.donor_id] || 0) + (c.amount || 0);
  });
  var m2 = await boot(embedNow, md, { showAll: true });
  var oLine = m2.app.querySelector('.ipg-cf-otherline');
  var oText = oLine ? oLine.textContent : '';
  var oWant = 'Other receipts: $' + Math.round(mOtherAmt).toLocaleString() + ', not counted in Raised. Show the ' + mOther.length + ' receipts \u2193';
  var m2Raised = money((m2.text.match(/\$([\d,]+)\s*Raised/) || [])[1]);
  var payerRow = m2.app.querySelector('.ipg-cf-row[data-donor-id="_m2-other"]');
  var chipText = function (id) {
    var row = m2.app.querySelector('.ipg-cf-row[data-donor-id="' + id + '"]'), ch = row && row.querySelector('.ipg-cf-loan');
    return row ? (ch ? ch.textContent : '(no chip)') : '(no row)';
  };
  var chipRows = [].slice.call(m2.app.querySelectorAll('.ipg-cf-loan')).map(function (ch) {
    var row = ch.closest('.ipg-cf-row'); return row ? row.getAttribute('data-donor-id') : null;
  }).sort();
  var loanDonors = Object.keys(loanBy).sort();
  var ownRow2 = m2.app.querySelector('.ipg-cf-row[data-donor-id="_m2-own"]');
  var ownLine2 = m2.app.querySelector('.ipg-cf-ownline');
  var ownText2 = ownLine2 ? ownLine2.textContent : '';
  // the list the line opens: clicked last, because it re-renders the profile
  var tg2 = m2.doc.getElementById('ipg-cf-other-toggle'); if (tg2) tg2.onclick();
  var list2 = m2.app.querySelector('.ipg-cf-otherlist'), listText = list2 ? list2.textContent : '';
  var payers = {}; mOther.forEach(function (c) { payers[c.donor_id] = 1; });
  T.ok('[M2/OTHER] the line states the cycle\u2019s other receipts and their count, Raised leaves them out, and a payer is in no donor row and in the list the line opens',
    oText === oWant && m2Raised === Math.round(mRaised) && !payerRow && !!list2 &&
    list2.querySelectorAll('.ipg-cf-meta').length === Object.keys(payers).length &&
    listText.indexOf('Other-receipt payer (fixture)$' + Math.round(M2_OTHER).toLocaleString() + ' \u00b7 1 receipt') >= 0 &&
    list2.querySelectorAll('.ipg-cf-clickable, [data-donor-id]').length === 0 &&
    (m2.app.querySelector('.ipg-cf-otherline') || { textContent: '' }).textContent.indexOf('Hide \u2191') >= 0,
    (oText || 'no line') + ' | Raised ' + m2Raised + ' vs oracle ' + mRaised.toFixed(2) + ' | ' +
    (list2 ? list2.querySelectorAll('.ipg-cf-meta').length : 0) + ' payer line(s) for ' + Object.keys(payers).length + ' payer(s)');
  T.ok('[M2/LOAN] a row that is all loans reads \u201cLoan\u201d, a row that is partly loans states the amount, both stay in Raised, and exactly the donors with loan money carry a chip',
    chipText('_m2-loan') === 'Loan' && chipText('_m2-mixed') === 'Includes $' + M2_PART.toLocaleString() + ' in loans' &&
    JSON.stringify(chipRows) === JSON.stringify(loanDonors) && loanDonors.length >= 2 &&
    loanDonors.every(function (id) {
      var row = m2.app.querySelector('.ipg-cf-row[data-donor-id="' + id + '"]'), ch = row && row.querySelector('.ipg-cf-loan');
      return !!ch && ch.textContent === (loanBy[id] >= totalBy[id] - 0.005 ? 'Loan' : 'Includes $' + Math.round(loanBy[id]).toLocaleString() + ' in loans');
    }),
    chipText('_m2-loan') + ' | ' + chipText('_m2-mixed') + ' | ' + chipRows.length + ' chip(s) for ' + loanDonors.length + ' donor(s) with loan money');
  T.ok('[M2/OWN] a listed pair\u2019s row filed as an other receipt is counted in Raised and marked, and is not on the other-receipts line (PS-142)',
    !!ownRow2 && !!ownRow2.querySelector('.ipg-cf-own') &&
    ownText2 === 'From the candidate\u2019s other committee: $' + M2_OWN.toLocaleString() + ', included in Raised.' &&
    mOther.every(function (c) { return c.donor_id !== '_m2-own'; }) && listText.indexOf('Own-committee payer') < 0,
    ownText2 || 'no line');

  // The line follows the view: every cycle, and the before-2011 view. Same constructed data.
  var m2All = await boot(embedNow, md, { cycle: 'all' }), m2Pre = await boot(embedNow, md, { cycle: 'pre-2011' });
  var everyRow = md.contributions.filter(function (c) { return c.committee_id === TARGET && isOther(c); });
  var allAmt = everyRow.filter(function (c) { return c.cycle !== 'pre-2011' && c.cycle !== 'undated'; });
  var preAmt = everyRow.filter(function (c) { return c.cycle === 'pre-2011'; });
  var lineOf = function (r) { var l = r.app.querySelector('.ipg-cf-otherline'); return l ? l.textContent : ''; };
  var wantLine = function (rows) {
    return 'Other receipts: $' + Math.round(rows.reduce(function (s, c) { return s + (c.amount || 0); }, 0)).toLocaleString() +
      ', not counted in Raised. Show the ' + rows.length + (rows.length === 1 ? ' receipt' : ' receipts') + ' \u2193';
  };
  T.ok('[M2/OTHER] the line follows the view: every cycle, and the before-2011 view',
    allAmt.length > mOther.length && preAmt.length > 0 && lineOf(m2All) === wantLine(allAmt) && lineOf(m2Pre) === wantLine(preAmt),
    'all cycles: ' + lineOf(m2All) + ' | before 2011: ' + lineOf(m2Pre));

  // ---- AUDIT-2 M2 — the other surfaces of the tool: one constructed other receipt moves none --
  // The donor is a real one, chosen by rule: the largest of the 150 donors Follow the money offers
  // (two or more alders, ranked by what they gave ward committees) that stands alone (its own
  // parent, in no cluster), is not a candidate or a listed own-committee giver, carries a
  // substantive industry tag, gives another ward's committee in the current cycle, and has never
  // given the target. If the row leaked into a total it would show as new money for that donor,
  // that industry and one more alder. The same row filed as a contribution is the bite.
  var base2 = JSON.parse(baseRaw), toTarget = {}, toOther = {}, relTot = {}, relWards = {}, ownGiver = {};
  base2.contributions.forEach(function (c) {
    if (c.committee_id === TARGET) toTarget[c.donor_id] = 1;
    if (c.is_own_committee) ownGiver[c.donor_id] = 1;
    var cm = base2.committees[c.committee_id] || {};
    var dn0 = base2.donors[c.donor_id];
    if (cm.ward != null && c.cycle !== 'pre-2011' && c.cycle !== 'undated' && !isOther(c) && dn0 && dn0.type !== 'Aggregate') {
      relTot[c.donor_id] = (relTot[c.donor_id] || 0) + (c.amount || 0); (relWards[c.donor_id] || (relWards[c.donor_id] = {}))[cm.ward] = 1;
    }
    if (c.committee_id !== TARGET && c.cycle === cy && cm.ward != null && !isOther(c) && c.contribution_type !== 'IE Committee Dues Transfer' && !toOther[c.donor_id]) toOther[c.donor_id] = cm.ward;
  });
  var clustered = {};
  Object.keys(base2.donor_clusters || {}).forEach(function (k) { ((base2.donor_clusters[k] || {}).members || []).forEach(function (m) { clustered[m] = 1; }); });
  var offered = Object.keys(relTot).filter(function (id) { return Object.keys(relWards[id]).length >= 2; })
    .sort(function (p, q) { return relTot[q] - relTot[p] || (p < q ? -1 : 1); }).slice(0, 150);
  var X = offered.filter(function (id) {
    var dn = base2.donors[id];
    return dn.parent_id === id && !clustered[id] && dn.type !== 'Candidate' && !ownGiver[id] && !toTarget[id] && toOther[id] != null &&
      (dn.industries || []).some(function (t) { return t !== 'unclassified' && t !== 'individual'; });
  })[0];
  var W2 = X ? toOther[X] : null, X_AMT = 6543.21;
  function withRow(type) {
    var d = JSON.parse(baseRaw);
    d.contributions.push({ id: 'fixture-m2-x-1', donor_id: X, committee_id: TARGET, amount: X_AMT, date: '2024-06-30', cycle: cy, contribution_type: type });
    return d;
  }
  function wait(r, ms) { return new Promise(function (res) { r.dom.window.setTimeout(res, ms); }); }
  async function tour(r) {      // the profile first, then the tabs a leak would reach, then the donor's own profile
    var q = function (s) { return r.doc.querySelector(s); }, o = {};
    o.raised = money((r.app.textContent.match(/\$([\d,]+)\s*Raised/) || [])[1]);
    o.line = lineOf(r); o.rowForX = !!r.app.querySelector('.ipg-cf-row[data-donor-id="' + X + '"]');
    q('.ipg-tab[data-v="lookup"]').onclick(); await wait(r, 60);
    for (var s of ['industries', 'flags', 'alder-mix']) { q('.ipg-sub-tab[data-sub="' + s + '"]').onclick(); await wait(r, 60); o[s] = r.app.textContent; }
    q('.ipg-tab[data-v="relationship"]').onclick(); await wait(r, 200);
    var rd = q('#ipg-rel-donor'); if (rd) { rd.value = X; rd.onchange(); await wait(r, 200); }
    o.relPicked = !!q('#ipg-rel-donor') && q('#ipg-rel-donor').value === X; o.relationship = r.app.textContent;
    q('.ipg-tab[data-v="member"]').onclick(); await wait(r, 60);
    var ws = q('#ipg-ward-sel'); ws.value = String(W2); ws.onchange(); await wait(r, 200);
    var tg = q('#ipg-cf-toggle'); if (tg) { tg.onclick(); await wait(r, 60); }
    var row = r.app.querySelector('.ipg-cf-row[data-donor-id="' + X + '"]');
    if (row) { row.onclick(); await wait(r, 60); }
    var mod = q('#ipg-modal-overlay .ipg-modal'); o.modal = mod ? mod.textContent : '(no profile)';
    return o;
  }
  var tReal = null, tOther = null, tGift = null, SURF = ['industries', 'flags', 'alder-mix', 'relationship', 'modal'];
  if (X) {
    var bOther = await boot(embedNow, withRow('Other Receipt'), { showAll: true }), bGift = await boot(embedNow, withRow('Individual Contribution'), { showAll: true });
    tOther = await tour(bOther); tGift = await tour(bGift); tReal = await tour(real);   // `real` is not read again above this point
  }
  var movedByOther = X ? SURF.filter(function (k) { return tOther[k] !== tReal[k]; }) : SURF;
  var movedByGift = X ? SURF.filter(function (k) { return tGift[k] !== tReal[k]; }) : [];
  T.ok('[M2/TABS] a constructed other receipt from a real donor moves the alder\u2019s line and nothing else: Raised, Industry totals, Flag totals, Industries by alder, Follow the money and the donor\u2019s own profile read as on the real data',
    !!X && tReal.modal !== '(no profile)' && tReal.relPicked && tOther.relPicked && movedByOther.length === 0 && tOther.raised === tReal.raised && !tOther.rowForX &&
    tOther.line !== tReal.line && /^Other receipts: \$/.test(tOther.line),
    X ? ('donor ' + X + ' (ward ' + W2 + '); moved: ' + (movedByOther.join(', ') || 'none') + ' | ' + tOther.line) : 'premise: no donor fits the rule');
  T.ok('[M2/TABS:bite] the same row filed as a contribution moves Raised, Industry totals, Industries by alder, Follow the money and the donor\u2019s profile (Flag totals move only for a flagged donor)',
    !!X && tGift.raised === Math.round(mCountedReal + X_AMT) && tGift.rowForX &&
    ['industries', 'alder-mix', 'relationship', 'modal'].every(function (k) { return movedByGift.indexOf(k) >= 0; }),
    X ? ('Raised ' + tReal.raised + ' -> ' + tGift.raised + '; moved: ' + movedByGift.join(', ')) : 'premise: no donor fits the rule');

  // ---- AUDIT-2 M2 — the loan chip on the tool's other lists (OR-V2), on the REAL data --------
  // Oracle, from the rows: a donor's, a donor group's and a (committee, donor) pair's counted
  // money, and the part of it that is loans. A chip is expected exactly where that part is above
  // zero: "Loan" where it is the whole, the amount where it is not.
  var rd = JSON.parse(baseRaw), tot = { d: {}, p: {}, pair: {} }, loan = { d: {}, p: {}, pair: {} };
  rd.contributions.forEach(function (c) {
    if (c.cycle === 'pre-2011' || c.cycle === 'undated' || c.contribution_type === 'IE Committee Dues Transfer' || isOther(c)) return;
    var dn = rd.donors[c.donor_id] || {}, a = c.amount || 0;
    [['d', c.donor_id], ['p', dn.parent_id || c.donor_id], ['pair', c.committee_id + '|' + c.donor_id]].forEach(function (k) {
      tot[k[0]][k[1]] = (tot[k[0]][k[1]] || 0) + a;
      if (c.is_loan) loan[k[0]][k[1]] = (loan[k[0]][k[1]] || 0) + a;
    });
  });
  var chipFor = function (ln, t) { return ln > 0 ? (ln >= t - 0.005 ? 'Loan' : 'Includes $' + Math.round(ln).toLocaleString() + ' in loans') : null; };
  var chipOn = function (row) { var ch = row && row.querySelector('.ipg-cf-loan'); return ch ? ch.textContent : null; };
  var lb = await boot(embedNow, JSON.parse(baseRaw), {});
  var lq = function (sel) { return lb.doc.querySelector(sel); };
  // (1) Browse donors, every row of it
  lq('.ipg-tab[data-v="lookup"]').onclick(); await wait(lb, 80);
  if (lq('#ipg-cf-lookup-toggle')) { lq('#ipg-cf-lookup-toggle').onclick(); await wait(lb, 250); }
  var brRows = 0, brChips = 0, brWhole = 0, brOff = [];
  [].slice.call(lb.app.querySelectorAll('.ipg-cf-row[data-donor-id]')).forEach(function (row) {
    var id = row.getAttribute('data-donor-id'), got = chipOn(row); brRows++;
    if (got) { brChips++; if (got === 'Loan') brWhole++; }
    if (got !== chipFor(loan.p[id] || 0, tot.p[id] || 0)) brOff.push(id);
  });
  var lenders = Object.keys(loan.p).filter(function (id) { return loan.p[id] > 0; });
  // (3, read here while Browse donors is open) the profiles of the five largest lenders that stand
  // alone (their own parent, the only donor under it, in no cluster): each recipient row's chip
  var kids = {}, inCluster = {};
  Object.keys(rd.donors).forEach(function (id) { var pp = rd.donors[id].parent_id || id; kids[pp] = (kids[pp] || 0) + 1; });
  Object.keys(rd.donor_clusters || {}).forEach(function (k) { ((rd.donor_clusters[k] || {}).members || []).forEach(function (m) { inCluster[m] = 1; }); });
  var solo = lenders.filter(function (id) { return rd.donors[id] && (rd.donors[id].parent_id || id) === id && kids[id] === 1 && !inCluster[id]; })
    .sort(function (a, b) { return loan.p[b] - loan.p[a] || (a < b ? -1 : 1); }).slice(0, 5);
  var prRows = 0, prChips = 0, prOff = [];
  for (var si = 0; si < solo.length; si++) {
    var sid = solo[si], srow = lb.app.querySelector('.ipg-cf-row[data-donor-id="' + sid + '"]');
    if (!srow) { prOff.push(sid + ' (no row)'); continue; }
    srow.onclick(); await wait(lb, 80);
    var got = [].slice.call(lb.doc.querySelectorAll('#ipg-modal-overlay .ipg-cf-recipient[data-ward]')).map(function (r) { prRows++; var t = chipOn(r); if (t) prChips++; return t || '-'; }).sort();
    var want = Object.keys(tot.pair).filter(function (k) {
      var cm = rd.committees[k.split('|')[0]] || {};
      return k.split('|')[1] === sid && cm.ward != null && cm.type === 'candidate';
    }).map(function (k) { return chipFor(loan.pair[k] || 0, tot.pair[k]) || '-'; }).sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) prOff.push(sid + ' (' + got.join('/') + ' vs ' + want.join('/') + ')');
    if (lq('#ipg-modal-close')) { lq('#ipg-modal-close').onclick(); await wait(lb, 40); }
  }
  // (2) every industry's donor list (its 25 largest donors)
  lq('.ipg-sub-tab[data-sub="industries"]').onclick(); await wait(lb, 80);
  var inds = [].slice.call(lb.app.querySelectorAll('.ipg-cf-industry-row[data-industry]')).map(function (r) { return r.getAttribute('data-industry'); })
    .filter(function (v, i, all) { return all.indexOf(v) === i; });
  var inRows = 0, inChips = 0, inOff = [];
  for (var ii = 0; ii < inds.length; ii++) {
    lq('.ipg-sub-tab[data-sub="industries"]').onclick(); await wait(lb, 40);
    var irow = lb.app.querySelector('.ipg-cf-industry-row[data-industry="' + inds[ii] + '"]');
    if (!irow) { inOff.push(inds[ii] + ' (no row)'); continue; }
    irow.onclick(); await wait(lb, 60);
    [].slice.call(lb.app.querySelectorAll('.ipg-cf-row.ipg-cf-clickable[data-donor-id]:not(.ipg-cf-pac-recipient)')).forEach(function (row) {
      var id = row.getAttribute('data-donor-id'), t = chipOn(row); inRows++;
      if (t) inChips++;
      if (t !== chipFor(loan.d[id] || 0, tot.d[id] || 0)) inOff.push(inds[ii] + '/' + id);
    });
  }
  T.ok('[M2/LOAN] on the real data the chip is on exactly the rows whose money includes a loan, with the text the rows give, in Browse donors, in every industry\u2019s donor list and on the recipient rows of five lenders\u2019 profiles',
    brRows > 0 && brChips === lenders.length && lenders.length > 0 && brWhole > 0 && brWhole < brChips && brOff.length === 0 &&
    inds.length > 0 && inChips > 0 && inOff.length === 0 && solo.length === 5 && prChips > 0 && prOff.length === 0,
    'Browse donors: ' + brChips + ' chips on ' + brRows + ' rows for ' + lenders.length + ' lenders, ' + brWhole + ' reading \u201cLoan\u201d' +
    (brOff.length ? ', OFF ' + brOff.slice(0, 3).join(',') : '') + ' | industries: ' + inChips + ' chips on ' + inRows + ' rows in ' + inds.length + ' lists' +
    (inOff.length ? ', OFF ' + inOff.slice(0, 3).join(',') : '') + ' | profiles: ' + prChips + ' chips on ' + prRows + ' recipient rows of ' + solo.length + ' lenders' +
    (prOff.length ? ', OFF ' + prOff.slice(0, 3).join(',') : ''));

  // ---- AUDIT-2 M2 — the before-2011 donor view, a committee with nothing but other receipts, and
  // the methodology's figure --------------------------------------------------------------------
  // Two constructed rows dated before the tool's subject, each larger than any real one: an other
  // receipt and a gift. The gift's donor must lead the before-2011 donor view and the payer must
  // not be in it; on the alder's own before-2011 view the gift is a donor row and the payer is not.
  var pd = JSON.parse(baseRaw), PRE_AMT = 98765432.1;
  pd.donors['_m2-pre-other'] = { name: 'Before-2011 payer (fixture)', type: 'Business', parent_id: '_m2-pre-other', industries: [], flags: [] };
  pd.donors['_m2-pre-gift'] = { name: 'Before-2011 donor (fixture)', type: 'Business', parent_id: '_m2-pre-gift', industries: [], flags: [] };
  pd.contributions.push({ id: 'fixture-m2-pre-1', donor_id: '_m2-pre-other', committee_id: TARGET, amount: PRE_AMT, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Other Receipt' });
  pd.contributions.push({ id: 'fixture-m2-pre-2', donor_id: '_m2-pre-gift', committee_id: TARGET, amount: PRE_AMT, date: '2009-06-01', cycle: 'pre-2011', contribution_type: 'Individual Contribution' });
  var pb = await boot(embedNow, pd, { cycle: 'pre-2011', showAll: true });
  var preGiftRow = !!pb.app.querySelector('.ipg-cf-row[data-donor-id="_m2-pre-gift"]'), prePayerRow = !!pb.app.querySelector('.ipg-cf-row[data-donor-id="_m2-pre-other"]');
  var preLine = lineOf(pb);
  pb.doc.querySelector('.ipg-tab[data-v="lookup"]').onclick(); await wait(pb, 80);
  var preBtn = pb.doc.getElementById('ipg-cf-pre2011'); if (preBtn) { preBtn.onclick(); await wait(pb, 120); }
  var preView = pb.app.textContent;
  T.ok('[M2/OTHER] an other receipt dated before 2011 is in neither before-2011 view (the alder\u2019s, the donor list\u2019s), where a gift of the same date and size is; the alder\u2019s before-2011 line states it',
    !!preBtn && preView.indexOf('Before 2011 (outside this tool') >= 0 && preView.indexOf('Before-2011 donor (fixture)$' + Math.round(PRE_AMT).toLocaleString()) >= 0 &&
    preView.indexOf('Before-2011 payer (fixture)') < 0 && preGiftRow && !prePayerRow &&
    preLine.indexOf('Other receipts: $' + Math.round(preAmt.reduce(function (t, c) { return t + (c.amount || 0); }, 0) + PRE_AMT).toLocaleString() + ', not counted in Raised.') === 0,
    'donor list: gift ' + (preView.indexOf('Before-2011 donor (fixture)') >= 0) + ', payer ' + (preView.indexOf('Before-2011 payer (fixture)') >= 0) +
    ' | alder: gift row ' + preGiftRow + ', payer row ' + prePayerRow + ' | ' + preLine);

  // A committee whose every row was filed as an other receipt: the alder's page says there are no
  // contributions for the cycle, and still carries the line.
  var nd = JSON.parse(baseRaw), nAmt = 0, nCnt = 0;
  nd.contributions.forEach(function (c) {
    if (c.committee_id !== TARGET) return;
    c.contribution_type = 'Other Receipt'; delete c.is_own_committee;
    if (c.cycle === cy) { nAmt += c.amount || 0; nCnt++; }
  });
  var nb = await boot(embedNow, nd, {});
  T.ok('[M2/OTHER] a committee whose every row is an other receipt shows no contributions for the cycle and still carries the line',
    nCnt > 0 && nb.text.indexOf('No contributions recorded for this cycle.') >= 0 && nb.text.indexOf('Committee found but no contributions') < 0 &&
    lineOf(nb) === 'Other receipts: $' + Math.round(nAmt).toLocaleString() + ', not counted in Raised. Show the ' + nCnt + (nCnt === 1 ? ' receipt' : ' receipts') + ' \u2193',
    lineOf(nb) || 'no line');

  // The methodology's sentence (OR-V3) states the artifact's own field, which is a recount of the
  // rows; without the field the sentence is left off whole and the item stands.
  var fAmt = 0, fCnt = 0;
  rd.contributions.forEach(function (c) { if (c.cycle !== 'pre-2011' && c.cycle !== 'undated' && isOther(c) && !c.is_aggregate) { fAmt += Math.round((c.amount || 0) * 100); fCnt++; } });
  var fx = rd.other_receipts_excluded || {};
  var sentence = ' In this dataset they account for $' + (fAmt / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' across ' + fCnt.toLocaleString('en-US') + ' receipts.';
  lq('.ipg-tab[data-v="methodology"]').onclick(); await wait(lb, 80);
  var methText = lb.app.textContent;
  var xd = JSON.parse(baseRaw); delete xd.other_receipts_excluded;
  var xb = await boot(embedNow, xd, {});
  xb.doc.querySelector('.ipg-tab[data-v="methodology"]').onclick(); await wait(xb, 80);
  var xText = xb.app.textContent, itemEnd = 'states the amount on its own line and lists who paid it.';
  T.ok('[M2/OTHER] the methodology states the file\u2019s own figure, which equals a recount of the rows, after the other-receipts item; without the field the sentence is left off whole',
    fCnt > 0 && Math.round((fx.amount || 0) * 100) === fAmt && fx.count === fCnt && methText.indexOf(itemEnd + sentence) >= 0 &&
    xText.indexOf(itemEnd) >= 0 && xText.indexOf('In this dataset they account for $' + (fAmt / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) < 0,
    sentence.trim() + ' | field ' + JSON.stringify(rd.other_receipts_excluded));

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
