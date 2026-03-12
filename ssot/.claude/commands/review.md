# Universal Code Review

Comprehensive code review covering quality, security, and performance using a Builder-Verifier pattern.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** -> Use `EnterPlanMode` tool NOW
2. **Execute Phases 1-3** → Read-only analysis and verification
3. **Present Plan** → Show user exactly what will be fixed
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 5-6** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*)

---

## Phase 1: Exploration

First, explore the codebase to understand context and identify the target scope.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack (check package.json, tsconfig.json, pyproject.toml, etc.)
- Find the files/directories to review (use $ARGUMENTS if provided, otherwise review recent changes or key modules)
- If `.claude/context/_index.json` exists, read it and relevant branch files for project conventions
- Understand existing patterns, conventions, and architecture
- Note any existing linting/testing configurations
</task>
```

## Phase 2: Analyzer

```xml
<task>
Launch a Task agent with model="opus" to act as the ANALYZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the ANALYZER. Identify ALL potential issues in the target code.

<constraint>
- Every issue must include file:line location and severity
- Suggest minimal, targeted fixes (not refactors)
- If a context tree exists, check `.claude/context/conventions/` for project-specific rules
</constraint>

**Review categories:**

| Category | What to check |
|----------|--------------|
| Code Quality | SOLID violations, code smells, error handling gaps, type safety, naming |
| Security (OWASP Top 10) | Injection, broken auth, data exposure, misconfiguration, insecure deps |
| Performance | N+1 queries, memory leaks, blocking async, missing caching, bad algorithms |
| AI Slop | Verbose code, unnecessary abstractions, obvious comments, over-engineering |

**Per issue, provide:**
1. File and line location
2. Category and severity (critical / high / medium / low)
3. WHY it's a problem
4. Suggested fix

Output as a numbered list.
</task>
```

## Phase 3: Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Your job is to validate the Analyzer's findings against the actual codebase.

For each reported issue:
1. Read the file at the reported location — does the code actually exist there?
2. Is the issue real? Read surrounding context to confirm.
3. Is the severity rating accurate given the codebase context?
4. Is the suggested fix correct and safe?

Spot-check at least 5 file:line references to verify they exist.

Output:
## Verified Issues
[Issues confirmed as real with evidence]

## Rejected Issues (False Positives)
[Issues that are not real, with evidence from the code]

## Severity Adjustments
[Any issues where severity should change, with reasoning]

## Summary
- Total reported: X
- Verified: Y
- Rejected: Z
- Adjusted severity: W
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Analyzer findings and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Analysis Results` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 4: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the Verifier produces the validated findings:

1. Present the verified findings clearly
2. Show exactly what will be changed (files, lines, fixes)
3. Ask user to review and approve before proceeding
4. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

<constraint>
Do NOT proceed to Phase 5 without explicit user approval ("approved", "proceed", "yes", or "go ahead").
</constraint>

If user requests changes:
- Revise the plan based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 5: Implementation

Once user has approved the plan:

1. Implement fixes starting with critical issues
2. Use Edit tool to make changes, preserving existing code style
3. Run existing tests/linters after changes if available
4. Track each change made for verification

## Phase 6: Post-Implementation Verification

### Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Your job is to review ALL changes made and catch any mistakes BEFORE presenting to the user.

1. Run `git diff` to see exactly what was changed
2. For EACH change, verify against the actual source code:
   - Is this change correct? Does it match what the code actually does/needs?
   - Did we make assumptions without checking the real implementation?
   - Are there inconsistencies with other parts of the codebase?
   - Did we accidentally change something that was already correct?

3. Cross-reference changes with:
   - Actual route definitions (not just constants)
   - Real function signatures (not assumed)
   - Existing tests (do they still pass?)
   - Related files that might contradict our changes

4. For documentation changes specifically:
   - Verify URLs/paths against actual code
   - Check that examples match real implementations
   - Ensure no correct information was "corrected" incorrectly

**Output:**
## Verified Correct
[Changes that are accurate]

## ERRORS FOUND - Must Revert
[Changes that are wrong, with evidence from the codebase]

## Needs Manual Verification
[Changes that couldn't be verified automatically]
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
- Bash(ls:*)
```

## Usage

```bash
# Review entire project
/review

# Review specific file or directory
/review src/api/

# Review specific file
/review src/utils/auth.ts
```
