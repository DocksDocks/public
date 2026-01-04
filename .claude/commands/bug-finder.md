---
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Find and fix bugs directly
---

# Bug Fixer

Find bugs, logic errors, and stack-specific issues, then **fix them directly**. Do not just report - implement the fixes.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before making changes.

1. **Launch explore agent** to:
   - Map code structure and dependencies
   - Find related tests and error handling patterns
   - Check git history for recent bug fixes
   - Identify critical code paths

## Phase 0.5: Project Detection

Identify the project stack:
1. Check `tsconfig.json` for:
   - Path aliases (`@/*`, `~/*`) - resolve import paths correctly
   - Strict mode settings
   - Module resolution
2. Check `package.json` for frameworks and libraries
3. Check `pnpm-workspace.yaml` for monorepo structure
4. Check for testing setup (to understand coverage)
5. Check for state management (Zustand, Redux, etc.)
6. Check for database/ORM configuration
7. Check for scripts (`scripts/`, `*.sh`)

Adapt bug detection based on detected stack.

---

## Phase 1: Planning

Before implementing any fixes, create a plan:

1. **Use Task tool** with `subagent_type=Explore` to:
   - Understand the affected code areas
   - Trace data flow and dependencies
   - Identify related tests and patterns

2. **Create a fix plan** listing:
   - Each bug found with file:line reference
   - Root cause analysis
   - Proposed fix approach
   - Potential side effects

3. **Present plan to user** for approval before implementing

---

## Phase 2: Verification (Multi-Agent)

Before implementing, **launch multiple agents in parallel** to verify findings:

```
Use Task tool to launch these agents simultaneously:
```

1. **Agent 1 - Bug Verification**: Confirm each bug exists and is reproducible
2. **Agent 2 - Impact Analysis**: Check for side effects and related issues
3. **Agent 3 - Test Coverage**: Verify tests exist or identify test gaps

**Cross-check results:**
- All agents must agree on bug severity
- Conflicts require additional investigation
- Only proceed when verification passes

---

## Universal Bug Patterns

### Logic Errors
- Off-by-one errors in loops and array access
- Incorrect boolean logic and condition checks
- Wrong comparison operators (== vs ===)
- Incorrect operator precedence
- Falsy value confusion (0, '', null, undefined)

### Error Handling
- Unhandled exceptions and promise rejections
- Missing try-catch in critical paths
- Silent failures that swallow errors
- Improper error propagation
- Missing validation on inputs

### Async Issues
- Race conditions
- Unhandled promise rejections
- Missing await keywords
- Deadlock potential
- Stale closure problems
- Memory leaks from uncleared intervals/listeners

### Data Flow
- Incorrect data transformations
- Missing data sanitization
- Improper type conversions
- Data truncation issues
- Encoding/decoding problems

---

## Stack-Specific Bug Patterns

### If TypeScript Detected
- `any` types hiding bugs
- Incorrect type assertions (`as`)
- Missing null checks despite strict mode
- Type narrowing not applied
- Generic constraints too loose
- Enums used incorrectly
- Optional chaining masking errors

### If React/Next.js Detected

#### Hydration Bugs
- Server/client content mismatch
- Using browser APIs during SSR
- Date/time differences between server/client
- Random values during render

#### Hooks Bugs
- Missing dependencies in useEffect
- Stale closures in callbacks
- Rules of hooks violations
- Infinite re-render loops
- State updates on unmounted components

#### Next.js Specific
- Server Actions not validated
- Metadata generation errors
- Route handler type mismatches
- Middleware not matching routes
- Dynamic route parameter issues

### If Fastify/Express Detected
- Route handler not returning response
- Missing async/await in handlers
- Error middleware not catching
- Request body not validated
- Headers set after response sent
- Route conflicts/shadowing
- Plugin registration order issues

### If State Management Detected (Zustand/Redux)
- Direct state mutation
- Selector returning new references
- Actions not updating state immutably
- Middleware not applied correctly
- Persistence/hydration mismatches
- Race conditions in async actions

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, Sequelize, Knex, or raw queries.

#### Universal Query Bugs
- N+1 queries in loops
- Wrong relation loading (eager vs lazy)
- Transaction not committed/rolled back
- Connection pool exhaustion
- Deadlocks from transaction order

#### Universal Data Bugs
- Missing unique constraints
- Cascade delete issues
- Foreign key violations
- Data type mismatches
- Timezone handling errors

#### ORM-Specific Bugs
**Drizzle:**
- Missing `await` on query execution
- Incorrect `eq()`, `and()`, `or()` usage
- Transaction not using same `tx` instance
- `returning()` not called when needed

**Prisma:**
- Missing `await` on queries
- Incorrect `include` vs `select` usage
- Transaction isolation level issues
- `$transaction` not awaited properly

**TypeORM:**
- Repository method misuse
- Lazy relation not awaited
- QueryBuilder missing `getMany()`/`getOne()`
- Entity listener errors

### If Expo/React Native Detected
- Platform-specific code not handled
- Navigation state bugs
- Deep link handling errors
- Gesture handler conflicts
- Native module crashes
- Memory leaks in event listeners

### If Monorepo/Workspaces Detected
- Cross-package import resolution errors
- Version mismatches between packages
- Circular dependencies between workspaces
- Build order issues
- Shared config not applied

### If Scripts Detected (*.sh)
- Missing error handling (no `set -e`)
- Unquoted variables causing word splitting
- Missing command existence checks
- Race conditions in parallel operations

---

## Edge Case Analysis

### Boundary Conditions
- Empty arrays/objects
- Null/undefined values
- Zero values
- Maximum/minimum values
- Empty strings vs null
- Negative numbers

### Concurrency Edge Cases
- Simultaneous operations
- Retry logic failures
- Timeout scenarios
- Network failures mid-operation

---

## Implementation

**Fix bugs directly in this order:**
1. Data corruption/loss risks
2. Security implications
3. User-facing crashes
4. Silent failures
5. Edge case handling

**For each bug:**
1. Edit the file to fix the bug
2. Add missing error handling
3. Fix logic errors
4. Add missing null checks
5. Fix async issues (missing await, race conditions)

## Output Format

After implementing fixes, report:

### Bugs Fixed
| File | Category | Bug | Fix Applied |
|------|----------|-----|-------------|
| src/utils.ts:23 | Logic | Off-by-one error | Fixed loop bounds |

### Summary
- Critical fixed: X
- Bugs fixed: X
- Files modified: X
