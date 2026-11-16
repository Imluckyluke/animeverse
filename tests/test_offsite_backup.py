import base64
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'ops'))
from offsite_backup import GitHub, VercelRecoveryVault, decrypt, encrypt, recovery_key, secret_name


class EncryptedBackupTests(unittest.TestCase):
    def test_authenticated_roundtrip_and_corruption_rejection(self):
        with tempfile.TemporaryDirectory() as folder:
            key = recovery_key(Path(folder) / 'key')
            self.assertEqual(key, recovery_key(Path(folder) / 'key'))
            payload = encrypt(b'private database fixture', key)
            self.assertNotIn(b'private database fixture', payload)
            self.assertEqual(decrypt(payload, key), b'private database fixture')
            for changed in [payload[:-1] + bytes([payload[-1] ^ 1]), b'invalid']:
                with self.assertRaises(Exception):
                    decrypt(changed, key)

    def test_world_readable_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'key'
            recovery_key(path)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                recovery_key(path)

    def test_rotated_keys_have_distinct_secrets_and_public_repository_is_rejected(self):
        self.assertNotEqual(secret_name(b'a' * 32), secret_name(b'b' * 32))
        calls = []
        client = GitHub('test-token')
        def request(route, **kwargs):
            calls.append((route, kwargs))
            return {'private': False, 'permissions': {'admin': True}}
        client.request = request
        with self.assertRaises(RuntimeError):
            client.upload_and_download(b'encrypted', 'tag', 'commit', {})
        self.assertEqual(len(calls), 1)

    def test_remote_key_uses_development_only_and_is_recovered_before_acknowledgement(self):
        key = b'a' * 32
        vault = VercelRecoveryVault('test-token')
        entries, writes = [], []
        def request(path, method='GET', payload=None):
            if '/v9/projects/' in path:
                return {'id': vault.PROJECT}
            if method == 'POST':
                writes.append(payload)
                entries.append({**payload, 'id': 'recovery-env-id'})
                return {}
            if '/v1/projects/' in path:
                return {'value': base64.b64encode(key).decode()}
            return {'envs': entries}
        vault.request = request
        restored, reference = vault.store_and_recover(key)
        self.assertEqual(restored, key)
        self.assertEqual(writes[0]['target'], ['development'])
        self.assertEqual(reference['target'], ['development'])
        vault.store_and_recover(key)
        self.assertEqual(len(writes), 1, 'existing keys must not be overwritten')


if __name__ == '__main__':
    unittest.main()
