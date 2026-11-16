#!/usr/bin/env python3
"""Private loopback control API. No shell/process actions or archive writes.

Vercel forwards authenticated, same-origin requests through a separate signed
outbound tunnel. Browser sessions and service authorization are independent.
"""
import base64
from copy import deepcopy
from contextlib import closing, contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import subprocess
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid

from admin_store import AdminError, AdminStore, encoded, note_text, page_number
from common import DATA, DEST_USERNAME, ROOT, now_iso

SERVICE_TOKEN = os.environ.get('AV_ADMIN_SERVICE_TOKEN', '')
DB_PATH = DATA / 'admin.sqlite3'
CACHE_PATH = Path.home() / '.local/share/animeverse-download-cache/cache.sqlite'
SERVICES = {'animeverse-archive-pipeline.service': 'کپی آرشیو', 'animeverse-catalog-publisher.service': 'انتشار سایت',
            'animeverse-download-cache.service': 'آماده‌سازی دانلود', 'animeverse-download-cache-tunnel.service': 'ارتباط دانلود',
             'animeverse-admin.service': 'مدیریت', 'animeverse-admin-tunnel.service': 'ارتباط مدیریت',
             'animeverse-notify.service': 'اعلان‌های شخصی تلگرام'}


def read_json(path, fallback=None):
    return json.loads(path.read_text()) if path.exists() else fallback


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


@contextmanager
def archive_connection(root=ROOT):
    database = sqlite3.connect('file:' + str(root / 'data/archive-pipeline.sqlite3') + '?mode=ro', uri=True, timeout=10)
    database.row_factory = sqlite3.Row
    try:
        yield database
    finally:
        database.close()


def target_fingerprint(anime):
    return fingerprint({key: anime.get(key) for key in ('key', 'slug', 'titleEn', 'titleOriginal', 'year', 'format', 'type', 'declaredEpisodes', 'metadataProviderId')})


class DataView:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.lock = threading.RLock()
        self.files = {}
        self.base_cache = (None, [])
        self.review_index = {}
        self.review_at = None
        self.review_refreshing = False

    def load(self, relative, fallback=None):
        path = self.root / relative
        if not path.exists():
            return fallback
        stamp = path.stat().st_mtime_ns
        with self.lock:
            if relative not in self.files or self.files[relative][0] != stamp:
                self.files[relative] = (stamp, json.loads(path.read_text()))
            return self.files[relative][1]

    def state(self):
        result = self.load('data/aniplus-state.json')
        if not result or not isinstance(result.get('anime'), dict):
            raise AdminError('اطلاعات آرشیو هنوز در دسترس نیست.', 503)
        return result

    def base_rows(self):
        state = self.state()
        marker = self.files['data/aniplus-state.json'][0]
        with self.lock:
            if self.base_cache[0] != marker:
                from catalog import build_catalog
                self.base_cache = (marker, build_catalog(state, admin=False))
            return self.base_cache[1]

    def published(self):
        return self.load('data/admin-published-catalog.json', {'slugs': [], 'revisions': {}})

    def title(self, slug, store, canonical=False):
        found = next(((key, anime) for key, anime in self.state()['anime'].items() if anime.get('slug') == slug), None)
        if not found:
            raise AdminError('عنوان پیدا نشد.', 404)
        key, anime = found
        row = next((item for item in self.base_rows() if item['slug'] == slug), {})
        entry = store.override(slug)
        patch = entry['patch'] if not canonical else {}
        episodes = row.get('episodeData') or []
        hidden_qualities = patch.get('episodeHidden') or {}
        ready = [episode for episode in episodes if any(not hidden_qualities.get(str(episode['number']) + '|' + quality['label']) for quality in episode['qualities'])]
        item = {'slug': slug, 'key': key, 'title': row.get('title') or anime.get('titleFa') or anime.get('titleEn') or slug,
                'titleEn': row.get('titleEn') or anime.get('titleEn') or anime.get('titleOriginal') or slug,
                'titleJa': row.get('titleJa') or anime.get('titleJa') or '', 'year': anime.get('year') or None,
                'type': anime.get('type') or row.get('type') or '', 'format': anime.get('format') or '',
                'status': anime.get('status') or '', 'cover': row.get('cover') or anime.get('cover') or '',
                'banner': row.get('banner') or anime.get('banner') or '', 'studio': row.get('studio') or anime.get('studio') or '',
                'synopsis': row.get('synopsis') or anime.get('synopsis') or '', 'genres': row.get('genres') or anime.get('genres') or [],
                'readyEpisodes': len(ready), 'readyQualities': sum(sum(not hidden_qualities.get(str(ep['number']) + '|' + q['label']) for q in ep['qualities']) for ep in episodes),
                'declaredEpisodes': anime.get('declaredEpisodes'), 'hidden': bool(patch.get('hidden')), 'pinned': bool(patch.get('pinned')),
                'revision': entry['revision'], 'source': row.get('source') or ('archive' if anime.get('metadataSource') == 'anilist' else 'aniplus'),
                'metadataUrl': anime.get('metadataUrl') or anime.get('metadataEnrichmentUrl') or '',
                'updatedAt': entry.get('updatedAt') or anime.get('updatedAt') or '', 'published': slug in self.published().get('slugs', []),
                'editorScore': patch.get('editorScore')}
        for name in ('title', 'titleEn', 'titleJa', 'year', 'cover', 'banner', 'studio', 'synopsis', 'genres'):
            if name in patch and patch[name] is not None:
                item[name] = patch[name]
        return item

    def catalog_page(self, store, query='', page=1, filter='all'):
        page = page_number(page)
        query = query[:200].casefold()
        entries = store.all_overrides()
        # Build compact list fields once; paging avoids sending episode payloads.
        rows = []
        for key, anime in self.state()['anime'].items():
            slug = anime.get('slug')
            if not slug:
                continue
            patch = entries.get(slug, {}).get('patch', {})
            haystack = ' '.join(str(value or '') for value in (anime.get('titleEn'), anime.get('titleFa'), anime.get('titleOriginal'), slug, patch.get('title'), patch.get('titleEn'))).casefold()
            if query and query not in haystack:
                continue
            if filter == 'hidden' and not patch.get('hidden') or filter == 'pinned' and not patch.get('pinned'):
                continue
            if filter == 'unpublished' and slug in self.published().get('slugs', []):
                continue
            rows.append(slug)
        rows.sort(key=lambda slug: (not entries.get(slug, {}).get('patch', {}).get('pinned'), slug))
        return {'items': [self.title(slug, store) for slug in rows[(page - 1) * 20:page * 20]], 'total': len(rows), 'page': page, 'pageSize': 20}

    def detail(self, slug, store):
        item = self.title(slug, store)
        row = next((row for row in self.base_rows() if row['slug'] == slug), {})
        hidden = store.override(slug)['patch'].get('episodeHidden') or {}
        episodes = []
        for episode in row.get('episodeData') or []:
            qualities = []
            for quality in episode['qualities']:
                match = re.fullmatch(r'archive:(\d+)', quality.get('deepLink') or '')
                qualities.append({'label': quality['label'], 'url': quality.get('url') or '', 'size': quality.get('size'),
                                  'hidden': bool(hidden.get(str(episode['number']) + '|' + quality['label'])), 'fileId': int(match[1]) if match else None})
            episodes.append({'number': episode['number'], 'qualities': qualities})
        return {'item': item, 'episodes': episodes, 'revision': item['revision']}

    def review_file(self, row):
        from backfill import archive_identity_hint
        record = archive_identity_hint(json.loads(row['record']))
        with self.lock:
            advice = self.review_index.get(row['id'], {})
        cache = self.load('data/archive-identity-cache.json', {})
        from archive_identity import entry_media
        media = entry_media(cache.get(record.get('title'), {}))
        reason = advice.get('reason') or ''
        if record.get('title') and not record.get('quality'):
            reason = 'عنوان از نام فایل مشخص است؛ وضوح عددی در نام ثبت نشده و باید از مشخصات ویدیو بررسی شود.'
        return {'id': row['id'], 'title': record.get('title') or '', 'filename': record.get('name') or '',
                'episode': record.get('episode'), 'season': record.get('season'), 'quality': record.get('quality') or '',
                'size': record.get('size'), 'status': advice.get('status') or 'needs_review', 'reason': reason,
                'destinationUrl': f'https://t.me/{DEST_USERNAME}/{row["destination_id"]}' if row['destination_id'] else '',
                'candidates': [{'id': item['id'], 'title': item.get('title', {}).get('romaji') or '',
                                'year': (item.get('startDate') or {}).get('year')} for item in media[:8]]}

    def review_page(self, query='', page=1, status='all'):
        page = page_number(page)
        query = query[:200].casefold()
        with archive_connection(self.root) as database:
            rows = list(database.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL ORDER BY id"))
        selected = []
        with self.lock:
            for row in rows:
                record = json.loads(row['record'])
                if query and query not in (str(record.get('title') or '') + ' ' + str(record.get('name') or '')).casefold():
                    continue
                if status != 'all' and self.review_index.get(row['id'], {}).get('status', 'needs_review') != status:
                    continue
                selected.append(row)
        return {'items': [self.review_file(row) for row in selected[(page - 1) * 20:page * 20]], 'total': len(selected),
                'page': page, 'pageSize': 20, 'refreshedAt': self.review_at, 'refreshing': self.review_refreshing}

    def refresh_review(self):
        if self.review_refreshing:
            return
        self.review_refreshing = True
        try:
            from archive_review import review_rows
            with archive_connection(self.root) as database:
                rows = [{**dict(row), 'parsed': json.loads(row['record'])} for row in database.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL")]
                bindings = {row['title']: dict(row) for row in database.execute('SELECT * FROM bindings')}
            decisions = review_rows(rows, self.state(), self.load('data/archive-identity-cache.json', {}), bindings)
            with self.lock:
                self.review_index = {item['id']: item for item in decisions}
                self.review_at = now_iso()
        finally:
            self.review_refreshing = False


def validate_patch(patch):
    allowed = {'title', 'titleEn', 'titleJa', 'year', 'studio', 'synopsis', 'genres', 'cover', 'banner', 'hidden', 'pinned', 'editorScore'}
    if not isinstance(patch, dict) or not patch or set(patch) - allowed:
        raise AdminError('فیلد ویرایش مجاز نیست.', 422)
    for key, value in patch.items():
        if value is None and key in {'year', 'editorScore'}:
            continue
        if key in {'hidden', 'pinned'}:
            if not isinstance(value, bool):
                raise AdminError('وضعیت معتبر نیست.', 422)
        elif key == 'year':
            if isinstance(value, bool) or not isinstance(value, int) or not 1895 <= value <= 2100:
                raise AdminError('سال معتبر نیست.', 422)
        elif key == 'editorScore':
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 10:
                raise AdminError('امتیاز تحریریه باید بین صفر و ده باشد.', 422)
        elif key == 'genres':
            if not isinstance(value, list) or len(value) > 20 or any(not isinstance(item, str) or not 1 <= len(item) <= 60 for item in value):
                raise AdminError('ژانرها معتبر نیستند.', 422)
        elif not isinstance(value, str) or len(value) > (10000 if key == 'synopsis' else 800 if key in {'cover', 'banner'} else 400):
            raise AdminError('متن ویرایش معتبر نیست.', 422)
        if key in {'title', 'titleEn'} and len(value.strip()) < 2:
            raise AdminError('عنوان نباید خالی باشد.', 422)
        if key in {'cover', 'banner'} and value:
            if not re.fullmatch(r'/covers/admin/[a-f0-9]{64}\.webp', value):
                raise AdminError('تصویر را از بخش بارگذاری امن انتخاب کن.', 422)
    return patch


def media_upload(root, payload):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 16_000_000
    if payload.get('mime') not in {'image/jpeg', 'image/png', 'image/webp'} or not isinstance(payload.get('data'), str):
        raise AdminError('فقط تصویر JPEG، PNG یا WebP مجاز است.', 422)
    try:
        raw = base64.b64decode(payload['data'], validate=True)
        if not raw or len(raw) > 3 * 1024 * 1024:
            raise AdminError('تصویر باید حداکثر ۳ مگابایت باشد.', 413)
        with Image.open(io.BytesIO(raw)) as image:
            if image.format not in {'JPEG', 'PNG', 'WEBP'} or image.width * image.height > 16_000_000:
                raise ValueError('invalid image')
            image.verify()
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image).convert('RGB')
            image.thumbnail((2048, 2048))
            output = io.BytesIO()
            image.save(output, 'WEBP', quality=85, method=4)
            content = output.getvalue()
        if len(content) > 4_000_000:
            raise AdminError('حجم تصویر پردازش‌شده زیاد است.', 413)
    except AdminError:
        raise
    except Exception:
        raise AdminError('ساختار تصویر معتبر نیست.', 422)
    name = hashlib.sha256(content).hexdigest() + '.webp'
    folder = root / 'public/covers/admin'
    folder.mkdir(parents=True, exist_ok=True)
    destination = folder / name
    if not destination.exists():
        temporary = folder / ('.' + uuid.uuid4().hex)
        temporary.write_bytes(content)
        os.chmod(temporary, 0o644)
        os.replace(temporary, destination)
    return {'url': '/covers/admin/' + name, 'previewUrl': '/api/admin/media/' + name}


def prepare_review(row, key, anime, data):
    from archive_identity import explicit_markers, safe_episode_record, safe_movie_record
    from backfill import parse_archive_fields
    errors, warnings = [], []
    old = json.loads(row['record'])
    note_text(data.get('note'))
    episode, quality = data.get('episode'), data.get('quality')
    if row['state'] != 'copied' or not row['destination_id'] or row['anime_key'] is not None:
        errors.append('فایل باید کپی‌شده و هنوز بدون اتصال باشد.')
    if isinstance(episode, bool) or not isinstance(episode, int) or not 1 <= episode <= 9999:
        errors.append('شماره قسمت معتبر نیست.')
    parsed = parse_archive_fields(old.get('name') or '', '', row['id'], old.get('size'), old.get('date', ''))
    if not isinstance(quality, str) or quality not in {old.get('quality'), (parsed or {}).get('quality')}:
        errors.append('کیفیت باید همان کیفیت مستند فایل باشد.')
    movie = anime.get('format') == 'MOVIE' or anime.get('type') == 'فیلم'
    if not movie and episode not in {old.get('episode'), (parsed or {}).get('episode')}:
        errors.append('این شماره قسمت از فایل قابل تأیید نیست.')
    if movie and episode != 1:
        errors.append('فیلم فقط یک جایگاه دانلود دارد، نه قسمت ساختگی.')
    declared = anime.get('declaredEpisodes')
    if isinstance(declared, int) and isinstance(episode, int) and episode > declared:
        errors.append('شماره قسمت بالاتر از تعداد اعلام‌شدهٔ مرجع است.')
    if not declared and not movie:
        warnings.append('تعداد کل قسمت‌ها در مرجع ثبت نشده؛ عددی ساخته نمی‌شود.')
    updated = {**old, 'episode': None if movie and old.get('episode') is None else episode, 'quality': quality,
               'title': (parsed or {}).get('title') or old.get('title') or ''}
    if parsed:
        updated['season'], updated['part'] = parsed.get('season'), parsed.get('part')
    if not safe_episode_record({**updated, 'episode': episode}):
        updated['originalCaption'] = old.get('originalCaption', old.get('caption') or '')
        updated['caption'] = ''
        warnings.append('کپشن ناسازگار کنار گذاشته می‌شود؛ نسخهٔ اصلی در تاریخچه حفظ خواهد شد.')
    if not (safe_movie_record(updated) if movie else safe_episode_record(updated)):
        errors.append('نام فایل، قسمت، کیفیت یا بستهٔ چندقسمتی برای انتشار امن نیست.')
    source_markers = explicit_markers(updated.get('title'))
    target_markers = explicit_markers(str(anime.get('titleEn') or '') + ' ' + str(anime.get('titleOriginal') or ''))
    from archive_identity import APPROVED_ALIASES
    for alias, (ident, _, _, _) in APPROVED_ALIASES.items():
        if ident == anime.get('metadataProviderId'):
            target_markers |= explicit_markers(alias)
    if any(kind == other_kind and number != other_number for kind, number in source_markers for other_kind, other_number in target_markers):
        errors.append('فصل یا بخش صریح فایل با عنوان مقصد متفاوت است.')
    if any(number > 1 and (kind, number) not in target_markers for kind, number in source_markers):
        errors.append('فصل یا بخش صریح فایل در مرجع مقصد تأیید نشده است.')
    years = {int(value) for value in re.findall(r'\b(?:19|20)\d{2}\b', old.get('name') or '')}
    if years and years != {anime.get('year')}:
        errors.append('سال صریح فایل با سال مرجع مقصد متفاوت است.')
    bucket = (anime.get('episodes') or {}).get(str(episode), {})
    if bucket.get(quality):
        warnings.append('این قسمت و کیفیت قبلاً لینک دارد؛ بدون انتخاب جایگزینی، لینک قبلی حفظ می‌شود.')
    payload = {'fileId': row['id'], 'targetKey': key, 'targetSlug': anime['slug'], 'episode': episode, 'quality': quality,
               'note': data['note'].strip(), 'replaceExisting': data.get('replaceExisting') is True,
               'sourceHash': hashlib.sha256(row['record'].encode()).hexdigest(), 'targetHash': target_fingerprint(anime),
               'record': updated, 'previousSlot': bucket.get(quality)}
    return payload, list(dict.fromkeys(errors)), list(dict.fromkeys(warnings))


class ControlAPI:
    def __init__(self, root=ROOT, database=None, cache_path=CACHE_PATH):
        self.root, self.path, self.cache_path = Path(root), Path(database or (Path(root) / 'data/admin.sqlite3')), Path(cache_path)
        self.view = DataView(self.root)

    def overview(self, store):
        rows = self.view.base_rows()
        with archive_connection(self.root) as database:
            counts = dict(database.execute('SELECT state,count(*) FROM files GROUP BY state'))
            unmatched = database.execute("SELECT count(*) FROM files WHERE state='copied' AND anime_key IS NULL").fetchone()[0]
            held = database.execute("SELECT count(*) FROM files f JOIN bindings b ON b.title=json_extract(f.record,'$.title') WHERE f.state='copied' AND b.conflict=1").fetchone()[0]
        with closing(sqlite3.connect('file:' + str(self.cache_path) + '?mode=ro', uri=True, timeout=10)) as cache:
            states = dict(cache.execute('SELECT state,count(*) FROM jobs GROUP BY state'))
            usage = dict(cache.execute('SELECT bucket,COALESCE(sum(size),0) FROM jobs WHERE asset_id IS NOT NULL GROUP BY bucket'))
        services = []
        pipeline = self.view.load('data/archive-pipeline-status.json', {})
        for unit, label in SERVICES.items():
            try:
                result = subprocess.run(['systemctl', 'is-active', unit], capture_output=True, text=True, timeout=2)
                value = result.stdout.strip()
                status = {'active': 'running', 'inactive': 'offline', 'failed': 'failed', 'activating': 'starting', 'deactivating': 'stopping'}.get(value, 'unknown')
            except (OSError, subprocess.TimeoutExpired):
                status = 'unknown'
            services.append({'name': unit, 'label': label, 'state': status, **({'updatedAt': pipeline.get('updatedAt')} if 'archive-pipeline' in unit else {})})
        publication = dict(self.view.load('data/catalog-publish-status.json', {}))
        publication['state'] = {'verified': 'published', 'building': 'publishing', 'snapshot': 'publishing', 'error': 'failed'}.get(publication.get('state'), publication.get('state') or 'never')
        revisions = self.view.published().get('revisions', {})
        publication['pendingChanges'] = sum(entry['revision'] > revisions.get(slug, 0) for slug, entry in store.all_overrides().items())
        return {'serverNow': now_iso(), 'inventory': {'titles': len(rows), 'episodes': sum(len(row['episodeData']) for row in rows),
            'qualities': sum(len(episode['qualities']) for row in rows for episode in row['episodeData']),
            'copied': counts.get('copied', 0), 'pending': counts.get('pending', 0), 'unmatched': unmatched, 'held': held},
            'services': services, 'publication': publication,
            'cache': {'states': {**{key: value for key, value in states.items() if key not in {'uploading', 'waiting'}},
                                  **({'copying': states['uploading']} if 'uploading' in states else {}),
                                  **({'pending': states['waiting']} if 'waiting' in states else {})}, 'bytes': {'hot': usage.get('hot', 0), 'temp': usage.get('temp', 0)},
                      'active': states.get('queued', 0) + states.get('uploading', 0), 'capacity': 40},
            'accounts': store.account_stats(), 'activity': store.history(page_size=8)['items'], 'commands': store.recent_commands()}

    def account_payload(self, store, session):
        user = session['user']
        return {'user': {'id': user['id'], 'name': user['name'], 'email': user['email'], 'role': user['role'], 'joinedAt': user['createdAt']},
                'csrf': session['csrf'], 'preferences': store.preferences(user['id'])}

    def dispatch(self, method, path, query, body, headers):
        account = path.startswith('/v1/account/')
        route = path.removeprefix('/v1/account' if account else '/v1/admin')
        if not (account or path.startswith('/v1/admin/')):
            raise AdminError('مسیر پیدا نشد.', 404)
        store = AdminStore(self.path)
        try:
            client = headers.get('X-Client-Key', '')[:128]
            token, csrf = headers.get('X-Session-Token', ''), headers.get('X-CSRF-Token')
            kind = 'account' if account else 'admin'
            if account and method == 'POST' and route == '/access':
                login = store.redeem_owner_access(body.get('token'), client)
                store.audit(login['session']['user']['id'], 'account.access', login['session']['user']['id'], {}, {}, 'ورود امن یک‌بارمصرف مالک')
                return 200, {**self.account_payload(store, login['session']), 'token': login['token']}
            if not account:
                try:
                    owner_session = store.session(token, 'account')
                    store.require(owner_session['user']['id'], 'owner')
                except AdminError as error:
                    raise AdminError('صفحه پیدا نشد.', 404)
                if method != 'GET':
                    store.session(token, 'account', csrf=csrf, mutation=True)
                if route == '/session' and method == 'POST':
                    raise AdminError('صفحه پیدا نشد.', 404)
            if method == 'POST' and (route in {'/login', '/register'} if account else route == '/session'):
                if account and route == '/register':
                    if set(body) - {'name', 'email', 'password'}:
                        raise AdminError('فیلد ثبت‌نام مجاز نیست.', 422)
                    with store.transaction():
                        store.db.execute('CREATE TABLE IF NOT EXISTS signup_attempts(client TEXT,at REAL)')
                        store.db.execute('DELETE FROM signup_attempts WHERE at<?', (time.time() - 3600,))
                        if store.db.execute('SELECT count(*) FROM signup_attempts WHERE client=?', (client,)).fetchone()[0] >= 10:
                            raise AdminError('تلاش ثبت‌نام زیاد است؛ بعداً تلاش کن.', 429)
                        store.db.execute('INSERT INTO signup_attempts VALUES(?,?)', (client, time.time()))
                    store.create_account(body.get('name'), body.get('email'), body.get('password'))
                email = body.get('email')
                if not account and not email:
                    owner = store.db.execute("SELECT email FROM users WHERE role='owner'").fetchone()
                    email = owner[0] if owner else ''
                login = store.login(email, body.get('password'), client, kind)
                return 200, {**(self.account_payload(store, login['session']) if account else {'session': login['session']}), 'token': login['token']}
            session = store.session(token, 'account', csrf=csrf, mutation=method != 'GET')
            actor = session['user']['id']
            if route == '/session':
                if method == 'GET':
                    return 200, self.account_payload(store, session) if account else {'session': session}
                if method == 'DELETE':
                    store.logout(token)
                    return 200, {'ok': True}
            if account:
                if route.startswith('/notifications/'):
                    from notification_store import Notifications
                    notifications = Notifications(store, self.root / 'data')
                    action = route.removeprefix('/notifications/')
                    if action == 'status' and method == 'GET':
                        return 200, notifications.status(actor)
                    if action == 'link' and method == 'POST' and not body:
                        return 200, notifications.link(actor)
                    if action == 'preferences' and method == 'POST' and set(body) == {'enabled'}:
                        return 200, notifications.preference(actor, body['enabled'])
                    if action == 'unlink' and method == 'DELETE':
                        return 200, notifications.unlink(actor)
                    raise AdminError('درخواست تنظیم اعلان معتبر نیست.', 422)
                if route == '/preferences' and method == 'POST':
                    return 200, store.preference_ops(actor, body.get('operations'))
                raise AdminError('مسیر پیدا نشد.', 404)
            store.require(actor, 'read')
            q = lambda key, default='': query.get(key, [default])[0]
            if route == '/overview' and method == 'GET':
                return 200, self.overview(store)
            if route == '/imports/preview' and method == 'POST':
                from post_imports import request_preview
                return 202, request_preview(store, actor, body)
            match = re.fullmatch(r'/imports/([a-f0-9]{32})(/confirm)?', route)
            if match:
                from post_imports import confirm_preview, get_preview
                if method == 'GET' and not match[2]:
                    return 200, get_preview(store, actor, match[1])
                if method == 'POST' and match[2]:
                    return 202, confirm_preview(store, actor, match[1], body)
            if route == '/catalog' and method == 'GET':
                return 200, self.view.catalog_page(store, q('query'), q('page', '1'), q('filter', 'all'))
            match = re.fullmatch(r'/catalog/([a-z0-9][a-z0-9-]{0,199})(/episodes)?', route)
            if match:
                slug = match[1]
                detail = self.view.detail(slug, store)
                if method == 'GET' and not match[2]:
                    return 200, detail
                if method == 'PATCH':
                    store.require(actor, 'catalog.patch')
                    before = store.override(slug)['patch']
                    if match[2]:
                        number, quality = body.get('episode'), body.get('quality')
                        if isinstance(number, bool) or not isinstance(number, int) or not isinstance(body.get('hidden'), bool):
                            raise AdminError('وضعیت قسمت معتبر نیست.', 422)
                        if not any(ep['number'] == number and any(item['label'] == quality for item in ep['qualities']) for ep in detail['episodes']):
                            raise AdminError('این قسمت و کیفیت فایل آماده ندارد.', 422)
                        hidden = {**before.get('episodeHidden', {}), str(number) + '|' + str(quality): body['hidden']}
                        patch = {**before, 'episodeHidden': hidden}
                    else:
                        updates = validate_patch(body.get('patch'))
                        for field in ('cover', 'banner'):
                            if updates.get(field) and not (self.root / 'public' / updates[field].lstrip('/')).is_file():
                                raise AdminError('تصویر بارگذاری‌شده پیدا نشد.', 422)
                        if updates.get('pinned') and not before.get('pinned') and sum(bool(entry['patch'].get('pinned')) for entry in store.all_overrides().values()) >= 5:
                            raise AdminError('حداکثر پنج عنوان ویژه مجاز است؛ ابتدا یکی را بردار.', 422)
                        patch = {**before, **updates}
                    result = store.write_override(actor, slug, patch, body.get('expectedRevision'), body.get('note'), 'episode.patch' if match[2] else 'catalog.patch')
                    store.command(actor, 'catalog.refresh', {}, 'event:' + str(result['eventId']))
                    return 200, result
            if route == '/review' and method == 'GET':
                return 200, self.view.review_page(q('query'), q('page', '1'), q('status', 'all'))
            if route == '/review/preview' and method == 'POST':
                store.require(actor, 'review')
                if set(body) - {'fileId', 'targetSlug', 'episode', 'quality', 'note', 'replaceExisting'}:
                    raise AdminError('فیلد بررسی مجاز نیست.', 422)
                file_id = body.get('fileId')
                if isinstance(file_id, bool) or not isinstance(file_id, int):
                    raise AdminError('شناسه فایل معتبر نیست.', 422)
                with archive_connection(self.root) as database:
                    row = database.execute('SELECT * FROM files WHERE id=?', (file_id,)).fetchone()
                    if not row:
                        raise AdminError('فایل پیدا نشد.', 404)
                target = self.view.title(body.get('targetSlug'), store, canonical=True)
                anime = self.view.state()['anime'][target['key']]
                payload, errors, warnings = prepare_review(row, target['key'], anime, body)
                ident = uuid.uuid4().hex
                expires = time.time() + 600
                result = {'id': ident, 'expiresAt': datetime.fromtimestamp(expires, timezone.utc).isoformat(),
                          'valid': not errors, 'source': self.view.review_file(row), 'target': target,
                          'episode': body.get('episode'), 'quality': body.get('quality'), 'warnings': warnings, 'errors': errors}
                store.db.execute('INSERT INTO admin_previews VALUES(?,?,?,?,?,NULL)', (ident, actor, encoded(payload), encoded(result), expires))
                store.db.execute('DELETE FROM admin_previews WHERE expires_at<? AND command_id IS NULL', (time.time() - 86400,))
                return 200, result
            if route == '/review/apply' and method == 'POST':
                store.require(actor, 'review')
                preview = store.db.execute('SELECT * FROM admin_previews WHERE id=? AND actor=?', (body.get('previewId'), actor)).fetchone()
                if not preview or preview['expires_at'] < time.time() or not json.loads(preview['result'])['valid'] or body.get('confirm') is not True:
                    raise AdminError('پیش‌نمایش معتبر نیست یا منقضی شده؛ دوباره بررسی کن.', 409)
                payload = json.loads(preview['payload'])
                result = store.command(actor, 'review.match', payload, 'preview:' + preview['id'])
                store.db.execute('UPDATE admin_previews SET command_id=? WHERE id=?', (result['commandId'], preview['id']))
                return 202, result
            match = re.fullmatch(r'/commands/([a-f0-9-]{32,36})', route)
            if match and method == 'GET':
                return 200, store.get_command(match[1])
            if route == '/history' and method == 'GET':
                return 200, store.history(page=q('page', '1'))
            match = re.fullmatch(r'/history/(\d+)/undo', route)
            if match and method == 'POST' and body.get('confirm') is True:
                event = store.event(int(match[1]))
                if event['action'] == 'review.match':
                    store.require(actor, 'review')
                    if session['user']['role'] == 'reviewer' and event['actor'] != actor:
                        raise AdminError('بازگردانی بررسی دیگران مجاز نیست.', 403)
                    return 202, store.command(actor, 'review.undo', {'eventId': int(match[1]), 'note': note_text(body.get('note'))})
                result = store.undo_override(actor, int(match[1]), body.get('note'))
                store.command(actor, 'catalog.refresh', {}, 'event:' + str(result['eventId']))
                return 200, result
            if route == '/users':
                store.require(actor, 'owner')
                if method == 'GET':
                    return 200, store.accounts(q('query'), q('page', '1'))
                if method == 'POST':
                    user = store.create_account(body.get('name'), body.get('email'), body.get('password'), body.get('role'), actor)
                    store.audit(actor, 'users.create', user['id'], {}, user, 'ساخت حساب همکار مدیریت')
                    return 201, user
            match = re.fullmatch(r'/users/([a-f0-9-]{32,36})', route)
            if match and method == 'PATCH' and body.get('confirm') is True:
                before = store.user(match[1])
                user = store.update_account(actor, match[1], {key: value for key, value in body.items() if key != 'confirm'})
                store.audit(actor, 'users.patch', user['id'], before, user, 'تغییر دسترسی یا وضعیت حساب')
                return 200, user
            if route == '/settings':
                if method == 'GET':
                    owner = store.db.execute("SELECT email FROM users WHERE role='owner'").fetchone()
                    return 200, {**store.settings(), 'limits': {'workerCount': 1, 'activeJobs': 40, 'tempBytes': 10 * 1024**3, 'hotBytes': 20 * 1024**3}, 'adminEmail': owner[0] if owner else ''}
                if method == 'PATCH':
                    return 200, store.write_settings(actor, body.get('expectedRevision'), body.get('publicationMode'))
            if route == '/password' and method == 'POST':
                store.change_password(actor, body.get('oldPassword'), body.get('newPassword'))
                store.audit(actor, 'account.password', actor, {}, {}, 'تغییر رمز و خروج نشست‌های قبلی')
                return 200, {'ok': True}
            if route == '/publish' and method == 'POST' and body.get('confirm') is True:
                return 202, store.command(actor, 'publish', {})
            if route == '/media' and method == 'POST':
                store.require(actor, 'media')
                result = media_upload(self.root, body)
                store.audit(actor, 'media.upload', result['url'], {}, {'url': result['url']}, 'بارگذاری تصویر معتبر و پاک‌سازی فراداده')
                return 201, result
            match = re.fullmatch(r'/media/([a-f0-9]{64}\.webp)', route)
            if match and method == 'GET':
                store.require(actor, 'read')
                path = self.root / 'public/covers/admin' / match[1]
                if not path.is_file() or path.is_symlink():
                    raise AdminError('تصویر پیدا نشد.', 404)
                return 200, path.read_bytes()
            if route == '/backups' and method == 'GET':
                store.require(actor, 'owner')
                items = []
                folder = self.root / 'data/backups'
                if folder.exists():
                    for path in sorted(folder.glob('admin-*'), reverse=True)[:10]:
                        if path.is_dir() and not path.is_symlink():
                            items.append({'id': path.name, 'createdAt': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                                          'size': sum(item.stat().st_size for item in path.iterdir() if item.is_file()), 'kind': 'admin'})
                        elif path.is_file() and not path.is_symlink() and re.fullmatch(r'admin-store-\d{4}-\d{2}-\d{2}\.sqlite3', path.name):
                            items.append({'id': path.name, 'createdAt': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
                                          'size': path.stat().st_size, 'kind': 'admin-database'})
                return 200, {'items': items}
            raise AdminError('روش یا مسیر مجاز نیست.', 405)
        finally:
            store.close()


class AdminHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16
    def __init__(self, address, handler, api):
        super().__init__(address, handler)
        self.api = api
        self.slots = threading.BoundedSemaphore(8)

    def process_request(self, request, address):
        request.settimeout(10)
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server_version = 'AnimeVerseControl'
    def log_message(self, *args):
        pass

    def reply(self, code, payload):
        image = isinstance(payload, bytes)
        body = payload if image else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(code)
        for key, value in [('Content-Type', 'image/webp' if image else 'application/json; charset=utf-8'),
                           ('Cache-Control', 'private, no-store'), ('Content-Length', str(len(body))),
                           ('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'no-referrer')]:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def dispatch(self):
        parsed = urlsplit(self.path)
        if self.command == 'GET' and parsed.path == '/health':
            self.reply(200, {'ok': True, 'service': 'animeverse-admin'})
            return
        supplied = self.headers.get('Authorization', '')
        if not SERVICE_TOKEN or len(supplied) > 256 or not hmac.compare_digest(supplied, 'Bearer ' + SERVICE_TOKEN):
            self.reply(401, {'error': 'Unauthorized'})
            return
        try:
            limit = 4_300_000 if parsed.path == '/v1/admin/media' else 300_000
            if self.headers.get('Transfer-Encoding'):
                raise AdminError('انتقال تکه‌ای مجاز نیست.', 400)
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 <= size <= limit:
                raise AdminError('حجم درخواست بیش از حد مجاز است.', 413)
            body = {}
            if size:
                if not (self.headers.get('Content-Type') or '').lower().startswith('application/json'):
                    raise AdminError('بدنه درخواست معتبر نیست.', 415)
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict):
                    raise AdminError('بدنه درخواست معتبر نیست.', 400)
            code, result = self.server.api.dispatch(self.command, parsed.path, parse_qs(parsed.query), body, self.headers)
            self.reply(code, result)
        except AdminError as error:
            self.reply(error.status, {'error': str(error)})
        except (ValueError, TypeError, json.JSONDecodeError):
            self.reply(400, {'error': 'درخواست معتبر نیست.'})
        except Exception as error:
            print('ADMIN_REQUEST_FAILED', type(error).__name__, flush=True)
            self.reply(503, {'error': 'سرویس مدیریت موقتاً در دسترس نیست.'})

    do_GET = do_POST = do_PATCH = do_DELETE = dispatch


def main():
    os.umask(0o077)
    if len(SERVICE_TOKEN) < 32:
        raise SystemExit('Admin service token is not configured')
    store = AdminStore(DB_PATH, os.environ.get('AV_ADMIN_OWNER_EMAIL'), os.environ.get('AV_ADMIN_OWNER_HASH'))
    store.close()
    api = ControlAPI()
    def refresh():
        stopped = threading.Event()
        while not stopped.is_set():
            try:
                store = AdminStore(DB_PATH)
                try:
                    store.backup()
                finally:
                    store.close()
                api.view.refresh_review()
            except Exception as error:
                print('ADMIN_REVIEW_REFRESH_FAILED', type(error).__name__, flush=True)
            stopped.wait(300)
    threading.Thread(target=refresh, daemon=True).start()
    server = AdminHTTPServer(('127.0.0.1', int(os.environ.get('AV_ADMIN_PORT', '3041'))), Handler, api)
    print('ADMIN_CONTROL_READY', flush=True)
    server.serve_forever(poll_interval=0.5)


if __name__ == '__main__':
    main()
