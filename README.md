# Hellens Clipper

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

Buka http://localhost:3002 dan **daftar**. Pengguna pertama yang mendaftar
otomatis menjadi **owner**; berikutnya **member**. Lalu buka **Pengaturan**
dan isi minimal satu API key AI.

> `npm run dev` (Vite) hanya menyajikan UI tanpa proxy ke API, jadi alur
> login dan pembuatan klip tidak jalan di sana. Pakai `npm run build` lalu
> `node server.js`.

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
- Tabel user: ubah plan (admin+) dan role (owner saja).
- **Audit log**: pendaftaran, ganti password, perubahan plan/role/konten.

### CMS (tab **CMS** di dashboard admin)

Konten yang bisa diubah tanpa deploy, lengkap dengan validasi dan tombol
*Reset default*:

- **Gaya hook** – label, warna latar/teks, rounded (dipilih user di studio).
- **Warna highlight caption** – per preset (karaoke, beasty, simple, impact, clean, boxed).
- **Teks plan** – harga, tagline, fitur di kartu plan.

Bila server pusat tidak terjangkau, app lokal memakai salinan konten terakhir
(atau bawaan) sehingga render tetap jalan.

## C. Aplikasi desktop (Mac/Windows)

Jalankan sebagai jendela app:

```bash
npm install      # sekali, pasang electron
npm run build    # kompilasi UI ke dist/ (wajib sebelum start / dist)
npm start
```

Bikin installer:

```bash
npm run build      # pastikan dist/ (UI) terbaru
npm run dist:mac   # -> release/Hellens Clipper-<versi>-arm64.dmg
npm run dist:win   # -> installer .exe di release/ (lihat catatan Windows)
```

Installer **mem-bundle** ffmpeg + yt-dlp + whisper-cli + model (~200MB), jadi
app jalan tanpa instalasi tambahan. Data (hasil, riwayat) disimpan di folder
userData OS, bukan di dalam app.

**Server pusat tidak ikut terbungkus.** App desktop tetap butuh login, jadi
jalankan `central/server.js` di mesin yang terjangkau dan arahkan app ke sana
lewat `CENTRAL_URL` (default `http://127.0.0.1:4000`).

- **macOS**: `.dmg` yang dites di sini unsigned (ad-hoc). Di Mac lain, buka
  pertama kali dengan klik-kanan → Open (lewati Gatekeeper). Untuk distribusi
  publik: sign + notarize pakai Apple Developer ID.
- **Windows**: config `nsis` sudah ada, tapi `bin/` saat ini berisi binary
  **macOS**. Untuk .exe: taruh ffmpeg.exe + yt-dlp.exe (+ whisper-cli.exe/dll)
  versi Windows di `bin/`, lalu build di Windows (atau CI). Build dari Mac perlu Wine.
- Ikon default dipakai; taruh `build/icon.icns` / `build/icon.ico` untuk ikon sendiri.

Bundle binary disiapkan di `bin/` (ffmpeg-static + yt-dlp standalone). Untuk
caption di app terpaket, ratakan whisper + dylib-nya dulu:

```bash
bash scripts/bundle-whisper.sh   # butuh `brew install whisper-cpp`
```

## Fitur

| Fitur | Keterangan |
|---|---|
| YT Downloader | unduh video penuh (pilih kualitas) atau audio MP3 (endpoint `/download`) |
| Rasio | 9:16 crop/blur, 3:4, 1:1 crop/blur, 16:9, asli |
| Resolusi | 360p–4k (dibatasi plan) |
| Blur bg | motion (ikut video) / statis (frame beku) |
| Face-track zoom | crop fokus ke titik wajah (x/y %, bisa dari AI) |
| Caption | Whisper otomatis; preset karaoke/beasty/simple |
| Karaoke per-kata | highlight kata aktif (file ASS) |
| Hook | badge teks di 3 detik pertama, gaya dari CMS |
| Logo & sticker | overlay PNG/GIF (endpoint `/logos`, `/media`) |
| AI | saran momen: Gemini, OpenAI, Claude, Groq, Mistral, Deepseek |

Catatan: logo, sticker gambar, dan YT downloader masih berupa endpoint server;
belum ada layar di UI baru.

## Dependency

Wajib di PATH:

- **Node.js** 22+
- **ffmpeg** — dengan libass (filter `subtitles`). macOS: `brew install homebrew-ffmpeg/ffmpeg/ffmpeg`
- **yt-dlp** — untuk unduh YouTube. `brew install yt-dlp`
- **whisper-cli** (whisper.cpp) — untuk caption. `brew install whisper-cpp`
  - Model: taruh `ggml-base.bin` di `models/` (atau set `WHISPER_MODEL=/path/model.bin`)

Opsional:

- **Chrome + puppeteer** — hanya untuk badge hook dan sticker teks. Puppeteer
  dicari di `../backend/node_modules`. Tanpa itu, klip tetap dirender **tanpa badge**.
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
- Server pusat belum memakai HTTPS. **Sebelum dipublikasikan**, taruh di
  belakang reverse proxy HTTPS dan ubah alamat bind-nya.

## Pengujian

```bash
bash scripts/auth-check.sh
```

Menjalankan pusat + app lokal di port dan database sementara, lalu menguji
login, role, kuota, refund, batas resolusi, API admin, audit log, CMS, dan rate
limit (45 pemeriksaan). Tidak butuh ffmpeg/yt-dlp/API key AI.

## Batasan

- **Kuota ditegakkan di sisi app lokal.** Pengguna yang mengedit `server.js` di
  komputernya bisa melewati penagihan. Menutupnya butuh langkah analisis AI
  dijalankan di pusat.
- Belum ada pembayaran: plan diubah admin. Belum ada verifikasi email, reset
  password lewat email, SSO, atau menonaktifkan user.
- Riwayat (`history.json`) milik instalasi, bukan akun: semua user di komputer
  yang sama melihat klip yang sama. Penyimpanan JSON naif — aman untuk pemakaian
  lokal ringan.
- Sumber video di `work/` dihapus setelah `WORK_TTL_DAYS`, jadi klip lama tidak
  bisa dirender ulang dari sumbernya.
- Transkrip seluruh video dikirim sekali ke AI; video sangat panjang bisa
  melebihi batas konteks.
- Caption butuh model Whisper yang jelas; untuk audio berisik pakai model lebih besar.
- Mode blur statis & face-track: dimensi tepat untuk semua rasio kecuali "Asli" (nominal).
