"""One real owner login, read-only access checks, then logout. No credential output."""
import http.cookiejar
import json
from pathlib import Path
import shlex
import urllib.error
import urllib.request
from test_admin_live import existing_key


def verify_owner(base):
    values = {}
    for line in (Path.home() / '.local/share/animeverse-admin/service.env').read_text().splitlines():
        name, _, value = line.partition('=')
        if name == 'AV_ADMIN_OWNER_EMAIL':
            values[name] = shlex.split(value)[0]
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def call(path, method='GET', payload=None, csrf=None):
        headers = {'Origin': base, 'Content-Type': 'application/json'}
        if csrf:
            headers['X-CSRF-Token'] = csrf
        request = urllib.request.Request(base + path, method=method, headers=headers,
            data=json.dumps(payload).encode() if payload is not None else None)
        try:
            with opener.open(request, timeout=30) as response:
                data = response.read()
                return response.status, json.loads(data) if response.headers.get_content_type() == 'application/json' else data
        except urllib.error.HTTPError as error:
            return error.code, None
    assert call('/api/admin/session')[0] == 404
    status, account = call('/api/account/login', 'POST', {'email': values['AV_ADMIN_OWNER_EMAIL'], 'password': existing_key()})
    assert status == 200 and account['user']['role'] == 'owner', 'Owner account login failed'
    csrf = account['csrf']
    try:
        status, admin = call('/api/admin/session')
        assert status == 200 and admin['session']['user']['id'] == account['user']['id']
        page_status, page = call('/admin')
        assert page_status == 200 and 'بررسی نشست مدیریت'.encode() in page, 'Authenticated owner page failed'
        assert call('/api/admin/session', 'POST', {'password': 'ANIMEVERSE_FAKE_OWNER_TEST_PASSWORD'}, csrf)[0] == 404
    finally:
        assert call('/api/account/session', 'DELETE', csrf=csrf)[0] == 200
    assert call('/api/admin/session')[0] == 404
    print('REAL_OWNER_ACCOUNT_ONLY_PAGE_AND_API_VERIFIED', flush=True)
