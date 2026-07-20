#!/bin/bash
# build-binaries.sh — compile docks-kit into standalone executables
# (bun build --compile embeds the runtime + generated payload + docs topics).
# Usage: bash cli/build-binaries.sh [target ...]   (default: all four)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_DIR/cli/dist"
TARGETS=("$@")
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(linux-x64 linux-arm64 darwin-x64 darwin-arm64)

for target in "${TARGETS[@]}"; do
  case "$target" in
    linux-x64|linux-arm64|darwin-x64|darwin-arm64) ;;
    *)
      echo "unsupported binary target: $target; supported: linux-x64 linux-arm64 darwin-x64 darwin-arm64" >&2
      exit 2
      ;;
  esac
done

bun "$REPO_DIR/cli/scripts/generate-sot-payload.ts" --check
mkdir -p "$DIST"

ARTIFACTS=()
for target in "${TARGETS[@]}"; do
  name="docks-kit-$target"
  out="$DIST/$name"
  ARTIFACTS+=("$name")
  echo "building $out (bun-$target)..."
  bun build --compile --minify "--target=bun-$target" \
    "$REPO_DIR/cli/src/main.ts" --outfile "$out"
done

(cd "$DIST" && sha256sum "${ARTIFACTS[@]}" > SHA256SUMS 2>/dev/null || shasum -a 256 "${ARTIFACTS[@]}" > SHA256SUMS)
echo "done — ${ARTIFACTS[*]} SHA256SUMS"
