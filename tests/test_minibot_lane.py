import asyncio
import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch
from telethon.tl.types import InputDocument
from telethon.tl.functions.channels import LeaveChannelRequest
from telethon.tl.functions.account import UpdateNotifySettingsRequest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_pipeline import open_db
from minibot_lane import BotHeld, BotLane, BotWait, GuardedFlow, document_record, wait_seconds, participant_is_member
from telethon import errors


class FakeClient:
    def __init__(self):
        self.call = AsyncMock()
        self.get_messages = AsyncMock(return_value=[])
        self.get_entity = AsyncMock()
        self.get_me = AsyncMock(return_value=SimpleNamespace())
        self.add_event_handler = Mock()

    async def __call__(self, request):
        return await self.call(request)


class MiniBotTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.db = open_db(self.root / 'archive.sqlite3')
        self.deep = 'https://t.me/AniPlusMiniBot?start=get_test_2'
        self.item = {'deepLink': self.deep, 'animeKey': 'a', 'episode': 2, 'quality': '720p', 'status': 'pending'}
        self.anime = {'slug': 'example-season-2', 'titleEn': 'Example Season 2', 'titleOriginal': 'Example II',
                      'year': 2020, 'format': 'TV', 'declaredEpisodes': 12, 'lastPostId': 100,
                      'episodes': {'2': {'720p': self.deep}}}
        self.pipeline = SimpleNamespace(db=self.db, state={'anime': {'a': self.anime}, 'queue': {self.deep: self.item.copy()}},
            client=FakeClient(), dest=SimpleNamespace(id=777), running=True, dirty=False, status={},
            tg=lambda factory: factory())
        self.lane = BotLane(self.pipeline)
        self.flow = GuardedFlow(self.lane, SimpleNamespace(id=100), SimpleNamespace(id=200))
        self.lane.flow = self.flow
        self.patches = [patch('minibot_lane.MINIBOT_WAIT_PATH', self.root / 'wait.json'),
                        patch('minibot_lane.DATA', self.root),
                        patch('admin_catalog.read_overrides', return_value={}),
                        patch('common.save_state'),
                        patch('minibot_lane.utils.get_input_document', return_value=InputDocument(12345, 0, b'fixture'))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.db.close()
        self.folder.cleanup()

    def message(self, name='Example II - 02 [720p].mkv', caption='', ident=5):
        return SimpleNamespace(id=ident, sender_id=200, chat_id=200, out=False, document=SimpleNamespace(id=12345),
            file=SimpleNamespace(name=name, size=1234), raw_text=caption, buttons=None,
            date=dt.datetime.now(dt.timezone.utc), edit_date=None)

    def test_exact_filename_identity_episode_and_codec(self):
        self.assertIsNotNone(document_record(self.anime, self.item, self.message()))
        for name in ['Example III - 02 [720p].mkv', 'Example II - 03 [720p].mkv',
                     'Example II - 02 [1080p].mkv', 'Example II - 02 [720p x265].mkv',
                     'Unrelated II - 02 [720p].mkv', 'Example Movie II [720p].mkv']:
            self.assertIsNone(document_record(self.anime, self.item, self.message(name)), name)

    def test_caption_cannot_relabel_filename(self):
        self.assertIsNone(document_record(self.anime, self.item, self.message(caption='Example III - 02 [720p]')))
        self.assertIsNone(document_record(self.anime, self.item, self.message(caption='Example II - 03 [720p]')))
        self.assertIsNotNone(document_record(self.anime, self.item, self.message(caption='این فایل پس از یک دقیقه حذف می‌شود.')))

    def test_observed_endbot_caption_layout_has_explicit_quality_then_episode(self):
        caption = '[@AniPlus] Example II\nEp: 720p هاردساب 2'
        self.assertIsNotNone(document_record(self.anime, self.item, self.message(caption=caption)))
        self.assertIsNone(document_record(self.anime, self.item, self.message('Example II - 03 [720p].mkv', caption)))
        self.assertIsNone(document_record(self.anime, self.item, self.message('Example II - 02 [1080p].mkv', caption)))
        self.assertIsNone(document_record(self.anime, self.item, self.message(caption=caption.replace('هاردساب 2', 'هاردساب 3'))))

    def test_source_filename_truncation_keeps_the_certified_caption_identity(self):
        anime = {**self.anime, 'titleEn': 'Example Season 2', 'titleOriginal': 'Example II'}
        caption = '[@AniPlus] Example Season 2\nEp: 720p هاردساب 2'
        # The source bot cuts long filenames, so only a prefix of the exact
        # certified caption title is accepted; the caption remains authoritative.
        self.assertIsNotNone(document_record(anime, self.item,
            self.message('@AniPlus_Example_Season_720p_هاردساب_Ep2.mkv', caption)))
        self.assertIsNone(document_record(anime, self.item,
            self.message('@AniPlus_Example_720p_هاردساب_Ep2.mkv', caption)))
        self.assertIsNone(document_record(anime, self.item,
            self.message('@AniPlus_Example_Season_3_720p_هاردساب_Ep2.mkv', caption)))
        self.assertIsNone(document_record(anime, self.item,
            self.message('@AniPlus_Unrelated_Season_720p_هاردساب_Ep2.mkv', caption)))

    async def test_operator_priority_reorders_only_already_live_requests(self):
        older = 'https://t.me/AniPlusMiniBot?start=get_test_2'
        newer = 'https://t.me/AniPlusMiniBot?start=get_test_3'
        below = 'https://t.me/AniPlusMiniBot?start=get_test_4'
        for deep, post in ((newer, 200), (older, 100), (below, 50)):
            self.db.execute("INSERT INTO bot_requests(deep_link,anime_key,payload,state,retry_at) VALUES(?,?,?,'retry',0)",
                (deep, 'a', json.dumps({'deepLink': deep, 'animeKey': 'a', 'episode': 2, 'quality': '720p', 'postId': post})))
        self.db.commit()
        self.lane.put('minibot_live_after_post', 100)
        with patch('minibot_lane.DATA', self.root):
            (self.root / 'minibot-priority.json').write_text(json.dumps({'deepLinks': [older, below]}))
            rows = self.lane.candidate_rows()
        self.assertEqual([row['deep_link'] for row in rows], [older, newer])
        self.assertNotIn(below, [row['deep_link'] for row in rows])

    def test_strict_live_cutover_retains_history_but_only_admits_verified_new_posts_and_explicit_imports(self):
        self.pipeline.state['anime']={'a1':self.anime}
        self.anime['postIds']=[50,200,201,202,203]
        self.anime['lastPostId']=203
        self.pipeline.state['queue'][self.deep].update(animeKey='a1',postId=50)
        orphan=self.deep+'_orphan'
        imported=self.deep+'_imported'
        self.anime['episodes']['4']={'720p':orphan}
        self.anime['episodes']['5']={'720p':imported}
        for deep,episode,post in [(orphan,4,300),(imported,5,40)]:
            self.pipeline.state['queue'][deep]={**self.item,'deepLink':deep,'animeKey':'a1','episode':episode,'postId':post}
        for ident,date in [(200,'2025-12-31T00:00:00+00:00'),(201,'2025-12-31T23:59:59+00:00'),
                           (202,'2026-01-02T00:00:00+00:00'),(203,None)]:
            parsed={'animeId':'1','postId':ident,'titleEn':self.anime['titleEn'],'date':date,
                    'episodes':{'2':{'720p':self.deep}}}
            self.db.execute('INSERT INTO posts VALUES(?,?,1)',(ident,json.dumps(parsed)))
        self.lane.put('ani_live',200)
        self.lane.put('telegram_flood_until',9999999999)
        self.lane.sync_requests()
        self.db.execute('INSERT INTO bot_import_sources VALUES(?,?,?)',(imported,'approved-fixture',1))
        self.db.commit()
        source_before=copy.deepcopy(self.pipeline.state)
        request={'version':1,'mode':'new-posts-only','expectedLiveAfterPost':101,'expectedCursor':200,
                 'firstPostId':201,'since':'2026-01-01T00:00:00+00:00'}
        (self.root/'minibot-live-policy-request.json').write_text(json.dumps(request))
        self.lane.apply_live_policy_request()
        self.assertEqual(self.lane.get('minibot_live_after_post'),201)
        self.assertEqual({r['deep_link'] for r in self.lane.candidate_rows()},{self.deep,imported})
        self.assertEqual(self.lane.status()['eligiblePending'],2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_requests').fetchone()[0],3)
        self.assertEqual(self.pipeline.state,source_before)
        self.assertEqual(self.lane.get('telegram_flood_until'),9999999999)
        self.assertTrue(self.lane.start_is_live(self.deep))
        self.assertFalse(self.lane.start_is_live(orphan))
        self.assertTrue(self.lane.start_is_live(imported))
        parsed=json.loads(self.db.execute('SELECT payload FROM posts WHERE id=202').fetchone()[0])
        parsed['episodes']={}
        self.db.execute('UPDATE posts SET payload=? WHERE id=202',(json.dumps(parsed),))
        self.lane.sync_requests()
        self.assertEqual([r['deep_link'] for r in self.lane.candidate_rows()],[imported])
        self.lane.apply_live_policy_request()
        self.assertEqual(self.lane.get('minibot_live_after_post'),201)

    async def test_strict_cutover_cannot_be_bypassed_by_direct_resolve_or_forwarding_recovery(self):
        self.lane.sync_requests()
        self.lane.put('minibot_live_policy',{'mode':'new-posts-only','since':'2026-01-01T00:00:00+00:00'})
        self.flow.prepare=AsyncMock()
        self.flow.resolve_one=AsyncMock()
        await self.lane.resolve(self.deep)
        self.assertEqual(self.db.execute('SELECT attempts FROM bot_requests').fetchone()[0],0)
        self.flow.prepare.assert_not_awaited()
        self.flow.resolve_one.assert_not_awaited()
        self.db.execute("UPDATE bot_requests SET state='forwarding',document_id='12345',received_at='received' WHERE deep_link=?",(self.deep,))
        self.db.commit()
        self.assertEqual(len(self.lane.candidate_rows()),1)
        await self.lane.resolve(self.deep)
        row=self.db.execute('SELECT state,document_id,received_at FROM bot_requests').fetchone()
        self.assertEqual(tuple(row),('held','12345','received'))
        self.flow.prepare.assert_not_awaited()
        self.flow.resolve_one.assert_not_awaited()

    async def test_received_document_is_reused_after_identity_fix_and_only_once(self):
        self.lane.sync_requests()
        message = self.message(name='@AniPlus_Example_Season_720p_هاردساب_Ep2.mkv',
            caption='[@AniPlus] Example Season 2\nEp: 720p هاردساب 2')
        self.anime['titleEn'] = 'Example Season 2'
        self.db.execute("UPDATE bot_requests SET state='held',error='document-identity-or-quality-mismatch',"
                        "record=?,document_id=?,source_message_id=?,source_bot_id=?,attempts=1",
                        (json.dumps({'id': 5, 'name': message.file.name, 'size': 1234,
                                     'caption': message.raw_text}), '12345', 5, 200))
        self.db.commit()
        self.assertTrue(self.lane.recover_held_identity())
        self.assertEqual(self.db.execute('SELECT state FROM bot_requests').fetchone()[0], 'retry')
        self.assertFalse(self.lane.recover_held_identity())
        self.assertEqual(self.db.execute('SELECT state FROM bot_requests').fetchone()[0], 'retry')
        self.pipeline.client.get_messages.return_value = message
        self.lane.copy_verified = AsyncMock()
        row = self.db.execute('SELECT * FROM bot_requests').fetchone()
        self.assertTrue(await self.lane.reuse_received(row, json.loads(row['payload'])))
        self.lane.copy_verified.assert_awaited_once()
        # A different document or size can never be substituted for the receipt.
        message.document.id = 999
        self.assertFalse(await self.lane.reuse_received(row, json.loads(row['payload'])))

    def test_live_repost_admits_exact_repeated_link_without_promoting_backlog(self):
        self.pipeline.state['anime'] = {'a1': self.anime}
        self.item['animeKey'] = 'a1'
        self.pipeline.state['queue'][self.deep] = self.item.copy()
        self.pipeline.state['queue'][self.deep]['postId'] = 50
        self.anime['postIds'] = [50, 200]
        self.anime['lastPostId'] = 200
        self.lane.put('minibot_live_after_post', 100)
        other = self.deep + '_old'
        self.anime['episodes']['1'] = {'720p': other}
        self.pipeline.state['queue'][other] = {**self.item, 'deepLink': other, 'episode': 1, 'postId': 50}
        parsed = {'animeId': '1', 'postId': 200, 'titleEn': self.anime['titleEn'],
                  'episodes': {'2': {'720p': self.deep}}}
        self.db.execute('INSERT INTO posts VALUES(?,?,1)', (200, json.dumps(parsed)))
        self.lane.sync_requests()
        rows = self.lane.candidate_rows()
        self.assertEqual([r['deep_link'] for r in rows], [self.deep])
        self.assertEqual(json.loads(rows[0]['payload'])['postId'], 50)
        # Rechecking an edit which removes the link revokes only its live grant.
        parsed['episodes'] = {}
        self.db.execute('UPDATE posts SET payload=? WHERE id=200', (json.dumps(parsed),))
        self.lane.sync_requests()
        self.assertEqual(self.lane.candidate_rows(), [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_requests').fetchone()[0], 2)

    def test_live_repost_cannot_grant_link_to_different_page_or_unmerged_post(self):
        self.pipeline.state['queue'][self.deep]['postId'] = 50
        self.anime['postIds'] = [200]
        self.lane.put('minibot_live_after_post', 100)
        parsed = {'animeId': '99', 'postId': 200, 'titleEn': self.anime['titleEn'],
                  'episodes': {'2': {'720p': self.deep}}}
        self.db.execute('INSERT INTO posts VALUES(?,?,1)', (200, json.dumps(parsed)))
        self.lane.sync_requests()
        self.assertEqual(self.lane.candidate_rows(), [])

    def test_live_post_with_six_ready_and_four_new_links_only_queues_four(self):
        self.pipeline.state={'anime':{},'queue':{}}
        self.anime.update(postIds=[50,200],lastPostId=200,episodes={})
        self.pipeline.state['anime']['a1']=self.anime
        self.lane.put('minibot_live_after_post',100)
        parsed={'animeId':'1','postId':200,'titleEn':self.anime['titleEn'],'episodes':{}}
        ready_before={}
        new=[]
        for episode in range(1,11):
            deep=f'https://t.me/AniPlusMiniBot?start=get_mixed_{episode}'
            item={**self.item,'deepLink':deep,'animeKey':'a1','episode':episode,'postId':50}
            self.anime['episodes'][str(episode)]={'720p':deep}
            parsed['episodes'][str(episode)]={'720p':deep}
            if episode<=6:
                item.update(status='done',url=f'https://t.me/testanivers/{1000+episode}',messageId=1000+episode)
                ready_before[deep]=copy.deepcopy(item)
                self.db.execute("INSERT INTO bot_requests(deep_link,anime_key,payload,state,destination_id) VALUES(?,?,?,'published',?)",
                    (deep,'a1',json.dumps(item),1000+episode))
            else:new.append(deep)
            self.pipeline.state['queue'][deep]=item
        # Another old link on the page, not in this live post, is not promoted.
        unseen='https://t.me/AniPlusMiniBot?start=get_not_in_mixed_post'
        self.anime['episodes']['11']={'720p':unseen}
        self.pipeline.state['queue'][unseen]={**self.item,'deepLink':unseen,'animeKey':'a1','episode':11,'postId':50}
        self.db.execute('INSERT INTO posts VALUES(?,?,1)',(200,json.dumps(parsed)))
        self.db.commit()
        for _ in range(2):
            self.lane.sync_requests()
            self.assertEqual({row['deep_link'] for row in self.lane.candidate_rows()},set(new))
            self.assertEqual(self.db.execute("SELECT count(*) FROM bot_requests WHERE state='published'").fetchone()[0],6)
            self.assertEqual(self.db.execute('SELECT count(*) FROM bot_requests').fetchone()[0],11)
            self.assertEqual({deep:self.pipeline.state['queue'][deep] for deep in ready_before},ready_before)

    def test_reviewed_page_is_never_bypassed_with_a_bot_link(self):
        self.anime['archiveFileReview'] = {'version': 1, 'files': {}}
        self.assertIsNone(document_record(self.anime, self.item, self.message()))
        self.assertFalse(self.lane.eligible(self.deep, self.item, self.anime))

    def test_wait_text_is_explicit_and_not_episode_runtime(self):
        self.assertEqual(wait_seconds('لطفاً ۲ ساعت و ۳ دقیقه صبر کنید'), 7385)
        self.assertEqual(wait_seconds('Please wait 20 seconds'), 25)
        self.assertIsNone(wait_seconds('مدت هر قسمت ۲۴ دقیقه'))
        self.assertIsNone(wait_seconds('فایل بعد از ۱ دقیقه حذف می‌شود'))

    async def test_invite_access_does_not_mean_self_membership(self):
        self.pipeline.client.call.side_effect = errors.UserNotParticipantError(request=None)
        self.assertFalse(await self.flow.actual_membership(SimpleNamespace()))
        self.assertFalse(participant_is_member(SimpleNamespace()))
        member = type('ChannelParticipantSelf', (), {'left': False})()
        self.assertTrue(participant_is_member(member))
        banned = type('ChannelParticipantBanned', (), {'left': False})()
        self.assertFalse(participant_is_member(banned))

    async def test_membership_requires_the_exact_session_user(self):
        self.pipeline.client.get_me.return_value = SimpleNamespace(user_id=42)
        member = type('ChannelParticipantSelf', (), {'left': False, 'user_id': 99})()
        self.pipeline.client.call.return_value = SimpleNamespace(participant=member)
        self.assertFalse(await self.flow.actual_membership(SimpleNamespace()))
        member.user_id = 42
        self.assertTrue(await self.flow.actual_membership(SimpleNamespace()))

    async def test_protected_file_is_received_but_never_copied(self):
        self.lane.sync_requests()
        message = self.message()
        message.noforwards = True
        with self.assertRaises(BotHeld):
            await self.lane.copy_verified(message, self.item)
        self.assertEqual(self.pipeline.client.call.await_count, 0)
        self.assertTrue(self.db.execute('SELECT received_at FROM bot_requests').fetchone()[0])
        self.assertIsNone(self.db.execute('SELECT destination_id FROM bot_requests').fetchone()[0])

    async def test_stale_sender_and_duplicate_edits_are_rejected(self):
        self.flow.boundaries = {100: 3, 200: 4}
        await self.flow._on_message(SimpleNamespace(message=self.message(ident=4)))
        self.assertTrue(self.flow.queue.empty())
        message = self.message(ident=5)
        await self.flow._on_message(SimpleNamespace(message=message))
        message.edit_date = dt.datetime.now(dt.timezone.utc)
        await self.flow._on_message(SimpleNamespace(message=message))
        self.assertEqual(self.flow.queue.qsize(), 1)

    async def test_receipt_survives_bot_auto_delete_and_slow_callback_answer(self):
        self.lane.sync_requests()
        self.lane.active_deep = self.deep
        self.flow.boundaries = {100: 0, 200: 0}
        await self.flow._on_message(SimpleNamespace(message=self.message()))
        before = self.db.execute('SELECT * FROM bot_requests').fetchone()
        self.assertEqual(json.loads(before['record'])['name'], self.message().file.name)
        self.assertEqual(before['document_id'], '12345')
        self.lane.record_receipt(self.message(), self.deep)
        self.assertEqual(before['received_at'], self.db.execute('SELECT received_at FROM bot_requests').fetchone()[0])
        message = self.message(ident=6)
        message.sender_id = 999
        await self.flow._on_message(SimpleNamespace(message=message))
        self.assertEqual(self.flow.queue.qsize(), 1)

    async def test_unknown_bot_limit_is_held_without_early_retry(self):
        self.flow.boundaries = {100: 0, 200: 0}
        message = self.message(caption='Too many requests, try again later')
        message.document = None
        await self.flow._on_message(SimpleNamespace(message=message))
        with self.assertRaises(BotHeld):
            await self.flow.next_message(.1)

    def test_callbacks_do_not_fall_back_to_payment_or_unknown_buttons(self):
        message = self.message()
        message.buttons = [[SimpleNamespace(text='پرداخت', data=b'pay')]]
        with self.assertRaises(BotHeld):
            self.flow.callback_for(message)
        message.buttons = [[SimpleNamespace(text='بررسی عضویت', data=b'verify')]]
        self.assertEqual(self.flow.callback_for(message), b'verify')

    def test_dynamic_sponsors_are_only_current_endbot_membership_buttons(self):
        message = self.message()
        message.buttons = [[SimpleNamespace(text='عضویت', url='https://t.me/+test_invite_123', data=None)],
                           [SimpleNamespace(text='تبلیغات', url='https://t.me/OtherChannel', data=None)]]
        self.assertEqual(self.flow.sponsors_for(message), ['https://t.me/+test_invite_123'])
        message.sender_id = 999
        self.assertEqual(self.flow.sponsors_for(message), [])

    async def test_current_required_membership_is_joined_and_rechecked(self):
        self.lane.put('minibot_dynamic_sponsors_approved', True)
        url = 'https://t.me/+test_invite_123'
        self.flow.current_sponsors = {url}
        self.pipeline.client.call.return_value = SimpleNamespace(chat=SimpleNamespace())
        self.flow.actual_membership = AsyncMock(side_effect=[False, True])
        self.flow.join_sponsor = AsyncMock(return_value=(True, None))
        await self.flow.join(url)
        self.assertEqual(self.flow.join_sponsor.await_count, 1)
        self.assertEqual(self.flow.actual_membership.await_count, 2)
        self.assertIn('test_invite_123', self.flow.verified_sponsors)

    async def test_stale_membership_links_do_not_use_dynamic_approval(self):
        self.lane.put('minibot_dynamic_sponsors_approved', True)
        self.pipeline.client.call.return_value = SimpleNamespace(chat=None)
        self.flow.join_sponsor = AsyncMock()
        with self.assertRaises(BotHeld):
            await self.flow.join('https://t.me/+stale_invite')
        self.assertEqual(self.flow.join_sponsor.await_count, 0)

    def sponsor_entity(self, ident=123, **values):
        return SimpleNamespace(id=ident, access_hash=456, broadcast=True, bot=False,
                               username='RequiredSponsor', **values)

    def sponsor_snapshot(self, keys):
        self.flow.actual_membership = AsyncMock(return_value=True)
        self.lane.put('minibot_sponsors_observed', {'keys': keys, 'at': 1})
        self.lane.put('minibot_sponsors_successful', {'keys': keys,
            'peerIds': [int(ident) for ident, meta in self.lane.get('minibot_sponsor_memberships', {}).items()
                        if set(keys).intersection(meta['aliases'])], 'successAt': 200})

    async def test_new_public_join_is_muted_and_owned_without_resetting_join_age(self):
        entity = self.sponsor_entity()
        url = 'https://t.me/RequiredSponsor'
        self.lane.put('minibot_dynamic_sponsors_approved', True)
        self.flow.current_sponsors = {url}
        self.pipeline.client.get_entity.return_value = entity
        self.flow.actual_membership = AsyncMock(side_effect=[False, True, True])
        self.flow.join_sponsor = AsyncMock(return_value=(True, None))
        with patch('minibot_lane.time.time', return_value=100):
            await self.flow.join(url)
        await self.flow.join(url)
        record = self.lane.get('minibot_sponsor_memberships')['123']
        self.assertTrue(record['owned'])
        self.assertEqual(record['joinedAt'], 100)
        self.assertEqual(record['mutedAt'], 100)
        self.assertEqual(sum(isinstance(c.args[0], UpdateNotifySettingsRequest)
                             for c in self.pipeline.client.call.await_args_list), 1)

    async def test_leave_membership_check_rejects_admin_creator_and_different_account(self):
        self.pipeline.client.get_me.return_value = SimpleNamespace(user_id=42)
        for role in ['ChannelParticipantAdmin', 'ChannelParticipantCreator', 'ChannelParticipantSelf']:
            member = type(role, (), {'left': False, 'user_id': 42})()
            self.pipeline.client.call.return_value = SimpleNamespace(participant=member)
            self.assertTrue(await self.flow.actual_membership(SimpleNamespace()))
            self.assertEqual(await self.flow.actual_membership(SimpleNamespace(), ordinary_only=True), role == 'ChannelParticipantSelf')
            member.user_id = 99
            self.assertFalse(await self.flow.actual_membership(SimpleNamespace(), ordinary_only=True))

    async def test_preexisting_or_already_joined_memberships_are_never_owned(self):
        entity = self.sponsor_entity()
        self.pipeline.client.get_entity.return_value = entity
        self.flow.actual_membership = AsyncMock(return_value=True)
        await self.flow.join('https://t.me/RequiredSponsor')
        self.assertFalse(self.lane.get('minibot_sponsor_memberships')['123']['owned'])
        self.flow._sleep = AsyncMock()
        self.pipeline.client.call.side_effect = errors.UserAlreadyParticipantError(request=None)
        self.assertEqual(await self.flow.join_sponsor('@already', self.pipeline.client.call), (False, None))

    async def test_only_day_old_owned_unused_sponsor_is_left_using_saved_peer(self):
        entity = self.sponsor_entity()
        with patch('minibot_lane.time.time', return_value=100):
            self.flow.remember_sponsor('@old', entity, joined=True, verified=True)
        self.sponsor_snapshot([])
        self.pipeline.client.get_entity.return_value = entity
        with patch('minibot_lane.time.time', return_value=86501):
            await self.lane.maintain_sponsors()
        leaves = [c.args[0] for c in self.pipeline.client.call.await_args_list if isinstance(c.args[0], LeaveChannelRequest)]
        self.assertEqual(len(leaves), 1)
        self.assertEqual(leaves[0].channel.channel_id, 123)
        self.assertEqual(self.lane.get('minibot_sponsor_memberships')['123']['leftAt'], 86501)
        before = self.pipeline.client.call.await_count
        await self.lane.maintain_sponsors()
        self.assertEqual(before, self.pipeline.client.call.await_count)
        # No bot message, membership-list refresh or username resolution.
        self.assertEqual(self.pipeline.client.get_messages.await_count, 0)
        self.assertIsInstance(self.pipeline.client.get_entity.await_args.args[0].channel_id, int)

    async def test_cleanup_preserves_required_young_unowned_and_core_memberships(self):
        for mode in ['required', 'observed', 'young', 'unowned', 'core', 'admin', 'creator', 'missing-snapshot', 'unresolved']:
            with self.subTest(mode=mode):
                self.lane.put('minibot_sponsor_memberships', {})
                self.lane.put('minibot_sponsors_successful', None)
                entity = self.sponsor_entity(admin_rights=True) if mode == 'admin' else self.sponsor_entity(creator=True) if mode == 'creator' else self.sponsor_entity()
                with patch('minibot_lane.time.time', return_value=100):
                    self.flow.remember_sponsor('@keep', entity, joined=mode != 'unowned', verified=True)
                self.sponsor_snapshot(['@keep'] if mode == 'required' else [])
                if mode == 'observed':
                    self.lane.put('minibot_sponsors_observed', {'keys': ['@keep'], 'at': 200})
                if mode == 'unresolved':
                    self.lane.put('minibot_sponsors_observed', {'keys': ['@unknown'], 'at': 200})
                if mode == 'missing-snapshot':
                    self.lane.put('minibot_sponsors_successful', None)
                self.pipeline.dest = entity if mode == 'core' else SimpleNamespace(id=777)
                self.pipeline.client.get_entity.return_value = entity
                self.pipeline.client.call.reset_mock()
                with patch('minibot_lane.time.time', return_value=86500 if mode == 'young' else 86501):
                    await self.lane.maintain_sponsors()
                self.assertFalse(any(isinstance(c.args[0], LeaveChannelRequest) for c in self.pipeline.client.call.await_args_list))

    async def test_different_invites_for_same_channel_preserve_required_identity(self):
        entity = self.sponsor_entity()
        with patch('minibot_lane.time.time', return_value=100):
            self.flow.remember_sponsor('old_invite', entity, joined=True, verified=True)
        self.flow.remember_sponsor('new_invite', entity)
        self.sponsor_snapshot(['new_invite'])
        self.pipeline.client.get_entity.return_value = entity
        with patch('minibot_lane.time.time', return_value=90000):
            await self.lane.maintain_sponsors()
        self.assertFalse(any(isinstance(c.args[0], LeaveChannelRequest) for c in self.pipeline.client.call.await_args_list))

    async def test_cleanup_flood_wait_survives_restart_without_marking_left(self):
        entity = self.sponsor_entity()
        with patch('minibot_lane.time.time', return_value=100):
            self.flow.remember_sponsor('@old', entity, joined=True, verified=True)
        self.sponsor_snapshot([])
        self.pipeline.client.get_entity.return_value = entity
        self.pipeline.client.call.side_effect = errors.FloodWaitError(request=None, capture=120)
        await self.lane.maintain_sponsors()
        restarted = BotLane(self.pipeline)
        self.assertGreater(restarted.global_until(), 0)
        self.assertFalse(restarted.get('minibot_sponsor_memberships')['123'].get('leftAt'))

    async def test_maintenance_shares_lane_task_and_respects_persisted_waits_and_holds(self):
        self.flow.remember_sponsor('@old', self.sponsor_entity(), joined=True, verified=True)
        self.sponsor_snapshot([])
        self.lane.maintain_sponsors = AsyncMock()
        active = asyncio.get_running_loop().create_future()
        self.lane.task = active
        self.lane.tick()
        self.lane.maintain_sponsors.assert_not_awaited()
        active.set_result(None)
        for key in ['telegram_flood_until', 'minibot_peer_until', 'minibot_hold_reason']:
            self.lane.put(key, 'operator' if key == 'minibot_hold_reason' else 9999999999)
            self.lane.tick()
            self.lane.maintain_sponsors.assert_not_awaited()
            self.lane.put(key, '' if key == 'minibot_hold_reason' else 0)
        self.lane.tick()
        await self.lane.task
        self.lane.maintain_sponsors.assert_awaited_once()
        self.lane.tick()
        self.lane.maintain_sponsors.assert_awaited_once()

    def test_latest_successful_list_is_durable_and_failed_observation_cannot_replace_it(self):
        message = self.message()
        message.buttons = [[SimpleNamespace(text='عضویت', url='https://t.me/RequiredSponsor', data=None)]]
        self.flow.sponsors_for(message)
        self.flow.remember_sponsor('@requiredsponsor', self.sponsor_entity(), verified=True)
        self.lane.put('minibot_sponsors_successful', self.flow.sponsor_snapshot())
        self.flow.sponsors_for(self.message())
        self.assertEqual(self.lane.get('minibot_sponsors_successful')['keys'], ['@requiredsponsor'])
        message.buttons[0][0].url = 'https://t.me/NewSponsor'
        self.flow.sponsors_for(message)
        restarted = BotLane(self.pipeline)
        self.assertEqual(restarted.get('minibot_sponsors_successful')['keys'], ['@requiredsponsor'])
        self.assertEqual(restarted.get('minibot_sponsors_observed')['keys'], ['@newsponsor'])

    async def test_rejoin_starts_new_24_hour_window(self):
        entity = self.sponsor_entity()
        self.flow.remember_sponsor('@old', entity, joined=True)
        records = self.lane.get('minibot_sponsor_memberships')
        records['123']['leftAt'] = 100
        self.lane.put('minibot_sponsor_memberships', records)
        with patch('minibot_lane.time.time', return_value=200):
            self.flow.remember_sponsor('@old', entity, joined=True)
        record = self.lane.get('minibot_sponsor_memberships')['123']
        self.assertEqual(record['joinedAt'], 200)
        self.assertIsNone(record['leftAt'])
        self.assertIsNone(record['mutedAt'])

    async def test_unobserved_external_leave_does_not_reuse_the_original_join_age(self):
        entity = self.sponsor_entity()
        with patch('minibot_lane.time.time', return_value=100):
            self.flow.remember_sponsor('@old', entity, joined=True, verified=True)
        # Another client may have left it; there is no local leftAt marker.
        with patch('minibot_lane.time.time', return_value=100000):
            self.flow.remember_sponsor('@old', entity, joined=True, verified=True)
        self.assertEqual(self.lane.get('minibot_sponsor_memberships')['123']['joinedAt'], 100000)

    async def test_snapshot_older_than_join_and_unverified_join_are_not_leave_candidates(self):
        entity = self.sponsor_entity()
        self.pipeline.client.get_entity.return_value = entity
        for verified in [False, True]:
            with patch('minibot_lane.time.time', return_value=300):
                self.flow.remember_sponsor('@old', entity, joined=True, verified=verified)
            self.sponsor_snapshot([])  # success at 200 precedes join at 300
            with patch('minibot_lane.time.time', return_value=100000):
                await self.lane.maintain_sponsors()
        self.assertFalse(any(isinstance(c.args[0], LeaveChannelRequest) for c in self.pipeline.client.call.await_args_list))

    def test_success_snapshot_requires_unambiguous_verified_peer_ids(self):
        self.lane.put('minibot_sponsors_observed', {'keys': ['@same'], 'at': 1})
        self.assertIsNone(self.flow.sponsor_snapshot())
        self.flow.remember_sponsor('@same', self.sponsor_entity(), verified=True)
        self.assertEqual(self.flow.sponsor_snapshot()['peerIds'], [123])
        self.flow.remember_sponsor('@same', self.sponsor_entity(ident=456), verified=True)
        self.assertIsNone(self.flow.sponsor_snapshot())

    def test_sponsor_snapshot_promotes_only_when_the_file_is_published(self):
        self.lane.sync_requests()
        record = document_record(self.anime, self.item, self.message())
        snapshot = {'keys': ['@new'], 'peerIds': [123], 'at': 1, 'successAt': 200}
        self.db.execute('INSERT INTO bot_sponsor_receipts VALUES(?,?)', (self.deep, json.dumps(snapshot)))
        self.db.execute("UPDATE bot_requests SET state='held',record=?", (json.dumps(record),))
        self.db.commit()
        self.lane.publish_receipts()
        self.assertIsNone(self.lane.get('minibot_sponsors_successful', None))
        self.db.execute("UPDATE bot_requests SET state='copied',destination_id=101,received_at='now'")
        self.db.commit()
        self.assertTrue(self.lane.publish_receipts())
        self.assertEqual(self.lane.get('minibot_sponsors_successful'), snapshot)
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_sponsor_receipts').fetchone()[0], 0)

    async def test_verified_copy_stages_fresh_gate_but_reused_receipt_cannot_capture_it(self):
        self.lane.sync_requests()
        message = self.message()
        self.db.execute('INSERT INTO destination VALUES(?,?)', ('12345', 101))
        self.db.commit()
        self.pipeline.client.get_messages.return_value = message
        self.flow.required_sponsors = ['@needed']
        self.flow.verified_sponsors = {'@needed'}
        self.flow.remember_sponsor('@needed', self.sponsor_entity(), verified=True)
        self.lane.put('minibot_sponsors_observed', {'keys': ['@needed'], 'at': 1})
        self.lane.active_deep = self.deep
        await self.lane.copy_verified(message, self.item)
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_sponsor_receipts').fetchone()[0], 1)
        self.assertIsNone(self.lane.get('minibot_sponsors_successful', None))
        self.db.execute('DELETE FROM bot_sponsor_receipts')
        self.db.commit()
        row = self.db.execute('SELECT * FROM bot_requests').fetchone()
        self.assertTrue(await self.lane.reuse_received(row, self.item))
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_sponsor_receipts').fetchone()[0], 0)

    def test_superseded_file_and_older_publication_do_not_advance_sponsor_snapshot(self):
        self.lane.sync_requests()
        record = document_record(self.anime, self.item, self.message())
        newer = {'keys': [], 'peerIds': [], 'successAt': 300}
        older = {'keys': ['@old'], 'peerIds': [123], 'successAt': 200}
        self.lane.put('minibot_sponsors_successful', newer)
        self.db.execute('INSERT INTO bot_sponsor_receipts VALUES(?,?)', (self.deep, json.dumps(older)))
        self.db.execute("UPDATE bot_requests SET state='copied',record=?,destination_id=101,received_at='now'", (json.dumps(record),))
        self.db.commit()
        self.pipeline.state['anime']['a']['episodes']['2']['720p'] = 'new-revision'
        self.assertFalse(self.lane.publish_receipts())
        self.assertEqual(self.db.execute('SELECT state FROM bot_requests').fetchone()[0], 'superseded')
        self.assertEqual(self.lane.get('minibot_sponsors_successful'), newer)
        self.pipeline.state['anime']['a']['episodes']['2']['720p'] = self.deep
        self.db.execute("UPDATE bot_requests SET state='copied'")
        self.db.commit()
        self.lane.publish_receipts()
        self.assertEqual(self.lane.get('minibot_sponsors_successful'), newer)

    async def test_single_activation_cannot_unleash_historical_backlog(self):
        self.lane.sync_requests()
        self.lane.put('minibot_activation_once', self.deep)
        self.lane.resolve = AsyncMock()
        self.lane.tick()
        await self.lane.task
        self.lane.tick()
        self.assertEqual(self.lane.resolve.await_count, 1)
        self.assertEqual(self.lane.get('minibot_hold_reason'), 'activation-observation')

    async def test_pacing_does_not_block_the_current_conversation(self):
        self.lane.put('minibot_next_at', 9999999999)
        factory = AsyncMock(return_value='current-response')
        self.assertEqual(await self.flow.tg(factory, 'EndBot start'), 'current-response')
        self.lane.put('minibot_peer_until', 9999999999)
        with self.assertRaises(BotWait):
            await self.flow.tg(factory, 'EndBot start')
        self.assertEqual(factory.await_count, 1)

    async def test_provider_membership_rejection_after_verified_membership_stops_the_flow(self):
        self.flow.verified_sponsors.add('previously-verified-channel')
        factory = AsyncMock(return_value=SimpleNamespace(message='لطفاً ابتدا در کانال‌ها عضو شوید', alert=True, url=None))
        with self.assertRaises(BotHeld):
            await self.flow.tg(factory, 'verify callback')
        self.assertIsInstance(self.flow.failure, BotHeld)
        self.assertEqual(factory.await_count, 1)

    def test_persisted_api_wait_survives_lane_recreation(self):
        self.lane.account_wait(3600, 'MiniBot start')
        restarted = BotLane(self.pipeline)
        self.assertGreater(restarted.global_until(), 0)
        self.assertGreater(restarted.peer_until(), 0)
        self.assertTrue((self.root / 'wait.json').exists())

    async def test_copy_ack_loss_reconciles_without_repeating_a_send(self):
        self.lane.sync_requests()
        self.pipeline.client.call.side_effect = RuntimeError('simulated transport acknowledgement loss')
        with self.assertRaises(RuntimeError):
            await self.lane.copy_verified(self.message(), self.item)
        row = self.db.execute('SELECT * FROM bot_requests').fetchone()
        self.assertEqual(row['state'], 'forwarding')
        self.assertTrue(row['random_id'])
        self.db.execute('INSERT INTO destination VALUES(?,?)', ('12345', 101))
        self.db.commit()
        before = copy.deepcopy(self.pipeline.state)
        restarted = BotLane(self.pipeline)
        self.assertTrue(restarted.publish_receipts())
        queued = self.pipeline.state['queue'][self.deep]
        self.assertEqual(queued['source'], 'minibot')
        self.assertEqual(queued['url'], 'https://t.me/testanivers/101')
        self.assertEqual(self.pipeline.state['anime'], before['anime'])
        self.assertFalse(restarted.publish_receipts())
        self.assertEqual(self.pipeline.client.call.await_count, 1)

    def test_a_newer_file_selection_is_not_overwritten_by_an_old_receipt(self):
        self.lane.sync_requests()
        record = document_record(self.anime, self.item, self.message())
        self.db.execute("UPDATE bot_requests SET state='copied',record=?,destination_id=101,received_at='now'", (json.dumps(record),))
        self.pipeline.state['anime']['a']['episodes']['2']['720p'] = 'new-revision'
        before = copy.deepcopy(self.pipeline.state)
        self.assertFalse(self.lane.publish_receipts())
        self.assertEqual(self.pipeline.state, before)
        self.assertEqual(self.db.execute('SELECT state FROM bot_requests').fetchone()[0], 'superseded')


if __name__ == '__main__':
    unittest.main()
