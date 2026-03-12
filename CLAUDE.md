# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

## Repository Structure

| Path | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | Coding standards and conventions (loaded into every session) |
| `.claude/settings.json` | Permissions, hooks, plugins, token limits |
| `.claude/commands/*.md` | 8 custom slash commands (see below) |
| `.claude/RTK.md` | RTK reference (meta commands, verification) |
| `.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |
| `alert_bubble.mp3` | Audio notification for Notification hook |

## Custom Commands

All commands use multi-agent pipelines with Opus models. Most use a **Devil's Advocate committee pattern** (Proposer → Critic → Synthesizer) for quality.

| Command | Pipeline | Pattern |
|---------|----------|---------|
| `/security` | Discovery → [Scanner \| Analyzer \| Hunter] → Synthesizer | DAG fan-out/fan-in |
| `/fix` | Exploration → [Code Quality \| Dependency] → Committee → Implement | DAG + Committee |
| `/review` | Exploration → Committee → Implement | Committee |
| `/test` | Exploration → Committee → Implement | Committee |
| `/docs` | Detection → Exploration → [Categorizer \| Scanner] → Committee → Implement | DAG + Committee |
| `/human-docs` | Exploration → Analysis → Committee → Implement | Committee |
| `/solid` | Exploration → Discovery → Analysis → Committee → Implement | Committee |
| `/team` | Discovery → [Role Mapper \| Pattern Extractor] → Committee → Implement | DAG + Committee |

Commands with parallel phases (`/security`, `/fix`, `/docs`, `/team`) include explicit instructions to launch agents in a single turn for wall-clock time savings.

All commands except `/security` enforce **Plan Mode** — read-only analysis first, user approval gate, then implementation.

## RTK (Rust Token Killer)

Token-optimized CLI proxy that reduces LLM token consumption by 60-90%. A PreToolUse hook transparently rewrites Bash commands (e.g., `git status` → `rtk git status`) so output is compressed before it reaches the context window.

| File | Purpose |
|------|---------|
| `.claude/RTK.md` | RTK reference for Claude (meta commands, verification) |

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

# 4. Copy RTK docs for Claude
cp .claude/RTK.md ~/.claude/RTK.md

# 5. Add "Bash(rtk:*)" to permissions.allow in ~/.claude/settings.json

# 6. Verify
rtk --version        # Should print version
rtk ls .             # Should show compressed output
rtk gain             # Should show tracking is active

# 7. Restart Claude Code for the hook to take effect
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

# Sync to user config
cp -r ~/projects/public/.claude/commands/ ~/.claude/commands/
cp ~/projects/public/alert_bubble.mp3 ~/.claude/

# Status line
cp ~/projects/public/.claude/statusline.sh ~/.claude/
cp ~/projects/public/.claude/fetch-usage.sh ~/.claude/
chmod +x ~/.claude/statusline.sh ~/.claude/fetch-usage.sh

# RTK (requires rtk binary — see "Install RTK" section)
rtk init --global
cp ~/projects/public/.claude/RTK.md ~/.claude/

# Settings are project-level (.claude/settings.json) — they apply
# automatically when Claude Code runs inside this repo. To use them
# globally, merge into ~/.claude/settings.json.
```

## Editing Commands

When modifying commands, keep in sync:

```bash
# After editing .claude/commands/*.md
cp .claude/commands/*.md ~/.claude/commands/
```

The repo is the source of truth. `~/.claude/commands/` is the deployed copy.
