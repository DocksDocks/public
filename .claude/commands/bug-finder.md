---
allowed-tools: Read, Grep, Glob, Bash(git diff:*), Bash(git log:*)
description: Deep bug analysis with stack-specific checks
---

# Comprehensive Bug Analysis

Perform thorough investigation for bugs, logic errors, and stack-specific issues.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `tsconfig.json` for:
   - Path aliases (`@/*`, `~/*`) - resolve import paths correctly
   - Strict mode settings
   - Module resolution
2. Check `package.json` for frameworks and libraries
3. Check for testing setup (to understand coverage)
4. Check for state management (Zustand, Redux, etc.)
5. Check for database/ORM configuration

Adapt bug detection based on detected stack.

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

## Output Format

For each bug found:

1. **Location**: File path and line number
2. **Severity**: Critical / High / Medium / Low
3. **Category**: Logic / Async / Type / State / Data
4. **Description**: What the bug is
5. **Trigger**: How to reproduce
6. **Impact**: What could go wrong
7. **Fix**: Suggested code change
8. **Test**: How to verify the fix

**Priority Order**:
1. Data corruption/loss risks
2. Security implications
3. User-facing crashes
4. Silent failures
5. Edge case handling

Focus on real, exploitable bugs rather than style issues.
