# SOLID Architecture Enforcer

Analyze, identify, and fix SOLID principle violations across the codebase. Uses a multi-phase agent pipeline for thorough analysis and safe refactoring.

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
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*, yarn:*)

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

**Objective:** Map the project architecture, abstractions, and target scope for SOLID analysis.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and architecture patterns
- Find the main source directories
- If `.claude/skills/` exists, read relevant project skills for architecture and conventions
- Understand existing abstractions, interfaces, and class hierarchies
- Note dependency injection patterns if present
- Identify the target scope (use $ARGUMENTS if provided, otherwise analyze key modules)

**Output Format:**
- Project stack and architecture patterns
- Target scope with file paths
- Existing abstractions and class hierarchies

**Constraints:**
- Read-only exploration, no modifications

**Success Criteria:**
Identified project stack, target scope, and existing architecture patterns with file paths.
</task>
```

## Phase 2: Discovery

```xml
<task>
Launch a Task agent as the DISCOVERY agent:

**Objective:** Create a complete inventory of classes, interfaces, functions, and dependencies to analyze for SOLID violations.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use exploration output for project structure

You are the DISCOVERY agent. Your job is to create a complete inventory of components to analyze.

Find and catalog:

**Classes and Modules**
- All class definitions
- Module exports
- Service classes
- Repository/data access classes
- Controller/handler classes

**Interfaces and Types**
- Interface definitions
- Type aliases
- Abstract classes
- Protocols (Python)

**Functions**
- Standalone functions
- Factory functions
- Utility functions

**Dependencies**
- Import relationships
- Dependency injection setup
- Service containers/registries

**Output:**
## Component Inventory
[List each component with file:line, type, and brief purpose]

## Dependency Graph
[Key dependency relationships between components]

## Analysis Priority
[Order components by complexity/importance for SOLID analysis]

**Success Criteria:**
All classes, interfaces, and key functions cataloged with file:line. Dependency graph mapped. Analysis priority ordered by complexity.
</task>
```

<constraint>
After Phase 2 completes, write the Discovery agent's output to the plan file under `## Phase 2: Discovery Results`. Then immediately launch Phase 3 (Analyzer).
</constraint>

## Phase 3: Analysis

### Analyzer

```xml
<task>
Launch a Task agent with model="opus" to act as the ANALYZER:

**Objective:** Deeply analyze each component against all 5 SOLID principles, identifying concrete violations with evidence.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Discovery output for component inventory and dependency graph

You are the ANALYZER. Your job is to deeply analyze each component against ALL 5 SOLID principles.

For each component from the Discovery phase, evaluate:

**S - Single Responsibility Principle**
- Does this class/module have ONE reason to change?
- Are there multiple responsibilities mixed together?
- Could this be split into focused components?
- Signs of violation: "and" in class name, multiple unrelated methods, god classes

**O - Open/Closed Principle**
- Is this open for extension but closed for modification?
- Are there switch statements or if/else chains that grow with new types?
- Could new behavior be added without modifying existing code?
- Signs of violation: modifying existing code to add features, hardcoded type checks

**L - Liskov Substitution Principle**
- Can subclasses be substituted for their base class?
- Do subclasses throw unexpected exceptions?
- Do subclasses violate parent contracts?
- Signs of violation: instanceof checks, overridden methods that break contracts

**I - Interface Segregation Principle**
- Are interfaces focused and cohesive?
- Do clients depend on methods they don't use?
- Should large interfaces be split?
- Signs of violation: empty method implementations, "not supported" throws

**D - Dependency Inversion Principle**
- Do high-level modules depend on abstractions?
- Are dependencies injected or hardcoded?
- Are there concrete dependencies that should be abstract?
- Signs of violation: `new ConcreteClass()` in business logic, direct imports of implementations

**Output:**
## SOLID Analysis Report

### Critical Violations (Must Fix)
[Violations that significantly impact maintainability]

### High Priority Violations
[Clear violations that should be addressed]

### Medium Priority Violations
[Violations with moderate impact]

### Low Priority / Suggestions
[Minor improvements or stylistic preferences]

For each violation include:
- File:line location
- Principle violated (S/O/L/I/D)
- Specific issue description
- Impact on maintainability

**Success Criteria:**
Every violation includes file:line location and specific impact statement. All 5 SOLID principles evaluated for each component.
</task>
```

## Phase 4: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

**Objective:** Propose specific, minimal refactorings to fix each SOLID violation.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Analyzer's violation report as input

You are the PLANNER. For each SOLID violation, propose a specific refactoring.

<constraint>
- Propose MINIMAL refactorings — fix the violation, not the whole module
- If project skills exist, check `.claude/skills/` for project patterns before proposing
- Prefer composition over inheritance for L and I violations
- Every refactoring must include file:line and affected files
</constraint>

For each violation provide:

1. **Violation**: Which principle, where (file:line)
2. **Current State**: What the code does now
3. **Proposed Refactoring**: Exact changes to fix the violation
4. **Pattern to Apply**: Design pattern if applicable (Strategy, Factory, Adapter, etc.)
5. **Files Affected**: All files that need changes
6. **Risk Level**: low/medium/high

**Refactoring Strategies:**

For **S** violations:
- Extract Class/Module
- Split responsibilities into focused components
- Create separate services for different concerns

For **O** violations:
- Replace conditionals with polymorphism
- Introduce Strategy pattern
- Create extension points via interfaces

For **L** violations:
- Fix inheritance hierarchy
- Prefer composition over inheritance
- Ensure contracts are preserved

For **I** violations:
- Split interfaces into focused ones
- Create role-specific interfaces
- Apply Interface Segregation

For **D** violations:
- Introduce dependency injection
- Create abstractions for concrete dependencies
- Apply Inversion of Control

Output numbered list of proposed refactorings.

**Success Criteria:**
Every refactoring includes file:line, affected files, and risk level. No refactoring exceeds the scope of its violation.
</task>
```

## Phase 5: Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Validate each proposed refactoring against the actual codebase for correctness and feasibility.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date
- Use Planner's proposed refactorings as input

You are the VERIFIER. Validate each proposed refactoring against the actual codebase.

For each proposed refactoring:
1. Read the file at the reported location — does the violation actually exist?
2. Does the proposed refactoring actually fix the SOLID violation?
3. Over-engineering check: is the fix simpler than the problem it solves?
4. Search for all usages of changed interfaces/classes — are all affected files listed?
5. Will the refactoring break existing tests?
6. Is the risk level accurate?

Output:
## Approved Refactorings
[Refactorings confirmed as correct and worthwhile]

## Modified Refactorings
[Refactorings that need adjustments, with specific changes]

## Rejected Refactorings
[Over-engineered or incorrect proposals, with evidence]

## Impact Assessment
- Files affected: X
- Risk summary: [low/medium/high counts]

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Spot-checked 5+ file:line references. Over-engineering check passed for each refactoring. All affected files listed.
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Planner output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Refactoring Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 6: Present Plan + Exit Plan Mode

Write the following to the plan file, then call `ExitPlanMode`:

1. Proposed refactorings organized by phase
2. Files, patterns, and code changes
3. Dependencies between refactorings

Plan Mode handles user approval. Once approved, proceed to Phase 7.

---

## Phase 7: Implementation

After approval:

1. Implement refactorings in the specified order
2. For each refactoring:
   - Make the code changes
   - Update any affected imports
   - Update tests if needed
3. Run tests after each significant change
4. If a refactoring causes issues, revert and report
5. Track all changes for verification

## Phase 8: Post-Implementation Verifier

### Verifier

```xml
<task>
Launch a Task agent as the VERIFIER:

**Objective:** Verify all refactorings are correct, the code builds, and no new SOLID violations were introduced.

**Context:**
- Run `date "+%Y-%m-%d"` first to confirm current date

You are the VERIFIER. Verify all refactorings are correct and the code still works.

1. Run `git diff` to see exactly what was changed
2. For EACH refactoring, verify:
   - Does the change actually fix the SOLID violation?
   - Is the new code following the intended pattern correctly?
   - Are all imports and dependencies updated?
   - Did we introduce any new violations while fixing old ones?

3. Run verification checks:
   - Do all tests still pass?
   - Does the application build?
   - Are there any type errors?
   - Do linters pass?

4. SOLID compliance check:
   - Re-analyze refactored code against SOLID principles
   - Ensure no new violations were introduced
   - Verify abstractions are properly implemented

**Output:**
## Verified Correct
[Refactorings that properly fix violations]

## ERRORS FOUND - Must Revert
[Changes that are incorrect or broke something]

## New Violations Introduced
[Any SOLID violations created by the refactoring]

## Tests Status
[Pass/Fail status]

## Final SOLID Score
[Brief assessment of SOLID compliance after changes]

**Anti-Hallucination Checks (mandatory):**
1. Read each referenced file — does code at the stated line actually exist?
2. Verify import paths resolve to real files (use Glob)
3. Check function signatures match actual code (read the source)
4. Validate all file paths in output exist (use Glob)
5. Cross-reference package names against lockfile (package-lock.json, pnpm-lock.yaml, etc.)
6. If generated code exists, verify syntax with project toolchain (tsc --noEmit, python -m py_compile, etc.)

**Success Criteria:**
Every refactoring verified against source. Test suite passes. No new SOLID violations introduced.
</task>
```

After verification:
- Revert any incorrect changes immediately
- Fix any new violations introduced
- Report final status to user

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
- Bash(ls:*)
```

## Usage

```bash
# Analyze entire project for SOLID violations
/solid

# Analyze specific directory
/solid src/services/

# Analyze specific file
/solid src/services/UserService.ts

# Focus on specific principle
/solid --principle=D src/
```
