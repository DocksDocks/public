#!/bin/bash
# build-binaries.sh — compile docks-kit into standalone executables
# (bun build --compile embeds the runtime + the bundled docs topics).
# Usage: bash cli/build-binaries.sh [target ...]   (default: all five)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_DIR/cli/dist"
bun "$REPO_DIR/cli/scripts/generate-sot-payload.ts" --check
mkdir -p "$DIST"

TARGETS=("$@")
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64)

for target in "${TARGETS[@]}"; do
  out="$DIST/docks-kit-$target"
  [[ "$target" == windows-* ]] && out="$out.exe"
  echo "building $out (bun-$target)..."
  bun build --compile --minify "--target=bun-$target" \
    "$REPO_DIR/cli/src/main.ts" --outfile "$out"
done

(cd "$DIST" && sha256sum docks-kit-* > SHA256SUMS 2>/dev/null || shasum -a 256 docks-kit-* > SHA256SUMS)
echo "done — $(ls "$DIST" | tr '\n' ' ')"
