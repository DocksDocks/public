---
name: settings-merge-context
description: "Use when modifying cli/src/engine-native/claudeSync.ts prepareClaudeSettings, commitClaudeSettings, syncClaudeJson, syncConnectorEnv, syncRemovals, syncCompactWindow, syncPermissive, syncClaudeModel; cli/src/engine-native/claudeRuntime.ts materializeClaudeSettings; or settings.ts mergeSettings/reconcileSettings. Covers runtime-sentinel materialization, atomic settings commit, permissions modes, and readiness-gated pruning."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/claudeSync.ts
      lines: "190-460"
    - path: cli/src/engine-native/settings.ts
      lines: "1-80"
    - path: SoT/.claude/settings.json
      lines: "1-260"
    - path: SoT/.claude/mcp-servers.json
      lines: "1-40"
  updated: "2026-07-10"
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

User-only top-level keys survive both merge modes. Only keys explicitly covered
by the curated removed manifest are force-pruned.

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
- `syncRemovals` is the narrow exception to additive-by-default and must remain
  backed by the curated removed manifest. Its legacy statusline/Notification/
  Stop subset is gated on the same ready-and-committed runtime state; baseline
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
