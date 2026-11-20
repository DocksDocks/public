# EngineNative Design

EngineNative is the only supported sync engine. It lives in
`cli/src/engine-native/`. The `sync` and `toolchain` commands invoke it
through `cli/src/engine.ts` and pass normalized argv to that seam. Other
commands, such as `omp`, `update`, `scratch`, and
`tidy`, import engine-native modules directly. The former
shell engine was removed after the `bash-engine-final` tag.
`DOCKS_KIT_ENGINE=bash` is now an explicit removed-engine diagnostic and exits
2 with the recovery tag message.

## Selection Contract

- The public `sync` and `toolchain` commands route through `engine(args)`
  after `effect/cli` (the CLI module inside `effect` 4) parses pickers and flag
  spellings. `sync` takes no positional argument, so `effect/cli` refuses a
  word such as `omp` with `Unexpected positional argument` and exit 1.
- Other public commands call engine-native modules directly, for example
  `tidy.ts` `planTidy` and `applyTidy`, `scratch.ts` `createScratchDir`, and
  `ompSession.ts` `readOmpSessionModel`.
- `DOCKS_KIT_ENGINE=native-raw` is harness-private: it bypasses `effect/cli`
  and hands argv directly to EngineNative so tests can exercise the internal
  engine vocabulary.
- `main.ts` runs the native-raw channel with `{ envGlobals: true }`; it is the
  only channel that honors the env globals.

## Behavior Contract

- **Golden regression is the engine contract.** Dry-run output, mutation tree
  shape, child-process argv logs, normalized output, and exit codes are recorded
  under `cli/test/goldens/`.
- **`--update-goldens` is review-gated.** Regeneration must be byte-identical
  on an unchanged engine; intentional behavior changes update goldens in the
  same reviewed diff.
- **Prove-red stays red.** The golden suites compare live native output to a
  mismatched golden under `--prove-red` and must exit non-zero after printing
  `prove-red OK`.
- **Step ordering is load-bearing.** The omp pipeline resolves Bun, deploys
  the whole files, merges `config.yml` and runs the retired-key removals on
  the merged result, merges `models.yml` and runs its removals, writes the
  intercom configuration, materializes the kit plugin, and only then runs the
  plugin pass, because the plugin pass links the kit plugin directory.
- **One pipeline.** Sync runs only the omp pipeline, which is serial.
  `syncConcurrency.ts` `runBounded` stays for the parallel probes of `tidy`
  and the tidy report.
- **External CLIs stay external.** `omp`, `npm`, `bun`, and `curl` are
  spawned with argv arrays, not shell command strings except where an external
  installer contract requires a script interpreter.
- **Backups precede mutation.** Deployed settings/config files write `.bak`
  backups before replacement.
- **Runtime payload is in memory.** `SoT/` remains the reviewed authoring tree;
  generated payload freshness gates build/package production, and EngineNative
  never needs an adjacent runtime `SoT/` directory.

## Output Policy (log UX contract)

The default run reads like a change report: only actual changes, actionable
warnings, and the summary. Status-quo confirmations exist but are opt-in.
(Rationale: the plan record shipped in commit 13214bc. Recover it with
`git log -- docs/plans/finished/`.)

### Channels and levels

| Emitter         | Channel | Default          | `--verbose`      | Prefix / form                                                                                  |
| --------------- | ------- | ---------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `err(msg)`      | stderr  | shown            | shown            | `[err]` red (`\x1b[1;31m`)                                                                     |
| `warn(msg)`     | stderr  | shown            | shown            | `[warn]` yellow (`\x1b[1;33m`)                                                                 |
| `change(msg)`   | stderr  | shown            | shown            | `[ok]` green (`\x1b[1;32m`) — ONLY after an operation actually mutated                         |
| `verbose(msg)`  | stderr  | hidden           | shown            | `[ok]` green — no-op confirmations ("already …", "present", "up to date", "left as-is"), skips |
| `progress(msg)` | stderr  | interactive only | interactive only | dim, transient single-line status with no newline                                              |
| `echo(line)`    | stdout  | shown            | shown            | bare — dry-run report lines, summary block, usage text                                         |

- stdout is data, stderr is logs — only `echo` writes to stdout, and every
  log emitter writes to stderr.
- **Dry-run is a complete inspection report**: `[dry-run]` lines use `echo`
  and print unfiltered at every verbosity.
- Prefixes and ANSI codes are stable golden surface; the level controls
  visibility, not the prefix.
- `logger.ts` `makeLogger`, at progress sink selection, enables transient
  progress when `LoggerSinks.progress` exists. It also enables progress when no
  stderr sink exists and `process.stderr.isTTY` is `true`. It disables progress
  in every other case. Injected golden sinks therefore keep their existing
  bytes unless the harness supplies a progress sink.
- Each progress write replaces one terminal line. Every durable `change`,
  `verbose`, `warn`, `err`, or `echo` write erases a visible transient before
  its own write.
- During sync, the coordinator holds one run-scoped terminal lease and owns
  the transient line. Terminal-exclusive sections serialize input ownership
  by acquisition order and suspend progress redraw while an inherited-stdio
  installer or blocking prompt holds the lease.
- Automated tests cannot exercise real input contention: golden children use
  ignored stdin, so `process.stdin.isTTY` is false. The simultaneous-prompt
  path requires hand verification in a real TTY.

### Change detection

Every mutating operation reports `changed: boolean`. A changed outcome logs
via `change`; an unchanged outcome logs via `verbose`. Operations that today
rewrite deployed files unconditionally may skip a provably-identical rewrite —
each such skip is an intentional behavior change named in its golden diff.

### Missing dependencies

Exactly one deduplicated warn per requested missing tool per run, uniform shape:
`[warn] <tool> not installed — <platform-correct install command>`, sourced
from the dependency registry (`deps.ts`). jq and curl are optional report rows:
jq has no runtime consumer, while curl warns only when a requested Bun
bootstrap needs an installer download.

### Summary and next steps

`toolchain` modes have no separate summary block by design — their stdout IS
the deliverable (the report table for `toolchain check`), so nothing prints
after it. The schema below applies to `sync` only.

The `--- Sync complete ---` block (stdout, `echo`) prints after the omp
pipeline settles, also on dry-run. When the pipeline rejects, `syncDispatch.ts`
`engineSync` skips the block and prints only the `--- Failures ---` ledger.
The block starts with a `Repo:` line and adds the `omp:` and `omp plugins:`
inventory lines. Dry-run leaves out the `omp plugins:` line. Next-step advice
lines print only when their trigger changed this run (an omp plugin operation,
such as the uninstall of a retired marketplace plugin, or a changed omp file →
restart line) or under `--verbose`.

### Platform seam

Engine host detection routes through `os/index.ts`. Its `rawPlatform` function
holds the engine's host-detection `process.platform` read and keeps platform
normalization injectable for tests. These direct reads remain:

- the POSIX-only `chmod` guard in `kitDb.ts`;
- the default `platform` argument of `ompSession.ts` `engineHome`;
- `exec.ts` `WINDOWS_PROCESS`;
- `tidy.ts` `listProcesses`;
- `tidyReport.ts` `memorySection`, `processSection`, `trashSection`,
  `scheduledSection`, and `buildTidyReport`;
- `scratch.ts` `removeTemporaryPath`.

Two cross-platform primitives need no platform branch:

- `kitLock.ts` `acquireKitLock`: an SQLite `BEGIN IMMEDIATE` lock. The OS
  releases it when the holder process ends, on POSIX and on Windows.
- `processes.ts` `processExited`: `process.kill(pid, 0)` throws ESRCH for an
  exited PID on every host (`kill(2)` on POSIX, libuv `uv_kill` on Windows).

The omp extension `SoT/.omp/plugin/extensions/hygiene.ts` is outside the
engine. Its `isWindowsContention` reads `process.platform` and runs an EPERM
probe on win32 only.

Per-OS facts live in `os/linux.ts`, `os/darwin.ts`, and `os/windows.ts` behind
`HostOs`; consumers select those facts through the package rather than branching
on the host directly.

### Verbosity plumbing

`--verbose` / `-v` on the public `sync` and `toolchain` commands selects
verbose output. On the harness-private raw channel,
`DOCKS_KIT_VERBOSE=1` also selects it. Only the raw channel honors the
unprefixed `Ctx` env globals (`engineCtx.ts makeCtx` reads `DRY_RUN` and
`DOCKS_KIT_VERBOSE`). `main.ts` passes `{ envGlobals: true }` to
`runEngineNative` only on that channel. The public `engine()` seam ignores
these variables.
The default service factory returns a raw Logger. `runEngineNative` wraps the
default or injected Logger with explicit delegates and owns the sole
`ctx.verbose` gate.
There is no factory-level verbosity callback, module-global verbosity flag, or
active logger binding.

## Module Map

| Module               | Owns                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseArgs.ts`       | engine usage and the argv dispatch loop; re-exports the `parseHelp.ts` help text and early-exit error                                                                                                                                                                                                       |
| `index.ts`           | entry routing (`toolchain`/`sync`) and the run-scoped verbosity gate                                                                                                                                                                                                                                        |
| `engineCtx.ts`       | `Ctx` shape and `makeCtx`; the unprefixed env globals apply only on the native-raw channel                                                                                                                                                                                                                  |
| `syncDispatch.ts`    | sync and folder locks, the omp pipeline call, run summary, next-step blocks, and the `--- Failures ---` ledger                                                                                                                                                                                              |
| `syncConcurrency.ts` | input-ordered bounded pool (`runBounded`) for the tidy probes                                                                                                                                                                                                                                               |
| `../payload.ts`      | generated text payload reads and presentation-only source labels                                                                                                                                                                                                                                            |
| `bun.ts`             | per-run memoized Bun resolution/bootstrap shared by the omp pipeline and direct toolchain ensure                                                                                                                                                                                                            |
| `ompSync.ts`         | omp pipeline orchestration and summary; `ompFileDeploy.ts`, `ompPlugins.ts`, and `ompRemovals.ts` own the file, plugin (with the marketplace-plugin retirement), and retired-key passes; `ompPaths.ts` resolves roots; `ompYaml.ts` merges YAML                                                             |
| `toolchain.ts`       | tool presence/version probes, verified-version floor reporting, report table                                                                                                                                                                                                                                |
| `modes.ts`           | direct `toolchain` mode                                                                                                                                                                                                                                                                                     |
| `jq.ts`              | the `Json` value type, object narrowing, jq-compatible codepoint ordering, and a parse that yields `undefined` instead of throwing                                                                                                                                                                          |
| `exec.ts`            | slash-stable path helpers, host-aware PATH probes and invocation, capture/spawn wrappers, and change-detecting write/copy helpers                                                                                                                                                                           |
| `logger.ts`          | Logger shape + stable raw stdout/stderr sink factory; the run-scoped verbosity gate lives in `index.ts`                                                                                                                                                                                                     |
| `deps.ts`            | external-tool registry: identity, presence probe, supported-host install hints; the Bun hint renders the pinned download-then-run installer of the host (`HostOs.bunInstaller`)                                                                                                                             |
| `os/`                | host reader, injected platform normalization, and per-OS `HostOs` fact modules                                                                                                                                                                                                                              |
| `services.ts`        | shared raw-Logger + DependencyManager + Platform factory; `makeDependencyManager` owns the per-manager missing-tool dedup, and callers supply the current run Logger to `warnMissing`; wrapped in Effect Layers at `cli/src/services.ts`, with the run-scoped Logger gate applied only by `runEngineNative` |

## Platform Support

- EngineNative supports Linux on x64 and arm64, macOS on arm64, and Windows on
  x64.
- Unsupported hosts fail before launcher fallback, dependency probes, downloads,
  settings writes, or sync work.

## Tests

- `bun run test:unit` covers pure JSON merge semantics, jq-oracle cases, and
  the three `HostOs` modules independently of the current host.
- `bun run golden:dryrun` compares live native dry-run output to
  `cli/test/goldens/dryrun.json`.
- `bun run golden:mutation` compares live native mutation snapshots, argv logs,
  output, and the channel and migration invariants to
  `cli/test/goldens/mutation.json`.
- `.github/workflows/parity.yml` runs its portable lane on `ubuntu-24.04` and
  `macos-26`: generated-payload check, typecheck, unit tests, a clean-room
  package install smoke, and compilation and execution of the native host
  artifact. On `windows-2025`, two unit-test shards and the
  `portable-windows-checks` job (generated-payload check, typecheck, native
  artifact) run in parallel. The check `portable (windows-2025)` passes only
  when all three pass. The Linux-canonical snapshot lane stays on Ubuntu and
  runs both golden suites plus their prove-red checks.
- `.github/workflows/release-cli.yml` publishes four binaries (Linux x64 and
  arm64, macOS arm64, Windows x64), plus `SHA256SUMS` and the npm package.

## Non-Goals

- Reintroducing the removed shell engine as a supported fallback. Fix forward in
  EngineNative; recover historical source only from `bash-engine-final`.
- Adding new sync features while changing the engine contract.
