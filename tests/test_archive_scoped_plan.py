import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_identity import make_plan, choose_identity
from archive_pipeline import open_db, store_record


class ScopedPlanTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.db=open_db(Path(self.folder.name)/'archive.sqlite3')
        self.state={'anime':{},'queue':{}}
        self.cache={}
        for ident,title in [(1,'Example'),(2,'Unrelated')]:
            media={'id':ident,'title':{'romaji':title},'format':'TV','episodes':12,
                   'status':'FINISHED','startDate':{'year':2020}}
            self.cache[title]={'complete':True,'media':[media]}
            store_record(self.db,{'id':ident,'title':title,'name':title+' - 02 [720p].mkv',
                                 'episode':2,'quality':'720p'})
            self.db.execute("UPDATE files SET state='copied',destination_id=? WHERE id=?",(100+ident,ident))
        self.db.commit()

    def tearDown(self):
        self.db.close();self.folder.cleanup()

    def test_scoped_entries_equal_full_plan_without_visiting_unrelated_identity(self):
        full=make_plan(self.db,self.state,self.cache,200)
        with patch('archive_identity.choose_identity',wraps=choose_identity) as choose:
            scoped=make_plan(self.db,self.state,self.cache,200,only_titles={'Example'})
        self.assertEqual(scoped['entries'],[e for e in full['entries'] if e['archiveTitle']=='Example'])
        self.assertEqual(scoped['scannedTitles'],1)
        self.assertEqual({call.args[0] for call in choose.call_args_list},{'Example'})
        self.assertEqual(make_plan(self.db,self.state,self.cache,200,only_titles=set())['entries'],[])

    def test_scope_does_not_remove_competing_provider_or_existing_page_conflicts(self):
        media=self.cache['Example']['media'][0]
        self.cache['Unrelated']['media'].append({**media,'id':99,'startDate':{'year':1999}})
        self.assertEqual(make_plan(self.db,self.state,self.cache,200,only_titles={'Example'})['entries'],[])
        self.cache['Unrelated']['media'].pop()
        for key in ['existing-one','existing-two']:
            self.state['anime'][key]={'titleEn':'Example','titleOriginal':'Example',
                                     'year':2020,'format':'TV','metadataProviderId':1,'declaredEpisodes':12}
        self.assertEqual(make_plan(self.db,self.state,self.cache,200,only_titles={'Example'})['entries'],[])

    def test_all_same_title_cohorts_are_kept_even_if_only_one_file_will_be_applied(self):
        r={'id':3,'title':'Example','name':'Example - 03 [1080p].mkv','episode':3,'quality':'1080p'}
        store_record(self.db,r)
        self.db.execute("UPDATE files SET state='copied',destination_id=103 WHERE id=3")
        plan=make_plan(self.db,self.state,self.cache,200,only_titles={'Example'})
        self.assertEqual(set(plan['entries'][0]['fileIds']),{1,3})
        self.assertEqual(json.loads(self.db.execute('SELECT record FROM files WHERE id=3').fetchone()[0]),r)


if __name__=='__main__':
    unittest.main()
