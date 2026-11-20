#!/bin/sh
# Usage: sh checkout-state.sh <checkout>
#
# Prints the state on disk of each path that
# `git ls-files --cached --others --exclude-standard` lists in the checkout that
# holds <checkout>, one line per path, sorted with `LC_ALL=C sort`. Two listings
# compare path by path with `diff`. Ignored files are not listed.
# - A tab separates the fields of a line. The script stops on a path with a tab
#   or a newline, so the first tab of a line always ends the path.
# - `<path> <blob id>`: a regular file. The blob id is of the raw bytes on disk,
#   with no filter. A third field `x` follows when the file is executable.
# - `<path> link <target>`: a symbolic link, also when it is dangling.
# - `<path> submodule <head>`: a checked-out submodule. The lines of this script
#   for the submodule follow, with `<path>/` before each path.
# - `<path> missing`: a listed path that does not exist.
# - `<path> special`: any other type, such as a folder that is not a checkout.
# Status 1: a path holds a tab or a newline, or a link target holds a newline.
# Status 2: a command failed, <checkout> is not in a git checkout, or the
# arguments are wrong. A failure is never a listing.
# On a status other than 0, the script prints nothing on stdout.

[ "$#" -eq 1 ] && [ -n "$1" ] || {
  echo 'usage: sh checkout-state.sh <checkout>' >&2
  exit 2
}
LC_ALL=C
export LC_ALL
self=$0
tab=$(printf '\t')
cr=$(printf '\r')
nl='
'
top=$(git -C "$1" rev-parse --show-toplevel) || exit 2
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
trap 'exit 2' HUP INT TERM

git -C "$top" ls-files -z --cached --others --exclude-standard >"$tmp/listed" || exit 2
if tr -cd '\t\n' <"$tmp/listed" | grep -q ''; then
  echo 'checkout-state: a path holds a tab or a newline' >&2
  exit 1
fi
# An untracked repository is listed as `<path>/`. An unmerged path is listed once
# per stage; `sort -u` keeps one line.
tr '\0' '\n' <"$tmp/listed" | sed 's|/$||' | sort -u >"$tmp/paths" || exit 2

# Regular files go to `regular` and their `x` field to `exec`, one line each, so
# that one hash-object process reads all of them. Other paths go to `lines`.
while IFS= read -r path; do
  file=$top/$path
  if [ -L "$file" ]; then
    # The x keeps the trailing newlines of the target, which are part of its name.
    target=$(readlink "$file" && echo x) || exit 2
    target=${target%x}
    target=${target%"$nl"}
    case $target in
      *"$nl"*)
        echo 'checkout-state: a link target holds a newline' >&2
        exit 1 ;;
    esac
    printf '%s\tlink\t%s\n' "$path" "$target"
  elif [ -f "$file" ]; then
    printf '%s\n' "$path" >&3
    if [ -x "$file" ]; then echo x; else echo; fi >&4
  elif [ -d "$file" ]; then
    # A folder that is not a checkout gives the toplevel of the outer checkout.
    sub=$(git -C "$file" rev-parse --show-toplevel) || exit 2
    if [ "$sub" = "$file" ]; then
      commit=$(git -C "$file" rev-parse HEAD) || exit 2
      printf '%s\tsubmodule\t%s\n' "$path" "$commit"
      # The status of the submodule run is the status of this run.
      sh "$self" "$file" </dev/null >"$tmp/submodule" || exit
      while IFS= read -r line; do
        printf '%s/%s\n' "$path" "$line"
      done <"$tmp/submodule"
    else
      printf '%s\tspecial\n' "$path"
    fi
  elif [ -e "$file" ]; then
    printf '%s\tspecial\n' "$path"
  else
    printf '%s\tmissing\n' "$path"
  fi
done <"$tmp/paths" >"$tmp/lines" 3>"$tmp/regular" 4>"$tmp/exec" || exit 2

if [ -s "$tmp/regular" ]; then
  # hash-object reads a line that starts with `"` as a C-quoted path, and it drops
  # a carriage return at the end of a line. Each path is quoted, so no byte is lost.
  sed -e 's/[\\"]/\\&/g' -e "s/$cr/\\\\r/g" -e 's/^/"/' -e 's/$/"/' <"$tmp/regular" |
    git -C "$top" hash-object --no-filters --stdin-paths >"$tmp/blobs" || exit 2
  paste "$tmp/regular" "$tmp/blobs" "$tmp/exec" | sed "s/$tab\$//" >>"$tmp/lines" || exit 2
fi
sort "$tmp/lines" >"$tmp/sorted" || exit 2
cat "$tmp/sorted"
