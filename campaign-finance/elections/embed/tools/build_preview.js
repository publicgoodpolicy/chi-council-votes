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
 * so all real interactivity (race chips, office tabs, cycle filter, modals, panel
 * expanders) works. NOTE: production app.js does not (yet) wire the This/Last/All
 * toggle ([data-electionview]); a small PREVIEW-ONLY handler below re-invokes the
 * real ElectRender.renderRaceElections so the toggle is clickable here. That handler
 * is harness glue (this file only) — it does not modify any embed source. Wiring it
 * into app.js is a HALT-3 task.
 *
 * Reads only; modifies no embed source and never touches election-data.json.
 * Usage (from embed/):  node tools/build_preview.js [--race <raceId>]
 */
'use strict';
var fs = require('fs'), path = require('path');
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

var shim =
  'var PREVIEW_DATA = ' + safeData + ';\n' +
  'window.IPG_PREVIEW_RACE = ' + JSON.stringify(navSlug) + ';\n' +
  '(function () {\n' +
  '  var orig = window.fetch;\n' +
  '  window.fetch = function () {\n' +
  '    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(PREVIEW_DATA); } });\n' +
  '  };\n' +
  '})();\n';

// PREVIEW-ONLY toggle handler + optional race pre-navigation. Reuses the real
// ElectRender.renderRaceElections — no embed source is touched.
var glue =
  '(function () {\n' +
  '  var PIDX = null;\n' +
  '  function idx() { if (!PIDX) PIDX = ElectData.loadData(PREVIEW_DATA, { office: "school_board" }); return PIDX; }\n' +
  '  document.addEventListener("click", function (e) {\n' +
  '    var tab = e.target.closest && e.target.closest("[data-electionview]");\n' +
  '    if (!tab) return;\n' +
  '    var box = tab.closest(".elections"); if (!box) return;\n' +
  '    var raceId = idx().raceBySlug[box.getAttribute("data-race")];\n' +
  '    var vm = raceId && ElectData.viewModels.raceView(idx(), raceId, null).elections;\n' +
  '    if (vm) box.outerHTML = ElectRender.renderRaceElections(vm, tab.getAttribute("data-electionview"));\n' +
  '  });\n' +
  '  var R = window.IPG_PREVIEW_RACE;\n' +
  '  if (R) {\n' +
  '    var n = 0, t = setInterval(function () {\n' +
  '      var chip = document.querySelector(\'[data-slug="\' + R + \'"]\');\n' +
  '      if (chip) { clearInterval(t); chip.click(); } else if (++n > 100) clearInterval(t);\n' +
  '    }, 30);\n' +
  '  }\n' +
  '})();\n';

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
