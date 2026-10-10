#!/bin/bash
# Deploy the account server to the VPS: https://clipper.hellens.dev/api  (see deploy/central/docker-compose.yml)
#   bash scripts/deploy-central.sh                 (SSH alias vps-run)
#   HOST=other-alias bash scripts/deploy-central.sh
# Uploads central/{server,cli,backup}.js, (re)creates the container, installs a daily backup cron job (03:15),
# then checks the health endpoint through Traefik and publicly. The database lives in /var/lib/clipper-central and is NOT touched.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-vps-run}"; DIR=/opt/clipper-central; DATA=/var/lib/clipper-central; URL=https://clipper.hellens.dev/api/health

echo "== upload"
ssh "$HOST" "mkdir -p $DIR/app $DATA/backups && chown -R 1000:1000 $DATA"
COPYFILE_DISABLE=1 tar --no-xattrs -C central -czf - server.js cli.js backup.js | ssh "$HOST" "tar -xzf - -C $DIR/app"
scp -q deploy/central/docker-compose.yml "$HOST:$DIR/"

echo "== (re)start container"
ssh "$HOST" "cd $DIR && docker compose up -d --force-recreate && docker compose ps"

echo "== daily backup (cron 03:15, 14 copies kept in $DATA/backups)"
ssh "$HOST" "printf '15 3 * * * root docker exec clipper-central node /app/backup.js /data/backups >> /var/log/clipper-backup.log 2>&1\n' > /etc/cron.d/clipper-central && chmod 644 /etc/cron.d/clipper-central"

echo "== health through Traefik (origin), then public"
ssh "$HOST" "for i in \$(seq 1 25); do c=\$(curl -sk -o /dev/null -w '%{http_code}' --resolve clipper.hellens.dev:443:127.0.0.1 $URL); [ \"\$c\" = 200 ] && break; sleep 3; done; echo \"origin -> \$c\""
curl -s -m 20 -w '  public -> %{http_code}\n' "$URL"
