#!/usr/bin/env python3
"""
probe_votes.py — Reconnaissance on DataMade's Chicago Councilmatic vote data.

PURPOSE
-------
Before we design a vote-ingestion pipeline for the IPG Council Accountability
Tool, we need to know what's actually in DataMade's data and how good it is.
This script answers, against live data:

  1. Is the host reachable, and which nightly snapshot are we hitting?
  2. What legislative sessions exist, and does the current (2023-2027) term
     show up?
  3. Is the Chicago City Council org id we expect correct?
  4. How many vote events exist per session?
  5. COVERAGE: of those vote events, how many actually carry per-alder votes
     (the "divided roll calls") vs. how many are bare outcome records?
  6. What's the vocabulary of vote options (yes / no / present / absent / ...)?
     -- this is what we'll map onto Affirmative / Oppositional / Neutral.
  7. SANITY: how many members are recorded per divided vote? (~50 = full roll
     call; far fewer may mean partial/committee votes.)
  8. eLMS TRANSITION: per-year counts of votes-with-members, so we can see the
     data discontinuity around the City Clerk's mid-2023 system change.
  9. SAMPLES: a handful of recent divided votes with each alder's option, so we
     can eyeball quality.

It also dumps the raw table/column schema so we are never guessing about field
names when we write the real sync.

DESIGN NOTES
------------
* Standard library only (urllib, json) -- no pip install needed, so this runs
  unchanged locally or in a GitHub Action.
* Talks to the Datasette JSON SQL endpoint. Read-only SQL, capped at 1000 rows
  by Datasette, which is fine for aggregates; samples use LIMIT.
* Sends a browser User-Agent (the host bot-blocks default agents).
* Defensive: it introspects table/column names and adapts, because the exact
  OCD export schema can drift. Each query is best-effort and reports failures
  instead of crashing.

USAGE
-----
    python3 probe_votes.py
    python3 probe_votes.py --session 2023 --out probe_out
    python3 probe_votes.py --base https://puddle.datamade.us/chicago_council-21e06af

Writes a human-readable report to stdout and saves:
    <out>/probe_report.json   structured findings
    <out>/sample_votes.json   full per-alder samples for eyeballing
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

# Verified Chicago City Council org id (confirmed by name lookup against the
# live DB, 2026). NOTE: DataMade's 2019 example used a different GUID
# (ef168607-...), which is now stale — OCD ids are regenerated on re-import, so
# never trust a hardcoded one without the name check in section 2.
DEFAULT_ORG = "ocd-organization/d437a413-9392-4992-93ef-0c4bbe0d96e7"
# Un-hashed alias; Datasette redirects it to the current nightly snapshot.
DEFAULT_BASE = "https://puddle.datamade.us/chicago_council"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


# ----------------------------------------------------------------------------
# Datasette JSON helpers
# ----------------------------------------------------------------------------
def sql(base, query, label="", retries=3):
    """Run read-only SQL against the Datasette JSON endpoint -> list[dict].

    Returns (rows, error). On success error is None; on failure rows is [].
    Datasette enforces a ~1s SQL time limit and returns 503 under load, so we
    retry transient failures (503/502/504/timeout) with backoff.
    """
    import time
    url = f"{base}.json?" + urllib.parse.urlencode({"sql": query, "_shape": "array"})
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            last_err = f"HTTP {e.code} on {label or 'query'}: {detail}"
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return [], last_err
        except Exception as e:  # noqa: BLE001 - probe should never hard-crash
            last_err = f"{type(e).__name__} on {label or 'query'}: {e}"
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            return [], last_err
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return [], f"Non-JSON response on {label or 'query'}: {body[:200]}"
        if isinstance(data, dict) and data.get("ok") is False:
            return [], f"Datasette error on {label or 'query'}: {data.get('error')}"
        if not isinstance(data, list):
            return [], f"Unexpected shape on {label or 'query'}: {str(data)[:200]}"
        return data, None
    return [], last_err


def first(base, query, label=""):
    rows, err = sql(base, query, label)
    if err:
        return None, err
    return (rows[0] if rows else None), None


# ----------------------------------------------------------------------------
# Schema introspection -- never trust remembered column names
# ----------------------------------------------------------------------------
def list_tables(base):
    rows, err = sql(base, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", "tables")
    if err:
        return [], err
    return [r["name"] for r in rows], None


def columns_of(base, table):
    """One-row sample -> column names (PRAGMA is often blocked on Datasette)."""
    rows, err = sql(base, f'SELECT * FROM "{table}" LIMIT 1', f"cols::{table}")
    if err or not rows:
        return [], err
    return list(rows[0].keys()), None


def pick(candidates, available):
    """First candidate present in `available` (case-insensitive), else None."""
    low = {c.lower(): c for c in available}
    for cand in candidates:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


def detect_schema(base, tables):
    """Resolve the real names of the tables/columns we depend on."""
    s = {"tables": tables}
    s["voteevent"] = pick(["voteevent", "opencivicdata_voteevent"], tables)
    s["personvote"] = pick(["personvote", "opencivicdata_personvote", "votecount_person", "votes"], tables)
    s["votecount"] = pick(["votecount", "opencivicdata_votecount"], tables)
    s["session"] = pick(["legislativesession", "opencivicdata_legislativesession"], tables)
    s["bill"] = pick(["bill", "opencivicdata_bill"], tables)
    s["org"] = pick(["organization", "opencivicdata_organization"], tables)

    # If personvote wasn't matched by name, find any table that has both an
    # option-like column and a vote_event reference.
    if not s["personvote"]:
        for t in tables:
            cols, _ = columns_of(base, t)
            low = [c.lower() for c in cols]
            if "option" in low and any("vote_event" in c for c in low):
                s["personvote"] = t
                break

    s["cols"] = {}
    for key in ("voteevent", "personvote", "votecount", "session", "bill"):
        t = s.get(key)
        if t:
            cols, _ = columns_of(base, t)
            s["cols"][key] = cols

    # Resolve specific columns we query on, with OCD defaults.
    ve = s["cols"].get("voteevent", [])
    pv = s["cols"].get("personvote", [])
    ls = s["cols"].get("session", [])
    s["c"] = {
        "ve_id": pick(["id"], ve),
        "ve_org": pick(["organization_id"], ve),
        "ve_session": pick(["legislative_session_id", "session_id"], ve),
        "ve_bill": pick(["bill_id"], ve),
        "ve_date": pick(["start_date", "date"], ve),
        "ve_motion": pick(["motion_text", "motion"], ve),
        "ve_result": pick(["result"], ve),
        "pv_event": pick(["vote_event_id", "voteevent_id"], pv),
        "pv_option": pick(["option"], pv),
        "pv_voter_name": pick(["voter_name", "name"], pv),
        "pv_voter_id": pick(["voter_id", "person_id"], pv),
        "ls_id": pick(["id"], ls),
        "ls_ident": pick(["identifier"], ls),
    }
    return s


# ----------------------------------------------------------------------------
# Report sections
# ----------------------------------------------------------------------------
def hr(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def run(base, org, target_session, out_dir, sample_limit):
    report = {"base": base, "org": org}

    hr("0. CONNECTIVITY")
    row, err = first(base, "SELECT 1 AS ok", "connectivity")
    if err:
        print("  FAILED to reach Datasette SQL endpoint.")
        print(f"  {err}")
        print("\n  Things to try:")
        print("   * Confirm the URL in a browser: " + base)
        print("   * If the alias 404s, pass the hashed URL via --base")
        print("     (e.g. https://puddle.datamade.us/chicago_council-21e06af)")
        print("   * If you see a bot/Cloudflare block, run from a residential")
        print("     IP or your CI runner rather than a flagged host.")
        report["connectivity"] = {"ok": False, "error": err}
        _dump(out_dir, report, None)
        return 1
    print("  OK — SQL endpoint reachable.")
    report["connectivity"] = {"ok": True}

    hr("1. SCHEMA INTROSPECTION")
    tables, err = list_tables(base)
    if err:
        print(f"  Could not list tables: {err}")
        report["schema_error"] = err
        _dump(out_dir, report, None)
        return 1
    print(f"  {len(tables)} tables present.")
    schema = detect_schema(base, tables)
    for key in ("voteevent", "personvote", "votecount", "session", "bill", "org"):
        print(f"    {key:11s} -> {schema.get(key)}")
    print("\n  Resolved columns we depend on:")
    for k, v in schema["c"].items():
        flag = "" if v else "   <-- NOT FOUND, queries using this will be skipped"
        print(f"    {k:16s} = {v}{flag}")
    report["schema"] = {k: schema[k] for k in ("voteevent", "personvote", "votecount", "session", "bill", "org")}
    report["columns"] = schema["cols"]
    report["resolved_columns"] = schema["c"]

    c = schema["c"]
    VE, PV, LS = schema["voteevent"], schema["personvote"], schema["session"]
    have_votes = VE and PV and c["ve_id"] and c["pv_event"] and c["ve_org"]
    if not have_votes:
        print("\n  Missing the core vote tables/columns — cannot probe coverage.")
        print("  Inspect the schema dump above and adjust the candidate lists.")
        _dump(out_dir, report, None)
        return 1

    # --- 2. Org verification --------------------------------------------------
    hr("2. ORG VERIFICATION")
    if schema["org"]:
        rows, err = sql(base, f'SELECT id, name FROM "{schema["org"]}" '
                              f"WHERE name LIKE '%Council%' ORDER BY name LIMIT 25", "orgs")
        if not err:
            for r in rows:
                mark = "  <== using this" if r.get("id") == org else ""
                print(f"    {r.get('id')}  |  {r.get('name')}{mark}")
            report["councils"] = rows
            if not any(r.get("id") == org for r in rows):
                print("\n  NOTE: the org id passed in didn't match a 'Council' org by name.")
                print("  If counts below are 0, re-run with the correct --org from the list above.")

    # --- 3 & 4. Sessions + votes per session ---------------------------------
    hr("3. LEGISLATIVE SESSIONS")
    if LS and c["ls_ident"]:
        scols = schema["cols"].get("session", [])
        sd = pick(["start_date"], scols)
        ed = pick(["end_date"], scols)
        sel = f'{c["ls_ident"]} AS identifier'
        if sd:
            sel += f", {sd} AS start_date"
        if ed:
            sel += f", {ed} AS end_date"
        rows, err = sql(base, f'SELECT {sel} FROM "{LS}" ORDER BY identifier', "sessions")
        if err:
            print(f"  {err}")
        else:
            for r in rows:
                print(f"    {r.get('identifier'):20s}  {r.get('start_date','')}  {r.get('end_date','')}")
            report["sessions"] = rows
            idents = [r.get("identifier") for r in rows]
            if not any(str(target_session) in str(i) for i in idents):
                print(f"\n  WARNING: requested session '{target_session}' not obviously present.")

    hr("4. DIVIDED VOTES PER SESSION — the real harvest")
    # The previous all-rows LEFT JOIN timed out (4.7M person-votes). Instead:
    #  (4a) total vote events per session  -> voteevent only, no big join.
    #  (4b) votes with >=1 no / dissent     -> filter personvote on option FIRST
    #       (only ~4.5K rows are no/abstain in all history), THEN join up. Cheap.
    if LS and c["ve_session"] and c["ls_id"]:
        q4a = f'''
            SELECT ls.{c["ls_ident"]} AS session, COUNT(*) AS total_votes
            FROM "{VE}" ve JOIN "{LS}" ls ON ve.{c["ve_session"]} = ls.{c["ls_id"]}
            WHERE ve.{c["ve_org"]} = '{org}'
            GROUP BY ls.{c["ls_ident"]} ORDER BY ls.{c["ls_ident"]}
        '''
        totals, err_a = sql(base, q4a, "totals per session")
        opt = c["pv_option"]
        q4b = f'''
            SELECT ls.{c["ls_ident"]} AS session,
                   COUNT(DISTINCT CASE WHEN pv.{opt}='no' THEN ve.{c["ve_id"]} END) AS with_a_no,
                   COUNT(DISTINCT ve.{c["ve_id"]}) AS with_dissent
            FROM "{PV}" pv
            JOIN "{VE}" ve ON ve.{c["ve_id"]} = pv.{c["pv_event"]}
            JOIN "{LS}" ls ON ve.{c["ve_session"]} = ls.{c["ls_id"]}
            WHERE ve.{c["ve_org"]} = '{org}' AND pv.{opt} IN ('no','abstain')
            GROUP BY ls.{c["ls_ident"]} ORDER BY ls.{c["ls_ident"]}
        '''
        divided, err_b = sql(base, q4b, "divided per session")
        if err_a:
            print(f"  totals: {err_a}")
        if err_b:
            print(f"  divided: {err_b}")
        if not err_a or not err_b:
            byses = {}
            for r in (totals or []):
                byses.setdefault(r["session"], {})["total"] = r.get("total_votes") or 0
            for r in (divided or []):
                d = byses.setdefault(r["session"], {})
                d["no"] = r.get("with_a_no") or 0
                d["dissent"] = r.get("with_dissent") or 0
            print(f"    {'session':10s} {'total':>9s} {'>=1 no':>8s} {'dissent':>8s}")
            for s in sorted(byses):
                d = byses[s]
                print(f"    {s:10s} {d.get('total',0):9d} {d.get('no',0):8d} {d.get('dissent',0):8d}")
            report["per_session"] = byses
            print("\n  total   = all recorded vote events (almost all have full roll calls).")
            print("  >=1 no  = at least one alder voted NO  <-- the curatable, contested set.")
            print("  dissent = at least one NO or ABSTAIN.")
            print("  The 2023 '>=1 no' figure is the size of the current-term harvest.")
    else:
        print("  Skipped — required session columns unavailable.")

    # --- 5. Option vocabulary -------------------------------------------------
    hr("5. VOTE OPTION VOCABULARY  (maps onto Affirmative/Oppositional/Neutral)")
    if c["pv_option"]:
        rows, err = sql(base, f'SELECT {c["pv_option"]} AS option, COUNT(*) AS n '
                              f'FROM "{PV}" GROUP BY {c["pv_option"]} ORDER BY n DESC', "options")
        if err:
            print(f"  {err}")
        else:
            for r in rows:
                print(f"    {str(r.get('option')):20s} {r.get('n'):>8}")
            report["options"] = rows

    # --- 6. Members-per-vote sanity ------------------------------------------
    hr("6. MEMBERS PER DIVIDED VOTE  (sanity — full roll call should be ~50)")
    rows, err = sql(base, f'SELECT n, COUNT(*) AS num_votes FROM '
                          f'(SELECT {c["pv_event"]} AS e, COUNT(*) AS n FROM "{PV}" '
                          f'GROUP BY {c["pv_event"]}) GROUP BY n ORDER BY n DESC LIMIT 60',
                    "members-per-vote")
    if err:
        print(f"  {err}")
    else:
        buckets = Counter()
        for r in rows:
            n = r.get("n") or 0
            band = "45-55 (full)" if 45 <= n <= 55 else (
                   "1-10 (partial?)" if n <= 10 else (
                   "11-44 (committee?)" if n < 45 else "56+ (?)"))
            buckets[band] += r.get("num_votes") or 0
        for band, num in buckets.most_common():
            print(f"    {band:22s} {num:>8} votes")
        report["members_per_vote_bands"] = dict(buckets)

    # --- 7. eLMS transition: coverage by year --------------------------------
    hr("7. eLMS TRANSITION PROBE — votes-with-alders by year")
    if c["ve_date"]:
        q = f'''
            SELECT substr(ve.{c["ve_date"]},1,4) AS yr,
                   COUNT(DISTINCT ve.{c["ve_id"]}) AS total,
                   COUNT(DISTINCT pv.{c["pv_event"]}) AS with_alders
            FROM "{VE}" ve
            LEFT JOIN "{PV}" pv ON pv.{c["pv_event"]} = ve.{c["ve_id"]}
            WHERE ve.{c["ve_org"]} = '{org}'
            GROUP BY yr ORDER BY yr
        '''
        rows, err = sql(base, q, "by-year")
        if err:
            print(f"  {err}")
        else:
            print(f"    {'year':6s} {'total':>8s} {'w/ alders':>10s}")
            for r in rows:
                print(f"    {str(r.get('yr')):6s} {r.get('total') or 0:8d} {r.get('with_alders') or 0:10d}")
            print("\n  ^ Watch 2023: the Clerk moved Legistar -> eLMS mid-year. A dip or")
            print("    gap in 'w/ alders' around 2023 is the discontinuity to plan around.")
            report["by_year"] = rows

    # --- 8. Samples for eyeballing -------------------------------------------
    hr(f"8. SAMPLE DIVIDED VOTES (most recent {sample_limit} with >=1 NO, per-alder options)")
    BILL = schema["bill"]
    bsel, bjoin = "", ""
    if BILL and c["ve_bill"]:
        bcols = schema["cols"].get("bill", [])
        bid = pick(["identifier"], bcols)
        btitle = pick(["title"], bcols)
        if bid:
            bsel = f", b.{bid} AS bill_identifier" + (f", b.{btitle} AS bill_title" if btitle else "")
            bjoin = f' LEFT JOIN "{BILL}" b ON ve.{c["ve_bill"]} = b.id'

    msel = f", ve.{c['ve_motion']} AS motion_text" if c["ve_motion"] else ""
    rsel = f", ve.{c['ve_result']} AS result" if c["ve_result"] else ""
    dsel = f", ve.{c['ve_date']} AS start_date" if c["ve_date"] else ""
    order = f"ORDER BY ve.{c['ve_date']} DESC" if c["ve_date"] else ""
    # Prefer votes with an actual NO; if somehow none, fall back to any dissent,
    # then to any full roll call, so the section is never silently empty.
    selectors = [
        ("votes with >=1 NO", f"SELECT {c['pv_event']} FROM \"{PV}\" WHERE {c['pv_option']}='no'"),
        ("votes with dissent", f"SELECT {c['pv_event']} FROM \"{PV}\" WHERE {c['pv_option']} IN ('no','abstain')"),
        ("any roll call", f"SELECT {c['pv_event']} FROM \"{PV}\" GROUP BY {c['pv_event']} HAVING COUNT(*) BETWEEN 5 AND 60"),
    ]
    samples, err = [], None
    for desc, sub in selectors:
        q = f'''
            SELECT ve.{c["ve_id"]} AS id{dsel}{msel}{rsel}{bsel}
            FROM "{VE}" ve{bjoin}
            WHERE ve.{c["ve_org"]} = '{org}'
              AND ve.{c["ve_id"]} IN ({sub})
            {order} LIMIT {sample_limit}
        '''
        samples, err = sql(base, q, "sample votes")
        if err or samples:
            if samples:
                print(f"  (showing: {desc})\n")
            break
    full_samples = []
    if err:
        print(f"  {err}")
    else:
        for s in samples:
            mt = (s.get("motion_text") or "").strip()
            bill = s.get("bill_identifier") or ""
            print(f"\n    [{s.get('start_date','?')}] {bill}  {s.get('result','')}")
            if mt:
                print(f"      motion: {mt[:90]}")
            if s.get("bill_title"):
                print(f"      title : {s['bill_title'][:90]}")
            # pull the per-alder options
            sel = []
            if c["pv_voter_name"]:
                sel.append(f'{c["pv_voter_name"]} AS voter')
            if c["pv_voter_id"]:
                sel.append(f'{c["pv_voter_id"]} AS voter_id')
            sel.append(f'{c["pv_option"]} AS option')
            prows, perr = sql(base, f'SELECT {", ".join(sel)} FROM "{PV}" '
                                    f'WHERE {c["pv_event"]} = \'{s["id"]}\' '
                                    f'ORDER BY {c["pv_voter_name"] or c["pv_option"]}', "sample members")
            if perr:
                print(f"      (could not load members: {perr})")
                prows = []
            tally = Counter(r.get("option") for r in prows)
            print(f"      tally : {dict(tally)}  ({len(prows)} members)")
            shown = ", ".join(f"{r.get('voter','?')}={r.get('option')}" for r in prows[:6])
            if shown:
                print(f"      sample: {shown}{' ...' if len(prows) > 6 else ''}")
            full_samples.append({"vote": s, "members": prows})
        report["sample_count"] = len(full_samples)

    # --- Wrap up --------------------------------------------------------------
    hr("DONE")
    print("  Structured findings + full samples written to disk.")
    print("  Key questions answered above:")
    print("   * current 2023-2027 session present?  -> section 3")
    print("   * how many usable (divided) votes?     -> section 4 ('w/ alders')")
    print("   * what option values to map?           -> section 5")
    print("   * data gap at the eLMS switch?         -> section 7")
    print("   * does the data look clean?            -> section 8 samples")
    _dump(out_dir, report, full_samples)
    return 0


def _dump(out_dir, report, samples):
    import os
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "probe_report.json"), "w") as f:
        json.dump(report, f, indent=2, default=str)
    if samples is not None:
        with open(os.path.join(out_dir, "sample_votes.json"), "w") as f:
            json.dump(samples, f, indent=2, default=str)
    print(f"\n  -> {out_dir}/probe_report.json")
    if samples is not None:
        print(f"  -> {out_dir}/sample_votes.json")


def main():
    ap = argparse.ArgumentParser(description="Probe DataMade Chicago Councilmatic vote data.")
    ap.add_argument("--base", default=DEFAULT_BASE,
                    help="Datasette DB base URL (alias or hashed). Default: %(default)s")
    ap.add_argument("--org", default=DEFAULT_ORG,
                    help="OCD organization id for Chicago City Council.")
    ap.add_argument("--session", default="2023",
                    help="Legislative session identifier to sanity-check for. Default: 2023")
    ap.add_argument("--out", default="probe_out", help="Output directory. Default: probe_out")
    ap.add_argument("--limit", type=int, default=12, help="How many sample votes to pull. Default: 12")
    args = ap.parse_args()
    try:
        return run(args.base, args.org, args.session, args.out, args.limit)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
