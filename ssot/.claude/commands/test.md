---
name: test
description: Use when generating tests for a codebase following the project's existing framework and patterns. Analyzes target code for functions/edge cases/integration points, generates tests via a structure-then-implementation pass, and validates each test against actual code signatures through a Builder-Verifier pattern.
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch Edit
  Bash(date) Bash(git status) Bash(git log:*) Bash(git diff:*)
  Bash(git add:*) Bash(git restore:*) Bash(rtk:*) Bash(mkdir:*)
  Bash(npm test) Bash(npm run test:*)
  Bash(pnpm test) Bash(pnpm run test:*) Bash(yarn test)
  Bash(pytest:*) Bash(cargo test:*) Bash(go test:*)
  Bash(npx tsc:*) Bash(npx eslint:*) Bash(ruff:*) Bash(mypy:*)
---

# Test Generator

Generate tests following project patterns and conventions. Thin orchestrator — all domain logic lives in the subagents below.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- Phase 5 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Phase 1: Exploration

Invoke `subagent_type: test-explorer` with the following prompt:

> "Run /test Phase 1. Plan file path: {plan-path-from-system-prompt}. Scope: $ARGUMENTS (or full project if empty). Identify the test framework, existing test patterns, mocking strategies, coverage config, and target code to test. Write output to `## Phase 1: Exploration Results`."

## Phase 2: Analysis

Invoke `subagent_type: test-analyzer` with the following prompt:

> "Run /test Phase 2. Plan file path: {plan-path-from-system-prompt}. Read Phase 1 Explorer output. Enumerate all functions, dependencies, side effects, edge cases, happy paths, and integration points in the target scope. Identify untested functions. Write output to `## Phase 2: Analyzer Results`."

## Phase 3: Generation

Invoke `subagent_type: test-generator` with the following prompt:

> "Run /test Phase 3. Plan file path: {plan-path-from-system-prompt}. Read Phase 1 (framework, patterns, mocking strategy) and Phase 2 (functions inventory, dependencies map, coverage plan). Apply research-gate for test framework APIs. Structure pass first (describe/it blocks + imports + mock setup, verify all import paths), then implementation pass (setup/act/assert per test). Cover all functions, edge cases (null/undefined, boundaries, invalid types, async errors, concurrent ops), unit and integration scenarios. Write complete test code to `## Phase 3: Generated Tests`."

## Phase 4: Pre-Implementation Verification

Invoke `subagent_type: test-pre-verifier` with the following prompt:

> "Run /test Phase 4. Plan file path: {plan-path-from-system-prompt}. Read Phase 3 generated tests. Validate import paths (Glob each), function signatures (read source), mock return value shapes, naming conventions, and false-positive detection (would test fail if code is broken?). Spot-check 5+ file:line refs. Write output to `## Phase 4: Pre-Verification Results`."

<constraint>
After Phase 4 returns, write the Generator output and Pre-Verifier results to the plan file under `## Test Plan`. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Test files to create with paths
2. Complete test plan (functions covered, edge cases, scenarios)
3. Pre-verifier approved tests vs. flagged issues
4. Any issues requiring attention before implementation

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation

After approval:

1. Write test file(s) using `Write`.
2. Run the test suite using the runner from Phase 1 (e.g., `npm test`, `pytest`, `go test ./...`).
3. If tests fail, diagnose:
   - Test wrong? Fix the test using `Edit`.
   - Code wrong? Report the bug — do NOT modify production code.
4. Run type-checker/linter if applicable (`npx tsc --noEmit`, `npx eslint`, `ruff`, `mypy`).
5. Track all created/modified files for Phase 7 verification.

## Phase 7: Post-Implementation Verification

Invoke `subagent_type: test-post-verifier` with the following prompt:

> "Run /test Phase 7. Plan file path: {plan-path-from-system-prompt}. Read prior phase context. Run the full test suite, capture results. Verify each test asserts real behavior (not just mock invocations), mocks match reality, async is handled correctly, no missing cleanup. Flag false positives and always-passing tests. Write output to `## Phase 7: Post-Verification Results`."

After verification:
- Fix any incorrect tests using `Edit`.
- Re-run test suite to confirm all pass.
- Report final coverage and test count to user.

---

## Allowed Tools

See frontmatter. Orchestrator uses `Read`/`Write`/`Glob`/`Grep`/`Task` for phase management and `Edit`/`Bash(git *)` for implementation (post-ExitPlanMode only).

## Usage

```bash
/test src/utils/auth.ts   # Generate tests for a specific file
/test src/api/            # Generate tests for a directory
/test                     # Generate tests for recent changes or undertested code
```
