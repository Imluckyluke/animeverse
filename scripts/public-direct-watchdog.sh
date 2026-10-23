#!/usr/bin/env bash
# Emergency recovery for the host's socket-activated SSH service.
# This script is scheduled by public-direct.sh and also runs as a root
# transient timer, so it can repair the socket/daemon layout even if the
# switch itself loses the SSH connection.
set -uo pipefail

LOG=/var/log/animeverse-direct.log
SSH_CONF=/etc/ssh/sshd_config.d/00-hadi-access.conf
SOCKET_DROPIN=/etc/systemd/system/ssh.socket.d/99-hadi-port.conf

exec >>"$LOG" 2>&1
echo "=== recovery watchdog $(date -Is) ==="

# Stop the failed multiplexer and any orphaned probe listener.
systemctl disable --now sslh >/dev/null 2>&1 || true
pkill -9 -x sslh >/dev/null 2>&1 || true
pkill -9 -f '/usr/sbin/sslh' >/dev/null 2>&1 || true

# The host uses ssh.socket (not only sshd's Port directive). Restore the
# original public listener on 8063; the daemon must not bind this port itself
# while the socket owns it.
mkdir -p /etc/systemd/system/ssh.socket.d
cat >"$SOCKET_DROPIN" <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:8063
EOF

sed -i -E 's/^[[:space:]]*Port[[:space:]]+22[[:space:]]*$/Port 8063/' "$SSH_CONF"
grep -qE '^[[:space:]]*Port[[:space:]]+8063[[:space:]]*$' "$SSH_CONF" || echo 'Port 8063' >>"$SSH_CONF"

# Stop the stale manually-started daemon and let socket activation provide a
# fresh accepted fd to sshd on the next connection.
systemctl stop ssh.service >/dev/null 2>&1 || true
systemctl stop ssh.socket >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl start ssh.socket

sleep 1
echo "listeners:"
ss -ltnp 2>/dev/null | grep -E ':22 |:8063 |:3000 ' || true
# Trigger socket activation and verify the SSH banner locally.
banner=$(timeout 4 bash -c 'exec 3<>/dev/tcp/127.0.0.1/8063; head -c 16 <&3' 2>/dev/null || true)
echo "banner=$banner"
if printf '%s' "$banner" | grep -q 'SSH-2.0'; then
    touch /run/animeverse-recovery-ok
    echo "RECOVERY OK $(date -Is)"
else
    echo "RECOVERY CHECK FAILED $(date -Is)"
fi
