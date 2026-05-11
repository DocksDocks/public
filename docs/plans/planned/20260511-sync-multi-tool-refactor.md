---
title: Split sync.sh into lib/ and add Codex SSOT scaffolding
status: planned
created: 2026-05-11
updated: 2026-05-11
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: null
---

# Split sync.sh into lib/ and add Codex SSOT scaffolding

## Context

The AGENTS.md bridge (landed 2026-05-11) makes the project conceptually multi-tool, but `sync.sh` is still Claude-only — a 320-line monolith that mixes orchestration with Claude-specific bootstrap (RTK install, `claude plugin` CLI calls, `~/.claude.json` updates, hook script copy). To actually support `SoT/.codex/` per the AGENTS.md plan, the script needs an SRP-aligned split: shared primitives in `lib/common.sh`, per-tool bootstrap in `lib/<tool>.sh`, and a thin orchestrator that detects which SSOTs exist and dispatches.

User-confirmed design (this session): **detect-if-exists over `--codex` flag**; `--force` / `--remove-plugins` apply to all detected tools (or surface a per-tool variant later if surgical control is needed); each `lib/<tool>.sh` is independently sourceable for testing.

## Scope

- Create `lib/` directory at repo root.
- Extract shared primitives into `lib/common.sh`: jq deep-merge helpers (the `permissions.{allow,deny,ask}` concat+unique logic), argument parsing (`--dry-run`, `--force`, `--remove-plugins`, `--no-rtk`), dry-run rendering, settings-file diff utilities, ISO timestamp helper.
- Extract Claude-specific bootstrap into `lib/claude.sh`: RTK install/upgrade (the download-then-run installer + version check), the six idempotent plugin-install passes via `claude plugin` CLI, `showTurnDuration` → `~/.claude.json` patch, hook script copy from `SoT/.claude/hooks/` → `~/.claude/hooks/`, status line script copy.
- Refactor `sync.sh` to thin orchestrator (target ≤50 lines): `source lib/common.sh`; detect `SoT/.claude/` and `SoT/.codex/`; for each detected SSOT, `source lib/<tool>.sh` and call its public entry point (`claude::sync`, `codex::sync`).
- Add `SoT/.codex/` SSOT scaffolding: minimal initial set (placeholder `AGENTS.md`, `config.toml` skeleton, `agents/` placeholder, `.gitkeep`). Real Codex config content is out of scope — this plan establishes the directory structure only.
- Create `lib/codex.sh` with the Codex-specific install primitives (whatever Codex's plugin/config model turns out to be — research first). Public entry point: `codex::sync`.
- Wire `--no-rtk` to remain Claude-only (RTK is Claude-Code-specific; if `lib/claude.sh` is not loaded, the flag is a no-op).
- Update root `AGENTS.md`: remove "(planned)" qualifiers on `lib/`, `CODEX.md`, `SoT/.codex/` rows once they exist.
- Update root `CLAUDE.md` § Setup if any Claude-specific instructions moved into `lib/claude.sh` (the user-facing commands should not change).

## Acceptance criteria

- [ ] `./sync.sh --dry-run` runs on the current machine with **zero functional difference** from pre-refactor for the Claude-only flow (settings.json after = settings.json before)
- [ ] `./sync.sh` with both SSOTs present deploys both: `~/.claude/` updated, `~/.codex/` updated (or whatever Codex's deploy location is)
- [ ] `./sync.sh` with only `SoT/.claude/` present skips Codex entirely (no `lib/codex.sh` sourced)
- [ ] Each `lib/<tool>.sh` is sourceable in isolation (`bash -c 'source lib/claude.sh; declare -F'` lists its functions) — no cross-lib dependency leaks
- [ ] `lib/common.sh` contains no tool-specific identifiers (`.claude`, `.codex`, `RTK`, `claude plugin`)
- [ ] `--force` and `--remove-plugins` preserve their existing per-flag semantics for Claude, with equivalents for Codex
- [ ] `AGENTS.md` updated: the four "(planned)" markers (`lib/`, `CODEX.md`, `SoT/.codex/`, and `lib/<tool>.sh` references) all dropped
- [ ] Bash style: every lib uses `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, function-scoped `local`; functions are namespaced (e.g., `claude::install_rtk`, `codex::sync`) to prevent cross-lib name collisions
- [ ] No regression in plugin layer: `~/.claude/plugins/installed_plugins.json` is identical pre/post-refactor on a clean `--force --remove-plugins` run

## Out of scope

- Migrating `docs/roadmap/` entries to `docs/plans/` (separate plan — see `/docks:plan migrate-from-roadmap`).
- Writing the full Codex SSOT contents (this plan creates structure + minimal placeholders only; actual Codex config tuning is a follow-on).
- Building an RTK equivalent for Codex. RTK is a Claude Code PreToolUse hook integration; Codex's hook/proxy model is different and out of scope here.
- Cross-tool plugin marketplace unification. Each tool gets its own plugin layer; the libs do not try to share a marketplace abstraction.
- Renaming any existing `~/.claude/` artifacts — the deploy layout stays unchanged for Claude.

## Blockers

None at queue time. Likely to surface when picked up:

- Which Codex deployment target (Codex CLI standalone, VS Code Codex extension, etc.) we're scoping `lib/codex.sh` to. Research-first task before writing `lib/codex.sh`.

## Notes

- **Detect-if-exists pattern over `--codex` flag** — user-confirmed in the session that landed the AGENTS.md bridge (2026-05-11). Rationale: SSOT layout is already declarative; flags add cognitive load and bias the user toward thinking the tools are equal-priority rather than "whatever you put in `SoT/` gets deployed."
- **SOLID alignment** — `lib/<tool>.sh` files satisfy SRP (one tool's lifecycle each). `lib/common.sh` is the shared abstraction layer. Adding a future tool means dropping in `lib/<newtool>.sh` and an `SoT/.newtool/` directory; `sync.sh` itself does not change.
- **Idempotency contract** — every public function in every lib must be safe to re-run when SSOT has not changed (no-op). This is already true for the current Claude implementation; preserve it through the refactor.
- The previously-separate `docs/roadmap/` directory was migrated to `docs/plans/` on 2026-05-11; the `docs/roadmap/CLAUDE.md` convention doc remains as a historical artifact and can be removed once nothing references it.
- Plan-internal pre-flight check: before writing `lib/codex.sh`, validate the Codex install path on a clean machine (does `codex` ship a `~/.codex/` analog? Does it use AGENTS.md natively? What's the plugin equivalent?). Update Notes when answered.
- Related: AGENTS.md § Plans documents the Plans convention for future agents; this plan is the first one created under the convention.
