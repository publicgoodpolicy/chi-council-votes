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
  function openCommittee(key, win) { if (IDX) openModal(ElectRender.renderCommitteeProfile(ElectData.committeeProfile(IDX, key, win))); }
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
    if (cr) { openCommittee(cr.getAttribute('data-committee'), winFromEl(cr)); return true; }
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
    var state = { office: office, topView: 'byrace', activeSlug: null, cycle: null, spendTab: 'donors', spendElection: 'all',
      donorFilters: { search: '', type: 'All', industry: 'All', flag: 'All' }, raceFilter: 'all', electionView: null,
      expandedCandidateId: null };   // X-2: the ONE grouped row expanded to its inline funder card (accordion-of-one)
    var browseSearchTimer = null;
    state.activeSlug = firstSlug(ElectData.viewModels.officeRaces(index, office));

    function draw() {
      var omVM = ElectData.viewModels.officeRaces(index, state.office);
      var raceId = index.raceBySlug[state.activeSlug];
      var rv = raceId ? ElectData.viewModels.raceView(index, raceId, state.cycle) : null;
      var spend = state.topView === 'spend' ? ElectData.spendSubtab(index, state.office, state.spendTab, state.cycle, state.spendElection, state.donorFilters, state.raceFilter, state.expandedCandidateId) : null;
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
      // X-2: E-7 grouped row -> inline funder card. MUST sit after modalNav and the
      // aria-controls toggle: a click on a funder row (data-funder -> modalNav, line above)
      // or an internal disclosure (aria-controls) INSIDE an already-expanded card is caught
      // and returned by those handlers first, so it never collapses the card. This branch
      // fires only when neither matched. The affordance is its own element carrying ONLY
      // data-expand-cand (no data-slug/funder/committee/aria-controls), so one click never
      // satisfies two dispatch paths. Accordion-of-one: re-clicking the open row toggles off.
      var xc = cl('[data-expand-cand]');
      if (xc) {
        var cid = xc.getAttribute('data-expand-cand');
        state.expandedCandidateId = (state.expandedCandidateId === cid) ? null : cid;
        draw(); return;
      }
      var v = cl('[data-view]');
      if (v) { state.topView = v.getAttribute('data-view'); draw(); return; }
      var st = cl('[data-spendtab]');
      if (st) { state.spendTab = st.getAttribute('data-spendtab'); draw(); return; }
      // E-6 Level 1 -> 2: click an industry bar -> that industry's ranked spenders, via the
      // E-1 industry filter on Browse Donors (donors subtab). Level 3 is then the existing
      // spender modal (donor footprint / IE committee profile, dispatch-by-kind).
      var idr = cl('[data-industry-drill]');
      if (idr) {
        state.spendTab = 'donors';
        state.donorFilters = { search: '', type: 'All', industry: idr.getAttribute('data-industry-drill'), flag: 'All' };
        draw(); return;
      }
      // Election filter (This/Last/All) — reslices every spend figure + drill-down by window.
      var se = cl('[data-spendelection]');
      if (se) { state.spendElection = se.getAttribute('data-spendelection'); draw(); return; }
      // Browse-Donors filters: clear-all (the search input + selects are handled by input/change).
      if (cl('[data-clear-filters]')) { state.donorFilters = { search: '', type: 'All', industry: 'All', flag: 'All' }; draw(); return; }
      // This/Last/All election toggle — same delegation pattern as the spend subtabs:
      // update state, redraw (which refreshes both the active-tab state and the view).
      var ev = cl('[data-electionview]');
      if (ev) { state.electionView = ev.getAttribute('data-electionview'); draw(); return; }
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
    // Browse-Donors filter selects (E-1): re-run browseDonors through the active filters.
    root.addEventListener('change', function (e) {
      var t = e.target; if (!(t && t.matches)) return;
      if (t.matches('[data-donor-type]')) { state.donorFilters.type = t.value; draw(); return; }
      if (t.matches('[data-donor-industry]')) { state.donorFilters.industry = t.value; draw(); return; }
      if (t.matches('[data-donor-flag]')) { state.donorFilters.flag = t.value; draw(); return; }
      if (t.matches('[data-race-filter]')) { state.raceFilter = t.value; draw(); return; }   // E-7 race filter
    });

    root.addEventListener('input', function (e) {
      // Browse-Donors search (E-1): debounced redraw through browseDonors, then restore focus +
      // cursor to the search box (council behavior) so typing isn't interrupted by the rerender.
      if (e.target.matches && e.target.matches('[data-browse-search]')) {
        var val = e.target.value;
        clearTimeout(browseSearchTimer);
        browseSearchTimer = setTimeout(function () {
          state.donorFilters.search = val; draw();
          var s = root.querySelector('[data-browse-search]');
          if (s) { s.focus(); try { s.setSelectionRange(s.value.length, s.value.length); } catch (e2) {} }
        }, 180);
        return;
      }
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
