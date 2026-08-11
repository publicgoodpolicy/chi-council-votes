"""enrich_committee_names.py — give the ingested IE committees real names.

The SBE Expenditures/Receipts files carry only CommitteeID, so ingest_ie labels
IE committees "ie-committee-<id>". Committees.txt maps CommitteeID -> CommitteeName.
This relabels them and, now that we know the name, re-bridges any IE committee that
also appears as a donor (its giving face). Run after ingest_ie, before build_shards.

  python enrich_committee_names.py --council council-data.v5.json \\
         --committees Committees.txt --out council-data.v6.json

Only FIELD_MAP is format-dependent — adjust if the SBE header differs.
"""
import json, re, csv, sys, os, argparse
csv.field_size_limit(min(sys.maxsize, 2**31-1))
# ONE implementation of the cp1252 pre-scan, imported rather than retyped: a second copy of
# the unmapped-byte set is a divergence waiting to happen (the `_bucket` reasoning again).
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ingest_ie import prescan_unmapped as ie_prescan  # noqa: E402
FIELD_MAP={"id":"ID","name":"Name"}

def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',(s or '').lower())).strip()
def read_tsv(path):
    # cp1252, not latin-1 — see ingest_ie.read_tsv for why the difference is not cosmetic.
    # This reader PERSISTS committee_name, so a silent mis-decode lands in the artifact.
    bad = ie_prescan(path)
    if bad:
        raise SystemExit(
            f"FATAL: {len(bad)} cp1252-unmapped byte(s) in {path} -- first 10: {bad[:10]}")
    with open(path,encoding='cp1252',newline='') as f:
        for row in csv.DictReader((ln.replace('\r\n','\n') for ln in f),delimiter='\t'):
            yield row

def _load_map(path):
    F=FIELD_MAP
    out={}
    for row in read_tsv(path):
        cid=str(row.get(F['id']) or '').strip(); nm=(row.get(F['name']) or '').strip()
        if cid and nm: out[cid]=nm
    return out


def enrich(d, committees_path, fallback_path=None):
    """PRIMARY = the curated reference/ie-committee-names.tsv; FALLBACK = the SBE
    Committees bulk, consulted only for ids the primary does not carry.

    SBE-RERUN-1 (planner error 55). Brief §4 recommended passing the SBE Committees bulk
    here so a newly-appearing IE committee would get a real name instead of rendering as
    `ie-committee-<id>`. That is true, and it was the only property anyone checked — but
    the curated TSV was contributing a second one nobody had established: Illinois
    Sunshine provenance and its normalized spellings. Passing the bulk discarded that
    silently, and `ie-committee-539` shipped as 'Illinois Farm Bureau  ACTIVATOR' (double
    space, the bulk's own spelling in both the 7.22 and 8.09 pulls) on the live tool. The
    only thing that caught it was an UNWIRED harness.

    Primary-with-fallback keeps both properties: curated spellings win, and a committee
    the TSV has never seen still resolves. Committees taken from the fallback are RETURNED
    BY ID, not merely counted — a new arrival must be visible so the TSV can be updated
    deliberately, rather than inferred from a total that happens to add up.

    Whitespace is deliberately NOT normalized here. Silently rewriting a source-of-record's
    strings is the wrong instrument: it would have hidden this defect rather than surfaced
    it, and it would make the artifact disagree with the SBE record for reasons no reader
    could see. The assertion belongs in a checker; the fix belongs in the curated file.
    """
    id2name=_load_map(committees_path)
    fb=_load_map(fallback_path) if fallback_path else {}
    comms=d['committees']; donors=d['donors']
    dname_idx={norm(v.get('name') or ''):vid for vid,v in donors.items()}
    renamed=0; rebridged=0; unmatched=[]; from_fallback=[]
    for k,c in comms.items():
        if c.get('type')!='independent_expenditure': continue
        sbe=str(c.get('sbe_committee_id') or '')
        nm=id2name.get(sbe)
        if not nm:
            nm=fb.get(sbe)
            if nm: from_fallback.append({'sbe_committee_id':sbe,'name':nm})
        if not nm: unmatched.append(c.get('sbe_committee_id')); continue
        c['committee_name']=nm; renamed+=1
        if not c.get('donor_id'):                       # re-bridge to giving face if name now matches
            did=dname_idx.get(norm(nm))
            if did: c['donor_id']=did; donors[did]['committee_id']=k; rebridged+=1
    return {'committees_in_map':len(id2name),'fallback_in_map':len(fb),
            'ie_renamed':renamed,'ie_rebridged':rebridged,
            'ie_from_fallback':from_fallback,
            'ie_unmatched':[u for u in unmatched if u]}

def smoke():
    d=json.load(open('council-data.v5.json'))
    # synthetic Committees.txt covering some of the real ingested IE ids
    real={'38979':'Illinois REALTORS Fund','25064':'INCS Action Independent Committee',
          '26066':'Urban Center Action','39122':'Get Stuff Done PAC','18574':'SEIU Illinois Council PAC'}
    with open('/tmp/Committees_fixture.txt','w') as f:
        f.write('ID\tCommitteeName\tTypeOfCommittee\n')
        for cid,nm in real.items(): f.write(f'{cid}\t{nm}\tIndependent Expenditure\n')
    s=enrich(d,'/tmp/Committees_fixture.txt')
    named={c['sbe_committee_id']:c['committee_name'] for c in d['committees'].values()
           if c.get('type')=='independent_expenditure' and str(c.get('sbe_committee_id')) in real}
    assert named.get('38979')=='Illinois REALTORS Fund', named
    assert s['ie_renamed']==5, s
    print('[smoke] PASS', json.dumps(s))
    for cid,nm in named.items(): print(f'   sbe {cid} -> {nm}')

if __name__=='__main__':
    if '--smoke' in sys.argv: smoke(); sys.exit()
    ap=argparse.ArgumentParser()
    ap.add_argument('--council',required=True)
    ap.add_argument('--committees',required=True,
                    help='PRIMARY name map — normally reference/ie-committee-names.tsv '
                         '(curated, Illinois Sunshine provenance and spellings)')
    ap.add_argument('--fallback-committees',
                    help='the SBE Committees bulk, consulted ONLY for ids the primary '
                         'lacks; any committee resolved from it is reported by id')
    ap.add_argument('--out',required=True)
    a=ap.parse_args()
    d=json.load(open(a.council)); s=enrich(d,a.committees,a.fallback_committees)
    json.dump(d,open(a.out,'w'),indent=2,ensure_ascii=True)
    print('[enrich]',json.dumps(s,indent=2))
    if s['ie_from_fallback']:
        print('[enrich] NOTE: %d committee(s) resolved from the FALLBACK bulk, not the '
              'curated TSV — add them to reference/ie-committee-names.tsv so their '
              'spelling is owned:' % len(s['ie_from_fallback']))
        for e in s['ie_from_fallback']:
            print('           %s  %r' % (e['sbe_committee_id'], e['name']))
    print('[write]',a.out)
