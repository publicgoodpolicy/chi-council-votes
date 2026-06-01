#!/usr/bin/env python3
"""
match_featured.py — Assisted, run-once matcher from IPG featured votes to the
OCD vote events in DataMade's Chicago Councilmatic data.

WHY THIS IS ASSISTED, NOT AUTOMATIC
-----------------------------------
Picking the wrong roll call for a marquee vote (BCH, ShotSpotter, ceasefire) is
exactly the kind of error that damages a tool's credibility. So this script
SEARCHES for candidate roll calls per featured vote and the editor CONFIRMS the
right one. After confirmation each featured vote is locked to a stable OCD id,
and `sync_votes.py` can auto-populate its 50 per-alder positions every night.

It also tells us something we don't yet know: which featured votes have NO
divided roll call at all (e.g. a resolution passed by voice). Those simply can't
be auto-populated and stay hand-entered — the script flags them explicitly.

WHAT IT READS / WRITES
----------------------
Reads your existing council-data.json (for the `votemeta` featured-vote list).
Writes:
    <out>/featured_vote_map.json        code -> {vote_id, bill, title, date, tally}
    <out>/featured_unmatched.json       featured votes with no confirmed match
    <out>/featured_candidates.json      (non-interactive fallback) candidates to review

USAGE
-----
    python3 match_featured.py --data path/to/council-data.json
    python3 match_featured.py --data ./campaign-finance/council-data.json --candidates 8

Interactive keys per featured vote:
    <number>   confirm that candidate
    /<text>    re-search with your own keyword (e.g. /transfer tax)
    s          skip (leave unmatched / hand-entered)
    q          save what's confirmed so far and quit
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

DEFAULT_ORG = "ocd-organization/d437a413-9392-4992-93ef-0c4bbe0d96e7"
DEFAULT_BASE = "https://puddle.datamade.us/chicago_council"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

STOP = set("""a an the of to for and or in on re regarding amendment amend ordinance order
resolution city chicago municipal code section sections chapter chapters title titles by
adding new various as substitute year fiscal regarding et al v vs case cited no number""".split())


# --------------------------------------------------------------------------
# Datasette helpers
# --------------------------------------------------------------------------
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
    """Escape single quotes for inline SQL literals."""
    return str(s).replace("'", "''")


# --------------------------------------------------------------------------
# Featured-vote loading + query derivation
# --------------------------------------------------------------------------
def load_featured(data_path):
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    vm = data.get("votemeta") or data.get("votes") or []
    out = []
    for v in vm:
        out.append({
            "code": v.get("code"),
            "full": v.get("full") or v.get("full_name") or v.get("name") or v.get("code"),
            "desc": v.get("desc") or v.get("description") or "",
            "year": v.get("year"),
            "tag": v.get("tag"),
        })
    return out, data


def keywords(vote):
    """Distinctive search tokens, most specific first. Phrase from the full name,
    then rare individual tokens from name+desc."""
    full = (vote.get("full") or "").strip()
    queries = []
    # 1) the most distinctive 1-2 word fragment of the full name
    name_tokens = [t for t in re.findall(r"[A-Za-z][A-Za-z\-]+", full) if t.lower() not in STOP]
    # proper-ish / long tokens are the best discriminators (ShotSpotter, Ceasefire, Gaza...)
    rare = sorted(set(name_tokens), key=lambda t: (-len(t)))[:3]
    for t in rare:
        if len(t) >= 5:
            queries.append(t)
    # 2) two-word phrase from the name (e.g. "Bring Chicago" -> better "Chicago Home")
    words = full.split()
    for i in range(len(words) - 1):
        pair = f"{words[i]} {words[i+1]}".strip()
        if len(pair) >= 7 and not all(w.lower() in STOP for w in pair.split()):
            queries.append(pair)
    # 3) tokens from the description as a fallback
    desc_tokens = [t for t in re.findall(r"[A-Za-z][A-Za-z\-]+", vote.get("desc") or "")
                   if t.lower() not in STOP and len(t) >= 6]
    for t in sorted(set(desc_tokens), key=lambda t: -len(t))[:3]:
        queries.append(t)
    # de-dup, preserve order
    seen, uniq = set(), []
    for query_str in queries:
        k = query_str.lower()
        if k not in seen:
            seen.add(k); uniq.append(query_str)
    return uniq or [full]


def search(base, org, term, date_lo, date_hi):
    like = f"%{esc(term).lower()}%"
    rows, err = sql(base,
        f"SELECT b.identifier AS bill, b.title AS title, ve.id AS vote_id, "
        f"ve.start_date AS date, ve.result AS result "
        f"FROM bill b JOIN voteevent ve ON ve.bill_id = b.id "
        f"WHERE ve.organization_id = '{esc(org)}' "
        f"AND lower(b.title) LIKE '{like}' "
        f"AND ve.start_date BETWEEN '{date_lo}' AND '{date_hi}' "
        f"ORDER BY ve.start_date DESC LIMIT 25", "search")
    return rows, err


def tally(base, vote_id):
    rows, _ = sql(base, f"SELECT option, value FROM votecount "
                        f"WHERE vote_event_id = '{esc(vote_id)}'", "tally")
    return {r["option"]: r["value"] for r in rows} if rows else {}


def is_divided(t):
    return (t.get("no") or 0) > 0 or (t.get("abstain") or 0) > 0


def rank(cands, vote):
    name_toks = {t.lower() for t in re.findall(r"[A-Za-z]+", vote.get("full") or "") if t.lower() not in STOP}
    yr = str(vote.get("year") or "")
    def score(c):
        s = 0
        if is_divided(c.get("_tally", {})):
            s += 5
        title_toks = {t.lower() for t in re.findall(r"[A-Za-z]+", c.get("title") or "")}
        s += len(name_toks & title_toks)
        if yr and str(c.get("date", "")).startswith(yr):
            s += 2
        return s
    return sorted(cands, key=score, reverse=True)


# --------------------------------------------------------------------------
def gather(base, org, vote, date_lo, date_hi, limit, extra_query=None):
    """Run the derived (or editor-supplied) queries, merge + tally + rank."""
    queries = [extra_query] if extra_query else keywords(vote)
    seen, cands = set(), []
    for query_str in queries:
        rows, err = search(base, org, query_str, date_lo, date_hi)
        if err:
            print(f"    (search '{query_str}': {err})")
            continue
        for r in rows:
            if r["vote_id"] in seen:
                continue
            seen.add(r["vote_id"])
            r["_tally"] = tally(base, r["vote_id"])
            r["_matched_query"] = query_str
            cands.append(r)
        if len(cands) >= limit * 2:
            break
    return rank(cands, vote)[:limit]


def show(vote, cands):
    print("\n" + "-" * 72)
    print(f"  FEATURED: [{vote['code']}] {vote['full']}"
          + (f"   ({vote['year']}, {vote['tag']})" if vote.get('year') else ""))
    if vote.get("desc"):
        print(f"    {vote['desc'][:100]}")
    if not cands:
        print("    No candidate roll calls found. Try /<keyword>, or 's' to skip.")
        return
    for i, c in enumerate(cands, 1):
        t = c.get("_tally", {})
        tstr = ", ".join(f"{k}:{v}" for k, v in t.items()) or "(no recorded tally)"
        div = "DIVIDED" if is_divided(t) else "unanimous/none"
        print(f"    [{i}] {c.get('date','?')}  {c.get('bill','')}  ({div})")
        print(f"        {str(c.get('title',''))[:90]}")
        print(f"        tally: {tstr}")


def confirm_loop(base, org, featured, date_lo, date_hi, limit):
    mapping, unmatched = OrderedDict(), []
    interactive = sys.stdin.isatty()
    fallback = {}
    for vote in featured:
        cands = gather(base, org, vote, date_lo, date_hi, limit)
        if not interactive:
            fallback[vote["code"]] = {"featured": vote, "candidates": cands}
            continue
        while True:
            show(vote, cands)
            choice = input("    pick #, /keyword, s=skip, q=quit > ").strip()
            if choice == "q":
                return mapping, unmatched, fallback, True
            if choice == "s" or choice == "":
                unmatched.append(vote["code"]); break
            if choice.startswith("/"):
                cands = gather(base, org, vote, date_lo, date_hi, limit, extra_query=choice[1:].strip())
                continue
            if choice.isdigit() and 1 <= int(choice) <= len(cands):
                c = cands[int(choice) - 1]
                mapping[vote["code"]] = {
                    "vote_id": c["vote_id"], "bill": c.get("bill"),
                    "title": c.get("title"), "date": c.get("date"),
                    "result": c.get("result"), "tally": c.get("_tally", {}),
                    "divided": is_divided(c.get("_tally", {})),
                    "confirmed": "editor",
                }
                if not is_divided(c.get("_tally", {})):
                    print("    NOTE: this roll call isn't divided — positions may all be 'yes'"
                          " or absent. It'll still auto-populate, just won't show a split.")
                break
            print("    (unrecognized — type a number, /keyword, s, or q)")
    return mapping, unmatched, fallback, False


# --------------------------------------------------------------------------
def run(data_path, base, org, out_dir, limit, date_lo, date_hi):
    if not os.path.exists(data_path):
        print(f"  Could not find {data_path}. Pass --data path/to/council-data.json")
        return 1
    featured, _ = load_featured(data_path)
    featured = [v for v in featured if v.get("code")]
    print(f"  Loaded {len(featured)} featured votes from {data_path}")
    print(f"  Searching {base} ({date_lo}..{date_hi})")

    _, err = sql(base, "SELECT 1", "connectivity")
    if err:
        print(f"  Cannot reach data: {err}\n  (Run locally, not CI.)")
        return 1

    mapping, unmatched, fallback, quit_early = confirm_loop(base, org, featured, date_lo, date_hi, limit)

    os.makedirs(out_dir, exist_ok=True)
    if not sys.stdin.isatty():
        with open(os.path.join(out_dir, "featured_candidates.json"), "w") as f:
            json.dump(fallback, f, indent=2, default=str)
        print("\n  Non-interactive shell detected — wrote candidates for review:")
        print(f"  -> {out_dir}/featured_candidates.json")
        print("  Re-run in an interactive terminal to confirm matches, or hand-edit")
        print("  featured_vote_map.json using the vote_id values from that file.")
        return 0

    with open(os.path.join(out_dir, "featured_vote_map.json"), "w") as f:
        json.dump(mapping, f, indent=2, default=str)
    with open(os.path.join(out_dir, "featured_unmatched.json"), "w") as f:
        json.dump(unmatched, f, indent=2, default=str)

    print("\n" + "=" * 72)
    print("SUMMARY")
    print("=" * 72)
    print(f"  Confirmed matches : {len(mapping)}")
    for code, m in mapping.items():
        flag = "" if m["divided"] else "   (not divided)"
        print(f"    {code:14s} -> {m['bill']}  {m['date']}{flag}")
    if unmatched:
        print(f"  Unmatched (stay hand-entered): {', '.join(unmatched)}")
    if quit_early:
        print("  (quit early — re-run to finish the rest)")
    print(f"\n  -> {out_dir}/featured_vote_map.json")
    print(f"  -> {out_dir}/featured_unmatched.json")
    print("\n  Next: sync_votes.py consumes featured_vote_map.json to auto-populate")
    print("  these votes' 50 per-alder positions on every nightly run.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Assisted one-time featured-vote -> OCD-id matcher.")
    ap.add_argument("--data", default="./council-data.json", help="Path to council-data.json")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--org", default=DEFAULT_ORG)
    ap.add_argument("--out", default="probe_out")
    ap.add_argument("--candidates", type=int, default=6, help="Candidates shown per featured vote.")
    ap.add_argument("--from", dest="date_lo", default="2011-05-18", help="Earliest vote date to search.")
    ap.add_argument("--to", dest="date_hi", default="2030-01-01", help="Latest vote date to search.")
    args = ap.parse_args()
    try:
        return run(args.data, args.base, args.org, args.out, args.candidates, args.date_lo, args.date_hi)
    except KeyboardInterrupt:
        print("\n  Interrupted — nothing written.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
