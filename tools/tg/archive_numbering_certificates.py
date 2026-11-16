"""Closed, independently researched release-numbering certificates.

Stone Ocean official story pages number 1–38. AniList 131942 covers 1–12;
fresh primary node 146722 covers the remaining 26 as one entry. MAL instead
splits those 26 into 51367 (12) and 53273 (14). Never silently equate their
episode totals or apply this offset to another JoJo part or later archive ID.
"""
import re

STONE_OCEAN_TITLE = 'JoJo no Kimyou na Bouken: Stone Ocean Part 2'
STONE_OCEAN_IDS = {
    32744,32745,32746,32747,32748,32749,32750,32751,32752,32753,32754,32755,
    32757,32758,32759,32760,32761,32762,32763,32764,32765,32766,32767,32768,
    32770,32771,32772,32773,32774,32775,32776,32777,32778,32779,32780,32781,
    36833,36834,36835,36836,36837,36838,36839,36840,36841,36842,36843,36844,
    36845,36846,36848,36849,36850,36851,36852,36853,36854,36855,36856,36857,
    36858,36859,36860,36861,36863,36864,36865,36866,36867,36868,36869,36870,
    36871,36872,36873,36874,36875,36876,
}


def stone_ocean_candidate(record):
    if record.get('title') == STONE_OCEAN_TITLE:
        source = (record.get('sourceNumberingEvidence') or {}).get('originalRecord')
        if not isinstance(source, dict):
            return None
    else:
        source = record
    ident = source.get('id')
    if (type(ident) is not int or ident not in STONE_OCEAN_IDS
            or source.get('title') != 'JoJo Bizarre Adventure Part six'
            or source.get('multiEpisode') or source.get('x265') or source.get('hardsub')
            or source.get('season') is not None or source.get('part') is not None):
        return None
    name = re.fullmatch(r"(?:\[@AnimeWorldqw\]\s+JoJo Bizarre Adventure Part six|\[AWHT\]\s+JoJo's Bizarre Adventure Part Six)"
                        r'\s*-\s*(\d{2})\s*\[(480|720|1080)p\]\.mkv', source.get('name') or '', re.I)
    caption = re.fullmatch(r'\[@AnimeWorldqw\]\s+JoJo Bizarre Adventure Part six\s*-\s*(\d{2})\s*\[(480|720|1080)p\]\.mkv',
                          source.get('caption') or '', re.I)
    if not name or not caption or name.groups() != caption.groups():
        return None
    overall, height = map(int, name.groups())
    if (not 13 <= overall <= 38 or source.get('episode') != overall
            or source.get('quality') != f'{height}p' or record.get('id') != ident):
        return None
    return {**source, 'title': STONE_OCEAN_TITLE,
        'norm': 'jojo no kimyou na bouken stone ocean part 2',
        'episode': overall - 12, 'part': 2,
        'sourceNumberingEvidence': {'basis': 'official-stone-ocean-13-38-anilist-merged-26',
            'providerId': 146722, 'providerEpisodes': 26, 'overallEpisode': overall,
            'providerEpisode': overall - 12, 'storyPart': 6,
            'malId': 51367 if overall <= 24 else 53273,
            'malEpisode': overall - (12 if overall <= 24 else 24),
            'malEpisodes': 12 if overall <= 24 else 14, 'originalRecord': source}}


def certified_stone_ocean_source(record):
    if record.get('title') != STONE_OCEAN_TITLE:
        return None
    expected = stone_ocean_candidate(record)
    if not expected or {key:value for key,value in record.items() if key != 'archiveRecovery'} != expected:
        return None
    source = expected['sourceNumberingEvidence']['originalRecord']
    recovery = record.get('archiveRecovery')
    if recovery is not None and (not isinstance(recovery,dict) or recovery.get('originalRecord') != source):
        return None
    return source


# These are closed source-ID/overall-episode rosters, not inferred season rules.
SPLIT_ROSTERS = {
    'Attack On Titan Season 3': {base+offset:offset+1 for base in (3211,3234,3257) for offset in range(22)},
    'Bungou Stray Dogs': {base+offset:first+offset for base,first in (
        (10275,1),(10288,1),(10301,1),(10314,13),(10327,13),(10340,13),
        (10353,26),(10366,26),(10379,26)) for offset in range(12)},
    '86 - Eighty Six': dict(zip(
        [9194,9195,9196,10022,10023,10024,10025,10026,10027,10502,10503,10504,
         11199,11200,11201,11933,11934,11935,
         12333,12334,12335,12336,12337,12338,12339,12340,12341,12342,12343,
         12345,12346,12347,12348,12349,12350,12351,12352,12353,12354,12355,
         12357,12358,12359,12360,12361,12362,12363,12364,12365,12366,12367,
         12455,12456,12457,13986,13987,13988],
        [*(episode for episode in range(12,18) for _ in range(3)),
         *range(1,12),*range(1,12),*range(1,12),18,18,18,19,19,19], strict=True)),
    'Food Wars! S3': dict(zip(
        [8587,8588,8589,8590,8591,8592,8593,8594,8595,8596,8597,8598,
         8600,8601,8602,8603,8604,8605,8606,8607,8608,8609,8610,8611,
         8613,8614,8615,8616,8617,8618,8619,8620,8621,8622,8623,8624,
         8683,8684,8685,8686,8687,8688,8689,8690,8691,8692,8693,8694,
         8696,8697,8698,8699,8700,8701,8702,8703,8704,8705,8706,8707,
         8709,8710,8711,8712,8713,8714,8715,8716,8717,8718,8719,8720],
        [*range(1,13),1,2,3,4,5,6,7,8,9,11,10,12,*range(1,13),
         *range(13,25),13,14,15,16,17,19,18,20,21,22,23,24,
         13,14,15,16,17,18,19,20,23,21,22,24], strict=True)),
    'Mushoku Tensei': dict(zip(
        [9138,9139,9140,9141,9142,9143,9144,9145,9146,9147,9148,
         9150,9151,9152,9153,9154,9155,9156,9157,9158,9159,9160,
         9162,9163,9164,9165,9166,9167,9168,9169,9170,9171,9172,
         9173,9174,9175,9521,9522,9523,10190,10191,10192,10508,10509,10510,
         11190,11191,11192,11879,11880,11881,12239,12240,12241,12452,12453,12454,
         13745,13746,13747,13989,13990,13991,14177,14178,14179,14219,14220,14221],
        [*range(1,12),*range(1,12),*range(1,12),
         *(episode for episode in range(12,24) for _ in range(3))], strict=True)),
    'Vanitas no Carte': dict(zip(
        [3044,3045,3046,3047,3048,3049,3126,3127,3128,3514,3515,3516,3548,3549,3550,
         3959,3960,3961,6506,6507,6508,6509,6510,6511,6512,6513,6514,7043,7044,7045,
         7897,7898,7899,7987,7988,7989,14870,14871,14872,15186,15187,15188,
         15540,15541,15542,16009,16010,16011,16189,16190,16191,16458,16459,16460,
         17044,17045,17046,17332,17333,17334,19457,19458,19459,21001,21002,21003,
         21350,21351,21352,21764,21765,21766],
        [episode for episode in range(1,25) for _ in range(3)], strict=True)),
}
# title, primary ID, MAL ID, year, total, overall first, overall last, part
SPLIT_TARGETS = {
    'Attack On Titan Season 3': (
        ('Shingeki no Kyojin Season 3',99147,35760,2018,12,1,12,None),
        ('Shingeki no Kyojin Season 3 Part 2',104578,38524,2019,10,13,22,2)),
    'Bungou Stray Dogs': (
        ('Bungo Stray Dogs',21311,31478,2016,12,1,12,None),
        ('Bungou Stray Dogs 2nd Season',21679,32867,2016,12,13,24,None),
        ('Bungou Stray Dogs 3rd Season',103223,38003,2019,12,26,37,None)),
    '86 - Eighty Six': (
        ('86: Eighty Six',116589,41457,2021,11,1,11,None),
        ('86: Eighty Six Part 2',131586,48569,2021,12,12,23,2)),
    'Food Wars! S3': (
        ('Shokugeki no Souma: San no Sara',99255,35788,2017,12,1,12,None),
        ('Shokugeki no Souma: San no Sara - Tootsuki Ressha-hen',100773,36949,2018,12,13,24,None)),
    'Mushoku Tensei': (
        ('Mushoku Tensei: Isekai Ittara Honki Dasu',108465,39535,2021,11,1,11,None),
        ('Mushoku Tensei: Isekai Ittara Honki Dasu Part 2',127720,45576,2021,12,12,23,2)),
    'Vanitas no Carte': (
        ('The Case Study of Vanitas',131646,48580,2021,12,1,12,None),
        ('Vanitas no Carte Part 2',135136,49114,2022,12,13,24,2)),
}
SPLIT_TITLES = {target[0] for targets in SPLIT_TARGETS.values() for target in targets}


def split_cour_candidate(record):
    if record.get('title') in SPLIT_TITLES:
        proof = record.get('sourceNumberingEvidence')
        source = proof.get('originalRecord') if isinstance(proof, dict) else None
        if not isinstance(source, dict):
            return None
    else:
        source = record
    label, ident = source.get('title'), source.get('id')
    roster = SPLIT_ROSTERS.get(label, {})
    if (type(ident) is not int or ident not in roster or record.get('id') != ident
            or source.get('episode') != roster[ident] or type(source.get('episode')) is not int
            or source.get('season') != (3 if label in {'Food Wars! S3','Attack On Titan Season 3'} else None)
            or source.get('part') is not None or any(source.get(key) for key in ('multiEpisode','x265','hardsub'))):
        return None
    # Strip only these literal uploader prefixes; no fuzzy title normalization.
    name = re.sub(r'^(?:\[AWHT\]|\[@AnimeWorldqw\])\s*', '', source.get('name') or '')
    caption = re.sub(r'^\[@AnimeWorldqw\]\s*', '', source.get('caption') or '')
    pattern = re.escape(label) + r'\s*(?:-\s*|_)?(\d{2})\s*(?:\[(480|720|1080)p?\]|\((480|720|1080)p?\))\.mkv'
    def labels(text):
        match = re.fullmatch(pattern, text, re.I)
        return (int(match[1]), int(match[2] or match[3])) if match else None
    observed = labels(name)
    quality = re.fullmatch(r'(480|720|1080)p', str(source.get('quality') or ''))
    if not observed or not quality or observed != (roster[ident], int(quality[1])):
        return None
    if label == 'Vanitas no Carte' and ident in {15186,15187,15188} and caption == '':
        caption_basis = 'explicit-filename-no-caption'
    elif label == 'Vanitas no Carte' and ident in {15540,15541,15542}:
        match = re.fullmatch(r'Vanitas no Carte\nقسمت: (\d{2})\nکیفیت: (480|720|1080)p\u200c?', caption)
        if not match or tuple(map(int,match.groups())) != observed:
            return None
        caption_basis = 'explicit-persian-caption'
    elif labels(caption) == observed:
        caption_basis = 'dual-source-labels'
    else:
        return None
    target = next((item for item in SPLIT_TARGETS[label] if item[5] <= observed[0] <= item[6]), None)
    if not target:
        return None
    title, primary, mal, year, total, first, last, part = target
    return {**source, 'title':title, 'norm':re.sub(r'[^a-z0-9]+',' ',title.lower()).strip(),
            'episode':observed[0]-first+1, 'season':None, 'part':part,
            'sourceNumberingEvidence': {'basis':'closed-reviewed-split-cour', 'captionBasis':caption_basis,
                'providerId':primary,'malId':mal,'year':year,'format':'TV','providerEpisodes':total,
                'overallEpisode':observed[0],'providerEpisode':observed[0]-first+1,
                'sourceSeason':source.get('season'),'originalRecord':source}}


def certified_split_cour_source(record):
    if record.get('title') not in SPLIT_TITLES:
        return None
    expected = split_cour_candidate(record)
    if not expected or {key:value for key,value in record.items() if key != 'archiveRecovery'} != expected:
        return None
    source = expected['sourceNumberingEvidence']['originalRecord']
    recovery = record.get('archiveRecovery')
    if recovery is not None and (not isinstance(recovery,dict) or recovery.get('originalRecord') != source):
        return None
    return source
