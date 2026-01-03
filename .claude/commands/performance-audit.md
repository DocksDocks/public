---
allowed-tools: Read, Grep, Glob, Bash(wc:*), Bash(find:*)
description: Performance audit and optimization recommendations
---

# Performance Analysis & Optimization

Conduct a comprehensive performance review covering all layers of the application.

## Areas to Analyze

### Database & Data Access
- N+1 query problems and missing eager loading
- Lack of database indexes on frequently queried columns
- Inefficient joins or subqueries
- Missing pagination on large result sets
- Absence of query result caching
- Connection pooling issues

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

### Async & Concurrency
- Blocking I/O operations that should be async
- Sequential operations that could run in parallel
- Missing Promise.all() or concurrent execution
- Unnecessary awaits
- Event loop blocking operations

### Network & I/O
- Missing HTTP caching headers
- Uncompressed responses
- Too many round-trips (chatty APIs)
- Large payload transfers
- Missing connection reuse

### Frontend Performance (if applicable)
- Large bundle sizes
- Missing code splitting
- Render-blocking resources
- Unoptimized images
- Missing lazy loading
- Excessive re-renders

## Output Format
For each issue:
1. **Location**: File and line
2. **Current**: What's happening now
3. **Impact**: Estimated performance cost
4. **Optimized**: Recommended solution with code
5. **Benefit**: Expected improvement
