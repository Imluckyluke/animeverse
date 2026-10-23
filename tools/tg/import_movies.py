#!/usr/bin/env python3
"""One-off importer for feature films that are older than the watch window.

The regular ingest starts from the newest posts, so films published months ago
never reach the catalog. This script merges a small curated set of real AniPlus
film posts, normalises them to a single episode and marks them as ``فیلم`` so
the home page can show a proper cinema rail.
"""
from __future__ import annotations

import argparse
import asyncio

from telethon import TelegramClient
from telethon.sessions import StringSession

from catalog import write_catalog
from common import API_HASH, API_ID, now_iso, read_session, save_state, load_state
from ingest import merge_post, prepare_covers
from parse import parse_post

MOVIE_POST_IDS = [
    31607,  # Assassination Classroom the Movie
    31444,  # Boku no Kokoro no Yabai Yatsu Movie
    31050,  # Milky☆Subway movie
    31028,  # Zombieland Saga movie
    30615,  # InuYasha movie
    30614,  # Spirited Away
    30508,  # Jujutsu Kaisen: Hidden Inventory / Premature Death
    30501,  # Mary and the Witch's Flower
    30398,  # Boku to Roboko Movie
]

TITLE_OVERRIDES = {
    30398: {
        "titleEn": "Boku to Roboko Movie",
        "titleFa": "من و روبوکو",
        "titleOriginal": "僕とロボコ",
    },
    30501: {
        "titleEn": "Mary and the Witch's Flower",
        "titleFa": "مری و گل جادوگر",
        "titleOriginal": "メアリと魔女の花",
    },
    30508: {
        "titleFa": "جوجوتسو کایسن: دارایی مخفی / مرگ پیش از موعد",
    },
}


class QuietStatus:
    def phase(self, _phase: str) -> None:
        pass

    def update(self, **_values: object) -> None:
        pass

    def log(self, message: str, level: str = "info") -> None:
        print(f"[{level}] {message}", flush=True)


async def main(rebuild: bool) -> int:
    state = load_state()
    status = QuietStatus()
    client = TelegramClient(
        StringSession(read_session()),
        API_ID,
        API_HASH,
        connection_retries=5,
        request_retries=3,
        timeout=40,
    )
    await client.connect()
    if not await client.is_user_authorized():
        raise RuntimeError("Telegram session is not authorised")
    messages = await client.get_messages("aniplus", ids=MOVIE_POST_IDS)
    added = 0
    for message in messages:
        if message is None:
            continue
        parsed = parse_post(message.id, message.text or "", message.date, message.buttons)
        if not parsed:
            print(f"skip unparsable post {message.id}")
            continue
        qualities: dict[str, str] = {}
        for bucket in (parsed.get("episodes") or {}).values():
            qualities.update(bucket)
        if not qualities:
            print(f"skip post without qualities {message.id}")
            continue
        parsed["episodes"] = {"1": qualities}
        parsed["declaredEpisodes"] = 1
        parsed["type"] = "فیلم"
        parsed.update(TITLE_OVERRIDES.get(message.id, {}))
        key, is_new, changed, _ = merge_post(state, parsed)
        state.setdefault("seen", {})[str(message.id)] = now_iso()
        if changed:
            anime = state["anime"][key]
            anime["type"] = "فیلم"
            anime["declaredEpisodes"] = 1
        if is_new:
            added += 1
        print(
            f"{'added' if is_new else 'updated'} {message.id} "
            f"{parsed.get('titleEn')} / {parsed.get('titleFa')}"
        )
    save_state(state)
    await prepare_covers(state, status)
    catalog, links = write_catalog(state)
    print(f"catalog={len(catalog)} links={len(links)} new_movies={added}")
    await client.disconnect()

    if rebuild:
        from ingest import rebuild_site

        if not rebuild_site(status):
            return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rebuild", action="store_true")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.rebuild)))
