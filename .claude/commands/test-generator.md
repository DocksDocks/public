---
allowed-tools: Read, Grep, Glob, Write
description: Generate comprehensive test coverage
---

# Test Generation Task

Analyze the codebase and generate comprehensive tests following existing patterns and conventions.

## Phase 1: Analysis
1. Identify existing test framework and patterns
2. Find untested or under-tested code
3. Analyze code paths and branches
4. Identify edge cases and boundary conditions

## Test Categories to Generate

### Unit Tests
- Test each function/method in isolation
- Cover all code paths and branches
- Test edge cases: null, undefined, empty, boundary values
- Test error conditions and exception handling
- Test async behavior and promises

### Integration Tests
- Test module interactions
- Test API endpoints end-to-end
- Test database operations
- Test external service integrations (with mocks)

### Edge Cases to Cover
- Empty inputs
- Null/undefined values
- Maximum/minimum values
- Invalid types
- Concurrent operations
- Timeout scenarios
- Network failures (mocked)

## Test Quality Requirements
- Each test should test ONE thing
- Descriptive test names explaining the scenario
- Arrange-Act-Assert pattern
- Proper setup and teardown
- No test interdependencies
- Fast execution
- Deterministic results

## Output
For each test file:
1. Match existing project test conventions
2. Include setup/teardown as needed
3. Group related tests logically
4. Add comments for complex test scenarios
5. Include both positive and negative test cases
