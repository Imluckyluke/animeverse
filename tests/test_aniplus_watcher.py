"""Offline watcher regressions: no Telegram sessions or live state writes."""
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_pipeline import Pipeline, open_db, setting, set_setting


class WatcherTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.db = open_db(Path(self.folder.name) / 'test.sqlite3')
        set_setting(self.db, 'ani_live', 200)
        set_setting(self.db, 'minibot_live_after_post', 100)
        self.client = SimpleNamespace(get_messages=AsyncMock())
        self.pipeline = SimpleNamespace(db=self.db, client=self.client, aniplus='fixture', tg=lambda f: f())

    def tearDown(self):
        self.db.close()
        self.folder.cleanup()

    def message(self, ident, text):
        return SimpleNamespace(id=ident, text=text, date=None, buttons=None)

    async def test_edit_is_seen_without_advancing_past_forward_backlog(self):
        old = {'postId': 150, 'episodes': {'1': {}}}
        edited = {'postId': 150, 'episodes': {'1': {}, '2': {}}}
        self.db.execute('INSERT INTO posts VALUES(?,?,1)', (150, json.dumps(old)))
        self.client.get_messages.side_effect = [[self.message(201, 'new')],
            [self.message(400, 'later'), self.message(150, 'edited')]]
        def parse(ident, text, *_):
            return edited if ident == 150 else {'postId': ident, 'episodes': {}}
        with patch('archive_pipeline.parse_post', side_effect=parse):
            await Pipeline.scan_aniplus(self.pipeline)
        self.assertEqual(setting(self.db, 'ani_live'), 201)
        row = self.db.execute('SELECT * FROM posts WHERE id=150').fetchone()
        self.assertEqual(row['matched'], 0)
        self.assertEqual(json.loads(row['payload']), edited)
        self.assertEqual(self.client.get_messages.call_args_list[1].kwargs['min_id'], 99)

    async def test_unchanged_post_is_not_rematched_and_edit_scan_is_throttled(self):
        parsed = {'postId': 150, 'episodes': {'1': {}}}
        self.db.execute('INSERT INTO posts VALUES(?,?,1)', (150, json.dumps(parsed)))
        self.client.get_messages.side_effect = [[], [self.message(150, 'same')], []]
        with patch('archive_pipeline.parse_post', return_value=parsed):
            await Pipeline.scan_aniplus(self.pipeline)
            await Pipeline.scan_aniplus(self.pipeline)
        self.assertEqual(self.client.get_messages.await_count, 3)
        self.assertEqual(self.db.execute('SELECT matched FROM posts WHERE id=150').fetchone()[0], 1)
        self.assertEqual(setting(self.db, 'ani_live'), 200)


if __name__ == '__main__':
    unittest.main()
