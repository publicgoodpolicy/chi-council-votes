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
      '.ipg-elect .barlabel{font-size:12.5px;color:var(--ink-soft);}' +
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

  // One static figure bar (no drill-down in B2). scale = race-wide max for width.
  function bar(label, segs, countText, scale) {
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
    return '<div class="barrow"><span class="barlabel">' + esc(label) + '</span>' +
      '<div class="bartrack"><div class="barfill" style="width:' + fillW + '%">' + inner + '</div></div>' +
      '<div class="barval">' + val + '</div></div>';
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function card(c, scale) {
    var f = c.figures;
    var mostlySelf = f.contributions.total > 0 && (f.contributions.selfFunded / f.contributions.total) >= 0.5;
    var chips = (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') +
      (mostlySelf ? '<span class="chip-self">Mostly self-funded</span>' : '');
    var contribBar = bar('From contributors',
      [{ cls: 'third', v: f.contributions.thirdParty }, { cls: 'self', v: f.contributions.selfFunded }],
      plural(f.contributions.count, 'contribution', 'contributions'), scale);
    var supportBar = bar('Independent support', [{ cls: 'support', v: f.independentSupport }],
      f.independentSupportCount ? plural(f.independentSupportCount, 'expenditure', 'expenditures') : '', scale);
    var opposeBar = bar('Independent opposition', [{ cls: 'oppose', v: f.independentOpposition }],
      f.independentOppositionCount ? plural(f.independentOppositionCount, 'expenditure', 'expenditures') : '', scale);
    var selfLine = f.contributions.selfFunded > 0
      ? '<p class="selfline"><b>' + money(f.contributions.selfFunded) + '</b> is the candidate’s own money or loans · <b>' +
        money(f.contributions.thirdParty) + '</b> from other donors</p>' : '';
    return '<article class="card" id="cand-' + esc(c.slug) + '">' +
      '<div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' + chips + '</div>' +
      (c.committee && c.committee.name ? '<p class="committee">Committee: ' + esc(c.committee.name) + '</p>' : '') +
      '<div class="bars">' + contribBar + supportBar + opposeBar + '</div>' + selfLine +
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

  // Race view: head + legend + candidate cards (neutral order from the data layer).
  function renderRaceView(vm) {
    if (!vm) return '<div class="soon"><h2>Race not found</h2></div>';
    var live = vm.candidates.filter(function (c) { return c.hasFinance; });
    if (!live.length) return renderComingSoon(vm.race.label);
    var scale = 1;
    for (var i = 0; i < vm.candidates.length; i++) {
      var f = vm.candidates[i].figures; if (!f) continue;
      scale = Math.max(scale, f.contributions.total, f.independentSupport, f.independentOpposition);
    }
    var anyPending = vm.candidates.some(function (c) { return !c.hasFinance; });
    var cards = vm.candidates.map(function (c) {
      if (c.hasFinance) return card(c, scale);
      return '<article class="card"><div class="card-top"><h3 class="cand-name">' + esc(c.name) + '</h3>' +
        (c.incumbent ? '<span class="chip-inc">Incumbent</span>' : '') + '</div>' +
        '<p class="committee">Finance data still populating — committee not yet identified.</p></article>';
    }).join('');
    return '<div class="race-head"><h2>' + esc(vm.race.label) + '</h2>' +
      '<span class="race-meta">' + plural(vm.candidates.length, 'candidate', 'candidates') +
      (vm.cycle ? ' · cycle ' + esc(vm.cycle) : ' · all-time') + '</span></div>' +
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

  function masthead(office) {
    var m = MAST[office] || MAST.school_board;
    return '<header class="masthead"><p class="eyebrow"><span class="box" aria-hidden="true"></span>' + esc(m.kicker) + '</p>' +
      '<h1>Who’s running, and who’s funding them</h1><p class="lede">' + m.lede + '</p>' +
      '<div class="topnav" role="tablist" aria-label="View">' +
      '<button role="tab" data-view="byrace" aria-selected="true">By race</button>' +
      '<button role="tab" data-view="spend" aria-selected="false">Election spend</button></div></header>';
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
    return '<div class="wrap">' + masthead(state.office) +
      '<section>' + body + '</section>' + footer() + '</div>';
  }

  return {
    styles: styles,
    masthead: masthead, footer: footer,
    renderOfficeNav: renderOfficeNav, renderRaceView: renderRaceView,
    renderComingSoon: renderComingSoon, spendPlaceholder: spendPlaceholder,
    renderPage: renderPage, pageLabel: pageLabel,
    _money: money, _esc: esc
  };
});
