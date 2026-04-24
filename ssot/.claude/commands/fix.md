---
name: fix
description: Use when fixing bugs, security vulnerabilities, performance problems, dependency issues, or dead code in a codebase. Runs a multi-scanner discovery pipeline (code-quality + dependency scanners in parallel) with Builder-Verifier pattern; produces a prioritized fix plan with per-change test strategy and revert triggers.
argument-hint: "[path-or-scope]"
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch Edit
  Bash(date) Bash(git status) Bash(git log:*) Bash(git diff:*)
  Bash(git rm:*) Bash(git add:*) Bash(git restore:*) Bash(rtk:*)
  Bash(npm audit) Bash(npm test) Bash(npm run test:*)
  Bash(pnpm test) Bash(pnpm run test:*) Bash(yarn test)
  Bash(pytest:*) Bash(cargo test:*) Bash(go test:*)
  Bash(npx tsc:*) Bash(npx eslint:*) Bash(npx knip:*)
  Bash(npx depcheck:*) Bash(npx ts-prune:*)
  Bash(ruff:*) Bash(mypy:*) Bash(mkdir:*)
---

# Universal Fixer

Fix issues in code: bugs, security vulnerabilities, performance problems, dependencies, and dead code. Thin orchestrator — all domain logic lives in the subagents below.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- Phase 6 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Pre-flight context

Environment snapshot (rendered at command-invoke time via Claude Code `!`-injection — no tool calls needed):

- Date: !`date '+%Y-%m-%d %H:%M:%S %Z'`
- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "(not a git repo)"`

Working tree (short):

```!
git status --short 2>/dev/null | head -30 || echo "(clean)"
```

Recent commits:

```!
git log --oneline -5 2>/dev/null || echo "(no commits)"
```

Before invoking the first subagent, write this rendered block to the plan file as `## Environment` so downstream phases can reference git state without re-running the shell.

## Phase 1: Exploration

Invoke `subagent_type: fix-explorer` with the following prompt:

> "Run /fix Phase 1. Plan file path: {plan-path-from-system-prompt}. $ARGUMENTS context if provided. Map the project stack, target scope, existing issues, and test/CI setup. Write your output to the plan file under `## Phase 1: Exploration Results`."

## Phase 2: Reproduction (conditional)

Skip this phase if `$ARGUMENTS` is empty or a directory path. Only run when `$ARGUMENTS` describes a specific bug or issue.

Invoke `subagent_type: fix-reproducer` with the following prompt:

> "Run /fix Phase 2. Plan file path: {plan-path-from-system-prompt}. Bug description: $ARGUMENTS. Read Phase 1 output from the plan file. Attempt to reproduce the reported bug using existing test infrastructure. Do NOT modify code. Write your output to the plan file under `## Phase 2: Reproduction Results`."

## Phase 3: Parallel Issue Discovery

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one before launching the other.
</constraint>

Parallel invocations (in one turn):
- `subagent_type: fix-code-quality-scanner` — Prompt: "Run /fix Phase 3a. Plan file path: {plan-path}. Read Phase 1 Explorer output. Scan for bugs, dead code, refactoring opportunities, and performance issues. Write findings to `## Phase 3a: Code Quality Findings`."
- `subagent_type: fix-dependency-scanner` — Prompt: "Run /fix Phase 3b. Plan file path: {plan-path}. Read Phase 1 Explorer output. Run audit tools and scan for security vulnerabilities, outdated packages, unused and missing deps. Write findings to `## Phase 3b: Dependency Findings`."

After both return, confirm outputs landed in the plan file, then immediately launch Phase 4.

## Phase 4: Planning

Invoke `subagent_type: fix-planner` with the following prompt:

> "Run /fix Phase 4. Plan file path: {plan-path-from-system-prompt}. Read Phase 3 scanner findings (3a + 3b) and Phase 2 reproduction results (if present). Propose minimal, tiered fixes with before/after code, blast-radius analysis, test strategy, and revert trigger per fix. Write output to `## Phase 4: Fix Plan`."

## Phase 5: Pre-Implementation Verification

Invoke `subagent_type: fix-pre-verifier` with the following prompt:

> "Run /fix Phase 5. Plan file path: {plan-path-from-system-prompt}. Read Phase 4 Planner output. Validate each proposed fix against the actual codebase. Spot-check 5+ file:line refs. Classify each fix as Approved / Modified / Rejected with evidence. Write output to `## Phase 5: Pre-Verification Results`."

## Phase 6: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Fix summary organized by tier (Tier 1 → 2 → 3)
2. Approved fixes with files, lines, and code changes
3. Rejected/modified fixes with reasons
4. Test strategy overview

Plan Mode handles user approval. Once approved, proceed to Phase 7.

---

## Phase 7: Implementation

After approval:

1. Apply fixes in tier order (Tier 1 first, then 2, then 3) per the approved plan.
2. After each fix, run the test strategy specified in the plan (use `npm test`, `pytest`, `cargo test`, etc.).
3. If a fix causes a test failure or regression, revert it with `git restore` and note the revert in the plan file.
4. Use `Edit` for in-place changes; `git rm` for dead-code removal (staged, reversible).
5. Track each change made for Phase 8 verification.

## Phase 8: Post-Implementation Verification

Invoke `subagent_type: fix-post-verifier` with the following prompt:

> "Run /fix Phase 8. Plan file path: {plan-path-from-system-prompt}. Read Phase 4 Planner output and Phase 5 Pre-Verifier approvals. Review git diff, verify each change, run tests/linter/type-checker, and flag any regressions for revert. Write output to `## Phase 8: Post-Verification Results`."

---

## Allowed Tools

See frontmatter. Orchestrator uses `Read`/`Write`/`Glob`/`Grep`/`Task` for phase management and `Edit`/`Bash(git *)` for implementation.

## Usage

```bash
/fix                    # Full project scan
/fix src/api/           # Scoped to directory
/fix "bug: session expires immediately after login"   # Specific bug — triggers reproducer
/fix dependencies       # Dependency-focused scan
```
