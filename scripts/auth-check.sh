#!/bin/bash
# Smoke test auth: pusat + lokal pakai DB/port sementara. Jalankan: bash scripts/auth-check.sh
set -u; cd "$(dirname "$0")/.."; T=$(mktemp -d); fail=0
PORT=4555 CENTRAL_DB=$T/c.db node --no-warnings central/server.js >/dev/null 2>&1 & C=$!
PORT=3555 CENTRAL_URL=http://127.0.0.1:4555 KLIP_DATA=$T node server.js >/dev/null 2>&1 & L=$!
trap 'kill $C $L 2>/dev/null' EXIT; sleep 1.5
chk() { [ "$2" = "$3" ] && echo "ok   $1" || { echo "FAIL $1 (got $2, want $3)"; fail=1; }; }
J='-H content-type:application/json'; U=http://127.0.0.1:3555; CJ=$T/jar
code() { curl -s -m 5 -o /dev/null -w '%{http_code}' "$@"; }
chk "history tanpa login ditolak"  "$(code $U/history)" 401
chk "UI publik bisa dimuat"        "$(code $U/)" 200
chk "password pendek ditolak"      "$(code $J -d '{"email":"a@b.co","name":"A","password":"short"}' $U/auth/register)" 400
chk "register #1"                  "$(code -c $CJ $J -d '{"email":"a@b.co","name":"A","password":"password123"}' $U/auth/register)" 200
chk "me setelah login"             "$(code -b $CJ $U/auth/me)" 200
chk "history dengan login"         "$(code -b $CJ $U/history)" 200
chk "role pertama = owner"         "$(curl -s -b $CJ $U/auth/me | grep -o '"role":"[a-z]*"')" '"role":"owner"'
chk "email duplikat ditolak"       "$(code $J -d '{"email":"A@b.co","name":"X","password":"password123"}' $U/auth/register)" 409
chk "register #2 = member"         "$(curl -s $J -d '{"email":"m@b.co","name":"M","password":"password123"}' $U/auth/register | grep -o '"role":"[a-z]*"')" '"role":"member"'
chk "password salah"               "$(code $J -d '{"email":"a@b.co","password":"nope"}' $U/auth/login)" 401
chk "token tidak bocor ke browser" "$(curl -s $J -d '{"email":"a@b.co","password":"password123"}' $U/auth/login | grep -c token)" 0
chk "Origin asing ditolak"         "$(code -H 'Origin: https://evil.com' -b $CJ $U/history)" 403
chk "logout"                       "$(code -b $CJ $J -d '{}' $U/auth/logout)" 200
chk "sesi mati setelah logout"     "$(code -b $CJ $U/history)" 401
# --- plan & kuota (langsung ke pusat) ---
CU=http://127.0.0.1:4555; tk() { grep -o '"token":"[a-f0-9]*"' | cut -d'"' -f4; }
OWN=$(curl -s $J -d '{"email":"a@b.co","password":"password123"}' $CU/login | tk)   # owner
MEM=$(curl -s $J -d '{"email":"m@b.co","password":"password123"}' $CU/login | tk)   # member, plan free
cons() { curl -s -m 5 -o /dev/null -w '%{http_code}' -H "authorization: Bearer $1" $J -d "{\"clips\":$2}" $CU/usage/consume; }
chk "plans publik"                  "$(curl -s $CU/plans | grep -c enterprise)" 1
chk "free: tagih 10 klip"           "$(cons $MEM 10)" 200
chk "free: klip ke-11 ditolak 402"  "$(cons $MEM 1)" 402
chk "refund 1 klip"                 "$(cons $MEM -1)" 200
chk "setelah refund bisa lagi"      "$(cons $MEM 1)" 200
for i in 1 2 3 4 5; do code $J -d '{"email":"a@b.co","password":"x"}' $U/auth/login >/dev/null; done
chk "rate limit login"             "$(code $J -d '{"email":"a@b.co","password":"x"}' $U/auth/login)" 429
rm -rf $T; exit $fail
