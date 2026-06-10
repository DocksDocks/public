---
name: settings-merge-context
description: Use when modifying claude::sync_settings, claude::sync_claude_json, claude::sync_connector_env, claude::sync_removals, the deploy-time modifiers claude::sync_fable / claude::sync_permissive (--fable 1M autocompact window, --permissive empty ask/deny), or the JSON merge/prune behavior for ~/.claude/settings.json and ~/.claude.json; covers the dual jq paths (default merge with permissions.{allow,deny,ask} unioned via unique vs --force reconcile with wholesale permissions replacement), the settings.json.bak backup contract, the jq empty validity guard in claude::_settings_validate, why showTurnDuration lives in ~/.claude.json not settings.json, the ENABLE_CLAUDEAI_MCP_SERVERS shell-rc export that disables claude.ai cloud connectors, and the removed-artifact manifest pruned by claude::sync_removals / claude::_prune_json_keys.
user-invocable: false
metadata:
  source_files:
    - path: lib/claude.sh
      lines: "71-368"
    - path: SoT/.claude/settings.json
      lines: "1-13"
  updated: "2026-06-10"
---

# Settings Merge

<constraint>
Always write to `.tmp` then `mv .tmp target`. Never write directly to the target settings file — a failed `jq` transform would produce a truncated/empty settings.json. The `.tmp` + `mv` pattern is atomic from the filesystem's perspective. (`claude::_settings_reconcile (backup + atomic .tmp/mv)`, `claude::_settings_merge (backup + atomic .tmp/mv)`)
</constraint>

<constraint>
Run `jq empty "$user_settings"` before any merge operation. An invalid JSON settings.json must abort with `err` and `return` — never attempt to merge corrupt input. (`claude::_settings_validate (jq empty guard)`)
</constraint>

<constraint>
`showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. Adding it to `settings.json` triggers a schema validation error. `claude::sync_claude_json` owns this key exclusively.
</constraint>

## When to Use

- Adding a new top-level key to `SoT/.claude/settings.json` that should survive additive merges
- Changing how permissions arrays are unioned (additive) vs replaced (`--force`)
- Debugging why a user's custom permission survived or was wiped after sync
- Modifying `claude::sync_claude_json` to write a new key to `~/.claude.json`
- Disabling claude.ai cloud connectors via the `ENABLE_CLAUDEAI_MCP_SERVERS` shell-rc export (`claude::sync_connector_env`)
- Pruning a newly-deprecated kit artifact via the `removed` manifest (`claude::sync_removals`)
- Adding or changing a deploy-time modifier that mutates deployed settings away from SoT (`claude::sync_fable`, `claude::sync_permissive`)

## Core Patterns

### Code Paths — `claude::sync_settings` dispatches to `_settings_*` helpers

The orchestrator validates, then routes to one extracted helper per path:

| Condition | Helper (action) | lib/claude.sh line |
|-----------|--------|--------------------|
| `~/.claude/settings.json` absent | `_settings_install` — `cp repo → user` | `claude::_settings_install` |
| `user_settings` invalid JSON | `_settings_validate` — `err + return` (no write) | `claude::_settings_validate (jq empty guard)` |
| `--force` (`FORCE=1`) | `_settings_reconcile` — `jq -s '… $user * $repo'`; permissions arrays replaced | `claude::_settings_reconcile` |
| Default (no `--force`) | `_settings_merge` — `jq -s '… ($user * $repo) | .permissions.* unioned'` | `claude::_settings_merge` |

### Default Merge jq (`claude::_settings_merge (the jq union)`)

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

### Force Reconcile jq (`claude::_settings_reconcile (the jq $user*$repo)`)

```bash
jq -s '.[0] as $repo | .[1] as $user | $user * $repo' \
  "$repo_settings" "$user_settings" > "$user_settings.tmp"
```

Key: `$user * $repo` — same operator, but no permissions array special handling. Repo permissions arrays replace user's arrays wholesale. User-only top-level keys survive (because `$user * $repo` preserves user keys that repo doesn't declare).

### Backup + Atomic Write Contract

```bash
cp "$user_settings" "$user_settings.bak"  # backup first
if ! jq … > "$user_settings.tmp"; then    # write to .tmp
  rm -f "$user_settings.tmp"              # cleanup on failure
  err "…"
  return
fi
mv "$user_settings.tmp" "$user_settings"  # atomic swap
```

Recovery: if merge fails, original is unchanged. `.bak` is the last-known-good copy.

### `~/.claude.json` Key Ownership

| Key | File | Owner | Why |
|-----|------|-------|-----|
| `showTurnDuration` | `~/.claude.json` | `claude::sync_claude_json` | Schema validation error if placed in settings.json |
| Everything else | `~/.claude/settings.json` | `claude::sync_settings` | Standard Claude Code settings schema |

claude.ai cloud connectors are **not** disabled via any file here — see the connector-env section below.

### Disabling claude.ai cloud connectors (`claude::sync_connector_env`)

Cloud connectors (Figma/Drive/Gmail) are fetched from the claude.ai account at startup; **no `~/.claude.json` / `settings.json` field disables them** — `disabledMcpServers` gates only `.mcp.json`/`claude mcp add` servers. The only working lever is `ENABLE_CLAUDEAI_MCP_SERVERS=false` as a REAL shell var (inert in the settings.json `env` block, applied too late). `claude::sync_connector_env` appends it to the active shell rc, idempotently:

```bash
# claude::sync_connector_env — verify-if-present across rc files, then append
for f in "${candidates[@]}"; do
  [[ -f "$f" ]] && grep -q 'ENABLE_CLAUDEAI_MCP_SERVERS' "$f" && return  # never duplicate/clobber
done
case "$(basename "${SHELL:-bash}")" in zsh) target=~/.zshrc;; bash) target=~/.bashrc;; *) target=~/.profile;; esac
printf '\n%s\n%s\n' "$marker" "export ENABLE_CLAUDEAI_MCP_SERVERS=false" >> "$target"
```

### Pruning stale artifacts (`claude::sync_removals`)

Default sync is additive (merge keeps user keys; `cp -R` never deletes), so kit-dropped artifacts linger. `claude::sync_removals` reads the declarative `claude::_removed_manifest` and force-prunes them on every sync — a **narrow exception to additive-by-default**, so it lists only unambiguous kit-owned artifacts (hooks/files/settingsKeys/claudeJsonKeys). `claude::_prune_json_keys` deletes dotted key paths via `delpaths`:

```bash
# claude::_prune_json_keys — count present keys (BIND ROOT first!), then delpaths
present=$(jq --argjson k "$keys" '. as $doc | [ $k[] | split(".") as $p | select($doc | getpath($p) != null) ] | length' "$file")
[[ "$present" -gt 0 ]] && jq --argjson k "$keys" 'delpaths([ $k[] | split(".") ])' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
```

### Deploy-time modifiers (`claude::sync_fable`, `claude::sync_permissive`)

Gated on `FABLE=1` / `PERMISSIVE=1` (set by `--fable` / `--permissive` in `common::parse_args`), these run in `claude::sync` immediately AFTER `claude::sync_settings` and mutate only the DEPLOYED `~/.claude/settings.json` — the opposite direction of every other pass (away from SoT, not toward it):

| Function | jq mutation | Intent |
|----------|------------|--------|
| `claude::sync_fable` | `.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "1000000"` | 1M autocompact window for Fable 5 sessions; model selection untouched |
| `claude::sync_permissive` | `.permissions.ask = [] \| .permissions.deny = []` | Sandbox/container profile — no prompts; `Bash(git *)` allow already covers push once ask is emptied |

Both follow the full settings-write contract: flag-off `return 0` first, then dry-run guard, then existence + `jq empty` guards, then atomic `.tmp`/`mv` (`claude::sync_fable (the atomic .tmp/mv)`). Reverted by the next flag-less sync: the repo-wins merge restores the SoT window value; the permissions union re-adds SoT ask/deny entries. No `.bak` is written — `claude::sync_settings` created one moments earlier in the same run.

## Key Decisions

- Default merge uses `$user * $repo` (`claude::_settings_merge ($user*$repo)`) — repo wins on scalar/object conflicts. User-added env vars, custom permissions entries, and mcpServers survive because those keys don't exist in repo settings.
- Permissions arrays use concat+unique (`claude::_settings_merge (permissions concat+unique)`) in default mode — a user-added `Bash(my-tool *)` survives sync. With `--force`, the repo's permissions arrays replace the user's wholesale (no union step).
- `claude::sync_claude_json` creates `~/.claude.json` from scratch if absent (`claude::sync_claude_json (the create-from-scratch branch)`) with just `{"showTurnDuration": true}`.
- The connector disable lives in the shell rc, not `settings.json`/`~/.claude.json` — `claude::sync_connector_env` is surgical (only claude.ai connectors, MCP source #5; plugin/project servers untouched) and non-clobbering (skips if `ENABLE_CLAUDEAI_MCP_SERVERS` is already set to any value).
- `claude::sync_removals` runs on every sync but only touches the curated `claude::_removed_manifest`; `delpaths` makes key removal idempotent (absent paths are ignored).

## Gotchas

- **Missing `// []` in permissions concat**: if either `$user.permissions.allow` or `$repo.permissions.allow` is null (key absent), the concat `+` would fail without the `// []` fallback. (`claude::_settings_merge (permissions concat+unique)`)
- **`$schema` key position after merge**: jq does not preserve key order. The `$schema` key from `settings.json:1` may appear anywhere in the merged output. This is cosmetic only; Claude Code does not require it at position 0.
- **`getpath` must bind the root in `claude::_prune_json_keys`**: after `$k[]` the jq `.` context is the key *string*, so `getpath($p)` must run against a captured `. as $doc` — otherwise the present-count is always 0 and the `present > 0` guard skips the prune (the `delpaths` itself is unaffected). (`claude::_prune_json_keys (the present-count jq)`)
- **`jq empty` guard returns silently on corrupt JSON**: `claude::_settings_validate` returns 1 (caller returns early) on corrupt settings.json (`claude::_settings_validate (jq empty guard)`). The corrupt file is left in place — the user must fix it manually. Symptom: sync reports no settings changes but the file is unchanged.
- **`claude::sync_removals` dry-run branch must `return 0` explicitly**: it ends with `[[ "$skeys" -gt 0 ]] && echo ...; [[ "$cjkeys" -gt 0 ]] && echo ...; return`. When both counts are 0 (the steady state) the trailing `[[ ]]` test leaves `$?=1`, and a bare `return` propagates it — so the whole sync exits 1 under `set -e`, aborting before `sync_plugins`/`sync_rtk` (and aborting any `set -e` caller, e.g. a web-env setup script). The fix is an explicit `return 0`. (`claude::sync_removals (the dry-run return)`)

## References

- `references/jq-pipelines.md` — annotated jq for both merge modes with inline commentary; read when debugging merge output
- `references/claude-json-keys.md` — which keys live in settings.json vs ~/.claude.json and why; read when adding a new settings key
