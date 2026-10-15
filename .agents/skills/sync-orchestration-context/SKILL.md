---
name: sync-orchestration-context
description: "Use when editing docks-kit, cli/src/main.ts, cli/src/engine.ts, cli/src/engine-native/index.ts, cli/src/engine-native/engineCtx.ts, cli/src/engine-native/syncDispatch.ts, cli/src/engine-native/syncConcurrency.ts, cli/src/engine-native/parseArgs.ts, cli/src/engine-native/parseModifiers.ts, cli/src/engine-native/modes.ts, cli/src/engine-native/models.ts, cli/src/engine-native/liveModels.ts, any sync flag or positional target, renamed-legacy-flag hints, stored harness selection (legacy claude/codex/agents fallback), model validation, or cross-cutting sync idempotency. Not for tool-specific JSON/TOML/plugin/skill logic."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine.ts
      lines: "1-99"
    - path: cli/src/engine-native/index.ts
      lines: "1-68"
    - path: cli/src/engine-native/engineCtx.ts
      lines: "1-154"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-155"
    - path: cli/src/engine-native/syncConcurrency.ts
      lines: "1-55"
    - path: cli/src/engine-native/failures.ts
      lines: "1-16"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-194"
    - path: cli/src/engine-native/parseModifiers.ts
      lines: "1-225"
    - path: cli/src/engine-native/modes.ts
      lines: "1-173"
    - path: cli/src/engine-native/models.ts
      lines: "1-98"
    - path: cli/src/engine-native/liveModels.ts
      lines: "1-263"
  updated: "2026-10-14"
---

# Sync Engine Orchestration

EngineNative is the only supported sync engine. The entry chain is:
`./docks-kit` -> `cli/src/main.ts` -> `cli/src/engine.ts` -> `runEngineNative`
in `cli/src/engine-native/index.ts`. `DOCKS_KIT_ENGINE` set to `bash` is now a
hard failure that points to the `bash-engine-final` tag for archaeology only.

<constraint>
Every new sync step must honor `ctx.dryRun` and print the same `[dry-run]`
surface the golden suite records. Do the existence checks and path resolution
before the dry-run action point when the real engine does so; do not let dry-run
execute a write, install, removal, or network mutation.
</constraint>

<constraint>
Read SoT content only through `payload.ts` (`payloadText`/`payloadBytes`); never
read kit files from disk at sync time. `ctx.repoDir` is `kitHome()` and is
display-only (the `Repo:` summary line). `kitHome()` (`cli/src/kitHome.ts
resolveKitHome`) identifies a kit root by a `package.json` whose `name` is
`docks-kit`. It checks `DOCKS_KIT_HOME` first. Next, it takes the nearest such
ancestor of the module directory, the executable directory, or the cwd, in that
order. Last, it falls back to the executable directory. `kitHome()` also
selects the update target (`update.ts`), the status `Kit home`, the checkout
that `sync.ts updateNudge` checks, and the source-mode `main.ts` path for
`engineCapture` (`engine.ts`).
</constraint>

<constraint>
Use `ExitError` from `parseArgs.ts` for intentional exit-2 validation failures
and command-abort parity. Unknown flags, renamed legacy flags, bad modifier
values, and selected-target model validation failures must abort before any
mutation.
</constraint>

<constraint>
Report a failed kit-managed harness-CLI operation through
`failures.ts recordFailure`, never a bare `warn`. `syncDispatch.ts engineSync,
failure ledger` prints every recorded message under `--- Failures ---` after the summary
and returns 1, so exit 2 stays reserved for `ExitError` validation aborts and
exit 1 means a mutation did not happen. A skip is not a failure: a missing
harness CLI, missing git, a missing `SoT/toolchain.json` pin, and an unavailable
inventory keep exit 0. Probe before spawning, so a host without the tool never
records one.
</constraint>

<constraint>
Add or change flags in both places that expose the public contract:
`parseArgs(ctx, args)` in `cli/src/engine-native/parseArgs.ts` and the matching
`cli/src/commands/*.ts` option list. Then update the golden matrix.
</constraint>

## When To Use

- Adding a sync flag, positional target, or direct engine mode.
- Changing default target selection when no `claude`, `codex`, `agents`, or
  `omp` word is supplied.
- Debugging why a target did or did not run.
- Changing model validation or the catalog in `SoT/models.json`.
- Updating the `docks-kit` launcher or `cli/src/engine.ts` selector behavior.

For the doctor report and Bun managed install, use `toolchain-context`.
For Claude settings, Codex TOML, plugins, or universal skills, use the matching
kit-mechanic skill.

## Entry Points

| Invocation | Path | Notes |
|-----------|------|-------|
| `./docks-kit <args>` | Version-matching compiled binary in `cli/dist/`, otherwise Bun-from-source | The launcher compares binary `--version` with `package.json`, so stale ignored builds cannot mask newer source. |
| `cli/src/main.ts` | Effect CLI root command | Parses commands and routes mutating commands through `engine(args)`. |
| `cli/src/engine.ts` | `engine` / `engineCapture` | Runs EngineNative. `native-raw` child re-spawn remains harness/private compiled-binary plumbing. |
| `cli/src/engine-native/index.ts` | `runEngineNative(argv, services?, options?)` | Builds `ctx` through `engineCtx.ts makeCtx`, then dispatches `model`, `toolchain`, and `sync`. Any other first word also runs sync. `options.envGlobals` defaults to false; only the `main.ts` `native-raw` branch passes `{ envGlobals: true }`. |

`models` is not an EngineNative mode. The Effect command in
`cli/src/commands/models.ts` serves it.

`DOCKS_KIT_ENGINE` value `bash` deliberately exits 2 with the removed-engine message.
Do not add a new fallback behind that variable.

## Core Patterns

### Flag Parsing

`parseArgs(ctx, args)` owns the sync flag vocabulary. Target words (`claude`,
`codex`, `agents`, `omp`) call the target selector and set
`ctx.targetFilterSet`. When it remains false, `parseArgs.ts
applyDefaultSelection` applies the stored kit.db harness selection. When no
selection is stored, it falls back to `claude`, `codex`, and `agents`
(`harnesses.ts LEGACY_SELECTION`).

| Flag | Context field | Notes |
|------|---------------|-------|
| `--dry-run` | `ctx.dryRun` | Preview only. |
| `--reconcile` | `ctx.reconcile` | Settings layer only. |
| `--prune` | `ctx.prune` | Plugin, marketplace, and kit-managed skills removals. |
| `--skip-bubblewrap` | `ctx.skipBubblewrap` | Skips optional bubblewrap bootstrap for the Codex Linux sandbox. |
| `--skip-plugin-refresh` | `ctx.skipPluginRefresh` | Installs missing plugins but skips refresh-only calls; no command passes it automatically. |
| `--claude-model=<m>` | `ctx.claudeModel` | Validated before sync mutations. |
| `--codex-model=<m>` | `ctx.codexModel` | Charset gate blocks TOML injection. |
| `--claude-compact-window=<n|Nk>` | `ctx.claudeCompactWindow` | Normalized by `parseCompactWindow`. |
| `--claude-permissive` | `ctx.claudePermissive` | Clears deployed ask/deny arrays. |
| `--claude-plugin=<name>` | `ctx.claudePlugins` | Repeatable; allow-list is `supabase`, `n8n`. |

Renamed legacy flags still have explicit exit-2 hint arms. Keep them as refusal
documentation only; do not reintroduce compatibility behavior.

### Dispatch Order

`index.ts runEngineNative` builds `ctx` through `engineCtx.ts makeCtx`.
`makeCtx` reads the unprefixed env globals (`ENV_GLOBAL_KEYS`) only when
`options.envGlobals` is true. `runEngineNative` then switches on the first
word. `model` runs `modeModel`, `toolchain` runs `modeToolchain`, and `sync` or
any other word runs `syncDispatch.ts engineSync`:

1. `parseArgs` reads target words and flags. With no target word,
   `applyDefaultSelection` uses the kit.db harness selection, or `claude`,
   `codex`, and `agents` when none is stored.
2. `parseModifiers.ts validateModifierFlags` checks modifier values. Dependency
   checks occur only at the operation that consumes the tool; there is no
   global dependency preflight.
3. `DOCKS_KIT_SYNC_CONCURRENCY` sets the cap to `1`, `2`, or `3` (default `3`).
   Any other value exits 2.
4. `claudeSettings.ts preflightClaudeSettings` runs the abort-class check before
   any pipeline starts. An invalid deployed `~/.claude/settings.json` stops the
   whole sync with exit 1.
5. `engineSync` adds `claudeSync`, `codexSync`, `skillsSync`, and `ompSync`
   tasks, in that order, for the selected targets only.
6. `syncConcurrency.ts syncConcurrencyForManifest` sets the cap to 1 when the
   skills manifest is populated and both `claude` and `agents` are selected.
7. `syncConcurrency.ts runBounded` runs the tasks and keeps results in input
   order. After the first rejection, started tasks drain and queued tasks do
   not start. On a rejection, `engineSync` prints no summary. It prints the
   `--- Failures ---` ledger for failures that other pipelines recorded, then
   rethrows the earliest rejection.
8. `--- Sync complete ---` summaries print, then next-step notes for the
   pipelines that ran.
9. When any step called `recordFailure`, the `--- Failures ---` ledger lists
   each message, and `engineSync` returns 1.

Target selection alone decides which pipelines run. Each pipeline reads SoT
from the embedded payload.

### Direct Modes

| Invocation | Implementation | Behavior |
|-----------|----------------|----------|
| `model <tool> [value]` | `modeModel` | Get or set deployed Claude/Codex model; set paths reuse the deploy-time modifier functions. |
| `models [tool]` | `modelsCommand` in `cli/src/commands/models.ts` -> `resolveCatalog` | Effect command, not an EngineNative mode. Prints the live list of each requested or enabled harness with `SoT/models.json` aliases and notes, or the curated list when the live list is unavailable. |
| `toolchain check` | `modeToolchain` -> `report` | Prints the toolchain table. |
| `toolchain ensure bun` | `modeToolchain` -> `bunBootstrap` | Installs the pinned Bun release when Bun is missing. |
| `toolchain outdated [--refresh]` | `modeToolchain` -> `outdatedReport` | Compares each `verified` pin with the newest upstream release; report only. |

### Model Validation

`parseModifiers.ts validateModifierFlags(ctx)` runs after parsing and before sync work. A
model flag for a deselected target warns and clears the field. Claude values
must be in the catalog or match the accepted `claude-*` family with a warning.
Codex values must match the safe quoted-TOML charset; catalog misses warn only.

## Key Decisions

- `--reconcile` and `--prune` are orthogonal. Combining them runs both layers;
  neither flag alone reaches into the other layer.
- Deploy-time modifiers mutate deployed config away from the SoT and are
  reverted by a later flag-less sync.
- Optional Claude plugin opt-ins are sticky because the plugin keys are absent
  from the SoT; only `--prune` removes them.
- `claudeSync` starts with the memoized Bun bootstrap before materializing,
  preparing, and committing Claude settings.

## Gotchas

- A bare value flag such as `--claude-model` or `--claude-plugin` exits 2; only
  `--flag=value` forms are accepted by the engine parser.
- `--claude-plugin=other` exits 2 because only the known opt-ins are accepted.
- `sync claude codex` intentionally leaves `agents` and `omp` deselected. The
  stored harness selection (legacy claude/codex/agents fallback) applies only
  when no target word is present.
- `engineCapture` is also used by tests and compiled binaries; keep the
  `native-raw` path private to the harness.

## References

- `references/flag-matrix.md` - full flag and layer-scope truth table.
- `references/dispatch-flow.md` - annotated EngineNative dispatch order.
