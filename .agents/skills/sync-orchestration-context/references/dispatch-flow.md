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
- `DOCKS_KIT_ENGINE` set to `bash` exits 2 with the removed-engine recovery
  message. It is not a fallback selector.
- SoT comes from the embedded payload (`payload.ts payloadText`/`payloadBytes`).
  No sync step reads kit files from disk.

## Entry Chain

```text
./docks-kit
|-- cli/dist/docks-kit-<os>-<arch>  preferred only when binary version matches package.json
`-- Bun from source
    |-- find_bun and bootstrap Bun when needed
    |-- bun install --frozen-lockfile when node_modules is absent
    `-- bun cli/src/main.ts "$@"
        `-- Effect CLI root command
            `-- mutating commands call engine(args)
                `-- cli/src/engine.ts
                    `-- runEngineNative(args, services, { envGlobals: false })
```

`kitHome()` (`kitHome.ts resolveKitHome`) identifies a kit root by a
`package.json` whose `name` is `docks-kit`. It checks `DOCKS_KIT_HOME` first.
Next, it takes the nearest such ancestor of the module directory, the
executable directory, or the cwd, in that order. Last, it falls back to the
executable directory. `ctx.repoDir` holds the result for display only.

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
        |       kit.db harness selection, else claude/codex/agents
        |-- validateModifierFlags(ctx)            parseModifiers.ts
        |-- DOCKS_KIT_SYNC_CONCURRENCY            1|2|3, default 3; other values exit 2
        |-- preflightClaudeSettings(ctx)          claudeSettings.ts; invalid settings.json aborts
        |                                         the whole sync before any pipeline starts
        |-- selected tasks, in input order; runBounded runs them below
        |   |-- claudeSync(ctx) when claude is selected
        |   |   |-- bunBootstrap(ctx) first, memoized for this engine run
        |   |   |-- materialize + prepareClaudeSettings(ctx), no mutation
        |   |   |-- syncClaudeRuntime(ctx) when Bun is ready
        |   |   |-- syncClaudeMd(ctx)
        |   |   |-- commitClaudeSettings(ctx)
        |   |   |-- syncRemovals(ctx), legacy subset readiness-gated
        |   |   |-- syncCompactWindow(ctx)
        |   |   |-- syncPermissive(ctx)
        |   |   |-- syncClaudeModel(ctx)
        |   |   |-- syncClaudeEffort(ctx)
        |   |   |-- syncClaudeAdvisor(ctx)
        |   |   |-- syncClaudeJson(ctx)
        |   |   |-- syncConnectorEnv(ctx)
        |   |   |-- syncPlugins(ctx)
        |   |   |-- syncOptionalPlugins(ctx)
        |   |   `-- syncLspServers(ctx)
        |   |-- codexSync(ctx) when codex is selected
        |   |   |-- ensureBubblewrap(ctx)
        |   |   |-- syncConfig(ctx)
        |   |   |-- removeRetiredImportedHooks(ctx)
        |   |   |-- syncCodexModel(ctx)
        |   |   |-- syncCodexEffort(ctx)
        |   |   |-- syncRules(ctx)
        |   |   |-- syncAgentsMd(ctx)
        |   |   |-- syncMarketplace(ctx)
        |   |   |-- removeLegacyDocksMarketplace(ctx)
        |   |   `-- syncPlugins(ctx)
        |   |-- skillsSync(ctx) when agents is selected
        |   |   |-- syncUniversal(ctx)
        |   |   |-- reconcileRemovals(ctx) when prune
        |   |   `-- updateSnapshot(ctx)
        |   `-- ompSync(ctx) when omp is selected
        |       |-- bunBootstrap(ctx), memoized
        |       |-- syncWholeFile: AGENTS.md, mcp.json
        |       |-- syncMergedYaml + syncOmpRemovals: config.yml
        |       |-- syncMergedYaml + syncOmpModelRemovals: models.yml
        |       |-- syncWholeFile: intercom config.json
        |       |-- syncMarketplace(ctx)
        |       `-- syncPlugins(ctx)
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

`models` is not an EngineNative mode. The Effect command in
`cli/src/commands/models.ts` serves it.

## Direct Modes

| Invocation | Implementation | Path |
|-----------|----------------|------|
| `model claude` | `modeModel` get path | Reads deployed and SoT model plus catalog. |
| `model claude opus` | `modeModel` set path | Validates then calls `syncClaudeModel`. |
| `model codex gpt-5.5` | `modeModel` set path | Validates then calls `syncCodexModel`. |
| `models claude` | `modelsCommand` in `cli/src/commands/models.ts` -> `resolveCatalog` | Effect command, not an EngineNative mode. Prints the live Anthropic list with `SoT/models.json` aliases and notes; curated fallback names its reason. |
| `toolchain check` | `modeToolchain` -> `report` | Prints the doctor table. |
| `toolchain ensure bun` | `modeToolchain` -> `bunBootstrap` | Installs the pinned Bun release when Bun is missing. |
| `toolchain outdated [--refresh]` | `modeToolchain` -> `outdatedReport` | Compares each `verified` pin with the newest upstream release; report only. |

## Idempotency Invariants

| Step | Pre-check |
|------|-----------|
| Claude settings first install | Deployed settings file absent. |
| Claude marketplace add | Marketplace name absent from known marketplaces. |
| Claude plugin install | Missing user-scope install record. |
| Universal skill install | Canonical `~/.agents/skills/<basename>` directory absent. |
| Codex rules copy | Backup before overwrite; user-learned `default.rules` is outside SoT. |

## New Target Checklist

1. Add the SoT directory and target selection state to `Ctx`.
2. Add positional target parsing in `parseArgs`.
3. Add dependency checks at each concrete consuming operation.
4. Add the pipeline to the `selected` list in `syncDispatch.ts engineSync`.
5. Add summary and next-step hooks if the target has user-facing output.
6. Mirror the target in `cli/src/commands/sync.ts`.
7. Add or update golden cases for selected-target and default-selection behavior.
