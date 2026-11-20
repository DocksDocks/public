# Effect diagnostics as lint rules

The Effect language service reports Effect mistakes as diagnostics. This file connects them to the editor, the package scripts, and continuous integration (CI). Agents, hooks, and CI run one gate command.

## Contents

- [Pick the package](#pick-the-package)
- [Install](#install)
- [tsconfig plugin block](#tsconfig-plugin-block)
- [Unstable APIs](#unstable-apis)
- [Scripts and CI](#scripts-and-ci)
- [Output formats and exit codes](#output-formats-and-exit-codes)
- [Suppression, Oxlint, and editors](#suppression-oxlint-and-editors)
- [Setup check](#setup-check)

## Pick the package

| TypeScript major | Package | Binary | `$schema` in `tsconfig.json` |
|---|---|---|---|
| 7 | `@effect/tsgo` | `effect-tsgo` | `./node_modules/@effect/tsgo/schema.json` |
| 5 or 6 | `@effect/language-service` | `effect-language-service` | `./node_modules/@effect/language-service/schema.json` |

Both packages use the plugin name `@effect/language-service` in `tsconfig.json`. On TypeScript 5 or 6, the plugin loads only in the editor. The gate needs no patch: run `tsc --noEmit` and `effect-language-service diagnostics --project tsconfig.json --strict`. `effect-language-service patch` rewrites files in `node_modules/typescript/lib`, so the shared-store risk under [Scripts and CI](#scripts-and-ci) applies. After a patch, delete the `.tsbuildinfo` files. The rest of this file is for TypeScript 7.

## Install

Each `@effect/tsgo` version supports the `typescript` versions in the "Supported Package Versions" table of its own README. The README on the GitHub default branch can name a tsgo version that is not on npm yet. Pin both packages exactly. `@effect/tsgo` has its own version numbers. Pin each Effect library package (`@effect/vitest`, `@effect/platform-*`, and others) to the exact `effect` version.

```sh
npm view @effect/tsgo version   # the tsgo version on the npm latest tag
# The support table of that version. npm view @effect/tsgo@<v> readme prints the README of the latest tag instead.
curl -fsSL "$(npm view @effect/tsgo@<tsgo-version> dist.tarball)" | tar -xzO package/README.md | grep -n -A8 'Supported Package Versions'
bun add -d -E @effect/tsgo@<tsgo-version> typescript@<typescript-version>    # Bun
pnpm add -D -E @effect/tsgo@<tsgo-version> typescript@<typescript-version>   # pnpm
grep -n -A8 'Supported Package Versions' node_modules/@effect/tsgo/README.md  # confirm the installed pair
```

## tsconfig plugin block

```jsonc
{
  "$schema": "./node_modules/@effect/tsgo/schema.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service",
        // Defaults: Effect errors and warnings fail effect-tsgo tsc; suggestions do not
        "ignoreEffectErrorsInTscExitCode": false,
        "ignoreEffectWarningsInTscExitCode": false,
        "ignoreEffectSuggestionsInTscExitCode": true,
        // Default true: suggestions print in the tsc output and steer agents
        "includeSuggestionsInTsc": true,
        // Levels: off, suggestion, message, warning, error
        "diagnosticSeverity": {
          "outdatedApi": "error", "runEffectInsideEffect": "error", "globalErrorInEffectFailure": "error",
          "anyUnknownInErrorContext": "warning", "strictEffectProvide": "warning",
          "tryCatchInEffectGen": "warning", "leakingRequirements": "warning",
          "globalDateInEffect": "warning", "globalConsoleInEffect": "warning", "globalFetchInEffect": "warning",
          "globalRandomInEffect": "warning", "globalTimersInEffect": "warning", "globalJsonInEffect": "warning"
        },
        "allowedUnstableApis": ["@effect/platform-bun/BunRuntime", "@effect/vitest", "effect/http"]
      }
    ]
  }
}
```

The defaults already fail on errors and warnings, for example `floatingEffect`, `missingReturnYieldStar`, and `duplicatePackage`. The block raises rules that catch common agent mistakes. Read each default in `node_modules/@effect/tsgo/schema.json`.

| Rule | Catches |
|---|---|
| `outdatedApi` | a name that does not exist in Effect 4 |
| `runEffectInsideEffect` | `Effect.run*` inside an Effect |
| `globalErrorInEffectFailure`, `anyUnknownInErrorContext` | the global `Error`, `any`, or `unknown` in the error channel |
| `strictEffectProvide` | `Effect.provide` with a layer outside an entry point. Tests provide doubles with `layer(...)` |
| `tryCatchInEffectGen` | `try`/`catch` inside an Effect generator |
| `leakingRequirements` | a service method that leaks a dependency to its callers |
| `global*InEffect` | `Date`, `console`, `fetch`, `Math.random`, timers, or `JSON` inside Effect code |

## Unstable APIs

`unstableApiUsage` warns on each application programming interface (API) with the `@stability unstable` tag, for example `BunRuntime`, `@effect/vitest`, and `effect/http`. Confirm a tag with `grep -n '@stability' node_modules/@effect/platform-bun/src/BunRuntime.ts`. Run the type check and read each `effect(unstableApiUsage)` line. Add each module that the project uses on purpose to `allowedUnstableApis`. An entry such as `effect/http` allows the module and its children. An entry such as `effect/http/HttpClient#get` allows one export.

## Scripts and CI

```json
{
  "scripts": {
    "typecheck": "effect-tsgo tsc --noEmit -p tsconfig.json",
    "lint:effect": "effect-tsgo diagnostics --project tsconfig.json --format text --strict"
  }
}
```

- `typecheck` is the gate. It reports plain type errors and Effect diagnostics in one pass.
- `lint:effect` reports only Effect diagnostics. A plain type error does not make it fail.
- Do not name a script `check`: `bun check` runs that script instead of the type checker.
- Prefer `effect-tsgo tsc` to `effect-tsgo patch`. `patch` rewrites the compiler in `node_modules`. With a shared store (pnpm global virtual store, Yarn PnP, Nix), the change reaches other projects.
- Add `"prepare": "effect-tsgo patch"` only when an editor or a tool starts stock `tsc` and the store is not shared. `effect-tsgo unpatch` restores the files. An install with `--ignore-scripts` skips `prepare`, so stock `tsc` then exits 0 without Effect diagnostics.

GitHub Actions steps for a job with `timeout-minutes` and a checkout with `persist-credentials: false`. `--strict` makes Effect warnings fail. The last step adds annotations to the pull request and type checks a second time.

```yaml
- run: bun install --frozen-lockfile
- run: bun run typecheck
- if: ${{ !cancelled() }} # annotate also when the type check failed
  run: bun x --no-install effect-tsgo diagnostics --project tsconfig.json --format github-actions --strict
# pnpm: pnpm install --frozen-lockfile, pnpm run typecheck, pnpm exec effect-tsgo diagnostics ...
```

## Output formats and exit codes

| Command | Output | Exits 1 on |
|---|---|---|
| `effect-tsgo tsc -p tsconfig.json` | `src/main.ts(4,3): error TS377001: <message> effect(floatingEffect)` | type errors, Effect errors, Effect warnings |
| `effect-tsgo diagnostics --format text` | `<path>(4,3): error effect(floatingEffect): <message>`, then a summary | Effect errors; with `--strict`, Effect warnings too |
| `diagnostics --format github-actions` or `json` | `::error file=<path>,line=4,...,title=floatingEffect::<message>`, or `{ "diagnostics": [...], "summary": {...} }` | as for `text` |
| `effect-tsgo oxlint --type-aware` | `src/main.ts:4:3: error effecttsgo(floating-effect): <message>` | errors |

## Suppression, Oxlint, and editors

**Suppression.** Fix the code first: see the `lint-no-suppressions` skill. When the user approves an exception, write `// @effect-diagnostics-next-line floatingEffect:off` with the bare rule name. The `effect/floatingEffect:off` form does not work in `@effect/tsgo`.

**Oxlint (optional, experimental).** It adds Effect findings to a project that already runs type-aware Oxlint. `effect-tsgo tsc` stays the gate.

1. Install `oxlint` and `oxlint-tsgolint` at versions from the tsgo support table.
2. In `.oxlintrc.json`, set `"$schema": "./node_modules/@effect/tsgo/oxlint-schema.json"` and `"extends": ["./node_modules/@effect/tsgo/oxlint-presets/recommended.json"]`. Other presets: `strict`, `correctness`, `antipattern`, `effect-native`, `style`, `maintainers`.
3. Run `effect-tsgo oxlint --type-aware`. Stock `oxlint` fails with `Unknown plugin: 'effecttsgo'`.
4. To make Oxlint the Effect gate instead, do all of this in one change: set every rule that the tsconfig plugin enables, with its severity, in `.oxlintrc.json`; add `--deny-warnings`; keep a plain type check in the gate (`tsc --noEmit`), because Oxlint reports TypeScript errors only with its experimental `--type-check` flag; update every gate command (package script, CI, hook, `AGENTS.md`). Then run the Setup check below, and also plant one plain type error, such as `export const total: number = "x"`: the gate must fail on both.

**Editors.** Use `effect-tsgo` instead of `tsgo`, not next to it, because two servers give duplicate diagnostics. A Language Server Protocol (LSP) client starts `effect-tsgo tsc --lsp --stdio`. For VS Code, run `pnpm exec effect-tsgo setup --project tsconfig.json --non-interactive --accept-defaults --typescript --vscode` (Bun: `bun x --no-install effect-tsgo setup` with the same flags). Without `--apply`, it prints the changes and writes nothing. With `--apply`, it writes `.vscode/settings.json` (`"js/ts.experimental.useTsgo": true`) and a `prepare` script that runs `effect-tsgo patch`, because these settings need the patched `typescript`. Keep that script only when the store is not shared.

## Setup check

Confirm that the gate fails on a floating Effect. The probe gets a unique name in a folder of the tsconfig `include`. No-clobber mode (`set -C`) never writes over a file, and the trap removes only the probe.

```sh
( # the subshell keeps the trap and exit out of your shell
  probe="src/effect-setup-probe-$$.ts"   # a folder in tsconfig "include"
  (set -C; printf 'import { Effect } from "effect"\nexport const probe = Effect.gen(function*() {\n  Effect.log("never runs")\n})\n' > "$probe") || exit 1
  trap 'rm -f -- "$probe"' EXIT
  bun run typecheck   # or pnpm run typecheck; must exit 1 and print effect(floatingEffect)
)
```

## Sources

- https://github.com/Effect-TS/tsgo: support table, `tsc`, `patch`, `diagnostics`, `setup`, `allowedUnstableApis`, LSP command. Oxlint setup and presets: https://github.com/Effect-TS/tsgo/blob/main/docs/README.md
- https://github.com/Effect-TS/language-service: TypeScript 5 and 6 plugin, `diagnostics`, and `patch`
- https://bun.com/docs/runtime/check, https://bun.com/docs/pm/bunx, https://pnpm.io/global-virtual-store, https://oxc.rs/docs/guide/usage/linter/config, https://oxc.rs/docs/guide/usage/linter/cli (`--deny-warnings`)
