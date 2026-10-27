#!/usr/bin/env python3
"""Install the official tunnel binary only after verifying GitHub's digest."""
import hashlib
import json
import os
from pathlib import Path
import urllib.request

def main():
    destination=Path.home()/'.cache/animeverse-download-cache/cloudflared'
    headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+os.environ['GH_TOKEN']}
    with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',headers=headers),timeout=60) as response:
        release=json.load(response)
    asset=next(a for a in release['assets'] if a['name']=='cloudflared-linux-amd64')
    expected=asset.get('digest','')
    if not expected.startswith('sha256:'):raise RuntimeError('Official cloudflared asset has no verifiable SHA-256')
    digest=hashlib.sha256()
    temporary=destination.with_suffix('.partial')
    # Authentication is never forwarded from GitHub API to the download CDN.
    with urllib.request.urlopen(asset['browser_download_url'],timeout=180) as response, temporary.open('wb') as output:
        while chunk:=response.read(1024*1024):digest.update(chunk);output.write(chunk)
    if 'sha256:'+digest.hexdigest()!=expected:
        temporary.unlink(missing_ok=True)
        raise RuntimeError('Official cloudflared checksum mismatch')
    temporary.chmod(0o755);temporary.replace(destination)
    print('OFFICIAL_CACHE_TUNNEL_VERIFIED',release['tag_name'],digest.hexdigest(),flush=True)

if __name__=='__main__':main()
