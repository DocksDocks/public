# `/refactor` + `/solid` Merge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `/refactor` and `/solid` into a single 8-phase `/refactor` command with scoped permissions, shell-avoidance constraints, and all `/solid` capabilities preserved (except the `--principle=X` filter).

**Architecture:** Build the new `refactor.md` in a staging file (`refactor.md.new`) one phase at a time. Verify the sandbox. Cutover via `mv` + targeted deletions. Run `sync.sh` + validators. Commit.

**Tech Stack:** Markdown command files with YAML frontmatter; bash validators (`guard-commands.sh`, `score-commands.sh`); `sync.sh` for SSOT → `~/.claude/` propagation.

---

## Reference docs

- **Spec:** `docs/superpowers/specs/2026-04-16-refactor-solid-merge-design.md`
- **Current `/refactor`:** `ssot/.claude/commands/refactor.md` (572 lines)
- **Current `/solid`:** `ssot/.claude/commands/solid.md` (445 lines, to be deleted)
- **CLAUDE.md:** `CLAUDE.md` (project root, at repo `/home/docks/projects/public/`)
- **Pattern precedent:** `docs/superpowers/plans/2026-04-16-docs-team-merge-implementation.md` (the `/docs`+`/team` merge followed the same staging-file-and-cutover pattern)

---

## File structure

| File | Operation | Notes |
|------|-----------|-------|
| `ssot/.claude/commands/refactor.md.new` | CREATE (staging) | Built incrementally by Tasks 1-7, deleted after cutover |
| `ssot/.claude/commands/refactor.md` | REPLACED | `mv refactor.md.new refactor.md` in Task 9 |
| `ssot/.claude/commands/solid.md` | DELETED | Task 9 |
| `~/.claude/commands/solid.md` | DELETED | Task 9 (additive `sync.sh` doesn't remove) |
| `~/.claude/commands/refactor.md` | REPLACED | Task 10 via `./sync.sh` |
| `CLAUDE.md` | UPDATED | Task 9 — commands table row edits |
| `score-commands.sh` | UPDATED | Task 10a — add `--per-file` output mode so the workflow can do per-file checks without re-implementing scoring logic |
| `.github/workflows/validate.yml` | REWRITTEN | Task 10a — replace the hardcoded baseline/total-minimum with two count-independent checks: per-file floor (Check A) + average-per-command floor (Check B) |

**Score context (baseline):**
- `score-commands.sh` produces a sum of per-file scores (~30 points per well-formed command; max ~31).
- Current SSOT score (pre-merge, 9 commands): **246** (measured fresh; the workflow's hardcoded `277` baseline and `250` minimum are stale from before the `/docs`+`/team` merge — CI is already failing).
- Expected post-merge score (8 commands): **220-240** depending on new `/refactor`'s individual quality.
- Task 10a replaces both hardcoded numbers with count-independent thresholds (per-file minimum + average-per-command minimum), so future command add/remove does not require touching the workflow.

**Working directory for all tasks:** `/home/docks/projects/public` (the repo root).

---

## Task 1: Build `refactor.md.new` — frontmatter + header + orchestrator constraints + Phase 1

**Files:**
- Create: `ssot/.claude/commands/refactor.md.new`

- [ ] **Step 1: Write the file**

Create `ssot/.claude/commands/refactor.md.new` with the following exact content:

````markdown
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
````

- [ ] **Step 2: Verify the file was written**

Run: `ls -la ssot/.claude/commands/refactor.md.new && wc -l ssot/.claude/commands/refactor.md.new`
Expected: file exists, approximately 110-130 lines.

---

## Task 2: Append Phase 2 (Parallel Scanners)

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 2 to the sandbox file**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

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
````

- [ ] **Step 2: Verify the file grew**

Run: `wc -l ssot/.claude/commands/refactor.md.new`
Expected: approximately 240-280 lines (Phase 1 ~130 lines + Phase 2 ~110-150 lines).

- [ ] **Step 3: Confirm category #5 was dropped**

Run: `grep -n "SOLID Violations" ssot/.claude/commands/refactor.md.new`
Expected: zero matches (the old category #5 `## SOLID Violations` is gone; Phase 3 handles it).

---

## Task 3: Append Phase 3 (SOLID Analyzer — new)

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 3 to the sandbox file**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

## Phase 3: SOLID Analyzer

Runs sequentially after the parallel scanners in Phase 2. Single agent. Does its own component inventory first (absorbs the role of `/solid`'s old Discovery phase), then evaluates each surviving component against all 5 SOLID principles including Liskov.

```xml
<task>
Launch a Task agent as the SOLID ANALYZER:

**Objective:** Deep per-principle analysis of surviving code (excluding files that Phase 2's Dead Code Scanner flagged SAFE for deletion). Covers all 5 SOLID principles including Liskov.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use the Explorer's **Existing Abstractions** section (DI patterns, interfaces, class hierarchies)
- Use the Dead Code Scanner's **SAFE list** — SKIP those files (no analysis value for code about to be deleted)
- Use the Duplication Scanner's full output for cross-reference (some duplications have SOLID causes)

**Steps:**

1. **Component inventory** (absorbs `/solid` Phase 2 Discovery). Use Glob + Grep to catalog:
   - Classes and modules (service, repository, controller, factory classes) — with `file:line` per class
   - Interfaces, type aliases, abstract classes, Python protocols — with `file:line`
   - Standalone and factory functions (top-level, exported) — with `file:line`
   - Import relationships + DI setup + service containers/registries
   - **Exclude** any file in the Dead Code Scanner's SAFE list

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
   - Before suggesting a framework-specific pattern (e.g., NestJS DI tokens, React Context for DI), use context7 → `resolve-library-id` → `query-docs` to verify current API; fall back to `WebFetch` on official docs if context7 doesn't cover it. Do NOT assume API signatures from training data.

<constraint>
Shell-avoidance — apply here:
- Glob for file enumeration — not `find`, `ls`, or shell `for` loops.
- Grep for content search — not `grep` or `rg`.
- Read for file contents — not `cat`, `head`, or `tail`.
- Count matches by processing Glob results in-agent — do NOT pipe to `wc -l` inside `$(...)`.
- Do NOT compose shell loops (`for`, `while`), command substitution (`$(...)`), or pipes.

Bash is only for `date`, context7 calls, and `WebFetch` — otherwise use native tools.
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
- Files in the Dead Code Scanner's SAFE list MUST be skipped entirely.
- Before suggesting a framework-specific pattern, verify the API via context7 → WebFetch.
- Prefer composition over inheritance for L and I violations.
- Do NOT duplicate findings from the Duplication Scanner (e.g., if the Duplication Scanner already flagged a module-reorg issue, do not re-flag it as a DIP violation unless it's a distinct concern).
</constraint>

**Success Criteria:**
Component inventory produced with file:line per component. Priority ordering applied. All 5 principles (plus monorepo cross-package check if applicable) evaluated. Every violation has file:line, principle, evidence, impact, pattern, risk tier. Context7 consulted for any framework-specific pattern suggestions. SAFE-flagged files skipped.
</task>
```

<constraint>
After Phase 3 completes, append the SOLID Analyzer's output to the plan file under `## Phase 3: SOLID Analysis Results`. Then immediately launch Phase 4 (Planner).
</constraint>
````

- [ ] **Step 2: Verify file grew and new phase structure is right**

Run: `wc -l ssot/.claude/commands/refactor.md.new`
Expected: approximately 360-420 lines.

Run: `grep -n "^## Phase" ssot/.claude/commands/refactor.md.new`
Expected: three `## Phase` headings — Phase 1, Phase 2, Phase 3.

- [ ] **Step 3: Confirm Liskov is present**

Run: `grep -n "Liskov\|LSP" ssot/.claude/commands/refactor.md.new`
Expected: multiple matches (frontmatter `description`, header body, Phase 3 step 3 principle block, at least).

---

## Task 4: Append Phase 4 (Planner with 9-field spec)

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 4 to the sandbox file**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

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
````

- [ ] **Step 2: Verify Pattern field addition is explicit**

Run: `grep -n "Pattern" ssot/.claude/commands/refactor.md.new`
Expected: multiple matches including `**Pattern**: for \`solid-violation\` entries` (the new 9th field).

---

## Task 5: Append Phase 5 (Verifier with over-engineering check)

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 5**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

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
After the Verifier produces its results, append the Planner output and Verifier results to the plan file under `## Phase 5: Verified Refactoring Plan`. The plan file should now contain Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5 results. This is mandatory — implementation reads from this file.
</constraint>
````

- [ ] **Step 2: Verify Over-Engineering Check section present**

Run: `grep -n "Over-Engineering Check" ssot/.claude/commands/refactor.md.new`
Expected: at least 2 matches (the check description in Checks, and the Output section heading).

---

## Task 6: Append Phase 6 (Present + ExitPlanMode) + Phase 7 (Implementation with git rm / git restore)

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 6 and Phase 7**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

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
````

- [ ] **Step 2: Verify git rm + git restore guidance is in place**

Run: `grep -n "git rm\|git restore" ssot/.claude/commands/refactor.md.new`
Expected: multiple matches — frontmatter `Bash(git rm:*)` + `Bash(git restore:*)`, Phase 7 body guidance on deletion and revert.

Run: `grep -n "^rm \\| rm " ssot/.claude/commands/refactor.md.new`
Expected: zero matches (no instructions to use raw `rm` anywhere).

---

## Task 7: Append Phase 8 (Post-Impl Verifier with new-violation check + SOLID compliance delta) + Usage footer

**Files:**
- Modify: `ssot/.claude/commands/refactor.md.new` (append)

- [ ] **Step 1: Append Phase 8 and Usage footer**

Append the following to `ssot/.claude/commands/refactor.md.new`:

````markdown

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
- Count violations from Phase 3 SOLID Analyzer output (pre-impl)
- Count violations from step 7 re-analysis (post-impl)
- Compute: resolved = (pre - surviving), new = (post - surviving-subset-of-pre)
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
````

- [ ] **Step 2: Verify Phase 8 has all three new pieces**

Run: `grep -n "New SOLID violation\|SOLID Compliance Delta\|SOLID violations — before" ssot/.claude/commands/refactor.md.new`
Expected: at least 3 matches (step 7 description, Output section heading, summary-line template).

- [ ] **Step 3: Verify `## Allowed Tools` section is present**

Run: `grep -n "^## Allowed Tools" ssot/.claude/commands/refactor.md.new`
Expected: exactly one match near the end of the file (before the Usage section). This recovers 1 point from the scorer (the `-i Allowed Tools` check) and matches the pattern used by `/docs`.

- [ ] **Step 4: Verify total size is reasonable**

Run: `wc -l ssot/.claude/commands/refactor.md.new`
Expected: approximately 710-840 lines (8 phases with constraints + Allowed Tools + Usage footer).

- [ ] **Step 5: Verify all 8 phases are present**

Run: `grep -n "^## Phase" ssot/.claude/commands/refactor.md.new`
Expected: exactly 8 matches — Phase 1 through Phase 8.

---

## Task 8: Sandbox validation

**Files:**
- Read-only checks on `ssot/.claude/commands/refactor.md.new`

- [ ] **Step 1: Verify frontmatter is valid YAML**

Run:
```bash
python3 -c "
import sys
import re
with open('ssot/.claude/commands/refactor.md.new') as f:
    content = f.read()
m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
if not m:
    print('ERROR: no frontmatter'); sys.exit(1)
try:
    import yaml
    yaml.safe_load(m.group(1))
    print('OK: frontmatter parses as valid YAML')
except Exception as e:
    print('ERROR:', e); sys.exit(1)
"
```
Expected: `OK: frontmatter parses as valid YAML`.

- [ ] **Step 2: Verify shell-avoidance constraint appears in every Task agent**

Run:
```bash
python3 -c "
with open('ssot/.claude/commands/refactor.md.new') as f:
    content = f.read()
# count <task> blocks and shell-avoidance mentions inside them
task_count = content.count('<task>')
shell_avoid_count = content.count('Shell-avoidance')
print(f'<task> blocks: {task_count}')
print(f'Shell-avoidance mentions: {shell_avoid_count}')
# expect 6 <task> blocks (Phase 1, 2a, 2b, 3, 4, 5, 8) = 7, and shell-avoidance in each + orchestrator-level once
"
```
Expected: 7 `<task>` blocks (Phase 1 Exploration, Phase 2 Dead Code, Phase 2 Duplication, Phase 3 SOLID, Phase 4 Planner, Phase 5 Verifier, Phase 8 Post-Impl — Phase 6 and Phase 7 are orchestrator-level text, not agent tasks), and at least 8 `Shell-avoidance` mentions (orchestrator-level + one per task).

- [ ] **Step 3: Verify dropped permissions are NOT present**

Run:
```bash
grep -nE "Bash\\(rm:\\*\\)|Bash\\(git:\\*\\)|Bash\\(npm:\\*\\)|Bash\\(pnpm:\\*\\)|Bash\\(yarn:\\*\\)|Bash\\(cargo:\\*\\)|Bash\\(pip:\\*\\)" ssot/.claude/commands/refactor.md.new
```
Expected: zero matches. (The `:` followed by `*` form is the banned broad wildcard. Narrow forms like `Bash(npm test)` or `Bash(git rm:*)` are allowed.)

- [ ] **Step 4: Verify the scoped permissions ARE present**

Run:
```bash
grep -nE "Bash\\(git rm:\\*\\)|Bash\\(git restore:\\*\\)|Bash\\(git add:\\*\\)|Bash\\(npx tsc:\\*\\)|Bash\\(pytest:\\*\\)" ssot/.claude/commands/refactor.md.new
```
Expected: each rule appears in the frontmatter (5+ matches).

- [ ] **Step 5: Verify no `SOLID Violations` category #5 heading inside Duplication Scanner**

Run:
```bash
grep -c "## SOLID Violations" ssot/.claude/commands/refactor.md.new
```
Expected: `0` (the old category #5 header is gone; SOLID is its own Phase 3 section, which uses `## SOLID Violations` inside the Phase 3 task's output — double-check below).

Run:
```bash
grep -n "SOLID Violations" ssot/.claude/commands/refactor.md.new
```
Expected: matches only inside Phase 3's output template (after the `**Output:**` line of Phase 3's `<task>` block) and possibly in Phase 7/8 references. There should be NO occurrence under the Duplication Scanner (`### Duplication & Reuse Scanner` block).

- [ ] **Step 6: Verify --principle flag is gone**

Run:
```bash
grep -nE "\\-\\-principle|principle=" ssot/.claude/commands/refactor.md.new
```
Expected: zero matches.

---

## Task 9: Cutover — replace `refactor.md`, delete `solid.md`, update `CLAUDE.md`

**Files:**
- Replace: `ssot/.claude/commands/refactor.md` (via `mv`)
- Delete: `ssot/.claude/commands/solid.md`
- Delete: `~/.claude/commands/solid.md`
- Modify: `CLAUDE.md` (commands table row edits)

- [ ] **Step 1: Replace the SSOT refactor.md with the sandbox**

Run:
```bash
mv ssot/.claude/commands/refactor.md.new ssot/.claude/commands/refactor.md
```

Verify:
```bash
ls -la ssot/.claude/commands/refactor.md ssot/.claude/commands/refactor.md.new 2>&1
```
Expected: `refactor.md` exists, `refactor.md.new` does not exist (ls reports "No such file" for the `.new`).

- [ ] **Step 2: Delete SSOT solid.md**

Run:
```bash
git rm ssot/.claude/commands/solid.md
```

Verify:
```bash
git status --short ssot/.claude/commands/
```
Expected: shows `D  ssot/.claude/commands/solid.md` and `M  ssot/.claude/commands/refactor.md`.

- [ ] **Step 3: Delete ~/.claude solid.md**

`sync.sh` is additive and won't remove this. Delete directly:

Run:
```bash
rm -f ~/.claude/commands/solid.md
```

Verify:
```bash
ls -la ~/.claude/commands/solid.md 2>&1
```
Expected: "No such file or directory".

- [ ] **Step 4: Update CLAUDE.md commands table**

Read `CLAUDE.md` first to confirm the table lines. The current table lists `/solid` and has a `/refactor` row with a short pipeline description.

Use Edit to make two changes to `CLAUDE.md`:

**Edit A — remove the `/solid` row:**

Find and delete the exact line (the row for `/solid`). In the current CLAUDE.md, the row is:

```
| `/solid` | Exploration → Discovery → Analyzer → Planner → Verifier | Builder-Verifier |
```

Remove that entire line.

**Edit B — update the `/refactor` row:**

Find the current `/refactor` line:

```
| `/refactor` | Exploration → [Dead Code Scanner \| Duplication Scanner] → Planner → Verifier | DAG + Builder-Verifier |
```

Replace with:

```
| `/refactor` | Exploration → [Dead Code Scanner \| Duplication Scanner] → SOLID Analyzer → Planner → Verifier | DAG + Builder-Verifier (sequential SOLID phase) |
```

- [ ] **Step 5: Verify CLAUDE.md edits**

Run:
```bash
grep -n "^| \`/\(solid\|refactor\)\`" CLAUDE.md
```
Expected: one match only — the updated `/refactor` row. No `/solid` row.

Run:
```bash
grep -n "SOLID Analyzer" CLAUDE.md
```
Expected: one match in the `/refactor` table row.

- [ ] **Step 6: Also check the "parallel phases" description**

The current CLAUDE.md has a sentence mentioning which commands have parallel phases, e.g.:

```
Commands with parallel phases (`/security`, `/fix`, `/docs`) include explicit instructions to launch agents in a single turn...
```

`/refactor` also has a parallel Phase 2. If the sentence does not already include `/refactor`, add it. Use Edit to change the sentence to include `/refactor`:

Old (look for the exact wording in CLAUDE.md):
```
Commands with parallel phases (`/security`, `/fix`, `/docs`) include explicit instructions to launch agents in a single turn for wall-clock time savings.
```

New:
```
Commands with parallel phases (`/security`, `/fix`, `/docs`, `/refactor`) include explicit instructions to launch agents in a single turn for wall-clock time savings.
```

If the sentence already includes `/refactor`, skip this step.

---

## Task 10: Sync + validators

**Files:**
- Run: `./sync.sh`
- Run: `bash guard-commands.sh`
- Run: `bash score-commands.sh`

- [ ] **Step 1: Diff SSOT vs home settings before sync**

Run:
```bash
diff <(jq -S . ssot/.claude/settings.json) <(jq -S . ~/.claude/settings.json) | head -50
```
Expected: probably empty or minimal differences unrelated to this task. If there is drift unrelated to this plan, note it but do NOT clean up here (out of scope).

- [ ] **Step 2: Run sync.sh**

Run:
```bash
./sync.sh
```
Expected: sync completes without error. `~/.claude/commands/refactor.md` now matches `ssot/.claude/commands/refactor.md`.

- [ ] **Step 3: Verify the synced command file matches SSOT**

Run:
```bash
diff ssot/.claude/commands/refactor.md ~/.claude/commands/refactor.md
```
Expected: no output (files are identical).

- [ ] **Step 4: Run guard validator**

Run:
```bash
bash guard-commands.sh
```
Expected: exit 0. If it fails, read the error, fix the issue in `ssot/.claude/commands/refactor.md`, re-run `./sync.sh`, re-run `guard-commands.sh` until it passes.

- [ ] **Step 5: Run score validator and capture the new total**

Run:
```bash
NEW_SCORE=$(bash score-commands.sh)
echo "New total score: $NEW_SCORE"
```
Expected: prints a number (no non-zero exit — the bare script just echoes the total; it doesn't enforce a threshold itself; the workflow does). Record this number — it's the input to Task 10a.

Reality check:
- Before this merge (9 commands): measured **246**.
- After this merge (8 commands): expect **220-240**. If it's wildly outside that range, investigate before proceeding to Task 10a.

---

## Task 10a: Switch CI to count-independent score checks (per-file floor + average floor)

The workflow at `.github/workflows/validate.yml` currently has a hardcoded baseline (`277`) and a hardcoded total-score minimum (`250`). Both are count-sensitive: every command add/remove requires editing the workflow. Both are also stale (pre-merge score is already `246`, below the hardcoded minimum).

Replace them with two count-independent checks:

- **Check A — per-file floor.** Every individual command must score ≥ `PER_FILE_MIN`. Catches per-file regressions directly; a single weak command can't be masked by strong ones.
- **Check B — average-per-command floor.** `total / count ≥ AVG_MIN`. Catches kit-wide drift. Auto-scales with command count.

Neither check uses the total or the command count as a hardcoded threshold.

**Files:**
- Modify: `score-commands.sh` (add `--per-file` output mode)
- Modify: `.github/workflows/validate.yml` (rewrite the score step)

- [ ] **Step 1: Add `--per-file` mode to `score-commands.sh`**

Read the current `score-commands.sh` first. The scorer's structure is:
```
for f in "$DIR"/*.md; do
  ...
  score=0
  # 11 scoring rules, each adds to $score
  ...
  total=$((total + score))
done
echo "$total"
```

Make two edits:

**Edit A — parse optional `--per-file` flag.** Replace the existing `DIR="${1:-$SCRIPT_DIR/ssot/.claude/commands}"` line (near the top, after the `SCRIPT_DIR=` line) with:

```bash
MODE="total"
DIR=""
for arg in "$@"; do
  case "$arg" in
    --per-file) MODE="per-file" ;;
    *) DIR="$arg" ;;
  esac
done
DIR="${DIR:-$SCRIPT_DIR/ssot/.claude/commands}"
```

**Edit B — emit per-file scores inside the loop when in `per-file` mode, and suppress the total emission in that mode.** Just before the `total=$((total + score))` line inside the loop, add:

```bash
  if [ "$MODE" = "per-file" ]; then
    echo "$name $score"
  fi
```

And change the final `echo "$total"` at the bottom to:

```bash
if [ "$MODE" = "total" ]; then
  echo "$total"
fi
```

- [ ] **Step 2: Verify `score-commands.sh` still works in total mode (backwards compat)**

Run:
```bash
bash score-commands.sh
```
Expected: prints a single integer (same as before — one number to stdout).

Run:
```bash
bash score-commands.sh /nonexistent/path
```
Expected: prints `0` (or errors silently, but not a crash — same behavior as before).

- [ ] **Step 3: Verify `--per-file` mode**

Run:
```bash
bash score-commands.sh --per-file
```
Expected: prints one line per command file, format `NAME SCORE`. No total line at the end.

Example expected shape:
```
docs.md 30
fix.md 29
human-docs.md 28
refactor.md 31
review.md 28
security.md 30
solid.md 29    <- this line will disappear after Task 9 deletes /solid
test.md 29
```

- [ ] **Step 4: Measure current per-file minimum and average**

Run:
```bash
bash score-commands.sh --per-file | awk '{print $2}' | sort -n | head -1
```
Expected: the lowest per-command score. Note this number as `MEASURED_MIN`.

Run:
```bash
total=$(bash score-commands.sh)
count=$(bash score-commands.sh --per-file | wc -l)
echo "total=$total count=$count avg=$(( total / count ))"
```
Expected: prints `total=<N> count=<C> avg=<A>`. Note `avg` as `MEASURED_AVG`.

- [ ] **Step 5: Pick the floors**

- `PER_FILE_MIN` = `MEASURED_MIN - 3` (small buffer below the lowest current score; keeps CI green today but catches any single command dropping further).
- `AVG_MIN` = `MEASURED_AVG - 2` (small buffer below the current average; catches broad drift).

Example: if `MEASURED_MIN = 28` and `MEASURED_AVG = 29`, then `PER_FILE_MIN = 25` and `AVG_MIN = 27`.

Write these two numbers down; they go into the workflow in the next step.

- [ ] **Step 6: Rewrite the score step in `.github/workflows/validate.yml`**

Read the current workflow. The relevant block is:

```yaml
      - name: Run score-commands.sh
        run: |
          score=$(bash score-commands.sh)
          echo "Quality score: $score"
          # Current baseline: 277. Fail if score drops significantly below baseline.
          if [ "$score" -lt 250 ]; then
            echo "Score $score is below minimum threshold (250)" >&2
            exit 1
          fi
```

Replace that single step with two steps (substitute the `PER_FILE_MIN` and `AVG_MIN` numbers chosen in Step 5):

```yaml
      - name: Score — per-file floor (Check A)
        run: |
          PER_FILE_MIN=<PER_FILE_MIN>
          failed=0
          while IFS=' ' read -r name score; do
            if [ "$score" -lt "$PER_FILE_MIN" ]; then
              echo "::error file=ssot/.claude/commands/$name::scored $score, below per-file floor $PER_FILE_MIN"
              failed=1
            else
              echo "$name: $score"
            fi
          done < <(bash score-commands.sh --per-file)
          exit $failed

      - name: Score — average-per-command floor (Check B)
        run: |
          AVG_MIN=<AVG_MIN>
          total=$(bash score-commands.sh)
          count=$(bash score-commands.sh --per-file | wc -l)
          if [ "$count" -eq 0 ]; then
            echo "::error::No command files found in ssot/.claude/commands/"
            exit 1
          fi
          avg=$(( total / count ))
          echo "total=$total count=$count avg=$avg floor=$AVG_MIN"
          if [ "$avg" -lt "$AVG_MIN" ]; then
            echo "::error::Average per-command score $avg is below floor $AVG_MIN" >&2
            exit 1
          fi
```

No hardcoded total. No hardcoded command count. Both thresholds are per-command and independent of the number of files.

- [ ] **Step 7: Verify the workflow still parses as valid YAML**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/validate.yml'))" && echo OK
```
Expected: prints `OK`.

- [ ] **Step 8: Dry-run both checks locally**

Run:
```bash
PER_FILE_MIN=<PER_FILE_MIN>
failed=0
while IFS=' ' read -r name score; do
  if [ "$score" -lt "$PER_FILE_MIN" ]; then
    echo "FAIL: $name=$score < $PER_FILE_MIN"
    failed=1
  fi
done < <(bash score-commands.sh --per-file)
[ $failed -eq 0 ] && echo "Check A: PASS" || echo "Check A: FAIL"
```
Expected: `Check A: PASS`. If `FAIL`, a specific command is below the floor — lower `PER_FILE_MIN`, or improve that command, or accept the floor change. Don't just rubber-stamp a lower floor without understanding why.

Run:
```bash
AVG_MIN=<AVG_MIN>
total=$(bash score-commands.sh)
count=$(bash score-commands.sh --per-file | wc -l)
avg=$(( total / count ))
echo "total=$total count=$count avg=$avg floor=$AVG_MIN"
[ "$avg" -ge "$AVG_MIN" ] && echo "Check B: PASS" || echo "Check B: FAIL"
```
Expected: `Check B: PASS`.

- [ ] **Step 9: Sanity check — no hardcoded totals left in the workflow**

Run:
```bash
grep -nE '277|250|baseline' .github/workflows/validate.yml
```
Expected: zero matches. The old hardcoded baseline and total-minimum are gone.

---

## Task 11: Commit

**Files:**
- Commit: `ssot/.claude/commands/refactor.md`, `CLAUDE.md`, `score-commands.sh`, `.github/workflows/validate.yml`, deletion of `ssot/.claude/commands/solid.md`

- [ ] **Step 1: Review the staged diff**

Run:
```bash
git status --short
git diff --stat HEAD
```
Expected: shows `M .github/workflows/validate.yml`, `M CLAUDE.md`, `M score-commands.sh`, `M ssot/.claude/commands/refactor.md`, `D ssot/.claude/commands/solid.md`.

- [ ] **Step 2: Commit**

Run:
```bash
git commit -m "$(cat <<'EOF'
commands: merge /solid into /refactor; switch CI score checks to count-independent

Eight-phase pipeline that absorbs /solid's deep per-principle analysis
(including Liskov) as a sequential Phase 3 after the parallel Dead Code +
Duplication scanners. Removes the lightweight category-5 SOLID sub-section
from the Duplication Scanner. Adds Pattern as a 9th Planner spec field,
over-engineering check to the pre-impl Verifier, and new-violation check
plus SOLID compliance delta to the post-impl Verifier.

Tightens frontmatter: drops broad Bash(rm:*), Bash(git:*), Bash(npm:*),
Bash(pnpm:*), Bash(yarn:*), Bash(cargo:*), Bash(pip:*); scopes in
Bash(git rm:*), Bash(git restore:*), Bash(git add:*), and specific
test/analysis/type-checker/linter subcommands. File deletion uses git rm
(staged, reversible); revert uses git restore. Shell-avoidance constraint
applied to every phase.

Deletes /solid (both ssot and ~/.claude). Updates CLAUDE.md commands
table to reflect the merged /refactor pipeline with sequential SOLID phase.

Replaces the stale hardcoded CI score thresholds (baseline 277, minimum
250, both count-sensitive and drifted since the /docs+/team merge) with
two count-independent checks: per-file floor (every command must score
>= PER_FILE_MIN) and average-per-command floor (total/count >= AVG_MIN).
Adds --per-file output mode to score-commands.sh to support the per-file
check without duplicating scoring logic in the workflow. Command add/
remove no longer requires editing the workflow.

One intentional functionality drop: /solid's --principle=X filter.
Consistent with the non-interactive full-audit posture locked in during
the /docs+/team merge.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```
Expected: commit succeeds.

- [ ] **Step 3: Verify the commit**

Run:
```bash
git log --oneline -1
git show --stat HEAD
```
Expected: commit present, expected files changed.

---

## User-gated smoke test (not executed by subagents)

After Task 11 commits, the user should smoke-test in a **fresh Claude Code session** (needed because the new command's permission rules load at session start):

1. Open a new Claude Code session in any project with source code.
2. Run `/refactor src/utils/` (or any narrow path).
3. Confirm:
   - Zero `AskUserQuestion` prompts during the plan phases.
   - Zero compound-shell permission prompts during Exploration (`find`, `for`, `$(...)`).
   - Phase 3 SOLID Analyzer fires and reports findings for all 5 principles, not just 4.
   - Planner output includes the `Pattern` field for SOLID entries.
   - Plan presentation is correct; `ExitPlanMode` triggers normally.

If the smoke test fails, open a follow-up plan to patch the specific issue.

---

## Self-review notes (author)

**Spec coverage:** Every acceptance criterion in the spec has a task:
- AC 1 (no prompts / no flags) → Task 1 frontmatter + Task 8 step 6 grep check
- AC 2 (all 5 principles including Liskov) → Task 3 Phase 3 per-principle evaluation
- AC 3 (skips SAFE dead code) → Task 3 Phase 3 step 1 bullet + constraint
- AC 4 (no broad perms) → Task 8 step 3 grep check
- AC 5 (scoped git rm / git restore) → Task 8 step 4 grep check
- AC 6 (shell-avoidance every phase) → Task 8 step 2 count check
- AC 7 (Pattern field) → Task 4 field #9 + Task 4 step 2 grep
- AC 8 (over-engineering section) → Task 5 Output section + step 2 grep
- AC 9 (SOLID compliance delta) → Task 7 Phase 8 output + step 2 grep
- AC 10 (`/solid` gone) → Task 9 steps 2-3
- AC 11 (CLAUDE.md updated) → Task 9 steps 4-6
- AC 12 (validators pass) → Task 10 steps 4-5 + Task 10a step 6 dry-run
- AC 13 (smoke test) → User-gated smoke test section

**Out-of-spec addition (user flagged during planning):** `.github/workflows/validate.yml` score thresholds were stale and count-sensitive — every command add/remove required editing the workflow. Task 10a goes further than a simple recalibration: it switches CI to two count-independent checks (per-file floor + average-per-command floor) and adds a `--per-file` mode to `score-commands.sh` so the workflow doesn't duplicate scoring logic. Future command add/remove will no longer require workflow edits.

**Placeholder scan:** No TBD / TODO / "fill in" / "implement later" / "handle edge cases". All content is concrete. The three placeholders in Task 10a (`MEASURED_MIN`, `MEASURED_AVG`, `PER_FILE_MIN`, `AVG_MIN`) are *intentional* — they are computed by the executor from the actual measurements in Step 4 and substituted into the workflow in Step 6. This is the only responsible way to set CI thresholds: measure the real values, then lock them in.

**Type consistency:** Pattern field named consistently as `Pattern` across Tasks 3, 4, 5, 7. Principle codes S/O/L/I/D used consistently. The synthetic `X` code for cross-package coupling appears only in Task 3 and is explained on first use.
