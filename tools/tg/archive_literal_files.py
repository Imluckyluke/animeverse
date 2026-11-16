"""Individually reviewed literal filenames with explicit numbering certificates.

These three IDs are Lost Girls parts 1–3 / overall Attack on Titan OADs 6–8,
not episodes 6–8 of the separate three-episode Lost Girls provider identity.
No general fractional-episode, Part-number or OVA-number rewrite is allowed.

Nine exact Baccano files use overall episodes 14–16 for Bangai-hen 1–3.
The official https://www.baccano.jp/release/dvd.html lists these three DVD-only
episodes as 番外編・上 / 中 / 下 on DVDs 5 / 7 / 8, released in 2008.
"""
import re

LOST_GIRLS_TITLE = 'Shingeki no Kyojin: LOST GIRLS'
LOST_GIRLS = {
    2210: (6, '16.5A', 1),
    2211: (7, '16.5B', 2),
    2212: (8, '16.5C', 3),
}


def lost_girls_filename(record):
    values = LOST_GIRLS.get(record.get('id'))
    if not values:
        return None
    ova, code, part = values
    bare = f'OVA {ova:02} - {code} - Lost Girls Part {part:02} [576p].mkv'
    if record.get('name') != '[MrAnime.pw] ' + bare or record.get('caption') not in (None, '', bare, '[MrAnime.pw] ' + bare):
        return None
    return {'title': LOST_GIRLS_TITLE, 'episode': part, 'season': None, 'part': None,
            'quality': '576p', 'x265': False, 'hardsub': False,
            'sourceNumberingEvidence': {'providerId': 99634, 'overallOad': ova,
                                        'legacyEpisodeLabel': code, 'lostGirlsPart': part}}


def certified_lost_girls(record, total, provider):
    literal = lost_girls_filename(record)
    return bool(literal and all(record.get(key) == value for key, value in literal.items())
                and not record.get('multiEpisode') and total == 3
                and provider.get('id') == 99634 and provider.get('idMal') == 36106
                and provider.get('format') == 'OVA' and provider.get('episodes') == 3
                and provider.get('status') == 'FINISHED'
                and (provider.get('startDate') or {}).get('year') == 2017)


BACCANO_SPECIAL_TITLE = 'Baccano! Bangai-hen'
BACCANO_SPECIAL_FILES = {
    68033: (14, '480p', 66950182),
    68034: (15, '480p', 62270029),
    68035: (16, '480p', 81200630),
    68050: (14, '720p', 97437143),
    68051: (15, '720p', 85349622),
    68052: (16, '720p', 116458847),
    68067: (14, '1080p', 171253436),
    68068: (15, '1080p', 131404305),
    68069: (16, '1080p', 186179464),
}


def baccano_special_filename(record):
    value = BACCANO_SPECIAL_FILES.get(record.get('id'))
    if not value:
        return None
    overall, quality, size = value
    if (record.get('name') != f'[AWHT] Baccano - {overall} [{quality}].mkv'
            or record.get('caption') != f'[@AnimeWorldqw] Baccano! - {overall} [{quality}]'
            or record.get('size') != size or record.get('quality') != quality
            or record.get('multiEpisode') or record.get('x265') or record.get('hardsub')
            or record.get('season') is not None or record.get('part') is not None):
        return None
    return {'title': BACCANO_SPECIAL_TITLE, 'norm': 'baccano bangai hen', 'episode': overall - 13, 'season': None,
            'part': None, 'quality': quality, 'x265': False, 'hardsub': False,
            'sourceNumberingEvidence': {'providerId': 3901, 'overallEpisode': overall,
                'specialEpisode': overall - 13, 'basis': 'official-baccano-dvd-5-7-8'}}


def certified_baccano_special(record, total, provider):
    literal = baccano_special_filename(record)
    return bool(literal and all(record.get(key) == value for key, value in literal.items())
                and total == 3 and provider.get('id') == 3901 and provider.get('idMal') == 3901
                and provider.get('format') == 'SPECIAL' and provider.get('episodes') == 3
                and provider.get('status') == 'FINISHED'
                and (provider.get('startDate') or {}).get('year') == 2008)


STEINS_ZERO_EPISODES = {3477: 5, 3479: 7, 3480: 8, 3481: 9, 3482: 10, 3483: 11,
    3484: 12, 3485: 13, 3486: 14, 3487: 15, 3489: 17, 3490: 18, 3491: 19,
    3492: 20, 3493: 21, 3494: 22, 3495: 23}
LITERAL_TV_TITLES = {'Steins Gate 0', 'Free Eternal Summer S2'}


def reviewed_tv_filename(record):
    """Closed cohorts with episode/quality labels agreeing in BOTH sources.

    Numeric resolutions come from explicit source labels, never file size.
    This does not suppress the ordinary episode, quality, pack or year guards.
    """
    ident = record.get('id')
    if type(ident) is not int or record.get('multiEpisode') or record.get('x265') or record.get('hardsub'):
        return None
    episode = STEINS_ZERO_EPISODES.get(ident)
    if episode:
        name = re.fullmatch(r'\[AnimWorldHT\] (Steins Gate 0\s*-\s*(\d{2})\s*-\s*\[720\]\.mkv)',
                            record.get('name') or '', re.I)
        if not name or int(name[2]) != episode or record.get('caption') != name[1]:
            return None
        title, quality, season, provider = 'Steins Gate 0', '720p', None, 21127
    else:
        group = next(((base, quality) for base, quality in [(16564,480),(16578,720),(16592,1080)]
                      if base <= ident <= base + 12), None)
        if group is None:
            return None
        base, height = group
        episode = ident - base + 1
        if (record.get('name') != f'[@AnimeSoftsub]-Free-[s2-{episode:02}][{height}].mkv'
                or record.get('caption') != f'[@AnimeWorldqw]Free Eternal Summer-[s2-{episode:02}]-[{height}p].mkv'):
            return None
        title, quality, season, provider = 'Free Eternal Summer S2', f'{height}p', 2, 20614
    if record.get('quality') != quality or record.get('part') is not None:
        return None
    return {'title': title, 'norm': 'steins gate 0' if provider == 21127 else 'free eternal summer s2',
            'episode': episode, 'quality': quality, 'season': season, 'part': None,
            'x265': False, 'hardsub': False,
            'filenameIdentityEvidence': {'providerId': provider, 'basis': 'closed-dual-source-episode-template'}}


def reviewed_tv_candidate(record):
    parsed = reviewed_tv_filename(record)
    if not parsed:
        return None
    allowed = {'Free Eternal Summer', 'Free Eternal Summer S2'} if parsed['season'] == 2 else {'Steins Gate 0'}
    if record.get('id') == 3489:
        allowed.add('Steins Gate 0 -17')
    if (record.get('title') not in allowed
            or any(record.get(key) is not None and record[key] != parsed[key] for key in ('episode','season','part'))):
        return None
    return {**record, **parsed}
