"""Account for every copied unmatched file without changing archive assignments.

The private scope retains resolved IDs across runs and includes newly copied
unmatched files. Reports distinguish reference work still pending from a
reviewed hold. A hold is not a certified identity or a published download.
"""
import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
from pathlib import Path
import sqlite3

from archive_identity import (
    APPROVED_ALIASES, canonical_query, choose_identity, compatible_record, entry_media, explicit_markers, existing_identities,
    reference_lookup, reference_candidates, identity_cohorts,
    identity_names, names, normalized, safe_episode_record, safe_movie_record, safe_special_record, SPECIAL_FORMATS, VIDEO_EXTENSIONS,
)

LABELS = {
    'matched': 'اتصال در دیتابیس ثبت شده؛ انتشار عمومی جداگانه بررسی می‌شود',
    'missing_destination': 'نسخهٔ مقصد ثبت نشده',
    'not_video': 'پسوند فایل ویدیویی پشتیبانی نمی‌شود',
    'missing_title': 'عنوان از فایل استخراج نشده',
    'missing_episode': 'شمارهٔ قسمت معتبر استخراج نشده',
    'missing_quality': 'کیفیت معتبر استخراج نشده',
    'season_conflict': 'فصل یا بخش نام فایل با عنوان استخراج‌شده ناسازگار است',
    'unsafe_record': 'پارس نام فایل امن نیست: بستهٔ چندقسمتی، کیفیت ناسازگار یا برچسب مبهم',
    'binding_conflict': 'اتصال قبلی عنوان دارای تعارض است؛ بازنویسی نشد',
    'reference_pending': 'پاسخ کامل مرجع هنوز دریافت نشده؛ بررسی هویت تمام نشده',
    'no_reference_match': 'عنوان هم‌ارز تأییدشده در پاسخ مرجع پیدا نشد',
    'ambiguous_remake': 'سال نسخه یا بازسازی از فایل مشخص نیست',
    'ambiguous_identity': 'چند هویت مرجع ممکن است؛ انتخاب قطعی نیست',
    'unsupported_format': 'مرجع منحصربه‌فرد سریالی نیست؛ فیلم یا ویژه نیازمند بررسی جداست',
    'episode_out_of_bounds': 'شمارهٔ قسمت بالاتر از تعداد اعلام‌شدهٔ مرجع است',
    'mixed_numbering': 'شماره‌گذاری گروه با مرجع سازگار نیست؛ فصل یا نیم‌فصل باید تفکیک شود',
    'numbering_version_review': 'نسخهٔ کوتاه، تدوین دوباره یا حذف مرورها باید برای هر فایل مشخص شود؛ کران شمارهٔ قسمت کافی نیست',
    'alias_cohort_review': 'فایل خارج از محدودهٔ بررسی نام مستعار است و به تأیید تازه نیاز دارد',
    'reference_not_ready': 'تعداد قسمت یا وضعیت انتشار مرجع برای اتصال قطعی کافی نیست',
    'catalog_conflict': 'عنوان یا سال یا قالب صفحهٔ موجود با مرجع ناسازگار است',
    'ready_to_bind': 'هویت و فایل تأیید شده؛ منتظر اعمال توسط نویسندهٔ آرشیو',
    'apply_guard_hold': 'هویت گروه یافت شد اما محافظ انتشار این فایل را نپذیرفت',
    'scope_missing': 'شناسهٔ دامنه در دیتابیس پیدا نشد؛ نیازمند بررسی',
}


def record_problem(row, record, single_movie=False, special=None):
    if row.get('anime_key'):
        return 'matched'
    if not row.get('destination_id'):
        return 'missing_destination'
    if Path(record.get('name') or '').suffix.lower() not in VIDEO_EXTENSIONS:
        return 'not_video'
    if not record.get('title'):
        return 'missing_title'
    episode = record.get('episode')
    if not (single_movie or special and special.get('episodes') == 1) and (isinstance(episode, bool) or not isinstance(episode, int) or episode < 1 or 1900 <= episode <= 2100):
        return 'missing_episode'
    if not record.get('quality'):
        return 'missing_quality'
    if explicit_markers(str(record.get('name') or '') + ' ' + str(record.get('caption') or '')) - explicit_markers(record['title']):
        return 'season_conflict'
    if not (safe_special_record(record, special.get('episodes'), special) if special
            else safe_movie_record(record) if single_movie else safe_episode_record(record)):
        return 'unsafe_record'
    return None


def identity_problem(reason, media, record, candidates):
    if media:
        return None
    if reason == 'unmarked-remake-year' or reason == 'conflicting-file-years':
        return 'ambiguous_remake'
    if reason in {'no-exact-provider-title', 'approved-alias-evidence-or-episode-bound-failed'}:
        return 'no_reference_match'
    if reason in {'ambiguous-or-nonseries-identity', 'competing-exact-identity'}:
        exact = [m for m in candidates if normalized(canonical_query(record['title'])) in identity_names(m)]
        return 'unsupported_format' if exact and not any(m.get('format') in {'TV', 'TV_SHORT', 'ONA'} for m in exact) else 'ambiguous_identity'
    if reason == 'numbering-version-needs-file-review':
        return 'numbering_version_review'
    if reason == 'archive-alias-needs-new-file-review':
        return 'alias_cohort_review'
    if reason == 'episode-bound-or-unreleased':
        exact = [m for m in candidates if normalized(canonical_query(record['title'])) in identity_names(m)
                 and m.get('format') in {'TV', 'TV_SHORT', 'ONA'}]
        if len(exact) == 1 and isinstance(exact[0].get('episodes'), int):
            return 'episode_out_of_bounds' if record['episode'] > exact[0]['episodes'] else 'mixed_numbering'
        return 'reference_not_ready'
    return 'ambiguous_identity'


def review_rows(rows, state, cache, bindings):
    from backfill import archive_identity_hint
    rows = [{**row, 'parsed': archive_identity_hint(row['parsed'])} for row in rows]
    lookup = reference_lookup(cache)
    pool = lookup[0]
    groups = defaultdict(list)
    for row in rows:
        groups[row['parsed'].get('title')].append(row)
    decisions = {}
    for title, whole_group in groups.items():
        entry = cache.get(title, {})
        candidates = list(pool.values()) if title in APPROVED_ALIASES else reference_candidates(title, entry, lookup)
        exact = [m for m in candidates if normalized(canonical_query(title)) in identity_names(m)]
        single_movie = len(exact) == 1 and exact[0].get('format') == 'MOVIE' and exact[0].get('episodes') == 1
        special = exact[0] if len(exact) == 1 and exact[0].get('format') in SPECIAL_FORMATS else None
        cohorts = identity_cohorts(title, whole_group)
        for group in cohorts:
            safe = [row['parsed'] for row in group if not record_problem(row, row['parsed'], single_movie, special)]
            media, reason = choose_identity(title, safe, candidates) if safe else (None, 'no-safe-record')
            for row in group:
                record = row['parsed']
                status = record_problem(row, record, single_movie, special)
                detail = ''
                binding = bindings.get(title)
                if not status and binding and binding.get('conflict'):
                    status = 'binding_conflict'
                if not status and not (entry.get('complete') or entry.get('canonicalComplete')) and title not in APPROVED_ALIASES:
                    status, detail = 'reference_pending', entry.get('error') or 'not-fetched'
                if not status:
                    status = identity_problem(reason, media, record, candidates)
                    detail = reason
                if not status:
                    existing = existing_identities(state, media)
                    if len(existing) > 1:
                        status = 'catalog_conflict'
                        detail = 'multiple-existing-pages'
                    elif existing and (((existing[0][1].get('type') == 'فیلم' or existing[0][1].get('format') == 'MOVIE') != (media['format'] == 'MOVIE'))
                          or existing[0][1].get('format') == 'MUSIC'
                          or ((media['format'] in SPECIAL_FORMATS or existing[0][1].get('format') in SPECIAL_FORMATS)
                              and existing[0][1].get('format') != media['format'])
                          or existing[0][1].get('metadataProviderId') not in (None, media['id'])
                          or existing[0][1].get('declaredEpisodes') not in (None, media['episodes'])
                          or (existing[0][1].get('year') and existing[0][1]['year'] != (media.get('startDate') or {}).get('year'))):
                        status, detail = 'catalog_conflict', 'existing-page-year-format-provider-or-episode-conflict'
                    elif binding and binding.get('anime_key') != (existing[0][0] if existing else 'al' + str(media['id'])):
                        status, detail = 'binding_conflict', 'existing-binding-different-key'
                    else:
                        context = existing[0][1] if existing else {
                            'year': media['startDate']['year'], 'declaredEpisodes': media['episodes'],
                            'format': media['format'], 'verifiedArchiveTitles': [title],
                        }
                        if media['format'] in SPECIAL_FORMATS and (not existing or context.get('metadataProviderId') == media['id']):
                            context = {**context, 'metadataProviderId': media['id'], 'archiveSpecialReference': media}
                        if existing and context.get('metadataSource') == 'anilist':
                            context = {**context, 'verifiedArchiveTitles': [*context.get('verifiedArchiveTitles', []), title]}
                        status = 'ready_to_bind' if compatible_record(context, record) else 'apply_guard_hold'
                # A shared/incomplete pool is not a set of title suggestions.
                # Missing-title and quality-held rows used to show arbitrary
                # unrelated nodes simply because they came first in that pool.
                alias = APPROVED_ALIASES.get(title)
                evidence = [media] if media else [candidate for candidate in candidates if title and (
                    candidate['id'] == alias[0] if alias else
                    normalized(canonical_query(title)) in identity_names(candidate))][:5]
                decisions[row['id']] = {
                    'id': row['id'], 'title': title or '', 'filename': record.get('name') or '',
                    'season': record.get('season'), 'episode': record.get('episode'), 'quality': record.get('quality') or '',
                    'status': status, 'reason': detail, 'animeKey': row.get('anime_key') or '',
                    'providerCandidates': '; '.join(str(m['id']) + ':' + (m.get('title', {}).get('romaji') or '') for m in evidence),
                }
    assert len(decisions) == len(rows)
    assert all(item['status'] in LABELS for item in decisions.values())
    return sorted(decisions.values(), key=lambda item: item['id'])


def csv_value(value):
    text = '' if value is None else str(value)
    return "'" + text if text.startswith(('=', '+', '-', '@')) else text


def included_scope_ids(document):
    ids = document.get('ids') if isinstance(document, dict) else None
    if not isinstance(ids, list) or any(isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0 for ident in ids):
        raise ValueError('invalid-included-archive-scope')
    return set(ids)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--include-scope', type=Path, help='Include an immutable baseline roster without replacing the existing review baseline')
    args = parser.parse_args()
    from common import DATA, atomic_write_json, now_iso
    scope_path = DATA / 'archive-review-scope.json'
    scope = json.loads(scope_path.read_text()) if scope_path.exists() else {'createdAt': now_iso(), 'ids': []}
    db = sqlite3.connect('file:' + str(DATA / 'archive-pipeline.sqlite3') + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('BEGIN')
    included = included_scope_ids(json.loads(args.include_scope.read_text())) if args.include_scope else set()
    ids = set(scope['ids']) | included | {r[0] for r in db.execute("SELECT id FROM files WHERE state='copied' AND anime_key IS NULL")}
    rows = []
    for row in db.execute('SELECT * FROM files'):
        if row['id'] in ids:
            value = dict(row)
            value['parsed'] = json.loads(row['record'])
            rows.append(value)
    bindings = {row['title']: dict(row) for row in db.execute('SELECT * FROM bindings')}
    counts = dict(db.execute('SELECT state,count(*) FROM files GROUP BY state'))
    db.close()
    state = json.loads((DATA / 'aniplus-state.json').read_text())
    cache = json.loads((DATA / 'archive-identity-cache.json').read_text())
    decisions = review_rows(rows, state, cache, bindings)
    missing = ids - {r['id'] for r in decisions}
    decisions.extend({'id': ident, 'title': '', 'filename': '', 'season': '', 'episode': '', 'quality': '',
                      'status': 'scope_missing', 'reason': '', 'animeKey': '', 'providerCandidates': ''} for ident in missing)
    assert len(decisions) == len(ids) == len({r['id'] for r in decisions})
    if 'baselineIds' not in scope:
        scope['baselineIds'] = sorted(ids)
        scope['baselineDigest'] = hashlib.sha256(json.dumps(sorted(ids)).encode()).hexdigest()
    atomic_write_json(scope_path, {**scope, 'updatedAt': now_iso(), 'ids': sorted(ids)})
    totals = Counter(row['status'] for row in decisions)
    summary = {'observedAt': now_iso(), 'scopeFiles': len(ids), 'accountedFiles': len(decisions),
               'triageComplete': len(ids) == len(decisions) and not totals['scope_missing'],
               'baselineFiles': len(scope['baselineIds']), 'addedFiles': len(ids - set(scope['baselineIds'])),
               'baselineDigest': scope['baselineDigest'],
               'rosterDigest': hashlib.sha256(json.dumps(sorted(ids)).encode()).hexdigest(),
               'matcherDigest': hashlib.sha256((Path(__file__).parent / 'archive_identity.py').read_bytes()).hexdigest(),
               'providerCacheDigest': hashlib.sha256(json.dumps(cache, sort_keys=True).encode()).hexdigest(),
               'statusCounts': dict(totals), 'copyCounts': counts,
               'referenceWorkComplete': not totals['reference_pending'],
               'allMatched': all(row['status'] == 'matched' for row in decisions),
               'note': 'Every file has a status. Reviewed holds are NOT certified matches; publication is verified separately.'}
    if args.include_scope:
        summary.update(includedBaselineFiles=len(included),
                       includedBaselineDigest=hashlib.sha256(json.dumps(sorted(included)).encode()).hexdigest(),
                       includedBaselineMatched=sum(item['status'] == 'matched' for item in decisions if item['id'] in included))
    args.output.mkdir(parents=True, exist_ok=True)
    atomic_write_json(args.output / 'animeverse-review-summary.json', summary)
    row_map = {row['id']: row for row in rows}
    for item in decisions:
        entry = cache.get(item['title'], {})
        source_row = row_map.get(item['id'], {})
        item['fileReady'] = source_row.get('state') == 'copied' and bool(source_row.get('destination_id'))
        item['publicationStatus'] = 'not-individually-verified'
        item['referenceComplete'] = bool(entry.get('complete'))
        item['referenceCheckedAt'] = entry.get('checkedAt') or ''
    fields = ['id', 'title', 'filename', 'season', 'episode', 'quality', 'status', 'description', 'reason', 'animeKey',
              'fileReady', 'publicationStatus', 'referenceComplete', 'referenceCheckedAt', 'providerCandidates']
    with (args.output / 'animeverse-file-statuses.csv').open('w', encoding='utf-8-sig', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        for item in sorted(decisions, key=lambda row: row['id']):
            writer.writerow({key: csv_value(value) for key, value in {**item, 'description': LABELS[item['status']]}.items()})
    title_groups = defaultdict(list)
    for row in decisions:
        if row['status'] != 'matched':
            title_groups[row['title'] or '[عنوان استخراج نشده]'].append(row)
    lines = ['وضعیت عنوان‌های باقی‌مانده؛ هر عنوان یک بار', summary['observedAt'],
             'این گزارش تعیین وضعیت است، نه ادعای تطبیق همهٔ فایل‌ها.', '']
    for title, items in sorted(title_groups.items(), key=lambda pair: pair[0].casefold()):
        statuses = Counter(item['status'] for item in items)
        lines.extend([title, ' | '.join(LABELS[status] + ': ' + str(count) for status, count in statuses.items()),
                      'نمونه: ' + items[0]['filename'], ''])
    (args.output / 'animeverse-title-statuses.txt').write_text('\n'.join(lines) + '\n')
    print('ARCHIVE_FILE_REVIEW', json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
