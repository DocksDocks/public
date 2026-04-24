# Agent Extraction & Model Tiering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract every `<task>` block from the 7 commands into dedicated files under `ssot/.claude/agents/` with explicit `model:` frontmatter, then rewrite each command as thin orchestrator wiring that invokes the new subagents by `subagent_type`. Enable per-phase Opus/Sonnet tiering where scanners stay on Sonnet and synthesis/architecture/reasoning phases escalate to Opus.

**Architecture:** Create 41 specialized agent files (one per logical role × command). Remove the `CLAUDE_CODE_SUBAGENT_MODEL` env var that currently pins every subagent to Sonnet 4.6 (overriding any per-invocation or per-agent model). Add `guard-agents.sh` / `score-agents.sh` validators mirroring the existing skills/commands validators. Shrink each command file by 60–80% by moving reusable boilerplate (shell-avoidance, anti-hallucination, date-stamp) into agent bodies.

**Tech Stack:** Markdown + YAML frontmatter (agent & command files), Bash (validators + sync), `ssot/.claude/` SSOT layout, `sync.sh` for deployment to `~/.claude/`.

**Key precedent:** Claude Code resolves subagent model in this order (per [sub-agents docs](https://code.claude.com/docs/en/sub-agents#choose-a-model)): (1) `CLAUDE_CODE_SUBAGENT_MODEL` env var → (2) per-invocation model param → (3) agent frontmatter `model:` → (4) parent conversation. Step 1 currently forces everything to Sonnet. Removing it unlocks step 3.

**Scope boundaries:**
- Does NOT change effort level env var (`CLAUDE_CODE_EFFORT_LEVEL=max` stays; effort tuning is a separate future project).
- Does NOT change the kit's existing skills, plugins, hooks, or status line.
- Does NOT remove the `/docs` command's project-agent generation logic (that generates agents for *user projects*, separate from the kit's own agents).
- Does NOT touch `.claude/agents/` in user projects; only adds to `ssot/.claude/agents/` which syncs to `~/.claude/agents/` globally.

---

## Design Decisions (locked)

1. **41 specialized agents, not shared.** Every phase of every command gets its own agent file. Specialization beats parameterization for prompt clarity, auto-delegation accuracy, and `@mention` ergonomics. The user explicitly opted in to "a lot of agents, thorough and very detailed."

2. **User-level deployment via SSOT sync.** Agents live in `ssot/.claude/agents/` (kit source) and deploy to `~/.claude/agents/` via `sync.sh`. Every project the user works in gets these agents. CSO descriptions must be specific enough to prevent accidental delegation in unrelated sessions.

3. **Model tiering: 12 Opus, 29 Sonnet.** Opus for synthesis/architecture/reasoning (security synthesizer, SOLID analyzer, planners, review analyzer, test generator, writer, docs categorizer, docs role-mapper, security logic/adversarial, refactor post-verifier). Sonnet for exploration, pattern scanning, mechanical verification, content drafting from spec.

4. **Effort stays at `max` globally.** The kit's `CLAUDE_CODE_EFFORT_LEVEL=max` stays. It cascades to all subagents and overrides per-agent `effort:` frontmatter — accepted as a tradeoff for this iteration.

5. **Commands shrink by orchestrating, not instructing.** A command file's job becomes: define phase ordering, declare parallel-launch turns, specify `subagent_type` per invocation, manage plan-file I/O, enforce Plan Mode and Phase Transition Protocol. All domain content moves into agents.

6. **Plan-file-as-IPC.** The orchestrator writes each phase's output to the plan file; subsequent agents Read that plan file to access prior-phase outputs. No cross-agent message passing via giant prompts.

---

## File Structure

Files created or modified by this plan:

| Path | Action | Purpose |
|---|---|---|
| `ssot/.claude/agents/` | Create dir | Home for all 41 agent files |
| `ssot/.claude/agents/security-explorer.md` | Create | /security phase 1 |
| `ssot/.claude/agents/security-vulnerability-scanner.md` | Create | /security phase 2 parallel |
| `ssot/.claude/agents/security-logic-analyzer.md` | Create | /security phase 2 parallel (Opus) |
| `ssot/.claude/agents/security-adversarial-hunter.md` | Create | /security phase 2 parallel (Opus) |
| `ssot/.claude/agents/security-synthesizer.md` | Create | /security phase 3 (Opus) |
| `ssot/.claude/agents/fix-explorer.md` | Create | /fix phase 1 |
| `ssot/.claude/agents/fix-reproducer.md` | Create | /fix phase 2 (conditional) |
| `ssot/.claude/agents/fix-code-quality-scanner.md` | Create | /fix phase 3 parallel |
| `ssot/.claude/agents/fix-dependency-scanner.md` | Create | /fix phase 3 parallel |
| `ssot/.claude/agents/fix-planner.md` | Create | /fix phase 4 (Opus) |
| `ssot/.claude/agents/fix-pre-verifier.md` | Create | /fix phase 5 |
| `ssot/.claude/agents/fix-post-verifier.md` | Create | /fix phase 8 |
| `ssot/.claude/agents/review-explorer.md` | Create | /review phase 1 |
| `ssot/.claude/agents/review-analyzer.md` | Create | /review phase 2 (Opus) |
| `ssot/.claude/agents/review-pre-verifier.md` | Create | /review phase 3 |
| `ssot/.claude/agents/review-post-verifier.md` | Create | /review phase 6 |
| `ssot/.claude/agents/test-explorer.md` | Create | /test phase 1 |
| `ssot/.claude/agents/test-analyzer.md` | Create | /test phase 2 |
| `ssot/.claude/agents/test-generator.md` | Create | /test phase 3 (Opus) |
| `ssot/.claude/agents/test-pre-verifier.md` | Create | /test phase 4 |
| `ssot/.claude/agents/test-post-verifier.md` | Create | /test phase 7 |
| `ssot/.claude/agents/docs-explorer.md` | Create | /docs phase 1 |
| `ssot/.claude/agents/docs-categorizer.md` | Create | /docs phase 2 parallel (Opus) |
| `ssot/.claude/agents/docs-pattern-scanner.md` | Create | /docs phase 2 parallel |
| `ssot/.claude/agents/docs-skills-builder.md` | Create | /docs phase 3 |
| `ssot/.claude/agents/docs-role-mapper.md` | Create | /docs phase 4 parallel (Opus) |
| `ssot/.claude/agents/docs-pattern-extractor.md` | Create | /docs phase 4 parallel |
| `ssot/.claude/agents/docs-agents-builder.md` | Create | /docs phase 5 |
| `ssot/.claude/agents/docs-verifier.md` | Create | /docs phase 6 |
| `ssot/.claude/agents/human-docs-explorer.md` | Create | /human-docs phase 1 |
| `ssot/.claude/agents/human-docs-analyzer.md` | Create | /human-docs phase 2 |
| `ssot/.claude/agents/human-docs-writer.md` | Create | /human-docs phase 3 (Opus) |
| `ssot/.claude/agents/human-docs-pre-verifier.md` | Create | /human-docs phase 4 |
| `ssot/.claude/agents/human-docs-post-verifier.md` | Create | /human-docs phase 7 |
| `ssot/.claude/agents/refactor-explorer.md` | Create | /refactor phase 1 |
| `ssot/.claude/agents/refactor-dead-code-scanner.md` | Create | /refactor phase 2 parallel |
| `ssot/.claude/agents/refactor-duplication-scanner.md` | Create | /refactor phase 2 parallel |
| `ssot/.claude/agents/refactor-solid-analyzer.md` | Create | /refactor phase 3 (Opus) |
| `ssot/.claude/agents/refactor-planner.md` | Create | /refactor phase 4 (Opus) |
| `ssot/.claude/agents/refactor-pre-verifier.md` | Create | /refactor phase 5 |
| `ssot/.claude/agents/refactor-post-verifier.md` | Create | /refactor phase 8 (Opus) |
| `guard-agents.sh` | Create | Structural validator for agent files |
| `score-agents.sh` | Create | Quality validator for agent files |
| `ssot/.claude/commands/security.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/fix.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/review.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/test.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/docs.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/human-docs.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/commands/refactor.md` | Rewrite | Thin orchestrator referencing subagents |
| `ssot/.claude/settings.json` | Modify | Remove `CLAUDE_CODE_SUBAGENT_MODEL` env var |
| `ssot/.claude/CLAUDE.md` | Modify | Document `.claude/agents/` + model tiering rationale |
| `CLAUDE.md` (project root) | Modify | Add `## Agents` section; update command table to note per-phase tiering |

---

## Agent Roster

Models: **O** = opus, **S** = sonnet. Tools: **R** = read-only (`Read Grep Glob Bash`), **R+** = read-only + research (`Read Grep Glob Bash WebFetch WebSearch`).

| # | Agent | Cmd | Phase | Model | Archetype | Tools |
|---|---|---|---|---|---|---|
| 1 | `security-explorer` | /security | 1 | S | Explorer | R |
| 2 | `security-vulnerability-scanner` | /security | 2a | S | Scanner | R+ |
| 3 | `security-logic-analyzer` | /security | 2b | **O** | Analyzer | R+ |
| 4 | `security-adversarial-hunter` | /security | 2c | **O** | Analyzer (creative) | R+ |
| 5 | `security-synthesizer` | /security | 3 | **O** | Synthesizer | R+ |
| 6 | `fix-explorer` | /fix | 1 | S | Explorer | R |
| 7 | `fix-reproducer` | /fix | 2 | S | Reproducer | R+ |
| 8 | `fix-code-quality-scanner` | /fix | 3a | S | Scanner | R+ |
| 9 | `fix-dependency-scanner` | /fix | 3b | S | Scanner | R+ |
| 10 | `fix-planner` | /fix | 4 | **O** | Planner | R+ |
| 11 | `fix-pre-verifier` | /fix | 5 | S | Verifier | R |
| 12 | `fix-post-verifier` | /fix | 8 | S | Verifier | R |
| 13 | `review-explorer` | /review | 1 | S | Explorer | R |
| 14 | `review-analyzer` | /review | 2 | **O** | Analyzer | R+ |
| 15 | `review-pre-verifier` | /review | 3 | S | Verifier | R |
| 16 | `review-post-verifier` | /review | 6 | S | Verifier | R |
| 17 | `test-explorer` | /test | 1 | S | Explorer | R |
| 18 | `test-analyzer` | /test | 2 | S | Analyzer | R |
| 19 | `test-generator` | /test | 3 | **O** | Generator | R+ |
| 20 | `test-pre-verifier` | /test | 4 | S | Verifier | R |
| 21 | `test-post-verifier` | /test | 7 | S | Verifier | R |
| 22 | `docs-explorer` | /docs | 1 | S | Explorer | R |
| 23 | `docs-categorizer` | /docs | 2a | **O** | Analyzer | R |
| 24 | `docs-pattern-scanner` | /docs | 2b | S | Scanner | R |
| 25 | `docs-skills-builder` | /docs | 3 | S | Builder | R+ |
| 26 | `docs-role-mapper` | /docs | 4a | **O** | Analyzer | R |
| 27 | `docs-pattern-extractor` | /docs | 4b | S | Scanner | R |
| 28 | `docs-agents-builder` | /docs | 5 | S | Builder | R+ |
| 29 | `docs-verifier` | /docs | 6 | S | Verifier | R |
| 30 | `human-docs-explorer` | /human-docs | 1 | S | Explorer | R |
| 31 | `human-docs-analyzer` | /human-docs | 2 | S | Analyzer | R |
| 32 | `human-docs-writer` | /human-docs | 3 | **O** | Writer | R+ |
| 33 | `human-docs-pre-verifier` | /human-docs | 4 | S | Verifier | R |
| 34 | `human-docs-post-verifier` | /human-docs | 7 | S | Verifier | R |
| 35 | `refactor-explorer` | /refactor | 1 | S | Explorer | R |
| 36 | `refactor-dead-code-scanner` | /refactor | 2a | S | Scanner | R+ |
| 37 | `refactor-duplication-scanner` | /refactor | 2b | S | Scanner | R |
| 38 | `refactor-solid-analyzer` | /refactor | 3 | **O** | Analyzer | R+ |
| 39 | `refactor-planner` | /refactor | 4 | **O** | Planner | R+ |
| 40 | `refactor-pre-verifier` | /refactor | 5 | S | Verifier | R |
| 41 | `refactor-post-verifier` | /refactor | 8 | **O** | Analyzer | R+ |

**Totals:** 12 Opus (29%), 29 Sonnet (71%). Matches Anthropic's orchestrator-worker ratio.

---

## Archetype Reference

Every agent file follows the same frontmatter + body template. Per-agent deltas override specific sections.

### Frontmatter Template

```yaml
---
name: <agent-name-kebab-case>
description: Use when running <command> command phase <N> — <one-line purpose>. <when-not-to-use clause>.
tools: <tool list from "Tools" column in roster>
model: <sonnet|opus>
---
```

**Description pattern (CSO-compliant):**
- MUST start with "Use when…"
- MUST name the parent command and phase
- MUST include a "Not for…" clause to prevent accidental delegation in unrelated sessions
- Max 1024 chars, 3rd person

**Good example:** `Use when running /security command phase 3 — challenges, reconciles, and prioritizes findings from parallel vulnerability scanner, logic analyzer, and adversarial hunter. Not for ad-hoc security questions or general code review.`

**Bad example:** `Security synthesizer that reviews findings.` (no command binding, no trigger condition, no exclusion)

### Tool Sets (by column in roster)

| Column | Expansion |
|---|---|
| **R** | `Read, Grep, Glob, Bash` |
| **R+** | `Read, Grep, Glob, Bash, WebFetch, WebSearch` |

Agents NEVER get `Edit` or `Write` — implementation is orchestrator-only (post-ExitPlanMode). This is a hard rule: agents produce text output that the orchestrator persists.

### Body Template

```markdown
# <Agent Title — Human Readable>

<one-sentence role summary>

<constraint>
<shell-avoidance-block — standard text, see §Shared Constraints>
</constraint>

<constraint>
<research-gate-block — if R+ and agent suggests library APIs — see §Shared Constraints>
</constraint>

## Workflow

<numbered steps tailored to this agent>

## Output Format

<structured output headers + fields the agent produces>

## Anti-Hallucination Checks (mandatory)

<anti-hallucination-block — standard text, see §Shared Constraints>

## Success Criteria

<concrete measurable criteria — 2-4 bullets>
```

### Shared Constraints (verbatim blocks — copy into every agent that needs them)

**Shell-avoidance block** (every agent, inside the first `<constraint>`):

```
Shell-avoidance:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l`.
- No shell loops (`for`/`while`), no `$(...)` command substitution, no pipes.
- Bash is limited to commands in the agent's `tools` allowlist (typically `date`, `git` status/log/diff, `rtk`, and analysis tools where applicable).
```

**Research-gate block** (only R+ agents that will suggest library/framework APIs):

```
Before proposing code that uses a library, framework, or external API:
1. Use `resolve-library-id` → `query-docs` (context7) to fetch current docs.
2. Use `WebFetch` on the official documentation to cross-reference.
Do BOTH. Do NOT assume API signatures, method names, or config options from training data. Hallucinated APIs in analyzer/planner output propagate through the downstream fix/implementation phases.
```

**Anti-hallucination block** (every agent, under `## Anti-Hallucination Checks`):

```
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob).
3. Check function signatures match actual code (read the source).
4. Validate all file paths in output exist (use Glob).
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, Cargo.lock, go.sum, etc.).
6. If generated code is present, verify syntax with project toolchain (`tsc --noEmit`, `python -m py_compile`, equivalent).
```

**Context acknowledgment block** (every agent, as first step of `## Workflow`):

```
1. Run `date "+%Y-%m-%d"` via Bash to confirm current date. Use this for any date references in your output.
2. If the orchestrator's invocation prompt references a plan file path, Read that plan file to load prior-phase outputs.
3. If `.claude/skills/` exists in the project, Read relevant skills for project-specific conventions.
```

### Archetype Bodies (reusable workflow + output patterns per archetype)

Each agent's body is constructed as:

1. Intro header (one line)
2. Shared constraints (shell-avoidance always; research-gate if R+ and agent proposes APIs)
3. Archetype-specific workflow (see below)
4. Agent-specific overrides (domain-specific categories to scan, specific output headers, etc. — specified per-agent in Tasks 2–8)
5. Anti-hallucination checks (shared block)
6. Success criteria (agent-specific — specified per-agent)

**Explorer Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Identify the project stack: languages, frameworks, package managers (check `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pyproject.toml`).
3. Map directory structure: use Glob to enumerate source directories, count files per directory in-agent.
4. Identify target scope: if the orchestrator passes `$ARGUMENTS`, focus on that path; otherwise map the whole project.
5. <agent-specific exploration items — see per-agent spec>
6. Output the Project Profile, File Map, and agent-specific findings.

## Output Format

## Project Profile
- Stack: [languages, frameworks]
- Package manager: [npm/pnpm/yarn/pip/cargo/go]
- Scope: [files/dirs or "full project"]
- Tests: [test runner command if detected]
- Linter: [linter command if detected]

## File Map
[directory structure with file counts, focused on source dirs]

<agent-specific output sections — see per-agent spec>
```

**Scanner Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read Phase 1 Explorer output from the plan file — get scope, stack, tooling.
3. <agent-specific tool-augmented scan — see per-agent spec>
4. <agent-specific manual scan categories — see per-agent spec>
5. Classify each finding by safety/severity tier.
6. For every finding, produce: `file:line` reference, category, severity/tier, concrete evidence, suggested fix.

## Output Format

## Tool Results
[raw tool output summary, if tools were available]

## Findings
For each finding:
- `file:line` — exact location
- Category: <category from agent-specific list>
- Severity / Tier: <level>
- Evidence: <why — with specific code or grep result>
- Suggested fix: <minimal, targeted>

## Summary
[counts by category and severity]
```

**Analyzer Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read all prior-phase outputs from the plan file (Explorer + any Phase 2 scanners that ran before this analyzer).
3. <agent-specific multi-category evaluation — see per-agent spec>
4. For each finding, produce `file:line`, category/principle, concrete evidence (quote offending code if short), impact, suggested fix/pattern.
5. Group related findings; prioritize by exploitability × impact.

## Output Format

## <Primary Finding Bucket>
For each finding:
- `file:line`
- Category / Principle: <agent-specific>
- Evidence: <concrete, not theoretical>
- Impact: <concrete consequence>
- Suggested fix / pattern: <agent-specific>
- Risk tier: low | medium | high

## Summary
[counts by category]
```

**Synthesizer Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read all Phase 2 agent outputs from the plan file.
3. <agent-specific challenge pass — see per-agent spec>
4. Correctness pass: Read the file at each stated line; REJECT findings where code doesn't exist or doesn't match.
5. Completeness pass: check the agent-specific coverage matrix; flag gaps.
6. Priority pass: for each Critical/High finding, verify exploitability/impact given mitigations in the codebase; downgrade if over-severed.
7. Consolidate: accept survivors, reject false positives with reasoning, adjust severity, group related.
8. Output the final report.

## Output Format

# <Agent-specific Report Title>

## Executive Summary
- Total items: X
- <severity breakdown>
- Most affected areas: [list]
- Immediate action required: yes/no

## <Severity Tier 1 — e.g., Critical Vulnerabilities>
[full detail per item with file:line, description, exploitation/trigger, remediation with code example, references]

## <Severity Tier 2, 3, 4 — agent-specific>

## Recommendations
1. Immediate fixes
2. Short-term improvements
3. Long-term hardening

## Files Requiring Review
[list with issue counts]
```

**Planner Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read all prior-phase outputs from the plan file (scanners + analyzer).
3. For each finding, propose a specific, minimal fix:
   - Identify root cause
   - Write exact before/after code (full context, not fragments)
   - Identify test strategy (which existing test to run, or new characterization test to add)
   - Identify revert trigger (what failure means we undo this)
   - Identify blast radius (who uses this function/class — grep for references)
4. Order the fixes by tier (see agent-specific tier definitions) and dependency.
5. Mark fixes that exceed their issue scope as Skipped with reasoning.

## Output Format

## Proposed Changes

### Tier 1: <agent-specific tier name — e.g., Quick Wins>
[numbered list; each entry has all 9 fields below]

### Tier 2, 3: <as needed>

**Per-fix fields (required for every entry):**
| Field | Content |
|---|---|
| Priority tier | 1/2/3 |
| Category | <agent-specific> |
| Files affected | file:line list |
| What changes | before → after description |
| Code (before) | actual code from the file |
| Code (after) | exact replacement |
| Risk | low / medium / high |
| Test strategy | which test to run |
| Revert trigger | which failure means undo |
| Dependencies | which other fixes must land first |

## Estimated Impact
- Files modified: N
- Lines removed: N
- <agent-specific metrics>

## Skipped Findings
[finding → reason for skipping]
```

**Generator Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read Explorer and Analyzer outputs from the plan file.
3. Structure pass: write all describe/it blocks (or equivalent framework structure), imports, and mock setup first. Verify every import path against real project files before continuing.
4. Implementation pass: fill in setup/act/assert (or equivalent) for each test case.
5. Do NOT write assertions before verifying function signatures match actual code.

## Output Format

[complete test code per file, with agent-specific language/framework conventions]

Per test, include:
1. Descriptive test name (project conventions)
2. Setup / arrange
3. Action / act
4. Assertions / assert (concrete, not `toBeDefined`)
5. Cleanup if needed

**Edge cases to always cover:**
- Null/undefined inputs, empty arrays/objects
- Boundary values (0, -1, MAX_INT)
- Invalid types, async errors/timeouts
- Concurrent operations where applicable
```

**Writer Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read Analyzer's gap analysis and categorization from the plan file.
3. For each target file, draft the new content:
   - **Human-readable targets** (README.md, CONTRIBUTING.md): may use prose, MUST have copy-paste-ready commands
   - **AI-optimized targets** (CLAUDE.md, docs/**): bullets/tables ONLY, no prose paragraphs, every claim has a `file:line` reference
4. AI slop scan (remove every occurrence):
   - Filler: "It's important to note…", "cutting-edge"
   - Inflated adjectives: "powerful", "world-class", "state-of-the-art"
   - Hedging: "might", "could possibly", "should probably"
   - Empty claims: "easy to use", "simple to understand"
5. Structure check: AI-optimized docs must use tables for comparisons, bullets for sequences, code blocks for patterns — never prose.

## Output Format

[drafted content per target file, clearly delimited]
```

**Builder Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read the Categorizer/Role-Mapper spec from the plan file for each deliverable to draft.
3. For each deliverable, assemble the full file content per the archetype-specific format (e.g., SKILL.md frontmatter + body; agent file frontmatter + body).
4. Apply AI-optimization rules:
   - Critical constraints at START, gotchas at END (U-shaped attention).
   - Tables for comparisons, bullets for sequences — no prose paragraphs.
   - Every claim has a `file:line` reference.
   - `<constraint>` XML tags for non-negotiable rules.
5. Do NOT invent library APIs — apply research-gate block if applicable.

## Output Format

[drafted file content per deliverable, clearly delimited with file path headers]
```

**Verifier Archetype workflow:**

```
## Workflow

1. <Context acknowledgment block>
2. Read the prior phase's output (Planner / Builder / Analyzer) from the plan file.
3. Spot-check 5+ `file:line` references using Read + Glob — does code at the stated line actually exist?
4. For each claim, verify:
   - Does the file exist?
   - Does the referenced code exist at that line?
   - Do import paths resolve?
   - Do function signatures match?
5. <agent-specific verification — e.g., pre-impl: verify plan; post-impl: verify git diff + run tests>
6. Classify findings: Verified / Rejected (with evidence) / Severity-Adjusted (with reasoning) / Unable to Verify.

## Output Format

## Verified
[items confirmed correct]

## Rejected (False Positives)
[items disproven, with evidence from actual code]

## Severity Adjustments
[items where severity should change, with reasoning]

## Unable to Verify
[items requiring manual verification, with reason]

## Summary
- Total reported: X
- Verified: Y
- Rejected: Z
- Adjusted: W
```

---

## Agent-Specific Specs

For each of the 41 agents, the following table specifies the fields that override the archetype defaults. When constructing each agent file, copy the archetype body and substitute these deltas.

### /security agents

**`security-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /security command phase 1 — maps codebase attack surface, security-critical areas, and entry points for the downstream scanners. Not for general codebase exploration.`
- Agent-specific exploration items:
  - Auth/login handlers, authz/permission checks
  - API endpoints, WebSocket handlers, CLI arg parsing
  - DB queries, ORM usage, raw SQL
  - File upload/download, user input processing
  - Session management, cryptographic operations
  - External API integrations, config files with secrets, env var usage
- Agent-specific output: `## Security-Critical Areas` (categorized file list), `## Entry Points` (all data ingress paths), `## Trust Boundaries` (client/server/service splits).
- Success criteria: All entry points identified with file paths. Project stack fully mapped. Zero missed authentication/authorization code paths.

**`security-vulnerability-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R+
- Description: `Use when running /security command phase 2 — scans codebase for exploitable OWASP Top 10 vulnerabilities and cryptographic misuse with file:line evidence. Not for general code review or dependency audits.`
- Agent-specific scan categories:
  - Injection: SQL, NoSQL, command, XSS, LDAP, XML/XXE, path traversal
  - Auth flaws: weak password storage, missing brute-force protection, JWT `none`, weak secrets, OAuth/OIDC misconfig
  - Authz flaws: missing permission checks, IDOR, privilege escalation, horizontal access failures
  - Data exposure: secrets in code, sensitive data in logs, verbose errors, missing TLS, hardcoded keys
  - Security misconfig: debug in prod, default creds, missing headers, CORS, cookie flags
  - Crypto: weak algos (MD5/SHA1/DES/RC4), hardcoded IVs, insufficient key lengths, missing salt, predictable RNG
  - Dep vulns: include `npm audit` / `pip audit` output
- Agent-specific output: add `CWE: CWE-XXX` to each finding; attach PoC/attack scenario.
- Apply research-gate block (suggests remediation libraries).
- Success criteria: Every finding has `file:line` + CWE + PoC. Zero theoretical-only findings.

**`security-logic-analyzer`** — Archetype: Analyzer, Model: **opus**, Tools: R+
- Description: `Use when running /security command phase 2 — analyzes codebase for business-logic flaws, trust-boundary violations, race conditions, and edge cases that systematic vulnerability scans miss. Not for ad-hoc bug-hunting.`
- Agent-specific evaluation categories:
  - Business logic flaws: price/quantity manipulation, race conditions in transactions, order-of-operations, state-machine violations, workflow bypass
  - Input validation: missing on critical inputs, cross-layer inconsistency, type confusion, integer over/underflow, buffer bounds
  - Error handling: info-leaking exceptions, error paths that skip security checks, fail-open vs fail-closed, missing null/undefined checks
  - Concurrency: races in shared state, TOCTOU, deadlocks, missing locks, async/await pitfalls
  - Edge cases: empty input, MAX/MIN boundaries, unicode/encoding, timezone/date, floating-point precision
  - Trust boundaries: client-side trust, inter-service assumptions, third-party data validation
- Agent-specific output: for each finding, include trigger scenario + attack flow.
- Success criteria: Every finding has `file:line` + trigger scenario. Logic flaws verified by reading surrounding context.

**`security-adversarial-hunter`** — Archetype: Analyzer (creative variant), Model: **opus**, Tools: R+
- Description: `Use when running /security command phase 2 — hunts for vulnerabilities missed by systematic scanning by thinking like an attacker, including chained low-severity issues that combine into high-severity. Not for routine scanning.`
- Agent-specific evaluation categories:
  - Auth bypass: alternative paths to authenticated resources
  - Hidden endpoints: debug routes, admin panels, API docs, backup files
  - Chained attacks: low-severity issues that combine
  - Timing attacks: response-time leakage
  - Cache poisoning: cache-key manipulation
  - Deserialization: unsafe object deserialization
  - SSRF: server-side request forgery opportunities
  - Mass assignment: unprotected property assignment
  - Prototype pollution: JS prototype-chain attacks
  - Subdomain takeover: dangling DNS/cloud resources
- Agent-specific output: `## Top 5 Attack Scenarios` with per-scenario prerequisites, step-by-step exploitation, expected impact, detection difficulty. Minimum 2 chained-attack scenarios.
- Success criteria: Top 5 scenarios have step-by-step exploitation paths with file:line refs. ≥2 chained-attack scenarios identified.

**`security-synthesizer`** — Archetype: Synthesizer, Model: **opus**, Tools: R+
- Description: `Use when running /security command phase 3 — challenges, reconciles, and prioritizes findings from the three parallel phase-2 security agents, producing the final security report. Not for ad-hoc security questions.`
- Agent-specific challenge pass: Challenge every finding — is it actually exploitable here? Are mitigations in place? Is severity inflated? Could the suggested fix introduce new issues? Reject anything without concrete file:line evidence.
- Agent-specific completeness pass: check OWASP Top 10 coverage — mark each category "reviewed — clean" or "not examined." Flag gaps.
- Apply research-gate block (security libraries: helmet, cors, bcrypt, csrf, etc.).
- Output uses Security Audit Report structure from the archetype with severity tiers: Critical / High / Medium / Low/Informational / Logic Flaws.
- Success criteria: All findings cross-referenced against actual code. False-positive rate documented. OWASP Top 10 coverage status included.

### /fix agents

**`fix-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /fix command phase 1 — maps project stack, target scope from $ARGUMENTS, existing issues (failing tests, linter errors), and test/CI setup for the downstream scanners and planner. Not for general codebase exploration.`
- Agent-specific items: Check for existing issues (failing tests, linter errors, security advisories). Identify test coverage and CI/CD setup. Identify the target scope (use $ARGUMENTS).
- Success criteria: Identified project stack, target scope, existing patterns, test/CI config with file paths.

**`fix-reproducer`** — Archetype: Reproducer (specialization of Scanner, runs tests to confirm bug), Model: sonnet, Tools: R+
- Description: `Use when running /fix command phase 2 — confirms a reported bug exists by reproducing it with existing test infrastructure, before planning a fix. Only runs when $ARGUMENTS describes a specific bug; skipped for directory-scoped invocations.`
- Agent-specific workflow override: Run existing tests against the reported scenario; capture error output. Try to produce minimal reproduction. Do NOT modify code during reproduction.
- Output: Status (REPRODUCED / NOT REPRODUCED / UNABLE TO TEST), steps taken, error output, minimal repro if possible.
- Success criteria: Issue confirmed with concrete evidence (error output, failing test) OR confirmed not reproducible with attempts documented.

**`fix-code-quality-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R+
- Description: `Use when running /fix command phase 3 — scans target code for bugs, dead code, refactoring opportunities, and obvious performance issues. Not for architectural refactoring (use /refactor instead).`
- Agent-specific scan categories:
  - Bugs: logic errors, off-by-one, null/undefined, race conditions, type coercion, unhandled rejections
  - Dead code: unused exports, unreachable code, commented-out blocks, deprecated
  - Refactoring: duplicated code, complex long functions, outdated patterns, type improvements (any → specific)
  - Performance: N+1 queries, memory leaks, unnecessary re-renders
- Success criteria: Every finding includes `file:line` and concrete evidence. Prioritized by severity.

**`fix-dependency-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R+
- Description: `Use when running /fix command phase 3 — scans project dependencies for security vulnerabilities, outdated packages, unused dependencies, and missing peer deps. Not for writing new dependency code.`
- Agent-specific tool-augmented scan: `npm audit` / `pip audit` / equivalent. Check for CVEs, transitive risks, outdated majors, deprecated packages.
- Agent-specific manual scan: cross-reference package.json vs. actual imports to find unused; check peer-dep warnings; find duplicates.
- Output each finding with package name, current version, recommended action.
- Success criteria: Every dep issue has package name, current version, recommended action. Audit tool output included.

**`fix-planner`** — Archetype: Planner, Model: **opus**, Tools: R+
- Description: `Use when running /fix command phase 4 — proposes specific, minimal fixes for each scanner-identified issue with blast-radius analysis, test strategy, and revert trigger per fix. Not for architectural refactoring.`
- Agent-specific tier definitions:
  - Tier 1 — Safe, isolated fixes (single file, no callers, reversible)
  - Tier 2 — Medium-risk fixes (shared utility, several callers)
  - Tier 3 — Higher-risk (cross-module, entry-point changes)
- Apply research-gate block (framework/library APIs in proposed fixes).
- Success criteria: Every fix has `file:line`, before/after code, test approach, revert trigger. No fix exceeds its issue scope.

**`fix-pre-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /fix command phase 5 — validates each planner-proposed fix against the actual codebase before implementation, checking correctness, blast radius, and syntactic validity. Not for post-implementation verification.`
- Agent-specific verification: For each proposed fix, Read the file at the reported location, verify the issue exists, read surrounding code for blast radius, grep for usages of the changed function/class, assess risk-tier accuracy, check syntactic correctness of the proposed change.
- Output: Approved Fixes / Modified Fixes (with required adjustments) / Rejected Fixes (with evidence) / Risk Assessment (counts by tier).
- Success criteria: Spot-checked 5+ `file:line` refs. Zero unverified fixes in approved list.

**`fix-post-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R (plus test-runner via Bash)
- Description: `Use when running /fix command phase 8 — verifies all implemented changes via git diff, runs tests/linter/type-checker, and flags regressions for revert. Not for pre-implementation planning.`
- Agent-specific verification: Run `git diff`, for EACH change verify against source — does the fix solve the problem? Any broken functionality? Run tests / linter / type-checks. Cross-reference fixes with original issue.
- Output: Verified Correct / ERRORS FOUND - Must Revert / Tests Status / Needs Manual Verification.
- Success criteria: Every change verified. Test suite passes. Zero unverified modifications.

### /review agents

**`review-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /review command phase 1 — maps project stack, target scope for review, and existing conventions/lint configs before the analyzer pass. Not for general code review.`
- Agent-specific items: Identify linting/testing configs. Understand existing patterns, conventions, architecture.
- Success criteria: Project stack, target scope, existing patterns/conventions identified with file paths.

**`review-analyzer`** — Archetype: Analyzer, Model: **opus**, Tools: R+
- Description: `Use when running /review command phase 2 — identifies bugs, security issues, performance problems, and maintainability issues in target code with file:line evidence and severity. This is the primary value-producing phase of /review. Not for automated fix generation.`
- Agent-specific evaluation categories:
  - Code Quality: SOLID violations, code smells, error handling gaps, type safety, naming
  - Security (OWASP Top 10): injection, broken auth, data exposure, misconfig, insecure deps
  - Performance: N+1 queries, memory leaks, blocking async, missing caching, bad algos
  - AI Slop: verbose code, unnecessary abstractions, obvious comments, over-engineering
- Apply research-gate block.
- Success criteria: Every finding has `file:line` + severity (critical/high/medium/low). Zero severity-less items.

**`review-pre-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /review command phase 3 — validates the analyzer's findings against the actual codebase before presenting to the user. Not for post-implementation verification.`
- Agent-specific verification: For each reported issue, Read file at reported location, confirm issue is real, verify severity is accurate given context, verify suggested fix is correct and safe. Spot-check 5+ refs.
- Output: Verified Issues / Rejected Issues (with evidence) / Severity Adjustments.
- Success criteria: Spot-checked 5+ refs. Zero unverified findings in final output.

**`review-post-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R (plus test-runner)
- Description: `Use when running /review command phase 6 — verifies all implementation changes against the codebase after fixes are applied, flagging incorrect edits for revert. Not for pre-implementation planning.`
- Agent-specific verification: Run `git diff`, for each change verify it matches what code actually does/needs. Cross-reference against route definitions, function signatures, existing tests, related files. For doc changes, verify URLs/paths against actual code.
- Output: Verified Correct / ERRORS FOUND - Must Revert / Needs Manual Verification.
- Success criteria: Every change verified against actual source code. Zero unverified modifications.

### /test agents

**`test-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /test command phase 1 — identifies the project's test framework, existing test patterns, mocking strategies, and target code to test before analysis. Not for general exploration.`
- Agent-specific items: Identify test framework (Jest, Vitest, Pytest, Go test, etc.), test config files, existing test patterns, mocking strategies, target code (use $ARGUMENTS), coverage config.
- Success criteria: Test framework, patterns, target scope identified with file paths.

**`test-analyzer`** — Archetype: Analyzer (structured variant), Model: sonnet, Tools: R
- Description: `Use when running /test command phase 2 — analyzes target code to enumerate functions, dependencies, side effects, edge cases, happy paths, and integration points for test generation. Not for writing tests directly.`
- Agent-specific evaluation:
  - Functions/methods: list all with signatures
  - Dependencies: external services, DBs, libraries
  - Side effects: state mutations, API calls, file writes
  - Edge cases: boundary conditions, error scenarios, null cases
  - Happy paths: main success scenarios
  - Integration points: cross-module interactions
- Success criteria: All public functions listed with signatures. Edge cases per function. Dependencies mapped for mocking.

**`test-generator`** — Archetype: Generator, Model: **opus**, Tools: R+
- Description: `Use when running /test command phase 3 — generates tests covering all analyzer-identified functions, edge cases, and integration points following project conventions. Not for verifying or running tests (use test-post-verifier).`
- Apply research-gate block (test framework APIs).
- Agent-specific test categories:
  - Unit: each function in isolation, mocked deps, happy + error paths, boundaries
  - Integration: module interactions, real deps where safe, data flow verification
- Success criteria: All imports match real project paths. All function signatures in tests match real code. Every test has meaningful assertions (not just mock verification).

**`test-pre-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /test command phase 4 — validates generated tests for import correctness, signature matching, realistic mocks, and false-positive detection before implementation. Not for post-implementation verification.`
- Agent-specific verification: For each test, verify import paths match real project, function signatures match actual code, mock return values are realistic, test actually tests behavior (not just mocks), describe/test names follow project convention, test would fail if code is broken (not a false positive).
- Output: Tests Verified / Tests With Issues (with fix needed) / Coverage Assessment.
- Success criteria: Spot-checked 5+ refs. All imports verified. Zero false-positive tests in approved list.

**`test-post-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R (plus test-runner via Bash)
- Description: `Use when running /test command phase 7 — verifies generated tests actually pass, test the claimed behavior, have correct mocks, and catch false positives by running the test suite. Not for pre-implementation planning.`
- Agent-specific verification: Run full test suite, capture results. For each test verify it tests its claimed behavior, mocks match reality, assertions are right, would fail on broken code. Check for always-passing tests, mock-only tests, bad async handling, missing cleanup.
- Output: Tests Verified Correct / ERRORS FOUND - Must Fix / Test Results (pass/fail/coverage) / Recommendations.
- Success criteria: All tests pass. Every test verified against real behavior. Zero false-positive tests.

### /docs agents

**`docs-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /docs command phase 1 — maps project profile, existing .claude/skills/ and .claude/agents/, and knowledge areas to feed the skills and agents pipelines. Not for general exploration.`
- Agent-specific items: For every existing skill (Glob `.claude/skills/*/SKILL.md`) parse YAML frontmatter (`name`, `description`, `metadata.source_files`, `metadata.updated`), list references/. For every existing agent (Glob `.claude/agents/*.md` excl. `*.bak`) extract frontmatter and skill paths referenced. Identify knowledge areas (candidate skill domains).
- Agent-specific output: `## Project Profile`, `## Existing Skills` (per-skill summary), `## Existing Agents` (per-agent summary), `## Knowledge Areas Identified`.
- Success criteria: Project stack identified. Every existing skill and agent enumerated with frontmatter parsed. Knowledge areas with source locations.

**`docs-categorizer`** — Archetype: Analyzer, Model: **opus**, Tools: R
- Description: `Use when running /docs command phase 2 — proposes the complete skill set (new, update, split, merge, refresh, rewrite-description) with CSO-compliant descriptions using project-specific keywords. Not for writing skill content (that's docs-skills-builder).`
- Agent-specific evaluation (per existing skill): size check (>500 → split, <50 lines → merge), staleness (`git log --since=metadata.updated`), coverage (source dirs not referenced), CSO compliance (≥5 project-specific identifiers), deleted source paths.
- Agent-specific new-skill design: propose from standard domains (architecture-context, conventions-context, api-context, testing-context, dependencies-context, deployment-context, data-context). Each proposal includes name, description (starting "Use when…" with ≥5 project keywords), body plan, references plan, source_files list.
- Maintenance skill rule: if `skill-maintenance` missing, propose creation.
- Success criteria: Every existing skill audited against all 5 checks. Every uncovered knowledge area has a new-skill proposal OR explicit "too small" decision. All descriptions CSO-compliant.

**`docs-pattern-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R
- Description: `Use when running /docs command phase 2 — extracts concrete patterns, conventions, and decisions from the codebase with file:line references, grouped by skill domain. Not for general code analysis.`
- Agent-specific scan categories: Architecture patterns (entry points, request lifecycle, module boundaries via import graph, state management, error propagation). Code conventions (naming, imports, error handling, logging). API contracts (routes, auth chains, request/response shapes). Testing patterns (file naming, mocking, fixtures, coverage). Gotchas (non-obvious dependencies, legacy patterns).
- Success criteria: Every finding has `file:line`. All 5 extraction categories covered. Gotchas include concrete failure scenarios.

**`docs-skills-builder`** — Archetype: Builder, Model: sonnet, Tools: R+
- Description: `Use when running /docs command phase 3 — drafts complete SKILL.md bodies and references/ files for every skill delta (create/update/split/merge/refresh/rewrite-description). Not for categorizing skills (that's docs-categorizer).`
- Apply research-gate block (skills document library APIs).
- Agent-specific format rules: SKILL.md < 500 lines, references/ files 30-150 lines. AI-optimization rules (position priority, tables for comparisons, every claim has `file:line`, positive framing, code blocks, no AI slop, `<constraint>` tags, failure scenarios in gotchas, `| Good | Bad | Why |` tables, markdown only).
- Output: drafted content per file, clearly delimited.
- Success criteria: All SKILL.md files ≤500 lines, references/ 30-150 lines, descriptions CSO-compliant with ≥5 keywords, claims have `file:line` refs.

**`docs-role-mapper`** — Archetype: Analyzer, Model: **opus**, Tools: R
- Description: `Use when running /docs command phase 4 — maps the proposed skill set to agent roles with clear boundaries, triggers, and tool sets; audits existing agents against new skill paths. Not for writing agent bodies (that's docs-agents-builder).`
- Agent-specific evaluation: for each proposed skill with ≥3 distinct claims, decide name (kebab-case), description (3rd person, CSO-compliant, max 1024 chars), tools (minimal), model (default opus for all project agents), domain (which skills + references/ files), scope boundaries (what the agent should NOT do).
- Existing agents: if skill references point to moved paths, propose fix or regeneration. If inline content, propose rewrite-to-reference.
- Success criteria: Single responsibility per agent. Specific trigger conditions. Skill references point to Phase 3 proposed paths.

**`docs-pattern-extractor`** — Archetype: Scanner, Model: sonnet, Tools: R
- Description: `Use when running /docs command phase 4 — extracts concrete patterns, workflows, and constraints for each agent role's system prompt without inlining skill content. Not for writing the full agent file (that's docs-agents-builder).`
- Agent-specific extraction per agent role: critical constraints (as `<constraint>` blocks), workflow steps (numbered), key file paths, patterns with code (with `file:line`), gotchas (concrete failure scenarios), skill references (Read `.claude/skills/X/references/Y.md`), integration points.
- Success criteria: Each agent has skill references (not inlined content) pointing to Phase 3 proposed paths. Target 100-200 lines per agent system prompt. Integration points mapped.

**`docs-agents-builder`** — Archetype: Builder, Model: sonnet, Tools: R+
- Description: `Use when running /docs command phase 5 — drafts complete agent file content (frontmatter + system prompt) for every agent delta from the role mapper. Not for deciding which agents to create (that's docs-role-mapper).`
- Apply research-gate block (agent prompts may reference library APIs).
- Agent-specific format: frontmatter with name, description, tools, model (default opus), body with AI-optimization rules, 100-200 lines per system prompt.
- Success criteria: All agent files have valid YAML frontmatter. Prompts under 200 lines. Skill refs point to Phase 3 paths. No scope overlaps.

**`docs-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /docs command phase 6 — validates the skills plan and agents plan against frontmatter rules, size limits, CSO compliance, reference accuracy, and cross-layer integrity. Not for creating skills or agents.`
- Agent-specific verification:
  - **Skill checks** (per skill): Frontmatter valid, CSO-compliant description, size within limits, `file:line` accuracy (spot-check 5+), AI-optimization (critical rules at start, gotchas at end), maintenance skill present, CLAUDE.md not modified.
  - **Agent checks** (per agent): Frontmatter (name kebab-case, max 64 chars, no "anthropic"/"claude" in name), description (3rd person, specific triggers), system prompt <200 lines, minimal tools, no scope overlaps.
  - **Cross-layer integrity**: every `.claude/skills/...` path referenced by any agent MUST exist in the Phase 3 Skills Plan.
  - **Replaced-skill sentinel**: every split/merge action in Phase 3 Plan MUST have a `git rm -r .claude/skills/<old-name>/` in the Phase 7 presentation.
- Success criteria: All skills and agents pass checks. Every agent's skill references resolve. 5+ `file:line` spot-checks. No CLAUDE.md edits.

### /human-docs agents

**`human-docs-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /human-docs command phase 1 — discovers all .md files, identifies the project stack and architecture, finds API routes and env vars, and notes existing doc conventions. Not for project skills (use /docs).`
- Agent-specific items: Glob all `.md` (excluding node_modules, .git, vendor). Identify project stack, API routes/endpoints. Check for OpenAPI/Swagger specs. Identify env vars used. Note doc conventions. Use $ARGUMENTS to focus.
- Success criteria: All `.md` files cataloged. Project stack identified. Doc gaps mapped to source areas.

**`human-docs-analyzer`** — Archetype: Analyzer (structured), Model: sonnet, Tools: R
- Description: `Use when running /human-docs command phase 2 — categorizes .md files (human-readable vs AI-optimized vs keep-as-is) and produces a gap analysis. Not for writing doc content (that's human-docs-writer).`
- Agent-specific categorization:
  - Human-readable: README.md, CONTRIBUTING.md — keep clear for humans, marketing OK
  - AI-optimized: CLAUDE.md, docs/**/*.md, *.md in src/ — structured, no fluff, `file:line` refs
  - Keep as-is: CHANGELOG.md, LICENSE.md, CODE_OF_CONDUCT.md
- Agent-specific analysis per category: README (description accurate, setup complete, deps documented, usage clear), CLAUDE.md (structure + file paths, conventions explicit, patterns with `file:line`, gotchas clear), docs/ (API accuracy, schemas match, examples runnable), .env.example (vars documented, descriptions clear, defaults).
- Success criteria: Every `.md` categorized. Gap analysis covers README, CLAUDE.md, docs/, .env.example. Optimization candidates identified.

**`human-docs-writer`** — Archetype: Writer, Model: **opus**, Tools: R+
- Description: `Use when running /human-docs command phase 3 — drafts README/CLAUDE/docs content per the analyzer's gap analysis using correct format per category (human-readable vs AI-optimized). Not for source code or test generation.`
- Apply research-gate block (docs reference library/framework APIs).
- Agent-specific output formats:
  - **README.md (human-readable)**: Overview, Prerequisites, Install steps (copy-paste ready), Config, Usage examples, API ref or link, Contributing (brief), License.
  - **CLAUDE.md / docs/**/*.md (AI-optimized)**: Structured format with `# ComponentName`, `## Purpose` (bullets), `## Location` (File/Lines/Exports), `## Dependencies` (table), `## API` (per-function), `## Patterns` (code blocks with `file:line`), `## Gotchas` (bullets).
  - **.env.example**: All vars with description comments, safe defaults, grouped by category.
- Success criteria: All `file:line` refs point to actual existing code. AI-optimized docs use bullets/tables only. Human-readable docs have copy-paste-ready commands.

**`human-docs-pre-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /human-docs command phase 4 — validates drafted documentation against the actual codebase before writing, catching AI slop, inaccurate file refs, and bad API docs. Not for post-implementation verification.`
- Agent-specific verification: File paths exist, line refs match, API endpoints match actual route defs, examples runnable, function signatures correct, env vars actually used (`grep process.env` / `os.environ`), defaults match code. AI slop scan (filler, inflated adjectives, hedging, empty claims, prose in AI-optimized docs).
- Output: Verified Correct / Errors Found / AI Slop Found / Unable to Verify.
- Success criteria: Spot-checked 5+ refs. Zero AI slop. All examples verified runnable.

**`human-docs-post-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /human-docs command phase 7 — verifies all written documentation changes via git diff against the actual codebase, flagging contradictions for revert. Not for pre-implementation planning.`
- Agent-specific verification: Run `git diff`. For each change: file paths exist, line refs match, API endpoints match actual route defs (NOT constants files), env vars used in code (`grep process.env` / `os.environ`), defaults match code, code examples would run, README setup commands work, URLs valid.
- Output: Verified Correct / ERRORS FOUND - Must Revert (with evidence) / Unable to Verify.
- Success criteria: Every change verified. All file paths confirmed. Zero contradictions with actual code.

### /refactor agents

**`refactor-explorer`** — Archetype: Explorer, Model: sonnet, Tools: R
- Description: `Use when running /refactor command phase 1 — maps project stack, monorepo structure, available analysis tools (knip/vulture/deadcode), test infrastructure, existing abstractions, and DI patterns. Not for general exploration.`
- Agent-specific items: Detect monorepo (workspaces, pnpm-workspace.yaml, lerna.json, Cargo workspace). Detect analysis tools (knip/depcheck/ts-prune/vulture/ruff/deadcode/cargo-udeps). Check test infra + per-package commands. Map directory with file counts. Detect existing abstractions (interfaces, abstract classes, Python protocols), class hierarchies (>1 descendant via grep), DI patterns (constructor injection, NestJS/Inversify/Symfony/Spring containers, factory functions).
- Agent-specific output: `## Existing Abstractions` (interfaces/protocols with file:line, hierarchies, DI framework + convention + representative usage).
- Success criteria: Stack + monorepo status identified. Test runner verified. Analysis tools listed with paths. DI patterns catalogued with `file:line`.

**`refactor-dead-code-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R+
- Description: `Use when running /refactor command phase 2 — finds dead code (unused exports, unreachable code, unused deps, orphaned files) with safety tiers (SAFE/CAUTION/DANGER) via tool-augmented scan. Not for general refactoring.`
- Agent-specific tool-augmented scan: JS/TS `npx knip --reporter compact`, `npx depcheck --json`; Python `vulture <scope> --min-confidence 80`, `ruff check --select F811,F841`; Go `deadcode -test ./...`; Rust `cargo-udeps`. Manual scan complements: grep exported symbols cross-referenced with imports, files with zero inbound imports, unreachable after return/throw, commented-out >3 lines, unused params.
- Safety tiers: SAFE (utilities, test helpers, zero importers), CAUTION (components/routes/middleware — check dynamic imports), DANGER (config, entry points, type defs, build-config-referenced).
- Success criteria: Every finding has `file:line`. CAUTION items have dynamic-import check. Tool output included where available.

**`refactor-duplication-scanner`** — Archetype: Scanner, Model: sonnet, Tools: R
- Description: `Use when running /refactor command phase 2 — finds duplicate code, missing function-extraction opportunities, frontend component reuse candidates, module-organization issues, and modernization candidates. SOLID violations are handled by refactor-solid-analyzer.`
- Agent-specific scan categories: Duplicate blocks (>5 lines, >80% similar), extraction candidates (>30-line methods, >3-level nesting, long parameter lists), frontend component reuse (similar UI patterns, duplicate styling, inline styles, repeated state management, similar data fetching), module organization (circular deps, barrel file tree-shaking killers, inconsistent import paths), modernization (callbacks→async/await, var→const/let, class→function components, manual iteration→array methods, deprecated APIs).
- Do NOT flag SOLID violations — that's Phase 3's job.
- Success criteria: Every finding has `file:line`. Duplicate groups list all instances. Frontend reuse refs actual existing components. No SOLID violations flagged.

**`refactor-solid-analyzer`** — Archetype: Analyzer, Model: **opus**, Tools: R+
- Description: `Use when running /refactor command phase 3 — performs deep per-principle SOLID analysis (all 5 principles including Liskov) plus monorepo cross-package coupling checks. Not for general refactoring scanning (use refactor-dead-code-scanner / refactor-duplication-scanner).`
- Agent-specific steps: (1) Component inventory via Glob + Grep (classes/modules with `file:line`, interfaces/protocols/abstract classes, standalone/factory functions, import relationships, DI setup). Exclude files the dead-code scanner classified SAFE. (2) Priority ordering (>200-line classes, >10-method classes, hot paths, abstract bases with many descendants). (3) Per-principle evaluation (S/O/L/I/D): signs, evidence quote, impact, pattern suggestion. (4) Monorepo cross-package check (backend importing frontend types, shared pkg depending on app code, cross-app imports) as principle `X`.
- Apply research-gate block (framework-specific DI patterns).
- Output: Component Inventory, Analysis Priority, SOLID Violations tiered Critical / High / Medium / Low, Summary (counts by principle).
- Success criteria: Component inventory with `file:line`. Priority ordering applied. All 5 principles evaluated. Every violation has `file:line`, principle, evidence, impact, pattern, risk tier. Context7 consulted for framework patterns. SAFE files skipped.

**`refactor-planner`** — Archetype: Planner, Model: **opus**, Tools: R+
- Description: `Use when running /refactor command phase 4 — prioritizes findings from all phase 2/3 agents into a tiered refactoring plan (quick wins → consolidation → structural) with test strategy and revert trigger per change. Not for implementing fixes.`
- Agent-specific tier definitions:
  - Tier 1 — Quick wins: SAFE dead code removal, unused dep removal, commented-out removal, simple modernization (var→const/let)
  - Tier 2 — Consolidation: duplicate→shared fn, function extraction, component consolidation, hook extraction, OCP→Strategy/registry (>3 cases), ISP→split interfaces, monorepo coupling fixes (contained scope)
  - Tier 3 — Structural: module reorg, CAUTION dead-code removal with dynamic-import verification, complex modernization (callbacks→async), SRP→Extract Class, DIP→Dependency Injection, LSP→fix hierarchy (prefer composition)
- Apply research-gate block.
- Pattern guidance: prefer composition over inheritance for L and I violations. Over-engineering guard: if refactoring is more complex than the violation, skip with reason.
- Success criteria: Every refactoring has all 9 Planner fields. Ordering respects dependencies. No refactoring changes behavior. Skipped findings have rationale.

**`refactor-pre-verifier`** — Archetype: Verifier, Model: sonnet, Tools: R
- Description: `Use when running /refactor command phase 5 — validates the planner's refactoring plan for reference accuracy, safety, dependency ordering, completeness, and over-engineering BEFORE implementation. Not for post-implementation verification.`
- Agent-specific verification: Reference accuracy (spot-check 5+ `file:line`, dead code verified zero references via grep, duplicates actually similar, extraction candidates actually long, SOLID violations exist at reported loc). Safety (CAUTION dead code dynamic-import thorough, any export changes have no external consumers, component consolidation truly interchangeable, modernization preserves return types, SOLID refactoring preserves behavior). Dependency ordering correct. Completeness (high-impact findings not skipped without reason, test strategies realistic). **Over-engineering** (for every SOLID violation entry: is the refactoring simpler than the problem? Does the pattern match the violation's scope? Would minimal in-place fix work?).
- Output: Reference Accuracy / Safety Verification / Dependency Ordering / Over-Engineering Check (APPROVED/REJECTED/MODIFIED per entry) / Issues to Fix (MUST/SHOULD/MINOR).
- Success criteria: Spot-checked 5+ refs. All CAUTION items verified. Every SOLID entry passed over-engineering check. Zero unverified dead code approved.

**`refactor-post-verifier`** — Archetype: Analyzer (re-analysis variant), Model: **opus**, Tools: R+
- Description: `Use when running /refactor command phase 8 — verifies applied refactorings against the plan via git diff, runs tests/linter/type-checker, AND re-analyzes every refactored file for NEW SOLID violations introduced while fixing old ones. This is the most reasoning-heavy verification in the kit. Not for pre-implementation verification.`
- Agent-specific verification: Review applied changes vs plan. Dead code removal: verify truly gone (grep), no dangling refs. Duplicate consolidation: all call sites updated. Component reuse: all instances use shared component with correct props. Extractions: extracted fn called from original. SOLID refactorings: applied pattern resolves the violation. **New-violation check**: re-analyze every refactored file against all 5 principles; flag any new violations. Run tests. Run linter. Run type checker.
- Agent-specific output: Verified Correct / ERRORS - Must Revert / New Violations Introduced (per-entry with file:line, principle, evidence) / SOLID Compliance Delta (pre/post/resolved/new counts) / Summary (refactorings applied, reverted, lines removed, files modified/deleted, test/linter/type PASS|FAIL).
- Apply research-gate block (re-analysis may consult framework docs).
- Success criteria: Every applied change verified against plan. Test suite + linter pass. No dangling refs. No new SOLID violations introduced. SOLID compliance delta reported.

---

## Command File Spec (thin orchestrators)

Every rewritten command follows this skeleton. Per-command deltas only change phase ordering, agent names, and parallel-launch blocks.

### Command Frontmatter

```yaml
---
name: <command>
description: <unchanged from current command>
allowed-tools: <orchestrator-only tools — see §Allowed-Tools per Command>
---
```

**Orchestrator tool set** (minimal, shared across all commands):
- `Read` — read plan file, load agent outputs
- `Write` — write plan file, write phase results
- `Glob` / `Grep` — only for orchestrator-level verification (e.g., checking agents/ paths)
- `Task` (aliased to `Agent`) — invoke subagents
- `Bash(date)` — for date stamps at phase boundaries

**Per-command additions** (for implementation phase, post-ExitPlanMode):
- `/fix`: `Edit`, `Bash(git rm:*)`, `Bash(git add:*)`, `Bash(git restore:*)`, test-runner subcommands, linter/type-check subcommands
- `/refactor`: same as /fix plus analysis tools (`npx knip:*`, `ruff:*`, etc.)
- `/test`: `Write` (for test files), test-runner subcommands, linter/type-check subcommands
- `/review`: `Edit`, `Bash(git add:*)`, `Bash(git restore:*)`, test-runner/linter/type-check subcommands
- `/human-docs`: `Edit`, `Write` (for .md files), `Bash(git add:*)`, `Bash(mkdir:*)`
- `/docs`: `Edit(.claude/skills/**) Edit(.claude/agents/**) Write(.claude/skills/**) Write(.claude/agents/**) Bash(mkdir:*)`
- `/security`: read-only; no additions

### Command Body Skeleton

```markdown
# <Title>

<2-sentence command purpose — carried over from existing>

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent(s) in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- <the phase whose ExitPlanMode gate is the user-approval point>

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

## Phase 1: <Name>

Invoke `subagent_type: <agent-name>` with the following prompt:

> <prompt: "Run <command> Phase <N>. <Role>. Plan file path: {plan-path-from-system-prompt}. $ARGUMENTS context if applicable. Write your output to the plan file under `## Phase <N>: <Name> Results`.">

## Phase 2: <Name>

<constraint>
Launch ALL <N> agents below in a SINGLE tool-call turn. Do NOT wait.
</constraint>

Parallel invocations (in one turn):
- `subagent_type: <agent-1>` — Prompt: <prompt>
- `subagent_type: <agent-2>` — Prompt: <prompt>
- <...>

After all return, write their outputs to the plan file under `## Phase 2: <Names> Results`, then launch Phase 3.

## Phase 3, 4, ...: <Name>

<as above>

## Phase <N>: Present Plan + Exit Plan Mode

Write the final plan presentation to the plan file, then call `ExitPlanMode`.

---

## Phase <N+1>: Implementation (if applicable)

After approval:
<implementation steps — carried over from existing command>

## Phase <N+2>: Post-Implementation Verification

Invoke `subagent_type: <post-verifier>` with plan file path as context.

---

## Allowed Tools

See frontmatter. Orchestrator is <read-only | also has Edit/Write for implementation>.

## Usage

```bash
/<command>                    # Full run
/<command> <args>             # Scoped
```
```

### Parallel-launch invocation example (for a /security-style phase 2)

```
## Phase 2: Parallel Analysis

<constraint>
Launch ALL THREE agents below in a SINGLE tool-call turn.
</constraint>

Parallel invocations:
- `subagent_type: security-vulnerability-scanner` — Prompt: "Run /security Phase 2a. Plan file: {plan-path}. Scan the codebase for OWASP Top 10 vulnerabilities per your system prompt. Write findings to the plan file under `## Phase 2a: Vulnerability Findings`."
- `subagent_type: security-logic-analyzer` — Prompt: "Run /security Phase 2b. Plan file: {plan-path}. Analyze the codebase for business-logic flaws and trust-boundary violations per your system prompt. Write findings to the plan file under `## Phase 2b: Logic Findings`."
- `subagent_type: security-adversarial-hunter` — Prompt: "Run /security Phase 2c. Plan file: {plan-path}. Hunt for missed vulnerabilities and chained attacks per your system prompt. Write findings to the plan file under `## Phase 2c: Adversarial Findings`."

After all three return, confirm their outputs landed in the plan file, then immediately launch Phase 3.
```

---

## Validators

### `guard-agents.sh` — Structural Validator

Mirrors `guard-skills.sh` / `guard-commands.sh`. Exits non-zero on any structural failure.

**Checks (fatal):**
1. Frontmatter is fenced with `---`, parses as YAML
2. Required fields present: `name`, `description`, `tools`, `model`
3. `name` is kebab-case (`^[a-z][a-z0-9-]*$`), ≤64 chars, does not contain "anthropic" or "claude"
4. `name` matches the filename (`<name>.md`)
5. `description` is ≤1024 chars
6. `description` starts with "Use when"
7. `description` contains "Not for" OR "Not" clause (to prevent delegation collisions)
8. `model` is one of: `sonnet`, `opus`, `haiku`, `inherit`, or a full model ID (`claude-*-*-*`)
9. `tools` is a comma-separated or YAML-list of known tool names
10. Body ≤500 lines (excl. frontmatter)
11. Body has ≥1 `<constraint>` block OR an explicit rationale comment
12. Body has `## Workflow` and `## Success Criteria` sections

**Checks (warnings):**
- Description ≥5 project/command-specific keywords
- Body ≥80 lines (agent is substantive)

Usage: `bash guard-agents.sh` (all agents) or `bash guard-agents.sh <path>` (single).

### `score-agents.sh` — Quality Score

Mirrors `score-skills.sh`. Scores each agent 0–100 on:
- CSO description (trigger-first, specificity, "Not for" clause) — 25pts
- Frontmatter completeness (every optional field that adds value) — 15pts
- Body structure (workflow, success criteria, constraint blocks, examples) — 30pts
- Anti-slop (no filler, no hedging, no inflated adjectives) — 15pts
- Shared block usage (shell-avoidance, anti-hallucination present where expected) — 15pts

Usage: `bash score-agents.sh` (aggregate) or `bash score-agents.sh --per-file`.

---

## Tasks

### Task 1: Infrastructure

**Files:**
- Create: `ssot/.claude/agents/` (empty directory — kept with `.gitkeep` temporarily)
- Create: `guard-agents.sh`
- Create: `score-agents.sh`
- Modify: `sync.sh` (verify agents/ syncs; it already copies `ssot/.claude/*`, so no change expected — confirm)

- [ ] **Step 1: Create agents directory**

```bash
mkdir -p ssot/.claude/agents
touch ssot/.claude/agents/.gitkeep
```

- [ ] **Step 2: Write `guard-agents.sh`**

Create `guard-agents.sh` at repo root with the checks listed in §Validators above. Implementation: bash script that loops over `ssot/.claude/agents/*.md`, parses YAML frontmatter via `awk` or `yq` (if available) falling back to sed, and applies each fatal check. Returns exit 0 on pass, non-zero on any fatal. Print pass/fail per file.

Reference `guard-skills.sh` for structure and idioms.

- [ ] **Step 3: Write `score-agents.sh`**

Create `score-agents.sh` at repo root mirroring `score-skills.sh`. Five scoring dimensions per §Validators. Accept `--per-file` flag to print one line per agent. Aggregate score with pass threshold at 70.

- [ ] **Step 4: Verify `sync.sh` handles agents/**

```bash
bash sync.sh --dry-run
```

Expected output includes `ssot/.claude/agents/` being copied. If not, add a line to the sync script. If it does (because it globs `ssot/.claude/*`), no change needed.

- [ ] **Step 5: Run validators on empty dir**

```bash
bash guard-agents.sh
bash score-agents.sh
```

Expected: both report "0 agents found" and exit 0 cleanly.

- [ ] **Step 6: Commit infrastructure**

```bash
git add ssot/.claude/agents/.gitkeep guard-agents.sh score-agents.sh
git commit -m "infra: scaffold ssot/.claude/agents/ + guard/score validators"
```

---

### Task 2: /security migration

**Files:**
- Create: 5 agent files under `ssot/.claude/agents/` (security-explorer, security-vulnerability-scanner, security-logic-analyzer, security-adversarial-hunter, security-synthesizer)
- Modify: `ssot/.claude/commands/security.md` (full rewrite)

For each agent file, construct by:
1. Copying the archetype frontmatter template (§Archetype Reference → Frontmatter Template)
2. Filling in the per-agent spec from §Agent-Specific Specs → /security agents (name, description, tools, model)
3. Copying the archetype body (§Archetype Reference → Body Template)
4. Substituting the archetype workflow (Explorer / Scanner / Analyzer / Synthesizer as specified)
5. Inserting the shared constraint blocks (shell-avoidance always; research-gate where R+)
6. Inserting the context-acknowledgment block as the workflow's first step
7. Filling in the per-agent-specific workflow details, output format, and success criteria from the spec

- [ ] **Step 1: Create `security-explorer`**

Write `ssot/.claude/agents/security-explorer.md` per spec (archetype: Explorer, model: sonnet, tools: R).

- [ ] **Step 2: Validate**

```bash
bash guard-agents.sh ssot/.claude/agents/security-explorer.md
```

Expected: pass. If fail, fix per validator output.

- [ ] **Step 3: Create `security-vulnerability-scanner`**

Write `ssot/.claude/agents/security-vulnerability-scanner.md` per spec (archetype: Scanner, model: sonnet, tools: R+, include research-gate block).

- [ ] **Step 4: Validate**

```bash
bash guard-agents.sh ssot/.claude/agents/security-vulnerability-scanner.md
```

- [ ] **Step 5: Create `security-logic-analyzer`**

Write `ssot/.claude/agents/security-logic-analyzer.md` per spec (archetype: Analyzer, **model: opus**, tools: R+, include research-gate block).

- [ ] **Step 6: Validate**

```bash
bash guard-agents.sh ssot/.claude/agents/security-logic-analyzer.md
```

- [ ] **Step 7: Create `security-adversarial-hunter`**

Write `ssot/.claude/agents/security-adversarial-hunter.md` per spec (archetype: Analyzer-creative variant, **model: opus**, tools: R+, include research-gate block).

- [ ] **Step 8: Validate**

```bash
bash guard-agents.sh ssot/.claude/agents/security-adversarial-hunter.md
```

- [ ] **Step 9: Create `security-synthesizer`**

Write `ssot/.claude/agents/security-synthesizer.md` per spec (archetype: Synthesizer, **model: opus**, tools: R+, include research-gate block).

- [ ] **Step 10: Validate all /security agents**

```bash
bash guard-agents.sh
```

Expected: 5 agents pass, others don't exist yet.

- [ ] **Step 11: Rewrite `ssot/.claude/commands/security.md`**

Full rewrite per §Command File Spec. Phases:
- **Phase 1:** invoke `security-explorer`
- **Phase 2:** parallel launch (single turn) `security-vulnerability-scanner`, `security-logic-analyzer`, `security-adversarial-hunter`
- **Phase 3:** invoke `security-synthesizer`
- **Phase 4:** Present plan + ExitPlanMode

Frontmatter tools: orchestrator read-only set (`Read`, `Write`, `Glob`, `Grep`, `Task`, `Bash(date)`, `Bash(git status)`, `Bash(git log:*)`, `Bash(rtk:*)`).

Remove the shell-avoidance constraint block (now in agents). Remove the Model Tiering note (tiering is now per-agent frontmatter). Keep Plan Mode + Phase Transition Protocol constraints.

Target file size: ~50-80 lines.

- [ ] **Step 12: Validate command**

```bash
bash guard-commands.sh ssot/.claude/commands/security.md
```

Expected: pass. Adjust if new checks needed (e.g., if guard-commands.sh flags the absent `<task>` blocks as missing — add exemption for commands using `subagent_type` invocations instead).

- [ ] **Step 13: Score /security agents**

```bash
bash score-agents.sh --per-file | grep '^security-'
```

Expected: each ≥70. Adjust any agent below threshold.

- [ ] **Step 14: Sync and verify**

```bash
bash sync.sh --dry-run
```

Confirm agents/ files show up in the sync plan.

- [ ] **Step 15: Commit /security migration**

```bash
git add ssot/.claude/agents/security-*.md ssot/.claude/commands/security.md
git rm -f ssot/.claude/agents/.gitkeep  # if still present
git commit -m "feat(security): extract 5 agents; rewrite command as thin orchestrator

- security-explorer (sonnet): phase 1 attack-surface mapping
- security-vulnerability-scanner (sonnet): phase 2 OWASP pattern scan
- security-logic-analyzer (opus): phase 2 business-logic + trust-boundary
- security-adversarial-hunter (opus): phase 2 chained-attack reasoning
- security-synthesizer (opus): phase 3 challenge + reconcile + prioritize
- Command shrinks from ~475 to ~80 lines
- Model tiering: 3 opus synthesis/analysis + 2 sonnet"
```

---

### Task 3: /fix migration

**Files:** 7 agent files + command rewrite (fix-explorer, fix-reproducer, fix-code-quality-scanner, fix-dependency-scanner, fix-planner, fix-pre-verifier, fix-post-verifier) + `ssot/.claude/commands/fix.md`.

- [ ] **Step 1-14: Create and validate each agent** (same pattern as Task 2 Steps 1-10)

Write each agent per §Agent-Specific Specs → /fix agents. Validate after each. Agents:
1. `fix-explorer` (Explorer, sonnet, R)
2. `fix-reproducer` (Reproducer, sonnet, R+)
3. `fix-code-quality-scanner` (Scanner, sonnet, R+)
4. `fix-dependency-scanner` (Scanner, sonnet, R+)
5. `fix-planner` (Planner, **opus**, R+, research-gate)
6. `fix-pre-verifier` (Verifier, sonnet, R)
7. `fix-post-verifier` (Verifier, sonnet, R, plus test-runner via Bash — add `Bash(npm test)`, `Bash(pnpm test)`, `Bash(pytest:*)`, etc. to tools)

- [ ] **Step 15: Rewrite `ssot/.claude/commands/fix.md`**

Phases:
- **Phase 1:** `fix-explorer`
- **Phase 2 (conditional):** `fix-reproducer` — skip if $ARGUMENTS empty or directory path
- **Phase 3:** parallel `fix-code-quality-scanner` + `fix-dependency-scanner` (single turn)
- **Phase 4:** `fix-planner`
- **Phase 5:** `fix-pre-verifier`
- **Phase 6:** Present Plan + ExitPlanMode
- **Phase 7:** Implementation (orchestrator uses Edit + git rm + tests)
- **Phase 8:** `fix-post-verifier`

Frontmatter tools: orchestrator + implementation set (Edit, Bash(git rm:*), Bash(git add:*), Bash(git restore:*), test-runners, linters, type-checkers — carry over from current command frontmatter).

- [ ] **Step 16: Validate command**

```bash
bash guard-commands.sh ssot/.claude/commands/fix.md
```

- [ ] **Step 17: Score /fix agents**

```bash
bash score-agents.sh --per-file | grep '^fix-'
```

- [ ] **Step 18: Commit /fix migration**

```bash
git add ssot/.claude/agents/fix-*.md ssot/.claude/commands/fix.md
git commit -m "feat(fix): extract 7 agents; rewrite command as thin orchestrator

- fix-explorer, fix-reproducer, fix-code-quality-scanner, fix-dependency-scanner (sonnet): scan/scope
- fix-planner (opus): minimal-fix design with blast-radius + research gate
- fix-pre-verifier, fix-post-verifier (sonnet): mechanical verification
- Command shrinks substantially; model tiering: 1 opus planner + 6 sonnet"
```

---

### Task 4: /review migration

**Files:** 4 agent files (review-explorer, review-analyzer, review-pre-verifier, review-post-verifier) + `ssot/.claude/commands/review.md`.

- [ ] **Step 1-8: Create and validate each agent**

Agents:
1. `review-explorer` (Explorer, sonnet, R)
2. `review-analyzer` (Analyzer, **opus**, R+, research-gate) — THIS IS THE COMMAND'S MAIN VALUE PHASE
3. `review-pre-verifier` (Verifier, sonnet, R)
4. `review-post-verifier` (Verifier, sonnet, R, plus test-runner)

- [ ] **Step 9: Rewrite `ssot/.claude/commands/review.md`**

Phases:
- **Phase 1:** `review-explorer`
- **Phase 2:** `review-analyzer`
- **Phase 3:** `review-pre-verifier`
- **Phase 4:** Present Plan + ExitPlanMode
- **Phase 5:** Implementation (orchestrator)
- **Phase 6:** `review-post-verifier`

- [ ] **Step 10: Validate + score + commit**

```bash
bash guard-commands.sh ssot/.claude/commands/review.md
bash score-agents.sh --per-file | grep '^review-'
git add ssot/.claude/agents/review-*.md ssot/.claude/commands/review.md
git commit -m "feat(review): extract 4 agents; rewrite command

- review-analyzer (opus): SOLID + security + perf + slop pass — the command's main phase
- review-explorer + 2 verifiers (sonnet): exploration + mechanical verification
- Model tiering: 1 opus + 3 sonnet"
```

---

### Task 5: /test migration

**Files:** 5 agent files (test-explorer, test-analyzer, test-generator, test-pre-verifier, test-post-verifier) + `ssot/.claude/commands/test.md`.

- [ ] **Step 1-10: Create and validate each agent**

Agents:
1. `test-explorer` (Explorer, sonnet, R)
2. `test-analyzer` (Analyzer, sonnet, R)
3. `test-generator` (Generator, **opus**, R+, research-gate)
4. `test-pre-verifier` (Verifier, sonnet, R)
5. `test-post-verifier` (Verifier, sonnet, R, plus test-runner)

- [ ] **Step 11: Rewrite `ssot/.claude/commands/test.md`**

Phases:
- **Phase 1:** `test-explorer`
- **Phase 2:** `test-analyzer`
- **Phase 3:** `test-generator`
- **Phase 4:** `test-pre-verifier`
- **Phase 5:** Present Plan + ExitPlanMode
- **Phase 6:** Implementation (orchestrator writes test files)
- **Phase 7:** `test-post-verifier`

- [ ] **Step 12: Validate + score + commit**

```bash
bash guard-commands.sh ssot/.claude/commands/test.md
bash score-agents.sh --per-file | grep '^test-'
git add ssot/.claude/agents/test-*.md ssot/.claude/commands/test.md
git commit -m "feat(test): extract 5 agents; rewrite command

- test-generator (opus): creative edge-case design with research-gate
- test-explorer, test-analyzer, 2 verifiers (sonnet): structured passes
- Model tiering: 1 opus + 4 sonnet"
```

---

### Task 6: /docs migration

**Files:** 8 agent files (docs-explorer, docs-categorizer, docs-pattern-scanner, docs-skills-builder, docs-role-mapper, docs-pattern-extractor, docs-agents-builder, docs-verifier) + `ssot/.claude/commands/docs.md`.

This is the largest per-command migration. The command has parallel phases on both Phase 2 (skills analysis) and Phase 4 (agents analysis).

- [ ] **Step 1-16: Create and validate each agent**

Agents:
1. `docs-explorer` (Explorer, sonnet, R)
2. `docs-categorizer` (Analyzer, **opus**, R)
3. `docs-pattern-scanner` (Scanner, sonnet, R)
4. `docs-skills-builder` (Builder, sonnet, R+, research-gate)
5. `docs-role-mapper` (Analyzer, **opus**, R)
6. `docs-pattern-extractor` (Scanner, sonnet, R)
7. `docs-agents-builder` (Builder, sonnet, R+, research-gate)
8. `docs-verifier` (Verifier, sonnet, R)

- [ ] **Step 17: Rewrite `ssot/.claude/commands/docs.md`**

Phases:
- **Phase 0:** State Detection (deterministic, inline in command, no subagent)
- **Phase 1:** `docs-explorer`
- **Phase 2:** parallel `docs-categorizer` + `docs-pattern-scanner` (single turn)
- **Phase 3:** `docs-skills-builder`
- **Phase 4:** parallel `docs-role-mapper` + `docs-pattern-extractor` (single turn)
- **Phase 5:** `docs-agents-builder`
- **Phase 6:** `docs-verifier`
- **Phase 7:** Present Plan + ExitPlanMode
- **Phase 8:** Implementation (orchestrator writes to `.claude/skills/**` and `.claude/agents/**`)

Frontmatter tools: orchestrator + scoped write (`Edit(.claude/skills/**)`, `Edit(.claude/agents/**)`, `Write(.claude/skills/**)`, `Write(.claude/agents/**)`, `Bash(mkdir:*)`).

- [ ] **Step 18: Validate + score + commit**

```bash
bash guard-commands.sh ssot/.claude/commands/docs.md
bash score-agents.sh --per-file | grep '^docs-'
git add ssot/.claude/agents/docs-*.md ssot/.claude/commands/docs.md
git commit -m "feat(docs): extract 8 agents; rewrite command with two parallel phases

- docs-categorizer (opus): skill set architecture (split/merge/refresh)
- docs-role-mapper (opus): agent roster architecture with SRP boundaries
- docs-explorer, docs-pattern-scanner, docs-skills-builder, docs-pattern-extractor, docs-agents-builder, docs-verifier (sonnet): exploration + extraction + drafting + verification
- Parallel phases: P2 (categorizer + pattern-scanner), P4 (role-mapper + pattern-extractor)
- Model tiering: 2 opus architecture + 6 sonnet"
```

---

### Task 7: /human-docs migration

**Files:** 5 agent files (human-docs-explorer, human-docs-analyzer, human-docs-writer, human-docs-pre-verifier, human-docs-post-verifier) + `ssot/.claude/commands/human-docs.md`.

- [ ] **Step 1-10: Create and validate each agent**

Agents:
1. `human-docs-explorer` (Explorer, sonnet, R)
2. `human-docs-analyzer` (Analyzer, sonnet, R)
3. `human-docs-writer` (Writer, **opus**, R+, research-gate)
4. `human-docs-pre-verifier` (Verifier, sonnet, R)
5. `human-docs-post-verifier` (Verifier, sonnet, R)

- [ ] **Step 11: Rewrite `ssot/.claude/commands/human-docs.md`**

Phases:
- **Phase 1:** `human-docs-explorer`
- **Phase 2:** `human-docs-analyzer`
- **Phase 3:** `human-docs-writer`
- **Phase 4:** `human-docs-pre-verifier`
- **Phase 5:** Present Plan + ExitPlanMode
- **Phase 6:** Implementation (orchestrator writes .md files)
- **Phase 7:** `human-docs-post-verifier`

- [ ] **Step 12: Validate + score + commit**

```bash
bash guard-commands.sh ssot/.claude/commands/human-docs.md
bash score-agents.sh --per-file | grep '^human-docs-'
git add ssot/.claude/agents/human-docs-*.md ssot/.claude/commands/human-docs.md
git commit -m "feat(human-docs): extract 5 agents; rewrite command

- human-docs-writer (opus): prose rewriting + AI-slop removal + research-gate
- human-docs-explorer, human-docs-analyzer, 2 verifiers (sonnet)
- Model tiering: 1 opus + 4 sonnet"
```

---

### Task 8: /refactor migration

**Files:** 7 agent files (refactor-explorer, refactor-dead-code-scanner, refactor-duplication-scanner, refactor-solid-analyzer, refactor-planner, refactor-pre-verifier, refactor-post-verifier) + `ssot/.claude/commands/refactor.md`.

- [ ] **Step 1-14: Create and validate each agent**

Agents:
1. `refactor-explorer` (Explorer, sonnet, R)
2. `refactor-dead-code-scanner` (Scanner, sonnet, R+)
3. `refactor-duplication-scanner` (Scanner, sonnet, R)
4. `refactor-solid-analyzer` (Analyzer, **opus**, R+, research-gate)
5. `refactor-planner` (Planner, **opus**, R+, research-gate)
6. `refactor-pre-verifier` (Verifier, sonnet, R)
7. `refactor-post-verifier` (Analyzer re-analysis variant, **opus**, R+, research-gate) — re-analyzes for NEW SOLID violations

- [ ] **Step 15: Rewrite `ssot/.claude/commands/refactor.md`**

Phases:
- **Phase 1:** `refactor-explorer`
- **Phase 2:** parallel `refactor-dead-code-scanner` + `refactor-duplication-scanner` (single turn)
- **Phase 3:** `refactor-solid-analyzer` (sequential — uses Phase 2 safety-tier output)
- **Phase 4:** `refactor-planner`
- **Phase 5:** `refactor-pre-verifier`
- **Phase 6:** Present Plan + ExitPlanMode
- **Phase 7:** Implementation (orchestrator)
- **Phase 8:** `refactor-post-verifier`

- [ ] **Step 16: Validate + score + commit**

```bash
bash guard-commands.sh ssot/.claude/commands/refactor.md
bash score-agents.sh --per-file | grep '^refactor-'
git add ssot/.claude/agents/refactor-*.md ssot/.claude/commands/refactor.md
git commit -m "feat(refactor): extract 7 agents; rewrite command

- refactor-solid-analyzer (opus): deep 5-principle analysis with research-gate
- refactor-planner (opus): tier/order/pattern selection
- refactor-post-verifier (opus): re-analyzes for NEW SOLID violations after refactoring
- refactor-explorer, 2 scanners, refactor-pre-verifier (sonnet)
- Model tiering: 3 opus reasoning + 4 sonnet"
```

---

### Task 9: Remove env var + update CLAUDE.md

**Files:**
- Modify: `ssot/.claude/settings.json` — remove `CLAUDE_CODE_SUBAGENT_MODEL`
- Modify: `ssot/.claude/CLAUDE.md` — document agents + model tiering
- Modify: `CLAUDE.md` (repo root) — add `## Agents` section + update command table

This task MUST run last among implementation tasks — removing the env var before all agents exist would cause orphaned-subagent-type failures at runtime.

- [ ] **Step 1: Remove env var from settings.json**

Edit `ssot/.claude/settings.json`. Remove the line:
```
"CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-6",
```

Keep everything else. Verify the JSON still parses:
```bash
jq . ssot/.claude/settings.json > /dev/null && echo "valid JSON"
```

- [ ] **Step 2: Update `ssot/.claude/CLAUDE.md`**

Under the "Project Skills" section, add a new section:

```markdown
## Project Agents

Projects and the global kit may have `.claude/agents/` directories containing subagent definitions. Each agent file declares its model (`sonnet`/`opus`/`haiku`), tools, and system prompt. Claude Code auto-discovers them at session start and delegates to them when the `subagent_type` matches or when a command explicitly invokes them.

<constraint>
When adding a new agent: use kebab-case name, CSO-compliant description (starts "Use when…"), explicit model + tools + trigger-condition-specific description (include a "Not for…" clause to prevent accidental delegation).
</constraint>

**Validators:** `bash guard-agents.sh` (structural), `bash score-agents.sh` (quality).
```

- [ ] **Step 3: Update repo-root `CLAUDE.md`**

Add a new `## Agents` section after `## Skills`:

```markdown
## Agents

The kit ships with 41 specialized agents in `ssot/.claude/agents/` — one per logical role per command. Agents encapsulate the domain-specific system prompt and model choice; commands orchestrate them by `subagent_type`. Every agent has explicit `model:` frontmatter enabling per-phase Opus/Sonnet tiering.

| Agent family | Count | Model mix |
|---|---|---|
| /security agents | 5 | 3 opus (synthesizer, logic, adversarial) + 2 sonnet |
| /fix agents | 7 | 1 opus (planner) + 6 sonnet |
| /review agents | 4 | 1 opus (analyzer) + 3 sonnet |
| /test agents | 5 | 1 opus (generator) + 4 sonnet |
| /docs agents | 8 | 2 opus (categorizer, role-mapper) + 6 sonnet |
| /human-docs agents | 5 | 1 opus (writer) + 4 sonnet |
| /refactor agents | 7 | 3 opus (solid-analyzer, planner, post-verifier) + 4 sonnet |
| **Total** | **41** | **12 opus (29%), 29 sonnet (71%)** |

Tiering rationale: Opus 4.7 earns its 5× output cost on synthesis, architectural reasoning, and multi-input reconciliation — synthesizers, analyzers with semantic reasoning, planners, creative/adversarial work. Sonnet 4.6 handles exploration, pattern scanning, and mechanical verification at ~70% of the cost.

Validators: `bash guard-agents.sh` / `bash score-agents.sh` — mirror the skills/commands validators.
```

Update the "## Custom Commands" table's Pipeline column to note that each phase's subagent is a named agent file (e.g., `/security | security-explorer → [security-vulnerability-scanner | security-logic-analyzer | security-adversarial-hunter] → security-synthesizer`).

In the `## Environment Variables → Model selection` table, remove the `CLAUDE_CODE_SUBAGENT_MODEL` row. Add a note: *Per-agent `model:` frontmatter now controls subagent model selection. Removing the env var was required to unlock per-phase tiering.*

- [ ] **Step 4: Run sync**

```bash
bash sync.sh
```

Confirm all 41 agent files + updated commands + updated settings land in `~/.claude/`.

- [ ] **Step 5: Commit env var + docs**

```bash
git add ssot/.claude/settings.json ssot/.claude/CLAUDE.md CLAUDE.md
git commit -m "chore: remove CLAUDE_CODE_SUBAGENT_MODEL; document agents + tiering

- Removing the env var unlocks per-agent model frontmatter (was priority 1, blocked everything)
- Document 41 agents + tiering rationale in CLAUDE.md (root) and ssot CLAUDE.md
- Validators: guard-agents.sh, score-agents.sh"
```

---

### Task 10: Full-kit validation pilot

No code changes — just validation that everything is structurally sound and ready for live testing.

- [ ] **Step 1: Run all validators**

```bash
bash guard-commands.sh
bash score-commands.sh
bash guard-skills.sh
bash score-skills.sh
bash guard-agents.sh
bash score-agents.sh
```

All must pass. Any failure blocks the PR/merge.

- [ ] **Step 2: Cross-reference check — every command's subagent_type references resolve to an existing agent file**

```bash
# For each command file, extract all `subagent_type: <name>` references, verify each has a matching agents/<name>.md
for cmd in ssot/.claude/commands/*.md; do
  grep -oE 'subagent_type: `?[a-z][a-z0-9-]+`?' "$cmd" | sed -E 's/.*subagent_type: `?([a-z0-9-]+)`?.*/\1/' | while read agent; do
    if [ ! -f "ssot/.claude/agents/${agent}.md" ]; then
      echo "MISSING: $cmd references $agent (no file)"
      exit 1
    fi
  done
done
echo "All subagent_type references resolve."
```

Expected: `All subagent_type references resolve.`

- [ ] **Step 3: Agent count sanity check**

```bash
ls ssot/.claude/agents/*.md | wc -l
```

Expected: `41`.

- [ ] **Step 4: Model tiering sanity check**

```bash
echo "Opus agents:"
grep -l '^model: opus' ssot/.claude/agents/*.md | wc -l
echo "Sonnet agents:"
grep -l '^model: sonnet' ssot/.claude/agents/*.md | wc -l
```

Expected: Opus 12, Sonnet 29.

- [ ] **Step 5: Env var is gone**

```bash
grep -c CLAUDE_CODE_SUBAGENT_MODEL ssot/.claude/settings.json
```

Expected: `0`.

- [ ] **Step 6: Commit validation artifacts (if any)**

If steps 1-5 produced no changes, skip. If validators were updated in-flight to handle edge cases, commit them:

```bash
git add -A
git commit -m "chore: final validation pass — all guards green, 41 agents resolve"
```

- [ ] **Step 7: Branch summary**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Report the branch state: commits landed, files changed, lines added/removed. This is what the user sees on return.

- [ ] **Step 8: Do NOT push**

The branch stays local. The user reviews and decides whether to merge/push on return. No destructive git operations (force-push, rebase, reset) without explicit approval.

---

## Rollback Plan

If the migration causes runtime failures in any command, rollback is straightforward because every change is on the feature branch:

1. **Fast rollback:** `git checkout main` (abandon the feature branch). The main branch is untouched; nothing deployed globally until `sync.sh` is run.
2. **Partial rollback (per-command):** `git revert <commit-sha>` for the specific command's commit (Tasks 2-8 are each a single commit). The other commands remain migrated.
3. **Env var rollback:** if agents fail to load models correctly, re-add `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6` to `settings.json` — this pins all agents back to Sonnet while keeping the file structure intact. Per-agent `model:` is ignored (env var priority 1), effectively reverting the tiering without deleting anything.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Agent file count inflates `~/.claude/agents/` globally; every session loads all 41 descriptions (~4KB at session start) | Accept — per the Claude Code docs, only descriptions load at session start, not bodies. 4KB is negligible. |
| Auto-delegation mis-fires (Claude delegates to `security-vulnerability-scanner` during unrelated chat) | CSO descriptions include "Not for…" clause + parent-command binding. guard-agents.sh enforces the "Not" clause. |
| Subagent model override silently fails | Env var removal is the FIRST line of Task 9. All preceding tasks still have env var pinning everything to Sonnet; removing it last unblocks tiering but requires all 41 files to exist. |
| Orchestrator doesn't know how to invoke subagents by `subagent_type` from a command | Claude Code's Agent tool natively supports `subagent_type`. Commands reference by name; orchestrator (Opus) constructs the Agent call. Confirmed in the subagents doc. |
| `guard-commands.sh` rejects thin commands because they lack `<task>` blocks | Update guard-commands.sh if needed — commands using `subagent_type` invocation pattern replace `<task>` blocks. Add an exemption: either pattern is valid. |
| Pilot testing: can't actually run the commands from within a Claude Code session (meta-recursion) | Validation is structural (guard-agents.sh + cross-reference check in Task 10). Live testing happens by the user invoking `/security`, `/fix`, etc. after the branch is merged. |
| Model tiering reports lower quality than Sonnet-only because Opus overthinks routine synthesis | Mitigated by the research: Opus earns its cost on synthesis/adversarial/architecture, which is where we assign it. If observed in practice: adjust specific agents back to Sonnet via frontmatter change (one-line revert per agent). |

---

## Self-Review Checklist (plan author)

- [x] **Spec coverage:** every command gets its agents + rewrite (Tasks 2-8). Settings.json env var removal (Task 9). CLAUDE.md documentation (Task 9). Validators (Task 1). Cross-reference check (Task 10).
- [x] **Placeholder scan:** no TBD/TODO/"implement later" in steps. Every step has a concrete action or code block.
- [x] **Type/name consistency:** agent names in Roster table match Agent-Specific Specs match Tasks 2-8 references. (Verified by inspection: `security-synthesizer` appears in roster, spec, Task 2; same for all 41.)
- [x] **Archetype closure:** 9 archetypes defined (Explorer, Scanner, Analyzer, Synthesizer, Planner, Generator, Writer, Builder, Verifier). Every agent's archetype column in the roster is one of these.
- [x] **Shared blocks defined verbatim:** shell-avoidance, research-gate, anti-hallucination, context-acknowledgment — all in §Shared Constraints, referenced by agent specs.
- [x] **Tool column expansion defined:** R and R+ expansions in §Archetype Reference.
- [x] **Frontmatter CSO checks:** every agent description starts "Use when…" (enforced by guard-agents.sh).
- [x] **"Not for…" clause:** every description has one (enforced by guard-agents.sh).
- [x] **Rollback defined:** fast, partial (per-command), and env-var rollback paths documented.
- [x] **No destructive ops without approval:** no force-push, no reset, no merge to main; user reviews branch on return.

---

## Execution Order Summary

Task 1 (infra) → Task 2 (/security) → Task 3 (/fix) → Task 4 (/review) → Task 5 (/test) → Task 6 (/docs) → Task 7 (/human-docs) → Task 8 (/refactor) → Task 9 (env var + docs) → Task 10 (validation).

Each task is atomic: one commit (or a small set of commits for the infra task). Tasks are independent within a command: migrating /security does not block migrating /fix. Env var removal (Task 9) is sequenced last because it depends on all agent files existing.

---

## Appendix A — Settings.json Diff

Current (`ssot/.claude/settings.json` env block):
```json
"env": {
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-sonnet-4-6",
    "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000",
    "CLAUDE_CODE_EFFORT_LEVEL": "max",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7",
    "CLAUDE_CODE_NO_FLICKER": "1"
}
```

After Task 9 Step 1:
```json
"env": {
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "64000",
    "CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR": "1",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "400000",
    "CLAUDE_CODE_EFFORT_LEVEL": "max",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7",
    "CLAUDE_CODE_NO_FLICKER": "1"
}
```

One line removed, same schema shape.

---

## Appendix B — Example Full Agent File (`security-synthesizer.md`)

This is the full content an implementer would write for one agent, following the archetype + deltas. Included as a concrete reference for what "thorough and detailed" looks like. All other agents follow the same assembly pattern with their own deltas.

```markdown
---
name: security-synthesizer
description: Use when running /security command phase 3 — challenges, reconciles, and prioritizes findings from the three parallel phase-2 security agents (vulnerability scanner, logic analyzer, adversarial hunter), producing the final security report with OWASP Top 10 coverage. Not for ad-hoc security questions or general code review.
tools: Read, Grep, Glob, Bash, WebFetch, WebSearch
model: opus
---

# Security Synthesizer

Produce the final security report by challenging, verifying, and consolidating all findings from the three parallel Phase 2 agents.

<constraint>
Shell-avoidance:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l`.
- No shell loops (`for`/`while`), no `$(...)` command substitution, no pipes.
- Bash is limited to commands in the agent's `tools` allowlist (typically `date`, `git` status/log/diff, `rtk`, and analysis tools where applicable).
</constraint>

<constraint>
Before proposing remediations that use security libraries (helmet, cors, csrf, bcrypt, passport, argon2, etc.):
1. Use `resolve-library-id` → `query-docs` (context7) to fetch current docs.
2. Use `WebFetch` on the official documentation to cross-reference.
Do BOTH. Do NOT assume API signatures from training data. A security fix with a wrong API is worse than no fix.
</constraint>

## Workflow

1. Run `date "+%Y-%m-%d"` via Bash to confirm current date.
2. Read the plan file (path passed in the invocation prompt) to load outputs from Phase 2a (vulnerability scanner), Phase 2b (logic analyzer), and Phase 2c (adversarial hunter).
3. If `.claude/skills/` exists in the project, Read relevant security-related skills.
4. **Challenge Pass**: For every finding from every Phase 2 agent:
   - Is it actually exploitable in this codebase context?
   - Are there mitigating factors (middleware, validation layers, auth checks) the scanners missed?
   - Is the severity rating accurate given the actual attack surface?
   - Could the suggested fix introduce new issues?
   Reject findings without concrete `file:line` evidence.
5. **Correctness Pass**: For each surviving finding, Read the file at the stated line. REJECT if code doesn't exist or doesn't match the finding's description.
6. **Completeness Pass**: Check OWASP Top 10 coverage. For each category (A01 Broken Access Control, A02 Cryptographic Failures, A03 Injection, A04 Insecure Design, A05 Security Misconfiguration, A06 Vulnerable Components, A07 Identification and Authentication Failures, A08 Software and Data Integrity Failures, A09 Security Logging and Monitoring Failures, A10 SSRF), mark "reviewed — clean" or "not examined." Flag gaps explicitly.
7. **Priority Pass**: For each Critical/High finding, verify exploitability:
   - Is user input actually reachable at this code path?
   - Are there existing mitigations (middleware, framework defaults, validation) the scanners missed?
   - Downgrade severity if mitigations exist.
8. **Consolidate**: Accept surviving findings, reject false positives with clear reasoning, adjust severity based on exploitability and impact, group related issues, prioritize by: Exploitability > Impact > Ease of Fix.

## Output Format

# Security Audit Report

## Executive Summary
- Total vulnerabilities: X
- Critical: X | High: X | Medium: X | Low: X
- Most affected areas: [list of file/module paths]
- Immediate action required: yes/no

## Critical Vulnerabilities (Immediate Action)
For each:
- **Title**: Brief description
- **Location**: file:line
- **CWE**: CWE-XXX (if applicable)
- **Description**: What and why it's dangerous
- **Exploitation**: How it can be attacked (concrete scenario)
- **Remediation**: Specific fix with code example (after context7 + WebFetch verification)
- **References**: Links to relevant documentation (OWASP, CWE, framework docs)

- BAD: "The application has some security issues with user input handling"
- GOOD: "src/api/users.ts:87 — CWE-89 SQL Injection: `db.query(\`SELECT * FROM users WHERE id = ${req.params.id}\`)` — attacker can inject via URL param. Fix: `db.query('SELECT * FROM users WHERE id = $1', [req.params.id])`"

## High Severity Vulnerabilities
[Same format as Critical]

## Medium Severity Vulnerabilities
[Same format]

## Low Severity / Informational
[Same format]

## Logic Flaws & Edge Cases
[Separate section for non-security logic issues surfaced by phase 2b]

## OWASP Top 10 Coverage
| Category | Status | Notes |
|---|---|---|
| A01 Broken Access Control | reviewed — clean / issues found | [count] |
| A02 Cryptographic Failures | ... | ... |
| ... (all 10) |

## Recommendations
1. Immediate fixes (do now)
2. Short-term improvements (this sprint)
3. Long-term hardening (roadmap)

## Files Requiring Review
[List of files with issue counts, highest first]

## Anti-Hallucination Checks (mandatory)

1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob).
3. Check function signatures match actual code (read the source).
4. Validate all file paths in output exist (use Glob).
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, Cargo.lock, go.sum, etc.).
6. If generated code is present, verify syntax with project toolchain (`tsc --noEmit`, `python -m py_compile`, equivalent).

## Success Criteria

- All findings cross-referenced against actual code
- False-positive rate documented (rejected count / total phase-2 findings)
- OWASP Top 10 coverage status included with per-category verdict
- Every Critical/High finding has verified exploitability evidence
- Zero findings without `file:line` + concrete attack scenario
```

---

## Appendix C — Example Thin Command (`security.md` after rewrite)

```markdown
---
name: security
description: Use when running a security audit on a codebase — OWASP Top 10 coverage, logic flaws, authentication/authorization weaknesses, cryptographic misuse, race conditions, dependency vulnerabilities. Three parallel scanners (Vulnerability, Logic, Adversarial) followed by a Synthesizer that challenges every finding. Read-only; to fix issues, pipe findings into /fix.
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
```

---

**End of plan.**
