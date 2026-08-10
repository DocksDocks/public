---
title: Run sync pipelines concurrently
goal: Reduce warm default docks-kit sync wall time from 13.08 seconds toward 9.0 seconds by overlapping the Claude, Codex, and skills pipelines while preserving each pipeline's serial mutation order, deterministic golden coverage, coherent terminal progress, and EngineNative contracts.
status: finished
created: "2026-08-10T17:54:42-03:00"
updated: "2026-08-10T18:12:48-03:00"
started_at: "2026-08-10T18:35:00-03:00"
assignee: null
review_author_company: anthropic
review_author_tool: claude-code
review_author_model: opus
review_author_effort: high
review_waivers: []
tags:
  - sync
  - concurrency
  - performance
  - engine-native
affected_paths:
  - cli/src/engine-native/exec.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/services.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/modes.ts
  - cli/test/unit/deps.test.ts
  - cli/test/unit/services.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/src/engine-native/bun.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/test/unit/bun.test.ts
  - cli/test/unit/skillsSync.test.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/DESIGN.md
  - cli/docs/flags.md
  - cli/src/engine-native/logger.ts
  - cli/test/unit/logger.test.ts
  - cli/src/engine.ts
  - cli/src/main.ts
  - cli/test/unit/engine.test.ts
  - cli/test/lib/goldenExecution.ts
  - docs/plans/active/sync-pipeline-concurrency.md
related_plans: []
review_status: null
planned_at_commit: ba5fdba7095565a8820f50279be330f3198db138
execution_base_commit: null
---

## Goal

Mode: plan-and-implement

## Context & rationale

A warm default `./docks-kit sync` was measured on Linux x64 by driving the command through a PTY and timestamping every emitted line. The three selected pipelines are strictly serial today because `cli/src/engine-native/index.ts` exported `runEngineNative`, at the `engineSync` sync-dispatch anchor, calls `claudeSync`, then `codexSync`, then `skillsSync` against one mutable `Ctx`.

|Phase|Window|Duration|
|---|---|---|
|Process start to first output|0.00 - 1.82 s|1.82 s|
|Claude pipeline (2 marketplace refreshes + 5 plugin updates)|1.82 - 9.02 s|7.20 s|
|Codex pipeline (3 `codex plugin add`)|9.02 - 12.90 s|3.88 s|
|Skills pipeline (effect-solutions probe)|12.90 - 13.08 s|0.18 s|
|Total||13.08 s|

Within Claude, `marketplace update claude-plugins-official` took 0.49 s, `marketplace update docks` took 3.07 s, and the five serial `claude plugin update <id> --scope user` calls took 0.79, 0.71, 0.72, 0.73, and 0.67 s. Within Codex, the three serial `codex plugin add` calls took 1.37, 1.30, and 1.19 s.

The target is to overlap the three pipelines so wall time approaches `1.82 + max(7.20, 3.88, 0.18) = 9.0 s`: about a 4.1 s, or 31%, reduction from the measured 13.08 s baseline. The Claude pipeline remains the resulting serial floor. This plan does not claim that concurrency can make its two marketplace refreshes or five plugin updates overlap.

Every relevant child call currently blocks JavaScript. `cli/src/engine-native/exec.ts` `capture` wraps `node:child_process` `spawnSync`; `cli/src/engine-native/claudeSync.ts` `cli` and the process calls in `cli/src/engine-native/codexSync.ts` use `spawnSync` directly. Node documents that `spawnSync` blocks the event loop until the child exits. The replacement is the asynchronous `node:child_process.spawn` API, awaited through one EngineNative process-result seam. No worker threads are needed.

JavaScript here is single-threaded. Async concurrency interleaves continuations only at await boundaries; it does not preempt a statement midway. Mutations of `Ctx` fields and per-run counters are therefore not data races. The real hazards are external process state and interleaved terminal output. The one shared mutable operation that needs explicit coordination is Bun bootstrap: Claude and skills can both need it, so `bunBootstrap` must memoize one in-flight `Promise<BunRuntimeState>`, not merely the resolved state.

External state sets the concurrency boundary. Claude plugin commands read and mutate `~/.claude/plugins/known_marketplaces.json` and `~/.claude/plugins/installed_plugins.json` between passes, so every `claude plugin ...` invocation remains on one serial Claude queue. The `codex plugin add` loop likewise remains one serial Codex queue. Skills subprocesses remain serial within the skills pipeline. Concurrency exists only between selected pipelines.

Terminal access is also shared external state. `cli/src/engine-native/codexSync.ts` exported `codexSync`, at the `ensureBubblewrap` installer anchor, can launch the package-manager installer with inherited stdio for an interactive sudo prompt. Concurrently, `cli/src/engine-native/toolchain.ts` exported `ensure`, at the `gate` prompt anchor, calls exported `promptLine`, which reads fd 0. A single run-scoped terminal lease must serialize both input sites with terminal output; otherwise two pipelines can consume each other's input, and the blocking prompt can stall coordinator handling of other child completions.

The skills pipeline is disjoint from the Claude and Codex trees only as a current embedded-data fact, not by design: `SoT/.agents/skills.txt` is comments-only, so `cli/src/engine-native/skillsSync.ts` exported `skillsSync`, at the `syncUniversal` manifest-loop anchor, has no normalized slug to deploy. If populated, that anchor invokes the pinned skills CLI with `-a claude-code codex`, and the `healClaudeSymlink` anchor writes under `~/.claude/skills`, making skills a concurrent writer into both other pipelines' trees.

Golden mutation snapshots cannot record naturally concurrent child order. `cli/test/golden-mutation.ts` `compareCase` passes `argvLog` to `cli/test/lib/goldenSnapshot.ts` `diffText`, which compares same-index lines. Each stub built by `cli/test/lib/goldenResources.ts` appends its invocation to `GOLDEN_ARGV_LOG` in actual invocation order. Concurrent pipelines would therefore make mutation golden argv order nondeterministic. The deliberate solution is an explicit concurrency setting: production defaults to a fixed cap of 3, while `cli/test/lib/goldenExecution.ts` pins every golden child to `DOCKS_KIT_SYNC_CONCURRENCY=1`. The concurrent scheduler is covered directly by a deterministic unit test, not by mutation goldens.

`docks-kit update` does not gain a new parallel phase. `cli/src/commands/update.ts` must run its git status/upstream/pull/diff and possible frozen install in dependency order, then `chainSync` starts a fresh process with `--skip-plugin-refresh`. That serial chain is real; update inherits only the wall-time improvement of the faster chained sync.

## Environment & how-to-run

- Work from `/home/docks/projects/public`, repository root, on the implementation branch based from `ba5fdba7095565a8820f50279be330f3198db138`.
- The measured comparison environment is Linux x64, warm caches, a working network, and already-installed tools. Run timing through a PTY when comparing emitted-line windows; use `/usr/bin/time` for the binary wall-time acceptance.
- Use the repository's pinned Bun and existing `bun.lock`. This change uses the built-in `node:child_process.spawn`; add no dependency.
- Before editing, run one warm `./docks-kit sync`, then take three alternating `DOCKS_KIT_SYNC_CONCURRENCY=1` / `DOCKS_KIT_SYNC_CONCURRENCY=3` wall-time pairs and compare their medians. Do not regenerate goldens merely because the concurrent production order differs; the harness is intentionally serial.
- Focused verification is `bun vitest run cli/test/unit/engine-di.test.ts cli/test/unit/engine.test.ts cli/test/unit/logger.test.ts cli/test/unit/deps.test.ts cli/test/unit/services.test.ts cli/test/unit/bun.test.ts cli/test/unit/skillsSync.test.ts`.
- The full gate is `bun run test:ci`, which chains `check:generated`, `typecheck`, `test:unit`, `cli/test/statusline-runtime-smoke.mjs posix`, `golden:dryrun`, and `golden:mutation`.
- Both golden suites also support `--prove-red` and must exit non-zero after detecting their planted mismatch. `--update-goldens` remains available only for intentional snapshot changes.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Replace blocking EngineNative subprocess capture with one injected async `spawn` result seam; make dependency version/location/latest resolution and toolchain orchestration await it without changing argv, stdio, exit, offline, or install-gate semantics. | `cli/src/engine-native/exec.ts`; `cli/src/engine-native/deps.ts`; `cli/src/engine-native/services.ts`; `cli/src/engine-native/toolchain.ts`; `cli/src/engine-native/modes.ts`; `cli/test/unit/deps.test.ts`; `cli/test/unit/services.test.ts`; `cli/test/unit/engine-di.test.ts` | none | done | Injected executor tests prove success, non-zero, spawn-error, stdout trimming, npm-global memoization, and managed-tool paths with Promises; no EngineNative dependency probe used by sync calls `spawnSync`. |
| 2 | Convert Bun, Claude, Codex, and skills pipelines to async functions, awaiting every external call in the existing intra-pipeline order; memoize the in-flight Bun bootstrap so concurrent Claude/skills requests share one bootstrap. | `cli/src/engine-native/bun.ts`; `cli/src/engine-native/claudeSync.ts`; `cli/src/engine-native/codexSync.ts`; `cli/src/engine-native/skillsSync.ts`; `cli/test/unit/bun.test.ts`; `cli/test/unit/skillsSync.test.ts`; `cli/test/unit/engine-di.test.ts` | 1 | done | Focused tests show exactly one Bun bootstrap for concurrent callers, Claude plugin argv remains serial by pass, Codex plugin argv remains serial, skills subprocesses remain serial, and these four modules contain no `spawnSync`. |
| 3 | Add the bounded coordinator at `cli/src/engine-native/index.ts` exported `runEngineNative`, `engineSync` dispatch anchor: build selected tasks in canonical Claude/Codex/skills order, run at most 3, preserve result slots for canonical summaries, validate `DOCKS_KIT_SYNC_CONCURRENCY=1..3` only on sync dispatch, and document default 3 plus serial override 1. | `cli/src/engine-native/index.ts`; `cli/src/engine-native/DESIGN.md`; `cli/docs/flags.md`; `cli/test/unit/engine-di.test.ts` | 2 | done | With deferred test tasks, cap 3 starts all three before any resolves, cap 2 never has more than two active, cap 1 starts strictly Claude then Codex then skills, results remain input-ordered, invalid env values exit 2 before a sync pipeline starts but do not affect `model` or `toolchain`, and selected single-target sync starts one task. |
| 4 | Replace output-only progress ownership with one run-scoped terminal lease. The coordinator owns progress; `cli/src/engine-native/codexSync.ts` exported `codexSync` at the `ensureBubblewrap` installer anchor and `cli/src/engine-native/toolchain.ts` exported `ensure` at the `gate` / `promptLine` anchor acquire the same lease before touching fd 0; terminal-exclusive sections suspend progress redraw. | `cli/src/engine-native/logger.ts`; `cli/src/engine-native/index.ts`; `cli/src/engine-native/claudeSync.ts`; `cli/src/engine-native/codexSync.ts`; `cli/src/engine-native/skillsSync.ts`; `cli/src/engine-native/toolchain.ts`; `cli/test/unit/logger.test.ts`; `cli/test/unit/engine-di.test.ts` | 3 | done | Logger tests show one transient line, pipeline progress cannot erase/replace coordinator progress, durable output clears before writing, completion updates list only remaining pipelines, and no progress bytes appear for non-TTY sinks; a hand-run default-warm TTY sync verifies that simultaneous terminal requests serialize without crossed input or redraw over a prompt. |
| 5 | Cross the async boundary end to end: make `runEngineNative` return `Promise<number>`, use an Effect promise boundary, await native-raw exit in `main.ts`, and update only the in-process direct and mocked callers. The synchronous golden launch helpers remain separate-process boundaries. | `cli/src/engine-native/index.ts`; `cli/src/engine.ts`; `cli/src/main.ts`; `cli/test/unit/engine-di.test.ts`; `cli/test/unit/engine.test.ts` | 3, 4 | done | Typecheck proves every in-process `runEngineNative` caller awaits its Promise; native-raw exits with the resolved code; Effect tests prove resolved 0, resolved non-zero, and rejected Promise behavior; `runEngine`, `runEngineSplit`, and `runPublicCli` remain synchronous. |
| 6 | Pin all golden child environments to serial mode and add a dedicated scheduler/pool unit test. Keep argv snapshots ordered and byte-stable; do not normalize or sort naturally concurrent logs. | `cli/test/lib/goldenExecution.ts`; `cli/test/unit/engine-di.test.ts` | 1-5 | done | `DOCKS_KIT_SYNC_CONCURRENCY=1` is explicit in `goldenExecution.ts` `runEnv`; filtered and full goldens match existing ordered argv snapshots; the pool test proves caps and overlap without timers; no golden file changes unless an independently reviewed behavior change requires them. |
| 7 | Measure warm serial and cap-3 syncs on the same host, confirm idempotency and the expected critical path, then run the complete acceptance inventory. | `cli/src/engine-native/DESIGN.md`; `docs/plans/active/sync-pipeline-concurrency.md` (verification receipts only) | 1-6 | done | The median of three alternating cap-3 measurements is faster than the cap-1 median and approaches 9.0 s under the baseline conditions; two cap-3 runs have byte-identical sets of `[ok]` lines; A1-A7 pass and the measured samples, medians, and reduction are recorded. |

### Step 1 — async exec seam

Use `node:child_process.spawn`, not a shell string and not worker threads. The process helper must register `error` and `close`, collect only requested pipe channels, preserve inherited/ignored stdio, and resolve only after the child closes. `capture` preserves its current contract: trimmed stdout on exit 0, empty string on non-zero or spawn failure. Keep filesystem-only `which`, `commandExists`, and presence probes synchronous; make subprocess-backed dependency methods Promise-returning. Convert `toolchain.ts` `ensure`, `installedVersion`, `latestVersion`, and `report`, plus `modes.ts` `modeToolchain`, only as required to maintain one dependency-execution convention.

### Step 2 — serial pipelines on async children

Keep all existing statements in each pipeline in semantic order. In Claude, `bun.ts` `bunBootstrap` remains before `claudeRuntime.ts` `materializeClaudeSettings`; settings prepare/commit, removals, and modifiers remain before any plugin operation; marketplace add remains before plugin install; pass-2 and pass-3 marketplace refresh remain before their respective installs/updates. Every call through `claudeSync.ts` `cli` is awaited before the next Claude plugin command.

In Codex, keep `codexSync.ts` `syncPlugins` as one awaited loop. In skills, keep manifest install/prune, effect-solutions ensure, and snapshot update ordered. Change `Ctx.bunRuntime` into an in-flight Promise slot (or an equivalently atomic single-assignment state) that is assigned before the first child-process await. Both Claude and skills await that same Promise, preventing duplicate Bun downloads/installs and duplicate writes to the process-specific installer path.

This cross-pipeline boundary is valid only while the embedded `SoT/.agents/skills.txt` normalizes to an empty list. That comments-only manifest makes `cli/src/engine-native/skillsSync.ts` exported `skillsSync`, at the `syncUniversal` manifest-loop and `healClaudeSymlink` repair anchors, inert. A non-empty manifest is a STOP because the pinned skills CLI deploys to both `claude-code` and `codex`, while symlink healing writes into the Claude tree.

### Step 3 — bounded coordinator

Define one small pool function in `cli/src/engine-native/index.ts` and export it for focused unit coverage. It takes tasks in canonical order and returns results in that same order regardless of completion order. At exported `runEngineNative`'s `makeCtx` construction anchor, initialize the non-optional `syncConcurrency` field to 3 without parsing the environment. The exact validation site is the same module and exported function's `engineSync` dispatch anchor, after `parseArgs` and `validateModifierFlags` and before task construction: there, read `DOCKS_KIT_SYNC_CONCURRENCY`, accept only decimal integers `1`, `2`, or `3`, assign the validated value, and treat missing/empty as 3. Invalid, zero, negative, fractional, or greater-than-3 values print `DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3` and return exit 2 before starting a sync pipeline. Because `runEngineNative` dispatches `model` and `toolchain` without entering that sync anchor, an invalid sync-concurrency environment value does not affect either mode.

The cap is deliberately fixed rather than derived from `os.cpus().length`: these tasks are I/O-bound network subprocesses, only three pipelines exist, and wider fan-out would amplify CLI startup and remote rate-limit pressure without reducing the Claude serial floor. On a task failure, stop launching queued tasks, await already-started children so none are orphaned, then propagate the earliest failure in canonical task order. At cap 1 this preserves legacy stop-before-next-pipeline behavior.

### Step 4 — terminal ownership

Extend `cli/src/engine-native/logger.ts` exported `makeLogger`, at the progress-state anchor, from an output-only progress owner to one run-scoped terminal lease. `cli/src/engine-native/index.ts` exported `runEngineNative`, at the `engineSync` dispatch anchor, acquires it with the selected pipeline names, stores it on `Ctx` for pipeline consumers, updates it only after a pipeline settles, and releases it in `finally`. While the lease exists, ordinary pipeline `progress` and `clearProgress` calls cannot replace coordinator progress. Durable `change`, `verbose`, `warn`, `err`, and `echo` calls synchronously erase any visible transient line before their normal one-chunk write. A terminal-exclusive section serializes by acquisition order, clears and suspends progress redraw, then allows redraw only after release.

Before `cli/src/engine-native/codexSync.ts` exported `codexSync`, at the `ensureBubblewrap` installer anchor, starts its inherited-stdio package-manager child, it must acquire the terminal-exclusive section and hold it through child close. Before `cli/src/engine-native/toolchain.ts` exported `ensure`, at the `gate` prompt anchor, calls exported `promptLine`, it must acquire that same section and hold it through the fd 0 read and answer handling. No golden or unit run can catch real input contention: the harness launches children with `stdio: ["ignore", …]`, so `process.stdin.isTTY` is false. Verify the default-warm path by hand in a real TTY, including the case where two pipelines request the terminal together; do not claim automated coverage for it.

### Step 5 — awaited callers

Change `cli/src/engine.ts` from `Effect.sync(() => runEngineNative(...))` to the repository's Effect Promise boundary, preserving non-zero exit handling. Await `runEngineNative` in `cli/src/main.ts` before `process.exit` on the harness-private `native-raw` path.

Repository search found one unit file that directly invokes the real function: `cli/test/unit/engine-di.test.ts`; every invocation becomes awaited and its tests become async. `cli/test/unit/engine.test.ts` mocks the function at the Effect seam and must use resolved/rejected Promises. `cli/test/lib/goldenExecution.ts` `runEngine`, `runEngineSplit`, and `runPublicCli` each call `spawnSync("bash", …)` and receive the child process's final status; the awaited `runEngineNative` is entirely inside that separate OS process, so no Promise crosses the harness boundary and all three helpers stay synchronous. `goldenExecution.ts` changes only in step:6 for the one-line `runEnv` concurrency pin.

### Step 6 — deterministic golden mode and concurrent coverage

Set `DOCKS_KIT_SYNC_CONCURRENCY: "1"` directly in `goldenExecution.ts` `runEnv`, whose environment is constructed from scratch. Do not depend on the invoking shell's environment and do not sort `GOLDEN_ARGV_LOG`: sorting would hide real ordering regressions within Claude or Codex. Existing mutation snapshots remain the canonical serial command sequence.

Add a named unit test in `engine-di.test.ts`, `runs selected sync pipelines with a bounded cap`, over the exported pool using deferred Promises and explicit start/finish records. It must prove cap enforcement, overlap at cap 3, serial order at cap 1, input-ordered results, and failure draining without real clocks or network processes.

This choice creates an explicit coverage gap: goldens no longer exercise the production-default concurrent schedule and therefore cannot detect a regression in real child-process overlap or cross-pipeline completion order. The pool unit test covers scheduler mechanics; existing per-pipeline/golden tests cover each serial mutation contract; the Step 7 wall-time command is the end-to-end evidence that actual subprocesses overlap. No deterministic test promises a specific remote-network schedule.

### Step 7 — measurement

Warm the same checkout and network caches, then take three alternating cap-1/cap-3 measurement pairs and record all six values, both medians, and the computed median reduction. The target is approximately 9.0 s versus the measured 13.08 s baseline, with Claude's 7.20 s queue still dominant. Treat timing as observed evidence, not as permission to parallelize inside a tool's plugin queue. Run cap 3 twice and require the two outputs' sets of `[ok]` lines to be byte-identical; steady state legitimately includes summaries such as `Codex plugins synced (plugins: ~3)`, so idempotency cannot be inferred from a fragile mutation-verb denylist.

## Interfaces & data shapes

### Async process and dependency boundary

```ts
interface AsyncProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly error?: Error
}

interface ProbeExecutor {
  readonly commandExists: (name: string) => boolean
  readonly capture: (cmd: string, args: ReadonlyArray<string>) => Promise<string>
  readonly which: (name: string) => string
}
```

`DependencyManager.version`, `path` when subprocess-backed, `location`, and `latest` return Promises; presence/`which` and manifest access remain synchronous. The exact internal result name may follow existing naming, but there must be one async child-process implementation and no second pipeline-specific spawn wrapper.

### Sync coordinator

```ts
type SyncConcurrency = 1 | 2 | 3

type SyncTask<T> = () => Promise<T>

function runBounded<T>(
  tasks: ReadonlyArray<SyncTask<T>>,
  concurrency: SyncConcurrency,
): Promise<Array<T>>

function runEngineNative(
  argv: ReadonlyArray<string>,
  services?: EngineServices,
): Promise<number>
```

`runBounded` starts tasks in input order, never exceeds the cap, and returns input-ordered result slots. `cli/src/engine-native/index.ts` exported `runEngineNative`, at the `engineSync` task-construction anchor, constructs `[Claude, Codex, skills]` after target parsing and omits unselected tasks. Summaries and next-step advice remain canonical Claude/Codex/skills order, independent of completion order.

`DOCKS_KIT_SYNC_CONCURRENCY` is the only override. Default is 3; 1 is serial golden/debug mode; 2 is bounded two-way overlap; 3 is the maximum. There is no CPU-count default and no new public CLI flag.

### Bun in-flight state

```ts
interface Ctx {
  // existing fields unchanged
  bunRuntime?: Promise<BunRuntimeState>
  syncConcurrency: SyncConcurrency
  terminalLease?: TerminalLease
}
```

The first `bunBootstrap` call stores the Promise before awaiting any child. All later calls await it. A rejected bootstrap Promise must be converted to the existing deferred/error contract and must not start a second installer in the same run. `cli/src/engine-native/index.ts` exported `runEngineNative`, at the `makeCtx` construction anchor, supplies the non-optional default `syncConcurrency: 3`; only its `engineSync` dispatch anchor validates and applies the environment override, so `model` and `toolchain` dispatch remain independent of invalid sync-only configuration.

### Terminal lease

```ts
interface TerminalLease {
  readonly update: (message: string) => void
  readonly withExclusive: <T>(action: () => T | Promise<T>) => Promise<T>
  readonly release: () => void
}

interface Logger {
  // existing methods unchanged
  readonly acquireTerminal: (message: string) => TerminalLease
}
```

Only `cli/src/engine-native/index.ts` exported `runEngineNative`, at the `engineSync` dispatch anchor, acquires the run-scoped lease and stores it on `Ctx`; pipeline progress and interactive consumers use that same object. `withExclusive` serializes terminal consumers in acquisition order, prevents another terminal-input owner, and suspends progress redraw until the action finishes. `cli/src/engine-native/codexSync.ts` exported `codexSync` holds it at the `ensureBubblewrap` installer anchor, and `cli/src/engine-native/toolchain.ts` exported `ensure` holds it at the `gate` / exported `promptLine` anchor. Durable writes clear transient bytes before output. `release` is idempotent and runs from `finally`.

### Golden-mode decision

The mutation golden contract remains an ordered log, not a set. `compareCase -> diffText` deliberately reports same-index differences, and each `goldenResources.ts` stub records real invocation order. Forcing golden children to cap 1 preserves this high-signal intra-pipeline contract. Sorting logs or weakening comparison would allow marketplace/install ordering bugs to pass. The cost is that the default cap-3 path is covered by the pool unit plus measured execution rather than snapshot order.

### Update behavior

`cli/src/commands/update.ts` remains unchanged: its git/install sequence is serial, and `chainSync` still launches a fresh `sync --skip-plugin-refresh`. The child inherits the default cap 3 unless the operator explicitly sets `DOCKS_KIT_SYNC_CONCURRENCY`; there is no update-specific pool.

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `bun vitest run cli/test/unit/engine-di.test.ts -t 'runs selected sync pipelines with a bounded cap' && bun vitest run cli/test/unit/logger.test.ts cli/test/unit/deps.test.ts cli/test/unit/services.test.ts cli/test/unit/bun.test.ts cli/test/unit/skillsSync.test.ts cli/test/unit/engine.test.ts` | Exits 0; the dedicated pool contract, terminal lease, async subprocess/dependency seams, shared Bun Promise, and Effect boundary tests pass. |
| A2 | `bun run test:ci` | Exits 0; generated payload, typecheck, unit tests, POSIX runtime smoke, dry-run goldens, and mutation goldens all pass. |
| A3 | <code>set +e<br>bun run golden:dryrun --prove-red &gt;/tmp/sync-concurrency-dry-red.out 2&gt;&amp;1<br>dry_code=$?<br>bun run golden:mutation --prove-red &gt;/tmp/sync-concurrency-mutation-red.out 2&gt;&amp;1<br>mutation_code=$?<br>set -e<br>test "$dry_code" -ne 0<br>test "$mutation_code" -ne 0<br>grep -F 'prove-red OK' /tmp/sync-concurrency-dry-red.out<br>grep -F 'prove-red OK' /tmp/sync-concurrency-mutation-red.out</code> | Both underlying golden commands exit non-zero, both marker checks succeed, and the wrapper exits 0. |
| A4 | `DOCKS_KIT_SYNC_CONCURRENCY=3 GOLDEN_FILTER='^fixture=home-fresh cmd=sync replay=2nd$' bun run golden:mutation` | Exits 0; the harness overrides the parent value with serial cap 1 and the live `GOLDEN_ARGV_LOG` matches the recorded same-index Claude-then-Codex-then-skills order exactly. |
| A5 | <code>./docks-kit sync &gt;/tmp/sync-concurrency-warm.out 2&gt;&amp;1<br>: &gt;/tmp/sync-cap1.seconds<br>: &gt;/tmp/sync-cap3.seconds<br>for i in 1 2 3; do<br>/usr/bin/time -f '%e' -a -o /tmp/sync-cap1.seconds env DOCKS_KIT_SYNC_CONCURRENCY=1 ./docks-kit sync &gt;"/tmp/sync-cap1-$i.out" 2&gt;&amp;1<br>/usr/bin/time -f '%e' -a -o /tmp/sync-cap3.seconds env DOCKS_KIT_SYNC_CONCURRENCY=3 ./docks-kit sync &gt;"/tmp/sync-cap3-$i.out" 2&gt;&amp;1<br>done<br>python3 -c "import statistics; s=[float(x) for x in open('/tmp/sync-cap1.seconds')]; c=[float(x) for x in open('/tmp/sync-cap3.seconds')]; sm=statistics.median(s); cm=statistics.median(c); print(f'cap1={s} median={sm:.2f}s cap3={c} median={cm:.2f}s reduction={(sm-cm):.2f}s ({(sm-cm)/sm*100:.1f}%)'); assert cm &lt; sm"</code> | Exits 0; records three alternating same-build warm samples per cap, prints both medians, and the cap-3 median is faster than the cap-1 median; under the recorded baseline conditions the cap-3 median approaches 9.0 s. |
| A6 | <code>env DOCKS_KIT_SYNC_CONCURRENCY=3 ./docks-kit sync &gt;/tmp/sync-cap3-replay-1.out 2&gt;&amp;1<br>env DOCKS_KIT_SYNC_CONCURRENCY=3 ./docks-kit sync &gt;/tmp/sync-cap3-replay-2.out 2&gt;&amp;1<br>grep -F '[ok]' /tmp/sync-cap3-replay-1.out &gt;/tmp/sync-cap3-replay-1.ok.raw<br>grep -F '[ok]' /tmp/sync-cap3-replay-2.out &gt;/tmp/sync-cap3-replay-2.ok.raw<br>LC_ALL=C sort -u /tmp/sync-cap3-replay-1.ok.raw -o /tmp/sync-cap3-replay-1.ok<br>LC_ALL=C sort -u /tmp/sync-cap3-replay-2.ok.raw -o /tmp/sync-cap3-replay-2.ok<br>cmp -s /tmp/sync-cap3-replay-1.ok /tmp/sync-cap3-replay-2.ok</code> | Exits 0; the two cap-3 runs emit byte-identical sets of `[ok]` lines, proving the replay introduces no additional mutation while allowing stable steady-state summaries. |
| A7 | <code>set +e<br>DOCKS_KIT_ENGINE=bash ./docks-kit sync &gt;/tmp/sync-concurrency-bash.out 2&gt;&amp;1<br>code=$?<br>set -e<br>test "$code" -eq 2<br>grep -F 'bash engine removed — recover at tag bash-engine-final' /tmp/sync-concurrency-bash.out</code> | The command exits 2 with the exact removed-engine diagnostic; Bash execution is not restored. |

## Out of scope / do-NOT-touch

- Do not parallelize commands inside Claude, Codex, or skills. In particular, do not use `Promise.all` for either plugin loop or for marketplace refresh/install passes.
- Do not add worker threads, a process worker pool, `os.cpus()` sizing, a dependency, or a floating package/tag.
- Do not parallelize `cli/src/commands/update.ts`; its git and dependency-install chain is ordered. Only its spawned sync becomes faster.
- Do not sort or otherwise normalize golden argv logs, loosen `compareCase`/`diffText`, or record a cap-3 command order as canonical.
- Do not change sync target/flag meanings, plugin refresh scope, settings merge behavior, summary order, exit codes, stdout/stderr policy, or `--skip-plugin-refresh` forwarding.
- Do not introduce a second mutable `Ctx` per pipeline merely to avoid reasoning about async interleaving. Share run state, and explicitly coordinate only the in-flight Bun Promise and the one run-scoped terminal lease.
- Do not convert unrelated synchronous filesystem operations or `engineCapture`/update subprocesses solely for stylistic consistency.

## Known gotchas

- `spawn` completion must use `close`, not only `exit`, because piped stdout/stderr may still have unread bytes when `exit` fires.
- A child `error` may occur without a normal exit code. Preserve the current capture behavior for probes and the current non-zero behavior for mutating commands.
- `Ctx` mutation is race-free at statement granularity, but check-then-await-check logic can still duplicate external work. The Bun Promise must be stored before the first await.
- Claude's installed/marketplace JSON files are re-read between passes. Even apparently independent plugin IDs are not safe to update concurrently.
- Completion order is intentionally nondeterministic at cap 3. Summary/result order is deterministic because pool results are indexed by task order; child argv order is deterministic only at cap 1.
- Golden child environments are constructed from scratch in `goldenExecution.ts`. The serial value must be written into that object; exporting it only in the parent shell has no effect. The synchronous harness functions remain process boundaries because their `spawnSync("bash", …)` calls wait for a separate native-raw/public CLI process.
- Durable output clears a transient progress line. The coordinator, not a completed pipeline, decides whether and when to redraw with remaining names; a terminal-exclusive section suppresses redraw until it releases.
- `cli/src/engine-native/codexSync.ts` exported `codexSync`, at the `ensureBubblewrap` installer anchor, can inherit fd 0 for sudo while `cli/src/engine-native/toolchain.ts` exported `ensure`, at the `gate` / exported `promptLine` anchor, reads fd 0. Both must acquire the same terminal lease. Standard golden/unit children ignore stdin and cannot verify this TTY-only path; exercise it by hand.
- A rejected concurrent task does not cancel an already-running child automatically. Drain started children before returning so the CLI does not leave plugin or installer processes mutating HOME after exit.
- Timing depends on remote latency and caches. The binary regression is cap 3 faster than cap 1 on the same warm checkout; 9.0 s is the measured-environment target, not a universal SLA.

## Global constraints

- Every EngineNative sync step remains idempotent; the second identical cap-3 run makes no changes.
- The Bash engine remains removed. `DOCKS_KIT_ENGINE=bash` continues to exit 2 with the recovery-tag diagnostic.
- Supply-chain inputs remain exactly pinned; never add a floating tag, range, branch, streamed dependency, or `@latest`.
- Production default concurrency is exactly 3. The only override is `DOCKS_KIT_SYNC_CONCURRENCY=1|2|3`; golden children use 1.
- JavaScript async concurrency only; no worker threads. Shared-state code relies on single-threaded continuation interleaving, not preemptive execution.
- Concurrency is between Claude, Codex, and skills only while the embedded universal-skills manifest remains comments-only. Each pipeline preserves its full current serial order and file-state rereads.
- Claude ordering remains: Bun bootstrap; settings materialization/prepare/commit and removals/modifiers; plugin passes with marketplace add/refresh before installs/updates; optional plugins; LSP checks.
- Codex's `syncPlugins` add loop and skills' external calls remain serial.
- Terminal input and output have one run-scoped lease and at most one transient terminal line; interactive input owners serialize and suspend progress redraw.
- Mutation golden argv comparison remains ordered and line-indexed; no sorting or set comparison.
- Full verification is `bun run test:ci` plus both non-zero `--prove-red` checks, serial-golden proof, wall-time comparison, idempotency replay, and Bash-engine rejection.
- EngineNative references use module + exported function + semantic anchor, never line-number anchors.

## STOP conditions

Stop rather than improvise if:

1. Any Claude or Codex CLI operation proves to depend on the other pipeline's mutable files; serialize those two pipelines and re-measure instead of adding file locks without review.
2. Async conversion changes intra-pipeline argv order, settings/plugin file results, output channels, or exit codes under cap 1.
3. The serial golden harness produces differing argv order on two unchanged runs; fix the harness pin before regenerating snapshots.
4. A cap-3 failure leaves a child process running or HOME changing after `runEngineNative` resolves/rejects.
5. Bun bootstrap runs more than once in one combined Claude+skills sync.
6. The coordinator cannot keep one coherent terminal owner without dropping durable warnings/errors; preserve durable output and stop for interface redesign.
7. Two pipelines need terminal input at the same time and either reaches fd 0 without the lease, consumes the other's bytes, or redraws progress over the active prompt.
8. `SoT/.agents/skills.txt` normalizes to any slug; skills then writes into the Claude/Codex trees, so disable cross-pipeline concurrency until the ownership boundary is redesigned.
9. Same-host warm cap 3 is not faster than cap 1 by median across three alternating measurement pairs; retain all samples and investigate the critical path rather than claiming the 9.0 s target.
10. `DOCKS_KIT_ENGINE=bash` reaches EngineNative instead of failing at the supported seam.

## Cold-handoff checklist

- [x] 1. File manifest — all seven Steps rows name exact existing repository paths, and `affected_paths` is exactly the union of their Files cells.
- [x] 2. Environment & commands — repository, commit, host/cache assumptions, focused tests, full gate, and alternating median timing method are explicit.
- [x] 3. Interface & data contracts — async process result, Promise-based dependency seam, pool, sync-only env validation, Bun Promise, terminal lease, and async engine return are defined.
- [x] 4. Executable acceptance — A1-A7 cover the pool, full gate, prove-red, ordered serial goldens, median wall time, stable idempotency output, and removed Bash engine.
- [x] 5. Out of scope — no intra-pipeline fan-out, update parallelism, worker threads, log sorting, behavior redesign, or unrelated async conversion.
- [x] 6. Decision rationale — the 13.08 s baseline, 9.0 s target, fixed cap 3, Claude floor, serial golden mode, and coverage gap are explicit.
- [x] 7. Known gotchas — child close/error, Bun check/await, cross-tree skill writes, terminal input/output, failure draining, and timing variability are recorded.
- [x] 8. Global constraints — idempotency, Bash removal, exact pins, ordering, golden comparison, and full gates are preserved verbatim.
- [x] 9. No undefined terms / forward refs — every new setting, type, owner, pool behavior, caller, command, and failure rule is defined here.

## Self-review

The plan preserves concurrency only at the three-pipeline boundary while the universal-skills manifest is empty, explicitly handles the shared Bun bootstrap and the single terminal lease, and does not hide nondeterministic argv with sorting. Repository search identified `cli/test/unit/engine-di.test.ts` as the only unit file directly invoking the real `runEngineNative`; `cli/test/unit/engine.test.ts` mocks that call through the Effect seam. The synchronous `goldenExecution.ts` helpers remain unchanged except for the serial `runEnv` pin because each waits on a separate OS process. Every path in the Steps table was verified to exist at planning time.

The acceptance split is intentional: cap-1 goldens retain exact mutation/order coverage, deferred-Promise unit tests prove the scheduler, three alternating pairs compare timing medians, and two cap-3 outputs prove stable steady-state `[ok]` sets. Real fd 0 contention remains a hand-verified TTY path because the harness ignores stdin.

## Review

### Plan review — 2026-08-10
Plan-review: repair
- Finding 1 · blocking — Repaired Step 5 to the exact in-process async boundary (`index.ts`, `engine.ts`, `main.ts`, `engine-di.test.ts`, and `engine.test.ts`); kept `runEngine`, `runEngineSplit`, and `runPublicCli` synchronous, left `goldenExecution.ts` only in Step 6 for `runEnv`, removed unrelated callers/tests, and rebuilt `affected_paths` from the surviving Files cells.
- Finding 2 · blocking — Replaced the output-only progress lease with one run-scoped terminal lease used by `codexSync.ts` exported `codexSync` at the `ensureBubblewrap` installer anchor and `toolchain.ts` exported `ensure` at the `gate` / exported `promptLine` anchor before fd 0 access, suspended progress redraw while exclusive, added the simultaneous-terminal STOP, and made the real-TTY hand check explicit because ignored harness stdin cannot cover it.
- Finding 3 · advisory — Recorded that comments-only `SoT/.agents/skills.txt` is the sole reason skills is currently disjoint, named `skillsSync.ts` exported `skillsSync` at the `syncUniversal` and `healClaudeSymlink` cross-tree write anchors, and added a STOP for any normalized manifest slug.
- Finding 4 · advisory — Set the exact validation site to `index.ts` exported `runEngineNative` at the `engineSync` dispatch anchor after argument/modifier validation and before task construction; its `makeCtx` construction anchor supplies default 3, so invalid sync concurrency does not affect `model` or `toolchain`.
- Finding 5 · advisory — Rewrote A5 to collect three alternating cap-1/cap-3 pairs and assert that the cap-3 median is lower than the cap-1 median.
- Finding 6 · advisory — Added `cli/test/unit/services.test.ts` to A1 and the focused-verification command.
- Finding 7 · blocking — Replaced the impossible mutation-verb denylist with two cap-3 runs whose sorted unique `[ok]` line sets must be byte-identical, allowing the legitimate steady-state Codex sync summary.

### Code review round 1 — 2026-08-10
Code-review: repair. No CRITICAL and no HIGH finding. The reviewer cleared all seven assigned risks: no lost serialization, no unawaited promise, one shared Bun bootstrap, no lease deadlock or leak on any reachable path, no determinism leak in the harness, and byte-identical captured output. Six findings were raised and all six were fixed.
- MEDIUM · `codexSync.ts` exported `codexSync`, `ensureBubblewrap` installer anchor — the installer argv and stdio literal was duplicated across the lease and no-lease branches, so an edit could silently diverge on golden-tested argv. Hoisted into one closure that both branches call.
- MEDIUM · `logger.ts` terminal lease, `withExclusive` anchor — a nested acquisition awaited a tail that only resolves in the outer `finally`, which would hang the CLI with no timeout. Re-entry is now detected and rejects with a named diagnostic; a 250 ms regression test fails fast instead of stalling the suite.
- MEDIUM · `index.ts` exported `runEngineNative`, `engineSync` selection anchor — skills/Claude disjointness rested only on prose. A non-empty normalized `SoT/.agents/skills.txt` now forces serial execution whenever Claude and skills are both selected, because the pinned skills CLI deploys with `-a claude-code codex` and symlink healing writes into the Claude tree.
- LOW · `logger.ts` exclusive section — durable writers were not gated, so a concurrent pipeline could overprint an interactive sudo password prompt. Durable `change`, `verbose`, `warn`, and `echo` are buffered while a section is held and flushed in original cross-sink order; `err` stays immediate and no durable output is dropped.
- LOW · `exec.ts` spawn helper — removed an unreachable `undefined` arm on `child.stdout` / `child.stderr`, which are typed `Readable | null`.
- LOW · this plan — verification receipts were missing. Recorded below.

## Verification Results

All commands run from the repository root on the reference host, Linux x64, warm caches, after the code-review fixes landed.

| ID | Result |
|---|---|
| A1 | Pass. Focused suites green, including the new pool contract, the lease re-entry guard, the durable-output buffering, and the manifest downgrade decision. |
| A2 | Pass. `bun run test:ci`: 25 test files, 174 tests, runtime smoke `p95=41.94ms` and `median=47.60ms`, `golden-dryrun: OK (25 case(s))`, `golden-mutation: OK (64 case(s))`. |
| A3 | Pass. `prove-red OK: golden-dryrun detected 25 planted mismatch(es)` and `prove-red OK: golden-mutation detected 61 planted mismatch(es)`, both exiting non-zero. |
| A4 | Pass. `git status --porcelain cli/test/goldens/` prints nothing across the whole change: no golden file was edited, which is the byte-level proof that argv order and captured output are unchanged. |
| A5 | Pass. Three alternating warm pairs: cap-1 `[12.97, 13.58, 13.35]`, cap-3 `[8.83, 9.04, 8.93]`. Median cap-1 `13.35 s`, median cap-3 `8.93 s`, reduction `4.42 s` (`33.1%`). The measured result meets the 9.0 s target. |
| A6 | Pass. Two consecutive cap-3 runs produce byte-identical sorted `[ok]` line sets, the single legitimate steady-state line `[ok] Codex plugins synced (plugins: ~3)`. |
| A7 | Pass. `DOCKS_KIT_ENGINE=bash ./docks-kit sync` exits 2 with `bash engine removed — recover at tag bash-engine-final`. |

Guard checks beyond the acceptance table: `DOCKS_KIT_SYNC_CONCURRENCY=0 ./docks-kit sync` exits 2 with `[err] DOCKS_KIT_SYNC_CONCURRENCY must be 1, 2, or 3`, while `DOCKS_KIT_SYNC_CONCURRENCY=0 ./docks-kit toolchain check` still exits 0, confirming the validation is scoped to sync dispatch.

Deviation from the plan as written: steps 1, 2, and 5 were merged into one cutover. An async dependency layer cannot coexist with synchronous pipelines, so the planned intermediate state would have required casts or a bridge that could not preserve runtime semantics. The merged cutover converted the subprocess seam, all four pipelines, and the Effect boundary while `engineSync` still awaited Claude, then Codex, then skills in order. That milestone passed the full gate with zero golden edits, which isolated the plumbing change from the concurrency change and gave step 3 a verified base.

Coverage gap, restated as shipped: goldens run at cap 1, so they do not exercise the production-default concurrent schedule. The pool unit test covers scheduler mechanics, the per-pipeline suites cover each serial mutation contract, and the A5 measurement is the end-to-end evidence that real subprocesses overlap. Real fd 0 contention remains hand-verified, because the harness launches children with ignored stdin.

## Sources

- `cli/src/engine-native/index.ts` — exported `runEngineNative`, at the `engineSync` dispatch anchor, owns sequential Claude/Codex/skills dispatch, shared `Ctx`, summary order, and the native return seam.
- `cli/src/engine-native/exec.ts` — `capture` semantic anchor wrapping blocking `spawnSync`.
- `cli/src/engine-native/deps.ts` — `ProbeExecutor`, dependency version/location/latest callbacks, and npm-global memoization.
- `cli/src/engine-native/services.ts` — `DependencyManager` and `makeDependencyManager` injected capability boundary.
- `cli/src/engine-native/bun.ts` — `bunBootstrap` resolved-state memo and installer subprocesses shared by Claude and effect-solutions.
- `cli/src/engine-native/claudeSync.ts` — exported `claudeSync`, local `cli`, settings/runtime ordering, `syncPlugins` passes, optional plugins, and LSP install.
- `cli/src/engine-native/codexSync.ts` — exported `codexSync`, bubblewrap subprocesses, and `syncPlugins` serial `codex plugin add` loop.
- `cli/src/engine-native/skillsSync.ts` — exported `skillsSync`, `effectSolutionsInstall`, universal-skill subprocesses, and snapshot order.
- `cli/src/engine-native/toolchain.ts` — `ensure`, `installedVersion`, `latestVersion`, and `report` subprocess-backed dependency consumers.
- `cli/src/engine-native/modes.ts` — exported `modeToolchain` and direct managed-tool awaits required by the async dependency seam.
- `cli/src/engine-native/logger.ts` — `makeLogger` single `progressPending` state and durable writers' `clearProgress` behavior.
- `cli/src/engine-native/DESIGN.md` — EngineNative ordering, external CLI, golden, output, progress, module-map, idempotency, and removed-engine contracts.
- `cli/src/engine.ts` — `engine` `Effect.sync` native boundary and removed-Bash rejection.
- `cli/src/main.ts` — harness-private `native-raw` direct `runEngineNative` process exit.
- `cli/src/commands/update.ts` — serial git/install sequence and `chainSync` fresh `sync --skip-plugin-refresh` process.
- `cli/test/lib/goldenExecution.ts` — synchronous native-raw/public child launchers, ignored default stdin, and environment constructed from scratch for the serial concurrency pin.
- `cli/test/golden-mutation.ts` — `compareCase` passing ordered `argvLog` to `diffText`.
- `cli/test/lib/goldenSnapshot.ts` — `diffText` same-index line comparison.
- `cli/test/lib/goldenResources.ts` — stub scripts appending each actual invocation to `GOLDEN_ARGV_LOG`.
- `cli/test/unit/engine-di.test.ts` — all direct real `runEngineNative` unit invocations and the planned pool test home.
- `cli/test/unit/engine.test.ts` — mocked Effect/native boundary.
- `cli/test/unit/bun.test.ts`, `cli/test/unit/deps.test.ts`, `cli/test/unit/services.test.ts`, `cli/test/unit/skillsSync.test.ts`, and `cli/test/unit/logger.test.ts` — focused contracts affected by Promise and terminal-lease conversion.
- <https://nodejs.org/api/child_process.html#child_processspawnsynccommand-args-options> — official Node documentation: `spawnSync` blocks the event loop until the child exits.
- <https://nodejs.org/api/child_process.html#child_processspawncommand-args-options> — official Node asynchronous `spawn` API and child lifecycle events.
- <https://bun.com/docs/runtime/child-process> — official Bun child-process documentation, including awaited `Bun.spawn(...).exited` as the alternative async runtime primitive.
