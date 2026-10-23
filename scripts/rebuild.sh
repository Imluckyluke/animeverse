#!/usr/bin/env bash
set -euo pipefail
cd /var/lib/bot-host/animeverse
export PATH=/var/lib/bot-host/.local/node/bin:$PATH
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi
mkdir -p logs
STAMP="$(date -Is)"
echo "[$STAMP] build start" >> logs/build.log

if ! npm run build >> logs/build.log 2>&1; then
  echo "[$STAMP] build FAILED" >> logs/build.log
  exit 1
fi
echo "[$STAMP] build ok; restarting server" >> logs/build.log

OLD="$(ss -ltnp 'sport = :3000' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true)"
if [ -n "${OLD:-}" ]; then
  kill "$OLD" 2>/dev/null || true
  for _ in $(seq 1 30); do
    kill -0 "$OLD" 2>/dev/null || break
    sleep 0.2
  done
  kill -9 "$OLD" 2>/dev/null || true
fi

nohup node node_modules/next/dist/bin/next start -p 3000 >> logs/app.log 2>&1 &
echo $! > logs/server.pid

# Keep the Telegram notification worker alive across site rebuilds. It is
# optional: if the token has not been provisioned yet the site still starts.
if [ -s data/notify-bot-token ]; then
  OLD_BOT="$(pgrep -f '^/usr/bin/python3 tools/tg/notify_bot.py$' | head -1 || true)"
  if [ -n "${OLD_BOT:-}" ]; then
    kill "$OLD_BOT" 2>/dev/null || true
    sleep 0.4
  fi
  nohup /usr/bin/python3 tools/tg/notify_bot.py >> logs/notify-bot.log 2>&1 &
  echo $! > logs/notify-bot.pid
  echo "[$STAMP] notify bot started (pid $(cat logs/notify-bot.pid))" >> logs/build.log
fi

sleep 1
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ 2>/dev/null || true)"
  if [ "$code" = "200" ]; then
    echo "[$STAMP] server up (pid $(cat logs/server.pid))" >> logs/build.log
    exit 0
  fi
  sleep 1
done
echo "[$STAMP] server health check FAILED" >> logs/build.log
exit 1
