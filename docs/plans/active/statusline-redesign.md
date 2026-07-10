---
title: Redesign the Claude statusline around native rate-limit data
goal: Preserve Claude's current statusline layout while replacing jq/curl shell hooks and OAuth usage caches with three embedded Bun-run .mjs programs driven by native data.
status: planned
created: "2026-07-10T03:14:32-03:00"
updated: "2026-07-10T03:14:32-03:00"
started_at: null
assignee: null
tags: [claude, statusline, hooks, bun, windows, migration]
affected_paths:
  - SoT/.claude/bin/statusline.mjs
  - SoT/.claude/bin/session-start.mjs
  - SoT/.claude/bin/notify.mjs
  - SoT/.claude/statusline.sh
  - SoT/.claude/fetch-usage.sh
  - SoT/.claude/hooks/notify.sh
  - SoT/.claude/settings.json
  - SoT/toolchain.json
  - cli/scripts/generate-sot-payload.ts
  - cli/src/generated/sotPayload.ts
  - cli/src/engine-native/bun.ts
  - cli/src/engine-native/claudeRuntime.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/DESIGN.md
  - cli/test/fixtures/statusline/
  - cli/test/unit/statusline.test.mjs
  - cli/test/unit/session-start.test.mjs
  - cli/test/unit/notify.test.mjs
  - cli/test/unit/bun.test.ts
  - cli/test/unit/claudeRuntime.test.ts
  - cli/test/unit/deps.test.ts
  - cli/test/lib/harness.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - .github/workflows/parity.yml
  - .github/workflows/windows-entrypoints.yml
  - README.md
  - AGENTS.md
  - CLAUDE.md
  - cli/docs/install.md
  - cli/docs/overview.md
  - cli/docs/platforms.md
  - cli/docs/sync-layers.md
  - cli/docs/toolchain.md
  - .claude/skills/settings-merge-context/SKILL.md
  - .claude/skills/sync-orchestration-context/SKILL.md
  - .claude/skills/sync-orchestration-context/references/dispatch-flow.md
  - .claude/skills/sync-orchestration-context/references/flag-matrix.md
  - .claude/skills/toolchain-context/SKILL.md
  - .claude/skills/universal-skills-context/SKILL.md
  - .claude/agents/skills-bootstrap-agent.md
  - .codex/agents/skills-bootstrap-agent.toml
  - .claude/agents/settings-json-agent.md
  - .codex/agents/settings-json-agent.toml
  - .claude/agents/sync-mechanic-agent.md
  - .codex/agents/sync-mechanic-agent.toml
  - CHANGELOG.md
related_plans: [embed-sot-payload]
review_status: null
planned_at_commit: "c727ba5b609a5b972f95ed49eb84c052d0b45f62"
---

## Goal

Keep the current single-line Claude status display — `model | folder • branch | ctx X% (Xk/Xk) | 5h X% (reset) • 7d X% (reset)` with the same segment order, separators, ANSI colors, model suffix stripping, compact-window calculation, token formatting, and optional branch — while replacing its plumbing. Claude's native `rate_limits` statusline input becomes the only quota source; three small dependency-free `.mjs` programs under `~/.claude/bin/` replace the statusline, SessionStart shell snippets, Notification shell script, and Stop usage fetch. The kit resolves or bootstraps a pinned Bun and materializes absolute, platform-correct settings paths only after the runtime and scripts are ready.

The shipped result must have no runtime dependency on jq or curl, no access to OAuth credentials or Keychain, no quota network request, and no persistent/shared cache. Missing optional input must remove only the affected segment, and a missing Bun at sync time must defer the cutover without deleting a working legacy installation or writing a broken pointer.

## Context & rationale

- User decision (verbatim, 2026-07-10): **"Same layout, native data"** — preserve the exact current visual layout; change the plumbing only. A later restyle is a separate concern.
- User decision (verbatim, 2026-07-10): **"Tiny bun-run .mjs scripts"** — `statusline.mjs`, `notify.mjs`, and `session-start.mjs` live under `~/.claude/bin`, are deployed from the embedded payload, and run on the kit-bootstrapped Bun. There is no compiled hook runner and no `docks-kit` hook subcommand.
- User decision (verbatim, 2026-07-10): **"Drop fetch-usage entirely"** — there is no OAuth fallback. When `rate_limits` is absent (API-key users, unsupported plans, or before Claude's first API response), the quota segment is omitted.
- Claude's current statusline contract now supplies `rate_limits.five_hour` and `rate_limits.seven_day`, each with `used_percentage` and Unix-epoch-seconds `resets_at`. The whole `rate_limits` object, and either individual window, may be absent. `context_window.used_percentage` and usage detail may also be null early in a session or after compaction.
- Claude always invokes `statusLine.command` through a shell. On Windows that is Git Bash when available and PowerShell otherwise. Command hooks support shell-free direct exec via `command` + `args`; on Windows the command must be a real executable, not a `.cmd`/`.bat` shim. Therefore hooks point directly at the resolved `bun`/`bun.exe`, while the statusline gets a platform-specific shell guard around that same absolute binary and script.
- SessionStart's documented input does not currently promise `effort.level` (although statusline input does). The new script therefore preserves today's deployed setting semantics with an explicit precedence chain rather than assuming an undocumented field.
- The current shell implementation is a **visual/layout reference only**. It is not an implementation template and must not be executed as a byte oracle in the new tests. The rewrite uses native JSON parsing, Bun/JS filesystem and process APIs, injected clocks/environments in tests, and hard-coded expected layout bytes.
- The embedded payload shipped immediately before this plan. New authoring scripts must be added to the explicit generator allowlist and `cli/src/generated/sotPayload.ts` regenerated; runtime reads continue through `payloadText`, never checkout-relative file access.
- Current global preflight aborts any Claude/Codex sync when jq is absent and any Claude sync when curl is absent. That is obsolete: EngineNative's JSON merge is native, and curl remains needed only at individual download sites such as POSIX Bun/RTK bootstrap.
- Security improves materially: the old `fetch-usage.sh` reads `~/.claude/.credentials.json` or macOS Keychain, writes a bearer token to `/tmp/.claude_token_cache`, calls the OAuth usage endpoint, and coordinates through predictable global `/tmp` names. Native `rate_limits` removes the entire secret/network/cache surface.

## Interfaces & data shapes

### 1. Statusline program

`SoT/.claude/bin/statusline.mjs` is both importable and directly runnable. It has no package imports; only Bun/standard JS APIs are allowed.

```js
/** Claude fields consumed by the formatter; unknown fields are ignored. */
export function formatStatusline(input, options = {})

/** Direct-program seam: reads all stdin, writes one line or nothing, returns an exit code. */
export async function main(options = {})

if (import.meta.main) process.exit(await main())
```

`formatStatusline` returns a string **without** a trailing newline. `main` appends exactly one `\n` when the formatter returns a non-empty string. The formatter is pure: its test-only options are `{ env = process.env, nowMs = Date.now(), cwd = process.cwd(), branch = "" }`. `main` owns the only I/O and injects `{ readStdin, writeStdout, env, nowMs, cwd, which, spawnSync }`; it resolves the branch before calling the formatter. The accepted input projection is:

```ts
interface StatuslineInput {
  readonly model?: { readonly display_name?: string | null }
  readonly workspace?: { readonly current_dir?: string | null }
  readonly cwd?: string | null
  readonly context_window?: {
    readonly used_percentage?: number | null
    readonly context_window_size?: number | null
  } | null
  readonly rate_limits?: {
    readonly five_hour?: RateLimitWindow | null
    readonly seven_day?: RateLimitWindow | null
  } | null
}

interface RateLimitWindow {
  readonly used_percentage?: number | null
  readonly resets_at?: number | null // Unix epoch seconds, not ISO text
}
```

Formatter rules are fixed:

1. Model = a string `model.display_name` with the first ` " ("` suffix and everything after it removed; a missing/null/non-string model becomes the current empty model slot. Folder = the last `/` or `\\` component of string `workspace.current_dir`, then string input `cwd`, then the supplied process cwd, so Windows paths characterize correctly even when tests run on POSIX.
2. Branch lookup is the only child process. When `git` exists, run `git -C <dir> symbolic-ref --short HEAD`; on nonzero, run `git -C <dir> rev-parse --short HEAD`; otherwise omit the branch. Decode stdout only on a successful spawn, trim it, and never cache a branch across invocations/worktrees.
3. Context accepts `used_percentage` only as a finite number in `[0,100]`. Round it; when `context_window_size` is a finite positive number, derive used tokens from percentage × total. If `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is a decimal positive integer below the model total, show percentage and denominator against that effective cap; invalid/empty caps are ignored. Token units stay `Xk`, integral `XM`, or one-decimal `X.XM`. If only percentage exists, render `ctx N%` without token parentheses.
4. Each quota window is independent. Accept `used_percentage` only as a finite number in `[0,100]`, including zero, then round it. Accept `resets_at` only as finite non-negative epoch seconds; show `now` when elapsed or the current implementation's largest truncated unit (`d`, then `h`, then `m`, including `0m` for a positive sub-minute delta). Missing/invalid reset omits only the parentheses; missing/invalid utilization omits only that window. The quota-opening ` | ` appears only if at least one window renders; the soft dot appears only when both render.
5. ANSI bytes stay pinned to the current palette: model 256-color 208 bold; folder RGB `76;208;222` bold; branch RGB `192;103;222` bold; context RGB `130;160;230`; five-hour RGB `100;200;200`; seven-day RGB `230;180;90`; separators `90`; parentheticals dim RGB `156;162;175`; every segment resets before the next separator.
6. Malformed JSON, arrays/primitives, or a stdin read failure exits 0 with no stdout/stderr. The documented fields are narrowed from unknown at the external Claude boundary; no cast asserts the schema and no catch-all wraps internally trusted formatter/helper calls.

### 2. SessionStart program

`SoT/.claude/bin/session-start.mjs` exports and directly runs:

```js
export function sessionStartLines(options = {})
export async function main(options = {})
if (import.meta.main) process.exit(await main())
```

It writes exactly two newline-terminated lines, preserving the deployed labels:

```text
[CONTEXT] Current date: <weekday>, YYYY-MM-DD HH:mm:ss <local-zone>
[CONFIG] Context: <200K|1M> | Compact-window: <value|full> | Effort: <value|default> | Thinking: adaptive | Subagent: <value|default>
```

`options` supplies `{ env, now, home, readText }` for deterministic tests. Context remains `200K` only when `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. Effort precedence is: non-empty `CLAUDE_CODE_EFFORT_LEVEL` → parsed `${home}/.claude/settings.json` non-empty string `effortLevel` → `default`. The hook does **not** consume `effort.level`: the current SessionStart input contract does not document it. Compact window and subagent preserve their current non-empty environment-variable fallbacks. Invalid/missing/non-object settings JSON is treated as no configured effort, without warning. Local date fields are assembled explicitly and the short local-zone label is injected/extracted through `Intl.DateTimeFormat`, so a fixed UTC test pins the exact two lines.

### 3. Notification/Stop program

`SoT/.claude/bin/notify.mjs` exports and directly runs:

```js
export function selectPlayer(options = {})
export async function main(options = {})
if (import.meta.main) process.exit(await main())
```

It resolves the sound as `../notification.mp3` relative to `import.meta.dir`, exits 0 when absent, and preserves player priority and argv: macOS `afplay <sound>`; then `ffplay -nodisp -autoexit -loglevel quiet <sound>`; `paplay <sound>`; `aplay -q <sound>`. Discovery uses injected/default `Bun.which`; execution uses injected/default `Bun.spawnSync` with stdin/stdout/stderr ignored. A selected player's `exitCode` becomes the program exit code; it does not silently fall through to a second player after a real playback failure. Notification and Stop both point to this same script, so Stop now produces the completion sound instead of refreshing quota data.

### 4. Bun bootstrap and settings materializer

Move the existing bootstrap out of `skillsSync.ts` because Claude runtime and effect-solutions are now independent callers:

```ts
// cli/src/engine-native/bun.ts
export function bunBootstrap(ctx: Ctx, services: EngineServices): string
```

Return the resolved absolute executable path or `""`. Existing Bun resolution in `deps.ts` must recognize `bun.exe` under `%USERPROFILE%\.bun\bin` as well as POSIX `~/.bun/bin/bun`, honoring `BUN_INSTALL` first. On dry-run, probe prerequisites, print the planned pinned bootstrap, and return the predicted absolute executable without spawning or writing. POSIX downloads `https://bun.sh/install` to a process-unique temp file with curl, then runs `bash <file> bun-v<verified>`; Windows downloads `https://bun.sh/install.ps1` to a process-unique temp file with direct `powershell.exe -NoProfile -NonInteractive -Command <Invoke-WebRequest script>`, then runs direct argv `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <file> -Version <verified>`. Both paths remove the temp file in `finally` and re-probe; neither uses a download pipe or a floating version. The current official Windows installer declares `[String]$Version`, and the POSIX installer documents its first argument as a release tag, so both argv forms are pinned in unit tests.

Materialization is pure and lives separately from filesystem mutation:

```ts
// cli/src/engine-native/claudeRuntime.ts
export interface ClaudeRuntimePaths {
  readonly bun: string
  readonly statusline: string
  readonly sessionStart: string
  readonly notify: string
}

export function claudeRuntimePaths(claudeDir: string, bun: string): ClaudeRuntimePaths

export function materializeClaudeSettings(
  template: Json,
  runtime: ClaudeRuntimePaths | undefined,
  platform: Platform
): Json

export function statusLineCommand(runtime: ClaudeRuntimePaths, platform: Platform): string
```

`SoT/.claude/settings.json` remains the human-readable authoring template. Its Bun-owned portion is exactly:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "__DOCKS_KIT_BUN__",
        "args": ["__DOCKS_KIT_SESSION_START__"],
        "timeout": 5
      }]
    }],
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "__DOCKS_KIT_BUN__",
        "args": ["__DOCKS_KIT_NOTIFY__"],
        "timeout": 10,
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "__DOCKS_KIT_BUN__",
        "args": ["__DOCKS_KIT_NOTIFY__"],
        "timeout": 5,
        "async": true
      }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "__DOCKS_KIT_STATUSLINE__",
    "refreshInterval": 5
  }
}
```

The surrounding PreToolUse, PostToolUseFailure, SubagentStop, permissions, plugins, and other settings remain byte-for-byte authoring concerns. Validation is location-aware, not a generic string replacer: Bun must occur in exactly the three handler `command` slots above, notify exactly twice in their one-element `args`, SessionStart exactly once, and statusline exactly once; any missing sentinel, extra occurrence, wrong field, or sentinel residue is an error before filesystem mutation. With a runtime it emits:

- one SessionStart command hook: `{ "type": "command", "command": <absolute bun>, "args": [<absolute session-start.mjs>], "timeout": 5 }`;
- Notification and Stop command hooks pointing to the same absolute Bun + notify script, retaining `timeout` 10/5 respectively and `async: true`;
- `statusLine.refreshInterval: 5` with a guarded shell command. POSIX emits exactly `test -x <q-bun> && test -f <q-script> && exec <q-bun> <q-script> || true`, where the dedicated POSIX literal helper safely quotes apostrophes. Windows builds `if ((Test-Path -LiteralPath <ps-bun> -PathType Leaf) -and (Test-Path -LiteralPath <ps-script> -PathType Leaf)) { & <ps-bun> <ps-script> }`, converts paths to forward slashes, encodes that script as UTF-16LE base64, and stores `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64>`. The outer command is therefore safe under either Git Bash or PowerShell; tests decode the payload and execute paths containing spaces and apostrophes.

With `runtime === undefined`, the materializer removes only `hooks.SessionStart`, `hooks.Notification`, `hooks.Stop`, and top-level `statusLine` before merge/install; it retains the safe PreToolUse, PostToolUseFailure, and SubagentStop template entries. That is the no-cutover form: an existing user's old hook/statusline keys survive both additive and reconcile merge as user-only keys; a fresh home gets the unrelated safe hooks but no Bun-owned pointers. `syncSettings` accepts only the already-materialized parsed document, validates existing JSON first, serializes before mutation, and uses temp-plus-rename for first install and replacement (retaining the existing `.bak` on replacement). No sentinel-bearing or partially materialized document may reach disk.

### 5. Transaction and output contract

The Claude pipeline order is load-bearing:

```text
RTK attempt → CLAUDE.md → Bun resolve/bootstrap
→ when Bun is ready, write all 3 .mjs + notification.mp3
→ materialize and atomically merge/install settings (runtime or no-cutover form)
→ baseline removals + readiness-gated legacy .sh removals
→ modifiers / .claude.json / connectors / plugins / LSP servers
```

`syncClaudeRuntime` returns one state, and `claudeSync` returns it through `index.ts` to `claudeSummary`; settings and removals consume the same value rather than re-probing:

```ts
export type ClaudeRuntimeState =
  | { readonly kind: "ready"; readonly paths: ClaudeRuntimePaths }
  | { readonly kind: "deferred"; readonly reason: "bun-unavailable" }

export function claudeSync(ctx: Ctx): ClaudeRuntimeState
export function claudeSummary(ctx: Ctx, runtime: ClaudeRuntimeState): void
```

If Bun remains unavailable, continue non-hook Claude configuration with the no-cutover settings form, do not write/delete runtime assets, and emit exactly:

```text
[warn] Bun unavailable — Claude statusline/hooks migration deferred; install Bun, then re-run sync claude
```

The dependency registry demotes jq/curl `Requirement` from `required` to `optional`; `SoT/toolchain.json` changes their `kind` from `required` to `check`. With no remaining hard dependency, delete `preflight` from `parseArgs.ts`, its `index.ts` call/import, and the corresponding repo-local skill/agent documentation. Missing jq never warns during normal sync because it has no runtime consumer. On non-Windows, `syncRtk` checks curl before attempting a missing-RTK install, and `bunBootstrap` checks it before a missing-Bun install. Missing curl warns only at that actual download boundary, via the existing registry hint and one of these contextual suffixes:

```text
(cannot download RTK installer; continuing sync without RTK)
(cannot bootstrap Bun; install Bun manually, then re-run sync)
```

Successful/replay output bytes are also fixed:

```text
[dry-run] install statusline.mjs, session-start.mjs, notify.mjs, notification.mp3
[ok] Claude runtime synced (statusline, session-start, notify, notification)
[ok] Claude runtime already in sync (statusline, session-start, notify, notification)  # --verbose only
Hooks:    Bun (statusline, session-start, notify)
Hooks:    migration deferred (Bun unavailable; existing hook/statusline settings preserved)  # deferred only
```

Delete the old separate `Scripts synced...` / `Hooks synced...` branches and shell-script counter. Add the three legacy paths to named `REMOVED_MANIFEST` subsets but pass the single runtime-ready state into `syncRemovals`, so baseline stale entries still prune on a deferred run while `statusline.sh`, `fetch-usage.sh`, and `hooks/notify.sh` prune only after the materialized settings write succeeds. The aggregate format remains unchanged: a populated legacy home reports `Pruned stale artifacts (hooks: 1, files: 2, settings keys: 0, claude.json keys: 0)` after cutover.

## Environment / how to run

Repository root: `/home/vagrant/projects/public`. Runtime/toolchain pin comes from `SoT/toolchain.json` (currently Bun 1.3.14); never repeat the number in source code. Generate embedded bytes after authoring-payload changes:

```bash
bun cli/scripts/generate-sot-payload.ts
bun cli/scripts/generate-sot-payload.ts --check
```

Per-slice gate (run after every numbered implementation step, before its commit):

```bash
bun x tsc --noEmit -p cli/tsconfig.json
bun x vitest run
bun cli/test/golden-dryrun.ts
bun cli/test/golden-mutation.ts
bun cli/test/golden-dryrun.ts --prove-red   # must print prove-red OK and exit 1
bun cli/test/golden-mutation.ts --prove-red # must print prove-red OK and exit 1
bun cli/scripts/generate-sot-payload.ts --check
```

The two expected-nonzero prove-red legs must be run separately so a shell `&&` does not hide the second check. Before the Step-3 golden recording, all existing labels must either be green or have an explicitly predicted output/tree/argv change below.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Characterize the visual contract and land dormant Bun scripts.** Add representative native-input fixtures and hard-coded ANSI expectations for: full line on a branch, detached HEAD, no git, capped/uncapped context, each quota alone, both quotas, elapsed/missing/invalid resets, zero/invalid percentages, absent/null `rate_limits`, early null context, malformed/non-object JSON, and POSIX/Windows paths. Implement the three importable/direct-run `.mjs` files to the interfaces above. Temporarily add them alongside the old three shell entries in the payload allowlist and regenerate `sotPayload.ts`, but keep old deployment/settings active so goldens stay byte-identical. The `.test.mjs` suites prove pure helpers plus direct stdout/stderr/exit behavior. A 30-run direct-Bun sanity check discards five warmups and requires p95 ≤100 ms on Linux/macOS and ≤200 ms on Windows for fixed non-git input. | — | pending |
| 2 | **Make Bun and settings materialization cross-platform, still dormant.** Extract `bunBootstrap` to `bun.ts`; update `skillsSync.ts` and `modes.ts` imports; support `BUN_INSTALL`, `bun.exe`, dry-run prediction, pinned POSIX/Windows download-then-run argv, `finally` cleanup, and re-probe. Add `claudeRuntime.ts` with exact location/cardinality validation, direct-exec hook shapes, POSIX and UTF-16LE-encoded PowerShell statusline guards, no-cutover stripping, and first-install atomic serialization. Unit-test both bootstrap platforms, missing-curl context, spaces/apostrophes, decoded PowerShell bytes, every materializer branch, and sentinel residue. Do not call the materializer, demote dependencies, or change deployed behavior yet; goldens remain byte-identical. | 1 | pending |
| 3 | **Atomic cutover, dependency demotion, migration, and the only golden-update window.** Replace `syncScripts`/`syncHooks`/raw-template settings with the single ready/deferred transaction above. Install the exact template; demote jq/curl in `deps.ts` and `SoT/toolchain.json`; remove the now-dead `preflight` export/call; and add jq-free Claude/Codex plus contextual-curl cases. Delete the three old authoring shell assets and their payload entries, leaving exactly the three `.mjs` replacements. Add the old deployed paths to readiness-gated `REMOVED_MANIFEST` subsets. Failure tests prove legacy settings/files survive bootstrap failure, a fresh home retains safe hooks without broken pointers, runtime assets precede settings, invalid deployed JSON aborts before cleanup, summary state is truthful, and replay is a no-op. Update each golden exactly once in one review window, never by hand, after inspecting all authorized labels. | 2 | pending |
| 4 | **Prove native execution and refresh every documented owner.** Extend `parity.yml` to invoke the exact materialized direct hooks and shell statusline command on Ubuntu and native PowerShell with JSON stdin, paths containing spaces/apostrophes, pinned bytes/channels, and full-command p95 sanity ceilings of 250 ms POSIX / 750 ms Windows (30 runs, discard five). In `windows-entrypoints.yml`, remove raw sentinel-template seeding. The compiled no-Bun job restricts PATH to Windows system directories, points `BUN_INSTALL` at an existing regular file so the official installer cannot create `bin`, seeds marker legacy scripts + old pointers explicitly, runs real sync, and proves byte preservation/deferred output. The Bun-shim job syncs from a foreign cwd and executes SessionStart, Notification, Stop, and statusline by reading deployed settings. Update DESIGN, bundled docs, README/AGENTS/CLAUDE, and CHANGELOG for native quotas, no OAuth cache, optional jq/contextual curl, shared Bun bootstrap, and fallback behavior. Refresh the settings/toolchain/universal/sync skills plus the skills/settings/sync Claude↔Codex wrapper-agent twins with module + function + semantic anchors and `metadata.updated`. | 3 | pending |
| 5 | **Full falsification and handoff.** Run the complete gate plus payload freshness. Run targeted live fixture smokes for full native data, no `rate_limits`, missing jq, missing curl with/without existing Bun, missing Bun on a fresh and legacy home, and repeat sync. Temporarily sabotage one layout byte, one stdout/stderr route, the Windows guard, and the migration-ready gate to prove the corresponding tests fail; revert each sabotage. Verify affected-path scope, inspect the single golden recording diff label-by-label, record command tails/counts in Notes, and move the plan to `in_review` for an independent goal-vs-diff review. | 1–4 | pending |

### Golden recording ledger (Step 3 only)

Run each `--update-goldens` command exactly once after all Step-3 unit/failure tests are green. Every authorized diff must fit this shape:

```bash
bun cli/test/golden-dryrun.ts --update-goldens
bun cli/test/golden-mutation.ts --update-goldens
```

| Surface | Authorized change |
|---|---|
| Dry-run output | Replace the old `cp statusline.sh, fetch-usage.sh, notification.mp3` and hook-directory copy lines with the single fixed `.mjs` runtime-install line; settings still identify the embedded SoT template as their source. |
| Real/verbose hook messages | Replace `Scripts synced/already...` plus `Hooks synced/already...` with the fixed `Claude runtime synced/already...` line; replace the shell-script-count summary with the truthful Bun/deferred summary. |
| Settings tree hashes | Change only because SessionStart collapses from two shell handlers to one exec handler, Notification/Stop share Bun + notify argv, and statusLine stores the platform guard; no sentinel may appear in a deployed hash input. |
| Runtime tree entries | Remove `.claude/statusline.sh`, `.claude/fetch-usage.sh`, and `.claude/hooks/notify.sh`; add `.claude/bin/{statusline,session-start,notify}.mjs`; retain identical `notification.mp3` bytes. |
| Migration output | Only `migration=legacy-claude-hook-scripts` adds `Pruned stale artifacts (hooks: 1, files: 2, settings keys: 0, claude.json keys: 0)`. |
| Toolchain table | Only jq/curl `KIND` cells change from `required` to `check`; other rows/columns are identical. |
| Missing dependencies | The two jq-additive rows exit 0 without a jq warning; the curl-additive row emits exactly the registry hint plus `(cannot download RTK installer; continuing sync without RTK)` on stderr. Bun-without-curl is covered by focused unit/failure tests so the four-row golden budget stays fixed. |
| Child argv | Existing golden rows gain no bootstrap/player/git argv: their Bun stub is already present and deployed scripts are not executed by sync. Any other argv diff is a defect. |

The 15 existing dry-run labels expected to change are exactly the five Claude-running commands for each of `home-fresh`, `home-drift`, and `home-invalid-json`:

```text
fixture=<fixture> cmd=sync --dry-run
fixture=<fixture> cmd=sync --dry-run --reconcile --prune
fixture=<fixture> cmd=sync claude --dry-run
fixture=<fixture> cmd=sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=<fixture> cmd=sync claude --dry-run --claude-plugin=supabase
```

The 15 existing mutation labels expected to change are:

```text
fixture=home-drift cmd=sync --prune
fixture=home-drift cmd=sync --reconcile
fixture=home-drift cmd=sync claude
fixture=home-drift cmd=sync claude --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=home-drift cmd=sync claude --claude-model=fable replay=2nd
fixture=home-drift cmd=sync claude --claude-plugin=supabase,n8n
fixture=home-drift cmd=sync replay=2nd
fixture=home-fresh cmd=sync --verbose replay=2nd
fixture=home-fresh cmd=sync claude
fixture=home-fresh cmd=sync claude stubs=claude
fixture=home-fresh cmd=sync claude stubs=git
fixture=home-fresh cmd=sync replay=2nd
fixture=home-fresh cmd=sync stubs=git
fixture=home-fresh cmd=toolchain check
fixture=home-invalid-json cmd=sync claude
```

Add exactly four mutation cases (final mutation count 51):

```text
fixture=home-fresh cmd=sync claude stubs=jq variant=jq-absent-bun-hooks
fixture=home-fresh cmd=sync codex stubs=jq variant=jq-absent-native-sync
fixture=home-fresh cmd=sync claude stubs=curl,rtk variant=curl-absent-rtk-bootstrap
migration=legacy-claude-hook-scripts
```

The migration case materializes marker bytes at the three legacy paths plus old settings pointers, then proves the final tree contains only the three `.mjs` files plus notification audio and fully absolute settings commands. `fixture=home-fresh cmd=sync claude stubs=rtk` is intentionally **not** authorized: `rtk init` exits nonzero before the runtime phase, so its unchanged tree/output is the abort-order canary. Any change to an existing dry-run label outside the 15, an existing mutation label outside the 15, any unexpected argv change, or a final count other than dry-run 22 / mutation 51 is a defect: revert the recording, fix the slice, and record again only after the ledger is corrected (the failed attempt does not authorize hand-editing JSON).

## Acceptance criteria

- [ ] Controlled full-input fixture renders one newline-terminated line with the pinned ANSI segment order/palette, branch, capped context/tokens, `5h` then soft dot then `7d`, rounded percentages, and deterministic reset countdown. Expected bytes are literal test data; no test calls an old `.sh` oracle.
- [ ] Degradation matrix passes: absent/null `rate_limits` omits all quota text; one absent window preserves the other without an extra dot; utilization `0` renders; out-of-range/NaN utilization omits that window; invalid reset preserves utilization without parentheses; null/invalid context omits only context; invalid compact cap is ignored; missing git/non-repo omits only branch; malformed or non-object stdin exits 0 with empty stdout/stderr.
- [ ] `rg -n "credentials|Keychain|oauth|api\.anthropic|claude_usage|claude_token|usage_fetching" SoT/.claude cli/src/engine-native` finds no live hook/statusline implementation reference (historical docs/changelog statements may describe removal only). No new code reads Claude credentials or writes quota state.
- [ ] SessionStart prints exactly two lines for a fixed UTC clock; tests cover env → settings → default effort precedence and invalid/missing settings, and prove hook stdin cannot override effort. Notification and Stop materialize to the same absolute Bun + notify argv; player selection/argv priority and silent channels are unit-tested on Darwin, Linux, Windows/no-player, playback failure, and missing audio.
- [ ] Deployed `~/.claude/settings.json` contains no sentinel; template cardinalities are Bun=3, notify=2, SessionStart=1, statusline=1; SessionStart has one handler; hook commands use an absolute real `bun`/`bun.exe` plus one-element `args`; statusline uses the POSIX or decoded PowerShell missing-file guard and retains `refreshInterval: 5`. Paths containing spaces/apostrophes execute successfully under POSIX shell and native PowerShell CI.
- [ ] Missing Bun on a legacy home leaves old hook/statusline settings and all three old `.sh` files byte-identical, writes no new runtime assets, and emits the fixed migration-deferred warning + deferred summary; missing Bun on a fresh home installs the unrelated safe hook events but no SessionStart/Notification/Stop/statusLine pointers. Serialization/materialization/settings-validation failure runs no legacy cleanup.
- [ ] Successful cutover writes all new scripts/audio before settings points to them, then removes `~/.claude/statusline.sh`, `~/.claude/fetch-usage.sh`, and `~/.claude/hooks/notify.sh`; immediate replay emits the verbose no-op line only under `--verbose` and makes no tree change.
- [ ] The old `/tmp/.claude_usage_cache`, `/tmp/.claude_token_cache`, and `/tmp/.claude_usage_fetching` are never read and are intentionally **not deleted**: they are global predictable temp paths outside the kit-owned home manifest, may be symlinks or shared with an older concurrent process, and will age out through OS temp cleanup. This decision is stated in user docs/release notes.
- [ ] Missing jq never blocks or warns for `sync claude` or `sync codex`; `DEPENDENCIES.jq/curl.requirement` is `optional`; toolchain reports jq/curl as `check`; `rg -n 'preflight' cli/src/engine-native/{index.ts,parseArgs.ts}` returns no match. Missing curl blocks neither sync globally: it warns only at a requested POSIX RTK/Bun download with the registry hint/context. Windows Bun bootstrap uses downloaded `install.ps1 -Version <pin>` and does not require external curl.
- [ ] Payload generator inventory is exact: the three `.mjs` paths are embedded, the three `.sh` paths are absent, `bun cli/scripts/generate-sot-payload.ts --check` exits 0, and a packed/compiled CLI syncs the scripts from a foreign cwd without publishing `SoT/` files.
- [ ] CI never deploys raw sentinel-bearing `SoT/.claude/settings.json` with `Copy-Item`; workflow homes are produced by the materializer or use an explicit legacy fixture. `rg -n 'Copy-Item.*SoT/\.claude/settings\.json' .github/workflows` returns no match.
- [ ] Latency harness (30 executions, discard first 5) reports direct-Bun p95 ≤100 ms Linux/macOS and ≤200 ms Windows, plus exact deployed-command p95 ≤250 ms POSIX / ≤750 ms Windows, for fixed non-git input; every run has the exact expected stdout and empty stderr.
- [ ] Golden ledger is exact: dry-run remains 22 cases; mutation becomes 51 via only the four named additive rows; existing diffs are confined to the 15 dry-run + 15 mutation labels above and match the fixed output/tree/argv contract; the RTK-init-failure row remains byte-identical. Both prove-red legs print `prove-red OK` and exit 1.
- [ ] Repo-local ownership documentation is current: no skill/wrapper says `preflight` still runs or that `bunBootstrap` lives in `skillsSync.ts`; each changed skill uses semantic anchors, has `metadata.updated: "2026-07-10"`, and each changed Claude wrapper matches its `.codex/agents` twin.
- [ ] Every slice and final handoff pass typecheck, all Vitest tests, both golden suites, both prove-red legs, and generated-payload freshness; native Windows workflow executes the real materialized commands rather than only inspecting JSON shapes.

## Out of scope

- Changing the visual design, colors, segment order, labels, refresh interval, token unit style, or adding cost/session/PR/agent/thinking fields now available in Claude's richer input.
- Retaining an OAuth `/usage` fallback, reading Claude credentials/Keychain, migrating old cache contents, or actively unlinking the three global `/tmp` cache/marker paths.
- Compiling a standalone hook/statusline executable, adding hook subcommands to `docks-kit`, adding a Node fallback, or installing third-party npm packages for these scripts.
- Changing EngineNative's JSON merge/reconcile semantics, plugin behavior, model behavior, notification audio, or player ordering.
- Auto-repairing Bun if a user deletes it **after** a successful settings cutover. The statusline guard becomes a silent no-op; direct-exec hooks can fail until the next `docks-kit sync claude` restores Bun. That external-drift behavior is documented, not hidden behind shell hooks.
- Removing jq from development/test documentation entirely: `cli/test/unit/settings.test.ts` may still use a locally installed jq as a skipped differential oracle. It is not a runtime or sync prerequisite.

## Known gotchas

- `resets_at` is epoch seconds. Treating it as ISO text or milliseconds yields plausible but wrong countdowns; fixtures must pin `now` and use epoch seconds.
- Claude can omit the entire `rate_limits` object and can omit five-hour and seven-day independently. Truthiness checks are insufficient because utilization `0` is valid.
- `statusLine.command` is always shell-evaluated, while hooks with `args` are direct exec. One command string cannot safely serve both contracts, and a Windows `.cmd` Bun shim is invalid for direct hooks.
- Claude chooses Git Bash or PowerShell for statusline execution on Windows. The stored command deliberately launches `powershell.exe` itself; UTF-16LE `-EncodedCommand` keeps the guard/path script opaque to either outer parser. CI must decode/assert it and execute a path containing spaces/apostrophes.
- Sentinel counts are intentionally non-unique: Bun appears three times and notify twice. Validation must check exact named locations/cardinalities; a generic “reject duplicate” rule would reject the valid template.
- The generated payload is the runtime SoT. Adding authoring files without regenerating `cli/src/generated/sotPayload.ts` passes local checkout reads only if code accidentally violates the payload boundary; payload freshness and foreign-cwd tests prevent that regression.
- Settings are additive even under `--reconcile` for user-only keys. Runtime failure therefore preserves legacy Bun-owned hook/statusline keys only if the no-cutover source omits the three event keys and top-level statusLine entirely; replacing them with `{}` or null would erase/break the fallback. The remaining safe hook events must stay in the source.
- `syncRemovals` currently runs after settings. The legacy entries must be a readiness-gated subset, not unconditional additions to the global manifest loop, or a failed bootstrap would delete the fallback files after preserving their pointers.
- `engineCapture` child spawns and compiled Windows re-spawns must keep using the embedded payload and existing executable argv rules. Do not route hooks through `engineCapture` or add a `main.ts` argument to compiled child spawns; the existing Windows status assertions are the canary.
- The legacy fixture may contain invalid deployed settings. The existing invalid-JSON exit happens after script phases today; the new transaction must not remove old files until the settings write succeeds, so the invalid-JSON case remains recoverable.
- Notification and Stop both playing the same sound is intentional. Do not preserve the old Stop fetch by leaving a second handler behind.
- `rtk init` failure happens before runtime deployment. Its existing golden must remain unchanged; authorizing it would hide a transaction-order regression.
- Moving `bunBootstrap` and deleting `preflight` invalidates repo-local skill and wrapper routing even if runtime tests pass. The twin Claude/Codex agent files are one ownership surface and change together.

## Cold-handoff checklist

1. Start from `planned_at_commit`; confirm only expected newer commits exist before implementation and read the current `claudeSync.ts` pipeline, `settings.ts` merge rules, `deps.ts` Bun resolution, payload generator, and both golden matrices before editing.
2. Reverify the official Claude statusline/hook pages and Bun Windows installer parameters if implementation begins after their contracts change; record any drift in Notes before code.
3. Work in numbered slices and include this plan in each commit with the step status and a dated Notes entry. Run all seven per-slice gates, including payload `--check`; never update goldens outside Step 3.
4. Preserve existing output bytes except the fixed runtime/deferred lines and named settings/tree/dependency consequences. Inspect output, tree hashes, and child argv for every golden label in the ledger, including the unchanged RTK-abort canary.
5. If either shell guard cannot execute an absolute path containing a literal apostrophe, stop and fix the platform literal helper/test; do not weaken to PATH-based `bun` or remove the guard.
6. Inject dependencies through the existing manager/platform seams and mock `node:child_process` as `skillsSync.test.ts` already does; do not add production environment backdoors used only by tests.
7. Refresh every listed kit-mechanic skill and both wrapper twins after the source settles; never copy raw line numbers into those prompt surfaces.
8. Finish only after native Windows executes commands read from materialized settings, not a hand-authored equivalent, and an independent plan-review compares `planned_at_commit..HEAD` against every acceptance item.

## Self-review

- Standalone executability: the plan fixes source/deployed paths, interfaces, settings shapes, transaction order, output bytes, golden labels/counts, cross-platform argv, gates, failure behavior, and rollback triggers. An implementer need not recover decisions from chat or the scratchpad. ✓
- Actionability: each step has a bounded artifact and an executable completion proof; the only intentional golden update is isolated and enumerated. ✓
- Dependency order: dormant scripts → shared runtime/materializer → atomic cutover/migration → CI/docs → falsification/review. No slice points settings at an undeployed runtime. ✓
- Evidence/reverification: current source, official Claude statusline/hooks contracts, official Bun runtime/installer contracts, payload boundary, merge semantics, workflow seams, and all current golden labels were opened before drafting. ✓
- Goal coverage: native quotas remove OAuth/cache; `.mjs` scripts remove jq/shell portability; Bun bootstrap/materializer makes the cutover executable; readiness gating protects existing installs; CI/goldens prove layout and platform behavior. ✓
- Executable acceptance: every criterion names an assertion, command, exact message, case count, path shape, or failure injection. ✓
- Failure modes: independent missing fields, malformed input, git absence, no player/audio, missing jq/curl/Bun, bootstrap failure, invalid settings, quoting, foreign cwd, replay idempotence, stale generated payload, and post-cutover Bun deletion are addressed. ✓
- Assumption → question discipline: all three product choices were explicitly resolved; remaining technical ambiguity was closed with current primary documentation and source inspection. No open question remains. ✓
- Weighted score: standalone executability 22/22; actionability 16/16; dependency order 12/12; evidence reverify 10/10; goal coverage 14/14; executable acceptance 12/12; failure modes 8/8; assumption-to-question 4/4; adversarial cold-read 1/2. **Final: 99/100.**
- Score trajectory: **84 → 93 → 97 → 99 → 99 → 99**, stopped after three consecutive 99 plateaus. Pass 1 found the absent exact template, invalid “duplicate sentinel” rule, undocumented SessionStart effort input, false Bun summary, and missing payload gate. Pass 2 found the Windows outer-shell quoting gap and stale kit-mechanic owners. Pass 3 found the inherited 16-label mutation ledger was wrong: the RTK-init-failure row aborts before runtime deployment and must remain unchanged. No open question remains; the retained point reflects that Windows full-command latency is specified as a CI gate, not measured during draft-only work.

## Sources

- [Claude Code statusline documentation](https://code.claude.com/docs/en/statusline) — native input schema, conditional `rate_limits`, epoch-second resets, context nullability, shell execution, refresh interval.
- [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks) — direct command + args execution, Windows executable caveat, SessionStart input/output, Notification behavior.
- [Bun module execution documentation](https://bun.sh/docs/runtime/modules) — `.mjs` loading and `import.meta.main` direct-run seam.
- [Bun process spawning documentation](https://bun.sh/docs/api/spawn) — `Bun.spawnSync` and argv-based execution.
- [Bun official Windows installer](https://bun.sh/install.ps1) — current `[String]$Version` parameter and `%USERPROFILE%\.bun\bin\bun.exe` install target.
- `SoT/.claude/statusline.sh` — current visual palette/order, model/context/token/reset behavior, and unsafe cache fetch trigger to remove.
- `SoT/.claude/fetch-usage.sh` — OAuth/Keychain/curl/token-cache surface removed by native rate limits.
- `SoT/.claude/hooks/notify.sh` + `SoT/.claude/settings.json` — player priority and current SessionStart/Notification/Stop/statusline settings being replaced.
- `cli/src/engine-native/claudeSync.ts:29-48,123-175,217-263,446-538,847-862` — current RTK/assets/settings/removal/summary order and exact message seams.
- `cli/src/engine-native/skillsSync.ts:281-363` + `cli/src/engine-native/deps.ts:113-133,195-255` — current Bun bootstrap callers/resolution, registry requirement values, and missing Windows `bun.exe` candidate.
- `cli/src/engine-native/parseArgs.ts:187-201` + `cli/src/engine-native/index.ts:75-90` — jq/curl hard exits and the now-dead preflight call.
- `cli/src/engine-native/settings.ts:10-48` — additive/reconcile deep-merge behavior that makes source omission the no-cutover representation.
- `cli/scripts/generate-sot-payload.ts:5-27`, `cli/src/payload.ts`, `cli/test/unit/payload.test.ts:31-63` — exact embedded allowlist, completeness inventory, and generated-byte contract.
- `cli/test/golden-dryrun.ts:35-57`, `cli/test/golden-mutation.ts:55-153,215-330`, current golden JSON case keys — 22/47 baselines, channel invariants, replay/abort cases, and additive-label mechanism.
- `.github/workflows/parity.yml:1-217`, `.github/workflows/windows-entrypoints.yml:1-151` — raw sentinel-template copies, native PowerShell, compiled no-Bun, Bun-shim, foreign-cwd, and `engineCapture` seams.
- `.claude/skills/{settings-merge-context,sync-orchestration-context,toolchain-context,universal-skills-context}` + `.claude/agents`/`.codex/agents` twins — documented ownership that must move with materialization, preflight removal, and shared Bun bootstrap.
- `git show cb053df:docs/plans/active/embed-sot-payload.md` (`Authorized golden changes`) — prior 15/15 label authorization and four additive-case structure, revalidated against the current 22/47 matrices.
- `/tmp/claude-1000/-home-vagrant-projects-docks/11ad59fa-3bf5-4aef-b13f-d6fbefdb2dfc/scratchpad/statusline-redesign-notes.md` — resolved product decisions and research handoff; all normative claims above were reverified against current source/docs.

## Notes

- 2026-07-10: Drafted after the embedded-payload plan shipped. The plan deliberately stages new `.mjs` payload bytes before the cutover so every implementation commit remains runnable and golden-stable until the single migration slice.
- 2026-07-10: `/tmp` cache cleanup was considered and rejected: the old names are global/predictable, outside the kit-owned home manifest, and may be shared or symlinked. Removing all readers/writers is sufficient; OS temp cleanup handles residue without an unsafe unlink.
- 2026-07-10: Current-doc recheck closed two cross-platform details: `rate_limits.*.resets_at` is epoch seconds, and the official Bun PowerShell installer declares `Version`, so a downloaded `install.ps1 -Version <verified>` preserves pinning without `irm | iex`.
- 2026-07-10: Critical rewrite of the inherited draft retained the five-slice transaction but corrected the settings contract, external-input validation, Windows quoting, ownership refresh, per-slice payload gate, truthful deferred summary, and mutation ledger (15 changed existing rows, not 16; RTK init aborts before deployment).

## Review

(filled by plan-review on completion)
