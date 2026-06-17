/* Elections embed — RENDER layer (pure, dual-runtime).
 *
 * view model -> HTML string. No DOM, no events, no browser globals — so the same
 * code emits HTML in Node (SEO pre-render) and in the browser app (B2+).
 *
 * The three money figures are rendered as THREE separate stat blocks and are
 * NEVER summed: contributions (teal) with the self-funding split shown distinctly,
 * independent support (sage), independent opposition (coral). Candidates are
 * rendered in the order the data layer provides (neutral / alphabetical) — render
 * never re-sorts by amount.
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
  function pct(n, d) { return d > 0 ? Math.max(0, Math.min(100, (n / d) * 100)) : 0; }

  function officeLabel(o) {
    return ({ school_board_president: 'School Board President', school_board_member: 'School Board',
              alderperson: 'City Council', mayor: 'Mayor' })[o] || o;
  }
  function pageLabel(o) {
    return ({ school_board: 'School Board', city_council: 'City Council', mayor: 'Mayor' })[o] || o;
  }

  // Design tokens (§Design). Recoleta named with a serif fallback; the real
  // Recoleta @font-face arrives at B5 with the app shell.
  function styles() {
    return '<style>' + [
      '.elect{--cream:#F6EFE9;--ink:#342828;--tan:#EBDAC6;--teal:#044127;--sage:#508F88;--coral:#B0553A;',
      'background:var(--cream);color:var(--ink);font-family:Poppins,system-ui,-apple-system,sans-serif;line-height:1.45;padding:1rem;}',
      '.elect h1,.elect h2,.elect h3,.elect .display{font-family:Recoleta,Georgia,"Times New Roman",serif;font-weight:600;}',
      '.elect a{color:var(--teal);}',
      '.elect .race-head{border-bottom:2px solid var(--tan);padding-bottom:.5rem;margin:0 0 1rem;}',
      '.elect .race-head h2{margin:0;}',
      '.elect .muted{opacity:.7;} .elect .subnote{font-size:.74rem;opacity:.85;}',
      '.elect .pending{font-size:.85rem;color:var(--coral);font-style:italic;}',
      '.elect .badge{display:inline-block;font-size:.68rem;letter-spacing:.04em;text-transform:uppercase;',
      'padding:.1rem .45rem;border-radius:999px;background:var(--tan);color:var(--ink);margin-left:.4rem;vertical-align:middle;}',
      '.elect .cand{border:1px solid var(--tan);border-radius:10px;padding:1rem 1.15rem;margin:0 0 1rem;background:#ffffffcc;}',
      '.elect .cand-name{font-size:1.15rem;margin:0 0 .15rem;}',
      '.elect .figs{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:.7rem;}',
      '.elect .fig{flex:1 1 150px;min-width:150px;border-radius:8px;padding:.6rem .7rem;background:#fff;border-left:5px solid var(--tan);}',
      '.elect .fig .label{font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;opacity:.8;}',
      '.elect .fig .amt{font-size:1.25rem;font-weight:600;font-family:Recoleta,Georgia,serif;}',
      '.elect .fig.contrib{border-left-color:var(--teal);} .elect .fig.contrib .amt{color:var(--teal);}',
      '.elect .fig.support{border-left-color:var(--sage);} .elect .fig.support .amt{color:var(--sage);}',
      '.elect .fig.oppose{border-left-color:var(--coral);} .elect .fig.oppose .amt{color:var(--coral);}',
      '.elect .selfbar{height:9px;border-radius:5px;background:var(--tan);margin:.45rem 0 .25rem;overflow:hidden;display:flex;}',
      '.elect .selfbar .self{background:repeating-linear-gradient(45deg,var(--teal) 0,var(--teal) 4px,#0a5a38 4px,#0a5a38 8px);}',
      '.elect .selfbar .other{background:var(--teal);opacity:.32;}',
      '.elect .race-card{border:1px solid var(--tan);border-radius:10px;padding:.8rem 1rem;margin:0 0 .8rem;}'
    ].join('') + '</style>';
  }

  function figuresHtml(figs) {
    var c = figs.contributions;
    var selfPct = pct(c.selfFunded, c.total), otherPct = 100 - selfPct;
    return '' +
      '<div class="figs">' +
        '<div class="fig contrib"><div class="label">Contributions</div>' +
          '<div class="amt">' + money(c.total) + '</div>' +
          '<div class="selfbar"><div class="self" style="width:' + selfPct + '%"></div>' +
            '<div class="other" style="width:' + otherPct + '%"></div></div>' +
          '<div class="subnote">' + money(c.selfFunded) + ' self-funded · ' +
            money(c.thirdParty) + ' from others</div>' +
        '</div>' +
        '<div class="fig support"><div class="label">Independent support</div>' +
          '<div class="amt">' + money(figs.independentSupport) + '</div></div>' +
        '<div class="fig oppose"><div class="label">Independent opposition</div>' +
          '<div class="amt">' + money(figs.independentOpposition) + '</div></div>' +
      '</div>';
  }

  function renderRaceView(vm) {
    if (!vm) return '<div class="elect"><p>Race not found.</p></div>';
    var r = vm.race;
    var out = '<div class="elect"><div class="race-head"><h2 class="display">' + esc(r.label) + '</h2>' +
      '<div class="muted">' + esc(officeLabel(r.office)) +
      (r.status ? (' · ' + esc(r.status)) : '') +
      (vm.cycle ? (' · cycle ' + esc(vm.cycle)) : ' · all-time') + '</div></div>';
    for (var i = 0; i < vm.candidates.length; i++) {
      var c = vm.candidates[i];
      out += '<div class="cand"><h3 class="cand-name">' + esc(c.name) +
        (c.incumbent ? '<span class="badge">incumbent</span>' : '') + '</h3>';
      if (c.stillPopulating || !c.figures) {
        out += '<div class="pending">Finance data still populating — committee not yet identified.</div>';
      } else {
        out += figuresHtml(c.figures);
        if (c.committee && c.committee.sunshineUrl) {
          out += '<div class="subnote" style="margin-top:.5rem">Source: <a href="' + esc(c.committee.sunshineUrl) +
            '" target="_blank" rel="noopener">Illinois Sunshine</a></div>';
        }
      }
      out += '</div>';
    }
    out += '<p class="subnote muted">Figures are shown separately and never summed. ' +
      'Independent support/opposition reflects the spender’s own characterization. ' +
      'Self-funding is shown distinctly and is not community support.</p>';
    return out + '</div>';
  }

  function renderRaceBrowse(vm) {
    var out = '<div class="elect"><div class="race-head"><h2 class="display">' + esc(pageLabel(vm.office)) + '</h2>' +
      '<div class="muted">' + (vm.cycle ? ('cycle ' + esc(vm.cycle)) : 'all-time') + '</div></div>';
    for (var i = 0; i < vm.races.length; i++) {
      var r = vm.races[i];
      out += '<div class="race-card"><strong class="display">' + esc(r.label) + '</strong>' +
        (r.status ? (' <span class="badge">' + esc(r.status) + '</span>') : '') + '<div class="muted">';
      if (!r.candidates.length) {
        out += '<span class="pending">field still forming</span>';
      } else {
        for (var j = 0; j < r.candidates.length; j++) {
          var c = r.candidates[j];
          out += esc(c.name) + (c.hasFinance ? (' — ' + money(c.contributions)) : ' — ') +
            (c.hasFinance ? '' : '<span class="pending">pending</span>') +
            (j < r.candidates.length - 1 ? ' · ' : '');
        }
      }
      out += '</div></div>';
    }
    return out + '</div>';
  }

  return {
    styles: styles,
    renderRaceView: renderRaceView,
    renderRaceBrowse: renderRaceBrowse,
    _money: money, _esc: esc
  };
});
