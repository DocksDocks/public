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
STAGING="$(mktemp -d "$DIST/.build-XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

ARTIFACTS=()
for target in "${TARGETS[@]}"; do
  name="docks-kit-$target"
  out="$STAGING/$name"
  ARTIFACTS+=("$name")
  echo "building $DIST/$name (bun-$target)..."
  bun build --compile --minify "--target=bun-$target" \
    "$REPO_DIR/cli/src/main.ts" --outfile "$out"
done

for name in "${ARTIFACTS[@]}"; do
  mv "$STAGING/$name" "$DIST/$name"
done

ALL_ARTIFACTS=()
for path in "$DIST"/docks-kit-*; do
  [[ -f "$path" ]] || continue
  ALL_ARTIFACTS+=("${path##*/}")
done
sorted_artifacts="$(printf '%s\n' "${ALL_ARTIFACTS[@]}" | LC_ALL=C sort)"
SORTED_ARTIFACTS=()
while IFS= read -r name; do
  SORTED_ARTIFACTS+=("$name")
done <<< "$sorted_artifacts"

(
  cd "$DIST"
  sha256sum "${SORTED_ARTIFACTS[@]}" > "$STAGING/SHA256SUMS" 2>/dev/null ||
    shasum -a 256 "${SORTED_ARTIFACTS[@]}" > "$STAGING/SHA256SUMS"
)

rm -f "$DIST/SHA256SUMS"
mv "$STAGING/SHA256SUMS" "$DIST/SHA256SUMS"
echo "done — ${ARTIFACTS[*]} SHA256SUMS"
