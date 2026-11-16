"""Private bounded media storage and signed resumable download endpoint."""
from __future__ import annotations

import hashlib
import asyncio
import hmac
import inspect
import json
import os
from pathlib import Path
import re
import shutil
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs

from download_cache import CacheStore, CacheError


class LocalStore(CacheStore):
    def __init__(self, path, media, secret, *, origin='https://anime.bayerkashan.ir',
                 limit=15*1024**3, reserve_free=3*1024**3, ttl=21600, grace=60, clock=time.time,
                 max_file=10*1024**3, read_wait=45, stall_seconds=90):
        super().__init__(path, ttl=ttl, hot_after=10**12, clock=clock)
        self.media = Path(media)
        self.media.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.secret, self.origin = secret.encode(), origin
        self.limit, self.reserve_free, self.grace = limit, reserve_free, grace
        self.max_file=max_file
        self.readers, self.coverage = {}, {}
        self.live, self.producers = {}, set()
        self.changed = threading.Condition(self.lock)
        self.read_wait, self.stall_seconds = read_wait, stall_seconds
        self.db.execute('''CREATE TABLE IF NOT EXISTS local_files (
            key TEXT PRIMARY KEY, generation TEXT, name TEXT, size INTEGER,
            expires REAL, completed REAL DEFAULT 0)''')
        self.db.execute('CREATE TABLE IF NOT EXISTS local_legacy_jobs (key TEXT PRIMARY KEY, metadata TEXT)')
        self.db.execute('''CREATE TABLE IF NOT EXISTS local_progress (
            key TEXT PRIMARY KEY,phase TEXT,updated REAL,rate REAL DEFAULT 0,
            previous_bytes INTEGER DEFAULT 0,previous_at REAL DEFAULT 0,retry_at REAL DEFAULT 0)''')
        self._queue_until, self._queue_positions = 0, {}
        # A process restart closes every reader. Incomplete transfers are retried.
        for p in self.media.glob('*.part'):
            p.unlink(missing_ok=True)
        with self.lock:self._sweep_orphans()

    def _sweep_orphans(self):
        """Only our generation-named cache artifacts, never arbitrary files."""
        referenced={row['key']+'-'+row['generation']+'.bin'
                    for row in self.db.execute('SELECT key,generation FROM local_files')}
        for path in self.media.glob('*.bin'):
            match=re.fullmatch(r'([a-f0-9]{64})-[a-f0-9]{32}\.bin',path.name)
            if (match and path.name not in referenced and not self.readers.get(match[1],0)
                    and match[1] not in self.producers):
                path.unlink(missing_ok=True)

    def set_phase(self, key, phase, retry_at=0):
        with self.transaction():
            self.db.execute('''INSERT INTO local_progress(key,phase,updated,retry_at) VALUES (?,?,?,?)
                ON CONFLICT(key) DO UPDATE SET phase=excluded.phase,updated=excluded.updated,
                rate=0,retry_at=excluded.retry_at''',(key,phase,self.clock(),retry_at))

    def claim(self):
        job=super().claim()
        if job:
            self.set_phase(job['key'],'metadata')
        return job

    def progress(self, key, count):
        now=self.clock()
        with self.transaction():
            old=self.db.execute('SELECT * FROM local_progress WHERE key=?',(key,)).fetchone()
            rate=0
            if old and old['previous_at'] and now>old['previous_at']:
                instant=max(0,count-old['previous_bytes'])/(now-old['previous_at'])
                rate=instant if not old['rate'] else old['rate']*.4+instant*.6
            self.db.execute('UPDATE jobs SET progress=? WHERE key=?',(count,key))
            self.db.execute('''INSERT OR REPLACE INTO local_progress VALUES (?,?,?,?,?,?,0)''',
                            (key,'receiving',now,rate,count,now))

    def fail(self,key,message,delay=60,permanent=False):
        # Post-commit logging/HTTP errors cannot requeue an already valid file.
        with self.lock:
            job=self.get(key)
            ready=self.db.execute('SELECT generation,expires FROM local_files WHERE key=?',(key,)).fetchone()
            if (job and job['state']=='ready' and ready and ready['expires']>self.clock()
                    and (self.media/(key+'-'+ready['generation']+'.bin')).is_file()):
                return
        super().fail(key,message,delay,permanent)
        self.set_phase(key,'failed' if permanent else 'cooldown',self.clock()+delay)

    def defer(self,key,message,delay=900):
        super().defer(key,message,delay)
        self.set_phase(key,'capacity',self.clock()+delay)

    def suspend(self,key):
        super().suspend(key)
        self.set_phase(key,'paused')

    def _positions(self):
        now=self.clock()
        if now>=self._queue_until:
            demand="""EXISTS (SELECT 1 FROM requests r LEFT JOIN request_controls c ON c.request_id=r.id
                LEFT JOIN request_job_controls j ON j.request_id=r.id AND j.key=jobs.key
                WHERE COALESCE(j.paused,c.paused,0)=0 AND (r.key=jobs.key OR r.key IN
                (SELECT 'batch:'||batch_id FROM batch_jobs WHERE key=jobs.key)))"""
            rows=self.db.execute("SELECT key FROM jobs WHERE state IN ('queued','uploading','waiting') AND "+demand+
                " ORDER BY CASE WHEN state='uploading' THEN 0 ELSE 1 END,created,episode LIMIT 5000").fetchall()
            self._queue_positions={row['key']:i for i,row in enumerate(rows)}
            self._queue_until=now+1
        return self._queue_positions

    def decorate(self, key, result):
        now=self.clock()
        with self.lock:
            metric=self.db.execute('SELECT * FROM local_progress WHERE key=?',(key,)).fetchone()
            phase=metric['phase'] if metric else result['status']
            if result['status']=='ready':phase='ready'
            elif result['status'] in ('expired','failed','deleting'):phase=result['status']
            elif result['status']=='waiting' and not self.has_active_demand(key):phase='paused'
            age=now-metric['updated'] if metric else 0
            speed=round(metric['rate']) if metric and age<8 and phase=='receiving' else 0
            if phase=='receiving' and age>15:phase='waiting_data'
            size,done=result.get('size',0),result.get('bytes',0)
            percent=100 if result['status']=='ready' else min(99.9,max(0,int(done/size*1000)/10)) if size else 0
            result.update(phase=phase,speed=speed,percent=percent,
                          queueAhead=self._positions().get(key,0),
                          updatedAt=int(metric['updated']*1000) if metric else None,
                          etaSeconds=round(max(0,size-done)/speed) if speed else None,
                          retryAt=int(metric['retry_at']*1000) if metric and metric['retry_at'] else None)
            return result

    async def receive(self, client, message, job, name, size, streams=4):
        """Download in parallel, but expose only the gap-free written prefix."""
        key=job['key']
        block=512*1024
        pieces=(size+block-1)//block
        streams=max(1,min(streams,4,pieces))
        generation,part=self.begin_stream(key,name,size)
        done,last_report=0,0.0
        finished=False
        try:
            self.set_phase(key,'receiving')
            with part.open('w+b') as output:
                output.truncate(size)
                offsets=[(pieces*i//streams)*block for i in range(streams)]
                ends=[min(size,(pieces*(i+1)//streams)*block) for i in range(streams)]
                async def write_shard(index,iterator):
                    nonlocal done,last_report
                    first=pieces*index//streams
                    count=pieces*(index+1)//streams-first
                    offset=first*block
                    remaining=min(count*block,size-offset)
                    while True:
                        try:
                            chunk=await asyncio.wait_for(anext(iterator),timeout=self.stall_seconds)
                        except StopAsyncIteration:
                            break
                        if not self.has_active_demand(key):
                            raise CacheError('آماده‌سازی متوقف شد.',409)
                        if not chunk or len(chunk)>remaining:
                            raise CacheError('اندازهٔ فایل مبدأ تغییر کرده است.',502)
                        view=memoryview(chunk)
                        while view:
                            written=os.pwrite(output.fileno(),view,offset)
                            if not written:raise OSError('Incomplete disk write')
                            offset+=written;view=view[written:]
                        done+=len(chunk);remaining-=len(chunk)
                        offsets[index]=offset
                        prefix=0
                        for position,end in zip(offsets,ends):
                            prefix=position
                            if position<end:break
                        # Hold the final byte until commit succeeds: an HTTP
                        # response cannot finish while final validation fails.
                        self.advance_stream(key,generation,min(prefix,size-1))
                        if time.monotonic()-last_report>=.5:
                            self.progress(key,done);last_report=time.monotonic()
                    if remaining:raise CacheError('دریافت فایل کامل نشد.',502)
                async def shard(index):
                    first=pieces*index//streams
                    count=pieces*(index+1)//streams-first
                    iterator=client.iter_download(message.media,offset=first*block,limit=count,
                        request_size=block,chunk_size=block).__aiter__()
                    try:
                        await write_shard(index,iterator)
                    finally:
                        # Telethon's exact-limit iterator does not return its
                        # borrowed DC sender on StopAsyncIteration by itself.
                        close=getattr(iterator,'close',None) or getattr(iterator,'aclose',None)
                        if close is not None:
                            result=close()
                            if inspect.isawaitable(result):await result
                tasks=[asyncio.create_task(shard(i)) for i in range(streams)]
                async def demand_watch():
                    while not all(task.done() for task in tasks):
                        await asyncio.sleep(.5)
                        if not self.has_active_demand(key):
                            raise CacheError('آماده‌سازی متوقف شد.',409)
                watcher=asyncio.create_task(demand_watch())
                download=asyncio.gather(*tasks)
                try:
                    complete,_=await asyncio.wait([download,watcher],return_when=asyncio.FIRST_COMPLETED)
                    if watcher in complete:watcher.result()
                    await download
                except BaseException:
                    for task in [*tasks,watcher]:task.cancel()
                    await asyncio.gather(download,*tasks,watcher,return_exceptions=True)
                    raise
                finally:
                    watcher.cancel()
                    await asyncio.gather(watcher,return_exceptions=True)
                if done!=size:raise CacheError('دریافت فایل کامل نشد.',502)
                self.progress(key,done)
                self.set_phase(key,'verifying')
                output.flush();os.fsync(output.fileno());output.seek(0)
                digest=hashlib.sha256()
                while chunk:=output.read(1024*1024):digest.update(chunk)
            self.commit_file(key,name,part,size,digest.hexdigest(),generation=generation)
            finished=True
        finally:
            if not finished:self.abort_stream(key,generation)
            with self.changed:
                self.producers.discard(key)
                self.changed.notify_all()
            part.unlink(missing_ok=True)

    def begin_stream(self,key,name,size):
        """Ephemeral grants die on restart; ready file records stay separate."""
        with self.changed:
            if key in self.producers:raise CacheError('دریافت این فایل در حال انجام است.',409)
            generation=uuid.uuid4().hex
            self.live[key]={'key':key,'generation':generation,'name':name,'size':size,'committed':0}
            self.producers.add(key)
            self.coverage.pop(key,None)
            return generation,self.media/(key+'-'+generation+'.part')

    def advance_stream(self,key,generation,prefix):
        with self.changed:
            row=self.live.get(key)
            if not row or row['generation']!=generation:raise CacheError('دریافت فایل متوقف شده است.',410)
            row['committed']=max(row['committed'],min(prefix,row['size']-1))
            self.changed.notify_all()

    def abort_stream(self,key,generation):
        with self.changed:
            if (self.live.get(key) or {}).get('generation')==generation:
                self.live.pop(key,None)
            self.changed.notify_all()

    def available(self,key,generation,offset):
        """Wait for a written byte, or fail without padding an incomplete body."""
        deadline=time.monotonic()+self.read_wait
        with self.changed:
            while True:
                ready=self.db.execute('SELECT generation,size FROM local_files WHERE key=?',(key,)).fetchone()
                if ready and ready['generation']==generation:return ready['size']
                live=self.live.get(key)
                if (not live or live['generation']!=generation or key not in self.producers
                        or not self.has_active_demand(key)):
                    raise CacheError('دریافت فایل متوقف شده است؛ دوباره تلاش کنید.',410)
                if live['committed']>offset:return live['committed']
                left=deadline-time.monotonic()
                if left<=0:raise CacheError('منتظر ادامهٔ فایل از تلگرام؛ دوباره تلاش کنید.',503)
                self.changed.wait(min(left,.5))

    def _migrate_requested(self, key):
        row=self.get(key)
        if row and row['url'].startswith('https://github.com/'):
            with self.transaction():
                self.db.execute('INSERT OR IGNORE INTO local_legacy_jobs VALUES (?,?)',(key,json.dumps(row)))
                self.db.execute("UPDATE jobs SET state='expired',url='',asset_id=NULL,progress=0,promote=0,next_attempt=0,bucket='temp' WHERE key=?",(key,))

    def request(self, item, client, request_id):
        row=super().request(item,client,request_id)
        self._migrate_requested(row['key'])
        return super().request(item,client,request_id)

    def request_batch(self, items, client, request_id):
        batch=super().request_batch(items,client,request_id)
        with self.lock:
            members=self.db.execute('SELECT key FROM batch_jobs WHERE batch_id=?',(batch,)).fetchall()
        for row in members:
            self._migrate_requested(row['key'])
        with self.transaction():
            self.db.execute("UPDATE jobs SET state='waiting',attempts=0,progress=0,error='' WHERE state IN ('expired','failed') AND key IN (SELECT key FROM batch_jobs WHERE batch_id=?)",(batch,))
        return batch

    def reserve(self, key, size, bucket='temp'):
        if size>self.max_file:raise CacheError('حجم فایل از سقف مجاز دانلود بزرگ‌تر است.',413)
        self.cleanup()
        with self.lock:
            used = sum(p.stat().st_size for p in self.media.iterdir() if p.is_file())
            if size <= 0 or used + size > self.limit or shutil.disk_usage(self.media).free < size+self.reserve_free:
                raise CacheError('ظرفیت موقت دانلود پر است؛ کمی بعد دوباره تلاش کنید.', 503)
            self.db.execute('UPDATE jobs SET size=? WHERE key=?', (size,key))
            self.db.commit()

    def commit_file(self, key, name, part, size, digest, generation=None):
        generation = generation or uuid.uuid4().hex
        final = self.media / (key+'-'+generation+'.bin')
        with self.transaction():
            os.replace(part, final)
            self.db.execute('INSERT OR REPLACE INTO local_files VALUES (?,?,?,?,?,0)',
                            (key,generation,name,size,self.clock()+self.ttl))
            self.db.execute("UPDATE jobs SET state='ready',bucket='temp',url='',asset_id=NULL,size=?,sha256=?,progress=?,error='',promote=0,next_attempt=0 WHERE key=?",
                            (size,digest,size,key))
            self.set_phase(key,'ready')
            self.live.pop(key,None)
            self.changed.notify_all()

    def _signature(self, key, generation, expires):
        return hmac.new(self.secret, f'{key}/{generation}/{expires}'.encode(), hashlib.sha256).hexdigest()

    def public(self, key):
        with self.lock:
            row = self.db.execute('SELECT * FROM local_files WHERE key=?',(key,)).fetchone()
            if row and row['expires'] > self.clock():
                expires = int(row['expires'])
                signature = self._signature(key,row['generation'],expires)
                return self.decorate(key,{'job':key,'status':'ready','size':row['size'],'bytes':row['size'],
                        'provider':'local','bucket':'temp','retryAfter':4,
                        'url':f'{self.origin}/media/{key}/{row["generation"]}/{expires}/{signature}'})
            live=self.live.get(key)
            if live and live['committed']>0 and key in self.producers and self.has_active_demand(key):
                # Stable for one minute, valid for at most five; no URL is put
                # in jobs.url and uploading is never reported as ready.
                expires=(int(self.clock())//60+5)*60
                signature=self._signature(key,live['generation'],expires)
                result=super().public(key)
                result.update(status='uploading',provider='local',live=True,streamBytes=live['committed'],
                    size=live['size'],url=f'{self.origin}/media/{key}/{live["generation"]}/{expires}/{signature}')
                return self.decorate(key,result)
            return self.decorate(key,super().public(key))

    def cleanup(self):
        with self.transaction():
            now = self.clock()
            rows = self.db.execute('SELECT * FROM local_files WHERE expires<=? OR (completed>0 AND completed<=?)',
                                   (now,now-self.grace)).fetchall()
            for row in rows:
                key = row['key']
                if self.readers.get(key,0) or key in self.producers:
                    continue
                (self.media/(key+'-'+row['generation']+'.bin')).unlink(missing_ok=True)
                self.db.execute('DELETE FROM local_files WHERE key=?',(key,))
                self.deleted(key)
                self.coverage.pop(key,None)
            self._sweep_orphans()

    def acquire(self, path):
        match = re.fullmatch(r'/media/([a-f0-9]{64})/([a-f0-9]{32})/([0-9]{10})/([a-f0-9]{64})',path)
        if not match:
            raise CacheError('لینک معتبر نیست.',404)
        key,generation,expires,sig = match.groups()
        if int(expires)<=self.clock() or not hmac.compare_digest(sig,self._signature(key,generation,expires)):
            raise CacheError('لینک منقضی شده است.',403)
        with self.lock:
            row = self.db.execute('SELECT * FROM local_files WHERE key=? AND generation=?',(key,generation)).fetchone()
            live=self.live.get(key)
            if row and row['expires']>self.clock():
                row=dict(row)
                path=self.media/(key+'-'+generation+'.bin')
            elif (live and live['generation']==generation and live['committed']>0
                  and key in self.producers and self.has_active_demand(key)):
                row={**live,'live':True}
                path=self.media/(key+'-'+generation+'.part')
            else:raise CacheError('فایل پاک شده است؛ دوباره درخواست دانلود بدهید.',410)
            try:
                stream = path.open('rb',buffering=0)
            except FileNotFoundError:
                raise CacheError('فایل در دسترس نیست.',410) from None
            self.readers[key] = self.readers.get(key,0)+1
            return dict(row),stream

    def release(self, key, span=None, generation=None):
        with self.transaction():
            self.readers[key] = max(0,self.readers.get(key,1)-1)
            row=self.db.execute('SELECT generation FROM local_files WHERE key=?',(key,)).fetchone()
            if generation is not None and (not row or row['generation']!=generation):return
            if span:
                spans = sorted(self.coverage.get(key,[])+[span])
                merged = []
                for a,b in spans:
                    if merged and a<=merged[-1][1]+1:
                        merged[-1]=(merged[-1][0],max(b,merged[-1][1]))
                    else:
                        merged.append((a,b))
                self.coverage[key] = merged if len(merged)<=1024 else []
                size = self.db.execute('SELECT size FROM local_files WHERE key=?',(key,)).fetchone()
                if size and merged and merged[0]==(0,size[0]-1):
                    self.db.execute('UPDATE local_files SET completed=? WHERE key=?',(self.clock(),key))
            # Keep a full grace period after the last active reader, including
            # readers that resumed while a completed download awaited cleanup.
            self.db.execute('UPDATE local_files SET completed=? WHERE key=? AND completed>0',(self.clock(),key))


def parse_range(value, size):
    if not value:
        return 0,size-1,200
    match = re.fullmatch(r'bytes=(\d*)-(\d*)',value)
    if not match or not any(match.groups()):
        raise ValueError('Unsupported range')
    a,b=match.groups()
    if not a:
        if int(b)<=0:
            raise ValueError('Invalid suffix')
        start,end=max(0,size-int(b)),size-1
    else:
        start,end=int(a),min(int(b) if b else size-1,size-1)
    if start>=size or start>end:
        raise ValueError('Unsatisfiable range')
    return start,end,206


class MediaServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32
    def __init__(self,address,store):
        super().__init__(address,MediaHandler)
        self.store=store
        self.slots=threading.BoundedSemaphore(24)
        self.live_slots=threading.BoundedSemaphore(8)

    def process_request(self,request,address):
        request.settimeout(60)
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request,address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self,request,address):
        try:
            super().process_request_thread(request,address)
        finally:
            self.slots.release()


class MediaHandler(BaseHTTPRequestHandler):
    server_version = 'Media'
    def log_message(self,*args):
        pass  # Never write signed URLs into logs.

    def do_HEAD(self):
        self.serve(False)

    def do_GET(self):
        if urlsplit(self.path).path=='/api/download-cache':
            self.status_reply()
        else:
            self.serve(True)

    def status_reply(self):
        try:
            if len(self.path)>256:raise CacheError('درخواست معتبر نیست.',400)
            values=parse_qs(urlsplit(self.path).query,keep_blank_values=True)
            if len(values)!=1 or not set(values)<= {'job','batch'}:raise CacheError('درخواست معتبر نیست.',400)
            name=next(iter(values));keys=values[name]
            if len(keys)!=1 or not re.fullmatch('[a-f0-9]{64}',keys[0]):raise CacheError('درخواست معتبر نیست.',400)
            payload=self.server.store.public_batch(keys[0]) if name=='batch' else self.server.store.public(keys[0])
            status=200 if payload['status']=='ready' else 202
        except CacheError as error:
            status,payload=error.status,{'error':str(error)}
        body=json.dumps(payload,ensure_ascii=False).encode()
        self.send_response(status)
        for k,v in {'Content-Type':'application/json; charset=utf-8','Content-Length':str(len(body)),
                    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
                    'X-Download-Status':'live'}.items():self.send_header(k,v)
        self.end_headers()
        try:self.wfile.write(body)
        except (OSError,TimeoutError):self.close_connection=True

    def serve(self,body):
        row=None
        stream=None
        span=None
        sent=False
        live_slot=False
        try:
            row,stream=self.server.store.acquire(self.path)
            try:
                start,end,status=parse_range(self.headers.get('Range'),row['size'])
            except ValueError:
                self.send_response(416)
                self.send_header('Content-Range',f'bytes */{row["size"]}')
                self.send_header('Content-Length','0')
                self.send_header('Cache-Control','private, no-store')
                self.end_headers()
                return
            name=re.sub(r'[^a-zA-Z0-9._-]','_',row['name'])[:200]
            if body and row.get('live'):
                live_slot=self.server.live_slots.acquire(blocking=False)
                if not live_slot:raise CacheError('چند دانلود هم‌زمان فعال است؛ کمی بعد تلاش کنید.',503)
                self.server.store.available(row['key'],row['generation'],start)
            self.send_response(status)
            headers={'Content-Type':'application/octet-stream','Content-Disposition':f'attachment; filename="{name}"',
                     'Content-Length':str(end-start+1),'Accept-Ranges':'bytes',
                     'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',
                     'Referrer-Policy':'no-referrer'}
            headers.update({'X-Accel-Buffering':'no','X-Download-State':'live' if row.get('live') else 'verified'})
            if status==206:
                headers['Content-Range']=f'bytes {start}-{end}/{row["size"]}'
            for k,v in headers.items():
                self.send_header(k,v)
            self.end_headers()
            sent=True
            if body:
                offset=start
                while offset<=end:
                    available=(self.server.store.available(row['key'],row['generation'],offset)
                               if row.get('live') else row['size'])
                    chunk=os.pread(stream.fileno(),min(256*1024,end-offset+1,available-offset),offset)
                    if not chunk:
                        raise OSError('Incomplete media')
                    self.wfile.write(chunk)
                    offset+=len(chunk)
                self.wfile.flush()
                span=(start,end)
        except CacheError as error:
            if sent:self.close_connection=True
            else:
                self.send_response(error.status)
                self.send_header('Content-Length','0')
                self.send_header('Cache-Control','private, no-store')
                if error.status==503:self.send_header('Retry-After','2')
                self.end_headers()
        except (OSError,TimeoutError):
            self.close_connection=True
        finally:
            if stream:
                stream.close()
            if row:
                self.server.store.release(row['key'],span,row['generation'])
            if live_slot:self.server.live_slots.release()
