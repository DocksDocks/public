---
title: Redesign the Claude statusline around native rate-limit data
goal: Preserve Claude's current statusline layout while replacing jq/curl shell hooks and OAuth usage caches with three embedded Bun-run .mjs programs driven by native data.
status: in_review
created: "2026-07-10T03:14:32-03:00"
updated: "2026-07-10T06:22:15-03:00"
started_at: "2026-07-10T04:59:37-03:00"
in_review_since: "2026-07-10T06:22:15-03:00"
assignee: "codex gpt-5.6-sol xhigh (orchestrated by claude)"
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
  - cli/src/engine-native/powershell.ts
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
  - cli/test/unit/settings.test.ts
  - vitest.config.ts
  - cli/test/unit/bun.test.ts
  - cli/test/unit/claudeRuntime.test.ts
  - cli/test/unit/claudeMigration.test.ts
  - cli/test/unit/deps.test.ts
  - cli/test/lib/harness.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - .github/workflows/parity.yml
  - .github/workflows/windows-entrypoints.yml
  - cli/test/statusline-runtime-smoke.mjs
  - README.md
  - AGENTS.md
  - CLAUDE.md
  - cli/docs/install.md
  - cli/docs/overview.md
  - cli/docs/platforms.md
  - cli/docs/sync-layers.md
  - cli/docs/toolchain.md
  - .claude/skills/settings-merge-context/SKILL.md
  - .claude/skills/settings-merge-context/references/claude-json-keys.md
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

Keep the current single-line Claude status display — `model | folder • branch | ctx X% (Xk/Xk) | 5h X% (reset) • 7d X% (reset)` with the same segment order, separators, ANSI colors, model suffix stripping, compact-window calculation, token formatting, and optional branch — while replacing its plumbing. Claude's native `rate_limits` statusline input becomes the only quota source; three small dependency-free `.mjs` programs under `~/.claude/bin/` replace the statusline, SessionStart shell snippets, and Notification shell script, while the obsolete Stop usage-fetch hook is removed rather than repurposed. The kit resolves or bootstraps a pinned Bun and materializes absolute, platform-correct settings paths only after the runtime and scripts are ready.

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
3. Context accepts `used_percentage` only as a finite number in `[0,100]`. All visible numeric rounding uses an explicit non-negative **round-half-to-even** helper matching the current shell `printf "%.0f"`/awk behavior (`22.5→22`, `23.5→24`, `24.5→24`, `25.5→26`); JavaScript `Math.round` is not the contract. With a finite positive `context_window_size`, compute `usedK = roundHalfEven((usedPercentage / 100) * (total / 1000))`. If `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is a decimal positive integer below the model total, use it as the effective total; then compute `effectiveTotalK = trunc(effectiveTotal / 1000)` and `effectivePercentage = roundHalfEven((usedK / effectiveTotalK) * 100)`. Invalid/empty caps are ignored, and a positive cap below 1000 cannot supply a denominator. Token units stay `Xk`, integral `XM`, or one-decimal `X.XM`. If only percentage exists, render `ctx N%` using the same rounding helper and no token parentheses.
4. Each quota window is independent. Accept `used_percentage` only as a finite number in `[0,100]`, including zero, then apply the same round-half-to-even helper. Accept `resets_at` only as finite non-negative epoch seconds; compare `trunc(resets_at)` with `floor(nowMs / 1000)`, so nonzero clock milliseconds cannot shift an integer-second boundary. Show `now` when elapsed or the current implementation's largest truncated unit (`d`, then `h`, then `m`, including `0m` for a positive sub-minute delta). Missing/invalid reset omits only the parentheses; missing/invalid utilization omits only that window. The quota-opening ` | ` appears only if at least one window renders; the soft dot appears only when both render.
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

### 3. Notification program

`SoT/.claude/bin/notify.mjs` exports and directly runs:

```js
export function selectPlayer(options = {})
export async function main(options = {})
if (import.meta.main) process.exit(await main())
```

It resolves the sound as `../notification.mp3` relative to `import.meta.dir`, exits 0 when absent, and preserves player priority and argv: macOS `afplay <sound>`; then `ffplay -nodisp -autoexit -loglevel quiet <sound>`; `paplay <sound>`; `aplay -q <sound>`. Discovery uses injected/default `Bun.which`; execution uses injected/default `Bun.spawnSync` with stdin/stdout/stderr ignored. A selected player's `exitCode` becomes the program exit code; it does not silently fall through to a second player after a real playback failure. Only Notification points to this script. There is no Stop hook in the authoring template or successful deployed settings.

### 4. Bun bootstrap and settings materializer

Move the existing bootstrap out of `skillsSync.ts` because Claude runtime and effect-solutions are now independent callers:

```ts
// cli/src/engine-native/bun.ts
export type BunRuntimeState =
  | { readonly kind: "ready"; readonly executable: string }
  | { readonly kind: "deferred"; readonly reason: "missing-curl" | "install-failed" }

export function bunBootstrap(ctx: Ctx, services: EngineServices): BunRuntimeState
```

`Ctx` owns the memoized result for one EngineNative invocation. The first Claude/effect-solutions/toolchain caller resolves or bootstraps Bun and caches the state; later callers in the same default all-target sync reuse it without a second download, retry, or duplicate bootstrap warning. A focused all-target failure test masks Bun/curl with effect-kit enabled and proves exactly one bootstrap attempt plus one actionable bootstrap warning sequence. Separate CLI invocations start with an empty memo and may retry.

On POSIX, resolve an absolute executable from PATH, then `BUN_INSTALL/bin/bun`, then `~/.bun/bin/bun`. On Windows the result contract is stricter: accept only an absolute regular `bun.exe` (case-insensitive suffix), never `.cmd`/`.bat`; ignore a PATH-shadowing `bun.cmd` and continue to `BUN_INSTALL\bin\bun.exe` then `%USERPROFILE%\.bun\bin\bun.exe`. Unit tests put `bun.cmd` ahead of a valid fallback and prove direct-hook settings receive the `.exe`.

On dry-run, probe prerequisites, print the planned pinned bootstrap, and return the predicted absolute executable without spawning or writing. POSIX downloads `https://bun.sh/install` to a process-unique temp file with curl, then runs `bash <file> bun-v<verified>`. Windows constructs `$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri <literal-url> -OutFile <literal-temp>`, escapes both values with the shared PowerShell single-quote-literal helper, encodes the download script as UTF-16LE base64, and invokes direct argv `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64>`. It then invokes direct argv `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <file> -Version <verified> -DownloadWithoutCurl`. Tests decode the payload and cover a temp path containing spaces/apostrophes plus the exact installer argv. Both paths remove the temp file in `finally` and re-probe; neither uses a download pipe or a floating version. The current official Windows installer declares `[String]$Version` and `[Switch]$DownloadWithoutCurl` and otherwise attempts `curl.exe`; the POSIX installer documents its first argument as a release tag.

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

// cli/src/engine-native/claudeSync.ts — filesystem transaction seam
interface PreparedClaudeSettings {
  readonly path: string
  readonly bytes: string
  readonly previousBytes: string | undefined
  readonly changed: boolean
}

function prepareClaudeSettings(ctx: Ctx, claudeDir: string, repo: Json): PreparedClaudeSettings
function commitClaudeSettings(ctx: Ctx, prepared: PreparedClaudeSettings): void
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
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "__DOCKS_KIT_STATUSLINE__",
    "refreshInterval": 5
  }
}
```

The surrounding PreToolUse, PostToolUseFailure, SubagentStop, permissions, plugins, and other settings remain byte-for-byte authoring concerns. Validation is location-aware, not a generic string replacer: Bun must occur in exactly the two handler `command` slots above, notify exactly once in its one-element `args`, SessionStart exactly once, and statusline exactly once; any missing sentinel, extra occurrence, wrong field, or sentinel residue is an error before any migration-owned runtime/settings/legacy cleanup mutation. With a runtime it emits:

- one SessionStart command hook: `{ "type": "command", "command": <absolute bun>, "args": [<absolute session-start.mjs>], "timeout": 5 }`;
- one Notification command hook pointing to the absolute Bun + notify script with `timeout: 10` and `async: true`; there is no Stop entry;
- `statusLine.refreshInterval: 5` with a guarded shell command. POSIX emits exactly `test -x <q-bun> && test -f <q-script> && exec <q-bun> <q-script> || true`, where the dedicated POSIX literal helper safely quotes apostrophes. Windows builds `if ((Test-Path -LiteralPath <ps-bun> -PathType Leaf) -and (Test-Path -LiteralPath <ps-script> -PathType Leaf)) { & <ps-bun> <ps-script> }`, converts paths to forward slashes, encodes that script as UTF-16LE base64, and stores `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64>`. Tests decode the payload, then execute the **exact stored command** with identical JSON stdin under both native PowerShell and `C:\Program Files\Git\bin\bash.exe`, using the same Bun/script paths containing spaces and apostrophes and asserting identical stdout/stderr/exit bytes.

With `runtime === undefined`, the materializer removes only `hooks.SessionStart`, `hooks.Notification`, and top-level `statusLine` before merge/install; the template has no `hooks.Stop` to remove, and it retains the safe PreToolUse, PostToolUseFailure, and SubagentStop entries. That is the no-cutover form: an existing user's old SessionStart/Notification/Stop/statusLine subtrees survive both additive and reconcile merge as user-only keys; a fresh home gets the unrelated safe hooks but none of those four pointers. On a ready cutover, `hooks.Stop` is deleted only by the readiness-gated removed-settings pass **after** the new settings commit; this is required because `deepMerge(user, repo)` preserves source-absent keys. `prepareClaudeSettings` accepts the materialized parsed document, validates existing JSON, performs the selected additive/reconcile merge, validates sentinel absence, and serializes entirely in memory. `commitClaudeSettings` later writes those prepared bytes with temp-plus-rename for first install and replacement (retaining the existing `.bak` on replacement). No sentinel-bearing or partially materialized document may reach disk.

### 5. Transaction and output contract

The Claude pipeline order is load-bearing:

```text
RTK attempt → Bun resolve/bootstrap
→ prepare/materialize/merge/validate/serialize settings entirely in memory
→ when Bun is ready, write all 3 .mjs + notification.mp3
→ CLAUDE.md → atomically commit the already-prepared settings
→ baseline removals + readiness-gated hooks.Stop/legacy .sh removals
→ modifiers / .claude.json / connectors / plugins / LSP servers
```

This preserves the current visible relative order `RTK → runtime assets → CLAUDE.md → settings`; preparation is silent and introduces no golden line. Bun bootstrap may install before preparation, but any template cardinality, deployed-JSON parse, merge, sentinel-residue, or serialization error occurs before runtime assets, settings, or legacy fallbacks are mutated. A ready run writes runtime assets before settings can point at them, commits settings before cleanup, and never removes old files or `hooks.Stop` after a failed prepare/commit.

`syncClaudeRuntime` consumes the run-memoized `BunRuntimeState` and returns one Claude state. `claudeSync` returns it through `index.ts` to `claudeSummary`; preparation, settings commit, and removals consume the same value rather than re-probing:

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

The dependency registry demotes jq/curl `Requirement` from `required` to `optional`; `SoT/toolchain.json` changes their `kind` from `required` to `check`. With no remaining hard dependency, delete `preflight` from `parseArgs.ts`, its `index.ts` call/import, and the corresponding repo-local skill/agent documentation. Missing jq never warns during normal sync because it has no runtime consumer. Put the RTK curl check in the shared `rtkInstall` download boundary, not only in `syncRtk`, so both sync and direct `toolchain ensure rtk` are covered; parameterize the caller context so the same registry hint gains the correct fixed suffix. `bunBootstrap` checks curl only before a missing-Bun POSIX download. Missing curl warns only at one of those actual boundaries:

```text
(cannot download RTK installer; continuing sync without RTK)
(cannot download RTK installer; toolchain ensure rtk aborted)
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

Delete the old separate `Scripts synced...` / `Hooks synced...` branches and shell-script counter. Add `hooks/notify.sh`, `statusline.sh`, `fetch-usage.sh`, and settings path `hooks.Stop` to named readiness-gated `REMOVED_MANIFEST` subsets and pass the single runtime-ready/committed state into `syncRemovals`. Baseline stale entries still prune on a deferred run; the three files and Stop subtree prune only after the prepared settings write succeeds. The aggregate format remains unchanged: a populated legacy home reports `Pruned stale artifacts (hooks: 1, files: 2, settings keys: 1, claude.json keys: 0)` after cutover.

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
| 1 | **Characterize the visual contract and land dormant Bun scripts.** Add representative native-input fixtures and hard-coded ANSI expectations for: full line on a branch, detached HEAD, no git, capped/uncapped context, each quota alone, both quotas, elapsed/missing/invalid resets, zero/invalid percentages, absent/null `rate_limits`, early null context, malformed/non-object JSON, and POSIX/Windows paths. Pin half-even cases `22.5/23.5/24.5/25.5`, a compact cap not divisible by 1000, and an integer reset evaluated at nonzero `nowMs` milliseconds. Implement the three importable/direct-run `.mjs` files to the interfaces above. Temporarily add them alongside the old three shell entries in the payload allowlist and regenerate `sotPayload.ts`, but keep old deployment/settings active so goldens stay byte-identical. The `.test.mjs` suites prove pure helpers plus direct stdout/stderr/exit behavior. A Linux 30-run direct-Bun sanity check discards five warmups and requires p95 ≤100 ms for fixed non-git input; Windows is added in Step 4. | — | done |
| 2 | **Make Bun and settings materialization cross-platform, still dormant.** Extract the per-engine-run memoized `bunBootstrap` to `bun.ts`; update `skillsSync.ts` and `modes.ts` imports; support POSIX Bun paths, Windows `.exe`-only resolution despite a shadowing `bun.cmd`, dry-run prediction, pinned POSIX/Windows download-then-run argv, encoded apostrophe-safe `Invoke-WebRequest`, installer `-DownloadWithoutCurl`, `finally` cleanup, and re-probe. Add `claudeRuntime.ts` with exact location/cardinality validation, direct-exec hook shapes, POSIX and UTF-16LE-encoded PowerShell statusline guards, no-cutover stripping, and split prepare/commit settings functions. Unit-test both bootstrap platforms, one-attempt all-target failure sharing, missing-curl contexts, spaces/apostrophes, decoded PowerShell bytes, both Windows outer shells, every materializer branch, and sentinel residue. Do not call the materializer, demote dependencies, or change deployed behavior yet; goldens remain byte-identical. | 1 | done |
| 3 | **Atomic cutover, dependency demotion, migration, and the only golden-update window.** Replace `syncScripts`/`syncHooks`/raw-template settings with the single ready/deferred prepare→assets→CLAUDE.md→settings→cleanup transaction above. Install the exact no-Stop template; demote jq/curl in `deps.ts` and `SoT/toolchain.json`; remove the now-dead `preflight` export/call; move the curl guard into `rtkInstall`; and add jq-free Claude/Codex plus sync/direct-toolchain contextual-curl cases. Delete the three old authoring shell assets and their payload entries, leaving exactly the three `.mjs` replacements. Add the old deployed paths and `hooks.Stop` to readiness-gated `REMOVED_MANIFEST` subsets. Failure tests prove legacy settings subtrees/files survive bootstrap failure, a fresh home retains safe hooks without broken pointers, preparation precedes runtime mutation, runtime assets precede settings, invalid deployed JSON aborts before runtime/cleanup, settings failure preserves Stop and old files, summary state is truthful, and replay is a no-op. Update each golden exactly once in one review window, never by hand, after inspecting all authorized labels. | 2 | done |
| 4 | **Prove native execution and refresh every documented owner.** Extend `parity.yml` to invoke the exact materialized direct hooks and shell statusline command on Ubuntu and Windows with JSON stdin, paths containing spaces/apostrophes, pinned bytes/channels, and full-command p95 sanity ceilings of 250 ms POSIX / 750 ms Windows (30 runs, discard five). The Windows job executes the same stored statusline command separately through native PowerShell and `C:\Program Files\Git\bin\bash.exe`, and direct hooks through the real absolute `bun.exe` installed by the pinned setup action. In `windows-entrypoints.yml`, remove raw sentinel-template seeding. The compiled no-Bun job restricts PATH to Windows system directories, points `BUN_INSTALL` at an existing regular file so the official installer cannot create `bin`, seeds marker legacy scripts + old pointers explicitly, runs real sync, and proves canonical legacy-subtree plus byte-for-byte script preservation/deferred output. The Bun-shim job syncs from a foreign cwd and executes SessionStart, Notification, and statusline by reading deployed settings, then asserts Stop is absent. Update DESIGN, bundled docs, README/AGENTS/CLAUDE, and CHANGELOG for native quotas, no OAuth cache, no Stop hook, optional jq/contextual curl, shared Bun bootstrap, and fallback behavior. Refresh the settings/toolchain/universal/sync skills plus the skills/settings/sync Claude↔Codex wrapper-agent twins with module + function + semantic anchors and `metadata.updated`. | 3 | done |
| 5 | **Full falsification and handoff.** Run the complete gate plus payload freshness. Run targeted live fixture smokes for full native data, no `rate_limits`, missing jq, missing curl with/without existing Bun, missing Bun on a fresh and legacy home, and repeat sync. Temporarily sabotage one layout byte, one stdout/stderr route, each Windows outer-shell guard, and the migration-ready gate to prove the corresponding tests fail; revert each sabotage. Verify affected-path scope, inspect the single golden recording diff label-by-label, and record command tails/counts in Notes. macOS is deliberately not a CI executable criterion because the runtime/statusline path is the same POSIX program already executed on pinned Linux and adding a third paid runner solely for latency is disproportionate; record a manual direct-Bun/Notification smoke with host, Bun version, exact bytes, and p95 in Notes when a macOS host is available, while the injected Darwin player-priority unit test remains blocking. Move the plan to `in_review` for an independent goal-vs-diff review. | 1–4 | done |

### Golden recording ledger (Step 3 only)

Run each `--update-goldens` command exactly once after all Step-3 unit/failure tests are green. Every authorized diff must fit this shape:

```bash
bun cli/test/golden-dryrun.ts --update-goldens
bun cli/test/golden-mutation.ts --update-goldens
```

| Surface | Authorized change |
|---|---|
| Dry-run output | Replace the old `cp statusline.sh, fetch-usage.sh, notification.mp3` and hook-directory copy lines with the single fixed `.mjs` runtime-install line in the same pre-`CLAUDE.md` position; settings still identify the embedded SoT template as their source. No otherwise-unmentioned line reorder is authorized. |
| Real/verbose hook messages | Replace `Scripts synced/already...` plus `Hooks synced/already...` with the fixed `Claude runtime synced/already...` line; replace the shell-script-count summary with the truthful Bun/deferred summary. |
| Settings tree hashes | Change only because SessionStart collapses from two shell handlers to one exec handler, Notification uses Bun + notify argv, Stop is absent, and statusLine stores the platform guard; no sentinel may appear in a deployed hash input. |
| Runtime tree entries | Remove `.claude/statusline.sh`, `.claude/fetch-usage.sh`, and `.claude/hooks/notify.sh`; add `.claude/bin/{statusline,session-start,notify}.mjs`; retain identical `notification.mp3` bytes. |
| Migration output | Only `migration=legacy-claude-hook-scripts` adds `Pruned stale artifacts (hooks: 1, files: 2, settings keys: 1, claude.json keys: 0)`; its final settings prove `hooks.Stop` was removed after the ready commit. |
| Toolchain table | Only jq/curl `KIND` cells change from `required` to `check`; other rows/columns are identical. |
| Missing dependencies | The two jq-additive rows exit 0 without a jq warning. The sync curl row emits exactly the registry hint plus `(cannot download RTK installer; continuing sync without RTK)` and exits 0; the direct `toolchain ensure rtk` row emits the registry hint plus `(cannot download RTK installer; toolchain ensure rtk aborted)` and exits 1. Bun-without-curl and one-attempt all-target sharing are focused unit/failure tests. |
| Child argv | Existing golden rows gain no bootstrap/player/git argv: their Bun stub is already present and deployed scripts are not executed by sync. Both missing-curl rows prove no curl child is spawned. Any other argv diff is a defect. |

The 15 existing dry-run labels expected to change are exactly the five Claude-running commands for each of `home-fresh`, `home-drift`, and `home-invalid-json`:

```text
fixture=<fixture> cmd=sync --dry-run
fixture=<fixture> cmd=sync --dry-run --reconcile --prune
fixture=<fixture> cmd=sync claude --dry-run
fixture=<fixture> cmd=sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=<fixture> cmd=sync claude --dry-run --claude-plugin=supabase
```

The 14 existing mutation labels expected to change are:

```text
fixture=home-drift cmd=sync --prune
fixture=home-drift cmd=sync --reconcile
fixture=home-drift cmd=sync claude
fixture=home-drift cmd=sync claude --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=home-drift cmd=sync claude --claude-model=fable replay=2nd
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

Add exactly five mutation cases (final mutation count 52):

```text
fixture=home-fresh cmd=sync claude stubs=jq variant=jq-absent-bun-hooks
fixture=home-fresh cmd=sync codex stubs=jq variant=jq-absent-native-sync
fixture=home-fresh cmd=sync claude stubs=curl,rtk variant=curl-absent-rtk-bootstrap
fixture=home-fresh cmd=toolchain ensure rtk stubs=curl,rtk variant=curl-absent-direct-rtk
migration=legacy-claude-hook-scripts
```

The migration case materializes marker bytes at the three legacy paths plus old SessionStart/Notification/Stop/statusLine pointers, then proves the final tree contains only the three `.mjs` files plus notification audio, fully absolute settings commands, and no Stop key. Two existing mutation rows are intentionally **not** authorized: `fixture=home-fresh cmd=sync claude stubs=rtk` exits when `rtk init` fails before the runtime phase, while `fixture=home-drift cmd=sync claude --claude-plugin=supabase,n8n` exits 2 during argument validation because one plugin is accepted per flag. Their unchanged trees/output are the RTK-order and parse-order canaries. Any change to an existing dry-run label outside the 15, an existing mutation label outside the 14, either canary, any unexpected argv change, or a final count other than dry-run 22 / mutation 52 is a defect: revert the recording, fix the slice, and record again only after the ledger is corrected (the failed attempt does not authorize hand-editing JSON).

## Acceptance criteria

- [x] Controlled full-input fixture renders one newline-terminated line with the pinned ANSI segment order/palette, branch, capped context/tokens, `5h` then soft dot then `7d`, half-even percentages, and deterministic reset countdown. Literal expectations include `22.5→22`, `23.5→24`, `24.5→24`, `25.5→26`, a compact cap not divisible by 1000, and an integer reset at nonzero `nowMs` milliseconds. Expected bytes are test data; no test calls an old `.sh` oracle.
- [x] Degradation matrix passes: absent/null `rate_limits` omits all quota text; one absent window preserves the other without an extra dot; utilization `0` renders; out-of-range/NaN utilization omits that window; invalid reset preserves utilization without parentheses; null/invalid context omits only context; invalid or sub-1000 compact cap is ignored for a denominator; missing git/non-repo omits only branch; malformed or non-object stdin exits 0 with empty stdout/stderr.
- [x] `rg -n '\.claude/\.credentials\.json|api\.anthropic\.com/.*/oauth/usage|claudeAiOauth|Claude Code-credentials|\.claude_usage_cache|\.claude_token_cache|\.claude_usage_fetching' SoT/.claude cli/src/engine-native cli/scripts/generate-sot-payload.ts` prints nothing. `rg -n 'statusline\.sh|fetch-usage\.sh|notify\.sh' cli/src/engine-native/claudeSync.ts` prints only the three named readiness-gated removed-file entries. Intentional non-live matches are limited to migration fixtures/tests, removal docs/CHANGELOG, this plan, and the retained permission glob `Read(**/.credentials*)`; none reads a credential or quota cache.
- [x] SessionStart prints exactly two lines for a fixed UTC clock; tests cover env → settings → default effort precedence and invalid/missing settings, and prove hook stdin cannot override effort. Notification alone materializes to the absolute Bun + notify argv; player selection/argv priority and silent channels are unit-tested on injected Darwin, Linux, Windows/no-player, playback failure, and missing audio. Ready template/deployed settings contain no Stop key.
- [~] Deployed `~/.claude/settings.json` contains no sentinel; template cardinalities are Bun=2, notify=1, SessionStart=1, statusline=1; SessionStart and Notification each have one handler; hook commands use an absolute real `bun`/`bun.exe` plus one-element `args`; Windows ignores a shadowing `bun.cmd`; statusline uses the POSIX or decoded PowerShell missing-file guard and retains `refreshInterval: 5`. The exact stored command executes paths containing spaces/apostrophes under POSIX shell, Windows Git Bash, and native PowerShell CI with identical expected channels/bytes. (Implementation + POSIX execution verified; both Windows executable legs await CI.)
- [x] Missing Bun on a legacy home preserves canonical deep equality of the legacy SessionStart/Notification/Stop/statusLine subtrees while allowing documented unrelated settings merge/reserialization, leaves all three old `.sh` files byte-identical, writes no new runtime assets, and emits the fixed migration-deferred warning + deferred summary. Missing Bun on a fresh home installs the unrelated safe hook events but no SessionStart/Notification/Stop/statusLine pointers. Preparation/materialization/serialization/settings-validation failure runs no runtime mutation or legacy cleanup.
- [x] Successful cutover prepares settings without mutation, writes all new scripts/audio before settings points to them, commits settings, then removes `hooks.Stop`, `~/.claude/statusline.sh`, `~/.claude/fetch-usage.sh`, and `~/.claude/hooks/notify.sh`; a forced settings commit failure preserves Stop and all old files. Immediate replay emits the verbose no-op line only under `--verbose` and makes no tree change.
- [x] The old `/tmp/.claude_usage_cache`, `/tmp/.claude_token_cache`, and `/tmp/.claude_usage_fetching` are never read and are intentionally **not deleted**: they are global predictable temp paths outside the kit-owned home manifest, may be symlinks or shared with an older concurrent process, and will age out through OS temp cleanup. This decision is stated in user docs/release notes.
- [x] Missing jq never blocks or warns for `sync claude` or `sync codex`; `DEPENDENCIES.jq/curl.requirement` is `optional`; toolchain reports jq/curl as `check`; `rg -n 'preflight' cli/src/engine-native/{index.ts,parseArgs.ts}` returns no match. Missing curl blocks neither sync globally: it warns only at a requested POSIX RTK/Bun download with the registry hint/context; direct `toolchain ensure rtk` exits 1 with its fixed suffix and spawns no curl. Windows Bun bootstrap uses an apostrophe-safe downloaded `install.ps1 -Version <pin> -DownloadWithoutCurl` and does not require external curl. A default all-target masked-Bun/curl run attempts bootstrap once even when effect-solutions also needs Bun.
- [~] Payload generator inventory is exact: the three `.mjs` paths are embedded, the three `.sh` paths are absent, `bun cli/scripts/generate-sot-payload.ts --check` exits 0, and a packed/compiled CLI syncs the scripts from a foreign cwd without publishing `SoT/` files. (Payload inventory/freshness verified; compiled foreign-cwd execution awaits Windows CI.)
- [x] CI never deploys raw sentinel-bearing `SoT/.claude/settings.json` with `Copy-Item`; workflow homes are produced by the materializer or use an explicit legacy fixture. `rg -n 'Copy-Item.*SoT/\.claude/settings\.json' .github/workflows` returns no match.
- [~] Latency harness (30 executions, discard first 5) reports direct-Bun p95 ≤100 ms Linux and ≤200 ms Windows, plus exact deployed-command p95 ≤250 ms POSIX / ≤750 ms Windows, for fixed non-git input; every run has the exact expected stdout and empty stderr. macOS is explicitly manual evidence rather than an automated acceptance leg; injected Darwin behavior remains unit-gated. (Linux direct/stored command passed; Windows p95 awaits CI; no macOS host was available.)
- [x] Golden ledger is exact: dry-run remains 22 cases; mutation becomes 52 via only the five named additive rows; existing diffs are confined to the 15 dry-run + 14 mutation labels above and match the fixed output/tree/argv contract; the RTK-init-failure and comma-plugin parse-abort rows remain byte-identical. Both prove-red legs print `prove-red OK` and exit 1.
- [x] Repo-local ownership documentation is current: no skill/wrapper says `preflight` still runs or that `bunBootstrap` lives in `skillsSync.ts`; each changed skill uses semantic anchors, has `metadata.updated: "2026-07-10"`, and each changed Claude wrapper matches its `.codex/agents` twin.
- [~] Every slice and final handoff pass typecheck, all Vitest tests, both golden suites, both prove-red legs, and generated-payload freshness; native Windows workflow executes the real materialized commands rather than only inspecting JSON shapes. (All local gates passed; native Windows execution awaits CI.)

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
- Claude chooses Git Bash or PowerShell for statusline execution on Windows. The stored command deliberately launches `powershell.exe` itself; UTF-16LE `-EncodedCommand` keeps the guard/path script opaque to either outer parser. CI must run the exact command through both outer shells, not just decode it or run a hand-authored equivalent.
- Sentinel counts are intentionally non-unique: Bun appears twice. Validation must check exact named locations/cardinalities (Bun 2, notify 1, SessionStart 1, statusline 1); a generic “reject duplicate” rule would reject the valid template.
- The generated payload is the runtime SoT. Adding authoring files without regenerating `cli/src/generated/sotPayload.ts` passes local checkout reads only if code accidentally violates the payload boundary; payload freshness and foreign-cwd tests prevent that regression.
- Settings are additive even under `--reconcile` for user-only keys. Runtime failure therefore preserves legacy Bun-owned hook/statusline keys only if the no-cutover source omits SessionStart, Notification, and top-level statusLine entirely and the authoring template also omits Stop; replacing any with `{}` or null would erase/break the fallback. The remaining safe hook events must stay in the source.
- Source omission does **not** remove a deployed Stop array because both settings modes call `deepMerge(user, repo)`. `hooks.Stop` must be readiness-gated removed-settings state, and it must run only after the new settings commit; otherwise deferred or failed migration destroys the old fallback.
- `engineCapture` child spawns and compiled Windows re-spawns must keep using the embedded payload and existing executable argv rules. Do not route hooks through `engineCapture` or add a `main.ts` argument to compiled child spawns; the existing Windows status assertions are the canary.
- The legacy fixture may contain invalid deployed settings. Prepare/merge/serialize before runtime writes, and do not remove old files or Stop until the settings write succeeds, so the invalid-JSON case remains recoverable.
- Stop has no replacement behavior. Do not route it to `notify.mjs` (that would add a completion chime), and do not preserve its old fetch handler after a ready cutover.
- A missing Bun result is memoized only for one EngineNative invocation. This prevents Claude then effect-solutions from downloading/failing twice in an all-target run without making a transient failure sticky across later CLI invocations.
- The official Windows Bun installer attempts `curl.exe` unless `-DownloadWithoutCurl` is passed. Downloading the installer with PowerShell is not sufficient by itself; both the switch and its exact argv test are mandatory.
- `rtk init` failure happens before runtime deployment. Its existing golden must remain unchanged; authorizing it would hide a transaction-order regression.
- Moving `bunBootstrap` and deleting `preflight` invalidates repo-local skill and wrapper routing even if runtime tests pass. The twin Claude/Codex agent files are one ownership surface and change together.

## Cold-handoff checklist

1. Start from `planned_at_commit`; confirm only expected newer commits exist before implementation and read the current `claudeSync.ts` pipeline, `settings.ts` merge rules, `deps.ts` Bun resolution, payload generator, and both golden matrices before editing.
2. Reverify the official Claude statusline/hook pages and Bun Windows installer parameters if implementation begins after their contracts change; record any drift in Notes before code.
3. Work in numbered slices and include this plan in each commit with the step status and a dated Notes entry. Run all seven per-slice gates, including payload `--check`; never update goldens outside Step 3.
4. Preserve existing output bytes except the fixed runtime/deferred lines and named settings/tree/dependency consequences. Inspect output, tree hashes, and child argv for every golden label in the ledger, including the unchanged RTK-abort and comma-plugin parse-abort canaries.
5. If POSIX, Windows Git Bash, or native PowerShell cannot execute the exact stored guard with an absolute path containing a literal apostrophe, stop and fix the platform literal helper/test; do not weaken to PATH-based `bun` or remove the guard.
6. Inject dependencies through the existing manager/platform seams and mock `node:child_process` as `skillsSync.test.ts` already does; do not add production environment backdoors used only by tests.
7. Refresh every listed kit-mechanic skill and both wrapper twins after the source settles; never copy raw line numbers into those prompt surfaces.
8. Finish only after native Windows executes commands read from materialized settings through direct `bun.exe`, Git Bash, and PowerShell as applicable—not hand-authored equivalents—and an independent plan-review compares `planned_at_commit..HEAD` against every acceptance item.

## Self-review

- Standalone executability: the plan fixes source/deployed paths, interfaces, no-Stop settings shapes, prepare/commit order, output bytes, golden labels/counts, cross-platform argv, gates, failure behavior, and rollback triggers. An implementer need not recover decisions from chat or an ephemeral scratchpad. ✓
- Actionability: each step has a bounded artifact and an executable completion proof; the only intentional golden update is isolated and enumerated. ✓
- Dependency order: dormant scripts → shared memoized Bun/materializer → prepared atomic cutover/migration → CI/docs → falsification/review. No slice points settings at an undeployed runtime or removes Stop before settings commits. ✓
- Evidence/reverification: current source, official Claude statusline/hooks contracts, official Bun runtime/installer contracts, payload boundary, merge semantics, workflow seams, and all current golden labels were opened before drafting. ✓
- Goal coverage: native quotas remove OAuth/cache; `.mjs` scripts remove jq/shell portability; Stop is removed rather than repurposed; Bun bootstrap/materializer makes the cutover executable; readiness gating protects existing installs; CI/goldens prove layout and platform behavior. ✓
- Executable acceptance: every criterion names an assertion, command, exact message, case count, path shape, or failure injection. ✓
- Failure modes: half-tie math, millisecond reset boundaries, independent missing fields, malformed input, git absence, no player/audio, missing jq/curl/Bun, duplicate all-target bootstrap, shadowing `bun.cmd`, invalid settings, commit failure, three shell parsers, foreign cwd, replay idempotence, stale generated payload, and post-cutover Bun deletion are addressed. ✓
- Assumption → question discipline: all three product choices were explicitly resolved; remaining technical ambiguity was closed with current primary documentation and source inspection. No open question remains. ✓
- Weighted score: standalone executability 22/22; actionability 16/16; dependency order 12/12; evidence reverify 10/10; goal coverage 14/14; executable acceptance 12/12; failure modes 8/8; assumption-to-question 4/4; adversarial cold-read 2/2. **Final: 100/100.**
- Score trajectory: **84 → 93 → 97 → 99 → 100**, stopped after the externally requested fresh-context review and one full reconciliation pass. The revision closed Stop migration, direct RTK curl gating, both Windows outer shells, `.exe`-only Bun resolution, encoded installer download/`-DownloadWithoutCurl`, prepare-before-assets validation, per-run Bun sharing, platform evidence scope, exact removed-identifier searches, half-even math, deferred-subtree equality, golden order, step schema, and ephemeral evidence. No open question remains.
- Cross-check (2026-07-10): [codex gpt-5.6-sol xhigh] 14 findings (1 high / 9 med / 4 low) — 14 accepted, 0 rejected (none); [claude] independently verified F1, F9, F13 against source before accepting; Claude leg: Stop-hook UX finding, dispositioned drop+gated-removal with no completion chime.

## Sources

- [Claude Code statusline documentation](https://code.claude.com/docs/en/statusline) — native input schema, conditional `rate_limits`, epoch-second resets, context nullability, shell execution, refresh interval.
- [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks) — direct command + args execution, Windows executable caveat, SessionStart input/output, Notification behavior.
- [Bun module execution documentation](https://bun.sh/docs/runtime/modules) — `.mjs` loading and `import.meta.main` direct-run seam.
- [Bun process spawning documentation](https://bun.sh/docs/api/spawn) — `Bun.spawnSync` and argv-based execution.
- [Bun official Windows installer](https://bun.sh/install.ps1) — current `[String]$Version` and `[Switch]$DownloadWithoutCurl` parameters, default `curl.exe` attempt, and `%USERPROFILE%\.bun\bin\bun.exe` install target.
- `SoT/.claude/statusline.sh` — current visual palette/order, model/context/token/reset behavior, and unsafe cache fetch trigger to remove.
- `SoT/.claude/fetch-usage.sh` — OAuth/Keychain/curl/token-cache surface removed by native rate limits.
- `SoT/.claude/hooks/notify.sh` + `SoT/.claude/settings.json` — player priority and current SessionStart/Notification/Stop/statusline settings being replaced.
- `cli/src/engine-native/claudeSync.ts:29-48,123-175,217-263,446-538,847-862` — current RTK/assets/settings/removal/summary order and exact message seams.
- `cli/src/engine-native/skillsSync.ts:281-363` + `cli/src/engine-native/deps.ts:113-133,195-255` — current Bun bootstrap callers/resolution, registry requirement values, and missing Windows `.exe`-only rule/fallback.
- `cli/src/engine-native/modes.ts:126-147` + `cli/src/engine-native/claudeSync.ts:60-103` — direct and sync RTK installer call paths that require one shared curl-boundary check with caller-specific suffixes.
- `cli/src/engine-native/parseArgs.ts:187-201` + `cli/src/engine-native/index.ts:75-90` — jq/curl hard exits and the now-dead preflight call.
- `cli/src/engine-native/settings.ts:10-48` — additive/reconcile deep-merge behavior that makes source omission the no-cutover representation.
- `cli/scripts/generate-sot-payload.ts:5-27`, `cli/src/payload.ts`, `cli/test/unit/payload.test.ts:31-63` — exact embedded allowlist, completeness inventory, and generated-byte contract.
- `cli/test/golden-dryrun.ts:35-57`, `cli/test/golden-mutation.ts:55-153,215-330`, current golden JSON case keys — 22/47 baselines, channel invariants, replay/abort cases, and additive-label mechanism.
- `.github/workflows/parity.yml:1-217`, `.github/workflows/windows-entrypoints.yml:1-151` — raw sentinel-template copies, native PowerShell, compiled no-Bun, Bun-shim, foreign-cwd, and `engineCapture` seams.
- `.claude/skills/{settings-merge-context,sync-orchestration-context,toolchain-context,universal-skills-context}` + `.claude/agents`/`.codex/agents` twins — documented ownership that must move with materialization, preflight removal, and shared Bun bootstrap.
- `git show cb053df:docs/plans/active/embed-sot-payload.md` (`Authorized golden changes`) — prior 15/15 label authorization and four additive-case structure used as the ledger shape; current source execution corrected this plan's mutation side to 14 changed rows plus two abort canaries.

## Notes

- 2026-07-10: Drafted after the embedded-payload plan shipped. The plan deliberately stages new `.mjs` payload bytes before the cutover so every implementation commit remains runnable and golden-stable until the single migration slice.
- 2026-07-10: `/tmp` cache cleanup was considered and rejected: the old names are global/predictable, outside the kit-owned home manifest, and may be shared or symlinked. Removing all readers/writers is sufficient; OS temp cleanup handles residue without an unsafe unlink.
- 2026-07-10: Current-doc recheck closed two cross-platform details: `rate_limits.*.resets_at` is epoch seconds, and the official Bun PowerShell installer declares both `Version` and `DownloadWithoutCurl`; the latter is mandatory because the installer otherwise tries `curl.exe` before its PowerShell fallback.
- 2026-07-10: Critical rewrite of the inherited draft retained the five-slice transaction but corrected the settings contract, external-input validation, Windows quoting, ownership refresh, per-slice payload gate, truthful deferred summary, and initial mutation ledger; Step 3 source execution later corrected its changed-row count from 15 to 14.
- 2026-07-10: The research handoff's unique evidence is durable in this plan: the three verbatim picker decisions are in Context, the embedded-payload release at `c727ba5` is the prerequisite, and all native-field/hook/installer claims were reverified against the linked primary docs and current source. The ephemeral `/tmp` digest is not a plan dependency.
- 2026-07-10: Review round 1 accepted all 14 Codex findings and Claude's independent Stop-hook UX finding. Live shell characterization pinned half-even rounding (`22.5→22`, `23.5→24`, `24.5→24`, `25.5→26`); the plan chose existing output order over a golden-only reorder, and chose Linux+Windows executable CI with injected Darwin blocking tests plus optional recorded macOS manual smoke instead of adding a paid macOS runner.
- 2026-07-10: Step 1 paused after the mandatory red/green cycle exposed a frozen-test executable mismatch: Vitest runs under Node, so `process.execPath` launches Node rather than the required Bun and cannot exercise `import.meta.main`. Direct `bun <script>` probes pass. Proposed correction awaiting orchestrator approval: replace `process.execPath` with the literal `bun` executable in the three direct-process test call sites; assertions and production code remain unchanged.
- 2026-07-10: Orchestrator approved the frozen-test correction: three failing direct-process call sites now launch literal `bun`, with one guard comment documenting that Vitest workers themselves run under Node. Assertions and production code stayed frozen; the scoped suite passed 29/29 before unblocking.
- 2026-07-10: Step 1 done. TDD red was three missing-module import failures; green was 29/29 scoped. Full gate tails: TypeScript exit 0; Vitest 11 files / 70 tests; dry-run `OK (22 case(s))`; mutation `OK (47 case(s))`; prove-red detected 22/47 planted mismatches and each exited 1; payload `--check` exit 0. Both goldens had zero diffs, and the 30-run Linux direct-Bun p95 assertion passed its 100 ms ceiling. The one-line `vitest.config.ts` include expansion was the required discovery seam for the plan's `.test.mjs` paths.
- 2026-07-10: Step 2 done. The shared `powershell.ts` codec/literal seam keeps the Windows installer and stored statusline command on identical UTF-16LE and apostrophe-escaping rules. Bun bootstrap is memoized on `Ctx`, dry-run prerequisite-aware, pinned on both platforms, `.exe`-strict for direct Windows hooks, and still preserves the existing Bun shim lookup used only to locate effect-solutions. The dormant materializer validates exact sentinel locations/cardinalities and the prepare/commit settings seam proves no write occurs before commit. Focused suites passed 30/30. Full gate tails: TypeScript exit 0; Vitest 13 files / 86 tests; dry-run `OK (22 case(s))`; mutation `OK (47 case(s))`; prove-red detected 22/47 planted mismatches and each exited 1; payload `--check` exit 0. Both goldens remained byte-identical. The first full-suite latency sample was a transient 100.90 ms p95 miss; the unchanged focused rerun and final full gate both passed the pinned 100 ms ceiling.
- 2026-07-10: Step 3 pre-recording audit corrected the mutation authorization from 15 to 14 changed existing rows. Orchestrator ruling: preserve one-plugin-per-flag behavior and reclassify `--claude-plugin=supabase,n8n` as a byte-identical parse-abort canary because it exits 2 before the runtime phase; changing parser behavior or the case label solely to satisfy the ledger would invert the behavior/spec hierarchy. Together with the unchanged RTK-init abort, the existing matrix now has two explicit canaries; final counts remain 22/52 after the five additive cases.
- 2026-07-10: Step 3 done. The TDD red baseline covered required jq/curl, the old Stop/shell template, preflight aborts, runtime-before-validation mutation, and missing transaction behavior. Green focused suites proved deferred legacy/fresh homes, one-attempt all-target Bun sharing, invalid settings before runtime writes, assets-before-settings commit with fallback preservation, silent missing jq, caller-specific missing-curl warnings, no curl child, sentinel-free settings, and payload inventory. Each golden was recorded exactly once: dry-run 22 and mutation 52. The label audit found exactly 15 authorized dry-run changes, 14 authorized existing mutation changes, five additions, zero removals, unchanged existing argv/exit codes, and byte-identical RTK-init/comma-plugin abort canaries; the dry-run output transformation matched the prescribed two old lines to one runtime line for all 15 rows. Full gate tails: TypeScript exit 0; Vitest 14 files / 95 tests; dry-run `OK (22 case(s))`; mutation `OK (52 case(s))`; prove-red detected 22/52 planted mismatches and each exited 1; payload `--check` exit 0.
- 2026-07-10: Step 4 done. `statusline-runtime-smoke.mjs` materializes the real settings into a home path containing a space/apostrophe, executes both direct hooks, pins exact statusline ANSI stdout/empty stderr for 30 direct-Bun and 30 stored-command runs, and is wired to POSIX, native PowerShell, and Git Bash CI legs. Local POSIX evidence: direct Bun p95 37.78 ms/100 ms and stored command p95 40.30 ms/250 ms. Windows entrypoint CI now uses an explicit legacy no-Bun real-sync fixture (restricted PATH plus regular-file `BUN_INSTALL`) and a foreign-cwd Bun-shim execution of commands read from deployed settings; raw sentinel copying is absent. Workflow YAML, four skill frontmatters, three TOML agents, and all three Claude/Codex wrapper bodies parsed/paired cleanly. Full gate tails: TypeScript exit 0; Vitest 14 files / 95 tests; dry-run `OK (22 case(s))`; mutation `OK (52 case(s))`; prove-red detected 22/52 planted mismatches and each exited 1; payload `--check` exit 0. Goldens remained byte-identical.
- 2026-07-10: Step 5 done and handed to independent review. Targeted live-fixture passes were 3/3 statusline cases (full native layout, absent/null quotas, exact direct channels) and 7/7 migration/dependency cases (legacy + fresh missing Bun, missing jq, missing curl with present Bun, missing Bun+curl, direct RTK). Reversible sabotage proved the pinned tests red for a model-color byte, stdout→stderr routing, the shared encoded Windows guard switch, and the deferred-vs-ready legacy cleanup gate; every sabotage was restored with a zero diff. This Linux worker has no PowerShell/Git Bash or macOS host, so actual Windows outer-parser sabotage, Windows p95, compiled foreign-cwd execution, and optional macOS evidence remain external review/CI evidence rather than falsely claimed local passes. The Step-3 golden re-audit produced dry-run 22→22 (15 changed/0 added/0 removed), mutation 47→52 (14 changed/5 added/0 removed), and byte-identical RTK-init/comma-plugin abort canaries. Scope audit: 62 changed paths, 60 declared path entries, zero uncovered. Final local gate: TypeScript exit 0; Vitest 14 files / 95 tests; dry-run `OK (22 case(s))`; mutation `OK (52 case(s))`; prove-red detected 22/52 and each child exited 1; payload `--check` exit 0; POSIX direct Bun p95 80.44 ms/100 ms and stored command p95 54.55 ms/250 ms; workflow YAML and negative credential/cache/preflight/raw-template searches clean.

## Review

(filled by plan-review on completion)
