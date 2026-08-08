#!/usr/bin/env python3
"""
ingest_sb_votes.py — the school-board votes ingest (SBVOTE-1 / HALT-SBV-B).

Mints `school-board-data.json` from two Google Sheet tabs: `SB Members` (the
roster) and `SB Votes` (wide-format positions, one column per seat). It is the
votes family's second client, not a second exception — PS-99's single-source
rule applies here exactly as it does to the council: every published position
comes from this ingest, and no position enters the artifact by hand.

READ-ONLY BY CONSTRUCTION, and that is a structural property rather than a
promise (C3.7). The only scope this program can request is
`spreadsheets.readonly`; no write verb appears anywhere in this file; it is
classified `pipeline-reader` in `check_sheet_scopes.ROLES` and both tabs are
declared in `EDITORIAL_TABS`, so a future edit that acquires a write scope or
aims a write verb at either tab fails the build rather than review.

HOME: `campaign-finance/`, beside `ingest_votes.py` and `sync_allvotes.py` —
the votes family's directory, not `ingestion/`, which is the dollars family's
(measured at SBVOTE-1 G2 §6.2).

RATIFIED PROPERTIES THIS FILE IMPLEMENTS
  D-1  The artifact stores the SEMANTIC set exactly as entered — `Affirmative`
       / `Oppositional` / `Neutral` — and the ONLY mapping applied at ingest is
       the schema rule blank cell -> `-`. Any other cell value is fatal, naming
       row and column. There is deliberately no four-value display map here:
       that map is the embed's render boundary and lands with HALT-SBV-C. An
       ingest-time translation is what would let a position silently mis-map.
  D-3  `member_id` is a pipeline-minted slug (see `mint_member_id`). `name`
       renders exactly as entered, honorifics and all. `candidacy_ref` carries
       through read-only as the deferred bridge's landing site (V4); this file
       never resolves it and never reads the elections artifact.
  D-4  A seat with no member is a real seat. `10B` is carried with a blank
       name, no minted `member_id`, and no term dates. The reader-facing
       `Vacant` label is the embed's, not the artifact's.

USAGE
    python3 ingest_sb_votes.py --sheet-id ABC123 --creds-file ./creds.json \
        --out ./school-board-data.json
    python3 ingest_sb_votes.py --self-test     # slug rule + cell vocabulary; no Sheet, no network
    python3 ingest_sb_votes.py ... --dry-run   # read, build, report; write nothing
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import re
import sys
import unicodedata

# The two source tabs. Both are human-authored and therefore EDITORIAL: declared
# in check_sheet_scopes.EDITORIAL_TABS in the same commit that ships this file.
MEMBERS_TAB = "SB Members"
VOTES_TAB = "SB Votes"

# The only scope this program may hold. Rule 2 of check_sheet_scopes fails the
# build if a pipeline-reader ever declares the write scope.
READONLY_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# `SB Members` column vocabulary, in tab order.
MEMBER_COLS = ["member_id", "name", "district/seat", "seat_type",
               "term_start", "term_end", "source_url", "candidacy_ref"]

# `SB Votes` fixed columns; everything after them is a position column keyed by seat.
VOTE_FIXED_COLS = ["code", "full", "date", "desc", "tag", "source_url"]

# D-1: the semantic set, stored as entered. `-` is the blank's stored form and is
# NOT enterable as a token — a cell either carries one of the three positions or
# is empty. Membership here is the whole of the ingest-time vocabulary check.
POSITION_TOKENS = ("Affirmative", "Oppositional", "Neutral")
BLANK_POSITION = "-"

# D-3 slug rule, stated rather than implied.
#   * honorifics are dropped — a slug carrying a title breaks when the title changes
#   * quoted nicknames are dropped — `Dr. Che "Rhymefest" Smith` -> `che-smith`
#   * bare initials are dropped — `Dr. Angel L. Velez` -> `angel-velez`
#   * generational suffixes are KEPT, punctuation stripped — `Carlos Rivas, Jr.`
#     -> `carlos-rivas-jr`; they distinguish people, so they are part of identity
#   * internal hyphens survive — `Norma Rios-Sierra` -> `norma-rios-sierra`
HONORIFICS = {"dr", "mr", "mrs", "ms", "mx", "rev", "reverend", "pastor", "fr",
              "father", "hon", "honorable", "prof", "professor", "sen", "senator",
              "rep", "representative", "ald", "alderman", "alderperson"}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}


def mint_member_id(name: str) -> str:
    """D-3: mint a member slug from a display name. Pure; no I/O.

    The bridge to a candidacy never depends on this slug — `candidacy_ref` is
    explicit — so the slug's only job is to be a stable, readable identity for a
    person whose title may change.
    """
    if not (name or "").strip():
        return ""
    # Fold accents so a later accented spelling of the same name mints the same slug.
    s = unicodedata.normalize("NFKD", name)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    # Drop quoted nicknames, straight or curly, before tokenising.
    s = re.sub(r'["“”‘’\'].*?["“”‘’\']', " ", s)
    out = []
    for raw in s.split():
        tok = re.sub(r"[^\w\s-]", "", raw, flags=re.UNICODE).strip()
        if not tok:
            continue
        low = tok.lower()
        if low in HONORIFICS:
            continue
        if len(tok.rstrip(".")) == 1 and low not in SUFFIXES:
            continue                       # a bare middle initial is not identity
        out.append(low)
    slug = "-".join(out)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug


class SourceError(Exception):
    """A fatal defect in the source tabs. Named so the caller aborts loudly."""


def _tab_sha(rows) -> str:
    """Reproduction convention of record, stated so a fresh context verifies rather
    than trusts: non-empty rows only, cells AS RETURNED (trailing empty cells
    RETAINED — stripping them yields a different digest and is a false-mismatch
    generator), tab-separated, newline-joined, UTF-8, no trailing newline.
    """
    text = "\n".join("\t".join(r) for r in rows)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _nonempty(rows):
    return [r for r in rows if any(str(c).strip() for c in r)]


def open_sheet(sheet_id: str, creds_file: str):
    """Read-only Sheet client. gspread/google-auth are imported lazily so the pure
    functions above stay importable (and testable) without the deps present.
    """
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        raise SystemExit("Missing deps. Run: pip install gspread google-auth")
    creds = Credentials.from_service_account_file(creds_file, scopes=READONLY_SCOPES)
    return gspread.authorize(creds).open_by_key(sheet_id)


def read_members(sheet):
    """Read `SB Members`. Returns (rows_as_dicts, header, sha, raw_nonempty)."""
    grid = _nonempty(sheet.worksheet(MEMBERS_TAB).get_all_values())
    if not grid:
        raise SourceError(f"{MEMBERS_TAB}: tab is empty — no header row")
    header = [c.strip() for c in grid[0]]
    if header != MEMBER_COLS:
        raise SourceError(
            f"{MEMBERS_TAB}: header {header} != expected {MEMBER_COLS}. The roster "
            f"schema is ratified; a column change is a schema decision, not a read.")
    out = []
    for n, row in enumerate(grid[1:], start=2):     # sheet row numbers; row 1 = header
        rec = {}
        for i, col in enumerate(MEMBER_COLS):
            rec[col] = (row[i].strip() if i < len(row) else "")
        rec["_row"] = n
        out.append(rec)
    return out, header, _tab_sha(grid), grid


def read_votes(sheet, seats):
    """Read `SB Votes`. Returns (votemeta, positions_by_code, header, sha, n_rows).

    `positions_by_code[code][seat]` is the stored semantic value. D-1's blank -> `-`
    is applied here and is the only mapping this function performs.
    """
    grid = _nonempty(sheet.worksheet(VOTES_TAB).get_all_values())
    if not grid:
        raise SourceError(f"{VOTES_TAB}: tab is empty — no header row")
    header = [c.strip() for c in grid[0]]
    if header[:len(VOTE_FIXED_COLS)] != VOTE_FIXED_COLS:
        raise SourceError(
            f"{VOTES_TAB}: fixed columns {header[:len(VOTE_FIXED_COLS)]} != "
            f"expected {VOTE_FIXED_COLS}")
    pos_cols = header[len(VOTE_FIXED_COLS):]
    # Referential, at the seat: the position columns and the roster's seats must be
    # the same set. The key is the SEAT, not `member_id` — under D-4 a real seat can
    # have no member and therefore no slug (the V6/D-4 reconciliation, ratified).
    missing = [s for s in seats if s not in pos_cols]
    extra = [c for c in pos_cols if c not in seats]
    if missing or extra:
        raise SourceError(
            f"{VOTES_TAB}: position columns do not match the roster's seats — "
            f"seats with no column: {missing}; columns with no seat: {extra}")

    votemeta, positions = [], {}
    seen = set()
    for n, row in enumerate(grid[1:], start=2):
        cell = lambda i: (row[i].strip() if i < len(row) else "")
        code = cell(0)
        if not code:
            raise SourceError(f"{VOTES_TAB} row {n}: blank `code` — a vote needs an id")
        if code in seen:
            raise SourceError(f"{VOTES_TAB} row {n}: duplicate code {code!r}")
        seen.add(code)
        meta = {"code": code, "full": cell(1), "date": cell(2),
                "desc": cell(3), "tag": cell(4), "source_url": cell(5),
                "vote_id": code}
        votemeta.append(meta)
        by_seat = {}
        for j, seat in enumerate(pos_cols, start=len(VOTE_FIXED_COLS)):
            v = cell(j)
            if v == "":
                by_seat[seat] = BLANK_POSITION          # D-1's ONE ingest mapping
            elif v in POSITION_TOKENS:
                by_seat[seat] = v                        # stored byte-exact, as entered
            else:
                raise SourceError(
                    f"{VOTES_TAB} row {n}, column {seat!r}: value {v!r} is not one of "
                    f"{list(POSITION_TOKENS)} and is not blank. Positions are stored as "
                    f"entered (D-1); no ingest-time translation exists to absorb this.")
        positions[code] = by_seat
    return votemeta, positions, header, _tab_sha(grid), len(grid) - 1


def build(members, votemeta, positions, members_sha, votes_sha, votes_header,
          stamp, sheet_id):
    """Assemble the artifact. Pure given its inputs."""
    seats = [m["district/seat"] for m in members]
    roster = []
    minted = {}
    for m in members:
        name = m["name"]
        mid = mint_member_id(name)
        if mid:
            if mid in minted:
                raise SourceError(
                    f"{MEMBERS_TAB} row {m['_row']}: minted member_id {mid!r} collides "
                    f"with row {minted[mid]} — two members slug to one identity")
            minted[mid] = m["_row"]
        rec = {
            "member_id": mid,                    # "" for a vacancy (D-4)
            "name": name,                        # exactly as entered (D-3)
            "seat": m["district/seat"],
            "seat_type": m["seat_type"],
            "term_start": m["term_start"],
            "term_end": m["term_end"],
            "source_url": m["source_url"],
            "candidacy_ref": m["candidacy_ref"],  # read-only landing site (V4)
            "votes": {},
        }
        for meta in votemeta:
            rec["votes"][meta["code"]] = positions[meta["code"]][rec["seat"]]
        roster.append(rec)

    votes = []
    for meta in votemeta:
        votes.append({
            "id": meta["code"],
            "date": meta["date"],
            "title": meta["full"],
            "source_url": meta["source_url"],
            "tag": meta["tag"],
            # The stringified-list shape VOTES-8 pins, matching the council artifact:
            # a real list here would change what every consumer parses.
            "type": '["board-vote"]',
            "positions": {p: positions[meta["code"]][p] for p in seats},
        })

    return {
        "schema_version": 1.0,
        # OWN NAMESPACE. This artifact has no dollars tier, so the top-level stamp is
        # the artifact's build stamp and nothing else; `rollcall.generated_at` is the
        # votes stamp. The two are never conflated (C1.15), and no shard tier exists
        # here for `validate_shard_freshness` to read.
        "generated_at": stamp,
        "source": (f"Chicago Board of Education roster and vote positions, entered from "
                   f"public Board records into the project Google Sheet "
                   f"(tabs {MEMBERS_TAB!r} and {VOTES_TAB!r}) and ingested by "
                   f"ingest_sb_votes.py. Single-source per PS-99."),
        "_sync": {
            "generated_at": stamp,
            "sheet_id": sheet_id,
            "ingest": "ingest_sb_votes.py",
            # Source provenance recorded in the artifact, so a later reader can tell
            # which tab bytes produced it without holding a lane report.
            "source_tabs": {
                MEMBERS_TAB: {"sha256": members_sha, "data_rows": len(members)},
                VOTES_TAB: {"sha256": votes_sha, "columns": len(votes_header),
                            "data_rows": len(votemeta)},
            },
            "convention": ("tab sha256: non-empty rows, cells as returned with trailing "
                           "empty cells retained, tab-separated, newline-joined, UTF-8, "
                           "no trailing newline"),
        },
        "members": roster,
        "votemeta": votemeta,
        "rollcall": {
            "generated_at": stamp,       # the VOTES stamp — the other namespace
            "source": f"{VOTES_TAB} tab, project Google Sheet",
            "term_votes": len(votes),
            "votes": votes,
        },
    }


def self_test():
    """D-3's four ratified examples as committed test cases, plus the D-1 vocabulary.

    No Sheet, no network, no artifact — pure functions only.
    """
    results = []

    def ok(name, cond):
        results.append((name, bool(cond)))
        print(f"SELF-TEST {'PASS' if cond else 'FAIL'}  {name}")

    # D-3, the four ratified examples. These are the rule's definition, not samples.
    for src, want in [('Dr. Che "Rhymefest" Smith', "che-smith"),
                      ("Pastor Emma Lozano", "emma-lozano"),
                      ("Carlos Rivas, Jr.", "carlos-rivas-jr"),
                      ("Dr. Angel L. Velez", "angel-velez")]:
        got = mint_member_id(src)
        ok(f"D-3 ratified example: {src!r} -> {want!r}" + ("" if got == want else f" (got {got!r})"),
           got == want)

    # The properties those four examples encode, stated separately so a future edit
    # that breaks one without breaking an example still fails.
    ok("D-3 internal hyphens survive (Norma Rios-Sierra)",
       mint_member_id("Norma Rios-Sierra") == "norma-rios-sierra")
    ok("D-3 a bare middle initial is dropped (Sean B. Harden)",
       mint_member_id("Sean B. Harden") == "sean-harden")
    ok("D-3 a vacancy mints no slug (blank name -> '')",
       mint_member_id("") == "" and mint_member_id("   ") == "")
    ok("D-3 accents fold (José Ruiz)", mint_member_id("José Ruiz") == "jose-ruiz")

    # D-1: the stored vocabulary is the semantic set; `-` is the blank's stored form.
    ok("D-1 vocabulary is exactly the three semantic tokens",
       POSITION_TOKENS == ("Affirmative", "Oppositional", "Neutral"))
    ok("D-1 blank's stored form is '-'", BLANK_POSITION == "-")
    ok("D-1 no display map exists in this module (the embed owns it)",
       not any(k in globals() for k in ("DISPLAY_MAP", "POSITION_DISPLAY", "RENDER_MAP")))

    bad = [n for n, good in results if not good]
    print(f"self-test: {len(results)} checks · "
          + ("ALL PASS" if not bad else f"FAILED {len(bad)}"))
    return 1 if bad else 0


def main():
    if "--self-test" in sys.argv:
        return sys.exit(self_test())

    ap = argparse.ArgumentParser()
    ap.add_argument("--sheet-id", required=True)
    ap.add_argument("--creds-file", required=True)
    ap.add_argument("--out", required=True, help="path to school-board-data.json")
    ap.add_argument("--self-test", action="store_true",
                    help="run the D-3 slug and D-1 vocabulary cases and exit; no Sheet")
    ap.add_argument("--dry-run", action="store_true",
                    help="read, build and report; write no file")
    a = ap.parse_args()

    sheet = open_sheet(a.sheet_id, a.creds_file)
    try:
        members, _mhdr, members_sha, _mgrid = read_members(sheet)
        seats = [m["district/seat"] for m in members]
        votemeta, positions, vhdr, votes_sha, nrows = read_votes(sheet, seats)
    except SourceError as e:
        print(f"[ingest_sb_votes] FATAL: {e}", file=sys.stderr)
        sys.exit(2)

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        art = build(members, votemeta, positions, members_sha, votes_sha, vhdr,
                    stamp, a.sheet_id)
    except SourceError as e:
        print(f"[ingest_sb_votes] FATAL: {e}", file=sys.stderr)
        sys.exit(2)

    print(f"[ingest_sb_votes] {MEMBERS_TAB}: {len(members)} data rows, sha {members_sha}")
    print(f"[ingest_sb_votes] {VOTES_TAB}: {len(vhdr)} columns, {nrows} data rows, "
          f"sha {votes_sha}")
    print(f"[ingest_sb_votes] minted {sum(1 for m in art['members'] if m['member_id'])} "
          f"member_id(s); {sum(1 for m in art['members'] if not m['member_id'])} vacancy")
    if a.dry_run:
        print("[ingest_sb_votes] --dry-run: nothing written")
        return 0

    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(art, fh, indent=2, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    print(f"[ingest_sb_votes] wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
