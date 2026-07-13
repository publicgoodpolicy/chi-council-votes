/* Elections embed — DATA layer (pure, dual-runtime).
 *
 * No window / document / fetch / localStorage. Node can require() this for the
 * future SEO pre-render; the browser app layer (B2+) loads it as a global.
 *
 *   loadData(parsedJson) -> ONE memoized single-pass index
 *   candidateFigures(index, candidateId, cycle)  // cycle=null => all-time
 *   viewModels.raceBrowse(index, office, cycle)
 *   viewModels.raceView(index, raceId, cycle)
 *
 * The index is built in a single pass over contributions and a single pass over
 * IEs (O(C+I)); view models read pre-bucketed rows (no donors x contributions
 * nested scan — that was the council Compare-by-Donor regression).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ElectData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Office page -> the race.office values it owns.
  var OFFICE_RACE_OFFICES = {
    school_board: ['school_board_president', 'school_board_member'],
    city_council: ['alderperson'],
    mayor: ['mayor']
    // NOTE: city_clerk / city_treasurer races exist in the data but have no page
    // among the three Code Blocks (flagged in HALT 1) — intentionally unmapped.
  };

  // How each office page groups its races (sub-tabs / pickers).
  var OFFICE_GROUPS = {
    school_board: [
      { label: 'School Board', offices: ['school_board_president', 'school_board_member'] }
    ],
    city_council: [{ label: 'Wards', offices: ['alderperson'] }],
    mayor: [{ label: 'Mayor', offices: ['mayor'] }]
  };

  // Cycles never shown (out of SBE range / unattributable). Always excluded.
  var EXCLUDED_CYCLES = { 'pre-2011': 1, 'undated': 1 };
  var DUES_TYPE = 'IE Committee Dues Transfer';

  // Election windows — mirrors campaign-finance/elections/election-windows.json (the
  // browser embed can't read that file at runtime). A finance row slices to an election
  // by FILING DATE in [start,end] inclusive; start:null = open-ended past. This is the
  // ADDITIVE per-election date filter layered onto the existing cycle filtering (2024 &
  // 2026 both live in cycle '2027', so only a date slice separates them). Keep in sync.
  var ELECTION_WINDOWS = { school_board: {
    '2024': { start: null, end: '2024-12-31' },
    '2026': { start: '2025-01-01', end: '2026-12-31' } } };
  function officeType(office) { return (office && office.indexOf('school_board') === 0) ? 'school_board' : null; }
  function winFor(office, electionId) {
    var t = officeType(office), o = t && ELECTION_WINDOWS[t]; return (o && o[electionId]) || null;
  }
  function inWindow(date, win) {
    return !!win && !!date && (win.start == null || date >= win.start) && (win.end == null || date <= win.end);
  }
  // Which election a dated row belongs to (office-aware). Returns the election id or null.
  function electionOf(office, date) {
    var t = officeType(office), o = t && ELECTION_WINDOWS[t];
    if (!o || !date) return null;
    for (var id in o) { if (o.hasOwnProperty(id) && inWindow(date, o[id])) return id; }
    return null;
  }
  // Union window across all of an office's elections (earliest start, latest end). An
  // open (null) bound on any window makes that side of the union open. For school_board:
  // [null, 2026-12-31] = 2024 + 2026 — the "All elections" default for the spend tab.
  function unionWindow(office) {
    var t = officeType(office), o = t && ELECTION_WINDOWS[t];
    if (!o) return null;
    var ids = Object.keys(o), start = null, end = null, openStart = false, openEnd = false;
    for (var i = 0; i < ids.length; i++) {
      var w = o[ids[i]];
      if (w.start == null) openStart = true; else if (start == null || w.start < start) start = w.start;
      if (w.end == null) openEnd = true; else if (end == null || w.end > end) end = w.end;
    }
    return { start: openStart ? null : start, end: openEnd ? null : end };
  }
  // Election ids for an office, newest first (e.g. ["2026","2024"]).
  function spendElectionIds(office) {
    var t = officeType(office), o = t && ELECTION_WINDOWS[t];
    return o ? Object.keys(o).sort().reverse() : [];
  }
  // Resolve a spend-filter selection ('all' | electionId) to a date window. 'all' = union.
  function spendWin(office, sel) { return (sel == null || sel === 'all') ? unionWindow(office) : winFor(office, sel); }
  // Filter options for the spend tab: All (default) + This/Last per election, newest first.
  function spendElectionFilter(office, sel) {
    var opts = [{ id: 'all', label: 'All elections' }];
    spendElectionIds(office).forEach(function (id, i) {
      opts.push({ id: id, label: (i === 0 ? 'This election' : 'Last election') + ' (' + id + ')' });
    });
    return { active: sel || 'all', options: opts };
  }

  // ---- stable, URL-safe slugs (locked scheme: e.g. "bruce-leon-district-2a") ----
  // Pure + deterministic so the browser app and the future SEO pre-render derive
  // identical paths from the same data.
  function kebab(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  // Elections whose race slugs are the public/canonical ones — emitted BARE so existing
  // URLs never change. Any OTHER election (the historical 2024 school board; boundaries
  // redrawn with no crosswalk) gets its year prefixed, so cross-cycle district labels can
  // never collide on the slug->id map. Keying off election_id makes the map collision-proof
  // (Gate-1 ruling) without touching a single existing slug.
  var BARE_SLUG_ELECTIONS = { '2026-school-board': 1, '2027-municipal': 1 };
  function electionSlugPrefix(race) {
    if (!race.election_id || BARE_SLUG_ELECTIONS[race.election_id]) return '';
    var m = /^(\d{4})-/.exec(race.election_id);
    return m ? m[1] + '-' : '';
  }
  function raceSlug(race) {
    var base;
    if (race.district) base = kebab(race.district);              // "District 2A" -> "district-2a"
    else if (race.ward) base = 'ward-' + race.ward;             // ward "23"      -> "ward-23"
    else base = kebab({ school_board_president: 'school-board-president', mayor: 'mayor',
                   city_clerk: 'city-clerk', city_treasurer: 'city-treasurer' }[race.office] || race.office);
    return electionSlugPrefix(race) + base;                      // "2024-district-3" for the 2024 backfill
  }
  function candidateSlug(cand, race) { return kebab(cand.name) + '-' + raceSlug(race); }
  function raceCode(race) {           // short chip label
    if (race.district) return String(race.district).replace(/^District\s+/i, '');  // "2A"
    if (race.ward) return 'Ward ' + race.ward;
    return ({ school_board_president: 'President', mayor: 'Mayor',
              city_clerk: 'Clerk', city_treasurer: 'Treasurer' }[race.office]) || race.label;
  }
  function officeFriendly(office) {   // for the "running for X" note
    return ({ school_board_president: 'Board President', school_board_member: 'School Board',
              alderperson: 'City Council', mayor: 'Mayor',
              city_clerk: 'City Clerk', city_treasurer: 'City Treasurer' }[office]) || office;
  }

  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

  // A contribution is self-funded if it is a loan OR comes from the candidate
  // themselves (donor typed Candidate / self-funding). Small-dollar aggregate
  // and third-party donors are NOT self.
  function isSelfFunded(donors, c) {
    var d = donors[c.donor_id] || {};
    return !!(c.is_loan || c.contribution_type === 'Loan Received' ||
              d.type === 'Candidate' ||
              (d.industries || []).indexOf('self-funding') >= 0);
  }

  function loadData(json, opts) {
    opts = opts || {};
    var races = json.races || [];
    var candidates = json.candidates || [];
    var committees = json.committees || {};
    var donors = json.donors || {};
    var contributions = json.contributions || [];
    var ies = json.independent_expenditures || [];

    var raceById = {}, candidateById = {}, candidatesByRace = {};
    for (var i = 0; i < races.length; i++) raceById[races[i].id] = races[i];
    for (var j = 0; j < candidates.length; j++) {
      var cnd = candidates[j];
      candidateById[cnd.id] = cnd;
      (candidatesByRace[cnd.race_id] || (candidatesByRace[cnd.race_id] = [])).push(cnd);
    }

    // Office scope (opts.office): keep only IEs whose TARGET candidate runs for
    // this office, so council/municipal IE activity never bleeds into a
    // school-board view. inScopeCand=null means no scoping (all offices).
    var officeSet = opts.office ? OFFICE_RACE_OFFICES[opts.office] : null;
    var inScopeCand = null;
    if (officeSet) {
      inScopeCand = {};
      for (var s = 0; s < candidates.length; s++) {
        var rc = raceById[candidates[s].race_id];
        if (rc && officeSet.indexOf(rc.office) >= 0) inScopeCand[candidates[s].id] = 1;
      }
    }

    // committee key <-> candidate_id, and the committee meta lookup
    var candByCommittee = {};            // committee key -> candidate_id
    var committeeKeyByCandidate = {};    // candidate_id  -> committee key
    for (var key in committees) {
      if (!committees.hasOwnProperty(key)) continue;
      var cid = committees[key].candidate_id;
      if (cid) { candByCommittee[key] = cid; committeeKeyByCandidate[cid] = key; }
    }

    var directByCandidate = {};    // candidate_id -> [contrib rows]
    var fundersBySpender = {};     // spender committee key -> [contrib rows]  (second hop)
    var parentRollup = {};         // parent_id -> { parent_id, name, rows:[] }
    var industryByCandidate = {};  // candidate_id -> { industry -> {direct, support, oppose} }  (B4)
    var flagByCandidate = {};      // candidate_id -> { flagType -> {amount, count} }            (B4)
    var cyclesSeen = {};
    var stats = { contributionRowsVisited: 0, ieRowsVisited: 0 };

    // ---- single pass over contributions ----
    for (var k = 0; k < contributions.length; k++) {
      stats.contributionRowsVisited++;
      var ct = contributions[k];
      var ck = ct.committee_id;
      var candId = candByCommittee[ck];
      var donor = donors[ct.donor_id];
      var inScope = !EXCLUDED_CYCLES[ct.cycle] && ct.contribution_type !== DUES_TYPE;
      if (inScope && ct.cycle) cyclesSeen[ct.cycle] = 1;

      if (candId) {
        (directByCandidate[candId] || (directByCandidate[candId] = [])).push(ct);
        if (inScope) {
          var amt = ct.amount || 0;
          var inds = (donor && donor.industries && donor.industries.length) ? donor.industries : ['uncategorized'];
          var ibc = industryByCandidate[candId] || (industryByCandidate[candId] = {});
          for (var a = 0; a < inds.length; a++) {
            var slot = ibc[inds[a]] || (ibc[inds[a]] = { direct: 0, support: 0, oppose: 0 });
            slot.direct = round2(slot.direct + amt);
          }
          var flags = (donor && donor.flags) || [];
          if (flags.length) {
            var fbc = flagByCandidate[candId] || (flagByCandidate[candId] = {});
            for (var f = 0; f < flags.length; f++) {
              var ft = (flags[f] && flags[f].type) || String(flags[f]);
              var fslot = fbc[ft] || (fbc[ft] = { amount: 0, count: 0 });
              fslot.amount = round2(fslot.amount + amt); fslot.count++;
            }
          }
        }
      } else {
        var cm = committees[ck];
        if (cm && cm.type === 'independent_expenditure') {
          (fundersBySpender[ck] || (fundersBySpender[ck] = [])).push(ct);
        }
      }

      // parent rollup (browse-donors / contributor drill-down) — all contributions
      if (donor) {
        var pid = donor.parent_id || ct.donor_id;
        var pr = parentRollup[pid] ||
          (parentRollup[pid] = { parent_id: pid, name: (donors[pid] && donors[pid].name) || donor.name, rows: [] });
        pr.rows.push(ct);
      }
    }

    // ---- single pass over IEs ----
    var ieByCandidate = {};  // candidate_id -> {support:[], oppose:[]}
    var iesBySpender = {};   // spender committee key -> [ie rows]
    var inScopeIE = {};      // IE committee keys with >=1 kept IE (office-scoped)
    for (var m = 0; m < ies.length; m++) {
      stats.ieRowsVisited++;
      var ie = ies[m];
      // item 5: a candidate's OWN committee is never an independent spender
      if (candByCommittee[ie.spender_committee_id]) continue;
      // item 4: office scope — drop IEs whose target runs for another office
      if (inScopeCand && !inScopeCand[ie.target_candidate_id]) continue;
      if (ie.spender_committee_id) {
        (iesBySpender[ie.spender_committee_id] || (iesBySpender[ie.spender_committee_id] = [])).push(ie);
        inScopeIE[ie.spender_committee_id] = 1;
      }
      var tcand = ie.target_candidate_id;
      if (!tcand) continue;
      var bucket = ieByCandidate[tcand] || (ieByCandidate[tcand] = { support: [], oppose: [] });
      (ie.stance === 'oppose' ? bucket.oppose : bucket.support).push(ie);
      if (!EXCLUDED_CYCLES[ie.cycle]) {
        if (ie.cycle) cyclesSeen[ie.cycle] = 1;
        var sp = committees[ie.spender_committee_id];
        var tags = (sp && sp.industry_tags) || [];
        var ibc2 = industryByCandidate[tcand] || (industryByCandidate[tcand] = {});
        var field = ie.stance === 'oppose' ? 'oppose' : 'support';
        for (var t = 0; t < tags.length; t++) {
          var s2 = ibc2[tags[t]] || (ibc2[tags[t]] = { direct: 0, support: 0, oppose: 0 });
          s2[field] = round2(s2[field] + (ie.amount || 0));
        }
      }
    }

    // slug -> id resolvers (for app navigation + SEO paths)
    var raceBySlug = {}, candidateBySlug = {};
    for (var ri = 0; ri < races.length; ri++) raceBySlug[raceSlug(races[ri])] = races[ri].id;
    for (var ci = 0; ci < candidates.length; ci++) {
      var cc = candidates[ci], rr = raceById[cc.race_id];
      if (rr) candidateBySlug[candidateSlug(cc, rr)] = cc.id;
    }

    // Affiliated-entity rollup metadata (parent -> {members, roles, ...}), keyed by the
    // canonical (parent) donor id, so the donor popup can show the entity breakdown.
    var donorClusters = json.donor_clusters || {};
    var clusterByParent = {};
    for (var ccid in donorClusters) {
      if (!donorClusters.hasOwnProperty(ccid)) continue;
      var _cl = donorClusters[ccid];
      if (_cl && _cl.canonical_id) clusterByParent[_cl.canonical_id] = _cl;
    }
    return {
      races: races, candidates: candidates, committees: committees, donors: donors,
      donorClusters: donorClusters, clusterByParent: clusterByParent,
      industryTags: json.industry_tags || {}, flagTypes: json.flag_types || {},
      rollups: json.rollups || {},
      raceById: raceById, candidateById: candidateById, candidatesByRace: candidatesByRace,
      candByCommittee: candByCommittee, committeeKeyByCandidate: committeeKeyByCandidate,
      directByCandidate: directByCandidate, ieByCandidate: ieByCandidate, iesBySpender: iesBySpender,
      inScopeIE: inScopeIE, office: opts.office || null,
      fundersBySpender: fundersBySpender, parentRollup: parentRollup,
      industryByCandidate: industryByCandidate, flagByCandidate: flagByCandidate,
      raceBySlug: raceBySlug, candidateBySlug: candidateBySlug,
      cyclesSeen: cyclesSeen, _stats: stats, _memo: {}
    };
  }

  function sumIE(list, cycle, win) {
    var s = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
      var ie = list[i];
      if (EXCLUDED_CYCLES[ie.cycle]) continue;
      if (cycle != null && ie.cycle !== cycle) continue;
      if (win && !inWindow(ie.date, win)) continue;
      s += ie.amount || 0; n++;
    }
    return { amount: s, count: n };
  }

  // The three money figures, kept SEPARATE — never summed into one number.
  // cycle = null -> all-time (all non-excluded cycles); else a specific cycle code.
  function candidateFigures(index, candidateId, cycle, win) {
    var direct = index.directByCandidate[candidateId] || [];
    var total = 0, self = 0, count = 0;
    for (var i = 0; i < direct.length; i++) {
      var c = direct[i];
      if (EXCLUDED_CYCLES[c.cycle]) continue;
      if (c.contribution_type === DUES_TYPE) continue;
      if (cycle != null && c.cycle !== cycle) continue;
      if (win && !inWindow(c.date, win)) continue;
      var a = c.amount || 0;
      total += a; count++;
      if (isSelfFunded(index.donors, c)) self += a;
    }
    var ieB = index.ieByCandidate[candidateId] || { support: [], oppose: [] };
    var sup = sumIE(ieB.support, cycle, win), opp = sumIE(ieB.oppose, cycle, win);
    return {
      contributions: { total: round2(total), selfFunded: round2(self), thirdParty: round2(total - self), count: count },
      independentSupport: round2(sup.amount), independentSupportCount: sup.count,
      independentOpposition: round2(opp.amount), independentOppositionCount: opp.count
    };
  }

  // Illinois Sunshine link — council embed's exact construction: prefer a stored
  // il_sunshine_url, else build from the SBE id (encoded), else none.
  function sunshineUrl(cm) {
    if (!cm) return null;
    if (cm.il_sunshine_url) return cm.il_sunshine_url;
    if (cm.sbe_committee_id) return 'https://illinoissunshine.org/committees/' + encodeURIComponent(cm.sbe_committee_id) + '/';
    return null;
  }

  function committeeMeta(index, candidateId) {
    var ckey = index.committeeKeyByCandidate[candidateId];
    if (!ckey) return null;
    var cm = index.committees[ckey];
    return {
      key: ckey, name: cm.committee_name || null, sbe_committee_id: cm.sbe_committee_id || null,
      sunshineUrl: sunshineUrl(cm)
    };
  }

  // Contributor drill-down: a candidate's direct contributions rolled up by
  // parent_id, sorted desc, INCLUDING the small-dollar aggregate as its own line.
  // Option A: lines sum EXACTLY to candidateFigures().contributions.total.
  function candidateContributors(index, candidateId, cycle, win) {
    var rows = index.directByCandidate[candidateId] || [];
    var by = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (EXCLUDED_CYCLES[c.cycle]) continue;
      if (c.contribution_type === DUES_TYPE) continue;
      if (cycle != null && c.cycle !== cycle) continue;
      if (win && !inWindow(c.date, win)) continue;
      var donor = index.donors[c.donor_id] || {};
      var pid = donor.parent_id || c.donor_id;
      var parent = index.donors[pid] || donor;
      var m = by[pid] || (by[pid] = { parent_id: pid, name: parent.name || pid,
        industries: parent.industries || [], flags: parent.flags || [],
        total: 0, count: 0, isSelf: false, isAggregate: false });
      m.total = round2(m.total + (c.amount || 0)); m.count++;
      // Self-funding is the pipeline's ONE relational decision, stamped per row by
      // build_rollups (donor identity-matches THIS recipient). The render DISPLAYS it; it
      // does not decide self from donor-global attributes (which leaked a self-funder's
      // gift to ANOTHER candidate, e.g. Leon->Rosenfeld).
      if (c.is_self) m.isSelf = true;
      if (parent.type === 'Aggregate' || (parent.industries || []).indexOf('small-dollar') >= 0) m.isAggregate = true;
    }
    var lines = []; for (var k in by) if (by.hasOwnProperty(k)) lines.push(by[k]);
    lines.sort(function (a, b) { return b.total - a.total; });
    var total = 0; for (var j = 0; j < lines.length; j++) total += lines[j].total;
    return { lines: lines, total: round2(total), count: lines.length };
  }

  // Second hop: who funds one IE committee — contributions INTO it, dues excluded,
  // rolled up by parent_id, sorted desc.
  function spenderFunders(index, spenderKey) {
    var rows = index.fundersBySpender[spenderKey] || [];
    var by = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (c.contribution_type === DUES_TYPE) continue;        // internal dues transfers are not giving
      var donor = index.donors[c.donor_id] || {};
      var pid = donor.parent_id || c.donor_id;
      var parent = index.donors[pid] || donor;
      var m = by[pid] || (by[pid] = { parent_id: pid, name: parent.name || pid,
        industries: parent.industries || [], flags: parent.flags || [], total: 0, count: 0 });
      m.total = round2(m.total + (c.amount || 0)); m.count++;
    }
    var funders = []; for (var k in by) if (by.hasOwnProperty(k)) funders.push(by[k]);
    funders.sort(function (a, b) { return b.total - a.total; });
    var total = 0; for (var j = 0; j < funders.length; j++) total += funders[j].total;
    return { funders: funders, total: round2(total), count: funders.length };
  }

  // Tier 3: a donor's footprint WITHIN this election artifact — every committee /
  // candidate this parent has funded (direct gifts + money into IE committees),
  // dues excluded. Election-scoped only; council-side giving is NOT included.
  // Chronological cycle order: a "pre-YYYY" bucket sorts just BEFORE that year (oldest
  // first), so pre-2011 < 2015 < 2019 < 2023 < 2027 (a plain lexical sort puts "pre-…"
  // last because 'p' > '2'). Used wherever a cycle list is displayed.
  function cycleKey(c) {
    var s = String(c), pre = /^pre-?(\d{4})/i.exec(s);
    if (pre) return (+pre[1]) - 0.5;
    var y = /(\d{4})/.exec(s);
    return y ? +y[1] : 1e9;
  }
  function sortCycles(arr) { return arr.slice().sort(function (a, b) { return cycleKey(a) - cycleKey(b); }); }

  // Display year for one contribution row: prefer the filing date, else fall back to
  // the cycle — reusing the same /(\d{4})/ extraction as cycleKey. Aggregate rows have
  // date:null, so they resolve to their cycle year; render shows the bare year (never a
  // fabricated month/day).
  function rowYear(c) {
    var d = /(\d{4})/.exec(String(c.date || ''));
    if (d) return +d[1];
    var y = /(\d{4})/.exec(String(c.cycle || ''));
    return y ? +y[1] : null;
  }

  function donorFootprint(index, parentId, win) {
    var parent = index.donors[parentId] || { id: parentId, name: parentId };
    var pr = index.parentRollup[parentId];
    var rows = (pr && pr.rows) || [];
    var by = {}, entBy = {}, cyc = {}, kept = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (c.contribution_type === DUES_TYPE) continue;
      if (win && !inWindow(c.date, win)) continue;
      var cid = c.committee_id, cm = index.committees[cid] || {};
      // office scope: an IE committee that didn't spend in this office is out of
      // scope (e.g. a council-only IE PAC must not appear in a school-board view).
      if (cm.type === 'independent_expenditure' && index.office && !index.inScopeIE[cid]) continue;
      var m = by[cid];
      if (!m) {
        m = by[cid] = { committee_id: cid, total: 0, count: 0, kind: 'other', label: cm.committee_name || cid, rows: [] };
        if (cm.candidate_id) {
          var cand = index.candidateById[cm.candidate_id] || {}, race = index.raceById[cand.race_id] || {};
          m.kind = 'candidate'; m.label = (cand.name || cm.candidate_id) + (race.label ? (' — ' + race.label) : '');
        } else if (cm.type === 'independent_expenditure') {
          m.kind = 'ie'; m.label = cm.committee_name || cid;
          m.ieIdentity = spenderFunders(index, cid).funders.slice(0, 3).map(function (x) { return x.name; });
        }
      }
      m.total = round2(m.total + (c.amount || 0)); m.count++;
      // X-1: itemized direct-contribution row, additive (existing fields/keys untouched).
      // Optional flags default to false; in_kind_description / contribution_count are null
      // unless the row carries them. Stream is direct by construction — pr.rows are
      // contributions[] only, never IE rows (verified: no contribution carries a stance).
      m.rows.push({
        date: c.date || null, year: rowYear(c), amount: c.amount || 0,
        is_self: !!c.is_self, is_loan: !!c.is_loan, is_in_kind: !!c.is_in_kind,
        in_kind_description: c.in_kind_description || null,
        is_aggregate: !!c.is_aggregate, contribution_count: c.contribution_count || null
      });
      kept++;
      if (c.cycle) cyc[c.cycle] = 1;
      var eid = c.donor_id, em = entBy[eid] || (entBy[eid] = { id: eid, amount: 0, count: 0 });
      em.amount = round2(em.amount + (c.amount || 0)); em.count++;
    }
    var committees = [];
    for (var k in by) if (by.hasOwnProperty(k)) {
      // Rows newest-first; ISO dates sort lexically = chronologically. Null-dated
      // (aggregate) rows sort last.
      by[k].rows.sort(function (a, b) { var da = a.date || '', db = b.date || ''; return da < db ? 1 : da > db ? -1 : 0; });
      committees.push(by[k]);
    }
    committees.sort(function (a, b) { return b.total - a.total; });
    var total = 0; for (var j = 0; j < committees.length; j++) total += committees[j].total;
    // Affiliated-entity breakdown (E-2): split the SAME windowed rows by the actual filer
    // (child entity), so the per-entity figures sum EXACTLY to the footprint total. This is
    // ONE legitimate stream (a sum of affiliated-entity contributions), NOT direct + support
    // + oppose — firewall-clean. Present only when >1 entity gave within the window.
    var cluster = index.clusterByParent && index.clusterByParent[parentId];
    var entIds = []; for (var e in entBy) if (entBy.hasOwnProperty(e)) entIds.push(e);
    var rollup = null;
    if (cluster && entIds.length > 1) {
      var roles = cluster.roles || {};
      var members = entIds.map(function (eid) {
        var dn = index.donors[eid] || {};
        return { id: eid, name: dn.name || eid,
          role: (eid === parentId) ? 'parent' : (roles[eid] || 'related'),
          amount: entBy[eid].amount, count: entBy[eid].count };
      });
      members.sort(function (a, b) {
        if (a.role === 'parent' && b.role !== 'parent') return -1;
        if (b.role === 'parent' && a.role !== 'parent') return 1;
        return b.amount - a.amount;
      });
      rollup = { relationship: cluster.relationship || 'affiliated entities',
        total: round2(total), members: members, entities: members.length };
    }
    return {
      parent_id: parentId, name: parent.name || parentId, win: win || null,
      industries: parent.industries || [], flags: parent.flags || [],
      committees: committees, total: round2(total), count: committees.length,
      contributionsCount: kept, cycles: sortCycles(Object.keys(cyc)), rollup: rollup,
      industryTags: index.industryTags
    };
  }

  // Committee profile (bidirectional with the donor footprint). For an IE
  // committee: what it spent in support vs opposition, by candidate, + who funds
  // it (second hop). For a candidate committee: what it raised + its contributors.
  // funders/contributors are donorRow-compatible lines (clickable back to a
  // footprint) — one modal system, two content types.
  function committeeProfile(index, committeeKey, win) {
    var cm = index.committees[committeeKey] || {};
    var sun = sunshineUrl(cm);
    var office = index.office;
    var bce = (index.rollups && index.rollups.by_candidate_election) || {};
    if (cm.type === 'independent_expenditure') {
      // FIREWALL: group this committee's IEs by (target candidate × ELECTION), keeping
      // support/oppose as SEPARATE streams — never one summed "funded X". Each target
      // carries the candidate's per-election label ("2024: District 3" / "2026") so a
      // 2024 member-race spend can never read as current-race (2026) spending. `win`
      // scopes to the active election filter (union = All).
      var byCand = {}, support = 0, oppose = 0;
      var src = index.iesBySpender[committeeKey] || [];
      for (var i = 0; i < src.length; i++) {
        var ie = src[i];
        if (EXCLUDED_CYCLES[ie.cycle]) continue;
        if (win && !inWindow(ie.date, win)) continue;
        var eid = electionOf(office, ie.date);
        var cand = index.candidateById[ie.target_candidate_id] || {};
        var race = index.raceById[cand.race_id || ie.target_race_id] || {};
        var cb = (ie.target_candidate_id && bce[ie.target_candidate_id]) || {};
        var elabel = (eid && cb[eid] && cb[eid].label) || eid || 'undated';
        var tc = (ie.target_candidate_id || ('race:' + ie.target_race_id)) + '|' + (eid || 'undated');
        var m = byCand[tc] || (byCand[tc] = { candidate_id: ie.target_candidate_id || null,
          name: cand.name || ('race ' + ie.target_race_id), raceLabel: race.label || null,
          electionId: eid || null, electionLabel: elabel, support: 0, oppose: 0, total: 0, count: 0,
          needsReview: false, methods: {}, rows: [] });
        var a = ie.amount || 0;
        if (ie.stance === 'oppose') { m.oppose = round2(m.oppose + a); oppose = round2(oppose + a); }
        else { m.support = round2(m.support + a); support = round2(support + a); }
        m.total = round2(m.total + a); m.count++;
        if (ie.needs_review) m.needsReview = true;            // 3b provenance, surfaced per line
        if (ie.match_method) m.methods[ie.match_method] = 1;
        // X-1b: itemized IE row, additive. Attaches to THIS target×election group, so it is
        // single-stance by construction (the target sits on one side of the for/against line).
        // No committee-wide sort — that would interleave for/against (firewall). stance kept on
        // the row for render coloring; never re-aggregated across targets.
        m.rows.push({
          date: ie.date || null, year: rowYear(ie), amount: a, stance: ie.stance || 'support',
          target_candidate_id: ie.target_candidate_id || null, target_ward: ie.target_ward != null ? ie.target_ward : null,
          purpose: ie.purpose || null, match_method: ie.match_method || null, needs_review: !!ie.needs_review
        });
      }
      var targets = [];
      for (var k in byCand) if (byCand.hasOwnProperty(k)) {
        var tt = byCand[k]; tt.matchMethods = Object.keys(tt.methods); delete tt.methods;
        // Rows newest-first WITHIN this target only (single-stance group); null dates last.
        tt.rows.sort(function (a, b) { var da = a.date || '', db = b.date || ''; return da < db ? 1 : da > db ? -1 : 0; });
        targets.push(tt);
      }
      targets.sort(function (a, b) { return b.total - a.total; });
      var ff = spenderFunders(index, committeeKey);
      return {
        committee_id: committeeKey, kind: 'ie', name: cm.committee_name || committeeKey, win: win || null,
        sunshineUrl: sun, isIE: true, identity: ff.funders.slice(0, 3).map(function (x) { return x.name; }),
        support: round2(support), oppose: round2(oppose), total: round2(support + oppose), targets: targets,
        funders: ff.funders, funderTotal: ff.total, funderCount: ff.count
      };
    }
    // candidate (or other) committee — show what it raised + its contributors (window-scoped)
    var candId = cm.candidate_id || null;
    var cand2 = candId ? (index.candidateById[candId] || {}) : {};
    var race2 = cand2.race_id ? (index.raceById[cand2.race_id] || {}) : {};
    var contrib = candId ? candidateContributors(index, candId, null, win) : { lines: [], total: 0, count: 0 };
    return {
      committee_id: committeeKey, kind: 'candidate', name: cm.committee_name || committeeKey, win: win || null,
      candidateName: cand2.name || null, raceLabel: race2.label || null, sunshineUrl: sun, isIE: false,
      raised: contrib.total, funders: contrib.lines, funderTotal: contrib.total, funderCount: contrib.count
    };
  }

  // IE drill-down for one candidate + stance: the spender committee(s), each with
  // its second-hop top funders. Spender names are placeholders, so the funders
  // are the identity ("funded primarily by ...").
  function candidateIE(index, candidateId, stance, cycle, win) {
    var ieB = index.ieByCandidate[candidateId] || { support: [], oppose: [] };
    var list = stance === 'oppose' ? ieB.oppose : ieB.support;
    var by = {};
    for (var i = 0; i < list.length; i++) {
      var ie = list[i];
      if (EXCLUDED_CYCLES[ie.cycle]) continue;
      if (cycle != null && ie.cycle !== cycle) continue;
      if (win && !inWindow(ie.date, win)) continue;
      var sk = ie.spender_committee_id;
      var m = by[sk] || (by[sk] = { spender_committee_id: sk, amount: 0, count: 0, needsReview: false, methods: {} });
      m.amount = round2(m.amount + (ie.amount || 0)); m.count++;
      // 3b provenance (admin-review seam): surface needs_review + the match method(s).
      if (ie.needs_review) m.needsReview = true;
      if (ie.match_method) m.methods[ie.match_method] = 1;
    }
    var spenders = [];
    for (var key in by) {
      if (!by.hasOwnProperty(key)) continue;
      var s = by[key], cm = index.committees[key] || {};
      var ff = spenderFunders(index, key);
      s.committeeName = cm.committee_name || key;
      s.industryTags = cm.industry_tags || [];
      s.matchMethods = Object.keys(s.methods);
      s.sunshineUrl = sunshineUrl(cm);
      s.topFunders = ff.funders.slice(0, 3);
      s.funders = ff.funders;
      s.funderTotal = ff.total;
      s.funderCount = ff.count;
      spenders.push(s);
    }
    spenders.sort(function (a, b) { return b.amount - a.amount; });
    var total = 0; for (var t = 0; t < spenders.length; t++) total += spenders[t].amount;
    return { stance: stance, spenders: spenders, total: round2(total) };
  }

  // Per-candidate industry composition (optionally windowed) — same logic as spendAgg
  // for ONE candidate: contributions x donor.industries + IE spender.industry_tags.
  // Uncategorized donors render as 'uncategorized', never silently bucketed. Powers the
  // per-election industries strip in the toggle panels (reuses the spend-tab markup).
  function candidateIndustries(index, candidateId, cycle, win) {
    var ind = {};
    function slot(tag) { return ind[tag] || (ind[tag] = { industry: tag, direct: 0, support: 0, oppose: 0 }); }
    var dr = index.directByCandidate[candidateId] || [];
    for (var d = 0; d < dr.length; d++) {
      var c = dr[d];
      if (EXCLUDED_CYCLES[c.cycle] || c.contribution_type === DUES_TYPE) continue;
      if (cycle != null && c.cycle !== cycle) continue;
      if (win && !inWindow(c.date, win)) continue;
      var donor = index.donors[c.donor_id] || {}, amt = c.amount || 0;
      var inds = (donor.industries && donor.industries.length) ? donor.industries : ['uncategorized'];
      for (var a = 0; a < inds.length; a++) { var s = slot(inds[a]); s.direct = round2(s.direct + amt); }
    }
    var ieB = index.ieByCandidate[candidateId] || { support: [], oppose: [] };
    ['support', 'oppose'].forEach(function (field) {
      ieB[field].forEach(function (ie) {
        if (EXCLUDED_CYCLES[ie.cycle]) return;
        if (cycle != null && ie.cycle !== cycle) return;
        if (win && !inWindow(ie.date, win)) return;
        var sp = index.committees[ie.spender_committee_id] || {}, tags = sp.industry_tags || [], amt2 = ie.amount || 0;
        for (var t = 0; t < tags.length; t++) { var s2 = slot(tags[t]); s2[field] = round2(s2[field] + amt2); }
      });
    });
    var arr = []; for (var k in ind) if (ind.hasOwnProperty(k)) { var x = ind[k]; x.total = round2(x.direct + x.support + x.oppose); arr.push(x); }
    arr.sort(function (a, b) { return b.total - a.total; });
    return arr;
  }

  // Neutral order = alphabetical by SURNAME (ballot convention), never by amount.
  // Strip a trailing generational suffix, then key on the last token.
  function surnameKey(name) {
    var n = String(name || '').replace(/,?\s*(jr|sr|ii|iii|iv)\.?$/i, '').trim();
    var toks = n.split(/\s+/);
    return (toks[toks.length - 1] || n).toLowerCase();
  }
  function byNameNeutral(a, b) {
    var s = surnameKey(a.name).localeCompare(surnameKey(b.name));
    return s !== 0 ? s : String(a.name).localeCompare(String(b.name));
  }
  function byRaceOrder(a, b) {
    var ak = (a.geo_key == null) ? 0 : 1, bk = (b.geo_key == null) ? 0 : 1; // citywide first
    if (ak !== bk) return ak - bk;
    return (a.geo_key || 0) - (b.geo_key || 0);
  }

  // ---- view models ----
  function hasAnyFinance(index, raceId) {
    var cs = index.candidatesByRace[raceId] || [];
    for (var i = 0; i < cs.length; i++) if (cs[i].committee_id) return true;
    return false;
  }

  // ---- This / Last / All-Elections toggle (per-candidate buckets) ----
  // Reads the precomputed rollups.by_candidate_election (built globally in
  // build_rollups, bucketed by FILING DATE). Scoped to the loaded 2024-cohort
  // races (sb-d04..sb-d09): their candidates' 2024 status is verified (returning
  // incumbents carry prior_election; appointees/challengers are confirmed 2024
  // non-candidates). Other SB races (e.g. sb-d03 Leon) have 2024 returners that
  // still LACK prior_election and would mislabel as "did not run", so they stay on
  // the all-years view until verified. Widen this set as cohorts are verified.
  var TOGGLE_RACES = { 'sb-d04': 1, 'sb-d05': 1, 'sb-d06': 1, 'sb-d07': 1, 'sb-d08': 1, 'sb-d09': 1,
                       'sb-d10': 1, 'sb-d11': 1, 'sb-d12': 1, 'sb-president': 1 };

  // Map one by_candidate_election bucket to the FOUR SEPARATE streams the render
  // bars consume. contributions (third-party) and self_funding are kept distinct;
  // nothing is summed across the four streams.
  function bucketFigures(bk) {
    return {
      contributions: round2(bk.contributions.amount), contributionsCount: bk.contributions.count,
      selfFunding: round2(bk.self_funding.amount), selfFundingCount: bk.self_funding.count,
      independentSupport: round2(bk.ie_support.amount), independentSupportCount: bk.ie_support.count,
      independentOpposition: round2(bk.ie_oppose.amount), independentOppositionCount: bk.ie_oppose.count
    };
  }

  // Dateless small-dollar aggregate for a candidate (the _small-dollar-donors rows):
  // these carry no filing date so they bucket to NO election; surfaced separately in
  // the All-Elections view so 2024 + 2026 + undated reconciles to the all-years total.
  function undatedSmallDollar(index, candId) {
    var rows = index.directByCandidate[candId] || [], amt = 0, n = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (EXCLUDED_CYCLES[c.cycle] || c.contribution_type === DUES_TYPE) continue;
      if (c.date) continue;          // dated rows bucket to an election
      amt += c.amount || 0; n++;
    }
    return { amount: round2(amt), count: n };
  }

  function raceElections(index, raceId) {
    var race = index.raceById[raceId];
    if (!race) return null;
    var bce = (index.rollups && index.rollups.by_candidate_election) || {};
    var cands = (index.candidatesByRace[raceId] || []).slice()
      .filter(function (c) { return !c.vacating_for; }).sort(byNameNeutral);
    if (!cands.length) return null;
    // Full election set for the office = union of all bucket keys across all candidates
    // (NOT just this race), so a race whose candidates only have 2026 money (e.g.
    // sb-d05) still renders an empty "Last election (2024)" tab.
    var idset = {};
    for (var cc in bce) { if (!bce.hasOwnProperty(cc)) continue; for (var e in bce[cc]) if (bce[cc].hasOwnProperty(e)) idset[e] = 1; }
    var ids = Object.keys(idset).sort().reverse();   // newest first -> ["2026","2024"]
    if (!ids.length) return null;
    var toggles = ids.map(function (id, i) {
      return { id: id, role: i === 0 ? 'this' : 'prior',
               label: (i === 0 ? 'This election' : 'Last election') + ' (' + id + ')' };
    });
    // Combined ("All elections") window = union of the office's election windows
    // (earliest start, latest end). For school_board: [null, 2026-12-31] = 2024 + 2026.
    var combinedWin = (function () {
      var ws = ids.map(function (id) { return winFor(race.office, id); }).filter(Boolean);
      if (!ws.length) return null;
      var start = ws.some(function (w) { return w.start == null; }) ? null : ws.map(function (w) { return w.start; }).sort()[0];
      var ends = ws.map(function (w) { return w.end; });
      var end = ends.some(function (e) { return e == null; }) ? null : ends.slice().sort().reverse()[0];
      return { start: start, end: end };
    })();
    var SK = ['contributions', 'selfFunding', 'independentSupport', 'independentOpposition'];
    var candidates = cands.map(function (c) {
      var b = bce[c.id] || {}, byElection = {};
      ids.forEach(function (id) {
        var bk = b[id], win = winFor(race.office, id);
        // Each election panel carries its date-window-sliced drill-down data (council
        // components reused): contributor list, IE support/oppose detail, industries.
        byElection[id] = {
          label: bk ? (bk.label || id) : id,
          figures: bk ? bucketFigures(bk) : null,
          win: win,
          contributors: candidateContributors(index, c.id, null, win),
          ieSupportDetail: candidateIE(index, c.id, 'support', null, win),
          ieOpposeDetail: candidateIE(index, c.id, 'oppose', null, win),
          industries: candidateIndustries(index, c.id, null, win)
        };
      });
      // Combined figures SUM the per-election buckets (so combined == This + Last per
      // stream, streams never merged); drill-down uses the union window (= same rows).
      var cf = { contributions: 0, contributionsCount: 0, selfFunding: 0, selfFundingCount: 0,
                 independentSupport: 0, independentSupportCount: 0, independentOpposition: 0, independentOppositionCount: 0 };
      ids.forEach(function (id) {
        var g = byElection[id].figures; if (!g) return;
        SK.forEach(function (k) { cf[k] = round2(cf[k] + g[k]); cf[k + 'Count'] += g[k + 'Count']; });
      });
      var combined = {
        figures: cf, win: combinedWin,
        contributors: candidateContributors(index, c.id, null, combinedWin),
        ieSupportDetail: candidateIE(index, c.id, 'support', null, combinedWin),
        ieOpposeDetail: candidateIE(index, c.id, 'oppose', null, combinedWin),
        industries: candidateIndustries(index, c.id, null, combinedWin)
      };
      return { id: c.id, slug: candidateSlug(c, race), name: c.name, incumbent: !!c.incumbent,
               priorElection: c.prior_election || null, undated: undatedSmallDollar(index, c.id),
               byElection: byElection, combined: combined };
    });
    return { race: { id: race.id, slug: raceSlug(race), label: race.label, office: race.office },
             electionIds: ids, toggles: toggles, candidates: candidates };
  }

  function raceView(index, raceId, cycle) {
    var race = index.raceById[raceId];
    if (!race) return null;
    var all = (index.candidatesByRace[raceId] || []).slice().sort(byNameNeutral);
    // A vacating incumbent (running for another office) is NOT listed here as a
    // candidate; the district surfaces a pointer to the office they're seeking.
    var vacating = [], active = [];
    for (var i = 0; i < all.length; i++) {
      var c = all[i], target = c.vacating_for ? index.raceById[c.vacating_for] : null;
      if (target) {
        vacating.push({ name: c.name, targetRaceId: target.id, targetSlug: raceSlug(target),
                        targetLabel: officeFriendly(target.office) });
      } else { active.push(c); }
    }
    return {
      race: {
        id: race.id, slug: raceSlug(race), code: raceCode(race),
        label: race.label, office: race.office, status: race.status,
        district: race.district || null, ward: race.ward || null, election_id: race.election_id,
        hasFinance: hasAnyFinance(index, race.id), vacating: vacating
      },
      cycle: cycle || null,
      elections: TOGGLE_RACES[raceId] ? raceElections(index, raceId) : null,
      candidates: active.map(function (c) {
        var hasFinance = !!c.committee_id;
        return {
          id: c.id, slug: candidateSlug(c, race), name: c.name,
          incumbent: !!c.incumbent, status: c.status,
          // HALT-P1-B: 2024 CBOE-native result axis + write-in marker + finance_facet enum
          // (+ empty-committee sbe ref) pass through to render; null/absent for 2026 records.
          result: c.result || null, writeIn: !!c.write_in,
          financeFacet: c.finance_facet || null, committeeSbeRef: c.committee_sbe_ref || null,
          hasFinance: hasFinance, stillPopulating: !hasFinance,
          committee: hasFinance ? committeeMeta(index, c.id) : null,
          figures: hasFinance ? candidateFigures(index, c.id, cycle) : null,
          contributors: hasFinance ? candidateContributors(index, c.id, cycle) : null,
          ieSupportDetail: hasFinance ? candidateIE(index, c.id, 'support', cycle) : null,
          ieOpposeDetail: hasFinance ? candidateIE(index, c.id, 'oppose', cycle) : null
        };
      })
    };
  }

  // Grouped race list for the office nav + picker (browse layer).
  // Dormant-election gate (HALT-P1-A): the set of election_ids that actually carry
  // candidacies. A cycle-scoped election with none (the 2024 backfill, before P1-B) must
  // NOT surface as empty race shells in ANY office-scoped race ENUMERATION (nav, browse,
  // spend grouping). Candidate-driven listers are auto-safe (a candidacy-less race yields
  // no rows); only functions that walk the race list need this. Gated at the ELECTION level
  // so a genuinely forming race in a LIVE election (e.g. a 2027-municipal ward with no
  // filers yet) still shows. Byte-identical today: both current elections have candidacies;
  // only 2024 lacks. Memoized per index.
  function liveElectionSet(index) {
    if (index._memo && index._memo.liveElections) return index._memo.liveElections;
    var s = {};
    (index.candidates || []).forEach(function (c) {
      var r = index.raceById[c.race_id]; if (r && r.election_id) s[r.election_id] = 1;
    });
    if (index._memo) index._memo.liveElections = s;
    return s;
  }
  function raceIsLive(index, r) { return !r.election_id || !!liveElectionSet(index)[r.election_id]; }

  function officeRaces(index, office) {
    var groups = OFFICE_GROUPS[office] || [];
    return {
      office: office,
      groups: groups.map(function (g) {
        var rs = index.races.filter(function (r) {
          return g.offices.indexOf(r.office) >= 0 && raceIsLive(index, r);
        }).sort(byRaceOrder);
        return {
          label: g.label,
          races: rs.map(function (r) {
            return {
              id: r.id, slug: raceSlug(r), code: raceCode(r), label: r.label,
              status: r.status, hasFinance: hasAnyFinance(index, r.id),
              candidateCount: (index.candidatesByRace[r.id] || []).length
            };
          })
        };
      })
    };
  }

  function raceBrowse(index, office, cycle) {
    var offices = OFFICE_RACE_OFFICES[office] || [];
    var races = index.races.filter(function (r) { return offices.indexOf(r.office) >= 0 && raceIsLive(index, r); }).sort(byRaceOrder);
    return {
      office: office, cycle: cycle || null,
      races: races.map(function (r) {
        return {
          id: r.id, label: r.label, status: r.status, district: r.district || null, ward: r.ward || null,
          candidates: (index.candidatesByRace[r.id] || []).slice().sort(byNameNeutral).map(function (c) {
            return {
              id: c.id, name: c.name, incumbent: !!c.incumbent, hasFinance: !!c.committee_id,
              contributions: c.committee_id ? candidateFigures(index, c.id, cycle).contributions.total : null
            };
          })
        };
      })
    };
  }

  // Selectable cycles (non-excluded), newest-ish first; for the B5 year filter.
  function availableCycles(index) {
    return Object.keys(index.cyclesSeen).sort().reverse();
  }

  // ---- Election Spend subtabs (office-scoped) ----

  // Is a recipient committee in the current office scope? Candidate committees of
  // an in-office race, and IE committees that spent in-office, are in scope.
  function recipInScope(index, committeeKey) {
    var cm = index.committees[committeeKey] || {};
    if (!index.office) return true;
    var offs = OFFICE_RACE_OFFICES[index.office] || [];
    if (cm.candidate_id) {
      var race = index.raceById[(index.candidateById[cm.candidate_id] || {}).race_id] || {};
      return offs.indexOf(race.office) >= 0;
    }
    if (cm.type === 'independent_expenditure') return !!index.inScopeIE[committeeKey];
    return false;
  }

  // 1) Browse donors — real donors (by parent_id) ranked by office-scoped giving,
  // merged with IE committees as "political spender" rows (ranked by their spend).
  // Browse-Donors filters (E-1): donor-type / industry / flag / name-search, applied to the
  // ROLLED-UP PARENT (the E-2 rollup unit). All conditions AND together and compose with the
  // active date window (applied separately in browseDonors). Firewall: an 'uncategorized'
  // industry selection matches a parent with no real industry, so unclassified stays
  // filterable, never silently dropped.
  function donorMatches(donor, name, f) {
    if (!f) return true;
    if (f.type && f.type !== 'All' && (donor.type || 'Other') !== f.type) return false;
    if (f.industry && f.industry !== 'All') {
      var inds = donor.industries || [];
      var real = inds.filter(function (x) { return x && x !== 'unclassified' && x !== 'uncategorized'; });
      if (f.industry === 'uncategorized') { if (real.length) return false; }
      else if (inds.indexOf(f.industry) < 0) return false;
    }
    if (f.flag && f.flag !== 'All') {
      var ft = (donor.flags || []).map(function (x) { return (x && x.type) || x; });
      if (ft.indexOf(f.flag) < 0) return false;
    }
    if (f.search && String(name || '').toLowerCase().indexOf(String(f.search).toLowerCase()) < 0) return false;
    return true;
  }

  // Stable filter option lists (window/filter-independent): every type/industry/flag present
  // on a parent with giving, so dropdowns never offer empty buckets. Labels prefer the curated
  // industry_tags / flag_types (fall back to the raw tag, prettified by the render layer).
  // 'uncategorized' is always offered for industry when any parent lacks a real industry.
  function browseDonorFacets(index) {
    var types = {}, inds = {}, flags = {}, anyUncat = false;
    for (var pid in index.parentRollup) {
      if (!index.parentRollup.hasOwnProperty(pid)) continue;
      var d = index.donors[pid] || {};
      if (d.type) types[d.type] = 1;
      var di = (d.industries || []).filter(function (x) { return x && x !== 'unclassified' && x !== 'uncategorized'; });
      if (di.length) { for (var i = 0; i < di.length; i++) inds[di[i]] = 1; } else anyUncat = true;
      var fl = d.flags || [];
      for (var j = 0; j < fl.length; j++) { var t = (fl[j] && fl[j].type) || fl[j]; if (t) flags[t] = 1; }
    }
    // Industry facets also include in-scope IE-committee tags: an IE-only industry (e.g.
    // charter-schools) is carried by no donor, so without this the E-6 chart could drill into
    // it but the industry dropdown couldn't reflect the selection. (E-6 facet completeness.)
    for (var iek in index.iesBySpender) {
      if (!index.iesBySpender.hasOwnProperty(iek)) continue;
      var its = (index.committees[iek] || {}).industry_tags || [];
      for (var t2 = 0; t2 < its.length; t2++) if (its[t2]) inds[its[t2]] = 1;
    }
    var indL = function (k) { return (index.industryTags[k] && index.industryTags[k].label) || null; };
    var flagL = function (k) { return (index.flagTypes[k] && index.flagTypes[k].label) || null; };
    var indOpts = Object.keys(inds).sort().map(function (k) { return { id: k, label: indL(k) }; });
    if (anyUncat) indOpts.push({ id: 'uncategorized', label: 'Uncategorized' });
    return {
      types: Object.keys(types).sort(),
      industries: indOpts,
      flags: Object.keys(flags).sort().map(function (k) { return { id: k, label: flagL(k) }; })
    };
  }

  function browseDonors(index, cycle, win, filters) {
    var f = filters || {};
    var keep = function (cyc) { return !EXCLUDED_CYCLES[cyc] && (cycle == null || cyc === cycle); };
    var rows = [];
    for (var pid in index.parentRollup) {
      if (!index.parentRollup.hasOwnProperty(pid)) continue;
      var d = index.donors[pid] || {};
      if (!donorMatches(d, d.name || pid, f)) continue;     // E-1 donor filters (parent unit)
      var pr = index.parentRollup[pid], total = 0, cmset = {}, entset = {}, ncontrib = 0;
      for (var i = 0; i < pr.rows.length; i++) {
        var c = pr.rows[i];
        if (c.contribution_type === DUES_TYPE) continue;
        if (!keep(c.cycle)) continue;
        if (win && !inWindow(c.date, win)) continue;
        if (!recipInScope(index, c.committee_id)) continue;
        total += c.amount || 0; ncontrib++;
        if (c.committee_id) cmset[c.committee_id] = 1;
        if (c.donor_id) entset[c.donor_id] = 1;
      }
      if (total > 0) {
        rows.push({ kind: 'donor', parent_id: pid, name: d.name || pid,
          industries: d.industries || [], flags: d.flags || [], total: round2(total),
          entities: Object.keys(entset).length, committees: Object.keys(cmset).length, contributions: ncontrib });
      }
    }
    var q = (f.search || '').toLowerCase();
    for (var key in index.iesBySpender) {           // already office-scoped
      if (!index.iesBySpender.hasOwnProperty(key)) continue;
      if (f.type && f.type !== 'All' && f.type !== 'PAC') continue;     // IE PACs are PAC-like only
      if (f.flag && f.flag !== 'All') continue;                        // IE committees carry no donor flags
      var cm = index.committees[key] || {}, itags = cm.industry_tags || [];
      if (f.industry && f.industry !== 'All') {
        if (f.industry === 'uncategorized') { if (itags.length) continue; }
        else if (itags.indexOf(f.industry) < 0) continue;
      }
      var inm = cm.committee_name || key;
      if (q && String(inm).toLowerCase().indexOf(q) < 0) continue;
      var spend = 0, rws = index.iesBySpender[key];
      for (var j = 0; j < rws.length; j++) { if (!keep(rws[j].cycle)) continue; if (win && !inWindow(rws[j].date, win)) continue; spend += rws[j].amount || 0; }
      if (spend <= 0) continue;
      rows.push({ kind: 'ie', committee_id: key, name: inm,
        identity: spenderFunders(index, key).funders.slice(0, 3).map(function (fn) { return fn.name; }), total: round2(spend) });
    }
    rows.sort(function (a, b) { return b.total - a.total; });
    return rows;
  }

  // 2) Spend by candidate — keyed on the CANDIDATE (target_candidate_id), NOT the
  // committee join, so a name-matched candidate with no committee still shows their
  // IE total. Three figures kept separate. Neutral (alphabetical) order.
  // HALT-P1-B AGGREGATE SCOPE GUARD (ratified, Option A / nav-visible-election-scoped):
  // the office-scoped ANALYTICAL views (spend-by-candidate, the industry/flag cross-tabs,
  // self-funding) report the CURRENT election only. The 2024 school-board backfill stays
  // browsable as its own race pages — raceIsLive/officeRaces keep it NAV-VISIBLE — but is
  // excluded from these 2026 aggregates, so populating it (P1-B) does not leak 2024 money
  // into the 2026 spend/industry/self totals. Before P1-B the 2024 races were empty, so
  // this leak was latent; gate_bundle 74/0 with the guard IS the dormancy proof (the 2026
  // aggregates are byte-identical to pre-P1-B). SATISFACTION CONDITION: removing this guard
  // is part of P1-D's cycle-parity work (ledger cross-ref; paired with the ingest_ie IE
  // scope-guard whose removal opens P1-E — two guards, two arc-stages).
  var AGG_EXCLUDED_ELECTIONS = { '2024-school-board': 1 };
  function inAggScope(race) { return !race || !AGG_EXCLUDED_ELECTIONS[race.election_id]; }

  function spendByCandidate(index, office, cycle, win) {
    var offs = OFFICE_RACE_OFFICES[office] || [], out = [];
    for (var i = 0; i < index.candidates.length; i++) {
      var c = index.candidates[i], race = index.raceById[c.race_id] || {};
      if (offs.indexOf(race.office) < 0 || !inAggScope(race)) continue;
      if (c.vacating_for) continue;                  // vacating incumbents listed in their new race
      var f = candidateFigures(index, c.id, cycle, win);  // works for committee-less candidates (direct 0)
      if (!(f.contributions.total > 0 || f.independentSupport > 0 || f.independentOpposition > 0)) continue;
      out.push({ id: c.id, slug: candidateSlug(c, race), name: c.name,
        race: race.label, raceSlug: raceSlug(race), hasCommittee: !!c.committee_id, figures: f });
    }
    out.sort(byNameNeutral);
    return out;
  }

  // E-7 grouped spend-by-candidate: the FULL roster (candidatesByRace), grouped by race,
  // scoped to the office. Section order: President first, then districts ascending by the NN
  // in sb-dNN (NOT a string sort). Within a race, candidates rank by contributions.total
  // (direct raised — a SINGLE legitimate stream; support/oppose stay separate, never fused).
  // No money drop-guard: empty races and $0 / committee-less candidates are included so the
  // render can label them honestly. Optional raceFilter ('all' | race_id) AND-composes with win.
  function raceOrderKey(r) {
    if (r.office === 'school_board_president' || r.id === 'sb-president') return -1;
    var m = /(\d+)/.exec(r.id || '');
    return m ? parseInt(m[1], 10) : 9999;
  }
  // X-2: expandedId (threaded from view state) names the ONE candidate whose row is
  // expanded to its inline funder card. Only that candidate gets the heavy detail
  // (candidateContributors + candidateIE x2 + committeeMeta) — the exact functions raceView
  // calls; everyone else stays figures-only. groupScale (per-group Math.max, raceView's
  // formula) is attached so the inline card's bars fill against the candidate's own race.
  function spendByCandidateGrouped(index, office, cycle, win, raceFilter, expandedId) {
    var offs = OFFICE_RACE_OFFICES[office] || [];
    var scoped = (index.races || []).filter(function (r) { return offs.indexOf(r.office) >= 0 && raceIsLive(index, r) && inAggScope(r); });
    scoped.sort(function (a, b) { return raceOrderKey(a) - raceOrderKey(b); });
    var groups = scoped
      .filter(function (r) { return !raceFilter || raceFilter === 'all' || r.id === raceFilter; })
      .map(function (r) {
        var cands = (index.candidatesByRace[r.id] || [])
          .filter(function (c) { return !c.vacating_for; })
          .map(function (c) {
            var entry = { id: c.id, name: c.name, incumbent: !!c.incumbent, hasCommittee: !!c.committee_id,
              figures: candidateFigures(index, c.id, cycle, win) };
            // Lazy enrichment: ONLY the expanded candidate gets the five fields card reads.
            if (expandedId && c.id === expandedId && c.committee_id) {
              entry.slug = candidateSlug(c, r);
              entry.committee = committeeMeta(index, c.id);
              entry.contributors = candidateContributors(index, c.id, cycle, win);
              entry.ieSupportDetail = candidateIE(index, c.id, 'support', cycle, win);
              entry.ieOpposeDetail = candidateIE(index, c.id, 'oppose', cycle, win);
            }
            return entry;
          });
        cands.sort(function (a, b) { return b.figures.contributions.total - a.figures.contributions.total; });
        // Per-group scale = race-wide max across these candidates' figures (raceView's formula,
        // render.js:833-837). Drives the inline card's bar fill so a 2026 row is comparable
        // within its own race, not against a global maximum.
        var groupScale = 1;
        for (var s = 0; s < cands.length; s++) {
          var gf = cands[s].figures; if (!gf) continue;
          groupScale = Math.max(groupScale, gf.contributions.total, gf.independentSupport, gf.independentOpposition);
        }
        return { race: { id: r.id, label: r.label, office: r.office }, candidates: cands, scale: groupScale };
      });
    return { groups: groups, raceOptions: scoped.map(function (r) { return { id: r.id, label: r.label }; }) };
  }

  // Shared cycle-aware aggregation for the industry/flag cross-tabs (re-derived
  // from the office-scoped per-candidate index by cycle; null cycle = all-time).
  function spendAgg(index, office, cycle, win) {
    var offs = OFFICE_RACE_OFFICES[office] || [];
    var keep = function (cyc) { return !EXCLUDED_CYCLES[cyc] && (cycle == null || cyc === cycle); };
    var byCand = {}, flags = {};
    function ind(map, key, tag) {
      var m = map[key] || (map[key] = {});
      return m[tag] || (m[tag] = { direct: 0, support: 0, oppose: 0 });
    }
    for (var i = 0; i < index.candidates.length; i++) {
      var cand = index.candidates[i], race = index.raceById[cand.race_id] || {};
      if (offs.indexOf(race.office) < 0 || cand.vacating_for || !inAggScope(race)) continue;
      var cid = cand.id;
      var dr = index.directByCandidate[cid] || [];
      for (var d = 0; d < dr.length; d++) {
        var c = dr[d]; if (c.contribution_type === DUES_TYPE || !keep(c.cycle)) continue;
        if (win && !inWindow(c.date, win)) continue;
        var donor = index.donors[c.donor_id] || {}, amt = c.amount || 0;
        var inds = (donor.industries && donor.industries.length) ? donor.industries : ['uncategorized'];
        for (var a = 0; a < inds.length; a++) ind(byCand, cid, inds[a]).direct = round2(ind(byCand, cid, inds[a]).direct + amt);
        var fl = donor.flags || [];
        for (var g = 0; g < fl.length; g++) {
          var ft = (fl[g] && fl[g].type) || fl[g]; if (!ft) continue;
          var fa = flags[ft] || (flags[ft] = { amount: 0, count: 0 }); fa.amount = round2(fa.amount + amt); fa.count++;
        }
      }
      var ieB = index.ieByCandidate[cid] || { support: [], oppose: [] };
      ['support', 'oppose'].forEach(function (field) {
        ieB[field].forEach(function (ie) {
          if (!keep(ie.cycle)) return;
          if (win && !inWindow(ie.date, win)) return;
          var sp = index.committees[ie.spender_committee_id] || {}, tags = sp.industry_tags || [], amt2 = ie.amount || 0;
          for (var t = 0; t < tags.length; t++) ind(byCand, cid, tags[t])[field] = round2(ind(byCand, cid, tags[t])[field] + amt2);
        });
      });
    }
    return { byCand: byCand, flags: flags };
  }

  // 3) Industry totals — office-scoped, cycle-aware (sum the cross-tab).
  function industryTotals(index, office, cycle, win) {
    var byCand = spendAgg(index, office, cycle, win).byCand, tot = {};
    for (var cid in byCand) {
      var inds = byCand[cid];
      for (var tag in inds) {
        var a = tot[tag] || (tot[tag] = { industry: tag, direct: 0, support: 0, oppose: 0 });
        a.direct = round2(a.direct + inds[tag].direct); a.support = round2(a.support + inds[tag].support);
        a.oppose = round2(a.oppose + inds[tag].oppose);
      }
    }
    var list = []; for (var t in tot) { var x = tot[t]; x.total = round2(x.direct + x.support + x.oppose); list.push(x); }
    list.sort(function (a, b) { return b.total - a.total; });
    return list;
  }

  // 4) Industries by candidate — per in-office candidate, their industry breakdown.
  function industriesByCandidate(index, office, cycle, win) {
    var byCand = spendAgg(index, office, cycle, win).byCand, cands = spendByCandidate(index, office, cycle, win), out = [];
    for (var i = 0; i < cands.length; i++) {
      var inds = byCand[cands[i].id]; if (!inds) continue;
      var arr = [];
      for (var tag in inds) arr.push({ industry: tag, direct: inds[tag].direct, support: inds[tag].support,
        oppose: inds[tag].oppose, total: round2(inds[tag].direct + inds[tag].support + inds[tag].oppose) });
      arr.sort(function (a, b) { return b.total - a.total; });
      if (arr.length) out.push({ name: cands[i].name, slug: cands[i].slug, race: cands[i].race, industries: arr });
    }
    return out;  // neutral order (spendByCandidate is alphabetical)
  }

  // 5) Flag totals — office-scoped, cycle-aware aggregation.
  function flagTotals(index, office, cycle, win) {
    var flags = spendAgg(index, office, cycle, win).flags, list = [];
    for (var ft in flags) list.push({ flag: ft, amount: flags[ft].amount, count: flags[ft].count });
    list.sort(function (a, b) { return b.amount - a.amount; });
    return list;
  }

  // Dispatcher: one call from the thin app for the active subtab. Cycle-aware AND
  // election-window-aware: `election` is 'all' (default = union of both windows),
  // '2026' (This) or '2024' (Last). The resolved window drives every figure + the
  // drill-downs (the spend container carries it so spender modals stay scoped).
  function spendSubtab(index, office, tab, cycle, election, filters, raceFilter, expandedId) {
    var sel = election || 'all', win = spendWin(office, sel), filter = spendElectionFilter(office, sel);
    if (tab === 'candidates') {
      var rf = raceFilter || 'all', g = spendByCandidateGrouped(index, office, cycle, win, rf, expandedId);
      return { tab: tab, election: sel, filter: filter, win: win, groups: g.groups, raceOptions: g.raceOptions, raceFilter: rf };
    }
    if (tab === 'industries') return { tab: tab, election: sel, filter: filter, win: win, industries: industryTotals(index, office, cycle, win) };
    if (tab === 'industry-candidate') return { tab: tab, election: sel, filter: filter, win: win, rows: industriesByCandidate(index, office, cycle, win) };
    if (tab === 'flags') return { tab: tab, election: sel, filter: filter, win: win, flags: flagTotals(index, office, cycle, win) };
    var df = filters || { search: '', type: 'All', industry: 'All', flag: 'All' };
    var browse = browseDonors(index, cycle, win, df), ieCount = 0;
    for (var bi = 0; bi < browse.length; bi++) if (browse[bi].kind === 'ie') ieCount++;
    return { tab: 'donors', election: sel, filter: filter, win: win, rows: browse,
             donorFilters: df, facets: browseDonorFacets(index), ieCount: ieCount,
             industryTags: index.industryTags };   // default
  }

  return {
    OFFICE_RACE_OFFICES: OFFICE_RACE_OFFICES,
    OFFICE_GROUPS: OFFICE_GROUPS,
    EXCLUDED_CYCLES: EXCLUDED_CYCLES,
    loadData: loadData,
    candidateFigures: candidateFigures,
    candidateContributors: candidateContributors,
    candidateIE: candidateIE,
    spenderFunders: spenderFunders,
    donorFootprint: donorFootprint,
    committeeProfile: committeeProfile,
    committeeMeta: committeeMeta,
    sunshineUrl: sunshineUrl,
    availableCycles: availableCycles,
    browseDonors: browseDonors, spendByCandidate: spendByCandidate,
    industryTotals: industryTotals, industriesByCandidate: industriesByCandidate,
    flagTotals: flagTotals, spendSubtab: spendSubtab,
    isSelfFunded: isSelfFunded,
    kebab: kebab, raceSlug: raceSlug, candidateSlug: candidateSlug, raceCode: raceCode,
    raceElections: raceElections,
    viewModels: { raceBrowse: raceBrowse, raceView: raceView, officeRaces: officeRaces, raceElections: raceElections }
  };
});
