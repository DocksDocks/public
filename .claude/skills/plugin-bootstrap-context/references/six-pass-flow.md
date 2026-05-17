# Six-Pass Plugin Reconcile — Annotated Flow

## Critical Constraints

- Pass 3 (`marketplace update`) and Pass 4 (`plugin update`) use `|| true` — failures are non-fatal. (lib/claude.sh:183, 188)
- Pass 5 removal guard uses `has($n)` — `false`-keyed plugins are KEPT. (lib/claude.sh:198)
- `claude-plugins-official` is protected from Pass 6 removal. (lib/claude.sh:212)
- Entire block skipped if `claude` CLI not in PATH. (lib/claude.sh:152-155)

## Pass 1: Add Missing Marketplaces (lib/claude.sh:157-168)

```bash
while IFS=$'\t' read -r mp_name mp_repo; do
  [[ -z "$mp_name" ]] && continue
  if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
    continue   # already present in known_marketplaces.json
  fi
  claude plugin marketplace add "$mp_repo" >/dev/null 2>&1 || warn "…"
done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$repo_settings")
```

Data source: `SoT/.claude/settings.json` `.extraKnownMarketplaces`. Format: `<name>\t<github-org/repo>`.

## Pass 2: Install Plugins (lib/claude.sh:170-182)

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  if [[ -f "$installed_plugins" ]] && jq -e --arg n "$plugin_id" '.plugins[$n] // empty' "$installed_plugins" >/dev/null 2>&1; then
    continue   # already installed
  fi
  claude plugin install "$plugin_id" >/dev/null 2>&1 || warn "…"
done < <(jq -r '.enabledPlugins // {} | keys[]' "$repo_settings")
```

Reads ALL keys from `enabledPlugins` (both `true` and `false` values). Pre-check: key presence in `installed_plugins.json`.

## Pass 3: Marketplace Update (lib/claude.sh:183)

```bash
claude plugin marketplace update >/dev/null 2>&1 || true
```

Refreshes all marketplace manifests. Non-fatal — transient network failures must not abort sync.

## Pass 4: Plugin Updates (lib/claude.sh:185-193)

```bash
while IFS= read -r plugin_id; do
  out=$(claude plugin update "$plugin_id" 2>&1 || true)
  if echo "$out" | grep -q "Successfully updated"; then
    updated_pl=$((updated_pl + 1))
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")
```

Iterates ALL installed plugins (not just kit-managed). Each update is `|| true`.

## Pass 5: Uninstall Removed Plugins (lib/claude.sh:195-207) — `--remove-plugins` only

```bash
while IFS= read -r plugin_id; do
  if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
    claude plugin uninstall -y "$plugin_id" >/dev/null 2>&1 || warn "…"
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")
```

`has($n)` = key present in object, regardless of value. `false`-valued keys PASS `has()`.

## Pass 6: Remove Extra Marketplaces (lib/claude.sh:209-222) — `--remove-plugins` only

```bash
while IFS= read -r mp_name; do
  [[ "$mp_name" == "claude-plugins-official" ]] && continue   # protected
  if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$repo_settings" >/dev/null 2>&1; then
    claude plugin marketplace remove "$mp_name" >/dev/null 2>&1 || warn "…"
  fi
done < <(jq -r '. | keys[]' "$known_marketplaces")
```

## Failure Counters

```bash
# lib/claude.sh:136-141
local added_mp=0 added_pl=0 updated_pl=0 removed_pl=0 removed_mp=0 failed=0
```

Non-zero `failed` triggers a `warn` after the loop (lib/claude.sh:229-231). The sync is not aborted — caller continues.

## Codex Marketplace Dedup Logic (lib/codex.sh:338-343)

```
user_plugins + repo_plugins
→ reverse (user entries now at end)
→ unique_by(.name) (last entry for a name wins = user entry wins)
→ reverse (restore order)
```

Effect: user customizations to an existing plugin entry survive merge. Repo-only new plugins are appended.
