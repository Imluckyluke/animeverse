import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_numbering_certificates import stone_ocean_candidate,certified_stone_ocean_source,STONE_OCEAN_TITLE
from archive_identity import safe_episode_record,compatible_record,filename_candidate,make_plan,apply_recovery_proposals,apply_plan
from archive_pipeline import open_db,store_record


class StoneOceanCertificateTests(unittest.TestCase):
    def source(self,ident=32744,episode=13):
        name=f'[@AnimeWorldqw] JoJo Bizarre Adventure Part six - {episode:02} [480p].mkv'
        return {'id':ident,'title':'JoJo Bizarre Adventure Part six','episode':episode,'season':None,'part':None,
                'quality':'480p','x265':False,'hardsub':False,'name':name,'caption':name,'size':100}

    def page(self):
        return {'metadataProviderId':146722,'year':2022,'format':'ONA','declaredEpisodes':26,
                'verifiedArchiveTitles':[STONE_OCEAN_TITLE]}

    def test_actual_source_labels_and_both_mal_components_are_retained_without_equating_totals(self):
        for ident,overall,canonical,mal,mal_episode,mal_total in [(32744,13,1,51367,1,12),(32755,24,12,51367,12,12),
                                                               (36833,25,13,53273,1,14),(36876,38,26,53273,14,14)]:
            source=self.source(ident,overall);record=stone_ocean_candidate(source)
            self.assertEqual(record['episode'],canonical)
            proof=record['sourceNumberingEvidence']
            self.assertEqual((proof['malId'],proof['malEpisode'],proof['malEpisodes']),(mal,mal_episode,mal_total))
            self.assertEqual(proof['originalRecord'],source)
            self.assertEqual(record['name'],source['name'])
            self.assertEqual(record['caption'],source['caption'])
            self.assertTrue(safe_episode_record(record))
            self.assertTrue(compatible_record(self.page(),record))
            for change in [{'id':999999},{'episode':canonical+1},{'quality':'720p'},{'size':101},
                           {'part':6},{'sourceNumberingEvidence':{}},{'multiEpisode':True},
                           {'caption':'Another series - 13 [480p].mkv'},
                           {'archiveRecovery':{'originalRecord':{'id':1}}}]:
                self.assertIsNone(certified_stone_ocean_source({**record,**change}),change)
                self.assertFalse(safe_episode_record({**record,**change}),change)
            for change in [{'metadataProviderId':131942},{'year':2021},{'format':'TV'},{'declaredEpisodes':12}]:
                self.assertFalse(compatible_record({**self.page(),**change},record),change)

    def test_wrong_source_episode_quality_part_and_unreviewed_ids_never_gain_the_offset(self):
        source=self.source()
        for change in [{'episode':14},{'name':source['name'].replace('13 [','14 [')},
                       {'quality':'720p'},{'title':"JoJo's Bizare Adventure Part 3"},
                       {'part':6},{'season':2},{'id':999999},{'multiEpisode':True}]:
            self.assertIsNone(stone_ocean_candidate({**source,**change}),change)

    def test_rehearsal_and_replay_use_the_same_closed_certificate_and_preserve_original_record(self):
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3')
            sources=[self.source(),self.source(36876,38)]
            for source in sources:
                store_record(db,source,document_id=str(source['id']))
                db.execute("UPDATE files SET state='copied',destination_id=? WHERE id=?",(source['id']+100,source['id']))
            db.commit()
            proposals=[]
            for source in sources:
                raw=db.execute('SELECT record FROM files WHERE id=?',(source['id'],)).fetchone()[0]
                proposals.append({'id':source['id'],'originalSha256':hashlib.sha256(raw.encode()).hexdigest(),
                                  'record':filename_candidate(source,source['id'])})
            media={'id':146722,'idMal':51367,'title':{'romaji':STONE_OCEAN_TITLE},'format':'ONA','episodes':26,
                   'status':'FINISHED','startDate':{'year':2022}}
            cache={'original completed search':{'complete':True,'media':[media]}}
            state={'anime':{},'queue':{}}
            self.assertEqual(apply_recovery_proposals(state,db,cache,proposals),2)
            result=apply_plan(state,db,make_plan(db,state,cache,200))
            self.assertEqual(result['matchedFiles'],2)
            for source in sources:
                row=db.execute('SELECT record,anime_key FROM files WHERE id=?',(source['id'],)).fetchone()
                self.assertEqual(row['anime_key'],'al146722')
                record=json.loads(row['record'])
                self.assertEqual(record['archiveRecovery']['originalRecord'],source)
                self.assertTrue(safe_episode_record(record))
            db.close()


if __name__=='__main__':
    unittest.main()
