#!/usr/bin/env python3
"""Private scheduled backup/monitor entrypoint. Never log credential values."""
import argparse
import datetime as dt
import fcntl
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import zipfile

from offsite_backup import GitHub, VercelRecoveryVault, decrypt, encrypt, recovery_key
from production_ops import (_http_status, _systemd_probe, _write_private_json, create_snapshot_package,
                            run_health_check, verify_restored_package)

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
PRIVATE = Path('/var/lib/bot-host/.local/share/animeverse-ops')
CONFIG = Path('/var/lib/bot-host/.config/animeverse-ops')
STATUS = PRIVATE / 'backup-status.json'
RESUME = PRIVATE / 'archive-resume-required.json'
HELPER = '/var/lib/bot-host/.ssh/rsudo.py'


def stamp():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def archive_service(command):
    result = subprocess.run(['python3', HELPER, 'systemctl ' + command + ' animeverse-archive-pipeline.service'],
                            capture_output=True, text=True, timeout=180)
    if result.returncode or 'RC 0' not in result.stdout.splitlines():
        raise RuntimeError('Archive service operation failed')


def notify(message):
    token = os.environ['TELEGRAM_BOT_TOKEN']
    user = (CONFIG / 'owner-chat-id').read_text().strip()
    authorized = {value.strip() for value in os.environ['TELEGRAM_ALLOWED_USER_ID'].split(',')}
    if not user.isdecimal() or user not in authorized:
        raise ValueError('Owner notification recipient must be one exact user')
    labels = {'service:animeverse-archive-pipeline.service': 'انتقال آرشیو',
              'service:animeverse-catalog-publisher.service': 'انتشار سایت',
              'service:animeverse-download-cache.service': 'آماده‌سازی دانلود',
              'service:animeverse-download-cache-tunnel.service': 'اتصال دانلود',
              'service:animeverse-admin.service': 'پنل مدیریت',
              'service:animeverse-admin-tunnel.service': 'اتصال پنل مدیریت',
              'disk': 'فضای دیسک', 'disk-minimum': 'فضای آزاد دیسک',
              'homepage': 'دسترسی سایت', 'backup': 'بکاپ خارج از سرور'}
    recovery = 'health recovered' in message
    title = '✅ انیمه‌ورس: مشکل برطرف شد' if recovery else '⚠️ انیمه‌ورس: نیاز به بررسی'
    if 'TEST_ONLY' in message:
        title = '✅ آزمایش بازیابی هشدار' if recovery else '⚠️ آزمایش هشدار؛ خرابی واقعی نیست'
    items = [label for key, label in labels.items() if ('- ' + key + ':') in message]
    text = title + '\n' + '\n'.join('• ' + label for label in items)
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage',
        data=json.dumps({'chat_id': int(user), 'text': text, 'disable_web_page_preview': True}).encode(),
        headers={'Content-Type': 'application/json'}, method='POST')
    # No exception text is logged: Telegram request URLs contain a credential.
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
        if result.get('ok') is not True:
            raise RuntimeError('Owner notification was not acknowledged')
    except Exception:
        raise RuntimeError('Owner notification delivery failed') from None
    return True


def source_archive():
    allowed = {'.py', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '.md', '.jpg', '.jpeg',
               '.png', '.webp', '.svg', '.ico', '.webmanifest', '.woff', '.woff2', '.service', '.timer', '.txt'}
    files = []
    for name in ('src', 'public', 'tools', 'tests', 'docs'):
        for path in (ROOT / name).rglob('*'):
            if path.is_file() and not path.is_symlink() and path.suffix in allowed and '__pycache__' not in path.parts:
                files.append(path)
    for name in ('package.json', 'package-lock.json', 'next.config.mjs', 'tsconfig.json',
                 'postcss.config.mjs', 'eslint.config.mjs', 'next-env.d.ts', 'README.md', 'AGENTS.md', '.gitignore'):
        path = ROOT / name
        if path.is_file() and not path.is_symlink():
            files.append(path)
    memory = io.BytesIO()
    manifest = {}
    with zipfile.ZipFile(memory, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=3) as archive:
        for path in sorted(set(files)):
            name = path.relative_to(ROOT).as_posix()
            raw = path.read_bytes()
            archive.writestr(name, raw)
            manifest[name] = hashlib.sha256(raw).hexdigest()
    return memory.getvalue(), manifest


def backup():
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (PRIVATE / 'backup.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('BACKUP_ALREADY_RUNNING', flush=True)
            return
        try:
            previous_status = json.loads(STATUS.read_text())
        except (OSError, ValueError):
            previous_status = {}
        _write_private_json(STATUS, {**previous_status, 'state': 'running', 'startedAt': stamp()})
        key = recovery_key(CONFIG / 'recovery.key')
        remote_key, reference = VercelRecoveryVault(os.environ['VERCEL_TOKEN']).store_and_recover(key)
        with tempfile.TemporaryDirectory(prefix='recovery-', dir=PRIVATE) as folder:
            folder = Path(folder)
            package = folder / 'package'
            databases = [DATA / 'archive-pipeline.sqlite3', DATA / 'admin.sqlite3',
                         Path('/var/lib/bot-host/.local/share/animeverse-download-cache/cache.sqlite')]
            names = ('aniplus-state.json', 'aniplus-links.json', 'archive-identity-cache.json',
                     'catalog-publish-status.json', 'admin-published-catalog.json',
                     'link-click-certified-plan.json', 'link-click-review-applied.json',
                     'link-click-reference-review.json', 'link-click-artwork-proof.json')
            # Stop only the archive writer briefly for a consistent DB+JSON
            # recovery point. Web/account/download services remain online.
            required = [DATA / name for name in names]
            if not all(path.is_file() for path in required):
                raise RuntimeError('Required production recovery state is missing')
            was_active = subprocess.run(['systemctl', 'is-active', 'animeverse-archive-pipeline.service'], capture_output=True, text=True).stdout.strip() == 'active'
            if was_active:
                _write_private_json(RESUME, {'required': True, 'createdAt': stamp(),
                                           'invocationId': os.environ.get('INVOCATION_ID', 'manual')})
                archive_service('stop')
            try:
                create_snapshot_package(databases, package, json_files=required)
            finally:
                if was_active:
                    archive_service('start')
                    RESUME.unlink(missing_ok=True)
            source, hashes = source_archive()
            outer = io.BytesIO()
            with zipfile.ZipFile(outer, 'w', compression=zipfile.ZIP_STORED) as archive:
                for path in sorted(package.iterdir()):
                    archive.write(path, path.name)
                archive.writestr('source.zip', source)
                archive.writestr('source-manifest.json', json.dumps(hashes, sort_keys=True))
            encrypted = encrypt(outer.getvalue(), key)
            github = GitHub(os.environ['GH_TOKEN'])
            target = github.request('/repos/' + github.repository + '/commits/master')['sha']
            tag = 'production-recovery-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            downloaded, report = github.upload_and_download(encrypted, tag, target, reference)
            # Restore from the bytes downloaded from GitHub and the key fetched
            # from Vercel, not the local upload/key variables.
            recovered = decrypt(downloaded, remote_key)
            restore = folder / 'restored'
            restore.mkdir(mode=0o700)
            with zipfile.ZipFile(io.BytesIO(recovered)) as archive:
                manifest = json.loads(archive.read('manifest.json'))
                (restore / 'manifest.json').write_text(json.dumps(manifest))
                for item in manifest['files']:
                    assert Path(item['name']).name == item['name'] and Path(item['archive']).name == item['archive']
                    (restore / item['name']).write_bytes(gzip.decompress(archive.read(item['archive'])))
                checked = verify_restored_package(restore / 'manifest.json', restore)
                expected_hashes = json.loads(archive.read('source-manifest.json'))
                with zipfile.ZipFile(io.BytesIO(archive.read('source.zip'))) as sources:
                    assert set(sources.namelist()) == set(expected_hashes)
                    for name, digest in expected_hashes.items():
                        assert not Path(name).is_absolute() and '..' not in Path(name).parts
                        assert hashlib.sha256(sources.read(name)).hexdigest() == digest
            # Prove account preferences and accepted requests survive restoration.
            counts = {}
            for database, tables in [('admin.sqlite3', ('users', 'preferences')),
                                     ('cache.sqlite', ('requests', 'batches', 'jobs'))]:
                with sqlite3.connect('file:' + str(restore / database) + '?mode=ro', uri=True) as db:
                    for table in tables:
                        if db.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone():
                            counts[database + ':' + table] = db.execute('SELECT count(*) FROM ' + table).fetchone()[0]
            report.update(state='verified', verifiedAt=stamp(), restoredFiles=checked['files'],
                          sourceFiles=len(hashes), restoredCounts=counts,
                          keyRecoveredFromSeparateProvider=True, videosIncluded=False, externalServiceSecretsIncluded=False)
            _write_private_json(STATUS, report)
            _write_private_json(DATA / 'offsite-backup-status.json', report)
            print('OFFSITE_ENCRYPTED_BACKUP_REMOTE_KEY_AND_RESTORE_VERIFIED', json.dumps(checked['files']), flush=True)


def monitor(alert_test=False):
    try:
        previous = json.loads(STATUS.read_text())
        verified = dt.datetime.fromisoformat(previous.get('verifiedAt', '').replace('Z', '+00:00')).timestamp()
        healthy_backup = previous.get('state') == 'verified' and time.time() - verified < 36 * 3600
        if previous.get('state') == 'running':
            started = dt.datetime.fromisoformat(previous.get('startedAt', '').replace('Z', '+00:00')).timestamp()
            healthy_backup = time.time() - started < 1800 and time.time() - verified < 36 * 3600
    except (OSError, ValueError, TypeError):
        healthy_backup = False
    extras = [{'key': 'backup', 'ok': healthy_backup, 'detail': 'remote restore within 36h'},
              {'key': 'disk-minimum', 'ok': shutil.disk_usage(ROOT).free >= 1024 ** 3, 'detail': 'minimum 1 GiB free'}]
    common = dict(root=ROOT, service_probe=_systemd_probe, disk_usage=shutil.disk_usage,
                  http_get=_http_status, disk_path=ROOT, min_free_percent=3.0,
                  extra_checks=extras, notifier=notify)
    if alert_test:
        # Inject a labeled check only. Never stop a production service to test
        # alerting, and never pollute normal incident state with the fixture.
        with tempfile.TemporaryDirectory(prefix='alert-test-', dir=PRIVATE) as folder:
            state = Path(folder) / 'state.json'
            common['extra_checks'] = [{'key': 'backup', 'ok': False, 'detail': 'TEST_ONLY'}]
            run_health_check(**common, state_path=state)
            common['extra_checks'] = [{'key': 'backup', 'ok': True, 'detail': 'TEST_ONLY'}]
            run_health_check(**common, state_path=state)
        print('OWNER_TELEGRAM_FAILURE_AND_RECOVERY_ALERTS_ACKNOWLEDGED', flush=True)
    else:
        result = run_health_check(**common, state_path=PRIVATE / 'monitor-state.json')
        _write_private_json(PRIVATE / 'health-status.json', {'checkedAt': stamp(), 'ok': result['ok'], 'checks': result['checks']})
        print('PRODUCTION_HEALTH_OK' if result['ok'] else 'PRODUCTION_HEALTH_INCIDENT_RECORDED', flush=True)


def main():
    os.umask(0o077)
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['backup', 'monitor', 'alert-test', 'resume-archive'])
    args = parser.parse_args()
    try:
        if args.operation == 'backup':
            backup()
        elif args.operation == 'resume-archive':
            marker = json.loads(RESUME.read_text()) if RESUME.exists() else {}
            if marker.get('required') is True and marker.get('invocationId') == os.environ.get('INVOCATION_ID', 'manual'):
                archive_service('start')
                RESUME.unlink()
            print('ARCHIVE_RESUME_SAFETY_CHECK_COMPLETE', flush=True)
        else:
            monitor(args.operation == 'alert-test')
    except Exception as error:
        if args.operation == 'backup':
            try:
                previous_status = json.loads(STATUS.read_text())
            except (OSError, ValueError):
                previous_status = {}
            _write_private_json(STATUS, {**previous_status, 'state': 'error', 'failedAt': stamp(), 'errorType': type(error).__name__})
        print('PRODUCTION_OP_FAILED', args.operation, type(error).__name__, flush=True)
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
