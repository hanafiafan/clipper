# Hellens Clipper

Alat pemotong video jadi klip pendek (gaya Opus Clip): potong, ubah rasio,
caption otomatis, logo/sticker, saran momen AI, dan YT downloader. Lokal, tanpa lisensi.

Bisa dijalankan sebagai **server lokal** (zero-dep) atau **aplikasi desktop** (Electron).

## A. Jalan cepat (server)

```bash
node server.js
```

Buka http://localhost:3002 (hanya dari komputer ini).

### ⚡ Auto-pilot (1 link → beberapa short)

Panel **Auto** di paling atas: tempel URL YouTube, pilih format tujuan
(9:16/3:4/1:1/16:9), resolusi, dan gaya caption → klik **Buat shorts**. Sistem
otomatis: unduh → transkripsi (Whisper) → AI cari momen viral → potong,
ubah format, tambah caption bergaya + badge hook. Hasilnya beberapa short
**ber-grade (A–D) + skor + alasan**, diurut terbaik dulu, siap posting.

Butuh **API key AI** — jalankan dengan, misalnya:

```bash
GEMINI_API_KEY=xxxxx node server.js
```

## B. Aplikasi desktop (Mac/Windows)

Jalankan sebagai jendela app:

```bash
npm install      # sekali, pasang electron
npm start
```

Bikin installer:

```bash
npm run dist:mac   # -> dist/Hellens Clipper-<versi>-arm64.dmg
npm run dist:win   # -> installer .exe (lihat catatan Windows)
```

Installer **mem-bundle** ffmpeg + yt-dlp + whisper-cli + model (~200MB), jadi
app jalan tanpa instalasi tambahan. Data (hasil, riwayat) disimpan di folder
userData OS, bukan di dalam app.

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

1. **Sumber**: tempel URL YouTube, atau unggah file video.
2. **Potong**: isi detik mulai/selesai — atau klik **✨ Saran momen AI**
   lalu **Pakai** untuk auto-isi (termasuk titik wajah face-track).
3. **Atur**: format rasio, resolusi, caption, logo, sticker.
4. **Buat klip** → hasil muncul di **Riwayat** (bisa diputar, diunduh, dihapus).

Hasil klip di `out/`, riwayat di `history.json`.

## Fitur

| Fitur | Keterangan |
|---|---|
| YT Downloader | unduh video penuh (pilih kualitas) atau audio MP3 |
| Rasio | 9:16 crop/blur, 3:4, 1:1 crop/blur, 16:9, asli |
| Resolusi | 360p–4k |
| Blur bg | motion (ikut video) / statis (frame beku) |
| Face-track zoom | crop fokus ke titik wajah (x/y %, bisa dari AI) |
| Caption | Whisper otomatis; preset karaoke/beasty/simple |
| Karaoke per-kata | highlight kata aktif (file ASS) |
| Logo | overlay PNG (skala/posisi/opasitas %) |
| Sticker | badge teks rounded + emoji, atau gambar/GIF |
| AI | saran momen: Gemini, OpenAI, Claude, Groq, Mistral, Deepseek |

## Dependency

Wajib di PATH:

- **Node.js** 18+
- **ffmpeg** — dengan libass (filter `subtitles`). macOS: `brew install homebrew-ffmpeg/ffmpeg/ffmpeg`
- **yt-dlp** — untuk unduh YouTube. `brew install yt-dlp`
- **whisper-cli** (whisper.cpp) — untuk caption. `brew install whisper-cpp`
  - Model: taruh `ggml-base.bin` di `models/` (atau set `WHISPER_MODEL=/path/model.bin`)

Opsional:

- **Chrome** — hanya untuk sticker badge teks (rounded + emoji). Dipakai dari
  Google Chrome sistem atau puppeteer di `../backend/node_modules`.
- **API key AI** — hanya untuk saran momen. Set salah satu env var.

## Variabel lingkungan

```bash
GEMINI_API_KEY=...     # atau OPENAI / ANTHROPIC / GROQ / MISTRAL / DEEPSEEK _API_KEY
WHISPER_MODEL=...      # path model whisper (default models/ggml-base.bin)
GROQ_MODEL=...         # override model per provider (opsional)
PORT=3002
```

Contoh dengan AI aktif:

```bash
GEMINI_API_KEY=xxxxx node server.js
```

## Batasan

- Caption butuh model Whisper yang jelas; untuk audio berisik pakai model lebih besar.
- Mode blur statis & face-track: dimensi tepat untuk semua rasio kecuali "Asli" (nominal).
- Sticker badge perlu Chrome; tanpa Chrome, pakai sticker gambar/GIF.
- Penyimpanan riwayat JSON naif — aman untuk satu pengguna lokal.
