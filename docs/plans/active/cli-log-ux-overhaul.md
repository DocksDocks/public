---
title: CLI log UX overhaul — verbosity discipline + Effect services (SOLID)
goal: Default runs print only real changes, actionable warnings with install hints, and the summary; no-op confirmations move behind --verbose via Effect Logger/DependencyManager/OSManager services.
status: planned
created: "2026-07-09T16:04:45-03:00"
updated: "2026-07-09T16:04:45-03:00"
started_at: null
assignee: null
tags: [cli, ux, logging, effect, solid]
affected_paths:
  - cli/src/engine-native/output.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine.ts
  - cli/src/main.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
related_plans: []
review_status: null
---

## Goal

A default `docks-kit sync` (and `toolchain`/`model`) run reads like a change report, not a transcript: lines appear only for **things that changed**, **things that are wrong or missing** (with the exact command to fix them), and the **final summary**. Everything that merely confirms the status quo ("already in sync", "already initialized", "present (vX)", "up to date") moves behind an explicit `--verbose` flag. The mechanism is not string-by-string tuning but a typed logging policy delivered through Effect services with SOLID boundaries — a `LoggerService` (leveled, injectable), a `DependencyManager` (single home for probe/version/install-hint per external tool), and an `OSManager` (single home for platform detection and OS-appropriate install commands).

## Context

- User decision (verbatim, 2026-07-09): "we get too many logs when running a command … we even log things like 'success ok already downloaded' which for the user isn't relevant, he would want like a warning when something isn't installed and how to install [it]". Also requested: Effect TS, a dependency manager, an OS manager ("maybe"), SOLID compliance.
- The CLI is already an Effect app at the rim (`@effect/cli` 0.75.2, `effect` 3.21.4, `@effect/platform-bun`), but `cli/src/engine-native/` is imperative sync TypeScript that writes ANSI lines directly to `process.stderr` through three module-scope functions in `output.ts` (`log`/`warn`/`err`, all unconditional). There is no verbosity control anywhere.
- ~51 `log()` call sites across the engine (25 claudeSync, 11 skillsSync, 10 codexSync, 3 toolchain, 1 codexToml, 1 claudeModel — re-derive: `grep -rc "log(" cli/src/engine-native/*.ts`). A significant fraction are no-op confirmations (inventory in Step 1).
- Missing-dependency messaging is inconsistent and duplicated: the git install hint string is copy-pasted verbatim in `claudeSync.ts` and `codexSync.ts`; tool probing lives in `toolchain.ts` for managed tools but ad-hoc in `skillsSync.ts` (agent-browser, Chrome, bun helpers) and in both sync pipelines (git).
- `process.platform` branching is scattered across 6+ engine files (codexSync, skillsSync, claudeSync, toolchain, exec) instead of one platform seam.
- Hard constraint: **golden regression is the engine contract** (`cli/src/engine-native/DESIGN.md`). Dry-run output, mutation logs, and exit codes are pinned byte-for-byte under `cli/test/goldens/`; `--update-goldens` is review-gated and intentional output changes must update goldens in the same reviewed diff; `--prove-red` must stay red. Every tier below therefore lands with its golden update in the same commit.
- Hard constraint: channel separation must survive — stdout is data (`echo`, dry-run lines, `--json`), stderr is logs; `engineCapture` in `cli/src/engine.ts` re-spawns a child to capture stdout and lets stderr pass through. The logger must never move log lines to stdout.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Audit**: inventory every `log`/`warn`/`err`/`echo` call site in `cli/src/engine-native/` into a table (file:line, message, classification: `change` / `no-op confirmation` / `warning` / `data` / `summary`), committed as `docs/plans/active/cli-log-ux-overhaul-audit.md` sidecar section appended to this plan's `## Notes`. Also inventory every external-tool probe + install-hint site. | — | planned |
| 2 | **Policy spec**: from the audit, write the log-policy contract into `cli/src/engine-native/DESIGN.md`: levels `error` > `warn` > `info` (changes + summary, default) > `verbose` (no-op confirmations, skips, left-as-is) > `debug` (argv traces); every `warn` for a missing/broken dependency MUST carry the OS-appropriate install command; stdout stays data-only. Add `--verbose` (`-v`) to the CLI layer and `DOCKS_KIT_VERBOSE=1` for the raw engine channel. | 1 | planned |
| 3 | **Research gate**: verify Effect 3.21 APIs before coding — `Effect.Service`/`Context.Tag` service definition, `Logger.minimumLogLevel`, custom logger construction, `ManagedRuntime` for imperative seams (use the effect-ts-specialist skill + current Effect docs; do not code from memory). Record chosen idioms in `## Notes`. | — | planned |
| 4 | **Tier 1 — LoggerService + reclassification**: introduce `cli/src/engine-native/logger.ts` defining a `Logger` interface (`change/warn/error/verbose/debug/data`) with a level-filtered ANSI implementation; `output.ts` becomes a thin compatibility shim over it (then is deleted once call sites migrate). Reclassify every call site per the Step-1 table: no-op confirmations → `verbose`, real mutations stay `info`, missing-dep warns gain hints. Thread verbosity from `parseArgs.ts` ctx. Update both goldens in the same commit; add a golden leg exercising `--verbose` so the demoted lines stay covered. | 2, 3 | planned |
| 5 | **Tier 2 — DependencyManager**: `cli/src/engine-native/deps.ts` (or `cli/src/services/deps.ts`) — one registry of external tools (git, claude, codex, rtk, bun, npx, agent-browser, Chrome-for-Testing, LSP binaries) with `probe()`, `installedVersion()`, and `installHint(os)`; `toolchain.ts`, `skillsSync.ts`, `claudeSync.ts`, `codexSync.ts` consume it — the duplicated git hint collapses to one definition. Missing-tool output becomes uniform: `[warn] <tool> not installed — <one-line install command>`. | 4 | planned |
| 6 | **Tier 3 — OSManager**: `cli/src/engine-native/os.ts` — one seam answering `platform()` (`linux/darwin/windows`), `packageManagerHint(pkg)` (winget/brew/apt), symlink strategy, shell-rc applicability; the scattered `process.platform` branches in sync modules route through it (pure-path helpers in `exec.ts` may stay). `DependencyManager.installHint` composes it. | 5 | planned |
| 7 | **Effect integration at the rim**: expose Logger/DependencyManager/OSManager as Effect services (`Effect.Service` tags + a live Layer) provided from `cli/src/engine.ts` / command handlers via `ManagedRuntime`, so `@effect/cli` commands consume the same services the engine uses; engine-native internals may keep synchronous calls behind the interfaces (incremental migration, not a big-bang rewrite). | 4, 5, 6 | planned |
| 8 | **Verify + docs**: full suite green (`bun run test:unit`, `golden:dryrun`, `golden:mutation`, `--prove-red` still red, `tsc --noEmit -p cli`); manual smoke: fresh-ish machine profile shows warnings + hints, second run prints only the summary; update `cli/docs/flags.md` + `overview.md` with `--verbose`; CHANGELOG entry. | 4–7 | planned |

## Acceptance criteria

- [ ] `DOCKS_KIT_ENGINE=native-raw bun cli/src/main.ts sync --dry-run` (and the non-dry path on an already-synced machine) prints **zero** "already …", "present (…)", "up to date", "left as-is" lines by default; the same run with `--verbose` prints them. Verify: run both, diff line sets.
- [ ] Removing a required tool from PATH (e.g. shadow `git`) yields exactly one `[warn] git not installed — <platform-correct command>` line, sourced from `DependencyManager`, on both Claude and Codex sync paths. Verify: `PATH=<stripped> … sync` on Linux shows the apt/pacman-style hint; the win32 branch is covered by a unit test.
- [ ] `grep -rn "process.platform" cli/src/engine-native --include="*.ts"` returns matches only inside `os.ts` (+ allowed pure path/exec helpers listed in the policy spec).
- [ ] `grep -rn "winget install Git.Git" cli/src` returns exactly one definition site.
- [ ] `bun run test:unit && bun run golden:dryrun && bun run golden:mutation` green; `--prove-red` legs still exit non-zero; goldens changed only in commits that also changed engine output (review-gated per DESIGN.md).
- [ ] `bun run typecheck` green; no `any`-typed service seams; services defined as Effect tags with a documented live Layer.
- [ ] stdout of `status --json` and dry-run byte-content is unaffected at default verbosity except lines the policy spec explicitly reclassifies (each such line named in the golden diff).

## Out of scope

- Reintroducing or changing the removed bash engine (DESIGN.md non-goal).
- New sync features, changed step ordering, or changed mutation behavior — this plan changes what is *printed*, not what is *done*.
- Porting engine-native to full Effect generators end-to-end (services at the seams only; deeper migration is a follow-up plan if wanted).
- Windows CI matrix changes beyond keeping existing workflows green.

## Open questions

- `osmanager-scope` (choice): OSManager as its own Tier 3 service now (recommended — the hint quality depends on it), or fold platform hints into DependencyManager and defer a dedicated OSManager until a second consumer appears. custom allowed.

## Self-review

- Actionability: each step names files and a verifiable output (table, spec section, golden diff, grep). ✓
- Dependency order: audit → policy → logger → deps → os → rim → verify; no forward references. ✓
- Evidence: all cited sites opened this session (see Sources). ✓
- Goal coverage: demotion (over-logging) = Steps 2/4; missing-warnings (under-logging) = Steps 2/5/6; Effect+SOLID = Steps 3–7. ✓
- Failure mode: golden suite is the revert trigger per step; each tier is one reviewable commit; `--prove-red` guards silent golden drift. ✓
- Guess → question: only OSManager scope was hedged by the user ("maybe") → open question above. ✓

## Review

(filled by plan-review on completion)

## Sources

- `cli/src/engine-native/output.ts` (whole file) — 3 unconditional emitters, no levels/DI; the root cause.
- `cli/src/engine-native/skillsSync.ts:106-108` — "Universal skills already in sync (N present)" logged as `[ok]` on no-op.
- `cli/src/engine-native/claudeSync.ts:120` ("RTK already initialized"), `:353`/`:378` ("already set … left as-is"), `:622` ("Plugins already in sync") — no-op confirmations at `[ok]`.
- `cli/src/engine-native/toolchain.ts:190` ("present"), `:218` ("up to date") — no-op confirmations; `:129-179` `gate()`/`ensure()` = existing probe/install orchestration DependencyManager builds on.
- `cli/src/engine-native/claudeSync.ts:533` + `codexSync.ts:401` — byte-identical git install hint, duplicated (DRY violation; DependencyManager target).
- `cli/src/engine-native/DESIGN.md` — golden-regression contract, `--update-goldens` review gate, prove-red, stdout/stderr channel contract, module map.
- `cli/src/engine.ts` — `engine`/`engineCapture` seam; stderr passthrough during capture (logger must stay on stderr).
- `cli/src/engine-native/index.ts` — `Ctx` env-driven flags (`DRY_RUN`, etc.) — pattern `DOCKS_KIT_VERBOSE` follows; summary/next-steps blocks stay stdout `echo`.
- `package.json` — effect 3.21.4 / @effect/cli 0.75.2 / platform-bun; scripts `test:unit`, `golden:dryrun`, `golden:mutation`, `typecheck`.
- `process.platform` scatter: `codexSync.ts:81-82,348,401`, `skillsSync.ts:141,207,233,325`, `claudeSync.ts:38,99,347,533`, `toolchain.ts:230`, `exec.ts:27,45` (re-derive: `grep -rn "process.platform" cli/src/engine-native`).

## Notes

- 2026-07-09: plan drafted from a live audit of the engine; user decisions recorded in `## Context`. Log-call counts are point-in-time — Step 1 re-derives them.
