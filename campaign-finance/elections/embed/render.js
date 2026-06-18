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
  function tagsHtml(industries, flags) {
    var inds = (industries && industries.length) ? industries : ['uncategorized'];
    var out = '';
    for (var i = 0; i < inds.length; i++) {
      var label = (inds[i] === 'unclassified') ? 'uncategorized' : prettyTag(inds[i]);
      out += '<span class="tagchip ind">' + esc(label) + '</span>';
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
      '.ipg-elect{--cream:#F6EFE9;--paper:#FCF8F3;--ink:#342828;--ink-soft:#6E5F58;--tan:#EBDAC6;--line:#E0CDB6;' +
        '--teal:#044127;--sage:#508F88;--coral:#B0553A;--display:Recoleta,Georgia,"Times New Roman",serif;' +
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
      '.ipg-elect .kind{font-size:10px;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;background:var(--tan);color:var(--ink-soft);}' +
      '.ipg-elect .kind.cand{background:#E5EFE9;color:var(--teal);}.ipg-elect .kind.ie{background:#F4E3DC;color:var(--coral);}' +
      '.ipg-elect .bartrack{height:18px;background:#EFE6DC;border-radius:5px;overflow:hidden;}' +
      '.ipg-elect .barfill{height:100%;display:flex;}' +
      '.ipg-elect .seg{height:100%;}' +
      '.ipg-elect .seg.third{background:var(--teal);}' +
      '.ipg-elect .seg.self{background:repeating-linear-gradient(135deg,#3E6B53 0 5px,#9DBBA9 5px 10px);}' +
      '.ipg-elect .seg.support{background:var(--sage);}.ipg-elect .seg.oppose{background:var(--coral);}' +
      '.ipg-elect .barval{font-size:13px;font-weight:500;text-align:right;}' +
      '.ipg-elect .barval .sub{display:block;font-size:11px;font-weight:400;color:var(--ink-soft);}' +
      '.ipg-elect .zero{color:#A99B91;font-weight:400;}' +
      '.ipg-elect .selfline{font-size:12px;color:var(--coral);margin:11px 0 0;padding-left:182px;}' +
      '.ipg-elect .selfline b{font-weight:500;}' +
      '.ipg-elect .caption{font-size:11.5px;color:var(--ink-soft);margin:14px 0 0;padding-top:13px;border-top:1px solid var(--line);}' +
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
    var amt = '<div class="amt">' + money(line.total) + ' <span class="n">· ' + plural(line.count, 'gift', 'gifts') + '</span></div>';
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
      var fLimit = 10, fShown = Math.min(fLimit, s.funders.length), frows = '';
      for (var i = 0; i < fShown; i++) { frows += donorRow(s.funders[i]); }   // shared donor-row path
      var more = s.funderCount > fLimit ? '<p class="contrib-note">+ ' + (s.funderCount - fLimit) + ' more funders</p>' : '';
      var cn = ieNaming(s.committeeName, names);
      return '<div class="ie-cmte"><div class="ie-cmte-head">' +
        '<button class="ie-cmte-toggle" type="button" aria-expanded="false" aria-controls="' + t2 + '">' +
        '<span class="caret" aria-hidden="true">▸</span> <b>' + money(s.amount) + ' ' + verb + '</b> ' + verbing + ' ' +
        esc(candName) + ' · <span class="ie-pac-tag">IE PAC</span> ' + cn.primary + '</button>' + sun + '</div>' +
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
    return '<div class="ipg-modal-overlay" data-modal-overlay><div class="ipg-modal" role="dialog" aria-modal="true" aria-label="Donor footprint">' +
      '<button class="ipg-modal-close" type="button" data-modal-close aria-label="Close">×</button>' +
      '<div class="modal-kicker">Donor footprint · this election only</div>' +
      '<div class="modal-name">' + esc(fp.name) + '</div>' +
      '<div class="modal-tags">' + tagsHtml(fp.industries, fp.flags) + '</div>' +
      '<p class="modal-note">Everything <b>' + esc(fp.name) + '</b> has given within the 2026 Board of Education data — ' +
      'direct contributions and money into independent-expenditure committees. Council-side giving is a separate, ' +
      'not-yet-connected view.</p>' +
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
      summary = '<div class="modal-summary">' + money(p.total) + ' spent · ' +
        money(p.support) + ' support · ' + money(p.oppose) + ' oppose</div>';
      spent = '<p class="contrib-h">What it spent on</p>' + (p.targets.length ? p.targets.map(function (t) {
        var bits = [];
        if (t.support) bits.push('<span style="color:var(--sage)">' + money(t.support) + ' for</span>');
        if (t.oppose) bits.push('<span style="color:var(--coral)">' + money(t.oppose) + ' against</span>');
        return '<div class="crow"><div class="who">' + esc(t.name) +
          (t.raceLabel ? ' <span class="muted">· ' + esc(t.raceLabel) + '</span>' : '') + '</div>' +
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
    return '<div class="ipg-modal-overlay" data-modal-overlay><div class="ipg-modal" role="dialog" aria-modal="true" aria-label="Committee profile">' +
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

  // Race view: head + vacating-incumbent note(s) + legend + candidate cards
  // (neutral order from the data layer; the three figures never summed).
  function renderRaceView(vm) {
    if (!vm) return '<div class="soon"><h2>Race not found</h2></div>';
    var vac = (vm.race.vacating || []).map(function (v) {
      return '<p class="vacating-note">↳ Current member <b>' + esc(v.name) + '</b> is running for ' +
        '<button class="goto-link" type="button" data-slug="' + esc(v.targetSlug) + '">' + esc(v.targetLabel) + ' →</button></p>';
    }).join('');
    var meta = plural(vm.candidates.length, 'candidate', 'candidates') +
      (vm.cycle ? ' · cycle ' + esc(vm.cycle) : ' · current cycle');
    var head = '<div class="race-head"><h2>' + esc(vm.race.label) + '</h2>' +
      '<span class="race-meta">' + meta + '</span></div>' + vac;

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

  // Full inner HTML for the mount container — used by the browser app AND the
  // future SEO pre-render (same pure output).
  function renderPage(state) {
    var byrace = state.topView !== 'spend';
    var body = byrace
      ? (renderOfficeNav(state.officeRaces, state.activeSlug) +
         '<div aria-live="polite">' + (state.raceView ? renderRaceView(state.raceView) : '') + '</div>')
      : spendPlaceholder();
    return '<div class="wrap">' + masthead(state.office, state.topView) +
      '<section>' + body + '</section>' + footer() + '</div>';
  }

  return {
    styles: styles,
    masthead: masthead, footer: footer,
    renderOfficeNav: renderOfficeNav, renderRaceView: renderRaceView,
    renderComingSoon: renderComingSoon, spendPlaceholder: spendPlaceholder,
    renderFunderModal: renderFunderModal, renderCommitteeProfile: renderCommitteeProfile,
    donorRow: donorRow, contributorPanel: contributorPanel,
    renderPage: renderPage, pageLabel: pageLabel,
    _money: money, _esc: esc
  };
});
