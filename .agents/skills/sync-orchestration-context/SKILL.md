---
name: sync-orchestration-context
description: "Use when editing docks-kit, cli/src/main.ts, cli/src/argv.ts, cli/src/argvValidate.ts, cli/src/engine.ts, or cli/src/engine-native index.ts, engineCtx.ts, syncDispatch.ts, syncConcurrency.ts, parseArgs.ts, parseHelp.ts, or modes.ts: sync flags, the sync locks (withSyncLock, withFolderLocks, folderLockPaths, withHomeAndFolderLocks, sync-lock.db, DOCKS_KIT_SYNC_LOCK_WAIT_MS), the failure ledger, or dry-run and idempotency rules. Not for toolchain (use toolchain-context), omp (use omp-sync-context), the lock module itself (use tidy-context), or the golden harness (use engine-native-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: docks-kit
      lines: "1-131"
    - path: cli/src/main.ts
      lines: "1-89"
    - path: cli/src/argv.ts
      lines: "1-59"
    - path: cli/src/argvValidate.ts
      lines: "1-57"
    - path: cli/src/argvSurface.ts
      lines: "1-410"
    - path: cli/src/engine.ts
      lines: "1-59"
    - path: cli/src/kitHome.ts
      lines: "1-102"
    - path: cli/src/payload.ts
      lines: "1-19"
    - path: cli/src/commands/sync.ts
      lines: "1-76"
    - path: cli/src/engine-native/exec.ts
      lines: "1-346"
    - path: cli/src/commands/update.ts
      lines: "1-317"
    - path: cli/src/engine-native/index.ts
      lines: "1-66"
    - path: cli/src/engine-native/engineCtx.ts
      lines: "1-60"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-224"
    - path: cli/src/engine-native/kitLock.ts
      lines: "1-121"
    - path: cli/src/engine-native/syncConcurrency.ts
      lines: "1-43"
    - path: cli/src/engine-native/failures.ts
      lines: "1-16"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-33"
    - path: cli/src/engine-native/parseHelp.ts
      lines: "1-26"
    - path: cli/src/engine-native/modes.ts
      lines: "1-67"
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-146"
    - path: cli/src/engine-native/ompPlugins.ts
      lines: "1-379"
    - path: cli/src/engine-native/bun.ts
      lines: "1-120"
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-253"
  updated: "2026-11-20"
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
intentional exit-2 validation failures and command-abort parity. Unknown flags
and positional words must abort before any mutation. `sync` declares no
positional argument, so on the public CLI `effect/cli` refuses a word such as
`omp` with `Unexpected positional argument: "omp"` and exit 1; on the raw
channel `parseArgs` prints `Unknown arg: <word>` and throws `ExitError(2)`.
(verify: `bunx vitest run cli/test/unit/removedNames.test.ts -t "refuses each sync target word as an unexpected positional argument"`)
</constraint>

<constraint>
Report a failed kit-managed harness-CLI operation through
`failures.ts recordFailure`, never a bare `warn`. `syncDispatch.ts engineSync,
failure ledger` prints every recorded message under `--- Failures ---` after the
summary and returns 1, so exit 2 stays reserved for `ExitError` validation
aborts and exit 1 means a mutation did not happen. A skip is not a failure: a
missing harness CLI, missing git, an unavailable plugin inventory, and a missing
Bun or pi-intercom pin in `SoT/toolchain.json` keep exit 0. Probe before
spawning, so a host without the tool never records one.
(verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "fails the sync when the XDG candidate appears after the locks"` for exit 1 with the ledger, and `bunx vitest run cli/test/unit/ompPluginInventory.test.ts -t "deploys config without spawning omp plugins when git is unavailable"` for an empty ledger)
</constraint>

<constraint>
Add or change a flag in every layer that owns the public contract:

- `parseArgs.ts parseArgs` (engine vocabulary) and `parseHelp.ts printUsage`
  (engine sync help).
- The matching `cli/src/commands/*.ts` option list (public CLI), and for sync
  the engine word that `commands/sync.ts syncCommand` forwards.

Then update the golden matrix.
</constraint>

## When To Use

- Adding a sync flag or a direct engine mode.
- Debugging why a sync step did or did not run.
- Updating the `docks-kit` launcher, the public argv layer, or the
  `cli/src/engine.ts` selector behavior.

For the doctor report and Bun managed install, use
`.agents/skills/toolchain-context/SKILL.md`. For omp, use
`.agents/skills/omp-sync-context/SKILL.md`.

## Entry Points

| Invocation | Path | Notes |
|-----------|------|-------|
| `./docks-kit <args>` | Compiled binary in `cli/dist/` when its version matches and it is current, otherwise Bun-from-source | The launcher compares binary `--version` with `package.json`, and it also rejects the binary when a file under `cli/src` or `cli/docs` is newer than the binary, so stale ignored builds cannot mask newer source. |
| `cli/src/main.ts` | Raw-channel branch, then `prepareArgv`, then the Effect CLI root command | `DOCKS_KIT_ENGINE=native-raw` skips `prepareArgv` and Effect and calls `runEngineNative` directly with `{ envGlobals: true }`. Otherwise mutating commands run through `engine(args)`. The root command registers `argv.ts COMMANDS`, the one subcommand list that the argv surfaces also use. A new subcommand needs an entry there and a `Console.log` line in the hand-written root overview in `main.ts`. A new engine mode also needs a `case` arm in `index.ts runEngineNative`. |
| `cli/src/argv.ts` | `prepareArgv` | Validates and normalizes argv before Effect parses it. See § Public Argv Layer. |
| `cli/src/engine.ts` | `engine` | Exits 2 on an unsupported host or `DOCKS_KIT_ENGINE=bash`, then runs EngineNative in-process with `{ envGlobals: false }`. `native-raw` is the harness-private golden channel. |
| `cli/src/engine-native/index.ts` | `runEngineNative(argv, services?, options?)` | Builds `ctx` through `engineCtx.ts makeCtx`, then dispatches `toolchain` and `sync`. Any other first word also runs sync. `options.envGlobals` defaults to false; only the `main.ts` `native-raw` branch passes `{ envGlobals: true }`. |

(verify: `bunx vitest run cli/test/unit/engine.test.ts -t "runs the public engine with env globals disabled"` and `bunx vitest run cli/test/unit/argv.test.ts -t "resolves every registered subcommand"`)

Do not add a new fallback behind `DOCKS_KIT_ENGINE`.

## Public Argv Layer

`cli/src/argv.ts prepareArgv` runs before Effect parses anything. It scans argv
against the surfaces that `argvSurface.ts buildSurfaces` derives from the
command definitions. `argvValidate.ts validateScannedArgv` then rejects with
exit 2. It checks in this order:

1. An unknown command that also carries a flag that the scan cannot resolve. A
   bare unknown command passes this layer, and Effect rejects it with exit 1.
2. Unknown flags.
3. Values on boolean flags, for example `--dry-run=false`.
4. Repeated flags that are not repeatable.

- Every sync flag is a boolean. `commands/sync.ts syncCommand` declares no
  positional argument and forwards the flags as engine words (`-v` becomes
  `--verbose`).
- A removed flag such as `--prune`, `--agents`, `--omp`, or `--remove-plugins`
  gets the plain `unknown flag <flag> for 'sync'` refusal. The kit keeps no
  rename-hint table.

(verify: `bunx vitest run cli/test/unit/removedNames.test.ts -t "refuses the removed sync flags as unknown flags"`, `bunx vitest run cli/test/unit/argv.test.ts -t "rejects --prune as unknown now that universal skills are gone"`, and `bunx vitest run cli/test/unit/argv.test.ts -t "rejects a separate boolean literal after the sync dry-run boolean"`)

## Core Patterns

### Flag Parsing

`parseArgs(ctx, args)` owns the engine flag vocabulary.
`.agents/skills/sync-orchestration-context/references/flag-matrix.md` is the
only flag table: each flag's `Ctx` field, consumer, and layer scope. Do not
copy it here.

`parseArgs` accepts only flags. Any other word prints `Unknown arg: <word>`
and throws `ExitError(2)`. Do not add compatibility behavior for a removed
word or flag.

### Dispatch Order

`index.ts runEngineNative` builds `ctx` through `engineCtx.ts makeCtx`.
`makeCtx` reads the unprefixed env globals (`DRY_RUN` and
`DOCKS_KIT_VERBOSE`; see `CtxOptions`) only when
`options.envGlobals` is true. `runEngineNative` then switches on the first
word. `toolchain` runs `modeToolchain`, and `sync` or any other word runs
`syncDispatch.ts engineSync`. `engineSync` runs the steps below inside
`withSyncLock` (see § Sync Lock):

1. `parseArgs` reads the flags. Dependency checks occur only at the
   operation that consumes the tool; there is no global dependency preflight.
2. `runSync` resolves the omp folders once (`ompSync.ts ompWriteFolders`). A
   writing sync takes their folder locks (see § Sync Lock), and
   `runPipeline` runs the remaining steps.
3. `runPipeline` takes the terminal lease and runs `ompSync`. On a rejection,
   `runPipeline` prints no summary. It prints the `--- Failures ---` ledger
   for the failures recorded before the rejection, then rethrows it.
   Unprobed: no unit test rejects the pipeline inside `engineSync`. Read the
   `catch` arm (verify:
   `grep -n "A rejected pipeline skips the summary" cli/src/engine-native/syncDispatch.ts`)
4. The `--- Sync complete ---` summary prints, then the omp next-step notes.
5. When any step called `recordFailure`, the `--- Failures ---` ledger lists
   each message, and `engineSync` returns 1.

The omp pipeline reads SoT from the embedded payload.

### Sync Lock

`syncDispatch.ts withSyncLock(ctx, args, body)` runs `body` under
`~/.cache/docks-kit/sync-lock.db` (`scratch.ts syncLockPath`, a
`kitLock.ts acquireKitLock` lock; `tidy-context` owns the lock module).

- `engineSync` takes the lock before `parseArgs`. Sync never opens `kit.db`.
- `modes.ts modeToolchain` takes no lock.
- No lock in a dry run: `args` holds `--dry-run`, `-h`, or `--help`
  (`UNLOCKED_TOKENS`), or `ctx.dryRun` is true. `makeCtx` sets `ctx.dryRun`
  from the `DRY_RUN=1` env global only when `options.envGlobals` is true, so a
  public run with a stray `DRY_RUN` writes and takes the lock.
- The wait bound is `SYNC_LOCK_WAIT_MS` (120 000 ms).
  `DOCKS_KIT_SYNC_LOCK_WAIT_MS` (a non-negative safe integer, in ms) overrides
  it; unset or empty means the default. Any other value prints
  `DOCKS_KIT_SYNC_LOCK_WAIT_MS must be a non-negative safe integer` and exits 2.
  A digit string above `Number.MAX_SAFE_INTEGER` also exits 2, because
  `Number` would round it or make it Infinity.
- Held past the bound: print
  `another docks-kit sync holds <path>; run sync again after it ends` and
  return 1, with no call to `body`.
- The lock goes in `finally`, also after an `ExitError`. A signal needs no
  handler: the OS releases the lock when the process ends.

(verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "exits 1 with the held line and leaves HOME unchanged"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "takes no lock in a dry run"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "releases the lock when the run stops with an ExitError"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "exits 2 when the lock wait is not a non-negative safe integer"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "DRY_RUN env global"`, and `bunx vitest run cli/test/unit/syncLock.test.ts -t "prints the help with -h and --help while another sync holds the lock"`)

Folder locks: two homes can share an omp folder (`PI_CODING_AGENT_DIR`,
`PI_CONFIG_DIR`, `XDG_DATA_HOME`, or a symlink). Their home locks differ, so
each writer of such a folder also takes `<folder>/.docks-kit-sync-lock.db`
(`scratch.ts folderSyncLockPath`).

- `runSync` takes them after `parseArgs`, through
  `withFolderLocks(ctx, folders, body)`, for the three folders of
  `ompSync.ts ompWriteFolders`: the omp agent folder, the intercom folder, and
  the omp data root. `runSync` resolves them once, before the locks, and passes
  them into `ompSync` (see `omp-sync-context`).
- `folderLockPaths` canonicalizes each folder without the need for it to
  exist: the real path of its nearest existing ancestor, joined with the rest.
  It removes duplicates, keeps nested folders, and sorts by folder, so an
  ancestor comes before its descendants. Every run takes the locks in that
  order, after the home lock, so no two runs wait on each other in a cycle.
- `withKitLocks` creates a missing folder (`mkdirSync`, recursive, mode 0700)
  just before its lock, so the locks of its ancestors in the set are already
  held. The mode applies only to the folders that the call creates: it runs no
  chmod, and the lock keeps the folder mode (`privateDirectory: false`). The
  omp pipeline then runs `ensureDirectory` (mode 0700) under the locks.
- `withHomeAndFolderLocks(home, folders, err, body)` takes the home lock and
  the folder locks outside a sync run. `docks-kit omp --fast` uses it for the
  omp agent folder (see `omp-sync-context`).
- A dry run (`ctx.dryRun`) takes no folder lock and creates no folder. The
  held line and the wait bound are those of the home lock.

(verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "takes one lock per real folder"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "shared omp agent folder"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "creates no intercom folder in a held omp agent folder and keeps its mode"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "missing omp data root"`, `bunx vitest run cli/test/unit/syncLock.test.ts -t "takes no omp folder lock in a dry run"`, and `bunx vitest run cli/test/unit/folderLockCreate.test.ts -t "creates a missing folder and its parents with mode 0700"`)

### Direct Modes

| Invocation | Implementation | Behavior |
|-----------|----------------|----------|
| `toolchain check` | `modeToolchain` -> `report` | Prints the toolchain table. |
| `toolchain ensure bun` | `modeToolchain` -> `bunBootstrap` | Installs the pinned Bun release when Bun is missing. |
| `toolchain outdated [--refresh]` | `modeToolchain` -> `outdatedReport` | Compares each `verified` pin with the newest upstream release; report only. |

## Key Decisions

- Sync has no removal flag. The omp retired-key passes run on every sync
  (see `omp-sync-context`).
- `--skip-plugin-refresh` only keeps a present `pi-intercom` at its installed
  version; a missing `pi-intercom` still installs. The retirement of the former
  `docks` marketplace plugins and the kit plugin link run in every real sync.
- `ompSync` starts with the memoized Bun bootstrap (`bun.ts bunBootstrap`).

## Gotchas

- `docks-kit sync` always runs the omp pipeline. There is no harness
  selection and no target word.
- A held sync lock delays every check that runs under it. An invalid argument
  exits 2 only after the lock wait ends. A rejected sync leaves
  `~/.cache/docks-kit/sync-lock.db` in HOME.
  (verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "exits 1 with the held line and leaves HOME unchanged"`)
- Never call `withSyncLock` inside a run that already holds the sync lock. A
  second acquire in one process finds the lock held, waits the full bound, and
  exits 1.

## References

- `.agents/skills/sync-orchestration-context/references/flag-matrix.md` - the
  flag table, truth table, and layer scope.
- `.agents/skills/sync-orchestration-context/references/dispatch-flow.md` -
  entry chain, kit-home resolution, sync order, and idempotency.
