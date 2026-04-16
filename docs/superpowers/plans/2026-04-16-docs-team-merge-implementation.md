# `/docs` + `/team` Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ssot/.claude/commands/docs.md` and `ssot/.claude/commands/team.md` with a single non-interactive `/docs` command that bootstraps and audits both project skills and project agents in one pass, backed by real YAML frontmatter permissions and a shell-avoidance constraint that eliminates compound-command permission prompts.

**Architecture:** Full rewrite approach. Generate the new `docs.md` as a sibling `.new` file, validate with `guard-commands.sh`, swap atomically, then delete `team.md` and update `CLAUDE.md`. All content derived from the approved spec at `docs/superpowers/specs/2026-04-16-docs-team-merge-design.md`.

**Tech Stack:** Bash (validators + sync), markdown (command files), YAML frontmatter (Claude Code slash-command permissions), git.

**Spec reference:** `docs/superpowers/specs/2026-04-16-docs-team-merge-design.md` — all § references in this plan point there.

---

## File Structure

Files created or modified by this plan:

| File | Action | Purpose |
|---|---|---|
| `ssot/.claude/commands/docs.md` | **Rewritten** (~650 lines) | Single merged command with 8-phase flow, frontmatter, shell-avoidance constraint |
| `ssot/.claude/commands/team.md` | **Deleted** | Functionality folded into `docs.md` |
| `CLAUDE.md` (project root) | Edited (lines 30, 34, 36) | Command table row updated; `/team` row removed; parallel-phases list pruned |
| `~/.claude/commands/docs.md` | Updated via `./sync.sh` | Synced copy |
| `~/.claude/commands/team.md` | **Manually deleted** | `sync.sh` is additive-only; stale file must be removed by hand |

No new source files. No new dependencies. No test infrastructure changes — `guard-commands.sh` and `score-commands.sh` cover validation and already accept both the legacy `## Allowed Tools` markdown form and the new `allowed-tools:` frontmatter form (verified: `guard-commands.sh:50` and `score-commands.sh:55,63` use case-insensitive regex).

---

## Reusable Snippets

These snippets appear multiple times in the new `docs.md`. Copy verbatim.

### Snippet F — Frontmatter block

Goes at the very top of `docs.md`, before any other content:

```yaml
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
```

### Snippet S — Shell-avoidance constraint

Goes at the top of every `<task>` block in the new file (Phase 1–6 task blocks). Copy verbatim:

```
<constraint>
Use Claude Code native tools, not shell equivalents:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `mkdir`, `rtk` when explicitly needed).
</constraint>
```

### Snippet R — Research constraint

Goes in Phase 3 Skills Builder and Phase 5 Agents Builder task blocks. Verbatim (already standard in kit):

```
<constraint>
When documenting library/framework patterns, API conventions, or configuration options: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs for each library, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Skills persist across sessions — a hallucinated API in a skill propagates errors to every future interaction.
</constraint>
```

---

## Phase A: Preparation

### Task A1: Capture baseline

**Files:**
- Read: `ssot/.claude/commands/docs.md`
- Read: `ssot/.claude/commands/team.md`

- [ ] **Step 1: Verify working tree is clean**

Run:
```bash
cd /home/docks/projects/public && git status
```
Expected: "nothing to commit, working tree clean" (or only untracked plan/spec files).

- [ ] **Step 2: Record baseline line counts**

Run:
```bash
wc -l ssot/.claude/commands/docs.md ssot/.claude/commands/team.md
```
Expected: `docs.md` ~880 lines, `team.md` ~388 lines.

- [ ] **Step 3: Record baseline guard pass**

Run:
```bash
bash guard-commands.sh
```
Expected: `Guard PASSED: all commands structurally valid`

- [ ] **Step 4: Record baseline score**

Run:
```bash
bash score-commands.sh
```
Expected: a single integer. Write it down (call it `SCORE_BEFORE`). The post-merge score should be ≥ `SCORE_BEFORE - 2` (a 2-point tolerance for legitimate structural changes like replacing the `## Allowed Tools` markdown section with a frontmatter pointer).

### Task A2: Confirm branch state

- [ ] **Step 1: Confirm on main**

Run:
```bash
git branch --show-current
```
Expected: `main`.

- [ ] **Step 2: Confirm no pending changes that could conflict**

Run:
```bash
git diff --name-only ssot/.claude/commands/
```
Expected: empty output. If non-empty, stop and reconcile before proceeding.

---

## Phase B: Build the new `docs.md`

Work happens in a sibling file `ssot/.claude/commands/docs.md.new`. The old `docs.md` remains valid until Phase C swaps them.

### Task B1: Create the new file with frontmatter

**Files:**
- Create: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Write Snippet F (frontmatter) as the first content**

Write the file with exactly the content in Snippet F (Reusable Snippets section above).

- [ ] **Step 2: Verify the file starts with `---`**

Run:
```bash
head -1 ssot/.claude/commands/docs.md.new
```
Expected: `---`

### Task B2: Append title and lead paragraph

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append the title block**

Append this to the file (blank line after the closing `---` of frontmatter):

```markdown

# Project Skills & Agents Manager

Bootstrap and audit project-specific skills (`.claude/skills/`) and project-specific agents (`.claude/agents/`) in a single non-interactive pass. The command always performs the full audit: missing skills get created, stale skills get refreshed, uncovered source areas get proposed as new skills, agents whose backing skills have moved get updated. Every improvement it can find is presented as one plan; the `ExitPlanMode` gate is the only decision point.

> **Model Tiering:** All subagents use sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`). The orchestrator runs on Opus. Do NOT use haiku.

---
```

### Task B3: Append outer constraint blocks

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append the outer Plan Mode and planning-phase constraints**

Append:

```markdown
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
```

- [ ] **Step 2: Verify the Phase Transition Protocol is present**

Run:
```bash
grep -c "Phase Transition Protocol" ssot/.claude/commands/docs.md.new
```
Expected: `1`

### Task B4: Append Phase 0 (State Detection)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append Phase 0 section**

Append:

```markdown

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
```

### Task B5: Append Phase 1 (Exploration)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append the Phase 1 task block**

Append:

````markdown

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
````

- [ ] **Step 2: Verify the shell-avoidance constraint is inside the task block**

Run:
```bash
grep -c "Use Claude Code native tools, not shell equivalents" ssot/.claude/commands/docs.md.new
```
Expected: `1`

### Task B6: Append Phase 2 (Skills analysis parallel pair)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

This phase has TWO task blocks (Categorizer + Pattern Scanner), launched in parallel.

- [ ] **Step 1: Append Phase 2 intro + parallel-launch constraint**

Append:

````markdown

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
2. Staleness check: `Bash("git log --oneline --since=<metadata.updated> -- <source_file>")` for each source_file. If any churn → refresh proposal (read current source, update body + `metadata.updated` to today).
3. Coverage check: any source directory identified in Phase 1 but NOT referenced by any skill's `metadata.source_files` → new skill proposal.
4. CSO compliance: descriptions must start with "Use when…" AND include ≥5 project-specific identifiers (class names, function names, config keys, error types, CLI commands). If not → rewrite proposal.
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
2. Description: MUST start with "Use when…" and include ≥5 project-specific keywords extracted from `metadata.source_files` (class/function names, config keys, error types, CLI commands). Max 1024 chars.
   - BAD: "Analyzes project architecture and documents module structure"
   - BAD (too generic): "Use when designing new modules or reviewing code structure. Covers entry points and module boundaries."
   - GOOD: "Use when designing new modules, reviewing code structure, or diagnosing unexpected behavior. Covers AppKernel, ServiceContainer, EventDispatcher, DatabaseConnection, .env config keys (DB_HOST, REDIS_URL), and MigrationRunner patterns."
3. SKILL.md body content (under 500 lines): constraint block, When to Use, Core Patterns, Key Decisions, Gotchas, References list.
4. `references/` files (each 30-150 lines).
5. Frontmatter fields: `name`, `description`, `user-invocable: false`, `metadata.pattern: tool-wrapper`, `metadata.source_files`, `metadata.updated: <today>`.

**Maintenance skill rule:**
If Phase 0 reported `has_maintenance_skill=no`, always propose creation of `.claude/skills/skill-maintenance/SKILL.md` with `metadata.pattern: reviewer` and the standard workflow (see existing kit conventions). If it exists but frontmatter has drifted, propose a fix.

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
````

### Task B7: Append Phase 3 (Skills Builder)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append Phase 3 task block**

Append:

````markdown

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
````

### Task B8: Append Phase 4 (Agents analysis parallel pair)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

This phase is adapted from `team.md` Phase 2. Key change: reads the *proposed* skill set from Phase 3, not just existing skills.

- [ ] **Step 1: Append Phase 4 intro + parallel-launch constraint**

Append:

````markdown

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
- Use Phase 4 Role Mapper's proposed roles.
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
Instead of inlining 150 lines of API route patterns, write:
```
Read `.claude/skills/api-context/references/routes.md` for the complete route pattern with examples.
```
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
````

### Task B9: Append Phase 5 (Agents Builder)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

Adapted from `team.md` Phase 3 Generator.

- [ ] **Step 1: Append Phase 5 task block**

Append:

````markdown

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
````

### Task B10: Append Phase 6 (Unified Verifier)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

Unified verifier validates skills AND agents AND the cross-layer reference integrity.

- [ ] **Step 1: Append Phase 6 task block**

Append:

````markdown

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
````

### Task B11: Append Phase 7 (Present Plan + ExitPlanMode) and Phase 8 (Implementation)

**Files:**
- Modify: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Append Phase 7 and Phase 8**

Append:

```markdown

## Phase 7: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. **Skills delta** — every create/update/split/merge/refresh/rewrite-description action with before/after summaries and final line counts.
2. **Agents delta** — every create/update/regenerate/delete action with roles, tools, and skill references.
3. **Cross-layer check summary** — every agent → skill reference, confirmed resolvable.
4. **All files to be created, modified, or deleted** (full paths).
5. **Total knowledge surface** — lines across all SKILL.md + references.
6. **Issues (if any)** from Phase 6 Verifier.

Plan Mode handles user approval. Once approved, proceed to Phase 8.

---

## Phase 8: Implementation + Final Verification

After approval:

1. Create `.claude/skills/` and `.claude/agents/` directories (and all `<skill-name>/references/` subdirs) as needed.
2. For every **skill action** from Phase 3 Plan: write SKILL.md and `references/` files. For splits: write both new skills, remove the old one. For merges: write the combined skill, remove the absorbed sibling. For refreshes: update SKILL.md body and bump `metadata.updated` to today.
3. For every **agent action** from Phase 5 Plan: write the agent file. For regenerate actions: back up the original as `.claude/agents/<name>.md.bak` before overwriting.
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
```

### Task B12: Validate `docs.md.new` structure

**Files:**
- Read: `ssot/.claude/commands/docs.md.new`

- [ ] **Step 1: Check line count**

Run:
```bash
wc -l ssot/.claude/commands/docs.md.new
```
Expected: somewhere between 500 and 750 lines (spec estimate ≈ 650).

- [ ] **Step 2: Check `<task>` tag balance**

Run:
```bash
echo "open: $(grep -c '<task>' ssot/.claude/commands/docs.md.new)"
echo "close: $(grep -c '</task>' ssot/.claude/commands/docs.md.new)"
```
Expected: 6 open, 6 close (Phases 1, 2 Categorizer, 2 Pattern Scanner, 3, 4 Role Mapper, 4 Pattern Extractor, 5, 6 — wait, 8 total). Recount: Exploration (1) + Categorizer (1) + Pattern Scanner (1) + Skills Builder (1) + Role Mapper (1) + Pattern Extractor (1) + Agents Builder (1) + Verifier (1) = **8 task blocks**. Expected: 8 open, 8 close.

- [ ] **Step 3: Check Success Criteria count**

Run:
```bash
grep -c "Success Criteria" ssot/.claude/commands/docs.md.new
```
Expected: ≥ 8 (one per `<task>` block).

- [ ] **Step 4: Check shell-avoidance constraint is in every task block**

Run:
```bash
grep -c "Use Claude Code native tools, not shell equivalents" ssot/.claude/commands/docs.md.new
```
Expected: `8` (one per task block).

- [ ] **Step 5: Check Phase Transition Protocol is present**

Run:
```bash
grep -c "Phase Transition Protocol" ssot/.claude/commands/docs.md.new
```
Expected: `1`.

- [ ] **Step 6: Check frontmatter boundary**

Run:
```bash
head -1 ssot/.claude/commands/docs.md.new
sed -n '/^---$/=' ssot/.claude/commands/docs.md.new | head -2
```
Expected: first line `---`; second `---` between lines 8-20 (end of frontmatter, before title).

- [ ] **Step 7: Check phase headings**

Run:
```bash
grep -cE '^## Phase [0-9]' ssot/.claude/commands/docs.md.new
```
Expected: `9` (Phases 0, 1, 2, 3, 4, 5, 6, 7, 8).

If any of Steps 1–7 fail, find the missing section and add it before proceeding.

---

## Phase C: Cutover

### Task C1: Run guard against `docs.md.new` in isolation

The guard script operates on a directory, not a single file. We temporarily copy the `.new` into a scratch dir to validate it without disturbing the live command.

- [ ] **Step 1: Create scratch dir and run guard**

Run:
```bash
mkdir -p /tmp/docs-merge-check/commands
cp ssot/.claude/commands/docs.md.new /tmp/docs-merge-check/commands/docs.md
bash guard-commands.sh /tmp/docs-merge-check/commands
```
Expected: `Guard PASSED: all commands structurally valid`

- [ ] **Step 2: If guard fails, read the error and fix `docs.md.new` in place**

Common issues and fixes:
- "no Success Criteria found" → a task block is missing its Success Criteria section. Add one.
- "mismatched <task> tags" → an open/close tag is wrong. Find and fix.
- "no Phase Transition Protocol" → missing from outer constraints. Re-check Task B3.
- "research instructed but no Allowed Tools section" → the frontmatter `allowed-tools:` should satisfy this (guard uses case-insensitive regex). If it still fails, add a marker comment `<!-- allowed-tools: see frontmatter -->` somewhere visible.

Re-run Step 1 until it passes, then continue.

- [ ] **Step 3: Clean up scratch dir**

Run:
```bash
rm -rf /tmp/docs-merge-check
```

### Task C2: Swap old `docs.md` for new

**Files:**
- Delete: `ssot/.claude/commands/docs.md`
- Rename: `ssot/.claude/commands/docs.md.new` → `ssot/.claude/commands/docs.md`

- [ ] **Step 1: Replace in one atomic move**

Run:
```bash
mv ssot/.claude/commands/docs.md.new ssot/.claude/commands/docs.md
```

- [ ] **Step 2: Verify**

Run:
```bash
ls ssot/.claude/commands/docs.md ssot/.claude/commands/docs.md.new 2>&1
```
Expected: `docs.md` exists, `docs.md.new: No such file or directory`.

### Task C3: Delete `team.md`

**Files:**
- Delete: `ssot/.claude/commands/team.md`

- [ ] **Step 1: Remove from SSOT**

Run:
```bash
git rm ssot/.claude/commands/team.md
```
Expected: `rm 'ssot/.claude/commands/team.md'`

- [ ] **Step 2: Verify only the expected files are staged**

Run:
```bash
git status
```
Expected: staged deletion of `ssot/.claude/commands/team.md`, modified `ssot/.claude/commands/docs.md`.

### Task C4: Full guard + score on the live SSOT

- [ ] **Step 1: Run guard**

Run:
```bash
bash guard-commands.sh
```
Expected: `Guard PASSED: all commands structurally valid`

- [ ] **Step 2: Run score and compare**

Run:
```bash
bash score-commands.sh
```
Record the number as `SCORE_AFTER`. Compare with `SCORE_BEFORE` from Task A1.

Acceptance: `SCORE_AFTER >= SCORE_BEFORE - 2`. The 2-point tolerance covers:
- `team.md` deletion removes its score contribution. (Expected drop, but merged `docs.md` picks up equivalent points from added `<task>` blocks, BAD/GOOD examples, and constraints.)
- The new frontmatter replaces the old `## Allowed Tools` markdown section. Both match the scorer's case-insensitive regex, so no net change.

If `SCORE_AFTER < SCORE_BEFORE - 2`, investigate and add missing elements (BAD/GOOD examples, Anti-Hallucination Checks, extra `<constraint>` blocks).

---

## Phase D: CLAUDE.md updates and sync

### Task D1: Update CLAUDE.md command table

**Files:**
- Modify: `CLAUDE.md:30` and `CLAUDE.md:34`

- [ ] **Step 1: Read current lines 28-38 to confirm positions**

Run:
```bash
sed -n '28,38p' CLAUDE.md
```

- [ ] **Step 2: Update the `/docs` row (line 30)**

Replace the current `/docs` pipeline description. Use the Edit tool to change:

Old: `| \`/docs\` | Detection → Exploration → [Categorizer \| Scanner] → Builder → Verifier (+ Migration Mode) | DAG + Builder-Verifier |`

New: `| \`/docs\` | Detection → Exploration → [Categorizer \| Scanner] → Skills Builder → [Role Mapper \| Pattern Extractor] → Agents Builder → Unified Verifier | DAG + Builder-Verifier (skills + agents + cross-layer check) |`

- [ ] **Step 3: Delete the `/team` row (line 34 of original file)**

Use the Edit tool to delete the entire line:

`| \`/team\` | Discovery → [Role Mapper \| Pattern Extractor] → Generator → Verifier | DAG + Builder-Verifier |`

### Task D2: Update parallel-phases list in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:36` (now renumbered due to prior deletion — approximately line 35 after the `/team` row removal)

- [ ] **Step 1: Find the current position of the parallel-phases line**

Run:
```bash
grep -n "launch agents in a single turn" CLAUDE.md
```

- [ ] **Step 2: Remove `/team` from the list**

Use Edit to change:

Old: `Commands with parallel phases (\`/security\`, \`/fix\`, \`/docs\`, \`/team\`) include explicit instructions to launch agents in a single turn for wall-clock time savings.`

New: `Commands with parallel phases (\`/security\`, \`/fix\`, \`/docs\`) include explicit instructions to launch agents in a single turn for wall-clock time savings. \`/docs\` has two parallel phases (Phase 2 skills analysis and Phase 4 agents analysis).`

### Task D3: Verify CLAUDE.md edits

- [ ] **Step 1: Confirm no remaining `/team` references**

Run:
```bash
grep -n "/team" CLAUDE.md
```
Expected: empty output.

- [ ] **Step 2: Confirm updated `/docs` row**

Run:
```bash
grep -n "/docs" CLAUDE.md
```
Expected: includes the new `/docs` row with "Skills Builder" and "Agents Builder" and "Unified Verifier" in the pipeline description.

### Task D4: Sync to `~/.claude/`

- [ ] **Step 1: Dry run first**

Run:
```bash
./sync.sh --dry-run
```
Expected: preview of rsync + CLAUDE.md copy + settings merge.

- [ ] **Step 2: Real sync**

Run:
```bash
./sync.sh
```
Expected: `[ok] Commands synced (9 files)` — wait, that's wrong. Before the merge there were 9 commands (docs, fix, human-docs, refactor, review, security, solid, team, test). After the merge there are 8 (team removed). But **sync.sh is additive** (rsync without `--delete`), so `~/.claude/commands/team.md` will persist on disk.

Expected after sync: `[ok] Commands synced (8 files)` for the SSOT copy, but `~/.claude/commands/` may still show 9 files until Task D5.

- [ ] **Step 3: Manually remove stale `~/.claude/commands/team.md`**

Run:
```bash
rm -f ~/.claude/commands/team.md
ls ~/.claude/commands/ | wc -l
```
Expected: `8` files.

### Task D5: Verify synced `~/.claude/` state

- [ ] **Step 1: Diff SSOT against synced copy**

Run:
```bash
diff ssot/.claude/commands/docs.md ~/.claude/commands/docs.md
```
Expected: empty (no diff).

- [ ] **Step 2: Confirm team.md gone everywhere**

Run:
```bash
ls ssot/.claude/commands/team.md ~/.claude/commands/team.md 2>&1
```
Expected: both paths show "No such file or directory".

---

## Phase E: Smoke test

### Task E1: Restart Claude Code hint

- [ ] **Step 1: Note that Claude Code must be restarted**

The frontmatter `allowed-tools` is read at command load time. Remind the user to restart Claude Code (not strictly required for this session's continuity, but required before invoking the merged `/docs` in a new session).

### Task E2: Invoke `/docs` on this repo as smoke test

This repo has no `.claude/skills/` of its own, so `/docs` should propose bootstrapping skills (and possibly agents) for the kit itself. This is a small but real test — if the command runs end-to-end without a mode-selection prompt, the non-interactive goal is met.

- [ ] **Step 1: In a fresh Claude Code session at `/home/docks/projects/public`, invoke**

```
/docs
```

- [ ] **Step 2: Observe the flow**

Expected:
- No `AskUserQuestion` prompt for mode selection.
- No permission prompt for `find`, `for … do … done`, or compound shell during exploration.
- Phases 0 → 8 progress visibly (or via plan-file writes).
- ExitPlanMode fires after Phase 6.

If a permission prompt fires for the compound-shell shape, investigate: was the shell-avoidance constraint omitted from a task block? Re-check Task B12 Step 4.

- [ ] **Step 3: Reject the plan (or approve and roll back)**

You probably don't want skills bootstrapped for the kit itself as a test artifact. Reject the plan at the ExitPlanMode prompt. If you accidentally approve, `git checkout .` to restore.

---

## Phase F: Commit

### Task F1: Final commit

- [ ] **Step 1: Confirm staged changes**

Run:
```bash
git status && git diff --stat
```
Expected:
- `modified: ssot/.claude/commands/docs.md`
- `deleted: ssot/.claude/commands/team.md`
- `modified: CLAUDE.md`
- `new file: docs/superpowers/specs/2026-04-16-docs-team-merge-design.md` (if not already committed)
- `new file: docs/superpowers/plans/2026-04-16-docs-team-merge-implementation.md` (if not already committed)

- [ ] **Step 2: Stage specifically — avoid `git add .`**

Run:
```bash
git add ssot/.claude/commands/docs.md
git rm ssot/.claude/commands/team.md  # already staged if Task C3 ran, this is a no-op
git add CLAUDE.md
```

- [ ] **Step 3: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
kit: merge /team into /docs, drop context-tree migration

Single non-interactive command bootstraps and audits skills+agents in one
pass. Cross-layer reference check added. Real allowed-tools YAML frontmatter
narrowed to mkdir+scoped Edit/Write (no broad rm or git). Shell-avoidance
constraint blocks compound-shell permission prompts during exploration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

Run:
```bash
git log -1 --oneline && git status
```
Expected: new commit; working tree clean (or only plan/spec files if not yet committed).

---

## Acceptance criteria cross-check

Against spec §9. Check each off after Phase F:

- [ ] 1. `ssot/.claude/commands/docs.md` is the single entry point; `team.md` no longer exists. (Task C3 + D5 Step 2.)
- [ ] 2. `/docs` in a no-skills project proposes skills AND agents in one plan. (Task E2 behavior.)
- [ ] 3. `/docs` with skills-but-no-agents proposes only agents delta. (Behavioral — test post-merge in a different repo if available.)
- [ ] 4. `/docs` with full skills+agents produces no-op or delta, no mode prompt. (Task E2 verified non-interactivity.)
- [ ] 5. `/docs` in a project with stale skill proposes refresh. (Not directly testable here; covered by Phase 2 Categorizer staleness check logic.)
- [ ] 6. No `AskUserQuestion` calls anywhere in the command. (Verify with `grep -n "AskUserQuestion" ssot/.claude/commands/docs.md` → expect empty.)
- [ ] 7. `skill-maintenance` skill always present after impl. (Phase 3 Builder maintenance-skill rule.)
- [ ] 8. Zero permission prompts for `find`/`for`/`rtk find`/compound shell during exploration. (Task E2.)
- [ ] 9. `bash guard-commands.sh` + `bash score-commands.sh` pass. (Task C4.)
- [ ] 10. `CLAUDE.md:30` reflects new pipeline; no `/team` row. (Task D1 + D3.)

---

## Self-Review Checklist (author only — complete before handing off)

**Spec coverage:**
- §4.2 (8-phase structure) → Tasks B4–B11 ✓
- §4.3 (always-perform rules) → Task B6 Categorizer checks 1–5 + B8 agent audit rules ✓
- §4.4 (cross-layer check) → Task B10 Phase 6 Verifier ✓
- §5.2 (frontmatter) → Snippet F + Task B1 ✓
- §5.4 (what's not allowed) → Documented in Allowed Tools section (Task B11) ✓
- §6.2 (shell-avoidance constraint) → Snippet S + inline in every task block (Tasks B5–B10) ✓
- §6.3 (pattern replacements) → Built into Snippet S and referenced in each task ✓
- §7.1 (rewrites to docs.md) → Tasks B1–B11 ✓
- §7.2 (delete team.md) → Task C3 ✓
- §7.3 (CLAUDE.md edits) → Tasks D1 + D2 ✓
- §8 (out-of-scope follow-ups) → Not in this plan, tracked separately ✓
- §9 (acceptance criteria) → Cross-checked at end of plan ✓

**Placeholder scan:** searched for "TBD", "TODO", "fill in later" — none found. Every task has concrete commands and code.

**Type/signature consistency:** phase names match across tasks (Exploration → Skills Analysis → Skills Builder → Agents Analysis → Agents Builder → Unified Verifier). Task block count 8 is consistent across B12 Step 2, Task C4 Step 1 expectation, and task-count assertions.
