/* Elections embed — APP layer (browser-only, THIN).
 *
 * Fetch + mount + state + event wiring only. ALL view-model and render logic
 * lives in the pure data.js / render.js layers (so the SEO pre-render reuses
 * them); nothing data/render-shaped may leak in here.
 *
 * OFFICE is set per Squarespace Code Block via data-office on the mount node
 * (school_board | city_council | mayor); default school_board. data-src can
 * override the data URL (default = GitHub raw CDN, same pattern as the council
 * embed).
 */
(function () {
  'use strict';
  var ROOT_ID = 'ipg-elect-root';
  var DEFAULT_SRC = 'https://raw.githubusercontent.com/publicgoodpolicy/chi-council-votes/main/campaign-finance/election-data.json';

  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('ipg-elect-css')) return;
    document.head.insertAdjacentHTML('beforeend',
      ElectRender.styles().replace('<style>', '<style id="ipg-elect-css">'));
  }

  function notice(root, msg, coral) {
    root.innerHTML = '<div class="wrap"><p style="padding:44px 0;font-family:Poppins,system-ui,sans-serif;color:' +
      (coral ? '#B0553A' : '#6E5F58') + '">' + msg + '</p></div>';
  }

  function firstSlug(omVM) {
    var live = null, first = null;
    for (var g = 0; g < omVM.groups.length; g++) {
      for (var i = 0; i < omVM.groups[g].races.length; i++) {
        var r = omVM.groups[g].races[i];
        if (first === null) first = r.slug;
        if (!live && r.hasFinance) live = r.slug;
      }
    }
    return live || first;
  }
  function groupFirstSlug(group) {
    var live = null;
    for (var i = 0; i < group.races.length; i++) if (!live && group.races[i].hasFinance) live = group.races[i].slug;
    return live || (group.races[0] && group.races[0].slug) || null;
  }

  function start(root, office, index) {
    var state = { office: office, topView: 'byrace', activeSlug: null, cycle: null };
    state.activeSlug = firstSlug(ElectData.viewModels.officeRaces(index, office));

    function draw() {
      var omVM = ElectData.viewModels.officeRaces(index, state.office);
      var raceId = index.raceBySlug[state.activeSlug];
      var rv = raceId ? ElectData.viewModels.raceView(index, raceId, state.cycle) : null;
      root.innerHTML = ElectRender.renderPage({
        office: state.office, topView: state.topView,
        officeRaces: omVM, activeSlug: state.activeSlug, raceView: rv
      });
    }

    root.addEventListener('click', function (e) {
      // drill-down disclosure: toggle the panel in place (no redraw → state persists)
      var dz = e.target.closest && e.target.closest('.barrow.click');
      if (dz) {
        var pid = dz.getAttribute('aria-controls'), panel = pid && document.getElementById(pid);
        if (panel) { var open = panel.classList.toggle('open'); dz.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        return;
      }
      var v = e.target.closest && e.target.closest('[data-view]');
      if (v) { state.topView = v.getAttribute('data-view'); draw(); return; }
      // chips AND the vacating-incumbent "→" link both navigate by slug
      var ch = e.target.closest && e.target.closest('[data-slug]');
      if (ch) { state.activeSlug = ch.getAttribute('data-slug'); state.topView = 'byrace'; draw(); return; }
      var of = e.target.closest && e.target.closest('.office[data-group]');
      if (of) {
        var label = of.getAttribute('data-group');
        var omVM = ElectData.viewModels.officeRaces(index, state.office);
        for (var i = 0; i < omVM.groups.length; i++) {
          if (omVM.groups[i].label === label && omVM.groups[i].races.length) {
            state.activeSlug = groupFirstSlug(omVM.groups[i]); break;
          }
        }
        draw(); return;
      }
    });

    draw();
  }

  function init() {
    var root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (typeof ElectData === 'undefined' || typeof ElectRender === 'undefined') {
      notice(root, 'Election tool failed to load (scripts missing).', true); return;
    }
    var office = root.getAttribute('data-office') || (typeof window !== 'undefined' && window.IPG_OFFICE) || 'school_board';
    var src = root.getAttribute('data-src') || (typeof window !== 'undefined' && window.IPG_DATA_URL) || DEFAULT_SRC;
    root.className = 'ipg-elect';
    injectStyles();
    notice(root, 'Loading election data…');
    fetch(src).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (json) { start(root, office, ElectData.loadData(json)); })
      .catch(function (err) { notice(root, 'Couldn’t load election data (' + String(err && err.message || err) + ').', true); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
