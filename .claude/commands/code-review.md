---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*)
description: Comprehensive pull request and code review
---

# Code Review Analysis

Review this code change thoroughly, focusing on issues that matter.

## Review Checklist

### Correctness
- [ ] Logic is correct and handles all cases
- [ ] Edge cases are properly handled
- [ ] Error handling is appropriate
- [ ] No regression in existing functionality

### Security
- [ ] No security vulnerabilities introduced
- [ ] Input validation present
- [ ] No sensitive data exposure
- [ ] Authentication/authorization correct

### Performance
- [ ] No obvious performance issues
- [ ] Database queries are efficient
- [ ] No memory leaks introduced
- [ ] Async operations handled correctly

### Code Quality
- [ ] Code is readable and maintainable
- [ ] Follows project conventions
- [ ] No unnecessary complexity
- [ ] DRY principle followed

### Testing
- [ ] Tests cover new functionality
- [ ] Tests cover edge cases
- [ ] Tests are meaningful (not just coverage)

## Output Format
Focus ONLY on:
1. **Bugs**: Actual logic errors
2. **Security Issues**: Real vulnerabilities
3. **Critical Issues**: Things that will break in production

Be concise. Skip style nitpicks unless they affect functionality.
