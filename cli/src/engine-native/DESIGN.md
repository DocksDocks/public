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
- **Step ordering is load-bearing.** The Claude pipeline runs RTK before the
  settings merge, modifiers after it, removals before plugins, and LSP checks
  after plugin state.
- **External CLIs stay external.** `claude`, `codex`, `npx`, `npm`, `rtk`,
  `bun`, `curl`, and platform package managers are spawned with argv arrays,
  not shell command strings except where the external installer contract is a
  shell script.
- **Backups precede mutation.** Deployed settings/config files write `.bak`
  backups before replacement.

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
| `data(line)` | stdout | shown | shown | bare — dry-run report lines, `status --json`, summary block, usage text |

- stdout is data, stderr is logs — the logger NEVER writes to stdout
  (`engineCapture` depends on it).
- **Dry-run is a complete inspection report**: `[dry-run]` lines are `data`,
  printed unfiltered at every verbosity.
- Prefixes and ANSI codes are stable golden surface; the level controls
  visibility, not the prefix.

### Change detection

Every mutating operation reports `changed: boolean`. A changed outcome logs
via `change`; an unchanged outcome logs via `verbose`. Operations that today
rewrite deployed files unconditionally may skip a provably-identical rewrite —
each such skip is an intentional behavior change named in its golden diff.

### Missing dependencies

Exactly one deduplicated warn per missing tool per run, uniform shape:
`[warn] <tool> not installed — <platform-correct install command>`, sourced
from the dependency registry (`deps.ts`). Required tools keep their current
exit behavior — the error carries the same install hint.

### Summary and next steps

`model` and `toolchain` modes have no separate summary block by design —
their stdout IS the deliverable (`deployed:`/`SoT:` + catalog lines for
`model`; the report table for `toolchain check`), so nothing prints after
it. The schema below applies to `sync` only.

The `--- Sync complete ---` block (stdout, `data`) prints on every run,
including dry-run, with the per-target inventory lines (`Claude:`/`Hooks:`/
`RTK:`/`Plugins:`/`Codex:`/`Skills:`). Next-step advice lines print only when
their trigger changed this run (plugins changed → `/reload-plugins` line;
hooks/env changed → restart line; skills changed → discovery line) or under
`--verbose`.

### Platform seam

All platform branching routes through `os.ts` — the only engine module that
reads `process.platform`, with one named exemption: `exec.ts`'s path/exec
primitives (`commandExists` PATHEXT resolution and `X_OK` probing) stay
self-contained because they sit below the seam. `deps.ts` install hints
default their platform from `os.ts` and keep the parameter injectable for
tests.

### Verbosity plumbing

`--verbose` / `-v` on the public `sync`, `model`, and `toolchain` commands;
`DOCKS_KIT_VERBOSE=1` selects it on the harness-private raw channel (same
`${VAR:-default}` contract as the other `Ctx` env globals).

## Module Map

| Module | Owns |
|---|---|
| `parseArgs.ts` | engine usage, target selection, flag parsing, legacy rename hints, preflight, model flag validation |
| `index.ts` | sync orchestration, target dispatch, run summary and next-step blocks |
| `claudeSync.ts` | Claude pipeline: RTK, assets, settings merge, deploy-time modifiers, `~/.claude.json`, connector env, removed artifacts, plugins, optional plugins, LSP binaries |
| `settings.ts` | pure Claude settings merge/reconcile semantics and permission-array union |
| `claudeModel.ts` | deployed Claude model modifier and direct `model claude` write path |
| `codexSync.ts` | Codex pipeline: bubblewrap check, config merge, rules, AGENTS.md, personal marketplace, plugin refresh |
| `codexToml.ts` | line-based top-level TOML replacement and deployed Codex model modifier |
| `skillsSync.ts` | universal skill install/prune, Claude symlink healing, agent-browser/effect-solutions/Bun helpers, managed-skill snapshot |
| `toolchain.ts` | tool presence/version probes, verified-version gate, managed install/upgrade orchestration, report table |
| `modes.ts` | direct `model` and `toolchain` modes |
| `models.ts` | model catalog listing and validation |
| `jq.ts` | JSON helpers that preserve jq-style merge/order/stringify behavior where the deployed file contract needs it |
| `exec.ts` | path helpers, command probes, capture/spawn wrappers, Windows command resolution, change-detecting write/copy helpers |
| `logger.ts` | stable stdout/stderr emitters and the verbose gate (`change`/`verbose`/`warn`/`err`/`echo`) |
| `deps.ts` | external-tool registry: identity, requirement class, presence probe, platform-correct install hints, dedup'd missing-tool warns |
| `os.ts` | platform capability seam — the single `process.platform` reader (`platformName`, `isWindows`, `isLinux`, shell-rc applicability) |
| `services.ts` | shared service factory (`makeEngineServices`: Logger + DependencyManager + Platform) — wrapped in Effect Layers at `cli/src/services.ts`, called directly by native-raw and `engineCapture` |

## Windows Specifics

- Home resolves through Node's platform APIs; CI deliberately unsets `HOME` so
  `%USERPROFILE%` is exercised.
- Paths are built through `node:path`.
- Connector env uses `setx` on win32; Unix shell rc files are not touched.
- Symlink creation falls back to copy where the platform or permissions require
  it.
- Bubblewrap and shell-rc work are Linux/macOS only.
- Claude hook/statusline assets remain shell scripts because Claude Code owns
  that runtime.

## Tests

- `bun run test:unit` covers pure JSON merge semantics and jq-oracle cases.
- `bun run golden:dryrun` compares live native dry-run output to
  `cli/test/goldens/dryrun.json`.
- `bun run golden:mutation` compares live native mutation snapshots, argv logs,
  output, and TOML invariants to `cli/test/goldens/mutation.json`.
- `.github/workflows/parity.yml` is now the golden-regression workflow: Linux
  runs unit + golden + prove-red; the `native-windows` job runs PowerShell
  smoke checks for native Windows behavior.
- `.github/workflows/windows-entrypoints.yml` verifies the release binary and
  `bun add -g` entrypoints on Windows.

## Non-Goals

- Reintroducing the removed shell engine as a supported fallback. Fix forward in
  EngineNative; recover historical source only from `bash-engine-final`.
- Porting Claude Code's hook/statusline shell assets.
- Adding new sync features while changing the engine contract.
