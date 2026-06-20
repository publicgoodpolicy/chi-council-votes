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

  // ONE modal system, two content types (donor footprint + committee profile).
  // Mounted on <body> wrapped in .ipg-elect so scoped styles apply; closed by ×,
  // backdrop, or Esc. App only mounts/unmounts and dispatches by data-attr — it
  // does NOT fork into separate handlers per content type. The modals are
  // bidirectional: a footprint's committee row opens a committee profile, whose
  // funder rows open footprints, all through the same openModal/closeModal.
  var IDX = null;  // current loaded index (set in start)
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var m = document.getElementById('ipg-elect-modal');
    if (m) m.parentNode.removeChild(m);
    document.removeEventListener('keydown', escClose);
  }
  function openFunder(pid, win) { if (IDX) openModal(ElectRender.renderFunderModal(ElectData.donorFootprint(IDX, pid, win))); }
  function openCommittee(key) { if (IDX) openModal(ElectRender.renderCommitteeProfile(ElectData.committeeProfile(IDX, key))); }
  // A donor clicked inside a per-election panel carries a [data-win-*] ancestor; scope
  // its footprint to that election window (Gate G). Elsewhere -> null -> full footprint.
  function winFromEl(el) {
    var w = el && el.closest && el.closest('[data-win-end]');
    if (!w) return null;
    return { start: w.getAttribute('data-win-start') || null, end: w.getAttribute('data-win-end') || null };
  }
  // Shared dispatch: a clicked donor row -> footprint, a clicked committee row ->
  // committee profile. Used by BOTH the page handler and the in-modal handler.
  function modalNav(target) {
    var fr = target.closest && target.closest('[data-funder]');
    if (fr) { openFunder(fr.getAttribute('data-funder'), winFromEl(fr)); return true; }
    var cr = target.closest && target.closest('[data-committee]');
    if (cr) { openCommittee(cr.getAttribute('data-committee')); return true; }
    return false;
  }
  function openModal(html) {
    closeModal();
    var w = document.createElement('div');
    w.id = 'ipg-elect-modal'; w.className = 'ipg-elect'; w.innerHTML = html;
    w.addEventListener('click', function (e) {
      if ((e.target.closest && e.target.closest('[data-modal-close]')) ||
          (e.target.matches && e.target.matches('[data-modal-overlay]'))) { closeModal(); return; }
      modalNav(e.target);  // same dispatch as the page → bidirectional navigation
    });
    document.body.appendChild(w);
    document.addEventListener('keydown', escClose);
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
    IDX = index;
    var cycles = ElectData.availableCycles(index);
    var state = { office: office, topView: 'byrace', activeSlug: null, cycle: null, spendTab: 'donors', electionView: null };
    state.activeSlug = firstSlug(ElectData.viewModels.officeRaces(index, office));

    function draw() {
      var omVM = ElectData.viewModels.officeRaces(index, state.office);
      var raceId = index.raceBySlug[state.activeSlug];
      var rv = raceId ? ElectData.viewModels.raceView(index, raceId, state.cycle) : null;
      var spend = state.topView === 'spend' ? ElectData.spendSubtab(index, state.office, state.spendTab, state.cycle) : null;
      root.innerHTML = ElectRender.renderPage({
        office: state.office, topView: state.topView, cycles: cycles, cycle: state.cycle,
        officeRaces: omVM, activeSlug: state.activeSlug, raceView: rv, spend: spend,
        electionView: state.electionView
      });
    }

    root.addEventListener('click', function (e) {
      // donor/committee rows open a modal (shared dispatch — same as in-modal nav)
      if (modalNav(e.target)) return;
      var cl = function (sel) { return e.target.closest && e.target.closest(sel); };
      // Tier 1/2 + figure bars: any aria-controls toggle expands its panel in place
      // (no redraw → open state persists)
      var dz = cl('[aria-controls]');
      if (dz) {
        var pid = dz.getAttribute('aria-controls'), panel = pid && document.getElementById(pid);
        if (panel) { var open = panel.classList.toggle('open'); dz.setAttribute('aria-expanded', open ? 'true' : 'false'); }
        return;
      }
      var v = cl('[data-view]');
      if (v) { state.topView = v.getAttribute('data-view'); draw(); return; }
      var st = cl('[data-spendtab]');
      if (st) { state.spendTab = st.getAttribute('data-spendtab'); draw(); return; }
      // This/Last/All election toggle — same delegation pattern as the spend subtabs:
      // update state, redraw (which refreshes both the active-tab state and the view).
      var ev = cl('[data-electionview]');
      if (ev) { state.electionView = ev.getAttribute('data-electionview'); draw(); return; }
      var cy = cl('[data-cycle]');
      if (cy) { state.cycle = cy.getAttribute('data-cycle') || null; draw(); return; }
      // chips AND the vacating-incumbent "→" link both navigate by slug
      var ch = cl('[data-slug]');
      if (ch) { state.activeSlug = ch.getAttribute('data-slug'); state.electionView = null; state.topView = 'byrace'; draw(); return; }
      var of = cl('.office[data-group]');
      if (of) {
        var label = of.getAttribute('data-group');
        var omVM = ElectData.viewModels.officeRaces(index, state.office);
        for (var i = 0; i < omVM.groups.length; i++) {
          if (omVM.groups[i].label === label && omVM.groups[i].races.length) {
            state.activeSlug = groupFirstSlug(omVM.groups[i]); break;
          }
        }
        state.electionView = null;
        draw(); return;
      }
    });

    // Client-side donor search inside a drill-down panel (council behavior): filter the
    // panel's donor rows by name; reveal the collapsed remainder while a query is active.
    root.addEventListener('input', function (e) {
      if (!(e.target.matches && e.target.matches('[data-donor-search]'))) return;
      var panel = e.target.closest('.contrib-inner'); if (!panel) return;
      var q = (e.target.value || '').trim().toLowerCase();
      var rows = panel.querySelectorAll('.crow');
      for (var i = 0; i < rows.length; i++) {
        var hit = !q || (rows[i].textContent || '').toLowerCase().indexOf(q) >= 0;
        rows[i].style.display = hit ? '' : 'none';
      }
      var more = panel.querySelector('.contrib.tall');
      if (more) more.classList.toggle('open', !!q);
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
      .then(function (json) { start(root, office, ElectData.loadData(json, { office: office })); })
      .catch(function (err) { notice(root, 'Couldn’t load election data (' + String(err && err.message || err) + ').', true); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
