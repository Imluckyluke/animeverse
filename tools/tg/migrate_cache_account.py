#!/usr/bin/env python3
"""Offline account cutover: preserve accepted jobs, never contact the old owner.

Stop both cache services before running. The backup contains cache state only,
not credentials. Old release assets are left untouched on GitHub.
"""
import os
from pathlib import Path
import sqlite3

LEGACY_REPOSITORIES = (
    'Imluckyluke/animeverse-popular-downloads',
    'Imluckyluke/animeverse-temporary-downloads',
)


def migrate(connection):
    reset = 0
    with connection:
        for repo in LEGACY_REPOSITORIES:
            reset += connection.execute("""UPDATE jobs SET
                state=CASE WHEN state IN ('ready','uploading','queued','waiting','deleting')
                    THEN 'waiting' ELSE state END,
                url='',asset_id=NULL,release_id=NULL,progress=0,sha256='',
                attempts=0,next_attempt=0,error='',promote=0
                WHERE substr(url,1,?)=?""",
                (len('https://github.com/'+repo+'/releases/download/'),
                 'https://github.com/'+repo+'/releases/download/')).rowcount
        interrupted = connection.execute("""UPDATE jobs SET state='waiting',progress=0,
            attempts=0,next_attempt=0,error='' WHERE state='uploading' AND url=''""").rowcount
        retired = connection.execute('DELETE FROM retired WHERE repo IN (?,?)', LEGACY_REPOSITORIES).rowcount
    return {'legacy_assets_detached': reset, 'interrupted_jobs_requeued': interrupted,
            'legacy_cleanup_entries_detached': retired}


def main():
    import json
    import subprocess
    for service in ('animeverse-download-cache.service', 'animeverse-download-cache-tunnel.service'):
        state = subprocess.run(['systemctl','show',service,'--property=MainPID','--value'],
                               capture_output=True,text=True,check=True).stdout.strip()
        if state != '0':
            raise SystemExit('Stop both cache services before migrating')
    private = Path.home()/'.local/share/animeverse-download-cache'
    backup = private/'cache.pre-account-cutover.sqlite'
    descriptor = os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(descriptor)
    connection = sqlite3.connect(private/'cache.sqlite')
    try:
        with sqlite3.connect(backup) as destination:
            connection.backup(destination)
        print('CACHE_ACCOUNT_STATE_MIGRATED',json.dumps(migrate(connection)),flush=True)
    finally:
        connection.close()


if __name__ == '__main__':
    main()
