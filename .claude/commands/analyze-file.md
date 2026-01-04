---
allowed-tools: Read, Grep, Glob, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Deep analysis of a specific file with stack-aware checks
---

# Analyze File: $ARGUMENTS

Perform a comprehensive analysis of the specified file, adapting checks based on file type and project stack.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase context.

1. **Launch explore agent** to:
   - Map file dependencies (imports/exports)
   - Find related files (tests, types, consumers)
   - Understand architectural context
   - Check git history for recent changes

## Phase 1: Verification (Multi-Agent)

**Launch multiple agents in parallel** to gather comprehensive analysis:

```
Use Task tool to launch these agents simultaneously:
```

1. **Agent 1 - Dependency Analysis**: Map all imports and consumers
2. **Agent 2 - Quality Assessment**: Check for code smells and issues
3. **Agent 3 - Test Coverage**: Find related tests and coverage gaps

**Cross-check results:**
- Combine findings from all agents
- Prioritize issues by severity
- Build complete picture before reporting

---

## Phase 2: Context Detection

Understand the file context:
1. Identify file type (.ts, .tsx, .js, .json, etc.)
2. Check project stack from package.json
3. Check tsconfig.json/jsconfig.json for:
   - Path aliases (`@/*`, `~/*`, etc.)
   - Compiler options (strict, target, etc.)
   - Base URL configuration
4. Identify the file's role (component, route, service, util, etc.)
5. Check for related test files
6. Identify dependencies and dependents

---

## Code Quality Analysis

### Readability
- Clear and descriptive naming
- Appropriate comments for complex logic
- Consistent formatting
- Logical code organization

### Complexity
- Function/method length (flag > 30-50 lines)
- Cyclomatic complexity
- Nesting depth (flag > 3 levels)
- Parameter count (flag > 4)

### SOLID Principles
- Single Responsibility: Does this file do one thing?
- Open/Closed: Is it extensible without modification?
- Dependency Inversion: Are dependencies injected?

---

## Stack-Specific Analysis

### If TypeScript File (.ts/.tsx)
- Type coverage and quality
- Use of `any` (flag each instance)
- Proper generic usage
- Interface vs Type usage
- Strict mode compliance
- Null/undefined handling

### If React Component (.tsx/.jsx)
- Component structure and organization
- Hooks usage and rules compliance
- Props interface clarity
- Render efficiency (unnecessary re-renders)
- Accessibility (a11y) basics
- Error boundary coverage

### If Next.js File
- Server vs Client component correctness
- Data fetching patterns
- Metadata handling
- Route segment configuration
- Loading/Error UI patterns

### If Fastify Route/Plugin
- Schema validation completeness
- Error handling
- Async handler patterns
- Plugin encapsulation
- Lifecycle hook usage

### If Zustand Store
- State structure clarity
- Action naming and organization
- Selector patterns
- Persistence configuration
- DevTools integration

### If Database/ORM File
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

**Universal Analysis:**
- Query safety (parameterization)
- Transaction handling
- Connection management
- Error handling
- Type safety usage

**Schema/Model Files:**
- Schema/model organization
- Relation definitions
- Index definitions for queried columns
- Type exports for use in application

**ORM-Specific:**
- **Drizzle**: `relations()` usage, `$inferSelect`/`$inferInsert` exports
- **Prisma**: Schema.prisma structure, generated client usage
- **TypeORM**: Entity decorators, relation configurations

### If Test File
- Test coverage completeness
- Test naming clarity
- Arrange-Act-Assert pattern
- Mock appropriateness
- Edge case coverage

---

## Potential Issues

### Bugs and Logic Errors
- Off-by-one errors
- Null/undefined risks
- Race conditions
- Incorrect boolean logic

### Security Vulnerabilities
- Injection risks
- Data exposure
- Authentication gaps
- Input validation missing

### Performance Problems
- Unnecessary computations
- Memory leaks potential
- N+1 query patterns
- Missing memoization

### Error Handling
- Unhandled exceptions
- Silent failures
- Missing validation
- Poor error messages

---

## Improvement Suggestions

### Refactoring Opportunities
- Extract reusable logic
- Simplify complex conditionals
- Apply design patterns
- Reduce duplication

### Missing Elements
- Tests needed
- Documentation gaps
- Type definitions
- Error boundaries

### Modernization
- Deprecated APIs in use
- Better patterns available
- Language features to leverage

---

## Output Format

### 1. Summary
- File purpose and role
- Lines of code
- Complexity score
- Overall health: Good / Needs Attention / Problematic

### 2. Issues Found (Prioritized)

| Priority | Category | Line | Issue | Suggestion |
|----------|----------|------|-------|------------|
| High | Security | 42 | SQL concatenation | Use parameterized query |
| Medium | Type | 15 | `any` type | Define proper interface |

### 3. Recommendations
Specific improvements with code examples:

**Before:**
```typescript
// Current problematic code
```

**After:**
```typescript
// Improved code
```

### 4. Related Files to Review
- Files that depend on this one
- Files this one depends on
- Related test files
