#!/usr/bin/env python3
"""Bootstrap private admin configuration from the EXISTING encrypted admin key.

Credentials are handled inside this authentication process only. This script
prints configuration presence, never passwords, hashes or API tokens.
"""
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import subprocess
import urllib.parse
import urllib.request

from admin_auth import hash_password
from admin_store import AdminStore
from common import ROOT

PROJECT = 'prj_7kcm60ieJUyBrhF3wOLP5A28QYeb'
TEAM = 'team_CMYIAA8VLuuOkKPGKjGcKWLy'
PRIVATE = Path.home() / '.local/share/animeverse-admin'


def main():
    os.umask(0o077)
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    marker = PRIVATE / 'installation.json'
    if marker.exists() and json.loads(marker.read_text()).get('createdBy') != 'animeverse-admin-v1':
        raise SystemExit('Existing private admin configuration is not owned by this installer')
    if not marker.exists() and any(PRIVATE.iterdir()):
        raise SystemExit('Refusing to overwrite unfamiliar private admin files')
    service = PRIVATE / 'service.env'
    if not service.exists():
        discovery_url = os.environ.get('AV_ADMIN_DISCOVERY_URL', '').strip()
        parsed_discovery = urllib.parse.urlparse(discovery_url)
        if parsed_discovery.scheme != 'https' or not parsed_discovery.netloc:
            raise SystemExit('AV_ADMIN_DISCOVERY_URL must be a non-empty https URL')
        headers = {'Authorization': 'Bearer ' + os.environ['VERCEL_TOKEN']}
        request = urllib.request.Request(f'https://api.vercel.com/v9/projects/{PROJECT}/env?teamId={TEAM}', headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            environment = json.load(response)['envs']
        entry = next(item for item in environment if item['key'] == 'ADMIN_KEY' and 'production' in item.get('target', []))
        request = urllib.request.Request(f'https://api.vercel.com/v1/projects/{PROJECT}/env/{entry["id"]}?decrypt=true&teamId={TEAM}', headers=headers)
        with urllib.request.urlopen(request, timeout=30) as response:
            detail = json.load(response)
        key = detail.get('value')
        if not isinstance(key, str) or not 6 <= len(key) <= 256:
            raise SystemExit('Existing production admin key is unavailable or needs a secure reset')
        # Prove this is the existing credential, not an encrypted API blob.
        check = urllib.request.Request('https://animeverse-xi.vercel.app/api/admin/sync', headers={'x-admin-key': key})
        with urllib.request.urlopen(check, timeout=30) as response:
            if response.status != 200:
                raise SystemExit('Existing admin credential could not be validated')
        owner = os.environ.get('AV_ADMIN_OWNER_EMAIL')
        if not owner:
            previous = subprocess.run(['git', 'show', 'HEAD:src/lib/admin-visibility.ts'], cwd=ROOT, capture_output=True, text=True, check=True).stdout
            match = re.search(r'===\s*[\'"]([^\'"\s]+@[^\'"\s]+)[\'"]', previous)
            owner = match[1] if match else None
        if not owner:
            raise SystemExit('Owner email must be configured privately')
        token = secrets.token_urlsafe(48)
        hashed = hash_password(key)
        values = {'AV_ADMIN_SERVICE_TOKEN': token, 'AV_ADMIN_OWNER_EMAIL': owner, 'AV_ADMIN_OWNER_HASH': hashed}
        service.write_text('\n'.join(name + '=' + shlex.quote(value) for name, value in values.items()) + '\n')
        os.chmod(service, 0o600)
        cache_environment = {}
        for line in (Path.home() / '.local/share/animeverse-download-cache/service.env').read_text().splitlines():
            name, sep, value = line.partition('=')
            if sep:
                cache_environment[name] = shlex.split(value)[0] if value else ''
        tunnel = PRIVATE / 'tunnel.env'
        tunnel.write_text('GH_TOKEN=' + shlex.quote(cache_environment['GH_TOKEN']) + '\nAV_ADMIN_SERVICE_TOKEN=' + shlex.quote(token) + '\n')
        os.chmod(tunnel, 0o600)
        frontend = PRIVATE / 'frontend.json'
        frontend.write_text(json.dumps({'AV_ADMIN_DISCOVERY_URL': discovery_url, 'AV_ADMIN_SERVICE_TOKEN': token}))
        os.chmod(frontend, 0o600)
        marker.write_text(json.dumps({'createdBy': 'animeverse-admin-v1', 'version': 1}))
        store = AdminStore(ROOT / 'data/admin.sqlite3', owner, hashed)
        store.close()
    (ROOT / 'public/covers/admin').mkdir(parents=True, exist_ok=True)
    print('PRIVATE_ADMIN_CONFIGURATION_READY', flush=True)


if __name__ == '__main__':
    main()
