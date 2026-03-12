# Universal Fixer

Fix issues in code: bugs, security vulnerabilities, performance problems, dependencies, and dead code. Uses Builder-Verifier pattern to ensure safe, effective fixes.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute Phases 1-4** → Read-only discovery and plan validation
3. **Present Plan** → Show user exactly what will be fixed
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 6-7** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff, npm audit)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*, pip:*, rm:*)

---

## Phase 1: Exploration

First, explore to understand what needs fixing.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and package manager
- Find the target scope (use $ARGUMENTS if provided)
- If `.claude/context/_index.json` exists, read it and relevant branch files for project conventions
- Check for existing issues: failing tests, linter errors, security advisories
- Understand the codebase structure and conventions
- Identify test coverage and CI/CD setup
</task>
```

## Phase 2: Issue Discovery

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently and their results will be combined by the Planner.

### Code Quality Scanner

```xml
<task>
Launch a Task agent with model="opus" as the CODE QUALITY SCANNER:

First, run `date "+%Y-%m-%d"` to confirm current date.

Scan the target code for quality issues:

**Bugs**
- Logic errors, off-by-one, null/undefined handling
- Race conditions, async/await misuse
- Incorrect type coercion, comparison errors
- Missing error handling, unhandled promise rejections

**Dead Code**
- Unused exports, functions, variables, types
- Unreachable code paths
- Commented-out code blocks
- Deprecated code marked for removal

**Refactoring Opportunities**
- Duplicated code that should be extracted
- Complex functions that need decomposition
- Outdated patterns that should be modernized
- Type improvements (any → specific types)

**Performance**
- Obvious bottlenecks (N+1 queries, missing memoization)
- Memory leaks (event listeners, subscriptions)
- Unnecessary re-renders, computations

Output a prioritized list of issues with locations and suggested fixes.
</task>
```

### Dependency Scanner

```xml
<task>
Launch a Task agent with model="opus" as the DEPENDENCY SCANNER:

First, run `date "+%Y-%m-%d"` to confirm current date.

Scan the project's dependencies for issues:

**Security Vulnerabilities**
- Run `npm audit` or equivalent to find known vulnerabilities
- Check for packages with published CVEs
- Identify transitive dependency risks

**Outdated Packages**
- Check for outdated packages with security patches
- Identify packages multiple major versions behind
- Note packages with active deprecation notices

**Unused Dependencies**
- Identify dependencies listed in package.json but not imported
- Find devDependencies that are never used in scripts or config
- Check for duplicate packages providing same functionality

**Missing Peer Dependencies**
- Find missing peer dependency warnings
- Identify version conflicts between peer dependencies

Output a prioritized list of dependency issues with recommended actions.
</task>
```

## Phase 3: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PLANNER. For each identified issue, propose a specific fix.

<constraint>
- MINIMAL, TARGETED fixes only — fix the bug, not the whole function
- Every fix must include file:line location and exact code changes
- Do NOT refactor surrounding code or reorganize files
</constraint>

For each fix provide:

| Field | Content |
|-------|---------|
| Issue | What's wrong (file:line) |
| Root Cause | Why this happened |
| Proposed Fix | Exact code changes |
| Testing | How to verify the fix works |
| Risk Level | low / medium / high |

Output numbered list of proposed fixes.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Validate each proposed fix against the actual codebase.

For each proposed fix:
1. Read the file at the reported location — does the issue actually exist?
2. Read the surrounding code — will the fix break any callers or dependents?
3. Search for usages of the function/class being changed to assess blast radius
4. Is the risk level accurate? (1 file, no callers = low; shared utility = higher)
5. Is the proposed code change syntactically and logically correct?

Output:
## Approved Fixes
[Fixes confirmed as correct and safe]

## Modified Fixes
[Fixes that need adjustments, with specific changes needed]

## Rejected Fixes
[Fixes that are wrong or too risky, with evidence]

## Risk Assessment
- Low risk fixes: X
- Medium risk fixes: Y
- High risk fixes: Z
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Planner output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Fix Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the Verifier validates the fix plan:

1. Present all proposed fixes organized by risk level
2. Show exactly what will be changed (files, lines, code changes)
3. Ask user to review and approve before proceeding
4. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

<constraint>
Do NOT proceed to Phase 6 without explicit user approval ("approved", "proceed", "yes", or "go ahead").
</constraint>

If user requests changes:
- Revise the plan based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 6: Implementation

Once user has approved the plan:

1. Implement fixes in the specified order
2. After each fix:
   - Run tests if available (`npm test`, `pytest`, etc.)
   - Run linter if available
   - Verify the fix doesn't break anything
3. If a fix causes issues, revert and report
4. Track each change made for verification

## Phase 7: Post-Implementation Verifier

### Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Your job is to review ALL changes made and catch any mistakes BEFORE presenting to the user.

1. Run `git diff` to see exactly what was changed
2. For EACH change, verify against the actual source code:
   - Is this fix correct? Does it solve the actual problem?
   - Did we break any existing functionality?
   - Are there side effects we didn't anticipate?
   - Did we make assumptions that turned out to be wrong?

3. Run verification checks:
   - Do all tests still pass?
   - Does the linter pass?
   - Do type checks pass?
   - Does the application still build?

4. Cross-reference fixes with:
   - The original issue (did we actually fix it?)
   - Related code (did we miss updating dependent code?)
   - Tests (do they cover the fix?)

**Output:**
## Verified Correct
[Fixes that are working correctly]

## ERRORS FOUND - Must Revert
[Changes that broke something or are incorrect, with evidence]

## Tests Status
[Pass/Fail status of test suite]

## Needs Manual Verification
[Changes that require user testing]
</task>
```

After verification:
- Revert any incorrect changes immediately
- Report what was fixed vs what was reverted
- Only then present final summary to user

## Allowed Tools

```yaml
- Read
- Glob
- Grep
- Task
- Edit
- Write
- Bash(git:*)
- Bash(npm:*)
- Bash(pnpm:*)
- Bash(yarn:*)
- Bash(pip:*)
- Bash(ls:*)
- Bash(rm:*)  # For removing dead code files
```

## Usage

```bash
# Fix issues in entire project
/fix

# Fix issues in specific directory
/fix src/api/

# Fix specific type of issue
/fix dependencies
/fix bugs
/fix dead-code
```
