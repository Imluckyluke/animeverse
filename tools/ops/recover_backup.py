#!/usr/bin/env python3
"""Standalone recovery to a NEW directory; never overwrites live application data.

Needs Python + cryptography and fresh owner GH_TOKEN/VERCEL_TOKEN credentials.
The original server's recovery.key, SSH credentials and source tree are not used.
"""
import argparse
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import urllib.error
import urllib.request
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset', type=int, required=True)
    parser.add_argument('--environment', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists() or not args.environment.replace('_', '').replace('-', '').isalnum():
        raise ValueError('A new output directory and valid recovery environment ID are required')
    opener = urllib.request.build_opener(NoRedirect())
    project, team = 'prj_7kcm60ieJUyBrhF3wOLP5A28QYeb', 'team_CMYIAA8VLuuOkKPGKjGcKWLy'
    request = urllib.request.Request('https://api.vercel.com/v1/projects/' + project + '/env/' + args.environment + '?teamId=' + team,
        headers={'Authorization': 'Bearer ' + os.environ['VERCEL_TOKEN']})
    with opener.open(request, timeout=40) as response:
        variable = json.load(response)
    if variable.get('target') != ['development'] or not variable.get('key', '').startswith('AV_RECOVERY_KEY_'):
        raise ValueError('Unexpected recovery key scope')
    key = base64.b64decode(variable['value'], validate=True)
    request = urllib.request.Request('https://api.github.com/repos/Imluckyluke/animeverse/releases/assets/' + str(args.asset),
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/octet-stream',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AnimeVerse-Owner-Recovery'})
    try:
        response = opener.open(request, timeout=180)
    except urllib.error.HTTPError as error:
        from urllib.parse import urlsplit
        url = error.headers.get('Location', '')
        host = urlsplit(url).hostname or ''
        if error.code not in {301, 302, 303, 307, 308} or not url.startswith('https://') or not host.endswith('.githubusercontent.com'):
            raise
        response = opener.open(urllib.request.Request(url), timeout=180)
    with response:
        encrypted = response.read()
    magic = b'ANIMEVERSE-BACKUP-1\0'
    if not encrypted.startswith(magic):
        raise ValueError('Unsupported recovery bundle')
    offset = len(magic)
    raw = AESGCM(key).decrypt(encrypted[offset:offset + 12], encrypted[offset + 12:], b'AnimeVerse private production recovery v1')
    args.output.mkdir(mode=0o700, parents=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as bundle:
        manifest = json.loads(bundle.read('manifest.json'))
        if manifest.get('format') != 'animeverse-backup/v1':
            raise ValueError('Unsupported recovery manifest')
        for entry in manifest['files']:
            name, archive = entry['name'], entry['archive']
            if Path(name).name != name or Path(archive).name != archive or name in {'.', '..'}:
                raise ValueError('Unsafe recovery filename')
            contents = gzip.decompress(bundle.read(archive))
            if hashlib.sha256(contents).hexdigest() != entry['sha256']:
                raise ValueError('Recovery hash mismatch')
            target = args.output / name
            target.write_bytes(contents)
            if entry['kind'] == 'sqlite':
                with sqlite3.connect('file:' + str(target.resolve()) + '?mode=ro', uri=True) as db:
                    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                        raise ValueError('Restored SQLite integrity failure')
            elif entry['kind'] == 'json':
                json.loads(contents)
            else:
                raise ValueError('Unsupported restored file kind')
        hashes = json.loads(bundle.read('source-manifest.json'))
        source = args.output / 'source'
        source.mkdir(mode=0o700)
        with zipfile.ZipFile(io.BytesIO(bundle.read('source.zip'))) as archive:
            if set(archive.namelist()) != set(hashes):
                raise ValueError('Source inventory mismatch')
            for name, digest in hashes.items():
                if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name:
                    raise ValueError('Unsafe source path')
                contents = archive.read(name)
                if hashlib.sha256(contents).hexdigest() != digest:
                    raise ValueError('Source hash mismatch')
                target = source / name
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                target.write_bytes(contents)
    print('FRESH_OWNER_RECOVERY_WITHOUT_ORIGINAL_SERVER_KEY_VERIFIED', len(manifest['files']), len(hashes))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('RECOVERY_FAILED', type(error).__name__)
        raise SystemExit(1) from None
