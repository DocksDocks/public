---
title: Full engine-internal DI — route all emissions and probes through ctx.services
goal: Every EngineNative emission (logger calls AND direct process.stdout/stderr writes) goes through ctx.services.logger, and every external-tool presence/version decision through ctx.services.deps, so test layers can capture/stub a complete runEngineNative invocation; module-global logger bindings, setVerbose, and direct commandExists/capture/which probes in engine modules are eliminated or named in an exemption table.
status: ongoing
created: "2026-07-09T18:37:21-03:00"
updated: "2026-07-09T21:54:47-03:00"
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
  - cli/test/lib/harness.ts
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
- **Verbosity becomes run-scoped.** Today `logger.ts` gates `verbose()` through the mutable module global `verboseFlag` set by `setVerbose` (parseArgs runs after module init). Replacement: the service factory returns a raw Logger and `runEngineNative` applies the sole `ctx.verbose` gate; `setVerbose` and the module flag are deleted only after no importer remains. Sequential in-process runs must not leak verbosity (see acceptance).
- **Dedup state becomes per-run.** `deps.ts`'s module-level `warned` Set suppresses warnings across in-process runs and its `warnMissing` writes through the module logger, bypassing an injected one. Each `DependencyManager` owns its own dedup set, while callers supply the current run Logger to `warnMissing` so mixed service graphs cannot bypass injection.
- `InstallFn` leaves (`rtkInstall`, `agentBrowserInstall`, `effectSolutionsInstall`) and `linkOrCopy` are emitter leaves without `Ctx` — their signature change is a prerequisite for the zero-import cleanup, hence the step order below.
- Probe heterogeneity is real: Bun fallback paths, effect-solutions via `bun pm -g ls`, npm/curl `latestVersion` queries, manifest tools (ffplay, LSP binaries). The generic `probe(id)` cannot express these — the manager gains per-spec custom resolvers over a small injectable probe executor (`{ commandExists, capture, which }`), rather than forcing everything through one generic method.

## Interfaces & data shapes

- `type InstallFn = (mode: "install" | "upgrade", version: string, services: EngineServices) => number` — `toolchain.ensure` passes `ctx.services`; callers in `modes.ts` and the sync modules updated in the same slice.
- `linkOrCopy(target: string, link: string, platform: Platform): boolean` — symlink type ("dir" on windows) from the injected platform; fallback-to-copy behavior unchanged.
- `Logger` unchanged in shape; `makeEngineServices(opts?: { sinks?: LoggerSinks })` constructs a raw Logger, and `runEngineNative` is the sole run-scoped verbosity gate through explicit delegates over the default or injected Logger.
- `DependencyManager` gains `probeExecutor` injection: `makeDependencyManager(platform, exec = { commandExists, capture, which })`; the manager owns per-graph dedup state, while `warnMissing(id, logger, context?)` receives the current run Logger at the call site. Per-spec `resolve?: (exec, platform) => ProbeResult` handles heterogeneous tools.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Emission inventory + contract**: enumerate every emitter in `cli/src/engine-native/` — logger imports AND `process.stdout.write`/`process.stderr.write`/`console.*` (`rg` both patterns) — into a table (site, class, route-or-exempt). Route `models.ts:52` to the data channel (stdout via logger.echo — fixes the recorded pre-existing channel bug; this is the ONE permitted output change, named here) and `toolchain.ts:110,141` through the logger; document any TTY-prompt exemption with a test. Done-condition: the inventory table is in this plan's Notes and every row is routed or exempted. | — | done |
| 2 | **Run-scoped Logger + services**: factory builds the Logger per run from `ctx.verbose`; migrate ctx-reachable emitter call sites to `ctx.services.logger`; `setVerbose` still exists for the leaves. Gate: typecheck + unit + BOTH golden suites byte-identical + both prove-red legs red before the next slice; any diff reverts the slice. | 1 | done |
| 3 | **Leaf callbacks**: change `InstallFn` and `linkOrCopy` signatures per Interfaces; migrate `rtkInstall`/`agentBrowserInstall`/`effectSolutionsInstall`/`bunBootstrap` emitters + platform picks to the passed services; update every `ensure(...)` caller. Same gate as Step 2. | 2 | done |
| 4 | **Zero-import cleanup**: delete `setVerbose`, the module `verboseFlag`, and the module-level logger bindings once `rg 'from "./logger"' cli/src/engine-native --include='*.ts'` matches only `services.ts`. Same gate. | 3 | done |
| 5 | **DependencyManager consolidation**: per-spec resolvers + injectable probe executor; route `toolchain.ts` `present`/`installedVersion` and sync-module `commandExists`/`capture` presence decisions through `ctx.services.deps`; dedup set + logger become per-manager (per run). Registry membership DECIDED (user via picker, 2026-07-09): Chrome-for-Testing, the LSP binaries, and ffplay come INTO the registry via per-spec custom resolvers over the injectable probe executor — uniform hint-bearing dedup'd warns for every tool the engine touches; no PATH-tools-only exemption row. Same gate. | 2 | done |
| 6 | **Integration test (isolated)**: in-process `runEngineNative(argv, stubServices)` under a temp `HOME` + temp `AGENTS_DIR`, stub-only `PATH`, dry-run or fixture-mutation argv only, serial execution, `finally` restoration of env + stream spies. Canonical case: the original codex reproduction (custom logger captures everything, real stderr stays empty). Branch matrix: parse error, `sync --dry-run`, missing-dep warn, `model claude` get, toolchain gate decline — each with expected logger-record sequence and a zero-bypass assertion on real stdout/stderr. Two-run dedup case: same manager graph per run → one captured warn per run; three-run verbosity case: non-verbose → verbose → non-verbose, no leakage. | 4, 5 | done |
| 7 | **Golden-harness temp-dir cleanup** (`cli/test/lib/harness.ts` only): the harness leaks mkdtemp dirs into `/tmp` — `golden-stubs-*` (`makeStubDir`, harness.ts:83) and `golden-mask-*` (`shadowDir`, harness.ts:147) are never removed; `golden-home-*` (`materializeHome`, harness.ts:175) leaks on any failing case, which includes every intentional `--prove-red` run; `golden-fixture-*` (`materializeVariant`, harness.ts:415) has no removal either. On 2026-07-09 this filled a 3.9 GB tmpfs (1,177 stubs dirs alone). Fix: register every `mkdtempSync` result in one module-level Set inside harness.ts and remove them all (`rmSync(..., { recursive: true, force: true })`) in a single `process.on("exit")` hook; keep the existing per-case `cleanup()` calls (exit-hook is the backstop, not a replacement). Test-harness-only change: zero effect on golden bytes, engine sources untouched. Done-condition: after `bun cli/test/golden-dryrun.ts && bun cli/test/golden-mutation.ts` plus both `--prove-red` legs, `ls /tmp | grep -c '^golden-'` prints 0. Same five gates as Step 2. | — | done |

## Acceptance criteria

- [x] `rg 'from "./logger"' cli/src/engine-native --include='*.ts'` → only `services.ts`; `rg 'process\.(stdout|stderr)\.write|console\.' cli/src/engine-native --include='*.ts'` → only `logger.ts` sinks + rows exemption-tabled in Step 1.
- [x] `rg 'commandExists|capture\(|which\(' cli/src/engine-native --include='*.ts'` outside `exec.ts`/`deps.ts`/`services.ts` → empty or covered by the Step-1/Step-5 allowlist table; a test injects probe results that contradict the host PATH and the engine believes the injection.
- [x] The Step-6 integration suite passes: canonical capture case, branch matrix, two-run dedup, three-run verbosity — with real-stream zero-bypass assertions.
- [x] Injected win32 platform: `linkOrCopy` records the "dir" symlink type; injected linux: `agentBrowserInstall` argv contains `--with-deps`; injected non-linux: it doesn't. (Extends the parent plan's hint-only test to behavior.)
- [x] Temp-dir leak closed (Step 7): run both golden suites AND both `--prove-red` legs, then `ls /tmp | grep -c '^golden-'` → `0`; `git diff` for the Step-7 slice touches only `cli/test/lib/harness.ts` (+ this plan file); goldens byte-identical.
- [x] Each verification command, run separately, with expected results: `bun x tsc --noEmit -p cli/tsconfig.json` (exit 0) · `bun x vitest run` (all pass) · `bun cli/test/golden-dryrun.ts` (exit 0, `OK (21 case(s))` — count as of planning) · `bun cli/test/golden-mutation.ts` (exit 0, `OK (47 case(s))`) · `bun cli/test/golden-dryrun.ts --prove-red` and `bun cli/test/golden-mutation.ts --prove-red` (each prints `prove-red OK`, exits 1). Goldens byte-identical EXCEPT the Step-1 slice, whose one permitted `--update-goldens` run records exactly one ADDITIVE case (`fixture=home-drift cmd=model claude` — the catalog get, exercising the models.ts channel fix) and touches no existing case — the new label enumerated in that commit; no other golden diff, no other `--update-goldens` run. The channel itself is pinned by the new split-channel invariant leg (catalog on stdout, zero on stderr).

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
- **2026-07-09T19:48:50-03:00 — Step 4 done:** deleted `setVerbose`, `verboseFlag`, and the active module logger exports. Default and explicitly injected runs now apply verbosity per `Ctx`; the live Effect logger is deliberately unfiltered underneath that run gate. `rg 'from "./logger"' cli/src/engine-native -g '*.ts'` returns only `services.ts`; direct-write inventory remains the logger sinks plus the tested prompt exemption. To satisfy this slice's zero-import condition without pulling Step 5 forward wholesale, `deps.ts` now receives its logger from `makeDependencyManager`; the warned set remains module-global until Step 5. Updated DESIGN Module Map and Verbosity plumbing. Gates: typecheck exit 0; Vitest 23/23; channel-invariant smoke green; dry-run 22/22; mutation 47/47; both full prove-red legs exit 1 with `prove-red OK`. No golden diff.
- **2026-07-09T20:06:47-03:00 — Step 5 done:** DependencyManager now owns an injected `{ commandExists, capture, which }` executor, per-spec `probe`/`version`/`path`/`latest` resolvers, its logger, and a per-manager warned set. Registry coverage includes Chrome-for-Testing, ffplay, all three LSP binaries, and the package-manager probes; Bun and effect-solutions keep their heterogeneous fallback/global-bin rules. Toolchain and every sync-module presence/version decision consume `ctx.services.deps`; a host-PATH contradiction test proves the injected executor wins, and two manager graphs each emit one first warning. A pre-gate mutation run caught that presence probes were eagerly running version commands; splitting presence/version/path restored the exact historical argv sequence before the formal gate. Probe allowlist is now only `exec.ts` (PATH/X_OK primitives), `deps.ts` (resolver implementation), and `services.ts` (manager wiring); the grep is empty elsewhere. Gates: typecheck exit 0; Vitest 26/26; dry-run 22/22; mutation 47/47; both full prove-red legs exit 1 with `prove-red OK`. No golden diff.
- **2026-07-09T20:15:15-03:00 — Step 6 done:** added one serial, isolated in-process integration test under temporary `HOME`/`AGENTS_DIR` and a stub-only `PATH`, with `finally` restoration of every mutated environment key, both stream spies, and the temporary tree. The canonical Codex dry-run and the full branch matrix assert exact logger-record sequences plus zero real stdout/stderr writes; two fresh service graphs each capture one missing-dependency warning, while three runs over one service graph capture verbose output only in the middle run. Structural acceptance scans leave logger imports only in `services.ts`, direct writes only in logger sinks plus the exemption-tabled toolchain prompt, and host probes only in `exec.ts`/`deps.ts`; the golden diff is empty. Gates: typecheck exit 0; Vitest 27/27; dry-run 22/22; mutation 47/47; dry-run prove-red exit 1 with `prove-red OK` (22 mismatches); mutation prove-red exit 1 with `prove-red OK` (47 mismatches).
- **2026-07-09T20:51:58-03:00 — Fix round 1:** [codex gpt-5.6-sol xhigh fresh-context review] 7 findings (1 high / 5 medium / 1 low) — 7 accepted, 0 rejected. S1: missing-dependency dedup stays per manager, but callers pass the current run logger so a manager from another service graph cannot bypass injection. S2: factory loggers are raw and `runEngineNative` is the sole verbosity gate; the Effect rim no longer needs a special always-verbose factory callback. S3: the run logger delegates all five methods explicitly through their original receiver, covering class/prototype implementations. S4: effect-solutions resolution separates the actual platform-correct executable from Bun's global-bin directory and restores known-directory failure-message bytes. S5: version probes again use the historical PATH-or-`~/.bun/bin/bun` fallback; honoring custom `BUN_INSTALL` for version/upgrade decisions is deferred as a behavior-changing follow-up candidate. S6: Chrome-for-Testing now recognizes agent-browser's managed `~/.agent-browser/browsers/chrome-*` install plus system browser commands without subprocess side effects; it remains registered but deliberately unconsumed because wiring a new missing-Chrome warning would violate this plan's sole-output-change budget, so consumer/warn wiring is deferred. S7: `ProbeResult` is narrowed to live presence/path state; version stays solely behind `version()`. Targeted regression loops reproduced all seven findings before the fixes and now pass. Gates: typecheck exit 0; Vitest 35/35; dry-run 22/22; mutation 47/47; dry-run prove-red exit 1 with `prove-red OK` (22 mismatches); mutation prove-red exit 1 with `prove-red OK` (47 mismatches). No golden diff.
- **2026-07-09T21:34:13-03:00 — Step 7 added (scope extension, user-directed):** during this plan's execution the golden harness's leaked mkdtemp dirs filled the host's 3.9 GB tmpfs (ENOSPC; 1,177 `golden-stubs-*` dirs alone, plus `golden-mask-*` always-leaked and `golden-home-*` leaked on every `--prove-red` leg), halting the orchestration until out-of-band cleanup. The user directed the cleanup fix be folded into this plan as a follow-up step rather than a separate plan. `cli/test/lib/harness.ts` added to `affected_paths`; new unchecked acceptance criterion pins the leak-free condition. Orchestration note: the Step-7 slice must land AFTER the round-1 fix-verification completes, so the verification range `6d1cc20..HEAD` stays uncontaminated.
- **2026-07-09T21:39:41-03:00 — Round-1 fix-verification ingested:** [codex gpt-5.6-sol xhigh, fresh-context read-only over 6d1cc20..HEAD] all seven self-review findings verdict **CLOSED** with per-finding file:line evidence and would-fail-pre-fix test reasoning; all six gates re-run green (tsc 0; vitest 35/35; dry-run 22; mutation 47; both prove-red legs red); golden scope PASS (dryrun.json +9 only, mutation.json untouched). One NEW finding, MEDIUM (doc/spec drift): this plan's `## Interfaces & data shapes` and `DESIGN.md:105` still describe the pre-fix signatures (`makeEngineServices({ isVerbose })` verbosity callback, `makeDependencyManager` taking a construction-time logger), contradicting the fixed `services.ts:64` contracts — could steer a future handoff into reintroducing S1/S2. Overall verdict NOT READY solely on that finding → dispatched as fix round 2 (doc-only) to the worker, bundled with Step 7.
- **2026-07-09T21:41:37-03:00 — Fix round 2:** aligned the plan's interface contracts and `DESIGN.md` with the closed S1/S2 implementation: service factories return raw loggers, `runEngineNative` owns the sole run-scoped verbosity gate, dependency managers are constructed without a logger, and `warnMissing` receives the current run logger per call while retaining per-manager dedup. Gates: typecheck exit 0; Vitest 35/35; dry-run 22/22; mutation 47/47; both prove-red legs exit 1 with `prove-red OK`; no golden diff.
- **2026-07-09T21:54:47-03:00 — Step 7 done:** all four harness `mkdtempSync` sites now register through one module-level Set, and one synchronous `process.on("exit")` hook removes every registered path recursively with force; the existing per-case `cleanup()` remains unchanged. Pre-fix reproduction after the documentation gates found 272 leaked `golden-stubs-*`/`golden-mask-*` directories; one post-fix 22-case dry-run held that baseline exactly at 272, proving the modified process added zero leaks. After the orchestrator approved deleting exactly those pre-existing disposable fixture prefixes, the full gate ran from a zero baseline and the final `ls /tmp | grep -c '^golden-'` printed `0`. Gates: typecheck exit 0; Vitest 35/35; dry-run 22/22; mutation 47/47; dry-run prove-red exit 1 with `prove-red OK` (22 mismatches); mutation prove-red exit 1 with `prove-red OK` (47 mismatches). No golden diff; Step-7 diff is only `cli/test/lib/harness.ts` plus this plan file; engine sources untouched.

## Review

(filled by plan-review on completion)
