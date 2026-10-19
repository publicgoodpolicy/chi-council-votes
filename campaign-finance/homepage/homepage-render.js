/* IPG civic tools homepage (/chi-civic-tools): pure rendering.
 *
 * HOMEPAGE-1, rulings of 2026-10-14: 20a (mayoral label and note), 22a (section order),
 * 23a (top 25, "Show more" to every donor at $50,000 or more, search over all donors),
 * 24a (all cycles by default, with a cycle selector), 25a (own money and loans marked),
 * 26a (loading and failure strings).
 *
 * Everything here is a pure function of the data file and a small state object, so the
 * same code renders in the browser (homepage-app.js) and in node (tools/check_homepage.js).
 * Nothing here fetches, stores or reads the page.
 */
(function (root) {
  'use strict';

  var STREAMS = [
    { i: 0, key: 'council', label: 'City Council candidates' },
    { i: 1, key: 'school_board', label: 'School board candidates' },
    { i: 2, key: 'mayor', label: 'Mayoral candidates' },
    { i: 3, key: 'groups', label: 'Outside-spending groups' }
  ];
  var OWN = 4, LOANS = 5, OWN_COMMITTEE = 6;

  var STR = {
    title: 'Who funds Chicago politics, and how they vote',
    intro: 'Five free tools from the Institute for the Public Good follow the money in Chicago ' +
      'elections and the votes cast by the City Council and the Board of Education. This page ' +
      'brings the largest donors, the outside-spending groups and the latest votes together.',
    loading: 'Loading campaign-finance data…',
    failed: 'The data didn’t load. Try again, or use the tools below.',
    retry: 'Try again',
    mayorNote: 'Includes gifts to the candidates’ committees for other offices, such as ' +
      'Secretary of State and Comptroller.',
    ownMoney: 'Own money',
    ownCommittee: 'Candidate’s other committee',
    groupsNote: 'Gifts to outside-spending groups count in full; some of these groups spend most of what they raise outside Chicago races.',
    showMore: 'Show more',
    search: 'Search every donor',
    allCycles: 'All cycles since 2011'
  };

  var TOOLS = [
    { href: '/city-council', name: 'City Council elections', text: 'Who funds each alderperson and candidate.' },
    { href: '/school-board-elections', name: 'School board elections', text: 'Who funds each Board of Education candidate.' },
    { href: '/mayor', name: 'The 2027 mayoral race', text: 'Who is funding the candidates for mayor.' },
    { href: '/alder-voting-history', name: 'City Council votes', text: 'How each alderperson has voted.' },
    { href: '/school-board-voting-history', name: 'School board votes', text: 'How each board member has voted.' }
  ];

  var TYPE_LABEL = { C: 'Contribution', T: 'Transfer', K: 'In-kind', L: 'Loan', G: 'Gift to an outside group', O: 'Other' };
  var OFFICE_LABEL = { council: 'City Council', school_board: 'School board', mayor: 'Mayor', group: 'Outside-spending group' };

  var PAGE = 25;
  var ITEMIZED = 50000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safe(u) { return typeof u === 'string' && (/^\/[A-Za-z0-9_\-.~?%=&]/.test(u) || /^https:\/\/[A-Za-z0-9]/.test(u)) && !/[\s\\]/.test(u); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function money(n) {
    var v = Math.round(Number(n) || 0);
    return '$' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function short(n) {
    var v = Number(n) || 0;
    if (v >= 999500) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e4) return '$' + Math.round(v / 1e3) + 'K';
    return money(v);
  }
  var MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  function date(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return esc(iso);
    return MONTHS[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  }

  // A donor's seven-figure vector for the period: one cycle, or the sum over all cycles.
  function vec(donor, cycle) {
    var out = [0, 0, 0, 0, 0, 0, 0];
    var bc = donor.by_cycle || {};
    Object.keys(bc).forEach(function (k) {
      if (cycle !== 'all' && k !== cycle) return;
      for (var j = 0; j < 7; j++) out[j] += Number(bc[k][j]) || 0;
    });
    return out;
  }
  function total(v) { return v[0] + v[1] + v[2] + v[3]; }

  function inPeriod(data, cycle, iso) {
    if (cycle === 'all') return true;
    var c = data.cycles[cycle];
    return c && iso >= c.start && iso <= c.end;
  }

  // The ranking for a period: every donor with giving in it, largest first (ties by id,
  // so the order is the same on every load).
  function ranking(data, cycle) {
    var rows = [];
    data.donors.forEach(function (d) {
      var v = vec(d, cycle), t = total(v);
      if (t > 0) rows.push({ d: d, v: v, t: t });
    });
    rows.sort(function (a, b) { return (b.t - a.t) || (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0); });
    return rows;
  }
  // How far "Show more" goes: every donor at $50,000 or more in the period (23a).
  function bigCount(rows) {
    var n = 0;
    while (n < rows.length && rows[n].t + 1e-9 >= ITEMIZED) n++;
    return n;
  }
  function cap(rows) { return Math.max(bigCount(rows), Math.min(PAGE, rows.length)); }

  function ownLoans(data, d, cycle) {
    var items = data.items[d.id];
    if (!items) return null;
    var s = 0;
    items.forEach(function (it) {
      if (it[3] === 'L' && it[4].indexOf('s') >= 0 && inPeriod(data, cycle, it[0])) s += it[2];
    });
    return s;
  }

  function marks(data, row, cycle) {
    var v = row.v, out = '';
    if (v[OWN] > 0) {
      out += '<span class="hp-chip hp-own">' + esc(STR.ownMoney) + ' ' + short(v[OWN]) + '</span>';
      var ol = ownLoans(data, row.d, cycle);
      // 25a. Only where the gifts are itemized does the data say how much of the own money
      // was loans; elsewhere no loans line is shown (package item 36).
      if (ol != null && ol > 0) {
        out += '<span class="hp-sub">of which ' + short(ol) + ' loans to their own committee</span>';
      }
    }
    if (v[OWN_COMMITTEE] > 0) {
      out += '<span class="hp-chip">' + esc(STR.ownCommittee) + '</span>';
    }
    return out;
  }

  function streamCells(v) {
    return STREAMS.map(function (s) {
      var x = v[s.i];
      return '<td class="hp-num" data-label="' + esc(s.label) + '">' + (x > 0 ? short(x) : '—') + '</td>';
    }).join('');
  }

  function recipientLabel(data, cid) {
    var r = data.recipients[cid] || {};
    var who = r.candidate ? clean(r.candidate) : clean(r.name || cid);
    var off = OFFICE_LABEL[r.office] || '';
    return { who: who, committee: clean(r.name || ''), office: off };
  }

  function detail(data, row, cycle) {
    var d = row.d, items = data.items[d.id];
    if (items) {
      var list = items.filter(function (it) { return inPeriod(data, cycle, it[0]); }).reverse();  // newest first
      var body = list.map(function (it) {
        var r = recipientLabel(data, it[1]);
        var m = [];
        if (it[3] !== 'C' && it[3] !== 'G') m.push(TYPE_LABEL[it[3]] || it[3]);
        if (it[4].indexOf('s') >= 0) m.push(STR.ownMoney.toLowerCase());
        if (it[4].indexOf('o') >= 0) m.push('own committee');
        return '<tr><td>' + date(it[0]) + '</td><td>' + esc(r.who) +
          (r.committee && r.committee !== r.who ? '<span class="hp-sub">' + esc(r.committee) + '</span>' : '') +
          '</td><td>' + esc(r.office) + '</td><td class="hp-num">' + money(it[2]) +
          (m.length ? '<span class="hp-sub">' + esc(m.join(' · ')) + '</span>' : '') + '</td></tr>';
      }).join('');
      if (!list.length) return '<div class="hp-detail"><p class="hp-small">No gifts in this period.</p></div>';
      return '<div class="hp-detail"><p class="hp-small">' + list.length + ' gift' + (list.length === 1 ? '' : 's') +
        ' in this period.</p><div class="hp-scroll"><table class="hp-items"><thead><tr><th>Date</th><th>To</th>' +
        '<th>Office</th><th class="hp-num">Amount</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
    }
    var v = row.v;
    return '<div class="hp-detail"><p class="hp-small">Totals by office for this period. Gifts are listed ' +
      'one by one for donors who gave $50,000 or more in all.</p><ul class="hp-split">' +
      STREAMS.map(function (s) { return '<li><span>' + esc(s.label) + '</span><b>' + money(v[s.i]) + '</b></li>'; }).join('') +
      '</ul></div>';
  }

  function donorRows(data, rows, state, from, to, numbered, label) {
    var out = '';
    for (var k = from; k < to; k++) {
      var row = rows[k], open = state.open === row.d.id;
      out += '<tr class="hp-donor' + (open ? ' is-open' : '') + '">' +
        '<td class="hp-rank">' + (numbered ? (k + 1) : (label || '')) + '</td>' +
        '<td class="hp-name"><button type="button" class="hp-toggle" data-donor="' + esc(row.d.id) +
        '" aria-expanded="' + open + '">' + esc(clean(row.d.name)) + '</button>' + marks(data, row, state.cycle) + '</td>' +
        '<td class="hp-num hp-total" data-label="Total">' + (row.t > 0 ? short(row.t) : '—') + '</td>' + streamCells(row.v) + '</tr>';
      if (open) out += '<tr class="hp-detail-row"><td></td><td colspan="6">' + detail(data, row, state.cycle) + '</td></tr>';
    }
    return out;
  }

  function cycleSelect(data, cycle) {
    var opts = '<option value="all"' + (cycle === 'all' ? ' selected' : '') + '>' + esc(STR.allCycles) + '</option>';
    Object.keys(data.cycles).sort().reverse().forEach(function (k) {
      opts += '<option value="' + esc(k) + '"' + (cycle === k ? ' selected' : '') + '>' + esc(data.cycles[k].label) + '</option>';
    });
    return '<label class="hp-field"><span>Period</span><select class="hp-cycle">' + opts + '</select></label>';
  }

  function donorsSection(data, state) {
    var rows = ranking(data, state.cycle);
    var q = clean(state.q).toLowerCase();
    var head = '<thead><tr><th class="hp-rank">#</th><th>Donor</th><th class="hp-num">Total</th>' +
      STREAMS.map(function (s) { return '<th class="hp-num">' + esc(s.label) + (s.key === 'mayor' ? '<sup>*</sup>' : '') + '</th>'; }).join('') +
      '</tr></thead>';
    var body, more = '', summary;
    if (q.length >= 2) {
      // 23a: search covers every donor, whatever the period; a donor with nothing in the period
      // is listed after those with something, unnumbered, with dashes.
      var rankOf = {}; rows.forEach(function (r, k) { rankOf[r.d.id] = k; });
      var hits = [];
      data.donors.forEach(function (d) {
        if (clean(d.name).toLowerCase().indexOf(q) < 0) return;
        var v = vec(d, state.cycle);
        hits.push({ d: d, v: v, t: total(v), k: rankOf.hasOwnProperty(d.id) ? rankOf[d.id] : Infinity });
      });
      hits.sort(function (a, b) { return (a.k - b.k) || (a.d.id < b.d.id ? -1 : 1); });
      body = hits.slice(0, 50).map(function (h) {
        return donorRows(data, [h], state, 0, 1, false, h.k === Infinity ? '' : h.k + 1);
      }).join('');
      summary = hits.length ? (hits.length + ' donor' + (hits.length === 1 ? '' : 's') + ' match' +
        (hits.length === 1 ? 'es' : '') + (hits.length > 50 ? '; the first 50 are shown' : '') + '.') :
        'No donor matches.';
    } else {
      var limit = Math.min(state.shown, cap(rows)), big = bigCount(rows);
      body = donorRows(data, rows, state, 0, limit, true);
      if (limit < cap(rows)) more = '<button type="button" class="hp-more">' + esc(STR.showMore) + '</button>';
      summary = (big >= limit ? 'Showing ' + limit + ' of the ' + big + ' donors who gave $50,000 or more in this period. ' :
        'Showing the top ' + limit + ' donors in this period. ') +
        'Search finds any of the ' + data.donors.length.toLocaleString('en-US') + ' donors who gave $1,000 or more since 2011.';
    }
    return '<section class="hp-sec" id="hp-donors"><h2>The largest donors</h2>' +
      '<p class="hp-lede">Every gift of a donor who gave $1,000 or more to Chicago candidates and ' +
      'outside-spending groups since May 17, 2011, counted once. Affiliated committees, such as a ' +
      'union’s locals, are combined. Select a donor to see where the money went.</p>' +
      '<div class="hp-controls">' + cycleSelect(data, state.cycle) +
      '<label class="hp-field hp-grow"><span>' + esc(STR.search) + '</span><input type="search" class="hp-q" value="' +
      esc(state.q) + '" placeholder="Name of a person, union or company" autocomplete="off"></label></div>' +
      '<p class="hp-small" aria-live="polite">' + esc(summary) + '</p>' +
      '<div class="hp-scroll"><table class="hp-table">' + head + '<tbody>' + body + '</tbody></table></div>' + more +
      '<p class="hp-note"><sup>*</sup> ' + esc(STR.mayorNote) + '</p><p class="hp-note">' + esc(STR.groupsNote) + '</p></section>';
  }

  function groupsSection(data, state) {
    var cycle = state.cycle, rows = [];
    data.groups.forEach(function (g) {
      var s = cycle === 'all' ? g.spent_total : (g.spent_by_cycle || {})[cycle] || 0;
      if (s > 0) rows.push({ g: g, s: s });
    });
    rows.sort(function (a, b) { return (b.s - a.s) || (a.g.id < b.g.id ? -1 : 1); });
    var body = rows.map(function (r, k) {
      return '<tr><td class="hp-rank">' + (k + 1) + '</td><td>' + esc(clean(r.g.name)) + '</td><td class="hp-num">' + money(r.s) + '</td></tr>';
    }).join('');
    return '<section class="hp-sec" id="hp-groups"><h2>Outside-spending groups</h2>' +
      '<p class="hp-lede">Groups that spend on Chicago races independently of the candidates, by what they ' +
      'spent in the period. Who funds them is in the donor list above.</p>' +
      (rows.length ? '<div class="hp-scroll"><table class="hp-table hp-narrow"><thead><tr><th class="hp-rank">#</th>' +
        '<th>Group</th><th class="hp-num">Spent</th></tr></thead><tbody>' + body + '</tbody></table></div>' :
        '<p class="hp-small">No outside spending in this period.</p>') + '</section>';
  }

  function feedSection(data) {
    var items = (data.feed || []).map(function (f) {
      var body = f.body === 'council' ? 'City Council' : 'Board of Education';
      var t = f.tally || {};
      // No result word: the council artifact records every roll call as "pass", and the school
      // board's outcome says "Split", not who won (review of 2026-10-14). The tally is labelled.
      var tally = (t.yes != null && t.no != null) ? t.yes + ' yes, ' + t.no + ' no' : '';
      var links = safe(f.link) ? '<a href="' + esc(f.link) + '">See the votes</a>' : '';
      if (f.body === 'council' && safe(f.source_url)) links += (links ? ' · ' : '') + '<a href="' + esc(f.source_url) + '" rel="noopener" target="_blank">Council record</a>';
      return '<li class="hp-vote"><p class="hp-meta">' + esc(body) + ' · ' + date(f.date) +
        (f.tag ? ' · <span class="hp-chip">' + esc(f.tag) + '</span>' : '') +
        (f.key ? ' <span class="hp-chip hp-key">Key vote</span>' : '') + '</p>' +
        '<p class="hp-vtitle">' + esc(clean(f.title)) + '</p><p class="hp-small">' + esc(tally) +
        (tally && links ? ' · ' : '') + links + '</p></li>';
    }).join('');
    return '<section class="hp-sec" id="hp-votes"><h2>The latest votes</h2>' +
      '<p class="hp-lede">The ten newest key votes, and divided votes the editors have tagged, from the City Council and the Board of Education.</p>' +
      '<ul class="hp-votes">' + items + '</ul></section>';
  }

  function toolsSection() {
    return '<section class="hp-sec" id="hp-tools"><ul class="hp-tools">' + TOOLS.map(function (t) {
      return '<li><a href="' + esc(t.href) + '"><b>' + esc(t.name) + '</b><span>' + esc(t.text) + '</span></a></li>';
    }).join('') + '</ul></section>';
  }

  function header() {
    return '<header class="hp-head"><h1>' + esc(STR.title) + '</h1><p class="hp-lede">' + esc(STR.intro) + '</p></header>';
  }

  function footer(data) {
    return '<footer class="hp-foot"><p class="hp-small">Gifts from the Illinois State Board of Elections, ' +
      'counted from May 17, 2011, through ' + date(data.data_through) + '. Each gift is counted once. Loans and ' +
      'in-kind gifts are counted; other receipts and dues transfers are not.</p></footer>';
  }

  function page(data, state) {
    return header() + toolsSection() + donorsSection(data, state) + groupsSection(data, state) + feedSection(data) + footer(data);
  }
  function loading() { return header() + '<p class="hp-status">' + esc(STR.loading) + '</p>' + toolsSection(); }
  function failed() {
    return header() + '<p class="hp-status" role="alert">' + esc(STR.failed) +
      ' <button type="button" class="hp-retry">' + esc(STR.retry) + '</button></p>' + toolsSection();
  }

  var api = { page: page, loading: loading, failed: failed, ranking: ranking, cap: cap, vec: vec,
              total: total, money: money, short: short, STR: STR, TOOLS: TOOLS, PAGE: PAGE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IPGHome = api;
})(this);
