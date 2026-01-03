---
allowed-tools: Read, Grep, Glob, Bash(wc:*), Bash(find:*)
description: Performance audit with stack-specific optimizations
---

# Performance Analysis & Optimization

Conduct a comprehensive performance review with stack-specific optimization recommendations.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `package.json` for frameworks (Next.js, Fastify, Expo, etc.)
2. Check for bundler config (next.config.js, vite.config.ts, etc.)
3. Check for database/ORM (Prisma, Drizzle, pg, etc.)
4. Check for caching (Redis, in-memory, etc.)
5. Check for Docker configuration

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

### If Database Detected (PostgreSQL/etc.)

#### Query Performance
- N+1 query problems
- Missing database indexes
- Full table scans
- Inefficient JOINs
- Missing EXPLAIN ANALYZE on slow queries
- No query result caching

#### Connection Management
- Missing connection pooling
- Connection leaks
- Pool exhaustion under load
- No connection timeouts

### If Drizzle ORM Detected

#### Query Optimization
- Use prepared statements for repeated queries
- Avoid `db.query.*` for complex joins (use `db.select()`)
- Use `limit()` and `offset()` for pagination
- Select only needed columns: `db.select({ id, name })`
- Use `exists()` instead of counting for checks
- Batch inserts with `values([...])` not loops

#### Relation Loading
- Use `with` for eager loading relations
- Avoid nested `with` queries when joins suffice
- Consider `extras` for computed columns

```typescript
// Instead of N+1
for (const user of users) {
  const posts = await db.query.posts.findMany({
    where: eq(posts.userId, user.id)
  })
}

// Use relation query
const usersWithPosts = await db.query.users.findMany({
  with: { posts: true }
})
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
