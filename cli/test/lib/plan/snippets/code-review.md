# code-review base read (planned text)

The base read of `code-review/SKILL.md` in the form that step `callers` of #203 gives it: `docks-kit plan base-blob` prints the blob id in place of `sh "<skill-dir>/scripts/base-blob.sh"`. The `docks-kit` mode of the plan suites runs this snippet. Step `callers` deletes this file, and the suites then read the snippet from the skill file.

```bash
base=$(git merge-base <fixed-point> HEAD)
oid=$(docks-kit plan base-blob "$base" "<path>") && git cat-file blob "$oid"
```
