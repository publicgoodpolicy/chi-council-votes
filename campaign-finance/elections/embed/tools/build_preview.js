#!/usr/bin/env node
/* build_preview.js — LOCAL, read-only preview of the elections embed.
 *
 * Inlines the WORKING-TREE campaign-finance/election-data.json plus the production
 * data.js + render.js + app.js (verbatim) + CSS (via render.styles()) into ONE
 * self-contained HTML file, openable directly (file://, no server, no CDN). The
 * embed's fetch() is shimmed to return the inlined const, so the preview shows the
 * CURRENT local artifact — never the published CDN copy.
 *
 * Reuses the production render path: app.js mounts and calls ElectRender.renderPage,
 * so ALL real interactivity works — including the This/Last/All toggle, now wired in
 * production app.js ([data-electionview] delegation). The preview carries NO toggle
 * shim, so it exercises the real production handler. The only preview-only glue is an
 * optional --race pre-navigation (clicks a race chip after first render).
 *
 * Reads only; modifies no embed source and never touches election-data.json.
 * Usage (from embed/):  node tools/build_preview.js [--race <raceId>]
 */
'use strict';
var fs = require('fs'), path = require('path'), crypto = require('crypto');
var dir = path.join(__dirname, '..');
var repoRoot = path.join(dir, '..', '..', '..');
var dataPath = path.join(repoRoot, 'campaign-finance', 'election-data.json');
function read(f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }

var argv = process.argv.slice(2);
var raceArg = null;
for (var i = 0; i < argv.length; i++) if (argv[i] === '--race') raceArg = argv[i + 1];

var jsonText = fs.readFileSync(dataPath, 'utf8');
// Neutralize any '<' inside string values so an embedded '</script>' can't break out.
// '<' never appears in JSON structure, so this yields valid JS parsing to the same object.
var safeData = jsonText.replace(/</g, '\\u003c');

// Resolve --race <raceId> to its slug using the REAL data layer (so the preview
// pre-navigates to that race). Omitted => full School Board page (first race active).
var navSlug = '';
if (raceArg) {
  var D = require(path.join(dir, 'data.js'));
  var idx = D.loadData(JSON.parse(jsonText), { office: 'school_board' });
  var race = idx.raceById[raceArg];
  if (!race) { console.error('--race: unknown race id ' + raceArg); process.exit(1); }
  navSlug = D.raceSlug(race);
}

// VINTAGE STAMP (SBE-RERUN-1). sha256 of the election-data.json bytes this preview
// was built from. gate_bundle.js compares it against the artifact on disk and REFUSES
// to run when they differ — the preview is a build product, and a gate that reads a
// stale one reports greens about a vintage that is no longer in the tree. Measured
// case: at SBE-RERUN-1 the preview was 2 days older than the refreshed artifact and
// every PREVIEW_DATA check silently attested the old data, including a pinned figure
// that had in fact moved. The stamp is what makes that state unrepresentable.
var srcSha = crypto.createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex');

var shim =
  'var PREVIEW_DATA = ' + safeData + ';\n' +
  'window.PREVIEW_SOURCE_SHA = ' + JSON.stringify(srcSha) + ';\n' +
  'window.IPG_PREVIEW_RACE = ' + JSON.stringify(navSlug) + ';\n' +
  '(function () {\n' +
  '  var orig = window.fetch;\n' +
  '  window.fetch = function () {\n' +
  '    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(PREVIEW_DATA); } });\n' +
  '  };\n' +
  '})();\n';

// PREVIEW-ONLY: optional --race pre-navigation (clicks the race chip once rendered).
// The This/Last/All toggle is now handled by PRODUCTION app.js ([data-electionview]
// delegation) — NO shim here, so the preview exercises the real production handler.
var glue =
  '(function () {\n' +
  '  var R = window.IPG_PREVIEW_RACE;\n' +
  '  if (!R) return;\n' +
  '  var n = 0, t = setInterval(function () {\n' +
  '    var chip = document.querySelector(\'[data-slug="\' + R + \'"]\');\n' +
  '    if (chip) { clearInterval(t); chip.click(); } else if (++n > 100) clearInterval(t);\n' +
  '  }, 30);\n' +
  '})();\n';

// --bundle: gate the DEPLOY ARTIFACT, not the sources. Load the shipped bundle
// (build_embed.js output, verbatim) and splice the PREVIEW_DATA + window.fetch shim
// in just before </head> (after the font links) so jsdom serves the working-tree
// election-data.json with NO CDN. The 3 inline scripts + mount markup are the
// bundle's own, so the jsdom gates exercise exactly what ships. Source mode below
// is untouched.
if (argv.indexOf('--bundle') >= 0) {
  var bundleHtml = read('elections-embed.inlined.html');
  var shimTag = '<script>\n' + shim + '\n</script>\n';
  var injected = bundleHtml.replace('</head>', shimTag + '</head>');
  if (injected === bundleHtml) { console.error('--bundle: no </head> seam found in elections-embed.inlined.html'); process.exit(1); }
  var bOutDir = path.join(dir, 'preview');
  fs.mkdirSync(bOutDir, { recursive: true });
  var bOut = path.join(bOutDir, 'elections-preview.html');
  fs.writeFileSync(bOut, injected);
  console.log('built ' + path.relative(process.cwd(), bOut) + '  (BUNDLE mode: elections-embed.inlined.html + fetch shim)');
  process.exit(0);
}

var html = '<!doctype html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<title>Elections embed — LOCAL preview (inlined data, no CDN)</title>\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">\n' +
  '</head>\n<body style="margin:0">\n' +
  '<!-- LOCAL PREVIEW (gitignored, regenerable). Data inlined from the working-tree\n' +
  '     election-data.json and served via a fetch shim — NO CDN, NO server. -->\n' +
  '<div id="ipg-elect-root" data-office="school_board"></div>\n' +
  '<script>\n' + shim + '\n</script>\n' +
  '<script>\n' + read('data.js') + '\n</script>\n' +
  '<script>\n' + read('render.js') + '\n</script>\n' +
  '<script>\n' + read('app.js') + '\n</script>\n' +
  '<script>\n' + glue + '\n</script>\n' +
  '</body>\n</html>\n';

var outDir = path.join(dir, 'preview');
fs.mkdirSync(outDir, { recursive: true });
var out = path.join(outDir, 'elections-preview.html');
fs.writeFileSync(out, html);
console.log('built ' + path.relative(process.cwd(), out) + '  (' + (html.length / 1024 / 1024).toFixed(1) + ' MB, self-contained)' +
  (raceArg ? ('  [race=' + raceArg + ' slug=' + navSlug + ']') : '  [full School Board page]'));
