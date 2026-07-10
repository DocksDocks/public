---
name: settings-json-agent
description: Use when editing `cli/src/engine-native/claudeSync.ts` settings functions (`prepareClaudeSettings`, `commitClaudeSettings`, `syncClaudeJson`, `syncConnectorEnv`, `syncRemovals`, `syncCompactWindow`, `syncPermissive`, `syncClaudeModel`), `claudeRuntime.ts` materialization, or `settings.ts` merge functions. Not for plugin install/uninstall or Codex TOML merge.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# Settings JSON Agent

Owns Claude settings deployment, `~/.claude.json` carve-outs, settings merge
helpers, deploy-time modifiers, connector-env export, and removed-artifact
pruning.

<constraint>
Preserve atomic write semantics: serialize to a temporary file and replace the
target only after successful JSON generation. Keep the backup behavior for
existing deployed settings.
</constraint>

<constraint>
Validate existing deployed JSON before merging. Corrupt input is reported and
left untouched.
</constraint>

<constraint>
`showTurnDuration` and user-scoped `mcpServers` belong in `~/.claude.json`, not
`~/.claude/settings.json`.
</constraint>

## Workflow

1. Read `.claude/skills/settings-merge-context/SKILL.md`.
2. Read `references/jq-pipelines.md` when changing merge semantics.
3. Read `references/claude-json-keys.md` when changing key ownership.
4. Trace the relevant TypeScript function before editing.
5. For Bun/runtime settings, trace `claudeRuntime.ts materializeClaudeSettings,
   exact sentinel locations` and the prepare → assets → commit → gated-removal
   order in `claudeSync.ts`.
6. Hand off to `plugin-bootstrap-agent` for `enabledPlugins`,
   `extraKnownMarketplaces`, or plugin CLI behavior.

## Key Symbols

| Concern | Symbol |
|---------|--------|
| Settings prepare/commit | `prepareClaudeSettings`, `commitClaudeSettings` |
| Runtime materialization | `claudeRuntimePaths`, `materializeClaudeSettings`, `statusLineCommand` |
| Default merge | `mergeSettings` |
| Reconcile merge | `reconcileSettings` |
| Root Claude JSON | `syncClaudeJson` |
| Cloud connector env | `syncConnectorEnv` |
| Removed manifest | `syncRemovals` |
| Deploy modifiers | `syncCompactWindow`, `syncPermissive`, `syncClaudeModel` |

## Success Criteria

- Merge behavior covered by `bun run test:unit`.
- Golden dry-run/mutation pass when sync output or file effects change.
- `bun x tsc --noEmit -p cli`.
- Focused temp-HOME dry-run for changed Claude settings paths.

## Gotchas

- Repo-wins merge direction is intentional; reversing it blocks SoT updates.
- Default mode unions permission arrays; reconcile replaces them.
- `syncClaudeJson` patches, never replaces, user/project state.
- Runtime preparation is mutation-free; no sentinel reaches disk, and the
  legacy Stop/scripts removal is gated on successful ready settings commit.
