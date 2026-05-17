# Dispatch Flow — sync.sh Orchestrator

## Critical Constraint

Library files are sourced INSIDE their SoT-presence conditional (sync.sh:14-30), not at script top. Missing SoT directory = silent skip, not an error. This enables partial checkouts.

## Execution Order

```
sync.sh
├── source lib/common.sh          (sync.sh:9 — always, unconditional)
├── common::parse_args "$@"       (sync.sh:11 — sets all flag vars)
├── common::preflight             (sync.sh:12 — checks jq + curl)
│
├── [[ SYNC_CLAUDE && -d SoT/.claude ]] → source lib/claude.sh → claude::sync
│   ├── claude::sync_scripts      (statusline.sh, fetch-usage.sh, alert_bubble.mp3)
│   ├── claude::sync_hooks        (SoT/.claude/hooks/ → ~/.claude/hooks/)
│   ├── claude::sync_claude_md    (SoT/.claude/CLAUDE.md → ~/.claude/CLAUDE.md)
│   ├── claude::sync_settings     (dual-mode merge; lib/claude.sh:61-104)
│   ├── claude::sync_claude_json  (showTurnDuration → ~/.claude.json; lib/claude.sh:107-130)
│   ├── claude::sync_plugins      (six-pass reconcile; lib/claude.sh:132-232)
│   └── claude::sync_rtk          (RTK install + init gate; lib/claude.sh:234-288)
│
├── [[ SYNC_CODEX && -d SoT/.codex ]] → source lib/codex.sh → codex::sync
│   ├── codex::ensure_bubblewrap  (Linux-only; lib/codex.sh:49-102)
│   ├── codex::sync_config        (TOML merge; lib/codex.sh:162-184)
│   ├── codex::sync_rules         (*.rules deployment; lib/codex.sh:104-121)
│   ├── codex::sync_agents_md     (SoT AGENTS.md copy)
│   ├── codex::sync_rtk           (rtk init -g --codex; lib/codex.sh:133-160)
│   ├── codex::install_launcher   (managed-marker guard; lib/codex.sh:304-318)
│   ├── codex::sync_marketplace   (jq unique_by merge; lib/codex.sh:320-356)
│   └── codex::bootstrap_marketplace (DocksDocks/docks add; lib/codex.sh:358-379)
│
├── [[ SYNC_AGENTS && -d SoT/.agents ]] → source lib/skills.sh → skills::sync
│   ├── skills::sync_universal    (npx skills add; lib/skills.sh:32-96)
│   ├── [[ REMOVE_PLUGINS ]] skills::reconcile_removals (lib/skills.sh:185-234)
│   ├── skills::sync_agent_browser_cli (npm install -g; lib/skills.sh:140-183)
│   └── skills::update_snapshot   (always last; lib/skills.sh:236-247)
│
└── Summary/next_steps (sync.sh:35-54 — guarded by declare -F)
```

## Idempotency Invariants

Every step is designed as a no-op when already applied:

| Step | Pre-check |
|------|-----------|
| `cp repo_settings user_settings` | `[[ ! -f "$user_settings" ]]` (lib/claude.sh:73) |
| `claude plugin marketplace add` | `jq -e '.[$n]' known_marketplaces.json` (lib/claude.sh:159) |
| `claude plugin install` | `jq -e '.plugins[$n]' installed_plugins.json` (lib/claude.sh:172) |
| `npx skills add` | `[[ -d "$SKILLS_DIR/$basename" ]]` (lib/skills.sh:63) |
| `codex::install_launcher` | `grep -q 'Managed by DocksDocks'` (lib/codex.sh:311) |

## New Tool Addition Checklist

1. Add `SoT/.<tool>/` directory with config files
2. Add `[[ SYNC_<TOOL> && -d "$REPO_DIR/SoT/.<tool>" ]]` block in sync.sh (~line 20-30)
3. Add `SYNC_<TOOL>=${SYNC_<TOOL>:-0}` to lib/common.sh:4-11 block
4. Add `--<tool>` case to `common::select_target` (lib/common.sh:29-36)
5. Add `<tool>::summary` + `<tool>::next_steps` declare-F guards to sync.sh:35-54
6. Add preflight deps for the new tool to `common::preflight` (lib/common.sh:63-70)
