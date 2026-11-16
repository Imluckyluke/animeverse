"""Encrypted private GitHub assets; key recovery uses a separate provider.

Keys are encrypted-at-rest, development-only Vercel environment variables, not
production/preview variables and never NEXT_PUBLIC. Their authenticated recovery
is verified before uploading a backup. No GitHub source commits are created.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import urllib.error
import urllib.parse
import urllib.request

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

REPOSITORY = 'Imluckyluke/animeverse'
SECRET_PREFIX = 'AV_RECOVERY_KEY_'
MAGIC = b'ANIMEVERSE-BACKUP-1\0'
AAD = b'AnimeVerse private production recovery v1'


def recovery_key(path):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent = path.parent.lstat()
    if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError('Recovery key directory must be owner-only and not a symbolic link')
    if not path.exists():
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(secrets.token_bytes(32))
            handle.flush()
            os.fsync(handle.fileno())
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, 'rb') as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Recovery key must be owner-only and not a symbolic link')
        key = handle.read(33)
    if len(key) != 32:
        raise ValueError('Invalid recovery key size')
    return key


def secret_name(key):
    # Missing/replaced local keys get a NEW secret, never overwrite recovery
    # material required by an older encrypted snapshot.
    return SECRET_PREFIX + hashlib.sha256(key).hexdigest()[:24].upper()


def encrypt(raw, key):
    nonce = secrets.token_bytes(12)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, raw, AAD)


def decrypt(raw, key):
    if not raw.startswith(MAGIC) or len(raw) < len(MAGIC) + 28:
        raise ValueError('Invalid encrypted recovery format')
    offset = len(MAGIC)
    return AESGCM(key).decrypt(raw[offset:offset + 12], raw[offset + 12:], AAD)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token, repository=REPOSITORY):
        self.token, self.repository = token, repository
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, route, method='GET', payload=None, raw=None, accept='application/vnd.github+json'):
        url = route if route.startswith('https://') else 'https://api.github.com' + route
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in {'api.github.com', 'uploads.github.com'}:
            raise ValueError('Unapproved GitHub endpoint')
        headers = {'Authorization': 'Bearer ' + self.token, 'Accept': accept,
                   'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AnimeVerse-Private-Recovery'}
        if payload is not None:
            raw = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        elif raw is not None:
            headers['Content-Type'] = 'application/octet-stream'
        request = urllib.request.Request(url, method=method, data=raw, headers=headers)
        try:
            with self.opener.open(request, timeout=1800 if raw is not None else 180) as response:
                body = response.read()
                return body if accept == 'application/octet-stream' else json.loads(body) if body else {}
        except urllib.error.HTTPError as error:
            if accept != 'application/octet-stream' or error.code not in {301, 302, 303, 307, 308}:
                raise
            location = error.headers.get('Location', '')
            parsed = urllib.parse.urlsplit(location)
            if parsed.scheme != 'https' or not parsed.hostname or not (
                    parsed.hostname.endswith('.githubusercontent.com') or parsed.hostname == 'release-assets.githubusercontent.com'):
                raise ValueError('Unapproved encrypted asset redirect') from None
            # Never forward the GitHub Authorization header to signed asset URLs.
            with self.opener.open(urllib.request.Request(location), timeout=180) as response:
                return response.read()

    def upload_and_download(self, encrypted, tag, target_commit, recovery_reference):
        repo = '/repos/' + self.repository
        info = self.request(repo)
        if info.get('private') is not True or not info.get('permissions', {}).get('admin'):
            raise RuntimeError('Private administrator-controlled backup repository required')
        release = self.request(repo + '/releases', method='POST', payload={
            'tag_name': tag, 'target_commitish': target_commit, 'name': 'Encrypted production recovery snapshot',
            'body': 'Private encrypted operational backup, not a source release. AES-256-GCM; key recovery is stored separately in the owner-controlled Vercel project, development-only scope. Recovery reference: ' + json.dumps(recovery_reference, sort_keys=True) + '. No video files or runtime credentials are committed.',
            'draft': False, 'prerelease': True})
        upload = release['upload_url'].split('{', 1)[0] + '?name=recovery.avbackup'
        if self.request(repo).get('private') is not True:
            raise RuntimeError('Backup repository privacy changed')
        asset = self.request(upload, method='POST', raw=encrypted)
        remote = self.request(repo + '/releases/assets/' + str(asset['id']), accept='application/octet-stream')
        if hashlib.sha256(remote).digest() != hashlib.sha256(encrypted).digest():
            raise RuntimeError('Off-host backup download integrity failed')
        return remote, {'repository': self.repository, 'releaseId': release['id'], 'assetId': asset['id'],
                        'encryptedSha256': hashlib.sha256(encrypted).hexdigest(), 'bytes': len(encrypted),
                        'recoveryReference': recovery_reference}


class VercelRecoveryVault:
    PROJECT = 'prj_7kcm60ieJUyBrhF3wOLP5A28QYeb'
    TEAM = 'team_CMYIAA8VLuuOkKPGKjGcKWLy'

    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, method='GET', payload=None):
        separator = '&' if '?' in path else '?'
        url = 'https://api.vercel.com' + path + separator + 'teamId=' + self.TEAM
        request = urllib.request.Request(url, method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json',
                     'User-Agent': 'AnimeVerse-Private-Recovery'})
        with self.opener.open(request, timeout=40) as response:
            return json.load(response)

    def store_and_recover(self, key):
        project = self.request('/v9/projects/' + self.PROJECT)
        if project.get('id') != self.PROJECT:
            raise RuntimeError('Wrong recovery-key project')
        name = secret_name(key)
        route = '/v10/projects/' + self.PROJECT + '/env'
        variables = self.request(route).get('envs', [])
        matches = [entry for entry in variables if entry.get('key') == name]
        if not matches:
            self.request(route, method='POST', payload={'key': name, 'value': base64.b64encode(key).decode('ascii'),
                'type': 'encrypted', 'target': ['development'],
                'comment': 'Private backup recovery only. Never production/preview/NEXT_PUBLIC.'})
            matches = [entry for entry in self.request(route).get('envs', []) if entry.get('key') == name]
        if len(matches) != 1 or matches[0].get('target') != ['development'] or matches[0].get('type') != 'encrypted':
            raise RuntimeError('Unsafe recovery-key environment scope')
        ident = matches[0]['id']
        recovered = self.request('/v1/projects/' + self.PROJECT + '/env/' + ident)
        remote_key = base64.b64decode(recovered['value'], validate=True)
        if not secrets.compare_digest(remote_key, key):
            raise RuntimeError('Off-host recovery key does not match')
        return remote_key, {'provider': 'vercel', 'projectId': self.PROJECT, 'environmentId': ident,
                            'key': name, 'target': ['development'], 'remoteKeyRecoveryVerified': True}
