import copy
import datetime as dt
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from admin_store import AdminStore, AdminError, hash_password
from archive_pipeline import open_db
import post_imports as imports


class PostImportTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.hashed = hash_password('test-only-owner-password')

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.data = Path(self.folder.name) / 'data'
        self.data.mkdir()
        self.store = AdminStore(self.data / 'admin.sqlite3', 'owner@example.test', self.hashed)
        self.owner = self.store.accounts()['items'][0]['id']
        self.db = open_db(self.data / 'pipeline.sqlite3')
        self.state = {'anime': {}, 'queue': {'accepted-download-original': {'status': 'done', 'url': 'https://t.me/testanivers/12'}}}
        self.message = SimpleNamespace(id=33121, text='source-text', date=dt.datetime.now(dt.timezone.utc), buttons=[])
        self.parsed = {'postId': 33121, 'postUrl': 'https://t.me/aniplus/33121', 'date': self.message.date.isoformat(),
            'animeId': '123', 'titleEn': 'Example II', 'titleOriginal': 'Example II', 'titleFa': 'نمونه دو',
            'format': 'TV', 'type': 'سریال', 'year': 2026, 'declaredEpisodes': 12,
            'episodes': {'2': {'720p': 'https://t.me/AniPlusMiniBot?start=get_test_2'}}}
        self.client = SimpleNamespace(get_messages=AsyncMock(return_value=[self.message]))
        async def tg(factory):
            return await factory()
        self.pipeline = SimpleNamespace(db=self.db, state=self.state, client=self.client, tg=tg,
            aniplus=SimpleNamespace(id=987), cover_keys=set(), bot_lane=SimpleNamespace(last_sync=10))
        self.save = Mock()
        self.backup = Mock()
        self.patches = [patch.object(imports, 'DATA', self.data), patch.object(imports, 'save_state', self.save),
                        patch('admin_commands.backup', self.backup), patch('parse.parse_post', side_effect=lambda *args: copy.deepcopy(self.parsed))]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in reversed(self.patches):
            item.stop()
        self.db.close()
        self.store.close()
        self.folder.cleanup()

    async def ready(self):
        result = imports.request_preview(self.store, self.owner, {'url': 'https://t.me/aniplus/33121'})
        await imports.consume_imports(self.pipeline)
        return imports.get_preview(self.store, self.owner, result['id'])

    def test_source_url_is_exact_channel_not_arbitrary_fetch_or_bot_start(self):
        self.assertEqual(imports.selector({'url': 'https://t.me/aniplus/33121'}), {'postId': 33121})
        self.assertEqual(imports.selector({'posts': 50}), {'posts': 50})
        for body in [{'url': 'https://t.me/another/33121'}, {'url': 'https://t.me/aniplus/33121?x=1'},
                     {'url': 'https://t.me@evil.test/aniplus/33121'}, {'posts': True}, {'posts': 51},
                     {'url': 'https://t.me/aniplus/33121', 'confirm': True}]:
            with self.assertRaises(AdminError):
                imports.selector(body)

    async def test_preview_never_modifies_canonical_state_or_downloads(self):
        before = copy.deepcopy(self.state)
        result = await self.ready()
        self.assertEqual(result['state'], 'preview_ready')
        self.assertEqual(result['items'][0]['titleEn'], 'Example II')
        self.assertEqual(self.state, before)
        self.save.assert_not_called()
        self.backup.assert_not_called()
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_import_sources').fetchone()[0], 0)
        self.client.get_messages.assert_awaited_once_with(self.pipeline.aniplus, ids=[33121])

    async def test_confirm_revalidates_and_enqueues_only_exact_files_idempotently(self):
        result = await self.ready()
        imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': True})
        self.assertTrue(await imports.consume_imports(self.pipeline))
        final = imports.get_preview(self.store, self.owner, result['id'])
        self.assertEqual(final['state'], 'imported')
        self.assertIn('a123', self.state['anime'])
        self.assertEqual(self.state['queue']['accepted-download-original']['status'], 'done')
        self.assertEqual(self.db.execute('SELECT count(*) FROM bot_import_sources').fetchone()[0], 1)
        self.backup.assert_called_once()
        self.assertEqual(imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': True})['state'], 'imported')
        self.assertFalse(await imports.consume_imports(self.pipeline))
        self.backup.assert_called_once()

    async def test_changed_source_after_approval_does_not_merge(self):
        result = await self.ready()
        imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': True})
        self.parsed['episodes']['2']['720p'] = 'https://t.me/AniPlusMiniBot?start=get_different'
        before = copy.deepcopy(self.state)
        self.assertFalse(await imports.consume_imports(self.pipeline))
        self.assertEqual(imports.get_preview(self.store, self.owner, result['id'])['state'], 'failed')
        self.assertEqual(self.state, before)

    async def test_ready_original_link_survives_a_new_approved_post_revision(self):
        first = await self.ready()
        imports.confirm_preview(self.store, self.owner, first['id'], {'confirm': True})
        await imports.consume_imports(self.pipeline)
        original = self.state['anime']['a123']['episodes']['2']['720p']
        self.state['queue'][original].update(status='done', url='https://t.me/testanivers/100', messageId=100)
        before = copy.deepcopy(self.state['queue'][original])
        self.parsed['episodes']['2']['720p'] = 'https://t.me/AniPlusMiniBot?start=get_new_revision'
        second = await self.ready()
        imports.confirm_preview(self.store, self.owner, second['id'], {'confirm': True})
        await imports.consume_imports(self.pipeline)
        self.assertEqual(self.state['anime']['a123']['episodes']['2']['720p'], original)
        self.assertEqual(self.state['queue'][original], before)

    async def test_committed_import_marker_recovers_ack_without_refetching_or_remerging(self):
        result = await self.ready()
        imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': True})
        await imports.consume_imports(self.pipeline)
        self.store.db.execute("UPDATE post_imports SET state='importing' WHERE id=?", (result['id'],))
        before = copy.deepcopy(self.state)
        self.client.get_messages.reset_mock()
        await imports.consume_imports(self.pipeline)
        self.assertEqual(imports.get_preview(self.store, self.owner, result['id'])['state'], 'imported')
        self.assertEqual(self.state, before)
        self.client.get_messages.assert_not_awaited()

    async def test_expiry_and_missing_explicit_confirmation_fail_closed(self):
        result = await self.ready()
        with self.assertRaises(AdminError):
            imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': 1})
        self.store.db.execute('UPDATE post_imports SET expires_at=0 WHERE id=?', (result['id'],))
        with self.assertRaises(AdminError):
            imports.confirm_preview(self.store, self.owner, result['id'], {'confirm': True})
        self.assertEqual(self.state['anime'], {})

    def test_reviewed_identity_is_never_bypassed_by_import(self):
        self.state['anime']['a123'] = {'slug': 'example', 'archiveFileReview': {'version': 1, 'files': {}}}
        with self.assertRaises(AdminError):
            imports.draft_title(self.state, self.parsed, {})

    async def test_non_owner_cannot_request_or_approve(self):
        user = self.store.create_account('Reader', 'reader@example.test', 'test-only-password')
        with self.assertRaises(AdminError):
            imports.request_preview(self.store, user['id'], {'posts': 50})
        result = await self.ready()
        with self.assertRaises(AdminError):
            imports.confirm_preview(self.store, user['id'], result['id'], {'confirm': True})

    async def test_owner_api_requires_csrf_and_never_starts_import_on_preview(self):
        from admin_service import ControlAPI
        login = self.store.login('owner@example.test', 'test-only-owner-password', 'test-client', 'account')
        api = ControlAPI(self.data.parent)
        headers = {'X-Session-Token': login['token'], 'X-CSRF-Token': login['session']['csrf']}
        with self.assertRaises(AdminError):
            api.dispatch('POST', '/v1/admin/imports/preview', {}, {'posts': 50}, {'X-Session-Token': login['token']})
        code, result = api.dispatch('POST', '/v1/admin/imports/preview', {}, {'url': 'https://t.me/aniplus/33121'}, headers)
        self.assertEqual(code, 202)
        self.assertEqual(result['state'], 'preview_pending')
        self.assertEqual(self.state['anime'], {})
        self.assertEqual(self.client.get_messages.await_count, 0)


if __name__ == '__main__':
    unittest.main()
