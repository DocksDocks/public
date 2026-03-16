# Context Tree Manager

Bootstrap and manage a B-tree-inspired context hierarchy in `.claude/context/`. Organizes project knowledge (conventions, architecture, patterns, APIs) into size-bounded files with an index for on-demand retrieval and self-maintenance.

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
- Phase 0 in Manage Mode (asking which mode)
- Phase 5 in Bootstrap / Phase 4M in Manage (User Approval Gates)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 0: Mode Detection

Check if `.claude/context/_index.json` exists in the project:

- **If NO** → Execute **Bootstrap Mode** (Phases 1-6) automatically. No need to ask — bootstrap is the only option.
- **If YES** → **Ask the user** what they want to do using AskUserQuestion with these options:
  1. **Full audit** — Check tree health, find stale/oversized nodes, propose updates (runs all Manage phases)
  2. **Add new context** — Add a new topic to an existing branch (ask which branch and topic)
  3. **Health check only** — Report tree status without making any changes (runs Phase 1M only, then stops)
  4. **Rebalance** — Focus on splitting oversized nodes, merging small ones, fixing structure

---

# BOOTSTRAP MODE

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project stack, directory structure, and existing documentation for context tree bootstrapping.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack: languages, frameworks, package managers
- Map the directory structure: source dirs, config files, test dirs, docs
- Count files per directory to gauge project size
- Find existing documentation: README, CLAUDE.md, docs/, .env.example
- Check for existing .claude/context/ directory (partial tree)
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
Launch a Task agent as the CATEGORIZER:

**Objective:** Categorize all discoverable project knowledge into branches with leaf topics and size estimates.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration results for project profile and knowledge areas

Based on the exploration results, categorize all discoverable project knowledge into branches.

**Standard branch categories** (use only those that apply):
- `architecture` — system design, data flow, module structure, entry points
- `conventions` — naming, error handling, logging, code organization patterns
- `api` — routes/endpoints, request/response types, auth, versioning
- `testing` — framework, mocking strategies, fixtures, test organization
- `dependencies` — key packages, internal libs, dependency injection
- `deployment` — CI/CD, Docker, env config, build pipeline
- `data` — database schema, migrations, ORM patterns, caching

**For each branch propose:**
1. Branch name and 1-line description
2. Leaf topics within that branch (each should be 30-150 lines of content)
3. Which source files inform each leaf (`source_files` mapping)
4. Estimated line count per leaf

**Constraints:**
- Max 7 branches (keep tree shallow)
- Max 8 leaves per branch
- Each leaf: 30-150 lines target
- Each branch summary: 40-80 lines target
- Total @imported branches must expand to under 200 lines combined

Output a structured tree proposal with line estimates.

**Success Criteria:**
Every branch has 1-8 leaves with realistic line estimates. Total @imported branches expand to under 200 lines combined.
</task>
```

### Pattern Scanner Agent (Opus)

```xml
<task>
Launch a Task agent as the PATTERN SCANNER:

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
After Phase 2 completes (both parallel agents return), append the Categorizer's tree proposal and Scanner's findings to the plan file under `## Phase 2: Analysis Results`. Then immediately launch Phase 3 (Builder).
</constraint>

## Phase 3: Builder

```xml
<task>
Launch a Task agent with model="opus" to act as the BUILDER:

**Objective:** Draft complete content for every file in the context tree using categorizer's structure and scanner's findings.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use categorizer's tree proposal for structure
- Use pattern scanner's findings for content

You are the BUILDER. Using the categorizer's tree structure and the pattern scanner's findings, draft the COMPLETE content for every file in the context tree.

**AI-OPTIMIZATION RULES — apply to ALL branch and leaf files:**
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

**For each branch file** (`.claude/context/<branch>.md`):
- Title + 1-2 line summary
- Pointer table: | Topic | File | Summary |
- Key decisions (2-5 bullets with file:line references)
- Keep under 80 lines
- Structure: critical info first → pointer table → key decisions → warnings last

**For each leaf file** (`.claude/context/<branch>/<topic>.md`):
- Title
- Critical constraints at top (use `<constraint>` tags for non-negotiables)
- Detailed content with file:line references for every claim
- Patterns section: actual code blocks from codebase (not prose descriptions)
- Examples table: | Good | Bad | Why | (for conventions/style rules)
- Gotchas section at bottom: concrete failure scenarios with code showing what breaks
- Keep under 150 lines

**For `_index.json`:**
```json
{
  "version": 1,
  "created": "<today>",
  "updated": "<today>",
  "config": { "max_leaf_lines": 150, "min_leaf_lines": 30, "max_branch_lines": 80 },
  "branches": [
    {
      "name": "<branch>",
      "file": "context/<branch>.md",
      "description": "<1-line>",
      "lines": <count>,
      "updated": "<today>",
      "imported": true,
      "leaves": [
        {
          "name": "<topic>",
          "file": "context/<branch>/<topic>.md",
          "description": "<1-line>",
          "lines": <count>,
          "updated": "<today>",
          "source_files": ["<paths>"]
        }
      ]
    }
  ]
}
```

**For the slimmed CLAUDE.md** (CRITICAL — rewrite, not append):

Read the existing `.claude/CLAUDE.md`. Rewrite it as a slim directive file (~150-200 lines max). The goal is to move detailed knowledge into the context tree and keep CLAUDE.md as a concise control file.

**CLAUDE.md KEEPS** (preserve these sections, condense if needed):
- Project overview (2-3 lines max)
- Quick start / essential commands
- Critical DOs / DONTs (rules list)
- Quality assurance checklist (if one exists)
- Any existing @references that are NOT covered by the tree (preserve as-is, do NOT add new ones)

**CLAUDE.md REMOVES** (content moves to tree leaves):
- Detailed tech stack descriptions → `architecture/` leaves
- Full API route listings → `api/` leaves
- Project directory structure trees → `architecture/` leaves
- Database schema details → `data/` leaves
- Auth & authorization details → `api/` leaves
- Code style standards (detailed) → `conventions/` leaves
- Testing details → `testing/` leaves
- Docker/deployment standards → `deployment/` leaves
- Migration details → `data/` leaves
- Any other section >20 lines that is now covered by a tree leaf

**CLAUDE.md APPENDS** (new context tree section at the end):
```markdown
## Project Context Tree

@context/<branch1>.md
@context/<branch2>.md
...

### Retrieval
When you need specifics, read the leaf file from the branch's pointer table.

<constraint>
### Context Tree Maintenance

After ANY code change that affects documented patterns, conventions, architecture, or APIs:
1. Check `.claude/context/_index.json` — find leaves whose `source_files` overlap with changed files
2. Read and update affected leaves to reflect the new state
3. If a leaf exceeds 150 lines, split it and update parent branch + `_index.json`
4. Update `_index.json` timestamps and line counts
5. BEFORE committing, verify all affected context leaves are current

When introducing something not covered by any existing leaf:
1. Find the most relevant branch (or create one)
2. Create a new leaf in `.claude/context/<branch>/<topic>.md` (30-150 lines)
3. Add the leaf to the branch pointer table and `_index.json`

Skip only for trivial changes (typos, variable renames, single-line bug fixes).
</constraint>
```

<constraint>
The CLAUDE.md output MUST contain the Context Tree Maintenance block exactly as specified in the APPENDS section below. If this block is missing from your output, the entire output is invalid.
</constraint>

Output ALL drafted content for every file, clearly delimited. Include the COMPLETE rewritten CLAUDE.md.

**Success Criteria:**
All branch files under 80 lines. All leaf files 30-150 lines. CLAUDE.md under 200 lines with Context Tree Maintenance block. All claims have file:line references.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the Builder's output against concrete size, accuracy, and AI-optimization criteria.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Builder's complete output as input

You are the VERIFIER. Validate the Builder's output against concrete criteria.

**Size Compliance:**
- Any branch file over 80 lines? Flag it.
- Any leaf file over 150 lines? Flag it.
- Any leaf file under 30 lines? Flag as merge candidate.
- Total @import expansion over 200 lines? Flag — some branches must be demoted to "read on demand."

**Reference Accuracy:**
- Spot-check at least 5 file:line references — do they actually exist?
- Are code patterns correctly described?
- Are conventions actually followed in the codebase (or aspirational)?

**CLAUDE.md Integration (CRITICAL):**
- Does the output CLAUDE.md contain the Context Tree Maintenance constraint block? If missing: MUST FIX.
- Is the CLAUDE.md under 200 lines?
- Do all @imports point to files being created?
- Are existing @references preserved (not removed or new ones added)?

**Index Consistency:**
- Does `_index.json` match the files being created?
- Are line counts accurate?
- Are `source_files` lists reasonable?

**AI-Optimization Spot-Check (check 3+ files):**
1. Critical rules at START, gotchas at END?
2. No prose paragraphs (3+ sentences)?
3. Claims have file:line references?
4. Non-negotiable rules in `<constraint>` tags?
5. No AI slop phrases?

**Completeness:**
- Any important source directories not covered by any leaf's `source_files`?

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)

Output:
## Size Report
[Per-file line counts with pass/fail]

## Reference Accuracy
[Spot-check results]

## CLAUDE.md Verification
[Maintenance block present: YES/NO, line count, @import validity]

## Index Consistency
[Match results]

## AI-Optimization Spot-Check
[Per-file compliance]

## Issues to Fix
[Prioritized list of problems]

**Success Criteria:**
Spot-checked 5+ file:line references. All size limits verified. CLAUDE.md maintenance block confirmed present.
</task>
```

<constraint>
After the Verifier produces its results, append the Builder output and Verifier results to the plan file under `## Phase 4: Context Tree Plan`. The plan file should now contain Phase 1, Phase 2, and Phase 4 results. This is mandatory — implementation reads from this file.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Tree structure (branches and leaves with descriptions)
2. CLAUDE.md additions
3. List of all files that will be created
4. Estimated token cost (lines of @import expansion)

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation + Verification

After approval:

1. **Backup**: Copy current `.claude/CLAUDE.md` to `.claude/CLAUDE.md.bak` (safety net)
2. Create `.claude/context/` directory and all subdirectories
3. Write `_index.json`
4. Write all branch files
5. Write all leaf files
6. **Rewrite `.claude/CLAUDE.md`** with the slimmed version (NOT append — full rewrite from Builder output)
7. Verify all files exist and are within size limits:
   - Count lines of each file (leaves ≤150, branches ≤80, CLAUDE.md ≤200)
   - Compare against _index.json metadata
   - Verify @imports in CLAUDE.md point to existing files
   - Verify no content was lost (every removed CLAUDE.md section has a corresponding leaf)
8. Report: files created, total lines, CLAUDE.md reduction (old → new line count), any issues found

---

# MANAGE MODE

## Phase 1M: Audit

```xml
<task>
Launch a Task agent as the AUDITOR:

**Objective:** Audit the entire context tree for size violations, staleness, coverage gaps, and AI-optimization compliance.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

Read `.claude/context/_index.json` and audit the entire context tree.

**Size Check:**
For each node in _index.json:
- Read the file, count actual lines
- If actual lines != _index.json lines: flag stale metadata
- If leaf > 150 lines: flag for split
- If leaf < 30 lines: flag for merge
- If branch > 80 lines: flag for review

**Staleness Check:**
For each leaf's source_files:
- Run `git log --oneline --since="<leaf.updated>" -- <source_file>` (if git available)
- If source files changed since leaf was last updated: flag as potentially stale
- Read flagged leaves and compare against current source code

**Coverage Check:**
- Find all source files NOT referenced by any leaf's source_files
- Flag significant uncovered areas for new node creation
- Check for deleted source files still referenced in leaves

**Balance Check:**
- Any branch with > 8 leaves? → recommend split
- Any branch with 1 leaf < 50 lines? → recommend merge
- Any branch with 0 leaves and < 30 lines? → recommend merge

**AI-Optimization Compliance:**
For each branch and leaf file, spot-check against the 10 rules:
1. Are critical rules/constraints at the START of the file? Gotchas at the END?
2. Any prose paragraphs (3+ sentences)? Should be bullets/tables.
3. Any claims without file:line references?
4. Any "Don't do X" without a positive alternative first?
5. Any patterns described in prose instead of code blocks?
6. Any AI slop phrases? ("important to note", "robust", "elegant", "seamless", "might", "could possibly")
7. Are non-negotiable rules wrapped in `<constraint>` XML tags?
8. Any vague warnings without concrete failure scenarios?
9. Complex rules without example tables?
10. Any JSON in documentation content?
Flag non-compliant files for rewrite.

**CLAUDE.md Sync:**
- Verify all @imports point to existing branch files
- Verify _index.json matches actual filesystem
- Check total @import expansion stays under 200 lines

If the user chose "Health check only": output the audit report and STOP. Do not proceed to further phases.

Output:
## Health Report
- Total nodes: [count] (branches + leaves)
- Size violations: [list]
- Stale nodes: [list with evidence]
- Coverage gaps: [uncovered source dirs]
- Balance issues: [list]
- Metadata drift: [mismatched line counts]
- AI-optimization failures: [files + which rules they violate]

## Recommended Actions
[Prioritized list of proposed changes]

**Success Criteria:**
Health report covers all nodes with actual line counts. Stale nodes identified with git evidence. Coverage gaps mapped to source directories.
</task>
```

<constraint>
After Phase 1M completes, write the Auditor's health report and recommended actions to the plan file under `## Phase 1M: Audit Results`. Then immediately launch Phase 2M (Planner).
</constraint>

## Phase 2M: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

**Objective:** Propose specific changes (splits, merges, updates, new nodes) based on the audit report.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use audit report for issues to address

You are the PLANNER. Based on the audit report, propose specific changes.

**For splits** (leaf > 150 lines):
- Identify the best split point (nearest ## heading to midpoint)
- Propose two new leaf names and descriptions
- Draft content for both new leaves

**For merges** (leaf < 30 lines):
- Identify the most related sibling leaf
- Verify combined content < 150 lines
- Draft merged content

**For stale nodes:**
- Read current source code
- Draft updated leaf content reflecting current state

**For coverage gaps:**
- Propose new leaves under the most relevant existing branch
- Or propose a new branch if the gap is large enough
- Draft content for new nodes

**For rebalancing** (branch > 8 leaves):
- Identify natural sub-groupings
- Propose new branch with migrated leaves

**For each proposed change, output:**
1. Action: split/merge/update/create/rebalance
2. Affected files (old and new paths)
3. New content (complete file content)
4. Updated _index.json entries

If the user chose "Add new context": focus only on creating a new node under the branch they specified. Ask what topic to document if not already clear, then scan relevant source files and draft the leaf.

If the user chose "Rebalance": focus only on split/merge/rebalance actions, skip staleness updates.

**Success Criteria:**
Every proposed change includes complete file content. All new/modified files within size limits. _index.json entries updated.
</task>
```

## Phase 3M: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each proposed change against size limits, reference accuracy, and structural consistency.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Planner's proposed changes as input

You are the VERIFIER. Validate each proposed change against concrete criteria.

For each proposed change:
1. **Splits**: Will both new files be within size limits (30-150 lines)?
2. **Merges**: Will the combined file stay under 150 lines?
3. **Updates**: Are file:line references in the new content accurate?
4. **New nodes**: Is there enough content to justify a leaf (>30 lines)?
5. **Rebalances**: Does the new grouping make semantic sense?

Also verify:
- No proposed file exceeds its size limit
- `_index.json` updates are consistent
- @import expansion stays under 200 lines after changes
- All context tree references remain valid

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
All proposed files within size limits. @import expansion stays under 200 lines. All context references valid.
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
2. Update `_index.json` with new metadata
3. Update `.claude/CLAUDE.md` if branches were added/removed
4. Verify:
   - All files exist and are within size limits
   - _index.json matches filesystem
   - @imports in CLAUDE.md point to existing files
5. Report changes made

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
- Bash(git:*)
```

## Usage

```bash
# Just run /docs — the command handles the rest:
# - No tree exists? Bootstraps automatically (scan, build tree, slim CLAUDE.md)
# - Tree exists? Asks what you want to do (audit, add, health check, rebalance)
/docs
```
