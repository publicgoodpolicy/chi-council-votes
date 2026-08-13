#!/usr/bin/env node
/* Build the self-contained, paste-ready Squarespace Code Blocks: inline the pure
 * data.js + render.js + app.js (+ Poppins link; Recoleta @font-face is injected by
 * render.styles()) into ONE HTML FILE PER OFFICE. The embed fetches election-data.json
 * from the GitHub raw CDN at runtime. Run from embed/:  node tools/build_embed.js
 *
 * D-16 (PS-106), MUNI-ENABLE-1 G7: page topology is three pages, one per election, each
 * with its own URL — so this tool emits three files rather than one file whose mount
 * attribute the paster edits by hand. The payload is IDENTICAL across the three; they
 * differ only in the baked data-office and in the paste instruction naming which page the
 * file belongs to. That is the whole reason per-office emission is cheap: the office was
 * always a thin wrapper around an office-invariant payload (measured, ELECTIONS-SCOPE-1
 * report §"Facts bearing on page topology"), and nothing here duplicates the payload.
 *
 * The school-board output path is UNCHANGED (`elections-embed.inlined.html`). It is the
 * live paste surface and is read by name in build_preview.js, gate_bundle.js and
 * DEPLOY.md; moving it would strand all three and mint a phantom paste.
 */
'use strict';
var fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }

// ONE IMPLEMENTATION, TWO INVOKERS (the check_docs precedent). This file is the only
// place the bundle's composition is written down; gate_bundle.js's [BUNDLE/VINTAGE]
// calls render() to recompute the expected bytes rather than keeping a second copy of
// the template, which would drift the moment either side changed. `overrides` swaps a
// source's text in memory — that is how [BUNDLE/VINTAGE]'s biting case produces a real
// mutated bundle instead of merely testing a string comparison. Nothing is written
// unless this file is run as a script.
// One entry per emitted page. `out` is the filename; `page` is the human name used in the
// paste instruction so a 199 KB file cannot be pasted into the wrong page unnoticed — with
// three near-identical bundles that is a real hazard and the paster is a human.
var OFFICES = {
  school_board: { out: 'elections-embed.inlined.html',              page: 'SCHOOL BOARD' },
  city_council: { out: 'elections-embed.city-council.inlined.html', page: 'CITY COUNCIL' },
  mayor:        { out: 'elections-embed.mayor.inlined.html',        page: 'MAYOR' }
};
function outFor(office) { return path.join(dir, cfg(office).out); }
function cfg(office) {
  if (!Object.prototype.hasOwnProperty.call(OFFICES, office)) {
    throw new Error('build_embed: unknown office ' + JSON.stringify(office) + ' — known: ' +
      Object.keys(OFFICES).join(', ') + '. Refusing to emit a bundle for an office with no ' +
      'page; a defaulted office would silently ship school-board bytes under another name.');
  }
  return OFFICES[office];
}

function render(office, overrides) {
  var o = cfg(office);
  overrides = overrides || {};
  function src(f) {
    return Object.prototype.hasOwnProperty.call(overrides, f) ? overrides[f] : read(f);
  }
  return '<!doctype html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">\n' +
  '</head>\n<body style="margin:0">\n' +
  '<!-- ============================================================\n' +
  '     IPG Elections embed — paste this ENTIRE block into the ' + o.page + ' page\'s\n' +
  '     Squarespace Code Block. One file per page; data-office is already set below,\n' +
  '     so nothing here is edited by hand.\n' +
  '     Data is fetched at runtime from the GitHub raw CDN (election-data.json).\n' +
  '     ============================================================ -->\n' +
  '<div id="ipg-elect-root" data-office="' + office + '"></div>\n' +
  '<script>\n' + src('data.js') + '\n</script>\n' +
  '<script>\n' + src('render.js') + '\n</script>\n' +
  '<script>\n' + src('app.js') + '\n</script>\n' +
  '</body>\n</html>\n';
}

module.exports = { render: render, outFor: outFor, OFFICES: OFFICES,
                   SOURCES: ['data.js', 'render.js', 'app.js'] };

if (require.main === module) {
  Object.keys(OFFICES).forEach(function (office) {
    var html = render(office), out = outFor(office);
    fs.writeFileSync(out, html);
    console.log('built ' + path.relative(process.cwd(), out) + '  (' +
      (html.length / 1024).toFixed(1) + ' KB, self-contained, data-office=' + office + ')');
  });
}
