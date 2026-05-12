# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (via `@AGENTS.md` import in `CLAUDE.md`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

## Repository purpose

Portable configuration kit for AI coding agents. Per-tool Single Source of Truth (SoT) directories get deployed to each tool's user-config location via `sync.sh` — clone once, sync to your home directory, get a consistent AI-assisted dev environment everywhere. The kit focuses on **token efficiency without sacrificing quality**: every setting and hook is tuned to minimize token consumption while preserving rigorous output. When adding or editing anything, ask: *does this change reduce tokens without weakening correctness?*

Tool-specific instructions live alongside this file:
- **`CLAUDE.md`** — Claude Code SoT (`SoT/.claude/`), env vars, hooks, plugins, RTK, status line, session management, permission mode, open concerns.
- Codex uses this `AGENTS.md` file plus the Codex SoT under `SoT/.codex/`; no separate root `CODEX.md` is needed.

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `sync.sh` | Multi-tool deploy script. Detects which SoT directories exist and dispatches per-tool sync. Idempotent; flag-gated for destructive reconciliation |
| `lib/` | Shared sync helpers — `common.sh` for argument parsing/preflight, plus per-tool `claude.sh` / `codex.sh` / `skills.sh` sync implementations |
| `SoT/.agents/skills.txt` | Universal-skill manifest. One [agentskills.io](https://agentskills.io) slug per line; `lib/skills.sh` runs `npx skills add` for each missing entry into `~/.agents/skills/`, where Codex et al. discover it natively and Claude Code follows a symlink at `~/.claude/skills/` |
| `alert_bubble.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/plans/` | Multi-commit work-item plans (`planned/` → `ongoing/` → `blocked/` / `scheduled/` / `finished/`). Convention: `docs/plans/AGENTS.md` |
| `CLAUDE.md` | Claude-specific instructions; imports this `AGENTS.md` |
| `AGENTS.md` | This file — tool-agnostic instructions |

Codex SoT notes:
- `SoT/.codex/AGENTS.md` deploys to `~/.codex/AGENTS.md` as global Codex instructions.
- `SoT/.codex/config.toml` sets Codex approval/sandbox defaults and enables the Docks plugin as `docks@docks`.
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`.
- `SoT/.codex/bin/codex` deploys to `~/.local/bin/codex` as a launcher for npm/NVM Codex installs in non-interactive shells.
- `SoT/.codex/AGENTS.md` imports `@RTK.md`; `sync.sh` lets `rtk init -g --codex` generate `~/.codex/RTK.md`, then restores the SoT-managed `AGENTS.md` so RTK owns only generated RTK content.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`), see the matching SoT directory.

## Engineering rules

- **Idempotent operations.** Every step in `sync.sh` and `lib/*.sh` must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SoT changes is a no-op.
- **Targeted syncs.** `sync.sh` accepts per-CLI target flags: `--claude`, `--codex`, and `--agents`. Use the narrowest target that matches the SoT change (for example, `./sync.sh --codex` for Codex-only config edits); target flags can be combined with `--dry-run`, `--no-rtk`, `--force`, and `--remove-plugins`.
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up.
- **`--force` / `--remove-plugins` are the kit-owned reconcile flags.** Orthogonal — `--force` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--remove-plugins` uninstalls kit-managed installations not in the SoT (plugins, marketplaces, and `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills`). Combine for a full reset to SoT's kit-managed scope. User-only additions outside the kit's scope (custom env vars, mcpServers, manually-installed skills, third-party plugins not declared in SoT) are always preserved. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned libraries.** `lib/common.sh` owns shared primitives. Each `lib/<tool>.sh` owns the tool-specific bootstrap (CLI install, plugin install passes, marketplace add). Main `sync.sh` is a thin orchestrator: source common → detect SoTs → dispatch.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split a `sync.sh` change and a per-tool config change unless the change requires atomicity.
- **Dry-run before destructive flags.** Always preview with `./sync.sh --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--force` or `--remove-plugins`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md` and `SoT/.codex/AGENTS.md` are loaded into every agent session's prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `CLAUDE.md` / `AGENTS.md` at the repo root (humans read once) or in commit messages — never in the SoT.

## Code style

- Bash: `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, function-scoped `local`. Match `sync.sh`.
- JSON config: edit the SoT (`SoT/<tool>/`) and run `sync.sh`. Never edit deployed config (`~/.claude/`, `~/.codex/`) directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external installers (RTK, plugin marketplaces) as untrusted input. Prefer download-then-run over `curl … | bash` — stream truncation has bitten this kit before (see `CLAUDE.md` § RTK).

## Testing

No automated tests yet. Verify changes via `./sync.sh --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from the per-tool file. Shell-script tests are tracked in `docs/plans/`.

## Skills

This project does not ship project-level skills. The multi-agent pipeline ships as the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin.

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` declares [agentskills.io](https://agentskills.io/specification) slugs the kit installs to `~/.agents/skills/` on every machine via `lib/skills.sh`. The bootstrap invokes `npx skills add -g -y -a claude-code <slug>` per missing skill, which writes the canonical SKILL.md at the universal path (Codex reads this natively, no per-tool symlink needed) and creates the `~/.claude/skills/<name>` symlink for Claude Code (which still wants its own per-tool directory). We pass `-a claude-code` rather than `-a '*'` so the install scope matches the kit's actual support matrix — other AI tools the user happens to have installed are not touched. Add a new universal skill by appending one `<owner>/<repo>` line to `skills.txt` and re-running `./sync.sh` — idempotent: existing skills are skipped. Skills that depend on a separate CLI binary get an explicit auto-install helper in `lib/skills.sh` (e.g. `skills::sync_agent_browser_cli` runs `npm install -g agent-browser` + `agent-browser install --with-deps` on Linux; the `--with-deps` flag may prompt for sudo to install system libs).

## Plans

Multi-commit work plans live in `docs/plans/` and move between `planned/` →
`ongoing/` → `finished/` via `git mv` so history is preserved. Plans that
stall on an external dependency go to `blocked/`; plans queued for time-
triggered auto-execution go to `scheduled/`. Every category is
multi-occupancy — multiple plans can live in any directory at once. See
`docs/plans/AGENTS.md` for the full convention (`docs/plans/CLAUDE.md` is
a one-line `@AGENTS.md` shim for Claude Code's nested-directory discovery). The `plan-manager` agent
(`/docks:plan`) reads plans, evaluates schedule triggers, and dispatches to
the assignee agent named in each plan's frontmatter.

Distinct from per-tool **Open Concerns** sections (wait-on-upstream
blockers tied to a vendor shipping a fix — these live inside the per-tool
file): plans are kit-internal work we control; Open Concerns is
conditions-for-resolution.

Plugin-internal work (skills, commands, agents) belongs in each plugin's
own repo, not here.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.
