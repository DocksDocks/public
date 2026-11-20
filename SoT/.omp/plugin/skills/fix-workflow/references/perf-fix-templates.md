# Performance-Fix Templates

Per-finding-type expansion of the parent SKILL.md Step 4 plan template. Load when the fix list contains slow queries, N+1 patterns, sync I/O blocking event loops, render cascades, memory pressure, or any profiler output.

## Profile Before Fix

A perf fix without a baseline measurement is speculation. Capture numbers BEFORE the fix:

| Domain | Tool | Capture |
|---|---|---|
| Node.js CPU / hot paths | `node --prof` + `node --prof-process`; clinic.js doctor/flame; `0x` | Top-3 hottest functions, ms/call |
| Browser render | Chrome DevTools Performance panel; React Profiler | Long-task count, frame drops, commit duration |
| Python | `cProfile` + `snakeviz`; `py-spy top` (live); `scalene` (CPU + memory) | Cumulative time per function |
| Rust | `cargo flamegraph`; `perf` + `inferno`; `criterion` for micro-bench | Stack samples + ns/iter |
| Go | `go tool pprof`; `runtime/pprof` programmatic; `runtime/trace` | CPU profile + alloc profile |
| SQL | `EXPLAIN ANALYZE` (PG) / `EXPLAIN FORMAT=JSON` (MySQL); `pg_stat_statements` | Query plan + actual rows + cost |

The "Why" field in Step 4 cites the measurement. "Looks slow" is not a finding.

## Test-Strategy Template

Perf tests must lock in the regression-prevention:

| Pattern | Test strategy |
|---|---|
| N+1 query | Count queries: wrap `client.query`, or use a driver/ORM hook (knex `.on('query')`, pg-promise `query` event, Sequelize `logging`/`benchmark`); assert ≤ K queries per request |
| Slow query | `EXPLAIN ANALYZE` regression test in CI: assert plan uses the expected index |
| Render cascade | React Profiler API: assert commit-count under N for a given user action |
| Hot loop allocation | Benchmark with a fixed input size; assert ns/iter under a threshold (criterion / vitest bench) |
| Async backpressure | Stress test: send 10k requests; assert p99 latency under threshold |
| Memory leak | Heap snapshot before + after K iterations; assert delta under threshold (or zero) |

If the project has no perf-test infrastructure, the test strategy is the bench script you'll add. Document it.

## Revert Trigger — Perf Specifics

The universal "if test X fails, revert" rule isn't enough. Add:

- **Regression threshold** — bench shows the change made it WORSE (negative win, or smaller win than expected) → revert. Pick the threshold up front; default ±5% noise tolerance.
- **Latency p99 regression** — even if median improved, if p99 degraded > 10%, the fix shifted cost rather than removed it → revert.
- **Memory regression** — heap-snapshot delta grew → revert; you traded CPU for memory.
- **Throughput regression** — req/s under load dropped after the "optimization" → revert; usually means a contention pattern got worse.

## Common Perf-Fix Anti-Patterns

| Anti-pattern | Why it fails | Right thing |
|---|---|---|
| Cache the result of a slow call without bounding | Cache grows unbounded → OOM under load | Use LRU / TTL / size-cap; measure hit rate, evict pressure |
| Add an index to "fix" a slow query without checking write cost | Read got 2× faster, writes got 5× slower | Verify both read AND write benchmarks; sometimes the right fix is a partial / covering index |
| `Promise.all` to "make it concurrent" | Hits rate limits / fans out unbounded fetches → resource exhaustion | Bounded concurrency: `p-limit`, semaphore, batched chunks |
| Memoize at the wrong layer | Cache lives at the function but inputs are reference-equality-unstable → cache always misses | Memoize at the boundary where input identity is stable; or content-hash the key |
| Lazy-load to "fix" startup time without measuring it | Defers cost to the first user action → perceived UX got worse | Measure both startup AND first-action latency; defer only what's truly off-path |
| Premature SIMD / micro-opt without profile | Reads non-idiomatic, gains 0.3% | Re-check profile after the obvious wins (algorithm, data structure, query plan) |

## Common Patterns Quick-Map

| Symptom | Likely root cause |
|---|---|
| Linear slowdown with collection size | Algorithmic complexity — O(n²) where O(n) is achievable |
| Sudden cliff at K items | Cache thrashing / index exhaustion / connection pool exhaustion |
| Slow only under load | Lock contention / GC pressure / connection limits |
| Slow only in production | Different data shape, different network topology, missing index |
| Slow only on cold start | Lazy module load, JIT warmup, cold connection pool |

## See Also

- `../SKILL.md` — universal 6-step procedure
- Chrome DevTools Performance: https://developer.chrome.com/docs/devtools/performance
- `go tool pprof`: https://go.dev/blog/pprof
- `EXPLAIN ANALYZE` (PostgreSQL): https://www.postgresql.org/docs/current/sql-explain.html
