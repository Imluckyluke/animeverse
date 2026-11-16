from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from download_cache import CacheStore, CacheError


class DownloadControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = CacheStore(Path(self.temp.name) / 'cache.sqlite')
        self.item = {'slug': 'example', 'episode': 3, 'quality': '720p', 'source_id': 10, 'size': 1234}
        self.client = 'a' * 64

    def tearDown(self):
        self.store.db.close()
        self.temp.cleanup()

    def test_pause_resume_uses_same_request_and_survives_reopen(self):
        row = self.store.request(self.item, self.client, 'test-request-valid-1')
        self.store.claim()
        self.store.control_request('test-request-valid-1', row['key'], False, True)
        self.assertFalse(self.store.has_active_demand(row['key']))
        self.store.suspend(row['key'])
        self.assertIsNone(self.store.claim())
        self.store.control_request('test-request-valid-1', row['key'], False, False)
        self.assertEqual(self.store.claim()['key'], row['key'])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM requests').fetchone()[0], 1)

    def test_pausing_one_request_does_not_stop_another_request(self):
        row = self.store.request(self.item, self.client, 'test-request-valid-1')
        self.store.request(self.item, self.client, 'test-request-valid-2')
        self.store.control_request('test-request-valid-1', row['key'], False, True)
        self.assertTrue(self.store.has_active_demand(row['key']))
        self.assertEqual(self.store.claim()['key'], row['key'])
        with self.assertRaises(CacheError):
            self.store.control_request('not-the-owner-request', row['key'], False, True)

    def test_batch_pause_prevents_claiming_all_members(self):
        batch = self.store.request_batch([self.item, {**self.item, 'episode': 4}], self.client, 'test-batch-request-1')
        self.store.control_request('test-batch-request-1', batch, True, True)
        self.assertIsNone(self.store.claim())
        self.store.control_request('test-batch-request-1', batch, True, False)
        self.assertIsNotNone(self.store.claim())

    def test_one_batch_member_pauses_independently_and_survives_reopen(self):
        batch = self.store.request_batch([self.item, {**self.item, 'episode': 4}], self.client, 'test-batch-request-1')
        items = self.store.public_batch(batch)['items']
        self.store.control_request('test-batch-request-1', batch, True, True, items[0]['job'])
        self.assertFalse(self.store.has_active_demand(items[0]['job']))
        self.assertTrue(self.store.has_active_demand(items[1]['job']))
        self.assertEqual(self.store.claim()['key'], items[1]['job'])
        self.store.db.close()
        self.store = CacheStore(Path(self.temp.name) / 'cache.sqlite')
        self.assertFalse(self.store.has_active_demand(items[0]['job']))
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM requests').fetchone()[0], 1)

    def test_one_member_can_resume_while_its_batch_is_paused(self):
        batch = self.store.request_batch([self.item, {**self.item, 'episode': 4}], self.client, 'test-batch-request-1')
        items = self.store.public_batch(batch)['items']
        self.store.control_request('test-batch-request-1', batch, True, True)
        self.store.control_request('test-batch-request-1', batch, True, False, items[0]['job'])
        self.assertTrue(self.store.has_active_demand(items[0]['job']))
        self.assertFalse(self.store.has_active_demand(items[1]['job']))
        self.assertEqual(self.store.claim()['key'], items[0]['job'])
        self.store.control_request('test-batch-request-1', batch, True, True)
        self.assertFalse(self.store.has_active_demand(items[0]['job']))
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM request_job_controls').fetchone()[0], 0)
        self.store.control_request('test-batch-request-1', batch, True, False)
        self.assertTrue(all(self.store.has_active_demand(item['job']) for item in items))

    def test_batch_member_control_does_not_stop_another_subscription(self):
        batch = self.store.request_batch([self.item], self.client, 'test-batch-request-1')
        job = self.store.public_batch(batch)['items'][0]['job']
        self.store.request(self.item, 'b' * 64, 'test-independent-req-2')
        self.store.control_request('test-batch-request-1', batch, True, True, job)
        self.assertTrue(self.store.has_active_demand(job))
        self.store.control_request('test-independent-req-2', job, False, True)
        self.assertFalse(self.store.has_active_demand(job))

    def test_member_control_requires_request_and_batch_membership(self):
        batch = self.store.request_batch([self.item], self.client, 'test-batch-request-1')
        foreign = self.store.request({**self.item, 'episode': 9}, self.client, 'test-independent-req-2')
        for request_id, job in [('test-batch-request-1', foreign['key']), ('unrelated-request-12', foreign['key'])]:
            with self.assertRaises(CacheError):
                self.store.control_request(request_id, batch, True, True, job)
        with self.assertRaises(CacheError):
            self.store.control_request('test-batch-request-1', batch, True, True, 'bad-key')
        self.assertTrue(self.store.has_active_demand(foreign['key']))
