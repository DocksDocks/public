---
name: security
description: Use when running a security audit on a codebase — OWASP Top 10 coverage, logic flaws, authentication/authorization weaknesses, cryptographic misuse, race conditions, dependency vulnerabilities. Three parallel scanners (Vulnerability, Logic, Adversarial) followed by a Synthesizer that challenges every finding. Read-only; to fix issues, pipe findings into /fix.
argument-hint: "[path-or-scope]"
allowed-tools: >-
  Read Write Glob Grep Task WebFetch WebSearch
  Bash(date) Bash(git status) Bash(git log:*) Bash(rtk:*)
---

# Security Audit

Security and logic analysis across the entire codebase using parallel specialized subagents with a final synthesis pass.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is after the Phase 4 ExitPlanMode gate.

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

## Phase 1: Discovery

Invoke `subagent_type: security-explorer`. Prompt:

> Run /security Phase 1. Map the entire codebase for security-relevant areas (auth handlers, authz checks, API endpoints, DB queries, file I/O, user input, sessions, crypto, external APIs, configs, env usage). Plan file: {plan-file-path}. Scope: $ARGUMENTS (or full project if empty). Write your output to the plan file under `## Phase 1: Discovery Results`.

After the explorer returns, write its output to the plan file under that heading, then immediately launch Phase 2.

## Phase 2: Parallel Analysis

<constraint>
Launch ALL THREE agents below in a SINGLE tool-call turn.
</constraint>

Parallel invocations:
- `subagent_type: security-vulnerability-scanner`. Prompt: "Run /security Phase 2a. Plan file: {plan-file-path}. Scan for OWASP Top 10 vulnerabilities per your system prompt. Write findings to the plan file under `## Phase 2a: Vulnerability Findings`."
- `subagent_type: security-logic-analyzer`. Prompt: "Run /security Phase 2b. Plan file: {plan-file-path}. Analyze for business-logic flaws and trust-boundary violations per your system prompt. Write findings to the plan file under `## Phase 2b: Logic Findings`."
- `subagent_type: security-adversarial-hunter`. Prompt: "Run /security Phase 2c. Plan file: {plan-file-path}. Hunt for missed vulnerabilities and chained attacks per your system prompt. Write findings to the plan file under `## Phase 2c: Adversarial Findings`."

After all three return, confirm their outputs landed in the plan file, then immediately launch Phase 3.

## Phase 3: Synthesis

Invoke `subagent_type: security-synthesizer`. Prompt:

> Run /security Phase 3. Plan file: {plan-file-path}. Read Phase 2a, 2b, 2c findings; challenge, reconcile, and produce the final Security Audit Report per your system prompt. Write your report to the plan file under `## Phase 3: Security Audit Report`.

## Phase 4: Present Plan + Exit Plan Mode

Write the synthesizer's final report to the plan file as the presentation, then call `ExitPlanMode`.

Plan Mode handles user approval. This command is read-only; to fix issues, pipe findings into `/fix`.

---

## Allowed Tools

See frontmatter. Orchestrator uses read-only tools + Task for subagent invocation + Write for plan file I/O. Implementation is not part of this command — pipe findings to `/fix` for remediation.

## Usage

```bash
# Full codebase security audit
/security

# Focus on specific area (still checks entire codebase but emphasizes this area)
/security $ARGUMENTS
```
