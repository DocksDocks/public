# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (via `@AGENTS.md` import in `CLAUDE.md`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

## Repository purpose

Portable configuration kit for AI coding agents. Per-tool Single Source of Truth (SoT) directories get deployed to each tool's user-config location via `./docks-kit sync` — clone once, sync to your home directory, get a consistent AI-assisted dev environment everywhere. The kit focuses on **token efficiency without sacrificing quality**: every setting and hook is tuned to minimize token consumption while preserving rigorous output. When adding or editing anything, ask: *does this change reduce tokens without weakening correctness?*

Tool-specific instructions live alongside this file:
- **`CLAUDE.md`** — Claude Code SoT (`SoT/.claude/`), env vars, hooks, plugins, RTK, status line, session management, permission mode, open concerns.
- Codex uses this `AGENTS.md` file plus the Codex SoT under `SoT/.codex/`; no separate root `CODEX.md` is needed.

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `docks-kit` | CLI launcher: runs the compiled binary in `cli/dist/` when present, otherwise Bun-from-source (auto-installs Bun + `node_modules`). No-Bun recovery is the platform release binary |
| `cli/src/engine-native/` | EngineNative implementation for `sync`, `model`, and `toolchain`; idempotent, flag-gated for destructive reconciliation |
| `cli/` | Effect-TS CLI + bundled docs topics |
| `SoT/models.json` | Kit-verified model catalog |
| `SoT/toolchain.json` | Toolchain floors manifest (verified pins consumed by EngineNative) |
| `SoT/.claude/bin/` | Dependency-free Bun runtime programs for Claude's statusline, SessionStart, and Notification |
| `install.sh` | Global installer |
| `.github/workflows/release-cli.yml` | `cli-v*` release binaries + npm publish |
| `README.md` | Front door |
| `package.json` / `bun.lock` | npm package: `bin` = `cli/src/main.ts`; bundles `cli/` with the generated in-memory SoT payload |
| `SoT/.agents/skills.txt` | Universal-skill manifest. One [agentskills.io](https://agentskills.io) slug per line; EngineNative runs `npx skills add` for each missing entry into `~/.agents/skills/`, where Codex et al. discover it natively and Claude Code follows a symlink at `~/.claude/skills/` |
| `notification.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/plans/` | Multi-commit work-item plans (`active/` with status in frontmatter, plus `finished/` archive). Convention: `docs/plans/AGENTS.md` |
| `CLAUDE.md` | Claude-specific instructions; imports this `AGENTS.md` |
| `AGENTS.md` | This file — tool-agnostic instructions |

Codex SoT notes:
- `SoT/.codex/AGENTS.md` deploys to `~/.codex/AGENTS.md` as global Codex instructions.
- `SoT/.codex/config.toml` pins Codex to `model = "gpt-5.6-sol"`, sets reasoning effort/summaries (`xhigh` + `concise`), `model_verbosity = "low"`, `personality`, live top-level `web_search`, workspace-write sandboxing with sandboxed command network access, cross-session `memories` (+ dedicated note tools), `[agents]` subagent limits (`max_threads = 12`, `max_depth = 2` — intentionally above Codex defaults for broad parallel kit work; deeper recursion increases cost and predictability risk), a 128 KiB `project_doc_max_bytes` budget for the repo-side AGENTS.md chain (the global `~/.codex/AGENTS.md` is uncapped and not counted), and enables the Docks plugins as `docks@docks`, `session-relay@docks`, and `effect-kit@docks`.
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`; when the `codex` CLI is available, sync reruns `codex plugin add <plugin@marketplace>` for enabled SoT plugins so stale cached installs are refreshed.
- `docks-kit status` verifies Session Relay only through the supported `codex plugin list --json` inventory. `ready` means installed and enabled for a newly started Codex session; it is not evidence about an old process, lifecycle state, receive-path health, or worker quiescence. The global prompt SoTs carry the owner's standing authorization for Docks cross-company plan review, which never overrides host or platform denial.
- The `codex` CLI binary is upstream-owned, not kit-owned. The official standalone installer keeps package metadata under `$CODEX_HOME/packages/standalone` and places the `codex` symlink in `~/.local/bin` by default; sync only warns with a download-then-run installer command when the CLI is missing. Existing installs can self-update with `codex update`; npm and Homebrew remain upstream alternatives.
- `SoT/.codex/AGENTS.md` deliberately does not import `@RTK.md`: RTK's published Codex integration is prompt-file based rather than hook based, so importing it leaks implementation detail into agent-visible context. Use Codex hooks for RTK only after the kit installs a hook-backed Codex integration.
- Claude runtime settings are an authoring template with sentinels. `claudeRuntime.ts` materializes absolute Bun/script paths only after the shared `bun.ts` bootstrap is ready; `claudeSync.ts` writes all runtime assets before atomically committing settings, then prunes the legacy shell scripts and Stop hook. Native `rate_limits` is the sole quota source, so jq/curl/OAuth caches are not runtime dependencies. A missing Bun defers only this cutover and preserves legacy pointers/files.
- Claude's deployed SoT defaults are `model: fable` and `effortLevel: high`; `advisorModel` is deliberately absent/off. `--claude-advisor=on` is the per-machine opt-in and writes `advisorModel: fable` after the settings merge.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`), see the matching SoT directory.

## Engineering rules

- **Idempotent operations.** Every EngineNative sync step must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SoT changes is a no-op.
- **Removed bash engine.** The bash engine was removed after the `bash-engine-final` tag. `DOCKS_KIT_ENGINE=bash` must fail with the removed-engine message; engine bugs are fixed forward in EngineNative.
- **Targeted syncs.** `./docks-kit sync` accepts positional targets: `claude`, `codex`, and `agents`. Use the narrowest target that matches the SoT change (for example, `./docks-kit sync codex` for Codex-only config edits); targets can be combined with `--dry-run`, `--skip-rtk`, `--reconcile`, `--prune`, `--yes` (auto-accept toolchain prompts), and the deploy-time modifiers `--claude-compact-window=<tokens>` / `--claude-permissive` / `--claude-model=<m>` / `--claude-effort=<level>` / `--claude-advisor=<on|off|default>` / `--codex-model=<m>` / `--codex-effort=<level>` (see `CLAUDE.md` § Deploy-time modifiers).
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up. The one exception is the Claude `removed` manifest (`claude::_removed_manifest`), a curated list of unambiguous kit-owned artifacts that `claude::sync_removals` force-prunes on every sync; see `CLAUDE.md` § Pruning stale artifacts.
- **`--reconcile` / `--prune` are the kit-owned reconcile flags.** Orthogonal — `--reconcile` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--prune` uninstalls kit-managed installations not in the SoT (plugins, marketplaces, and `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills`). Combine for a full reset to SoT's kit-managed scope. User-only additions outside the kit's scope (custom env vars, mcpServers, manually-installed skills, third-party plugins not declared in SoT) are always preserved. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned modules.** `cli/src/engine-native/parseArgs.ts` owns flag parsing/validation. `toolchain.ts` owns the verified-version gate over `SoT/toolchain.json`; `bun.ts` owns the shared, memoized Bun bootstrap; `claudeRuntime.ts` owns Claude settings materialization. `claudeSync.ts`, `codexSync.ts`, and `skillsSync.ts` own tool-specific sync logic. `index.ts` is the thin orchestrator. The public CLI seam is `cli/src/engine.ts`.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split an engine/CLI change and a per-tool config change unless the change requires atomicity.
- **Dry-run before destructive flags.** Always preview with `./docks-kit sync --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--reconcile` or `--prune`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md` and `SoT/.codex/AGENTS.md` are loaded into every agent session's prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `CLAUDE.md` / `AGENTS.md` at the repo root (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: would removing it cause the agent to make mistakes? If not, cut it — over-instruction degrades adherence on current frontier models.
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, hook outputs that land in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages (e.g. SessionStart hook output), which is exactly how the kit's date/config injection works.

## Code style

- Bash: for launchers/installers/hook assets, use `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, and function-scoped `local`.
- JSON config: edit the SoT (`SoT/<tool>/`) and run `./docks-kit sync`. Never edit deployed config (`~/.claude/`, `~/.codex/`) directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external installers (RTK, plugin marketplaces) as untrusted input. Prefer download-then-run over `curl … | bash` — stream truncation has bitten this kit before (see `CLAUDE.md` § RTK).
- **Pin, never float.** Every kit-driven install is pinned to a `SoT/toolchain.json` `verified` version or gated by one — no `@latest` npm/bun installs (Shai-Hulud-class worm surface), no mutable action tags in workflows (commit SHAs only), installer scripts fetched from version tags where upstream supports it. New install surface ⇒ manifest pin first. Details: the `toolchain-context` skill and `cli/docs/toolchain.md`.

## Testing

Automated coverage includes `bun run test:unit`, `bun run golden:dryrun`, and `bun run golden:mutation`; prove-red modes must exit non-zero after detecting planted mismatches. Also verify user-facing changes via `./docks-kit sync --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from the per-tool file.

Use direct acceptance and focused regressions while iterating, then run the full unit/golden gate once at the pre-commit or release boundary. Reuse still-matching evidence; a later relevant edit invalidates only the affected rung and final gate, not every prior check.

## Skills

This project ships **kit-mechanic skills** under `.claude/skills/` — narrowly-scoped references for how EngineNative works (settings merge, plugin bootstrap, universal-skill install, Codex TOML merge, sync orchestration). They cost prompt tokens only inside this repo's sessions and document regression-prone TypeScript sync logic in `cli/src/engine-native/`. **Pipeline content** (multi-agent slash commands, refactor/security/docs workflows, parallel-scanner agents) belongs in the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin — not here. Project-level agents under `.claude/agents/` follow the same rule: kit-mechanic agents that wrap kit-mechanic skills are permitted; pipeline agents live in the docks plugin.

<constraint>
When a kit-mechanic skill, its `references/`, or a wrapper agent (`.claude/agents/*.md` + its `.codex/agents/*.toml` twin) cites EngineNative internals, name the **module + exported/local function + semantic anchor** (e.g. `claudeSync.ts syncPlugins, pass 5 uninstall guard`) — never a raw `file:NNN` line number, which goes stale on every refactor. Keep exactly one coarse `metadata.source_files[].lines` range per skill file as the sole intentional line-number touchpoint.
</constraint>

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` declares [agentskills.io](https://agentskills.io/specification) slugs the kit installs to `~/.agents/skills/` on every machine via `skillsSync.ts`. The bootstrap invokes `npx skills add <slug> -g -y -a claude-code codex` per missing skill — `<slug>` comes first because the CLI's `-a/--agent` flag is variadic and would otherwise swallow it. Naming **both** agents (`claude-code` + `codex`, the kit's support matrix) keeps the CLI in multi-agent mode: it writes the canonical `SKILL.md` to the universal `~/.agents/skills/<name>/` path — which Codex reads natively (per [OpenAI's Codex docs](https://developers.openai.com/codex/skills/), `$HOME/.agents/skills` is a user-level skill source) — and symlinks `~/.claude/skills/<name>` → it for Claude Code, which wants its own per-tool directory. A *single* `-a claude-code` would instead trigger a copy-direct shortcut (a real copy into `~/.claude/skills/`, no canonical path, Codex uncovered); `-a '*'` would over-reach into every AI tool the CLI can detect (~50). Add a new universal skill by appending one `<owner>/<repo>` line to `skills.txt` and re-running `./docks-kit sync` — idempotent: existing skills are skipped after checking `~/.agents/skills/<name>`. Skills that depend on a separate CLI binary get an explicit auto-install helper in `skillsSync.ts` (e.g. `syncAgentBrowserCli` runs `npm install -g agent-browser` + `agent-browser install --with-deps` on Linux; the `--with-deps` flag may prompt for sudo to install system libs). That helper also **self-upgrades** a present-but-stale binary: when `agent-browser`'s installed version is older than npm's `latest` it re-runs `npm install -g agent-browser` (the numeric-sort compare never downgrades a locally-newer pre-release, and skips silently when npm is absent/offline); the Chrome download is not repeated on upgrade. A second helper, `syncEffectSolutionsCli`, installs the optional `effect-solutions` Effect-docs CLI used by the `effect-kit` plugin. It calls the shared `bun.ts` `bunBootstrap` when needed, then symlinks **both** `bun` and the CLI into `~/.local/bin`. Linking Bun too is mandatory — the CLI's `#!/usr/bin/env bun` shebang needs it on PATH at run time — and `~/.local/bin` is the only dir reliably on the *non-interactive* agent PATH, since `~/.bashrc`'s "if not interactive, return" guard means rc PATH edits never reach agent shells (the same PATH reason the official Codex standalone installer targets `~/.local/bin`).

## Plans

<constraint>
Multi-commit work plans live in `docs/plans/active/` (status is a frontmatter field) and `docs/plans/finished/` (archive). Every plan file is a complete handoff document — `goal`, `Steps`, `Acceptance criteria`, `Review` — so any agent can pick one up cold. Skills handle every operation: `plan-init` (bootstrap/migrate), `plan-manager` (list/show/start/block/ship/new, auto-commit on transition, self-review on draft), `plan-review` (verification). Trigger by natural language or the matching `plan-*` skill. `active/` is multi-occupancy.
</constraint>

The full convention (frontmatter schema, body sections, self-review loop, open-questions, age tokens) lives in `docs/plans/AGENTS.md`. `docs/plans/CLAUDE.md` is a one-line `@AGENTS.md` import for Claude Code's nested discovery.

Distinct from per-tool **Open Concerns** sections (wait-on-upstream
blockers tied to a vendor shipping a fix — these live inside the per-tool
file): plans are kit-internal work we control; Open Concerns is
conditions-for-resolution.

Plugin-internal work (skills, commands, agents) belongs in each plugin's
own repo, not here.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.
