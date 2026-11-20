---
name: tdd-workflow
description: Use when the user asks for TDD, test-first, "write the test first then implement", "spec it out with tests", red-green-refactor, or describes a feature as input/output pairs and wants tests to drive the implementation. Also for NEW behavior with no test coverage where tests act as the spec. Not for adding tests to existing code (use test-coverage). Not for migrations/ports ("failing test per route before porting") — characterization of existing behavior belongs in test-coverage, not TDD.
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-17"
  content_hash: "878ee307a3ff69679e7616a0385c25d90026814657408ed09172dcf7d2eff25c"
---

# Test-Driven Development Workflow

<constraint>
TDD is an ORDERING contract, not a label. Production code MUST NOT be written before a failing test that requires it. Tests MUST NOT be modified during the implementation phase to make them pass — modifying the test changes the spec. If the test is wrong, stop and ask the user; do not silently rewrite it.
</constraint>

## When to Use

- User says "TDD", "test-first", "write the spec as tests", "red-green-refactor", or "describe this with input/output pairs"
- New feature work where the user can articulate the expected behavior in concrete examples before any code exists
- Bug fix where the user wants a regression test written first that reproduces the bug, then the fix

NOT for:
- Adding tests to code that already works (use the `test-coverage` skill)
- Structural refactoring itself (use the `refactor` skill); use `test-coverage` first only when existing behavior needs characterization
- Exploratory spikes / one-shot scripts where the spec genuinely doesn't exist yet
- Pure debugging where you already have a failing test from CI

## The Five Phases

These run in order. Each phase has an explicit yield point — do not silently skip ahead.

### Phase 1 — Spec (write tests, no implementation)

1. Confirm with the user the input/output pairs that define the feature. Push back on vague specs ("it should handle errors gracefully") until you have concrete examples.
2. Write the tests. Use the project's existing test framework (check `package.json` / `Cargo.toml` / `pyproject.toml`).
3. **Do not write any production code yet.** If you find yourself adding a function stub "just so the test compiles," stop — the project may already have a stub or the test should test through public API.
4. Imports in the test file may reference types/functions that don't exist yet. That's expected; it produces the failing baseline.

### Phase 2 — Failing baseline (run, observe, report)

1. Run the test suite (or just the new test file, scoped).
2. Capture the *exact* failure mode for each new test:
   - **Compile error** — type doesn't exist, import path wrong → that's the spec failure for this phase
   - **Runtime error** — function doesn't exist, throws on call → expected at this phase
   - **Assertion failure** — function exists but returns wrong value → expected at this phase
3. Report the failure shape to the user: "All N tests failing: K compile, L runtime, M assertion. Ready for implementation."
4. **Do not proceed to Phase 3 until tests fail for the right reason.** A test that passes prematurely is broken — fix the test, then re-run.

### Phase 3 — Implementation (production code only, tests are READ-ONLY)

1. Tests are now frozen. Touching them in this phase requires explicit user permission.
2. Write the minimum production code that could plausibly make the failing tests pass.
3. If a test is impossible to pass given the constraints (the spec is contradictory, requires unavailable infrastructure, or the test itself has a typo), STOP and tell the user. Do not silently rewrite the test.
4. If you discover the spec is wrong (test asserts the wrong thing), STOP and ask. Modifying the spec mid-implementation defeats the purpose of TDD.

### Phase 4 — Iterate (run → fix prod → run → fix prod, until green)

1. Run tests. Read each failure.
2. Fix the *production code*. Tests stay read-only.
3. Re-run.
4. Apply the **lint-loop 3-strike rule** — don't loop more than 3 times trying to fix the same failing test on the same file. On the third attempt, stop and ask the user (or revisit the spec). Repeated failure usually means the diagnosis is wrong, not the code.
5. When all green: report it as "all N tests passing, implementation complete."

### Phase 5 — Refactor (only after all green)

1. Now production code can be improved without changing behavior.
2. Run tests after every refactor — they must stay green.
3. Tests can be cleaned up here (extract helpers, dedupe setup) but their *assertions* must not change.
4. If you want to change an assertion, that's a Phase 1 task on a new feature/spec, not a refactor.

<constraint>
Test assertions are read-only during Phases 3–5; Phase 5 may refactor test structure only. If a test is wrong (typo, contradictory assertion, impossible-to-satisfy spec), STOP and escalate to the user. Do not silently rewrite a test to make it pass — that defeats the purpose of TDD and produces a spec the user did not approve.
</constraint>

<constraint>
Phase 2 (failing baseline) is mandatory. A test that passes on first run is broken. Always execute Phase 2 even when you're certain the test will fail — duplicate symbol names, default-value coincidences, and stale module caches routinely produce passing tests for unimplemented features.
</constraint>

## Common Traps

| Trap | Wrong fix | Right fix |
|---|---|---|
| Writing tests + implementation in the same edit | Skip Phase 2 because "tests will obviously fail" | Force Phase 1 to commit (or stage) before Phase 3 starts. Tests visible in `git diff` before any prod code change. |
| Adding stub functions in Phase 1 "to make the test compile" | Add an empty `function foo() {}` stub | Tests can reference non-existent types/functions in Phase 1 — the compile error IS the failing baseline. |
| A failing test in Phase 4 won't go green | Modify the test assertion to match current behavior | Test assertions are read-only in Phases 3–5. If the test is genuinely wrong, escalate to the user. |
| Skipping Phase 2 ("tests will obviously fail") | Trust the obvious | Always run after Phase 1. The failing-mode shape is the contract that says "feature isn't there yet." |
| Refactoring during Phase 3 ("while I'm here") | Mix refactor + new behavior | Save refactor for Phase 5. Refactoring is unsafe without all-green tests. |
| Bundling multiple features into one TDD session | One big spec, one giant impl | One feature per TDD cycle. Commit between cycles. |
| Spec for a parser or a serializer has only a few examples | Add more hand-picked examples | Add a property test next to the examples: round-trip, idempotency, or equivalence to a naive version. Use the property library that the project has. See `test-coverage`, `references/test-types.md` |
| The red test fails on some runs and passes on others | Count it as the failing baseline | A flaky test is not a red test. Find the cause (seed, clock, order, shared state, network) before Phase 3. Never add a retry, a sleep, or a skip |

## Phase 1 Example — Test Without Stub

Concrete shape of "tests can reference non-existent symbols in Phase 1." The compile error here IS the failing baseline:

```ts
// src/parse-duration.test.ts — Phase 1 output
import { parseDuration } from "./parse-duration";  // module doesn't exist yet — that's fine
import { describe, it, expect } from "vitest";

describe("parseDuration", () => {
  it("parses '1h30m' to 5400000 ms", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });
  it("parses '750ms' to 750", () => {
    expect(parseDuration("750ms")).toBe(750);
  });
  it("throws on invalid input '7 furlongs'", () => {
    expect(() => parseDuration("7 furlongs")).toThrow(/invalid duration/i);
  });
});
```

Phase 2 baseline output: `Cannot find module './parse-duration'` — perfect failing baseline. Phase 3 implements the module.

## Phase Transitions — Explicit Reporting

Each phase boundary should produce a brief status line so the user knows where you are without reading every tool call:

- End of Phase 1: "Spec phase done. {N} tests written in `path/to/file.test.ts`. Running them now."
- End of Phase 2: "Failing baseline confirmed. {K} compile / {L} runtime / {M} assertion failures. Starting implementation."
- End of Phase 3 (first impl pass): "Initial implementation written. Running tests."
- End of Phase 4 (all green): "All {N} tests passing. Ready to refactor or finish."
- End of Phase 5 / done: "Implementation complete. Tests still green after refactor."

## When the User Asks for TDD But the Project Has No Test Setup

1. Stop. Don't write tests against a missing framework.
2. Inspect: `package.json` scripts, `vitest.config.ts` / `jest.config.js` / `pytest.ini` / `Cargo.toml [dev-dependencies]`.
3. If genuinely no framework: ask the user which to add. Suggest the project-stack default (Vitest for Vite/Next.js, pytest for Python, the language's stdlib for Go/Rust).
4. Add the framework as a separate, explicit step BEFORE Phase 1. That step is not part of TDD — it's setup.

## When the Test Framework's Failing Baseline Is Ambiguous

Some frameworks (e.g., older Jest, certain Python configurations) report "0 tests run" when imports fail, instead of a clear compile/import error. This makes Phase 2 ambiguous. The exact failure shape drifts across framework versions — verify YOUR runner's behavior with a deliberate broken-import probe (a should-fail run against a file importing a nonexistent module) before trusting the baseline.

Mitigations:
- Run the test file directly, not the full suite, so import errors surface clearly
- For TypeScript: run `tsc --noEmit -p .` (or the project's typecheck script) and read the errors for the test file. Do not pass the test file to `tsc` directly: with input files on the command line, `tsc` ignores `tsconfig.json`
- For Python: run `python -c "import path.to.test_module"` to surface import errors

## Why This Ordering Matters

Test-first is not bureaucracy. The failing baseline (Phase 2) is the only moment in the workflow where you know with certainty that:

1. The test runs in this project's environment (config, paths, mocks all wired)
2. The test exercises the right module / signature
3. The test fails because the feature isn't there, not because the test itself is broken

Skip Phase 2 and you cannot distinguish "test passes because feature works" from "test passes because the test is broken." That distinction is what TDD pays you for.

## References

- Kent Beck, "Test-Driven Development By Example" — the canonical sequence
- Cursor agent best-practices (test-first recipe): https://cursor.com/blog/agent-best-practices — blog URLs drift; re-verify the link resolves before citing it
- Agentic best-practice applied (model-agnostic): linter-loop 3-strike — stop after the third failed attempt on the same test; the diagnosis is more often wrong than the code

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
