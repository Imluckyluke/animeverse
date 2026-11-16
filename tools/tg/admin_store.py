"""Durable admin overlays, audit, queues and real account preferences.

This database never rewrites canonical archive state. Only the existing sole
archive writer consumes review commands; catalog overrides are reversible.
"""
from contextlib import closing
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

from admin_auth import AdminError, AuthStore, hash_password, verify_password

FIELDS = {'title', 'titleEn', 'titleJa', 'year', 'studio', 'synopsis', 'genres', 'cover', 'banner',
          'hidden', 'pinned', 'editorScore', 'episodeHidden'}
SLUG = re.compile(r'[a-z0-9][a-z0-9-]{0,199}\Z')


def encoded(value, limit=65536):
    result = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if len(result.encode()) > limit:
        raise AdminError('حجم اطلاعات بیش از حد مجاز است.', 413)
    return result


def note_text(value):
    if not isinstance(value, str) or not 5 <= len(value.strip()) <= 500:
        raise AdminError('دلیل تغییر باید بین ۵ تا ۵۰۰ کاراکتر باشد.', 422)
    return value.strip()


def page_number(value):
    if isinstance(value, bool):
        raise AdminError('شماره صفحه معتبر نیست.', 422)
    try:
        return max(1, min(10000, int(value)))
    except (ValueError, TypeError):
        raise AdminError('شماره صفحه معتبر نیست.', 422)


class AdminStore(AuthStore):
    def __init__(self, path, owner_email=None, owner_hash=None, now=None):
        self.path = Path(path)
        super().__init__(path, owner_email=owner_email, owner_hash=owner_hash, now=now)
        self._control_clock = now or time.time
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS overrides(slug TEXT PRIMARY KEY,patch TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,actor TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,
            before_json TEXT NOT NULL,after_json TEXT NOT NULL,note TEXT NOT NULL,at TEXT NOT NULL,reversible INTEGER NOT NULL DEFAULT 0,undone_by INTEGER);
          CREATE TABLE IF NOT EXISTS admin_commands(id TEXT PRIMARY KEY,actor TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,
            created_at TEXT NOT NULL,finished_at TEXT,error TEXT NOT NULL DEFAULT '',request_id TEXT,UNIQUE(actor,request_id));
          CREATE TABLE IF NOT EXISTS admin_settings(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE INDEX IF NOT EXISTS admin_command_state ON admin_commands(state,created_at);
          INSERT OR IGNORE INTO admin_settings VALUES(1,'automatic',0);
          CREATE TABLE IF NOT EXISTS preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),payload TEXT NOT NULL,revision INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS preference_operations(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(user_id,id));
          CREATE TABLE IF NOT EXISTS admin_previews(id TEXT PRIMARY KEY,actor TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,expires_at REAL NOT NULL,command_id TEXT);
          CREATE TABLE IF NOT EXISTS admin_effects(command_id TEXT PRIMARY KEY,audit_id INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS post_imports(id TEXT PRIMARY KEY,actor TEXT NOT NULL,state TEXT NOT NULL,
            selector TEXT NOT NULL,payload TEXT NOT NULL,result TEXT NOT NULL,expires_at REAL NOT NULL,
            created_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
        ''')

    def backup(self):
        """Online SQLite backup, including WAL; private and bounded to 10 days."""
        folder = self.path.parent / 'backups'
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        name = 'admin-store-' + self.stamp()[:10] + '.sqlite3'
        target = folder / name
        if target.exists():
            return target
        temporary = folder / ('.admin-backup-' + uuid.uuid4().hex)
        try:
            with closing(sqlite3.connect(temporary)) as destination:
                self.db.backup(destination)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
        finally:
            if temporary.exists():
                temporary.unlink()
        files = sorted(path for path in folder.glob('admin-store-????-??-??.sqlite3') if path.is_file() and not path.is_symlink())
        for path in files[:-10]:
            path.unlink()
        return target

    def stamp(self):
        return datetime.fromtimestamp(self._control_clock(), timezone.utc).isoformat()

    def _favorites_count(self, user_id):
        try:
            row = self.db.execute('SELECT payload FROM preferences WHERE user_id=?', (user_id,)).fetchone()
        except Exception:
            return 0  # AuthStore's bootstrap runs before this table exists.
        return len(json.loads(row[0]).get('favorites', [])) if row else 0

    def account_stats(self):
        users = self.db.execute('SELECT count(*),COALESCE(sum(disabled),0) FROM users').fetchone()
        favorites = sum(len(json.loads(row[0]).get('favorites', [])) for row in self.db.execute('SELECT payload FROM preferences'))
        return {'total': users[0], 'favorites': favorites, 'disabled': users[1]}

    def preferences(self, user_id):
        row = self.db.execute('SELECT payload,revision FROM preferences WHERE user_id=?', (user_id,)).fetchone()
        return {**json.loads(row[0]), 'revision': row[1]} if row else {'favorites': [], 'watched': {}, 'library': {}, 'revision': 0}

    def preference_ops(self, user_id, ops):
        user = self.user(user_id)
        if user.get('disabled'):
            raise AdminError('حساب غیرفعال است.', 403)
        if not isinstance(ops, list) or not 1 <= len(ops) <= 100:
            raise AdminError('تعداد تغییرات معتبر نیست.', 422)
        with self.transaction():
            data = self.preferences(user_id)
            revision = data.pop('revision')
            changed = False
            for op in ops:
                if not isinstance(op, dict) or not re.fullmatch(r'[a-fA-F0-9-]{32,36}', str(op.get('id', ''))):
                    raise AdminError('شناسه تغییر معتبر نیست.', 422)
                if self.db.execute('SELECT 1 FROM preference_operations WHERE user_id=? AND id=?', (user_id, op['id'])).fetchone():
                    continue
                kind = op.get('type')
                slug = op.get('slug')
                value = op.get('value')
                if kind != 'clear-favorites' and (not isinstance(slug, str) or not SLUG.fullmatch(slug)):
                    raise AdminError('عنوان معتبر نیست.', 422)
                if kind == 'favorite' and isinstance(value, bool):
                    data['favorites'] = [item for item in data['favorites'] if item != slug]
                    if value:
                        data['favorites'].insert(0, slug)
                elif kind == 'watched' and isinstance(value, bool):
                    episode = op.get('episode')
                    if isinstance(episode, bool) or not isinstance(episode, int) or not 1 <= episode <= 9999:
                        raise AdminError('شماره قسمت معتبر نیست.', 422)
                    numbers = set(data['watched'].get(slug, []))
                    numbers.add(episode) if value else numbers.discard(episode)
                    if numbers:
                        data['watched'][slug] = sorted(numbers)
                    else:
                        data['watched'].pop(slug, None)
                elif kind == 'library' and value in (None, 'watching', 'planned', 'completed', 'paused'):
                    if value:
                        data['library'][slug] = value
                    else:
                        data['library'].pop(slug, None)
                elif kind == 'clear-favorites':
                    data['favorites'] = []
                else:
                    raise AdminError('نوع تغییر معتبر نیست.', 422)
                if (len(data['favorites']) > 2000 or len(data['library']) > 2000 or len(data['watched']) > 2000
                        or sum(len(numbers) for numbers in data['watched'].values()) > 20000):
                    raise AdminError('ظرفیت کتابخانه پر است.', 422)
                self.db.execute('INSERT INTO preference_operations VALUES(?,?,?)', (user_id, op['id'], self.stamp()))
                changed = True
            if changed:
                revision += 1
                self.db.execute('INSERT INTO preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision',
                                (user_id, encoded(data, 1500000), revision))
            return {**data, 'revision': revision}

    def audit(self, actor_id, action, target, before, after, note, reversible=False):
        # Callers never audit passwords, session responses or account preferences.
        def safe(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key.lower() in {'password', 'password_hash', 'token', 'csrf', 'service_token', 'owner_hash'}:
                        raise AdminError('ثبت اطلاعات محرمانه در تاریخچه مجاز نیست.', 422)
                    safe(child)
            elif isinstance(value, list):
                for child in value:
                    safe(child)
        safe(before); safe(after)
        cursor = self.db.execute('INSERT INTO audit_events(actor,action,target,before_json,after_json,note,at,reversible) VALUES(?,?,?,?,?,?,?,?)',
            (actor_id, action, target, encoded(before, 1000000), encoded(after, 1000000), note_text(note), self.stamp(), int(reversible)))
        return cursor.lastrowid

    def event(self, event_id):
        row = self.db.execute('SELECT * FROM audit_events WHERE id=?', (event_id,)).fetchone()
        if not row:
            raise AdminError('رویداد پیدا نشد.', 404)
        item = dict(row)
        item['before'], item['after'] = json.loads(item.pop('before_json')), json.loads(item.pop('after_json'))
        return item

    def history(self, page=1, page_size=20):
        page, page_size = page_number(page), min(50, max(1, int(page_size)))
        total = self.db.execute('SELECT count(*) FROM audit_events').fetchone()[0]
        rows = self.db.execute('''SELECT a.*,u.name AS actor_name FROM audit_events a LEFT JOIN users u ON u.id=a.actor
            ORDER BY a.id DESC LIMIT ? OFFSET ?''', (page_size, (page - 1) * page_size))
        items = [{'id': row['id'], 'actor': row['actor_name'] or 'سیستم', 'action': row['action'], 'target': row['target'],
                  'at': row['at'], 'reversible': bool(row['reversible'] and not row['undone_by']), 'summary': row['note']} for row in rows]
        return {'items': items, 'total': total, 'page': page, 'pageSize': page_size}

    def override(self, slug):
        row = self.db.execute('SELECT * FROM overrides WHERE slug=?', (slug,)).fetchone()
        return {'patch': json.loads(row['patch']), 'revision': row['revision'], 'updatedAt': row['updated_at']} if row else {'patch': {}, 'revision': 0}

    def all_overrides(self):
        return {row['slug']: {'patch': json.loads(row['patch']), 'revision': row['revision'], 'updatedAt': row['updated_at']}
                for row in self.db.execute('SELECT * FROM overrides')}

    def write_override(self, actor_id, slug, patch, expected_revision, note, action='catalog.patch'):
        self.require(actor_id, 'catalog.patch')
        if not isinstance(slug, str) or not SLUG.fullmatch(slug) or not isinstance(patch, dict) or set(patch) - FIELDS:
            raise AdminError('ویرایش عنوان معتبر نیست.', 422)
        if isinstance(expected_revision, bool) or not isinstance(expected_revision, int):
            raise AdminError('نسخه ویرایش معتبر نیست.', 422)
        note = note_text(note)
        payload = encoded(patch)
        with self.transaction():
            before = self.override(slug)
            if before['revision'] != expected_revision:
                raise AdminError('عنوان در جای دیگری تغییر کرده؛ آن را دوباره بارگیری کن.', 409)
            if patch.get('pinned') and not before['patch'].get('pinned'):
                pinned = self.db.execute("SELECT count(*) FROM overrides WHERE json_extract(patch,'$.pinned')=1").fetchone()[0]
                if pinned >= 5:
                    raise AdminError('حداکثر پنج عنوان ویژه مجاز است؛ ابتدا یکی را بردار.', 422)
            after = {'patch': patch, 'revision': expected_revision + 1, 'updatedAt': self.stamp()}
            self.db.execute('INSERT INTO overrides VALUES(?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET patch=excluded.patch,revision=excluded.revision,updated_at=excluded.updated_at,actor=excluded.actor',
                            (slug, payload, after['revision'], after['updatedAt'], actor_id))
            event_id = self.audit(actor_id, action, slug, before, after, note, reversible=action in {'catalog.patch', 'episode.patch'})
        return {'ok': True, 'revision': after['revision'], 'eventId': event_id}

    def undo_override(self, actor_id, event_id, note):
        self.require(actor_id, 'history.undo')
        with self.transaction():
            event = self.event(event_id)
            if event['action'] not in {'catalog.patch', 'episode.patch'} or not event['reversible'] or event['undone_by']:
                raise AdminError('این رویداد قابل بازگردانی نیست.', 409)
            current = self.override(event['target'])
            if current['revision'] != event['after']['revision'] or current['patch'] != event['after']['patch']:
                raise AdminError('پس از این رویداد ویرایش دیگری انجام شده؛ بازگردانی امن نیست.', 409)
            result = self.write_override(actor_id, event['target'], event['before']['patch'], current['revision'], note, 'catalog.undo')
            self.db.execute('UPDATE audit_events SET undone_by=? WHERE id=?', (result['eventId'], event_id))
            return result

    def command(self, actor_id, kind, payload, request_id=None):
        permission = {'catalog.refresh': 'catalog.patch', 'publish': 'publish', 'review.match': 'review', 'review.undo': 'review'}.get(kind)
        if not permission:
            raise AdminError('عملیات مجاز نیست.', 403)
        self.require(actor_id, permission)
        encoded_payload = encoded(payload)
        if request_id is not None and (not isinstance(request_id, str) or len(request_id) > 100):
            raise AdminError('شناسه درخواست معتبر نیست.', 422)
        with self.transaction():
            if request_id:
                existing = self.db.execute('SELECT id,state,kind,payload FROM admin_commands WHERE actor=? AND request_id=?', (actor_id, request_id)).fetchone()
                if existing:
                    if existing['kind'] != kind or existing['payload'] != encoded_payload:
                        raise AdminError('شناسه درخواست قبلاً برای عملیات دیگری استفاده شده است.', 409)
                    return {'ok': True, 'commandId': existing['id'], 'state': existing['state']}
            queued = self.db.execute("SELECT count(*) FROM admin_commands WHERE state IN ('pending','running')").fetchone()[0]
            if queued >= 100:
                raise AdminError('صف مدیریت پر است؛ کمی بعد تلاش کن.', 429)
            ident = uuid.uuid4().hex
            self.db.execute('INSERT INTO admin_commands(id,actor,kind,payload,state,created_at,request_id) VALUES(?,?,?,?,?,?,?)',
                            (ident, actor_id, kind, encoded_payload, 'pending', self.stamp(), request_id))
            return {'ok': True, 'commandId': ident, 'state': 'pending'}

    def claim_commands(self, limit=5):
        with self.transaction():
            rows = list(self.db.execute("SELECT * FROM admin_commands WHERE state='pending' ORDER BY created_at,id LIMIT ?", (max(1, min(10, limit)),)))
            for row in rows:
                self.db.execute("UPDATE admin_commands SET state='running' WHERE id=? AND state='pending'", (row['id'],))
            return [{**dict(row), 'payload': json.loads(row['payload'])} for row in rows]

    def finish_command(self, ident, state, error=''):
        if state not in {'applied', 'failed'}:
            raise AdminError('وضعیت عملیات معتبر نیست.', 422)
        with self.transaction():
            self.db.execute('UPDATE admin_commands SET state=?,finished_at=?,error=? WHERE id=?', (state, self.stamp(), str(error)[:500], ident))

    def get_command(self, ident):
        row = self.db.execute('SELECT * FROM admin_commands WHERE id=?', (ident,)).fetchone()
        if not row:
            raise AdminError('عملیات پیدا نشد.', 404)
        return {'id': row['id'], 'kind': row['kind'], 'state': row['state'], 'createdAt': row['created_at'],
                'finishedAt': row['finished_at'], 'error': row['error']}

    def recent_commands(self, limit=10):
        return [self.get_command(row[0]) for row in self.db.execute('SELECT id FROM admin_commands ORDER BY created_at DESC LIMIT ?', (min(50, max(1, limit)),))]

    def settings(self):
        row = self.db.execute('SELECT mode,revision FROM admin_settings WHERE id=1').fetchone()
        return {'publicationMode': row[0], 'revision': row[1]}

    def write_settings(self, actor_id, expected_revision, mode):
        self.require(actor_id, 'owner')
        if mode not in {'manual', 'automatic'} or isinstance(expected_revision, bool) or not isinstance(expected_revision, int):
            raise AdminError('تنظیمات معتبر نیست.', 422)
        with self.transaction():
            before = self.settings()
            if before['revision'] != expected_revision:
                raise AdminError('تنظیمات تغییر کرده؛ دوباره بارگیری کن.', 409)
            after = {'publicationMode': mode, 'revision': expected_revision + 1}
            self.db.execute('UPDATE admin_settings SET mode=?,revision=? WHERE id=1', (mode, after['revision']))
            event_id = self.audit(actor_id, 'settings.patch', 'publication', before, after, 'تغییر روش انتشار سایت')
            return {'ok': True, 'revision': after['revision'], 'eventId': event_id}
