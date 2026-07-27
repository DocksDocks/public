---
title: Harden CI, golden execution, and rerunnable releases
goal: Make CI deterministic and bounded, harden golden-process cleanup and filtered updates, publish binaries atomically, and make the tag release workflow rerunnable without suppressing real failures.
status: ongoing
created: "2026-07-27T00:23:11.880+00:00"
updated: "2026-07-27T01:09:25.249+00:00"
started_at: "2026-07-27T01:09:25.249+00:00"
finished_at: null
assignee: null
tags:
  - ci
  - golden-tests
  - release
affected_paths:
  - .claude/skills/engine-native-context/SKILL.md
  - .github/actions/setup-bun-cache/action.yml
  - .github/workflows/parity.yml
  - .github/workflows/release-cli.yml
  - cli/build-binaries.sh
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/lib/goldenCli.ts
  - cli/test/lib/goldenExecution.ts
  - cli/test/lib/goldenMutationCatalog.ts
  - cli/test/lib/goldenResources.ts
  - cli/test/lib/goldenSnapshot.ts
  - cli/test/lib/harness.ts
  - cli/test/unit/claudeMigration.test.ts
  - cli/test/unit/goldenCli.test.ts
  - cli/test/unit/goldenExecution.test.ts
  - cli/test/unit/modelSyncCharacterization.test.ts
  - cli/test/unit/pluginRefresh.test.ts
  - cli/test/unit/statusReadiness.test.ts
  - cli/test/unit/statusline.test.mjs
  - cli/test/unit/toolchain.test.ts
  - docs/plans/active/ci-golden-test-and-release-hardening.md
  - package.json
related_plans:
  - docs/plans/active/ci-golden-test-modernization.md
---

Plan-run: {"acceptance":null,"blocker":null,"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"input_sha256":"0c8cf7f93976a18b7d1bada1262665ae95246173c258a6d6bab83c8727d88394","invocations":1,"result_sha256":"97215587ef8286c2c8dd11a75314dfb1ed876e757b523ea29784f2e9c69f8e9e","state":"passed"},"execution_parent":"432748e5e24abbfbe35d39a8620a510628bdf6c6","goal_id":"b8c91622-819a-44d9-ba0e-6ced02b86ba5","implementation_commit":null,"plan_path":"docs/plans/active/ci-golden-test-and-release-hardening.md","plan_sha256":"2628851a03dcf0293674b18d5997d706d422c537d17d7127033e07b9e18de645","repository_id":"DocksDocks/public","requested_effects":["local","probe"],"risk":"external","run_id":"d2ffdc34-f9b4-418e-98c7-da9474aba0b2","schema":1,"source_base":"5688b561224b89abd138a79ff4673c0977bc590d","source_sha256":"b81d3c30a2a7a306c0959d9487ed6e07084435db4f751682914a5f9bd834aa9f"}

## Goal

Make pull-request CI deterministic and bounded, harden golden-suite process
cleanup and filtered golden updates, publish standalone binaries atomically, and
make the `cli-v*` tag release workflow rerunnable — without suppressing any real
failure.

A "golden" is a checked-in expected-output snapshot. `cli/test/goldens/dryrun.json`
compares normalized command output and exit codes; `cli/test/goldens/mutation.json`
compares the resulting HOME file tree, child-command argv, output, exit codes, and
migration/channel/TOML invariants. Both stay schema `version: 1`; both files are
unchanged by this plan except through the explicitly specified filtered-update
behavior, which must leave unselected keys byte-identical.

## Context & rationale

This plan carries forward the still-useful goal of the record-free legacy plan
`docs/plans/active/ci-golden-test-modernization.md`. That file is preserved
byte-for-byte and is neither resumed nor archived: it predates the current
PlanRunV1 contract and its own frontmatter records `status: blocked` with
`blocked_reason` naming invalidated review evidence. It is legacy-quarantined
render-only evidence and grants this plan no authority.

Observed current state at `source_base`, all re-read directly:

- `package.json` (46 lines, version `0.12.0`) has exactly `typecheck`,
  `build:binaries`, `prepack`, `golden:dryrun`, `golden:mutation`, and
  `test:unit`. There is no `check:generated`, `test:runtime:posix`, or `test:ci`.
  `prepack` is `bun cli/scripts/generate-sot-payload.ts --check`.
- `cli/test/lib/harness.ts` is 513 lines and mixes four independent change axes:
  filesystem resources, subprocess execution, snapshot/diff, and suite CLI
  parsing. It has exactly seven importers, verified by grep for `lib/harness`:
  `cli/test/golden-dryrun.ts`, `cli/test/golden-mutation.ts`,
  `cli/test/unit/claudeMigration.test.ts`,
  `cli/test/unit/modelSyncCharacterization.test.ts`,
  `cli/test/unit/pluginRefresh.test.ts`, `cli/test/unit/statusReadiness.test.ts`,
  and `cli/test/unit/toolchain.test.ts`. The legacy plan enumerated only five;
  `modelSyncCharacterization.test.ts` and `toolchain.test.ts` are the two extra
  consumers this plan must also cut over.
- `harness.ts` has two load-time side effects that are not exports:
  `sweepStaleTemporaryDirs()` at line 84 and
  `process.on("exit", cleanupTemporaryDirs)` at line 85. They implement the leak
  fix recorded in `docs/plans/finished/2026-07-10-golden-harness-temp-leak.md`
  and must survive the split; an export-list-only contract would silently drop
  them.
- `HARNESS_TEMP_PREFIXES` is exactly `["golden-home-", "golden-stubs-",
  "golden-mask-"]`, but `materializeVariant` creates `golden-fixture-` dirs and
  `runEnv` points `BUN_INSTALL_CACHE_DIR` at the shared persistent
  `join(tmpdir(), "golden-bun-cache")`. Neither prefix is swept.
- `snapshotTree` reads the module-private `TEMP_DIRS` set, and `runEngine`,
  `runEngineSplit`, and `runPublicCli` all call `normalizeOutput`. The split
  therefore needs `registeredTemporaryDirs()` in the resource module and one
  permitted edge from execution to snapshot.
- All three `spawnSync` call sites classify results as `res.status ?? 1`: a spawn
  error, a killing signal, and a null/null result are indistinguishable from a
  clean exit code 1 today.
- `parseArgs` currently returns `{ proveRed, updateGoldens }` and
  `labelSelected(label: string)` compiles `new RegExp(GOLDEN_FILTER)` per label;
  there is no compiled-once filter and no zero-match diagnostic.
- `engineCommand` is currently exported but has no importer outside
  `harness.ts`, so making it private is a safe clean cutover.
- `cli/build-binaries.sh` is 36 lines. Its target allowlist and exit-2 validation
  already exist, `ARTIFACTS` is already an explicit array (there is no
  `docks-kit-*` checksum glob), and the final report already lists explicit
  basenames. The real gaps are: no staging directory, no `EXIT` trap, no atomic
  publication, and a manifest that is written in place over live outputs.
- `.github/workflows/parity.yml` is 87 lines with one serial `golden` job, no
  `concurrency`, no job-level `permissions` or `timeout-minutes`, and no
  `vitest.config.ts` in either path list. `.github/actions/` does not exist.
- `.github/workflows/release-cli.yml` is 66 lines: `runs-on: ubuntu-latest`,
  workflow permissions `contents: write` plus `id-token: write`, no
  `concurrency`, a single `release` job, a `docks-kit-*` upload glob, and two
  blanket suppressions — `gh release create ... || true` at line 45 and
  `npm publish ... || { echo warning; exit 0; }` at lines 63-66.

**Risk tier and declared effects.** Every implementation row in this plan is
`Effect: local`. Step 8 additionally fetches the pinned actionlint v1.7.12
archive over the network from `github.com`, which is a real remote read, so that
row is declared `Effect: probe` instead of being mislabelled local.

`probe` is an external effect under this workspace contract, and the contract
requires `risk: "external"` for any run whose `requested_effects` contain an
external effect. `risk: "sensitive"` together with
`requested_effects: ["local","probe"]` is therefore not a representable
combination: the installed workspace validator rejects that exact pair. This run
correctly declares `requested_effects: ["local","probe"]` with `risk: "external"`,
and that value must not be changed to `"sensitive"` while the probe row exists.

`external` requires a passed draft review before start and a passed completion
review before finish. The declaration records intended scope only. It grants no
authority: step 8 still requires a live `ExternalAuthorityV1` with scope `probe`,
`mode: "read"`, and a matching target at the moment of action, and every other
row stays local.

**Affected-path manifest semantics.** The bound affected-path manifest is a
pre-change snapshot of every path this plan touches, taken at `source_base`
before any edit. An entry with `"state": "file"` is an existing input that this
plan may rewrite or delete — `cli/test/lib/harness.ts` is present precisely
because step 3 deletes it, and its recorded digest is what proves the deletion
started from known bytes. An entry with `"state": "missing"` is a tombstone for a
path this plan creates. Neither is a defect, and the manifest is not a
post-change inventory.

## Environment & how-to-run

- Work from `/home/vagrant/projects/public` with pinned Bun `1.3.14` and the
  existing `bun.lock`. Run `bun install --frozen-lockfile` exactly once before
  the ordered acceptance inventory.
- Golden suites and process/signal checks run on pinned `ubuntu-24.04`.
  Standalone releases target exactly `linux-x64`, `linux-arm64`, `darwin-x64`,
  and `darwin-arm64`.
- Before any edit in step 2, and again after step 3, require this exact
  structural checkpoint to pass with no snapshot change:

  ```bash
  bun run typecheck
  bun vitest run cli/test/unit/claudeMigration.test.ts \
    cli/test/unit/modelSyncCharacterization.test.ts \
    cli/test/unit/pluginRefresh.test.ts \
    cli/test/unit/statusReadiness.test.ts \
    cli/test/unit/toolchain.test.ts
  GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun
  GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation
  ```

- After the ordered acceptance inventory A1-A6, run the project CI command
  `bun run test:ci` exactly once from the repository root.

## Steps

| # | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|
| 1 | Add explicit test entry points and delete the duplicate startup benchmark | `package.json`; `cli/test/unit/statusline.test.mjs` | — | `local` | `planned` | The four exact scripts exist, the named `it` block is gone, and `bun run test:unit` passes; otherwise revert both files and STOP |
| 2 | Split `harness.ts` into five function-first modules, behavior-preserving | `cli/test/lib/harness.ts`; `cli/test/lib/goldenResources.ts`; `cli/test/lib/goldenSnapshot.ts`; `cli/test/lib/goldenExecution.ts`; `cli/test/lib/goldenCli.ts`; `cli/test/lib/goldenMutationCatalog.ts` | 1 | `local` | `planned` | Every export below exists with the exact signature and the structural checkpoint passes with byte-identical goldens; otherwise revert the split and STOP |
| 3 | Clean-cutover all seven consumers and delete `harness.ts` | `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/unit/claudeMigration.test.ts`; `cli/test/unit/modelSyncCharacterization.test.ts`; `cli/test/unit/pluginRefresh.test.ts`; `cli/test/unit/statusReadiness.test.ts`; `cli/test/unit/toolchain.test.ts`; `cli/test/lib/harness.ts` | 2 | `local` | `planned` | `cli/test/lib/harness.ts` no longer exists, no file matches `lib/harness`, and the structural checkpoint passes with byte-identical goldens; otherwise revert step 3 and STOP |
| 4 | Test-first golden hardening: filters, updates, temp/signal cleanup, spawn classification | `cli/test/unit/goldenCli.test.ts`; `cli/test/unit/goldenExecution.test.ts`; `cli/test/lib/goldenCli.ts`; `cli/test/lib/goldenExecution.ts`; `cli/test/lib/goldenResources.ts`; `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts` | 3 | `local` | `planned` | The new unit files fail first, then pass unchanged against the implementation, and A2-A4 hold; otherwise revert step 4 and STOP |
| 5 | Realign the skill's source metadata to the new module names | `.claude/skills/engine-native-context/SKILL.md` | 3 | `local` | `planned` | The description and `source_files` name the five modules, every listed path exists, and the authored body prose is unchanged; otherwise revert the file and STOP |
| 6 | Make standalone binary publication atomic and non-destructive on failure | `cli/build-binaries.sh` | 1 | `local` | `planned` | A5 holds: unknown target exits 2, a planted compile failure preserves published bytes and manifest, and a planted publication failure exits 12 leaving no `SHA256SUMS` and no staging; otherwise revert the script and STOP |
| 7 | Rebuild parity as a bounded DAG and make the release workflow rerunnable | `.github/actions/setup-bun-cache/action.yml`; `.github/workflows/parity.yml`; `.github/workflows/release-cli.yml` | 1, 3, 6 | `local` | `planned` | A1's pin and local-action assertions hold and both workflows parse; otherwise revert all three files and STOP |
| 8 | Verify both workflows with pinned actionlint v1.7.12 | `.github/workflows/parity.yml`; `.github/workflows/release-cli.yml` | 7 | `probe` | `planned` | A6 holds: the archive checksum verifies and actionlint exits 0; without live probe authority use an already-present binary only after verifying its v1.7.12 identity, otherwise block this run with `missing_authority` |

### Step 1 — entry points and duplicate benchmark

Keep every existing script and add exactly:

- `"check:generated": "bun cli/scripts/generate-sot-payload.ts --check"`
- `"test:runtime:posix": "bun cli/test/statusline-runtime-smoke.mjs posix"`
- `"test:ci": "bun run check:generated && bun run typecheck && bun run test:unit && bun run test:runtime:posix && bun run golden:dryrun && bun run golden:mutation"`

Change `prepack` to `bun run check:generated` so packaging and CI share one
source of truth. `test:ci` deliberately excludes prove-red, because prove-red
must exit non-zero; the workflow owns the wrapper that proves the failure is the
expected one.

Delete only `it("keeps direct-Bun startup within its calibrated overhead budget", …)`
from `cli/test/unit/statusline.test.mjs` (declared at line 208). Retain the
preceding exact-byte direct-execution test
`"direct-runs with one newline and empty stderr"` (line 197).
`cli/test/statusline-runtime-smoke.mjs` already enforces the direct-Bun ceiling
over 30 warmed samples, so the Vitest copy adds runtime without adding a distinct
contract. Leave `vitest.config.ts` worker pool, file parallelism, and isolation
at Vitest defaults.

### Step 2 — behavior-preserving module split

Do not add classes, a DI container, one-use interfaces, a compatibility barrel,
a default export, or a generalized strategy/configuration schema.

- `cli/test/lib/goldenResources.ts` exports `REPO_DIR`, `FIXTURES_DIR`,
  `temporaryDir(prefix: string): string`,
  `registeredTemporaryDirs(): ReadonlyArray<string>`,
  `sweepStaleTemporaryDirs(nowMs?: number): void`,
  `cleanupTemporaryDirs(): void`,
  `makeStubDir(overrides?: Record<string, string | null>): string`, and
  `materializeVariant(base: string, files: Record<string, string>): string`.
  `registeredTemporaryDirs` returns a copy, never the mutable set. This module
  retains both existing load-time side effects on import: the top-level
  `sweepStaleTemporaryDirs()` call and `process.on("exit", cleanupTemporaryDirs)`.
  Its temp-prefix list gains `golden-fixture-` alongside the existing
  `golden-home-`, `golden-stubs-`, and `golden-mask-`.
- `cli/test/lib/goldenSnapshot.ts` exports `normalizeOutput`, `TreeSnapshot`,
  `snapshotTree`, `diffTrees`, `diffText`, and `stableStringify`. It imports only
  `registeredTemporaryDirs` from `goldenResources.ts` and never imports
  `goldenExecution.ts`.
- `cli/test/lib/goldenExecution.ts` preserves and exports `EngineRun`,
  `SplitRun`, `EngineKind`, `runEngine`, `runEngineSplit`, `runPublicCli`,
  `readArgvLog`, `cleanup(runs: Array<EngineRun>): void`, and
  `checkedSpawnExitCode(command: string, result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">): number`.
  `RunOpts`, shell quoting, PATH masking, home/environment construction, and
  `engineCommand` stay private. It imports resource helpers from
  `goldenResources.ts` and `normalizeOutput` from `goldenSnapshot.ts`; that one
  edge is required because all three run helpers normalize their output.
- `cli/test/lib/goldenCli.ts` is a leaf module importing neither of the above. It
  exports the exact shape
  `GoldenOptions { proveRed: boolean; updateGoldens: boolean; filter?: RegExp }`,
  `parseArgs(argv: Array<string>): GoldenOptions`,
  `labelSelected(label: string, filter?: RegExp): boolean`, and
  `banner(message: string): void`.
- `cli/test/lib/goldenMutationCatalog.ts` named-exports only
  `LEGACY_CLAUDE_FILES`, `MATRIX: Array<MutationMatrixCase>`,
  `REPLAYS: Array<MutationReplayCase>`, `TOML_DIR`, `TOML_SHAPES`, and the two
  row types below. The five stub-body constants and `LEGACY_CLAUDE_SETTINGS`
  stay private. It imports `FIXTURES_DIR` from `goldenResources.ts` and
  `stableStringify` from `goldenSnapshot.ts`, and never imports the suite entry
  point. `runCase`, the replay/migration/advisor/TOML runners,
  `channelInvariantProblems`, `tomlInvariantProblems`, `collectCases`,
  comparison, update, and prove-red orchestration all stay in
  `cli/test/golden-mutation.ts`.

### Step 3 — clean cutover, then delete `harness.ts`

Update every consumer to import directly from the owning module. No alias,
barrel, or re-export remains, and `cli/test/lib/harness.ts` is deleted.

- `cli/test/golden-dryrun.ts`: resources `REPO_DIR`, `makeStubDir`; execution
  `cleanup`, `runEngine`, `runPublicCli`; snapshot `diffText`, `stableStringify`;
  CLI `banner`, `labelSelected`, `parseArgs`.
- `cli/test/golden-mutation.ts`: resources `FIXTURES_DIR`, `REPO_DIR`,
  `makeStubDir`, `materializeVariant`; execution `cleanup`, `readArgvLog`,
  `runEngine`, `runEngineSplit`, `runPublicCli`; snapshot `diffText`,
  `diffTrees`, `snapshotTree`, `stableStringify`, `TreeSnapshot`; CLI `banner`,
  `labelSelected`, `parseArgs`; catalog only the named exports above.
- `cli/test/unit/claudeMigration.test.ts`: resources `FIXTURES_DIR`,
  `cleanupTemporaryDirs`, `makeStubDir`, `materializeVariant`; execution
  `cleanup`, `readArgvLog`, `runEngine`; snapshot `stableStringify`.
- `cli/test/unit/modelSyncCharacterization.test.ts`: resources `FIXTURES_DIR`,
  `cleanupTemporaryDirs`, `makeStubDir`; execution `cleanup`, `runEngine`,
  `runPublicCli`.
- `cli/test/unit/pluginRefresh.test.ts`: resources `cleanupTemporaryDirs`,
  `makeStubDir`, `materializeVariant`; execution `cleanup`, `readArgvLog`,
  `runEngine`, `runPublicCli`; snapshot `stableStringify`.
- `cli/test/unit/statusReadiness.test.ts`: resources `makeStubDir`; execution
  `cleanup`, `runEngine`, `runPublicCli`.
- `cli/test/unit/toolchain.test.ts`: resources `cleanupTemporaryDirs`,
  `makeStubDir`; execution `runPublicCli`.

Rerun the structural checkpoint from `## Environment & how-to-run`. Both golden
files must remain byte-identical before any behavior hardening begins.

### Step 4 — test-first golden hardening

Write the failing tests first, then freeze them and implement the minimum
behavior that turns them green.

- `cli/test/unit/goldenCli.test.ts` covers: a valid `GOLDEN_FILTER` compiles once
  and the same `RegExp` instance is reused across selections; `labelSelected`
  returns true and false for matching and non-matching labels; an unknown option
  is rejected; `--prove-red` with `--update-goldens` is rejected as mutually
  exclusive; and an invalid regex prints exactly
  `invalid GOLDEN_FILTER '<value>': <regex error>` and exits 2.
- `cli/test/unit/goldenExecution.test.ts` covers `checkedSpawnExitCode` for a
  numeric status, a retained `ETIMEDOUT` spawn error, a killing signal, and a
  null-status/null-signal result.

Implementation contracts:

- Compile `GOLDEN_FILTER` once inside `parseArgs`, before either suite creates
  stubs or homes, and pass `options.filter` to every `labelSelected` call.
- A non-empty filter selecting zero rows exits 2 with
  `GOLDEN_FILTER matched no cases`.
- Mutation `collectCases` returns `{ cases, invariantFailures, selectedChecks }`
  and increments `selectedChecks` for matrix, replay, migration, advisor,
  channel-invariant, and TOML labels. An invariant-only run is valid when
  `selectedChecks > 0`; an invariant-only `--update-goldens` exits 2 without
  writing, because channel invariants produce no snapshot.
- Without `GOLDEN_FILTER`, an update replaces the complete version-1 `cases`
  object so deleted or renamed rows disappear. With `GOLDEN_FILTER`, an update
  validates and reads the existing version-1 object, overlays only the selected
  snapshot keys, preserves every unselected key byte-for-byte, writes through
  `stableStringify`, and exits 2 without writing when zero snapshot cases are
  selected. Each suite-local `readGoldens` rejects malformed JSON and anything
  that is not an object with `version === 1` and an object-valued `cases`,
  naming the offending golden path in the diagnostic.
- Replace the shared persistent `join(tmpdir(), "golden-bun-cache")` with one
  process-scoped `temporaryDir("golden-bun-cache-")` used by every `runEnv`, and
  register both `golden-bun-cache-` and `golden-fixture-` for stale sweeping.
  Alongside the existing exit hook, register named `SIGINT` and `SIGTERM`
  handlers whose `try` cleans synchronously and whose `finally` unregisters that
  handler and re-sends the same signal to the current PID, preserving
  shell-visible signal semantics.
- Put every suite run's snapshot and read work inside `try` and its
  home/fixture cleanup inside `finally` — mutation `runCase`, replay, legacy
  migration, advisor migration, TOML cases, and the dry-run public/native case
  runner. Process-exit cleanup stays the last-resort guard. Rows stay sequential
  in both suites; CI parallelizes only at job level.
- Make all three launch paths replace their Bash wrapper with the engine process,
  so `spawnSync` timeout and signal classification describe the real Bun process
  instead of an intermediate shell. The private `engineCommand` must emit the
  environment assignment, then `exec`, then the absolute Bun path:
  `DOCKS_KIT_ENGINE=native-raw exec '<absolute Bun>' '<main.ts>' <quoted args>`.
  The assignment must precede `exec`; `exec DOCKS_KIT_ENGINE=native-raw '<bun>'`
  exits 127, because `exec` then treats the assignment as the program name.
  Merged output runs `exec 2>&1; ${engineCommand(...)}`: the leading `exec 2>&1`
  is a redirect-only builtin that does not itself replace the shell, so the
  `exec` emitted inside `engineCommand` is what replaces it. Split output runs
  `engineCommand(...)` directly. The public CLI command carries no environment
  assignment and therefore starts with `exec '<absolute Bun>'`.
- `checkedSpawnExitCode` returns a numeric status, and otherwise throws exactly
  `<command> failed to spawn: <error>` when `error` is set (retaining
  `ETIMEDOUT`), `<command> terminated by signal <signal>` when `signal` is set,
  or `<command> completed without status or signal`. Route all three launch
  paths through it, replacing every `res.status ?? 1`.

### Step 5 — skill metadata only

In `.claude/skills/engine-native-context/SKILL.md`, replace
`cli/test/lib/harness.ts` in the description with `cli/test/lib/golden*.ts`, and
replace that one `source_files` entry with the five new modules
(`goldenResources.ts`, `goldenExecution.ts`, `goldenSnapshot.ts`,
`goldenCli.ts`, `goldenMutationCatalog.ts`), each with exactly
`lines: "1-400"`. Set `metadata.updated` to the UTC date on which this
source-path meaning changes. Preserve every line of the authored body prose;
the Harness Geometry rules remain semantically valid.

### Step 6 — atomic binary publication

Keep the existing exact target allowlist and its exit-2 validation, and keep
that validation before any payload check, build, or output creation. Then:

- Build all requested outputs into `mktemp -d "$DIST/.build-XXXXXX"` on the same
  filesystem, and register an `EXIT` trap that removes that staging directory.
- Generate `SHA256SUMS` inside staging from the explicit, `LC_ALL=C`-sorted,
  requested-only basename array, preserving the existing
  `sha256sum`/`shasum -a 256` portability fallback. Never glob `docks-kit-*`.
- Any validation, compile, or checksum failure leaves every previously published
  binary and the existing manifest byte-identical.
- At publication, unlink the old manifest first, so an interrupted per-file
  rename can never leave a manifest certifying a mixed set. Then atomically
  rename each requested binary into place by same-filesystem rename, and publish
  `SHA256SUMS` last. A mid-publication failure is non-zero and leaves no
  manifest.
- Report only the explicit requested basenames plus `SHA256SUMS`.

### Step 7 — bounded parity DAG and rerunnable release DAG

Create `.github/actions/setup-bun-cache/action.yml` with no inputs and no
outputs, containing only the two pinned official actions:

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

The action performs no checkout, install, test, or build. Do not float either
pin.

In `parity.yml`: preserve the existing triggers, add `vitest.config.ts` and
`.github/actions/setup-bun-cache/**` to both the push and pull-request path
lists, and add

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Replace the single `golden` job with three independent `ubuntu-24.04` jobs and
no `needs` edges: `quality`, `golden-dryrun`, and `golden-mutation`. Each sets
`permissions: contents: read`, `timeout-minutes: 10`, job-level
`BUN_INSTALL_CACHE_DIR: ${{ runner.temp }}/bun-install-cache`, checks out with
`actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`, then uses
`./.github/actions/setup-bun-cache`, then runs its own visible
`bun install --frozen-lockfile`. `quality` runs `bun run check:generated`,
`bun run typecheck`, `bun run test:unit`, and `bun run test:runtime:posix`. Only
the two golden jobs run the existing exit/marker prove-red wrapper, each anchored
to one representative case:
`GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$'` for dry-run and
`GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$'` for mutation.

In `release-cli.yml`: set workflow-level `permissions: {}` and

```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

Split the single job into `build` → `github-release` → `npm-publish`:

- `build` (`permissions: contents: read`, `runs-on: ubuntu-24.04`,
  `timeout-minutes: 15`): the same cache env, checkout, local action, and
  visible frozen install; derive non-empty `release_version="${GITHUB_REF_NAME#cli-v}"`
  and require it to equal `package.json.version`; run `bun run typecheck`,
  `bun run build:binaries`, and `bun pm pack --destination cli/dist`; require
  exactly one tarball at `cli/dist/docks-kit-${release_version}.tgz`; upload the
  four binaries, `SHA256SUMS`, and that tarball as artifact
  `release-cli-${{ github.ref_name }}` using
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`.
- `github-release` (`needs: build`, `permissions: contents: write`,
  `timeout-minutes: 10`): download that exact artifact into `release-dist/` with
  `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093`; with
  `GH_TOKEN: ${{ github.token }}` and `GH_REPO: ${{ github.repository }}`, run
  exactly `gh release view "$GITHUB_REF_NAME" || gh release create "$GITHUB_REF_NAME" --verify-tag --generate-notes`,
  then upload exactly `release-dist/docks-kit-linux-x64`,
  `release-dist/docks-kit-linux-arm64`, `release-dist/docks-kit-darwin-x64`,
  `release-dist/docks-kit-darwin-arm64`, and `release-dist/SHA256SUMS` with
  `--clobber`. The tarball is never a release asset and no upload glob is used.
- `npm-publish` (`needs: [build, github-release]`,
  `permissions: contents: read, id-token: write`, `timeout-minutes: 10`):
  download the same artifact into `release-dist/`, require exactly one
  `release-dist/docks-kit-${release_version}.tgz`, set up Node 24 with
  `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`, install exact
  `npm@11.18.0`, and capture `npm view "docks-kit@${release_version}" version`.
  An existing exact version is success. Publish the downloaded tarball with
  `npm publish "$tgz" --provenance --access public` only when the captured
  failure is `E404`; rethrow every authentication, trusted-publisher, network,
  provenance, or other registry status.

Keep GitHub-release attachment before npm publication, so a failed asset release
cannot leave npm as the only completed channel. Remove both blanket
suppressions. No token, wildcard asset, `|| true`, or blanket warning-success
branch remains.

## Interfaces & data shapes

```ts
export interface GoldenOptions {
  proveRed: boolean
  updateGoldens: boolean
  filter?: RegExp
}

export function parseArgs(argv: Array<string>): GoldenOptions
export function labelSelected(label: string, filter?: RegExp): boolean
export function banner(message: string): void

export function checkedSpawnExitCode(
  command: string,
  result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">,
): number

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

Parity nodes `quality`, `golden-dryrun`, and `golden-mutation` have no `needs`.
Release is `build` → `github-release` → `npm-publish`, and `npm-publish` needs
both earlier jobs. Build outputs are `docks-kit-linux-x64`,
`docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`, and
`SHA256SUMS`. The build artifact adds exactly one
`docks-kit-${release_version}.tgz` and is named
`release-cli-${{ github.ref_name }}`. GitHub release assets are exactly the four
binaries plus `SHA256SUMS`, never the tarball.

## Acceptance criteria

Run A1 through A6 in order from `/home/vagrant/projects/public`, then A7 once.

| ID | Command | Expected |
|---|---|---|
| A1 | <code>test ! -e cli/test/lib/harness.ts<br>for module in goldenResources goldenExecution goldenSnapshot goldenCli goldenMutationCatalog; do<br>  test -f "cli/test/lib/${module}.ts"<br>done<br>test -z "$(grep -R -nE 'lib/harness\|from .*harness' \<br>  cli/test .claude/skills/engine-native-context/SKILL.md \|\| true)"<br>for consumer in cli/test/golden-dryrun.ts cli/test/golden-mutation.ts \<br>  cli/test/unit/claudeMigration.test.ts \<br>  cli/test/unit/modelSyncCharacterization.test.ts \<br>  cli/test/unit/pluginRefresh.test.ts \<br>  cli/test/unit/statusReadiness.test.ts \<br>  cli/test/unit/toolchain.test.ts; do<br>  test -f "$consumer"<br>  test -z "$(grep -n harness "$consumer" \|\| true)"<br>done<br>bun vitest run cli/test/unit/goldenCli.test.ts cli/test/unit/goldenExecution.test.ts<br><br>test "$(grep -R -h 'uses: ./.github/actions/setup-bun-cache' \<br>  .github/workflows/parity.yml \<br>  .github/workflows/release-cli.yml \| wc -l)" -eq 4<br>test "$(grep -R -l 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' \<br>  .github --include='*.yml')" = ".github/actions/setup-bun-cache/action.yml"<br>test "$(grep -R -l 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9' \<br>  .github --include='*.yml')" = ".github/actions/setup-bun-cache/action.yml"<br>ruby -e 'require "yaml"; YAML.parse_file(ARGV.fetch(0))' \<br>  .github/actions/setup-bun-cache/action.yml<br>ruby -e 'require "yaml"; text = File.read(ARGV.fetch(0)); data = YAML.safe_load(text.split(/^---\s*$/).fetch(1)); rows = data.dig("metadata", "source_files"); abort "invalid source_files" unless rows.is_a?(Array) &amp;&amp; rows.all? { \|row\| File.file?(row.fetch("path")) &amp;&amp; row.fetch("lines").is_a?(String) }' \<br>  .claude/skills/engine-native-context/SKILL.md</code> | No compatibility harness remains; all five replacement modules and both focused unit files exist; none of the seven former consumers still mentions `harness`; exactly four Bun-enabled jobs use the local action; the setup-bun and cache pins occur only in the local action; action YAML and skill metadata parse with live paths. |
| A2 | <code>backup_dir="$(mktemp -d)"<br>cp cli/test/goldens/dryrun.json "$backup_dir/dryrun.json"<br>cp cli/test/goldens/mutation.json "$backup_dir/mutation.json"<br>restore_goldens() {<br>  cp "$backup_dir/dryrun.json" cli/test/goldens/dryrun.json<br>  cp "$backup_dir/mutation.json" cli/test/goldens/mutation.json<br>  rm -rf "$backup_dir"<br>}<br>trap restore_goldens EXIT<br><br>set +e<br>GOLDEN_FILTER='[' bun run golden:dryrun &gt; /tmp/dry-invalid-filter.out 2&gt;&amp;1<br>dry_invalid=$?<br>GOLDEN_FILTER='[' bun run golden:mutation &gt; /tmp/mutation-invalid-filter.out 2&gt;&amp;1<br>mutation_invalid=$?<br>GOLDEN_FILTER='definitely-no-such-case' bun run golden:dryrun &gt; /tmp/dry-empty-filter.out 2&gt;&amp;1<br>dry_empty=$?<br>GOLDEN_FILTER='definitely-no-such-case' bun run golden:mutation &gt; /tmp/mutation-empty-filter.out 2&gt;&amp;1<br>mutation_empty=$?<br>set -e<br>test "$dry_invalid" -eq 2<br>test "$mutation_invalid" -eq 2<br>test "$dry_empty" -eq 2<br>test "$mutation_empty" -eq 2<br>grep -F "invalid GOLDEN_FILTER '['" /tmp/dry-invalid-filter.out<br>grep -F "invalid GOLDEN_FILTER '['" /tmp/mutation-invalid-filter.out<br>grep -F "GOLDEN_FILTER matched no cases" /tmp/dry-empty-filter.out<br>grep -F "GOLDEN_FILTER matched no cases" /tmp/mutation-empty-filter.out<br><br>dry_before="$(sha256sum cli/test/goldens/dryrun.json \| cut -d' ' -f1)"<br>mutation_before="$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun --update-goldens<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation --update-goldens<br>test "$dry_before" = "$(sha256sum cli/test/goldens/dryrun.json \| cut -d' ' -f1)"<br>test "$mutation_before" = "$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br><br>GOLDEN_FILTER='^channel-invariants$' bun run golden:mutation<br>set +e<br>GOLDEN_FILTER='^channel-invariants$' bun run golden:mutation --update-goldens &gt; /tmp/invariant-update.out 2&gt;&amp;1<br>invariant_update=$?<br>set -e<br>test "$invariant_update" -eq 2<br>test "$mutation_before" = "$(sha256sum cli/test/goldens/mutation.json \| cut -d' ' -f1)"<br><br>printf '{broken\n' &gt; cli/test/goldens/dryrun.json<br>set +e<br>bun run golden:dryrun &gt; /tmp/dry-malformed.out 2&gt;&amp;1<br>dry_malformed=$?<br>set -e<br>test "$dry_malformed" -ne 0<br>grep -F "cli/test/goldens/dryrun.json" /tmp/dry-malformed.out<br>cp "$backup_dir/dryrun.json" cli/test/goldens/dryrun.json<br><br>printf '{broken\n' &gt; cli/test/goldens/mutation.json<br>set +e<br>bun run golden:mutation &gt; /tmp/mutation-malformed.out 2&gt;&amp;1<br>mutation_malformed=$?<br>set -e<br>test "$mutation_malformed" -ne 0<br>grep -F "cli/test/goldens/mutation.json" /tmp/mutation-malformed.out<br><br>restore_goldens<br>trap - EXIT<br>bun run golden:dryrun<br>bun run golden:mutation</code> | Both suites reject invalid and empty filters with exit 2; one-case updates preserve unselected cases byte-for-byte; invariant-only mutation runs but cannot update; malformed files name their path; restored full suites pass. |
| A3 | <code>set +e<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun --prove-red &gt; /tmp/dryrun-red.out 2&gt;&amp;1<br>dry_code=$?<br>GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents$' bun run golden:mutation --prove-red &gt; /tmp/mutation-red.out 2&gt;&amp;1<br>mutation_code=$?<br>set -e<br>test "$dry_code" -ne 0<br>test "$mutation_code" -ne 0<br>grep -F "prove-red OK: golden-dryrun detected 1 planted mismatch" /tmp/dryrun-red.out<br>grep -F "prove-red OK: golden-mutation detected 1 planted mismatch" /tmp/mutation-red.out</code> | Both commands exit non-zero and each expected marker reports exactly one planted mismatch. |
| A4 | <code>tmp_root="$(mktemp -d)"<br>TMPDIR="$tmp_root" GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' bun run golden:dryrun<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>rmdir "$tmp_root"<br><br>bash_stub="$(mktemp -d)"<br>tmp_root="$(mktemp -d)"<br>printf '#!/bin/sh\nkill -TERM $$\n' &gt; "$bash_stub/bash"<br>chmod +x "$bash_stub/bash"<br>set +e<br>TMPDIR="$tmp_root" PATH="$bash_stub:$PATH" \<br>  GOLDEN_FILTER='^fixture=home-fresh cmd=sync agents --dry-run$' \<br>  bun run golden:dryrun &gt; /tmp/golden-signal.out 2&gt;&amp;1<br>signal_code=$?<br>set -e<br>test "$signal_code" -ne 0<br>grep -F "terminated by signal SIGTERM" /tmp/golden-signal.out<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>rm -rf "$bash_stub" "$tmp_root"<br><br>tmp_root="$(mktemp -d)"<br>suite_pid=""<br>trap 'if [[ -n "$suite_pid" ]]; then kill -KILL "$suite_pid" 2&gt;/dev/null \|\| true; fi; rm -rf "$tmp_root"' EXIT<br>TMPDIR="$tmp_root" bun cli/test/golden-mutation.ts &gt; /tmp/golden-parent-signal.out 2&gt;&amp;1 &amp;<br>suite_pid=$!<br>stub_ready=""<br>for _ in $(seq 1 500); do<br>  stub_ready="$(find "$tmp_root" -mindepth 1 -maxdepth 1 -name 'golden-stubs-*' -print -quit)"<br>  [[ -n "$stub_ready" ]] &amp;&amp; break<br>  sleep 0.01<br>done<br>test -n "$stub_ready"<br>kill -TERM "$suite_pid"<br>set +e<br>wait "$suite_pid"<br>parent_signal_code=$?<br>set -e<br>suite_pid=""<br>test "$parent_signal_code" -eq 143<br>test -z "$(find "$tmp_root" -mindepth 1 -maxdepth 1 -print -quit)"<br>trap - EXIT<br>rmdir "$tmp_root"</code> | Successful and signal-terminated runs remove cache, fixture, home, stub, and mask directories; spawn classification covers numeric, ETIMEDOUT, signal, and null status; parent SIGTERM remains exit 143. |
| A5 | <code>set +e<br>bash cli/build-binaries.sh not-a-target<br>invalid_code=$?<br>set -e<br>test "$invalid_code" -eq 2<br><br>bash cli/build-binaries.sh linux-x64<br>(cd cli/dist &amp;&amp; sha256sum -c SHA256SUMS)<br>test "$(awk '{print $2}' cli/dist/SHA256SUMS)" = "docks-kit-linux-x64"<br>binary_before="$(sha256sum cli/dist/docks-kit-linux-x64 \| cut -d' ' -f1)"<br>manifest_before="$(sha256sum cli/dist/SHA256SUMS \| cut -d' ' -f1)"<br><br>real_bun="$(command -v bun)"<br>bun_stub="$(mktemp -d)"<br>cat &gt; "$bun_stub/bun" &lt;&lt;EOF<br>#!/bin/bash<br>if [[ "\$1" == */cli/scripts/generate-sot-payload.ts ]]; then exec "$real_bun" "\$@"; fi<br>case " \$* " in<br>  *" --target=bun-linux-x64 "*)<br>    while [[ \$# -gt 0 ]]; do<br>      if [[ "\$1" == "--outfile" ]]; then printf 'planted staged output' &gt; "\$2"; exit 0; fi<br>      shift<br>    done<br>    ;;<br>  *" --target=bun-linux-arm64 "*) exit 9 ;;<br>esac<br>exec "$real_bun" "\$@"<br>EOF<br>chmod +x "$bun_stub/bun"<br>set +e<br>PATH="$bun_stub:$PATH" bash cli/build-binaries.sh linux-x64 linux-arm64<br>planted_code=$?<br>set -e<br>test "$planted_code" -eq 9<br>test "$binary_before" = "$(sha256sum cli/dist/docks-kit-linux-x64 \| cut -d' ' -f1)"<br>test "$manifest_before" = "$(sha256sum cli/dist/SHA256SUMS \| cut -d' ' -f1)"<br>test -z "$(find cli/dist -mindepth 1 -maxdepth 1 -type d -name '.build-*' -print -quit)"<br>rm -rf "$bun_stub"<br><br>real_mv="$(command -v mv)"<br>mv_stub="$(mktemp -d)"<br>cat &gt; "$mv_stub/mv" &lt;&lt;EOF<br>#!/bin/bash<br>count_file="$mv_stub/count"<br>n=\$(( \$(cat "\$count_file" 2&gt;/dev/null \|\| echo 0) + 1 ))<br>printf '%s' "\$n" &gt; "\$count_file"<br>if [[ "\$n" -ge 2 ]]; then exit 12; fi<br>exec "$real_mv" "\$@"<br>EOF<br>chmod +x "$mv_stub/mv"<br>set +e<br>PATH="$mv_stub:$PATH" bash cli/build-binaries.sh linux-x64 linux-arm64<br>publish_code=$?<br>set -e<br>test "$publish_code" -eq 12<br>test -z "$(find cli/dist -mindepth 1 -maxdepth 1 -type d -name '.build-*' -print -quit)"<br>test ! -e cli/dist/SHA256SUMS<br>rm -rf "$mv_stub"<br><br>bun run build:binaries<br>(cd cli/dist &amp;&amp; sha256sum -c SHA256SUMS)<br>printf '%s\n' \<br>  docks-kit-darwin-arm64 \<br>  docks-kit-darwin-x64 \<br>  docks-kit-linux-arm64 \<br>  docks-kit-linux-x64 &gt; /tmp/expected-binaries<br>awk '{print $2}' cli/dist/SHA256SUMS \| diff -u /tmp/expected-binaries -</code> | Unknown targets exit 2 before building; a planted staged compile failure preserves published bytes and manifest and removes staging; a planted publication failure exits 12, removes staging, and leaves no `SHA256SUMS`; the following full build restores a valid complete set whose manifest contains only sorted invocation outputs. |
| A6 | <code>curl -fsSLo /tmp/actionlint_1.7.12_linux_amd64.tar.gz \<br>  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz<br>printf '%s  %s\n' \<br>  8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \<br>  /tmp/actionlint_1.7.12_linux_amd64.tar.gz \| sha256sum -c -<br>rm -rf /tmp/actionlint-1.7.12<br>mkdir /tmp/actionlint-1.7.12<br>tar -xzf /tmp/actionlint_1.7.12_linux_amd64.tar.gz -C /tmp/actionlint-1.7.12<br>/tmp/actionlint-1.7.12/actionlint \<br>  .github/workflows/parity.yml \<br>  .github/workflows/release-cli.yml</code> | Pinned actionlint v1.7.12 archive checksum verifies and actionlint exits 0 for both workflows. Requires live `probe` authority for `github.com/rhysd/actionlint`; see step 8 for the verified-local-binary alternative and the `missing_authority` block. |
| A7 | <code>bun install --frozen-lockfile<br>bun run test:ci</code> | The project CI command passes exactly once end to end from the repository root. |

Legacy acceptance rows A7 through A12 of
`docs/plans/active/ci-golden-test-modernization.md` are deliberately not carried
here. They dispatch or rerun GitHub workflows, read production runs, releases, or
the npm registry, or depend on a future tag. They are recorded as deferred
production observations that require their own exact live `ExternalAuthorityV1`
and are not part of this plan's acceptance.

## Out of scope / do-NOT-touch

- `bun.lock`, `vitest.config.ts`, `cli/test/goldens/dryrun.json`, and
  `cli/test/goldens/mutation.json` are unchanged by this plan.
- Do not resume, edit, archive, or delete
  `docs/plans/active/ci-golden-test-modernization.md`, or any file under
  `docs/plans/finished/`.
- Keep rows sequential inside both golden suites; parallelize only the two suites
  at CI job level.
- Do not change dependency versions, golden schema, or runtime command behavior.
  `effect` stays at the resolved `3.21.4`; Effect v4 work stays deferred.
- Do not add classes, dependency injection, one-use interfaces, compatibility
  barrels, aliases, default exports, generalized strategy or configuration
  schemas, or a hanging-process reporter in normal CI.
- Pushes, workflow dispatches and reruns, releases, npm queries and publication,
  and production access are excluded from this plan's acceptance.

## Known gotchas

- Bash engine support is removed. Golden engine launches use
  `DOCKS_KIT_ENGINE=native-raw`; wrapper commands must `exec` the engine so
  timeout and signal classification describe the real process.
- Snapshot collection order is deterministic and mutation replay intentionally
  runs twice against the same HOME; row parallelism would break ordering, replay
  semantics, and update-file ownership.
- Signal handlers must clean synchronously, unregister themselves, then re-send
  the same signal to the current PID so shell-visible semantics survive.
- Cache key is `${{ runner.os }}-bun-1.3.14-${{ hashFiles('bun.lock') }}` with
  restore key `${{ runner.os }}-bun-1.3.14-`. Never cache `node_modules` or cross
  operating systems.
- GitHub jobs share neither filesystem nor process state; release outputs cross
  jobs only through the named artifact.
- npm trusted publishing is assumed for `DocksDocks/public` and
  `release-cli.yml` without a GitHub Environment. If npm names an environment,
  use that exact name; never guess or add a token.

## Global constraints

- Runner `ubuntu-24.04`; Bun `1.3.14`; Node `24`; npm `11.18.0`; actionlint
  `v1.7.12`.
- `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` (`v7.0.0`).
- `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` (`v2.2.0`).
- `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9` (`v6.1.0`).
- `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`).
- `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` (`v4.3.0`).
- `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` (`v6.4.0`).
- actionlint archive SHA-256
  `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`.
- Binary allowlist `linux-x64 linux-arm64 darwin-x64 darwin-arm64`.
- Golden snapshot schema stays version `1`.

## STOP conditions

Stop rather than improvise if:

1. A `harness.ts` consumer exists beyond the seven enumerated in step 3.
2. The structural cutover in step 2 or step 3 changes either golden file.
3. Dependency versions or the golden schema drift from the values above.
4. Release assets would be anything other than the four binaries plus
   `SHA256SUMS`.
5. Any cited action SHA or tool version no longer matches checked-in source.
6. A pre-publication failure in step 6 cannot preserve the existing build
   outputs and manifest byte-identically.
7. Live `probe` authority for the pinned actionlint archive is absent and no
   already-present binary can be verified as v1.7.12. Block that run with
   `missing_authority`; never weaken YAML validation to proceed.

## Open questions

N/A — every decision is resolved from repository facts already recorded above.
The risk tier and effect declaration are derived, not open; see the recorded
derivation in `## Context & rationale`.

## Review

Plan-attempt-history: {"authorization_source_sha256":"a4bf9785d7f0f9098f99193c9cd592729aee1f524827d1da904a26e87e7ac41b","plan_bytes_sha256":"85ebbc930217cf093ec4dc4eb45a0eaf7201c33223829f4f418bbc2a21630d2a","replacement_run_id":"d2ffdc34-f9b4-418e-98c7-da9474aba0b2","run":{"acceptance":null,"blocker":{"evidence_sha256":"598212eca57c163bc18dc7990df3f2781159e91cca362f930cf1ca83c75590cd","kind":"review_failed"},"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"input_sha256":"c1af971cd8bb0197518d0625a0c5b03cd63016588bf92da25de528be5c425ad3","invocations":2,"result_sha256":"598212eca57c163bc18dc7990df3f2781159e91cca362f930cf1ca83c75590cd","state":"blocked"},"execution_parent":null,"goal_id":"b8c91622-819a-44d9-ba0e-6ced02b86ba5","implementation_commit":null,"plan_path":"docs/plans/active/ci-golden-test-and-release-hardening.md","plan_sha256":"36b5eb498368ec14debc5e79d31f027993ae5b5eab7297471500344e353c82bb","repository_id":"DocksDocks/public","requested_effects":["local","probe"],"risk":"external","run_id":"90445876-a250-41d2-9727-6cd2fbd084e7","schema":1,"source_base":"3290480557da39586cabeb2307696489f3e7caaf","source_sha256":"d8d2a5cf475bfc4216f2a5b0c444157b90be930fc17e13027d9cffd9c1a11976"},"schema":1,"status":"blocked","successor_run_sha256":"a812ce2c25a06e4ef199494f8c760f35a50c2f30616cc09e40f3c010739184d0"}

- Predecessor run `90445876-a250-41d2-9727-6cd2fbd084e7` was terminally blocked as `review_failed`: draft-review invocation 1 hit a transport failure and invocation 2 returned verdict `repair` with no permit remaining. Its two findings-bearing defects — the risk/effect framing and an imprecise `exec` contract in step 4 — are corrected in this successor draft.
- Exact current-user authorization replaced that terminal run in place at the same `plan_path`, appending the record above and installing a fresh `run_id` with fresh review budgets. Predecessor permits are not reused.
- Reviewer route: the plugin-shipped `plan-reviewer` wrapper is inoperable in this environment (its spawned process reports `No model selected`, reproduced deterministically in a non-binding preflight). Per `docs/plans/AGENTS.md` — "A missing reviewer wrapper does not create another role: dispatch a fresh read-only task with the same `PlanReviewV1` contract" — review is dispatched as one fresh read-only task bound to the same closed contract. No provider/model fallback, resumed reviewer, or third invocation is used.
- Draft review invocation 1 — bound `PlanReviewV1`, verdict `pass`, zero findings. Input SHA-256 `0c8cf7f93976a18b7d1bada1262665ae95246173c258a6d6bab83c8727d88394`; result SHA-256 `97215587ef8286c2c8dd11a75314dfb1ed876e757b523ea29784f2e9c69f8e9e`.
- One invocation was consumed; no repair, retry, or second invocation was needed. The sealed bundle was verified and then destroyed.
- Plan promoted to `planned` at 2026-07-27T00:44:51.656+00:00. Implementation, acceptance execution, and `## Verification Results` require a separate user request.


## Verification Results

Not yet run. This plan is a reviewed plan-only deliverable at `status: planned`;
implementation, acceptance execution, and these results require a separate user
request.
