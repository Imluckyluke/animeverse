#!/usr/bin/env python3
"""Set only this feature's encrypted production environment variables."""
import json
import os
from pathlib import Path
import urllib.request

PROJECT='prj_7kcm60ieJUyBrhF3wOLP5A28QYeb'
TEAM='team_CMYIAA8VLuuOkKPGKjGcKWLy'

def main():
    config=json.loads((Path.home()/'.local/share/animeverse-download-cache/frontend.json').read_text())
    allowed={'AV_DOWNLOAD_CACHE_DISCOVERY_URL','AV_DOWNLOAD_CACHE_TOKEN'}
    assert set(config)==allowed
    values=[{'key':key,'value':config[key],'type':'encrypted','target':['production']} for key in sorted(allowed)]
    request=urllib.request.Request(f'https://api.vercel.com/v10/projects/{PROJECT}/env?teamId={TEAM}&upsert=true',
        data=json.dumps(values).encode(),method='POST',headers={
            'Authorization':'Bearer '+os.environ['VERCEL_TOKEN'],'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=60) as response:
        assert response.status in (200,201)
        result=json.load(response)
    if isinstance(result,dict) and result.get('failed'):
        raise RuntimeError('Some feature environment variables were not configured')
    print('ENCRYPTED_PRODUCTION_CACHE_CONFIGURATION_READY',','.join(sorted(allowed)),flush=True)

if __name__=='__main__':main()
