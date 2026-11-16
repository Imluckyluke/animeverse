import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools' / 'tg'))
from archive_identity import apply_plan, enrich_reviewed_pages, make_plan, choose_identity
from archive_pipeline import open_db, store_record


class ReviewedMetadataTests(unittest.TestCase):
    def test_exact_2019_dr_stone_page_can_be_certified_without_touching_legacy_duplicate(self):
        import copy
        from archive_identity import APPROVED_LEGACY_DUPLICATE_FACTS
        key='t24816699656'
        page={'titleEn':'Dr. Stone','titleOriginal':'Dr. Stone','year':2019,'type':'سریال',
              'format':None,'declaredEpisodes':24,'slug':'dr-stone-2','postIds':[29628]}
        legacy_key,legacy=APPROVED_LEGACY_DUPLICATE_FACTS['Dr. Stone S1']
        media={'id':105333,'idMal':38691,'title':{'romaji':'Dr. STONE'},'format':'TV','episodes':24,
               'status':'FINISHED','startDate':{'year':2019}}
        cache={'Dr. Stone S1':{'complete':True,'media':[media]}}
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3')
            store_record(db,{'id':12037,'title':'Dr. Stone S1','name':'[AWHT] Dr. Stone S1 - 02 [480p].mkv',
                             'episode':2,'season':1,'quality':'480p'})
            db.execute("UPDATE files SET state='copied',destination_id=101")
            state={'anime':{key:copy.deepcopy(page),legacy_key:copy.deepcopy(legacy)},'queue':{}}
            self.assertEqual(enrich_reviewed_pages(state,cache,only_keys={'unrelated'}),0)
            self.assertEqual(enrich_reviewed_pages(state,cache,only_keys={key}),1)
            plan=make_plan(db,state,cache,200)
            self.assertEqual(plan['entries'][0]['key'],key)
            self.assertEqual(apply_plan(state,db,plan)['matchedFiles'],1)
            self.assertEqual(state['anime'][legacy_key],legacy)
            self.assertEqual(state['anime'][key]['slug'],page['slug'])
            for changes in [{'year':2021},{'titleOriginal':'Different'},{'postIds':[999]}]:
                state['anime'][legacy_key]={**legacy,**changes}
                db.execute('UPDATE files SET anime_key=NULL')
                self.assertEqual(make_plan(db,state,cache,200)['entries'],[])
            db.close()

    def test_yozakura_literal_scraper_year_correction_requires_both_names_and_primary_facts(self):
        import copy
        key='hyozakura-san-chi-no-daisakusen'
        page={'titleEn':'Mission: Yozakura Family','titleOriginal':'Yozakura-san Chi no Daisakusen',
              'year':2023,'format':None,'type':'سریال','slug':'mission-yozakura-family','postIds':[23875]}
        media={'id':158898,'idMal':53865,'title':{'romaji':page['titleOriginal'],'english':page['titleEn']},
               'format':'TV','episodes':27,'status':'FINISHED','startDate':{'year':2024}}
        cache={'Mission: Yozakura Family':{'complete':True,'media':[media]}}
        state={'anime':{key:copy.deepcopy(page)}}
        self.assertEqual(enrich_reviewed_pages(state,cache,only_keys={'different'}),0)
        self.assertEqual(enrich_reviewed_pages(state,cache),1)
        self.assertEqual(state['anime'][key]['year'],2024)
        self.assertEqual(state['anime'][key]['metadataProviderId'],158898)
        self.assertEqual(state['anime'][key]['postIds'],[23875])
        self.assertEqual(state['anime'][key]['slug'],page['slug'])
        self.assertEqual(enrich_reviewed_pages(state,cache),0)
        for change in [{'titleEn':'Different'},{'year':2025},{'metadataProviderId':999},{'declaredEpisodes':12},{'format':'MOVIE'}]:
            test={'anime':{key:{**page,**change}}}
            self.assertEqual(enrich_reviewed_pages(test,cache),0)
            self.assertEqual(test['anime'][key],{**page,**change})
        for change in [{'idMal':999},{'episodes':12},{'startDate':{'year':2023}}]:
            test={'anime':{key:copy.deepcopy(page)}}
            self.assertEqual(enrich_reviewed_pages(test,{'x':{'complete':True,'media':[{**media,**change}]}}),0)
    def test_persian_label_in_english_field_does_not_override_independent_official_identity(self):
        for english,expected in [('نام فارسی : نام نمایشی',1),('Different English Identity',0)]:
            with tempfile.TemporaryDirectory() as temporary:
                db=open_db(Path(temporary)/'pipeline.sqlite3')
                store_record(db,{'id':1,'title':'Example','name':'Example - 02 [720p].mkv','episode':2,'quality':'720p'})
                db.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
                page={'titleEn':english,'titleOriginal':'Example','year':2020,'format':None,
                      'type':'سریال','slug':'existing-url','postIds':[100]}
                state={'anime':{'legacy':page},'queue':{}}
                media={'id':123,'title':{'romaji':'Example'},'format':'TV','status':'FINISHED',
                       'episodes':12,'startDate':{'year':2020}}
                result=apply_plan(state,db,make_plan(db,state,{'Example':{'complete':True,'media':[media]}},200))
                self.assertEqual(result.get('matchedFiles',0),expected)
                self.assertEqual(page['titleEn'],english)
                self.assertEqual(page['slug'],'existing-url')
                self.assertEqual(page['postIds'],[100])
                if expected:
                    self.assertEqual(page['metadataProviderId'],123)
                    self.assertEqual(page['declaredEpisodes'],12)
                    self.assertEqual(page['format'],'TV')
                db.close()

    def fixture(self):
        title = 'Boruto: Naruto Next Generations'
        state = {'anime': {'hboruto': {'titleEn': title, 'titleOriginal': title,
                 'year': 2023, 'format': 'TV', 'postIds': [100], 'source': 'aniplus'}}}
        cache = {'Boruto': {'complete': True, 'media': [{'id': 97938, 'title': {'english': title},
                 'format': 'TV', 'status': 'FINISHED', 'episodes': 293, 'startDate': {'year': 2017}}]}}
        return state, cache

    def test_exact_reviewed_page_gets_facts_without_changing_provenance(self):
        state, cache = self.fixture()
        self.assertEqual(enrich_reviewed_pages(state, cache), 1)
        anime = state['anime']['hboruto']
        self.assertEqual((anime['year'], anime['declaredEpisodes'], anime['metadataProviderId']), (2017, 293, 97938))
        self.assertEqual(anime['postIds'], [100])
        self.assertEqual(anime['source'], 'aniplus')
        self.assertNotIn('metadataSource', anime)
        self.assertEqual(enrich_reviewed_pages(state, cache), 0)

    def test_different_page_year_provider_or_episode_count_is_untouched(self):
        for key, value in [('year', 2020), ('titleOriginal', 'Boruto The Movie'),
                           ('metadataProviderId', 21220), ('declaredEpisodes', 12)]:
            state, cache = self.fixture()
            state['anime']['hboruto'][key] = value
            self.assertEqual(enrich_reviewed_pages(state, cache), 0)

    def test_missing_facts_on_exact_title_year_format_are_filled_during_apply(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            store_record(database, {'id': 1, 'title': 'Example S2', 'name': 'Example S2 - 02 [720p].mkv',
                                   'episode': 2, 'quality': '720p'})
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            anime = {'titleEn': 'Example 2nd Season', 'titleOriginal': 'Example 2nd Season', 'year': 2020,
                     'format': 'TV', 'type': 'سریال', 'slug': 'example', 'source': 'aniplus', 'postIds': [100]}
            state = {'anime': {'legacy': anime}, 'queue': {}}
            media = {'id': 123, 'title': {'romaji': 'Example 2nd Season'}, 'synonyms': [],
                     'format': 'TV', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2020}}
            cache = {'Example S2': {'complete': True, 'media': [media]}}
            combined = {'anime': {'legacy': {**anime, 'declaredEpisodes': 24}}, 'queue': {}}
            self.assertEqual(make_plan(database, combined, cache, 200)['entries'], [])
            result = apply_plan(state, database, make_plan(database, state, cache, 200))
            self.assertEqual(result['matchedFiles'], 1)
            self.assertEqual(result['metadataPagesEnriched'], 1)
            self.assertEqual(anime['declaredEpisodes'], 12)
            self.assertEqual(anime['verifiedArchiveTitles'], ['Example S2'])
            self.assertEqual(anime['source'], 'aniplus')
            self.assertEqual(anime['postIds'], [100])
            self.assertNotIn('metadataSource', anime)
            database.execute('UPDATE files SET anime_key=NULL WHERE id=1')
            missing_format = {**anime, 'format': None, 'metadataProviderId': None, 'declaredEpisodes': 12}
            state = {'anime': {'legacy': missing_format}, 'queue': {}}
            result = apply_plan(state, database, make_plan(database, state, cache, 200))
            self.assertEqual(result['matchedFiles'], 1)
            self.assertEqual(missing_format['format'], 'TV')
            self.assertEqual(missing_format['declaredEpisodes'], 12)
            database.close()

    def test_verified_abbreviation_can_fill_identity_without_overwriting_source_format(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = open_db(Path(temporary) / 'pipeline.sqlite3')
            store_record(database, {'id': 1, 'title': 'Seija Musou', 'name': 'Seija Musou - 02 [720p].mkv', 'episode': 2, 'quality': '720p'})
            database.execute("UPDATE files SET state='copied',destination_id=101 WHERE id=1")
            anime = {'titleEn': 'The Great Cleric', 'titleOriginal': 'Seija Musou', 'year': 2023, 'format': 'TV', 'type': 'سریال', 'slug': 'cleric', 'source': 'aniplus', 'postIds': [100], 'declaredEpisodes': None}
            media = {'id': 155418, 'title': {'romaji': 'Seija Musou: Salaryman, Isekai de Ikinokoru Tame ni Ayumu Michi', 'english': 'The Great Cleric'}, 'synonyms': [], 'format': 'ONA', 'status': 'FINISHED', 'episodes': 12, 'startDate': {'year': 2023}}
            state = {'anime': {'legacy': anime}, 'queue': {}}
            cache = {'Seija Musou': {'complete': True, 'media': [media]}}
            result = apply_plan(state, database, make_plan(database, state, cache, 200))
            self.assertEqual(result['matchedFiles'], 1)
            self.assertEqual(anime['metadataProviderId'], 155418)
            self.assertEqual(anime['declaredEpisodes'], 12)
            self.assertEqual(anime['format'], 'TV')
            self.assertEqual(anime['postIds'], [100])
            self.assertEqual(anime['source'], 'aniplus')
            self.assertIsNone(choose_identity('Seija Musou', [{'id': 75132}], [media])[0], 'A future shortened title cannot inherit the old archive review')
            database.close()


if __name__ == '__main__':
    unittest.main()
