# JavaScript and TypeScript toolchain

Use this file to make the continuous integration (CI) install, format, lint, and type check steps fast. Do not lose a check. Measure each step before and after each change.

## Contents

- [Install](#install)
- [Format](#format)
- [Lint](#lint)
- [Type check](#type-check)
- [Job sketches](#job-sketches)
- [Sources](#sources)

## Install

| Package manager | Frozen install in CI | Cache path (key on the lockfile) | Setup action |
|---|---|---|---|
| Bun | `bun ci` (same as `bun install --frozen-lockfile`) | `~/.bun/install/cache` or `$BUN_INSTALL_CACHE_DIR` | `oven-sh/setup-bun` reads `packageManager` and caches only the Bun binary |
| pnpm 12 | `pnpm install` (frozen in CI by default) | the output of `pnpm store path` and `pnpm cache path` | `pnpm/setup` or `pnpm/action-setup` reads `packageManager` |
| npm | `npm ci` | `~/.npm` (`actions/setup-node` with `cache: npm`) | `actions/setup-node` |

- Bun does not turn on frozen mode in CI by itself. Always run `bun ci` in CI.
- Bun runs dependency lifecycle scripts only for packages in `trustedDependencies` or on its default trusted list, which includes `cypress` and `puppeteer` ([lifecycle scripts](https://bun.com/docs/pm/lifecycle)). A `trustedDependencies` list replaces the default list, and `trustedDependencies: []` turns the scripts off.
- Do not install pnpm through Corepack. The pnpm docs say so, and Node.js 25 and later do not ship Corepack.
- If you use `actions/setup-node` with `cache: pnpm`, put pnpm on `PATH` first. Run `pnpm/action-setup` before `actions/setup-node`.
- Also cache the `pnpm cache path` directory. The pnpm docs say that a store cache alone may not make the install faster.
- `npm ci` deletes an existing `node_modules`. Cache `~/.npm`, not `node_modules`.
- Let only trusted events write dependency caches, such as `push` to the default branch. `github-actions.md` explains the cache scope.
- In jobs without browser tests, set `CYPRESS_INSTALL_BINARY=0` and `PUPPETEER_SKIP_DOWNLOAD=true`. Bun jobs need them too. In the end-to-end (E2E) job, run `cypress install`. Cache the `CYPRESS_CACHE_FOLDER` directory.
- In a monorepo, install only the packages that the job needs: `pnpm install --filter "<pkg>..."` or `bun install --filter "<pkg>..."`. The Linear engineering team measured a filtered install faster than a `node_modules` cache restore. Measure both on your repository.

## Format

A format check is the cheapest gate. Run it first, so that a format error stops the run early.

| Formatter | CI command | Notes |
|---|---|---|
| `bun fmt` (since Bun 1.4.4) | `bun fmt --no-script --check` | Reads Prettier and oxfmt configuration. Needs no install. Exit codes: 0 clean, 1 needs formatting, 2 error |
| oxfmt | `oxfmt --check` | `oxfmt --migrate=prettier` converts a Prettier configuration |
| Prettier | `prettier . --check` | Exit codes: 0 clean, 1 needs formatting, 2 Prettier error |

- If `package.json` has a `fmt` script, `bun fmt` runs that script. Pass `--no-script` in CI.
- A formatter swap is a proposal. Make it only when the user asks. Before a swap, run the new formatter with `--check` on an unchanged tree: each listed file is a diff that the swap adds.

## Lint

Measure the rule cost before you change the linter. `TIMING=all eslint .` prints the time per rule, and `eslint --stats` adds statistics ([rule profiling](https://eslint.org/docs/latest/extend/custom-rules#profile-rule-performance), [`--stats`](https://eslint.org/docs/latest/use/command-line-interface#--stats)). Propose a faster linter with its measured gain. Swap only when the user asks.

Oxlint implements many rules from ESLint core, typescript-eslint, React, Jest, Vitest, import, unicorn, and jsx-a11y. It does not implement every rule.

- Before a swap, prove parity: the same findings on a commit with one planted violation per enabled rule family. Rules that oxlint lacks stay in ESLint.
- Convert an ESLint flat configuration with `@oxlint/migrate`. Convert a legacy `.eslintrc` to flat configuration first.
- During a staged move, run `oxlint && eslint`.
- Put `eslint-plugin-oxlint` last in `eslint.config.js`, as `...oxlint.configs['flat/recommended']` or `...(await oxlint.buildFromConfigFile('./.oxlintrc.json'))`. It turns off the ESLint rules that oxlint already covers.
- Type-aware rules (`--type-aware` or root `options.typeAware: true`) need the `oxlint-tsgolint` dev dependency. They use TypeScript 7 configuration rules, so remove `baseUrl` from the tsconfig files.
- In a monorepo, build the packages before type-aware lint. Their `.d.ts` files must exist.
- Add `--deny-warnings` so that a warning fails the job. Inside GitHub Actions, oxlint turns on GitHub annotations by itself.
- Warning: oxlint lints `node_modules` when no ignore rule covers it. Add dependencies and build output to `.gitignore` or `ignorePatterns`.
- ESLint in CI: use `eslint --cache --cache-strategy content --cache-location <path>`. Restore `<path>` with `actions/cache/restore`. A fresh checkout changes file times, so the default `metadata` strategy misses.
- Warning: the ESLint cache does not track dependencies between files. Do not let `--cache` gate merges on type-aware or import rules. An ESLint run without `--cache` deletes the cache file.
- `eslint --concurrency <n>|auto` lints files in worker threads. Keep `<n>` at or below the runner core count.

## Type check

TypeScript 7 `tsc` is the native compiler and the default checker. Install the `typescript` package at major 7. Do not add `@typescript/native-preview` or `tsgo`: the `tsc` of TypeScript 7 supersedes them.

- `--checkers <n>` sets the checker worker count. In TypeScript 7.0, the default is 4 ([announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)). `--builders <n>` applies to `tsc -b` and multiplies with `--checkers`. Give `--checkers` one fixed value in every environment, because different values can rarely change results. Other tools detect the cores, such as Vitest `maxWorkers` and Bun.
- For a warm start, set `incremental`. Cache the `.tsbuildinfo` files, keyed on the lockfile and the tsconfig files, with a restore key. Before you rely on that cache, compare a warm run and a clean run on the same commit.
- TypeScript 7 turns TypeScript 6 defaults and deprecations into errors, for example `baseUrl` and `moduleResolution: node10`. Plan that migration as its own change.
- Another option is `oxlint --type-aware --type-check`. It reports TypeScript errors in the lint run. It is experimental.

TypeScript 7.0 has no programmatic application programming interface (API). Tools that import `typescript`, such as typescript-eslint and Volar-based tools, need TypeScript 6 under the `typescript` name:

```json
{ "devDependencies": { "typescript": "npm:@typescript/typescript6@^6", "@typescript/native": "npm:typescript@^7" } }
```

`bun check` (since Bun 1.4.3) is the faster Bun option. It applies TypeScript 7 rules and needs no `typescript` package. Know its limits:

- It writes no `.tsbuildinfo`, so every run is a full check. It emits no `.d.ts` or JavaScript, so keep `tsc` for declarations.
- It ignores `compilerOptions.plugins`, so it gives no language-service plugin diagnostics, such as Effect diagnostics.
- If `package.json` has a `check` script, `bun check` runs that script. Pass `--no-script`, or name the script `typecheck`. Do not define `"check": "bun check"`: a Bun version without the checker runs it in an endless loop.
- Inside GitHub Actions, it prints `::error` annotations. Add `--threads <n>` on shared runners.

Before you switch checkers, prove parity on the same commit. The script `parity.sh` below compares error codes and counts, because the output formats differ. Run `bash parity.sh` on the commit. Then run `bash parity.sh <code>` on a commit with one planted error of that code, for example `TS2322`. Exit 1 means that the counts differ. Exit 2 means that a checker did not start, one checker passed while the other found errors, or an output lacks the planted code.

```bash
planted=${1-}   # empty on the clean run
if bun x --no-install tsc --noEmit --pretty false > old.txt 2>&1; then old=0; else old=$?; fi   # the checker in use; "if" keeps the status with and without set -e
if bun check --no-script --no-pretty > new.txt 2>&1; then new=0; else new=$?; fi                # the candidate
if [ "$old" = 127 ] || [ "$new" = 127 ] || grep -qE '^error: (Script not found|Could not find an existing)' old.txt new.txt; then echo 'a checker did not start'; exit 2; fi   # Bun exits 1, not 127, for a missing script or binary
class() { case $1 in 0) echo clean ;; 1|2) echo errors ;; *) echo failed ;; esac; }   # tsc exits 1 or 2 on diagnostics, depending on emit; bun check exits 1
if [ "$(class "$old")" = failed ] || [ "$(class "$new")" = failed ]; then echo "a checker failed to run: $old and $new"; exit 2; elif [ "$(class "$old")" != "$(class "$new")" ]; then echo "one checker passed and one found errors: $old and $new"; exit 2; fi
if [ -n "$planted" ] && { [ "$old" = 0 ] || ! grep -qw -- "$planted" old.txt || ! grep -qw -- "$planted" new.txt; }; then echo "both checkers must fail and list $planted"; exit 2; fi
diff <(grep -oE 'TS[0-9]+' old.txt | sort | uniq -c) <(grep -oE 'TS[0-9]+' new.txt | sort | uniq -c)
```

## Job sketches

Both sketches use `runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}`, which `runner-fallback.md` explains. The release marked Latest can be an older major. So verify each action major before you copy a sketch: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

```yaml
# Bun project. package.json has "packageManager": "bun@<version>". push runs only on the default branch.
permissions: { contents: read }
jobs:
  check:
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: oven-sh/setup-bun@v2            # version from packageManager
      - run: bun fmt --no-script --check      # needs no install, so it fails first
      - id: deps
        uses: actions/cache/restore@v6
        with: { path: ~/.bun/install/cache, key: "bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}", restore-keys: "bun-${{ runner.os }}-" }
      - run: bun ci
      - if: github.event_name == 'push' && steps.deps.outputs.cache-hit != 'true' # only trusted runs write
        uses: actions/cache/save@v6
        with: { path: ~/.bun/install/cache, key: "${{ steps.deps.outputs.cache-primary-key }}" }
      - run: bun x --no-install oxlint --type-aware --deny-warnings
      - run: bun x --no-install tsc --noEmit   # default; bun check --no-script is the faster option
      - run: bun test
```

```yaml
# pnpm 12 project. package.json has "packageManager": "pnpm@<version>".
permissions: { contents: read }
jobs:
  check:
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: pnpm/setup@v3                   # pnpm from packageManager; runs a frozen install
        with: { runtime: "node@<major>", cache: true, save-cache: "${{ github.event_name == 'push' }}" } # only trusted runs save the store
      - run: pnpm exec prettier . --check     # the project formatter, first after the install
      - run: pnpm exec oxlint --type-aware --deny-warnings
      - run: pnpm exec tsc --noEmit
      - run: pnpm exec vitest run
```

## Sources

- Install: https://bun.com/docs/pm/cli/install, https://bun.com/docs/pm/lifecycle, https://bun.com/docs/pm/global-cache, https://bun.com/docs/pm/filter, https://github.com/oven-sh/setup-bun, https://pnpm.io/continuous-integration, https://pnpm.io/cli/install, https://github.com/pnpm/setup, https://github.com/pnpm/action-setup, https://docs.npmjs.com/cli/v11/commands/npm-ci, https://github.com/actions/setup-node, https://github.com/actions/cache/blob/main/examples.md, https://nodejs.org/en/blog/release/v25.0.0
- Postinstall downloads and filtered installs: https://docs.cypress.io/app/references/advanced-installation, https://pptr.dev/api/puppeteer.configuration, https://linear.app/now/ci-bottleneck-reworked
- Format: https://bun.com/docs/format, https://bun.com/blog/bun-v1.4.4, https://oxc.rs/docs/guide/usage/formatter, https://prettier.io/docs/cli
- Lint: https://eslint.org/docs/latest/extend/custom-rules#profile-rule-performance, https://oxc.rs/docs/guide/usage/linter.html, https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint.html, https://github.com/oxc-project/eslint-plugin-oxlint, https://oxc.rs/docs/guide/usage/linter/type-aware.html, https://oxc.rs/docs/guide/usage/linter/ci, https://eslint.org/docs/latest/use/command-line-interface
- Type check: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/, https://www.typescriptlang.org/tsconfig/#incremental, https://github.com/microsoft/typescript-go, https://bun.com/docs/runtime/check, https://bun.com/blog/bun-v1.4.3, https://docs.github.com/en/actions/reference/runners/github-hosted-runners
