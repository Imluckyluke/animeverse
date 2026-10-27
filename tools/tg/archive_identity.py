"""Exact-provider identity plans for previously unmatched archive files.

No fuzzy title or season guessing. Provider metadata is cached independently of
the live writer. Default operation is read-only; --apply requires the writer
lock and creates backups before adding individual certified file bindings.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sqlite3
import time
import unicodedata
import urllib.request

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'}
MARKER = re.compile(r'\b(?:s\d{1,2}|season\s*\d{1,2}|part\s*\d{1,2}|\d+(?:st|nd|rd|th)\s+season)\b', re.I)
PACK = re.compile(r'(?:\b|[ _.-])(?:e(?:p)?\s*)?(\d{1,4})\s*(?:-|\+|&|to)\s*(?:e(?:p)?\s*)?(\d{1,4})\b', re.I)
SCENE_PACK = re.compile(r'\bS\d{1,2}E\d{1,4}\s*[-+&]\s*E?\d{1,4}\b', re.I)
QUERY = '''query($search:String,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
media(search:$search,type:ANIME){id idMal title{romaji english native} synonyms format episodes
season seasonYear startDate{year month day} status description(asHtml:false) genres duration
coverImage{large} studios(isMain:true){nodes{name}}}}}'''


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', str(value or '')).casefold().replace('×','x') if c.isalnum())


def safe_episode_record(record):
    number = record.get('episode')
    if isinstance(number, bool) or not isinstance(number, int) or number < 1 or 1900 <= number <= 2100:
        return False
    if Path(record.get('name') or '').suffix.lower() not in VIDEO_EXTENSIONS or not record.get('quality'):
        return False
    name, caption, title = (str(record.get(key) or '') for key in ('name','caption','title'))
    if record.get('multiEpisode') or PACK.search(name) or PACK.search(caption) or SCENE_PACK.search(name) or SCENE_PACK.search(caption):
        return False
    # Do not let a caption erase an explicit filename season or part marker.
    if set(m.group().lower().replace(' ','') for m in MARKER.finditer(name)) - set(m.group().lower().replace(' ','') for m in MARKER.finditer(title)):
        return False
    name_qualities = set(re.findall(r'\b(\d{3,4})p\b', name, re.I))
    caption_qualities = set(re.findall(r'\b(\d{3,4})p\b', caption, re.I))
    quality = re.match(r'(\d{3,4})p', str(record['quality']), re.I)
    if not quality or (name_qualities and name_qualities != {quality[1]}):
        return False
    if name_qualities and caption_qualities and name_qualities != caption_qualities:
        return False
    return True


def names(media):
    return {normalized(v) for v in [*(media.get('title') or {}).values(), *(media.get('synonyms') or [])] if v}


def remake_names(media):
    # Remove a parenthesized year ONLY to detect competing remakes. This never
    # makes an otherwise inexact title eligible for automatic acceptance.
    return {normalized(re.sub(r'\s*[\[(](?:19|20)\d{2}[\])]', '', str(v)))
            for v in (media.get('title') or {}).values() if v}


def choose_identity(title, records, media):
    exact = [m for m in media if normalized(title) in names(m)]
    if not exact:
        return None, 'no-exact-provider-title'
    years = {int(y) for r in records for y in re.findall(r'\b(?:19|20)\d{2}\b', str(r.get('name') or ''))}
    if len(years) > 1:
        return None, 'conflicting-file-years'
    possible_remakes = [m for m in media if m.get('format') in {'TV','TV_SHORT','ONA'} and normalized(title) in remake_names(m)]
    if not years and len({(m.get('startDate') or {}).get('year') for m in possible_remakes}) > 1:
        return None, 'unmarked-remake-year'
    if years:
        exact = [m for m in exact if (m.get('startDate') or {}).get('year') in years]
    # A bare title shared by two TV remakes stays ambiguous, even when the
    # current group contains more episode numbers than the older adaptation.
    serial = [m for m in exact if m.get('format') in {'TV','TV_SHORT','ONA'}]
    if len(serial) != 1:
        return None, 'ambiguous-or-nonseries-identity'
    chosen = serial[0]
    highest = max((r['episode'] for r in records), default=0)
    total = chosen.get('episodes')
    if chosen.get('status') == 'NOT_YET_RELEASED' or not isinstance(total,int) or total < highest or highest < 2:
        return None, 'episode-bound-or-unreleased'
    if any(m['id'] != chosen['id'] and isinstance(m.get('episodes'),int) and m['episodes'] >= highest for m in exact):
        return None, 'competing-exact-identity'
    return chosen, 'unique-exact-provider-identity'


def compatible_record(anime, record):
    if not safe_episode_record(record) or record['episode'] > (anime.get('declaredEpisodes') or 0):
        return False
    years = {int(y) for y in re.findall(r'\b(?:19|20)\d{2}\b', str(record.get('name') or ''))}
    return not years or years == {anime.get('year')}


def search(title):
    media = []
    for page in range(1,4):
        request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({
            'query':QUERY,'variables':{'search':title,'page':page}}).encode(),
            headers={'Content-Type':'application/json','User-Agent':'AnimeVerse-ArchiveIdentity/1.0'})
        with urllib.request.urlopen(request,timeout=30) as response:
            result = json.load(response)
        if result.get('errors'):
            raise ValueError('Provider query failed')
        data = result['data']['Page'];media.extend(data['media'])
        if not data['pageInfo']['hasNextPage']:
            return media
        time.sleep(2)
    raise ValueError('Provider results incomplete; identity cannot be certified')


def make_plan(db, state, cache, limit):
    titles = [r[0] for r in db.execute("""SELECT json_extract(record,'$.title') AS title FROM files
        WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL AND title<>''
        GROUP BY title ORDER BY count(*) DESC,title LIMIT ?""",(limit,))]
    rows = defaultdict(list)
    if titles:
        for row in db.execute("SELECT * FROM files WHERE anime_key IS NULL AND json_extract(record,'$.title') IN ("+','.join('?' for _ in titles)+')',titles):
            value=dict(row);value['parsed']=json.loads(value['record']);rows[value['parsed']['title']].append(value)
    plan, held = [], Counter()
    for title in titles:
        entry=cache.get(title) or {}
        if not entry.get('complete'):
            held['provider-unavailable']+=1;continue
        safe=[r for r in rows[title] if safe_episode_record(r['parsed'])]
        media, reason=choose_identity(title,[r['parsed'] for r in safe],entry['media'])
        if not media:
            held[reason]+=1;continue
        existing=[key for key,a in state['anime'].items() if a.get('metadataProviderId')==media['id'] or any(normalized(a.get(field)) in names(media) for field in ('titleEn','titleOriginal'))]
        if len(existing)>1:
            held['multiple-existing-pages']+=1;continue
        if existing:
            year=state['anime'][existing[0]].get('year')
            if year and year != (media.get('startDate') or {}).get('year'):
                held['existing-page-year-conflict']+=1;continue
        key=existing[0] if existing else 'al'+str(media['id'])
        binding=db.execute('SELECT anime_key,conflict FROM bindings WHERE title=?',(title,)).fetchone()
        if binding and (binding['conflict'] or binding['anime_key']!=key):
            held['existing-binding-conflict']+=1;continue
        copied=[r for r in safe if r['state']=='copied' and r['destination_id']]
        if not copied:
            held['no-safe-copied-video']+=1;continue
        plan.append({'archiveTitle':title,'key':key,'newTitle':not existing,'providerId':media['id'],
            'copiedFiles':len(copied),'pendingFiles':sum(r['state']=='pending' for r in safe),
            'heldFiles':len(rows[title])-len(safe),'fileIds':[r['id'] for r in safe],
            'metadata':media,'reason':reason})
    return {'entries':plan,'heldTitles':dict(held),'scannedTitles':len(titles)}


def apply_plan(state, db, plan):
    """Called only by the sole catalog writer or while its lock is held.

    Bind individual certified file IDs, never a broad title-string binding that
    could silently capture a future remake. Existing assignments are untouched.
    """
    from common import now_iso
    from ingest import _unique_slug
    from quality import clean_season, clean_synopsis
    from archive_pipeline import publish_record
    result = Counter()
    created = []
    for entry in plan['entries']:
        key, media = entry['key'], entry['metadata']
        if key not in state['anime']:
            title = media['title'].get('english') or media['title']['romaji']
            original = media['title'].get('romaji') or title
            state['anime'][key] = {
                'key':key,'aniplusId':'','slug':_unique_slug(state,original,key),'mediaKey':key,
                'createdAt':now_iso(),'updatedAt':now_iso(),'episodes':{},'postIds':[],
                'firstPostId':0,'lastPostId':0,'titleEn':title,'titleFa':title,
                'titleOriginal':original,'titleJa':media['title'].get('native') or '',
                'year':media['startDate']['year'],'season':clean_season(media.get('season')),
                'format':media['format'],'type':'سریال',
                'status':'پایان یافته' if media.get('status')=='FINISHED' else 'در حال پخش',
                'declaredEpisodes':media['episodes'],
                'durationRaw':str(media['duration'])+' دقیقه' if media.get('duration') else '',
                'synopsis':clean_synopsis(media.get('description') or ''),
                'genres':media.get('genres') or [],
                'studio':' / '.join(n['name'] for n in media.get('studios',{}).get('nodes',[]) if n.get('name')),
                'coverUrl':media.get('coverImage',{}).get('large') or '',
                'metadataSource':'anilist','metadataProviderId':media['id'],
                'metadataUrl':'https://anilist.co/anime/'+str(media['id']),
            }
            created.append(key)
        anime=state['anime'][key]
        for ident in entry['fileIds']:
            row=db.execute('SELECT * FROM files WHERE id=? AND anime_key IS NULL',(ident,)).fetchone()
            if row is None:
                continue
            record=json.loads(row['record'])
            if not compatible_record(anime,record):
                result['heldFiles']+=1;continue
            db.execute('UPDATE files SET anime_key=?,published=0 WHERE id=? AND anime_key IS NULL',(key,ident))
            result['matchedFiles']+=1
            if row['state']=='copied' and row['destination_id']:
                updated=dict(row);updated['anime_key']=key
                if publish_record(state,updated):result['newQualityLinks']+=1
        result['matchedArchiveTitles']+=1
    return {**dict(result),'createdKeys':created}


def reconcile_cached(state, db, limit=200):
    from common import DATA
    path=DATA/'archive-identity-cache.json'
    if not path.exists():
        return {'createdKeys':[]}
    cache=json.loads(path.read_text())
    return apply_plan(state,db,make_plan(db,state,cache,limit))


def apply_cached(limit):
    import fcntl
    import os
    import shutil
    from concurrent.futures import ThreadPoolExecutor
    from common import DATA, ROOT, STATE_PATH, atomic_write_json, load_state, now_iso, save_state
    from catalog import build_catalog, write_catalog
    from media import ensure_cover
    from sync import acquire_lock, release_lock
    from archive_pipeline import open_db
    os.umask(0o077)
    with (DATA/'archive-pipeline.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not acquire_lock('archive-identity',0):
            raise SystemExit('Stop the live catalog writer before applying identity matches')
        db=None
        try:
            backup=DATA/'backups'/('archive-identity-'+str(time.time_ns()))
            backup.mkdir(parents=True,mode=0o700)
            for path in [STATE_PATH,ROOT/'src/lib/real-catalog.json',DATA/'aniplus-links.json']:
                if path.exists():shutil.copy2(path,backup/path.name)
            db=open_db()
            with sqlite3.connect(backup/'pipeline.sqlite3') as destination:db.backup(destination)
            state=load_state();before=build_catalog(state)
            original_queue=set(state.get('queue',{}))
            cache=json.loads((DATA/'archive-identity-cache.json').read_text())
            plan=make_plan(db,state,cache,limit)
            with db:
                result=apply_plan(state,db,plan)
                def cover(key):
                    anime=state['anime'][key]
                    assets=ensure_cover(anime['mediaKey'],anime.get('coverUrl') or '')
                    if assets:
                        anime['cover'],anime['banner']=assets
                        anime['coverSource']=anime['coverUrl']
                    return bool(assets)
                with ThreadPoolExecutor(max_workers=3) as pool:
                    result['localCoversPrepared']=sum(pool.map(cover,result['createdKeys']))
                assert original_queue <= set(state.get('queue',{})), 'Existing archive queue identities changed'
                save_state(state)
                after,_=write_catalog(state)
            count=lambda rows: {'titles':len(rows),'episodes':sum(len(r['episodeData']) for r in rows),
                'qualityOptions':sum(len(e['qualities']) for r in rows for e in r['episodeData'])}
            before_count,after_count=count(before),count(after)
            report={'updatedAt':now_iso(),**result,'before':before_count,'after':after_count,
                'delta':{key:after_count[key]-before_count[key] for key in before_count},
                'heldTitles':plan['heldTitles'],'newSlugs':[state['anime'][key]['slug'] for key in result['createdKeys']],
                'backup':str(backup),'publicDeploymentVerified':False}
            atomic_write_json(DATA/'archive-identity-applied.json',report)
            print('ARCHIVE_IDENTITIES_APPLIED',json.dumps(report,ensure_ascii=False),flush=True)
        finally:
            if db:db.close()
            release_lock('archive-identity')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit',type=int,default=40)
    parser.add_argument('--cached-only',action='store_true')
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if args.apply:
        if not args.cached_only:
            parser.error('--apply requires --cached-only; fetch metadata before stopping the writer')
        apply_cached(max(1,min(args.limit,200)))
        return
    from common import DATA, atomic_write_json, load_state, now_iso
    cache_path=DATA/'archive-identity-cache.json'
    cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
    db=sqlite3.connect('file:'+str(DATA/'archive-pipeline.sqlite3')+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    titles=[r[0] for r in db.execute("""SELECT json_extract(record,'$.title') AS title FROM files
        WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL AND title<>''
        GROUP BY title ORDER BY count(*) DESC,title LIMIT ?""",(max(1,min(args.limit,200)),))]
    if not args.cached_only:
        for title in titles:
            if cache.get(title,{}).get('complete'):
                continue
            try:
                cache[title]={'media':search(title),'complete':True,'checkedAt':now_iso()}
                print('IDENTITY_METADATA_CHECKED',title,flush=True)
            except Exception as error:
                cache[title]={'complete':False,'error':type(error).__name__,'checkedAt':now_iso()}
                print('IDENTITY_METADATA_DEFERRED',title,type(error).__name__,flush=True)
                atomic_write_json(cache_path,cache)
                if getattr(error,'code',None)==429:break
            atomic_write_json(cache_path,cache)
            time.sleep(2)
    plan=make_plan(db,load_state(),cache,args.limit);db.close()
    plan['updatedAt']=now_iso()
    atomic_write_json(DATA/'archive-identity-plan.json',plan)
    summary={**plan,'entries':[{k:v for k,v in entry.items() if k not in {'metadata','fileIds'}} for entry in plan['entries']]}
    print('IDENTITY_PLAN',json.dumps(summary,ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
