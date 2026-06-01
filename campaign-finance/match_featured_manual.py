#!/usr/bin/env python3
"""
match_featured_manual.py — Find the stragglers that title-keyword search can't.

WHY A SECOND TOOL
-----------------
Chicago bill titles use municipal-code language, not policy nicknames. The 1FW
Repeal vote's title is "Amendment of Municipal Code Section 6-105-030 entitling
employers of occupations where gratuities are customary..." — it shares zero
words with "One Fair Wage" or "tipped wage," so title search never finds it.
This tool searches the way these actually need to be searched:

    /text          free text in the bill TITLE        (same as before)
    #IDENT         by bill identifier  (e.g. #SO2025-0017549)   <-- the key one
    @YYYY-MM-DD    divided votes on/near that date (+/- 10 days)
    @LO..HI        divided votes in a date range
    ocd-vote/...   paste a known OCD vote id directly to confirm it
    <number>       confirm a listed candidate
    s / q          skip / save-and-quit

It LOADS your existing featured_vote_map.json (the 4 already confirmed),
works only the still-unmatched featured votes, and writes the merged map back.

USAGE
-----
    python3 match_featured_manual.py --data ./council-data.json
    python3 match_featured_manual.py --only "1FW Repeal,Ceasefire"

KNOWN LEAD (from the earlier vote probe):
    1FW Repeal  ->  #SO2025-0017549   (2026-03-18, 30-18 divided)
                    verify direction vs. your reverse-coding before locking.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import OrderedDict
from datetime import date, timedelta

DEFAULT_ORG = "ocd-organization/d437a413-9392-4992-93ef-0c4bbe0d96e7"
DEFAULT_BASE = "https://puddle.datamade.us/chicago_council"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def sql(base, query, label="", retries=3):
    url = f"{base}.json?" + urllib.parse.urlencode({"sql": query, "_shape": "array"})
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code} on {label}: {e.read().decode('utf-8','replace')[:200]}"
            if e.code in (502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last_err
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__} on {label}: {e}"
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last_err
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return [], f"Non-JSON on {label}: {body[:160]}"
        if isinstance(data, dict) and data.get("ok") is False:
            return [], f"Datasette error on {label}: {data.get('error')}"
        return (data if isinstance(data, list) else []), None
    return [], last_err


def esc(s):
    return str(s).replace("'", "''")


def tally(base, vote_id):
    rows, _ = sql(base, f"SELECT option, value FROM votecount WHERE vote_event_id='{esc(vote_id)}'", "tally")
    return {r["option"]: r["value"] for r in rows} if rows else {}


def is_divided(t):
    return (t.get("no") or 0) > 0 or (t.get("abstain") or 0) > 0


def load_featured(data_path):
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    vm = data.get("votemeta") or data.get("votes") or []
    out = OrderedDict()
    for v in vm:
        if v.get("code"):
            out[v["code"]] = {"code": v["code"],
                              "full": v.get("full") or v.get("full_name") or v.get("name") or v["code"],
                              "desc": v.get("desc") or v.get("description") or "",
                              "year": v.get("year"), "tag": v.get("tag")}
    return out


# --------------------------------------------------------------------------
# Search modes
# --------------------------------------------------------------------------
def by_title(base, org, text):
    return sql(base,
        f"SELECT b.identifier AS bill, b.title AS title, ve.id AS vote_id, "
        f"ve.start_date AS date, ve.result AS result "
        f"FROM bill b JOIN voteevent ve ON ve.bill_id=b.id "
        f"WHERE ve.organization_id='{esc(org)}' AND lower(b.title) LIKE '%{esc(text).lower()}%' "
        f"ORDER BY ve.start_date DESC LIMIT 25", "by_title")[0]


def by_identifier(base, org, ident):
    return sql(base,
        f"SELECT b.identifier AS bill, b.title AS title, ve.id AS vote_id, "
        f"ve.start_date AS date, ve.result AS result "
        f"FROM bill b JOIN voteevent ve ON ve.bill_id=b.id "
        f"WHERE ve.organization_id='{esc(org)}' AND upper(b.identifier) LIKE '%{esc(ident).upper()}%' "
        f"ORDER BY ve.start_date DESC LIMIT 25", "by_identifier")[0]


def by_date(base, org, lo, hi):
    return sql(base,
        f"SELECT b.identifier AS bill, b.title AS title, ve.id AS vote_id, "
        f"ve.start_date AS date, ve.result AS result "
        f"FROM bill b JOIN voteevent ve ON ve.bill_id=b.id "
        f"WHERE ve.organization_id='{esc(org)}' AND ve.start_date BETWEEN '{lo}' AND '{hi}' "
        f"AND ve.id IN (SELECT vote_event_id FROM personvote WHERE option IN ('no','abstain')) "
        f"ORDER BY ve.start_date LIMIT 40", "by_date")[0]


def by_id(base, vote_id):
    return sql(base,
        f"SELECT b.identifier AS bill, b.title AS title, ve.id AS vote_id, "
        f"ve.start_date AS date, ve.result AS result "
        f"FROM voteevent ve LEFT JOIN bill b ON ve.bill_id=b.id "
        f"WHERE ve.id='{esc(vote_id)}' LIMIT 1", "by_id")[0]


def parse_date_cmd(arg):
    arg = arg.strip()
    if ".." in arg:
        lo, hi = arg.split("..", 1)
        return lo.strip(), hi.strip()
    try:
        d = date.fromisoformat(arg)
        return str(d - timedelta(days=10)), str(d + timedelta(days=10))
    except ValueError:
        return None, None


def show(cands):
    if not cands:
        print("    (no results)")
        return
    for i, c in enumerate(cands, 1):
        t = tally_cache(c)
        tstr = ", ".join(f"{k}:{v}" for k, v in t.items()) or "(no tally)"
        div = "DIVIDED" if is_divided(t) else "unanimous/none"
        print(f"    [{i}] {c.get('date','?')}  {c.get('bill','')}  ({div})")
        print(f"        {str(c.get('title',''))[:92]}")
        print(f"        tally: {tstr}")


_TC = {}
def tally_cache(c, base=None):
    """Lazy tally fetch, cached per vote_id. base set once via set_base()."""
    vid = c.get("vote_id")
    if vid not in _TC:
        _TC[vid] = tally(_TC["__base__"], vid)
    return _TC[vid]


def confirm(vote, c, how):
    t = tally_cache(c)
    if not is_divided(t):
        print("    NOTE: not a divided roll call — positions likely all 'yes'/absent.")
    return {"vote_id": c["vote_id"], "bill": c.get("bill"), "title": c.get("title"),
            "date": c.get("date"), "result": c.get("result"), "tally": t,
            "divided": is_divided(t), "confirmed": "editor", "matched_on": how}


def work_one(base, org, vote):
    print("\n" + "-" * 72)
    print(f"  FEATURED: [{vote['code']}] {vote['full']}"
          + (f"   ({vote['year']}, {vote['tag']})" if vote.get('year') else ""))
    if vote.get("desc"):
        print(f"    {vote['desc'][:110]}")
    print("    search: /title  #IDENT  @YYYY-MM-DD  @LO..HI  | paste ocd-vote/..  | s skip  q quit")
    cands, how = [], "manual"
    while True:
        choice = input("    > ").strip()
        if choice == "q":
            return "QUIT", None
        if choice == "s" or choice == "":
            return None, None
        if choice.startswith("/"):
            cands = by_title(base, org, choice[1:].strip()); how = "title"; show(cands); continue
        if choice.startswith("#"):
            cands = by_identifier(base, org, choice[1:].strip()); how = "identifier"; show(cands); continue
        if choice.startswith("@"):
            lo, hi = parse_date_cmd(choice[1:])
            if not lo:
                print("    (bad date — use @2024-01-31 or @2024-01-01..2024-02-15)"); continue
            cands = by_date(base, org, lo, hi); how = "date"; show(cands); continue
        if choice.startswith("ocd-vote/"):
            rows = by_id(base, choice)
            if not rows:
                print("    (no vote with that id)"); continue
            cands = rows; how = "direct-id"; show(cands)
            return confirm(vote, cands[0], how), None
        if choice.isdigit() and 1 <= int(choice) <= len(cands):
            return confirm(vote, cands[int(choice) - 1], how), None
        print("    (unrecognized — /title  #IDENT  @date  ocd-vote/..  number  s  q)")


def run(data_path, base, org, map_path, out_dir, only):
    if not os.path.exists(data_path):
        print(f"  Could not find {data_path}. Pass --data path/to/council-data.json")
        return 1
    _TC["__base__"] = base
    featured = load_featured(data_path)

    existing = {}
    if os.path.exists(map_path):
        with open(map_path, encoding="utf-8") as f:
            existing = json.load(f)
        print(f"  Loaded {len(existing)} already-confirmed matches from {map_path}")

    if only:
        targets = [featured[c] for c in only if c in featured]
        missing = [c for c in only if c not in featured]
        if missing:
            print(f"  (these --only codes aren't in votemeta: {missing})")
    else:
        targets = [v for code, v in featured.items() if code not in existing]
    if not targets:
        print("  Nothing left to match — every featured vote is in the map.")
        return 0
    print(f"  Working {len(targets)} unmatched featured vote(s): "
          + ", ".join(v["code"] for v in targets))

    _, err = sql(base, "SELECT 1", "connectivity")
    if err:
        print(f"  Cannot reach data: {err}\n  (Run locally, not CI.)"); return 1

    merged = OrderedDict(existing)
    for vote in targets:
        result, _ = work_one(base, org, vote)
        if result == "QUIT":
            break
        if result:
            merged[vote["code"]] = result
            print(f"    confirmed {vote['code']} -> {result['bill']} ({result['date']})")

    os.makedirs(out_dir, exist_ok=True)
    with open(map_path, "w") as f:
        json.dump(merged, f, indent=2, default=str)

    print("\n" + "=" * 72 + "\nSUMMARY\n" + "=" * 72)
    print(f"  Featured votes now mapped: {len(merged)} / {len(featured)}")
    for code, m in merged.items():
        flag = "" if m.get("divided") else "   (not divided)"
        print(f"    {code:18s} -> {m.get('bill')}  {m.get('date')}{flag}")
    still = [c for c in featured if c not in merged]
    if still:
        print(f"  Still hand-entered: {', '.join(still)}")
    print(f"\n  -> {map_path} (updated)")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Manual featured-vote matcher (identifier/date/direct-id).")
    ap.add_argument("--data", default="./council-data.json")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--org", default=DEFAULT_ORG)
    ap.add_argument("--map", default="probe_out/featured_vote_map.json",
                    help="Existing map to extend (from match_featured.py).")
    ap.add_argument("--out", default="probe_out")
    ap.add_argument("--only", default="", help="Comma-separated featured codes to work (default: all unmatched).")
    args = ap.parse_args()
    only = [c.strip() for c in args.only.split(",") if c.strip()]
    try:
        return run(args.data, args.base, args.org, args.map, args.out, only)
    except KeyboardInterrupt:
        print("\n  Interrupted — nothing written."); return 130


if __name__ == "__main__":
    sys.exit(main())
