"""Consume authenticated admin decisions INSIDE the sole archive writer.

HTTP only queues typed commands. Every source decision is revalidated against
its preview hash, copied destination, actual filename and target reference.
"""
from copy import deepcopy
from contextlib import closing
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import time
import tempfile
import uuid

from admin_service import prepare_review, target_fingerprint
from admin_store import AdminError, AdminStore
from common import DATA, ROOT, STATE_PATH, atomic_write_json, now_iso, save_state
from catalog import write_catalog


def manual_record(record, key):
    proof = record.get('manualReview')
    return (isinstance(proof, dict) and proof.get('targetKey') == key and proof.get('fileId') == record.get('id')
            and bool(re.fullmatch(r'[a-f0-9]{32}', str(proof.get('commandId') or ''))))


def has_control_work():
    path = DATA / 'admin.sqlite3'
    if not path.exists():
        return False
    with closing(sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True, timeout=2)) as database:
        return bool(database.execute("SELECT 1 FROM admin_commands WHERE state='pending' OR (state='running' AND kind<>'publish') LIMIT 1").fetchone())


def manual_compatible(anime, record, key):
    """Only the consumer below creates manualReview; HTTP never accepts it."""
    from archive_identity import safe_episode_record, safe_movie_record
    if not manual_record(record, key):
        return False
    if record['manualReview'].get('targetHash') != target_fingerprint(anime):
        return False
    movie = anime.get('type') == 'فیلم' or anime.get('format') == 'MOVIE'
    if not (safe_movie_record(record) if movie else safe_episode_record(record)):
        return False
    episode = record.get('episode') or (1 if movie else 0)
    total = anime.get('declaredEpisodes')
    if isinstance(total, int) and episode > total:
        return False
    years = {int(value) for value in re.findall(r'\b(?:19|20)\d{2}\b', record.get('name') or '')}
    return not years or years == {anime.get('year')}


def backup(db, command_ids):
    destination = DATA / 'backups' / ('admin-' + str(time.time_ns()) + '-' + uuid.uuid4().hex[:8])
    destination.mkdir(parents=True, mode=0o700)
    scratch = Path('/tmp/opencode')
    scratch.mkdir(exist_ok=True)
    manifest = {'createdBy': 'animeverse-admin-v1', 'createdAt': now_iso(), 'commands': command_ids, 'compression': {}}
    with tempfile.TemporaryDirectory(prefix='admin-backup-', dir=scratch) as temporary:
        snapshot = Path(temporary) / 'pipeline.sqlite3'
        with closing(sqlite3.connect(snapshot)) as target:
            db.backup(target)
        for source, name in [(STATE_PATH, 'state.json'), (snapshot, 'pipeline.sqlite3')]:
            if not source.exists():
                continue
            with source.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            final = destination / (name + '.gz')
            with source.open('rb') as stream, gzip.open(final, 'wb', compresslevel=6) as output:
                shutil.copyfileobj(stream, output)
            with gzip.open(final, 'rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise RuntimeError('Admin backup checksum failed')
            manifest['compression'][name] = {'file': final.name, 'sha256': digest}
    atomic_write_json(destination / 'manifest.json', manifest)
    owned = []
    for path in (DATA / 'backups').glob('admin-*'):
        manifest = path / 'manifest.json'
        if not path.is_symlink() and manifest.is_file():
            try:
                if json.loads(manifest.read_text()).get('createdBy') == 'animeverse-admin-v1':
                    owned.append(path)
            except (ValueError, OSError):
                continue
    for path in sorted(owned, key=lambda item: item.name)[:-10]:
        children = list(path.iterdir())
        if all(item.name in {'state.json', 'pipeline.sqlite3', 'state.json.gz', 'pipeline.sqlite3.gz', 'manifest.json'} and item.is_file() and not item.is_symlink() for item in children):
            for item in children:
                item.unlink()
            path.rmdir()


def _match(state, db, command):
    from archive_pipeline import publish_record
    payload = command['payload']
    row = db.execute('SELECT * FROM files WHERE id=?', (payload['fileId'],)).fetchone()
    anime = state['anime'].get(payload['targetKey'])
    if not row or not anime or hashlib.sha256(row['record'].encode()).hexdigest() != payload['sourceHash'] or target_fingerprint(anime) != payload['targetHash']:
        raise AdminError('فایل یا مرجع پس از پیش‌نمایش تغییر کرده؛ بررسی تازه لازم است.', 409)
    normalized, errors, _ = prepare_review(row, payload['targetKey'], anime, payload)
    if errors:
        raise AdminError('؛ '.join(errors), 422)
    number, quality = str(payload['episode']), payload['quality']
    deep = 'archive:' + str(payload['fileId'])
    queue = state.setdefault('queue', {})
    if deep in queue and queue[deep].get('animeKey') not in (None, payload['targetKey']):
        raise AdminError('فایل در سابقهٔ عنوان دیگری استفاده شده است.', 409)
    current_slot = anime.get('episodes', {}).get(number, {}).get(quality)
    own_recovery = current_slot == deep and queue.get(deep, {}).get('adminCommandId') == command['id']
    if current_slot != payload.get('previousSlot') and not own_recovery:
        raise AdminError('لینک مقصد پس از پیش‌نمایش تغییر کرده است.', 409)
    journal = DATA / 'admin-command-recovery' / (command['id'] + '.json')
    before = {'fileId': row['id'], 'record': row['record'], 'animeKey': row['anime_key'], 'published': row['published'],
              'targetKey': payload['targetKey'], 'episode': payload['episode'], 'quality': quality,
              'slot': current_slot, 'queue': deepcopy(queue.get(deep))}
    if journal.exists():
        before = json.loads(journal.read_text())
    else:
        atomic_write_json(journal, before)
    original_anime, original_queue = deepcopy(anime), deepcopy(queue.get(deep))
    record = normalized['record']
    record['manualReview'] = {'commandId': command['id'], 'actor': command['actor'], 'fileId': row['id'],
                             'targetKey': payload['targetKey'], 'targetHash': payload['targetHash'], 'sourceHash': payload['sourceHash'], 'at': now_iso()}
    try:
        with db:
            if payload.get('replaceExisting'):
                anime.setdefault('episodes', {}).setdefault(number, {}).pop(quality, None)
            db.execute('UPDATE files SET record=?,anime_key=?,published=0 WHERE id=? AND anime_key IS NULL',
                       (json.dumps(record, ensure_ascii=False), payload['targetKey'], row['id']))
            updated = dict(row)
            updated['record'], updated['anime_key'] = json.dumps(record, ensure_ascii=False), payload['targetKey']
            if not manual_compatible(anime, record, payload['targetKey']):
                raise AdminError('فایل نهایی از محافظ انتشار عبور نکرد.', 422)
            publish_record(state, updated)
            if queue.get(deep, {}).get('archiveRecordId') == row['id']:
                queue[deep]['adminCommandId'] = command['id']
            after = {'fileId': row['id'], 'targetKey': payload['targetKey'], 'episode': payload['episode'], 'quality': quality,
                     'recordHash': hashlib.sha256(json.dumps(record, ensure_ascii=False).encode()).hexdigest(),
                     'slot': anime.get('episodes', {}).get(number, {}).get(quality)}
            effect = {'before': before, 'after': after}
            save_state(state)
            db.execute('INSERT INTO admin_applied VALUES(?,?,?)', (command['id'], json.dumps(effect, ensure_ascii=False), now_iso()))
        return effect
    except BaseException:
        state['anime'][payload['targetKey']] = original_anime
        if original_queue is None:
            queue.pop(deep, None)
        else:
            queue[deep] = original_queue
        raise


def _undo(state, db, store, command):
    event = store.event(command['payload']['eventId'])
    if event['action'] != 'review.match' or event['undone_by']:
        raise AdminError('این بررسی قابل بازگردانی نیست.', 409)
    if store.user(command['actor'])['role'] == 'reviewer' and event['actor'] != command['actor']:
        raise AdminError('بازگردانی تصمیم دیگران مجاز نیست.', 403)
    before, after = event['before'], event['after']
    row = db.execute('SELECT * FROM files WHERE id=?', (after['fileId'],)).fetchone()
    anime = state['anime'].get(after['targetKey'])
    if not row or not anime or row['anime_key'] != after['targetKey'] or hashlib.sha256(row['record'].encode()).hexdigest() != after['recordHash']:
        raise AdminError('فایل پس از این رویداد تغییر کرده؛ بازگردانی امن نیست.', 409)
    number, quality = str(after['episode']), after['quality']
    if anime.get('episodes', {}).get(number, {}).get(quality) != after['slot']:
        raise AdminError('لینک قسمت بعداً تغییر کرده؛ بازگردانی امن نیست.', 409)
    deep = 'archive:' + str(row['id'])
    original_anime = deepcopy(anime)
    original_queue = deepcopy(state['queue'].get(deep))
    try:
        with db:
            bucket = anime.setdefault('episodes', {}).setdefault(number, {})
            if before['slot']:
                bucket[quality] = before['slot']
            else:
                bucket.pop(quality, None)
                if not bucket:
                    anime['episodes'].pop(number, None)
            if before.get('queue') is None:
                state['queue'].pop(deep, None)
            else:
                state['queue'][deep] = before['queue']
            db.execute('UPDATE files SET record=?,anime_key=?,published=? WHERE id=?', (before['record'], before['animeKey'], before['published'], row['id']))
            effect = {'before': {'eventId': event['id']}, 'after': {'fileId': row['id'], 'revertedEvent': event['id']}}
            save_state(state)
            db.execute('INSERT INTO admin_applied VALUES(?,?,?)', (command['id'], json.dumps(effect), now_iso()))
        return effect
    except BaseException:
        state['anime'][after['targetKey']] = original_anime
        if original_queue is None:
            state['queue'].pop(deep, None)
        else:
            state['queue'][deep] = original_queue
        raise


def consume_commands(state, db):
    path = DATA / 'admin.sqlite3'
    if not path.exists():
        return False
    store = AdminStore(path)
    changed = False
    try:
        db.execute('CREATE TABLE IF NOT EXISTS admin_applied(id TEXT PRIMARY KEY,effect TEXT NOT NULL,at TEXT NOT NULL)')
        db.commit()
        # Recovery is idempotent: a canonical DB marker proves application.
        for row in list(store.db.execute("SELECT * FROM admin_commands WHERE state='running' AND kind<>'publish'")):
            if not db.execute('SELECT 1 FROM admin_applied WHERE id=?', (row['id'],)).fetchone():
                if row['kind'] == 'catalog.refresh':
                    store.db.execute("UPDATE admin_commands SET state='pending' WHERE id=?", (row['id'],))
                elif row['kind'] == 'review.match':
                    payload = json.loads(row['payload'])
                    source = db.execute('SELECT record,anime_key FROM files WHERE id=?', (payload['fileId'],)).fetchone()
                    if source and source['anime_key'] is None and hashlib.sha256(source['record'].encode()).hexdigest() == payload['sourceHash']:
                        store.db.execute("UPDATE admin_commands SET state='pending' WHERE id=?", (row['id'],))
                    else:
                        store.finish_command(row['id'], 'failed', 'بررسی نیمه‌تمام نیازمند پیش‌نمایش تازه است.')
                else:
                    store.finish_command(row['id'], 'failed', 'وضعیت عملیات نیمه‌تمام را دوباره بررسی کن.')
        commands = store.claim_commands(5)
        if any(command['kind'].startswith('review.') for command in commands):
            backup(db, [command['id'] for command in commands])
        # Include already-committed commands whose audit/ack was interrupted.
        committed = []
        for row in store.db.execute("SELECT * FROM admin_commands WHERE state='running' AND kind IN ('review.match','review.undo')"):
            if db.execute('SELECT 1 FROM admin_applied WHERE id=?', (row['id'],)).fetchone() and not any(item['id'] == row['id'] for item in commands):
                committed.append({**dict(row), 'payload': json.loads(row['payload'])})
        for command in [*commands, *committed]:
            try:
                permission = 'review' if command['kind'].startswith('review.') else 'publish' if command['kind'] == 'publish' else 'catalog.patch'
                store.require(command['actor'], permission)
                if command['kind'] == 'publish':
                    write_catalog(state)
                    pending = [row[0] for row in store.db.execute("SELECT id FROM admin_commands WHERE kind='publish' AND state='running'")]
                    atomic_write_json(DATA / 'admin-publish-request.json', {'nonce': uuid.uuid4().hex, 'requestedAt': now_iso(), 'commands': pending})
                    changed = True
                    continue  # Only verified production publication may acknowledge it.
                if command['kind'] == 'catalog.refresh':
                    write_catalog(state)
                    store.finish_command(command['id'], 'applied')
                    changed = True
                    continue
                done = db.execute('SELECT effect FROM admin_applied WHERE id=?', (command['id'],)).fetchone()
                effect = json.loads(done[0]) if done else (_match(state, db, command) if command['kind'] == 'review.match' else _undo(state, db, store, command))
                write_catalog(state)
                with store.transaction():
                    known = store.db.execute('SELECT audit_id FROM admin_effects WHERE command_id=?', (command['id'],)).fetchone()
                    if not known:
                        event_id = store.audit(command['actor'], command['kind'], str(effect['after'].get('fileId', '')), effect['before'], effect['after'],
                                               command['payload'].get('note') or 'بازگردانی تصمیم بررسی', reversible=command['kind'] == 'review.match')
                        store.db.execute('INSERT INTO admin_effects VALUES(?,?)', (command['id'], event_id))
                        if command['kind'] == 'review.undo':
                            store.db.execute('UPDATE audit_events SET undone_by=? WHERE id=?', (event_id, command['payload']['eventId']))
                    store.finish_command(command['id'], 'applied')
                journal = DATA / 'admin-command-recovery' / (command['id'] + '.json')
                if journal.is_file():
                    journal.unlink()
                changed = True
            except AdminError as error:
                store.finish_command(command['id'], 'failed', str(error))
            except Exception as error:
                # A committed canonical marker will be reconciled next tick;
                # do not falsely label a successful write as a failed command.
                print('ADMIN_COMMAND_RETRY', command['id'], type(error).__name__, flush=True)
        return changed
    finally:
        store.close()
