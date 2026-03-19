# Context-Aware Agent Generator

Generate project-specific Claude Code agents from project skills. Agents reference `.claude/skills/` and their `references/` files for domain knowledge instead of duplicating it inline, staying slim and always current.

> **Model Tiering:** Subagents default to `sonnet` (via CLAUDE_CODE_SUBAGENT_MODEL).
> Only set `model: "opus"` for quality-critical agents (analyzers, planners, builders, generators).
> Explorers, scanners, verifiers, and synthesizers use the default. Do NOT use haiku.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, find)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(mkdir:*)

---

## Phase 0: Prerequisites

Check if `.claude/skills/*/SKILL.md` exists in the project (use Glob).

- **If NO** → Tell the user: "No project skills found. Run `/docs` first to build them, then run `/team` again." **STOP HERE.**
- **If YES** → Proceed to Phase 1.

---

## Phase 1: Discovery

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project skills and existing agents to determine what agent roles are needed.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Glob `.claude/skills/*/SKILL.md` — read every skill's frontmatter (name, description, metadata)
- Read every SKILL.md body to understand project domains
- List references/ files per skill to understand knowledge depth
- Check if `.claude/agents/` exists — read ALL existing agent files if present
- Identify the project stack from the skills (languages, frameworks, tools)
- Map which skills have enough substance to warrant a dedicated agent

Output:
## Skills Summary
- Skills: [list with names and descriptions]
- Total references files: [count]

## Existing Agents (if any)
[For each: name, scope, quality issues, AI-optimization violations]

## Proposed Agent Roles
[For each skill that warrants an agent: role name, scope, which skill + references it covers]

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Skills summary complete. Existing agents audited. Proposed agent roles mapped to skills.
</task>
```

After the explorer returns, **ask the user** via AskUserQuestion:
1. **Generate new agents** — create agents from scratch based on project skills
2. **Improve existing agents** — audit and rewrite current agents with AI-optimization rules
3. **Both** — improve existing + fill gaps with new agents

---

## Phase 2: Parallel Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

### Role Mapper Agent (Opus)

```xml
<task>
Launch a Task agent as the ROLE MAPPER:

**Objective:** Map project skills to agent roles with clear boundaries, triggers, and tool sets.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for skills structure and existing agents

Map project skills to agent roles. For each proposed agent, determine:

1. **Name** (kebab-case, max 64 chars, no "anthropic"/"claude" in name)
2. **Description** (max 1024 chars) — MUST include:
   - WHAT the agent does (specific domain)
   - WHEN Claude should delegate to it (trigger conditions)
   - Write in 3rd person: "Implements API endpoints following project conventions. Use when creating new routes, modifying request handlers, or adding middleware."
3. **Tools** — minimize to what's needed:
   - Read-only agents: `Read, Grep, Glob, Bash`
   - Implementation agents: `Read, Write, Edit, Grep, Glob, Bash`
   - Never include tools the agent doesn't need
4. **Model**: `opus` (default for all agents)
5. **Domain**: which skills and references/ files this agent covers
6. **Scope boundaries**: what this agent should NOT do (hand off to which other agent)

**Rules:**
- One agent per domain — no overlapping responsibilities
- Not every skill needs an agent — skip skills with minimal content
- Consider cross-cutting agents (e.g., code-reviewer spans conventions + architecture)
- No hard limit on agent count — create as many as the project needs
- Each agent must have a single, clear responsibility (SRP) — if you can't describe the scope in one sentence, split it
- No overlapping responsibilities between agents — if two agents could handle the same task, merge or clarify boundaries

**If improving existing agents:**
- Flag agents with generic descriptions ("helps with code")
- Flag agents with overlapping scopes
- Flag agents duplicating skill content inline
- Propose consolidated/split agents where needed

Output a structured agent roster with roles, boundaries, and integration points.

**Success Criteria:**
Every agent has a single responsibility with no overlapping scope. Every agent has specific trigger conditions in description. No thin agents — each must justify its own file.
</task>
```

### Pattern Extractor Agent (Opus)

```xml
<task>
Launch a Task agent as the PATTERN EXTRACTOR:

**Objective:** Extract concrete patterns, workflows, and constraints from project skills for each agent's system prompt.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output and Role Mapper's proposed roles

For each proposed agent role, read the relevant SKILL.md and references/ files and extract the CONCRETE patterns, workflows, and constraints that should go in the agent's system prompt.

**For each agent, extract:**

1. **Critical constraints** — non-negotiable rules from skills (wrap in `<constraint>` tags)
2. **Workflow steps** — numbered procedures the agent should follow
3. **Key file paths** — which files/directories the agent typically works with
4. **Patterns with code** — actual code snippets from the codebase (with file:line refs)
5. **Gotchas** — concrete failure scenarios from skills
6. **Skill references** — which SKILL.md and references/ files to read for detailed knowledge (NOT inline the content)
7. **Integration points** — when to hand off to other agents

**Key principle: reference, don't duplicate.**
Instead of inlining 150 lines of API route patterns, write:
```
Read `.claude/skills/api-context/references/routes.md` for the complete route pattern with examples.
```
The agent's system prompt should be a WORKFLOW GUIDE, not a knowledge dump.

**Target system prompt size:** 100-200 lines per agent.

Output structured content per agent, clearly delimited.

**Success Criteria:**
Every agent has skill references (not inlined content). Target system prompt size 100-200 lines. Integration points mapped.
</task>
```

## Phase 3: Generator

```xml
<task>
Launch a Task agent with model="opus" to act as the GENERATOR:

**Objective:** Draft complete agent files using role mapper's roster and pattern extractor's findings.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Role Mapper's agent roster and Pattern Extractor's content

You are the GENERATOR. Using the role mapper's roster and the pattern extractor's findings, draft COMPLETE agent files.

**Agent file format:**
```yaml
---
name: kebab-case-name
description: Specific WHAT + WHEN trigger description (max 1024 chars, 3rd person)
tools: [only what's needed]
model: opus
---
```

**AI-OPTIMIZATION RULES for agent system prompts:**
1. **Position priority**: critical constraints at START, gotchas at END
2. **No prose paragraphs**: bullets and tables only
3. **Every claim needs file:line reference or skill reference**
4. **Positive framing**: "Use X (not Y)" instead of "Don't use Y"
5. **Code blocks for patterns**: show actual code, never describe in prose
6. **No AI slop**: strip "important to note", "robust", "elegant", hedging
7. **`<constraint>` XML tags** for non-negotiable rules
8. **Concrete failure scenarios** for gotchas (not vague "be careful")
9. **Example tables**: `| Good | Bad | Why |` for conventions
10. **Markdown only**: no JSON in documentation content

**Agent-specific rules:**
- **Description is the trigger** — be specific about WHEN to delegate
- **Reference skills** — say "Read `.claude/skills/X/references/Y.md`" instead of inlining content
- **Limit tools** — read-only agents get `Read, Grep, Glob, Bash` only
- **Concrete workflows** — numbered steps with conditions
- **Integration points** — specify when to hand off to other agents
- **Target: 100-200 lines** per system prompt (not counting frontmatter)

**System prompt structure for each agent:**
```markdown
# [Role Name]

<constraint>
[Non-negotiable rules — 3-5 max]
</constraint>

## Context
Read these for detailed knowledge:
- `.claude/skills/[skill]/SKILL.md` — [what it covers]
- `.claude/skills/[skill]/references/[topic].md` — [what it covers]

## Workflow
1. [Step with condition]
2. [Step with condition]
...

## Patterns
[Code blocks from codebase with file:line refs]

## Integration
- Hand off to `[agent-name]` when [condition]

## Gotchas
[Concrete failure scenarios with code]
```

Output ALL drafted agent files, clearly delimited with `---` separators.

**Success Criteria:**
All agent files have valid YAML frontmatter. System prompts under 200 lines. Skill references point to existing files. No scope overlaps.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each generated agent file against frontmatter rules, skill references, and scope boundaries.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Generator's agent files as input

You are the VERIFIER. Validate each generated agent file against real project data.

For each agent file:
1. **Frontmatter valid?** name is kebab-case, max 64 chars, no "anthropic"/"claude" in name
2. **Description quality?** Under 1024 chars, written in 3rd person, specific trigger conditions
3. **System prompt size?** Under 200 lines (not counting frontmatter)
4. **Skill references valid?** Every `.claude/skills/` path referenced actually exists (Glob)
5. **Tool set minimal?** No unnecessary tools included
6. **Scope overlaps?** Compare domains between agents — flag any overlap

**AI-optimization spot-check (3+ agents):**
- Critical constraints at START of system prompt?
- Gotchas at END?
- No prose paragraphs?
- Non-negotiable rules in `<constraint>` tags?

Output:
## Per-Agent Verification
[For each agent: name, status (pass/issues), specific problems if any]

## Scope Overlap Report
[Any overlapping responsibilities between agents]

## Summary
- Agents verified: X
- Issues found: Y
- Skill refs validated: Z/total

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Validate all `.claude/skills/` paths referenced actually exist (use Glob)
4. Validate all file paths in output exist (use Glob)

**Success Criteria:**
All frontmatter valid. All skill references verified. Zero scope overlaps between agents.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Generator output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Agent Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Agent roster: name, description, tools, scope
2. Skills and references each agent uses
3. Existing agents to be replaced (if improving)

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation + Verification

After approval:

1. Create `.claude/agents/` directory if needed
2. Write all agent files
3. If improving existing agents: back up originals to `.claude/agents/[name].md.bak`
4. Verify:
   - Each file has valid YAML frontmatter (name, description, tools, model)
   - Each name is kebab-case, max 64 chars, no reserved words
   - Each description is under 1024 chars
   - Each system prompt is under 200 lines
   - All skill references point to existing files
5. Report: agents created/updated, total lines, skill references

---

## Allowed Tools

```yaml
Planning Phase:
- Read
- Glob
- Grep
- Task
- Bash(date)
- Bash(ls:*)
- Bash(find:*)

Implementation Phase:
- Read
- Edit
- Write
- Bash(mkdir:*)
```

## Usage

```bash
# Just run /team — it handles the rest:
# - No project skills? Tells you to run /docs first
# - No agents? Generates them from project skills
# - Has agents? Asks: generate new, improve existing, or both
/team
```
