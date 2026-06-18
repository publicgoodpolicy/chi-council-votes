#!/usr/bin/env python3
"""
build_election_seed.py -- assemble the candidate/race layer of election-data.json
for the IPG Elections tool (school board, Nov 3 2026 + municipal, Feb 23 2027).

WHY THIS IS A SCAFFOLD, NOT A FULL BUILD
----------------------------------------
The candidate/race layer is the only genuinely new code. Everything below it
(finance ingestion, donor resolution, classification, rollups, validation) is
your EXISTING council pipeline, reused unchanged. This script writes the new
layer and prints the exact run order for the reused steps, left as labelled WIRE
points rather than re-implemented -- re-deriving any of them (especially the
donor slug) would break the shared-classification guarantee.

THE SHARED-DONOR GUARANTEE (this is the whole point)
----------------------------------------------------
donor_id is a deterministic slug of the contributor name. Classification lives
in the master Sheet keyed to donor_id. Therefore:
  * Ingest election finance with the SAME ingest.py / ingest_ie.py the council
    tool uses, so every donor_id matches.
  * Apply classification with the SAME sync_overrides.py against the SAME Sheet.
A donor classified once is classified for both tools, forever. Do NOT add a
classification step here.

BOUNDARY REUSE (from the ipg-rep-finder repo)
---------------------------------------------
Drop schoolboard.geojson and wards.geojson into campaign-finance/elections/.
This script then derives the school-board and ward races -- their labels and a
geo_key -- straight from those boundary files, so races line up exactly with the
maps. The same two files power an address -> race lookup lifted from the
rep-finder's point-in-polygon resolver (match on DISTRICT for school, ward for
council). If the files are absent, the script falls back to a synthetic roster.

CANONICAL RUN ORDER (full election build)
-----------------------------------------
  0. cp ../../ipg-rep-finder/{schoolboard,wards}.geojson campaign-finance/elections/
  1. build_election_seed.py    <- this script. Seeds dict-shaped committees/donors/
        rollups + a cycles block, so the reused council pipeline runs unchanged.
  2. ingest.py    --data-file election-data.json --raw-dir raw/receipts-elections
        Direct contributions; adds donors that do NOT yet carry parent_id.
  3. transform_slice1.py  election-data.json
        Assigns parent_id to ALL donors (self-parents on election data — no clusters).
  4. transform_slice2.py  election-data.json
        Committee registry; election-aware guard (no 50-candidate floor for election
        artifacts, bridge-integrity check preserved in both modes).
  5. ingest_ie.py --council election-data.json --expenditures <SBE Exp> \
        --receipts <SBE Rec> --out election-data.json
        IE layer; its internal build_rollups is now safe (every donor has parent_id).
  5b. enrich_committee_names.py --council election-data.json --committees <SBE Committees.txt> \
        --out election-data.json
        Resolve IE spender committee_ids to real names (ingest_ie only knows the id).
        Same step the council build runs. Without the SBE Committees.txt, back-fill from
        council-data.json's already-resolved names (the shared committee-name table).
  6. sync_overrides.py    --data-file election-data.json --sheet-id <ID> --creds-file <path>
        Shared classification + clusters + IE-committee industry tags (sets parent_id
        on clustered donors directly).
  7. build_rollups.py     election-data.json     (standalone, idempotent)
        Runs LAST so the rollups reflect the Sheet: by_industry's independent/IE layer
        (keyed off IE-committee industry_tags) and direct totals reflect the synced
        donor classifications — which a pre-sync build_rollups would miss.
  8. validate_council_data.py  election-data.json     (positional arg; shared gate)

GOVERNING RULE: build_rollups — INCLUDING the copy ingest_ie calls at its end — must
never run while any donor lacks parent_id. transform_slice1 (step 3) guarantees this,
which is why slice1/slice2 sit BEFORE ingest_ie here. And build_rollups runs AFTER
sync_overrides (mirroring build_all.sh, where rollups run last) so the IE/industry
layer reflects the synced tags; the copy inside ingest_ie at step 5 is just
intermediate and is overwritten by step 7. This differs from the council build_all.sh
only in that slice1/slice2 sit before ingest_ie here.

Requires $REPO (same convention as the council scripts).
"""

import json
import os
import re
import sys
import datetime


def repo():
    r = os.environ.get("REPO")
    if not r:
        sys.exit("ERROR: set $REPO first (e.g. export REPO=~/chi-council-votes)")
    return os.path.expanduser(r)


ELECTIONS = [
    {"id": "2026-school-board", "label": "2026 Chicago Board of Education",
     "date": "2026-11-03", "runoff_date": None},
    {"id": "2027-municipal", "label": "2027 Chicago Municipal General",
     "date": "2027-02-23", "runoff_date": "2027-04-06"},
]

# Election-cycle boundaries — copied from council-data.json so ingest_ie's
# cycle_for() (which reads d['cycles']) assigns the same cycle codes both tools
# use. 2026 school-board and 2027 municipal money both fall in the 2027 cycle.
CYCLES = {
    "2015": {"label": "2011 – 2015 cycle", "start": "2011-05-17",
             "end": "2015-05-17", "election_date": "2015-02-24"},
    "2019": {"label": "2015 – 2019 cycle", "start": "2015-05-18",
             "end": "2019-05-19", "election_date": "2019-02-26"},
    "2023": {"label": "2019 – 2023 cycle", "start": "2019-05-20",
             "end": "2023-05-14", "election_date": "2023-02-28"},
    "2027": {"label": "Current cycle (2023 – 2027)", "start": "2023-05-15",
             "end": "2027-05-17", "election_date": "2027-02-23"},
}


def _load_geojson_keys(path, key_field):
    """Return a sorted list of {key,long,short} from a boundary file's feature
    properties, or None if the file is missing/unreadable. Only properties are
    read; coordinates are ignored."""
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            gj = json.load(f)
    except (json.JSONDecodeError, OSError):
        return None
    out = []
    for feat in gj.get("features", []):
        p = feat.get("properties", {})
        if key_field not in p:
            continue
        try:
            k = int(p[key_field])
        except (TypeError, ValueError):
            continue
        out.append({"key": k, "long": p.get("LONGNAME"), "short": p.get("SHORTNAME")})
    out.sort(key=lambda r: r["key"])
    return out or None


def generate_races(repo_root):
    """Races are mechanical for Chicago, so we derive rather than hand-maintain
    them. School board: 1 citywide president + 20 single-member districts (the
    1a-10b subdistricts, DISTRICT 1-20). Municipal: 53 city offices = mayor +
    clerk + treasurer + 50 wards. geo_key joins a race to its boundary polygon
    for the address lookup; citywide offices have geo_key=None. Status defaults
    reflect where each field stands now -- flip them forming -> filed ->
    certified as the calendar advances."""
    elections_dir = os.path.join(repo_root, "campaign-finance", "elections")
    races = []
    src = {"school": None, "ward": None}

    races.append({"id": "sb-president", "election_id": "2026-school-board",
                  "office": "school_board_president", "district": None,
                  "label": "School Board President (citywide)",
                  "geo_key": None, "geo_source": None, "status": "filed"})

    sb = _load_geojson_keys(os.path.join(elections_dir, "schoolboard.geojson"), "DISTRICT")
    if sb:
        src["school"] = "schoolboard.geojson"
        for d in sb:
            label = d["long"] or ("District %d" % d["key"])
            # Display only: ballot uppercases the subdistrict letter ("1a" -> "1A").
            # Touches the label/district string ONLY; race_id and geo_key are
            # derived from d["key"] and are unaffected.
            label = re.sub(r'(\d+)([ab])\b', lambda m: m.group(1) + m.group(2).upper(), label)
            races.append({"id": "sb-d%02d" % d["key"], "election_id": "2026-school-board",
                          "office": "school_board_member", "district": label,
                          "label": "School Board, %s" % label,
                          "geo_key": d["key"], "geo_source": "schoolboard.geojson",
                          "status": "filed"})
    else:
        for n in range(1, 21):
            races.append({"id": "sb-d%02d" % n, "election_id": "2026-school-board",
                          "office": "school_board_member", "district": str(n),
                          "label": "School Board, District %d" % n,
                          "geo_key": n, "geo_source": None, "status": "filed"})

    for oid, office, label in [("mayor", "mayor", "Mayor"),
                               ("city-clerk", "city_clerk", "City Clerk"),
                               ("city-treasurer", "city_treasurer", "City Treasurer")]:
        races.append({"id": oid, "election_id": "2027-municipal", "office": office,
                      "district": None, "label": label,
                      "geo_key": None, "geo_source": None, "status": "forming"})

    wd = _load_geojson_keys(os.path.join(elections_dir, "wards.geojson"), "ward")
    if wd:
        src["ward"] = "wards.geojson"
        ward_keys = [w["key"] for w in wd]
    else:
        ward_keys = list(range(1, 51))
    for w in ward_keys:
        races.append({"id": "ward-%02d" % w, "election_id": "2027-municipal",
                      "office": "alderperson", "ward": str(w),
                      "label": "Alderperson, Ward %d" % w,
                      "geo_key": w, "geo_source": src["ward"], "status": "forming"})

    return races, src


def load_race_map(path):
    with open(path) as f:
        return json.load(f)


def build_candidates(race_map, race_ids):
    """Turn the race map into candidate records from two sources:
      * mappings        -- committee_id -> candidate (committee known; the join
                           into the reused finance layer).
      * incumbent_stubs -- candidate_id -> candidate, committee_id null (current
                           officeholders whose 2027 committee is not yet
                           identified and whose candidacy is not confirmed).
    positions stays null -- reserved for the v2 'what they stand for' work.
    Once a confirmed incumbent is added to mappings, that race's stub is
    superseded and skipped, so promoting a stub is a one-line edit with no dupes."""
    mappings = race_map.get("mappings", {})
    stubs = race_map.get("incumbent_stubs", {})
    cands, bad = [], []
    incumbent_races = set()

    for committee_id, c in mappings.items():
        if committee_id.startswith("_") or not isinstance(c, dict):
            continue
        rid = c.get("race_id")
        if rid not in race_ids:
            bad.append((committee_id, rid))
        if c.get("incumbent"):
            incumbent_races.add(rid)
        cands.append({
            "id": c.get("candidate_id"),
            "race_id": rid,
            "name": c.get("name"),
            "committee_id": committee_id,
            "status": c.get("status", "declared"),
            "incumbent": bool(c.get("incumbent", False)),
            "vacating_for": c.get("vacating_for"),
            "bio": c.get("bio", {}),
            "positions": None,
        })

    for candidate_id, c in stubs.items():
        if candidate_id.startswith("_") or not isinstance(c, dict):
            continue
        rid = c.get("race_id")
        if rid in incumbent_races:
            continue
        if rid not in race_ids:
            bad.append((candidate_id, rid))
        cands.append({
            "id": c.get("candidate_id", candidate_id),
            "race_id": rid,
            "name": c.get("name"),
            "committee_id": c.get("committee_id"),
            "status": c.get("status", "incumbent-pending"),
            "incumbent": bool(c.get("incumbent", True)),
            "vacating_for": c.get("vacating_for"),
            "bio": c.get("bio", {}),
            "positions": None,
        })

    cand_stubs = race_map.get("candidate_stubs", {})
    for candidate_id, c in cand_stubs.items():
        if candidate_id.startswith("_") or not isinstance(c, dict):
            continue
        rid = c.get("race_id")
        if rid not in race_ids:
            bad.append((candidate_id, rid))
        cands.append({
            "id": c.get("candidate_id", candidate_id),
            "race_id": rid,
            "name": c.get("name"),
            "committee_id": c.get("committee_id"),
            "status": c.get("status", "filed"),
            "incumbent": bool(c.get("incumbent", False)),
            "vacating_for": c.get("vacating_for"),
            "bio": c.get("bio", {}),
            "positions": None,
        })
    return cands, bad


def main():
    R = repo()
    base = os.path.join(R, "campaign-finance", "elections")
    race_map_path = os.path.join(base, "race-map.json")
    out_path = os.path.join(R, "campaign-finance", "election-data.json")

    if not os.path.exists(race_map_path):
        sys.exit("ERROR: missing %s" % race_map_path)

    elections = ELECTIONS
    races, src = generate_races(R)
    race_ids = {r["id"] for r in races}
    race_map = load_race_map(race_map_path)
    candidates, bad = build_candidates(race_map, race_ids)

    existing = {}
    if os.path.exists(out_path):
        try:
            with open(out_path) as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            existing = {}

    data = dict(existing)
    data["elections"] = elections
    data["races"] = races
    data["candidates"] = candidates
    # Finance keys must match the council-data.json shape the reused pipeline
    # expects: committees/donors/rollups/industry_tags are DICTS (keyed by id),
    # while contributions/independent_expenditures are LISTS. (industry_tags is a
    # dict — sync_overrides does industry_tags[k]=... ; a list breaks it.)
    # `cur if cur else default` coerces an empty/wrong-typed seed value to the
    # right type while preserving any already-ingested finance data on re-runs.
    for k, default in (("committees", {}), ("donors", {}), ("contributions", []),
                       ("independent_expenditures", []), ("rollups", {}),
                       ("industry_tags", {})):
        cur = existing.get(k)
        data[k] = cur if cur else default
    # ingest_ie reads d['cycles']; preserve any existing override, else seed it.
    data["cycles"] = existing.get("cycles") or CYCLES
    data["seed_generated_at"] = datetime.datetime.now().isoformat(timespec="seconds")

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    sb = sum(1 for r in races if r["election_id"] == "2026-school-board")
    muni = sum(1 for r in races if r["election_id"] == "2027-municipal")
    with_committee = sum(1 for c in candidates if c.get("committee_id"))
    stub_n = len(candidates) - with_committee
    print("election seed written: %s" % out_path)
    print("  elections        : %d" % len(elections))
    print("  races            : %d  (%d school board, %d municipal)" % (len(races), sb, muni))
    print("  boundaries       : school=%s  ward=%s" % (src["school"] or "synthetic",
                                                       src["ward"] or "synthetic"))
    print("  candidates       : %d  (%d with committee, %d incumbent stubs pending committee)"
          % (len(candidates), with_committee, stub_n))
    if bad:
        print("  WARNING: candidates pointing at unknown race_id:")
        for cid, rid in bad:
            print("    committee %s -> race_id '%s'" % (cid, rid))
    if not existing.get("contributions"):
        print("  NOTE: no finance in election-data.json yet -- run ingest.py / ingest_ie.py next.")
    print("  classification is SHARED: ingest via the same ingest.py and run the same")
    print("  sync_overrides.py against the master Sheet. Do NOT re-classify donors here.")


if __name__ == "__main__":
    main()
