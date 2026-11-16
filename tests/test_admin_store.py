import json
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from admin_store import AdminError, AdminStore, hash_password, verify_password


class AdminStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'owner-test-password-only'
        cls.hashed = hash_password(cls.password)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'admin.sqlite3'
        self.clock = [1700000000.0]
        self.store = AdminStore(self.path, 'owner@example.test', self.hashed, lambda: self.clock[0])
        self.owner = self.store.accounts()['items'][0]['id']

    def tearDown(self):
        self.store.close()
        self.folder.cleanup()

    def test_bootstrap_does_not_overwrite_password_and_hashes_only(self):
        self.assertTrue(verify_password(self.password, self.hashed))
        self.assertFalse(verify_password('incorrect', self.hashed))
        other = AdminStore(self.path, 'owner@example.test', hash_password('another-password-only'))
        self.assertEqual(other.accounts()['total'], 1)
        self.assertTrue(other.login('owner@example.test', self.password, 'client')['token'])
        row = other.db.execute('SELECT password_hash FROM users').fetchone()[0]
        self.assertNotIn(self.password, row)
        other.close()

    def test_session_purpose_csrf_expiry_revocation(self):
        login = self.store.login('owner@example.test', self.password, 'client')
        token, session = login['token'], login['session']
        self.assertEqual(self.store.session(token)['user']['role'], 'owner')
        with self.assertRaises(AdminError) as failure:
            self.store.session(token, mutation=True)
        self.assertEqual(failure.exception.status, 403)
        self.store.session(token, csrf=session['csrf'], mutation=True)
        with self.assertRaises(AdminError):
            self.store.session(token, 'account')
        self.assertNotEqual(self.store.db.execute('SELECT token_hash FROM sessions').fetchone()[0], token)
        self.clock[0] += 2701
        with self.assertRaises(AdminError):
            self.store.session(token)
        login = self.store.login('owner@example.test', self.password, 'another')
        self.store.logout(login['token'])
        with self.assertRaises(AdminError):
            self.store.session(login['token'])

    def test_persistent_rate_limit_and_no_role_escalation(self):
        for _ in range(8):
            with self.assertRaises(AdminError):
                self.store.login('missing@example.test', 'incorrect-password', 'attacker')
        with self.assertRaises(AdminError) as failure:
            self.store.login('owner@example.test', self.password, 'attacker')
        self.assertEqual(failure.exception.status, 429)
        self.clock[0] += 901
        self.assertTrue(self.store.login('owner@example.test', self.password, 'attacker')['token'])
        with self.assertRaises(AdminError):
            self.store.create_account('Editor', 'editor@example.test', self.password, 'editor')
        with self.assertRaises(AdminError):
            self.store.update_account(self.owner, self.owner, {'disabled': True})

    def test_regular_user_cannot_enter_admin_and_disable_revokes(self):
        user = self.store.create_account('Regular', 'regular@example.test', self.password)
        login = self.store.login(user['email'], self.password, 'regular', 'account')
        with self.assertRaises(AdminError):
            self.store.login(user['email'], self.password, 'regular', 'admin')
        self.store.update_account(self.owner, user['id'], {'disabled': True})
        with self.assertRaises(AdminError):
            self.store.session(login['token'], 'account')

    def test_compare_and_swap_undo_preserves_later_work(self):
        first = self.store.write_override(self.owner, 'example', {'hidden': True}, 0, 'Hide title for review')
        with self.assertRaises(AdminError) as failure:
            self.store.write_override(self.owner, 'example', {'hidden': False}, 0, 'Stale edit is rejected')
        self.assertEqual(failure.exception.status, 409)
        self.store.undo_override(self.owner, first['eventId'], 'Restore previous metadata')
        self.assertEqual(self.store.override('example')['patch'], {})
        self.assertEqual(self.store.override('example')['revision'], 2)
        self.assertEqual(self.store.history()['total'], 2)
        with self.assertRaises(AdminError):
            self.store.undo_override(self.owner, first['eventId'], 'Must not overwrite later edit')

    def test_readonly_reviewer_and_durable_idempotent_commands(self):
        reviewer = self.store.create_account('Reviewer', 'review@example.test', self.password, 'reviewer', self.owner)
        with self.assertRaises(AdminError):
            self.store.write_override(reviewer['id'], 'example', {'hidden': True}, 0, 'Unauthorized title change')
        result = self.store.command(reviewer['id'], 'review.match', {'fileId': 1}, 'preview:1')
        self.assertEqual(self.store.command(reviewer['id'], 'review.match', {'fileId': 1}, 'preview:1')['commandId'], result['commandId'])
        self.assertEqual(len(self.store.claim_commands()), 1)
        self.assertEqual(self.store.claim_commands(), [])
        self.store.finish_command(result['commandId'], 'applied')
        reopened = AdminStore(self.path)
        self.assertEqual(reopened.get_command(result['commandId'])['state'], 'applied')
        reopened.close()

    def test_preferences_merge_and_deduplicate_without_cross_user_changes(self):
        user = self.store.create_account('Regular', 'regular@example.test', self.password)
        op = {'id': uuid.uuid4().hex, 'type': 'favorite', 'slug': 'example', 'value': True}
        self.store.preference_ops(user['id'], [op])
        result = self.store.preference_ops(user['id'], [op])
        self.assertEqual(result['revision'], 1)
        self.store.preference_ops(user['id'], [{'id': uuid.uuid4().hex, 'type': 'watched', 'slug': 'another', 'episode': 12, 'value': True}])
        result = self.store.preferences(user['id'])
        self.assertEqual(result['favorites'], ['example'])
        self.assertEqual(result['watched']['another'], [12])
        self.assertEqual(self.store.preferences(self.owner)['favorites'], [])
        self.assertEqual(self.store.account_stats()['favorites'], 1)

    def test_password_change_revokes_sessions_and_settings_have_cas(self):
        login = self.store.login('owner@example.test', self.password, 'owner')
        self.store.change_password(self.owner, self.password, 'new-password-test-only')
        with self.assertRaises(AdminError):
            self.store.session(login['token'])
        self.store.write_settings(self.owner, 0, 'manual')
        with self.assertRaises(AdminError):
            self.store.write_settings(self.owner, 0, 'automatic')
        self.assertEqual(self.store.settings()['publicationMode'], 'manual')

    def test_private_online_backup_contains_committed_state_and_is_daily(self):
        self.store.write_override(self.owner, 'example', {'hidden': True}, 0, 'Commit an audited visibility change')
        path = self.store.backup()
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.store.backup(), path)
        restored = AdminStore(path)
        try:
            self.assertTrue(restored.override('example')['patch']['hidden'])
            self.assertEqual(restored.history()['total'], 1)
        finally:
            restored.close()

    def test_six_character_password_is_accepted_but_five_is_rejected(self):
        user = self.store.create_account('Reader', 'six@example.test', 'abc123')
        self.assertTrue(self.store.login(user['email'], 'abc123', 'six', 'account')['token'])
        with self.assertRaises(AdminError):
            self.store.create_account('Reader', 'five@example.test', 'abc12')


if __name__ == '__main__':
    unittest.main()
