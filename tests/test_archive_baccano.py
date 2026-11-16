import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_literal_files import BACCANO_SPECIAL_FILES,certified_baccano_special
from archive_identity import filename_candidate,safe_special_record,apply_recovery_proposals,make_plan,apply_plan
from archive_pipeline import open_db,store_record


class BaccanoNumberingTests(unittest.TestCase):
    def source(self,ident):
        overall,quality,size=BACCANO_SPECIAL_FILES[ident]
        return {'id':ident,'title':'Baccano!','norm':'baccano','episode':overall,'quality':quality,'size':size,
                'name':f'[AWHT] Baccano - {overall} [{quality}].mkv',
                'caption':f'[@AnimeWorldqw] Baccano! - {overall} [{quality}]'}

    def provider(self):
        return {'id':3901,'idMal':3901,'title':{'romaji':'Baccano! Bangai-hen'},'format':'SPECIAL',
                'episodes':3,'status':'FINISHED','startDate':{'year':2008}}

    def test_exact_nine_files_retain_source_labels_and_map_overall_14_to_16_to_special_1_to_3(self):
        for ident,(overall,quality,size) in BACCANO_SPECIAL_FILES.items():
            old=self.source(ident);candidate=filename_candidate(old,ident)
            self.assertEqual(candidate['episode'],overall-13)
            self.assertEqual(candidate['name'],old['name'])
            self.assertEqual(candidate['caption'],old['caption'])
            self.assertEqual(old['episode'],overall)
            self.assertTrue(certified_baccano_special(candidate,3,self.provider()))
            self.assertTrue(safe_special_record(candidate,3,self.provider()))
            for changes in [{'id':68070},{'episode':overall},{'size':size+1},{'multiEpisode':True},
                            {'name':'Other - 14 [480p].mkv'},{'caption':'Baccano! - 15 [480p]'},
                            {'quality':'360p'},{'x265':True},{'sourceNumberingEvidence':{}}]:
                self.assertFalse(certified_baccano_special({**candidate,**changes},3,self.provider()),changes)
        for changes in [{'id':2251},{'idMal':999},{'format':'TV'},{'episodes':13},{'startDate':{'year':2007}}]:
            self.assertFalse(certified_baccano_special(filename_candidate(self.source(68033),68033),3,{**self.provider(),**changes}))

    def test_separating_certified_specials_unblocks_tv_without_a_generic_numbering_override(self):
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3')
            sources=[self.source(i) for i in BACCANO_SPECIAL_FILES]
            sources.append({'id':68020,'title':'Baccano!','name':'[AWHT] Baccano! - 13 [480p].mkv',
                            'episode':13,'quality':'480p'})
            for r in sources:
                store_record(db,r,document_id=str(r['id']))
                db.execute("UPDATE files SET state='copied',destination_id=? WHERE id=?",(r['id']+100,r['id']))
            db.commit()
            state={'anime':{},'queue':{}}
            tv={'id':2251,'idMal':2251,'title':{'romaji':'Baccano!'},'format':'TV','episodes':13,
                'status':'FINISHED','startDate':{'year':2007}}
            cache={'Baccano!':{'complete':True,'media':[tv,self.provider()]}}
            self.assertEqual(make_plan(db,state,cache,200)['entries'],[])
            proposals=[]
            for ident in BACCANO_SPECIAL_FILES:
                raw=db.execute('SELECT record FROM files WHERE id=?',(ident,)).fetchone()[0]
                proposals.append({'id':ident,'originalSha256':hashlib.sha256(raw.encode()).hexdigest(),
                                  'record':filename_candidate(json.loads(raw),ident)})
            self.assertEqual(apply_recovery_proposals(state,db,cache,proposals),9)
            result=apply_plan(state,db,make_plan(db,state,cache,200))
            self.assertEqual(result['matchedFiles'],10)
            self.assertEqual(db.execute('SELECT anime_key FROM files WHERE id=68020').fetchone()[0],'al2251')
            for ident in BACCANO_SPECIAL_FILES:
                record=json.loads(db.execute('SELECT record FROM files WHERE id=?',(ident,)).fetchone()[0])
                self.assertEqual(record['archiveRecovery']['originalRecord'],self.source(ident))
                self.assertEqual(db.execute('SELECT anime_key FROM files WHERE id=?',(ident,)).fetchone()[0],'al3901')
            db.close()


if __name__=='__main__':
    unittest.main()
