---
title: Windows support — verify Tier 1 (Git Bash), then Tier 2 TS engine port
goal: Make docks-kit work on Windows — first verify the documented-experimental Git Bash path on a real machine, then port the bash engine to TS behind the engine.ts seam for native PowerShell support
status: planned
created: "2026-07-08T15:12:05-03:00"
updated: "2026-07-08T15:12:05-03:00"
started_at: null
assignee: null
tags: [windows, engine, cli, follow-up]
affected_paths:
  - lib/
  - cli/src/engine.ts
  - SoT/toolchain.json
  - cli/docs/platforms.md
related_plans: [docks-kit-cli]
review_status: null
---

## Goal

The docks-kit CLI stack (see `docks-kit-cli`) ships Windows as
documented-experimental: the managed tools all run natively on Windows
(Claude Code requires Git Bash, so Git Bash is guaranteed present; Codex is
native PowerShell; RTK ships native binaries but its PreToolUse hook
mechanism is Unix-only), while the kit's bash engine has never run on a
Windows machine. This plan closes that gap in two tiers.

## Context

- Tier 1 rationale researched during `docks-kit-cli` (2026-07-08): Git Bash
  maps `$HOME` to `%USERPROFILE%` — the same `~/.claude` Claude Code on
  Windows uses; bubblewrap is already Linux-gated; RTK on Windows falls back
  to `--claude-md` mode (hooks are Unix-only, full hooks need WSL).
- Tier 2 was designed in from the start: `cli/src/engine.ts` is the single
  seam between the typed CLI and the bash engine, explicitly swappable
  (EngineBash now, EngineNative later). Settings merge = native JSON, TOML
  merge = a TS lib, plugin passes shell out to the cross-platform
  `claude`/`codex` CLIs.
- No Windows machine is available in the authoring environment — every
  verify step below needs a real Windows box (or a Windows CI runner).

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Audit `lib/*.sh` for Windows blockers under Git Bash: `uname -s` MINGW handling, per-OS gates (connector shell-rc export → `setx`, ffplay/notification skip, RTK hook skip + claude-md mode), path assumptions | — | planned |
| 2 | Implement the Tier 1 gates found in step 1; encode per-OS install/hook data in `SoT/toolchain.json` (`os` field already exists for report filtering) | 1 | planned |
| 3 | Verify Tier 1 on a real Windows machine: `./docks-kit sync --dry-run` then a real sync under Git Bash; confirm `~/.claude` lands in `%USERPROFILE%\.claude` and Claude Code picks it up | 2 | planned |
| 4 | Add a `windows-latest` GitHub Actions job (Git Bash) running `sync --dry-run` + `toolchain check` as a smoke gate | 3 | planned |
| 5 | Tier 2 design note: EngineNative module map (settings merge → JSON, codex TOML merge → TS TOML lib, plugin/skills passes → child_process to `claude`/`codex`/`npx`), parity-test strategy vs EngineBash dry-run output | 1 | planned |
| 6 | Tier 2 implementation behind `cli/src/engine.ts` (EngineBash stays the default on Linux/macOS; EngineNative activates on `process.platform === "win32"`), with byte-parity dry-run tests | 5 | planned |
| 7 | Update `cli/docs/platforms.md` + README platform table as tiers land (experimental → supported) | 3, 6 | planned |

## Acceptance criteria

- Tier 1: on a real Windows machine, `./docks-kit sync` under Git Bash exits 0
  and deploys `%USERPROFILE%\.claude` + `%USERPROFILE%\.codex` such that
  Claude Code and Codex both load the synced config; RTK is installed native
  with claude-md mode and no broken hook entry.
- Tier 1 CI: the `windows-latest` smoke job is green on `sync --dry-run` +
  `toolchain check`.
- Tier 2: `docks-kit sync --dry-run` via EngineNative produces the same step
  list as EngineBash on the same fixture HOME (modulo path separators), and a
  real sync on native PowerShell (no Git Bash) deploys both SoTs.
- Docs: platforms topic and README table state the shipped support level
  accurately at each milestone.

## Open questions

- windows-verify-machine (`text`): which Windows machine/VM will be used for
  step 3? (A `windows-latest` runner covers CI but not the interactive
  Claude-Code-picks-it-up check.)
- tier2-toml-lib (`choice`): TOML library for EngineNative's codex merge —
  `smol-toml` (recommended: small, maintained, round-trip friendly enough for
  line-oriented merge) | port the awk logic to line-based TS string handling
  (zero deps, preserves comments/format exactly like the bash engine) |
  custom allowed.

## Review

(filled by plan-review on completion)
