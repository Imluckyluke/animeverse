#!/usr/bin/env python3
"""Publish a signed, secret-free control-plane origin after tunnel restarts.

Only small authenticated API requests pass through this tunnel. Video bytes
flow directly Telegram → worker → GitHub. GitHub Actions is never used.
"""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import urllib.error
import urllib.request
from download_cache import REPOSITORIES

PRIVATE=Path.home()/'.local/share/animeverse-download-cache'
API='https://api.github.com/repos/'+REPOSITORIES['temp']+'/contents/cache-origin.json'
stopped=threading.Event()

def publish(origin):
    import base64
    updated=dt.datetime.now(dt.timezone.utc).isoformat()
    message='1\n'+origin+'\n'+updated
    signature=hmac.new(os.environ['AV_CACHE_API_TOKEN'].encode(),message.encode(),hashlib.sha256).hexdigest()
    content=json.dumps({'version':1,'origin':origin,'updatedAt':updated,'signature':signature})+'\n'
    headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'],'Accept':'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'}
    sha=None
    try:
        with urllib.request.urlopen(urllib.request.Request(API,headers=headers),timeout=60) as response:sha=json.load(response)['sha']
    except urllib.error.HTTPError as error:
        if error.code!=404:raise
    body={'message':'Refresh signed download API origin','content':base64.b64encode(content.encode()).decode()}
    if sha:body['sha']=sha
    with urllib.request.urlopen(urllib.request.Request(API,headers=headers,data=json.dumps(body).encode(),method='PUT'),timeout=60) as response:
        if response.status not in (200,201):raise RuntimeError('Origin discovery update failed')
    print('SIGNED_CACHE_ORIGIN_PUBLISHED',flush=True)

def heartbeat(origin):
    while not stopped.wait(12*3600):
        try:publish(origin)
        except Exception:print('CACHE_ORIGIN_REFRESH_FAILED',flush=True)

def main():
    binary=Path.home()/'.cache/animeverse-download-cache/cloudflared'
    environment={k:v for k,v in os.environ.items() if k not in {'GH_TOKEN','AV_CACHE_API_TOKEN'}}
    command=[str(binary),'--no-autoupdate','tunnel','--protocol','http2','--url','https://127.0.0.1:8443',
             '--origin-ca-pool',str(PRIVATE/'ca.crt'),'--origin-server-name','109.125.177.141']
    process=subprocess.Popen(command,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    def stop(*_):stopped.set();process.terminate()
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    published=False
    try:
        for line in process.stdout:
            match=re.search(r'https://[a-z0-9-]+\.trycloudflare\.com',line)
            if match and not published:
                origin=match[0]
                publish(origin)
                threading.Thread(target=heartbeat,args=(origin,),daemon=True).start()
                published=True
            if 'Registered tunnel connection' in line:print('CACHE_TUNNEL_CONNECTED',flush=True)
        code=process.wait()
        if not stopped.is_set():raise SystemExit(code or 1)
    finally:
        stopped.set()
        if process.poll() is None:process.terminate()

if __name__=='__main__':main()
