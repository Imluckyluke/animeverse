"""Fetch @aniplus posts, merge them idempotently and prepare local cover art."""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
from pathlib import Path
from typing import Any

from common import (
    DATA,
    PUBLIC_COVERS,
    ROOT,
    check_stop,
    now_iso,
    quality_key,
    save_state,
    short_hash,
    slugify,
    write_stop,
)
from parse import episode_count, parse_post
from media import ensure_cover, safe_key

NOTIFY_EVENTS_PATH = DATA / "notify-events.jsonl"

# AniPlus sometimes uses a localized/alternative name that is not the title
# viewers know. Keep these stable across future post merges.
TITLE_OVERRIDES: dict[str, dict[str, str]] = {
    "847": {
        "titleEn": "Detective Conan",
        "titleFa": "کارآگاه کانن",
    },
}


def queue_episode_event(
    state: dict[str, Any],
    key: str,
    parsed: dict[str, Any],
    added_episodes: list[int],
) -> None:
    """Append a notification event for the bot worker.

    The sync worker and the bot are separate processes. JSONL append is
    deliberately used here so a long sync run never has to rewrite/own the
    bot's cursor file.
    """
    if not added_episodes:
        return
    anime = (state.get("anime") or {}).get(key) or {}
    slug = anime.get("slug") or ""
    if not slug:
        return
    episodes = sorted({int(item) for item in added_episodes})
    event = {
        "id": f"{parsed.get('postId')}:{slug}:{','.join(str(item) for item in episodes)}",
        "slug": slug,
        "title": anime.get("titleFa") or anime.get("titleEn") or parsed.get("titleFa") or parsed.get("titleEn") or slug,
        "titleEn": anime.get("titleEn") or parsed.get("titleEn") or "",
        "episodes": episodes,
        "postId": parsed.get("postId"),
        "createdAt": now_iso(),
    }
    try:
        NOTIFY_EVENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with NOTIFY_EVENTS_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _unique_slug(state: dict[str, Any], title: str, key: str) -> str:
    base = slugify(title)
    # Site routes must stay ASCII. Persian/Japanese titles are kept for
    # display in titleFa/titleEn, while the slug falls back to the stable key.
    if not base or any(ord(char) > 127 for char in base):
        base = f"anime-{safe_key(key).lower()}"
    used = {a.get("slug") for a in (state.get("anime") or {}).values() if a.get("slug")}
    slug = base
    suffix = 2
    while slug in used:
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def merge_post(state: dict[str, Any], parsed: dict[str, Any]) -> tuple[str, bool, bool, list[int]]:
    """Merge a parsed post. Returns (anime_key, is_new, changed, added_episodes)."""
    anime_id = parsed.get("animeId") or ""
    added_episodes: list[int] = []
    if anime_id:
        key = f"a{anime_id}"
    elif parsed.get("hashtag"):
        key = f"h{slugify(parsed['hashtag'])}"
    else:
        key = f"t{short_hash(parsed.get('titleEn') or parsed.get('titleMain') or 'anime')}"

    anime = state["anime"].get(key)
    is_new = anime is None
    changed = False

    if is_new:
        title_for_slug = (
            parsed.get("titleOriginal")
            or parsed.get("titleEn")
            or parsed.get("titleMain")
            or ""
        )
        anime = {
            "key": key,
            "aniplusId": anime_id,
            "slug": _unique_slug(state, title_for_slug, key),
            "mediaKey": safe_key(anime_id or f"x{short_hash(key)}"),
            "createdAt": now_iso(),
            "episodes": {},
            "postIds": [],
            "firstPostId": parsed["postId"],
            "lastPostId": 0,
        }
        state["anime"][key] = anime
        changed = True

    newer = is_new or parsed["postId"] >= int(anime.get("lastPostId") or 0)

    scalar_fields = [
        "titleEn",
        "titleFa",
        "titleOriginal",
        "titleJa",
        "synopsis",
        "type",
        "format",
        "status",
        "season",
        "seasonRaw",
        "seasonEn",
        "year",
        "durationRaw",
        "ageRating",
        "ageRaw",
        "sourceMaterial",
        "producers",
        "studio",
    ]
    for field in scalar_fields:
        value = parsed.get(field)
        if not value:
            continue
        if newer or not anime.get(field):
            if anime.get(field) != value:
                anime[field] = value
                changed = True

    override = TITLE_OVERRIDES.get(str(anime_id or ""))
    if override:
        for field, value in override.items():
            if anime.get(field) != value:
                anime[field] = value
                changed = True

    if parsed.get("genres") and (newer or not anime.get("genres")):
        if anime.get("genres") != parsed["genres"]:
            anime["genres"] = parsed["genres"]
            changed = True
    if parsed.get("scoreMal") is not None and (newer or not anime.get("scoreMal")):
        anime["scoreMal"] = parsed["scoreMal"]
    if parsed.get("scoreAniplus") is not None and (newer or not anime.get("scoreAniplus")):
        anime["scoreAniplus"] = parsed["scoreAniplus"]
    if parsed.get("watchUrl") and (newer or not anime.get("watchUrl")):
        anime["watchUrl"] = parsed["watchUrl"]
    if anime_id and not anime.get("aniplusId"):
        anime["aniplusId"] = anime_id
    if parsed.get("hashtag") and not anime.get("hashtag"):
        anime["hashtag"] = parsed["hashtag"]

    declared = parsed.get("declaredEpisodes")
    if declared:
        if int(declared) > int(anime.get("declaredEpisodes") or 0):
            anime["declaredEpisodes"] = int(declared)
            changed = True

    if parsed.get("coverUrl") and (newer or not anime.get("coverUrl")):
        if anime.get("coverUrl") != parsed["coverUrl"]:
            anime["coverUrl"] = parsed["coverUrl"]
            changed = True

    if parsed["postId"] not in anime["postIds"]:
        anime["postIds"] = sorted({*anime.get("postIds", []), parsed["postId"]})
    anime["firstPostId"] = min(int(anime.get("firstPostId") or parsed["postId"]), parsed["postId"])
    if parsed["postId"] >= int(anime.get("lastPostId") or 0):
        anime["lastPostId"] = parsed["postId"]
        anime["updatedAt"] = parsed.get("date") or now_iso()
        changed = True

    for episode, qualities in (parsed.get("episodes") or {}).items():
        episode = str(int(episode))
        bucket = anime["episodes"].get(episode)
        if bucket is None:
            bucket = {}
            anime["episodes"][episode] = bucket
            added_episodes.append(int(episode))
        for label, deep_link in qualities.items():
            old = bucket.get(label)
            if old == deep_link:
                continue
            if old and not newer:
                continue
            old_item = state["queue"].get(old) if old else None
            # A newer post often repeats earlier episodes. If that quality is
            # already forwarded to the destination channel, keep the existing
            # public file and never send it through the bot again.
            if old_item and old_item.get("status") == "done" and old_item.get("url"):
                continue
            if old and newer:
                if old_item and old_item.get("status") in {"pending", "failed"}:
                    old_item["status"] = "replaced"
            bucket[label] = deep_link
            queued = state["queue"].get(deep_link)
            if not queued:
                state["queue"][deep_link] = {
                    "deepLink": deep_link,
                    "animeKey": key,
                    "animeId": anime_id,
                    "slug": anime["slug"],
                    "title": anime.get("titleEn") or parsed.get("titleEn") or anime["slug"],
                    "episode": int(episode),
                    "quality": label,
                    "postId": parsed["postId"],
                    "status": "pending",
                    "attempts": 0,
                    "addedAt": now_iso(),
                }
            elif queued.get("status") == "replaced":
                queued["status"] = "pending"
            changed = True

    return key, is_new, changed, sorted(added_episodes)


async def prepare_covers(state: dict[str, Any], status: Any, only_keys: list[str] | None = None) -> int:
    status.phase("covers")
    todo: list[tuple[str, dict[str, Any]]] = []
    for key, anime in (state.get("anime") or {}).items():
        if only_keys is not None and key not in only_keys:
            continue
        url = anime.get("coverUrl") or ""
        if not url:
            continue
        media_key = anime.get("mediaKey") or safe_key(key)
        anime["mediaKey"] = media_key
        cover_file = PUBLIC_COVERS / f"{media_key}.jpg"
        banner_file = PUBLIC_COVERS / f"{media_key}-banner.jpg"
        needs = (
            anime.get("coverSource") != url
            or not anime.get("cover")
            or not cover_file.exists()
            or not banner_file.exists()
        )
        if needs:
            todo.append((key, anime))
    status.update(coversTotal=len(todo), coversDone=0)
    if not todo:
        return 0
    done = 0
    for key, anime in todo:
        check_stop()
        done += 1
        status.update(
            coversDone=done,
            current={
                "key": f"cover-{key}",
                "kind": "cover",
                "title": anime.get("titleEn") or anime.get("slug"),
                "postId": anime.get("lastPostId"),
            },
        )
        result = await asyncio.to_thread(ensure_cover, anime["mediaKey"], anime["coverUrl"])
        if result:
            anime["cover"], anime["banner"] = result
            anime["coverSource"] = anime["coverUrl"]
            status.log(f"کاور ذخیره شد: {anime.get('titleEn')}")
        else:
            anime["cover"] = anime.get("cover") or anime["coverUrl"]
            anime["banner"] = anime.get("banner") or anime.get("cover") or anime["coverUrl"]
            status.log(f"⚠️ دانلود کاور ناموفق بود: {anime.get('titleEn')}", "warn")
        if done % 5 == 0:
            save_state(state)
    status.update(current=None)
    return len(todo)


async def ingest_latest(
    client: Any,
    state: dict[str, Any],
    status: Any,
    limit_anime: int,
) -> tuple[int, int, int, list[str]]:
    status.phase("ingest")
    channel = await client.get_entity("aniplus")
    scan_limit = min(max(limit_anime * 4 + 40, 80), 40000)
    status.update(postsTotal=limit_anime, postsDone=0, scannedPosts=0)
    status.log(f"بررسی پست‌های کانال @aniplus (هدف: {limit_anime} پست آنیمه)")

    anime_done = 0
    scanned = 0
    new_count = 0
    updated_count = 0
    changed_keys: list[str] = []
    max_id = int(state.get("lastScanId") or 0)
    previous_scan_id = max_id

    async for message in client.iter_messages(channel, limit=scan_limit):
        check_stop()
        scanned += 1
        max_id = max(max_id, message.id)
        if scanned % 5 == 0:
            status.update(scannedPosts=scanned)
        parsed = parse_post(message.id, message.text or "", message.date, message.buttons)
        if not parsed:
            continue
        anime_done += 1
        status.update(
            postsDone=anime_done,
            scannedPosts=scanned,
            current={
                "key": f"post-{message.id}",
                "kind": "post",
                "postId": message.id,
                "title": parsed.get("titleEn") or parsed.get("titleMain"),
                "postUrl": f"https://t.me/aniplus/{message.id}",
            },
        )
        if str(message.id) in state.get("seen", {}):
            status.log(f"پست {message.id} قبلاً ذخیره شده — رد شد")
        else:
            key, is_new, changed, added_episodes = merge_post(state, parsed)
            state["seen"][str(message.id)] = now_iso()
            if changed and key not in changed_keys:
                changed_keys.append(key)
            if added_episodes and message.id > previous_scan_id:
                queue_episode_event(state, key, parsed, added_episodes)
                status.log(
                    f"🔔 اعلان قسمت {', '.join(str(item) for item in added_episodes)} "
                    f"برای {parsed.get('titleEn') or parsed.get('titleFa')}"
                )
            if is_new:
                new_count += 1
                status.log(f"➕ {parsed.get('titleEn')} — {episode_count(parsed)} قسمت")
                status.update(animeNew=int(status.data.get("animeNew") or 0) + 1)
            else:
                updated_count += 1
                status.log(f"♻️ به‌روزرسانی {parsed.get('titleEn')} — پست {message.id}")
                status.update(animeUpdated=int(status.data.get("animeUpdated") or 0) + 1)
            if anime_done % 5 == 0:
                save_state(state)
        if anime_done >= limit_anime:
            break
        await asyncio.sleep(0.12)

    state["lastScanId"] = max(max_id, int(state.get("lastScanId") or 0))
    save_state(state)
    status.update(postsDone=anime_done, scannedPosts=scanned, current=None)
    if anime_done < limit_anime:
        status.log(f"فقط {anime_done} پست آنیمه در کانال پیدا شد (درخواست: {limit_anime})", "warn")
    return anime_done, new_count, updated_count, changed_keys


async def ingest_new(client: Any, state: dict[str, Any], status: Any, limit_scan: int = 120) -> tuple[int, int, int, list[str]]:
    """Poll messages newer than lastScanId (watch mode)."""
    status.phase("watch-ingest")
    channel = await client.get_entity("aniplus")
    min_id = int(state.get("lastScanId") or 0)
    messages = []
    async for message in client.iter_messages(channel, min_id=min_id, limit=limit_scan):
        messages.append(message)
        check_stop()
    if not messages:
        return 0, 0, 0, []

    max_id = max(message.id for message in messages)
    status.update(postsTotal=0, postsDone=0, scannedPosts=len(messages), current=None)
    new_count = 0
    updated_count = 0
    changed_keys: list[str] = []
    anime_done = 0
    # Oldest first so newer posts win the merge.
    for message in sorted(messages, key=lambda m: m.id):
        parsed = parse_post(message.id, message.text or "", message.date, message.buttons)
        if not parsed:
            continue
        anime_done += 1
        status.update(
            postsDone=anime_done,
            postsTotal=anime_done,
            current={
                "key": f"post-{message.id}",
                "kind": "post",
                "postId": message.id,
                "title": parsed.get("titleEn") or parsed.get("titleMain"),
                "postUrl": f"https://t.me/aniplus/{message.id}",
            },
        )
        if str(message.id) in state.get("seen", {}):
            continue
        key, is_new, changed, added_episodes = merge_post(state, parsed)
        state["seen"][str(message.id)] = now_iso()
        if changed and key not in changed_keys:
            changed_keys.append(key)
        if added_episodes:
            queue_episode_event(state, key, parsed, added_episodes)
            status.log(
                f"🔔 اعلان قسمت {', '.join(str(item) for item in added_episodes)} "
                f"برای {parsed.get('titleEn') or parsed.get('titleFa')}"
            )
        if is_new:
            new_count += 1
            status.update(animeNew=int(status.data.get("animeNew") or 0) + 1)
            status.log(f"➕ پست جدید: {parsed.get('titleEn')} — {episode_count(parsed)} قسمت")
        else:
            updated_count += 1
            status.update(animeUpdated=int(status.data.get("animeUpdated") or 0) + 1)
            status.log(f"♻️ پست جدید برای {parsed.get('titleEn')}")
        await asyncio.sleep(0.12)

    state["lastScanId"] = max(max_id, int(state.get("lastScanId") or 0))
    save_state(state)
    status.update(current=None)
    return anime_done, new_count, updated_count, changed_keys


def rebuild_site(status: Any) -> bool:
    status.phase("rebuild")
    status.update(current=None)
    status.log("در حال ساخت مجدد سایت با محتوای جدید… (۳۰ تا ۹۰ ثانیه)")
    script = ROOT / "scripts" / "rebuild.sh"
    if not script.exists():
        status.log("اسکریپت rebuild.sh پیدا نشد", "error")
        return False
    try:
        result = subprocess.run(
            ["bash", str(script)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=900,
        )
    except subprocess.TimeoutExpired:
        status.log("ساخت سایت بیش از ۱۵ دقیقه طول کشید و متوقف شد", "error")
        return False
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "")[-1200:]
        status.log(f"ساخت سایت ناموفق بود:\n{tail}", "error")
        return False
    status.log("✅ سایت با محتوای جدید به‌روزرسانی شد")
    return True
