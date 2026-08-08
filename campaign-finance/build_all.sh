#!/usr/bin/env bash
# =============================================================================
# build_all.sh — ONE local builder for the Chicago Council Accountability Tool.
#
# Replaces the nightly GitHub Action (which can't fetch votes — DataMade blocks
# datacenter IPs — and whose commits collided with manual pushes). Run this on
# your own machine, where your IP is NOT blocked, whenever data actually
# changes: after a Council session (votes), or when you refresh campaign finance.
#
# It ends with a VALIDATION GATE: if council-data.json or the shards are not
# valid JSON, or contain git conflict markers, the script aborts and NOTHING is
# committed. A broken file can never reach the live page again.
#
# `set -e` means any failing step stops the build before the commit step, so a
# blocked/failed fetch leaves your committed data untouched.
# =============================================================================
set -euo pipefail

# ---- CONFIG: edit these to match your machine --------------------------------
REPO="${REPO:-$HOME/chi-council-votes}"
DATA="$REPO/campaign-finance/council-data.json"     # the live monolith
SHARDS="$REPO/campaign-finance/shards"              # index + contributions shards
INGEST="$REPO/campaign-finance/ingestion"          # ingest.py, transforms, build_rollups, build_shards, ingest_ie, enrich
SHEETS="$REPO/campaign-finance/sheets-sync"        # sync_bios.py, sync_overrides.py
MAIN="$REPO/campaign-finance"                      # ingest_votes.py, sync_allvotes.py, council-data.json
MAP="$REPO/campaign-finance/featured_vote_map.json"
RAW="$REPO/campaign-finance/raw/receipts"          # SBE per-committee receipt CSVs
SHEET_ID="${SHEET_ID:-1tUJNv7S611xM-VO7LcZlOStbJ8O7LQ5deYjsHeVAwQ8}"
CREDS="${CREDS:-$SHEETS/creds.json}"               # Google service-account key (moved into sheets-sync/)
COUNCIL_TERM="${COUNCIL_TERM:-2023}"               # Council term for the vote fetch (renamed: TERM collides with the shell)

cd "$REPO"

say(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

# ---- 0. Start from a known-good base ----------------------------------------
say "Pull latest, confirm the committed data is valid before we touch it"
git pull --no-rebase
python3 -c "import json;json.load(open('$DATA'));print('  base council-data.json VALID')"

# ---- 1. Roster + editorial (Google Sheets API — NOT IP-blocked) -------------
say "Sync alder roster from the Alder Bios tab (preserves existing votes)"
python3 "$SHEETS/sync_bios.py"      --sheet-id "$SHEET_ID" --creds-file "$CREDS" --data-file "$DATA"

# ---- 2. Votes (DataMade fetch — works HERE, blocked only from datacenters) ---
# Comment this whole block out for a finance-only build; sync_bios already
# preserved the existing vote positions.
say "Fetch roll-call votes from DataMade, then sync the All Votes tab"
python3 "$MAIN/ingest_votes.py"   --data "$DATA" --map "$MAP" --term "$COUNCIL_TERM"
python3 "$MAIN/sync_allvotes.py"  --data "$DATA" --map "$MAP" \
                                     --sheet-id "$SHEET_ID" --creds-file "$CREDS"

# ---- 3. Editorial overrides / merges / clusters — MOVED into the derived-layer
# section below, to run AFTER the finance ingest and BEFORE build_rollups, per the
# ordering authority of record (MECHANISM_REFERENCE.md §1). Running it HERE (before
# ingest) let ingest's donor-union clear the Sheet-only fields entity_type and
# _last_edited_by with no re-apply after — HALT-BA-1. Do not move it back. ---------

# ---- 4. Campaign finance — only if you've dropped new receipts in raw/ -------
if [ -d "$RAW" ] && [ -n "$(ls -A "$RAW" 2>/dev/null)" ]; then
  say "Ingest new SBE receipts (per-committee; preserves all other contributions)"
  python3 "$INGEST/ingest.py" --raw-dir "$RAW" --data-file "$DATA"
else
  say "No new receipts in $RAW — skipping finance ingest"
fi

# ---- IE LAYER: NOT run here. It needs the 1.8GB SBE bulk files and is -------
# quarterly. The IE data already lives in council-data.json and survives every
# step above (ingest.py only replaces a committee's OWN rows; the IE committees
# are never in raw/receipts/). When you refresh IE, run these TWO lines by hand
# with the bulk files present, THEN re-run this script for the derived layers:
#   python3 "$INGEST/ingest_ie.py" --council "$DATA" \
#       --expenditures /path/Expenditures.txt --receipts /path/Receipts.txt --out "$DATA"
#   python3 "$INGEST/enrich_committee_names.py" --council "$DATA" \
#       --committees /path/Committees.txt --out "$DATA"

# ---- 5. Derived layers — recomputed every build (idempotent, in place) ------
say "Rebuild derived layers: parent_id/cycles -> committee registry -> overrides -> rollups -> shards"
python3 "$INGEST/transform_slice1.py" "$DATA"
python3 "$INGEST/transform_slice2.py" "$DATA"
# Editorial overrides / merges / clusters (Google Sheets — not blocked). Runs HERE:
# after ingest (so it re-applies the Sheet-only fields ingest's donor-union drops)
# and before build_rollups (so rollups see synced classifications) — HALT-BA-1,
# per the ordering authority of record (MECHANISM_REFERENCE.md §1).
say "Apply donor overrides, flags, merges, and clusters"
python3 "$SHEETS/sync_overrides.py" --sheet-id "$SHEET_ID" --creds-file "$CREDS" --data-file "$DATA"
python3 "$INGEST/build_rollups.py"    "$DATA"
python3 "$INGEST/build_shards.py"     "$DATA" "$SHARDS"

# ---- 6. VALIDATION GATE — must pass or we abort with nothing committed -------
say "VALIDATION GATE"
python3 -c "import json;json.load(open('$DATA'));print('  council-data.json VALID')"
for s in council-index.json council-contributions.json council-by_parent_cycles.json; do
  python3 -c "import json;json.load(open('$SHARDS/$s'));print('  $s VALID')"
done
if grep -rlnE '^(<<<<<<<|=======|>>>>>>>)' "$DATA" "$SHARDS"/*.json; then
  echo "  !! conflict markers found — ABORTING, nothing committed"; exit 1
fi
echo "  no conflict markers."
# PS-73 docs-form gate (DOCS-M4): one implementation (tools/check_docs.py), two invokers —
# here and the elections gate_bundle. Hard-fail per RULINGS.md §PS-73.
python3 "$REPO/campaign-finance/tools/check_docs.py" || { echo "  !! docs-form check (PS-73) FAILED — ABORTING"; exit 1; }
# No-editorial-writeback gate (EDIT-SAFE-1/S2): static, network-free. Asserts that the
# pipeline's editorial-tab readers still hold a READ-ONLY credential and that no pipeline
# program write-verbs an editorial tab — the property that makes "the Sheet is the editors'
# and the pipeline only reads it" structural rather than conventional. Same two-invoker
# shape as the docs gate above: here and the elections gate_bundle.
python3 "$REPO/campaign-finance/tools/check_sheet_scopes.py" || { echo "  !! Sheet-scope check (EDIT-SAFE-1/S2) FAILED — ABORTING"; exit 1; }
# Artifact integrity gate (REPAIR-AGG-1 rider F4). This script is the repo's only shell
# orchestrator and it CAN re-ingest receipts (§4 above), but it did not run the validator —
# so the INV-* families and the [AGG/PS-96] tripwire never fired on a build_all.sh build.
# That gap narrowed the premise LEDGER-0's D1(c) was ratified on. Wired here, mirroring the
# docs-form gate above: this script now has a hard failure mode, deliberately.
python3 "$INGEST/validate_council_data.py" "$DATA" --shards "$SHARDS" || { echo "  !! council-data.json validation FAILED — ABORTING"; exit 1; }

# ---- 7. Commit (manual on purpose — review first) ---------------------------
say "All artifacts valid. To publish, review the diff then run:"
cat <<EOF
    git add campaign-finance/council-data.json campaign-finance/shards "$MAP"
    git commit -m "Data build $(date +%F)"
    git push
EOF
# To auto-commit instead, uncomment:
# git add campaign-finance/council-data.json campaign-finance/shards "$MAP"
# git commit -m "Data build $(date +%F)" && git push && say "Pushed."
