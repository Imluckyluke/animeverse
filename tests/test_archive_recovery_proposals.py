import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import apply_recovery_proposals, filename_candidate, filename_web_candidate, caption_candidate


class RecoveryProposalTests(unittest.TestCase):
    def test_caption_recovery_keeps_literal_title_and_source_but_fills_only_missing_episode(self):
        old={'id':1,'title':'Example Season 2','name':'Example Season 2.mkv',
             'caption':'Example Season 2 episode 2 [720p].mkv','episode':None,'quality':'720p','season':2}
        updated=caption_candidate(old,1)
        self.assertIsNotNone(updated)
        self.assertEqual(updated['episode'],2)
        for key in ('title','name','caption','quality','season'):
            self.assertEqual(updated[key],old[key])
        self.assertIsNone(old['episode'])

    def test_caption_recovery_does_not_relabel_a_filename_or_drop_positive_codec_evidence(self):
        old={'id':1,'title':'Example','name':'Example.mkv',
             'caption':'Example episode 2 [720p].mkv','episode':None,'quality':'720p'}
        for changes in [
            {'name':'Different - 02 [720p].mkv'},
            {'name':'Example S2 - 02 [720p].mkv'},
            {'name':'Example - 03 [720p].mkv'},
            {'name':'Example - 02 [1080p].mkv'},
            {'name':'Example - 01-02 [720p].mkv'},
            {'name':'Example - 02 [720p x265].mkv'},
            {'caption':'Different episode 2 [720p].mkv'},
            {'episode':9}, {'quality':'480p'}, {'season':2}, {'part':2},
            {'x265':True}, {'hardsub':True},
        ]:
            self.assertIsNone(caption_candidate({**old,**changes},1),changes)
    def fixture(self):
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        db.executescript('''CREATE TABLE files(id INTEGER PRIMARY KEY,record TEXT,state TEXT,
            anime_key TEXT,destination_id INTEGER,document_id TEXT); CREATE TABLE bindings(title TEXT,anime_key TEXT,conflict INTEGER);''')
        old = {'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': None}
        raw = json.dumps(old)
        db.execute("INSERT INTO files VALUES(1,?,'copied',NULL,101,NULL)", (raw,))
        cache = {'Example': {'complete': True, 'media': [{'id': 123, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}]}}
        proposal = {'id': 1, 'originalSha256': hashlib.sha256(raw.encode()).hexdigest(), 'record': filename_candidate(old, 1)}
        return db, raw, cache, proposal

    def test_only_currently_certified_recovery_is_kept_and_original_is_preserved(self):
        db, raw, cache, proposal = self.fixture()
        self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 1)
        record = json.loads(db.execute('SELECT record FROM files').fetchone()[0])
        self.assertEqual((record['title'], record['episode'], record['quality']), ('Example', 2, '720p'))
        self.assertEqual(record['archiveRecovery']['originalRecord'], json.loads(raw))
        self.assertIsNone(db.execute('SELECT anime_key FROM files').fetchone()[0], 'Assignment remains the separate sole-writer planner step')
        self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 0)
        db.close()

    def test_changed_reference_rolls_back_record_recovery(self):
        db, raw, cache, proposal = self.fixture()
        cache['Example']['media'][0]['title'] = {'romaji': 'Different'}
        self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 0)
        self.assertEqual(db.execute('SELECT record FROM files').fetchone()[0], raw)
        db.close()

    def test_stale_hash_existing_assignment_and_forged_episode_are_untouched(self):
        for change in ['hash', 'assigned', 'episode']:
            db, raw, cache, proposal = self.fixture()
            if change == 'hash': proposal['originalSha256'] = 'stale'
            if change == 'assigned': db.execute("UPDATE files SET anime_key='accepted'")
            if change == 'episode': proposal['record']['episode'] = 9
            self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 0)
            self.assertEqual(db.execute('SELECT record FROM files').fetchone()[0], raw)
            db.close()

    def test_savepoint_respects_an_existing_writer_transaction(self):
        db, raw, cache, proposal = self.fixture()
        self.assertTrue(db.in_transaction)
        self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 1)
        self.assertTrue(db.in_transaction)
        db.rollback()
        db.close()

    def test_full_filename_can_resolve_an_unknown_short_caption_after_complete_searches(self):
        db, raw, cache, proposal = self.fixture()
        old = {'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': 'Short alias', 'episode': 2, 'quality': '720p', 'caption': 'Short alias'}
        raw = json.dumps(old)
        db.execute('UPDATE files SET record=?', (raw,))
        cache['Short alias'] = {'complete': True, 'media': []}
        candidate = filename_web_candidate(old, 1, cache)
        self.assertIsNotNone(candidate)
        proposal = {'id': 1, 'originalSha256': hashlib.sha256(raw.encode()).hexdigest(), 'record': candidate}
        self.assertEqual(apply_recovery_proposals({'anime': {}}, db, cache, [proposal]), 1)
        restored = json.loads(db.execute('SELECT record FROM files').fetchone()[0])
        self.assertEqual(restored['caption'], 'Short alias')
        self.assertEqual(restored['archiveRecovery']['originalRecord']['title'], 'Short alias')
        db.close()

    def test_known_different_caption_identity_and_incomplete_search_are_not_overwritten(self):
        db, raw, cache, proposal = self.fixture()
        old = {'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': 'Different', 'episode': 2, 'quality': '720p'}
        self.assertIsNone(filename_web_candidate(old, 1, cache))
        cache['Different'] = {'complete': True, 'media': [{**cache['Example']['media'][0], 'id': 999, 'title': {'romaji': 'Different'}}]}
        self.assertIsNone(filename_web_candidate(old, 1, cache))
        db.close()

    def test_web_fallback_never_erases_season_part_roman_or_episode_quality_conflicts(self):
        db, raw, cache, proposal = self.fixture()
        for title in ['Unknown S2', 'Unknown Part 2', 'Unknown II', 'Unknown R2']:
            cache[title] = {'complete': True, 'media': []}
            self.assertIsNone(filename_web_candidate({'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': title}, 1, cache))
        cache['Alias'] = {'complete': True, 'media': []}
        for changes in [{'episode': 9}, {'quality': '1080p'}]:
            self.assertIsNone(filename_web_candidate({'id': 1, 'name': 'Example - 02 [720p].mkv', 'title': 'Alias', **changes}, 1, cache))
        db.close()

    def test_spelled_out_filename_season_is_restored_without_dropping_a_caption_marker(self):
        old = {'id': 1, 'title': 'Amagami SS', 'name': 'Amagami SS Season 1 - 01 [720p].mkv',
               'episode': 1, 'quality': '720p'}
        updated = filename_candidate(old, 1)
        self.assertEqual(updated['title'], 'Amagami SS Season 1')
        self.assertEqual(updated['episode'], 1)
        self.assertIsNone(filename_candidate({**old, 'title': 'Amagami SS S2'}, 1))

    def test_an_existing_parsed_season_or_part_is_not_erased_by_filename_recovery(self):
        old = {'id': 1, 'title': 'Example', 'name': 'Example S2 - 02 [720p].mkv',
               'episode': 2, 'quality': '720p'}
        self.assertIsNotNone(filename_candidate(old, 1))
        for changes in [{'season': 1}, {'part': 2}]:
            self.assertIsNone(filename_candidate({**old, **changes}, 1))
        cache = {'Alias': {'complete': True, 'media': []}, 'Example S2': {'complete': True, 'media': [
            {'id': 123, 'title': {'romaji': 'Example S2'}, 'format': 'TV'}]}}
        self.assertIsNotNone(filename_web_candidate({**old, 'title': 'Alias'}, 1, cache))
        for changes in [{'season': 1}, {'part': 2}]:
            self.assertIsNone(filename_web_candidate({**old, 'title': 'Alias', **changes}, 1, cache))


if __name__ == '__main__': unittest.main()
