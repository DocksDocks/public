---
name: omp-sync-context
description: "Use when changing the docks-kit omp harness: the sync omp pipeline (ompSync.ts, syncDispatch.ts engineSync), omp paths (ompPaths.ts), deploy, YAML merge, and retired-key prune of config.yml and models.yml (ompFileDeploy.ts, ompYaml.ts, ompRemovals.ts), marketplace and plugin passes (ompMarketplace.ts, ompPlugins.ts, ompKitPlugin.ts, ompChild.ts), harness selection and session model in kit.db (harnesses.ts, kitDb.ts, parseArgs.ts), or the docks-kit omp free-session launcher (commands/omp.ts, ompOverlay.ts). Covers dry-run and --skip-plugin-refresh boundaries, the omp folder locks and the omp child environment (ompWriteFolders, spawnOmp, omp --fast), and private file modes. Not for cross-cutting sync flags (use sync-orchestration-context) or tool pins (use toolchain-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-155"
    - path: cli/src/engine-native/ompFileDeploy.ts
      lines: "1-116"
    - path: cli/src/engine-native/ompMarketplace.ts
      lines: "1-140"
    - path: cli/src/engine-native/ompPlugins.ts
      lines: "1-417"
    - path: cli/src/engine-native/ompKitPlugin.ts
      lines: "1-108"
    - path: cli/src/engine-native/ompRemovals.ts
      lines: "1-385"
    - path: cli/src/engine-native/failures.ts
      lines: "1-16"
    - path: cli/src/engine-native/ompPaths.ts
      lines: "1-123"
    - path: cli/src/engine-native/ompYaml.ts
      lines: "1-213"
    - path: cli/src/engine-native/harnesses.ts
      lines: "1-144"
    - path: cli/src/engine-native/kitDb.ts
      lines: "1-256"
    - path: cli/src/engine-native/ompOverlay.ts
      lines: "1-310"
    - path: cli/src/commands/omp.ts
      lines: "1-474"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-337"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-206"
    - path: cli/src/engine-native/atomicWrite.ts
      lines: "1-123"
    - path: cli/src/engine-native/ompFastMode.ts
      lines: "1-63"
    - path: cli/src/engine-native/ompChild.ts
      lines: "1-26"
    - path: cli/src/commands/harnesses.ts
      lines: "1-80"
  updated: "2026-11-07"
---

# omp Sync Context

EngineNative owns omp configuration deployment, plugin reconciliation, and harness selection.
Use this context for omp-specific behavior only.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

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
Resolve every omp path through `ompPaths.ts ompPaths`, which mirrors upstream
`dirs.ts` `DirResolver`. Never join `ctx.home` with `.omp`.
`PI_CONFIG_DIR` is a root dirname under home, not a path.
`OMP_PROFILE` wins over `PI_PROFILE` whenever it is defined, including when it
is empty; an invalid or reserved name degrades to the default profile.
A named profile relocates the config root to `profiles/<name>`.
`PI_CODING_AGENT_DIR` replaces the agent directory for the default profile
only, after `path.resolve` normalization. The default profile ignores a value
that equals `<config root>/profiles/<PI_PROFILE>/agent`, because omp exports
that value in a profile session. While an override is active, XDG is disabled.
The agent directory never moves under XDG; only `dataRoot` does, on Linux and
macOS, and only when the probed omp directory already exists.
Deploy `AGENTS.md`, `config.yml`, `models.yml`, and `mcp.json` to `agentDir`, and read
`marketplaces.json` from `dataRoot`.
Resolution stays env plus `existsSync` so a dry run runs no omp subcommand.
</constraint>

Plugin identity, the marketplace registry states, the probe guard, and
failure reporting are constraints too. Read
`references/plugins-and-marketplace.md` before you change `ompMarketplace.ts`
or `ompPlugins.ts`.

Verify path resolution:
`bunx vitest run cli/test/unit/ompPaths.test.ts -t "disables XDG while a PI_CODING_AGENT_DIR override is active"`
and `bunx vitest run cli/test/unit/ompPaths.test.ts -t "prefers OMP_PROFILE even when empty, and otherwise falls back to PI_PROFILE"`.

## When To Use

- Change `ompSync`, `ompSummary`, or `ompNextSteps` in `ompSync.ts`.
- Change `mergeOmpConfig`, `mergeOmpModels`, or the shared `mergeYamlDocuments` core in `ompYaml.ts`.
- Change omp path resolution in `ompPaths.ts` — `ompPaths`.
- Change omp deployment file modes, backups, or restart triggers.
- Change the retired-entry prune in `ompRemovals.ts` — `syncOmpRemovals` or `syncOmpModelRemovals`.
- Change omp marketplace registration or plugin reconciliation.
- Change `readHarnessSelection`, `writeHarnessSelection`, `readOmpSessionModel`, or `writeOmpSessionModel` in `harnesses.ts`.
- Change the free-session run overlay in `ompOverlay.ts` or the launcher in `cli/src/commands/omp.ts`.
- Change the omp pipeline branch in `syncDispatch.ts` — `engineSync`.
- Change default harness resolution in `parseArgs`.

Use `sync-orchestration-context` for a flag or target affecting several harnesses.
Use `toolchain-context` for the omp binary floor or the `pi-intercom` pin.

## Deployment Ownership

Treat each Source of Truth file as kit-owned input.
Keep user-only keys through both the `config.yml` and `models.yml` merges.
Replace the other three deployed files as whole files.

| Source | Deployed target | Root rule |
|---|---|---|
| `SoT/.omp/AGENTS.md` | `<agentDir>/AGENTS.md` | Take `agentDir` from `ompPaths`. |
| `SoT/.omp/mcp.json` | `<agentDir>/mcp.json` | Take `agentDir` from `ompPaths`. |
| `SoT/.omp/config.yml` | `<agentDir>/config.yml` | Take `agentDir` from `ompPaths`. |
| `SoT/.omp/models.yml` | `<agentDir>/models.yml` | Take `agentDir` from `ompPaths`. |
| `SoT/.omp/intercom.json` | `<intercomRoot>/intercom/config.json` | Use the profile `agentDir` under a named profile; otherwise use `$PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`. |
| `SoT/.omp/plugin/**` (payload prefix) | `~/.docks-kit/omp-plugin/` | Kit-owned: `ompKitPlugin.ts syncKitPlugin` writes each file only when it differs, sets `package.json` `version` to the kit version, removes files that the payload no longer lists, and keeps no backups. |

Under a named profile (`OMP_PROFILE` or `PI_PROFILE`), use the profile `agentDir` from `ompPaths`.
omp exports `PI_CODING_AGENT_DIR` as that profile `agentDir`, and `pi-intercom` reads that variable.
Without a named profile, trim the `PI_CODING_AGENT_DIR` value as `pi-intercom` does.
Resolve a relative value against the current working directory.
Use an absolute value without modification.
Use `~/.pi/agent` when the value is absent or empty.

Create the `ompPaths` `agentDir` only outside dry-run mode.
Create the resolved intercom directory only outside dry-run mode.
Back up a differing deployed file before replacement.
The retired-entry prune shares the backup of the merge that runs before it in
the same sync (see `references/yaml-merge.md`).
Set every backup file to mode `0600`.
Replace a merged or pruned `config.yml` or `models.yml` through
`atomicWrite.ts replaceFile` with mode `0600`. The temporary file and rename
keep a symlinked target as a link. `ompFastMode.ts toggleDeployedOpenAiFast`
writes `config.yml` the same way.

Verify the symlink rule:
`bunx vitest run cli/test/unit/ompRemovals.test.ts -t "merges a symlinked config.yml into the link target and keeps the link"`
and `bunx vitest run cli/test/unit/ompFastMode.test.ts -t "keeps a symlinked config.yml a link"`.

### Folder Locks

Two homes can share an omp folder through `PI_CODING_AGENT_DIR`, a symlink,
`XDG_DATA_HOME`, or a `PI_CONFIG_DIR` with `..`. Their home locks differ.
So a writing `sync omp` also takes `<folder>/.docks-kit-sync-lock.db` in each
folder of `ompSync.ts ompWriteFolders`: the `ompPaths` `agentDir`, the
resolved intercom directory, and the `ompPaths` `dataRoot`.

- `syncDispatch.ts runSync` calls `ompWriteFolders` once, before the locks,
  and passes the result into `ompSync`. `ompSync` writes only into these
  locked folders. A second resolution could pick a `$XDG_DATA_HOME/omp`
  folder that another sync created after the locks.
- Every `omp` command of the marketplace and plugin passes starts through
  `ompChild.ts spawnOmp`. When the locked data root is the config root, the
  child gets no `XDG_DATA_HOME`, so the omp resolver keeps the locked root.
  When the locked data root is the XDG root, the child keeps the environment
  of the sync. This applies on the default profile and on named profiles.
- At the end of a writing run, still under the locks, `ompSync` resolves the
  data root again with `ompPaths` and the environment of the sync. When it
  differs from the locked root, a later omp process would not see the
  plugins. So `ompSync` records `omp data root moved to <root> during the
  sync; run docks-kit sync again` through `failures.ts recordFailure`, and the
  sync exits 1. The next sync locks and fills the new root.
- The data root is locked also when it is missing. The lock step then creates
  it under the locks of its ancestors in the set. With an overridden
  `agentDir`, an empty `<home>/<PI_CONFIG_DIR|.omp>` folder can appear.
- `~/.docks-kit/omp-plugin` and the plugin upgrade log stay under the home, so
  the home lock covers them.
- `commands/omp.ts toggleFastUnderLocks` checks `<agentDir>/config.yml` before
  any lock (`ompFastMode.ts requireDeployedConfig`). A missing file exits 2,
  and the run creates no omp folder. Otherwise it runs `docks-kit omp --fast`
  under the home sync lock and always the `agentDir` lock
  (`syncDispatch.ts withHomeAndFolderLocks`), with the wait and the held line
  of a sync.
- The locks cover the folder that the kit deploys into, not the target of a
  symlinked file. A lock in the target folder would put a lock file into a
  folder that the user manages, such as a dotfiles repository. Residual: two
  homes whose `config.yml` (or another deployed file) links to one shared
  file can overwrite the merge of each other.
- A dry run takes no folder lock. `sync-orchestration-context` owns the lock
  order and the folder creation rule.

Verify: `bunx vitest run cli/test/unit/syncLock.test.ts -t "shared omp intercom folder"`,
`bunx vitest run cli/test/unit/syncLock.test.ts -t "shared omp data root"`,
`bunx vitest run cli/test/unit/syncLock.test.ts -t "keeps each omp child on the locked config root"`,
and `bunx vitest run cli/test/unit/ompFastMode.test.ts -t "omp --fast under the folder lock"`.

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

Verify the private modes and the kit plugin rules:
`bunx vitest run cli/test/unit/ompKitPlugin.test.ts -t "writes the plugin package with the kit version and private modes"`
and `bunx vitest run cli/test/unit/ompKitPlugin.test.ts -t "removes stale files and empty directories from the plugin directory"`.

## References

- `references/yaml-merge.md` - YAML merge contract and the retired-entry prune.
- `references/plugins-and-marketplace.md` - plugin and marketplace constraints, inventory contract, dry-run and refresh rules.
- `references/state-and-launcher.md` - kit.db state store, harness selection, session model, and the free-session launcher.

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
