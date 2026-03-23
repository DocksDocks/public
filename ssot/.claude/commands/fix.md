# Universal Fixer

Fix issues in code: bugs, security vulnerabilities, performance problems, dependencies, and dead code. Uses Builder-Verifier pattern to ensure safe, effective fixes.

> **Model Tiering:** Subagents default to `sonnet` (via CLAUDE_CODE_SUBAGENT_MODEL).
> Only set `model: "opus"` for quality-critical agents (analyzers, planners, builders, generators).
> Explorers, scanners, verifiers, and synthesizers use the default. Do NOT use haiku.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff, npm audit)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*, pip:*, rm:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY times you stop and wait for user input are:
- Phase 6 (ExitPlanMode gate)

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project stack, identify target scope, and locate existing issues.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and package manager
- Find the target scope (use $ARGUMENTS if provided)
- If `.claude/skills/` exists, read relevant project skills for domain-specific conventions
- Check for existing issues: failing tests, linter errors, security advisories
- Understand the codebase structure and conventions
- Identify test coverage and CI/CD setup

**Output Format:**
- Project stack and package manager
- Target files/directories
- Existing issues found
- Test/CI configuration

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Identified project stack, target scope, and existing patterns with file paths.
</task>
```

## Phase 2: Reproduction (conditional)

Skip if $ARGUMENTS is empty or a directory path. Only run when a specific bug/issue is described.

```xml
<task>
Launch a Task agent as the REPRODUCER:

**Objective:** Confirm the reported issue exists by reproducing it.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use $ARGUMENTS for the bug description
- Use exploration output for project stack and test setup

**Output Format:**
- Status: REPRODUCED | NOT REPRODUCED | UNABLE TO TEST
- Steps taken to reproduce
- Error output or behavior observed
- Minimal reproduction case if possible

**Constraints:**
- Use existing test infrastructure if available
- Do NOT modify any code during reproduction

**Success Criteria:**
Issue confirmed with concrete evidence (error output, failing test) OR confirmed not reproducible with evidence of attempts.
</task>
```

## Phase 3: Issue Discovery

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently and their results will be combined by the Planner.

### Code Quality Scanner

```xml
<task>
Launch a Task agent with model="opus" as the CODE QUALITY SCANNER:

**Objective:** Scan the target code for bugs, dead code, refactoring opportunities, and performance issues.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration output for project conventions and scope

**Bugs**
- Logic errors, off-by-one, null/undefined handling
- Race conditions, async/await misuse
- Incorrect type coercion, comparison errors
- Missing error handling, unhandled promise rejections

**Dead Code**
- Unused exports, functions, variables, types
- Unreachable code paths
- Commented-out code blocks
- Deprecated code marked for removal

**Refactoring Opportunities**
- Duplicated code that should be extracted
- Complex functions that need decomposition
- Outdated patterns that should be modernized
- Type improvements (any → specific types)

**Performance**
- Obvious bottlenecks (N+1 queries, missing memoization)
- Memory leaks (event listeners, subscriptions)
- Unnecessary re-renders, computations

Output a prioritized list of issues with locations and suggested fixes.

**Success Criteria:**
Every finding includes file:line and concrete evidence. Prioritized list with severity levels.
</task>
```

### Dependency Scanner

```xml
<task>
Launch a Task agent as the DEPENDENCY SCANNER:

**Objective:** Scan project dependencies for security vulnerabilities, outdated packages, and unused dependencies.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration output for package manager and lockfile locations

**Security Vulnerabilities**
- Run `npm audit` or equivalent to find known vulnerabilities
- Check for packages with published CVEs
- Identify transitive dependency risks

**Outdated Packages**
- Check for outdated packages with security patches
- Identify packages multiple major versions behind
- Note packages with active deprecation notices

**Unused Dependencies**
- Identify dependencies listed in package.json but not imported
- Find devDependencies that are never used in scripts or config
- Check for duplicate packages providing same functionality

**Missing Peer Dependencies**
- Find missing peer dependency warnings
- Identify version conflicts between peer dependencies

Output a prioritized list of dependency issues with recommended actions.

**Success Criteria:**
Every dependency issue includes package name, current version, and recommended action. Audit command output included.
</task>
```

<constraint>
After Phase 3 completes (both parallel scanners return), write both scanners' findings to the plan file under `## Phase 3: Scanner Results`. Then immediately launch Phase 4 (Planner).
</constraint>

## Phase 4: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

**Objective:** Propose a specific, minimal fix for each issue identified by the scanners.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use scanner findings from Phase 3

You are the PLANNER. For each identified issue, propose a specific fix.

<constraint>
- MINIMAL, TARGETED fixes only — fix the bug, not the whole function
- Every fix must include file:line location and exact code changes
- Before proposing fixes that use framework/library APIs: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Do NOT assume API signatures, method names, or config options from training data.
- Do NOT refactor surrounding code or reorganize files
</constraint>

For each fix provide:

| Field | Content |
|-------|---------|
| Issue | What's wrong (file:line) |
| Root Cause | Why this happened |
| Proposed Fix | Exact code changes |
| Testing | How to verify the fix works |
| Risk Level | low / medium / high |

Output numbered list of proposed fixes.

- BAD: "Fix the authentication issue by updating the auth module"
- GOOD: "src/auth/session.ts:34 — Root Cause: `expires` set to `Date.now()` (instant expiry) instead of `Date.now() + 3600000`. Fix: change line 34 to `expires: Date.now() + SESSION_TTL_MS`. Test: verify session persists after login."

**Success Criteria:**
Every fix includes file:line, before/after code, and test approach. No fix exceeds the scope of its issue.
</task>
```

## Phase 5: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each proposed fix against the actual codebase, checking correctness and blast radius.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Planner's proposed fixes as input

You are the VERIFIER. Validate each proposed fix against the actual codebase.

For each proposed fix:
1. Read the file at the reported location — does the issue actually exist?
2. Read the surrounding code — will the fix break any callers or dependents?
3. Search for usages of the function/class being changed to assess blast radius
4. Is the risk level accurate? (1 file, no callers = low; shared utility = higher)
5. Is the proposed code change syntactically and logically correct?

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

Output:
## Approved Fixes
[Fixes confirmed as correct and safe]

## Modified Fixes
[Fixes that need adjustments, with specific changes needed]

## Rejected Fixes
[Fixes that are wrong or too risky, with evidence]

## Risk Assessment
- Low risk fixes: X
- Medium risk fixes: Y
- High risk fixes: Z

**Success Criteria:**
Spot-checked 5+ file:line references. Zero unverified fixes in approved list.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Planner output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Fix Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 6: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Proposed fixes organized by risk level
2. Files, lines, and code changes

Plan Mode handles user approval. Once approved, proceed to Phase 7.

---

## Phase 7: Implementation

After approval:

1. Implement fixes in the specified order
2. After each fix:
   - Run tests if available (`npm test`, `pytest`, etc.)
   - Run linter if available
   - Verify the fix doesn't break anything
3. If a fix causes issues, revert and report
4. Track each change made for verification

## Phase 8: Post-Implementation Verifier

### Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Verify ALL changes made are correct and nothing was broken.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

You are the VERIFIER. Your job is to review ALL changes made and catch any mistakes BEFORE presenting to the user.

1. Run `git diff` to see exactly what was changed
2. For EACH change, verify against the actual source code:
   - Is this fix correct? Does it solve the actual problem?
   - Did we break any existing functionality?
   - Are there side effects we didn't anticipate?
   - Did we make assumptions that turned out to be wrong?

3. Run verification checks:
   - Do all tests still pass?
   - Does the linter pass?
   - Do type checks pass?
   - Does the application still build?

4. Cross-reference fixes with:
   - The original issue (did we actually fix it?)
   - Related code (did we miss updating dependent code?)
   - Tests (do they cover the fix?)

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Output:**
## Verified Correct
[Fixes that are working correctly]

## ERRORS FOUND - Must Revert
[Changes that broke something or are incorrect, with evidence]

## Tests Status
[Pass/Fail status of test suite]

## Needs Manual Verification
[Changes that require user testing]

**Success Criteria:**
Every change verified against actual source code. Test suite passes. Zero unverified modifications.
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
- Edit
- Write
- Bash(git:*)
- Bash(npm:*)
- Bash(pnpm:*)
- Bash(yarn:*)
- Bash(pip:*)
- Bash(ls:*)
- Bash(rm:*)  # For removing dead code files
```

## Usage

```bash
# Fix issues in entire project
/fix

# Fix issues in specific directory
/fix src/api/

# Fix specific type of issue
/fix dependencies
/fix bugs
/fix dead-code
```
