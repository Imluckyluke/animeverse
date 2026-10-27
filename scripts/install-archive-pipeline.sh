#!/usr/bin/env bash
set -euo pipefail
ROOT=/var/lib/bot-host/animeverse
install -m 0644 "$ROOT/scripts/animeverse-archive-pipeline.service" /etc/systemd/system/animeverse-archive-pipeline.service
install -m 0644 "$ROOT/scripts/animeverse-catalog-publisher.service" /etc/systemd/system/animeverse-catalog-publisher.service
systemctl daemon-reload
systemctl enable --now animeverse-archive-pipeline.service animeverse-catalog-publisher.service
systemctl show animeverse-archive-pipeline.service animeverse-catalog-publisher.service -p Id -p ActiveState -p SubState -p MainPID
