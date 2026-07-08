# Dispatch Flow — docks-kit → lib/engine.sh

## Critical Constraints

- Mutation runs ONLY through `lib/engine.sh`. The typed CLI is a thin front: `cli/src/engine.ts` (the `engine` function) spawns `bash lib/engine.sh <args>` from `kitHome()` with inherited stdio.
- Library files are sourced INSIDE their SoT-presence conditional (engine::sync, the dispatch blocks), not at script top. Missing SoT directory = silent skip, not an error. This enables partial checkouts. Only `lib/common.sh` and `lib/toolchain.sh` are sourced unconditionally at the top of `lib/engine.sh`.

## Entry Chain

```
./docks-kit                          (launcher)
├── cli/dist/docks-kit-<os>-<arch>   (compiled binary — preferred when present; exec'd directly)
└── else: Bun from source
    ├── find_bun: PATH → ~/.bun/bin → ~/.local/bin; auto-installs Bun (download-then-run) when missing
    ├── bun install --frozen-lockfile when node_modules/ absent
    └── exec bun cli/src/main.ts "$@"
        └── @effect/cli root command (cli/src/main.ts) with subcommands:
            sync / model / models / toolchain / status / plugins / skills / docs
            └── mutating commands call engine(args)  (cli/src/engine.ts — the single seam)
                └── bash lib/engine.sh <args>   ← zero-dependency escape hatch starts HERE
```

`kitHome()` (cli/src/kitHome.ts) resolves the repo root: `DOCKS_KIT_HOME` env → nearest ancestor of cwd containing `SoT/` + `lib/engine.sh` → the package's own root.

## Engine Execution Order (`bash lib/engine.sh sync …`)

```
lib/engine.sh
├── source lib/common.sh              (unconditional, top of file)
├── source lib/toolchain.sh           (unconditional — toolchain::ensure available to every tool lib)
├── case dispatcher: model → engine::model | toolchain → engine::toolchain | sync/default → engine::sync
│
engine::sync
├── common::parse_args "$@"           (sets all flag vars; legacy flags exit 2 with rename hints)
├── common::preflight                 (jq for claude/codex targets; curl for claude)
├── common::validate_model_flags     (fail-fast BEFORE any mutation; SoT/models.json catalog)
│
├── [[ SYNC_CLAUDE && -d SoT/.claude ]] → source lib/claude.sh → claude::sync
│   ├── claude::sync_rtk              (FIRST: rtk init rewrites settings.json; toolchain::ensure rtk claude::_rtk_install)
│   ├── claude::sync_scripts          (statusline.sh, fetch-usage.sh, notification.mp3)
│   ├── claude::sync_hooks            (SoT/.claude/hooks/ → ~/.claude/hooks/)
│   ├── claude::sync_claude_md        (SoT/.claude/CLAUDE.md → ~/.claude/CLAUDE.md)
│   ├── claude::sync_settings         (dual-mode merge — normalizes whatever rtk init wrote)
│   ├── claude::sync_compact_window   (deploy-time: --claude-compact-window=<tokens>)
│   ├── claude::sync_permissive       (deploy-time: --claude-permissive)
│   ├── claude::sync_model            (deploy-time: --claude-model=<m>; 'default' deletes the key)
│   ├── claude::sync_claude_json      (showTurnDuration + mcpServers → ~/.claude.json)
│   ├── claude::sync_connector_env    (ENABLE_CLAUDEAI_MCP_SERVERS shell-rc export)
│   ├── claude::sync_removals         (removed-artifact manifest prune)
│   ├── claude::sync_plugins          (marketplace/plugin reconcile; PRUNE gates the uninstall passes)
│   ├── claude::sync_optional_plugins (CLAUDE_PLUGINS opt-ins via common::claude_plugin_wanted)
│   └── claude::sync_lsp_servers      (npm-global LSP binaries)
│
├── [[ SYNC_CODEX && -d SoT/.codex ]] → source lib/codex.sh → codex::sync
│   ├── codex::ensure_bubblewrap      (Linux-only; SKIP_RTK skips auto-install)
│   ├── codex::sync_config            (TOML merge: scrub → top-level → tables)
│   ├── codex::sync_model             (deploy-time: --codex-model=<m> via codex::_replace_top_level_setting)
│   ├── codex::sync_rules             (*.rules deployment)
│   ├── codex::sync_agents_md         (SoT AGENTS.md copy)
│   ├── codex::sync_marketplace       (jq unique_by merge)
│   ├── codex::remove_legacy_docks_marketplace (drop legacy configured marketplace)
│   └── codex::sync_plugins           (codex plugin add refresh)
│
├── [[ SYNC_AGENTS && -d SoT/.agents ]] → source lib/skills.sh → skills::sync
│   ├── skills::sync_universal        (npx skills add)
│   ├── [[ PRUNE ]] skills::reconcile_removals
│   ├── skills::sync_agent_browser_cli    (toolchain::ensure agent-browser skills::_agent_browser_install)
│   ├── skills::sync_effect_solutions_cli (toolchain::ensure effect-solutions skills::_effect_solutions_install)
│   └── skills::update_snapshot       (always last)
│
└── Summary/next_steps (engine::sync, the declare-F guards)
```

## Direct Modes (no full sync)

| Invocation | Function | Path |
|-----------|----------|------|
| `model claude` (get) | `engine::model` | jq/awk-reads deployed + SoT model, prints catalog |
| `model claude opus` (set) | `engine::model` | validate → `CLAUDE_MODEL=opus` → source lib/claude.sh → `claude::sync_model` (standalone-callable via its `${CLAUDE_DIR:-$HOME/.claude}` fallback) |
| `model codex gpt-5.5` (set) | `engine::model` | validate → `CODEX_MODEL=…` → source lib/codex.sh → `codex::sync_model` |
| `toolchain check` | `engine::toolchain` | `toolchain::report` doctor table |
| `toolchain ensure rtk` | `engine::toolchain` | source lib/claude.sh → `toolchain::ensure rtk claude::_rtk_install` |
| `toolchain ensure bun` | `engine::toolchain` | source lib/skills.sh → `skills::_bun_bootstrap` |
| `toolchain ensure effect-solutions` / `agent-browser` | `engine::toolchain` | source lib/skills.sh → `toolchain::ensure <tool> skills::_<tool>_install` |

## Idempotency Invariants

Every step is designed as a no-op when already applied:

| Step | Pre-check |
|------|-----------|
| `cp repo_settings user_settings` | `[[ ! -f "$user_settings" ]]` (claude::sync_settings) |
| `claude plugin marketplace add` | `jq -e '.[$n]' known_marketplaces.json` (claude::_plugins_add_marketplaces) |
| `claude plugin install` | `jq -e '.plugins[$n] // empty \| … \| any(.scope? == "user")'` — requires a **user-scope** install record, not merely any record (claude::_plugin_user_scope_installed, the `any(.scope? == "user")` test; called by claude::_plugins_install) |
| `npx skills add` | `[[ -d "$SKILLS_DIR/$basename" ]]` (skills::sync_universal) |
| `rtk init --global` | `[[ ! -f "$CLAUDE_DIR/RTK.md" ]]` (claude::sync_rtk, the RTK.md absence check) |

## New Tool Addition Checklist

1. Add `SoT/.<tool>/` directory with config files
2. Add `[[ SYNC_<TOOL> && -d "$REPO_DIR/SoT/.<tool>" ]]` block in `engine::sync`
3. Add `SYNC_<TOOL>=${SYNC_<TOOL>:-0}` to common.sh (flag-var init block)
4. Add the `<tool>` word to `common::select_target`
5. Add `<tool>::summary` + `<tool>::next_steps` declare-F guards to `engine::sync`
6. Add preflight deps for the new tool to `common::preflight`
7. Mirror the new target in the CLI: `VALID_TARGETS` + option wiring in `cli/src/commands/sync.ts`
