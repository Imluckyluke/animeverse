#!/usr/bin/env bash
# Serve the site directly on the public SSH-forwarded port.
#
# The router only forwards TCP 8063 to this host.  A normal SSH daemon cannot
# share that port with Next.js, so sslh multiplexes both protocols: browser
# HTTP is forwarded to 127.0.0.1:3000 and SSH is forwarded to 127.0.0.1:22.
#
# This script is intentionally cautious.  It keeps the SSH daemon reachable
# during the switch, schedules an independent rollback watchdog, and only
# leaves the new layout in place after both HTTP and SSH health checks pass.
set -uo pipefail

ROOT=/var/lib/bot-host/animeverse
LOG=/var/log/animeverse-direct.log
MARKER=/run/animeverse-direct-ok
SSH_CONF=/etc/ssh/sshd_config.d/00-hadi-access.conf
SSLH_DEFAULT=/etc/default/sslh
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WATCHDOG="$ROOT/scripts/public-direct-watchdog.sh"

exec >>"$LOG" 2>&1
echo "=== public-direct switch start $(date -Is) ==="

rollback() {
    echo "ROLLBACK $(date -Is)"
    systemctl disable --now sslh >/dev/null 2>&1 || true
    if [ -f "/root/00-hadi-access.conf.animeverse-$STAMP" ]; then
        cp -a "/root/00-hadi-access.conf.animeverse-$STAMP" "$SSH_CONF"
    else
        sed -i -E 's/^[[:space:]]*Port[[:space:]]+22[[:space:]]*$/Port 8063/' "$SSH_CONF"
    fi
    if [ -f "/root/sslh.default.animeverse-$STAMP" ]; then
        cp -a "/root/sslh.default.animeverse-$STAMP" "$SSLH_DEFAULT"
    fi
    sshd -t && systemctl restart ssh
    echo "ROLLBACK complete $(date -Is)"
}

mkdir -p /run /var/lib/bot-host/animeverse/data
rm -f "$MARKER"
cp -a "$SSH_CONF" "/root/00-hadi-access.conf.animeverse-$STAMP"
cp -a "$SSLH_DEFAULT" "/root/sslh.default.animeverse-$STAMP"

cat >"$SSLH_DEFAULT" <<'EOF'
DAEMON_OPTS="--user sslh --listen 0.0.0.0:8063 --ssh 127.0.0.1:22 --http 127.0.0.1:3000 --timeout 5"
EOF

# Make sshd listen only on the loopback-side port.  sslh remains the public
# listener and forwards SSH connections to this port.
sed -i -E 's/^[[:space:]]*Port[[:space:]]+8063[[:space:]]*$/Port 22/' "$SSH_CONF"
if ! grep -qE '^[[:space:]]*Port[[:space:]]+22[[:space:]]*$' "$SSH_CONF"; then
    echo "could not set sshd Port 22"
    rollback
    exit 1
fi

if ! sshd -t; then
    echo "sshd config validation failed"
    rollback
    exit 1
fi

# Independent watchdog: if this script dies or the site is inaccessible from
# the host, restore sshd on 8063 after two minutes.
if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --on-active=120s --unit="animeverse-direct-watchdog-$STAMP" --collect \
        /bin/bash "$WATCHDOG" >/dev/null 2>&1 || true
else
    setsid /bin/bash -c "sleep 120; /bin/bash '$WATCHDOG'" >/dev/null 2>&1 &
fi

systemctl restart ssh || { echo "sshd restart failed"; rollback; exit 1; }
systemctl restart sslh || { echo "sslh restart failed"; rollback; exit 1; }

http_ok=0
ssh_ok=0
for _ in $(seq 1 25); do
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:8063/covers/placeholder.svg 2>/dev/null || true)
    ssh_out=$(timeout 8 ssh -p 8063 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
        -o PreferredAuthentications=none -o ConnectTimeout=4 hadi@127.0.0.1 2>&1 || true)
    [ "$code" = "200" ] && http_ok=1 || http_ok=0
    case "$ssh_out" in *"Permission denied"*) ssh_ok=1 ;; *) ssh_ok=0 ;; esac
    [ "$http_ok" = 1 ] && [ "$ssh_ok" = 1 ] && break
    sleep 1
done

echo "health http=$http_ok ssh=$ssh_ok"
if [ "$http_ok" = 1 ] && [ "$ssh_ok" = 1 ]; then
    touch "$MARKER"
    systemctl enable sslh >/dev/null 2>&1 || true
    cat >"$ROOT/data/public-access.json" <<EOF
{
  "url": "http://109.125.177.141:8063",
  "host": "192.168.71.177",
  "listen_port": 8063,
  "http_target": "127.0.0.1:3000",
  "ssh_target": "127.0.0.1:22",
  "multiplexer": "sslh",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    echo "SUCCESS direct site: http://109.125.177.141:8063"
    exit 0
fi

rollback
exit 1
