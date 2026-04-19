# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

**Focus: token efficiency without sacrificing quality.** Every setting, command, and hook in this kit is tuned to minimize token consumption while preserving rigorous multi-agent pipeline output. The configuration leans on 1M context with early auto-compaction via a 400K effective window, `xhigh` effort (Opus 4.7's recommended tier for agentic/coding work, below `max`'s overthinking cost), sonnet subagents under an Opus 4.7 orchestrator, and adaptive thinking — combined with `<task>` blocks that carry explicit Success Criteria and Anti-Hallucination Checks so smaller models still produce dependable work. When adding or editing anything here, the guiding question is: *does this change reduce tokens without weakening correctness?*

The `ssot/.claude/` directory is the **Single Source of Truth** (SSOT) for `~/.claude/`. Edit files here, then sync to your home directory.

## Repository Structure

| Path | Purpose |
|------|---------|
| `ssot/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `ssot/.claude/settings.json` | Permissions, hooks, plugins, token limits |
| `ssot/.claude/commands/*.md` | 9 custom slash commands (see below) |
| `ssot/.claude/skills/*/SKILL.md` | Portable engineering-convention skills (see below) |
| `ssot/.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `ssot/.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |
| `alert_bubble.mp3` | Audio notification for Notification hook |
| `guard-skills.sh` / `score-skills.sh` | Structural + quality validators for skills |
| `guard-commands.sh` / `score-commands.sh` | Structural + quality validators for commands |

## Custom Commands

All commands use multi-agent pipelines. The orchestrator runs on Opus; subagents run on sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`) — rigorously constrained by `<task>` blocks with Success Criteria and Anti-Hallucination Checks. Most commands use a **Builder-Verifier pattern** (Builder creates output → Verifier runs concrete checks) for quality.

| Command | Pipeline | Pattern |
|---------|----------|---------|
| `/security` | Discovery → [Scanner \| Analyzer \| Hunter] → Synthesizer | DAG fan-out/fan-in |
| `/fix` | Exploration → [Code Scanner \| Dependency Scanner] → Planner → Verifier | DAG + Builder-Verifier |
| `/review` | Exploration → Analyzer → Verifier | Builder-Verifier |
| `/test` | Exploration → Analyzer → Generator → Verifier | Builder-Verifier |
| `/docs` | Detection → Exploration → [Categorizer \| Scanner] → Skills Builder → [Role Mapper \| Pattern Extractor] → Agents Builder → Unified Verifier | DAG + Builder-Verifier (skills + agents + cross-layer check) |
| `/human-docs` | Exploration → Analyzer → Writer → Verifier | Builder-Verifier |
| `/refactor` | Exploration → [Dead Code Scanner \| Duplication Scanner] → SOLID Analyzer → Planner → Verifier | DAG + Builder-Verifier (sequential SOLID phase) |

Commands with parallel phases (`/security`, `/fix`, `/docs`, `/refactor`) include explicit instructions to launch agents in a single turn for wall-clock time savings. `/docs` has two parallel phases (Phase 2 skills analysis and Phase 4 agents analysis).

All commands enforce **Plan Mode** — read-only analysis first, user approval gate, then implementation.

## Skills

Portable engineering-convention skills that auto-trigger when Claude recognizes a matching task. Skills follow the [agentskills.io](https://agentskills.io) open standard: `SKILL.md` with frontmatter + body (≤500 lines), discovered by Claude Code at session start, full body loaded on demand. All skills in this kit are `user-invocable: false` — they stay out of the `/` menu but still auto-trigger on relevant work.

| Skill | Triggers on |
|-------|-------------|
| `dep-vuln-workflow` | `pnpm audit` / `npm audit`, CVE/GHSA advisories, major version bumps, peer-dep conflicts, rollback decisions |
| `lint-no-suppressions` | Tempted to add `eslint-disable` / `@ts-ignore` / `# noqa` / `@SuppressWarnings` — provides decision tree + reusable pre-commit hook |
| `nextjs-conventions` | Next.js 13/14/15/16 work — App Router files, Server Components/Actions, `proxy.ts`, async cookies/headers, `"use client"` boundaries |
| `react-effect-policy` | Writing `useEffect` — 6 anti-patterns with React 19 replacements (`useSyncExternalStore`, `useDeferredValue`, derived state, Server Actions) |
| `react-solid` | Component architecture / refactoring — SOLID's 5 principles translated to function-based React (Extract Hook, Strategy Map, discriminated unions, ISP splits, DIP via Server Actions) |

Validators (`guard-skills.sh`, `score-skills.sh`) enforce spec conformance — see `## Editing Commands` for the same pattern applied to commands.

## Plugins

Third-party plugins installed via the Claude Code plugin marketplace. Configured in `ssot/.claude/settings.json` under `enabledPlugins` and `extraKnownMarketplaces`.

| Plugin | Source | Purpose |
|--------|--------|---------|
| `autoresearch` | [uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch) | Autonomous iteration loop (Karpathy's autoresearch for Claude Code). Commands: `/autoresearch`, `:plan`, `:security`, `:ship`, `:debug`, `:fix`, `:scenario`, `:predict`, `:learn` |

### Install plugins on a new machine

```bash
# Autoresearch (third-party marketplace)
/plugin marketplace add uditgoenka/autoresearch
/plugin install autoresearch@autoresearch
/reload-plugins
```

Official plugins (`superpowers`, `context7`, `frontend-design`, etc.) are auto-installed from `enabledPlugins` in settings.json.

## RTK (Rust Token Killer)

Token-optimized CLI proxy that reduces LLM token consumption by 60-90%. A PreToolUse hook transparently rewrites Bash commands (e.g., `git status` → `rtk git status`) so output is compressed before it reaches the context window.

`rtk init -g` auto-generates `~/.claude/RTK.md`, the hook, the `@RTK.md` CLAUDE.md import, and the settings.json hook entry. No manual file management needed.

### Supported commands

git, gh, cargo, cat, grep/rg, ls, tree, find, diff, head, vitest, tsc, eslint, prettier, playwright, prisma, docker, kubectl, curl, wget, pytest, ruff, pip, mypy, go test/build/vet, aws, psql, and more.

### Install RTK (Linux)

```bash
# 1. Install the rtk binary
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh

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
| Same task, context getting heavy | **`/compact` with steering** | Direct Claude what to keep ("preserve the failing test + stack trace; drop the exploration"). Beats waiting for auto-compact to guess. |
| Work will produce output you only need the conclusion of | **Subagent** | Keeps verbose output out of the parent context |

Rule of thumb: if a turn starts with "that didn't work, try X instead," reach for `/rewind` before retrying — the failed attempt is context rot you're otherwise carrying forward.

The kit's nine custom commands already use Opus-orchestrator + sonnet-subagents. The blog validates that pattern for ad-hoc work too.

## Permission Mode

The kit does **not** set a `defaultMode` — new sessions start in `default` mode (normal per-tool approval prompts). Auto mode is supported but opt-in; enable it when you want it via `Shift+Tab` (cycles `default` → `acceptEdits` → `plan` → `auto`) or `claude --permission-mode auto`. Docs: https://code.claude.com/docs/en/permission-modes.

Why not default to auto: the classifier that gates each action in auto mode is an API call in its own right. When that service has a transient outage, every Edit/Bash is blocked until it recovers — even simple local work stalls. Keeping auto mode opt-in means routine sessions aren't held hostage by a backend hiccup, while longer agentic loops can still opt in when prompt fatigue outweighs classifier risk.

**Requirements** for auto mode (the kit meets them on a Max subscription):
- Plan: Max / Team / Enterprise / API (not Pro)
- Model: on Max, **Opus 4.7 only** (the kit pins this); on other plans Sonnet 4.6 / Opus 4.6 / Opus 4.7
- Provider: Anthropic API only (not Bedrock, Vertex, Foundry)
- Claude Code v2.1.83+

**What changes when auto mode is active:**
- Broad wildcard allow rules (`Bash(git *)`, `Bash(npm *)`, `Bash(python *)`, etc.) are dropped — everything routes through the classifier instead. Narrow rules like `Bash(npm test)` carry over.
- The `deny` list is still enforced.
- Protected paths (`.git`, `.claude`, `.mcp.json`, etc.) route to the classifier rather than being auto-approved.
- Dropped rules are restored the moment you leave auto mode.

**Fallbacks baked in**: 3 consecutive classifier blocks or 20 total in a session pause auto mode and resume prompting. Approving the prompted action resumes auto. Not configurable.

**When to bail out of auto mode**: classifier outage, sensitive production work, CI migrations, anything where you want to review each step. `Shift+Tab` cycles away from auto.

Auto mode is Anthropic's term-of-art "research preview" — it reduces prompt fatigue on long agentic loops, not a replacement for review on risky operations.

## Hooks

- **SessionStart**: Injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, pinned opus model, subagent model) so agents don't rely on training data cutoff
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

## Environment Variables

All configured in `ssot/.claude/settings.json` under the `env` block. The centerpiece strategy is **1M context + 400K compact window + xhigh effort + sonnet subagents** — maximizes usable context before compaction while keeping token cost sane. Tuned for Opus 4.7, which removed `budget_tokens` and makes adaptive thinking the only thinking-on mode.

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
| `CLAUDE_CODE_EFFORT_LEVEL` | `xhigh` | Anthropic's recommended starting point for 4.7 agentic/coding. Sits between `high` and `max`. Valid: `low`/`medium`/`high`/`xhigh`/`max`. `max` is reserved for frontier problems — it risks overthinking on structured tasks. |

### Model selection

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_SUBAGENT_MODEL` | `claude-sonnet-4-6` | All Task-tool subagents use sonnet. Must be a full model name (bare aliases like `sonnet` are risky). |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-4-7` | Pins the opus model version for the main orchestrator. 4.7 launched 2026-04-16 with step-change agentic-coding gains. |

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
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |

Effort is controlled **only** via `CLAUDE_CODE_EFFORT_LEVEL` (env var). The top-level `effortLevel` key was removed because its schema doesn't accept `xhigh`.

### Settings that do NOT belong in settings.json

| Setting | Correct location | Notes |
|---------|-----------------|-------|
| `showTurnDuration` | `~/.claude.json` | Triggers schema validation error in settings.json. `sync.sh` writes it to the right file. |

## Setup

```bash
# Clone and sync
git clone <this-repo> ~/projects/public
cd ~/projects/public
./sync.sh              # full sync + RTK bootstrap
./sync.sh --dry-run    # preview before applying
./sync.sh --no-rtk     # skip RTK install (also strips @RTK.md import from CLAUDE.md)
./sync.sh --force      # replace ~/.claude/settings.json instead of merging (backup kept)
```

`sync.sh` auto-detects the repo location, merges `settings.json` (deep-merge with array concat+unique for `permissions.{allow,deny,ask}`), writes `showTurnDuration` to `~/.claude.json`, copies the status line scripts, and installs/initializes RTK if missing. Sync principle: additive only, never delete.

### When to use `--force`

The default merge is additive: keys present in `~/.claude/settings.json` but absent from the SSOT are preserved. This protects user-only additions, but it also means **stale keys accumulate** — if a key is removed from the SSOT (e.g. `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `showTurnDuration`), a normal `./sync.sh` cannot clean it up.

`./sync.sh --force` replaces `~/.claude/settings.json` wholesale with the SSOT version (backup kept at `settings.json.bak`). Use it when:

- Removing/renaming a key in the SSOT and you want the change reflected downstream
- Debugging drift-related schema warnings or unexpected env behavior
- Resetting a machine whose settings have diverged

Before running `--force`, diff first to confirm nothing you need will be lost:

```bash
diff <(jq -S . ssot/.claude/settings.json) <(jq -S . ~/.claude/settings.json)
./sync.sh --force
```

User-added permissions or env vars that don't exist in the SSOT will be discarded — reconcile them into the SSOT first if you want to keep them.

## Troubleshooting

- **RTK hook not firing in a project** — project-level PreToolUse hooks completely replace global ones. If a project has its own `.claude/settings.json` with PreToolUse hooks, the global RTK hook is silently disabled for that project. Fix: add the RTK hook entry to the project's settings (and ensure the hook command uses an absolute path, not `~/`).
- **Status line showing stale usage data** — the Stop hook fetches usage asynchronously and caches to `/tmp/.claude_usage_cache`. If it goes stale: `rm /tmp/.claude_usage_cache`.
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, which caps the effective window and fires compaction at ~95% of that (~380K). To delay, raise the value; to fire earlier, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N` (percentage of the capacity). Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `sync.sh` handles this automatically.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **`@RTK.md` import missing** — generated by `rtk init -g`. If RTK is not installed, run `./sync.sh --no-rtk` to strip the import cleanly.

## Command Authoring Conventions

When creating or modifying commands in `ssot/.claude/commands/`:

<constraint>
Plan Mode Enforcement:
- Use a `<constraint>` tag to enforce `EnterPlanMode`, not plain markdown
- Template: `<constraint>\nIf not already in Plan Mode, call \`EnterPlanMode\` NOW before doing anything else. All phases are read-only until the user approves the plan.\n</constraint>`
- Do NOT use `## MANDATORY`, `**STOP!**`, or numbered workflow lists — Plan Mode handles this

Approval Gates:
- Do NOT add custom approval gates (`STOP HERE`, `Do NOT proceed`, `Wait for explicit approval`)
- Plan Mode's `ExitPlanMode` is the only approval mechanism — the UI handles user review
- The approval phase should write plan summary to the plan file, then call `ExitPlanMode`
- Template: `## Phase N: Present Plan + Exit Plan Mode\n\nWrite the following to the plan file, then call \`ExitPlanMode\`:\n1. [presentation items]\n\nPlan Mode handles user approval. Once approved, proceed to Phase X.`

Phase Transitions:
- Use `<constraint>` tags for non-negotiable rules, not bold markdown or `STOP!`
- Do NOT use `/compact` between phases — write phase output to the plan file instead
- Include a Phase Transition Protocol constraint if the command has 3+ sequential phases

Implementation Phase:
- Start with `After approval:` not `Once user has approved the plan:`

Project Skills Integration:
- Commands that read project knowledge should check `.claude/skills/` (NOT `.claude/context/`)
- Pattern: `If .claude/skills/ exists, read relevant project skills for domain-specific conventions`
- Do NOT reference `.claude/context/` or `_index.json` — the context tree system is deprecated

Content Quality:
- No slop words in titles or descriptions: "comprehensive", "robust", "elegant", "seamless"
- No filler sentences before `<task>` blocks — the task prompt is self-explanatory
- No duplicate instructions within a single `<task>` block (e.g., stating "Run date" twice)
- Every Verifier must include Anti-Hallucination Checks (file existence, import paths, function signatures, file paths, package cross-reference)

Structural:
- Phase Transition Protocol constraint is MANDATORY for commands with 3+ sequential phases
- Each `<task>` block should have a concrete, measurable Success Criteria section
- Allowed Tools section goes at the bottom of the command, split into Planning/Implementation
</constraint>

## Editing Commands & Skills

When modifying commands or skills, keep in sync by re-running `./sync.sh`. The `ssot/.claude/` directory is the source of truth; `~/.claude/` is the deployed copy.

Before committing, run the validators:

```bash
bash guard-commands.sh   # structural checks (task tags, Success Criteria, Phase Transition Protocol for 3+ phases, WebFetch consistency)
bash score-commands.sh   # quality score across all commands
bash guard-skills.sh     # structural checks (frontmatter, name-matches-dir, description ≤1024 chars starting with "Use when", body ≤500 lines, metadata.updated ISO date)
bash score-skills.sh     # quality score across all skills (CSO, freshness, examples, tables, code fences, body-size sweet spot)
```

`score-skills.sh --per-file` prints one `<name> <score>` line per skill — useful for spotting drift after an edit.
