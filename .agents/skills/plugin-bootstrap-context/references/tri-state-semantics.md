# Plugin Tri-State Semantics

## Critical Constraint

Prune uses key presence, not truthiness. `false`-valued keys are kept because
they mean installed but globally disabled.

## Value Matrix

| `enabledPlugins` value | Default sync | `--prune` | Per-project `true` | Claude default state |
|------------------------|--------------|-----------|--------------------|----------------------|
| `true` | Installed | Kept | Not needed | Globally enabled |
| `false` | Installed | Kept | Activates for that project | Globally disabled |
| absent | Not installed | Removed if user-scope installed and not opted in this run | Ignored | Unavailable |

## Examples

| Plugin ID | Value | Effect |
|-----------|-------|--------|
| illustrative `some-plugin@marketplace` | `true` | Installed and active globally. |
| illustrative `some-plugin@marketplace` | `false` | Installed, globally disabled, project can enable. |
| an optional plugin id | absent | Installed only by its `--claude-plugin=<name>` flag. |

The shipped ids and values live in `SoT/.claude/settings.json` `enabledPlugins`
(verify: `bun -e 'console.log(JSON.parse(await Bun.file("SoT/.claude/settings.json").text()).enabledPlugins)'`).
The value `false` is supported whether or not the SoT ships one. The optional
plugin names live in `parseModifiers.ts KNOWN_CLAUDE_OPTIN_PLUGINS`
(verify: `bun -e 'console.log((await import("./cli/src/engine-native/parseModifiers.ts")).KNOWN_CLAUDE_OPTIN_PLUGINS)'`).

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
2. Add `enabledPlugins.<id>` to `claudeRemovals.ts REMOVED_MANIFEST.settingsKeys`.
   Every sync then deletes the stale key from deployed settings, with or without
   `--prune`.
   (verify: `bunx vitest run cli/test/unit/claudeMigration.test.ts -t "prunes withdrawn plugin keys but leaves user and shipped plugins enabled as configured"`)
3. Run `docks-kit sync --prune` to uninstall the user-scope install record
   (plugin pass 5).

`--reconcile` alone does not delete removed plugin keys because the settings
merge (`settings.ts reconcileSettings`) preserves user-only keys. Key removal
belongs to the `claudeRemovals.ts` registry; uninstall belongs to plugin pass 5
under `--prune`.

## Gotchas

- Setting a plugin to `false` disables it globally; it does not uninstall it.
- `claude-plugins-official` marketplace is protected even if no third-party SoT
  entry references it.
- Pass 7 must disable SoT-`false` entries through the Claude CLI, not only by
  writing JSON.
