---
name: sync-orchestration-context
description: "Use when editing docks-kit, cli/src/main.ts, cli/src/engine.ts, cli/src/engine-native/index.ts, cli/src/engine-native/parseArgs.ts, cli/src/engine-native/modes.ts, cli/src/engine-native/models.ts, any sync flag or positional target, renamed-legacy-flag hints, default-all-three dispatch, model validation, or cross-cutting sync idempotency. Not for tool-specific JSON/TOML/plugin/skill logic."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine.ts
      lines: "1-120"
    - path: cli/src/engine-native/index.ts
      lines: "1-140"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-230"
    - path: cli/src/engine-native/modes.ts
      lines: "1-130"
    - path: cli/src/engine-native/models.ts
      lines: "1-90"
  updated: "2026-07-15"
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
Resolve kit paths from `ctx.repoDir`, never from the process working directory.
`kitHome()` now recognizes a kit root by `SoT/` plus `package.json`; the engine
must remain safe when invoked from any directory.
</constraint>

<constraint>
Use `ExitError` from `parseArgs.ts` for intentional exit-2 validation failures
and command-abort parity. Unknown flags, renamed legacy flags, bad modifier
values, and selected-target model validation failures must abort before any
mutation.
</constraint>

<constraint>
Add or change flags in both places that expose the public contract:
`parseArgs(ctx, args)` in `cli/src/engine-native/parseArgs.ts` and the matching
`cli/src/commands/*.ts` option list. Then update the golden matrix.
</constraint>

## When To Use

- Adding a sync flag, positional target, or direct engine mode.
- Changing default target selection when no `claude`, `codex`, or `agents` word
  is supplied.
- Debugging why a target did or did not run.
- Changing model validation or the catalog in `SoT/models.json`.
- Updating the `docks-kit` launcher or `cli/src/engine.ts` selector behavior.

For verified-version gates and install callbacks, use `toolchain-context`.
For Claude settings, Codex TOML, plugins, or universal skills, use the matching
kit-mechanic skill.

## Entry Points

| Invocation | Path | Notes |
|-----------|------|-------|
| `./docks-kit <args>` | Version-matching compiled binary in `cli/dist/`, otherwise Bun-from-source | The launcher compares binary `--version` with `package.json`, so stale ignored builds cannot mask newer source. |
| `cli/src/main.ts` | Effect CLI root command | Parses commands and routes mutating commands through `engine(args)`. |
| `cli/src/engine.ts` | `engine` / `engineCapture` | Runs EngineNative. `native-raw` child re-spawn remains harness/private compiled-binary plumbing. |
| `cli/src/engine-native/index.ts` | `runEngineNative` | Dispatches `sync`, `model`, `models`, and `toolchain` modes. |

`DOCKS_KIT_ENGINE` value `bash` deliberately exits 2 with the removed-engine message.
Do not add a new fallback behind that variable.

## Core Patterns

### Flag Parsing

`parseArgs(ctx, args)` owns the sync flag vocabulary. Target words call the
target selector and set `ctx.targetFilterSet`; when it remains false,
`engineSync` treats all three targets as selected.

| Flag | Context field | Notes |
|------|---------------|-------|
| `--dry-run` | `ctx.dryRun` | Preview only. |
| `--reconcile` | `ctx.reconcile` | Settings layer only. |
| `--prune` | `ctx.prune` | Plugin, marketplace, and kit-managed skills removals. |
| `--skip-rtk` | `ctx.skipRtk` | Skips optional RTK and bubblewrap installs. |
| `--skip-plugin-refresh` | `ctx.skipPluginRefresh` | Installs missing plugins but skips refresh-only calls; update chains this flag. |
| `--yes` | `ctx.assumeYes` | Auto-accepts verified-pin prompts. |
| `--claude-model=<m>` | `ctx.claudeModel` | Validated before sync mutations. |
| `--codex-model=<m>` | `ctx.codexModel` | Charset gate blocks TOML injection. |
| `--claude-compact-window=<n|Nk>` | `ctx.claudeCompactWindow` | Normalized by `parseCompactWindow`. |
| `--claude-permissive` | `ctx.claudePermissive` | Clears deployed ask/deny arrays. |
| `--claude-plugin=<name>` | `ctx.claudePlugins` | Repeatable; allow-list is `supabase`, `n8n`. |

Renamed legacy flags still have explicit exit-2 hint arms. Keep them as refusal
documentation only; do not reintroduce compatibility behavior.

### Dispatch Order

`runEngineNative` builds `ctx` with repo/home/tool paths, then:

1. `engineSync`: `parseArgs` -> `validateModelFlags`. Dependency checks occur
   only at the operation that consumes the tool; there is no global preflight.
2. `claudeSync(ctx)` when the target is selected and `SoT/.claude` exists.
3. `codexSync(ctx)` when the target is selected and `SoT/.codex` exists.
4. `skillsSync(ctx)` when the target is selected and `SoT/.agents` exists.
5. Per-tool summaries and next-step notes for tools that actually ran.

Partial checkouts still skip absent SoT directories; absence is not an error.

### Direct Modes

| Invocation | Implementation | Behavior |
|-----------|----------------|----------|
| `model <tool> [value]` | `modeModel` | Get or set deployed Claude/Codex model; set paths reuse the deploy-time modifier functions. |
| `models <tool>` | `printModels` | Prints the manifest catalog from `SoT/models.json`. |
| `toolchain check` | `modeToolchain` -> `report` | Prints the toolchain table. |
| `toolchain ensure <tool>` | `modeToolchain` -> `ensure` or Bun bootstrap | Ensures one managed tool. |

### Model Validation

`validateModelFlags(ctx)` runs after parsing and before sync work. A
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
- RTK still runs first in `claudeSync`: first install can rewrite settings, and
  the later settings merge must normalize that output.

## Gotchas

- A bare value flag such as `--claude-model` or `--claude-plugin` exits 2; only
  `--flag=value` forms are accepted by the engine parser.
- `--claude-plugin=other` exits 2 because only the known opt-ins are accepted.
- `sync claude codex` intentionally leaves `agents` deselected. Default-all-three
  happens only when no target word is present.
- `engineCapture` is also used by tests and compiled binaries; keep the
  `native-raw` path private to the harness.

## References

- `references/flag-matrix.md` - full flag and layer-scope truth table.
- `references/dispatch-flow.md` - annotated EngineNative dispatch order.
