#!/usr/bin/env python3
"""Offline additive migration, with verified backups and identity preservation."""
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import time

from common import DATA, STATE_PATH, atomic_write_json, now_iso
from archive_pipeline import open_db


def identities(db):
    digest = hashlib.sha256()
    for row in db.execute('SELECT id,document_id,random_id,destination_id,anime_key,state FROM files ORDER BY id'):
        digest.update(json.dumps(tuple(row), separators=(',', ':')).encode())
    return digest.hexdigest()


def main():
    os.umask(0o077)
    with (DATA / 'archive-pipeline.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        folder = DATA / 'backups' / ('minibot-enable-' + str(time.time_ns()))
        folder.mkdir(mode=0o700)
        path = DATA / 'archive-pipeline.sqlite3'
        before_state = hashlib.sha256(STATE_PATH.read_bytes()).hexdigest()
        with sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True) as source:
            before_ids = identities(source)
            snapshot = folder / 'pipeline.sqlite3'
            with sqlite3.connect(snapshot) as destination:
                source.backup(destination)
                if destination.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                    raise RuntimeError('Offline backup integrity failure')
        metadata = []
        for source in (snapshot, STATE_PATH):
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            compressed = folder / (source.name + '.gz')
            with source.open('rb') as reader, gzip.open(compressed, 'wb') as writer:
                shutil.copyfileobj(reader, writer)
            with gzip.open(compressed, 'rb') as reader:
                if hashlib.file_digest(reader, 'sha256').hexdigest() != digest:
                    raise RuntimeError('Compressed backup integrity failure')
            metadata.append({'name': compressed.name, 'decompressedSha256': digest})
        with tempfile.TemporaryDirectory(prefix='minibot-restore-', dir=folder) as temporary:
            restored = Path(temporary) / 'pipeline.sqlite3'
            with gzip.open(folder / 'pipeline.sqlite3.gz', 'rb') as reader, restored.open('wb') as writer:
                shutil.copyfileobj(reader, writer)
            with sqlite3.connect('file:' + str(restored) + '?mode=ro', uri=True) as database:
                if database.execute('PRAGMA quick_check').fetchall() != [('ok',)] or identities(database) != before_ids:
                    raise RuntimeError('Backup restore did not preserve archive identities')
        snapshot.unlink()
        database = open_db(path)
        try:
            if identities(database) != before_ids or hashlib.sha256(STATE_PATH.read_bytes()).hexdigest() != before_state:
                raise RuntimeError('Additive migration changed original identities')
        finally:
            database.close()
        atomic_write_json(folder / 'manifest.json', {'checkedAt': now_iso(), 'files': metadata,
            'archiveIdentitySha256': before_ids, 'canonicalStateSha256': before_state, 'restoredAndVerified': True})
        atomic_write_json(DATA / 'minibot-migration-verified.json', {'checkedAt': now_iso(),
            'backup': folder.name, 'originalIdentitiesPreserved': True, 'originalQueuePreserved': True})
        print('MINIBOT_ADDITIVE_SCHEMA_BACKUP_RESTORE_AND_IDENTITIES_VERIFIED', flush=True)


if __name__ == '__main__':
    main()
