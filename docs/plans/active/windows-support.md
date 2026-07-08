---
title: Windows support — verify Tier 1 (Git Bash), then Tier 2 TS engine port
goal: Make docks-kit work on Windows — Tier 1 makes the bash engine correct under Git Bash (gates, launcher, CI smoke), Tier 2 ports the engine to TS behind the engine.ts seam for native PowerShell
status: ongoing
created: "2026-07-08T15:12:05-03:00"
updated: "2026-07-08T16:25:00-03:00"
started_at: "2026-07-08T16:25:00-03:00"
assignee: null
tags: [windows, engine, cli, follow-up]
affected_paths:
  - .gitattributes
  - docks-kit
  - lib/toolchain.sh
  - lib/codex.sh
  - lib/claude.sh
  - lib/skills.sh
  - cli/src/manifests.ts
  - cli/src/kitHome.ts
  - cli/src/engine.ts
  - SoT/.claude/settings.json
  - SoT/toolchain.json
  - .github/workflows/
  - cli/docs/platforms.md
related_plans: [docks-kit-cli]
review_status: null
---

## Goal

The docks-kit CLI stack ships Windows as documented-experimental: the managed
tools all run natively on Windows (Claude Code requires Git Bash, so Git Bash
is guaranteed present; Codex is native PowerShell; RTK ships native binaries
but its PreToolUse hook mechanism is Unix-only), while the kit's engine has
never run on a Windows machine. Tier 1 makes the bash engine correct under
Git Bash with a `windows-latest` CI gate; Tier 2 ports the engine to TS
behind the `cli/src/engine.ts` seam for native PowerShell.

## Context

- Drafted 2026-07-08; red-teamed the same day by a gpt-5.5 session-relay
  worker (7 findings, all folded into the steps below) plus a supplementary
  audit (symlinks, connector export, notification hook).
- Git Bash maps `$HOME` to `%USERPROFILE%` — the same `~/.claude` Claude Code
  on Windows uses. bubblewrap is Linux-gated in `codex::_bwrap_supported_os`,
  but Windows falls into its unknown-OS warn arm rather than a known skip.
- No Windows machine is available in the authoring environment. Step order
  is arranged so CI (`windows-latest`) gates land without one; only the
  interactive verify step blocks on the machine decision.

## Audit findings (step 1 output, 2026-07-08)

| # | Surface | Blocker | Fix step |
|---|---------|---------|----------|
| A1 | No `.gitattributes`; shebang entrypoints (`docks-kit:1`, `lib/engine.sh:1`) | `core.autocrlf=true` checkout → `/bin/bash^M` before any logic runs | 2 |
| A2 | `docks-kit:10-16` maps only Linux/Darwin unames; Bun fallback is Unix-shaped | Windows checkout ignores its own `docks-kit-windows-x64.exe`; fresh machine hits the Unix Bun installer | 3 |
| A3 | `lib/toolchain.sh` report filters only `Linux*`/`Darwin*`; `codex::_bwrap_supported_os` treats Windows as unknown; codex dry-run prints the bwrap line before OS detection | `toolchain check` on Windows lists `bwrap` missing; sync warns "Unknown OS" | 4 |
| A4 | `cli/src/manifests.ts` `homedir()` = `process.env["HOME"] ?? "~"` | Native PowerShell: `status`/`plugins list`/`skills list` read literal `~/...` | 5 |
| A5 | SoT settings always deploy `hooks.PreToolUse[].command = "rtk hook claude"`; `claude::sync_rtk` always runs the Bash bootstrap when not skipped | Windows deploy carries a broken hook entry; RTK's supported Windows mode is `--claude-md` (needs upstream source citation) | 6 |
| A6 | `claude::sync_connector_env` writes shell rc files (`.zshrc`/`.bashrc`/…) | Only Git-Bash-launched sessions see `ENABLE_CLAUDEAI_MCP_SERVERS`; PowerShell-launched Claude Code needs `setx` | 7 |
| A7 | `ln -s` in `skills::heal_claude_symlink` + `~/.local/bin` links | Git Bash `ln -s` copies by default (real symlinks need MSYS=winsymlinks:nativestrict + Developer Mode) → silent drift | 7 |
| A8 | `SoT/.claude/hooks/notify.sh` | None — every player probe falls through to `exit 0` | — |

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Audit `lib/*.sh` + launcher + TS for Windows blockers (table above; base evidence in ## Sources) | — | done (codex red-team + supplementary audit, 2026-07-08) |
| 2 | `.gitattributes`: `docks-kit`, `*.sh`, hook/status scripts pinned `text eol=lf`. Verify: fresh clone with `core.autocrlf=true` in a container → `bash -n docks-kit` clean | 1 | done (see Notes) |
| 3 | Launcher Windows arm: map `MINGW*|MSYS*|CYGWIN*` unames → `docks-kit-windows-x64.exe`; leave Bun fallback documented-Unix (Windows binary is the supported path). Verify: `KIT_BIN` case covers `uname -s` outputs `MINGW64_NT-10.0` | 1 | done (see Notes) |
| 4 | OS normalization: `toolchain::report` skips `os: linux` tools on Windows unames; `codex::_bwrap_supported_os` returns known-skip (no warn) for `MINGW*|MSYS*|CYGWIN*`; bwrap dry-run echo moves behind the OS gate. Verify: stubbed `uname` test shows bwrap omitted + no unknown-OS warn | 1 | done (see Notes) |
| 5 | Cross-platform home in TS: `node:os` `homedir()` replaces the `HOME ?? "~"` helper in `cli/src/manifests.ts`. Verify: `bunx tsc` clean; `env -u HOME docks-kit status` on Linux still resolves | 1 | done (see Notes) |
| 6 | RTK Windows strategy (research first): cite the upstream doc for `--claude-md` mode; OS-gate so a Windows sync deploys no `rtk hook claude` PreToolUse entry (omit-or-remove on Windows only; Linux/macOS untouched). Verify: simulated Windows sync leaves `hooks.PreToolUse` free of rtk while Linux run keeps it | 1 | planned |
| 7 | Windows env + links: connector export via `setx ENABLE_CLAUDEAI_MCP_SERVERS false` when on Windows; decide symlink strategy for A7 (accept CLI copy behavior vs require Developer Mode) and document it. Verify: sync on Git Bash sets the user env var (readable from PowerShell) | 1 | planned |
| 8 | CI smoke: `windows-latest` job (Git Bash) running `bash -n` over all shell, `./docks-kit sync --dry-run` (temp HOME), `bash lib/engine.sh toolchain check`. Verify: job green; bwrap absent from output | 2,3,4 | planned |
| 9 | Real-machine interactive verify: full sync under Git Bash; `%USERPROFILE%\.claude` + `\.codex` picked up by Claude Code/Codex; no broken hook entries. BLOCKED on the windows-verify-machine open question | 6,7,8 | planned |
| 10 | Tier 2 design note: EngineNative module map (settings merge → JSON, codex TOML merge → TS, plugin/skills passes → child_process to `claude`/`codex`/`npx`), parity-test strategy vs EngineBash dry-run output | 1 | planned |
| 11 | Tier 2 implementation behind `cli/src/engine.ts` (EngineBash default on Linux/macOS; EngineNative on `process.platform === "win32"`), byte-parity dry-run tests on a fixture HOME | 10 | planned |
| 12 | Docs: platforms topic + README table updated as tiers land (experimental → CI-gated → supported) | 8,9,11 | planned |

## Acceptance criteria

- Tier 1 static: `git ls-files .gitattributes` non-empty and covers `docks-kit`
  + `*.sh`; `bash -n` clean across shell on a CRLF-defaulting checkout.
- Tier 1 CI: the `windows-latest` job is green on `bash -n` + `sync --dry-run`
  + `toolchain check`, with `bwrap` absent from the toolchain output and no
  "Unknown OS" warning in the sync output.
- Tier 1 real machine (blocked on the open question): `./docks-kit sync` under
  Git Bash exits 0; `%USERPROFILE%\.claude\settings.json` exists, is valid
  JSON, and contains no `rtk hook claude` PreToolUse entry; Claude Code loads
  the synced config.
- Tier 2: `docks-kit sync --dry-run` via EngineNative matches EngineBash on
  the same fixture HOME (modulo path separators); `docks-kit status`,
  `plugins list`, and `skills list` on native PowerShell (no `HOME` exported)
  read the same deployed paths sync writes.
- Docs state the shipped support level accurately at each milestone.

## Failure modes / revert triggers

- `.gitattributes` normalization rewrites working trees on existing clones
  (`git status` noise after pull) — announce in the commit message; revert
  trigger: any Linux/macOS script breakage attributable to renormalization.
- Launcher uname-arm edits: if the `.exe` selection misfires, the pre-change
  behavior (fall through to Bun) is the fallback — keep the fallback path
  intact so reverting is deleting the new case arm.
- OS-normalization edits touch shared report/codex paths — Linux dry-run
  output before/after must be byte-identical (revert trigger: any diff).
- EngineNative (Tier 2): activates only on `win32`, so Linux/macOS regression
  risk is nil by construction; revert = removing the platform branch.

## Open questions

- windows-verify-machine (`text`): which Windows machine/VM will be used for
  step 9? (`windows-latest` CI covers step 8 but not the interactive
  Claude-Code-picks-it-up check.)
- tier2-toml-lib (`choice`): TOML library for EngineNative's codex merge —
  `smol-toml` (recommended: small, maintained) | port the awk logic to
  line-based TS string handling (zero deps, preserves comments/format exactly
  like the bash engine) | custom allowed.
- symlink-strategy (`choice`, feeds step 7): accept Git Bash `ln -s` copy
  behavior with a doc note (recommended: zero setup, minor drift risk) |
  require Windows Developer Mode + `MSYS=winsymlinks:nativestrict` (real
  symlinks, setup burden) | custom allowed.

## Sources

- `docks-kit:10-16` — uname case maps only `Linux-*`/`Darwin-*`; `KIT_BIN=""`
  otherwise (A2). `cli/build-binaries.sh:11-17` builds
  `docks-kit-windows-x64.exe`.
- `lib/toolchain.sh` `toolchain::report`, the `os` filter — only `Linux*` and
  `Darwin*` arms (A3).
- `lib/codex.sh` `codex::_bwrap_supported_os` — `*)` arm warns "Unknown OS"
  (A3); `codex::ensure_bubblewrap` dry-run echo precedes the OS gate.
- `SoT/.claude/settings.json` `hooks.PreToolUse` — `rtk hook claude` entry
  deployed unconditionally by the settings merge (A5).
- `lib/claude.sh` `claude::sync_rtk` — Bash-oriented bootstrap always runs
  when not `--skip-rtk` (A5); `claude::sync_connector_env`, the rc-file
  candidates array — shell rc files only (A6).
- `lib/skills.sh` `skills::heal_claude_symlink` (`ln -s`) and the
  `~/.local/bin` links in `skills::_effect_solutions_install` (A7).
- `cli/src/manifests.ts` `homedir()` — `process.env["HOME"] ?? "~"` (A4).
- `SoT/.claude/hooks/notify.sh` — every player probe `|| exit 0`-shaped (A8).
- Red-team review: gpt-5.5 session-relay worker `codex-kit-review`,
  2026-07-08 (7 findings; severity-ranked list in the session transcript).

## Self-review

Drafted, then red-teamed by an independent gpt-5.5 worker against the
docs/plans rubric before starting. All 7 findings folded in: RTK hook gap
(→ step 6 + acceptance), TS home handling (→ step 5 + Tier 2 acceptance),
launcher Windows arm (→ step 3), toolchain/codex OS normalization (→ step 4),
CRLF protection (→ step 2), dependency reorder so CI doesn't block on the
machine decision (steps 8 vs 9), and the evidence/failure-mode contract
(→ ## Sources, ## Failure modes, executable acceptance).

## Notes

- 2026-07-08: steps 2–5 implemented at plan start (safe, Linux-verifiable
  subset); steps 6–7 need research/user decisions first (RTK `--claude-md`
  upstream citation; symlink-strategy open question).

## Review

(filled by plan-review on completion)
