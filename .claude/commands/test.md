# Test Generator

Generate comprehensive tests following project patterns and conventions. Uses Devil's Advocate committee to ensure thorough coverage and quality.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## ⚠️ MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute Phases 1-4** → Read-only analysis and committee discussion
3. **Present Plan** → Show user the complete test plan
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 5-6** → Only after approval, write tests

**STOP! Use the EnterPlanMode tool now before continuing.**

---

## Planning Phase Tools (READ-ONLY)
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(npm:*, pnpm:*, pytest:*, go:*)

---

## Phase 1: Exploration

First, understand the project's testing setup and patterns.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the test framework (Jest, Vitest, Pytest, Go test, etc.)
- Find existing test files and understand their patterns
- Check test configuration (jest.config, vitest.config, pytest.ini, etc.)
- If `.claude/context/_index.json` exists, read it and relevant branch files for project testing conventions
- Understand mocking strategies used in the project
- Identify the target code to test (use $ARGUMENTS if provided)
- Note code coverage configuration if present
</task>
```

## Phase 2: Analysis

### Analyze Target Code

```xml
<task>
Launch a Task agent with model="opus" to analyze the target:

First, run `date "+%Y-%m-%d"` to confirm current date.

Analyze the code that needs tests:

1. **Functions/Methods**: List all functions with their signatures
2. **Dependencies**: What does this code depend on? (external services, databases, etc.)
3. **Side Effects**: Does it mutate state, make API calls, write files?
4. **Edge Cases**: Identify boundary conditions, error scenarios, null cases
5. **Happy Paths**: Identify the main success scenarios
6. **Integration Points**: Where does this code interact with other modules?

Output a structured analysis for test generation.
</task>
```

## Phase 3: Committee Discussion

### Round 1 — Proposer

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PROPOSER. Generate comprehensive tests for the target code.

<constraint>
- Follow the project's existing test patterns and conventions exactly
- If a context tree exists, read `.claude/context/testing/` for project test standards
- Use the project's actual mocking strategies (do NOT invent new patterns)
</constraint>

**Test categories:**

| Type | Scope |
|------|-------|
| Unit | Each function in isolation, mock external deps, happy + error paths, boundaries |
| Integration | Module interactions, real deps where safe, data flow verification |

**Per test, include:**
1. Descriptive test name (project conventions)
2. Setup / arrange
3. Action / act
4. Assertions / assert
5. Cleanup if needed

**Edge cases to cover:**
- Null/undefined inputs, empty arrays/objects
- Boundary values (0, -1, MAX_INT)
- Invalid types, async errors/timeouts
- Concurrent operations

Output complete test code following the project's existing patterns.
</task>
```

### Round 2 — Critic

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the CRITIC. Review the proposed tests for quality and completeness.

**Per-test checks:**
- **Assertion Quality**: Specific enough? Testing the right things?
- **Isolation**: Unit properly isolated? Mocks correct?
- **Flakiness Risk**: Could fail randomly? (timing, order dependency)
- **Readability**: Clear and maintainable?
- **False Positives**: Could pass when code is broken?

**Coverage gaps:**
- Scenarios NOT tested? Edge cases missed?
- Error paths not covered? Implicit assumptions?

**Anti-patterns to flag:**

| Anti-pattern | Why it's bad |
|-------------|-------------|
| Testing implementation details | Breaks on refactor, doesn't verify behavior |
| Over-mocking | Tests mock, not real code |
| Unrelated multi-assertions | Unclear what failed |
| Test interdependence | Order-dependent failures |
| Hardcoded values | Should be parameterized |

**Output:**
- **Test Critiques** (for each: Approve / Improve with specifics)
- **Missing Tests** (scenarios that need coverage)
- **Anti-Patterns Found** (problems to fix)
</task>
```

### Round 3 — Synthesizer

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the SYNTHESIZER. Produce the final test suite.

Given proposer's tests and critic's feedback:

1. **Keep** tests that passed criticism
2. **Improve** tests based on valid concerns
3. **Add** missing tests identified by critic
4. **Remove** tests that are flaky or test wrong things
5. **Reorder** tests logically (simple → complex, unit → integration)

Output the FINAL TEST SUITE:

```[language]
// Test file header with imports

describe('[Module/Component Name]', () => {
  // Setup

  // Unit Tests
  describe('[function name]', () => {
    it('should [expected behavior]', () => {
      // test code
    });
  });

  // Integration Tests (if applicable)
  describe('integration', () => {
    // ...
  });
});
```

Also output:
- Total tests: X
- Coverage estimate: Y%
- Notes on what couldn't be easily tested
</task>
```

## Phase 4: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the committee produces the final test suite:

1. Present the complete test plan with all test cases
2. Show what files will be created and where
3. List all test scenarios being covered
4. Ask user to review and approve before proceeding
5. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

**Do NOT proceed to Phase 5 without user approval.**

If user requests changes:
- Revise the test plan based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 5: Implementation

Once user has approved the plan:

1. Write the test file(s) using Write tool
2. Run the tests to verify they pass
3. If tests fail, diagnose and fix:
   - Is the test wrong? Fix the test
   - Is the code wrong? Report the bug
4. Track all changes for verification

## Phase 6: Post-Implementation Verification

### Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the VERIFIER. Your job is to verify the generated tests are correct and actually test what they claim.

1. Run the full test suite and capture results
2. For EACH test, verify:
   - Does the test actually test the behavior it claims to test?
   - Are the mocks correct? (Do they match real implementations?)
   - Are assertions testing the right things?
   - Could this test pass with broken code? (false positive check)

3. Cross-reference tests with actual code:
   - Do function signatures in tests match real code?
   - Are mock return values realistic?
   - Do test scenarios match how the code is actually used?

4. Check for common mistakes:
   - Tests that always pass (no real assertions)
   - Tests that test mocks instead of real behavior
   - Incorrect async handling
   - Missing cleanup that could affect other tests

**Output:**
## Tests Verified Correct
[Tests that properly test the code]

## ERRORS FOUND - Must Fix
[Tests with problems, with specific issues]

## Test Results
- Passed: X
- Failed: Y
- Coverage: Z%

## Recommendations
[Any additional tests that should be added]
</task>
```

After verification:
- Fix any incorrect tests
- Re-run test suite to confirm all pass
- Report final coverage and test count to user

## Allowed Tools

```yaml
- Read
- Glob
- Grep
- Task
- Edit
- Write
- Bash(npm:*)
- Bash(pnpm:*)
- Bash(yarn:*)
- Bash(pytest:*)
- Bash(go:*)
- Bash(ls:*)
```

## Usage

```bash
# Generate tests for a specific file
/test src/utils/auth.ts

# Generate tests for a directory
/test src/api/

# Generate tests for recent changes
/test
```
