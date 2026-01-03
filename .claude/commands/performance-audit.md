---
allowed-tools: Read, Grep, Glob, Bash(wc:*), Bash(find:*)
description: Performance audit with stack-specific optimizations
---

# Performance Analysis & Optimization

Conduct a comprehensive performance review with stack-specific optimization recommendations.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `package.json` for frameworks (Next.js, Fastify, Expo, etc.)
2. Check `tsconfig.json` for path aliases to trace imports
3. Check for bundler config (next.config.js, vite.config.ts, etc.)
4. Check for database/ORM (Prisma, Drizzle, pg, etc.)
5. Check for caching (Redis, in-memory, etc.)
6. Check for Docker configuration

Adapt performance analysis based on detected stack.

---

## Universal Performance Checks

### Algorithm Efficiency
- Time complexity issues (O(n²) or worse when better exists)
- Nested loops that could be optimized
- Redundant calculations or repeated work
- Inefficient data structure choices
- Missing memoization opportunities

### Memory Management
- Memory leaks or retained references
- Loading entire datasets when streaming is possible
- Excessive object instantiation in loops
- Large data structures kept in memory unnecessarily
- Closures capturing more than needed

### Async & Concurrency
- Blocking operations that should be async
- Sequential operations that could run in parallel
- Missing Promise.all() or concurrent execution
- Unnecessary awaits
- Event loop blocking operations

---

## Stack-Specific Performance

### If Next.js Detected

#### Rendering Performance
- Unnecessary client components (should be server)
- Missing Suspense boundaries
- Large JavaScript bundles
- Missing dynamic imports / code splitting
- Unoptimized images (use next/image)
- Missing static generation where possible

#### Data Fetching
- Waterfall requests (should be parallel)
- Missing request deduplication
- Over-fetching data
- No caching strategy (revalidate, cache tags)
- Blocking data fetches in layout

#### Bundle Optimization
- Large dependencies that could be smaller
- Missing tree shaking
- Unused exports in bundles
- Server-only code in client bundle

### If Fastify/Express Detected

#### Request Handling
- Slow middleware chain
- Missing response compression
- No request/response streaming
- Synchronous operations in handlers
- Missing request timeouts

#### Serialization
- Slow JSON serialization (use fast-json-stringify)
- Large response payloads
- Missing pagination
- No response caching

### If React Detected

#### Rendering Optimization
- Unnecessary re-renders (use React DevTools)
- Missing React.memo() for expensive components
- Missing useMemo/useCallback where needed
- Large component trees without boundaries
- State updates causing full tree re-renders

#### State Management
- Selectors not memoized
- Over-subscribing to store updates
- Large state objects without normalization
- Missing selector composition

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

#### Universal Query Performance
- N+1 query problems
- Missing database indexes
- Full table scans
- Inefficient JOINs
- Missing EXPLAIN ANALYZE on slow queries
- No query result caching

#### Universal Connection Management
- Missing connection pooling
- Connection leaks
- Pool exhaustion under load
- No connection timeouts

#### ORM-Specific Optimization

**Drizzle:**
- Use prepared statements for repeated queries
- Select only needed columns: `db.select({ id, name })`
- Use `with` for eager loading, avoid N+1
- Batch inserts with `values([...])`

**Prisma:**
- Use `select` to limit fields returned
- Use `include` wisely (avoid over-fetching)
- Batch with `createMany()`, `$transaction`
- Use `findFirst` instead of `findMany()[0]`

**TypeORM:**
- Use QueryBuilder for complex queries
- Configure eager/lazy relations appropriately
- Use `select` in find options

```typescript
// Generic N+1 prevention pattern
// BAD: Query in loop
for (const user of users) {
  const posts = await getPosts(user.id) // N+1!
}

// GOOD: Eager load relations
const usersWithPosts = await getUsersWithPosts() // Single query
```

### If Redis Detected

#### Caching Strategy
- Cache miss rate too high
- Missing cache invalidation
- TTL too short/long
- Key design inefficiencies
- Missing pipelining for multiple ops

#### Memory Usage
- Large values without compression
- No eviction policy
- Memory fragmentation

### If Docker Detected

#### Build Performance
- No layer caching optimization
- Large base images
- Missing multi-stage builds
- .dockerignore not optimized
- Unnecessary files in image

#### Runtime Performance
- No resource limits set
- Missing health checks
- Inefficient restart policies

### If Expo/React Native Detected

#### Rendering
- FlatList not optimized (missing keyExtractor, getItemLayout)
- Large images not cached
- Missing skeleton loaders
- Heavy computations on JS thread

#### Bundle Size
- Unused native modules
- Large assets bundled
- Missing OTA update strategy

---

## Output Format

For each performance issue:

1. **Location**: File and line
2. **Category**: Algorithm / Memory / Network / Rendering / Database
3. **Current**: What's happening now
4. **Impact**: Estimated performance cost (ms, memory, etc.)
5. **Optimized**: Recommended solution with code
6. **Benefit**: Expected improvement
7. **Priority**: Critical / High / Medium / Low

**Prioritize by**:
1. User-facing latency issues
2. Resource exhaustion risks
3. Scalability blockers
4. General optimizations
