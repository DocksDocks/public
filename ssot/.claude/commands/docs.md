# Project Skills Manager

Bootstrap and manage project-specific skills in `.claude/skills/`. Organizes project knowledge (conventions, architecture, patterns, APIs) into Tool Wrapper skills with on-demand references — loaded only when Claude invokes the Skill tool, not at session start.

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
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git log, git status, wc -l, find)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(mkdir:*, git:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY times you stop and wait for user input are:
- Phase 0 when context tree detected (asking about migration)
- Phase 0 in Manage Mode (asking which mode)
- Phase 5 in Bootstrap / Phase 3G in Migration / Phase 4M in Manage (ExitPlanMode gates)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 0: Mode Detection

Check for existing skills and legacy context tree:

1. Glob `.claude/skills/*/SKILL.md` → `has_skills`
2. Check if `.claude/context/_index.json` exists → `has_context_tree`

**Routing:**

- `!has_skills && !has_context_tree` → **Bootstrap Mode** (Phases 1-6) automatically. No need to ask.
- `!has_skills && has_context_tree` → Ask via AskUserQuestion:
  1. **Migrate to skills (Recommended)** — Convert context tree to skills, delete `.claude/context/`
  2. Full audit — Audit existing context tree (legacy)
  3. Add new context — Add to existing context tree (legacy)
  4. Health check only — Report tree status (legacy)
- `has_skills && !has_context_tree` → Ask via AskUserQuestion:
  1. **Full audit** — Check skill health, find stale/uncovered areas, propose updates
  2. **Add new skill** — Add a skill for a new knowledge domain
  3. **Health check only** — Report skill status without changes
  4. **Rebalance** — Merge thin skills, split oversized SKILL.md files
- `has_skills && has_context_tree` → Ask via AskUserQuestion:
  1. **Migrate to skills (Recommended)** — Convert remaining context tree to skills, delete `.claude/context/`
  2. Full audit — Audit existing skills
  3. Add new skill — Add a skill for a new domain
  4. Health check only — Report skill status

---

# MIGRATION MODE

For repos with an existing `.claude/context/` tree. Converts branches to skills, leaves to references.

## Phase 1G: Read Existing Tree

```xml
<task>
Launch a Task agent as the TREE READER:

**Objective:** Read the complete context tree and CLAUDE.md integration for migration.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

**Steps:**
1. Read `.claude/context/_index.json` — extract all branch/leaf metadata, source_files arrays
2. Read every branch file listed in `_index.json`
3. Read every leaf file listed in `_index.json`
4. Read `CLAUDE.md` (project root, or `.claude/CLAUDE.md` if the project uses that path) — identify @context/ imports and Context Tree Maintenance constraint block
5. For each leaf's source_files, verify the source files still exist (Glob)

Output:
## Tree Structure
[Complete branch → leaf mapping with line counts]

## Content Summary
[Per-file: key topics covered, source_files, line count]

## CLAUDE.md Integration
[Exact @import lines and maintenance constraint block to remove]

## Stale References
[Any source_files that no longer exist]

**Success Criteria:**
All branches and leaves read. Source file existence verified. CLAUDE.md integration points identified.
</task>
```

<constraint>
After Phase 1G completes, write results to the plan file under `## Phase 1G: Tree Structure`. Then immediately launch Phase 2G.
</constraint>

## Phase 2G: Convert to Skills

```xml
<task>
Launch a Task agent with model="opus" as the CONVERTER:

**Objective:** Convert every branch/leaf into a skill with SKILL.md + references/ files.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Phase 1G tree structure and content

**For each branch → create a skill:**

1. **Skill name**: Use branch name + `-context` suffix (e.g., `architecture-context`)
2. **Description**: Rewrite branch description to CSO format — MUST start with "Use when..." and describe trigger conditions, NOT workflow steps
   - BAD: "Analyzes project architecture and documents module structure"
   - GOOD: "Use when designing new modules, reviewing code structure, or diagnosing unexpected behavior. Covers entry points, module boundaries, and error propagation."
3. **SKILL.md body**: Combine branch pointer table content + key decisions into Tool Wrapper format:
   - `<constraint>` block with critical rules
   - `## When to Use` with trigger scenarios
   - `## Core Patterns` with tables and code blocks
   - `## Key Decisions` with file:line references
   - `## Gotchas` at bottom
   - `## References` listing references/ files with when-to-read conditions
4. **references/ files**: Each leaf → `references/<leaf-name>.md` (preserve content as-is, only update stale file:line references)
5. **Frontmatter**:
   ```yaml
   ---
   name: <branch>-context
   description: Use when <trigger conditions>.
   user-invocable: false
   metadata:
     pattern: tool-wrapper
     source_files: [<union of all leaf source_files>]
     updated: "<today>"
   ---
   ```

**Additionally, generate a maintenance skill** (`.claude/skills/skill-maintenance/SKILL.md`) — same spec as Bootstrap Mode Builder. This skill auto-triggers after code changes to keep other skills current.

**Constraints:**
- No hard limit on skill count — create as many as the project needs, but each must have enough content to justify its own SKILL.md
- Each SKILL.md under 500 lines
- Each references/ file: 30-150 lines (split or merge if needed)
- Descriptions MUST be trigger-condition-first (CSO)
- Preserve all existing file:line references that are still valid
- Drop references to files that no longer exist

**Also draft CLAUDE.md cleanup:**
- Identify exact lines to remove (@context/ imports, Context Tree Maintenance block)
- Do NOT add anything to CLAUDE.md — skills are self-discovering

Output all converted content clearly delimited per skill.

**Success Criteria:**
Every branch converted to a skill. Every leaf preserved as a references/ file. All descriptions follow CSO format. CLAUDE.md cleanup identified.
</task>
```

## Phase 3G: Verify + Present Plan

```xml
<task>
Launch a Task agent as the MIGRATION VERIFIER:

**Objective:** Validate the conversion and present the migration plan.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Converter's output

**Validate:**
1. **Frontmatter**: Valid YAML, name + description + user-invocable + metadata present
2. **CSO compliance**: All descriptions start with "Use when...", describe triggers not workflows
3. **Size limits**: SKILL.md ≤500 lines, references 30-150 lines
4. **Maintenance skill**: Does `skill-maintenance/SKILL.md` exist with `user-invocable: false`?
5. **Content preservation**: No leaf content lost in migration (compare leaf count vs references count)
5. **Reference accuracy**: Spot-check 5+ file:line references — do they exist?
6. **CLAUDE.md cleanup**: Only removing @context/ and maintenance block, not other content

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify file paths in skill content exist (use Glob)
3. Check function signatures match actual code
4. Validate metadata.source_files paths exist

Output:
## Migration Summary
- Skills to create: [count with names]
- References files: [count]
- Files to delete: .claude/context/ (full directory)
- CLAUDE.md lines to remove: [line numbers]

## Validation Results
[Per-skill: size, CSO, references count]

## Issues
[Any problems found]

**Success Criteria:**
All skills pass validation. All file:line references verified. Migration plan ready.
</task>
```

<constraint>
After Phase 3G completes, write the migration summary and validation results to the plan file, then call `ExitPlanMode`. Plan Mode handles user approval.
</constraint>

## Phase 4G: Execute Migration

After approval:

1. Create `.claude/skills/` directory and all `<skill-name>/references/` subdirectories
2. Write all SKILL.md files
3. Write all references/ files
4. Clean CLAUDE.md (project root or `.claude/CLAUDE.md`): remove `@context/` import block and Context Tree Maintenance constraint block
5. Delete `.claude/context/` directory (full removal: `rm -rf .claude/context/`)
6. Verify:
   - All SKILL.md files exist and are within size limits
   - All references/ files exist and are within size limits
   - CLAUDE.md has no @context/ or maintenance block references
   - `.claude/context/` directory no longer exists
7. Report: skills created, references migrated, context tree removed, CLAUDE.md cleaned

---

# BOOTSTRAP MODE

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project stack, directory structure, and existing documentation for skill bootstrapping.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack: languages, frameworks, package managers
- Map the directory structure: source dirs, config files, test dirs, docs
- Count files per directory to gauge project size
- Find existing documentation: README, CLAUDE.md, docs/, .env.example
- Check for existing .claude/skills/ directory (partial skills)
- Note the project's primary purpose and architecture style


Output:
## Project Profile
- Stack: [languages, frameworks]
- Size: [file count, LOC estimate]
- Structure: [key directories]
- Existing docs: [list]

## Knowledge Areas Identified
[List potential topic categories with source locations]

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Project stack identified, directory structure mapped with file counts, all existing documentation listed.
</task>
```

<constraint>
After Phase 1 completes, write the Explorer's output (Project Profile + Knowledge Areas) to the plan file under `## Phase 1: Exploration Results`. Then immediately launch Phase 2.
</constraint>

## Phase 2: Parallel Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently and their results will be combined by the Builder.

### Categorizer Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the CATEGORIZER:

**Objective:** Propose project skills — names, trigger descriptions, and references/ structure.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration results for project profile and knowledge areas

Based on the exploration results, propose project skills using the Tool Wrapper pattern.

**Standard skill domains** (use only those that apply):
- `architecture-context` — system design, data flow, module structure, entry points
- `conventions-context` — naming, error handling, logging, code organization patterns
- `api-context` — routes/endpoints, request/response types, auth, versioning
- `testing-context` — framework, mocking strategies, fixtures, test organization
- `dependencies-context` — key packages, internal libs, dependency injection
- `deployment-context` — CI/CD, Docker, env config, build pipeline
- `data-context` — database schema, migrations, ORM patterns, caching

**For each skill propose:**
1. Skill name (kebab-case, from domains above)
2. Description: MUST start with "Use when..." and specify trigger conditions using natural language phrases users would say. Max 1024 chars.
   - BAD: "Documents the project architecture including modules and entry points"
   - GOOD: "Use when designing new modules, reviewing code structure, diagnosing unexpected behavior, or onboarding to the codebase. Covers entry points, module boundaries, state management, and error propagation."
3. What goes in SKILL.md body (inline — high-signal content, under 500 lines):
   - constraint block, When to Use, Core Patterns, Key Decisions, Gotchas, References list
4. What goes in references/ (larger detail loaded on demand):
   - List each proposed `references/<topic>.md` file with purpose and estimated lines

**Constraints:**
- No hard limit on skill count — create as many as the project needs, but each must justify its own SKILL.md
- Each SKILL.md: under 500 lines
- Each references/ file: 30-150 lines
- Descriptions MUST be trigger-condition-first (CSO), not capability-first
- No skill with fewer than 3 distinct claims warrants its own references/ file — merge into SKILL.md body

**Success Criteria:**
Every skill has a trigger-condition description. References/ files only proposed where content exceeds SKILL.md body capacity. No thin skills — each must have enough content to justify existence.
</task>
```

### Pattern Scanner Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the PATTERN SCANNER:

**Objective:** Extract concrete patterns, conventions, and decisions from the codebase with file:line references.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration results for project structure

Scan the codebase to extract concrete patterns, conventions, and decisions. For each finding, include file:line references.

**Extract:**

1. **Architecture Patterns**
   - Entry points and request lifecycle
   - Module boundaries (what imports what)
   - State management approach
   - Error propagation strategy

2. **Code Conventions**
   - File/function/variable naming patterns
   - Import organization style
   - Error handling idioms
   - Logging patterns

3. **API Contracts** (if applicable)
   - Route definitions with paths
   - Auth/middleware chains
   - Request/response shapes

4. **Testing Patterns**
   - Test file naming and location
   - Mocking/stubbing approach
   - Fixture patterns
   - Coverage expectations

5. **Gotchas and Warnings**
   - Things that break if done wrong
   - Non-obvious dependencies
   - Legacy patterns to avoid

Output findings grouped by category with file:line references for every claim.

**Success Criteria:**
Every finding includes file:line reference. All 5 extraction categories covered. Gotchas include concrete failure scenarios.
</task>
```

<constraint>
After Phase 2 completes (both parallel agents return), append the Categorizer's skill proposal and Scanner's findings to the plan file under `## Phase 2: Analysis Results`. Then immediately launch Phase 3 (Builder).
</constraint>

## Phase 3: Builder

```xml
<task>
Launch a Task agent with model="opus" to act as the BUILDER:

**Objective:** Draft complete content for every skill — SKILL.md files and references/ files.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use categorizer's skill proposal for structure
- Use pattern scanner's findings for content

You are the BUILDER. Using the categorizer's skill structure and the pattern scanner's findings, draft the COMPLETE content for every skill.

**AI-OPTIMIZATION RULES — apply to ALL skill and reference files:**
These are evidence-based formatting rules for maximum Claude adherence:
1. **Position priority**: critical rules/constraints at START of file, gotchas/warnings at END (U-shaped attention — "lost in the middle" problem)
2. **Tables for comparisons, bullets for sequences**: structured formats get higher adherence than prose. NEVER write prose paragraphs.
3. **Every claim needs a file:line reference**: abstract rules without references are ignored. Always cite `src/path/file.ts:45`
4. **Positive framing first**: write "Use `const` (not `var`)" instead of "Don't use `var`"
5. **Code blocks for patterns**: show actual code from the codebase, never describe function signatures in prose
6. **No AI slop**: strip "important to note", "robust", "elegant", "seamless", hedging ("might", "could possibly", "should probably")
7. **Use `<constraint>` XML tags for critical rules**: these get highest adherence for non-negotiable boundaries
8. **Concrete failure scenarios for gotchas**: show what breaks and why, not vague "be careful" warnings
9. **3-5 examples for complex rules**: few-shot dramatically improves adherence. Use tables for examples: | Good | Bad | Why |
10. **Markdown only**: no JSON in documentation content. 34-38% more token-efficient.

**For each SKILL.md** (`.claude/skills/<name>/SKILL.md`):
```yaml
---
name: <skill-name>
description: Use when <trigger conditions>. <coverage areas>.
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files: ["<paths that inform this skill>"]
  updated: "<today>"
---
```

Body structure (under 500 lines):
1. `# <Skill Title>` — one line
2. `<constraint>` block — 2-4 critical non-negotiable rules for this domain
3. `## When to Use` — bullet list of specific trigger scenarios
4. `## Core Patterns` — tables, code blocks, file:line references (NO prose)
5. `## Key Decisions` — 2-5 bullets with file:line references
6. `## Gotchas` — concrete failure scenarios with code showing what breaks (LAST section before References)
7. `## References` — list references/ files with when-to-read conditions:
   `- references/topic.md — read when [specific trigger]`

**For each references/ file** (`.claude/skills/<name>/references/<topic>.md`):
- Title
- Critical constraints at top (use `<constraint>` tags)
- Detailed content with file:line references for every claim
- Patterns section with actual code blocks from codebase
- Examples table: | Good | Bad | Why |
- Gotchas at bottom with concrete failure scenarios
- Size: 30-150 lines

**Additionally, generate a maintenance skill** (`.claude/skills/skill-maintenance/SKILL.md`):
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

Body (under 100 lines):
1. `# Skill Maintenance` — title
2. `<constraint>` block: "After modifying source files, check if changes affect any project skill. Skip for trivial changes (typos, single-line fixes)."
3. `## Workflow` — numbered steps:
   - Identify files modified in the current session (recall Edit/Write calls or run `git diff --name-only`)
   - Glob `.claude/skills/*/SKILL.md`, parse each skill's `metadata.source_files`
   - For each modified file, check if it appears in any skill's `source_files` array
   - If overlap found: read the affected skill, determine if the change impacts documented patterns
   - If patterns affected: update the skill's content and set `metadata.updated` to today's date
   - If no overlap or change is trivial: skip silently — do NOT mention this skill to the user
4. `## When to Skip` — bullet list: typos, variable renames, single-line bug fixes, test-only changes, dependency updates

**Do NOT touch CLAUDE.md.** Skills are self-discovering via descriptions — no @imports needed.

Output ALL drafted content for every file, clearly delimited.

**Success Criteria:**
All SKILL.md files under 500 lines. All references/ files 30-150 lines. All descriptions start with "Use when..." and describe trigger conditions (CSO). All claims have file:line references. Maintenance skill exists with correct frontmatter.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the Builder's output against skill format, CSO, size, and accuracy criteria.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Builder's complete output as input

You are the VERIFIER. Validate the Builder's output against concrete criteria.

**Frontmatter Compliance:**
- Does each SKILL.md have valid YAML frontmatter with: name, description, user-invocable: false, metadata?
- Is `metadata.source_files` an array of real file paths (verify with Glob)?
- Is `metadata.updated` a valid date?
- Does `name` use only lowercase letters, numbers, and hyphens?

**Description Quality (CSO — Critical):**
- Does each description start with "Use when..."?
- Does the description describe TRIGGER CONDITIONS, not workflow steps or capabilities?
  BAD: "Analyzes project architecture and generates documentation about module structure"
  GOOD: "Use when designing new modules, reviewing code structure, or diagnosing unexpected behavior"
- Does the description include natural language phrases users would say?
- Is each description under 1024 chars?

**Size Compliance:**
- Any SKILL.md over 500 lines? Flag it.
- Any references/ file over 150 lines? Flag for split.
- Any references/ file under 30 lines? Flag as merge candidate into SKILL.md body.
- Any thin skills that should be merged into another? (< 50 lines with no references/)

**Reference Accuracy:**
- Spot-check at least 5 file:line references — do they actually exist?
- Are code patterns correctly described?
- Are conventions actually followed in the codebase (or aspirational)?

**AI-Optimization Spot-Check (check 3+ files):**
1. Critical rules at START, gotchas at END?
2. No prose paragraphs (3+ sentences)?
3. Claims have file:line references?
4. Non-negotiable rules in `<constraint>` tags?
5. No AI slop phrases?

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)

**Maintenance Skill Check:**
- Does `.claude/skills/skill-maintenance/SKILL.md` exist in the output?
- Does it have `user-invocable: false` and `metadata.pattern: reviewer`?
- Is its description a trigger condition (CSO), not a workflow summary?

**CLAUDE.md Check:**
- Was CLAUDE.md left unmodified? (Builder should NOT have touched it — verify)

Output:
## Frontmatter Report
[Per-skill: name, description length, metadata validity]

## CSO Compliance
[Per-skill: description analysis, pass/fail with reason]

## Size Report
[Per-file line counts with pass/fail]

## Reference Accuracy
[Spot-check results]

## AI-Optimization Spot-Check
[Per-file compliance]

## Issues to Fix
[Prioritized list of problems]

**Success Criteria:**
All descriptions pass CSO check. All sizes within limits. Spot-checked 5+ file:line references. CLAUDE.md confirmed unmodified.
</task>
```

<constraint>
After the Verifier produces its results, append the Builder output and Verifier results to the plan file under `## Phase 4: Skills Plan`. The plan file should now contain Phase 1, Phase 2, and Phase 4 results. This is mandatory — implementation reads from this file.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Skill names with trigger descriptions (one-liners)
2. References files per skill
3. All files that will be created (full paths)
4. Total knowledge surface area (lines across all SKILL.md + references)

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation + Verification

After approval:

1. Create `.claude/skills/` directory and all `<skill-name>/references/` subdirectories
2. Write all SKILL.md files
3. Write all references/ files
4. Verify:
   - All SKILL.md files exist and are within size limits (≤500 lines)
   - All references/ files exist and are within size limits (30-150 lines)
   - All descriptions start with "Use when..."
   - All frontmatter has user-invocable: false
   - CLAUDE.md was NOT modified
5. Report: skills created, total lines, breakdown per skill

---

# MANAGE MODE

## Phase 1M: Audit

```xml
<task>
Launch a Task agent as the AUDITOR:

**Objective:** Audit all project skills for size violations, staleness, coverage gaps, description quality, and AI-optimization compliance.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

Glob `.claude/skills/*/SKILL.md` and audit every skill.

**Frontmatter Check:**
For each SKILL.md:
- Parse YAML frontmatter: name, description, user-invocable, metadata
- Verify metadata.source_files paths exist (Glob)
- Verify metadata.updated is present

**Size Check:**
- Read each SKILL.md, count actual lines
- If SKILL.md > 500 lines: flag for split
- If SKILL.md < 50 lines with no references/: flag as merge candidate
- For each references/ file: count lines, flag if >150 or <30

**Staleness Check:**
For each skill's metadata.source_files:
- Run `git log --oneline --since="<metadata.updated>" -- <source_file>` (if git available)
- If source files changed since skill was last updated: flag as potentially stale
- Read flagged skills and compare against current source code

**Coverage Check:**
- Find all source files NOT referenced by any skill's metadata.source_files
- Flag significant uncovered areas for new skill creation
- Check for deleted source files still in metadata.source_files

**Balance Check:**
- Any skill with > 5 references/ files? → recommend split into two skills
- Any skill with 0 references/ and < 50 lines? → recommend merge into another skill

**Description Quality (CSO):**
For each skill:
- Does description start with "Use when..."?
- Does it describe trigger conditions (not capabilities/workflows)?
- Does it include natural language phrases?
- Is it under 1024 chars?

**AI-Optimization Compliance:**
For each SKILL.md and references/ file, spot-check against the 10 rules:
1. Critical rules at START, gotchas at END?
2. No prose paragraphs (3+ sentences)?
3. Claims have file:line references?
4. Non-negotiable rules in `<constraint>` tags?
5. No AI slop phrases?

If the user chose "Health check only": output the audit report and STOP. Do not proceed to further phases.

Output:
## Health Report
- Total skills: [count]
- Total references files: [count]
- Size violations: [list]
- Stale skills: [list with git evidence]
- Coverage gaps: [uncovered source dirs]
- Balance issues: [list]
- CSO failures: [skills with bad descriptions]
- AI-optimization failures: [files + which rules violated]

## Recommended Actions
[Prioritized list of proposed changes]

**Success Criteria:**
Health report covers all skills with actual line counts. Stale skills identified with git evidence. Coverage gaps mapped to source directories. CSO compliance checked for every description.
</task>
```

<constraint>
After Phase 1M completes, write the Auditor's health report and recommended actions to the plan file under `## Phase 1M: Audit Results`. Then immediately launch Phase 2M (Planner).
</constraint>

## Phase 2M: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

**Objective:** Propose specific changes (splits, merges, updates, new skills) based on the audit report.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use audit report for issues to address

You are the PLANNER. Based on the audit report, propose specific changes.

**For splits** (SKILL.md > 500 lines):
- Identify natural domain boundaries in the content
- Propose two new skill names and CSO-compliant descriptions
- Draft content for both new SKILL.md files + redistribute references/

**For merges** (skill < 50 lines, no references):
- Identify the most related sibling skill
- Verify combined SKILL.md < 500 lines
- Draft merged content with updated description

**For stale skills:**
- Read current source code
- Draft updated SKILL.md and/or references/ content reflecting current state
- Update metadata.updated and metadata.source_files

**For coverage gaps:**
- Propose new skill under the most relevant domain
- Draft SKILL.md with CSO-compliant description
- Draft references/ files if content warrants them

**For CSO failures:**
- Rewrite descriptions to trigger-condition format
- Ensure "Use when..." prefix
- Include natural language phrases

**For each proposed change, output:**
1. Action: split/merge/update/create/fix-description
2. Affected files (old and new paths)
3. New content (complete file content)

If the user chose "Add new skill": focus only on creating a new skill. Ask what domain to document if not already clear, then scan relevant source files and draft the skill.

If the user chose "Rebalance": focus only on split/merge actions, skip staleness updates.

**Success Criteria:**
Every proposed change includes complete file content. All new/modified SKILL.md under 500 lines. All descriptions CSO-compliant.
</task>
```

## Phase 3M: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each proposed change against size limits, CSO, reference accuracy, and structural consistency.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Planner's proposed changes as input

You are the VERIFIER. Validate each proposed change against concrete criteria.

For each proposed change:
1. **Splits**: Will both new SKILL.md files be within 500 lines? References 30-150?
2. **Merges**: Will the combined SKILL.md stay under 500 lines?
3. **Updates**: Are file:line references in the new content accurate?
4. **New skills**: Enough content to justify a skill (>50 lines)?
5. **Descriptions**: All follow CSO format? Start with "Use when..."?

Also verify:
- No proposed SKILL.md exceeds 500 lines
- No references/ file exceeds 150 lines or is under 30 lines
- All metadata.source_files paths exist
- Any thin skills that should be merged? (< 50 lines with no references/)

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)

Output:
## Approved Changes
[Changes that pass all checks]

## Changes Needing Adjustment
[Changes with specific issues to fix]

## Rejected Changes
[Changes that would violate constraints, with evidence]

**Success Criteria:**
All proposed SKILL.md under 500 lines. All descriptions CSO-compliant. All file references valid.
</task>
```

## Phase 4M: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. All proposed changes with before/after
2. Files to be created, modified, or deleted

Plan Mode handles user approval. Once approved, proceed to Phase 5M.

---

## Phase 5M: Implementation + Verification

After approval:

1. Execute all approved changes (create/edit/delete files)
2. Update metadata.updated in modified SKILL.md frontmatter
3. Verify:
   - All SKILL.md files exist and are within size limits
   - All references/ files within size limits
   - All descriptions CSO-compliant
   - metadata.source_files paths valid
4. Report changes made

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
- Bash(wc:*)
- Bash(git log:*)
- Bash(git status)

Implementation Phase:
- Read
- Edit
- Write
- Bash(mkdir:*)
- Bash(rm:*)
- Bash(git:*)
```

## Usage

```bash
# Just run /docs — the command handles the rest:
# - No skills or tree? Bootstraps skills automatically
# - Context tree found? Offers migration to skills (recommended)
# - Skills exist? Asks what you want to do (audit, add, health check, rebalance)
/docs
```
