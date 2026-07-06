---
name: plugin-bootstrap-context
description: Use when modifying claude::sync_plugins (seven-pass reconciler) or its claude::_plugins_* helpers, claude::sync_lsp_servers (LSP-binary bootstrap for php-lsp/typescript-lsp), codex::sync_marketplace, codex::remove_legacy_docks_marketplace, codex::sync_plugins, or extraKnownMarketplaces / enabledPlugins entries in SoT/.claude/settings.json; covers the true/false/absent tri-state semantics, why false-keyed plugins are kept on --remove-plugins (via jq -e ... | has($n) not truthiness), the claude-plugins-official removal protection, the pass-7 enabled-state re-assert that undoes claude plugin install's user-scope enable side effect, the Codex unique_by(.name) dedup with user-entry-wins ordering, the personal-marketplace-first Codex flow, legacy configured Docks marketplace cleanup, and the plugin-add refresh pass.
user-invocable: false
metadata:
  source_files:
    - path: lib/claude.sh
      lines: "377-648"
    - path: lib/codex.sh
      lines: "292-470"
    - path: SoT/.claude/settings.json
      lines: "237-268"
    - path: SoT/.codex/plugins/marketplace.json
      lines: "1-22"
  updated: "2026-07-05"
---

# Plugin Bootstrap

<constraint>
The `--remove-plugins` guard for `enabledPlugins` uses `has($n)` — not truthiness. A `false`-keyed plugin passes `has()` and is KEPT. Only plugins whose key is ABSENT from `enabledPlugins` are uninstalled. Changing this to a truthiness test would uninstall all globally-disabled plugins. (`claude::_plugins_uninstall` — the `has($n)` guard)
</constraint>

<constraint>
`claude-plugins-official` is NEVER removed, even on `--remove-plugins` runs. The guard at `claude::_plugins_remove_marketplaces` (`[[ "$mp_name" == "claude-plugins-official" ]] && continue`) is mandatory and must not be removed.
</constraint>

<constraint>
Pass 7 (`claude::_plugins_reassert_enabled_state`) runs UNCONDITIONALLY on every sync, after the install/uninstall passes — `claude plugin install` enables plugins at user scope as a side effect, so this enforce step is the only thing keeping `false`-keyed plugins globally disabled. Removing it, or gating it behind `--remove-plugins`/`--force`, silently re-enables every globally-disabled plugin. It MUST disable SoT-`false` plugins via the CLI's own `claude plugin disable` verb (authoritative — sticks in one pass) BEFORE the jq-normalize: a bare jq rewrite of the value back to `false` loses a race against the CLI and only takes effect on the *next* sync (the historical two-sync bug). The disable is guarded on the plugin being currently `true` — re-disabling an already-disabled plugin is a CLI error (exit 1).
</constraint>

<constraint>
Plugin IDs follow the `<name>@<marketplace>` format (e.g. `docks@docks`, `n8n-mcp-skills@n8n-mcp-skills`). The `enabledPlugins` key must use this exact format. The install loop reads keys via `jq -r '.enabledPlugins // {} | keys[]'` (`claude::_plugins_install` — keys read).
</constraint>

## When to Use

- Adding a new plugin to `SoT/.claude/settings.json` `enabledPlugins`
- Understanding why a plugin survives `--remove-plugins`
- Changing a plugin from globally-enabled (`true`) to globally-disabled (`false`)
- Debugging a marketplace add failure
- Modifying any `claude::_plugins_*` helper or the `claude::sync_plugins` orchestrator
- Adding/removing an LSP plugin or changing which language-server binaries `claude::sync_lsp_servers` auto-installs
- Modifying `codex::sync_marketplace`, `codex::remove_legacy_docks_marketplace`, or `codex::sync_plugins`

## Core Patterns

### `enabledPlugins` Tri-State Semantics

| Value | Installed by kit? | Globally enabled? | Per-project can enable? | Survives `--remove-plugins`? |
|-------|------------------|------------------|------------------------|------------------------------|
| `true` | Yes | Yes | N/A | Yes (`has()` passes) |
| `false` | Yes | No | Yes (project settings.json) | Yes (`has()` passes) |
| absent | No | — | No (nothing to flip) | No (uninstalled by `--remove-plugins`) |

Source: `claude::_plugins_uninstall` (the `has($n)` test), SoT/.claude/settings.json:245-257 (examples: `docks@docks: true`, `n8n-mcp-skills@n8n-mcp-skills: false`, `supabase@claude-plugins-official: false`).

### Seven-Pass Reconcile (`claude::sync_plugins` orchestrator)

The orchestrator dispatches six `claude::_plugins_*` helpers (passes 3+4 share one helper). Each helper echoes `"<count> <failed>"` on stdout — a bash 3.2-portable counter return (namerefs need bash 4.3+ and would break macOS `/bin/bash`); the orchestrator reads them via `read -r added_mp f1 < <(...)` at `claude::sync_plugins` (dispatch block). Pass 7 is the exception — it mutates `~/.claude/settings.json` in place and returns no count.

| Pass | Condition | Action | Helper (def) | Operation |
|------|-----------|--------|--------------|-----------|
| 1 | Always | `claude plugin marketplace add` for missing `extraKnownMarketplaces` | `_plugins_add_marketplaces` | marketplace add |
| 2 | Always | `claude plugin install` for `enabledPlugins` keys lacking a **user-scope** install record (`claude::_plugin_user_scope_installed`); refreshes marketplace manifests once before the first install (`claude::_plugins_install` — stale-manifest guard) | `_plugins_install` | marketplace update + plugin install |
| 3 | Always | `claude plugin marketplace update` (refresh manifests) | `_plugins_update` | marketplace update |
| 4 | Always | `claude plugin update <id>` for each installed plugin | `_plugins_update` | plugin update |
| 5 | `REMOVE_PLUGINS=1` | `claude plugin uninstall -y --scope user` for installed plugins not in `enabledPlugins` via `has()` — user-scope records only | `_plugins_uninstall` | plugin uninstall |
| 6 | `REMOVE_PLUGINS=1` | `claude plugin marketplace remove` for extra marketplaces not in `extraKnownMarketplaces` | `_plugins_remove_marketplaces` | marketplace remove |
| 7 | Always | Enforce SoT enabled-state: `claude plugin disable` each SoT-`false` plugin currently enabled (authoritative, single-pass), then jq-normalize `(.enabledPlugins // {}) * $sot` | `_plugins_reassert_enabled_state` | CLI disable + settings rewrite |

Passes 5+6 are gated on `REMOVE_PLUGINS` at `claude::sync_plugins` (REMOVE_PLUGINS gate); pass 7 runs unconditionally after them. Pass 3 uses `|| true` (`claude::_plugins_update` — marketplace-update `|| true`) — marketplace update failures are non-fatal. Pass 4 uses `|| true` (`claude::_plugins_update` — plugin-update `|| true`) — individual plugin update failures are non-fatal and only `"Successfully updated"` output bumps the counter.

### Pass 1 — Marketplace Pre-Check

```bash
# claude::_plugins_add_marketplaces (key-presence pre-check)
if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
  continue
fi
```

Checks key presence in `known_marketplaces.json`, not URL validity. A broken marketplace URL already in the file is NOT re-added. The repo/source pair is read via `jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"'` (`claude::_plugins_add_marketplaces` — extraKnownMarketplaces read).

### Pass 5 — `has($n)` Removal Guard

```bash
# claude::_plugins_uninstall (the has($n) guard)
if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
  claude::_plugin_user_scope_installed "$installed_plugins" "$plugin_id" || continue
  claude::_cli plugin uninstall -y --scope user "$plugin_id" …
fi
```

`has($n)` returns true for both `"key": true` AND `"key": false`. Only uninstalls when the key is completely absent — and only the **user-scope** record: project/local-scope installs are project-owned and never touched.

### Pass 6 — `claude-plugins-official` Protection

```bash
# claude::_plugins_remove_marketplaces (claude-plugins-official guard)
[[ -z "$mp_name" ]] && continue
[[ "$mp_name" == "claude-plugins-official" ]] && continue
```

### Pass 7 — Enforce Enabled-State

```bash
# claude::_plugins_reassert_enabled_state
# 1. authoritative: disable each SoT-false plugin that is currently enabled
jq -r '.enabledPlugins // {} | to_entries[] | select(.value == false) | .key' "$repo_settings" |
while read -r plugin_id; do
  jq -e --arg n "$plugin_id" '.enabledPlugins[$n] == true' "$user_settings" >/dev/null 2>&1 || continue
  claude::_cli plugin disable "$plugin_id"   # sticks in ONE pass; CLI owns the file
done
# 2. normalize: SoT-declared values win, user-only keys preserved
jq -s '.[0].enabledPlugins as $sot | .[1]
       | .enabledPlugins = ((.enabledPlugins // {}) * $sot)' \
   "$repo_settings" "$user_settings" > "$user_settings.tmp" && mv ...
```

`claude plugin install` (pass 2) installs at `--scope user` (its default) and **enables the plugin as a side effect** — writing `"<id>": true` into `~/.claude/settings.json`, clobbering the `false` `claude::sync_settings` wrote moments earlier (settings sync runs at `claude::sync` step 4, plugins at step 8). A bare jq rewrite of that back to `false` **loses a race**: the CLI owns `settings.json` and reverts the external edit, so the `false` only took effect on the *next* sync (once pass 2 skipped the already-installed plugin) — the historical two-sync bug. The fix disables SoT-`false` plugins through the CLI's own `claude plugin disable` verb first (authoritative — sticks in a single pass), THEN jq-normalizes (`(.enabledPlugins // {}) * $sot` = SoT-declared keys win, user-only keys preserved). The disable is guarded on the plugin being currently `true` because re-disabling an already-disabled plugin is a CLI error (exit 1); that keeps steady-state syncs silent. If `claude plugin disable` is unavailable the jq-normalize still runs, degrading to the old two-sync behavior rather than breaking. This affects **every** plugin installed via `claude plugin install`, built-in `claude-plugins-official` ones included — `supabase` (a `false`-keyed official plugin) is re-enabled on fresh install and disabled by this pass.

### LSP Server Binary Bootstrap (`claude::sync_lsp_servers`)

Runs after `claude::sync_plugins` in `claude::sync`. The official LSP plugins (`php-lsp`, `typescript-lsp`) only carry `lspServers` config (shipped in the marketplace manifest, not the plugin files) — the language-server binaries are separate npm globals, without which the plugins are silent no-ops. The helper maps SoT `enabledPlugins` keys to binaries (`php-lsp` → `intelephense`; `typescript-lsp` → `typescript-language-server` + `tsc` from the `typescript` package), collects the missing ones, and runs a single `npm install -g`. Gated on key *presence* (`has()`, not truthiness) for the same reason as pass 5: a `false`-keyed LSP plugin can be enabled per-project, so its binary must still exist. When npm is absent it warns and skips (`claude::sync_lsp_servers` — the npm presence guard); when no LSP plugin key is declared it returns silently.

### Codex Marketplace Merge (`codex::sync_marketplace`)

```bash
jq -s '
  .[0] as $repo | .[1] as $user |
  ($user * {name: ($user.name // $repo.name), interface: ($user.interface // $repo.interface)}) |
  .plugins = (
    (($user.plugins // []) + ($repo.plugins // []))
    | reverse
    | unique_by(.name)
    | reverse
  )
' "$codex_marketplace" "$user_codex_marketplace" > "$user_codex_marketplace.tmp"
```

`reverse + unique_by(.name) + reverse` (`codex::sync_marketplace` — unique_by dedup) — last entry for a given `.name` survives `unique_by`. Since user array is first, reversing puts user entries LAST, `unique_by` keeps last = user entry wins on name collision. Second `reverse` restores original order. Write-to-`.tmp`-then-`mv` (`codex::sync_marketplace` — tmp-then-mv). Runs the merge branch only when the user file exists and `FORCE=0` (`codex::sync_marketplace` — FORCE guard); otherwise installs wholesale.

### Codex Legacy Marketplace Cleanup (`codex::remove_legacy_docks_marketplace`)

Older sync versions ran `codex plugin marketplace add DocksDocks/docks`, creating a configured Git marketplace named `docks` alongside the implicit personal marketplace file at `~/.agents/plugins/marketplace.json`. The kit now uses the personal marketplace as the single source. `codex::_marketplace_source` awk-parses the `source =` line from the `[marketplaces.docks]` table; if it points at `https://github.com/DocksDocks/docks.git` or `DocksDocks/docks`, sync removes the configured source with `codex plugin marketplace remove docks` (`codex::remove_legacy_docks_marketplace` — marketplace remove).

### Codex Plugin Refresh (`codex::sync_plugins`)

`codex::_enabled_plugin_ids` awk-parses enabled `[plugins."name@marketplace"]` tables from `SoT/.codex/config.toml` (only tables whose body has `enabled = true`). `codex::sync_plugins` then:

| Step | Action | Failure mode |
|------|--------|--------------|
| 1 | `codex plugin add <plugin@marketplace>` for every enabled plugin (`codex::sync_plugins` — plugin add loop) | Warn with the first CLI error line and count failure (`codex::sync_plugins` — failure counter) |

This pass is intentionally run on every sync. `codex plugin add` is the Codex CLI's install/reinstall command, and re-running it refreshes a stale installed cache from the personal marketplace's current Git source.

## Key Decisions

- Helpers echo `"<count> <failed>"` (bash 3.2-portable; comment at `claude::_cli` — portability note) — namerefs would break macOS `/bin/bash`. The orchestrator sums failures into `failed` at `claude::sync_plugins` (failure sum).
- `|| true` on passes 3 and 4 (`claude::_plugins_update` — marketplace-update `|| true`, plugin-update `|| true`) — marketplace update and plugin updates are best-effort; failures must not abort the sync run.
- `claude` CLI is checked with `command -v claude` (`claude::sync_plugins` — CLI presence check) before the dispatch block. If absent, the whole reconcile is skipped with a warning.
- `codex::sync_plugins` checks `command -v codex` before running plugin CLI commands. If only the config and marketplace files can be deployed, it prints the official standalone installer fallback from `codex::_standalone_install_command` plus the manual `codex plugin add` fallback built by `codex::_manual_plugin_refresh_command`.
- Codex sync does NOT call `codex plugin marketplace add DocksDocks/docks`; `SoT/.codex/plugins/marketplace.json` already provides the implicit personal marketplace.
- Per-project plugin enable lives in the project's `.claude/settings.json` `enabledPlugins` block. The user-scope key must remain present (as `false`) — Claude Code ignores project-level entries whose key is absent from user settings.

## Gotchas

- **Install records are per-scope arrays** (Claude Code ≥2.1.198): `installed_plugins.json` maps each plugin id to an array of records carrying `scope: user|project|local`. Passes 2 and 5 test for a **user-scope** record via `claude::_plugin_user_scope_installed` — a project-scope-only record (from `claude plugin install --scope project` in some repo) does NOT count as installed. Before this predicate, such a record silently suppressed the user-scope install and every other project carried an orphaned `enabledPlugins` reference (`/doctor`: "enabled in project settings but isn't installed").
- **Pass 2 must refresh manifests before installing** (`claude::_plugins_install` — stale-manifest guard): an already-cloned marketplace may predate a plugin later added to it, and pass 3's `marketplace update` runs after pass 2 — too late. Without the guard, the first sync after a marketplace gains a new plugin fails with "not found in marketplace" and only the *next* sync succeeds. The refresh is lazy (`refreshed` flag) — it runs at most once and only when at least one install is actually needed, so steady-state syncs pay nothing.
- **Marketplace pre-check checks presence, not validity** (`claude::_plugins_add_marketplaces` — key-presence pre-check): a bad GitHub URL already in `known_marketplaces.json` will not be corrected by re-running sync. Recovery: `claude plugin marketplace remove <name>` then re-run sync.
- **`false`-keyed plugins ARE installed** (pass 2, `claude::_plugins_install` — keys read): the install loop reads all keys from `enabledPlugins` regardless of value. This is intentional — `false` means "installed, globally disabled." But `claude plugin install` *enables* what it installs (user scope), so pass 7 (`claude::_plugins_reassert_enabled_state`) must run afterward to restore the `false`; dropping pass 7 silently re-enables every globally-disabled plugin.
- **Codex CLI missing or stale wrapper on PATH**: if `command -v codex` is absent, sync deploys config/marketplace files and prints the official standalone installer plus manual `codex plugin add` fallback. If a stale wrapper is found and emits "could not find a Codex CLI binary", the refresh pass warns with the same standalone installer fallback (`codex::sync_plugins` — missing-binary warning).
- **Per-project `enabledPlugins: true` is silently ignored** if the user-scope key is absent — Claude Code requires the key to exist in user settings (even as `false`) before a project-level override can activate it.
- **LSP binaries installed via nvm-backed npm are only on interactive-shell PATHs** — normally-launched Claude Code sessions see them; headless/cron agents may not. `claude::sync_lsp_servers` checks `command -v`, so a binary visible to sync but not to a headless session won't be re-installed by re-running sync there.

## References

- `references/seven-pass-flow.md` — annotated pass-by-pass walkthrough with jq and CLI invocations; read when debugging a specific pass
- `references/tri-state-semantics.md` — table of value × scenario × outcome; read when deciding what value to assign a new plugin entry
