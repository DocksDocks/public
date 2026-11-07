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
credentials. When it exists, the function patches only those keys and
preserves Claude Code project state plus user-owned keys. An invalid or
non-object `~/.claude.json` is reported and left unedited.
(verify: `bunx vitest run cli/test/unit/claudeSync.test.ts -t "creates a missing ~/.claude.json with owner-only mode"`; POSIX only)

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
