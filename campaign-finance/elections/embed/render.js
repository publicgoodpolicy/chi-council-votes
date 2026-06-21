/* Elections embed — RENDER layer (pure, dual-runtime).
 *
 * view model -> HTML string. No DOM, no events, no browser globals — the same
 * functions render in Node (SEO pre-render) and in the browser app (app.js).
 * Visual treatment matches elections-embed-prototype.html: the three money
 * figures are three separate segmented bars, NEVER summed — contributions (teal)
 * with the self-funding hatch shown distinctly, independent support (sage),
 * independent opposition (coral). All CSS is scoped under `.ipg-elect` so it is
 * safe inside a Squarespace Code Block. Recoleta is named with a serif fallback;
 * the real @font-face arrives at B5. Drill-downs are B3 (bars are static here).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ElectRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function money(n) { return (n == null) ? '—' : ('$' + Math.round(n).toLocaleString('en-US')); }
  function prettyTag(s) { return String(s).replace(/-/g, ' '); }

  // A real IE name shows as the primary label with "funded primarily by …" as a
  // subtitle; only a genuine placeholder (no name resolved) falls back to the
  // framed identity. Returns pre-escaped HTML fragments.
  function isPlaceholderIE(name) { return !name || /^IE committee \d+$/i.test(name); }
  function ieNaming(name, identity) {
    var sub = (identity && identity.length) ? ('Funded primarily by ' + identity.map(esc).join(', ')) : '';
    if (!isPlaceholderIE(name)) return { primary: esc(name), subtitle: sub, real: true };
    return { primary: (sub || 'Independent-expenditure committee'), subtitle: '', real: false };
  }

  // Industry tag(s) + flag(s) for a donor. Uncategorized shows as uncategorized,
  // never blank. Forward-compat: surfaces whatever is in industries/flags now.
  // Legible text color for a tag background WITHOUT inventing palette colors: pick whichever
  // of white / --ink (#342828) has higher WCAG contrast on the given hex. (Council hardcodes
  // #fff, which is low-contrast on the lightest schema tags like #b5a995 / #9a8e7e — E-5
  // probe flagged that; this avoids copying it.)
  function readableText(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length !== 6) return '#fff';
    function ch(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
    var L = 0.2126 * ch(parseInt(h.slice(0, 2), 16)) + 0.7152 * ch(parseInt(h.slice(2, 4), 16)) + 0.0722 * ch(parseInt(h.slice(4, 6), 16));
    var cWhite = 1.05 / (L + 0.05), cInk = (L + 0.05) / (0.0331 + 0.05);   // 0.0331 = luminance of #342828
    return cWhite >= cInk ? '#fff' : '#342828';
  }

  // tagMap (optional) = index.industryTags {slug:{label,color}}. When present, an industry pill
  // gets its canonical color + curated label (council parity); unknown / uncategorized tags fall
  // back to the neutral .tagchip.ind style + a readable label — never a broken or empty pill.
  function tagsHtml(industries, flags, tagMap) {
    var inds = (industries && industries.length) ? industries : ['uncategorized'];
    var out = '';
    for (var i = 0; i < inds.length; i++) {
      var slug = inds[i], meta = (tagMap && tagMap[slug]) || null;
      var label = (meta && meta.label) ? meta.label
        : ((slug === 'unclassified' || slug === 'uncategorized') ? 'uncategorized' : prettyTag(slug));
      var style = (meta && meta.color) ? ' style="background:' + esc(meta.color) + ';color:' + readableText(meta.color) + '"' : '';
      out += '<span class="tagchip ind"' + style + '>' + esc(label) + '</span>';
    }
    var fl = flags || [];
    for (var j = 0; j < fl.length; j++) {
      var ft = (fl[j] && fl[j].type) || fl[j];
      if (ft) out += '<span class="tagchip flag">⚑ ' + esc(prettyTag(ft)) + '</span>';
    }
    return out;
  }

  // Editorial masthead copy per office page.
  var MAST = {
    school_board: { kicker: 'Chicago School Board · November 3, 2026', election: '2026 Chicago Board of Education',
      lede: 'A nonpartisan guide to the money behind the 2026 Chicago Board of Education election. We show what campaigns raise and what outside groups spend — <strong>not who to vote for.</strong>' },
    city_council: { kicker: 'Chicago City Council · February 23, 2027', election: '2027 Chicago Municipal',
      lede: 'A nonpartisan guide to the money in Chicago’s 2027 aldermanic races — what campaigns raise and what outside groups spend, <strong>not who to vote for.</strong>' },
    mayor: { kicker: 'Chicago Mayor · February 23, 2027', election: '2027 Chicago Municipal',
      lede: 'A nonpartisan guide to the money in Chicago’s 2027 mayoral race — what the campaign raises and what outside groups spend, <strong>not who to vote for.</strong>' }
  };
  function pageLabel(o) { return ({ school_board: 'School Board', city_council: 'City Council', mayor: 'Mayor' })[o] || o; }

  function styles() {
    return '<style>' +
      // Real Recoleta — the council embed's exact @font-face (onlinewebfonts CDN),
      // with a Georgia serif fallback so the editorial feel survives if the CDN font
      // doesn\'t load. Matches the council tool for type parity.
      '@font-face{font-family:"Recoleta";src:url("https://db.onlinewebfonts.com/t/4b3a3f6c2c6e4f1e8e5d4c3b2a1f0e9d.woff2") format("woff2");font-weight:700;font-display:swap;}' +
      '.ipg-elect{--cream:#F6EFE9;--paper:#FCF8F3;--ink:#342828;--ink-soft:#6E5F58;--tan:#EBDAC6;--line:#E0CDB6;' +
        '--teal:#044127;--sage:#508F88;--coral:#B0553A;--display:Recoleta,Georgia,ui-serif,serif;' +
        '--body:Poppins,system-ui,-apple-system,sans-serif;--r:14px;' +
        'background:var(--cream);color:var(--ink);font-family:var(--body);font-weight:400;line-height:1.55;-webkit-font-smoothing:antialiased;}' +
      '.ipg-elect *{box-sizing:border-box;}' +
      '.ipg-elect .wrap{max-width:980px;margin:0 auto;padding:0 20px;}' +
      '.ipg-elect .masthead{padding:30px 0 16px;}' +
      '.ipg-elect .eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--teal);font-weight:600;margin:0 0 14px;display:flex;align-items:center;gap:10px;}' +
      '.ipg-elect .eyebrow .box{width:14px;height:14px;border:2px solid var(--teal);border-radius:3px;position:relative;flex:none;}' +
      '.ipg-elect .eyebrow .box::after{content:"";position:absolute;left:2px;top:-3px;width:6px;height:10px;border:solid var(--teal);border-width:0 2px 2px 0;transform:rotate(40deg);}' +
      '.ipg-elect h1{font-family:var(--display);font-weight:600;font-size:clamp(28px,5vw,44px);line-height:1.05;letter-spacing:-.01em;margin:0 0 14px;max-width:18ch;}' +
      '.ipg-elect .lede{font-size:16px;color:var(--ink-soft);max-width:60ch;margin:0;}' +
      '.ipg-elect .lede strong{color:var(--ink);font-weight:500;}' +
      '.ipg-elect .topnav{display:inline-flex;background:var(--tan);border-radius:30px;padding:4px;margin:24px 0 0;gap:2px;}' +
      '.ipg-elect .topnav button{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:14px;font-weight:500;color:var(--ink-soft);padding:9px 20px;border-radius:26px;}' +
      '.ipg-elect .topnav button[aria-selected="true"]{background:var(--teal);color:#fff;}' +
      '.ipg-elect .topnav button:focus-visible{outline:2px solid var(--sage);outline-offset:2px;}' +
      '.ipg-elect .offices{display:flex;gap:6px;margin:22px 0 0;border-bottom:2px solid var(--line);flex-wrap:wrap;}' +
      '.ipg-elect .office{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:15px;font-weight:500;color:var(--ink-soft);padding:12px 16px;border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0;}' +
      '.ipg-elect .office[aria-selected="true"]{color:var(--teal);border-bottom-color:var(--teal);}' +
      '.ipg-elect .office:focus-visible{outline:2px solid var(--sage);outline-offset:2px;}' +
      '.ipg-elect .office .tag{font-size:11px;color:var(--ink-soft);font-weight:400;}' +
      '.ipg-elect .districts{display:flex;flex-wrap:wrap;gap:8px;padding:20px 0 4px;}' +
      '.ipg-elect .chip{appearance:none;cursor:pointer;font-family:var(--body);font-size:13px;font-weight:500;padding:7px 13px;border-radius:20px;border:1px solid var(--line);background:var(--paper);color:var(--ink-soft);}' +
      '.ipg-elect .chip[aria-pressed="true"]{background:var(--teal);border-color:var(--teal);color:#fff;}' +
      '.ipg-elect .chip[data-status="soon"]{opacity:.55;}' +
      '.ipg-elect .chip:focus-visible{outline:2px solid var(--sage);outline-offset:2px;}' +
      '.ipg-elect .picker-note{font-size:12.5px;color:var(--ink-soft);margin:8px 0 0;}' +
      '.ipg-elect .race-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:26px 0 4px;}' +
      '.ipg-elect .race-head h2{font-family:var(--display);font-weight:600;font-size:26px;margin:0;}' +
      '.ipg-elect .race-meta{font-size:13px;color:var(--ink-soft);}' +
      '.ipg-elect .field-note{font-size:13px;color:var(--ink-soft);background:var(--tan);border-radius:10px;padding:10px 14px;margin:14px 0 22px;display:flex;gap:9px;align-items:flex-start;}' +
      '.ipg-elect .field-note b{color:var(--ink);font-weight:500;}' +
      '.ipg-elect .vacating-note{font-size:13px;color:var(--ink-soft);background:#E5EFE9;border-radius:10px;padding:10px 14px;margin:10px 0 18px;}' +
      '.ipg-elect .vacating-note b{color:var(--ink);font-weight:500;}' +
      '.ipg-elect .goto-link{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:13px;font-weight:500;color:var(--teal);padding:0;text-decoration:underline;}' +
      '.ipg-elect .goto-link:focus-visible{outline:2px solid var(--sage);outline-offset:2px;}' +
      '.ipg-elect .legend{display:flex;flex-wrap:wrap;gap:14px 20px;margin:6px 0 0;font-size:12px;color:var(--ink-soft);}' +
      '.ipg-elect .legend span{display:flex;align-items:center;gap:7px;}' +
      '.ipg-elect .sw{width:15px;height:13px;border-radius:3px;flex:none;}' +
      '.ipg-elect .sw.third{background:var(--teal);}.ipg-elect .sw.self{background:repeating-linear-gradient(135deg,#3E6B53 0 4px,#9DBBA9 4px 8px);}' +
      '.ipg-elect .sw.support{background:var(--sage);}.ipg-elect .sw.oppose{background:var(--coral);}' +
      '.ipg-elect .card{background:var(--paper);border:1px solid var(--line);border-radius:var(--r);padding:22px 24px;margin:0 0 16px;}' +
      '.ipg-elect .card-top{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px;}' +
      '.ipg-elect .cand-name{font-family:var(--display);font-weight:600;font-size:21px;margin:0;}' +
      '.ipg-elect .chip-inc{font-size:11px;font-weight:500;color:var(--teal);background:#E5EFE9;border-radius:20px;padding:2px 10px;}' +
      '.ipg-elect .chip-self{font-size:11px;font-weight:500;color:var(--coral);background:#F4E3DC;border-radius:20px;padding:2px 10px;}' +
      '.ipg-elect .committee{font-size:12.5px;color:var(--ink-soft);margin:0 0 18px;}' +
      '.ipg-elect .bars{display:flex;flex-direction:column;gap:13px;}' +
      '.ipg-elect .barrow{display:grid;grid-template-columns:170px 1fr 140px;align-items:center;gap:12px;}' +
      '.ipg-elect button.barrow{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);text-align:left;width:calc(100% + 16px);padding:6px 8px;margin:-6px -8px;border-radius:8px;}' +
      '.ipg-elect button.barrow:hover{background:#F2E8DC;}' +
      '.ipg-elect button.barrow:focus-visible{outline:2px solid var(--sage);outline-offset:1px;}' +
      '.ipg-elect .barlabel{font-size:12.5px;color:var(--ink-soft);display:flex;align-items:center;gap:6px;}' +
      '.ipg-elect .caret{font-size:10px;color:var(--teal);transition:transform .2s;}' +
      '.ipg-elect button.barrow[aria-expanded="true"] .caret{transform:rotate(90deg);}' +
      '.ipg-elect .contrib{max-height:0;overflow:hidden;transition:max-height .3s ease;grid-column:1/-1;}' +
      '.ipg-elect .contrib.open{max-height:none;margin-top:10px;}' +
      '.ipg-elect .show-more{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:12.5px;font-weight:500;color:var(--teal);padding:9px 4px;display:flex;align-items:center;gap:6px;}' +
      '.ipg-elect .show-more[aria-expanded="true"] .caret{transform:rotate(90deg);}' +
      '.ipg-elect .contrib-inner.bare{background:none;border:0;padding:0;border-radius:0;}' +
      '.ipg-elect .contrib-inner{background:var(--cream);border:1px solid var(--line);border-radius:10px;padding:14px 16px;}' +
      '.ipg-elect .contrib-h{font-size:12px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-soft);margin:0 0 10px;}' +
      '.ipg-elect .donor-search{width:100%;box-sizing:border-box;font-family:var(--body);font-size:13px;padding:8px 11px;margin:0 0 10px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);}' +
      '.ipg-elect .donor-search:focus-visible{outline:2px solid var(--sage);outline-offset:1px;}' +
      '.ipg-elect .crow{display:grid;grid-template-columns:1fr auto;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px;}' +
      '.ipg-elect .crow:last-child{border-bottom:0;}' +
      '.ipg-elect .crow .who{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.ipg-elect .crow .amt{font-weight:500;white-space:nowrap;}.ipg-elect .crow .n{font-size:11px;color:var(--ink-soft);font-weight:400;}' +
      '.ipg-elect .tagchip{font-size:10.5px;padding:1px 8px;border-radius:14px;background:var(--tan);color:var(--ink-soft);}' +
      '.ipg-elect .tagchip.self{background:#F4E3DC;color:var(--coral);}' +
      '.ipg-elect .contrib-note{font-size:12px;color:var(--ink-soft);margin:8px 0 0;}' +
      '.ipg-elect .ie-lead{font-size:13.5px;color:var(--ink);margin:0 0 6px;}.ipg-elect .ie-lead b{font-weight:500;}' +
      '.ipg-elect .ie-pac-tag{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--coral);background:#F4E3DC;border-radius:4px;padding:1px 5px;}' +
      '.ipg-elect .paclink{font-size:12px;}' +
      '.ipg-elect .ie-cmte + .ie-cmte{border-top:1px solid var(--line);margin-top:10px;padding-top:10px;}' +
      '.ipg-elect .ie-cmte-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}' +
      '.ipg-elect .ie-cmte-toggle{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:13px;color:var(--ink);text-align:left;padding:4px 6px;margin:-4px -6px;border-radius:6px;}' +
      '.ipg-elect .ie-cmte-toggle:hover{background:#F2E8DC;}.ipg-elect .ie-cmte-toggle b{font-weight:600;}' +
      '.ipg-elect .ie-cmte-toggle[aria-expanded="true"] .caret{transform:rotate(90deg);}' +
      '.ipg-elect .tier2{margin:6px 0 0 6px;border-left:2px solid var(--tan);}' +
      '.ipg-elect .tier2 .contrib-inner{background:#fff;border-radius:0 10px 10px 0;}' +
      '.ipg-elect .framing{font-style:italic;color:var(--coral);}' +
      '.ipg-elect button.funder-row{display:grid;grid-template-columns:1fr auto;gap:10px;width:100%;text-align:left;appearance:none;border:0;border-bottom:1px solid var(--line);background:none;cursor:pointer;font-family:var(--body);padding:7px 4px;align-items:center;}' +
      '.ipg-elect button.funder-row:hover{background:#F2E8DC;}.ipg-elect button.funder-row:focus-visible{outline:2px solid var(--sage);outline-offset:1px;}' +
      '.ipg-elect .crow.plain{cursor:default;}' +
      '.ipg-elect .who .sub{display:block;font-size:11px;font-weight:400;color:var(--ink-soft);margin-top:1px;}' +
      '.ipg-elect .tagchip.ind{background:var(--tan);color:var(--ink-soft);}.ipg-elect .tagchip.flag{background:#F4E3DC;color:var(--coral);}' +
      '.ipg-elect .ipg-modal-overlay{position:fixed;inset:0;background:rgba(52,40,40,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;z-index:99999;overflow:auto;}' +
      '.ipg-elect .ipg-modal{background:var(--paper);border-radius:14px;max-width:560px;width:100%;padding:24px 26px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,.3);}' +
      '.ipg-elect .ipg-modal-close{position:absolute;top:10px;right:14px;appearance:none;border:0;background:none;font-size:24px;line-height:1;color:var(--ink-soft);cursor:pointer;}' +
      '.ipg-elect .modal-kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--teal);font-weight:600;}' +
      '.ipg-elect .modal-name{font-family:var(--display);font-weight:600;font-size:22px;margin:4px 0;}' +
      '.ipg-elect .modal-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;}' +
      '.ipg-elect .modal-note{font-size:12.5px;color:var(--ink-soft);margin:0 0 14px;}' +
      '.ipg-elect .modal-summary{font-size:13px;font-weight:500;margin:0 0 8px;padding-bottom:8px;border-bottom:1px solid var(--line);}' +
      // Donor-popup stat cards (E-2/E-3): TOTAL GIVEN / COMMITTEES FUNDED / CONTRIBUTIONS / CYCLES.
      '.ipg-elect .elect-statgrid{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px;}' +
      '.ipg-elect .elect-stat{flex:1 1 calc(50% - 8px);min-width:120px;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:11px 13px;}' +
      '.ipg-elect .elect-stat .num{font-family:var(--display);font-weight:700;font-size:23px;line-height:1.05;color:var(--teal);white-space:nowrap;}' +
      '.ipg-elect .elect-stat .lab{font-weight:600;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-soft);margin-top:6px;}' +
      // Affiliated-entity rollup card (E-2): combined total (nowrap) + always-shown entity breakdown.
      '.ipg-elect .elect-rollup{background:var(--paper);border:1px solid var(--line);border-left:4px solid var(--sage);border-radius:10px;padding:13px 15px;margin:0 0 14px;}' +
      '.ipg-elect .elect-rollup-kicker{font-weight:600;font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--sage);margin-bottom:6px;}' +
      '.ipg-elect .elect-rollup-total{font-family:var(--display);font-weight:700;font-size:25px;line-height:1;color:var(--teal);white-space:nowrap;}' +
      '.ipg-elect .elect-rollup-sub{font-size:12px;color:var(--ink-soft);margin-top:4px;}' +
      '.ipg-elect .elect-rollup-members{margin-top:10px;}' +
      '.ipg-elect .elect-rollup-member{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);}' +
      '.ipg-elect .elect-rollup-member:last-of-type{border-bottom:none;}' +
      '.ipg-elect .elect-rollup-name{font-size:14px;color:var(--ink);font-weight:600;}' +
      '.ipg-elect .elect-rollup-amt{font-size:14px;color:var(--teal);font-weight:600;white-space:nowrap;}' +
      '.ipg-elect .elect-rollup-role{display:inline-block;font-size:8.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:20px;margin-left:5px;vertical-align:middle;border:1px solid;}' +
      '.ipg-elect .elect-rollup-role.role-parent{background:#DCEAE8;color:var(--teal);border-color:var(--teal);}' +
      '.ipg-elect .elect-rollup-role.role-alt-name{background:#E6EEF0;color:var(--teal);border-color:var(--sage);}' +
      '.ipg-elect .elect-rollup-role.role-affiliated-pac{background:#EFE7D8;color:#7c6f4f;border-color:#9a8e74;}' +
      '.ipg-elect .elect-rollup-role.role-subsidiary{background:#ECE4F1;color:#6d4c91;border-color:#9a7bbf;}' +
      '.ipg-elect .elect-rollup-role.role-related{background:#E9E4DC;color:var(--ink-soft);border-color:#a9a299;}' +
      '.ipg-elect .elect-rollup-note{font-size:11px;color:var(--ink-soft);font-style:italic;margin-top:9px;}' +
      // Browse-donors front-card rollup counts (E-4).
      '.ipg-elect .browse-counts{font-size:12px;color:var(--ink-soft);margin-top:2px;}' +
      '.ipg-elect .rollup-pill{display:inline-block;font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:20px;margin-left:6px;background:#E6EEF0;color:var(--teal);border:1px solid var(--sage);vertical-align:middle;}' +
      // Browse-Donors filter controls (E-1): search + donor-type / industry / flag.
      '.ipg-elect .elect-controls{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 12px;align-items:flex-end;}' +
      '.ipg-elect .elect-field{display:flex;flex-direction:column;gap:4px;}' +
      '.ipg-elect .elect-field.grow{flex:2 1 240px;}' +
      '.ipg-elect .elect-field label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);}' +
      '.ipg-elect .elect-field input,.ipg-elect .elect-field select{font-family:var(--body);font-size:13px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:130px;}' +
      '.ipg-elect .elect-field input{width:100%;box-sizing:border-box;}' +
      '.ipg-elect .elect-field input:focus,.ipg-elect .elect-field select:focus{outline:2px solid var(--sage);outline-offset:1px;}' +
      '.ipg-elect .browse-meta{font-size:12.5px;color:var(--ink-soft);margin:0 0 12px;}' +
      '.ipg-elect .browse-meta .framing{display:block;margin-top:4px;}' +
      '.ipg-elect .clear-filters{appearance:none;border:0;background:none;cursor:pointer;color:var(--sage);font:inherit;font-weight:600;font-size:12.5px;text-decoration:underline;padding:0;margin-left:6px;}' +
      '.ipg-elect .kind{font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;background:var(--tan);color:var(--ink-soft);}' +
      '.ipg-elect .kind.cand{background:#E5EFE9;color:var(--teal);}.ipg-elect .kind.ie{background:#F4E3DC;color:var(--coral);}' +
      '.ipg-elect .subnav{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 16px;border-bottom:2px solid var(--line);}' +
      '.ipg-elect .subtab{appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);font-size:14px;font-weight:500;color:var(--ink-soft);padding:10px 14px;border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:6px 6px 0 0;}' +
      '.ipg-elect .subtab[aria-selected="true"]{color:var(--teal);border-bottom-color:var(--teal);}' +
      '.ipg-elect .subtab:focus-visible{outline:2px solid var(--sage);outline-offset:2px;}' +
      '.ipg-elect .srow{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:11px 15px;margin:0 0 8px;}' +
      '.ipg-elect .sname{font-size:14px;font-weight:500;}' +
      '.ipg-elect .figrow{margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;}' +
      '.ipg-elect .mini{font-size:12px;font-weight:500;border-radius:6px;padding:2px 8px;}' +
      '.ipg-elect .mini.c{background:#E5EFE9;color:var(--teal);}.ipg-elect .mini.s{background:#E4EEEB;color:var(--sage);}.ipg-elect .mini.o{background:#F4E3DC;color:var(--coral);}' +
      '.ipg-elect .ixc{margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;}' +
      '.ipg-elect .cycle-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:16px 0 4px;}' +
      '.ipg-elect .cycle-label{font-size:12px;color:var(--ink-soft);font-weight:500;margin-right:2px;}' +
      '.ipg-elect .chip.cyc[aria-pressed="true"]{background:var(--teal);border-color:var(--teal);color:#fff;}' +
      '.ipg-elect .bartrack{height:18px;background:#EFE6DC;border-radius:5px;overflow:hidden;}' +
      '.ipg-elect .barfill{height:100%;display:flex;}' +
      '.ipg-elect .seg{height:100%;}' +
      '.ipg-elect .seg.third{background:var(--teal);}' +
      '.ipg-elect .seg.self{background:repeating-linear-gradient(135deg,#3E6B53 0 5px,#9DBBA9 5px 10px);}' +
      '.ipg-elect .seg.support{background:var(--sage);}.ipg-elect .seg.oppose{background:var(--coral);}' +
      '.ipg-elect .seg.indep{background:var(--sage);}' +
      // Industry-totals chart (E-6 Level 1): sorted bars, direct (teal) vs independent (sage).
      '.ipg-elect .indchart{margin-top:4px;}' +
      '.ipg-elect button.indbar{width:100%;text-align:left;appearance:none;border:0;background:none;cursor:pointer;font-family:var(--body);padding:7px 6px;border-radius:8px;}' +
      '.ipg-elect button.indbar:hover{background:var(--paper);}' +
      '.ipg-elect button.indbar:focus-visible{outline:2px solid var(--sage);outline-offset:1px;}' +
      '.ipg-elect .indbar-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:3px;}' +
      '.ipg-elect .indbar-label{font-size:13.5px;font-weight:500;color:var(--ink);}' +
      '.ipg-elect .indbar-val{font-size:13.5px;font-weight:600;color:var(--teal);font-variant-numeric:tabular-nums;white-space:nowrap;}' +
      '.ipg-elect .indep-tag{font-size:9px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--sage);border:1px solid var(--sage);border-radius:20px;padding:1px 6px;margin-left:6px;vertical-align:middle;}' +
      '.ipg-elect .ind-legend{display:flex;gap:16px;margin:0 0 10px;font-size:11.5px;color:var(--ink-soft);}' +
      '.ipg-elect .ind-legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px;}' +
      '.ipg-elect .sw.indep{background:var(--sage);}' +
      // Spend-by-candidate grouped view (E-7): race section headers + per-candidate ranking figure.
      '.ipg-elect .racegroup{margin:0 0 20px;}' +
      '.ipg-elect .racehead{font-size:13px;font-weight:600;color:var(--teal);letter-spacing:.01em;margin:0 0 9px;padding-bottom:5px;border-bottom:2px solid var(--line);}' +
      '.ipg-elect .rankfig{font-size:13.5px;font-weight:600;color:var(--teal);font-variant-numeric:tabular-nums;margin-top:3px;}' +
      '.ipg-elect .rankfig .n{font-weight:500;color:var(--ink-soft);font-size:12px;}' +
      '.ipg-elect .srow.empty{background:none;border:1px dashed var(--line);}' +
      '.ipg-elect .srow.empty .sname{color:var(--ink-soft);font-style:italic;font-weight:400;}' +
      '.ipg-elect .badge{font-size:10.5px;font-weight:600;color:var(--ink-soft);background:var(--tan);border-radius:20px;padding:1px 8px;margin-left:6px;}' +
      '.ipg-elect .barval{font-size:13px;font-weight:500;text-align:right;}' +
      '.ipg-elect .barval .sub{display:block;font-size:11px;font-weight:400;color:var(--ink-soft);}' +
      '.ipg-elect .zero{color:#A99B91;font-weight:400;}' +
      '.ipg-elect .selfline{font-size:12px;color:var(--coral);margin:11px 0 0;padding-left:182px;}' +
      '.ipg-elect .selfline b{font-weight:500;}' +
      '.ipg-elect .caption{font-size:11.5px;color:var(--ink-soft);margin:14px 0 0;padding-top:13px;border-top:1px solid var(--line);}' +
      '.ipg-elect .elec-block{margin:0 0 10px;}' +
      '.ipg-elect .elec-block-h{font-family:var(--display);font-weight:600;font-size:18px;color:var(--teal);margin:0 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line);}' +
      '.ipg-elect .elec-divider{height:0;border-top:1px dashed var(--line);margin:22px 0;}' +
      '.ipg-elect .soon{text-align:center;padding:54px 24px;background:var(--paper);border:1px dashed var(--line);border-radius:var(--r);color:var(--ink-soft);}' +
      '.ipg-elect .soon h2{font-family:var(--display);font-weight:600;color:var(--ink);font-size:22px;margin:0 0 8px;}' +
      '.ipg-elect .soon p{margin:0 auto;max-width:46ch;font-size:14px;}' +
      '.ipg-elect footer{margin:34px 0 50px;padding-top:22px;border-top:2px solid var(--line);font-size:12.5px;color:var(--ink-soft);}' +
      '.ipg-elect footer h3{font-family:var(--display);font-weight:600;color:var(--ink);font-size:15px;margin:0 0 8px;}' +
      '.ipg-elect footer p{margin:0 0 12px;max-width:74ch;}.ipg-elect footer .src{font-size:11.5px;}' +
      '@media (max-width:560px){.ipg-elect .barrow{grid-template-columns:1fr;gap:4px;}.ipg-elect .barval{text-align:left;}.ipg-elect .selfline{padding-left:0;}}' +
      '</style>';
  }

  // One figure bar. scale = race-wide max for width. panelId (if given) makes the
  // row a clickable disclosure button controlling a drill-down panel.
  function bar(label, segs, countText, scale, panelId) {
    var sum = 0, i; for (i = 0; i < segs.length; i++) sum += segs[i].v;
    var fillW = scale > 0 ? Math.min(100, (sum / scale) * 100) : 0;
    var inner = '';
    for (i = 0; i < segs.length; i++) {
      if (segs[i].v <= 0) continue;
      var w = sum > 0 ? (segs[i].v / sum * 100) : 0;
      inner += '<div class="seg ' + segs[i].cls + '" style="width:' + w + '%"></div>';
    }
    var val = sum > 0
      ? (money(sum) + (countText ? '<span class="sub">' + esc(countText) + '</span>' : ''))
      : '<span class="zero">none reported</span>';
    var labelHtml = panelId
      ? '<span class="barlabel"><span class="caret" aria-hidden="true">▸</span>' + esc(label) + '</span>'
      : '<span class="barlabel">' + esc(label) + '</span>';
    var body = labelHtml +
      '<div class="bartrack"><div class="barfill" style="width:' + fillW + '%">' + inner + '</div></div>' +
      '<div class="barval">' + val + '</div>';
    return panelId
      ? '<button class="barrow click" type="button" aria-expanded="false" aria-controls="' + panelId + '">' + body + '</button>'
      : '<div class="barrow">' + body + '</div>';
  }

  // Shared donor-row render path — used by the contributor drill-down AND the
  // Tier-2 PAC-funder list, so a direct contributor behaves exactly like a PAC
  // funder: real rolled-up donors (by parent_id) are clickable into the Tier-3
  // footprint modal and show their tags/flags. The small-dollar aggregate and the
  // candidate self-funding/loan line are NOT donor entities — labeled lines only,
  // no modal, no tag.
  function donorRow(line) {
    var amt = '<div class="amt">' + money(line.total) +
      (line.count ? ' <span class="n">· ' + plural(line.count, 'gift', 'gifts') + '</span>' : '') + '</div>';
    if (line.isSelf) {
      return '<div class="crow plain"><div class="who">' + esc(line.name) +
        ' <span class="tagchip self">Candidate’s own money / loans</span></div>' + amt + '</div>';
    }
    if (line.isAggregate) {
      return '<div class="crow plain"><div class="who">' + esc(line.name) + '</div>' + amt + '</div>';
    }
    return '<button class="crow funder-row" type="button" data-funder="' + esc(line.parent_id) + '">' +
      '<div class="who">' + esc(line.name) + ' ' + tagsHtml(line.industries, line.flags) + '</div>' + amt + '</button>';
  }

  // Contributor drill-down panel (collapsed; app toggles .open). Top 25 real
  // donors, then a "Show all N donors" toggle revealing the FULL remainder inline
  // (mirrors the council embed's single show-all toggle) — every remainder row is
  // a real, clickable donorRow. The small-dollar aggregate is a labeled,
  // non-clickable line pinned at the bottom. All rows (top + remainder + aggregate
  // + self) are in the DOM, so they sum EXACTLY to the contributions headline.
  function contributorPanel(cd, id) {
    var rest = [], agg = [], realCount = 0, t;   // N counts REAL donors only (excl. self + small-dollar)
    for (t = 0; t < cd.lines.length; t++) {
      var l = cd.lines[t];
      if (l.isAggregate) { agg.push(l); continue; }
      rest.push(l);
      if (!l.isSelf) realCount++;
    }
    var LIMIT = 25, top = '';
    for (t = 0; t < Math.min(LIMIT, rest.length); t++) top += donorRow(rest[t]);
    var moreHtml = '';
    if (rest.length > LIMIT) {
      var moreRows = ''; for (t = LIMIT; t < rest.length; t++) moreRows += donorRow(rest[t]);
      var mid = id + '-more';
      moreHtml = '<button class="show-more" type="button" aria-expanded="false" aria-controls="' + mid + '">' +
        '<span class="caret" aria-hidden="true">▸</span> Show all ' + realCount + ' donors</button>' +
        '<div class="contrib tall" id="' + mid + '"><div class="contrib-inner bare">' + moreRows + '</div></div>';
    }
    var aggHtml = ''; for (t = 0; t < agg.length; t++) aggHtml += donorRow(agg[t]);
    return '<div class="contrib" id="' + id + '"><div class="contrib-inner">' +
      '<p class="contrib-h">Who gave to this campaign · ' + money(cd.total) + ' total</p>' +
      (realCount > 8 ? '<input class="donor-search" type="search" placeholder="Search donors…" aria-label="Search donors" data-donor-search>' : '') +
      top + moreHtml + aggHtml +
      '<p class="contrib-note">Rolled up by affiliation; lines sum to the contributions figure. Click a donor to see ' +
      'their full footprint. Small-dollar (under $150) donors are disclosed only in aggregate.</p></div></div>';
  }

  // IE drill-down — THREE explicit tiers so a funder never reads as a direct
  // opponent/supporter:
  //   Tier 1 (this panel): the IE COMMITTEE(s) that spent for/against — amount,
  //     stance, Sunshine. NOT the funders.
  //   Tier 2 (click a committee): that committee's second-hop funders (dues
  //     excluded), with explicit "gave this committee over time, not this race"
  //     framing and a plain-language identity line.
  //   Tier 3 (click a funder): the donor-footprint modal (app opens it).
  function iePanel(detail, candName, id) {
    var verb = detail.stance === 'oppose' ? 'against' : 'for';
    var verbing = detail.stance === 'oppose' ? 'opposing' : 'supporting';
    var committees = detail.spenders.map(function (s, idx) {
      var t2 = id + '-' + idx;
      var sun = s.sunshineUrl ? ' <a class="paclink" href="' + esc(s.sunshineUrl) +
        '" target="_blank" rel="noopener">Illinois Sunshine ↗</a>' : '';
      var names = s.topFunders.map(function (f) { return esc(f.name); });
      var primarily = names.length ? ('Funded primarily by ' + names.join(', ') + '.') : 'No outside funding recorded.';
      var fLimit = 10, frows = '';
      for (var i = 0; i < Math.min(fLimit, s.funders.length); i++) frows += donorRow(s.funders[i]);  // shared donor-row path
      var more = '';
      if (s.funders.length > fLimit) {        // expandable tail (same as the contributor "show all")
        var moreRows = ''; for (var j = fLimit; j < s.funders.length; j++) moreRows += donorRow(s.funders[j]);
        var fid = t2 + '-f';
        more = '<button class="show-more" type="button" aria-expanded="false" aria-controls="' + fid + '">' +
          '<span class="caret" aria-hidden="true">▸</span> Show all ' + s.funders.length + ' funders</button>' +
          '<div class="contrib tall" id="' + fid + '"><div class="contrib-inner bare">' + moreRows + '</div></div>';
      }
      var cn = ieNaming(s.committeeName, names);
      return '<div class="ie-cmte"><div class="ie-cmte-head">' +
        '<button class="ie-cmte-toggle" type="button" aria-expanded="false" aria-controls="' + t2 + '">' +
        '<span class="caret" aria-hidden="true">▸</span> <b>' + money(s.amount) + ' ' + verb + '</b> ' + verbing + ' ' +
        esc(candName) + ' · <span class="ie-pac-tag">IE PAC</span> ' + cn.primary +
        ((s.industryTags && s.industryTags.length) ? ' ' + s.industryTags.map(function (tg) { return '<span class="tagchip ind">' + esc(prettyTag(tg)) + '</span>'; }).join('') : '') +
        (s.needsReview ? ' <span class="tagchip flag" title="match: ' + esc((s.matchMethods || []).join(', ')) + '">⚑ needs review</span>' : '') +
        '</button>' + sun + '</div>' +
        '<div class="contrib tier2" id="' + t2 + '"><div class="contrib-inner">' +
          '<p class="ie-lead">' + primarily + '</p>' +
          '<p class="contrib-note framing">Amounts below are what each donor gave <b>this committee</b> over time — ' +
          'not money spent on this race.</p>' +
          '<p class="contrib-h">Who funds this committee · ' + money(s.funderTotal) + ' from ' +
          plural(s.funderCount, 'funder', 'funders') + ' (dues excluded)</p>' + frows + more +
        '</div></div></div>';
    }).join('');
    return '<div class="contrib" id="' + id + '"><div class="contrib-inner">' +
      '<p class="contrib-h">Outside spending ' + verbing + ' ' + esc(candName) + '</p>' +
      '<p class="contrib-note">Independent-expenditure committees — outside groups not coordinated with the campaign. ' +
      'Click a committee to see who funds it.</p>' + committees + '</div></div>';
  }

  // Tier 3 — donor-footprint modal (app mounts/unmounts it). Election-scoped.
  // Committee rows show the committee NAME, never the bare id: candidate
  // committees use their real name; placeholder IE PACs use the identity
  // treatment ("Funded primarily by …"). Each row is clickable -> committee profile.
  function renderFunderModal(fp) {
    var rows = fp.committees.map(function (x) {
      var who;
      if (x.kind === 'ie') {
        var nm = ieNaming(x.label, x.ieIdentity);
        who = nm.primary + ' <span class="kind ie">IE PAC</span>' + (nm.subtitle ? '<div class="sub">' + nm.subtitle + '</div>' : '');
      } else if (x.kind === 'candidate') {
        who = esc(x.label) + ' <span class="kind cand">candidate</span>';
      } else { who = esc(x.label) + ' <span class="kind">committee</span>'; }
      return '<button class="crow funder-row" type="button" data-committee="' + esc(x.committee_id) + '">' +
        '<div class="who">' + who + '</div>' +
        '<div class="amt">' + money(x.total) + ' <span class="n">· ' + plural(x.count, 'gift', 'gifts') + '</span></div></button>';
    }).join('') || '<p class="contrib-note">No election giving recorded.</p>';
    // Four stat cards (E-2/E-3) + chronological cycle line (pre-YYYY first).
    var stat = function (num, lab) { return '<div class="elect-stat"><div class="num">' + num + '</div><div class="lab">' + lab + '</div></div>'; };
    var cyc = fp.cycles || [];
    var statgrid = '<div class="elect-statgrid">' + stat(money(fp.total), 'Total given') +
      stat(fp.count, 'Committees funded') + stat(fp.contributionsCount || 0, 'Contributions') +
      stat(cyc.length, 'Cycles') + '</div>';
    var cycLine = cyc.length ? '<p class="browse-counts" style="margin:-8px 0 14px">Cycles: ' + cyc.map(esc).join(' · ') + '</p>' : '';
    // Affiliated-entity rollup card (E-2): single-stream sum, firewall-clean. Always shows
    // the per-entity breakdown with PARENT / ALTERNATE NAME role pills + the disclaimer.
    var rc = '';
    if (fp.rollup) {
      var rl = fp.rollup;
      var roleLabel = function (r) { return ({ parent: 'Parent', 'alt-name': 'Alternate name', 'affiliated-pac': 'Affiliated PAC', subsidiary: 'Subsidiary', related: 'Related' })[r] || r; };
      var mem = rl.members.map(function (m) {
        return '<div class="elect-rollup-member"><div><span class="elect-rollup-name">' + esc(m.name) + '</span>' +
          ' <span class="elect-rollup-role role-' + esc(m.role) + '">' + esc(roleLabel(m.role)) + '</span></div>' +
          '<div class="elect-rollup-amt">' + money(m.amount) + '</div></div>';
      }).join('');
      rc = '<div class="elect-rollup">' +
        '<div class="elect-rollup-kicker">Rollup · ' + esc(rl.relationship) + '</div>' +
        '<div class="elect-rollup-total">' + money(rl.total) + '</div>' +
        '<div class="elect-rollup-sub">combined across ' + rl.entities + ' affiliated ' + (rl.entities === 1 ? 'entity' : 'entities') + '</div>' +
        '<div class="elect-rollup-members">' + mem + '</div>' +
        '<div class="elect-rollup-note">Each entity stays a distinct, source-traceable donor; the total is their sum, not a merged record.</div>' +
        '</div>';
    }
    var wA = fp.win ? (' data-win-start="' + esc(fp.win.start || '') + '" data-win-end="' + esc(fp.win.end || '') + '"') : '';
    return '<div class="ipg-modal-overlay" data-modal-overlay' + wA + '><div class="ipg-modal" role="dialog" aria-modal="true" aria-label="Donor footprint">' +
      '<button class="ipg-modal-close" type="button" data-modal-close aria-label="Close">×</button>' +
      '<div class="modal-kicker">Donor footprint · this election only</div>' +
      '<div class="modal-name">' + esc(fp.name) + '</div>' +
      '<div class="modal-tags">' + tagsHtml(fp.industries, fp.flags, fp.industryTags) + '</div>' +
      '<p class="modal-note">Everything <b>' + esc(fp.name) + '</b> has given within the 2026 Board of Education data — ' +
      'direct contributions and money into independent-expenditure committees. Council-side giving is a separate, ' +
      'not-yet-connected view.</p>' +
      statgrid + cycLine + rc +
      '<div class="modal-summary">' + money(fp.total) + ' across ' + plural(fp.count, 'recipient', 'recipients') + '</div>' +
      rows + '</div></div>';
  }

  // Committee-profile modal — bidirectional with the donor footprint. Same modal
  // system (app mounts/closes it the same way). Its funder/contributor rows are
  // donorRows (clickable back into a footprint).
  function renderCommitteeProfile(p) {
    var sun = p.sunshineUrl ? ' <a class="paclink" href="' + esc(p.sunshineUrl) + '" target="_blank" rel="noopener">Illinois Sunshine ↗</a>' : '';
    var head, summary, spent = '';
    if (p.isIE) {
      var idy = (p.identity && p.identity.length) ? ('Funded primarily by ' + p.identity.join(', ') + '. ') : '';
      head = '<div class="modal-kicker">Independent-expenditure committee · this election</div>' +
        '<div class="modal-name"><span class="ie-pac-tag">IE PAC</span> ' + ieNaming(p.name, p.identity).primary + '</div>' +
        '<p class="modal-note">' + idy + 'Independent spending is made without coordinating with any candidate.' + sun + '</p>';
      // IE summary boxes (E-3), council parity. FIREWALL: Spent to support and Spent to oppose
      // are SEPARATE boxes — never fused. "Total independent spend" is this ONE committee's own
      // outflow (support + oppose; IE committees make no direct contributions), the single-stream
      // own-spend total council shows — NOT a per-candidate or cross-stream sum.
      var ieStat = function (num, lab) { return '<div class="elect-stat"><div class="num">' + num + '</div><div class="lab">' + lab + '</div></div>'; };
      var tset = {}; (p.targets || []).forEach(function (t) { tset[t.candidate_id || ('n:' + t.name)] = 1; });
      var nTargets = Object.keys(tset).length;
      summary = '<div class="elect-statgrid">' +
        ieStat(money(p.total), 'Total independent spend') +
        ieStat(money(p.support), 'Spent to support') +
        ieStat(money(p.oppose), 'Spent to oppose') +
        ieStat(nTargets, nTargets === 1 ? 'Candidate targeted' : 'Candidates targeted') +
        '</div>';
      spent = '<p class="contrib-h">What it spent on</p>' +
        '<p class="contrib-note">Each line is one candidate in one election. Support and opposition are ' +
        'separate streams, never summed; the election label keeps a past-race spend from reading as this race.</p>' +
        (p.targets.length ? p.targets.map(function (t) {
        var bits = [];
        if (t.support) bits.push('<span style="color:var(--sage)">' + money(t.support) + ' for</span>');
        if (t.oppose) bits.push('<span style="color:var(--coral)">' + money(t.oppose) + ' against</span>');
        var lab = t.electionLabel || t.raceLabel;
        var rev = t.needsReview ? ' <span class="tagchip flag" title="match: ' + esc((t.matchMethods || []).join(', ')) + '">⚑ needs review</span>' : '';
        return '<div class="crow"><div class="who">' + esc(t.name) +
          (lab ? ' <span class="muted">· ' + esc(lab) + '</span>' : '') + rev + '</div>' +
          '<div class="amt">' + bits.join(' · ') + '</div></div>';
      }).join('') : '<p class="contrib-note">No itemized spending recorded.</p>');
    } else {
      head = '<div class="modal-kicker">Campaign committee · this election</div>' +
        '<div class="modal-name">' + esc(p.name) + '</div>' +
        '<p class="modal-note">Campaign committee' + (p.candidateName ? ' for <b>' + esc(p.candidateName) + '</b>' : '') +
        (p.raceLabel ? ' — ' + esc(p.raceLabel) : '') + '.' + sun + '</p>';
      summary = '<div class="modal-summary">' + money(p.raised) + ' raised</div>';
    }
    var label = p.isIE
      ? ('Who funds this committee · ' + money(p.funderTotal) + ' from ' + plural(p.funderCount, 'funder', 'funders') + ' (dues excluded)')
      : ('Contributors · ' + money(p.funderTotal) + ' from ' + plural(p.funderCount, 'donor', 'donors'));
    var fl = p.funders.slice(0, 30), funders = '';
    for (var i = 0; i < fl.length; i++) funders += donorRow(fl[i]);
    var moreF = p.funders.length > 30 ? '<p class="contrib-note">+ ' + (p.funders.length - 30) + ' more</p>' : '';
    var wA = p.win ? (' data-win-start="' + esc(p.win.start || '') + '" data-win-end="' + esc(p.win.end || '') + '"') : '';
    return '<div class="ipg-modal-overlay" data-modal-overlay' + wA + '><div class="ipg-modal" role="dialog" aria-modal="true" aria-label="Committee profile">' +
      '<button class="ipg-modal-close" type="button" data-modal-close aria-label="Close">×</button>' +
      head + summary + spent + '<p class="contrib-h" style="margin-top:14px">' + label + '</p>' + funders + moreF + '</div></div>';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function card(c, scale) {
    var f = c.figures;
    var mostlySelf = f.contributions.total > 0 && (f.contributions.selfFunded / f.contributions.total) >= 0.5;
    var chips = (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') +
      (mostlySelf ? '<span class="chip-self">Mostly self-funded</span>' : '');
    var base = 'd-' + esc(c.slug);
    var hasSup = f.independentSupport > 0, hasOpp = f.independentOpposition > 0;
    var contribBar = bar('From contributors',
      [{ cls: 'third', v: f.contributions.thirdParty }, { cls: 'self', v: f.contributions.selfFunded }],
      plural(f.contributions.count, 'contribution', 'contributions'), scale, base + '-c');
    var contribPanel = contributorPanel(c.contributors, base + '-c');
    var supportBar = bar('Independent support', [{ cls: 'support', v: f.independentSupport }],
      f.independentSupportCount ? plural(f.independentSupportCount, 'expenditure', 'expenditures') : '', scale, hasSup ? base + '-s' : null);
    var supportPanel = hasSup ? iePanel(c.ieSupportDetail, c.name, base + '-s') : '';
    var opposeBar = bar('Independent opposition', [{ cls: 'oppose', v: f.independentOpposition }],
      f.independentOppositionCount ? plural(f.independentOppositionCount, 'expenditure', 'expenditures') : '', scale, hasOpp ? base + '-o' : null);
    var opposePanel = hasOpp ? iePanel(c.ieOpposeDetail, c.name, base + '-o') : '';
    var selfLine = f.contributions.selfFunded > 0
      ? '<p class="selfline"><b>' + money(f.contributions.selfFunded) + '</b> is the candidate’s own money or loans · <b>' +
        money(f.contributions.thirdParty) + '</b> from other donors</p>' : '';
    var committeeLine = (c.committee && c.committee.name)
      ? '<p class="committee">Committee: ' + esc(c.committee.name) +
        (c.committee.sunshineUrl ? ' · <a href="' + esc(c.committee.sunshineUrl) + '" target="_blank" rel="noopener">Illinois Sunshine ↗</a>' : '') + '</p>'
      : '';
    return '<article class="card" id="cand-' + esc(c.slug) + '">' +
      '<div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' + chips + '</div>' + committeeLine +
      '<div class="bars">' + contribBar + contribPanel + supportBar + supportPanel + opposeBar + opposePanel + '</div>' + selfLine +
      '<p class="caption">Independent support and opposition are spending by outside groups, reported by those ' +
      'groups and not coordinated with the campaign. Figures are shown separately, never added together.</p></article>';
  }

  function legend() {
    return '<div class="legend" aria-hidden="true">' +
      '<span><i class="sw third"></i>From other donors</span>' +
      '<span><i class="sw self"></i>Candidate’s own money / loans</span>' +
      '<span><i class="sw support"></i>Independent support</span>' +
      '<span><i class="sw oppose"></i>Independent opposition</span></div>';
  }

  function pendingCard(c) {
    return '<article class="card"><div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' +
      (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') + '</div>' +
      '<p class="committee">Finance data still populating — committee not yet identified.</p></article>';
  }

  // ---- This / Last / All-Elections toggle (vm = data.viewModels.raceElections) ----
  // Pure: `active` selects which view to emit — an election id ("this"/last) or
  // "all". Each view shows the FOUR streams as SEPARATE bars (contributions,
  // self-funding, independent support, independent opposition), NEVER summed.
  // "All elections" emits each election as its OWN segmented block under its own
  // (boundary-specific) label — never merged into one cross-election total.
  function elecScale(vm) {
    var s = 1, i, e;
    for (i = 0; i < vm.candidates.length; i++) {
      var be = vm.candidates[i].byElection;
      for (e in be) {
        if (!be.hasOwnProperty(e)) continue;
        var f = be[e].figures; if (!f) continue;
        s = Math.max(s, f.contributions, f.selfFunding, f.independentSupport, f.independentOpposition);
      }
    }
    return s;
  }
  function elecHasMoney(f) {
    return !!f && (f.contributions > 0 || f.selfFunding > 0 || f.independentSupport > 0 || f.independentOpposition > 0);
  }
  // Per-election industry composition strip (reuses the spend-tab tagchip markup).
  // Uncategorized donors render as "uncategorized" honestly, never dropped.
  function elecIndustries(industries) {
    if (!industries || !industries.length) return '';
    var chips = industries.slice(0, 8).map(function (i) {
      var label = (i.industry === 'unclassified' || i.industry === 'uncategorized') ? 'uncategorized' : prettyTag(i.industry);
      return '<span class="tagchip ind">' + esc(label) + ' ' + money(i.total) + '</span>';
    }).join('');
    return '<p class="contrib-h" style="margin-top:14px">Industries this election</p><div class="ixc">' + chips + '</div>';
  }
  // Four separate stream bars (HALT-2.5 model preserved). contributions / IE-support /
  // IE-oppose are CLICKABLE -> the council drill-down panels (contributorPanel/iePanel),
  // date-window-sliced. Self-funding stays a value bar; its distinct non-clickable line
  // appears inside the contributor drill-down via donorRow's isSelf treatment.
  function elecStreams(ev, candName, scale, base) {
    var f = ev.figures;
    if (!f) return '<p class="contrib-note">No money reported for this election.</p>';
    var hasC = f.contributions > 0 || f.selfFunding > 0, hasS = f.independentSupport > 0, hasO = f.independentOpposition > 0;
    var cBar = bar('From contributors', [{ cls: 'third', v: f.contributions }],
      f.contributionsCount ? plural(f.contributionsCount, 'contribution', 'contributions') : '', scale, hasC ? base + '-c' : null);
    var cPanel = hasC && ev.contributors ? contributorPanel(ev.contributors, base + '-c') : '';
    var selfBar = bar('Candidate self-funding', [{ cls: 'self', v: f.selfFunding }],
      f.selfFundingCount ? plural(f.selfFundingCount, 'gift or loan', 'gifts or loans') : '', scale);
    var sBar = bar('Independent support', [{ cls: 'support', v: f.independentSupport }],
      f.independentSupportCount ? plural(f.independentSupportCount, 'expenditure', 'expenditures') : '', scale, hasS ? base + '-s' : null);
    var sPanel = hasS && ev.ieSupportDetail ? iePanel(ev.ieSupportDetail, candName, base + '-s') : '';
    var oBar = bar('Independent opposition', [{ cls: 'oppose', v: f.independentOpposition }],
      f.independentOppositionCount ? plural(f.independentOppositionCount, 'expenditure', 'expenditures') : '', scale, hasO ? base + '-o' : null);
    var oPanel = hasO && ev.ieOpposeDetail ? iePanel(ev.ieOpposeDetail, candName, base + '-o') : '';
    return '<div class="bars">' + cBar + cPanel + selfBar + sBar + sPanel + oBar + oPanel + '</div>' +
      elecIndustries(ev.industries);
  }
  // State machine for a candidate's header in a given election. For the prior (Last)
  // election: (i) prior_election present -> its own label (split-origin safe, never a
  // 2026 subdistrict id); (ii) no prior_election but 2024 money present -> "did not
  // run" transparency framing; (iii) no prior + no money -> generic label, empty bars.
  function elecHeader(c, eid, role) {
    var ev = c.byElection[eid] || { label: eid, figures: null };
    if (role === 'prior') {
      if (c.priorElection && c.priorElection.label) return { header: c.priorElection.label, subnote: c.priorElection.qualifier || '' };
      if (elecHasMoney(ev.figures)) {
        return { header: eid + ' (did not run)',
          subnote: 'Committee activity dated to ' + eid + ' — shown for transparency, not a ' + eid + ' candidacy.' };
      }
    }
    return { header: ev.label || eid, subnote: '' };
  }
  function elecCandBlock(c, eid, role, scale) {
    var ev = c.byElection[eid] || { label: eid, figures: null };
    var h = elecHeader(c, eid, role);
    var base = 'elec-' + esc(c.slug) + '-' + esc(eid);
    // data-win-* lets the app scope a donor-footprint modal opened from this panel to
    // the election's date window (Gate G), not the whole 4-year cycle.
    var win = ev.win || {};
    var winAttrs = ' data-win-start="' + esc(win.start || '') + '" data-win-end="' + esc(win.end || '') + '"';
    return '<article class="card" id="' + base + '"' + winAttrs + '>' +
      '<div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' +
      (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') +
      '<span class="race-meta">· ' + esc(h.header) + '</span></div>' +
      (h.subnote ? '<p class="contrib-note">' + esc(h.subnote) + '</p>' : '') +
      elecStreams(ev, c.name, scale, base) + '</article>';
  }
  // (elecAnyMoney / elecUndatedSection removed with the segmented "All elections" view —
  // All elections is now ONE combined cross-election total per candidate, see
  // elecCombinedBlock. The dateless small-dollar aggregate is outside both election
  // windows, so it is excluded from the combined total by construction.)
  // "All elections" = ONE combined cross-election total per (2026) candidate. FIREWALL:
  // explicitly labeled as spanning both elections, with the 2024 portion keeping its
  // "2024: District N" provenance so a returner's combined total visibly comprises two
  // different districts -- it can never read as single-race spending. Reuses elecStreams
  // (c.combined has the same shape: figures + windowed drill-down). Streams stay separate.
  function raceOfficeFriendly(o) {
    return ({ school_board_member: 'board-member', school_board_president: 'board president',
              alderperson: 'alderperson', mayor: 'mayor', school_board_president_label: 'board president' })[o] || o;
  }
  function elecCombinedBlock(c, scale, raceOffice) {
    var ev = c.combined;
    if (!ev || !elecHasMoney(ev.figures)) return '';
    var win = ev.win || {};
    var winAttrs = ' data-win-start="' + esc(win.start || '') + '" data-win-end="' + esc(win.end || '') + '"';
    var base = 'eleccomb-' + esc(c.slug);
    var e24 = c.byElection['2024'];
    var has24 = e24 && elecHasMoney(e24.figures);
    var pe = c.priorElection || {};
    // STRUCTURAL office-change detection: the prior election's office differs from the
    // current race office (e.g. a 2024 board-MEMBER seat -> the 2026 board-PRESIDENT seat).
    // Generalizes to any future office-changer; NOT a Biggs/Custer special-case.
    var officeChange = has24 && pe.office && raceOffice && pe.office !== raceOffice;
    var meta, prov;
    if (officeChange) {
      var distN = String(pe.label || '').replace(/^\s*\d+:\s*/, '');   // "2024: District 6" -> "District 6"
      meta = '· across two offices (2024 + 2026)';
      prov = 'This total combines ' + esc(c.name) + '’s 2024 campaign for the ' + esc(distN) + ' ' +
        esc(raceOfficeFriendly(pe.office)) + ' seat and their 2026 campaign for ' + esc(raceOfficeFriendly(raceOffice)) +
        ' — <b>two different offices</b>. It is a cross-election sum across <b>different offices</b>, ' +
        '<b>not single-race spending</b>. Per-election detail is in the This / Last tabs.';
    } else if (has24) {
      meta = '· across both elections (2024 + 2026)';
      prov = 'This total combines <b>two separate elections under redrawn district boundaries</b> — ' +
        esc(e24.label) + ' and 2026 — so it spans two <b>different</b> districts. It is a cross-election sum, ' +
        '<b>not single-race spending</b>. Per-election detail is in the This / Last tabs.';
    } else {
      meta = '· 2026 election only';
      prov = 'From the 2026 election only (no 2024 election money to combine).';
    }
    return '<article class="card" id="' + base + '"' + winAttrs + '>' +
      '<div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' +
      (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') +
      '<span class="race-meta">' + meta + '</span></div>' +
      '<p class="contrib-note">' + prov + '</p>' +
      elecStreams(ev, c.name, scale, base) + '</article>';
  }
  function renderRaceElections(vm, active) {
    if (!vm || !vm.toggles.length) return '';
    active = active || vm.toggles[0].id;     // default = "this" (current) election
    var scale = elecScale(vm);
    var roleOf = {}; vm.toggles.forEach(function (t) { roleOf[t.id] = t.role; });
    var tabs = vm.toggles.map(function (t) {
      return '<button class="subtab" role="tab" data-electionview="' + esc(t.id) + '" aria-selected="' +
        (active === t.id) + '">' + esc(t.label) + '</button>';
    }).join('') +
      '<button class="subtab" role="tab" data-electionview="all" aria-selected="' + (active === 'all') + '">All elections</button>';
    var nav = '<div class="subnav" role="tablist" aria-label="Election">' + tabs + '</div>';
    var note = '<p class="contrib-note">Money is bucketed by filing date to each election. The four figures — ' +
      'contributions, candidate self-funding, independent support, and independent opposition — are shown ' +
      '<b>separately and never added together</b>.</p>';
    var body;
    if (active === 'all') {
      var combScale = 1;
      vm.candidates.forEach(function (c) {
        var f = c.combined && c.combined.figures; if (!f) return;
        combScale = Math.max(combScale, f.contributions, f.selfFunding, f.independentSupport, f.independentOpposition);
      });
      body = '<p class="contrib-note"><b>“All elections” combines each candidate’s 2024 and 2026 money</b> into one total ' +
        'per stream (streams still separate). The districts were <b>redrawn between the two elections</b>, so a combined ' +
        'total spans two different districts — it is a <b>cross-election sum, not single-race spending</b>. The 2024 ' +
        'portion keeps its “2024: District N” label.</p>' +
        vm.candidates.map(function (c) { return elecCombinedBlock(c, combScale, vm.race.office); }).filter(Boolean).join('');
    } else {
      body = vm.candidates.map(function (c) { return elecCandBlock(c, active, roleOf[active], scale); }).join('');
    }
    return '<div class="elections" data-race="' + esc(vm.race.slug) + '">' + nav + note + legend() +
      '<div style="height:14px"></div>' + body + '</div>';
  }

  // Race view: head + vacating-incumbent note(s) + legend + candidate cards
  // (neutral order from the data layer; the three figures never summed).
  function renderRaceView(vm, electionView) {
    if (!vm) return '<div class="soon"><h2>Race not found</h2></div>';
    var vac = (vm.race.vacating || []).map(function (v) {
      return '<p class="vacating-note">↳ Current member <b>' + esc(v.name) + '</b> is running for ' +
        '<button class="goto-link" type="button" data-slug="' + esc(v.targetSlug) + '">' + esc(v.targetLabel) + ' →</button></p>';
    }).join('');
    var meta = plural(vm.candidates.length, 'candidate', 'candidates') +
      (vm.cycle ? ' · cycle ' + esc(vm.cycle) : ' · all years');
    var head = '<div class="race-head"><h2>' + esc(vm.race.label) + '</h2>' +
      '<span class="race-meta">' + meta + '</span></div>' + vac;

    // Races wired for the per-election toggle (the loaded cohort, gated in data.js
    // TOGGLE_RACES) render the This/Last/All view instead of the single all-years
    // cards. electionView (from app state) selects the active tab.
    if (vm.elections) return head + renderRaceElections(vm.elections, electionView);

    if (!vm.candidates.length) {
      return head + '<div class="soon"><h2>Field forming</h2>' +
        '<p>No candidate committees are processed for this race yet. Check back as the field fills in.</p></div>';
    }
    var live = vm.candidates.filter(function (c) { return c.hasFinance; });
    if (!live.length) return head + vm.candidates.map(pendingCard).join('');

    var scale = 1;
    for (var i = 0; i < vm.candidates.length; i++) {
      var f = vm.candidates[i].figures; if (!f) continue;
      scale = Math.max(scale, f.contributions.total, f.independentSupport, f.independentOpposition);
    }
    var anyPending = vm.candidates.some(function (c) { return !c.hasFinance; });
    var cards = vm.candidates.map(function (c) { return c.hasFinance ? card(c, scale) : pendingCard(c); }).join('');
    return head +
      (anyPending ? '<p class="field-note">▸ <span><b>Field still being added.</b> Candidates with registered ' +
        'committees are shown; others appear as they file and finance is processed.</span></p>' : '') +
      legend() + '<div style="height:18px"></div>' + cards;
  }

  function renderComingSoon(label) {
    return '<div class="soon"><h2>' + esc(label) + ' — coming soon</h2>' +
      '<p>We’re adding candidates and campaign-finance data for this race. Check back as the field fills in.</p></div>';
  }

  // Office nav (sub-tabs) + race picker chips.
  function renderOfficeNav(omVM, activeSlug) {
    var groups = omVM.groups;
    var multi = groups.length > 1;
    var nav = '';
    if (multi) {
      nav = '<nav class="offices" role="tablist" aria-label="Office section">' + groups.map(function (g) {
        var sel = g.races.some(function (r) { return r.slug === activeSlug; });
        return '<button class="office" role="tab" data-group="' + esc(g.label) + '" aria-selected="' + sel + '">' +
          esc(g.label) + (g.races.length > 1 ? ' <span class="tag">' + g.races.length + ' seats</span>' : '') + '</button>';
      }).join('') + '</nav>';
    }
    // chips for the group that owns the active race (or the first group)
    var active = null;
    for (var gi = 0; gi < groups.length; gi++) if (groups[gi].races.some(function (r) { return r.slug === activeSlug; })) active = groups[gi];
    if (!active) active = groups[0] || { races: [] };
    var chips = active.races.map(function (r) {
      return '<button class="chip" data-status="' + (r.hasFinance ? 'live' : 'soon') + '" data-slug="' + esc(r.slug) + '" ' +
        'aria-pressed="' + (r.slug === activeSlug) + '">' + esc(r.code) + (r.hasFinance ? '' : ' · soon') + '</button>';
    }).join('');
    return nav + '<div class="districts" role="group" aria-label="Race">' + chips + '</div>' +
      '<p class="picker-note">Races with processed campaign-finance data are live; the rest fill in as candidates file.</p>';
  }

  function masthead(office, topView) {
    var m = MAST[office] || MAST.school_board;
    var byrace = topView !== 'spend';
    return '<header class="masthead"><p class="eyebrow"><span class="box" aria-hidden="true"></span>' + esc(m.kicker) + '</p>' +
      '<h1>Who’s running, and who’s funding them</h1><p class="lede">' + m.lede + '</p>' +
      '<div class="topnav" role="tablist" aria-label="View">' +
      '<button role="tab" data-view="byrace" aria-selected="' + byrace + '">By race</button>' +
      '<button role="tab" data-view="spend" aria-selected="' + (!byrace) + '">Election spend</button></div></header>';
  }

  function footer() {
    return '<footer><h3>How to read this</h3>' +
      '<p>The three figures for each candidate — money from contributors, independent support, and independent ' +
      'opposition — are shown <strong>separately and never added together</strong>. Money a campaign raises goes to ' +
      'that campaign. Independent spending is made by outside groups; it is reported by the group that spent it, is ' +
      'not coordinated with the candidate, and does not go to their campaign. Where a candidate has loaned or given ' +
      'money to their own campaign, that is shown apart from money raised from other people.</p>' +
      '<p>Showing who funds a candidate is not a claim about how they would act in office. This tool reports ' +
      'disclosed money; it does not draw conclusions from it.</p>' +
      '<p class="src">Source: Illinois State Board of Elections filings, via Illinois Sunshine (Reform for Illinois). ' +
      'Donor classification is in progress; uncategorized donors are shown as not-yet-categorized. Independent ' +
      'expenditures reflect filings matched to candidates in this tool.</p></footer>';
  }

  function spendPlaceholder() {
    return '<div class="soon"><h2>Election spend — coming soon</h2>' +
      '<p>Browse donors, spend by candidate, and industry breakdowns for this office arrive in the next build.</p></div>';
  }

  // ---- Election Spend subtabs (vm computed by the data layer; render is pure) ----
  var SPEND_TABS = [['donors', 'Browse donors'], ['candidates', 'Spend by candidate'],
    ['industries', 'Industry totals'], ['industry-candidate', 'Industries by candidate'], ['flags', 'Flag totals']];

  function spendNav(active) {
    return '<div class="subnav" role="tablist" aria-label="Election spend">' + SPEND_TABS.map(function (t) {
      return '<button class="subtab" role="tab" data-spendtab="' + t[0] + '" aria-selected="' + (t[0] === active) + '">' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
  }

  // Election filter (This / Last / All-Elections, default All) — the SOLE time selector
  // for the spend tab (the legacy SBE cycle pills are gone). Same delegated-button
  // pattern as the subtabs; drives every spend figure + drill-down through the window.
  function electionFilterNav(filter) {
    if (!filter || !filter.options || filter.options.length <= 1) return '';
    return '<div class="subnav elect-filter" role="tablist" aria-label="Election filter">' + filter.options.map(function (o) {
      return '<button class="subtab" role="tab" data-spendelection="' + esc(o.id) + '" aria-selected="' + (o.id === filter.active) + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>';
  }

  // Browse-Donors filter controls (E-1): search + donor-type / industry / flag, all defaulting
  // to All. The time control (electionFilterNav) is separate and sits above — untouched here.
  function donorFilterControls(facets, df) {
    facets = facets || { types: [], industries: [], flags: [] };
    df = df || { search: '', type: 'All', industry: 'All', flag: 'All' };
    var opt = function (val, label, sel) { return '<option value="' + esc(val) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var typeSel = '<select data-donor-type>' + opt('All', 'All types', df.type === 'All') +
      facets.types.map(function (t) { return opt(t, t, df.type === t); }).join('') + '</select>';
    var indSel = '<select data-donor-industry>' + opt('All', 'All industries', df.industry === 'All') +
      facets.industries.map(function (o) { return opt(o.id, o.label || prettyTag(o.id), df.industry === o.id); }).join('') + '</select>';
    var flagSel = '<select data-donor-flag>' + opt('All', 'All flags', df.flag === 'All') +
      facets.flags.map(function (o) { return opt(o.id, o.label || prettyTag(o.id), df.flag === o.id); }).join('') + '</select>';
    return '<div class="elect-controls">' +
      '<div class="elect-field grow"><label>Search donors</label>' +
        '<input type="search" data-browse-search placeholder="e.g. Realtors, CTU, Frank" autocomplete="off" value="' + esc(df.search || '') + '"></div>' +
      '<div class="elect-field"><label>Donor type</label>' + typeSel + '</div>' +
      '<div class="elect-field"><label>Industry</label>' + indSel + '</div>' +
      '<div class="elect-field"><label>Flag</label>' + flagSel + '</div>' +
      '</div>';
  }

  function browseResultsNote(rows, ieCount, df, facets) {
    df = df || {}; facets = facets || {};
    var n = rows.length, bits = [];
    if (df.type && df.type !== 'All') bits.push('type: ' + df.type);
    if (df.industry && df.industry !== 'All') {
      var io = (facets.industries || []).filter(function (o) { return o.id === df.industry; })[0];
      bits.push('industry: ' + (io ? (io.label || prettyTag(io.id)) : df.industry));
    }
    if (df.flag && df.flag !== 'All') {
      var fo = (facets.flags || []).filter(function (o) { return o.id === df.flag; })[0];
      bits.push('flag: ' + (fo ? (fo.label || prettyTag(fo.id)) : df.flag));
    }
    if (df.search) bits.push('“' + df.search + '”');
    var filtSummary = bits.length
      ? ' · <b>Filtered by ' + esc(bits.join(' + ')) + '.</b> <button class="clear-filters" type="button" data-clear-filters>Clear filters</button>' : '';
    return '<p class="browse-meta">' + n + (n === 1 ? ' result' : ' results') +
      (ieCount ? ' (' + ieCount + ' independent-expenditure ' + (ieCount === 1 ? 'committee' : 'committees') + ')' : '') + ' matched.' + filtSummary +
      '<span class="framing">Everyone who gave to a school-board candidate or funded an independent-expenditure committee in these races, by affiliation. ' +
      'Affiliated donors are combined into one group; an <span class="kind ie">IE PAC</span> opens its profile. Click any row for its footprint.</span></p>';
  }

  function browseRow(r, tagMap) {
    if (r.kind === 'ie') {
      var nm = ieNaming(r.name, r.identity);
      return '<button class="crow funder-row" type="button" data-committee="' + esc(r.committee_id) + '">' +
        '<div class="who">' + nm.primary + ' <span class="kind ie">IE PAC</span>' +
        (nm.subtitle ? '<div class="sub">' + nm.subtitle + '</div>' : '') + '</div>' +
        '<div class="amt">' + money(r.total) + ' <span class="n">· spent</span></div></button>';
    }
    // Front card (E-4): rollup pill + "N entities · N committees · N contributions".
    var isRollup = (r.entities || 0) > 1;
    var sub = [];
    if (isRollup) sub.push(r.entities + ' entities');
    sub.push(plural(r.committees || 0, 'committee', 'committees'));
    sub.push(plural(r.contributions || 0, 'contribution', 'contributions'));
    return '<button class="crow funder-row" type="button" data-funder="' + esc(r.parent_id) + '">' +
      '<div class="who">' + esc(r.name) + (isRollup ? ' <span class="rollup-pill">rollup</span>' : '') + ' ' + tagsHtml(r.industries, r.flags, tagMap) +
      '<div class="browse-counts">' + sub.join(' · ') + '</div></div>' +
      '<div class="amt">' + money(r.total) + '</div></button>';
  }

  function threeFig(f) {
    return '<span class="mini c">' + money(f.contributions.total) + ' contrib</span>' +
      '<span class="mini s">' + money(f.independentSupport) + ' support</span>' +
      '<span class="mini o">' + money(f.independentOpposition) + ' oppose</span>';
  }

  // E-7 race filter for the grouped spend-by-candidate view. AND-composes with the time control
  // (electionFilterNav). 'all' = every school-board race; a single race degrades to one section.
  function candidateRaceFilter(raceOptions, raceFilter) {
    if (!raceOptions || !raceOptions.length) return '';
    var opt = function (id, label, sel) { return '<option value="' + esc(id) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    return '<div class="elect-controls"><div class="elect-field grow"><label>Race</label><select data-race-filter>' +
      opt('all', 'All school-board races', raceFilter === 'all' || !raceFilter) +
      raceOptions.map(function (r) { return opt(r.id, r.label, raceFilter === r.id); }).join('') +
      '</select></div></div>';
  }

  // E-6 Level 1 — election-wide industry totals as sorted bars (Option A). Each industry is ONE
  // aggregate bar: direct industries in teal, IE-funded industries in sage ("independent"). The
  // aggregate is legitimate here because no candidate is in view — support/oppose are NOT split
  // at Level 1; that split appears only on drill into a candidate (Level 3). Click a bar to see
  // that industry's spenders (Level 2). Sorted high-to-low (industryTotals is pre-sorted by total).
  function industryChart(industries) {
    var max = 1;
    for (var m = 0; m < industries.length; m++) if (industries[m].total > max) max = industries[m].total;
    var note = '<p class="contrib-note">Total election money by industry — direct contributions and independent ' +
      'spending, largest first. Click an industry to see who gave or spent. Support and opposition are split only ' +
      'when you drill into a candidate, never here.</p>';
    var legend = '<div class="ind-legend" aria-hidden="true"><span><i class="sw third"></i>Direct contributions</span>' +
      '<span><i class="sw indep"></i>Independent spending</span></div>';
    var rows = industries.map(function (x) {
      var isIE = (x.support + x.oppose) > 0;          // an IE-funded industry (charter-schools)
      var uncat = (x.industry === 'unclassified' || x.industry === 'uncategorized');
      var drill = uncat ? 'uncategorized' : x.industry;
      var label = uncat ? 'uncategorized' : prettyTag(x.industry);
      var w = max > 0 ? Math.min(100, Math.max(1.5, x.total / max * 100)) : 0;
      return '<button class="indbar" type="button" data-industry-drill="' + esc(drill) + '">' +
        '<div class="indbar-top"><span class="indbar-label">' + esc(label) +
          (isIE ? ' <span class="indep-tag">independent</span>' : '') + '</span>' +
          '<span class="indbar-val">' + money(x.total) + '</span></div>' +
        '<div class="bartrack"><div class="barfill" style="width:' + w + '%">' +
          '<div class="seg ' + (isIE ? 'indep' : 'third') + '" style="width:100%"></div></div></div></button>';
    }).join('');
    return note + legend + '<div class="indchart">' + rows + '</div>';
  }

  function renderSpend(vm) {
    var tab = vm.tab || 'donors', body;
    if (tab === 'candidates') {
      // E-7: full roster grouped by race (President -> d01 -> d20), ranked within each race by
      // contributions.total (direct raised, single-stream). The three figures stay SEPARATE.
      body = candidateRaceFilter(vm.raceOptions, vm.raceFilter) +
        '<p class="contrib-note">Candidates grouped by race, ranked within each race by money raised (direct ' +
        'contributions). The three figures — raised, independent support, independent opposition — are shown ' +
        'separately and never added together.</p>' +
        vm.groups.map(function (g) {
          var rows;
          if (g.candidates.length) {
            rows = g.candidates.map(function (c) {
              var f = c.figures;
              return '<div class="srow"><div class="sname">' + esc(c.name) +
                (c.incumbent ? ' <span class="chip-inc">Incumbent</span>' : '') +
                (c.hasCommittee ? '' : ' <span class="badge">no committee registered</span>') +
                '<div class="rankfig">' + money(f.contributions.total) + ' <span class="n">raised</span></div>' +
                '<div class="figrow">' + threeFig(f) + '</div></div></div>';
            }).join('');
          } else {
            rows = '<div class="srow empty"><div class="sname">No finance reported yet.</div></div>';
          }
          return '<div class="racegroup"><h3 class="racehead">' + esc(g.race.label) + '</h3>' + rows + '</div>';
        }).join('');
    } else if (tab === 'industries') {
      body = industryChart(vm.industries);   // E-6 Level 1: sorted-bar chart, click -> spenders (Level 2)
    } else if (tab === 'industry-candidate') {
      body = '<p class="contrib-note">Each candidate’s money by donor/​spender industry (direct + independent). ' +
        'Uncategorized shown as uncategorized.</p>' +
        vm.rows.map(function (r) {
          return '<div class="srow"><div class="sname">' + esc(r.name) + ' <span class="muted">· ' + esc(r.race) + '</span>' +
            '<div class="ixc">' + r.industries.map(function (i) {
              return '<span class="tagchip ind">' + esc(prettyTag(i.industry === 'unclassified' ? 'uncategorized' : i.industry)) + ' ' + money(i.total) + '</span>';
            }).join('') + '</div></div></div>';
        }).join('');
    } else if (tab === 'flags') {
      body = '<p class="contrib-note">Editorial flags aggregated across this office’s donors.</p>' +
        (vm.flags.length ? vm.flags.map(function (x) {
          return '<div class="srow"><div class="sname">⚑ ' + esc(prettyTag(x.flag)) +
            '<div class="figrow"><span class="mini c">' + money(x.amount) + '</span><span class="muted">· ' + x.count + ' contributions</span></div></div></div>';
        }).join('') : '<div class="soon"><p>No flags recorded for this office yet.</p></div>');
    } else { // donors
      var controls = donorFilterControls(vm.facets, vm.donorFilters);
      var note = browseResultsNote(vm.rows, vm.ieCount || 0, vm.donorFilters, vm.facets);
      if (!vm.rows.length) {
        body = controls + note + '<div class="soon"><p>No donors or spenders match these filters.</p></div>';
      } else {
        var LIMIT = 50, rows = vm.rows, top = '';
        for (var i = 0; i < Math.min(LIMIT, rows.length); i++) top += browseRow(rows[i], vm.industryTags);
        var more = '';
        if (rows.length > LIMIT) {
          var moreRows = ''; for (var j = LIMIT; j < rows.length; j++) moreRows += browseRow(rows[j], vm.industryTags);
          more = '<button class="show-more" type="button" aria-expanded="false" aria-controls="spend-donors-more">' +
            '<span class="caret" aria-hidden="true">▸</span> Show all ' + rows.length + ' donors &amp; spenders</button>' +
            '<div class="contrib tall" id="spend-donors-more"><div class="contrib-inner bare">' + moreRows + '</div></div>';
        }
        body = controls + note + top + more;
      }
    }
    // The active election window rides on the container so a spender drill-down opened
    // from this tab (donor footprint OR IE-PAC profile) stays scoped to the same window
    // (winFromEl reads the nearest [data-win-end] ancestor).
    var winAttr = vm.win ? (' data-win-start="' + esc(vm.win.start || '') + '" data-win-end="' + esc(vm.win.end || '') + '"') : '';
    return '<div class="spend"' + winAttr + '>' + electionFilterNav(vm.filter) + spendNav(tab) + '<div class="spend-body">' + body + '</div></div>';
  }

  // (Cycle/year pills removed from the election views — the This/Last/All election
  // toggle is the sole time selector. The council tool keeps its own cycle pills.)

  function officeComingSoon(office) {
    return '<div class="soon"><h2>' + esc(pageLabel(office)) + ' — coming soon</h2>' +
      '<p>Candidates are still filing for this office. Campaign-finance data appears here as committees are ' +
      'identified and processed — check back as the field fills in.</p></div>';
  }

  // Full inner HTML for the mount container — used by the browser app AND the
  // future SEO pre-render (same pure output).
  function renderPage(state) {
    var ready = state.officeRaces && state.officeRaces.groups.some(function (g) {
      return g.races.some(function (r) { return r.hasFinance; });
    });
    var inner;
    if (!ready) {
      inner = officeComingSoon(state.office);     // city_council / mayor: clean coming-soon, never a crash
    } else {
      var byrace = state.topView !== 'spend';
      var content = byrace
        ? (renderOfficeNav(state.officeRaces, state.activeSlug) +
           '<div aria-live="polite">' + (state.raceView ? renderRaceView(state.raceView, state.electionView) : '') + '</div>')
        : (state.spend ? renderSpend(state.spend) : spendPlaceholder());
      // The legacy SBE 4-year cycle pills are removed from the election views: they
      // cannot express 2024-vs-2026 (both cycle '2027') and duplicate the election
      // toggle, which is now the SOLE time selector. (Council still uses cycle pills.)
      inner = content;
    }
    return '<div class="wrap">' + masthead(state.office, state.topView) +
      '<section>' + inner + '</section>' + footer() + '</div>';
  }

  return {
    styles: styles,
    masthead: masthead, footer: footer,
    renderOfficeNav: renderOfficeNav, renderRaceView: renderRaceView, renderRaceElections: renderRaceElections,
    renderComingSoon: renderComingSoon, spendPlaceholder: spendPlaceholder, renderSpend: renderSpend,
    renderFunderModal: renderFunderModal, renderCommitteeProfile: renderCommitteeProfile,
    tagsHtml: tagsHtml, readableText: readableText,
    donorRow: donorRow, contributorPanel: contributorPanel, iePanel: iePanel,
    renderPage: renderPage, pageLabel: pageLabel,
    _money: money, _esc: esc
  };
});
