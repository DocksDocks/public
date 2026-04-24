---
name: docs
description: Use when bootstrapping or auditing a project's .claude/skills/ and .claude/agents/ directories. Covers skill health (CSO descriptions, size limits, staleness, coverage gaps), agent generation from skills, skill-maintenance skill creation, and cross-layer reference validation between agents and skills.
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch
  Bash(date) Bash(ls:*) Bash(find:*) Bash(wc:*)
  Bash(git log:*) Bash(git status)
  Bash(rtk:*) Bash(mkdir:*)
  Edit(.claude/skills/**) Edit(.claude/agents/**)
  Write(.claude/skills/**) Write(.claude/agents/**)
---

# Project Skills & Agents Manager

Bootstrap and audit project-specific skills (`.claude/skills/`) and project-specific agents (`.claude/agents/`) in a single non-interactive pass. Every improvement found is presented as one plan; the `ExitPlanMode` gate is the only decision point.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is Phase 7 (ExitPlanMode gate).

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Phase 0: State Detection

Deterministic filesystem inspection — no subagent. Run inline, then immediately launch Phase 1.

1. `Glob(".claude/skills/*/SKILL.md")` → `skills_count`
2. `Glob(".claude/agents/*.md")` → `agents_count` (exclude `*.bak`)
3. `Glob(".claude/skills/skill-maintenance/SKILL.md")` → `has_maintenance_skill` (yes/no)
4. `Bash("date '+%Y-%m-%d'")` → `today`

Write to plan file under `## Phase 0: State`:
- Skills: {skills_count} | Agents: {agents_count} | Maintenance skill: {yes/no} | Today: {today}

## Phase 1: Exploration

Invoke `subagent_type: docs-explorer` with the prompt:

> "Run /docs Phase 1. You are the Explorer. Plan file path: {plan-path}. Read Phase 0 State from the plan file. Map the project profile, enumerate all existing skills and agents with frontmatter parsed, and identify knowledge areas. Write output to the plan file under `## Phase 1: Exploration Results`."

## Phase 2: Skills Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Parallel invocations (in one turn):
- `subagent_type: docs-categorizer` — Prompt: "Run /docs Phase 2a. You are the Categorizer. Plan file: {plan-path}. Load Phase 0 State and Phase 1 Exploration Results. Audit all existing skills and propose the full skill set delta. Write output under `## Phase 2a: Categorizer Proposals`."
- `subagent_type: docs-pattern-scanner` — Prompt: "Run /docs Phase 2b. You are the Pattern Scanner. Plan file: {plan-path}. Load Phase 1 Exploration Results. Extract concrete patterns across all 5 categories with file:line references. Write output under `## Phase 2b: Pattern Scanner Findings`."

After both return, append their outputs to the plan file, then immediately launch Phase 3.

## Phase 3: Skills Builder

Invoke `subagent_type: docs-skills-builder` with the prompt:

> "Run /docs Phase 3. You are the Skills Builder. Plan file: {plan-path}. Load Phase 2a Categorizer Proposals and Phase 2b Pattern Scanner Findings. Draft complete SKILL.md bodies and references/ files for every skill delta. Write output under `## Phase 3: Skills Plan`."

After it returns, append output to the plan file, then immediately launch Phase 4.

## Phase 4: Agents Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Parallel invocations (in one turn):
- `subagent_type: docs-role-mapper` — Prompt: "Run /docs Phase 4a. You are the Role Mapper. Plan file: {plan-path}. Load Phase 1 Exploration Results (existing agents) and Phase 3 Skills Plan (proposed skills). Map proposed skills to agent roles with SRP boundaries and audit existing agents. Write output under `## Phase 4a: Role Mapper Proposals`."
- `subagent_type: docs-pattern-extractor` — Prompt: "Run /docs Phase 4b. You are the Pattern Extractor. Plan file: {plan-path}. Load Phase 3 Skills Plan and Phase 2b Pattern Scanner Findings. Extract constraints, workflows, skill references, and integration points for each agent role. Write output under `## Phase 4b: Pattern Extractor Content`."

After both return, append outputs to the plan file, then immediately launch Phase 5.

## Phase 5: Agents Builder

Invoke `subagent_type: docs-agents-builder` with the prompt:

> "Run /docs Phase 5. You are the Agents Builder. Plan file: {plan-path}. Load Phase 4a Role Mapper Proposals and Phase 4b Pattern Extractor Content. Draft complete agent file content (frontmatter + system prompt) for every agent delta. Write output under `## Phase 5: Agents Plan`."

After it returns, append output to the plan file, then immediately launch Phase 6.

## Phase 6: Unified Verifier

Invoke `subagent_type: docs-verifier` with the prompt:

> "Run /docs Phase 6. You are the Verifier. Plan file: {plan-path}. Validate Phase 3 Skills Plan and Phase 5 Agents Plan against all checks: frontmatter, CSO compliance, size limits, file:line accuracy (spot-check 5+), cross-layer integrity (every agent skill reference must resolve to a Phase 3 path), and replaced-skill sentinel. Write output under `## Phase 6: Verification`."

After it returns, append output to the plan file, then proceed to Phase 7.

## Phase 7: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. **Skills delta** — every create/update/split/merge/refresh/rewrite-description with before/after summaries and line counts.
2. **Agents delta** — every create/update/regenerate/delete with roles, tools, and skill references.
3. **Cross-layer check summary** — every agent → skill reference, confirmed resolvable.
4. **All files to be created, modified, or deleted** (full paths).
5. **Total knowledge surface** — lines across all SKILL.md + references.
6. **Issues (if any)** from Phase 6 Verifier — hard fails block implementation.
7. **Post-implementation cleanup** — `git rm -r .claude/skills/<old-name>/` commands for any skills replaced by splits/merges.

Plan Mode handles user approval. Once approved, proceed to Phase 8.

---

## Phase 8: Implementation + Final Verification

After approval:

1. Create `.claude/skills/` and `.claude/agents/` directories (and all `<skill-name>/references/` subdirs) via `Bash(mkdir -p …)` as needed.
2. For every **skill action** from Phase 3: write SKILL.md and `references/` files. For splits/merges: write the new skill directories; do NOT delete old ones (listed in Phase 7 cleanup instructions). For refreshes: overwrite existing SKILL.md body and bump `metadata.updated`.
3. For every **agent action** from Phase 5: write the agent file. For regenerate: Read existing file, Write its content to `.claude/agents/<name>.md.bak`, then Write new content to `.claude/agents/<name>.md`. For delete: Write stub with `disable-model-invocation: true` and empty description.
4. Verify in-session: all SKILL.md ≤500 lines; all `references/` 30-150 lines; all agent system prompts <200 lines; all agent skill references resolve on disk; `.claude/skills/skill-maintenance/SKILL.md` exists; CLAUDE.md not modified.
5. Report: skills created/updated/split/merged/refreshed, agents created/updated/regenerated, total lines, backup files written.

---

## Allowed Tools

See frontmatter. Planning phases: read-only. Implementation: Edit and Write scoped to `.claude/skills/**` and `.claude/agents/**`.

## Usage

```bash
/docs          # Full audit + generation pass
/docs <path>   # Scoped to a specific directory
```
