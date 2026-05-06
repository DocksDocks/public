# Claude Code Configuration Kit

Portable Claude Code setup — settings, hooks, status line, RTK integration, kit-level coding conventions. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

**Focus: token efficiency without sacrificing quality.** Every setting and hook in this kit is tuned to minimize token consumption while preserving rigorous output. The configuration leans on 1M context with early auto-compaction via a 400K effective window, `max` effort (Opus 4.7's deepest thinking tier), Opus 4.7 as orchestrator, and adaptive thinking. When adding or editing anything here, the guiding question is: *does this change reduce tokens without weakening correctness?*

The skills, commands, and 41-agent multi-agent pipeline kit ship as a separate Claude Code plugin: **[DocksDocks/docks](https://github.com/DocksDocks/docks)**. This repo handles the parts that can't live in a plugin: env vars, permissions, hooks (RTK + claude.ai-connector disable), session/status-line tooling, and the consumer-facing CLAUDE.md. Install the docks plugin separately on each machine.

The `ssot/.claude/` directory is the **Single Source of Truth** (SSOT) for `~/.claude/`. Edit files here, then sync to your home directory.

## Repository Structure

| Path | Purpose |
|------|---------|
| `ssot/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `ssot/.claude/settings.json` | Permissions, hooks, plugins, env vars, token limits |
| `ssot/.claude/hooks/` | SessionStart hook scripts (e.g. `disable-claudeai-connectors.sh`) |
| `ssot/.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `ssot/.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |
| `alert_bubble.mp3` | Audio notification for Notification hook |
| `sync.sh` | Deploy ssot/ → ~/.claude/, install/upgrade RTK, merge settings |
| `docs/roadmap/` | Time-boxed kit-improvement plans (`planned/` → `ongoing/` → `finished/`). See `docs/roadmap/CLAUDE.md` for the convention |
| `tests/fixtures/` | Static fixtures (frozen synthetic projects) for kit + plugin smoke tests. See `tests/smoke/SMOKE-TESTS.md` for the canonical battery |
| `tests/baseline/MEASUREMENT-PROCEDURE.md` | How to capture per-phase token cost on a real project. Pairs with `rtk gain --history` and session JSONL transcripts |

The plugin's content (8 commands, 7 skills, 41 agents, plus author-side validators) lives in **[DocksDocks/docks](https://github.com/DocksDocks/docks)** — see that repo's README for command/skill/agent inventory and the validators that enforce kit-level conventions.

## Plugins

Configured in `ssot/.claude/settings.json` under `enabledPlugins` and `extraKnownMarketplaces`.

| Plugin | Source | Purpose |
|--------|--------|---------|
| `docks` | [DocksDocks/docks](https://github.com/DocksDocks/docks) | Multi-agent pipeline kit — 3 commands where parallel-agent value is irreducible (`/security`, `/docs`, `/refactor`), 15 portable skills (tdd-workflow, test-coverage, code-review, fix-workflow, human-docs-workflow, design-tokenization, roadmap-init, dep-vuln-workflow, lint-no-suppressions, make-interfaces-feel-better, nextjs-conventions, react-effect-policy, solid, react-reuse-components, typescript-typing), 20 specialized subagents tiered between Opus and Sonnet per phase |
| `n8n-mcp-skills` | [czlonkowski/n8n-skills](https://github.com/czlonkowski/n8n-skills) | n8n workflow skill pack — teaches Claude Code how to author production-ready n8n workflows |

### Install plugins on a new machine

`./sync.sh` handles this automatically. After the settings merge it reads `extraKnownMarketplaces` and `enabledPlugins` from the SSOT and runs `claude plugin marketplace add` + `claude plugin install` for anything missing from `~/.claude/plugins/known_marketplaces.json` / `installed_plugins.json`. Both CLI commands are idempotent, so reruns are no-ops.

The bootstrap exists because **`extraKnownMarketplaces` declarations in settings.json are not auto-cloned**. Without it, `/reload-plugins` reports `Plugin <X> not found in marketplace <Y>` even though the marketplace block is present in settings.json. Adding a new third-party plugin? Add it to both `enabledPlugins` and `extraKnownMarketplaces` in `ssot/.claude/settings.json`, then run `./sync.sh`. To pick up the new plugin in an active session, run `/reload-plugins`.

Official plugins (`context7`, `frontend-design`, `agent-sdk-dev`, `commit-commands`, `claude-md-management`, `skill-creator`, `php-lsp`, `code-simplifier`) are auto-installed by Claude Code from the built-in `claude-plugins-official` marketplace; the `enabledPlugins` declarations just keep them enabled.

**Manual fallback** (only if the `claude` CLI isn't on PATH during sync — sync prints a warning and skips bootstrap):

```bash
/plugin marketplace add DocksDocks/docks
/plugin install docks@docks
/plugin marketplace add czlonkowski/n8n-skills
/plugin install n8n-mcp-skills@n8n-mcp-skills
/reload-plugins
```

## RTK (Rust Token Killer)

Token-optimized CLI proxy that reduces LLM token consumption by 60-90%. A PreToolUse hook transparently rewrites Bash commands (e.g., `git status` → `rtk git status`) so output is compressed before it reaches the context window.

`rtk init -g` generates `~/.claude/RTK.md` and the `@RTK.md` import in `~/.claude/CLAUDE.md`. The PreToolUse hook entry comes from this kit's SSOT (`ssot/.claude/settings.json`) — the command is `rtk hook claude` (direct, no shim script). RTK 0.38.0 dropped the previous `~/.claude/hooks/rtk-rewrite.sh` shim; older docs that mention it are stale.

<constraint>
**RTK upgrade gotcha** — `rtk init -g` rewrites `~/.claude/settings.json` and **clears `hooks.PreToolUse` to `[]` even when its "Patch existing settings.json? [y/N]" prompt defaults to N** (observed RTK 0.38.0, 2026-05-05). It prints a "MANUAL STEP: add this hook" message after destroying the existing one. Never run `rtk init -g` blindly during an upgrade — either snapshot `~/.claude/settings.json` first and restore the `PreToolUse` block after, or just re-run `./sync.sh --force` to redeploy the SSOT entry. The kit's `sync.sh` skips `rtk init -g` when `~/.claude/RTK.md` already exists, so it won't trip on routine syncs — only manual invocations.
</constraint>

### Supported commands

git, gh, cargo, cat, grep/rg, ls, tree, find, diff, head, vitest, tsc, eslint, prettier, playwright, prisma, docker, kubectl, curl, wget, pytest, ruff, pip, mypy, go test/build/vet, aws, psql, and more.

### Install RTK (Linux)

```bash
# 1. Install the rtk binary
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash  # NB: upstream script has bashisms; on Debian/Ubuntu /bin/sh is dash and will choke

# 2. Ensure jq is installed (required by the hook)
sudo apt install -y jq   # Debian/Ubuntu
# or: sudo pacman -S jq  # Arch

# 3. Initialize RTK globally (generates hook + configures Claude Code)
rtk init --global

# 4. Add "Bash(rtk:*)" to permissions.allow in ~/.claude/settings.json

# 5. Verify
rtk --version        # Should print version
rtk ls .             # Should show compressed output
rtk gain             # Should show tracking is active

# 6. Restart Claude Code for the hook to take effect
```

## Status Line

Two-line display inspired by [claude-watch](https://github.com/xleddyl/claude-watch). Cross-platform (macOS + Linux).

- **Line 1**: Model name | folder | git branch
- **Line 2**: 5h/7d API usage with reset countdowns | context window usage with token counts

Requires `jq` and `curl`. Usage data is fetched via the `Stop` hook and cached to `/tmp/.claude_usage_cache`.

## Session Management

Based on https://claude.com/blog/using-claude-code-session-management-and-1m-context. The 400K compact window is a *fallback*; the habits below keep sessions crisp in the first place.

| Signal | Action | Why |
|--------|--------|-----|
| Related follow-up, same working set | **Continue** | Everything in context still matters |
| New task starting | **`/clear`** | Zero rot; you control what carries forward |
| Wrong path, same task | **`/rewind`** (double-tap `Esc`) | Undo the detour before it pollutes context |
| Same task, context getting heavy | **`/compact` with steering** | Direct Claude what to keep ("preserve the failing test + stack trace; drop the exploration") |
| Work will produce output you only need the conclusion of | **Subagent** | Keeps verbose output out of the parent context |
| Side task that needs the full conversation context | **`/fork <directive>`** (experimental, requires `CLAUDE_CODE_FORK_SUBAGENT=1`, Claude Code v2.1.117+) | Spawns a subagent inheriting full message history, system prompt, tools, and model. First request reuses the parent's prompt cache. |

Rule of thumb: if a turn starts with "that didn't work, try X instead," reach for `/rewind` before retrying — the failed attempt is context rot you're otherwise carrying forward.

The docks plugin's commands already use Opus-orchestrator + sonnet-subagents internally. The blog validates that pattern for ad-hoc work too. **`/fork` is for ad-hoc exploration, not for plugin command pipelines** — those intentionally isolate phases (fresh context per subagent, plan-file as the only handoff) to keep token costs predictable.

## Permission Mode

The kit sets `permissions.defaultMode: "auto"` and `skipAutoPermissionPrompt: true` — new sessions boot directly into auto mode with no entry confirmation. Docs: https://code.claude.com/docs/en/permission-modes.

The classifier tradeoff: the classifier that gates each action in auto mode is an API call in its own right. When that service has a transient outage, every Edit/Bash is blocked until it recovers. When that happens, cycle away with `Shift+Tab` (`default` → `acceptEdits` → `plan` → `auto`) until the classifier recovers. Fallbacks are baked in anyway — see "Fallbacks" below.

**Requirements** for auto mode (the kit meets them on a Max subscription):
- Plan: Max / Team / Enterprise / API (not Pro)
- Model: on Max, **Opus 4.7 only** (the kit pins this); on other plans Sonnet 4.6 / Opus 4.6 / Opus 4.7
- Provider: Anthropic API only (not Bedrock, Vertex, Foundry)
- Claude Code v2.1.83+

**What changes when auto mode is active:**
- Broad wildcard allow rules (`Bash(git *)`, `Bash(npm *)`, etc.) are dropped — everything routes through the classifier instead. Narrow rules like `Bash(npm test)` carry over.
- The `deny` list is still enforced.
- Protected paths (`.git`, `.claude`, `.mcp.json`, etc.) route to the classifier rather than being auto-approved.
- Dropped rules are restored the moment you leave auto mode.

**Fallbacks baked in**: 3 consecutive classifier blocks or 20 total in a session pause auto mode and resume prompting. Approving the prompted action resumes auto. Not configurable.

**When to bail out of auto mode**: classifier outage, sensitive production work, CI migrations, anything where you want to review each step. `Shift+Tab` cycles away from auto.

## Hooks

- **SessionStart**: Injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, pinned opus model, subagent model) so agents don't rely on training data cutoff
- **SessionStart (`matcher: "startup"`)**: Runs `~/.claude/hooks/disable-claudeai-connectors.sh` (sourced from `ssot/.claude/hooks/`) — auto-patches `~/.claude.json` `projects[$cwd].disabledMcpServers` for the current project, keeping unwanted Claude.ai connectors out of context. Workaround for the still-broken `ENABLE_CLAUDEAI_MCP_SERVERS` env var (see [issue #45158](https://github.com/anthropics/claude-code/issues/45158), [#20412](https://github.com/anthropics/claude-code/issues/20412)). Edit the `CONNECTORS` array in the script to change the disable list. Idempotent — safe to run on every startup
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

## Environment Variables

All configured in `ssot/.claude/settings.json` under the `env` block. The centerpiece strategy is **1M context + 400K compact window + max effort + sonnet subagents** — maximizes usable context before compaction while keeping token cost sane. Tuned for Opus 4.7, which removed `budget_tokens` and makes adaptive thinking the only thinking-on mode.

### Context management

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `400000` | Cap the effective window at 400K regardless of the model's real capacity. Compaction fires at the default ~95% → ~380K. Per Anthropic's Thariq Shihipar (2026-04-15 blog + tweet): a good compromise on 1M Opus. Value is capped at the model's real window, so it's safe on 200K models too. Docs: https://code.claude.com/docs/en/env-vars. |
| (implicit) 1M context | enabled by default | `CLAUDE_CODE_DISABLE_1M_CONTEXT` is **not** set, so 1M is active on Max/Team/Enterprise plans for Opus 4.7. Note: 4.7 uses a new tokenizer that may consume up to 1.35× more tokens than 4.6 on the same text — another reason to cap the compact window in absolute tokens rather than as a percentage. |

The status bar keeps showing context usage against the model's full window (1M); `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the compact trigger from `used_percentage`. Intentional: you still see real consumption; compaction just fires earlier.

### Thinking & reasoning

Opus 4.7 removed `budget_tokens` (returns 400 error) and makes **adaptive thinking the only thinking-on mode**. Fixed budgets and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` are gone.

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_EFFORT_LEVEL` | `max` | Highest thinking-budget tier. Valid: `low`/`medium`/`high`/`xhigh`/`max`/`auto`. Env var takes precedence over `/effort` and the `effortLevel` settings key. Tradeoff: `max` can overthink structured tasks — drop to `xhigh` if you see wasted reasoning on routine work. |

### Model selection

| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-4-7` | Pins the opus model version for the main orchestrator. 4.7 launched 2026-04-16 with step-change agentic-coding gains. |

**Subagent model selection:** not an env var. The docks plugin declares per-agent `model:` (sonnet/opus) in each agent's frontmatter. `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally NOT set — it would override all per-agent declarations (it's priority 1 in Claude Code's resolution order per the [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model)) and block per-phase tiering. To force all subagents to one model temporarily (rollback), export `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` — it wins over agent frontmatter.

### Output & UI

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `64000` | Max output tokens per response for the main session. Subagents remain capped at 32K regardless. |
| `CLAUDE_CODE_NO_FLICKER` | `1` | Fullscreen rendering mode, no terminal flicker, adds mouse support. Requires v2.1.89+. |
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR` | `1` | Keeps bash commands in the project working directory instead of resetting between calls. |

### Top-level settings.json keys

| Key | Value | Notes |
|-----|-------|-------|
| `alwaysThinkingEnabled` | `true` | Tells Claude Code to opt into adaptive thinking on every turn. On 4.7, adaptive thinking is off by default at the API layer and must be explicitly enabled — this flag handles that. |
| `showThinkingSummaries` | `true` | Display only; doesn't reduce token use. On 4.7, thinking content is omitted by default at the API layer; Claude Code opts in when this is true. |
| `viewMode` | `default` | Default transcript view on startup. Keeps tool I/O collapsed so the feed stays readable. Press `Ctrl+O` to cycle to `verbose` on demand. Enum: `default`/`verbose`/`focus`. |
| `skipAutoPermissionPrompt` | `true` | Suppresses the one-time confirmation shown when a session boots into auto mode. |
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |

Effort is controlled **only** via `CLAUDE_CODE_EFFORT_LEVEL` (env var). The top-level `effortLevel` key's schema only accepts `low`/`medium`/`high`/`xhigh` — the env var is required to reach `max`.

### Settings that do NOT belong in settings.json

| Setting | Correct location | Notes |
|---------|-----------------|-------|
| `showTurnDuration` | `~/.claude.json` | Triggers schema validation error in settings.json. `sync.sh` writes it to the right file. |

## Setup

```bash
# Clone and sync the kit
git clone <this-repo> ~/projects/public
cd ~/projects/public
./sync.sh              # full sync + RTK bootstrap + plugin bootstrap
./sync.sh --dry-run    # preview before applying
./sync.sh --no-rtk     # skip RTK install (also strips @RTK.md import from CLAUDE.md)
./sync.sh --force      # replace ~/.claude/settings.json instead of merging (backup kept)
```

In an active Claude Code session, run `/reload-plugins` after `./sync.sh` to activate any newly installed plugins without restarting.

`sync.sh` auto-detects the repo location, merges `settings.json` (deep-merge with array concat+unique for `permissions.{allow,deny,ask}`), writes `showTurnDuration` to `~/.claude.json`, copies the status line scripts and hook scripts, installs/initializes RTK if missing (or warns when the installed RTK is older than the latest GitHub release), and runs `claude plugin marketplace add` + `claude plugin install` for any `extraKnownMarketplaces` / `enabledPlugins` entries that aren't yet on disk. Sync principle: additive only, never delete.

### When to use `--force`

The default merge is additive: keys present in `~/.claude/settings.json` but absent from the SSOT are preserved. This protects user-only additions, but it also means **stale keys accumulate** — if a key is removed from the SSOT, a normal `./sync.sh` cannot clean it up.

`./sync.sh --force` replaces `~/.claude/settings.json` wholesale with the SSOT version (backup kept at `settings.json.bak`). Use it when:

- Removing/renaming a key in the SSOT and you want the change reflected downstream
- Debugging drift-related schema warnings or unexpected env behavior
- Resetting a machine whose settings have diverged

Before running `--force`, diff first:

```bash
diff <(jq -S . ssot/.claude/settings.json) <(jq -S . ~/.claude/settings.json)
./sync.sh --force
```

User-added permissions or env vars that don't exist in the SSOT will be discarded — reconcile them into the SSOT first if you want to keep them.

## Troubleshooting

- **RTK hook not firing in a project** — project-level PreToolUse hooks completely replace global ones. If a project has its own `.claude/settings.json` with PreToolUse hooks, the global RTK hook is silently disabled for that project. Fix: add the RTK hook entry to the project's settings (and ensure the hook command uses an absolute path, not `~/`).
- **Status line showing stale usage data** — the Stop hook fetches usage asynchronously and caches to `/tmp/.claude_usage_cache`. If it goes stale: `rm /tmp/.claude_usage_cache`.
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, which caps the effective window and fires compaction at ~95% of that (~380K). To delay, raise the value; to fire earlier, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N`. Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `sync.sh` handles this automatically.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **`@RTK.md` import missing** — generated by `rtk init -g`. If RTK is not installed, run `./sync.sh --no-rtk` to strip the import cleanly.
- **`/plugin marketplace add DocksDocks/docks` fails with "marketplace.json not found"** — clear the partial cache: `/plugin marketplace remove DocksDocks-docks` then re-add.
- **Plugin commands not appearing after install** — run `/reload-plugins`. Commands are namespaced as `/docks:<name>` (e.g., `/docks:security`).

## Open Concerns

Living list of kit-level bugs, blockers, and wait-on-upstream items that can't be fixed locally. Each entry records the symptom, root cause, workaround, and how to verify resolution.

**When invoked via "check open concerns"** (or similar), the assistant should: (a) read this section, (b) for each entry, fetch the linked upstream references and the current Claude Code version, (c) report which concerns are now resolved (issues closed/merged, version shipped), and (d) offer to remove resolved entries + undo their workarounds.

Entry format: `### [YYYY-MM-DD] <short title>` with Status / Symptom / Root cause / Upstream / Workaround / Verify resolution / Fallback.

---

### [2026-04-24] Opus 4.7 thinking summaries not rendered

**Status:** Open — confirmed bug, no fix in Claude Code 2.1.119 (verified on this machine).

**Symptom:** `"showThinkingSummaries": true` in `settings.json` does not produce visible thinking content on Opus 4.7. The thinking block header (token count, elapsed time) renders, but the expand toggle reveals empty content.

**Root cause:** Opus 4.7 flipped the API default for `thinking.display` from `"summarized"` (4.6 behavior) to `"omitted"` (faster time-to-first-token on streaming). Claude Code's harness does NOT currently translate `showThinkingSummaries: true` into `"display": "summarized"` on Opus 4.7 requests, so the client receives empty thinking blocks and has nothing to render.

**Upstream issues** (all open as of 2026-04-24):
- [anthropics/claude-code#49268](https://github.com/anthropics/claude-code/issues/49268) — "harness doesn't set display: summarized" (root cause)
- [anthropics/claude-code#49708](https://github.com/anthropics/claude-code/issues/49708) — thinking empty despite `showThinkingSummaries: true` (closed as duplicate)
- [anthropics/claude-code#49322](https://github.com/anthropics/claude-code/issues/49322) — VS Code extension variant
- [anthropics/claude-code#49902](https://github.com/anthropics/claude-code/issues/49902) — VS Code extension 2.1.112
- [anthropics/claude-code#52376](https://github.com/anthropics/claude-code/issues/52376) — subscription sessions may need server-side fix (separate open concern)
- Model-side reference: [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)

**Workaround:** Launch Claude Code with the hidden flag `--thinking-display summarized` (added in 2.1.111, not shown in `--help`; verified on 2.1.119). Persistent via shell alias in `~/.bashrc` or `~/.zshrc`:

```bash
alias claude='claude --thinking-display summarized'
```

**Verify resolution:**
1. Check each linked issue — look for `closed` with "merged" or a release tag citing the fix.
2. `claude update` then `claude --version`.
3. Remove the shell alias, restart shell, start a fresh session.
4. Ask a non-trivial question that triggers adaptive reasoning; confirm thinking summary renders inline.
5. If rendered: remove this Open Concerns entry + the shell alias.

**Fallback if the flag doesn't help:** Issue [#52376](https://github.com/anthropics/claude-code/issues/52376) is the likely cause — on Max/Team/Enterprise subscriptions, the server may silently ignore `display: "summarized"` even when the client sends it (only API-key sessions honor it). In that case, switch to `/model claude-opus-4-6` temporarily; thinking renders correctly on 4.6.

## Roadmap

In-flight kit-improvement work that spans multiple commits or sessions lives in `docs/roadmap/`. Files move between `planned/` → `ongoing/` → `finished/` via `git mv` so history is preserved. Each plan has YAML frontmatter (`created`, `updated`, `finished`, `status`) and GitHub-style checkboxes — flip `[ ]` → `[x]` in the same commit that lands the step, never as a batch pass later. See `docs/roadmap/CLAUDE.md` for the full convention.

This is distinct from `## Open Concerns` above:
- **Open Concerns**: wait-on-upstream blockers; resolution depends on Anthropic shipping a fix. No checkboxes — just verify-resolution criteria.
- **Roadmap**: kit-internal work we control. Time-boxed, checkbox-tracked.

Plugin-internal work (skills, commands, agents) belongs in the [docks repo](https://github.com/DocksDocks/docks)'s own roadmap, not here.
