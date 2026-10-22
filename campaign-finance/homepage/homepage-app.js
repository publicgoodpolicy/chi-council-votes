/* IPG civic tools homepage (/chi-civic-tools): fetch, state and events.
 * Rendering is homepage-render.js (pure). This file only fetches the data file once, keeps the
 * page's state, and re-renders on a change. No storage, no other request.
 */
(function () {
  'use strict';
  // The data host is GitHub Pages (ruling 123, 2026-10-22), which serves main as deployed. It
  // replaces GitHub's raw-file address, which is not built for site traffic: short
  // caching and per-IP throttling. Pages has no branch fragment, so D-5's tag-ambiguity
  // hazard, which refs/heads/main/ answered, does not arise; ruling 123 supersedes that form.
  var SRC = 'https://publicgoodpolicy.github.io/chi-council-votes/campaign-finance/homepage-data.json';
  var R = window.IPGHome;
  var root = document.getElementById('ipg-home-root');
  if (!root || !R) return;
  var data = null;
  var state = { cycle: 'all', shown: R.PAGE, q: '', open: null };

  function draw(focusSel) {
    root.innerHTML = data ? R.page(data, state) : R.loading();
    if (focusSel) {
      var el = root.querySelector(focusSel);
      if (el) { el.focus(); if (el.setSelectionRange && el.value) el.setSelectionRange(el.value.length, el.value.length); }
    }
  }

  function load(fromRetry) {
    root.innerHTML = R.loading();
    fetch(SRC, { cache: 'default' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (!j || !j.donors || !j.cycles) throw new Error('unexpected data');
      data = j; draw(fromRetry ? '.hp-cycle' : null);
    }).catch(function () { root.innerHTML = R.failed(); if (fromRetry) { var b = root.querySelector('.hp-retry'); if (b) b.focus(); } });
  }

  root.addEventListener('click', function (ev) {
    var t = ev.target.closest('button');
    if (!t || !root.contains(t)) return;
    if (t.classList.contains('hp-retry')) { load(true); return; }
    if (!data) return;
    if (t.classList.contains('hp-more')) {
      var first = state.shown; state.shown += R.PAGE; draw();
      var next = root.querySelectorAll('.hp-toggle')[first] || root.querySelector('.hp-more');
      if (next) next.focus();
      return;
    }
    if (t.classList.contains('hp-toggle')) {
      var id = t.getAttribute('data-donor');
      state.open = state.open === id ? null : id;
      draw('.hp-toggle[data-donor="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    }
  });
  root.addEventListener('change', function (ev) {
    if (!data || !ev.target.classList.contains('hp-cycle')) return;
    state.cycle = ev.target.value; state.shown = R.PAGE; state.open = null; draw('.hp-cycle');
  });
  var timer = null;
  root.addEventListener('input', function (ev) {
    if (!data || !ev.target.classList.contains('hp-q')) return;
    var v = ev.target.value;
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = v; state.open = null; draw('.hp-q'); }, 200);
  });

  load();
})();
