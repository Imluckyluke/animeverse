import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_pipeline import open_db
from archive_parser_audit import audit,request_resolution_conflicts


class ParserAuditTests(unittest.TestCase):
    def test_resolution_conflict_requests_are_explicit_copied_unmatched_videos_only(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)
            db=open_db(data/'archive-pipeline.sqlite3')
            records=[{'id':1,'name':'Example - 02 [1080p].mkv','caption':'Example - 02 [480p].mkv','quality':'480p'},
                     {'id':2,'name':'Example HD - 02.mkv','caption':'Example HD - 02.mkv'},
                     {'id':3,'name':'Example - 02 [720p].mkv','caption':'Example - 02 [720p].mkv','quality':'720p'},
                     {'id':4,'name':'Example - 02 [1080p].srt','caption':'Example - 02 [480p].srt'},
                     {'id':5,'name':'Example - 02 [1080p].mkv','caption':'Example - 02 [480p].mkv'},
                     {'id':6,'name':'Example - 02 [1080p].mkv','caption':'Example - 02 [480p].mkv'}]
            for r in records:
                db.execute('INSERT INTO files(id,record,document_id,state,destination_id,anime_key) VALUES(?,?,?,?,?,?)',
                    (r['id'],json.dumps(r),str(r['id']),'pending' if r['id']==6 else 'copied',100+r['id'],'known' if r['id']==5 else None))
            db.commit()
            previous={'version':1,'files':[{'id':99}]}
            (data/'archive-full-match').mkdir()
            (data/'archive-full-match/video-metadata-request.json').write_text(json.dumps(previous))
            with patch('archive_parser_audit.DATA',data):
                request=request_resolution_conflicts(data/'out')
            self.assertEqual([r['id'] for r in request['files']],[1])
            self.assertTrue(request['files'][0]['inspectHeader'])
            self.assertEqual(json.loads((data/'out/previous-request.json').read_text()),previous)
            for r in records:
                self.assertEqual(json.loads(db.execute('SELECT record FROM files WHERE id=?',(r['id'],)).fetchone()[0]),r)
            db.close()

    def test_all_unmatched_files_get_status_and_metadata_requests_are_video_only(self):
        with tempfile.TemporaryDirectory() as folder:
            data=Path(folder)
            db=open_db(data/'archive-pipeline.sqlite3')
            records=[{'id':1,'name':'Example HD - 02.mkv','size':100},
                     {'id':2,'name':'subtitle.srt'},
                     {'id':3,'name':'Already matched - 02 [720p].mkv'}]
            for r in records:
                db.execute("INSERT INTO files(id,record,document_id,state,destination_id,anime_key) VALUES(?,?,?,'copied',?,?)",
                    (r['id'],json.dumps(r),str(r['id']),100+r['id'],'known' if r['id']==3 else None))
            db.commit()
            (data/'aniplus-state.json').write_text('{"anime":{},"queue":{}}')
            (data/'archive-identity-cache.json').write_text('{}')
            with patch('archive_parser_audit.DATA',data):
                summary=audit(data/'out',request_metadata=True)
            self.assertEqual(summary['unmatchedFiles'],2)
            self.assertEqual(summary['accountedFiles'],2)
            self.assertEqual(summary['statusCounts'],{'missing_quality':1,'not_video':1})
            request=json.loads((data/'archive-full-match/video-metadata-request.json').read_text())
            self.assertEqual(request['version'],3)
            self.assertEqual([r['id'] for r in request['files']],[1])
            for r in records:
                self.assertEqual(json.loads(db.execute('SELECT record FROM files WHERE id=?',(r['id'],)).fetchone()[0]),r)
            db.close()


if __name__=='__main__':
    unittest.main()
