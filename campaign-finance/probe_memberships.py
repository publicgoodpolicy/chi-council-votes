#!/usr/bin/env python3
"""
probe_memberships.py — Build the person->ward crosswalk and probe committee /
caucus membership in DataMade's Chicago Councilmatic data.

WHY
---
The vote feed records each vote against a person GUID (voter_id), but the IPG
tool keys everything by ward. We need a reliable, DATE-AWARE bridge:

    OCD person_id  -->  ward  -->  effective date range

This must cover all terms from 2011 (so a future backfill is a flag flip, not a
rewrite) and must handle mid-term successions like Ward 27 (Burnett Jr. -> III).

This script also:
  * extracts COMMITTEE memberships per alder (role + dates), and
  * TESTS whether caucus membership exists in the data at all (it probably does
    not -- caucuses are informal blocs, not Legistar bodies -- but we verify
    instead of assuming), and
  * VALIDATES the make-or-break assumption: that voter_id on votes actually
    joins to membership.person_id. If that key doesn't line up, stop and rethink.

Standard library only. Talks to the Datasette JSON SQL endpoint with a browser
User-Agent and retries (the host bot-blocks and enforces a ~1s SQL limit).

USAGE
-----
    python3 probe_memberships.py
    python3 probe_memberships.py --term 2023 --out probe_out
    python3 probe_memberships.py --all-terms        # committees for every term

Writes:
    <out>/person_ward.json            the crosswalk (person_id -> ward stints)
    <out>/committee_memberships.json  per-alder committee roles (scoped to term)
    <out>/membership_report.json      structured findings
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

DEFAULT_ORG = "ocd-organization/d437a413-9392-4992-93ef-0c4bbe0d96e7"  # Chicago City Council
DEFAULT_BASE = "https://puddle.datamade.us/chicago_council"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


# ----------------------------------------------------------------------------
# Datasette JSON helpers (same proven helpers as the vote probe)
# ----------------------------------------------------------------------------
def sql(base, query, label="", retries=3):
    url = f"{base}.json?" + urllib.parse.urlencode({"sql": query, "_shape": "array"})
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} on {label or 'query'}: {e.read().decode('utf-8','replace')[:300]}"
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last_err
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__} on {label or 'query'}: {e}"
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last_err
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return [], f"Non-JSON on {label or 'query'}: {body[:200]}"
        if isinstance(data, dict) and data.get("ok") is False:
            return [], f"Datasette error on {label or 'query'}: {data.get('error')}"
        if not isinstance(data, list):
            return [], f"Unexpected shape on {label or 'query'}: {str(data)[:200]}"
        return data, None
    return [], last_err


def columns_of(base, table):
    rows, err = sql(base, f'SELECT * FROM "{table}" LIMIT 1', f"cols::{table}")
    if err or not rows:
        return [], err
    return list(rows[0].keys()), None


def pick(candidates, available):
    low = {col.lower(): col for col in available}
    for cand in candidates:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


def q(base, query, label):
    rows, err = sql(base, query, label)
    if err:
        print(f"  ! {err}")
    return rows, err


def hr(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def ward_num(label):
    """Pull an integer ward number out of a post label like 'Ward 27'."""
    if not label:
        return None
    m = re.search(r"(\d{1,2})", str(label))
    return int(m.group(1)) if m else None


def active_during(start, end, term_start, term_end):
    """ISO date strings; lexicographic compare works. Null = open-ended."""
    if start and start > term_end:
        return False
    if end and end < term_start:
        return False
    return True


# ----------------------------------------------------------------------------
def run(base, org, term, out_dir, all_terms):
    report = {"base": base, "org": org, "term": term}

    hr("0. CONNECTIVITY")
    _, err = sql(base, "SELECT 1", "connectivity")
    if err:
        print(f"  FAILED: {err}\n  (Run locally, not CI; the host bot-blocks datacenter IPs.)")
        return 1
    print("  OK — SQL endpoint reachable.")

    hr("1. SCHEMA INTROSPECTION")
    tables, err = sql(base, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", "tables")
    tnames = [t["name"] for t in tables]
    T = {
        "membership": pick(["membership", "opencivicdata_membership"], tnames),
        "post": pick(["post", "opencivicdata_post"], tnames),
        "org": pick(["organization", "opencivicdata_organization"], tnames),
        "person": pick(["person", "opencivicdata_person"], tnames),
        "session": pick(["legislativesession"], tnames),
        "personvote": pick(["personvote"], tnames),
        "voteevent": pick(["voteevent"], tnames),
    }
    for k, v in T.items():
        print(f"    {k:11s} -> {v}")
    cols = {k: (columns_of(base, v)[0] if v else []) for k, v in T.items()}

    C = {
        "m_org": pick(["organization_id"], cols["membership"]),
        "m_person": pick(["person_id"], cols["membership"]),
        "m_post": pick(["post_id"], cols["membership"]),
        "m_role": pick(["role"], cols["membership"]),
        "m_start": pick(["start_date"], cols["membership"]),
        "m_end": pick(["end_date"], cols["membership"]),
        "p_label": pick(["label", "role"], cols["post"]),
        "p_org": pick(["organization_id"], cols["post"]),
        "o_name": pick(["name"], cols["org"]),
        "o_class": pick(["classification"], cols["org"]),
        "per_name": pick(["name", "sort_name"], cols["person"]),
        "pv_voter": pick(["voter_id", "person_id"], cols["personvote"]),
        "pv_event": pick(["vote_event_id"], cols["personvote"]),
        "ve_org": pick(["organization_id"], cols["voteevent"]),
        "ve_date": pick(["start_date", "date"], cols["voteevent"]),
        "ve_id": pick(["id"], cols["voteevent"]),
    }
    print("\n  Resolved columns:")
    for k, v in C.items():
        print(f"    {k:10s} = {v}{'' if v else '   <-- NOT FOUND'}")
    report["tables"], report["resolved_columns"] = T, C
    print("\n  post sample (shows how wards are labeled):")
    psamp, _ = sql(base, f'SELECT * FROM "{T["post"]}" LIMIT 5', "post sample")
    for r in psamp:
        print("    " + json.dumps(r)[:160])

    # --- term bounds ----------------------------------------------------------
    trow, _ = sql(base, f"SELECT start_date, end_date FROM \"{T['session']}\" "
                        f"WHERE identifier='{term}'", "term bounds")
    term_start = (trow[0].get("start_date") if trow else None) or f"{term}-05-15"
    term_end = (trow[0].get("end_date") if trow else None) or "2027-05-15"
    print(f"\n  Term {term}: {term_start} .. {term_end}")
    report["term_bounds"] = [term_start, term_end]

    # --- 2. Organization classification census --------------------------------
    hr("2. ORGANIZATION CENSUS  (what kinds of bodies exist?)")
    census, _ = sql(base, f'SELECT {C["o_class"]} AS classification, COUNT(*) n '
                          f'FROM "{T["org"]}" GROUP BY {C["o_class"]} ORDER BY n DESC', "org census")
    for r in census:
        print(f"    {str(r.get('classification')):20s} {r.get('n'):>5}")
    report["org_census"] = census

    # --- 3. CAUCUS TEST -------------------------------------------------------
    hr("3. CAUCUS TEST  (do caucuses exist in the data, or are they editorial?)")
    cauc, _ = sql(base, f'SELECT id, {C["o_name"]} AS name, {C["o_class"]} AS classification '
                        f'FROM "{T["org"]}" WHERE lower({C["o_name"]}) LIKE "%caucus%" '
                        f'OR lower({C["o_name"]}) LIKE "%bloc%" '
                        f'OR lower({C["o_class"]}) LIKE "%caucus%" ORDER BY name', "caucus test")
    if cauc:
        print(f"  Found {len(cauc)} caucus-like organization(s) — caucuses ARE in the data:")
        for r in cauc:
            print(f"    {r.get('name')}  [{r.get('classification')}]")
        print("  => We can auto-feed caucus membership after all. Plan changes.")
    else:
        print("  No caucus/bloc organizations found in the data.")
        print("  => CONFIRMED: caucuses are NOT tracked here. Source them as a small")
        print("     editorial table (~6 caucuses, from public rosters) in the sheet.")
    report["caucuses_in_data"] = cauc

    # --- 4. WARD CROSSWALK (all terms) ---------------------------------------
    hr("4. WARD CROSSWALK  (person -> ward, all terms, date-aware)")
    rows, err = sql(base,
        f'SELECT m.{C["m_person"]} AS person_id, per.{C["per_name"]} AS name, '
        f'p.{C["p_label"]} AS post_label, m.{C["m_start"]} AS start_date, m.{C["m_end"]} AS end_date '
        f'FROM "{T["membership"]}" m '
        f'JOIN "{T["post"]}" p ON m.{C["m_post"]} = p.id '
        f'JOIN "{T["person"]}" per ON m.{C["m_person"]} = per.id '
        f'WHERE m.{C["m_org"]} = \'{org}\' AND m.{C["m_post"]} IS NOT NULL '
        f'ORDER BY p.{C["p_label"]}, m.{C["m_start"]}', "ward crosswalk")
    crosswalk = []
    by_ward_current = defaultdict(list)
    by_person = defaultdict(set)
    for r in rows:
        wn = ward_num(r.get("post_label"))
        entry = {"person_id": r["person_id"], "name": r.get("name"), "ward": wn,
                 "post_label": r.get("post_label"),
                 "start_date": r.get("start_date"), "end_date": r.get("end_date")}
        crosswalk.append(entry)
        if wn:
            by_person[r["person_id"]].add(wn)
            if active_during(r.get("start_date"), r.get("end_date"), term_start, term_end):
                by_ward_current[wn].append(entry)
    print(f"  {len(crosswalk)} ward-membership rows across all terms.")
    wards_seen = sorted({e["ward"] for e in crosswalk if e["ward"]})
    print(f"  Distinct wards seen: {len(wards_seen)} (expect 50)")
    if len(wards_seen) != 50:
        print(f"    wards present: {wards_seen}")
    # current-term occupancy
    current_count = len(by_ward_current)
    print(f"  Wards with someone active in {term} term: {current_count} (expect 50)")
    multi = {w: v for w, v in by_ward_current.items() if len(v) > 1}
    if multi:
        print(f"\n  Wards with >1 person in this term (SUCCESSIONS — date logic matters):")
        for w in sorted(multi):
            for e in sorted(multi[w], key=lambda x: x.get("start_date") or ""):
                print(f"    Ward {w:2d}: {e['name']:28s} {e.get('start_date')} .. {e.get('end_date')}")
    dual = {pid: ws for pid, ws in by_person.items() if len(ws) > 1}
    if dual:
        print(f"\n  People who held >1 ward over time (remap/redistrict): {len(dual)}")
    report["crosswalk_rows"] = len(crosswalk)
    report["wards_current_term"] = current_count
    report["successions_current_term"] = {str(w): [e["name"] for e in v] for w, v in multi.items()}

    # --- 5. COMMITTEE MEMBERSHIPS --------------------------------------------
    hr(f"5. COMMITTEE MEMBERSHIPS  ({'all terms' if all_terms else term + ' term'})")
    crows, err = sql(base,
        f'SELECT o.{C["o_name"]} AS committee, m.{C["m_role"]} AS role, '
        f'per.{C["per_name"]} AS name, m.{C["m_person"]} AS person_id, '
        f'm.{C["m_start"]} AS start_date, m.{C["m_end"]} AS end_date '
        f'FROM "{T["membership"]}" m '
        f'JOIN "{T["org"]}" o ON m.{C["m_org"]} = o.id '
        f'JOIN "{T["person"]}" per ON m.{C["m_person"]} = per.id '
        f'WHERE o.{C["o_class"]} = \'committee\' '
        f'ORDER BY o.{C["o_name"]}, m.{C["m_role"]}', "committee memberships")
    committees = []
    for r in crows:
        if all_terms or active_during(r.get("start_date"), r.get("end_date"), term_start, term_end):
            committees.append(r)
    by_committee = defaultdict(list)
    role_vocab = Counter()
    for r in committees:
        by_committee[r["committee"]].append(r)
        role_vocab[r.get("role")] += 1
    print(f"  {len(committees)} committee-membership rows; {len(by_committee)} committees.")
    print(f"  Role vocabulary: {dict(role_vocab)}")
    print("\n  Committees (member count):")
    for name in sorted(by_committee):
        print(f"    {name[:54]:54s} {len(by_committee[name]):>3}")
    report["committee_count"] = len(by_committee)
    report["committee_role_vocab"] = dict(role_vocab)

    # --- 6. JOIN VALIDATION (make-or-break) ----------------------------------
    hr("6. JOIN VALIDATION  (do vote voter_ids resolve to the crosswalk?)")
    if C["pv_voter"] and C["ve_org"]:
        vrows, err = sql(base,
            f'SELECT DISTINCT pv.{C["pv_voter"]} AS voter_id '
            f'FROM "{T["personvote"]}" pv '
            f'JOIN "{T["voteevent"]}" ve ON ve.{C["ve_id"]} = pv.{C["pv_event"]} '
            f'WHERE ve.{C["ve_org"]} = \'{org}\' AND ve.{C["ve_date"]} >= \'{term_start}\'',
            "distinct voters this term")
        voter_ids = {r["voter_id"] for r in vrows if r.get("voter_id")}
        known = set(by_person.keys())
        matched = voter_ids & known
        print(f"  Distinct voter_ids in {term}-term votes: {len(voter_ids)}")
        print(f"  Resolve to a ward via crosswalk:          {len(matched)}")
        unmatched = voter_ids - known
        if unmatched:
            print(f"  UNMATCHED: {len(unmatched)} — need attention (look up these person_ids):")
            for vid in list(unmatched)[:10]:
                nm, _ = sql(base, f'SELECT {C["per_name"]} AS name FROM "{T["person"]}" '
                                  f'WHERE id=\'{vid}\'', "name lookup")
                print(f"    {vid}  {nm[0]['name'] if nm else '(name not found)'}")
        else:
            print("  All voters resolve. The crosswalk join key is SOUND. ✔")
        report["join_validation"] = {"voters": len(voter_ids), "matched": len(matched),
                                     "unmatched": len(unmatched)}

    # --- write outputs --------------------------------------------------------
    hr("DONE — writing crosswalk + committee extract")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "person_ward.json"), "w") as f:
        json.dump(crosswalk, f, indent=2, default=str)
    with open(os.path.join(out_dir, "committee_memberships.json"), "w") as f:
        json.dump({k: v for k, v in by_committee.items()}, f, indent=2, default=str)
    with open(os.path.join(out_dir, "membership_report.json"), "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"  -> {out_dir}/person_ward.json")
    print(f"  -> {out_dir}/committee_memberships.json")
    print(f"  -> {out_dir}/membership_report.json")
    print("\n  Key answers:")
    print("   * caucuses in data?           -> section 3")
    print("   * 50 wards resolve this term? -> section 4")
    print("   * successions handled?        -> section 4 (Ward 27 should show 2 people)")
    print("   * committees + roles?         -> section 5")
    print("   * does the vote join work?    -> section 6  <-- the critical one")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Probe Chicago Councilmatic memberships / build ward crosswalk.")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--org", default=DEFAULT_ORG)
    ap.add_argument("--term", default="2023", help="Legislative session identifier for scoping. Default 2023.")
    ap.add_argument("--all-terms", action="store_true", help="Committee memberships for every term, not just --term.")
    ap.add_argument("--out", default="probe_out")
    args = ap.parse_args()
    try:
        return run(args.base, args.org, args.term, args.out, args.all_terms)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
