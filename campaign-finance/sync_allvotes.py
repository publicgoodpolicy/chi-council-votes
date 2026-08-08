#!/usr/bin/env python3
"""
sync_allvotes.py — Two-way "All Votes" admin tab in the Google Sheet.

Runs right AFTER ingest_votes.py (and imports its tested helpers, so the
crosswalk / position-mapping logic is shared, not duplicated). It:

  PUSH  — writes every rollcall (divided) vote to an "All Votes" tab:
          machine columns  vote_id | date | bill | title | type | result | tally
          editor columns   featured | code | full_name | tag | description
          Machine columns are overwritten each run; editor columns are PRESERVED
          (read first, written back). On first run, votes already in
          featured_vote_map.json are SEEDED as featured (pulling full/tag/etc.
          from the current votemeta) so the migration needs no manual re-flagging.

          FAIL-LOUD (EDIT-SAFE-1/S1): the push is clear()+update() over the WHOLE
          tab, so the editor columns survive only because they were read first.
          A read that FAILS therefore aborts the run before the clear — it is an
          error, never an empty tab. Three distinct states, never collapsed:
            read failed        -> EditorReadFailure -> abort, tab untouched
            read ok, no rows   -> {} -> proceed (legitimately empty)
            tab absent         -> created, read skipped -> proceed (named branch)
          Previously a bare `except Exception: return {}` made the first state
          look like the second, and the run silently overwrote every human-edited
          editor column with seeded or blank values.

  READ-BACK — turns the editor columns into data:
          • Any row checked `featured` becomes a featured vote. Its vote_id is
            already in the row, so NO matching is needed (retires the matcher).
            We upsert a votemeta entry, add it to featured_vote_map.json, and
            populate its per-alder positions. Positions are written exactly as
            POSITION maps them — the reverse-coding flip is retired (REFRESH-1).
          • The `tag` column on ANY row is attached to that rollcall vote, so
            the full record can be filtered by tag — featured or not.

Needs WRITE scope (spreadsheets), unlike the read-only sheet syncs.

USAGE
    python3 sync_allvotes.py --data ./council-data.json --map ./featured_vote_map.json \
        --sheet-id ABC123 --creds-file ./creds.json
    python3 sync_allvotes.py ... --dry-run     # compute + report, write nothing
"""

from __future__ import annotations
import argparse, json, os, sys
from pathlib import Path

import ingest_votes as IV   # shared, tested: sql, build_crosswalk, resolve_ward,
                            # personvotes_for, POSITION, DEFAULT_BASE/ORG

ALL_VOTES_TAB = "All Votes"
MACHINE_COLS = ["vote_id", "date", "bill", "title", "type", "result", "tally"]
# `reverse_coded` RETIRED at REFRESH-1: dropping it here is deliberate, and the
# next real sync removes the column from the All Votes tab, because write_tab
# rewrites the whole tab from HEADER. The tab is machine-owned, so this is a
# votes-domain scaffolding write, not an editorial write-back.
EDITOR_COLS = ["featured", "code", "full_name", "tag", "description"]
HEADER = MACHINE_COLS + EDITOR_COLS
WRITE_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def truthy(v):
    return str(v).strip().lower() in ("true", "1", "yes", "y", "x", "✓") if v not in (True,) else True


def tally_str(tally):
    if not tally:
        return ""
    return " · ".join(f"{k} {v}" for k, v in tally.items())


# ----------------------------------------------------------------------------
# Sheet I/O (write scope)
# ----------------------------------------------------------------------------
def open_sheet(sheet_id, creds_file=None):
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("Missing deps. Run: pip install gspread google-auth", file=sys.stderr)
        sys.exit(1)
    if creds_file:
        creds = Credentials.from_service_account_file(creds_file, scopes=WRITE_SCOPES)
    else:
        env = os.environ.get("GOOGLE_SHEETS_CREDENTIALS")
        if not env:
            raise SystemExit("No credentials. Pass --creds-file or set GOOGLE_SHEETS_CREDENTIALS.")
        creds = Credentials.from_service_account_info(json.loads(env), scopes=WRITE_SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id)


class EditorReadFailure(RuntimeError):
    """The existing All Votes tab could not be read.

    Distinct from a successful read that returns no rows. The caller MUST abort
    before write_tab(): the editor columns cannot be preserved if they were
    never read, and this tab's write is a clear()+update() over the whole tab.
    """


def get_or_make_tab(sheet):
    """(worksheet, created) — `created` True only when the tab was absent.

    The flag is the whole point: a freshly created tab legitimately has no
    editor values, and that must be a NAMED branch rather than something the
    caller infers from an empty read. Without it, "tab absent, will create" and
    "the read failed" are indistinguishable, which is what let a transient API
    error overwrite every human-edited editor column with seeded values.
    """
    import gspread
    try:
        return sheet.worksheet(ALL_VOTES_TAB), False
    except gspread.WorksheetNotFound:
        return sheet.add_worksheet(title=ALL_VOTES_TAB, rows=400, cols=len(HEADER)), True


def read_existing_editor(ws):
    """{vote_id: {editor_col: value}} for rows already in the tab.

    Raises EditorReadFailure if the read itself fails. Returning {} is reserved
    for a SUCCESSFUL read of a tab with no rows — the two cases mean opposite
    things to the caller and are never collapsed here.
    """
    try:
        rows = ws.get_all_records()
    except Exception as e:
        raise EditorReadFailure(f"{type(e).__name__}: {e}") from e
    out = {}
    for r in rows:
        vid = str(r.get("vote_id") or "").strip()
        if vid:
            out[vid] = {c: r.get(c, "") for c in EDITOR_COLS}
    return out


def write_tab(ws, rows):
    ws.clear()
    ws.update([HEADER] + rows, value_input_option="USER_ENTERED")


# ----------------------------------------------------------------------------
# Pure logic (unit-tested offline)
# ----------------------------------------------------------------------------
def seed_map_from_featured(fmap, votemeta):
    """vote_id -> seeded editor dict, for votes already featured (migration)."""
    by_code = {vm.get("code"): vm for vm in votemeta}
    seed = {}
    for code, m in (fmap or {}).items():
        vid = m.get("vote_id")
        if not vid:
            continue
        vm = by_code.get(code, {})
        seed[vid] = {
            "featured": "TRUE", "code": code,
            "full_name": vm.get("full", ""), "tag": vm.get("tag", ""),
            "description": vm.get("desc", vm.get("description", "")),
        }
    return seed


def compute_effective(rollcall_votes, existing_editor, seed_map):
    """For each rollcall vote, the editor values to use: existing tab row wins;
    else the migration seed; else blank. Returns (rows_for_sheet, effective)."""
    effective, rows = {}, []
    for v in rollcall_votes:
        vid = v["id"]
        if vid in existing_editor:
            ed = {c: existing_editor[vid].get(c, "") for c in EDITOR_COLS}
        else:
            ed = {c: seed_map.get(vid, {}).get(c, "") for c in EDITOR_COLS}
        effective[vid] = ed
        rows.append([
            vid, v.get("date", ""), v.get("bill", ""), v.get("title", ""),
            v.get("type", ""), v.get("result", ""), tally_str(v.get("tally")),
        ] + [ed.get(c, "") for c in EDITOR_COLS])
    return rows, effective


def apply_tags(data, effective):
    n = 0
    for v in data.get("rollcall", {}).get("votes", []):
        tag = (effective.get(v["id"], {}) or {}).get("tag", "")
        tag = str(tag).strip()
        if tag:
            v["tag"] = tag; n += 1
        elif "tag" in v:
            del v["tag"]
    return n


def apply_featured(data, effective, base, org, dry_run=False):
    """OWN votemeta: rebuild it entirely from the All Votes tab's featured rows
    (so un-checking a vote removes it). Also build featured_vote_map and populate
    per-alder positions. Returns (fmap, report)."""
    rc_by_id = {v["id"]: v for v in data.get("rollcall", {}).get("votes", [])}
    featured = {vid: ed for vid, ed in effective.items()
                if truthy(ed.get("featured")) and str(ed.get("code") or "").strip()}
    report = {"featured": 0, "skipped_no_code": 0, "positions_written": 0}
    for vid, ed in effective.items():
        if truthy(ed.get("featured")) and not str(ed.get("code") or "").strip():
            report["skipped_no_code"] += 1

    cw, _ = (IV.build_crosswalk(base, org) if featured else ({}, {}))
    pv = IV.personvotes_for(base, list(featured)) if featured else {}
    ward_index = {}
    for a in data.get("alders", []):
        try:
            ward_index[int(a.get("ward"))] = a
        except (TypeError, ValueError):
            pass

    new_votemeta, seen_codes, fmap = [], set(), {}
    for vid, ed in featured.items():
        code = str(ed["code"]).strip()
        if code in seen_codes:
            print(f"  ! duplicate code '{code}' in All Votes tab — keeping the first.")
            continue
        seen_codes.add(code)
        rcv = rc_by_id.get(vid, {})
        date = rcv.get("date", "")
        new_votemeta.append({
            "code": code,
            "full": str(ed.get("full_name") or rcv.get("title") or code).strip(),
            "tag": str(ed.get("tag") or "").strip(),
            "year": (date[:4] if date else ""),
            "source_url": rcv.get("source_url"),
            "desc": str(ed.get("description") or "").strip(),
            "vote_id": vid,
        })
        fmap[code] = {"vote_id": vid, "bill": rcv.get("bill"), "title": rcv.get("title"),
                      "date": date, "divided": True, "confirmed": "sheet",
                      "matched_on": "all-votes-tab"}
        for (pid, opt) in pv.get(vid, []):
            ward = IV.resolve_ward(cw, pid, date or "")
            if ward in ward_index:
                pos = IV.POSITION.get(opt, "-")
                ward_index[ward].setdefault("votes", {})[code] = pos
                report["positions_written"] += 1
        report["featured"] += 1

    # Single source of truth: featured set fully defines votemeta.
    data["votemeta"] = new_votemeta
    return fmap, report


# ----------------------------------------------------------------------------
def run(data_path, map_path, sheet_id, creds_file, base, org, dry_run, no_sheet):
    if not os.path.exists(data_path):
        print(f"  Missing {data_path}"); return 1
    with open(data_path, encoding="utf-8") as f:
        data = json.load(f)
    rollcall_votes = data.get("rollcall", {}).get("votes", [])
    if not rollcall_votes:
        print("  No rollcall tier in council-data.json — run ingest_votes.py first."); return 1
    existing_fmap = {}
    if os.path.exists(map_path):
        with open(map_path, encoding="utf-8") as f:
            existing_fmap = json.load(f)

    seed = seed_map_from_featured(existing_fmap, data.get("votemeta", []))

    if no_sheet:
        print("  --no-sheet: using existing tab state is impossible offline; "
              "seeding from featured_vote_map only.")
        existing_editor = {}
    else:
        sheet = open_sheet(sheet_id, creds_file)
        ws, created = get_or_make_tab(sheet)
        if created:
            # Named branch: the tab did not exist, so there is nothing to preserve.
            # This is the ONLY path on which an empty editor map is legitimate.
            existing_editor = {}
            print(f"  All Votes tab absent — created. No prior editor values to preserve.")
        else:
            try:
                existing_editor = read_existing_editor(ws)
            except EditorReadFailure as e:
                # ABORT BEFORE write_tab(): its clear()+update() would overwrite the
                # six editor columns with seeded/blank values — silently, because the
                # fallback writes plausible data rather than blanks. A failed read is
                # an error, never an empty tab (the PS-79/B1 shape).
                print(f"\n  !! ABORT: could not read the existing All Votes tab.\n"
                      f"     {e}\n"
                      f"     The editor columns ({', '.join(EDITOR_COLS)}) were NOT read, so\n"
                      f"     they cannot be preserved. Nothing was written — the tab is untouched.\n"
                      f"     Re-run once the Sheets API is reachable.", file=sys.stderr)
                return 1
            print(f"  All Votes tab: {len(existing_editor)} existing rows.")

    rows, effective = compute_effective(rollcall_votes, existing_editor, seed)

    if not no_sheet and not dry_run:
        write_tab(ws, rows)
        print(f"  Pushed {len(rows)} votes to the All Votes tab.")

    n_tags = apply_tags(data, effective)
    fmap, report = apply_featured(data, effective, base, org, dry_run)

    print("\n  SYNC ALL-VOTES REPORT")
    print(f"    featured votes:     {report['featured']}")
    print(f"    positions written:  {report['positions_written']}")
    print(f"    tagged votes:       {n_tags}")
    if report["skipped_no_code"]:
        print(f"    ! {report['skipped_no_code']} rows checked featured but missing a code — skipped.")

    if dry_run:
        print("  DRY RUN — no files written.")
        return 0

    with open(map_path, "w", encoding="utf-8") as f:
        json.dump(fmap, f, indent=2, default=str)
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Wrote {data_path} and {map_path}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Two-way All Votes admin tab sync.")
    ap.add_argument("--data", default="./council-data.json")
    ap.add_argument("--map", default="./featured_vote_map.json")
    ap.add_argument("--sheet-id", default=os.environ.get("SHEET_ID"))
    ap.add_argument("--creds-file")
    ap.add_argument("--base", default=IV.DEFAULT_BASE)
    ap.add_argument("--org", default=IV.DEFAULT_ORG)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-sheet", action="store_true", help="Skip Sheet I/O (testing).")
    args = ap.parse_args()
    if not args.no_sheet and not args.sheet_id:
        raise SystemExit("Missing --sheet-id (or SHEET_ID env var)")
    try:
        return run(args.data, args.map, args.sheet_id, args.creds_file,
                   args.base, args.org, args.dry_run, args.no_sheet)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
