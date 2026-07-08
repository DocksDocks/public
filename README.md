# docks-kit

Portable configuration kit for AI coding agents. Per-tool **Single Source of
Truth (SoT)** directories are deployed to each tool's user-config location —
clone once, sync everywhere, get a consistent AI-assisted dev environment on
every machine. Tuned for **token efficiency without sacrificing quality**.

Supported tools: **Claude Code**, **Codex**, and any agent consuming
[agentskills.io](https://agentskills.io) universal skills.

## Quick start

```bash
git clone https://github.com/DocksDocks/public.git ~/projects/public
cd ~/projects/public
./docks-kit sync            # deploy everything (Claude Code + Codex + skills)
./docks-kit status          # doctor view: drift, toolchain, plugins, skills
```

The `./docks-kit` launcher prefers a compiled binary (`cli/dist/`), then runs
from source via Bun — auto-installing Bun and dependencies when missing.

Other install paths (global `bun add -g docks-kit`, curl installer) —
see `./docks-kit docs install`.

**Zero-dependency escape hatch** (no Bun, constrained sandboxes):

```bash
bash lib/engine.sh sync [targets] [flags]    # same flags as the CLI
```

Prerequisites: `bash`, `jq`, `curl` (Node/npm for npm-global tools).

## CLI

```text
docks-kit sync [claude] [codex] [agents]   deploy the SoT (default: all three)
docks-kit model <claude|codex> [value]     get/set the DEPLOYED model (TTY picker)
docks-kit models [tool] [--json]           kit-verified model catalog
docks-kit toolchain [check|ensure <tool>]  verified-version floors for external tools
docks-kit status [--json]                  deployed-vs-SoT drift + toolchain + counts
docks-kit plugins list [--json]            enabledPlugins tri-state vs installed
docks-kit skills list [--json]             universal skills vs manifest
docks-kit docs [topic]                     self-documentation (9 topics)
--help --version --wizard --completions    built-in
```

The CLI is a typed front-end ([Effect-TS](https://effect.website) on Bun);
**all mutation runs through the bash engine** (`lib/*.sh`) — battle-tested,
idempotent, independently usable.

### Key flags (`docks-kit sync`)

| Flag | Effect |
|------|--------|
| `--dry-run` | Preview without applying |
| `--reconcile` | Reconcile kit-owned settings toward SoT (user-only keys preserved) |
| `--prune` | Uninstall kit-managed plugins/marketplaces/skills not in SoT |
| `--claude-model=<m>` | Deploy-time modifier: deployed Claude model |
| `--claude-compact-window=<n>` | Deploy-time modifier: autocompact window (`680k`) |
| `--claude-permissive` | Deploy-time modifier: empty ask/deny (sandboxes only) |
| `--claude-plugin=<name>` | Sticky opt-in plugin (supabase, n8n) |
| `--codex-model=<m>` | Deploy-time modifier: deployed Codex model |
| `--skip-rtk` | Skip optional tool bootstrap |
| `--yes` | Auto-accept toolchain prompts (CI/containers) |

**Deploy-time modifiers** change deployed config only — the SoT is untouched
and a later flag-less sync reverts them. Full reference: `docks-kit docs flags`
(includes the old→new rename table for the pre-CLI `sync.sh` flags).

## How syncing works

- **Additive by default** — user-only settings keys, plugins, and skills
  survive a plain sync. Reconciliation toward the SoT is explicit
  (`--reconcile` / `--prune`).
- **Idempotent** — every step is safe to re-run; no-change syncs are no-ops.
- **Toolchain floors** — external tools (RTK, bun, agent-browser,
  effect-solutions, …) install/upgrade against `SoT/toolchain.json`:
  versions above the kit-verified pin prompt before installing
  (`--yes` accepts; non-TTY falls back to the pinned verified version
  when possible). `docks-kit toolchain check` shows the full table.
- **Model catalog** — `SoT/models.json` is the research-verified source for
  model validation, listings, and pickers.

## Repository map

| Path | Purpose |
|------|---------|
| `SoT/.claude/` | Claude Code SoT (settings, hooks, status line, CLAUDE.md) |
| `SoT/.codex/` | Codex SoT (config.toml, rules, AGENTS.md, marketplace) |
| `SoT/.agents/` | Universal-skill manifest |
| `SoT/models.json` | Kit-verified model catalog |
| `SoT/toolchain.json` | Verified-version floors |
| `lib/` | Bash engine: `common`, `toolchain`, `claude`, `codex`, `skills`, `engine` |
| `cli/` | docks-kit CLI (Effect-TS on Bun) + bundled docs topics |
| `docks-kit` | Launcher (binary → bun-from-source) |
| `install.sh` | Global installer (Bun bootstrap + `bun add -g`) |
| `docs/plans/` | Multi-commit work-item plans |
| `AGENTS.md` / `CLAUDE.md` | Agent-facing engineering rules / Claude Code specifics |

## Platform support

| Platform | CLI | Sync engine |
|----------|-----|-------------|
| Linux | ✅ native | ✅ native |
| macOS (x64/arm64) | ✅ native | ✅ native |
| Windows | ✅ native binary | ⚠️ experimental via Git Bash today; native TS engine (EngineNative) in progress — RTK hooks are already native (rtk ≥0.37.2) |

Details: `docks-kit docs platforms`.

## Releases

Tagging `cli-v*` builds five standalone binaries (+ SHA256SUMS) and attaches
them to the GitHub release; npm publish runs when the `NPM_TOKEN` secret is
configured. Package bundles the engine + SoT, so npm releases are versioned
config snapshots.

## Deeper docs

- `docks-kit docs <topic>` — overview, sync-layers, flags, modifiers, models,
  toolchain, plugins, install, platforms (works offline, bundled with the CLI)
- [`AGENTS.md`](AGENTS.md) — engineering rules for agents working on the kit
- [`CLAUDE.md`](CLAUDE.md) — Claude Code specifics: env vars, session
  management, permission mode, open concerns
