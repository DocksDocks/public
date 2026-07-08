---
name: engine-native-context
description: Use when modifying anything under cli/src/engine-native/ (index.ts dispatch, claudeSync.ts, codexSync.ts, skillsSync.ts, toolchain.ts, settings.ts, jq.ts, exec.ts, parseArgs.ts, modes.ts, models.ts, claudeModel.ts, codexToml.ts, output.ts), the engine selector in cli/src/engine.ts (native default, DOCKS_KIT_ENGINE=bash opt-out, compiled re-spawn), the native-raw harness channel in cli/src/main.ts, or the parity harnesses in cli/test/ (parity-dryrun.ts, parity-mutation.ts, lib/harness.ts, fixtures); covers the byte-parity contract with the feature-frozen bash engine (output, file trees, .bak backups, recorded child argv, exit codes), the p() slash-join rule, ExitError as the set-e twin, the ported jq/awk semantics (deepMerge key order, unique codepoint sort, keys[] sorts vs to_entries insertion order, 2-space printer + trailing newline, // on null/false), stub overrides + prove-red + PARITY_FILTER, and the Windows specifics (PATHEXT which, .cmd spawning, %USERPROFILE% resolution, CRLF canonicalization). Not for lib/*.sh bug fixes (use the matching frozen-surface skill: sync-orchestration-context, settings-merge-context, plugin-bootstrap-context, codex-config-merge-context, universal-skills-context, toolchain-context).
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/index.ts
      lines: "1-120"
    - path: cli/src/engine.ts
      lines: "1-56"
    - path: cli/test/lib/harness.ts
      lines: "1-284"
    - path: cli/src/engine-native/DESIGN.md
      lines: "1-60"
  updated: "2026-07-08"
---

# EngineNative: the TS engine and its parity contract

EngineNative (`cli/src/engine-native/`) is the DEFAULT engine on every
platform since the step-6 flip of the `windows-support` plan. The bash
engine (`lib/*.sh`) is feature-frozen: it takes bug fixes only and remains
the zero-dependency escape hatch (`bash lib/engine.sh <same args>`) and the
per-machine revert (`DOCKS_KIT_ENGINE=bash`). Module map and port
rationale: `cli/src/engine-native/DESIGN.md`.

<constraint>
**Byte-parity is the contract.** Until the bash engine is retired, every
EngineNative change must keep it byte-identical to bash across: stdout/
stderr text (including ANSI prefixes from `output.ts`), resulting file
trees, `.bak` backups, recorded child-process argv, and exit codes. Gate
every change with `bun cli/test/parity-dryrun.ts --native` and
`bun cli/test/parity-mutation.ts --native`; scope a partial run with
`PARITY_FILTER=<label regex>`. A deliberate behavior change requires the
matching `lib/*.sh` bug fix in the same commit — never diverge silently.
</constraint>

<constraint>
**Build output-visible paths with `p()` (exec.ts), never `node:path.join`.**
Engine paths appear verbatim in dry-run lines and warns; `path.join` prints
`\` on Windows and breaks output parity. `p()` joins with `/`, which fs
accepts on every platform. (`exec.ts`, the `p()` doc comment)
</constraint>

<constraint>
**Every unguarded bash command is an implicit abort point.** The bash
engine runs `set -euo pipefail`; where bash would die, the port must
`throw new ExitError(status)` (parseArgs.ts) — swallowing a child's exit
status ships a success log over a failed step. This bit the port once:
`rtk init --global` failure was ignored where bash aborts (gpt-5.5 review
finding, fixed in cf0a21e). Conversely, bash arms ending `|| true` map to
ignored failures. (`claudeSync.ts`, the rtk-init ExitError throw)
</constraint>

<constraint>
**Selector geometry.** Public selection lives ONLY at the
`engine()`/`engineCapture()` seam in `cli/src/engine.ts`, AFTER @effect/cli
parses — pickers, `--flag value` space forms, and non-engine commands stay
intact. `DOCKS_KIT_ENGINE=native-raw` in `main.ts` is a HARNESS-PRIVATE
pre-parse bypass (both engines must see identical raw argv); never route
users through it — routing the public selector pre-parse was a live
regression (gpt-5.5 review blocker, fixed in cf0a21e). In a bun-compiled
binary, `engineCapture` re-spawns `process.execPath` with args ONLY
(detected via the virtual entry path `/$bunfs/` POSIX, `~BUN` Windows) —
passing the main.ts path there becomes a stray engine arg.
</constraint>

<constraint>
**No new engine capability goes into `lib/*.sh`.** The bash engine is
frozen (AGENTS.md § Engineering rules). A new flag lands in three places —
`common::parse_args` (parity only), `cli/src/engine-native/parseArgs.ts`,
and the `cli/src/commands/*.ts` option list — plus a parity-matrix row.
</constraint>

## Ported jq/awk semantics — the details that bite

- `deepMerge` (jq `*`): recursive; LEFT operand's key order wins for shared
  keys, right's values win, arrays are replaced not concatenated.
- `uniqueStrings` (jq `unique`): codepoint sort + dedup — not locale sort.
  Harness runs pin `LC_ALL=C` so bash sorts match.
- `jqStringify`: `JSON.stringify(v, null, 2) + "\n"` — jq's 2-space printer
  with the trailing newline. Byte-compared in the tree snapshots.
- jq `//` triggers on BOTH `null` and `false` — porting it as `??` is a
  parity bug for false-valued keys.
- jq `keys[]` SORTS (codepoint); `to_entries` PRESERVES insertion order —
  replicate per call site, don't normalize.
- awk ports (`codexToml.ts` replaceTopLevelSetting, scrub, table merge) are
  record-for-record line transforms — no TOML library (a library reformats
  user configs and breaks parity), quirks preserved deliberately.

## Harness machinery (cli/test/)

- Stubs: `makeStubDir(overrides)` writes argv-recording shebang scripts;
  happy-path bodies pin versions to the SoT manifest; per-row `overrides`
  exercise install/upgrade/gate/failure branches (`null` = tool missing).
  Non-happy-path rows exist because happy-path stubs once hid a real abort
  bug — keep failure branches covered when adding a spawn site.
- `--prove-red` must DETECT planted divergences; run it after harness edits
  (a harness that can't fail proves nothing).
- CRLF: Windows jq writes CRLF (text-mode CRT); tree hashes, output
  normalization, and jqSlurp all compare canonical-LF. MSYS path forms
  (raw / forward-slash / `/c/…` drive) are scrubbed with a unique-basename
  fallback.
- Stub-based parity legs are POSIX-only by design (shebang stubs aren't
  win32-spawnable). Windows coverage = the `native-windows` PowerShell job
  in parity.yml (hermetic space-containing `%USERPROFILE%`, `.cmd` spawn
  canary, gate-branch argv assertions) + the real-machine verify.

## Windows specifics

- `which()` (exec.ts) is PATHEXT-aware; bun 1.3.14's `spawnSync` launches
  `.cmd`/`.bat` directly (CI-verified — the npm canary), so no `cmd.exe /c`
  wrapper is needed at the current pin. If a bun upgrade regresses this,
  the `native-windows` job's npm-row assertion fails first.
- HOME resolution: env `HOME` first, then `os.homedir()` (→
  `%USERPROFILE%` on Windows). CI keeps HOME unset on Windows on purpose.
- Unix-only steps (shell-rc connector export, bwrap, rtk auto-installer)
  gate on platform and print the documented skip/warn — never "Unknown OS".
