# Claude Code Configuration Kit

Portable Claude Code setup — commands, settings, hooks, and coding standards. Clone once, sync to `~/.claude/`, get a consistent AI-assisted dev environment everywhere.

**Focus: token efficiency without sacrificing quality.** Every setting, command, and hook in this kit is tuned to minimize token consumption while preserving rigorous multi-agent pipeline output. The configuration leans on 1M context with early auto-compaction via a 400K effective window, `max` effort (Opus 4.7's deepest thinking tier — see `## Thinking & reasoning` for the overthinking tradeoff), per-phase model tiering via `ssot/.claude/agents/` (12 opus for synthesis/analysis + 29 sonnet for exploration/scanning/verification) under an Opus 4.7 orchestrator, and adaptive thinking — combined with explicit Success Criteria and Anti-Hallucination Checks in every agent body so smaller models still produce dependable work. When adding or editing anything here, the guiding question is: *does this change reduce tokens without weakening correctness?*

The `ssot/.claude/` directory is the **Single Source of Truth** (SSOT) for `~/.claude/`. Edit files here, then sync to your home directory.

## Repository Structure

| Path | Purpose |
|------|---------|
| `ssot/.claude/CLAUDE.md` | Coding standards and conventions (synced to `~/.claude/CLAUDE.md`) |
| `ssot/.claude/settings.json` | Permissions, hooks, plugins, token limits |
| `ssot/.claude/commands/*.md` | 7 custom slash commands (see below) — thin orchestrators that invoke subagents by name |
| `ssot/.claude/agents/*.md` | 41 specialized subagents (see `## Agents`) — one per command phase, explicit `model:` per-agent |
| `ssot/.claude/skills/*/SKILL.md` | Portable engineering-convention skills (see below) |
| `ssot/.claude/statusline.sh` | Two-line status bar (model, git, usage, context) |
| `ssot/.claude/fetch-usage.sh` | API usage fetcher for status line (async, cached) |
| `alert_bubble.mp3` | Audio notification for Notification hook |
| `guard-skills.sh` / `score-skills.sh` | Structural + quality validators for skills |
| `guard-commands.sh` / `score-commands.sh` | Structural + quality validators for commands |
| `guard-agents.sh` / `score-agents.sh` | Structural + quality validators for agents |

## Custom Commands

All commands use multi-agent pipelines. The orchestrator runs on Opus 4.7; subagents are defined as individual files in `ssot/.claude/agents/` with explicit per-agent `model:` frontmatter (Opus for synthesis/architecture/creative reasoning, Sonnet for exploration/scanning/mechanical verification). Each command is a thin orchestrator that invokes subagents by `subagent_type`. Subagent bodies carry Success Criteria and Anti-Hallucination Checks so smaller models still produce dependable work. Most commands use a **Builder-Verifier pattern** (Builder creates output → Verifier runs concrete checks) for quality.

| Command | Pipeline | Pattern |
|---------|----------|---------|
| `/security` | Discovery → [Scanner \| Analyzer \| Hunter] → Synthesizer | DAG fan-out/fan-in |
| `/fix` | Exploration → [Code Scanner \| Dependency Scanner] → Planner → Verifier | DAG + Builder-Verifier |
| `/review` | Exploration → Analyzer → Verifier | Builder-Verifier |
| `/test` | Exploration → Analyzer → Generator → Verifier | Builder-Verifier |
| `/docs` | Detection → Exploration → [Categorizer \| Scanner] → Skills Builder → [Role Mapper \| Pattern Extractor] → Agents Builder → Unified Verifier | DAG + Builder-Verifier (skills + agents + cross-layer check) |
| `/human-docs` | Exploration → Analyzer → Writer → Verifier | Builder-Verifier |
| `/refactor` | Exploration → [Dead Code Scanner \| Duplication Scanner] → SOLID Analyzer → Planner → Verifier | DAG + Builder-Verifier (sequential SOLID phase) |

Commands with parallel phases (`/security`, `/fix`, `/docs`, `/refactor`) include explicit instructions to launch agents in a single turn for wall-clock time savings. `/docs` has two parallel phases (Phase 2 skills analysis and Phase 4 agents analysis).

All commands enforce **Plan Mode** — read-only analysis first, user approval gate, then implementation.

## Skills

Portable engineering-convention skills that auto-trigger when Claude recognizes a matching task. Skills follow the [agentskills.io](https://agentskills.io) open standard: `SKILL.md` with frontmatter + body (≤500 lines), discovered by Claude Code at session start, full body loaded on demand. All skills in this kit are `user-invocable: false` — they stay out of the `/` menu but still auto-trigger on relevant work.

| Skill | Triggers on |
|-------|-------------|
| `dep-vuln-workflow` | `pnpm audit` / `npm audit`, CVE/GHSA advisories, major version bumps, peer-dep conflicts, rollback decisions |
| `lint-no-suppressions` | Tempted to add `eslint-disable` / `@ts-ignore` / `# noqa` / `@SuppressWarnings` — provides decision tree + reusable pre-commit hook |
| `nextjs-conventions` | Next.js 13/14/15/16 work — App Router files, Server Components/Actions, `proxy.ts`, async cookies/headers, `"use client"` boundaries |
| `react-effect-policy` | Writing `useEffect` — 6 anti-patterns with React 19 replacements (`useSyncExternalStore`, `useDeferredValue`, derived state, Server Actions) |
| `react-solid` | Component architecture / refactoring — SOLID's 5 principles translated to function-based React (Extract Hook, Strategy Map, discriminated unions, ISP splits, DIP via Server Actions) |
| `make-interfaces-feel-better` *(vendored, MIT, [upstream](https://github.com/jakubkrehel/make-interfaces-feel-better))* | UI polish — concentric border radius, optical alignment, layered shadows, enter/exit animations, `tabular-nums`, image outlines, `scale(0.96)` on press, 40×40px hit areas, `will-change` discipline |

Validators (`guard-skills.sh`, `score-skills.sh`) enforce spec conformance — see `## Editing Commands` for the same pattern applied to commands.

**Vendored / third-party skills** carry an `upstream:` frontmatter block (`source`, `license`, `vendored_at`). The guard and score scripts detect this and relax kit-specific checks (CSO start-prefix, `user-invocable`, `metadata.updated`) so upstream content can be preserved verbatim. Universal structural checks still apply.

## Agents

The kit ships with 41 specialized subagents in `ssot/.claude/agents/` — one per logical phase of each command. Every agent declares its own `model:` in frontmatter enabling per-phase Opus/Sonnet tiering.

| Agent family | Count | Model mix | Opus agents (synthesis/architecture/creative) |
|---|---|---|---|
| /security agents | 5 | 3 opus + 2 sonnet | `security-logic-analyzer`, `security-adversarial-hunter`, `security-synthesizer` |
| /fix agents | 7 | 1 opus + 6 sonnet | `fix-planner` |
| /review agents | 4 | 1 opus + 3 sonnet | `review-analyzer` (the command's main value phase) |
| /test agents | 5 | 1 opus + 4 sonnet | `test-generator` (creative edge-case design) |
| /docs agents | 8 | 2 opus + 6 sonnet | `docs-categorizer`, `docs-role-mapper` |
| /human-docs agents | 5 | 1 opus + 4 sonnet | `human-docs-writer` (prose rewriting + slop removal) |
| /refactor agents | 7 | 3 opus + 4 sonnet | `refactor-solid-analyzer`, `refactor-planner`, `refactor-post-verifier` |
| **Total** | **41** | **12 opus (29%) + 29 sonnet (71%)** | — |

**Tiering rationale:** Opus 4.7 earns its ~5× output cost on synthesis, architectural reasoning, and multi-input reconciliation — synthesizers, analyzers with semantic reasoning, planners, creative/adversarial work. Sonnet 4.6 handles exploration, pattern scanning, and mechanical verification at a fraction of the cost. Anthropic's own [multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) shows Opus-orchestrator + Sonnet-workers beat single-agent Opus by 90.2% on their internal research eval — this kit applies the same principle one level deeper (Opus for synthesis/architecture phases inside each command too).

**Agent file structure:**
- Frontmatter: `name` (kebab-case, matches filename), `description` (CSO — starts "Use when…" with "Not for…" clause), `tools`, `model` (`sonnet` / `opus` / `haiku` / `inherit` / full model ID)
- Body (≤500 lines): `<constraint>` blocks for shell-avoidance + research-gate (where applicable), `## Workflow` with context-acknowledgment as step 1, `## Output Format`, `## Anti-Hallucination Checks`, `## Success Criteria`

**Commands invoke agents by `subagent_type`:**
```
## Phase 3: Synthesis
Invoke `subagent_type: security-synthesizer`. Prompt: "Run /security Phase 3..."
```

The orchestrator passes the `subagent_type` to Claude Code's Agent tool; Claude Code resolves the model per-agent from the frontmatter.

**Model-selection resolution** (per [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model)):
1. `CLAUDE_CODE_SUBAGENT_MODEL` env var (NOT set in this kit — setting it would override all per-agent declarations)
2. Per-invocation `model` parameter
3. Agent frontmatter `model:` ← **this is where tiering lives**
4. Parent conversation's model

**Validators** — `bash guard-agents.sh` (structural) + `bash score-agents.sh` (quality, mirrors `score-skills.sh`). Enforced checks:
- `name` kebab-case, matches filename, ≤64 chars, no "anthropic"/"claude"
- `description` ≤1024 chars, starts "Use when", contains "Not" exclusion
- `model` is valid alias or full ID
- Body ≤500 lines, has `## Workflow`, `## Success Criteria`, ≥1 `<constraint>` block

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

## Session Management

Based on https://claude.com/blog/using-claude-code-session-management-and-1m-context. The 400K compact window is a *fallback*; the habits below keep sessions crisp in the first place.

| Signal | Action | Why |
|--------|--------|-----|
| Related follow-up, same working set | **Continue** | Everything in context still matters |
| New task starting | **`/clear`** | Zero rot; you control what carries forward |
| Wrong path, same task | **`/rewind`** (double-tap `Esc`) | Undo the detour before it pollutes context |
| Same task, context getting heavy | **`/compact` with steering** | Direct Claude what to keep ("preserve the failing test + stack trace; drop the exploration"). Beats waiting for auto-compact to guess. |
| Work will produce output you only need the conclusion of | **Subagent** | Keeps verbose output out of the parent context |

Rule of thumb: if a turn starts with "that didn't work, try X instead," reach for `/rewind` before retrying — the failed attempt is context rot you're otherwise carrying forward.

The kit's nine custom commands already use Opus-orchestrator + sonnet-subagents. The blog validates that pattern for ad-hoc work too.

## Permission Mode

The kit sets `permissions.defaultMode: "auto"` and `skipAutoPermissionPrompt: true` — new sessions boot directly into auto mode with no entry confirmation. Docs: https://code.claude.com/docs/en/permission-modes.

The classifier tradeoff: the classifier that gates each action in auto mode is an API call in its own right. When that service has a transient outage, every Edit/Bash is blocked until it recovers — even simple local work stalls. When that happens, cycle away with `Shift+Tab` (`default` → `acceptEdits` → `plan` → `auto`) until the classifier recovers. Fallbacks are baked in anyway — see "Fallbacks" below.

**Requirements** for auto mode (the kit meets them on a Max subscription):
- Plan: Max / Team / Enterprise / API (not Pro)
- Model: on Max, **Opus 4.7 only** (the kit pins this); on other plans Sonnet 4.6 / Opus 4.6 / Opus 4.7
- Provider: Anthropic API only (not Bedrock, Vertex, Foundry)
- Claude Code v2.1.83+

**What changes when auto mode is active:**
- Broad wildcard allow rules (`Bash(git *)`, `Bash(npm *)`, `Bash(python *)`, etc.) are dropped — everything routes through the classifier instead. Narrow rules like `Bash(npm test)` carry over.
- The `deny` list is still enforced.
- Protected paths (`.git`, `.claude`, `.mcp.json`, etc.) route to the classifier rather than being auto-approved.
- Dropped rules are restored the moment you leave auto mode.

**Fallbacks baked in**: 3 consecutive classifier blocks or 20 total in a session pause auto mode and resume prompting. Approving the prompted action resumes auto. Not configurable.

**When to bail out of auto mode**: classifier outage, sensitive production work, CI migrations, anything where you want to review each step. `Shift+Tab` cycles away from auto.

Auto mode is Anthropic's term-of-art "research preview" — it reduces prompt fatigue on long agentic loops, not a replacement for review on risky operations.

## Hooks

- **SessionStart**: Injects current date/time and active config (context window, compact-window cap, effort level, thinking mode, pinned opus model, subagent model) so agents don't rely on training data cutoff
- **Notification**: Plays `alert_bubble.mp3` via `ffplay` when a task completes
- **PreToolUse (Bash)**: RTK hook rewrites commands for token-compressed output
- **Stop**: Fetches API usage stats (async) to keep status line data fresh
- **SubagentStop**: Blocks subagent completion if output lacks concrete `file:line` references (allows "no issues found" / mode-selection responses through)

## Environment Variables

All configured in `ssot/.claude/settings.json` under the `env` block. The centerpiece strategy is **1M context + 400K compact window + max effort + sonnet subagents** — maximizes usable context before compaction while keeping token cost sane. Tuned for Opus 4.7, which removed `budget_tokens` and makes adaptive thinking the only thinking-on mode.

### Context management

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | `400000` | Cap the effective window at 400K regardless of the model's real capacity. Compaction fires at the default ~95% → ~380K. Per Anthropic's Thariq Shihipar (2026-04-15 blog + tweet): a good compromise on 1M Opus. Value is capped at the model's real window, so it's safe on 200K models too. Docs: https://code.claude.com/docs/en/env-vars. |
| (implicit) 1M context | enabled by default | `CLAUDE_CODE_DISABLE_1M_CONTEXT` is **not** set, so 1M is active on Max/Team/Enterprise plans for Opus 4.7. Note: 4.7 uses a new tokenizer that may consume up to 1.35× more tokens than 4.6 on the same text — another reason to cap the compact window in absolute tokens rather than as a percentage. |

The status bar keeps showing context usage against the model's full window (1M); `CLAUDE_CODE_AUTO_COMPACT_WINDOW` decouples the compact trigger from `used_percentage`. Intentional: you still see real consumption; compaction just fires earlier.

### Thinking & reasoning

Opus 4.7 removed `budget_tokens` (returns 400 error) and makes **adaptive thinking the only thinking-on mode**. Fixed budgets and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` are gone.

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_CODE_EFFORT_LEVEL` | `max` | Highest thinking-budget tier. Valid: `low`/`medium`/`high`/`xhigh`/`max`/`auto`. Env var takes precedence over `/effort` and the `effortLevel` settings key. Tradeoff: `max` can overthink structured tasks — drop to `xhigh` if you see wasted reasoning on routine work. |

### Model selection

| Variable | Value | Purpose |
|----------|-------|---------|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-opus-4-7` | Pins the opus model version for the main orchestrator. 4.7 launched 2026-04-16 with step-change agentic-coding gains. |

**Subagent model selection:** not an env var. Each agent in `ssot/.claude/agents/` declares its own `model:` (sonnet/opus) in frontmatter. `CLAUDE_CODE_SUBAGENT_MODEL` is intentionally NOT set — it would override all per-agent declarations (it's priority 1 in Claude Code's resolution order per the [subagents doc](https://code.claude.com/docs/en/sub-agents#choose-a-model)) and block per-phase tiering. To force all subagents to one model temporarily (rollback), export `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` — it wins over the agent frontmatter.

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
| `viewMode` | `default` | Default transcript view on startup. Keeps tool I/O collapsed so the feed stays readable; `showThinkingSummaries` still controls whether thinking is generated. Press `Ctrl+O` to cycle to `verbose` on demand when you want to inspect a tool call or thinking block inline. Enum: `default`/`verbose`/`focus` (`focus` hides thinking — not recommended here). |
| `skipAutoPermissionPrompt` | `true` | Suppresses the one-time confirmation shown when a session boots into auto mode (e.g. via `permissions.defaultMode: "auto"`). Named analogously to `skipDangerousModePermissionPrompt`; not in the official settings reference as of 2026-W16 but works in v2.1.x. |
| `skipDangerousModePermissionPrompt` | `true` | Suppresses `--dangerously-skip-permissions` warning. Ignored in project-level settings for safety. |

Effort is controlled **only** via `CLAUDE_CODE_EFFORT_LEVEL` (env var). The top-level `effortLevel` key's schema only accepts `low`/`medium`/`high`/`xhigh` — the env var is required to reach `max` (and is the documented precedence winner over `/effort` and the settings key anyway).

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
- **Auto-compact firing at the wrong time** — the kit sets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000`, which caps the effective window and fires compaction at ~95% of that (~380K). To delay, raise the value; to fire earlier, lower it or add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=N` (percentage of the capacity). Both env vars at https://code.claude.com/docs/en/env-vars.
- **Schema validation warnings on settings.json** — `showTurnDuration` belongs in `~/.claude.json`, not `settings.json`. `sync.sh` handles this automatically.
- **Subagent rejected by SubagentStop hook** — the hook expects file:line references. Verifiers returning "no issues found" / mode-selection responses are whitelisted. If a legitimate reply is still being rejected, extend the exception pattern in the hook command.
- **`@RTK.md` import missing** — generated by `rtk init -g`. If RTK is not installed, run `./sync.sh --no-rtk` to strip the import cleanly.

## Open Concerns

Living list of kit-level bugs, blockers, and wait-on-upstream items that can't be fixed locally. Each entry records the symptom, root cause, workaround, and how to verify resolution.

**When invoked via "check open concerns"** (or similar), the assistant should: (a) read this section, (b) for each entry, fetch the linked upstream references and the current Claude Code version, (c) report which concerns are now resolved (issues closed/merged, version shipped), and (d) offer to remove resolved entries + undo their workarounds.

Entry format: `### [YYYY-MM-DD] <short title>` with Status / Symptom / Root cause / Upstream / Workaround / Verify resolution / Fallback.

---

### [2026-04-24] Opus 4.7 thinking summaries not rendered

**Status:** Open — confirmed bug, no fix in Claude Code 2.1.119 (verified on this machine).

**Symptom:** `"showThinkingSummaries": true` in `settings.json` does not produce visible thinking content on Opus 4.7. The thinking block header (token count, elapsed time) renders, but the expand toggle reveals empty content.

**Root cause:** Opus 4.7 flipped the API default for `thinking.display` from `"summarized"` (4.6 behavior) to `"omitted"` (faster time-to-first-token on streaming). Claude Code's harness does NOT currently translate `showThinkingSummaries: true` into `"display": "summarized"` on Opus 4.7 requests, so the client receives empty thinking blocks and has nothing to render.

**Upstream issues** (all open as of 2026-04-24):
- [anthropics/claude-code#49268](https://github.com/anthropics/claude-code/issues/49268) — "harness doesn't set display: summarized" (root cause)
- [anthropics/claude-code#49708](https://github.com/anthropics/claude-code/issues/49708) — thinking empty despite `showThinkingSummaries: true` (closed as duplicate)
- [anthropics/claude-code#49322](https://github.com/anthropics/claude-code/issues/49322) — VS Code extension variant
- [anthropics/claude-code#49902](https://github.com/anthropics/claude-code/issues/49902) — VS Code extension 2.1.112
- [anthropics/claude-code#52376](https://github.com/anthropics/claude-code/issues/52376) — subscription sessions may need server-side fix (separate open concern)
- Model-side reference: [What's new in Claude Opus 4.7](https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-7)

**Workaround:** Launch Claude Code with the hidden flag `--thinking-display summarized` (added in 2.1.111, not shown in `--help`; verified on 2.1.119 by running `claude --thinking-display bogus` — returns "Allowed choices are summarized, omitted"). Persistent via shell alias in `~/.bashrc` or `~/.zshrc`:

```bash
alias claude='claude --thinking-display summarized'
```

**Verify resolution:**
1. Check each linked issue — look for `closed` with "merged" or a release tag citing the fix.
2. `claude update` then `claude --version`.
3. Remove the shell alias, restart shell, start a fresh session.
4. Ask a non-trivial question that triggers adaptive reasoning; confirm thinking summary renders inline (not just the header stub).
5. If rendered: remove this Open Concerns entry + the shell alias.

**Fallback if the flag doesn't help:** Issue [#52376](https://github.com/anthropics/claude-code/issues/52376) is the likely cause — on Max/Team/Enterprise subscriptions, the server may silently ignore `display: "summarized"` even when the client sends it (only API-key sessions honor it). In that case, switch to `/model claude-opus-4-6` temporarily; thinking renders correctly on 4.6. Cost: lose 4.7's SWE-bench Pro / agentic gains until Anthropic fixes the server-side behavior.

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

## Editing Commands, Skills & Agents

When modifying commands, skills, or agents, keep in sync by re-running `./sync.sh`. The `ssot/.claude/` directory is the source of truth; `~/.claude/` is the deployed copy.

Before committing, run the validators:

```bash
bash guard-commands.sh   # structural checks (task tags OR subagent_type references, Phase Transition Protocol for 3+ phases, WebFetch consistency, cross-refs resolve to agent files)
bash score-commands.sh   # quality score (max 20): allowed-tools/description/argument-hint/$ARGUMENTS frontmatter [docs] + Plan Mode / Phase Transition / constraints / slop [project]
bash guard-skills.sh     # structural checks (frontmatter, name-matches-dir, description ≤1024 chars starting with "Use when" unless `upstream:` block is present, body ≤500 lines, metadata.updated ISO date unless `upstream:` block is present)
bash score-skills.sh     # quality score (max 16): Use-when / desc+when_to_use ≤1,536 / body 80–350 [docs] + freshness / constraints / BAD-GOOD / tables / code fences / slop [project]
bash guard-agents.sh     # structural checks (frontmatter, name-matches-file, "Use when…" + "Not…" clause, valid model, body ≤500 lines with Workflow + Success Criteria + ≥1 <constraint>)
bash score-agents.sh     # quality score (max 13): model declared / tools-or-disallowedTools [docs] + Use-when / Not-clause / Workflow+Success Criteria / anti-hallucination / constraints / slop [project]
```

`score-skills.sh --per-file` and `score-agents.sh --per-file` print one `<name> <score>` line per skill/agent — useful for spotting drift after an edit.

**Note on thin commands:** All 7 commands are thin orchestrators (no `<task>` blocks; phases reference agents by `subagent_type`). `guard-commands.sh` accepts both legacy (`<task>`) and thin flavors; scoring rewards `subagent_type:` cross-references resolving to agent files.

### Rubric provenance

Each scoring dimension is tagged in the rubric comments as either **[docs]** (Anthropic-documented in [sub-agents](https://code.claude.com/docs/en/sub-agents) / [skills](https://code.claude.com/docs/en/skills) / [agentskills.io](https://agentskills.io)) or **[project]** (kit-specific convention). When a scoring dimension fails, knowing which category it's in tells you whether the failure is a spec violation or a style divergence.

| Dimension | Category | Applies to | Source |
|---|---|---|---|
| `description:` frontmatter present | [docs] | Commands, Skills, Agents | Official frontmatter reference |
| `allowed-tools:` frontmatter | [docs] | Commands, Skills | Pre-approves tool usage |
| `argument-hint:` frontmatter | [docs] | Commands, Skills | Autocomplete UX |
| `$ARGUMENTS` usage consistency | [docs] | Commands | String substitution reference |
| Explicit `model:` field | [docs] | Agents | Resolution order in sub-agents doc |
| `tools:` or `disallowedTools:` declared | [docs] | Agents | Permission predictability |
| Body ≤500 lines (SKILL.md) | [docs-tip] | Skills | Anthropic Tip in skills doc |
| `description` + `when_to_use` ≤1,536 chars | [docs] | Skills | Hard spec — truncated in listing otherwise |
| Body 80–310 lines sweet spot | [docs-aligned] | Skills | 4.7-safe compaction ceiling (5K tok ÷ ~16 tok/line) |
| Subagent refs resolve to agent files | [structural] | Commands | Cross-reference correctness |
| "Use when…" description start | [docs-example] | Skills, Agents | Every Anthropic example uses this; no doc mandate |
| "Not…" exclusion clause | [project] | Agents | Narrows match surface |
| `<constraint>` XML tags for rules | [project] | Commands, Skills, Agents | Not in Anthropic docs; empirically effective |
| `## Workflow`, `## Success Criteria`, `## Anti-Hallucination Checks` sections | [project] | Agents | Project structure, not Anthropic canon |
| Plan Mode constraint in command body | [project] | Commands | Enforces `EnterPlanMode` gate |
| Phase Transition Protocol constraint | [project] | Commands | Prevents orchestrator stalling mid-pipeline |
| Slop-word penalty ("comprehensive"/"robust"/"elegant"/"seamless") | [project] | all | Kit style |
| 180-day freshness window (`metadata.updated`) | [project] | Skills | Kit hygiene |

The split matters because **[docs]** dimensions track hard-spec or officially recommended behavior — regressions there imply a real functional/UX issue. **[project]** dimensions encode kit opinion; divergence is a style discussion, not a spec violation. Treat CI-floor failures accordingly: [docs] dimension drops → investigate for functional impact; [project] dimension drops → may be an intentional evolution of the kit's conventions.

### Current rubric calibration

Scores and CI floors as of 2026-04-24 (re-check after rubric changes):

| Rubric | Max | Current min | Current avg | Per-file floor | Avg floor |
|---|---|---|---|---|---|
| Commands (7 files) | 20 | 19 (`/docs` — no args) | 19.9 | 17 | 19 |
| Skills (6 files) | 16 | 10 (`make-interfaces-feel-better`, vendored) | 13.5 | 8 | 12 |
| Agents (41 files) | 13 | 13 | 13.4 | 11 | 13 |

Floors leave ~2pt buffer per-file for minor edits; the tight average floor catches broad regressions. Re-calibrate these numbers in both this table AND `.github/workflows/validate.yml` after any rubric change.
