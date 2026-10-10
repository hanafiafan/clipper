#!/bin/bash
# Build the Windows installer (NSIS, x64) -> release/Hellens Clipper Setup <version>.exe
# Prerequisite: bin/win filled by `npm run bin:win`.
#
# On an Apple Silicon Mac without Rosetta, electron-builder's bundled makensis is x86-only and cannot run
# ("Cannot spawn .../mac/makensis ... -86"). In that case this script assembles an NSIS directory around
# Homebrew's native arm64 makensis (stubs/plugins/includes from the Homebrew package, plus the two files
# electron-builder ships itself: nsisconf.nsh and elevate.exe) and points ELECTRON_BUILDER_NSIS_DIR at it.
# On Windows, Linux, Intel Macs, or Macs with Rosetta this is a plain `electron-builder --win`.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f bin/win/ffmpeg.exe ] || { echo "bin/win is empty - run: npm run bin:win" >&2; exit 1; }
npm run build

if [ "$(uname -s)-$(uname -m)" = "Darwin-arm64" ] && ! arch -x86_64 /usr/bin/true 2>/dev/null; then
  command -v makensis >/dev/null || { echo "Installing makensis (Homebrew)..."; brew install makensis; }
  CACHE="$HOME/Library/Caches/electron-builder/nsis/nsis-3.0.4.1"
  # The first electron-builder run downloads NSIS resources into the cache even though its own makensis fails.
  [ -f "$CACHE/elevate.exe" ] || npx electron-builder --win >/dev/null 2>&1 || true
  [ -f "$CACHE/elevate.exe" ] || { echo "electron-builder NSIS cache missing ($CACHE)" >&2; exit 1; }
  N="$PWD/build/.nsis-arm"; rm -rf "$N"; mkdir -p "$N/mac"
  cp -R "$(brew --prefix makensis)/share/nsis/." "$N/"
  cp "$CACHE/nsisconf.nsh" "$CACHE/elevate.exe" "$N/"
  printf '#!/bin/bash\nexport NSISDIR="%s"\nexec "%s" "$@"\n' "$N" "$(command -v makensis)" > "$N/mac/makensis"
  chmod +x "$N/mac/makensis"
  export ELECTRON_BUILDER_NSIS_DIR="$N"
fi

npx electron-builder --win
