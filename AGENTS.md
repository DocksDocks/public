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
- `SoT/.codex/config.toml` sets Codex approval/sandbox defaults, reasoning effort/summaries (`xhigh` + `detailed`), `model_verbosity = "medium"` (Codex ships gpt-5.5 at `low`; medium restores the API default), `personality`, live `web_search` (the top-level enum key — `[tools] web_search = true` booleans are silently discarded by Codex ≥0.130), cross-session `memories` (+ dedicated note tools), `[agents]` subagent limits (`max_threads = 12`, `max_depth = 2` — do not combine with `multi_agent_v2`, which hard-conflicts with `max_threads`), a 64 KiB `project_doc_max_bytes` budget for the repo-side AGENTS.md chain (the global `~/.codex/AGENTS.md` is uncapped and not counted), and enables the Docks plugin as `docks@docks`.
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`; when the `codex` CLI is available, sync reruns `codex plugin add <plugin@marketplace>` for enabled SoT plugins so stale cached installs are refreshed.
- `SoT/.codex/bin/codex` deploys to `~/.local/bin/codex` as a launcher for npm/NVM Codex installs in non-interactive shells.
- `SoT/.codex/AGENTS.md` deliberately does not import `@RTK.md`: RTK's published Codex integration is prompt-file based rather than hook based, so importing it leaks implementation detail into agent-visible context. Use Codex hooks for RTK only after the kit installs a hook-backed Codex integration.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`), see the matching SoT directory.

## Engineering rules

- **Idempotent operations.** Every step in `sync.sh` and `lib/*.sh` must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SoT changes is a no-op.
- **Targeted syncs.** `sync.sh` accepts per-CLI target flags: `--claude`, `--codex`, and `--agents`. Use the narrowest target that matches the SoT change (for example, `./sync.sh --codex` for Codex-only config edits); target flags can be combined with `--dry-run`, `--no-rtk`, `--force`, `--remove-plugins`, and the Claude-only deploy-time modifiers `--680k` / `--permissive` (see `CLAUDE.md` § Deploy-time modifiers).
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up. The one exception is the Claude `removed` manifest (`claude::_removed_manifest`), a curated list of unambiguous kit-owned artifacts that `claude::sync_removals` force-prunes on every sync; see `CLAUDE.md` § Pruning stale artifacts.
- **`--force` / `--remove-plugins` are the kit-owned reconcile flags.** Orthogonal — `--force` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--remove-plugins` uninstalls kit-managed installations not in the SoT (plugins, marketplaces, and `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills`). Combine for a full reset to SoT's kit-managed scope. User-only additions outside the kit's scope (custom env vars, mcpServers, manually-installed skills, third-party plugins not declared in SoT) are always preserved. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned libraries.** `lib/common.sh` owns shared primitives. Each `lib/<tool>.sh` owns the tool-specific bootstrap (CLI install, plugin install passes, marketplace add). Main `sync.sh` is a thin orchestrator: source common → detect SoTs → dispatch.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split a `sync.sh` change and a per-tool config change unless the change requires atomicity.
- **Dry-run before destructive flags.** Always preview with `./sync.sh --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--force` or `--remove-plugins`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md` and `SoT/.codex/AGENTS.md` are loaded into every agent session's prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `CLAUDE.md` / `AGENTS.md` at the repo root (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: would removing it cause the agent to make mistakes? If not, cut it — over-instruction degrades adherence on current frontier models.
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, hook outputs that land in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages (e.g. SessionStart hook output), which is exactly how the kit's date/config injection works.

## Code style

- Bash: `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, function-scoped `local`. Match `sync.sh`.
- JSON config: edit the SoT (`SoT/<tool>/`) and run `sync.sh`. Never edit deployed config (`~/.claude/`, `~/.codex/`) directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external installers (RTK, plugin marketplaces) as untrusted input. Prefer download-then-run over `curl … | bash` — stream truncation has bitten this kit before (see `CLAUDE.md` § RTK).

## Testing

No automated tests yet. Verify changes via `./sync.sh --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from the per-tool file. Shell-script tests are tracked in `docs/plans/`.

## Skills

This project ships **kit-mechanic skills** under `.claude/skills/` — narrowly-scoped references for how `sync.sh` itself works (settings merge, plugin bootstrap, universal-skill install, Codex TOML merge, sync orchestration). They cost prompt tokens only inside this repo's sessions and document regression-prone bash/awk/jq logic in `lib/*.sh`. **Pipeline content** (multi-agent slash commands, refactor/security/docs workflows, parallel-scanner agents) belongs in the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin — not here. Project-level agents under `.claude/agents/` follow the same rule: kit-mechanic agents that wrap kit-mechanic skills are permitted; pipeline agents live in the docks plugin.

<constraint>
When a kit-mechanic skill, its `references/`, or a wrapper agent (`.claude/agents/*.md` + its `.codex/agents/*.toml` twin) cites `lib/*.sh` / `sync.sh` internals, name the **enclosing function + a semantic anchor** (e.g. `claude::_plugins_uninstall, the has($n) guard`) — never a raw `file:NNN` line number, which goes stale on every refactor. Keep exactly one coarse `metadata.source_files[].lines` range per skill file as the sole intentional line-number touchpoint.
</constraint>

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` declares [agentskills.io](https://agentskills.io/specification) slugs the kit installs to `~/.agents/skills/` on every machine via `lib/skills.sh`. The bootstrap invokes `npx skills add <slug> -g -y -a claude-code codex` per missing skill — `<slug>` comes first because the CLI's `-a/--agent` flag is variadic and would otherwise swallow it. Naming **both** agents (`claude-code` + `codex`, the kit's support matrix) keeps the CLI in multi-agent mode: it writes the canonical `SKILL.md` to the universal `~/.agents/skills/<name>/` path — which Codex reads natively (per [OpenAI's Codex docs](https://developers.openai.com/codex/skills/), `$HOME/.agents/skills` is a user-level skill source) — and symlinks `~/.claude/skills/<name>` → it for Claude Code, which wants its own per-tool directory. A *single* `-a claude-code` would instead trigger a copy-direct shortcut (a real copy into `~/.claude/skills/`, no canonical path, Codex uncovered); `-a '*'` would over-reach into every AI tool the CLI can detect (~50). Add a new universal skill by appending one `<owner>/<repo>` line to `skills.txt` and re-running `./sync.sh` — idempotent: existing skills are skipped (`lib/skills.sh` pre-checks `~/.agents/skills/<name>`). Skills that depend on a separate CLI binary get an explicit auto-install helper in `lib/skills.sh` (e.g. `skills::sync_agent_browser_cli` runs `npm install -g agent-browser` + `agent-browser install --with-deps` on Linux; the `--with-deps` flag may prompt for sudo to install system libs). That helper also **self-upgrades** a present-but-stale binary: when `agent-browser`'s installed version is older than npm's `latest` it re-runs `npm install -g agent-browser` (the `skills::_agent_browser_newer_npm` numeric-sort compare never downgrades a locally-newer pre-release, and skips silently when npm is absent/offline); the Chrome download is not repeated on upgrade. A second such helper, `skills::sync_effect_solutions_cli`, installs the optional `effect-solutions` Effect-docs CLI used by the `effect-kit` plugin: gated on `effect-kit` being enabled in SoT, it auto-installs Bun when absent (download-then-run, never `curl | bash`) and symlinks **both** `bun` and the CLI into `~/.local/bin`. Linking bun too is mandatory — the CLI's `#!/usr/bin/env bun` shebang needs `bun` on PATH at run time — and `~/.local/bin` is the only dir reliably on the *non-interactive* agent PATH, since `~/.bashrc`'s "if not interactive, return" guard means rc PATH edits never reach agent shells (the same reason the Codex launcher lands there).

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
