# Dispatch Flow - docks-kit to EngineNative

## Critical Constraints

- Mutating commands route through `cli/src/engine.ts`, which runs
  `runEngineNative` in-process.
- The harness-only raw channel is `DOCKS_KIT_ENGINE=native-raw`; public users
  should not be routed through it.
- Only the `main.ts` `native-raw` branch passes `{ envGlobals: true }` to
  `runEngineNative`. Only that channel honors the unprefixed env globals in
  `engineCtx.ts ENV_GLOBAL_KEYS`. `engineCapture` removes them from its child
  environment.
  (verify: `bunx vitest run cli/test/unit/engine.test.ts -t "strips env globals from the raw capture child and keeps the other variables"`)
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
        |-- DOCKS_KIT_ENGINE=native-raw|native-capture
        |   `-- runEngineNative(rawArgs, undefined, { envGlobals: rawChannel === "native-raw" })
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
`kitHome()` also selects the update target (`commands/update.ts`), the status
`Kit home`, the checkout that `commands/sync.ts updateNudge` checks, and the
source-mode `main.ts` path for `engine.ts engineCapture`. `updateNudge` starts
`git` through `exec.ts spawnHost`, so a Windows host never runs a `git.exe`
from the current directory.
(verify: `bunx vitest run cli/test/unit/kitHome.test.ts -t "resolveKitHome"` and `bunx vitest run cli/test/unit/syncUpdateNudge.test.ts -t "runs git through spawnHost"`)

## Sync Execution Order

```text
runEngineNative(argv, services?, options?)        index.ts
|-- makeCtx(services, { envGlobals })             engineCtx.ts; env globals only when true
`-- switch (argv[0])
    |-- model -> modeModel(ctx, args)
    |-- toolchain -> modeToolchain(ctx, args)
    `-- sync/default -> engineSync(ctx, args)     syncDispatch.ts
        |-- parseArgs(ctx, args)
        |   `-- applyDefaultSelection(ctx) when no target word:
        |       kit.db harness selection, else harnesses.ts LEGACY_SELECTION
        |-- validateModifierFlags(ctx)            parseModifiers.ts
        |-- DOCKS_KIT_SYNC_CONCURRENCY            a SyncConcurrency value; other values exit 2
        |-- preflightClaudeSettings(ctx)          claudeSettings.ts; claude selected only:
        |                                         invalid settings.json aborts the whole sync
        |                                         before any pipeline starts
        |-- selected tasks, in input order; runBounded runs them below
        |   |-- claudeSync(ctx) when claude is selected        claudeSync.ts
        |   |-- codexSync(ctx) when codex is selected          codexSync.ts
        |   |-- skillsSync(ctx) when agents is selected        skillsSync.ts
        |   `-- ompSync(ctx) when omp is selected              ompSync.ts
        |-- syncConcurrencyForManifest            syncConcurrency.ts; cap 1 when the skills
        |                                         manifest is populated and claude and agents
        |                                         are both selected
        |-- runBounded(tasks, ctx.syncConcurrency)
        |       input-ordered results; on the first rejection, started tasks drain,
        |       queued tasks do not start, and the earliest rejection propagates;
        |       engineSync then prints the "--- Failures ---" ledger and rethrows
        |-- "--- Sync complete ---" summaries
        |-- next steps for the pipelines that ran
        `-- "--- Failures ---" ledger when recordFailure ran; returns 1
```

Each pipeline function owns its step order. Read the function body, not a copy
here (verify: `sed -n '/^export async function claudeSync/,/^}/p' cli/src/engine-native/claudeSync.ts`;
use the same command for `codexSync`, `skillsSync`, and `ompSync` in their
modules). The order rules that matter across pipelines:

- `claudeSync` and `ompSync` start with `bun.ts bunBootstrap`, which is
  memoized on `ctx.bunRuntime` for the engine run.
- `claudeSync` materializes and prepares Claude settings with no mutation, then
  commits them. Its deploy-time modifiers run after that base deploy.
- `codexSync` applies `--codex-model` and `--codex-effort` in two phases.
  First, `codexToml.ts replaceTopLevelSetting` folds the values into the SoT
  text before the `syncConfig` merge. Then `syncCodexModel` and
  `syncCodexEffort` run after the merge and compare with the config text read
  before it. A new Codex modifier needs both phases. A post-merge edit alone
  writes the SoT value and then the modifier value on each run, so the file
  is not byte-stable.
  (verify: `bunx vitest run cli/test/unit/codexTomlMerge.test.ts -t "keeps the backup when it runs again"`)
- `skillsSync` calls `skillsPrune.ts reconcileRemovals` only with `--prune`.

## Direct Modes

`.agents/skills/sync-orchestration-context/SKILL.md` § Direct Modes owns the
mode table. The `model` mode has two paths:

| Invocation | Implementation | Path |
|-----------|----------------|------|
| `model claude` or `model codex` | `modeModel` get path | Reads deployed and SoT model, then prints the resolved catalog. |
| `model <tool> <id>` | `modeModel` set path | Validates `<id>` with `models.ts validateClaudeModel` or `validateCodexModel`, then calls `syncClaudeModel` or `syncCodexModel`. `validateCodexModel` rejects an ID outside `^[A-Za-z0-9._-]+$`. A charset-safe ID that is not in the catalog passes with a warning. (verify: `bunx vitest run cli/test/unit/modifierValidation.test.ts -t "rejects invalid codex models without changing deployment"`) Unprobed: no unit test covers the catalog-miss warning (verify: `grep -n "applying anyway" cli/src/engine-native/models.ts`). |

## Idempotency Invariants

| Step | Pre-check |
|------|-----------|
| Claude settings first install | Deployed settings file absent (`claudeSettings.ts prepareClaudeSettings`). |
| Claude marketplace add | Marketplace name absent from known marketplaces (`claudePluginPasses.ts syncPlugins`, pass 1). |
| Claude plugin install | Missing user-scope install record (`claudePluginPasses.ts syncPlugins`, pass 2). |
| Universal skill install | Canonical `~/.agents/skills/<basename>` directory absent (`skillsInstall.ts syncUniversal`). |
| Codex rules copy | Byte-identical file skipped. Each name that the SoT ships is deployed over an existing file, recorded or not: a file that differs is backed up to `<name>.bak` and replaced. A rules file that the SoT dropped is removed only while it holds the kit bytes recorded in `.kit-managed-rules`. Cleanup never reads or removes a file that the SoT does not ship and no sync recorded, such as the user-learned `default.rules` (`codexSync.ts syncRules`). (verify: `bunx vitest run cli/test/unit/codexRulesDeploy.test.ts -t "never removes a rules file the kit did not write"`) |

## New Target Checklist

1. Add the harness name to `harnesses.ts Harness` and `HARNESSES`, and a
   `sync<Name>` selection flag to `engineCtx.ts Ctx` (initialized in `makeCtx`).
   SoT content stays in the embedded payload (`payload.ts`); `Ctx` holds no
   SoT path.
2. Map the word in `parseArgs.ts TARGET_FLAGS` and `applySelection`. Add a
   `case` label for the word in the `parseArgs` target switch; without it,
   the word exits 2 with `Unknown arg`. List the target in
   `parseHelp.ts printUsage`.
3. Add dependency checks at each concrete consuming operation.
4. Add the pipeline to the `selected` list in `syncDispatch.ts engineSync`.
5. Add summary and next-step hooks if the target has user-facing output.
6. Mirror the target in `cli/src/commands/sync.ts VALID_TARGETS`.
7. Add or update golden cases for selected-target and default-selection behavior.
