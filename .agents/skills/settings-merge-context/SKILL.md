---
name: settings-merge-context
description: "Use when modifying cli/src/engine-native Claude settings: claudeSync.ts syncClaudeJson, syncConnectorEnv; claudeSettings.ts prepareClaudeSettings, commitClaudeSettings, preflightClaudeSettings, syncCompactWindow, syncPermissive; claudeSettingsModifiers.ts syncClaudeModel, syncClaudeEffort, syncClaudeAdvisor; claudeRuntime.ts materializeClaudeSettings; settings.ts mergeSettings, reconcileSettings; claudeRemovals.ts syncRemovals; claudeRetired.ts RETIRED_PERMISSION_RULES. Covers sentinels, atomic commit, merge modes, retired-rule and hook pruning, and ~/.claude.json carve-outs. Not for plugin install passes (use plugin-bootstrap-context), Codex config.toml merge (use codex-config-merge-context), or sync flags (use sync-orchestration-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-312"
    - path: cli/src/engine-native/claudeSettings.ts
      lines: "1-201"
    - path: cli/src/engine-native/claudeRemovals.ts
      lines: "1-383"
    - path: cli/src/engine-native/claudeRuntime.ts
      lines: "1-157"
    - path: cli/src/engine-native/claudeSettingsModifiers.ts
      lines: "1-115"
    - path: cli/src/engine-native/settings.ts
      lines: "1-42"
    - path: cli/src/engine-native/claudeRetired.ts
      lines: "1-165"
    - path: cli/src/engine-native/jq.ts
      lines: "1-71"
    - path: cli/src/engine-native/atomicWrite.ts
      lines: "1-123"
    - path: cli/src/engine-native/os/posix.ts
      lines: "1-83"
    - path: cli/src/engine-native/os/windows.ts
      lines: "1-184"
    - path: cli/src/engine-native/parseModifiers.ts
      lines: "1-225"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-155"
    - path: cli/src/engine-native/parseArgs.ts
      lines: "1-206"
    - path: cli/src/engine-native/models.ts
      lines: "1-101"
    - path: cli/src/efforts.ts
      lines: "1-89"
    - path: SoT/.claude/settings.json
      lines: "1-1005"
    - path: SoT/.claude/mcp-servers.json
      lines: "1-3"
  updated: "2026-11-07"
---

# Settings Merge

EngineNative owns Claude settings deployment. `claudeSync.ts claudeSync`
orchestrates the passes. `claudeSettings.ts` owns the settings transaction and
the `syncCompactWindow` and `syncPermissive` modifiers.
`claudeSettingsModifiers.ts` owns `syncClaudeModel`, `syncClaudeEffort`, and
`syncClaudeAdvisor`. `claudeRemovals.ts` owns retired-artifact pruning.
Pure merge helpers live in `settings.ts` on top of `jq.ts deepMerge` and
`jq.ts uniqueStrings`. The old jq programs remain useful as the behavioral spec
and are inlined in `cli/test/unit/settings.test.ts`; production logic is
TypeScript.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
Write through `atomicWrite.ts replaceFile` (temporary sibling, then rename), so
the target is replaced only after the new JSON is serialized.
`commitClaudeSettings` and the `syncRemovals` settings passes copy
`settings.json` to `settings.json.bak` before they write; keep that. The
deploy-time modifiers and `syncClaudeJson` write without a backup.
</constraint>

<constraint>
Validate existing JSON before merging. When `claude` is selected,
`claudeSettings.ts preflightClaudeSettings` runs from `syncDispatch.ts` before
any pipeline starts. A corrupt deployed settings file is reported, left
untouched, and aborts the sync. When `claude` is not selected, the preflight
returns without a check, and the other pipelines run. Never merge into a parse
failure.
(verify: `bunx vitest run cli/test/unit/syncAbortPreflight.test.ts -t "stops every pipeline before it starts when Claude settings are not valid JSON"`)
Unprobed: no unit test covers the skip when `claude` is not selected. Read the
`ctx.syncClaude` guard (verify: `grep -n -A2 "export function preflightClaudeSettings" cli/src/engine-native/claudeSettings.ts`)
</constraint>

<constraint>
`showTurnDuration` and user-scoped `mcpServers` belong in `~/.claude.json`, not
`~/.claude/settings.json`. The settings schema rejects them in the settings file.
</constraint>

## When To Use

- Changing `prepareClaudeSettings` / `commitClaudeSettings` first-install,
  additive merge, reconcile, or atomic replacement behavior.
- Changing `claudeRuntime.ts materializeClaudeSettings`, sentinel validation,
  no-cutover projection, or absolute hook/statusline commands.
- Changing `mergeSettings` or `reconcileSettings`.
- Adding a key to `~/.claude.json` through `syncClaudeJson`.
- Adding user-scoped MCP servers in `SoT/.claude/mcp-servers.json`.
- Changing `syncConnectorEnv`, `syncRemovals`, or deploy-time modifiers.

## Merge Modes

| Mode | Function | Behavior |
|------|----------|----------|
| First install | `prepareClaudeSettings` absent-target path | The default mode serializes `mergeSettings(materialized, {})`, so permission arrays are sorted and a second default sync finds no change. `--reconcile` serializes `reconcileSettings(materialized, {})`, which keeps the SoT array order. If an SoT array is not sorted, a later default sync sorts it and writes `settings.json.bak`. `commitClaudeSettings` atomically creates the deployed file. |
| Default | `mergeSettings(repo, user)` | Deep merge with repo values winning, but `permissions.allow`, `deny`, and `ask` are unioned and deduped. |
| `--reconcile` | `reconcileSettings(repo, user)` | Deep merge with repo values winning; permissions arrays are replaced by SoT values. |

(verify: `bunx vitest run cli/test/unit/claudeRuntime.test.ts -t "installs the merged form, so a second sync with the same SoT finds no change"`
and `grep -n -A1 "export function reconcileSettings" cli/src/engine-native/settings.ts`)

User-only top-level keys survive both merge modes.
(verify: `bunx vitest run cli/test/unit/contract-settings.test.ts -t "settings merge contract"`)
`claudeRemovals.ts syncRemovals, curated removed-manifest pass` force-prunes only
manifest-listed settings keys, exact permission-array members, exact retired kit
hook handlers, and stale files.
(verify: `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "prunes withdrawn plugin keys but leaves user and shipped plugins enabled as configured"`
and `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "removes obsolete Write permission rules without touching user or current Edit rules"`
and `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "removes only the retired kit hook handlers and keeps user PreToolUse and Stop handlers"`
and `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "removes home-relative retired commands even while runtime migration is deferred"`)

## Retired Rules

`claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` names
the rules the kit once shipped and no longer does: the broad shell allow rules,
`WebFetch`, and the malformed single-backslash deny spellings. `claudeRemovals.ts
syncRemovals, retired-permission pass` force-prunes those exact strings from the
kit-managed `~/.claude/settings.json` on every sync. Without that pass,
`settings.ts mergeSettings, permission-array union` would retain a rule after
the SoT dropped it.
(verify: `bunx vitest run cli/test/unit/claudeRetiredPermissions.test.ts -t "needs a prune after additive merge to withdraw a formerly shipped rule"`)

<constraint>
The kit deploys its `PowerShell(...)` deny and ask rules on every host. Claude
Code leaves the PowerShell tool opt-in off Windows rather than unavailable, so a
host that enables it must already carry the guards. Never gate permission deny
rules by platform.
</constraint>

`SoT/.claude/settings.json` is the only place a shipped rule is declared.
`claudeRemovals.ts REMOVED_MANIFEST.permissionRules` is the full prune set. It
spreads `claudeRetired.ts RETIRED_PERMISSION_RULES` and adds other exact rules
inline. Add new retirements to `RETIRED_PERMISSION_RULES`.
(verify: `grep -n -A12 'permissionRules:' cli/src/engine-native/claudeRemovals.ts`)

To restore an exact retired rule for one checkout, put it in that checkout's
`.claude/settings.local.json`. Claude Code resolves that file against the
working directory and merges it over user settings. Sync never reads or writes
the checkout-local file. Claude Code has no user-scope local settings file. For
a machine-wide restoration, add the rule to `SoT/.claude/settings.json`. At the
same time, remove the exact string from `claudeRetired.ts
RETIRED_PERMISSION_RULES, exact retired-rule inventory`.
(verify: `bunx vitest run cli/test/unit/claudeRetiredPermissions.test.ts -t "drops retired rules on a flag-less sync while keeping user, SoT, and checkout-local rules"`)

<constraint>
Retiring a permission rule takes two edits. Delete it from
`SoT/.claude/settings.json`. Add the exact old string to `claudeRetired.ts
RETIRED_PERMISSION_RULES, exact retired-rule inventory`. Match by exact string
only. A different user-authored rule in the kit-managed file survives the
prune. An exact checkout-only override belongs in that checkout's
`.claude/settings.local.json`.
</constraint>

## Key Placement And Connector Env

Key placement and owner functions for `~/.claude/settings.json` versus
`~/.claude.json` live in
`.agents/skills/settings-merge-context/references/claude-json-keys.md`.

`syncConnectorEnv` disables the Claude.ai cloud connectors, which no JSON
setting controls. It persists `ENABLE_CLAUDEAI_MCP_SERVERS=false` when absent,
through `hostOs().environmentSetting` (`os/posix.ts`, `os/windows.ts`). On
POSIX, it appends an export to a shell profile chosen from `$SHELL`. It skips
the write if any candidate profile already names the variable. On Windows, it
probes `reg query HKCU\Environment` and sets the variable with `setx`. Only new
shells or terminals see it.

## Deploy-Time Modifiers

`syncCompactWindow`, `syncPermissive`, `syncClaudeModel`, `syncClaudeEffort`,
and `syncClaudeAdvisor` run after the
prepared settings commit and mutate only deployed settings. A later flag-less sync restores
SoT values, except user-only keys that the SoT does not declare.

| Flag | Function | Mutation |
|------|----------|----------|
| `--claude-compact-window=<n\|Nk>` | `syncCompactWindow` | Sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`. |
| `--claude-permissive` | `syncPermissive` | Clears `permissions.ask` and `permissions.deny`. |
| `--claude-model=<m>` | `claudeSettingsModifiers.ts syncClaudeModel` | Sets `.model`, or deletes it for `default`. |
| `--claude-effort=<level>` | `claudeSettingsModifiers.ts syncClaudeEffort` | Sets `.effortLevel`; `default` sets the SoT default level (`efforts.ts resolveEffort`). |
| `--claude-advisor=on\|off\|default` | `claudeSettingsModifiers.ts syncClaudeAdvisor` | Sets `.advisorModel` to `opus` for `on`; deletes it for `off` and `default`. |

Flag grammar owners:

- `--claude-compact-window`: `parseModifiers.ts parseCompactWindow`.
- `--claude-model`: `models.ts validateClaudeModel`.
- `--claude-effort`: `efforts.ts CLAUDE_EFFORT_LEVELS`, plus `default` from
  `efforts.ts effortModifierValues`.
- `--claude-advisor`: `efforts.ts CLAUDE_ADVISOR_STATES`.
- `--claude-permissive`: takes no value. `parseArgs.ts parseArgs` rejects
  `--claude-permissive=<value>`.

## Key Decisions

- `mergeSettings` preserves jq-compatible behavior: repo wins on scalar/object
  conflicts, arrays replace except for the permissions union in default mode.
- Permission union is sorted/deduped to match the legacy jq `unique` behavior.
- `syncClaudeJson` is a patcher, not a wholesale replacer; it must preserve
  Claude Code's project state and user keys.
- `claudeRemovals.ts syncRemovals, curated removed-manifest pass` is the narrow
  exception to additive-by-default. Its `settingsKeys` name retired kit-owned
  keys, such as plugin keys under `enabledPlugins`; `claudeRemovals.ts
  pruneJsonKeys, dotted-path removal` splits each manifest key on `.` and walks
  the resulting path. Never list a whole hook event, such as `hooks.PreToolUse`
  or `hooks.Stop`, because user handlers share that key.
- `claudeRemovals.ts pruneRetiredHookHandlers, retired hook-handler pass`
  removes only handlers whose `command` exactly equals an entry in
  `claudeRemovals.ts RETIRED_HOOK_COMMANDS`, keyed by event: `PreToolUse`
  always, `Stop` only when the runtime is ready. The pass drops a group with no
  handlers left, and an event key with no groups left or with a null or
  non-array value. The "Pruned stale artifacts" line reports the retired hook
  handler count. User `PreToolUse` and `Stop` handlers survive.
  (verify: `grep -n -A8 'const RETIRED_HOOK_COMMANDS' cli/src/engine-native/claudeRemovals.ts`
  and `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "removes only the retired kit hook handlers and keeps user PreToolUse and Stop handlers"`)
- The settings prune passes share one `settingsBackup`: the first write copies
  `settings.json` to `settings.json.bak` unless `commitClaudeSettings` already
  wrote that backup in the same sync, so `.bak` keeps the pre-sync bytes.
  (verify: `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "keeps the settings backup an earlier pass of the same sync wrote"`)
- The manifest's `homeFiles` are home-relative artifacts the kit installed
  outside `~/.claude`, one entry per retired kit-owned command. `claudeRemovals.ts
  syncRemovals, stale-file loop` deletes them with the other stale files,
  outside the `runtimeReady` gate, and increments the shared `filesRemoved` counter.
  (verify: `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "removes home-relative retired commands even while runtime migration is deferred"`)
- Exact permission-rule entries remove only the listed strings and preserve all
  other user rules. `claudeRemovals.ts syncRemovals, runtime-ready manifest
  expansion` gates only the legacy statusline/Notification/Stop subset; the
  other baseline stale entries remain unconditional. The one exception is the
  `advisorModel` settings key: sync prunes it only when `--claude-advisor` is
  not set.
- The authoring `SoT/.claude/settings.json` contains named sentinels. Only
  `claudeRuntime.ts materializeClaudeSettings, exact sentinel locations` may
  replace or omit them, and no sentinel-bearing document may reach disk.
  (verify: `bunx vitest run cli/test/unit/claudeRuntime.test.ts -t "rejects Stop, wrong sentinel locations, duplicate sentinels, and residue"`
  and `bunx vitest run cli/test/unit/claudeRuntime.test.ts -t "refuses to commit unresolved runtime sentinels into an existing settings file"`)

## Gotchas

- Reversing merge operand order silently makes user values win and prevents SoT
  updates from landing.
- If both permission arrays are absent, the union must still produce an array,
  not `null`.
  (verify: `bunx vitest run cli/test/unit/contract-settings.test.ts -t "creates empty permission lists when both settings files omit them"`)
- `showTurnDuration` in settings.json creates a schema warning; keep the carve-out.
- The present-count logic for removed dotted paths must evaluate paths against
  the root document, not the path string.
- Preparing settings is intentionally mutation-free. Runtime assets are written
  before `commitClaudeSettings`; legacy cleanup runs only after that commit.
  (verify: `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "writes runtime assets before settings commit and preserves fallbacks when that commit fails"`)

## References

- `.agents/skills/settings-merge-context/references/jq-pipelines.md` - compatibility spec for merge modes.
- `.agents/skills/settings-merge-context/references/claude-json-keys.md` - key placement, owner functions, and `~/.claude.json` patch rules.
