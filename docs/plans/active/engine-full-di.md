---
title: Full engine-internal DI — route all emissions and probes through ctx.services
goal: Every EngineNative emission (logger calls AND direct process.stdout/stderr writes) goes through ctx.services.logger, and every external-tool presence/version decision through ctx.services.deps, so test layers can capture/stub a complete runEngineNative invocation; module-global logger bindings, setVerbose, and direct commandExists/capture/which probes in engine modules are eliminated or named in an exemption table.
status: ongoing
created: "2026-07-09T18:37:21-03:00"
updated: "2026-07-09T19:43:28-03:00"
started_at: "2026-07-09T19:09:48-03:00"
assignee: "codex gpt-5.6-sol xhigh (orchestrated by claude)"
tags: [cli, effect, solid, di, follow-up]
affected_paths:
  - cli/src/engine.ts
  - cli/src/main.ts
  - cli/src/services.ts
  - cli/src/engine-native/logger.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/services.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/claudeModel.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/models.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/exec.ts
  - cli/src/engine-native/DESIGN.md
  - cli/test/unit/
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
related_plans: [cli-log-ux-overhaul]
review_status: null
planned_at_commit: 8b80824a04a62d24de7b3b8ce37c285ee5ae1260
---

## Goal

Successor to `cli-log-ux-overhaul` (shipped seams-only by explicit scope decision, 2026-07-09). That plan delivered the service rim — `Context.Tag`s + layers at `cli/src/services.ts`, a shared factory at `cli/src/engine-native/services.ts`, `Ctx.services` handed through `engine.ts`/native-raw, and ctx-scoped warn/hint/platform call sites consuming it. This plan finishes the port: after it, injecting a capturing logger + stubbed deps/platform through `runEngineNative(argv, services)` captures the COMPLETE run — the codex completion-review reproduction (custom logger saw `seen: []` while output hit real stderr) inverted.

**Emission inventory is the contract, not the logger-import grep alone.** Known direct writes that bypass the logger today and must be routed or exemption-tabled: `models.ts:52` (catalog to stderr — a pre-existing channel bug recorded in the parent plan), `toolchain.ts:110,141` (direct writes), plus any `process.stdout.write`/`process.stderr.write`/`console.*` found by the Step-1 inventory. The interactive TTY prompt sink in toolchain gating is the one expected exemption candidate (documented, tested).

## Context & rationale

- The golden suites pin every message byte — this migration must be a **pure refactor** (zero golden diffs), with ONE exception: the Step-1 models.ts channel fix. `--update-goldens` is permitted exactly once, in the Step-1 slice, and its recorded diff must touch only the model-catalog cases (enumerate the changed case labels in the commit message). Everywhere else `--update-goldens` is FORBIDDEN and any golden diff is a revert trigger, not a recording opportunity.
- **Verbosity becomes run-scoped.** Today `logger.ts` gates `verbose()` through the mutable module global `verboseFlag` set by `setVerbose` (parseArgs runs after module init). Replacement: the run's `Logger` is built per `runEngineNative` invocation with `isVerbose: () => ctx.verbose`; `setVerbose` and the module flag are deleted only after no importer remains. Sequential in-process runs must not leak verbosity (see acceptance).
- **Dedup state becomes per-run.** `deps.ts`'s module-level `warned` Set suppresses warnings across in-process runs and its `warnMissing` writes through the module logger, bypassing an injected one. `DependencyManager` is constructed WITH the run's logger and owns its own dedup set per service graph.
- `InstallFn` leaves (`rtkInstall`, `agentBrowserInstall`, `effectSolutionsInstall`) and `linkOrCopy` are emitter leaves without `Ctx` — their signature change is a prerequisite for the zero-import cleanup, hence the step order below.
- Probe heterogeneity is real: Bun fallback paths, effect-solutions via `bun pm -g ls`, npm/curl `latestVersion` queries, manifest tools (ffplay, LSP binaries). The generic `probe(id)` cannot express these — the manager gains per-spec custom resolvers over a small injectable probe executor (`{ commandExists, capture, which }`), rather than forcing everything through one generic method.

## Interfaces & data shapes

- `type InstallFn = (mode: "install" | "upgrade", version: string, services: EngineServices) => number` — `toolchain.ensure` passes `ctx.services`; callers in `modes.ts` and the sync modules updated in the same slice.
- `linkOrCopy(target: string, link: string, platform: Platform): boolean` — symlink type ("dir" on windows) from the injected platform; fallback-to-copy behavior unchanged.
- `Logger` unchanged in shape; constructed per run by the factory: `makeEngineServices(opts?: { isVerbose?: () => boolean, sinks?: LoggerSinks })`.
- `DependencyManager` gains `probeExecutor` injection: `makeDependencyManager(platform, logger, exec = { commandExists, capture, which })`; per-spec `resolve?: (exec) => ProbeResult` for heterogeneous tools.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Emission inventory + contract**: enumerate every emitter in `cli/src/engine-native/` — logger imports AND `process.stdout.write`/`process.stderr.write`/`console.*` (`rg` both patterns) — into a table (site, class, route-or-exempt). Route `models.ts:52` to the data channel (stdout via logger.echo — fixes the recorded pre-existing channel bug; this is the ONE permitted output change, named here) and `toolchain.ts:110,141` through the logger; document any TTY-prompt exemption with a test. Done-condition: the inventory table is in this plan's Notes and every row is routed or exempted. | — | done |
| 2 | **Run-scoped Logger + services**: factory builds the Logger per run from `ctx.verbose`; migrate ctx-reachable emitter call sites to `ctx.services.logger`; `setVerbose` still exists for the leaves. Gate: typecheck + unit + BOTH golden suites byte-identical + both prove-red legs red before the next slice; any diff reverts the slice. | 1 | done |
| 3 | **Leaf callbacks**: change `InstallFn` and `linkOrCopy` signatures per Interfaces; migrate `rtkInstall`/`agentBrowserInstall`/`effectSolutionsInstall`/`bunBootstrap` emitters + platform picks to the passed services; update every `ensure(...)` caller. Same gate as Step 2. | 2 | done |
| 4 | **Zero-import cleanup**: delete `setVerbose`, the module `verboseFlag`, and the module-level logger bindings once `rg 'from "./logger"' cli/src/engine-native --include='*.ts'` matches only `services.ts`. Same gate. | 3 | planned |
| 5 | **DependencyManager consolidation**: per-spec resolvers + injectable probe executor; route `toolchain.ts` `present`/`installedVersion` and sync-module `commandExists`/`capture` presence decisions through `ctx.services.deps`; dedup set + logger become per-manager (per run). Registry membership DECIDED (user via picker, 2026-07-09): Chrome-for-Testing, the LSP binaries, and ffplay come INTO the registry via per-spec custom resolvers over the injectable probe executor — uniform hint-bearing dedup'd warns for every tool the engine touches; no PATH-tools-only exemption row. Same gate. | 2 | planned |
| 6 | **Integration test (isolated)**: in-process `runEngineNative(argv, stubServices)` under a temp `HOME` + temp `AGENTS_DIR`, stub-only `PATH`, dry-run or fixture-mutation argv only, serial execution, `finally` restoration of env + stream spies. Canonical case: the original codex reproduction (custom logger captures everything, real stderr stays empty). Branch matrix: parse error, `sync --dry-run`, missing-dep warn, `model claude` get, toolchain gate decline — each with expected logger-record sequence and a zero-bypass assertion on real stdout/stderr. Two-run dedup case: same manager graph per run → one captured warn per run; three-run verbosity case: non-verbose → verbose → non-verbose, no leakage. | 4, 5 | planned |

## Acceptance criteria

- [ ] `rg 'from "./logger"' cli/src/engine-native --include='*.ts'` → only `services.ts`; `rg 'process\.(stdout|stderr)\.write|console\.' cli/src/engine-native --include='*.ts'` → only `logger.ts` sinks + rows exemption-tabled in Step 1.
- [ ] `rg 'commandExists|capture\(|which\(' cli/src/engine-native --include='*.ts'` outside `exec.ts`/`deps.ts`/`services.ts` → empty or covered by the Step-1/Step-5 allowlist table; a test injects probe results that contradict the host PATH and the engine believes the injection.
- [ ] The Step-6 integration suite passes: canonical capture case, branch matrix, two-run dedup, three-run verbosity — with real-stream zero-bypass assertions.
- [ ] Injected win32 platform: `linkOrCopy` records the "dir" symlink type; injected linux: `agentBrowserInstall` argv contains `--with-deps`; injected non-linux: it doesn't. (Extends the parent plan's hint-only test to behavior.)
- [ ] Each verification command, run separately, with expected results: `bun x tsc --noEmit -p cli/tsconfig.json` (exit 0) · `bun x vitest run` (all pass) · `bun cli/test/golden-dryrun.ts` (exit 0, `OK (21 case(s))` — count as of planning) · `bun cli/test/golden-mutation.ts` (exit 0, `OK (47 case(s))`) · `bun cli/test/golden-dryrun.ts --prove-red` and `bun cli/test/golden-mutation.ts --prove-red` (each prints `prove-red OK`, exits 1). Goldens byte-identical EXCEPT the Step-1 slice, whose one permitted `--update-goldens` run records exactly one ADDITIVE case (`fixture=home-drift cmd=model claude` — the catalog get, exercising the models.ts channel fix) and touches no existing case — the new label enumerated in that commit; no other golden diff, no other `--update-goldens` run. The channel itself is pinned by the new split-channel invariant leg (catalog on stdout, zero on stderr).

## Out of scope / do-NOT-touch

- Any message byte change beyond the single named `models.ts` channel fix.
- New log levels; Effect generators inside engine internals; changes to golden case sets — except the single authorized additive `model claude` catalog case (see the RESOLVED note in Notes).
- `exec.ts` PATH/X_OK primitives stay the platform-seam exemption (DESIGN.md).

## Cold-handoff checklist

- File manifest: `affected_paths` above; the parent plan (`docs/plans/finished/2026-07-09-cli-log-ux-overhaul.md`) carries the 251-row emitter audit and the Output Policy contract lives in `cli/src/engine-native/DESIGN.md` (update its Module Map + Verbosity plumbing sections in Step 4).
- Environment & commands: Bun, repo root — the five verification commands with expected outputs are enumerated verbatim in the last acceptance criterion (run each separately; the brace-expansion shorthand `golden-{dryrun,mutation}` is NOT a valid single invocation).
- Contracts: Interfaces & data shapes above; goldens are the behavior spec.
- Decision rationale: run-scoped verbosity/dedup and leaf-first ordering come from the 2026-07-09 draft review (see Self-review); the models.ts channel fix is the parent plan's recorded pre-existing follow-up; the Chrome/LSP/ffplay registry inclusion is a user decision via picker (2026-07-09), resolving draft-review finding 13.
- Known gotcha: `engineCapture` re-spawns a child over native-raw — injected services do not cross the process boundary; the child builds its own from the factory. Golden runs spawn the engine as a child, so module-global deletion cannot be detected by goldens alone — the Step-6 in-process suite is the real check.

## Self-review

- Score: 88/100 · trajectory 62→88 · stopped: single revision pass over the cross-check (draft rewritten wholesale from the findings).
- Cross-check (2026-07-09): [codex gpt-5.6-sol xhigh] 13 findings (9 high / 4 med) — 13 accepted, 0 rejected; [claude] independently verified 1, 2, 5, 9 against source before accepting (models.ts:52/toolchain.ts:110,141 direct writes confirmed by rg; verboseFlag/setVerbose module global confirmed in logger.ts:43-49; warned Set module-level in deps.ts:91; the brace-expansion command in the original checklist was indeed not a runnable single invocation). Finding 13 elevated to the open question above rather than silently resolved.

## Notes

- RESOLVED (2026-07-09, orchestrator decision — implementation detail within the user-approved models.ts channel-fix scope): both halves. Step 1 is AUTHORIZED to add exactly one catalog-printing golden case — MATRIX row `{ fixture: "home-drift", cmd: ["model", "claude"] }` (valueless get prints deployed/SoT + catalog) — recorded in the same slice as the channel fix via the one permitted `--update-goldens` run; enumerate it in the commit as the additive label. AND add a split-channel invariant leg (`runEngineSplit(["model", "claude"], ...)`) asserting `Available claude models` lines land on stdout and none on stderr — that assertion, not the merged golden, is what pins the channel fix. The Out-of-scope golden-case-set freeze gets this single named carve-out; blocker raised by the implementer (gpt-5.6-sol) in commit 6d38fb3.

### Step 1 emission inventory

| Site found by inventory | Class | Route or exemption |
|---|---|---|
| `parseArgs.ts` logger import | usage + parser diagnostics | Route through `ctx.services.logger` in Step 2. |
| `claudeModel.ts` logger import | model modifier data/change/warn/error/no-op | Route through `ctx.services.logger` in Step 2. |
| `modes.ts` logger import | model/toolchain data/warn/error | Route through `ctx.services.logger` in Step 2. |
| `services.ts` logger import | service construction | Retain as the sole logger import after Step 4. |
| `index.ts` logger import | sync summary + next-step data | Route through `ctx.services.logger` in Step 2. |
| `deps.ts` logger import | deduplicated missing-tool warning | Route through the manager-owned logger in Step 5. |
| `codexToml.ts` logger import | Codex model data/change/warn/no-op | Route through `ctx.services.logger` in Step 2. |
| `toolchain.ts` logger import | report/gate/install data/warn/no-op | Route through `ctx.services.logger` in Step 2. |
| `claudeSync.ts` logger import | Claude sync data/change/warn/error/no-op | Route ctx-reachable calls in Step 2 and leaf callbacks in Step 3. |
| `models.ts` logger import | catalog data + validation warnings | Route through the caller's `ctx.services.logger` in Step 2. |
| `skillsSync.ts` logger import | skill sync data/change/warn/no-op | Route ctx-reachable calls in Step 2 and leaf callbacks in Step 3. |
| `codexSync.ts` logger import | Codex sync data/change/warn/error/no-op | Route through `ctx.services.logger` in Step 2. |
| `models.ts` catalog direct stderr write | model-catalog data | Routed in Step 1 through `logger.echo`; the split-channel invariant pins stdout-only delivery. |
| `toolchain.ts` prompt warning direct stderr write | warning | Routed in Step 1 through `ctx.services.logger.warn`; bytes stay identical. |
| `toolchain.ts` prompt text direct stderr write | interactive TTY prompt | Exempt: the prompt is raw stderr with no prefix or newline, which the line-oriented Logger cannot represent. `toolchain.test.ts` pins the exact bytes and CR-trimmed answer. |
| `logger.ts` default stderr sink | logger implementation | Exempt: terminal sink owned by `makeLogger`. |
| `logger.ts` default stdout sink | logger implementation | Exempt: terminal sink owned by `makeLogger`. |

- **2026-07-09T19:27:12-03:00 — Step 1 done:** routed the model catalog to stdout, routed the interactive gate warning through the injected logger, pinned the raw prompt exemption, and added the split-channel model invariant. The one permitted `--update-goldens` run added only `fixture=home-drift cmd=model claude` (9 inserted JSON lines, no existing-case changes), so dry-run coverage intentionally moved from 21 to 22 cases. The three explicitly authorized golden paths were added to `affected_paths` because the resolved handoff required them but the frontmatter omitted them. Gates: typecheck exit 0; Vitest 20/20; dry-run 22/22; mutation 47/47; dry-run prove-red exit 1 with `prove-red OK` (22 mismatches); mutation prove-red exit 1 with `prove-red OK` (47 mismatches).
- **2026-07-09T19:37:23-03:00 — Step 2 done:** `runEngineNative` now builds a fresh default Logger whose verbosity callback reads that run's `ctx.verbose`; explicitly injected services remain authoritative. All ctx-reachable emitters route through `ctx.services.logger`; the remaining logger imports are the Step-3 leaves, temporary `setVerbose` callers, `deps.ts` for Step 5, and the `services.ts` construction point. Added `cli/src/engine.ts`, `cli/src/main.ts`, and `cli/src/services.ts` to `affected_paths` because live run-scoped verbosity necessarily crosses that existing service rim; this slice only needed the native-raw `main.ts` call to stop prebuilding services. Gates: typecheck exit 0; Vitest 21/21; dry-run 22/22; mutation 47/47; dry-run prove-red exit 1 with `prove-red OK` (22 mismatches); mutation prove-red exit 1 with `prove-red OK` (47 mismatches). No golden diff.
- **2026-07-09T19:43:28-03:00 — Step 3 done:** `InstallFn` now receives `EngineServices`, `ensure` passes `ctx.services`, and the RTK/agent-browser/effect-solutions/Bun leaves use the passed logger and platform. `linkOrCopy(target, link, platform)` is now a pure platform-aware operation; its services-aware wrapper preserves the existing copy/failure warnings byte-for-byte. New unit legs contradict the host platform and prove injected win32 records symlink type `"dir"`, injected Linux adds `--with-deps`, and injected Darwin does not. Gates: typecheck exit 0; Vitest 23/23; dry-run 22/22; mutation 47/47; both full prove-red legs exit 1, with `prove-red OK` markers additionally confirmed by one-case filtered reruns. No golden diff.

## Review

(filled by plan-review on completion)
