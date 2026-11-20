# Suppression Syntax — Per-Tool Catalog

## Contents

- [Universal scope rule](#universal-scope-rule)
- [ESLint (JavaScript / TypeScript)](#eslint-javascript-typescript)
- [TypeScript](#typescript)
- [mypy (Python)](#mypy-python)
- [ruff (Python)](#ruff-python)
- [pylint (Python)](#pylint-python)
- [clippy (Rust)](#clippy-rust)
- [golangci-lint (Go)](#golangci-lint-go)
- [shellcheck (bash / sh)](#shellcheck-bash-sh)
- [Java / `@SuppressWarnings`](#java-suppresswarnings)
- [Anti-pattern checklist](#anti-pattern-checklist)

Reference for when a suppression IS genuinely justified (per the parent SKILL.md decision tree, after fixes #1–#3 have been ruled out). **Every suppression below MUST include a same-line reason** — a sentence naming the concrete, irreducible cause (third-party type bug + filed issue link, hardware quirk, platform constraint, generic erasure round-trip, etc.). "Speed", "later", or "I'll fix it next sprint" are not reasons. Use each tool's own reason syntax: ESLint takes `-- reason`; mypy, ruff, pylint, and shellcheck take a second comment, `# reason`. A `--` after a mypy, pylint, or shellcheck directive breaks the directive (mypy: invalid `type: ignore`; pylint: `unknown-option-value`; shellcheck: SC1073).

## Universal scope rule

Prefer narrower scope to wider:

```
single line  >  block (next N lines)  >  whole file  >  project config
```

Project-level rule-disabling (turning off a rule repo-wide) is the widest blast radius. Use it only for vendored or auto-generated paths, scoped via file globs in the config.

---

## ESLint (JavaScript / TypeScript)

| Syntax | Scope |
|---|---|
| `// eslint-disable-next-line <rule>` | Next line only |
| `// eslint-disable-line <rule>` | Same line (less readable) |
| `/* eslint-disable <rule> */` … `/* eslint-enable <rule> */` | Block between markers |
| `/* eslint-disable */` at file top | Whole file (avoid) |
| `files` + `rules` entry in `eslint.config.js` (flat config; `.eslintrc` `overrides` on ESLint ≤8 only) | Path-glob scope |

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party SDK types stale, filed @company/sdk#42
const result = (response as any).data
```

Multi-rule on one line:

```ts
// eslint-disable-next-line no-console, no-alert -- diagnostic-only debugger module
console.log(state)
```

## TypeScript

| Syntax | Scope | Notes |
|---|---|---|
| `// @ts-expect-error <reason>` | Next line | **Preferred** — TS reports an error (TS2578) if the suppressed error goes away, forcing re-evaluation |
| `// @ts-ignore <reason>` | Next line | Silent — TS never re-evaluates; drift-prone |
| `// @ts-nocheck` | Whole file | Strongest; use only for generated files |
| `compilerOptions.skipLibCheck` in `tsconfig.json` | Project-wide for `.d.ts` files | Common but wide — document why |

```ts
// @ts-expect-error -- Vercel SDK v2.4 mistyped, see https://github.com/vercel/sdk/issues/123
import { internalThing } from "@vercel/sdk"
```

When the suppression is no longer needed, `@ts-expect-error` becomes a compile error itself — forcing removal. Prefer it over `@ts-ignore`.

## mypy (Python)

| Syntax | Scope |
|---|---|
| `# type: ignore[<error-code>]` | Same expression, specific error code (preferred) |
| `# type: ignore` | Same expression, ALL errors (avoid — too wide) |
| `# mypy: ignore-errors` at file top | Whole file (avoid) |
| `[mypy-foo.*]` `ignore_errors = true` in `mypy.ini` / `pyproject.toml` | Module-path glob |

```python
result: dict = json.loads(raw)  # type: ignore[no-untyped-call]  # stdlib stub gap, see python/typeshed#42
```

Always include the error code in brackets — `# type: ignore` alone silences ALL mypy errors on the line, which masks new issues.

## ruff (Python)

| Syntax | Scope |
|---|---|
| `# noqa: E501` | Specific rule, same line |
| `# noqa: E501, E731` | Multiple rules, same line |
| `# noqa` | All rules, same line (avoid) |
| `[tool.ruff.lint.per-file-ignores]` in `pyproject.toml` | Path-glob → rule-list |

```python
x = a_very_long_variable_name + another_long_name * yet_another_factor  # noqa: E501  # formula matches paper notation exactly
```

## pylint (Python)

| Syntax | Scope |
|---|---|
| `# pylint: disable=invalid-name` | Same line |
| `# pylint: disable-next=invalid-name` | Next line only |
| `# pylint: disable=invalid-name` at file top | Whole file |
| `[tool.pylint."messages control"]` `disable = ["invalid-name"]` in `pyproject.toml` | Project-wide |

```python
X = compute_constant()  # pylint: disable=invalid-name  # protocol constant name fixed by RFC 7519
```

## clippy (Rust)

| Syntax | Scope |
|---|---|
| `#[expect(clippy::needless_return)]` | Item — PREFER over `allow`: warns when the lint stops firing (stable Rust 1.81+) |
| `#[allow(clippy::needless_return)]` | Item (function / struct / impl block) |
| `#![allow(clippy::pedantic)]` at crate root | Whole crate |
| `[lints.clippy]` in `Cargo.toml` | Project-wide (Rust 1.74+) |

```rust
#[allow(clippy::too_many_arguments)] // FFI signature mirrors C ABI exactly
pub extern "C" fn ffi_call(a: i32, b: i32, c: i32, d: i32, e: i32, f: i32, g: i32, h: i32) -> i32 {
    // ...
}
```

## golangci-lint (Go)

| Syntax | Scope |
|---|---|
| `//nolint:errcheck // reason` | Same line; reason enforced when `nolintlint` runs with `require-explanation: true` (defaults **false** — opt in) |
| `//nolint:errcheck,govet // reason` | Multiple linters |
| `//nolint:all` | All linters (avoid) |
| `linters: settings: <linter>: <flag>` in `.golangci.yml` (golangci-lint v2 schema) | Project-wide |

```go
_, _ = file.Write(buf) //nolint:errcheck // best-effort log flush at shutdown
```

`nolintlint` is the meta-linter that polices `//nolint:` directives — set its `require-explanation: true` (off by default) to make the same-line reason mandatory. Keep both on.

## shellcheck (bash / sh)

| Syntax | Scope |
|---|---|
| `# shellcheck disable=SC2086` | Next non-comment line |
| `# shellcheck disable=SC2086,SC2015` | Multiple codes |
| `disable=SC2086` in `.shellcheckrc` | Project-wide |

```bash
# shellcheck disable=SC2086 # word-splitting deliberate: array elements stay as separate args
cmd $args
```

## Java / `@SuppressWarnings`

| Syntax | Scope |
|---|---|
| `@SuppressWarnings("unchecked")` on a method/local | Annotated element only |
| `@SuppressWarnings({"unchecked", "rawtypes"})` | Multiple warnings |
| Annotation processor config | Project-wide (rare) |

```java
@SuppressWarnings("unchecked")  // generic erasure round-trip safe per JLS §4.8
List<String> result = (List<String>) genericReturn;
```

Place the annotation on the narrowest scope (the local variable's enclosing method, not the whole class).

---

## Anti-pattern checklist

A suppression is illegitimate if ANY of these is true:

- [ ] No same-line reason
- [ ] Reason is generic ("legacy", "TODO", "fix later", "speed")
- [ ] Suppresses ALL rules when only one is at issue (e.g., `# noqa` instead of `# noqa: E501`)
- [ ] Suppresses at a wider scope than necessary (file-level when line-level would work)
- [ ] Adds a new project-level disable to fix a single occurrence
- [ ] Uses `@ts-ignore` when `@ts-expect-error` would catch drift
- [ ] No linked issue when the reason is "third-party bug" or "framework limitation"
