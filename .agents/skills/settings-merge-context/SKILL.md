---
name: settings-merge-context
description: "Use when modifying cli/src/engine-native/claudeSync.ts prepareClaudeSettings, commitClaudeSettings, syncClaudeJson, syncConnectorEnv, syncRemovals, syncCompactWindow, syncPermissive, syncClaudeModel; cli/src/engine-native/claudeRuntime.ts materializeClaudeSettings; settings.ts mergeSettings/reconcileSettings; or claudeRetired.ts RETIRED_PERMISSION_RULES. Covers runtime-sentinel materialization, atomic settings commit, permissions modes, retired-rule pruning, and readiness-gated pruning."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-975"
    - path: cli/src/engine-native/settings.ts
      lines: "1-42"
    - path: cli/src/engine-native/claudeRetired.ts
      lines: "1-165"
    - path: SoT/.claude/settings.json
      lines: "1-372"
    - path: SoT/.claude/mcp-servers.json
      lines: "1-40"
  updated: "2026-08-28"
---

# Settings Merge

EngineNative owns Claude settings deployment in `claudeSync.ts`, with pure merge
helpers in `settings.ts`. The old jq programs remain useful as the behavioral
spec and are inlined in tests; production logic is TypeScript.

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

User-only top-level keys survive both merge modes. `claudeSync.ts syncRemovals,
curated removed-manifest pass` force-prunes only manifest-listed settings keys,
exact permission-array members, and stale files.

## Retired Rules

`claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` names
the rules the kit once shipped and no longer does: the broad shell allow rules,
`WebFetch`, and the malformed single-backslash deny spellings. `claudeSync.ts
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

Sync never reads, writes, or prunes `~/.claude/settings.local.json`. Claude Code
merges that file on top of the kit-managed settings file. Put a deliberately
restored retired rule there so it survives every sync. The same exact rule does
not survive when re-added to `~/.claude/settings.json`.

<constraint>
Retiring a permission rule takes two edits: delete it from
`SoT/.claude/settings.json` and add the exact old string to
`claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory`.
Match by exact string only. A different user-authored rule in the kit-managed
file survives the prune; an exact retired-rule override belongs in
`~/.claude/settings.local.json`.
</constraint>

## File Ownership

| Key | File | Owner |
|-----|------|-------|
| Standard env, hooks, permissions, plugins | `~/.claude/settings.json` | `prepareClaudeSettings` then `commitClaudeSettings` |
| `showTurnDuration` | `~/.claude.json` | `syncClaudeJson` |
| User-scoped `mcpServers` | `~/.claude.json` | `syncClaudeJson` merging `SoT/.claude/mcp-servers.json` |
| Claude.ai cloud connector disable | Shell rc export | `syncConnectorEnv` |

`syncConnectorEnv` writes `ENABLE_CLAUDEAI_MCP_SERVERS=false` to a shell rc file
when absent. No JSON setting disables those account-level cloud connectors.

## Deploy-Time Modifiers

`syncCompactWindow`, `syncPermissive`, and `syncClaudeModel` run after the
prepared settings commit and mutate only deployed settings. A later flag-less sync restores
SoT values, except user-only keys that the SoT does not declare.

| Flag | Function | Mutation |
|------|----------|----------|
| `--claude-compact-window=<n|Nk>` | `syncCompactWindow` | Sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`. |
| `--claude-permissive` | `syncPermissive` | Clears `permissions.ask` and `permissions.deny`. |
| `--claude-model=<m>` | `syncClaudeModel` | Sets `.model`, or deletes it for `default`. |

## Key Decisions

- `mergeSettings` preserves jq-compatible behavior: repo wins on scalar/object
  conflicts, arrays replace except for the permissions union in default mode.
- Permission union is sorted/deduped to match the legacy jq `unique` behavior.
- `syncClaudeJson` is a patcher, not a wholesale replacer; it must preserve
  Claude Code's project state and user keys.
- `claudeSync.ts syncRemovals, curated removed-manifest pass` is the narrow
  exception to additive-by-default. Its `settingsKeys` name retired plugin keys
  under `enabledPlugins`; `claudeSync.ts pruneJsonKeys, dotted-path
  removal` splits each manifest key on `.` and walks the resulting path.
- The manifest's `homeFiles` are home-relative artifacts the kit installed
  outside `~/.claude`, one entry per retired kit-owned command. `claudeSync.ts
  syncRemovals, unconditional home-file loop` deletes them outside the
  `runtimeReady` branch and increments the shared `filesRemoved` counter.
- Exact permission-rule entries remove only the listed strings and preserve all
  other user rules. `claudeSync.ts syncRemovals, runtime-ready manifest
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
