---
name: review
description: Use when reviewing code for bugs, security vulnerabilities, performance issues, or maintainability problems. Runs a Builder-Verifier pipeline (Analyzer + Verifier) over a target scope, producing a categorized findings list with file:line references, severity, and suggested fixes. Optional implementation phase applies fixes if requested.
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch Edit
  Bash(date) Bash(git status) Bash(git log:*) Bash(git diff:*)
  Bash(git add:*) Bash(git restore:*) Bash(rtk:*) Bash(mkdir:*)
  Bash(npm test) Bash(npm run test:*)
  Bash(pnpm test) Bash(pnpm run test:*) Bash(yarn test)
  Bash(pytest:*) Bash(npx tsc:*) Bash(npx eslint:*) Bash(ruff:*) Bash(mypy:*)
---

# Universal Code Review

Code review covering quality, security, and performance. Thin orchestrator — all domain logic lives in the subagents below.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- Phase 4 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Phase 1: Exploration

Invoke `subagent_type: review-explorer` with the following prompt:

> "Run /review Phase 1. Plan file path: {plan-path-from-system-prompt}. Scope: $ARGUMENTS (or full project if empty). Map the project stack, target scope, existing conventions, lint/test configs. Write output to the plan file under `## Phase 1: Exploration Results`."

## Phase 2: Analysis

Invoke `subagent_type: review-analyzer` with the following prompt:

> "Run /review Phase 2. Plan file path: {plan-path-from-system-prompt}. Read Phase 1 Explorer output. Review target scope for Code Quality, Security (OWASP Top 10), Performance, and AI Slop. Every finding needs file:line, severity, evidence, and targeted fix suggestion. Write output to `## Phase 2: Analyzer Findings`."

## Phase 3: Pre-Implementation Verification

Invoke `subagent_type: review-pre-verifier` with the following prompt:

> "Run /review Phase 3. Plan file path: {plan-path-from-system-prompt}. Read Phase 2 Analyzer findings. Validate each finding against the actual codebase — spot-check 5+ file:line refs, reject false positives, adjust mis-rated severity. Write output to `## Phase 3: Pre-Verification Results`."

<constraint>
After Phase 3 returns, write the Analyzer findings and Pre-Verifier results to the plan file under `## Analysis Results`. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 4: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Verified findings organized by severity (critical → high → medium → low)
2. Files, lines, and proposed fixes for each verified finding
3. Rejected findings summary (count + categories)

Plan Mode handles user approval. Once approved, proceed to Phase 5.

---

## Phase 5: Implementation

After approval:

1. Implement fixes starting with critical issues, in severity order.
2. Use `Edit` to make changes, preserving existing code style and conventions.
3. Run existing tests/linters after changes if available (`npm test`, `pytest`, `npx eslint`, `npx tsc --noEmit`, etc.).
4. If a fix causes a test failure or regression, revert with `git restore` and note the revert.
5. Track each change made for Phase 6 verification.

## Phase 6: Post-Implementation Verification

Invoke `subagent_type: review-post-verifier` with the following prompt:

> "Run /review Phase 6. Plan file path: {plan-path-from-system-prompt}. Read Phase 2 Analyzer findings and Phase 3 Pre-Verifier approvals. Run git diff, verify each change against the approved findings, run tests/linter/type-checker, flag any incorrect changes for revert. Write output to `## Phase 6: Post-Verification Results`."

After verification:
- Revert any incorrect changes immediately using `git restore`.
- Report what was fixed vs what was reverted.
- Present final summary to user.

---

## Allowed Tools

See frontmatter. Orchestrator uses `Read`/`Write`/`Glob`/`Grep`/`Task` for phase management and `Edit`/`Bash(git *)` for implementation (post-ExitPlanMode only).

## Usage

```bash
/review                  # Review entire project
/review src/api/         # Review specific directory
/review src/utils/auth.ts  # Review specific file
```
