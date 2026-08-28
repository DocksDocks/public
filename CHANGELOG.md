# Changelog

## 2026-08-28 — Claude permissions: parseable rules, trimmed allow list, retired-rule prune, memory and dream off

- Escaped the 14 `permissions.deny` PowerShell rules whose specifier ended in a
  single backslash before the closing parenthesis, such as
  `PowerShell(rm *-Recurse* *:\)`. Claude Code counts backslash parity, so the
  `\` escaped the `)` and every session start printed `Invalid permission
  rule … Mismatched parentheses` while the rule protected nothing. The SoT now
  writes `\\` in those positions.
- Trimmed `permissions.allow` to `Read`, `Glob`, `Grep`, `WebSearch`, and
  `Edit(./)`. The 128 removed shell rules (`Bash(git *)`, `Bash(curl *)`,
  `Bash(docker *)`, and their `PowerShell(...)` twins) resolved before both
  Claude Code's read-only command analyzer and the auto-mode classifier, so
  destructive variants such as `git clean -fdx` were pre-approved with no
  review step. The analyzer already runs the safe read-only forms with no
  prompt. `WebFetch` was removed for the same reason.
- Kept every `PowerShell(...)` deny and ask rule on every host. The tool is
  opt-in off Windows, not unavailable, so a host that enables it must already
  carry the guards. An earlier draft of this change gated the rules by platform
  and was reverted before release.
- Added `claudeRetired.ts RETIRED_PERMISSION_RULES` and extended
  `claudeSync.ts syncRemovals` to force-prune it. `mergeSettings` unions
  deployed arrays with SoT arrays, so a rule dropped from the SoT would
  otherwise survive forever on a machine an earlier sync wrote. Exact strings
  only, so a user-authored rule outside the inventory survives.
- Set `autoMemoryEnabled: false` and `autoDreamEnabled: false`. Auto-memory
  injects a mutable MEMORY.md head into the cached prompt prefix, which breaks
  cache invariance; dream tasks bill extra model calls between turns.
- Replaced the change-detector permission tests with invariants. Instead of
  restating the rule list, `cli/test/lib/permissionRules.ts` ports the rule
  grammar from the Claude Code 2.1.251 parser and the truth tests assert
  behavior: every shipped rule parses, each retired malformed spelling is
  rejected, the destructive command corpus is denied on both shells, an
  ordinary recursive delete is left to the classifier, and the allow list
  pre-approves no shell command.
  `cli/test/unit/claudeRetiredPermissions.test.ts` covers the prune, the
  surviving user rules, and the SoT PowerShell rules that stay deployed.

## 2026-08-21 — Release proof states only the guarantee it enforces

- The release workflow proves the published tarball holds the tag's files on
  every run: it unpacks the tarball and compares every unpacked file with the
  same list rebuilt from the tag. A file that `bun pm pack` ships while git
  ignores it, a stale tarball with drifted contents, and a branch that deleted
  a whole packaged directory now each fail the release instead of publishing
  content that never existed at the tag.

## 2026-08-21 — Bun 1.4.0 toolchain target, lockfile v2, and release-path hardening

- Patched two transitive advisories inside their existing caret ranges:
  `nanoid` 3.3.15 to 3.3.18 and `postcss` 8.5.16 to 8.5.23. Both are reached
  only through `vitest`, so no pinned version moved.
- Replaced the `/$bunfs/` path heuristic for detecting a compiled binary with
  `Bun.isStandaloneExecutable`, which Bun 1.4.0 adds as public API and which
  1.4.0 requires because the private path is gone. A `typeof Bun` guard keeps
  the module importable under Node, where the unit suite loads it. `@types/bun`
  moved to `^1.4.0` for the declaration.
- CI installs Bun 1.4.0, and its install-cache keys moved with the version.
- Bun's toolchain entry targets 1.4.0 for both `floor` and `verified`, and the
  payload generator emits a second marked block, `BUN_FLOOR`, into the two
  checkout launchers. `docks-kit` and `docks-kit.ps1` now refuse to run
  `bun install --frozen-lockfile` on a Bun below that floor and name
  `bun upgrade` in the error, because a 1.3.x runtime cannot read this
  repository's lockfile. The floor is deliberately separate from the verified
  install pin, which still selects the exact release for kit-driven installs.
- `bun.lock` is now `lockfileVersion: 2`. Setting the field in place kept the
  resolved graph byte-identical, so the format moved without moving a single
  dependency.
- The portable Linux lane runs `bun audit` at full scope after installing
  dependencies, so a new advisory fails CI instead of only showing up in a
  local report.
- `bun run test:ci` runs typecheck, the unit suite, and both golden suites
  through `bun run --parallel`, leaving the timing-sensitive runtime smoke on
  its own leg. The gate finishes in about 25 s rather than about 50 s, and a
  failing leg still fails the gate.
- The release workflow proves on every run, not only on a manual dispatch, that
  the packed tarball came from a clean tree matching the release tag.

## 2026-08-16 — Effect 4.0.0-rc.109 pin, effect-kit retirement, and Windows shim hardening

- Pinned the Effect graph to `4.0.0-rc.109` for `effect`, `@effect/platform-bun`,
  and `@effect/vitest`, replacing `4.0.0-beta.107`. `vitest@4.1.10` is unchanged.
  A byte-level diff of the published tarballs showed every declaration this CLI
  imports is identical between the two releases, including all of
  `effect/unstable/cli`, so the bump is a pin with no call-site change.
- Removed the `effect-kit@docks` plugin from all three SoT configs. Sync now
  withdraws the kit's enablement on already-synced machines: the curated Claude
  removed manifest prunes the `enabledPlugins` key and the Codex config merge
  strips the retired `[plugins."effect-kit@docks"]` table. The plugin package
  itself is left to `--prune`, which the mutation goldens now record.
- Removed `effect-solutions` as a managed tool, and with it the verified-version
  install gate it was the last consumer of. `toolchain.ts` lost `ensure`, `gate`,
  `latestVersion`, and `promptLine`; `deps.ts` lost `resolveLocation`, the
  `DependencyLocation` type, and the `locate`/`latest` spec fields;
  `DependencyManager` narrowed to `spec`, `probe`, `version`, `path`, and
  `warnMissing`. `toolchain ensure` accepts only `bun`, whose `present` policy
  never upgraded and so never consulted the gate. `docks-kit toolchain check`
  still prints the doctor table against the manifest floors. Sync withdraws the
  kit's own `~/.local/bin/effect-solutions` symlink on already-synced machines
  but never touches the package: operators who also want the CLI gone should run
  `bun remove -g effect-solutions` themselves.
- Removed the public `--yes` flag and its `ASSUME_YES` environment seed from
  `sync` and `toolchain`. It existed only to auto-accept the above-verified
  prompt, which no longer exists. `--verbose` / `-v` is unaffected.
- Restored the `--verbose` no-op confirmation for `toolchain ensure bun`. It was
  only ever emitted by the removed gate, so deleting the gate left the flag
  documented but silent on the one managed tool; the bootstrap now reports
  `bun up to date (<version>)` when Bun is already installed.
- Hardened the Windows command-shim invocation. A `.cmd` or `.bat` tool now runs
  through the command interpreter with `/d /v:off /s /c` and the
  cross-spawn-proven caret and backslash escaping, delayed expansion off, and
  the npm shim double-escape case. A value carrying `%`, CR, or LF is refused
  with the reason instead of being mis-parsed, because no quoting neutralizes
  those on a `cmd` command line. The interpreter is always an absolute path -
  `ComSpec` when it is absolute, otherwise rebuilt under `SystemRoot` - and a
  tool the host cannot resolve is now reported as missing rather than spawned
  by bare name, because `CreateProcess` searches the parent's current directory
  before the system one. Every `update` child spawns through one helper, so the
  verbatim-arguments flag can no longer be separated from the argv it encodes.
- Fixed five pre-existing test defects that were unrelated to the changes above.
  The global installer fixture inherited a real `BUN_INSTALL`, so `find_bun`
  resolved a developer's own Bun, skipped the pinned bootstrap, and ran
  `bun add -g` against the real global install; both fixtures now pin
  `BUN_INSTALL` inside the sandbox and resolve coreutils by real path, because
  macOS has no `/bin/mktemp`. The `toolchain check` cases spawn the real CLI and
  now carry an explicit timeout instead of relying on Vitest's 5s default, which
  they exceeded under full-suite parallel load.
  The mutation golden harness isolated Bun's package cache but not its runtime
  transpiler cache, which Bun writes into `$HOME/Library/Caches/bun` for sources
  over 50 KB; because the fake home is tree-diffed, those files keyed every
  golden to the current bytes of the generated SoT payload. The harness now
  redirects `BUN_RUNTIME_TRANSPILER_CACHE_PATH` out of the fake home as well.
  The golden snapshots are also host-dependent: the engine gates `bwrap` on a
  Linux host, so the committed Linux-recorded snapshots could never be verified
  or re-recorded from macOS. Every child the harness spawns — raw-engine and
  public-CLI alike — now preloads a test-only shim that pins the platform,
  which leaves production code with no way to spoof the host.

- Ran the Claude, Codex, and skills sync pipelines concurrently instead of one
  after another. Every EngineNative subprocess moved from a blocking
  `spawnSync` to an awaited `spawn`, and a bounded coordinator runs the three
  pipelines with a default cap of 3. Order inside each pipeline is unchanged and
  stays serial, because a tool's plugin commands re-read their own installed
  state between passes. Warm sync on the reference host fell from a 13.35 s
  median to 8.93 s, a 4.42 s (33.1%) reduction. Set
  `DOCKS_KIT_SYNC_CONCURRENCY=1` to force the previous serial order; the golden
  suites pin it so recorded command order stays deterministic.
- Added one run-scoped terminal lease so a concurrent pipeline can no longer
  overprint the bubblewrap installer's sudo password prompt or steal input from
  a toolchain upgrade prompt. Durable output is buffered while the terminal is
  held and flushed afterward, and errors still print immediately.

- Removed every Session Relay feature surface: the managed-release installer,
  the status readiness probe, the `session-relay` toolchain entry, and the
  `session-relay@docks` enablement in all three SoT configs. Sync now withdraws
  the kit's enablement on already-synced machines — the curated Claude removed
  manifest prunes the settings key and the stale `~/.local/bin/session-relay`
  command, and the Codex config merge strips retired kit-owned
  `[plugins."<id>"]` tables. Plugin packages are left to `--prune`.

- Removed the Docks workflow model registry, prompt records, root override flags,
  and `models workflow` selector. Plan orchestration now owns reviewer selection
  at invocation time while ordinary Claude/Codex model and sync behavior remains
  unchanged.
- Added matching global prompt guidance for reuse-first selective skill routing,
  Base UI-backed shadcn defaults, and literal external authority; aligned the
  project plan contract and wrappers with the three-skill `PlanRunV1` workflow.

- Removed RTK end to end, including its managed toolchain entry, Claude sync
  install and initialization, `Bash(rtk *)` permission, and the whole
  `hooks.PreToolUse` family. Added both Claude artifacts to the curated removed
  manifest, so the next sync prunes them from already-synced machines. This
  removed sync's only unconditional GitHub API call, an unauthenticated probe
  capped at 60 requests per hour per address.
- Renamed `--skip-rtk` to `--skip-bubblewrap` and `SKIP_RTK` to
  `SKIP_BUBBLEWRAP`. Rejected the old flag with exit status 2 and a rename hint,
  dropped the older `--no-rtk` hint, and left the Codex bubblewrap bootstrap as
  the only remaining reader.
- Removed agent-browser and its chrome-for-testing companion, and narrowed
  `toolchain ensure` to `bun` and `effect-solutions`. This eliminated the
  roughly 175 MB Chrome for Testing download on first install. Existing
  behavior remained unchanged because the install required a line that the
  universal skill manifest never carried.
- Scoped the Claude plugin refresh to kit-owned plugins and marketplaces. Kept
  automatic refresh enabled by default and left `--skip-plugin-refresh`
  unchanged, while refreshing each declared marketplace by name and only
  declared plugins at user scope instead of every installed plugin, including
  project-scope plugins the kit never installed.
- Added version probes for `bwrap`, `ffplay`, and
  `typescript-language-server`, and read `intelephense` from one memoized
  `npm ls -g --depth=0 --json` listing because its own `--version` prints
  minified source. Those four tools had previously reported no version.
- Added an evaluable floor to every tool that sync installs, removed the retired
  manifest entries, and updated the pinned skills CLI to 1.5.22. This let
  `docks-kit toolchain check` report a real `below-floor` status instead of an
  unevaluable blank.
- Added a transient sync progress line so long plugin and marketplace work
  reports motion instead of showing nothing for about 13 seconds and then
  printing every line at once. Limited the line to interactive terminals, so
  logs and captured output remain unchanged.
- Made `docks-kit update` report `Already at the latest version` for a global
  package install that is already current and skip the chained sync, matching
  the git checkout path.
- Reduced steady-state sync on the reference host from 18.1 seconds to
  13.2 seconds.

## 2026-08-15 — Native Windows support and three-OS release lane

- Added Windows x64/arm64 as supported hosts. Releases now publish six binaries
  plus `SHA256SUMS`.
- Centralized host facts in the `os/` seam. Added the `docks-kit.ps1` launcher
  and `install.ps1` installer twins.
- Mirrored the Claude `PowerShell(...)` permission rules beside the existing
  Bash rules. Added the Codex `[windows]` sandbox configuration.
- Replaced shell-bound test execution with a shell-free harness. Added a
  portable CI lane on Ubuntu, macOS, and Windows.

## 2026-07-22 — exact latest Opus workflow fallback (0.10.1 source)

- Pinned the `claude-best` workflow fallback to Anthropic's current
  `claude-opus-4-8` model ID. This avoids task runtimes resolving the bare
  `opus` family alias to the invalid `claude-opus-4-0` catalog entry.

## 2026-07-20 — Linux/macOS-only support cutover (0.10.0 source)

- Removed Windows launcher, EngineNative, PowerShell, dependency-install,
  symlink, binary-build, and positive test paths. Unsupported hosts now fail
  before compiled-binary selection, Bun fallback, downloads, or sync work.
- Reduced standalone release output to Linux x64/arm64 and macOS x64/arm64 plus
  `SHA256SUMS`; removed the Windows entrypoint workflow and Windows parity jobs.
- Declared the npm package and current installation/runtime documentation as
  Linux/macOS-only. Historical release evidence remains unchanged.

## 2026-07-17 — Session Relay CLI installation boundary (0.9.0 source)

- Added a source-pinned prebuilt Session Relay `0.12.0` installer for Linux and
  macOS on x64/arm64. Claude and Codex sync run it immediately before plugin
  reconciliation; agents-only sync does not enter the installer boundary.
- The installer requires the committed target digest, same-release
  `SHA256SUMS` row, and downloaded bytes to agree before it marks the staged
  command executable, verifies its exact version, and atomically replaces
  `~/.local/bin/session-relay`. Failed fresh installs and upgrades preserve the
  prior stable command.
- This `0.9.0` source remains blocked from publication: the four committed
  digests are deterministic test-fixture pins until the corresponding
  `session-relay--v0.12.0` production assets are independently hashed.

## 2026-07-10 — Claude statusline and hooks move to native Bun runtime

- Replaced the deployed `statusline.sh`, `fetch-usage.sh`, and `hooks/notify.sh`
  with dependency-free `statusline.mjs`, `session-start.mjs`, and `notify.mjs`
  materialized under `~/.claude/bin/` from the embedded payload. SessionStart
  and Notification direct-exec absolute Bun; the shell-evaluated statusline uses
  a guarded POSIX or encoded-PowerShell command.
- Preserved the existing single-line layout and palette while moving 5h/7d
  quotas to Claude's native `rate_limits`. The Stop fetch hook, OAuth credential
  reads, quota request, and shared usage/token caches are gone; unsupported or
  pre-first-response sessions omit only the quota segment.
- Made Bun bootstrap a shared, per-run memo used by Claude runtime and
  effect-solutions. If Bun cannot be installed, sync keeps legacy hook/statusline
  settings and files intact and reports a deferred migration; successful
  cutover prunes those kit-owned legacy artifacts only after settings commit.
- jq and curl are now optional toolchain check rows instead of preflight hard
  dependencies. curl is consulted only at requested POSIX RTK/Bun download
  boundaries. Old `/tmp/.claude_usage_cache`, `/tmp/.claude_token_cache`, and
  `/tmp/.claude_usage_fetching` files are deliberately not unlinked: nothing
  reads them now, and OS temp cleanup can age them out without touching global,
  potentially shared or symlinked paths.

## 2026-07-09 — log UX overhaul: quiet no-ops, `--verbose`, install hints, service seams

Sync output now follows an explicit Output Policy (`cli/src/engine-native/DESIGN.md`):

- **Quiet on no-ops**: operations detect changed vs unchanged; unchanged outcomes ("already in sync", "up to date", "left as-is") are hidden by default. `--verbose` / `-v` (on `sync`, `model`, `toolchain`; `DOCKS_KIT_VERBOSE=1` on the raw channel) prints them. Real changes, warnings, and errors stay always-visible on stderr; dry-run reports, summaries, and `--json` output stay unfiltered on stdout.
- **`.bak` files are written only when a file is actually replaced**, not on every run.
- **Missing tools warn once, with the fix**: tools routed through the dependency registry (`cli/src/engine-native/deps.ts` — git, jq, curl, npm, npx, …) warn exactly once per run in the uniform `[warn] <tool> not installed — <platform-correct install command>` shape. The claude/codex CLI checks keep their richer contextual warnings.
- **Service seams (SOLID)**: a Logger with injectable sinks (`logger.ts`), a DependencyManager registry (`deps.ts`), and a Platform capability seam (`os.ts` — the single `process.platform` reader) are exposed through Effect `Context.Tag`s + live/test Layers (`cli/src/services.ts`), composed once at `main.ts`.
- Test harness now captures stdout/stderr separately and enforces the channel contract; goldens gained same-HOME replay, verbose-leg, and missing-git cases (21 dry-run + 47 mutation cases).

## 2026-07-08 — docks-kit CLI: typed front-end, tool-scoped flags, toolchain floors (sync.sh removed)

The kit's entry point is now **`./docks-kit`** — an Effect-TS CLI (Bun; effect 3.21.4 + @effect/cli 0.75.2 — v3 stable because @effect/cli has no Effect-v4-beta-compatible release) over the unchanged bash engine. `sync.sh` is **deleted** (clean break); the zero-dependency escape hatch is `bash lib/engine.sh <same args>`. All mutation still lives in `lib/*.sh`; the CLI adds typed flags, an interactive model picker, `--json` outputs, shell completions/wizard, and 9 bundled self-documentation topics (`docks-kit docs`).

**Flag taxonomy (breaking — old flags exit 2 with a rename hint, no compat behavior):**

| Old | New |
|-----|-----|
| `--claude` / `--codex` / `--agents` | positional targets: `docks-kit sync claude codex agents` |
| `--force` | `--reconcile` |
| `--remove-plugins` | `--prune` |
| `--680k` | `--claude-compact-window=<tokens>` (any value: `680k`/`680000`) |
| `--permissive` | `--claude-permissive` |
| `--supabase` / `--n8n` | `--claude-plugin=<name>` (repeatable; unknown names exit 2) |
| `--no-rtk` | `--skip-rtk` |
| (new) | `--claude-model=<m>`, `--codex-model=<m>`, `--yes` |

**New model layer:** `SoT/models.json` (kit-verified catalog) drives validation (fail-fast, pre-mutation; codex charset gate blocks TOML-quote injection), `docks-kit models`, the TTY picker, and the bare-flag helper. `--claude-model=` / `--codex-model=` are deploy-time modifiers (deployed config only; flag-less sync reverts); `docks-kit model <tool> [value]` is the standalone get/set over the same engine functions (`claude::sync_model`, `codex::sync_model`; `default` deletes the deployed key). `codex::_replace_top_level_setting` was extracted from `merge_top_level_settings` (deployed-config output verified byte-identical) and shared with the codex modifier. `claude::sync_680k` → `claude::sync_compact_window`.

**New toolchain layer:** `SoT/toolchain.json` (kind/policy/floor/verified/pinnable) + `lib/toolchain.sh` (present/version/compare/gate/ensure/report). Installs/upgrades above the kit-verified pin prompt on a TTY, `--yes` auto-accepts, non-TTY declines fall back to the pinned verified version when pinnable (RTK supports `RTK_VERSION=vX.Y.Z`, verified upstream). Fixes two standing defects: **effect-solutions never self-upgraded** (now `track` policy, like agent-browser — verified live, unknown→0.5.3), and **`rtk init --global` on a fresh machine clobbered deploy-time modifiers** (rtk now runs FIRST in `claude::sync`, so the settings merge normalizes its rewrite; `claude::_rtk_reassert_hook` and `claude::_warn_rtk_outdated` deleted as superseded). New doctor coverage: `docks-kit toolchain check` / `docks-kit status` (ffplay, bwrap, LSP binaries, claude floor).

**Packaging:** root `package.json` (npm name `docks-kit`, confirmed available) bundles `cli/` + `lib/` + `SoT/` — releases are versioned config snapshots. `cli/build-binaries.sh` compiles five standalone binaries (docs embedded; linux-x64 verified); `.github/workflows/release-cli.yml` (repo's first workflow) attaches them + SHA256SUMS on `cli-v*` tags and npm-publishes when `NPM_TOKEN` exists. `install.sh` = download-then-run global install (Bun bootstrap + `bun add -g docks-kit`). New root `README.md`.

Verified: dry-run step-list parity old-vs-new byte-identical; `bunx tsc --noEmit` clean; model round-trips (set → revert-on-sync → `default` deletes key) on live configs; all toolchain gate branches unit-tested; node_modules self-heal; `bun link` global smoke from outside the repo. Docs/skills/agents swept for the rename (tracked in `docs/plans/active/docks-kit-cli.md`).

## 2026-06-08 — Re-assert SoT plugin enabled-state after install (pass 7)

`claude plugin install` installs at its default `--scope user` and **enables** what it installs — writing `"<id>": true` into `~/.claude/settings.json`. The kit's plugin bootstrap (pass 2, `claude::_plugins_install`) deliberately installs `false`-keyed plugins too ("globally disabled, per-project enable has something to load"), so on a fresh machine the install flipped every `false`-keyed third-party plugin back to **enabled** — clobbering the `false` `claude::sync_settings` had written one step earlier (settings sync is `claude::sync` step 4; plugins step 8). Observed in a Claude-Code-on-the-web sandbox: `n8n-mcp-skills@n8n-mcp-skills` shipped `true` in `~/.claude/settings.json` despite SoT declaring `false`, while `supabase@claude-plugins-official` (built-in marketplace, different install path) correctly stayed `false`. The single plugin that got an actual `claude plugin install` was the only one flipped.

Fix: added a 7th plugin pass, `claude::_plugins_reassert_enabled_state`, that runs **unconditionally** at the end of `claude::sync_plugins` and rewrites `enabledPlugins` so SoT-declared values win (`(.enabledPlugins // {}) * $sot`) while preserving user-only entries — the same SoT-wins invariant `claude::_settings_merge` already enforces, re-applied after the plugin CLI mutated the file. A full second `./sync.sh` would self-heal (pass 2 skips already-installed plugins, so the merge's `false` survives), but single-sync and ephemeral environments never get that second run — pass 7 makes the first run correct and deterministic. Built-in `claude-plugins-official` plugins are unaffected (they don't take the marketplace install path). Verified: the jq filter against the live sandbox settings yields `n8n=false`, `supabase=false`, `docks=true`, output byte-identical to SoT; `bash -n lib/claude.sh` clean. Updated the `plugin-bootstrap-context` skill (six-pass → seven-pass, new constraint + Pass 7 walkthrough, `references/seven-pass-flow.md`) and the `CLAUDE.md` plugin-pass table.

## 2026-06-08 — Drop the rsync dependency (portable cp for hook sync)

`claude::sync_hooks` used `rsync -a`, which isn't coreutils and is absent on minimal images — the Claude-Code-on-the-web **Ubuntu 24.04 sandbox has no `rsync`**, so a remote setup script running `./sync.sh` failed with **exit 127** at that line. Replaced with portable `cp -R "$SRC/." "$DST/"` (additive, same as rsync without `--delete`; the following `chmod +x` re-sets the exec bit), so the kit needs no external tool. Updated the living-doc "rsync has no --delete" mentions to "cp -R never deletes". Validated with `rsync` absent from PATH: hooks deploy + are executable, idempotent, dry-run safe.

Remote note: installing it in a web-env setup script also works (`apt-get install -y rsync` — setup scripts run as root on Ubuntu 24.04 and the Trusted network reaches the Ubuntu mirrors), but this fix removes the need.

## 2026-06-08 — Prune stale kit env vars via the `removed` manifest

Added four env vars the kit no longer sets to `claude::_removed_manifest` `settingsKeys`, so drift from older kit versions is cleaned from the kit-managed `settings.json` on sync: `CLAUDE_CODE_SUBAGENT_MODEL` (kit now uses per-agent frontmatter), `ANTHROPIC_DEFAULT_OPUS_MODEL` (de-pinned), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (superseded by `CLAUDE_CODE_AUTO_COMPACT_WINDOW`), `CLAUDE_CODE_DISABLE_1M_CONTEXT` (1M now enabled).

Policy made consistent: these are pruned from the kit-managed `settings.json`; a deliberate per-machine override goes in **`settings.local.json`**, which sync never touches (the kit already uses that hatch for `ANTHROPIC_DEFAULT_OPUS_MODEL`). Updated the manifest comment, the "Pruning stale artifacts" section, and the Troubleshooting `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` bullet (now points at `settings.local.json`) so the kit no longer contradicts itself.

Validated: nested `env.X` `delpaths` prune (5 keys), with the kit's active `CLAUDE_CODE_EFFORT_LEVEL`, a user custom env var, theme, and permissions all preserved; JSON valid; idempotent.

## 2026-06-08 — Add a `removed` manifest so sync prunes stale kit artifacts

Default sync is additive (the jq merge keeps user-only keys; `rsync` has no `--delete`), so anything the kit *stops* shipping lingered forever on already-synced machines. New mechanism to clean that up:

- **lib/claude.sh**: `claude::_removed_manifest` (declarative) + `claude::sync_removals` (+ `claude::_prune_json_keys` helper), wired into `claude::sync`. Categories: `hooks` (scripts under `~/.claude/hooks/`), `files` (other `~/.claude/` paths), `settingsKeys` (jq `delpaths` from `~/.claude/settings.json`), `claudeJsonKeys` (same for `~/.claude.json`). Idempotent (`rm -f`; `delpaths` ignores absent paths), honors `--dry-run`, bash-3.2-safe. A **narrow, deliberate exception** to "additive by default" — lists only unambiguous kit-owned artifacts, never user-tunable keys.
- **Initial manifest**: the dead `disable-claudeai-connectors.sh` hook (cleans the leftover the previous two commits couldn't, since `rsync` has no `--delete`) + `showTurnDuration` (must not live in `settings.json` — schema warning; sync writes it to `~/.claude.json`).
- **Docs**: CLAUDE.md § "Pruning stale artifacts"; AGENTS.md additive-by-default rule notes the exception. Also fixed a stale `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` → `300000` in the Troubleshooting section (drift from the earlier context-rot retune).

Validated: syntax, hook deletion, settings-key prune with non-target keys preserved + JSON still valid, idempotent silent re-run, dry-run no-write, and the `sync.sh --claude --dry-run` wire-in.

## 2026-06-08 — Remove the non-functional claude.ai connector hook

Deleted `SoT/.claude/hooks/disable-claudeai-connectors.sh` and its SessionStart entry in `settings.json`. It patched `disabledMcpServers`, which gates only `.mcp.json`/`claude mcp add` servers — never claude.ai cloud connectors — so it did nothing. The working replacement (`ENABLE_CLAUDEAI_MCP_SERVERS=false` shell export via `claude::sync_connector_env`) shipped in the entry below. CLAUDE.md (Hooks bullet, repo-structure table, Open Concern) updated to past tense.

Note: `sync.sh` rsyncs hooks without `--delete`, so a previously-synced `~/.claude/hooks/disable-claudeai-connectors.sh` lingers harmlessly (now unreferenced) until manually removed; any stale `claude.ai *` names it wrote to `~/.claude.json` `disabledMcpServers` are likewise inert.

## 2026-06-08 — Automate the real claude.ai connector disable (sync.sh)

Deeper research (prompted by "the disables don't work") found the `disable-claudeai-connectors.sh` hook is **non-functional**: it patches `disabledMcpServers`, which gates only `.mcp.json`/`claude mcp add` servers — claude.ai cloud connectors are fetched from the account at startup and consult no local config. The actual fix is `ENABLE_CLAUDEAI_MCP_SERVERS=false` as a **shell** env var (the official method); it's inert only in the settings.json `env` block, which the kit had conflated with "broken".

- **lib/claude.sh**: new `claude::sync_connector_env` (wired into `claude::sync`) idempotently appends `export ENABLE_CLAUDEAI_MCP_SERVERS=false` to the user's shell rc (`~/.zshrc` for zsh, `~/.bashrc` for bash, `~/.profile` otherwise), multi-platform and bash-3.2-safe. Verifies-if-present across common rc files before adding; never clobbers an existing value (set `=true` to keep connectors). Surgical — disables only claude.ai connectors (MCP source #5); plugin/project/user servers (supabase, n8n, `.mcp.json`) are untouched. Respects `--dry-run`. Validated: syntax, idempotency, dry-run no-write, non-clobber, and the `sync.sh --claude --dry-run` wire-in.
- **CLAUDE.md**: corrected the Hooks bullet and the Open Concern — the env-var shell export is the working fix; the `disabledMcpServers` hook is documented as non-functional and slated for removal; `--strict-mcp-config` recorded as the all-or-nothing fallback.

Hook deletion (script + SessionStart entry) deferred until the env-var fix is confirmed clearing `/mcp` on a real account.

## 2026-06-08 — Broaden the claude.ai connector blocklist

`disable-claudeai-connectors.sh`: expanded `CONNECTORS` from 4 to 25 common claude.ai connectors — added **Figma** (the one that was still auto-loading because it was missing from the list) plus Atlassian, Box, Canva, ClickUp, Cloudflare, Dropbox, Excalidraw, HubSpot, Intercom, Linear, Microsoft Learn, Notion, PayPal, Sentry, Slack, Socket, Square, Stripe, Vercel, Zapier, on top of the existing Asana/Gmail/Google Calendar/Google Drive.

Why the hook is still the mechanism: claude.ai account connectors OAuth-sync into every Claude Code session and load their tool defs into context even when unused (~100K tokens of bloat per anthropics/claude-code#50062). There is still **no clean global settings.json toggle** — `ENABLE_CLAUDEAI_MCP_SERVERS` is Statsig-gated and inert, `allowAllClaudeAiMcps` is managed-only, and `disabledCloudMcpServers` (seen in some search results) is **not a real key**. Patching per-project `disabledMcpServers` remains the only user-level path that survives auth-sync. Unknown names are harmless no-ops, so the list errs toward off; delete a line to keep a connector. Verified end-to-end (bash -n + jq merge + dedup) against a throwaway HOME.

## 2026-06-08 — Context-rot optimization (Opus 4.8)

Follow-up deep-research pass (parallel research agents + primary Anthropic docs + the Chroma "Context Rot" report) on whether the context/output settings are optimal for Opus 4.8. Both agents converged independently.

### settings.json

- **Compact earlier**: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 400000 → 300000. The old ~380K autocompact trigger generated the compaction *summary* at a heavily-degraded context and rode to 95% of a 1M window. 300K fires the safety-net (~285K) earlier so the summary is produced while the model is sharper. Context rot is **gradual, not a cliff** (~2% effectiveness loss per 100K; Claude decays slowest of the models Chroma tested), so an even-tighter 250K buys only ~1% less rot than 300K — not worth the extra lossy compactions, especially as Opus 4.8 is tuned for "fewer compactions, better recovery." 1M stays enabled as headroom. (Briefly set to 250000, then revised up to 300000 after curve-shape research showed the rot difference is negligible.)
- **Right-size output reservation**: `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 96000 → 64000. Anthropic's Opus 4.8 effort guide recommends a 64K starting point, and the env-vars doc confirms a higher cap *shrinks the effective input context before auto-compaction*. The earlier 96K bump was justified by "synthesis subagents truncating," but subagents are hard-capped at 32K regardless of this main-thread value — so it never helped them.

### Docs (CLAUDE.md)

- Rewrote the `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_CODE_MAX_OUTPUT_TOKENS` rows with the context-rot rationale and sources.
- Updated the "centerpiece strategy" line (250K window, xhigh effort, 1M-as-headroom framing; also fixed a stale "max effort" → "xhigh").

### Validated, kept as-is

- `CLAUDE_CODE_EFFORT_LEVEL=xhigh` — exactly Anthropic's recommended default for Opus 4.8 agentic coding (`max` risks overthinking).
- 1M context enabled — rot tracks tokens *used*, not window size; disabling it would only force more lossy compactions.
- `minimumVersion`, the `xargs` dedup, and the `PostToolUseFailure` hook event all re-verified correct.

Primary sources: Anthropic Context windows / Compaction / Effort / What's-new-4.8 docs; Chroma "Context Rot" (2025); NoLiMa; Lost in the Middle.

## 2026-06-08 — Opus 4.8 settings refresh

Audit of `SoT/.claude/` against the current Claude Code settings schema and Opus 4.8 behavior.

### settings.json

- **Version floor**: added `minimumVersion: "2.1.166"` — floors auto-updates and `claude update` so every synced machine carries the features the kit relies on (Opus 4.8 needs 2.1.154, `skillListingBudgetFraction` needs 2.1.129) plus the latest auto-mode/classifier hardening.
- **Permissions dedup**: removed the inert `Bash(xargs *)` from `permissions.allow` — it was already in `permissions.ask`, and precedence (deny > ask > allow) made the `allow` copy dead. Zero behavior change; xargs still routes through `ask`.

### Docs (CLAUDE.md)

- Corrected the `CLAUDE_CODE_MAX_OUTPUT_TOKENS` row: documented `64000` → actual `96000` (Opus 4.8's real output ceiling is 128K).
- Added env-table coverage for `CLAUDE_CODE_FORK_SUBAGENT` and a top-level-keys row for `minimumVersion`.
- Documented `autoMode.environment` as a per-machine (`settings.local.json`) lever for cutting auto-mode false positives.
- Recorded the deliberate **no-`fallbackModel`** decision (stay Opus-only; avoid mid-session prompt-cache cold-start).

### Considered, not adopted

- **`fallbackModel`** (v2.1.166): rejected — a mid-session Opus→Sonnet switch cold-starts the per-model prompt cache; the kit prefers a retried turn over a silent model swap.
- **`skillOverrides`** (v2.1.129): does not affect plugin skills (where the kit's effect-kit/docks duplication lives) and is buggy upstream (anthropics/claude-code#50631, #54996).
- **`attribution`**: the kit intentionally keeps the model-versioned `Co-Authored-By` trailer.

## Superseded snapshot (Opus 4.6 era) — Token-efficient configuration overhaul

> Historical record. Entries below predate the current kit: `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=45` is now `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, effort is `xhigh` (not `high`), `CLAUDE_CODE_SUBAGENT_MODEL` is no longer set, and the command/score scripts have moved to the `docks` plugin.

Re-evaluation of the entire kit for token efficiency while preserving multi-agent pipeline quality.

### settings.json

- **Enable 1M context**: removed `CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. 1M is now active by default on Max/Team/Enterprise plans for Opus 4.6.
- **Early auto-compact**: added `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=45`. Compacts at ~450K tokens on a 1M window, well before the ~400K context-rot threshold.
- **Effort level aligned**: `CLAUDE_CODE_EFFORT_LEVEL` changed from `max` to `high`. Saves significant tokens without sacrificing reasoning quality. Matches the top-level `effortLevel: "high"` setting.
- **Subagent model fully qualified**: `CLAUDE_CODE_SUBAGENT_MODEL` changed from `"sonnet"` to `"claude-sonnet-4-6"` to avoid alias-resolution risk.
- **Removed `showTurnDuration`** from settings.json (belongs in `~/.claude.json`, caused schema validation warnings). `sync.sh` writes it to the correct location.
- **SubagentStop hook**: now allows "no issues found" and mode-selection responses through the file:line quality gate.
- **SessionStart hook**: injects active config (context window, auto-compact %, effort level, thinking budget, subagent model) for visibility at session open.

### Commands (all 9)

- Stripped all inert `model="opus"` XML annotations from `<task>` blocks. These were text-only and had no programmatic effect on subagent routing — `CLAUDE_CODE_SUBAGENT_MODEL` is the actual control.
- Updated Model Tiering note in every command: all subagents use sonnet; orchestrator runs on Opus.
- Added `WebFetch`, `WebSearch` to Allowed Tools of `review.md`, `solid.md`, `test.md`, `fix.md`, `human-docs.md`, `docs.md`, `team.md`, `refactor.md`, and `security.md` (commands that instruct context7/WebFetch research).
- Added `Bash(rtk:*)` to every command's Allowed Tools and "Use ONLY" lines (the RTK PreToolUse hook rewrites bash commands to `rtk <cmd>`).
- `security.md`: removed dangling "offer to help fix specific issues" — command is read-only by design; users should run `/fix` for remediation.

### Scripts

- `sync.sh` **new**: auto-detecting portable sync entrypoint. Merges `settings.json` with explicit array concat+unique for permissions, writes `showTurnDuration` to `~/.claude.json`, and bootstraps RTK if missing. Flags: `--dry-run`, `--no-rtk`, `--force`.
- `guard-commands.sh`: auto-detects script dir (no hardcoded `/home/docks/...` path). Added: Phase Transition Protocol required for commands with 3+ phases; WebFetch required if research is instructed.
- `score-commands.sh`: auto-detects script dir. Flipped `model="opus"` reward → penalty (2pts if absent). Added WebFetch/Allowed-Tools consistency check.
- `statusline.sh`: fixed misleading `Xk/200k` header comment to `Xk/Xk` (runtime already computed dynamically).
- `fetch-usage.sh`: added numeric-range (0-100) validation before writing cache to prevent silent garbage writes on API schema changes.

### Repo hygiene

- `.gitignore` expanded (macOS junk, editor temp files, `node_modules`, `settings.json.bak`).
- `CHANGELOG.md` added (this file).
- `.github/workflows/validate.yml` added — runs guard + score on every push and PR.
- Root `CLAUDE.md` extended with Environment Variables reference, Troubleshooting, and `sync.sh` usage.
