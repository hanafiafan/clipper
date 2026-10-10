#!/bin/bash
# Download the Windows (x64) helper binaries into bin/win and verify their SHA-256 checksums:
#   yt-dlp.exe  (latest GitHub release, checked against its SHA2-256SUMS)
#   whisper-cli.exe + DLLs  (whisper.cpp $WHISPER_TAG prebuilt "whisper-bin-x64", checked against the digest GitHub publishes)
#   ffmpeg.exe + DLLs  (BtbN/FFmpeg-Builds GPL "shared" build: has libx264 and libass, both needed; checked against the digest GitHub publishes)
# Usage: bash scripts/fetch-win-binaries.sh      (needs curl, unzip, shasum, python3)
set -euo pipefail
cd "$(dirname "$0")/.."
WHISPER_TAG="${WHISPER_TAG:-v1.9.2}"
FFMPEG_ASSET="${FFMPEG_ASSET:-ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip}"   # BtbN release "latest"
W=bin/win; mkdir -p "$W"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
check() { local got; got="$(shasum -a 256 "$1" | cut -d' ' -f1)"; [ "$got" = "$2" ] || { echo "CHECKSUM MISMATCH for $(basename "$1"): got $got, expected $2" >&2; exit 1; }; echo "ok  sha256 $(basename "$1")"; }

echo "== yt-dlp"
curl -fsSL -o "$T/yt-dlp.exe" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
sum="$(curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS | awk '$2=="yt-dlp.exe"{print $1}')"
check "$T/yt-dlp.exe" "$sum"; cp "$T/yt-dlp.exe" "$W/yt-dlp.exe"

echo "== whisper.cpp $WHISPER_TAG"
curl -fsSL -o "$T/whisper.zip" "https://github.com/ggml-org/whisper.cpp/releases/download/$WHISPER_TAG/whisper-bin-x64.zip"
sum="$(curl -fsSL "https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/$WHISPER_TAG" | python3 -c "
import json,sys
for a in json.load(sys.stdin)['assets']:
    if a['name']=='whisper-bin-x64.zip': print((a.get('digest') or '').split(':')[-1])")"
[ -n "$sum" ] || { echo "GitHub published no digest for whisper-bin-x64.zip" >&2; exit 1; }
check "$T/whisper.zip" "$sum"
unzip -q -o "$T/whisper.zip" -d "$T/whisper"
# the zip nests everything under Release/; flatten whisper-cli.exe + every DLL next to it
find "$T/whisper" -type f \( -name 'whisper-cli.exe' -o -name '*.dll' \) -exec cp {} "$W/" \;

echo "== ffmpeg ($FFMPEG_ASSET)"
curl -fsSL -o "$T/ffmpeg.zip" "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/$FFMPEG_ASSET"
sum="$(curl -fsSL "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest" | FFMPEG_ASSET="$FFMPEG_ASSET" python3 -c "
import json,sys,os
for a in json.load(sys.stdin)['assets']:
    if a['name']==os.environ['FFMPEG_ASSET']: print((a.get('digest') or '').split(':')[-1])")"
[ -n "$sum" ] || { echo "GitHub published no digest for $FFMPEG_ASSET" >&2; exit 1; }
check "$T/ffmpeg.zip" "$sum"
unzip -q -o -j "$T/ffmpeg.zip" '*/bin/ffmpeg.exe' '*/bin/*.dll' -d "$W"      # keep ffmpeg.exe + its DLLs, skip ffplay/ffprobe

echo; ls -l "$W" | awk 'NR>1{printf "%10d  %s\n",$5,$9}'
