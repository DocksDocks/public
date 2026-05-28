# Key Placement: settings.json vs ~/.claude.json

## Critical Constraint

Adding `showTurnDuration` to `settings.json` triggers a schema validation warning. It belongs ONLY in `~/.claude.json`. `sync.sh` handles this automatically via `claude::sync_claude_json`. (lib/claude.sh:147-170)

## Key Location Table

| Key | File | Sync owner | Reason |
|-----|------|-----------|--------|
| All standard config (env, permissions, hooks, plugins) | `~/.claude/settings.json` | `claude::sync_settings` | Standard Claude Code schema |
| `showTurnDuration` | `~/.claude.json` | `claude::sync_claude_json` (lib/claude.sh:160) | Schema validation error if in settings.json |
| `projects[$cwd].disabledMcpServers` | `~/.claude.json` | `disable-claudeai-connectors.sh` (line 29-33) | Must survive per-project auth-sync round-trips |
| `skipAutoPermissionPrompt` | `~/.claude/settings.json` | `claude::sync_settings` | Standard schema — fine here |
| `skipDangerousModePermissionPrompt` | `~/.claude/settings.json` | `claude::sync_settings` | Ignored in project-level settings (safety) |

## How `~/.claude.json` Gets Created

```bash
# lib/claude.sh:166-168
else
  echo '{"showTurnDuration": true}' > "$claude_json"
fi
```

If `~/.claude.json` is absent, `claude::sync_claude_json` creates it with a single key. Other keys written by Claude Code itself (e.g. `projects`) accumulate in this file over time.

## Why `disabledMcpServers` Lives in `~/.claude.json`

The `settings.json` path for disabling MCP servers does not survive Claude.ai auth-sync round-trips (see upstream issues #45158, #20412). Only `~/.claude.json`'s `projects[$cwd].disabledMcpServers` array survives. The hook fires on every `SessionStart` event (startup/resume/compact/clear) to ensure the patch is applied even in resumed sessions. (SoT/.claude/hooks/disable-claudeai-connectors.sh:1-35)

## Adding a New Key to the Kit

| Target file | Approach |
|------------|----------|
| `~/.claude/settings.json` | Add to `SoT/.claude/settings.json`; it will propagate on next sync via `$user * $repo` |
| `~/.claude.json` | Add a `jq '.newKey = value'` line to `claude::sync_claude_json` (lib/claude.sh:147-170) |

## Gotchas

- `~/.claude.json` is written by Claude Code itself for project state. `sync.sh` patches it minimally — never replaces it wholesale.
- The `disable-claudeai-connectors.sh` hook reads `cwd` from stdin JSON (line 25), not from `$PWD`. If the event schema stops including `cwd`, `$CWD` is empty and the hook exits 0 silently (line 26). Connectors re-appear. Test by checking: `jq -r '.cwd' <<< '{"cwd":"/test"}'`.
- `sync.sh` does NOT write `mcpServers` to `settings.json`. Those are Claude Code's own runtime entries, not kit-managed.
