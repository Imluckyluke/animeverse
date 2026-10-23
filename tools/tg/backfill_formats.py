#!/usr/bin/env python3
"""Backfill AniPlus' raw format (ONA/TV/OVA...) for existing catalog entries.

The format is saved with every new post by ``parse.parse_post``. Older state
entries were ingested before that field existed, so read their latest post once
and persist the format without touching episodes or queue URLs.
"""
from __future__ import annotations

import asyncio
import re

from telethon import TelegramClient
from telethon.sessions import StringSession

from catalog import write_catalog
from common import API_HASH, API_ID, load_state, read_session, save_state
from parse import _format

TYPE_RE = re.compile(r"نوع\s*[:：]\s*([^\n]+)")


async def main() -> int:
    state = load_state()
    rows = []
    for anime in (state.get("anime") or {}).values():
        post_id = int(anime.get("lastPostId") or 0)
        if post_id:
            rows.append((anime, post_id))
    if not rows:
        return 0

    client = TelegramClient(
        StringSession(read_session()),
        API_ID,
        API_HASH,
        receive_updates=False,
        connection_retries=3,
        request_retries=2,
        timeout=40,
    )
    await client.connect()
    try:
        messages = await client.get_messages("aniplus", ids=[pid for _, pid in rows])
        by_id = {message.id: message for message in messages if message is not None}
        updated = 0
        for anime, post_id in rows:
            message = by_id.get(post_id)
            if message is None:
                continue
            match = TYPE_RE.search(message.text or "")
            if not match:
                continue
            value = _format(match.group(1))
            if not value:
                continue
            if anime.get("format") != value:
                anime["format"] = value
                updated += 1
            print(f"{anime.get('titleEn') or anime.get('slug')}: {value}")
        if updated:
            save_state(state)
        catalog, links = write_catalog(state)
        print(f"formats updated={updated} catalog={len(catalog)} links={len(links)}")
    finally:
        await client.disconnect()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
