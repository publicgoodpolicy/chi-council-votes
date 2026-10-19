#!/usr/bin/env node
/* Render the homepage in node from a homepage-data.json and check what a reader sees.
 * Read-only. Usage: node tools/check_homepage.js <homepage-data.json>
 * Prints one PASS/FAIL line per check and exits non-zero on any FAIL.
 */
'use strict';
var fs = require('fs'), path = require('path');
var R = require(path.join(__dirname, '..', 'homepage-render.js'));
var build = require(path.join(__dirname, 'build_homepage_embed.js'));
var data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var fails = 0;
function check(ok, msg) { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); }
function text(html) { return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' '); }

var st = { cycle: 'all', shown: R.PAGE, q: '', open: null };
var all = R.ranking(data, 'all');
var h = R.page(data, st);

check(all.length === data.donors.length, 'all-cycles ranking holds every donor (' + all.length + ')');
var sum = 0; data.donors.forEach(function (d) { sum += d.total; });
var rsum = 0; all.forEach(function (r) { rsum += r.t; });
check(Math.abs(sum - rsum) < 0.01, 'ranking total equals the file (' + R.money(rsum) + ')');
var mism = all.filter(function (r) { return Math.abs(r.t - r.d.total) > 0.005; });
check(mism.length === 0, 'each donor\'s all-cycles total equals its file total');
var itemized = data.donors.filter(function (d) { return d.total >= 50000; }).length;
check(R.cap(all) === itemized && itemized === data.counts.itemized_donors, '"Show more" reaches every donor at $50,000 or more (' + itemized + ')');
check((h.match(/class="hp-donor/g) || []).length === 25, '25 donor rows on first load');
check(text(h).indexOf(R.STR.mayorNote) >= 0 && R.STR.mayorNote.replace(/’/g, "'") === "Includes gifts to the candidates' committees for other offices, such as Secretary of State and Comptroller.", 'mayoral note under the table, as ruled (20a)');
check(text(h).indexOf('Mayoral candidates') >= 0, 'column labelled "Mayoral candidates" (20a)');
check(text(h).indexOf('Gifts to outside-spending groups count in full; some of these groups spend most of what they raise outside Chicago races.') >= 0, 'groups note under the table (39-i a)');
var order = ['hp-tools', 'hp-donors', 'hp-groups', 'hp-votes'].map(function (id) { return h.indexOf('id="' + id + '"'); });
check(order.every(function (x, i) { return x > 0 && (i === 0 || x > order[i - 1]); }), 'sections in ruled order: tools, donors, groups, votes (22a)');
check((h.match(/class="hp-vote"/g) || []).length === data.feed.length, 'votes feed shows all ' + data.feed.length + ' items');
var votes = text(h.slice(h.indexOf('id="hp-votes"')));
check(data.feed.every(function (f) { return votes.indexOf(f.tally.yes + ' yes, ' + f.tally.no + ' no') >= 0; }), 'every vote shows a labelled tally');
check(!/\b(Pass|Fail|Split)\b/.test(votes), 'no result word printed for any vote (the artifacts do not carry one)');
check(data.feed.every(function (f) { return h.indexOf('href="' + f.link.replace(/&/g, '&amp;') + '"') >= 0; }), 'every vote links to its tool page');
check((h.match(/<tr><td class="hp-rank">/g) || []).length === data.groups.length, 'groups table shows all ' + data.groups.length + ' groups');
check(R.TOOLS.length === 5 && R.TOOLS.every(function (t) { return h.indexOf('href="' + t.href + '"') > 0; }), 'five tool links');

// top donor, own money marks (25a)
var top = all[0];
console.log('     top donor: ' + top.d.name + ' ' + R.money(top.t));
var wil = all.filter(function (r) { return r.d.id === 'wilson-willie'; })[0];
check(!!wil, 'Wilson is in the data');
if (wil) {
  var wrow = R.page(data, { cycle: 'all', shown: 25, q: 'wilson, willie', open: null });
  check(text(wrow).indexOf('Own money $10.20M') >= 0 && text(wrow).indexOf('of which $10.07M loans to their own committee') >= 0,
    'Wilson marked: own money $10.20M, of which $10.07M loans (25a)');
}

// "show more" steps and stops at the cap
var s = { cycle: 'all', shown: R.PAGE, q: '', open: null }, steps = 0;
while (R.page(data, s).indexOf('hp-more') >= 0 && steps < 100) { s.shown += R.PAGE; steps++; }
check((R.page(data, s).match(/class="hp-donor/g) || []).length === itemized, '"Show more" ends at ' + itemized + ' rows after ' + steps + ' presses');

// each cycle
Object.keys(data.cycles).forEach(function (k) {
  var rk = R.ranking(data, k), hk = R.page(data, { cycle: k, shown: 25, q: '', open: null });
  check(rk.length > 0 && hk.indexOf('<option value="' + k + '" selected') >= 0, 'cycle ' + k + ': ' + rk.length + ' donors, top ' + (rk[0] && rk[0].d.name));
});

// search
var hs = R.page(data, { cycle: 'all', shown: 25, q: 'teachers', open: null });
check(/match/.test(text(hs)) && (hs.match(/class="hp-donor/g) || []).length > 0, 'search "teachers" finds donors');
var hn = R.page(data, { cycle: 'all', shown: 25, q: 'zzqqxx', open: null });
check(text(hn).indexOf('No donor matches.') >= 0, 'search with no match says so');
var gone = data.donors.filter(function (d) { return !d.by_cycle['2015']; })[0];
var hx = R.page(data, { cycle: '2015', shown: 25, q: gone.name.toLowerCase(), open: null });
check(hx.indexOf('data-donor="' + gone.id + '"') > 0, 'search in a cycle still finds a donor with nothing in it (23a)');
var hxo = R.page(data, { cycle: '2015', shown: 25, q: gone.name.toLowerCase(), open: gone.id });
check(!/\$0\b/.test(text(hx)) && (!data.items[gone.id] || text(hxo).indexOf('No gifts in this period.') >= 0), 'a donor with nothing in the period shows dashes and no empty gift table');

// detail: itemized and non-itemized
var it = all[0], ho = R.page(data, { cycle: 'all', shown: 25, q: '', open: it.d.id });
var n = (data.items[it.d.id] || []).length;
check(ho.indexOf('hp-detail-row') > 0 && (n === 0 || text(ho).indexOf(n + ' gift') >= 0), 'opening the top donor lists its ' + n + ' gifts');
var small = all.filter(function (r) { return r.d.total < 50000; })[0];
var hsm = R.page(data, { cycle: 'all', shown: 25, q: small.d.name.toLowerCase().slice(0, 30), open: small.d.id });
check(text(hsm).indexOf('Totals by office for this period') >= 0, 'a donor under $50,000 opens to totals by office');
var noRec = 0; Object.keys(data.items).forEach(function (k) { data.items[k].forEach(function (i) { if (!data.recipients[i[1]]) noRec++; }); });
check(noRec === 0, 'every itemized gift names a known recipient');
var offs = {}; Object.keys(data.recipients).forEach(function (k) { offs[data.recipients[k].office] = 1; });
check(Object.keys(offs).every(function (o) { return ['council', 'school_board', 'mayor', 'group'].indexOf(o) >= 0; }), 'every recipient office has a label (' + Object.keys(offs).sort().join(', ') + ')');

// states and bundle
check(text(R.loading()).indexOf('Loading campaign-finance data') >= 0, 'loading string (26a)');
check(text(R.failed()).indexOf(R.STR.failed) >= 0 && R.STR.failed.replace(/\u2019/g, "'") === "The data didn't load. Try again, or use the tools below."  && R.failed().indexOf('hp-tools') > 0, 'failure string, with the tool links (26a)');
var bundle = build.render();
check(bundle.indexOf('homepage-data.json') > 0 && (bundle.match(/https?:\/\/[^\s'"<>)]+/g) || []).every(function (u) {
  return /^https:\/\/(raw\.githubusercontent\.com\/publicgoodpolicy\/chi-council-votes\/refs\/heads\/main\/campaign-finance\/homepage-data\.json|fonts\.googleapis\.com|fonts\.gstatic\.com)/.test(u);
}), 'bundle reaches only the data file and the font host');
check(!/localStorage|sessionStorage|document\.cookie|eval\(|new Function/.test(bundle), 'bundle uses no storage, cookies or eval');
console.log(fails ? 'CHECK: FAIL (' + fails + ')' : 'CHECK: PASS');
process.exit(fails ? 1 : 0);
