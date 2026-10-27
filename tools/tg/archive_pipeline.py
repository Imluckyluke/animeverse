#!/usr/bin/env python3
"""Durable, archive-first copier and two-channel watcher. No MiniBot calls.

Every document is copied; only identity-checked episode/quality mappings enter
the public catalog. Unmatched/ambiguous documents remain in a durable queue.
Telegram random IDs are persisted *before* sending for crash-safe retries.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import time

from telethon import TelegramClient, errors, utils
from telethon.sessions import StringSession
from telethon.tl.functions.messages import CheckChatInviteRequest, SendMediaRequest
from telethon.tl.types import InputMediaDocument, InputMessagesFilterDocument

from backfill import (
    ARCHIVE_INDEX_PATH, ARCHIVE_MAP_PATH, POSTS_PATH, archive_by_title,
    archive_metadata, group_key, match_archive, parse_archive_record,
    select_archive_title_records, _season_compatible_record,
)
from catalog import write_catalog
from common import (
    API_HASH, API_ID, ARCHIVE_COPY_DELAY, ARCHIVE_INVITE, DATA, DEST_CHANNEL,
    DEST_USERNAME, SOURCE_CHANNEL, STATE_PATH, atomic_write_json, load_state,
    now_iso, read_json, read_session, save_state,
)
from ingest import merge_post, prepare_covers, queue_episode_event
from parse import parse_post
from sync import acquire_lock, release_lock

DB_PATH = DATA / "archive-pipeline.sqlite3"
STATUS_PATH = DATA / "archive-pipeline-status.json"
POLL_SECONDS = 60


def random_id(source: int, destination: int, message: int) -> int:
    value = hashlib.sha256(f"sky-copy-v1:{source}:{destination}:{message}".encode()).digest()
    return int.from_bytes(value[:8], "big") & ((1 << 63) - 1) or 1


def open_db(path: Path = DB_PATH) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY, record TEXT NOT NULL, document_id TEXT,
        state TEXT NOT NULL DEFAULT 'pending', destination_id INTEGER,
        random_id INTEGER, priority INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at REAL NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '', published INTEGER NOT NULL DEFAULT 0,
        copied_at TEXT, anime_key TEXT
      );
      CREATE INDEX IF NOT EXISTS pending_files ON files(state, priority DESC, retry_at, id);
      CREATE INDEX IF NOT EXISTS file_documents ON files(document_id);
      CREATE TABLE IF NOT EXISTS destination (
        document_id TEXT PRIMARY KEY, message_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY, payload TEXT NOT NULL, matched INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS bindings (
        title TEXT PRIMARY KEY, anime_key TEXT, conflict INTEGER NOT NULL DEFAULT 0
      );
    """)
    db.commit()
    return db


def setting(db, key, default=None):
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_setting(db, key, value):
    db.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, json.dumps(value)))


def store_record(db, record: dict, priority=0, document_id=None):
    db.execute("""INSERT INTO files(id,record,priority,document_id) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET record=excluded.record,
        priority=MAX(files.priority,excluded.priority),
        document_id=COALESCE(excluded.document_id,files.document_id)""",
      (int(record["id"]), json.dumps(record, ensure_ascii=False), priority, str(document_id) if document_id else None))
    if record.get("title"):
        binding = db.execute("SELECT anime_key FROM bindings WHERE title=? AND conflict=0", (record["title"],)).fetchone()
        if binding:
            db.execute("UPDATE files SET anime_key=?,published=0 WHERE id=? AND anime_key IS NOT ?", (binding[0], record["id"], binding[0]))


def bind_title(db, title, key):
    old = db.execute("SELECT * FROM bindings WHERE title=?", (title,)).fetchone()
    if old and (old["conflict"] or old["anime_key"] != key):
        db.execute("UPDATE bindings SET conflict=1,anime_key=NULL WHERE title=?", (title,))
        # Never silently remap a title that matched two distinct seasons.
        return False
    db.execute("INSERT OR IGNORE INTO bindings VALUES (?,?,0)", (title, key))
    return True


def publish_record(state, row) -> bool:
    record = json.loads(row["record"])
    anime = state.get("anime", {}).get(row["anime_key"])
    if not anime or not row["destination_id"] or not record.get("quality"):
        return False
    if anime.get('metadataSource') == 'anilist':
        from archive_identity import compatible_record
        if not compatible_record(anime, record):
            return False
    if not _season_compatible_record(anime, record.get("title", ""), record):
        return False
    episode = record.get("episode")
    if episode is None:
        if anime.get("type") != "فیلم" and str(anime.get("format", "")).upper() != "MOVIE":
            return False
        episode = 1
    try:
        episode = int(episode)
    except (TypeError, ValueError):
        return False
    if episode < 1:
        return False
    quality = record["quality"]
    bucket = anime.setdefault("episodes", {}).setdefault(str(episode), {})
    previous = state.setdefault("queue", {}).get(bucket.get(quality), {})
    if previous.get("status") == "done" and previous.get("url"):
        return False
    deep = f"archive:{record['id']}"
    bucket[quality] = deep
    state["queue"][deep] = {
        "deepLink": deep, "animeKey": row["anime_key"], "animeId": anime.get("aniplusId", ""),
        "slug": anime["slug"], "title": anime.get("titleEn", ""), "episode": episode,
        "quality": quality, "postId": anime.get("lastPostId", 0), "status": "done",
        "attempts": row["attempts"], "source": "archive", "archiveRecordId": record["id"],
        "url": f"https://t.me/{DEST_USERNAME}/{row['destination_id']}",
        "messageId": row["destination_id"], "size": record.get("size"),
        "resolvedAt": row["copied_at"] or now_iso(), "lastError": "",
    }
    return True


class Pipeline:
    def __init__(self, args):
        self.args = args
        self.db = open_db()
        self.state = load_state()
        self.running = True
        self.dirty = False
        self.started = time.monotonic()
        self.copied = 0
        self.last_poll = 0.0
        self.last_flush = 0.0
        self.last_covers = 0.0
        self.last_reconcile = 0.0
        self.cover_keys = set()
        self.status = {"state": "starting", "startedAt": now_iso(), "lastError": ""}
        self.grouped = {}
        self.metadata = {}
        self.client = TelegramClient(StringSession(read_session()), API_ID, API_HASH,
            flood_sleep_threshold=0, request_retries=3, connection_retries=5, timeout=30)

    def log(self, message, level="info"):
        print(f"{now_iso()} [{level}] {message}", flush=True)
        self.status["lastActivity"] = message

    def phase(self, value):
        self.status["phase"] = value

    def update(self, **values):
        self.status.update(values)

    @property
    def data(self):
        return self.status

    async def tg(self, factory):
        for attempt in range(4):
            if not self.running:
                raise asyncio.CancelledError()
            try:
                async with asyncio.timeout(120):
                    return await factory()
            except errors.FloodWaitError as exc:
                seconds = int(exc.seconds) + 5
                self.status["floodWaitUntil"] = time.time() + seconds
                self.log(f"Telegram flood wait: {seconds}s; no early retries", "warn")
                await asyncio.sleep(seconds)
                self.status.pop("floodWaitUntil", None)
            except (OSError, ConnectionError, asyncio.TimeoutError, errors.ServerError) as exc:
                self.log(f"Network retry: {type(exc).__name__}", "warn")
                await asyncio.sleep(5 * (attempt + 1))
        raise RuntimeError("Telegram request exhausted retries")

    def bootstrap(self):
        if not setting(self.db, "seeded"):
            for record in read_json(ARCHIVE_INDEX_PATH, []) or []:
                store_record(self.db, record)
            for parsed in read_json(POSTS_PATH, []) or []:
                self.db.execute("INSERT OR IGNORE INTO posts VALUES (?,?,0)", (parsed["postId"], json.dumps(parsed, ensure_ascii=False)))
            mapping = read_json(ARCHIVE_MAP_PATH, {}) or {}
            for key, records in mapping.items():
                if key not in self.state.get("anime", {}):
                    continue
                for record in records:
                    if record.get("title"):
                        bind_title(self.db, record["title"], key)
                    self.db.execute("UPDATE files SET anime_key=? WHERE id=?", (key, record["id"]))
            set_setting(self.db, "seeded", True)
            self.db.commit()
        self.refresh_matching_index()

    def refresh_matching_index(self):
        records = [json.loads(row[0]) for row in self.db.execute("SELECT record FROM files")]
        records = [r for r in records if r.get("title") and r.get("quality")]
        self.grouped = archive_by_title(records)
        self.metadata = archive_metadata(self.grouped)

    async def connect(self):
        await self.client.connect()
        if not await self.client.is_user_authorized():
            raise RuntimeError("Telegram session not authorised")
        invite = await self.tg(lambda: self.client(CheckChatInviteRequest(ARCHIVE_INVITE)))
        self.sky = getattr(invite, "chat", None)
        if self.sky is None:
            raise RuntimeError("Archive membership unavailable")
        self.dest = await self.tg(lambda: self.client.get_entity(DEST_CHANNEL))
        self.aniplus = await self.tg(lambda: self.client.get_entity(SOURCE_CHANNEL))
        # Reconcile anything copied just before a crash (or posted by another
        # administrator) before issuing another send with the same document.
        set_setting(self.db, "destination_indexed", False)
        self.db.commit()
        if setting(self.db, "sky_start") is None:
            latest = await self.tg(lambda: self.client.get_messages(self.sky, limit=1))
            cutoff = latest[0].id if latest else 0
            set_setting(self.db, "sky_start", cutoff)
            set_setting(self.db, "sky_live", cutoff)
            set_setting(self.db, "ani_live", int(self.state.get("lastScanId", 0)))
            self.db.commit()

    async def seed_destination(self):
        if setting(self.db, "destination_indexed", False):
            return
        self.phase("destination-index")
        cursor = setting(self.db, "dest_cursor", 0)
        messages = await self.tg(lambda: self.client.get_messages(self.dest, limit=100, min_id=cursor,
            reverse=True, filter=InputMessagesFilterDocument))
        if not messages:
            set_setting(self.db, "destination_indexed", True)
        for message in sorted(messages, key=lambda m: m.id):
            if message.document:
                self.db.execute("INSERT OR IGNORE INTO destination VALUES (?,?)", (str(message.document.id), message.id))
            cursor = max(cursor, message.id)
        set_setting(self.db, "dest_cursor", cursor)
        self.db.commit()

    async def scan_sky(self, live=False):
        key = "sky_live" if live else "sky_history"
        if not live and setting(self.db, "sky_history_done", False):
            return
        cursor = setting(self.db, key, 0)
        kwargs = {"min_id": cursor, "reverse": True, "limit": 100, "filter": InputMessagesFilterDocument}
        if not live:
            kwargs["max_id"] = setting(self.db, "sky_start", 0) + 1
        messages = await self.tg(lambda: self.client.get_messages(self.sky, **kwargs))
        if not messages and not live:
            set_setting(self.db, "sky_history_done", True)
        changed = False
        for message in sorted(messages, key=lambda m: m.id):
            if message.document:
                record = parse_archive_record(message) or {
                    "id": message.id, "name": getattr(message.file, "name", "") or "document",
                    "size": getattr(message.file, "size", None), "date": message.date.isoformat(),
                }
                store_record(self.db, record, 1000 if live else 0, message.document.id)
                if record.get("title") and record["title"] not in self.grouped:
                    changed = True
            cursor = max(cursor, message.id)
        set_setting(self.db, key, cursor)
        if changed:
            self.refresh_matching_index()
            self.db.execute("UPDATE posts SET matched=0")
        self.db.commit()

    async def scan_aniplus(self):
        cursor = setting(self.db, "ani_live", 0)
        messages = await self.tg(lambda: self.client.get_messages(self.aniplus, min_id=cursor, reverse=True, limit=100))
        for message in sorted(messages, key=lambda m: m.id):
            parsed = parse_post(message.id, message.text or "", message.date, message.buttons)
            if parsed:
                self.db.execute("INSERT OR REPLACE INTO posts VALUES (?,?,0)", (message.id, json.dumps(parsed, ensure_ascii=False)))
            cursor = max(cursor, message.id)
        set_setting(self.db, "ani_live", cursor)
        self.db.commit()

    def match_posts(self, limit=3):
        for row in self.db.execute("SELECT id,payload FROM posts WHERE matched=0 ORDER BY id DESC LIMIT ?", (limit,)).fetchall():
            parsed = json.loads(row["payload"])
            records = select_archive_title_records(parsed, match_archive(parsed, [], self.grouped, self.metadata))
            if records:
                key = group_key(parsed)
                existing = self.state.get("anime", {}).get(key)
                # Reject explicit season conflicts rather than merging sequel
                # files into the first season under a shared metadata ID.
                if existing and existing.get("season") and parsed.get("season") and existing["season"] != parsed["season"]:
                    self.db.execute("UPDATE posts SET matched=1 WHERE id=?", (row["id"],))
                    continue
                key, is_new, changed, episodes = merge_post(self.state, parsed)
                self.dirty |= changed
                if changed:
                    self.db.execute("UPDATE files SET published=0 WHERE anime_key=?", (key,))
                if is_new:
                    self.cover_keys.add(key)
                for record in records:
                    if bind_title(self.db, record["title"], key):
                        self.db.execute("UPDATE files SET anime_key=?,published=0 WHERE id=? AND anime_key IS NOT ?", (key, record["id"], key))
                if episodes:
                    queue_episode_event(self.state, key, parsed, episodes)
            self.db.execute("UPDATE posts SET matched=1 WHERE id=?", (row["id"],))
        self.db.commit()

    async def copy_one(self):
        row = self.db.execute("""SELECT * FROM files WHERE state='pending' AND retry_at<=?
          ORDER BY priority DESC, (anime_key IS NOT NULL) DESC, id LIMIT 1""", (time.time(),)).fetchone()
        if not row:
            return False
        record = json.loads(row["record"])
        self.phase("copy")
        self.status["current"] = {"message": row["id"], "name": record.get("name", "")[:120]}
        try:
            message = await self.tg(lambda: self.client.get_messages(self.sky, ids=row["id"]))
            if not message or not message.document:
                self.db.execute("UPDATE files SET state='missing',error='source document unavailable' WHERE id=?", (row["id"],))
                self.db.commit()
                return False
            doc_id = str(message.document.id)
            existing = self.db.execute("SELECT message_id FROM destination WHERE document_id=?", (doc_id,)).fetchone()
            rid = row["random_id"] or random_id(self.sky.id, self.dest.id, row["id"])
            self.db.execute("UPDATE files SET random_id=?,document_id=?,attempts=attempts+1 WHERE id=?", (rid, doc_id, row["id"]))
            self.db.commit()
            if existing:
                destination_id = existing[0]
            else:
                anime = self.state.get("anime", {}).get(row["anime_key"], {})
                title = anime.get("titleEn") or record.get("title") or record.get("name") or "فایل آرشیو"
                details = [title]
                if record.get("episode") is not None:
                    details.append(f"قسمت {record['episode']}")
                if record.get("quality"):
                    details.append(record["quality"])
                caption = (" — ".join(details) + "\nانیمه‌ورس")[:1000]
                async def send():
                    return await self.client(SendMediaRequest(
                        peer=self.dest, media=InputMediaDocument(utils.get_input_document(message.document)),
                        message=caption, random_id=rid, silent=True,
                    ))
                try:
                    result = await self.tg(send)
                except errors.FileReferenceExpiredError:
                    message = await self.tg(lambda: self.client.get_messages(self.sky, ids=row["id"]))
                    result = await self.tg(send)
                destination_id = getattr(result, "id", None)
                for update in getattr(result, "updates", []):
                    sent = getattr(update, "message", None)
                    if sent and getattr(sent, "document", None) and str(sent.document.id) == doc_id:
                        destination_id = sent.id
                    if getattr(update, "random_id", None) == rid:
                        destination_id = update.id
                if not destination_id:
                    # Do not resend with a new random ID when Telegram's
                    # response was lost. Reconcile recent destination files.
                    recent = await self.tg(lambda: self.client.get_messages(self.dest, limit=100))
                    destination_id = next((m.id for m in recent if m.document and str(m.document.id) == doc_id), None)
                if not destination_id:
                    raise RuntimeError("copy acknowledgement unavailable; reconcile before retry")
                self.copied += 1
            self.db.execute("INSERT OR IGNORE INTO destination VALUES (?,?)", (doc_id, destination_id))
            self.db.execute("UPDATE files SET state='copied',destination_id=?,copied_at=?,error='' WHERE id=?", (destination_id, now_iso(), row["id"]))
            self.db.commit()
            self.log(f"Copied source {row['id']} -> destination {destination_id}")
            return not bool(existing)
        except (errors.ChatForwardsRestrictedError, errors.ChatWriteForbiddenError) as exc:
            self.db.execute("UPDATE files SET state='blocked',error=? WHERE id=?", (type(exc).__name__, row["id"]))
            self.db.commit()
            self.log(f"Copy blocked by Telegram: {type(exc).__name__}", "error")
            if isinstance(exc, errors.ChatWriteForbiddenError):
                raise
        except Exception as exc:
            delay = min(21600, 60 * 2 ** min(row["attempts"], 8))
            self.db.execute("UPDATE files SET retry_at=?,error=? WHERE id=?", (time.time() + delay, type(exc).__name__, row["id"]))
            self.db.commit()
            self.log(f"Deferred source {row['id']}: {type(exc).__name__}", "warn")
        return False

    def flush(self):
        rows = self.db.execute("""SELECT f.* FROM files f
          LEFT JOIN bindings b ON b.title=json_extract(f.record,'$.title')
          WHERE f.state='copied' AND f.anime_key IS NOT NULL AND f.published=0
          AND COALESCE(b.conflict,0)=0 LIMIT 1000""").fetchall()
        for row in rows:
            self.dirty |= publish_record(self.state, row)
        if self.dirty:
            save_state(self.state)
            catalog, links = write_catalog(self.state)
            self.status.update(catalogCount=len(catalog), links=len(links))
            self.dirty = False
            set_setting(self.db, "catalog_changed_at", time.time())
        # Crash before save: pending export is replayed; crash after save:
        # existing done slots make export idempotent.
        self.db.executemany("UPDATE files SET published=1 WHERE id=?", [(r["id"],) for r in rows])
        self.db.commit()
        self.last_flush = time.monotonic()

    async def heartbeat(self):
        while True:
            self.status.update(updatedAt=now_iso(), pid=os.getpid(), copiedThisRun=self.copied,
                counts=dict(self.db.execute("SELECT state,count(*) FROM files GROUP BY state").fetchall()),
                unmatched=self.db.execute("SELECT count(*) FROM files WHERE anime_key IS NULL").fetchone()[0],
                metadataPending=self.db.execute("SELECT count(*) FROM posts WHERE matched=0").fetchone()[0])
            atomic_write_json(STATUS_PATH, self.status)
            notify = os.environ.get("NOTIFY_SOCKET")
            if notify:
                with contextlib.suppress(OSError):
                    with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
                        sock.sendto(b"WATCHDOG=1", "\0" + notify[1:] if notify.startswith("@") else notify)
            await asyncio.sleep(20)

    async def run(self):
        self.bootstrap()
        await self.connect()
        heartbeat = asyncio.create_task(self.heartbeat())
        self.status["state"] = "running"
        try:
            while self.running:
                if (DATA / "sync.stop").exists():
                    self.status["state"] = "paused"
                    self.flush()
                    await asyncio.sleep(5)
                    continue
                self.status["state"] = "running"
                if not setting(self.db, "destination_indexed", False):
                    await self.seed_destination()
                    await asyncio.sleep(.3)
                    continue
                if time.monotonic() - self.last_poll >= POLL_SECONDS:
                    self.phase("watch")
                    await self.scan_sky(live=True)
                    await self.scan_aniplus()
                    self.last_poll = time.monotonic()
                await self.scan_sky()
                self.match_posts()
                if time.time() >= setting(self.db, "verification_next_at", 0):
                    from repair_availability import verify_destination_page
                    verification = await verify_destination_page(self.state, self.db, self.client, self.dest)
                    if verification:
                        self.status["destinationVerification"] = verification
                        self.dirty |= bool(verification.get("invalidNow"))
                        # Save invalidated URLs before committing verification
                        # progress, so a restart cannot skip broken links.
                        if verification.get("invalidNow"):
                            self.flush()
                    self.db.commit()
                if time.monotonic() - self.last_reconcile >= 300:
                    from archive_identity import reconcile_cached
                    identified = reconcile_cached(self.state, self.db)
                    self.dirty |= bool(identified.get('matchedFiles'))
                    if identified.get('matchedFiles'):
                        # State first, DB second: a crash cannot leave file
                        # bindings pointing at an unsaved new metadata identity.
                        save_state(self.state)
                    self.cover_keys.update(identified.get('createdKeys', []))
                    self.status['identityMatching'] = {key:value for key,value in identified.items() if key != 'createdKeys'}
                    from repair_availability import reconcile, REPORT_PATH
                    repaired = reconcile(self.state, self.db, publish_record)
                    self.dirty |= bool(repaired.get("reconnectedLinks") or repaired.get("attachedArchiveSlots") or repaired.get("createdQueueEntries"))
                    self.db.commit()
                    atomic_write_json(REPORT_PATH, repaired)
                    self.status["availabilityRepair"] = {key: value for key, value in repaired.items() if key != "details"}
                    self.last_reconcile = time.monotonic()
                copied = await self.copy_one()
                if time.monotonic() - self.last_flush > 30:
                    self.flush()
                if self.cover_keys and time.monotonic() - self.last_covers > 300:
                    keys = sorted(self.cover_keys)[:5]
                    await prepare_covers(self.state, self, only_keys=keys)
                    self.cover_keys.difference_update(keys)
                    self.last_covers = time.monotonic()
                    self.dirty = True
                if self.args.max_copies and self.copied >= self.args.max_copies:
                    break
                await asyncio.sleep(max(4, ARCHIVE_COPY_DELAY) if copied else .5)
        finally:
            self.flush()
            heartbeat.cancel()
            await self.client.disconnect()
            self.status.update(state="stopped", updatedAt=now_iso())
            atomic_write_json(STATUS_PATH, self.status)
            self.db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-copies", type=int, default=0)
    args = parser.parse_args()
    job = "archive-pipeline"
    DATA.mkdir(exist_ok=True)
    with (DATA / "archive-pipeline.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not acquire_lock(job, 0):
            raise SystemExit("Another catalog writer is active")
        pipeline = Pipeline(args)
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: setattr(pipeline, "running", False))
        try:
            asyncio.run(pipeline.run())
        finally:
            release_lock(job)


if __name__ == "__main__":
    main()
