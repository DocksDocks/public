---
title: Add Codex Docks plugin sync
status: ongoing
created: 2026-05-11
updated: 2026-05-11
assignee: null
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: null
---

# Add Codex Docks plugin sync

## Context

The kit already syncs Claude Code config and installs the Docks plugin through Claude's plugin layer. Codex has a separate plugin system: runtime config and plugin enablement live under `~/.codex`, while personal marketplace metadata lives at `~/.agents/plugins/marketplace.json`. Adding a minimal `SoT/.codex/` lets `sync.sh` bootstrap the Docks skills-only Codex plugin from the same public kit.

## Scope

- Add `SoT/.codex/config.toml` with the Docks plugin enabled as `docks@docks`.
- Add `SoT/.codex/bin/codex`, a stable launcher for NVM-installed Codex CLIs in shells where NVM is not loaded.
- Import `@RTK.md` from `SoT/.codex/AGENTS.md` and let `rtk init -g --codex` generate `~/.codex/RTK.md` when missing, matching the Claude pattern where generated RTK content is not vendored.
- Add `SoT/.codex/plugins/marketplace.json` with a Codex marketplace entry that installs Docks from `https://github.com/DocksDocks/docks.git`.
- Extend `sync.sh` so it detects `SoT/.codex/`, creates `~/.codex/`, merges the Docks plugin enablement block additively, installs the launcher into `~/.local/bin/codex`, and deploys the personal marketplace file to `~/.agents/plugins/marketplace.json`.
- Attempt Codex CLI marketplace bootstrap with `codex plugin marketplace add DocksDocks/docks` when the CLI is available.

## Acceptance criteria

- [x] `./sync.sh --dry-run` previews both Claude and Codex sync work when both SoTs exist.
- [x] `./sync.sh --no-rtk` deploys `SoT/.codex/config.toml` plugin state without overwriting unrelated existing `~/.codex/config.toml` settings.
- [x] `./sync.sh --no-rtk` installs `~/.local/bin/codex` when Codex exists under NVM but is not otherwise on PATH.
- [x] `./sync.sh --no-rtk` preserves the SoT-managed Codex `AGENTS.md` while letting RTK generate version-current `~/.codex/RTK.md` when missing.
- [x] `./sync.sh --no-rtk` deploys `SoT/.codex/plugins/marketplace.json` to `~/.agents/plugins/marketplace.json`.
- [x] If `codex` is unavailable in `PATH`, sync prints the exact manual install command instead of failing the whole sync.
- [x] Docks remains documented as a skills-only plugin on Codex; Claude-only commands and subagents are not promised.

## Out of scope

- Refactoring `sync.sh` into `lib/common.sh`, `lib/claude.sh`, and `lib/codex.sh`; that remains covered by `20260511-sync-multi-tool-refactor.md`.
- Adding Codex equivalents for Claude hooks, status line scripts, RTK, or subagents.
- Installing the Codex CLI itself.

## Blockers

None.

## Notes

- OpenAI's Codex plugin docs distinguish Codex's home directory from marketplace discovery paths: `~/.codex` stores config, enablement, and plugin cache; `~/.agents/plugins/marketplace.json` is the personal marketplace catalog path.
- `codex plugin marketplace add DocksDocks/docks` is the preferred GitHub marketplace bootstrap when the CLI exists. The personal marketplace file is still useful for idempotent sync and machines where this shell cannot see the Codex CLI.
- Implementation pass on 2026-05-11 added `SoT/.codex/`, installed a stable `~/.local/bin/codex` launcher for NVM-based installs, ran `codex plugin marketplace add DocksDocks/docks`, and verified `codex plugin marketplace upgrade docks` succeeds with network access. The current Codex CLI exposes marketplace add/upgrade/remove, but no separate plugin install command; plugin enablement is represented by `[plugins."docks@docks"]` in `~/.codex/config.toml`.
- Native Linux binary installation was intentionally not added because this machine already has Codex installed by `npm install -g @openai/codex`; adding a second native binary would create PATH ambiguity.
- `rtk init -g --codex` was tested with a temporary `HOME` on 2026-05-11. It writes `~/.codex/RTK.md` plus an `@.../RTK.md` import in `~/.codex/AGENTS.md`; no Codex hook is installed. The kit does not vendor `RTK.md` because its content can change by RTK version. Instead, sync runs the init when `~/.codex/RTK.md` is missing, then restores the SoT-managed `AGENTS.md` with `@RTK.md`.
- Follow-up test: removed one line from real `~/.codex/RTK.md`, ran normal `./sync.sh`, and confirmed `rtk init -g --codex` restored the generated content while sync restored `~/.codex/AGENTS.md` back to the SoT-managed relative `@RTK.md` import. `./sync.sh --no-rtk` skips refresh but still restores `AGENTS.md`.
- Completed locally; leave in `ongoing/` until these changes are committed, then move to `finished/` with `ship_commit`.
