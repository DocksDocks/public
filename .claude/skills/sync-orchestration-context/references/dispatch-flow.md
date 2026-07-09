# Dispatch Flow - docks-kit to EngineNative

## Critical Constraints

- Mutating commands route through `cli/src/engine.ts`, which runs
  `runEngineNative` in-process.
- The harness-only raw channel is `DOCKS_KIT_ENGINE=native-raw`; public users
  should not be routed through it.
- `DOCKS_KIT_ENGINE` set to `bash` exits 2 with the removed-engine recovery
  message. It is not a fallback selector.
- Missing SoT directories are skipped per target. Partial checkouts remain valid.

## Entry Chain

```text
./docks-kit
|-- cli/dist/docks-kit-<os>-<arch>  preferred compiled binary when present
`-- Bun from source
    |-- find_bun and bootstrap Bun when needed
    |-- bun install --frozen-lockfile when node_modules is absent
    `-- bun cli/src/main.ts "$@"
        `-- Effect CLI root command
            `-- mutating commands call engine(args)
                `-- cli/src/engine.ts
                    `-- runEngineNative(args)
```

`kitHome()` resolves the repo root by `DOCKS_KIT_HOME`, nearest ancestor with
`SoT/` plus `package.json`, then the package root.

## Sync Execution Order

```text
runEngineNative(argv)
|-- makeCtx()
|-- command dispatch
    |-- sync/default -> engineSync(ctx, args)
    |   |-- parseArgs(ctx, args)
    |   |-- preflight(ctx)
    |   |-- validateModelFlags(ctx)
    |   |-- claudeSync(ctx) when target selected and SoT/.claude exists
    |   |   |-- syncRtk(ctx) first
    |   |   |-- syncScripts(ctx)
    |   |   |-- syncHooks(ctx)
    |   |   |-- syncClaudeMd(ctx)
    |   |   |-- syncSettings(ctx)
    |   |   |-- syncCompactWindow(ctx)
    |   |   |-- syncPermissive(ctx)
    |   |   |-- syncClaudeModel(ctx)
    |   |   |-- syncClaudeJson(ctx)
    |   |   |-- syncConnectorEnv(ctx)
    |   |   |-- syncRemovals(ctx)
    |   |   |-- syncPlugins(ctx)
    |   |   |-- syncOptionalPlugins(ctx)
    |   |   `-- syncLspServers(ctx)
    |   |-- codexSync(ctx) when target selected and SoT/.codex exists
    |   |   |-- ensureBubblewrap(ctx)
    |   |   |-- syncConfig(ctx)
    |   |   |-- syncCodexModel(ctx)
    |   |   |-- syncRules(ctx)
    |   |   |-- syncAgentsMd(ctx)
    |   |   |-- syncMarketplace(ctx)
    |   |   |-- removeLegacyDocksMarketplace(ctx)
    |   |   `-- syncPlugins(ctx)
    |   |-- skillsSync(ctx) when target selected and SoT/.agents exists
    |   |   |-- syncUniversal(ctx)
    |   |   |-- reconcileRemovals(ctx) when prune
    |   |   |-- syncAgentBrowserCli(ctx)
    |   |   |-- syncEffectSolutionsCli(ctx)
    |   |   `-- updateSnapshot(ctx)
    |   `-- summaries and next steps
    |-- model -> modeModel(ctx, args)
    |-- models -> printModels(ctx.repoDir, tool)
    `-- toolchain -> modeToolchain(ctx, args)
```

## Direct Modes

| Invocation | Implementation | Path |
|-----------|----------------|------|
| `model claude` | `modeModel` get path | Reads deployed and SoT model plus catalog. |
| `model claude opus` | `modeModel` set path | Validates then calls `syncClaudeModel`. |
| `model codex gpt-5.5` | `modeModel` set path | Validates then calls `syncCodexModel`. |
| `models claude` | `printModels` | Prints catalog from `SoT/models.json`. |
| `toolchain check` | `modeToolchain` -> `report` | Prints the doctor table. |
| `toolchain ensure <tool>` | `modeToolchain` -> managed ensure | Calls the owning callback for the tool. |

## Idempotency Invariants

| Step | Pre-check |
|------|-----------|
| Claude settings first install | Deployed settings file absent. |
| Claude marketplace add | Marketplace name absent from known marketplaces. |
| Claude plugin install | Missing user-scope install record. |
| Universal skill install | Canonical `~/.agents/skills/<basename>` directory absent. |
| RTK init | `~/.claude/RTK.md` absent. |
| Codex rules copy | Backup before overwrite; user-learned `default.rules` is outside SoT. |

## New Target Checklist

1. Add the SoT directory and target selection state to `Ctx`.
2. Add positional target parsing in `parseArgs`.
3. Add preflight requirements.
4. Add the SoT-presence dispatch in `engineSync`.
5. Add summary and next-step hooks if the target has user-facing output.
6. Mirror the target in `cli/src/commands/sync.ts`.
7. Add or update golden cases for selected-target and default-all behavior.
