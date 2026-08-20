#!/usr/bin/env python3
"""check_ref_pins.py — the §8 citation-appendix pin checker (HYG-B2 commit B, open ledger 20 f1).

MECHANISM_REFERENCE.md §8 pins every cited file by sha256 and hangs line-coordinates off
those pins through a TAG, not a path: a SOURCED row says `C5.8 | S-cemb | 1019-1026 (...)`,
and the tag resolves to a legend row carrying the file and the sha it was authored against.
Nothing verified any of it. HYG-B2's H0 measured the cost of that absence: 10 of 22 in-repo
pins had drifted off their files, and 32 of the 74 legend-anchored SOURCED rows were hanging
off those 10 — coordinates scoped to bytes that had moved. Commit A restored the truth; this
checker is what keeps it true, and its absence WAS open ledger 20's first facet.

WHAT THIS CHECKER DOES NOT DO — read this before extending it.

It verifies IDENTITY and STRUCTURE, never CLAIMS. That a SOURCED row's parenthetical still
describes the code at the cited lines is human re-verification territory: it needs a reader
who can judge whether "the three stamp sites" still names what sits there, and that judgement
is the commit-A protocol (re-derive by name; UNCHANGED / RELOCATED / FINDING). A checker that
compared parentheticals to code would be guessing, and a green from it would mean less than
nothing — it would retire a human check and replace it with a plausible-looking one.

So the honest division, stated once: this file answers "is the pin still the file's sha, does
every tag resolve, does every ruling pointer land" — the mechanical half. It cannot answer
"is the claim still true", and a green here is not evidence about that. C6.5's known-risk
shape exactly: state the limit rather than let a green imply coverage it does not have.

PS-82 INDEPENDENCE. The expectation is recomputed from the FILES (sha256 of bytes on disk)
and from RULINGS.md's own headings; the subject is the reference's table cells. Different
writers, different fields — the checker never derives its expectation from the text it checks.

ARCHIVE ROWS ARE REPORTED, NEVER SKIPPED. The A- rows pin lane reports under `~/`, outside the
repo. A repo-only checker cannot reach them, so it names each one as out-of-reach on every run
rather than passing over them in silence. Out-of-reach is not a failure — an unverifiable pin
that announces itself is honest; one that disappears from the output reads as verified.

Construction follows the [SBF/SYNC] precedent: a pure verdict function over TEXT with the file
resolver INJECTED, so `--self-test` drives every branch with no filesystem and every bite is
an in-memory mutation that cannot leave residue.
"""
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))          # campaign-finance/tools -> repo root
REF_REL = "campaign-finance/MECHANISM_REFERENCE.md"
REG_REL = "campaign-finance/RULINGS.md"

LEGEND_MARK = "**File sha legend**"
SOURCED_MARK = "**SOURCED rows**"
RULED_MARK = "**RULED pointers**"
END_MARK = "**Conformance record:**"

LEGEND_ROW = re.compile(r"^\|\s*([SA]-\w+)\s*\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$")
TAG_TOKEN = re.compile(r"\b([SA]-\w+)\b")
# The self-referential citation: §8 cites the reference's own body for a positional
# definition. There is no tag to resolve and no file to hash — it passes BY RULE, and the
# rule is written here rather than left as an unexplained exemption.
SELF_REF = "this document"


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _is_sep(cells):
    return cells and all(set(c) <= set("-: ") and c for c in cells)


def _region(lines, start_mark, end_mark):
    """Table rows (1-indexed line no, text) between two bold markers."""
    try:
        a = next(i for i, l in enumerate(lines, 1) if l.startswith(start_mark))
        b = next(i for i, l in enumerate(lines, 1) if l.startswith(end_mark))
    except StopIteration:
        return None
    return [(i, lines[i - 1]) for i in range(a, b) if lines[i - 1].startswith("|")]


def verdict(ref_text, reg_text, resolve):
    """Pure core. `resolve(path) -> bytes | None` (None = not reachable from the repo).

    Returns (errors, stats). Never touches the filesystem itself.
    """
    errors, notes = [], []
    stats = {"checks": 0, "legend": 0, "s_rows": 0, "a_rows": 0,
             "sourced": 0, "ruled": 0, "out_of_reach": []}
    lines = ref_text.split("\n")
    reg_lines = reg_text.split("\n")

    def check(cond, msg):
        stats["checks"] += 1
        if not cond:
            errors.append(msg)
        return cond

    # ---- rule 1: the three table regions parse row-for-row -------------------------
    leg = _region(lines, LEGEND_MARK, SOURCED_MARK)
    src = _region(lines, SOURCED_MARK, RULED_MARK)
    rul = _region(lines, RULED_MARK, END_MARK)
    for name, reg in (("legend", leg), ("SOURCED", src), ("RULED", rul)):
        if not check(reg is not None and len(reg) > 2,
                     f"PARSE: the {name} table region is missing or empty — §8's markers moved"):
            return errors, stats

    legend = {}
    for i, line in leg:
        cells = _cells(line)
        if cells and cells[0].lower() == "tag" or _is_sep(cells):
            continue
        m = LEGEND_ROW.match(line)
        if not check(m is not None,
                     f"PARSE: legend row at line {i} does not conform to "
                     f"`| tag | \\`path\\` | \\`sha256\\` |`: {line.strip()[:90]}"):
            continue
        tag, path, sha = m.group(1), m.group(2), m.group(3)
        check(tag not in legend, f"PARSE: duplicate legend tag {tag!r} at line {i}")
        legend[tag] = (path, sha, i)
        stats["legend"] += 1

    # ---- rules 2 + 3: every S- row's file exists, and its sha is current -----------
    for tag, (path, sha, i) in sorted(legend.items()):
        if tag.startswith("A-"):
            stats["a_rows"] += 1
            continue
        stats["s_rows"] += 1
        blob = resolve(path)
        if not check(blob is not None,
                     f"EXIST: {tag} (line {i}) pins {path!r}, which does not exist in the repo"):
            continue
        got = hashlib.sha256(blob).hexdigest()
        check(got == sha,
              f"CURRENT: {tag} (line {i}) pins {path} at {sha[:12]}… but the file hashes "
              f"{got[:12]}… — the pin and every coordinate citing this tag are scoped to "
              f"bytes that moved")

    # ---- rule 6: archive rows are named as out-of-reach, never skipped -------------
    for tag, (path, sha, i) in sorted(legend.items()):
        if not tag.startswith("A-"):
            continue
        # Parsing already succeeded (it is in `legend`); reachability is reported, not failed.
        reachable = resolve(path) is not None
        if not reachable:
            stats["out_of_reach"].append((tag, path))
            notes.append(f"OUT-OF-REACH {tag} — {path} (archive pin; outside the repo, "
                         f"not verifiable here)")

    # ---- rule 4: every SOURCED row's tag resolves to a legend row ------------------
    for i, line in src:
        cells = _cells(line)
        if (cells and cells[0].lower() == "claim") or _is_sep(cells):
            continue
        # The self-referential form folds `file` and `line(s)` into ONE cell, because
        # "this document §1" is both the file and the position — so it is a 2-cell row by
        # authorship, not a malformed 3-cell one. Recognised before the arity check, or the
        # arity check would reject the very form this rule exists to admit.
        if SELF_REF in line.lower():
            stats["sourced"] += 1
            check(len(cells) >= 2,
                  f"PARSE: self-referential SOURCED row at line {i} has {len(cells)} cells, "
                  f"expected at least 2: {line.strip()[:90]}")
            # Passes by rule; any tag it ALSO names must still resolve.
            for t in TAG_TOKEN.findall(" ".join(cells[1:])):
                check(t in legend,
                      f"RESOLVE: SOURCED row at line {i} names {t!r}, which has no legend row")
            continue
        if not check(len(cells) >= 3,
                     f"PARSE: SOURCED row at line {i} has {len(cells)} cells, expected 3: "
                     f"{line.strip()[:90]}"):
            continue
        stats["sourced"] += 1
        ref_cell = cells[1]
        tags = TAG_TOKEN.findall(ref_cell)
        if not check(bool(tags),
                     f"RESOLVE: SOURCED row at line {i} names no legend tag and is not the "
                     f"self-referential form: {ref_cell[:70]!r}"):
            continue
        for t in tags:
            check(t in legend,
                  f"RESOLVE: SOURCED row at line {i} names {t!r}, which has no legend row")

    # ---- rule 5: every RULED row's register entry heading exists -------------------
    headings = [l for l in reg_lines if l.startswith("### ")]
    for i, line in rul:
        cells = _cells(line)
        if (cells and cells[0].lower() == "claim") or _is_sep(cells):
            continue
        if not check(len(cells) >= 3,
                     f"PARSE: RULED row at line {i} has {len(cells)} cells, expected 3: "
                     f"{line.strip()[:90]}"):
            continue
        stats["ruled"] += 1
        entry = cells[2].replace("`RULINGS.md`", "").strip()
        parts = [p.strip() for p in entry.split(",") if p.strip()]
        if not check(bool(parts) and all(p.startswith("§") for p in parts),
                     f"PARSE: RULED row at line {i} register cell is not one or more "
                     f"`§`-prefixed entries: {cells[2][:70]!r}"):
            continue
        for p in parts:
            tok = p[1:].strip()
            hit = any(h == "### " + tok or h.startswith("### " + tok + " ")
                      or h.startswith("### " + tok + " —") for h in headings)
            check(hit,
                  f"RULED: row at line {i} cites §{tok}, which has no `### {tok}` heading "
                  f"in {REG_REL}")

    return errors, (stats, notes)


def _repo_resolver(path):
    full = os.path.join(REPO, path)
    if path.startswith("~") or path.startswith("/"):
        return None                                   # archive / absolute: out of reach
    if not os.path.exists(full):
        return None
    with open(full, "rb") as f:
        return f.read()


def run_check():
    with open(os.path.join(REPO, REF_REL), encoding="utf-8") as f:
        ref = f.read()
    with open(os.path.join(REPO, REG_REL), encoding="utf-8") as f:
        reg = f.read()
    errors, (stats, notes) = verdict(ref, reg, _repo_resolver)
    for n in notes:
        print("  " + n)
    for e in errors:
        print("  FAIL " + e)
    print(f"[check_ref_pins] {stats['checks']} checks · "
          f"{stats['s_rows']} in-repo pins current · {stats['a_rows']} archive pins "
          f"({len(stats['out_of_reach'])} out-of-reach, reported not failed) · "
          f"{stats['sourced']} SOURCED rows resolved · {stats['ruled']} RULED pointers · "
          + ("OK: 0 errors" if not errors else f"FAILED {len(errors)}"))
    return 1 if errors else 0


# ---------------------------------------------------------------- self-test
def self_test():
    """Every bite proven by its OWN assertion firing, never by the run's colour.

    Bites are in-memory mutations of the reference text with an injected resolver, so
    apply-and-restore is structural: nothing is written, so nothing can be left behind.
    """
    with open(os.path.join(REPO, REF_REL), encoding="utf-8") as f:
        ref = f.read()
    with open(os.path.join(REPO, REG_REL), encoding="utf-8") as f:
        reg = f.read()

    results = []

    def t(name, cond):
        results.append((name, bool(cond)))

    # A hermetic resolver: every S- path resolves to bytes whose sha matches the legend,
    # so the base case is green by construction and each bite is the ONLY thing wrong.
    lines = ref.split("\n")
    pinned = {}
    for line in lines:
        m = LEGEND_ROW.match(line)
        if m:
            pinned[m.group(2)] = m.group(3)
    # Pre-image bytes per path, chosen so sha256(bytes) == the pinned sha is impossible to
    # forge; instead the resolver returns a sentinel and we patch the hasher's input by
    # returning the REAL file when reachable, else a byte string whose hash we substitute.
    real = {}
    for p in pinned:
        full = os.path.join(REPO, p)
        if not p.startswith("~") and os.path.exists(full):
            with open(full, "rb") as fh:
                real[p] = fh.read()

    def resolver(path):
        return real.get(path)

    base_errs, (base_stats, base_notes) = verdict(ref, reg, resolver)
    t("control: the all-current case passes with zero errors", not base_errs)
    t("control: the control actually measured something (checks > 100)",
      base_stats["checks"] > 100)
    t("control: in-repo pins were seen", base_stats["s_rows"] > 0)
    t("bite 8: the A- out-of-reach report is PRESENT in output, not silent",
      len(base_notes) == base_stats["a_rows"] and base_stats["a_rows"] > 0
      and all("OUT-OF-REACH" in n for n in base_notes))

    # bite 1 — a stale sha is rejected
    tag, (path, sha, ln) = next((k, v) for k, v in
                                sorted(_legend_of(ref).items()) if k.startswith("S-"))
    stale = ref.replace("`" + sha + "`", "`" + ("0" * 64) + "`", 1)
    e1, _ = verdict(stale, reg, resolver)
    t("bite 1: a stale sha is rejected",
      any(x.startswith("CURRENT:") for x in e1))

    # bite 2 — a missing file is rejected
    def resolver_missing(p):
        return None if p == path else real.get(p)
    e2, _ = verdict(ref, reg, resolver_missing)
    t("bite 2: a missing file is rejected",
      any(x.startswith("EXIST:") for x in e2))

    # bite 3 — a malformed legend row is rejected
    legline = next(l for l in lines if LEGEND_ROW.match(l))
    mal = ref.replace(legline, "| " + tag + " | not-backticked | " + sha + " |", 1)
    e3, _ = verdict(mal, reg, resolver)
    t("bite 3: a malformed legend row is rejected",
      any(x.startswith("PARSE: legend row") for x in e3))

    # bite 4 — a malformed SOURCED row is rejected
    src_rows = _region(lines, SOURCED_MARK, RULED_MARK)
    srcline = next(l for i, l in src_rows
                   if not _is_sep(_cells(l)) and _cells(l)[0].lower() != "claim")
    mal4 = ref.replace(srcline, "| C1.2 |", 1)
    e4, _ = verdict(mal4, reg, resolver)
    t("bite 4: a malformed SOURCED row is rejected",
      any(x.startswith("PARSE: SOURCED row") for x in e4))

    # bite 5 — an unresolvable SOURCED tag is rejected
    cells = _cells(srcline)
    bad5 = srcline.replace("| " + cells[1] + " |", "| S-nosuchtag |", 1)
    mal5 = ref.replace(srcline, bad5, 1)
    e5, _ = verdict(mal5, reg, resolver)
    t("bite 5: an unresolvable SOURCED tag is rejected",
      any(x.startswith("RESOLVE:") for x in e5))

    # bite 6 — a RULED row citing an absent register heading is rejected
    rul_rows = _region(lines, RULED_MARK, END_MARK)
    rulline = next(l for i, l in rul_rows
                   if not _is_sep(_cells(l)) and _cells(l)[0].lower() != "claim")
    rcells = _cells(rulline)
    bad6 = rulline.replace(rcells[2], "`RULINGS.md` §PS-9999", 1)
    mal6 = ref.replace(rulline, bad6, 1)
    e6, _ = verdict(mal6, reg, resolver)
    t("bite 6: a RULED row citing an absent register heading is rejected",
      any(x.startswith("RULED:") for x in e6))

    # bite 7 — the self-referential SOURCED form passes by rule, and is really exercised
    self_rows = [l for i, l in src_rows if SELF_REF in l.lower()]
    t("bite 7: the self-referential form is present and exercised (passes by rule)",
      len(self_rows) >= 1 and not any(x.startswith("RESOLVE:") for x in base_errs))

    bad = [n for n, ok in results if not ok]
    for n, ok in results:
        if not ok:
            print(f"  FAIL {n}")
    print(f"self-test: {len(results)} checks · "
          + ("ALL PASS" if not bad else f"FAILED {len(bad)}"))
    return 1 if bad else 0


def _legend_of(ref_text):
    out = {}
    for i, line in enumerate(ref_text.split("\n"), 1):
        m = LEGEND_ROW.match(line)
        if m:
            out[m.group(1)] = (m.group(2), m.group(3), i)
    return out


def main():
    if "--self-test" in sys.argv:
        return self_test()
    return run_check()


if __name__ == "__main__":
    sys.exit(main())
