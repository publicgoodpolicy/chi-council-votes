#!/usr/bin/env node
/* build_seo.js — PS-163: what a reader without JavaScript sees on the five pages.
 *
 * Writes each page's paste file beside its source: the source's bytes, with the page's summary
 * baked inside its root container and one schema.org JSON-LD block just before it, both on the
 * root container's own line. The file's line count, and every byte off that line, are the
 * source's. When the page's script runs it replaces the root's contents whole (every app writes
 * its root with innerHTML), so the tool a reader sees with JavaScript on is unchanged.
 *
 * The summaries come from the tools' own code and the committed data, never from copies:
 *   - the homepage, from homepage-render.js's STR, TOOLS and GROUPS;
 *   - the two finance pages, from elections/embed/data.js's view models and render.js's
 *     masthead(), footer() and methodologyView() (its no-numbers branch: verify carries only
 *     the two URLs, as the app's state does before its numbers load);
 *   - the two voting pages, by booting each embed in jsdom with its data answered from this
 *     tree. The council tool is fed its votes file without dues_excluded and
 *     other_receipts_excluded, so its own left-off-whole branches drop those two figures; the
 *     school-board tool's dues sentence and other-receipts figure sentence are removed by
 *     matching their ratified templates, read from the embed's own source (SEO-15a).
 * Refresh-moving figures are left out (SEO-2a, SEO-9a); fixed facts in ratified or editorial
 * text stay as written (SEO-14a). No data-through date is baked.
 *
 * Only the title and introduction show; everything after them sits in one closed <details>
 * (SEO-18a). Squarespace's editor shows the summary without running the script and sizes the
 * block to it, so a summary shown whole left the live page a band of empty space below the tool.
 *
 * Usage, from the repository root:
 *   NODE_PATH=/tmp/domtest/node_modules node campaign-finance/tools/build_seo.js          (write)
 *   NODE_PATH=/tmp/domtest/node_modules node campaign-finance/tools/build_seo.js --check  (read-only)
 * --check builds in memory, writes nothing, and checks each committed paste file: equal to the
 * fresh build; equal to its source off the root line; one H1, before one closed <details> that
 * holds the rest of the summary; the credit on the four tools; no percentage and no dollar
 * figure outside the allow-list of fixed facts; one JSON-LD block that parses and names the
 * Institute and Ishan Daya. One PASS, WARN or FAIL line each; exit 1 on any FAIL.
 * A summary that differs from a fresh build while the code matches its source is a WARN (SEO-16a).
 */
'use strict';
var fs = require('fs'), path = require('path');
var CHECK = process.argv.indexOf('--check') >= 0;
var CF = path.join(__dirname, '..');
var JSDOM = (function () {
  var tries = ['jsdom', '/tmp/domtest/node_modules/jsdom'];
  for (var i = 0; i < tries.length; i++) { try { return require(tries[i]).JSDOM; } catch (e) {} }
  throw new Error('jsdom not found: set NODE_PATH=/tmp/domtest/node_modules');
})();
var SITE = 'https://www.publicgoodpolicy.org';
var PAGES_BASE = 'https://publicgoodpolicy.github.io/chi-council-votes/campaign-finance/';
var ORG = { '@type': 'Organization', name: 'Institute for the Public Good', url: SITE };
var PERSON = { '@type': 'Person', name: 'Ishan Daya', url: 'https://ishandaya.com' };   // SEO-13a
var CREDIT = 'Designed and constructed by Ishan Daya and the Institute for the Public Good.';   // PS-162
var MORE = 'Read the full summary';   // SEO-18a: the label of the closed section that holds all but the title and introduction
// SEO-6: the descriptions Ishan enters in Squarespace, reused as each block's description.
var DESC = {
  'chi-civic-tools': 'Nonpartisan tools from the Institute for the Public Good that track who funds Chicago elections and how the City Council and Board of Education vote.',
  'alder-voting-history': 'Find your Chicago alder by ward or address, see how they voted on key ordinances and why each vote mattered, and compare the City Council by issue.',
  'school-board-voting-history': 'How each member of the Chicago Board of Education has voted, by member and by seat: budgets, property taxes, leadership and other key resolutions.',
  'city-council': 'Who is running in Chicago\u2019s 2027 aldermanic races and who is funding them: campaign receipts and outside spending in every ward, from state filings.',
  'school-board-elections': 'Who funded the 2026 Chicago Board of Education election: campaign receipts and outside spending for every seat, from state election filings.'
};
// SEO-14a: the only dollar figures a summary may carry, each a fixed fact in ratified or editorial text.
// A new dollar figure in a key vote's description stops --check until it is looked at and added here.
// Vote counts in editorial descriptions ("passed 27-22") are fixed facts and stay (SEO-17a).
var DOLLARS_ALLOWED = ['$150', '$1,000', '$1.5Bn', '$1 million', '$900M', '$90M'];
var PAGES = [
  // page, source, paste file, root literal, needs the credit
  ['chi-civic-tools', 'homepage/homepage-embed.inlined.html', 'homepage/homepage-embed.seo.html', '<div id="ipg-home-root"></div>', false],
  ['alder-voting-history', 'elections/reference/council-embed.html', 'elections/reference/council-embed.seo.html', '<div id="ipg-council-app"></div>', true],
  ['school-board-voting-history', 'school-board/school-board-embed.html', 'school-board/school-board-embed.seo.html', '<div id="ipg-sb-app"></div>', true],
  ['city-council', 'elections/embed/elections-embed.city-council.inlined.html', 'elections/embed/elections-embed.city-council.seo.html', '<div id="ipg-elect-root" data-office="city_council"></div>', true],
  ['school-board-elections', 'elections/embed/elections-embed.inlined.html', 'elections/embed/elections-embed.seo.html', '<div id="ipg-elect-root" data-office="school_board"></div>', true]
];

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function unesc(s) { return String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); }
function ldTag(obj) { return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>'; }
function read(p) { return fs.readFileSync(path.join(CF, p), 'utf8'); }
function collapse(head, rest) { return head + '<details><summary>' + esc(MORE) + '</summary>' + rest + '</details>'; }   // SEO-18a
function txt(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

function toolLD(page, name, files) {
  var url = SITE + '/' + page;
  return { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': url, name: name, description: DESC[page], url: url,
      isPartOf: { '@type': 'WebSite', name: 'Institute for the Public Good', url: SITE }, publisher: ORG, creator: [ORG, PERSON] },
    { '@type': 'Dataset', name: name, description: DESC[page], url: url, creator: [ORG, PERSON], publisher: ORG,
      isAccessibleForFree: true, spatialCoverage: { '@type': 'Place', name: 'Chicago, Illinois' },
      distribution: files.map(function (f) { return { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: PAGES_BASE + f }; }) }
  ] };
}

// ---- the homepage ----
function hub() {
  var R = require(path.join(CF, 'homepage', 'homepage-render.js'));
  var head = '<div class="hp-head"><h1>' + esc(R.STR.title) + '</h1><p class="hp-lede">' + esc(R.STR.intro) + '</p></div>', h = '';
  R.GROUPS.forEach(function (g) {
    h += '<h2>' + esc(g.brand) + ': ' + esc(g.tag) + '</h2><ul>' + R.TOOLS.filter(function (t) { return t.group === g.key; })
      .map(function (t) { return '<li><a href="' + esc(t.href) + '">' + esc(t.name) + '</a> ' + esc(t.text) + '</li>'; }).join('') + '</ul>';
  });
  return { html: collapse(head, h), ld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: R.STR.title, description: DESC['chi-civic-tools'],
    url: SITE + '/chi-civic-tools', publisher: ORG, creator: [ORG, PERSON],
    hasPart: R.TOOLS.map(function (t) { return { '@type': 'WebPage', name: t.name, url: SITE + t.href }; }) } };
}

// ---- the two finance pages ----
function finance(office, page, dataFile) {
  var E = path.join(CF, 'elections', 'embed');
  var D = require(path.join(E, 'data.js')), R = require(path.join(E, 'render.js'));
  var appSrc = fs.readFileSync(path.join(E, 'app.js'), 'utf8');
  // the two links the methodology names, composed as app.js composes them
  var pb = appSrc.match(/var PAGES_BASE = '([^']+)';/), ab = appSrc.match(/var ART_BASE = PAGES_BASE \+ '([^']+)';/);
  var base = pb && ab ? [null, pb[1] + ab[1]] : null, rf = appSrc.match(/var RECON_URL = ART_BASE \+ '([^']+)';/), gf = appSrc.match(/var GAPS_URL = ART_BASE \+ '([^']+)';/);
  if (!base || !rf || !gf) throw new Error('app.js: ART_BASE, RECON_URL or GAPS_URL not found in the expected form');
  var RECON = base[1] + rf[1], GAPS = base[1] + gf[1];
  var index = D.loadData(JSON.parse(read(dataFile)), { office: office });
  var om = D.viewModels.officeRaces(index, office);
  var head = R.masthead(office, 'byrace', null).replace(/<div class="topnav"[\s\S]*?<\/div>/, '');   // the tab buttons need the script
  var h1 = unesc((head.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '');
  var h = '<section>';
  // The race lists follow renderRaceView: on the council page, off-ballot candidates leave the race's list
  // and go under "Not on the ballot", with its ratified note (166-2c, 168-2a, 168-3a; no count is baked);
  // on the school-board page, removed candidates stay in line with their ballot-status label, as their chip.
  var rsrc = fs.readFileSync(path.join(E, 'render.js'), 'utf8');
  var BL = rsrc.match(/var BALLOT_LABEL = (\{[^}]*\});/), ON = rsrc.match(/var OFF_BALLOT_NOTE = ('(?:[^'\\]|\\.)*'(?:\s*\+\s*'(?:[^'\\]|\\.)*')*);/);
  if (!BL || !ON) throw new Error('render.js: BALLOT_LABEL or OFF_BALLOT_NOTE not found in the expected form');
  var BALLOT_LABEL = Function('return ' + BL[1])(), OFF_BALLOT_NOTE = Function('return ' + ON[1])();
  om.groups.forEach(function (g) {
    if (g.label) h += '<h2>' + esc(g.label) + '</h2>';
    g.races.forEach(function (r) {
      var rv = D.viewModels.raceView(index, r.id, null);
      var cs = (rv.candidates || []).filter(function (c) { return c.name; });
      var offOn = rv.race.office === 'alderperson';
      var on = offOn ? cs.filter(function (c) { return !c.offBallot; }) : cs, off = offOn ? cs.filter(function (c) { return c.offBallot; }) : [];
      var li = function (c) { var b = !offOn && c.ballotStatus && BALLOT_LABEL[c.ballotStatus]; return '<li>' + esc(c.name) + (b ? ' (' + esc(b) + ')' : '') + '</li>'; };
      h += '<h3>' + esc(r.label) + '</h3><ul>' + on.map(li).join('') + '</ul>' +
        (off.length ? '<h4>Not on the ballot</h4><p>' + esc(OFF_BALLOT_NOTE) + '</p><ul>' + off.map(li).join('') + '</ul>' : '');
    });
  });
  h += '</section>' + R.footer() + '<section>' + R.methodologyView({ reconUrl: RECON, gapsUrl: GAPS }, office, null, null) + '</section>';
  return { html: '<div class="wrap">' + collapse(head, h) + '</div>', ld: toolLD(page, h1, [dataFile]) };
}

// ---- the two voting pages (jsdom) ----
function boot(src, answer, ready) {
  return new Promise(function (resolve, reject) {
    var errs = [];
    var dom = new JSDOM('<!doctype html><html><body>' + src + '</body></html>', { runScripts: 'dangerously', pretendToBeVisual: true,
      beforeParse: function (w) {
        w.addEventListener('error', function (e) { errs.push(String(e.message || e.error)); });
        w.fetch = function (u) { var r = answer(String(u)); return r === 'hold' ? new Promise(function () {}) :
          Promise.resolve(r ? { ok: true, json: function () { return Promise.resolve(r); } } : { ok: false, status: 404, json: function () { return Promise.resolve({}); } }); };
        w.scrollTo = function () {}; w.console.error = function () {}; w.console.warn = function () {}; w.console.log = function () {};
      } });
    var n = 0;
    (function poll() {
      if (ready(dom.window.document)) return resolve(dom);
      if (++n > 900) return reject(new Error('embed did not render within 90 s' + (errs.length ? '; script errors: ' + errs.slice(0, 3).join(' | ') : '')));
      dom.window.setTimeout(poll, 100);
    })();
  });
}
function tick(dom, ms) { return new Promise(function (s) { dom.window.setTimeout(s, ms); }); }
function methodologyFrom(app) {   // what the methodology tab shows below the tab strip, without controls
  var c = app.cloneNode(true);
  [].slice.call(c.querySelectorAll('.ipg-head, .ipg-tabs, .ipg-sb-head, .ipg-sb-tabs, .ipg-sb-through, .ipg-feedback-bar, .ipg-sb-feedback-bar, button, select, input, svg'))
    .forEach(function (e) { e.remove(); });
  return c.innerHTML;
}

async function council() {
  var src = read('elections/reference/council-embed.html');
  var votes = JSON.parse(read('shards/council-votes.json'));
  delete votes.dues_excluded; delete votes.other_receipts_excluded;   // the tool's own left-off-whole branches (SEO-15a)
  var dom = await boot(src, function (u) { return u.indexOf('council-votes.json') >= 0 ? votes : (u.indexOf('council-data.json') >= 0 ? 'hold' : null); },
    function (d) { return d.querySelector('.ipg-member-name'); });
  var d = dom.window.document, title = txt(d.querySelector('.ipg-title'));
  var head = '<div class="ipg-head"><h1 class="ipg-title">' + esc(title) + '</h1><p class="ipg-sub">' + esc(txt(d.querySelector('.ipg-sub'))) + '</p></div>';
  var h = '<h2>Alderpersons, by ward</h2><ul>' + [].slice.call(d.querySelectorAll('#ipg-ward-sel option')).filter(function (o) { return o.value; })
    .map(function (o) { return '<li>' + esc(txt(o)) + '</li>'; }).join('') + '</ul><h2>Key votes</h2>';
  [].slice.call(d.querySelectorAll('.ipg-vote')).forEach(function (v) {   // the key votes; the member's recorded position is left out
    var name = txt(v.querySelector('.ipg-vote-name')); if (!name) return;
    var link = v.querySelector('a[href]');
    h += '<h3>' + esc(name) + '</h3><p>' + esc(txt(v.querySelector('.ipg-vote-tag'))) + ' · ' + esc(txt(v.querySelector('.ipg-vote-year'))) + '</p><p>' +
      esc(txt(v.querySelector('.ipg-vote-desc'))) + '</p>' + (link ? '<p><a href="' + esc(link.getAttribute('href')) + '">Roll-call source</a></p>' : '');
  });
  d.querySelector('.ipg-tab[data-v="methodology"]').onclick(); await tick(dom, 150);
  h += methodologyFrom(d.getElementById('ipg-council-app'));
  dom.window.close();
  return { html: collapse(head, h), ld: toolLD('alder-voting-history', title, ['shards/council-votes.json', 'council-data.json']) };
}

async function sbVotes() {
  var src = read('school-board/school-board-embed.html');
  var data = JSON.parse(read('school-board-data.json')), fin = JSON.parse(read('school-board-finance.json'));
  var dom = await boot(src, function (u) { return u.indexOf('school-board-data.json') >= 0 ? data : (u.indexOf('school-board-finance.json') >= 0 ? fin : null); },
    function (d) { var a = d.getElementById('ipg-sb-app'); return a && a.querySelector('.ipg-sb-verified'); });
  var d = dom.window.document, title = txt(d.querySelector('.ipg-sb-title'));
  var head = '<div class="ipg-sb-head"><h1 class="ipg-sb-title serif">' + esc(title) + '</h1><p class="ipg-sb-sub">' + esc(txt(d.querySelector('.ipg-sb-sub'))) + '</p></div>', h = '';
  var seatSel = [].slice.call(d.querySelectorAll('select')).filter(function (s) { return [].some.call(s.options, function (o) { return /^1A — /.test(txt(o)); }); })[0];
  if (!seatSel) throw new Error('school-board seat selector not found');
  h += '<h2>Board members, by seat</h2><ul>' + [].slice.call(seatSel.options).filter(function (o) { return / — /.test(txt(o)); })
    .map(function (o) { return '<li>' + esc(txt(o)) + '</li>'; }).join('') + '</ul><h2>Key votes</h2>';
  [].slice.call(d.querySelectorAll('.ipg-sb-keyvotes .ipg-sb-vote')).forEach(function (v) {
    var h4 = v.querySelector('h4');
    var t = h4 ? [].slice.call(h4.childNodes).filter(function (n) { return n.nodeType === 3; }).map(function (n) { return n.textContent; }).join('').trim() : '';
    var link = v.querySelector('a[href]');
    h += '<h3>' + esc(t) + '</h3><p>' + esc(txt(v.querySelector('.ipg-sb-star')).replace(/^★\s*/, '')) + ' · ' + esc(txt(v.querySelector('.ipg-sb-when'))) + '</p><p>' +
      esc(txt(v.querySelector('p'))) + '</p>' + (link ? '<p><a href="' + esc(link.getAttribute('href')) + '">Source</a></p>' : '');
  });
  [].slice.call(d.querySelectorAll('.ipg-sb-tab')).filter(function (b) { return b.getAttribute('data-view') === 'methodology'; })[0].click();
  await tick(dom, 150);
  var m = methodologyFrom(d.getElementById('ipg-sb-app'));
  // SEO-15a: the dues sentence (its own paragraph) whole, and the other-receipts figure sentence,
  // each matched against its ratified template from the embed's source with any cents figure.
  var f4 = src.match(/f4: '([^']*\{DUES\}[^']*)'/)[1], other = src.match(/otherReceipts: '([^']*\{OTHER\}[^']*)'/)[1];
  function rx(t, ph) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(ph.replace(/[{}]/g, '\\$&'), '\\$[0-9,]+\\.[0-9]{2}'); }
  var duesP = new RegExp('<p>' + rx(f4, '{DUES}') + '</p>'), otherS = new RegExp(' ' + rx(other.slice(other.indexOf('For the members on this page')), '{OTHER}'));
  if (!duesP.test(m) || !otherS.test(m)) throw new Error('school-board methodology: a SEO-15a sentence was not found');
  m = m.replace(duesP, '').replace(otherS, '');
  dom.window.close();
  return { html: collapse(head, h + m), ld: toolLD('school-board-voting-history', title, ['school-board-data.json', 'school-board-finance.json']) };
}

(async function () {
  var built = {
    'chi-civic-tools': hub(),
    'city-council': finance('city_council', 'city-council', 'election-data.city-council.json'),
    'school-board-elections': finance('school_board', 'school-board-elections', 'election-data.school-board.json'),
    'alder-voting-history': await council(),
    'school-board-voting-history': await sbVotes()
  };
  var fails = 0;
  function check(ok, msg) { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
  PAGES.forEach(function (p) {
    var src = read(p[1]), b = built[p[0]];
    if (src.split(p[3]).length !== 2) throw new Error(p[0] + ': the root literal does not occur exactly once in ' + p[1]);
    var html = b.html.replace(/\s*[\r\n]+\s*/g, ' ');
    var open = p[3].slice(0, -'</div>'.length);
    var out = src.replace(p[3], function () { return ldTag(b.ld) + open + html + '</div>'; });
    var textOf = function (x) { return unesc(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); };
    var text = textOf(html);
    if (!CHECK) {
      fs.writeFileSync(path.join(CF, p[2]), out);
      console.log('wrote ' + p[2] + ' (' + out.length + ' chars; summary ' + text.length + ' chars of text)');
      return;
    }
    var have = fs.existsSync(path.join(CF, p[2])) ? read(p[2]) : null;
    var a = src.split('\n'), c = (have || '').split('\n');
    var rootAt = a.indexOf(p[3]);
    var offRoot = a.length === c.length && a.every(function (l, i) { return i === rootAt || l === c[i]; });
    // SEO-16a: a summary that no longer matches the data is a WARN (it carries no figure, so it is
    // only missing a name; it is rebuilt and goes live at the next paste lane). Code that no longer
    // matches its source is a FAIL: the paste file would carry old code.
    if (have === out) console.log('PASS ' + p[0] + ': ' + p[2] + ' equals a fresh build');
    else if (have !== null && offRoot) console.log('WARN ' + p[0] + ': ' + p[2] + '\u2019s summary differs from a fresh build (rebuild; it goes live at the next paste)');
    else check(false, p[0] + ': ' + p[2] + ' equals a fresh build');
    check(have !== null && rootAt >= 0 && a.filter(function (l) { return l === p[3]; }).length === 1 && offRoot && c[rootAt] !== p[3],
      p[0] + ': equal to its source off the root line (' + a.length + ' lines each, 1 differs)');
    // From here every check reads the COMMITTED paste file's root line, not the fresh build.
    var line = have !== null && rootAt >= 0 ? c[rootAt] : '';
    var m = line.match(/^<script type="application\/ld\+json">([^<]*)<\/script>([\s\S]*)$/);
    var shaped = !!m && m[2].indexOf(open) === 0 && /<\/div>$/.test(m[2]) && (m[2].match(/<script/g) || []).length === 0;
    check(shaped, p[0] + ': the root line is one JSON-LD block, then the root container holding the summary, and nothing else');
    var cHtml = shaped ? m[2].slice(open.length, -'</div>'.length) : '';
    var cText = textOf(cHtml);
    check((cHtml.match(/<h1[ >]/g) || []).length === 1, p[0] + ': one H1');
    var di = cHtml.indexOf('<details>'), hi = cHtml.search(/<h1[ >]/);
    check((cHtml.match(/<details[ >]/g) || []).length === 1 && (cHtml.match(/<summary[ >]/g) || []).length === 1 && di > hi && hi >= 0 &&
      cHtml.indexOf('<details><summary>' + esc(MORE) + '</summary>') === di && cHtml.slice(0, di).replace(/<[^>]+>/g, '').length < 1000 &&
      cHtml.lastIndexOf('</details>') === cHtml.length - '</details>'.length - (p[0] === 'city-council' || p[0] === 'school-board-elections' ? '</div>'.length : 0),
      p[0] + ': the title and introduction, then one closed section ("' + MORE + '") holding the rest (SEO-18a)');
    if (p[4]) check(cText.indexOf(CREDIT) >= 0, p[0] + ': PS-162\u2019s sentence is in the summary');
    text = cText;
    var dollars = (text.match(/\$[0-9][0-9,.]*(?:Bn|M\b| million)?/g) || []).filter(function (x) { return DOLLARS_ALLOWED.indexOf(x) < 0; });
    check(dollars.length === 0 && !/[0-9]\s*(%|percent)/i.test(text), p[0] + ': no dollar figure outside the allow-list and no percentage (outside the allow-list: ' + JSON.stringify(dollars) + ')');
    var lds = ((have || '').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || []);
    var ok = lds.length === 1 && shaped;
    try { var j = JSON.parse(m[1]); var s = JSON.stringify(j);
      ok = ok && s.indexOf('"Institute for the Public Good"') >= 0 && s.indexOf('"Ishan Daya"') >= 0 && s.indexOf('license') < 0 && s.indexOf('dateModified') < 0; } catch (e) { ok = false; }
    check(ok, p[0] + ': one JSON-LD block; it parses and names the Institute and Ishan Daya, with no license and no modified date');
  });
  if (CHECK) { console.log((fails ? 'FAILED ' + fails : 'ALL PASS') + ' (check_seo)'); process.exit(fails ? 1 : 0); }
})().catch(function (e) { console.error(String(e && e.stack || e)); process.exit(2); });
