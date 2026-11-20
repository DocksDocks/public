# Bug-Fix Templates

Per-finding-type expansion of the parent SKILL.md Step 4 plan template. Load when the fix list contains functional bugs — wrong output, crashes, state corruption, race conditions, edge-case failures reported by users or surfaced by integration tests.

## Reproduce Before Fix — The Test-First Contract

Parent SKILL.md constraint "Reproduce a reported bug BEFORE fixing it". This is the operational template.

```
1. Find the smallest input that triggers the bug.
2. Write the failing test that asserts the correct behavior.
3. Confirm the test currently FAILS (red).
4. Apply the fix.
5. Confirm the test now PASSES (green).
6. Confirm no other test regressed.
```

If you can't reach step 3 (test infrastructure missing, bug not triggerable in test env, race condition non-deterministic), STOP and discuss with the user. A speculative fix often moves the bug rather than removing it.

## Reproduction Test — Where to Put It

| Bug type | Test layer |
|---|---|
| Pure function returning wrong output | Unit test next to the function (`foo.test.ts` / `test_foo.py`) |
| Multi-module orchestration failure | Integration test with real dependencies (real DB); HTTP recorded and replayed with `nock`/`vcr` |
| API endpoint contract bug | Endpoint-level test that calls your own app: supertest / FastAPI `TestClient` or `httpx.ASGITransport` / Django test client |
| Concurrency / race condition | Loom (Rust) / `pytest-asyncio` with explicit `asyncio.gather` / Go's `-race` flag |
| UI behavior bug | Component test (RTL / Vitest browser mode) for state-driven bugs; Playwright/Cypress only for true cross-page flows |
| Environment-specific (works locally, fails in prod) | Test the env-difference in isolation: env var, locale, timezone, file-system case |

Rule of thumb: put the test at the lowest layer where the bug is observable. Smaller blast radius → faster feedback → easier revert.

## Bisect When the Cause Is Elusive

If you can reproduce but can't locate the root cause:

```bash
git bisect start
git bisect bad                     # current commit is broken
git bisect good <last-known-good>  # SHA where it worked
# git runs through commits binary-search style; mark each:
git bisect good  # or
git bisect bad
git bisect reset
```

Once bisect names the offending commit, read its diff in full. The fix is usually targeted at that diff, not a rewrite.

## Test-Strategy Template

| Field | Required content |
|---|---|
| Reproduction test | Path + test name; assertion shape |
| Currently fails? | Y/N + exact assertion message |
| Regression-prevention test | Same test, kept in suite forever — proves the bug stays fixed |
| Adjacent tests | Existing tests on this path: confirm they still pass after the fix |
| Integration confirmation | If the fix touches a boundary, the integration test exercising that boundary |

## Revert Trigger — Bug-Fix Specifics

- **Adjacent test regression** — any test in the same file or test suite flips → revert; the fix moved the bug rather than removing it.
- **The reproduction test itself fails** — you applied the "fix" and the bug still reproduces → diagnosis is wrong; revert before applying more changes.
- **Unrelated test in a downstream module flips** — your change crossed an unintended boundary; revert and narrow the diff.
- **Build breaks on a CI-only platform** (different OS / Node / Python version) → revert; the fix relied on local-env behavior.

## Common Bug-Fix Anti-Patterns

| Anti-pattern | Why it fails | Right thing |
|---|---|---|
| Add a special case in the call site | One-off branch grows over time, each special case unverified | Fix the function so the general case is correct |
| Catch + log the error to "stop the crash" | Bug now silent; data still corrupts | Fix the root cause; if the error is truly recoverable, return a typed result, not silence |
| Sleep + retry to "fix" a race condition | Masks the race in CI, ships in prod | Identify the synchronization point; add an explicit await/lock/channel |
| Edit prod data to "unblock" the bug, then fix later | Data drift between env, no migration record | Fix the code path; if data is corrupted, write a migration with a dry-run mode |
| "I'll add a test in the next PR" | The fix is unverified; the next PR never happens | The test that proves the fix IS the contract; same PR or no merge |
| Comment-out the failing assertion | Test still in suite but no longer testing | Either fix the code so the assertion holds, or delete the test with rationale in the commit |

## See Also

- `../SKILL.md` — universal 6-step procedure
- `tdd-workflow` skill — when test-first is the discipline before any new feature
- `code-review` skill — bug-finding upstream of fix-workflow
- `git bisect` docs: https://git-scm.com/docs/git-bisect
