#!/bin/bash
# Build a fully self-contained whisper-cli for macOS (arm64) into bin/mac/.
#
# Why not copy the Homebrew one: brew's whisper-cli links libggml/libwhisper dynamically, depends on
# Homebrew's libomp and loads its ggml backends (cpu/blas/metal .so) from the Cellar. On a Mac without
# Homebrew it fails at launch ("Library not loaded: .../libomp.dylib"). This builds it statically with
# the Metal shader library embedded, so it only needs system frameworks.
#
# Usage: bash scripts/build-whisper-mac.sh        (needs git + cmake + Xcode command line tools)
#   WHISPER_TAG=v1.9.2   whisper.cpp release to build
set -euo pipefail
cd "$(dirname "$0")/.."
TAG="${WHISPER_TAG:-v1.9.2}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git clone -q --depth 1 --branch "$TAG" https://github.com/ggml-org/whisper.cpp "$T/src"
cmake -S "$T/src" -B "$T/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF \
  -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >"$T/cmake.log"
cmake --build "$T/build" -j"$(sysctl -n hw.ncpu)" --config Release --target whisper-cli >"$T/build.log"
mkdir -p bin/mac; cp "$T/build/bin/whisper-cli" bin/mac/whisper-cli; chmod +x bin/mac/whisper-cli

# Guard: refuse to ship a binary that points outside the system.
bad="$(otool -L bin/mac/whisper-cli | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)' || true)"
[ -z "$bad" ] || { echo "whisper-cli still depends on non-system libraries:" >&2; echo "$bad" >&2; exit 1; }
echo "ok: bin/mac/whisper-cli ($TAG) depends on system libraries only"
