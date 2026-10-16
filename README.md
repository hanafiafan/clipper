# Hellens Clipper

[![CI](https://github.com/hanafiafan/clipper/actions/workflows/ci.yml/badge.svg)](https://github.com/hanafiafan/clipper/actions/workflows/ci.yml)

Alat pemotong video jadi klip pendek (gaya Opus Clip): potong, ubah rasio,
caption otomatis, hook, saran momen AI, dan YT downloader. Pemrosesan video
**berjalan lokal di komputer pengguna**; akun, plan, dan pengelolaan
dilakukan lewat **server pusat** kecil (hybrid).

## Arsitektur

```
Browser / Electron ──▶ app lokal (server.js, 127.0.0.1:3002)
                          │  video, transkrip, render: semuanya di komputer ini
                          │  yt-dlp · ffmpeg · whisper-cli · API AI (key milikmu)
                          │
                          └──▶ server pusat (central/server.js, :4000)
                                akun · sesi · role · plan · kuota · audit · CMS
                                (SQLite, tanpa dependency npm)
```

Video tidak pernah dikirim ke server pusat. Pusat hanya tahu siapa penggunanya,
plan-nya, dan berapa klip yang sudah dibuat bulan ini.

## A. Jalan cepat

Butuh **Node.js 22+** (server pusat memakai `node:sqlite`).

```bash
npm install
npm run build      # kompilasi UI (React + Vite) ke dist/
npm run central    # terminal 1: server pusat di http://127.0.0.1:4000
node server.js     # terminal 2: app lokal di http://localhost:3002
```

Buka http://localhost:3002 dan **daftar** (password bisa diganti di **Pengaturan → Akun**). Pengguna pertama yang mendaftar
otomatis menjadi **owner**; berikutnya **member**. Lalu buka **Pengaturan**
dan isi minimal satu API key AI.

> Mengembangkan UI? Jalankan pusat + `node server.js`, lalu `npm run dev`
> (http://localhost:5173, HMR). Semua rute API diteruskan ke app lokal di
> `127.0.0.1:3002`; ubah dengan `KLIP_API=http://127.0.0.1:PORT`.

### ⚡ Auto-pilot (1 link → beberapa short)

Di **Dashboard**: tempel URL YouTube (atau unggah video), pilih rasio
(9:16/3:4/1:1/16:9), resolusi, dan gaya hook, lalu **Create clips with AI**.
Sistem otomatis: unduh → transkripsi (Whisper) → AI cari momen viral → potong,
ubah format, tambah caption karaoke per kata + badge hook. Hasilnya beberapa
short **ber-grade (A–D) + skor + alasan**, diurut terbaik dulu. Semua klip
tersimpan di **History** (putar, unduh, salin caption + hashtag, hapus).

## B. Akun, plan, admin & CMS

### Role

| Role | Hak |
|---|---|
| `owner` | Semua, termasuk mengubah role user lain (tidak bisa mengubah role sendiri) |
| `admin` | Melihat statistik/user/audit, mengubah plan, mengedit CMS |
| `member` | Memakai studio sesuai plan-nya |

### Plan & kuota

Didefinisikan di `central/server.js` (`PLANS`), jadi mengubahnya = edit + deploy.

| Plan | Klip/bulan | Resolusi maks | Klip per proses |
|---|---|---|---|
| Free | 10 | 720p | 3 |
| Pro | 100 | 1080p | 6 |
| Enterprise | tanpa batas | 4k | 6 |

Setiap klip ditagih ke pusat sebelum dirender dan dikembalikan bila render
gagal. Kuota habis → pesan jelas (HTTP 402); klip yang sudah jadi tetap aman.
Pill di header menampilkan pemakaian, dan opsi resolusi di atas plan terkunci.

### Dashboard admin (tombol **Admin** untuk owner/admin)

- Statistik: total user, klip bulan ini, user per plan, pemakaian 6 bulan.
- Tabel user: ubah plan (admin+) dan role (owner saja); **nonaktifkan / aktifkan** akun
  (user langsung keluar dari semua perangkat; owner tidak bisa dinonaktifkan oleh admin).
- **Audit log** (50 baris per halaman, "Muat lebih banyak"): pendaftaran, login, login diblokir,
  ganti password, perubahan plan/role/status/konten.

### CMS (tab **CMS** di dashboard admin)

Konten yang bisa diubah tanpa deploy, lengkap dengan validasi dan tombol
*Reset default*:

- **Gaya hook** – label, warna latar/teks, rounded (dipilih user di studio).
- **Warna highlight caption** – per preset (karaoke, beasty, simple, impact, clean, boxed).
- **Teks plan** – harga, tagline, fitur di kartu plan.

Bila server pusat tidak terjangkau, app lokal memakai salinan konten terakhir
(atau bawaan) sehingga render tetap jalan.

## C. Aplikasi desktop (Mac/Windows)

Aplikasi desktop **tidak punya jendela**: ia berjalan di latar belakang sebagai *backend* (server lokal: unduh, transkripsi,
render) dengan ikon di menu bar (macOS) atau area notifikasi (Windows), dan **membuka tampilannya di browser bawaan**,
langsung ke halaman login (`http://127.0.0.1:3002`). Frontend-nya adalah tab browser itu.

- Menutup tab tidak menghentikan aplikasi. Klik ikon tray untuk **Buka Hellens Clipper**, menyalakan **Jalankan saat login**
  (saat dijalankan otomatis ia tidak membuka browser), atau **Keluar**. Membuka aplikasi lagi dari Finder/Start hanya
  membuka tab baru (hanya satu instance yang berjalan).
- Bila port 3002 dipakai program lain, aplikasi memakai port kosong berikutnya (alamatnya tampil di menu tray).
- Pertama kali dijalankan, muncul satu notifikasi yang menjelaskan di mana ikon aplikasi berada.
- Di macOS ikon menu bar bisa perlu diizinkan di *System Settings → Menu Bar* bila disembunyikan.
- Untuk pengujian otomatis: `KLIP_NO_BROWSER=1` (tidak membuka browser; mencetak diagnostik jumlah jendela dan batas ikon tray).

```bash
npm install      # sekali, pasang electron
npm run build    # kompilasi UI ke dist/ (wajib sebelum start / dist)
npm start        # menjalankan host; browser terbuka ke halaman login
```

Bikin installer (hasil di `release/`):

```bash
# 1. siapkan binary pendamping per platform (sekali; folder bin/ tidak masuk git)
npm run bin:mac    # whisper-cli statis dibangun dari sumber (butuh cmake); lalu taruh ffmpeg + yt-dlp di bin/mac/
npm run bin:win    # unduh ffmpeg.exe, yt-dlp.exe, whisper-cli.exe + DLL ke bin/win/ (checksum diverifikasi)

# 2. bangun
npm run dist:mac   # -> release/Hellens Clipper-<versi>-arm64.dmg
npm run dist:win   # -> release/Hellens Clipper Setup <versi>.exe
```

Installer **mem-bundle** ffmpeg + yt-dlp + whisper-cli + model (~290 MB), jadi app jalan tanpa
instalasi tambahan. Data (hasil, riwayat) disimpan di folder userData OS, bukan di dalam app.

**Server akun tidak ikut terbungkus, tetapi sudah di-host.** Build terpaket otomatis memakai
`https://clipper.hellens.dev/api` (ganti dengan variabel `CENTRAL_URL`); mode pengembangan tetap
`http://127.0.0.1:4000`.

- **macOS**: hanya **Apple Silicon** (binary dibangun di arm64). App ditandatangani *ad-hoc* (bukan Developer ID dan
  belum dinotarisasi), jadi `.dmg` yang diunduh lewat browser **diblokir** macOS saat pertama dibuka ("Apple could not
  verify ... is free of malware"). Di **macOS 15 ke atas klik-kanan → Buka tidak lagi cukup**. Pilih salah satu:
  1. Klik **Done**, buka *System Settings → Privacy & Security*, gulir ke bawah, klik **Open Anyway** pada "Hellens Clipper".
  2. Terminal: `xattr -dr com.apple.quarantine "/Applications/Hellens Clipper.app"`.
  3. Pasang lewat skrip (unduhan `curl` tidak berkarantina, checksum diverifikasi): `curl -fsSL https://clipper.hellens.dev/install.sh | bash`
     (sumbernya `landing/install.sh`).
  Tanpa peringatan sama sekali butuh Apple Developer ID + notarisasi.
- **Windows** (x64, NSIS): belum ditandatangani, jadi SmartScreen akan menampilkan peringatan
  (More info → Run anyway). Dibangun dari Mac Apple Silicon, `ikon dan metadata pada
  Hellens Clipper.exe` memakai bawaan Electron karena Wine x86 tidak bisa jalan di sana; installer
  dan ikon pintasannya tidak terpengaruh. Bangun di Windows/CI untuk hasil penuh. Skrip `dist-win.sh`
  otomatis memakai `makensis` native Homebrew bila Mac tidak punya Rosetta. **Installer belum pernah
  dijalankan di mesin Windows sungguhan**; isinya sudah diperiksa (binary, model, font, asar).
- Badge hook butuh Chrome atau Edge (Edge sudah ada di Windows 10/11); tanpanya klip tetap jadi tanpa badge.
- **Logo & ikon**: sumbernya `brand/logo.svg` (favicon + kotak logo di UI memakai `brand/logo-mark.svg`).
  Setelah mengganti logo, jalankan `npm run icons` untuk membuat ulang `build/icon.png` dan
  `build/icon.icns` (butuh Chrome; `.icns` hanya di macOS).

Bundle binary disiapkan di `bin/` (ffmpeg-static + yt-dlp standalone). Untuk
caption di app terpaket, ratakan whisper + dylib-nya dulu:

```bash
bash scripts/bundle-whisper.sh   # butuh `brew install whisper-cpp`
```

## Unduhan YouTube dan fitur lanjutan

- **Mesin unduh yang menyegarkan diri**: yt-dlp lama dijawab YouTube dengan HTTP 403, jadi aplikasi menyimpan salinan terbarunya di folder data (`bin/`), mengunduhnya dari rilis resmi, memverifikasi `SHA2-256SUMS`, dan tidak pernah menukar binary yang tidak bisa dijalankan. Diperiksa 20 detik setelah dibuka, lalu tiap hari; bila unduhan gagal dengan tanda khas YouTube (403, runtime JS, "sign in") aplikasi memperbarui sekali dan mengulang. Pesan galat dijelaskan dalam bahasa Indonesia.
- **Runtime JavaScript**: yt-dlp memakai Deno (atau Node 22+) untuk tantangan YouTube. `PATH` aplikasi GUI minimal, jadi `lib/ytdlp.js` ikut mencari di `/opt/homebrew/bin`, `~/.deno/bin`, dll. Node bawaan Electron 33 (v20) tidak dihitung karena yt-dlp terbaru menolaknya.
- **Pengaturan → Mesin unduh YouTube**: versi yt-dlp, status runtime, tombol *Perbarui mesin sekarang*, dan **cookies browser** (`--cookies-from-browser`) untuk video yang minta login.
- **Ikon platform** pada setiap rasio (9:16 TikTok/Reels/Shorts, 3:4 feed, 1:1 post, 16:9 YouTube) dan keterangan "cocok untuk".
- **Pratinjau logo dan sticker** berbentuk layar ponsel yang mengikuti rasio terpilih dan memakai geometri yang sama dengan renderer; pratinjau caption di Editor memakai gaya yang sama dengan simulator Auto.
- **Logo brand di Auto**: unggah PNG sekali, atur ukuran/posisi/opasitas, dan semua klip Auto memakainya; ikut tersimpan di preset. Unggahan logo divalidasi sebagai PNG.
- **Bahasa ucapan** (Auto dan Editor): menetapkan bahasa Whisper per proses dan memisahkan cache transkripnya per bahasa.
- Peran `owner` ditampilkan sebagai **Superadmin** (kelola role, plan, user, CMS, pembayaran).

## Pembaruan aplikasi

Setiap salinan yang terpasang memeriksa **rilis terbaru di GitHub** (`hanafiafan/clipper`) beberapa detik setelah dibuka lalu tiap 6 jam:

- **Notifikasi sistem** sekali per versi ("Pembaruan tersedia: Hellens Clipper x.y.z"); klik membuka studio. Menu tray punya **Periksa pembaruan** dan, bila ada versi baru, **Perbarui ke versi x.y.z…**.
- **Popup di studio** menampilkan catatan rilis dengan tombol **Perbarui sekarang**, **Nanti** (diam 6 jam), dan **Lewati versi ini**; sesudah itu pil **⬆ Update** tetap ada di strip atas.
- **Perbarui sekarang** mengunduh installer rilis, memverifikasinya terhadap `SHA256SUMS.txt` (tanpa checksum yang cocok pemasangan dibatalkan), lalu: macOS menukar `/Applications/Hellens Clipper.app` dan membukanya lagi (skrip `lib/updater.js` menunggu aplikasi keluar dulu, dan app lama tetap utuh bila ada yang gagal); Windows menjalankan installer-nya. Data (riwayat, API key, preset) ada di luar aplikasi dan tidak tersentuh.
- Bila aplikasi berjalan dari folder yang tidak bisa ditulis, atau rilisnya tidak punya installer untuk platform itu, popup menawarkan tautan ke halaman rilis.

**Merilis versi baru**: naikkan `version` di `package.json`, commit dan push, `npm run dist:mac`, lalu `bash scripts/publish-release.sh "catatan rilis"` (butuh `gh`). Skrip mengunggah installer dengan nama baku (`Hellens-Clipper-macOS-arm64.dmg`, `Hellens-Clipper-Windows-x64-Setup.exe`) plus `SHA256SUMS.txt`, nama yang sama dipakai tombol unduh di landing dan `install.sh`. Versi 1.0.2 atau yang lebih lama belum punya pemeriksa ini, jadi sekali saja perlu dipasang manual.
Variabel uji: `UPDATE_REPO`, `UPDATE_FEED` (URL JSON "latest release" lain).

## Pembayaran DOKU

Plan berbayar dibeli lewat **DOKU Checkout** (halaman pembayaran DOKU: QRIS, virtual account, e-wallet, kartu). Harga ada di `PLANS` (`central/server.js`):

| Plan | Bulanan (30 hari) | Tahunan (365 hari, hemat 2 bulan) |
|---|---|---|
| Pro | Rp 49.000 | Rp 490.000 |
| Enterprise | Rp 499.000 | Rp 4.990.000 |

Alur: halaman **Akun** di aplikasi → *Beli/Perpanjang* → pusat membuat pesanan dan memanggil `POST /checkout/v1/payment` (ditandatangani HMAC-SHA256) → browser dibuka ke halaman DOKU → setelah bayar DOKU mengirim **HTTP Notification** ke `…/billing/doku/notify` → pusat memverifikasi tanda tangan (Request-Target = path URL notifikasi), mencocokkan nominal, lalu mengaktifkan plan dan `plan_until`. Halaman `…/billing/return` menampilkan status dan tombol *Kembali ke aplikasi*.

- Perpanjang plan yang sama menambah masa berlaku dari `plan_until`; membeli plan lebih tinggi mulai dari sekarang (sisa masa plan lama tidak dikreditkan). Plan yang lewat `plan_until` otomatis kembali ke Free saat akun dibaca berikutnya (audit `plan.expired`). Plan yang diatur admin/CLI tidak punya masa berlaku.
- Notifikasi bersifat idempoten (kirim ulang tidak menambah waktu), nominal harus sama dengan pesanan, dan bila *Check Status API* DOKU aktif di akunmu, statusnya dicocokkan juga. Pesanan terbuka yang sama dipakai ulang selama 45 menit; maks. 8 pesanan per jam per akun.
- Admin melihat pesanan dan pendapatan di tab **Pembayaran**; semua kejadian (`billing.*`) masuk audit log.

**Mengaktifkan** (di VPS, `/opt/clipper-central/.env`, `chmod 600`, jangan di-commit):

```
DOKU_CLIENT_ID=MCH-xxxx-xxxxxxxxxx     # DOKU Back Office → Integration → API Keys
DOKU_SECRET_KEY=SK-xxxxxxxxxxxxxxxx
DOKU_ENV=sandbox                       # ganti production setelah uji bayar sandbox berhasil
```

Lalu `bash scripts/deploy-central.sh`. `PUBLIC_URL` dan `DOKU_NOTIFY_URL` sudah diatur di `deploy/central/docker-compose.yml` (notifikasi dikirim sebagai `override_notification_url` per pesanan; bila DOKU menolak field itu di akunmu, hapus `DOKU_NOTIFY_URL` dan isi *Notification URL* `https://clipper.hellens.dev/api/billing/doku/notify` di Back Office). Tanpa kredensial, tombol beli tidak muncul dan `POST /billing/checkout` menjawab 503. Uji: `node --test test/billing.test.js` (DOKU tiruan yang menghitung ulang tanda tangan secara independen). Alur sungguhan di sandbox DOKU belum diuji dari sini karena butuh kredensial akunmu.

## Landing page

`landing/` berisi situs pemasaran statis (HTML + CSS + sedikit JavaScript, tanpa build). Strukturnya mengikuti template
"Onward summit" (nav, hero dengan medan simbol yang condong ke pointer dan beriak saat diklik, bagian berjudul
"Tentang ...", daftar langkah yang bisa difilter, FAQ, band penutup, wordmark raksasa di footer) dengan tema aplikasi
(gelap, oranye logo, Inter). Tanpa JavaScript halaman tetap terbaca; `prefers-reduced-motion` mematikan animasi hero. Buka `landing/index.html` langsung, atau layani folder itu dengan server statis mana
pun (`cd landing && python3 -m http.server`).

**Live:** https://clipper.hellens.dev (VPS `vps-run`: container `clipper-landing` = nginx di belakang Traefik/Coolify,
sertifikat Let's Encrypt otomatis, DNS A `clipper` → IP VPS di Cloudflare mode *Proxied*).

```bash
bash scripts/deploy-landing.sh                    # unggah landing/ ke /opt/clipper-landing di vps-run dan restart container
```

Berkas deploy server ada di `deploy/landing/` (`docker-compose.yml` dengan label Traefik, `nginx.conf` dengan header
keamanan dan cache aset).

Tombol unduh menunjuk ke berkas rilis GitHub (`releases/latest/download/Hellens-Clipper-macOS-arm64.dmg` dan
`Hellens-Clipper-Windows-x64-Setup.exe`). Saat merilis versi baru, unggah berkas dengan nama yang sama agar tautan
tetap berlaku (lihat rilis v1.0.0 untuk contoh). Yang masih perlu diisi: harga plan. Tangkapan layar di `landing/assets/` diambil dari aplikasi asli (data dashboard admin adalah contoh).

## Fitur

| Fitur | Keterangan |
|---|---|
| YT Downloader | halaman **Downloader**: unduh video penuh (pilih kualitas) atau audio MP3 |
| Rasio | 9:16 crop/blur, 3:4, 1:1 crop/blur, 16:9, asli |
| Resolusi | 360p–4k (dibatasi plan) |
| Blur bg | motion (ikut video) / statis (frame beku) |
| Face-track zoom | crop fokus ke titik wajah (x/y %, bisa dari AI) |
| Caption | Whisper otomatis; preset karaoke/beasty/simple |
| Karaoke per-kata | highlight kata aktif (file ASS) |
| Hook | badge teks di 3 detik pertama, gaya dari CMS |
| Tinjau sebelum render | centang **Tinjau momen sebelum render**: AI berhenti setelah memilih momen, kamu atur potongan (timeline + angka + tombol ◂ posisi / posisi ▸), judul, dan hook, lalu hanya klip terpilih yang dirender dan ditagih ke kuota |
| Antrean | tempel beberapa link (satu per baris); diproses satu per satu (`MAX_JOBS`, default 1) dengan tahap, progres, waktu berjalan, dan tombol **Batal** yang menghentikan ffmpeg/yt-dlp |
| Preset | simpan kombinasi rasio, caption, hook, dan resolusi sekali klik (`presets.json`), plus 5 preset bawaan; pengaturan terakhir diingat |
| Riwayat | cari, filter grade, favorit ★, urutkan, pilih banyak untuk **ZIP** (klip + caption + .srt) atau hapus massal |
| Editor manual | timeline trim di bawah pratinjau, terhubung ke kolom Mulai/Selesai dan saran AI |
| Logo & sticker | overlay PNG/GIF (endpoint `/logos`, `/media`) |
| AI | saran momen: Gemini, OpenAI, Claude, Groq, Mistral, Deepseek |

Catatan: logo dan sticker gambar masih berupa endpoint server (`/logos`, `/media`);
belum ada layar di UI baru.

## Dependency

Wajib di PATH:

- **Node.js** 22+
- **ffmpeg** — dengan libass (filter `subtitles`). macOS: `brew install homebrew-ffmpeg/ffmpeg/ffmpeg`
- **yt-dlp** — untuk unduh YouTube. `brew install yt-dlp`
- **whisper-cli** (whisper.cpp) — untuk caption. `brew install whisper-cpp`
  - Model: taruh `ggml-base.bin` di `models/` (atau set `WHISPER_MODEL=/path/model.bin`)

Opsional:

- **Google Chrome / Chromium** — hanya untuk badge hook dan sticker teks (dirender lewat
  `puppeteer-core`, sudah termasuk di `npm install`). Dicari di lokasi umum macOS/Linux;
  set `PUPPETEER_EXECUTABLE_PATH` bila lokasinya lain. Tanpa Chrome, klip tetap dirender **tanpa badge**.
- **API key AI** — diisi lewat halaman **Pengaturan** (disimpan di `keys.json`,
  izin 0600) atau lewat environment variable.

## Variabel lingkungan

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3002` | port app lokal (pusat: `PORT`, default `4000`) |
| `CENTRAL_URL` | `http://127.0.0.1:4000` | alamat server pusat, dibaca app lokal |
| `CENTRAL_DB` | `central/central.db` | file SQLite server pusat |
| `KLIP_DATA` | folder proyek | lokasi `work/`, `out/`, `history.json`, `keys.json` |
| `GEMINI_API_KEY` … | – | atau `OPENAI` / `ANTHROPIC` / `GROQ` / `MISTRAL` / `DEEPSEEK` `_API_KEY` |
| `<PROVIDER>_MODEL` | model bawaan | ganti model, mis. `CLAUDE_MODEL`, `GROQ_MODEL` |
| `WHISPER_MODEL` | `models/ggml-base.bin` | path model whisper |
| `WHISPER_LANGUAGE` | `auto` | mis. `id` untuk video berbahasa Indonesia (lebih akurat) |
| `WORK_TTL_DAYS` | `7` | file di `work/` lebih tua dari ini dihapus otomatis tiap jam |
| `MAX_UPLOAD_MB` | `2048` | batas ukuran unggahan video |

## Keamanan

- Server hanya mendengarkan `127.0.0.1` dan menolak request dengan `Host` atau
  `Origin` non-localhost (anti-CSRF / DNS rebinding).
- Sesi disimpan di cookie `httpOnly` + `SameSite=Strict`; token tidak pernah
  sampai ke JavaScript halaman. Password di-hash scrypt, token sesi disimpan
  sebagai SHA-256, login dibatasi 5 percobaan / 15 menit.
- Peran dicek di **server pusat**, bukan hanya di UI.
- Server akun produksi berjalan di belakang HTTPS (lihat bagian di bawah). Pengerasannya: pengguna pertama **tidak**
  otomatis jadi owner (`NO_AUTO_OWNER=1`), batas login dihitung per IP klien asli (`TRUST_PROXY=1`), pendaftaran dibatasi
  10 akun/jam/IP, dan setiap respons `no-store`.

## Server akun di produksi

`deploy/central/` + `scripts/deploy-central.sh` menjalankan `central/` di VPS (container `node:22-alpine` di belakang
Traefik/Coolify) di `https://clipper.hellens.dev/api` (Traefik membuang awalan `/api`). Basis data SQLite ada di
`/var/lib/clipper-central` dan **tidak disentuh** oleh deploy ulang.

```bash
bash scripts/deploy-central.sh      # unggah, buat ulang container, pasang cron backup 03:15 (14 salinan), cek health
curl https://clipper.hellens.dev/api/health
```

**Menjadikan dirimu owner (sekali):** daftar lewat aplikasi, lalu di server:
```bash
ssh vps-run docker exec clipper-central node cli.js promote emailmu@contoh.com owner
ssh vps-run docker exec clipper-central node cli.js list          # daftar user, role, plan
ssh vps-run docker exec clipper-central node cli.js plan user@contoh.com pro
```
Backup manual: `ssh vps-run docker exec clipper-central node /app/backup.js /data/backups`.
Belum ada verifikasi email: siapa pun bisa mendaftar dengan email apa saja (plan Free), jadi jangan beri hak tinggi
tanpa memeriksa orangnya.

## Pengujian

**CI otomatis** (`.github/workflows/ci.yml`) berjalan di setiap push ke `main` dan setiap pull request: sintaks semua
server/skrip, integritas landing page (`scripts/check-landing.js`), build UI, `npm test`, dan `npm audit` untuk dependency
produksi. Tidak butuh API key, ffmpeg, yt-dlp, atau Whisper, jadi **render video dan transkripsi tidak diuji di CI**; itu
tetap diperiksa manual (render satu klip bercaption + hook di Mac dan Windows sebelum tiap rilis).


```bash
npm test                       # tes unit + smoke test akun (di bawah)
node --test test/*.test.js     # hanya tes unit (transkrip, dedupe klip, pengerasan server akun)
bash scripts/auth-check.sh     # hanya smoke test akun
```

`auth-check.sh` menjalankan pusat + app lokal di port dan database sementara, lalu
menguji login, role, kuota, refund, batas resolusi, API admin, nonaktifkan user,
ganti password, audit log (termasuk paginasi), CMS, dan rate limit (63 pemeriksaan).
Tidak butuh ffmpeg/yt-dlp/API key AI.

## Batasan

- **Kuota ditegakkan di sisi app lokal.** Pengguna yang mengedit `server.js` di
  komputernya bisa melewati penagihan. Menutupnya butuh langkah analisis AI
  dijalankan di pusat.
- Pembayaran DOKU bersifat prabayar tanpa tagihan otomatis (lihat bagian *Pembayaran DOKU*); belum ada refund otomatis, kupon, atau invoice PDF. Belum ada verifikasi email, reset
  password lewat email, atau SSO.
- Riwayat (`history.json`) milik instalasi, bukan akun: semua user di komputer
  yang sama melihat klip yang sama. Penyimpanan JSON naif — aman untuk pemakaian
  lokal ringan.
- Sumber video di `work/` dihapus setelah `WORK_TTL_DAYS`, jadi klip lama tidak
  bisa dirender ulang dari sumbernya.
- Video panjang dianalisis per bagian (~40 ribu karakter) lalu digabung; bagian-bagian
  itu memakai beberapa panggilan AI, jadi biayanya naik sebanding panjang video.
- Caption butuh model Whisper yang jelas; untuk audio berisik pakai model lebih besar.
- Mode blur statis & face-track: dimensi tepat untuk semua rasio kecuali "Asli" (nominal).
