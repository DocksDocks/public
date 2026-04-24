---
name: refactor
description: Use when auditing a codebase for structural issues — dead code, duplication, SOLID violations (all 5 principles including Liskov), missing abstractions, modernization candidates. Generates a tiered refactoring plan (quick wins → consolidation → structural) with per-change test strategy and revert triggers. Full-project scan by default; accepts a path argument to scope.
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch Edit
  Bash(date) Bash(ls:*) Bash(find:*) Bash(wc:*) Bash(mkdir:*) Bash(rtk:*)
  Bash(git status) Bash(git log:*) Bash(git diff:*)
  Bash(git rm:*) Bash(git add:*) Bash(git restore:*)
  Bash(npx knip:*) Bash(npx depcheck:*) Bash(npx ts-prune:*) Bash(npx tsc:*) Bash(npx eslint:*)
  Bash(vulture:*) Bash(ruff:*) Bash(mypy:*)
  Bash(deadcode:*) Bash(cargo-udeps:*)
  Bash(npm test) Bash(npm run test:*) Bash(pnpm test) Bash(pnpm run test:*) Bash(yarn test)
  Bash(pytest:*) Bash(cargo test:*) Bash(go test:*)
---

# Universal Refactorer

Detect and fix structural code issues via a parallel-scan pipeline: dead code, duplication, SOLID violations (all 5 principles including Liskov), and modernization candidates. Uses model-tiered subagents (3 Opus, 4 Sonnet) with a dedicated SOLID Analyzer phase and Builder-Verifier pattern.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is Phase 6 (Present Plan + Exit Plan Mode).

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Phase 1: Exploration

Invoke `subagent_type: refactor-explorer` with the following prompt:

> "Run /refactor Phase 1. Plan file: {plan-file-path}. Target scope: $ARGUMENTS (empty = full project). Map project stack, monorepo structure, available analysis tools, test infrastructure, existing abstractions, and DI patterns per your system prompt. Write your output to the plan file under `## Phase 1: Exploration Results`."

After it returns, write its output to the plan file under `## Phase 1: Exploration Results`, then immediately launch Phase 2.

---

## Phase 2: Parallel Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Parallel invocations (in one turn):

- `subagent_type: refactor-dead-code-scanner` — Prompt: "Run /refactor Phase 2a. Plan file: {plan-file-path}. Find dead code (unused exports, unreachable code, unused deps, orphaned files) with SAFE/CAUTION/DANGER safety tiers per your system prompt. Write findings to the plan file under `## Phase 2a: Dead Code Findings`."
- `subagent_type: refactor-duplication-scanner` — Prompt: "Run /refactor Phase 2b. Plan file: {plan-file-path}. Find duplicate code, extraction candidates, frontend reuse opportunities, module-org issues, and modernization candidates per your system prompt. Do NOT flag SOLID violations. Write findings to the plan file under `## Phase 2b: Duplication Findings`."

After both return, confirm their outputs landed in the plan file under their respective headers, then immediately launch Phase 3.

---

## Phase 3: SOLID Analysis

Runs sequentially after Phase 2. Uses Phase 2 safety-tier output to skip SAFE files.

Invoke `subagent_type: refactor-solid-analyzer` with the following prompt:

> "Run /refactor Phase 3. Plan file: {plan-file-path}. Perform deep SOLID analysis (all 5 principles including Liskov) on surviving code. Read Phase 2a findings to identify SAFE files to skip. Read Phase 2b findings for cross-reference. Produce component inventory, priority ordering, and per-principle violations per your system prompt. Write output to the plan file under `## Phase 3: SOLID Analysis Results`."

After it returns, append its output to the plan file, then immediately launch Phase 4.

---

## Phase 4: Planning

Invoke `subagent_type: refactor-planner` with the following prompt:

> "Run /refactor Phase 4. Plan file: {plan-file-path}. Merge Phase 2a dead code, Phase 2b duplication/modernization, and Phase 3 SOLID findings into a three-tier refactoring plan with all 9 required fields per change. Apply over-engineering guard. Write output to the plan file under `## Phase 4: Refactoring Plan`."

After it returns, append its output to the plan file, then immediately launch Phase 5.

---

## Phase 5: Pre-Implementation Verification

Invoke `subagent_type: refactor-pre-verifier` with the following prompt:

> "Run /refactor Phase 5. Plan file: {plan-file-path}. Validate the Phase 4 refactoring plan for reference accuracy (spot-check 5+ file:line refs), safety, dependency ordering, completeness, and over-engineering per your system prompt. Write output to the plan file under `## Phase 5: Pre-Verifier Results`."

After it returns, append its output to the plan file, then proceed to Phase 6.

---

## Phase 6: Present Plan + Exit Plan Mode

Write the following to the plan file under `## Phase 6: Plan Presentation`, then call `ExitPlanMode`:

1. Refactorings organized by tier (1 Quick Wins / 2 Consolidation / 3 Structural) with file:line, what-changes, Pattern (for solid-violation entries), and risk
2. Estimated impact: files modified, lines removed, duplicates eliminated, SOLID violations resolved by principle
3. Skipped findings with reasons (including over-engineering rejections from the pre-verifier)
4. Any MUST FIX issues from the pre-verifier that require plan adjustment before implementation

Plan Mode handles user approval. Once approved, proceed to Phase 7.

---

## Phase 7: Implementation

After approval:

1. Run the full test suite first — establish baseline. If tests fail before refactoring, note which tests and proceed carefully.
2. For each refactoring in tier order (Tier 1 → Tier 2 → Tier 3):
   a. If the refactoring requires characterization tests: write them first, verify they pass.
   b. Make the change:
      - Edit-only changes → use the Edit tool.
      - File deletions (dead code) → use `Bash(git rm <path>)`. Do NOT use `rm` — `git rm` stages the deletion and is reversible.
   c. Run the test suite. If tests fail:
      - Revert immediately: for Edit changes use `Bash(git restore <path>)`; for `git rm` use `Bash(git restore --staged <path>)` then `Bash(git restore <path>)`.
      - Log as `REVERTED: [reason]`.
      - Continue to the next refactoring.
   d. Run the linter — fix any issues introduced.
   e. Log as `APPLIED: [description]`.
3. After all refactorings: run the full test suite one final time.
4. Track all changes for Phase 8.

<constraint>
- ONE refactoring at a time — never batch multiple changes before testing.
- REVERT immediately on test failure — do not try to "fix" the refactoring.
- Do NOT refactor surrounding code beyond the planned change.
- Preserve all existing comments unless they describe removed dead code.
- File deletion via `git rm` ONLY — never raw `rm`.
- Revert via `git restore` ONLY — never `git checkout --`.
- Glob for file enumeration, Grep for content search, Read for file contents — no shell loops, no pipes, no `$(...)`.
- Bash only for test runners, linters, type checkers, `git rm`, `git add`, `git restore`, `git diff`, `git status`, `mkdir`, `date`, `rtk`.
</constraint>

---

## Phase 8: Post-Implementation Verification

Invoke `subagent_type: refactor-post-verifier` with the following prompt:

> "Run /refactor Phase 8. Plan file: {plan-file-path}. Verify all applied refactorings against the plan via git diff. Run tests, linter, and type-checker. Re-analyze every refactored file for NEW SOLID violations introduced by the refactoring. Report SOLID compliance delta (before/after/resolved/new) per your system prompt. Write output to the plan file under `## Phase 8: Post-Verifier Results`."

After verification:
- Revert any incorrect changes immediately (`git restore` for Edits; `git restore --staged` + `git restore` for re-staged deletions).
- If new SOLID violations were introduced: revert the offending refactoring and log the reason.
- Report applied vs reverted refactorings with the SOLID compliance delta.

---

## Allowed Tools

See frontmatter `allowed-tools`. The enforced permission surface is:

- **Planning (read-only):** `Read`, `Grep`, `Glob`, `Task`, `WebFetch`, `WebSearch`, and scoped Bash for discovery (`date`, `ls:*`, `find:*`, `wc:*`, `git status`, `git log:*`, `git diff:*`, `rtk:*`).
- **Implementation:** `Edit`, `Write`, scoped deletion/stage/revert (`git rm:*`, `git add:*`, `git restore:*`), scoped test runners (`npm test`, `pnpm test`, `pnpm run test:*`, `yarn test`, `pytest:*`, `cargo test:*`, `go test:*`), scoped analysis/type-check/lint tools (`npx knip:*`, `npx depcheck:*`, `npx ts-prune:*`, `npx tsc:*`, `npx eslint:*`, `vulture:*`, `ruff:*`, `mypy:*`, `deadcode:*`, `cargo-udeps:*`).

---

## Usage

```bash
/refactor                    # Full project scan
/refactor src/utils/         # Scope to directory
/refactor src/components/    # Scope to directory (frontend reuse surfaces heavily)
/refactor src/api/routes.ts  # Scope to file
```
