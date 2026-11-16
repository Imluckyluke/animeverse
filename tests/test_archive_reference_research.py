import importlib.util
from pathlib import Path
import json
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'tools/tg/archive_reference_research.py'
spec = importlib.util.spec_from_file_location('reference_research', path)
research = importlib.util.module_from_spec(spec)
import sys
sys.path.insert(0, str(path.parent))
spec.loader.exec_module(research)


class ReferenceResearchTests(unittest.TestCase):
    def test_base_name_research_preserves_file_scope_and_never_erases_other_parts(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'files.sqlite3'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE files(id INTEGER,record TEXT,state TEXT,anime_key TEXT)')
            titles = ['Example S1', 'Other S2', 'Separate S1 Part 2', 'Remake (2019) S1']
            for ident, title in enumerate(titles, 1):
                db.execute("INSERT INTO files VALUES(?,?,'copied',NULL)", (ident, json.dumps({'title': title})))
            db.commit()
            queries, total = research.title_inventory(path, research_base_names=True)
            self.assertEqual(total, 4)
            self.assertEqual(set(queries), {*titles, 'Example', 'Remake (2019)'})
            self.assertEqual([json.loads(raw)['title'] for raw, in db.execute('SELECT record FROM files')], titles)
            db.close()
    def test_missing_titles_are_researched_from_filenames_without_modifying_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'files.sqlite3'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE files(id INTEGER,record TEXT,state TEXT,anime_key TEXT)')
            record = json.dumps({'name': 'Example - 02 [720p].mkv', 'title': None})
            db.execute("INSERT INTO files VALUES(1,?,'copied',NULL)", (record,))
            db.commit()
            titles, total = research.title_inventory(path)
            self.assertEqual((titles, total), ({'Example': 1}, 1))
            self.assertEqual(db.execute('SELECT record FROM files').fetchone()[0], record)
            db.close()

    def test_full_filename_names_are_researched_even_when_caption_uses_a_short_alias(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'files.sqlite3'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE files(id INTEGER,record TEXT,state TEXT,anime_key TEXT)')
            raw = json.dumps({'name': 'Example Full Title - 02 [720p].mkv', 'title': 'Short alias'})
            db.execute("INSERT INTO files VALUES(1,?,'copied',NULL)", (raw,))
            db.commit()
            titles, total = research.title_inventory(path)
            self.assertEqual((titles, total), ({'Short alias': 1, 'Example Full Title': 1}, 1))
            self.assertEqual(db.execute('SELECT record FROM files').fetchone()[0], raw)
            db.close()

    def test_hd_and_missing_quality_do_not_hide_titles_from_reference_intake(self):
        with tempfile.TemporaryDirectory() as temporary:
            path=Path(temporary)/'files.sqlite3'
            db=sqlite3.connect(path)
            db.execute('CREATE TABLE files(id INTEGER,record TEXT,state TEXT,anime_key TEXT)')
            records=[{'id':1,'name':'Example HD - 02.mkv'},
                     {'id':2,'name':'Other - 03.mkv'},
                     {'id':3,'name':'7114867204.mp4'},
                     {'id':4,'name':'subtitle.srt'}]
            for record in records:
                db.execute("INSERT INTO files VALUES(?,?,'copied',NULL)",(record['id'],json.dumps(record)))
            db.commit()
            titles,total=research.title_inventory(path)
            self.assertEqual(titles,{'Example':1,'Other':1})
            self.assertEqual(total,4)
            self.assertEqual([json.loads(r[0]) for r in db.execute('SELECT record FROM files ORDER BY id')],records)
            db.close()

    def test_completed_searches_are_not_repeated_and_canonical_search_is_separate(self):
        tasks = research.pending_tasks({'Example S2': 10, 'Finished': 1}, {'Finished': {'complete': True}}, now=1)
        self.assertEqual([(task['title'], task['kind']) for task in tasks], [('Example S2', 'raw'), ('Example S2', 'canonical')])

    def test_user_titles_are_graphql_variables_not_query_fragments(self):
        title = 'Example"}){private}'
        request = research.batch_request([{'query': title, 'page': 1}])
        self.assertNotIn(title, request['query'])
        self.assertEqual(request['variables']['s0'], title)

    def test_partial_pages_stay_incomplete_and_resume_on_the_next_page(self):
        cache = {}
        task = {'title': 'Example', 'query': 'Example', 'page': 1, 'kind': 'raw'}
        page = {'media': [{'id': 1, 'type': 'ANIME'}], 'pageInfo': {'hasNextPage': True}}
        self.assertEqual(research.accept_batch(cache, [task], {'r0': page}), 0)
        self.assertFalse(cache['Example']['complete'])
        next_task = research.pending_tasks({'Example': 1}, cache)[0]
        self.assertEqual(next_task['page'], 2)
        page = {'media': [{'id': 2, 'type': 'ANIME'}], 'pageInfo': {'hasNextPage': False}}
        self.assertEqual(research.accept_batch(cache, [next_task], {'r0': page}), 1)
        self.assertTrue(cache['Example']['complete'])
        self.assertEqual([item['id'] for item in cache['Example']['media']], [1, 2])
        self.assertEqual(research.pending_tasks({'Example': 1}, cache), [])

    def test_missing_pagination_proof_never_certifies_a_search(self):
        with self.assertRaises(ValueError):
            research.accept_batch({}, [{'title': 'Example', 'page': 1, 'kind': 'raw', 'query': 'Example'}], {'r0': {'media': []}})

    def test_reviewed_cross_source_reference_requires_all_exact_facts(self):
        media = {'id': 149810, 'idMal': 51863, 'type': 'ANIME', 'title': {'romaji': 'Shishang Zui Qiang Nan Zhujue'}, 'format': 'ONA', 'episodes': 48, 'status': 'FINISHED', 'startDate': {'year': 2022}}
        lead = {'archiveTitle': 'The Strongest Male Hero Ever', 'media': media}
        self.assertEqual(research.validate_reviewed_lead(lead), media)
        for changes in [{'idMal': 1}, {'episodes': 49}, {'format': 'TV'}, {'title': {'romaji': 'A different show'}}]:
            with self.assertRaises(ValueError): research.validate_reviewed_lead({**lead, 'media': {**media, **changes}})

    def test_invalid_reviewed_bundle_never_partially_changes_the_cache(self):
        media = {'id': 149810, 'idMal': 51863, 'type': 'ANIME', 'title': {'romaji': 'Shishang Zui Qiang Nan Zhujue'}, 'format': 'ONA', 'episodes': 48, 'status': 'FINISHED', 'startDate': {'year': 2022}}
        valid = {'archiveTitle': 'The Strongest Male Hero Ever', 'media': media}
        invalid = {**valid, 'media': {**media, 'idMal': 1}}
        with patch.object(research, 'read_json', return_value={'version': 1, 'leads': [valid, invalid]}), patch.object(research, 'atomic_write_json') as write:
            with self.assertRaises(ValueError): research.merge_reviewed_lead(Path('reviewed.json'))
            write.assert_not_called()

    def test_deferred_or_broad_searches_are_never_reported_as_an_empty_completed_queue(self):
        for progress, expected, held, deferred in [
            ({'retryAt': 300}, 'research_waiting', 0, 1),
            ({'held': True, 'reason': 'provider-results-too-broad'}, 'research_complete_with_holds', 1, 0),
        ]:
            cache = {'Example': {'complete': False, 'researchPages': {'raw': progress}}}
            with patch.object(research.time, 'time', return_value=200), patch.object(research, 'atomic_write_json'):
                self.assertEqual(research.pending_tasks({'Example': 10}, cache), [])
                report = research.save_progress({'Example': 10}, 10, cache, 0, 0, 'research_complete')
                self.assertEqual(report['state'], expected)
                self.assertEqual(report['remainingSearches'], 1)
                self.assertEqual(report['readySearches'], 0)
                self.assertEqual(report['heldBroadSearches'], held)
                self.assertEqual(report['deferredSearches'], deferred)


if __name__ == '__main__': unittest.main()
