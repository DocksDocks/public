---
name: plugin-bootstrap-context
description: Use when modifying claude::sync_plugins (six-pass reconciler) or its claude::_plugins_* helpers, codex::sync_marketplace, codex::remove_legacy_docks_marketplace, codex::sync_plugins, or extraKnownMarketplaces / enabledPlugins entries in SoT/.claude/settings.json; covers the true/false/absent tri-state semantics, why false-keyed plugins are kept on --remove-plugins (via jq -e ... | has($n) not truthiness), the claude-plugins-official removal protection, the Codex unique_by(.name) dedup with user-entry-wins ordering, the personal-marketplace-first Codex flow, legacy configured Docks marketplace cleanup, and the plugin-add refresh pass.
user-invocable: false
metadata:
  source_files:
    - path: lib/claude.sh
      lines: "176-329"
    - path: lib/codex.sh
      lines: "315-489"
    - path: SoT/.claude/settings.json
      lines: "245-271"
    - path: SoT/.codex/plugins/marketplace.json
      lines: "1-22"
  updated: "2026-05-28"
---

# Plugin Bootstrap

<constraint>
The `--remove-plugins` guard for `enabledPlugins` uses `has($n)` — not truthiness. A `false`-keyed plugin passes `has()` and is KEPT. Only plugins whose key is ABSENT from `enabledPlugins` are uninstalled. Changing this to a truthiness test would uninstall all globally-disabled plugins. (lib/claude.sh:254)
</constraint>

<constraint>
`claude-plugins-official` is NEVER removed, even on `--remove-plugins` runs. The guard at lib/claude.sh:277 (`[[ "$mp_name" == "claude-plugins-official" ]] && continue`) is mandatory and must not be removed.
</constraint>

<constraint>
Plugin IDs follow the `<name>@<marketplace>` format (e.g. `docks@docks`, `n8n-mcp-skills@n8n-mcp-skills`). The `enabledPlugins` key must use this exact format. The install loop reads keys via `jq -r '.enabledPlugins // {} | keys[]'` (lib/claude.sh:219).
</constraint>

## When to Use

- Adding a new plugin to `SoT/.claude/settings.json` `enabledPlugins`
- Understanding why a plugin survives `--remove-plugins`
- Changing a plugin from globally-enabled (`true`) to globally-disabled (`false`)
- Debugging a marketplace add failure
- Modifying any `claude::_plugins_*` helper or the `claude::sync_plugins` orchestrator
- Modifying `codex::sync_marketplace`, `codex::remove_legacy_docks_marketplace`, or `codex::sync_plugins`

## Core Patterns

### `enabledPlugins` Tri-State Semantics

| Value | Installed by kit? | Globally enabled? | Per-project can enable? | Survives `--remove-plugins`? |
|-------|------------------|------------------|------------------------|------------------------------|
| `true` | Yes | Yes | N/A | Yes (`has()` passes) |
| `false` | Yes | No | Yes (project settings.json) | Yes (`has()` passes) |
| absent | No | — | No (nothing to flip) | No (uninstalled by `--remove-plugins`) |

Source: lib/claude.sh:254 (`has($n)` test), SoT/.claude/settings.json:245-257 (examples: `docks@docks: true`, `n8n-mcp-skills@n8n-mcp-skills: false`, `supabase@claude-plugins-official: false`).

### Six-Pass Reconcile (`claude::sync_plugins` orchestrator, lib/claude.sh:292-329)

The orchestrator dispatches five `claude::_plugins_*` helpers (passes 3+4 share one helper). Each helper echoes `"<count> <failed>"` on stdout — a bash 3.2-portable counter return (namerefs need bash 4.3+ and would break macOS `/bin/bash`); the orchestrator reads them via `read -r added_mp f1 < <(...)` at lib/claude.sh:312-317.

| Pass | Condition | Action | Helper (def) | Op line |
|------|-----------|--------|--------------|---------|
| 1 | Always | `claude plugin marketplace add` for missing `extraKnownMarketplaces` | `_plugins_add_marketplaces` (183) | 192 |
| 2 | Always | `claude plugin install` for missing `enabledPlugins` keys | `_plugins_install` (204) | 213 |
| 3 | Always | `claude plugin marketplace update` (refresh manifests) | `_plugins_update` (226) | 230 |
| 4 | Always | `claude plugin update <id>` for each installed plugin | `_plugins_update` (226) | 235 |
| 5 | `REMOVE_PLUGINS=1` | `claude plugin uninstall -y` for installed plugins not in `enabledPlugins` via `has()` | `_plugins_uninstall` (247) | 255 |
| 6 | `REMOVE_PLUGINS=1` | `claude plugin marketplace remove` for extra marketplaces not in `extraKnownMarketplaces` | `_plugins_remove_marketplaces` (270) | 279 |

Passes 5+6 are gated on `REMOVE_PLUGINS` at lib/claude.sh:315. Pass 3 uses `|| true` (lib/claude.sh:230) — marketplace update failures are non-fatal. Pass 4 uses `|| true` (lib/claude.sh:235) — individual plugin update failures are non-fatal and only `"Successfully updated"` output bumps the counter (lib/claude.sh:236).

### Pass 1 — Marketplace Pre-Check

```bash
# lib/claude.sh:189
if [[ -f "$known_marketplaces" ]] && jq -e --arg n "$mp_name" '.[$n]' "$known_marketplaces" >/dev/null 2>&1; then
  continue
fi
```

Checks key presence in `known_marketplaces.json`, not URL validity. A broken marketplace URL already in the file is NOT re-added. The repo/source pair is read via `jq -r '.extraKnownMarketplaces // {} | to_entries[] | "\(.key)\t\(.value.source.repo)"'` (lib/claude.sh:198).

### Pass 5 — `has($n)` Removal Guard

```bash
# lib/claude.sh:254
if ! jq -e --arg n "$plugin_id" '.enabledPlugins | has($n)' "$repo_settings" >/dev/null 2>&1; then
  claude::_cli plugin uninstall -y "$plugin_id" …   # line 255
fi
```

`has($n)` returns true for both `"key": true` AND `"key": false`. Only uninstalls when the key is completely absent.

### Pass 6 — `claude-plugins-official` Protection

```bash
# lib/claude.sh:276-277
[[ -z "$mp_name" ]] && continue
[[ "$mp_name" == "claude-plugins-official" ]] && continue
```

### Codex Marketplace Merge (`codex::sync_marketplace`, lib/codex.sh:315-356)

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

`reverse + unique_by(.name) + reverse` (lib/codex.sh:340-342) — last entry for a given `.name` survives `unique_by`. Since user array is first, reversing puts user entries LAST, `unique_by` keeps last = user entry wins on name collision. Second `reverse` restores original order. Write-to-`.tmp`-then-`mv` (lib/codex.sh:344, 349). Runs the merge branch only when the user file exists and `FORCE=0` (lib/codex.sh:329); otherwise installs wholesale.

### Codex Legacy Marketplace Cleanup (`codex::remove_legacy_docks_marketplace`, lib/codex.sh:383-402)

Older sync versions ran `codex plugin marketplace add DocksDocks/docks`, creating a configured Git marketplace named `docks` alongside the implicit personal marketplace file at `~/.agents/plugins/marketplace.json`. The kit now uses the personal marketplace as the single source. `codex::_marketplace_source` (lib/codex.sh:358-381) awk-parses the `source =` line from the `[marketplaces.docks]` table; if it points at `https://github.com/DocksDocks/docks.git` or `DocksDocks/docks`, sync removes the configured source with `codex plugin marketplace remove docks` (lib/codex.sh:395).

### Codex Plugin Refresh (`codex::sync_plugins`, lib/codex.sh:454-489)

`codex::_enabled_plugin_ids` (lib/codex.sh:422-452) awk-parses enabled `[plugins."name@marketplace"]` tables from `SoT/.codex/config.toml` (only tables whose body has `enabled = true`). `codex::sync_plugins` then:

| Step | Action | Failure mode |
|------|--------|--------------|
| 1 | `codex plugin add <plugin@marketplace>` for every enabled plugin (lib/codex.sh:471) | Warn with the first CLI error line and count failure (lib/codex.sh:477-478) |

This pass is intentionally run on every sync. `codex plugin add` is the Codex CLI's install/reinstall command, and re-running it refreshes a stale installed cache from the personal marketplace's current Git source.

## Key Decisions

- Helpers echo `"<count> <failed>"` (bash 3.2-portable; comment at lib/claude.sh:180-182) — namerefs would break macOS `/bin/bash`. The orchestrator sums failures into `failed` at lib/claude.sh:319.
- `|| true` on passes 3 and 4 (lib/claude.sh:230, 235) — marketplace update and plugin updates are best-effort; failures must not abort the sync run.
- `claude` CLI is checked with `command -v claude` (lib/claude.sh:307) before the dispatch block. If absent, the whole reconcile is skipped with a warning.
- `codex::sync_plugins` checks `command -v codex` (lib/codex.sh:463) before running plugin CLI commands. If only the config and marketplace files can be deployed, it prints the manual `codex plugin add` fallback built by `codex::_manual_plugin_refresh_command` (lib/codex.sh:410-420).
- Codex sync does NOT call `codex plugin marketplace add DocksDocks/docks`; `SoT/.codex/plugins/marketplace.json` already provides the implicit personal marketplace.
- Per-project plugin enable lives in the project's `.claude/settings.json` `enabledPlugins` block. The user-scope key must remain present (as `false`) — Claude Code ignores project-level entries whose key is absent from user settings.

## Gotchas

- **Marketplace pre-check checks presence, not validity** (lib/claude.sh:189): a bad GitHub URL already in `known_marketplaces.json` will not be corrected by re-running sync. Recovery: `claude plugin marketplace remove <name>` then re-run sync.
- **`false`-keyed plugins ARE installed** (pass 2, lib/claude.sh:208-219): the install loop reads all keys from `enabledPlugins` regardless of value. This is intentional — `false` means "installed, globally disabled."
- **Codex `command -v codex` matches the kit's own launcher**: if the kit launcher is present but the npm Codex binary is not, `codex plugin add` fails with "could not find a Codex CLI binary" — the helper warns with the npm install fallback (lib/codex.sh:473-474).
- **Per-project `enabledPlugins: true` is silently ignored** if the user-scope key is absent — Claude Code requires the key to exist in user settings (even as `false`) before a project-level override can activate it.

## References

- `references/six-pass-flow.md` — annotated pass-by-pass walkthrough with jq and CLI invocations; read when debugging a specific pass
- `references/tri-state-semantics.md` — table of value × scenario × outcome; read when deciding what value to assign a new plugin entry
