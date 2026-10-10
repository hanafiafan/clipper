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
chk "member bukan admin"            "$(code -H "authorization: Bearer $MEM" $J -d '{"userId":2,"plan":"pro"}' $CU/admin/plan)" 403
chk "owner ubah plan jadi pro"      "$(code -H "authorization: Bearer $OWN" $J -d '{"userId":2,"plan":"pro"}' $CU/admin/plan)" 200
chk "pro: kuota lanjut"             "$(cons $MEM 5)" 200
chk "plan tidak dikenal ditolak"    "$(code -H "authorization: Bearer $OWN" $J -d '{"userId":2,"plan":"gratis"}' $CU/admin/plan)" 400
curl -s $J -d '{"email":"m@b.co","password":"password123"}' $U/auth/login -c $CJ >/dev/null
chk "pro: 1080p boleh (lolos cek plan)" "$(code -b $CJ $J -d '{"id":"aaaaaaaaaaaa","start":0,"end":5,"resolution":"1080p"}' $U/clip | grep -c 403)" 0
chk "pro: 4k ditolak"               "$(code -b $CJ $J -d '{"id":"aaaaaaaaaaaa","start":0,"end":5,"resolution":"4k"}' $U/clip)" 403
# --- admin dashboard (lewat proxy lokal, seperti UI) ---
OJ=$T/ojar; curl -s -c $OJ $J -d '{"email":"a@b.co","password":"password123"}' $U/auth/login >/dev/null
chk "member ditolak area admin"     "$(code -b $CJ $U/auth/admin/users)" 403
chk "owner lihat daftar user"       "$(curl -s -b $OJ $U/auth/admin/users | grep -o '"email"' | wc -l | tr -d ' ')" 2
chk "stats: 2 user"                 "$(curl -s -b $OJ $U/auth/admin/stats | grep -o '"users":2')" '"users":2'
chk "owner jadikan member admin"    "$(code -b $OJ $J -d '{"userId":2,"role":"admin"}' $U/auth/admin/role)" 200
curl -s -c $CJ $J -d '{"email":"m@b.co","password":"password123"}' $U/auth/login >/dev/null
chk "admin boleh lihat user"        "$(code -b $CJ $U/auth/admin/users)" 200
chk "admin boleh ubah plan"         "$(code -b $CJ $J -d '{"userId":2,"plan":"enterprise"}' $U/auth/admin/plan)" 200
chk "admin tak boleh ubah role"     "$(code -b $CJ $J -d '{"userId":1,"role":"member"}' $U/auth/admin/role)" 403
chk "owner tak bisa ubah role sendiri" "$(code -b $OJ $J -d '{"userId":1,"role":"member"}' $U/auth/admin/role)" 400
chk "role tidak dikenal ditolak"    "$(code -b $OJ $J -d '{"userId":2,"role":"god"}' $U/auth/admin/role)" 400
chk "audit mencatat perubahan"      "$(curl -s -b $OJ $U/auth/admin/audit | grep -c 'admin.role')" 1
# --- CMS ---
MJ=$T/mjar; curl -s -c $MJ $J -d '{"email":"x@b.co","name":"X","password":"password123"}' $U/auth/register >/dev/null
HS='{"key":"hook_styles","value":{"neon":{"label":"Neon","bg":"#00FFAA","color":"#000000","rounded":true}}}'
chk "konten default terbaca"        "$(curl -s $U/auth/content | grep -c punch)" 1
chk "member ditolak edit konten"    "$(code -b $MJ $J -d "$HS" $U/auth/admin/content)" 403
chk "warna tidak valid ditolak"     "$(code -b $OJ $J -d '{"key":"hook_styles","value":{"x":{"bg":"merah","color":"#000000"}}}' $U/auth/admin/content)" 400
chk "konten tidak dikenal ditolak"  "$(code -b $OJ $J -d '{"key":"lain","value":{}}' $U/auth/admin/content)" 400
chk "admin simpan gaya hook"        "$(code -b $OJ $J -d "$HS" $U/auth/admin/content)" 200
chk "perubahan terbaca user"        "$(curl -s $U/auth/content | grep -c neon)" 1
chk "reset ke default"              "$(code -b $OJ $J -d '{"key":"hook_styles","value":null}' $U/auth/admin/content)" 200
chk "default kembali"               "$(curl -s $U/auth/content | grep -c neon)" 0
chk "audit mencatat konten"         "$(curl -s -b $OJ $U/auth/admin/audit | grep -c 'admin.content')" 1
# --- manajemen akun: nonaktifkan, ganti password, audit ---
ST() { echo "{\"userId\":$1,\"disabled\":$2}"; }
chk "owner nonaktifkan member"      "$(code -b $OJ $J -d "$(ST 3 true)" $U/auth/admin/user-status)" 200
chk "sesi member langsung mati"     "$(code -b $MJ $U/history)" 401
chk "login akun nonaktif ditolak"   "$(code $J -d '{"email":"x@b.co","password":"password123"}' $U/auth/login)" 403
chk "password salah tetap 401"      "$(code $J -d '{"email":"x@b.co","password":"salah"}' $U/auth/login)" 401
chk "admin tak boleh nonaktifkan owner" "$(code -b $CJ $J -d "$(ST 1 true)" $U/auth/admin/user-status)" 403
chk "tak bisa nonaktifkan diri sendiri" "$(code -b $OJ $J -d "$(ST 1 true)" $U/auth/admin/user-status)" 400
chk "owner aktifkan kembali"        "$(code -b $OJ $J -d "$(ST 3 false)" $U/auth/admin/user-status)" 200
chk "login setelah diaktifkan"      "$(code -c $MJ $J -d '{"email":"x@b.co","password":"password123"}' $U/auth/login)" 200
chk "ganti password: current salah" "$(code -b $MJ $J -d '{"current":"salah","next":"passwordbaru1"}' $U/auth/password)" 401
chk "ganti password: terlalu pendek" "$(code -b $MJ $J -d '{"current":"password123","next":"pendek"}' $U/auth/password)" 400
chk "ganti password berhasil"       "$(code -b $MJ -c $MJ $J -d '{"current":"password123","next":"passwordbaru1"}' $U/auth/password)" 200
chk "sesi tetap valid setelah ganti" "$(code -b $MJ $U/history)" 200
chk "password lama tak berlaku"     "$(code $J -d '{"email":"x@b.co","password":"password123"}' $U/auth/login)" 401
chk "password baru berlaku"         "$(code $J -d '{"email":"x@b.co","password":"passwordbaru1"}' $U/auth/login)" 200
chk "audit mencatat nonaktifkan"    "$(curl -s -b $OJ $U/auth/admin/audit | grep -c admin.disable)" 1
chk "audit mencatat login sukses"   "$(curl -s -b $OJ $U/auth/admin/audit | grep -c user.login)" 1
chk "audit punya penanda 'more'"    "$(curl -s -b $OJ $U/auth/admin/audit | grep -c '"more":')" 1
chk "audit paginasi (?before=2)"    "$(curl -s -b $OJ "$U/auth/admin/audit?before=2" | grep -c '"id":2,')" 0
# --- studio (UI asli di balik login) ---
chk "studio tanpa login dialihkan ke /"  "$(curl -s -m 5 -o /dev/null -w '%{http_code} %{redirect_url}' $U/studio)" "302 $U/"
chk "account.js publik"             "$(curl -s -m 5 -o /dev/null -w '%{http_code} %{content_type}' $U/studio/account.js | cut -d';' -f1)" "200 text/javascript"
chk "dashboard.js publik"           "$(curl -s -m 5 -o /dev/null -w '%{http_code} %{content_type}' $U/studio/dashboard.js | cut -d';' -f1)" "200 text/javascript"
chk "studio dengan login"           "$(code -b $OJ $U/studio)" 200
chk "studio memuat account.js"      "$(curl -s -b $OJ $U/studio | grep -c 'studio/account.js')" 1
chk "studio memuat UI asli (editor)" "$(curl -s -b $OJ $U/studio | grep -c 'id=view-editor')" 1
chk "studio tidak di-cache"         "$(curl -s -b $OJ -D - -o /dev/null $U/studio | grep -ci 'cache-control: no-store')" 1
for i in 1 2 3 4 5; do code $J -d '{"email":"a@b.co","password":"x"}' $U/auth/login >/dev/null; done
chk "rate limit login"             "$(code $J -d '{"email":"a@b.co","password":"x"}' $U/auth/login)" 429
rm -rf $T; exit $fail
