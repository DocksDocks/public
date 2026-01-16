# Universal Code Review

Comprehensive code review covering quality, security, and performance using a Devil's Advocate committee approach.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

## CRITICAL: Plan Mode First

**This command operates in two distinct phases:**

### PLANNING PHASE (Phases 0-3) - READ-ONLY
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools
- Output: A detailed review plan for user approval

### IMPLEMENTATION PHASE (Phases 4-6) - ONLY AFTER APPROVAL
- Wait for user to type: "approved", "proceed", "yes", or "go ahead"
- Only then execute the fixes
- Run verification after

**If user does not approve:**
- Ask what changes they want
- Revise the plan
- Present again for approval

---

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

First, explore the codebase to understand context and identify the target scope.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack (check package.json, tsconfig.json, pyproject.toml, etc.)
- Find the files/directories to review (use $ARGUMENTS if provided, otherwise review recent changes or key modules)
- Understand existing patterns, conventions, and architecture
- Note any existing linting/testing configurations
</task>
```

## Phase 2: Committee Discussion

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the PROPOSER in a code review committee. Your job is to identify ALL potential issues.

Review the target code and identify issues in these categories:

**Code Quality**
- SOLID principle violations (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion)
- Code smells (long methods, deep nesting, magic numbers, duplicated logic)
- Error handling gaps
- Type safety issues
- Naming and readability problems

**Security (OWASP Top 10)**
- Injection vulnerabilities (SQL, NoSQL, command, XSS)
- Broken authentication/authorization
- Sensitive data exposure
- Security misconfiguration
- Insecure dependencies

**Performance**
- N+1 queries, missing indexes
- Memory leaks, unnecessary allocations
- Blocking operations in async code
- Missing caching opportunities
- Inefficient algorithms

**AI Slop Detection**
- Overly verbose code that could be simpler
- Unnecessary abstractions
- Comments that restate the obvious
- Over-engineered solutions

For each issue found, provide:
1. File and line location
2. Issue category and severity (critical/high/medium/low)
3. Detailed explanation of WHY it's a problem
4. Suggested fix

Output as a numbered list.
</task>
```

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the CRITIC in a code review committee. Your job is to CHALLENGE the proposer's findings and find what they MISSED.

Review the proposer's findings and for EACH issue:
1. **Challenge**: Is this actually a problem in this context? Could it be a false positive?
2. **Edge Cases**: Are there scenarios where this issue matters more or less?
3. **Fix Evaluation**: Is the proposed fix safe? Could it introduce regressions?
4. **Severity Check**: Is the severity rating accurate?

Then, ACTIVELY LOOK for issues the proposer missed:
- Review the same code independently
- Check areas the proposer may have glossed over
- Look for subtle bugs in complex logic
- Verify security assumptions
- Check for race conditions, deadlocks, edge cases

Output format:
**Critiques of Proposer Findings**
[For each item: Accept/Challenge with reasoning]

**Missed Issues**
[New issues found that proposer missed]
</task>
```

### Round 3 - Synthesizer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the SYNTHESIZER in a code review committee. Your job is to produce the FINAL, ACTIONABLE review.

Given the proposer's findings and critic's challenges:

1. **Accept** issues that survived criticism (critic agreed or couldn't refute)
2. **Reject** issues with valid counter-arguments (false positives)
3. **Incorporate** new issues found by the critic
4. **Adjust** severity ratings based on critic's input
5. **Prioritize** by impact: critical issues first, then high, medium, low

Output the FINAL REVIEW:

## Critical Issues (Fix Immediately)
[List with file:line, description, and fix]

## High Priority Issues
[List with file:line, description, and fix]

## Medium Priority Issues
[List with file:line, description, and fix]

## Low Priority / Suggestions
[List with file:line, description, and fix]

## Summary
- Total issues: X
- Files affected: Y
- Estimated effort: [brief description]
</task>
```

## Phase 3: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the committee produces the final review:

1. Present the synthesized findings clearly
2. Show exactly what will be changed (files, lines, fixes)
3. Ask user to review and approve before proceeding
4. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

**Do NOT proceed to Phase 4 without user approval.**

If user requests changes:
- Revise the plan based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 4: Implementation

Once user has approved the plan:

1. Implement fixes starting with critical issues
2. Use Edit tool to make changes, preserving existing code style
3. Run existing tests/linters after changes if available
4. Track each change made for verification

## Phase 5: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

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
