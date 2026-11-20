# Pre-commit Hook — Block New Suppressions

Reusable pre-commit hook that scans the **staged diff** (not the whole file) for newly-added suppression comments. Pre-existing suppressions that pre-date the hook don't block current work — only newly-added ones get rejected.

## Install

Drop the script below at `.githooks/pre-commit`, then wire it once per clone:

```bash
git config core.hooksPath .githooks && chmod +x .githooks/pre-commit
```

Package the install command as `scripts/install-hooks.sh` and commit it — new collaborators run the installer once.

## The Hook

```bash
#!/usr/bin/env bash
# Blocks new lint/type suppressions in staged code.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

SUPPRESSION_PATTERNS=(
  'eslint-disable'
  '@ts-ignore'
  '@ts-expect-error'
  '@ts-nocheck'
  '// *noqa'
  '# *noqa'
  '# *type: *ignore'
  '# *pylint: *disable'
  '@SuppressWarnings'
)

STAGED="$(git diff --cached --name-only --diff-filter=ACMR)"
SCAN=""
while IFS= read -r f; do
  # Exclude hook tooling itself — it legitimately names the patterns it blocks
  case "$f" in .githooks/*|scripts/install-hooks.sh) continue ;; esac
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.java|*.kt|*.sh|*.sql|*.go|*.rs)
      [ -f "$f" ] && SCAN="$SCAN $f" ;;
  esac
done <<< "$STAGED"

if [ -n "$SCAN" ]; then
  violations=0
  for pattern in "${SUPPRESSION_PATTERNS[@]}"; do
    hits="$(git diff --cached --unified=0 -- $SCAN 2>/dev/null \
            | grep -E '^\+' | grep -v '^+++' | grep -E "$pattern" || true)"
    if [ -n "$hits" ]; then
      echo "✗ new suppression: /$pattern/" >&2
      echo "$hits" | sed 's/^/    /' >&2
      violations=$((violations + 1))
    fi
  done
  [ "$violations" -gt 0 ] && exit 1
fi

exit 0
```

## CI Mirror

Client-side hooks are bypassable with `--no-verify`. Run the same scanner as a CI job so PRs cannot land with new suppressions even if the committer skipped the local hook.

GitHub Actions step:

```yaml
- name: Block new suppressions
  run: |
    git fetch origin ${{ github.base_ref }} --depth 1
    git diff --unified=0 origin/${{ github.base_ref }}..HEAD -- \
      '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' '*.py' '*.go' '*.rs' '*.kt' '*.java' '*.sh' '*.sql' \
      | grep -E '^\+' | grep -v '^+++' \
      | grep -E '(eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|// *noqa|# *noqa|# *type: *ignore|# *pylint: *disable|@SuppressWarnings)' \
      && { echo "✗ PR adds new suppressions — see .githooks/pre-commit"; exit 1; } \
      || echo "✓ no new suppressions"
```

GitLab CI / Circle CI / Bitbucket equivalents follow the same shape: fetch the base ref, diff against it, grep for the patterns in added lines (`^\+` excluding `^+++`).

## Tuning

- **Exclude vendored / generated paths** by adding them to the `case "$f" in` filter at the top. Typical excludes: `*/vendor/*`, `*/node_modules/*`, `*/dist/*`, `*/build/*`, `*_generated.ts`.
- **Add new suppression patterns** to `SUPPRESSION_PATTERNS` (and to the CI mirror regex) as your toolchain grows: `#!?\[(allow|expect)\(` (Rust/clippy attributes), `//nolint`, `# *shellcheck disable=`, `# *ruff: *noqa`.
- **Allow specific files** to suppress (e.g., third-party type shims, codegen output) by adding an explicit `case "$f"` clause that `continue`s past them.

## Limitations

- The diff-based scanner only flags NEW suppressions. Pre-existing suppressions in legacy code remain untouched (by design — you don't want CI to fail on unchanged code).
- It can't detect project-level rule-disabling in config files (`eslint.config.js` — or legacy `.eslintrc.*` — `tsconfig.json`, `pyproject.toml`, `Cargo.toml [lints]`). For those, add a separate config-file audit step (manual review on `eslint.config.js`/`.eslintrc.*` and `tsconfig.json` diffs in PR review).
- `--no-verify` bypasses client-side hooks. The CI mirror exists for this reason.
- Multi-byte filenames in `git diff --cached --name-only` need `core.quotePath=false` to be handled correctly by the `while read` loop.

## See also

- `per-tool-catalog.md` — the per-tool syntax catalog. When a suppression IS justified (rare), the catalog has the right syntax + scope rules per tool.
