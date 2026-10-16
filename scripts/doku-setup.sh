#!/bin/bash
# Put the DOKU credentials on the server, restart the account server and verify them against DOKU (no order is created, nothing is charged).
#   bash scripts/doku-setup.sh                 production (the default)
#   DOKU_ENV=sandbox bash scripts/doku-setup.sh
# You are asked for the Client ID and the Secret Key (hidden input). They travel over SSH on stdin, never as arguments, and end up only in
# /opt/clipper-central/.env on the server (chmod 600). The previous file is kept as .env.bak. Needs the SSH alias of the VPS (default vps-run).
set -euo pipefail
HOST="${HOST:-vps-run}"; DIR="${DIR:-/opt/clipper-central}"; ENVN="${DOKU_ENV:-production}"
[ "$ENVN" = production ] || [ "$ENVN" = sandbox ] || { echo "DOKU_ENV harus production atau sandbox." >&2; exit 1; }
echo "Lingkungan: $ENVN"; [ "$ENVN" = production ] && echo "(production = uang sungguhan; tekan Ctrl+C untuk batal)"
clean() { printf '%s' "$1" | tr -d '[:space:]"'"'"; }
read -r -p "Client ID  : " CID; CID="$(clean "$CID")"
read -r -s -p "Secret Key : " SEC; echo; SEC="$(clean "$SEC")"
[ -n "$CID" ] && [ -n "$SEC" ] || { echo "Client ID dan Secret Key wajib diisi." >&2; exit 1; }
case "$SEC" in doku_key_*) echo "Catatan: nilai berawalan doku_key_ biasanya BUKAN Secret Key. Pastikan itu hasil 'Reveal Key' di Settings > API Keys." >&2;; esac

echo "== menulis $DIR/.env di $HOST"
printf '%s\n%s\n' "$CID" "$SEC" | ssh "$HOST" "set -e; cd $DIR; read -r C; read -r S; [ -f .env ] && cp .env .env.bak || : ; \
  { grep -vE '^(DOKU_CLIENT_ID|DOKU_SECRET_KEY|DOKU_ENV)=' .env.bak 2>/dev/null || true; printf 'DOKU_CLIENT_ID=%s\nDOKU_SECRET_KEY=%s\nDOKU_ENV=$ENVN\n' \"\$C\" \"\$S\"; } > .env.new; \
  mv .env.new .env; chmod 600 .env; [ -f .env.bak ] && chmod 600 .env.bak || :"
echo "== menjalankan ulang server akun"
ssh "$HOST" "cd $DIR && docker compose up -d --force-recreate >/dev/null 2>&1 && for i in \$(seq 1 20); do docker exec clipper-central wget -q -O /dev/null http://127.0.0.1:4000/health && break; sleep 1; done"
echo "== memeriksa kredensial ke DOKU"
if ssh "$HOST" "docker exec clipper-central node --no-warnings /app/cli.js doku-check"; then
  echo; echo "Selesai. Buka halaman Akun di aplikasi dan coba Beli (Pro bulanan Rp 49.000)."
else
  echo; echo "Kredensial belum cocok. File lama ada di $DIR/.env.bak. Salin ulang Client ID dan Secret Key dari halaman yang sama ($ENVN) lalu jalankan skrip ini lagi." >&2; exit 1
fi
