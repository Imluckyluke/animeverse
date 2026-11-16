import base64
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from admin_service import AdminError, ControlAPI, DataView, media_upload
from admin_store import AdminStore, hash_password
from archive_pipeline import open_db, store_record


class ControlAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'owner-api-test-password'
        cls.hashed = hash_password(cls.password)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / 'data').mkdir()
        self.path = self.root / 'data/admin.sqlite3'
        self.store = AdminStore(self.path, 'owner@example.test', self.hashed)
        self.owner = self.store.accounts()['items'][0]['id']
        self.anime = {'key': 'al123', 'slug': 'example', 'titleEn': 'Example', 'titleOriginal': 'Example', 'titleFa': 'مثال',
                      'year': 2020, 'format': 'TV', 'type': 'سریال', 'declaredEpisodes': 12, 'metadataProviderId': 123,
                      'metadataSource': 'anilist', 'verifiedArchiveTitles': ['Example'], 'episodes': {'2': {'720p': 'old'}}}
        self.state = {'anime': {'al123': self.anime}, 'queue': {'old': {'status': 'done', 'url': 'https://t.me/testanivers/100'}}}
        (self.root / 'data/aniplus-state.json').write_text(json.dumps(self.state))
        self.archive = open_db(self.root / 'data/archive-pipeline.sqlite3')
        self.record = {'id': 1, 'title': 'Example', 'name': 'Example - 03 [720p].mkv', 'episode': 3, 'quality': '720p', 'size': 1000}
        store_record(self.archive, self.record)
        self.archive.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
        self.archive.commit()
        self.rows = [{'slug': 'example', 'title': 'مثال', 'titleEn': 'Example', 'episodeData': [
            {'number': 2, 'qualities': [{'label': '720p', 'status': 'done', 'url': 'https://t.me/testanivers/100'}]}]}]
        self.base_patch = patch.object(DataView, 'base_rows', lambda view: self.rows)
        self.base_patch.start()
        self.api = ControlAPI(self.root, self.path)
        code, result = self.api.dispatch('POST', '/v1/account/login', {}, {'email': 'owner@example.test', 'password': self.password}, {'X-Client-Key': 'owner'})
        self.assertEqual(code, 200)
        self.headers = {'X-Session-Token': result['token'], 'X-CSRF-Token': result['csrf'], 'X-Client-Key': 'owner'}

    def tearDown(self):
        self.base_patch.stop()
        self.archive.close()
        self.store.close()
        self.folder.cleanup()

    def test_real_server_edit_and_optimistic_version_are_shared(self):
        code, result = self.api.dispatch('PATCH', '/v1/admin/catalog/example', {},
            {'expectedRevision': 0, 'patch': {'titleEn': 'Updated Example'}, 'note': 'Correct an editorial label'}, self.headers)
        self.assertEqual(code, 200)
        self.assertEqual(result['revision'], 1)
        other = ControlAPI(self.root, self.path)
        _, detail = other.dispatch('GET', '/v1/admin/catalog/example', {}, {}, self.headers)
        self.assertEqual(detail['item']['titleEn'], 'Updated Example')
        self.assertEqual(json.loads((self.root / 'data/aniplus-state.json').read_text())['anime']['al123']['titleEn'], 'Example')
        with self.assertRaises(AdminError) as error:
            self.api.dispatch('PATCH', '/v1/admin/catalog/example', {}, {'expectedRevision': 0, 'patch': {'hidden': True}, 'note': 'Reject the stale operation'}, self.headers)
        self.assertEqual(error.exception.status, 409)

    def test_csrf_account_cookie_and_forged_preview_do_not_authorize(self):
        with self.assertRaises(AdminError) as error:
            self.api.dispatch('PATCH', '/v1/admin/catalog/example', {}, {}, {'X-Session-Token': self.headers['X-Session-Token']})
        self.assertEqual(error.exception.status, 403)
        user = self.store.create_account('Regular', 'regular@example.test', self.password)
        login = self.store.login(user['email'], self.password, 'regular', 'account')
        with self.assertRaises(AdminError):
            self.api.dispatch('GET', '/v1/admin/users', {}, {}, {'X-Session-Token': login['token']})
        with self.assertRaises(AdminError):
            self.api.dispatch('POST', '/v1/admin/review/apply', {}, {'previewId': 'forged', 'confirm': True, 'valid': True}, self.headers)

    def test_episode_controls_cannot_manufacture_an_episode(self):
        with self.assertRaises(AdminError):
            self.api.dispatch('PATCH', '/v1/admin/catalog/example/episodes', {}, {'expectedRevision': 0, 'episode': 99,
                'quality': '720p', 'hidden': False, 'note': 'No phantom episode allowed'}, self.headers)
        _, result = self.api.dispatch('PATCH', '/v1/admin/catalog/example/episodes', {}, {'expectedRevision': 0, 'episode': 2,
            'quality': '720p', 'hidden': True, 'note': 'Hide one known ready quality'}, self.headers)
        self.assertEqual(result['revision'], 1)
        _, detail = self.api.dispatch('GET', '/v1/admin/catalog/example', {}, {}, self.headers)
        self.assertTrue(detail['episodes'][0]['qualities'][0]['hidden'])

    def test_preview_binds_a_durable_command_not_a_fake_success(self):
        _, preview = self.api.dispatch('POST', '/v1/admin/review/preview', {},
            {'fileId': 1, 'targetSlug': 'example', 'episode': 3, 'quality': '720p', 'note': 'Verified exact source labels'}, self.headers)
        self.assertTrue(preview['valid'])
        code, result = self.api.dispatch('POST', '/v1/admin/review/apply', {}, {'previewId': preview['id'], 'confirm': True}, self.headers)
        self.assertEqual(code, 202)
        self.assertEqual(result['state'], 'pending')
        self.assertIsNone(self.archive.execute('SELECT anime_key FROM files WHERE id=1').fetchone()[0])
        _, again = self.api.dispatch('POST', '/v1/admin/review/apply', {}, {'previewId': preview['id'], 'confirm': True}, self.headers)
        self.assertEqual(result['commandId'], again['commandId'])

    def test_wrong_quality_episode_and_explicit_year_fail_preview(self):
        for changes in [{'episode': 4}, {'quality': '1080p'}, {'episode': 13}]:
            _, result = self.api.dispatch('POST', '/v1/admin/review/preview', {},
                {'fileId': 1, 'targetSlug': 'example', 'episode': 3, 'quality': '720p', 'note': 'Reject contradictory source data', **changes}, self.headers)
            self.assertFalse(result['valid'])

    def test_review_displays_filename_identity_when_resolution_is_missing(self):
        raw = {'id': 2, 'name': 'Kiznaiver HD - 05.mkv', 'size': 100}
        store_record(self.archive, raw)
        self.archive.execute("UPDATE files SET state='copied',destination_id=102 WHERE id=2")
        self.archive.commit()
        _, result = self.api.dispatch('GET', '/v1/admin/review', {'q': 'Kiznaiver'}, {}, self.headers)
        item = next(item for item in result['items'] if item['id'] == 2)
        self.assertEqual(item['title'], 'Kiznaiver')
        self.assertEqual(item['episode'], 5)
        self.assertEqual(item['quality'], '')
        self.assertIn('وضوح عددی', item['reason'])
        row = self.archive.execute('SELECT * FROM files WHERE id=2').fetchone()
        self.assertEqual(json.loads(row['record']), raw)
        self.assertIsNone(row['anime_key'])

    def test_safe_media_is_reencoded_and_svg_is_rejected(self):
        from PIL import Image
        output = io.BytesIO()
        Image.new('RGB', (16, 16), 'red').save(output, 'PNG')
        result = media_upload(self.root, {'mime': 'image/png', 'data': base64.b64encode(output.getvalue()).decode()})
        image = self.root / 'public' / result['url'].lstrip('/')
        self.assertTrue(image.is_file())
        with Image.open(image) as decoded:
            self.assertEqual(decoded.format, 'WEBP')
        with self.assertRaises(AdminError):
            media_upload(self.root, {'mime': 'image/png', 'data': base64.b64encode(b'<svg><script>bad()</script></svg>').decode()})

    def test_real_account_routes_persist_preferences_without_admin_access(self):
        with self.assertRaises(AdminError):
            self.api.dispatch('POST', '/v1/account/register', {}, {'name': 'Reader', 'email': 'reader@example.test',
                'password': self.password, 'role': 'owner'}, {'X-Client-Key': 'reader'})
        code, account = self.api.dispatch('POST', '/v1/account/register', {}, {'name': 'Reader',
            'email': 'reader@example.test', 'password': self.password}, {'X-Client-Key': 'reader'})
        self.assertEqual(code, 200)
        self.assertEqual(account['user']['role'], 'user')
        headers = {'X-Session-Token': account['token'], 'X-CSRF-Token': account['csrf'], 'X-Client-Key': 'reader'}
        with self.assertRaises(AdminError):
            self.api.dispatch('GET', '/v1/admin/overview', {}, {}, headers)
        _, preferences = self.api.dispatch('POST', '/v1/account/preferences', {}, {'operations': [
            {'id': 'a' * 32, 'type': 'favorite', 'slug': 'example', 'value': True}]}, headers)
        self.assertEqual(preferences['favorites'], ['example'])
        other_device = ControlAPI(self.root, self.path)
        _, persisted = other_device.dispatch('GET', '/v1/account/session', {}, {}, headers)
        self.assertEqual(persisted['preferences']['favorites'], ['example'])
        self.assertNotIn('token', persisted)


if __name__ == '__main__':
    unittest.main()
