import json
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_identity import identical_document_proposals, recover_filename_records, apply_recovery_proposals, make_plan, apply_plan
from archive_pipeline import open_db, store_record
from archive_file_review import fingerprint


class IdenticalDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = open_db(Path(self.temporary.name) / 'pipeline.sqlite3')
        self.peer = {'id': 1, 'title': 'Example', 'name': 'Example - 02 [720p].mkv',
                     'episode': 2, 'quality': '720p', 'size': 1000}
        self.old = {**self.peer, 'id': 2, 'title': 'Wrong caption', 'episode': 9,
                    'caption': 'Wrong caption - 09 [720p]'}
        for record in [self.peer, self.old]:
            store_record(self.database, record)
            self.database.execute("UPDATE files SET state='copied',destination_id=?,document_id='999' WHERE id=?",
                                  (record['id'] + 100, record['id']))
        self.database.execute("UPDATE files SET anime_key='al123' WHERE id=1")
        self.database.commit()
        self.state = {'anime': {'al123': {'titleEn': 'Example', 'titleOriginal': 'Example',
            'slug': 'example',
            'year': 2020, 'format': 'TV', 'declaredEpisodes': 12, 'metadataProviderId': 123,
            'metadataSource': 'anilist', 'verifiedArchiveTitles': ['Example']}}}
        media = {'id': 123, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV',
                 'episodes': 12, 'status': 'FINISHED', 'startDate': {'year': 2020}}
        self.cache = {'Example': {'complete': True, 'media': [media]}}

    def tearDown(self):
        self.database.close()
        self.temporary.cleanup()

    def test_exact_document_can_repair_wrong_caption_without_guessing(self):
        proposals = identical_document_proposals(self.database, self.state)
        self.assertEqual(proposals[2]['episode'], 2)
        self.assertEqual(proposals[2]['title'], 'Example')
        self.assertEqual(proposals[2]['originalCaption'], self.old['caption'])
        self.assertEqual(recover_filename_records(self.database, self.state, self.cache), 1)
        source = json.loads(self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0])
        self.assertEqual(source['documentIdentityEvidence']['sourceFileId'], 1)
        self.assertIsNone(self.database.execute('SELECT anime_key FROM files WHERE id=2').fetchone()[0])

    def test_different_size_or_filename_is_not_a_verified_duplicate(self):
        for changes in [{'size': 999}, {'name': 'Another - 02 [720p].mkv'}]:
            self.database.execute('UPDATE files SET record=? WHERE id=2', (json.dumps({**self.old, **changes}),))
            self.assertEqual(identical_document_proposals(self.database, self.state), {})

    def test_conflicting_peer_assignments_fail_closed(self):
        store_record(self.database, {**self.peer, 'id': 3, 'episode': 3})
        self.database.execute("UPDATE files SET state='copied',document_id='999',anime_key='another' WHERE id=3")
        self.assertEqual(identical_document_proposals(self.database, self.state), {})

    def test_per_file_review_requires_the_peers_certified_document_id(self):
        self.state['anime']['al123']['archiveFileReview'] = {'version': 1, 'files': {
            '1': {'sha256': fingerprint(self.peer), 'documentId': 'different-document'}}}
        self.assertEqual(identical_document_proposals(self.database, self.state), {})

    def test_replay_cannot_accept_a_plan_for_a_different_document_target(self):
        candidate = identical_document_proposals(self.database, self.state)[2]
        raw = self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0]
        proposal = {'id': 2, 'originalSha256': hashlib.sha256(raw.encode()).hexdigest(), 'record': candidate}
        with patch('archive_identity.make_plan', return_value={'entries': [{'key': 'different', 'fileIds': [2]}]}):
            self.assertEqual(apply_recovery_proposals(self.state, self.database, self.cache, [proposal]), 0)
        self.assertEqual(self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0], raw)
        self.assertEqual(apply_recovery_proposals(self.state, self.database, self.cache, [proposal]), 1)
        recovered = json.loads(self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0])
        self.assertEqual(recovered['archiveRecovery']['originalRecord'], self.old)
        self.assertEqual(recovered['documentIdentityEvidence']['animeKey'], 'al123')

    def staged_document(self, episode=1):
        # An abbreviated existing page label is not added to provider synonyms.
        self.state['anime']['al123']['verifiedArchiveTitles'].append('Short label')
        peer = {**self.peer, 'episode': episode, 'title': 'Short label',
                'name': f'Example - {episode:02} [720p].mkv'}
        old = {**peer, 'id': 2, 'title': 'Wrong caption', 'episode': 9, 'caption': 'Wrong caption - 09 [720p]'}
        for record in [peer, old]:
            self.database.execute('UPDATE files SET record=? WHERE id=?', (json.dumps(record), record['id']))
        raw = self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0]
        proposal = {'id': 2, 'originalSha256': hashlib.sha256(raw.encode()).hexdigest(),
                    'record': identical_document_proposals(self.database, self.state)[2]}
        return raw, proposal

    def test_a_single_first_episode_reuses_its_exact_peer_not_an_inferred_alias(self):
        raw, proposal = self.staged_document()
        self.assertEqual(apply_recovery_proposals(self.state, self.database, self.cache, [proposal]), 1)
        plan = make_plan(self.database, self.state, self.cache, 200)
        self.assertEqual(plan['entries'][0]['reason'], 'recertified-identical-document-id-filename-size')
        self.assertEqual(plan['entries'][0]['key'], 'al123')
        self.assertEqual(plan['entries'][0]['fileIds'], [2])
        self.assertEqual(apply_plan(self.state, self.database, plan)['matchedFiles'], 1)
        self.assertEqual(self.database.execute('SELECT anime_key FROM files WHERE id=2').fetchone()[0], 'al123')
        self.assertEqual(json.loads(self.database.execute('SELECT record FROM files WHERE id=2').fetchone()[0])['archiveRecovery']['originalRecord'], json.loads(raw))
        self.assertEqual(self.cache['Example']['media'][0]['synonyms'], [])

    def test_stored_document_evidence_never_substitutes_for_a_current_peer(self):
        raw, proposal = self.staged_document()
        self.assertEqual(apply_recovery_proposals(self.state, self.database, self.cache, [proposal]), 1)
        self.database.execute("UPDATE files SET document_id='different' WHERE id=1")
        self.assertEqual(make_plan(self.database, self.state, self.cache, 200)['entries'], [])

    def test_scoping_keeps_exact_peer_proof_without_admitting_unrelated_titles(self):
        raw,proposal=self.staged_document()
        self.assertEqual(apply_recovery_proposals(self.state,self.database,self.cache,[proposal]),1)
        full=make_plan(self.database,self.state,self.cache,200)
        scoped=make_plan(self.database,self.state,self.cache,200,only_titles={'Short label'})
        self.assertEqual(scoped['entries'],full['entries'])
        self.assertEqual(make_plan(self.database,self.state,self.cache,200,only_titles={'Unrelated'})['entries'],[])
        self.database.execute("UPDATE files SET document_id='changed' WHERE id=1")
        self.assertEqual(make_plan(self.database,self.state,self.cache,200,only_titles={'Short label'})['entries'],[])

    def test_exact_document_path_respects_provider_facts_binding_conflicts_and_limits(self):
        raw, proposal = self.staged_document()
        self.assertEqual(apply_recovery_proposals(self.state, self.database, self.cache, [proposal]), 1)
        self.assertEqual(make_plan(self.database, self.state, self.cache, 0)['entries'], [])
        self.cache['Example']['media'][0]['episodes'] = 13
        self.assertEqual(make_plan(self.database, self.state, self.cache, 200)['entries'], [])
        self.cache['Example']['media'][0]['episodes'] = 12
        self.database.execute("INSERT INTO bindings VALUES('Short label','different',0)")
        self.assertEqual(make_plan(self.database, self.state, self.cache, 200)['entries'], [])


if __name__ == '__main__':
    unittest.main()
