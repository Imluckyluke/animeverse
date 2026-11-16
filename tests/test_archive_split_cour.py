import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_numbering_certificates import split_cour_candidate,certified_split_cour_source,SPLIT_TARGETS
from archive_identity import safe_episode_record,compatible_record,filename_candidate,make_plan,apply_recovery_proposals,apply_plan
from archive_pipeline import open_db,store_record


class SplitCourTests(unittest.TestCase):
    def source(self,title,ident,episode,quality='480p'):
        caption=f'{title} - {episode:02} [{quality}].mkv'
        return {'id':ident,'title':title,'episode':episode,'quality':quality,
                'season':3 if title in {'Food Wars! S3','Attack On Titan Season 3'} else None,'part':None,
                'name':'[AWHT] '+caption,'caption':caption,'size':123,'x265':False,'hardsub':False}

    def examples(self):
        return [self.source('Food Wars! S3',8598,12),self.source('Food Wars! S3',8683,13),
                self.source('Food Wars! S3',8720,24,'1080p'),
                self.source('Mushoku Tensei',9148,11),self.source('Mushoku Tensei',9173,12),
                self.source('Mushoku Tensei',14221,23,'1080p'),
                self.source('Vanitas no Carte',7987,12),self.source('Vanitas no Carte',14870,13),
                self.source('Vanitas no Carte',21766,24,'1080p'),
                self.source('Attack On Titan Season 3',3222,12),
                self.source('Attack On Titan Season 3',3223,13),
                self.source('Attack On Titan Season 3',3278,22,'1080p'),
                self.source('Bungou Stray Dogs',10275,1),
                self.source('Bungou Stray Dogs',10325,24),
                self.source('Bungou Stray Dogs',10353,26),
                self.source('Bungou Stray Dogs',10390,37,'1080p'),
                self.source('86 - Eighty Six',12343,11),
                self.source('86 - Eighty Six',9194,12),
                self.source('86 - Eighty Six',13988,19,'1080p')]

    def page(self,record):
        p=record['sourceNumberingEvidence']
        return {'metadataProviderId':p['providerId'],'year':p['year'],'format':'TV',
                'declaredEpisodes':p['providerEpisodes'],'verifiedArchiveTitles':[record['title']]}

    def test_closed_boundaries_with_all_original_labels_preserved_and_tamper_guards(self):
        for source in self.examples():
            r=split_cour_candidate(source)
            self.assertIsNotNone(r,source)
            self.assertEqual(certified_split_cour_source(r),source)
            self.assertEqual((r['name'],r['caption']),(source['name'],source['caption']))
            self.assertTrue(safe_episode_record(r))
            self.assertTrue(compatible_record(self.page(r),r))
            for change in [{'id':999999},{'episode':r['episode']+1},{'quality':'invalid'},
                           {'season':3},{'size':124},{'part':6},{'multiEpisode':True},
                           {'sourceNumberingEvidence':{}},{'archiveRecovery':{'originalRecord':{}}},
                           {'caption':source['caption'].replace('.mkv','-02.mkv')}]:
                self.assertIsNone(certified_split_cour_source({**r,**change}),change)
                self.assertFalse(safe_episode_record({**r,**change}),change)
            for change in [{'metadataProviderId':1},{'year':2000},{'format':'OVA'},{'declaredEpisodes':24}]:
                self.assertFalse(compatible_record({**self.page(r),**change},r),change)
            for change in [{'id':999999},{'episode':True},{'quality':'bad'},{'season':5},
                           {'episode':99},{'caption':'Another title - 01 [480p].mkv'},
                           {'name':source['name'].replace(source['title'],source['title']+' S2')}]:
                self.assertIsNone(split_cour_candidate({**source,**change}),change)

    def test_unknown_quality_typo_is_held_and_empty_or_persian_captions_have_closed_ids(self):
        r=self.source('Food Wars! S3',8591,5)
        r['name']='[AWHT] Food Wars! S3 - 05 (4800).mkv'
        r['caption']='Food Wars! S3 - 05 (480).mkv'
        self.assertIsNone(split_cour_candidate(r))
        for ident,episode in [(15186,14),(15187,14),(15188,14)]:
            r={**self.source('Vanitas no Carte',ident,episode),'caption':''}
            self.assertTrue(safe_episode_record(split_cour_candidate(r)))
        self.assertIsNone(split_cour_candidate({**self.source('Vanitas no Carte',14870,13),'caption':''}))
        for ident,q in [(15540,'480p'),(15541,'720p'),(15542,'1080p')]:
            r={**self.source('Vanitas no Carte',ident,15,q),'caption':f'Vanitas no Carte\nقسمت: 15\nکیفیت: {q}'}
            self.assertTrue(safe_episode_record(split_cour_candidate(r)))
            self.assertIsNone(split_cour_candidate({**r,'caption':r['caption'].replace('15','16')}))

    def test_bungo_ova_25_never_becomes_regular_tv_episode(self):
        for ident in (10352,10353,999999):
            self.assertIsNone(split_cour_candidate(self.source('Bungou Stray Dogs',ident,25)))
        r=split_cour_candidate(self.source('Bungou Stray Dogs',10353,26))
        self.assertEqual((r['episode'],r['sourceNumberingEvidence']['providerId']),(1,103223))

    def test_actual_replay_splits_reviewed_pages_without_touching_existing_assignment(self):
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3');sources=self.examples()
            for r in sources:
                store_record(db,r,document_id=str(r['id']))
                db.execute("UPDATE files SET state='copied',destination_id=? WHERE id=?",(r['id']+100,r['id']))
            store_record(db,{'id':999999,'title':'untouched','episode':1,'quality':'720p'})
            db.execute("UPDATE files SET anime_key='existing' WHERE id=999999");db.commit()
            proposals=[]
            for r in sources:
                raw=db.execute('SELECT record FROM files WHERE id=?',(r['id'],)).fetchone()[0]
                proposals.append({'id':r['id'],'originalSha256':hashlib.sha256(raw.encode()).hexdigest(),
                                  'record':filename_candidate(r,r['id'])})
            media=[{'id':t[1],'idMal':t[2],'title':{'romaji':{131646:'Vanitas no Carte',21311:'Bungou Stray Dogs'}.get(t[1],t[0])},'format':'TV',
                    'episodes':t[4],'status':'FINISHED','startDate':{'year':t[3]}}
                   for targets in SPLIT_TARGETS.values() for t in targets]
            cache={'complete-reference':{'complete':True,'media':media}};state={'anime':{},'queue':{}}
            self.assertEqual(apply_recovery_proposals(state,db,cache,proposals),len(sources))
            result=apply_plan(state,db,make_plan(db,state,cache,200))
            self.assertEqual(result['matchedFiles'],len(sources))
            self.assertEqual(len(result['createdKeys']),13)
            self.assertEqual(db.execute('SELECT anime_key FROM files WHERE id=999999').fetchone()[0],'existing')
            for r in sources:
                row=db.execute('SELECT record,anime_key FROM files WHERE id=?',(r['id'],)).fetchone()
                recovered=json.loads(row['record'])
                self.assertEqual(recovered['archiveRecovery']['originalRecord'],r)
                self.assertEqual(row['anime_key'],'al'+str(recovered['sourceNumberingEvidence']['providerId']))
            db.close()


if __name__=='__main__':
    unittest.main()
