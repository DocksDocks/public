# Universal Code Review

Comprehensive code review covering quality, security, and performance using a Devil's Advocate committee approach.

## Phase 1: Exploration

First, explore the codebase to understand context and identify the target scope.

```xml
<task>
Use the Task tool to launch an explore agent:
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

## Phase 3: Implementation

After the committee produces the final review:

1. Present the synthesized findings to the user
2. If user approves, implement fixes starting with critical issues
3. Use Edit tool to make changes, preserving existing code style
4. Run existing tests/linters after changes if available
5. Summarize what was fixed

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
