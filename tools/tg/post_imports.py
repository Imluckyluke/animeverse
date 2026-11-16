"""Owner-approved AniPlus post previews; Telegram work stays in the sole writer."""
from copy import deepcopy
import hashlib
import json
import re
import time
import uuid

from admin_store import AdminError, AdminStore, encoded
from common import DATA, now_iso, save_state


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def selector(body):
    if set(body) == {'url'} and isinstance(body['url'], str):
        match = re.fullmatch(r'https://t\.me/(?:s/)?aniplus/([1-9][0-9]{0,9})/?', body['url'].strip(), re.I)
        if match:
            return {'postId': int(match[1])}
    if set(body) == {'posts'} and type(body['posts']) is int and 1 <= body['posts'] <= 50:
        return {'posts': body['posts']}
    raise AdminError('لینک باید پست کانال aniplus باشد؛ تعداد پست نیز بین ۱ تا ۵۰ است.', 422)


def public_preview(row):
    return {'id': row['id'], 'state': row['state'], 'expiresAt': row['expires_at'],
            'error': row['error'], **json.loads(row['result'])}


def request_preview(store, actor, body):
    store.require(actor, 'owner')
    source = selector(body)
    with store.transaction():
        pending = store.db.execute("SELECT count(*) FROM post_imports WHERE state IN ('preview_pending','import_pending','importing')").fetchone()[0]
        if pending >= 5:
            raise AdminError('چند درخواست در صف است؛ تا پایان بررسی صبر کن.', 429)
        ident = uuid.uuid4().hex
        store.db.execute('INSERT INTO post_imports VALUES(?,?,?,?,?,?,?,?,?)',
                         (ident, actor, 'preview_pending', encoded(source), '{}', '{}', time.time() + 900, now_iso(), ''))
    return public_preview(store.db.execute('SELECT * FROM post_imports WHERE id=?', (ident,)).fetchone())


def get_preview(store, actor, ident):
    store.require(actor, 'owner')
    row = store.db.execute('SELECT * FROM post_imports WHERE id=? AND actor=?', (ident, actor)).fetchone()
    if not row:
        raise AdminError('پیش‌نمایش پیدا نشد.', 404)
    return public_preview(row)


def confirm_preview(store, actor, ident, body):
    store.require(actor, 'owner')
    if set(body) != {'confirm'} or body.get('confirm') is not True:
        raise AdminError('تأیید صریح پیش‌نمایش لازم است.', 422)
    with store.transaction():
        row = store.db.execute('SELECT * FROM post_imports WHERE id=? AND actor=?', (ident, actor)).fetchone()
        if row and row['state'] in {'import_pending', 'importing', 'imported'}:
            return public_preview(row)
        if not row or row['state'] != 'preview_ready' or row['expires_at'] < time.time():
            raise AdminError('پیش‌نمایش آماده نیست یا منقضی شده؛ دوباره بررسی کن.', 409)
        store.db.execute("UPDATE post_imports SET state='import_pending' WHERE id=?", (ident,))
        store.audit(actor, 'posts.approve', ident, {}, {'source': json.loads(row['selector'])}, 'تأیید دریافت فایل‌های پیش‌نمایش‌شدهٔ انی‌پلاس')
    return get_preview(store, actor, ident)


def draft_title(state, parsed, overrides):
    from admin_service import target_fingerprint
    from backfill import group_key
    from ingest import merge_post
    from season_identity import conflicts, page_markers
    key = group_key(parsed)
    existing = state.get('anime', {}).get(key)
    if existing:
        if existing.get('archiveFileReview') is not None or overrides.get(existing.get('slug'), {}).get('patch', {}).get('hidden'):
            raise AdminError('این عنوان محدودیت بررسی فایل یا مخفی‌سازی دارد؛ دریافت مستقیم آن مجاز نیست.', 409)
        if conflicts(page_markers(existing), page_markers(parsed)):
            raise AdminError('فصل یا بخش پست با عنوان موجود متفاوت است؛ بررسی دستی لازم است.', 409)
        special = {'MOVIE', 'OVA', 'SPECIAL'}
        if (existing.get('format') in special or parsed.get('format') in special) and existing.get('format') != parsed.get('format'):
            raise AdminError('نوع فیلم و سریال با عنوان موجود ناسازگار است.', 409)
    # Only affected records are copied; other slugs are retained for collision checks.
    draft = {'anime': {name: {'slug': item.get('slug')} for name, item in state.get('anime', {}).items()}, 'queue': {}}
    if existing:
        draft['anime'][key] = deepcopy(existing)
        for qualities in existing.get('episodes', {}).values():
            for deep in qualities.values():
                if deep in state.get('queue', {}):
                    draft['queue'][deep] = deepcopy(state['queue'][deep])
    for qualities in parsed.get('episodes', {}).values():
        for deep in qualities.values():
            if not re.fullmatch(r'https://t\.me/AniPlusMiniBot\?start=get_[0-9A-Za-z_]+', deep):
                raise AdminError('پست دارای لینک فایل ناشناخته است.', 422)
            previous = state.get('queue', {}).get(deep)
            if previous and previous.get('animeKey') not in (None, key):
                raise AdminError('یک لینک فایل قبلاً متعلق به عنوان دیگری ثبت شده است.', 409)
            if previous:
                draft['queue'][deep] = deepcopy(previous)
    merge_post(draft, deepcopy(parsed))
    anime = draft['anime'][key]
    episodes = [{'number': int(number), 'qualities': sorted(qualities)}
                for number, qualities in sorted(parsed['episodes'].items(), key=lambda entry: int(entry[0]))]
    return key, {'postId': parsed['postId'], 'postUrl': parsed['postUrl'], 'slug': anime['slug'],
                 'title': anime.get('titleFa') or anime.get('titleEn'), 'titleEn': anime.get('titleEn'),
                 'titleOriginal': anime.get('titleOriginal'), 'year': anime.get('year'), 'format': anime.get('format'),
                 'synopsis': anime.get('synopsis') or '', 'cover': anime.get('cover') or anime.get('coverUrl') or '',
                 'genres': anime.get('genres') or [], 'episodes': episodes, 'existing': bool(existing),
                 'fileCount': sum(len(item['qualities']) for item in episodes)}, target_fingerprint(existing) if existing else None


async def source_posts(pipeline, selection, ids=None):
    from parse import parse_post
    peer = pipeline.aniplus
    if ids is not None:
        messages = await pipeline.tg(lambda: pipeline.client.get_messages(peer, ids=ids))
    elif selection.get('postId'):
        messages = await pipeline.tg(lambda: pipeline.client.get_messages(peer, ids=[selection['postId']]))
    else:
        messages = await pipeline.tg(lambda: pipeline.client.get_messages(peer, limit=selection['posts']))
    parsed = []
    for message in messages:
        if not message or not getattr(message, 'id', None):
            continue
        item = parse_post(message.id, getattr(message, 'text', '') or '', getattr(message, 'date', None), getattr(message, 'buttons', None))
        if item:
            parsed.append(item)
    if not parsed or (ids is not None and {item['postId'] for item in parsed} != set(ids)):
        raise AdminError('پست حذف شده یا لینک و اطلاعات انیمهٔ قابل بررسی ندارد.', 422)
    return sorted(parsed, key=lambda item: item['postId'])


async def consume_imports(pipeline):
    """One bounded job per tick. Preview never merges or requests bot files."""
    from admin_service import target_fingerprint
    path = DATA / 'admin.sqlite3'
    if not path.exists():
        return False
    store = AdminStore(path)
    try:
        row = store.db.execute("SELECT * FROM post_imports WHERE state IN ('preview_pending','import_pending','importing') ORDER BY created_at LIMIT 1").fetchone()
        if not row:
            return False
        try:
            store.require(row['actor'], 'owner')
            pipeline.db.execute('CREATE TABLE IF NOT EXISTS post_import_applied(id TEXT PRIMARY KEY,result TEXT NOT NULL)')
            pipeline.db.commit()
            done = pipeline.db.execute('SELECT result FROM post_import_applied WHERE id=?', (row['id'],)).fetchone()
            if done:
                store.db.execute("UPDATE post_imports SET state='imported',result=?,error='' WHERE id=?", (done[0], row['id']))
                return False
            if row['expires_at'] < time.time():
                raise AdminError('پیش‌نمایش منقضی شده؛ دوباره پست را بررسی کن.', 409)
            selection = json.loads(row['selector'])
            if row['state'] == 'preview_pending':
                parsed = await source_posts(pipeline, selection)
                items, sources = [], []
                overrides = store.all_overrides()
                for item in parsed:
                    key, card, target = draft_title(pipeline.state, item, overrides)
                    items.append(card)
                    sources.append({'parsed': item, 'hash': digest(item), 'key': key, 'targetHash': target})
                result = {'items': items, 'valid': True,
                          'warnings': ['تا تأیید شما، این درخواست فایل نمی‌گیرد و صفحه‌ای منتشر نمی‌کند.',
                                       'فقط فایل‌های دقیقاً تأییدشده وارد صفحه می‌شوند؛ آماده‌بودن یا سال نامشخص حدس زده نمی‌شود.']}
                store.db.execute("UPDATE post_imports SET state='preview_ready',payload=?,result=? WHERE id=?",
                                 (encoded({'sources': sources}, 1_500_000), encoded(result, 1_500_000), row['id']))
                return False
            store.db.execute("UPDATE post_imports SET state='importing' WHERE id=?", (row['id'],))
            sources = json.loads(row['payload'])['sources']
            parsed = await source_posts(pipeline, selection, [item['parsed']['postId'] for item in sources])
            current = {item['postId']: item for item in parsed}
            for item in sources:
                if digest(current[item['parsed']['postId']]) != item['hash']:
                    raise AdminError('پست از زمان پیش‌نمایش تغییر کرده؛ پیش‌نمایش تازه لازم است.', 409)
                anime = pipeline.state.get('anime', {}).get(item['key'])
                if (target_fingerprint(anime) if anime else None) != item['targetHash']:
                    raise AdminError('هویت عنوان از زمان پیش‌نمایش تغییر کرده است.', 409)
                draft_title(pipeline.state, item['parsed'], store.all_overrides())
            from admin_commands import backup
            from ingest import merge_post
            backup(pipeline.db, [row['id']])
            pipeline.db.execute('CREATE TABLE IF NOT EXISTS bot_import_sources(deep_link TEXT PRIMARY KEY,import_id TEXT NOT NULL,priority_at REAL NOT NULL)')
            for source in sources:
                key, _, _, _ = merge_post(pipeline.state, source['parsed'])
                pipeline.cover_keys.add(key)
                for qualities in source['parsed']['episodes'].values():
                    for deep in qualities.values():
                        pipeline.db.execute('INSERT OR IGNORE INTO bot_import_sources VALUES(?,?,?)', (deep, row['id'], time.time()))
            save_state(pipeline.state)
            result = json.loads(row['result'])
            result['message'] = 'پست‌های تأییدشده ثبت و فایل‌های موجود حفظ شدند؛ فایل‌های مفقود در صف دریافت‌اند. انتشار عمومی فقط پس از آماده‌شدن فایل معتبر است.'
            pipeline.db.execute('INSERT INTO post_import_applied VALUES(?,?)', (row['id'], encoded(result, 1_500_000)))
            pipeline.db.commit()
            with store.transaction():
                store.db.execute("UPDATE post_imports SET state='imported',result=?,error='' WHERE id=?", (encoded(result, 1_500_000), row['id']))
                store.audit(row['actor'], 'posts.import', row['id'], {}, {'postIds': [item['postId'] for item in parsed]}, 'ثبت پست‌های تأییدشده در صف دریافت')
            if pipeline.bot_lane:
                pipeline.bot_lane.last_sync = 0
            return True
        except AdminError as error:
            store.db.execute("UPDATE post_imports SET state='failed',error=? WHERE id=?", (str(error), row['id']))
        except Exception as error:
            # Keep the exact durable request on transient Telegram/API failure.
            print('POST_IMPORT_RETRY', row['id'], type(error).__name__, flush=True)
        return False
    finally:
        store.close()
