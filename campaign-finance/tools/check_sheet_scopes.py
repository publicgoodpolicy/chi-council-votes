#!/usr/bin/env python3
"""
check_sheet_scopes.py — EDIT-SAFE-1/S2. No-editorial-writeback, made assertable.

WHAT THIS PROTECTS
------------------
The pipeline cannot overwrite a human-edited editorial cell, and the guarantee is
STRUCTURAL rather than conventional: the two sync programs that read the editorial
tabs hold a `spreadsheets.readonly` credential, so a future code change adding a
write would fail at the API — and the one pipeline program that does hold a write
scope (`sync_allvotes.py`) targets a tab DISJOINT from every editorial tab.

That is a property the project already has and would not notice losing. This check
converts it into one that survives a future edit.

SCOPE — pipeline programs, with the editor app named as the deliberate exception.
The editor app (`editor/serve.py` + `editor/write_overrides.py`) IS an editorial
writer, by design: it is the human write path this invariant exists to protect.
It is therefore ALLOWLISTED BY NAME rather than skipped by pattern, so that a
SECOND editorial writer — the thing that would actually be dangerous — still fails.

RULES (static, AST + literal analysis; no network, no Sheet, no credentials)
  1. Every Sheet-touching file in the repo is CLASSIFIED below. A new one fails
     until someone classifies it. This is what stops the check being outflanked.
  2. A program classified `pipeline-reader` declares no write scope.
  3. A program classified `pipeline-writer` names no editorial tab.
  4. No pipeline program calls a Sheet write verb while naming an editorial tab.
  5. The editorial-writer allowlist is exactly the editor app. A second entry, or
     any unlisted program that both names an editorial tab and holds a write verb,
     is the finding.
  6. Every Sheet tab name referenced by a pipeline program is declared either
     editorial or non-editorial. An undeclared tab fails, so a new tab has to be
     classified deliberately rather than inheriting whichever default is convenient.

Hard-fail, matching `check_docs.py` (PS-73). `--self-test` fires every rule on a
synthetic violation — a check never observed failing is not known to work.
"""
from __future__ import annotations
import ast
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))          # repo root
CF = os.path.join(REPO, "campaign-finance")

# --- the Sheet tab vocabulary -------------------------------------------------
# Human-authored tabs. The pipeline READS these and must never write them.
EDITORIAL_TABS = {
    "Donor Overrides", "Committee Tags", "Donor Merges", "Donor Clusters",
    "Person Links", "Industry Tags", "Flag Types", "Entity Types", "Alder Bios",
}
# Machine-owned tabs. sync_allvotes clears+rewrites this one by design; its six
# editor columns are protected by EDIT-SAFE-1/S1's fail-loud read, not by scope.
NON_EDITORIAL_TABS = {"All Votes"}

# --- program classification ---------------------------------------------------
# Paths are repo-relative. Roles:
#   pipeline-reader  — canonical-chain program, read-only scope, reads editorial tabs
#   pipeline-writer  — canonical-chain program holding a write scope; editorial-tab-free
#   editor-app       — the allowlisted human editorial write path (rule 5)
#   no-sheet-access  — names Sheet vocabulary (in prose, a lazy import, or as
#                      analysis data) but performs no Sheet I/O of any kind
ROLES = {
    "campaign-finance/sheets-sync/sync_overrides.py": "pipeline-reader",
    "campaign-finance/sheets-sync/sync_bios.py":      "pipeline-reader",
    "campaign-finance/sync_allvotes.py":              "pipeline-writer",
    "campaign-finance/editor/write_overrides.py":     "editor-app",
    "campaign-finance/editor/serve.py":               "editor-app",
    "campaign-finance/editor/compose.py":             "no-sheet-access",
    # This checker itself: it carries the scope strings and every tab name as
    # ANALYSIS DATA, which is exactly what rule 1's discovery marker looks for.
    # Classified rather than pattern-skipped, so the by-name discipline holds
    # for the checker too — rule 1 caught it on its first run, as designed.
    "campaign-finance/tools/check_sheet_scopes.py":   "no-sheet-access",
}
PIPELINE_ROLES = {"pipeline-reader", "pipeline-writer"}
EDITOR_APP_ALLOWLIST = {
    "campaign-finance/editor/write_overrides.py",
    "campaign-finance/editor/serve.py",
}

WRITE_VERBS = {"clear", "update", "append_row", "append_rows",
               "batch_update", "add_worksheet", "delete_rows", "insert_row"}
READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets"

# Discovery markers: what makes a file "Sheet-touching" at all.
SHEET_MARKERS = ("gspread", "auth/spreadsheets", ".worksheet(")


# ---------------------------------------------------------------------------
def discover(root=None):
    """Repo-relative paths of every .py file that references the Sheet API."""
    root = root or REPO
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in (".git", "node_modules", "__pycache__", "venv")]
        for fn in filenames:
            if not fn.endswith(".py"):
                continue
            full = os.path.join(dirpath, fn)
            try:
                src = open(full, encoding="utf-8").read()
            except Exception:
                continue
            if any(m in src for m in SHEET_MARKERS):
                found.append(os.path.relpath(full, root))
    return sorted(found)


def analyse(path, root=None):
    """Static facts about one file: scopes declared, tabs named, write verbs called."""
    root = root or REPO
    src = open(os.path.join(root, path), encoding="utf-8").read()
    tree = ast.parse(src)

    strings = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.add(node.value)

    # A write scope is the bare spreadsheets scope; readonly is a different string.
    scopes = {s for s in strings if s.startswith(WRITE_SCOPE)}
    has_write_scope = any(s == WRITE_SCOPE for s in scopes)
    has_readonly_scope = any(s == READONLY_SCOPE for s in scopes)

    # Tab names: only literals that exactly match a known tab, plus any string that
    # looks like a tab name assigned to a *_TAB constant (so a new tab is visible).
    named_tabs = {s for s in strings if s in EDITORIAL_TABS | NON_EDITORIAL_TABS}
    tab_consts = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id.endswith("_TAB") \
                        and isinstance(node.value, ast.Constant) \
                        and isinstance(node.value.value, str):
                    tab_consts.add(node.value.value)

    verbs = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in WRITE_VERBS:
                verbs.add(node.func.attr)

    return {
        "path": path,
        "has_write_scope": has_write_scope,
        "has_readonly_scope": has_readonly_scope,
        "editorial_tabs": named_tabs & EDITORIAL_TABS,
        "all_tabs": named_tabs | tab_consts,
        "write_verbs": verbs,
    }


def check(root=None, roles=None, allowlist=None):
    """Returns (failures, stats). Empty failures == green."""
    root = root or REPO
    roles = ROLES if roles is None else roles
    allowlist = EDITOR_APP_ALLOWLIST if allowlist is None else allowlist
    fails = []

    discovered = discover(root)

    # Rule 1 — every Sheet-touching file is classified.
    for p in discovered:
        if p not in roles:
            fails.append(f"[SCOPE/1] UNCLASSIFIED Sheet-touching program: {p} — "
                         f"classify it in check_sheet_scopes.py ROLES before it ships")
    # and every classified path still exists (shrink discipline, mirrors check_docs)
    for p in roles:
        if p not in discovered:
            fails.append(f"[SCOPE/1] ROLES names {p}, which no longer references the "
                         f"Sheet API — remove the stale classification")

    stats = {"discovered": len(discovered), "pipeline": 0, "editor": 0, "tabs": 0}
    facts = {}
    for p in discovered:
        if p not in roles:
            continue
        role = roles[p]
        if role == "no-sheet-access":
            f = analyse(p, root)
            if f["write_verbs"] and f["editorial_tabs"]:
                fails.append(f"[SCOPE/1] {p} is classified no-sheet-access but names "
                             f"editorial tabs {sorted(f['editorial_tabs'])} and calls "
                             f"{sorted(f['write_verbs'])} — reclassify it")
            continue
        f = analyse(p, root)
        facts[p] = f
        if role in PIPELINE_ROLES:
            stats["pipeline"] += 1
        if role == "editor-app":
            stats["editor"] += 1

        # Rule 2 — a pipeline reader declares no write scope.
        if role == "pipeline-reader" and f["has_write_scope"]:
            fails.append(f"[SCOPE/2] {p} is a pipeline-reader of editorial tabs but "
                         f"declares the WRITE scope {WRITE_SCOPE!r} — the read-only "
                         f"credential is what makes no-editorial-writeback structural")

        # Rule 3 — a pipeline writer names no editorial tab.
        if role == "pipeline-writer" and f["editorial_tabs"]:
            fails.append(f"[SCOPE/3] {p} holds a write scope and names editorial "
                         f"tab(s) {sorted(f['editorial_tabs'])} — a pipeline writer "
                         f"must target only machine-owned tabs")

        # Rule 4 — no pipeline program write-verbs an editorial tab.
        if role in PIPELINE_ROLES and f["write_verbs"] and f["editorial_tabs"]:
            fails.append(f"[SCOPE/4] {p} calls Sheet write verb(s) "
                         f"{sorted(f['write_verbs'])} and names editorial tab(s) "
                         f"{sorted(f['editorial_tabs'])}")

        # Rule 5 — only the allowlisted editor app may write an editorial tab.
        if role not in ("editor-app",) and f["write_verbs"] and f["editorial_tabs"] \
                and p not in allowlist:
            fails.append(f"[SCOPE/5] {p} is not on the editorial-writer allowlist but "
                         f"both names editorial tab(s) and calls write verb(s)")

        # Rule 6 — every tab a pipeline program names is declared.
        if role in PIPELINE_ROLES:
            for t in f["all_tabs"]:
                stats["tabs"] += 1
                if t not in EDITORIAL_TABS and t not in NON_EDITORIAL_TABS:
                    fails.append(f"[SCOPE/6] {p} references undeclared Sheet tab {t!r} — "
                                 f"add it to EDITORIAL_TABS or NON_EDITORIAL_TABS")

    # Rule 5 (integrity half) — the allowlist itself must not grow silently.
    listed_editors = {p for p, r in roles.items() if r == "editor-app"}
    if listed_editors != allowlist:
        fails.append(f"[SCOPE/5] the editor-app role set {sorted(listed_editors)} does "
                     f"not equal the editorial-writer allowlist {sorted(allowlist)} — "
                     f"a new editorial writer must be ratified, not classified in")

    return fails, stats


# ---------------------------------------------------------------------------
def self_test():
    """Fire every rule on a synthetic violation, in a throwaway tree."""
    import tempfile, shutil, textwrap
    results = []

    def scenario(name, files, roles, allowlist, expect_rule):
        tmp = tempfile.mkdtemp()
        try:
            for rel, src in files.items():
                full = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                open(full, "w", encoding="utf-8").write(textwrap.dedent(src))
            fails, _ = check(tmp, roles, allowlist)
            hit = any(expect_rule in f for f in fails)
            results.append((name, hit))
            print(f"SELF-TEST {'PASS' if hit else 'FAIL'}  {name}")
            if not hit:
                print(f"          expected {expect_rule}, got: {fails}")
        finally:
            shutil.rmtree(tmp)

    RO = f'SCOPES = ["{READONLY_SCOPE}"]\nimport gspread\n'
    RW = f'SCOPES = ["{WRITE_SCOPE}"]\nimport gspread\n'

    scenario("rule1 fires on an unclassified Sheet-touching program",
             {"a.py": RO, "rogue.py": RO}, {"a.py": "pipeline-reader"},
             set(), "[SCOPE/1]")

    scenario("rule1 fires on a stale classification",
             {"a.py": RO}, {"a.py": "pipeline-reader", "gone.py": "pipeline-reader"},
             set(), "[SCOPE/1]")

    scenario("rule2 fires when a pipeline reader takes the write scope",
             {"a.py": RW + '\nws = sheet.worksheet("Donor Overrides")\n'},
             {"a.py": "pipeline-reader"}, set(), "[SCOPE/2]")

    scenario("rule3 fires when a pipeline writer names an editorial tab",
             {"a.py": RW + '\nTAB = "Donor Clusters"\nx = "Donor Clusters"\n'},
             {"a.py": "pipeline-writer"}, set(), "[SCOPE/3]")

    scenario("rule4 fires on a write verb against an editorial tab",
             {"a.py": RO + '\nws = s.worksheet("Person Links")\nws.clear()\n'},
             {"a.py": "pipeline-reader"}, set(), "[SCOPE/4]")

    scenario("rule5 fires on a second, unlisted editorial writer",
             {"a.py": RW + '\nws = s.worksheet("Donor Overrides")\nws.append_row([])\n'},
             {"a.py": "pipeline-writer"}, set(), "[SCOPE/5]")

    scenario("rule5 fires when the allowlist and the editor-app role set disagree",
             {"a.py": RO}, {"a.py": "editor-app"}, set(), "[SCOPE/5]")

    scenario("rule6 fires on an undeclared tab name",
             {"a.py": RO + '\nOTHER_TAB = "Secret Ledger"\n'},
             {"a.py": "pipeline-reader"}, set(), "[SCOPE/6]")

    # Negative control: the real repo must be green.
    fails, stats = check()
    ok = not fails
    results.append(("real repo is green (negative control)", ok))
    print(f"SELF-TEST {'PASS' if ok else 'FAIL'}  real repo is green (negative control)")
    if not ok:
        for f in fails:
            print("          " + f)

    n = len(results)
    bad = [r for r in results if not r[1]]
    print(f"self-test: {n} checks · " + ("ALL PASS" if not bad else f"FAILED {len(bad)}"))
    return 1 if bad else 0


def main():
    if "--self-test" in sys.argv:
        return self_test()
    fails, stats = check()
    print(f"check_sheet_scopes (EDIT-SAFE-1/S2): "
          f"sheet-touching files={stats['discovered']} classified={len(ROLES)} "
          f"pipeline={stats['pipeline']} editor-app={stats['editor']} "
          f"tab-refs={stats['tabs']} fails={len(fails)}")
    if fails:
        for f in fails:
            print("  " + f)
        print("check_sheet_scopes: FAILED")
        return 1
    print("check_sheet_scopes: ALL GREEN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
