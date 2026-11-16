from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from admin_store import AdminStore, AdminError, hash_password
from admin_service import ControlAPI


class OwnerGateTests(unittest.TestCase):
    def test_only_owner_account_session_can_enter_admin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            store = AdminStore(root / 'data/admin.sqlite3', 'owner@example.test', hash_password('test-password'))
            api = ControlAPI(root)
            try:
                owner = store.accounts()['items'][0]['id']
                login = store.login('owner@example.test', 'test-password', 'owner', 'account')
                headers = {'X-Session-Token': login['token'], 'X-CSRF-Token': login['session']['csrf']}
                code, payload = api.dispatch('GET', '/v1/admin/session', {}, {}, headers)
                self.assertEqual(code, 200)
                self.assertEqual(payload['session']['user']['role'], 'owner')
                for role in ['user', 'editor', 'reviewer']:
                    user = store.create_account('Reader', role + '@example.test', 'test-password', role, owner if role != 'user' else None)
                    token = store.login(user['email'], 'test-password', role, 'account')['token']
                    with self.assertRaises(AdminError) as denied:
                        api.dispatch('GET', '/v1/admin/session', {}, {}, {'X-Session-Token': token})
                    self.assertEqual(denied.exception.status, 404)
                for route in ['/v1/admin/session', '/v1/admin/overview']:
                    with self.assertRaises(AdminError) as denied:
                        api.dispatch('GET', route, {}, {}, {})
                    self.assertEqual(denied.exception.status, 404)
                with self.assertRaises(AdminError):
                    api.dispatch('POST', '/v1/admin/session', {}, {'password': 'test-password'}, headers)
            finally:
                store.close()
