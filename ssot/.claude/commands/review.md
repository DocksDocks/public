# Universal Code Review

Code review covering quality, security, and performance using a Builder-Verifier pattern.

> **Model Tiering:** All subagents use sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`). The orchestrator runs on Opus. Do NOT use haiku.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, WebFetch, WebSearch, Bash(date, ls, git status, git diff, rtk)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*, rtk:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is:
- Phase 4 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project stack, conventions, and target scope for code review.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack (check package.json, tsconfig.json, pyproject.toml, etc.)
- Find the files/directories to review (use $ARGUMENTS if provided, otherwise review recent changes or key modules)
- If `.claude/skills/` exists, read relevant project skills for domain-specific conventions
- Understand existing patterns, conventions, and architecture
- Note any existing linting/testing configurations

**Output Format:**
- Project stack summary with key file paths
- Target scope (files/directories to review)
- Existing conventions and patterns found

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Identified project stack, target scope, and existing patterns with file paths.
</task>
```

## Phase 2: Analyzer

```xml
<task>
Launch a Task agent as the ANALYZER:

**Objective:** Identify all concrete bugs, logic errors, security issues, and maintainability problems in the target code.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration results for project stack and conventions
- If project skills exist, check `.claude/skills/` for project-specific conventions

**Review categories:**

| Category | What to check |
|----------|--------------|
| Code Quality | SOLID violations, code smells, error handling gaps, type safety, naming |
| Security (OWASP Top 10) | Injection, broken auth, data exposure, misconfiguration, insecure deps |
| Performance | N+1 queries, memory leaks, blocking async, missing caching, bad algorithms |
| AI Slop | Verbose code, unnecessary abstractions, obvious comments, over-engineering |

**Output Format:**
Numbered list with per issue:
1. File and line location
2. Category and severity (critical / high / medium / low)
3. WHY it's a problem
4. Suggested fix

- BAD: "The auth module has some issues that should be addressed"
- GOOD: "src/auth/login.ts:42 — Critical/Security: `req.body.email` passed directly to SQL query without sanitization. Fix: use parameterized query `db.query('SELECT * FROM users WHERE email = $1', [email])`"

**Constraints:**
<constraint>
- Every issue must include file:line location and severity
- Suggest minimal, targeted fixes (not refactors)
</constraint>

**Success Criteria:**
Every finding includes file:line verified by reading actual file. Zero severity-less items.
</task>
```

## Phase 3: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the Analyzer's findings against the actual codebase, rejecting false positives.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Analyzer's numbered findings list as input

For each reported issue:
1. Read the file at the reported location — does the code actually exist there?
2. Is the issue real? Read surrounding context to confirm.
3. Is the severity rating accurate given the codebase context?
4. Is the suggested fix correct and safe?

Spot-check at least 5 file:line references to verify they exist.

**Output Format:**
## Verified Issues
[Issues confirmed as real with evidence]

## Rejected Issues (False Positives)
[Issues that are not real, with evidence from the code]

## Severity Adjustments
[Any issues where severity should change, with reasoning]

## Summary
- Total reported: X
- Verified: Y
- Rejected: Z
- Adjusted severity: W

**Constraints:**
**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Spot-checked 5+ file:line references. Zero unverified findings in final output.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Analyzer findings and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Analysis Results` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 4: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Verified findings
2. Files, lines, and proposed fixes

Plan Mode handles user approval. Once approved, proceed to Phase 5.

---

## Phase 5: Implementation

<constraint>
Before implementing fixes that use framework/library APIs: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Do NOT assume API signatures, method names, or config options from training data.
</constraint>

After approval:

1. Implement fixes starting with critical issues
2. Use Edit tool to make changes, preserving existing code style
3. Run existing tests/linters after changes if available
4. Track each change made for verification

## Phase 6: Post-Implementation Verification

### Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Review ALL changes made and catch any mistakes BEFORE presenting to the user.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

1. Run `git diff` to see exactly what was changed
2. For EACH change, verify against the actual source code:
   - Is this change correct? Does it match what the code actually does/needs?
   - Did we make assumptions without checking the real implementation?
   - Are there inconsistencies with other parts of the codebase?
   - Did we accidentally change something that was already correct?

3. Cross-reference changes with:
   - Actual route definitions (not just constants)
   - Real function signatures (not assumed)
   - Existing tests (do they still pass?)
   - Related files that might contradict our changes

4. For documentation changes specifically:
   - Verify URLs/paths against actual code
   - Check that examples match real implementations
   - Ensure no correct information was "corrected" incorrectly

**Output Format:**
## Verified Correct
[Changes that are accurate]

## ERRORS FOUND - Must Revert
[Changes that are wrong, with evidence from the codebase]

## Needs Manual Verification
[Changes that couldn't be verified automatically]

**Constraints:**
**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Every change verified against actual source code. Zero unverified modifications in final output.
</task>
```

After verification:
- Revert any incorrect changes immediately
- Report what was fixed vs what was reverted
- Only then present final summary to user

## Allowed Tools

```yaml
- Read
- Glob
- Grep
- Task
- WebFetch
- WebSearch
- Edit
- Write
- Bash(git:*)
- Bash(npm:*)
- Bash(pnpm:*)
- Bash(ls:*)
- Bash(rtk:*)
```

## Usage

```bash
# Review entire project
/review

# Review specific file or directory
/review src/api/

# Review specific file
/review src/utils/auth.ts
```
