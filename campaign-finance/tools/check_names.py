# check_names.py — SBE-RERUN-1 E. Presentation hygiene on the names WE own.
#
# WHAT THIS EXISTS TO CATCH. At SBE-RERUN-1 the refresh passed the SBE Committees bulk to
# enrich_committee_names instead of the curated reference/ie-committee-names.tsv. The bulk
# spells one committee 'Illinois Farm Bureau  ACTIVATOR' — DOUBLE SPACE — and that shipped
# to the deployed elections tool in 85f71c6. It was the only one of the 15 IE names that
# moved, and NO GATE LINE ASSERTED COMMITTEE NAMES AT ALL. The only thing that caught it
# was prerender_b2.js, an unwired harness the deploy ritual tells you to run before pasting.
# A live regression found by something nobody runs is a regression found by luck.
#
# WHY A SEPARATE CHECKER FROM check_encoding. Different question. check_encoding asks
# whether a string was DECODED correctly (a C1 control means cp1252 was read as latin-1);
# this asks whether a correctly-decoded string is FIT TO DISPLAY. The two fail for unrelated
# reasons and should be separately diagnosable at the gate. But "which fields are displayed
# names" is ONE fact, so NAME_FIELDS is imported from check_encoding rather than retyped —
# a second copy would drift the first time either side gained a field.
#
# SCOPE, AND WHY DONORS ARE OUT. Measured at adoption across both artifacts:
#     committees      double-space 0   leading/trailing 0     <- enforced here
#     donor_clusters  double-space 0   leading/trailing 0     <- enforced here
#     donors          double-space 74  leading/trailing 0     <- NOT enforced
# Committee names and cluster names are ours: committee names come from a curated file we
# maintain, cluster names are typed by an editor in the Sheet. Donor names are the FILER'S
# OWN string as SBE recorded it ('AAEQ  Manufacturers and Recyclers', 'Friends  of Kenneth
# Dunkin'). Asserting on those would be red on arrival, and "fixing" them would mean
# rewriting a source-of-record — the same wrong instrument this lane declined when it kept
# whitespace normalisation OUT of enrich_committee_names. The 74 are recorded here as a
# measured fact, not a backlog.
#
# NOT A PIN ON THE VALUES. This asserts a PROPERTY, not the 15 exact names. A value pin
# would have caught this defect too and would catch renames the property misses — but it
# needs ratification (a legitimate rename must not read as a failure), so it is banked.
#
#     python3 campaign-finance/tools/check_names.py [--self-test]
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from check_encoding import NAME_FIELDS  # noqa: E402  — one definition of "a displayed name"

# Collections whose names WE author or curate. See the scope note above.
OWNED = ('committees', 'donor_clusters')

RUN_OF_SPACES = re.compile(r'  +')


def offenders(art):
    """Every (collection, key, field, value, reason) whose displayed name is unfit."""
    out = []
    for coll in OWNED:
        for key, rec in (art.get(coll) or {}).items():
            if not isinstance(rec, dict):
                continue
            for field in NAME_FIELDS.get(coll, ()):
                val = rec.get(field)
                if not isinstance(val, str) or not val:
                    continue
                if RUN_OF_SPACES.search(val):
                    out.append((coll, key, field, val, 'run of 2+ spaces'))
                if val != val.strip():
                    out.append((coll, key, field, val, 'leading/trailing whitespace'))
    return out


def self_test():
    """Each case proves the check BITES. A checker whose failure path never runs is the
    green-that-means-nothing this lane has now found four times."""
    t = []
    mk = lambda coll, field, val: {coll: {'k': {field: val}}}

    t.append(('bites: a DOUBLE SPACE in a committee_name is caught',
              len(offenders(mk('committees', 'committee_name', 'Illinois Farm Bureau  ACTIVATOR'))) == 1))
    t.append(('bites: the exact live defect, verbatim, is caught',
              offenders(mk('committees', 'committee_name',
                           'Illinois Farm Bureau  ACTIVATOR'))[0][4] == 'run of 2+ spaces'))
    t.append(('bites: THREE spaces are caught (not just exactly two)',
              len(offenders(mk('committees', 'committee_name', 'A   B'))) == 1))
    t.append(('bites: LEADING whitespace is caught',
              len(offenders(mk('committees', 'committee_name', ' Chicago Forward'))) == 1))
    t.append(('bites: TRAILING whitespace is caught',
              len(offenders(mk('committees', 'committee_name', 'Chicago Forward '))) == 1))
    t.append(('bites: a cluster name is in scope too',
              len(offenders(mk('donor_clusters', 'name', 'SEIU  Healthcare'))) == 1))
    t.append(('bites: alder_name is in scope (NAME_FIELDS, not a local list)',
              len(offenders(mk('committees', 'alder_name', 'Daniel  La Spata'))) == 1))
    t.append(('passes: the corrected single-spaced name is clean',
              offenders(mk('committees', 'committee_name', 'Illinois Farm Bureau ACTIVATOR')) == []))
    t.append(('a DONOR double-space is deliberately OUT of scope (filer-owned string)',
              offenders({'donors': {'k': {'name': 'AAEQ  Manufacturers and Recyclers'}}}) == []))
    t.append(('non-string and empty values are skipped, never crash',
              offenders({'committees': {'a': {'committee_name': None},
                                        'b': {'committee_name': ''},
                                        'c': {'committee_name': 123},
                                        'd': 'not-a-dict'}}) == []))
    t.append(('a single interior space is not a violation',
              offenders(mk('committees', 'committee_name', 'Chicago Forward')) == []))
    t.append(('NAME_FIELDS is imported, not retyped (one definition)',
              'committee_name' in NAME_FIELDS['committees']))

    fails = 0
    for name, ok in t:
        print(('SELF-TEST PASS  ' if ok else 'SELF-TEST FAIL  ') + name)
        fails += (not ok)
    print(f'self-test: {len(t)} checks · ' + ('ALL PASS' if not fails else f'FAILED {fails}'))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description='Displayed-name hygiene on curated names.')
    ap.add_argument('artifacts', nargs='*')
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        sys.exit(self_test())

    paths = a.artifacts or [os.path.join(HERE, '..', 'election-data.json'),
                            os.path.join(HERE, '..', 'council-data.json')]
    bad = []
    for p in paths:
        for coll, key, field, val, why in offenders(json.load(open(p))):
            bad.append(f'{os.path.basename(p)} {coll}/{key}.{field}: {why} — {val!r}')
    for b in bad:
        print('[check_names] ' + b, file=sys.stderr)
    print(f'[check_names] {len(paths)} artifact(s) · '
          + ('ALL GREEN' if not bad else f'{len(bad)} unfit name(s)'))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
