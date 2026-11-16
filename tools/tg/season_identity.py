"""Conservative sequence markers shared by archive matching and read-only audits.

Markers are constraints, never proof of an anime's identity. In particular X,
V, Final Fantasy VII and Symphogear XV must not become inferred season numbers.
"""
import re
import unicodedata

ROMANS = dict(zip(('I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX').split(), range(1, 21)))
ROMAN_PATTERN = '|'.join(sorted(ROMANS, key=len, reverse=True))
TOKEN = re.compile(r'(?<!\w)(' + ROMAN_PATTERN + r')(?!\w)', re.I)
LABELS = {'season': 'season', 'series': 'season', 'فصل': 'season',
          'part': 'part', 'بخش': 'part', 'act': 'act', 'movie': 'movie', 'film': 'movie'}


def text(value):
    return unicodedata.normalize('NFKC', str(value or '')).replace('_', ' ')


def season_label_has_ordinal_prefix(value, position):
    """In '3rd Season 41', 3 labels the season; 41 is not a second season label."""
    return bool(re.search(r'\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|'
                          r'sixth|seventh|eighth|ninth|tenth)\s+$', value[:position], re.I))


def roman_tokens(value):
    """Include ambiguous symbols for review, excluding an unlabeled English I."""
    value = text(value)
    return [match.group(1) for match in TOKEN.finditer(value)
            if (match[1].isupper() or match[1].islower())
            and not (match[1].upper() == 'X' and re.match(r'\s*(?:264|265)(?:p|\b)', value[match.end():], re.I))
            and (match.group(1).upper() != 'I' or re.search(
                r'\b(?:season|series|part|act|movie|film)\s*[:.-]?\s*$', value[:match.start()], re.I))]


def sequence_markers(value):
    value = text(value)
    result = set()
    label_pattern = '|'.join(LABELS)
    for match in re.finditer(r'\b(' + label_pattern + r')\s*:?\s*(\d{1,2}|' + ROMAN_PATTERN + r')\b', value, re.I):
        if match[1].casefold() == 'season' and season_label_has_ordinal_prefix(value, match.start()):
            continue
        raw = match[2]
        number = int(raw) if raw.isdecimal() else ROMANS[raw.upper()]
        if 1 <= number <= 20:
            result.add((LABELS[match[1].casefold()], number))
    for match in re.finditer(r'\bs\s*0*(\d{1,2})(?=\b|e\s*\d)', value, re.I):
        if 1 <= int(match[1]) <= 20:
            result.add(('season', int(match[1])))
    for match in re.finditer(r'\b(\d{1,2})(?:st|nd|rd|th)\s+season\b', value, re.I):
        if 1 <= int(match[1]) <= 20:
            result.add(('season', int(match[1])))
    words = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
             'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10}
    for match in re.finditer(r'\b(' + '|'.join(words) + r')\s+season\b', value, re.I):
        result.add(('season', words[match[1].casefold()]))
    for match in TOKEN.finditer(value):
        number = ROMANS[match[1].upper()]
        prefix = value[:match.start()]
        # Labeled Act/Part/Movie II is not Season II. Franchise/game numbers
        # and single-letter symbols need provider-specific review instead.
        if re.search(r'\b(?:' + label_pattern + r'|OVA|OAD|special)\s*[:.-]?\s*$', prefix, re.I):
            continue
        if not (match[1].isupper() or match[1].islower()):
            continue
        if (number not in {2, 3, 4, 6, 7, 8, 9}
                or re.search(r'\b(?:Final\s+Fantasy|Tanin\s+ga)\s*$', prefix, re.I)):
            continue
        if not prefix.strip(' []()@.-'):
            continue
        result.add(('season', number))
    return result


def page_markers(anime):
    return set().union(*(sequence_markers(anime.get(field))
                         for field in ('titleEn', 'titleOriginal', 'titleMain')))


def conflicts(*groups):
    combined = set().union(*groups)
    return {kind for kind, _ in combined
            if len({number for k, number in combined if k == kind}) > 1}


def record_markers(record):
    return set().union(*(sequence_markers(record.get(field))
                         for field in ('title', 'name', 'caption')))


def ambiguous_roman_change(anime, record):
    """V/X/etc. cannot silently stand in for a differently labeled season.

    A reviewed provider alias may establish equivalence elsewhere; this function
    deliberately does not invent V=season five or X=season ten for a title.
    """
    fields = ('titleEn', 'titleOriginal', 'titleMain')
    left = {token.upper() for field in fields for token in roman_tokens(anime.get(field))}
    right = {token.upper() for field in ('title', 'name', 'caption') for token in roman_tokens(record.get(field))}
    left_markers, right_markers = page_markers(anime), record_markers(record)
    left_unknown = {token for token in left if ROMANS[token] not in {n for _, n in left_markers}}
    right_unknown = {token for token in right if ROMANS[token] not in {n for _, n in right_markers}}
    known_season = any(kind == 'season' for kind, _ in left_markers | right_markers)
    return known_season and bool((left_unknown - right) | (right_unknown - left))
