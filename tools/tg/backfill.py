#!/usr/bin/env python3
"""Archive-first backfill: discover AniPlus anime that have files in the private
archive but are not yet in the site catalog.

The script is deliberately split into resumable phases:

  --scan      walk the full @aniplus history and cache parsed anime posts
  --discover  merge old posts and add new titles only when the archive has a
              matching file (season/part aware)
  --link      copy matching archive files for the newly discovered titles
  --all       scan + discover + link new titles

It never uses MiniBot. Missing archive files stay pending for the normal sync
worker, so a backfill cannot accidentally start thousands of MiniBot calls.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import difflib
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any

from telethon import TelegramClient, errors
from telethon.sessions import StringSession
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.tl.types import InputMessagesFilterDocument

from catalog import write_catalog
from common import (
    API_HASH,
    API_ID,
    ARCHIVE_COPY_DELAY,
    ARCHIVE_INVITE,
    ARCHIVE_SEARCH_DELAY,
    DATA,
    SOURCE_CHANNEL,
    atomic_write_json,
    check_stop,
    clear_stop,
    load_state,
    now_iso,
    read_json,
    read_session,
    save_state,
    short_hash,
    slugify,
)
from ingest import merge_post, prepare_covers
from parse import parse_post
from resolver import (
    ArchiveResolver,
    BotFlow,
    _norm_text,
    _quality_of,
    _season_compatible,
    _season_part,
    _title_tokens,
    current_items,
    load_archive,
)

POSTS_PATH = DATA / "aniposts.json"
SCAN_PATH = DATA / "aniposts-scan.json"
ARCHIVE_INDEX_PATH = DATA / "archive-index.json"
ARCHIVE_JSONL_PATH = DATA / "archive-index.jsonl"
ARCHIVE_SCAN_PATH = DATA / "archive-scan.json"
ARCHIVE_MAP_PATH = DATA / "backfill-archive-map.json"
NEW_KEYS_PATH = DATA / "backfill-new-keys.json"
SKIPPED_PATH = DATA / "backfill-skipped.json"
STATUS_PATH = DATA / "backfill-status.json"
LOG_PATH = DATA / "backfill.log"
STOP_PATH = DATA / "backfill.stop"

SCAN_PAGE = 100
SCAN_SLEEP = 0.18


class BackfillStatus:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {
            "state": "running",
            "phase": "start",
            "startedAt": now_iso(),
            "updatedAt": now_iso(),
            "scanned": 0,
            "posts": 0,
            "archiveScanned": 0,
            "archiveFiles": 0,
            "groups": 0,
            "existingGroups": 0,
            "newGroups": 0,
            "archiveFound": 0,
            "archiveMissing": 0,
            "mergedPosts": 0,
            "newAnime": 0,
            "newKeys": [],
            "pendingLinks": 0,
            "linked": 0,
            "notFound": 0,
            "current": None,
            "lastError": "",
            "log": [],
        }
        self.write(force=True)

    def update(self, **values: Any) -> None:
        for key, value in values.items():
            self.data[key] = value
        self.data["updatedAt"] = now_iso()
        self.write()

    def phase(self, value: str) -> None:
        self.update(phase=value)

    def log(self, message: str, level: str = "info") -> None:
        stamp = dt.datetime.now().strftime("%H:%M:%S")
        entry = {"ts": stamp, "level": level, "msg": str(message)[:500]}
        logs = self.data.get("log") or []
        logs.append(entry)
        self.data["log"] = logs[-80:]
        self.data["lastActivityAt"] = now_iso()
        if level == "error":
            self.data["lastError"] = str(message)[:500]
        self.data["updatedAt"] = now_iso()
        self.write()
        try:
            with LOG_PATH.open("a", encoding="utf-8") as fh:
                fh.write(f"{dt.datetime.now().isoformat()} [{level}] {message}\n")
        except OSError:
            pass
        print(f"[{stamp}] {message}", flush=True)

    def write(self, force: bool = False) -> None:
        atomic_write_json(STATUS_PATH, self.data)


def check_backfill_stop() -> None:
    if STOP_PATH.exists():
        raise SystemExit("backfill stopped by request")


def group_key(parsed: dict[str, Any]) -> str:
    anime_id = str(parsed.get("animeId") or "")
    if anime_id:
        return f"a{anime_id}"
    hashtag = str(parsed.get("hashtag") or "")
    if hashtag:
        return f"h{slugify(hashtag)}"
    title = parsed.get("titleEn") or parsed.get("titleMain") or "anime"
    return f"t{short_hash(title)}"


def _post_groups(posts: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for post in posts:
        if not post.get("postId"):
            continue
        groups.setdefault(group_key(post), []).append(post)
    for items in groups.values():
        items.sort(key=lambda item: int(item.get("postId") or 0))
    return groups


def _title_variants(parsed: dict[str, Any]) -> list[str]:
    titles = [
        parsed.get("titleEn") or "",
        parsed.get("titleOriginal") or "",
        parsed.get("titleMain") or "",
    ]
    out: list[str] = []
    for title in titles:
        title = (title or "").strip()
        if not title:
            continue
        values = [title]
        short = re.split(r"\s*[:：]\s*", title, maxsplit=1)[0].strip()
        if short and short not in values:
            values.append(short)
        compact = re.sub(
            r"\bSeason\s+(\d{1,2})\b",
            r"S\1",
            title,
            flags=re.IGNORECASE,
        )
        if compact != title and compact not in values:
            values.append(compact)
        stripped = re.sub(
            r"\b(?:Season|Part)\s+\d+\b|\b\d+(?:st|nd|rd|th)\s+Season\b",
            "",
            title,
            flags=re.IGNORECASE,
        )
        stripped = re.sub(r"\s{2,}", " ", stripped).strip(" -:：")
        if stripped and stripped not in values:
            values.append(stripped)
        for value in values:
            if value not in out:
                out.append(value)
    return out[:8]


def _title_match(parsed: dict[str, Any], text: str) -> bool:
    tokens = _title_tokens(
        parsed.get("titleEn") or "",
        parsed.get("titleOriginal") or "",
        parsed.get("titleMain") or "",
    )
    if not tokens:
        return True
    haystack = _norm_text(text)
    hits = sum(1 for token in tokens if token in haystack)
    if len(tokens) > 1:
        return hits >= 2
    return hits >= 1


async def scan_aniposts(
    client: TelegramClient,
    status: BackfillStatus,
    max_pages: int | None = None,
    rescan: bool = False,
) -> list[dict[str, Any]]:
    status.phase("scan")
    channel = await client.get_entity(SOURCE_CHANNEL)
    posts = [] if rescan else (read_json(POSTS_PATH, []) or [])
    by_id = {int(item["postId"]): item for item in posts if item.get("postId")}
    scan = {} if rescan else (read_json(SCAN_PATH, {}) or {})
    offset = int(scan.get("nextOffset") or 0)
    scanned = int(scan.get("scanned") or 0)
    done = bool(scan.get("done")) and not rescan
    status.log(f"اسکن تاریخ @aniplus از پیام {offset or 'آخر'} آغاز شد")
    pages = 0
    while not done:
        check_backfill_stop()
        if max_pages is not None and pages >= max_pages:
            status.log(f"توقف آزمایشی بعد از {pages} صفحه")
            break
        try:
            messages = await client.get_messages(
                channel,
                limit=SCAN_PAGE,
                offset_id=offset,
            )
        except errors.FloodWaitError as exc:
            wait = int(getattr(exc, "seconds", 60)) + 2
            status.log(f"⏳ FloodWait اسکن: {wait} ثانیه", "warn")
            status.update(floodWaitUntil=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=wait)).isoformat())
            await asyncio.sleep(wait)
            continue
        except (errors.ServerError, errors.TimedOutError, ConnectionError, OSError) as exc:
            status.log(f"⚠️ خطای شبکه اسکن: {type(exc).__name__}", "warn")
            await asyncio.sleep(5)
            continue
        if not messages:
            done = True
            break
        for message in messages:
            scanned += 1
            offset = int(message.id)
            check_backfill_stop()
            try:
                parsed = parse_post(
                    message.id,
                    message.text or "",
                    message.date,
                    message.buttons,
                )
            except Exception as exc:
                status.log(f"⚠️ پست {message.id} قابل تجزیه نبود: {type(exc).__name__}", "warn")
                parsed = None
            if parsed:
                by_id[int(parsed["postId"])] = parsed
        pages += 1
        status.update(
            scanned=scanned,
            posts=len(by_id),
            pages=pages,
            current={"id": offset},
        )
        if pages % 5 == 0:
            atomic_write_json(POSTS_PATH, sorted(by_id.values(), key=lambda item: int(item["postId"])))
            atomic_write_json(
                SCAN_PATH,
                {"nextOffset": offset, "scanned": scanned, "done": done, "updatedAt": now_iso()},
            )
            status.log(f"اسکن: {scanned} پیام، {len(by_id)} پست آنیمه")
        await asyncio.sleep(SCAN_SLEEP)
    atomic_write_json(POSTS_PATH, sorted(by_id.values(), key=lambda item: int(item["postId"])))
    atomic_write_json(
        SCAN_PATH,
        {"nextOffset": offset, "scanned": scanned, "done": done, "updatedAt": now_iso()},
    )
    status.update(posts=len(by_id), scanned=scanned, current=None)
    status.log(f"✅ اسکن تمام شد: {scanned} پیام، {len(by_id)} پست آنیمه")
    return sorted(by_id.values(), key=lambda item: int(item["postId"]))


VIDEO_EXTS = {".mkv", ".mp4", ".avi", ".mov", ".webm", ".m4v", ".ts", ".m2ts"}
QUALITY_TOKEN_RE = re.compile(
    r"\b(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd)\b",
    re.IGNORECASE,
)
ARCHIVE_PREFIX_RE = re.compile(r"^\s*(?:\[@?[^\]]+\]|@[A-Za-z0-9_]+)\s*")


def parse_archive_fields(
    name: str,
    caption: str,
    message_id: int,
    size: Any = None,
    date: str = "",
) -> dict[str, Any] | None:
    raw = (caption or name or "").strip()
    if not raw:
        return None
    ext = Path(name or raw).suffix.lower().replace(" ", "")
    if ext in {".webp", ".jpg", ".jpeg", ".png", ".gif", ".sticker"}:
        return None
    if not ext and not QUALITY_TOKEN_RE.search(raw):
        return None
    if ext not in VIDEO_EXTS and not QUALITY_TOKEN_RE.search(raw):
        return None

    ep_text = raw.replace("_", " ").replace("\n", " ")
    ep_text = ARCHIVE_PREFIX_RE.sub("", ep_text)
    ep_text = re.sub(
        r"\.(?:mkv|mp4|avi|mov|webm|m4v|ts|m2ts)\s*$",
        "",
        ep_text,
        flags=re.IGNORECASE,
    )
    episode: int | None = None
    patterns = (
        r"\bS\d+\s*[._ ]\s*E\s*0*(\d{1,4})\b",
        r"\bEp?\s*0*(\d{1,4})\b",
        r"(?:-|_)\s*0*(\d{1,4})\s*(?:\[|\()?\s*(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd)\b",
        r"(?:-|_)\s*0*(\d{1,4})\s*\{",
        r"\s+0*(\d{1,4})\s*\{\s*\}\s*$",
        r"(?:^|[_\s])(\d{1,4})[_\s]+(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd)\b",
        r"قسمت\s*:?\s*0*(\d{1,4})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, ep_text, re.IGNORECASE)
        if match:
            episode = int(match.group(1))
            break

    title = re.sub(r"\[[^\]]*\]", " ", ep_text)
    title = re.sub(r"\bS\d+\s*[._ ]\s*E\s*0*\d+\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(
        r"\s*[-–—]\s*(?:S\d+\s*)?(?:Ep?\s*)?\d{1,4}\s*(?:\[|\()?\s*(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd).*$",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = re.sub(
        r"\s*[-–—]\s*(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd).*$",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = re.sub(
        r"\s*[-–—]\s*(?:Ep?\s*)?\d{1,4}\s*$",
        "",
        title,
        flags=re.IGNORECASE,
    )
    title = re.sub(r"\b(?:Ep?|Episode)\s*0*\d+\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"قسمت\s*:?\s*0*\d+\b", " ", title)
    title = re.sub(r"\b(?:کیفیت|حجم)\s*:?.*$", " ", title)
    title = QUALITY_TOKEN_RE.sub(" ", title)
    title = re.sub(r"\b(?:هاردساب|hardsub|x265|hevc|fhd)\b", " ", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\{[^}]*\}\s*$", " ", title)
    title = re.sub(r"\s*[-–—]\s*(?:Ep?\s*)?\d{1,4}\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s{2,}", " ", title).strip(" -–—_[]()")

    # Some archive files put the episode number directly at the end without a
    # separator ("Dr. Stone 07", "Vivy Fluorite Eyes Song 01"). Strip it when
    # it is zero-padded or at least two digits, and keep real numbered titles
    # such as "86" or "Edgerunners 2" intact.
    trailing = re.search(r"\s+(\d{1,3})\s*$", title)
    if trailing:
        number_text = trailing.group(1)
        before = title[: trailing.start()].strip(" -–—_")
        if before and (len(number_text) >= 2 or number_text.startswith("0")):
            episode = int(number_text)
            title = before
    if len(title) < 2:
        return None

    base, x265, hardsub = _quality_of(raw)
    if not base:
        return None
    season, part = _season_part(raw)
    if season is None:
        season, part = _season_part(title)
    if season is None:
        season = _roman_season(title)
    return {
        "id": int(message_id),
        "title": title,
        "norm": _norm_text(title),
        "episode": episode,
        "season": season,
        "part": part,
        "quality": base + (" x265" if x265 else "") + (" هاردساب" if hardsub else ""),
        "x265": x265,
        "hardsub": hardsub,
        "name": (name or "")[:300],
        "caption": (caption or "")[:300],
        "size": size,
        "date": date or "",
    }


def parse_archive_record(message: Any) -> dict[str, Any] | None:
    file = getattr(message, "file", None)
    date = ""
    if getattr(message, "date", None):
        try:
            date = message.date.isoformat()
        except AttributeError:
            date = str(message.date)
    return parse_archive_fields(
        str(getattr(file, "name", "") or ""),
        str(getattr(message, "raw_text", "") or "").strip(),
        int(message.id),
        getattr(file, "size", None),
        date,
    )


async def scan_archive(
    client: TelegramClient,
    status: BackfillStatus,
    max_pages: int | None = None,
    rescan: bool = False,
) -> list[dict[str, Any]]:
    status.phase("archive-scan")
    info = await client(CheckChatInviteRequest(ARCHIVE_INVITE))
    chat = getattr(info, "chat", None)
    if chat is None:
        raise RuntimeError("archive chat is not available")
    if rescan:
        for path in (ARCHIVE_INDEX_PATH, ARCHIVE_JSONL_PATH, ARCHIVE_SCAN_PATH):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
    records = [] if rescan else (read_json(ARCHIVE_INDEX_PATH, []) or [])
    known = {int(item["id"]) for item in records if item.get("id")}
    scan = {} if rescan else (read_json(ARCHIVE_SCAN_PATH, {}) or {})
    offset = int(scan.get("nextOffset") or 0)
    scanned = int(scan.get("scanned") or 0)
    done = bool(scan.get("done")) and not rescan
    status.log(f"اسکن آرشیو از پیام {offset or 'آخر'} آغاز شد")
    pages = 0
    while not done:
        check_backfill_stop()
        if max_pages is not None and pages >= max_pages:
            status.log(f"توقف آزمایشی آرشیو بعد از {pages} صفحه")
            break
        try:
            messages = await client.get_messages(
                chat,
                limit=SCAN_PAGE,
                offset_id=offset,
                filter=InputMessagesFilterDocument,
            )
        except errors.FloodWaitError as exc:
            wait = int(getattr(exc, "seconds", 60)) + 2
            status.log(f"⏳ FloodWait آرشیو: {wait} ثانیه", "warn")
            status.update(
                floodWaitUntil=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=wait)).isoformat()
            )
            await asyncio.sleep(wait)
            continue
        except (errors.ServerError, errors.TimedOutError, ConnectionError, OSError) as exc:
            status.log(f"⚠️ خطای شبکه آرشیو: {type(exc).__name__}", "warn")
            await asyncio.sleep(5)
            continue
        if not messages:
            done = True
            break
        new_records: list[dict[str, Any]] = []
        for message in messages:
            scanned += 1
            offset = int(message.id)
            check_backfill_stop()
            record = parse_archive_record(message)
            if record and record["id"] not in known:
                known.add(record["id"])
                records.append(record)
                new_records.append(record)
        if new_records:
            with ARCHIVE_JSONL_PATH.open("a", encoding="utf-8") as fh:
                for record in new_records:
                    fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        pages += 1
        status.update(
            archiveScanned=scanned,
            archiveFiles=len(records),
            archivePages=pages,
            current={"archiveId": offset},
        )
        if pages % 10 == 0:
            atomic_write_json(
                ARCHIVE_SCAN_PATH,
                {"nextOffset": offset, "scanned": scanned, "done": done, "updatedAt": now_iso()},
            )
            status.log(f"آرشیو: {scanned} سند، {len(records)} فایل ویدیویی")
        await asyncio.sleep(SCAN_SLEEP)
    records.sort(key=lambda item: int(item["id"]))
    atomic_write_json(ARCHIVE_INDEX_PATH, records)
    atomic_write_json(
        ARCHIVE_SCAN_PATH,
        {"nextOffset": offset, "scanned": scanned, "done": done, "updatedAt": now_iso()},
    )
    status.update(archiveScanned=scanned, archiveFiles=len(records), current=None)
    status.log(f"✅ اسکن آرشیو تمام شد: {scanned} سند، {len(records)} فایل")
    return records


def _title_norms(title: str) -> list[str]:
    norm = _norm_text(title)
    if not norm:
        return []
    out = [norm]
    compact = re.sub(r"\bseason\s+0*(\d{1,2})\b", r"s\1", norm)
    compact = re.sub(
        r"\b0*(\d{1,2})(?:st|nd|rd|th)\s+season\b",
        r"s\1",
        compact,
    )
    compact = re.sub(r"\bpart\s+0*(\d{1,2})\b", r"p\1", compact)
    compact = re.sub(r"\s{2,}", " ", compact).strip()
    if compact and compact not in out:
        out.append(compact)
    return out


def _parsed_norms(parsed: dict[str, Any]) -> set[str]:
    out: set[str] = set()
    for key in ("titleEn", "titleOriginal", "titleMain"):
        out.update(_title_norms(str(parsed.get(key) or "")))
    return out


def _season_compatible_record(
    parsed: dict[str, Any],
    record_title: str,
    metadata: dict[str, Any] | None = None,
) -> bool:
    if not _season_compatible(parsed, record_title):
        return False
    parsed_title = (
        f"{parsed.get('titleEn') or ''} {parsed.get('titleOriginal') or ''} "
        f"{parsed.get('titleMain') or ''}"
    )
    parsed_season, parsed_part = _season_part(parsed_title)
    if metadata is not None:
        record_season = metadata.get("season")
        record_part = metadata.get("part")
    else:
        record_season, record_part = _season_part(record_title)
        if record_season is None:
            record_season = _roman_season(record_title)
    if (
        parsed_season is not None
        and record_season is not None
        and record_season != parsed_season
    ):
        return False
    if (
        parsed_part is not None
        and record_part is not None
        and record_part != parsed_part
    ):
        return False
    return True


def _archive_match_score(
    parsed: dict[str, Any],
    record_title: str,
    metadata: dict[str, Any] | None = None,
) -> float:
    if not _season_compatible_record(parsed, record_title, metadata):
        return 0.0
    parsed_tokens = set(
        _title_tokens(
            parsed.get("titleEn") or "",
            parsed.get("titleOriginal") or "",
            parsed.get("titleMain") or "",
        )
    )
    record_tokens = (
        set(metadata.get("tokens") or [])
        if metadata is not None
        else set(_title_tokens(record_title))
    )
    if not parsed_tokens or not record_tokens:
        return 0.0
    # Archive titles are allowed to be shorter than the AniPlus title
    # ("Kyouran Reijou Nia L"), but an archive title with extra unrelated
    # words ("Yuusha no Kuzu" vs "Tate no Yuusha") is not the same anime.
    if not record_tokens.issubset(parsed_tokens):
        return 0.0
    if len(record_tokens) >= 2:
        return 1.0
    return 0.0


def archive_by_title(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        grouped.setdefault(record.get("title") or "", []).append(record)
    return grouped


SPINOFF_RE = re.compile(
    r"\b(ova|special|specials|recap|movie|film|break\s+time|mini|bonus|"
    r"picture\s+drama|log|heroines|final)\b",
    re.IGNORECASE,
)
SUBTITLE_SUFFIXES = {
    "hen", "arc", "chapter", "kanketsu", "final", "part", "movie",
    "ova", "special", "specials", "recap",
}

# A few AniPlus titles use an arc/subtitle while the archive uses a plain
# season number. These aliases are intentionally explicit; do not add a
# shortened-title guess here unless the archive title was inspected directly.
ARCHIVE_ALIASES: dict[str, tuple[str, ...]] = {
    "dr stone science future": ("Dr. Stone S4",),
    "dr stone new world part 2": ("Dr. Stone S3 Part2",),
    "kaguya sama wa kokurasetai tensai tachi no renai zunousen": (
        "Kaguya-sama wa Kokurasetai S2",
    ),
    "kaguya sama wa kokurasetai ultra romantic": ("Kaguya-sama S3",),
    "golden kamuy final season": ("Golden Kamuy S5",),
    "fruits basket the final": ("Fruits Basket (2019) S3",),
    "joran the princess of snow and blood": (
        "Joran The Princess of Snow and Blood",
    ),
    "jouran the princess of snow and blood": (
        "Joran The Princess of Snow and Blood",
    ),
    "pokemon horizons the series": ("Pokemon",),
}


def _clean_title_field(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"^format\([^)]*\)\)\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def _title_variants(title: str) -> list[str]:
    norms = _title_norms(title)
    out: list[str] = []
    for norm in norms:
        if norm and norm not in out:
            out.append(norm)
        stripped = re.sub(r"\s+tv$", "", norm).strip()
        if stripped and stripped not in out:
            out.append(stripped)
    return out


def _parsed_fields(parsed: dict[str, Any]) -> list[str]:
    fields: list[str] = []
    for key in ("titleEn", "titleOriginal"):
        value = _clean_title_field(parsed.get(key))
        if value:
            fields.append(value)
    if not fields:
        value = _clean_title_field(parsed.get("titleMain"))
        if value:
            fields.append(value)
    out: list[str] = []
    for value in fields:
        if value not in out:
            out.append(value)
    return out


def _parsed_season_part(fields: list[str]) -> tuple[int | None, int | None]:
    season: int | None = None
    part: int | None = None
    for field in fields:
        value, part_value = _season_part(field)
        if season is None and value is not None:
            season = value
        if part is None and part_value is not None:
            part = part_value
    if season is None:
        for field in fields:
            value = _roman_season(field)
            if value is not None:
                season = value
                break
    return season, part


def _trailing_number(fields: list[str]) -> int | None:
    for field in fields:
        match = re.search(r"\b(\d{1,2})\s*$", _norm_text(field))
        if match:
            value = int(match.group(1))
            if 2 <= value <= 20:
                return value
    return None


def _spinoff_words(fields: list[str]) -> set[str]:
    words: set[str] = set()
    for field in fields:
        words.update(match.group(1).lower().replace(" ", "_") for match in SPINOFF_RE.finditer(field))
    return words


def _archive_year(title: str) -> int | None:
    match = re.search(r"\b(19|20)\d{2}\b", title or "")
    return int(match.group(0)) if match else None


def archive_metadata(
    grouped: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    meta: dict[str, dict[str, Any]] = {}
    for title in grouped:
        season, part = _season_part(title)
        if season is None:
            season = _roman_season(title)
        if season is None:
            trailing = re.search(r"\s(\d{1,2})\s*$", title or "")
            if trailing:
                value = int(trailing.group(1))
                if 2 <= value <= 20:
                    season = value
        norms = set(_title_norms(title))
        for norm in list(norms):
            # A year in an archive title is metadata, not part of the name.
            # Keep the full norm and add the year-stripped form; the matcher
            # uses the parsed year to choose between a remake and the original.
            stripped = re.sub(r"\s+(?:19|20)\d{2}$", "", norm).strip()
            if stripped:
                norms.add(stripped)
        meta[title] = {
            "norm": _norm_text(title),
            "norms": norms,
            "tokens": set(_title_tokens(title)),
            "season": season,
            "part": part,
            "year": _archive_year(title),
        }
    return meta


def _dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[int] = set()
    for record in records:
        record_id = int(record.get("id") or 0)
        if record_id and record_id not in seen:
            seen.add(record_id)
            out.append(record)
    return out


def _records_for_titles(
    titles: list[str],
    by_title: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for title in titles:
        out.extend(by_title[title])
    return _dedupe_records(out)


def match_archive(
    parsed: dict[str, Any],
    records: list[dict[str, Any]],
    grouped: dict[str, list[dict[str, Any]]] | None = None,
    metadata: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Match an AniPlus title to archive files without guessing seasons.

    Exact normalized titles are preferred. A shorter archive title is accepted
    only when its tokens are a safe subset of the AniPlus title and the season
    and part numbers agree. This rejects the old false matches such as
    ``Tate no Yuusha Season 2 -> Yuusha no Kuzu`` and
    ``Kaguya-sama -> Himesama Goumon`` while still handling legitimate short
    archive names such as ``Tate no Yuusha S2``.
    """
    by_title = grouped if grouped is not None else archive_by_title(records)
    meta = metadata if metadata is not None else archive_metadata(by_title)
    fields = _parsed_fields(parsed)
    if not fields:
        return []
    alias_titles: list[str] = []
    for field in fields:
        alias_titles.extend(ARCHIVE_ALIASES.get(_norm_text(field), ()))
    if alias_titles:
        existing_aliases = [title for title in alias_titles if title in by_title]
        if existing_aliases:
            return _records_for_titles(existing_aliases, by_title)
    parsed_norms: set[str] = set()
    for field in fields:
        parsed_norms.update(_title_variants(field))
    parsed_tokens = set(_title_tokens(*fields))
    parsed_season, parsed_part = _parsed_season_part(fields)
    parsed_trailing = _trailing_number(fields)
    parsed_year = int(parsed.get("year") or 0) or None
    parsed_spinoff = _spinoff_words(fields)
    is_movie = (
        str(parsed.get("type") or "").strip() == "فیلم"
        or str(parsed.get("format") or "").upper() == "MOVIE"
        or int(parsed.get("declaredEpisodes") or 0) == 1
    )

    # 1) Exact normalized title match. Season/part markers must agree; a bare
    # archive title is not accepted for an AniPlus title that declares a season.
    exact: list[tuple[str, dict[str, Any]]] = []
    for title, item in meta.items():
        if not (parsed_norms & item["norms"]):
            continue
        if parsed_season is not None:
            if item.get("season") != parsed_season:
                continue
        elif item.get("season") is not None:
            continue
        if parsed_part is not None:
            if item.get("part") != parsed_part:
                continue
        elif item.get("part") is not None:
            continue
        exact.append((title, item))
    if exact:
        if parsed_year is not None:
            year_matches = [pair for pair in exact if pair[1].get("year") == parsed_year]
            if year_matches:
                exact = year_matches
            else:
                exact = [pair for pair in exact if pair[1].get("year") is None]
        years = {pair[1].get("year") for pair in exact if pair[1].get("year")}
        if len(years) > 1:
            return []
        return _records_for_titles([title for title, _item in exact], by_title)

    # 2) Conservative shortened-title match. Match each title field on its
    # own so words from the English title do not weaken a match against the
    # original-language title.
    field_infos: list[dict[str, Any]] = []
    for field in fields:
        token_list = _title_tokens(field)
        field_season, field_part = _parsed_season_part([field])
        field_infos.append(
            {
                "tokens": set(token_list),
                "token_list": token_list,
                "norms": set(_title_variants(field)),
                "season": field_season,
                "part": field_part,
                "trailing": _trailing_number([field]),
                "spinoff": _spinoff_words([field]),
            }
        )

    candidates: list[tuple[tuple[int, int, int], str, dict[str, Any]]] = []
    for title, item in meta.items():
        record_tokens = item["tokens"]
        if not record_tokens:
            continue
        if parsed_season is not None and item.get("season") != parsed_season:
            continue
        if parsed_part is not None and item.get("part") != parsed_part:
            continue
        record_spinoff = _spinoff_words([title])
        extra_media = record_spinoff - parsed_spinoff
        if extra_media and not (is_movie and extra_media.issubset({"movie"})):
            continue
        accepted = False
        for field_index, info in enumerate(field_infos):
            if not record_tokens.issubset(info["tokens"]):
                continue
            if info["season"] is not None:
                if item.get("season") != info["season"]:
                    continue
            elif info["part"] is not None:
                # A title such as "Dr. Stone: New World Part 2" can match an
                # archive file named "Dr. Stone S3 Part 2" even without an
                # explicit season in the AniPlus title.
                if item.get("part") != info["part"]:
                    continue
            elif info["trailing"] is not None:
                if item.get("season") != info["trailing"]:
                    continue
            elif parsed_trailing is not None and item.get("season") == parsed_trailing:
                pass
            else:
                if item.get("season") is not None:
                    continue
            if info["part"] is not None:
                if item.get("part") != info["part"]:
                    continue
            else:
                if item.get("part") is not None:
                    continue
            if info["spinoff"] and not info["spinoff"].issubset(record_spinoff):
                continue
            if len(record_tokens) < 2 and len(info["tokens"]) > 1:
                # A single word is enough only when an explicit matching season
                # already disambiguates it, and it is the first title word.
                first = info["token_list"][0] if info["token_list"] else ""
                if not (
                    info["season"] is not None
                    and item.get("season") == info["season"]
                    and first in record_tokens
                ):
                    continue
            if (
                info["season"] is None
                and info["part"] is None
                and info["trailing"] is None
            ):
                extra = info["tokens"] - record_tokens
                is_prefix = any(
                    parsed_norm.startswith(item["norm"])
                    for parsed_norm in info["norms"]
                )
                if is_prefix and not extra.issubset(SUBTITLE_SUFFIXES):
                    continue
                if (
                    len(record_tokens) < 3
                    and len(info["tokens"]) > 2
                    and not (info["spinoff"] and info["spinoff"].issubset(record_spinoff))
                ):
                    continue
            common_len = 0
            for parsed_norm in info["norms"]:
                common = os.path.commonprefix([parsed_norm, item["norm"]])
                if common and (common == parsed_norm or common == item["norm"]):
                    common_len = max(common_len, len(common))
            score = (field_index, len(record_tokens), common_len)
            candidates.append((score, title, item))
            accepted = True
            break

    if not candidates:
        return []
    best_score = max(score for score, _title, _item in candidates)
    best = [(title, item) for score, title, item in candidates if score == best_score]
    if parsed_season is None and parsed_part is None and parsed_trailing is None:
        distinct = {item["norm"] for _title, item in best}
        if len(distinct) > 1:
            return []
    seasons = {item.get("season") for _title, item in best if item.get("season") is not None}
    if len(seasons) > 1:
        return []
    parts = {item.get("part") for _title, item in best if item.get("part") is not None}
    if len(parts) > 1:
        return []
    return _records_for_titles([title for title, _item in best], by_title)

async def archive_has(
    archive: ArchiveResolver,
    parsed: dict[str, Any],
    status: BackfillStatus,
) -> bool:
    for query in _title_variants(parsed):
        check_backfill_stop()
        try:
            messages = await archive._collect(query)
        except SystemExit:
            raise
        except Exception as exc:
            status.log(f"⚠️ جست‌وجوی آرشیو «{query}» ناموفق: {type(exc).__name__}", "warn")
            await asyncio.sleep(3)
            continue
        for message in messages:
            text = (
                f"{message.raw_text or ''}\n"
                f"{getattr(getattr(message, 'file', None), 'name', '') or ''}"
            )
            if not _season_compatible(parsed, text):
                continue
            if _title_match(parsed, text):
                status.log(f"✅ در آرشیو پیدا شد: {parsed.get('titleEn') or query}")
                return True
        await asyncio.sleep(ARCHIVE_SEARCH_DELAY)
    return False


def _find_existing_key(
    parsed: dict[str, Any],
    existing: dict[str, dict[str, Any]],
) -> str:
    anime_id = str(parsed.get("animeId") or "")
    if anime_id:
        for key, anime in existing.items():
            if str(anime.get("aniplusId") or "") == anime_id:
                return key
    title = parsed.get("titleEn") or parsed.get("titleOriginal") or parsed.get("titleMain") or ""
    title_norm = _norm_text(title)
    if not title_norm:
        return ""
    parsed_season, parsed_part = _season_part(title)
    parsed_tokens = _title_tokens(
        parsed.get("titleEn") or "",
        parsed.get("titleOriginal") or "",
        parsed.get("titleMain") or "",
    )
    for key, anime in existing.items():
        existing_title = (
            anime.get("titleEn")
            or anime.get("titleOriginal")
            or anime.get("titleMain")
            or ""
        )
        existing_norm = _norm_text(existing_title)
        if title_norm and title_norm == existing_norm:
            return key
        existing_season, existing_part = _season_part(existing_title)
        if existing_season is not None and parsed_season is None:
            # A bare "Kusuriya no Hitorigoto" post must not be merged into
            # "The Apothecary Diaries Season 3"; it is an older season.
            continue
        if (
            existing_season is not None
            and parsed_season is not None
            and existing_season != parsed_season
        ):
            continue
        if (
            existing_part is not None
            and parsed_part is not None
            and existing_part != parsed_part
        ):
            continue
        if not parsed_tokens:
            continue
        haystack = _norm_text(
            f"{anime.get('titleEn') or ''} {anime.get('titleOriginal') or ''}"
        )
        hits = sum(1 for token in parsed_tokens if token in haystack)
        if len(parsed_tokens) == 1 and hits >= 1:
            return key
        if len(parsed_tokens) > 1 and hits >= 2 and hits / len(parsed_tokens) >= 0.5:
            return key
    return ""


async def discover(
    archive: ArchiveResolver,
    state: dict[str, Any],
    status: BackfillStatus,
    archive_records: list[dict[str, Any]] | None = None,
    max_groups: int | None = None,
    no_covers: bool = False,
) -> list[str]:
    status.phase("discover")
    posts = read_json(POSTS_PATH, []) or []
    groups = _post_groups(posts)
    existing = state.get("anime") or {}
    grouped_archive = archive_by_title(archive_records or [])
    grouped_meta = archive_metadata(grouped_archive)
    new_keys: list[str] = []
    skipped: list[str] = []
    archive_map: dict[str, list[dict[str, Any]]] = read_json(ARCHIVE_MAP_PATH, {}) or {}
    merged_posts = 0
    checked = 0
    status.update(groups=len(groups), existingGroups=0, newGroups=0)
    for index, (key, items) in enumerate(sorted(groups.items())):
        check_backfill_stop()
        if max_groups is not None and checked >= max_groups:
            status.log(f"توقف آزمایشی بعد از {checked} گروه")
            break
        latest = items[-1]
        if key in existing or _find_existing_key(latest, existing):
            # Existing catalog entries are already owned by the normal worker.
            # Do not merge old posts here: an old bare title such as
            # "Kusuriya no Hitorigoto" must not be folded into Season 3.
            status.update(existingGroups=int(status.data.get("existingGroups") or 0) + 1)
            continue
        checked += 1
        status.update(
            newGroups=int(status.data.get("newGroups") or 0) + 1,
            current={"key": key, "title": latest.get("titleEn") or latest.get("titleMain")},
        )
        matched_records = (
            match_archive(latest, archive_records, grouped_archive, grouped_meta)
            if archive_records
            else []
        )
        found = bool(matched_records)
        if not found and not archive_records:
            found = await archive_has(archive, latest, status)
        if not found:
            skipped.append(key)
            status.update(archiveMissing=int(status.data.get("archiveMissing") or 0) + 1)
            status.log(f"⏭ آرشیو ندارد: {latest.get('titleEn') or key}")
            continue
        if matched_records:
            status.log(
                f"✅ در آرشیو پیدا شد: {latest.get('titleEn') or key} "
                f"({matched_records[0].get('title')} — {len(matched_records)} فایل)"
            )
        status.update(archiveFound=int(status.data.get("archiveFound") or 0) + 1)

        # Match every post once and choose a single archive title per post.
        # Some AniPlus hashtags contain several seasons/spinoffs (for example
        # Arifureta S2 + S3, or Boku no Hero S6 + a movie). Keeping those on
        # one page makes it impossible to tell which archive title an episode
        # belongs to, so split into one page per archive title/season/part.
        post_matches: list[tuple[dict[str, Any], list[dict[str, Any]]]] = []
        selected_by_post: dict[int, list[dict[str, Any]]] = {}
        for post in items:
            records = (
                match_archive(post, archive_records, grouped_archive, grouped_meta)
                if archive_records
                else []
            )
            selected = select_archive_title_records(post, records)
            post_matches.append((post, selected))
            selected_by_post[int(post.get("postId") or 0)] = selected
        title_groups: dict[
            tuple[str, int | None, int | None], list[dict[str, Any]]
        ] = {}
        for _post, records in post_matches:
            if not records:
                continue
            canonical = _norm_text(str(records[0].get("title") or ""))
            item_meta = grouped_meta.get(records[0].get("title") or "") or {}
            signature = (canonical, item_meta.get("season"), item_meta.get("part"))
            title_groups.setdefault(signature, []).extend(records)
        for signature, records in list(title_groups.items()):
            deduped = {
                int(record.get("id") or 0): record for record in records
            }
            title_groups[signature] = list(deduped.values())
        split_group = len(title_groups) > 1
        if split_group:
            status.log(
                f"↔ گروه چندعنوانی/چندفصلی تفکیک شد: {latest.get('titleEn') or key} "
                f"({len(title_groups)} صفحه)"
            )
            subgroups: list[tuple[str, list[dict[str, Any]], list[dict[str, Any]]]] = []
            for (canonical, season, part), signature_records in title_groups.items():
                suffix = f"-t{short_hash(canonical)}"
                if season is not None:
                    suffix += f"-s{season}"
                if part is not None:
                    suffix += f"-p{part}"
                subgroup_posts = [
                    post
                    for post, records in post_matches
                    if records
                    and _norm_text(str(records[0].get("title") or "")) == canonical
                ]
                if subgroup_posts:
                    subgroups.append((suffix, subgroup_posts, signature_records))
        else:
            matched_posts = [
                post
                for post, _records in post_matches
                if selected_by_post.get(int(post.get("postId") or 0))
            ]
            subgroups = [("", matched_posts or items, matched_records)]

        for suffix, subgroup_posts, subgroup_records in subgroups:
            for post in subgroup_posts:
                post_for_merge = post
                if suffix:
                    post_for_merge = dict(post)
                    base_tag = str(post.get("hashtag") or key.lstrip("h"))
                    post_for_merge["hashtag"] = f"{base_tag}{suffix}"
                    # Force the hashtag path instead of a shared animeId.
                    post_for_merge["animeId"] = ""
                key2, is_new, changed, _added = merge_post(state, post_for_merge)
                state.setdefault("seen", {})[str(post["postId"])] = now_iso()
                merged_posts += 1
                if key2 not in new_keys:
                    new_keys.append(key2)
                if is_new:
                    status.update(newAnime=int(status.data.get("newAnime") or 0) + 1)
                    status.log(f"➕ {post.get('titleEn') or post.get('titleMain')} — {post.get('postId')}")
                # Map each page to its own season records. Never let the latest
                # season overwrite an older season's mapping.
                if split_group:
                    post_records = subgroup_records
                else:
                    post_records = selected_by_post.get(int(post.get("postId") or 0)) or matched_records
                if post_records:
                    merged_map = {
                        int(record.get("id") or 0): record
                        for record in (archive_map.get(key2) or [])
                    }
                    for record in post_records:
                        merged_map[int(record.get("id") or 0)] = record
                    archive_map[key2] = list(merged_map.values())
        if index % 3 == 0:
            save_state(state)
    added_archive_links = populate_archive_episodes(state, new_keys, archive_map)
    removed_unpickable = prune_unpickable_episodes(state, new_keys, archive_map)
    # Never leave an archive-backed title with no playable episode entry.
    empty_keys = [
        key
        for key in new_keys
        if not ((state.get("anime") or {}).get(key) or {}).get("episodes")
    ]
    for key in empty_keys:
        state.get("anime", {}).pop(key, None)
        archive_map.pop(key, None)
    if empty_keys:
        new_keys = [key for key in new_keys if key not in set(empty_keys)]
        status.log(f"⏭ {len(empty_keys)} عنوان بدون قسمت قابل‌پخش حذف شد", "warn")
    save_state(state)
    atomic_write_json(NEW_KEYS_PATH, new_keys)
    atomic_write_json(SKIPPED_PATH, skipped)
    atomic_write_json(ARCHIVE_MAP_PATH, archive_map)
    status.update(
        newKeys=new_keys,
        newAnime=len(new_keys),
        mergedPosts=merged_posts,
        archiveLinks=added_archive_links,
        archivePruned=removed_unpickable,
        current=None,
    )
    if not no_covers and new_keys:
        status.phase("covers")
        status.log(f"دانلود کاور {len(new_keys)} عنوان جدید…")
        await prepare_covers(state, status, only_keys=new_keys)
    save_state(state)
    catalog, links = write_catalog(state)
    status.update(catalogCount=len(catalog), links=len(links))
    status.log(f"✅ کاتالوگ به‌روز شد: {len(catalog)} عنوان، {len(links)} لینک")
    return new_keys


ROMAN_SEASONS = {
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
    "vii": 7,
    "viii": 8,
    "ix": 9,
    "x": 10,
}


def _roman_season(title: str) -> int | None:
    # Roman numerals can appear before a subtitle ("Mushoku Tensei II:
    # Isekai Ittara...") as well as at the end. Only treat a standalone
    # uppercase roman token as a season marker.
    match = re.search(r"\b(III|II|IV|V|VI|VII|VIII|IX|X)\b", title or "")
    return ROMAN_SEASONS.get(match.group(1).lower()) if match else None


def _pick_archive_record(
    records: list[dict[str, Any]],
    item: dict[str, Any],
    anime: dict[str, Any],
) -> dict[str, Any] | None:
    episode = int(item.get("episode") or 1)
    requested_base, requested_x265, requested_hardsub = _quality_of(
        str(item.get("quality") or "")
    )
    single = (
        str(anime.get("type") or "") == "فیلم"
        or str(anime.get("format") or "").upper() == "MOVIE"
        or int(anime.get("declaredEpisodes") or 0) == 1
    )
    anime_season, anime_part = _season_part(
        f"{anime.get('titleEn') or ''} {anime.get('titleOriginal') or ''}"
    )
    candidates: list[tuple[int, int, dict[str, Any]]] = []
    for record in records:
        record_ep = record.get("episode")
        if record_ep is None:
            if not single:
                continue
        elif int(record_ep) != episode:
            continue
        record_season, record_part = _season_part(str(record.get("title") or ""))
        if record_season is None:
            record_season = _roman_season(str(record.get("title") or ""))
        if anime_season is not None and record_season is not None and record_season != anime_season:
            continue
        if anime_part is not None and record_part is not None and record_part != anime_part:
            continue
        base, x265, hardsub = _quality_of(str(record.get("quality") or ""))
        if requested_base:
            if base != requested_base or x265 != requested_x265:
                continue
            if requested_hardsub and not hardsub:
                continue
        elif not base:
            continue
        # Exact label wins; otherwise prefer a clean file over hardsub.
        exact = 1 if str(record.get("quality") or "").lower() == str(item.get("quality") or "").lower() else 0
        clean = 1 if not hardsub else 0
        # Prefer an explicitly matching season over an untagged file, so
        # Shiguang Dailiren III cannot lose to an untagged season 1/2 file.
        season_score = 2 if anime_season is not None and record_season == anime_season else (1 if record_season is None else 0)
        if requested_base:
            quality_score = 0
        else:
            # AniPlus deep links do not name a quality. Pick a sensible archive
            # file instead of refusing every episode: 1080p clean first, then
            # 720p/480p, and prefer non-x265 when both exist.
            quality_score = {
                "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, "360p": 0
            }.get(base, 0)
        candidates.append(
            (
                season_score * 40 + exact * 20 + quality_score * 4 + clean * 2 + (0 if x265 else 1),
                int(record.get("id") or 0),
                record,
            )
        )
    if not candidates:
        return None
    candidates.sort(key=lambda row: (row[0], row[1]), reverse=True)
    return candidates[0][2]


def select_archive_title_records(
    parsed: dict[str, Any],
    records: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Choose one archive title for a post, not a mixture of spinoffs.

    ``match_archive`` can return the same score for a base title and a movie /
    arc / spinoff title. Mixing those records on one page caused the archive
    Season 2 / Season 3 confusion. This picks the archive title that is
    closest to the AniPlus post and returns only its records.
    """
    if not records:
        return []
    groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        canonical = _norm_text(str(record.get("title") or ""))
        if canonical:
            groups.setdefault(canonical, []).append(record)
    if not groups:
        return []
    parsed_norms = [_norm_text(field) for field in _parsed_fields(parsed) if field]
    parsed_is_movie = (
        str(parsed.get("type") or "").strip() == "فیلم"
        or str(parsed.get("format") or "").upper() == "MOVIE"
    )
    best_key: tuple[float, int, int] | None = None
    best_records: list[dict[str, Any]] = []
    for canonical, group_records in groups.items():
        title = str(group_records[0].get("title") or "")
        score = 0.0
        for parsed_norm in parsed_norms:
            ratio = difflib.SequenceMatcher(None, parsed_norm, canonical).ratio()
            if parsed_norm.startswith(canonical) or canonical.startswith(parsed_norm):
                ratio += 0.15
            score = max(score, ratio)
        spinoff = _spinoff_words([title])
        if parsed_is_movie:
            if "movie" in spinoff:
                score += 0.2
        elif "movie" in spinoff:
            score -= 0.5
        if spinoff - {"movie"} and not parsed_is_movie:
            score -= 0.08
        key = (score, len(group_records), len(canonical))
        if best_key is None or key > best_key:
            best_key = key
            best_records = group_records
    return best_records


def _archive_record_better(record: dict[str, Any], current: dict[str, Any]) -> bool:
    """Prefer a clean duplicate over a hardsub/x265 duplicate."""
    _base, x265, hardsub = _quality_of(str(record.get("quality") or ""))
    _cbase, cx265, chardsub = _quality_of(str(current.get("quality") or ""))
    return (not hardsub, not x265, int(record.get("id") or 0)) > (
        not chardsub,
        not cx265,
        int(current.get("id") or 0),
    )


def populate_archive_episodes(
    state: dict[str, Any],
    keys: list[str],
    archive_map: dict[str, list[dict[str, Any]]],
) -> int:
    """Create episode/quality entries for every available archive file.

    AniPlus posts often expose only the latest episode through a MiniBot deep
    link. The archive, however, may contain the full season. For newly
    discovered archive-backed titles we replace placeholder labels such as
    «اینجا کلیک کنید» with the real archive qualities and add every episode
    that exists, so the site reflects the archive rather than only the latest
    AniPlus post.
    """
    queue = state.setdefault("queue", {})
    added = 0
    for key in keys:
        anime = (state.get("anime") or {}).get(key)
        if not anime:
            continue
        records = archive_map.get(key) or []
        if not records:
            continue
        single = (
            str(anime.get("type") or "") == "فیلم"
            or str(anime.get("format") or "").upper() == "MOVIE"
            or int(anime.get("declaredEpisodes") or 0) == 1
        )
        # Drop MiniBot placeholders from this new archive-backed title.
        for episode in list((anime.get("episodes") or {}).keys()):
            bucket = anime["episodes"].get(episode) or {}
            for label, deep_link in list(bucket.items()):
                base, _x265, _hardsub = _quality_of(str(label))
                if base:
                    continue
                bucket.pop(label, None)
                queued = queue.get(deep_link)
                if queued and queued.get("status") != "done":
                    queued["status"] = "replaced"
            if not bucket:
                anime["episodes"].pop(episode, None)
        chosen: dict[tuple[int, str], dict[str, Any]] = {}
        for record in records:
            raw_episode = record.get("episode")
            if raw_episode is None:
                if not single:
                    continue
                episode = 1
            else:
                try:
                    episode = int(raw_episode)
                except (TypeError, ValueError):
                    continue
            if episode <= 0:
                continue
            quality = str(record.get("quality") or "").strip()
            if not quality:
                continue
            slot = (episode, quality)
            current = chosen.get(slot)
            if current is None or _archive_record_better(record, current):
                chosen[slot] = record
        for (episode, quality), record in sorted(chosen.items()):
            bucket = anime.setdefault("episodes", {}).setdefault(str(episode), {})
            if quality in bucket:
                continue
            deep_link = f"archive:{record.get('id')}"
            if deep_link not in queue:
                queue[deep_link] = {
                    "deepLink": deep_link,
                    "animeKey": key,
                    "animeId": anime.get("aniplusId") or "",
                    "slug": anime.get("slug") or key,
                    "title": anime.get("titleEn") or anime.get("titleOriginal") or key,
                    "episode": episode,
                    "quality": quality,
                    "postId": 0,
                    "status": "pending",
                    "attempts": 0,
                    "addedAt": now_iso(),
                    "source": "archive",
                    "archiveRecordId": int(record.get("id") or 0),
                }
            bucket[quality] = deep_link
            added += 1
    return added


def prune_unpickable_episodes(
    state: dict[str, Any],
    keys: list[str],
    archive_map: dict[str, list[dict[str, Any]]],
) -> int:
    """Remove labels the archive cannot satisfy (for example x265-only links).

    The backfill must not leave dead MiniBot placeholders on newly added pages.
    The normal sync worker can still handle the older catalog; these new pages
    show only files that are actually present in the archive.
    """
    queue = state.setdefault("queue", {})
    removed = 0
    for key in keys:
        anime = (state.get("anime") or {}).get(key)
        if not anime:
            continue
        records = archive_map.get(key) or []
        for episode in list((anime.get("episodes") or {}).keys()):
            bucket = anime["episodes"].get(episode) or {}
            for label, deep_link in list(bucket.items()):
                item = queue.get(deep_link) or {}
                if _pick_archive_record(records, item, anime):
                    continue
                bucket.pop(label, None)
                if item and item.get("status") != "done":
                    item["status"] = "replaced"
                removed += 1
            if not bucket:
                anime["episodes"].pop(episode, None)
    return removed


async def link_new(
    flow: BotFlow,
    state: dict[str, Any],
    status: BackfillStatus,
    new_keys: list[str],
    max_links: int | None = None,
) -> int:
    status.phase("link")
    wanted = set(new_keys)
    if not wanted:
        status.log("عنوان جدیدی برای لینک آرشیوی پیدا نشد؛ این مرحله رد شد", "warn")
        return 0
    archive_map = read_json(ARCHIVE_MAP_PATH, {}) or {}
    pending = [
        item
        for item in current_items(state)
        if item.get("status") == "pending"
        and (not wanted or item.get("animeKey") in wanted)
    ]
    pending.sort(key=lambda item: (int(item.get("postId") or 0), int(item.get("episode") or 0)))
    status.update(pendingLinks=len(pending))
    status.log(f"لینک آرشیوی برای {len(pending)} مورد جدید شروع شد")
    linked = 0
    not_found = 0
    for index, item in enumerate(pending, start=1):
        check_backfill_stop()
        if max_links is not None and linked >= max_links:
            status.log(f"توقف آزمایشی بعد از {linked} لینک")
            break
        status.update(
            current={
                "title": item.get("title"),
                "episode": item.get("episode"),
                "quality": item.get("quality"),
                "index": index,
                "total": len(pending),
            }
        )
        try:
            anime = (state.get("anime") or {}).get(item.get("animeKey") or "") or {}
            record = _pick_archive_record(
                archive_map.get(item.get("animeKey") or "") or [],
                item,
                anime,
            )
            archived = None
            if record:
                archived = await flow.tg(
                    lambda: flow.client.get_messages(
                        flow.archive.entity,
                        ids=int(record["id"]),
                    ),
                    "archive fetch",
                )
                if archived is not None and not getattr(archived, "document", None):
                    archived = None
            if archived is None and flow.archive is not None:
                archived = await flow.archive.find(item)
            if archived is None:
                item["lastError"] = "در آرشیو پیدا نشد"
                item["archiveCheckedAt"] = now_iso()
                not_found += 1
                status.update(notFound=not_found)
                continue
            result = await flow.copy_document(archived, item, "آرشیو")
            await flow._sleep(ARCHIVE_COPY_DELAY)
            item.update(
                status="done",
                url=result.get("url"),
                messageId=result.get("messageId"),
                size=result.get("size"),
                resolvedAt=now_iso(),
                lastError="",
            )
            linked += 1
            status.update(linked=linked)
            status.log(
                f"📥 {item.get('title')} — قسمت {item.get('episode')} — {item.get('quality')}"
            )
        except errors.FloodWaitError as exc:
            wait = int(getattr(exc, "seconds", 60)) + 2
            status.log(f"⏳ FloodWait لینک: {wait} ثانیه", "warn")
            await asyncio.sleep(wait)
        except Exception as exc:
            item["lastError"] = f"{type(exc).__name__}: {str(exc)[:160]}"
            status.log(f"⚠️ لینک ناموفق: {type(exc).__name__}", "warn")
        if index % 5 == 0:
            save_state(state)
        if index % 20 == 0:
            write_catalog(state)
    save_state(state)
    catalog, links = write_catalog(state)
    status.update(catalogCount=len(catalog), links=len(links), current=None)
    status.log(f"✅ لینک آرشیو جدید: {linked} موفق، {not_found} پیدا نشد")
    return linked


async def run(args: argparse.Namespace) -> int:
    clear_stop()
    try:
        STOP_PATH.unlink()
    except FileNotFoundError:
        pass
    status = BackfillStatus()
    status.log("بک‌فیل آرشیو آغاز شد")
    state = load_state()
    client = TelegramClient(
        StringSession(read_session()),
        API_ID,
        API_HASH,
        connection_retries=10,
        request_retries=5,
        timeout=30,
        auto_reconnect=True,
    )
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram session is not authorised")
    try:
        if args.scan or args.all:
            await scan_aniposts(client, status, max_pages=args.max_pages, rescan=args.rescan)
        if args.archive_scan or args.all:
            await scan_archive(
                client,
                status,
                max_pages=args.max_pages,
                rescan=args.archive_rescan,
            )
        if args.discover or args.link or args.all:
            mini = await client.get_entity("AniPlusMiniBot")
            end = await client.get_entity("AniPlusEndBot")
            dest = await client.get_entity("testanivers")
            flow = BotFlow(client, mini, end, dest, state, status)
            flow.archive = await load_archive(client, flow)
            if flow.archive is None:
                raise RuntimeError("archive is not available")
            if args.discover or args.all:
                archive_records = read_json(ARCHIVE_INDEX_PATH, []) or []
                new_keys = await discover(
                    flow.archive,
                    state,
                    status,
                    archive_records=archive_records,
                    max_groups=args.max_groups,
                    no_covers=args.no_covers,
                )
            else:
                new_keys = read_json(NEW_KEYS_PATH, []) or []
            if args.link or args.all:
                await link_new(flow, state, status, new_keys, max_links=args.max_links)
        status.update(state="done", phase="done", current=None)
        status.log("✅ بک‌فیل تمام شد")
        return 0
    finally:
        await client.disconnect()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scan", action="store_true", help="scan full @aniplus history")
    parser.add_argument("--archive-scan", action="store_true", help="index all documents in the private archive")
    parser.add_argument("--discover", action="store_true", help="merge posts and add archive-backed new titles")
    parser.add_argument("--link", action="store_true", help="copy archive files for newly added titles")
    parser.add_argument("--all", action="store_true", help="scan + archive-scan + discover + link")
    parser.add_argument("--rescan", action="store_true", help="restart AniPlus scan from latest")
    parser.add_argument("--archive-rescan", action="store_true", help="restart archive scan from latest")
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--max-groups", type=int, default=None)
    parser.add_argument("--max-links", type=int, default=None)
    parser.add_argument("--no-covers", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    asyncio.run(run(parse_args()))
