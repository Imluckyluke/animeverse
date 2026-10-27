"""Bounded two-tier GitHub release cache. No video enters Git history or disk."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
import time

GIB = 1024 ** 3
MAX_FILE = 2 * GIB - 1
REPOSITORIES = {'hot': 'itisluckyluke-dev/animeverse-popular-downloads',
                'temp': 'itisluckyluke-dev/animeverse-temporary-downloads'}


class CacheError(Exception):
    def __init__(self, message, status=400):
        self.status = status
        super().__init__(message)


class ReadyCatalog:
    def __init__(self, path):
        self.path = Path(path)
        self.version = None
        self.items = {}
        self.lock = threading.Lock()

    def resolve(self, slug, episode, quality):
        with self.lock:
            stat = self.path.stat()
            version = (stat.st_mtime_ns, stat.st_size)
            if version != self.version:
                items = {}
                for anime in json.loads(self.path.read_text()):
                    for ep in anime.get('episodeData', []):
                        for q in ep.get('qualities', []):
                            match = re.fullmatch(r'https://t\.me/testanivers/([1-9]\d*)', q.get('url') or '')
                            if q.get('status') == 'done' and match:
                                items[(anime['slug'], ep['number'], q['label'])] = {
                                    'slug': anime['slug'], 'episode': ep['number'], 'quality': q['label'],
                                    'source_id': int(match[1]), 'size': q.get('size') or 0,
                                }
                self.items, self.version = items, version
            result = self.items.get((slug, episode, quality))
            if not result:
                raise CacheError('این فایل در آرشیو آماده وجود ندارد.', 404)
            if result['size'] > MAX_FILE:
                raise CacheError('این فایل از سقف هر فایل در گیت‌هاب بزرگ‌تر است.', 413)
            return result.copy()

    def resolve_all(self, slug, quality):
        if not isinstance(slug,str) or not isinstance(quality,str):
            raise CacheError('درخواست نامعتبر است.')
        # Refresh once, then take an immutable snapshot of ready rows. Missing
        # qualities are excluded, never replaced with guessed episode numbers.
        try:
            self.resolve(slug,1,quality)
        except CacheError:
            pass
        with self.lock:
            items=[item.copy() for (s,_,q),item in self.items.items() if s==slug and q==quality and item['size']<=MAX_FILE]
        if not items:
            raise CacheError('قسمت آماده‌ای با این کیفیت وجود ندارد.',404)
        return sorted(items,key=lambda item:item['episode'])


def file_key(item):
    value = json.dumps([item['slug'], item['episode'], item['quality'], item['source_id']], separators=(',', ':'))
    return hashlib.sha256(value.encode()).hexdigest()


def safe_download_url(value):
    return any(value.startswith('https://github.com/' + repo + '/releases/download/') for repo in REPOSITORIES.values())


class CacheStore:
    def __init__(self, path, *, ttl=86400, temp_limit=10*GIB, hot_limit=20*GIB, hot_after=10, max_queue=40, clock=time.time):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.clock, self.ttl = clock, ttl
        self.limits = {'temp': temp_limit, 'hot': hot_limit}
        self.hot_after, self.max_queue = hot_after, max_queue
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS jobs (
              key TEXT PRIMARY KEY, slug TEXT, episode INTEGER, quality TEXT, source_id INTEGER,
              size INTEGER DEFAULT 0, state TEXT, bucket TEXT, url TEXT DEFAULT '', asset_id INTEGER,
              release_id INTEGER, progress INTEGER DEFAULT 0, requests INTEGER DEFAULT 0,
              created REAL, last_requested REAL, attempts INTEGER DEFAULT 0, next_attempt REAL DEFAULT 0,
              error TEXT DEFAULT '', sha256 TEXT DEFAULT '', promote INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, key TEXT, client TEXT, at REAL);
            CREATE INDEX IF NOT EXISTS requests_client_at ON requests(client,at);
            CREATE TABLE IF NOT EXISTS retired (repo TEXT, asset_id INTEGER, size INTEGER, expires REAL,
              PRIMARY KEY(repo,asset_id));
            CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, request_id TEXT UNIQUE,
              slug TEXT,quality TEXT,created REAL);
            CREATE TABLE IF NOT EXISTS batch_jobs (batch_id TEXT,key TEXT,episode INTEGER,quality TEXT,
              PRIMARY KEY(batch_id,key));
        ''')
        with self.transaction():
            self.db.execute("UPDATE jobs SET state=CASE WHEN url<>'' THEN 'ready' ELSE 'queued' END WHERE state='uploading'")
            self.db.execute("UPDATE jobs SET state='ready' WHERE state='deleting'")

    @contextmanager
    def transaction(self):
        with self.lock, self.db:
            yield

    def get(self, key):
        with self.lock:
            row = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
            return dict(row) if row else None

    def request(self, item, client, request_id):
        if not re.fullmatch(r'[a-f0-9]{64}', client) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}', request_id):
            raise CacheError('درخواست معتبر نیست.')
        key, now = file_key(item), self.clock()
        with self.transaction():
            previous = self.db.execute('SELECT key,client FROM requests WHERE id=?', (request_id,)).fetchone()
            if previous and previous['key'] != key:
                raise CacheError('شناسهٔ درخواست تکراری است.', 409)
            if not previous:
                minute, day = [self.db.execute('SELECT count(*) FROM requests WHERE client=? AND at>?', (client, now-window)).fetchone()[0] for window in (60, 86400)]
                if minute >= 12 or day >= 200:
                    raise CacheError('تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کن.', 429)
                self.db.execute('INSERT INTO requests VALUES (?,?,?,?)', (request_id, key, client, now))
            row = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
            if not row:
                queued = self.db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','uploading')").fetchone()[0]
                if queued >= self.max_queue:
                    raise CacheError('صف انتقال پر است؛ کمی بعد دوباره تلاش کن.', 503)
                self.db.execute('''INSERT INTO jobs(key,slug,episode,quality,source_id,size,state,bucket,created,last_requested)
                    VALUES (?,?,?,?,?,?,'queued','temp',?,?)''', (key,item['slug'],item['episode'],item['quality'],item['source_id'],item['size'],now,now))
            elif row['state'] in ('expired', 'failed') and row['next_attempt'] <= now:
                queued=self.db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','uploading')").fetchone()[0]
                state='queued' if queued<self.max_queue else 'waiting'
                self.db.execute("UPDATE jobs SET state=?,error='',attempts=0,progress=0,next_attempt=0 WHERE key=?", (state,key))
            self.db.execute('UPDATE jobs SET requests=requests+?,last_requested=? WHERE key=?', (0 if previous else 1, now, key))
            self.db.execute("UPDATE jobs SET promote=1 WHERE key=? AND requests>=? AND bucket='temp' AND state='ready'", (key,self.hot_after))
        return self.get(key)

    def request_batch(self, items, client, request_id):
        if not re.fullmatch(r'[a-f0-9]{64}',client) or not re.fullmatch(r'[a-zA-Z0-9-]{16,80}',request_id):
            raise CacheError('درخواست معتبر نیست.')
        unique={file_key(item):item for item in items}
        if not unique or len(unique)>2000:
            raise CacheError('تعداد قسمت‌های این درخواست مجاز نیست.',413)
        identities={(item['slug'],item['quality']) for item in unique.values()}
        if len(identities)!=1 or any(not 0<item['episode'] or item['size']>MAX_FILE for item in unique.values()):
            raise CacheError('قسمت‌های انتخاب‌شده معتبر نیستند.')
        slug,quality=next(iter(identities));now=self.clock()
        batch=hashlib.sha256(('batch:'+request_id).encode()).hexdigest()
        with self.transaction():
            existing=self.db.execute('SELECT * FROM batches WHERE request_id=?',(request_id,)).fetchone()
            if existing:
                if existing['slug']!=slug or existing['quality']!=quality:
                    raise CacheError('شناسهٔ درخواست تکراری است.',409)
                return existing['id']
            if self.db.execute('SELECT 1 FROM requests WHERE id=?',(request_id,)).fetchone():
                raise CacheError('شناسهٔ درخواست تکراری است.',409)
            minute,day=[self.db.execute('SELECT count(*) FROM requests WHERE client=? AND at>?',(client,now-window)).fetchone()[0] for window in (60,86400)]
            if minute>=12 or day>=200:
                raise CacheError('تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کن.',429)
            waiting=self.db.execute("SELECT count(*) FROM jobs WHERE state IN ('waiting','queued','uploading')").fetchone()[0]
            needed=0
            for key in unique:
                old=self.db.execute('SELECT state FROM jobs WHERE key=?',(key,)).fetchone()
                needed+=not old or old['state'] in ('expired','failed')
            if waiting+needed>5000:
                raise CacheError('صف انتقال پر است؛ کمی بعد دوباره تلاش کن.',503)
            self.db.execute('INSERT INTO batches VALUES (?,?,?,?,?)',(batch,request_id,slug,quality,now))
            self.db.execute('INSERT INTO requests VALUES (?,?,?,?)',(request_id,'batch:'+batch,client,now))
            for key,item in unique.items():
                self.db.execute('''INSERT OR IGNORE INTO jobs(key,slug,episode,quality,source_id,size,state,bucket,created,last_requested)
                  VALUES (?,?,?,?,?,?,'waiting','temp',?,?)''',(key,slug,item['episode'],quality,item['source_id'],item['size'],now,now))
                self.db.execute("UPDATE jobs SET state='waiting',error='',attempts=0,progress=0 WHERE key=? AND state IN ('expired','failed') AND next_attempt<=?",(key,now))
                self.db.execute('UPDATE jobs SET requests=requests+1,last_requested=? WHERE key=?',(now,key))
                self.db.execute("UPDATE jobs SET promote=1 WHERE key=? AND requests>=? AND bucket='temp' AND state='ready'",(key,self.hot_after))
                self.db.execute('INSERT INTO batch_jobs VALUES (?,?,?,?)',(batch,key,item['episode'],quality))
        return batch

    def public_batch(self, batch):
        with self.lock:
            row=self.db.execute('SELECT * FROM batches WHERE id=?',(batch,)).fetchone()
            if not row:
                raise CacheError('درخواست گروهی پیدا نشد.',404)
            members=self.db.execute('SELECT * FROM batch_jobs WHERE batch_id=? ORDER BY episode',(batch,)).fetchall()
            items=[dict(self.public(item['key']),episode=item['episode'],quality=item['quality']) for item in members]
            return {'batch':batch,'slug':row['slug'],'quality':row['quality'],'total':len(items),
                    'status':'ready' if all(item['status']=='ready' for item in items) else 'queued','items':items}

    def claim(self):
        now = self.clock()
        with self.transaction():
            active=self.db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','uploading')").fetchone()[0]
            slots=max(0,self.max_queue-active)
            self.db.execute("UPDATE jobs SET state='queued' WHERE key IN (SELECT key FROM jobs WHERE state='waiting' AND next_attempt<=? ORDER BY created,episode LIMIT ?)",(now,slots))
            row = self.db.execute("SELECT * FROM jobs WHERE next_attempt<=? AND (state='queued' OR (state='ready' AND promote=1)) ORDER BY CASE WHEN state='queued' THEN 0 ELSE 1 END,created LIMIT 1", (now,)).fetchone()
            if not row:
                return None
            self.db.execute("UPDATE jobs SET state='uploading',attempts=attempts+1,progress=0 WHERE key=?", (row['key'],))
        return self.get(row['key'])

    def reserve(self, key, size, bucket):
        if not 0 < size <= MAX_FILE:
            raise CacheError('حجم فایل برای گیت‌هاب مجاز نیست.', 413)
        with self.transaction():
            used = self.db.execute("SELECT coalesce(sum(size),0) FROM jobs WHERE bucket=? AND asset_id IS NOT NULL AND key<>?", (bucket,key)).fetchone()[0]
            used += self.db.execute('SELECT coalesce(sum(size),0) FROM retired WHERE repo=?', (REPOSITORIES[bucket],)).fetchone()[0]
            if used + size > self.limits[bucket]:
                raise CacheError('ظرفیت این بخش از کش پر است؛ بعداً دوباره تلاش کن.', 503)
            self.db.execute('UPDATE jobs SET size=? WHERE key=?', (size,key))

    def progress(self, key, count):
        with self.transaction():
            self.db.execute('UPDATE jobs SET progress=? WHERE key=?', (count,key))

    def finish(self, key, bucket, asset, digest):
        if not safe_download_url(asset['browser_download_url']):
            raise CacheError('آدرس فایل گیت‌هاب معتبر نیست.', 502)
        with self.transaction():
            old = self.db.execute('SELECT * FROM jobs WHERE key=?', (key,)).fetchone()
            if old['asset_id'] and (old['bucket'] != bucket or old['asset_id'] != asset['id']):
                self.db.execute('INSERT OR REPLACE INTO retired VALUES (?,?,?,?)', (REPOSITORIES[old['bucket']],old['asset_id'],old['size'],self.clock()+self.ttl))
            self.db.execute("UPDATE jobs SET state='ready',bucket=?,asset_id=?,url=?,size=?,sha256=?,progress=?,error='',promote=0,next_attempt=0,last_requested=max(last_requested,?) WHERE key=?", (bucket,asset['id'],asset['browser_download_url'],asset['size'],digest,asset['size'],self.clock(),key))

    def fail(self, key, message, delay=60, permanent=False):
        with self.transaction():
            row = self.db.execute('SELECT url,attempts FROM jobs WHERE key=?', (key,)).fetchone()
            state = 'ready' if row['url'] else 'queued' if row['attempts'] < 3 and not permanent else 'failed'
            self.db.execute('UPDATE jobs SET state=?,error=?,next_attempt=? WHERE key=?', (state,message,self.clock()+delay,key))

    def defer(self, key, message, delay=900):
        with self.transaction():
            self.db.execute("UPDATE jobs SET state=CASE WHEN url<>'' THEN 'ready' ELSE 'waiting' END,error=?,next_attempt=? WHERE key=?",(message,self.clock()+delay,key))

    def expired_assets(self):
        now = self.clock()
        with self.transaction():
            rows = self.db.execute("SELECT * FROM jobs WHERE bucket='temp' AND state='ready' AND last_requested<?", (now-self.ttl,)).fetchall()
            for row in rows:
                self.db.execute("UPDATE jobs SET state='deleting' WHERE key=?", (row['key'],))
            retired = self.db.execute('SELECT * FROM retired WHERE expires<?', (now,)).fetchall()
            self.db.execute('DELETE FROM requests WHERE at<?', (now-2*86400,))
            return [dict(row) for row in rows], [dict(row) for row in retired]

    def deleted(self, key):
        with self.transaction():
            self.db.execute("UPDATE jobs SET state='expired',url='',asset_id=NULL,progress=0 WHERE key=?", (key,))

    def public(self, key):
        row = self.get(key)
        if not row:
            raise CacheError('درخواست پیدا نشد.', 404)
        result = {'job': key, 'status': row['state'], 'bytes': row['progress'], 'size': row['size'], 'retryAfter': 4}
        if row['url'] and row['state'] not in ('expired','deleting'):
            result.update(status='ready',url=row['url'],provider='github',bucket=row['bucket'])
        elif row['error']:
            result['error'] = row['error'] or 'انتقال فایل انجام نشد؛ دوباره تلاش کن.'
        return result
