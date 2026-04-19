---
name: lint-no-suppressions
description: Use when a linter or type-checker flags an error, when tempted to add eslint-disable / @ts-ignore / @ts-expect-error / @ts-nocheck / # noqa / # type: ignore / # pylint: disable / @SuppressWarnings, when setting up a new repo's pre-commit hook, when reviewing a PR that adds a suppression comment, or when a rule like react-hooks/set-state-in-effect or @typescript-eslint/no-explicit-any appears to be "wrong" for the current line. Covers the root-cause-fix-first rule, the decision tree before suppressing, the one narrow exception (documented third-party / hardware quirk), a reusable pre-commit hook that blocks new suppression lines, and how to wire it via core.hooksPath so every clone enforces it.
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-04-18"
---

# Never Suppress Lint / Type Errors

<constraint>
Comments like `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `// noqa`, `# type: ignore`, `# pylint: disable`, `@SuppressWarnings` are not fixes — they are hidden problems. They rot silently: the lint rule was added for a reason, and silencing it converts a one-time prompt into a permanent trap. Always fix the root cause.
</constraint>

## When to Use

- A linter or type-checker just flagged a line and the "obvious" fix is a suppression comment.
- Reviewing a diff that adds one of the suppression patterns.
- Setting up tooling for a new project — decide NOW that suppressions are blocked, not later.
- A React 19 `react-hooks/*`, TypeScript `strict`-mode, or ESLint `no-explicit-any` rule fires and feels "wrong."
- Porting legacy code that's full of suppressions.

## Decision Tree — Before Adding a Suppression

1. **Is the rule flagging a real anti-pattern?** Search the rule name + "how to fix." Check the framework's migration guide. Most rules have a documented idiomatic replacement.
2. **Is the code doing something the rule author didn't anticipate?** 99% of the time, no. The rule's edge cases are usually already covered.
3. **Is there a structural fix?** Often yes: extract a function, change a type, narrow a type guard, introduce a derived value, move logic to a different scope.
4. **Only if all three fail**: document the concrete, irreducible reason (hardware quirk, third-party type declaration bug with a filed issue link, platform constraint) in the comment *and* the PR description. "Speed" / "later" / "I'll fix it next sprint" are not reasons.

## Common Traps — Fix Instead of Suppress

| Rule | Wrong fix | Right fix |
|---|---|---|
| `react-hooks/set-state-in-effect` | `// eslint-disable-next-line` | Move setState into an async callback, derive state instead, or use `useSyncExternalStore` |
| `react-hooks/exhaustive-deps` | Disable the rule for "stable" refs | Put the ref in the array, memoize the value, or hoist the computation |
| `@typescript-eslint/no-explicit-any` | `// @ts-ignore` or cast through `unknown` | Write the real type; if external, declare a narrow interface |
| `@typescript-eslint/no-unused-vars` | Prefix with `_` then suppress | Actually remove the variable, or wire it into the logic |
| TypeScript `TS2322` type mismatch | `@ts-expect-error` | Fix the type — either the source or the consumer |
| Python `# noqa: E501` | Suppress the line-length rule | Split the line, or configure the project's line-length globally |
| `no-console` | Disable per-line | Use the project logger, or gate behind `process.env.NODE_ENV !== 'production'` |

## Pre-commit Hook — Reusable Template

Drop this into any repo at `.githooks/pre-commit` and wire it once via `core.hooksPath`. It scans the staged diff (not the whole file) so pre-existing suppressions that pre-date the hook don't block current work — but every new one gets rejected.

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

Install (one-time per clone): `git config core.hooksPath .githooks && chmod +x .githooks/pre-commit`

Package this as `scripts/install-hooks.sh` and commit it — new collaborators run the installer once.

## Gotchas

- **Project-level `.eslintrc` / tsconfig rule-disabling is the same problem**. Disabling a rule globally ("we turn off no-explicit-any in this repo") is not a fix. Scope rules down to the minimum file pattern that truly needs it (e.g., auto-generated files), and document why in the config.
- **"It's legacy code" ≠ license to suppress.** If you're touching the line, fix it. If you're not, leave the pre-existing suppression untouched (the staged-diff scanner does the right thing — it only blocks NEW suppressions).
- **CI must enforce the hook too.** Client-side hooks are bypassable with `--no-verify`. Add the same scanner as a CI job so PRs can't land with new suppressions even if the committer skipped the hook.
- **`// TODO: fix this lint error`** is also a smell. If you can write the TODO comment, you can write the real fix.

## References

- React docs: https://react.dev/reference/rules-of-hooks
- TypeScript handbook on suppressions: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html#-ts-expect-error-comments (intended for test fixtures only)
- ESLint rule reference: https://eslint.org/docs/latest/use/configure/rules (prefer config over inline disable)
