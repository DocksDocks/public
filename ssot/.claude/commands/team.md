# Context-Aware Agent Generator

Generate project-specific Claude Code agents from the context tree. Agents reference `.claude/context/` leaves for domain knowledge instead of duplicating it inline, staying slim and always current.

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

Check if `.claude/context/_index.json` exists in the project.

- **If NO** → Tell the user: "No context tree found. Run `/docs` first to build it, then run `/team` again." **STOP HERE.**
- **If YES** → Proceed to Phase 1.

---

## Phase 1: Discovery

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the context tree structure and existing agents to determine what agent roles are needed.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Read `.claude/context/_index.json` — understand all branches and leaves
- Read every branch file in `.claude/context/` to understand project domains
- Check if `.claude/agents/` exists — read ALL existing agent files if present
- Identify the project stack from the context tree (languages, frameworks, tools)
- Map which context branches have enough substance to warrant a dedicated agent

Output:
## Context Tree Summary
- Branches: [list with descriptions]
- Total leaves: [count]

## Existing Agents (if any)
[For each: name, scope, quality issues, AI-optimization violations]

## Proposed Agent Roles
[For each branch that warrants an agent: role name, scope, which leaves it covers]

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Context tree summary complete with all branches and leaves. Existing agents audited. Proposed agent roles mapped to branches.
</task>
```

After the explorer returns, **ask the user** via AskUserQuestion:
1. **Generate new agents** — create agents from scratch based on context tree
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

**Objective:** Map context tree branches to agent roles with clear boundaries, triggers, and tool sets.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for context tree structure and existing agents

Map context tree branches to agent roles. For each proposed agent, determine:

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
5. **Domain**: which context branches/leaves this agent covers
6. **Scope boundaries**: what this agent should NOT do (hand off to which other agent)

**Rules:**
- One agent per domain — no overlapping responsibilities
- Not every branch needs an agent — skip branches with < 2 leaves
- Consider cross-cutting agents (e.g., code-reviewer spans conventions + architecture)
- Max 7 agents total (keep the team manageable)

**If improving existing agents:**
- Flag agents with generic descriptions ("helps with code")
- Flag agents with overlapping scopes
- Flag agents duplicating context tree content inline
- Propose consolidated/split agents where needed

Output a structured agent roster with roles, boundaries, and integration points.

**Success Criteria:**
One agent per domain with no overlapping responsibilities. Every agent has specific trigger conditions in description. Max 7 agents total.
</task>
```

### Pattern Extractor Agent (Opus)

```xml
<task>
Launch a Task agent as the PATTERN EXTRACTOR:

**Objective:** Extract concrete patterns, workflows, and constraints from context tree leaves for each agent's system prompt.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output and Role Mapper's proposed roles

For each proposed agent role, read the relevant context tree leaves and extract the CONCRETE patterns, workflows, and constraints that should go in the agent's system prompt.

**For each agent, extract:**

1. **Critical constraints** — non-negotiable rules from context leaves (wrap in `<constraint>` tags)
2. **Workflow steps** — numbered procedures the agent should follow
3. **Key file paths** — which files/directories the agent typically works with
4. **Patterns with code** — actual code snippets from the codebase (with file:line refs)
5. **Gotchas** — concrete failure scenarios from context leaves
6. **Context tree references** — which leaves to read for detailed knowledge (NOT inline the content)
7. **Integration points** — when to hand off to other agents

**Key principle: reference, don't duplicate.**
Instead of inlining 150 lines of API route patterns, write:
```
Read `.claude/context/api/routes.md` for the complete route pattern with examples.
```
The agent's system prompt should be a WORKFLOW GUIDE, not a knowledge dump.

**Target system prompt size:** 100-200 lines per agent.

Output structured content per agent, clearly delimited.

**Success Criteria:**
Every agent has context tree references (not inlined content). Target system prompt size 100-200 lines. Integration points mapped.
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
3. **Every claim needs file:line reference or context tree reference**
4. **Positive framing**: "Use X (not Y)" instead of "Don't use Y"
5. **Code blocks for patterns**: show actual code, never describe in prose
6. **No AI slop**: strip "important to note", "robust", "elegant", hedging
7. **`<constraint>` XML tags** for non-negotiable rules
8. **Concrete failure scenarios** for gotchas (not vague "be careful")
9. **Example tables**: `| Good | Bad | Why |` for conventions
10. **Markdown only**: no JSON in documentation content

**Agent-specific rules:**
- **Description is the trigger** — be specific about WHEN to delegate
- **Reference context tree** — say "Read `.claude/context/X/Y.md`" instead of inlining content
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
- `.claude/context/[branch]/[leaf].md` — [what it covers]

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
All agent files have valid YAML frontmatter. System prompts under 200 lines. Context tree references point to existing files. No scope overlaps.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each generated agent file against frontmatter rules, context tree references, and scope boundaries.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Generator's agent files as input

You are the VERIFIER. Validate each generated agent file against real project data.

For each agent file:
1. **Frontmatter valid?** name is kebab-case, max 64 chars, no "anthropic"/"claude" in name
2. **Description quality?** Under 1024 chars, written in 3rd person, specific trigger conditions
3. **System prompt size?** Under 200 lines (not counting frontmatter)
4. **Context tree references valid?** Every `.claude/context/` path referenced actually exists (check against `_index.json`)
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
- Context refs validated: Z/total

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Validate all `.claude/context/` paths referenced actually exist (check against _index.json)
4. Validate all file paths in output exist (use Glob)

**Success Criteria:**
All frontmatter valid. All context tree references verified against _index.json. Zero scope overlaps between agents.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Generator output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Agent Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Agent roster: name, description, tools, scope
2. Context tree leaves each agent references
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
   - All context tree references point to existing files
5. Report: agents created/updated, total lines, context references

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
# - No context tree? Tells you to run /docs first
# - No agents? Generates them from context tree
# - Has agents? Asks: generate new, improve existing, or both
/team
```
