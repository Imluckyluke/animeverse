"""Durable public catalogue overlays; canonical source/history stays untouched."""
from copy import deepcopy
from contextlib import closing
import json
from pathlib import Path
import sqlite3

PUBLIC_FIELDS = {'title', 'titleEn', 'titleJa', 'year', 'studio', 'synopsis', 'genres', 'cover', 'banner', 'hidden', 'pinned', 'editorScore'}


def read_overrides(root):
    path = Path(root) / 'data/admin.sqlite3'
    if not path.exists():
        return {}
    # An unreadable existing store must fail closed, not reveal hidden titles.
    with closing(sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True, timeout=10)) as database:
        database.row_factory = sqlite3.Row
        if not database.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='overrides'").fetchone():
            return {}
        result = {}
        for row in database.execute('SELECT * FROM overrides'):
            item = dict(row)
            raw = item.get('patch') or item.get('patch_json') or '{}'
            result[item['slug']] = {'patch': json.loads(raw), 'revision': item['revision'],
                                    'updatedAt': item.get('updated_at') or item.get('updatedAt') or ''}
        return result


def apply_overrides(rows, overrides):
    result = []
    pin_order = {}
    for original in rows:
        entry = overrides.get(original['slug'], {})
        patch = entry.get('patch') or {}
        if patch.get('hidden'):
            continue
        row = deepcopy(original)
        for field in PUBLIC_FIELDS - {'hidden', 'pinned', 'editorScore'}:
            if field in patch and patch[field] is not None:
                row[field] = patch[field]
        if 'synopsis' in patch:
            row['tagline'] = str(row.get('synopsis') or '').split('\n')[0][:130]
        score = patch.get('editorScore')
        if isinstance(score, (int, float)) and not isinstance(score, bool) and 0 <= score <= 10:
            row['score'], row['scoreSource'] = score, 'admin'
            row.pop('scoreReportedVia', None)
        hidden = patch.get('episodeHidden') or {}
        if hidden:
            episodes = []
            for episode in row.get('episodeData', []):
                qualities = [quality for quality in episode['qualities']
                             if not hidden.get(str(episode['number']) + '|' + quality['label'])]
                if qualities:
                    episodes.append({**episode, 'qualities': qualities})
            if not episodes:
                continue
            row['episodeData'] = episodes
            row['readyCount'] = row['availableEpisodes'] = row['indexedCount'] = len(episodes)
            row['highestEpisode'] = max(episode['number'] for episode in episodes)
            row['quality'] = list(dict.fromkeys(quality['label'] for episode in episodes for quality in episode['qualities']))
        if patch.get('pinned'):
            row['featured'] = True
            pin_order[row['slug']] = entry.get('updatedAt') or ''
        result.append(row)
    # Stable order for untouched titles; latest deliberate pin comes first.
    result.sort(key=lambda row: (row['slug'] in pin_order, pin_order.get(row['slug'], '')), reverse=True)
    for row in result:
        row.pop('rank', None)
    ranked = sorted((row for row in result if row.get('scoreSource') in {'mal', 'aniplus'}),
                    key=lambda row: row.get('score') or 0, reverse=True)[:10]
    for index, row in enumerate(ranked, 1):
        row['rank'] = index
    return result


def public_overrides(overrides):
    return {'version': 1, 'enabled': True, 'overrides': {
        slug: {'revision': entry['revision'], 'patch': {key: value for key, value in entry['patch'].items() if key in PUBLIC_FIELDS}}
        for slug, entry in overrides.items()}}
