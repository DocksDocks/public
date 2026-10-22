# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (via `@AGENTS.md` import in `CLAUDE.md`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

## Repository purpose

Portable configuration kit for AI coding agents. The kit manages three coding
harnesses: Claude Code, Codex, and Oh My Pi (`omp`). Per-tool Single Source of
Truth (SoT) directories deploy to each harness's user-config location through
`./docks-kit sync`. The kit also deploys shared [agentskills.io](https://agentskills.io)
skills. Clone once to get a consistent AI-assisted environment on supported
Linux, macOS, and Windows hosts. The kit focuses on **token efficiency without
sacrificing quality**. Every setting and hook minimizes token use while
preserving rigorous output. When you add or edit anything, ask: *does this
change reduce tokens without weakening correctness?*

Tool-specific instructions live alongside this file:
- **`CLAUDE.md`** — Claude Code SoT (`SoT/.claude/`), env vars, hooks, plugins, status line, session management, permission mode, open concerns.
- Codex uses this `AGENTS.md` file plus the Codex SoT under `SoT/.codex/`; no separate root `CODEX.md` is needed.
- omp uses this `AGENTS.md` file plus the omp SoT under `SoT/.omp/`.


docks-kit runtime and standalone binary support covers Linux x64/arm64, macOS
x64/arm64, and Windows x64/arm64. Hosts outside this matrix fail before either
launcher can fall back to Bun source.

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows CLI launchers. On supported hosts, each runs the matching binary in `cli/dist/` only when its `--version` matches `package.json`. Otherwise it runs Bun-from-source and auto-installs Bun plus `node_modules`, and the mismatch warning names the rebuild remedy. A launcher never deletes a binary: on a host without Bun it is the only remaining recovery path. Hosts outside the support matrix fail before source fallback. The standalone platform release binary provides no-Bun recovery. |
| `cli/build-binaries.sh` | Compiles the six release binaries. It checksums the six known artifact names rather than globbing `docks-kit-*`, so a packed `docks-kit-<version>.tgz` is never attested as a release binary. It stamps `cli/dist/VERSION` only when the directory holds one version, and on the next build discards every artifact that stamp attributes to a different version, because a launcher refuses to run one and keeping it makes `SHA256SUMS` span two versions. An artifact with no stamp has unknown provenance and may be a hand-built or downloaded recovery binary, so the script keeps it and warns; `--prune` discards those too. Nothing here removes an artifact the stamp vouches for. |
| `cli/src/engine-native/` | EngineNative implementation for `sync`, `model`, and `toolchain`; idempotent, flag-gated for destructive reconciliation |
| `cli/src/engine-native/ompSync.ts` | omp sync orchestration and summary |
| `cli/src/commands/omp.ts` | `docks-kit omp` session launcher: renders the free-model run overlay and forwards args to omp |
| `cli/src/engine-native/ompOverlay.ts` | Free-model overlay render plus catalog parse and thinking-ceiling helpers |
| `cli/src/engine-native/scratch.ts` / `cli/src/commands/scratch.ts` | `docks-kit scratch new\|remove`: private agent temporary directories under `~/.cache/docks-kit/scratch/`; removal accepts only a real path strictly inside the scratch root, the system temporary directory, or `/var/tmp` |
| `cli/src/engine-native/tidy.ts` / `tidyReport.ts` / `cli/src/commands/tidy.ts` | `docks-kit tidy [--apply] [--repo <path>] [--report]`: plan and apply the safe leftover sweep (merged idle worktrees and their containers, orphaned processes in agent directories, idle scratch); Docker calls run only against a verified local endpoint (`unix:///…` or `npipe:////./pipe/…`); the report is read-only |
| `cli/src/engine-native/ompKitPlugin.ts` | Materializes the `SoT/.omp/plugin/` payload to `~/.docks-kit/omp-plugin` with the kit version; `ompPlugins.ts syncPlugins` links it |
| `cli/src/engine-native/<axis>.ts` | One change axis per file: `codexConfig`/`codexHooks`/`codexPlugins`/`codexStatus`, `claudeSettings`/`claudeRemovals`/`claudePluginPasses`/`claudeOptionalPlugins`/`claudeLsp`, `parseModifiers`/`parseHelp`, `ompFileDeploy`/`ompMarketplace`/`ompPlugins`, `skillsManifest`/`skillsLinks`/`skillsInstall`/`skillsPrune`, `engineCtx`/`syncConcurrency`/`syncDispatch`; orchestrators keep prior exports |
| `cli/src/engine-native/sharedTypes.d.ts` | Single definition per shared shape (manifest records, settings edits, omp session model, scalar modifier flags, resolved model catalog) |
| `cli/src/engine-native/kitDb.ts` | Only opener of the SQLite store `~/.docks-kit/kit.db`: append-only migrations, one-time `state.json` import, TTL cache |
| `cli/src/engine-native/liveModels.ts` | Live model list per enabled harness (Anthropic API via Claude Code login, Codex model cache, `omp models --json`) merged over `SoT/models.json` |
| `.oxlintrc.json` / `.oxfmtrc.json` | Mechanical lint (correctness, suspicious, eqeqeq, no-var, prefer-const, no-unused) and code format scope |
| `cli/test/fixtures/` | Golden fixtures: `home-fresh`, `home-drift`, `home-invalid-json`, `codex-toml`, `statusline` |
| `cli/` | Effect 4 RC CLI + bundled docs topics |
| `SoT/models.json` | Curated Claude and Codex model overlay: aliases and notes always apply; id rows are the fallback when a harness live list is unavailable |
| `SoT/toolchain.json` | Toolchain floors manifest (verified pins consumed by EngineNative; optional `upstream` source read by `docks-kit toolchain outdated`) |
| `SoT/.claude/bin/` | Dependency-free Bun runtime programs for Claude's statusline, SessionStart, and Notification |
| `SoT/.omp/` | Kit-owned omp SoT: `AGENTS.md`, `config.yml`, `models.yml`, `mcp.json`, and `intercom.json` |
| `install.sh` / `install.ps1` | POSIX and Windows global installers |
| `.github/workflows/release-cli.yml` | `cli-v*` release: six binaries for Linux, macOS, and Windows on x64 and arm64, plus `SHA256SUMS` and npm publish |
| `README.md` | Front door |
| `package.json` / `bun.lock` | npm package: `bin` = `cli/src/main.ts`; bundles `cli/` with the generated in-memory SoT payload |
| `SoT/.agents/skills.txt` | Universal-skill manifest, intentionally empty by default. Adding an [agentskills.io](https://agentskills.io/specification) slug opts it into EngineNative's shared `~/.agents/skills/` bootstrap and Claude symlink. |
| `notification.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/PLAN.md` | Plan record standard. The plan record is a GitHub issue; no plan markdown is tracked. `docs/AGENTS.md` routes to it and `docs/CLAUDE.md` contains only `@AGENTS.md`. |
| `CLAUDE.md` | Claude-specific instructions; imports this `AGENTS.md` |
| `AGENTS.md` | This file — tool-agnostic instructions |

Codex SoT notes:
- `SoT/.codex/AGENTS.md` deploys to `~/.codex/AGENTS.md` as global Codex instructions.
- `SoT/.codex/config.toml` pins Codex to `model = "gpt-6.1-sol"`, sets normal and plan reasoning to `high` with concise summaries, and sets `model_verbosity = "low"`, live top-level `web_search`, workspace-write sandboxing with sandboxed command network access, cross-session `memories` (+ dedicated note tools), `[agents]` subagent limits (`max_threads = 12`, `max_depth = 2` — intentionally above Codex defaults for broad parallel kit work; deeper recursion increases cost and predictability risk), a 128 KiB `project_doc_max_bytes` budget for the repo-side AGENTS.md chain (the global `~/.codex/AGENTS.md` is uncapped and not counted), and enables the two Docks plugins `docks@docks` and `plan-lifecycle@docks` (the shared plan lifecycle).
- `SoT/.codex/config.toml` does not set `personality`. Codex 0.159.0 deprecated the key, and `friendly` and `pragmatic` no longer select a style. `codexConfig.ts removeRetiredTopLevelSettings, retired top-level key prune` removes the retired `personality = "pragmatic"` line from a deployed `config.toml` on every sync. A different user-set value survives.
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved. Codex applies the strictest matching rule across all files, so a user allow rule cannot loosen a kit `forbidden` or `prompt` rule. Because the strictest rule wins, a narrow allow cannot carve an exception out of a broader prompt prefix, and a prefix rule cannot see an option after an operand. The guards therefore fail closed: every `rm`, `git rm`, `git worktree remove`, and `gio trash` prompts, and only macOS `trash` is allowed (owner decision). A `prompt` goes to `approvals_reviewer = "auto_review"`, a reviewer subagent, not always to a person. `docks.rules` carries the destructive-command guards (`docks-kit docs command-guards`); `cli/test/unit/codexSyncRules.test.ts` parses every one-line `prefix_rule`, alternatives lists and `justification` included, and asserts each guard's decision. Keep each rule on one line so that parser sees it.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`; when the `codex` CLI is available, sync reruns `codex plugin add <plugin@marketplace>` for enabled SoT plugins so stale cached installs are refreshed.
- Codex `/import` can copy Claude hooks into `~/.codex/hooks.json`. `codexHooks.ts removeRetiredImportedHooks, legacy SessionStart cleanup` removes only recognized hooks from retired docks-kit Claude settings, backs up a changed file, and preserves user-authored hooks. Codex `/import` (codex-rs external-agent-migration `hooks_cla.rs`) skips a handler with keys outside `type`/`command`/`timeout`/`timeoutSec`/`statusMessage`/`async`, and it skips `async: true` handlers. Thus it imports neither the kit's exec-form (`args`) SessionStart handler nor its async Notification handler.
- Codex limits the initial skill list to 2% of the model context and shortens descriptions first; it still reads a selected skill's full `SKILL.md`. Additive sync preserves user-added plugins, so their skill count and malformed cached `SKILL.md` files remain plugin-owned. Sync never patches a plugin cache in place.
- The global prompt SoTs carry the owner's standing authorization for Docks cross-company plan review, which never overrides host or platform denial.
- The `codex` CLI binary is upstream-owned, not kit-owned. The official standalone installer keeps package metadata under `$CODEX_HOME/packages/standalone` and places the `codex` symlink in `~/.local/bin` by default; sync only warns with a download-then-run installer command when the CLI is missing. Existing installs can self-update with `codex update`; npm and Homebrew remain upstream alternatives.

- Claude runtime settings are an authoring template with sentinels. `claudeRuntime.ts` materializes absolute Bun/script paths only after the shared `bun.ts` bootstrap is ready; `claudeSync.ts` writes all runtime assets before atomically committing settings, then prunes the legacy shell scripts and Stop hook. Native `rate_limits` is the sole quota source, so jq/curl/OAuth caches are not runtime dependencies. A missing Bun defers only this cutover and preserves legacy pointers/files.
- Claude's deployed SoT defaults are `model: opus` and `effortLevel: high`; `advisorModel` is deliberately absent/off. `--claude-advisor=on` is the per-machine opt-in and writes `advisorModel: opus` after the settings merge. `opus` is the alias, not a pinned id: the `minimumVersion` floor of 2.1.280 makes Claude Code resolve it to Opus 5.5, the default Opus from that release, instead of capping at Opus 5 under the former 2.1.219 floor. Keeping the alias tracks the next Opus release without a kit change and stays portable across providers. The floor also subsumes Fable 5.1's 2.1.257 requirement.
- Claude permission rules are pruned, not host-scoped. The kit deploys its `PowerShell(...)` deny and ask rules on every host, because Claude Code leaves the PowerShell tool opt-in off Windows rather than unavailable, and a host that enables it must already carry the guards. `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` lists the rules the kit no longer ships. `claudeRemovals.ts syncRemovals, retired-permission pass` force-prunes those exact strings from the kit-managed `~/.claude/settings.json` on every sync, because `settings.ts mergeSettings, permission-array union` would otherwise keep a dropped rule forever. A different user-authored rule survives. To restore an exact retired rule for one checkout, put it in that checkout's `.claude/settings.local.json`. Claude Code resolves that file against the working directory and merges it over user settings. Sync never reads or writes the checkout-local file. Claude Code has no user-scope local settings file. For a machine-wide restoration, add the rule to `SoT/.claude/settings.json`. At the same time, remove the exact string from `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory`. `permissions.allow` holds four read-only entries (`Read`, `Glob`, `Grep`, and `WebSearch`) plus the working-directory edit rule `Edit(./)`. Broad shell allow rules are not restored, because an allow rule resolves before Claude Code's read-only command analyzer and the auto-mode classifier. `autoMemoryEnabled` and `autoDreamEnabled` are both `false`.

omp SoT notes:
- `SoT/.omp/AGENTS.md`, `config.yml`, `models.yml`, and `mcp.json` deploy to `~/.omp/agent/`.
- `SoT/.omp/intercom.json` deploys to `$PI_CODING_AGENT_DIR/intercom/config.json`. The default root is `~/.pi/agent`. Under a named omp profile (`OMP_PROFILE` or `PI_PROFILE`), it deploys to `<profile agentDir>/intercom/config.json`, because omp exports `PI_CODING_AGENT_DIR` as the profile agent directory.
- `ompFileDeploy.ts syncMergedYaml` deep-merges `config.yml` through `ompYaml.ts mergeOmpConfig` and `models.yml` through `mergeOmpModels`. Both wrap one generic mapping merge; only the config wrapper prunes stale `retry.fallbackChains` wildcards and merges `bash.patterns`.
- `SoT/.omp/config.yml` `bash.patterns` holds the destructive-command guards. omp's `CRITICAL_BASH_PATTERNS` check returns a bare safety override before a matching prompt rule, and `tools.approvalMode: yolo` ignores a bare override, so a prompt on a critical command becomes an allow, in subagents too (`omp://approval-mode.md`). Every `rm` shape that check can flag is therefore a deny: recursive `rm`, `sudo` anywhere before `rm` (also by path), any `rm` with an `r` or `f` option before an absolute path, and `--no-preserve-root`. By owner decision (0.20.9), the recursive-`rm` deny also covers any prefix (a `* rm ` copy of each bare cluster rule, so `env X=1 rm -rf b`, `xargs rm -rf`, `find . -exec rm -rf {} +`, and `git rm -r dir` are denied) and the `-ri`, `-ir`, `-Ri`, and `-iR` clusters for bare `rm`, `*/rm`, and `* rm`. By owner decision (0.21.0), 17 more denies cover bulk removal that can empty the home directory: `find -delete` (bare, `*/find`, `* find`), `-exec`, `-execdir`, `-ok`, and `-okdir` with `rm` or `*/rm`, and `xargs rm` in six shapes. No glob can express "inside the temporary directory", so `docks-kit scratch remove` checks that path in code. By the 0.20.9 decision, omp does not prompt for other file removal: a non-denied `rm`, `git rm`, `git worktree remove`, `gio trash`, and `docks-kit scratch remove` run without a prompt. The prompts left are the history-loss commands: `git clean`, `git reset --hard`, and every `git push` form that could force. The list order is deny, then prompts, then `trash *`. omp takes the first match. `ompYaml.ts mergeBashPatterns, exception-aware rule merge` keeps user rules and groups all rules as kit deny, user deny, user prompt, kit exception (a kit allow listed before the first kit prompt; the kit currently ships none), kit prompt, other user rules, kit allow, so a user deny or prompt precedes every kit allow. It treats a deployed rule equal to a kit rule (approval case-folded, `match` whitespace collapsed) as the kit copy, so a re-sync is a no-op. A rule the kit stops shipping stays as a user rule, so retire one through `ompRemovals.ts OMP_RETIRED_BASH_RULES`. `cli/test/lib/ompBashPatterns.ts` ports omp 18.11.1's matcher, critical patterns, and yolo resolution; `cli/test/unit/ompBashPatterns.test.ts` asserts each command's final outcome and the merge. omp subagents reject every `prompt`, and the `eval` tool stays unrestricted by owner decision.
- `ompSync.ts` runs `ompRemovals.ts syncOmpRemovals, retired-key inventory` right after the config merge, and that pass force-prunes retired kit-owned keys from `~/.omp/agent/config.yml` on every sync, without `--reconcile`. The pass is required because `mergeOmpConfig` is additive, so removing a key from the SoT alone never removes it from a deployed file. A key retired with a recorded value is pruned only while the deployed value still matches that value, so a user edit survives; a key retired outright, such as `providers.webSearchOrder`, is pruned at any value. The same pass removes each `bash.patterns` rule listed in `OMP_RETIRED_BASH_RULES` (the 39 file-removal rules retired in 0.20.9). It compares with the merge's kit-rule normalization (approval case-folded, `match` whitespace collapsed), so a user rule with a different `match` or `approval` survives.
- `cycleOrder` ends with `astra` as its fifth stop. `modelRoles.astra` is `openai-codex/gpt-6-astra:xhigh`, and `modelTags.astra` is visible. Astra and Fable fall back to each other through concrete selectors. `modelRoles.fable` remains `anthropic/claude-fable-5-1:medium`, with visible `modelTags.fable`. The hidden `switch_fable` role uses the same Fable selector and keeps an empty fallback chain.
- `modelRoles.task` is `anthropic/claude-opus-5-5:high`, and `retry.fallbackChains.task` falls back to `openai-codex/gpt-6.1-sol:high`. `task.maxEffort` is `xhigh`: a caller `effort: hi` outranks the role's `:high` suffix and maps to the top of the model ladder, so the cap keeps `hi` at `xhigh` instead of `max`. `advisor` is `anthropic/claude-opus-5-5:medium` with an empty fallback chain, because a GPT-6 Sol advisor looped on repeated reads under an Opus 5.5 session. Never put any GPT model (`openai-codex/gpt-*`, including GPT-6.1 Sol and GPT-6 Astra) in the advisor role or chain; Astra also costs too much for this role. `smol`, `commit`, and `tiny` use `openai-codex/gpt-6-luna`. The kit-defined hidden `reviewer` role is `openai-codex/gpt-6.1-sol:xhigh` with `anthropic/claude-opus-5-5:xhigh` as its retry fallback, and all four reviewer entries in `task.agentModelOverrides` point to `@reviewer`. `ompOverlay.ts ROLE_ORDER, FALLBACK_ORDER` list `reviewer`, so a free session also replaces it. Only bundled `reviewer` and `security-reviewer` are discoverable OMP agents; `code-reviewer` and `plan-reviewer` stay dormant. The `SoT/toolchain.json` omp floor is 18.4.4, the oldest release the kit tested with `gpt-6.1-sol`. That release lists and serves the model through the `openai-codex` provider. `cli/docs/omp-models.md` records the checks.
- The seven Opus 5.5 roles (`default`, `slow`, `plan`, `designer`, `vision`, `task`, `advisor`) and the `smol`, `tiny`, `commit`, and `reviewer` retry chains use `anthropic/claude-opus-5-5` at the levels the role map records. `cli/docs/omp-models.md` carries the Artificial Analysis capture behind the role map, read 2026-09-29 at Intelligence Index v4.3.2 and Coding Agent Index v1.5 from the AA comparison-page metric tables. Opus 5.5 max has the highest index in that topic, at 58. AA has measured speed and latency for Opus 5.5 max and every GPT-6.1 Sol level; GPT-6 Luna medium is the only unmeasured speed and latency row.
- `modelRoles.web` is `web/firecrawl` and `retry.fallbackChains.web` carries the explicit 20-entry provider order. The kit declares both keys because the legacy `providers.webSearchOrder` key is retired: omp expands it in memory into these two keys and then drops it, and never writes that expansion back to disk. An explicit chain replaces omp's built-in web order wholesale, so every entry left out is a provider omp never tries. The owner removed the seven entries that named older models (Gemini 2.5 Flash, Claude Haiku 4.5, GPT-5.6, GPT-5.5, and Grok 4.5); keep every other provider.
- `SoT/.omp/models.yml` declares Astra's full `low, medium, high, xhigh, max` ladder with `defaultLevel: xhigh` as the worked provider ladder-override example. The temporary `anthropic.modelOverrides.claude-opus-5-5` block is gone, because the shared catalog now publishes the same limits, ladder, and prices. The removal switches omp from the block's `thinking.mode: effort` (a `budget_tokens` value per level from `ANTHROPIC_THINKING`, no effort value) to the catalog's `anthropic-adaptive` (adaptive thinking with the role's effort level); every kit Opus selector names its level, so the block's bare-selector `defaultLevel: high` is not needed. `ompRemovals.ts syncOmpModelRemovals, retired-block inventory` prunes it from `~/.omp/agent/models.yml` after the models merge, but only while the deployed block still equals the shipped one. `ompYaml.ts mergeOmpModels` preserves deployed-only keys in `~/.omp/agent/models.yml`, because a user file may carry provider credentials. Whole-file replacement is wrong.
- `SoT/.omp/AGENTS.md` carries the rule `Please remove all mannered prose.` Anthropic's Fable 5.1 prompting guide documents mannered prose as a Fable 5.1 behavior and gives that sentence as its short-version fix: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- `cli/docs/omp-models.md` (topic `omp-models`) records the role map rationale and the Artificial Analysis snapshot behind it. Model choices change with published benchmarks, so update that topic in the same commit as a role change.
- `SoT/.omp/config.yml` sets `compaction.thresholdTokens` to `-1`, omp's schema default sentinel selecting reserve-based behavior: the trigger becomes `contextWindow` minus `max(floor(contextWindow * 0.15), 16384)`, which is 231,200 on the 272,000-token Codex window and 850,000 on the 1,000,000-token Anthropic window. The key ships as `-1` rather than being deleted because `ompYaml.ts mergeOmpConfig` is additive, so removing a key from SoT never removes it from a deployed file. `cli/docs/omp-context.md` (topic `omp-context`) carries the derivation and the measured evidence, so update that topic in the same commit as any compaction-setting change.
- Sync registers the `docks` marketplace. It installs or upgrades `docks@docks` and `plan-lifecycle@docks` at user scope.
- Sync installs `pi-intercom` at the verified version from `SoT/toolchain.json`.
- Sync materializes the kit omp plugin `docks-kit-omp` from `SoT/.omp/plugin/` to `~/.docks-kit/omp-plugin` (`ompKitPlugin.ts syncKitPlugin`: directories 0700, files 0600, `package.json` `version` set to the kit version, stale files removed, no backups because the directory is kit-owned). `ompPlugins.ts syncPlugins, kit plugin link` then runs `omp plugin link <dir>` unless the `omp plugin list --json` npm row `docks-kit-omp` already has a `path` that resolves to that directory; `--skip-plugin-refresh` does not skip the link. The plugin extension registers `scratch_new`, `scratch_remove`, and `tidy_report`, adds a reminder after each bash command that created a resource, checks at session stop that those resources are gone, and at a main-session start claims `~/.cache/docks-kit/tidy.stamp.claim` and runs `docks-kit tidy --apply` in the background at most once per 12 hours. Every extension subprocess runs without a shell. The plugin also ships the `workspace-hygiene` skill and the `/cleanup` command. The plugin, the deployed rules, and the sweep call `docks-kit scratch` and `docks-kit tidy`, so a checkout sync must not run before the global `docks-kit` carries those commands.
- `task.agentIdleTtlMs` is `120000`, so omp parks an idle subagent after 2 minutes instead of 7. `browser.idleCloseSec` is `600`.
- By owner decision (0.21.0), resources on the workstation are always development, so `docks-kit tidy` sweeps them without a question. The omp prompt rules, the `workspace-hygiene` skill, `/cleanup`, and the extension reminders limit the cleanup of a remote resource (reached through SSH or a provider CLI such as `wrangler`, `vercel`, `kubectl`, or a remote Docker host) to targets named local, development, dev, test, homolog, homologation, staging, or preview, the plan-lifecycle non-production definition. A production cleanup needs an `ask` immediately before it, must be rare, and a `yolo` invocation does not answer that ask. Prompt rules cannot force an agent to ask, so this rule has no `bash.patterns` guard.
- The omp CLI is upstream-owned. It updates through `omp update`, or through the external manager that owns the install, such as Tern or Nix. `omp update` refuses to run on an install that an external manager owns. Sync never installs or upgrades the CLI.
- `docks-kit omp [--model <selector>|--pick] [args...]` starts one interactive omp session. The overlay sets the 16 roles in `ompOverlay.ts ROLE_ORDER`, `judge` and `memory` included, to one free model and empties the 13 retry chains in `FALLBACK_ORDER`. Every other deployed chain stays as deployed. In particular, `modelRoles.web` and `retry.fallbackChains.web` keep the deployed web-search provider order. Thus a web search that falls through the `web/*` providers can reach the paid `openai-codex/gpt-6-luna` entry. Higher-precedence model selection can replace those overlay values. It renders the overlay to `~/.cache/docks-kit/omp-free-<model>-<digest>.yml` (mode 0600) and passes it through omp's repeatable `--config` flag. `ompOverlay.ts overlayFileName` gives each distinct model-and-level combination its own file, and the digest covers the selector and both levels. omp can re-read the overlay during a live session, so a second launcher with another model or level must not rewrite it. Deployed `~/.omp/agent/` files stay untouched, so the next plain `omp` run uses the paid configuration again. Remaining arguments forward verbatim to omp.
- The session model persists per machine in `~/.docks-kit/kit.db` (table `omp_session`), next to the harness selection. The default is `opencode-zen/muse-spark-1.3-contributor-free` at `xhigh`. Every launch, a plain launch included, runs `omp models --json` (as `omp --profile <name> models --json` when the forwarded arguments select a profile) and checks the remembered or default model against the live free catalog. When that model is not in the catalog, the launcher stops with an error and does not start omp. `ompOverlay.ts ladderCeiling, advisorLevelFor` derive both levels from the ladder of the chosen model for the `--model` path, and `ompOverlay.ts planEffortChoice` drives the `--pick` wizard, which asks whether every role shares one level and otherwise takes one level for the main roles and one for the advisor from that model's own ladder. Levels never come from a fixed list: free ladders are not uniform, three free models publish no `medium`, and two publish no ladder, which the overlay renders as bare selectors. The picker lists only catalog models at zero input and output cost with `pricingStatus` free or unknown.
- `docks-kit omp --fast` toggles `tier.openai` in the deployed `~/.omp/agent/config.yml` between `priority` (omp's `/fast on` tier for OpenAI and OpenAI-Codex models) and `none`, prints the change, and exits. `ompFastMode.ts toggleOpenAiFast` edits only that key. `SoT/.omp/config.yml` does not declare `tier.openai`, so the additive merge keeps the toggled value across sync. There is no Ultrafast flag: omp ignores `ultrafast` for a Codex model whose catalog `serviceTiers` omits it, and the current GPT models omit it.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`, `SoT/.omp/`), see the matching SoT directory.

## Engineering rules

- **Idempotent operations.** Every EngineNative sync step must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SoT changes is a no-op.
- **Failed harness-CLI operations fail the sync.** A kit-managed marketplace or plugin command that exits non-zero is recorded through `failures.ts recordFailure` — it still warns in place, and `syncDispatch.ts engineSync, failure ledger` lists every entry under `--- Failures ---` after the summary, then returns exit 1. A skip is not a failure: a missing harness CLI, missing git, and a missing `SoT/toolchain.json` pin stay warn-only with exit 0; an unavailable plugin inventory warns without a ledger row and falls back to the full refresh, whose failed commands are recorded. `ompMarketplace.ts syncMarketplace, probe guard` returns before spawning so a host without omp never records one. Aggregate roll-up warnings (`N plugin operation(s) failed`) stay warns, because each counted site already records itself.
- **Removed bash engine.** The bash engine was removed after the `bash-engine-final` tag. `DOCKS_KIT_ENGINE=bash` must fail with the removed-engine message; engine bugs are fixed forward in EngineNative.
- **Effect 4 CLI stack.** The CLI pins `effect@4.0.0-rc.115` (including `effect/unstable/cli`), `@effect/platform-bun@4.0.0-rc.115` (`BunServices.layer`, `BunRuntime.runMain`), `@effect/vitest@4.0.0-rc.115`, and `vitest@5.0.3` (inside the `@effect/vitest` peer range `>=5.0.0 <6.0.0`; 5.0.3 fixes GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp, and is past the 5.x patch point for GHSA-82fw-gwwq-j7x9, fixed in 5.0.0-rc.2). The lockfile resolves the `vite` peer of `@vitest/mocker` to 7.3.7, which fixes the launch-editor and `server.fs.allow` advisories up to 7.3.6. `@effect/cli` and `@effect/platform` are removed and must not be reintroduced.
- **Effect skill routing.** Effect work in this checkout must verify migration and API call shapes against the installed declarations under `node_modules/effect/dist/unstable/cli/`, never from memory or a mutable dist-tag. The `effect-ts-setup`, `effect-ts-port`, and `effect-ts-specialist` skills target Effect 3.x and do not apply.
- **Targeted syncs.** `./docks-kit sync` accepts positional targets: `claude`, `codex`, `agents`, and `omp`. Use the narrowest target that matches the SoT change (for example, `./docks-kit sync omp` for omp-only config edits); targets can be combined with `--dry-run`, `--skip-bubblewrap` (skip optional bubblewrap bootstrap for the Codex Linux sandbox), `--skip-plugin-refresh` (install missing plugins without refreshing existing caches), `--reconcile`, `--prune`, and the deploy-time modifiers `--claude-compact-window=<tokens>` / `--claude-permissive` / `--claude-model=<m>` / `--claude-effort=<level>` / `--claude-advisor=<on|off|default>` / `--codex-model=<m>` / `--codex-effort=<level>` (see `CLAUDE.md` § Deploy-time modifiers).
- **Per-machine harness selection.** The SQLite store `~/.docks-kit/kit.db` drives a flag-less sync. A missing selection selects `claude`, `codex`, and `agents`; it never selects `omp` implicitly. `sync` never prompts and never writes the selection. `docks-kit harnesses` is the only command that writes the `harness_selection` table. With no stored selection, its picker pre-ticks all four harnesses, `omp` included, so a new machine opts out of omp instead of opting in; nothing changes until the picker saves. The same store holds the independent `omp_session` table, which only `docks-kit omp` writes, and a TTL cache (`cache_entry`) for the live Anthropic model list and `toolchain outdated` lookups. `kitDb.ts withKitDb` is the only opener: it runs the append-only `MIGRATIONS`, imports a legacy `state.json` once and renames it to `state.json.migrated`, and refuses a store from a newer schema. Cache rows carry the kit version as fingerprint, so a new release refetches them.
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up. The one exception is the Claude `removed` manifest (`claudeRemovals.ts REMOVED_MANIFEST, baseline removal inventory`), a curated list of unambiguous kit-owned artifacts that `claudeRemovals.ts syncRemovals, baseline artifact prune` force-prunes on every sync, including the home-relative `~/.local/bin/session-relay` artifact installed outside `~/.claude`; see `CLAUDE.md` § Pruning stale artifacts. Codex `config.toml` merges at table granularity: a table the SoT declares (`[features]`, `[sandbox_workspace_write]`, `[tui]`, ...) is replaced wholesale, so user keys inside it are dropped. The prior file stays in `config.toml.bak`, and user-only top-level keys and tables survive.
- **`--reconcile` / `--prune` are the kit-owned reconcile flags.** Orthogonal — `--reconcile` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--prune` removes what SoT does not declare: every user-scope Claude plugin whose id is absent from SoT `enabledPlugins` (third-party and previously opted-in plugins included, unless this run passes their `--claude-plugin` flag), every Claude marketplace except `claude-plugins-official`, SoT/opt-in plugin marketplaces, and marketplaces referenced by project/local installs, and the `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills` that SoT no longer lists. Combine with `--reconcile` for a full reset to SoT. Always preserved: user-only settings keys (custom env vars, mcpServers), manually-installed skills, and project/local-scope plugin installs. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned modules.** Axis modules own one concern each (see layout); orchestrators (`claudeSync.ts`, `codexSync.ts`, `skillsSync.ts`, `ompSync.ts`, `index.ts`, `argv.ts`, `parseArgs.ts`) keep prior exports. New shared shapes go in `sharedTypes.d.ts`, never a second local copy. The public CLI seam is `cli/src/engine.ts`.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split an engine/CLI change and a per-tool config change unless the change requires atomicity.
- **Version bumps.** Bump `package.json` on user-visible behavior change; bump a `SoT/toolchain.json` `verified` pin only after testing that release. Refactors, splits, and doc edits bump nothing.
- **Regenerate the payload.** After `SoT/`, `notification.mp3`, `package.json`, or `cli/tsconfig.json` changes, run `bun cli/scripts/generate-sot-payload.ts`; `bun run check:generated` verifies it. After file moves, clamp cited `metadata.source_files[].lines` ranges so `skillMetadata.test.ts` passes.
- **Dry-run before destructive flags.** Always preview with `./docks-kit sync --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--reconcile` or `--prune`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md`, `SoT/.codex/AGENTS.md`, and `SoT/.omp/AGENTS.md` are loaded into agent sessions' prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `CLAUDE.md` / `AGENTS.md` at the repo root (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: …
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, hook outputs that land in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages (e.g. SessionStart hook output), which is exactly how the kit's date/config injection works.

## Code style

- Bash: for launchers/installers/hook assets, use `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, and function-scoped `local`.
- JSON and YAML config: edit the SoT (`SoT/<tool>/`) and run `./docks-kit sync`. Never edit deployed config under `~/.claude/`, `~/.codex/`, or `~/.omp/agent/` directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external plugin marketplaces and installer downloads as untrusted input. Prefer download-then-run over `curl … | bash` so a truncated stream cannot execute a partial script.
- **Pin, never float.** Every kit-driven install of third-party software is pinned to a `SoT/toolchain.json` `verified` version — no `@latest` npm/bun installs (Shai-Hulud-class worm surface), no mutable action tags in workflows (commit SHAs only), installer scripts fetched from version tags where upstream supports it. New third-party install surface ⇒ manifest pin first. The rule also covers a transitive dependency whose declared range is a caret or tilde over a prerelease: `^4.0.0-rc.109` admits every later prerelease of the same version tuple, and a published install resolves that range fresh because `bun.lock` is not packaged, so a runtime pinned in `package.json` meets a newer sibling and the process fails at startup. The fix is an exact root pin plus both guards: the offline `cli/test/unit/dependencyPins.test.ts` and the clean-room `bun run smoke:package`. Moving the Effect release is therefore one lockstep commit: set `effect`, `@effect/platform-bun`, `@effect/platform-node-shared`, and `@effect/vitest` to the same version together, then run `bun run smoke:package`; the guard reports `unsatisfied` while one of them lags. Details: the `toolchain-context` skill and `cli/docs/toolchain.md`.
- **One exemption: the kit's own package.** `install.sh` and `install.ps1` end with `bun add -g docks-kit@latest`, because a global installer that pinned itself would install a fixed old kit forever, and pinning it to `package.json` would request an unpublished version between the release-prep commit and the npm publish. The exemption covers `docks-kit` alone. Both installers still pin the Bun installer they download to the manifest's verified version. `cli/test/unit/hostTargets.test.ts` asserts that pin in all four launcher and installer scripts, and `cli/test/unit/install.test.ts` proves `install.sh` passes it to the Bun installer.
## Testing

Run `bun run check` before and after each change: oxlint, `oxfmt --check`, `tsc --noEmit`, unit tests, and both golden suites. Scripts: `lint`, `format:check`, `typecheck`, `test:unit`, `test:integration` (goldens), `test`, `format`; CI runs `check` on push and pull request with Bun 1.4.4. Prove-red modes must exit non-zero after detecting planted mismatches. The golden writer emits two-space JSON that `oxfmt` re-serializes, so run `bun run format` after `--update-goldens` or `format:check` fails. Also verify user-facing changes via `./docks-kit sync --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), `bun run test:runtime:posix`, and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from the per-tool file.

Use direct acceptance and focused regressions while iterating, then run the full unit/golden gate once at the pre-commit or release boundary. Reuse still-matching evidence; a later relevant edit invalidates only the affected rung and final gate, not every prior check.

The spawning suites launch a prebuilt bundle of `cli/src/main.ts`. The build runs once per run, into the ignored `cli/dist-test/`. Bun otherwise transpiles the whole CLI on every child spawn. Set `DOCKS_KIT_TEST_CLI_ENTRY=<repo>/cli/src/main.ts` to run those suites against the TypeScript entry. Use that variable to read a real stack trace. See `cli/test/lib/cliEntry.ts`.

## Landing changes

Open a pull request when the change can alter what CI proves: `cli/`, `SoT/`, `.github/`, the launchers, the installers, `package.json`, `bun.lock`. Wait for every required check, then ask before merge. Push direct to `main` only for prose: root Markdown and code comments.

Never rewrite published `main` history to correct a routing mistake. Use a follow-up commit and say what happened.

## Skills

**Project-skill scope.** Keep project skills within two classes: kit-mechanic skills and the `unslop` repo-prose skill.
Canonical project skills live in `.agents/skills/<name>/SKILL.md`.
Each `.claude/skills/<name>` entry is a relative symlink to its canonical directory.
Codex reads `.agents/skills/` natively, so one copy serves both tools.
Kit-mechanic skills document regression-prone TypeScript sync logic in `cli/src/engine-native/`.
Kit-mechanic skills: `codex-config-merge-context`, `engine-native-context`, `plugin-bootstrap-context`, `settings-merge-context`, `sync-orchestration-context`, `toolchain-context`, `universal-skills-context`, and `omp-sync-context`.
**Pipeline content** (multi-agent slash commands, refactor/security/docs workflows, parallel-scanner agents) belongs in the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin — not here. Project-level agents under `.claude/agents/` follow the same rule: kit-mechanic agents that wrap kit-mechanic skills are permitted; pipeline agents live in the docks plugin.

**Windows checkouts.** These nine entries are the only symlinks this repository tracks. Git for Windows defaults to `core.symlinks=false`, which checks a symlink out as a plain file holding the target path, so Claude Code finds no `SKILL.md` and silently loads no project skill. Codex is unaffected, because it reads the real directories under `.agents/skills/`. To restore Claude Code on Windows, enable Developer Mode or run as administrator, then `git config core.symlinks true` and re-checkout the paths: `git checkout -- .claude/skills`. Never repair this by replacing an entry with a copy; two copies drift, which is the failure the canonical layout removes. This limitation is confined to project skills in this checkout. It does not affect the deployed user-level skills, where `skillsSync.ts linkOrCopyWithWarnings` already falls back from symlink to junction to marked copy.

`npx skills add cursor/plugins -s unslop -y -a claude-code codex` installs `unslop`, and root `skills-lock.json` pins it.
The repository vendors upstream `unslop` text and pins it by the lockfile hash, so never edit it locally.
Upstream licenses `pstack/` under MIT (Copyright (c) 2026 Lauren Tan), so redistribution is permitted.
MIT requires the notice to travel with the copy, so `.agents/skills/unslop/LICENSE` vendors it verbatim and must stay beside `SKILL.md`.
The `unslop` "adding soul" guidance conflicts with the global Simplified Technical English Output Standard.
The Output Standard wins.
Use `unslop` only for its pattern-detection lists.

<constraint>
When a kit-mechanic skill, its `references/`, or a wrapper agent (`.claude/agents/*.md` + its `.codex/agents/*.toml` twin) cites EngineNative internals, name the **module + exported/local function + semantic anchor** (e.g. `claudePluginPasses.ts syncPlugins, pass 5 uninstall guard`) — never a raw `file:NNN` line number, which goes stale on every refactor. Keep exactly one coarse `metadata.source_files[].lines` range per skill file as the sole intentional line-number touchpoint.
</constraint>

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` is intentionally empty, so the default sync exposes no universal skills. The generic opt-in contract remains: each [agentskills.io](https://agentskills.io/specification) slug is installed by `skillsInstall.ts syncUniversal` with `npx --yes skills@<verified> add <slug> -g -y -a claude-code codex`, where `<verified>` is the `skills-cli` pin in `SoT/toolchain.json`. The slug comes first because `-a/--agent` is variadic; naming both supported agents preserves the canonical `~/.agents/skills/<name>/SKILL.md` plus Claude's `~/.claude/skills/<name>` symlink. Existing canonical directories are reused idempotently, `--prune` removes only entries tracked in `~/.agents/.kit-managed-skills`, and skills requiring a separate CLI retain explicit helpers in `skillsSync.ts`.

## Plans

Use direct implementation for one clear, reversible, low-risk local diff with one
bounded acceptance path; it creates no plan issue, reviewer, or automatic
commit. Use a canonical plan for explicit planning, multi-commit or
cross-repository work, cold handoff, an unresolved decision, a cross-subsystem or
public-contract change, security-sensitive or destructive work, or any
non-`local` effect.

<constraint>
The plan record is a GitHub issue. Its body starts with
`<!-- plan-contract: v4 -->`, followed by one blank line and seven `##`
sections. It has no frontmatter. GitHub owns the title, open-work phase, owner,
timestamps, and completion. The repository tracks no plan markdown.
Three skills own the workflow. `plan-workspace` maintains the workspace.
Main-context `plan-manager` runs six phases: decide, draft, research, plan
review, implement, and code review. It uses bounded repair and fresh re-review
in both review phases, then archives. Internal `plan-reviewer` returns one
readable pre-implementation verdict block per round. Two read-only reviewer
wrappers ship: `plan-reviewer` and `code-reviewer`.
The explicit-only `yolo` skill runs the same workflow and asks only before merge.
</constraint>

After the marker and blank line, the record carries exactly seven sections.
They appear once each in this order: `## Goal`, `## Research`, `## Steps`,
`## Acceptance`, `## Do not touch`, `## Open questions`, and
`## Verification Results`. `## Goal` carries exactly one mode line.
Open-work phase is `drafting`, `planned`, `ongoing`, or `blocked`.
Every plan carries `plan`. A `plan:<phase>` label stores the open phase.
A blocked plan starts `## Open questions` with `Blocked: <one-line reason>`.
GitHub `state` and `stateReason` determine closed status. Review records live
only in issue comments. Each reviewer returns one markdown block.
The manager posts that block as one issue comment. The latest trusted eligible
comment per review kind wins. Its author must equal the plan's sole assignee.
Both review phases use fresh inputs and run at most five rounds. They stop on
pass, no progress, a finding that survives repair, or a round-five non-pass.
A plan-review `blocked` verdict routes its user-only decision through
`## Open questions` and `ask`.

The record carries no hash, permit, run identity, lock, or bundle, and the
`plan.mjs` shipped inside the installed `plan-lifecycle` plugin is the only
lifecycle tool. An `export` writes the sha256 of the body it copied beside the
copy so a stale copy cannot revert the record; that digest detects staleness and
authorizes nothing. Routine plan issue publication, implement-start linked
branch creation, commits, normal pushes, and the closing pull request carry the
settled mode's authorization and need no repeated prompt. Before any branch
checkout, including `gh issue develop --checkout`, require
`git status --porcelain` to be empty. If it is dirty, never stash, move, or
commit ambient work; set the plan `blocked` and name the dirty paths, or use an
authorized clean worktree.
Immediately after setting the plan `ongoing`, every `gh issue develop` call uses
`--repo`; the manager reuses a linked branch or creates one with
`--base <default> --checkout`, then re-lists and recovers after failure.
Implementation stops when no linked branch can be verified; there is no local
fallback. After the checks policy passes, the manager asks immediately before
merge. Without a fresh `Merge now` answer, it leaves the pull request and issue
open. `plan.mjs archive` verifies the latest trusted code-review result and
merged closing pull request after landing.

Every Steps row carries an `Effect` of exactly
`local|probe|production_access|publish|push|release|deploy`. A step whose
`Effect` is not `local` requires an in-session `ask` confirmation immediately
before it runs; when `ask` is unavailable the step is set `blocked` and the plan
reason becomes the first `## Open questions` line, `Blocked: <reason>`.
Persisted effects record intent only. Routine issue publication and landing
actions are outside the Steps table.
A user-invoked `yolo` run replaces these asks, the five-round stop, and the `blocked`-verdict question with the Yolo runs section of the installed `plan-lifecycle` contract.

Render a plan body verbatim only when the user names that plan and asks to see it. After a write, report the one-line header strip and the changed lines only; a write never re-renders the body.

No plan markdown is tracked. The pre-GitHub records under
`docs/plans/finished/` were deleted; `git log -- docs/plans/finished/` recovers
them as history, and no lifecycle command restores them. The complete contract
lives in `docs/PLAN.md`; `docs/AGENTS.md` routes to it and `docs/CLAUDE.md`
contains only `@AGENTS.md`.

Distinct from per-tool **Open Concerns** sections (wait-on-upstream
blockers tied to a vendor shipping a fix — these live inside the per-tool
file): plans are kit-internal work we control; Open Concerns is
conditions-for-resolution.

Plugin-internal work (skills, commands, agents) belongs in each plugin's
own repo, not here.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.
