---
title: Embed the SoT payload and replace Claude shell hooks
goal: Make every sync/config read independent of a runtime SoT/ directory by generating an embedded payload for compiled and Bun/npm execution, and replace Claude's shell hooks with native CLI subcommands.
status: planned
created: "2026-07-10T00:32:24-03:00"
updated: "2026-07-10T01:26:44-03:00"
started_at: null
assignee: null
tags: [cli, engine-native, payload, hooks, windows]
affected_paths:
  - SoT/.claude/settings.json
  - SoT/.claude/statusline.sh
  - SoT/.claude/fetch-usage.sh
  - SoT/.claude/hooks/notify.sh
  - SoT/toolchain.json
  - notification.mp3
  - cli/scripts/generate-sot-payload.ts
  - cli/src/generated/sotPayload.ts
  - cli/src/payload.ts
  - cli/src/kitHome.ts
  - cli/src/manifests.ts
  - cli/src/main.ts
  - cli/src/engine.ts
  - cli/src/commands/hooks.ts
  - cli/src/hooks.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/skillsSync.ts
  - cli/src/engine-native/models.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/engine-native/parseArgs.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/exec.ts
  - cli/src/engine-native/DESIGN.md
  - cli/build-binaries.sh
  - docks-kit
  - package.json
  - .github/workflows/parity.yml
  - .github/workflows/windows-entrypoints.yml
  - README.md
  - AGENTS.md
  - cli/docs/overview.md
  - cli/docs/install.md
  - cli/docs/platforms.md
  - cli/docs/sync-layers.md
  - cli/docs/toolchain.md
  - cli/test/lib/harness.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/deps.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/payload.test.ts
  - cli/test/unit/hooks.test.ts
  - cli/test/unit/settings.test.ts
  - cli/test/fixtures/hooks/statusline.json
  - cli/test/fixtures/hooks/statusline-oracle.sh
  - cli/test/fixtures/hooks/fetch-usage.json
related_plans: [windows-support, engine-full-di]
review_status: null
planned_at_commit: af68176d0ba9f0fed2b2b63bfebbfd20bfd04a23
---

## Goal

Ship one docks-kit executable/package that carries the complete declarative sync payload itself. A release binary copied into an otherwise empty directory and an npm/Bun global install launched from a foreign working directory must both perform Claude, Codex, agents, model, status, and toolchain operations without locating or reading a runtime `SoT/` directory. `SoT/` remains the reviewed authoring source in this repository; a deterministic build step turns its live files plus `notification.mp3` into the CLI payload.

Replace the last deployed Claude shell assets with native CLI commands. The native status line must emit exactly the same ANSI bytes as `statusline.sh`; usage refresh and notification remain silent/best-effort; the inline SessionStart config hook also moves behind the native runner so no deployed command needs `jq`. The cutover must remove previously deployed `~/.claude/statusline.sh`, `~/.claude/fetch-usage.sh`, and `~/.claude/hooks/notify.sh` only after the replacement runner and settings are usable.

## Context & rationale

The current release binary embeds the Bun runtime but not the kit payload. `kitHome()` requires `SoT/` plus `package.json`, `Ctx.repoDir` is the root for every engine read, and Windows entrypoint CI explicitly seeds or supplies a checkout. The npm package works only because `package.json` publishes `SoT/` beside `cli/src`. That makes configuration data a runtime filesystem dependency on both delivery paths.

The sync audit also found runtime readers outside `claudeSync.ts` and `codexSync.ts`: the orchestration gates, universal-skill manifest, model catalog, model get display, toolchain manifest, and public status/plugin/skills views. The goal is therefore repository-wide payload substitution, not a two-file path rewrite.

User decisions (verbatim):

1. **statusline is KEPT — ported as a subcommand with byte-identical output, never dropped**
2. **jq necessity removed**
3. **both Claude and Codex sync paths covered**
4. **SoT/ remains in the repo as build-time authoring source only — it stops being a runtime read dependency**
5. **Hook-runner distribution: per-user full-CLI runner** (OQ-1 option 1, user via picker 2026-07-10; ~57–90 MB per-user disk cost accepted)
6. **"check if the current statusline could be better written as well, keeping the behavior/ui"** (OQ-2 answer, verbatim) — the native statusline port should improve internal implementation quality (structure, naming, clarity) over the bash original wherever it is convoluted, while UI/behavior stay byte-identical per decision 1. The latency budget itself takes the recommended default, recorded in Interfaces.

Additional audited consequences:

- The three script files are not the only `jq` consumer: the second `SessionStart` command in `SoT/.claude/settings.json` reads `.effortLevel` with `jq`. It must become native too.
- `curl` remains legitimate bootstrap plumbing for RTK, Bun, the Unix installer, and the repo launcher. Only usage fetching moves to Bun/WHATWG `fetch`; global sync preflight must stop aborting merely because `curl` is absent, and each remaining installer must warn/degrade at its own call site.
- The status line runs every five seconds and currently throttles background usage refreshes to one spawn per five-second marker window. The native port must preserve that throttle and invoke a compiled runner, not the TypeScript package shim, once the hook-runner decision below is resolved.
- The shipped Windows plan treated the three scripts as the final Git-Bash-backed exception. Removing them closes that exception; Windows settings, binary suffixes, temp paths, credential reads, and player probing need first-class tests.

## Interfaces & data shapes

### Generated payload contract

`cli/scripts/generate-sot-payload.ts` owns a fixed final-state allowlist. After the atomic Step-5 cutover, the live payload is exactly:

```text
SoT/.agents/skills.txt
SoT/models.json
SoT/toolchain.json
SoT/.claude/CLAUDE.md
SoT/.claude/mcp-servers.json
SoT/.claude/settings.json
SoT/.codex/AGENTS.md
SoT/.codex/config.toml
SoT/.codex/plugins/marketplace.json
SoT/.codex/rules/docks.rules
notification.mp3
```

The generator writes one committed module, `cli/src/generated/sotPayload.ts`, with UTF-8 files represented as exact strings and binary files as base64. Stable key order is the list above; the generated header says how to regenerate and forbids hand edits. It also owns/verifies one marked `BUN_PIN="<verified>"` line in the root `docks-kit` launcher so that the no-Bun bootstrap remains pinned without reading `SoT/toolchain.json` or invoking `jq` at runtime. `bun cli/scripts/generate-sot-payload.ts --check` exits 0 only when both generated surfaces are byte-for-byte current. Both `cli/build-binaries.sh` and package packing run `--check` before producing artifacts.

`cli/src/payload.ts` is the sole product-code reader:

```ts
export type PayloadPath =
  | "SoT/.agents/skills.txt"
  | "SoT/models.json"
  | "SoT/toolchain.json"
  | "SoT/.claude/CLAUDE.md"
  | "SoT/.claude/mcp-servers.json"
  | "SoT/.claude/settings.json"
  | "SoT/.codex/AGENTS.md"
  | "SoT/.codex/config.toml"
  | "SoT/.codex/plugins/marketplace.json"
  | "SoT/.codex/rules/docks.rules"
  | "notification.mp3"

export function payloadText(path: Exclude<PayloadPath, "notification.mp3">): string
export function payloadBytes(path: PayloadPath): Buffer
export function payloadPaths(prefix: string): ReadonlyArray<PayloadPath>
export function payloadDisplayPath(path: PayloadPath, kitHome?: string): string
```

`payloadDisplayPath` is presentation-only: in a checkout/package root it preserves existing `.../SoT/...` dry-run labels; without one it returns `embedded:<path>`. No sync decision or read may depend on that display path. `payload.test.ts` compares every generated entry to the authoring file bytes and asserts no unlisted authoring file is silently deployable.

The completeness inventory has an explicit lifecycle. In Steps 1–4 it permits only `SoT/.codex/agents/.gitkeep` plus the three still-authoritative legacy hook files (`SoT/.claude/statusline.sh`, `SoT/.claude/fetch-usage.sh`, and `SoT/.claude/hooks/notify.sh`) as named `LEGACY_AUTHORING_EXCLUSIONS`; `package.json` continues publishing `SoT/` and `notification.mp3`, so every pre-cutover package remains functional. Step 5 deletes the three scripts, reduces the exclusion set to exactly `.gitkeep`, removes `SoT/` and `notification.mp3` from the npm package, and removes the launcher runtime read in the same commit. The empty `SoT/.codex/bin/` directory has no bytes to embed. Any future exclusion requires an explicit generator/test change.

This generated-module design is deliberate: Bun's static file imports become `/$bunfs/` assets in a compiled executable, but during direct Bun/npm execution they resolve to disk paths. A generated TypeScript module instead gives all three modes—standalone, packaged TypeScript, and checkout development—the same in-memory contract, while `SoT/` remains build-time input only. The 16,128-byte sound is small enough for base64 without a separate runtime asset directory.

### Kit-home and engine contract

`kitHome()` stops proving payload availability. It identifies an optional checkout/package home for update behavior and display only: `DOCKS_KIT_HOME` → nearest docks-kit `package.json` → package root → standalone executable directory. `Ctx.repoDir` remains the display/update home during this plan to avoid unrelated message churn; all `p(ctx.repoDir, "SoT", ...)` reads and `existsSync(...SoT...)` gates are replaced by payload functions. A compiled binary in a foreign directory therefore reaches Claude/Codex/agents unconditionally.

The following existing functions change from source-file paths to source content/keys while preserving user-file paths and merge order:

```ts
syncConfig(ctx, sotConfigText, userConfig)
mergeTopLevelSettings(sotConfigText, userConfig)
mergeTableSettings(sotConfigText, userConfig)
syncRules(ctx, payloadPaths("SoT/.codex/rules/"), userRulesDir)
syncAgentsMd(ctx, payloadText("SoT/.codex/AGENTS.md"), userAgentsMd)
syncMarketplace(ctx, payloadText("SoT/.codex/plugins/marketplace.json"), userMarketplace)
enabledPluginIdsFromText(sotConfigText)
```

Add content twins in `exec.ts` (`writeTextIfChanged`, `writeBytesIfChanged`) rather than materializing the payload into a temp directory. Existing atomic backup/rename behavior, operation order, permissions, and output bytes remain unchanged unless explicitly authorized below.

### Native hook command contract

The public namespace is:

```text
docks-kit hook session-start
docks-kit hook statusline
docks-kit hook fetch-usage
docks-kit hook notify
```

`commands/hooks.ts` only parses/routs. `hooks.ts` owns these behavior contracts:

```ts
export interface StatuslineInput {
  readonly model?: { readonly display_name?: string }
  readonly workspace?: { readonly current_dir?: string }
  readonly cwd?: string
  readonly context_window?: {
    readonly used_percentage?: number
    readonly context_window_size?: number
  }
}

export interface UsageResponse {
  readonly five_hour?: { readonly utilization?: number; readonly resets_at?: string }
  readonly seven_day?: { readonly utilization?: number; readonly resets_at?: string }
}

export type HookPlatform = "linux" | "darwin" | "windows"

export interface HookRunnerInvocation {
  readonly command: string
  readonly argsPrefix: ReadonlyArray<string>
}

export interface HookFileStat {
  readonly kind: "file" | "directory" | "symlink" | "other"
  readonly ownerId: string
  readonly mode: number
}

export interface HookRuntime {
  readonly platform: HookPlatform
  readonly runner: HookRunnerInvocation
  readonly nowMs: () => number
  readonly env: NodeJS.ProcessEnv
  readonly home: string
  readonly tmpDir: string
  readonly exists: (path: string) => boolean
  readonly lstat: (path: string) => HookFileStat | undefined
  readonly mtimeMs: (path: string) => number
  readonly readText: (path: string) => string | undefined
  readonly writeTextAtomic: (path: string, content: string, mode?: number) => boolean
  readonly readSecureText: (path: string) => string | undefined
  readonly writeSecureTextAtomic: (path: string, content: string) => boolean
  readonly remove: (path: string) => void
  readonly touch: (path: string) => boolean
  readonly capture: (
    command: string,
    args: ReadonlyArray<string>,
    cwd?: string
  ) => { readonly status: number; readonly stdout: string; readonly stderr: string }
  readonly spawnDetached: (command: string, args: ReadonlyArray<string>) => boolean
  readonly fetchUsage: (token: string, timeoutMs: number) => Promise<UsageResponse | undefined>
}
```

- `session-start`: writes the existing `[CONTEXT]` line then existing `[CONFIG]` line, byte-for-byte, reading `effortLevel` from the embedded settings default when the deployed file is missing/invalid. No `jq` or `date` child.
- `statusline`: reads one JSON value from stdin; writes exactly one ANSI line and newline. It preserves model suffix stripping, directory basename, branch-or-detached-SHA lookup, effective compact-window math, token formatting, cache freshness/account-switch invalidation, largest-unit reset countdown, color bytes, separators, and field omission/order. It spawns `hook fetch-usage` detached through the same compiled runner at most once per five seconds.
- `fetch-usage`: preserves the non-secret usage and throttle files (`/tmp/.claude_usage_cache` and `/tmp/.claude_usage_fetching` on POSIX; `tmpDir` equivalents on Windows), but deliberately moves the bearer-token cache out of shared temp storage. POSIX uses `${XDG_RUNTIME_DIR}/docks-kit/claude-token` only when that directory is owned by the current user and mode `0700`, otherwise `~/.cache/docks-kit/claude-token`; Windows uses `%LOCALAPPDATA%\\docks-kit\\claude-token`. `readSecureText` rejects symlinks, non-regular files, wrong owners, and group/other permission bits; `writeSecureTextAtomic` creates parent directories as `0700`, opens with no-follow semantics, writes a same-directory temp file as `0600`, fsyncs, and atomically replaces the cache. The legacy `/tmp/.claude_token_cache` is never read and is removed only when `lstat` proves it is a current-user-owned regular file. This is the one authorized token-cache behavior improvement. Credential order, 15-minute freshness/credential-newer invalidation, three-second timeout, nearest-integer utilization, 0–100 guard, and exact four-line usage-cache bytes remain unchanged. The command emits nothing and exits 0 on missing credentials, cache rejection, network failure, or schema mismatch.
- `notify`: if `~/.claude/notification.mp3` is absent, exit 0. Player priority remains macOS `afplay`, then `ffplay`, `paplay`, `aplay`; Windows may use `ffplay` when present and otherwise exits 0. Spawned player argv is unchanged (`ffplay -nodisp -autoexit -loglevel quiet`, `aplay -q`). No output.

Both former open decisions are RESOLVED (user via picker, 2026-07-10). **Hook-runner distribution = per-user full-CLI runner** (OQ-1 option 1): sync keeps a version/payload-hash-keyed executable at `~/.claude/bin/docks-kit-hook` (`.exe` on Windows); a release binary copies itself atomically; Bun/npm/dev compile `cli/src/main.ts` once with verified Bun and reuse it. **Statusline latency budget = p95 ≤100 ms Linux / ≤200 ms Windows** (OQ-2 option 1): the exact 30/5/index-23 Environment algorithm, fixed no-network fixture, and ≤25% regression guard against the preserved shell oracle on the same job — the recommended default, accepted by the orchestrator because the user's OQ-2 answer instead contributed decision 6 above. Direct-exec command hooks are written only after a compatible runner exists; the runtime missing-file no-op guard belongs only to the shell-dispatched statusline command. `SoT/.claude/settings.json` becomes an authoring template with these exact replacements; all other hook objects remain byte-for-byte unchanged:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "{{DOCKS_KIT_HOOK_EXEC}}",
        "args": ["hook", "session-start"],
        "timeout": 5
      }]
    }],
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "{{DOCKS_KIT_HOOK_EXEC}}",
        "args": ["hook", "notify"],
        "timeout": 10,
        "async": true
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "{{DOCKS_KIT_HOOK_EXEC}}",
        "args": ["hook", "fetch-usage"],
        "timeout": 5,
        "async": true
      }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "{{DOCKS_KIT_STATUSLINE_COMMAND}}",
    "refreshInterval": 5
  }
}
```

The materializer collapses the current two `SessionStart` command handlers to the single native handler above, so one event produces exactly one `[CONTEXT]` line followed by one `[CONFIG]` line. Claude command hooks use the documented exec form: `command` is the absolute native executable and `args` is a JSON array, so no shell parses those three handlers. The settings transaction never writes exec-form entries unless a compatible runner is already verified; a valid synced configuration therefore cannot point at a never-installed runner.

`statusLine.command` is a distinct shell surface. The materializer detects the shell Claude will use and writes one guarded absolute command: POSIX is `test -x '<posix-path>' && exec '<posix-path>' hook statusline || true`; Windows with Git Bash uses the same form with a single-quoted forward-slash native path; Windows without Git Bash uses `if (Test-Path -LiteralPath '<native-path>' -PathType Leaf) { & '<native-path>' hook statusline }`. Path literals are single-quote escaped for the selected shell. This plan eliminates deployed `.sh` and `jq` assets; it does not claim that Claude's `statusLine.command` stops being a shell command.

Runner installation is transactional and precedes every mutating Claude phase. A staged candidate must pass hash verification plus `hook probe`, whose exact stdout is `{"abi":1,"payloadHash":"<generated-hash>"}\n`, before atomic replacement. First-install failure, or refresh failure with no compatible existing runner, exits 1 with exactly `[err] Native hook runner install failed — Claude settings and legacy hook files were left unchanged` on stderr; it runs no later Claude phase and therefore leaves settings, notification, and all three legacy scripts untouched. Refresh failure with an existing runner whose probe reports both ABI 1 and the expected generated payload hash exits the installer path successfully, preserves that file, emits exactly `[warn] Native hook runner refresh failed — reusing compatible runner at <path>` on stderr, and continues; any ABI/hash mismatch takes the hard-failure branch. Candidate failure never truncates or deletes the known-good runner. Cleanup is ordered runner verified → materialized settings merged → notification written → legacy scripts removed; any earlier failure skips cleanup.

Fault behavior is part of the command contract: invalid statusline stdin exits 0 with empty stdout/stderr; corrupt or unreadable usage/token caches are ignored without printing, the current statusline fields still render, and refresh is attempted only after the throttle marker can be atomically updated. A marker-write or detached-spawn failure produces the current status line, performs at most one spawn attempt, and emits nothing. Missing credentials, invalid credential JSON, secure-cache rejection, HTTP non-2xx/timeout/schema failure, and usage-cache write failure make `fetch-usage` exit 0 with empty stdout/stderr and leave every previously valid cache byte unchanged. A present player that fails to spawn makes `notify` exit 0 silently without cascading to a lower-priority player. Unit tests inject every failure through `HookRuntime` and assert exit code, exact stdout/stderr, spawn count/argv, and cache preservation; fake tokens may never appear in snapshots or failure output.

## Environment & how-to-run

- Repository root; Bun `1.3.14` (the current verified pin); Node/npm only for the package smoke. Do not install or mutate deployed user config while implementing—golden homes, unit temp dirs, and CI temp homes are the mutation targets.
- Before each implementation slice: `git diff --stat af68176d0ba9f0fed2b2b63bfebbfd20bfd04a23..HEAD -- <affected path>` and reconcile this plan if in-scope code moved.
- After every slice run, separately:
  - `bun x tsc --noEmit -p cli/tsconfig.json` → exit 0.
  - `bun x vitest run` → all pass.
  - `bun cli/test/golden-dryrun.ts` → `golden-dryrun: OK (22 case(s))` until the authorized cutover, then the same count.
  - `bun cli/test/golden-mutation.ts` → `golden-mutation: OK (47 case(s))` until the authorized cutover, then `OK (51 case(s))` if all four additive cases below land.
  - `bun cli/test/golden-dryrun.ts --prove-red` → contains `prove-red OK`, exits 1.
  - `bun cli/test/golden-mutation.ts --prove-red` → contains `prove-red OK`, exits 1.
- After every payload-authoring slice, `bun cli/scripts/generate-sot-payload.ts --check` exits 0. Unit tests copy each generator input to a temp source root, dirty `notification.mp3` and the marked Bun-pin input in `docks-kit` separately, and prove `--check` exits nonzero naming the stale surface; the real checkout is never dirtied by the test.
- Pre-cutover artifact proof after Steps 2 and 4 deliberately exercises the still-shipped legacy files: build `linux-x64`, run a real `sync claude --skip-rtk` from the checkout with a temp home and stubbed external CLIs, then pack/install the npm tarball (whose listing must still contain `package/SoT/` and `package/notification.mp3`) and run the same real sync from a foreign cwd. Both leave working legacy script settings; this is the slice gate that prevents an intermediate broken package.
- Final artifact proof after Steps 5 and 6 uses the same command matrix for all three surfaces—`cli/dist/docks-kit-linux-x64`, the Windows `.exe` in its workflow, and the globally installed packed tarball—each from a foreign cwd/temp home with no checkout, no `DOCKS_KIT_HOME`, no adjacent `SoT/`, and a hermetic PATH containing deterministic stubs for every external CLI/player:
  1. `sync --dry-run`
  2. `models claude`
  3. `status --json`
  4. `toolchain check`
  5. `sync claude --skip-rtk` (real mutation, no network)
- For command 5, assert the runner and notification bytes exist; `settings.json` has exactly one SessionStart handler and the exact exec/statusline shapes above; the three legacy scripts are absent; then execute the three exact materialized command-hook `command`/`args` pairs and the exact `statusLine.command` through the shell selected by the materializer. Fixed stdin/env/clock and fake credentials/player stubs must yield exactly the characterization bytes, silent fetch/notify output, and recorded player argv. The packed tar listing contains neither `package/SoT/` nor `package/notification.mp3` only after Step 5.
- Latency runs the exact materialized `statusLine.command` end to end through its selected shell. Preserve `cli/test/fixtures/hooks/statusline-oracle.sh` as a non-shipping test oracle after authoring-script deletion. For each candidate and oracle: 30 sequential invocations, discard the first 5, sort the remaining 25 durations from a monotonic clock, and define p95 as element `ceil(0.95 * 25) - 1` (zero-based index 23). Use fixed stdin, fresh-but-static caches, a no-network marker state, and the same machine/job.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Generate and verify the payload (not wired yet).** Add the fixed final-state allowlist generator, committed generated module, runtime payload API, launcher Bun-pin marker, and byte-parity/completeness unit tests. The pre-cutover completeness test names the three legacy scripts in `LEGACY_AUTHORING_EXCLUSIONS`; it does not pretend they have stopped shipping. Add `--check` to binary build and package prepack, including dirty-input proofs for both `notification.mp3` and `docks-kit`. No consumer/package membership changes and no golden update. Done: either authoring-input mutation makes `--check` fail with the stale surface; regeneration restores deterministic outputs; binary build succeeds. Revert trigger: generated output is nondeterministic or an unlisted live SoT reader/file remains unexplained. | — | planned |
| 2 | **Substitute non-hook runtime readers without cutting over artifacts.** Migrate `claudeSync.ts`, `codexSync.ts`, `skillsSync.ts`, `models.ts`, `modes.ts`, `toolchain.ts`, `manifests.ts`, and `index.ts` to the payload contract; make `kitHome` payload-independent; preserve merge/copy order, backups, dry-run display strings, JSON/TOML bytes, model/plugin semantics, and current logs. Keep `SoT` and `notification.mp3` in npm `files`, keep the launcher's jq/SoT read, and keep exactly the three legacy Claude script reads until Step 5. No golden update. Done: grep finds no other product read/gate, the compiled checkout smoke and packed foreign-cwd real Claude sync both work with the still-shipped legacy assets, and every golden is unchanged. Revert trigger: an existing golden changes or any intermediate package loses a file it still reads. | 1 | planned |
| 3 | **Port hooks in parallel, scripts still authoritative.** Add `hook session-start/statusline/fetch-usage/notify`, pure helpers over the expanded `HookRuntime`, and characterization fixtures captured before deletion; preserve the old statusline as `cli/test/fixtures/hooks/statusline-oracle.sh`, which is excluded from product/package payloads. Run old shell and native statusline against controlled stdin/PATH/cache/time cases and exact ANSI bytes. Add split-channel, cache-security, corrupt-cache/fs/HTTP/schema/credential/detached-spawn/player-failure tests and the exact p95 benchmark algorithm above. Do not change settings or sync scripts; no golden update. Done: every fixture matches the oracle, fault rows meet the exit/output/spawn/cache contracts, no fake token leaks, and the resolved latency gate passes. Revert trigger: any byte mismatch, throttle duplication, token leak, or latency miss. | 1 | planned |
| 4 | **Prepare the compiled runner and settings materializer, still dormant.** Implement the resolved OQ-1 candidate resolver, ABI/payload probe, transaction/fallback contract, platform suffix/path quoting, Git-Bash detection, and pure placeholder materializer, but do not call either from `claudeSync` or edit authoring settings. Unit-test release-binary copy, Bun/npm one-time compile, no-op repeat, every first-install/upgrade failure branch, all three exact settings shells, and known-good preservation. Run the pre-cutover compiled/package real sync: both must still use working legacy assets. No golden update. Revert trigger: any existing sync/golden behavior changes, a failed candidate can replace a known-good runner, or either intermediate artifact cannot perform a real Claude sync. | 3 | planned |
| 5 | **Atomic payload/hook cutover, dependency downgrade, migration, and one golden recording.** In one slice: rewrite the authoring settings to the exact template (including the two-to-one SessionStart structural collapse); wire runner verification before any mutating Claude phase; materialize/merge settings; sync notification; only then prune the three legacy files via `REMOVED_MANIFEST`; delete the authoring scripts; reduce the generator exclusion to `.gitkeep`; remove `SoT`/`notification.mp3` from npm `files`; replace the launcher jq/SoT read with its generated pin; and require the final runtime-read grep to be empty. Demote `jq`/`curl` from global-required to check/optional, delete preflight exits, and retain contextual curl warnings. Add missing-jq/curl, legacy-cleanup, settings-structure, runner-failure, and hermetic real-sync coverage. Run `--update-goldens` exactly once per suite, inspect every label, and list them in the commit body. Revert trigger: any unauthorized golden, hand-edited golden JSON, cleanup/package depublishing before runner+settings work, or any command still needing jq. | 2, 4 | planned |
| 6 | **Cross-platform/package CI and documentation.** Give Linux and Windows the identical final artifact command matrix and hermetic real-sync/materialized-command assertions from Environment; run the end-to-end p95 gate through POSIX, Git Bash, and PowerShell statusline shells as applicable. Add both `notification.mp3` and root `docks-kit` to the push/pull-request path filters in `parity.yml` and `windows-entrypoints.yml`; keep payload freshness in CI and prove each input can independently make it red. Update README, bundled docs, AGENTS, and DESIGN from “runtime bundled SoT/deployed shell assets/jq+curl preflight” to “generated embedded payload/native hooks/contextual curl,” while documenting that statusLine itself remains shell-dispatched. Run the full gate once more. Done: every Acceptance command is green on the matching platform and release-relevant input changes trigger CI. Revert trigger: a stale payload can publish, the two artifact smoke lists diverge, or a supported Windows shell cannot run its exact materialized command. | 5 | planned |

## Authorized golden changes

Goldens are generated artifacts: never edit either JSON by hand. `--update-goldens` is permitted exactly once per suite, only in Step 5 after all intended behavior changes are present. Steps 1–4 and 6 require byte-identical goldens.

Exact authorized line/shape changes under the recommended hook-runner choice:

- Claude dry-run replaces `[dry-run] cp statusline.sh, fetch-usage.sh, notification.mp3` with `[dry-run] install compiled hook runner + notification.mp3` and removes the `cp -R .../hooks/` line.
- Real sync replaces `Scripts synced (statusline, fetch-usage, notification)` with `Native hooks synced (runner, notification)`, removes `Hooks synced (1 scripts)`, and changes the summary from `Hooks:    1 scripts` to `Hooks:    native (statusline, session-start, fetch-usage, notify)`. The verbose no-op twin is `Native hooks already in sync (runner, notification)`.
- Tree snapshots remove `.claude/statusline.sh`, `.claude/fetch-usage.sh`, and `.claude/hooks/notify.sh`, add the deterministic hook runner/marker selected in Open Question 1, and change `.claude/settings.json` because `SessionStart[0].hooks` collapses from two command objects to the one exec-form object above, Notification/Stop gain exact `args` arrays and native commands, and statusLine gains the selected shell command. `notification.mp3` bytes remain identical.
- The legacy migration case alone adds `Pruned stale artifacts (hooks: 1, files: 2, settings keys: 0, claude.json keys: 0)`.
- `toolchain check` changes only the KIND cells for `jq` and `curl` from `required` to `check`. Missing jq produces no warning and does not change exit status. Missing curl warns only at a remaining installer that actually needs it; no global preflight error remains.
- Linux missing-curl warnings are exact registry-backed lines: `curl not installed — sudo apt install -y curl (cannot download RTK installer; continuing sync without RTK)` and, for the agents/Bun path, `curl not installed — sudo apt install -y curl (cannot bootstrap Bun; install Bun manually, then re-run sync)`. Other platforms substitute only the existing platform install hint. The old global errors `jq is required (deployed statusline/hooks call it). Install: ...` and `curl is required. Install: ...` disappear completely.

Existing dry-run labels authorized to change (15; no additions):

```text
fixture=home-drift cmd=sync --dry-run
fixture=home-drift cmd=sync --dry-run --reconcile --prune
fixture=home-drift cmd=sync claude --dry-run
fixture=home-drift cmd=sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=home-drift cmd=sync claude --dry-run --claude-plugin=supabase
fixture=home-fresh cmd=sync --dry-run
fixture=home-fresh cmd=sync --dry-run --reconcile --prune
fixture=home-fresh cmd=sync claude --dry-run
fixture=home-fresh cmd=sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=home-fresh cmd=sync claude --dry-run --claude-plugin=supabase
fixture=home-invalid-json cmd=sync --dry-run
fixture=home-invalid-json cmd=sync --dry-run --reconcile --prune
fixture=home-invalid-json cmd=sync claude --dry-run
fixture=home-invalid-json cmd=sync claude --dry-run --claude-model=fable --claude-compact-window=680k --claude-permissive
fixture=home-invalid-json cmd=sync claude --dry-run --claude-plugin=supabase
```

Existing mutation labels authorized to change (15):

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

Four additive mutation labels are authorized (final count 51). Use these exact labels; if implementation needs a different label, update this plan before recording:

```text
fixture=home-fresh cmd=sync claude stubs=jq variant=jq-absent-native-hooks
fixture=home-fresh cmd=sync codex stubs=jq variant=jq-absent-native-sync
fixture=home-fresh cmd=sync claude stubs=curl,rtk variant=curl-absent-rtk-bootstrap
migration=legacy-claude-hook-scripts
```

No model-only, agents-only, Codex-only (except the additive missing-jq proof), toolchain-ensure, or TOML-shape golden may change. `channel-invariants` is not a golden label but must gain direct assertions that one SessionStart event emits exactly one `[CONTEXT]` line followed by exactly one `[CONFIG]` line on stdout only, statusline stdout stays data-only, fetch/notify remain silent, fake tokens never reach either channel, and missing dependency/runner warnings stay on stderr.

## Acceptance criteria

- [ ] Before Step 5, the generator completeness test names exactly the three scripts plus `.gitkeep` as exclusions, `package.json` still publishes `SoT`/notification, and both compiled-checkout and packed-foreign-cwd artifacts pass a real `sync claude --skip-rtk` with working legacy settings. After Step 5, the exclusion is exactly `.gitkeep`, `package.json` publishes neither `SoT` nor `notification.mp3`, and the three scripts no longer exist.
- [ ] `git grep -n -E 'readFileSync\([^\n]*SoT|p\([^\n]*"SoT"|join\([^\n]*"SoT"|existsSync\([^\n]*SoT|SoT/toolchain\.json' -- cli/src docks-kit` returns no product runtime read/gate in the final Step-5 slice; remaining `SoT` mentions are display text, documentation, generator/test code, or launcher comments that name the authoring source without opening it.
- [ ] `bun cli/scripts/generate-sot-payload.ts --check` exits 0; changing any allowlisted authoring byte makes it exit nonzero with the stale path; regenerating restores exact parity. Temp-root dirty-input tests independently prove that `notification.mp3` and the generated `docks-kit` Bun-pin marker are freshness inputs. A completeness test fails if a new live file appears under the three SoT payload roots without an explicit allowlist/exclusion decision.
- [ ] The standalone Linux binary, Windows `.exe`, and installed packed-tarball shim each run from a foreign temp cwd/home with no checkout, no `DOCKS_KIT_HOME`, no adjacent `SoT/`, and hermetic external-command stubs. Every artifact runs the identical Environment matrix: `sync --dry-run`, `models claude`, `status --json`, `toolchain check`, and real `sync claude --skip-rtk`; all exit 0 and never report “kit home not found.”
- [ ] After each real artifact sync, the runner/notification exist; the three scripts are absent; `settings.json` contains exactly the template shapes above with one SessionStart handler; the exact three exec-form hook command/args pairs and exact selected-shell statusline command execute successfully with the characterized output/argv. The packed tar listing contains neither `package/SoT/` nor `package/notification.mp3`.
- [ ] Claude and Codex mutation tests prove deployed files equal the generated payload bytes/merge results; agents/model/toolchain/status tests prove every secondary SoT reader uses the same payload. One SessionStart execution produces exactly `[CONTEXT]` then `[CONFIG]` once each on stdout and nothing on stderr.
- [ ] Statusline characterization compares exact ANSI bytes and final newline for model suffix stripping, folder/branch/detached SHA, no-git, missing fields, context cap math, `k/M` formatting, all reset units, usage cache present/stale/account-switched, and no usage. Every fixture equals the preserved non-shipping `statusline-oracle.sh` after source-script deletion.
- [ ] `fetch-usage` preserves credential order, 15-minute/credential-mtime invalidation, timeout, rounding/range guard, and four-line usage bytes while moving only the token cache to the secure per-user contract. Tests prove POSIX owner/mode/no-follow/atomic-replace rules, Windows per-user placement, safe legacy-cache cleanup, and zero token disclosure.
- [ ] Fault injection covers invalid statusline stdin, corrupt caches, read/write/touch failures, missing and invalid credential JSON, secure-cache rejection, HTTP non-2xx/timeout/schema failure, detached spawn failure, and player spawn failure. Every row asserts the specified exit 0, exact stdout/stderr, spawn count/argv, and preservation of all last-known-good cache/settings/runner bytes.
- [ ] The resolved p95 benchmark uses the Environment algorithm and exact materialized statusline command through POSIX, Windows Git Bash, or Windows PowerShell as applicable; the compiled runner meets the selected absolute/relative thresholds and settings never point at `bun cli/src/main.ts` or a global TypeScript shim.
- [ ] Runner tests prove the exact first-install hard failure, incompatible-upgrade hard failure, compatible known-good reuse warning, probe bytes, phase stop, and atomic preservation contract. A migration mutation begins with all three deployed scripts, completes one Claude sync, executes the replacement settings, and only then proves all three scripts are gone.
- [ ] `jq` is optional/check-only and unused by deployed hooks/statusline; missing jq blocks neither Claude nor Codex sync. `curl` is optional/check-only globally; missing curl blocks neither config sync nor Codex sync and warns only when RTK/Bun bootstrap is actually attempted. Launcher/installer curl use before the CLI exists remains documented and out of this runtime promise.
- [ ] Both relevant workflow push/pull-request filters include `notification.mp3` and root `docks-kit`; payload freshness gates run in CI, and tests prove dirtying either input independently makes `--check` red before restoring the workspace.
- [ ] The exact authorized golden labels above are the complete diff from `af68176`: 22 dry-run cases and 51 mutation cases pass; both prove-red commands print `prove-red OK` and exit 1; no golden JSON is hand-edited and only Step 5 runs `--update-goldens`.
- [ ] `bun x tsc --noEmit -p cli/tsconfig.json`, `bun x vitest run`, both normal golden suites, both prove-red legs, payload check, the identical compiled/package artifact matrix, and Windows workflow all meet the expected results in Environment.

## Out of scope / do-NOT-touch

- Do not remove or weaken the status line, change its colors/layout/field order/rounding/countdown semantics, or replace exact byte parity with a visual assertion.
- Do not delete `SoT/`, make generated payload code the authoring source, or hand-edit generated payload/golden files. Human changes still begin in `SoT/` (and `notification.mp3`) and regenerate.
- Do not change Claude/Codex settings merge/reconcile semantics, TOML table order, plugin order/state, model catalog wording, toolchain gate policy, universal-skill install/prune behavior, backups, or next-step advice beyond the exact hook/dependency bytes authorized above.
- Do not remove curl from the repo launcher, Unix installer, or optional RTK/Bun bootstrap; this plan removes the usage-fetch consumer and the global preflight requirement only.
- Do not introduce a runtime extraction directory for the whole payload, a network fetch for config, a second payload source, a Node requirement, or a new package dependency.
- Do not broaden notification behavior beyond parity: Windows success-with-no-player remains a valid no-op; adding a new Windows media backend is a separate decision.
- Do not publish or release from this plan. Implementation ends at green build/package/workflow evidence and an in-review plan transition.

## Known gotchas

- Static `with { type: "file" }` imports alone do not satisfy the npm/dev contract: Bun returns a disk path outside standalone mode. Keep the generated-module boundary even though compiled binaries support `/$bunfs/` assets.
- `.sh` has Bun's shell-script loader and is not available to the bundler as ordinary code; explicit file imports would need a loader override. The plan deletes the scripts after characterization instead.
- `engineCapture` re-spawns `process.execPath`; compiled mode must omit the `main.ts` argument while Bun/npm mode must include it. Extract/reuse that argv decision for background `fetch-usage` spawning rather than reintroducing the Windows stray-main-path bug.
- JSON settings are an authoring template once hook binary paths become platform-specific. Materialize replacements in memory before merge; never mutate the generated payload or authoring file at runtime.
- Claude command-hook objects with `args` are direct exec, but `statusLine.command` is always shell-dispatched; on Windows that means Git Bash when installed and PowerShell otherwise. Test/materialize these as different contracts, and require a real `.exe` for Windows direct exec rather than a `.cmd`/`.bat` shim.
- The usage token cache contains a bearer token. Its move from shared temp to secure per-user storage is an authorized security improvement, not byte parity; tests must use fake tokens and must never print cache contents or child environment.
- A compiled runner copied while executing on Windows can need copy-to-temp then atomic rename/retry semantics. Never delete the known-good runner first.
- Golden tree snapshots hash every file. The hook runner fixture/hash must be deterministic or explicitly normalized; never record host-specific compiled bytes into `mutation.json`.
- `statusline.sh` uses shell/awk rounding and integer truncation in different places. JavaScript `Math.round` is not a blanket substitute; characterization fixtures are the behavioral oracle.

## Cold-handoff checklist

- **File manifest:** exact existing/new/delete paths are in `affected_paths`; the generated allowlist is explicit in Interfaces. N/A paths are not hidden behind “and related files.”
- **Environment/commands:** Bun version, all six regression gates, generator check, identical binary/package command matrices, hermetic real sync, exact materialized-command execution, p95 algorithm, and expected exits/counts are in Environment.
- **Interfaces/data contracts:** payload lifecycle/union/functions, path-vs-content sync signatures, hook argv/platform/runner identity, exact settings JSON, shell selection, cache security, fault behavior, and transactional cutover order are specified above.
- **Executable acceptance:** every goal has a command or deterministic test; foreign-cwd compiled/package runs prove the negative runtime dependency.
- **Out of scope:** statusline bytes, merge semantics, curl bootstrap scope, generated-file ownership, dependencies, notification expansion, and release are fenced.
- **Decision rationale:** generated TypeScript payload is chosen over standalone-only file imports because it unifies compiled/npm/dev and removes disk SoT reads. Legacy cleanup waits for runner+settings because rollback must remain possible.
- **Known gotchas:** Bun loaders, engineCapture child argv, direct-exec versus statusline shell dispatch, settings templating, token secrecy, Windows replacement, deterministic golden hashes, and rounding are enumerated.
- **Global constraints (verbatim):** “statusline is KEPT — ported as a subcommand with byte-identical output, never dropped”; “jq necessity removed”; “both Claude and Codex sync paths covered”; “SoT/ remains in the repo as build-time authoring source only — it stops being a runtime read dependency.”
- **Undefined/forward terms:** `payload`, `hook runner`, `authoring source`, `foreign cwd`, and every cache path are defined before Steps. Execution cannot start until both Open questions are answered and encoded here.

## Self-review

- Score: 97/100 · trajectory 78→89→94→97→97→97 · stopped: plateau (K=3).
- Pass 1 caught the launcher's optional `jq` read of `SoT/toolchain.json`, which would have violated the build-time-only decision even after the TypeScript readers moved; the generator-owned pin marker now closes it without floating Bun.
- Pass 2 caught an untestable `HookRuntime`, the intentional Codex `.gitkeep` false positive, a Step-4/Step-5 golden-boundary ambiguity, broad fixture path, and underspecified missing-curl bytes; all are now explicit contracts.
- Pass 3 ingested the external draft review: atomic depublishing moved to the cutover; the exact one-handler settings shape, exec/shell split, runner transaction, secure token cache, platform/runner runtime identity, preserved latency oracle/algorithm, hermetic real-sync matrix, CI input filters, and fault table are now executable contracts.
- Cross-check (2026-07-10): [codex gpt-5.6-sol xhigh] 10 findings (5 high / 5 med) — 10 accepted, 0 rejected; [claude] independently verified F1, F2, F9 against source before accepting.
- Claude review (2026-07-10): no blocking defects; 2 notes accepted — OQ-1 now states per-option disk/package costs, and Environment/Acceptance use one identical artifact smoke matrix.
- Adversarial cold-read with only this file found no remaining implementation guess beyond OQ-1 (runner distribution) and OQ-2 (latency thresholds). The ABI/failure/guard mechanics and measurement method are fixed regardless of those choices; execution remains blocked until both choices are encoded.
- Open-question ingest (2026-07-10): OQ-1 → option 1 per-user full-CLI runner (user via picker); OQ-2 → the user's answer became decision 6 (improve statusline internals, bytes unchanged) and the latency budget took recommended option 1 as an orchestrator-accepted default. Both encoded in Context (decisions 5–6) and Interfaces; the Open questions section is removed and execution is unblocked.
- Weighted result: standalone executability 21/22; actionability 16/16; dependency order 12/12; evidence re-verify 10/10; goal coverage 14/14; executable acceptance 12/12; failure modes 8/8; assumption-to-question 4/6. The retained three points are the two explicitly surfaced product choices, not silent defaults.

## Sources

- `cli/src/engine-native/claudeSync.ts:28-54` — Claude pipeline order; scripts/hooks precede templates/settings and removals precede plugins.
- `cli/src/engine-native/claudeSync.ts:122-175` — current script/notification and hook-directory copy branches to replace.
- `cli/src/engine-native/claudeSync.ts:177-263` — CLAUDE.md/settings reads and exact merge/install/backup behavior.
- `cli/src/engine-native/claudeSync.ts:334-355` — mcp-servers payload read and merge.
- `cli/src/engine-native/claudeSync.ts:447-538` — curated unconditional removed-artifact manifest and counters used for legacy cleanup.
- `cli/src/engine-native/claudeSync.ts:565-595` and `800-807` — settings payload is reread for plugins and LSP decisions.
- `cli/src/engine-native/codexSync.ts:14-28` — every Codex payload path and load-bearing operation order.
- `cli/src/engine-native/codexSync.ts:98-134`, `182-224`, `228-314`, and `421-450` — config text merge, rules/AGENTS copy, marketplace JSON, and plugin-ID consumers.
- `SoT/.claude/statusline.sh:1-175` — complete statusline byte/layout, cache, throttle, math, git, and formatting oracle.
- `SoT/.claude/fetch-usage.sh:1-66` — token/usage cache, credential/Keychain order, curl request, schema/range guard, and four-line format.
- `SoT/.claude/hooks/notify.sh:1-14` — sound existence guard and player priority/argv.
- `SoT/.claude/settings.json:132-211` — two inline SessionStart commands, Notification/Stop script commands, and statusLine command; line 143 is the additional jq consumer.
- `cli/src/engine-native/deps.ts:195-218` and `cli/src/engine-native/parseArgs.ts:187-200` — jq/curl required registry rows and global preflight exits.
- `SoT/toolchain.json:1-12` — jq/curl are declared `kind: required`; ffplay is check-only.
- `cli/src/engine-native/skillsSync.ts:20-35`, `286-312`, and `354-363` — agents/settings payload reads and remaining contextual curl use for Bun bootstrap.
- `cli/src/engine-native/models.ts:11-17`, `cli/src/engine-native/modes.ts:36-54`, and `cli/src/engine-native/toolchain.ts:15-25` — model catalog, displayed SoT model, and toolchain manifest readers.
- `cli/src/manifests.ts:21-31`, `44-76` — public status/models/plugins/skills readers outside EngineNative.
- `cli/src/engine-native/index.ts:50-90` and `cli/src/kitHome.ts:4-30` — Ctx root construction and runtime SoT existence gates/home resolution.
- `cli/build-binaries.sh:14-20` — current five-target `bun build --compile` loop has no payload freshness gate.
- `docks-kit:42-49` — the no-Bun launcher currently invokes optional jq and reads `SoT/toolchain.json` at runtime to obtain the Bun pin.
- `package.json:11-22` — npm bin is source TypeScript and publishes `SoT` plus the sound today.
- `cli/src/commands/docs.ts:4-13` — existing repository precedent for text embedded in CLI modules.
- `install.sh:34-42` — Unix global install links docks-kit into `~/.local/bin`; useful but not cross-platform enough to assume as the hook path.
- `.github/workflows/parity.yml:3-20` and `.github/workflows/windows-entrypoints.yml:3-20` — push/pull path filters currently omit both root `docks-kit` and `notification.mp3`.
- `.github/workflows/windows-entrypoints.yml:55-103` — compiled smoke currently checks out/seeds SoT and documents the engineCapture compiled-child argv gotcha.
- `cli/test/golden-dryrun.ts:38-51` and `cli/test/golden-mutation.ts:64-114`, `369-415` — exact current 22-case dry-run and 47-case mutation/replay/TOML matrices.
- `README.md:20-32`, `108-117` — current user contract says release binaries need a checkout, jq+curl are prerequisites, and npm bundles SoT.
- https://bun.sh/docs/bundler/executables — official Bun contract: `with { type: "file" }` embeds readable `/$bunfs/` paths only in standalone executables; direct development returns a disk path.
- https://bun.sh/docs/bundler/loaders — official Bun contract: text imports inline during bundling, while the `.sh` loader is runtime-only and unavailable to the bundler.
- https://code.claude.com/docs/en/hooks — official Claude hook contract: command hooks with `args` directly spawn `command` without shell parsing; on Windows the command must be a real executable.
- https://code.claude.com/docs/en/statusline — official statusline contract: `statusLine.command` is shell-dispatched, using Git Bash on Windows when available and PowerShell otherwise.

## Review

(filled by plan-review on completion)
