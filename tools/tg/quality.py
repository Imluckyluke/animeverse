"""Pure ingestion validation shared by fresh posts, cached backfills and exports."""
from html import unescape
from html.parser import HTMLParser
import re
from genres import normalize_genres

DIGITS = str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789')
SEASONS = {'spring': 'بهار', 'summer': 'تابستان', 'fall': 'پاییز', 'autumn': 'پاییز', 'winter': 'زمستان'}


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {'br', 'p', 'div'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'p', 'div'}:
            self.parts.append('\n')


def clean_synopsis(value):
    value = unescape(str(value or ''))
    if '<' in value and '>' in value:
        parser = PlainText()
        parser.feed(value)
        value = ''.join(parser.parts)
    value = unescape(value)
    value = re.sub(r'\[([^\]\n]+)\]\(https?://[^)\s]+\)', r'\1', value)
    value = re.sub(r'\(\s*(?:منبع|source)\s*:[^)\n]{0,250}\)|\[\s*Written by[^\]\n]{0,250}\]', '', value, flags=re.I)
    lines = []
    for line in value.splitlines():
        line = re.sub(r'^\s*[*`]+|[*`]+\s*$', '', line).strip()
        if re.fullmatch(r'(?:📜\s*)?خلاصه(?: داستان)?\s*[:：]?', line):
            continue
        if re.match(r'^(?:[📖📥👥🔗🏷⭐🎭]|(?:ژانرها?|فصل|نوع|تعداد قسمت|نام انگلیسی|نام فارسی|استودیو|وضعیت|زمان هر قسمت|رده سنی|منبع ساخت)\s*[:：]|(?:اطلاعات تکمیلی|اطلاعات تیم ترجمه|لینک.?های دانلود))', line):
            break
        if re.fullmatch(r'(?:https?://\S+|@[\w_]+)', line):
            continue
        lines.append(line)
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def reported_year(record):
    if any(field in record for field in ['seasonRaw', 'seasonEn']):
        for field in ['seasonEn', 'seasonRaw']:
            match = re.search(r'\b(?:19|20)[0-9]{2}\b', str(record.get(field) or '').translate(DIGITS))
            if match:
                return int(match.group())
        match = re.search(r'\b1[34][0-9]{2}\b', str(record.get('seasonRaw') or '').translate(DIGITS))
        return int(match.group()) + 621 if match else 0
    value = record.get('year')
    return value if isinstance(value, int) and not isinstance(value, bool) and 1900 <= value <= 2100 else 0


def clean_season(value):
    value = str(value or '').strip().translate(str.maketrans('يىك', 'ییک'))
    for name in ['بهار', 'تابستان', 'پاییز', 'زمستان']:
        if name in value:
            return name
    for name, translated in SEASONS.items():
        if re.search(r'\b' + name + r'\b', value, re.I):
            return translated
    return 'نامشخص'


def normalize_record(record):
    result = dict(record)
    result['year'] = reported_year(record)
    result['season'] = clean_season(record.get('season') or record.get('seasonEn') or record.get('seasonRaw'))
    result['synopsis'] = clean_synopsis(record.get('synopsis'))
    result['genres'] = normalize_genres(record.get('genres'))
    episodes = record.get('episodes')
    if isinstance(episodes, dict):
        normalized = {}
        for number, qualities in episodes.items():
            number = str(number).translate(DIGITS)
            # Preserve real episode-zero specials for the downloader. Public
            # episode-count rules remain the catalogue's responsibility.
            if not re.fullmatch(r'[0-9]+', number) or not isinstance(qualities, dict):
                continue
            bucket = normalized.setdefault(str(int(number)), {})
            for quality, link in qualities.items():
                if isinstance(link, str) and link.strip():
                    bucket.setdefault(quality, link)
        result['episodes'] = normalized
    return result
