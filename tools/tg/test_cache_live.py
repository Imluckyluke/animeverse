#!/usr/bin/env python3
"""One real-file end-to-end acceptance test, not an archive mirroring job."""
import hashlib
import hmac
import json
from pathlib import Path
import sqlite3
import time
import urllib.error
import urllib.request
import uuid

from download_cache import safe_download_url

ROOT=Path(__file__).resolve().parents[2]
PRIVATE=Path.home()/'.local/share/animeverse-download-cache'


def main():
    config=json.loads((PRIVATE/'frontend.json').read_text())
    with urllib.request.urlopen(config['AV_DOWNLOAD_CACHE_DISCOVERY_URL']+'?qa='+uuid.uuid4().hex,timeout=30) as response:
        discovery=json.load(response)
    signed='1\n'+discovery['origin']+'\n'+discovery['updatedAt']
    expected=hmac.new(config['AV_DOWNLOAD_CACHE_TOKEN'].encode(),signed.encode(),hashlib.sha256).hexdigest()
    assert hmac.compare_digest(discovery['signature'],expected)
    origin=discovery['origin']
    assert origin.startswith('https://') and origin.endswith('.trycloudflare.com')
    def call(path,payload=None):
        body=json.dumps(payload).encode() if payload is not None else None
        request=urllib.request.Request(origin+path,data=body,headers={
            'Authorization':'Bearer '+config['AV_DOWNLOAD_CACHE_TOKEN'],'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=45) as response:
            return json.load(response)
    try:
        urllib.request.urlopen(origin+'/v1/jobs/'+'0'*64,timeout=20)
        raise AssertionError('Unauthenticated control-plane access was accepted')
    except urllib.error.HTTPError as error:
        assert error.code==401
    rows=json.loads((ROOT/'src/lib/real-catalog.json').read_text())
    candidates=[(int(q['size']),a['slug'],e['number'],q['label']) for a in rows for e in a['episodeData'] for q in e['qualities']
                if q.get('status')=='done' and isinstance(q.get('size'),(int,float)) and 0<q['size']<100*1024**2 and (q.get('url') or '').startswith('https://t.me/testanivers/')]
    assert candidates,'No bounded real-file fixture available'
    size,slug,episode,quality=min(candidates)
    payload={'slug':slug,'episode':episode,'quality':quality,'client':hashlib.sha256(b'cache-live-acceptance-test').hexdigest(),'requestId':'live-qa-'+uuid.uuid4().hex}
    first=call('/v1/downloads',payload)
    database=sqlite3.connect('file:'+str(PRIVATE/'cache.sqlite')+'?mode=ro',uri=True)
    requests_after_first=database.execute('SELECT requests FROM jobs WHERE key=?',(first['job'],)).fetchone()[0]
    database.close()
    second=call('/v1/downloads',payload)
    assert first['job']==second['job']
    print('CACHE_REAL_FILE_QUEUED',slug,episode,quality,size,flush=True)
    deadline=time.monotonic()+1200
    result=second
    while result['status']!='ready':
        assert result['status'] not in ('failed','expired'),result.get('error','File transfer failed')
        assert time.monotonic()<deadline,'Real transfer did not complete within the acceptance-test deadline'
        time.sleep(max(4,min(10,result.get('retryAfter',4))))
        result=call('/v1/jobs/'+first['job'])
    assert result['provider']=='github' and safe_download_url(result['url'])
    database=sqlite3.connect('file:'+str(PRIVATE/'cache.sqlite')+'?mode=ro',uri=True)
    expected_digest,expected_size,count=database.execute('SELECT sha256,size,requests FROM jobs WHERE key=?',(first['job'],)).fetchone()
    database.close()
    assert count==requests_after_first,'The duplicated acceptance-test request inflated real request counts'
    digest=hashlib.sha256();received=0
    # Public download: no GitHub token, Telegram token or session is sent here.
    with urllib.request.urlopen(result['url'],timeout=180) as response:
        assert response.status==200
        while chunk:=response.read(1024*1024):digest.update(chunk);received+=len(chunk)
    assert received==expected_size and digest.hexdigest()==expected_digest
    report={'passed':True,'fixture':{'slug':slug,'episode':episode,'quality':quality},
            'job':first['job'],'url':result['url'],'bytes':received,'sha256':expected_digest,
            'checks':['signed-origin','unauthenticated-access-rejected','deduplicated-request','real-telegram-to-github-upload','anonymous-github-download','exact-size-and-sha256']}
    (ROOT.parent/'builds/animeverse-download-cache-live.json').write_text(json.dumps(report,indent=2))
    print('REAL_GITHUB_DOWNLOAD_VERIFIED',received,expected_digest,result['url'],flush=True)


if __name__=='__main__':main()
