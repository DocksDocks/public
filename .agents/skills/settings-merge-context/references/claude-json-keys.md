# Key Placement: settings.json vs ~/.claude.json

This file owns the per-key placement table and the `~/.claude.json` patch
rules. The placement constraint itself lives in
`.agents/skills/settings-merge-context/SKILL.md` constraints.

## Key Location Table

| Key | File | Sync owner | Reason |
|-----|------|------------|--------|
| Standard env, permissions, hooks, plugins | `~/.claude/settings.json` | `prepareClaudeSettings` + `commitClaudeSettings` | Standard Claude Code settings schema after runtime materialization. |
| `showTurnDuration` | `~/.claude.json` | `syncClaudeJson` | Rejected by settings schema. |
| User-scoped `mcpServers` | `~/.claude.json` | `syncClaudeJson` | Rejected by settings schema; declared in `SoT/.claude/mcp-servers.json`. |
| `skipDangerousModePermissionPrompt` | `~/.claude/settings.json` | prepared settings transaction | User-scope setting. |

## Creation And Patch Behavior

When `~/.claude.json` is absent, `syncClaudeJson` creates a minimal object with
kit-owned keys, written with mode `0o600` because the file holds MCP server
credentials. A rewrite of an existing file keeps that mode.
(verify: `bunx vitest run cli/test/unit/claudeSync.test.ts -t "creates a missing ~/.claude.json with owner-only mode"`
and `bunx vitest run cli/test/unit/claudeSync.test.ts -t "keeps owner-only modes on rewritten Claude JSON files"`; POSIX only)

A non-object `~/.claude.json` is reported and left unedited.
(verify: `bunx vitest run cli/test/unit/claudeSettingsTruth.test.ts -t "rejects a non-object Claude state document without replacing it"`)
Unparseable JSON takes the same skip branch. Unprobed: no unit test feeds
invalid JSON (verify: `grep -n "not valid JSON" cli/src/engine-native/claudeSync.ts`)

When the file exists, the function patches only the kit keys. It preserves
Claude Code project state plus user-owned keys. Unprobed: no unit test checks
that a patch keeps `projects` and user keys. Read the `applyFilter` closure in
`claudeSync.ts syncClaudeJson` (verify: `grep -n -A9 "const applyFilter" cli/src/engine-native/claudeSync.ts`)

`mcpServers` from `SoT/.claude/mcp-servers.json` merge additively through
`jq.ts deepMerge`. SoT-declared server keys win; user-declared servers survive.

## Cloud Connectors

Cloud connectors are not a JSON key. `syncConnectorEnv` owns the
environment-variable lever; see `.agents/skills/settings-merge-context/SKILL.md`
§ Key Placement And Connector Env.

## Adding A New Key

| Target | Approach |
|--------|----------|
| `~/.claude/settings.json` | Add to `SoT/.claude/settings.json`; the materializer and prepared settings transaction propagate it. |
| `~/.claude.json` scalar/object | Add a focused patch in `syncClaudeJson`. |
| `~/.claude.json` MCP server | Add to `SoT/.claude/mcp-servers.json`. |

## Gotchas

- `syncClaudeJson` must never replace `projects` state.
- Removed-key pruning can target `~/.claude.json`, but only through the curated
  removed manifest (`claudeRemovals.ts REMOVED_MANIFEST.claudeJsonKeys`).
