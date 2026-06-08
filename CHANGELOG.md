# Changelog

## 2026-06-08 — Opus 4.8 settings refresh

Audit of `SoT/.claude/` against the current Claude Code settings schema and Opus 4.8 behavior.

### settings.json

- **Version floor**: added `minimumVersion: "2.1.166"` — floors auto-updates and `claude update` so every synced machine carries the features the kit relies on (Opus 4.8 needs 2.1.154, `skillListingBudgetFraction` needs 2.1.129) plus the latest auto-mode/classifier hardening.
- **Permissions dedup**: removed the inert `Bash(xargs *)` from `permissions.allow` — it was already in `permissions.ask`, and precedence (deny > ask > allow) made the `allow` copy dead. Zero behavior change; xargs still routes through `ask`.

### Docs (CLAUDE.md)

- Corrected the `CLAUDE_CODE_MAX_OUTPUT_TOKENS` row: documented `64000` → actual `96000` (Opus 4.8's real output ceiling is 128K).
- Added env-table coverage for `CLAUDE_CODE_FORK_SUBAGENT` and a top-level-keys row for `minimumVersion`.
- Documented `autoMode.environment` as a per-machine (`settings.local.json`) lever for cutting auto-mode false positives.
- Recorded the deliberate **no-`fallbackModel`** decision (stay Opus-only; avoid mid-session prompt-cache cold-start).

### Considered, not adopted

- **`fallbackModel`** (v2.1.166): rejected — a mid-session Opus→Sonnet switch cold-starts the per-model prompt cache; the kit prefers a retried turn over a silent model swap.
- **`skillOverrides`** (v2.1.129): does not affect plugin skills (where the kit's effect-kit/docks duplication lives) and is buggy upstream (anthropics/claude-code#50631, #54996).
- **`attribution`**: the kit intentionally keeps the model-versioned `Co-Authored-By` trailer.

## Superseded snapshot (Opus 4.6 era) — Token-efficient configuration overhaul

> Historical record. Entries below predate the current kit: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=45` is now `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, effort is `xhigh` (not `high`), `CLAUDE_CODE_SUBAGENT_MODEL` is no longer set, and the command/score scripts have moved to the `docks` plugin.

Re-evaluation of the entire kit for token efficiency while preserving multi-agent pipeline quality.

### settings.json

- **Enable 1M context**: removed `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. 1M is now active by default on Max/Team/Enterprise plans for Opus 4.6.
- **Early auto-compact**: added `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=45`. Compacts at ~450K tokens on a 1M window, well before the ~400K context-rot threshold.
- **Effort level aligned**: `CLAUDE_CODE_EFFORT_LEVEL` changed from `max` to `high`. Saves significant tokens without sacrificing reasoning quality. Matches the top-level `effortLevel: "high"` setting.
- **Subagent model fully qualified**: `CLAUDE_CODE_SUBAGENT_MODEL` changed from `"sonnet"` to `"claude-sonnet-4-6"` to avoid alias-resolution risk.
- **Removed `showTurnDuration`** from settings.json (belongs in `~/.claude.json`, caused schema validation warnings). `sync.sh` writes it to the correct location.
- **SubagentStop hook**: now allows "no issues found" and mode-selection responses through the file:line quality gate.
- **SessionStart hook**: injects active config (context window, auto-compact %, effort level, thinking budget, subagent model) for visibility at session open.

### Commands (all 9)

- Stripped all inert `model="opus"` XML annotations from `<task>` blocks. These were text-only and had no programmatic effect on subagent routing — `CLAUDE_CODE_SUBAGENT_MODEL` is the actual control.
- Updated Model Tiering note in every command: all subagents use sonnet; orchestrator runs on Opus.
- Added `WebFetch`, `WebSearch` to Allowed Tools of `review.md`, `solid.md`, `test.md`, `fix.md`, `human-docs.md`, `docs.md`, `team.md`, `refactor.md`, and `security.md` (commands that instruct context7/WebFetch research).
- Added `Bash(rtk:*)` to every command's Allowed Tools and "Use ONLY" lines (the RTK PreToolUse hook rewrites bash commands to `rtk <cmd>`).
- `security.md`: removed dangling "offer to help fix specific issues" — command is read-only by design; users should run `/fix` for remediation.

### Scripts

- `sync.sh` **new**: auto-detecting portable sync entrypoint. Merges `settings.json` with explicit array concat+unique for permissions, writes `showTurnDuration` to `~/.claude.json`, and bootstraps RTK if missing. Flags: `--dry-run`, `--no-rtk`, `--force`.
- `guard-commands.sh`: auto-detects script dir (no hardcoded `/home/docks/...` path). Added: Phase Transition Protocol required for commands with 3+ phases; WebFetch required if research is instructed.
- `score-commands.sh`: auto-detects script dir. Flipped `model="opus"` reward → penalty (2pts if absent). Added WebFetch/Allowed-Tools consistency check.
- `statusline.sh`: fixed misleading `Xk/200k` header comment to `Xk/Xk` (runtime already computed dynamically).
- `fetch-usage.sh`: added numeric-range (0-100) validation before writing cache to prevent silent garbage writes on API schema changes.

### Repo hygiene

- `.gitignore` expanded (macOS junk, editor temp files, `node_modules`, `settings.json.bak`).
- `CHANGELOG.md` added (this file).
- `.github/workflows/validate.yml` added — runs guard + score on every push and PR.
- Root `CLAUDE.md` extended with Environment Variables reference, Troubleshooting, and `sync.sh` usage.
