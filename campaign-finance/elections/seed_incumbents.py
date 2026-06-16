#!/usr/bin/env python3
"""
seed_incumbents.py -- pull current officeholders from the ipg-rep-finder
index.html (REPS.ward + REPS.school) and write them into race-map.json as
incumbent_stubs.

These are CURRENT officeholders, not declared or filed candidates. We have no
declaration data for them, so they are written with:
    status      = "incumbent-pending"   (holds the seat; candidacy NOT confirmed)
    committee_id = null                  (their 2027 committee is not yet identified)
and kept in a separate `incumbent_stubs` block (keyed by candidate_id) rather
than in `mappings` (keyed by committee_id). When an incumbent files and you
identify their SBE committee, move them into `mappings` under that committee_id;
build_election_seed.py then ignores the stub for that race automatically.

Usage:
    python3 seed_incumbents.py <path/to/ipg-rep-finder/index.html> [race-map.json]
    (race-map.json defaults to $REPO/campaign-finance/elections/race-map.json)

Re-running is idempotent: it regenerates the whole incumbent_stubs block and
leaves `mappings` and the _doc fields untouched.
"""

import json
import os
import re
import sys


def _field(blob, key):
    """Extract a string field from a JS object-literal line, handling both
    double- and single-quoted values (school names use single quotes with
    embedded double quotes, e.g. 'Aaron "Jitu" Brown')."""
    m = re.search(r'%s:\s*(?:"([^"]*)"|\'([^\']*)\')' % key, blob)
    if not m:
        return ""
    return m.group(1) if m.group(1) is not None else (m.group(2) or "")


def _block(text, name):
    """Return the body of a single REPS layer (e.g. 'ward' or 'school'), from
    its opening brace to the 2-space-indented closing '},'. Scoping to the block
    avoids matching numeric keys in the house/senate/congress layers."""
    start = text.index(name + ": {")
    end = text.index("\n  },", start)
    return text[start:end]


def _links(website):
    return {"office": website} if website else {}


def parse_wards(text):
    block = _block(text, "ward")
    stubs = {}
    for m in re.finditer(r"^\s*(\d+):\s*\{(.+)\},?\s*$", block, re.M):
        n = int(m.group(1))
        body = m.group(2)
        cid = "inc-ward-%02d" % n
        district = _field(body, "district") or ("%d Ward" % n)
        stubs[cid] = {
            "candidate_id": cid,
            "name": _field(body, "name"),
            "race_id": "ward-%02d" % n,
            "committee_id": None,
            "incumbent": True,
            "status": "incumbent-pending",
            "bio": {
                "current_roles": ["Alderperson, %s" % district],
                "party": _field(body, "party"),
                "phone": _field(body, "phone"),
                "email": _field(body, "email"),
                "links": _links(_field(body, "website")),
                "source": "ipg-rep-finder REPS.ward (current officeholder; candidacy not confirmed)",
            },
        }
    return stubs


def _school_key_to_district(key):
    """'1a' -> 1, '1b' -> 2, '2a' -> 3, ... '10a' -> 19, '10b' -> 20.
    Matches DISTRICT 1-20 in schoolboard.geojson."""
    pair = int(key[:-1])
    return 2 * pair - 1 if key.endswith("a") else 2 * pair


def parse_school(text):
    block = _block(text, "school")
    stubs = {}
    for m in re.finditer(r"^\s*'(\d+[ab])':\s*\{(.+)\},?\s*$", block, re.M):
        key = m.group(1)
        body = m.group(2)
        d = _school_key_to_district(key)
        cid = "inc-sb-d%02d" % d
        district = _field(body, "district") or ("District %s" % key)
        stubs[cid] = {
            "candidate_id": cid,
            "name": _field(body, "name"),
            "race_id": "sb-d%02d" % d,
            "committee_id": None,
            "incumbent": True,
            "status": "incumbent-pending",
            "bio": {
                "current_roles": ["Chicago Board of Education, %s" % district],
                "board_role": _field(body, "role"),
                "phone": _field(body, "phone"),
                "email": _field(body, "email"),
                "links": _links(_field(body, "website")),
                "source": "ipg-rep-finder REPS.school (current officeholder; candidacy not confirmed)",
            },
        }
    return stubs


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: seed_incumbents.py <ipg-rep-finder/index.html> [race-map.json]")
    src = os.path.expanduser(sys.argv[1])
    if len(sys.argv) > 2:
        race_map_path = os.path.expanduser(sys.argv[2])
    else:
        repo = os.environ.get("REPO")
        if not repo:
            sys.exit("ERROR: set $REPO or pass race-map.json explicitly")
        race_map_path = os.path.join(os.path.expanduser(repo),
                                     "campaign-finance", "elections", "race-map.json")

    text = open(src, encoding="utf-8").read()
    stubs = {}
    stubs.update(parse_wards(text))
    stubs.update(parse_school(text))

    with open(race_map_path, encoding="utf-8") as f:
        race_map = json.load(f)
    race_map["incumbent_stubs"] = stubs
    sv = race_map.get("_status_values", "")
    if "incumbent-pending" not in sv:
        race_map["_status_values"] = (sv + " | incumbent-pending").lstrip(" |")
    with open(race_map_path, "w", encoding="utf-8") as f:
        json.dump(race_map, f, indent=2)

    wards = sum(1 for k in stubs if k.startswith("inc-ward-"))
    school = sum(1 for k in stubs if k.startswith("inc-sb-d"))
    print("wrote incumbent_stubs to %s" % race_map_path)
    print("  ward incumbents  : %d" % wards)
    print("  school incumbents: %d" % school)
    print("  total stubs      : %d  (committee_id=null, status=incumbent-pending)" % len(stubs))
    missing = [k for k, v in stubs.items() if not v["name"]]
    if missing:
        print("  WARNING: %d stubs parsed with empty name: %s" % (len(missing), missing))


if __name__ == "__main__":
    main()
