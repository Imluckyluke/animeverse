"""Read-only metadata inspection through the sole archive writer's client.

Only locally requested, hash-guarded archive IDs can be inspected. Optional
Matroska-header inspection is capped at 256 KiB/file, never a full download.
No bot start, channel join, source rewrite or assignment occurs here.
"""
import hashlib
import json
import re

from common import DATA, atomic_write_json, now_iso, read_json


def matroska_dimensions(data):
    """Read Video track PixelWidth/PixelHeight, never scan payload for patterns."""
    def vint(offset, identifier=False):
        if offset >= len(data) or data[offset] == 0:
            raise ValueError('incomplete EBML integer')
        length = 1
        while not data[offset] & (0x80 >> (length - 1)):
            length += 1
        if length > (4 if identifier else 8) or offset + length > len(data):
            raise ValueError('invalid EBML integer')
        value = int.from_bytes(data[offset:offset + length], 'big')
        if not identifier:
            value &= (1 << (7 * length)) - 1
            if value == (1 << (7 * length)) - 1:
                value = None
        return value, offset + length

    def elements(start, end, partial_segment=False):
        while start < end:
            ident, body = vint(start, True)
            size, body = vint(body)
            finish = body + size if size is not None else end
            if finish > end or size is None:
                if not (partial_segment and ident == 0x18538067):
                    return
                finish = end
            yield ident, body, finish
            start = finish

    try:
        top = list(elements(0, len(data), True))
        header = next((item for item in top if item[0] == 0x1A45DFA3), None)
        if not header or not any(ident == 0x4282 and data[start:end] in (b'matroska', b'webm')
                                 for ident, start, end in elements(header[1], header[2])):
            return []
        tracks = []
        for ident, start, end in top:
            if ident != 0x18538067:
                continue
            tracks.extend((a, b) for tag, a, b in elements(start, end) if tag == 0x1654AE6B)
        dimensions = set()
        for begin, finish in tracks:
            for ident, start, end in elements(begin, finish):
                if ident != 0xAE:
                    continue
                fields = list(elements(start, end))
                if not any(tag == 0x83 and int.from_bytes(data[a:b], 'big') == 1 for tag, a, b in fields):
                    continue
                for tag, a, b in fields:
                    if tag == 0xE0:
                        video = {key: int.from_bytes(data[x:y], 'big') for key, x, y in elements(a, b)
                                 if key in {0xB0, 0xBA} and 0 < y - x <= 4}
                        width, height = video.get(0xB0, 0), video.get(0xBA, 0)
                        if 0 < width <= 16384 and 0 < height <= 16384:
                            dimensions.add((width, height))
        return sorted(dimensions)
    except (ValueError, OverflowError):
        return []


async def inspect_header(pipeline, document):
    stream = pipeline.client.iter_download(document, request_size=65536, chunk_size=65536)
    data = bytearray()
    try:
        for _ in range(4):
            try:
                chunk = await pipeline.tg(lambda: stream.__anext__())
            except StopAsyncIteration:
                break
            data.extend(chunk)
            dimensions = matroska_dimensions(data)
            if dimensions:
                return dimensions, len(data)
    finally:
        await stream.close()
    return [], len(data)


def verified_video_proposals(db):
    """Reconstruct recoveries from this writer's exact-document observations.

    Candidate existence is not a match: the identity planner and publication
    guards must independently accept every file before a live source changes.
    """
    from backfill import parse_archive_fields
    from archive_literal_files import lost_girls_filename
    evidence = read_json(DATA / 'archive-full-match/video-metadata-evidence.json', {}) or {}
    if evidence.get('version') != 1 or evidence.get('inspectorVersion') != 2:
        return {}
    proposals = {}
    for item in evidence.get('files', []):
        row = db.execute("SELECT * FROM files WHERE id=? AND state='copied' AND anime_key IS NULL", (item['id'],)).fetchone()
        if (not row or item.get('protectedContent') or item.get('dimensionBasis') not in
                {'matroska-track-header', 'telegram-video-attribute'}
                or hashlib.sha256(row['record'].encode()).hexdigest() != item.get('recordSha256')
                or str(row['document_id']) != item.get('documentId')):
            continue
        old = json.loads(row['record'])
        if old.get('name') != item.get('name') or old.get('size') != item.get('size'):
            continue
        dimensions = item.get('videoDimensions')
        if (not isinstance(dimensions, list) or len(dimensions) != 1 or len(dimensions[0]) != 2
                or any(type(value) is not int or not 1 <= value <= 16384 for value in dimensions[0])):
            continue
        parsed = parse_archive_fields(old.get('name') or '', '', row['id'], old.get('size'),
                                      old.get('date', ''), allow_incomplete=True)
        if not parsed:
            continue
        caption = item.get('caption') or old.get('caption') or ''
        literal = lost_girls_filename({**old, 'caption': caption})
        if literal:
            parsed.update(literal)
        quality = f'{dimensions[0][1]}p'
        stated = {int(value) for value in re.findall(r'(?<![A-Za-z0-9])(\d{2,4})p\b',
                  (old.get('name') or '').replace('_', ' ') + ' ' + caption.replace('_', ' '), re.I)}
        if stated and stated != {dimensions[0][1]}:
            continue
        if parsed.get('quality') and parsed['quality'].split()[0] != quality:
            continue
        parsed['quality'] = quality + (' x265' if parsed.get('x265') else '') + (' هاردساب' if parsed.get('hardsub') else '')
        if any(old.get(key) not in (None, '') and old[key] != parsed.get(key)
               for key in ('title', 'episode', 'quality', 'season', 'part')):
            continue
        proposals[row['id']] = {**old, **parsed, 'caption': caption,
            'videoMetadataEvidence': {key: item[key] for key in
                ('documentId', 'recordSha256', 'videoDimensions', 'dimensionBasis', 'headerBytesRead')}}
    return proposals


async def inspect_requested_files(pipeline):
    request_path = DATA / 'archive-full-match/video-metadata-request.json'
    evidence_path = DATA / 'archive-full-match/video-metadata-evidence.json'
    request = read_json(request_path, {}) or {}
    if not isinstance(request, dict):
        return
    digest = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
    previous = read_json(evidence_path, {}) or {}
    same_request = previous.get('requestSha256') == digest and previous.get('inspectorVersion') == 2
    if same_request and previous.get('complete', True):
        return
    batched = request.get('version') == 3 and request.get('createdBy') == 'archive-parser-audit-v1'
    if request.get('version') == 2:
        ids = request.get('fileIds')
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 80
                or any(isinstance(i, bool) or not isinstance(i, int) for i in ids) or len(set(ids)) != len(ids)):
            return
        files = []
        for ident in sorted(ids):
            row = pipeline.db.execute("SELECT * FROM files WHERE id=? AND state='copied' AND anime_key IS NULL", (ident,)).fetchone()
            if not row:
                return
            files.append({'id': ident, 'recordSha256': hashlib.sha256(row['record'].encode()).hexdigest(),
                          'documentId': str(row['document_id'])})
        if hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest() != request.get('sourceRowsSha256'):
            return
        request_files = [{**item, 'inspectHeader': request.get('inspectHeader') is True} for item in files]
    elif request.get('version') == 1 or batched:
        request_files = request.get('files')
    else:
        return
    if not isinstance(request_files, list) or not 1 <= len(request_files) <= (1024 if batched else 80):
        return
    if any(not isinstance(item, dict) or type(item.get('id')) is not int for item in request_files):
        return
    requested_ids = {item['id'] for item in request_files}
    if len(requested_ids) != len(request_files):
        return
    outcomes = dict(previous.get('outcomes', {})) if same_request and batched else {}
    if batched:
        request_files = [item for item in request_files if str(item['id']) not in outcomes][:20]
    expected = {}
    header_ids = set()
    for item in request_files:
        if not isinstance(item, dict):
            return
        ident = item.get('id')
        if isinstance(ident, bool) or not isinstance(ident, int) or ident in expected:
            return
        row = pipeline.db.execute("SELECT * FROM files WHERE id=? AND state='copied' AND anime_key IS NULL", (ident,)).fetchone()
        if (not row or hashlib.sha256(row['record'].encode()).hexdigest() != item.get('recordSha256')
                or str(row['document_id']) != item.get('documentId')):
            if batched:
                outcomes[str(ident)] = 'source-changed-or-no-longer-unmatched'
                continue
            return
        expected[ident] = row
        if item.get('inspectHeader') is True:
            header_ids.add(ident)
    messages = await pipeline.tg(lambda: pipeline.client.get_messages(pipeline.sky, ids=list(expected))) if expected else []
    # Keep earlier immutable observations, including the previous approved cohort.
    evidence = {item['id']: item for item in previous.get('files', [])
                if same_request or item['id'] not in requested_ids} if batched else {}
    downloaded = previous.get('fileBytesDownloaded', 0) if same_request and batched else 0
    for ident in expected:
        outcomes[str(ident)] = 'source-message-missing'
    for message in messages:
        if not message or message.id not in expected:
            continue
        row = expected[message.id]
        record = json.loads(row['record'])
        document = getattr(message, 'document', None)
        if (not document or str(document.id) != str(row['document_id'])
                or getattr(document, 'size', None) != record.get('size')
                or getattr(getattr(message, 'file', None), 'name', None) != record.get('name')):
            outcomes[str(message.id)] = 'document-name-or-size-mismatch'
            continue
        dimensions = sorted({(attr.w, attr.h) for attr in document.attributes
                             if type(attr).__name__ == 'DocumentAttributeVideo'
                             and isinstance(attr.w, int) and isinstance(attr.h, int)
                             and attr.w > 0 and attr.h > 0})
        protected = bool(getattr(message, 'noforwards', False)
                         or getattr(getattr(message, 'chat', None), 'noforwards', False))
        basis = 'telegram-video-attribute' if dimensions else ''
        read_bytes = 0
        if not dimensions and message.id in header_ids and not protected:
            dimensions, read_bytes = await inspect_header(pipeline, document)
            downloaded += read_bytes
            if dimensions:
                basis = 'matroska-track-header'
        outcomes[str(message.id)] = 'protected-content' if protected else 'inspected'
        evidence[message.id] = {'id': message.id, 'documentId': str(document.id),
            'recordSha256': hashlib.sha256(row['record'].encode()).hexdigest(),
            'name': record['name'], 'size': document.size,
            'caption': message.raw_text or '', 'videoDimensions': dimensions, 'dimensionBasis': basis,
            'headerBytesRead': read_bytes, 'protectedContent': protected, 'inspectedAt': now_iso()}
    current = [item for ident, item in evidence.items() if ident in requested_ids]
    complete = not batched or all(str(ident) in outcomes for ident in requested_ids)
    atomic_write_json(evidence_path, {'version': 1, 'inspectorVersion': 2, 'requestSha256': digest,
        'inspectedAt': now_iso(), 'requested': len(requested_ids), 'files': list(evidence.values()),
        'complete': complete, 'outcomes': outcomes,
        'liveRecordsChanged': False, 'fileBytesDownloaded': downloaded})
    pipeline.status['archiveVideoInspection'] = {'inspectedAt': now_iso(), 'requested': len(requested_ids),
        'processed': len(outcomes), 'complete': complete, 'verifiedDocuments': len(current),
        'withVideoDimensions': sum(bool(item['videoDimensions']) for item in current)}
