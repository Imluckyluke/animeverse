#!/usr/bin/env python3
"""Audit/repair download availability without losing pending source inventory.

Default is read-only. --apply requires the normal writer to be stopped and
creates backups before reconnecting confirmed copies or prioritising gaps.
The same reconciliation runs inside the sole live writer every five minutes.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import fcntl
import json
from pathlib import Path
import shutil
import secrets
import sqlite3
import time

from backfill import _archive_record_better, _season_compatible_record
from archive_file_review import reviewed_queue_allowed, reviewed_record_allowed
from catalog import _http_url, build_catalog, write_catalog
from common import API_ID, API_HASH, DATA, DEST_CHANNEL, DEST_USERNAME, ROOT, STATE_PATH, atomic_write_json, load_state, now_iso, read_json, read_session, save_state

REPORT_PATH = DATA / "availability-repair-report.json"


def ready_slot(state, anime, episode, quality):
    deep = anime.get("episodes", {}).get(str(episode), {}).get(quality)
    item = state.get("queue", {}).get(deep, {})
    return item.get("status") == "done" and _http_url(item.get("url")) and reviewed_queue_allowed(anime, item)


def inventory(state):
    report = {}
    for key, anime in state.get("anime", {}).items():
        numbers, ready = set(), set()
        for number, labels in anime.get("episodes", {}).items():
            if not str(number).isdigit() or int(number) <= 0:
                continue
            numbers.add(int(number))
            if any(ready_slot(state, anime, number, quality) for quality in labels):
                ready.add(int(number))
        report[key] = {"slug": anime.get("slug", key), "indexed": len(numbers), "ready": len(ready),
                       "pendingEpisodes": sorted(numbers - ready)}
    return report


def reconcile(state, db, publish_record):
    before = inventory(state)
    stats = Counter()
    chosen = {}
    rows = db.execute("""SELECT f.*,COALESCE(b.conflict,0) AS binding_conflict FROM files f
      LEFT JOIN bindings b ON b.title=json_extract(f.record,'$.title')
      WHERE f.anime_key IS NOT NULL""").fetchall()
    for row in rows:
        key = row["anime_key"]
        anime = state.get("anime", {}).get(key)
        if not anime:
            continue
        record = json.loads(row["record"])
        from admin_commands import manual_record, manual_compatible
        manual = manual_record(record, key)
        if manual and not manual_compatible(anime, record, key):
            stats['ambiguousFiles'] += 1
            continue
        if not manual and anime.get('metadataSource') == 'anilist':
            from archive_identity import compatible_record
            if not compatible_record(anime, record):
                stats['ambiguousFiles'] += 1
                continue
        certified = bool(anime.get('archiveFileReview')) and reviewed_record_allowed(anime, record, row['document_id'])
        if (row["binding_conflict"] and not (manual or certified)) or (not manual and anime.get('metadataSource') != 'anilist' and not _season_compatible_record(anime, record.get("title", ""), record)):
            stats["ambiguousFiles"] += 1
            continue
        number = record.get("episode")
        if number is None and (anime.get("type") == "فیلم" or str(anime.get("format", "")).upper() == "MOVIE"):
            number = 1
        if isinstance(number, bool) or not isinstance(number, int) or number < 1 or not record.get("quality"):
            stats["unclassifiedFiles"] += 1
            continue
        slot = (key, number, record["quality"])
        old = chosen.get(slot)
        # Prefer a confirmed existing copy, then the clean/newer source file.
        if old is None or (row["state"] == "copied" and old["state"] != "copied") or (
            row["state"] == old["state"] and _archive_record_better(record, json.loads(old["record"]))):
            chosen[slot] = row

    def rank(slot):
        key, number, quality = slot
        return (number, not quality.startswith("1080p"), not quality.startswith("720p"), chosen[slot]["id"])
    first_per_title = {}
    first_per_episode = {}
    mapped_keys = {slot[0] for slot in chosen}
    for slot in sorted(chosen, key=rank):
        first_per_title.setdefault(slot[0], slot)
        first_per_episode.setdefault(slot[:2], slot)

    for (key, number, quality), row in chosen.items():
        anime = state["anime"][key]
        stats["archiveSlots"] += 1
        if row["state"] == "copied" and row["destination_id"]:
            if publish_record(state, row):
                stats["reconnectedLinks"] += 1
            continue
        if ready_slot(state, anime, number, quality):
            continue
        if row["state"] != "pending":
            stats["unavailableSourceFiles"] += 1
            continue
        record = json.loads(row["record"])
        deep = f"archive:{row['id']}"
        bucket = anime.setdefault("episodes", {}).setdefault(str(number), {})
        if bucket.get(quality) != deep:
            # Preserve the original MiniBot queue record for fallback/auditing.
            bucket[quality] = deep
            stats["attachedArchiveSlots"] += 1
        if deep not in state.setdefault("queue", {}):
            state["queue"][deep] = {"deepLink": deep, "animeKey": key, "animeId": anime.get("aniplusId", ""),
                "slug": anime["slug"], "title": anime.get("titleEn", ""), "episode": number, "quality": quality,
                "postId": anime.get("lastPostId", 0), "status": "pending", "attempts": 0,
                "source": "archive", "archiveRecordId": row["id"], "addedAt": now_iso()}
            stats["createdQueueEntries"] += 1
        slot = (key, number, quality)
        episode_ready = any(ready_slot(state, anime, number, q) for q in anime.get("episodes", {}).get(str(number), {}))
        priority = 300 if before[key]["ready"] == 0 and first_per_title[key] == slot else (
            200 if not episode_ready and first_per_episode[(key, number)] == slot else 100)
        db.execute("UPDATE files SET priority=CASE WHEN priority>=1000 THEN priority ELSE ? END WHERE id=?", (priority, row["id"]))
        stats["priorityFiles"] += 1

    after = inventory(state)
    catalog = build_catalog(state)
    gaps = []
    for key, value in after.items():
        if value["pendingEpisodes"]:
            gaps.append({**value, "key": key})
    report = {"updatedAt": now_iso(), **dict(stats), "titlesInState": len(after),
        "publicReadyTitles": len(catalog), "titlesWithoutFiles": sum(v["ready"] == 0 for v in after.values()),
        "emptyTitlesWithoutTrustedArchiveMatch": sum(v["ready"] == 0 and key not in mapped_keys for key,v in after.items()),
        "titlesWithPendingEpisodes": len(gaps), "pendingEpisodes": sum(len(v["pendingEpisodes"]) for v in after.values()),
        "details": gaps}
    return report


async def verify_destination(state, db, client=None, destination=None, on_wait=None):
    from telethon import TelegramClient, errors
    from telethon.sessions import StringSession
    owned = client is None
    if owned:
        client = TelegramClient(StringSession(read_session()), API_ID, API_HASH, flood_sleep_threshold=0)
    invalid = set()
    checked = 0
    prefix = f"https://t.me/{DEST_USERNAME}/"
    ids = sorted({int(q["url"][len(prefix):]) for q in state.get("queue", {}).values()
                  if q.get("status") == "done" and str(q.get("url", "")).startswith(prefix)
                  and q["url"][len(prefix):].isdigit()})
    if owned: await client.connect()
    try:
        destination = destination or await client.get_entity(DEST_CHANNEL)
        for offset in range(0, len(ids), 100):
            batch = ids[offset:offset + 100]
            while True:
                try:
                    messages = await client.get_messages(destination, ids=batch)
                    break
                except errors.FloodWaitError as exc:
                    if on_wait: on_wait(exc.seconds + 3)
                    print(f"Verification respects Telegram wait: {exc.seconds}s", flush=True)
                    await asyncio.sleep(exc.seconds + 3)
                    if on_wait: on_wait(0)
            available = {m.id for m in messages if m and getattr(m, "document", None)}
            invalid.update(set(batch) - available)
            checked += len(batch)
            await asyncio.sleep(.5)
        for queued in state.get("queue", {}).values():
            url = str(queued.get("url", ""))
            if url.startswith(prefix) and url[len(prefix):].isdigit() and int(url[len(prefix):]) in invalid:
                queued.update(status="pending", lastError="destination file unavailable; recopy queued")
                queued.pop("url", None)
        if invalid:
            placeholders = ",".join("?" for _ in invalid)
            db.execute(f"DELETE FROM destination WHERE message_id IN ({placeholders})", tuple(invalid))
            recopy = db.execute(f"SELECT id FROM files WHERE destination_id IN ({placeholders})", tuple(invalid)).fetchall()
            for row in recopy:
                db.execute("UPDATE files SET state='pending',destination_id=NULL,published=0,random_id=?,retry_at=0 WHERE id=?", (secrets.randbits(63) or 1, row["id"]))
        print(json.dumps({"destinationFilesChecked": checked, "invalidDestinationFiles": len(invalid)}), flush=True)
        db.execute("INSERT OR REPLACE INTO settings VALUES ('last_destination_verification',?)", (json.dumps(time.time()),))
        return {"destinationFilesChecked": checked, "invalidDestinationFiles": len(invalid)}
    finally:
        if owned: await client.disconnect()


async def verify_destination_page(state, db, client, destination):
    """One durable verification page per minute, never a blocking full scan."""
    from telethon import errors
    def get(key, default=None):
        row = db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default
    def put(key, value):
        db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, json.dumps(value)))
    now = time.time()
    if now < get('verification_next_at', 0):
        return None
    plan = get('verification_plan')
    prefix = f'https://t.me/{DEST_USERNAME}/'
    if not plan:
        if now - get('last_destination_verification', 0) < 21600:
            put('verification_next_at', now + 60)
            return None
        ids = sorted({int(q['url'][len(prefix):]) for q in state.get('queue', {}).values()
                      if q.get('status') == 'done' and str(q.get('url', '')).startswith(prefix)
                      and q['url'][len(prefix):].isdigit()}, reverse=True)
        plan = {'remaining': ids, 'checked': 0, 'invalid': 0, 'startedAt': now_iso()}
    batch = plan['remaining'][:100]
    put('verification_plan', plan)
    if batch:
        try:
            messages = await client.get_messages(destination, ids=batch)
        except errors.FloodWaitError as exc:
            put('verification_next_at', now + exc.seconds + 5)
            return {'waitingSec': exc.seconds + 5, 'remaining': len(plan['remaining'])}
        except Exception as exc:
            put('verification_next_at', now + 300)
            return {'error': type(exc).__name__, 'remaining': len(plan['remaining'])}
        available = {m.id for m in messages if m and getattr(m, 'document', None)}
        invalid = set(batch) - available
        for queued in state.get('queue', {}).values():
            url = str(queued.get('url', ''))
            if url.startswith(prefix) and url[len(prefix):].isdigit() and int(url[len(prefix):]) in invalid:
                queued.update(status='pending', lastError='destination document unavailable; queued for recopy')
                queued.pop('url', None)
        for message_id in invalid:
            db.execute('DELETE FROM destination WHERE message_id=?', (message_id,))
            for row in db.execute('SELECT id FROM files WHERE destination_id=?', (message_id,)).fetchall():
                db.execute("UPDATE files SET state='pending',destination_id=NULL,published=0,random_id=?,retry_at=0 WHERE id=?", (secrets.randbits(63) or 1, row['id']))
        plan['remaining'] = plan['remaining'][len(batch):]
        plan['checked'] += len(batch)
        plan['invalid'] += len(invalid)
    else:
        invalid = set()
    result = {'checked': plan['checked'], 'invalidTotal': plan['invalid'], 'invalidNow': len(invalid), 'remaining': len(plan['remaining'])}
    put('verification_plan', plan if plan['remaining'] else None)
    put('verification_next_at', now + 60)
    if not plan['remaining']:
        put('last_destination_verification', now)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify-destination", action="store_true")
    args = parser.parse_args()
    if args.verify_destination and not args.apply:
        parser.error("--verify-destination requires --apply")
    from archive_pipeline import DB_PATH, open_db, publish_record
    from sync import acquire_lock, release_lock
    if not args.apply:
        state = load_state()
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True) as source:
            source.backup(db)
        report = reconcile(state, db, publish_record)
        print(json.dumps({k:v for k,v in report.items() if k != "details"}, ensure_ascii=False))
        db.close()
        return
    with (DATA / "archive-pipeline.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not acquire_lock("availability-repair", 0):
            raise SystemExit("Stop the live catalog writer before applying this repair")
        try:
            db = open_db()
            backup = DATA / "backups" / ("availability-" + str(int(time.time())))
            backup.mkdir(parents=True)
            for path in [STATE_PATH, ROOT / "src/lib/real-catalog.json", DATA / "aniplus-links.json"]:
                if path.exists(): shutil.copy2(path, backup / path.name)
            with sqlite3.connect(backup / "pipeline.sqlite3") as target:
                db.backup(target)
            state = load_state()
            verification = asyncio.run(verify_destination(state, db)) if args.verify_destination else {}
            report = {**reconcile(state, db, publish_record), **verification}
            save_state(state)
            write_catalog(state)
            db.commit()
            atomic_write_json(REPORT_PATH, report)
            db.close()
            print(json.dumps({k:v for k,v in report.items() if k != "details"}, ensure_ascii=False), flush=True)
        finally:
            release_lock("availability-repair")


if __name__ == "__main__":
    main()
