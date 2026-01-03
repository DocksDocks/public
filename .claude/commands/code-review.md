---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*)
description: Code review with SOLID compliance checks
---

# Code Review Analysis

Review code changes thoroughly, focusing on correctness, SOLID principles, and stack-specific best practices.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `tsconfig.json` for TypeScript configuration
2. Check `package.json` for frameworks and dependencies
3. Check lock files for package manager
4. Check for testing frameworks (Jest, Vitest, etc.)
5. Check for linting/formatting configs (ESLint, Prettier, Biome)

Adapt review criteria based on detected stack.

---

## SOLID Principles Compliance

### Single Responsibility
- [ ] Each changed file has one clear purpose
- [ ] Functions do one thing well
- [ ] No mixing of concerns (UI/logic/data)

### Open/Closed
- [ ] Changes extend rather than modify existing code
- [ ] New features don't require changing existing code
- [ ] Abstractions allow for extension

### Liskov Substitution
- [ ] Subtypes are substitutable for base types
- [ ] No type checks for specific implementations
- [ ] Contracts are maintained in overrides

### Interface Segregation
- [ ] Interfaces are focused and minimal
- [ ] No unused interface methods
- [ ] Clients only depend on what they use

### Dependency Inversion
- [ ] High-level modules don't depend on low-level details
- [ ] Dependencies are injected, not created
- [ ] Abstractions are used appropriately

---

## Core Review Checklist

### Correctness
- [ ] Logic is correct and handles all cases
- [ ] Edge cases are properly handled
- [ ] Error handling is appropriate
- [ ] No regression in existing functionality

### Security
- [ ] No security vulnerabilities introduced
- [ ] Input validation present where needed
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

---

## Stack-Specific Checks

### If TypeScript Detected
- [ ] No `any` types without justification
- [ ] Strict mode compliance
- [ ] Proper type narrowing
- [ ] No type assertions (`as`) where avoidable
- [ ] Generic types used appropriately

### If React/Next.js Detected
- [ ] Hooks rules followed (dependencies, order)
- [ ] No unnecessary re-renders
- [ ] Keys provided for lists
- [ ] Proper use of server/client components (App Router)
- [ ] No hydration mismatches
- [ ] Proper error boundaries

### If Fastify/Express Detected
- [ ] Routes properly validated
- [ ] Error handling middleware
- [ ] Proper async/await in handlers
- [ ] No blocking operations
- [ ] Security headers present

### If State Management Detected
- [ ] No direct state mutations
- [ ] Selectors used for derived state
- [ ] Actions are properly typed
- [ ] No stale closures in callbacks

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

**Universal Checks:**
- [ ] Queries use ORM builders (parameterized, no injection)
- [ ] Transactions used where needed
- [ ] No N+1 query issues (relations eagerly loaded)
- [ ] Proper connection handling
- [ ] Migrations are reversible
- [ ] No raw SQL with user input concatenation

**ORM-Specific:**
- **Drizzle**: `returning()` called, same `tx` instance, no `sql.raw()` with input
- **Prisma**: Proper `include`/`select`, `$transaction` used correctly
- **TypeORM**: QueryBuilder parameters used, relations configured

### If Docker Detected
- [ ] No secrets in Dockerfile
- [ ] Multi-stage builds for production
- [ ] Non-root user specified
- [ ] Proper .dockerignore

---

## Output Format

Focus on issues that matter. For each issue:

1. **Severity**: Critical / High / Medium / Low
2. **Category**: Bug / Security / Performance / SOLID / Style
3. **Location**: File and line
4. **Issue**: What's wrong
5. **Suggestion**: How to fix

**Prioritize**:
1. Bugs and logic errors
2. Security vulnerabilities
3. SOLID violations
4. Performance issues

Skip style nitpicks unless they affect functionality or significantly harm readability.
