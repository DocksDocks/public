# Plugin Tri-State Semantics

## Critical Constraint

Prune uses key presence, not truthiness. `false`-valued keys are kept because
they mean installed but globally disabled.

## Value Matrix

| `enabledPlugins` value | Default sync | `--prune` | Per-project `true` | Claude default state |
|------------------------|--------------|-----------|--------------------|----------------------|
| `true` | Installed | Kept | Not needed | Globally enabled |
| `false` | Installed | Kept | Activates for that project | Globally disabled |
| absent | Not installed | Removed if user-scope installed | Ignored | Unavailable |

## Examples

| Plugin ID | Value | Effect |
|-----------|-------|--------|
| `docks@docks` | `true` | Installed and active globally. |
| `context7@claude-plugins-official` | `true` | Installed and active globally. |
| `supabase@claude-plugins-official` | absent | Installed only by `--claude-plugin=supabase`. |
| `n8n-mcp-skills@n8n-mcp-skills` | absent | Installed only by `--claude-plugin=n8n`. |
| illustrative `some-plugin@marketplace` | `false` | Installed, globally disabled, project can enable. |

The current SoT ships no `false` entry, but the value remains supported.

## Per-Project Enable Pattern

```json
{
  "enabledPlugins": {
    "some-plugin@marketplace": true
  }
}
```

The user-scope key must exist, even as `false`, or Claude Code ignores the
project-level override.

## Removing A Plugin

1. Delete the key from SoT `enabledPlugins`.
2. Run `docks-kit sync --prune`.

`--reconcile` alone does not delete removed plugin keys because the settings
merge preserves user-only keys. Removal is a plugin-layer prune operation.

## Gotchas

- Setting a plugin to `false` disables it globally; it does not uninstall it.
- `claude-plugins-official` marketplace is protected even if no third-party SoT
  entry references it.
- Pass 7 must disable SoT-`false` entries through the Claude CLI, not only by
  writing JSON.
