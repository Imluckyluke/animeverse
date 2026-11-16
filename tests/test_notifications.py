import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from admin_service import ControlAPI
from admin_store import AdminStore, AdminError, hash_password
from notification_store import Notifications
from notify_bot import NotificationBot
import notify_bot


class NotificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'test-only-notification-password'
        cls.hashed = hash_password(cls.password)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.data = Path(self.folder.name) / 'data'
        self.data.mkdir()
        self.store = AdminStore(self.data / 'admin.sqlite3', 'owner@example.test', self.hashed)
        self.owner = self.store.accounts()['items'][0]['id']
        self.other = self.store.create_account('Another user', 'another@example.test', self.password)['id']
        self.n = Notifications(self.store, self.data)
        (self.data / 'notify-bot.json').write_text(json.dumps({'username': 'TestNotificationBot'}))
        (self.data / 'notify-bot-health.json').write_text(json.dumps({'state': 'running', 'heartbeat': time.time()}))
        self.call = Mock(return_value={'ok': True, 'result': {'message_id': 123}})
        self.bot = NotificationBot(self.store, self.call)

    def tearDown(self):
        self.store.close()
        self.folder.cleanup()

    def link(self, user=None, chat=42):
        code = self.n.link(user or self.owner)['url'].split('start=')[1]
        self.n.redeem(code, chat)
        return code

    def like(self, user=None, slugs=None):
        self.store.db.execute('INSERT OR REPLACE INTO preferences VALUES(?,?,0)', (user or self.owner,
            json.dumps({'favorites': slugs or ['example'], 'watched': {}, 'library': {}})))

    def rows(self, episodes):
        return [{'slug': 'example', 'title': 'Example II', 'episodeData': [{'number': value, 'qualities': [{'status': 'done', 'url': 'https://t.me/testanivers/100'}]} for value in episodes]}]

    def intent(self, episodes, ident='source-event-1'):
        with (self.data / 'notify-events.jsonl').open('a') as stream:
            stream.write(json.dumps({'id': ident, 'slug': 'example', 'episodes': episodes}) + '\n')

    def enqueue(self):
        self.link(); self.like()
        self.n.publication(self.rows([1]), 'verified-initial')
        self.intent([2])
        self.n.publication(self.rows([1, 2]), 'verified-new')

    def test_link_code_is_hashed_single_use_expiring_and_account_bound(self):
        code = self.link()
        self.assertNotIn(code, self.store.db.execute('SELECT hash FROM notify_account_links').fetchone()[0])
        self.assertTrue(self.n.status(self.owner)['linked'])
        self.assertFalse(self.n.status(self.other)['linked'])
        with self.assertRaises(AdminError): self.n.redeem(code, 99)
        other_code = self.n.link(self.other)['url'].split('start=')[1]
        with self.assertRaises(AdminError): self.n.redeem(other_code, 42)
        self.store.db.execute('UPDATE notify_account_links SET expires_at=0')
        with self.assertRaises(AdminError): self.n.redeem(other_code, 99)

    def test_initial_activation_never_replays_the_historical_archive(self):
        self.link(); self.like(); self.intent([1])
        self.assertEqual(self.n.publication(self.rows([1]), 'initial'), 0)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM notify_outbox').fetchone()[0], 0)

    def test_live_intent_waits_for_actual_verified_publication_and_sends_once(self):
        self.link(); self.like(); self.n.publication(self.rows([1]), 'initial')
        self.intent([2])
        self.n.publication(self.rows([1]), 'still-not-ready')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM notify_outbox').fetchone()[0], 0)
        self.n.publication(self.rows([1, 2]), 'ready')
        self.bot.drain()
        row = self.store.db.execute('SELECT * FROM notify_outbox').fetchone()
        self.assertEqual(row['state'], 'sent')
        self.assertEqual(row['message_id'], 123)
        self.n.publication(self.rows([1, 2]), 'same-episode-new-quality')
        self.bot.drain()
        self.assertEqual(self.call.call_count, 1)

    def test_archive_copy_without_live_source_intent_does_not_notify(self):
        self.link(); self.like(); self.n.publication(self.rows([1]), 'initial')
        self.n.publication(self.rows([1, 2]), 'archive-backfill')
        self.bot.drain(); self.call.assert_not_called()

    def test_overlapping_live_posts_do_not_repeat_the_same_episode(self):
        self.link(); self.like(); self.n.publication(self.rows([1]), 'initial')
        self.intent([2, 3], 'first'); self.intent([3, 4], 'second')
        self.n.publication(self.rows([1, 2, 3, 4]), 'new')
        episodes = [number for row in self.store.db.execute('SELECT episodes FROM notify_releases') for number in json.loads(row[0])]
        self.assertEqual(sorted(episodes), [2, 3, 4])

    def test_partial_event_line_waits_for_completion_and_nonfavorite_is_not_notified(self):
        self.link(); self.like(slugs=['different-anime']); self.n.publication(self.rows([1]), 'initial')
        path = self.data / 'notify-events.jsonl'
        path.write_text(json.dumps({'id': 'partial', 'slug': 'example', 'episodes': [2]}))
        self.n.publication(self.rows([1]), 'no-newline')
        self.assertEqual(self.n.meta('intent_offset'), 0)
        with path.open('a') as stream: stream.write('\n')
        self.n.publication(self.rows([1, 2]), 'complete')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM notify_outbox').fetchone()[0], 0)

    def test_only_current_liked_enabled_accounts_receive_and_recheck_before_send(self):
        self.enqueue()
        self.n.preference(self.owner, False)
        self.bot.drain()
        self.call.assert_not_called()
        self.assertEqual(self.store.db.execute('SELECT state FROM notify_outbox').fetchone()[0], 'skipped')

    def test_failed_send_survives_restart_and_respects_retry_deadline(self):
        self.enqueue()
        self.call.return_value = {'ok': False, 'error_code': 503}
        self.bot.drain()
        row = self.store.db.execute('SELECT * FROM notify_outbox').fetchone()
        self.assertEqual(row['state'], 'pending')
        self.assertGreater(row['retry_at'], time.time())
        NotificationBot(self.store, self.call).drain()
        self.assertEqual(self.call.call_count, 1)

    def test_telegram_wait_is_durable_and_blocks_other_api_calls(self):
        self.enqueue()
        self.call.return_value = {'ok': False, 'error_code': 429, 'parameters': {'retry_after': 3600}}
        self.bot.drain()
        restarted = NotificationBot(self.store, self.call)
        restarted.menu(42)
        restarted.drain()
        self.assertEqual(self.call.call_count, 1)
        self.assertGreater(self.n.meta('telegram_wait_until'), time.time() + 3500)

    def test_blocked_bot_disables_delivery_and_ambiguous_ack_does_not_duplicate(self):
        self.enqueue()
        self.call.return_value = {'ok': False, 'error_code': 0}
        self.bot.drain(); self.bot.drain()
        self.assertEqual(self.call.call_count, 1)
        self.assertEqual(self.store.db.execute('SELECT state FROM notify_outbox').fetchone()[0], 'uncertain')
        self.store.db.execute("UPDATE notify_outbox SET state='pending'")
        self.call.return_value = {'ok': False, 'error_code': 403}
        self.bot.drain()
        self.assertFalse(self.n.status(self.owner)['enabled'])

    def test_personalized_menu_escapes_names_and_never_leaks_email(self):
        self.link(); self.like()
        self.store.db.execute('UPDATE users SET name=? WHERE id=?', ('<script>&MyName', self.owner))
        self.bot.menu(42)
        payload = self.call.call_args.args[1]
        self.assertIn('&lt;script&gt;&amp;MyName', payload['text'])
        self.assertNotIn('owner@example.test', payload['text'])
        self.assertIn('۱', payload['text'])
        buttons = payload['reply_markup']['inline_keyboard']
        self.assertTrue(any(button.get('callback_data') == 'notify:off' for row in buttons for button in row))

    def test_account_buttons_use_the_real_signed_in_profile_route(self):
        self.link()
        with patch.object(notify_bot, 'SITE_URL', 'https://animeverse-xi.vercel.app'):
            self.bot.menu(42)
        buttons = self.call.call_args.args[1]['reply_markup']['inline_keyboard']
        urls = [button['url'] for row in buttons for button in row if 'url' in button]
        self.assertIn('https://animeverse-xi.vercel.app/login', urls)
        self.assertNotIn('https://animeverse-xi.vercel.app/account', urls)

    def test_group_messages_cannot_link_or_display_account_data(self):
        self.link()
        self.bot.handle({'message': {'chat': {'id': -1, 'type': 'group'}, 'from': {'id': 42}, 'text': '/status'}})
        self.call.assert_not_called()

    def test_start_menu_keeps_paused_state_and_disconnect_preserves_favorites(self):
        self.link(); self.like(); self.n.preference(self.owner, False)
        self.bot.handle({'message': {'chat': {'id': 42, 'type': 'private'}, 'from': {'id': 42}, 'text': '/start'}})
        self.assertFalse(self.n.status(self.owner)['enabled'])
        before = copy.deepcopy(self.store.preferences(self.owner))
        self.n.unlink(self.owner)
        self.assertEqual(self.store.preferences(self.owner), before)
        self.assertFalse(self.n.status(self.owner)['linked'])

    def test_account_http_api_requires_session_csrf_and_ignores_forged_identity(self):
        self.link(); self.like()
        api = ControlAPI(self.data.parent)
        login = self.store.login('owner@example.test', self.password, 'notification-tests', 'account')
        headers = {'X-Session-Token': login['token'], 'X-CSRF-Token': login['session']['csrf']}
        with self.assertRaises(AdminError): api.dispatch('GET', '/v1/account/notifications/status', {}, {}, {})
        with self.assertRaises(AdminError): api.dispatch('POST', '/v1/account/notifications/preferences', {}, {'enabled': False}, {'X-Session-Token': login['token']})
        code, status = api.dispatch('GET', '/v1/account/notifications/status', {'clientId': [self.other]}, {}, headers)
        self.assertEqual(code, 200); self.assertTrue(status['linked']); self.assertEqual(status['favoritesCount'], 1)
        with self.assertRaises(AdminError): api.dispatch('POST', '/v1/account/notifications/preferences', {}, {'enabled': False, 'clientId': self.other}, headers)


if __name__ == '__main__': unittest.main()
