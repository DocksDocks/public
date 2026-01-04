---
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Review and fix code issues
---

# Code Fixer

Review code and **fix issues directly**. Do not just report - implement fixes for correctness, SOLID violations, and best practices.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before making changes.

1. **Launch explore agent** to:
   - Understand code context and patterns
   - Check related tests and dependencies
   - Review git history for context
   - Identify coding conventions

## Phase 0.5: Project Detection

Identify the project stack:
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

## Phase 1: Planning

Before implementing any fixes, create a plan:

1. **Use Task tool** with `subagent_type=Explore` to:
   - Understand the code context and patterns
   - Check related tests and dependencies
   - Review git history for context

2. **Create a fix plan** listing:
   - Each issue with file:line reference
   - Category (bug, security, SOLID, performance)
   - Proposed fix approach
   - Test coverage status

3. **Present plan to user** for approval before implementing

---

## Phase 2: Verification (Multi-Agent)

Before fixing, **launch multiple agents in parallel** to verify:

```
Use Task tool to launch these agents simultaneously:
```

1. **Agent 1 - Issue Verification**: Confirm each issue is valid
2. **Agent 2 - Test Impact**: Check test coverage and potential regressions
3. **Agent 3 - Pattern Consistency**: Verify fixes match project conventions

**Cross-check results:**
- All agents must agree on issue validity
- Filter out style nitpicks unless impactful
- Only proceed with confirmed issues

---

## AI Slop Detection & Removal

**Identify and remove AI-generated code patterns:**

### Code Slop Patterns

#### Unnecessary Comments
```typescript
// BAD: Comment restates the code
// Get the user by ID
const user = getUserById(id)

// GOOD: No comment needed - code is clear
const user = getUserById(id)

// GOOD: Comment explains WHY, not what
// Cache busting required due to CDN edge caching
const url = `${base}?v=${Date.now()}`
```

#### Over-Abstraction
```typescript
// BAD: Abstraction for single use
const createUserNameFormatter = () => (user) => user.name.toUpperCase()
const formatUserName = createUserNameFormatter()

// GOOD: Direct and simple
const displayName = user.name.toUpperCase()
```

#### Verbose Naming
```typescript
// BAD: Redundant naming
const userDataObject = { userName: user.name }
const responseResultData = await fetchData()

// GOOD: Concise naming
const userData = { name: user.name }
const response = await fetchData()
```

#### Unnecessary Flexibility
```typescript
// BAD: Over-engineered for "future flexibility"
interface ConfigOptions {
  enableFeature?: boolean
  featureConfig?: FeatureConfig
  onFeatureInit?: () => void
  // ... 10 more unused options
}

// GOOD: Only what's needed now
interface Config {
  enabled: boolean
}
```

#### Bloated Error Handling
```typescript
// BAD: Catching and rethrowing with no value added
try {
  await doThing()
} catch (error) {
  console.error('An error occurred while doing the thing:', error)
  throw error
}

// GOOD: Either handle it or let it propagate
await doThing() // Let caller handle errors
```

### Fix Actions
1. **Remove** comments that restate code
2. **Inline** single-use abstractions
3. **Simplify** verbose variable/function names
4. **Delete** unused flexibility/options
5. **Flatten** unnecessary try-catch wrappers

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

### AI Slop Detection
- [ ] No excessive/unnecessary comments
- [ ] No over-explained obvious code
- [ ] No redundant variable names (e.g., `userUser`, `dataData`)
- [ ] No verbose function names when simple ones work
- [ ] No unnecessary abstractions "for flexibility"

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
