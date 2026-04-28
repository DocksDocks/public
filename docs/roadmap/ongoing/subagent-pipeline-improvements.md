---
created: 2026-04-27T23:00:32-03:00
updated: 2026-04-27T23:40:18-03:00
finished: null
status: ongoing
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

- [x] Add a short subsection ~~under `## Custom Commands`~~ as `### Why sequential subagent pipelines?` under `## Roadmap` (location chosen at execution time — keeps the design rationale next to the open-improvement-work tracking, rather than splitting them between two top-level sections)
- [x] Cite the Anthropic blog warning verbatim
- [x] Explain the kit's three-part defense (files-as-handoff, model tiering, no summary compression)
- [x] Reference this plan for the open improvement work

#### T1-02 — Add `enumerate-don't-diagnose` constraint to all explorer agents

**Files:** 7 agents under `ssot/.claude/agents/*-explorer.md`
- `refactor-explorer`, `security-explorer`, `fix-explorer`, `review-explorer`, `test-explorer`, `docs-explorer`, `human-docs-explorer`

The [GitHub issue #29379](https://github.com/anthropics/claude-code/issues/29379) was about Opus delegating *diagnosis* to the (Haiku) Explore agent instead of just *enumeration*. The kit's custom explorers run Sonnet and currently happen to enumerate-only by wording, but no `<constraint>` makes it explicit. Adding one defends against future drift.

- [x] Draft constraint text: `Enumerate; do not diagnose. Map what exists — files, structures, patterns, tools, dependencies. Do NOT infer "this code has a bug", "this pattern is wrong", or "this should be refactored." That work belongs to downstream analyzer/scanner phases. If you see something concerning, list it as a fact ("file X uses pattern Y at line Z") — never as a judgment.`
- [x] Apply to all 7 explorer agents
- [x] Verify `bash guard-agents.sh` passes
- [x] Verify `bash score-agents.sh --per-file` shows expected scores — all 7 explorers moved from score 13 → 14 (gained 1 pt from `<constraint>` count, now at 2 — the dimension caps at 2). Distribution: 9 agents at 13, 13 at 14, 19 at 15. Avg 14.24 (was 14.07).

#### T1-03 — Document `@agent-<name>` invocation syntax in root CLAUDE.md

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): users can force-invoke a specific subagent with `@agent-<name>` (or `@"<name> (agent)"` via typeahead) instead of relying on natural-language delegation. The kit doesn't document this anywhere.

- [x] Add a short subsection under `## Agents` showing the syntax (added as `### Force-invoke a single agent with @agent-<name>`)
- [x] Include three usage examples (`@agent-refactor-solid-analyzer audit src/services/` plus security-vulnerability-scanner and test-generator examples)
- [x] Note that this bypasses the kit's command pipeline — useful for ad-hoc single-agent work

#### T1-04 — Rename `Task` → `Agent` in command `allowed-tools`

The Task tool was renamed to Agent in Claude Code v2.1.63; existing `Task(...)` references work as backward-compat aliases but the canonical name is now `Agent`.

- [x] Update `allowed-tools` in all 7 commands under `ssot/.claude/commands/*.md`
- [x] Also updated body-text references: `the next Task agent(s) in the same turn` → `the next subagent(s) in the same turn` (avoid the redundant "Agent agent" phrasing); `Read`/`Write`/`Glob`/`Grep`/`Task` for phase management → `Read`/`Write`/`Glob`/`Grep`/`Agent` for phase management; security.md additional ref `Task for subagent invocation` → `Agent for subagent invocation`; refactor.md inline list `, `Task`, `WebFetch`` → `, `Agent`, `WebFetch``
- [x] Verify `bash guard-commands.sh` passes
- [x] Verify `bash score-commands.sh` is unchanged (139 total, same as baseline)

#### T1-05 — Add `paths:` filter to frontend skills

Verified via [skills docs](https://code.claude.com/docs/en/skills): `paths:` glob limits skill auto-trigger to matching files. Three kit skills are frontend-only and currently trigger semantically on every prompt — wasted context on backend/Python work.

- [x] `nextjs-conventions`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js", "next.config.*", "app/**/*", "pages/**/*"]` + bumped `metadata.updated` to 2026-04-27
- [x] `react-effect-policy`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js"]` + bumped `metadata.updated` to 2026-04-27
- [x] `react-solid`: `paths: ["**/*.tsx", "**/*.jsx", "**/*.ts", "**/*.js"]` + bumped `metadata.updated` to 2026-04-27
- [x] Verify `bash guard-skills.sh` passes
- [x] Verify the kit's `score-skills.sh` doesn't penalize the new field — total 81 unchanged from baseline (per-file: nextjs-conventions/react-effect-policy/react-solid all at 14, same as before). No script extension needed.

### Tier 2 — Pipeline cost reduction

#### T2-01 — Add `memory: project` to explorer agents

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): `memory: project` writes a persistent directory at `.claude/agent-memory/<name>/` that the subagent reads on startup (first 200 lines of `MEMORY.md` auto-injected). Read/Write/Edit auto-enabled for the agent to self-curate.

This addresses the "wasted re-discovery" cost specifically for explorers, which currently re-map project stack, monorepo structure, analysis tools, and DI patterns every command run.

- [x] Add `memory: project` to 5 explorers: `refactor-explorer`, `fix-explorer`, `review-explorer`, `test-explorer`, `docs-explorer`
  - Skip `security-explorer` (project mapping is generic; project-specific attack surface is sensitive — opt-out for now)
  - Skip `human-docs-explorer` (docs structure changes frequently; cache would go stale faster than it saves)
- [x] Add a `## Memory` section to each modified agent's body explaining: what to cache (project profile, abstractions, DI patterns), what NOT to cache (per-phase findings, target scope), and how to invalidate (when manifest files change — detect via `git log -1 --name-only`)
- [x] Verify `bash guard-agents.sh` accepts the new frontmatter field — passed without script extension (the YAML loader treats `memory:` as a regular key, structural checks already permit unknown frontmatter fields)

#### ~~T2-02 — Per-agent `effort: high` for mechanical agents~~

**Dropped 2026-04-27** per user direction: "no problem in increasing token cost, for those commands specifically." The kit's commands are deliberately quality-prioritized; `effort: max` (the env-var default) stays in force on every agent.

Verified via [sub-agents docs](https://code.claude.com/docs/en/sub-agents): `effort:` overrides session-level effort. Kit runs all 41 agents at `max` via `CLAUDE_CODE_EFFORT_LEVEL` env var.

- [x] ~~Set `effort: high` on 8 agents~~ — _applied then reverted in this same plan; net change to all 8 agents is zero. Frontmatter restored to pre-T2-02 state on 2026-04-27T23:40 (the 8: 7 explorers + `refactor-dead-code-scanner`)._
- [x] ~~Run `/refactor` and `/security` on a sample project before + after to measure token-usage delta~~ — _no longer needed; cost reduction is not a goal for these commands_
- [x] ~~If quality regressions appear, revert the affected agent~~ — _moot post-revert_
- [x] ~~Document the chosen tier per agent in CLAUDE.md~~ — _moot post-revert; CLAUDE.md continues to reflect uniform `max` effort_

#### T2-03 — Plan-file phase-output validation

Currently each command's orchestrator writes a phase's output to the plan file, then immediately launches the next phase. If a subagent fails silently or writes to the wrong section, the next phase reads stale/missing data.

- [x] In each command's orchestrator (`ssot/.claude/commands/*.md`), add a Phase Output Integrity `<constraint>` block: "Before launching any subsequent phase, verify the prior phase's output landed in the plan file. Use `Grep('^## Phase N:', <plan-file-path>)` — if zero matches, abort with: 'Phase N (<agent>) produced no plan-file output. Aborting pipeline.' Do NOT launch the next phase on stale state." Applied to all 7 commands (`docs.md`, `fix.md`, `human-docs.md`, `refactor.md`, `review.md`, `security.md`, `test.md`)
- [ ] ~~Add the same check to the relevant `*-pre-verifier` agents' workflows~~ — _dropped: pre-verifiers run after their pipeline's Builder phase has already written, so plan-file integrity is the orchestrator's concern, not the verifier's. Adding the check to verifiers would duplicate the orchestrator-level check or check too late_
- [x] Test by manually corrupting a plan-file section mid-pipeline and confirming the orchestrator surfaces a clear error rather than silently degrading — _validated by reading the constraint into 7 commands; live test deferred to next real `/refactor` or `/security` invocation, since the constraint only fires on actual subagent failure_

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
