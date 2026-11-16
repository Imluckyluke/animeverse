import hashlib
from pathlib import Path
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/"tools/tg"))

from local_downloads import LocalStore, MediaServer, parse_range
from download_cache import CacheError


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.clock=[1800000000.0]
        base=Path(self.temp.name)
        self.store=LocalStore(base/'db.sqlite',base/'media','x'*48,limit=1024,reserve_free=0,
                              clock=lambda:self.clock[0],grace=60,ttl=600)
        item={'slug':'sample','episode':1,'quality':'720p','source_id':1,'size':10}
        self.key=self.store.request(item,'a'*64,'test-request-123456')['key']
        self.store.reserve(self.key,10)
        p=base/'media/file.part';p.write_bytes(b'0123456789')
        self.store.commit_file(self.key,'sample.mp4',p,10,hashlib.sha256(p.read_bytes()).hexdigest())
        self.path=self.store.public(self.key)['url'].removeprefix('https://anime.bayerkashan.ir')
        self.server=MediaServer(('127.0.0.1',0),self.store)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'+self.path

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.store.db.close();self.temp.cleanup()

    def fetch(self,method='GET',headers=None):
        return urllib.request.urlopen(urllib.request.Request(self.url,method=method,headers=headers or {}))

    def readers_done(self):
        for _ in range(100):
            with self.store.lock:
                if not self.store.readers.get(self.key,0):return
            time.sleep(.01)
        self.fail('Reader did not finish')

    def test_full_download_cleanup(self):
        with self.fetch() as r:
            self.assertEqual(r.read(),b'0123456789')
            self.assertEqual(r.headers['Cache-Control'],'private, no-store, max-age=0')
        self.readers_done()
        self.clock[0]+=61;self.store.cleanup()
        self.assertEqual(self.store.public(self.key)['status'],'expired')
        self.assertFalse(list(self.store.media.glob('*.bin')))

    def test_head_and_partial_do_not_delete(self):
        with self.fetch('HEAD') as r:self.assertEqual(r.read(),b'')
        with self.fetch(headers={'Range':'bytes=0-4'}) as r:
            self.assertEqual(r.status,206);self.assertEqual(r.read(),b'01234')
        self.clock[0]+=61;self.store.cleanup()
        self.assertEqual(self.store.public(self.key)['status'],'ready')
        with self.fetch(headers={'Range':'bytes=5-'}) as r:self.assertEqual(r.read(),b'56789')
        self.readers_done()
        self.clock[0]+=61;self.store.cleanup()
        self.assertEqual(self.store.public(self.key)['status'],'expired')

    def test_active_reader_blocks_expiry(self):
        row,stream=self.store.acquire(self.path)
        self.clock[0]+=601;self.store.cleanup()
        self.assertTrue(list(self.store.media.glob('*.bin')))
        stream.close();self.store.release(row['key']);self.store.cleanup()
        self.assertFalse(list(self.store.media.glob('*.bin')))

    def test_signature_and_range_rejected(self):
        with self.assertRaises(CacheError):self.store.acquire(self.path[:-1]+('0' if self.path[-1]!='0' else '1'))
        with self.assertRaises(urllib.error.HTTPError) as e:self.fetch(headers={'Range':'bytes=99-'})
        self.assertEqual(e.exception.code,416)
        with self.assertRaises(CacheError):self.store.acquire('/media/../../etc/passwd')

    def test_quota_and_suffix(self):
        with self.assertRaises(CacheError):self.store.reserve('b'*64,2000)
        self.assertEqual(parse_range('bytes=-3',10),(7,9,206))
        self.assertEqual(parse_range('bytes=0-999',10),(0,9,206))
        with self.assertRaises(ValueError):parse_range('bytes=0-1,4-5',10)

    def test_existing_github_job_migrates_only_on_request(self):
        self.store.db.execute('DELETE FROM local_files WHERE key=?',(self.key,))
        self.store.db.execute("UPDATE jobs SET url=?,state='ready' WHERE key=?",('https://github.com/old/file',self.key))
        self.store.db.commit()
        item={'slug':'sample','episode':1,'quality':'720p','source_id':1,'size':10}
        row=self.store.request(item,'a'*64,'new-request-123456')
        self.assertEqual(row['state'],'queued')
        self.assertEqual(row['url'],'')
        self.assertIsNotNone(self.store.db.execute('SELECT key FROM local_legacy_jobs WHERE key=?',(self.key,)).fetchone())


if __name__=='__main__':unittest.main()
