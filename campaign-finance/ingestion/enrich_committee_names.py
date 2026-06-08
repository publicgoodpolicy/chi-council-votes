"""enrich_committee_names.py — give the ingested IE committees real names.

The SBE Expenditures/Receipts files carry only CommitteeID, so ingest_ie labels
IE committees "ie-committee-<id>". Committees.txt maps CommitteeID -> CommitteeName.
This relabels them and, now that we know the name, re-bridges any IE committee that
also appears as a donor (its giving face). Run after ingest_ie, before build_shards.

  python enrich_committee_names.py --council council-data.v5.json \\
         --committees Committees.txt --out council-data.v6.json

Only FIELD_MAP is format-dependent — adjust if the SBE header differs.
"""
import json, re, csv, sys, argparse
csv.field_size_limit(min(sys.maxsize, 2**31-1))
FIELD_MAP={"id":"ID","name":"Name"}

def norm(s): return re.sub(r'\s+',' ',re.sub(r'[^a-z0-9 ]',' ',(s or '').lower())).strip()
def read_tsv(path):
    with open(path,encoding='latin-1',newline='') as f:
        for row in csv.DictReader((ln.replace('\r\n','\n') for ln in f),delimiter='\t'):
            yield row

def enrich(d, committees_path):
    F=FIELD_MAP
    id2name={}
    for row in read_tsv(committees_path):
        cid=str(row.get(F['id']) or '').strip(); nm=(row.get(F['name']) or '').strip()
        if cid and nm: id2name[cid]=nm
    comms=d['committees']; donors=d['donors']
    dname_idx={norm(v.get('name') or ''):vid for vid,v in donors.items()}
    renamed=0; rebridged=0; unmatched=[]
    for k,c in comms.items():
        if c.get('type')!='independent_expenditure': continue
        nm=id2name.get(str(c.get('sbe_committee_id') or ''))
        if not nm: unmatched.append(c.get('sbe_committee_id')); continue
        c['committee_name']=nm; renamed+=1
        if not c.get('donor_id'):                       # re-bridge to giving face if name now matches
            did=dname_idx.get(norm(nm))
            if did: c['donor_id']=did; donors[did]['committee_id']=k; rebridged+=1
    return {'committees_in_map':len(id2name),'ie_renamed':renamed,
            'ie_rebridged':rebridged,'ie_unmatched':[u for u in unmatched if u]}

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
    ap.add_argument('--council',required=True); ap.add_argument('--committees',required=True)
    ap.add_argument('--out',required=True)
    a=ap.parse_args()
    d=json.load(open(a.council)); s=enrich(d,a.committees)
    json.dump(d,open(a.out,'w'),indent=2,ensure_ascii=True)
    print('[enrich]',json.dumps(s,indent=2)); print('[write]',a.out)
