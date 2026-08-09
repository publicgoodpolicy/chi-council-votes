#!/usr/bin/env node
/* sb_render_fixture.js — SBVOTE-1 / HALT-SBV-C. The evidence the school-board
 * embed ships on, and the demonstration of every C3 birth state.
 *
 * PRECEDENT AND THE ONE PLACE IT IS DEPARTED FROM. `tools/council_render_fixture.js`
 * established the pattern: boot the real embed in jsdom, shim `fetch`, assert on the
 * rendered DOM — the fixture is not test scaffolding, it is the evidence the render
 * ships on. That fixture is deliberately NOT wired into a per-build gate, and its own
 * header states the reason: each boot parses a ~39 MB artifact and takes minutes.
 *
 * That reason does not transfer. The school-board artifact is ~7.6 KB and boots in
 * milliseconds, so the cost that justified leaving the council fixture ungated does not
 * exist here. This fixture IS gated ([SBV/RENDER]). The precedent's rule is followed;
 * only the cost-driven exception to it is not, and that is a deliberate divergence
 * rather than an oversight.
 *
 * NO WRITES. Every artifact is either read from disk or built in memory; nothing is
 * created, and the real artifact is hash-checked unchanged at exit.
 *
 *     node campaign-finance/school-board/sb_render_fixture.js
 */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');

function resolveJSDOM() {
  var tries = ['jsdom', path.join(__dirname, 'node_modules', 'jsdom'),
    path.join(__dirname, '..', 'node_modules', 'jsdom'),
    path.join(__dirname, '..', 'elections', 'embed', 'node_modules', 'jsdom'),
    '/tmp/domtest/node_modules/jsdom'];
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]).JSDOM; } catch (e) {} }
  console.error('sb_render_fixture: jsdom not found. Install it (npm i jsdom) or provide '
    + '/tmp/domtest/node_modules/jsdom.');
  process.exit(2);
}
var JSDOM = resolveJSDOM();

var REPO = path.join(__dirname, '..', '..');
var EMBED = path.join(REPO, 'campaign-finance/school-board/school-board-embed.html');
var DATA = path.join(REPO, 'campaign-finance/school-board-data.json');
var EMBED_HTML = fs.readFileSync(EMBED, 'utf8');
var REAL = JSON.parse(fs.readFileSync(DATA, 'utf8'));
var sha = function (p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); };
var FINDATA = path.join(REPO, 'campaign-finance/school-board-finance.json');
var REALFIN = JSON.parse(fs.readFileSync(FINDATA, 'utf8'));
var EMBED_SHA0 = sha(EMBED), DATA_SHA0 = sha(DATA), FIN_SHA0 = sha(FINDATA);

var n = 0, fail = 0, POSTED = null;
// FIN is what the finance fetch resolves for the CURRENT boot; FETCHED records
// every GET so the fetch count is asserted by observation, not by source-reading.
var FIN = REALFIN, FETCHED = [];
function ok(label, cond, detail) {
  n++; if (!cond) fail++;
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (cond || !detail ? '' : '\n        ' + detail));
}

/* Boot the REAL page: the embed's own script, its own render path, its own fetch call.
 * `mode` drives the fetch shim — 'ok' resolves the given data, 'fail' makes the one
 * fetch reject, which is the only way to exercise the error state honestly. */
function boot(data, mode) {
  return new Promise(function (resolve) {
    var dom = new JSDOM('<!doctype html><html><body>' + EMBED_HTML + '</body></html>', {
      runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse: function (w) {
        w.fetch = function (u, opts) {
          // HARD GUARD: the fixture must never submit. A POST from any code path —
          // including an accidental click on the feedback submit button — aborts the
          // run rather than being quietly shimmed away (authorization stop condition:
          // "any POST to the feedback endpoint from any code path including the fixture").
          if (opts && String(opts.method || '').toUpperCase() === 'POST') {
            POSTED = String(u);
            throw new Error('FIXTURE POSTED to ' + u + ' — forbidden');
          }
          // Every GET is recorded so [SBF/FETCH] can assert the ratified N=2 by
          // enumeration rather than by reading the source for URL literals.
          FETCHED.push(String(u));
          if (mode === 'fail') return Promise.reject(new Error('network unreachable'));
          if (String(u).indexOf('school-board-finance.json') >= 0) {
            // 'finfail' exercises the isolation requirement: finance down, votes fine.
            if (mode === 'finfail') return Promise.reject(new Error('finance unreachable'));
            return Promise.resolve({ ok: true, json: function () { return Promise.resolve(FIN); } });
          }
          return String(u).indexOf('school-board-data.json') >= 0
            ? Promise.resolve({ ok: true, json: function () { return Promise.resolve(data); } })
            : Promise.resolve({ ok: false, status: 404, json: function () { return Promise.resolve({}); } });
        };
        w.scrollTo = function () {};
      }
    });
    setTimeout(function () {
      var doc = dom.window.document, app = doc.getElementById('ipg-sb-app');
      resolve({ dom: dom, doc: doc, app: app,
                html: app.innerHTML, text: app.textContent || '' });
    }, 300);
  });
}
function pick(v, seat) {                       // select a seat and re-render
  var s = v.doc.getElementById('ipg-sb-seat-sel');
  s.value = seat; s.onchange();
  return { doc: v.doc, app: v.app, html: v.app.innerHTML, text: v.app.textContent || '' };
}
function setSel(v, id, value) {                // drive a select, then re-render
  var s = v.doc.getElementById(id);
  s.value = value; s.onchange();
  return { doc: v.doc, app: v.app, html: v.app.innerHTML, text: v.app.textContent || '' };
}
function trySel(v, id, value) {          // drive a select IF it exists; else pass through
  var s = v.doc.getElementById(id);
  if (!s) return v;
  s.value = value; s.onchange();
  return { doc: v.doc, app: v.app, html: v.app.innerHTML, text: v.app.textContent || '' };
}
function nav(v, view) {
  var b = v.doc.querySelector('[data-view="' + view + '"]');
  b.onclick();
  return { doc: v.doc, app: v.app, html: v.app.innerHTML, text: v.app.textContent || '' };
}

/* The five ratified strings, read from the REGISTER rather than retyped here — the
 * entry of record is what the page must match, and a fixture carrying its own copy
 * would only prove the copy agrees with itself. */
var REG = fs.readFileSync(path.join(REPO, 'campaign-finance/RULINGS.md'), 'utf8');
var entry = REG.split('### SBVOTE-1 G1+G3 — display strings 1–5')[1].split('\n### ')[0];
function regString(re) { var m = entry.match(re); return m ? m[1] : null; }
var S1 = regString(/`(Voting records for the Chicago Board of Education[^`]*)`/);
var S2 = regString(/\*\*Appointed-member badge:\*\* `([^`]+)`/);
var S3 = regString(/`(No recorded votes yet for this member\.)`/);
var S4 = regString(/`(Vote positions are entered from public Board[^`]*)`/);
var S5 = regString(/\*\*Vacant seat label:\*\* `([^`]+)`/);

/* SBFIN-1's four finance-state strings, read from the register for the same reason:
 * the entry of record is what the page must match. Retyping them here would only
 * prove the fixture agrees with itself. */
var fentry = REG.split('### SBFIN-1 — finance state strings 1–4')[1].split('\n### ')[0];
function fString(re) { var m = fentry.match(re); return m ? m[1] : null; }
var F1 = fString(/`(No campaign finance records are on file[^`]*)`/);
var F2 = fString(/`(Itemized donor detail for this campaign[^`]*)`/);
// String 3 was SUPERSEDED at SBFIN-2 B; the register carries the replacement as 3'.
// Read the superseding text, and assert the superseded one is gone from the page.
var F3 = fString(/`(\{N\}% of these donor dollars carry a substantive industry tag[^`]*)`/);
var F3OLD = fString(/`(This chart classifies \{N\}%[^`]*)`/);
var F5 = fString(/\*\*All-elections scope label:\*\* `([^`]+)`/);
var F6 = fString(/`(Combined across every school board election[^`]*)`/);
var F7 = fString(/`(A “Self-Funding \/ Candidate Loan” segment[^`]*)`/);
var F4 = fString(/`(Industry classification of this member[^`]*)`/);
// {N} is substituted at render, so the register form is matched on its stable halves.
function around(tpl, marker) { return String(tpl).split(marker); }

(async function () {
  ok('register entry yielded all five strings',
     !!(S1 && S2 && S3 && S4 && S5), JSON.stringify({ S1: !!S1, S2: !!S2, S3: !!S3, S4: !!S4, S5: !!S5 }));
  ok('SBFIN-1 register entry yielded all four finance strings',
     !!(F1 && F2 && F3 && F4), JSON.stringify({ F1: !!F1, F2: !!F2, F3: !!F3, F4: !!F4 }));
  ok('SBFIN-2 register amendment yielded the superseding + three new strings',
     !!(F3OLD && F5 && F6 && F7),
     JSON.stringify({ F3OLD: !!F3OLD, F5: !!F5, F6: !!F6, F7: !!F7 }));

  // ---------- C3 state 1: the born artifact, 0 votes -> string 1 ----------
  var born = await boot(REAL, 'ok');
  ok('[C3/1] born artifact (0 votes) renders string 1 verbatim, not a blank and not an error',
     born.text.indexOf(S1) >= 0);
  ok('[C3/1] the born state is NOT an error state',
     born.html.indexOf('ipg-sb-err') < 0);

  // ---------- C3 state 2: every member has no positions -> string 3 -------
  // With votes present but every cell blank, the member surface must say string 3
  // rather than render an empty table.
  var noPos = JSON.parse(JSON.stringify(REAL));
  var seats = noPos.members.map(function (m) { return m.seat; });
  var blank = {}; seats.forEach(function (s) { blank[s] = '-'; });
  noPos.votemeta = [{ code: 'V1', full: 'A recorded board vote', date: '2026-02-01',
                      desc: 'Description.', tag: 'Budget', source_url: 'https://example.org/v1',
                      vote_id: 'V1' }];
  noPos.rollcall.votes = [{ id: 'V1', date: '2026-02-01', title: 'A recorded board vote',
                            source_url: 'https://example.org/v1', tag: 'Budget',
                            type: '["board-vote"]', positions: blank }];
  noPos.rollcall.term_votes = 1;
  var v2 = await boot(noPos, 'ok');
  ok('[C3/2] a member with no recorded position renders string 3, not an empty table',
     v2.text.indexOf(S3) >= 0);

  // ---------- C3 state 3: the vacancy -> string 5, and NO member page -----
  var vac = REAL.members.filter(function (m) { return !String(m.name || '').trim(); })[0];
  ok('[C3/3] the born roster carries exactly one vacancy',
     REAL.members.filter(function (m) { return !String(m.name || '').trim(); }).length === 1,
     'seat ' + (vac && vac.seat));
  var vv = pick(born, vac.seat);
  ok('[C3/3] the vacant seat renders string 5 at the seat label',
     vv.text.indexOf(S5) >= 0);
  ok('[C3/3] the vacancy has NO member page: no badge, no term, no source, no votes section',
     vv.html.indexOf('ipg-sb-badge') < 0 && vv.text.indexOf('Term began') < 0
       && vv.html.indexOf('ipg-sb-vote') < 0);
  ok('[C3/3] the vacant seat still APPEARS in the selector (the seat is a real fact)',
     born.html.indexOf('>' + vac.seat + ' — ' + S5 + '<') >= 0);

  // ---------- C3 state 4: `-` renders as not-recorded, never as Neutral ---
  // FOUR votes on ONE member, one per stored value, so a single member page shows all
  // four display states side by side. (A member whose ONLY position is `-` correctly
  // gets string 3 instead — that is the state-2 case above, not this one.)
  var VALS = ['Affirmative', 'Oppositional', 'Neutral', '-'];
  var mixed = JSON.parse(JSON.stringify(REAL));
  var subject = mixed.members.filter(function (m) { return String(m.name || '').trim(); })[0];
  mixed.votemeta = []; mixed.rollcall.votes = [];
  VALS.forEach(function (val, i) {
    var id = 'V' + (i + 1);
    mixed.votemeta.push({ code: id, full: 'Board vote ' + (i + 1), date: '2026-02-0' + (i + 1),
                          desc: 'Description ' + (i + 1) + '.', tag: 'Budget',
                          source_url: 'https://example.org/' + id, vote_id: id });
    var p = {}; seats.forEach(function (s) { p[s] = '-'; });
    p[subject.seat] = val;
    mixed.rollcall.votes.push({ id: id, date: '2026-02-0' + (i + 1),
                                title: 'Board vote ' + (i + 1),
                                source_url: 'https://example.org/' + id, tag: 'Budget',
                                type: '["board-vote"]', positions: p });
  });
  mixed.rollcall.term_votes = VALS.length;
  var v4 = await boot(mixed, 'ok');
  var sv = pick(v4, subject.seat);
  ok('[C3/4] all four stored values render on one member page',
     ['Yes', 'No', 'Present', 'Not recorded'].every(function (l) { return sv.text.indexOf(l) >= 0; }));
  ok('[C3/4] `-` renders as "Not recorded", in its own pill class',
     sv.text.indexOf('Not recorded') >= 0 && sv.html.indexOf('pill-norecord') >= 0);
  ok('[C3/4] Neutral renders as "Present", in a DIFFERENT pill class from `-`',
     sv.html.indexOf('pill-neu"') >= 0 && sv.html.indexOf('pill-norecord') >= 0);
  ok('[C3/4] `-` is never labelled Neutral anywhere on the page',
     sv.text.indexOf('Neutral') < 0);
  // The complete-record view is the other surface a `-` reaches.
  var rec = nav(v4, 'record');
  ok('[C3/4] the complete-record view renders `-` as Not recorded too',
     rec.text.indexOf('Not recorded') >= 0
       && rec.html.indexOf('ipg-sb-rec-pos norecord') >= 0);

  // ---------- C3 state 5: fetch failure -> a stated error, not a blank ----
  var errv = await boot(REAL, 'fail');
  ok('[C3/5] a failed fetch renders a stated error, not a blank page',
     errv.html.indexOf('ipg-sb-err') >= 0 && errv.text.indexOf('Could not load') >= 0);
  ok('[C3/5] the error names the cause rather than swallowing it',
     errv.text.indexOf('network unreachable') >= 0);

  // ---------- strings 2 and 4, and the badge asymmetry --------------------
  var appointed = REAL.members.filter(function (m) { return m.seat_type === 'appointed' && String(m.name||'').trim(); })[0];
  var elected = REAL.members.filter(function (m) { return m.seat_type === 'elected'; })[0];
  var av = pick(born, appointed.seat), ev = pick(born, elected.seat);
  ok('[S2] an appointed member carries the ' + JSON.stringify(S2) + ' badge',
     av.html.indexOf('ipg-sb-badge') >= 0 && av.text.indexOf(S2) >= 0);
  ok('[S2] an elected member carries NO badge (the exception is what gets labeled)',
     ev.html.indexOf('ipg-sb-badge') < 0);
  var meth = nav(born, 'methodology');
  ok('[S4] the methodology surface carries string 4 verbatim',
     meth.text.indexOf(S4) >= 0);

  // ---------- the render boundary: exactly one map, four pairs ------------
  var mapBlock = EMBED_HTML.split('var POSITION_DISPLAY = {')[1].split('};')[0];
  ok('[MAP] POSITION_DISPLAY declares exactly four pairs',
     (mapBlock.match(/'(Affirmative|Oppositional|Neutral|-)':/g) || []).length === 4, mapBlock.trim());
  // Zero coupling is a property of the DATA source. SBVOTE-2 restated this as "exactly
  // one artifact"; SBFIN-1 ratification 1 DELIBERATELY reopens it as an enumerated N=2,
  // both school-board-family. The claim is updated, not weakened: the count is still
  // asserted exactly, and [SBF/FETCH] additionally asserts it by observed GETs.
  var fetchTargets = (EMBED_HTML.match(/fetch\(([A-Za-z_.]+)/g) || []);
  ok('[MAP] both DATA fetches use the ratified refs/heads/main/ URL form',
     EMBED_HTML.indexOf('refs/heads/main/campaign-finance/school-board-data.json') >= 0
       && EMBED_HTML.indexOf('refs/heads/main/campaign-finance/school-board-finance.json') >= 0
       && (EMBED_HTML.match(/IPG_SB_CONFIG\.dataUrl/g) || []).length === 1
       && (EMBED_HTML.match(/IPG_SB_CONFIG\.financeUrl/g) || []).length === 1);
  ok('[MAP] exactly three fetch call-sites: two data + the feedback endpoint',
     fetchTargets.length === 3
       && fetchTargets.filter(function (f) { return f.indexOf('IPG_SB_CONFIG') >= 0; }).length === 2
       && fetchTargets.filter(function (f) { return f.indexOf('IPG_SB_FEEDBACK') >= 0; }).length === 1,
     JSON.stringify(fetchTargets));
  ok('[MAP] zero coupling: the embed names no other artifact and no finance embed',
     EMBED_HTML.indexOf('council-data.json') < 0
       && EMBED_HTML.indexOf('election-data.json') < 0);

  // ---------- SBVOTE-2: the parity transplants ----------------------------
  ok('[SBV2/BAND] the full-bleed teal header band renders with the stepped accent',
     born.html.indexOf('ipg-sb-head') >= 0
       && EMBED_HTML.indexOf('background:var(--teal); color:var(--cream)') >= 0
       && EMBED_HTML.indexOf('linear-gradient(90deg,var(--sage) 0 62%,var(--tan) 62% 100%)') >= 0);
  ok('[SBV2/BAND] the title carries the serif display face and the subtitle sits in the band',
     born.html.indexOf('ipg-sb-title serif') >= 0 && born.html.indexOf('ipg-sb-sub') >= 0);
  ok('[SBV2/TABS] the tab strip replaces the nav pills, with one tab marked active',
     born.html.indexOf('ipg-sb-tabs') >= 0
       && (born.html.match(/ipg-sb-tab active/g) || []).length === 1);
  // Structural, so it tests the CODE and not the prose: the comment of record
  // deliberately explains that a Recoleta @font-face used to be here, and that
  // explanation must survive. Comments are stripped before the check.
  var EMBED_CODE = EMBED_HTML.replace(/<!--[\s\S]*?-->/g, '');
  ok('[SBV2/FONT] Recoleta is gone as a FACE (the comment of record may still name it)',
     EMBED_CODE.indexOf('Recoleta') < 0 && EMBED_CODE.indexOf('@font-face') < 0
       && EMBED_CODE.indexOf('onlinewebfonts') < 0
       && (EMBED_CODE.match(/font-family:Georgia, ui-serif, serif/g) || []).length >= 1);
  ok('[SBV2/GREY] the warm-grey ramp is tokenised, not literal',
     ['--ink-muted','--ink-label','--ink-mid','--ink-deep','--ink-nd']
       .every(function (v) { return EMBED_HTML.indexOf(v + ':#') >= 0; }));
  ok('[SBV2/BP] one breakpoint scale',
     (EMBED_HTML.match(/@media/g) || []).length === 1
       && EMBED_HTML.indexOf('@media(max-width:600px)') >= 0);

  // Record surface: card-per-vote for the selected seat, NOT a matrix (Finding 2).
  var recv = nav(pick(v4, subject.seat), 'record');
  ok('[SBV2/REC] the per-member record is card-per-vote, not a matrix',
     recv.html.indexOf('ipg-sb-rec-vote') >= 0 && recv.html.indexOf('ipg-sb-matrix') < 0);
  ok('[SBV2/REC] it uses the solid record-chip idiom',
     recv.html.indexOf('ipg-sb-rec-pos') >= 0);

  // The all-seats grid is its own view, with the council's legend.
  var mxv = nav(recv, 'matrix');
  ok('[SBV2/MX] the matrix view exists as its own view',
     mxv.html.indexOf('ipg-sb-matrix') >= 0 && mxv.html.indexOf('ipg-sb-rec-vote') < 0);
  ok('[SBV2/MX] it carries the legend, with all four keys',
     mxv.html.indexOf('ipg-sb-mx-legend') >= 0
       && ['mx-aff','mx-opp','mx-neu','mx-na'].every(function (k) { return mxv.html.indexOf(k) >= 0; }));
  ok('[SBV2/MX] every roster seat has a row, the vacancy included and marked',
     (mxv.html.match(/class="seat-col"/g) || []).length === REAL.members.length + 1
       && mxv.html.indexOf('vacant-row') >= 0);

  // Feedback: the trigger exists and OPENS — and nothing is ever submitted.
  var fabEl = born.doc.getElementById('ipg-sb-fb-fab');
  ok('[SBV2/FB] the feedback trigger exists', !!fabEl);
  fabEl.onclick();
  var modal = born.doc.getElementById('ipg-sb-fb-overlay');
  ok('[SBV2/FB] the trigger opens the modal', !!modal);
  var mtext = modal ? (modal.textContent || '') : '';
  ok('[SBV2/FB] the ratified context disclosure renders in the modal',
     mtext.indexOf('Sending this report includes what you\u2019re viewing') >= 0);
  ok('[SBV2/FB] the re-authored placeholder is seat-shaped, not ward-shaped',
     (modal ? modal.innerHTML : '').indexOf('Seat 3B') >= 0
       && (modal ? modal.innerHTML : '').indexOf('Ward 12') < 0);
  ok('[SBV2/FB] the subject prefix identifies THIS tool',
     EMBED_HTML.indexOf("subjectPrefix: '[IPG School Board Tool] '") >= 0);
  ok('[SBV2/FB] no credential ships (accessKey null, no token literal)',
     EMBED_HTML.indexOf('accessKey: null') >= 0);
  ok('[SBV2/FB] the destination cannot reach the editorial Sheet',
     EMBED_HTML.indexOf('sheets.googleapis.com') < 0
       && EMBED_HTML.indexOf('auth/spreadsheets') < 0
       && EMBED_HTML.indexOf('gspread') < 0
       && EMBED_HTML.indexOf('docs.google.com') < 0);
  ok('[SBV2/FB] NOTHING was POSTed by this fixture', POSTED === null, String(POSTED));

  // ======================================================================
  // SBFIN-1 / HALT-B — the finance surfaces.
  // ======================================================================
  var money = function (x) { return '$' + Math.round(x).toLocaleString('en-US'); };
  var finBy = function (seat) {
    return REALFIN.members.filter(function (m) { return m.seat === seat; })[0]; };
  // The embed's own default: most recent election first, All elections never default.
  var defaultElection = function (fm) {
    return Object.keys(fm.elections || {}).sort().reverse()[0]; };

  // ---- B.4: exactly TWO data fetches, enumerated -------------------------
  var gets = FETCHED.filter(function (u) { return u.indexOf('formspree') < 0; });
  var uniq = gets.filter(function (u, i) { return gets.indexOf(u) === i; });
  ok('[SBF/FETCH] exactly two distinct DATA fetches, no third target',
     uniq.length === 2, uniq.join(' | '));
  ok('[SBF/FETCH] both are school-board-family artifacts',
     uniq.every(function (u) {
       return /school-board-(data|finance)\.json$/.test(u); }), uniq.join(' | '));
  ok('[SBF/FETCH] the feedback endpoint is the only other target in the source',
     (EMBED_HTML.match(/https:\/\/[^"' ]+/g) || [])
       .filter(function (u) { return u.indexOf('raw.githubusercontent') < 0
                                  && u.indexOf('fonts.googleapis') < 0
                                  && u.indexOf('fonts.gstatic') < 0
                                  && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(u); })
       .every(function (u) { return u.indexOf('formspree.io') >= 0; }));

  // ---- the four member-page populations ---------------------------------
  // One page per ratified finance_state, so a regression in any one is visible.
  var mv = nav(mxv, 'member');
  var pFull = pick(mv, '4A');                                  // person-anchored, 13
  ok('[SBF/STATE] full: donor detail renders with tiles',
     pFull.html.indexOf('ipg-sb-stats') >= 0 && pFull.html.indexOf('ipg-sb-donor') >= 0);
  ok('[SBF/STATE] full: Raised equals the artifact direct amount for the DEFAULT election',
     pFull.text.indexOf(money(finBy('4A').elections['2026'].direct.amount)) >= 0);
  // The election filter is the ratified election-labeled control: driving it must
  // move every figure to that election's own numbers, unrecomputed.
  var pFull24 = setSel(pFull, 'ipg-sb-fin-el', '2024');
  ok('[SBF/ELECT] the election filter re-keys the figures to the chosen election',
     pFull24.text.indexOf(money(finBy('4A').elections['2024'].direct.amount)) >= 0
       && pFull24.text.indexOf(money(finBy('4A').elections['2026'].direct.amount)) < 0);
  ok('[SBF/SELF] self-funding renders in its OWN tile, not folded into Raised',
     pFull24.text.indexOf('Self-funding') >= 0
       && pFull24.text.indexOf(money(finBy('4A').elections['2024'].self_funding.amount)) >= 0
       && pFull24.text.indexOf(money(finBy('4A').elections['2024'].direct.amount
                                   + finBy('4A').elections['2024'].self_funding.amount)) < 0);
  // The old form asserted the WORD 'Independent' never appeared. Exit 1 requires the
  // view to state its own direct-only scope, so that sentence now legitimately contains
  // the word — and a word-absence test would have to be deleted or the sentence dropped.
  // Neither: the check now asserts what it always meant, that no IE FIGURE renders.
  ok('[SBF/STATE] member page is DIRECT-ONLY: no IE figure appears on it', (function () {
    var bad = [];
    REALFIN.members.forEach(function (m) {
      if (!m.elections) return;
      var pg = pick(mv, m.seat);
      Object.keys(m.elections).forEach(function (k) {
        var e = m.elections[k];
        [['ie_support', e.ie_support], ['ie_oppose', e.ie_oppose]].forEach(function (pr) {
          var amt = Number((pr[1] || {}).amount || 0);
          if (amt > 0 && pg.text.indexOf(money(amt)) >= 0) bad.push(m.seat + ' ' + k + ' ' + pr[0]);
        });
      });
    });
    return bad.length === 0;
  })());
  ok('[SBF/STATE] the member page states its own direct-only scope (exit 1)',
     pick(mv, '4A').text.indexOf('direct contributions only') >= 0);

  var pThin = pick(mv, '1A');                                  // totals-only, 3
  ok('[SBF/STATE] totals-only: the ratified thinness string renders',
     !!F2 && pThin.text.indexOf(F2) >= 0);
  ok('[SBF/STATE] totals-only: NO donor rows and NO Donors tile (not derivable)',
     pThin.html.indexOf('ipg-sb-donor') < 0 && pThin.html.indexOf('>Donors<') < 0);

  var pNone = pick(mv, '9A');                                  // no_record, 4
  ok('[SBF/STATE] no-record: the ratified no-record string renders',
     !!F1 && pNone.text.indexOf(F1) >= 0);
  ok('[SBF/STATE] no-record: no tiles, no bar, no donor rows',
     pNone.html.indexOf('ipg-sb-stats') < 0 && pNone.html.indexOf('ipg-sb-bar') < 0);

  var pVac = pick(mv, '10B');                                  // vacancy
  ok('[SBF/STATE] vacancy: a seat notice and NO finance section at all',
     pVac.html.indexOf('ipg-sb-fin') < 0 && pVac.text.indexOf('Vacant') >= 0);

  // ---- both threshold branches ------------------------------------------
  // 4A is measured above threshold and 6B below, on the REAL artifact — so both
  // branches are exercised by real data. The synthetic boot below then flips one
  // member, proving the branch follows the artifact's precomputed flag and is not
  // keyed to a member id or to a recomputation in the embed.
  ok('[SBF/BAR] above threshold: the bar renders with the disclosure line',
     pFull.html.indexOf('ipg-sb-bar-seg') >= 0
       && !!F3 && pFull.text.indexOf(around(F3, '{N}')[1]) >= 0);
  ok('[SBF/BAR] the SUPERSEDED string 3 no longer renders anywhere',
     !!F3OLD && pFull.text.indexOf(around(F3OLD, '{N}')[1]) < 0);
  // state.finElection persists across seat changes (pre-existing behaviour, and now
  // load-bearing because coverage is per-election), so the scope is set EXPLICITLY here
  // rather than inherited from whichever selector a previous check happened to drive.
  var pBelow = setSel(pick(mv, '6B'), 'ipg-sb-fin-el', defaultElection(finBy('6B')));
  ok('[SBF/BAR] below threshold: NO bar, and string 4 renders as the primary state',
     pBelow.html.indexOf('ipg-sb-bar-seg') < 0
       && !!F4 && pBelow.text.indexOf(around(F4, '{N}')[0]) >= 0);
  ok('[SBF/BAR] below-threshold copy carries the member’s own measured share',
     pBelow.text.indexOf(String(Math.round(
       finBy('6B').coverage_by_election[defaultElection(finBy('6B'))].substantive_share * 1000) / 10)
       + '% of donor dollars') >= 0);

  // ======================================================================
  // SBFIN-2 B.6 — the F1 repair, the labeled bar, the profile, the block, the footer.
  // ======================================================================

  // ---- F1, asserted on EVERY member and EVERY election ----
  // The defect was a donor list on one basis beside a Raised figure on another. This
  // walks every stored scope and asserts, from the RENDERED page, that the donor rows
  // shown sum to that election's direct figure — and that the self-funder is not among
  // them. SBF-9 asserts the same identity in the artifact; this asserts it survives the
  // render, which is where F1 actually lived.
  ok('[SBF2/F1] every rendered donor list sums to that election\'s direct figure', (function () {
    var bad = [];
    REALFIN.members.forEach(function (m) {
      if (m.finance_state !== 'full') return;
      Object.keys(m.elections).forEach(function (k) {
        var pg = setSel(pick(mv, m.seat), 'ipg-sb-fin-el', k);
        var rows = m.donors_by_election[k] || [];
        var sum = rows.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
        var direct = Number(m.elections[k].direct.amount || 0);
        if (Math.abs(sum - direct) > 0.005) { bad.push(m.seat + ' ' + k + ' artifact'); return; }
        // Raised renders, and the F1 basis (direct + self_funding) does NOT.
        var self = Number(m.elections[k].self_funding.amount || 0);
        if (pg.text.indexOf(money(direct)) < 0) bad.push(m.seat + ' ' + k + ' no-raised');
        if (self > 0 && pg.text.indexOf(money(direct + self)) >= 0)
          bad.push(m.seat + ' ' + k + ' F1-basis-rendered');
      });
    });
    return bad.length === 0;
  })(), 'offenders listed above');

  ok('[SBF2/F1] no self-funder appears as a donor row on any rendered page', (function () {
    var bad = [];
    REALFIN.members.forEach(function (m) {
      var ids = m.self_funder_donor_ids || [];
      if (!ids.length) return;
      Object.keys(m.elections || {}).forEach(function (k) {
        var pg = setSel(pick(mv, m.seat), 'ipg-sb-fin-el', k);
        ids.forEach(function (id) {
          if (pg.html.indexOf('data-donor="' + id + '"') >= 0) bad.push(m.seat + ' ' + k + ' ' + id);
        });
      });
    });
    return bad.length === 0;
  })());

  // The three census-named cases, by name, so a regression names itself.
  ok('[SBF2/F1] the three census cases render Raised, not Raised+self-funding', (function () {
    var cases = [['9A', 'Boyle'], ['5A', 'Blaise'], ['10A', 'Smith']];
    var seats = REALFIN.members.filter(function (m) {
      return /Boyle|Blaise|Rhymefest/.test(m.name || ''); });
    if (seats.length !== 3) return false;
    return seats.every(function (m) {
      var e = m.elections['2024']; if (!e) return false;
      var pg = setSel(pick(mv, m.seat), 'ipg-sb-fin-el', '2024');
      var d = Number(e.direct.amount || 0), sf = Number(e.self_funding.amount || 0);
      var rows = m.donors_by_election['2024'] || [];
      var sum = rows.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      return pg.text.indexOf(money(d)) >= 0
          && pg.text.indexOf(money(d + sf)) < 0
          && Math.abs(sum - d) < 0.005;
    });
  })());

  // ---- B.2: the bar filters in place, from segment AND legend, and toggles clear ----
  var pBar = setSel(pick(mv, '4A'), 'ipg-sb-fin-el', defaultElection(finBy('4A')));
  var segKey = (function () {
    var m = pBar.html.match(/class="ipg-sb-bar-seg" data-industry="([^"]+)"/); return m ? m[1] : null; })();
  ok('[SBF2/BAR] segments carry an industry key', !!segKey, String(segKey));
  var pSeg = (function () {
    var b = pBar.doc.querySelector('.ipg-sb-bar-seg[data-industry="' + segKey + '"]');
    b.onclick({ preventDefault: function () {}, stopPropagation: function () {} });
    return { doc: pBar.doc, app: pBar.app, html: pBar.app.innerHTML, text: pBar.app.textContent || '' };
  })();
  ok('[SBF2/BAR] clicking a SEGMENT filters the donor list in place',
     pSeg.text.indexOf('Donor list filtered to') >= 0 && pSeg.html.indexOf('ipg-sb-fin-clear') >= 0);
  ok('[SBF2/BAR] the filtered list contains only donors carrying that industry', (function () {
    var fm = finBy('4A'), k = defaultElection(fm);
    var want = (fm.donors_by_election[k] || []).filter(function (d) {
      return ((d.industries && d.industries.length) ? d.industries : ['unclassified']).indexOf(segKey) >= 0; });
    var shown = (pSeg.html.match(/data-donor="([^"]+)"/g) || []).map(function (x) {
      return x.slice(12, -1); });
    return shown.length > 0 && shown.every(function (id) {
      return want.some(function (d) { return d.donor_id === id; }); });
  })());
  var pSeg2 = (function () {
    var b = pSeg.doc.querySelector('.ipg-sb-bar-seg[data-industry="' + segKey + '"]');
    b.onclick({ preventDefault: function () {}, stopPropagation: function () {} });
    return { doc: pSeg.doc, app: pSeg.app, html: pSeg.app.innerHTML, text: pSeg.app.textContent || '' };
  })();
  ok('[SBF2/BAR] clicking the same segment again CLEARS the filter (toggle)',
     pSeg2.text.indexOf('Donor list filtered to') < 0);
  var pLeg = (function () {
    var b = pSeg2.doc.querySelector('.ipg-sb-legend-item[data-industry="' + segKey + '"]');
    b.onclick({ preventDefault: function () {}, stopPropagation: function () {} });
    return { doc: pSeg2.doc, app: pSeg2.app, html: pSeg2.app.innerHTML, text: pSeg2.app.textContent || '' };
  })();
  ok('[SBF2/BAR] the LEGEND row filters identically to the segment',
     pLeg.text.indexOf('Donor list filtered to') >= 0);
  (function () {
    var b = pLeg.doc.querySelector('.ipg-sb-legend-item[data-industry="' + segKey + '"]');
    b.onclick({ preventDefault: function () {}, stopPropagation: function () {} });
  })();
  ok('[SBF2/BAR] every segment label comes from the artifact vocabulary, never a raw key',
     (function () {
       var labels = (pBar.html.match(/<span class="l">([^<]+)<\/span>/g) || []);
       var vocab = Object.keys(REALFIN.industry_tags || {}).map(function (k) {
         return REALFIN.industry_tags[k].label; });
       return labels.length > 0 && labels.every(function (x) {
         return vocab.indexOf(x.replace(/<[^>]+>/g, '')) >= 0; });
     })());
  ok('[SBF2/BAR] the direct-only sentence renders with the bar (exit 1)',
     pBar.text.indexOf('direct contributions only') >= 0);
  ok('[SBF2/F11] the self-funding-tag string renders exactly where that tag is charted',
     (function () {
       var bad = [];
       REALFIN.members.forEach(function (m) {
         if (m.finance_state !== 'full') return;
         Object.keys(m.elections).forEach(function (k) {
           var cov = (m.coverage_by_election || {})[k];
           if (!cov || !cov.meets_industry_threshold) return;
           var rows = m.donors_by_election[k] || [];
           var has = rows.some(function (d) { return (d.industries || []).indexOf('self-funding') >= 0; });
           var pg = setSel(pick(mv, m.seat), 'ipg-sb-fin-el', k);
           var shown = pg.text.indexOf(F7) >= 0;
           if (has !== shown) bad.push(m.seat + ' ' + k + ' has=' + has + ' shown=' + shown);
         });
       });
       return bad.length === 0;
     })());

  // ---- ratification 4: All elections ----
  var pAll = setSel(pick(mv, '4A'), 'ipg-sb-fin-el', 'all');
  ok('[SBF2/ALL] All elections is an option and is NOT the default',
     pBar.html.indexOf('value="all"') >= 0
       && pBar.html.indexOf('value="all" selected') < 0);
  ok('[SBF2/ALL] its ratified disclosure renders whenever it is active',
     !!F6 && pAll.text.indexOf(F6) >= 0
       && pBar.text.indexOf(F6) < 0);
  ok('[SBF2/ALL] Raised is the sum of the member\'s own elections, one stream only',
     (function () {
       var fm = finBy('4A');
       var d = Object.keys(fm.elections).reduce(function (a, k) {
         return a + Number(fm.elections[k].direct.amount || 0); }, 0);
       return pAll.text.indexOf(money(d)) >= 0;
     })());
  ok('[SBF2/ALL] the Donors tile is DISTINCT donors, not the sum of per-election counts',
     (function () {
       var fm = finBy('4A'), ids = {}, perElection = 0;
       Object.keys(fm.donors_by_election).forEach(function (k) {
         (fm.donors_by_election[k] || []).forEach(function (d) { ids[d.donor_id] = 1; perElection++; });
       });
       var distinct = Object.keys(ids).length;
       return distinct < perElection && pAll.html.indexOf('>' + distinct + '</div><div class="l">Donors<') >= 0;
     })());

  // ---- B.3: the donor profile ----
  // Re-establish the scope explicitly: the All-elections checks above left state.finElection
  // on 'all', and the profile is scoped to whatever is active — which is the point of the
  // check below, so it must be set rather than inherited.
  var pDef = setSel(pick(mv, '4A'), 'ipg-sb-fin-el', defaultElection(finBy('4A')));
  var firstDonor = (function () { var m = pDef.html.match(/data-donor="([^"]+)"/); return m ? m[1] : null; })();
  var pProf = (function () {
    var b = pDef.doc.querySelector('[data-donor="' + firstDonor + '"]');
    b.onclick();
    return { doc: pDef.doc, app: pDef.app, html: pDef.app.innerHTML, text: pDef.app.textContent || '' };
  })();
  ok('[SBF2/PROFILE] a donor row opens the profile', !!firstDonor
     && pProf.html.indexOf('ipg-sb-donor-overlay') >= 0
     && pProf.text.indexOf('Donor profile') >= 0);
  ok('[SBF2/PROFILE] every itemized row renders with an ISO-sourced date', (function () {
    var fm = finBy('4A'), k = defaultElection(fm);
    var row = (fm.donors_by_election[k] || []).filter(function (d) {
      return d.donor_id === firstDonor; })[0];
    if (!row || !row.items.length) return false;
    var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return row.items.every(function (it) {
      var m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.date);
      return pProf.text.indexOf(MON[Number(m2[2]) - 1] + ' ' + Number(m2[3]) + ', ' + m2[1]) >= 0;
    });
  })());
  ok('[SBF2/PROFILE] the profile is scoped to the active election', (function () {
    var fm = finBy('4A'), k = defaultElection(fm);
    var row = (fm.donors_by_election[k] || []).filter(function (d) {
      return d.donor_id === firstDonor; })[0];
    return !!row && pProf.text.indexOf(money(row.amount)) >= 0;
  })());
  ok('[SBF2/PROFILE] NO self-funding chip can render (no itemized row carries is_self)',
     pProf.html.indexOf('ipg-sb-ichip') < 0 || pProf.text.indexOf('self-funding') < 0);
  ok('[SBF2/PROFILE] chips use the ratified elections vocabulary where the flag is present',
     (function () {
       var anyInKind = false;
       REALFIN.members.forEach(function (m) {
         Object.keys(m.donors_by_election || {}).forEach(function (k) {
           (m.donors_by_election[k] || []).forEach(function (d) {
             (d.items || []).forEach(function (it) { if (it.is_in_kind) anyInKind = true; }); }); }); });
       return anyInKind;   // the vocabulary has a live case in the data
     })());
  (function () { var cb = pProf.doc.getElementById('ipg-sb-donor-close'); if (cb) cb.onclick(); })();

  // ---- B.4: the Verified block, WITHOUT a link ----
  var pVer = pick(mv, '4A');
  ok('[SBF2/VERIFIED] the banner, the filed committee name and the source date render',
     pVer.text.indexOf('Verified · Illinois State Board of Elections') >= 0
       && pVer.text.indexOf(finBy('4A').committees[0].name) >= 0
       && pVer.text.indexOf('Updated ' + finBy('4A').committees[0].last_updated) >= 0);
  ok('[SBF2/VERIFIED] NO Sunshine link is shipped, anywhere in the embed (ratification 5)',
     EMBED_HTML.indexOf('illinoissunshine') < 0);
  ok('[SBF2/VERIFIED] the banner is gated on data_quality, not assumed',
     REALFIN.members.every(function (m) {
       return (m.committees || []).every(function (c) { return c.data_quality === 'REAL'; }); }));

  // ---- B.5: the ratified footer, on EVERY tab ----
  ok('[SBF2/FOOTER] the ratified sentence renders on every tab, verbatim', (function () {
    var want = 'We\u2019re committed to keeping this data as accurate as possible. If you have '
      + 'questions about our data sources and methodology, a full methodology page is on the way. '
      + 'If you spot an error in the data or a visualization, have something to add, or hit a bug, '
      + 'click here to let us know.';
    var tabs = ['member', 'record', 'matrix', 'spend', 'methodology'], missing = [];
    tabs.forEach(function (t) {
      var pg = nav(mxv, t);
      if (pg.text.replace(/\s+/g, ' ').indexOf(want) < 0) missing.push(t);
    });
    return missing.length === 0;
  })());
  ok('[SBF2/FOOTER] its trigger is wired to the existing feedback flow',
     nav(mxv, 'member').html.indexOf('ipg-sb-fb-inline ipg-sb-fb-btn') >= 0);
  ok('[SBF2/FOOTER] methodologyUrl is a real key, not a hardcoded branch (F8)',
     /methodologyUrl\s*:/.test(EMBED_HTML));

  // ---- the two-step replace, closed at the render layer ----
  ok('[SBF2/CLOSED] the embed reads NO flat donors/coverage key',
     !/fm\.donors\b/.test(EMBED_HTML) && !/fm\.coverage\b/.test(EMBED_HTML));
  ok('[SBF2/CLOSED] the artifact carries no superseded_keys and no flat pair',
     !('superseded_keys' in REALFIN)
       && REALFIN.members.every(function (m) {
            return !('donors' in m) && !('coverage' in m); }));

  var mv2 = nav(mxv, 'member');
  var flipped = JSON.parse(JSON.stringify(REALFIN));
  flipped.members.forEach(function (m) {
    if (m.seat === '6B' && m.coverage_by_election) {
      Object.keys(m.coverage_by_election).forEach(function (k) {
        m.coverage_by_election[k].substantive_share = 0.91;
        m.coverage_by_election[k].meets_industry_threshold = true; }); }
  });
  FIN = flipped;
  var vflip = await boot(REAL, 'ok');
  var pFlip = pick(vflip, '6B');
  ok('[SBF/BAR] the branch follows the artifact flag, not the member',
     pFlip.html.indexOf('ipg-sb-bar-seg') >= 0 && pFlip.text.indexOf('91%') >= 0);
  FIN = REALFIN;

  // ---- B.2 Spend by member: the never-summed structural assert -----------
  var sv0 = nav(pick(vflip, '4A'), 'spend');
  var sv = setSel(sv0, 'ipg-sb-spend-el', '2024');
  ok('[SBF/SPEND] the view renders three labeled streams',
     sv.text.indexOf('Direct contributions') >= 0
       && sv.text.indexOf('Independent — for') >= 0
       && sv.text.indexOf('Independent — against') >= 0);
  ok('[SBF/SPEND] independent scales are DISCLOSED, not implied',
     sv.text.indexOf('Each stream has its own scale') >= 0);
  ok('[SBF/SPEND] the never-summed sentence renders',
     sv.text.indexOf('never added together') >= 0);
  ok('[SBF/SPEND] rows are sorted by DIRECT alone', (function () {
    var amts = [].slice.call(sv.doc.querySelectorAll('.ipg-sb-spend-amt'))
      .map(function (e) { return Number(String(e.textContent).replace(/[$,]/g, '')); });
    for (var i = 1; i < amts.length; i++) { if (amts[i] > amts[i - 1]) return false; }
    return amts.length > 0;
  })());
  ok('[SBF/SPEND] rows with no IE carry the row-grain empty state',
     sv.text.indexOf('No independent spending recorded.') >= 0);

  // THE assert the council's own Spend-by-Alder surface does not have: for every
  // rendered row, the right-hand amount is DIRECT ALONE, and no rendered figure
  // anywhere equals any sum of two or more of that row's streams.
  ok('[SBF/NEVERSUM] every row amount is direct alone, and no fused figure renders', (function () {
    var rows = [].slice.call(sv.doc.querySelectorAll('.ipg-sb-spend-row'));
    if (!rows.length) return false;
    for (var i = 0; i < rows.length; i++) {
      var seat = rows[i].getAttribute('data-spend-seat');
      var fm = finBy(seat); if (!fm) return false;
      var e = fm.elections['2024'];
      if (!e) return false;
      var d = Number(e.direct.amount || 0), s = Number(e.ie_support.amount || 0),
          o = Number(e.ie_oppose.amount || 0);
      var amt = String(rows[i].querySelector('.ipg-sb-spend-amt').textContent).trim();
      if (amt !== money(d)) return false;                        // direct alone
      var txt = rows[i].textContent;
      var sums = [d + s, d + o, s + o, d + s + o].filter(function (x) { return x > 0; });
      for (var j = 0; j < sums.length; j++) {
        // A sum is only a violation if it is not itself one of the three stream values.
        if ([d, s, o].indexOf(sums[j]) >= 0) continue;
        if (txt.indexOf(money(sums[j])) >= 0) return false;
      }
    }
    return true;
  })());
  ok('[SBF/NEVERSUM] the embed source contains no expression adding two streams',
     !/ie_support[^;]*\+[^;]*ie_oppose|direct[^;]*\+[^;]*ie_(support|oppose)|\.sup\s*\+\s*\w*\.?opp/.test(EMBED_HTML));

  // ======================================================================
  // SBFIN-2 C.4 — Political Spend: Browse donors, Industry totals,
  // Industries by member. All three are render-time derivations.
  // ======================================================================
  var subtab = function (v, key) {
    var b = v.doc.querySelector('[data-spendsub="' + key + '"]');
    b.onclick();
    return { doc: v.doc, app: v.app, html: v.app.innerHTML, text: v.app.textContent || '' };
  };
  var spv = nav(mxv, 'spend');
  var spendEK = (function () {
    var e = {};
    REALFIN.members.forEach(function (m) {
      Object.keys(m.elections || {}).forEach(function (k) { e[k] = 1; }); });
    return Object.keys(e).sort().reverse()[0];
  })();
  // Every donor row on the board for that election — the single source all three group.
  var boardRows = (function () {
    var out = [];
    REALFIN.members.forEach(function (m) {
      ((m.donors_by_election || {})[spendEK] || []).forEach(function (d) { out.push({ m: m, d: d }); }); });
    return out;
  })();

  ok('[SBF2/SPEND] the tab carries four sub-tabs and Flag totals is NOT among them',
     ['members', 'donors', 'industries', 'mix'].every(function (k) {
       return spv.html.indexOf('data-spendsub="' + k + '"') >= 0; })
       && spv.text.indexOf('Flag totals') < 0);
  ok('[SBF2/SPEND] Spend by member is the LANDING sub-tab, so [SBF/NEVERSUM] keeps its path',
     /class="ipg-sb-subtab active" data-spendsub="members"/.test(spv.html)
       && spv.html.indexOf('ipg-sb-spend-row') >= 0);

  // ---- C.1 Browse donors ----
  var pBd = subtab(spv, 'donors');
  ok('[SBF2/BROWSE] the list is rollup-first and ranks by dollars given', (function () {
    var fams = {}, singles = {};
    boardRows.forEach(function (x) {
      if (x.d.cluster_id) fams[x.d.cluster_id] = 1; else singles[x.d.donor_id] = 1; });
    var expected = Object.keys(fams).length + Object.keys(singles).length;
    // The rendered page shows the top 25; the count line reports the whole set.
    return pBd.text.indexOf(expected + ' results matched.') >= 0;
  })());
  // RETIRED at SBFIN-3 B: '[SBF2/BROWSE] it states its own direct-only scope'. The
  // sentence it asserted was removed because IE spenders now appear in this list, which
  // made it false. Replaced by the mixed-list check below — not dropped.
  ok('[SBF3/BROWSE] the mixed list says what it contains (the retired sentence\'s successor)',
     pBd.text.indexOf('This list mixes two kinds of money') >= 0
       && pBd.text.indexOf('Independent spending is not shown here') < 0);
  ok('[SBF2/BROWSE] NO flag filter is offered (Flag totals is banked)',
     pBd.html.indexOf('ipg-sb-bd-q') >= 0 && pBd.html.indexOf('ipg-sb-bd-type') >= 0
       && pBd.html.indexOf('ipg-sb-bd-ind') >= 0 && pBd.html.indexOf('ipg-sb-bd-flag') < 0);
  // RETIRED at SBFIN-3 B: '[SBF2/BROWSE] NO IE-PAC row kind appears'. It encoded planner
  // error 48 — exit 1 applied to a surface it was never ratified for — and excluding the
  // two committees hid $1,185,635.74 from the view whose purpose is who spent the most.
  // Its inverse is now asserted, on the election that actually has IE.
  var pBdQ = (function () {
    var q = pBd.doc.getElementById('ipg-sb-bd-q');
    q.value = 'chicago teachers'; q.oninput();
    return { doc: pBd.doc, app: pBd.app, html: pBd.app.innerHTML, text: pBd.app.textContent || '' };
  })();
  ok('[SBF2/BROWSE] search narrows the list and every shown row matches', (function () {
    var ids = (pBdQ.html.match(/data-donor="([^"]+)"/g) || []).map(function (x) { return x.slice(12, -1); });
    if (!ids.length) return false;
    return ids.every(function (id) {
      return boardRows.some(function (x) {
        if (x.d.donor_id !== id) return false;
        var fam = x.d.cluster_id ? (REALFIN.donor_clusters || {})[x.d.cluster_id] : null;
        var nm = String((fam && fam.name) || x.d.name || '').toLowerCase();
        return nm.indexOf('chicago teachers') >= 0; });
    });
  })());
  (function () { var c = pBdQ.doc.getElementById('ipg-sb-bd-clear'); if (c) c.onclick(); })();
  var pBd2 = { doc: pBd.doc, app: pBd.app, html: pBd.app.innerHTML, text: pBd.app.textContent || '' };
  ok('[SBF2/BROWSE] a donor row opens the SAME profile the member page opens', (function () {
    var id = (pBd2.html.match(/data-donor="([^"]+)"/) || [])[1];
    if (!id) return false;
    pBd2.doc.querySelector('[data-donor="' + id + '"]').onclick();
    var t = pBd2.app.textContent || '';
    return t.indexOf('Donor profile') >= 0 && t.indexOf('Board members funded') >= 0;
  })());
  (function () { var cb = pBd2.doc.getElementById('ipg-sb-donor-close'); if (cb) cb.onclick(); })();

  // ---- C.2 Industry totals ----
  var pInd = subtab({ doc: spv.doc, app: spv.app }, 'industries');
  // FORM CHANGED, name retired: '[SBF2/INDUSTRY] it states its own direct-only scope'.
  // Industry Totals now carries IE (carve (a), election-wide), so the direct-only sentence
  // was false there. The two-classifier disclosure replaces it and asserts more: that a
  // reader is told the segments come from two different classifiers.
  ok('[SBF3/INDUSTRY] the two-classifier disclosure replaces the direct-only sentence',
     pInd.text.indexOf('Direct segments are attributed by the donor') >= 0
       && pInd.text.indexOf('these totals are direct contributions only') < 0);
  ok('[SBF2/INDUSTRY] the totals equal the same money the member pages carry', (function () {
    // 0 donor rows carry more than one industry in this universe, so the industry sum is
    // the donor-row sum, which is each member's own direct figure for this election.
    var multi = boardRows.filter(function (x) { return (x.d.industries || []).length > 1; }).length;
    var rowSum = boardRows.reduce(function (a, x) { return a + Number(x.d.amount || 0); }, 0);
    var directSum = REALFIN.members.reduce(function (a, m) {
      var has = ((m.donors_by_election || {})[spendEK] || []).length;
      return a + (has ? Number(((m.elections || {})[spendEK] || {}).direct.amount || 0) : 0); }, 0);
    return multi === 0 && Math.abs(rowSum - directSum) < 0.005
        && pInd.text.indexOf(money(rowSum)) >= 0;
  })());
  ok('[SBF2/INDUSTRY] every label comes from the artifact vocabulary, never a raw key',
     (function () {
       var vocab = Object.keys(REALFIN.industry_tags || {}).map(function (k) {
         return REALFIN.industry_tags[k].label; });
       var keys = Object.keys(REALFIN.industry_tags || {});
       // No raw key may appear as rendered text where its label differs from it.
       return keys.every(function (k) {
         var lab = REALFIN.industry_tags[k].label;
         return lab === k || pInd.text.indexOf('>' + k + '<') < 0;
       }) && vocab.some(function (l) { return pInd.text.indexOf(l) >= 0; });
     })());
  var pDrill = (function () {
    var k = (pInd.html.match(/data-industry-drill="([^"]+)"/) || [])[1];
    pInd.doc.querySelector('[data-industry-drill="' + k + '"]').onclick();
    return { key: k, doc: pInd.doc, app: pInd.app,
             html: pInd.app.innerHTML, text: pInd.app.textContent || '' };
  })();
  ok('[SBF2/INDUSTRY] drilling shows that industry\'s donors AND the members they funded',
     pDrill.text.indexOf('Donors in this industry') >= 0
       && pDrill.text.indexOf('Members they funded') >= 0
       && pDrill.text.indexOf('these totals are direct contributions only') >= 0);
  ok('[SBF2/INDUSTRY] the drill lists exactly the donors carrying that industry', (function () {
    var want = {};
    boardRows.forEach(function (x) {
      if (((x.d.industries && x.d.industries.length) ? x.d.industries : ['unclassified'])
          .indexOf(pDrill.key) >= 0) want[x.d.donor_id] = 1; });
    var shown = (pDrill.html.match(/data-donor="([^"]+)"/g) || []).map(function (x) { return x.slice(12, -1); });
    return shown.length > 0 && shown.every(function (id) { return want[id]; });
  })());
  (function () { var b = pDrill.doc.getElementById('ipg-sb-ind-back'); if (b) b.onclick(); })();

  // ---- C.3 Industries by member ----
  var pMix = subtab({ doc: spv.doc, app: spv.app }, 'mix');
  ok('[SBF2/MIX] it states its own direct-only scope in its own sentence (exit 1)',
     pMix.text.indexOf('independent spending is not included here') >= 0);
  ok('[SBF2/MIX] one row per member that has donor rows in this election', (function () {
    var expect = REALFIN.members.filter(function (m) {
      return ((m.donors_by_election || {})[spendEK] || []).length > 0; }).length;
    return (pMix.html.match(/ipg-sb-mixrow/g) || []).length === expect;
  })());
  ok('[SBF2/MIX] rows are in SEAT order, never a string sort (10A after 2A)', (function () {
    var seats = (pMix.html.match(/data-spend-seat="([^"]+)"/g) || []).map(function (x) { return x.slice(17, -1); });
    var roster = REALFIN.members.filter(function (m) {
      return ((m.donors_by_election || {})[spendEK] || []).length > 0; }).map(function (m) { return m.seat; });
    return seats.length === roster.length && seats.every(function (x, i) { return x === roster[i]; })
        && seats.join(',') !== seats.slice().sort().join(',');
  })());
  ok('[SBF2/MIX] segments are STATIC — no member\'s bar filters another member\'s list',
     pMix.html.indexOf('ipg-sb-bar-seg static') >= 0
       && (pMix.html.match(/ipg-sb-bar-seg static[^>]*data-industry/g) || []).length === 0);
  ok('[SBF2/MIX] the Verified pill is gated on data_quality', (function () {
    var expect = REALFIN.members.filter(function (m) {
      return ((m.donors_by_election || {})[spendEK] || []).length > 0
          && ((m.committees || [])[0] || {}).data_quality === 'REAL'; }).length;
    return (pMix.html.match(/ipg-sb-verified-pill/g) || []).length === expect;
  })());
  ok('[SBF2/MIX] a row opens that member\'s page', (function () {
    var seat = (pMix.html.match(/data-spend-seat="([^"]+)"/) || [])[1];
    pMix.doc.querySelector('[data-spend-seat="' + seat + '"]').onclick();
    var t = pMix.app.textContent || '';
    return t.indexOf('Campaign finance') >= 0 && t.indexOf('Seat ' + seat) >= 0;
  })());

  // ---- no fused figure anywhere in the three new views ----
  // FORM CHANGED, name retired at SBFIN-3 B: '[SBF2/SPEND] no IE figure renders on any of
  // the three new sub-tabs'. Two of those three now carry IE by ratification, and the
  // check survived the change ONLY because the default election (2026) has no IE at all —
  // it had quietly stopped asserting what it said. Narrowed to the one sub-tab that is
  // still per-member, and the general prohibition moved to [SBF3/AMEND]'s by-figure walk.
  ok('[SBF3/SPEND] no IE figure renders on Industries by member (a per-member surface)', (function () {
    var sv = nav(mxv, 'spend'), bad = [];
    ['mix'].forEach(function (k) {
      var pg = subtab({ doc: sv.doc, app: sv.app }, k);
      REALFIN.members.forEach(function (m) {
        var e = (m.elections || {})[spendEK]; if (!e) return;
        [e.ie_support, e.ie_oppose].forEach(function (st) {
          var amt = Number((st || {}).amount || 0);
          if (amt > 0 && pg.text.indexOf(money(amt)) >= 0) bad.push(k + ' ' + m.seat);
        });
        var d = Number(e.direct.amount || 0), sf = Number(e.self_funding.amount || 0);
        if (sf > 0 && pg.text.indexOf(money(d + sf)) >= 0) bad.push(k + ' ' + m.seat + ' fused');
      });
    });
    return bad.length === 0;
  })());
  // ======================================================================
  // SBFIN-3 B.5 — THE SCOPED [SBF/NEVERSUM] AMENDMENT.
  //
  // The rule, verbatim and in force:
  //
  //   Fusion of money streams is FORBIDDEN on any per-member or per-candidate surface,
  //   without exception. It is permitted in exactly two scopes: (a) election-wide
  //   aggregates and (b) a single spender's own spend. Where permitted, every part must
  //   be separately labeled and the fused label must name deployment ("total deployed"),
  //   never "independent". The per-member prohibition is asserted per member per election,
  //   by figure; the two carves are asserted to occur only on the surfaces that own them.
  //
  // The amendment TIGHTENS the per-member case — it must now be walked by figure on every
  // surface, not only Spend by member — and carves exactly two holes with a stated rule.
  // Any future request to widen it is a finding, not an edit.
  //
  // ONE HONEST LIMIT, stated rather than implied. The pre-existing source check
  // '[SBF/NEVERSUM] the embed source contains no expression adding two streams' matches on
  // the ARTIFACT's field names (ie_support / ie_oppose). SBFIN-3's permitted fusions read
  // `sp.support.amount` and `x.direct`, so that regex does not fire on them — it proves
  // less than its wording suggests. It is KEPT because what it does prove is still true
  // and useful, and the per-member prohibition is now carried by the by-figure walk below,
  // which is what the amendment actually requires.
  // ======================================================================
  var ieEK = (function () {
    var k = null;
    Object.keys(REALFIN.ie_spenders || {}).forEach(function (e) { if (!k) k = e; });
    return k;
  })();
  ok('[SBF3/AMEND] the IE election under test is the one that has IE',
     !!ieEK && (REALFIN.ie_spenders[ieEK] || []).length > 0, String(ieEK));

  // ---- the prohibition: NO per-member fused figure, on EVERY surface, by figure ----
  // The prohibition, walked BY FIGURE and scoped to the member in view. Scoping matters:
  // a first draft compared every member's fused combinations against every surface and
  // fired on a pure numeric coincidence — seat 2B's 2024 direct+self is $1,000 and seat
  // 1B's own self-funding tile legitimately shows $1,000. A cross-member collision is not
  // a fusion, so each surface is checked against the member it actually presents, exactly
  // as [SBF/NEVERSUM] already does row by row.
  function fusedCombos(m, k) {
    var e = (m.elections || {})[k]; if (!e) return [];
    var d = Number(e.direct.amount || 0), sf = Number(e.self_funding.amount || 0),
        su = Number(e.ie_support.amount || 0), op = Number(e.ie_oppose.amount || 0);
    var singles = [d, sf, su, op];
    return [[d + sf, 'direct+self'], [d + su, 'direct+support'], [d + op, 'direct+oppose'],
            [su + op, 'support+oppose'], [d + su + op, 'all three']]
      .filter(function (pr) {
        return pr[0] > 0 && !singles.some(function (v) { return Math.abs(v - pr[0]) < 0.005; }); });
  }
  ok('[SBF3/AMEND] no per-member fused figure renders on any per-member surface', (function () {
    var bad = [];
    // (i) every member page, at every one of that member's election scopes.
    var mvx = nav(mxv, 'member');
    REALFIN.members.forEach(function (m) {
      Object.keys(m.elections || {}).forEach(function (k) {
        var pg = trySel(pick(mvx, m.seat), 'ipg-sb-fin-el', k);
        fusedCombos(m, k).forEach(function (pr) {
          if (pg.text.indexOf(money(pr[0])) >= 0)
            bad.push('member ' + m.seat + ' ' + k + ' ' + pr[1]);
        });
      });
    });
    // (ii) the two per-member surfaces inside Political Spend, ROW-scoped.
    ['members', 'mix'].forEach(function (sub) {
      var pg = trySel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, sub),
                      'ipg-sb-spend-el', ieEK);
      var rows = [].slice.call(pg.doc.querySelectorAll('[data-spend-seat]'));
      rows.forEach(function (el) {
        var seat = el.getAttribute('data-spend-seat');
        var m = REALFIN.members.filter(function (x) { return x.seat === seat; })[0];
        if (!m) return;
        var txt = el.textContent || '';
        fusedCombos(m, ieEK).forEach(function (pr) {
          if (txt.indexOf(money(pr[0])) >= 0) bad.push('spend/' + sub + ' ' + seat + ' ' + pr[1]);
        });
      });
    });
    if (bad.length) console.log('        ' + bad.slice(0, 8).join('\n        '));
    return bad.length === 0;
  })());

  // ---- carve (b): a single spender's own spend, ONLY where it belongs ----
  var spBd = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, 'donors'),
                    'ipg-sb-spend-el', ieEK);
  ok('[SBF3/BROWSE] IE spenders appear as rows in the SAME ranked list', (function () {
    var ids = (spBd.html.match(/data-ie="([^"]+)"/g) || []).map(function (x) { return x.slice(9, -1); });
    return ids.length === (REALFIN.ie_spenders[ieEK] || []).length && ids.length > 0;
  })());
  ok('[SBF3/BROWSE] the row amount is support+oppose, and it is the ordering key', (function () {
    var sps = REALFIN.ie_spenders[ieEK] || [];
    var okAll = sps.every(function (sp) {
      return spBd.text.indexOf(money(sp.support.amount + sp.oppose.amount)) >= 0; });
    // ordering: the whole list is descending by displayed amount
    var amts = (spBd.html.match(/<div class="a">\$([0-9,]+)<\/div>/g) || [])
      .map(function (x) { return Number(x.replace(/[^0-9]/g, '')); });
    var sorted = amts.slice().sort(function (a, b) { return b - a; });
    return okAll && amts.join(',') === sorted.join(',');
  })());
  ok('[SBF3/BROWSE] the split is visible on the row, both parts labeled', (function () {
    var sps = REALFIN.ie_spenders[ieEK] || [];
    return sps.every(function (sp) {
      var okS = sp.support.amount <= 0 || spBd.text.indexOf(money(sp.support.amount) + ' for') >= 0;
      var okO = sp.oppose.amount <= 0 || spBd.text.indexOf(money(sp.oppose.amount) + ' against') >= 0;
      return okS && okO; });
  })());
  var spDetail = (function () {
    var id = (spBd.html.match(/data-ie="([^"]+)"/) || [])[1];
    spBd.doc.querySelector('[data-ie="' + id + '"]').onclick();
    return { id: id, doc: spBd.doc, app: spBd.app,
             html: spBd.app.innerHTML, text: spBd.app.textContent || '' };
  })();
  ok('[SBF3/IE] the row opens the IE detail view', spDetail.html.indexOf('ipg-sb-ie-overlay') >= 0
     && spDetail.text.indexOf('Independent-expenditure committee') >= 0);
  ok('[SBF3/IE] support and oppose render as SEPARATE figures', (function () {
    var sp = (REALFIN.ie_spenders[ieEK] || []).filter(function (x) {
      return x.committee_id === spDetail.id; })[0];
    return !!sp && spDetail.text.indexOf(money(sp.support.amount)) >= 0
        && spDetail.text.indexOf(money(sp.oppose.amount)) >= 0;
  })());
  ok('[SBF3/IE] the fused figure is labeled "total deployed", never "independent"',
     spDetail.text.indexOf('total deployed') >= 0
       && /total deployed/.test(spDetail.text)
       && spDetail.text.indexOf('independent deployed') < 0);
  ok('[SBF3/IE] every targeted member is listed, with both streams separately', (function () {
    var sp = (REALFIN.ie_spenders[ieEK] || []).filter(function (x) {
      return x.committee_id === spDetail.id; })[0];
    return !!sp && (sp.targets || []).every(function (t) {
      return spDetail.text.indexOf('Seat ' + t.seat) >= 0
          && spDetail.text.indexOf(money(t.support.amount)) >= 0
          && spDetail.text.indexOf(money(t.oppose.amount)) >= 0; });
  })());
  (function () { var b = spDetail.doc.getElementById('ipg-sb-ie-close'); if (b) b.onclick(); })();

  // ---- carve (a): election-wide aggregate, parts summing EXACTLY to the displayed total ----
  var spInd = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, 'industries'),
                     'ipg-sb-spend-el', ieEK);
  ok('[SBF3/INDUSTRY] three labeled segments render where all three streams exist', (function () {
    return spInd.text.indexOf('Direct ') >= 0
        && spInd.text.indexOf('Independent support ') >= 0
        && spInd.text.indexOf('Independent opposition ') >= 0;
  })());
  ok('[SBF3/INDUSTRY] the headline is "total deployed", never "independent"',
     spInd.text.indexOf('total deployed') >= 0);
  ok('[SBF3/INDUSTRY] the displayed parts sum EXACTLY to the displayed total (largest-remainder)',
     (function () {
       var rows = spInd.html.split('ipg-sb-indrow-top').slice(1);
       if (!rows.length) return false;
       var bad = [];
       rows.forEach(function (chunk) {
         var tot = (chunk.match(/<span class="a">\$([0-9,]+)/) || [])[1];
         if (!tot) return;
         var parts = (chunk.match(/class="ipg-sb-bd [^"]*">[^$]*\$([0-9,]+)</g) || [])
           .map(function (x) { return Number((x.match(/\$([0-9,]+)/) || [])[1].replace(/,/g, '')); });
         var sum = parts.reduce(function (a, b) { return a + b; }, 0);
         if (parts.length && sum !== Number(tot.replace(/,/g, ''))) bad.push(tot + ' vs ' + sum);
       });
       if (bad.length) console.log('        ' + bad.join('\n        '));
       return bad.length === 0;
     })());
  ok('[SBF3/INDUSTRY] the IE money is actually in the totals (charter-schools carries it)',
     (function () {
       var sps = REALFIN.ie_spenders[ieEK] || [];
       var su = sps.reduce(function (a, x) { return a + Number(x.support.amount || 0); }, 0);
       var op = sps.reduce(function (a, x) { return a + Number(x.oppose.amount || 0); }, 0);
       return spInd.text.indexOf(String(Math.round(su).toLocaleString('en-US'))) >= 0
           && spInd.text.indexOf(String(Math.round(op).toLocaleString('en-US'))) >= 0;
     })());

  // ---- the member-page bar stays DIRECT-ONLY (exit 1 still holds where it was ratified) ----
  ok('[SBF3/AMEND] the member-page industry bar is still direct-only', (function () {
    var mvy = nav(mxv, 'member');
    var pg = setSel(pick(mvy, '4A'), 'ipg-sb-fin-el', defaultElection(finBy('4A')));
    return pg.text.indexOf('direct contributions only') >= 0
        && pg.text.indexOf('total deployed') < 0;
  })());

  // ---- the two carves occur ONLY on the surfaces that own them ----
  ok('[SBF3/AMEND] "total deployed" appears on NO per-member surface', (function () {
    var bad = [], mvz = nav(mxv, 'member');
    REALFIN.members.forEach(function (m) {
      var pg = pick(mvz, m.seat);
      if (pg.text.indexOf('total deployed') >= 0) bad.push(m.seat);
    });
    var mix = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, 'mix'),
                     'ipg-sb-spend-el', ieEK);
    if (mix.text.indexOf('total deployed') >= 0) bad.push('spend/mix');
    var sbm = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, 'members'),
                     'ipg-sb-spend-el', ieEK);
    if (sbm.text.indexOf('total deployed') >= 0) bad.push('spend/members');
    return bad.length === 0;
  })());

  // ---- B.4: the label bug's regression ----
  ok('[SBF3/LABEL] no cross-member view renders a district in its election control', (function () {
    var bad = [];
    ['members', 'donors', 'industries', 'mix'].forEach(function (sub) {
      var pg = subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, sub);
      var sel = pg.html.split('id="ipg-sb-spend-el"')[1];
      if (sel && /District/.test(sel.split('</select>')[0])) bad.push(sub);
    });
    return bad.length === 0;
  })());
  ok('[SBF3/LABEL] the control reads the artifact\'s election-wide labels',
     Object.keys(REALFIN.election_labels || {}).every(function (k) {
       return !/District/.test(REALFIN.election_labels[k]); })
       && Object.keys(REALFIN.election_labels || {}).length > 0);
  ok('[SBF3/LABEL] the member page still shows its OWN per-member label (line 1171 untouched)',
     (function () {
       var m = REALFIN.members.filter(function (x) {
         return Object.keys(x.elections || {}).some(function (k) {
           return /District/.test(x.elections[k].label || ''); }); })[0];
       if (!m) return false;
       var k = Object.keys(m.elections).filter(function (kk) {
         return /District/.test(m.elections[kk].label); })[0];
       var pg = trySel(pick(nav(mxv, 'member'), m.seat), 'ipg-sb-fin-el', k);
       return pg.text.indexOf(m.elections[k].label) >= 0;
     })());

  // ---- needs_review is MINTED, never surfaced (Ishan's ruling at SBFIN-3 A review) ----
  // Reopening condition: ingest_ie distinguishing a unique-but-inexact resolution from a
  // genuine collision. Today Rung 2 flags unconditionally, so the flag cannot tell a
  // missing middle initial from a two-candidate ambiguity — which is why it is not shown.
  ok('[SBF3/NOFLAG] needs_review is present in the artifact', (function () {
    var seen = false;
    Object.keys(REALFIN.ie_spenders || {}).forEach(function (k) {
      (REALFIN.ie_spenders[k] || []).forEach(function (sp) {
        (sp.targets || []).forEach(function (t) {
          (t.rows || []).forEach(function (r) { if ('needs_review' in r) seen = true; }); }); }); });
    return seen;
  })());
  ok('[SBF3/NOFLAG] needs_review reaches NO rendered surface', (function () {
    var bad = [], probe = /needs.?review|needs_review|unverified match|match method|surname_plus_given/i;
    ['members', 'donors', 'industries', 'mix'].forEach(function (sub) {
      var pg = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, sub),
                      'ipg-sb-spend-el', ieEK);
      if (probe.test(pg.text) || probe.test(pg.html)) bad.push('spend/' + sub);
    });
    var sv2 = setSel(subtab({ doc: nav(mxv, 'spend').doc, app: mxv.app }, 'donors'),
                     'ipg-sb-spend-el', ieEK);
    var id2 = (sv2.html.match(/data-ie="([^"]+)"/) || [])[1];
    if (id2) {
      sv2.doc.querySelector('[data-ie="' + id2 + '"]').onclick();
      var t2 = sv2.app.textContent || '', h2 = sv2.app.innerHTML;
      if (probe.test(t2) || probe.test(h2)) bad.push('ie-detail');
      var cb2 = sv2.doc.getElementById('ipg-sb-ie-close'); if (cb2) cb2.onclick();
    }
    var mv3 = nav(mxv, 'member');
    REALFIN.members.forEach(function (m) {
      var pg = pick(mv3, m.seat);
      if (probe.test(pg.text) || probe.test(pg.html)) bad.push('member ' + m.seat);
    });
    if (bad.length) console.log('        ' + bad.join(', '));
    return bad.length === 0;
  })());

  // ---- finance failure is ISOLATED --------------------------------------
  var vfin = await boot(REAL, 'finfail');
  ok('[SBF/ISOLATE] a finance failure states itself and does NOT error the tool',
     vfin.text.indexOf('Could not load campaign finance data') >= 0
       && vfin.text.indexOf('Could not load Board voting data') < 0);
  ok('[SBF/ISOLATE] the voting record still renders under finance failure',
     vfin.html.indexOf('ipg-sb-seat-sel') >= 0);

  // ---------- no writes ---------------------------------------------------
  ok('[NOWRITE] embed and artifacts are byte-unchanged by this fixture',
     sha(EMBED) === EMBED_SHA0 && sha(DATA) === DATA_SHA0 && sha(FINDATA) === FIN_SHA0);

  console.log('\n' + n + ' checks · ' + (fail ? ('FAILED ' + fail) : 'ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
