# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (via `@AGENTS.md` import in `CLAUDE.md`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

## Repository purpose

Portable configuration kit for AI coding agents. Per-tool Single Source of Truth (SSOT) directories get deployed to each tool's user-config location via `sync.sh` — clone once, sync to your home directory, get a consistent AI-assisted dev environment everywhere. The kit focuses on **token efficiency without sacrificing quality**: every setting and hook is tuned to minimize token consumption while preserving rigorous output. When adding or editing anything, ask: *does this change reduce tokens without weakening correctness?*

Tool-specific instructions live alongside this file:
- **`CLAUDE.md`** — Claude Code SSOT (`SoT/.claude/`), env vars, hooks, plugins, RTK, status line, session management, permission mode, open concerns.
- **`CODEX.md`** (planned) — Codex SSOT (`SoT/.codex/`), CLI options, agent-config equivalents.

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `sync.sh` | Multi-tool deploy script. Detects which SSOT directories exist and dispatches per-tool sync. Idempotent; flag-gated for destructive reconciliation |
| `lib/` (planned) | Shared sync helpers — `common.sh` (jq merges, deep-merge primitives) plus per-tool `claude.sh` / `codex.sh`. See `docs/plans/` |
| `alert_bubble.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/plans/` | Multi-commit work-item plans (`planned/` → `ongoing/` → `blocked/` / `scheduled/` / `finished/`). Convention: `docs/plans/AGENTS.md` |
| `CLAUDE.md` / `CODEX.md` (planned) | Per-tool instructions; both import this `AGENTS.md` |
| `AGENTS.md` | This file — tool-agnostic instructions |

For per-tool SSOT layouts (`SoT/.claude/`, future `SoT/.codex/`), see the matching per-tool file.

## Engineering rules

- **Idempotent operations.** Every step in `sync.sh` (and future `lib/*.sh`) must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SSOT changes is a no-op.
- **Additive by default.** Keys present in deployed config but absent from SSOT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up.
- **`--force` / `--remove-plugins` are the reconcile flags.** Orthogonal — `--force` wholesale-replaces the settings layer, `--remove-plugins` uninstalls plugins/marketplaces missing from SSOT. Combine for a full reset to SSOT. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned libraries** (planned, see roadmap). `lib/common.sh` owns shared primitives. Each `lib/<tool>.sh` owns the tool-specific bootstrap (CLI install, plugin install passes, marketplace add). Main `sync.sh` becomes a thin orchestrator: source common → detect SSOTs → dispatch.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split a `sync.sh` change and a per-tool config change unless the change requires atomicity.
- **Dry-run before destructive flags.** Always preview with `./sync.sh --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--force` or `--remove-plugins`. User-added permissions / env vars / plugins absent from SSOT will be discarded.

## Code style

- Bash: `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, function-scoped `local`. Match `sync.sh`.
- JSON config: edit the SSOT (`SoT/<tool>/`) and run `sync.sh`. Never edit deployed config (`~/.claude/`, future `~/.codex/`) directly.

## Security

- No secrets in SSOT. The kit's SSOT directories are committed; treat them as declarative config only.
- Treat external installers (RTK, plugin marketplaces) as untrusted input. Prefer download-then-run over `curl … | bash` — stream truncation has bitten this kit before (see `CLAUDE.md` § RTK).

## Testing

No automated tests yet. Verify changes via `./sync.sh --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), and `diff <(jq -S . <SSOT>) <(jq -S . <deployed>)` recipes from the per-tool file. Shell-script tests are tracked in `docs/plans/`.

## Skills

This project does not currently ship project-level skills. The multi-agent pipeline ships as the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin. If project-level skills are added, they will live under `.agents/skills/` per [agentskills.io](https://agentskills.io/specification) — symlinked from each tool's native path (`.claude/skills/`, etc.).

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

The pre-existing `docs/roadmap/` directory was the older convention; its
entries have been migrated to `docs/plans/` (2026-05-11). The
`docs/roadmap/CLAUDE.md` convention doc remains as a historical artifact
and can be removed once you're confident nothing else references it.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.
