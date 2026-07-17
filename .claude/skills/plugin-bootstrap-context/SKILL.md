---
name: plugin-bootstrap-context
description: "Use when modifying cli/src/engine-native/claudeSync.ts plugin functions syncPlugins, pluginUserScopeInstalled, syncOptionalPlugins, enableOptionalPlugin, syncLspServers, or cli/src/engine-native/codexSync.ts marketplace/plugin functions syncMarketplace, removeLegacyDocksMarketplace, enabledPluginIds, syncPlugins; covers enabledPlugins tri-state, seven-pass reconcile, Codex marketplace dedup, and opt-in plugin behavior."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/claudeSync.ts
      lines: "623-810"
    - path: cli/src/engine-native/codexSync.ts
      lines: "249-500"
    - path: SoT/.claude/settings.json
      lines: "220-270"
    - path: SoT/.codex/plugins/marketplace.json
      lines: "1-80"
  updated: "2026-07-17"
---

# Plugin Bootstrap

Plugin bootstrap is implemented in EngineNative but keeps the same behavioral
contracts: Claude plugin reconcile is seven logical passes, `enabledPlugins`
has true/false/absent semantics, and Codex marketplace merging is additive with
SoT entries winning on name collisions.

<constraint>
The `--prune` keep test for Claude plugins is key presence, not truthiness.
A plugin declared as `"id@marketplace": false` is installed and kept; only an
absent key is removed by prune.
</constraint>

<constraint>
Never remove the `claude-plugins-official` marketplace. It is a protected
built-in marketplace even when pruning extras.
</constraint>

<constraint>
Marketplace prune must preserve any marketplace referenced by a project- or
local-scope install record. Removing that shared cache invalidates the scoped
installation even when the user-scope uninstall is correctly scoped.
</constraint>

<constraint>
The enabled-state reassert pass runs every sync after install/uninstall work.
Fresh `claude plugin install` enables plugins as a side effect, so SoT `false`
entries must be disabled through the Claude CLI before the JSON normalization.
</constraint>

## When To Use

- Adding, removing, or changing `enabledPlugins` entries.
- Changing `extraKnownMarketplaces` or marketplace removal protection.
- Debugging why a plugin survived `--prune`.
- Changing optional `--claude-plugin=supabase` / `--claude-plugin=n8n` behavior.
- Changing Codex personal marketplace merge or `codex plugin add` refresh.
- Changing LSP binary bootstrap for official Claude LSP plugins.

## Claude Tri-State

| Value | Installed by kit | Global state | Survives `--prune` |
|-------|------------------|--------------|--------------------|
| `true` | Yes | Enabled | Yes |
| `false` | Yes | Disabled, project can enable | Yes |
| absent | No | Not available | No |

Plugin IDs must use `<name>@<marketplace>`. Setting a plugin to `false` does not
remove it; deleting the key and running `--prune` removes the user-scope install.

## Seven Logical Passes

All live in `syncPlugins(ctx, claudeDir)`:

1. Add missing marketplaces from `extraKnownMarketplaces`.
2. Install SoT-declared plugins missing a user-scope install record; refresh
   marketplace manifests once before the first install attempt.
3. Refresh marketplace manifests unless `ctx.skipPluginRefresh` is set.
4. Update installed plugins best-effort unless `ctx.skipPluginRefresh` is set.
5. On `ctx.prune`, uninstall user-scope plugins absent from SoT `enabledPlugins`.
6. On `ctx.prune`, remove extra marketplaces except the protected official marketplace and marketplaces used by project/local installs.
7. Reassert SoT enabled state: disable SoT-`false` plugins through the CLI, then
   normalize deployed `enabledPlugins` so SoT-declared values win and user-only
   keys survive.

Failures in marketplace/plugin update remain non-fatal; install/removal counters
surface warnings but do not stop the rest of sync.

## Optional Plugins

`syncOptionalPlugins` consumes `ctx.claudePlugins`, populated by the repeatable
`--claude-plugin=<name>` flag. The allow-list lives in `parseArgs.ts` and is
currently `supabase` and `n8n`.

| Opt-in | Behavior |
|--------|----------|
| `supabase` | Installs/enables `supabase@claude-plugins-official`. |
| `n8n` | Adds the `czlonkowski/n8n-skills` marketplace if needed, then installs/enables `n8n-mcp-skills@n8n-mcp-skills`. |

These keys are absent from the SoT, so the opt-in is sticky. Only `--prune`
removes an installed optional plugin.

## Codex Marketplace And Plugins

`syncMarketplace` merges `SoT/.codex/plugins/marketplace.json` into the personal
marketplace file. User entries survive, but on `.name` collision the SoT entry
wins by concatenating user entries first, repo entries last, then applying
reverse/unique/reverse semantics.

`removeLegacyDocksMarketplace` cleans up the old configured Docks marketplace
when it points at the same Git source. `enabledPluginIds` parses enabled plugin
tables from `SoT/.codex/config.toml`; ordinary `syncPlugins` runs `codex plugin add`
for each enabled id so installed plugin caches refresh. With `ctx.skipPluginRefresh`,
the supported `codex plugin list --json` inventory filters the operation to missing
ids; an invalid inventory falls back to the full refresh path. Session Relay is ready only when exactly
one `session-relay@docks` row is installed and enabled with a version; this is
new-session installation readiness, not lifecycle or receive-path health.

## Key Decisions

- User-scope install records matter. Project/local records do not satisfy the
  kit's global install contract.
- Project/local records protect their marketplace cache from prune even though
  they do not satisfy the kit's user-scope install contract.
- `false` entries are still installed because they support project-level enable.
- LSP binaries are installed when LSP plugin keys are present, regardless of
  truthiness, for the same project-enable reason.
- Codex config and marketplace deployment can proceed even when the Codex CLI is
  absent; plugin refresh degrades to a warning and manual command.

## Gotchas

- A marketplace pre-check detects name presence, not URL correctness; a bad URL
  under the same name must be removed manually before sync can re-add it.
- Re-disabling an already-disabled plugin can be a CLI error; guard before
  calling the disable verb.
- A project-level `enabledPlugins: true` override is ignored when the user-scope
  key is absent; a project-scope plugin installation is an independent record.

## References

- `references/seven-pass-flow.md` - pass-by-pass reconcile details.
- `references/tri-state-semantics.md` - value and prune behavior matrix.
