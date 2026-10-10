#!/bin/bash
# Deploy landing/ to the VPS behind Traefik at https://clipper.hellens.dev
#   bash scripts/deploy-landing.sh            (uses the SSH alias vps-run, see ~/.ssh/config)
#   HOST=other-alias bash scripts/deploy-landing.sh
# Uploads the files, (re)creates the clipper-landing container, then checks it through the proxy.
# Prerequisites: DNS A record clipper.hellens.dev -> the VPS (Cloudflare, proxied), Docker + the `coolify` network on the VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${HOST:-vps-run}"; DIR=/opt/clipper-landing; DOMAIN=clipper.hellens.dev

echo "== upload to $HOST:$DIR"
ssh "$HOST" "mkdir -p $DIR/site"
COPYFILE_DISABLE=1 tar --no-xattrs -C landing --exclude='.DS_Store' --exclude='assets/creator-*' -czf - . | ssh "$HOST" "rm -rf $DIR/site/* && tar -xzf - -C $DIR/site"
# Cloudflare caches css/js by URL; stamp them with a content hash so every deploy is visible immediately.
STAMP=$(cat landing/styles.css landing/script.js | shasum | cut -c1-8)
ssh "$HOST" "sed -i 's#styles.css\"#styles.css?v=$STAMP\"#; s#script.js\"#script.js?v=$STAMP\"#' $DIR/site/index.html"
scp -q deploy/landing/docker-compose.yml deploy/landing/nginx.conf "$HOST:$DIR/"

echo "== validate nginx config before touching the running container"
ssh "$HOST" "docker run --rm -v $DIR/nginx.conf:/etc/nginx/conf.d/default.conf:ro nginx:stable-alpine nginx -t 2>&1 | tail -2"

echo "== (re)start container"
ssh "$HOST" "cd $DIR && docker compose up -d --force-recreate && docker compose ps"

echo "== check through Traefik (origin, bypassing Cloudflare)"
ssh "$HOST" "for i in \$(seq 1 20); do c=\$(curl -sk -o /dev/null -w '%{http_code}' --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/); [ \"\$c\" = 200 ] && break; sleep 3; done; echo \"https origin -> \$c\""
echo "== public"
curl -sI -m 20 "https://$DOMAIN/" | head -1
