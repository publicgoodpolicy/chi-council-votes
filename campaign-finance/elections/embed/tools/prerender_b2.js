#!/usr/bin/env node
/* B2 verification harness (NOT app code). Exercises the pure data + render
 * layers exactly as the future SEO pre-render will: load election-data.json,
 * render the school_board page (sb-d03 / District 2A active), write a
 * self-contained preview HTML (no fetch/CDN needed — open it directly to
 * eyeball), and assert the prototype-fidelity output. Run from embed/:
 *   node tools/prerender_b2.js
 */
'use strict';
var path = require('path');
var fs = require('fs');
var D = require(path.join(__dirname, '..', 'data.js'));
var R = require(path.join(__dirname, '..', 'render.js'));

var json = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'election-data.json'), 'utf8'));
var index = D.loadData(json);

var OFFICE = 'school_board';
var omVM = D.viewModels.officeRaces(index, OFFICE);
var rv = D.viewModels.raceView(index, index.raceBySlug['district-2a'], null);
var page = R.renderPage({ office: OFFICE, topView: 'byrace', officeRaces: omVM, activeSlug: 'district-2a', raceView: rv });

var full = '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1"><title>School Board — preview</title>' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">' +
  R.styles() + '</head><body style="margin:0"><div class="ipg-elect">' + page + '</div></body></html>';
var out = path.join(__dirname, 'preview_b2.html');
fs.writeFileSync(out, full);

var fails = 0;
function ok(name, cond) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) fails++; }

console.log('=== B2 render assertions (school_board, District 2A active) ===');
ok('renders DeBerry card', /Ebony DeBerry/.test(page));
ok('renders Leon card', /Bruce Leon/.test(page));
ok('neutral order: DeBerry before Leon', page.indexOf('Ebony DeBerry') < page.indexOf('Bruce Leon'));
ok('Leon contributions $620,403', page.indexOf('$620,403') >= 0);
ok('Leon self-funded $620,000 (selfline)', page.indexOf('$620,000') >= 0);
ok('Leon third-party $403', page.indexOf('$403') >= 0);
ok('Leon independent support $24,766', page.indexOf('$24,766') >= 0);
ok('DeBerry contributions $534,950', page.indexOf('$534,950') >= 0);
ok('DeBerry independent opposition $126,078', page.indexOf('$126,078') >= 0);
ok('self-funding hatch segment (seg self)', /class="seg self"/.test(page));
ok('three figure bars present', /From contributors/.test(page) && /Independent support/.test(page) && /Independent opposition/.test(page));
ok('Leon "Mostly self-funded" chip', /chip-self/.test(page));
ok('DeBerry "Incumbent" chip', /chip-inc/.test(page));
ok('exact disclaimer copy (footer)', /separately and never added together/.test(page));
ok('locked slug scheme: cand-bruce-leon-district-2a', /id="cand-bruce-leon-district-2a"/.test(page));
ok('District 2A chip is active', /data-slug="district-2a" aria-pressed="true"/.test(page));
ok('coming-soon races marked (· soon)', /· soon/.test(page));
ok('office sub-tabs (Board President / Districts)', /Board President/.test(page) && /Districts/.test(page));
ok('figures NOT summed (no grand-total markup)', page.indexOf('Total raised') < 0 && page.indexOf('grand total') < 0);

console.log('\nwrote ' + path.relative(process.cwd(), out) + '  (open in a browser to eyeball — self-contained, no fetch)');
console.log(fails ? (fails + ' ASSERTION(S) FAILED') : 'ALL ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
