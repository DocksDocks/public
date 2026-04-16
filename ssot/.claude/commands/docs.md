---
name: docs
description: Use when bootstrapping or auditing a project's .claude/skills/ and .claude/agents/ directories. Covers skill health (CSO descriptions, size limits, staleness, coverage gaps), agent generation from skills, skill-maintenance skill creation, and cross-layer reference validation between agents and skills.
allowed-tools: >-
  Read Grep Glob Task WebFetch WebSearch
  Bash(date) Bash(ls:*) Bash(find:*) Bash(wc:*)
  Bash(git log:*) Bash(git status)
  Bash(rtk:*) Bash(mkdir:*)
  Edit(.claude/skills/**) Edit(.claude/agents/**)
  Write(.claude/skills/**) Write(.claude/agents/**)
---

# Project Skills & Agents Manager

Bootstrap and audit project-specific skills (`.claude/skills/`) and project-specific agents (`.claude/agents/`) in a single non-interactive pass. The command always performs the full audit: missing skills get created, stale skills get refreshed, uncovered source areas get proposed as new skills, agents whose backing skills have moved get updated. Every improvement it can find is presented as one plan; the `ExitPlanMode` gate is the only decision point.

> **Model Tiering:** All subagents use sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`). The orchestrator runs on Opus. Do NOT use haiku.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, WebFetch, WebSearch, Bash(date), Bash(ls), Bash(find), Bash(wc), Bash(git log), Bash(git status), Bash(rtk)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
- See frontmatter `allowed-tools` for the enforced permission surface.
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write (both scoped to `.claude/skills/**` and `.claude/agents/**` via frontmatter)
- Bash(mkdir:*, rtk:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is Phase 7 (ExitPlanMode gate).

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 0: State Detection

Deterministic filesystem inspection — no agent, no branching, no `AskUserQuestion`. Produces counts that Phase 1 uses to orient exploration.

1. `Glob(".claude/skills/*/SKILL.md")` → `skills_count`
2. `Glob(".claude/agents/*.md")` → `agents_count` (ignore any `*.bak` backups)
3. `Glob(".claude/skills/skill-maintenance/SKILL.md")` → `has_maintenance_skill`
4. Run `Bash(date "+%Y-%m-%d")` → `today` (used by every downstream phase)

Write to the plan file under `## Phase 0: State`:
- Skills: {skills_count}
- Agents: {agents_count} (ignoring .bak)
- Has skill-maintenance skill: {yes/no}
- Today: {today}

<constraint>
After Phase 0 completes, immediately launch Phase 1 in the same turn. Do NOT ask the user which mode to run. The command always performs the full audit.
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** Map the project stack, directory structure, existing skills, and existing agents to feed both the skills and agents pipelines.

**Context:**
- Today's date is provided by Phase 0.
- Identify the project stack: languages, frameworks, package managers.
- Map the directory structure using Glob (source dirs, config files, test dirs, docs). Do NOT use `ls` or `find`.
- Count files per directory by processing Glob results in-agent.
- Find existing documentation: README, CLAUDE.md, docs/, .env.example (use Read).
- For every existing skill (from Phase 0 `Glob(".claude/skills/*/SKILL.md")`): Read SKILL.md, parse YAML frontmatter (`name`, `description`, `metadata.source_files`, `metadata.updated`), list all files under its `references/` directory via Glob.
- For every existing agent (Phase 0 `Glob(".claude/agents/*.md")`, excluding `*.bak`): Read the file, extract the frontmatter and any `.claude/skills/...` paths it references.
- Note the project's primary purpose and architecture style.

Output (to plan file under `## Phase 1: Exploration Results`):

## Project Profile
- Stack: [languages, frameworks]
- Size: [file count, LOC estimate]
- Structure: [key directories from Glob]
- Existing docs: [list from Read]

## Existing Skills
[For each skill: name, description (first 120 chars), source_files count, references count, last updated]

## Existing Agents
[For each agent: name, description, skills referenced, tools granted]

## Knowledge Areas Identified
[Candidate topic categories with source locations]

**Constraints:**
- Read-only exploration, no modifications.
- Do NOT skip this phase even when skills_count=0 and agents_count=0 — downstream phases still need the project profile.

**Success Criteria:**
Project stack identified; directory structure mapped via Glob; every existing skill and agent enumerated with frontmatter parsed.
</task>
```

<constraint>
After Phase 1 completes, write results to the plan file under `## Phase 1: Exploration Results`, then immediately launch Phase 2 in the same turn.
</constraint>

## Phase 2: Skills Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next. Each agent runs independently and their results combine in Phase 3.
</constraint>

### Categorizer Agent

```xml
<task>
Launch a Task agent as the CATEGORIZER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** Propose the complete skill set — new skills to create, existing skills to update/split/merge/refresh, and descriptions to rewrite. Operates as both auditor (of existing skills) and designer (of missing ones).

**Context:**
- Today's date is provided by Phase 0.
- Use Phase 1 exploration results for project profile, existing skills, and knowledge areas.

**For existing skills (audit):**
1. Size check: SKILL.md > 500 lines → split proposal. SKILL.md < 50 lines with no `references/` and < 3 distinct claims → merge proposal into most related sibling.
2. Staleness check: `Bash("git log --oneline --since=<metadata.updated> -- <source_file>")` for each source_file. If any churn → refresh proposal.
3. Coverage check: any source directory identified in Phase 1 but NOT referenced by any skill's `metadata.source_files` → new skill proposal.
4. CSO compliance: descriptions must start with "Use when…" AND include ≥5 project-specific identifiers. If not → rewrite proposal.
5. Deleted source: `metadata.source_files` paths that no longer exist (verify with Glob) → remove from array.

**For new skills (design):**
Standard skill domains — use only those that apply:
- `architecture-context` — system design, data flow, module structure, entry points
- `conventions-context` — naming, error handling, logging, code organization patterns
- `api-context` — routes/endpoints, request/response types, auth, versioning
- `testing-context` — framework, mocking strategies, fixtures, test organization
- `dependencies-context` — key packages, internal libs, dependency injection
- `deployment-context` — CI/CD, Docker, env config, build pipeline
- `data-context` — database schema, migrations, ORM patterns, caching

**For each proposed skill (new OR modified):**
1. Skill name (kebab-case).
2. Description: MUST start with "Use when…" and include ≥5 project-specific keywords. Max 1024 chars.

   **Keyword-extraction rules — how to fill the "Covers …" clause:**

   Scan `metadata.source_files` and extract project-specific identifiers that users would type when seeking help:
   - **Class names and exported functions** — e.g., `AuthController`, `parseToken`, `MigrationRunner`.
   - **Config keys and env vars** — e.g., `JWT_SECRET`, `DB_HOST`, `.env` fields.
   - **Error types and error strings** — e.g., `TokenExpiredError`, `ECONNREFUSED`, `401 Unauthorized`.
   - **File types and formats** handled by the domain — e.g., `.xlsx`, `JWT`, `multipart/form-data`.
   - **CLI commands** if the skill covers tooling — e.g., `artisan migrate`, `prisma generate`.
   - **Symptom-level synonyms** — not "authentication" but "login fails", "session expired", "JWT expired".

   Generic category phrases — `entry points`, `module boundaries`, `error propagation`, `request lifecycle`, `state management` — do NOT count toward the ≥5 identifier requirement. A description using only these terms fails the keyword check even if it has 5+ words.

   - BAD: "Analyzes project architecture and documents module structure"
   - BAD (too generic): "Use when designing new modules or reviewing code structure. Covers entry points and module boundaries."
   - GOOD: "Use when designing new modules, reviewing code structure, or diagnosing unexpected behavior. Covers AppKernel, ServiceContainer, EventDispatcher, DatabaseConnection, .env config keys (DB_HOST, REDIS_URL), and MigrationRunner patterns."
3. SKILL.md body content (under 500 lines): constraint block, When to Use, Core Patterns, Key Decisions, Gotchas, References list.
4. `references/` files (each 30-150 lines).
5. Frontmatter fields: `name`, `description`, `user-invocable: false`, `metadata.pattern: tool-wrapper`, `metadata.source_files`, `metadata.updated: <today>`.

**Maintenance skill rule:**
If Phase 0 reported `has_maintenance_skill=no`, always propose creation of `.claude/skills/skill-maintenance/SKILL.md` with `metadata.pattern: reviewer` and the standard workflow. If it exists but frontmatter has drifted, propose a fix.

**Constraints:**
- No hard limit on skill count — create as many as the project needs, but each must justify its own SKILL.md.
- Each SKILL.md: under 500 lines.
- Each `references/` file: 30-150 lines.
- Descriptions MUST be trigger-condition-first (CSO).
- No skill with fewer than 3 distinct claims warrants its own `references/` file — merge into SKILL.md body.

Output: a structured proposal per skill with fields {action: create|update|split|merge|refresh|rewrite-description, name, description, body-plan, references-plan, source_files, updated}.

**Success Criteria:**
Every existing skill audited against all 5 checks with a recommendation. Every uncovered knowledge area has a new-skill proposal OR an explicit "too small to warrant a skill" decision. Maintenance skill covered. All descriptions CSO-compliant with ≥5 project keywords.
</task>
```

### Pattern Scanner Agent

```xml
<task>
Launch a Task agent as the PATTERN SCANNER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** Extract concrete patterns, conventions, and decisions from the codebase with file:line references, grouped by skill domain.

**Context:**
- Today's date is provided by Phase 0.
- Use Phase 1 exploration results for project structure.

Scan the codebase. For each finding, include a file:line reference.

**Extract:**

1. **Architecture Patterns** — entry points and request lifecycle, module boundaries (import graph via Grep), state management, error propagation.
2. **Code Conventions** — file/function/variable naming, import organization, error handling idioms, logging patterns.
3. **API Contracts** (if applicable) — route definitions, auth/middleware chains, request/response shapes.
4. **Testing Patterns** — test file naming and location, mocking/stubbing, fixtures, coverage expectations.
5. **Gotchas** — things that break if done wrong, non-obvious dependencies, legacy patterns to avoid.

Output findings grouped by category with file:line references for every claim.

**Success Criteria:**
Every finding includes a file:line reference. All 5 extraction categories covered. Gotchas include concrete failure scenarios.
</task>
```

<constraint>
After Phase 2 completes (both parallel agents return), append the Categorizer's proposals and Scanner's findings to the plan file under `## Phase 2: Skills Analysis Results`. Then immediately launch Phase 3.
</constraint>

## Phase 3: Skills Builder

```xml
<task>
Launch a Task agent as the SKILLS BUILDER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

<constraint>
When documenting library/framework patterns, API conventions, or configuration options: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs for each library, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Skills persist across sessions — a hallucinated API in a skill propagates errors to every future interaction.
</constraint>

**Objective:** Draft complete content for every skill delta — full SKILL.md bodies and `references/` files for every create/update/split/merge/refresh/rewrite-description action from Phase 2.

**Context:**
- Today's date is provided by Phase 0.
- Use Categorizer's proposal for the action list and descriptions.
- Use Pattern Scanner's findings for content and file:line references.

**For each `refresh` action from Phase 2:**
1. Read the current content of every file listed in the skill's `metadata.source_files` (use the Read tool — do NOT skip this step).
2. Extract the updated patterns, conventions, and file:line references from the current source.
3. Draft the refreshed SKILL.md body reflecting the current state.
4. Update `metadata.updated` to today's date (Phase 0 provided it).
5. If any `metadata.source_files` paths no longer exist (check with Glob), remove them from the array and note the removal in the output.

**AI-OPTIMIZATION RULES — apply to every skill and reference file:**
1. Position priority — critical rules/constraints at START, gotchas/warnings at END (U-shaped attention).
2. Tables for comparisons, bullets for sequences — no prose paragraphs.
3. Every claim needs a file:line reference.
4. Positive framing first — "Use `const` (not `var`)" not "Don't use `var`".
5. Code blocks for patterns — show actual code from the codebase.
6. No AI slop — strip "important to note", inflated adjectives, hedging.
7. Use `<constraint>` XML tags for non-negotiable rules.
8. Concrete failure scenarios for gotchas — show what breaks and why.
9. 3-5 examples for complex rules — use `| Good | Bad | Why |` tables.
10. Markdown only — no JSON in content.

**For each SKILL.md** (`.claude/skills/<name>/SKILL.md`):

```yaml
---
name: <skill-name>
description: Use when <trigger conditions>. Covers <5+ project-specific identifiers>.
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files: ["<paths that inform this skill>"]
  updated: "<today>"
---
```

Body structure (under 500 lines):
1. `# <Skill Title>` — one line
2. `<constraint>` block — 2-4 critical non-negotiable rules
3. `## When to Use` — bullet list of trigger scenarios
4. `## Core Patterns` — tables, code blocks, file:line references (no prose)
5. `## Key Decisions` — 2-5 bullets with file:line references
6. `## Gotchas` — concrete failure scenarios
7. `## References` — list of `references/` files with when-to-read conditions

**For each `references/` file** (`.claude/skills/<name>/references/<topic>.md`):
- Title
- Critical constraints at top
- Detailed content with file:line references
- Code blocks from the codebase
- `| Good | Bad | Why |` examples table
- Gotchas at bottom
- 30-150 lines

**Maintenance skill (if Phase 2 proposed it):**

```yaml
---
name: skill-maintenance
description: Use after modifying project source code, before committing or responding. Check if changed files overlap with any project skill's metadata.source_files and update affected skills.
user-invocable: false
metadata:
  pattern: reviewer
  updated: "<today>"
---
```

Body (under 100 lines): `# Skill Maintenance`, constraint block ("After modifying source files, check if changes affect any project skill. Skip for trivial changes."), `## Workflow` (identify modified files via session recall or `git diff --name-only`, Glob `.claude/skills/*/SKILL.md`, parse each skill's `metadata.source_files`, cross-reference, update affected skills and bump `metadata.updated`), `## When to Skip` (typos, variable renames, single-line bug fixes, test-only changes, dependency updates).

**Do NOT touch CLAUDE.md.** Skills are self-discovering via descriptions — no @imports needed.

Output ALL drafted content for every file, clearly delimited.

**Success Criteria:**
All SKILL.md files under 500 lines. All `references/` files 30-150 lines. All descriptions CSO-compliant with ≥5 project keywords. All claims have file:line references. Maintenance skill content drafted if proposed by Phase 2.
</task>
```

<constraint>
After Phase 3 completes, append the Builder's drafted content to the plan file under `## Phase 3: Skills Plan`. Then immediately launch Phase 4.
</constraint>

## Phase 4: Agents Analysis

Reads the **proposed** skill set (Phase 3 drafts) + existing agents, and proposes the complete agent set.

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

### Role Mapper Agent

```xml
<task>
Launch a Task agent as the ROLE MAPPER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** Map the **proposed** skill set (Phase 3) to agent roles with clear boundaries, triggers, and tool sets. Audit existing agents against the new skill paths.

**Context:**
- Today's date is provided by Phase 0.
- Use Phase 3 Skills Plan for the authoritative skill set (post-create/split/merge/refresh).
- Use Phase 1 exploration results for existing agents.

For each proposed skill that warrants an agent (≥ 3 distinct claims, clear domain boundary), determine:

1. **Name** (kebab-case, max 64 chars, no "anthropic"/"claude" in name).
2. **Description** (max 1024 chars, 3rd person): WHAT the agent does + WHEN Claude should delegate.
   GOOD: "Implements API endpoints following project conventions. Use when creating new routes, modifying request handlers, or adding middleware."
3. **Tools** — minimize to what's needed:
   - Read-only agents: `Read, Grep, Glob, Bash`
   - Implementation agents: `Read, Write, Edit, Grep, Glob, Bash`
   - Never include tools the agent doesn't need.
4. **Model**: `opus` (default for all agents).
5. **Domain**: which proposed skills and `references/` files this agent covers. Paths MUST reference Phase 3's proposed skill set.
6. **Scope boundaries**: what this agent should NOT do (hand off to which other agent).

**Existing agents:**
- If an existing agent's skill references point to paths that no longer exist in the proposed skill set → propose path fix or full regeneration.
- If an existing agent inlines skill content → propose rewrite to reference skill.
- If an agent has generic descriptions ("helps with code") or overlapping scopes → propose consolidation/split.

**Rules:**
- One agent per domain — no overlapping responsibilities.
- Not every skill needs an agent — skip skills with minimal content.
- Consider cross-cutting agents (e.g., code-reviewer spans conventions + architecture).
- Each agent must have a single, clear responsibility (SRP). If you can't describe the scope in one sentence, split it.

Output a structured agent roster with {action: create|update|regenerate|delete, name, description, tools, model, domain (skill paths from Phase 3), boundaries}.

**Success Criteria:**
Every agent has a single responsibility with no overlapping scope. Every agent has specific trigger conditions in its description. Every agent's skill references point to a path in Phase 3's proposed skill set (or explicit note that the path comes from a yet-to-be-proposed skill). No thin agents.
</task>
```

### Pattern Extractor Agent

```xml
<task>
Launch a Task agent as the PATTERN EXTRACTOR:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** For each proposed agent role, extract the CONCRETE patterns, workflows, and constraints that should go in the agent's system prompt — WITHOUT inlining skill content.

**Context:**
- Today's date is provided by Phase 0.
- Derive agent role candidates independently from the Phase 3 Skills Plan — the same skill set the Role Mapper is working from. Do NOT wait for the Role Mapper's output; Phase 4 runs both agents in parallel.
- Use Phase 3 Skills Plan for the proposed skill structure.

**For each agent role, extract:**

1. **Critical constraints** — non-negotiable rules (wrap in `<constraint>` tags).
2. **Workflow steps** — numbered procedures.
3. **Key file paths** — which files/directories the agent typically works with.
4. **Patterns with code** — actual code snippets from the codebase (with file:line refs).
5. **Gotchas** — concrete failure scenarios.
6. **Skill references** — which SKILL.md and `references/` files from the **Phase 3 proposed set** to read. Do NOT inline the content.
7. **Integration points** — when to hand off to other agents.

**Key principle: reference, don't duplicate.**
Instead of inlining 150 lines of API route patterns, write: "Read `.claude/skills/api-context/references/routes.md` for the complete route pattern with examples."
The agent's system prompt should be a WORKFLOW GUIDE, not a knowledge dump.

- BAD: "The agent should know about the project's API patterns and authentication flow"
- GOOD: "Read `.claude/skills/api-context/SKILL.md` for route patterns. Read `.claude/skills/api-context/references/auth-flow.md` when handling login/logout/token-refresh endpoints."

**Target system prompt size:** 100-200 lines per agent.

Output structured content per agent, clearly delimited.

**Success Criteria:**
Every agent has skill references (not inlined content) pointing to Phase 3 proposed paths. Target system prompt size 100-200 lines. Integration points mapped.
</task>
```

<constraint>
After Phase 4 completes (both parallel agents return), append the Role Mapper's roster and Pattern Extractor's content to the plan file under `## Phase 4: Agents Analysis Results`. Then immediately launch Phase 5.
</constraint>

## Phase 5: Agents Builder

```xml
<task>
Launch a Task agent as the AGENTS BUILDER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

<constraint>
When documenting library/framework patterns, API conventions, or configuration options in agent prompts: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs for each library, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Agent prompts persist across sessions — a hallucinated API propagates errors to every future interaction.
</constraint>

**Objective:** Draft complete agent file content for every create/update/regenerate action from Phase 4.

**Context:**
- Today's date is provided by Phase 0.
- Use Role Mapper's roster for structure.
- Use Pattern Extractor's content for system prompts.

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
1. Position priority — critical constraints at START, gotchas at END.
2. No prose paragraphs — bullets and tables only.
3. Every claim needs a file:line reference OR a skill reference.
4. Positive framing — "Use X (not Y)" not "Don't use Y".
5. Code blocks for patterns — show actual code.
6. No AI slop.
7. `<constraint>` XML tags for non-negotiable rules.
8. Concrete failure scenarios for gotchas.
9. `| Good | Bad | Why |` example tables.
10. Markdown only.

**Agent-specific rules:**
- Description is the trigger — be specific about WHEN to delegate.
- Reference skills — "Read `.claude/skills/X/references/Y.md`" instead of inlining content. Paths MUST be from Phase 3 proposed set.
- Limit tools — read-only agents get `Read, Grep, Glob, Bash` only.
- Concrete workflows — numbered steps with conditions.
- Integration points — specify when to hand off to other agents.
- Target: 100-200 lines per system prompt.


**System prompt structure:**

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
**For regenerate actions** (existing agent whose skill paths no longer exist): draft a fresh file; plan to back up the original as `<name>.md.bak` during implementation.

Output ALL drafted agent files, clearly delimited with `---` separators.

**Success Criteria:**
All agent files have valid YAML frontmatter. System prompts under 200 lines. Skill references point to Phase 3 proposed paths. No scope overlaps between agents.
</task>
```

<constraint>
After Phase 5 completes, append the Builder's drafted agent files to the plan file under `## Phase 5: Agents Plan`. Then immediately launch Phase 6.
</constraint>

## Phase 6: Unified Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>

**Objective:** Validate Phase 3 (Skills Plan) and Phase 5 (Agents Plan) against frontmatter rules, size limits, CSO compliance, reference accuracy, and the cross-layer integrity check.

**Context:**
- Today's date is provided by Phase 0.
- Use Phase 3 Skills Plan and Phase 5 Agents Plan as input.

**Skill Checks** (for every skill in Phase 3 Plan):

1. **Frontmatter** — valid YAML. `name`, `description`, `user-invocable: false`, `metadata.pattern`, `metadata.source_files` (array), `metadata.updated` (date) all present. `name` lowercase + hyphens only.
2. **Description / CSO** — starts with "Use when…"; describes triggers, not capabilities; includes ≥5 project-specific identifiers; under 1024 chars.
   - **Keyword density (strict):** descriptions using only generic category terms (`entry points`, `module boundaries`, `error propagation`, etc.) fail this check even if they name 5+ total phrases. Flag as `CSO-vague`.
3. **Size** — SKILL.md ≤ 500 lines. `references/` files 30-150 lines. Flag thin skills (<50 lines, no references).
4. **Reference accuracy** — spot-check 5+ file:line references; verify code at stated line exists.
5. **AI-optimization spot-check** (3+ files) — critical rules at START, gotchas at END, no prose paragraphs, non-negotiable rules in `<constraint>`, no AI slop.
6. **Maintenance skill** — `.claude/skills/skill-maintenance/SKILL.md` present in Phase 3 Plan with `user-invocable: false` and `metadata.pattern: reviewer`.
7. **CLAUDE.md** — not modified by Phase 3.

**Agent Checks** (for every agent in Phase 5 Plan):

1. **Frontmatter** — `name` kebab-case, max 64 chars, no "anthropic"/"claude" in name.
2. **Description** — under 1024 chars, 3rd person, specific trigger conditions.
3. **System prompt size** — under 200 lines (excluding frontmatter).
4. **Tool set** — minimal; no unnecessary tools.
5. **Scope overlaps** — compare domains between agents; flag any overlap.
6. **AI-optimization spot-check** (3+ agents) — same rules as skills.

**Cross-Layer Integrity Check** (critical — this is what the merged command enables):

For every `.claude/skills/<x>/SKILL.md` or `.claude/skills/<x>/references/<y>.md` path referenced by ANY proposed agent in Phase 5 Plan:
- The path MUST exist in the Phase 3 Skills Plan (i.e., the proposed skill set after create/split/merge).
- If an agent references a skill that Phase 3 split into two new skills, flag the agent for path update.
- If an agent references a skill that Phase 3 merged into a sibling, flag the agent for path update.
- If an agent references a skill that neither exists currently nor is proposed — hard fail, Phase 5 must be regenerated.

**Replaced-skill sentinel check:**

For each split/merge action in Phase 3 Plan, the Phase 7 plan presentation MUST include a `git rm -r .claude/skills/<old-name>/` command for the user's post-implementation cleanup. Flag if missing.

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced source file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob).
3. Check function signatures match actual code.
4. Validate all file paths in output exist (use Glob on existing files) OR are in Phase 3 Skills Plan (proposed paths).
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.).

Output:

## Skills Report
[Per-skill: frontmatter / CSO / size / references / AI-opt — pass or specific issue]

## Agents Report
[Per-agent: frontmatter / description / size / tools / overlaps / AI-opt — pass or specific issue]

## Cross-Layer Integrity
[Per-agent: every skill path it references → (exists in Phase 3 Plan: yes/no) → (needs update: yes/no)]

## Issues to Fix
[Prioritized list; hard fails at top]

**Success Criteria:**
All skills and agents pass their respective checks. Every agent's skill references resolve against the Phase 3 Skills Plan. Spot-checked 5+ file:line references. No CLAUDE.md edits in Phase 3. Maintenance skill confirmed.
</task>
```

<constraint>
After Phase 6 completes, append the Verifier's report to the plan file under `## Phase 6: Verification`. The plan file now contains Phases 1–6 results. Then proceed to Phase 7.
</constraint>

## Phase 7: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. **Skills delta** — every create/update/split/merge/refresh/rewrite-description action with before/after summaries and final line counts.
2. **Agents delta** — every create/update/regenerate/delete action with roles, tools, and skill references.
3. **Cross-layer check summary** — every agent → skill reference, confirmed resolvable.
4. **All files to be created, modified, or deleted** (full paths).
5. **Total knowledge surface** — lines across all SKILL.md + references.
6. **Issues (if any)** from Phase 6 Verifier.
7. **Post-implementation cleanup** — any old skill directories replaced by splits/merges remain on disk. List them here with the exact `git rm -r` commands the user should run after reviewing the implementation diff.

Plan Mode handles user approval. Once approved, proceed to Phase 8.

---

## Phase 8: Implementation + Final Verification

After approval:

1. Create `.claude/skills/` and `.claude/agents/` directories (and all `<skill-name>/references/` subdirs) as needed.
2. For every **skill action** from Phase 3 Plan: write SKILL.md and `references/` files. For splits: write the two new skill directories (the old skill's directory is NOT removed — it remains in place for user review, listed in the Phase 7 `git rm -r` cleanup instructions). For merges: write the combined skill as a new directory (the old skills' directories are NOT removed). For refreshes: overwrite the existing SKILL.md body and bump `metadata.updated` to today.
3. For every **agent action** from Phase 5 Plan: write the agent file. For regenerate actions: first Read the existing agent file and Write its content to `.claude/agents/<name>.md.bak`, then Write the new content to `.claude/agents/<name>.md`. For delete actions: overwrite the file with a stub containing `disable-model-invocation: true` and an empty description — the file is NOT removed, just made inert.
4. Verify (in-session):
   - All SKILL.md files exist, ≤ 500 lines, valid frontmatter with `user-invocable: false`.
   - All `references/` files exist, 30-150 lines.
   - All agent files exist, < 200-line system prompts.
   - All skill references in agents resolve to actual files on disk.
   - `.claude/skills/skill-maintenance/SKILL.md` exists.
   - CLAUDE.md not modified.
5. Report: skills created/updated/split/merged/refreshed, agents created/updated/regenerated, total lines, backup files written.

---

## Allowed Tools

See frontmatter `allowed-tools` at the top of this file. The enforced permission surface is:
- Read, Grep, Glob, Task, WebFetch, WebSearch
- Bash: `date`, `ls`, `find`, `wc`, `git log`, `git status`, `rtk *`, `mkdir`
- Edit and Write scoped to `.claude/skills/**` and `.claude/agents/**`

Anything outside this surface will prompt at runtime, which is the intended signal for review.

## Usage

```bash
# Just run /docs — the command handles everything:
# - Always audits every existing skill and agent.
# - Always proposes improvements where possible (new skills for uncovered areas,
#   new agents for skills that warrant them, splits/merges/refreshes as needed).
# - Never asks which mode to run.
# - The ExitPlanMode gate is the only decision point.
/docs
```
