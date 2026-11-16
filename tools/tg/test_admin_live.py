#!/usr/bin/env python3
"""Read-only real-session admin smoke check. Never prints credentials/cookies.

Only normal login/logout state changes occur. Catalog, settings, commands,
users and archive records are not modified by this checker.
"""
import argparse
import http.cookiejar
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def existing_key():
    headers = {'Authorization': 'Bearer ' + os.environ['VERCEL_TOKEN']}
    prefix = 'https://api.vercel.com'
    project = 'prj_7kcm60ieJUyBrhF3wOLP5A28QYeb'
    team = 'team_CMYIAA8VLuuOkKPGKjGcKWLy'
    with urllib.request.urlopen(urllib.request.Request(f'{prefix}/v9/projects/{project}/env?teamId={team}', headers=headers), timeout=30) as response:
        envs = json.load(response)['envs']
    entry = next(item for item in envs if item['key'] == 'ADMIN_KEY' and 'production' in item.get('target', []))
    with urllib.request.urlopen(urllib.request.Request(f'{prefix}/v1/projects/{project}/env/{entry["id"]}?decrypt=true&teamId={team}', headers=headers), timeout=30) as response:
        key = json.load(response)['value']
    if not isinstance(key, str) or not 6 <= len(key) <= 256:
        raise RuntimeError('Existing credential is unavailable')
    return key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:3041')
    parser.add_argument('--web', action='store_true')
    args = parser.parse_args()
    configuration = json.loads((Path.home() / '.local/share/animeverse-admin/frontend.json').read_text())
    headers = {} if args.web else {'Authorization': 'Bearer ' + configuration['AV_ADMIN_SERVICE_TOKEN'], 'X-Client-Key': 'admin-live-smoke'}
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    prefix = '/api/admin' if args.web else '/v1/admin'
    def call(path, method='GET', body=None, extra=None):
        request = urllib.request.Request(args.base + prefix + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={**headers, **({'Content-Type': 'application/json', 'Origin': args.base} if method != 'GET' else {}), **(extra or {})})
        try:
            with opener.open(request, timeout=90) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as error:
            return error.code, json.load(error)
    status, _ = call('/overview')
    assert status == 401, 'Anonymous overview must be denied'
    status, login = call('/session', 'POST', {'password': existing_key()})
    assert status == 200 and login['session']['user']['role'] == 'owner', 'Real owner login failed'
    if args.web:
        assert 'token' not in login, 'Raw bearer token leaked to browser JSON'
        cookies = list(jar)
        assert any(cookie.name.endswith('av_admin_session') and cookie.secure and 'HttpOnly' in cookie._rest for cookie in cookies), 'Secure HttpOnly session cookie missing'
    else:
        headers['X-Session-Token'] = login['token']
    csrf = login['session']['csrf']
    headers['X-CSRF-Token'] = csrf
    try:
        for path in ['/overview', '/catalog?page=1', '/review?page=1', '/history?page=1', '/users?page=1', '/settings', '/backups']:
            status, data = call(path)
            assert status == 200, 'Read failed: ' + path
            if path.startswith('/catalog'):
                assert data['total'] > 0 and data['items'], 'Empty real catalog'
                slug = data['items'][0]['slug']
                status, detail = call('/catalog/' + slug)
                assert status == 200 and detail['item']['slug'] == slug, 'Title detail failed'
            print('ADMIN_READ_OK', path.split('?')[0], flush=True)
        status, _ = call('/settings', 'PATCH', {'expectedRevision': -1, 'publicationMode': 'manual'}, {'X-CSRF-Token': 'invalid'})
        assert status == 403, 'CSRF mutation must be rejected'
        print('CSRF_REJECTION_OK', flush=True)
    finally:
        status, _ = call('/session', 'DELETE')
        assert status == 200, 'Logout failed'
    status, _ = call('/overview')
    assert status == 401, 'Logged out session remained valid'
    print('REAL_ADMIN_SESSION_SMOKE_PASSED', flush=True)


if __name__ == '__main__':
    main()
