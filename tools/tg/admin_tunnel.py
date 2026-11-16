#!/usr/bin/env python3
"""Separate signed admin control tunnel; never carries episode video bytes."""
import base64
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
import time
import urllib.error
import urllib.request

API = 'https://api.github.com/repos/itisluckyluke-dev/animeverse-temporary-downloads/contents/admin-origin.json'
stopped = threading.Event()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def publish(origin):
    updated = dt.datetime.now(dt.timezone.utc).isoformat()
    signature = hmac.new(os.environ['AV_ADMIN_SERVICE_TOKEN'].encode(), ('1\n' + origin + '\n' + updated).encode(), hashlib.sha256).hexdigest()
    content = json.dumps({'version': 1, 'origin': origin, 'updatedAt': updated, 'signature': signature}) + '\n'
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'}
    opener = urllib.request.build_opener(NoRedirect())
    sha = None
    try:
        with opener.open(urllib.request.Request(API, headers=headers), timeout=30) as response:
            sha = json.load(response)['sha']
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    payload = {'message': 'Refresh signed admin control origin', 'content': base64.b64encode(content.encode()).decode()}
    if sha:
        payload['sha'] = sha
    with opener.open(urllib.request.Request(API, data=json.dumps(payload).encode(), headers=headers, method='PUT'), timeout=30) as response:
        if response.status not in (200, 201):
            raise RuntimeError('Admin discovery publication failed')
    print('SIGNED_ADMIN_ORIGIN_PUBLISHED', flush=True)


def healthy(origin):
    try:
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(origin + '/health', timeout=15) as response:
            result = json.loads(response.read(4096))
            return response.status == 200 and result.get('ok') is True and result.get('service') == 'animeverse-admin'
    except Exception:
        return False


def heartbeat(origin, process):
    published_at, failures = time.monotonic(), 0
    while not stopped.wait(60):
        failures = 0 if healthy(origin) else failures + 1
        if failures >= 3:
            # A live cloudflared process is not proof its public DNS/edge works.
            # Exit the child so systemd restarts and republishes a fresh origin.
            print('ADMIN_PUBLIC_TUNNEL_UNREACHABLE_RECONNECTING', flush=True)
            if not stopped.is_set():
                process.terminate()
            return
        if time.monotonic() - published_at >= 12 * 3600:
            try:
                publish(origin)
                published_at = time.monotonic()
            except Exception:
                print('ADMIN_ORIGIN_REFRESH_FAILED', flush=True)


def main():
    binary = Path.home() / '.cache/animeverse-download-cache/cloudflared'
    environment = {key: value for key, value in os.environ.items() if not any(part in key.upper() for part in ('TOKEN', 'PASSWORD', 'SECRET', 'SESSION', 'OWNER_HASH'))}
    process = subprocess.Popen([str(binary), '--no-autoupdate', 'tunnel', '--protocol', 'http2', '--url', 'http://127.0.0.1:3041'],
                               env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    def stop(*args):
        stopped.set()
        process.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    published = False
    try:
        for line in process.stdout:
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if match and not published:
                publish(match[0])
                threading.Thread(target=heartbeat, args=(match[0], process), daemon=True).start()
                published = True
            if 'Registered tunnel connection' in line:
                print('ADMIN_TUNNEL_CONNECTED', flush=True)
        code = process.wait()
        if not stopped.is_set():
            raise SystemExit(code or 1)
    finally:
        stopped.set()
        if process.poll() is None:
            process.terminate()


if __name__ == '__main__':
    main()
