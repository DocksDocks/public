#!/bin/bash
# tarball-proof.sh — prove that a packed docks-kit tarball holds the bytes of a
# release tag. The tag must already exist locally (the release workflow fetches
# it first); this script never touches a remote.
# Usage: bash cli/scripts/tarball-proof.sh <tag> <tarball>
set -euo pipefail

if [[ "$#" -ne 2 ]]; then
  echo "usage: tarball-proof.sh <tag> <tarball>" >&2
  exit 2
fi
RELEASE_TAG="$1"
tgz="$2"
[[ "$tgz" == /* ]] || tgz="$PWD/$tgz"
cd "$(dirname "$0")/../.."

if ! git rev-parse --verify --quiet "refs/tags/${RELEASE_TAG}^{commit}" >/dev/null; then
  echo "::error::tag ${RELEASE_TAG} does not exist locally; fetch it first"
  exit 1
fi

# The packed bundle is a build output that git does not track: part 3 leaves
# out exactly this member, and part 4 proves it against a build of the tag.
BUNDLE="cli/dist/docks-kit.js"

# `bun pm pack` packs the WORKING TREE, so neither trigger proves by
# itself that the tarball is the tag's bytes. A dispatch runs from a
# branch, so `npm publish --provenance` would otherwise attest that
# branch; a tag push checks out the tag, so only the tree can drift.
# Both failures publish the wrong bytes under a correct-looking
# attestation, so this runs unconditionally.

# Declared roots are package.json `files` plus what npm packs anyway:
# the manifest, and LICENCE in either spelling. Every declared root is
# compared even when absent from this checkout, because dropping an
# absent root would hide a branch that deleted a whole packaged
# directory: the tarball would omit it too. A pathspec matching nothing
# in either tree is simply quiet.
# Both lists are produced by an ordinary command into a file, never by
# process substitution: `mapfile < <(producer)` discards the producer's
# exit status even under strict mode, so a producer that prints some
# valid lines and then fails would silently shorten the comparison.
lists="$(mktemp -d)"
packed_dir="$(mktemp -d)"
tagged_dir="$(mktemp -d)"
built_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tarball-proof-build.XXXXXX")"
trap 'rm -rf "$lists" "$packed_dir" "$packed_dir.tar" "$packed_dir.err" "$tagged_dir" "$built_dir" "$built_dir.tar"' EXIT
if ! bun -p '["package.json", "LICENSE", "LICENCE", ...require("./package.json").files].join("\n")' > "$lists/roots"; then
  echo "::error::could not read the packaged roots from package.json"
  exit 1
fi
mapfile -t roots < "$lists/roots"
if [[ "${#roots[@]}" -lt 4 ]]; then
  echo "::error::package.json declares no files array to compare"
  exit 1
fi

# 1. The tree must match HEAD across those roots, which is what catches
#    a deletion or edit that git tracks.
status="$(git status --porcelain -- "${roots[@]}")"
if [[ -n "$status" ]]; then
  echo "::error::working tree differs from HEAD across packaged roots"
  printf '%s\n' "$status"
  exit 1
fi

# 2. HEAD must match the tag across those roots, which is what catches a
#    dispatch branch that committed drift the tarball would inherit.
if ! git diff --quiet "refs/tags/${RELEASE_TAG}" HEAD -- "${roots[@]}"; then
  echo "::error::packaged content differs from ${RELEASE_TAG}"
  git diff --name-status "refs/tags/${RELEASE_TAG}" HEAD -- "${roots[@]}"
  exit 1
fi

# 3. The tarball's own files must equal the tag's. Checks 1 and 2 are
#    blind to paths git ignores, and `bun pm pack` packs an ignored file
#    that sits under a declared root, so a stray editor backup or tool
#    output inside `cli/src` ships while `git status` and `git diff` stay
#    quiet. Rebuilding the same member list from the tag turns "the roots
#    agree" into "these files hold these bytes", and `git archive` fails
#    outright when a packed path does not exist at the tag. The bundle is
#    the one member git cannot hold, so it moves out of the unpacked tree
#    into part 4 before the comparison; any other untracked member still
#    fails here.
if [[ ! -f "$tgz" ]]; then
  echo "::error::no tarball to compare at '$tgz'"
  exit 1
fi
tar -xzf "$tgz" --strip-components=1 -C "$packed_dir"
if ! ( cd "$packed_dir" && find . -type f -printf '%P\n' ) > "$lists/members"; then
  echo "::error::could not list the unpacked tarball"
  exit 1
fi
LC_ALL=C sort -o "$lists/members" "$lists/members"
mapfile -t listed < "$lists/members"
members=()
for member in "${listed[@]}"; do
  [[ "$member" == "$BUNDLE" ]] || members+=("$member")
done
if [[ "${#members[@]}" -eq "${#listed[@]}" ]]; then
  echo "::error::tarball '$tgz' holds no $BUNDLE"
  exit 1
fi
mv "$packed_dir/$BUNDLE" "$lists/packed-bundle.js"
rmdir --ignore-fail-on-non-empty "$packed_dir/cli/dist"
if [[ "${#members[@]}" -eq 0 ]]; then
  echo "::error::tarball '$tgz' unpacked to no files"
  exit 1
fi
if ! git archive --format=tar "refs/tags/${RELEASE_TAG}" -- "${members[@]}" \
  > "$packed_dir.tar" 2> "$packed_dir.err"; then
  echo "::error::a packed file does not exist at ${RELEASE_TAG}"
  cat "$packed_dir.err"
  exit 1
fi
tar -xf "$packed_dir.tar" -C "$tagged_dir"
if ! diff -r "$packed_dir" "$tagged_dir"; then
  echo "::error::tarball bytes differ from ${RELEASE_TAG}"
  exit 1
fi

# 4. The packed bundle must equal a bundle built from the tag's own tree.
#    The build is reproducible (same Bun, same output name, any checkout
#    path), so byte equality proves the bundle came from the tag's source
#    and lockfile, not from the working tree that `bun pm pack` read.
if ! git archive --format=tar "refs/tags/${RELEASE_TAG}" > "$built_dir.tar"; then
  echo "::error::could not export the tree of ${RELEASE_TAG}"
  exit 1
fi
tar -xf "$built_dir.tar" -C "$built_dir"
rm -f "$built_dir.tar"
( cd "$built_dir" && bun install --frozen-lockfile )
# The tag's own build script holds the build flags, so they live in one place; it resolves the repository from its own
# location and writes "$built_dir/cli/dist".
( cd "$built_dir" && bun cli/scripts/build-bundle.ts )
if ! difference="$(cmp -- "$lists/packed-bundle.js" "$built_dir/$BUNDLE" 2>&1)"; then
  echo "::error::packed $BUNDLE differs from the bundle built at ${RELEASE_TAG}: $difference"
  exit 1
fi

summary="$(printf 'content of every packed file matches %s: %d files, %s rebuilt from the tag' \
  "$RELEASE_TAG" "${#listed[@]}" "$BUNDLE")"
printf '%s\n' "$summary"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '%s\n' "$summary" >> "$GITHUB_STEP_SUMMARY"
fi
