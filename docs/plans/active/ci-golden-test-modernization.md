---
title: Modernize CI and golden tests
goal: Make CI faster and deterministic while preserving golden coverage, cleaning process/temp resources, publishing binaries atomically, and keeping releases rerunnable.
status: planned
created: "2026-07-17T17:36:07-03:00"
updated: "2026-07-17T17:59:10-03:00"
started_at: null
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: high
review_waivers: []
tags:
  - ci
  - golden-tests
  - performance
affected_paths:
  - package.json
  - cli/test/lib/harness.ts
  - cli/test/lib/goldenResources.ts
  - cli/test/lib/goldenSnapshot.ts
  - cli/test/lib/goldenExecution.ts
  - cli/test/lib/goldenCli.ts
  - cli/test/lib/goldenMutationCatalog.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/unit/claudeMigration.test.ts
  - cli/test/unit/pluginRefresh.test.ts
  - cli/test/unit/statusReadiness.test.ts
  - cli/test/unit/statusline.test.mjs
  - cli/test/unit/goldenExecution.test.ts
  - cli/build-binaries.sh
  - .github/actions/setup-bun-cache/action.yml
  - .github/workflows/parity.yml
  - .github/workflows/windows-entrypoints.yml
  - .github/workflows/release-cli.yml
  - .claude/skills/engine-native-context/SKILL.md
related_plans: []
review_status: null
planned_at_commit: 7754022d61cdd307a33e01a4be6bf16df22ec584
execution_base_commit: null
---

## Goal

Make pull requests fail faster and more deterministically while preserving golden regression coverage, improving process and temporary-resource cleanup, making binary publication atomic, and keeping releases rerunnable.

A “golden” is a checked-in expected-output snapshot. The dry-run suite compares normalized command output and exit codes. The mutation suite compares the resulting HOME file tree, child-command argv, output, exit codes, and additional migration/channel/TOML invariants. Intentional behavior changes update these files for human review; accidental changes fail CI.

## Context & rationale

The current Ubuntu gate serializes unit, runtime, and duplicate positive/prove-red golden work. The Windows gate performs a 107-second real LSP install during a settings smoke. The 507-line shared harness and 731-line mutation suite mix independent change axes. The end state preserves every regression contract while shortening the observed critical path, hardening release failures, and organizing test/workflow infrastructure into cohesive function-first modules with direct imports—pragmatic SRP and interface segregation, without classes, DI containers, compatibility barrels, or one-use interfaces.

Successful `golden-regression` runs `29602938295`, `29473528333`, `29463896434`, and `29461768731` establish the baseline. Ubuntu job durations were 144/157/146/141 seconds; Windows job durations were 203/378/178/215 seconds. The latest run’s major steps were unit 14s, dry-run positive/prove-red 12s/12s, mutation positive/prove-red 48s/49s, Windows dependency install 29s, Windows runtime modes 21s/17s, and Windows LSP-installing materialization 107s. Hosted timing is observed evidence, not a promised percentage.

## Environment & how-to-run

- Work from the repository root with pinned Bun `1.3.14` and the existing `bun.lock`.
- In the disposable completion checkout, run setup command `bun install --frozen-lockfile` exactly once before the ordered acceptance inventory.
- After the ordered acceptance inventory, run the exact project CI command `bun run test:ci` exactly once.
- Golden suites and process/signal checks are POSIX-only. Windows runtime acceptance requires GitHub-hosted `windows-2025`, native PowerShell, Git Bash, `%USERPROFILE%`, `%RUNNER_TEMP%`, and PATHEXT-aware `.cmd` resolution.
- Before filter/update/process work in Step 2, run `bun run typecheck`; `bun vitest run cli/test/unit/claudeMigration.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/statusReadiness.test.ts`; `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun`; and `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation`. Snapshot changes at this checkpoint trigger a STOP.

## Steps

| # | Task | Files | Depends | Status |
|---:|---|---|---|---|
| 1 | Make the local test entry points explicit and remove duplicated benchmark work | `package.json`; `cli/test/unit/statusline.test.mjs` | none | planned |
| 2 | Split the golden test infrastructure along real change axes, then harden it | `cli/test/lib/harness.ts`; `cli/test/lib/goldenResources.ts`; `cli/test/lib/goldenSnapshot.ts`; `cli/test/lib/goldenExecution.ts`; `cli/test/lib/goldenCli.ts`; `cli/test/lib/goldenMutationCatalog.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/unit/claudeMigration.test.ts`; `cli/test/unit/pluginRefresh.test.ts`; `cli/test/unit/statusReadiness.test.ts`; `cli/test/unit/goldenExecution.test.ts`; `.claude/skills/engine-native-context/SKILL.md` | 1 | planned |
| 3 | Make the standalone binary script deterministic | `cli/build-binaries.sh` | 1 | planned |
| 4 | Rebuild pull-request CI as a bounded parallel DAG | `.github/actions/setup-bun-cache/action.yml`; `.github/workflows/parity.yml`; `.github/workflows/windows-entrypoints.yml` | 1,2 | planned |
| 5 | Narrow and make release automation rerunnable | `.github/workflows/release-cli.yml` | 1,3,4 | planned |

### Step 1

**Make the local test entry points explicit and remove duplicated benchmark work**

- In `package.json`, keep the existing commands and add these exact scripts:
  - `"check:generated": "bun cli/scripts/generate-sot-payload.ts --check"`
  - `"test:runtime:posix": "bun cli/test/statusline-runtime-smoke.mjs posix"`
  - `"test:ci": "bun run check:generated && bun run typecheck && bun run test:unit && bun run test:runtime:posix && bun run golden:dryrun && bun run golden:mutation"`
  Change `prepack` to `bun run check:generated` so local packaging and CI use one source of truth. `test:ci` deliberately excludes prove-red because prove-red must exit non-zero; the workflow owns the wrapper that proves this is the expected failure. Windows runtime modes remain workflow-only because they require native PowerShell/Git Bash.
- Delete only the `keeps direct-Bun median below 100ms after warmup` test from `cli/test/unit/statusline.test.mjs`. Keep the preceding direct-execution byte/exit/stderr test. The dedicated `cli/test/statusline-runtime-smoke.mjs` already runs 30 warmed samples and enforces the direct-Bun performance ceiling, so the Vitest copy adds roughly 2.1 seconds to the observed unit run without adding a distinct contract.
- Leave `vitest.config.ts` worker pool, file parallelism, and isolation at Vitest defaults. The suite already gets per-file isolation and parallel execution; disabling isolation risks the existing `HOME`, `AGENTS_DIR`, `BUN_INSTALL`, and `TZ` mutations, while changing to forks/VM pools has no measured benefit. Do not add the resource-intensive hanging-process reporter to normal CI; it remains an opt-in diagnosis command if a hang is reproduced.

### Step 2

**Split the golden test infrastructure along real change axes, then harden it**

- First make a behavior-preserving clean cutover from the 507-line `cli/test/lib/harness.ts` to four function-first modules; do not add classes, a DI container, one-use interfaces, or a compatibility barrel:
  - `cli/test/lib/goldenResources.ts` owns repository/fixture roots, the registered temporary-directory set, stale sweeping, exit/signal cleanup, stub creation, and variant materialization. Export `REPO_DIR`, `FIXTURES_DIR`, `temporaryDir(prefix: string): string`, `registeredTemporaryDirs(): ReadonlyArray<string>`, `sweepStaleTemporaryDirs(nowMs?: number): void`, `cleanupTemporaryDirs(): void`, `makeStubDir(overrides?: Record<string, string | null>): string`, and `materializeVariant(base: string, files: Record<string, string>): string`. Return a copy from `registeredTemporaryDirs`, never the mutable set.
  - `cli/test/lib/goldenSnapshot.ts` owns output/path normalization, tree snapshots, text/tree diffs, and stable JSON serialization. Export `normalizeOutput`, `TreeSnapshot`, `snapshotTree`, `diffTrees`, `diffText`, and `stableStringify`; import `registeredTemporaryDirs` only for existing stub-path normalization.
  - `cli/test/lib/goldenExecution.ts` owns Bun discovery, PATH masking, HOME/run environment materialization, subprocess launch/result classification, argv-log reads, and run-home cleanup. Preserve and export `EngineRun`, `SplitRun`, and `EngineKind`; keep `RunOpts` private; export `runEngine`, `runEngineSplit`, `runPublicCli`, `readArgvLog`, `cleanup(runs: Array<EngineRun>): void`, and the new `checkedSpawnExitCode` specified below. Import resource helpers from `goldenResources.ts` and `normalizeOutput` from `goldenSnapshot.ts`; shell-building helpers remain private, and `goldenSnapshot.ts` never imports `goldenExecution.ts`.
  - `cli/test/lib/goldenCli.ts` is a leaf module for suite argument/filter parsing and console banners. Export the exact `GoldenOptions` shape `{ proveRed: boolean; updateGoldens: boolean; filter?: RegExp }`, `parseArgs(argv: Array<string>): GoldenOptions`, `labelSelected(label: string, filter?: RegExp): boolean`, and `banner(message: string): void`.
- Update every current `harness.ts` consumer to import directly from the module it uses, then delete `cli/test/lib/harness.ts`; no aliases or re-exports remain:
  - `cli/test/golden-dryrun.ts`: resources `REPO_DIR`, `makeStubDir`; execution `cleanup`, `runEngine`, `runPublicCli`; snapshot `diffText`, `stableStringify`; CLI `banner`, `labelSelected`, `parseArgs`.
  - `cli/test/golden-mutation.ts`: resources `FIXTURES_DIR`, `REPO_DIR`, `makeStubDir`, `materializeVariant`; execution `cleanup`, `readArgvLog`, `runEngine`, `runEngineSplit`, `runPublicCli`; snapshot `diffText`, `diffTrees`, `snapshotTree`, `stableStringify`, `TreeSnapshot`; CLI `banner`, `labelSelected`, `parseArgs`.
  - `cli/test/unit/claudeMigration.test.ts`: resources `FIXTURES_DIR`, `cleanupTemporaryDirs`, `makeStubDir`, `materializeVariant`; execution `cleanup`, `readArgvLog`, `runEngine`; snapshot `stableStringify`.
  - `cli/test/unit/pluginRefresh.test.ts`: resources `cleanupTemporaryDirs`, `makeStubDir`, `materializeVariant`; execution `cleanup`, `readArgvLog`, `runEngine`, `runPublicCli`; snapshot `stableStringify`.
  - `cli/test/unit/statusReadiness.test.ts`: resources `makeStubDir`; execution `cleanup`, `runEngine`, `runPublicCli`.
  This deletion concentrates each concern behind a smaller interface instead of scattering it, and the five direct consumers are the real test surface.
- Extract only the independent declarative catalog from the 731-line mutation suite into `cli/test/lib/goldenMutationCatalog.ts`. Move `RTK_INIT_FAILS`, `AGENT_BROWSER_STALE`, `NPM_INSTALL_FAILS`, `NPM_LATEST_ABOVE_VERIFIED`, `NPM_OFFLINE`, `LEGACY_CLAUDE_SETTINGS`, `LEGACY_CLAUDE_FILES`, `MATRIX`, `REPLAYS`, `TOML_DIR`, and `TOML_SHAPES`. The catalog imports `FIXTURES_DIR` from `goldenResources.ts` and `stableStringify` from `goldenSnapshot.ts`; it never imports the suite entry point. Keep `runCase`, replay/migration/advisor/TOML runners, `channelInvariantProblems`, `tomlInvariantProblems`, `collectCases`, comparison, update, and prove-red orchestration in `golden-mutation.ts`: they share deterministic ordering, live run state, and failure aggregation, so extracting them would create shallow modules or injected one-use interfaces. `golden-dryrun.ts` remains intact apart from direct imports because it has no second independent change axis.
  Preserve the current row shapes exactly:
  ```ts
  export interface MutationMatrixCase {
    fixture: string
    cmd: Array<string>
    stubs?: Record<string, string | null>
    variant?: string
  }

  export interface MutationReplayCase {
    fixture: string
    cmd: Array<string>
    cmd2?: Array<string>
    variant?: string
  }
  ```
  Keep the five stub-body constants and `LEGACY_CLAUDE_SETTINGS` private because only the catalog uses them. Named-export only `LEGACY_CLAUDE_FILES`, `MATRIX: Array<MutationMatrixCase>`, `REPLAYS: Array<MutationReplayCase>`, `TOML_DIR`, `TOML_SHAPES`, and the two row types; do not add a default export or generalize rows into a strategy interface/configuration file.
  Before changing filter/update/process behavior, require the structural cutover to pass `bun run typecheck`, `bun vitest run cli/test/unit/claudeMigration.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/statusReadiness.test.ts`, `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun`, and `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation`. A failure at this checkpoint is an import/module-boundary regression; fix the move without changing snapshots or behavior.
- After that structural-only cutover is green, harden filtering through `goldenCli.ts`: compile `GOLDEN_FILTER` once in `parseArgs` instead of constructing `new RegExp` for every label. An invalid regex must print `invalid GOLDEN_FILTER '<value>': <regex error>` and exit 2 before creating stubs or homes. Pass `options.filter` to every `labelSelected` call in both suites.
- Track selection explicitly. `golden-dryrun.ts` must exit 2 with `GOLDEN_FILTER matched no cases` when a non-empty filter selects zero rows. Change `golden-mutation.ts collectCases` to return `{ cases, invariantFailures, selectedChecks }`; increment `selectedChecks` for matrix, replay, migration, advisor, channel-invariant, and TOML labels. A normal filtered invariant-only run is valid when `selectedChecks > 0`; a filtered update requires at least one snapshot case because channel invariants do not write a golden.
- Fix filtered updates without changing full-update semantics:
  - no `GOLDEN_FILTER`: regenerate and replace the complete `cases` object, so deleted/renamed rows disappear;
  - with `GOLDEN_FILTER`: read the existing version-1 golden, overlay only newly collected case keys, preserve every unselected key, and write through `stableStringify`;
  - zero selected snapshot cases: exit 2 without writing.
  Harden each suite-local `readGoldens` to catch malformed JSON and reject anything other than an object with `version === 1` and an object-valued `cases`, with the golden path in the diagnostic.
- In `goldenResources.ts`, replace the shared persistent `join(tmpdir(), "golden-bun-cache")` with one process-scoped `temporaryDir("golden-bun-cache-")` used by every execution `runEnv`; register both `golden-bun-cache-` and the already-created `golden-fixture-` variant prefix for stale sweeping. Alongside the exit hook, register named `SIGINT` and `SIGTERM` handlers whose `try` performs synchronous cleanup and whose `finally` unregisters that handler and re-sends the same signal to the current PID. Successful, exceptional, interrupted, and stale runs therefore clean cache, fixture, home, stub, and mask directories while preserving shell-visible signal semantics.
- In `goldenExecution.ts`, make all three launch paths replace their Bash wrapper with the engine process. The private `engineCommand` returns `DOCKS_KIT_ENGINE=native-raw exec '<absolute Bun>' '<main.ts>' <quoted args>`; merged output runs `exec 2>&1; ${engineCommand(...)}`, split output runs `engineCommand(...)` directly, and the public CLI command starts with `exec '<absolute Bun>'`. Add `checkedSpawnExitCode(command: string, result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">): number`: return a numeric status; throw `<command> failed to spawn: <error>` when `error` is set (retaining `ETIMEDOUT`), `<command> terminated by signal <signal>` when `signal` is set, and `<command> completed without status or signal` otherwise. Route all three launch results through it and preserve the 120-second timeout, merged-channel ordering, path normalization, and Windows/POSIX behavior.
- Put snapshot/read work inside `try` and temp-home/fixture cleanup inside `finally` in mutation `runCase`, replay, legacy migration, advisor migration, TOML cases, and the dry-run public/native case runner. Keep process-exit cleanup as the last-resort guard. Do not parallelize rows inside either suite: deterministic collection order, same-HOME replay semantics, and update-file ownership stay sequential; CI parallelizes the two suites at job level.
- Add `cli/test/unit/goldenExecution.test.ts` for `checkedSpawnExitCode` numeric status, `ETIMEDOUT`, signal, and null-status branches; no focused execution-module test exists. Keep the golden contract unchanged: dry-run records normalized combined output plus exit code, mutation records resulting HOME tree hashes, argv log, normalized output, exit code, and migration/channel/TOML invariants, and `--prove-red` remains intentionally non-zero after one planted mismatch.
- Realign `.claude/skills/engine-native-context/SKILL.md` without rewriting its authored prose: replace `cli/test/lib/harness.ts` in the description with `cli/test/lib/golden*.ts`; replace its source entry with `goldenResources.ts`, `goldenExecution.ts`, `goldenSnapshot.ts`, `goldenCli.ts`, and `goldenMutationCatalog.ts`, each with exactly one `lines: "1-400"` coarse range; and set `metadata.updated: "2026-07-17"`. The Harness Geometry rules remain semantically valid; no other skill or agent cites `harness.ts`.

### Step 3

**Make the standalone binary script deterministic**

- Refactor `cli/build-binaries.sh` around the exact allowlist `linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64`. Validate every requested target before checking payloads or creating output; an unknown target prints the allowed values and exits 2.
- Build requested targets into `mktemp -d "$DIST/.build-XXXXXX"` on the same filesystem, register an `EXIT` trap that removes that staging directory, and begin publication only after target validation, payload checking, every requested compile, and checksum generation succeed. Any failure before publication leaves previously published binaries and `SHA256SUMS` untouched. Publish each binary atomically by same-filesystem rename and move `SHA256SUMS` last, so a mid-publication I/O failure is non-zero and cannot leave a manifest that falsely certifies a partial set; publication is atomic per file, not across the whole multi-file set.
- Record the requested output basenames in an array and generate `SHA256SUMS` from that explicit, `LC_ALL=C`-sorted set only—never from `docks-kit-*`. A default build replaces the five known platform binaries; a targeted build replaces only its requested binaries. Preserve the `sha256sum`/`shasum -a 256` portability fallback and generate the checksum file in staging before publishing it.
- Replace the final `ls | tr` report with the explicit built-output list. This prevents stale or unrelated `cli/dist/docks-kit-*` files from entering checksums or release assets.

### Step 4

**Rebuild pull-request CI as a bounded parallel DAG**

- In `.github/workflows/parity.yml`, preserve the current triggers/path filters and add `"vitest.config.ts"` to both push and pull-request paths. Add:
  ```yaml
  concurrency:
    group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
    cancel-in-progress: true
  ```
  This cancels superseded runs on the same PR/ref without allowing this workflow to cancel another workflow.
- Replace the serial Ubuntu `golden` job with three independent `ubuntu-24.04` jobs, each with `permissions: contents: read`, `timeout-minutes: 10`, checkout, pinned Bun setup, dependency-cache restore, and `bun install --frozen-lockfile`:
  1. `quality`: `bun run check:generated`, `bun run typecheck`, `bun run test:unit`, then `bun run test:runtime:posix`;
  2. `golden-dryrun`: `bun run golden:dryrun`, then the existing exit/marker wrapper around `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun --prove-red`;
  3. `golden-mutation`: `bun run golden:mutation`, then the existing exit/marker wrapper around `GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation --prove-red`.
  The anchored filters make each prove-red run execute one representative case instead of rerunning and printing mismatches for all 29 dry-run/75 mutation snapshots. Do not add `needs` edges among these jobs.
- Create the repository’s first local composite action at `.github/actions/setup-bun-cache/action.yml` to centralize the repeated Bun bootstrap policy introduced across eight job definitions. It has no inputs or outputs and no checkout, install, test, or build behavior; callers must remain explicit about those job-specific steps. Use this exact contract:
  ```yaml
  name: Setup pinned Bun and cache
  description: Install the kit-verified Bun runtime and restore its package cache.
  runs:
    using: composite
    steps:
      - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
        with:
          bun-version: 1.3.14
      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
        with:
          path: ${{ runner.temp }}/bun-install-cache
          key: ${{ runner.os }}-bun-1.3.14-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-bun-1.3.14-
  ```
  After checkout, use `./.github/actions/setup-bun-cache` in parity’s `quality`, `golden-dryrun`, `golden-mutation`, `runtime-windows`, and `native-windows`; Windows entrypoints’ `build-exe` and `bun-shim`; and release’s `build`. Each caller sets job-level `BUN_INSTALL_CACHE_DIR: ${{ runner.temp }}/bun-install-cache`; every caller except `bun-shim` runs its own visible `bun install --frozen-lockfile`. Do not cache `node_modules`, share caches across operating systems, or call the action from the deliberately Bun-free `exe-smoke`, `github-release`, or `npm-publish` jobs. Add `.github/actions/setup-bun-cache/**` to both push and pull-request path filters in `parity.yml` and `windows-entrypoints.yml`; release is tag-only and has no path filter.
- Split only the stateless Windows runtime checks into a `runtime-windows` matrix job on `windows-2025`, `timeout-minutes: 10`, `fail-fast: false`, and `mode: [powershell, git-bash]`; each leg runs `bun cli/test/statusline-runtime-smoke.mjs ${{ matrix.mode }}` after the standard setup/cache/install sequence. Keep the USERPROFILE-dependent sync/status/model/toolchain sequence in `native-windows`, with `timeout-minutes: 15`, because its steps intentionally share one hermetic home.
- In `native-windows` setup, prepend a runner-temp directory containing `.cmd` presence stubs named `intelephense.cmd`, `typescript-language-server.cmd`, and `tsc.cmd`, each with exact body `@echo off\r\nexit /b 0\r\n`. Write the directory to `$GITHUB_PATH` so it applies to subsequent steps. Run the materialization command as `bun cli/src/main.ts sync claude --skip-rtk --verbose` and assert `LSP server binaries present`. This step tests Windows settings materialization without downloading three global LSP packages; the separate hermetic step below retains missing-tool install coverage. This removes the observed 107-second network install from the PR critical path.
- Preserve the missing-LSP install branch without network access in a second `native-windows` step. Resolve Bun's absolute executable first; create a new isolated, step-local `USERPROFILE` and an `npm.cmd` stub with exact body `@echo off\r\n>> "%RUNNER_TEMP%\lsp-npm-argv.log" echo %*\r\nexit /b 0\r\n`, then replace that step's `Path` with only the npm-stub directory, Bun's directory, and `$env:SystemRoot\System32` so none of the three presence stubs can resolve. Invoke `& $bun cli/src/main.ts sync claude --skip-rtk --verbose` and assert exit 0 plus `LSP servers installed`. Read the three `verified` values from `SoT/toolchain.json` and require the argv log to contain exactly one line equal to `install -g intelephense@<verified> typescript-language-server@<verified> typescript@<tsc.verified>` (currently `1.18.5`, `5.3.0`, and `6.0.3`); do not duplicate those versions as workflow constants. This directly covers `claudeSync.ts syncLspServers` without the current 107-second registry install.
- In `.github/workflows/windows-entrypoints.yml`, add the same concurrency group/cancellation block and use the local Bun/cache action plus job-level `BUN_INSTALL_CACHE_DIR` in `build-exe` and `bun-shim`, but not in the deliberately no-Bun `exe-smoke`. Keep the repository install only in `build-exe`; `bun-shim` retains its package/tarball-specific global install. Set `timeout-minutes: 15` on `build-exe`, `timeout-minutes: 10` on `exe-smoke`, and `timeout-minutes: 15` on `bun-shim`. Preserve `build-exe -> exe-smoke` through the existing artifact and keep `bun-shim` independent; `exe-smoke` must not acquire setup/cache/install steps. No matrix or dependency edge is added to this already-correct DAG.

### Step 5

**Narrow and make release automation rerunnable**

- In `.github/workflows/release-cli.yml`, change `ubuntu-latest` to `ubuntu-24.04`, set workflow-level `permissions: {}`, and add the exact non-cancelling tag group below before splitting the current job:
  ```yaml
  concurrency:
    group: release-${{ github.ref }}
    cancel-in-progress: false
  ```
  1. `build` (`contents: read`, `timeout-minutes: 15`): checkout, use `./.github/actions/setup-bun-cache`, run the visible frozen install, derive non-empty `release_version="${GITHUB_REF_NAME#cli-v}"`, read `package.json.version` with Bun, and require equality before running `bun run typecheck`, `bun run build:binaries`, and `bun pm pack --destination cli/dist`. Require the sole tarball to be exactly `cli/dist/docks-kit-${release_version}.tgz`. Upload `cli/dist/docks-kit-linux-x64`, `cli/dist/docks-kit-linux-arm64`, `cli/dist/docks-kit-darwin-x64`, `cli/dist/docks-kit-darwin-arm64`, `cli/dist/docks-kit-windows-x64.exe`, `cli/dist/SHA256SUMS`, and that tarball as artifact `release-cli-${{ github.ref_name }}` with the pinned `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`, `if-no-files-found: error`, and `overwrite: true`.
  2. `github-release` (`needs: build`, `contents: write`, `timeout-minutes: 10`): download `release-cli-${{ github.ref_name }}` into `release-dist/` with the pinned `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`. In the release command step set `GH_TOKEN: ${{ github.token }}` and `GH_REPO: ${{ github.repository }}`, run `gh release view "$GITHUB_REF_NAME" || gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes`, then upload `release-dist/docks-kit-linux-x64`, `release-dist/docks-kit-linux-arm64`, `release-dist/docks-kit-darwin-x64`, `release-dist/docks-kit-darwin-arm64`, `release-dist/docks-kit-windows-x64.exe`, and `release-dist/SHA256SUMS` using `--clobber`; never use a `docks-kit-*` upload glob.
  3. `npm-publish` (`needs: [build, github-release]`, `contents: read`, `id-token: write`, `timeout-minutes: 10`): download the same artifact into `release-dist/`, require exactly one `release-dist/docks-kit-${version}.tgz` after deriving the non-empty version by removing `cli-v` from `GITHUB_REF_NAME`, set up Node 24, install exact `npm@11.18.0`, and query `npm view "docks-kit@${version}" version`. Exit successfully only when that exact version already exists; publish the downloaded tarball with `npm publish "$tgz" --provenance --access public` only on a registry E404; propagate authentication, trusted-publisher, network, provenance, and other registry failures.
- Keep GitHub-release attachment before npm publication so a failed asset release cannot leave npm as the only completed channel. Remove both blanket failure suppressions (`gh release create ... || true` and `npm publish ... || { ... exit 0; }`). Preserve exact action/tool pins and OIDC trusted publishing; no long-lived npm token is introduced.

## Interfaces & data shapes

### Golden module contracts

`goldenResources.ts` exports `REPO_DIR`, `FIXTURES_DIR`, `temporaryDir(prefix: string): string`, `registeredTemporaryDirs(): ReadonlyArray<string>`, `sweepStaleTemporaryDirs(nowMs?: number): void`, `cleanupTemporaryDirs(): void`, `makeStubDir(overrides?: Record<string, string | null>): string`, and `materializeVariant(base: string, files: Record<string, string>): string`.

`goldenSnapshot.ts` exports `normalizeOutput`, `TreeSnapshot`, `snapshotTree`, `diffTrees`, `diffText`, and `stableStringify`.

`goldenExecution.ts` preserves and exports `EngineRun`, `SplitRun`, and `EngineKind`; keeps `RunOpts` private; and exports `runEngine`, `runEngineSplit`, `runPublicCli`, `readArgvLog`, `cleanup(runs: Array<EngineRun>): void`, and `checkedSpawnExitCode`.

```ts
export interface MutationMatrixCase {
  fixture: string
  cmd: Array<string>
  stubs?: Record<string, string | null>
  variant?: string
}

export interface MutationReplayCase {
  fixture: string
  cmd: Array<string>
  cmd2?: Array<string>
  variant?: string
}
```

`goldenMutationCatalog.ts` named-exports only `LEGACY_CLAUDE_FILES`, `MATRIX: Array<MutationMatrixCase>`, `REPLAYS: Array<MutationReplayCase>`, `TOML_DIR`, `TOML_SHAPES`, and the two row types. The five stub-body constants and `LEGACY_CLAUDE_SETTINGS` stay private.

```ts
export interface GoldenOptions {
  proveRed: boolean
  updateGoldens: boolean
  filter?: RegExp
}

export function parseArgs(argv: Array<string>): GoldenOptions
export function labelSelected(label: string, filter?: RegExp): boolean
export function banner(message: string): void
```

```ts
export function checkedSpawnExitCode(
  command: string,
  result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">,
): number
```

It returns numeric status; throws `<command> failed to spawn: <error>` when `error` is set, `<command> terminated by signal <signal>` when `signal` is set, and `<command> completed without status or signal` otherwise.

### Local composite action contract

```yaml
name: Setup pinned Bun and cache
description: Install the kit-verified Bun runtime and restore its package cache.
runs:
  using: composite
  steps:
    - uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0
      with:
        bun-version: 1.3.14
    - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
      with:
        path: ${{ runner.temp }}/bun-install-cache
        key: ${{ runner.os }}-bun-1.3.14-${{ hashFiles('bun.lock') }}
        restore-keys: |
          ${{ runner.os }}-bun-1.3.14-
```

The action has no inputs, outputs, checkout, install, test, or build behavior.

### Workflow concurrency, job DAG, and release contract

PR workflows use:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Release uses:

```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

Parity nodes `quality`, `golden-dryrun`, `golden-mutation`, both `runtime-windows` matrix legs, and `native-windows` have no `needs`. Windows entrypoints retain `build-exe -> exe-smoke` with independent `bun-shim`. Release is `build -> github-release -> npm-publish`, and `npm-publish` needs both earlier jobs.

Build outputs are `docks-kit-linux-x64`, `docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`, `docks-kit-windows-x64.exe`, and `SHA256SUMS`. The build artifact adds exactly one `docks-kit-${release_version}.tgz` and is named `release-cli-${{ github.ref_name }}`. GitHub release assets are exactly the five binaries plus `SHA256SUMS`, never the tarball. `release_version="${GITHUB_REF_NAME#cli-v}"` is nonempty and equals `package.json.version`. npm publishes the downloaded tarball only on registry E404; an already-published exact version is success; all other failures propagate.

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | <code>test ! -e cli/test/lib/harness.ts<br>for module in goldenResources goldenExecution goldenSnapshot goldenCli goldenMutationCatalog; do<br>  test -f "cli/test/lib/${module}.ts"<br>done<br>test -z "$(grep -R -nE 'lib/harness\|from .*harness' \<br>  cli/test .claude/skills/engine-native-context/SKILL.md \|\| true)"<br>bun vitest run cli/test/unit/goldenExecution.test.ts<br><br>test "$(grep -R -h 'uses: ./.github/actions/setup-bun-cache' \<br>  .github/workflows/parity.yml \<br>  .github/workflows/windows-entrypoints.yml \<br>  .github/workflows/release-cli.yml \| wc -l)" -eq 8<br>test "$(grep -R -l 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' \<br>  .github --include='*.yml')" = ".github/actions/setup-bun-cache/action.yml"<br>test "$(grep -R -l 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9' \<br>  .github --include='*.yml')" = ".github/actions/setup-bun-cache/action.yml"<br>ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0))' \<br>  .github/actions/setup-bun-cache/action.yml<br>ruby -e 'require "yaml"; text = File.read(ARGV.fetch(0)); data = YAML.safe_load(text.split(/^---\s*$/).fetch(1)); rows = data.dig("metadata", "source_files"); abort "invalid source_files" unless rows.is_a?(Array) &amp;&amp; rows.all? { \|row\| File.file?(row.fetch("path")) &amp;&amp; row.fetch("lines").is_a?(String) }' \<br>  .claude/skills/engine-native-context/SKILL.md</code> | No compatibility harness remains; all replacement modules and the focused execution test exist; exactly eight Bun-enabled jobs use the local action; setup-bun and cache pins occur only there; action YAML and skill metadata parse with live paths. |
| A2 | <code>backup_dir="$(mktemp -d)"<br>cp cli/test/goldens/dryrun.json "$backup_dir/dryrun.json"<br>cp cli/test/goldens/mutation.json "$backup_dir/mutation.json"<br>restore_goldens() {<br>  cp "$backup_dir/dryrun.json" cli/test/goldens/dryrun.json<br>  cp "$backup_dir/mutation.json" cli/test/goldens/mutation.json<br>  rm -rf "$backup_dir"<br>}<br>trap restore_goldens EXIT<br><br>set +e<br>GOLDEN_FILTER='[' bun run golden:dryrun &gt; /tmp/dry-invalid-filter.out 2&gt;&amp;1<br>dry_invalid=$?<br>GOLDEN_FILTER='[' bun run golden:mutation &gt; /tmp/mutation-invalid-filter.out 2&gt;&amp;1<br>mutation_invalid=$?<br>GOLDEN_FILTER='definitely-no-such-case' bun run golden:dryrun &gt; /tmp/dry-empty-filter.out 2&gt;&amp;1<br>dry_empty=$?<br>GOLDEN_FILTER='definitely-no-such-case' bun run golden:mutation &gt; /tmp/mutation-empty-filter.out 2&gt;&amp;1<br>mutation_empty=$?<br>set -e<br>test "$dry_invalid" -eq 2<br>test "$mutation_invalid" -eq 2<br>test "$dry_empty" -eq 2<br>test "$mutation_empty" -eq 2<br>grep -F "invalid GOLDEN_FILTER '['" /tmp/dry-invalid-filter.out<br>grep -F "invalid GOLDEN_FILTER '['" /tmp/mutation-invalid-filter.out<br>grep -F "GOLDEN_FILTER matched no cases" /tmp/dry-empty-filter.out<br>grep -F "GOLDEN_FILTER matched no cases" /tmp/mutation-empty-filter.out<br><br>dry_before="$(sha256sum cli/test/goldens/dryrun.json \| cut -d' ' -f1)"<br>mutation_before="$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun --update-goldens<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation --update-goldens<br>test "$dry_before" = "$(sha256sum cli/test/goldens/dryrun.json \| cut -d' ' -f1)"<br>test "$mutation_before" = "$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br><br>GOLDEN_FILTER='^channel-invariants$' bun run golden:mutation<br>set +e<br>GOLDEN_FILTER='^channel-invariants$' bun run golden:mutation --update-goldens &gt; /tmp/invariant-update.out 2&gt;&amp;1<br>invariant_update=$?<br>set -e<br>test "$invariant_update" -eq 2<br>test "$mutation_before" = "$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br><br>printf '{broken\n' &gt; cli/test/goldens/dryrun.json<br>set +e<br>bun run golden:dryrun &gt; /tmp/dry-malformed.out 2&gt;&amp;1<br>dry_malformed=$?<br>set -e<br>test "$dry_malformed" -ne 0<br>grep -F "cli/test/goldens/dryrun.json" /tmp/dry-malformed.out<br>cp "$backup_dir/dryrun.json" cli/test/goldens/dryrun.json<br><br>printf '{broken\n' &gt; cli/test/goldens/mutation.json<br>set +e<br>bun run golden:mutation &gt; /tmp/mutation-malformed.out 2&gt;&amp;1<br>mutation_malformed=$?<br>set -e<br>test "$mutation_malformed" -ne 0<br>grep -F "cli/test/goldens/mutation.json" /tmp/mutation-malformed.out<br><br>restore_goldens<br>trap - EXIT<br>bun run golden:dryrun<br>bun run golden:mutation</code> | Both suites reject invalid and empty filters with exit 2; one-case updates preserve unselected cases byte-for-byte; invariant-only mutation runs but cannot update; malformed files name their path; restored full suites pass. |
| A3 | <code>set +e<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun --prove-red &gt; /tmp/dryrun-red.out 2&gt;&amp;1<br>dry_code=$?<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation --prove-red &gt; /tmp/mutation-red.out 2&gt;&amp;1<br>mutation_code=$?<br>set -e<br>test "$dry_code" -ne 0<br>test "$mutation_code" -ne 0<br>grep -F "prove-red OK: golden-dryrun detected 1 planted mismatch" /tmp/dryrun-red.out<br>grep -F "prove-red OK: golden-mutation detected 1 planted mismatch" /tmp/mutation-red.out</code> | Both commands exit non-zero and each expected marker reports exactly one planted mismatch. |
| A4 | <code>tmp_root="$(mktemp -d)"<br>TMPDIR="$tmp_root" GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>rmdir "$tmp_root"<br><br>bash_stub="$(mktemp -d)"<br>tmp_root="$(mktemp -d)"<br>printf '#!/bin/sh\nkill -TERM $$\n' &gt; "$bash_stub/bash"<br>chmod +x "$bash_stub/bash"<br>set +e<br>TMPDIR="$tmp_root" PATH="$bash_stub:$PATH" \<br>  GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' \<br>  bun run golden:dryrun &gt; /tmp/golden-signal.out 2&gt;&amp;1<br>signal_code=$?<br>set -e<br>test "$signal_code" -ne 0<br>grep -F "terminated by signal SIGTERM" /tmp/golden-signal.out<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>rm -rf "$bash_stub" "$tmp_root"<br><br>tmp_root="$(mktemp -d)"<br>suite_pid=""<br>trap 'if [[ -n "$suite_pid" ]]; then kill -KILL "$suite_pid" 2&gt;/dev/null \|\| true; fi; rm -rf "$tmp_root"' EXIT<br>TMPDIR="$tmp_root" bun cli/test/golden-mutation.ts &gt; /tmp/golden-parent-signal.out 2&gt;&amp;1 &amp;<br>suite_pid=$!<br>stub_ready=""<br>for _ in $(seq 1 500); do<br>  stub_ready="$(find "$tmp_root" -mindepth 1 -maxdepth 1 -name 'golden-stubs-*' -print -quit)"<br>  [[ -n "$stub_ready" ]] &amp;&amp; break<br>  sleep 0.01<br>done<br>test -n "$stub_ready"<br>kill -TERM "$suite_pid"<br>set +e<br>wait "$suite_pid"<br>parent_signal_code=$?<br>set -e<br>suite_pid=""<br>test "$parent_signal_code" -eq 143<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>trap - EXIT<br>rmdir "$tmp_root"</code> | Successful and signal-terminated runs remove cache, fixture, home, stub, and mask directories; spawn classification covers numeric, ETIMEDOUT, signal, and null status; parent SIGTERM remains exit 143. |
| A5 | <code>set +e<br>bash cli/build-binaries.sh not-a-target<br>invalid_code=$?<br>set -e<br>test "$invalid_code" -eq 2<br><br>bash cli/build-binaries.sh windows-x64<br>(cd cli/dist &amp;&amp; sha256sum -c SHA256SUMS)<br>test "$(awk '{print $2}' cli/dist/SHA256SUMS)" = "docks-kit-windows-x64.exe"<br>binary_before="$(sha256sum cli/dist/docks-kit-windows-x64.exe \| cut -d' ' -f1)"<br>manifest_before="$(sha256sum cli/dist/SHA256SUMS \| cut -d' ' -f1)"<br><br>real_bun="$(command -v bun)"<br>bun_stub="$(mktemp -d)"<br>cat &gt; "$bun_stub/bun" &lt;&lt;EOF<br>#!/bin/bash<br>if [[ "\$1" == */cli/scripts/generate-sot-payload.ts ]]; then exec "$real_bun" "\$@"; fi<br>case " \$* " in<br>  *" --target=bun-linux-x64 "*)<br>    while [[ \$# -gt 0 ]]; do<br>      if [[ "\$1" == "--outfile" ]]; then printf 'planted staged output' &gt; "\$2"; exit 0; fi<br>      shift<br>    done<br>    ;;<br>  *" --target=bun-linux-arm64 "*) exit 9 ;;<br>esac<br>exec "$real_bun" "\$@"<br>EOF<br>chmod +x "$bun_stub/bun"<br>set +e<br>PATH="$bun_stub:$PATH" bash cli/build-binaries.sh linux-x64 linux-arm64<br>planted_code=$?<br>set -e<br>test "$planted_code" -eq 9<br>test "$binary_before" = "$(sha256sum cli/dist/docks-kit-windows-x64.exe \| cut -d' ' -f1)"<br>test "$manifest_before" = "$(sha256sum cli/dist/SHA256SUMS \| cut -d' ' -f1)"<br>test -z "$(find cli/dist -mindepth 1 -maxdepth 1 -type d -name '.build-*' -print -quit)"<br>rm -rf "$bun_stub"<br><br>bun run build:binaries<br>(cd cli/dist &amp;&amp; sha256sum -c SHA256SUMS)<br>printf '%s\n' \<br>  docks-kit-darwin-arm64 \<br>  docks-kit-darwin-x64 \<br>  docks-kit-linux-arm64 \<br>  docks-kit-linux-x64 \<br>  docks-kit-windows-x64.exe &gt; /tmp/expected-binaries<br>awk '{print $2}' cli/dist/SHA256SUMS \| diff -u /tmp/expected-binaries -</code> | Unknown targets exit 2 before building; planted staged failure preserves published bytes and manifest and removes staging; targeted/full manifests contain only sorted invocation outputs. |
| A6 | <code>curl -fsSLo /tmp/actionlint_1.7.12_linux_amd64.tar.gz \<br>  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz<br>printf '%s  %s\n' \<br>  8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \<br>  /tmp/actionlint_1.7.12_linux_amd64.tar.gz \| sha256sum -c -<br>rm -rf /tmp/actionlint-1.7.12<br>mkdir /tmp/actionlint-1.7.12<br>tar -xzf /tmp/actionlint_1.7.12_linux_amd64.tar.gz -C /tmp/actionlint-1.7.12<br>/tmp/actionlint-1.7.12/actionlint \<br>  .github/workflows/parity.yml \<br>  .github/workflows/windows-entrypoints.yml \<br>  .github/workflows/release-cli.yml</code> | Pinned actionlint v1.7.12 archive checksum verifies and actionlint exits 0 for all workflows. |
| A7 | <code>gh workflow run parity.yml --ref &lt;branch&gt;<br>  gh run list --workflow parity.yml --branch &lt;branch&gt; --limit 3 \<br> --json databaseId,conclusion,createdAt,updatedAt,url<br>  gh api repos/DocksDocks/public/actions/runs/&lt;run-id&gt;/jobs \<br> --jq '.jobs[] \| [.name, ((.completed_at\|fromdateiso8601)-(.started_at\|fromdateiso8601)), .conclusion] \| @tsv'</code> | Repeat until three successful runs exist. All six parity legs start without needs and pass; each prove-red reports one mismatch; Windows presence and isolated missing-LSP checks avoid network installs and record exact pinned npm argv. |
| A8 | <code>gh run list --workflow parity.yml --branch &lt;branch&gt; --limit 3 --json databaseId,conclusion,createdAt,updatedAt,url<br>gh api repos/DocksDocks/public/actions/runs/&lt;run-id&gt;/jobs --jq '.jobs[] \| [.name, ((.completed_at\|fromdateiso8601)-(.started_at\|fromdateiso8601)), .conclusion] \| @tsv'</code> | Across three successful runs, the queue-excluded median longest-job duration is below the pre-change 209-second median; all six legs remain independent and mutation is plausibly longest on Ubuntu. |
| A9 | <code>gh workflow run parity.yml --ref &lt;branch&gt;<br>gh workflow run parity.yml --ref &lt;branch&gt;<br>gh run list --workflow parity.yml --branch &lt;branch&gt; --limit 2 --json databaseId,conclusion,url</code> | With overlapping dispatches, the older run is cancelled and the newer run proceeds. |
| A10 | <code>gh workflow run parity.yml --ref &lt;branch&gt;<br>gh run list --workflow parity.yml --branch &lt;branch&gt; --limit 1 --json databaseId,conclusion,url<br>gh run view &lt;run-id&gt; --log</code> | A warm run restores the Bun package cache and still executes the visible frozen dependency install. |
| A11 | <code>gh workflow run windows-entrypoints.yml --ref &lt;branch&gt;<br>gh run list --workflow windows-entrypoints.yml --branch &lt;branch&gt; --limit 1 --json databaseId,conclusion,url<br>gh run view &lt;run-id&gt; --log</code> | build-exe, dependent exe-smoke, and independent bun-shim pass; exe-smoke logs contain no Bun setup. |
| A12 | <code>gh run list --workflow release-cli.yml --limit 1 --json databaseId,conclusion,headBranch,url<br>gh release view &lt;cli-v-tag&gt; --json assets,tagName,url<br>npm view "docks-kit@&lt;version&gt;" version</code> | On the next cli-v* tag the graph is build → github-release → npm-publish; GitHub has exactly five binaries plus SHA256SUMS; npm has the exact version with provenance. |
| A13 | <code>gh run rerun &lt;release-run-id&gt;<br>gh run watch &lt;release-run-id&gt;</code> | A rerun treats existing release assets and the exact npm version as success, while unexpected API/auth/network/trusted-publisher/provenance failures remain non-zero. |

## Out of scope / do-NOT-touch

- Keep rows sequential inside both golden suites; parallelize only the two suites at CI job level.
- Leave `vitest.config.ts` worker pool, file parallelism, and isolation at defaults.
- Keep no-Bun Windows `exe-smoke` independent and free of setup/cache/install behavior.
- Do not change dependency versions, golden contracts, runtime command behavior, or generated snapshots except the explicitly required filtered-update behavior.
- Do not add classes, dependency injection, one-use interfaces, compatibility barrels, aliases, default exports, generalized strategy/configuration schemas, or a normal-CI hanging-process reporter.

## Known gotchas

- Bash engine support is removed. Golden engine launches use `DOCKS_KIT_ENGINE=native-raw`; wrapper commands must `exec` the engine so timeout and signal classification describe the real process.
- Snapshot collection order is deterministic. Mutation replay intentionally runs twice against the same HOME; row parallelism would break ordering, replay semantics, and update ownership.
- Signal handlers clean synchronously, unregister themselves, then re-send the same signal to the current PID so shell-visible semantics survive.
- Cache key: `${{ runner.os }}-bun-1.3.14-${{ hashFiles('bun.lock') }}`. Restore key: `${{ runner.os }}-bun-1.3.14-`. Never cache `node_modules` or cross operating systems.
- Windows presence is PATHEXT-aware: `.cmd` stubs resolve through `Path`. Stateful native checks share one hermetic `%USERPROFILE%`; the missing-LSP step uses a separate USERPROFILE and a replaced Path so presence stubs cannot leak.
- GitHub jobs share neither filesystem nor process state; release outputs cross jobs only through the named artifact.
- npm trusted publishing is assumed for `DocksDocks/public` and `release-cli.yml` without a GitHub Environment. If npm names an environment, use that exact name; never guess or add a token.
- Hosted runner `2.335.1` satisfies actions/cache v6. Upgrade a future stale self-hosted runner instead of downgrading or floating the action.

## Global constraints

- Runners: `ubuntu-24.04` and `windows-2025` exactly where specified.
- Bun `1.3.14`; Node `24`; npm `11.18.0`; actionlint `v1.7.12`.
- LSP pins from `SoT/toolchain.json`: intelephense `1.18.5`, typescript-language-server `5.3.0`, TypeScript/tsc `6.0.3`; never duplicate them as workflow constants.
- `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` (`v7.0.0`).
- `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (`v2.2.0`).
- `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (`v6.1.0`).
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`).
- `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` (`v4.3.0`).
- `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` (`v6.4.0`).
- actionlint archive SHA-256 `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
- Binary allowlist: `linux-x64 linux-arm64 darwin-x64 darwin-arm64 windows-x64`.
- Golden snapshot schema remains version `1`; dry-run and mutation payload contracts remain unchanged.

## STOP conditions

Stop rather than improvise if:

1. Any cited action SHA/version no longer matches checked-in workflow/toolchain source.
2. A harness consumer exists beyond the five enumerated in Step 2.
3. The structural cutover changes snapshots.
4. Release artifact inventory differs from the five specified binaries plus `SHA256SUMS`.

## Cold-handoff checklist

- [x] 1. File manifest — the five-row `## Steps` table and detailed steps name every created, changed, and deleted path.
- [x] 2. Environment & commands — `## Environment & how-to-run` fixes setup/CI order, runtimes, platforms, and the structural checkpoint.
- [x] 3. Interface & data contracts — `## Interfaces & data shapes` fixes exports, action YAML, DAGs, and release contracts.
- [x] 4. Executable acceptance — `## Acceptance criteria` provides ordered `A1…A13` commands covering local, hosted, cancellation, cache, Windows, and release behavior.
- [x] 5. Out of scope — `## Out of scope / do-NOT-touch` preserves sequential rows, Vitest defaults, no-Bun smoke, and existing contracts.
- [x] 6. Decision rationale — `## Context & rationale` plus each detailed step explains fan-out, boundaries, cleanup, atomic publication, and release ordering.
- [x] 7. Known gotchas — `## Known gotchas` records native-raw, ordering, replay, signals, cache keys, Windows PATH/HOME, job isolation, and trusted publishing.
- [x] 8. Global constraints verbatim — `## Global constraints` carries exact runners, versions, SHAs, hashes, targets, and schema.
- [x] 9. No undefined terms / forward refs — every interface, job, artifact, command, and proposed path is defined; no deferred implementation placeholder remains.

## Self-review
Review-receipt: {"input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","outcome":"not_ready","phase":"draft","policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":5},"policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","pre_execution_eligible":false,"reproduced":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"8b8fc1817a591fbefdb25324c1e7983e1898550d4fd97621b0bc6a978bd2b64e","diff_sha256":null,"execution_base_commit":null,"input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","lifecycle_intent":"none","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":5},"policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"81a4b2a9-863a-493b-a9c9-9d7e5eaf49b1","review_mode":"full","reviewed_commit_or_head":"881c9c3e39e84df0eed7f1a1364d232d43b35660","round_index":1,"schema":5},"reviewed_at":"2026-07-17T17:59:10-03:00","reviewed_commit":"881c9c3e39e84df0eed7f1a1364d232d43b35660","reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"267850","denial_source":null,"exit_code":null,"output_started":false,"reason":"600-second reviewer deadline expired before reviewer output","result":"deadline_exceeded","schema":5,"signal":"SIGKILL","started":true,"stderr_sha256":"1aa26269eb1cc57f86b235a03cda53c004edb5b1e9fc99d4da4f00843293d721","stdout_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":null,"reason":"Primary reviewer exceeded the 600-second deadline before producing output.","request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"8b8fc1817a591fbefdb25324c1e7983e1898550d4fd97621b0bc6a978bd2b64e","diff_sha256":null,"execution_base_commit":null,"input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","lifecycle_intent":"none","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":5},"policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"81a4b2a9-863a-493b-a9c9-9d7e5eaf49b1","review_mode":"full","reviewed_commit_or_head":"881c9c3e39e84df0eed7f1a1364d232d43b35660","round_index":1,"schema":5},"result":"failed","reviewer_output":null,"role":"primary","schema":5,"selected":null,"waiver":null,"waiver_sha256":null},"rejected":[]},"schema":5,"series":{"current_input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","initial_input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","repairs":[],"rounds":[{"kind":"draft","outcome":"not_ready","pre_execution_eligible":false,"reproduced":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"8b8fc1817a591fbefdb25324c1e7983e1898550d4fd97621b0bc6a978bd2b64e","diff_sha256":null,"execution_base_commit":null,"input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","lifecycle_intent":"none","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":5},"policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"81a4b2a9-863a-493b-a9c9-9d7e5eaf49b1","review_mode":"full","reviewed_commit_or_head":"881c9c3e39e84df0eed7f1a1364d232d43b35660","round_index":1,"schema":5},"reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"267850","denial_source":null,"exit_code":null,"output_started":false,"reason":"600-second reviewer deadline expired before reviewer output","result":"deadline_exceeded","schema":5,"signal":"SIGKILL","started":true,"stderr_sha256":"1aa26269eb1cc57f86b235a03cda53c004edb5b1e9fc99d4da4f00843293d721","stdout_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":null,"reason":"Primary reviewer exceeded the 600-second deadline before producing output.","request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"8b8fc1817a591fbefdb25324c1e7983e1898550d4fd97621b0bc6a978bd2b64e","diff_sha256":null,"execution_base_commit":null,"input_sha256":"0905c359c524b18669b085732bc0499ad08b13136d06bb4c2ad6106b36bc8097","lifecycle_intent":"none","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":5},"policy_sha256":"9629d2b08ff15aa63e30f6177f537c7d0f804d8d7847093c251169253fdf07ab","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"81a4b2a9-863a-493b-a9c9-9d7e5eaf49b1","review_mode":"full","reviewed_commit_or_head":"881c9c3e39e84df0eed7f1a1364d232d43b35660","round_index":1,"schema":5},"result":"failed","reviewer_output":null,"role":"primary","schema":5,"selected":null,"waiver":null,"waiver_sha256":null},"rejected":[]},"schema":5}],"schema":5}}

One local pass · caught: execution→snapshot normalization dependency and catalog-only export surface; both repaired.
Primary review (2026-07-17): [primary: openai gpt-5.6-sol high] not_ready — accepted none / rejected none (none); [openai codex gpt-5.6-sol high] independently reproduced accepted blocking ids none.

## Review

(filled by plan-review on completion)

## Sources

- `package.json` — scripts, dependencies, and packaging entry points.
- `bun.lock` — frozen dependency lockfile.
- `vitest.config.ts` — current default worker/file/isolation behavior.
- `cli/scripts/generate-sot-payload.ts` — generated payload check shared by CI and prepack.
- `cli/test/lib/harness.ts` — resource, execution, snapshot, CLI, and variant helpers; exactly five consumers.
- `cli/test/lib/goldenResources.ts` — planned resource boundary (new).
- `cli/test/lib/goldenSnapshot.ts` — planned snapshot boundary (new).
- `cli/test/lib/goldenExecution.ts` — planned execution boundary (new).
- `cli/test/lib/goldenCli.ts` — planned CLI/filter boundary (new).
- `cli/test/lib/goldenMutationCatalog.ts` — planned catalog boundary (new).
- `cli/test/golden-dryrun.ts` — rows, comparison/update, and prove-red orchestration.
- `cli/test/golden-mutation.ts` — catalog, stateful runners, invariants, update, and prove-red orchestration.
- `cli/test/goldens/dryrun.json` — version-1 dry-run snapshots.
- `cli/test/goldens/mutation.json` — version-1 mutation snapshots.
- `cli/test/unit/claudeMigration.test.ts` — migration harness consumer.
- `cli/test/unit/pluginRefresh.test.ts` — refresh harness consumer.
- `cli/test/unit/statusReadiness.test.ts` — readiness harness consumer.
- `cli/test/unit/statusline.test.mjs` — duplicate direct-Bun median benchmark.
- `cli/test/unit/goldenExecution.test.ts` — planned spawn-classification coverage (new).
- `cli/test/statusline-runtime-smoke.mjs` — 30-sample dedicated runtime performance contract.
- `cli/build-binaries.sh` — target loop, wildcard checksum, and publication behavior.
- `.github/actions/setup-bun-cache/action.yml` — planned composite action (new).
- `.github/workflows/parity.yml` — serial Ubuntu and stateful Windows gates.
- `.github/workflows/windows-entrypoints.yml` — build-exe → exe-smoke and independent bun-shim.
- `.github/workflows/release-cli.yml` — single-job release, exact pins, and suppressed failures.
- `SoT/toolchain.json` — Bun and LSP verified versions.
- `cli/src/main.ts` — CLI invoked by Windows checks.
- `cli/src/engine-native/claudeSync.ts` — `syncLspServers` presence/install branches.
- `.claude/skills/engine-native-context/SKILL.md` — harness/golden source metadata.
- <https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz> — official pinned actionlint archive used by A6.
