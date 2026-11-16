#!/usr/bin/env python3
"""Authenticated TLS API plus one streaming Telegram → GitHub worker.

Secrets are read from an external environment file by systemd. Videos are
streamed with bounded buffers; no media files or Telegram credentials are
written into either public repository.
"""
from __future__ import annotations

import asyncio
import contextlib
import fcntl
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import ssl
import threading
import time
from urllib.parse import urlparse
import uuid

import aiohttp
from telethon import TelegramClient, errors
from telethon.sessions import StringSession

from common import API_ID, API_HASH, ROOT, read_session
from download_cache import CacheError, CacheStore, ReadyCatalog, REPOSITORIES
from local_downloads import LocalStore, MediaServer

PRIVATE = Path(os.environ.get('AV_CACHE_PRIVATE', str(Path.home()/'.local/share/animeverse-download-cache')))
TOKEN = os.environ.get('AV_CACHE_API_TOKEN', '')


class GitHub:
    def __init__(self, session):
        self.session = session
        self.releases = {}

    async def api(self, method, path, data=None, missing_ok=False):
        if not path.startswith('/repos/'):
            raise ValueError('GitHub API scope rejected')
        async with self.session.request(method, 'https://api.github.com'+path, json=data,
                headers={'Authorization':'Bearer '+os.environ['GH_TOKEN'], 'Accept':'application/vnd.github+json',
                         'X-GitHub-Api-Version':'2022-11-28'}, allow_redirects=False,
                timeout=aiohttp.ClientTimeout(total=60)) as response:
            if response.status == 404 and missing_ok:
                return None
            if response.status == 204:
                return None
            if response.status not in (200,201):
                raise CacheError('ارتباط با مخزن دانلود انجام نشد.', 503)
            return await response.json()

    async def release(self, bucket):
        current = self.releases.get(bucket)
        if current and len(current['assets']) < 900:
            return current
        repo = REPOSITORIES[bucket]
        releases = await self.api('GET',f'/repos/{repo}/releases?per_page=100')
        current = next((r for r in releases if r['tag_name'].startswith('av-cache-') and not r['draft'] and len(r['assets'])<900),None)
        if not current:
            tag = 'av-cache-'+time.strftime('%Y%m%d')+'-'+uuid.uuid4().hex[:8]
            current = await self.api('POST',f'/repos/{repo}/releases',{
                'tag_name':tag,'name':'AnimeVerse '+('popular' if bucket=='hot' else 'temporary')+' download cache',
                'body':'Managed download cache. Temporary links may expire after inactivity. No account credentials or private catalog data are published.',
                'draft':False,'prerelease':False})
        self.releases[bucket] = current
        return current

    async def upload(self, bucket, name, size, chunks, digest):
        repo = REPOSITORIES[bucket]
        release = await self.release(bucket)
        existing = next((a for a in release['assets'] if a['name']==name), None)
        if existing:
            if existing['state']=='uploaded' and existing['size']==size and existing.get('digest','').startswith('sha256:'):
                return existing, existing['digest'].removeprefix('sha256:')
            # Only clean up our own deterministic asset name after an aborted
            # upload; unrelated assets and release history are never touched.
            await self.api('DELETE',f'/repos/{repo}/releases/assets/{existing["id"]}',missing_ok=True)
            release['assets'] = [a for a in release['assets'] if a['id']!=existing['id']]
        from urllib.parse import quote
        url = f'https://uploads.github.com/repos/{repo}/releases/{release["id"]}/assets?name={quote(name)}'
        async with self.session.post(url,data=chunks,headers={
            'Authorization':'Bearer '+os.environ['GH_TOKEN'], 'Content-Type':'application/octet-stream',
            'Content-Length':str(size),'Accept':'application/vnd.github+json',
            'X-GitHub-Api-Version':'2022-11-28'},allow_redirects=False,
            timeout=aiohttp.ClientTimeout(total=7200,sock_connect=30,sock_read=120)) as response:
            if response.status != 201:
                self.releases.pop(bucket,None)
                raise CacheError('بارگذاری فایل کامل نشد؛ دوباره تلاش می‌شود.',503)
            asset = await response.json()
        if asset.get('state')!='uploaded' or asset.get('size')!=size or asset.get('digest')!='sha256:'+digest.hexdigest():
            raise CacheError('صحت فایل بارگذاری‌شده تأیید نشد.',502)
        release['assets'].append(asset)
        return asset,digest.hexdigest()

    async def delete(self, repo, asset_id):
        if repo not in REPOSITORIES.values():
            raise ValueError('Cleanup scope rejected')
        await self.api('DELETE',f'/repos/{repo}/releases/assets/{int(asset_id)}',missing_ok=True)
        for release in self.releases.values():
            release['assets'] = [a for a in release['assets'] if a['id']!=asset_id]


async def transfer(client, github, store, job):
    message = await client.get_messages('testanivers',ids=job['source_id'])
    if not message or not message.document or not message.file or not message.file.size:
        raise CacheError('فایل مبدأ دیگر در آرشیو در دسترس نیست.',404)
    size = message.file.size
    extension = Path(message.file.name or '').suffix.lower()
    if extension not in {'.mp4','.mkv','.webm','.avi','.mov','.m4v'}:
        raise CacheError('نوع فایل برای دانلود ویدئو معتبر نیست.',415)
    bucket = 'hot' if job['requests']>=store.hot_after else 'temp'
    if job['bucket']=='hot':
        bucket = 'hot'
    store.reserve(job['key'],size,bucket)
    quality = re.sub(r'[^a-zA-Z0-9-]','-',job['quality']).strip('-')
    name = f'AV-{job["slug"][:110]}-EP{job["episode"]}-{quality}-{job["key"][:16]}{extension}'
    digest = hashlib.sha256()

    async def chunks():
        count,last_report = 0,0.0
        async for chunk in client.iter_download(message.media,request_size=512*1024,chunk_size=512*1024):
            if not store.has_active_demand(job['key']):
                raise CacheError('انتقال متوقف شد.',409)
            count += len(chunk)
            if count>size:
                raise CacheError('اندازهٔ فایل مبدأ تغییر کرده است.',502)
            digest.update(chunk)
            if time.monotonic()-last_report>1:
                store.progress(job['key'],count)
                last_report = time.monotonic()
            yield chunk
        if count!=size:
            raise CacheError('دریافت فایل مبدأ کامل نشد.',502)

    if isinstance(store, LocalStore):
        await store.receive(client,message,job,name,size,
                            streams=int(os.environ.get('AV_LOCAL_DOWNLOAD_STREAMS','4')))
        with contextlib.suppress(OSError):
            print('CACHE_LOCAL_FILE_READY',job['key'][:12],size,flush=True)
        return

    asset,checksum = await github.upload(bucket,name,size,chunks(),digest)
    store.finish(job['key'],bucket,asset,checksum)
    print('CACHE_FILE_READY',job['key'][:12],bucket,size,flush=True)


async def worker(store, stopped):
    # StringSession is memory-only, so this process does not contend with the
    # existing archive service's SQLite session or rewrite its credentials.
    client = TelegramClient(StringSession(read_session()),API_ID,API_HASH,
        receive_updates=False,flood_sleep_threshold=0,request_retries=2,connection_retries=3)
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError('Telegram archive session is not authorized')
    last_cleanup = 0.0
    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(limit=2)) as session:
            github = None if isinstance(store, LocalStore) else GitHub(session)
            while not stopped.is_set():
                if isinstance(store, LocalStore):
                    store.cleanup()
                elif time.monotonic()-last_cleanup>300:
                    rows,retired = store.expired_assets()
                    for row in rows:
                        try:
                            await github.delete(REPOSITORIES[row['bucket']],row['asset_id'])
                            store.deleted(row['key'])
                        except Exception:
                            with store.transaction():
                                store.db.execute("UPDATE jobs SET state='ready' WHERE key=? AND state='deleting'",(row['key'],))
                    for row in retired:
                        try:
                            await github.delete(row['repo'],row['asset_id'])
                            with store.transaction():
                                store.db.execute('DELETE FROM retired WHERE repo=? AND asset_id=?',(row['repo'],row['asset_id']))
                        except Exception:
                            pass
                    last_cleanup = time.monotonic()
                job = store.claim()
                if not job:
                    await asyncio.sleep(2)
                    continue
                try:
                    await transfer(client,github,store,job)
                except errors.FloodWaitError as error:
                    delay = max(1,error.seconds)
                    store.fail(job['key'],'تلگرام درخواست وقفه داده است؛ انتقال بعداً ادامه پیدا می‌کند.',delay)
                    print('CACHE_TELEGRAM_COOLDOWN',delay,flush=True)
                    # Obey the complete Telegram wait; never retry it early.
                    await asyncio.sleep(delay)
                except Exception as error:
                    if not store.has_active_demand(job['key']):
                        store.suspend(job['key'])
                        if github:
                            github.releases.clear()
                        continue
                    message = str(error) if isinstance(error,CacheError) else 'انتقال انجام نشد؛ کمی بعد دوباره تلاش کن.'
                    if isinstance(error,CacheError) and 'ظرفیت' in message:
                        store.defer(job['key'],message)
                    else:
                        store.fail(job['key'],message,min(1800,60*max(1,job['attempts'])),permanent=isinstance(error,CacheError) and error.status in (404,413,415))
                    print('CACHE_JOB_RETRY',job['key'][:12],type(error).__name__,flush=True)
    finally:
        await client.disconnect()


class CacheHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    slots = threading.BoundedSemaphore(16)

    def get_request(self):
        connection,address = super().get_request()
        connection.settimeout(5)
        try:
            return self.tls_context.wrap_socket(connection,server_side=True),address
        except BaseException:
            connection.close()
            raise

    def process_request(self, request, address):
        request.settimeout(8)
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request,address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request,address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'AnimeVerseCache'

    def log_message(self,*args):
        pass

    def reply(self,status,payload):
        body = json.dumps(payload,ensure_ascii=False).encode()
        self.send_response(status)
        for name,value in [('Content-Type','application/json; charset=utf-8'),('Cache-Control','no-store'),('Content-Length',str(len(body))),('X-Content-Type-Options','nosniff')]:
            self.send_header(name,value)
        if status in (202,429,503):
            self.send_header('Retry-After','4' if status==202 else '60')
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        expected = 'Bearer '+TOKEN
        supplied = self.headers.get('Authorization','')
        return len(supplied)<200 and bool(TOKEN) and hmac.compare_digest(supplied.encode(),expected.encode())

    def do_GET(self):
        if self.path=='/health':
            self.reply(200,{'ok':True,'service':'animeverse-download-cache'})
            return
        if not self.authorized():
            self.reply(401,{'error':'Unauthorized'})
            return
        match = re.fullmatch(r'/v1/(jobs|batches)/([a-f0-9]{64})',self.path)
        if not match:
            self.reply(404,{'error':'Not found'})
            return
        try:
            result = self.server.store.public_batch(match[2]) if match[1]=='batches' else self.server.store.public(match[2])
            self.reply(200 if result['status']=='ready' else 202,result)
        except CacheError as error:
            self.reply(error.status,{'error':str(error)})

    def do_POST(self):
        self.close_connection = True
        if not self.authorized():
            self.reply(401,{'error':'Unauthorized'})
            return
        try:
            length = int(self.headers.get('Content-Length','0'))
            if self.path not in ('/v1/downloads','/v1/batches','/v1/controls') or not 0<length<=4096:
                raise CacheError('درخواست نامعتبر است.')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload,dict):
                raise CacheError('درخواست نامعتبر است.')
            if self.path=='/v1/controls':
                if payload.get('action') not in ('pause','resume') or type(payload.get('batch')) is not bool:
                    raise CacheError('درخواست معتبر نیست.',400)
                result=self.server.store.control_request(payload.get('requestId'),payload.get('id'),payload['batch'],payload['action']=='pause',payload.get('job'))
                self.reply(200,result)
                return
            if self.path=='/v1/batches':
                items=self.server.catalog.resolve_all(payload.get('slug'),payload.get('quality'))
                batch=self.server.store.request_batch(items,payload.get('client',''),payload.get('requestId',''))
                result=self.server.store.public_batch(batch)
            else:
                if type(payload.get('episode')) is not int:
                    raise CacheError('درخواست نامعتبر است.')
                item = self.server.catalog.resolve(payload.get('slug'),payload['episode'],payload.get('quality'))
                row = self.server.store.request(item,payload.get('client',''),payload.get('requestId',''))
                result = self.server.store.public(row['key'])
            self.reply(200 if result['status']=='ready' else 202,result)
        except CacheError as error:
            self.reply(error.status,{'error':str(error)})
        except (ValueError,TypeError):
            self.reply(400,{'error':'درخواست نامعتبر است.'})
        except Exception:
            self.reply(503,{'error':'سرویس دانلود موقتاً در دسترس نیست.'})


def main():
    if len(TOKEN)<32 or (os.environ.get('AV_CACHE_STORAGE')!='local' and not os.environ.get('GH_TOKEN')):
        raise SystemExit('Private cache credentials are not configured')
    PRIVATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    lock = (PRIVATE/'worker.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if os.environ.get('AV_CACHE_STORAGE')=='local':
        store = LocalStore(PRIVATE/'cache.sqlite',PRIVATE/'media',TOKEN,
                           limit=int(os.environ.get('AV_LOCAL_LIMIT','16106127360')),
                           read_wait=float(os.environ.get('AV_LOCAL_READ_WAIT','45')),
                           stall_seconds=float(os.environ.get('AV_LOCAL_STALL_SECONDS','90')))
        media = MediaServer(('127.0.0.1',8788),store)
        threading.Thread(target=media.serve_forever,daemon=True).start()
    else:
        store = CacheStore(PRIVATE/'cache.sqlite',ttl=int(os.environ.get('AV_CACHE_TTL','86400')))

    server = CacheHTTPServer(('127.0.0.1',int(os.environ.get('AV_CACHE_PORT','8443'))),Handler)
    server.store,server.catalog = store,ReadyCatalog(ROOT/'src/lib/real-catalog.json')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(str(PRIVATE/'server.crt'),str(PRIVATE/'server.key'))
    server.tls_context = context
    stopped = threading.Event()
    if isinstance(store, LocalStore):
        def janitor():
            while not stopped.wait(10):
                try:
                    store.cleanup()
                except Exception:
                    print('CACHE_LOCAL_CLEANUP_RETRY',flush=True)
        threading.Thread(target=janitor,daemon=True).start()
    threading.Thread(target=server.serve_forever,daemon=True).start()
    for signum in (signal.SIGTERM,signal.SIGINT):
        signal.signal(signum,lambda *_:stopped.set())
    print('CACHE_SERVICE_STARTED',flush=True)
    try:
        asyncio.run(worker(store,stopped))
    finally:
        server.shutdown()


if __name__=='__main__':
    main()
