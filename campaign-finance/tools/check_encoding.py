# check_encoding.py — SBFIN-4. No persisted display name may carry a C1 control or an
# unmapped byte.
#
# WHAT THIS EXISTS TO CATCH. The SBE bulk files are Windows-1252. Read as latin-1 — which
# NEVER raises — byte 0x92 (a curly apostrophe) decodes to U+0092, a C1 control, and rides
# into an artifact as a display name. That is not hypothetical: `Daniel O\x92Keefe` reached
# `election-data.json` through ingest_ie's reader and renders on the deployed elections
# tool, where he is Urban Center Action's joint-top funder.
#
# The decoders are fixed at their sites (strict cp1252 + a byte pre-scan that fails loudly).
# This is the assertion that the fix HELD, and that no other reader reintroduces it: a
# decoder bug is invisible by construction, so the artifact is where it must be caught.
#
# Scope note: this checks PERSISTED names — the strings a reader sees. Free-text fields that
# legitimately carry punctuation are checked for CONTROL characters only, never for the
# printable cp1252 punctuation that a correct decode produces (U+2019 is right, U+0092 is
# not).
#
#     python3 campaign-finance/tools/check_encoding.py [--self-test]
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
KNOWN_PATH = os.path.join(HERE, 'encoding_known_failures.json')

# U+0080–U+009F: the C1 range. A correct cp1252 decode never produces these — cp1252 maps
# every byte in 0x80–0x9F either to a real character or to nothing at all. Their presence in
# a string means some reader decoded cp1252 bytes as latin-1.
C1 = re.compile('[\u0080-\u009f]')
# U+FFFD: a decode that already failed and was papered over with errors='replace'.
REPLACEMENT = '�'
# The C0 controls, excluding tab/newline/carriage-return, which are legitimate in free text.
C0 = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f]')

# collection -> fields that are DISPLAYED to a reader
NAME_FIELDS = {
    'donors':         ('name', 'city', 'occupation', 'employer'),
    'committees':     ('committee_name', 'alder_name', 'name'),
    'donor_clusters': ('name', 'relationship'),
}
# Free-text fields: control characters only. Punctuation here is expected and fine.
TEXT_FIELDS = {
    'contributions':            ('in_kind_description',),
    'independent_expenditures': ('purpose',),
}


def offenders(art):
    """Every (collection, key, field, value, reason) carrying a forbidden character."""
    out = []

    def check(coll, key, field, val, names=True):
        if not isinstance(val, str):
            return
        why = []
        if C1.search(val):
            why.append('C1 control (cp1252 read as latin-1)')
        if REPLACEMENT in val:
            why.append('U+FFFD replacement (a decode that already failed)')
        if C0.search(val):
            why.append('C0 control')
        if why:
            out.append((coll, key, field, val, '; '.join(why)))

    for coll, fields in NAME_FIELDS.items():
        for k, v in (art.get(coll) or {}).items():
            if not isinstance(v, dict):
                continue
            for f in fields:
                check(coll, k, f, v.get(f))
    for coll, fields in TEXT_FIELDS.items():
        for row in (art.get(coll) or []):
            if not isinstance(row, dict):
                continue
            for f in fields:
                check(coll, row.get('id'), f, row.get(f), names=False)
    return out


def self_test():
    """Each case proves the check BITES. A checker whose failure path never runs is a green
    that means nothing."""
    t = []
    clean = {'donors': {'d1': {'name': "Daniel O’Keefe", 'city': 'Chicago'}},
             'committees': {'c1': {'committee_name': 'Friends of X — Ward 1'}},
             'donor_clusters': {'r1': {'name': 'Smith Family'}},
             'contributions': [{'id': 'x', 'in_kind_description': 'signs – printing'}]}
    t.append(('a CORRECTLY decoded artifact is clean (curly quotes and dashes are fine)',
              offenders(clean) == []))
    # the live defect, exactly
    bad1 = json.loads(json.dumps(clean))
    bad1['donors']['d1']['name'] = 'Daniel O\u0092Keefe'
    o = offenders(bad1)
    t.append(('bites: a C1 control in a donor name fails',
              len(o) == 1 and 'C1 control' in o[0][4]))
    bad2 = json.loads(json.dumps(clean))
    bad2['committees']['c1']['committee_name'] = 'Friends of X \u0096 Ward 1'
    t.append(('bites: a C1 control in a committee name fails',
              any('C1 control' in x[4] for x in offenders(bad2))))
    bad3 = json.loads(json.dumps(clean))
    bad3['donor_clusters']['r1']['name'] = 'Smith � Family'
    t.append(('bites: a U+FFFD replacement char in a cluster name fails',
              any('U+FFFD' in x[4] for x in offenders(bad3))))
    bad4 = json.loads(json.dumps(clean))
    bad4['contributions'][0]['in_kind_description'] = 'signs\x07 printing'
    t.append(('bites: a C0 control in free text fails',
              any('C0 control' in x[4] for x in offenders(bad4))))
    bad5 = json.loads(json.dumps(clean))
    bad5['donors']['d1']['city'] = 'Chicago\u0093'
    t.append(('bites: a C1 control in a non-name display field fails',
              any(x[2] == 'city' for x in offenders(bad5))))
    t.append(('a legitimate cp1252 punctuation decode is NOT flagged',
              offenders({'donors': {'d': {'name': '‘’“”–—•'}}}) == []))

    # --- the SHRINK-ONLY known-failures machinery (mirrors check_docs / PS-73) ---
    import tempfile
    def _run(art, known):
        with tempfile.TemporaryDirectory() as td:
            ap_ = os.path.join(td, 'election-data.json')
            json.dump(art, open(ap_, 'w'))
            return evaluate([ap_], known)
    K1 = {'max_entries': 1, 'entries': [{'artifact': 'election-data.json',
          'collection': 'donors', 'key': 'd1', 'field': 'name', 'owner': 'X'}]}
    unk, stale, seen = _run(bad1, K1)
    t.append(('a KNOWN failure is not reported as unknown', not unk and len(seen) == 1))
    t.append(('bites: a known entry that NO LONGER fails is itself a failure',
              len(_run(clean, K1)[1]) == 1))
    unk2, _, _ = _run(bad2, K1)
    t.append(('bites: an UNKNOWN failure is reported even when a known one is listed',
              len(unk2) == 1 and unk2[0][1] == 'committees'))

    fails = 0
    for name, ok in t:
        print(('SELF-TEST PASS  ' if ok else 'SELF-TEST FAIL  ') + name)
        fails += (not ok)
    print(f"self-test: {len(t)} checks · " + ('ALL PASS' if not fails else f'FAILED {fails}'))
    return 1 if fails else 0


def evaluate(paths, known):
    """Returns (unknown_failures, stale_known, seen). SHRINK-ONLY, mirroring check_docs
    (PS-73): an entry that no longer fails is itself a failure, so the fix that clears it
    must also remove it. That is what makes a pinned known-failure safe rather than a
    parking space."""
    key_of = lambda a, c, k, f: (os.path.basename(a), c, str(k), f)
    known_keys = {(e['artifact'], e['collection'], str(e['key']), e['field'])
                  for e in known.get('entries', [])}
    unknown, seen = [], set()
    for p in paths:
        for coll, k, field, val, why in offenders(json.load(open(p))):
            kk = key_of(p, coll, k, field)
            if kk in known_keys:
                seen.add(kk)
            else:
                unknown.append((os.path.basename(p), coll, k, field, val, why))
    stale = [e for e in known.get('entries', [])
             if (e['artifact'], e['collection'], str(e['key']), e['field']) not in seen]
    return unknown, stale, seen


def main():
    ap = argparse.ArgumentParser(description='Assert no persisted name carries a C1/C0 control.')
    ap.add_argument('artifacts', nargs='*')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())

    paths = a.artifacts or [os.path.join(HERE, '..', 'election-data.json'),
                            os.path.join(HERE, '..', 'council-data.json')]
    for p in paths:
        if not os.path.exists(p):
            print(f'[check_encoding] FATAL: missing {p}', file=sys.stderr)
            sys.exit(2)
    known = json.load(open(KNOWN_PATH))
    errs = []
    if len(known.get('entries', [])) > known.get('max_entries', 0):
        errs.append(f"known-failures grew past its pin "
                    f"({len(known['entries'])} > {known['max_entries']}) — SHRINK-ONLY")
    for e in known.get('entries', []):
        if not e.get('owner'):
            errs.append(f"known-failure {e.get('key')} has no owner")
    unknown, stale, seen = evaluate(paths, known)
    for art, coll, k, field, val, why in unknown:
        errs.append(f"{art} {coll}/{k} {field}={val!r} — {why}")
    for e in stale:
        errs.append(f"known-failure {e['artifact']} {e['collection']}/{e['key']} "
                    f"{e['field']} NO LONGER fails — remove it from "
                    f"{os.path.basename(KNOWN_PATH)} (owner: {e['owner']})")
    for m in errs:
        print('[check_encoding] ERROR ' + m, file=sys.stderr)
    print(f"[check_encoding] {len(paths)} artifact(s) · known {len(seen)}/"
          f"{len(known.get('entries', []))} pin {known.get('max_entries')} · "
          + ('ALL GREEN' if not errs else f'FAILED {len(errs)}'))
    sys.exit(1 if errs else 0)


if __name__ == '__main__':
    main()
