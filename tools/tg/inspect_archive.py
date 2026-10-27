"""Read-only channel counts; never prints credentials or invite links."""
import asyncio
import json
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import CheckChatInviteRequest
from telethon.tl.types import InputMessagesFilterDocument
from common import API_ID, API_HASH, ARCHIVE_INVITE, SOURCE_CHANNEL, DEST_CHANNEL, read_session


async def main():
    client = TelegramClient(StringSession(read_session()), API_ID, API_HASH, flood_sleep_threshold=0)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram account is not authorised")
        archive = getattr(await client(CheckChatInviteRequest(ARCHIVE_INVITE)), "chat", None)
        if archive is None:
            raise RuntimeError("Archive membership unavailable")
        report = {}
        for name, entity in [("sky", archive), ("aniplus", SOURCE_CHANNEL), ("destination", DEST_CHANNEL)]:
            entity = await client.get_entity(entity)
            documents = await client.get_messages(entity, limit=0, filter=InputMessagesFilterDocument)
            latest = await client.get_messages(entity, limit=1)
            report[name] = {"documents": documents.total, "latestMessage": latest[0].id if latest else 0}
        print(json.dumps(report))
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
