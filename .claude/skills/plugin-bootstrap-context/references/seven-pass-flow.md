# Seven-Pass Plugin Reconcile — Annotated Flow

The seven logical passes are implemented as six `claude::_plugins_*` helpers (passes 3+4 share `_plugins_update`) dispatched by the `claude::sync_plugins` orchestrator. Passes 1–6 call the CLI through the `claude::_cli` wrapper and echo `"<count> <failed>"`; the orchestrator reads each via `read -r ... < <(...)` (`claude::sync_plugins` — dispatch block). Pass 7 instead rewrites `~/.claude/settings.json` in place and returns no count.

## Critical Constraints

- Pass 3 (`marketplace update`) and Pass 4 (`plugin update`) use `|| true` — failures are non-fatal. (`claude::_plugins_update` — marketplace-update `|| true`, plugin-update `|| true`)
- Pass 5 removal guard uses `has($n)` — `false`-keyed plugins are KEPT. (`claude::_plugins_uninstall` — the `has($n)` guard)
- `claude-plugins-official` is protected from Pass 6 removal. (`claude::_plugins_remove_marketplaces` — claude-plugins-official guard)
- Entire reconcile skipped if `claude` CLI not in PATH. (`claude::sync_plugins` — CLI presence check)
- Passes 5+6 gated on `REMOVE_PLUGINS` by the orchestrator. (`claude::sync_plugins` — REMOVE_PLUGINS gate)
- Pass 7 runs UNCONDITIONALLY after passes 5+6 — it is the only thing that keeps `false`-keyed plugins disabled after pass 2's install-side enable. (`claude::_plugins_reassert_enabled_state`)

## Pass 1: Add Missing Marketplaces (`claude::_plugins_add_marketplaces`)

```bash
while IFS=$'\t' read -r mp_name mp_repo; do
  [[ -z "$mp_name" ]] && continue
  if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
    continue   # already present in known_marketplaces.json (claude::_plugins_add_marketplaces — key-presence pre-check)
  fi
  if claude::_cli plugin marketplace add "$mp_repo" >/dev/null 2>&1; then  # marketplace add
    added=$((added + 1))
  else
    warn "Failed to add marketplace: $mp_name ($mp_repo)"
    failed=$((failed + 1))
  fi
done < <(jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"' "$repo_settings")  # extraKnownMarketplaces read
```

Data source: `SoT/.claude/settings.json` `.extraKnownMarketplaces`. Format: `<name>\t<github-org/repo>`.

## Pass 2: Install Plugins (`claude::_plugins_install`)

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  if claude::_plugin_user_scope_installed "$installed_plugins" "$plugin_id"; then
    continue   # already installed at user scope (claude::_plugins_install — installed pre-check)
  fi
  claude::_cli plugin install "$plugin_id" >/dev/null 2>&1 …  # plugin install
done < <(jq -r '.enabledPlugins // {} | keys[]' "$repo_settings")  # claude::_plugins_install — keys read
```

The pre-check is the scope-aware predicate (`claude::_plugin_user_scope_installed`):

```bash
jq -e --arg n "$plugin_id" \
  '.plugins[$n] // empty | (if type == "array" then . else [.] end) | any(.scope? == "user")' \
  "$installed_plugins" >/dev/null 2>&1
```

Reads ALL keys from `enabledPlugins` (both `true` and `false` values). Pre-check: a **user-scope** record in `installed_plugins.json` — registry values are per-scope record arrays (Claude Code ≥2.1.198, `scope: user|project|local`); the type guard tolerates the legacy single-object form. A project/local-scope-only record does NOT count as installed, so it can't suppress the user-scope install the tri-state contract promises.

## Pass 3: Marketplace Update (`claude::_plugins_update`)

```bash
claude::_cli plugin marketplace update >/dev/null 2>&1 || true
```

Refreshes all marketplace manifests. Non-fatal — transient network failures must not abort sync.

## Pass 4: Plugin Updates (`claude::_plugins_update`)

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  out=$(claude::_cli plugin update "$plugin_id" 2>&1 || true)   # plugin update
  if [[ "$out" == *"Successfully updated"* ]]; then             # success check
    updated=$((updated + 1))
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")        # installed plugins read
```

Iterates ALL installed plugins (not just kit-managed). Each update is `|| true`; only `"Successfully updated"` output bumps the counter.

## Pass 5: Uninstall Removed Plugins (`claude::_plugins_uninstall`) — `--remove-plugins` only

```bash
while IFS= read -r plugin_id; do
  [[ -z "$plugin_id" ]] && continue
  if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then  # claude::_plugins_uninstall — the has($n) guard
    claude::_plugin_user_scope_installed "$installed_plugins" "$plugin_id" || continue  # user-scope records only
    claude::_cli plugin uninstall -y --scope user "$plugin_id" >/dev/null 2>&1 …  # plugin uninstall
  fi
done < <(jq -r '.plugins | keys[]' "$installed_plugins")  # installed plugins read
```

`has($n)` = key present in object, regardless of value. `false`-valued keys PASS `has()`. The kit uninstalls **user-scope records only** (explicit `--scope user`, gated on the scope-aware predicate) — a project/local-scope install is project-owned and never touched, even when its key is absent from SoT.

## Pass 6: Remove Extra Marketplaces (`claude::_plugins_remove_marketplaces`) — `--remove-plugins` only

```bash
while IFS= read -r mp_name; do
  [[ -z "$mp_name" ]] && continue
  [[ "$mp_name" == "claude-plugins-official" ]] && continue   # claude::_plugins_remove_marketplaces — claude-plugins-official guard
  if ! jq -e --arg n "$mp_name" '.extraKnownMarketplaces[$n]' "$repo_settings" >/dev/null 2>&1; then  # SoT membership check
    claude::_cli plugin marketplace remove "$mp_name" >/dev/null 2>&1 …  # marketplace remove
  fi
done < <(jq -r '. | keys[]' "$known_marketplaces")  # known marketplaces read
```

## Pass 7: Enforce SoT Enabled-State (`claude::_plugins_reassert_enabled_state`)

```bash
[[ -f "$user_settings" ]] || return 0
# 1. authoritative: disable each SoT-false plugin currently enabled
while IFS= read -r plugin_id; do
  jq -e --arg n "$plugin_id" '.enabledPlugins[$n] == true' "$user_settings" >/dev/null 2>&1 || continue
  claude::_cli plugin disable "$plugin_id" >/dev/null 2>&1 || warn "...will retry next sync"
done < <(jq -r '.enabledPlugins // {} | to_entries[] | select(.value == false) | .key' "$repo_settings")
# 2. normalize: SoT-declared keys win, user-only keys preserved
jq -s '.[0].enabledPlugins as $sot | .[1]
       | .enabledPlugins = ((.enabledPlugins // {}) * $sot)' \
   "$repo_settings" "$user_settings" > "$user_settings.tmp" \
  && mv "$user_settings.tmp" "$user_settings"   # else rm tmp + warn
```

`claude plugin install` (pass 2) installs at its default `--scope user` and ENABLES the plugin — writing `"<id>": true` into `~/.claude/settings.json`, clobbering the `false` `claude::sync_settings` wrote earlier in the same run. A bare jq rewrite back to `false` LOSES A RACE: the CLI owns `settings.json` and reverts the external edit, so the `false` only took effect on the *next* sync (once pass 2 skipped the already-installed plugin) — the historical two-sync bug. The fix issues the CLI's own `claude plugin disable` for SoT-`false` plugins first (authoritative — sticks in one pass), guarded on the plugin being currently `true` (re-disabling an already-disabled plugin is a CLI error, exit 1), THEN jq-normalizes (`(.enabledPlugins // {}) * $sot` = SoT-declared keys win, user-only keys preserved), the same invariant `claude::_settings_merge` establishes. This affects EVERY plugin installed via `claude plugin install` — built-in `claude-plugins-official` plugins included: `supabase` (a `false`-keyed official plugin) is re-enabled on fresh install and disabled by this pass. Unlike passes 1–6, this helper mutates the file directly and echoes no counter.

## Failure Counters

Each pass-1–6 helper echoes `"<count> <failed>"`; the orchestrator sums the failures (pass 7 is not counted — it runs after the sum and only warns on a jq failure):

```bash
# claude::sync_plugins — failure sum
failed=$((f1 + f2 + f3 + f4 + f5))
```

Non-zero `failed` triggers a `warn` after the dispatch (`claude::sync_plugins` — post-dispatch warn). The sync is not aborted — caller continues. The helpers return counts via stdout (not namerefs) for bash 3.2 / macOS `/bin/bash` portability (comment at `claude::_cli` — portability note).

## Codex Marketplace Dedup Logic (`codex::sync_marketplace` — unique_by dedup)

```
user_plugins + repo_plugins
→ reverse (user entries now at end)
→ unique_by(.name) (last entry for a name wins = user entry wins)
→ reverse (restore order)
```

Effect: user customizations to an existing plugin entry survive merge. Repo-only new plugins are appended.
