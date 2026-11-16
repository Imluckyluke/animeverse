"""Optional per-file certification after a page's source identity was mixed.

This never changes source records or accepted download jobs. Unreviewed pages
keep their existing rules; a reviewed page cannot regain an old MiniBot link.
"""
import hashlib
import json


def fingerprint(record):
    fields = ('id', 'name', 'caption', 'title', 'episode', 'quality', 'date')
    value = {field: record.get(field) for field in fields}
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def reviewed_record_allowed(anime, record, document_id=None):
    review = anime.get('archiveFileReview')
    if review is None:
        return True
    if not isinstance(review, dict) or review.get('version') != 1:
        return False
    entry = (review.get('files') or {}).get(str(record.get('id')))
    if not isinstance(entry, dict) or entry.get('sha256') != fingerprint(record):
        return False
    return document_id is None or str(document_id) == entry.get('documentId')


def reviewed_queue_allowed(anime, queued):
    review = anime.get('archiveFileReview')
    if review is None:
        return True
    if not isinstance(review, dict) or review.get('version') != 1:
        return False
    ident = queued.get('archiveRecordId')
    entry = (review.get('files') or {}).get(str(ident))
    if not isinstance(entry, dict) or queued.get('source') != 'archive' or queued.get('deepLink') != f'archive:{ident}':
        return False
    expected = entry.get('destinationId')
    if expected is not None and queued.get('messageId') != expected:
        return False
    return True
