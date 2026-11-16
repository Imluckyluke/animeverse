"""Server-only password, purpose-bound session and role authentication."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid


class AdminError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def hash_password(password):
    if not isinstance(password, str) or not 1 <= len(password) <= 256:
        raise AdminError('رمز عبور معتبر نیست.', 422)
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, maxmem=64*1024*1024, dklen=32)
    return 'scrypt$16384$8$1$' + salt.hex() + '$' + value.hex()


def verify_password(password, encoded):
    try:
        if not isinstance(password, str) or len(password) > 256:
            return False
        kind, n, r, p, salt, expected = encoded.split('$')
        if (kind, n, r, p) != ('scrypt', '16384', '8', '1') or len(salt) != 32 or len(expected) != 64:
            return False
        value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, maxmem=64*1024*1024, dklen=32)
        return hmac.compare_digest(value, bytes.fromhex(expected))
    except (ValueError, TypeError, AttributeError):
        return False


_DUMMY_HASH = hash_password('dummy-identity-never-accepted')


def strong_password(value):
    if not isinstance(value, str) or not 6 <= len(value) <= 256:
        raise AdminError('رمز باید بین ۶ تا ۲۵۶ کاراکتر باشد.', 422)


def normalized_email(value):
    if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,63}", value.strip()):
        raise AdminError('ایمیل معتبر نیست.', 422)
    return value.strip().lower()


class AuthStore:
    def __init__(self, path, owner_email=None, owner_hash=None, now=None):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=10, isolation_level=None)
        os.chmod(path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA busy_timeout=10000')
        self.now = now or time.time
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('owner','editor','reviewer','user')),disabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,last_login_at TEXT);
          CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,
            csrf TEXT NOT NULL,created_at REAL NOT NULL,expires_at REAL NOT NULL,last_seen REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS login_attempts(client TEXT NOT NULL,email TEXT NOT NULL,at REAL NOT NULL);
          CREATE INDEX IF NOT EXISTS login_client ON login_attempts(client,at);
          CREATE INDEX IF NOT EXISTS login_email ON login_attempts(email,at);
          CREATE TABLE IF NOT EXISTS owner_access(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at REAL NOT NULL,used INTEGER NOT NULL DEFAULT 0);
        ''')
        if owner_hash and owner_email:
            email = normalized_email(owner_email)
            if not re.fullmatch(r'scrypt\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}', owner_hash):
                raise RuntimeError('Invalid owner bootstrap hash')
            with self.transaction():
                if not self.db.execute("SELECT 1 FROM users WHERE role='owner'").fetchone():
                    if self.db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
                        raise RuntimeError('Existing account cannot be promoted by bootstrap email')
                    self.db.execute('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
                                    (uuid.uuid4().hex, email, 'مدیر', owner_hash, 'owner', self._iso()))

    def _iso(self, stamp=None):
        return datetime.fromtimestamp(self.now() if stamp is None else stamp, timezone.utc).isoformat()

    @contextmanager
    def transaction(self):
        nested = self.db.in_transaction
        savepoint = 'sp_' + uuid.uuid4().hex
        self.db.execute('SAVEPOINT ' + savepoint if nested else 'BEGIN IMMEDIATE')
        try:
            yield
            self.db.execute('RELEASE ' + savepoint) if nested else self.db.commit()
        except BaseException:
            if nested:
                self.db.execute('ROLLBACK TO ' + savepoint)
                self.db.execute('RELEASE ' + savepoint)
            else:
                self.db.rollback()
            raise

    def close(self):
        self.db.close()

    def _favorites_count(self, user_id):
        return 0

    def _public(self, row):
        return {'id': row['id'], 'name': row['name'], 'email': row['email'], 'role': row['role'],
                'disabled': bool(row['disabled']), 'createdAt': row['created_at'], 'lastLoginAt': row['last_login_at'],
                'favorites': self._favorites_count(row['id'])}

    def user(self, ident):
        row = self.db.execute('SELECT * FROM users WHERE id=?', (ident,)).fetchone()
        if not row:
            raise AdminError('حساب پیدا نشد.', 404)
        return self._public(row)

    def require(self, actor_id, permission):
        user = self.user(actor_id)
        allowed = {'editor': {'read', 'catalog.patch', 'media', 'publish', 'review', 'history.undo'},
                   'reviewer': {'read', 'review'}}
        if user['disabled'] or (user['role'] != 'owner' and permission not in allowed.get(user['role'], set())):
            raise AdminError('دسترسی این عملیات را نداری.', 403)
        return user

    def login(self, email, password, client, kind='admin'):
        if kind not in {'admin', 'account'}:
            raise AdminError('نوع نشست معتبر نیست.', 422)
        if not isinstance(email, str) or len(email) > 254 or not isinstance(password, str) or len(password) > 256:
            raise AdminError('ایمیل یا رمز درست نیست.', 401)
        email = email.strip().lower()
        client = str(client)[:128]
        now = self.now()
        with self.transaction():
            self.db.execute('DELETE FROM login_attempts WHERE at<?', (now - 900,))
            attempts = self.db.execute('SELECT count(*) FROM login_attempts WHERE client=? OR email=?', (client, email)).fetchone()[0]
            if attempts >= 8:
                raise AdminError('تلاش ورود زیاد است؛ ۱۵ دقیقه بعد دوباره تلاش کن.', 429)
            self.db.execute('INSERT INTO login_attempts VALUES(?,?,?)', (client, email, now))
        row = self.db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
        correct = verify_password(password, row['password_hash'] if row else _DUMMY_HASH)
        if not row or not correct or row['disabled'] or kind == 'admin' and row['role'] == 'user':
            raise AdminError('ایمیل یا رمز درست نیست.', 401)
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        expires = now + (7200 if kind == 'admin' else 30 * 86400)
        with self.transaction():
            self.db.execute('DELETE FROM sessions WHERE expires_at<?', (now,))
            self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)',
                            (hashlib.sha256(token.encode()).hexdigest(), row['id'], kind, csrf, now, expires, now))
            self.db.execute('UPDATE users SET last_login_at=? WHERE id=?', (self._iso(), row['id']))
        return {'token': token, 'session': self.session(token, kind)}

    def session(self, token, kind='admin', csrf=None, mutation=False):
        if not isinstance(token, str) or not 40 <= len(token) <= 128:
            raise AdminError('نشست منقضی شده است؛ دوباره وارد شو.', 401)
        digest = hashlib.sha256(token.encode()).hexdigest()
        row = self.db.execute('SELECT * FROM sessions WHERE token_hash=? AND kind=?', (digest, kind)).fetchone()
        now = self.now()
        if not row or row['expires_at'] <= now or now - row['last_seen'] > (2700 if kind == 'admin' else 7 * 86400):
            raise AdminError('نشست منقضی شده است؛ دوباره وارد شو.', 401)
        user = self.user(row['user_id'])
        if user['disabled'] or kind == 'admin' and user['role'] == 'user':
            raise AdminError('نشست معتبر نیست.', 401)
        if mutation and (not isinstance(csrf, str) or len(csrf) > 200 or not hmac.compare_digest(csrf, row['csrf'])):
            raise AdminError('تأیید امنیتی درخواست معتبر نیست؛ صفحه را تازه کن.', 403)
        self.db.execute('UPDATE sessions SET last_seen=? WHERE token_hash=?', (now, digest))
        return {'user': user, 'csrf': row['csrf'], 'expiresAt': self._iso(row['expires_at'])}

    def logout(self, token):
        if isinstance(token, str) and len(token) <= 128:
            self.db.execute('DELETE FROM sessions WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))

    def issue_owner_access(self, email, ttl=600):
        """Privileged local operation only. No HTTP route can issue these grants."""
        email = normalized_email(email)
        row = self.db.execute("SELECT id FROM users WHERE email=? AND role='owner' AND disabled=0", (email,)).fetchone()
        if not row:
            raise AdminError('حساب مالک پیدا نشد.', 404)
        token = secrets.token_urlsafe(32)
        with self.transaction():
            self.db.execute('DELETE FROM owner_access WHERE expires_at<? OR user_id=?', (self.now(), row['id']))
            self.db.execute('INSERT INTO owner_access VALUES(?,?,?,0)', (hashlib.sha256(token.encode()).hexdigest(), row['id'], self.now() + min(900, max(60, ttl))))
        return token

    def redeem_owner_access(self, token, client):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token):
            raise AdminError('لینک ورود معتبر نیست یا منقضی شده است.', 403)
        now = self.now()
        with self.transaction():
            key = 'owner-access:' + str(client)[:128]
            self.db.execute('DELETE FROM login_attempts WHERE at<?', (now - 900,))
            if self.db.execute('SELECT count(*) FROM login_attempts WHERE client=?', (key,)).fetchone()[0] >= 8:
                raise AdminError('کمی بعد دوباره تلاش کن.', 429)
            self.db.execute('INSERT INTO login_attempts VALUES(?,?,?)', (key, 'owner-access', now))
        with self.transaction():
            digest = hashlib.sha256(token.encode()).hexdigest()
            grant = self.db.execute('SELECT * FROM owner_access WHERE token_hash=? AND used=0 AND expires_at>?', (digest, now)).fetchone()
            if not grant:
                raise AdminError('لینک ورود معتبر نیست یا منقضی شده است.', 403)
            self.require(grant['user_id'], 'owner')
            self.db.execute('UPDATE owner_access SET used=1 WHERE token_hash=? AND used=0', (digest,))
            session_token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            self.db.execute('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)', (hashlib.sha256(session_token.encode()).hexdigest(), grant['user_id'], 'account', csrf, now, now + 30*86400, now))
            self.db.execute('UPDATE users SET last_login_at=? WHERE id=?', (self._iso(), grant['user_id']))
        return {'token': session_token, 'session': self.session(session_token, 'account')}

    def change_password(self, actor_id, old, new):
        strong_password(new)
        row = self.db.execute('SELECT password_hash FROM users WHERE id=? AND disabled=0', (actor_id,)).fetchone()
        if not row or not verify_password(old, row[0]):
            raise AdminError('رمز فعلی درست نیست.', 403)
        hashed = hash_password(new)
        with self.transaction():
            self.db.execute('UPDATE users SET password_hash=? WHERE id=?', (hashed, actor_id))
            self.db.execute('DELETE FROM sessions WHERE user_id=?', (actor_id,))

    def create_account(self, name, email, password, role='user', actor=None):
        if role not in {'user', 'editor', 'reviewer'}:
            raise AdminError('نقش حساب معتبر نیست.', 403)
        if role != 'user':
            self.require(actor, 'owner')
        if not isinstance(name, str) or not 2 <= len(name.strip()) <= 80 or re.search(r'[\x00-\x1f]', name):
            raise AdminError('نام باید بین ۲ تا ۸۰ کاراکتر باشد.', 422)
        email = normalized_email(email)
        strong_password(password)
        if self.db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
            raise AdminError('این ایمیل قبلاً ثبت شده است.', 409)
        ident, hashed = uuid.uuid4().hex, hash_password(password)
        with self.transaction():
            try:
                self.db.execute('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)',
                                (ident, email, name.strip(), hashed, role, self._iso()))
            except sqlite3.IntegrityError:
                raise AdminError('این ایمیل قبلاً ثبت شده است.', 409)
        return self.user(ident)

    def accounts(self, query='', page=1, page_size=20):
        page, page_size = max(1, min(10000, int(page))), max(1, min(50, int(page_size)))
        query = str(query)[:200].lower().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        where = "lower(name||' '||email) LIKE ? ESCAPE '\\'"
        total = self.db.execute('SELECT count(*) FROM users WHERE ' + where, ('%' + query + '%',)).fetchone()[0]
        rows = self.db.execute('SELECT * FROM users WHERE ' + where + ' ORDER BY created_at,id LIMIT ? OFFSET ?',
                               ('%' + query + '%', page_size, (page - 1) * page_size))
        return {'items': [self._public(row) for row in rows], 'total': total, 'page': page, 'pageSize': page_size}

    def update_account(self, actor_id, user_id, patch):
        self.require(actor_id, 'owner')
        if not isinstance(patch, dict) or not patch or set(patch) - {'disabled', 'role'}:
            raise AdminError('ویرایش حساب معتبر نیست.', 422)
        user = self.user(user_id)
        if user['role'] == 'owner' or actor_id == user_id:
            raise AdminError('حساب مالک را نمی‌توان غیرفعال کرد یا تنزل داد.', 403)
        if 'disabled' in patch and not isinstance(patch['disabled'], bool):
            raise AdminError('وضعیت حساب معتبر نیست.', 422)
        if 'role' in patch and patch['role'] not in {'user', 'editor', 'reviewer'}:
            raise AdminError('نقش حساب معتبر نیست.', 403)
        with self.transaction():
            self.db.execute('UPDATE users SET disabled=?,role=? WHERE id=?',
                            (int(patch.get('disabled', user['disabled'])), patch.get('role', user['role']), user_id))
            self.db.execute('DELETE FROM sessions WHERE user_id=?', (user_id,))
        return self.user(user_id)
