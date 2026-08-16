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

# `SB Votes` fixed columns. The header contract is STRUCTURAL, not a column count:
# these six, then the roster-derived seat set, then exactly the two named trailing
# columns below, in that order. Ratified in this form at SBV-PORT-1 G3 because
# PS-122/PS-123 pin position and presence rather than count — embedding today's
# board size as a constant would fail on correct data the day a seat is added.
VOTE_FIXED_COLS = ["code", "full", "date", "desc", "tag", "source_url"]
OUTCOME_COL = "Outcomes"          # PS-122, immediately after the last seat
FEATURED_COL = "Featured"         # PS-123, immediately after Outcomes
VOTE_TRAILING_COLS = [OUTCOME_COL, FEATURED_COL]

# The third editorial tab, OPTIONAL by ruling (PS-121): absent means no cast-by
# records, which is a valid state and not an error.
CAST_BY_TAB = "SB Cast By"
CAST_BY_COLS = ["code", "seat", "cast_by_name"]

# D-1: the semantic set, stored as entered. `-` is the blank's stored form and is
# NOT enterable as a token — a cell either carries one of the three positions or
# is empty. Membership here is the whole of the ingest-time vocabulary check.
POSITION_TOKENS = ("Affirmative", "Oppositional", "Neutral")
BLANK_POSITION = "-"

# PS-122: the outcome vocabulary is closed and blank is fatal. Unlike positions,
# there is no blank->marker mapping here — a vote without an outcome is a source
# defect, not a recordable state.
OUTCOME_TOKENS = ("Unanimous", "Split", "Unanimous with Abstentions", "Withdrawn")

# PS-123: the featured flag's source vocabulary, mirroring the council's editorial
# convention. `TRUE` or blank; anything else is fatal.
FEATURED_TRUE = "TRUE"

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
    """Read `SB Votes`. Returns (votemeta, positions_by_code, extras_by_code, header,
    sha, n_rows).

    `positions_by_code[code][seat]` is the stored semantic value. D-1's blank -> `-`
    is applied here and is the only mapping this function performs.

    `extras_by_code[code]` carries `{"outcome": str, "featured": bool}` — read here
    because the row is here, but deliberately NOT folded into `meta`: `votemeta`'s
    shape is pinned, and `build` decides which tier each value lands on.
    """
    grid = _nonempty(sheet.worksheet(VOTES_TAB).get_all_values())
    if not grid:
        raise SourceError(f"{VOTES_TAB}: tab is empty — no header row")
    header = [c.strip() for c in grid[0]]
    if header[:len(VOTE_FIXED_COLS)] != VOTE_FIXED_COLS:
        raise SourceError(
            f"{VOTES_TAB}: fixed columns {header[:len(VOTE_FIXED_COLS)]} != "
            f"expected {VOTE_FIXED_COLS}")
    # PS-122/PS-123: the two named trailing columns, in that order, both required.
    # Checked before the seat block so a misordered or missing trailing name is named
    # as itself rather than surfacing as a bogus "column with no seat".
    if len(header) < len(VOTE_FIXED_COLS) + len(VOTE_TRAILING_COLS):
        raise SourceError(
            f"{VOTES_TAB}: header has {len(header)} columns — too few to carry the six "
            f"fixed columns plus the trailing {VOTE_TRAILING_COLS}; found {header}")
    trailing = header[-len(VOTE_TRAILING_COLS):]
    if trailing != VOTE_TRAILING_COLS:
        raise SourceError(
            f"{VOTES_TAB}: the last {len(VOTE_TRAILING_COLS)} columns must be "
            f"{VOTE_TRAILING_COLS}, in that order — found {trailing}. Both are "
            f"required present (PS-122, PS-123); a missing or reordered trailing "
            f"column is not absorbed.")
    pos_cols = header[len(VOTE_FIXED_COLS):-len(VOTE_TRAILING_COLS)]
    # Referential, at the seat: the position columns and the roster's seats must be
    # the same set. The key is the SEAT, not `member_id` — under D-4 a real seat can
    # have no member and therefore no slug (the V6/D-4 reconciliation, ratified).
    # The contract is STRUCTURAL: six fixed + this roster-derived set + the two
    # trailing names. No column count is pinned.
    missing = [s for s in seats if s not in pos_cols]
    extra = [c for c in pos_cols if c not in seats]
    if missing or extra:
        raise SourceError(
            f"{VOTES_TAB}: position columns do not match the roster's seats — "
            f"seats with no column: {missing}; columns with no seat: {extra}")
    outcome_i = len(header) - 2
    featured_i = len(header) - 1

    votemeta, positions, extras = [], {}, {}
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

        # PS-122 — closed vocabulary, blank fatal. No blank->marker mapping exists
        # here by ruling: a vote with no outcome is a source defect.
        outcome = cell(outcome_i)
        if outcome not in OUTCOME_TOKENS:
            raise SourceError(
                f"{VOTES_TAB} row {n}, column {OUTCOME_COL!r}: value {outcome!r} is not "
                f"one of {list(OUTCOME_TOKENS)}. Blank is fatal (PS-122); the vocabulary "
                f"is closed and no ingest-time translation exists to absorb this.")
        # PS-123 — `TRUE` or blank, nothing else. Absent flag means not featured.
        raw_featured = cell(featured_i)
        if raw_featured not in (FEATURED_TRUE, ""):
            raise SourceError(
                f"{VOTES_TAB} row {n}, column {FEATURED_COL!r}: value {raw_featured!r} is "
                f"not {FEATURED_TRUE!r} and is not blank (PS-123).")
        extras[code] = {"outcome": outcome, "featured": raw_featured == FEATURED_TRUE}
    return votemeta, positions, extras, header, _tab_sha(grid), len(grid) - 1


def read_cast_by(sheet, votemeta, positions, seats):
    """Read the OPTIONAL `SB Cast By` tab (PS-121). Returns (by_code, sha, n_rows).

    `by_code[code][seat] = cast_by_name`. Tab absent -> (`{}`, None, 0): a valid
    state, not an error, by ruling.

    All five fatalities bind to the VOTES DATA, never to roster occupancy — the
    roster carries no time dimension and cannot express per-date vacancy, so no such
    determination is made or implied (PS-121, ratified after rev 1's occupancy clause
    proved fatal on every record of its only real case).
    """
    titles = [ws.title for ws in sheet.worksheets()]
    if CAST_BY_TAB not in titles:
        return {}, None, 0                      # absent is valid, by ruling
    grid = _nonempty(sheet.worksheet(CAST_BY_TAB).get_all_values())
    if not grid:
        raise SourceError(f"{CAST_BY_TAB}: tab is present but empty — no header row. "
                          f"Delete the tab to declare 'no cast-by records'.")
    header = [c.strip() for c in grid[0]]
    if header != CAST_BY_COLS:
        raise SourceError(
            f"{CAST_BY_TAB}: header {header} != expected {CAST_BY_COLS}")

    known_codes = {m["code"] for m in votemeta}
    seat_set = set(seats)
    by_code, seen_pairs = {}, {}
    for n, row in enumerate(grid[1:], start=2):
        cell = lambda i: (row[i].strip() if i < len(row) else "")
        code, seat, name = cell(0), cell(1), cell(2)
        # 1 — the code must exist among the votes.
        if code not in known_codes:
            raise SourceError(
                f"{CAST_BY_TAB} row {n}: code {code!r} does not exist among the "
                f"{VOTES_TAB} rows")
        # 2 — the seat must be in the roster's seat set.
        if seat not in seat_set:
            raise SourceError(
                f"{CAST_BY_TAB} row {n}: seat {seat!r} is not in the roster's seat set")
        # 3 — one record per (code, seat).
        if (code, seat) in seen_pairs:
            raise SourceError(
                f"{CAST_BY_TAB} row {n}: duplicate (code, seat) pair "
                f"({code!r}, {seat!r}) — already recorded at row {seen_pairs[(code, seat)]}")
        seen_pairs[(code, seat)] = n
        # 4 — the named vote's position cell for that seat must not be blank.
        if positions[code][seat] == BLANK_POSITION:
            raise SourceError(
                f"{CAST_BY_TAB} row {n}: the {VOTES_TAB} position cell for code {code!r}, "
                f"seat {seat!r} is blank — a cast-by record attributes a position that "
                f"was cast, so it cannot point at one that was not")
        # 5 — a full name, never initials.
        if len(name.split()) < 2:
            raise SourceError(
                f"{CAST_BY_TAB} row {n}: cast_by_name {name!r} must contain at least a "
                f"space-separated given name and surname — initials and partial names "
                f"never reach a published surface")
        by_code.setdefault(code, {})[seat] = name
    return by_code, _tab_sha(grid), len(grid) - 1


def build(members, votemeta, positions, extras, cast_by, members_sha, votes_sha,
          votes_header, cast_by_sha, cast_by_rows, stamp, sheet_id):
    """Assemble the artifact. Pure given its inputs.

    Tier placement, per the rulings rather than per convenience:
      * `outcome`   -> the ROLLCALL vote (PS-122's "each vote"), where it sits beside
                       the factual record, mirroring the council's `result`/`tally`.
      * `featured`  -> the VOTEMETA entry, named explicitly by PS-123, and emitted
                       ONLY when true — PS-123 says a flagged vote carries it, so an
                       unflagged vote carries no key rather than `featured: false`.
      * `cast_by`   -> the ROLLCALL vote, as a seat-keyed dict parallel to
                       `positions`, present only where records exist.
    The 1:1 votemeta/rollcall emission is kept deliberately (PS-123).
    """
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
        code = meta["code"]
        rec = {
            "id": code,
            "date": meta["date"],
            "title": meta["full"],
            "source_url": meta["source_url"],
            "tag": meta["tag"],
            # The stringified-list shape VOTES-8 pins, matching the council artifact:
            # a real list here would change what every consumer parses.
            "type": '["board-vote"]',
            "outcome": extras[code]["outcome"],      # PS-122
            "positions": {p: positions[code][p] for p in seats},
        }
        if code in cast_by:
            # Seat-keyed, parallel to `positions`, so the render layer resolves an
            # attribution with the same key it already uses for the position itself.
            rec["cast_by"] = {p: cast_by[code][p] for p in seats if p in cast_by[code]}
        votes.append(rec)

    # PS-123: the flag rides the votemeta entry, and only when true.
    for meta in votemeta:
        if extras[meta["code"]]["featured"]:
            meta["featured"] = True

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
            # The optional third tab appears here ONLY when it was present: an entry
            # for an absent tab would assert a source that does not exist.
            "source_tabs": dict(
                [(MEMBERS_TAB, {"sha256": members_sha, "data_rows": len(members)}),
                 (VOTES_TAB, {"sha256": votes_sha, "columns": len(votes_header),
                              "data_rows": len(votemeta)})]
                + ([(CAST_BY_TAB, {"sha256": cast_by_sha, "data_rows": cast_by_rows})]
                   if cast_by_sha is not None else [])
            ),
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

    # ---- SBV-PORT-1 G3: the header contract, outcomes, featured, cast-by --------
    # No Sheet and no network: a stub stands in for the gspread worksheet API, so
    # every fatality below is fired for real rather than reasoned about.
    class _WS:
        def __init__(self, title, grid): self.title, self._g = title, grid
        def get_all_values(self): return self._g

    class _StubSheet:
        def __init__(self, tabs): self._tabs = tabs        # {title: grid}
        def worksheets(self): return [_WS(t, g) for t, g in self._tabs.items()]
        def worksheet(self, title):
            if title not in self._tabs:
                raise KeyError(title)
            return _WS(title, self._tabs[title])

    ST_SEATS = ["1A", "1B"]

    def vgrid(header=None, body=None):
        hdr = header if header is not None else (
            VOTE_FIXED_COLS + ST_SEATS + VOTE_TRAILING_COLS)
        rows = body if body is not None else [
            ["V1", "One", "2025-01-01", "", "tagA", "u", "Affirmative", "Oppositional",
             "Split", ""],
            ["V2", "Two", "2025-02-01", "", "", "", "Affirmative", "",
             "Unanimous", "TRUE"],
        ]
        return [hdr] + rows

    def sheet_of(votes_grid, cast_grid=None):
        tabs = {VOTES_TAB: votes_grid}
        if cast_grid is not None:
            tabs[CAST_BY_TAB] = cast_grid
        return _StubSheet(tabs)

    def fatal(fn):
        """True iff fn() raises SourceError — a check that never fires is not a check."""
        try:
            fn()
            return False
        except SourceError:
            return True

    # --- the header contract, structural rather than counted --------------------
    vm, pos, ext, hdr, _s, nrows = read_votes(sheet_of(vgrid()), ST_SEATS)
    ok("G3 header: six fixed + roster seats + Outcomes + Featured is accepted",
       len(vm) == 2 and nrows == 2)
    ok("G3 header: NO column count is pinned — a different seat count still passes",
       len(read_votes(sheet_of(vgrid(
           header=VOTE_FIXED_COLS + ["1A", "1B", "1C"] + VOTE_TRAILING_COLS,
           body=[["V1", "One", "2025-01-01", "", "", "", "Affirmative", "Neutral",
                  "Affirmative", "Split", ""]])), ["1A", "1B", "1C"])[0]) == 1)
    ok("G3 header: a missing trailing column is fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(
           header=VOTE_FIXED_COLS + ST_SEATS + [OUTCOME_COL],
           body=[["V1", "O", "2025-01-01", "", "", "", "Affirmative", "Neutral",
                  "Split"]])), ST_SEATS)))
    ok("G3 header: misordered trailing columns are fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(
           header=VOTE_FIXED_COLS + ST_SEATS + [FEATURED_COL, OUTCOME_COL])), ST_SEATS)))
    ok("G3 header: an unknown column among the seats is fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(
           header=VOTE_FIXED_COLS + ST_SEATS + ["Bogus"] + VOTE_TRAILING_COLS)),
           ST_SEATS)))
    ok("G3 header: a seat with no column is still fatal",
       fatal(lambda: read_votes(sheet_of(vgrid()), ST_SEATS + ["9Z"])))

    # --- PS-122 outcomes --------------------------------------------------------
    ok("PS-122 outcome vocabulary is the four ratified values",
       OUTCOME_TOKENS == ("Unanimous", "Split", "Unanimous with Abstentions", "Withdrawn"))
    ok("PS-122 a blank outcome is fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(body=[
           ["V1", "One", "2025-01-01", "", "", "", "Affirmative", "Neutral", "", ""]])),
           ST_SEATS)))
    ok("PS-122 an out-of-vocabulary outcome is fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(body=[
           ["V1", "One", "2025-01-01", "", "", "", "Affirmative", "Neutral",
            "Passed", ""]])), ST_SEATS)))
    ok("PS-122 outcome is read per row", ext["V1"]["outcome"] == "Split"
       and ext["V2"]["outcome"] == "Unanimous")

    # --- PS-123 featured --------------------------------------------------------
    ok("PS-123 TRUE flags and blank does not",
       ext["V2"]["featured"] is True and ext["V1"]["featured"] is False)
    ok("PS-123 any other Featured value is fatal",
       fatal(lambda: read_votes(sheet_of(vgrid(body=[
           ["V1", "One", "2025-01-01", "", "", "", "Affirmative", "Neutral",
            "Split", "yes"]])), ST_SEATS)))

    # --- PS-121 cast-by ---------------------------------------------------------
    CB_OK = [CAST_BY_COLS, ["V1", "1B", "Frank Thomas"]]
    ok("PS-121 the tab is OPTIONAL — absent means no records, not an error",
       read_cast_by(sheet_of(vgrid()), vm, pos, ST_SEATS) == ({}, None, 0))
    cb, cb_sha, cb_n = read_cast_by(sheet_of(vgrid(), CB_OK), vm, pos, ST_SEATS)
    ok("PS-121 a well-formed record is carried, seat-keyed",
       cb == {"V1": {"1B": "Frank Thomas"}} and cb_n == 1 and cb_sha is not None)
    ok("PS-121 fatality 1 — a code not among the votes",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [
           CAST_BY_COLS, ["NOPE", "1B", "Frank Thomas"]]), vm, pos, ST_SEATS)))
    ok("PS-121 fatality 2 — a seat not in the roster's seat set",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [
           CAST_BY_COLS, ["V1", "9Z", "Frank Thomas"]]), vm, pos, ST_SEATS)))
    ok("PS-121 fatality 3 — a duplicate (code, seat) pair",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [
           CAST_BY_COLS, ["V1", "1B", "Frank Thomas"],
           ["V1", "1B", "Olga Bautista"]]), vm, pos, ST_SEATS)))
    ok("PS-121 fatality 4 — the named position cell is blank",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [
           CAST_BY_COLS, ["V2", "1B", "Frank Thomas"]]), vm, pos, ST_SEATS)))
    ok("PS-121 fatality 5 — initials or a partial name",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [
           CAST_BY_COLS, ["V1", "1B", "FT"]]), vm, pos, ST_SEATS)))
    ok("PS-121 a present-but-headerless cast-by tab is fatal",
       fatal(lambda: read_cast_by(sheet_of(vgrid(), [["wrong", "header", "here"]]),
                                  vm, pos, ST_SEATS)))
    ok("PS-121 roster occupancy is never consulted (no term/vacancy read in the reader)",
       not any(k in read_cast_by.__code__.co_names
               for k in ("term_start", "term_end", "candidacy_ref", "name")))

    # --- the artifact carry -----------------------------------------------------
    st_members = [{"member_id": "a-b", "name": "A B", "district/seat": "1A",
                   "seat_type": "elected", "term_start": "2025-01-01", "term_end": "",
                   "source_url": "u", "candidacy_ref": "none", "_row": 2},
                  {"member_id": "c-d", "name": "C D", "district/seat": "1B",
                   "seat_type": "appointed", "term_start": "2025-01-01", "term_end": "",
                   "source_url": "u", "candidacy_ref": "none", "_row": 3}]
    art = build(st_members, vm, pos, ext, cb, "msha", "vsha", hdr, cb_sha, cb_n,
                "2026-01-01T00:00:00Z", "SID")
    rc = {v["id"]: v for v in art["rollcall"]["votes"]}
    ok("PS-122 outcome lands on the rollcall vote",
       rc["V1"]["outcome"] == "Split" and rc["V2"]["outcome"] == "Unanimous")
    ok("PS-123 featured lands on votemeta, and ONLY when true",
       art["votemeta"][1].get("featured") is True
       and "featured" not in art["votemeta"][0])
    ok("PS-121 cast_by lands seat-keyed beside positions, only where records exist",
       rc["V1"].get("cast_by") == {"1B": "Frank Thomas"} and "cast_by" not in rc["V2"])
    ok("PS-123 the 1:1 votemeta/rollcall emission is kept",
       len(art["votemeta"]) == len(art["rollcall"]["votes"]) == 2)
    ok("_sync records the cast-by tab when present",
       art["_sync"]["source_tabs"][CAST_BY_TAB]["sha256"] == cb_sha)
    art_absent = build(st_members, vm, pos, ext, {}, "msha", "vsha", hdr, None, 0,
                       "2026-01-01T00:00:00Z", "SID")
    ok("_sync omits the cast-by tab when absent (no source asserted that does not exist)",
       CAST_BY_TAB not in art_absent["_sync"]["source_tabs"])

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
        votemeta, positions, extras, vhdr, votes_sha, nrows = read_votes(sheet, seats)
        cast_by, cast_by_sha, cast_by_rows = read_cast_by(sheet, votemeta, positions, seats)
    except SourceError as e:
        print(f"[ingest_sb_votes] FATAL: {e}", file=sys.stderr)
        sys.exit(2)

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        art = build(members, votemeta, positions, extras, cast_by, members_sha,
                    votes_sha, vhdr, cast_by_sha, cast_by_rows, stamp, a.sheet_id)
    except SourceError as e:
        print(f"[ingest_sb_votes] FATAL: {e}", file=sys.stderr)
        sys.exit(2)

    print(f"[ingest_sb_votes] {MEMBERS_TAB}: {len(members)} data rows, sha {members_sha}")
    print(f"[ingest_sb_votes] {VOTES_TAB}: {len(vhdr)} columns, {nrows} data rows, "
          f"sha {votes_sha}")
    if cast_by_sha is None:
        print(f"[ingest_sb_votes] {CAST_BY_TAB}: tab absent — no cast-by records "
              f"(valid state, PS-121)")
    else:
        print(f"[ingest_sb_votes] {CAST_BY_TAB}: {cast_by_rows} data rows, "
              f"sha {cast_by_sha}")
    print(f"[ingest_sb_votes] featured votes: "
          f"{sum(1 for m in art['votemeta'] if m.get('featured'))}")
    _oc = {}
    for v in art["rollcall"]["votes"]:
        _oc[v["outcome"]] = _oc.get(v["outcome"], 0) + 1
    print(f"[ingest_sb_votes] outcomes: "
          + ", ".join(f"{k} {_oc[k]}" for k in OUTCOME_TOKENS if k in _oc))
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
