---
name: human-docs
description: Use when generating, fixing, or optimizing project documentation — README.md, CLAUDE.md, docs/**/*.md, .env.example, API references, JSDoc/TSDoc. Scans all .md files, categorizes human-readable vs AI-optimized, and produces updates through a Builder-Verifier pattern that grounds every claim in source code.
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch Edit
  Bash(date) Bash(ls:*) Bash(find:*) Bash(mkdir:*) Bash(rtk:*)
  Bash(git status) Bash(git log:*) Bash(git diff:*) Bash(git add:*)
---

# Documentation Generator

Generate, fix, and optimize human-readable and AI-optimized documentation. Thin orchestrator — all domain logic lives in the subagents below.

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

Invoke `subagent_type: human-docs-explorer` with the following prompt:

> "Run /human-docs Phase 1. Plan file path: {plan-path-from-system-prompt}. Scope: $ARGUMENTS (or full project if empty). Catalog all .md files, identify project stack, surface API routes, env vars, and existing doc conventions. Write output to the plan file under `## Phase 1: Exploration Results`."

## Phase 2: Analysis

Invoke `subagent_type: human-docs-analyzer` with the following prompt:

> "Run /human-docs Phase 2. Plan file path: {plan-path-from-system-prompt}. Read Phase 1 Explorer output. Categorize every .md file (human-readable / AI-optimized / keep-as-is), evaluate each against quality criteria, and produce a gap analysis with specific named deficiencies. Write output to `## Phase 2: Analysis Results`."

## Phase 3: Writer

Invoke `subagent_type: human-docs-writer` with the following prompt:

> "Run /human-docs Phase 3. Plan file path: {plan-path-from-system-prompt}. Read Phase 2 Analyzer gap analysis. Draft documentation for every flagged file using the correct format per category: prose + copy-paste commands for README.md, bullets/tables/file:line for CLAUDE.md and docs/, grouped var comments for .env.example. Apply AI slop scan. Write output to `## Phase 3: Writer Drafts`."

## Phase 4: Pre-Implementation Verification

Invoke `subagent_type: human-docs-pre-verifier` with the following prompt:

> "Run /human-docs Phase 4. Plan file path: {plan-path-from-system-prompt}. Read Phase 3 Writer drafts. Validate every claim against the actual codebase — spot-check 5+ file:line refs, verify API endpoints against actual route handlers, confirm env vars are used in source, scan for AI slop, check AI-optimized docs contain no prose paragraphs. Write output to `## Phase 4: Pre-Verification Results`."

<constraint>
After Phase 4 returns, write the Writer drafts and Pre-Verifier results to the plan file under `## Documentation Plan`. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Documentation changes proposed: files to create, update, or leave as-is
2. Per-file summary: category, action, key changes
3. Pre-verifier verdict: approved claims vs errors to fix before writing

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation

After approval:

1. Write/update documentation files using `Write` (new files) and `Edit` (targeted updates).
2. For each file, apply the Pre-Verifier-approved draft from the plan file — do NOT rewrite from memory.
3. Track every written file for Phase 7 verification.

## Phase 7: Post-Implementation Verification

Invoke `subagent_type: human-docs-post-verifier` with the following prompt:

> "Run /human-docs Phase 7. Plan file path: {plan-path-from-system-prompt}. Read Phase 3 Writer drafts and Phase 4 Pre-Verifier approvals. Run git diff, verify each written change against actual source code, flag API endpoints against real route handlers (not constants), confirm env vars used in code, flag contradictions for revert. Write output to `## Phase 7: Post-Verification Results`."

After verification:
- Revert any incorrect changes immediately using `Edit` or `Write` to restore prior content.
- Report what was written vs what was reverted.
- Present final summary to user.

---

## Allowed Tools

See frontmatter. Orchestrator uses `Read`/`Write`/`Glob`/`Grep`/`Task` for phase management and `Edit`/`Write`/`Bash(git *)` for implementation (post-ExitPlanMode only).

## Usage

```bash
/human-docs              # Generate/fix all documentation
/human-docs README       # Focus on README.md
/human-docs CLAUDE.md    # Focus on CLAUDE.md
/human-docs docs/        # Focus on docs/ directory
/human-docs env          # Focus on .env.example
```
