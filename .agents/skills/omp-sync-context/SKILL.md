---
name: omp-sync-context
description: "Use when modifying cli/src/engine-native/ompSync.ts exports ompSync, ompSummary, or ompNextSteps; ompYaml.ts mergeOmpConfig; harnesses.ts readHarnessSelection or writeHarnessSelection; or the omp pipeline in index.ts engineSync and selection in parseArgs.ts parseArgs. Covers omp deployment, YAML merge, plugins, dry-run, refresh, and harness state. Not for cross-cutting sync flags (use sync-orchestration-context) or tool pins (use toolchain-context)."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-378"
    - path: cli/src/engine-native/ompYaml.ts
      lines: "1-107"
    - path: cli/src/engine-native/harnesses.ts
      lines: "1-75"
    - path: cli/src/engine-native/index.ts
      lines: "177-296"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "202-388"
  updated: "2026-08-27"
---

# omp Sync Context

EngineNative owns omp configuration deployment, plugin reconciliation, and harness selection.
Use this context for omp-specific behavior only.

<constraint>
Do not run any `omp` subcommand when `ctx.dryRun` is true.
`omp plugin marketplace add --dry-run` still changes the marketplace registry.
Print the planned action without invoking omp.
</constraint>

<constraint>
Preserve the two deployment roots and all private modes.
Create directories with mode `0700`.
Write files with mode `0600`.
Run `chmod` after each creation or write.
`mkdirSync` and `writeFileSync` apply `mode` only when they create a path.
</constraint>

<constraint>
Read marketplace plugin identity from the composite `id` field.
Read npm plugin identity from `name` plus `version`.
A wrong key makes every run attempt a failing reinstall.
</constraint>

## When To Use

- Change `ompSync`, `ompSummary`, or `ompNextSteps` in `ompSync.ts`.
- Change `mergeOmpConfig` in `ompYaml.ts`.
- Change omp deployment paths, file modes, backups, or restart triggers.
- Change omp marketplace registration or plugin reconciliation.
- Change `readHarnessSelection` or `writeHarnessSelection` in `harnesses.ts`.
- Change the omp pipeline branch in `index.ts` — `engineSync`.
- Change default harness resolution in `parseArgs`.

Use `sync-orchestration-context` for a flag or target affecting several harnesses.
Use `toolchain-context` for the omp binary floor or the `pi-intercom` pin.

## Deployment Ownership

Treat each Source of Truth file as kit-owned input.
Keep user-only keys only through the `config.yml` merge.
Replace the other three deployed files as whole files.

| Source | Deployed target | Root rule |
|---|---|---|
| `SoT/.omp/AGENTS.md` | `~/.omp/agent/AGENTS.md` | Join from `ctx.home`. |
| `SoT/.omp/mcp.json` | `~/.omp/agent/mcp.json` | Join from `ctx.home`. |
| `SoT/.omp/config.yml` | `~/.omp/agent/config.yml` | Join from `ctx.home`. |
| `SoT/.omp/intercom.json` | `$PI_CODING_AGENT_DIR/intercom/config.json` | Default the root to `~/.pi/agent`. |

Resolve a relative `PI_CODING_AGENT_DIR` against the current working directory.
Use an absolute value without modification.
Use `~/.pi/agent` when the value is absent or empty.

Create `~/.omp/agent` only outside dry-run mode.
Create the resolved intercom directory only outside dry-run mode.
Back up a differing deployed file before replacement.
Set every backup file to mode `0600`.
Set a renamed `config.yml` target to mode `0600` again.

### Private Mode Pattern

```ts
// BAD — mode does not repair an existing permissive path.
mkdirSync(directory, { recursive: true, mode: 0o700 })
writeFileSync(target, content, { mode: 0o600 })

// GOOD — chmod enforces the private mode after each operation.
mkdirSync(directory, { recursive: true, mode: 0o700 })
chmodSync(directory, 0o700)
writeFileSync(target, content, { mode: 0o600 })
chmodSync(target, 0o600)
```

## YAML Merge Contract

Treat the deployed document as the merge base.
Let Source of Truth keys win every conflict.
Merge mapping nodes recursively when both sides contain mappings.
Replace every other Source of Truth node, including scalars and sequences.
Preserve deployed-only keys by default.

Prune one deployed-only key class.
Inspect keys directly under `retry.fallbackChains`.
Drop each key containing a slash character.
Preserve unknown role keys without a slash.

A slash-bearing key names a model or provider wildcard.
omp resolves that wildcard before role chains.
A stale wildcard can shadow every kit-managed role chain.

Keep the exception at the direct `retry.fallbackChains` level.
Do not prune slash-bearing keys from unrelated mappings.
Validate both YAML roots as mappings when the deployed document is non-empty.
Return Source of Truth text when the deployed document is empty.
Reject invalid deployed YAML without writing the target.

| Node relationship | Result |
|---|---|
| Both nodes are mappings | Merge recursively. |
| Source of Truth node is scalar or sequence | Replace the deployed node. |
| Key exists only in deployed content | Preserve it. |
| Direct fallback-chain key contains `/` | Prune it. |
| Unknown fallback role has no `/` | Preserve it. |

Anchor this behavior at `ompYaml.ts` — `mergeOmpConfig` — recursive merge and wildcard pruning.
Do not replace this parser with a line-based YAML merge.

## Plugin Inventory Contract

Call `omp plugin list --json` once for inventory.
Expect top-level `marketplace` and `npm` arrays.
Return the fallback refresh path when the inventory shape is invalid.

Read each marketplace row from its composite `id` field.
The value already has the `<plugin>@<marketplace>` form.
Compare it with `docks@docks` and `plan-lifecycle@docks`.
Use the same value for install and upgrade commands.

Read each npm row from `name` and `version`.
Use `name` to find `pi-intercom`.
Compare `version` with the verified toolchain pin.
Use the exact verified version for installation.

```ts
// BAD — marketplace rows do not use name as their installed identity.
const present = row.name === pluginId

// GOOD — id is the composite install and upgrade token.
const present = row.id === pluginId
```

Install a missing marketplace plugin with user scope.
Upgrade an existing marketplace plugin unless refreshes are skipped.
Install a missing npm plugin even when refreshes are skipped.
Refresh a present npm plugin only when its version differs.
Pass `--force` only when replacing a present npm plugin version.

## Dry Run And Refresh Rules

Guard the marketplace command before every `spawnProcess("omp", ...)` call.
Guard plugin inventory before its omp subprocess.
Guard install and upgrade operations before their omp subprocesses.

A dry run prints marketplace registration only when registration is missing.
A dry run prints all planned plugin installations.
A dry run does not probe plugin inventory through omp.
A dry run does not use omp's own `--dry-run` option.

`--skip-plugin-refresh` does not mean skip plugins.
Skip marketplace updates when the marketplace already exists.
Skip marketplace plugin upgrades when each plugin already exists.
Skip npm replacement when any `pi-intercom` version already exists.
Install every missing plugin regardless of this flag.

| State | Normal sync | With `--skip-plugin-refresh` |
|---|---|---|
| Marketplace missing | Register | Register |
| Marketplace present | Update | Skip update |
| Marketplace plugin missing | Install | Install |
| Marketplace plugin present | Upgrade | Skip upgrade |
| npm plugin missing | Install pinned version | Install pinned version |
| npm plugin at wrong version | Force pinned version | Skip replacement |

Anchor this behavior at `ompSync.ts` — `syncMarketplace` and `syncPlugins` — dry-run and refresh boundaries.

## Harness Selection Store

Store the selection at `~/.docks-kit/state.json`.
Resolve that path from the engine home.
Keep the state format at version `1`.
Normalize entries into `claude`, `codex`, `agents`, and `omp` order.
Reject an empty or wholly unknown write.
Write the state directory with mode `0700`.
Write and chmod the state file with mode `0600`.

Treat a missing, unreadable, malformed, or unusable file as no stored selection.
Resolve no stored selection to `claude`, `codex`, and `agents`.
Keep omp opt-in when no state exists.
Let explicit positional targets override the stored selection.

`sync` never prompts for a selection.
`sync` never writes the selection file.
The `docks-kit harnesses` command owns prompting and persistence.
Off a terminal, that command only prints the current selection.

Anchor storage at `harnesses.ts` — `readHarnessSelection` and `writeHarnessSelection` — versioned local state.
Anchor resolution at `parseArgs.ts` — `applyDefaultSelection` — explicit target precedence and legacy fallback.
Anchor dispatch at `index.ts` — `engineSync` omp branch — selected pipeline execution.

## Change Checklist

1. Read every affected function before changing its contract.
2. Preserve both deployment roots.
3. Preserve explicit chmod calls after writes.
4. Preserve recursive mapping merge and wildcard pruning.
5. Verify marketplace identity through `id`.
6. Verify npm identity through `name` and `version`.
7. Keep every omp subprocess behind the dry-run boundary.
8. Test missing and present plugin paths for refresh skipping.
9. Keep sync free of selection prompts and state writes.
10. Use durable module, function, and semantic anchors in tests or notes.
