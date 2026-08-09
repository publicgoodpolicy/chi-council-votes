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
var F3 = fString(/`(This chart classifies \{N\}%[^`]*)`/);
var F4 = fString(/`(Industry classification of this member[^`]*)`/);
// {N} is substituted at render, so the register form is matched on its stable halves.
function around(tpl, marker) { return String(tpl).split(marker); }

(async function () {
  ok('register entry yielded all five strings',
     !!(S1 && S2 && S3 && S4 && S5), JSON.stringify({ S1: !!S1, S2: !!S2, S3: !!S3, S4: !!S4, S5: !!S5 }));
  ok('SBFIN-1 register entry yielded all four finance strings',
     !!(F1 && F2 && F3 && F4), JSON.stringify({ F1: !!F1, F2: !!F2, F3: !!F3, F4: !!F4 }));

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
  ok('[SBF/STATE] member page is DIRECT-ONLY: no IE figure appears on it',
     pFull24.text.indexOf('Independent') < 0);

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
  var pBelow = pick(mv, '6B');
  ok('[SBF/BAR] below threshold: NO bar, and string 4 renders as the primary state',
     pBelow.html.indexOf('ipg-sb-bar-seg') < 0
       && !!F4 && pBelow.text.indexOf(around(F4, '{N}')[0]) >= 0);
  ok('[SBF/BAR] below-threshold copy carries the member’s own measured share',
     pBelow.text.indexOf(String(Math.round(finBy('6B').coverage.substantive_share * 1000) / 10) + '% of donor dollars') >= 0);

  var flipped = JSON.parse(JSON.stringify(REALFIN));
  flipped.members.forEach(function (m) {
    if (m.seat === '6B' && m.coverage) {
      m.coverage.substantive_share = 0.91; m.coverage.meets_industry_threshold = true; }
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
