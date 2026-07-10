# Key Placement: settings.json vs ~/.claude.json

## Critical Constraint

`showTurnDuration` belongs only in `~/.claude.json`. Putting it in
`~/.claude/settings.json` produces a schema validation warning.

## Key Location Table

| Key | File | Sync owner | Reason |
|-----|------|------------|--------|
| Standard env, permissions, hooks, plugins | `~/.claude/settings.json` | `prepareClaudeSettings` + `commitClaudeSettings` | Standard Claude Code settings schema after runtime materialization. |
| `showTurnDuration` | `~/.claude.json` | `syncClaudeJson` | Rejected by settings schema. |
| User-scoped `mcpServers` | `~/.claude.json` | `syncClaudeJson` | Rejected by settings schema; declared in `SoT/.claude/mcp-servers.json`. |
| `skipAutoPermissionPrompt` | `~/.claude/settings.json` | prepared settings transaction | Standard schema. |
| `skipDangerousModePermissionPrompt` | `~/.claude/settings.json` | prepared settings transaction | User-scope setting. |

## Creation And Patch Behavior

When `~/.claude.json` is absent, `syncClaudeJson` creates a minimal object with
kit-owned keys. When it exists, the function patches only those keys and
preserves Claude Code project state plus user-owned keys.

`mcpServers` from `SoT/.claude/mcp-servers.json` merge additively. SoT-declared
server keys win; user-declared servers survive.

## Disabling claude.ai Cloud Connectors

Cloud connectors are account-synced. No field in `settings.json` or
`~/.claude.json` disables them. The working lever is a shell environment export:
`ENABLE_CLAUDEAI_MCP_SERVERS=false`, written idempotently by `syncConnectorEnv`.

## Adding A New Key

| Target | Approach |
|--------|----------|
| `~/.claude/settings.json` | Add to `SoT/.claude/settings.json`; the materializer and prepared settings transaction propagate it. |
| `~/.claude.json` scalar/object | Add a focused patch in `syncClaudeJson`. |
| `~/.claude.json` MCP server | Add to `SoT/.claude/mcp-servers.json`. |

## Gotchas

- `syncClaudeJson` must never replace `projects` state.
- Removed-key pruning can target `~/.claude.json`, but only through the curated
  removed manifest.
- User-scoped MCP servers belong in `~/.claude.json`, not `settings.json`.
