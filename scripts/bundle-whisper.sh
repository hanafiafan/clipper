#!/bin/bash
# Flatten whisper-cli + its dylibs into bin/ with @loader_path refs so captions work in the packaged app.
# Run on a Mac that has `brew install whisper-cpp`. Re-run before building the dmg.
set -e
cd "$(dirname "$0")/.."
BIN=bin
WC="$(command -v whisper-cli)"; [ -z "$WC" ] && { echo "whisper-cli not found (brew install whisper-cpp)"; exit 1; }

# Resolve the dylib closure (whisper + ggml), copy real files flat into bin/
libs=$(otool -L "$WC" | awk 'NR>1{print $1}' | grep -iE 'whisper|ggml')
copy(){ local src="$1"; local real; real="$(readlink -f "$src" 2>/dev/null || echo "$src")"; local base; base="$(basename "$src")"; cp -f "$real" "$BIN/$base"; chmod +w "$BIN/$base"; }
cp -f "$WC" "$BIN/whisper-cli"; chmod +w "$BIN/whisper-cli"
# known deps + their own ggml deps
for l in $libs; do
  name="$(basename "$l")"
  # locate the actual file (handles @rpath entries)
  for cand in "$l" "$HOME/.homebrew/lib/$name" "$HOME/.homebrew/opt/ggml/lib/$name"; do
    [ -f "$cand" ] && { copy "$cand"; break; }
  done
done
# pull ggml deps referenced by libwhisper/libggml too
for dl in "$BIN"/libwhisper* "$BIN"/libggml*; do
  [ -f "$dl" ] || continue
  for dep in $(otool -L "$dl" | awk 'NR>1{print $1}' | grep -iE 'ggml'); do
    n="$(basename "$dep")"
    for cand in "$dep" "$HOME/.homebrew/opt/ggml/lib/$n" "$HOME/.homebrew/lib/$n"; do [ -f "$cand" ] && { [ -f "$BIN/$n" ] || copy "$cand"; break; }; done
  done
done

# Rewrite install names + dependency paths to @loader_path (flat, co-located in bin/)
for f in "$BIN"/whisper-cli "$BIN"/libwhisper* "$BIN"/libggml*; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" != whisper-cli ] && install_name_tool -id "@loader_path/$base" "$f" 2>/dev/null || true
  for dep in $(otool -L "$f" | awk 'NR>1{print $1}' | grep -iE 'whisper|ggml'); do
    dn="$(basename "$dep")"
    [ -f "$BIN/$dn" ] && install_name_tool -change "$dep" "@loader_path/$dn" "$f" 2>/dev/null || true
  done
  codesign --force -s - "$f" 2>/dev/null || true   # re-sign (ad-hoc) after edits
done
echo "Bundled into $BIN/:"; ls "$BIN" | grep -iE 'whisper|ggml'
