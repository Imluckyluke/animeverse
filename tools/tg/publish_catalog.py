#!/usr/bin/env python3
"""Publish changed archive catalogs to Vercel in bounded, verified batches.

No git push, no local Next server, no source rewrites. A failed candidate is
never promoted. Credentials are inherited from the service environment only.
"""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from common import DATA, DEST_USERNAME, ROOT, atomic_write_json, now_iso, read_json
from catalog import _http_url

BUILD = ROOT.parent / "builds" / "animeverse-auto-catalog"
STATUS = DATA / "catalog-publish-status.json"
CLI = ROOT.parent / ".npm/_npx/69f9afb961c37556/node_modules/vercel/dist/vc.js"
TEAM = "team_CMYIAA8VLuuOkKPGKjGcKWLy"
PROJECT = "prj_7kcm60ieJUyBrhF3wOLP5A28QYeb"
DOMAIN = "animeverse-xi.vercel.app"
INTERVAL = 1800


def message_number(url):
    match = re.fullmatch(r"https://t\.me/" + re.escape(DEST_USERNAME) + r"/(\d+)", str(url))
    return int(match[1]) if match else 0


def content_digest(root):
    digest = hashlib.sha256()
    for name in ("real-catalog.json", "admin-public-overrides.json", "generated-metadata.json", "generated-connection-identities.json", "generated-connections.json", "generated-airing.json", "generated-artwork.json", "generated-banners.json", "artwork-dimensions.json"):
        path = root / "src/lib" / name
        if path.exists():
            digest.update(name.encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def validate_catalog(rows, allow_empty=False):
    if not isinstance(rows, list) or (not rows and not allow_empty) or len({r["slug"] for r in rows}) != len(rows):
        raise RuntimeError("invalid, empty or duplicate catalog entries")
    for row in rows:
        episodes = row.get("episodeData") or []
        if not episodes:
            raise RuntimeError("title without downloadable episodes cannot be published")
        for episode in episodes:
            qualities = episode.get("qualities") or []
            if not qualities or any(q.get("status") != "done" or not _http_url(q.get("url")) for q in qualities):
                raise RuntimeError("pending or invalid download row cannot be published")


def api(path, token):
    request = urllib.request.Request("https://api.vercel.com" + path, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)


def verify(base, sample, rows=None):
    with urllib.request.urlopen(base + "/", timeout=90) as response:
        if response.status != 200:
            raise RuntimeError("homepage check failed")
    # A catalogue build cannot promote an unreachable or publicly exposed admin.
    for route in ('/api/admin/session', '/api/admin/overview'):
        try:
            urllib.request.urlopen(base + route, timeout=30)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise RuntimeError('Owner-only administration gate failed')
        else:
            raise RuntimeError('Administration is publicly accessible')
    if rows is not None:
        # Check every public title and its full episode list, not just the
        # newest copies: stale empty titles must not survive a promotion.
        with urllib.request.urlopen(base + "/api/catalog-search", timeout=90) as response:
            public_slugs = [row["slug"] for row in json.load(response)]
        if len(public_slugs) != len(rows) or set(public_slugs) != {row["slug"] for row in rows}:
            raise RuntimeError("public title inventory does not match ready-only snapshot")
        for offset in range(0, len(rows), 24):
            batch = rows[offset:offset + 24]
            query = urllib.parse.urlencode({"slugs": ",".join(row["slug"] for row in batch)})
            with urllib.request.urlopen(base + "/api/catalog-items?" + query, timeout=90) as response:
                items = {row["slug"]: row for row in json.load(response)}
            for row in batch:
                live = items.get(row["slug"])
                expected = sorted((episode["number"] for episode in row["episodeData"]), reverse=True)
                if not live or live.get("episodeNumbers") != expected or live.get("availableEpisodes") != len(expected):
                    raise RuntimeError("public episode inventory does not match ready-only snapshot")
    if not sample:
        if rows == []:
            return
        raise RuntimeError("empty catalogue sample is not verifiable")
    query = urllib.parse.urlencode({"slugs": ",".join(row["slug"] for row in sample)})
    with urllib.request.urlopen(base + "/api/catalog-items?" + query, timeout=90) as response:
        items = {row["slug"]: row for row in json.load(response)}
    for row in sample:
        live = items.get(row["slug"])
        if not live or live["highestEpisode"] != row["highestEpisode"]:
            raise RuntimeError("candidate catalog does not match snapshot")
        ready = [(episode, quality) for episode in row.get("episodeData", [])
                 for quality in episode.get("qualities", []) if quality.get("status") == "done" and quality.get("url")]
        if ready:
            episode, quality = max(ready, key=lambda pair: message_number(pair[1]["url"]))
            query = urllib.parse.urlencode({"slug": row["slug"], "ep": episode["number"], "q": quality["label"]})
            with urllib.request.urlopen(base + "/api/link?" + query, timeout=90) as response:
                link = json.load(response)
            if link.get("url") != quality["url"]:
                raise RuntimeError("published download link does not match archive copy")
    with urllib.request.urlopen(base + "/anime/" + sample[0]["slug"], timeout=90) as response:
        if response.status != 200:
            raise RuntimeError("detail page check failed")


def admin_request():
    path = DATA / 'admin.sqlite3'
    if not path.exists():
        return {'mode': 'automatic', 'commands': [], 'nonce': None}
    from admin_store import AdminStore
    store = AdminStore(path)
    try:
        request = read_json(DATA / 'admin-publish-request.json', {}) or {}
        commands = []
        for ident in request.get('commands', []):
            row = store.db.execute("SELECT id FROM admin_commands WHERE id=? AND kind='publish' AND state='running'", (ident,)).fetchone()
            if row:
                commands.append(ident)
        return {'mode': store.settings()['publicationMode'], 'commands': commands, 'nonce': request.get('nonce')}
    finally:
        store.close()


def acknowledge_admin(status, rows, root, request):
    if status.get('state') != 'verified':
        raise RuntimeError('Unverified publication cannot be acknowledged')
    manifest = read_json(root / 'src/lib/admin-public-overrides.json', {}) or {}
    revisions = {slug: item['revision'] for slug, item in manifest.get('overrides', {}).items()}
    atomic_write_json(DATA / 'admin-published-catalog.json', {'publishedAt': status.get('publishedAt'), 'deploymentId': status.get('deploymentId'),
        'slugs': [row['slug'] for row in rows], 'revisions': revisions, 'verifiedAt': now_iso()})
    if (DATA / 'admin.sqlite3').exists():
        from admin_store import AdminStore
        from notification_store import Notifications
        store = AdminStore(DATA / 'admin.sqlite3')
        try:
            Notifications(store).publication(rows, status['deploymentId'])
        finally:
            store.close()
    if not request['commands']:
        return
    from admin_store import AdminStore
    store = AdminStore(DATA / 'admin.sqlite3')
    try:
        for ident in request['commands']:
            with store.transaction():
                command = store.db.execute("SELECT * FROM admin_commands WHERE id=? AND state='running'", (ident,)).fetchone()
                if command:
                    store.audit(command['actor'], 'publish.verified', status.get('deploymentId') or '', {},
                                {'deploymentId': status.get('deploymentId'), 'titles': len(rows)}, 'نسخهٔ عمومی با فایل‌های آماده تأیید شد')
                    store.finish_command(ident, 'applied')
    finally:
        store.close()


def publish(force=False):
    token = os.environ.get("VERCEL_TOKEN", "")
    if not token:
        raise RuntimeError("VERCEL_TOKEN missing from publisher service environment")
    old = read_json(STATUS, {}) or {}
    request = admin_request()
    manual = bool(request['commands'])
    if not force and request['mode'] == 'manual' and not manual:
        return
    if not force and not manual and time.time() - old.get("lastAttemptAt", 0) < INTERVAL:
        return
    source = ROOT / "src/lib/real-catalog.json"
    try:
        from connection_identities import refresh_connection_data
        report = refresh_connection_data(json.loads(source.read_text()), ROOT, max_requests=24, time_budget=120)
        if report.get('attempted'):
            print('CONNECTION_IDENTITY_REFRESH', report.get('fetched', 0), report.get('status'), flush=True)
    except Exception as error:
        print('CONNECTION_IDENTITY_REFRESH_SKIPPED', type(error).__name__, flush=True)
    # Public schedule refresh is independent of Telegram/archive acquisition.
    # The worker's own freshness/rate guards keep provider calls bounded.
    try:
        from airing_schedule import enrich as refresh_airing
        report = refresh_airing(json.loads(source.read_text()), ROOT)
        if report.get('attempted'):
            print('AIRING_SCHEDULE_REFRESH', report.get('fetched', 0), report.get('status'), flush=True)
    except Exception as error:
        print('AIRING_SCHEDULE_REFRESH_SKIPPED', type(error).__name__, flush=True)
    digest = content_digest(ROOT)
    if not force and digest == old.get("publishedDigest") and not manual:
        return
    status = {**old, "state": "snapshot", "lastAttemptAt": time.time(), "updatedAt": now_iso(), 'adminCommandIds': request['commands']}
    atomic_write_json(STATUS, status)
    BUILD.mkdir(parents=True, exist_ok=True)
    command = ["rsync", "-a"]
    for item in ("node_modules", ".next", ".git", ".vercel", "android", "data", "logs", "tools", "scripts", ".env*", "*.tsbuildinfo", "*.session*", "tests"):
        command += ["--exclude=" + item]
    command += [str(ROOT) + "/", str(BUILD) + "/"]
    subprocess.run(command, check=True, timeout=120)
    for attempt in range(3):
        manifest = read_json(BUILD / 'src/lib/admin-public-overrides.json', {}) or {}
        expected = manifest.get('catalogSha256')
        if not expected or expected == hashlib.sha256((BUILD / 'src/lib/real-catalog.json').read_bytes()).hexdigest():
            break
        subprocess.run(command, check=True, timeout=120)
    else:
        raise RuntimeError('Catalogue snapshot changed during copy; production unchanged')
    # No credentials or private archive database enter the deployment.
    rows = json.loads((BUILD / "src/lib/real-catalog.json").read_text())
    validate_catalog(rows, allow_empty=(read_json(BUILD / 'src/lib/admin-public-overrides.json', {}) or {}).get('allowEmpty') is True)
    digest = content_digest(BUILD)
    def latest_copy(row):
        return max((message_number(q.get("url")) for e in row.get("episodeData", [])
                    for q in e.get("qualities", []) if q.get("status") == "done"), default=0)
    sample = sorted(rows, key=latest_copy, reverse=True)[:3]
    if manual and not force and digest == old.get('publishedDigest'):
        verify('https://' + DOMAIN, sample, rows)
        status.update(state='verified', updatedAt=now_iso(), lastError='')
        atomic_write_json(STATUS, status)
        acknowledge_admin(status, rows, BUILD, request)
        return
    transport = None
    try:
        try:
            with socket.create_connection(("127.0.0.1", 3014), timeout=2):
                pass
        except OSError:
            transport = subprocess.Popen(["/usr/bin/python3", str(ROOT.parent / ".cache/visual-qa/vercel-transport.py")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(30):
                try:
                    with socket.create_connection(("127.0.0.1", 3014), timeout=1):
                        break
                except OSError:
                    time.sleep(.2)
        env = dict(os.environ, VERCEL_ORG_ID=TEAM, VERCEL_PROJECT_ID=PROJECT,
            NO_UPDATE_NOTIFIER="1", VERCEL_TELEMETRY_DISABLED="1", NEXT_PUBLIC_SITE_URL="https://" + DOMAIN)
        prefix = ["/usr/bin/node", str(CLI)]
        auth = ["--api", "http://127.0.0.1:3014", "--token", token]
        status["state"] = "building"
        atomic_write_json(STATUS, status)
        try:
            result = subprocess.run(prefix + ["deploy", "--yes", "--prod", "--skip-domain"] + auth,
                cwd=BUILD, env=env, capture_output=True, text=True, timeout=1800)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Deployment timed out; production was not promoted') from None
        output = (result.stdout + result.stderr).replace(token, "[redacted]")
        (ROOT / "logs/catalog-deploy.log").write_text(output)
        if result.returncode:
            raise RuntimeError("Vercel candidate build failed; production unchanged")
        urls = re.findall(r"https://animeverse-[a-z0-9-]+\.vercel\.app", output)
        if not urls:
            raise RuntimeError("deployment URL missing")
        deployment = api("/v13/deployments/" + urls[-1].removeprefix("https://") + "?teamId=" + TEAM, token)
        if deployment["projectId"] != PROJECT or deployment["readyState"] != "READY":
            raise RuntimeError("wrong project or deployment not ready")
        candidate = "https://" + deployment["url"]
        verify(candidate, sample, rows)
        try:
            result = subprocess.run(prefix + ["promote", deployment["url"], "--yes"] + auth,
                cwd=BUILD, env=env, capture_output=True, text=True, timeout=180)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Promotion timed out; verify the production alias') from None
        if result.returncode:
            raise RuntimeError("promotion failed")
        alias = api("/v4/aliases/" + DOMAIN + "?teamId=" + TEAM, token)
        if (alias.get("deployment", {}).get("id") or alias.get("deploymentId")) != deployment["id"]:
            raise RuntimeError("production alias does not match candidate")
        verify("https://" + DOMAIN, sample, rows)
        status.update(state="verified", publishedDigest=digest, deploymentId=deployment["id"],
            publishedAt=now_iso(), catalogCount=len(rows), lastError="", updatedAt=now_iso())
        atomic_write_json(STATUS, status)
        acknowledge_admin(status, rows, BUILD, request)
        print("CATALOG_PUBLISHED", deployment["id"], len(rows), flush=True)
    finally:
        if transport:
            transport.terminate()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        print(json.dumps({"vercelCredentialPresent": bool(os.environ.get("VERCEL_TOKEN")), "cliAvailable": CLI.exists()}))
        return
    (ROOT / "logs").mkdir(exist_ok=True)
    with (DATA / "catalog-publisher.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                publish(args.force)
            except Exception as exc:
                old = read_json(STATUS, {}) or {}
                old.update(state="error", lastError=type(exc).__name__ + ": " + str(exc), updatedAt=now_iso())
                atomic_write_json(STATUS, old)
                if old.get('adminCommandIds') and (DATA / 'admin.sqlite3').exists():
                    from admin_store import AdminStore
                    store = AdminStore(DATA / 'admin.sqlite3')
                    try:
                        for ident in old['adminCommandIds']:
                            if store.get_command(ident)['state'] == 'running':
                                store.finish_command(ident, 'failed', 'نتیجهٔ انتشار تأیید نهایی نشد؛ وضعیت نسخهٔ عمومی را بررسی کن.')
                    finally:
                        store.close()
                print("CATALOG_PUBLISH_ERROR", type(exc).__name__, flush=True)
                if args.once:
                    raise
            if args.once:
                break
            time.sleep(60)


if __name__ == "__main__":
    main()
