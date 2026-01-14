# Test Generator

Generate comprehensive tests following project patterns and conventions. Uses Devil's Advocate committee to ensure thorough coverage and quality.

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

First, understand the project's testing setup and patterns.

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the test framework (Jest, Vitest, Pytest, Go test, etc.)
- Find existing test files and understand their patterns
- Check test configuration (jest.config, vitest.config, pytest.ini, etc.)
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

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

You are the PROPOSER. Generate comprehensive tests for the target code.

**Test Categories to Generate:**

**Unit Tests**
- Test each function in isolation
- Mock all external dependencies
- Cover happy path and error cases
- Test boundary conditions

**Integration Tests** (if applicable)
- Test interactions between modules
- Test with real dependencies where safe
- Verify data flow through the system

For each test:
1. Test name (descriptive, follows project conventions)
2. Setup/arrange phase
3. Action/act phase
4. Assertions/assert phase
5. Cleanup if needed

**Edge Cases to Cover:**
- Null/undefined inputs
- Empty arrays/objects
- Boundary values (0, -1, MAX_INT)
- Invalid types
- Async errors/timeouts
- Concurrent operations

Output complete test code following the project's existing patterns.
</task>
```

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

You are the CRITIC. Review the proposed tests for quality and completeness.

**For Each Test:**
1. **Assertion Quality**: Are assertions specific enough? Do they test the right things?
2. **Isolation**: Is the unit properly isolated? Are mocks correct?
3. **Flakiness Risk**: Could this test fail randomly? (timing, order dependency)
4. **Readability**: Is the test clear and maintainable?
5. **False Positives**: Could this test pass when the code is actually broken?

**Coverage Gaps:**
- What scenarios are NOT tested?
- What edge cases were missed?
- What error paths aren't covered?
- Are there implicit assumptions that should be tested?

**Anti-Patterns to Flag:**
- Testing implementation details instead of behavior
- Over-mocking (mocking things that don't need mocking)
- Multiple assertions testing unrelated things
- Tests that depend on each other
- Hardcoded values that should be parameterized

Output:
**Test Critiques** (for each: Approve/Improve with specifics)
**Missing Tests** (scenarios that need coverage)
**Anti-Patterns Found** (problems to fix)
</task>
```

### Round 3 - Synthesizer Agent (Sonnet 4.5)

```xml
<task>
Launch a Task agent with model="sonnet" to act as the SYNTHESIZER:

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

## Phase 4: Implementation

After the committee produces the final test suite:

1. Write the test file(s) using Write tool
2. Run the tests to verify they pass
3. If tests fail, diagnose and fix:
   - Is the test wrong? Fix the test
   - Is the code wrong? Report the bug

## Phase 5: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

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
