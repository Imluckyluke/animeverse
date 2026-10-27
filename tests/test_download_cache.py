import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/tg'))
from download_cache import CacheError, CacheStore, ReadyCatalog, MAX_FILE, file_key, safe_download_url
from migrate_cache_account import migrate


class DownloadCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.now=100_000.0
        self.store=CacheStore(Path(self.directory.name)/'cache.sqlite',clock=lambda:self.now)
        self.item={'slug':'example','episode':3,'quality':'720p','source_id':10,'size':1234}
        self.client='a'*64

    def tearDown(self):
        self.store.db.close()
        self.directory.cleanup()

    def request(self,number=1,item=None):
        return self.store.request(item or self.item,self.client,f'valid-request-id-{number}')

    def ready(self,bucket='temp'):
        self.request()
        row=self.store.claim()
        asset={'id':11,'size':1234,'browser_download_url':'https://github.com/itisluckyluke-dev/animeverse-'+('popular' if bucket=='hot' else 'temporary')+'-downloads/releases/download/cache/file.mkv'}
        self.store.finish(row['key'],bucket,asset,'0'*64)
        return row['key']

    def test_shared_job_for_simultaneous_downloads(self):
        first=self.request()
        second=self.request(2)
        self.assertEqual(first['key'],second['key'])
        self.assertIsNotNone(self.store.claim())
        self.assertIsNone(self.store.claim())

    def test_idempotent_requests_do_not_inflate_popularity(self):
        self.request();row=self.request()
        self.assertEqual(row['requests'],1)

    def test_request_ids_cannot_be_reused_for_different_files(self):
        self.request()
        with self.assertRaises(CacheError):self.request(item={**self.item,'episode':4})

    def test_ready_download_link_is_from_explicit_repositories_only(self):
        key=self.ready()
        self.assertEqual(self.store.public(key)['status'],'ready')
        self.assertTrue(safe_download_url(self.store.public(key)['url']))
        self.assertFalse(safe_download_url('https://github.com.evil.test/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/a/b'))
        self.assertFalse(safe_download_url('https://github.com/Imluckyluke/animeverse-temporary-downloads/releases/download/a/b'))

    def test_account_migration_preserves_durable_batches_without_reusing_old_assets(self):
        batch,items=self.batch(3)
        keys=[file_key(item) for item in items]
        with self.store.transaction():
            self.store.db.execute("""UPDATE jobs SET state='ready',asset_id=42,
                release_id=99,progress=size,sha256=?,url=? WHERE key=?""",
                ('f'*64,'https://github.com/Imluckyluke/animeverse-temporary-downloads/releases/download/cache/file.mkv',keys[0]))
            self.store.db.execute("UPDATE jobs SET state='uploading',progress=600 WHERE key=?",(keys[1],))
            self.store.db.execute('INSERT INTO retired VALUES (?,?,?,?)',('Imluckyluke/animeverse-temporary-downloads',42,1234,0))
            self.store.db.execute('INSERT INTO retired VALUES (?,?,?,?)',('itisluckyluke-dev/animeverse-temporary-downloads',43,1234,0))
        result=migrate(self.store.db)
        self.assertEqual(result,{'legacy_assets_detached':1,'interrupted_jobs_requeued':1,'legacy_cleanup_entries_detached':1})
        self.assertEqual(self.store.request_batch(items,self.client,'batch-request-valid-1'),batch)
        self.assertEqual([item['job'] for item in self.store.public_batch(batch)['items']],keys)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM requests').fetchone()[0],1)
        for key in keys:
            self.assertEqual(self.store.public(key)['status'],'waiting')
            self.assertNotIn('url',self.store.public(key))
        row=self.store.get(keys[0])
        self.assertIsNone(row['asset_id']);self.assertIsNone(row['release_id'])
        self.assertEqual(row['sha256'],'');self.assertEqual(row['progress'],0)
        self.assertEqual(self.store.db.execute('SELECT repo FROM retired').fetchone()[0],'itisluckyluke-dev/animeverse-temporary-downloads')
        self.assertEqual(migrate(self.store.db),{'legacy_assets_detached':0,'interrupted_jobs_requeued':0,'legacy_cleanup_entries_detached':0})
        self.assertEqual(self.store.claim()['key'],keys[0])

    def test_account_migration_leaves_new_owner_ready_assets_untouched(self):
        key=self.ready();before=self.store.get(key)
        migrate(self.store.db)
        self.assertEqual(self.store.get(key),before)

    def test_source_replacement_never_reuses_wrong_file(self):
        self.assertNotEqual(file_key(self.item),file_key({**self.item,'source_id':11}))

    def test_github_file_limit_is_enforced(self):
        row=self.request()
        with self.assertRaises(CacheError):self.store.reserve(row['key'],MAX_FILE+1,'temp')

    def test_storage_cap_is_enforced(self):
        row=self.request();self.store.limits['temp']=1000
        with self.assertRaises(CacheError):self.store.reserve(row['key'],1234,'temp')

    def test_queue_is_bounded(self):
        self.store.max_queue=1;self.request()
        with self.assertRaises(CacheError):self.request(2,{**self.item,'source_id':11})

    def test_temporary_files_expire_after_last_actual_request(self):
        key=self.ready();self.now+=86399
        self.assertEqual(self.store.expired_assets()[0],[])
        self.now+=2;rows,_=self.store.expired_assets()
        self.assertEqual([row['key'] for row in rows],[key])
        self.assertNotIn('url',self.store.public(key))
        self.store.deleted(key)
        self.assertEqual(self.store.public(key)['status'],'expired')

    def test_status_polling_does_not_extend_lifetime(self):
        key=self.ready();self.now+=86401;self.store.public(key)
        self.assertEqual(len(self.store.expired_assets()[0]),1)

    def test_new_download_extends_lifetime(self):
        self.ready();self.now+=86399;self.request(2);self.now+=2
        self.assertEqual(self.store.expired_assets()[0],[])

    def test_hot_files_do_not_get_temporary_cleanup(self):
        self.ready('hot');self.now+=999999
        self.assertEqual(self.store.expired_assets()[0],[])

    def test_popularity_promotes_without_invalidating_existing_link(self):
        key=self.ready();old=self.store.public(key)['url']
        for n in range(2,11):self.request(n)
        row=self.store.claim()
        self.assertEqual(row['key'],key)
        self.assertEqual(self.store.public(key)['url'],old)
        self.store.finish(key,'hot',{'id':12,'size':1234,'browser_download_url':'https://github.com/itisluckyluke-dev/animeverse-popular-downloads/releases/download/cache/file.mkv'},'1'*64)
        self.assertEqual(self.store.public(key)['bucket'],'hot')
        self.now+=86401
        self.assertEqual(len(self.store.expired_assets()[1]),1)

    def test_failed_job_has_bounded_retries_and_can_be_requested_again(self):
        row=self.request()
        for _ in range(3):
            job=self.store.claim();self.store.fail(job['key'],'temporary',60);self.now+=61
        self.assertEqual(self.store.public(row['key'])['status'],'failed')
        self.request(2)
        self.assertEqual(self.store.public(row['key'])['status'],'queued')

    def test_rate_limit_applies_to_new_clicks_not_status_reads(self):
        for n in range(1,13):self.request(n)
        with self.assertRaises(CacheError):self.request(13)

    def test_catalog_only_accepts_exact_ready_destination_files(self):
        path=Path(self.directory.name)/'catalog.json'
        rows=[{'slug':'example','episodeData':[{'number':3,'qualities':[
            {'label':'720p','status':'done','url':'https://t.me/testanivers/10','size':1234},
            {'label':'480p','status':'pending','url':'https://t.me/testanivers/11'},
            {'label':'1080p','status':'done','url':'https://t.me/private-source/12'},
        ]}]}]
        path.write_text(json.dumps(rows));catalog=ReadyCatalog(path)
        self.assertEqual(catalog.resolve('example',3,'720p')['source_id'],10)
        for label in ['480p','1080p']:
            with self.assertRaises(CacheError):catalog.resolve('example',3,label)
        self.assertEqual([item['episode'] for item in catalog.resolve_all('example','720p')],[3])
        with self.assertRaises(CacheError):catalog.resolve_all('example','480p')

    def batch(self,count=55,request='batch-request-valid-1'):
        items=[{**self.item,'episode':n,'source_id':100+n} for n in range(1,count+1)]
        return self.store.request_batch(items,self.client,request),items

    def test_entire_bulk_request_is_durable_beyond_active_window(self):
        batch,items=self.batch()
        self.assertEqual(len(self.store.public_batch(batch)['items']),55)
        self.store.claim()
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','uploading')").fetchone()[0],40)
        self.store.db.close()
        self.store=CacheStore(Path(self.directory.name)/'cache.sqlite',clock=lambda:self.now)
        self.assertEqual(len(self.store.public_batch(batch)['items']),55)
        self.assertEqual(self.store.db.execute("SELECT count(*) FROM jobs WHERE state='waiting'").fetchone()[0],15)

    def test_worker_admits_all_bulk_items_without_a_browser(self):
        batch,_=self.batch(45)
        for index in range(45):
            job=self.store.claim();self.assertIsNotNone(job)
            self.assertLessEqual(self.store.db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','uploading')").fetchone()[0],40)
            self.store.finish(job['key'],'temp',{'id':1000+index,'size':1234,'browser_download_url':f'https://github.com/itisluckyluke-dev/animeverse-temporary-downloads/releases/download/cache/{index}.mkv'},'1'*64)
        self.assertEqual(self.store.public_batch(batch)['status'],'ready')
        self.assertIsNone(self.store.claim())

    def test_bulk_retry_idempotency_and_single_overlap(self):
        batch,items=self.batch(3)
        self.assertEqual(self.store.request_batch(items,'b'*64,'batch-request-valid-1'),batch)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM requests').fetchone()[0],1)
        row=self.store.request(items[0],self.client,'single-overlap-valid-1')
        self.assertEqual(row['key'],self.store.public_batch(batch)['items'][0]['job'])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM jobs').fetchone()[0],3)
        with self.assertRaises(CacheError):self.store.request_batch([{**items[0],'quality':'480p'}],self.client,'batch-request-valid-1')

    def test_bulk_status_tracks_each_episode_independently(self):
        batch,_=self.batch(2);job=self.store.claim();self.store.progress(job['key'],600)
        items=self.store.public_batch(batch)['items']
        self.assertEqual([item['episode'] for item in items],[1,2])
        self.assertEqual(items[0]['status'],'uploading');self.assertEqual(items[0]['bytes'],600)
        self.store.fail(job['key'],'missing',permanent=True)
        self.assertEqual(self.store.public_batch(batch)['items'][0]['status'],'failed')
        self.assertEqual(self.store.public_batch(batch)['items'][1]['status'],'queued')

    def test_unknown_and_oversized_batches_are_rejected(self):
        with self.assertRaises(CacheError):self.store.public_batch('0'*64)
        with self.assertRaises(CacheError):self.batch(2001)

    def test_capacity_backpressure_retains_accepted_request(self):
        batch,_=self.batch(2);job=self.store.claim();self.store.defer(job['key'],'ظرفیت',900)
        self.assertEqual(self.store.public_batch(batch)['items'][0]['status'],'waiting')
        next_job=self.store.claim();self.assertNotEqual(next_job['key'],job['key'])

    def test_idempotent_single_can_resume_after_ip_change(self):
        first=self.request()
        resumed=self.store.request(self.item,'b'*64,'valid-request-id-1')
        self.assertEqual(resumed['key'],first['key']);self.assertEqual(resumed['requests'],1)

    def test_bulk_requests_still_promote_popular_files(self):
        key=self.ready()
        for n in range(9):self.store.request_batch([self.item],self.client,'popular-batch-valid-'+str(n))
        self.assertEqual(self.store.get(key)['promote'],1)
        self.assertEqual(self.store.claim()['key'],key)

    def test_single_retry_respects_active_queue_window(self):
        first=self.request();job=self.store.claim();self.store.fail(job['key'],'missing',permanent=True);self.now+=61
        self.store.max_queue=1
        self.request(2,{**self.item,'source_id':99})
        retry=self.request(3)
        self.assertEqual(retry['state'],'waiting')

    def test_global_bulk_backlog_cap_is_atomic(self):
        for n in range(2):
            items=[{**self.item,'slug':'batch-'+str(n),'episode':e,'source_id':10000*n+e} for e in range(1,2001)]
            self.store.request_batch(items,self.client,'global-batch-valid-'+str(n))
        with self.assertRaises(CacheError):
            items=[{**self.item,'slug':'third','episode':e,'source_id':30000+e} for e in range(1,2001)]
            self.store.request_batch(items,self.client,'global-batch-valid-3')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM jobs').fetchone()[0],4000)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM batches').fetchone()[0],2)


if __name__=='__main__':unittest.main()
