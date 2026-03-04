# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

## Repository Structure

| Path | Purpose |
|------|---------|
| `.claude/CLAUDE.md` | Coding standards and conventions (loaded into every session) |
| `.claude/settings.json` | Permissions, hooks, plugins, token limits |
| `.claude/commands/*.md` | 6 custom slash commands (see below) |
| `alert_bubble.mp3` | Audio notification for Stop/Notification hooks |

## Custom Commands

All commands use multi-agent pipelines with Opus models. Most use a **Devil's Advocate committee pattern** (Proposer → Critic → Synthesizer) for quality.

| Command | Pipeline | Pattern |
|---------|----------|---------|
| `/security` | Discovery → [Scanner \| Analyzer \| Hunter] → Synthesizer | DAG fan-out/fan-in |
| `/fix` | Exploration → [Code Quality \| Dependency] → Committee → Implement | DAG + Committee |
| `/review` | Exploration → Committee → Implement | Committee |
| `/test` | Exploration → Committee → Implement | Committee |
| `/docs` | Exploration → Analysis → Committee → Implement | Committee |
| `/solid` | Exploration → Discovery → Analysis → Committee → Implement | Committee |

Commands with parallel phases (`/security`, `/fix`) include explicit instructions to launch agents in a single turn for wall-clock time savings.

All commands except `/security` enforce **Plan Mode** — read-only analysis first, user approval gate, then implementation.

## Hooks

- **SessionStart**: Injects current date/time so agents don't rely on training data cutoff
- **Stop / Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes

## Setup

```bash
# Clone
git clone <this-repo> ~/projects/public

# Sync to user config
cp -r ~/projects/public/.claude/commands/ ~/.claude/commands/
cp ~/projects/public/alert_bubble.mp3 ~/.claude/

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
