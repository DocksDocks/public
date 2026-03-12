# Documentation Generator

Generate, fix, and optimize documentation across the entire project. Scans ALL .md files, optimizes for AI consumption, and ensures accuracy through a Builder-Verifier pattern.

> **Model Tiering:** Subagents default to `sonnet` (via CLAUDE_CODE_SUBAGENT_MODEL).
> Only set `model: "opus"` for quality-critical agents (analyzers, planners, builders, generators).
> Explorers, scanners, verifiers, and synthesizers use the default. Do NOT use haiku.

---

## MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute Phases 1-4** → Read-only analysis, drafting, and verification
3. **Present Plan** → Show user exactly what will change
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 6-7** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff, find)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*)

---

## Phase 1: Exploration

First, discover ALL documentation and understand the project.

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Discover all documentation files and understand the project for documentation generation.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Find ALL .md files: `find . -name "*.md" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./vendor/*"`
- Identify the project stack and architecture
- Find API routes/endpoints if applicable
- Check for OpenAPI/Swagger specs
- Identify environment variables used
- Note existing documentation conventions
- Use $ARGUMENTS to focus on specific docs if provided

**Output Format:**
- All .md files found with categories
- Project stack and architecture
- Documentation gaps identified

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
All .md files cataloged. Project stack identified. Documentation gaps mapped to source areas.
</task>
```

## Phase 2: Analysis

### Categorize and Analyze Documentation

```xml
<task>
Launch a Task agent with model="opus" to categorize and analyze:

**Objective:** Categorize all .md files by type (human-readable, AI-optimized, keep-as-is) and analyze gaps.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date. Use this for any date references.
- Use exploration output for documentation inventory

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

**Success Criteria:**
Every .md file categorized. Gap analysis covers README, CLAUDE.md, docs/, and .env.example. Optimization candidates identified.
</task>
```

## Phase 3: Writer

```xml
<task>
Launch a Task agent with model="opus" to act as the WRITER:

**Objective:** Draft documentation based on the gap analysis, using correct format per category (human-readable vs AI-optimized).

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date. Use this for any date references.
- Use Analyzer's gap analysis and categorization

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the WRITER. Draft documentation based on the gap analysis.

<constraint>
- Every file:line reference must point to actual existing code
- AI-optimized docs (CLAUDE.md, docs/*.md): bullets/tables only, never prose paragraphs
- Human-readable docs (README.md): may use prose but must have copy-paste ready commands
</constraint>

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

**Success Criteria:**
All file:line references point to actual existing code. AI-optimized docs use bullets/tables only. Human-readable docs have copy-paste ready commands.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate drafted documentation against the actual codebase for accuracy.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Writer's drafted documentation as input

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Validate the drafted documentation against the actual codebase.

**Accuracy Checks:**
1. Do all referenced file paths actually exist?
2. Do line number references match actual code?
3. Do API endpoint docs match actual route definitions? (Check handler code, not constants)
4. Are code examples correct and runnable?
5. Do function signatures in docs match real code?

**Environment Variables:**
- Grep for `process.env` / `os.environ` usage
- Verify every documented variable is actually used
- Check default values match code defaults

**AI Slop Scan — flag for removal:**
- "It's important to note that...", "powerful", "elegant", "robust", "seamless"
- "cutting-edge", "might", "could possibly", "should probably"
- "easy to use", "simple to understand"
- Prose paragraphs in AI-optimized docs (should be bullets/tables)

**Structure Check (AI-optimized docs only):**
- Uses tables instead of prose?
- Has file:line references?
- Has concrete examples from codebase?

Output:
## Verified Correct
[Documentation confirmed against source code]

## Errors Found
[Inaccuracies with file:line evidence from actual code]

## AI Slop Found
[Phrases to remove/rewrite with locations]

## Unable to Verify
[Items needing manual verification]

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Spot-checked 5+ file:line references. Zero AI slop phrases remaining. All code examples verified runnable.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Writer output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Documentation Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the Verifier validates the drafted documentation:

1. Present all proposed documentation changes
2. Show diff of what will change (old vs new)
3. List files being created, modified, or left unchanged
4. Ask user to review and approve before proceeding
5. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

<constraint>
Do NOT proceed to Phase 6 without explicit user approval ("approved", "proceed", "yes", or "go ahead").
</constraint>

If user requests changes:
- Revise the documentation based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 6: Implementation

Once user has approved the plan:

1. Write/update documentation files using Write/Edit tools
2. For API docs, generate in the appropriate format:
   - OpenAPI/Swagger YAML if that's the project standard
   - Markdown if simpler
   - JSDoc/TSDoc for inline documentation
3. Update .env.example with all variables
4. Track all changes for verification

## Phase 7: Post-Implementation Verifier

### Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Verify ALL documentation changes against the ACTUAL codebase.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date. Use this for any date references.

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

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Every change verified against source code. All file paths confirmed existing. Zero contradictions with actual code.
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
