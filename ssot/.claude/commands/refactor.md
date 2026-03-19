# Universal Refactorer

Detect and fix structural code issues: dead code, duplication, missing reuse opportunities, complexity, and modernization candidates. Uses tool-augmented analysis with parallel scanners and Builder-Verifier pattern.

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
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff, git log, wc -l, find, npx knip, npx depcheck)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(mkdir:*, git:*, npm:*, pnpm:*, yarn:*, rm:*)

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is Phase 5 (Present Plan + Exit Plan Mode).

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project for refactoring analysis — detect stack, available tools, test infrastructure, and scope.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Target scope: $ARGUMENTS (if empty, scan entire project)

**Steps:**
1. Identify the stack: languages, frameworks, package manager
2. Detect monorepo structure: check for workspaces (package.json workspaces, pnpm-workspace.yaml, lerna.json, Cargo workspace), list packages/apps
3. Detect available analysis tools:
   - JS/TS: check for `knip`, `depcheck`, `ts-prune` in node_modules/.bin/ or globally
   - Python: check for `vulture`, `ruff`
   - Go: check for `deadcode`
   - Rust: check for `cargo-udeps`
4. Check test infrastructure: test runner, test file patterns, how to run tests (per-package in monorepos)
5. Map directory structure with file counts per directory
6. If scoped ($ARGUMENTS provided): focus exploration on those files/dirs and their dependents
7. Check for existing linter configs (.eslintrc, .prettierrc, ruff.toml, etc.)
8. Read project CLAUDE.md and project skills (if `.claude/skills/` exists) for conventions

**Output:**
## Project Profile
- Stack: [languages, frameworks]
- Monorepo: [yes/no — if yes, list packages with their stack]
- Package manager: [npm/pnpm/yarn/pip/cargo/go]
- Analysis tools available: [list with paths]
- Test runner: [command to run tests, per-package if monorepo]
- Linter: [command to run linter]
- Scope: [targeted files/dirs or "full project"]

## File Map
[directory structure with file counts, focused on source dirs]

## Conventions
[key patterns from CLAUDE.md/project skills relevant to refactoring]

**Success Criteria:**
Stack identified. Test runner command verified. Available analysis tools listed with exact paths.
</task>
```

<constraint>
After Phase 1 completes, write the Explorer's output (Project Profile + File Map + Conventions) to the plan file under `## Phase 1: Exploration Results`. Then immediately launch Phase 2.
</constraint>

## Phase 2: Parallel Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently. Results will be combined by the Planner.

### Dead Code Scanner (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the DEAD CODE SCANNER:

**Objective:** Find dead code — unused exports, unreachable code, unused dependencies, orphaned files.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Explorer's project profile for stack and available tools
- Target scope from Explorer output

**Strategy — use tools first, then manual scan:**

1. **Tool-augmented scan** (if tools available):
   - JS/TS with knip: `npx knip --reporter compact` (unused files, exports, deps, types)
   - JS/TS with depcheck: `npx depcheck --json` (unused dependencies)
   - Python with vulture: `vulture <scope> --min-confidence 80`
   - Python with ruff: `ruff check --select F811,F841 <scope>` (unused imports/vars)
   - Go: `deadcode -test ./...`
   - If no tools available: proceed to manual scan only

2. **Manual scan** (always, complements tools):
   - Grep for exported functions/classes, cross-reference with import statements
   - Find files with zero inbound imports
   - Detect unreachable code after return/throw/break
   - Find commented-out code blocks (>3 lines)
   - Detect unused function parameters
   - Find TODO/FIXME markers referencing removed features

3. **Classify by safety tier:**
   - **SAFE**: unused utility functions, test helpers, internal modules with zero importers
   - **CAUTION**: components, API routes, middleware — check for dynamic imports (`import()`, `require()`, string-based references, public API membership)
   - **DANGER**: config files, entry points, type definitions, files referenced in build configs

**Output:**
## Tool Results
[raw tool output summary, if tools were available]

## Dead Code Findings
For each finding:
- `file:line` — exact location
- Category: unused export | unused dep | unreachable code | orphaned file | unused param | commented-out code
- Safety tier: SAFE | CAUTION | DANGER
- Evidence: [why it's dead — zero importers, unreachable after return, etc.]
- Dynamic import check: [for CAUTION items — did you grep for dynamic references?]

## Summary
- SAFE items: [count]
- CAUTION items: [count]
- DANGER items: [count]

<constraint>
- Every finding MUST include file:line reference
- CAUTION items MUST include dynamic import check results
- Do NOT flag items as dead code unless you verified zero references (grep for the symbol name)
- Do NOT flag test files, config files, or build scripts unless truly orphaned
</constraint>

**Success Criteria:**
Every finding includes file:line. CAUTION items have dynamic import check. Tool output included where tools were available.
</task>
```

### Duplication & Reuse Scanner (Opus)

```xml
<task>
Launch a Task agent with model="opus" as the DUPLICATION & REUSE SCANNER:

**Objective:** Find duplicate code, missing function extraction opportunities, and reuse candidates (including frontend component reuse).

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Explorer's project profile for stack and conventions
- Target scope from Explorer output

**Scan categories:**

1. **Exact and near-duplicate code blocks** (>5 lines, >80% similar):
   - Same logic with different variable names
   - Copy-pasted functions with minor parameter changes
   - Repeated error handling patterns
   - Duplicate validation logic

2. **Function extraction candidates:**
   - Methods >30 lines with identifiable sub-operations
   - Nested conditionals >3 levels deep
   - Repeated inline logic that could be a utility function
   - Long parameter lists (>4 params) suggesting missing data objects

3. **Frontend component reuse** (if applicable):
   - Similar UI patterns across components (buttons, forms, cards, modals, lists)
   - Duplicate styling/className patterns
   - Inline styles that should be shared components
   - Repeated state management patterns (same useState/useEffect combos)
   - Similar data fetching patterns that could be custom hooks

4. **Import/module organization:**
   - Circular dependencies
   - Barrel files re-exporting everything (tree-shaking killers)
   - Inconsistent import paths (relative vs alias)
   - Multiple files importing the same set of modules (suggests missing shared module)

5. **SOLID violations** (lightweight check — flag most impactful, not exhaustive):
   - **SRP**: classes/modules with >3 unrelated responsibilities (e.g., a service that handles auth, email, AND logging)
   - **OCP**: switch/if-else chains that must be modified for every new variant (candidate for strategy/registry pattern)
   - **ISP**: large interfaces/types forcing implementors to stub unused methods (frontend: component props with >10 optional props)
   - **DIP**: direct instantiation of dependencies instead of injection (e.g., `new DatabaseService()` inside business logic)
   - In monorepos: cross-package coupling — backend importing frontend types or vice versa, shared packages depending on app-specific code

6. **Modernization candidates:**
   - Callbacks that could be async/await
   - `var` usage (should be `const`/`let`)
   - Class components that could be function components (React)
   - Manual iteration that could use array methods (map, filter, reduce)
   - Deprecated API usage

**Output:**
## Duplicate Code
For each group:
- Locations: [file:line, file:line, ...]
- Pattern: [what the duplicate code does]
- Lines affected: [count across all instances]
- Suggested consolidation: [where to put the shared function/component]

## Extraction Candidates
For each:
- `file:line` — location
- Current length: [lines]
- Suggested extraction: [function name, what it does]
- Complexity reduction: [before → after nesting depth or line count]

## Component Reuse (Frontend)
For each:
- Similar components: [file:line, file:line, ...]
- Shared pattern: [what they have in common]
- Suggested shared component/hook: [name, props interface]

## Module Organization
For each issue:
- Type: circular dep | barrel bloat | inconsistent imports | missing shared module
- Files involved: [file:line, file:line, ...]
- Suggested fix: [one-line description]

## SOLID Violations
For each:
- `file:line` — location
- Principle: SRP | OCP | ISP | DIP | cross-package coupling
- Evidence: [concrete description — what responsibilities are mixed, what switch grows, etc.]
- Suggested refactoring: [pattern to apply — extract class, strategy pattern, dependency injection, etc.]
- Impact: high | medium | low

## Modernization
For each:
- `file:line` — location
- Current pattern: [what it uses now]
- Modern alternative: [what it should use]
- Migration risk: low | medium | high

<constraint>
- Every finding MUST include file:line references
- Duplicates must list ALL instances, not just two
- Component reuse suggestions must be grounded in actual codebase patterns, not aspirational
- Do NOT suggest modernization that changes behavior (e.g., sync → async changes return types)
</constraint>

**Success Criteria:**
Every finding includes file:line. Duplicate groups list all instances. Frontend reuse suggestions reference actual existing components.
</task>
```

<constraint>
After Phase 2 completes (both parallel agents return), append the Dead Code Scanner's findings and Duplication Scanner's findings to the plan file under `## Phase 2: Analysis Results`. Then immediately launch Phase 3 (Planner).
</constraint>

## Phase 3: Planner

```xml
<task>
Launch a Task agent with model="opus" as the PLANNER:

**Objective:** Prioritize findings and create a concrete, ordered refactoring plan.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Dead Code Scanner and Duplication Scanner results
- Use Explorer's project profile for test commands and conventions

**Prioritization framework:**

Tier 1 — **Quick Wins** (high impact, low risk):
- SAFE dead code removal (unused utilities, orphaned files)
- Unused dependency removal
- Commented-out code removal
- Simple modernization (var → const/let)

Tier 2 — **Consolidation** (high impact, medium risk):
- Duplicate code → shared function/component
- Function extraction from long methods
- Frontend component consolidation
- Custom hook extraction from repeated patterns
- OCP violations → strategy/registry pattern (when switch has >3 cases)
- ISP violations → split large interfaces

Tier 3 — **Structural** (medium impact, higher risk):
- Module reorganization (circular deps, barrel files)
- CAUTION dead code removal (with dynamic import verification)
- Complex modernization (callbacks → async/await)
- SRP violations → extract class/module
- DIP violations → introduce dependency injection
- Cross-package coupling in monorepos → move to shared package or invert dependency

**For each planned refactoring, specify:**
1. Priority tier (1/2/3)
2. Category: dead-code | duplicate | extraction | component-reuse | module-reorg | modernization | solid-violation
3. Files affected: [file:line for each]
4. What changes: [before → after description]
5. Risk: low | medium | high
6. Test strategy: [which tests to run after this change]
7. Revert trigger: [what failure means we should undo this]
8. Dependencies: [which other refactorings must happen first, if any]

**Ordering rules:**
- Tier 1 before Tier 2 before Tier 3
- Within a tier: independent changes before dependent ones
- Dead code removal before duplication fixes (removing dead code may eliminate some duplicates)
- Group changes by file where possible (fewer context switches)

<constraint>
- MINIMAL changes only — refactor the specific issue, do NOT "improve" surrounding code
- Do NOT combine refactoring with feature changes or behavior modifications
- Every refactoring must preserve existing behavior exactly
- If a refactoring requires new tests (characterization tests), list them explicitly
- Skip any finding where the evidence is weak or the benefit is marginal
</constraint>

**Output:**
## Refactoring Plan

### Tier 1: Quick Wins
[numbered list of refactorings with all 8 fields]

### Tier 2: Consolidation
[numbered list of refactorings with all 8 fields]

### Tier 3: Structural
[numbered list of refactorings with all 8 fields]

## Estimated Impact
- Files modified: [count]
- Lines removed: [estimate]
- Duplicates eliminated: [count]
- New shared functions/components: [count]

## Skipped Findings
[items from scanners that were excluded, with reason]

**Success Criteria:**
Every refactoring includes all 8 specification fields. Ordering respects dependencies. No refactoring changes behavior.
</task>
```

## Phase 4: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the Planner's refactoring plan against accuracy, safety, and completeness.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Planner's complete output

**Checks:**

**Reference Accuracy:**
- Spot-check at least 5 file:line references — do they actually exist?
- For dead code findings: verify the symbol truly has zero references (grep for it)
- For duplicates: read both instances — are they actually similar?
- For extraction candidates: is the method actually that long?

**Safety Verification:**
- For CAUTION dead code: verify dynamic import check was thorough
- For any change touching exports: verify no external consumers exist
- For frontend component consolidation: verify the components are truly interchangeable
- For modernization: verify the change preserves return types and error semantics

**Dependency Ordering:**
- Are dependencies between refactorings correctly identified?
- Would any Tier 1 change break a Tier 2 change?
- Are file-grouped changes safe to apply sequentially?

**Completeness:**
- Were any high-impact scanner findings skipped without justification?
- Are test strategies realistic (does the test command actually work)?

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)

**Output:**
## Reference Accuracy
[spot-check results: file:line → actual content match]

## Safety Verification
[per-change safety assessment]

## Dependency Ordering
[verified or issues found]

## Issues to Fix
[prioritized list — MUST FIX vs SHOULD FIX vs MINOR]

**Success Criteria:**
Spot-checked 5+ file:line references. All CAUTION items verified. Zero unverified dead code in approved list.
</task>
```

<constraint>
After the Verifier produces its results, append the Planner output and Verifier results to the plan file under `## Phase 4: Refactoring Plan`. The plan file should now contain Phase 1, Phase 2, and Phase 4 results. This is mandatory — implementation reads from this file.
</constraint>

## Phase 5: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Refactorings by tier with files and changes
2. Estimated impact (files modified, lines removed, duplicates eliminated)
3. Skipped findings with reasons

Plan Mode handles user approval. Once approved, proceed to Phase 6.

---

## Phase 6: Implementation

After approval:

1. Run the full test suite first — establish baseline (if tests fail before refactoring, note which tests and proceed carefully)
2. For each refactoring in tier order:
   a. If the refactoring requires characterization tests: write them first, verify they pass
   b. Make the change (Edit tool for modifications, Bash(rm) for file deletions)
   c. Run the test suite — if tests fail:
      - Revert the change immediately
      - Log it as "REVERTED: [reason]"
      - Continue to the next refactoring
   d. Run the linter — fix any linter issues introduced
   e. Log as "APPLIED: [description]"
3. After all refactorings applied: run the full test suite one final time
4. Track all changes for the Post-Implementation Verifier

<constraint>
- ONE refactoring at a time — never batch multiple changes before testing
- REVERT immediately on test failure — do not try to "fix" the refactoring
- Do NOT refactor surrounding code beyond the planned change
- Preserve all existing comments, unless they describe removed dead code
</constraint>

## Phase 7: Post-Implementation Verifier

```xml
<task>
Launch a Task agent as the POST-IMPLEMENTATION VERIFIER:

**Objective:** Verify all applied refactorings are correct and no regressions were introduced.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Run `git diff` to see all changes made

**Verification steps:**
1. Review each applied change against the plan — does it match what was approved?
2. For dead code removals: verify the removed code is truly gone and no dangling references remain
3. For duplicate consolidation: verify all call sites were updated to use the shared function
4. For component reuse: verify all instances use the new shared component with correct props
5. For extractions: verify the extracted function is called from the original location
6. Run the test suite — all tests must pass
7. Run the linter — no new warnings
8. Run the type checker if available (tsc --noEmit, mypy, etc.)

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Output:**
## Verified Correct
[list of changes that pass all checks]

## ERRORS FOUND - Must Revert
[list of changes with specific issues — revert these immediately]

## Summary
- Refactorings applied: [count]
- Refactorings reverted: [count]
- Lines removed: [from git diff --stat]
- Files modified: [count]
- Files deleted: [count]
- Test suite: PASS / FAIL
- Linter: PASS / FAIL

**Success Criteria:**
All applied changes verified against plan. Test suite passes. No dangling references from dead code removal.
</task>
```

After verification:
- Revert any incorrect changes immediately
- Report applied vs reverted refactorings
- Only then present final summary to user

---

## Allowed Tools

```yaml
Planning Phase:
- Read
- Glob
- Grep
- Task
- Bash(date)
- Bash(ls:*)
- Bash(find:*)
- Bash(wc:*)
- Bash(git log:*)
- Bash(git status)
- Bash(git diff:*)
- Bash(npx knip:*)
- Bash(npx depcheck:*)
- Bash(vulture:*)
- Bash(ruff:*)
- Bash(deadcode:*)

Implementation Phase:
- Read
- Edit
- Write
- Bash(git:*)
- Bash(npm:*)
- Bash(pnpm:*)
- Bash(yarn:*)
- Bash(pip:*)
- Bash(cargo:*)
- Bash(rm:*)
- Bash(mkdir:*)
```

## Usage

```bash
/refactor                    # Full project scan
/refactor src/utils/         # Scan specific directory
/refactor src/components/    # Find component reuse opportunities
/refactor src/api/routes.ts  # Scan specific file
```
