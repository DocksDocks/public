---
title: EngineNative — TS engine port behind engine.ts; bash frozen; Windows native
goal: Port the sync engine to TypeScript behind cli/src/engine.ts with dry-run parity gates, make it the default on all platforms (Windows included, no Git Bash), and freeze lib/*.sh as the no-Bun escape hatch
status: ongoing
created: "2026-07-08T15:12:05-03:00"
updated: "2026-07-08T16:55:00-03:00"
started_at: "2026-07-08T16:25:00-03:00"
assignee: null
tags: [windows, engine, cli, typescript]
affected_paths:
  - cli/src/engine.ts
  - cli/src/engine-native/
  - cli/src/manifests.ts
  - lib/
  - .gitattributes
  - docks-kit
  - SoT/toolchain.json
  - .github/workflows/
  - cli/docs/platforms.md
  - AGENTS.md
related_plans: [docks-kit-cli]
review_status: null
---

## Goal

Every new engine capability since the CLI shipped has been written in bash —
the harder-to-maintain layer — while the typed CLI stayed a thin shell. User
decision 2026-07-08 (verbatim intent: "the cli was supposed to do the job"):
**promote the EngineNative TS port from Windows-alternative to THE engine.**
Port module-by-module behind the existing `cli/src/engine.ts` seam, gated by
dry-run byte-parity against the bash engine; once parity holds, EngineNative
becomes the default on all platforms (native PowerShell on Windows — no Git
Bash requirement). `lib/*.sh` is feature-frozen from d270f63's follow-up
commit onward (bug fixes only; AGENTS.md § Engineering rules records the
freeze) and remains the no-Bun escape hatch until deprecation is decided.

## Context

- Phase 1 (Tier 1, DONE): the bash engine was made Windows-correct under Git
  Bash first — those gates keep the escape hatch honest and shrank the port's
  risk surface. Red-teamed pre-start by a gpt-5.5 relay worker (7 findings,
  all folded in; severity list in the session transcript).
- RTK research (2026-07-08): since rtk 0.37.2 the PreToolUse hook is a
  native binary command (`rtk hook claude` — no shell/jq), so the hook works
  on Windows; there is NO `--claude-md` mode in current RTK (stale kit-docs
  claim, now corrected in cli/docs/platforms.md). Only the kit's
  auto-installer (bash script) is Unix-only → Windows warns with native
  install instructions (winget / release zip).
- Symlink decision (user, 2026-07-08): detect and prefer real links —
  `skills::_link_or_copy` tries `ln -s`, verifies with `[[ -L ]]`, accepts
  Git Bash's silent copy with a warn, `cp` as last resort. EngineNative
  mirrors this with `fs.symlink` + copy fallback.
- CI runner naming: `windows-latest` is a GitHub runner-image *label* that
  floats to the newest Windows Server image. Consistent with the kit's
  pin-never-float stance, CI uses the pinned label **`windows-2025`**
  (image contents still receive weekly patches — labels can only pin the
  major image, full runner determinism isn't available).
- Interactive real-machine verify: the user will test on their own Windows
  machine later — kept as a manual gate, not a blocker for CI or the port.

## Phase 1 audit findings (all fixed; kept for the record)

| # | Surface | Resolution |
|---|---------|------------|
| A1 | No `.gitattributes` → CRLF checkouts break Git Bash | `.gitattributes` pins `docks-kit` + `*.sh` to LF (d270f63) |
| A2 | Launcher ignored `docks-kit-windows-x64.exe` | MINGW/MSYS/CYGWIN uname arm added (d270f63) |
| A3 | bwrap reported missing / unknown-OS warn on Windows | `toolchain::report` windows arm; `codex::_bwrap_supported_os` known-skip; latent `|| return` set-e abort fixed (d270f63) |
| A4 | TS `homedir()` was `HOME ?? "~"` | `node:os` homedir (d270f63) |
| A5 | RTK premise stale — hook is native since 0.37.2 | installer-only Windows gate in `claude::sync_rtk`; docs corrected (this commit) |
| A6 | Connector export reaches only Git-Bash-launched sessions | superseded: EngineNative handles Windows env natively (`setx`) — step 5 |
| A7 | `ln -s` copies under Git Bash | `skills::_link_or_copy` detect-and-prefer (this commit) |
| A8 | notify.sh | no blocker (falls through to exit 0) |

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Phase 1: bash engine Windows-correct under Git Bash (audit A1–A8, gates, symlink strategy, RTK installer gate, doc corrections) + bash feature-freeze recorded in AGENTS.md | — | done (d270f63 + this commit) |
| 2 | CI smoke on `windows-2025` (Git Bash): `bash -n` all shell, `bash lib/engine.sh sync --dry-run` under a temp HOME, `toolchain check` asserting bwrap absent + no unknown-OS warn. Guards the frozen escape hatch | 1 | planned |
| 3 | EngineNative design note (committed to the plan or docs/): module map — settings merge → native JSON; `~/.claude.json` + mcp merge; codex TOML merge → line-based TS port of the awk logic (preserves comments/format; decision: no TOML lib — see resolved tier2-toml-lib); plugin passes 1–6 + optional plugins → `child_process` to `claude` CLI; skills passes → `child_process` to `npx`/`npm`; toolchain gate → TS with same manifest; removals manifest; deploy-time modifiers. Each module names its parity oracle | 1 | planned |
| 4 | Parity harness: fixture HOMEs (fresh machine, existing-user-drift, invalid-JSON) + a runner that diffs EngineBash vs EngineNative `sync --dry-run` output byte-for-byte (modulo path separators on win32). Lands BEFORE any module port; runs in CI on linux + windows-2025 | 3 | planned |
| 5 | Port modules behind `cli/src/engine-native/`, one PR-sized commit each, parity-gated: (a) config/dry-run scaffold + settings merge, (b) claude.json + connector env (Windows: `setx`), (c) codex TOML merge + rules/agents-md, (d) plugin passes, (e) skills + toolchain + removals + modifiers. Bash stays default throughout | 4 | planned |
| 6 | Flip: `engine.ts` routes to EngineNative on all platforms (env `DOCKS_KIT_ENGINE=bash` opt-out); bash remains the no-Bun escape hatch; real `sync` verified on this Linux machine against a settings backup | 5 | planned |
| 7 | Windows-native CI: run EngineNative `sync --dry-run` + `status` + `plugins list` on `windows-2025` under PowerShell (no Git Bash) with no `HOME` exported | 5 | planned |
| 8 | Real-machine interactive verify (user's own Windows machine, later): native PowerShell `docks-kit sync`; `%USERPROFILE%\.claude` picked up by Claude Code; rtk hook functional (`rtk gain` shows activity) | 6,7 | planned (manual, user) |
| 9 | Docs: platforms topic + README + the five kit-mechanic skills updated to the EngineNative reality (skills describing frozen bash logic get a freeze banner instead of deletion) | 6 | planned |

## Acceptance criteria

- Step 2: `windows-2025` smoke job green; job log contains no `bwrap` row and
  no "Unknown OS" warning.
- Step 4: parity runner exits non-zero on any EngineBash/EngineNative dry-run
  diff; CI proves it red on an intentionally-broken fixture once (then fixed).
- Step 5 (each module): parity green on all fixtures on linux + windows-2025.
- Step 6: `docks-kit sync claude` (real, this machine) via EngineNative leaves
  `diff <(jq -S . ~/.claude/settings.json.bak) <(jq -S . ~/.claude/settings.json)`
  explainable purely by SoT changes; `DOCKS_KIT_ENGINE=bash` restores the old
  path.
- Step 7: PowerShell job green with `HOME` unset — `status`, `plugins list`,
  `skills list` all resolve `%USERPROFILE%` paths.
- Step 8 (manual): user confirms Claude Code on Windows loads the synced
  config and the rtk hook fires.

## Failure modes / revert triggers

- Module port diverges on a fixture → the parity harness blocks the commit;
  no revert needed (bash still default until step 6).
- Post-flip regression on Linux/macOS → `DOCKS_KIT_ENGINE=bash` is the
  immediate per-machine revert; repo revert is flipping the default back in
  `engine.ts` (one line).
- `claude`/`codex` CLI behavior differences when driven from TS
  `child_process` vs bash (quoting, TTY detection) → parity fixtures must
  include a plugin-pass dry-run; any real-run divergence reverts that module
  to `child_process`-free bash passthrough until diagnosed.

## Open questions

- engine-bash-deprecation (`choice`, decide after step 7): keep `lib/*.sh`
  indefinitely as the no-Bun escape hatch (recommended: compiled binaries
  don't cover "clone on a bare box") | schedule deletion once binaries +
  npm cover all install paths | custom allowed.

## Sources

- `cli/src/engine.ts` — the seam: `engine()`/`engineCapture()` spawn
  `bash lib/engine.sh`; swapping the implementation here reroutes every CLI
  command.
- `lib/claude.sh` `claude::sync` — the 14-step claude pipeline EngineNative
  must reproduce (rtk-first ordering, merge, modifiers-last invariants).
- `lib/codex.sh` `codex::_replace_top_level_setting` /
  `merge_table_settings` — the awk TOML merge the TS port must match
  byte-for-byte on user configs.
- `lib/claude.sh` `claude::_plugins_*` passes 1–6 — shell out to the
  `claude plugin` CLI (already cross-platform).
- `lib/skills.sh` `skills::_link_or_copy` — the symlink-or-copy contract
  EngineNative mirrors with `fs.symlink`.
- RTK Windows evidence: rtk-ai/rtk README — "Since v0.37.2 the auto-rewrite
  hook runs as a native binary command (`rtk hook claude`) — no Unix shell,
  bash, or jq required"; supported-agents table lists Claude Code =
  PreToolUse hook (native binary). No `--claude-md` mode exists.
- Prior red-team: gpt-5.5 relay worker `codex-kit-review`, 2026-07-08.

## Self-review

- Rescoped 2026-07-08 after the user challenged the hybrid ("why are we
  maintaining via .sh instead of cli?") — EngineNative promoted from
  Windows-only Tier 2 to the primary engine; bash frozen.
- Resolved open questions folded in: tier2-toml-lib → line-based TS port of
  the awk logic (preserves user-config comments/format exactly, keeps parity
  achievable; a TOML lib would reformat); windows-verify-machine → user's own
  machine, manual step 8; symlink-strategy → detect-and-prefer (implemented).
- Dependency check: parity harness (4) lands before any port (5); flip (6)
  needs all modules; CI steps guard both engines independently (2 vs 7).
- Cold handoff: a fresh agent needs the module map from step 3 before
  touching step 5 — step 3's deliverable is committed text, not chat.

## Review

(filled by plan-review on completion)
