# Seven-Pass Plugin Reconcile

The implementation lives in `syncPlugins(ctx, claudeDir)` in
`cli/src/engine-native/claudePluginPasses.ts`. The logical pass structure is preserved
from the original design, but counters and subprocess calls are TypeScript.

## Critical Constraints

- Passes 3 and 4 are skipped when `ctx.skipPluginRefresh` is true. Otherwise
  they are best-effort; update failures do not abort the entire sync.
- Pass 5 uses key presence semantics for `enabledPlugins`; `false` keys are
  kept. This run's `--claude-plugin` opt-ins are also kept.
- Pass 6 never removes `claude-plugins-official`, a kit-owned marketplace, or a
  marketplace referenced by a project/local install.
- Passes 5 and 6 run only when `ctx.prune` is true.
- Pass 7 runs on every sync to enforce SoT enabled state.
- Kit-owned plugin ids are the SoT `enabledPlugins` keys plus this run's
  `--claude-plugin` opt-ins. Kit-owned marketplaces are the SoT
  `extraKnownMarketplaces` keys plus the source marketplace of each kit-owned
  plugin id.
- Every `claude plugin` command runs through `claudePluginPasses.ts cli` with
  the system temp directory (`os.tmpdir()`) as its working directory. Project
  and local settings in the directory where the user runs sync never change.

## Pass 1: Add Missing Marketplaces

Data source: `SoT/.claude/settings.json` `extraKnownMarketplaces`, plus the
official marketplace when a kit-owned plugin needs it.

For each SoT marketplace name/repo pair:

1. Skip when `known_marketplaces.json` already has a truthy entry under that
   name.
2. Run `claude plugin marketplace add <source.repo>`.
3. On success, count it and mark the name as added this run. On failure, call
   `recordFailure` (the run exits 1).

Then pass 1 checks the official marketplace. Claude Code registers
`claude-plugins-official` only in an interactive session, so a fresh home does
not have it. When a kit-owned plugin id ends in `@claude-plugins-official` and
`known_marketplaces.json` has no truthy entry for that name, pass 1 runs
`claude plugin marketplace add anthropics/claude-plugins-official`. Success and
failure count the same way as for an SoT marketplace.

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

Runs `claude plugin marketplace update <name>` for each kit-owned marketplace
unless `ctx.skipPluginRefresh` is true. A non-zero exit does not stop the remaining
passes, but it is recorded through `recordFailure` and fails the run, because a
silent refresh failure leaves the marketplace clone pinned at an old commit
while install and enable-state still look clean. Pass 2 refreshes each source
marketplace once before its install and records the same way; pass 3 skips a
name already in `refreshedMarketplaces`, so one marketplace is fetched at most
once per run and one failure produces one ledger row. Passes 2 and 3 skip a
marketplace that is not present: not added in this run, and absent from an
existing, readable `known_marketplaces.json`. A missing inventory means a fresh
home, so nothing is present. An unreadable inventory cannot prove absence, so
the refresh runs.
This lets a first `--claude-plugin=n8n` opt-in add its marketplace before any
refresh, because Claude Code exits 1 on update of an unknown marketplace.
Each skipped name prints one `--verbose` line, `Skipping refresh of
marketplace <name>: not added yet; the next sync refreshes it`. The official
marketplace gets no exception, because pass 1 adds it when a kit-owned plugin
needs it.

## Pass 4: Plugin Updates

Unless `ctx.skipPluginRefresh` is true, iterates kit-owned plugin ids (SoT
`enabledPlugins` keys plus this run's opt-ins) that have a user-scope record and
runs `claude plugin update <id> --scope user`. A non-zero exit is recorded
through `recordFailure`. On a zero exit, only output that matches
`updated from <old> to <new> for scope` increments the updated count, because
an already-current plugin also exits zero.

## Pass 5: Uninstall Removed Plugins

Runs only under `ctx.prune`.

For each installed plugin id, test whether it is kit-owned: an SoT
`enabledPlugins` key or an opt-in of this run. If not, uninstall only the
user-scope record. A key with value `false` is present and therefore kept.

## Pass 6: Remove Extra Marketplaces

Runs only under `ctx.prune`.

For each known marketplace, skip `claude-plugins-official`, kit-owned
marketplaces, and marketplaces derived from project/local install records in
`installed_plugins.json`. Remove the remaining names with
`claude plugin marketplace remove <name>`. That command has no `--scope`, so it
removes the declaration from every scope that Claude Code sees. The neutral
working directory keeps it away from project and local settings.

## Pass 7: Enforce SoT Enabled State

1. Read SoT `enabledPlugins` entries whose value is `false`.
2. For any such plugin currently `true` in deployed settings, call
   `claude plugin disable <id> --scope user`.
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
The update fast path cross-checks those desired ids against `codex plugin list
--json` and calls `codex plugin add` only for missing installed rows. Invalid
inventory output falls back to ordinary full refresh.
