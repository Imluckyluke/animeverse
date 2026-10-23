#!/usr/bin/env bash
# Archive-first supervisor: keeps the archive link backfill alive, snapshots
# the canonical state, and re-discovers archive-backed AniPlus titles daily.
set -euo pipefail
cd /var/lib/bot-host/animeverse
export PATH=/var/lib/bot-host/.local/node/bin:$PATH
mkdir -p logs data/backups
exec 9>data/archive-supervisor.lock
if ! flock -n 9; then
  exit 0
fi

last_discover=0
last_rebuild=$(date +%s)
while true; do
  if [ -f data/sync.stop ]; then
    sleep 60
    continue
  fi

  now=$(date +%s)
  # Never run discover while the link copier or normal sync worker is writing.
  if ! pgrep -f '^/usr/bin/python3 tools/tg/backfill.py --link$' >/dev/null \
     && ! pgrep -f '^/usr/bin/python3 tools/tg/sync.py' >/dev/null \
     && [ $((now - last_discover)) -ge 86400 ]; then
    PYTHONPATH=tools/tg /usr/bin/python3 tools/tg/backfill.py --discover --no-covers >> logs/archive-supervisor.log 2>&1 || true
    last_discover=$now
  fi

  # Snapshot the database and derived catalog every six hours.
  stamp_file=data/backups/.last-supervisor-backup
  last_backup=$(cat "$stamp_file" 2>/dev/null || echo 0)
  if [ $((now - last_backup)) -ge 21600 ]; then
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    cp -p data/aniplus-state.json "data/backups/aniplus-state.supervisor-$ts.json" 2>/dev/null || true
    cp -p data/backfill-archive-map.json "data/backups/backfill-archive-map.$ts.json" 2>/dev/null || true
    cp -p src/lib/real-catalog.json "data/backups/real-catalog.supervisor-$ts.json" 2>/dev/null || true
    echo "$now" > "$stamp_file"
    # Keep two weeks of supervisor snapshots.
    find data/backups -maxdepth 1 -type f \( -name 'aniplus-state.supervisor-*.json' -o -name 'real-catalog.supervisor-*.json' -o -name 'backfill-archive-map.*.json' \) -mtime +14 -delete 2>/dev/null || true
  fi

  # While the long archive copier is running, publish the newly resolved
  # links to the static site every half hour. The copier only rewrites the
  # catalog JSON; Next.js still serves the last build until we rebuild.
  if pgrep -f '^/usr/bin/python3 tools/tg/backfill.py --link$' >/dev/null \
     && [ $((now - last_rebuild)) -ge 1800 ]; then
    scripts/rebuild.sh >> logs/archive-supervisor.log 2>&1 || true
    last_rebuild=$now
  fi

  # Restart the archive copier if it stopped while pending archive links remain.
  if ! pgrep -f '^/usr/bin/python3 tools/tg/backfill.py --link$' >/dev/null \
     && ! pgrep -f '^/usr/bin/python3 tools/tg/sync.py' >/dev/null; then
    PYTHONPATH=tools/tg /usr/bin/python3 tools/tg/backfill.py --link >> logs/archive-supervisor.log 2>&1 || true
  fi

  # Once the archive copier has drained, keep the normal AniPlus watcher alive.
  # It also respects data/sync.stop and the persisted MiniBot wait deadline.
  if ! pgrep -f '^/usr/bin/python3 tools/tg/backfill.py --link$' >/dev/null \
     && ! pgrep -f '^/usr/bin/python3 tools/tg/sync.py' >/dev/null; then
    nohup env PYTHONPATH=tools/tg /usr/bin/python3 tools/tg/sync.py --watch --posts 20 \
      >> logs/sync-worker.log 2>&1 &
    echo $! > logs/sync-worker.pid
  fi

  sleep 300
done
