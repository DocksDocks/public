# Flag Matrix - docks-kit sync

This file is the only flag table for this skill. `parseArgs.ts parseArgs` owns
the engine vocabulary and `cli/src/commands/sync.ts syncCommand` owns the public
options (verify: `grep -n 'case "--' cli/src/engine-native/parseArgs.ts`).

## Critical Constraints

- `--reconcile` and `--prune` are orthogonal layers.
- Targets are positional words: `claude`, `codex`, `agents`, `omp`.
- Unknown flags and renamed legacy flags exit 2 before mutation.
- Bare value flags such as `--claude-model` exit 2 on both layers. The public
  CLI takes `--flag value` or `--flag=value`; the engine parser takes only
  `--flag=value`.
  (verify: `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "prints the catalog and exits 2 for a bare"` and `bunx vitest run cli/test/unit/argv.test.ts -t "rejects Claude model followed by another flag with a catalog and value grammar"`)

## Full Truth Table

| `--reconcile` | `--prune` | `--dry-run` | `claude` only | Effect |
|---------------|-----------|-------------|---------------|--------|
| 0 | 0 | 0 | 0 | Additive sync for the default target selection. |
| 0 | 0 | 1 | 0 | Preview the default target selection. |
| 1 | 0 | 0 | 0 | Reconcile settings layer; keep user-only keys. |
| 0 | 1 | 0 | 0 | Remove user-scope plugins and extra marketplaces not in SoT, and kit-managed skills not in the manifest. |
| 1 | 1 | 0 | 0 | Reconcile settings, then prune as in the row above. |
| 0 | 0 | 0 | 1 | Sync Claude only. |
| 1 | 0 | 0 | 1 | Reconcile Claude settings only. |
| 0 | 1 | 0 | 1 | Prune Claude plugin/marketplace layer only. |
| 1 | 0 | 1 | 0 | Preview reconcile without writes. |

## Flags

| Flag | `Ctx` field | Consumer | Notes |
|------|-------------|----------|-------|
| `--dry-run` | `ctx.dryRun` | every step | Preview only. |
| `--verbose` | `ctx.verbose` | `index.ts runEngineNative` logger | Also prints no-op confirmations. The public `sync` command also accepts `-v`. |
| `--reconcile` | `ctx.reconcile` | `claudeSettings.ts prepareClaudeSettings` | Settings layer only. |
| `--prune` | `ctx.prune` | `claudePluginPasses.ts syncPlugins` passes 5-6, `skillsSync.ts skillsSync` | See § Layer Scope By Flag. |
| `--skip-bubblewrap` | `ctx.skipBubblewrap` | `codexSync.ts ensureBubblewrap` | Skips the optional bubblewrap auto-install for the Codex Linux sandbox. |
| `--skip-plugin-refresh` | `ctx.skipPluginRefresh` | Claude, Codex, and omp plugin passes | Installs missing plugins but skips refresh-only calls. No command passes it automatically: `commands/update.ts updateSyncArgs` chains a flag-less sync. |
| `--claude-compact-window=<n\|Nk>` | `ctx.claudeCompactWindow` | `claudeSettings.ts syncCompactWindow` | Sets `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW`. `parseCompactWindow` accepts digits or digits plus `k`/`K`; anything else exits 2. |
| `--claude-permissive` | `ctx.claudePermissive` | `claudeSettings.ts syncPermissive` | Empties deployed `permissions.ask` and `permissions.deny`. |
| `--claude-plugin=<name>` | `ctx.claudePlugins` | `claudeOptionalPlugins.ts syncOptionalPlugins` | Repeatable. Values: `parseModifiers.ts KNOWN_CLAUDE_OPTIN_PLUGINS`; any other value exits 2. See § Sticky Opt-Ins. |
| `--claude-model=<m>` | `ctx.claudeModel` | `claudeSettingsModifiers.ts syncClaudeModel` | Sets deployed `.model`; `default` deletes it. Validated before sync mutations. |
| `--claude-effort=<level>` | `ctx.claudeEffort` | `claudeSettingsModifiers.ts syncClaudeEffort` | Sets deployed `.effortLevel`; `default` sets the SoT level. Levels: `efforts.ts CLAUDE_EFFORT_LEVELS`. |
| `--claude-advisor=<state>` | `ctx.claudeAdvisor` | `claudeSettingsModifiers.ts syncClaudeAdvisor` | `on` sets deployed `.advisorModel` to `opus`; `off` and `default` delete it. States: `efforts.ts CLAUDE_ADVISOR_STATES`. |
| `--codex-model=<m>` | `ctx.codexModel` | `codexToml.ts syncCodexModel` | Replaces deployed top-level `model = "..."`. The charset gate blocks TOML injection. |
| `--codex-effort=<level>` | `ctx.codexEffort` | `codexToml.ts syncCodexEffort` | Replaces deployed top-level `model_reasoning_effort`; `default` sets the SoT level. Levels: `efforts.ts CODEX_REASONING_EFFORTS`. |
| target word present | `ctx.targetFilterSet` | `parseArgs.ts applyDefaultSelection` | Once any target word appears, only named targets run. |

(verify: `bunx vitest run cli/test/unit/targetGrammar.test.ts -t "rejects invalid native modifier"` and `bunx vitest run cli/test/unit/engine-di.test.ts -t "turns the deployed advisor on and removes it for off and default without losing user keys"`)

Default target behavior: when no target word is present, `parseArgs.ts
applyDefaultSelection` selects the stored kit.db harness selection. When no
selection is stored, it selects `harnesses.ts LEGACY_SELECTION`.

Model-flag validation rules live in
`.agents/skills/sync-orchestration-context/SKILL.md` § Model Validation.

## Layer Scope By Flag

| Layer | `--reconcile` | `--prune` | Default |
|-------|---------------|-----------|---------|
| `~/.claude/settings.json` | SoT keys win; permissions arrays replaced | No effect | Additive merge; permissions unioned |
| Claude plugins/marketplaces | No effect | Remove user-scope plugins and extra marketplaces absent from SoT, including hand-installed ones (`claudePluginPasses.ts syncPlugins`, passes 5-6) | Additive install/update |
| Codex personal marketplace/plugins | Additive merge still preserves user entries | No effect | Deploy and refresh enabled plugins; remove the legacy configured Docks marketplace |
| `~/.agents/skills/` | No effect | Remove snapshot-managed slugs absent from manifest | Additive install and symlink heal |

(verify: `bunx vitest run cli/test/unit/pluginRefresh.test.ts -t "keeps marketplaces used by project-scoped plugins during prune"`)

## Deploy-Time Modifiers

These § Flags entries are deploy-time modifiers: `--claude-compact-window`,
`--claude-permissive`, `--claude-model`, `--claude-effort`, `--claude-advisor`,
`--codex-model`, and `--codex-effort`. They mutate deployed config away from
the SoT. A later flag-less sync restores SoT values. `--claude-plugin` is not a
deploy-time modifier, because it is a sticky opt-in (§ Sticky Opt-Ins). It is
still an `engineCtx.ts ModifierFlag`, and `parseModifiers.ts addClaudePlugin`
records it for `MODIFIER_METADATA` validation.

`claudeSync` runs its modifiers after the base deploy. `codexSync` folds the
Codex values into the SoT text before the `syncConfig` merge. It then runs
`syncCodexModel` and `syncCodexEffort` after the merge.
`dispatch-flow.md` § Sync Execution Order describes this two-phase pattern.

## Sticky Opt-Ins

Optional Claude plugins are absent from the SoT. Once installed by
`--claude-plugin=<name>`, they persist through flag-less syncs and are removed
only by `--prune`. `claudeOptionalPlugins.ts syncOptionalPlugins` maps each
`KNOWN_CLAUDE_OPTIN_PLUGINS` value to its plugin ID and, where needed, its
marketplace (verify: `grep -n KNOWN_CLAUDE_OPTIN_PLUGINS cli/src/engine-native/parseModifiers.ts`).

## Gotchas

- Combining `--dry-run --reconcile --prune` previews both destructive layers.
