import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_identity import filename_candidate,safe_episode_record,compatible_record,make_plan,apply_plan
from archive_literal_files import STEINS_ZERO_EPISODES
from archive_pipeline import open_db,store_record


class LiteralTvTests(unittest.TestCase):
    def free(self,ident=16564):
        return {'id':ident,'title':'Free Eternal Summer','episode':None,'season':2,'quality':'480p',
                'name':'[@AnimeSoftsub]-Free-[s2-01][480].mkv',
                'caption':'[@AnimeWorldqw]Free Eternal Summer-[s2-01]-[480p].mkv','size':123}

    def steins(self,ident=3477):
        number=STEINS_ZERO_EPISODES[ident]
        bare=f'Steins Gate 0 - {number:02} - [720].mkv'
        return {'id':ident,'title':'Steins Gate 0 -17' if ident==3489 else 'Steins Gate 0',
                'episode':None if ident==3489 else number,'quality':'720p','name':'[AnimWorldHT] '+bare,
                'caption':bare,'size':123}

    def test_closed_templates_recover_only_explicit_episode_and_season_without_changing_sources(self):
        for old,expected,year,total in [(self.free(),1,2014,13),(self.steins(),5,2018,23),(self.steins(3489),17,2018,23)]:
            before=json.loads(json.dumps(old));candidate=filename_candidate(old,old['id'])
            self.assertEqual(old,before)
            self.assertEqual(candidate['episode'],expected)
            self.assertEqual(candidate['name'],old['name'])
            self.assertEqual(candidate['caption'],old['caption'])
            self.assertTrue(safe_episode_record(candidate))
            anime={'year':year,'format':'TV','declaredEpisodes':total,'verifiedArchiveTitles':[candidate['title']]}
            self.assertTrue(compatible_record(anime,candidate))
            for changes in [{'id':999999},{'episode':expected+1},{'quality':'1080p'},{'x265':True},
                            {'season':3},{'multiEpisode':True},{'filenameIdentityEvidence':{}},
                            {'name':old['name'].replace('.mkv','-02.mkv')}]:
                self.assertFalse(compatible_record(anime,{**candidate,**changes}),changes)
            for changes in [{'title':'Different'},{'episode':99},{'quality':'1080p'},
                            {'caption':'Different - 05 [720p].mkv'},{'id':999999},{'multiEpisode':True}]:
                self.assertIsNone(filename_candidate({**old,**changes},changes.get('id',old['id'])),changes)

    def test_primary_pages_and_actual_apply_remain_separate_and_existing_assignments_are_not_changed(self):
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3')
            r=filename_candidate(self.steins(),3477)
            store_record(db,r)
            store_record(db,{'id':3473,'title':'Steins Gate','episode':0,'quality':'720p','name':'older.mkv'})
            db.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=3477")
            db.execute("UPDATE files SET state='copied',anime_key='existing-untouched' WHERE id=3473")
            media={'id':21127,'idMal':30484,'title':{'romaji':'Steins;Gate 0'},'format':'TV','episodes':23,
                   'status':'FINISHED','startDate':{'year':2018}}
            state={'anime':{},'queue':{}}
            cache={'Steins Gate 0':{'complete':True,'media':[media]}}
            result=apply_plan(state,db,make_plan(db,state,cache,200))
            self.assertEqual(result['matchedFiles'],1)
            self.assertEqual(db.execute('SELECT anime_key FROM files WHERE id=3477').fetchone()[0],'al21127')
            self.assertEqual(db.execute('SELECT anime_key FROM files WHERE id=3473').fetchone()[0],'existing-untouched')
            db.close()


if __name__=='__main__':
    unittest.main()
