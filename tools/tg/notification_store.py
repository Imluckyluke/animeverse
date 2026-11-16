"""Account-bound Telegram links and a durable, publication-gated outbox."""
import hashlib
import json
import re
import secrets
import time

from admin_store import AdminError
from common import now_iso, read_json


class Notifications:
    def __init__(self, store, data=None):
        self.store, self.db, self.data = store, store.db, data if data is not None else store.path.parent
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS notify_account_links(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS notify_accounts(user_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL UNIQUE,enabled INTEGER NOT NULL,linked_at REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS notify_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS notify_publications(slug TEXT PRIMARY KEY,episodes TEXT NOT NULL,title TEXT NOT NULL DEFAULT '');
          CREATE TABLE IF NOT EXISTS notify_intents(id TEXT PRIMARY KEY,slug TEXT NOT NULL,episodes TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS notify_releases(id TEXT PRIMARY KEY,slug TEXT NOT NULL,title TEXT NOT NULL,episodes TEXT NOT NULL,deployment_id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS notify_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,release_id TEXT NOT NULL,user_id TEXT NOT NULL,chat_id TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,retry_at REAL NOT NULL DEFAULT 0,
            error TEXT NOT NULL DEFAULT '',message_id INTEGER,created_at REAL NOT NULL,sent_at TEXT,
            UNIQUE(release_id,user_id));
          CREATE INDEX IF NOT EXISTS notify_outbox_pending ON notify_outbox(state,retry_at);
        ''')
        if 'title' not in {row[1] for row in self.db.execute('PRAGMA table_info(notify_publications)')}:
            self.db.execute("ALTER TABLE notify_publications ADD COLUMN title TEXT NOT NULL DEFAULT ''")

    def meta(self, key, default=None):
        row = self.db.execute('SELECT value FROM notify_meta WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO notify_meta VALUES(?,?)', (key, json.dumps(value)))

    def bot(self):
        value = read_json(self.data / 'notify-bot.json', {}) or {}
        username = value.get('username') or ''
        health = read_json(self.data / 'notify-bot-health.json', {}) or {}
        return (username if re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{4,31}', username) else '',
                health.get('state') == 'running' and time.time() - float(health.get('heartbeat', 0)) < 150)

    def status(self, user_id):
        self.store.user(user_id)
        row = self.db.execute('SELECT * FROM notify_accounts WHERE user_id=?', (user_id,)).fetchone()
        username, healthy = self.bot()
        return {'linked': bool(row), 'enabled': bool(row and row['enabled']),
                'favoritesCount': len(self.store.preferences(user_id)['favorites']),
                'botUsername': username, 'available': bool(username), 'workerHealthy': healthy,
                'pendingCode': bool(self.db.execute('SELECT 1 FROM notify_account_links WHERE user_id=? AND used=0 AND expires_at>?', (user_id, time.time())).fetchone())}

    def link(self, user_id):
        self.store.user(user_id)
        username, healthy = self.bot()
        if not username or not healthy:
            raise AdminError('ربات اعلان موقتاً در دسترس نیست؛ کمی بعد دوباره بررسی کن.', 503)
        code = secrets.token_urlsafe(24)
        with self.store.transaction():
            self.db.execute('DELETE FROM notify_account_links WHERE user_id=? OR expires_at<?', (user_id, time.time()))
            self.db.execute('INSERT INTO notify_account_links VALUES(?,?,?,0)', (hashlib.sha256(code.encode()).hexdigest(), user_id, time.time() + 1200))
        return {'url': f'https://t.me/{username}?start={code}', 'botUsername': username, 'expiresIn': 1200}

    def redeem(self, code, chat_id):
        if not isinstance(code, str) or not re.fullmatch(r'[A-Za-z0-9_-]{32}', code) or not re.fullmatch(r'[1-9][0-9]{0,18}', str(chat_id)):
            raise AdminError('لینک اتصال معتبر نیست؛ از حساب سایت لینک تازه بگیر.', 422)
        with self.store.transaction():
            hashed = hashlib.sha256(code.encode()).hexdigest()
            row = self.db.execute('SELECT * FROM notify_account_links WHERE hash=? AND used=0 AND expires_at>?', (hashed, time.time())).fetchone()
            if not row:
                raise AdminError('این لینک مصرف شده یا منقضی است؛ از سایت لینک تازه بگیر.', 409)
            user = self.store.user(row['user_id'])
            if user.get('disabled'):
                raise AdminError('این حساب غیرفعال است.', 403)
            # Never silently move a chat between two website accounts.
            other = self.db.execute('SELECT user_id FROM notify_accounts WHERE chat_id=?', (str(chat_id),)).fetchone()
            if other and other['user_id'] != row['user_id']:
                raise AdminError('این تلگرام به حساب دیگری وصل است؛ ابتدا از همان حساب اتصال را قطع کن.', 409)
            self.db.execute('UPDATE notify_account_links SET used=1 WHERE hash=?', (hashed,))
            self.db.execute('INSERT INTO notify_accounts VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,enabled=1,linked_at=excluded.linked_at',
                            (row['user_id'], str(chat_id), time.time()))
            self.store.audit(user['id'], 'notifications.link', user['id'], {}, {'linked': True}, 'اتصال تلگرام با لینک یک‌بارمصرف حساب')
        return user['id']

    def connection(self, chat_id):
        return self.db.execute('SELECT n.*,u.name,u.disabled FROM notify_accounts n JOIN users u ON u.id=n.user_id WHERE chat_id=?', (str(chat_id),)).fetchone()

    def preference(self, user_id, enabled):
        if type(enabled) is not bool:
            raise AdminError('وضعیت اعلان معتبر نیست.', 422)
        with self.store.transaction():
            if not self.db.execute('SELECT 1 FROM notify_accounts WHERE user_id=?', (user_id,)).fetchone():
                raise AdminError('ابتدا حساب را به تلگرام وصل کن.', 409)
            self.db.execute('UPDATE notify_accounts SET enabled=? WHERE user_id=?', (int(enabled), user_id))
        return self.status(user_id)

    def unlink(self, user_id):
        with self.store.transaction():
            self.db.execute('DELETE FROM notify_accounts WHERE user_id=?', (user_id,))
            self.db.execute('DELETE FROM notify_account_links WHERE user_id=?', (user_id,))
            self.db.execute("UPDATE notify_outbox SET state='skipped',error='unlinked' WHERE user_id=? AND state='pending'", (user_id,))
        return self.status(user_id)

    def stage_intents(self):
        path = self.data / 'notify-events.jsonl'
        offset = int(self.meta('intent_offset', 0))
        if not path.exists():
            return
        if path.stat().st_size < offset:
            # Rotation is a new baseline, never replay the old event history.
            self.put('intent_offset', path.stat().st_size)
            return
        with path.open('rb') as stream:
            stream.seek(offset)
            raw = stream.read(1_000_000)
        end = raw.rfind(b'\n') + 1
        for line in raw[:end].splitlines():
            try:
                item = json.loads(line)
                slug, ident = item.get('slug'), item.get('id')
                numbers = item.get('episodes')
                if (not isinstance(slug, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,199}', slug)
                        or not isinstance(ident, str) or len(ident) > 300 or not isinstance(numbers, list)):
                    continue
                numbers = sorted({n for n in numbers if type(n) is int and 1 <= n <= 9999})
                if numbers:
                    self.db.execute('INSERT OR IGNORE INTO notify_intents VALUES(?,?,?)', (ident, slug, json.dumps(numbers)))
            except (ValueError, TypeError):
                continue
        self.put('intent_offset', offset + end)

    def publication(self, rows, deployment_id):
        """Called ONLY after the production alias and ready inventory verify."""
        with self.store.transaction():
            current = {item['slug']: item for item in rows}
            if not self.meta('initialized', False):
                self.put('initialized', True)
                events = self.data / 'notify-events.jsonl'
                self.put('intent_offset', events.stat().st_size if events.exists() else 0)
                for item in rows:
                    self.db.execute('INSERT OR REPLACE INTO notify_publications VALUES(?,?,?)', (item['slug'], json.dumps([ep['number'] for ep in item['episodeData']]), item.get('title') or item.get('titleEn') or 'انیمه'))
                return 0
            self.stage_intents()
            created = 0
            announced = {}
            for intent in self.db.execute('SELECT * FROM notify_intents').fetchall():
                row = current.get(intent['slug'])
                if not row:
                    continue
                ready = {ep['number'] for ep in row['episodeData'] if any(q.get('status') == 'done' and q.get('url') for q in ep['qualities'])}
                old = self.db.execute('SELECT episodes FROM notify_publications WHERE slug=?', (row['slug'],)).fetchone()
                known = set(json.loads(old[0])) if old else set()
                requested = set(json.loads(intent['episodes']))
                fresh = sorted(requested & (ready - known - announced.get(row['slug'], set())))
                if fresh:
                    announced.setdefault(row['slug'], set()).update(fresh)
                    release = hashlib.sha256((row['slug'] + ':' + ','.join(map(str, fresh))).encode()).hexdigest()
                    self.db.execute('INSERT OR IGNORE INTO notify_releases VALUES(?,?,?,?,?)', (release, row['slug'], row.get('title') or row.get('titleEn') or 'انیمه', json.dumps(fresh), deployment_id))
                    for connection in self.db.execute('SELECT n.*,u.disabled FROM notify_accounts n JOIN users u ON u.id=n.user_id WHERE n.enabled=1 AND u.disabled=0').fetchall():
                        if row['slug'] not in self.store.preferences(connection['user_id'])['favorites']:
                            continue
                        self.db.execute('INSERT OR IGNORE INTO notify_outbox(release_id,user_id,chat_id,created_at) VALUES(?,?,?,?)',
                                        (release, connection['user_id'], connection['chat_id'], time.time()))
                    created += 1
                remaining = requested - ready
                if remaining:
                    self.db.execute('UPDATE notify_intents SET episodes=? WHERE id=?', (json.dumps(sorted(remaining)), intent['id']))
                else:
                    self.db.execute('DELETE FROM notify_intents WHERE id=?', (intent['id'],))
            for item in rows:
                previous = self.db.execute('SELECT episodes FROM notify_publications WHERE slug=?', (item['slug'],)).fetchone()
                known = set(json.loads(previous[0])) if previous else set()
                known.update(ep['number'] for ep in item['episodeData'])
                self.db.execute('INSERT OR REPLACE INTO notify_publications VALUES(?,?,?)', (item['slug'], json.dumps(sorted(known)), item.get('title') or item.get('titleEn') or 'انیمه'))
            self.put('last_publication', {'deploymentId': deployment_id, 'at': now_iso()})
            return created
