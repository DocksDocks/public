# TypeScript guardrails

## Contents

- [Detect](#detect)
- [Recommended config](#recommended-config)
- [Rules that catch raw values](#rules-that-catch-raw-values)
- [Constant map](#constant-map)
- [Verify](#verify)
- [Sources](#sources)

## Detect

- Look for `.oxlintrc.json` or `oxlint.config.ts`. Oxlint discovers either format; use only one config per directory.
- Read `package.json` scripts and dependencies to find the project's lint command and installed tools.
- Check for ESLint config and dependencies. If ESLint owns linting, add equivalent rules there. Ask before any migration to Oxlint.
- Ask before installing Oxlint if the project has no Oxlint installation.

## Recommended config

Merge these entries into the existing Oxlint config.
Keep unrelated rules, plugins, ignores, and overrides.
Add missing rules and never loosen a stricter setting.
Use these keys inside `defineConfig({ ... })` for an existing `oxlint.config.ts`.
Do not keep both config formats in one directory.
Keep `eslint/no-magic-numbers` on in test files. Do not add an override that turns it off there.
A test holds an expected literal in a named `const`; the rule does not report a `const` initializer.
Remove an existing test-file override for this rule only after you ask the user.

```json
{
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "pedantic": "error",
    "perf": "error",
    "style": "error"
  },
  "rules": {
    "eslint/no-magic-numbers": [
      "error",
      {
        "ignore": [0, 1, -1],
        "ignoreArrayIndexes": true,
        "ignoreEnums": true,
        "ignoreNumericLiteralTypes": true,
        "ignoreReadonlyClassProperties": true,
        "enforceConst": true
      }
    ],
    "typescript/no-explicit-any": "error",
    "typescript/no-unsafe-function-type": "error",
    "typescript/no-non-null-assertion": "error"
  }
}
```

`correctness`, `suspicious`, `pedantic`, `perf`, and `style` are documented categories. Review the findings before applying fixes. Enable `restriction` only after the project chooses its feature bans. Leave `nursery` out because its rules are under development. Confirm that the existing plugin settings include TypeScript; setting `plugins` replaces the default set.

### Anti-slop handoff

[anti-slop](https://github.com/dmmulroy/anti-slop) is an MIT-licensed Oxlint JavaScript plugin. It is meant to be copied into the project and maintained there. Its rules include `no-array-filter-map`, `no-chained-type-assertions`, `no-known-value-widening`, and `no-module-mocking`. Ask the user before the network step. After approval, run `npx skills add dmmulroy/anti-slop --skill install-anti-slop`. Let that skill copy and configure the rules. Do not copy rules by hand or install dependencies without approval.

Oxlint enforces code rules. Oxfmt or Prettier changes layout only; neither replaces these checks.

## Rules that catch raw values

| Rule | Catches | Limits |
|---|---|---|
| `eslint/no-magic-numbers` | Numeric literals without named constants; `enforceConst` requires `const` for declared numeric constants. | Configured exceptions cover 0, 1, -1, indexes, enums, numeric literal types, and readonly properties. It does not find repeated strings or cross-module copies. |
| `typescript/no-explicit-any` | Explicit `any` types. | It does not detect magic numbers, strings, or repeated values. |
| `typescript/no-unsafe-function-type` | Unsafe built-in `Function` types. | It does not detect raw values. |
| `typescript/no-non-null-assertion` | Postfix non-null assertions. | It does not detect raw values. |

No listed Oxlint rule checks all repeated literals across modules.
Use `../SKILL.md` under `## Find scattered values` to check strings, paths, keys, limits, and copied constants.

## Constant map

Keep one owning module per domain. Import its values instead of copying them. Derive larger units from a named binary factor. Name units where they matter. Derive string unions from one `as const` set. Use production constants for test inputs; use literal expected values when the test checks the constant itself.

```ts
// BAD — callers copy upload limits, timeouts, keys, and state strings.
const limit = 8 * 1024 * 1024;
const timeout = 30_000;
const storageKey = "uploads.pending";
const state: string = "queued";

// GOOD — transfer-constants.ts owns this domain's values.
export const BINARY_STEP = 1024;
export const KIB = BINARY_STEP;
export const MIB = BINARY_STEP * KIB;
export const MAX_UPLOAD_BYTES = 8 * MIB;
export const TIMEOUT_MS = 30_000;
export const STORAGE_KEY = "uploads.pending";
export const STATES = ["queued", "running", "done"] as const;
export type State = (typeof STATES)[number];

// GOOD — another module imports values from their owner.
import { MAX_UPLOAD_BYTES, TIMEOUT_MS, STORAGE_KEY, type State } from "./transfer-constants";
```

## Verify

Run the project's configured lint script when it uses Oxlint, or run `npx oxlint` / `bunx oxlint` in the project root. Confirm that Oxlint loads the existing config and that the new rules report source violations. List each config change and explain every remaining finding. Do not install a missing tool without asking the user.

## Sources

- Oxlint configuration, config formats, categories, plugins, and overrides: <https://oxc.rs/docs/guide/usage/linter/config.html>
- Oxlint `eslint/no-magic-numbers` options and numeric rule scope: <https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-magic-numbers>
- Oxlint `typescript/no-explicit-any`: <https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-explicit-any>
- Oxlint `typescript/no-unsafe-function-type`: <https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-unsafe-function-type>
- Oxlint `typescript/no-non-null-assertion`: <https://oxc.rs/docs/guide/usage/linter/rules/typescript/no-non-null-assertion>
- Oxlint CLI commands and category behavior: <https://oxc.rs/docs/guide/usage/linter/cli.html>
- anti-slop install, ownership, and rule names: <https://github.com/dmmulroy/anti-slop>
- anti-slop MIT license: <https://github.com/dmmulroy/anti-slop/blob/main/LICENSE>
