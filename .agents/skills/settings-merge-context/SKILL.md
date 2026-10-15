---
name: settings-merge-context
description: "Use when modifying cli/src/engine-native/claudeSync.ts syncClaudeJson, syncConnectorEnv; claudeSettings.ts prepareClaudeSettings, commitClaudeSettings, syncCompactWindow, syncPermissive; claudeRemovals.ts syncRemovals; claudeSettingsModifiers.ts syncClaudeModel; cli/src/engine-native/claudeRuntime.ts materializeClaudeSettings; settings.ts mergeSettings/reconcileSettings; or claudeRetired.ts RETIRED_PERMISSION_RULES. Covers runtime-sentinel materialization, atomic settings commit, permissions modes, retired-rule pruning, retired hook-handler pruning, and readiness-gated pruning."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-310"
    - path: cli/src/engine-native/claudeSettings.ts
      lines: "1-174"
    - path: cli/src/engine-native/claudeRemovals.ts
      lines: "1-195"
    - path: cli/src/engine-native/claudeRuntime.ts
      lines: "1-157"
    - path: cli/src/engine-native/claudeSettingsModifiers.ts
      lines: "1-115"
    - path: cli/src/engine-native/settings.ts
      lines: "1-42"
    - path: cli/src/engine-native/claudeRetired.ts
      lines: "1-165"
    - path: SoT/.claude/settings.json
      lines: "1-372"
    - path: SoT/.claude/mcp-servers.json
      lines: "1-3"
  updated: "2026-10-14"
---

# Settings Merge

EngineNative owns Claude settings deployment. `claudeSync.ts claudeSync`
orchestrates the passes. `claudeSettings.ts` owns the settings transaction and
the deploy-time modifiers. `claudeRemovals.ts` owns retired-artifact pruning.
Pure merge helpers live in `settings.ts`. The old jq programs remain useful as
the behavioral spec and are inlined in tests; production logic is TypeScript.

<constraint>
Always write through a temporary file and replace the target only after the new
JSON has been serialized successfully. Preserve the `.bak` contract before
mutating an existing deployed settings file.
</constraint>

<constraint>
Validate existing JSON before merging. A corrupt deployed settings file must be
left untouched and reported; never merge into a parse failure.
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
| First install | `prepareClaudeSettings` absent-target path | Serializes the materialized SoT settings; `commitClaudeSettings` atomically creates the deployed file. |
| Default | `mergeSettings(repo, user)` | Deep merge with repo values winning, but `permissions.allow`, `deny`, and `ask` are unioned and deduped. |
| `--reconcile` | `reconcileSettings(repo, user)` | Deep merge with repo values winning; permissions arrays are replaced by SoT values. |

User-only top-level keys survive both merge modes. `claudeRemovals.ts syncRemovals,
curated removed-manifest pass` force-prunes only manifest-listed settings keys,
exact permission-array members, exact retired kit hook handlers, and stale files.

## Retired Rules

`claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` names
the rules the kit once shipped and no longer does: the broad shell allow rules,
`WebFetch`, and the malformed single-backslash deny spellings. `claudeRemovals.ts
syncRemovals, retired-permission pass` force-prunes those exact strings from the
kit-managed `~/.claude/settings.json` on every sync. Without that pass,
`settings.ts mergeSettings, permission-array union` would retain a rule after
the SoT dropped it.

<constraint>
The kit deploys its `PowerShell(...)` deny and ask rules on every host. Claude
Code leaves the PowerShell tool opt-in off Windows rather than unavailable, so a
host that enables it must already carry the guards. Never gate permission deny
rules by platform.
</constraint>

`SoT/.claude/settings.json` is the only place a shipped rule is declared. The
retired inventory is the only place a withdrawn shipped rule is named.

To restore an exact retired rule for one checkout, put it in that checkout's
`.claude/settings.local.json`. Claude Code resolves that file against the
working directory and merges it over user settings. Sync never reads or writes
the checkout-local file. Claude Code has no user-scope local settings file. For
a machine-wide restoration, add the rule to `SoT/.claude/settings.json`. At the
same time, remove the exact string from `claudeRetired.ts
RETIRED_PERMISSION_RULES, exact retired-rule inventory`.

<constraint>
Retiring a permission rule takes two edits. Delete it from
`SoT/.claude/settings.json`. Add the exact old string to `claudeRetired.ts
RETIRED_PERMISSION_RULES, exact retired-rule inventory`. Match by exact string
only. A different user-authored rule in the kit-managed file survives the
prune. An exact checkout-only override belongs in that checkout's
`.claude/settings.local.json`.
</constraint>

## File Ownership

| Key | File | Owner |
|-----|------|-------|
| Standard env, hooks, permissions, plugins | `~/.claude/settings.json` | `prepareClaudeSettings` then `commitClaudeSettings` |
| `showTurnDuration` | `~/.claude.json` | `syncClaudeJson` |
| User-scoped `mcpServers` | `~/.claude.json` | `syncClaudeJson` merging `SoT/.claude/mcp-servers.json` |
| Claude.ai cloud connector disable | POSIX: shell profile export (target chosen from `$SHELL`); Windows: `HKCU\Environment` user variable | `syncConnectorEnv` via `hostOs().environmentSetting` |

`syncConnectorEnv` persists `ENABLE_CLAUDEAI_MCP_SERVERS=false` when absent. On
POSIX, it appends an export to a shell profile. It skips the write if any
candidate profile already names the variable. On Windows, it probes
`reg query HKCU\Environment` and sets the variable with `setx`. Only new shells
or terminals see it. No JSON setting disables those account-level cloud
connectors.

## Deploy-Time Modifiers

`syncCompactWindow`, `syncPermissive`, and `syncClaudeModel` run after the
prepared settings commit and mutate only deployed settings. A later flag-less sync restores
SoT values, except user-only keys that the SoT does not declare.

| Flag | Function | Mutation |
|------|----------|----------|
| `--claude-compact-window=<n|Nk>` | `syncCompactWindow` | Sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`. |
| `--claude-permissive` | `syncPermissive` | Clears `permissions.ask` and `permissions.deny`. |
| `--claude-model=<m>` | `claudeSettingsModifiers.ts syncClaudeModel` | Sets `.model`, or deletes it for `default`. |

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
  removes only handlers whose `command` exactly equals a command the kit once
  shipped. These are the legacy RTK rewrite handler under `hooks.PreToolUse`
  and the legacy `fetch-usage.sh` handler under `hooks.Stop`. The Stop removal
  runs only when the runtime is ready. The pass drops a group with no handlers
  left, and an event key with no groups left or with a null or non-array value.
  It copies `settings.json` to `settings.json.bak` before it writes. The
  "Pruned stale artifacts" line reports the retired hook handler count. User
  `PreToolUse` and `Stop` handlers survive.
- The manifest's `homeFiles` are home-relative artifacts the kit installed
  outside `~/.claude`, one entry per retired kit-owned command. `claudeRemovals.ts
  syncRemovals, unconditional home-file loop` deletes them outside the
  `runtimeReady` branch and increments the shared `filesRemoved` counter.
- Exact permission-rule entries remove only the listed strings and preserve all
  other user rules. `claudeRemovals.ts syncRemovals, runtime-ready manifest
  expansion` gates only the legacy statusline/Notification/Stop subset; baseline
  stale entries remain unconditional.
- The authoring `SoT/.claude/settings.json` contains named sentinels. Only
  `claudeRuntime.ts materializeClaudeSettings, exact sentinel locations` may
  replace or omit them, and no sentinel-bearing document may reach disk.

## Gotchas

- Reversing merge operand order silently makes user values win and prevents SoT
  updates from landing.
- If both permission arrays are absent, the union must still produce an array,
  not `null`.
- `showTurnDuration` in settings.json creates a schema warning; keep the carve-out.
- The present-count logic for removed dotted paths must evaluate paths against
  the root document, not the path string.
- Preparing settings is intentionally mutation-free. Runtime assets are written
  before `commitClaudeSettings`; legacy cleanup runs only after that commit.

## References

- `references/jq-pipelines.md` - compatibility spec for merge modes.
- `references/claude-json-keys.md` - file ownership table and key-placement rules.
