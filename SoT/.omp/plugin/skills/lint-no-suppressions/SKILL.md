---
name: lint-no-suppressions
description: "Use when a linter or type-checker flags an error; when tempted to add eslint-disable / @ts-ignore / @ts-expect-error / @ts-nocheck / # noqa / # type: ignore / # pylint: disable / @SuppressWarnings; when setting up a new repo's pre-commit hook; when reviewing a PR that adds a suppression comment; or when a rule like react-hooks/set-state-in-effect or @typescript-eslint/no-explicit-any seems \"wrong\" for the current line."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "b3715bdf00626f49c21f0ca95630e708afe95485495990f451fb75d192e926e2"
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

## Rationalizations — the excuse and the reality

Under deadline pressure the suppression always feels justified. Each excuse has a standard rebuttal; pattern-match yours here before reaching for the comment.

| Excuse | Reality |
|---|---|
| "It's just one line, it's temporary" | A silenced check is the most permanent code there is — nothing has a deadline once the warning is gone. |
| "The rule is wrong for this line" | ~99% of the time the rule anticipated this case. You owe a filed-issue link before you're allowed to believe the 1%. |
| "I'll fix it properly next sprint" | The suppression deletes the only signal that would remind you. There is no next sprint for a green check. |
| "It's legacy / not my code" | If you're editing the line, it's your line now. (Pre-existing suppressions you don't touch are fine — the scanner only blocks NEW ones.) |
| "CI is red and I have to ship" | Suppressing turns a visible red into invisible debt that ships anyway. Fix the cause, or revert the change that caused it. |
| "Casting through `any`/`unknown` is quicker" | Quicker to write, slower forever — the compiler stops protecting that path the moment you do. |

## BAD / GOOD — the suppression vs the fix

```ts
// BAD — silences the rule, hides the real shape of the data, rots silently
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const items = (response as any).data.items;

// GOOD — declare the narrow interface the call site actually needs
interface SearchResponse {
  data: { items: SearchItem[] };
}
const items: SearchItem[] = (response as SearchResponse).data.items;
```

The GOOD form is barely more code, survives refactors (the compiler re-checks it on every change), and documents the contract the suppression was hiding.

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

## When to Load References

| Triggered by | Reference file |
|---|---|
| Setting up the pre-commit hook (or its CI mirror) that blocks new suppressions | `references/pre-commit-hook.md` |
| Looking up suppression syntax / scope rules for a specific tool (ESLint, TypeScript, mypy, ruff, clippy, golangci-lint, shellcheck, pylint, Java) | `references/per-tool-catalog.md` |

<constraint>
Project-level rule-disabling (turning off a rule repo-wide via `eslint.config.js` / `tsconfig.json` / `pyproject.toml`) is the same problem as inline suppression — just at a wider blast radius. Scope rule-disabling to the minimum file pattern that genuinely needs it (e.g., auto-generated files, vendored code), and document the reason in the config.
</constraint>

<constraint>
CI must enforce the suppression block too. Client-side hooks are bypassable with `--no-verify`. Run the same scanner as a CI job so PRs cannot land with new suppressions even if the committer skipped the local hook. See `references/pre-commit-hook.md` § CI Mirror for a ready-to-paste GitHub Actions step.
</constraint>

## Gotchas

- **"It's legacy code" ≠ license to suppress.** If you're touching the line, fix it. If you're not, leave the pre-existing suppression untouched (the staged-diff scanner does the right thing — it only blocks NEW suppressions).
- **`// TODO: fix this lint error`** is also a smell. If you can write the TODO comment, you can write the real fix.
- **`@ts-ignore` vs `@ts-expect-error`** — prefer `@ts-expect-error` when a suppression is truly justified. TS reports an error (TS2578, unused directive) if the underlying error goes away, which forces removal, so the suppression can't drift silently.
- **A bare suppression silences EVERYTHING, not one rule.** Bare `// eslint-disable-next-line` (no rule name) disables ALL rules on that line; bare `# noqa` silences every Python code; bare `# type: ignore` silences every mypy code (use `# type: ignore[code]`); bare `//nolint` (no `:linter`) silences every golangci linter. Always name the rule — it's the difference between a scoped exception and a blanket blindfold.
- **Rust: prefer `#[expect(lint)]` over `#[allow(lint)]`** (stable since Rust 1.81) — the drift-detecting analog of `@ts-expect-error`: it warns when the lint stops firing, forcing the stale suppression out.

## References

- React rules-of-hooks: https://react.dev/reference/rules-of-hooks
- TypeScript `@ts-expect-error` (intended for test fixtures): https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-9.html#-ts-expect-error-comments
- ESLint rule reference (prefer config over inline disable): https://eslint.org/docs/latest/use/configure/rules
- mypy error codes (use the bracketed form): https://mypy.readthedocs.io/en/stable/error_code_list.html
- ruff rule reference: https://docs.astral.sh/ruff/rules/
- clippy lint list: https://rust-lang.github.io/rust-clippy/master/
- golangci-lint `nolintlint` (set `require-explanation: true` to require a reason on `//nolint:`): https://golangci-lint.run/docs/linters/configuration/#nolintlint

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
