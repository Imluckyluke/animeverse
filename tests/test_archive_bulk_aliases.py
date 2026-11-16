from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_identity import (bulk_alias_filename_allowed,APPROVED_ALIASES,APPROVED_ALIAS_MAL_IDS,
                              APPROVED_ALIAS_MAX_RECORD_ID,APPROVED_ALIAS_FORMATS,choose_identity,compatible_record,
                              safe_episode_record,make_plan,apply_plan,filename_years)
from archive_pipeline import open_db,store_record
import tempfile


class BulkAliasTests(unittest.TestCase):
    def test_reviewed_numeric_titles_do_not_become_episode_packs_or_release_years(self):
        for title,ident,name in [('Night Head 2041',3132,'[AWHT] Night Head 2041 -01 [480p].mkv'),
                                 ('Night Head2041',14768,'[AWHT] Night Head 2041 -11 [480p].mkv'),
                                 ('Tokyo Magnitude 8.0',69075,'[AWHT] Tokyo Magnitude 8.0 -01 [480p].mkv')]:
            episode=11 if ident==14768 else 1
            r={'id':ident,'title':title,'name':name,'caption':name,'episode':episode,'quality':'480p'}
            self.assertTrue(safe_episode_record(r),title)
            self.assertEqual(filename_years(r),set())
            self.assertFalse(safe_episode_record({**r,'name':name.replace(f'-{episode:02}',f'-{episode:02}-12')}))
            if '2041' in title:
                self.assertEqual(filename_years({**r,'id':999999}),{2041})
                self.assertEqual(filename_years({**r,'name':name.replace('.mkv',' [2020].mkv')}),{2020})
                self.assertFalse(compatible_record({'year':2021,'format':'TV','declaredEpisodes':12,
                    'verifiedArchiveTitles':[title]}, {**r,'name':name.replace('.mkv',' [2020].mkv')}))

    def test_literal_kinnikuman_scraper_typo_cannot_be_used_for_another_page_or_title(self):
        title='Muscleman S2'
        media={'id':181886,'idMal':59914,'title':{'romaji':'Kinnikuman: Kanpeki Choujin Shiso-hen Season 2',
               'english':'Kinnikuman Perfect Origin Arc Season 2'},'format':'TV','episodes':11,
               'status':'FINISHED','startDate':{'year':2025}}
        cache={title:{'complete':True,'media':[media]}}
        for key,original,expected in [('hkinnikuman','Kinnikuman: Kanpeki Chоujin Shiso-hen Season 2',1),
                                      ('unreviewed','Kinnikuman: Kanpeki Chоujin Shiso-hen Season 2',0),
                                      ('hkinnikuman','Different title',0)]:
            with tempfile.TemporaryDirectory() as folder:
                db=open_db(Path(folder)/'archive.sqlite3')
                store_record(db,{'id':81029,'title':title,'name':'[@AniPlus] Kinnikuman Perfect Origin-hen S2 - 2 [480p].mkv',
                                 'episode':2,'season':2,'quality':'480p'})
                db.execute("UPDATE files SET state='copied',destination_id=101")
                page={'titleEn':'Kinnikuman: Perfect Origin Arc Season 2','titleOriginal':original,'slug':'keep-existing-url',
                      'year':2025,'type':'سریال','format':None,'postIds':[100]}
                state={'anime':{key:page},'queue':{}}
                result=apply_plan(state,db,make_plan(db,state,cache,200))
                self.assertEqual(result.get('matchedFiles',0),expected)
                self.assertEqual(page['titleOriginal'],original)
                self.assertEqual(page['slug'],'keep-existing-url')
                self.assertEqual(page['postIds'],[100])
                db.close()

    def test_city_hunter_official_numeric_title_is_not_a_pack_but_real_ranges_still_hold(self):
        r={'id':85522,'title':'City Hunter 2','name':'[AWHT] City Hunter 2 - 01 [720p].mkv',
           'caption':'[@AnimeWorldqw] City Hunter 2 - 01 [720p].mkv','episode':1,'quality':'720p'}
        self.assertTrue(safe_episode_record(r))
        for change in [{'id':85585},{'name':'[AWHT] City Hunter 2 - 01-02 [720p].mkv'},
                       {'caption':'City Hunter 2 - 02 [720p].mkv'},
                       {'name':'[AWHT] City Hunter - 75 [720p].mkv'},
                       {'multiEpisode':True},{'quality':'480p'},
                       {'name':'[AWHT] City Hunter 3 - 01 [720p].mkv'}]:
            self.assertFalse(safe_episode_record({**r,**change}),change)

    def test_reviewed_duplicate_page_choice_requires_full_primary_facts_and_keeps_both_pages(self):
        title='Berserk The Golden Age Arc ME'
        media={'id':155011,'idMal':52976,'title':{'romaji':'Berserk: Ougon Jidai-hen - MEMORIAL EDITION',
               'english':'Berserk: The Golden Age Arc - Memorial Edition'},
               'format':'TV','episodes':13,'status':'FINISHED','startDate':{'year':2022}}
        page={'titleEn':media['title']['romaji'],'titleOriginal':media['title']['romaji'],
              'year':2022,'format':'TV','declaredEpisodes':13,'metadataProviderId':155011}
        state={'anime':{'al155011':page,'legacy':{**page,'metadataProviderId':None,'declaredEpisodes':None}},'queue':{}}
        with tempfile.TemporaryDirectory() as folder:
            db=open_db(Path(folder)/'archive.sqlite3')
            store_record(db,{'id':32150,'title':title,'name':'[@AnimeWorldqw]Berserk The Golden Age Arc ME -02 [480p].mkv',
                             'episode':2,'quality':'480p'})
            db.execute("UPDATE files SET state='copied',destination_id=101")
            cache={title:{'complete':True,'media':[media]}}
            plan=make_plan(db,state,cache,200)
            self.assertEqual(plan['entries'][0]['key'],'al155011')
            self.assertEqual(set(state['anime']),{'al155011','legacy'})
            for key,field,value in [('al155011','metadataProviderId',None),('legacy','year',2023),
                                    ('legacy','format','MOVIE'),('legacy','declaredEpisodes',3)]:
                before=state['anime'][key][field];state['anime'][key][field]=value
                self.assertEqual(make_plan(db,state,cache,200)['entries'],[])
                state['anime'][key][field]=before
            db.close()
    def test_primary_id_year_total_and_cross_provider_are_all_required(self):
        for title in ['THE Great Mission','Botsuraku Yotei','The ice guy and his cool female',
                      'Jijou wo Shiranai','Ouji no Akaji Kokka Saisei','Guimi Zhi Zhu','Grendizer U Season I',
                      'Snowball Earth Ep:','Mairimashita iruma-kon S3','MEGUMI NO DAIGO','Muscleman S2',
                      'City Hunter 2','Occult Academy - S01','Berserk The Golden Age Arc ME']:
            ident,year,total,official=APPROVED_ALIASES[title]
            media={'id':ident,'idMal':APPROVED_ALIAS_MAL_IDS[title],'title':{'romaji':official},
                   'format':APPROVED_ALIAS_FORMATS.get(title,'TV'),'status':'FINISHED','episodes':total,'startDate':{'year':year}}
            record={'id':1,'title':title,'episode':2,'quality':'720p'}
            self.assertEqual(choose_identity(title,[record],[media])[0]['id'],ident)
            for changes in [{'idMal':1},{'episodes':total+1},{'startDate':{'year':year+1}},{'format':'SPECIAL'}]:
                self.assertIsNone(choose_identity(title,[record],[{**media,**changes}])[0])
            self.assertIsNone(choose_identity(title,[{**record,'id':APPROVED_ALIAS_MAX_RECORD_ID[title]+1}],[media])[0])

    def test_complete_source_templates_preserve_title_and_episode(self):
        ice={'id':37751,'title':'The ice guy and his cool female','episode':1,'quality':'480p',
             'name':'@AniPlus_Koori_Zokusei_Danshi_to_Cool_na_Douryou_Joshi_1_480p.mkv'}
        self.assertTrue(bulk_alias_filename_allowed(ice))
        self.assertTrue(bulk_alias_filename_allowed({**ice,'episode':12,'quality':'720p',
             'name':'AnimeONKooriZokuseiDanshitoCoolnaDouryouJoshi-12-720p-.mkv'}))
        for change in [{'episode':2},{'quality':'720p'},
                       {'name':'@AniPlus_Different_1_480p.mkv'},
                       {'name':'@AniPlus_Koori_Zokusei_Danshi_to_Cool_na_Douryou_Joshi2_1_480p.mkv'},
                       {'name':'@AniPlus_Koori_Zokusei_Danshi_to_Cool_na_Douryou_Joshi_1_480p_x265.mkv'}]:
            self.assertFalse(bulk_alias_filename_allowed({**ice,**change}),change)

    def test_filename_or_caption_episode_conflict_cannot_be_relaxed_by_alias(self):
        title='Jijou wo Shiranai'
        r={'id':42772,'title':title,'episode':1,'quality':'480p',
           'name':'@AniPlus_Jijou_wo_Shiranai_Tenkousei_ga_Guigui_Kuru_2_480p.mkv',
           'caption':'Jijou wo Shiranai - 01 [480p].mkv'}
        anime={'year':2023,'format':'TV','declaredEpisodes':13,'verifiedArchiveTitles':[title]}
        self.assertFalse(compatible_record(anime,r))


if __name__=='__main__':
    unittest.main()
