# Plugin Tri-State Semantics

## Critical Constraint

The removal guard is `has($n)` NOT truthiness. `false`-valued keys PASS `has()` and are KEPT on `--remove-plugins`. (`claude::_plugins_uninstall` — the `has($n)` guard)

## Value × Scenario Matrix

| `enabledPlugins` value | Default sync | `--remove-plugins` | Per-project `true` | Claude Code default state |
|------------------------|-------------|-------------------|-------------------|--------------------------|
| `true` | Installed | Kept | N/A (already on) | Globally enabled |
| `false` | Installed | Kept | Activates for that project | Globally disabled |
| absent | Not installed | Uninstalled (if installed) | Cannot activate | N/A |

## Real Examples from `SoT/.claude/settings.json`

| Plugin ID | Value | Effect |
|-----------|-------|--------|
| `docks@docks` | `true` | Installed and active in every project |
| `n8n-mcp-skills@n8n-mcp-skills` | `false` | Installed; disabled globally; enabled only in `n8n-workflows/.claude/settings.json` |
| `supabase@claude-plugins-official` | `false` | Installed; disabled globally; enabled only in Supabase projects |

## Per-Project Enable Pattern

```json
// project/.claude/settings.json
{
  "enabledPlugins": {
    "n8n-mcp-skills@n8n-mcp-skills": true
  }
}
```

Requirement: the key `n8n-mcp-skills@n8n-mcp-skills` MUST exist in user-scope `~/.claude/settings.json` (even as `false`) or Claude Code silently ignores the project-level override.

## Changing from `false` to absent (removing a plugin)

1. Delete the key from `SoT/.claude/settings.json` `enabledPlugins`
2. Run `./sync.sh --remove-plugins`
   - Pass 5 (`claude::_plugins_uninstall`, the `has($n)` guard) tests the **SoT** `repo_settings`, not `~/.claude/settings.json` — the deleted key fails `has()` → `claude plugin uninstall -y --scope user` runs

Stale-key removal comes from the CLI uninstall path (Pass 5), OR the `enabledPlugins` key is removed from `~/.claude/settings.json` by hand. The `--force` `$user * $repo` reconcile does NOT delete removed keys: jq `*` deep-merge keeps keys present in `$user` but absent from SoT (`claude::_settings_reconcile` — the `$user * $repo` merge, the "user-only keys preserved" contract), so a `--force` pass alone never prunes a stale entry.

## Gotchas

- Official plugins the kit uses (`agent-sdk-dev`, `commit-commands`, `context7`, `frontend-design`, `php-lsp`, `typescript-lsp`) are declared `true` in SoT `enabledPlugins`, so they are already protected — Pass 5's `has()` passes and they survive `--remove-plugins`. The general mechanism still holds: Pass 5 reads installed plugins from `installed_plugins.json` and checks each against SoT `enabledPlugins`, so an official plugin auto-installed by Claude Code but ABSENT from SoT `enabledPlugins` (e.g. `skill-creator@claude-plugins-official`, deliberately not declared) IS uninstalled by Pass 5. Add it as `enabledPlugins: true` to protect it.
- `claude-plugins-official` marketplace is unconditionally protected in Pass 6 (`claude::_plugins_remove_marketplaces` — claude-plugins-official guard) — it is never removed regardless of SoT content.
- The "Globally disabled" state for a `false`-keyed plugin is **enforced by Pass 7**, not by the settings merge alone. Pass 2's `claude plugin install` enables the plugin at user scope as a side effect, so `claude::_plugins_reassert_enabled_state` must re-disable the SoT-`false` plugin afterward — via the CLI's own `claude plugin disable` (authoritative, single-pass), not a bare jq rewrite (which loses a race and needs a second sync). This affects EVERY `claude plugin install` target, built-in `claude-plugins-official` plugins included: `supabase` (`false`-keyed) is re-enabled on fresh install and re-disabled by Pass 7. (The older claim that official plugins "take a different install path and keep their merged value" was wrong — verified by uninstalling `supabase`, re-syncing, and observing it return enabled.)
