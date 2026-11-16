from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from admin_auth import AuthStore, AdminError, hash_password


class OwnerAccessTests(unittest.TestCase):
    def test_single_use_owner_only_expiring_access_preserves_password(self):
        with tempfile.TemporaryDirectory() as folder:
            clock = [1000000.0]
            store = AuthStore(Path(folder) / 'auth.sqlite', 'owner@example.test', hash_password('original-password'), now=lambda: clock[0])
            try:
                before = store.db.execute('SELECT password_hash FROM users').fetchone()[0]
                with self.assertRaises(AdminError): store.issue_owner_access('not-owner@example.test')
                token = store.issue_owner_access('owner@example.test')
                self.assertNotEqual(store.db.execute('SELECT token_hash FROM owner_access').fetchone()[0], token)
                session = store.redeem_owner_access(token, 'test-device')
                self.assertEqual(store.session(session['token'], 'account')['user']['role'], 'owner')
                with self.assertRaises(AdminError): store.redeem_owner_access(token, 'test-device')
                self.assertEqual(store.db.execute('SELECT password_hash FROM users').fetchone()[0], before)
                expired = store.issue_owner_access('owner@example.test', 60)
                clock[0] += 61
                with self.assertRaises(AdminError): store.redeem_owner_access(expired, 'test-device')
            finally:
                store.close()
