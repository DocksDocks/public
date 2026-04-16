# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

**Focus: token efficiency without sacrificing quality.** Every setting, command, and hook in this kit is tuned to minimize token consumption while preserving rigorous multi-agent pipeline output. The configuration leans on 1M context with early auto-compaction (45%), `xhigh` effort (Opus 4.7's recommended tier for agentic/coding work, below `max`'s overthinking cost), sonnet subagents under an Opus 4.7 orchestrator, and adaptive thinking — combined with `<task>` blocks that carry explicit Success Criteria and Anti-Hallucination Checks so smaller models still produce dependable work. When adding or editing anything here, the guiding question is: *does this change reduce tokens without weakening correctness?*

The `ssot/.claude/` directory is the **Single Source of Truth** (SSOT) for `~/.claude/`. Edit files here, then sync to your home directory.

## Repository Structure

| Path | Purpose |
|------|---------|
| `ssot/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `ssot/.claude/settings.json` | Permissions, hooks, plugins, token limits |
| `ssot/.claude/commands/*.md` | 9 custom slash commands (see below) |
| `ssot/.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `ssot/.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |
| `alert_bubble.mp3` | Audio notification for Notification hook |

## Custom Commands

All commands use multi-agent pipelines. The orchestrator runs on Opus; subagents run on sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`) — rigorously constrained by `<task>` blocks with Success Criteria and Anti-Hallucination Checks. Most commands use a **Builder-Verifier pattern** (Builder creates output → Verifier runs concrete checks) for quality.

| Command | Pipeline | Pattern |
|---------|----------|---------|
| `/security` | Discovery → [Scanner \| Analyzer \| Hunter] → Synthesizer | DAG fan-out/fan-in |
| `/fix` | Exploration → [Code Scanner \| Dependency Scanner] → Planner → Verifier | DAG + Builder-Verifier |
| `/review` | Exploration → Analyzer → Verifier | Builder-Verifier |
| `/test` | Exploration → Analyzer → Generator → Verifier | Builder-Verifier |
| `/docs` | Detection → Exploration → [Categorizer \| Scanner] → Builder → Verifier (+ Migration Mode) | DAG + Builder-Verifier |
| `/human-docs` | Exploration → Analyzer → Writer → Verifier | Builder-Verifier |
| `/refactor` | Exploration → [Dead Code Scanner \| Duplication Scanner] → Planner → Verifier | DAG + Builder-Verifier |
| `/solid` | Exploration → Discovery → Analyzer → Planner → Verifier | Builder-Verifier |
| `/team` | Discovery → [Role Mapper \| Pattern Extractor] → Generator → Verifier | DAG + Builder-Verifier |

Commands with parallel phases (`/security`, `/fix`, `/docs`, `/team`) include explicit instructions to launch agents in a single turn for wall-clock time savings.

All commands enforce **Plan Mode** — read-only analysis first, user approval gate, then implementation.

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

## Hooks

- **SessionStart**: Injects current date/time and active config (context window, auto-compact %, effort level, thinking budget, subagent model) so agents don't rely on training data cutoff
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

## Environment Variables

All configured in `ssot/.claude/settings.json` under the `env` block. The centerpiece strategy is **1M context + 45% auto-compact + xhigh effort + sonnet subagents** — maximizes usable context before compaction while keeping token cost sane. Tuned for Opus 4.7, which removed `budget_tokens` and makes adaptive thinking the only thinking-on mode.

### Context management

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `45` | Compacts at 45% of context window (~450K on 1M). Can only lower the threshold below the default (~83%), never raise it. Prevents context rot that begins near 400K. |
| (implicit) 1M context | enabled by default | `CLAUDE_CODE_DISABLE_1M_CONTEXT` is **not** set, so 1M is active on Max/Team/Enterprise plans for Opus 4.7. Note: 4.7 uses a new tokenizer that may consume up to 1.35× more tokens than 4.6 on the same text. |

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
- **Auto-compact triggering too early or not at all** — check `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. Values above ~83% are clamped to the default (the env var can only lower the threshold).
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

## Editing Commands

When modifying commands, keep in sync by re-running `./sync.sh`. The `ssot/.claude/` directory is the source of truth; `~/.claude/` is the deployed copy.

Before committing, run the validators:

```bash
bash guard-commands.sh   # structural checks (task tags, Success Criteria, Phase Transition Protocol for 3+ phases, WebFetch consistency)
bash score-commands.sh   # quality score across all commands
```
