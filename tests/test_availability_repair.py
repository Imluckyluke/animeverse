import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools/tg"))
from archive_pipeline import open_db, publish_record, store_record
from catalog import build_catalog
from repair_availability import reconcile, verify_destination, verify_destination_page
from publish_catalog import validate_catalog, verify


class AvailabilityRepairTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = open_db(Path(self.temp.name) / "queue.sqlite3")
        self.state = {"anime": {"a1": {"slug": "title", "titleEn": "Title", "episodes": {"3": {"1080p": "metadata"}}}},
                      "queue": {"metadata": {"status": "pending"}}}

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def record(self, number, copied=False):
        record = {"id": number, "title": "Title", "episode": number, "quality": "1080p", "size": 123}
        store_record(self.db, record)
        self.db.execute("UPDATE files SET anime_key='a1',state=?,destination_id=? WHERE id=?", ("copied" if copied else "pending", 100 + number if copied else None, number))

    def test_empty_title_is_not_public_but_pending_inventory_survives(self):
        before = copy.deepcopy(self.state)
        self.assertEqual(build_catalog(self.state), [])
        self.assertEqual(self.state, before)

    def test_only_real_downloadable_episodes_and_qualities_are_public(self):
        anime = self.state["anime"]["a1"]
        anime["episodes"]["1"] = {"720p": "good", "1080p": "bad"}
        self.state["queue"].update(good={"status": "done", "url": "https://t.me/testanivers/101"}, bad={"status": "done", "url": "javascript:bad"})
        row = build_catalog(self.state)[0]
        self.assertEqual(row["highestEpisode"], 1)
        self.assertEqual(row["readyCount"], 1)
        self.assertEqual(row["quality"], ["720p"])
        self.assertEqual([e["number"] for e in row["episodeData"]], [1])

    def test_copied_files_are_reconnected_even_if_export_was_marked_done(self):
        self.record(1, copied=True)
        self.db.execute("UPDATE files SET published=1 WHERE id=1")
        result = reconcile(self.state, self.db, publish_record)
        self.assertEqual(result["reconnectedLinks"], 1)
        self.assertEqual(build_catalog(self.state)[0]["readyCount"], 1)
        self.assertEqual(self.state["anime"]["a1"]["episodes"]["1"]["1080p"], "archive:1")

    def test_all_archive_episode_slots_are_attached_not_just_the_latest_post(self):
        for n in [1, 2, 3]: self.record(n)
        result = reconcile(self.state, self.db, publish_record)
        self.assertEqual(result["createdQueueEntries"], 3)
        self.assertEqual(set(self.state["anime"]["a1"]["episodes"]), {"1", "2", "3"})
        self.assertIn("metadata", self.state["queue"], "original provider inventory is not destroyed")
        self.assertEqual(self.db.execute("SELECT priority FROM files WHERE id=1").fetchone()[0], 300)
        self.assertEqual(self.db.execute("SELECT priority FROM files WHERE id=2").fetchone()[0], 200)
        again = reconcile(self.state, self.db, publish_record)
        self.assertEqual(again.get("createdQueueEntries", 0), 0)
        self.assertEqual(again.get("attachedArchiveSlots", 0), 0)

    def test_ambiguous_seasons_are_not_published_as_complete(self):
        self.record(1, copied=True)
        self.db.execute("INSERT INTO bindings VALUES ('Title',NULL,1)")
        result = reconcile(self.state, self.db, publish_record)
        self.assertEqual(result["ambiguousFiles"], 1)
        self.assertEqual(build_catalog(self.state), [])

    def test_copy_export_refuses_an_explicit_season_mismatch(self):
        self.record(1, copied=True)
        self.state['anime']['a1']['titleEn'] = 'Title Season 2'
        record = {'id':1, 'title':'Title Season 1', 'season':1, 'episode':1, 'quality':'1080p'}
        self.db.execute('UPDATE files SET record=? WHERE id=1', (json.dumps(record),))
        row = self.db.execute('SELECT * FROM files WHERE id=1').fetchone()
        self.assertFalse(publish_record(self.state, row))
        self.assertEqual(build_catalog(self.state), [])

    def test_live_items_keep_priority_and_retry_wait_is_respected(self):
        self.record(1)
        self.db.execute("UPDATE files SET priority=1000,retry_at=9999999999 WHERE id=1")
        reconcile(self.state, self.db, publish_record)
        row = self.db.execute("SELECT priority,retry_at FROM files WHERE id=1").fetchone()
        self.assertEqual(tuple(row), (1000, 9999999999))

    def test_publisher_refuses_empty_or_pending_downloads(self):
        with self.assertRaises(RuntimeError): validate_catalog([])
        with self.assertRaises(RuntimeError): validate_catalog([{"slug": "test", "episodeData": []}])
        with self.assertRaises(RuntimeError): validate_catalog([{"slug": "test", "episodeData": [{"number":1,"qualities":[{"status":"pending","url":"https://example.org/a"}]}]}])
        validate_catalog([{"slug": "test", "episodeData": [{"number":1,"qualities":[{"status":"done","url":"https://example.org/a"}]}]}])

    def test_deleted_destination_file_is_queued_for_a_fresh_copy(self):
        self.record(1, copied=True)
        self.record(2, copied=True)
        self.db.execute("UPDATE files SET random_id=123 WHERE id=2")
        self.db.execute("INSERT INTO destination VALUES ('doc2',102)")
        self.state["queue"].update(good={"status":"done","url":"https://t.me/testanivers/101"},
                                   gone={"status":"done","url":"https://t.me/testanivers/102"})
        client=SimpleNamespace(get_messages=AsyncMock(return_value=[SimpleNamespace(id=101,document=object()), None]))
        with patch('repair_availability.asyncio.sleep',new=AsyncMock()):
            result=asyncio.run(verify_destination(self.state,self.db,client,object()))
        self.assertEqual(result['invalidDestinationFiles'],1)
        self.assertEqual(self.state['queue']['good']['status'],'done')
        self.assertEqual(self.state['queue']['gone']['status'],'pending')
        self.assertNotIn('url',self.state['queue']['gone'])
        row=self.db.execute('SELECT state,random_id,destination_id FROM files WHERE id=2').fetchone()
        self.assertEqual(row['state'],'pending')
        self.assertNotEqual(row['random_id'],123)
        self.assertIsNone(row['destination_id'])

    def test_paged_verification_resumes_and_does_not_retry_during_wait(self):
        from telethon.errors import FloodWaitError
        for number in range(1, 202):
            self.state['queue'][str(number)] = {'status': 'done', 'url': f'https://t.me/testanivers/{number}'}
        client = SimpleNamespace(get_messages=AsyncMock(side_effect=FloodWaitError(request=None, capture=28)))
        first = asyncio.run(verify_destination_page(self.state, self.db, client, object()))
        self.assertEqual(first['remaining'], 201)
        self.assertEqual(first['waitingSec'], 33)
        self.assertIsNone(asyncio.run(verify_destination_page(self.state, self.db, client, object())))
        self.assertEqual(client.get_messages.await_count, 1)
        self.db.execute("UPDATE settings SET value='0' WHERE key='verification_next_at'")
        client.get_messages.side_effect = None
        client.get_messages.return_value = [SimpleNamespace(id=n, document=object()) for n in range(102, 202)]
        result = asyncio.run(verify_destination_page(self.state, self.db, client, object()))
        self.assertEqual(result, {'checked':100, 'invalidTotal':0, 'invalidNow':0, 'remaining':101})
        self.assertEqual(client.get_messages.call_args.kwargs['ids'], list(range(201,101,-1)))

    def test_online_gate_checks_all_titles_and_descending_episode_lists(self):
        import io
        self.state['anime']['a1']['episodes'] = {'1': {'1080p': 'one'}, '2': {'1080p':'two'}}
        self.state['queue'].update(one={'status':'done','url':'https://t.me/testanivers/101'},
                                   two={'status':'done','url':'https://t.me/testanivers/102'})
        rows = build_catalog(self.state)
        item = {**rows[0], 'episodeNumbers':[2,1]}
        public = [{'slug':'title'}]
        def response(url, **kwargs):
            if '/api/admin/session' in url or '/api/admin/overview' in url:
                import urllib.error
                raise urllib.error.HTTPError(url, 404, 'Not found', {}, None)
            elif '/api/catalog-search' in url: payload = public
            elif '/api/catalog-items?' in url: payload = [item]
            elif '/api/link?' in url: payload = {'url':'https://t.me/testanivers/102'}
            else: payload = {}
            handle = io.BytesIO(json.dumps(payload).encode())
            handle.status = 200
            return handle
        with patch('publish_catalog.urllib.request.urlopen', side_effect=response):
            verify('https://example.org', rows, rows)
            item['episodeNumbers'] = [2]
            with self.assertRaisesRegex(RuntimeError, 'episode inventory'):
                verify('https://example.org', rows, rows)
            item['episodeNumbers'] = [2,1]
            public.append({'slug':'empty-phantom-title'})
            with self.assertRaisesRegex(RuntimeError, 'title inventory'):
                verify('https://example.org', rows, rows)


if __name__ == "__main__":
    unittest.main()
