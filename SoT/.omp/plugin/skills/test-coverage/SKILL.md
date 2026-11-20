---
name: test-coverage
description: Use when writing tests for code that ALREADY EXISTS — adding coverage to an untested file, backfilling tests after a feature ships, raising line/branch coverage, or generating tests from a target path or function. Follows the project's existing test framework, mocking conventions, and coverage config. Not for test-first development where the test drives a yet-to-exist implementation (use tdd-workflow for that).
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "45e6fe280a58319a5bb33a8f67eaa026afc238c8606d01d0e5e3c0bc7a409fc8"
---

# Test Coverage Generation

<constraint>
Generated tests must use the project's existing test framework (Vitest / Jest / pytest / cargo test / go test / JUnit / etc.) — never introduce a new framework as a side effect of writing tests. Inspect `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / `pom.xml` / `build.gradle` and existing `*.test.*` / `*_test.*` / `Test*.java` files BEFORE writing the first test.
</constraint>

<constraint>
Each generated test must exercise REAL behavior. A test that only verifies mock invocations (`expect(mockFn).toHaveBeenCalledWith(...)`) without asserting on a real input → output transformation is a false-positive — it stays green even when the production code is broken. Every test needs at least one assertion against a value the code under test produced.
</constraint>

<constraint>
Production code is READ-ONLY in this mode. If a test fails because the test itself is wrong (typo, bad mock, wrong import path), fix the test. If a test fails because the production code is wrong, REPORT the bug and stop — do not modify production code while in test-coverage mode. Bug-fixing belongs in a separate cycle.
</constraint>

<constraint>
Don't generate tests for code with no behavior worth verifying — re-export barrels (`index.ts`), type-only modules (`*.types.ts`, `.d.ts`), generated clients (Prisma, protoc, OpenAPI, GraphQL codegen), migration files, simple constant modules, and framework config files (`*.config.*`, `@Configuration` classes, `appsettings.json`-style). A test that only asserts "the file exports a function" inflates the coverage % without catching anything. Configure the framework's coverage-exclusion rules so the headline number reflects MEANINGFUL behavior coverage — per-framework config snippets live in the matching `references/<framework>.md`.
</constraint>

## When to Use

- A file or directory has no test coverage and the user wants tests added
- Coverage report shows a function below the project's threshold and the user asks to backfill
- The user says "add tests for X", "test this file", "I need coverage for Y", or specifies a path/function
- A bug fix landed without a regression test and you're adding the test after the fact

NOT for:
- Test-first development where the test is the spec (use **tdd-workflow** — different skill, different ordering)
- Structural refactoring itself (use **refactor**; use this skill first only when existing behavior needs characterization)
- Pure smoke tests that only check "does it import" (those tests are noise; write meaningful assertions or skip)

## The Six-Step Procedure

These run sequentially. Each step has an explicit anti-hallucination check before the next begins.

### Step 1 — Detect framework + conventions

Read these in order:

1. `package.json` `scripts.test` / `pyproject.toml [tool.pytest]` / `Cargo.toml [dev-dependencies]` / `go.mod` / `pom.xml` or `build.gradle` — the canonical framework declaration
2. One existing test file from the project (find with `Glob '**/*.test.*'` or `**/*_test.*` or `**/Test*.java`) — captures the project's actual style: assertion library, describe/it vs flat, mock helpers, file naming
3. Coverage config if present: `vitest.config.*` / `jest.config.*` / `.coveragerc` / `tarpaulin.toml` / `.tarpaulin.toml` / JaCoCo plugin block — tells you which thresholds matter

Don't proceed without these three reads. Mimicking the project's style from a sample is what makes generated tests fit; running blind produces tests that look "off" and require rewriting.

## When to Load Per-Framework Conventions

For framework-specific file layout, mocking conventions, assertion idioms, async patterns, **parallelism / perf tuning**, **coverage-scope exclusion config**, and discovery commands:

| Framework | Reference file |
|---|---|
| Vitest / Jest (JS / TS) | `references/jest-vitest.md` |
| pytest (Python) | `references/pytest.md` |
| `cargo test` (Rust) | `references/cargo-test.md` |
| `go test` (Go) | `references/go-test.md` |
| JUnit 5 / Jupiter (Java / JVM) | `references/junit.md` |

### Step 2 — Inventory the target

For the path/function the user gave you:

- List every exported function/class/module
- For each: parameter types, return type, side effects (filesystem, network, DB, env vars), error paths
- External dependencies that need mocking — distinguish "I/O the test must isolate" vs "pure computation that needs no mock"
- Edge cases: null/undefined, boundary values (0, -1, MAX_INT, empty string, empty array), invalid types if the function is dynamically typed, async error paths, concurrent invocations
- Test kind for each item: read `references/test-types.md` and choose an end-to-end, property, differential, or example-based test. A user flow needs an end-to-end test. A parser or serializer needs a property test. A replaced implementation needs a differential test

Write this inventory down before writing tests. It's the test plan. If you skip this and jump to test code, you'll write tests for what you remember about the file rather than what's actually in it.

### Step 3 — Structure pass (skeleton only, no assertions yet)

Write the test file as `describe`/`it` blocks (or the project's idiomatic equivalent — fixtures, `#[test]`, `func Test...`) with imports, mock setup, and empty test bodies. Universal principle (sample shown in Vitest; applies in every framework):

```ts
// BAD — start writing assertions immediately, find out halfway that import path is wrong
import { foo } from "../utils/helpers"; // wrong path
describe("foo", () => {
  it("returns 42 for valid input", () => {
    expect(foo("x")).toBe(42); // 12 lines down before noticing import broke
  });
});
```

```ts
// GOOD — structure pass first; every import resolved before assertions
import { parseDuration } from "@/utils/parse-duration"; // verified path
import { describe, it, expect } from "vitest";
describe("parseDuration", () => {
  it("parses '1h30m' to 5400000 ms", () => { /* assertion in step 4 */ });
  it("parses '750ms' to 750", () => { /* assertion in step 4 */ });
  it("throws on invalid input '7 furlongs'", () => { /* assertion in step 4 */ });
});
```

Verify every import path resolves (`Glob` or read the source) BEFORE filling in assertions. A broken import makes every test in the file fail with the same misleading "module not found" — the structure pass surfaces this immediately while you can still cheaply reroute.

### Step 4 — Implementation pass (fill assertions)

Now write the setup → act → assert per test. Use the inventory from Step 2 as the spec. For every test, make sure:

- The assertion is on a value the code under test PRODUCED, not on whether a mock was called
- Mock return values match the real function's actual return shape (read the source if unsure — don't guess)
- Async tests use the framework's async pattern (`await`, `.resolves`/`.rejects`, `tokio::test`, `pytest-asyncio`, `done` callback) — never mix patterns in one test
- Cleanup happens (close files, reset mocks, restore env vars) — usually `afterEach` / `beforeEach` / `t.Cleanup` / pytest fixture teardown

### Step 5 — Pre-run verification (catch false positives BEFORE running)

Read the test file you just wrote. For each test, ask:

- **Would this test fail if the production code returned the wrong value?** If a test asserts `expect(result).toBeDefined()` and the function returns anything non-null, the test is too loose — tighten it.
- **Would this test fail if a critical branch were removed?** If you mock the dependency that contains the branch, the test no longer covers that branch. Redesign — either don't mock, or add a separate test that exercises the real code path.
- **Are mocks set up to match reality?** Read the real implementation of the mocked function. If your mock returns `{ data: [] }` but the real function returns `[]`, the test passes against the mock but breaks against reality.
- **Spot-check 5+ file:line references** — every `import` path, every `vi.mock("...")` path, every `from "..."`. Run `Glob` or `Read` on each to confirm.

Reject any test that fails these checks before running the suite.

### Step 6 — Run, then post-verify

Use the runner the project actually uses — never invent one. Per-framework command surface lives in the matching reference file (`bun run test`, `pnpm test`, `pytest`, `cargo test`, `go test`, `mvn test` / `gradle test`).

After the suite passes, do NOT report "tests added" yet. Run the post-verification:

- For each green test, verify the test file is in the suite's discovery glob (project config-dependent — `vitest.config.ts` `include`, `pytest.ini` `testpaths`, etc.)
- Run with the project's coverage flag if it has one and confirm the new file appears in coverage output
- Apply the **lint-loop 3-strike rule**: if a single test keeps failing for 3 attempts on the same file, stop and ask the user — repeated failure usually means the diagnosis is wrong, not the code

## Common Traps

| Trap | Wrong fix | Right fix |
|---|---|---|
| Test passes against mocks, fails against reality | Mock returns whatever shape makes the test green | Read the real function's return type/value; mock returns the same shape |
| Assertion only checks mock-was-called, not actual output | `expect(fetchMock).toHaveBeenCalledTimes(1)` and call it done | Add an assertion on the function's actual return value |
| Test imports broken; every test fails with same error | Add `// @ts-ignore` to silence import errors | Verify import paths in the structure pass (Step 3); fix the path, not the type system |
| Coverage thresholds set to 90% so you mock everything to get there | Mock all deps to skip uncovered branches | Cover the branches with real code paths; if you must mock, mock at the boundary, not deep |
| Async test never awaits; passes "instantly" without exercising the code | `it("async thing", () => { thing(); })` returns synchronously | `it("async thing", async () => { const r = await thing(); expect(r).toBe(...); })` |
| Test file passes locally but isn't picked up by CI | New test file outside the project's discovery glob | Confirm in coverage report; if missing, fix the glob or rename the file to match |
| Generating 50 tests at once without inventory | Skip Step 2, write tests by intuition | Inventory first (Step 2), then test the inventory items one by one |
| Modifying production code mid-test to make a test pass | "I'll just fix this one thing in the source while I'm here" | Stop. Test-coverage mode is read-only on production code. Bug? Report it. |
| A new test fails now and then | Add a retry flag, a sleep, or a skip until the run passes | Find the root cause (seed, clock, order, shared state, network). If no cause is found, delete the test and record the reason. See `references/test-types.md` |

## Pairing With tdd-workflow

These two skills carry distinct workflows; do not run them at the same time:

| Situation | Skill |
|---|---|
| Writing tests for code that exists | **test-coverage** (this skill) |
| Writing tests as the spec for code that doesn't exist yet | **tdd-workflow** |
| Bug fix landed without regression test, want to backfill | **test-coverage** |
| New feature, user wants test-first development | **tdd-workflow** |
| Adding coverage to a refactoring target before refactoring | **test-coverage** (treat as "characterize current behavior") |

The skills share the lint-loop 3-strike rule and the discipline of running tests before claiming green. They differ in what tests are *allowed to do*: test-coverage tests pin existing behavior; tdd-workflow tests express not-yet-implemented behavior.

## Anti-Hallucination Checks

- Before claiming a test is "ready", verify with `test -f <test-file-path>` that the file actually exists
- Run the test before reporting; do not infer pass/fail from reading the code
- Coverage claims need numerical evidence — quote the coverage tool's output, don't paraphrase
- Mock setups need to be checked against the real function — if you wrote `vi.mock("./api", () => ({ fetchUser: () => ({ id: 1 }) }))`, read `./api` and confirm `fetchUser` actually returns `{ id: 1 }` (not `{ user: { id: 1 } }` or a Promise)

## References

- Companion skill: **tdd-workflow** — for test-first development (different ordering, tests as spec)
- Per-framework conventions: `references/jest-vitest.md`, `references/pytest.md`, `references/cargo-test.md`, `references/go-test.md`, `references/junit.md`
- Test types (end-to-end, property, differential, flaky): `references/test-types.md`
- Project conventions: always read one existing test file before writing the first new one — that's the project's actual style guide

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks-kit repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
