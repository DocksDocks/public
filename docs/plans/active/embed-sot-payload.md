---
title: Embed the SoT payload and replace Claude shell hooks
goal: Make every sync/config read independent of a runtime SoT/ directory by generating an embedded payload for compiled and Bun/npm execution, and replace Claude's shell hooks with native CLI subcommands.
status: planned
created: "2026-07-10T00:32:24-03:00"
updated: "2026-07-10T00:32:24-03:00"
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
  - cli/test/fixtures/hooks/statusline.json
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

Additional audited consequences:

- The three script files are not the only `jq` consumer: the second `SessionStart` command in `SoT/.claude/settings.json` reads `.effortLevel` with `jq`. It must become native too.
- `curl` remains legitimate bootstrap plumbing for RTK, Bun, the Unix installer, and the repo launcher. Only usage fetching moves to Bun/WHATWG `fetch`; global sync preflight must stop aborting merely because `curl` is absent, and each remaining installer must warn/degrade at its own call site.
- The status line runs every five seconds and currently throttles background usage refreshes to one spawn per five-second marker window. The native port must preserve that throttle and invoke a compiled runner, not the TypeScript package shim, once the hook-runner decision below is resolved.
- The shipped Windows plan treated the three scripts as the final Git-Bash-backed exception. Removing them closes that exception; Windows settings, binary suffixes, temp paths, credential reads, and player probing need first-class tests.

## Interfaces & data shapes

### Generated payload contract

`cli/scripts/generate-sot-payload.ts` owns a fixed allowlist. The live payload after the shell deletion is exactly:

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

`payloadDisplayPath` is presentation-only: in a checkout/package root it preserves existing `.../SoT/...` dry-run labels; without one it returns `embedded:<path>`. No sync decision or read may depend on that display path. `payload.test.ts` compares every generated entry to the authoring file bytes and asserts no unlisted authoring file is silently deployable. The completeness inventory excludes exactly `SoT/.codex/agents/.gitkeep`; the empty `SoT/.codex/bin/` directory has no bytes to embed. Any future exclusion requires an explicit generator/test change.

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

export interface HookRuntime {
  readonly nowMs: () => number
  readonly env: NodeJS.ProcessEnv
  readonly home: string
  readonly tmpDir: string
  readonly exists: (path: string) => boolean
  readonly mtimeMs: (path: string) => number
  readonly readText: (path: string) => string | undefined
  readonly writeText: (path: string, content: string, mode?: number) => void
  readonly remove: (path: string) => void
  readonly touch: (path: string) => void
  readonly capture: (
    command: string,
    args: ReadonlyArray<string>,
    cwd?: string
  ) => { readonly status: number; readonly stdout: string }
  readonly spawnDetached: (command: string, args: ReadonlyArray<string>) => boolean
  readonly fetchUsage: (token: string, timeoutMs: number) => Promise<UsageResponse | undefined>
}
```

- `session-start`: writes the existing `[CONTEXT]` line then existing `[CONFIG]` line, byte-for-byte, reading `effortLevel` from the embedded settings default when the deployed file is missing/invalid. No `jq` or `date` child.
- `statusline`: reads one JSON value from stdin; writes exactly one ANSI line and newline. It preserves model suffix stripping, directory basename, branch-or-detached-SHA lookup, effective compact-window math, token formatting, cache freshness/account-switch invalidation, largest-unit reset countdown, color bytes, separators, and field omission/order. It spawns `hook fetch-usage` detached through the same compiled runner at most once per five seconds.
- `fetch-usage`: preserves `/tmp/.claude_usage_cache`, `/tmp/.claude_token_cache`, and `/tmp/.claude_usage_fetching` on POSIX for migration compatibility; uses `tmpDir` equivalents on Windows. It preserves the 15-minute token cache, credential-newer invalidation, `~/.claude/.credentials.json` then macOS Keychain token order, three-second timeout, nearest-integer utilization, 0–100 guard, and the exact four-line usage-cache format. It emits nothing and exits 0 on missing credentials, network failure, or schema mismatch.
- `notify`: if `~/.claude/notification.mp3` is absent, exit 0. Player priority remains macOS `afplay`, then `ffplay`, `paplay`, `aplay`; Windows may use `ffplay` when present and otherwise exits 0. Spawned player argv is unchanged (`ffplay -nodisp -autoexit -loglevel quiet`, `aplay -q`). No output.

The exact compiled hook-runner location/guard and latency threshold are the two open decisions below. The recommended choice materializes a version/hash-keyed full CLI runner at `~/.claude/bin/docks-kit-hook` (`.exe` on Windows); a release binary copies itself, while Bun/npm/dev compiles `cli/src/main.ts` once and reuses it. Sync materializes platform-specific guarded command strings from placeholders in the embedded settings before merge; cleanup runs only after the runner exists and settings merge succeeds.

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
- Payload/build/package proof after Steps 1, 2, and 5:
  - `bun cli/scripts/generate-sot-payload.ts --check` → exit 0.
  - `bash cli/build-binaries.sh linux-x64` → exit 0.
  - Copy `cli/dist/docks-kit-linux-x64` to a fresh temp directory, set fresh `HOME`, change cwd there, and run `./docks-kit-linux-x64 sync --dry-run` plus `models claude`; both exit 0 without `DOCKS_KIT_HOME` and without any adjacent `SoT/`.
  - `bun pm pack --destination <temp>`; tar listing contains neither `package/SoT/` nor `package/notification.mp3`; install the tarball globally under a temp Bun home, change to a foreign cwd, and run `docks-kit sync --dry-run`, `docks-kit models claude`, and `docks-kit toolchain check`, all exit 0.

## Steps

| # | Task | Depends | Status |
|---|---|---|---|
| 1 | **Generate and verify the payload (not wired yet).** Add the fixed allowlist generator, committed generated module, runtime payload API, launcher Bun-pin marker, and byte-parity/completeness unit test. Add `--check` to binary build and package prepack. No existing consumer changes and no golden update. Done: authoring edits make `--check` fail; regeneration restores the module/launcher marker; binary build succeeds. Revert trigger: generated output is nondeterministic or an unlisted live SoT reader/file remains unexplained. | — | planned |
| 2 | **Substitute every runtime reader without changing behavior.** Migrate `claudeSync.ts`, `codexSync.ts`, `skillsSync.ts`, `models.ts`, `modes.ts`, `toolchain.ts`, `manifests.ts`, and `index.ts` to the payload contract; make `kitHome` payload-independent; preserve merge/copy order, backups, dry-run display strings, JSON/TOML bytes, model/plugin semantics, and current logs. Remove `SoT` and `notification.mp3` from npm `files` only after compiled and packed foreign-cwd smokes pass. Remove the launcher's jq/SoT parse in favor of its generated pin marker. No golden update. Done: the runtime-read grep in Acceptance is empty across `cli/src` and the launcher, and both delivery smokes pass. Revert trigger: any existing golden case changes or the foreign-cwd binary/package reads a checkout. | 1 | planned |
| 3 | **Port hooks in parallel, scripts still authoritative.** Add `hook session-start/statusline/fetch-usage/notify`, pure helpers over `HookRuntime`, and characterization fixtures captured before deleting the scripts. Run old shell and new native statusline against controlled stdin/PATH/cache/time cases and pin exact ANSI bytes; pin fetch/token cache and notify argv/no-op branches. Add a compiled-runner latency benchmark using the resolved budget. Do not change settings or sync scripts yet; no golden update. Done: native output equals the recorded shell oracle for every fixture, silent commands have empty stdout/stderr, and Windows path/temp/player cases pass. Revert trigger: any byte mismatch, throttle duplication, token leak, or latency miss. | 1 | planned |
| 4 | **Prepare the compiled hook runner and settings materializer, still dormant.** Implement the resolved Open Question 1 resolver/installer, runner hash/version reuse, platform suffix/quoting, and a pure settings-placeholder materializer, but do not call either from `claudeSync` and do not edit the authoring settings yet. Unit-test release-binary copy, Bun/npm one-time compile, no-op repeat, missing-runner guard, and failure behavior. Step 5 wires the transactional order: runner verified first, settings merged second, legacy cleanup third. No golden update. Revert trigger: any existing sync/golden behavior changes or a failed compile/copy could overwrite a known-good runner. | 3 | planned |
| 5 | **Atomic cutover, dependency downgrade, migration, and the one golden recording.** Rewrite all four settings command surfaces to the guarded runner; replace Claude's script/hook copy branches with runner+notification sync; add the three old files to `REMOVED_MANIFEST`; delete the three authoring scripts; demote `jq` and `curl` from global-required to check/optional and delete preflight hard exits; use contextual `warnMissing` at remaining curl bootstrap call sites. Add the missing-jq, missing-curl, and legacy-cleanup mutation cases. Run `--update-goldens` exactly once for each suite in this slice, inspect per-label diffs, and name every label in the commit body. Revert trigger: any changed golden outside the authorization below, any hand-edited golden JSON, cleanup before the runner/settings are usable, or any command still needing jq. | 2, 4 | planned |
| 6 | **Cross-platform/package CI and documentation.** Make Windows entrypoint CI run the compiled binary from a foreign cwd with no seeded SoT; make the packed Bun shim prove `SoT/` is absent; add native-hook/statusline smoke and latency assertions on Linux and Windows; update README, bundled docs, AGENTS, and DESIGN from “runtime bundled SoT/shell hooks/jq+curl preflight” to “generated embedded payload/native hooks/contextual curl.” Run the full gate once more. Done: all Acceptance criteria are executable and green. Revert trigger: release workflow can publish a stale generated payload or either supported Windows entrypoint needs Git Bash for a deployed hook script. | 5 | planned |

## Authorized golden changes

Goldens are generated artifacts: never edit either JSON by hand. `--update-goldens` is permitted exactly once per suite, only in Step 5 after all intended behavior changes are present. Steps 1–4 and 6 require byte-identical goldens.

Exact authorized line/shape changes under the recommended hook-runner choice:

- Claude dry-run replaces `[dry-run] cp statusline.sh, fetch-usage.sh, notification.mp3` with `[dry-run] install compiled hook runner + notification.mp3` and removes the `cp -R .../hooks/` line.
- Real sync replaces `Scripts synced (statusline, fetch-usage, notification)` with `Native hooks synced (runner, notification)`, removes `Hooks synced (1 scripts)`, and changes the summary from `Hooks:    1 scripts` to `Hooks:    native (statusline, session-start, fetch-usage, notify)`. The verbose no-op twin is `Native hooks already in sync (runner, notification)`.
- Tree snapshots remove `.claude/statusline.sh`, `.claude/fetch-usage.sh`, and `.claude/hooks/notify.sh`, add the deterministic hook runner/marker selected in Open Question 1, and change `.claude/settings.json` hashes only because the four command strings changed. `notification.mp3` bytes remain identical.
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

No model-only, agents-only, Codex-only (except the additive missing-jq proof), toolchain-ensure, or TOML-shape golden may change. `channel-invariants` is not a golden label but must gain direct assertions that hook/statusline stdout stays data-only, fetch/notify remain silent, and missing dependency warnings stay on stderr.

## Acceptance criteria

- [ ] `git grep -n -E 'readFileSync\([^\n]*SoT|p\([^\n]*"SoT"|join\([^\n]*"SoT"|existsSync\([^\n]*SoT|SoT/toolchain\.json' -- cli/src docks-kit` returns no product runtime read/gate; remaining `SoT` mentions are display text, documentation, generator/test code, or launcher comments that name the authoring source without opening it.
- [ ] `bun cli/scripts/generate-sot-payload.ts --check` exits 0; changing any allowlisted authoring byte makes it exit nonzero with the stale path; regenerating restores exact parity. A completeness test fails if a new live file appears under the three SoT payload roots without an allowlist decision.
- [ ] `package.json` no longer publishes `SoT` or `notification.mp3`; packed-tarball listing proves both absent; global tarball install from a foreign cwd passes `sync --dry-run`, `models claude`, `status --json`, and `toolchain check`.
- [ ] A standalone Linux binary and the Windows `.exe`, each run from a foreign temp cwd/home with no checkout and no `DOCKS_KIT_HOME`, pass `sync --dry-run`, `models claude`, and `status --json`; output contains the expected embedded catalog/config data and never a “kit home not found” error.
- [ ] Claude and Codex mutation tests prove deployed files equal the generated payload bytes/merge results; agents/model/toolchain/status tests prove every secondary SoT reader uses the same payload.
- [ ] Statusline characterization fixtures compare exact bytes, including ANSI escapes and final newline, for model suffix stripping, folder/branch/detached SHA, no-git, missing fields, context cap math, `k/M` formatting, all reset countdown units, usage cache present/stale/account-switched, and no usage. Every fixture equals the old script oracle captured before deletion.
- [ ] `session-start` emits the two current lines byte-for-byte under a fixed clock/env/settings fixture; `fetch-usage` preserves token/usage cache invalidation, three-second timeout, rounding/range guard, and four-line format with empty stdout/stderr; `notify` preserves player priority/argv and no-op behavior with empty stdout/stderr.
- [ ] The resolved latency benchmark passes for the compiled runner on Linux and Windows; settings point at that compiled runner, never `bun cli/src/main.ts` or a global TypeScript shim.
- [ ] A migration mutation starts with all three previously synced scripts, completes one Claude sync, proves the native runner/settings work, and then proves all three scripts are gone. A forced runner install failure leaves legacy settings/files untouched and exits/warns according to the resolved contract.
- [ ] `jq` is optional/check-only and unused by deployed hooks/statusline; missing jq does not block Claude or Codex sync. `curl` is optional/check-only globally; missing curl blocks neither config sync nor Codex sync and warns only when RTK/Bun bootstrap is actually attempted. Launcher/installer curl use before the CLI exists remains documented and out of this runtime promise.
- [ ] The exact authorized golden labels above are the complete diff from `af68176`: 22 dry-run cases and 51 mutation cases pass; both prove-red commands print `prove-red OK` and exit 1; no golden JSON is hand-edited and only Step 5 runs `--update-goldens`.
- [ ] `bun x tsc --noEmit -p cli/tsconfig.json`, `bun x vitest run`, both normal golden suites, both prove-red legs, payload check, compiled foreign-cwd smoke, packed-tarball foreign-cwd smoke, and Windows workflow all meet the expected results in Environment.

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
- The usage token cache contains a bearer token. Preserve silence and existing location/invalidations; tests must use fake tokens and must never print cache contents or child environment.
- A compiled runner copied while executing on Windows can need copy-to-temp then atomic rename/retry semantics. Never delete the known-good runner first.
- Golden tree snapshots hash every file. The hook runner fixture/hash must be deterministic or explicitly normalized; never record host-specific compiled bytes into `mutation.json`.
- `statusline.sh` uses shell/awk rounding and integer truncation in different places. JavaScript `Math.round` is not a blanket substitute; characterization fixtures are the behavioral oracle.

## Cold-handoff checklist

- **File manifest:** exact existing/new/delete paths are in `affected_paths`; the generated allowlist is explicit in Interfaces. N/A paths are not hidden behind “and related files.”
- **Environment/commands:** Bun version, all six regression gates, generator check, binary smoke, package smoke, and expected exits/counts are in Environment.
- **Interfaces/data contracts:** payload union/functions, path-vs-content sync signatures, hook argv, input/response/runtime shapes, cache format, and transactional cutover order are specified above.
- **Executable acceptance:** every goal has a command or deterministic test; foreign-cwd compiled/package runs prove the negative runtime dependency.
- **Out of scope:** statusline bytes, merge semantics, curl bootstrap scope, generated-file ownership, dependencies, notification expansion, and release are fenced.
- **Decision rationale:** generated TypeScript payload is chosen over standalone-only file imports because it unifies compiled/npm/dev and removes disk SoT reads. Legacy cleanup waits for runner+settings because rollback must remain possible.
- **Known gotchas:** Bun loaders, engineCapture child argv, settings templating, token secrecy, Windows replacement, deterministic golden hashes, and rounding are enumerated.
- **Global constraints (verbatim):** “statusline is KEPT — ported as a subcommand with byte-identical output, never dropped”; “jq necessity removed”; “both Claude and Codex sync paths covered”; “SoT/ remains in the repo as build-time authoring source only — it stops being a runtime read dependency.”
- **Undefined/forward terms:** `payload`, `hook runner`, `authoring source`, `foreign cwd`, and every cache path are defined before Steps. Execution cannot start until both Open questions are answered and encoded here.

## Self-review

- Score: 94/100 · trajectory 78→89→94→94→94 · stopped: plateau (K=3).
- Pass 1 caught the launcher's optional `jq` read of `SoT/toolchain.json`, which would have violated the build-time-only decision even after the TypeScript readers moved; the generator-owned pin marker now closes it without floating Bun.
- Pass 2 caught an untestable `HookRuntime`, the intentional Codex `.gitkeep` false positive, a Step-4/Step-5 golden-boundary ambiguity, broad fixture path, and underspecified missing-curl bytes; all are now explicit contracts.
- Adversarial cold-read with only this file found no remaining implementation guess beyond OQ-1 (compiled runner lifecycle/guard) and OQ-2 (latency budget). Both are bounded, recommended, and block execution until encoded.
- Weighted result: standalone executability 21/22; actionability 15/16; dependency order 12/12; evidence re-verify 10/10; goal coverage 14/14; executable acceptance 11/12; failure modes 7/8; assumption-to-question 4/4. The six retained points are the two explicitly surfaced user decisions, not silent defaults.

## Open questions

### OQ-1 — hook-runner installation and guard

- id: `hook-runner-install`
- type: `choice` (custom allowed)
- question: Which binary must deployed Claude commands invoke on every install surface?
- options:
  1. **Per-user compiled runner (recommended):** sync keeps `~/.claude/bin/docks-kit-hook` (`.exe` on Windows) keyed by CLI/payload hash. A release binary copies itself atomically; Bun/npm/dev compiles `cli/src/main.ts` once with the current Bun and reuses it. Settings materialization writes an absolute, platform-specific missing-file no-op guard. This satisfies the compiled latency requirement everywhere at the cost of a one-time local build.
  2. **Prebuilt per-platform companion:** release and npm artifacts carry platform hook runners; sync selects/copies the local one and writes the same guarded absolute command. No first-sync compilation, but substantially enlarges the npm artifact and needs platform-package/release plumbing.
  3. **Minimal locally compiled hook entrypoint:** Bun/npm/dev compile only the hook dispatcher; release builds ship that companion beside the full CLI. Fastest startup/smallest copied runner, but adds a second compiled entrypoint whose command/version/payload parity must be gated against the public CLI.

### OQ-2 — statusline latency budget

- id: `statusline-latency-budget`
- type: `choice` (custom allowed)
- question: What measured warm-start budget gates the compiled statusline runner?
- options:
  1. **p95 ≤100 ms Linux, ≤200 ms Windows (recommended):** 30 invocations, discard the first 5, fixed no-network/no-fetch fixture; also require no more than 25% regression against the captured shell baseline on the same runner.
  2. **p95 ≤50 ms on both:** stricter redraw budget; may require a minimal dedicated entrypoint rather than the full Effect CLI binary.
  3. **Relative only:** native p95 must not exceed the old shell script p95 on each platform; portable but allows a slow absolute result on a slow runner.

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
- `.github/workflows/windows-entrypoints.yml:55-103` — compiled smoke currently checks out/seeds SoT and documents the engineCapture compiled-child argv gotcha.
- `cli/test/golden-dryrun.ts:38-51` and `cli/test/golden-mutation.ts:64-114`, `369-415` — exact current 22-case dry-run and 47-case mutation/replay/TOML matrices.
- `README.md:20-32`, `108-117` — current user contract says release binaries need a checkout, jq+curl are prerequisites, and npm bundles SoT.
- https://bun.sh/docs/bundler/executables — official Bun contract: `with { type: "file" }` embeds readable `/$bunfs/` paths only in standalone executables; direct development returns a disk path.
- https://bun.sh/docs/bundler/loaders — official Bun contract: text imports inline during bundling, while the `.sh` loader is runtime-only and unavailable to the bundler.

## Review

(filled by plan-review on completion)
