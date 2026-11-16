"""Collect provider sequel edges for explicit S1 names; never assign files."""
import json
import re
import sqlite3
import time
import urllib.request

from archive_identity import entry_media, explicit_markers, names, normalized, search
from common import DATA, atomic_write_json, now_iso

QUERY = '''query($id:Int){Media(id:$id,type:ANIME){id title{romaji english native} synonyms
format episodes status startDate{year} relations{edges{relationType node{id title{romaji english native}
synonyms format episodes startDate{year}}}}}}'''


def main():
    cache = json.loads((DATA / 'archive-identity-cache.json').read_text())
    pool = {media['id']: media for entry in cache.values() for media in entry_media(entry)}
    database = sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True)
    titles = [row[0] for row in database.execute("""SELECT json_extract(record,'$.title') AS title
        FROM files WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL
        GROUP BY title ORDER BY count(*) DESC""")]
    database.close()
    proposals = []
    path = DATA / 'archive-first-season-evidence.json'
    for title in titles:
        if explicit_markers(title) != {('season', 1)}:
            continue
        base = re.sub(r'\bs\s*0*1\b|\bseason\s*0*1\b', '', title, flags=re.I).strip(' -:')
        candidates = [media for media in pool.values() if normalized(base) in names(media)
                      and media.get('format') == 'TV']
        if not candidates:
            try:
                found = search(base)
                candidates = [media for media in found if normalized(base) in names(media)
                              and media.get('format') == 'TV']
            except Exception as error:
                print('FIRST_SEASON_BASE_DEFERRED', title, type(error).__name__, flush=True)
                if getattr(error, 'code', None) == 429:
                    break
            time.sleep(8)
        if len(candidates) != 1:
            continue
        provider = candidates[0]
        request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({
            'query': QUERY, 'variables': {'id': provider['id']}}).encode(),
            headers={'Content-Type': 'application/json', 'User-Agent': 'AnimeVerse-ArchiveIdentity/1.0'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
            if result.get('errors'):
                raise ValueError('Incomplete reference graph')
            media = result['data']['Media']
            explicit_second = []
            for edge in media['relations']['edges']:
                node = edge['node']
                values = [*(node.get('title') or {}).values(), *node.get('synonyms', [])]
                if edge['relationType'] == 'SEQUEL' and node.get('format') == 'TV' and any(
                    ('season', 2) in explicit_markers(value) for value in values if value):
                    explicit_second.append(node)
            proposals.append({'archiveTitle': title, 'base': base, 'provider': media,
                              'explicitSecondSeasonSequels': explicit_second, 'checkedAt': now_iso()})
            atomic_write_json(path, {'proposals': proposals, 'updatedAt': now_iso()})
            print('FIRST_SEASON_GRAPH_CHECKED', title, provider['id'], len(explicit_second), flush=True)
        except Exception as error:
            print('FIRST_SEASON_GRAPH_DEFERRED', title, type(error).__name__, flush=True)
            if getattr(error, 'code', None) == 429:
                break
        time.sleep(8)
    print('FIRST_SEASON_GRAPH_RUN_FINISHED', flush=True)


if __name__ == '__main__':
    main()
