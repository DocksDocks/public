# Plugin Tri-State Semantics

## Critical Constraint

The removal guard is `has($n)` NOT truthiness. `false`-valued keys PASS `has()` and are KEPT on `--prune`. (`claude::_plugins_uninstall` — the `has($n)` guard)

## Value × Scenario Matrix

| `enabledPlugins` value | Default sync | `--prune` | Per-project `true` | Claude Code default state |
|------------------------|-------------|-------------------|-------------------|--------------------------|
| `true` | Installed | Kept | N/A (already on) | Globally enabled |
| `false` | Installed | Kept | Activates for that project | Globally disabled |
| absent | Not installed | Uninstalled (if installed) | Cannot activate | N/A |

## Real Examples from `SoT/.claude/settings.json`

Every plugin the SoT ships is `true` — there are no `false` entries today. The `false` row below is illustrative of the supported value, not a shipped example.

| Plugin ID | Value | Effect |
|-----------|-------|--------|
| `docks@docks` | `true` | Installed and active in every project |
| `context7@claude-plugins-official` | `true` | Installed and active in every project |
| `supabase@claude-plugins-official` | absent | Not installed by a flag-less sync; opted in per machine with `--claude-plugin=supabase` |
| `n8n-mcp-skills@n8n-mcp-skills` | absent | Not installed (marketplace also dropped); opted in with `--claude-plugin=n8n` |
| _(illustrative)_ `some-plugin@marketplace` | `false` | Installed; disabled globally; re-enablable per project |

## Per-Project Enable Pattern

Applies to any plugin the SoT keeps as `false` (installed-but-globally-disabled). The kit ships none as `false` today, so this uses a placeholder id:

```json
// project/.claude/settings.json
{
  "enabledPlugins": {
    "some-plugin@marketplace": true
  }
}
```

Requirement: the key `some-plugin@marketplace` MUST exist in user-scope `~/.claude/settings.json` (as `false`) or Claude Code silently ignores the project-level override. A plugin that is simply *absent* from user settings (like `supabase`/`n8n` before their `--claude-plugin=` opt-in runs) cannot be per-project-enabled this way — the opt-in installs it user-wide instead.

## Changing from `false` to absent (removing a plugin)

1. Delete the key from `SoT/.claude/settings.json` `enabledPlugins`
2. Run `docks-kit sync --prune` (or `bash lib/engine.sh sync --prune`)
   - Pass 5 (`claude::_plugins_uninstall`, the `has($n)` guard) tests the **SoT** `repo_settings`, not `~/.claude/settings.json` — the deleted key fails `has()` → `claude plugin uninstall -y --scope user` runs

Stale-key removal comes from the CLI uninstall path (Pass 5), OR the `enabledPlugins` key is removed from `~/.claude/settings.json` by hand. The `--reconcile` `$user * $repo` merge does NOT delete removed keys: jq `*` deep-merge keeps keys present in `$user` but absent from SoT (`claude::_settings_reconcile` — the `$user * $repo` merge, the "user-only keys preserved" contract), so a `--reconcile` pass alone never prunes a stale entry.

## Gotchas

- Official plugins the kit uses (`context7`, `frontend-design`, `php-lsp`, `typescript-lsp`) are declared `true` in SoT `enabledPlugins`, so they are already protected — Pass 5's `has()` passes and they survive `--prune`. The general mechanism still holds: Pass 5 reads installed plugins from `installed_plugins.json` and checks each against SoT `enabledPlugins`, so an official plugin auto-installed by Claude Code but ABSENT from SoT `enabledPlugins` (e.g. `skill-creator@claude-plugins-official`, deliberately not declared) IS uninstalled by Pass 5. Add it as `enabledPlugins: true` to protect it.
- `claude-plugins-official` marketplace is unconditionally protected in Pass 6 (`claude::_plugins_remove_marketplaces` — claude-plugins-official guard) — it is never removed regardless of SoT content.
- The "Globally disabled" state for a `false`-keyed plugin is **enforced by Pass 7**, not by the settings merge alone. Pass 2's `claude plugin install` enables the plugin at user scope as a side effect, so `claude::_plugins_reassert_enabled_state` must re-disable the SoT-`false` plugin afterward — via the CLI's own `claude plugin disable` (authoritative, single-pass), not a bare jq rewrite (which loses a race and needs a second sync). This affects EVERY `claude plugin install` target, built-in `claude-plugins-official` plugins included — any `false`-keyed official plugin is re-enabled on fresh install and re-disabled by Pass 7. The kit ships no `false`-keyed plugin today, but this enforcement is what makes `false` safe to declare. (Earlier testing — uninstalling a then-`false` `supabase`, re-syncing, and observing it return enabled — disproved the claim that official plugins "take a different install path and keep their merged value".)
