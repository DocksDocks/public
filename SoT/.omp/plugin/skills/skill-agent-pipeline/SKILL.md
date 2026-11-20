---
name: skill-agent-pipeline
description: "Use when bootstrapping or auditing a project's skills and agents — skill health (CSO descriptions, caps, staleness, coverage gaps), ref/snippet accuracy audit vs current source, pattern extraction with evidence, SKILL.md + references/ authoring with durable anchors. Emits omp task agents (.omp/agents/*.md); phases gate through the plan lifecycle. Not for AGENTS.md nodes (use context-tree), single-skill refresh after source changes (use skill-maintenance), one-shot full repo setup (use agent-first-setup), or README prose."
user-invocable: true
metadata:
  pattern: pipeline
  updated: "2026-11-20"
  content_hash: "5e52e014546210f82003126d4e5dea92424b443cbbb765862cdfaa570ebf76a1"
---

# Skills & Agents Pipeline

Bootstrap and audit a project's skills (`.agents/skills/`) plus its omp task agents (`.omp/agents/*.md`) in one sequential pass: explore, propose the skill-set delta, extract codebase patterns, draft skills, verify, then either report or implement according to the current request. The pipeline needs no slash command, no subagent dispatch, and no Plan Mode. Each phase's expertise lives in `references/<phase>.md`; this body is the orchestration.

<constraint>
Single-agent sequential. Execute the phases IN ORDER, in THIS context. Before running each phase, read its `references/<phase>.md` and apply it. Hand each phase's output to `plan-manager` under the exact `### Phase` subheading shown as you finish it, so a mid-run compaction can resume from the issue body.
</constraint>

<constraint>
One agent format: omp task agents. Phases 4a/4b/5 draft each logical agent as `.omp/agents/<name>.md` with omp frontmatter (`references/agents-builder.md`). omp discovers project agents only in `.omp/agents/` and skips `.claude/agents/`, so Phases 0 and 1 report each `.claude/agents/*.md` as legacy and route it to `agent-first-setup` (`convert-agent`). This pipeline does not read `.codex`. An agent that delegates names its child agents in `spawns`; omp stops nested delegation at `task.maxRecursionDepth` (default 2).
</constraint>

<constraint>
Intent controls the plan handoff, not Plan Mode. Hand the full skills/agents report to `plan-manager`, which files it as a plan issue with `plan.mjs new --title <t> --goal <g>`. Route label and workspace setup to `plan-workspace`; the unified `plan-manager` owns canonical-plan creation, fresh review, lifecycle, implementation/delegation, verification, and finish/archive. An audit-only or plan-only request stops after the reviewed report. A bootstrap, refresh, or implementation request continues directly into Phase 7 after the manager records the reviewed start checkpoint; no additional user lifecycle command is required.
</constraint>

Prerequisite: the docks-kit kit plugin (`docks-kit-omp`) must be installed. If `plan-workspace` or `plan-manager` is unavailable, STOP, name the missing docks-kit kit plugin, and do not create or mutate a plan.

## When to use

- Standing up `.agents/skills/` and `.omp/agents/` in a project that has none, or auditing existing skills and agents for drift.
- After a refactor changed documented patterns and skills need a refresh.
- When skill descriptions stopped triggering (CSO drift) or a SKILL.md outgrew its size budget.

## When NOT to use

| Situation | Use instead |
|---|---|
| AGENTS.md context nodes | `context-tree` (README and other human prose are out of the kit's scope) |
| One-shot full repo setup (root `AGENTS.md`, CLAUDE.md migration, `.claude/` cleanup, context tree, agent-first check) | `agent-first-setup` |
| Writing one skill by hand | `write-skill` |
| Legacy `CLAUDE.md` or `.claude/CLAUDE.md` content to move into `AGENTS.md` | `claude-md-migration` |
| A missing root `AGENTS.md`, or `.claude/` skills, agents, and settings to clean up | `agent-first-setup` |
| Security / refactor analysis | `security` / `refactor` |

## Pipeline

Run in order. Each phase reads its reference, then hands its output to `plan-manager` under the exact subheading shown. The plan helper accepts only its fixed `##` sections (see `skills/plan-manager/references/plan-contract.md` inside the installed docks-kit kit plugin) and rejects any other `##` heading. So every phase writes a `###` subheading inside `## Research`, and each block inside a phase uses `####` or lower. Phases 0–6 are an assessment before any change, so all of their output is research. The Skills Plan and the Agents Plan also go in `## Research`: they hold full drafted file bodies, and the contract's `## Steps` holds only its one-row-per-task table, so `plan-manager` writes Steps rows that point at the drafts. Phase 6 checks drafts, not landed files, so `## Verification Results` stays for Phase 7 evidence. Phase 0 is inline (no reference). The subheading is the resume anchor — keep it verbatim.

| # | Phase | Reference | Output section → subheading |
|---|---|---|---|
| 0 | State detection (counts, today) | — | `## Research` → `### Phase 0: State` |
| 1 | Exploration (profile, enumerate skills/agents, knowledge areas) | `references/explorer.md` | `## Research` → `### Phase 1: Exploration Results` |
| 2a | Skills categorization (the delta) | `references/categorizer.md` | `## Research` → `### Phase 2a: Categorizer Proposals` |
| 2c | Content-accuracy audit (every ref/snippet/identifier vs current source) + prompt-style sub-check | `references/content-auditor.md` | `## Research` → `### Phase 2c: Content-Accuracy Audit` |
| 2b | Pattern scan (file:line evidence) | `references/pattern-scanner.md` | `## Research` → `### Phase 2b: Pattern Scanner Findings` |
| 3 | Skills builder (draft SKILL.md + references/) | `references/skills-builder.md` | `## Research` → `### Phase 3: Skills Plan` |
| 4a | Agent role mapping | `references/role-mapper.md` | `## Research` → `### Phase 4a: Role Mapper Proposals` |
| 4b | Agent pattern extraction | `references/pattern-extractor.md` | `## Research` → `### Phase 4b: Pattern Extractor Content` |
| 5 | Agents builder (draft `.omp/agents/<name>.md`) | `references/agents-builder.md` | `## Research` → `### Phase 5: Agents Plan` |
| 6 | Verification (skills + agents + cross-layer + behavioral grading) | `references/verifier.md` | `## Research` → `### Phase 6: Verification` |

## How to run each phase

1. Anchor the date once (`date "+%Y-%m-%d"`) and record scope (a path argument, or the whole project).
2. **Phase 0** (inline): count `.agents/skills/*/SKILL.md`, `.claude/skills/*/SKILL.md`, `.omp/agents/*.md`, and legacy `.claude/agents/*.md` (omp does not load them; each one routes to `agent-first-setup` `convert-agent`); note whether a local `skill-maintenance` exists and whether the plugin skill `skill-maintenance` is available (a stale local copy is flagged for REMOVAL in Phase 2a, not regenerated); write the counts + today under `### Phase 0: State` in `## Research`.
3. Ask `plan-manager` to create the canonical issue with `plan.mjs new --title <t> --goal <g>` and own every lifecycle write. In a repository without a GitHub remote, use `docs/skills-audit-<YYYYMMDD>.md` as an untracked fallback. Run Phases 1→2a→2c→2b→3. **Phase 2c is mandatory and always runs** — it audits every existing skill and agent claim against current source (git history and `metadata.updated` are never accuracy evidence; its prompt-style sub-check uses git history only to find where a rule came from); write its table even when all-clean, never skip. After 2c, **reconcile**: amend the `### Phase 2a` block in place to escalate each non-CLEAN skill to REFRESH/REWRITE (`→ escalated by 2c: …`), and route each non-CLEAN agent to the Phase 5 regenerate list — so the handoff reads one delta.
4. **Agent track:** run Phases 4a→4b→5 — they draft each agent as `.omp/agents/<name>.md`.
5. Run Phase 6 (verifier). It validates skills and the omp agent files, plus cross-layer integrity, and grades any behavioral check of a drafted or refreshed skill (quoted evidence, no partial credit).
6. Before starting each phase, confirm the prior `### Phase` subheading is present. If a phase found nothing, write "no changes" under its subheading — never silently skip.
7. After Phase 6, hand off the plan (see Review handoff + implementation).

## The plan record (IPC + deliverable)

The plan issue holds the whole run — inter-phase memory and the implementation spec.

```text
GitHub issue #<n> labeled plan, plan:drafting (created and managed by plan-manager)
```

Hand phase output to `plan-manager` as you go — never hold all of it in context and dump it at the end. Downstream phases read the issue with `plan.mjs show <issue> --body` and locate prior output by grepping for the `### Phase` subheadings above. Never add a new `##` heading: the helper rejects any `##` heading outside its fixed sections.

## Skill description quality (Phase 2a / 3)

Every proposed description starts `Use when…`, ends with a `Not for …` clause (name the sibling skill to use instead when one exists), is valid YAML when parsed as frontmatter, is ≤1024 chars (the agentskills.io specification cap), and carries ≥5 identifiers specific to THIS project — exported names, config keys, env vars, error types, CLI commands, route patterns. Quote descriptions by default. Generic phrases ("module boundaries", "error handling") count for nothing. Every drafted body follows the durable-fact rules in `references/skills-builder.md` § Durable anchors; Phase 6 hard-fails a body that breaks them.

| | Example |
|---|---|
| BAD | "Use when working with the API and database operations in the project." |
| GOOD | "Use when editing `routes/checkout.ts`, touching the `STRIPE_WEBHOOK_SECRET` env var, handling the `CartExpiredError`, or running `pnpm seed:orders` — covers the order-state machine and idempotency keys. Not for generic React UI work (use frontend-patterns)." |

## Review handoff + implementation

Phases 1–6 are read-only. After Phase 6:

1. Hand the Skills delta + Agents delta + cross-layer summary + every file to create/modify/delete to `plan-manager` for the plan issue.
2. For an audit-only or plan-only request, report the reviewed plan issue and counts, then stop. For a bootstrap, refresh, or implementation request, give the complete report to the unified `plan-manager`; after it files the report, completes its bounded review, and records the reviewed start checkpoint, continue immediately into Phase 7 without a manual lifecycle prompt.
3. Run **Phase 7 — Implementation**: write the SKILL.md + `references/` files and the agent files as `.omp/agents/<name>.md` (never a `.claude/agents/` file); for regenerated agents AND any SKILL.md being split into `references/`, back up the original first (`<name>.md.bak`, plus each new `references/*.md` for a split) and copy relocated prose **verbatim** (reformat OK, reword NOT); apply any 1024-char description fixes flagged in Phase 2a; if a stale local `skill-maintenance` was flagged, remove it only after explicit user approval (the plugin skill `skill-maintenance` already covers it). Bump `metadata.updated` only on real content change. If the project documents a `metadata.content_hash` contract and the matching tool exists, sync it after all content changes, not before. Record the Phase 7 check commands and their results (for example the split check below) under `## Verification Results`.
4. Do NOT touch `AGENTS.md` / `CLAUDE.md` here. Nested `AGENTS.md` nodes and the root routing table belong to `context-tree`; the content of legacy `CLAUDE.md` files belongs to `claude-md-migration`; a missing root `AGENTS.md` and the `.claude/` cleanup belong to `agent-first-setup`, which is also the one-pass setup.

## References

| Read before running | File |
|---|---|
| Phase 1 — profile, enumerate skills/agents, knowledge areas | `references/explorer.md` |
| Phase 2a — the skill-set delta (create/update/split/merge/refresh) | `references/categorizer.md` |
| Phase 2c — content-accuracy audit of every existing claim vs current source, plus the prompt-style sub-check (pressure language, history narratives, trigger lists, one-incident rules; keep list) | `references/content-auditor.md` |
| Phase 2b — codebase pattern extraction with file:line | `references/pattern-scanner.md` |
| Phase 3 — draft SKILL.md bodies + references/ splits | `references/skills-builder.md` |
| Phase 4a — map skills → agent roles | `references/role-mapper.md` |
| Phase 4b — extract per-agent system-prompt content | `references/pattern-extractor.md` |
| Phase 5 — draft omp task agents (`.omp/agents/<name>.md`) | `references/agents-builder.md` |
| Phase 6 — validate skills, agents, cross-layer integrity; grade behavioral checks | `references/verifier.md` |

## Verification (Phase 6 + after any SKILL.md split — fail loud)

Splitting a `SKILL.md` into `references/` is a content transform — guard against silent loss with **per-section presence**, not a byte-percentage (the split adds pointers, so output ≥ input).

```bash
# before splitting:  cp <skill>/SKILL.md /tmp/skill.before
# every original section heading must survive across the new SKILL.md + references/
grep -E '^#{1,3} ' /tmp/skill.before | sed -E 's/^#{1,3} +//' | while IFS= read -r h; do
  grep -rqF "$h" <skill>/SKILL.md <skill>/references/ || echo "LOST SECTION: $h"
done
# line-parity tripwire: relocated content is verbatim, so the sum must not shrink
before=$(wc -l < /tmp/skill.before)
after=$(cat <skill>/SKILL.md <skill>/references/*.md | wc -l)
awk -v b="$before" -v a="$after" 'BEGIN{ if (a < b) print "NET SHRINK after split — content dropped" }'
```

Any `LOST SECTION` / `NET SHRINK` line ⇒ restore from `/tmp/skill.before`, locate the content; no content loss across the split. Phase 6's verifier (`references/verifier.md`) runs this for every split skill.

## Gotchas

| Gotcha | Consequence | Right move |
|---|---|---|
| Reading an explicit agent `tools` list as a hard sandbox | omp adds MCP, extension, and custom tools to every explicit list, so the agent can still call them | Give the agent the smallest omp tool list, and state the extra tools in the report; do not promise a read-only agent from `tools` alone |
| An agent body that relies on `AGENTS.md` or the chat history | A task subagent gets no `AGENTS.md` context file and no conversation history, so it works without the project rules | Name every source in the body: `autoload-skills`, a `skill://<name>/references/<file>.md` read, or an explicit file read |
| A delegating agent with an explicit `tools` list and no `spawns` | Without `task` in `tools`, the agent cannot delegate. With `task` in `tools`, omp sets `spawns: *`, so the agent may spawn any agent | List the child agents in `spawns` to limit the scope; omp then adds `task` while the depth allows it. Nested delegation stops at `task.maxRecursionDepth` (default 2) |
| An agent named like a bundled agent (`task`, `scout`, `sonic`, `reviewer`, `security-reviewer`) | The project agent replaces the bundled one for every spawn in the project | Pick another name unless the override is the goal, and state the override in the report |
| Counting `.claude/agents/*.md` files as live agents | omp skips `.claude/agents/`, so those agents never run | Report them as legacy in Phases 0 and 1 and route them to `agent-first-setup` (`convert-agent`) |
| A pre-existing skill's description exceeds 1024 chars | It breaks the agentskills.io specification cap, and a loader that validates against the specification rejects the skill | Phase 2a flags it `rewrite-description`; Phase 6 hard-fails until fixed |
| Treating an implementation request as plan-only | Makes the user schedule an internal lifecycle transition | After manager review, continue into Phase 7 automatically; stop only for assessment-only intent or a real blocker |
| Bumping `metadata.updated` on a no-op regeneration | Timestamp churn; defeats staleness triage | Bump only on real content change; sync hashes only when the current project documents that contract |
| Declaring a skill accurate from a git-delta or a 5-ref spot-check | Pre-baseline drift and fictional APIs ship unseen | Phase 2c opens EVERY ref/snippet/identifier vs current source and states the count verified; `metadata.updated` is not accuracy evidence |
| SKILL.md body crossing 310 lines | The agentskills.io specification advises a body under 5000 tokens and 500 lines; 310 lines is the kit line budget inside that advice; the verifier hard-fails 310–500 lines with no `references/` | Split detail into `references/<topic>.md` (30–150 lines) |
| Unquoted `description:` contains `: ` or `#` | A YAML loader cannot read the description, or reads a cut-off one | Quote every generated description and parse the frontmatter with a YAML parser; `omp skill list --json` lists a project skill with invalid YAML or a description over 1024 chars without a warning |
| Agent skill-references pointing at pre-split paths | Agents land with broken references | Phase 4–5 must reference Phase 3's proposed paths, not old ones |
| Editing AGENTS.md / CLAUDE.md from this pipeline | Scope bleed; clobbers project config | Nested nodes and the routing table → `context-tree`; legacy `CLAUDE.md` content → `claude-md-migration`; root `AGENTS.md` and `.claude/` cleanup → `agent-first-setup` |

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
