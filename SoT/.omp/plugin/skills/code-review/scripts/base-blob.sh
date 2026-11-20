#!/bin/sh
# Usage: sh base-blob.sh <commit> <path>
#
# Prints the blob id of the file <path> in the tree of <commit>, as a checkout of
# <commit> would open it. Run it from the repository.
# - The walk reads one path part at a time. A folder link and a file link resolve
#   from the folder that holds the link, and `..` goes to the parent of the real
#   folder that the walk has reached.
# - The walk follows at most 40 links, as git and Linux do. This also ends a loop.
# Status 1: absent. The path is missing, or it names a folder, a submodule, or a
# file with more path parts after it. Or a link has an empty or absolute target,
# a target outside the tree, or more than 40 links.
# Status 2: a git command failed, or the arguments are wrong. A git failure is
# never an absent file.

[ "$#" -eq 2 ] && [ -n "$1" ] || {
  echo 'usage: sh base-blob.sh <commit> <path>' >&2
  exit 2
}
commit=$1 rest=$2 dir='' links=0
tab=$(printf '\t')
while [ -n "$rest" ]; do
  case $rest in
    # A part after a slash stays, so that `file/` and a link to `dir/` keep a part.
    */*)
      part=${rest%%/*}
      rest=${rest#*/}
      rest=${rest:-.} ;;
    *)
      part=$rest
      rest='' ;;
  esac
  case $part in
    '' | .) continue ;;
    ..)
      [ -n "$dir" ] || exit 1
      case $dir in */*) dir=${dir%/*} ;; *) dir='' ;; esac
      continue ;;
  esac
  entry=$(git --literal-pathspecs ls-tree --full-tree "$commit" -- "${dir:+$dir/}$part") || exit 2
  [ -n "$entry" ] || exit 1
  # An entry is `<mode> <type> <object id><tab><path>`. Only the part before the tab
  # is read, and git quotes a path with a newline, so no byte of a name is lost.
  meta=${entry%%"$tab"*}
  oid=${meta##* }
  case ${meta%% *} in
    040000) dir=${dir:+$dir/}$part ;;
    120000)
      links=$((links + 1))
      [ "$links" -le 40 ] || exit 1
      # The x keeps the trailing newlines of the target, which are part of its name.
      target=$(git cat-file blob "$oid" && echo x) || exit 2
      target=${target%x}
      case $target in '' | /*) exit 1 ;; esac
      rest=$target${rest:+/$rest} ;;
    100644 | 100755)
      [ -z "$rest" ] || exit 1
      printf '%s\n' "$oid"
      exit 0 ;;
    *) exit 1 ;;
  esac
done
exit 1
