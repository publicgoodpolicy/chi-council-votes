#!/usr/bin/env node
/* Build the paste-ready Squarespace Code Block for /chi-civic-tools: styles.css,
 * homepage-render.js and homepage-app.js inlined into ONE self-contained file. The page fetches
 * homepage-data.json from GitHub Pages (ruling 123) at runtime; nothing else is fetched
 * but the Poppins stylesheet. Run from campaign-finance/homepage/:
 *   node tools/build_homepage_embed.js
 */
'use strict';
var fs = require('fs'), path = require('path');
var dir = path.join(__dirname, '..');
var OUT = path.join(dir, 'homepage-embed.inlined.html');
var SOURCES = ['styles.css', 'homepage-render.js', 'homepage-app.js'];

function render(overrides) {
  overrides = overrides || {};
  function src(f) {
    return Object.prototype.hasOwnProperty.call(overrides, f) ? overrides[f] : fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return '<!doctype html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
    '</head>\n<body style="margin:0">\n' +
    '<!-- ============================================================\n' +
    '     IPG civic tools homepage — paste this ENTIRE block into the\n' +
    '     /chi-civic-tools page\'s Squarespace Code Block.\n' +
    '     Nothing here is edited by hand. Data is fetched at runtime from the\n' +
    '     GitHub Pages (homepage-data.json).\n' +
    '     ============================================================ -->\n' +
    '<style>\n' + src('styles.css') + '</style>\n' +
    '<div id="ipg-home-root"></div>\n' +
    '<script>\n' + src('homepage-render.js') + '</script>\n' +
    '<script>\n' + src('homepage-app.js') + '</script>\n' +
    '</body>\n</html>\n';
}

module.exports = { render: render, OUT: OUT, SOURCES: SOURCES };

if (require.main === module) {
  var html = render();
  fs.writeFileSync(OUT, html);
  console.log('built ' + path.relative(process.cwd(), OUT) + '  (' + Buffer.byteLength(html) + ' B, self-contained)');
}
