# plan-manager base-instructions block (planned text)

The base-instructions block of `plan-manager/SKILL.md` in the form that step `callers` of #203 gives it: `docks-kit plan base-blob` reads each file in place of `sh "<skill-dir>/scripts/base-blob.sh"`. The `docks-kit` mode of the plan suites runs this block. Step `callers` deletes this file, and the suites then read the block from the skill file.

```bash
inst="$scratch/code-review-<n>-round-<k>-base-instructions"
prev="<previous-reviewed-head or empty>"
rm -rf "$inst" && mkdir -p "$inst" && (
  set -o pipefail
  { git diff --name-only --no-renames -z "$base" &&
      { [ -z "$prev" ] || git diff --name-only --no-renames -z "$prev"; } &&
      git ls-files --others --exclude-standard -z; } |
  while IFS= read -r -d '' path; do
    dir=$path
    while [ "$dir" != . ]; do
      case $dir in */*) dir=${dir%/*} ;; *) dir=. ;; esac
      for name in AGENTS.md CLAUDE.md REVIEW.md; do
        if [ "$dir" = . ]; then printf '%s\0' "$name"; else printf '%s\0' "$dir/$name"; fi
      done
    done
  done | sort -zu |
  while IFS= read -r -d '' file; do
    oid=$(docks-kit plan base-blob "$base" "$file")
    case $? in
      0) copy="$inst/$file"
        mkdir -p "${copy%/*}" && git cat-file blob "$oid" > "$copy" || exit 1
        printf 'copied %s\n' "$file" ;;
      1) printf 'absent %s\n' "$file" ;;
      *) exit 1 ;;
    esac
  done > "$inst/MANIFEST.part"
) && mv "$inst/MANIFEST.part" "$inst/MANIFEST" ||
  { echo "base instructions: a read failed; $inst has no MANIFEST" >&2; false; }
```
