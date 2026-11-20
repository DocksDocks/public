# Dispatch Flow - docks-kit to EngineNative

## Critical Constraints

- Mutating commands route through `cli/src/engine.ts`, which runs
  `runEngineNative` in-process.
- The harness-only raw channel is `DOCKS_KIT_ENGINE=native-raw`; public users
  should not be routed through it.
- Only the `main.ts` `native-raw` branch passes `{ envGlobals: true }` to
  `runEngineNative`. Only that channel honors the unprefixed env globals that
  `engineCtx.ts makeCtx` reads (`DRY_RUN` and `DOCKS_KIT_VERBOSE`);
  `engine.ts engine` passes `{ envGlobals: false }`.
  (verify: `bunx vitest run cli/test/unit/envGlobals.test.ts -t "ignores env globals unless the raw channel enables them"`)
- `DOCKS_KIT_ENGINE` set to `bash` exits 2 with the removed-engine recovery
  message. It is not a fallback selector.
- SoT comes from the embedded payload (`payload.ts payloadText`/`payloadBytes`).
  No sync step reads kit files from disk.

## Entry Chain

```text
./docks-kit
|-- cli/dist/docks-kit-<os>-<arch>  preferred only when binary version matches package.json
|                                   and no file under cli/src or cli/docs is newer than it
`-- Bun from source
    |-- find_bun and bootstrap Bun when needed
    |-- bun install --frozen-lockfile when node_modules/effect is absent
    `-- bun cli/src/main.ts "$@"
        |-- DOCKS_KIT_ENGINE=native-raw
        |   `-- runEngineNative(rawArgs, undefined, { envGlobals: true })
        `-- prepareArgv(argv)                        argv.ts; argvValidate.ts rejects with exit 2
            `-- Effect CLI root command                 subcommands: argv.ts COMMANDS
                `-- mutating commands call engine(args)
                    `-- cli/src/engine.ts
                        `-- runEngineNative(args, services, { envGlobals: false })
```

`kitHome()` (`kitHome.ts resolveKitHome`) identifies a kit root by a
`package.json` whose `name` is `docks-kit`. It checks `DOCKS_KIT_HOME` first.
Next, it takes the nearest such ancestor of the module directory, the
executable directory, or the cwd, in that order. Last, it falls back to the
executable directory. `ctx.repoDir` holds the result for display only.
`kitHome()` also selects the update target (`commands/update.ts`) and the
checkout that `commands/sync.ts updateNudge` checks. `updateNudge` starts
`git` through `exec.ts spawnHost`, so a Windows host never runs a `git.exe`
from the current directory.
(verify: `bunx vitest run cli/test/unit/kitHome.test.ts -t "resolveKitHome"` and `bunx vitest run cli/test/unit/syncUpdateNudge.test.ts -t "runs git through spawnHost"`)

## Sync Execution Order

```text
runEngineNative(argv, services?, options?)        index.ts
|-- makeCtx(services, { envGlobals })             engineCtx.ts; env globals only when true
`-- switch (argv[0])
    |-- toolchain -> modeToolchain(ctx, args)     modes.ts; no lock
    `-- sync/default -> engineSync(ctx, args)     syncDispatch.ts
        |-- withSyncLock(ctx, args, ...)          ~/.cache/docks-kit/sync-lock.db; none for
        |                                         --dry-run, -h, --help, or ctx.dryRun; held
        |                                         past the wait bound: held line, returns 1
        |-- parseArgs(ctx, args)                  flags only; any other word: Unknown arg, exit 2
        |-- ompWriteFolders(ctx)                  resolved once, before the locks; ompSync
        |                                         and its omp children use the result
        |-- withFolderLocks(ctx, folders, ...)    <folder>/.docks-kit-sync-lock.db of the
        |                                         ompWriteFolders agent, intercom, and
        |                                         data root folders; canonical, sorted
        |                                         ancestor-first; a missing folder is made
        |                                         under the locks of its ancestors in the
        |                                         set; none in a dry run
        `-- runPipeline(ctx, omp)
            |-- ompSync(ctx, omp)                 ompSync.ts; on a rejection, runPipeline
            |                                     prints the "--- Failures ---" ledger and
            |                                     rethrows
            |-- "--- Sync complete ---" summary
            |-- omp next steps
            `-- "--- Failures ---" ledger when recordFailure ran; returns 1
        releaseKitLock of each lock in finally
```

`ompSync` owns its step order. Read the function body, not a copy here
(verify: `sed -n '/^export async function ompSync/,/^}/p' cli/src/engine-native/ompSync.ts`).
The order rules that matter:

- `ompSync` starts with `bun.ts bunBootstrap`, which is memoized on
  `ctx.bunRuntime` for the engine run.
- A writing sync runs under the sync lock and the folder locks, so two syncs
  never run the read-modify-write of one file at the same time. `SKILL.md`
  § Sync Lock owns the lock rules.

## Direct Modes

`.agents/skills/sync-orchestration-context/SKILL.md` § Direct Modes owns the
mode table. `toolchain-context` owns the toolchain operations.

## Idempotency Invariants

| Step | Pre-check |
|------|-----------|
| omp retired marketplace plugin uninstall | A `scope: "user"` row of `docks@docks` or `plan-lifecycle@docks` in the `omp plugin list --json` inventory; a project-scope row only warns, and an unreadable inventory skips the retirement (`ompPlugins.ts retireMarketplacePlugins`). |
| omp docks marketplace remove | No user uninstall failed, and the active registry lists `docks`, or no active registry exists and the legacy registry lists it (`ompPlugins.ts registryListsDocks`). |
| omp npm plugin install | `pi-intercom` absent or at a version other than the pin; a present `pi-intercom` gets nothing under `--skip-plugin-refresh` (`ompPlugins.ts syncPlugins`). |
