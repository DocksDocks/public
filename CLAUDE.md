# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

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

All commands use multi-agent pipelines with Opus models. Most use a **Builder-Verifier pattern** (Builder creates output → Verifier runs concrete checks) for quality.

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

- **SessionStart**: Injects current date/time so agents don't rely on training data cutoff
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh

## Setup

```bash
# Clone
git clone <this-repo> ~/projects/public

# Sync commands (additive — won't delete commands from other sources)
rsync -a ~/projects/public/ssot/.claude/commands/ ~/.claude/commands/
cp ~/projects/public/alert_bubble.mp3 ~/.claude/

# Status line
cp ~/projects/public/ssot/.claude/statusline.sh ~/.claude/
cp ~/projects/public/ssot/.claude/fetch-usage.sh ~/.claude/
chmod +x ~/.claude/statusline.sh ~/.claude/fetch-usage.sh

# RTK (requires rtk binary — see "Install RTK" section)
rtk init --global

# Settings — merge ssot/.claude/settings.json into ~/.claude/settings.json

# Sync principle: add and update only, never delete.
# Tools like `rtk init -g` own their generated files at ~/.claude/
```

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

When modifying commands, keep in sync:

```bash
# After editing ssot/.claude/commands/*.md
rsync -a ssot/.claude/commands/ ~/.claude/commands/
```

The `ssot/.claude/` directory is the source of truth. `~/.claude/` is the deployed copy.
