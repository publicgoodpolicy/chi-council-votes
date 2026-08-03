#!/usr/bin/env python3
"""restamp_committee_linkage.py — HALT-F1 artifact repair (data route of the PS-84 fix).

Re-stamps candidate-committee linkage from the artifact's OWN candidates[] claims via
ingest.py's shared most-recent-by-election resolver — ONE implementation, TWO callers
(PS-81/F-b): this script contains no resolution logic of its own, so it cannot drift
from ingest; any behavior change happens in ingest.resolve_committee_claimants for both.

IDEMPOTENT AND RE-RUNNABLE (HALT-F1 ruling section 4c): it derives entirely from current
claims — a second run recomputes identical winners and rewrites identical bytes. Writes
only the four ruled linkage fields (candidate_id / race_id / office / district) on
candidate-type committees whose stamp disagrees with the resolved winner. If the
recomputed ward would differ from the stored ward it FAILS LOUD instead of writing — a
fifth-field change was not ruled and must go back to the planner.

usage:  python3 restamp_committee_linkage.py path/to/election-data.json
"""
import importlib.util
import json
import os
import sys

RULED_FIELDS = ('candidate_id', 'race_id', 'office', 'district')


def _load_ingest():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ingest.py')
    spec = importlib.util.spec_from_file_location('ingest', p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def restamp(data):
    ing = _load_ingest()
    winners = ing.resolve_committee_claimants(data.get('candidates'), data.get('elections'))
    races_by_id = {r['id']: r for r in data.get('races', [])}
    changed = []
    for key, cm in (data.get('committees') or {}).items():
        if cm.get('type') != 'candidate' or not cm.get('sbe_committee_id'):
            continue
        win = winners.get(str(cm['sbe_committee_id']))
        if not win:
            continue
        r = races_by_id.get(win.get('race_id'), {})
        new = {'candidate_id': win.get('id'), 'race_id': win.get('race_id'),
               'office': r.get('office'), 'district': r.get('district')}
        w = r.get('ward')
        new_ward = int(w) if w not in (None, '') else None
        if cm.get('ward') != new_ward:
            sys.exit("FATAL: re-stamp of '%s' would change ward %r -> %r — a fifth-field "
                     "change was not ruled (HALT-F1 section 2); nothing written." %
                     (key, cm.get('ward'), new_ward))
        old = {k: cm.get(k) for k in RULED_FIELDS}
        if old != new:
            cm.update(new)
            changed.append((key, old, new))
    return changed


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: restamp_committee_linkage.py path/to/election-data.json")
    path = sys.argv[1]
    with open(path) as f:
        data = json.load(f)
    changed = restamp(data)
    if changed:
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)
        for key, old, new in changed:
            print("re-stamped %s:" % key)
            for k in RULED_FIELDS:
                if old[k] != new[k]:
                    print("  %s: %r -> %r" % (k, old[k], new[k]))
    print("restamp: %d committee(s) changed (idempotent: a re-run recomputes the same "
          "winners and changes 0)" % len(changed))


if __name__ == '__main__':
    main()
