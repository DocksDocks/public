---
title: Remove the bash engine — EngineNative becomes the only engine
goal: Delete lib/*.sh and the bash legs of CI, converting the parity suites into golden-regression tests recorded from the parity-proven native engine, with the bash engine preserved at a git tag
status: planned
created: "2026-07-08T22:05:00-03:00"
updated: "2026-07-08T22:05:00-03:00"
started_at: null
assignee: codex (gpt-5.5 relay worker, isolated worktree branch; Claude session reviews)
tags: [engine, cleanup, typescript, ci]
affected_paths:
  - lib/
  - cli/src/engine.ts
  - cli/src/kitHome.ts
  - cli/test/
  - .github/workflows/parity.yml
  - .github/workflows/windows-smoke.yml
  - docks-kit
  - package.json
  - SoT/toolchain.json
  - .claude/skills/
  - .claude/agents/
  - .codex/agents/
  - README.md
  - AGENTS.md
  - CLAUDE.md
  - cli/docs/
related_plans: [windows-support]
review_status: null
---

## Goal

EngineNative has been the default engine on all platforms since the
windows-support step-6 flip, with full dry-run + mutation parity against
the bash engine (25 matrix rows + 7 TOML shapes, both prove-reds red) and
green CI on ubuntu-24.04 + windows-2025. The bash engine (`lib/*.sh`,
~1,800 lines) is feature-frozen and now costs double-maintenance: every
behavior change must be mirrored in both engines to keep parity
(demonstrated twice on 2026-07-08 — the missing-CLI warns and the codex
installer hints each required synchronized bash edits). This plan deletes
the bash engine, converts the parity suites into golden-regression tests,
and re-homes the documentation that cites `lib/*.sh`.

## Context

- **User decision (2026-07-08, verbatim):** "cant we go through the bash
  engine removal plan for now? … i cant do step 9 now." The removal
  proceeds WITHOUT the windows-support step-9 real-machine verify. The
  consequences are accepted explicitly:
  - `DOCKS_KIT_ENGINE=bash` stops being a per-machine revert path. Any
    post-removal engine issue (including whatever step 9 later surfaces on
    real Windows) is fixed FORWARD in EngineNative.
  - The bash engine remains recoverable at the `bash-engine-final` git tag
    (step 1) — archaeology and emergency use, not a supported path.
- **Execution model (user decision):** the codex relay worker implements
  this plan on an isolated git worktree branch (`bash-engine-removal`);
  the Claude session reviews the diff before it reaches main. Workers
  sharing the primary checkout have hijacked branches before — the
  worktree isolation is mandatory, and the worker must not touch main or
  push.
- **Goldens come from the NATIVE engine, not bash.** At the cut commit,
  parity CI proves native ≡ bash byte-for-byte, so a native snapshot IS
  the bash behavior. Recording from native makes goldens regenerable
  forever (`--update-goldens` + reviewed diff — standard snapshot-test
  workflow); recording from bash would make them unregenerable the moment
  bash is deleted.
- **What is NOT removed** (bash that isn't the engine):
  - Deployed hook/statusline assets (`SoT/.claude/statusline.sh`,
    `fetch-usage.sh`, `hooks/*.sh`) — they run under Claude Code's own
    Git Bash and still need `jq`; `SoT/toolchain.json` keeps its `jq`
    entry for them.
  - `cli/build-binaries.sh` (CI-only build script).
  - The `docks-kit` launcher (bash) — still the checkout entry point
    (binary-first, Bun bootstrap). Its escape-hatch fallback messages
    change (step 5): the no-Bun path becomes "download a release binary",
    not `bash lib/engine.sh`.
  - `install.sh` (Unix installer).
  - The harness stub scripts in `cli/test/` (bash shebang scripts spawned
    by the native engine on POSIX — they are test fixtures, not engine).
- **Known load-bearing references that break if missed:**
  - `cli/src/kitHome.ts` — `isKitHome()` requires `lib/engine.sh` to
    exist; must switch to a marker that survives (e.g. `SoT/` +
    `package.json`, or `SoT/` + `cli/src/main.ts`). Both the ancestor
    walk and the DOCKS_KIT_HOME error message cite it.
  - `cli/src/engine.ts` — `engine()`/`engineCapture()` bash branches and
    the `nativeSelected()` opt-out.
  - `package.json` `files` bundles `lib` — the npm package must stop
    shipping it.
  - `cli/test/unit/settings.test.ts` — the jq-differential oracles run
    the exact `lib/claude.sh` jq programs; the program text must be
    inlined into the test as the spec (jq stays a TEST-ONLY dependency).
  - The six kit-mechanic skills + five wrapper agents (+ `.codex/agents`
    twins) cite `lib/*.sh` functions throughout.

## Steps

| # | Task | Depends | Status |
|---|------|---------|--------|
| 1 | Tag the cut: `git tag bash-engine-final <pre-removal commit>` + push the tag. Record in this plan the tag SHA and the last full bash-vs-native parity evidence (local suite output + green parity.yml run id at that SHA) | — | planned |
| 2 | Golden conversion, landed BEFORE any deletion and proven able to fail: record goldens from the NATIVE engine into `cli/test/goldens/` (dry-run: normalized output per fixture×command; mutation: tree snapshots + argv logs + normalized output per matrix row and TOML shape). Rewrite `parity-dryrun.ts`/`parity-mutation.ts` (rename to `golden-dryrun.ts`/`golden-mutation.ts`) to compare native vs goldens; add `--update-goldens`; keep `--prove-red` (planted divergence = compare against a mismatched golden — must stay RED); TOML result invariants (scrub survival, .bak, single model line, user tables) stay as live assertions. Inline the jq program texts into `cli/test/unit/settings.test.ts` (jq = test-only dep; note it in the test header). Gate: golden suites green against live native, prove-reds red, and one deliberate native edit (scratch) makes them fail | 1 | planned |
| 3 | Delete the engine: `lib/engine.sh`, `lib/common.sh`, `lib/claude.sh`, `lib/codex.sh`, `lib/skills.sh`, `lib/toolchain.sh`. `cli/src/engine.ts`: drop the bash branches — `engine()` always runs `runEngineNative` in-process, `engineCapture()` keeps only the native child re-spawn; `DOCKS_KIT_ENGINE=bash` prints a clear error ("bash engine removed — recover at tag bash-engine-final") instead of silently running native. `cli/src/kitHome.ts`: marker becomes `SoT/` + `package.json`; update the error text. `main.ts` native-raw channel stays (harness) | 2 | planned |
| 4 | CI: delete `windows-smoke.yml` (guarded the frozen bash engine). `parity.yml` → golden regression: drop bash self-parity legs; run unit + golden-dryrun + golden-mutation + prove-reds on ubuntu-24.04 (goldens use the bash-script stubs, POSIX-only — unchanged constraint); keep the `native-windows` PowerShell job and `windows-entrypoints.yml` as the Windows coverage. Update the workflow header comments | 3 | planned |
| 5 | Package/launcher/toolchain: `package.json` `files` drops `lib`; `docks-kit` launcher fallback messages point at release binaries instead of `bash lib/engine.sh` (lines 5, 39, 52); `SoT/toolchain.json` `jq` note updated (needed by deployed hooks/statusline, no longer by the engine); grep for `engine.sh` in `install.sh`/workflows and fix stragglers | 3 | planned |
| 6 | Docs sweep: AGENTS.md (feature-freeze rule → removed-engine note; repo-layout table; escape-hatch row → release binaries; `bash lib/engine.sh` mentions), CLAUDE.md (setup block, session/permissions references to the escape hatch), README (quick start, command table, escape-hatch line, releases section), `cli/docs/` (install.md zero-dependency section → binaries; overview, sync-layers, flags, platforms mentions). Grep gate: zero `lib/engine.sh` / `lib/claude.sh` / `sync.sh` references outside `docs/plans/finished/`, CHANGELOG, and this plan | 3 | planned |
| 7 | Skills + agents re-home: the six kit-mechanic skills (`sync-orchestration-context`, `settings-merge-context`, `plugin-bootstrap-context`, `codex-config-merge-context`, `universal-skills-context`, `toolchain-context`) keep their semantic content (merge behavior, tri-state, seven passes, RTK ordering, gate policy — all still true of the TS port) but every `lib/*.sh` function citation and `metadata.source_files` entry is rewritten to the matching `cli/src/engine-native/*.ts` module/function; freeze banners removed; descriptions' trigger conditions updated to the TS paths. Same for the five wrapper agents in `.claude/agents/` and their `.codex/agents/*.toml` twins. `engine-native-context` updated: byte-parity contract → golden-regression contract, "bash engine frozen" → "bash engine removed at tag bash-engine-final" | 3 | planned |
| 8 | Verification + review: full local suite (unit, golden-dryrun, golden-mutation, both prove-reds, `bunx tsc --noEmit -p cli`); `docks-kit sync --dry-run` output byte-identical to the recorded golden (removal must not change behavior); real `sync claude` round-trip on this machine against a settings backup; compiled linux binary smoke (`status` with toolchain rows); CI green on the branch. Then the Claude session reviews the full diff before merge to main | 2–7 | planned |

## Acceptance criteria

- `git tag bash-engine-final` exists and is pushed; checking it out yields
  a working `bash lib/engine.sh sync --dry-run`.
- `ls lib/` after merge: only files that are NOT the engine remain (or the
  directory is gone if nothing remains).
- `bun cli/test/golden-dryrun.ts` and `bun cli/test/golden-mutation.ts`
  green; both `--prove-red` modes exit non-zero; `--update-goldens`
  regenerates byte-identical goldens on an unchanged engine.
- `DOCKS_KIT_ENGINE=bash docks-kit sync --dry-run` fails with the
  removed-engine message (exit 2), NOT a silent native run.
- `docks-kit sync --dry-run` output at the merge commit is byte-identical
  to the golden recorded at the cut commit (behavior unchanged by
  removal).
- `bunx tsc --noEmit -p cli` clean; parity.yml (golden) + native-windows +
  windows-entrypoints green on the PR branch.
- Grep gates: `grep -rn "lib/engine.sh\|lib/claude.sh\|lib/codex.sh\|lib/skills.sh\|lib/common.sh\|lib/toolchain.sh"`
  over the repo returns hits only in `docs/plans/`, CHANGELOG, and git
  history; `package.json` `files` has no `lib`.
- A fresh `bun add -g` install (packed tarball) still resolves kit-home
  and runs `models claude` + `toolchain check` (the kitHome marker change
  is covered by the existing windows-entrypoints bun-shim job).

## Failure modes / revert triggers

- Golden suites flap on a nondeterministic field (timestamps, ordering) →
  the goldens inherit the parity harness's normalization (CRLF, path
  scrubbing, LC_ALL=C); any NEW nondeterminism found during step 2 gets
  normalized there BEFORE deletion, while bash is still available to
  cross-check which side drifted.
- kitHome marker change breaks an install mode → covered by acceptance
  (bun-shim CI job + checkout smoke); revert is a one-line marker change.
- Post-merge engine bug with no bash fallback → fix forward in
  EngineNative; the golden suite localizes the regression. Emergency
  recovery: `git checkout bash-engine-final -- lib/` restores the engine
  verbatim (documented in the removed-engine error message).
- Step 9 of windows-support later fails on real Windows → same
  fix-forward path; the removal does not change EngineNative behavior
  (byte-identical goldens are an acceptance criterion).

## Open questions

- none — scope decisions above were made by the user on 2026-07-08
  (proceed without step 9; codex implements, Claude reviews).

## Review

(filled by plan-review on completion)

## Sources

- `cli/src/kitHome.ts` — `isKitHome()` requires `SoT/` + `lib/engine.sh`;
  read this session (the marker that must change).
- `docks-kit:5,39,52` — launcher escape-hatch fallback messages citing
  `bash lib/engine.sh`; grepped this session.
- `package.json` `files` — bundles `lib`; read this session.
- `.github/workflows/parity.yml` — bash self-parity legs + native legs +
  `native-windows` job; authored/edited this session.
- `cli/test/parity-mutation.ts`, `cli/test/lib/harness.ts` — the suites
  being converted; authored/edited this session (25 rows + 7 TOML ×2,
  stub overrides, PATH masking, prove-red).
- `cli/test/unit/settings.test.ts` — jq-differential oracles running
  `lib/claude.sh` jq programs; authored this session.
- windows-support plan steps 5–8 — parity evidence chain (green runs
  28978076251, 28980202087, 28980967423, 28981202277, 28981804635/44).
