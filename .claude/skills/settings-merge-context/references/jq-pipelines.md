# jq Pipelines — settings.json Merge Modes

## Critical Constraints

- Write to `.tmp` first, then `mv .tmp target`. Never write directly to the target. (`claude::_settings_merge (backup + atomic .tmp/mv)`)
- Run `jq empty` before merge to guard against corrupt input. (`claude::_settings_validate (jq empty guard)`)
- `$user * $repo` means repo wins on conflicts (jq object merge semantics: right-hand side wins).

## Default Additive Merge (`claude::_settings_merge (the jq union)`)

```bash
jq -s '
  .[0] as $repo | .[1] as $user |
  ($user * $repo) |
  .permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
  .permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
  .permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
' "$repo_settings" "$user_settings" > "$user_settings.tmp"
```

Step-by-step:
1. `.[0] as $repo` — SoT settings.json (first arg)
2. `.[1] as $user` — deployed ~/.claude/settings.json (second arg)
3. `$user * $repo` — deep-merge; repo wins on conflicting scalar/object keys; user-only keys preserved
4. `.permissions.allow = (… | unique)` — override the merged `.permissions.allow` with the union of both arrays, deduped

Result: user-added `Bash(custom-tool *)` entries survive; SoT entries win on scalar conflicts; no permissions are lost.

## Force Reconcile (`claude::_settings_reconcile (the jq $user*$repo)`)

```bash
jq -s '.[0] as $repo | .[1] as $user | $user * $repo' \
  "$repo_settings" "$user_settings" > "$user_settings.tmp"
```

Step-by-step:
1. Same `$repo` / `$user` bindings
2. `$user * $repo` — repo wins; no permissions special case
3. `.permissions.allow` in output = SoT's `.permissions.allow` (repo wins, user's array discarded)

Result: user-added custom permissions are wiped. User-only top-level keys (e.g. `mcpServers`, custom `env` vars) survive because those keys are absent from repo; absent-from-right-side keys are preserved by jq's `*` operator.

## Why `$user * $repo` Not `$repo * $user`

| Expression | Who wins on conflict |
|-----------|---------------------|
| `$user * $repo` | repo (right-hand) |
| `$repo * $user` | user (right-hand) |

The kit always writes `$user * $repo` so SoT changes propagate forward. If the kit wrote `$repo * $user`, SoT key changes would be silently ignored on non-force syncs.

## `~/.claude.json` jq (`claude::sync_claude_json (the showTurnDuration jq)`)

```bash
jq '.showTurnDuration = true' "$claude_json" > "$claude_json.tmp"
mv "$claude_json.tmp" "$claude_json"
```

Single-key set, no merge. Does not touch other keys in `~/.claude.json`.

## Removed-key prune jq (`claude::_prune_json_keys (the delpaths)`)

```bash
# count keys actually present — BIND ROOT (. as $doc) before getpath
present=$(jq --argjson k "$keys" '. as $doc | [ $k[] | split(".") as $p | select($doc | getpath($p) != null) ] | length' "$file")
# delete each dotted path; delpaths ignores absent paths (idempotent)
jq --argjson k "$keys" 'delpaths([ $k[] | split(".") ])' "$file" > "$file.tmp" && mv "$file.tmp" "$file"
```

`split(".")` turns `"env.FOO"` into `["env","FOO"]` for `delpaths`/`getpath`. The present-count must capture `. as $doc` first: after `$k[]`, the `.` context is the key string, not the document — see the Gotcha in SKILL.md.

## Good / Bad Patterns

| Good | Bad | Why |
|------|-----|-----|
| `jq … > file.tmp && mv file.tmp file` | `jq … > file` | Direct write produces empty file on jq error |
| `$user * $repo` (repo wins) | `$repo * $user` (user wins) | SoT changes never propagate with user-wins |
| `($arr // []) + $other \| unique` | `$arr + $other` | Null dereference if key absent from one side |

## Gotchas

- jq `-s` slurps both files into an array — `.[0]` is the first filename arg, `.[1]` is the second. Order matters: `jq -s '…' "$repo" "$user"` not `"$user" "$repo"`.
- `unique` sorts the array as a side-effect. Permission entry order in the merged output is alphabetical, not insertion-order. This is fine for Claude Code but may surprise humans reading the file.
