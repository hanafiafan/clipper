#!/bin/bash
# Hellens Clipper installer for macOS (Apple Silicon).
#   curl -fsSL https://clipper.hellens.dev/install.sh | bash
#
# Why this exists: the app is not notarized by Apple, so a .dmg downloaded in a browser is quarantined and macOS
# refuses to open it ("Apple could not verify ... is free of malware"). Files fetched with curl are not quarantined,
# so this script downloads the same release file, verifies its SHA-256 against the checksum published in the release,
# and installs it. Read it first if you like: it is short and only touches /Applications/Hellens Clipper.app.
# Environment (for testing): INSTALL_DIR (default /Applications), NO_OPEN=1 (do not launch afterwards).
set -euo pipefail

REPO="hanafiafan/clipper"; BASE="https://github.com/$REPO/releases/latest/download"
FILE="Hellens-Clipper-macOS-arm64.dmg"; APP="Hellens Clipper.app"; DEST="${INSTALL_DIR:-/Applications}"

[ "$(uname -s)" = "Darwin" ] || { echo "Skrip ini hanya untuk macOS." >&2; exit 1; }
[ "$(uname -m)" = "arm64" ]  || { echo "Saat ini hanya Mac Apple Silicon (M1 dan yang lebih baru) yang didukung." >&2; exit 1; }

TMP="$(mktemp -d)"; MNT="$TMP/mnt"; mkdir -p "$MNT"
cleanup() { hdiutil detach "$MNT" -quiet 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== Mengunduh $FILE"
curl -fL --progress-bar -o "$TMP/$FILE" "$BASE/$FILE"

echo "== Memverifikasi checksum"
EXPECT="$(curl -fsSL "$BASE/SHA256SUMS.txt" | awk -v f="$FILE" '$2==f{print $1}')"
GOT="$(shasum -a 256 "$TMP/$FILE" | awk '{print $1}')"
[ -n "$EXPECT" ] && [ "$EXPECT" = "$GOT" ] || { echo "Checksum tidak cocok. Pemasangan dibatalkan." >&2; exit 1; }

echo "== Memasang ke $DEST"
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$TMP/$FILE" >/dev/null 2>&1 || { echo "Gagal membuka berkas DMG." >&2; exit 1; }
pkill -x "Hellens Clipper" 2>/dev/null || true       # tutup versi lama yang sedang berjalan
mkdir -p "$DEST"; rm -rf "$DEST/$APP"
ditto "$MNT/$APP" "$DEST/$APP"                        # ditto menyalin segel kode dan atribut apa adanya
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "Selesai: $DEST/$APP"
[ "${NO_OPEN:-}" = "1" ] || open "$DEST/$APP"
