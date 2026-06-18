#!/usr/bin/env node
/* Build the self-contained, paste-ready Squarespace Code Block: inline the pure
 * data.js + render.js + app.js (+ Poppins link; Recoleta @font-face is injected by
 * render.styles()) into one HTML file. The embed fetches election-data.json from
 * the GitHub raw CDN at runtime. Run from embed/:  node tools/build_embed.js
 */
'use strict';
var fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }

var html = '<!doctype html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet">\n' +
  '</head>\n<body style="margin:0">\n' +
  '<!-- ============================================================\n' +
  '     IPG Elections embed — paste this ENTIRE block into a Squarespace Code Block.\n' +
  '     Per page, set data-office on the mount div:\n' +
  '       school_board  (live)  |  city_council  (coming soon)  |  mayor (coming soon)\n' +
  '     Data is fetched at runtime from the GitHub raw CDN (election-data.json).\n' +
  '     ============================================================ -->\n' +
  '<div id="ipg-elect-root" data-office="school_board"></div>\n' +
  '<script>\n' + read('data.js') + '\n</script>\n' +
  '<script>\n' + read('render.js') + '\n</script>\n' +
  '<script>\n' + read('app.js') + '\n</script>\n' +
  '</body>\n</html>\n';

var out = path.join(dir, 'elections-embed.inlined.html');   // embed root (dist/ is gitignored)
fs.writeFileSync(out, html);
console.log('built ' + path.relative(process.cwd(), out) + '  (' + (html.length / 1024).toFixed(1) + ' KB, self-contained)');
