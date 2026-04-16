---
name: refactor
description: Use when auditing a codebase for structural issues — dead code, duplication, SOLID violations (all 5 principles including Liskov), missing abstractions, modernization candidates. Generates a tiered refactoring plan (quick wins → consolidation → structural) with per-change test strategy and revert triggers. Full-project scan by default; accepts a path argument to scope.
allowed-tools: >-
  Read Grep Glob Task WebFetch WebSearch Edit Write
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

Detect and fix structural code issues: dead code, duplication, missing reuse opportunities, SOLID violations across all 5 principles (including Liskov), complexity, and modernization candidates. Uses tool-augmented analysis with parallel scanners, a dedicated SOLID Analyzer phase, and Builder-Verifier pattern.

> **Model Tiering:** All subagents use sonnet (via `CLAUDE_CODE_SUBAGENT_MODEL=claude-sonnet-4-6`). The orchestrator runs on Opus. Do NOT use haiku.

---

<constraint>
If not already in Plan Mode, call `EnterPlanMode` NOW before doing anything else. All phases are read-only until the user approves the plan.
</constraint>

---

<constraint>
Phase Transition Protocol — Orchestrator Behavior:

Between phases, do NOT stop to summarize, analyze, or present intermediate results to the user. Process each phase's output, write it to the plan file, and IMMEDIATELY launch the next Task agent in the same turn. Do not end your turn between phases.

The ONLY time you stop and wait for user input is Phase 6 (Present Plan + Exit Plan Mode).

If auto-compaction triggers between phases, re-read the plan file to recover prior phase results, then continue with the next phase.
</constraint>

---

<constraint>
Shell-avoidance — apply in EVERY phase:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes — each subcommand re-triggers permission prompts even when the allow-list would cover individual commands.

Bash is only for commands with no tool equivalent (`date`, `git log`, `git status`, `git diff`, `git rm`, `git add`, `git restore`, `mkdir`, `rtk`, test runners, analysis tools, type checkers, linters).
</constraint>

## Phase 1: Exploration

```xml
<task>
Launch a Task agent as the EXPLORER:

**Objective:** Map the project for refactoring analysis — detect stack, available tools, test infrastructure, existing abstractions, dependency-injection patterns, and scope.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Target scope: $ARGUMENTS (if empty, scan entire project)

**Steps:**
1. Identify the stack: languages, frameworks, package manager.
2. Detect monorepo structure via Glob: check for `package.json` workspaces, `pnpm-workspace.yaml`, `lerna.json`, Cargo workspace; list packages/apps.
3. Detect available analysis tools (use Glob + Read on package.json/lockfiles):
   - JS/TS: `knip`, `depcheck`, `ts-prune` in node_modules/.bin/ or globally
   - Python: `vulture`, `ruff`
   - Go: `deadcode`
   - Rust: `cargo-udeps`
4. Check test infrastructure: test runner, test file patterns, commands to run tests (per-package in monorepos).
5. Map directory structure with file counts per source directory (use Glob, count in-agent — do NOT shell-pipe through `wc -l`).
6. If scoped ($ARGUMENTS provided): focus exploration on those files/dirs and their dependents.
7. Check for existing linter configs via Glob: `.eslintrc*`, `.prettierrc*`, `ruff.toml`, `pyproject.toml`, etc.
8. Read project CLAUDE.md and project skills (if `.claude/skills/` exists) for conventions.
9. **Detect existing abstractions and DI patterns:**
   - Interfaces, type aliases, abstract classes, Python protocols
   - Class hierarchies (grep for `extends` / `class X(Y)` / `implements`, surface base classes with >1 descendant)
   - Dependency-injection patterns: constructor injection, DI containers (NestJS, InversifyJS, Symfony DI, Spring), factory-function injection, service registries
   - Note any IoC frameworks present and their conventions

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.
</constraint>

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

## Existing Abstractions
- Interfaces / type aliases / abstract classes / protocols (file:line)
- Class hierarchies (base class → descendants, file:line per descendant)
- Dependency-injection patterns (framework, convention, file:line of representative usage)

## Conventions
[key patterns from CLAUDE.md / project skills relevant to refactoring]

**Success Criteria:**
Stack identified. Test runner command verified. Available analysis tools listed with exact paths. DI patterns and existing abstractions catalogued with file:line references.
</task>
```

<constraint>
After Phase 1 completes, write the Explorer's output (Project Profile + File Map + Existing Abstractions + Conventions) to the plan file under `## Phase 1: Exploration Results`. Then immediately launch Phase 2.
</constraint>

## Phase 2: Parallel Analysis

<constraint>
Launch BOTH agents below in a SINGLE tool-call turn. Do NOT wait for one to finish before launching the next.
</constraint>

Each agent runs independently. Results will be combined by the Planner in Phase 4 (after the sequential SOLID Analyzer in Phase 3).

### Dead Code Scanner

```xml
<task>
Launch a Task agent as the DEAD CODE SCANNER:

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
   - Find files with zero inbound imports (Glob all source files, Grep for each file's basename as import)
   - Detect unreachable code after return/throw/break
   - Find commented-out code blocks (>3 lines)
   - Detect unused function parameters
   - Find TODO/FIXME markers referencing removed features

3. **Classify by safety tier:**
   - **SAFE**: unused utility functions, test helpers, internal modules with zero importers
   - **CAUTION**: components, API routes, middleware — check for dynamic imports (`import()`, `require()`, string-based references, public API membership)
   - **DANGER**: config files, entry points, type definitions, files referenced in build configs

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is only for the analysis tool commands listed in step 1.
</constraint>

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

- BAD: "There are some unused functions that could be removed"
- GOOD: "src/utils/format.ts:45 — `formatCurrency()` — SAFE — zero importers (grep: 0 matches across src/), last modified 8 months ago"

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

### Duplication & Reuse Scanner

```xml
<task>
Launch a Task agent as the DUPLICATION & REUSE SCANNER:

**Objective:** Find duplicate code, missing function extraction opportunities, and reuse candidates (including frontend component reuse). SOLID violations are handled by the dedicated Phase 3 SOLID Analyzer — do NOT flag SOLID violations here.

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

5. **Modernization candidates:**
   - Callbacks that could be async/await
   - `var` usage (should be `const`/`let`)
   - Class components that could be function components (React)
   - Manual iteration that could use array methods (map, filter, reduce)
   - Deprecated API usage

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is not needed in this scanner.
</constraint>

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
- Do NOT flag SOLID violations — that is Phase 3's responsibility
</constraint>

**Success Criteria:**
Every finding includes file:line. Duplicate groups list all instances. Frontend reuse suggestions reference actual existing components. No SOLID violations flagged (those are Phase 3's job).
</task>
```

<constraint>
After Phase 2 completes (both parallel agents return), append the Dead Code Scanner's findings and Duplication Scanner's findings to the plan file under `## Phase 2: Scanner Results`. Then immediately launch Phase 3 (SOLID Analyzer).
</constraint>

## Phase 3: SOLID Analyzer

Runs sequentially after the parallel scanners in Phase 2. Single agent. Does its own component inventory first (absorbs the role of `/solid`'s old Discovery phase), then evaluates each surviving component against all 5 SOLID principles including Liskov.

```xml
<task>
Launch a Task agent as the SOLID ANALYZER:

**Objective:** Deep per-principle analysis of surviving code (excluding files that Phase 2's Dead Code Scanner classified as **SAFE** for deletion). Covers all 5 SOLID principles including Liskov.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Explorer's **Existing Abstractions** section (DI patterns, interfaces, class hierarchies)
- Use the Dead Code Scanner's safety-tier output — files classified **SAFE** are about to be deleted. Analyzer must skip these files (no analysis value for code about to go)
- Use the Duplication Scanner's full output for cross-reference (some duplications have SOLID causes)

**Steps:**

1. **Component inventory** (absorbs `/solid` Phase 2 Discovery). Use Glob + Grep to catalog:
   - Classes and modules (service, repository, controller, factory classes) — with `file:line` per class
   - Interfaces, type aliases, abstract classes, Python protocols — with `file:line`
   - Standalone and factory functions (top-level, exported) — with `file:line`
   - Import relationships + DI setup + service containers/registries
   - **Exclude** any file the Dead Code Scanner classified as **SAFE** for deletion

2. **Analysis priority ordering** (from `/solid` Phase 2): order the inventory by complexity/importance before per-principle evaluation, so the most impactful components are analyzed first if context budget runs short. Heuristics:
   - Higher priority: classes with >200 lines, classes with >10 methods, classes with the most inbound imports (hot paths), abstract base classes with many descendants
   - Lower priority: small utility modules, leaf components, pure data types

3. **Per-principle evaluation** — for each component (in priority order), evaluate against all 5 principles. Evidence requirements below apply to every violation.

   - **S (SRP) — Single Responsibility Principle**
     Signs: multiple unrelated responsibilities, >3 reasons to change, "and" in class/module names, god classes (>300 lines doing unrelated work).
     Example violation: "src/services/UserService.ts:1-350 — handles auth (login/logout/token), profile CRUD, email notifications, and billing. 4 reasons to change, 12 dependencies."

   - **O (OCP) — Open/Closed Principle**
     Signs: switch/if-else chains that must be modified for every new variant; hardcoded type checks; enum-based dispatch that grows.
     Example violation: "src/pricing/calculator.ts:45-120 — switch on `plan.type` with 7 cases; each new plan requires modifying this function."

   - **L (LSP) — Liskov Substitution Principle**
     Signs: subclasses throwing unexpected exceptions; overridden methods that break parent contracts; `instanceof` checks that gate behavior per subclass; conditional return-type narrowing.
     Example violation: "src/shapes/Square.ts:12 — extends Rectangle but overrides `setWidth()` to also set height, breaking the Rectangle contract that width and height are independent."

   - **I (ISP) — Interface Segregation Principle**
     Signs: large interfaces forcing unused method stubs; "not supported" throws; frontend: component props with >10 optional fields mixing concerns.
     Example violation: "src/repos/IRepo.ts:1-40 — 14 methods; `UserRepo` throws `NotImplementedError` on `archive()`, `restore()`, `purge()` — they don't apply."

   - **D (DIP) — Dependency Inversion Principle**
     Signs: direct instantiation of concrete dependencies in business logic (`new ConcreteClass()`); direct imports of implementations instead of abstractions; hidden coupling to singletons.
     Example violation: "src/orders/processor.ts:34 — `new StripeClient(config)` inside `processOrder()`; business logic cannot be tested without Stripe."

4. **Monorepo cross-package check** (only if monorepo detected in Phase 1):
   - Cross-package coupling: backend importing frontend types, shared packages depending on app-specific code, cross-app imports that should go through a shared package
   - Report each as a `solid-violation` with a synthetic principle code `X` (cross-cutting, not strictly S/O/L/I/D) and an explanation

5. **Pattern suggestion** — for each violation, name a concrete refactoring pattern: Strategy, Factory, Adapter, Extract Class, Split Interface, Dependency Injection, Composition over Inheritance, etc.

<constraint>
Before suggesting framework-specific refactoring patterns (e.g., NestJS DI tokens, React Context for DI, Spring annotations): FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Do NOT assume API signatures, method names, or config options from training data.
</constraint>

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is only for `date` — context7 tools (`resolve-library-id`, `query-docs`) and `WebFetch` are invoked directly, not via Bash.
</constraint>

**Output:**

## Component Inventory
- [file:line] Type: class | interface | abstract | protocol | fn-factory — Name — Purpose (1 line)
- [file:line] ...

## Analysis Priority
[ordered list: highest-impact components first]

## SOLID Violations

### Critical Violations (Must Fix)
For each:
- `file:line`
- Principle: S | O | L | I | D | X (cross-package coupling)
- Evidence: [concrete, quote offending code if short]
- Impact: high
- Suggested pattern: [Strategy / Factory / Extract Class / DI / Split Interface / Adapter / Composition-over-Inheritance / etc.]
- Risk tier for Planner: low | medium | high

### High Priority Violations
[same fields, impact = high or medium]

### Medium Priority Violations
[same fields, impact = medium]

### Low Priority / Suggestions
[same fields, impact = low]

## Summary
- Violations found: [count by principle — S: X, O: Y, L: Z, I: W, D: V, X: U]
- Files affected: [unique file count]

<constraint>
- Every violation MUST include `file:line` and concrete evidence (not "looks like SRP violation" — name the multiple responsibilities).
- Files the Dead Code Scanner classified as **SAFE** MUST be skipped entirely.
- Prefer composition over inheritance for L and I violations.
- Do NOT duplicate findings from the Duplication Scanner (e.g., if the Duplication Scanner already flagged a module-reorg issue, do not re-flag it as a DIP violation unless it's a distinct concern).
</constraint>

**Success Criteria:**
Component inventory produced with file:line per component. Priority ordering applied. All 5 principles (plus monorepo cross-package check if applicable) evaluated. Every violation has file:line, principle, evidence, impact, pattern, risk tier. Context7 consulted for any framework-specific pattern suggestions. Files classified **SAFE** by the Dead Code Scanner skipped.
</task>
```

<constraint>
After Phase 3 completes, append the SOLID Analyzer's output to the plan file under `## Phase 3: SOLID Analysis Results`. Then immediately launch Phase 4 (Planner).
</constraint>

## Phase 4: Planner

```xml
<task>
Launch a Task agent as the PLANNER:

**Objective:** Prioritize findings and create a concrete, ordered refactoring plan that merges three input streams: dead code, duplication/reuse/modernization, and SOLID violations.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Dead Code Scanner + Duplication Scanner + SOLID Analyzer results
- Use Explorer's project profile for test commands and conventions

<constraint>
Before proposing refactorings that use framework/library APIs: FIRST use `resolve-library-id` → `query-docs` (context7) to fetch current docs, THEN use `WebFetch` on official documentation to cross-reference. Do BOTH — not just one. Do NOT assume API signatures, method names, or config options from training data.
</constraint>

<constraint>
Prefer composition over inheritance for Liskov (L) and Interface Segregation (I) violations. Avoid introducing deep inheritance hierarchies to fix abstraction problems.
</constraint>

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
- **SOLID:** OCP violations → Strategy/registry pattern (when switch has >3 cases)
- **SOLID:** ISP violations → split large interfaces
- **SOLID:** monorepo cross-package coupling fixes (contained scope)

Tier 3 — **Structural** (medium impact, higher risk):
- Module reorganization (circular deps, barrel files)
- CAUTION dead code removal (with dynamic import verification)
- Complex modernization (callbacks → async/await)
- **SOLID:** SRP violations → Extract Class/Module
- **SOLID:** DIP violations → Dependency Injection
- **SOLID:** LSP violations → fix inheritance hierarchy (prefer composition)

**For each planned refactoring, specify ALL 9 fields:**
1. **Priority tier** (1/2/3)
2. **Category**: dead-code | duplicate | extraction | component-reuse | module-reorg | modernization | solid-violation
3. **Files affected**: [file:line for each]
4. **What changes**: [before → after description]
5. **Risk**: low | medium | high
6. **Test strategy**: [which tests to run after this change]
7. **Revert trigger**: [what failure means we should undo this]
8. **Dependencies**: [which other refactorings must happen first, if any]
9. **Pattern**: for `solid-violation` entries — Strategy / Factory / Extract Class / Split Interface / Dependency Injection / Composition-over-Inheritance / Adapter / etc. For other categories, use `—` (not applicable).

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
- For SOLID fixes: the fix must be simpler than the violation it resolves — if it's not, skip and note in Skipped Findings
</constraint>

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.
</constraint>

**Output:**
## Refactoring Plan

### Tier 1: Quick Wins
[numbered list of refactorings, each with all 9 fields]

### Tier 2: Consolidation
[numbered list of refactorings, each with all 9 fields]

### Tier 3: Structural
[numbered list of refactorings, each with all 9 fields]

## Estimated Impact
- Files modified: [count]
- Lines removed: [estimate]
- Duplicates eliminated: [count]
- SOLID violations resolved: [count by principle]
- New shared functions/components: [count]

## Skipped Findings
[items from scanners / SOLID Analyzer that were excluded, with reason — include over-engineering skips here]

**Success Criteria:**
Every refactoring includes all 9 fields (Pattern populated for every `solid-violation` entry, `—` for others). Ordering respects dependencies. No refactoring changes behavior. Skipped findings have explicit rationale.
</task>
```

<constraint>
After Phase 4 completes, append the Planner's output to the plan file under `## Phase 4: Refactoring Plan`. Then immediately launch Phase 5 (Verifier).
</constraint>

## Phase 5: Verifier (Pre-Implementation)

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate the Planner's refactoring plan against accuracy, safety, dependency ordering, completeness, and over-engineering.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Planner's complete output

**Checks:**

**Reference Accuracy:**
- Spot-check at least 5 file:line references — do they actually exist? (Use Read.)
- For dead code findings: verify the symbol truly has zero references (Grep for it)
- For duplicates: read both instances — are they actually similar?
- For extraction candidates: is the method actually that long?
- For SOLID violations: read the file at the reported location — does the described pattern exist?

**Safety Verification:**
- For CAUTION dead code: verify dynamic import check was thorough
- For any change touching exports: verify no external consumers exist
- For frontend component consolidation: verify the components are truly interchangeable
- For modernization: verify the change preserves return types and error semantics
- For SOLID refactorings: verify the proposed pattern preserves existing behavior

**Dependency Ordering:**
- Are dependencies between refactorings correctly identified?
- Would any Tier 1 change break a Tier 2 change?
- Are file-grouped changes safe to apply sequentially?

**Completeness:**
- Were any high-impact scanner / SOLID findings skipped without justification?
- Are test strategies realistic (does the test command actually work)?

**Over-Engineering Check** (for every `solid-violation` Planner entry):
- Is the proposed refactoring simpler than the problem it solves?
- Does the Pattern choice match the violation's scope? (e.g., don't apply Strategy pattern to a 2-case switch)
- Would a minimal in-place fix work instead of the proposed structural change?
- Reject any refactoring whose complexity cost exceeds the violation's actual impact.

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.
</constraint>

**Output:**
## Reference Accuracy
[spot-check results: file:line → actual content match]

## Safety Verification
[per-change safety assessment]

## Dependency Ordering
[verified or issues found]

## Over-Engineering Check
[per `solid-violation` entry: APPROVED | REJECTED with reason | MODIFIED with suggested simplification]

## Issues to Fix
[prioritized list — MUST FIX vs SHOULD FIX vs MINOR]

**Success Criteria:**
Spot-checked 5+ file:line references. All CAUTION items verified. Every `solid-violation` entry passed the over-engineering check. Zero unverified dead code in approved list.
</task>
```

<constraint>
After the Verifier produces its results, append the Verifier's results to the plan file under `## Phase 5: Verifier Results`. The plan file should now contain Phase 1 through Phase 5 results as distinct sections (Phase 4 already wrote the Refactoring Plan). This is mandatory — implementation reads from this file.
</constraint>

## Phase 6: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Refactorings organized by tier (1, 2, 3) with file:line references, what-changes, Pattern (for SOLID entries), and risk
2. Estimated impact (files modified, lines removed, duplicates eliminated, SOLID violations resolved)
3. Skipped findings with reasons (including over-engineering rejections)

Plan Mode handles user approval. Once approved, proceed to Phase 7.

---

## Phase 7: Implementation

After approval:

1. Run the full test suite first — establish baseline (if tests fail before refactoring, note which tests and proceed carefully).
2. For each refactoring in tier order:
   a. If the refactoring requires characterization tests: write them first, verify they pass.
   b. Make the change:
      - Edit-only changes → use the Edit tool.
      - File deletions (dead code) → use `Bash(git rm <path>)`. Do NOT use `rm` — `git rm` stages the deletion so it's reversible via `git restore --staged` + `git restore`.
   c. Run the test suite — if tests fail:
      - Revert the change immediately:
        - For Edit changes: `Bash(git restore <path>)` (reverts working tree to HEAD).
        - For `git rm` deletions: `Bash(git restore --staged <path>)` followed by `Bash(git restore <path>)` (unstages and restores).
      - Log it as `REVERTED: [reason]`.
      - Continue to the next refactoring.
   d. Run the linter — fix any linter issues introduced.
   e. Log as `APPLIED: [description]`.
3. After all refactorings applied: run the full test suite one final time.
4. Track all changes for the Post-Implementation Verifier.

<constraint>
- ONE refactoring at a time — never batch multiple changes before testing.
- REVERT immediately on test failure — do not try to "fix" the refactoring.
- Do NOT refactor surrounding code beyond the planned change.
- Preserve all existing comments, unless they describe removed dead code.
- File deletion via `git rm` ONLY — never raw `rm`.
- Revert via `git restore` ONLY — never `git checkout --` (not in allowed-tools).
</constraint>

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is only for test runners, linters, type checkers, `git rm`, `git add`, `git restore`, `git diff`, `git status`, `mkdir`, `date`, `rtk`.
</constraint>

## Phase 8: Post-Implementation Verifier

```xml
<task>
Launch a Task agent as the POST-IMPLEMENTATION VERIFIER:

**Objective:** Verify all applied refactorings are correct, no regressions were introduced, and no new SOLID violations were created while fixing old ones.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Run `git diff` to see all changes made
- Use Phase 3 SOLID Analyzer output (pre-impl violations) for the compliance delta

**Verification steps:**

1. Review each applied change against the plan — does it match what was approved?
2. For dead code removals: verify the removed code is truly gone (Grep for the symbol name) and no dangling references remain.
3. For duplicate consolidation: verify all call sites were updated to use the shared function.
4. For component reuse: verify all instances use the new shared component with correct props.
5. For extractions: verify the extracted function is called from the original location.
6. For SOLID refactorings: verify the applied Pattern actually resolves the violation.
7. **New SOLID violation check**: re-analyze every refactored file against all 5 principles. Did fixing one violation introduce another? Flag any new violations.
8. Run the test suite — all tests must pass.
9. Run the linter — no new warnings.
10. Run the type checker if available (tsc --noEmit, mypy, etc.).

**SOLID Compliance Delta:**
- List pre-impl violations from Phase 3 SOLID Analyzer by identity: (file:line, principle).
- List post-impl violations from step 7 re-analysis by identity: (file:line, principle).
- `surviving` = violations whose (file:line, principle) appears in BOTH lists.
- `resolved` = count of pre-impl violations NOT in surviving (fixed by refactoring).
- `new` = count of post-impl violations NOT in surviving (newly introduced).
- Report as summary line:

```
SOLID violations — before: N | after: M | resolved: R | new: N_new
```

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is only for `git diff`, test runners, linters, type checkers, `date`.
</constraint>

**Output:**
## Verified Correct
[list of changes that pass all checks]

## ERRORS FOUND - Must Revert
[list of changes with specific issues — revert these immediately]

## New Violations Introduced
[any SOLID violations created by the refactoring — each with file:line, principle, evidence]

## SOLID Compliance Delta
```
SOLID violations — before: N | after: M | resolved: R | new: N_new
```

## Summary
- Refactorings applied: [count]
- Refactorings reverted: [count]
- Lines removed: [from git diff --stat]
- Files modified: [count]
- Files deleted: [count]
- Test suite: PASS / FAIL
- Linter: PASS / FAIL
- Type checker: PASS / FAIL / N/A

**Success Criteria:**
All applied changes verified against plan. Test suite passes. Linter passes. No dangling references from dead code removal. No new SOLID violations introduced. SOLID compliance delta reported.
</task>
```

After verification:
- Revert any incorrect changes immediately (via `git restore` for Edits, `git restore --staged` + `git restore` for re-staged deletions).
- If new SOLID violations were introduced: revert the offending refactoring and log the reason.
- Report applied vs reverted refactorings with the SOLID compliance delta.

---

## Allowed Tools

See frontmatter `allowed-tools` at the top of this file. The enforced permission surface is:

- **Planning (read-only):** `Read`, `Grep`, `Glob`, `Task`, `WebFetch`, `WebSearch`, and scoped Bash commands for discovery (`date`, `ls:*`, `find:*`, `wc:*`, `git status`, `git log:*`, `git diff:*`, `rtk:*`).
- **Implementation:** `Edit`, `Write`, scoped deletion/stage/revert (`git rm:*`, `git add:*`, `git restore:*`), scoped test-runner subcommands (`npm test`, `pnpm test`, `pnpm run test:*`, `yarn test`, `pytest:*`, `cargo test:*`, `go test:*`), scoped analysis/type-check/lint tools (`npx knip:*`, `npx depcheck:*`, `npx ts-prune:*`, `npx tsc:*`, `npx eslint:*`, `vulture:*`, `ruff:*`, `mypy:*`, `deadcode:*`, `cargo-udeps:*`).

Intentionally excluded: broad `Bash(rm:*)`, `Bash(git:*)`, `Bash(npm:*)`, `Bash(pnpm:*)`, `Bash(yarn:*)`, `Bash(cargo:*)`, `Bash(pip:*)` — all replaced by narrower subcommand rules.

---

## Usage

```bash
/refactor                    # Full project scan (dead code + duplication + SOLID all 5)
/refactor src/utils/         # Scope to directory
/refactor src/components/    # Scope to directory (frontend reuse surfaces heavily)
/refactor src/api/routes.ts  # Scope to file
```

The command always runs the full audit — dead code + duplication + SOLID (all 5 principles including Liskov). There are no mode flags; the scope argument is the only knob.
