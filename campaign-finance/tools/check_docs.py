#!/usr/bin/env python3
"""check_docs.py — the PS-73 docs-form checker (built at DOCS-M4).

Three rules, one script, docs-only, no external state (RULINGS.md §PS-73):

  1. STRUCTURAL — every RULED pointer cell in MECHANISM_REFERENCE.md §8 matches the
     PS-71 shape: ruling id + register entry, nothing else. Structural, not lexical.
  2. LEXICAL — §8's UNVERIFIED register carries no forward-looking status language;
     `gap` and `deferred-by-design` are allowlisted as exact tokens (PS-42 class names).
  3. PATH EXISTENCE — a backticked path named in any tracked markdown document exists
     on disk. Boundary per the DOCS-M4 G1 ruling: backtick code-spans only; URLs,
     `~`-anchored, absolute, glob/placeholder tokens out; `../` out-of-repo relatives
     reported as a class, not failed; RULINGS.md quoted blocks and provenance lines
     out by construction; basename-index resolutions reported as weak-passes.
  4. [REG/PS-N] ID RESOLUTION (REGISTER-COHORT-1) — every `PS-N` id cited in either
     authority document's OWN VOICE resolves to a `### PS-N` register heading. Under
     PS-87 a ruling in force belongs in the register; a citation that resolves nowhere
     is a rule governing work the work cannot see. Boundary, and it is narrower than
     rule 3's: only RULINGS.md's **verbatim quoted blocks** are exempt — provenance
     lines, headings, prose, and the whole reference stay in scope. Quoted ruling text
     is a historical record transferred verbatim (the D8 convention), not the register
     asserting a pointer; holding it to current resolution would make faithful
     transcription impossible, and every residual at this rule's landing was of exactly
     that kind. Own known-failures file, pinned at ZERO.

Semantics: HARD-FAIL (ruled with PS-73). Pre-existing failures live in the committed
known-failures file beside this script — dated, owner-named, SHRINK-ONLY (growth fails
in code: entry count may never exceed the file's pinned max_entries; a listed entry
that no longer fails also fails, demanding removal). The known count is printed every
run so its trend is visible.

Invoked by build_all.sh's validation gate and by elections/embed/tools/gate_bundle.js
(one implementation, two invokers). `--self-test` proves each rule fires on a
synthetic violation — a check never observed failing is not known to work.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))          # campaign-finance/tools -> repo root
KNOWN_PATH = os.path.join(HERE, "docs_check_known_failures.json")
REG_KNOWN_PATH = os.path.join(HERE, "reg_check_known_failures.json")

REF_REL = "campaign-finance/MECHANISM_REFERENCE.md"
REG_REL = "campaign-finance/RULINGS.md"

# Ruling ids that must NEVER be allocated in RULINGS.md (REFRESH-1, 2026-08-07).
# `PS-9999` is this self-test's "id that resolves to nothing": rule 1's
# does-not-resolve fixture and all four rule-4 fixtures below depend on it having
# no `### PS-9999` heading, in order to prove those rules can fail at all.
# Allocating it would silently convert those fixtures into passes-by-accident.
#
# Home note: this reservation cannot live in RULINGS.md, because naming the token
# in the register's own voice is itself a rule-4 violation — the checker adjudicated
# its own documentation's placement. `PS-99` carries no such dependency and was
# allocated normally; the distinction was measured, not assumed.
RESERVED_RULING_IDS = ("PS-9999",)

# Rule 1 — the ruling-cell grammar. Seven shapes, enumerated: six ratifications took
# no PS id (historical form, not retrofitted — G1 §6; P1D-PERSON's display-decisions
# entry added per its G3 authorization §3, the register-expansion ruling; EXCL-UNIFORM
# G1 added at LEDGER-0 per D7, the ratified C5.8-strings pointer row).
#
# THIS IS THE DOCUMENTED EXTENSION POINT, and extending it is legitimate and expected
# when a new id-less entry lands — see RULINGS.md §PS-88, which rules the three
# conditions: extend here, in the same commit as the entry it admits, flagged in the
# gate report rather than made silently. History to date: one creation (DOCS-M4) and
# two extensions (P1D-PERSON; LEDGER-0 D7), both flagged-deliberate at their gates.
RULING_CELL = re.compile(
    r"^(PS-\d+( rev \d+)?( / PS-\d+)*"
    r"|discipline \d+"
    r"|SCOPE-PIPE G1 §\d+"
    r"|SCOPE-UI G1/G3"
    r"|P1D-PERSON G1/G2"
    r"|EXCL-UNIFORM G1"
    r"|DOCS-M1 \(no id\))$")
RECORD_CELL = re.compile(r"^`RULINGS\.md` §[^|]+$")

# Rule 2 — forward-looking status phrases (PS-73's list, verbatim).
PHRASES = [r"resolves at", r"resolves in", r"\bpending\b", r"\bwill\b", r"\bscheduled\b",
           r"not yet", r"\bforthcoming\b", r"\bexpected\b", r"\bTBD\b", r"once .*? lands"]
ALLOW_TOKENS = ["deferred-by-design", "gap"]   # PS-42 class names, exact tokens

# Rule 3 — boundary constants.
EXTS = r"\.(py|sh|md|json|js|html|csv|yaml|yml|txt)$"
PATH_ALLOWLIST = {"MEMORY.md"}                  # named external by the reference's header
TLD = re.compile(r"^[\w.-]+\.(com|org|net|gov|io|edu)(/|$)", re.I)


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return f.read().split("\n")


# ---------------------------------------------------------------- rule 1
def rule1(ref_lines, reg_lines):
    """Returns (failures, rows_checked). Structural: grammar + register-heading resolution."""
    fails, rows = [], 0
    try:
        start = next(i for i, l in enumerate(ref_lines) if l.startswith("**RULED pointers**"))
    except StopIteration:
        return (["RULED-pointers marker not found in the reference"], 0)
    heads = {m.group(1) for l in reg_lines for m in [re.match(r"^### (.+)$", l)] if m}

    def resolves(target):
        t = target.strip().lstrip("§").strip()
        return any(h == t or h.startswith(t + " ") for h in heads)

    in_table = False
    for i in range(start, len(ref_lines)):
        l = ref_lines[i]
        if l.startswith("|"):
            if re.match(r"^\|\s*-+", l) or re.match(r"^\|\s*claim\s*\|", l):
                in_table = True
                continue
            cells = [c.strip() for c in l.strip().strip("|").split("|")]
            if len(cells) != 3:
                fails.append(f"ref line {i+1}: RULED row does not have exactly 3 cells")
                continue
            rows += 1
            claim, ruling, record = cells
            if not RULING_CELL.match(ruling):
                fails.append(f"ref line {i+1} [{claim}]: ruling cell is not id-shaped: {ruling!r}")
            if not RECORD_CELL.match(record):
                fails.append(f"ref line {i+1} [{claim}]: record cell is not a register pointer: {record!r}")
            else:
                for t in record.replace("`RULINGS.md`", "").split(","):
                    if t.strip() and not resolves(t):
                        fails.append(f"ref line {i+1} [{claim}]: register target does not resolve: {t.strip()!r}")
        elif in_table and not l.strip():
            break
    return fails, rows


# ---------------------------------------------------------------- rule 2
def rule2(ref_lines):
    """Returns failures. Scans exactly §8's UNVERIFIED register paragraph."""
    fails = []
    try:
        start = next(i for i, l in enumerate(ref_lines) if l.startswith("**UNVERIFIED register:**"))
    except StopIteration:
        return ["UNVERIFIED-register marker not found in the reference"]
    i = start
    while i < len(ref_lines) and ref_lines[i].strip():
        scrub = ref_lines[i]
        for tok in ALLOW_TOKENS:                       # exact allowlisted tokens removed first
            scrub = scrub.replace(tok, " ")
        for p in PHRASES:
            if re.search(p, scrub, re.I):
                fails.append(f"ref line {i+1}: forward-looking phrase {p!r} in UNVERIFIED register")
        i += 1
    return fails


# ---------------------------------------------------------------- rule 3
def md_files():
    out = subprocess.run(["git", "ls-files", "*.md"], cwd=REPO,
                         capture_output=True, text=True, check=True).stdout.split()
    return out


def basename_index(tracked):
    idx = {}
    for f in tracked:
        idx.setdefault(os.path.basename(f), []).append(f)
    return idx


def tokens_of(line):
    for m in re.finditer(r"`([^`\n]+)`", line):
        tok = m.group(1).strip()
        if " " in tok or not tok:
            continue
        yield tok


def classify_token(tok):
    """Return None to skip, else the token normalized for existence checking."""
    t = tok.split(":")[0].rstrip(".,;")               # strip :line suffixes / punctuation
    if not t:
        return None
    if re.match(r"https?://", t) or TLD.match(t):
        return None                                    # URLs / bare domains
    if t.startswith("~") or t.startswith("/"):
        return None                                    # tilde / absolute: out of scope
    if re.search(r"[*?{}<>\[\]]|\.\.\.", t):
        return None                                    # globs / placeholders / ellipses
    if t in PATH_ALLOWLIST:
        return None
    if re.match(r"^\.\w+$", t):
        return None                                    # bare extension / dotfile shape, no path
    has_ext = re.search(EXTS, t)
    if "/" not in t and not has_ext:
        return None
    if "/" in t and not has_ext:
        first = t.split("/")[0]
        if first != ".." and not os.path.isdir(os.path.join(REPO, first)):
            return None                                # word-pairs like slice1/slice2
    return t


def resolve_basename(t, bidx, tracked):
    """Rule 3's fallback, as a PURE decision so the self-test can bite it directly.

    Returns ('ambiguous', hits) | ('weak', [hit]) | ('unresolved', []).

    AMBIGUITY IS A FAILURE, NOT A WEAK PASS (HYG-B2 item 26, ratified fail-not-warn).
    The direct-basename branch used to take `hits[0]` with no length guard while the
    suffix branch below already required exactly one hit — so a citation whose basename
    was shared by several tracked files bound silently to whichever `git ls-files`
    happened to list first, and reported that binding as a WEAK-PASS a reader would scan
    past. The index's ordering is not the document's intent. A shared basename now fails
    and names every candidate, so the citing document has to say which file it means.

    Single-hit basenames are unchanged: still a resolution, still reported WEAK-PASS.
    """
    base = os.path.basename(t)
    hits = bidx.get(base, [])
    if len(hits) > 1:
        return "ambiguous", sorted(hits)
    if not hits and "/" not in t:                      # unique suffix match, reported weak
        h = [x for x in tracked if os.path.basename(x).endswith(base)]
        hits = h if len(h) == 1 else []
    return ("weak", hits) if hits else ("unresolved", [])


def rule3(known):
    """Returns (failures, stats). Checks tracked markdown; RULINGS.md quoted blocks and
    provenance lines are out by construction."""
    tracked = subprocess.run(["git", "ls-files"], cwd=REPO,
                             capture_output=True, text=True, check=True).stdout.split()
    bidx = basename_index(tracked)
    known_keys = {(e["file"], e["token"]) for e in known["entries"]}
    seen_known, fails = set(), []
    stats = {"files": 0, "tokens": 0, "weak": [], "outrepo": [], "known_hits": 0}

    for f in md_files():
        stats["files"] += 1
        p = os.path.join(REPO, f)
        fdir = os.path.dirname(p)
        is_reg = f == REG_REL
        for i, line in enumerate(read_lines(p), 1):
            if is_reg and (line.startswith(">") or line.lstrip().startswith("*Provenance")):
                continue
            for raw in tokens_of(line):
                t = classify_token(raw)
                if t is None:
                    continue
                stats["tokens"] += 1
                if t.startswith("../"):
                    stats["outrepo"].append(f"{f}:{i}: {t}")
                    continue
                if (os.path.exists(os.path.join(REPO, t))
                        or os.path.exists(os.path.join(fdir, t))):
                    continue
                kind, hits = resolve_basename(t, bidx, tracked)
                if kind == "ambiguous":
                    fails.append(f"{f}:{i}: ambiguous basename {t!r} — {len(hits)} tracked "
                                 f"files share it ({', '.join(hits)}); cite the full path so "
                                 f"the referent is the document's, not the index's ordering")
                    continue
                if kind == "weak":
                    stats["weak"].append(f"{f}:{i}: {t} -> {hits[0]}")
                    continue
                if (f, t) in known_keys:
                    seen_known.add((f, t))
                    stats["known_hits"] += 1
                    continue
                fails.append(f"{f}:{i}: missing path {t!r}")

    for e in known["entries"]:                         # a listed entry must still fail
        if (e["file"], e["token"]) not in seen_known:
            fails.append(f"known-failures entry no longer fails — remove it (shrink): "
                         f"{e['file']} :: {e['token']}")
    return fails, stats


# ---------------------------------------------------------------- rule 4
def rule4(ref_lines, reg_lines, known):
    """[REG/PS-N] Returns (failures, stats). Every PS-N id cited in either authority
    document's own voice resolves to a '### PS-N' register heading (PS-87). Only the
    register's verbatim quoted blocks are exempt — see the module docstring."""
    headed = {int(m.group(1)) for m in
              (re.match(r"^### PS-(\d+)", l) for l in reg_lines) if m}
    cited = {}                                    # id -> first "doc:line" citing it
    for label, lines, skip_quotes in (("RULINGS.md", reg_lines, True),
                                      ("MECHANISM_REFERENCE.md", ref_lines, False)):
        for i, l in enumerate(lines, 1):
            if skip_quotes and l.startswith(">"):
                continue                          # verbatim quoted ruling text
            for tok in re.findall(r"\bPS-(\d+)\b", l):
                cited.setdefault(int(tok), f"{label}:{i}")
    known_keys = {e["token"] for e in known["entries"]}
    seen_known, fails = set(), []
    for i in sorted(cited):
        if i in headed:
            continue
        tok = f"PS-{i}"
        if tok in known_keys:
            seen_known.add(tok)
            continue
        fails.append(f"[REG/PS-N] {tok} is cited at {cited[i]} and resolves to no "
                     f"'### {tok}' heading in campaign-finance/RULINGS.md (PS-87)")
    for e in known["entries"]:                    # a listed entry must still fail
        if e["token"] not in seen_known:
            fails.append(f"[REG/PS-N] known-failures entry no longer fails — remove it "
                         f"(shrink): {e['token']}")
    return fails, {"cited": len(cited), "headed": len(headed), "known_hits": len(seen_known)}


def load_known(path=KNOWN_PATH):
    with open(path, encoding="utf-8") as f:
        k = json.load(f)
    fails = []
    # THE CEILING IS AN EQUALITY, NOT A MAXIMUM (HYG-B2 item 28, ratified).
    # `>` alone let the pin drift above the count: discharge one entry without lowering
    # max_entries and a slot of headroom stays open, into which a DIFFERENT violation can
    # later be appended without ever tripping "GREW". Shrink-only then means shrink-only in
    # entries but not in the pin, which is not the property the discipline claims. Equality
    # closes it — the pin must be lowered by the same commit that removes the entry.
    # Two failure names, because the causes differ and demand different responses.
    if len(k["entries"]) > k["max_entries"]:
        fails.append(f"known-failures file GREW: {len(k['entries'])} entries > pinned "
                     f"max_entries {k['max_entries']} — shrink-only is enforced; a new "
                     f"violation cannot be silenced by appending here")
    elif k["max_entries"] != len(k["entries"]):
        fails.append(f"known-failures RATCHET: max_entries {k['max_entries']} exceeds the "
                     f"entry count {len(k['entries'])} — shrink the pin with the fix, or the "
                     f"headroom silently readmits a different violation later")
    for e in k["entries"]:
        if not e.get("owner"):
            fails.append(f"known-failures entry has no owning lane: {e.get('file')} :: {e.get('token')}")
    return k, fails


# ---------------------------------------------------------------- main / self-test
def run_check():
    ref = read_lines(os.path.join(REPO, REF_REL))
    reg = read_lines(os.path.join(REPO, REG_REL))
    known, kfails = load_known()
    regknown, regkfails = load_known(REG_KNOWN_PATH)

    r1, rows = rule1(ref, reg)
    r2 = rule2(ref)
    r3, stats = rule3(known)
    r4, s4 = rule4(ref, reg, regknown)

    print(f"check_docs (PS-73): rule1 rows={rows} fails={len(r1)} | "
          f"rule2 fails={len(r2)} | rule3 files={stats['files']} tokens={stats['tokens']} "
          f"fails={len(r3)} | rule4 ids={s4['cited']} headed={s4['headed']} fails={len(r4)}")
    print(f"  [REG/PS-N] known-failures: {s4['known_hits']} hit(s) across "
          f"{len(regknown['entries'])} entries (shrink-only, pinned max "
          f"{regknown['max_entries']})")
    print(f"  known-failures: {stats['known_hits']} site-hits across "
          f"{len(known['entries'])} entries (shrink-only; all owned) | "
          f"weak-passes: {len(stats['weak'])} | out-of-repo refs (reported, not failed): "
          f"{len(stats['outrepo'])}")
    for w in stats["weak"]:
        print(f"  WEAK-PASS {w}")
    for o in stats["outrepo"]:
        print(f"  OUT-OF-REPO {o}")
    all_fails = kfails + regkfails + r1 + r2 + r3 + r4
    for x in all_fails:
        print(f"  FAIL {x}")
    print(f"check_docs: {'FAILED ' + str(len(all_fails)) if all_fails else 'ALL GREEN'}")
    return 1 if all_fails else 0


def self_test():
    """Each rule observed failing on a synthetic violation, and the negatives proven."""
    n, bad = 0, 0

    def t(name, cond):
        nonlocal n, bad
        n += 1
        if not cond:
            bad += 1
        print(("SELF-TEST PASS  " if cond else "SELF-TEST FAIL  ") + name)

    reg = read_lines(os.path.join(REPO, REG_REL))
    mk_ref = lambda row: ["**RULED pointers** (x):", "", "| claim | ruling | register entry |",
                          "|---|---|---|", row, ""]

    # rule 1: prose in the ruling cell that contains NO rule-2 phrase must still fail —
    # the structural-not-lexical proof PS-73 ruled.
    f, _ = rule1(mk_ref("| C9.9 | PS-99 recorded during the merge window | `RULINGS.md` §PS-99 |"), reg)
    t("rule1 fires on prose-shaped ruling cell with no flagged word", len(f) >= 1)
    f, _ = rule1(mk_ref("| C9.9 | PS-99 | `RULINGS.md` §PS-9999 |"), reg)
    t("rule1 fires on register target that does not resolve", len(f) == 1)
    f, _ = rule1(mk_ref("| C1.1 | PS-25 / PS-44 | `RULINGS.md` §PS-25, §PS-44 |"), reg)
    t("rule1 passes a conformant row", len(f) == 0)

    # rule 2: fires on a genuine forward-looking phrase; allowlist does not fire.
    f = rule2(["**UNVERIFIED register:** C9.9 — resolves at rev F.", ""])
    t("rule2 fires on forward-looking phrase", len(f) == 1)
    f = rule2(["**UNVERIFIED register:** C4.3 — *deferred-by-design*; C7.5 — *gap*.", ""])
    t("rule2 silent on allowlisted class names", len(f) == 0)

    # rule 3 boundary: in-boundary missing fires; out-of-boundary classes do not.
    t("rule3 boundary: in-boundary missing token classifies for checking",
      classify_token("campaign-finance/does_not_exist_xyz.py") is not None)
    t("rule3 boundary: unbackticked word-pair never reaches tokens_of",
      list(tokens_of("prose support/opposition prose")) == [])
    t("rule3 boundary: backticked word-pair without extension is skipped",
      classify_token("slice1/slice2") is None)
    t("rule3 boundary: tilde path is out of scope", classify_token("~/Desktop/work.csv") is None)
    t("rule3 boundary: URL/domain is out of scope",
      classify_token("raw.githubusercontent.com/x/y/main/z.json") is None)
    t("rule3 boundary: MEMORY.md allowlisted as named-external", classify_token("MEMORY.md") is None)
    t("rule3 boundary: ../ classifies as checkable (reported class)",
      classify_token("../ipg-rep-finder/index.html") is not None)

    # rule 4: fires on an own-voice citation with no heading; silent on quoted text.
    EMPTY = {"entries": []}
    f, _ = rule4(["prose citing PS-9999 in the reference"], ["### PS-1 — x"], EMPTY)
    t("rule4 fires on an own-voice citation with no register heading", len(f) == 1)
    f, _ = rule4([], ["### PS-1 — x", "> quoted historical text citing PS-9999"], EMPTY)
    t("rule4 silent on a citation inside a register quoted block (D8 verbatim transfer)", len(f) == 0)
    f, _ = rule4([], ["### PS-1 — x", "*Provenance: see PS-9999.*"], EMPTY)
    t("rule4 fires on a provenance-line citation — narrower boundary than rule 3", len(f) == 1)
    f, _ = rule4([], ["### PS-1 — x", "prose citing PS-1"], EMPTY)
    t("rule4 passes when every cited id resolves", len(f) == 0)
    f, _ = rule4([], ["### PS-1 — x"], {"entries": [{"token": "PS-9999", "owner": "X"}]})
    t("rule4 shrink: a known-failures entry that no longer fails must be removed", len(f) == 1)

    # shrink-only: growth fails in code.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump({"created": "2026-08-04", "max_entries": 1, "entries": [
            {"file": "a.md", "token": "x.py", "owner": "DOCS-M2", "dated": "2026-08-04"},
            {"file": "b.md", "token": "y.py", "owner": "DOCS-M2", "dated": "2026-08-04"}]}, tf)
        tmp = tf.name
    _, kf = load_known(tmp)
    os.unlink(tmp)
    t("shrink-only: appended entry beyond pinned max fails", any("GREW" in x for x in kf))
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        # max_entries EQUALS the count here so this fixture trips the owner rule ALONE —
        # under item 28's equality ratchet the old 2-for-1 pin would also raise RATCHET,
        # and a fixture that fires two rules proves neither one cleanly.
        json.dump({"created": "2026-08-04", "max_entries": 1, "entries": [
            {"file": "a.md", "token": "x.py", "dated": "2026-08-04"}]}, tf)
        tmp = tf.name
    _, kf = load_known(tmp)
    os.unlink(tmp)
    t("owner required: entry without owning lane fails", any("no owning lane" in x for x in kf))

    # item 26 — the ambiguity guard, bitten on the pure fallback decision.
    BIDX = {"README.md": ["README.md", "campaign-finance/elections/README.md"],
            "solo.py": ["campaign-finance/tools/solo.py"]}
    TRACKED = ["README.md", "campaign-finance/elections/README.md",
               "campaign-finance/tools/solo.py"]
    kind, hits = resolve_basename("README.md", BIDX, TRACKED)
    t("item26: a two-hit basename is REJECTED as ambiguous, not weak-passed",
      kind == "ambiguous" and len(hits) == 2)
    t("item26: the rejection names EVERY hit, so the citing document can choose",
      hits == ["README.md", "campaign-finance/elections/README.md"])
    kind, hits = resolve_basename("solo.py", BIDX, TRACKED)
    t("item26: a one-hit basename still WEAK-PASSes (unchanged behaviour)",
      kind == "weak" and hits == ["campaign-finance/tools/solo.py"])
    kind, hits = resolve_basename("campaign-finance/nope_xyz.py", BIDX, TRACKED)
    t("item26: an unresolvable token is still unresolved (falls through to known-failures)",
      kind == "unresolved" and hits == [])

    # item 28 — the equality ratchet, both directions, GREW text preserved.
    def _kf(max_entries, n):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf2:
            json.dump({"created": "2026-08-04", "max_entries": max_entries,
                       "entries": [{"file": f"{j}.md", "token": f"{j}.py",
                                    "owner": "DOCS-M2", "dated": "2026-08-04"}
                                   for j in range(n)]}, tf2)
            nm = tf2.name
        _, out = load_known(nm)
        os.unlink(nm)
        return out
    t("item28: max_entries ABOVE the entry count is rejected (RATCHET)",
      any("RATCHET" in x for x in _kf(3, 1)))
    t("item28: max_entries BELOW the entry count keeps the GREW text",
      any("GREW" in x for x in _kf(1, 3)))
    t("item28: equality passes", _kf(2, 2) == [])

    print(f"self-test: {n} checks · " + ("ALL PASS" if not bad else f"FAILED {bad}"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv else run_check())
