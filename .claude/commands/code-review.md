---
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git diff:*), Bash(git log:*)
description: Review and fix code issues
---

# Code Fixer

Review code and **fix issues directly**. Do not just report - implement fixes for correctness, SOLID violations, and best practices.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `tsconfig.json` for:
   - Path aliases (`@/*`, `~/*`, etc.) - verify imports use them
   - Strict mode compliance requirements
   - Compiler options
2. Check `package.json` for frameworks, dependencies, and workspaces
3. Check `pnpm-workspace.yaml` for monorepo structure
4. Check lock files for package manager
5. Check for testing frameworks (Jest, Vitest, etc.)
6. Check for linting/formatting configs (ESLint, Prettier, Biome)
7. Check for scripts (`scripts/`, `*.sh`)

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
- [ ] Using project path aliases (`@/`) instead of relative imports (`../../`)
- [ ] Imports follow project conventions

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

### If Monorepo/Workspaces Detected
- [ ] Using `workspace:*` for internal package deps
- [ ] Cross-package imports use correct aliases
- [ ] Shared configs properly extended
- [ ] No circular workspace dependencies

### If Scripts Detected (*.sh)
- [ ] Scripts have proper error handling (`set -e`)
- [ ] Environment variables validated
- [ ] Scripts are documented
- [ ] No hardcoded secrets

---

## Implementation

**Fix issues directly in this order:**
1. Bugs and logic errors
2. Security vulnerabilities
3. SOLID violations
4. Performance issues

**For each issue:**
1. Edit the file to fix the problem
2. Apply proper patterns and practices
3. Ensure SOLID compliance
4. Add missing validation/error handling

Skip style nitpicks unless they affect functionality or significantly harm readability.

## Output Format

After implementing fixes, report:

### Fixes Applied
| File | Category | Issue | Fix |
|------|----------|-------|-----|
| src/api.ts:45 | Security | Missing validation | Added Zod schema |
| src/store.ts:12 | SOLID/SRP | Mixed concerns | Split into services |

### Summary
- Bugs fixed: X
- Security issues fixed: X
- SOLID violations fixed: X
- Files modified: X
