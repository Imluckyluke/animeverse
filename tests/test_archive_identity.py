import json
from pathlib import Path
import sqlite3
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/tg'))
from archive_identity import choose_identity, compatible_record, make_plan, normalized, safe_episode_record


def video(**changes):
    return {'title':'Example','name':'[Team] Example - 02 [720p].mkv','caption':'',
            'episode':2,'quality':'720p',**changes}


def media(number=1, **changes):
    return {'id':number,'title':{'romaji':'Example','english':'Example','native':'例'},
            'synonyms':[],'format':'TV','episodes':12,'startDate':{'year':2004},'status':'FINISHED',**changes}


class ArchiveIdentityTests(unittest.TestCase):
    def test_unique_exact_provider_title_only(self):
        chosen,reason=choose_identity('Example',[video()],[media()])
        self.assertEqual(chosen['id'],1)
        self.assertEqual(reason,'unique-exact-provider-identity')
        self.assertIsNone(choose_identity('Example Short',[video()],[media()])[0])

    def test_remake_is_ambiguous_even_if_old_episode_count_is_smaller(self):
        records=[video(episode=148)]
        self.assertIsNone(choose_identity('Example',records,[media(1,episodes=62),media(2,episodes=148,startDate={'year':2011})])[0])

    def test_explicit_file_year_can_disambiguate_a_remake(self):
        records=[video(name='Example (2011) - 02 [720p].mkv')]
        chosen,_=choose_identity('Example',records,[media(1),media(2,startDate={'year':2011})])
        self.assertEqual(chosen['id'],2)

    def test_year_qualified_remake_is_a_conflict_not_a_reason_to_choose_original(self):
        modern=media(2,title={'romaji':'Example (2021)'},startDate={'year':2021})
        self.assertIsNone(choose_identity('Example',[video()],[media(1),modern])[0])

    def test_publication_rejects_a_different_explicit_remake_year(self):
        anime={'year':2004,'declaredEpisodes':12}
        self.assertFalse(compatible_record(anime,video(name='Example (2021) - 02 [720p].mkv')))
        self.assertTrue(compatible_record(anime,video(name='Example (2004) - 02 [720p].mkv')))

    def test_approved_season_alias_requires_its_provider_evidence(self):
        provider=media(20626,title={'romaji':'FAIRY TAIL (2014)'},synonyms=['Fairy Tail Season 2'],episodes=102,startDate={'year':2014})
        chosen,_=choose_identity('Fairy Tail S2',[video()],[provider])
        self.assertEqual(chosen['id'],20626)
        self.assertIsNone(choose_identity('Fairy Tail S2',[video()],[{**provider,'synonyms':[]}])[0])
        anime={'year':2014,'declaredEpisodes':102,'verifiedArchiveTitles':['Fairy Tail S2']}
        self.assertFalse(compatible_record(anime,video(title='Fairy Tail S2',episode=103)))

    def test_approved_alias_never_accepts_another_season_at_publication(self):
        anime={'year':2014,'declaredEpisodes':102,'verifiedArchiveTitles':['Fairy Tail S2']}
        self.assertTrue(compatible_record(anime,video(title='Fairy Tail S2',name='Fairy Tail S2 - 02 [720p].mkv')))
        self.assertFalse(compatible_record(anime,video(title='Fairy Tail S3',name='Fairy Tail S3 - 02 [720p].mkv')))

    def test_episode_bound_and_unreleased_provider_are_rejected(self):
        for candidate in [media(episodes=1),media(episodes=None),media(status='NOT_YET_RELEASED')]:
            self.assertIsNone(choose_identity('Example',[video()],[candidate])[0])

    def test_packs_nonvideo_and_conflicting_quality_are_not_episodes(self):
        for name in ['Example - 01 - 02 [720p].mkv','Example - 01-12 [720p].mkv','Example.S01E01-E02.720p.mkv','Example - 02 [720p].zip','Example - 02 [720p].ass']:
            self.assertFalse(safe_episode_record(video(name=name)),name)
        self.assertFalse(safe_episode_record(video(name='Example - 02 [1080p].mkv')))
        self.assertFalse(safe_episode_record(video(caption='Example - 02 [1080p]')))
        self.assertFalse(safe_episode_record(video(episode=2024)))
        self.assertTrue(safe_episode_record(video()))
        self.assertTrue(safe_episode_record(video(title='Example Part 5',name='Example Part Five - 02 [720p].mkv',caption='Example Part 5 - 02 [720p]')))
        self.assertFalse(safe_episode_record(video(title='Example Part 5',name='Example Part Five - 01-02 [720p].mkv')))

    def test_filename_season_cannot_be_erased_by_caption_title(self):
        self.assertFalse(safe_episode_record(video(name='Example S2 - 02 [720p].mkv')))
        self.assertTrue(safe_episode_record(video(title='Example S2',name='Example S2 - 02 [720p].mkv')))

    def test_normalization_does_not_erase_season_year_or_title_numbers(self):
        self.assertNotEqual(normalized('Example'),normalized('Example S2'))
        self.assertNotEqual(normalized('Example'),normalized('Example (2011)'))
        self.assertNotEqual(normalized('Mob Psycho'),normalized('Mob Psycho 100'))

    def test_dry_plan_never_writes_bindings_and_holds_existing_year_conflict(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
        db.executescript('CREATE TABLE files(id INTEGER,record TEXT,state TEXT,anime_key TEXT,destination_id INTEGER); CREATE TABLE bindings(title TEXT,anime_key TEXT,conflict INTEGER);')
        db.execute('INSERT INTO files VALUES (1,?,\'copied\',NULL,9)',(json.dumps(video()),))
        cache={'Example':{'complete':True,'media':[media()]}}
        plan=make_plan(db,{'anime':{}},cache,40)
        self.assertEqual(plan['entries'][0]['copiedFiles'],1)
        self.assertEqual(db.execute('SELECT count(*) FROM bindings').fetchone()[0],0)
        plan=make_plan(db,{'anime':{'old':{'titleEn':'Example','year':2011}}},cache,40)
        self.assertEqual(plan['entries'],[])
        self.assertEqual(plan['heldTitles']['existing-page-year-conflict'],1)
        db.close()

    def test_external_catalog_does_not_claim_aniplus_metadata_or_guessed_age(self):
        from catalog import build_catalog
        state={'anime':{'al1':{'key':'al1','slug':'example','titleEn':'Example','year':2004,
            'metadataSource':'anilist','metadataUrl':'https://anilist.co/anime/1',
            'episodes':{'2':{'720p':'archive:1'}}}},'queue':{'archive:1':{
                'status':'done','url':'https://t.me/testanivers/9'}}}
        row=build_catalog(state)[0]
        self.assertEqual(row['source'],'archive');self.assertEqual(row['year'],2004)
        self.assertNotIn('sourcePostUrl',row);self.assertNotIn('scoreReportedVia',row)
        self.assertEqual(row['ageRating'],'');self.assertEqual(row['audio'],[])


if __name__=='__main__':
    unittest.main()
