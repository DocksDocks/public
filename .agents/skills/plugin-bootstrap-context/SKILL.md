---
name: plugin-bootstrap-context
description: "Use when modifying cli/src/engine-native/claudePluginPasses.ts syncPlugins or pluginUserScopeInstalled, claudeOptionalPlugins.ts syncOptionalPlugins or enableOptionalPlugin, claudeLsp.ts syncLspServers, or cli/src/engine-native/codexPlugins.ts syncMarketplace, removeLegacyDocksMarketplace, enabledPluginIds, or syncPlugins; covers the enabledPlugins tri-state, the seven-pass Claude plugin reconcile, --claude-plugin opt-ins, LSP binary bootstrap, and Codex personal marketplace merge. Not for settings.json merge (use settings-merge-context), Codex config.toml merge (use codex-config-merge-context), sync flag parsing (use sync-orchestration-context), toolchain pins (use toolchain-context), or omp plugins (use omp-sync-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/engine-native/claudePluginPasses.ts
      lines: "1-426"
    - path: cli/src/engine-native/codexPlugins.ts
      lines: "1-315"
    - path: cli/src/engine-native/claudeOptionalPlugins.ts
      lines: "1-126"
    - path: cli/src/engine-native/claudeLsp.ts
      lines: "1-301"
    - path: cli/src/engine-native/failures.ts
      lines: "1-16"
    - path: cli/src/engine-native/parseModifiers.ts
      lines: "1-225"
    - path: cli/src/engine-native/syncDispatch.ts
      lines: "1-155"
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-312"
    - path: cli/src/engine-native/claudeRemovals.ts
      lines: "1-383"
    - path: cli/src/engine-native/settings.ts
      lines: "1-42"
    - path: cli/src/engine-native/codexSync.ts
      lines: "1-269"
    - path: cli/src/engine-native/codexStatus.ts
      lines: "1-25"
    - path: SoT/.claude/settings.json
      lines: "985-999"
    - path: SoT/.codex/plugins/marketplace.json
      lines: "1-36"
    - path: SoT/.codex/config.toml
      lines: "40-44"
    - path: SoT/toolchain.json
      lines: "1-38"
  updated: "2026-11-07"
---

# Plugin Bootstrap

Claude plugin reconcile is seven logical passes, `enabledPlugins` has
true/false/absent semantics, and Codex marketplace merging is additive with SoT
entries winning on name collisions.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
The `--prune` keep test for Claude plugins is key presence, not truthiness.
A plugin declared as `"id@marketplace": false` is installed and kept; only an
absent key is removed by prune. A plugin that this run opts in with
`--claude-plugin` is also kept.
(verify: `bunx vitest run cli/test/unit/claudeSettingsTruth.test.ts -t "prune keeps an explicitly requested optional plugin and its marketplace"`)
</constraint>

<constraint>
Never remove the `claude-plugins-official` marketplace. Prune protects it even
when it removes extra marketplaces. It is not built in: Claude Code registers
it only in an interactive session, so pass 1 adds it on demand.
(verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "adds the official marketplace on a fresh home before installing its plugins"`)
</constraint>

<constraint>
Marketplace prune must preserve any marketplace referenced by a project- or
local-scope install record. Removing that shared cache invalidates the scoped
installation even when the user-scope uninstall is correctly scoped.
(verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "keeps marketplaces used by project-scoped plugins during prune"`)
</constraint>

<constraint>
The enabled-state reassert pass runs on every sync that reaches the plugin
passes (not dry-run, and not when `claude` or `git` is missing), after the
install/uninstall work. Fresh `claude plugin install` enables plugins as a side
effect, so SoT `false` entries must be disabled through the Claude CLI before
the JSON normalization.
(verify: `bunx vitest run cli/test/unit/claudeSettingsTruth.test.ts -t "disables a SoT-false plugin at user scope from a neutral directory"`)
</constraint>

## When To Use

- Adding, removing, or changing `enabledPlugins` entries.
- Changing `extraKnownMarketplaces` or marketplace removal protection.
- Debugging why a plugin survived `--prune`.
- Changing optional `--claude-plugin=<name>` behavior.
- Changing Codex personal marketplace merge or `codex plugin add` refresh.
- Changing LSP binary bootstrap for official Claude LSP plugins.

## Claude Tri-State

`true` and `false` keys are both installed by the kit and both survive
`--prune`; `false` is installed but globally disabled. An absent key is not
installed, and `--prune` removes its user-scope install. The full value matrix,
the per-project enable pattern, and the removal procedure live in
`.agents/skills/plugin-bootstrap-context/references/tri-state-semantics.md`.

Plugin IDs must use `<name>@<marketplace>`; the passes derive the marketplace
from the text after the last `@`. Setting a plugin to `false` does not remove it.

## Seven Logical Passes

All live in `claudePluginPasses.ts syncPlugins(ctx, claudeDir)`:

1. Add missing marketplaces from `extraKnownMarketplaces`. When a kit-owned
   plugin id ends in `@claude-plugins-official` and that marketplace is absent
   from `known_marketplaces.json`, also run
   `claude plugin marketplace add anthropics/claude-plugins-official`.
2. Install SoT-declared plugins missing a user-scope install record. Before
   the first install from a marketplace, refresh that source marketplace once
   per run, and only when the marketplace is present.
3. Refresh kit-owned marketplace manifests unless `ctx.skipPluginRefresh` is
   set.
4. Update kit-owned plugins that have a user-scope install record, best-effort,
   unless `ctx.skipPluginRefresh` is set.
5. On `ctx.prune`, uninstall user-scope plugins that are not kit-owned.
6. On `ctx.prune`, remove extra marketplaces except the protected official
   marketplace, kit-owned marketplaces, and marketplaces used by project/local
   installs.
7. Reassert SoT enabled state: disable SoT-`false` plugins with
   `claude plugin disable <id> --scope user`, then normalize deployed
   `enabledPlugins` so SoT-declared values win and user-only keys survive.

Kit-owned plugin ids are the SoT `enabledPlugins` keys plus this run's
`--claude-plugin` opt-ins. Kit-owned marketplaces are the SoT
`extraKnownMarketplaces` keys plus the source marketplace of each kit-owned
plugin id. Pass-by-pass detail lives in
`.agents/skills/plugin-bootstrap-context/references/seven-pass-flow.md`.

Every `claude plugin` command runs through `claudePluginPasses.ts cli` with the
system temp directory (`os.tmpdir()`) as its working directory. Project and
local settings in the directory where the user runs sync therefore never
change. Pass 6 keeps its unscoped `claude plugin marketplace remove <name>`.

A failed marketplace or plugin command never aborts the remaining passes. Pass
its warning through `failures.ts recordFailure`, which warns in place and
records the message so `syncDispatch.ts engineSync, failure ledger` lists it
under `--- Failures ---` and returns exit 1. Keep the aggregate
`N plugin operation(s) failed` roll-up a plain `warn`, because every counted
site already records itself. A missing CLI, missing git, and a missing toolchain
pin are warn-only skips with exit 0.
(verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "fails the sync without installing n8n if its marketplace cannot be added"`)

## Optional Plugins

`syncOptionalPlugins` consumes `ctx.claudePlugins`, populated by the repeatable
`--claude-plugin=<name>` flag. The allow-list is
`parseModifiers.ts KNOWN_CLAUDE_OPTIN_PLUGINS`, enforced by
`parseModifiers.ts parseClaudePlugin`.
(verify: `bunx vitest run cli/test/unit/modifierValidation.test.ts -t "rejects an invalid CLAUDE_PLUGINS token after a valid one"`)
The source list is the owner of the names; read it there and do not copy it
into docs.
(verify: `bun -e 'console.log((await import("./cli/src/engine-native/parseModifiers.ts")).KNOWN_CLAUDE_OPTIN_PLUGINS)'`)

An opt-in has three homes that must agree: its name in
`KNOWN_CLAUDE_OPTIN_PLUGINS`, its install/enable branch in
`claudeOptionalPlugins.ts syncOptionalPlugins` (plugin id plus marketplace repo,
empty when an earlier pass registers the marketplace), and its plugin id in the
`kitPluginIds` set of `claudePluginPasses.ts syncPlugins`. That set keeps the
plugin and its marketplace through `--prune`, and for a `@claude-plugins-official`
id it makes pass 1 add the official marketplace.
`claudeSync.ts` runs `syncPlugins` before `syncOptionalPlugins`.

Opt-in keys are absent from the SoT, so the opt-in is sticky. Only a `--prune`
run without that plugin's `--claude-plugin` flag removes an installed optional
plugin.

## LSP Server Channels

`syncLspServers` reads the SoT `enabledPlugins` keys, probes the binary each
LSP plugin needs, then delegates to one of two local install channels.

| Channel | Function | Serves |
|---------|----------|--------|
| npm global | `installNpmServers` | the `php-lsp` and `typescript-lsp` servers (the `lspPkg` calls in `syncLspServers`) |
| rustup component | `installRustAnalyzer` | the `rust-analyzer-lsp` server |

The npm channel installs the `verified` pin of each tool row in
`SoT/toolchain.json` and skips a package whose row has no pin. It skips the
typescript-language-server install when host Node is below the `node` row's
`floor`.
(verify: `bunx vitest run cli/test/unit/lspNodeFloor.test.ts -t "refuses the server install below the Node floor and names the remedy"`)
The rustup channel runs `rustup component add rust-analyzer`. Its
`rust-analyzer` row carries no verified pin, because the component version
follows the host Rust toolchain; the `bwrap` row takes the same stance for a
distro package.

## Codex Marketplace And Plugins

`syncMarketplace` merges `SoT/.codex/plugins/marketplace.json` into the personal
marketplace file. User entries survive, but on `.name` collision the SoT entry
wins by concatenating user entries first, repo entries last, then applying
reverse/unique/reverse semantics.

When the deployed file has a string `name` that differs from the SoT `name`,
`codexPlugins.ts syncMarketplace` does not merge or write the file. It warns
once: rename the marketplace to the SoT name or move the plugins, then re-run
sync. Codex takes the `@marketplace` part of a plugin id from that top-level
`name`. `syncMarketplace` then returns the SoT name, and `codexSync.ts` passes it
to `codexPlugins.ts syncPlugins`, which skips `codex plugin add` for each SoT id
whose `@marketplace` suffix is that SoT name, because Codex cannot resolve it.
Ids from other marketplaces are still added. It records no failure for the
skipped ids. The kit never forces the SoT name, because that would orphan the
user's existing `<plugin>@<user-name>` tables.
(verify: `bunx vitest run cli/test/unit/codexMarketplace.test.ts -t "leaves a differently named marketplace alone and adds no kit plugin"`)

`removeLegacyDocksMarketplace` cleans up the old configured Docks marketplace
when it points at the same Git source. `syncPlugins` parses enabled plugin
tables from `SoT/.codex/config.toml` with the private `enabledPluginIdsFromText`.
The exported `enabledPluginIds` is the file wrapper that `codexStatus.ts` uses to
count the enabled plugins of the deployed `~/.codex/config.toml` for the status
output. Ordinary `syncPlugins` runs `codex plugin add`
for each enabled id so installed plugin caches refresh. With `ctx.skipPluginRefresh`,
the supported `codex plugin list --json` inventory filters the operation to missing
ids. An unavailable or invalid inventory is a warn-only fallback, not a skip: it
records no ledger row, and the pass takes the full refresh path, where any
failed `codex plugin add` is recorded and fails the run.
(verify: `bunx vitest run cli/test/unit/codexRetiredPlugins.test.ts -t "refreshes enabled plugins when the CLI returns unusable inventory"`)

## Key Decisions

- User-scope install records matter. Project/local records do not satisfy the
  kit's global install contract.
  (verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "installs a user copy when a kit plugin exists only in a project"`)
- Project/local records protect their marketplace cache from prune even though
  they do not satisfy the kit's user-scope install contract.
- `false` entries are still installed because they support project-level enable.
- LSP binaries are installed when LSP plugin keys are present, regardless of
  truthiness, for the same project-enable reason. The rust channel is the one
  exception. `rustInstallable` requires both a missing `rust-analyzer` probe
  and a present `rustup` probe. A host without rustup gets one verbose-only
  note and no warning. That host is not counted toward `missingToolCount`,
  which is why `LSP server binaries present` still prints there.
  (verify: `bunx vitest run cli/test/unit/lspRustServer.test.ts -t "stays silent on a host without rustup"`)
- Codex config and marketplace deployment can proceed even when the Codex CLI is
  absent; plugin refresh degrades to a warning and manual command.

## Gotchas

- A marketplace pre-check detects name presence, not URL correctness; a bad URL
  under the same name must be removed manually before sync can re-add it.
- Re-disabling an already-disabled plugin can be a CLI error; guard before
  calling the disable verb.
- A project-level `enabledPlugins: true` override is ignored when the user-scope
  key is absent; a project-scope plugin installation is an independent record.
- Deleting a key from SoT `enabledPlugins` does not make the kit delete it from
  deployed settings, because the settings merge and pass 7 keep user-only keys.
  Withdrawn keys go through `claudeRemovals.ts REMOVED_MANIFEST.settingsKeys`;
  see the removal procedure in
  `.agents/skills/plugin-bootstrap-context/references/tri-state-semantics.md`.

## References

- `.agents/skills/plugin-bootstrap-context/references/seven-pass-flow.md` - pass-by-pass reconcile details.
- `.agents/skills/plugin-bootstrap-context/references/tri-state-semantics.md` - value matrix, prune behavior, and plugin removal.
