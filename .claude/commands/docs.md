# Context Tree Manager

Bootstrap and manage a B-tree-inspired context hierarchy in `.claude/context/`. Organizes project knowledge (conventions, architecture, patterns, APIs) into size-bounded files with an index for on-demand retrieval and self-maintenance.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## ⚠️ MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute read-only phases** → Discovery and committee discussion
3. **Present Plan** → Show user exactly what will be created/changed
4. **Wait for Approval** → User must explicitly approve
5. **Execute implementation** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

## Planning Phase Tools (READ-ONLY)
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git log, git status, wc -l, find)
- Do NOT use: Write, Edit, or any modifying tools

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(mkdir:*, git:*)

---

## Phase 0: Mode Detection

Check if `.claude/context/_index.json` exists in the project:

- **If NO** → Execute **Bootstrap Mode** (Phases 1-7) automatically. No need to ask — bootstrap is the only option.
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
Use the Task tool to launch an explore agent with model="opus":
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
</task>
```

## Phase 2: Parallel Analysis

> **CRITICAL: Launch BOTH agents below in a SINGLE turn.**
> Do NOT wait for one to finish before launching the next.
> Each agent runs independently and their results will be combined by the committee.

### Categorizer Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the CATEGORIZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

### Pattern Scanner Agent (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the PATTERN SCANNER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 3: Committee — Proposer

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PROPOSER. Using the categorizer's tree structure and the pattern scanner's findings, draft the COMPLETE content for every file in the context tree.

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
- Any @references that are NOT covered by the tree (e.g., @RTK.md)

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

### Maintenance — ALWAYS keep the context tree current
After making changes to the codebase, you MUST update the context tree:

**Update existing context** when changes affect documented patterns/conventions/architecture/APIs:
1. Check `.claude/context/_index.json` — find leaves whose `source_files` overlap with changed files
2. Read and update the affected leaf to reflect new state
3. If leaf exceeds 150 lines after update, split it: create two leaves, update parent branch and _index.json
4. Update `_index.json` with new line counts and timestamps

**Add new context** when you introduce something not covered by any existing leaf:
1. Find the most relevant branch (or create a new one if none fits)
2. Create a new leaf file in `.claude/context/<branch>/<topic>.md` (30-150 lines)
3. Add the leaf entry to the branch's pointer table
4. Add the leaf to `_index.json` with `source_files`, line count, and timestamp

Skip updates for trivial changes (bug fixes, typos, variable renames).
```

**Target**: CLAUDE.md should go from potentially 1000+ lines down to ~150-200 lines.

Output ALL drafted content for every file, clearly delimited. Include the COMPLETE rewritten CLAUDE.md.
</task>
```

## Phase 4: Committee — Critic

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the CRITIC. Review the proposed context tree for accuracy, completeness, structure, and AI-optimization.

**Size Compliance:**
- Any branch file over 80 lines? Flag it.
- Any leaf file over 150 lines? Flag it.
- Any leaf file under 30 lines? Flag as merge candidate.
- Total @import expansion over 200 lines? Flag — some branches must be demoted to "read on demand."

**Accuracy Check:**
- Do file:line references actually exist? Spot-check at least 5.
- Are code patterns correctly described?
- Are conventions actually followed in the codebase (or aspirational)?

**Completeness Check:**
- Any important source directories not covered by any leaf's `source_files`?
- Missing gotchas or warnings?
- Key architectural decisions not documented?

**AI-Optimization Compliance** (check every file against these rules):
1. **Position**: Are critical rules/constraints at the START? Gotchas at the END? Flag any file that buries important info in the middle.
2. **No prose**: Any paragraph of 3+ sentences? Flag — must be converted to bullets or tables.
3. **References**: Any claim without a file:line reference? Flag — every pattern, convention, and architectural decision needs a concrete citation.
4. **Framing**: Any "Don't do X" without a positive alternative first? Flag — rewrite as "Use Y (not X)".
5. **Code blocks**: Any function signature or pattern described in prose? Flag — must be a code block with actual source.
6. **AI slop**: Flag these phrases for removal: "important to note", "robust", "elegant", "seamless", "powerful", "cutting-edge", "might", "could possibly", "should probably", "easy to use", "simple to understand".
7. **Constraints**: Are non-negotiable rules wrapped in `<constraint>` XML tags? Flag any hard rule that's just plain text.
8. **Gotcha quality**: Any vague warning ("be careful with X")? Flag — must show concrete failure scenario with code.
9. **Examples**: Complex rules without 3-5 examples? Flag — suggest adding a | Good | Bad | Why | table.
10. **Format**: Any JSON in documentation content? Flag — use Markdown.

**Tree Balance:**
- Any branch with too many leaves (>8)?
- Any branch with only 1 small leaf (merge candidate)?
- Are branch names clear and non-overlapping?

**CLAUDE.md Integration:**
- Will the maintenance instructions actually work in practice?
- Is the retrieval instruction clear enough for Claude to follow?
- Is the slimmed CLAUDE.md under 200 lines?

Output:
**Size Violations** (files that need splitting/trimming)
**Accuracy Issues** (wrong references, incorrect patterns)
**Missing Content** (gaps in coverage)
**AI-Optimization Failures** (rule number + file + specific issue)
**Balance Issues** (structural problems)
**CLAUDE.md Concerns** (integration issues)
</task>
```

## Phase 5: Committee — Synthesizer

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the SYNTHESIZER. Produce the FINAL content for every file in the context tree.

Given the proposer's drafts and critic's feedback:

1. **Fix** all accuracy issues — verify file:line references
2. **Trim** files over size limits — split leaves, condense branches
3. **AI-optimize** every file — enforce all 10 rules:
   - Move critical rules to top, gotchas to bottom of each file
   - Convert all prose to bullets/tables
   - Add file:line references to any claim missing one
   - Reframe negatives: "Use Y (not X)" pattern
   - Replace prose descriptions with code blocks from actual codebase
   - Strip all AI slop phrases
   - Wrap non-negotiable rules in `<constraint>` XML tags
   - Expand vague warnings into concrete failure scenarios with code
   - Add | Good | Bad | Why | tables for complex rules
   - Remove any JSON from documentation content
4. **Remove** all AI slop and filler
5. **Add** missing content identified by critic
6. **Rebalance** if structural issues were flagged
7. **Verify** total @import expansion stays under 200 lines

Output the FINAL content for each file, clearly delimited:

---
## .claude/CLAUDE.md (COMPLETE REWRITE)
[The full slimmed CLAUDE.md — ~150-200 lines. Preserves directives, removes detailed sections now in tree.]

---
## .claude/context/_index.json
[Complete JSON]

---
## .claude/context/<branch>.md
[Complete content for each branch file]

---
## .claude/context/<branch>/<topic>.md
[Complete content for each leaf file]

---
## Tree Summary
- Branches: [count]
- Leaves: [count]
- Total lines: [count]
- Estimated @import expansion: [lines]
- CLAUDE.md: [old line count] → [new line count] (reduction %)
</task>
```

## Phase 6: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the committee produces the final tree:

1. Present the tree structure (branches and leaves with descriptions)
2. Show the CLAUDE.md additions
3. List all files that will be created
4. Show estimated token cost (lines of @import expansion)
5. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

**Do NOT proceed to Phase 7 without user approval.**

If user requests changes:
- Revise based on feedback
- Present updated plan
- Wait for approval again

---

## Phase 7: Implementation + Verification

Once user has approved:

1. **Backup**: Copy current `.claude/CLAUDE.md` to `.claude/CLAUDE.md.bak` (safety net)
2. Create `.claude/context/` directory and all subdirectories
3. Write `_index.json`
4. Write all branch files
5. Write all leaf files
6. **Rewrite `.claude/CLAUDE.md`** with the slimmed version (NOT append — full rewrite from synthesizer output)
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
Launch a Task agent with model="opus" as the AUDITOR:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 2M: Proposer

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PROPOSER. Based on the audit report, propose specific changes.

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
</task>
```

## Phase 3M: Critic

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the CRITIC. Challenge each proposed change:

1. **Splits**: Is the split necessary? Will it create two coherent topics or fragmented ones?
2. **Merges**: Will merging lose important topic separation?
3. **Updates**: Is the new content accurate? File:line references correct?
4. **New nodes**: Is there enough content to justify a new leaf (>30 lines)?
5. **Rebalances**: Does the new branch grouping make semantic sense?

Also verify:
- No proposed file exceeds its size limit
- _index.json updates are consistent
- @import expansion stays under 200 lines after changes

Output:
**Approved Changes** (proceed as proposed)
**Modified Changes** (proceed with adjustments)
**Rejected Changes** (do not proceed, with reasoning)
</task>
```

## Phase 4M: User Approval Gate

**STOP HERE AND PRESENT THE CHANGES TO THE USER**

1. List all proposed changes with before/after
2. Show which files will be created, modified, or deleted
3. Wait for explicit approval

**Do NOT proceed without user approval.**

---

## Phase 5M: Implementation + Verification

Once user has approved:

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
