# EngineNative Design

EngineNative is the only supported sync engine. It lives in
`cli/src/engine-native/` and is invoked through `cli/src/engine.ts`; the rest
of the CLI passes normalized argv to that seam. The former shell engine was
removed after the `bash-engine-final` tag. `DOCKS_KIT_ENGINE=bash` is now an
explicit removed-engine diagnostic and exits 2 with the recovery tag message.

## Selection Contract

- Public CLI commands route through `engine(args)` after @effect/cli parses
  pickers, target words, and flag spellings.
- `engineCapture(args)` re-spawns the raw channel to capture stdout for
  commands such as `status --json`.
- `DOCKS_KIT_ENGINE=native-raw` is harness-private: it bypasses @effect/cli
  and hands argv directly to EngineNative so tests can exercise the internal
  engine vocabulary.

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
- **Step ordering is load-bearing.** The Claude pipeline resolves Bun, prepares
  materialized settings, writes runtime assets, commits settings, then performs
  readiness-gated legacy cleanup. Modifiers run after the base commit, removals
  before plugins, and LSP checks after plugin state.
- **Pipeline concurrency is bounded.** Selected Claude, Codex, and skills
  pipelines overlap through one input-ordered pool. The production default is
  3; `DOCKS_KIT_SYNC_CONCURRENCY=1` restores serial execution for golden tests
  and debugging (`2` allows two-way overlap). Each individual pipeline remains
  serial, and summaries retain canonical Claude, Codex, skills order.
- **External CLIs stay external.** `claude`, `codex`, `npx`, `npm`, `bun`,
  `curl`, and platform package managers are spawned with argv arrays,
  not shell command strings except where the external installer contract is a
  shell script.
- **Backups precede mutation.** Deployed settings/config files write `.bak`
  backups before replacement.
- **Runtime payload is in memory.** `SoT/` remains the reviewed authoring tree;
  generated payload freshness gates build/package production, and EngineNative
  never needs an adjacent runtime `SoT/` directory.

## Output Policy (log UX contract)

The default run reads like a change report: only actual changes, actionable
warnings, and the summary. Status-quo confirmations exist but are opt-in.
(Rationale + full call-site audit: `docs/plans/active/cli-log-ux-overhaul.md`.)

### Channels and levels

| Emitter | Channel | Default | `--verbose` | Prefix / form |
|---|---|---|---|---|
| `error(msg)` | stderr | shown | shown | `[err]` red (`\x1b[1;31m`) |
| `warn(msg)` | stderr | shown | shown | `[warn]` yellow (`\x1b[1;33m`) |
| `change(msg)` | stderr | shown | shown | `[ok]` green (`\x1b[1;32m`) — ONLY after an operation actually mutated |
| `verbose(msg)` | stderr | hidden | shown | `[ok]` green — no-op confirmations ("already …", "present", "up to date", "left as-is"), skips |
| `progress(msg)` | stderr | interactive only | interactive only | dim, transient single-line status with no newline |
| `data(line)` | stdout | shown | shown | bare — dry-run report lines, `status --json`, summary block, usage text |

- stdout is data, stderr is logs — the logger NEVER writes to stdout
  (`engineCapture` depends on it).
- **Dry-run is a complete inspection report**: `[dry-run]` lines are `data`,
  printed unfiltered at every verbosity.
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
jq has no runtime consumer, while curl warns only when a requested POSIX Bun
bootstrap needs an installer download. A missing Bun defers Claude runtime
migration without deleting working legacy hooks or statusline files.

### Summary and next steps

`model` and `toolchain` modes have no separate summary block by design —
their stdout IS the deliverable (`deployed:`/`SoT:` + catalog lines for
`model`; the report table for `toolchain check`), so nothing prints after
it. The schema below applies to `sync` only.

The `--- Sync complete ---` block (stdout, `data`) prints on every run,
including dry-run, with the per-target inventory lines (`Claude:`/`Hooks:`/
`Plugins:`/`Codex:`/`Skills:`). Next-step advice lines print only when their
trigger changed this run (plugins changed → `/reload-plugins` line; hooks/env
changed → restart line; skills changed → discovery line) or under `--verbose`.

### Platform seam

All host detection routes through `os/index.ts`, which holds the engine's only
`process.platform` read and keeps platform normalization injectable for tests.
Per-OS facts live in one module per OS behind `HostOs`; consumers select those
facts through the package rather than branching on the host directly.

### Verbosity plumbing

`--verbose` / `-v` on the public `sync`, `model`, and `toolchain` commands;
`DOCKS_KIT_VERBOSE=1` selects it on the harness-private raw channel (same
`${VAR:-default}` contract as the other `Ctx` env globals). The default
service factory returns a raw Logger. `runEngineNative` wraps the default or
injected Logger with explicit delegates and owns the sole `ctx.verbose` gate.
There is no factory-level verbosity callback, module-global verbosity flag, or
active logger binding.

## Module Map

| Module | Owns |
|---|---|
| `parseArgs.ts` | engine usage, target selection, flag parsing, legacy rename hints, model flag validation |
| `index.ts` | sync orchestration, target dispatch, run summary and next-step blocks |
| `../payload.ts` | generated text/byte payload reads and presentation-only source labels |
| `claudeSync.ts` | Claude pipeline: Bun bootstrap, prepared settings transaction, runtime assets, deploy-time modifiers, `~/.claude.json`, readiness-gated removed artifacts, plugins, optional plugins, LSP binaries |
| `bun.ts` | per-run memoized Bun resolution/bootstrap shared by the Claude runtime and direct toolchain ensure |
| `claudeRuntime.ts` | sentinel validation, absolute runtime paths, no-cutover settings projection, and POSIX statusline commands |
| `settings.ts` | pure Claude settings merge/reconcile semantics and permission-array union |
| `claudeModel.ts` | deployed Claude model modifier and direct `model claude` write path |
| `codexSync.ts` | Codex pipeline: bubblewrap check, config merge, rules, AGENTS.md, personal marketplace, plugin refresh |
| `codexToml.ts` | line-based top-level TOML replacement and deployed Codex model modifier |
| `skillsSync.ts` | universal skill install/prune, Claude symlink healing, managed-skill snapshot |
| `toolchain.ts` | tool presence/version probes, verified-version floor reporting, report table |
| `modes.ts` | direct `model` and `toolchain` modes |
| `models.ts` | model catalog listing and validation |
| `jq.ts` | JSON helpers that preserve jq-style merge/order/stringify behavior where the deployed file contract needs it |
| `exec.ts` | slash-stable path helpers, POSIX command probes, capture/spawn wrappers, and change-detecting write/copy helpers |
| `logger.ts` | Logger shape + stable raw stdout/stderr sink factory; the run-scoped verbosity gate lives in `index.ts` |
| `deps.ts` | external-tool registry: identity, requirement class, presence probe, supported-host install hints, per-manager missing-tool dedup; callers supply the current run Logger to `warnMissing` |
| `os/` | host reader, injected platform normalization, and per-OS `HostOs` fact modules |
| `services.ts` | shared raw-Logger + DependencyManager + Platform factory; wrapped in Effect Layers at `cli/src/services.ts`, with the run-scoped Logger gate applied only by `runEngineNative` |

## Platform Support

- EngineNative supports Linux and macOS on x64 and arm64.
- Unsupported hosts fail before launcher fallback, dependency probes, downloads,
  settings writes, or sync work.
- Runtime hooks use POSIX commands and absolute Bun paths.
- Directory linking is capability-driven. The host module supplies only the
  order while the runtime decides the outcome: symlink, then a Windows junction
  with an absolute target, then a recursive copy. Copies carry a kit marker so
  later sync can heal them back to a real link and prune can reclaim them
  without touching user-owned directories.

## Tests

- `bun run test:unit` covers pure JSON merge semantics and jq-oracle cases.
- `bun run golden:dryrun` compares live native dry-run output to
  `cli/test/goldens/dryrun.json`.
- `bun run golden:mutation` compares live native mutation snapshots, argv logs,
  output, and TOML invariants to `cli/test/goldens/mutation.json`.
- `.github/workflows/parity.yml` is the golden-regression workflow: Linux runs
  unit + golden + prove-red plus the exact materialized POSIX runtime commands.
- `.github/workflows/release-cli.yml` publishes the four Linux/macOS x64/arm64
  binaries, `SHA256SUMS`, and the npm package.

## Non-Goals

- Reintroducing the removed shell engine as a supported fallback. Fix forward in
  EngineNative; recover historical source only from `bash-engine-final`.
- Adding a compiled runner or CLI hook subcommand for Claude's Bun runtime.
- Adding new sync features while changing the engine contract.
