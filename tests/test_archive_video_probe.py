import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_pipeline import open_db
from archive_video_probe import inspect_requested_files, matroska_dimensions, inspect_header, verified_video_proposals
from telethon.tl.types import DocumentAttributeVideo


class VideoMetadataProbeTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def header(width=1280, height=720, kind=1):
        def element(ident, payload):
            tag = ident.to_bytes((ident.bit_length()+7)//8, 'big')
            assert len(payload)<127
            return tag + bytes([0x80|len(payload)]) + payload
        video=element(0xE0, element(0xB0,width.to_bytes(2,'big'))+element(0xBA,height.to_bytes(2,'big')))
        entry=element(0xAE,element(0x83,bytes([kind]))+video)
        return element(0x1A45DFA3,element(0x4282,b'matroska'))+bytes.fromhex('18538067ff')+element(0x1654AE6B,entry)

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / 'archive-full-match').mkdir()
        self.db = open_db(self.root / 'archive.sqlite3')
        self.record = json.dumps({'id': 1, 'name': 'Kiznaiver HD - 05.mkv', 'size': 123})
        self.db.execute("INSERT INTO files(id,record,document_id,state,destination_id) VALUES(1,?,'42','copied',101)", (self.record,))
        self.db.commit()
        self.request = {'version': 1, 'files': [{'id': 1, 'documentId': '42',
            'recordSha256': hashlib.sha256(self.record.encode()).hexdigest()}]}
        self.path = self.root / 'archive-full-match/video-metadata-request.json'
        self.path.write_text(json.dumps(self.request))
        self.message = SimpleNamespace(id=1, document=SimpleNamespace(id=42, size=123,
            attributes=[DocumentAttributeVideo(duration=24, w=1280, h=720)]),
            file=SimpleNamespace(name='Kiznaiver HD - 05.mkv'), raw_text='original caption')
        self.pipeline = SimpleNamespace(db=self.db, sky='fixed-archive', status={},
            tg=lambda f: f(), client=SimpleNamespace(get_messages=AsyncMock(return_value=[self.message])))
        self.data = patch('archive_video_probe.DATA', self.root)
        self.data.start()

    def tearDown(self):
        self.data.stop()
        self.db.close()
        self.folder.cleanup()

    async def test_probe_checks_exact_source_document_without_downloading_or_rewriting(self):
        await inspect_requested_files(self.pipeline)
        evidence = json.loads((self.root / 'archive-full-match/video-metadata-evidence.json').read_text())
        self.assertEqual(evidence['files'][0]['videoDimensions'], [[1280, 720]])
        self.assertEqual(evidence['fileBytesDownloaded'], 0)
        self.assertFalse(evidence['liveRecordsChanged'])
        self.assertEqual(self.db.execute('SELECT record FROM files').fetchone()[0], self.record)
        self.assertIsNone(self.db.execute('SELECT anime_key FROM files').fetchone()[0])
        await inspect_requested_files(self.pipeline)
        self.pipeline.client.get_messages.assert_awaited_once_with('fixed-archive', ids=[1])

    async def test_stale_manifest_never_requests_telegram(self):
        self.request['files'][0]['recordSha256'] = '0' * 64
        self.path.write_text(json.dumps(self.request))
        await inspect_requested_files(self.pipeline)
        self.pipeline.client.get_messages.assert_not_awaited()

    async def test_different_document_is_not_accepted(self):
        self.message.document.id = 999
        await inspect_requested_files(self.pipeline)
        evidence = json.loads((self.root / 'archive-full-match/video-metadata-evidence.json').read_text())
        self.assertEqual(evidence['files'], [])

    async def test_missing_video_attributes_do_not_invent_hd_resolution(self):
        self.message.document.attributes = []
        await inspect_requested_files(self.pipeline)
        evidence = json.loads((self.root / 'archive-full-match/video-metadata-evidence.json').read_text())
        self.assertEqual(evidence['files'][0]['videoDimensions'], [])

    def test_matroska_header_requires_real_complete_video_track_structure(self):
        self.assertEqual(matroska_dimensions(self.header()), [(1280,720)])
        self.assertEqual(matroska_dimensions(self.header(height=576)), [(1280,576)])
        self.assertEqual(matroska_dimensions(self.header(kind=2)), [])
        self.assertEqual(matroska_dimensions(self.header()[:-2]), [])
        self.assertEqual(matroska_dimensions(b'garbage'+self.header()), [])
        self.assertEqual(matroska_dimensions(self.header().replace(b'matroska',b'bad-type')), [])
        self.assertEqual(matroska_dimensions(self.header(height=20000)), [])

    async def test_header_probe_is_bounded_and_closes_iterator(self):
        stream=SimpleNamespace(__anext__=AsyncMock(return_value=self.header()), close=AsyncMock())
        self.pipeline.client.iter_download=lambda *a,**k: stream
        dimensions,count=await inspect_header(self.pipeline,self.message.document)
        self.assertEqual(dimensions,[(1280,720)])
        self.assertEqual(count,len(self.header()))
        stream.close.assert_awaited_once()
        stream.__anext__.reset_mock()
        stream.close.reset_mock()
        stream.__anext__.return_value=b'\0'*65536
        dimensions,count=await inspect_header(self.pipeline,self.message.document)
        self.assertEqual(dimensions,[])
        self.assertEqual(count,262144)
        self.assertEqual(stream.__anext__.await_count,4)
        stream.close.assert_awaited_once()

    async def test_protected_file_is_never_read_even_if_header_requested(self):
        self.message.document.attributes=[]
        self.message.noforwards=True
        self.request['files'][0]['inspectHeader']=True
        self.path.write_text(json.dumps(self.request))
        self.pipeline.client.iter_download=AsyncMock()
        await inspect_requested_files(self.pipeline)
        self.pipeline.client.iter_download.assert_not_called()

    async def test_quality_recovery_uses_exact_observed_height_and_current_document_hash(self):
        await inspect_requested_files(self.pipeline)
        proposals=verified_video_proposals(self.db)
        self.assertEqual(proposals[1]['quality'],'720p')
        self.assertEqual(proposals[1]['title'],'Kiznaiver')
        self.assertEqual(proposals[1]['episode'],5)
        self.db.execute("UPDATE files SET document_id='99'")
        self.db.commit()
        self.assertEqual(verified_video_proposals(self.db),{})

    async def test_cropped_height_is_not_rounded_to_a_standard_resolution(self):
        self.message.document.attributes=[DocumentAttributeVideo(duration=24,w=720,h=392)]
        await inspect_requested_files(self.pipeline)
        self.assertEqual(verified_video_proposals(self.db)[1]['quality'],'392p')

    async def test_bounded_cohort_request_is_guarded_by_the_whole_source_snapshot(self):
        proof=self.request['files']
        request={'version':2,'fileIds':[1],'sourceRowsSha256':hashlib.sha256(json.dumps(proof,sort_keys=True).encode()).hexdigest()}
        self.path.write_text(json.dumps(request))
        await inspect_requested_files(self.pipeline)
        self.pipeline.client.get_messages.assert_awaited_once()
        self.pipeline.client.get_messages.reset_mock()
        request['sourceRowsSha256']='0'*64
        self.path.write_text(json.dumps(request))
        await inspect_requested_files(self.pipeline)
        self.pipeline.client.get_messages.assert_not_awaited()

    async def test_global_audit_inspection_is_checkpointed_in_twenty_file_batches(self):
        files=[]
        for ident in range(1,22):
            raw=json.dumps({'id':ident,'name':'Kiznaiver HD - 05.mkv','size':123})
            self.db.execute("INSERT OR REPLACE INTO files(id,record,document_id,state,destination_id) VALUES(?,?,'42','copied',?)",(ident,raw,100+ident))
            files.append({'id':ident,'documentId':'42','recordSha256':hashlib.sha256(raw.encode()).hexdigest(),'inspectHeader':True})
        self.db.commit()
        self.path.write_text(json.dumps({'version':3,'createdBy':'archive-parser-audit-v1','files':files}))
        async def messages(_peer,ids):
            return [SimpleNamespace(**{**self.message.__dict__,'id':ident}) for ident in ids]
        self.pipeline.client.get_messages.side_effect=messages
        await inspect_requested_files(self.pipeline)
        evidence_path=self.root/'archive-full-match/video-metadata-evidence.json'
        first=json.loads(evidence_path.read_text())
        self.assertEqual(len(first['files']),20)
        self.assertFalse(first['complete'])
        await inspect_requested_files(self.pipeline)
        second=json.loads(evidence_path.read_text())
        self.assertEqual(len(second['files']),21)
        self.assertEqual(len(second['outcomes']),21)
        self.assertTrue(second['complete'])
        await inspect_requested_files(self.pipeline)
        self.assertEqual(self.pipeline.client.get_messages.await_count,2)
        self.assertEqual(self.pipeline.client.get_messages.await_args_list[0].kwargs['ids'],list(range(1,21)))
        self.assertEqual(self.pipeline.client.get_messages.await_args_list[1].kwargs['ids'],[21])

    async def test_stale_batched_file_has_terminal_reason_and_never_calls_telegram(self):
        self.request['files'][0]['recordSha256']='0'*64
        self.request.update(version=3,createdBy='archive-parser-audit-v1')
        self.path.write_text(json.dumps(self.request))
        await inspect_requested_files(self.pipeline)
        result=json.loads((self.root/'archive-full-match/video-metadata-evidence.json').read_text())
        self.assertTrue(result['complete'])
        self.assertEqual(result['outcomes']['1'],'source-changed-or-no-longer-unmatched')
        self.pipeline.client.get_messages.assert_not_awaited()


if __name__ == '__main__':
    unittest.main()
