---
title: Full engine-internal DI — route all emissions and probes through ctx.services
goal: Every EngineNative log emission goes through ctx.services.logger and every external-tool presence/version decision through ctx.services.deps, so test layers can capture/stub a complete runEngineNative invocation; module-global logger bindings and direct commandExists/capture probes in sync modules are eliminated.
status: planned
created: "2026-07-09T18:37:21-03:00"
updated: "2026-07-09T18:37:21-03:00"
started_at: null
assignee: null
tags: [cli, effect, solid, di, follow-up]
affected_paths:
  - cli/src/engine-native/logger.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/claudeModel.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/index.ts
  - cli/test/unit/
related_plans: [cli-log-ux-overhaul]
review_status: null
planned_at_commit: 8b80824a04a62d24de7b3b8ce37c285ee5ae1260
---

## Goal

Successor to `cli-log-ux-overhaul` (shipped seams-only by explicit scope decision, 2026-07-09). That plan delivered the service rim — `Context.Tag`s + layers at `cli/src/services.ts`, a shared factory at `cli/src/engine-native/services.ts`, `Ctx.services` handed through `engine.ts`/native-raw, and ctx-scoped warn/hint/platform call sites consuming it. What remains is the deep port its Out-of-scope deferred: the ~250 module-global `change`/`verbose`/`warn`/`err`/`echo` bindings imported from `logger.ts`, the direct `commandExists`/`capture` probes in `toolchain.ts` and the sync modules, and the `InstallFn` callback leaves (`agentBrowserInstall`, `linkOrCopy`) that cannot see `Ctx` today. Completion evidence from the codex completion review (2026-07-09): a custom logger injected through the rim captured `seen: []` while output went to the real stderr — that reproduction flipping to full capture is this plan's headline acceptance test.

## Context & rationale

- The golden suites pin every message byte — this migration must be a **pure refactor** (zero golden diffs), same discipline as the os.ts seam migration (step 7 of the parent plan).
- `setVerbose`/module bindings exist because `@effect/cli` option parsing happens after module init; the Ctx-held logger removes the mutable module flag.
- Chrome-for-Testing and the LSP binaries were deliberately left OUT of the ToolId registry (kit-managed artifacts, not PATH tools) — revisit that boundary here with a real design, don't inherit it silently.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | Thread `Ctx` (or the `Logger` alone) into every emitter call site in the sync modules; delete the module-level bindings + `setVerbose` once no importer remains. Zero golden diffs. | — | planned |
| 2 | Route `toolchain.ts` `present`/`installedVersion` and sync-module `commandExists`/`capture` probes through `ctx.services.deps.probe`; decide the Chrome/LSP registry boundary explicitly. | 1 | planned |
| 3 | Rework `InstallFn` callbacks (rtk, agent-browser, effect-solutions) to receive services; migrate `linkOrCopy`'s win32 "dir" pick. | 1 | planned |
| 4 | Integration test: `runEngineNative(argv, stubServices)` with a capturing logger + stubbed deps/platform records the complete run (the codex reproduction inverted); golden suites byte-identical; prove-red red. | 1, 2, 3 | planned |

## Acceptance criteria

- [ ] `grep -rn "from \"./logger\"" cli/src/engine-native --include="*.ts"` matches only `services.ts` (the factory) — no module-binding importers remain.
- [ ] A unit/integration test injects a capturing logger through `runEngineNative(argv, services)` and asserts the full run's emissions land in the capture, nothing on real stderr.
- [ ] `bun run golden:dryrun` + `bun run golden:mutation` byte-identical (pure refactor); both `--prove-red` legs stay red; typecheck green.
- [ ] Injected win32 Platform yields winget hints end-to-end through a real sync run (extends the parent plan's combined-graph unit test to engine execution).

## Cold-handoff checklist

- File manifest: affected_paths above; parent plan `docs/plans/finished/2026-07-09-cli-log-ux-overhaul.md` carries the audit inventory (251 emitter rows) and the Output Policy contract lives in `cli/src/engine-native/DESIGN.md`.
- Environment & commands: Bun; `bun x tsc --noEmit -p cli/tsconfig.json`, `bun x vitest run`, `bun cli/test/golden-{dryrun,mutation}.ts [--prove-red|--update-goldens]` from repo root.
- Contracts: `Logger`/`DependencyManager`/`Platform` interfaces in `cli/src/engine-native/services.ts`; goldens are the behavior spec — this plan must not change them.
- Out of scope: new log levels; changing any message byte; Effect generators inside engine internals.
- Known gotcha: `engineCapture` re-spawns a child over native-raw — injected services do not cross the process boundary; the child builds its own from the factory.

## Review

(filled by plan-review on completion)
