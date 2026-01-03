---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*)
description: Deep bug analysis across the codebase
---

# Comprehensive Bug Analysis

Perform a thorough investigation for bugs, logic errors, and potential issues.

## Analysis Areas

### 1. Logic Errors
- Off-by-one errors in loops and array access
- Incorrect boolean logic and condition checks
- Race conditions in async code
- Null/undefined reference issues
- Type coercion problems
- Edge case handling gaps

### 2. Error Handling
- Unhandled exceptions and promise rejections
- Missing try-catch blocks in critical paths
- Silent failures that swallow errors
- Improper error propagation
- Missing validation on inputs

### 3. State Management
- State mutation issues
- Stale closure problems
- Memory leaks from uncleared intervals/listeners
- Inconsistent state updates
- Missing state initialization

### 4. Data Flow Issues
- Incorrect data transformations
- Missing data sanitization
- Improper type conversions
- Data truncation issues
- Encoding/decoding problems

### 5. Concurrency Issues
- Race conditions
- Deadlock potential
- Missing locks/semaphores
- Incorrect async/await usage
- Promise handling errors

## Output Format
For each bug found, provide:
1. **Location**: File path and line number
2. **Severity**: Critical / High / Medium / Low
3. **Description**: What the bug is
4. **Impact**: What could go wrong
5. **Fix**: Suggested code change
6. **Test**: How to verify the fix

Focus on real, exploitable bugs rather than style issues.
