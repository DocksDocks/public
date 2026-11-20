#!/bin/bash
# release-build.sh — build, pack, and check every docks-kit release file in
# cli/dist: the bundle and its source map, the four native binaries with
# SHA256SUMS, and the npm tarball.
# Usage: bash cli/scripts/release-build.sh <version>
set -euo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "usage: release-build.sh <version>" >&2
  exit 2
fi
RELEASE_VERSION="$1"
cd "$(dirname "$0")/../.."
DIST="cli/dist"
BUNDLE="docks-kit.js"
MAP="docks-kit.js.map"

bun run build:bundle
bun run build:binaries
bun pm pack --destination "$DIST"

expected="$DIST/docks-kit-${RELEASE_VERSION}.tgz"
shopt -s nullglob
tarballs=("$DIST"/*.tgz)
if [[ "${#tarballs[@]}" -ne 1 || "${tarballs[0]}" != "$expected" ]]; then
  echo "::error::expected exactly one tarball at '$expected'"
  exit 1
fi

# The map is a release asset, so it gets the same checksum line that
# cli/build-binaries.sh writes for each binary. Its name sorts after every
# `docks-kit-*` binary in the C locale, so appending keeps the file sorted.
map_line="$(cd "$DIST" && { sha256sum "$MAP" 2>/dev/null || shasum -a 256 "$MAP"; })"
printf '%s\n' "$map_line" >> "$DIST/SHA256SUMS"

# The bundle's last line names its map by debug id; the map, the bundle in
# cli/dist, and the bundle inside the tarball must all name the same one.
map_id="$(bun -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).debugId ?? ""' "$DIST/$MAP")"
if [[ ! "$map_id" =~ ^[0-9A-Fa-f]+$ ]]; then
  echo "::error::$DIST/$MAP has no hex debugId field (read '$map_id')"
  exit 1
fi
bundle_line="$(tail -n 1 "$DIST/$BUNDLE")"
if [[ "$bundle_line" != "//# debugId=$map_id" ]]; then
  echo "::error::$DIST/$BUNDLE ends with '$bundle_line', expected '//# debugId=$map_id'"
  exit 1
fi
if ! packed_line="$(tar -xzOf "$expected" "package/cli/dist/$BUNDLE" | tail -n 1)"; then
  echo "::error::$expected holds no package/cli/dist/$BUNDLE"
  exit 1
fi
if [[ "$packed_line" != "//# debugId=$map_id" ]]; then
  echo "::error::packed cli/dist/$BUNDLE ends with '$packed_line', expected '//# debugId=$map_id'"
  exit 1
fi

# cli/dist must hold the release files and nothing else, apart from the
# VERSION stamp that cli/build-binaries.sh writes for its own bookkeeping.
release_files=(
  docks-kit-linux-x64
  docks-kit-linux-arm64
  docks-kit-darwin-arm64
  docks-kit-windows-x64.exe
  SHA256SUMS
  "docks-kit-${RELEASE_VERSION}.tgz"
  "$BUNDLE"
  "$MAP"
  VERSION
)
listing="$(mktemp -d)"
trap 'rm -rf "$listing"' EXIT
printf '%s\n' "${release_files[@]}" | LC_ALL=C sort > "$listing/expected"
if ! find "$DIST" -mindepth 1 -printf '%P\n' > "$listing/found"; then
  echo "::error::could not list $DIST"
  exit 1
fi
LC_ALL=C sort -o "$listing/found" "$listing/found"
if ! diff "$listing/expected" "$listing/found"; then
  echo "::error::$DIST does not hold exactly the release files (< missing, > unexpected)"
  exit 1
fi
echo "release files in $DIST for $RELEASE_VERSION, debugId $map_id"
