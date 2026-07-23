# Changelog

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
