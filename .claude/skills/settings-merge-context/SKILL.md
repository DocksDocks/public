---
name: settings-merge-context
description: Use when modifying claude::sync_settings, claude::sync_claude_json, or the JSON-merge behavior for ~/.claude/settings.json and ~/.claude.json; covers the dual jq paths (default merge with permissions.{allow,deny,ask} unioned via unique vs --force reconcile with wholesale permissions replacement), the settings.json.bak backup contract, the jq empty validity guard at lib/claude.sh:76, why showTurnDuration lives in ~/.claude.json not settings.json, and the per-project projects[$cwd].disabledMcpServers patching by disable-claudeai-connectors.sh.
user-invocable: false
metadata:
  source_files:
    - path: lib/claude.sh
      lines: "61-130"
    - path: SoT/.claude/settings.json
      lines: "1-10"
    - path: SoT/.claude/hooks/disable-claudeai-connectors.sh
      lines: "1-35"
  updated: "2026-05-17"
---

# Settings Merge

<constraint>
Always write to `.tmp` then `mv .tmp target`. Never write directly to the target settings file — a failed `jq` transform would produce a truncated/empty settings.json. The `.tmp` + `mv` pattern is atomic from the filesystem's perspective. (lib/claude.sh:82-87, 97-102)
</constraint>

<constraint>
Run `jq empty "$user_settings"` before any merge operation. An invalid JSON settings.json must abort with `err` and `return` — never attempt to merge corrupt input. (lib/claude.sh:76-78)
</constraint>

<constraint>
`showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. Adding it to `settings.json` triggers a schema validation error. `claude::sync_claude_json` owns this key exclusively. (lib/claude.sh:107-130)
</constraint>

## When to Use

- Adding a new top-level key to `SoT/.claude/settings.json` that should survive additive merges
- Changing how permissions arrays are unioned (additive) vs replaced (`--force`)
- Debugging why a user's custom permission survived or was wiped after sync
- Modifying `claude::sync_claude_json` to write a new key to `~/.claude.json`
- Understanding why `disable-claudeai-connectors.sh` patches `~/.claude.json` instead of `settings.json`

## Core Patterns

### Three Code Paths in `claude::sync_settings`

| Condition | Action | lib/claude.sh line |
|-----------|--------|--------------------|
| `~/.claude/settings.json` absent | `cp repo → user` | 73-75 |
| `user_settings` invalid JSON | `err + return` (no write) | 76-78 |
| `--force` (`FORCE=1`) | `jq -s '… $user * $repo'` — repo wins; permissions arrays replaced | 80-88 |
| Default (no `--force`) | `jq -s '… ($user * $repo) | .permissions.* unioned'` | 90-103 |

### Default Merge jq (lib/claude.sh:91-97)

```bash
jq -s '
  .[0] as $repo | .[1] as $user |
  ($user * $repo) |
  .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
  .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
  .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
' "$repo_settings" "$user_settings" > "$user_settings.tmp"
```

Key: `$user * $repo` — repo wins on scalar/object conflicts. Then permissions arrays are overwritten with the concat+unique union. User-added permissions survive.

### Force Reconcile jq (lib/claude.sh:81-82)

```bash
jq -s '.[0] as $repo | .[1] as $user | $user * $repo' \
  "$repo_settings" "$user_settings" > "$user_settings.tmp"
```

Key: `$user * $repo` — same operator, but no permissions array special handling. Repo permissions arrays replace user's arrays wholesale. User-only top-level keys survive (because `$user * $repo` preserves user keys that repo doesn't declare).

### Backup + Atomic Write Contract

```bash
cp "$user_settings" "$user_settings.bak"  # backup first (line 80/90)
if ! jq … > "$user_settings.tmp"; then    # write to .tmp
  rm -f "$user_settings.tmp"              # cleanup on failure (line 83/98)
  err "…"
  return
fi
mv "$user_settings.tmp" "$user_settings"  # atomic swap (line 87/102)
```

Recovery: if merge fails, original is unchanged. `.bak` is the last-known-good copy.

### `~/.claude.json` Key Ownership

| Key | File | Owner | Why |
|-----|------|-------|-----|
| `showTurnDuration` | `~/.claude.json` | `claude::sync_claude_json` (lib/claude.sh:107) | Schema validation error if placed in settings.json |
| `disabledMcpServers` (per project) | `~/.claude.json` | `disable-claudeai-connectors.sh` (line 29-33) | Survives auth-sync round-trips; `settings.json` path does not |
| Everything else | `~/.claude/settings.json` | `claude::sync_settings` | Standard Claude Code settings schema |

### SessionStart Hook: `disable-claudeai-connectors.sh`

```bash
# SoT/.claude/hooks/disable-claudeai-connectors.sh:25-33
CWD=$(jq -r '.cwd // empty' < /dev/stdin 2>/dev/null || true)
[ -z "$CWD" ] || [ "$CWD" = "null" ] && exit 0

jq --arg cwd "$CWD" --argjson connectors "$CONNECTORS" '
  .projects[$cwd].disabledMcpServers = (
    (.projects[$cwd].disabledMcpServers // []) + $connectors | unique
  )
' "$CLAUDE_JSON" > "$TMP" && mv "$TMP" "$CLAUDE_JSON"
```

Fires on every `SessionStart` event (not just `startup`) to catch `resume`/`compact`/`clear` sessions.

## Key Decisions

- Default merge uses `$user * $repo` (lib/claude.sh:93) — repo wins on scalar/object conflicts. User-added env vars, custom permissions entries, and mcpServers survive because those keys don't exist in repo settings.
- Permissions arrays use concat+unique (lib/claude.sh:94-96) in default mode — a user-added `Bash(my-tool *)` survives sync. With `--force`, the repo's permissions arrays replace the user's wholesale (no union step).
- `claude::sync_claude_json` creates `~/.claude.json` from scratch if absent (lib/claude.sh:127) with just `{"showTurnDuration": true}`.
- `disable-claudeai-connectors.sh` reads `cwd` from stdin JSON (line 25), not `$PWD` — because hook execution context may differ from shell `$PWD`.

## Gotchas

- **Missing `// []` in permissions concat**: if either `$user.permissions.allow` or `$repo.permissions.allow` is null (key absent), the concat `+` would fail without the `// []` fallback. (lib/claude.sh:94)
- **`$schema` key position after merge**: jq does not preserve key order. The `$schema` key from `settings.json:1` may appear anywhere in the merged output. This is cosmetic only; Claude Code does not require it at position 0.
- **Hook reads `cwd` from stdin, not `$PWD`**: if the Claude Code event payload ever stops including `cwd`, the hook exits 0 silently and connectors re-appear. The `[ -z "$CWD" ] … && exit 0` guard at line 26 is the silent-failure path.
- **`jq empty` guard skips silently on corrupt JSON**: the function returns (not exits) on corrupt settings.json (lib/claude.sh:77-78). The corrupt file is left in place — the user must fix it manually. Symptom: sync reports no settings changes but the file is unchanged.

## References

- `references/jq-pipelines.md` — annotated jq for both merge modes with inline commentary; read when debugging merge output
- `references/claude-json-keys.md` — which keys live in settings.json vs ~/.claude.json and why; read when adding a new settings key
