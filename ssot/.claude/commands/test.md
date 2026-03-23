# Test Generator

Generate tests following project patterns and conventions. Uses Builder-Verifier pattern to ensure coverage and quality.

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
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(npm:*, pnpm:*, pytest:*, go:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- Phase 4 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Understand the project's testing setup, patterns, and identify target code to test.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the test framework (Jest, Vitest, Pytest, Go test, etc.)
- Find existing test files and understand their patterns
- Check test configuration (jest.config, vitest.config, pytest.ini, etc.)
- If `.claude/skills/` exists, read relevant project skills for testing conventions
- Understand mocking strategies used in the project
- Identify the target code to test (use $ARGUMENTS if provided)
- Note code coverage configuration if present

**Output Format:**
- Test framework and configuration
- Existing test patterns and mocking strategies
- Target code to test with file paths

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Identified test framework, existing patterns, and target scope with file paths.
</task>
```

## Phase 2: Analysis

### Analyze Target Code

```xml
<task>
Launch a Task agent with model="opus" to analyze the target:

**Objective:** Analyze the target code to identify all functions, dependencies, edge cases, and integration points for test coverage.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration output for project testing conventions

Analyze the code that needs tests:

1. **Functions/Methods**: List all functions with their signatures
2. **Dependencies**: What does this code depend on? (external services, databases, etc.)
3. **Side Effects**: Does it mutate state, make API calls, write files?
4. **Edge Cases**: Identify boundary conditions, error scenarios, null cases
5. **Happy Paths**: Identify the main success scenarios
6. **Integration Points**: Where does this code interact with other modules?

Output a structured analysis for test generation.

**Output Format:**
Structured analysis with functions, dependencies, side effects, edge cases, happy paths, and integration points.

**Success Criteria:**
All public functions listed with signatures. Edge cases identified for each function. Dependencies mapped for mocking strategy.
</task>
```

## Phase 3: Generator

```xml
<task>
Launch a Task agent with model="opus" to act as the GENERATOR:

**Objective:** Generate tests covering all functions, edge cases, and integration points in the target code.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use analysis output for functions, edge cases, and dependencies

You are the GENERATOR. Generate tests for the target code covering all functions, edge cases, and error paths.

<constraint>
- Follow the project's existing test patterns and conventions exactly
- If project skills exist, read `.claude/skills/` for project test standards
- Before writing tests that use framework APIs (jest, vitest, pytest, etc.): FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Do NOT assume API signatures, method names, or config options from training data.
- Use the project's actual mocking strategies (do NOT invent new patterns)
</constraint>

<constraint>
Write tests in two passes:
1. **Structure pass:** Write all describe/it blocks, imports, and mock setup first. Verify every import path against real project files before continuing.
2. **Implementation pass:** Fill in setup/act/assert for each test.
Do NOT write assertions before verifying function signatures match actual code.
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

- BAD: "Test that the function works correctly"
- GOOD: "it('returns 401 when JWT is expired', () => { const token = createExpiredJWT(); const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`); expect(res.status).toBe(401); })"

**Edge cases to cover:**
- Null/undefined inputs, empty arrays/objects
- Boundary values (0, -1, MAX_INT)
- Invalid types, async errors/timeouts
- Concurrent operations

Output complete test code following the project's existing patterns.

**Success Criteria:**
All imports match real project paths. All function signatures in tests match actual code. Every test has meaningful assertions (not just mock verification).
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the generated tests against the actual codebase, catching false positives and missing coverage.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Generator output as input

You are the VERIFIER. Validate the generated tests against the actual codebase.

For each test:
1. Do import paths match the real project structure?
2. Do function signatures in tests match actual code signatures?
3. Are mock return values realistic (check actual function return types)?
4. Does the test actually test behavior (not just testing mocks)?
5. Are test file names and describe blocks following project convention?
6. Could this test pass even when code is broken? (false positive check)

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

Output:
## Tests Verified
[Tests that are correct and test what they claim]

## Tests With Issues
[For each: specific problem and fix needed]

## Coverage Assessment
- Functions covered: X/Y
- Edge cases covered: [list]
- Missing scenarios: [list]

**Success Criteria:**
Spot-checked 5+ file:line references. All import paths verified against real project. Zero false-positive tests in approved list.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Generator output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Test Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Complete test plan with test cases
2. Files to create and locations
3. Test scenarios covered

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation

After approval:

1. Write the test file(s) using Write tool
2. Run the tests to verify they pass
3. If tests fail, diagnose and fix:
   - Is the test wrong? Fix the test
   - Is the code wrong? Report the bug
4. Track all changes for verification

## Phase 7: Post-Implementation Verifier

### Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Verify generated tests are correct, actually test what they claim, and the test suite passes.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

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

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

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

**Success Criteria:**
All tests pass. Every test verified to test real behavior (not just mocks). Zero false-positive tests.
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
