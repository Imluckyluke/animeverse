#!/usr/bin/env python3
"""Configure only encrypted admin control connectivity on the main project."""
import json
import os
from pathlib import Path
import urllib.request


def main():
    config = json.loads((Path.home() / '.local/share/animeverse-admin/frontend.json').read_text())
    assert set(config) == {'AV_ADMIN_DISCOVERY_URL', 'AV_ADMIN_SERVICE_TOKEN'}
    payload = [{'key': key, 'value': value, 'type': 'encrypted', 'target': ['production']} for key, value in config.items()]
    request = urllib.request.Request('https://api.vercel.com/v10/projects/prj_7kcm60ieJUyBrhF3wOLP5A28QYeb/env?teamId=team_CMYIAA8VLuuOkKPGKjGcKWLy&upsert=true',
        data=json.dumps(payload).encode(), method='POST', headers={'Authorization': 'Bearer ' + os.environ['VERCEL_TOKEN'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if isinstance(result, dict) and result.get('failed'):
        raise RuntimeError('Admin environment configuration failed')
    print('ENCRYPTED_ADMIN_CONTROL_CONFIGURATION_READY', flush=True)


if __name__ == '__main__':
    main()
