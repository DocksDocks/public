# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (native AGENTS.md support, v2.1.277+), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

Pointers here name concepts, not coordinates — if a path or symbol moved,
trust the stated purpose and re-locate it (grep the symbol) before acting.

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
- **`.claude/rules/claude-code.md`** — Claude Code SoT (`SoT/.claude/`), env vars, hooks, plugins, status line, session management, permission mode, open concerns. Its `paths:` frontmatter scopes it: Claude Code loads it when it reads or edits a matching file, and any agent can open it by path.
- Codex uses this `AGENTS.md` file plus the Codex SoT under `SoT/.codex/`; no separate root `CODEX.md` is needed.
- omp uses this `AGENTS.md` file plus the omp SoT under `SoT/.omp/`.


docks-kit runtime and standalone binary support covers Linux x64/arm64, macOS
arm64, and Windows x64. Hosts outside this matrix fail before either
launcher can fall back to Bun source.

## Context tree

Per-folder conventions live in nested `AGENTS.md` nodes. Claude Code loads a
folder's AGENTS.md when it reads a file there; Codex loads only the nodes from
the root down to its working directory, so open the node for the folder you
edit from this table. Do not add CLAUDE.md files: a CLAUDE.md without an
`@AGENTS.md` import makes Claude read it instead of AGENTS.md. Edit the node,
not this list, when a folder's rules change. `context-tree audit` checks this
table against the AGENTS.md files on disk.

| Node | Governs |
|---|---|
| `docs/AGENTS.md` | Plan-record routing to `docs/PLAN.md` |
| `cli/AGENTS.md` | Effect CLI, EngineNative sync engine, bundled docs topics, build scripts, unit and golden suites |
| `.agents/skills/AGENTS.md` | Project skills, the `.claude/skills/` symlinks, and the wrapper agents in `.claude/agents/` and `.codex/agents/`; Claude Code reads nothing under `.agents/`, so open this node from this table |

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows CLI launchers. On supported hosts, each runs the matching binary in `cli/dist/` only when its `--version` matches `package.json` and no file under `cli/src/` or `cli/docs/` is newer than the binary. Otherwise it runs Bun-from-source and auto-installs Bun plus `node_modules`, and the mismatch or newer-source warning names the rebuild remedy. A launcher never deletes a binary: on a host without Bun it is the only remaining recovery path. Hosts outside the support matrix fail before source fallback. The standalone platform release binary provides no-Bun recovery. |
| `.oxlintrc.json` / `bunfig.toml` | Mechanical lint (correctness, suspicious, eqeqeq, no-var, prefer-const, no-unused) and the `bun fmt` code format settings (`[fmt]`) |
| `cli/` | Effect 4 CLI + bundled docs topics |
| `SoT/models.json` | Curated Claude and Codex model overlay: aliases and notes always apply; id rows are the fallback when a harness live list is unavailable |
| `SoT/toolchain.json` | Toolchain floors manifest (verified pins consumed by EngineNative; optional `upstream` source read by `docks-kit toolchain outdated`) |
| `SoT/.claude/bin/` | Dependency-free Bun runtime programs for Claude's statusline, SessionStart, and Notification |
| `SoT/.omp/` | Kit-owned omp SoT: `AGENTS.md`, `config.yml`, `models.yml`, `mcp.json`, `intercom.json`, and the kit plugin source `plugin/` |
| `install.sh` / `install.ps1` | POSIX and Windows global installers. Each installer stops on a host outside the support matrix before it downloads anything. |
| `.github/workflows/release-cli.yml` | `cli-v*` release: four binaries (Linux x64 and arm64, macOS arm64, Windows x64), plus `SHA256SUMS` and npm publish |
| `README.md` | Front door |
| `package.json` / `bun.lock` | npm package: `bin` = `cli/src/main.ts`; bundles `cli/` with the generated in-memory SoT payload |
| `SoT/.agents/skills.txt` | Universal-skill manifest, intentionally empty by default. Adding an [agentskills.io](https://agentskills.io/specification) slug opts it into EngineNative's shared `~/.agents/skills/` bootstrap and Claude symlink. |
| `notification.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/PLAN.md` | Plan record standard. The plan record is a GitHub issue; no plan markdown is tracked. `docs/AGENTS.md` routes to it. |
| `.claude/rules/claude-code.md` | Claude Code-only instructions; path-scoped by its `paths:` frontmatter |
| `.claude/settings.json` | Project Claude Code settings. It holds only `claudeMdExcludes`, so Claude Code does not load the SoT prompt payloads or the test fixtures as project instructions; sync never reads or writes it |
| `AGENTS.md` | This file — tool-agnostic instructions |

Module map for `cli/` (engine axes, commands, kit store, test fixtures, and the release-binary build `bun run build:binaries`): `cli/AGENTS.md`.

Codex SoT notes:
- `SoT/.codex/AGENTS.md` deploys to `~/.codex/AGENTS.md` as global Codex instructions.
- `SoT/.codex/config.toml` pins Codex to `model = "gpt-6.1-sol"`, sets normal and plan reasoning to `high` with concise summaries, and sets `model_verbosity = "low"`, live top-level `web_search`, workspace-write sandboxing with sandboxed command network access, cross-session `memories` (+ dedicated note tools), `[agents]` subagent limits (`max_threads = 12`, `max_depth = 2` — intentionally above Codex defaults for broad parallel kit work; deeper recursion increases cost and predictability risk), a 128 KiB `project_doc_max_bytes` budget for the repo-side AGENTS.md chain (the global `~/.codex/AGENTS.md` is uncapped and not counted), and enables the two Docks plugins `docks@docks` and `plan-lifecycle@docks` (the shared plan lifecycle).
- `SoT/.codex/config.toml` does not set `personality`. Codex 0.159.0 deprecated the key, and `friendly` and `pragmatic` no longer select a style. `codexConfig.ts removeRetiredTopLevelSettings, retired top-level key prune` removes the retired `personality = "pragmatic"` line from a deployed `config.toml` on every sync. A different user-set value survives.
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved. Codex applies the strictest matching rule across all files, so a user allow rule cannot loosen a kit `forbidden` or `prompt` rule. Because the strictest rule wins, a narrow allow cannot carve an exception out of a broader prompt prefix, and a prefix rule cannot see an option after an operand. The guards therefore fail closed: every `rm`, `git rm`, `git worktree remove`, and `gio trash` prompts, and only macOS `trash` is allowed (owner decision). A `prompt` goes to `approvals_reviewer = "auto_review"`, a reviewer subagent, not always to a person. `docks.rules` carries the destructive-command guards (`docks-kit docs command-guards`); `cli/test/unit/codexSyncRules.test.ts` parses every one-line `prefix_rule`, alternatives lists and `justification` included, and asserts each guard's decision. Keep each rule on one line so that parser sees it.
- `codexSync.ts syncRules, kit rules manifest` records each rules file that the kit deploys in `~/.codex/.kit-managed-rules`, one `<sha256>  <file name>` line per file. The manifest sits outside `rules/`, so Codex never reads it as a rule file. A stale kit rules file keeps its old rules active. When the SoT drops a rules file, every sync therefore removes the deployed copy while the copy still holds the recorded kit bytes. A dropped file that the user edited stays, keeps its record, and gets a warning on each sync. Cleanup reads and removes only recorded names that the SoT no longer ships. It never reads or removes a file that the SoT does not ship and no sync recorded, such as `default.rules`. Sync still deploys each name that the SoT ships over an existing file, recorded or not. It backs up a file that differs to `<name>.bak` and replaces it. This includes an existing `docks.rules` on the first sync after the upgrade that added the manifest. Sync replaces the manifest through a temporary file and a rename, so an interrupted sync keeps the previous complete manifest. `--dry-run` prints `[dry-run] remove <file>` and writes nothing.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`; when the `codex` CLI is available, sync reruns `codex plugin add <plugin@marketplace>` for enabled SoT plugins so stale cached installs are refreshed.
- Codex `/import` hook cleanup (`codexHooks.ts`): `cli/AGENTS.md`.
- Codex limits the initial skill list to 2% of the model context and shortens descriptions first; it still reads a selected skill's full `SKILL.md`. Additive sync preserves user-added plugins, so their skill count and malformed cached `SKILL.md` files remain plugin-owned. Sync never patches a plugin cache in place.
- The global prompt SoTs carry the owner's standing authorization for Docks cross-company plan review, which never overrides host or platform denial.
- The `codex` CLI binary is upstream-owned, not kit-owned. The official standalone installer keeps package metadata under `$CODEX_HOME/packages/standalone` and places the `codex` symlink in `~/.local/bin` by default; sync only warns with a download-then-run installer command when the CLI is missing. Existing installs can self-update with `codex update`; npm and Homebrew remain upstream alternatives.

- Claude runtime settings are an authoring template with sentinels. `claudeRuntime.ts` materializes absolute Bun/script paths only after the shared `bun.ts` bootstrap is ready; `claudeSync.ts` writes all runtime assets before atomically committing settings, then prunes the legacy shell scripts and Stop hook. Native `rate_limits` is the sole quota source, so jq/curl/OAuth caches are not runtime dependencies. A missing Bun defers only this cutover and preserves legacy pointers/files.
- Claude's deployed SoT defaults are `model: opus` and `effortLevel: high`; `advisorModel` is deliberately absent/off. `--claude-advisor=on` is the per-machine opt-in and writes `advisorModel: opus` after the settings merge. `opus` is the alias, not a pinned id: the `minimumVersion` floor of 2.1.280 makes Claude Code resolve it to Opus 5.5, the default Opus from that release, instead of capping at Opus 5 under the former 2.1.219 floor. Keeping the alias tracks the next Opus release without a kit change and stays portable across providers. The floor also subsumes Fable 5.1's 2.1.257 requirement.
- Claude permission rules are pruned, not host-scoped. The kit deploys its `PowerShell(...)` deny and ask rules on every host, because Claude Code leaves the PowerShell tool opt-in off Windows rather than unavailable, and a host that enables it must already carry the guards. `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory` lists the rules the kit no longer ships. `claudeRemovals.ts syncRemovals, retired-permission pass` force-prunes those exact strings from the kit-managed `~/.claude/settings.json` on every sync, because `settings.ts mergeSettings, permission-array union` would otherwise keep a dropped rule forever. A different user-authored rule survives. To restore an exact retired rule for one checkout, put it in that checkout's `.claude/settings.local.json`. Claude Code resolves that file against the working directory and merges it over user settings. Sync never reads or writes the checkout-local file. Claude Code has no user-scope local settings file. For a machine-wide restoration, add the rule to `SoT/.claude/settings.json`. At the same time, remove the exact string from `claudeRetired.ts RETIRED_PERMISSION_RULES, exact retired-rule inventory`. `permissions.allow` holds four read-only entries, `Read`, `Glob`, `Grep`, and `WebSearch`, the working-directory edit rule `Edit(./)`, and two narrow trash allows, `Bash(gio trash -- *)` and `Bash(trash *)`. Broad shell allow rules are not restored, because an allow rule resolves before Claude Code's read-only command analyzer and the auto-mode classifier. `autoMemoryEnabled` and `autoDreamEnabled` are both `false`.

omp SoT notes:
- `SoT/.omp/AGENTS.md`, `config.yml`, `models.yml`, and `mcp.json` deploy to `~/.omp/agent/`.
- `SoT/.omp/intercom.json` deploys to `$PI_CODING_AGENT_DIR/intercom/config.json`. The default root is `~/.pi/agent`. Under a named omp profile (`OMP_PROFILE` or `PI_PROFILE`), it deploys to `<profile agentDir>/intercom/config.json`, because omp exports `PI_CODING_AGENT_DIR` as the profile agent directory.
- `ompFileDeploy.ts syncMergedYaml` deep-merges `config.yml` through `ompYaml.ts mergeOmpConfig` and `models.yml` through `mergeOmpModels`. Both wrap one generic mapping merge; only the config wrapper prunes stale `retry.fallbackChains` wildcards and merges `bash.patterns`.
- `SoT/.omp/config.yml` `bash.patterns` holds the destructive-command guards. omp's `CRITICAL_BASH_PATTERNS` check returns a bare safety override before a matching prompt rule, and `tools.approvalMode: yolo` ignores a bare override, so a prompt on a critical command becomes an allow, in subagents too (`omp://approval-mode.md`). Every `rm` shape that check can flag is therefore a deny: recursive `rm`, `sudo` anywhere before `rm` (also by path), any `rm` with an `r` or `f` option before an absolute path, and `--no-preserve-root`. By owner decision (0.20.9), the recursive-`rm` deny also covers any prefix (a `* rm ` copy of each bare cluster rule, so `env X=1 rm -rf b`, `xargs rm -rf`, `find . -exec rm -rf {} +`, and `git rm -r dir` are denied) and the `-ri`, `-ir`, `-Ri`, and `-iR` clusters for bare `rm`, `*/rm`, and `* rm`. By owner decision (0.21.0), 17 more denies cover bulk removal that can empty the home directory: `find -delete` (bare, `*/find`, `* find`), `-exec`, `-execdir`, `-ok`, and `-okdir` with `rm` or `*/rm`, and `xargs rm` in six shapes. No glob can express "inside the temporary directory", so `docks-kit scratch remove` checks that path in code. A `$` or a backtick anywhere after `git push` in the same command is a deny, not a prompt (0.22.5, #120). A variable can expand to a `+` refspec or `--force`, and the matcher reads the text before the shell expands it. The agent reads the refusal and writes the ref literally, so no person is asked. The two rules are `*git push *$*` and ``*git push *`*``. Their leading `*` keeps a shell keyword such as `do`, a wrapper such as `env`, or a path before `git` from hiding the push. By owner decision (0.22.8, #126), the kit ships no omp prompt rule: `bash.patterns` holds only the denies plus the `trash *` allow, so every command that no deny matches runs without a question, in subagents too. Since 0.20.9 this run-without-question behavior covers a non-denied `rm`, `git rm`, `git worktree remove`, and `gio trash`. Since 0.21.0 it also covers `docks-kit scratch remove`. Since 0.22.8 it also covers `git clean`, `git reset --hard`, a hook skip, and every `git push` that no deny matches. The force-push denies match only `git push --force` or `-f` directly before `origin main` or `origin master`, so another spelling, such as `git push origin main --force`, runs. A prompt rule that the user adds survives sync and still asks. `SoT/.omp/AGENTS.md` carries the agent rules for these commands, and it tells the agent to write each `git push` ref literally and to push the current branch with `git push -u origin HEAD`. Claude Code `permissions.ask` and Codex `docks.rules` keep their ask tiers. The list order is deny, then `trash *`. omp takes the first match. `ompYaml.ts mergeBashPatterns, grouped rule merge` keeps user rules and groups all rules as kit deny, user deny, user prompt, kit prompt, other user rules, kit allow, so a user deny or prompt precedes every kit allow. It treats a deployed rule equal to a kit rule (approval case-folded, `match` whitespace collapsed) as the kit copy, so a re-sync is a no-op. A rule the kit stops shipping stays as a user rule, so retire one through `ompRemovals.ts OMP_RETIRED_BASH_RULES`. `cli/test/lib/ompBashPatterns.ts` ports omp 18.17.0's matcher, critical patterns, and yolo resolution; `cli/test/unit/ompBashPatterns.test.ts` asserts each command's final outcome and the merge. omp subagents reject every `prompt`, and the `eval` tool stays unrestricted by owner decision.
- `ompSync.ts` runs `ompRemovals.ts syncOmpRemovals, retired-key inventory` right after the config merge, and that pass force-prunes retired kit-owned keys from `~/.omp/agent/config.yml` on every sync, without `--reconcile`. The pass is required because `mergeOmpConfig` is additive, so removing a key from the SoT alone never removes it from a deployed file. A key retired with a recorded value is pruned only while the deployed value still matches that value, so a user edit survives; a key retired outright, such as `providers.webSearchOrder`, is pruned at any value. The same pass removes each `bash.patterns` rule listed in `OMP_RETIRED_BASH_RULES`: the 39 file-removal rules retired in 0.20.9, the four `git push` prompts for a `$` or backtick word that 0.22.5 replaced with denies, and the 492 prompt rules retired in 0.22.8 (`RETIRED_PROMPT_MATCHES`). It compares with the merge's kit-rule normalization (approval case-folded, `match` whitespace collapsed), so a user rule with a different `match` or `approval` survives.
- `cycleOrder` ends with `astra` as its fifth stop. `modelRoles.astra` is `openai-codex/gpt-6-astra:xhigh`, and `modelTags.astra` is visible. Astra and Fable fall back to each other through concrete selectors. `modelRoles.fable` remains `anthropic/claude-fable-5-1:medium`, with visible `modelTags.fable`. The hidden `switch_fable` role uses the same Fable selector and keeps an empty fallback chain.
- `modelRoles.task` is `anthropic/claude-opus-5-5:high`, and `retry.fallbackChains.task` falls back to `openai-codex/gpt-6.1-sol:high`. `task.enableEffort` is `false`: a caller `effort` outranks the role's level suffix, and `hi` maps to the top of the model ladder, so with the field on, `hi` spawns ran at `task.maxEffort` (`xhigh`) instead of the role level. With the field off, every spawn runs its role level, and `task.maxEffort` bounds only a per-call `model` with a `:level` suffix. `advisor` is `anthropic/claude-opus-5-5:medium` with an empty fallback chain, because a GPT-6 Sol advisor looped on repeated reads under an Opus 5.5 session. Never put any GPT model (`openai-codex/gpt-*`, including GPT-6.1 Sol and GPT-6 Astra) in the advisor role or chain; Astra also costs too much for this role. `smol`, `commit`, and `tiny` use `openai-codex/gpt-6-luna`. The kit-defined hidden `reviewer` role is `openai-codex/gpt-6.1-terra:high`. Its retry fallback is `anthropic/claude-opus-5-5:high`. All four reviewer entries in `task.agentModelOverrides` point to `@reviewer`. `task.agentServiceTierOverrides` sets the same four agents to `inherit`, so they take the live tier of the main session for each provider. The user set the effort `high` and chose to follow the fast toggle (#134); the review benchmark of #130 chose the model. `ompOverlay.ts ROLE_ORDER, FALLBACK_ORDER` list `reviewer`, so a free session also replaces it. omp bundles the `reviewer` and `security-reviewer` agents, and the `plan-lifecycle` plugin ships `code-reviewer` and `plan-reviewer`. The `SoT/toolchain.json` omp floor is 18.4.4, the oldest release the kit tested with `gpt-6.1-sol`. That release lists and serves the model through the `openai-codex` provider. `cli/docs/omp-models.md` records the checks.
- The seven Opus 5.5 roles (`default`, `slow`, `plan`, `designer`, `vision`, `task`, `advisor`) and the `smol`, `tiny`, `commit`, and `reviewer` retry chains use `anthropic/claude-opus-5-5` at the levels the role map records. `cli/docs/omp-models.md` carries the Artificial Analysis capture behind the role map, read 2026-09-29 at Intelligence Index v4.3.2 and Coding Agent Index v1.5 from the AA comparison-page metric tables. The `reviewer` row is the exception: it comes from a v5.0.1 capture read 2026-11-05, and it compares only with other v5.0.1 figures. Opus 5.5 max has the highest index in that topic, at 58. AA has measured speed and latency for Opus 5.5 max and every GPT-6.1 Sol level; GPT-6 Luna medium is the only unmeasured speed and latency row.
- `modelRoles.web` is `web/firecrawl` and `retry.fallbackChains.web` carries the explicit 20-entry provider order. The kit declares both keys because the legacy `providers.webSearchOrder` key is retired: omp expands it in memory into these two keys and then drops it, and never writes that expansion back to disk. An explicit chain replaces omp's built-in web order wholesale, so every entry left out is a provider omp never tries. The owner removed the seven entries that named older models (Gemini 2.5 Flash, Claude Haiku 4.5, GPT-5.6, GPT-5.5, and Grok 4.5); keep every other provider.
- `SoT/.omp/models.yml` declares Astra's full `low, medium, high, xhigh, max` ladder with `defaultLevel: xhigh` as the worked provider ladder-override example. The temporary `anthropic.modelOverrides.claude-opus-5-5` block is gone, because the shared catalog now publishes the same limits, ladder, and prices. The removal switches omp from the block's `thinking.mode: effort` (a `budget_tokens` value per level from `ANTHROPIC_THINKING`, no effort value) to the catalog's `anthropic-adaptive` (adaptive thinking with the role's effort level); every kit Opus selector names its level, so the block's bare-selector `defaultLevel: high` is not needed. `ompRemovals.ts syncOmpModelRemovals, retired-block inventory` prunes it from `~/.omp/agent/models.yml` after the models merge, but only while the deployed block still equals the shipped one. `ompYaml.ts mergeOmpModels` preserves deployed-only keys in `~/.omp/agent/models.yml`, because a user file may carry provider credentials. Whole-file replacement is wrong.
- `SoT/.omp/AGENTS.md` carries the rule `Please remove all mannered prose.` Anthropic's Fable 5.1 prompting guide documents mannered prose as a Fable 5.1 behavior and gives that sentence as its short-version fix: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1
- `cli/docs/omp-models.md` (topic `omp-models`) records the role map rationale and the Artificial Analysis snapshot behind it. Model choices change with published benchmarks, so update that topic in the same commit as a role change.
- `SoT/.omp/config.yml` sets `compaction.thresholdTokens` to `-1`, omp's schema default sentinel selecting reserve-based behavior: the trigger becomes `contextWindow` minus `max(floor(contextWindow * 0.15), 16384)`. The trigger is 425,000 on the 500,000-token windows of GPT-6.1 Sol and Terra, 231,200 on the 272,000-token windows of GPT-6 Luna and Astra, and 850,000 on the 1,000,000-token Anthropic window. The key ships as `-1` rather than being deleted because `ompYaml.ts mergeOmpConfig` is additive, so removing a key from SoT never removes it from a deployed file. `cli/docs/omp-context.md` (topic `omp-context`) carries the derivation and the measured evidence, so update that topic in the same commit as any compaction-setting change.
- Sync materializes the kit omp plugin `docks-kit-omp` from `SoT/.omp/plugin/` to `~/.docks-kit/omp-plugin` (`ompKitPlugin.ts syncKitPlugin`). It sets directories to 0700, files to 0600, and the `package.json` `version` to the kit version, and it removes stale files. It keeps no backups, because the directory is kit-owned. `ompPlugins.ts syncPlugins, kit plugin link` then runs `omp plugin link <dir>`. It skips the link when the `omp plugin list --json` npm row `docks-kit-omp` already has a `path` that resolves to that directory. `--skip-plugin-refresh` does not skip the link. The `hygiene.ts` extension registers `scratch_new`, `scratch_remove`, and `tidy_report`. It adds a reminder after each bash command that created a resource, and it checks at session stop that those resources are gone. At a main-session start, it claims `~/.cache/docks-kit/tidy.stamp.claim` and runs `docks-kit tidy --apply` in the background at most once per 12 hours. Every extension subprocess runs without a shell. The `pluginUpgrades.ts` extension reads the omp plugin upgrade log. In a tool result of each main session, it adds one reminder for the logged upgrades that the session did not get before. It names only the upgrades that finished after its omp process started. The reminder tells the agent to ask the user to run `/reload-plugins`. It then tells the agent to read each plugin skill again through `skill://` before it runs a skill script. It asks for a restart instead when an upgraded plugin ships hooks, extension modules, or non-MCP tools. omp imports extensions only at startup. An omp process that started before a sync deployed `pluginUpgrades.ts` did not load it, so its sessions get no reminder. The plugin also ships the `workspace-hygiene` skill and the `/cleanup` command. The plugin, the deployed rules, and the sweep call `docks-kit scratch` and `docks-kit tidy`. So a checkout sync must not run before the global `docks-kit` carries those commands.
- `task.agentIdleTtlMs` is `120000`, so omp parks an idle subagent after 2 minutes instead of 7. `browser.idleCloseSec` is `600`.
- By owner decision (0.21.0), resources on the workstation are always development, so `docks-kit tidy` sweeps them without a question. The omp agent prompt, the `workspace-hygiene` skill, `/cleanup`, and the extension reminders limit the cleanup of a remote resource (reached through SSH or a provider CLI such as `wrangler`, `vercel`, `kubectl`, or a remote Docker host) to targets named local, development, dev, test, homolog, homologation, staging, or preview, the plan-lifecycle non-production definition. A production cleanup needs an `ask` immediately before it, must be rare, and a `yolo` invocation does not answer that ask. Prompt rules cannot force an agent to ask, so this rule has no `bash.patterns` guard.
- The omp CLI is upstream-owned. It updates through `omp update`, or through the external manager that owns the install, such as Tern or Nix. `omp update` refuses to run on an install that an external manager owns. Sync never installs or upgrades the CLI.
- omp plugin upgrade flow, the `pi-intercom` install, and the `docks-kit omp` free-model launcher: `cli/AGENTS.md`.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`, `SoT/.omp/`), see the matching SoT directory.

## Engineering rules

- **EngineNative and CLI rules** (idempotency, failure ledger, removed bash engine, Effect stack and skill routing, harness-selection store, module boundaries): `cli/AGENTS.md`.
- **Targeted syncs.** `./docks-kit sync` accepts positional targets: `claude`, `codex`, `agents`, and `omp`. Use the narrowest target that matches the SoT change (for example, `./docks-kit sync omp` for omp-only config edits); targets can be combined with `--dry-run`, `--skip-bubblewrap` (skip optional bubblewrap bootstrap for the Codex Linux sandbox), `--skip-plugin-refresh` (install missing plugins without refreshing existing caches), `--reconcile`, `--prune`, and the deploy-time modifiers `--claude-compact-window=<tokens>` / `--claude-permissive` / `--claude-model=<m>` / `--claude-effort=<level>` / `--claude-advisor=<on|off|default>` / `--codex-model=<m>` / `--codex-effort=<level>` (see § Deploy-time modifiers under `## Setup` in this file, and the Claude table in `.claude/rules/claude-code.md` § Deploy-time modifiers).
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up. The one exception is the Claude `removed` manifest (`claudeRemovals.ts REMOVED_MANIFEST, baseline removal inventory`), a curated list of unambiguous kit-owned artifacts that `claudeRemovals.ts syncRemovals, baseline artifact prune` force-prunes on every sync, including the home-relative `~/.local/bin/session-relay` artifact installed outside `~/.claude`; see `.claude/rules/claude-code.md` § Pruning stale artifacts. Codex `config.toml` merges at table granularity: a table the SoT declares (`[features]`, `[sandbox_workspace_write]`, `[tui]`, ...) is replaced wholesale, so user keys inside it are dropped. The prior file stays in `config.toml.bak`, and user-only top-level keys and tables survive.
- **`--reconcile` / `--prune` are the kit-owned reconcile flags.** Orthogonal — `--reconcile` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--prune` removes what SoT does not declare: every user-scope Claude plugin whose id is absent from SoT `enabledPlugins` (third-party and previously opted-in plugins included, unless this run passes their `--claude-plugin` flag), every Claude marketplace except `claude-plugins-official`, SoT/opt-in plugin marketplaces, and marketplaces referenced by project/local installs, and the `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills` that SoT no longer lists. Combine with `--reconcile` for a full reset to SoT. Always preserved: user-only settings keys (custom env vars, mcpServers), manually-installed skills, and project/local-scope plugin installs. `.claude/rules/claude-code.md` § When to use `--reconcile` and `--prune` documents the Claude paths and diff recipes.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split an engine/CLI change and a per-tool config change unless the change requires atomicity.
- **Version bumps.** Bump `package.json` on user-visible behavior change; bump a `SoT/toolchain.json` `verified` pin only after testing that release. Refactors, splits, and doc edits bump nothing.
- **Regenerate the payload.** After `SoT/`, `notification.mp3`, or `package.json` changes, run `bun cli/scripts/generate-sot-payload.ts`; `bun run check:generated` verifies it. After file moves, clamp cited `metadata.source_files[].lines` ranges so `skillMetadata.test.ts` passes.
- **Dry-run before destructive flags.** Always preview with `./docks-kit sync --dry-run` (or the relevant `diff <(jq -S …)` recipe in `.claude/rules/claude-code.md` § When to use `--reconcile` and `--prune`) before invoking `--reconcile` or `--prune`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md`, `SoT/.codex/AGENTS.md`, and `SoT/.omp/AGENTS.md` are loaded into agent sessions' prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `AGENTS.md` or `.claude/rules/claude-code.md` (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: …
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, hook outputs that land in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages (e.g. SessionStart hook output), which is exactly how the kit's date/config injection works.

## Code style

- Bash: for launchers/installers/hook assets, use `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, and function-scoped `local`.
- JSON and YAML config: edit the SoT (`SoT/<tool>/`) and run `./docks-kit sync`. Never edit deployed config under `~/.claude/`, `~/.codex/`, or `~/.omp/agent/` directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external plugin marketplaces and installer downloads as untrusted input. Prefer download-then-run over `curl … | bash` so a truncated stream cannot execute a partial script.
- **Pin, never float.** Every kit-driven install of third-party software is pinned to a `SoT/toolchain.json` `verified` version, except the exemptions in the next item — no `@latest` npm/bun installs (Shai-Hulud-class worm surface), no mutable action tags in workflows (commit SHAs only), installer scripts fetched from version tags where upstream supports it. New third-party install surface ⇒ manifest pin first. The rule also covers a transitive dependency whose declared range is a caret or tilde over a prerelease: `^4.0.0-rc.109` admits every later prerelease of the same version tuple, and a published install resolves that range fresh because `bun.lock` is not packaged, so a runtime pinned in `package.json` meets a newer sibling and the process fails at startup. The fix is an exact root pin plus both guards: the offline `cli/test/unit/dependencyPins.test.ts` and the clean-room `bun run smoke:package`. Moving the Effect release is therefore one lockstep commit: set `effect`, `@effect/platform-bun`, and `@effect/platform-node-shared` to the same version together, then run `bun run smoke:package`. The offline guard fails when a lag breaks a declared range. Its peer-range check fails when the installed `effect` is outside a non-optional peer range of the runtime closure. Its nested-copy check fails when `@effect/platform-node-shared` lags. A lagging `@effect/platform-bun` can keep every declared range satisfied (4.1.1 accepts `@effect/platform-node-shared` `^4.1.1`), so only the lockstep commit keeps it in step. Details: the `toolchain-context` skill and `cli/docs/toolchain.md`.
- **Exemptions: the kit's own package, two host-toolchain installs, and the existing marketplace plugins.** `install.sh` and `install.ps1` end with `bun add -g docks-kit@latest`, because a global installer that pinned itself would install a fixed old kit forever, and pinning it to `package.json` would request an unpublished version between the release-prep commit and the npm publish. The `@latest` exemption covers `docks-kit` alone. Both installers still pin the Bun installer they download to the manifest's verified version. `cli/test/unit/hostTargets.test.ts` asserts that pin in all four launcher and installer scripts, and `cli/test/unit/install.test.ts` proves `install.sh` passes it to the Bun installer. Two host-toolchain installs have no pin, because the host toolchain controls their version and the kit does not: `claudeLsp.ts installRustAnalyzer` adds `rust-analyzer` through `rustup component add rust-analyzer`, and `codexSync.ts ensureBubblewrap` installs `bubblewrap` through the distro package manager. Their `SoT/toolchain.json` rows (`rust-analyzer`, and `bwrap` with a floor only) and `cli/docs/toolchain.md` record this. The existing Claude Code, Codex, and omp marketplace plugin installs have no manifest pin either: sync installs and refreshes those plugins at the version that their marketplace publishes. Any new install surface, a new marketplace or plugin source included, still needs a manifest pin first.
## Testing

Run `bun run check` before and after each change: oxlint, `lint:effect` (Effect rules through `effect-tsgo diagnostics --strict`), `bun fmt --check`, `bun check`, the generated-payload check (`check:generated`), unit tests, and both golden suites. Scripts: `lint`, `lint:effect`, `format:check`, `typecheck`, `check:generated`, `test:unit`, `test:integration` (goldens), `test`, `format`; CI runs `check` on pushes to `main` and on pull requests with Bun 1.4.4. Prove-red modes must exit non-zero after detecting planted mismatches. The golden writer emits two-space JSON that `bun fmt` re-serializes, so run `bun run format` after `--update-goldens` or `format:check` fails. For Effect diagnostics in the editor, set the TypeScript language server command to `node_modules/.bin/effect-tsgo tsc --lsp --stdio`. Keep the `@effect/language-service` plugin entry in `cli/tsconfig.json`: without it, `lint:effect` checks no file and passes. Also verify user-facing changes via `./docks-kit sync --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), `bun run test:runtime:posix`, and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from `.claude/rules/claude-code.md` § When to use `--reconcile` and `--prune`.

Use direct acceptance and focused regressions while iterating, then run the full unit/golden gate once at the pre-commit or release boundary. Reuse still-matching evidence; a later relevant edit invalidates only the affected rung and final gate, not every prior check.

Spawning-suite bundle and `DOCKS_KIT_TEST_CLI_ENTRY`: `cli/AGENTS.md`.

## Landing changes

Open a pull request when the change can alter what CI proves: `cli/`, `SoT/`, `.github/`, the launchers, the installers, `package.json`, `bun.lock`. Wait for every reported check to finish, then ask before merge. A failed or cancelled check blocks the merge. Push direct to `main` only for prose: root Markdown and code comments.

Never rewrite published `main` history to correct a routing mistake. Use a follow-up commit and say what happened.

## Skills

Project-skill and wrapper-agent authoring rules (scope, canonical layout, Windows symlinks, vendored `unslop`, citation constraint): `.agents/skills/AGENTS.md`.

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` is intentionally empty, so the default sync exposes no universal skills. The generic opt-in contract remains: each [agentskills.io](https://agentskills.io/specification) slug is installed by `skillsInstall.ts syncUniversal` with `npx --yes skills@<verified> add <slug> -g -y -a claude-code codex`, where `<verified>` is the `skills-cli` pin in `SoT/toolchain.json`. The slug comes first because `-a/--agent` is variadic; naming both supported agents preserves the canonical `~/.agents/skills/<name>/SKILL.md` plus Claude's `~/.claude/skills/<name>` symlink. Existing canonical directories are reused idempotently, and `--prune` removes only entries tracked in `~/.agents/.kit-managed-skills`.

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
The explicit-only `yolo` skill runs the same workflow. It still asks before merge, on a review stall, before a production cleanup, and before a step after the landing merge, as the contract's Yolo runs section says.
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
Both review phases use fresh inputs for each round. They stop on
pass. Ask the user to continue or block when a round makes no progress, the
same finding returns after a repair, round 5 does not pass, or dispatch fails
again without a relevant change. If no answer is available, record the reason
and block. A yolo run uses the round ceiling of the contract's Yolo runs
section instead.
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
A user-invoked `yolo` run replaces these asks, the continue-or-block question of the review loop, and the `blocked`-verdict question with the Yolo runs section of the installed `plan-lifecycle` contract.

Render a plan body verbatim only when the user names that plan and asks to see it. After a write, report the one-line header strip and the changed lines only; a write never re-renders the body.

No plan markdown is tracked. The pre-GitHub records under
`docs/plans/finished/` were deleted; `git log -- docs/plans/finished/` recovers
them as history, and no lifecycle command restores them. The complete contract
lives in `docs/PLAN.md`; `docs/AGENTS.md` routes to it.

Distinct from the **Open Concerns** section of `.claude/rules/claude-code.md`
(wait-on-upstream blockers tied to a vendor shipping a fix): plans are
kit-internal work we control; Open Concerns is conditions-for-resolution.

Plugin-internal work (skills, commands, agents) belongs in each plugin's
own repo, not here.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.

## Setup

```bash
# Clone and sync the kit
git clone <this-repo> ~/projects/public
cd ~/projects/public
./docks-kit harnesses                # view or change this machine's flag-less sync selection
./docks-kit sync                     # sync this machine's harness selection (additive)
./docks-kit sync --dry-run           # preview before applying
./docks-kit sync --skip-bubblewrap   # skip optional bubblewrap bootstrap (Codex Linux sandbox)
./docks-kit sync --reconcile         # reconcile settings toward SoT: SoT keys and arrays win, user-only keys kept (settings layer only)
./docks-kit sync --prune             # uninstall plugins/marketplaces not in SoT (plugin layer only)
./docks-kit sync --reconcile --prune # full reset to SoT (both layers)
./docks-kit sync claude --claude-compact-window=680k  # deploy-time: raise autocompact window (any token count: 680k or 680000) for disposable sessions (model unchanged)
./docks-kit sync claude --claude-permissive           # deploy-time: empty permissions.ask/deny — unattended commits/pushes in sandboxes
./docks-kit sync --claude-plugin=supabase   # opt in the supabase plugin (install + enable in deployed settings)
./docks-kit sync --claude-plugin=n8n        # opt in the n8n-mcp-skills plugin (add marketplace + install + enable); repeatable/comma-separated
./docks-kit model claude opus        # deploy-time: set Opus explicitly (matches the SoT; standalone form of --claude-model=)
./docks-kit status                   # show deployed vs SoT state
./docks-kit toolchain check          # verify installed tools against SoT/toolchain.json floors
```

On Windows, replace `./docks-kit` with `.\docks-kit.ps1` in these checkout
commands.

For Codex plugins, after deploying `SoT/.codex/config.toml` and the personal marketplace file, sync runs `codex plugin add <plugin@marketplace>` for each enabled SoT plugin. Re-running sync therefore refreshes stale Codex plugin caches instead of only updating marketplace metadata. Sync also removes the older kit-created configured Docks marketplace source so Codex uses the personal marketplace file as the single source.

### Deploy-time modifiers

Unlike `--reconcile`/`--prune` (which reconcile toward SoT), modifiers change the **deployed** config for a specific machine profile. The SoT is never touched, and a later flag-less sync reasserts it: Claude returns to Opus/high/advisor-off and Codex returns to its model/high effort. Modifiers run after the base merge/removal passes, are idempotent, honor `--dry-run`, and warn when their tool target is not selected. `docks-kit model <tool> <value>` is the standalone form of the model modifiers.

Codex mirrors the model/effort contract with `--codex-model=<m>` and
`--codex-effort=<level>`; Codex `default` effort restores `high`.
