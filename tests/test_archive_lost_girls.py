"""Only the three certified literal OAD filenames use Lost Girls part numbers."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'/'tg'))
from archive_literal_files import LOST_GIRLS, LOST_GIRLS_TITLE, lost_girls_filename
from archive_identity import safe_special_record, compatible_record


class LostGirlsTests(unittest.TestCase):
    def setUp(self):
        self.provider={'id':99634,'idMal':36106,'format':'OVA','episodes':3,'status':'FINISHED',
                       'startDate':{'year':2017},'title':{'romaji':LOST_GIRLS_TITLE}}

    def source(self,ident):
        ova,code,part=LOST_GIRLS[ident]
        bare=f'OVA {ova:02} - {code} - Lost Girls Part {part:02} [576p].mkv'
        r={'id':ident,'name':'[MrAnime.pw] '+bare,'caption':bare}
        return {**r,**lost_girls_filename(r)}

    def test_all_three_explicit_parts_are_separate_from_overall_oad_numbers(self):
        anime={'metadataProviderId':99634,'format':'OVA','declaredEpisodes':3,'year':2017,
               'verifiedArchiveTitles':[LOST_GIRLS_TITLE],'archiveSpecialReference':self.provider}
        for ident,(ova,code,part) in LOST_GIRLS.items():
            record=self.source(ident)
            self.assertEqual(record['episode'],part)
            self.assertEqual(record['sourceNumberingEvidence']['overallOad'],ova)
            self.assertTrue(safe_special_record(record,3,self.provider))
            self.assertTrue(compatible_record(anime,record))
            self.assertFalse(compatible_record({**anime,'format':'TV'},record))
            self.assertFalse(safe_special_record({**record,'episode':ova},3,self.provider))

    def test_future_ids_other_files_and_contradictory_captions_remain_held(self):
        r=self.source(2212)
        for changes in [{'id':999999},{'quality':'720p'},{'episode':8},{'part':3},
                        {'multiEpisode':True},{'caption':'Unrelated OVA - 03 [576p].mkv'},
                        {'name':r['name'].replace('16.5C','16.5B')}]:
            self.assertFalse(safe_special_record({**r,**changes},3,self.provider),changes)
        for changes in [{'id':123},{'idMal':123},{'episodes':8},{'format':'TV'},
                        {'status':'NOT_YET_RELEASED'},{'startDate':{'year':2018}}]:
            self.assertFalse(safe_special_record(r,3,{**self.provider,**changes}))


if __name__=='__main__':
    unittest.main()
