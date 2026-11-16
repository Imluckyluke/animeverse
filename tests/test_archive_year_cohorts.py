import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import make_plan, apply_plan, filename_year_cohorts, existing_identities
from archive_pipeline import open_db, store_record
from archive_review import review_rows


def provider(ident, year):
    return {'id': ident, 'title': {'romaji': 'Example'}, 'synonyms': [], 'format': 'TV',
            'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': year}}


class FilenameYearCohortTests(unittest.TestCase):
    def fixture(self, directory):
        db = open_db(Path(directory) / 'files.sqlite3')
        records = [
            {'id': 1, 'title': 'Example', 'name': 'Example (2000) - 02 [720p].mkv', 'episode': 2, 'quality': '720p'},
            {'id': 2, 'title': 'Example', 'name': 'Example (2020) - 02 [720p].mkv', 'episode': 2, 'quality': '720p'},
            {'id': 3, 'title': 'Example', 'name': 'Example - 03 [720p].mkv', 'episode': 3, 'quality': '720p'},
            {'id': 4, 'title': 'Example', 'name': 'Example (2000) (2020) - 04 [720p].mkv', 'episode': 4, 'quality': '720p'},
        ]
        for record in records: store_record(db, record)
        db.execute("UPDATE files SET state='copied',destination_id=id+100")
        cache = {'Example': {'complete': True, 'media': [provider(123, 2000), provider(456, 2020)]}}
        return db, records, cache

    def test_explicit_versions_are_separate_and_unknown_or_conflicting_files_remain_held(self):
        with tempfile.TemporaryDirectory() as temporary:
            db, records, cache = self.fixture(temporary)
            state = {'anime': {}, 'queue': {}}
            plan = make_plan(db, state, cache, 200)
            self.assertEqual([(entry['providerId'], entry['fileIds']) for entry in plan['entries']], [(123, [1]), (456, [2])])
            self.assertEqual(apply_plan(state, db, plan)['matchedFiles'], 2)
            self.assertEqual([row[0] for row in db.execute('SELECT anime_key FROM files ORDER BY id')], ['al123', 'al456', None, None])
            self.assertEqual([json.loads(row[0]) for row in db.execute('SELECT record FROM files ORDER BY id')], records)
            db.close()

    def test_an_unmarked_file_never_inherits_a_neighbours_only_known_year(self):
        with tempfile.TemporaryDirectory() as temporary:
            db, records, cache = self.fixture(temporary)
            db.execute('DELETE FROM files WHERE id IN (1,4)')
            plan = make_plan(db, {'anime': {}}, cache, 200)
            self.assertEqual([entry['fileIds'] for entry in plan['entries']], [[2]])
            db.close()

    def test_existing_certified_other_version_is_not_a_target_page_but_unknown_or_duplicate_pages_hold(self):
        state = {'anime': {
            'original': {'titleEn': 'Example', 'metadataProviderId': 123, 'year': 2000},
            'remake': {'titleEn': 'Example', 'metadataProviderId': 456, 'year': 2020},
        }}
        before = copy.deepcopy(state)
        self.assertEqual([key for key, _ in existing_identities(state, provider(456, 2020))], ['remake'])
        self.assertEqual(state, before)
        state['anime']['unknown'] = {'titleEn': 'Example'}
        self.assertEqual(len(existing_identities(state, provider(456, 2020))), 2)
        state['anime']['unknown']['metadataProviderId'] = 456
        self.assertEqual(len(existing_identities(state, provider(456, 2020))), 2)

    def test_audit_accounts_for_all_year_cohorts_without_calling_the_holds_matched(self):
        with tempfile.TemporaryDirectory() as temporary:
            db, records, cache = self.fixture(temporary)
            rows = [{**dict(row), 'parsed': json.loads(row['record'])} for row in db.execute('SELECT * FROM files')]
            cohorts = filename_year_cohorts(rows)
            self.assertEqual(sorted(row['id'] for group in cohorts for row in group), [1, 2, 3, 4])
            decisions = review_rows(rows, {'anime': {}}, cache, {})
            self.assertEqual([item['status'] for item in decisions], ['ready_to_bind', 'ready_to_bind', 'ambiguous_remake', 'ambiguous_remake'])
            db.close()

    def test_limits_and_existing_binding_conflicts_remain_authoritative(self):
        with tempfile.TemporaryDirectory() as temporary:
            db, records, cache = self.fixture(temporary)
            self.assertEqual(len(make_plan(db, {'anime': {}}, cache, 1)['entries']), 1)
            db.execute("INSERT INTO bindings VALUES('Example','different',0)")
            self.assertEqual(make_plan(db, {'anime': {}}, cache, 200)['entries'], [])
            db.close()


if __name__ == '__main__': unittest.main()
