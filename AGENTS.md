# AGENTS.md

Canonical instructions for coding agents working on this project. Compatible with OpenAI Codex, Claude Code (via `@AGENTS.md` import in `CLAUDE.md`), OpenCode, VS Code Copilot, and any other [agents.md](https://agents.md/)-aware tool.

## Repository purpose

Portable configuration kit for AI coding agents. Per-tool Single Source of Truth
(SoT) directories deploy to each tool's user-config location through
`./docks-kit sync`. Clone once to get a consistent AI-assisted environment on
supported Linux, macOS, and Windows hosts. The kit focuses on **token efficiency
without sacrificing quality**. Every setting and hook minimizes token use while
preserving rigorous output. When you add or edit anything, ask: *does this
change reduce tokens without weakening correctness?*

Tool-specific instructions live alongside this file:
- **`CLAUDE.md`** — Claude Code SoT (`SoT/.claude/`), env vars, hooks, plugins, status line, session management, permission mode, open concerns.
- Codex uses this `AGENTS.md` file plus the Codex SoT under `SoT/.codex/`; no separate root `CODEX.md` is needed.


docks-kit runtime and standalone binary support covers Linux x64/arm64, macOS
x64/arm64, and Windows x64/arm64. Hosts outside this matrix fail before either
launcher can fall back to Bun source.

## Repository layout (cross-cutting)

| Path | Purpose |
|------|---------|
| `docks-kit` / `docks-kit.ps1` | POSIX and Windows CLI launchers. On supported hosts, each runs the matching binary in `cli/dist/` only when its `--version` matches `package.json`. Otherwise it runs Bun-from-source and auto-installs Bun plus `node_modules`. Hosts outside the support matrix fail before source fallback. The standalone platform release binary provides no-Bun recovery. |
| `cli/src/engine-native/` | EngineNative implementation for `sync`, `model`, and `toolchain`; idempotent, flag-gated for destructive reconciliation |
| `cli/` | Effect 4 RC CLI + bundled docs topics |
| `SoT/models.json` | Kit-verified Claude and Codex model catalog |
| `SoT/toolchain.json` | Toolchain floors manifest (verified pins consumed by EngineNative) |
| `SoT/.claude/bin/` | Dependency-free Bun runtime programs for Claude's statusline, SessionStart, and Notification |
| `install.sh` / `install.ps1` | POSIX and Windows global installers |
| `.github/workflows/release-cli.yml` | `cli-v*` release: six binaries for Linux, macOS, and Windows on x64 and arm64, plus `SHA256SUMS` and npm publish |
| `README.md` | Front door |
| `package.json` / `bun.lock` | npm package: `bin` = `cli/src/main.ts`; bundles `cli/` with the generated in-memory SoT payload |
| `SoT/.agents/skills.txt` | Universal-skill manifest, intentionally empty by default. Adding an [agentskills.io](https://agentskills.io/specification) slug opts it into EngineNative's shared `~/.agents/skills/` bootstrap and Claude symlink. |
| `notification.mp3` | Audio asset for Notification hooks (consumed by Claude Code today; tool-agnostic file) |
| `docs/plans/` | Multi-commit work-item plans (`active/` with status in frontmatter, plus `finished/` archive). Convention: `docs/plans/AGENTS.md` |
| `CLAUDE.md` | Claude-specific instructions; imports this `AGENTS.md` |
| `AGENTS.md` | This file — tool-agnostic instructions |

Codex SoT notes:
- `SoT/.codex/AGENTS.md` deploys to `~/.codex/AGENTS.md` as global Codex instructions.
- `SoT/.codex/config.toml` pins Codex to `model = "gpt-5.6-sol"`, sets normal and plan reasoning to `high` with concise summaries, and sets `model_verbosity = "low"`, `personality`, live top-level `web_search`, workspace-write sandboxing with sandboxed command network access, cross-session `memories` (+ dedicated note tools), `[agents]` subagent limits (`max_threads = 12`, `max_depth = 2` — intentionally above Codex defaults for broad parallel kit work; deeper recursion increases cost and predictability risk), a 128 KiB `project_doc_max_bytes` budget for the repo-side AGENTS.md chain (the global `~/.codex/AGENTS.md` is uncapped and not counted), and enables the two Docks plugins `docks@docks` and `plan-lifecycle@docks` (the shared plan lifecycle).
- `SoT/.codex/rules/*.rules` deploys to `~/.codex/rules/` as kit-managed Codex command policy. This is Codex's equivalent of permission allow/prompt/block rules; user-learned approvals in `~/.codex/rules/default.rules` are preserved.
- `SoT/.codex/plugins/marketplace.json` deploys to Codex's personal marketplace path at `~/.agents/plugins/marketplace.json`; when the `codex` CLI is available, sync reruns `codex plugin add <plugin@marketplace>` for enabled SoT plugins so stale cached installs are refreshed.
- The global prompt SoTs carry the owner's standing authorization for Docks cross-company plan review, which never overrides host or platform denial.
- The `codex` CLI binary is upstream-owned, not kit-owned. The official standalone installer keeps package metadata under `$CODEX_HOME/packages/standalone` and places the `codex` symlink in `~/.local/bin` by default; sync only warns with a download-then-run installer command when the CLI is missing. Existing installs can self-update with `codex update`; npm and Homebrew remain upstream alternatives.
- Claude runtime settings are an authoring template with sentinels. `claudeRuntime.ts` materializes absolute Bun/script paths only after the shared `bun.ts` bootstrap is ready; `claudeSync.ts` writes all runtime assets before atomically committing settings, then prunes the legacy shell scripts and Stop hook. Native `rate_limits` is the sole quota source, so jq/curl/OAuth caches are not runtime dependencies. A missing Bun defers only this cutover and preserves legacy pointers/files.
- Claude's deployed SoT defaults are `model: opus` and `effortLevel: high`; `advisorModel` is deliberately absent/off. `--claude-advisor=on` is the per-machine opt-in and writes `advisorModel: fable` after the settings merge. `opus` is the alias, not a pinned id: the `minimumVersion` floor of 2.1.219 ensures Claude Code can resolve it to the newest Opus its provider offers — Opus 5 on the Anthropic API or Opus 4.6 on Microsoft Foundry — instead of silently capping Anthropic API users at Opus 4.8 under the former 2.1.170 floor. Keeping the alias provides provider portability and tracks future Opus releases; the literal `claude-opus-5` is unavailable on Foundry. The floor also subsumes Fable 5's older 2.1.170 requirement.

For per-tool SoT layouts (`SoT/.claude/`, `SoT/.codex/`), see the matching SoT directory.

## Engineering rules

- **Idempotent operations.** Every EngineNative sync step must be safe to re-run. Settings merges, plugin installs, and marketplace adds are all idempotent — re-running with no SoT changes is a no-op.
- **Removed bash engine.** The bash engine was removed after the `bash-engine-final` tag. `DOCKS_KIT_ENGINE=bash` must fail with the removed-engine message; engine bugs are fixed forward in EngineNative.
- **Effect 4 CLI stack.** The CLI pins `effect@4.0.0-rc.109` (including `effect/unstable/cli`), `@effect/platform-bun@4.0.0-rc.109` (`BunServices.layer`, `BunRuntime.runMain`), `@effect/vitest@4.0.0-rc.109`, and `vitest@4.1.10` (required by the `@effect/vitest` peer range). `@effect/cli` and `@effect/platform` are removed and must not be reintroduced.
- **Effect skill routing.** Effect work in this checkout must verify migration and API call shapes against the installed declarations under `node_modules/effect/dist/unstable/cli/`, never from memory or a mutable dist-tag. The `effect-ts-setup`, `effect-ts-port`, and `effect-ts-specialist` skills target Effect 3.x and do not apply.
- **Targeted syncs.** `./docks-kit sync` accepts positional targets: `claude`, `codex`, and `agents`. Use the narrowest target that matches the SoT change (for example, `./docks-kit sync codex` for Codex-only config edits); targets can be combined with `--dry-run`, `--skip-bubblewrap` (skip optional bubblewrap bootstrap for the Codex Linux sandbox), `--skip-plugin-refresh` (install missing plugins without refreshing existing caches; used by `docks-kit update`), `--reconcile`, `--prune`, and the deploy-time modifiers `--claude-compact-window=<tokens>` / `--claude-permissive` / `--claude-model=<m>` / `--claude-effort=<level>` / `--claude-advisor=<on|off|default>` / `--codex-model=<m>` / `--codex-effort=<level>` (see `CLAUDE.md` § Deploy-time modifiers).
- **Additive by default.** Keys present in deployed config but absent from SoT are preserved on default sync. This protects user-only additions, but means drift accumulates — neither flag-less reset can clean it up. The one exception is the Claude `removed` manifest (`claude::_removed_manifest`), a curated list of unambiguous kit-owned artifacts that `claude::sync_removals` force-prunes on every sync, including the home-relative `~/.local/bin/session-relay` artifact installed outside `~/.claude`; see `CLAUDE.md` § Pruning stale artifacts.
- **`--reconcile` / `--prune` are the kit-owned reconcile flags.** Orthogonal — `--reconcile` reconciles the settings layer (SoT-declared keys/tables/arrays win; user-only keys and nested objects are preserved; permissions arrays are replaced wholesale by SoT). `--prune` uninstalls kit-managed installations not in the SoT (plugins, marketplaces, and `~/.agents/skills/*` entries tracked in `~/.agents/.kit-managed-skills`). Combine for a full reset to SoT's kit-managed scope. User-only additions outside the kit's scope (custom env vars, mcpServers, manually-installed skills, third-party plugins not declared in SoT) are always preserved. Each tool's per-tool file documents the specific paths and diff recipes.
- **SOLID-aligned modules.** `cli/src/engine-native/parseArgs.ts` owns flag parsing/validation. `toolchain.ts` owns verified-version floor reporting over `SoT/toolchain.json`; `bun.ts` owns the shared, memoized Bun bootstrap; `claudeRuntime.ts` owns Claude settings materialization. `claudeSync.ts`, `codexSync.ts`, and `skillsSync.ts` own tool-specific sync logic. `index.ts` is the thin orchestrator. The public CLI seam is `cli/src/engine.ts`.
- **Small, reviewable changes.** Bundled multi-concern PRs are harder to review and revert. Split an engine/CLI change and a per-tool config change unless the change requires atomicity.
- **Dry-run before destructive flags.** Always preview with `./docks-kit sync --dry-run` (or the relevant `diff <(jq -S …)` recipe in the per-tool file) before invoking `--reconcile` or `--prune`. User-added permissions / env vars / plugins absent from SoT will be discarded.
- **SoT prompt files are rules, not explanation.** `SoT/.claude/CLAUDE.md` and `SoT/.codex/AGENTS.md` are loaded into every agent session's prompt context — every line costs prompt tokens on every turn for every user. Restrict their content to rules, heuristics, and `<constraint>` blocks the agent must *act on* during a turn. Do NOT add inline source citations (`Source: …`, attributed quotes), "why this rule exists" preface text, version-watermarking trivia (e.g. "Distilled from X v2.0, captured 2025-11-07"), per-bug workarounds, or installation instructions. Provenance, motivation, and historical context belong in `CLAUDE.md` / `AGENTS.md` at the repo root (humans read once) or in commit messages — never in the SoT. For every line, apply the official test: would removing it cause the agent to make mistakes? If not, cut it — over-instruction degrades adherence on current frontier models.
- **Cache-invariance for kit-authored prompt surfaces.** Never put timestamps, counters, or mutable state into SoT prompt files, hook outputs that land in the cached prefix, or tool definitions — cache breaks force cold-start writes. Dynamic context belongs in runtime-injected messages (e.g. SessionStart hook output), which is exactly how the kit's date/config injection works.

## Code style

- Bash: for launchers/installers/hook assets, use `set -euo pipefail`, quoted variables, `[[ ]]` over `[ ]`, and function-scoped `local`.
- JSON config: edit the SoT (`SoT/<tool>/`) and run `./docks-kit sync`. Never edit deployed config (`~/.claude/`, `~/.codex/`) directly.

## Security

- No secrets in SoT. The kit's SoT directories are committed; treat them as declarative config only.
- Treat external plugin marketplaces and installer downloads as untrusted input. Prefer download-then-run over `curl … | bash` so a truncated stream cannot execute a partial script.
- **Pin, never float.** Every kit-driven install of third-party software is pinned to a `SoT/toolchain.json` `verified` version — no `@latest` npm/bun installs (Shai-Hulud-class worm surface), no mutable action tags in workflows (commit SHAs only), installer scripts fetched from version tags where upstream supports it. New third-party install surface ⇒ manifest pin first. Details: the `toolchain-context` skill and `cli/docs/toolchain.md`.
- **One exemption: the kit's own package.** `install.sh` and `install.ps1` end with `bun add -g docks-kit@latest`, because a global installer that pinned itself would install a fixed old kit forever, and pinning it to `package.json` would request an unpublished version between the release-prep commit and the npm publish. The exemption covers `docks-kit` alone. Both installers still pin the Bun installer they download to the manifest's verified version, and `cli/test/unit/install.test.ts` asserts that pin in all four launcher and installer scripts.
## Testing

Automated coverage includes `bun run test:unit`, `bun run golden:dryrun`, and `bun run golden:mutation`; prove-red modes must exit non-zero after detecting planted mismatches. Also verify user-facing changes via `./docks-kit sync --dry-run`, per-tool sanity (`/doctor`, `/plugin`, etc.), and `diff <(jq -S . <SoT>) <(jq -S . <deployed>)` recipes from the per-tool file.

Use direct acceptance and focused regressions while iterating, then run the full unit/golden gate once at the pre-commit or release boundary. Reuse still-matching evidence; a later relevant edit invalidates only the affected rung and final gate, not every prior check.

## Skills

**Project-skill scope.** Keep project skills to one class: kit-mechanic skills, narrowly-scoped references for how EngineNative works.
Canonical project skills live in `.agents/skills/<name>/SKILL.md`.
Each `.claude/skills/<name>` entry is a relative symlink to its canonical directory.
Codex reads `.agents/skills/` natively, so one copy serves both tools.
Kit-mechanic skills document regression-prone TypeScript sync logic in `cli/src/engine-native/`.
**Pipeline content** (multi-agent slash commands, refactor/security/docs workflows, parallel-scanner agents) belongs in the separate [DocksDocks/docks](https://github.com/DocksDocks/docks) plugin — not here. Project-level agents under `.claude/agents/` follow the same rule: kit-mechanic agents that wrap kit-mechanic skills are permitted; pipeline agents live in the docks plugin.

<constraint>
When a kit-mechanic skill, its `references/`, or a wrapper agent (`.claude/agents/*.md` + its `.codex/agents/*.toml` twin) cites EngineNative internals, name the **module + exported/local function + semantic anchor** (e.g. `claudeSync.ts syncPlugins, pass 5 uninstall guard`) — never a raw `file:NNN` line number, which goes stale on every refactor. Keep exactly one coarse `metadata.source_files[].lines` range per skill file as the sole intentional line-number touchpoint.
</constraint>

**Universal-skill bootstrap.** `SoT/.agents/skills.txt` is intentionally empty, so the default sync exposes no universal skills. The generic opt-in contract remains: each [agentskills.io](https://agentskills.io/specification) slug is installed by `skillsSync.ts` with `npx skills add <slug> -g -y -a claude-code codex`. The slug comes first because `-a/--agent` is variadic; naming both supported agents preserves the canonical `~/.agents/skills/<name>/SKILL.md` plus Claude's `~/.claude/skills/<name>` symlink. Existing canonical directories are reused idempotently, `--prune` removes only entries tracked in `~/.agents/.kit-managed-skills`, and skills requiring a separate CLI retain explicit helpers in `skillsSync.ts`.

## Plans

Use direct implementation for one clear, reversible, low-risk local diff with one
bounded acceptance path; it creates no tracked plan, reviewer, or automatic
commit. Use a canonical plan for explicit planning, multi-commit or
cross-repository work, cold handoff, an unresolved decision, a cross-subsystem or
public-contract change, security-sensitive or destructive work, or any
non-`local` effect.

<constraint>
Canonical plans live in `docs/plans/active/`; status is frontmatter and
`docs/plans/finished/` is terminal. Exactly three skills own the workflow:
`plan-workspace` maintains the workspace; main-context `plan-manager` runs six
phases — decide, draft, research, one plan review, implement, code review — and
archives; internal `plan-reviewer` returns a readable pre-implementation verdict.
Two read-only reviewer wrappers ship, `plan-reviewer` and `code-reviewer`, and
nothing else in the lifecycle has a wrapper.
</constraint>

The record is markdown only: `plan_contract: v2` frontmatter plus eight `##`
sections — `## Goal`, `## Research`, `## Steps`, `## Acceptance`,
`## Do not touch`, `## Open questions`, `## Review`, `## Verification Results`.
There are no hashes, permits, run identities, locks, bundles, or `v2`/`vN` plan
files, and the `plan.mjs` shipped inside the installed `plan-lifecycle` plugin
is the only lifecycle tool. This lifecycle creates zero commits and never
pushes; commit when the user asks, under `docks:commit-discipline`.

Every Steps row carries an `Effect` of exactly
`local|probe|production_access|publish|push|release|deploy`. A step whose
`Effect` is not `local` requires an in-session `ask` confirmation immediately
before it runs; when `ask` is unavailable the step is set `blocked` with
`blocked_reason` naming the unconfirmed effect. Persisted effects record intent
only.

A plan carrying a `Plan-run:` line is a v1 plan: render it, never parse or
migrate it, and finish it by hand by moving the file byte-unchanged to
`docs/plans/finished/<YYYY-MM-DD>-<slug>.md` with a `## Retirement` section
appended. The complete contract lives in `docs/plans/AGENTS.md`;
`docs/plans/CLAUDE.md` contains only `@AGENTS.md`.

Distinct from per-tool **Open Concerns** sections (wait-on-upstream
blockers tied to a vendor shipping a fix — these live inside the per-tool
file): plans are kit-internal work we control; Open Concerns is
conditions-for-resolution.

Plugin-internal work (skills, commands, agents) belongs in each plugin's
own repo, not here.

## Notes for nested overrides

Per the agents.md open standard, place an `AGENTS.md` inside any subdirectory that needs different rules. The closest `AGENTS.md` to the file being edited wins; explicit user prompts override everything.
