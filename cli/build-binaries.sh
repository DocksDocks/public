#!/bin/bash
# build-binaries.sh — compile docks-kit into standalone executables
# (bun build --compile embeds the runtime + generated payload + docs topics).
# Usage: bash cli/build-binaries.sh [--prune] [target ...]   (default: all six)
#   --prune also discards binaries whose version cannot be established.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$REPO_DIR/cli/dist"
PRUNE_UNKNOWN=0
TARGETS=()
for arg in "$@"; do
  if [[ "$arg" == "--prune" ]]; then
    PRUNE_UNKNOWN=1
  else
    TARGETS+=("$arg")
  fi
done
[[ ${#TARGETS[@]} -gt 0 ]] || TARGETS=(linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64 windows-arm64)

for target in "${TARGETS[@]}"; do
  case "$target" in
    linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64|windows-arm64) ;;
    *)
      echo "unsupported binary target: $target; supported: linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64 windows-arm64" >&2
      exit 2
      ;;
  esac
done

bun "$REPO_DIR/cli/scripts/generate-sot-payload.ts" --check
mkdir -p "$DIST"

# The version is advisory here: it stamps the dist and flags retained binaries
# that this run did not build. A checkout without a readable package.json can
# still compile, so an unreadable version degrades to no stamp and no warning.
CHECKOUT_VERSION=""
if [[ -r "$REPO_DIR/package.json" ]]; then
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*\"version\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
      CHECKOUT_VERSION="${BASH_REMATCH[1]}"
      break
    fi
  done < "$REPO_DIR/package.json"
fi

ALL_TARGETS=(linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64 windows-arm64)
artifact_name() {
  if [[ "$1" == windows-* ]]; then
    printf 'docks-kit-%s.exe' "$1"
  else
    printf 'docks-kit-%s' "$1"
  fi
}

STAMP="$DIST/VERSION"
STAMPED=""
if [[ -f "$STAMP" ]]; then
  STAMPED="$(cat "$STAMP")"
fi

# A stamp naming a different version proves every artifact beside it is wrong:
# a launcher refuses to run one, and keeping it makes SHA256SUMS span two
# versions. Discard those, because their provenance is known and known-stale.
# An absent stamp means unknown provenance, which may be a hand-built or
# downloaded recovery binary, so keep it unless --prune says otherwise. On a
# host without Bun a compiled binary is the only remaining way to run the CLI,
# which is why nothing here removes a binary the stamp vouches for.
if [[ -n "$CHECKOUT_VERSION" && "$STAMPED" != "$CHECKOUT_VERSION" ]]; then
  if [[ -n "$STAMPED" || "$PRUNE_UNKNOWN" -eq 1 ]]; then
    for target in "${ALL_TARGETS[@]}"; do
      stale="$DIST/$(artifact_name "$target")"
      if [[ -e "$stale" ]]; then
        echo "discarding ${stale##*/} from ${STAMPED:-an unrecorded version}; this build is $CHECKOUT_VERSION" >&2
        rm -f "$stale"
      fi
    done
    rm -f "$DIST/SHA256SUMS" "$STAMP"
    STAMPED=""
  fi
fi
STAGING="$(mktemp -d "$DIST/.build-XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT

ARTIFACTS=()
for target in "${TARGETS[@]}"; do
  name="docks-kit-$target"
  [[ "$target" == windows-* ]] && name="$name.exe"
  out="$STAGING/$name"
  ARTIFACTS+=("$name")
  echo "building $DIST/$name (bun-$target)..."
  bun build --compile --minify "--target=bun-$target" \
    "$REPO_DIR/cli/src/main.ts" --outfile "$out"
done

for name in "${ARTIFACTS[@]}"; do
  mv "$STAGING/$name" "$DIST/$name"
done

# Enumerate the known artifact names instead of globbing `docks-kit-*`, so an
# unrelated file such as a packed `docks-kit-<version>.tgz` can never be
# checksummed as though it were a release binary.
ALL_ARTIFACTS=()
for target in "${ALL_TARGETS[@]}"; do
  name="$(artifact_name "$target")"
  if [[ -f "$DIST/$name" ]]; then
    ALL_ARTIFACTS+=("$name")
  fi
done

# Retained binaries this run did not rebuild. They are still checksummed,
# because SHA256SUMS describes what is on disk. They are coherent only when
# the stamp already records the version now being built; otherwise the
# manifest spans more than one version and is not a release set.
RETAINED=()
for name in "${ALL_ARTIFACTS[@]}"; do
  if [[ " ${ARTIFACTS[*]} " != *" $name "* ]]; then
    RETAINED+=("$name")
  fi
done
DIST_COHERENT=1
if [[ ${#RETAINED[@]} -gt 0 && "$STAMPED" != "$CHECKOUT_VERSION" ]]; then
  DIST_COHERENT=0
  echo "warning: retained without rebuild: ${RETAINED[*]} (dist stamp: ${STAMPED:-none}; this build: ${CHECKOUT_VERSION:-unknown})." >&2
  echo "warning: SHA256SUMS now spans more than one version; rebuild every target for a release set." >&2
fi
if [[ ${#ALL_ARTIFACTS[@]} -eq 0 ]]; then
  echo "no docks-kit binaries in $DIST to checksum" >&2
  exit 1
fi
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
# Stamp only a coherent dist. Stamping a mixed set would certify it as one
# version and silence the warning above on every later build.
if [[ -n "$CHECKOUT_VERSION" && "$DIST_COHERENT" -eq 1 ]]; then
  printf '%s\n' "$CHECKOUT_VERSION" > "$STAMP"
fi
echo "done — ${ARTIFACTS[*]} SHA256SUMS${CHECKOUT_VERSION:+ (version $CHECKOUT_VERSION)}"
