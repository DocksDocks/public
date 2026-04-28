---
created: 2026-04-27T23:00:32-03:00
updated: 2026-04-27T23:00:32-03:00
finished: null
status: planned
---

# Subagent Pipeline Improvements

## Context

Anthropic's official guidance ([How and when to use subagents](https://claude.com/blog/subagents-in-claude-code)) explicitly warns against the kit's pattern:

> "When step two needs the full output of step one, and step three needs both, a single session handling the chain is usually cleaner than a relay of subagents passing state through files."

Every command in this kit is exactly that pattern — a sequential pipeline of 5–8 subagents passing state through a plan file. Web research surfaced additional recurring complaints about subagents in 2026:
- **Context loss**: fresh-spawned subagents don't inherit parent learnings unless passed explicitly
- **Compression flattening**: when context IS inherited as a summary, specifics are lost
- **Cost burn**: each subagent burns rate-limit tokens for bootstrap before doing work
- **Discovery flooding**: many specialist agents make automatic delegation less reliable
- **"Dumber subagents"**: don't follow instructions as reliably as a direct Claude session

Sources: [GitHub anthropics/claude-code#29379](https://github.com/anthropics/claude-code/issues/29379) (Explore misuse, closed "not planned"), [Anthropic blog](https://claude.com/blog/subagents-in-claude-code), [Reddit/blog summaries](https://www.morphllm.com/claude-code-reddit), [arsturn analysis](https://www.arsturn.com/blog/are-claude-code-subagents-actually-useful-a-realistic-look-at-their-value).

## My Take: Are sequential pipelines bad?

**No — not for this kit's specific use case.** The Anthropic warning targets short workflows where a single session would be cleaner. The kit's commands (`/security`, `/refactor`, `/fix`, `/review`, `/test`, `/docs`, `/human-docs`) are large multi-phase analyses where a single session would blow the 400K compact-window budget on tool output alone.

Three structural defenses justify the trade-off:
1. **Files-as-handoff** matches Anthropic's other recommended pattern (verbatim quote in the same blog: "use the output files as the handoff mechanism between stages")
2. **Per-phase model tiering** (12 Opus + 29 Sonnet) saves ~70% vs. all-Opus single session
3. **Subagents don't inherit a compressed summary** — they bootstrap from the plan file, sidestepping the compression-flattening complaint entirely

That said, the warning identifies real costs the kit pays:
- Each subagent re-reads the plan file → bootstrap token cost per phase
- Each subagent re-runs project discovery → wasted work across runs
- Plan-file structure is informal markdown → fragile parsing between phases
- 41 specialist agents → potential discovery flooding when invoked via natural language

The improvements below mitigate those costs without abandoning the pipeline design.

## Tasks

### Tier 1 — Documentation + low-risk hardening

#### T1-01 — Document the design choice in root CLAUDE.md

**File:** `CLAUDE.md` (project root)

- [ ] Add a short subsection under `## Custom Commands` titled "Why sequential subagent pipelines?"
- [ ] Cite the Anthropic blog warning verbatim
- [ ] Explain the kit's three-part defense (files-as-handoff, model tiering, no summary compression)
- [ ] Reference this plan for the open improvement work

#### T1-02 — Add `enumerate-don't-diagnose` constraint to all explorer agents

**Files:** 7 agents under `ssot/.claude/agents/*-explorer.md`
- `refactor-explorer`, `security-explorer`, `fix-explorer`, `review-explorer`, `test-explorer`, `docs-explorer`, `human-docs-explorer`

The [GitHub issue #29379](https://github.com/anthropics/claude-code/issues/29379) was about Opus delegating *diagnosis* to the (Haiku) Explore agent instead of just *enumeration*. The kit's custom explorers run Sonnet and currently happen to enumerate-only by wording, but no `<constraint>` makes it explicit. Adding one defends against future drift.

- [ ] Draft constraint text: `Enumerate; do not diagnose. Map what exists — files, structures, patterns, tools, dependencies. Do NOT infer "this code has a bug", "this pattern is wrong", or "this should be refactored." That work belongs to downstream analyzer/scanner phases. If you see something concerning, list it as a fact ("file X uses pattern Y at line Z") — never as a judgment.`
- [ ] Apply to all 7 explorer agents
- [ ] Verify `bash guard-agents.sh` passes
- [ ] Verify `bash score-agents.sh --per-file` shows expected scores (should add 1 pt to constraint count for any explorer that previously only had shell-avoidance)

#### T1-03 — Document `@agent-<name>` invocation syntax in root CLAUDE.md

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): users can force-invoke a specific subagent with `@agent-<name>` (or `@"<name> (agent)"` via typeahead) instead of relying on natural-language delegation. The kit doesn't document this anywhere.

- [ ] Add a short subsection under `## Agents` showing the syntax
- [ ] Include one usage example (e.g., `@agent-refactor-solid-analyzer audit src/services/`)
- [ ] Note that this bypasses the kit's command pipeline — useful for ad-hoc single-agent work

#### T1-04 — Rename `Task` → `Agent` in command `allowed-tools`

The Task tool was renamed to Agent in Claude Code v2.1.63; existing `Task(...)` references work as backward-compat aliases but the canonical name is now `Agent`.

- [ ] Update `allowed-tools` in all 7 commands under `ssot/.claude/commands/*.md`
- [ ] Verify `bash guard-commands.sh` passes
- [ ] Verify `bash score-commands.sh --per-file` is unchanged

#### T1-05 — Add `paths:` filter to frontend skills

Verified via [skills docs](https://code.claude.com/docs/en/skills): `paths:` glob limits skill auto-trigger to matching files. Three kit skills are frontend-only and currently trigger semantically on every prompt — wasted context on backend/Python work.

- [ ] `nextjs-conventions`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js", "next.config.*", "app/**/*", "pages/**/*"]`
- [ ] `react-effect-policy`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js"]`
- [ ] `react-solid`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js"]`
- [ ] Verify `bash guard-skills.sh` passes
- [ ] Verify the kit's `score-skills.sh` doesn't penalize the new field (extend the script if it does)

### Tier 2 — Pipeline cost reduction

#### T2-01 — Add `memory: project` to explorer agents

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): `memory: project` writes a persistent directory at `.claude/agent-memory/<name>/` that the subagent reads on startup (first 200 lines of `MEMORY.md` auto-injected). Read/Write/Edit auto-enabled for the agent to self-curate.

This addresses the "wasted re-discovery" cost specifically for explorers, which currently re-map project stack, monorepo structure, analysis tools, and DI patterns every command run.

- [ ] Add `memory: project` to 5 explorers: `refactor-explorer`, `fix-explorer`, `review-explorer`, `test-explorer`, `docs-explorer`
  - Skip `security-explorer` (project mapping is generic; project-specific attack surface is sensitive — opt-out for now)
  - Skip `human-docs-explorer` (docs structure changes frequently; cache would go stale faster than it saves)
- [ ] Add a `## Memory` section to each modified agent's body explaining: what to cache (project profile, abstractions, DI patterns), what NOT to cache (per-phase findings, target scope), and how to invalidate (when `package.json` or `pnpm-workspace.yaml` changes)
- [ ] Verify `bash guard-agents.sh` accepts the new frontmatter field (extend if needed)

#### T2-02 — Per-agent `effort: high` for mechanical agents

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): `effort:` overrides session-level effort. Kit currently runs all 41 agents at `max` via `CLAUDE_CODE_EFFORT_LEVEL` env var. Mechanical enumeration agents don't benefit from `max`.

- [ ] Set `effort: high` on 7 agents:
  - 7 explorers (already mostly covered above)
  - `refactor-dead-code-scanner` (runs knip/depcheck/ts-prune, post-processes output — mechanical)
- [ ] Run `/refactor` and `/security` on a sample project before + after to measure token-usage delta
- [ ] If quality regressions appear (specific findings missed that `max` caught), revert the affected agent
- [ ] Document the chosen tier per agent in CLAUDE.md (next to existing model tiering rationale)

#### T2-03 — Plan-file phase-output validation

Currently each command's orchestrator writes a phase's output to the plan file, then immediately launches the next phase. If a subagent fails silently or writes to the wrong section, the next phase reads stale/missing data.

- [ ] In each command's orchestrator (`ssot/.claude/commands/*.md`), add a one-line check between phases: "Before launching Phase N+1, verify the plan file contains a `## Phase N: <name> Results` section with non-empty content. If missing, abort with an error."
- [ ] Add the same check to the relevant `*-pre-verifier` agents' workflows
- [ ] Test by manually corrupting a plan-file section mid-pipeline and confirming the orchestrator surfaces a clear error rather than silently degrading

### Tier 3 — Investigation (no code yet)

#### T3-01 — Measure baseline pipeline token cost

- [ ] Pick a representative project (e.g., a mid-sized Next.js app + a Python service)
- [ ] Run `/security`, `/refactor`, `/test`, `/review` on each
- [ ] Use `rtk gain --history` and the status line's API-usage data to capture per-phase token counts
- [ ] Build a table per command: phase name, agent, model, token-in, token-out, wall-clock
- [ ] Identify top 3 phases by bootstrap-cost ratio (`bootstrap-tokens ÷ total-tokens`)
- [ ] Save findings to `docs/roadmap/finished/YYYY-MM-DD-pipeline-baseline-measurement.md` (this becomes the evidence for further optimization decisions)

#### T3-02 — Investigate phase-merge opportunities

41 agents is a lot. Are there phases that could merge without sacrificing isolation benefits?

- [ ] Audit each command's phases — list inputs and outputs of each
- [ ] Identify pairs where Phase N's output is consumed only by Phase N+1 (no other readers)
- [ ] For each candidate pair, decide: merge into one agent, or keep split for clarity?
  - Merge if: combined size fits sonnet's effective ceiling AND no model-tier mismatch
  - Keep split if: phases have distinct model tiers OR one phase is verbose tool-output that should stay isolated
- [ ] Surface candidates in this plan as new T3 sub-items rather than auto-merging

#### T3-03 — Forked subagents for ad-hoc exploration (out of scope for kit, document for users)

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents) (experimental, requires `CLAUDE_CODE_FORK_SUBAGENT=1`): forked subagents inherit full conversation history without compression, share the parent's prompt cache.

This is NOT a fit for the kit's command pipelines (which intentionally isolate phases for token efficiency — forking would defeat the purpose). But it's useful for users who want ad-hoc exploration with full conversation context.

- [ ] Add a short note to root CLAUDE.md under `## Session Management` explaining when to use `/fork` vs. the kit's pipeline commands
- [ ] No code changes to kit agents

## Validation

- All Tier 1 changes pass `bash guard-agents.sh`, `bash guard-commands.sh`, `bash guard-skills.sh`
- Quality scores remain at or above current floors:
  - Per-file: agents 11, commands 17, skills 8
  - Average: agents 13, commands 19, skills 12
- After Tier 2 changes, run `/security` and `/refactor` on the kit itself; outputs should be substantively the same as a baseline run captured before the changes (allowing for normal model variance)
- After T2-01 (memory), run `/refactor` twice in succession on the same project; second run's explorer phase should be measurably faster (compare wall-clock and token counts)
- After T2-02 (effort), confirm no Sonnet-explorer findings disappear vs. baseline run

## Lifecycle

This plan likely spans 3–5 sessions. Each tier can land independently:
- Tier 1 is a single coherent commit per task (T1-01 through T1-05)
- Tier 2 needs measurement between commits (T2-01 → measure → T2-02 → measure)
- Tier 3 is research-driven; T3-01's output becomes input for T3-02

On first commit (likely T1-01 docs change), `git mv` to `ongoing/`. On final commit, `git mv` to `finished/2026-MM-DD-subagent-pipeline-improvements.md`.

If T2-02 (per-agent effort) shows no measurable savings or causes quality regressions, strike-through that subsection rather than silently deleting; the negative result is itself a useful data point for future maintainers.
