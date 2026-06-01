#!/usr/bin/env python3
"""
sync_votes.py — Nightly vote sync for the IPG Council Accountability Tool.

Pulls Chicago City Council roll-call data from DataMade's Councilmatic Datasette
and merges it into council-data.json, WITHOUT touching anything editorial.

WHAT IT WRITES (machine-owned):
  * council-data.json -> "rollcall"            Tier 2: every divided vote this
                                                term, positions keyed by ward.
  * council-data.json -> alders[ward].votes[C] Tier 1: auto-populated positions
                                                for each featured vote in the map.
  * council-data.json -> "council_committees"  committee memberships (held, no UI).
  * council-data.json -> "_sync"               provenance / what the machine owns.

WHAT IT NEVER TOUCHES (editor-owned, "editor wins"):
  * donors, contributions, campaign-finance "committees", cycles, tags, flags
  * votemeta DEFINITIONS (full/tag/desc/reverse_coded/source_url)
  * alder bios; positions for featured votes NOT in the map (hand-entered)
  * "caucuses" (sourced from caucuses.json editorial table)

KEY CORRECTNESS RULES:
  * Tier 1 positions are SEMANTIC (Affirmative = support for the named action),
    so reverse-coded votes are FLIPPED per votemeta.reverse_coded. This matches
    the existing tool convention that lets positions be compared across votes.
  * Tier 2 positions are FACTUAL (yes/no/present/absent) with NO semantic
    judgment — these 167 votes are not editorially framed.
  * Votes attribute by ward via the live person_id->ward crosswalk. A ward's
    record can span more than one alder over a term (e.g. a mid-term
    succession); that's intended — it's the WARD's voting history.

Standard library only. Reliable against Datasette's ~1s SQL limit by keeping
every query small (batched), with retries.

USAGE
  python3 sync_votes.py --data ./council-data.json --map ./featured_vote_map.json
  python3 sync_votes.py --dry-run        # report only, write nothing
  python3 sync_votes.py --term 2023      # default current term
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict, Counter
from datetime import datetime

DEFAULT_ORG = "ocd-organization/d437a413-9392-4992-93ef-0c4bbe0d96e7"
DEFAULT_BASE = "https://puddle.datamade.us/chicago_council"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BATCH = 15  # vote_ids per personvote query; 15*~50 rows stays under Datasette's 1000-row cap

# option -> factual record value (Tier 2)
RECORD = {"yes": "yes", "no": "no", "abstain": "present", "not voting": "present",
          "absent": "absent", "excused": "absent"}
# option -> semantic position (Tier 1), normal coding
POSITION = {"yes": "Affirmative", "no": "Oppositional", "abstain": "Neutral",
            "not voting": "Neutral", "absent": "-", "excused": "-"}
FLIP = {"Affirmative": "Oppositional", "Oppositional": "Affirmative"}


# --------------------------------------------------------------------------
def sql(base, query, label="", retries=4):
    url = f"{base}.json?" + urllib.parse.urlencode({"sql": query, "_shape": "array"})
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code} on {label}: {e.read().decode('utf-8','replace')[:200]}"
            if e.code in (429, 502, 503, 504) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__} on {label}: {e}"
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1)); continue
            return [], last
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return [], f"Non-JSON on {label}: {body[:160]}"
        if isinstance(data, dict) and data.get("ok") is False:
            return [], f"Datasette error on {label}: {data.get('error')}"
        return (data if isinstance(data, list) else []), None
    return [], last


def esc(s):
    return str(s).replace("'", "''")


def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def in_list(ids):
    return ",".join(f"'{esc(i)}'" for i in ids)


def bill_type(identifier, classification):
    if classification:
        return classification
    m = re.match(r"^([A-Za-z]+)", identifier or "")
    pre = (m.group(1) if m else "").upper()
    return {"SO": "ordinance", "O": "ordinance", "SOR": "order", "OR": "order",
            "SR": "resolution", "R": "resolution", "F": "communication"}.get(pre, "other")


# --------------------------------------------------------------------------
# Live pulls
# --------------------------------------------------------------------------
def session_id(base, term):
    rows, err = sql(base, f"SELECT id FROM legislativesession WHERE identifier='{esc(term)}'", "session id")
    if err or not rows:
        raise SystemExit(f"Could not resolve session '{term}': {err}")
    return rows[0]["id"]


def build_crosswalk(base, org):
    """person_id -> list of {ward, start, end}. Date-aware for multi-ward people."""
    rows, err = sql(base,
        f"SELECT m.person_id AS pid, per.name AS name, p.label AS post, "
        f"m.start_date AS start, m.end_date AS end FROM membership m "
        f"JOIN post p ON m.post_id=p.id JOIN person per ON m.person_id=per.id "
        f"WHERE m.organization_id='{esc(org)}' AND m.post_id IS NOT NULL", "crosswalk")
    if err:
        raise SystemExit(f"Crosswalk failed: {err}")
    cw, names = defaultdict(list), {}
    for r in rows:
        mm = re.search(r"(\d{1,2})", r.get("post") or "")
        if not mm:
            continue
        cw[r["pid"]].append({"ward": int(mm.group(1)), "start": r.get("start"), "end": r.get("end")})
        names[r["pid"]] = r.get("name")
    return cw, names


def resolve_ward(cw, pid, vote_date):
    """Pick the ward whose stint covers vote_date; if several, latest start <= date."""
    stints = cw.get(pid) or []
    if not stints:
        return None
    if len(stints) == 1:
        return stints[0]["ward"]
    active = [s for s in stints
              if (not s["start"] or s["start"] <= vote_date) and (not s["end"] or s["end"] >= vote_date)]
    pool = active or stints
    pool = sorted(pool, key=lambda s: (s["start"] or ""))
    return pool[-1]["ward"]


def divided_votes(base, org, sess):
    rows, err = sql(base,
        f"SELECT ve.id AS id, ve.start_date AS date, ve.motion_text AS motion, "
        f"ve.result AS result, b.identifier AS bill, b.title AS title, b.classification AS clazz "
        f"FROM voteevent ve LEFT JOIN bill b ON ve.bill_id=b.id "
        f"WHERE ve.organization_id='{esc(org)}' AND ve.legislative_session_id='{esc(sess)}' "
        f"AND ve.id IN (SELECT vote_event_id FROM personvote WHERE option IN ('no','abstain')) "
        f"ORDER BY ve.start_date DESC", "divided votes")
    if err:
        raise SystemExit(f"Divided-vote pull failed: {err}")
    return rows


def personvotes_for(base, vote_ids):
    """{vote_id: [(voter_id, option)]} pulled in small batches to dodge the row cap."""
    out = defaultdict(list)
    for grp in chunk(vote_ids, BATCH):
        rows, err = sql(base,
            f"SELECT vote_event_id AS e, voter_id AS v, option AS o "
            f"FROM personvote WHERE vote_event_id IN ({in_list(grp)})", "personvotes batch")
        if err:
            raise SystemExit(f"Personvote pull failed: {err}")
        for r in rows:
            out[r["e"]].append((r["v"], r["o"]))
    return out


def committees(base, org, term_start, term_end):
    rows, err = sql(base,
        f"SELECT o.name AS committee, m.role AS role, m.person_id AS pid, "
        f"m.start_date AS start, m.end_date AS end FROM membership m "
        f"JOIN organization o ON m.organization_id=o.id "
        f"WHERE o.classification='committee'", "committees")
    if err:
        raise SystemExit(f"Committee pull failed: {err}")
    active = []
    for r in rows:
        s, e = r.get("start"), r.get("end")
        if (not s or s <= term_end) and (not e or e >= term_start):
            active.append(r)
    return active


# --------------------------------------------------------------------------
# Build payloads
# --------------------------------------------------------------------------
def build_rollcall(votes, pv, cw, today, source):
    out, unresolved = [], 0
    for v in votes:
        positions, tally = {}, Counter()
        for (pid, opt) in pv.get(v["id"], []):
            tally[opt] += 1
            ward = resolve_ward(cw, pid, v.get("date") or "")
            if ward is None:
                unresolved += 1
                continue
            positions[str(ward)] = RECORD.get(opt, opt)
        out.append({
            "id": v["id"],
            "date": v.get("date"),
            "bill": v.get("bill"),
            "title": (v.get("title") or "").strip(),
            "type": bill_type(v.get("bill"), v.get("clazz")),
            "result": v.get("result"),
            "source_url": f"https://chicago.councilmatic.org/search/?q={urllib.parse.quote(v.get('bill') or '')}",
            "tally": dict(tally),
            "positions": positions,
        })
    return {"generated_at": today, "source": source, "term_votes": len(out),
            "votes": out}, unresolved


def populate_featured(data, fmap, pv, cw, ward_index):
    """Write semantic positions for mapped featured votes. Returns a per-code report."""
    votemeta = {v.get("code"): v for v in data.get("votemeta", [])}
    report = {}
    for code, m in fmap.items():
        vid = m.get("vote_id")
        rows = pv.get(vid)
        if rows is None:  # featured vote wasn't in the divided pull; fetch handled by caller
            report[code] = {"status": "no_personvotes_pulled"}
            continue
        reverse = bool(votemeta.get(code, {}).get("reverse_coded"))
        counts = Counter()
        for (pid, opt) in rows:
            ward = resolve_ward(cw, pid, m.get("date") or "")
            if ward is None or ward not in ward_index:
                continue
            pos = POSITION.get(opt, "-")
            if reverse:
                pos = FLIP.get(pos, pos)
            ward_index[ward].setdefault("votes", {})[code] = pos
            counts[pos] += 1
        report[code] = {"status": "populated", "reverse_coded": reverse,
                        "positions_written": sum(counts.values()), "breakdown": dict(counts)}
    return report


def build_committees(rows, cw, today):
    by_ward = defaultdict(list)
    by_committee = defaultdict(list)
    roles = Counter()
    for r in rows:
        roles[r.get("role")] += 1
        # use the person's most-recent ward (no specific date -> latest stint)
        ward = resolve_ward(cw, r["pid"], today)
        entry = {"committee": r["committee"], "role": r.get("role")}
        if ward is not None:
            by_ward[str(ward)].append(entry)
        by_committee[r["committee"]].append({"ward": ward, "role": r.get("role")})
    return {"generated_at": today, "note": "Held for future UI. Not yet surfaced in the embed.",
            "role_vocab": dict(roles), "by_ward": dict(by_ward),
            "by_committee": {k: v for k, v in by_committee.items()}}


# --------------------------------------------------------------------------
def run(data_path, map_path, base, org, term, dry_run):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for p in (data_path, map_path):
        if not os.path.exists(p):
            print(f"  Missing required input: {p}"); return 1
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    with open(map_path, encoding="utf-8") as f:
        fmap = json.load(f)
    print(f"  Loaded council-data.json ({len(data.get('alders', []))} alders, "
          f"{len(data.get('votemeta', []))} featured-vote defs)")
    print(f"  Featured map: {len(fmap)} votes -> {', '.join(fmap)}")

    _, err = sql(base, "SELECT 1", "connectivity")
    if err:
        print(f"  Cannot reach data: {err}\n  (Run locally or from a non-blocked runner.)"); return 1

    sess = session_id(base, term)
    trow, _ = sql(base, f"SELECT start_date, end_date FROM legislativesession WHERE identifier='{esc(term)}'", "term")
    term_start = (trow[0]["start_date"] if trow else f"{term}-05-15")
    term_end = (trow[0]["end_date"] if trow else "2027-05-15")

    print("  Building ward crosswalk (live)...")
    cw, names = build_crosswalk(base, org)
    print(f"    {len(cw)} people with ward seats.")

    print("  Pulling divided votes for the term...")
    votes = divided_votes(base, org, sess)
    print(f"    {len(votes)} divided votes.")

    # personvotes for divided votes + any featured vote not already in that set
    vote_ids = [v["id"] for v in votes]
    featured_ids = [m["vote_id"] for m in fmap.values() if m.get("vote_id")]
    all_ids = list(dict.fromkeys(vote_ids + featured_ids))
    print(f"  Pulling per-member votes for {len(all_ids)} roll calls (batched)...")
    pv = personvotes_for(base, all_ids)

    source = f"DataMade OCD Councilmatic ({base}) — synced {today}"
    rollcall, unresolved = build_rollcall(votes, pv, cw, today, source)
    if unresolved:
        print(f"    NOTE: {unresolved} person-votes did not resolve to a ward (flagged, skipped).")

    ward_index = {}
    for a in data.get("alders", []):
        try:
            ward_index[int(a.get("ward"))] = a
        except (TypeError, ValueError):
            pass
    feat_report = populate_featured(data, fmap, pv, cw, ward_index)

    print("  Pulling committee memberships (held for later UI)...")
    crows = committees(base, org, term_start, term_end)
    council_committees = build_committees(crows, cw, today)
    print(f"    {len(crows)} memberships across {len(council_committees['by_committee'])} committees.")

    # ---- assemble (machine-owned keys only) ----
    data["rollcall"] = rollcall
    data["council_committees"] = council_committees
    data["_sync"] = {
        "generated_at": today, "term": term, "source": source,
        "featured_auto": [c for c, r in feat_report.items() if r.get("status") == "populated"],
        "featured_report": feat_report,
        "rollcall_votes": rollcall["term_votes"],
        "unresolved_personvotes": unresolved,
    }

    # ---- report ----
    print("\n" + "=" * 68 + "\n  SYNC REPORT\n" + "=" * 68)
    print(f"  Tier 2 rollcall votes written : {rollcall['term_votes']}")
    print("  Tier 1 featured votes auto-populated:")
    for code, r in feat_report.items():
        if r.get("status") == "populated":
            rc = " (reverse-coded)" if r.get("reverse_coded") else ""
            print(f"    {code:18s} {r['positions_written']:>2} positions  {r['breakdown']}{rc}")
        else:
            print(f"    {code:18s} {r.get('status')}")
    print(f"  Council committees folded in  : {len(council_committees['by_committee'])} (held)")

    if dry_run:
        print("\n  DRY RUN — no files written.")
        return 0

    backup = data_path + ".bak"
    shutil.copy2(data_path, backup)
    tmp = data_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    json.load(open(tmp, encoding="utf-8"))  # validate before swap
    os.replace(tmp, data_path)
    print(f"\n  Wrote {data_path}  (backup at {backup})")
    print("  Editor-owned content (donors, bios, vote definitions, unmapped votes) untouched.")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Sync Chicago council roll-call data into council-data.json.")
    ap.add_argument("--data", default="./council-data.json")
    ap.add_argument("--map", default="./featured_vote_map.json")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--org", default=DEFAULT_ORG)
    ap.add_argument("--term", default="2023")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    try:
        return run(args.data, args.map, args.base, args.org, args.term, args.dry_run)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
