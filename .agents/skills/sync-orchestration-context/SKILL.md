---
name: sync-orchestration-context
description: "Use when editing docks-kit, cli/src/main.ts, cli/src/argv.ts, cli/src/argvValidate.ts, cli/src/engine.ts, or cli/src/engine-native index.ts, engineCtx.ts, syncDispatch.ts, syncConcurrency.ts, parseArgs.ts, parseModifiers.ts, modes.ts, models.ts, or liveModels.ts: sync flags, positional targets, renamed-flag hints, harness selection, model validation, DOCKS_KIT_SYNC_CONCURRENCY, the sync lock (withSyncLock, sync-lock.db, DOCKS_KIT_SYNC_LOCK_WAIT_MS), the failure ledger, or dry-run and idempotency rules. Not for settings JSON (use settings-merge-context), Codex TOML (use codex-config-merge-context), plugin passes (use plugin-bootstrap-context), universal skills (use universal-skills-context), toolchain (use toolchain-context), omp (use omp-sync-context), the lock module itself (use tidy-context), or the golden harness (use engine-native-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: docks-kit
      lines: "1-131"
    - path: cli/src/main.ts
      lines: "1-105"
    - path: cli/src/argv.ts
      lines: "1-71"
    - path: cli/src/argvValidate.ts
      lines: "1-108"
    - path: cli/src/argvSurface.ts
      lines: "1-410"
    - path: cli/src/engine.ts
      lines: "1-134"
    - path: cli/src/kitHome.ts
      lines: "1-102"
    - path: cli/src/payload.ts
      lines: "1-25"
    - path: cli/src/efforts.ts
      lines: "1-89"
    - path: cli/src/commands/sync.ts
      lines: "1-191"
    - path: cli/src/engine-native/exec.ts
      lines: "1-360"
    - path: cli/src/commands/models.ts
      lines: "1-75"
    - path: cli/src/commands/update.ts
      lines: "1-317"
    - path: cli/src/engine-native/index.ts
      lines: "1-68"
    - path: cli/src/engine-native/engineCtx.ts
      lines: "1-157"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-211"
    - path: cli/src/engine-native/kitLock.ts
      lines: "1-111"
    - path: cli/src/engine-native/syncConcurrency.ts
      lines: "1-55"
    - path: cli/src/engine-native/failures.ts
      lines: "1-16"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-206"
    - path: cli/src/engine-native/parseHelp.ts
      lines: "1-66"
    - path: cli/src/engine-native/parseModifiers.ts
      lines: "1-225"
    - path: cli/src/engine-native/harnesses.ts
      lines: "1-144"
    - path: cli/src/engine-native/modes.ts
      lines: "1-190"
    - path: cli/src/engine-native/models.ts
      lines: "1-101"
    - path: cli/src/engine-native/liveModels.ts
      lines: "1-264"
    - path: cli/src/engine-native/claudeSettings.ts
      lines: "1-201"
    - path: cli/src/engine-native/claudeSettingsModifiers.ts
      lines: "1-115"
    - path: cli/src/engine-native/codexToml.ts
      lines: "1-303"
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-312"
    - path: cli/src/engine-native/codexSync.ts
      lines: "1-314"
    - path: cli/src/engine-native/skillsSync.ts
      lines: "1-57"
    - path: cli/src/engine-native/skillsInstall.ts
      lines: "1-129"
    - path: cli/src/engine-native/skillsPrune.ts
      lines: "1-104"
    - path: cli/src/engine-native/skillsRecords.ts
      lines: "1-93"
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-123"
    - path: cli/src/engine-native/ompPlugins.ts
      lines: "1-415"
    - path: cli/src/engine-native/claudePluginPasses.ts
      lines: "1-426"
    - path: cli/src/engine-native/claudeOptionalPlugins.ts
      lines: "1-126"
    - path: cli/src/engine-native/claudeLsp.ts
      lines: "1-301"
    - path: cli/src/engine-native/bun.ts
      lines: "1-120"
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-292"
  updated: "2026-11-07"
---

# Sync Engine Orchestration

EngineNative is the only supported sync engine. The public entry chain is
`./docks-kit` -> `cli/src/main.ts` -> `cli/src/argv.ts prepareArgv` -> the
Effect command -> `cli/src/engine.ts engine` -> `runEngineNative` in
`cli/src/engine-native/index.ts`. `DOCKS_KIT_ENGINE=bash` exits 2 with a
message that names the `bash-engine-final` tag (`engine.ts bashRemovedMessage`).
(verify: `bunx vitest run cli/test/unit/engine.test.ts -t "rejects a removed Bash engine before running the native engine"`)

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
Every new sync step must honor `ctx.dryRun` and print the same `[dry-run]`
surface the golden suite records. Do the existence checks and path resolution
before the dry-run action point when the real engine does so; do not let dry-run
execute a write, install, removal, or network mutation.
</constraint>

<constraint>
Read SoT content only through `payload.ts` (`payloadText`/`payloadBytes`); never
read kit files from disk at sync time. `ctx.repoDir` is `kitHome.ts kitHome()`
and is display-only (the `Repo:` summary line).
`.agents/skills/sync-orchestration-context/references/dispatch-flow.md` owns the
kit-home resolution order and the other `kitHome()` callers.
</constraint>

<constraint>
Use `ExitError` (defined in `parseHelp.ts`, imported through `parseArgs.ts`) for
intentional exit-2 validation failures and command-abort parity. Unknown flags,
renamed legacy flags, bad modifier values, and selected-target model validation
failures must abort before any mutation.
(verify: `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "prints the catalog and exits 2 for a bare"`)
</constraint>

<constraint>
Report a failed kit-managed harness-CLI operation through
`failures.ts recordFailure`, never a bare `warn`. `syncDispatch.ts engineSync,
failure ledger` prints every recorded message under `--- Failures ---` after the
summary and returns 1, so exit 2 stays reserved for `ExitError` validation
aborts and exit 1 means a mutation did not happen. A skip is not a failure: a
missing harness CLI, missing git, an unavailable plugin inventory, and a missing
Bun, LSP-server, or pi-intercom pin in `SoT/toolchain.json` keep exit 0. Probe
before spawning, so a host without the tool never records one.
(verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "fails the sync without installing n8n if its marketplace cannot be added"` for exit 1 with the ledger, and `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "skips optional plugins with a warning when git is missing"` for exit 0)
A missing `skills-cli` pin is the exception: `skillsInstall.ts skillsCli` aborts
with `ExitError(1)` when a skill needs installation. Unprobed: no unit test
sets an empty `skills-cli` pin. Read the abort message (verify:
`grep -n "no verified skills-cli pin" cli/src/engine-native/skillsInstall.ts`)
</constraint>

<constraint>
Add or change a flag in every layer that owns the public contract:

- `parseArgs.ts parseArgs` (engine vocabulary) and `parseHelp.ts printUsage`
  (engine sync help).
- The matching `cli/src/commands/*.ts` option list (public CLI).
- `argvValidate.ts missingModifierValue` for a value-taking sync modifier.
- `engineCtx.ts ModifierFlag` and `parseModifiers.ts MODIFIER_METADATA` for a
  sync modifier.
- `parseModifiers.ts SCALAR_MODIFIER_FLAGS` and `setModifier` for a scalar
  modifier.

Then update the golden matrix.
</constraint>

## When To Use

- Adding a sync flag, positional target, or direct engine mode.
- Changing default target selection when no `claude`, `codex`, `agents`, or
  `omp` word is supplied.
- Debugging why a target did or did not run.
- Changing model validation or the catalog in `SoT/models.json`.
- Updating the `docks-kit` launcher, the public argv layer, or the
  `cli/src/engine.ts` selector behavior.

For the doctor report and Bun managed install, use
`.agents/skills/toolchain-context/SKILL.md`. For Claude settings, Codex TOML,
plugins, universal skills, or omp, use the matching kit-mechanic skill named in
this skill's description.

## Entry Points

| Invocation | Path | Notes |
|-----------|------|-------|
| `./docks-kit <args>` | Compiled binary in `cli/dist/` when its version matches and it is current, otherwise Bun-from-source | The launcher compares binary `--version` with `package.json`, and it also rejects the binary when a file under `cli/src` or `cli/docs` is newer than the binary, so stale ignored builds cannot mask newer source. |
| `cli/src/main.ts` | Raw-channel branch, then `prepareArgv`, then the Effect CLI root command | `DOCKS_KIT_ENGINE=native-raw` or `native-capture` skips `prepareArgv` and Effect and calls `runEngineNative` directly. Otherwise mutating commands run through `engine(args)`. The root command registers `argv.ts COMMANDS`, the one subcommand list that the argv surfaces also use. A new subcommand needs an entry there and a `Console.log` line in the hand-written root overview in `main.ts`. A new engine mode also needs a `case` arm in `index.ts runEngineNative`. |
| `cli/src/argv.ts` | `prepareArgv` | Validates and normalizes argv before Effect parses it. See § Public Argv Layer. |
| `cli/src/engine.ts` | `engine` / `engineCapture` | Runs EngineNative. `engineCapture` re-spawns a child with `DOCKS_KIT_ENGINE=native-capture`, which ignores the env globals. `native-raw` is the harness-private golden channel. |
| `cli/src/engine-native/index.ts` | `runEngineNative(argv, services?, options?)` | Builds `ctx` through `engineCtx.ts makeCtx`, then dispatches `model`, `toolchain`, and `sync`. Any other first word also runs sync. `options.envGlobals` defaults to false; only the `main.ts` `native-raw` branch passes `{ envGlobals: true }`. |

(verify: `bunx vitest run cli/test/unit/engine.test.ts -t "runs the public engine with env globals disabled"` and `bunx vitest run cli/test/unit/argv.test.ts -t "resolves every registered subcommand"`)

Do not add a new fallback behind `DOCKS_KIT_ENGINE`.

## Public Argv Layer

`cli/src/argv.ts prepareArgv` runs before Effect parses anything. It scans argv
against the surfaces that `argvSurface.ts buildSurfaces` derives from the
command definitions. `argvValidate.ts validateScannedArgv` then rejects with
exit 2. It checks in this order:

1. An unknown command that also carries a flag that the scan cannot resolve. A
   bare unknown command passes this layer, and Effect rejects it with exit 1.
2. Renamed sync flags (`isLegacyFlag`).
3. Unknown flags.
4. Values on boolean flags, for example `--dry-run=false`.
5. Repeated flags that are not repeatable.
6. Sync modifiers with no value (`missingModifierValue`).

- The public CLI accepts `--flag value` and `--flag=value`.
  `commands/sync.ts syncCommand` rewrites both to the `--flag=value` form that
  the engine parser takes. `--claude-plugin` also takes a comma list.
- Renamed-flag hints live in one table, `parseArgs.ts LEGACY_FLAG_HINTS`. The
  public CLI (`argvValidate.ts validateScannedArgv`) and the refusal arms in
  `parseArgs.ts parseArgs` (engine and `native-raw`) print the same text. A new
  renamed flag needs a table entry and a `case` label in `parseArgs`.

(verify: `bunx vitest run cli/test/unit/argv.test.ts -t "rejects legacy --omp with its positional-target rename hint"`, `bunx vitest run cli/test/unit/argv.test.ts -t "rejects legacy --force with its reconcile rename hint"`, and `bunx vitest run cli/test/unit/argv.test.ts -t "rejects a Claude plugin modifier missing its value"`)

## Core Patterns

### Flag Parsing

`parseArgs(ctx, args)` owns the engine flag vocabulary.
`.agents/skills/sync-orchestration-context/references/flag-matrix.md` is the
only flag table: each flag's `Ctx` field, consumer, layer scope, and
deploy-time function. Do not copy it here.

Target words (`claude`, `codex`, `agents`, `omp`) call the target selector and
set `ctx.targetFilterSet`. When it remains false, `parseArgs.ts
applyDefaultSelection` applies the stored kit.db harness selection. When no
selection is stored, it falls back to `harnesses.ts LEGACY_SELECTION`.
(verify: `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "selects exactly explicit claude and codex targets"` and `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "uses the legacy selection silently without stored state when non-interactive"`)

Renamed legacy flags still have explicit exit-2 hint arms. Keep them as refusal
documentation only; do not reintroduce compatibility behavior.

### Dispatch Order

`index.ts runEngineNative` builds `ctx` through `engineCtx.ts makeCtx`.
`makeCtx` reads the unprefixed env globals (`ENV_GLOBAL_KEYS`) only when
`options.envGlobals` is true. `runEngineNative` then switches on the first
word. `model` runs `modeModel`, `toolchain` runs `modeToolchain`, and `sync` or
any other word runs `syncDispatch.ts engineSync`. `engineSync` runs the steps
below inside `withSyncLock` (see § Sync Lock):

1. `parseArgs` reads target words and flags. With no target word,
   `applyDefaultSelection` uses the kit.db harness selection, or
   `LEGACY_SELECTION` when none is stored.
2. `parseModifiers.ts validateModifierFlags` checks modifier values. Dependency
   checks occur only at the operation that consumes the tool; there is no
   global dependency preflight.
3. `DOCKS_KIT_SYNC_CONCURRENCY` sets the cap to one of the
   `syncConcurrency.ts SyncConcurrency` values; unset or empty means the
   highest. Any other value exits 2 before any pipeline starts. Unprobed: no
   unit test sets an invalid value. Read the check (verify:
   `grep -n "DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3" cli/src/engine-native/syncDispatch.ts`)
4. When `claude` is selected, `claudeSettings.ts preflightClaudeSettings` runs
   the abort-class check before any pipeline starts. An invalid deployed
   `~/.claude/settings.json` then stops the whole sync with exit 1.
   (verify: `bunx vitest run cli/test/unit/syncAbortPreflight.test.ts -t "stops every pipeline before it starts when Claude settings are not valid JSON"`)
5. `engineSync` adds `claudeSync`, `codexSync`, `skillsSync`, and `ompSync`
   tasks, in that order, for the selected targets only.
6. `syncConcurrency.ts syncConcurrencyForManifest` sets the cap to 1 when the
   skills manifest is populated and both `claude` and `agents` are selected.
   (verify: `bunx vitest run cli/test/unit/engine-di.test.ts -t "serializes Claude and skills only for a populated manifest"`)
7. `syncConcurrency.ts runBounded` runs the tasks and keeps results in input
   order. After the first rejection, started tasks drain and queued tasks do
   not start. `runBounded` then rejects with the failure of the first task in
   input order.
   (verify: `bunx vitest run cli/test/unit/engine-di.test.ts -t "drains started pipelines, stops queued work, and reports the first input failure"`)
   On a rejection, `engineSync` prints no summary. It prints the
   `--- Failures ---` ledger for failures that other pipelines recorded, then
   rethrows the rejection. Unprobed: no unit test rejects a pipeline inside
   `engineSync`. Read the `catch` arm (verify:
   `grep -n "A rejected pipeline skips the summary" cli/src/engine-native/syncDispatch.ts`)
8. `--- Sync complete ---` summaries print, then next-step notes for the
   pipelines that ran.
9. When any step called `recordFailure`, the `--- Failures ---` ledger lists
   each message, and `engineSync` returns 1.

Target selection alone decides which pipelines run. Each pipeline reads SoT
from the embedded payload.

### Sync Lock

`syncDispatch.ts withSyncLock(ctx, args, body)` runs `body` under
`~/.cache/docks-kit/sync-lock.db` (`scratch.ts syncLockPath`, a
`kitLock.ts acquireKitLock` lock; `tidy-context` owns the lock module).

- `engineSync` takes the lock before `parseArgs`. `parseArgs` reads the
  harness selection from `kit.db`, and that read can migrate `kit.db` and
  rename a legacy `state.json`.
- `modes.ts modeModel` parses its own arguments first. It takes the lock only
  for a write (`model <tool> <value>`), because a write does the same
  read-modify-write of `settings.json` and `config.toml` as sync. The read form
  (`model <tool>`) takes no lock.
- No lock when `args` holds `--dry-run`, `-h`, or `--help` (`UNLOCKED_TOKENS`).
  The `DRY_RUN=1` env global still takes it.
- The wait bound is `SYNC_LOCK_WAIT_MS` (120 000 ms).
  `DOCKS_KIT_SYNC_LOCK_WAIT_MS` (a non-negative integer, in ms) overrides it;
  unset or empty means the default. Any other value prints
  `DOCKS_KIT_SYNC_LOCK_WAIT_MS must be a non-negative integer` and exits 2.
- Held past the bound: print
  `another docks-kit sync holds <path>; run sync again after it ends` and
  return 1, with no call to `body`.
- The lock goes in `finally`, also after an `ExitError`. A signal needs no
  handler: the OS releases the lock when the process ends.

(verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "exits 1 with the held line and leaves HOME unchanged"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "takes no lock in a dry run"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "releases the lock when the run stops with an ExitError"`, and `bunx vitest run cli/test/unit/syncLock.test.ts -t "takes no lock with --dry-run"`)

### Direct Modes

| Invocation | Implementation | Behavior |
|-----------|----------------|----------|
| `model <tool> [value]` | `modeModel` | Get or set deployed Claude/Codex model; set paths reuse the deploy-time modifier functions. A set without `--dry-run` runs under the sync lock. |
| `models [tool]` | `modelsCommand` in `cli/src/commands/models.ts` -> `resolveCatalog` | Effect command, not an EngineNative mode. Prints the live list of each requested or enabled harness with `SoT/models.json` aliases and notes, or the curated list with its fallback reason when the live list is unavailable. |
| `toolchain check` | `modeToolchain` -> `report` | Prints the toolchain table. |
| `toolchain ensure bun` | `modeToolchain` -> `bunBootstrap` | Installs the pinned Bun release when Bun is missing. |
| `toolchain outdated [--refresh]` | `modeToolchain` -> `outdatedReport` | Compares each `verified` pin with the newest upstream release; report only. |
| `toolchain upgrade [--dry-run]` | `modeToolchain` -> `claudeLsp.ts upgradeLspServers` | Raises each npm-owned LSP server below its `verified` pin to that pin. |

### Model Validation

`parseModifiers.ts validateModifierFlags(ctx)` runs after parsing and before
sync work. A modifier flag for a deselected target warns and clears the field.
(verify: `bunx vitest run cli/test/unit/modifierValidation.test.ts -t "warns when explicitly supplied Claude modifiers are deselected"`)
Claude values must be in the resolved catalog (`liveModels.ts resolveCatalog`)
or match the accepted `claude-*` family (`models.ts validateClaudeModel`).
Codex values must match the safe quoted-TOML charset in
`models.ts validateCodexModel`. Any other value exits 2 before deployment.
(verify: `bunx vitest run cli/test/unit/modifierValidation.test.ts -t "rejects an invalid claude sync modifier before creating deployment"` and `bunx vitest run cli/test/unit/modifierValidation.test.ts -t "rejects an invalid codex sync modifier before creating deployment"`)
A `claude-*` value outside the catalog and a Codex catalog miss warn only.
Unprobed: no unit test sets a catalog miss. Read the warnings (verify:
`grep -n "applying anyway" cli/src/engine-native/models.ts`)

## Key Decisions

- `--reconcile` and `--prune` are orthogonal. Combining them runs both layers;
  neither flag alone reaches into the other layer.
- Deploy-time modifiers mutate deployed config away from the SoT and are
  reverted by a later flag-less sync.
- Optional Claude plugin opt-ins are sticky because the plugin keys are absent
  from the SoT; only `--prune` removes them.
- `claudeSync` starts with the memoized Bun bootstrap (`bun.ts bunBootstrap`)
  before materializing, preparing, and committing Claude settings.

## Gotchas

- `sync claude codex` intentionally leaves `agents` and `omp` deselected. The
  stored harness selection (legacy claude/codex/agents fallback) applies only
  when no target word is present.
- `engineCapture` is also used by tests and compiled binaries; keep the
  `native-raw` path private to the harness.
- A failed universal-skill install warns and does not reach the
  `--- Failures ---` ledger (`skillsInstall.ts syncUniversal`).
- A held sync lock delays every check that runs under it. An invalid argument
  or a bad `DOCKS_KIT_SYNC_CONCURRENCY` value exits 2 only after the lock wait
  ends. A rejected sync leaves `~/.cache/docks-kit/sync-lock.db` in HOME.
  (verify: `bunx vitest run cli/test/unit/engine-di.test.ts -t "rejects unsupported effort and advisor values before touching the home"`)
- Never call `withSyncLock` inside a run that already holds the sync lock. A
  second acquire in one process finds the lock held, waits the full bound, and
  exits 1.

## References

- `.agents/skills/sync-orchestration-context/references/flag-matrix.md` - the
  flag table, truth table, and layer scope.
- `.agents/skills/sync-orchestration-context/references/dispatch-flow.md` -
  entry chain, kit-home resolution, sync order, idempotency, new-target
  checklist.
