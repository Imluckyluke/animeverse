"""Byte-level progressive HTTP tests with synthetic data only."""
import asyncio
import hashlib
import http.client
import sqlite3
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from download_cache import CacheError
from local_downloads import LocalStore, MediaServer


class ProgressiveTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.root=Path(self.folder.name)
        self.store=LocalStore(self.root/'db.sqlite',self.root/'media','x'*48,
                              limit=32*1024**2,reserve_free=0,read_wait=.15,stall_seconds=.2)
        self.key=self.store.request({'slug':'sample','episode':1,'quality':'720p','source_id':1,'size':10},
                                    'a'*64,'progressive-request-1234')['key']
        self.store.claim()
        self.store.reserve(self.key,10)
        self.server=MediaServer(('127.0.0.1',0),self.store)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.store.db.close();self.folder.cleanup()

    def begin(self):
        gen,part=self.store.begin_stream(self.key,'sample.mkv',10)
        part.write_bytes(b'0123'+b'\0'*6)
        self.store.progress(self.key,4)
        self.store.advance_stream(self.key,gen,4)
        return gen,part

    def url(self):
        signed=self.store.public(self.key)['url']
        return f'http://127.0.0.1:{self.server.server_port}'+signed.removeprefix(self.store.origin)

    def test_live_status_is_not_ready_and_url_does_not_enter_jobs(self):
        gen,part=self.store.begin_stream(self.key,'sample.mkv',10)
        part.write_bytes(b'\0'*10)
        self.assertNotIn('url',self.store.public(self.key))
        self.store.advance_stream(self.key,gen,4)
        reply=self.store.public(self.key)
        self.assertTrue(reply['live']);self.assertEqual(reply['status'],'uploading')
        self.assertEqual(reply['streamBytes'],4)
        self.assertEqual(self.store.get(self.key)['url'],'')
        self.assertIsNone(self.store.db.execute('SELECT key FROM local_files').fetchone())

    def test_ranges_never_serve_sparse_holes(self):
        self.begin();url=self.url()
        with urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=0-3'})) as r:
            self.assertEqual(r.status,206);self.assertEqual(r.read(),b'0123')
            self.assertEqual(r.headers['Content-Range'],'bytes 0-3/10')
            self.assertEqual(r.headers['Content-Length'],'4')
            self.assertEqual(r.headers['X-Download-State'],'live')
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=4-5'}))
        self.assertEqual(e.exception.code,503)
        self.assertEqual(e.exception.headers['Retry-After'],'2');e.exception.close()

    def test_head_does_not_wait_and_invalid_range_is_416(self):
        self.begin();url=self.url()
        with urllib.request.urlopen(urllib.request.Request(url,method='HEAD',headers={'Range':'bytes=8-9'})) as r:
            self.assertEqual(r.status,206);self.assertEqual(r.read(),b'')
            self.assertEqual(r.headers['Content-Length'],'2')
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(url,headers={'Range':'bytes=10-'}))
        self.assertEqual(e.exception.code,416);e.exception.close()

    def test_body_aborts_instead_of_padding_unwritten_bytes(self):
        gen,_=self.begin();url=self.url()
        with urllib.request.urlopen(url) as r:
            self.assertEqual(r.read(4),b'0123')
            self.store.abort_stream(self.key,gen)
            with self.assertRaises(http.client.IncompleteRead):r.read()
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(url)
        self.assertEqual(e.exception.code,410);e.exception.close()

    def test_commit_keeps_generation_and_existing_open_response(self):
        gen,part=self.begin();url=self.url()
        with urllib.request.urlopen(url) as r:
            self.assertEqual(r.read(4),b'0123')
            part.write_bytes(b'0123456789')
            self.store.advance_stream(self.key,gen,10)
            # Last byte is withheld until final validation/commit succeeds.
            self.assertEqual(self.store.live[self.key]['committed'],9)
            self.store.commit_file(self.key,'sample.mkv',part,10,hashlib.sha256(b'0123456789').hexdigest(),generation=gen)
            self.assertEqual(r.read(),b'456789')
        self.assertEqual(self.store.public(self.key)['status'],'ready')
        self.assertNotIn('live',self.store.public(self.key))
        with urllib.request.urlopen(url) as r:
            self.assertEqual(r.headers['X-Download-State'],'verified')
            self.assertEqual(r.read(),b'0123456789')

    def test_retry_generation_cannot_revive_old_url(self):
        gen,part=self.begin();old=self.url()
        self.store.abort_stream(self.key,gen);self.store.producers.discard(self.key)
        newer,_=self.store.begin_stream(self.key,'new.mkv',10)
        self.assertNotEqual(gen,newer)
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(old)
        self.assertEqual(e.exception.code,410);e.exception.close()

    def test_all_paused_demands_revoke_live_delivery(self):
        self.begin();url=self.url()
        self.store.control_request('progressive-request-1234',self.key,False,True)
        self.assertNotIn('url',self.store.public(self.key))
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(url)
        self.assertEqual(e.exception.code,410);e.exception.close()

    def test_parallel_receive_advances_across_completed_shard_boundary(self):
        data=bytes(range(251))*14000
        self.store.reserve(self.key,len(data))
        prefixes=[]
        original=self.store.advance_stream
        def advance(key,generation,prefix):
            prefixes.append(prefix)
            original(key,generation,prefix)
        self.store.advance_stream=advance
        class FakeClient:
            async def iter_download(inner,media,offset,limit,request_size,chunk_size):
                for i in range(limit):
                    await asyncio.sleep(.002 if offset else 0)
                    yield data[offset+i*chunk_size:offset+(i+1)*chunk_size]
        asyncio.run(self.store.receive(FakeClient(),type('Message',(),{'media':'fixture'})(),
                    self.store.get(self.key),'sample.mkv',len(data)))
        self.assertEqual(next(self.store.media.glob('*.bin')).read_bytes(),data)
        self.assertEqual(max(prefixes),len(data)-1)
        self.assertEqual(self.store.get(self.key)['sha256'],hashlib.sha256(data).hexdigest())
        self.assertNotIn(self.key,self.store.producers)
        self.assertFalse(self.store.live)

    def test_stalled_producer_revokes_partial_url_and_removes_part(self):
        urls=[]
        class StalledClient:
            async def iter_download(inner,media,offset,limit,request_size,chunk_size):
                yield b'0123'
                urls.append(self.store.public(self.key)['url'])
                await asyncio.sleep(5)
        with self.assertRaises(asyncio.TimeoutError):
            asyncio.run(self.store.receive(StalledClient(),type('Message',(),{'media':'fixture'})(),
                        self.store.get(self.key),'sample.mkv',10,streams=1))
        self.assertFalse(self.store.live);self.assertFalse(self.store.producers)
        self.assertFalse(list(self.store.media.glob('*.part')))
        with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(urls[0].replace(self.store.origin,f'http://127.0.0.1:{self.server.server_port}'))
        self.assertEqual(e.exception.code,410);e.exception.close()

    def test_phone_receives_bytes_before_telegram_finishes(self):
        got_prefix=threading.Event()
        downloads=[]
        def phone(url):
            with urllib.request.urlopen(url,timeout=5) as response:
                first=response.read(4)
                self.assertEqual(first,b'0123')
                self.assertEqual(self.store.get(self.key)['state'],'uploading')
                got_prefix.set()
                return first+response.read()
        class Client:
            async def iter_download(inner,media,offset,limit,request_size,chunk_size):
                yield b'0123'
                downloads.append(asyncio.create_task(asyncio.to_thread(phone,self.url())))
                self.assertTrue(await asyncio.to_thread(got_prefix.wait,2))
                yield b'456789'
        async def run():
            await self.store.receive(Client(),type('Message',(),{'media':'fixture'})(),
                                     self.store.get(self.key),'sample.mkv',10,streams=1)
            self.assertEqual(await downloads[0],b'0123456789')
        asyncio.run(run())

    def test_failure_during_final_check_never_completes_http(self):
        from unittest.mock import patch
        class Client:
            async def iter_download(inner,media,offset,limit,request_size,chunk_size):
                yield b'0123456789'
        with patch.object(self.store,'commit_file',side_effect=CacheError('fixture validation failure',502)):
            with self.assertRaises(CacheError):
                asyncio.run(self.store.receive(Client(),type('Message',(),{'media':'fixture'})(),
                             self.store.get(self.key),'sample.mkv',10,streams=1))
        self.assertNotEqual(self.store.get(self.key)['state'],'ready')
        self.assertFalse(self.store.live)
        self.assertFalse(list(self.store.media.glob('*.part')))

    def test_producer_pins_expired_previous_generation_during_cleanup(self):
        old=self.root/'old.part';old.write_bytes(b'0123456789')
        self.store.commit_file(self.key,'old.mkv',old,10,hashlib.sha256(b'0123456789').hexdigest())
        self.store.db.execute('UPDATE local_files SET expires=0 WHERE key=?',(self.key,))
        self.store.db.commit()
        self.begin()
        self.store.cleanup()
        self.assertEqual(len(list(self.store.media.glob('*.bin'))),1)
        self.assertEqual(len(list(self.store.media.glob('*.part'))),1)

    def test_restart_drops_partial_grants_not_verified_file_records(self):
        self.begin();url=self.store.public(self.key)['url']
        other=LocalStore(self.store.path,self.store.media,'x'*48,reserve_free=0)
        try:
            with self.assertRaises(CacheError) as e:other.acquire(url.removeprefix(other.origin))
            self.assertEqual(e.exception.status,410)
            self.assertFalse(list(self.store.media.glob('*.part')))
        finally:other.db.close()

    def test_iterator_close_runs_on_success_timeout_and_pause(self):
        for mode in ('success','timeout','pause'):
            with self.subTest(mode=mode):
                self.store.stall_seconds=.1 if mode=='timeout' else 2
                closed=[]
                class Iterator:
                    calls=0
                    def __aiter__(inner):return inner
                    async def __anext__(inner):
                        inner.calls+=1
                        if inner.calls==1:return b'0123456789' if mode=='success' else b'0123'
                        if mode=='success':raise StopAsyncIteration
                        if mode=='pause':self.store.control_request('progressive-request-1234',self.key,False,True)
                        await asyncio.sleep(5)
                        raise StopAsyncIteration
                    async def close(inner):closed.append(True)
                class Client:
                    def iter_download(inner,*args,**kwargs):return Iterator()
                run=lambda:asyncio.run(self.store.receive(Client(),type('Message',(),{'media':'fixture'})(),
                                 self.store.get(self.key),'sample.mkv',10,streams=1))
                if mode=='success':run()
                else:
                    with self.assertRaises((CacheError,asyncio.TimeoutError)):run()
                self.assertEqual(closed,[True])

    def test_cleanup_sweeps_only_owned_unreferenced_generations(self):
        orphan=self.store.media/('f'*64+'-'+'e'*32+'.bin');orphan.write_bytes(b'orphan')
        unrelated=self.store.media/'unrelated.bin';unrelated.write_bytes(b'not owned')
        self.store.cleanup()
        self.assertFalse(orphan.exists());self.assertTrue(unrelated.exists())

    def test_crash_between_rename_and_database_insert_is_reclaimable(self):
        part=self.store.media/'crash.part';part.write_bytes(b'0123456789')
        self.store.db.execute("CREATE TRIGGER fail_commit BEFORE INSERT ON local_files BEGIN SELECT RAISE(ABORT,'fixture'); END")
        self.store.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.commit_file(self.key,'sample.mkv',part,10,hashlib.sha256(b'0123456789').hexdigest())
        self.assertEqual(len(list(self.store.media.glob('*.bin'))),1)
        self.store.cleanup()
        self.assertFalse(list(self.store.media.glob('*.bin')))

    def test_replacement_preserves_pinned_reader_then_reclaims_old_generation(self):
        old=self.store.media/'old.part';old.write_bytes(b'0123456789')
        self.store.commit_file(self.key,'sample.mkv',old,10,hashlib.sha256(b'0123456789').hexdigest())
        old_url=self.store.public(self.key)['url']
        row,reader=self.store.acquire(old_url.removeprefix(self.store.origin))
        new=self.store.media/'new.part';new.write_bytes(b'abcdefghij')
        self.store.commit_file(self.key,'sample.mkv',new,10,hashlib.sha256(b'abcdefghij').hexdigest())
        self.store.cleanup()
        self.assertEqual(len(list(self.store.media.glob('*.bin'))),2)
        self.assertEqual(reader.read(),b'0123456789')
        reader.close();self.store.release(self.key,(0,9),row['generation'])
        self.store.cleanup()
        self.assertEqual(len(list(self.store.media.glob('*.bin'))),1)
        self.assertEqual(next(self.store.media.glob('*.bin')).read_bytes(),b'abcdefghij')
        with self.assertRaises(CacheError):self.store.acquire(old_url.removeprefix(self.store.origin))

    def test_startup_reclaims_crash_orphan_but_keeps_verified_file(self):
        part=self.store.media/'valid.part';part.write_bytes(b'0123456789')
        self.store.commit_file(self.key,'sample.mkv',part,10,hashlib.sha256(b'0123456789').hexdigest())
        orphan=self.store.media/('f'*64+'-'+'e'*32+'.bin');orphan.write_bytes(b'orphan')
        other=LocalStore(self.store.path,self.store.media,'x'*48,reserve_free=0)
        try:
            self.assertFalse(orphan.exists())
            self.assertEqual(other.public(self.key)['status'],'ready')
            self.assertEqual(len(list(self.store.media.glob('*.bin'))),1)
        finally:other.db.close()

    def test_post_commit_logging_failure_does_not_requeue_ready_file(self):
        part=self.store.media/'valid.part';part.write_bytes(b'0123456789')
        self.store.commit_file(self.key,'sample.mkv',part,10,hashlib.sha256(b'0123456789').hexdigest())
        self.store.fail(self.key,'synthetic log failure')
        self.assertEqual(self.store.get(self.key)['state'],'ready')
        self.assertEqual(self.store.public(self.key)['status'],'ready')


if __name__=='__main__':unittest.main()
