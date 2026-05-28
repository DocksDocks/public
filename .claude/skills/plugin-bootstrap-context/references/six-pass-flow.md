# Six-Pass Plugin Reconcile — Annotated Flow

The six logical passes are implemented as five `claude::_plugins_*` helpers (passes 3+4 share `_plugins_update`) dispatched by the `claude::sync_plugins` orchestrator (lib/claude.sh:292-329). Helpers call the CLI through the `claude::_cli` wrapper (lib/claude.sh:176-178) and echo `"<count> <failed>"`; the orchestrator reads each via `read -r ... < <(...)` (lib/claude.sh:312-317).

## Critical Constraints

- Pass 3 (`marketplace update`) and Pass 4 (`plugin update`) use `|| true` — failures are non-fatal. (lib/claude.sh:230, 235)
- Pass 5 removal guard uses `has($n)` — `false`-keyed plugins are KEPT. (lib/claude.sh:254)
- `claude-plugins-official` is protected from Pass 6 removal. (lib/claude.sh:277)
- Entire reconcile skipped if `claude` CLI not in PATH. (lib/claude.sh:307-310)
- Passes 5+6 gated on `REMOVE_PLUGINS` by the orchestrator. (lib/claude.sh:315)

## Pass 1: Add Missing Marketplaces (`_plugins_add_marketplaces`, lib/claude.sh:183-201)

```bash
while IFS=$'\t' read -r mp_name mp_repo; do
  [[ -z "$mp_name" ]] && continue
  if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
    continue   # already present in known_marketplaces.json (line 189)
  fi
  if claude::_cli plugin marketplace add "$mp_repo" >/dev/null 2>&1; then  # line 192
    added=$((added + 1))
  else
    warn "Failed to add marketplace: $mp_name ($mp_repo)"
    failed=$((failed + 1))
  fi
done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$repo_settings")  # line 198
```

Data source: `SoT/.claude/settings.json` `.extraKnownMarketplaces`. Format: `<name>\t<github-org/repo>`.

## Pass 2: Install Plugins (`_plugins_install`, lib/claude.sh:204-222)

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  if [[ -f "$installed_plugins" ]] && jq -e --arg n "$plugin_id" '.plugins[$n] // empty' "$installed_plugins" >/dev/null 2>&1; then
    continue   # already installed (line 210)
  fi
  claude::_cli plugin install "$plugin_id" >/dev/null 2>&1 …  # line 213
done < <(jq -r '.enabledPlugins // {} | keys[]' "$repo_settings")  # line 219
```

Reads ALL keys from `enabledPlugins` (both `true` and `false` values). Pre-check: key presence in `installed_plugins.json`.

## Pass 3: Marketplace Update (`_plugins_update`, lib/claude.sh:230)

```bash
claude::_cli plugin marketplace update >/dev/null 2>&1 || true
```

Refreshes all marketplace manifests. Non-fatal — transient network failures must not abort sync.

## Pass 4: Plugin Updates (`_plugins_update`, lib/claude.sh:232-239)

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  out=$(claude::_cli plugin update "$plugin_id" 2>&1 || true)   # line 235
  if [[ "$out" == *"Successfully updated"* ]]; then             # line 236
    updated=$((updated + 1))
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")        # line 239
```

Iterates ALL installed plugins (not just kit-managed). Each update is `|| true`; only `"Successfully updated"` output bumps the counter.

## Pass 5: Uninstall Removed Plugins (`_plugins_uninstall`, lib/claude.sh:247-266) — `--remove-plugins` only

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then  # line 254
    claude::_cli plugin uninstall -y "$plugin_id" >/dev/null 2>&1 …  # line 255
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")  # line 262
```

`has($n)` = key present in object, regardless of value. `false`-valued keys PASS `has()`.

## Pass 6: Remove Extra Marketplaces (`_plugins_remove_marketplaces`, lib/claude.sh:270-290) — `--remove-plugins` only

```bash
while IFS= read -r mp_name; do
  [[ -z "$mp_name" ]] && continue
  [[ "$mp_name" == "claude-plugins-official" ]] && continue   # protected (line 277)
  if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$repo_settings" >/dev/null 2>&1; then  # line 278
    claude::_cli plugin marketplace remove "$mp_name" >/dev/null 2>&1 …  # line 279
  fi
done < <(jq -r '. | keys[]' "$known_marketplaces")  # line 286
```

## Failure Counters

Each helper echoes `"<count> <failed>"`; the orchestrator sums the failures:

```bash
# lib/claude.sh:319
failed=$((f1 + f2 + f3 + f4 + f5))
```

Non-zero `failed` triggers a `warn` after the dispatch (lib/claude.sh:326-328). The sync is not aborted — caller continues. The helpers return counts via stdout (not namerefs) for bash 3.2 / macOS `/bin/bash` portability (comment at lib/claude.sh:180-182).

## Codex Marketplace Dedup Logic (lib/codex.sh:339-342)

```
user_plugins + repo_plugins
→ reverse (user entries now at end)
→ unique_by(.name) (last entry for a name wins = user entry wins)
→ reverse (restore order)
```

Effect: user customizations to an existing plugin entry survive merge. Repo-only new plugins are appended.
