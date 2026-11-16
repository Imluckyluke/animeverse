"""Bounded MiniBot fallback owned by the sole archive pipeline process.

Bot conversations use the pipeline's client. Only the pipeline publishes results;
receipts, exact document IDs and send random IDs survive a restart. No video is
downloaded to disk, no existing ready link or accepted cache request is replaced.
"""
import asyncio
import contextlib
import datetime as dt
import hashlib
import json
import re
import time

from telethon import errors, utils
from telethon.tl.functions.messages import SendMediaRequest
from telethon.tl.functions.messages import CheckChatInviteRequest, ImportChatInviteRequest
from telethon.tl.functions.channels import GetParticipantRequest, JoinChannelRequest, LeaveChannelRequest
from telethon.tl.functions.account import UpdateNotifySettingsRequest
from telethon.tl.types import InputMediaDocument, InputChannel, InputPeerChannel, InputNotifyPeer, InputPeerNotifySettings

from archive_file_review import reviewed_queue_allowed
from archive_identity import canonical_query, normalized, safe_episode_record, safe_movie_record, safe_special_record
from backfill import parse_archive_fields, _season_compatible_record
from common import DATA, DEST_USERNAME, FA2EN, MINIBOT_WAIT_PATH, atomic_write_json, now_iso, read_json, start_param
from resolver import BotFlow, INVITE_RE, PUBLIC_RE, MUTE_UNTIL, _button_rows, _button_data, _button_url, _quality_of


class BotHeld(RuntimeError):
    pass


class BotWait(RuntimeError):
    pass


def create_schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS bot_requests(
        deep_link TEXT PRIMARY KEY,anime_key TEXT NOT NULL,payload TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
        retry_at REAL NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',
        record TEXT,document_id TEXT,source_message_id INTEGER,source_bot_id INTEGER,
        random_id INTEGER,destination_id INTEGER,received_at TEXT,copied_at TEXT);
      CREATE INDEX IF NOT EXISTS bot_request_pending ON bot_requests(state,retry_at);
      CREATE TABLE IF NOT EXISTS bot_import_sources(deep_link TEXT PRIMARY KEY,import_id TEXT NOT NULL,priority_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_live_sources(deep_link TEXT PRIMARY KEY,anime_key TEXT NOT NULL,post_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bot_sponsor_receipts(deep_link TEXT PRIMARY KEY,snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS archive_anime_key ON files(anime_key);
    ''')
    db.commit()


def _truncated_filename_title(filename_title: str, caption_title: str) -> bool:
    """The source bot cuts long filenames; a prefix alone is not a different title.

    Only a meaningful prefix of the already-certified caption title is accepted.
    A shorter or contradictory title (other season/part, generic first word)
    still fails closed.
    """
    short = normalized(filename_title)
    full = normalized(caption_title)
    return bool(short) and len(short) >= 8 and full.startswith(short) and short != full


def document_record(anime, item, message):
    """Filename/caption agreement and exact title/episode/codec, never fuzzy."""
    name = getattr(getattr(message, 'file', None), 'name', '') or ''
    caption = getattr(message, 'raw_text', '') or ''
    # Observed EndBot layout puts quality before episode after "Ep:". Match
    # that complete layout explicitly, never interpret 720 as an episode or
    # replace an arbitrary contradictory caption with filename metadata.
    structured = re.fullmatch(
        r'\s*\[@AniPlus\]\s*([^\n]+)\n\s*Ep:\s*((?:2160|1440|1080|720|480)p(?:\s+(?:x265|HEVC|هاردساب|hardsub))*)\s+(\d{1,4})\s*',
        caption.translate(FA2EN), re.I)
    parse_caption = (f'{structured[1].strip()} - {int(structured[3])} [{structured[2]}]'
                     if structured else caption)
    filename = parse_archive_fields(name, '', int(message.id))
    record = parse_archive_fields(name, parse_caption, int(message.id)) or (dict(filename) if filename else None)
    if not record or not filename or not reviewed_queue_allowed(anime, item):
        return None
    record['caption'] = caption
    allowed = {normalized(canonical_query(anime.get(field))) for field in ('titleEn', 'titleOriginal') if anime.get(field)}
    if normalized(canonical_query(record['title'])) not in allowed:
        return None
    if (normalized(canonical_query(filename['title'])) not in allowed
            and not _truncated_filename_title(filename['title'], record['title'])):
        return None
    requested = _quality_of(item.get('quality') or '')
    episode = item.get('episode')
    if isinstance(episode, bool) or not isinstance(episode, int) or episode < 1:
        return None
    for evidence in (record, filename):
        if not _season_compatible_record(anime, evidence['title'], evidence):
            return None
        actual = _quality_of(evidence['quality'])
        if not requested[0] or requested[:2] != actual[:2] or (requested[2] and not actual[2]):
            return None
        if anime.get('format') == 'MOVIE' or anime.get('type') == 'فیلم':
            if episode != 1 or not safe_movie_record(evidence):
                return None
        elif anime.get('format') in {'OVA', 'SPECIAL'}:
            if not safe_special_record(evidence, anime.get('declaredEpisodes')) or (evidence.get('episode') or 1) != episode:
                return None
        elif not safe_episode_record(evidence) or evidence.get('episode') != episode:
            return None
    declared = anime.get('declaredEpisodes')
    if isinstance(declared, int) and declared > 0 and episode > declared:
        return None
    years = {int(value) for value in re.findall(r'\b(?:19|20)\d{2}\b', name)}
    if years and years != {anime.get('year')}:
        return None
    record['size'] = getattr(message.file, 'size', None)
    return record


def wait_seconds(text):
    value = str(text or '').translate(FA2EN)
    if not re.search(r'صبر|محدود|wait|retry|flood|try again', value, re.I):
        return None
    units = {'ثانیه': 1, 'دقیقه': 60, 'ساعت': 3600, 'روز': 86400,
             'second': 1, 'minute': 60, 'hour': 3600, 'day': 86400}
    values = [int(match[1]) * units[match[2].lower().rstrip('s')] for match in re.finditer(
        r'(\d+)\s*(ثانیه|دقیقه|ساعت|روز|seconds?|minutes?|hours?|days?)\b', value, re.I)]
    return sum(values) + 5 if values else None


def participant_is_member(participant):
    return type(participant).__name__ in {
        'ChannelParticipant', 'ChannelParticipantSelf', 'ChannelParticipantAdmin', 'ChannelParticipantCreator',
    } and not getattr(participant, 'left', False)


def sponsor_key(url):
    private, public = INVITE_RE.search(url), PUBLIC_RE.search(url)
    return private[1] if private else '@' + public[1].lower() if public else ''


class GuardedFlow(BotFlow):
    def __init__(self, lane, mini, end):
        self.lane = lane
        self.boundaries = {}
        self.seen = set()
        self.failure = None
        self.last_stage = 'idle'
        self.verified_sponsors = set()
        self.current_sponsors = set()
        self.required_sponsors = None
        self.self_peer = None
        super().__init__(lane.pipeline.client, mini, end, lane.pipeline.dest, lane.pipeline.state, lane)

    async def prepare(self):
        self.drain()
        self.seen.clear()
        self.failure = None
        self.verified_sponsors.clear()
        self.current_sponsors.clear()
        self.required_sponsors = None
        for peer in (self.mini, self.end):
            messages = await self.tg(lambda peer=peer: self.client.get_messages(peer, limit=1), 'bot boundary')
            self.boundaries[int(peer.id)] = messages[0].id if messages else 0

    async def _on_message(self, event):
        message = event.message
        sender = getattr(message, 'sender_id', None) or getattr(message, 'chat_id', None)
        if sender not in self.bot_ids or message.out or message.id <= self.boundaries.get(sender, 2 ** 63):
            return
        signature = (sender, message.id,
                     hashlib.sha256((message.raw_text or '').encode()).hexdigest(),
                     str(getattr(getattr(message, 'document', None), 'id', '')),
                     tuple((_button_data(button), _button_url(button)) for row in _button_rows(message) for button in row))
        if signature in self.seen:
            return
        self.seen.add(signature)
        if message.document and sender == int(self.end.id) and self.lane.active_deep:
            self.lane.record_receipt(message, self.lane.active_deep)
        self.lane.trace('bot-message', sender='minibot' if sender == int(self.mini.id) else 'endbot',
                        messageId=message.id, text=message.raw_text,
                        buttonLabels=[getattr(button, 'text', '') for row in _button_rows(message) for button in row],
                        hasDocument=bool(message.document),
                        filename=getattr(getattr(message, 'file', None), 'name', None) if message.document else None)
        if not message.document:
            seconds = wait_seconds(message.raw_text)
            rate_notice = bool(re.search(r'محدود|بیش\s*از\s*حد|مجاز\s*(?:نیست|نمی)|too many|rate.?limit|flood|retry|try again later', message.raw_text or '', re.I))
            if seconds and (rate_notice or seconds > 100):
                self.lane.peer_wait(seconds, 'bot-response-wait')
                self.failure = BotWait('bot-response-wait')
            elif rate_notice and not seconds:
                self.failure = BotHeld('unquantified-bot-limit')
        await self.queue.put(message)

    async def next_message(self, timeout):
        if self.failure:
            raise self.failure
        message = await super().next_message(timeout)
        if self.failure:
            raise self.failure
        return message

    async def tg(self, factory, label, **_kwargs):
        self.last_stage = label
        if not self.lane.pipeline.running:
            raise asyncio.CancelledError()
        if self.lane.global_until() > time.time() or float(self.lane.get('minibot_peer_until')) > time.time():
            raise BotWait('persisted-telegram-wait')
        try:
            result = await factory()
            if label == 'verify callback':
                self.lane.trace('verification-answer', text=getattr(result, 'message', '') or '',
                                alert=bool(getattr(result, 'alert', False)), hasUrl=bool(getattr(result, 'url', None)))
                if self.verified_sponsors and re.search(r'ابتدا[^\n]*عضو|عضو\s*نیستید', getattr(result, 'message', '') or ''):
                    self.failure = BotHeld('provider-membership-check-rejected')
                    raise self.failure
            if label == 'MiniBot start':
                sent = int(self.lane.get('minibot_starts_sent')) + 1
                self.lane.put('minibot_starts_sent', sent)
                self.lane.put('minibot_next_at', time.time() + (300 if sent % 10 == 0 else 75))
            return result
        except errors.FloodWaitError as error:
            self.lane.account_wait(int(error.seconds) + 5, label)
            self.failure = BotWait('telegram-flood-wait')
            raise self.failure from None
        except errors.ChatForwardsRestrictedError:
            self.failure = BotHeld('source-protected-content')
            raise self.failure from None

    async def _sleep(self, seconds):
        if self.failure:
            raise self.failure
        if not self.lane.pipeline.running:
            raise asyncio.CancelledError()
        await asyncio.sleep(seconds)

    def callback_for(self, message):
        safe = re.compile(r'بررسی|عضو\s*شدم|تأیید|تایید|دریافت\s*فایل|verify|joined|check\s*membership|get\s*file', re.I)
        for row in _button_rows(message):
            for button in row:
                label = str(getattr(button, 'text', '') or '')
                data = _button_data(button)
                if data and safe.search(label) and not re.search(r'پرداخت|خرید|password|login|pay|buy', label, re.I):
                    return data
        if any(_button_data(button) for row in _button_rows(message) for button in row):
            raise BotHeld('unrecognized-bot-action')
        return None

    def sponsors_for(self, message):
        sender = getattr(message, 'sender_id', None) or getattr(message, 'chat_id', None)
        if sender != int(self.end.id):
            return []
        links = []
        for row in _button_rows(message):
            for button in row:
                url = _button_url(button)
                if re.search(r'عضویت|\bjoin\b', str(getattr(button, 'text', '') or ''), re.I) and re.fullmatch(
                        r'https://(?:t\.me|telegram\.me)/(?:\+[A-Za-z0-9_-]+|joinchat/[A-Za-z0-9_-]+|[A-Za-z][A-Za-z0-9_]{3,31})/?', url):
                    links.append(url)
        if len(set(links)) > 6:
            raise BotHeld('unexpected-sponsor-count')
        self.current_sponsors = set(links)
        # An ordinary advertisement/document is not evidence of an empty list.
        if links:
            self.required_sponsors = sorted({sponsor_key(url) for url in links})
            self.lane.put('minibot_sponsors_observed', {'keys': self.required_sponsors, 'at': time.time()})
        return list(dict.fromkeys(links))

    async def join_sponsor(self, key, factory):
        now = time.time()
        joins = [entry for entry in self.lane.get('minibot_sponsor_joins', []) if entry['at'] > now - 86400]
        if len(joins) >= 12:
            self.lane.peer_wait(max(0, min(entry['at'] for entry in joins) + 86400 - now) + 5, 'sponsor-join-safety-budget')
            raise BotWait('sponsor-join-safety-budget')
        delay = float(self.lane.get('minibot_last_join_at')) + 10 - now
        if delay > 0:
            await self._sleep(delay)
        self.lane.put('minibot_last_join_at', time.time())
        try:
            result = await self.tg(factory, 'join currently required sponsor')
        except errors.UserAlreadyParticipantError:
            return False, None
        except errors.InviteRequestSentError:
            raise BotHeld('sponsor-membership-pending-approval') from None
        except errors.ChannelsTooMuchError:
            raise BotHeld('account-channel-limit') from None
        joins.append({'keySha256': hashlib.sha256(key.encode()).hexdigest(), 'at': time.time()})
        self.lane.put('minibot_sponsor_joins', joins)
        await self._sleep(2)
        return True, result

    def protected_sponsor(self, entity):
        protected = {getattr(getattr(self.lane.pipeline, name, None), 'id', None)
                     for name in ('dest', 'aniplus', 'sky')}
        return (getattr(entity, 'id', None) in protected
                or getattr(entity, 'creator', False) or bool(getattr(entity, 'admin_rights', None))
                or str(getattr(entity, 'username', '') or '').lower() in
                   {'aniplus', 'aniplusminibot', 'aniplusendbot', DEST_USERNAME.lower()})

    def remember_sponsor(self, key, entity, joined=False, verified=False):
        # Never infer ownership from old sponsors[]: legacy revisions also wrote
        # those records for UserAlreadyParticipant. Only our successful join owns it.
        ident, access = getattr(entity, 'id', None), getattr(entity, 'access_hash', None)
        if not isinstance(ident, int) or not isinstance(access, int):
            return
        records = self.lane.get('minibot_sponsor_memberships', {})
        meta = records.setdefault(str(ident), {'aliases': [], 'owned': False})
        meta['aliases'] = sorted(set(meta['aliases']) | {key})
        meta['accessHash'] = access
        if joined:
            meta.update(owned=True, joinedAt=time.time(), leftAt=None, mutedAt=None, verifiedAt=None)
        if verified:
            meta['verifiedAt'] = time.time()
        self.lane.put('minibot_sponsor_memberships', records)

    async def mute_sponsor(self, key, entity):
        if self.protected_sponsor(entity):
            return
        self.remember_sponsor(key, entity)
        records = self.lane.get('minibot_sponsor_memberships', {})
        meta = records.get(str(getattr(entity, 'id', None)))
        if not meta or meta.get('mutedAt'):
            return
        peer = InputPeerChannel(int(entity.id), int(entity.access_hash))
        await self.tg(lambda: self.client(UpdateNotifySettingsRequest(
            peer=InputNotifyPeer(peer), settings=InputPeerNotifySettings(mute_until=MUTE_UNTIL))), 'mute required sponsor')
        meta['mutedAt'] = time.time()
        self.lane.put('minibot_sponsor_memberships', records)

    def sponsor_snapshot(self):
        observed = self.lane.get('minibot_sponsors_observed', None)
        if observed is None:
            return None
        records = self.lane.get('minibot_sponsor_memberships', {})
        peers = set()
        for key in observed['keys']:
            matches = [ident for ident, meta in records.items()
                       if key in meta['aliases'] and not meta.get('leftAt') and meta.get('verifiedAt')]
            if len(matches) != 1:
                return None
            peers.add(int(matches[0]))
        return {**observed, 'peerIds': sorted(peers), 'successAt': time.time()}

    async def join(self, url, force=False):
        private, public = INVITE_RE.search(url), PUBLIC_RE.search(url)
        key = private[1] if private else '@' + public[1].lower() if public else ''
        approved = self.lane.get('minibot_approved_sponsors', [])
        dynamic = bool(self.lane.get('minibot_dynamic_sponsors_approved', False)) and url in self.current_sponsors
        registry = self.lane.get('minibot_sponsor_memberships', {})
        known = bool(key and (key in self.state.get('sponsors', {}) or key in approved or dynamic
                             or any(key in meta['aliases'] and meta.get('owned') for meta in registry.values())))
        self.lane.trace('sponsor-membership-check', known=known, privateInvite=bool(private),
                        publicUsername=public[1] if public and not private else '')
        if private:
            invite = await self.tg(lambda: self.client(CheckChatInviteRequest(private[1])), 'check sponsor membership')
            chat = getattr(invite, 'chat', None)
            # An accessible invite/chat is not proof of current membership.
            # Verify the exact logged-in account through GetParticipant('me').
            if chat is not None and await self.actual_membership(chat):
                self.verified_sponsors.add(key)
                self.remember_sponsor(key, chat, verified=True)
                await self.mute_sponsor(key, chat)
                return
            if known:
                joined, _result = await self.join_sponsor(key, lambda: self.client(ImportChatInviteRequest(private[1])))
                refreshed = await self.tg(lambda: self.client(CheckChatInviteRequest(private[1])), 'verify sponsor join')
                chat = getattr(refreshed, 'chat', None)
                if chat is not None and await self.actual_membership(chat):
                    self.verified_sponsors.add(key)
                    self.remember_sponsor(key, chat, joined=joined, verified=True)
                    await self.mute_sponsor(key, chat)
                    return
                raise BotHeld('sponsor-membership-pending-approval')
        elif public:
            entity = await self.tg(lambda: self.client.get_entity(public[1]), 'resolve sponsor membership')
            if getattr(entity, 'bot', False) or not getattr(entity, 'broadcast', False):
                raise BotHeld('unsupported-sponsor-action')
            if await self.actual_membership(entity):
                self.verified_sponsors.add(key)
                self.remember_sponsor(key, entity, verified=True)
                await self.mute_sponsor(key, entity)
                return
            if known:
                joined, _result = await self.join_sponsor(key, lambda: self.client(JoinChannelRequest(entity)))
                self.remember_sponsor(key, entity, joined=joined)
                await self.mute_sponsor(key, entity)
                if await self.actual_membership(entity):
                    self.verified_sponsors.add(key)
                    self.remember_sponsor(key, entity, verified=True)
                    return
                raise BotHeld('sponsor-membership-pending-approval')
        # New account memberships still need explicit or current-list approval.
        raise BotHeld('new-sponsor-membership-required')

    async def actual_membership(self, entity, ordinary_only=False):
        if self.self_peer is None:
            self.self_peer = await self.tg(lambda: self.client.get_me(input_peer=True), 'resolve exact session account')
        try:
            result = await self.tg(lambda: self.client(GetParticipantRequest(entity, self.self_peer)), 'verify actual self membership')
        except errors.UserNotParticipantError:
            return False
        return (participant_is_member(result.participant)
                and result.participant.user_id == self.self_peer.user_id
                and (not ordinary_only or type(result.participant).__name__ in
                     {'ChannelParticipant', 'ChannelParticipantSelf'}))

    async def copy_document(self, message, item, source):
        return await self.lane.copy_verified(message, item)


class BotLane:
    def __init__(self, pipeline):
        self.pipeline, self.db = pipeline, pipeline.db
        self.flow = None
        self.task = None
        self.active_deep = None
        self.last_sync = 0.0
        self.last_sponsor_maintenance = 0.0
        self.trace_events = []
        if self.get('minibot_live_after_post', None) is None:
            latest = max((int(anime.get('lastPostId') or 0) for anime in pipeline.state.get('anime', {}).values()), default=0)
            self.put('minibot_live_after_post', latest + 1)
        self.apply_live_policy_request()

    def new_posts_only(self):
        return (self.get('minibot_live_policy', {}) or {}).get('mode') == 'new-posts-only'

    def apply_live_policy_request(self):
        """Sole-writer cutover; retain requests, accepted files and rate waits."""
        request = read_json(DATA / 'minibot-live-policy-request.json', {}) or {}
        if not isinstance(request, dict) or request.get('version') != 1 or request.get('mode') != 'new-posts-only':
            return
        floor, cursor = self.get('minibot_live_after_post', 0), self.get('ani_live', 0)
        if (request.get('expectedLiveAfterPost') != floor or request.get('expectedCursor') != cursor
                or type(request.get('firstPostId')) is not int or request['firstPostId'] != cursor + 1
                or request['firstPostId'] < floor):
            return
        try:
            since = dt.datetime.fromisoformat(request['since'])
            if since.tzinfo is None or not 0 < since.timestamp() <= time.time():
                return
        except (KeyError, TypeError, ValueError):
            return
        policy = {'mode': 'new-posts-only', 'since': since.isoformat(),
                  'firstPostId': request['firstPostId'], 'activatedAt': now_iso()}
        with self.db:
            for key, value in [('minibot_live_after_post', request['firstPostId']), ('minibot_live_policy', policy)]:
                self.db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, json.dumps(value)))
            self.sync_live_sources()

    def start_is_live(self, deep):
        floor = int(self.get('minibot_live_after_post', 0))
        return bool(self.db.execute('''SELECT 1 FROM bot_requests r
            LEFT JOIN bot_import_sources i ON i.deep_link=r.deep_link
            LEFT JOIN bot_live_sources l ON l.deep_link=r.deep_link AND l.anime_key=r.anime_key AND l.post_id>=?
            WHERE r.deep_link=? AND (i.deep_link IS NOT NULL OR l.deep_link IS NOT NULL
              OR (?=0 AND CAST(json_extract(r.payload,'$.postId') AS INTEGER)>=?))''',
            (floor, deep, int(self.new_posts_only()), floor)).fetchone())

    def trace(self, event, **values):
        def redact(value):
            if isinstance(value, str):
                value = re.sub(r'https?://\S+', '<link>', value)
                return re.sub(r'\b[A-Za-z0-9_-]{24,}\b', '<opaque-value>', value)[:1000]
            if isinstance(value, list):
                return [redact(item) for item in value[:20]]
            return value
        self.trace_events.append({'at': now_iso(), 'event': event, **{key: redact(value) for key, value in values.items()}})
        self.trace_events = self.trace_events[-30:]
        atomic_write_json(DATA / 'minibot-protocol-trace.json', {'events': self.trace_events})

    def get(self, key, default=0):
        row = self.db.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO settings VALUES(?,?)', (key, json.dumps(value)))
        self.db.commit()

    def global_until(self):
        return float(self.get('telegram_flood_until'))

    def peer_until(self):
        return max(float(self.get('minibot_peer_until')), float(self.get('minibot_next_at')))

    def peer_wait(self, seconds, reason):
        until = time.time() + max(0, seconds)
        self.put('minibot_peer_until', max(until, float(self.get('minibot_peer_until'))))
        atomic_write_json(MINIBOT_WAIT_PATH, {'until': dt.datetime.fromtimestamp(until, dt.timezone.utc).isoformat(),
            'reason': 'MiniBot ' + reason, 'requestedSec': seconds})

    def account_wait(self, seconds, reason):
        self.put('telegram_flood_until', max(time.time() + seconds, self.global_until()))
        self.pipeline.status['floodWaitUntil'] = self.global_until()
        self.peer_wait(seconds, reason)

    def log(self, message, level='info'):
        # Bot advertisements, private invites and arbitrary bot response text are
        # not copied into logs. Durable reason codes carry operational evidence.
        self.pipeline.status.setdefault('botDownloads', {})['lastActivityAt'] = now_iso()
        if str(message).startswith(('پاسخ بررسی عضویت:', 'ربات:')):
            self.trace('protocol-note', text=str(message))

    def update(self, **values):
        self.pipeline.status.setdefault('botDownloads', {}).update(values)

    def eligible(self, deep, item, anime):
        if not start_param(deep) or not re.fullmatch(r'https://t\.me/AniPlusMiniBot\?start=get_[0-9A-Za-z_]+', deep):
            return False
        return (item.get('status') in {'pending', 'failed'} and anime.get('archiveFileReview') is None
                and bool(_quality_of(item.get('quality') or '')[0]))

    def sync_requests(self):
        from admin_catalog import read_overrides
        hidden = {slug for slug, value in read_overrides(DATA.parent).items() if value['patch'].get('hidden')}
        for key, anime in self.pipeline.state.get('anime', {}).items():
            if anime.get('slug') in hidden:
                continue
            for number, qualities in anime.get('episodes', {}).items():
                for quality, deep in qualities.items():
                    item = self.pipeline.state.get('queue', {}).get(deep, {})
                    if not self.eligible(deep, item, anime):
                        continue
                    payload = {**item, 'deepLink': deep, 'animeKey': key, 'episode': int(number), 'quality': quality,
                               'postId': item.get('postId') or 0}
                    self.db.execute('INSERT OR IGNORE INTO bot_requests(deep_link,anime_key,payload) VALUES(?,?,?)',
                                    (deep, key, json.dumps(payload, ensure_ascii=False)))
        self.sync_live_sources()
        self.db.commit()

    def sync_live_sources(self):
        """A repost is live evidence only for the exact links it actually contains.

        INSERT OR IGNORE preserves receipt identities but also preserves an old
        request's original postId. Do not let that hide episodes explicitly
        repeated in a new live post, nor promote unrelated backlog on the page.
        Rebuild from current parsed sources so edited-away links lose this grant.
        """
        from backfill import group_key
        from season_identity import conflicts, page_markers
        live_after = int(self.get('minibot_live_after_post', 0))
        self.db.execute('DELETE FROM bot_live_sources')
        for row in self.db.execute('SELECT id,payload FROM posts WHERE id>=? AND matched=1', (live_after,)).fetchall():
            parsed = json.loads(row['payload'])
            if self.new_posts_only():
                try:
                    posted = dt.datetime.fromisoformat(parsed['date'])
                    since = dt.datetime.fromisoformat(self.get('minibot_live_policy')['since'])
                    if posted.tzinfo is None or posted < since:
                        continue
                except (KeyError, TypeError, ValueError):
                    continue
            key = group_key(parsed)
            anime = self.pipeline.state.get('anime', {}).get(key) or {}
            if row['id'] not in anime.get('postIds', []) or conflicts(page_markers(anime), page_markers(parsed)):
                continue
            allowed = {normalized(canonical_query(anime.get(field))) for field in ('titleEn', 'titleOriginal') if anime.get(field)}
            titles = {normalized(canonical_query(parsed.get(field))) for field in ('titleEn', 'titleOriginal') if parsed.get(field)}
            if not (allowed & titles):
                continue
            for number, qualities in parsed.get('episodes', {}).items():
                current = anime.get('episodes', {}).get(str(number), {})
                for quality, deep in qualities.items():
                    if current.get(quality) != deep:
                        continue
                    self.db.execute('''INSERT INTO bot_live_sources VALUES(?,?,?) ON CONFLICT(deep_link)
                        DO UPDATE SET post_id=MAX(post_id,excluded.post_id)
                        WHERE anime_key=excluded.anime_key''', (deep, key, row['id']))

    def still_needed(self, row):
        item = json.loads(row['payload'])
        anime = self.pipeline.state.get('anime', {}).get(row['anime_key']) or {}
        current = self.pipeline.state.get('queue', {}).get(row['deep_link']) or {}
        if not self.eligible(row['deep_link'], current, anime):
            return False
        return anime.get('episodes', {}).get(str(item['episode']), {}).get(item['quality']) == row['deep_link']

    def archive_available(self, row):
        from types import SimpleNamespace
        item = json.loads(row['payload'])
        anime = self.pipeline.state['anime'][row['anime_key']]
        for candidate in self.db.execute('SELECT record,state FROM files WHERE anime_key=?', (row['anime_key'],)):
            record = json.loads(candidate['record'])
            if record.get('episode') != item['episode'] or _quality_of(record.get('quality') or '')[:2] != _quality_of(item['quality'])[:2]:
                continue
            message = SimpleNamespace(id=record.get('id'), file=SimpleNamespace(name=record.get('name'), size=record.get('size')),
                                      raw_text=record.get('caption') or '')
            if candidate['state'] in {'copied', 'pending'} and document_record(anime, item, message) is not None:
                return True
        return False

    async def initialize(self):
        mini = await self.pipeline.tg(lambda: self.pipeline.client.get_entity('AniPlusMiniBot'))
        end = await self.pipeline.tg(lambda: self.pipeline.client.get_entity('AniPlusEndBot'))
        if not (mini.bot and end.bot and mini.username.casefold() == 'aniplusminibot' and end.username.casefold() == 'aniplusendbot'):
            raise BotHeld('unexpected-bot-identity')
        self.flow = GuardedFlow(self, mini, end)
        previous = read_json(MINIBOT_WAIT_PATH, {}) or {}
        try:
            until = dt.datetime.fromisoformat(str(previous['until']).replace('Z', '+00:00')).timestamp()
            if until > time.time():
                self.put('minibot_peer_until', max(until, float(self.get('minibot_peer_until'))))
        except (KeyError, ValueError, TypeError):
            pass

    def record_receipt(self, message, deep):
        previous = self.db.execute('SELECT source_message_id,source_bot_id,received_at FROM bot_requests WHERE deep_link=?', (deep,)).fetchone()
        received = (previous['received_at'] if previous and previous['source_message_id'] == message.id
                    and previous['source_bot_id'] == int(message.chat_id) else None) or now_iso()
        record = {'id': message.id, 'name': getattr(message.file, 'name', None),
                  'size': getattr(message.file, 'size', None), 'caption': message.raw_text or '',
                  'telegramSentAt': message.date.isoformat(),
                  'protectedContent': bool(getattr(message, 'noforwards', False)
                                           or getattr(getattr(message, 'chat', None), 'noforwards', False))}
        self.db.execute('UPDATE bot_requests SET received_at=?,source_message_id=?,source_bot_id=?,document_id=?,record=? WHERE deep_link=?',
                        (received, message.id, int(message.chat_id), str(message.document.id), json.dumps(record, ensure_ascii=False), deep))
        self.db.commit()

    async def copy_verified(self, message, item):
        self.record_receipt(message, item['deepLink'])
        if getattr(message, 'noforwards', False) or getattr(getattr(message, 'chat', None), 'noforwards', False):
            self.flow.failure = BotHeld('source-protected-content')
            raise self.flow.failure
        anime = self.pipeline.state['anime'][item['animeKey']]
        record = document_record(anime, item, message)
        if record is None:
            self.flow.failure = BotHeld('document-identity-or-quality-mismatch')
            raise self.flow.failure
        doc_id = str(message.document.id)
        rid = int.from_bytes(hashlib.sha256(('minibot-v1:' + item['deepLink'] + ':' + doc_id).encode()).digest()[:8], 'big') & ((1 << 63) - 1) or 1
        self.db.execute('UPDATE bot_requests SET state=?,record=?,document_id=?,source_message_id=?,source_bot_id=?,random_id=? WHERE deep_link=?',
            ('forwarding', json.dumps(record, ensure_ascii=False), doc_id, message.id, int(message.chat_id), rid, item['deepLink']))
        self.db.commit()
        existing = self.db.execute('SELECT message_id FROM destination WHERE document_id=?', (doc_id,)).fetchone()
        destination_id = existing[0] if existing else None
        if not destination_id:
            result = await self.flow.tg(lambda: self.pipeline.client(SendMediaRequest(peer=self.pipeline.dest,
                media=InputMediaDocument(utils.get_input_document(message.document)), message=self.flow.caption(item),
                random_id=rid, silent=True)), 'copy verified bot document')
            for update in getattr(result, 'updates', []):
                sent = getattr(update, 'message', None)
                if sent and getattr(sent, 'document', None) and str(sent.document.id) == doc_id:
                    destination_id = sent.id
                if getattr(update, 'random_id', None) == rid:
                    destination_id = update.id
        if not destination_id:
            raise RuntimeError('copy-acknowledgement-pending-reconciliation')
        confirmed = await self.flow.tg(lambda: self.pipeline.client.get_messages(self.pipeline.dest, ids=int(destination_id)),
                                       'verify copied bot document')
        if (not confirmed or not getattr(confirmed, 'document', None)
                or str(confirmed.document.id) != doc_id
                or getattr(confirmed.file, 'size', None) != record['size']):
            raise RuntimeError('copied-bot-document-not-confirmed')
        self.db.execute('INSERT OR IGNORE INTO destination VALUES(?,?)', (doc_id, destination_id))
        self.db.execute("UPDATE bot_requests SET state='copied',destination_id=?,copied_at=?,error='' WHERE deep_link=?", (destination_id, now_iso(), item['deepLink']))
        # Stage the exact fresh gate alongside its confirmed file. Reusing an
        # old receipt bypasses prepare(), so it must never capture stale gates.
        if (self.active_deep == item['deepLink'] and self.flow.required_sponsors is not None
                and set(self.flow.required_sponsors) <= self.flow.verified_sponsors):
            snapshot = self.flow.sponsor_snapshot()
            if snapshot is not None:
                self.db.execute('INSERT OR REPLACE INTO bot_sponsor_receipts VALUES(?,?)',
                                (item['deepLink'], json.dumps(snapshot)))
        self.db.commit()
        return {'url': f'https://t.me/{DEST_USERNAME}/{destination_id}', 'messageId': destination_id,
                'size': record['size'], 'via': 'minibot'}

    def publish_receipts(self):
        changed = False
        finished = []
        for row in self.db.execute("SELECT * FROM bot_requests WHERE state IN ('copied','forwarding')").fetchall():
            destination = row['destination_id']
            if not destination and row['document_id']:
                found = self.db.execute('SELECT message_id FROM destination WHERE document_id=?', (row['document_id'],)).fetchone()
                destination = found[0] if found else None
            if not destination:
                continue
            item = json.loads(row['payload'])
            anime = self.pipeline.state.get('anime', {}).get(row['anime_key']) or {}
            record = json.loads(row['record'] or '{}')
            from types import SimpleNamespace
            message = SimpleNamespace(id=record.get('id'), raw_text=record.get('caption') or '',
                                      file=SimpleNamespace(name=record.get('name'), size=record.get('size')))
            if document_record(anime, item, message) is None:
                self.db.execute("UPDATE bot_requests SET state='held',error='page-identity-changed-before-publication' WHERE deep_link=?", (row['deep_link'],))
                continue
            previous = self.pipeline.state.get('queue', {}).get(row['deep_link']) or {}
            attached = anime.get('episodes', {}).get(str(item['episode']), {}).get(item['quality']) == row['deep_link']
            if previous.get('status') == 'done' and previous.get('source') == 'minibot' and previous.get('messageId') == destination and attached:
                finished.append((destination, row['deep_link']))
                changed = True
                continue
            if not self.still_needed(row):
                self.db.execute("UPDATE bot_requests SET state='superseded',destination_id=? WHERE deep_link=?", (destination, row['deep_link']))
                continue
            queued = self.pipeline.state['queue'][row['deep_link']]
            queued.update(status='done', url=f'https://t.me/{DEST_USERNAME}/{destination}', messageId=destination,
                size=record.get('size'), resolvedAt=now_iso(), source='minibot', botReceivedAt=row['received_at'],
                botSourceMessageId=row['source_message_id'], botSourcePeerId=row['source_bot_id'], lastError='')
            finished.append((destination, row['deep_link']))
            changed = True
        # Save canonical state before acknowledging publication in SQLite.
        if changed:
            from common import save_state
            save_state(self.pipeline.state)
        for _destination, deep in finished:
            receipt = self.db.execute('SELECT snapshot FROM bot_sponsor_receipts WHERE deep_link=?', (deep,)).fetchone()
            if receipt:
                snapshot = json.loads(receipt[0])
                previous = self.get('minibot_sponsors_successful', {}) or {}
                if snapshot['successAt'] > previous.get('successAt', 0):
                    self.put('minibot_sponsors_successful', snapshot)
                self.db.execute('DELETE FROM bot_sponsor_receipts WHERE deep_link=?', (deep,))
        self.db.executemany("UPDATE bot_requests SET state='published',destination_id=? WHERE deep_link=?", finished)
        self.db.commit()
        return changed

    async def resolve(self, deep):
        row = self.db.execute('SELECT * FROM bot_requests WHERE deep_link=?', (deep,)).fetchone()
        item = json.loads(row['payload'])
        try:
            if row['state'] == 'forwarding' and row['document_id']:
                recent = await self.pipeline.tg(lambda: self.pipeline.client.get_messages(self.pipeline.dest, limit=1000))
                confirmed = next((message for message in recent if message and getattr(message, 'document', None)
                                  and str(message.document.id) == row['document_id']), None)
                if confirmed:
                    self.db.execute('INSERT OR IGNORE INTO destination VALUES(?,?)', (row['document_id'], confirmed.id))
                    self.db.execute("UPDATE bot_requests SET state='copied',destination_id=?,copied_at=?,error='' WHERE deep_link=?",
                                    (confirmed.id, now_iso(), deep))
                    self.db.commit()
                    return
            if self.new_posts_only() and not self.start_is_live(deep):
                # A queued/old request or an expired received message must not
                # cause a fresh /start after the operator's strict live cutover.
                if row['document_id'] and row['received_at']:
                    if not await self.reuse_received(row, item):
                        self.db.execute("UPDATE bot_requests SET state='held',error='live-policy-recovery-unavailable' WHERE deep_link=?", (deep,))
                return
            self.db.execute("UPDATE bot_requests SET state='requesting',attempts=attempts+1,error='' WHERE deep_link=?", (deep,))
            self.db.commit()
            self.put('minibot_next_at', time.time() + 75)
            if self.flow is None:
                await self.initialize()
            if row['state'] in {'retry', 'pending'} and await self.reuse_received(row, item):
                return
            await self.flow.prepare()
            ok, result = await self.flow.resolve_one(item)
            if ok:
                return
            if self.flow.failure:
                raise self.flow.failure
            reason = ('minibot-response-missing' if 'پاسخ ربات میانی' in str(result) else
                      'endbot-document-timeout' if 'فایل در زمان' in str(result) else
                      'sponsor-verification-incomplete' if 'اسپانسر' in str(result) else 'bot-rejected-or-incomplete')
            raise RuntimeError(reason)
        except asyncio.CancelledError:
            raise
        except BotHeld as error:
            self.db.execute("UPDATE bot_requests SET state='held',error=? WHERE deep_link=?", (str(error), deep))
            if str(error) in {'new-sponsor-membership-required', 'unsupported-sponsor-action',
                              'unrecognized-bot-action', 'unquantified-bot-limit', 'provider-membership-check-rejected',
                              'sponsor-membership-pending-approval', 'source-protected-content',
                              'unexpected-sponsor-count', 'account-channel-limit'}:
                self.put('minibot_hold_reason', str(error))
        except Exception as error:
            current = self.db.execute('SELECT state,attempts FROM bot_requests WHERE deep_link=?', (deep,)).fetchone()
            if current['state'] != 'copied':
                state = 'forwarding' if current['state'] == 'forwarding' else 'retry' if current['attempts'] < 3 else 'held'
                retry = max(time.time() + 600, self.peer_until(), self.global_until())
                code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[a-z-]{1,80}', str(error)) else type(error).__name__
                self.db.execute('UPDATE bot_requests SET state=?,retry_at=?,error=? WHERE deep_link=?', (state, retry, code, deep))
        finally:
            self.db.commit()

    def recover_held_identity(self):
        """Retry a received document once after a proven filename-truncation fix.

        The source bot's filename is shortened while its caption carries the full
        identity. A held request already has the exact source document and no
        accepted link; after the current identity check accepts it, reuse that
        document instead of sending a fresh MiniBot start.
        """
        seen = self.get('minibot_identity_recovery', {}) or {}
        rows = self.db.execute("""SELECT * FROM bot_requests
          WHERE state='held' AND error='document-identity-or-quality-mismatch'
            AND record IS NOT NULL AND document_id IS NOT NULL
            AND source_message_id IS NOT NULL AND source_bot_id IS NOT NULL""").fetchall()
        changed = False
        for row in rows:
            if row['deep_link'] in seen:
                continue
            seen[row['deep_link']] = now_iso()
            item = json.loads(row['payload'])
            anime = self.pipeline.state.get('anime', {}).get(row['anime_key']) or {}
            record = json.loads(row['record'] or '{}')
            from types import SimpleNamespace
            message = SimpleNamespace(id=record.get('id'), raw_text=record.get('caption') or '',
                file=SimpleNamespace(name=record.get('name'), size=record.get('size')))
            if not self.still_needed(row) or document_record(anime, item, message) is None:
                continue
            self.db.execute("UPDATE bot_requests SET state='retry',retry_at=0,error='' WHERE deep_link=? AND state='held'",
                            (row['deep_link'],))
            changed = True
        self.put('minibot_identity_recovery', seen)
        if changed:
            self.db.commit()
        return changed

    async def reuse_received(self, row, item):
        """Reuse the exact received source message, never a fresh start request."""
        if self.flow is not None:
            self.flow.required_sponsors = None
        record = json.loads(row['record'] or '{}')
        if not (row['document_id'] and row['source_message_id'] and row['source_bot_id']):
            return False
        anime = self.pipeline.state.get('anime', {}).get(row['anime_key']) or {}
        message = await self.pipeline.tg(
            lambda: self.pipeline.client.get_messages(row['source_bot_id'], ids=row['source_message_id']))
        if (not message or not getattr(message, 'document', None)
                or str(message.document.id) != str(row['document_id'])
                or getattr(getattr(message, 'file', None), 'size', None) != record.get('size')):
            return False
        if document_record(anime, item, message) is None:
            return False
        self.put('minibot_next_at', time.time() + 75)
        await self.copy_verified(message, item)
        return True

    def candidate_rows(self):
        live_after = int(self.get('minibot_live_after_post', 0))
        # A short operator list can surface already-live requests for a reported
        # regression without changing identity, approval or the live boundary.
        priority = [value for value in (read_json(DATA / 'minibot-priority.json', {}) or {}).get('deepLinks', [])
                    if isinstance(value, str)][:20]
        order = ""
        params = []
        if priority:
            order = f"CASE WHEN r.deep_link IN ({','.join('?' * len(priority))}) THEN 1 ELSE 0 END DESC,"
        params.extend((time.time(), int(self.new_posts_only()), live_after))
        if priority:
            params.extend(priority)
        return self.db.execute(f"""SELECT r.* FROM bot_requests r LEFT JOIN bot_import_sources i ON i.deep_link=r.deep_link
            LEFT JOIN bot_live_sources l ON l.deep_link=r.deep_link AND l.anime_key=r.anime_key AND l.post_id>=?
            WHERE state IN ('pending','retry','requesting','forwarding','archive_wait') AND retry_at<=?
              AND (i.deep_link IS NOT NULL OR l.deep_link IS NOT NULL
                   OR (?=0 AND CAST(json_extract(payload,'$.postId') AS INTEGER)>=?)
                   OR (r.state='forwarding' AND r.document_id IS NOT NULL))
            ORDER BY {order} i.priority_at DESC,MAX(COALESCE(l.post_id,0),CAST(json_extract(payload,'$.postId') AS INTEGER)) DESC,
              CAST(json_extract(payload,'$.episode') AS INTEGER) DESC,
              CASE json_extract(payload,'$.quality') WHEN '720p' THEN 0 WHEN '1080p' THEN 1 WHEN '480p' THEN 2 ELSE 3 END LIMIT 80""", [live_after, *params]).fetchall()

    def tick(self):
        self.pipeline.dirty |= self.publish_receipts()
        self.recover_held_identity()
        if self.task is not None:
            if not self.task.done():
                return
            with contextlib.suppress(asyncio.CancelledError, Exception):
                self.task.result()
            self.task = None
            self.active_deep = None
        if time.monotonic() - self.last_sync >= 60:
            self.sync_requests()
            self.last_sync = time.monotonic()
        # Reuse the sole bot-lane task: maintenance never overlaps a conversation
        # or sends /start to discover a sponsor list. All waits survive restart.
        if (self.flow is not None and self.get('minibot_sponsor_memberships', {})
                and self.get('minibot_sponsors_successful', None) is not None
                and not self.get('minibot_hold_reason', '')
                and time.monotonic() - self.last_sponsor_maintenance >= 300
                and max(self.global_until(), float(self.get('minibot_peer_until'))) <= time.time()):
            self.last_sponsor_maintenance = time.monotonic()
            self.task = asyncio.create_task(self.maintain_sponsors())
            return
        if max(self.peer_until(), self.global_until()) > time.time():
            return
        if self.get('minibot_hold_reason', ''):
            return
        trial = self.get('minibot_activation_once', '')
        if trial:
            row = self.db.execute('SELECT * FROM bot_requests WHERE deep_link=?', (trial,)).fetchone()
            self.put('minibot_hold_reason', 'activation-observation')
            self.put('minibot_activation_once', '')
            if row is not None and self.still_needed(row):
                self.active_deep = trial
                self.task = asyncio.create_task(self.resolve(trial))
            return
        candidates = self.candidate_rows()
        for row in candidates:
            if not self.still_needed(row):
                self.db.execute("UPDATE bot_requests SET state='superseded' WHERE deep_link=?", (row['deep_link'],))
                continue
            if self.archive_available(row):
                self.db.execute("UPDATE bot_requests SET state='archive_wait',retry_at=? WHERE deep_link=?", (time.time() + 60, row['deep_link']))
                continue
            self.active_deep = row['deep_link']
            self.task = asyncio.create_task(self.resolve(self.active_deep))
            break
        self.db.commit()

    async def maintain_sponsors(self):
        records = self.get('minibot_sponsor_memberships', {})
        successful = self.get('minibot_sponsors_successful', None)
        observed = self.get('minibot_sponsors_observed', None)
        if successful is None or observed is None:
            return
        if 'peerIds' not in successful:
            return
        required = set(successful['keys']) | set(observed['keys'])
        required_peers = set(successful['peerIds'])
        # Unresolved identities or a newer uncompleted requirement list must not
        # accidentally evict another alias of a currently required channel.
        known = {alias for meta in records.values() if not meta.get('leftAt') for alias in meta['aliases']}
        if not required <= known:
            return
        for ident, meta in records.items():
            if meta.get('leftAt'):
                continue
            unused = (meta.get('owned') and meta.get('verifiedAt') and meta.get('joinedAt')
                      and time.time() - meta['joinedAt'] > 86400
                      and successful['successAt'] > meta['joinedAt']
                      and int(ident) not in required_peers and not required.intersection(meta['aliases']))
            if meta.get('mutedAt') and not unused:
                continue
            peer = InputChannel(int(ident), int(meta['accessHash']))
            try:
                entity = await self.flow.tg(lambda: self.pipeline.client.get_entity(peer), 'resolve saved sponsor identity')
                if (int(entity.id) != int(ident) or not getattr(entity, 'broadcast', False)
                        or getattr(entity, 'megagroup', False) or self.flow.protected_sponsor(entity)):
                    continue
                await self.flow.mute_sponsor(meta['aliases'][0], entity)
                if not unused:
                    continue
                if not await self.flow.actual_membership(peer, ordinary_only=True):
                    continue
                await self.flow.tg(lambda: self.pipeline.client(LeaveChannelRequest(peer)), 'leave unused sponsor')
                records = self.get('minibot_sponsor_memberships', {})
                records[ident]['leftAt'] = time.time()
                self.put('minibot_sponsor_memberships', records)
                self.trace('unused-sponsor-left', peerId=int(ident))
                # One exit per pass bounds Telegram operations and retry scope.
                return
            except errors.UserNotParticipantError:
                records = self.get('minibot_sponsor_memberships', {})
                records[ident]['leftAt'] = time.time()
                self.put('minibot_sponsor_memberships', records)
            except BotWait:
                return
            except Exception as error:
                self.trace('sponsor-maintenance-deferred', reason=type(error).__name__)
                return

    def status(self):
        counts = dict(self.db.execute('SELECT state,count(*) FROM bot_requests GROUP BY state'))
        received = self.db.execute('SELECT max(received_at) FROM bot_requests').fetchone()[0]
        copied = self.db.execute('SELECT max(copied_at) FROM bot_requests WHERE destination_id IS NOT NULL').fetchone()[0]
        live_after = int(self.get('minibot_live_after_post', 0))
        pending = self.db.execute('''SELECT count(*) FROM bot_requests r
            LEFT JOIN bot_live_sources l ON l.deep_link=r.deep_link AND l.anime_key=r.anime_key AND l.post_id>=?
            LEFT JOIN bot_import_sources i ON i.deep_link=r.deep_link
            WHERE r.state IN ('pending','retry','requesting','forwarding','archive_wait')
              AND (l.deep_link IS NOT NULL OR i.deep_link IS NOT NULL
                   OR (?=0 AND CAST(json_extract(r.payload,'$.postId') AS INTEGER)>=?)
                   OR (r.state='forwarding' AND r.document_id IS NOT NULL))''',
            (live_after, int(self.new_posts_only()), live_after)).fetchone()[0]
        active = self.task is not None and not self.task.done()
        waiting = max(self.peer_until(), self.global_until())
        reason = ('active' if active else 'operator-hold' if self.get('minibot_hold_reason', '')
                   else 'rate-wait' if waiting > time.time() else 'queued' if pending else 'no-eligible-links')
        sponsors = list(self.get('minibot_sponsor_memberships', {}).values())
        successful = self.get('minibot_sponsors_successful', {}) or {}
        return {'enabled': True, 'counts': counts, 'active': active,
                'livePolicy': self.get('minibot_live_policy', {}) or {'mode': 'since-initial-boundary'},
                'eligiblePending': pending, 'idleReason': reason, 'nextActionAt': waiting,
                'holdReason': self.get('minibot_hold_reason', ''),
                'phase': self.flow.last_stage if self.flow else 'initializing',
                'peerWaitUntil': self.peer_until(), 'lastReceivedAt': received, 'lastCopiedAt': copied,
                'sponsorLifecycle': {'tracked': len(sponsors),
                    'ownedActive': sum(bool(meta.get('owned') and not meta.get('leftAt')) for meta in sponsors),
                    'mutedActive': sum(bool(meta.get('mutedAt') and not meta.get('leftAt')) for meta in sponsors),
                    'left': sum(bool(meta.get('leftAt')) for meta in sponsors),
                    'lastSuccessfulListAt': successful.get('successAt')}}

    async def close(self):
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self.task
