"""Resolve AniPlusMiniBot deep links into public @testanivers file links.

Flow: MiniBot /start -> EndBot link -> join sponsor channels -> verify ->
receive document -> forward immediately to @testanivers -> save public link.
"""
from __future__ import annotations

import asyncio
import contextlib
import random
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from telethon import TelegramClient, events, errors
from telethon.tl.functions.account import GetNotifySettingsRequest, UpdateNotifySettingsRequest
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import (
    CheckChatInviteRequest,
    ImportChatInviteRequest,
)
from telethon.tl.types import InputNotifyPeer, InputPeerNotifySettings

from common import (
    ARCHIVE_COPY_DELAY,
    ARCHIVE_INVITE,
    ARCHIVE_SEARCH_DELAY,
    ARCHIVE_SEARCH_LIMIT,
    DEST_CHANNEL,
    DEST_USERNAME,
    DOC_TIMEOUT,
    FA2EN,
    FLOOD_COOLDOWN,
    LINK_COOLDOWN,
    LINK_COOLDOWN_EVERY,
    LINK_DELAY,
    LINK_JITTER,
    MAX_ATTEMPTS,
    MINIBOT_WAIT_PATH,
    STEP_TIMEOUT,
    atomic_write_json,
    check_stop,
    effective_flood_wait,
    now_iso,
    quality_key,
    save_state,
    start_param,
)

INVITE_RE = re.compile(r"(?:https?://)?(?:t(?:elegram)?\.me|telegram\.dog)/(?:joinchat/|\+)([A-Za-z0-9_-]{8,})")
PUBLIC_RE = re.compile(r"(?:https?://)?(?:t(?:elegram)?\.me|telegram\.dog)/([A-Za-z][A-Za-z0-9_]{3,31})(?:\?[^\s]*)?")
ENDBOT_RE = re.compile(r"(?:https?://)?(?:t(?:elegram)?\.me|telegram\.dog)/AniPlusEndBot\?start=([A-Za-z0-9_-]+)")

# Telegram clients use a date in the far future for "mute forever".
MUTE_UNTIL = datetime(2037, 12, 31, tzinfo=timezone.utc)
MINIBOT_PAUSED = "__minibot_paused__"


class MiniBotFlood(RuntimeError):
    """MiniBot asked us to stop; pause only the MiniBot lane."""


def _button_rows(message: Any) -> list[list[Any]]:
    if not message.buttons:
        return []
    rows = message.buttons if isinstance(message.buttons, list) else message.buttons.rows
    out = []
    for row in rows:
        out.append(row.buttons if hasattr(row, "buttons") else row)
    return out


def _button_url(button: Any) -> str:
    return str(getattr(button, "url", "") or "")


def _button_data(button: Any) -> bytes | None:
    return getattr(button, "data", None)


def find_endbot_url(message: Any) -> str:
    for row in _button_rows(message):
        for button in row:
            url = _button_url(button)
            if "AniPlusEndBot" in url and "start=" in url:
                return url
    match = ENDBOT_RE.search(message.raw_text or "")
    return match.group(0) if match else ""


def endbot_token(url: str) -> str:
    match = re.search(r"start=([A-Za-z0-9_-]+)", url or "")
    return match.group(1) if match else ""


def _invites_from(message: Any) -> list[str]:
    found: list[str] = []
    for row in _button_rows(message):
        for button in row:
            url = _button_url(button)
            if url and "AniPlus" not in url:
                found.append(url)
    text = message.raw_text or ""
    found.extend(re.findall(r"https?://t\.me/(?:\+|joinchat/)[^\s)]+", text))
    out: list[str] = []
    for url in found:
        if "AniPlusMiniBot" in url or "AniPlusEndBot" in url or DEST_USERNAME in url:
            continue
        if INVITE_RE.search(url) or PUBLIC_RE.search(url):
            if url not in out:
                out.append(url)
    return out


def find_callback(message: Any) -> bytes | None:
    candidates: list[bytes] = []
    for row in _button_rows(message):
        for button in row:
            data = _button_data(button)
            if not data:
                continue
            text = str(getattr(button, "text", "") or "")
            if any(word in text for word in ("بررسی", "عضو", "تأیید", "تایید", "ادامه", "دریافت")):
                return data
            candidates.append(data)
    return candidates[0] if candidates else None


def is_document(message: Any) -> bool:
    return bool(getattr(message, "document", None)) and not getattr(message, "photo", None)


def _norm_text(value: str) -> str:
    text = (value or "").lower().replace("\u200c", " ").replace("\u200f", " ")
    # Apostrophes are removed without inserting a space: "Eye's" and "Eyes"
    # should normalise to the same token.
    text = text.replace("'", "").replace("’", "")
    # Strip every punctuation mark, not just a hand-picked subset. Archive
    # titles contain ?, !, quotes, stars, etc., and a leftover "?" made the
    # token "kokurasetai?" fail to match "kokurasetai".
    text = re.sub(r"[^\w\u0600-\u06FF]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def _title_tokens(*titles: str) -> list[str]:
    stop = {
        "the", "a", "an", "of", "and", "to", "in", "on", "for", "with",
        "movie", "film", "part", "season", "ova", "tv", "special", "the movie",
        # Japanese particles and filler words are very common in romanized
        # titles. Keeping them made unrelated long titles share two "tokens"
        # and caused false archive matches.
        "no", "wa", "ga", "ni", "wo", "de", "mo", "ka", "na", "shi",
        "ru", "suru", "yo", "ne", "ha", "he", "o", "u", "ni", "e",
    }
    tokens: list[str] = []
    for title in titles:
        for token in _norm_text(title).split():
            if len(token) < 2 or token in stop or token.isdigit():
                continue
            if re.fullmatch(r"\d+(?:st|nd|rd|th)", token):
                continue
            if re.fullmatch(r"[spe]\d+", token):
                continue
            if re.fullmatch(r"ep(?:isode)?\d+", token):
                continue
            if re.fullmatch(r"part\d+", token):
                continue
            if token in {"ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"}:
                continue
            if token not in tokens:
                tokens.append(token)
    return tokens


def _season_part(text: str) -> tuple[int | None, int | None]:
    """Read the season/part number from a title or archive file name.

    Archive files often use ``S2`` while the site title says ``Season 2``.
    Matching without this check lets a Season 3 entry receive a Season 2 file.
    """
    value = (text or "").translate(FA2EN)
    season: int | None = None
    part: int | None = None
    patterns = (
        r"\bseason\s*0*(\d{1,2})\b",
        r"\bs\s*0*(\d{1,2})\b",
        r"\b(\d{1,2})(?:st|nd|rd|th)\s+season\b",
        r"\bفصل\s*0*(\d{1,2})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, value, re.IGNORECASE)
        if match:
            candidate = int(match.group(1))
            # A title such as "86 2nd Season" can put "86" immediately after
            # the word "Season" when title fields are concatenated. No real
            # anime has 86 seasons; ignore absurd values and keep searching.
            if 1 <= candidate <= 20:
                season = candidate
                break
    for pattern in (
        r"\bpart\s*0*(\d{1,2})\b",
        r"\bبخش\s*0*(\d{1,2})\b",
    ):
        match = re.search(pattern, value, re.IGNORECASE)
        if match:
            candidate = int(match.group(1))
            if 1 <= candidate <= 20:
                part = candidate
                break
    return season, part


def _season_compatible(anime: dict[str, Any], text: str) -> bool:
    title_season, title_part = _season_part(
        f"{anime.get('titleEn') or ''} {anime.get('titleOriginal') or ''}"
    )
    candidate_season, candidate_part = _season_part(text)
    # Never copy a file explicitly marked as another season. Some archive
    # files omit the season tag while still belonging to the current one
    # (for example "Ao Ashi - 01"), so only reject when both sides name a
    # season and the numbers differ.
    if (
        title_season is not None
        and candidate_season is not None
        and candidate_season != title_season
    ):
        return False
    if title_season is None and candidate_season is not None:
        return False
    if (
        title_part is not None
        and candidate_part is not None
        and candidate_part != title_part
    ):
        return False
    return True


def _quality_of(text: str) -> tuple[str, bool, bool]:
    low = _norm_text(text)
    if "2160" in low or "4k" in low or "uhd" in low:
        base = "2160p"
    elif "1440" in low:
        base = "1440p"
    elif "1080" in low:
        base = "1080p"
    elif "720" in low:
        base = "720p"
    elif "480" in low:
        base = "480p"
    else:
        base = ""
    return base, "x265" in low or "hevc" in low, "هاردساب" in low or "hardsub" in low


def _requested_quality(label: str) -> tuple[str, bool, bool]:
    return _quality_of(label)


def _has_episode(text: str, episode: int) -> bool:
    quality = r"(?:2160p?|1440p?|1080p?|720p?|480p?|4k|uhd)"
    patterns = (
        rf"(?:-|–|—|_)\s*0*{episode}\s*(?:\[|\()?\s*{quality}",
        rf"\bep(?:isode)?\s*0*{episode}\b",
        rf"\bE0*{episode}\b",
        rf"قسمت\s*0*{episode}\b",
    )
    return any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)


class ArchiveResolver:
    """Find an episode in the private archive and copy the exact quality.

    Search is cached per anime/episode, so four qualities of one episode only
    cost one or two Telegram search calls. If a quality is absent, the caller
    falls back to MiniBot for that link.
    """

    def __init__(self, client: TelegramClient, entity: Any, flow: Any) -> None:
        self.client = client
        self.entity = entity
        self.flow = flow
        self.cache: dict[tuple[str, int], list[Any]] = {}

    async def _collect(self, query: str) -> list[Any]:
        async def run() -> list[Any]:
            found: list[Any] = []
            async for message in self.client.iter_messages(
                self.entity,
                search=query,
                limit=ARCHIVE_SEARCH_LIMIT,
            ):
                check_stop()
                if is_document(message):
                    found.append(message)
            return found

        return await self.flow.tg(run, f"archive search: {query[:40]}")

    async def _messages_for(self, anime: dict[str, Any], episode: int) -> list[Any]:
        key = (str(anime.get("key") or anime.get("slug") or ""), episode)
        if key in self.cache:
            return self.cache[key]
        titles = [
            anime.get("titleEn") or "",
            anime.get("titleOriginal") or "",
        ]
        queries: list[str] = []
        number = f"{episode:02d}" if episode < 100 else str(episode)
        # Movies and one-episode specials often have no episode token in the
        # archive filename at all ("Spirited Away [1080p].mkv"). Search by
        # title alone for those, otherwise the episode-number query can hide a
        # file that is actually present.
        single = (
            str(anime.get("type") or "") == "فیلم"
            or str(anime.get("format") or "").upper() == "MOVIE"
            or int(anime.get("declaredEpisodes") or 0) == 1
        )
        numbers = [""] if single else [number]
        if not single and str(episode) != number:
            numbers.append(str(episode))
        for title in titles:
            title = (title or "").strip()
            if not title:
                continue
            variants = [title]
            short = re.split(r"\s*[:：]\s*", title, maxsplit=1)[0].strip()
            if short and short not in variants:
                variants.append(short)
            # Archive files often write "Season 3" as "S3". Try both forms.
            compact = re.sub(
                r"\bSeason\s+(\d{1,2})\b",
                r"S\1",
                title,
                flags=re.IGNORECASE,
            )
            if compact != title and compact not in variants:
                variants.append(compact)
            stripped = re.sub(
                r"\b(?:Season|Part)\s+\d+\b|\b\d+(?:st|nd|rd|th)\s+Season\b",
                "",
                title,
                flags=re.IGNORECASE,
            )
            stripped = re.sub(r"\s{2,}", " ", stripped).strip(" -:：")
            if stripped and stripped not in variants:
                variants.append(stripped)
            for variant in variants:
                for number_form in numbers:
                    query = f"{variant} {number_form}".strip()
                    if query not in queries:
                        queries.append(query)
        found: list[Any] = []
        seen: set[int] = set()
        for query in queries[:6]:
            try:
                messages = await self._collect(query)
            except Exception as exc:
                self.flow.status.log(
                    f"⚠️ جست‌وجوی آرشیو ناموفق ({type(exc).__name__}): {str(exc)[:100]}",
                    "warn",
                )
                continue
            for message in messages:
                text = (
                    f"{message.raw_text or ''}\n"
                    f"{getattr(getattr(message, 'file', None), 'name', '') or ''}"
                )
                if not _season_compatible(anime, text):
                    continue
                if message.id not in seen:
                    seen.add(message.id)
                    found.append(message)
            # A full-title query normally returns every quality of the episode.
            # Stop here instead of spending many search calls on one episode;
            # only try shorter title variants when the first query was empty.
            if found:
                break
            await self.flow._sleep(ARCHIVE_SEARCH_DELAY)
        self.cache[key] = found
        return found

    def _score(self, item: dict[str, Any], anime: dict[str, Any], message: Any) -> float | None:
        episode = int(item.get("episode") or 1)
        file_name = getattr(getattr(message, "file", None), "name", "") or ""
        text = f"{message.raw_text or ''}\n{file_name}"
        if not _season_compatible(anime, text):
            return None
        single = (
            str(anime.get("type") or "") == "فیلم"
            or str(anime.get("format") or "").upper() == "MOVIE"
            or int(anime.get("declaredEpisodes") or 0) == 1
        )
        if not single and not _has_episode(text, episode):
            return None
        requested_base, requested_x265, requested_hardsub = _requested_quality(
            str(item.get("quality") or "")
        )
        base, x265, hardsub = _quality_of(text)
        if not requested_base or base != requested_base:
            return None
        if x265 != requested_x265:
            return None
        if requested_hardsub and not hardsub:
            return None

        tokens = _title_tokens(
            anime.get("titleEn") or "",
            anime.get("titleOriginal") or "",
        )
        haystack = _norm_text(text)
        hits = sum(1 for token in tokens if token in haystack)
        if not tokens:
            return 0.5
        if len(tokens) > 1 and hits < 2:
            return None
        ratio = hits / len(tokens)
        if ratio < 0.3:
            return None
        return ratio

    async def find(self, item: dict[str, Any]) -> Any | None:
        anime = (self.flow.state.get("anime") or {}).get(item.get("animeKey") or "") or {}
        if not anime:
            return None
        episode = int(item.get("episode") or 1)
        key = (str(anime.get("key") or anime.get("slug") or ""), episode)
        messages = await self._messages_for(anime, episode)
        scored: list[tuple[float, int, Any]] = []
        for message in messages:
            score = self._score(item, anime, message)
            if score is not None:
                scored.append((score, int(message.id), message))
        if not scored:
            return None
        scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return scored[0][2]

    async def copy(self, message: Any, item: dict[str, Any]) -> dict[str, Any]:
        result = await self.flow.copy_document(message, item, "آرشیو")
        await self.flow._sleep(ARCHIVE_COPY_DELAY)
        return result


async def load_archive(client: TelegramClient, flow: Any) -> ArchiveResolver | None:
    """Resolve the private archive invite once; join only if necessary."""
    if not ARCHIVE_INVITE:
        return None
    try:
        info = await flow.tg(
            lambda: client(CheckChatInviteRequest(ARCHIVE_INVITE)),
            "archive invite",
        )
        chat = getattr(info, "chat", None)
        if chat is None:
            result = await flow.tg(
                lambda: client(ImportChatInviteRequest(ARCHIVE_INVITE)),
                "join archive",
            )
            chats = getattr(result, "chats", None) or []
            chat = chats[0] if chats else None
        if chat is None:
            raise RuntimeError("archive chat not available")
        entity = chat
        with contextlib.suppress(Exception):
            entity = await client.get_entity(chat.id)
        title = getattr(entity, "title", "") or "آرشیو"
        flow.status.log(f"🗂 آرشیو آماده است: {title}")
        return ArchiveResolver(client, entity, flow)
    except Exception as exc:
        flow.status.log(
            f"⚠️ آرشیو در دسترس نیست ({type(exc).__name__}): {str(exc)[:140]} — فقط MiniBot",
            "warn",
        )
        return None


class BotFlow:
    def __init__(
        self,
        client: TelegramClient,
        mini: Any,
        end: Any,
        dest: Any,
        state: dict[str, Any],
        status: Any,
    ) -> None:
        self.client = client
        self.mini = mini
        self.end = end
        self.dest = dest
        self.state = state
        self.status = status
        self.archive: "ArchiveResolver | None" = None
        self.minibot_blocked_until = 0.0
        self.queue: asyncio.Queue[Any] = asyncio.Queue()
        self.bot_ids = {int(mini.id), int(end.id)}
        client.add_event_handler(self._on_message, events.NewMessage(from_users=list(self.bot_ids)))
        client.add_event_handler(self._on_message, events.MessageEdited(from_users=list(self.bot_ids)))

    async def _on_message(self, event: Any) -> None:
        message = event.message
        sender = getattr(message, "sender_id", None) or getattr(message, "chat_id", None)
        if sender in self.bot_ids:
            await self.queue.put(message)

    def drain(self) -> None:
        while not self.queue.empty():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()

    async def _sleep(self, seconds: float) -> None:
        end = time.monotonic() + max(0.1, seconds)
        while time.monotonic() < end:
            check_stop()
            await asyncio.sleep(min(1.0, end - time.monotonic()))

    async def next_message(self, timeout: float) -> Any | None:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            check_stop()
            try:
                return await asyncio.wait_for(self.queue.get(), timeout=min(5.0, end - time.monotonic()))
            except asyncio.TimeoutError:
                continue
        return None

    async def tg(
        self,
        factory: Callable[[], Any],
        label: str,
        *,
        pause_on_flood: bool = False,
    ) -> Any:
        for attempt in range(4):
            check_stop()
            try:
                return await factory()
            except errors.FloodWaitError as exc:
                requested = int(getattr(exc, "seconds", 30)) + 2
                seconds = effective_flood_wait(requested)
                if pause_on_flood:
                    # MiniBot's anti-spam block must not freeze archive copies.
                    # Record the full wait, pause just this lane, and let the
                    # resolver keep serving files from the archive.
                    self.minibot_blocked_until = time.monotonic() + seconds
                    self.status.flood(seconds, label, requested)
                    with contextlib.suppress(Exception):
                        atomic_write_json(
                            MINIBOT_WAIT_PATH,
                            {
                                "until": (
                                    datetime.now(timezone.utc)
                                    + timedelta(seconds=seconds)
                                ).isoformat(),
                                "reason": label,
                                "requestedSec": requested,
                            },
                        )
                    raise MiniBotFlood(label)
                # Never retry early. Telegram's own wait can be hours; during
                # that time the queue is asleep and no API request is made.
                self.status.flood(seconds, label, requested)
                await self._sleep(seconds)
                self.status.clear_flood()
                if FLOOD_COOLDOWN:
                    self.status.log(
                        f"✅ محدودیت تمام شد؛ {FLOOD_COOLDOWN} ثانیه استراحت قبل از ادامه",
                        "info",
                    )
                    await self._sleep(FLOOD_COOLDOWN)
            except (errors.ServerError, errors.TimedOutError, asyncio.TimeoutError, ConnectionError, OSError) as exc:
                self.status.log(f"⚠️ خطای شبکه در {label}: {type(exc).__name__}", "warn")
                await self._sleep(3 + attempt * 2)
        raise RuntimeError(f"Telegram call failed: {label}")

    @staticmethod
    def _muted(settings: Any) -> bool:
        until = getattr(settings, "mute_until", None)
        if isinstance(until, (int, float)):
            until = datetime.fromtimestamp(until, tz=timezone.utc)
        if not isinstance(until, datetime):
            return False
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return until > datetime.now(timezone.utc)

    async def ensure_muted(self, entity: Any, label: str) -> bool:
        """Mute a joined channel/group only when its notifications are still on."""
        try:
            input_peer = await self.tg(lambda: self.client.get_input_entity(entity), "mute peer")
            peer = InputNotifyPeer(peer=input_peer)
            current = await self.tg(
                lambda: self.client(GetNotifySettingsRequest(peer=peer)),
                "mute check",
            )
            if self._muted(current):
                return False
            await self.tg(
                lambda: self.client(
                    UpdateNotifySettingsRequest(
                        peer=peer,
                        settings=InputPeerNotifySettings(mute_until=MUTE_UNTIL),
                    )
                ),
                "mute channel",
            )
            self.status.log(f"🔕 اعلان‌های {label or 'کانال'} بی‌صدا شد")
            return True
        except Exception as exc:
            self.status.log(
                f"⚠️ بی‌صدا کردن {label or 'کانال'} ناموفق: {type(exc).__name__}",
                "warn",
            )
            return False

    async def mute_known_sponsors(self) -> None:
        """Mute sponsor channels joined by earlier worker revisions, without touching other dialogs."""
        muted = 0
        sponsors = self.state.get("sponsors") or {}
        for key, meta in sponsors.items():
            try:
                if key.startswith("@"):
                    entity = await self.tg(
                        lambda username=key[1:]: self.client.get_entity(username),
                        "mute sponsor",
                    )
                else:
                    invite = await self.tg(
                        lambda invite_key=key: self.client(CheckChatInviteRequest(invite_key)),
                        "mute sponsor",
                    )
                    entity = getattr(invite, "chat", None)
                if entity is None:
                    continue
                stored_title = meta.get("title") if isinstance(meta, dict) else ""
                label = getattr(entity, "title", "") or stored_title or key
                if await self.ensure_muted(entity, label):
                    muted += 1
                await self._sleep(0.2)
            except Exception as exc:
                self.status.log(f"⚠️ بررسی میوت {key} ناموفق: {type(exc).__name__}", "warn")
        if muted:
            self.status.log(f"🔕 {muted} کانال اسپانسر بی‌صدا شد")

    async def join(self, url: str, force: bool = False) -> None:
        invite = INVITE_RE.search(url)
        if invite:
            key = invite.group(1)
            if key in self.state.get("sponsors", {}) and not force:
                return
            try:
                result = await self.tg(lambda: self.client(ImportChatInviteRequest(key)), "join")
                chats = getattr(result, "chats", None) or []
                title = getattr(chats[0], "title", "") if chats else ""
                self.state.setdefault("sponsors", {})[key] = {
                    "joinedAt": now_iso(),
                    "title": title,
                    "url": url,
                }
                self.status.log(f"✅ عضویت در اسپانسر: {title or key}")
                if chats:
                    await self.ensure_muted(chats[0], title or key)
                await self._sleep(1.5)
            except errors.UserAlreadyParticipantError:
                self.state.setdefault("sponsors", {})[key] = {
                    "joinedAt": now_iso(),
                    "title": "",
                    "url": url,
                }
                with contextlib.suppress(Exception):
                    invite_info = await self.tg(
                        lambda invite_key=key: self.client(CheckChatInviteRequest(invite_key)),
                        "mute sponsor",
                    )
                    channel = getattr(invite_info, "chat", None)
                    if channel is not None:
                        await self.ensure_muted(channel, getattr(channel, "title", "") or key)
            except errors.InviteRequestSentError:
                self.status.log("⏳ درخواست عضویت در اسپانسر ارسال شد (نیاز به تأیید)", "warn")
            except (errors.InviteHashExpiredError, errors.InviteHashInvalidError):
                self.status.log(f"لینک دعوت اسپانسر منقضی شد: {key}", "warn")
            except Exception as exc:
                self.status.log(f"⚠️ عضویت ناموفق ({type(exc).__name__}): {str(exc)[:120]}", "warn")
            return

        public = PUBLIC_RE.search(url)
        if public:
            username = public.group(1)
            if username in {"AniPlusMiniBot", "AniPlusEndBot", DEST_USERNAME, "joinchat", "s"}:
                return
            key = f"@{username.lower()}"
            if key in self.state.get("sponsors", {}) and not force:
                return
            title = username
            try:
                entity = await self.tg(lambda: self.client.get_entity(username), "resolve sponsor")
                if getattr(entity, "bot", False):
                    return
                title = getattr(entity, "title", "") or username
                try:
                    await self.tg(lambda: self.client(JoinChannelRequest(entity)), "join public")
                    self.state.setdefault("sponsors", {})[key] = {
                        "joinedAt": now_iso(),
                        "title": title,
                        "url": url,
                    }
                    self.status.log(f"✅ عضویت در اسپانسر: {title}")
                except errors.UserAlreadyParticipantError:
                    self.state.setdefault("sponsors", {})[key] = {
                        "joinedAt": now_iso(),
                        "title": title,
                        "url": url,
                    }
                await self.ensure_muted(entity, title)
                await self._sleep(1.5)
            except Exception as exc:
                self.status.log(f"⚠️ عضویت عمومی ناموفق ({type(exc).__name__}): {str(exc)[:120]}", "warn")

    @staticmethod
    def caption(item: dict[str, Any]) -> str:
        episode = int(item.get("episode") or 1)
        quality = item.get("quality") or ""
        # AniPlus occasionally prefixes a display title with markup such as
        # "نام فارسی :". Keep the destination caption clean even when the
        # source post (and therefore the legacy queue item) still has it.
        title = str(item.get("title") or "انیمه")
        title = re.sub(r"^\s*نام\s*فارسی\s*[:：]\s*", "", title)
        title = re.sub(r"format\([^)]*\)", "", title, flags=re.IGNORECASE)
        title = re.sub(r"\*\*", "", title)
        title = re.sub(r"\s+", " ", title).strip() or "انیمه"
        return f"{title} — قسمت {episode} — {quality}\nزیرنویس فارسی | انیمه‌ورس"

    async def copy_document(
        self,
        document_message: Any,
        item: dict[str, Any],
        source: str,
    ) -> dict[str, Any]:
        """Copy a document into the destination without a forward header."""
        self.status.log(f"📥 فایل از {source} رسید — کپی به @testanivers")
        caption = self.caption(item)

        async def send() -> Any:
            return await self.client.send_file(
                self.dest,
                file=document_message.document,
                caption=caption,
                force_document=True,
                supports_streaming=True,
            )

        try:
            sent = await self.tg(send, f"copy {source}")
        except errors.FileReferenceExpiredError:
            # Archive hits can sit in the search cache for a few minutes.
            # Refresh the source message once instead of downloading the file.
            refreshed = await self.tg(
                lambda: self.client.get_messages(
                    document_message.chat_id or document_message.peer_id,
                    ids=document_message.id,
                ),
                f"refetch {source}",
            )
            if refreshed is None:
                raise
            sent = await self.tg(
                lambda: self.client.send_file(
                    self.dest,
                    file=refreshed.document,
                    caption=caption,
                    force_document=True,
                    supports_streaming=True,
                ),
                f"copy {source} retry",
            )
        if sent is None or not getattr(sent, "id", None):
            raise RuntimeError("copied but destination message id was not found")
        size = getattr(getattr(document_message, "file", None), "size", None)
        return {
            "url": f"https://t.me/{DEST_USERNAME}/{int(sent.id)}",
            "messageId": int(sent.id),
            "size": size,
            "via": "archive" if source == "آرشیو" else "minibot",
        }

    async def forward(self, document_message: Any, item: dict[str, Any]) -> dict[str, Any]:
        return await self.copy_document(document_message, item, "MiniBot")

    async def resolve_one(self, item: dict[str, Any]) -> tuple[bool, Any]:
        payload = start_param(item.get("deepLink") or "")
        if not payload:
            return False, "لینک ربات نامعتبر است"
        self.drain()
        self.status.log(
            f"🎬 {item.get('title')} — قسمت {item.get('episode')} — {item.get('quality')}"
        )

        if self.archive is not None:
            try:
                archived = await self.archive.find(item)
                if archived is not None:
                    result = await self.archive.copy(archived, item)
                    return True, result
            except errors.FloodWaitError:
                raise
            except Exception as exc:
                self.status.log(
                    f"⚠️ استفاده از آرشیو ناموفق ({type(exc).__name__}): {str(exc)[:120]} — MiniBot",
                    "warn",
                )

        if self.minibot_blocked_until > time.monotonic():
            return False, MINIBOT_PAUSED
        try:
            await self.tg(
                lambda: self.client.send_message(self.mini, f"/start {payload}"),
                "MiniBot start",
                pause_on_flood=True,
            )
        except MiniBotFlood:
            return False, MINIBOT_PAUSED

        end_url = ""
        deadline = time.monotonic() + STEP_TIMEOUT
        while time.monotonic() < deadline:
            message = await self.next_message(min(6.0, deadline - time.monotonic()))
            if message is None:
                continue
            if (getattr(message, "sender_id", None) or message.chat_id) != int(self.mini.id):
                continue
            end_url = find_endbot_url(message)
            if end_url:
                break
            text = (message.raw_text or "").strip()
            if text and any(word in text for word in ("منقضی", "یافت نشد", "نامعتبر", "خطا")):
                return False, text[:180]
        if not end_url:
            return False, "پاسخ ربات میانی دریافت نشد (لینک ربات نهایی)"

        token = endbot_token(end_url)
        if not token:
            return False, "توکن ربات نهایی نامعتبر است"
        await self.tg(lambda: self.client.send_message(self.end, f"/start {token}"), "EndBot start")

        document = None
        rounds = 0
        deadline = time.monotonic() + DOC_TIMEOUT
        while time.monotonic() < deadline:
            message = await self.next_message(min(10.0, deadline - time.monotonic()))
            if message is None:
                continue
            sender = getattr(message, "sender_id", None) or message.chat_id
            if sender != int(self.end.id):
                continue
            if is_document(message):
                document = message
                break
            invites = _invites_from(message)
            callback = find_callback(message)
            if invites or callback:
                rounds += 1
                if rounds > 5:
                    return False, "مرحله تأیید اسپانسرها به پایان نرسید"
                for url in invites:
                    await self.join(url, force=rounds > 2)
                if callback:
                    try:
                        answer = await self.tg(
                            lambda: message.click(data=callback),
                            "verify callback",
                        )
                        alert = getattr(answer, "message", None)
                        if alert:
                            self.status.log(f"پاسخ بررسی عضویت: {str(alert)[:140]}")
                    except errors.MessageNotModifiedError:
                        pass
                    except Exception as exc:
                        self.status.log(f"⚠️ کلیک تأیید ناموفق: {type(exc).__name__} — {str(exc)[:140]}", "warn")
                await self._sleep(2)
            else:
                text = (message.raw_text or "").strip()
                if text:
                    self.status.log(f"ربات: {text[:150]}")
        if not document:
            return False, "فایل در زمان مقرر دریافت نشد"
        try:
            result = await self.forward(document, item)
        except errors.ChatForwardsRestrictedError:
            return False, "کپی فایل توسط ربات محدود شده است"
        except Exception as exc:
            return False, f"فوروارد ناموفق: {type(exc).__name__} — {str(exc)[:160]}"
        return True, result


def current_items(state: dict[str, Any]) -> list[dict[str, Any]]:
    queue = state.get("queue") or {}
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for anime in (state.get("anime") or {}).values():
        for episode, qualities in (anime.get("episodes") or {}).items():
            for label, deep_link in qualities.items():
                queued = queue.get(deep_link)
                if not queued or deep_link in seen:
                    continue
                seen.add(deep_link)
                items.append(queued)
    return items


def _sort_items(state: dict[str, Any], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    anime_by_key = state.get("anime") or {}

    def key(item: dict[str, Any]) -> tuple:
        anime = anime_by_key.get(item.get("animeKey") or "") or {}
        return (
            -int(anime.get("lastPostId") or 0),
            int(item.get("episode") or 0),
            quality_key(item.get("quality") or ""),
        )

    return sorted(items, key=key)


async def resolve_all(flow: BotFlow, state: dict[str, Any], status: Any, retry_failed: bool = False, max_links: int | None = None) -> tuple[int, int]:
    all_items = current_items(state)
    if retry_failed:
        for item in all_items:
            if item.get("status") == "failed":
                item["status"] = "pending"
                item["attempts"] = 0
                item["lastError"] = ""
    done_now = sum(1 for item in all_items if item.get("status") == "done")
    failed_now = sum(1 for item in all_items if item.get("status") == "failed")
    work = [
        item
        for item in all_items
        if item.get("status") == "pending" and int(item.get("attempts") or 0) < MAX_ATTEMPTS
    ]
    work = _sort_items(state, work)
    total = len(all_items)
    known_links = {
        item.get("deepLink")
        for item in all_items
        if item.get("deepLink")
    }
    status.update(
        phase="resolve",
        state="running",
        linksTotal=total,
        linksDone=done_now,
        linksFailed=failed_now,
        linksPending=total - done_now - failed_now,
        avgSecPerLink=0,
        etaSec=None,
    )
    status.log(
        f"آماده‌سازی {len(work)} لینک از {total} لینک (کیفیت‌ها به‌ترتیب 1080p، 720p، 480p، x265)"
    )
    if not work:
        status.update(current=None, etaSec=0)
        return 0, 0

    resolved = 0
    failed = 0
    processed = 0
    minibot_calls = 0
    started = time.monotonic()
    retries: list[dict[str, Any]] = []
    # Links that missed the archive while MiniBot is in a FloodWait. They stay
    # here until the full requested wait expires; meanwhile the loop can still
    # copy newer archive matches instead of freezing the whole worker.
    blocked: list[dict[str, Any]] = []
    pause_logged = False
    delay_base = max(1.0, LINK_DELAY)
    jitter = max(0.0, LINK_JITTER)

    while work or retries or blocked:
        # A watch poll can append links for a newly published episode while we
        # are working through the backlog. Pick those up at the front so the
        # newest episode is not stuck behind hundreds of older links.
        fresh: list[dict[str, Any]] = []
        for candidate in current_items(state):
            deep_link = candidate.get("deepLink")
            if not deep_link or deep_link in known_links:
                continue
            known_links.add(deep_link)
            if (
                candidate.get("status") == "pending"
                and int(candidate.get("attempts") or 0) < MAX_ATTEMPTS
            ):
                fresh.append(candidate)
        if fresh:
            fresh = _sort_items(state, fresh)
            work = fresh + work
            total += len(fresh)
            status.update(linksTotal=total)
            status.log(f"➕ {len(fresh)} لینک تازه به صف پردازش اضافه شد")

        if not work:
            if blocked:
                remaining = flow.minibot_blocked_until - time.monotonic()
                if remaining > 0:
                    if not pause_logged:
                        pause_logged = True
                        status.log(
                            f"⏸ MiniBot در محدودیت است؛ {max(1, (int(remaining) + 59) // 60)} دقیقه "
                            "بدون هیچ درخواستی صبر می‌کنیم و آرشیو همچنان فعال است",
                            "warn",
                        )
                    await flow._sleep(min(remaining, 30))
                    continue
                work = blocked
                blocked = []
                flow.minibot_blocked_until = 0
                status.clear_flood()
                pause_logged = False
                status.log("✅ محدودیت MiniBot تمام شد؛ پردازش موارد باقی‌مانده", "info")
                await flow._sleep(FLOOD_COOLDOWN)
                continue
            if not retries:
                break
            retries.sort(key=lambda item: item.get("_retry_at", 0))
            wait = max(0.0, retries[0].get("_retry_at", 0) - time.monotonic())
            if wait > 0:
                status.log(f"⏳ تلاش مجدد برای لینک‌های ناموفق تا {int(wait)} ثانیه دیگر")
                await flow._sleep(wait)
            work = [item for item in retries if item.get("_retry_at", 0) <= time.monotonic()]
            retries = [item for item in retries if item not in work]
            if not work:
                continue

        item = work.pop(0)
        check_stop()
        # A newer post may have replaced a queued link, or the same file may
        # have been resolved elsewhere while this item was waiting.
        if item.get("status") != "pending":
            continue
        status.update(
            current={
                "key": f"link-{item.get('deepLink')}",
                "kind": "link",
                "title": item.get("title"),
                "slug": item.get("slug"),
                "animeId": item.get("animeId"),
                "episode": item.get("episode"),
                "quality": item.get("quality"),
                "postId": item.get("postId"),
                "deepLink": item.get("deepLink"),
                "attempt": int(item.get("attempts") or 0) + 1,
            }
        )
        try:
            ok, result = await flow.resolve_one(item)
        except errors.FloodWaitError as exc:
            # `flow.tg` normally consumes FloodWaitError. This is a last-resort
            # guard; wait the full requested duration rather than retrying in
            # a loop and extending the block.
            requested = int(getattr(exc, "seconds", 60)) + 2
            status.flood(effective_flood_wait(requested), "unhandled flood", requested)
            await flow._sleep(effective_flood_wait(requested))
            status.clear_flood()
            ok, result = False, "محدودیت تلگرام"
        except Exception as exc:
            ok, result = False, f"{type(exc).__name__}: {str(exc)[:180]}"

        if not ok and result == MINIBOT_PAUSED:
            # Archive was checked. Do not count this as a failed link and do
            # not touch MiniBot until its full FloodWait has elapsed.
            item["lastError"] = "در انتظار پایان محدودیت MiniBot"
            item["lastAttemptAt"] = now_iso()
            blocked.append(item)
            status.update(current=None)
            save_state(state)
            continue

        item["attempts"] = int(item.get("attempts") or 0) + 1
        item["lastAttemptAt"] = now_iso()
        processed += 1

        via = result.get("via") if ok and isinstance(result, dict) else ""
        if ok and isinstance(result, dict):
            item.update(
                status="done",
                url=result.get("url"),
                messageId=result.get("messageId"),
                size=result.get("size"),
                resolvedAt=now_iso(),
                lastError="",
            )
            resolved += 1
            status.update(
                linksDone=done_now + resolved,
                lastError="",
            )
            status.log(f"✅ {result.get('url')} — {item.get('quality')}")
            save_state(state)
            try:
                from catalog import build_links
                from common import LINKS_PATH, atomic_write_json

                atomic_write_json(LINKS_PATH, build_links(state))
            except Exception as exc:
                status.log(f"⚠️ ذخیره فایل لینک‌ها ناموفق: {exc}", "warn")
        else:
            item["lastError"] = str(result)[:300]
            if item["attempts"] >= MAX_ATTEMPTS:
                item["status"] = "failed"
                failed += 1
                status.update(linksFailed=failed_now + failed)
                status.log(f"❌ {item.get('title')} — {item.get('quality')}: {str(result)[:160]}", "error")
            else:
                item["status"] = "pending"
                item["_retry_at"] = time.monotonic() + 75 * item["attempts"]
                retries.append(item)
                status.log(
                    f"⚠️ تلاش {item['attempts']}/{MAX_ATTEMPTS} ناموفق: {str(result)[:120]} — بعداً دوباره",
                    "warn",
                )
            save_state(state)

        elapsed = max(0.1, time.monotonic() - started)
        avg = elapsed / max(1, processed)
        remaining = max(0, total - done_now - failed_now - resolved - failed)
        status.update(
            avgSecPerLink=round(avg, 1),
            etaSec=int(avg * (remaining + len(retries))) if remaining else 0,
            linksPending=max(0, remaining),
        )
        if max_links is not None and processed >= max_links:
            status.log(f"برای تست، بعد از {processed} لینک متوقف شد")
            break

        if via == "archive":
            # The copy itself already includes ARCHIVE_COPY_DELAY. Archive
            # copies do not need the long MiniBot safety gap.
            sleep_for = 1.2 + random.uniform(0, max(0.0, jitter / 4))
        else:
            if via == "minibot":
                minibot_calls += 1
            sleep_for = delay_base + random.uniform(0, jitter)
            if LINK_COOLDOWN_EVERY > 0 and minibot_calls % LINK_COOLDOWN_EVERY == 0:
                sleep_for += LINK_COOLDOWN
                status.log(f"☕ استراحت {LINK_COOLDOWN} ثانیه‌ای برای جلوگیری از محدودیت تلگرام")
        status.update(current=None)
        await flow._sleep(sleep_for)

    status.update(current=None)
    status.log(f"پایان این مرحله: {resolved} لینک جدید، {failed} ناموفق")
    save_state(state)
    return resolved, failed
