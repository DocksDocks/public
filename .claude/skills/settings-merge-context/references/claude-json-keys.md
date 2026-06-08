# Key Placement: settings.json vs ~/.claude.json

## Critical Constraint

Adding `showTurnDuration` to `settings.json` triggers a schema validation warning. It belongs ONLY in `~/.claude.json`. `sync.sh` handles this automatically via `claude::sync_claude_json`.

## Key Location Table

| Key | File | Sync owner | Reason |
|-----|------|-----------|--------|
| All standard config (env, permissions, hooks, plugins) | `~/.claude/settings.json` | `claude::sync_settings` | Standard Claude Code schema |
| `showTurnDuration` | `~/.claude.json` | `claude::sync_claude_json (the showTurnDuration jq)` | Schema validation error if in settings.json |
| `skipAutoPermissionPrompt` | `~/.claude/settings.json` | `claude::sync_settings` | Standard schema — fine here |
| `skipDangerousModePermissionPrompt` | `~/.claude/settings.json` | `claude::sync_settings` | Ignored in project-level settings (safety) |

## How `~/.claude.json` Gets Created

```bash
# claude::sync_claude_json (the create-from-scratch branch)
else
  echo '{"showTurnDuration": true}' > "$claude_json"
fi
```

If `~/.claude.json` is absent, `claude::sync_claude_json` creates it with a single key. Other keys written by Claude Code itself (e.g. `projects`) accumulate in this file over time.

## Disabling claude.ai cloud connectors (NOT via these files)

Cloud connectors (Figma/Drive/Gmail) are account-synced and fetched at startup; **no `~/.claude.json` or `settings.json` field disables them**. `disabledMcpServers`/`disabledMcpjsonServers` gate only `.mcp.json`/`claude mcp add` servers — they never matched cloud connectors (the kit's old `disable-claudeai-connectors.sh` hook was a no-op and has been removed). The working lever is the env var `ENABLE_CLAUDEAI_MCP_SERVERS=false` exported in the shell rc by `claude::sync_connector_env` (upstream issues #45158, #20412, #58453 still want a native settings toggle).

## Adding a New Key to the Kit

| Target file | Approach |
|------------|----------|
| `~/.claude/settings.json` | Add to `SoT/.claude/settings.json`; it will propagate on next sync via `$user * $repo` |
| `~/.claude.json` | Add a `jq '.newKey = value'` line to `claude::sync_claude_json` |

## Gotchas

- `~/.claude.json` is written by Claude Code itself for project state. `sync.sh` patches it minimally — never replaces it wholesale.
- `claude::sync_removals` can prune stale keys from `~/.claude.json` too (`claudeJsonKeys` in `claude::_removed_manifest`), but only that curated list — it never touches `projects` state or user keys. `delpaths` ignores absent paths, so re-runs are silent no-ops.
- `sync.sh` does NOT write `mcpServers` to `settings.json`. Those are Claude Code's own runtime entries, not kit-managed.
