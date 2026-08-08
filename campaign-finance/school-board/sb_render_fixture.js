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
var EMBED_SHA0 = sha(EMBED), DATA_SHA0 = sha(DATA);

var n = 0, fail = 0, POSTED = null;
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
          if (mode === 'fail') return Promise.reject(new Error('network unreachable'));
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

(async function () {
  ok('register entry yielded all five strings',
     !!(S1 && S2 && S3 && S4 && S5), JSON.stringify({ S1: !!S1, S2: !!S2, S3: !!S3, S4: !!S4, S5: !!S5 }));

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
  // Zero coupling is a property of the DATA source. Restated at SBVOTE-2 because the
  // feedback POST added a second fetch target; the meaning is unchanged — exactly one
  // artifact is read, and it is the ratified one.
  var fetchTargets = (EMBED_HTML.match(/fetch\(([A-Za-z_.]+)/g) || []);
  ok('[MAP] exactly one DATA fetch, at the ratified refs/heads/main/ URL',
     EMBED_HTML.indexOf('refs/heads/main/campaign-finance/school-board-data.json') >= 0
       && (EMBED_HTML.match(/IPG_SB_CONFIG\.dataUrl/g) || []).length === 1);
  ok('[MAP] the only other fetch target is the feedback endpoint',
     fetchTargets.length === 2
       && fetchTargets.some(function (f) { return f.indexOf('IPG_SB_CONFIG') >= 0; })
       && fetchTargets.some(function (f) { return f.indexOf('IPG_SB_FEEDBACK') >= 0; }),
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

  // ---------- no writes ---------------------------------------------------
  ok('[NOWRITE] embed and artifact are byte-unchanged by this fixture',
     sha(EMBED) === EMBED_SHA0 && sha(DATA) === DATA_SHA0);

  console.log('\n' + n + ' checks · ' + (fail ? ('FAILED ' + fail) : 'ALL PASS'));
  process.exit(fail ? 1 : 0);
})();
