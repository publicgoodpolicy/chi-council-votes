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
      { label: 'Board President', offices: ['school_board_president'] },
      { label: 'Districts', offices: ['school_board_member'] }
    ],
    city_council: [{ label: 'Wards', offices: ['alderperson'] }],
    mayor: [{ label: 'Mayor', offices: ['mayor'] }]
  };

  // Cycles never shown (out of SBE range / unattributable). Always excluded.
  var EXCLUDED_CYCLES = { 'pre-2011': 1, 'undated': 1 };
  var DUES_TYPE = 'IE Committee Dues Transfer';

  // ---- stable, URL-safe slugs (locked scheme: e.g. "bruce-leon-district-2a") ----
  // Pure + deterministic so the browser app and the future SEO pre-render derive
  // identical paths from the same data.
  function kebab(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function raceSlug(race) {
    if (race.district) return kebab(race.district);              // "District 2A" -> "district-2a"
    if (race.ward) return 'ward-' + race.ward;                   // ward "23"      -> "ward-23"
    return kebab({ school_board_president: 'school-board-president', mayor: 'mayor',
                   city_clerk: 'city-clerk', city_treasurer: 'city-treasurer' }[race.office] || race.office);
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

    return {
      races: races, candidates: candidates, committees: committees, donors: donors,
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

  function sumIE(list, cycle) {
    var s = 0, n = 0;
    for (var i = 0; i < list.length; i++) {
      var ie = list[i];
      if (EXCLUDED_CYCLES[ie.cycle]) continue;
      if (cycle != null && ie.cycle !== cycle) continue;
      s += ie.amount || 0; n++;
    }
    return { amount: s, count: n };
  }

  // The three money figures, kept SEPARATE — never summed into one number.
  // cycle = null -> all-time (all non-excluded cycles); else a specific cycle code.
  function candidateFigures(index, candidateId, cycle) {
    var direct = index.directByCandidate[candidateId] || [];
    var total = 0, self = 0, count = 0;
    for (var i = 0; i < direct.length; i++) {
      var c = direct[i];
      if (EXCLUDED_CYCLES[c.cycle]) continue;
      if (c.contribution_type === DUES_TYPE) continue;
      if (cycle != null && c.cycle !== cycle) continue;
      var a = c.amount || 0;
      total += a; count++;
      if (isSelfFunded(index.donors, c)) self += a;
    }
    var ieB = index.ieByCandidate[candidateId] || { support: [], oppose: [] };
    var sup = sumIE(ieB.support, cycle), opp = sumIE(ieB.oppose, cycle);
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
  function candidateContributors(index, candidateId, cycle) {
    var rows = index.directByCandidate[candidateId] || [];
    var by = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (EXCLUDED_CYCLES[c.cycle]) continue;
      if (c.contribution_type === DUES_TYPE) continue;
      if (cycle != null && c.cycle !== cycle) continue;
      var donor = index.donors[c.donor_id] || {};
      var pid = donor.parent_id || c.donor_id;
      var parent = index.donors[pid] || donor;
      var m = by[pid] || (by[pid] = { parent_id: pid, name: parent.name || pid,
        industries: parent.industries || [], flags: parent.flags || [],
        total: 0, count: 0, isSelf: false, isAggregate: false });
      m.total = round2(m.total + (c.amount || 0)); m.count++;
      if (c.is_loan || c.contribution_type === 'Loan Received' || parent.type === 'Candidate' ||
          (parent.industries || []).indexOf('self-funding') >= 0) m.isSelf = true;
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
  function donorFootprint(index, parentId) {
    var parent = index.donors[parentId] || { id: parentId, name: parentId };
    var pr = index.parentRollup[parentId];
    var rows = (pr && pr.rows) || [];
    var by = {};
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (c.contribution_type === DUES_TYPE) continue;
      var cid = c.committee_id, cm = index.committees[cid] || {};
      // office scope: an IE committee that didn't spend in this office is out of
      // scope (e.g. a council-only IE PAC must not appear in a school-board view).
      if (cm.type === 'independent_expenditure' && index.office && !index.inScopeIE[cid]) continue;
      var m = by[cid];
      if (!m) {
        m = by[cid] = { committee_id: cid, total: 0, count: 0, kind: 'other', label: cm.committee_name || cid };
        if (cm.candidate_id) {
          var cand = index.candidateById[cm.candidate_id] || {}, race = index.raceById[cand.race_id] || {};
          m.kind = 'candidate'; m.label = (cand.name || cm.candidate_id) + (race.label ? (' — ' + race.label) : '');
        } else if (cm.type === 'independent_expenditure') {
          m.kind = 'ie'; m.label = cm.committee_name || cid;
          m.ieIdentity = spenderFunders(index, cid).funders.slice(0, 3).map(function (x) { return x.name; });
        }
      }
      m.total = round2(m.total + (c.amount || 0)); m.count++;
    }
    var committees = []; for (var k in by) if (by.hasOwnProperty(k)) committees.push(by[k]);
    committees.sort(function (a, b) { return b.total - a.total; });
    var total = 0; for (var j = 0; j < committees.length; j++) total += committees[j].total;
    return {
      parent_id: parentId, name: parent.name || parentId,
      industries: parent.industries || [], flags: parent.flags || [],
      committees: committees, total: round2(total), count: committees.length
    };
  }

  // Committee profile (bidirectional with the donor footprint). For an IE
  // committee: what it spent in support vs opposition, by candidate, + who funds
  // it (second hop). For a candidate committee: what it raised + its contributors.
  // funders/contributors are donorRow-compatible lines (clickable back to a
  // footprint) — one modal system, two content types.
  function committeeProfile(index, committeeKey) {
    var cm = index.committees[committeeKey] || {};
    var sun = sunshineUrl(cm);
    if (cm.type === 'independent_expenditure') {
      // group this committee's IEs by target candidate
      var byCand = {}, support = 0, oppose = 0;
      var src = index.iesBySpender[committeeKey] || [];
      for (var i = 0; i < src.length; i++) {
        var ie = src[i];
        if (EXCLUDED_CYCLES[ie.cycle]) continue;
        var tc = ie.target_candidate_id || ('race:' + ie.target_race_id);
        var cand = index.candidateById[ie.target_candidate_id] || {};
        var race = index.raceById[cand.race_id || ie.target_race_id] || {};
        var m = byCand[tc] || (byCand[tc] = { candidate_id: ie.target_candidate_id || null,
          name: cand.name || ('race ' + ie.target_race_id), raceLabel: race.label || null, support: 0, oppose: 0, total: 0, count: 0 });
        var a = ie.amount || 0;
        if (ie.stance === 'oppose') { m.oppose = round2(m.oppose + a); oppose = round2(oppose + a); }
        else { m.support = round2(m.support + a); support = round2(support + a); }
        m.total = round2(m.total + a); m.count++;
      }
      var targets = []; for (var k in byCand) if (byCand.hasOwnProperty(k)) targets.push(byCand[k]);
      targets.sort(function (a, b) { return b.total - a.total; });
      var ff = spenderFunders(index, committeeKey);
      return {
        committee_id: committeeKey, kind: 'ie', name: cm.committee_name || committeeKey,
        sunshineUrl: sun, isIE: true, identity: ff.funders.slice(0, 3).map(function (x) { return x.name; }),
        support: round2(support), oppose: round2(oppose), total: round2(support + oppose), targets: targets,
        funders: ff.funders, funderTotal: ff.total, funderCount: ff.count
      };
    }
    // candidate (or other) committee — show what it raised + its contributors
    var candId = cm.candidate_id || null;
    var cand2 = candId ? (index.candidateById[candId] || {}) : {};
    var race2 = cand2.race_id ? (index.raceById[cand2.race_id] || {}) : {};
    var contrib = candId ? candidateContributors(index, candId, null) : { lines: [], total: 0, count: 0 };
    return {
      committee_id: committeeKey, kind: 'candidate', name: cm.committee_name || committeeKey,
      candidateName: cand2.name || null, raceLabel: race2.label || null, sunshineUrl: sun, isIE: false,
      raised: contrib.total, funders: contrib.lines, funderTotal: contrib.total, funderCount: contrib.count
    };
  }

  // IE drill-down for one candidate + stance: the spender committee(s), each with
  // its second-hop top funders. Spender names are placeholders, so the funders
  // are the identity ("funded primarily by ...").
  function candidateIE(index, candidateId, stance, cycle) {
    var ieB = index.ieByCandidate[candidateId] || { support: [], oppose: [] };
    var list = stance === 'oppose' ? ieB.oppose : ieB.support;
    var by = {};
    for (var i = 0; i < list.length; i++) {
      var ie = list[i];
      if (EXCLUDED_CYCLES[ie.cycle]) continue;
      if (cycle != null && ie.cycle !== cycle) continue;
      var sk = ie.spender_committee_id;
      var m = by[sk] || (by[sk] = { spender_committee_id: sk, amount: 0, count: 0 });
      m.amount = round2(m.amount + (ie.amount || 0)); m.count++;
    }
    var spenders = [];
    for (var key in by) {
      if (!by.hasOwnProperty(key)) continue;
      var s = by[key], cm = index.committees[key] || {};
      var ff = spenderFunders(index, key);
      s.committeeName = cm.committee_name || key;
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
      candidates: active.map(function (c) {
        var hasFinance = !!c.committee_id;
        return {
          id: c.id, slug: candidateSlug(c, race), name: c.name,
          incumbent: !!c.incumbent, status: c.status,
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
  function officeRaces(index, office) {
    var groups = OFFICE_GROUPS[office] || [];
    return {
      office: office,
      groups: groups.map(function (g) {
        var rs = index.races.filter(function (r) { return g.offices.indexOf(r.office) >= 0; }).sort(byRaceOrder);
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
    var races = index.races.filter(function (r) { return offices.indexOf(r.office) >= 0; }).sort(byRaceOrder);
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
  function browseDonors(index) {
    var rows = [];
    for (var pid in index.parentRollup) {
      if (!index.parentRollup.hasOwnProperty(pid)) continue;
      var pr = index.parentRollup[pid], total = 0;
      for (var i = 0; i < pr.rows.length; i++) {
        var c = pr.rows[i];
        if (c.contribution_type === DUES_TYPE) continue;
        if (!recipInScope(index, c.committee_id)) continue;
        total += c.amount || 0;
      }
      if (total > 0) {
        var d = index.donors[pid] || {};
        rows.push({ kind: 'donor', parent_id: pid, name: d.name || pid,
          industries: d.industries || [], flags: d.flags || [], total: round2(total) });
      }
    }
    for (var key in index.iesBySpender) {           // already office-scoped
      if (!index.iesBySpender.hasOwnProperty(key)) continue;
      var cm = index.committees[key] || {}, spend = 0, rws = index.iesBySpender[key];
      for (var j = 0; j < rws.length; j++) spend += rws[j].amount || 0;
      rows.push({ kind: 'ie', committee_id: key, name: cm.committee_name || key,
        identity: spenderFunders(index, key).funders.slice(0, 3).map(function (f) { return f.name; }), total: round2(spend) });
    }
    rows.sort(function (a, b) { return b.total - a.total; });
    return rows;
  }

  // 2) Spend by candidate — keyed on the CANDIDATE (target_candidate_id), NOT the
  // committee join, so a name-matched candidate with no committee still shows their
  // IE total. Three figures kept separate. Neutral (alphabetical) order.
  function spendByCandidate(index, office) {
    var offs = OFFICE_RACE_OFFICES[office] || [], out = [];
    for (var i = 0; i < index.candidates.length; i++) {
      var c = index.candidates[i], race = index.raceById[c.race_id] || {};
      if (offs.indexOf(race.office) < 0) continue;
      if (c.vacating_for) continue;                  // vacating incumbents listed in their new race
      var f = candidateFigures(index, c.id, null);   // works for committee-less candidates (direct 0)
      if (!(f.contributions.total > 0 || f.independentSupport > 0 || f.independentOpposition > 0)) continue;
      out.push({ id: c.id, slug: candidateSlug(c, race), name: c.name,
        race: race.label, raceSlug: raceSlug(race), hasCommittee: !!c.committee_id, figures: f });
    }
    out.sort(byNameNeutral);
    return out;
  }

  // 3) Industry totals — sum the client-side industry×candidate cross-tab.
  function industryTotals(index) {
    var agg = {};
    for (var cand in index.industryByCandidate) {
      if (!index.industryByCandidate.hasOwnProperty(cand)) continue;
      var ind = index.industryByCandidate[cand];
      for (var tag in ind) {
        if (!ind.hasOwnProperty(tag)) continue;
        var a = agg[tag] || (agg[tag] = { industry: tag, direct: 0, support: 0, oppose: 0 });
        a.direct = round2(a.direct + ind[tag].direct); a.support = round2(a.support + ind[tag].support);
        a.oppose = round2(a.oppose + ind[tag].oppose);
      }
    }
    var list = []; for (var t in agg) { var x = agg[t]; x.total = round2(x.direct + x.support + x.oppose); list.push(x); }
    list.sort(function (a, b) { return b.total - a.total; });
    return list;
  }

  // 4) Industries by candidate — per in-office candidate, their industry breakdown.
  function industriesByCandidate(index, office) {
    var cands = spendByCandidate(index, office), out = [];
    for (var i = 0; i < cands.length; i++) {
      var ind = index.industryByCandidate[cands[i].id]; if (!ind) continue;
      var inds = [];
      for (var tag in ind) {
        if (!ind.hasOwnProperty(tag)) continue;
        inds.push({ industry: tag, direct: ind[tag].direct, support: ind[tag].support, oppose: ind[tag].oppose,
          total: round2(ind[tag].direct + ind[tag].support + ind[tag].oppose) });
      }
      inds.sort(function (a, b) { return b.total - a.total; });
      if (inds.length) out.push({ name: cands[i].name, slug: cands[i].slug, race: cands[i].race, industries: inds });
    }
    return out;  // already neutral order (spendByCandidate is alphabetical)
  }

  // 5) Flag totals — aggregate the client-side flag×candidate derivation.
  function flagTotals(index) {
    var agg = {};
    for (var cand in index.flagByCandidate) {
      if (!index.flagByCandidate.hasOwnProperty(cand)) continue;
      var fl = index.flagByCandidate[cand];
      for (var ft in fl) {
        if (!fl.hasOwnProperty(ft)) continue;
        var a = agg[ft] || (agg[ft] = { flag: ft, amount: 0, count: 0 });
        a.amount = round2(a.amount + fl[ft].amount); a.count += fl[ft].count;
      }
    }
    var list = []; for (var f in agg) list.push(agg[f]); list.sort(function (a, b) { return b.amount - a.amount; });
    return list;
  }

  // Dispatcher: one call from the thin app for the active subtab.
  function spendSubtab(index, office, tab) {
    if (tab === 'candidates') return { tab: tab, candidates: spendByCandidate(index, office) };
    if (tab === 'industries') return { tab: tab, industries: industryTotals(index) };
    if (tab === 'industry-candidate') return { tab: tab, rows: industriesByCandidate(index, office) };
    if (tab === 'flags') return { tab: tab, flags: flagTotals(index) };
    return { tab: 'donors', rows: browseDonors(index) };   // default
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
    viewModels: { raceBrowse: raceBrowse, raceView: raceView, officeRaces: officeRaces }
  };
});
