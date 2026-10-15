#!/bin/bash
# Publish the installers in release/ as a GitHub release, under the file names the landing page, install.sh and the in-app updater expect.
# Installed apps check the latest release and offer the update (notification + popup in the studio), so this is what "ships" a version.
#   1. bump "version" in package.json, commit, push (the release tag points at the pushed commit)
#   2. npm run dist:mac   (and npm run dist:win if you can)
#   3. bash scripts/publish-release.sh "Catatan rilis singkat, satu baris per perubahan"
# Needs the GitHub CLI (gh) logged in. Only files that exist are uploaded; SHA256SUMS.txt is generated from exactly what is uploaded.
set -euo pipefail; cd "$(dirname "$0")/.."
V="$(node -p "require('./package.json').version")"; TAG="v$V"; NOTES="${1:-Hellens Clipper $V}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
[ -f "release/Hellens Clipper-$V-arm64.dmg" ]    && cp "release/Hellens Clipper-$V-arm64.dmg"    "$STAGE/Hellens-Clipper-macOS-arm64.dmg"
[ -f "release/Hellens Clipper Setup $V.exe" ]    && cp "release/Hellens Clipper Setup $V.exe"    "$STAGE/Hellens-Clipper-Windows-x64-Setup.exe"
[ -n "$(ls -A "$STAGE")" ] || { echo "Tidak ada installer $V di release/. Jalankan npm run dist:mac (atau dist:win) dulu." >&2; exit 1; }
(cd "$STAGE" && shasum -a 256 Hellens-Clipper-* > SHA256SUMS.txt && cat SHA256SUMS.txt)
git diff --quiet HEAD -- package.json || { echo "package.json belum di-commit; commit dan push dulu supaya tag $TAG menunjuk kode yang benar." >&2; exit 1; }
gh release create "$TAG" "$STAGE"/* --title "Hellens Clipper $V" --notes "$NOTES" --latest
echo "Rilis $TAG terbit. Aplikasi terpasang akan menawarkan pembaruan dalam beberapa jam (cek tiap 6 jam, atau lewat menu tray: Periksa pembaruan)."
