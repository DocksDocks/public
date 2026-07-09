# Seven-Pass Plugin Reconcile

The implementation lives in `syncPlugins(ctx, claudeDir)` in
`cli/src/engine-native/claudeSync.ts`. The logical pass structure is preserved
from the original design, but counters and subprocess calls are TypeScript.

## Critical Constraints

- Passes 3 and 4 are best-effort; update failures warn/count but do not abort the
  entire sync.
- Pass 5 uses key presence semantics for `enabledPlugins`; `false` keys are kept.
- Pass 6 never removes `claude-plugins-official`.
- Passes 5 and 6 run only when `ctx.prune` is true.
- Pass 7 runs on every sync to enforce SoT enabled state.

## Pass 1: Add Missing Marketplaces

Data source: `SoT/.claude/settings.json` `extraKnownMarketplaces`.

For each marketplace name/repo pair:

1. Skip blank names.
2. Skip when the name already exists in `known_marketplaces.json`.
3. Run `claude plugin marketplace add <repo>`.
4. Count success or warning failure.

The pre-check is name presence only; it does not validate that an existing URL is
correct.

## Pass 2: Install Plugins

Data source: all keys from SoT `enabledPlugins`, regardless of value.

For each plugin id:

1. Skip if `pluginUserScopeInstalled(installedPlugins, pluginId)` is true.
2. Refresh marketplace manifests once before the first install attempt.
3. Run `claude plugin install <pluginId>`.

The scope-aware install predicate requires a `scope: "user"` record. Project or
local installs do not satisfy the kit's user-scope install contract.

## Pass 3: Marketplace Update

Runs `claude plugin marketplace update` best-effort to refresh manifests.
Failure is non-fatal.

## Pass 4: Plugin Updates

Iterates installed plugin ids and runs `claude plugin update <id>` best-effort.
Only output that indicates a successful update increments the updated count.

## Pass 5: Uninstall Removed Plugins

Runs only under `ctx.prune`.

For each installed plugin id, test whether SoT `enabledPlugins` has that key. If
not, uninstall only the user-scope record. A key with value `false` is present
and therefore kept.

## Pass 6: Remove Extra Marketplaces

Runs only under `ctx.prune`.

For each known marketplace, skip blank names and `claude-plugins-official`. If
the name is absent from SoT `extraKnownMarketplaces`, remove it.

## Pass 7: Enforce SoT Enabled State

1. Read SoT `enabledPlugins` entries whose value is `false`.
2. For any such plugin currently `true` in deployed settings, call
   `claude plugin disable <id>`.
3. Normalize deployed settings so SoT-declared `enabledPlugins` values win while
   user-only keys survive.

This pass is required because a fresh CLI install enables the plugin as a side
effect. A JSON-only rewrite can lose the race with the CLI's own settings write.

## Failure Counters

Install, update, uninstall, and marketplace operations accumulate counts and
warnings. The sync reports plugin failures but continues to the remaining
layers, matching the best-effort plugin-management contract.

## Codex Marketplace Dedup

`syncMarketplace` concatenates user plugins then repo plugins, applies
reverse/unique-by-name/reverse semantics, and therefore lets the SoT entry win
on `.name` collision while preserving user-only entries.

## Codex Enabled-Plugin Parser

`enabledPluginIds` scans `SoT/.codex/config.toml` for plugin tables whose body
contains `enabled = true`. Omitted `enabled` defaults to disabled. The parser
flushes at every table boundary and EOF so each table is emitted at most once.
