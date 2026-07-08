---
title: EngineNative — TS engine port behind engine.ts; bash frozen; Windows native
goal: Port the sync engine to TypeScript behind cli/src/engine.ts with dry-run AND mutation parity gates, make it the default on all platforms (Windows included, no Git Bash), and freeze lib/*.sh as the no-Bun escape hatch
status: ongoing
created: "2026-07-08T15:12:05-03:00"
updated: "2026-07-08T17:10:00-03:00"
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
  - install.sh
  - package.json
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
Port module-by-module behind the existing `cli/src/engine.ts` seam
(`cli/src/engine.ts:10-29` — both `engine()` and `engineCapture()` spawn
`bash lib/engine.sh` today), gated by dry-run byte-parity AND real-run
mutation parity against the bash engine; once parity holds, EngineNative
becomes the default on all platforms (native PowerShell on Windows — no Git
Bash for the kit). `lib/*.sh` is feature-frozen (AGENTS.md § Engineering
rules; bug fixes only) and remains the no-Bun escape hatch until
deprecation is decided.

## Context

- Phase 1 (DONE, d270f63 + cdde75d): the bash engine was made
  Windows-correct under Git Bash first — keeps the escape hatch honest and
  shrank the port's risk surface. Red-teamed twice by a gpt-5.5 relay worker
  (round 1: 7 findings pre-start; round 2: 7 findings post-pivot — all
  folded in below).
- RTK research (2026-07-08): since rtk 0.37.2 the PreToolUse hook is a
  native binary command (`rtk hook claude` — no shell/jq), so the hook works
  on Windows; there is NO `--claude-md` mode in current RTK (stale kit-docs
  claim, corrected). Only the kit's auto-installer (bash script) is
  Unix-only → Windows warns with native install instructions
  (`lib/claude.sh:805-818`). Evidence: rtk README § Windows and the
  release notes at https://github.com/rtk-ai/rtk/releases/tag/v0.37.2.
- Symlink decision (user, 2026-07-08): detect and prefer real links —
  `skills::_link_or_copy` (`lib/skills.sh:38-55`). EngineNative mirrors it
  with `fs.symlink` + copy fallback.
- **Hook/statusline assets stay bash by design**: Claude Code on Windows
  itself requires Git Bash for its Bash tool, and deployed hook/statusline
  commands (`SoT/.claude/settings.json` hooks + statusLine; `statusline.sh`,
  `fetch-usage.sh`, `notify.sh`) execute through that same runtime.
  EngineNative removes Git Bash from the KIT's engine, not from Claude
  Code's own prerequisites. Step 9 verifies-or-skips each deployed command
  on the real machine; porting those assets is out of scope here.
- CI runner naming: `windows-latest` is a floating runner-image LABEL;
  consistent with the pin-never-float stance CI uses the pinned label
  **`windows-2025`** (image contents still patch weekly — labels only pin
  the major image).
- Engine selection: `DOCKS_KIT_ENGINE` env (`bash` | `native`) exists from
  the FIRST ported module — `native` is opt-in pre-flip (lets PowerShell CI
  exercise EngineNative before step 6), `bash` is the opt-out after.
- Interactive real-machine verify: the user tests on their own Windows
  machine later — manual gate, not a blocker for CI or the port.

## Phase 1 audit findings (all fixed; kept for the record)

| # | Surface | Resolution |
|---|---------|------------|
| A1 | No `.gitattributes` → CRLF checkouts break Git Bash | `.gitattributes` pins `docks-kit` + `*.sh` to LF (d270f63) |
| A2 | Launcher ignored `docks-kit-windows-x64.exe` | MINGW/MSYS/CYGWIN uname arm (d270f63) |
| A3 | bwrap reported missing / unknown-OS warn on Windows | report windows arm; bwrap known-skip; latent `|| return` set-e abort fixed (d270f63) |
| A4 | TS `homedir()` was `HOME ?? "~"` | `node:os` homedir (d270f63) |
| A5 | RTK premise stale — hook native since 0.37.2 | installer-only Windows gate; docs corrected (cdde75d) |
| A6 | Connector export reaches only Git-Bash-launched sessions | EngineNative handles Windows env natively (`setx`) — step 5(b) |
| A7 | `ln -s` copies under Git Bash | `skills::_link_or_copy` detect-and-prefer (cdde75d) |
| A8 | notify.sh | no blocker (falls through to exit 0) |

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Phase 1: bash engine Windows-correct under Git Bash (A1–A8) + bash feature-freeze recorded in AGENTS.md | — | done (d270f63, cdde75d) |
| 2 | CI smoke on `windows-2025` (Git Bash): `bash -n` all shell, `bash lib/engine.sh sync --dry-run` under a temp HOME, `toolchain check` asserting bwrap absent + no unknown-OS warn. Guards the frozen escape hatch | 1 | done (green run 28971828190; first run caught a real bug — Windows jq emits CRLF, fixed in 1d1e005) |
| 3 | EngineNative design note (committed text): module map — settings merge → native JSON; `~/.claude.json` + mcp merge; codex TOML merge → line-based TS port of the awk logic (no TOML lib — a library reformats user configs and breaks parity); plugin passes → `child_process` to the `claude` CLI; skills → `child_process` to `npx`/`npm`; toolchain gate → TS incl. the TTY prompt (`read -p` → TS prompt) and non-TTY/`--yes` branches; removals; deploy-time modifiers; **direct modes too**: `model` get/set, `toolchain check/ensure`, and every `engineCapture` consumer (`status` calls `engineCapture(["toolchain","check"])`). Plus the `DOCKS_KIT_ENGINE` selector design | 1 | done (cli/src/engine-native/DESIGN.md) |
| 4 | Parity harnesses, landed BEFORE any port and each proven able to fail once: **(a)** dry-run byte-parity over fixture HOMEs (fresh, existing-user-drift, invalid-JSON); **(b)** mutation parity — disposable HOMEs + stub `claude`/`codex`/`npx`/`npm`/`rtk`/`bun` binaries on PATH that record argv and simulate outputs; diff resulting files, `.bak` backups, snapshots, AND captured argv across `sync claude`, `sync codex`, `sync agents`, `--reconcile`, `--prune`, `--claude-plugin=…`, `model <tool> <v>`, `toolchain ensure` (non-TTY + `--yes` branches; interactive TTY-declined deferred to step 5's port of the prompt — headless harness has no TTY); **(c)** codex TOML fixture suite: top-level keys before/after comments, insertion before first table, `[features]` with only `use_legacy_landlock`, `[features]` with other keys, user-only tables preserved, SoT table replacement, dotted/quoted headers from the real SoT, `--codex-model` direct mode | 3 | done (cli/test/*; self-parity green: 21 dry-run pairs, 17 matrix + 14 TOML pairs; both prove-red RED as required; parity.yml CI on ubuntu-24.04 + windows-2025 — first windows leg caught a harness bug, fixed in 22c5c4a) |
| 5 | Port modules behind `cli/src/engine-native/`, one PR-sized commit each, gated by 4(a)+4(b): (a) scaffold + `DOCKS_KIT_ENGINE` selector + settings merge, (b) claude.json + connector env (Windows: `setx`), (c) codex TOML merge + rules/agents-md, (d) plugin passes, (e) skills + toolchain + removals + modifiers + direct modes. Bash stays the DEFAULT throughout; `DOCKS_KIT_ENGINE=native` opts in. Unit layer per the Effect standard (user decision 2026-07-08): vitest 3.2.7 + `@effect/vitest` 0.29.0 (exact pins), `it.effect` suites + jq-differential oracles in `cli/test/unit/`, run by parity.yml; the parity harnesses stay plain black-box scripts (they compare two child processes, not Effect code) | 4 | in-flight (5(a) scaffold+selector+settings merge: 3ba8b26) |
| 6 | Flip: `engine.ts` defaults to EngineNative on all platforms (`DOCKS_KIT_ENGINE=bash` opt-out); real `sync claude` + `model` round-trip verified on this Linux machine against a settings backup; mutation-parity suite green is a hard precondition | 5 | planned |
| 7 | Windows-native CI on `windows-2025` under PowerShell with `HOME` unset: `$env:DOCKS_KIT_ENGINE="native"; bun cli/src/main.ts sync --dry-run`, `status --json`, `plugins list`, `model claude` (get), `toolchain check` — exact commands in the workflow; runnable pre-flip via the selector | 5 | planned |
| 8 | Windows entrypoints: document + verify the supported Windows command surfaces — compiled `docks-kit-windows-x64.exe` (release asset; THE supported no-toolchain path), `bun add -g docks-kit` shim behavior on Windows (verify bun creates a working shim for the `#!/usr/bin/env bun` bin), `install.sh` explicitly documented Unix-only; README + platforms topic updated | 5 | planned |
| 9 | Real-machine interactive verify (user's own Windows machine, manual): `.exe` sync from native PowerShell; `%USERPROFILE%\.claude` loaded by Claude Code; rtk hook fires (`rtk gain` shows activity); each deployed hook/statusline command executed-or-intentionally-skipped and the outcome recorded here | 6,7,8 | planned (manual, user) |
| 10 | Docs + skills: platforms/README to "supported"; the five kit-mechanic bash skills get a feature-freeze banner (not deletion); new engine-native skill or references file | 6 | planned |

## Acceptance criteria

- Step 2: `windows-2025` Git Bash smoke green; log has no `bwrap` row and no
  "Unknown OS" warning.
- Step 4: both parity runners exit non-zero on an intentionally-broken
  fixture (proven once, then fixed); mutation harness compares files +
  backups + snapshots + recorded argv, not just stdout.
- Step 5 (each module): dry-run AND mutation parity green on all fixtures on
  linux + windows-2025.
- Step 6: mutation suite green → flip; on this machine
  `diff <(jq -S . ~/.claude/settings.json.bak) <(jq -S . ~/.claude/settings.json)`
  explainable purely by SoT changes; `DOCKS_KIT_ENGINE=bash` restores the old
  path; `docks-kit model claude opus` → set → flag-less sync reverts, via
  EngineNative.
- Step 7: PowerShell job green with `HOME` unset — every listed command
  resolves `%USERPROFILE%` paths; `toolchain ensure` gate branches behave
  (`--yes`, non-TTY pinned fallback) under the TS prompt implementation.
- Step 8: release `.exe` runs `sync --dry-run` on a clean Windows runner
  with no Bun/Git Bash preinstalled; `bun add -g` shim verified or its
  unsupported status documented.
- Step 9 (manual): user confirms Claude Code on Windows loads the synced
  config, the rtk hook fires, and hook/statusline commands work or are
  knowingly skipped.

## Failure modes / revert triggers

- Module port diverges on a fixture → parity harness blocks the commit; no
  revert needed (bash default until step 6).
- Post-flip regression on Linux/macOS → `DOCKS_KIT_ENGINE=bash` is the
  immediate per-machine revert; repo revert is one line in `engine.ts`.
- `claude`/`codex`/`npx` driven from TS `child_process` differ from bash
  invocation (quoting, TTY detection, exit codes) → the argv-recording stubs
  in 4(b) catch quoting; any REAL-run divergence reverts that module to the
  bash engine until diagnosed.
- TOML line-port corrupts a user config shape not in the fixture suite →
  `.bak` backups written before every codex merge (existing behavior, must
  be preserved by the port) are the recovery path; add the shape as a
  fixture before re-attempting.

## Open questions

- engine-bash-deprecation (`choice`, decide after step 7): keep `lib/*.sh`
  indefinitely as the no-Bun escape hatch (recommended: compiled binaries
  don't cover "clone on a bare box") | schedule deletion once binaries +
  npm cover all install paths | custom allowed.

## Mistakes & Dead Ends

- **2026-07-08T17:30:00-03:00**: parity harness normalized only the raw
  Windows temp-path spelling → on windows-2025 Git Bash printed MSYS forms
  (`/tmp/parity-home-X`, `/d/a/repo`) and every self-parity pair diverged on
  the random mkdtemp suffix → when comparing output produced *under Git
  Bash*, scrub every path spelling (raw, forward-slash, MSYS drive form,
  unique-basename fallback), and join PATH with `node:path.delimiter`,
  never a hardcoded `:` (22c5c4a).

## Sources

- `cli/src/engine.ts:10-29` — `engine()`/`engineCapture()` both spawn
  `bash lib/engine.sh`; the seam the port swaps.
- `cli/src/commands/model.ts:30-35,52-53`, `cli/src/commands/toolchain.ts:24-33`,
  `cli/src/commands/status.ts:45-65` — direct modes + `engineCapture`
  consumers the port must cover.
- `lib/engine.sh:65-111` (`engine::model`), `lib/engine.sh:114-145`
  (`engine::toolchain`) — bash direct modes.
- `lib/claude.sh:9-35` — the claude sync pipeline (rtk-first ordering,
  merge, modifiers-last invariants); `lib/claude.sh:632-640` — the real
  plugin passes dry-run never exercises; `lib/claude.sh:805-818` — RTK
  Windows installer gate.
- `lib/codex.sh:183-221` (deprecated-key scrub), `:224-275`
  (`_replace_top_level_setting`), `:298-325` (table merge) — the awk TOML
  behavior the line-based TS port must match.
- `lib/skills.sh:38-55` — `skills::_link_or_copy` (symlink-or-copy
  contract); `lib/skills.sh:99-117` — real `npx` skill installs skipped by
  dry-run.
- `lib/toolchain.sh:105-118` (TTY prompt), `:129-151` (ensure branches) —
  gate semantics incl. non-TTY pinned-verified fallback.
- `SoT/.claude/settings.json` hooks/statusLine entries + `statusline.sh` /
  `fetch-usage.sh` / `hooks/notify.sh` — bash assets that remain on Claude
  Code's own Git Bash runtime (out of port scope).
- RTK Windows evidence: rtk-ai/rtk README § Windows ("Since v0.37.2 the
  auto-rewrite hook runs as a native binary command (`rtk hook claude`) — no
  Unix shell, bash, or jq required");
  https://github.com/rtk-ai/rtk/releases/tag/v0.37.2.
- Red-team reviews: gpt-5.5 relay worker `codex-kit-review`, 2026-07-08,
  rounds 1 (7 findings) and 2 (7 findings) — both in the session transcript.

## Self-review

- Rescoped 2026-07-08 after the user challenged the hybrid; re-red-teamed
  post-pivot. Round-2 findings folded: step-7-before-flip fixed via the
  `DOCKS_KIT_ENGINE=native` pre-flip selector; dry-run-parity-as-oracle gap
  closed with the mutation-parity harness 4(b) as a hard flip precondition;
  Windows entrypoint story added (step 8); direct modes (`model`,
  `toolchain`, `engineCapture`) pulled into scope; hook/statusline assets
  given an explicit stays-on-Git-Bash strategy; codex TOML fixture suite
  enumerated 4(c); Sources upgraded to file:line + durable RTK URL.
- Dependency check: 3 → 4 → 5 → {6,7,8} → 9; CI guards both engines
  independently (2 = frozen bash, 7 = native).
- Cold handoff: step 3's committed design note is the prerequisite artifact
  for any step-5 executor; fixture list for 4(c) is enumerated in the step.

## Review

(filled by plan-review on completion)
