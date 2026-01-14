# Universal Fixer

Fix issues in code: bugs, security vulnerabilities, performance problems, dependencies, and dead code. Uses Devil's Advocate committee to ensure safe, effective fixes.

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

First, explore to understand what needs fixing.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and package manager
- Find the target scope (use $ARGUMENTS if provided)
- Check for existing issues: failing tests, linter errors, security advisories
- Understand the codebase structure and conventions
- Identify test coverage and CI/CD setup
</task>
```

## Phase 2: Issue Discovery

### Identify Issues to Fix

```xml
<task>
Launch a Task agent with model="opus" to discover issues:

Scan the target code for fixable issues:

**Bugs**
- Logic errors, off-by-one, null/undefined handling
- Race conditions, async/await misuse
- Incorrect type coercion, comparison errors
- Missing error handling, unhandled promise rejections

**Dependencies**
- Run `npm audit` or equivalent to find vulnerabilities
- Check for outdated packages with security patches
- Identify unused dependencies
- Find missing peer dependencies

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

## Phase 3: Committee Discussion

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

You are the PROPOSER. For each identified issue, propose a specific fix.

For each fix provide:
1. **Issue**: What's wrong (file:line)
2. **Root Cause**: Why this happened
3. **Proposed Fix**: Exact code changes
4. **Testing**: How to verify the fix works
5. **Risk Level**: low/medium/high

Focus on MINIMAL, TARGETED fixes. Don't over-engineer.
- Fix the bug, don't refactor the whole function
- Update the dependency, don't rewrite the feature
- Remove the dead code, don't reorganize the file

Output numbered list of proposed fixes.
</task>
```

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

You are the CRITIC. Challenge each proposed fix:

For each fix:
1. **Regression Risk**: Could this break existing functionality?
2. **Edge Cases**: Does the fix handle all scenarios?
3. **Dependencies**: Will this affect other parts of the codebase?
4. **Test Coverage**: Is there adequate testing for this fix?
5. **Alternative**: Is there a simpler or safer approach?

Also check:
- Are there fixes the proposer should have suggested but didn't?
- Are any "fixes" actually unnecessary or harmful?
- Are the risk levels accurate?

Output:
**Fix Critiques** (for each: Approve/Modify/Reject with reasoning)
**Missing Fixes** (issues that need fixing but weren't addressed)
**Warnings** (things to watch out for during implementation)
</task>
```

### Round 3 - Synthesizer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

You are the SYNTHESIZER. Produce the final fix plan.

Review proposer's fixes and critic's challenges:

1. **Approve** fixes that passed criticism
2. **Modify** fixes based on valid concerns
3. **Reject** fixes that are too risky or unnecessary
4. **Add** missing fixes identified by critic
5. **Order** fixes by dependency (what must be done first)

Output the FINAL FIX PLAN:

## Safe to Fix (Low Risk)
[Fixes that can be applied immediately]

## Requires Caution (Medium Risk)
[Fixes that need careful implementation and testing]

## Needs Discussion (High Risk)
[Fixes that might need user approval before proceeding]

## Rejected
[Proposed fixes that shouldn't be done, with reasons]

## Implementation Order
1. [First fix - no dependencies]
2. [Second fix - depends on #1]
...
</task>
```

## Phase 4: Implementation

Execute the synthesized fix plan:

1. Present the plan to user for approval on high-risk items
2. Implement fixes in the specified order
3. After each fix:
   - Run tests if available (`npm test`, `pytest`, etc.)
   - Run linter if available
   - Verify the fix doesn't break anything
4. If a fix causes issues, revert and report

## Phase 5: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

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
