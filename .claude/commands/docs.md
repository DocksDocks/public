# Documentation Generator

Generate, fix, and optimize documentation across the entire project. Scans ALL .md files, optimizes for AI consumption, and ensures accuracy through Devil's Advocate committee.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## ⚠️ MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute Phases 0-4** → Read-only analysis and planning
3. **Present Plan** → Show user exactly what will change
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 5-7** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

## Planning Phase Tools (READ-ONLY)
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff, find)
- Do NOT use: Write, Edit, or any modifying tools

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*)

---

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

First, discover ALL documentation and understand the project.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Find ALL .md files: `find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./vendor/*"`
- Identify the project stack and architecture
- Find API routes/endpoints if applicable
- Check for OpenAPI/Swagger specs
- Identify environment variables used
- Note existing documentation conventions
- Use $ARGUMENTS to focus on specific docs if provided
</task>
```

## Phase 2: Analysis

### Categorize and Analyze Documentation

```xml
<task>
Launch a Task agent with model="opus" to categorize and analyze:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

**Step 1: Categorize ALL .md files**

| Category | Files | Treatment |
|----------|-------|-----------|
| Human-Readable | README.md, CONTRIBUTING.md | Keep clear for humans, marketing OK |
| AI-Optimized | CLAUDE.md, docs/**/*.md, *.md in src/ | Structured, no fluff, file:line refs |
| Keep As-Is | CHANGELOG.md, LICENSE.md, CODE_OF_CONDUCT.md | Don't modify |

**Step 2: Analyze Each Category**

**README.md (Human-Readable)**
- Is the project description accurate and compelling?
- Are setup instructions complete and copy-paste ready?
- Are dependencies documented?
- Are usage examples clear?

**CLAUDE.md (AI-Optimized)**
- Does it explain project structure with file paths?
- Are coding conventions explicit?
- Are patterns explained with file:line references?
- Are gotchas and warnings clear?

**docs/**/*.md (AI-Optimized)**
- Is API documentation accurate?
- Do schemas match actual implementation?
- Are examples runnable?

**.env.example**
- Are all variables documented?
- Are descriptions clear?
- Are defaults appropriate?

**Output:**
## Documentation Inventory
[List ALL .md files with category and status]

## Gap Analysis
[What's missing, outdated, or wrong]

## Optimization Candidates
[Files that need AI-optimization]
</task>
```

## Phase 3: Committee Discussion

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the PROPOSER. Draft documentation based on the gap analysis.

**For README.md (Human-Readable Format):**
- Project overview (what it does, why it exists)
- Prerequisites and dependencies
- Installation steps (copy-paste ready)
- Configuration guide
- Usage examples with code
- API reference (if small) or link to full docs
- Contributing guidelines (brief)
- License

**For CLAUDE.md and docs/*.md (AI-Optimized Format):**

Use this structured format:

```markdown
# ComponentName

## Purpose
- [What it does - one bullet]
- [When to use - one bullet]

## Location
- **File**: `src/path/to/file.ts`
- **Lines**: 45-120
- **Exports**: `functionA`, `ClassB`

## Dependencies
| Import | From | Purpose |
|--------|------|---------|
| `X` | `@/lib/x` | [Why] |

## API
### `functionName(param: Type): ReturnType`
- **File**: `path/file.ts:45`
- **Purpose**: [One line]
- **Parameters**: [Table]
- **Returns**: [Description]

## Patterns
```typescript
// src/path/file.ts:78-85
[actual code from codebase]
```

## Gotchas
- **Do NOT**: [What to avoid]
- **Always**: [What to do]
```

**For .env.example:**
- All environment variables with descriptions as comments
- Safe default values where appropriate
- Group by category (database, auth, external services)

Output the drafted documentation for each file.
</task>
```

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the CRITIC. Review the proposed documentation for accuracy and quality.

**Accuracy Check:**
- Do file paths actually exist?
- Do line numbers match actual code?
- Do API schemas match implementation?
- Are code examples correct and runnable?

**AI Slop Detection - FLAG AND REMOVE:**
- "It's important to note that..."
- "powerful", "elegant", "robust", "seamless", "cutting-edge"
- "might", "could possibly", "should probably"
- "easy to use", "simple to understand"
- "This function does what it says"
- Unnecessary caveats and disclaimers
- Prose paragraphs (convert to bullets)
- Marketing speak in technical docs

**Structure Check (for AI-Optimized docs):**
- Uses tables instead of prose?
- Has file:line references?
- Uses bullets not paragraphs?
- Has concrete examples from codebase?

**Completeness Check:**
- Any important functionality not documented?
- Any edge cases missing?
- Any error scenarios unexplained?

Output:
**Accuracy Issues** (things that are wrong with evidence)
**AI Slop Found** (phrases to remove/rewrite)
**Missing Content** (things that should be added)
**Structural Improvements** (reformatting needed)
</task>
```

### Round 3 - Synthesizer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the SYNTHESIZER. Produce the final documentation.

Given proposer's drafts and critic's feedback:

1. **Correct** all factual errors
2. **Remove** ALL AI slop and filler
3. **Convert** prose to bullets/tables
4. **Add** file:line references where missing
5. **Verify** all code examples are correct

Output the FINAL DOCUMENTATION for each file:

---
## README.md
[Complete content - human-readable]

---
## CLAUDE.md
[Complete content - AI-optimized format]

---
## docs/[filename].md
[Complete content - AI-optimized format]

---
## .env.example
[Environment file with comments]

---

Also note:
- Files that were improved
- Content that couldn't be documented (needs more info)
- Files intentionally left unchanged
</task>
```

## Phase 4: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the committee produces the final documentation:

1. Present all proposed documentation changes
2. Show diff of what will change (old vs new)
3. List files being created, modified, or left unchanged
4. Ask user to review and approve before proceeding
5. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

**Do NOT proceed to Phase 5 without user approval.**

If user requests changes:
- Revise the documentation based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 5: Implementation

Once user has approved the plan:

1. Write/update documentation files using Write/Edit tools
2. For API docs, generate in the appropriate format:
   - OpenAPI/Swagger YAML if that's the project standard
   - Markdown if simpler
   - JSDoc/TSDoc for inline documentation
3. Update .env.example with all variables
4. Track all changes for verification

## Phase 6: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the VERIFIER. Verify ALL documentation changes against the ACTUAL codebase.

1. Run `git diff` to see exactly what was changed
2. For EACH documentation change, verify against SOURCE CODE:

   **File Paths and Line Numbers:**
   - Does every referenced file exist?
   - Do line number references match actual code?
   - Are function signatures correct?

   **API Endpoints:**
   - Find the ACTUAL route definitions (not constants files)
   - Verify paths match exactly
   - Check actual request/response types from handler code
   - Verify authentication requirements from middleware

   **Environment Variables:**
   - Grep for actual usage: `process.env` or `os.environ`
   - Verify every documented variable is actually used
   - Check default values match code defaults

   **Code Examples:**
   - Verify import paths are correct
   - Check that examples would actually run
   - Verify function signatures match

3. NEVER trust constants files alone - verify against implementations

4. For README.md specifically:
   - Do setup commands work?
   - Are URLs valid?

**Output:**
## Verified Correct
[Changes confirmed against source code]

## ERRORS FOUND - Must Revert
[Changes that contradict actual code, with file:line evidence]
Example: "Documented endpoint as /api/users but actual route in src/routes/users.ts:23 is /api/v1/users"

## Unable to Verify
[Changes that need manual verification]
</task>
```

After verification:
- IMMEDIATELY revert any incorrect changes
- Show user what was reverted and why (with code evidence)
- Only then present final summary of correct changes

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
- Bash(git status)
- Bash(git diff)

Implementation Phase:
- Edit
- Write
- Bash(git:*)
```

## Usage

```bash
# Generate/fix all documentation
/docs

# Focus on specific documentation
/docs README
/docs API
/docs CLAUDE.md
/docs env

# Optimize all docs for AI consumption
/docs --ai-optimize
```
