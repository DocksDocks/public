# Context-Aware Agent Generator

Generate project-specific Claude Code agents from the context tree. Agents reference `.claude/context/` leaves for domain knowledge instead of duplicating it inline, staying slim and always current.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## ⚠️ MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute read-only phases** → Discovery and committee discussion
3. **Present Plan** → Show user exactly what agents will be created
4. **Wait for Approval** → User must explicitly approve
5. **Execute implementation** → Only after approval, write agent files

**STOP! Use the EnterPlanMode tool now before continuing.**

---

## Planning Phase Tools (READ-ONLY)
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, find)
- Do NOT use: Write, Edit, or any modifying tools

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
Use the Task tool to launch an explore agent with model="opus":
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
</task>
```

After the explorer returns, **ask the user** via AskUserQuestion:
1. **Generate new agents** — create agents from scratch based on context tree
2. **Improve existing agents** — audit and rewrite current agents with AI-optimization rules
3. **Both** — improve existing + fill gaps with new agents

---

## Phase 2: Parallel Analysis

> **CRITICAL: Launch BOTH agents below in a SINGLE turn.**
> Do NOT wait for one to finish before launching the next.

### Role Mapper Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the ROLE MAPPER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

### Pattern Extractor Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the PATTERN EXTRACTOR:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 3: Committee — Proposer

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PROPOSER. Using the role mapper's roster and the pattern extractor's findings, draft COMPLETE agent files.

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
</task>
```

## Phase 4: Committee — Critic

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the CRITIC. Review each proposed agent for quality, optimization, and correctness.

**Description Quality:**
- Will Claude know WHEN to delegate? Is the trigger specific enough?
- Is the description under 1024 characters?
- Is it written in 3rd person?

**Scope & Overlap:**
- Do any agents have overlapping responsibilities?
- Are scope boundaries clear?
- Is each agent narrow enough (one domain)?

**AI-Optimization Compliance (check all 10 rules on every agent):**
1. Critical constraints at START? Gotchas at END?
2. Any prose paragraphs? Must be bullets/tables.
3. Claims without file:line or context tree references?
4. Negative framing without positive alternative?
5. Patterns in prose instead of code blocks?
6. AI slop phrases?
7. Non-negotiable rules missing `<constraint>` tags?
8. Vague warnings without failure scenarios?
9. Complex rules without example tables?
10. Any JSON in documentation?

**Agent-Specific Checks:**
- Does the agent REFERENCE context tree leaves (not duplicate them)?
- Is the tool set minimal? Any unnecessary tools?
- System prompt under 200 lines?
- Frontmatter valid? (name: kebab-case, no reserved words)
- Workflow steps concrete and actionable?

**Integration:**
- Do handoff conditions make sense?
- Any gaps where no agent covers a domain?

Output:
**Per-Agent Review** (for each: Approve / Modify / Reject with specifics)
**Scope Overlaps** (any conflicts between agents)
**AI-Optimization Failures** (rule number + agent + issue)
**Missing Coverage** (domains without agents that should have them)
</task>
```

## Phase 5: Committee — Synthesizer

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the SYNTHESIZER. Produce the FINAL agent files.

Given the proposer's drafts and critic's feedback:

1. **Fix** all critic issues — scope overlaps, optimization failures, missing references
2. **AI-optimize** every agent — enforce all 10 rules plus 6 agent-specific rules
3. **Trim** system prompts over 200 lines
4. **Verify** all context tree references point to existing leaves (check against _index.json)
5. **Verify** descriptions are specific triggers, not generic

Output the FINAL content for each agent file, clearly delimited:

---
## .claude/agents/[name].md
```yaml
---
[frontmatter]
---
```
[Complete system prompt]

---

Repeat for each agent.

## Team Summary
- Agents: [count]
- Total system prompt lines: [count]
- Context tree leaves referenced: [count]
- Scope coverage: [which branches are covered]
</task>
```

## Phase 6: User Approval Gate

**STOP HERE AND PRESENT THE AGENTS TO THE USER**

1. Show the agent roster: name, description (first line), tools, scope
2. For each agent, show the context tree leaves it references
3. List which existing agents will be replaced (if improving)
4. Wait for explicit approval

**Do NOT proceed without user approval.**

---

## Phase 7: Implementation + Verification

Once user has approved:

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
