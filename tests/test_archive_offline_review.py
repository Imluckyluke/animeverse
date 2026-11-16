import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_pipeline import Pipeline, open_db, set_setting, setting
from archive_identity import filename_candidate
from archive_recovery_preview import approve_offline_preview, binding_preview


class OfflineReviewTests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.root=Path(self.folder.name)
        (self.root/'archive-full-match').mkdir()
        self.db=open_db(self.root/'archive-pipeline.sqlite3')
        self.old={'id':1,'name':'Example - 02 [720p].mkv','size':100}
        self.raw=json.dumps(self.old)
        self.db.execute("INSERT INTO files(id,record,document_id,state,destination_id) VALUES(1,?,'42','copied',101)",(self.raw,))
        set_setting(self.db,'telegram_flood_until',9999999999)
        self.db.commit()
        self.cache={'Example':{'complete':True,'media':[{'id':123,'title':{'romaji':'Example'},
            'format':'TV','episodes':12,'status':'FINISHED','startDate':{'year':2020}}]}}
        (self.root/'archive-identity-cache.json').write_text(json.dumps(self.cache))
        self.proposal={'id':1,'originalSha256':hashlib.sha256(self.raw.encode()).hexdigest(),
            'record':filename_candidate(self.old,1),'documentId':'42','destinationId':101,'targetKey':'al123'}
        self.path=self.root/'archive-full-match/global-parser-reviewed-proposals.json'
        self.pipeline=SimpleNamespace(db=self.db,state={'anime':{},'queue':{'old-ready':{'status':'done','url':'https://t.me/testanivers/99'}}},
            client=Mock(),status={},dirty=False,cover_keys=set(),
            flush=Mock(side_effect=self.db.commit),refresh_matching_index=Mock())
        self.data=patch('archive_pipeline.DATA',self.root);self.data.start()

    def tearDown(self):
        self.data.stop();self.db.close();self.folder.cleanup()

    def manifest(self):
        self.path.write_text(json.dumps({'version':1,'applyBeforeConnect':True,'proposals':[self.proposal]}))

    def test_reviewed_existing_copy_applies_offline_without_contacting_telegram_or_changing_wait(self):
        self.manifest()
        Pipeline.reconcile_reviewed_offline(self.pipeline)
        row=self.db.execute('SELECT * FROM files').fetchone()
        self.assertEqual(row['anime_key'],'al123')
        self.assertEqual(json.loads(row['record'])['archiveRecovery']['originalRecord'],self.old)
        self.assertEqual(self.pipeline.state['queue']['archive:1']['url'],'https://t.me/testanivers/101')
        self.assertEqual(self.pipeline.state['queue']['old-ready'],{'status':'done','url':'https://t.me/testanivers/99'})
        self.assertEqual(setting(self.db,'telegram_flood_until'),9999999999)
        self.pipeline.client.assert_not_called()
        self.assertEqual(self.pipeline.client.mock_calls,[])
        self.pipeline.flush.assert_called_once()
        Pipeline.reconcile_reviewed_offline(self.pipeline)
        self.pipeline.flush.assert_called_once()

    def test_changed_source_document_destination_target_or_hash_cannot_apply(self):
        for key,value in [('documentId','99'),('destinationId',999),('targetKey','al999'),('originalSha256','0'*64)]:
            with self.subTest(key=key):
                original=self.proposal[key];self.proposal[key]=value;self.manifest()
                Pipeline.reconcile_reviewed_offline(self.pipeline)
                row=self.db.execute('SELECT * FROM files').fetchone()
                self.assertIsNone(row['anime_key'])
                self.assertEqual(row['record'],self.raw)
                self.assertEqual(self.pipeline.state['anime'],{})
                self.proposal[key]=original

    def test_unapproved_preview_does_not_change_source(self):
        self.path.write_text(json.dumps({'version':1,'proposals':[self.proposal]}))
        Pipeline.reconcile_reviewed_offline(self.pipeline)
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0],self.raw)
        self.pipeline.flush.assert_not_called()

    def test_offline_approval_records_exact_document_guards_without_applying(self):
        source=self.root/'preview.json'
        source.write_text(json.dumps({'version':1,'proposals':[self.proposal]}))
        with patch('archive_recovery_preview.DATA',self.root):
            approve_offline_preview(source,self.path,'al123')
        approved=json.loads(self.path.read_text())
        self.assertTrue(approved['applyBeforeConnect'])
        self.assertEqual(approved['proposals'][0]['documentId'],'42')
        self.assertEqual(approved['proposals'][0]['destinationId'],101)
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0],self.raw)
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files').fetchone()[0])
        before=self.path.read_text()
        self.db.execute('UPDATE files SET record=?',(json.dumps({**self.old,'size':200}),));self.db.commit()
        with patch('archive_recovery_preview.DATA',self.root),self.assertRaises(ValueError):
            approve_offline_preview(source,self.path,'al123')
        self.assertEqual(self.path.read_text(),before)

    def test_an_unchanged_valid_record_can_bind_but_a_forged_preview_record_cannot(self):
        valid={**self.old,'title':'Example','episode':2,'quality':'720p'}
        raw=json.dumps(valid)
        self.db.execute('UPDATE files SET record=?',(raw,));self.db.commit()
        self.proposal['originalSha256']=hashlib.sha256(raw.encode()).hexdigest()
        self.proposal['record']={**valid,'episode':9}
        self.manifest()
        Pipeline.reconcile_reviewed_offline(self.pipeline)
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files').fetchone()[0])
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0],raw)
        self.proposal['record']=valid
        self.manifest()
        Pipeline.reconcile_reviewed_offline(self.pipeline)
        self.assertEqual(self.db.execute('SELECT anime_key FROM files').fetchone()[0],'al123')
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0],raw)

    def test_multi_target_approval_requires_actual_apply_result_and_preserves_targets(self):
        source=self.root/'multi-preview.json'
        document={'version':1,'proposals':[self.proposal]}
        source.write_text(json.dumps(document))
        with patch('archive_recovery_preview.DATA',self.root),self.assertRaises(ValueError):
            approve_offline_preview(source,self.path)
        document['rehearsal']={'matchedFiles':1}
        source.write_text(json.dumps(document))
        with patch('archive_recovery_preview.DATA',self.root):
            approve_offline_preview(source,self.path)
        self.assertEqual(json.loads(self.path.read_text())['proposals'][0]['targetKey'],'al123')

    def test_full_recoverable_rehearsal_counts_actual_apply_and_never_writes_live_source(self):
        output=self.root/'rehearsal.json'
        with patch('archive_recovery_preview.DATA',self.root),patch('archive_recovery_preview.load_state',return_value=self.pipeline.state):
            binding_preview(output,[],recoverable=True)
        result=json.loads(output.read_text())
        self.assertEqual(result['scannedFiles'],1)
        self.assertEqual(result['rehearsal']['matchedFiles'],1)
        self.assertEqual(result['acceptedByTarget'],{'al123':1})
        self.assertEqual(result['proposals'][0]['targetKey'],'al123')
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0],self.raw)
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files').fetchone()[0])


if __name__=='__main__':
    unittest.main()
