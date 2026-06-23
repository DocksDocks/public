# Dispatch Flow — sync.sh Orchestrator

## Critical Constraint

Library files are sourced INSIDE their SoT-presence conditional (sync.sh (SoT-presence dispatch blocks)), not at script top. Missing SoT directory = silent skip, not an error. This enables partial checkouts.

## Execution Order

```
sync.sh
├── source lib/common.sh          (sync.sh (source lib/common.sh) — always, unconditional)
├── common::parse_args "$@"       (sync.sh (common::parse_args call) — sets all flag vars)
├── common::preflight             (sync.sh (common::preflight call) — checks jq + curl)
│
├── [[ SYNC_CLAUDE && -d SoT/.claude ]] → source lib/claude.sh → claude::sync
│   ├── claude::sync_scripts      (statusline.sh, fetch-usage.sh, alert_bubble.mp3)
│   ├── claude::sync_hooks        (SoT/.claude/hooks/ → ~/.claude/hooks/)
│   ├── claude::sync_claude_md    (SoT/.claude/CLAUDE.md → ~/.claude/CLAUDE.md)
│   ├── claude::sync_settings     (dual-mode merge)
│   ├── claude::sync_claude_json  (showTurnDuration → ~/.claude.json)
│   ├── claude::sync_plugins      (six-pass reconcile)
│   └── claude::sync_rtk          (RTK install + init gate)
│
├── [[ SYNC_CODEX && -d SoT/.codex ]] → source lib/codex.sh → codex::sync
│   ├── codex::ensure_bubblewrap  (Linux-only)
│   ├── codex::sync_config        (TOML merge)
│   ├── codex::sync_rules         (*.rules deployment)
│   ├── codex::sync_agents_md     (SoT AGENTS.md copy)
│   ├── codex::sync_marketplace   (jq unique_by merge)
│   ├── codex::remove_legacy_docks_marketplace (drop legacy configured marketplace)
│   └── codex::sync_plugins       (codex plugin add refresh)
│
├── [[ SYNC_AGENTS && -d SoT/.agents ]] → source lib/skills.sh → skills::sync
│   ├── skills::sync_universal    (npx skills add)
│   ├── [[ REMOVE_PLUGINS ]] skills::reconcile_removals
│   ├── skills::sync_agent_browser_cli (npm install -g)
│   └── skills::update_snapshot   (always last)
│
└── Summary/next_steps (sync.sh (summary/next_steps declare-F guards) — guarded by declare -F)
```

## Idempotency Invariants

Every step is designed as a no-op when already applied:

| Step | Pre-check |
|------|-----------|
| `cp repo_settings user_settings` | `[[ ! -f "$user_settings" ]]` (claude::sync_settings) |
| `claude plugin marketplace add` | `jq -e '.[$n]' known_marketplaces.json` (claude::_plugins_add_marketplaces) |
| `claude plugin install` | `jq -e '.plugins[$n]' installed_plugins.json` (claude::_plugins_install) |
| `npx skills add` | `[[ -d "$SKILLS_DIR/$basename" ]]` (skills::sync_universal) |

## New Tool Addition Checklist

1. Add `SoT/.<tool>/` directory with config files
2. Add `[[ SYNC_<TOOL> && -d "$REPO_DIR/SoT/.<tool>" ]]` block in sync.sh (SoT-presence dispatch blocks)
3. Add `SYNC_<TOOL>=${SYNC_<TOOL>:-0}` to common.sh (flag-var init block)
4. Add `--<tool>` case to `common::select_target`
5. Add `<tool>::summary` + `<tool>::next_steps` declare-F guards to sync.sh (summary/next_steps declare-F guards)
6. Add preflight deps for the new tool to `common::preflight`
