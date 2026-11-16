import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/tg'))
from archive_identity import APPROVED_ALIASES, APPROVED_ALIAS_FORMATS, APPROVED_ALIAS_MAX_RECORD_ID, choose_identity, compatible_record, make_plan, safe_episode_record
from archive_pipeline import open_db, store_record
from archive_review import review_rows


class ReviewedReferenceTests(unittest.TestCase):
    def test_verified_numeric_title_is_not_a_pack_but_real_ranges_and_conflicts_still_hold(self):
        source = {'id': 1, 'title': 'Hibike! Euphonium S3', 'episode': 1, 'quality': '720p',
                  'name': '[@AniPlus] Hibike! Euphonium S3 - 1 [720p].mkv',
                  'caption': '[@AnimeWorldqw] Hibike! Euphonium 3 - 01 [720p].mkv'}
        self.assertTrue(safe_episode_record(source))
        for change in [
            {'id': APPROVED_ALIAS_MAX_RECORD_ID[source['title']] + 1},
            {'name': 'Different S3 - 1 [720p].mkv'},
            {'caption': 'Hibike! Euphonium 3 - 01 - 02 [720p].mkv'},
            {'caption': 'Hibike! Euphonium 3 - 02 [720p].mkv'},
            {'multiEpisode': True}, {'quality': '1080p'},
        ]:
            self.assertFalse(safe_episode_record({**source, **change}), change)
    def test_unreviewed_reuse_of_an_alias_never_blocks_or_joins_the_reviewed_cohort(self):
        title = 'Snow White with the Red Hair-s01'
        ceiling = APPROVED_ALIAS_MAX_RECORD_ID[title]
        ident, year, total, official = APPROVED_ALIASES[title]
        media = {'id': ident, 'format': 'TV', 'status': 'FINISHED', 'episodes': total,
                 'startDate': {'year': year}, 'title': {'english': official}}
        with tempfile.TemporaryDirectory() as temporary:
            db = open_db(Path(temporary) / 'files.sqlite3')
            for record_id in [1, ceiling + 1]:
                store_record(db, {'id': record_id, 'title': title, 'episode': 2, 'quality': '720p',
                                  'name': title + ' - 02 [720p].mkv'})
            db.execute("UPDATE files SET state='copied',destination_id=id+100")
            cache = {title: {'complete': True, 'media': [media]}}
            plan = make_plan(db, {'anime': {}}, cache, 200)
            self.assertEqual([entry['fileIds'] for entry in plan['entries']], [[1]])
            self.assertEqual(plan['heldTitles']['archive-alias-needs-new-file-review'], 1)
            rows = [{**dict(row), 'parsed': json.loads(row['record'])} for row in db.execute('SELECT * FROM files ORDER BY id')]
            self.assertEqual([item['status'] for item in review_rows(rows, {'anime': {}}, cache, {})],
                             ['ready_to_bind', 'alias_cohort_review'])
            db.close()
    def test_new_literal_reviews_do_not_become_a_generic_first_season_rule(self):
        for title in ['Tennis no Ouji-sama S1', 'Mushishi S1', 'Hajime no Ippo S1',
                      'Log Horizon S1', 'Log Horizon S2', 'Michiko and Hatchin', 'Ningen Fushin',
                      '2.5 Dimensional Seduction S01', 'Toujima Tanzaburou wa Kamen Rider ni Naritai - S1',
                      'Tensei shitara Slime Datta Ken 1nd Season', 'Futari Solo Camp S1', 'Black Bulter S1',
                      'March comes in like a lion S1', 'Uchouten Kazoku S1', 'Kaginado S1', 'Gin no saji S1',
                      'Ghost in the Shell-s1', 'Senki Zesshou Symphogear GX S3', 'Amagami SS Season 1',
                      'Snow White with the Red Hair-s01', 'Isekai wa Smartphone to Tomo ni S2',
                      'TOHAI - Ura Rate Mahjong Touhai Roku', 'Dragon Raja S2', 'Kodocha.S1',
                      'Amagami SS season2', 'Yowamushi Pedal S5', 'Hibike! Euphonium S3',
                      'Black Bulter S2', 'Four People and Their Respective Lies',
                      'Tearmoon Teikoku Monogatari', 'Tong Ling Fei S2', 'Dagashi Kashi S1',
                      'Dagashi Kashi - S2', 'Monster but Wild S2', 'Wo De Tian Jie Nv You',
                      'Yi Nian Yong Heng 3rd Season', 'Jormungand S2', 'New game S1',
                      'New game S2', 'Ookami to koushinryou S2', 'Goblin Slayer S2', 'Shinka no Mi S2']:
            ident, year, total, official = APPROVED_ALIASES[title]
            media = {'id': ident, 'format': APPROVED_ALIAS_FORMATS.get(title, 'TV'), 'status': 'FINISHED',
                     'episodes': total, 'startDate': {'year': year}, 'title': {'romaji': official}}
            records = [{'id': 1, 'episode': 2, 'name': title + ' - 02 [720p].mkv'}]
            self.assertEqual(choose_identity(title, records, [media])[0]['id'], ident)
            future = [{**records[0], 'id': APPROVED_ALIAS_MAX_RECORD_ID[title] + 1}]
            self.assertIsNone(choose_identity(title, future, [media])[0])
            self.assertIsNone(choose_identity(title, records, [{**media, 'startDate': {'year': year + 1}}])[0])
        self.assertIsNone(choose_identity('Unreviewed S1', [{'id': 1, 'episode': 2}], [
            {'id': 999, 'title': {'romaji': 'Unreviewed'}, 'format': 'TV', 'episodes': 12, 'startDate': {'year': 2020}}
        ])[0])

    def test_reviewed_identity_needs_id_year_count_format_and_official_name(self):
        title = 'Bunny Girl Senpai'
        ident, year, total, evidence = APPROVED_ALIASES[title]
        media = {'id': ident, 'format': 'TV', 'status': 'FINISHED', 'episodes': total,
                 'startDate': {'year': year}, 'title': {'english': evidence}}
        records = [{'episode': 1, 'name': 'Bunny Girl Senpai - 01 [720p].mkv'}]
        self.assertEqual(choose_identity(title, records, [media])[0]['id'], ident)
        for change in [{'id': 2}, {'episodes': 12}, {'format': 'MOVIE'}, {'format': 'TV_SHORT'},
                       {'startDate': {'year': 2019}}, {'title': {'english': 'Other title'}}]:
            self.assertIsNone(choose_identity(title, records, [{**media, **change}])[0])

    def test_short_format_exception_is_literal_and_guarded(self):
        title = 'Isekai Quartet Season 2'
        ident, year, total, evidence = APPROVED_ALIASES[title]
        media = {'id': ident, 'format': 'TV_SHORT', 'status': 'FINISHED', 'episodes': total,
                 'startDate': {'year': year}, 'title': {'english': evidence}}
        self.assertEqual(choose_identity(title, [{'episode': 2}], [media])[0]['id'], ident)
        self.assertIsNone(choose_identity(title, [{'episode': 2}], [{**media, 'format': 'TV'}])[0])

    def test_caption_correction_requires_exact_independent_toaru_filename(self):
        for title, filename, year in [('Toaru Majutsu Index', 'Toaru Majutsu no Index', 2008),
                                       ('Toaru Majutsu Railgun', 'Toaru Kagaku no Railgun', 2009)]:
            anime = {'year': year, 'format': 'TV', 'declaredEpisodes': 24, 'verifiedArchiveTitles': [title]}
            record = {'id': 1, 'title': title, 'episode': 2, 'quality': '720p', 'name': filename + ' - 02 [720p].mkv'}
            self.assertTrue(compatible_record(anime, record))
            self.assertFalse(compatible_record(anime, {**record, 'name': filename + ' III - 02 [720p].mkv'}))
            self.assertFalse(compatible_record(anime, {**record, 'name': title + ' - 02 [720p].mkv'}))

    def test_black_butler_second_season_typo_requires_correct_independent_filename(self):
        anime = {'year': 2010, 'format': 'TV', 'declaredEpisodes': 12,
                 'verifiedArchiveTitles': ['Black Bulter S2']}
        source = {'id': 1, 'title': 'Black Bulter S2', 'episode': 2, 'quality': '720p',
                  'name': 'Black Butler S2 - 02 [720p].mkv'}
        self.assertTrue(compatible_record(anime, source))
        for name in ['Black Bulter S2 - 02 [720p].mkv', 'Black Butler S1 - 02 [720p].mkv',
                     'Black Butler S2 OVA - 02 [720p].mkv']:
            self.assertFalse(compatible_record(anime, {**source, 'name': name}))

    def test_ghost_in_the_shell_requires_the_independent_sac_filename_not_just_a_franchise_label(self):
        anime = {'year': 2002, 'format': 'TV', 'declaredEpisodes': 26, 'verifiedArchiveTitles': ['Ghost in the Shell-s1']}
        record = {'id': 1, 'title': 'Ghost in the Shell-s1', 'episode': 2, 'quality': '720p',
                  'name': 'Ghost in the Shell (S.A.C) S01 E02 [720p].mkv'}
        self.assertTrue(compatible_record(anime, record))
        for name in ['Ghost in the Shell S01 E02 [720p].mkv', 'Ghost in the Shell S2 E02 [720p].mkv']:
            self.assertFalse(compatible_record(anime, {**record, 'name': name}))

    def test_amagami_tv_alias_never_absorbs_the_separate_episode_26(self):
        anime = {'year': 2010, 'format': 'TV', 'declaredEpisodes': 25,
                 'verifiedArchiveTitles': ['Amagami SS Season 1']}
        source = {'id': 1, 'title': 'Amagami SS Season 1', 'episode': 25, 'quality': '720p',
                  'name': 'Amagami SS Season 1 - 25 [720p].mkv'}
        self.assertTrue(compatible_record(anime, source))
        self.assertFalse(compatible_record(anime, {**source, 'episode': 26,
                         'name': 'Amagami SS Season 1 - 26 [720p].mkv'}))

    def test_reviewed_numeric_sequels_do_not_accept_other_seasons_or_specials(self):
        for title in ['Jormungand S2', 'New game S1', 'New game S2',
                      'Ookami to koushinryou S2', 'Goblin Slayer S2', 'Shinka no Mi S2']:
            ident, year, total, official = APPROVED_ALIASES[title]
            anime = {'year': year, 'format': 'TV', 'declaredEpisodes': total,
                     'verifiedArchiveTitles': [title]}
            source = {'id': 1, 'title': title, 'episode': 2, 'quality': '720p',
                      'name': title + ' - 02 [720p].mkv'}
            self.assertTrue(compatible_record(anime, source), title)
            wrong_season = title[:-1] + ('2' if title.endswith('1') else '1')
            self.assertFalse(compatible_record(anime, {**source, 'name': wrong_season + ' - 02 [720p].mkv'}))
            self.assertFalse(compatible_record(anime, {**source, 'name': title + ' OVA - 02 [720p].mkv'}))
            media = {'id': ident, 'idMal': 1, 'format': 'TV', 'status': 'FINISHED', 'episodes': total,
                     'startDate': {'year': year}, 'title': {'romaji': official}}
            self.assertIsNone(choose_identity(title, [source], [media])[0])

    def test_reviewed_tv_alias_does_not_capture_ova(self):
        anime = {'year': 2008, 'format': 'TV', 'declaredEpisodes': 24, 'verifiedArchiveTitles': ['Clannad - S02']}
        record = {'id': 1, 'title': 'Clannad - S02', 'episode': 1, 'quality': '720p',
                  'name': 'Clannad S02 OVA - 01 [720p].mkv'}
        self.assertFalse(compatible_record(anime, record))

    def test_explicit_remake_year_and_se02_need_filename_evidence(self):
        anime = {'year': 2017, 'format': 'TV', 'declaredEpisodes': 12, 'verifiedArchiveTitles': ['Berserk (2017']}
        record = {'id': 1, 'title': 'Berserk (2017', 'episode': 2, 'quality': '720p',
                  'name': 'Berserk (2017) - 02 [720p].mkv'}
        self.assertTrue(compatible_record(anime, record))
        for filename in ['Berserk - 02 [720p].mkv', 'Berserk (2016) - 02 [720p].mkv']:
            self.assertFalse(compatible_record(anime, {**record, 'name': filename}))
        title = '100-man no Inochi SE02'
        anime = {'year': 2021, 'format': 'TV', 'declaredEpisodes': 12, 'verifiedArchiveTitles': [title]}
        record = {'id': 1, 'title': title, 'episode': 2, 'quality': '720p',
                  'name': title + ' EP02 [720p].mkv'}
        self.assertTrue(compatible_record(anime, record))
        self.assertFalse(compatible_record(anime, {**record, 'name': '100-man no Inochi SE03 EP02 [720p].mkv'}))

    def test_complete_canonical_lookup_is_usable_but_partial_results_are_not(self):
        with tempfile.TemporaryDirectory() as temporary:
            db = open_db(Path(temporary) / 'pipeline.sqlite3')
            for ident in [1, 2]:
                store_record(db, {'id': ident, 'title': 'Example Quality Format mkv', 'episode': ident,
                                  'quality': '720p', 'name': f'Example - {ident:02} [720p].mkv'})
            db.execute("UPDATE files SET state='copied',destination_id=id+100")
            media = {'id': 123, 'format': 'TV', 'status': 'FINISHED', 'episodes': 2,
                     'startDate': {'year': 2020}, 'title': {'romaji': 'Example'}}
            entry = {'complete': False, 'canonicalComplete': True, 'canonicalMedia': [media]}
            cache = {'Example Quality Format mkv': entry}
            self.assertEqual(make_plan(db, {'anime': {}}, cache, 200)['entries'][0]['fileIds'], [1, 2])
            entry['canonicalComplete'] = False
            self.assertEqual(make_plan(db, {'anime': {}}, cache, 200)['entries'], [])
            db.close()

    def test_november_reviewed_sequels_keep_source_season_and_cross_reference_guards(self):
        for title in ['The Seven Deadly Sins(S2', 'The Seven Deadly Sins(S3', 'Ghost in the Shell-s2']:
            ident,year,total,official=APPROVED_ALIASES[title]
            season=3 if title.endswith('(S3') else 2
            record={'id':1,'title':title,'episode':2,'quality':'720p',
                    'name':title+' - 02 [720p].mkv','season':season}
            anime={'year':year,'format':'TV','declaredEpisodes':total,'verifiedArchiveTitles':[title]}
            media={'id':ident,'title':{'english':official},'format':'TV','episodes':total,
                   'status':'FINISHED','startDate':{'year':year}}
            self.assertTrue(compatible_record(anime,record),title)
            self.assertEqual(choose_identity(title,[record],[media])[0]['id'],ident)
            self.assertIsNone(choose_identity(title,[record],[{**media,'idMal':999999}])[0])
            self.assertFalse(compatible_record(anime,{**record,'name':'Unrelated S1 - 02 [720p].mkv'}))
            self.assertIsNone(choose_identity(title,[{**record,'id':APPROVED_ALIAS_MAX_RECORD_ID[title]+1}],[media])[0])

    def test_kenshin_remake_alias_requires_explicit_filename_year_for_each_file(self):
        anime={'year':2023,'format':'TV','declaredEpisodes':24,'verifiedArchiveTitles':['Rurouni Kenshin']}
        record={'id':48102,'title':'Rurouni Kenshin','episode':2,'quality':'720p',
                'name':'[AWHT] Rurouni Kenshin (2023) - 02 [720p].mkv'}
        self.assertTrue(compatible_record(anime,record))
        for filename in ['Rurouni Kenshin - 02 [720p].mkv','Rurouni Kenshin (1996) - 02 [720p].mkv',
                         'Rurouni Kenshin (2023) S2 - 02 [720p].mkv',
                         'Rurouni Kenshin (2023) OVA - 02 [720p].mkv']:
            self.assertFalse(compatible_record(anime,{**record,'name':filename}),filename)

    def test_second_november_batch_keeps_tv_bounds_and_misnumbered_file_hold(self):
        for title in ['magi the labyrinth of magic - S2','Story Of The Alps','Classroom S2',
                      "The Ancient Magus'Bride",'Chuunibyou S1','Chuunibyou S2']:
            ident,year,total,official=APPROVED_ALIASES[title]
            anime={'year':year,'format':'TV','declaredEpisodes':total,'verifiedArchiveTitles':[title]}
            name=("The Ancient Magus' Bride" if title=="The Ancient Magus'Bride" else title)
            record={'id':1,'title':title,'episode':2,'quality':'720p','name':name+' - 02 [720p].mkv'}
            media={'id':ident,'format':'TV','episodes':total,'status':'FINISHED',
                   'startDate':{'year':year},'title':{'english':official}}
            self.assertTrue(compatible_record(anime,record),title)
            self.assertEqual(choose_identity(title,[record],[media])[0]['id'],ident)
            self.assertIsNone(choose_identity(title,[record],[{**media,'format':'ONA'}])[0])
            self.assertIsNone(choose_identity(title,[record],[{**media,'idMal':999999}])[0])
            self.assertIsNone(choose_identity(title,[{**record,'id':APPROVED_ALIAS_MAX_RECORD_ID[title]+1}],[media])[0])
            self.assertFalse(compatible_record(anime,{**record,'episode':total+1,
                'name':name+f' - {total+1:02} [720p].mkv'}),title)
        magi={'year':2013,'format':'TV','declaredEpisodes':25,
              'verifiedArchiveTitles':['magi the labyrinth of magic - S2']}
        self.assertFalse(compatible_record(magi,{'id':50096,'title':'magi the labyrinth of magic - S2',
            'episode':1,'quality':'1080p','name':'[AWHT] Magi The Kingdom of Magic - 04 [1080p].mkv',
            'caption':'[@AnimeWorldqw] magi the labyrinth of magic - S2 - 01[1080p].mkv'}))

    def test_third_november_cohort_keeps_ceilings_tv_identity_and_filename_evidence(self):
        for title in ['SNAFU S1','SNAFU S2','SNAFU S3','Non Non Biyori Repeat S2',
                      'Log Horizon: Destruction of the Round Table S3','Kekkai sensen - S2']:
            ident,year,total,official=APPROVED_ALIASES[title]
            anime={'year':year,'format':'TV','declaredEpisodes':total,'verifiedArchiveTitles':[title]}
            record={'id':1,'title':title,'episode':2,'quality':'720p','name':title+' - 02 [720p].mkv'}
            media={'id':ident,'format':'TV','episodes':total,'status':'FINISHED','startDate':{'year':year},'title':{'english':official}}
            self.assertTrue(compatible_record(anime,record),title)
            self.assertEqual(choose_identity(title,[record],[media])[0]['id'],ident)
            self.assertIsNone(choose_identity(title,[record],[{**media,'format':'OVA'}])[0])
            self.assertIsNone(choose_identity(title,[record],[{**media,'idMal':999999}])[0])
            self.assertIsNone(choose_identity(title,[{**record,'id':APPROVED_ALIAS_MAX_RECORD_ID[title]+1}],[media])[0])
            self.assertFalse(compatible_record(anime,{**record,'name':title+' - 03 [720p].mkv'}))
        contradictory={'id':44786,'title':'SNAFU S3','episode':2,'quality':'480p',
            'name':'AWHT_Yahari_Ore_no_Seishun_lovecome_wa_E02_1080.mkv',
            'caption':'[@AnimeWorldqw] SNAFU S3 - 02 [480p].mkv'}
        self.assertFalse(safe_episode_record(contradictory))


if __name__ == '__main__':
    unittest.main()
