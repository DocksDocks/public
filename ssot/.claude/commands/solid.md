# SOLID Architecture Enforcer

Analyze, identify, and fix SOLID principle violations across the codebase. Uses a multi-phase agent pipeline for thorough analysis and safe refactoring.

> **IMPORTANT - Model Requirement**
> When launching ANY Task agent in this command, you MUST explicitly set `model: "opus"` in the Task tool parameters.
> Do NOT use haiku or let it default. Always specify: `model: "opus"`

---

## ⚠️ MANDATORY: Enter Plan Mode First

**BEFORE doing anything else, you MUST use the `EnterPlanMode` tool.**

This command requires user approval before making any changes. The workflow is:

1. **Enter Plan Mode** → Use `EnterPlanMode` tool NOW
2. **Execute Phases 1-5** → Read-only analysis and verification
3. **Present Plan** → Show user the complete refactoring plan
4. **Wait for Approval** → User must explicitly approve
5. **Execute Phases 7-8** → Only after approval, make changes

**STOP! Use the EnterPlanMode tool now before continuing.**

---

<constraint>
Planning Phase Tools (READ-ONLY):
- Use ONLY: Read, Glob, Grep, Task, Bash(date, ls, git status, git diff)
- Do NOT use: Write, Edit, or any modifying tools (except the plan file)
</constraint>

## Implementation Phase Tools (AFTER APPROVAL)
- Edit, Write, Bash(git:*, npm:*, pnpm:*, yarn:*)

---

## Phase 1: Exploration

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and architecture patterns
- Find the main source directories
- If `.claude/context/_index.json` exists, read it and relevant branch files for project architecture and conventions
- Understand existing abstractions, interfaces, and class hierarchies
- Note dependency injection patterns if present
- Identify the target scope (use $ARGUMENTS if provided, otherwise analyze key modules)
</task>
```

## Phase 2: Discovery

### Discovery

```xml
<task>
Launch a Task agent with model="opus" to act as the DISCOVERY agent:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 3: Analysis

### Analyzer

```xml
<task>
Launch a Task agent with model="opus" to act as the ANALYZER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

## Phase 4: Planner

```xml
<task>
Launch a Task agent with model="opus" to act as the PLANNER:

First, run `date "+%Y-%m-%d"` to confirm current date.

You are the PLANNER. For each SOLID violation, propose a specific refactoring.

<constraint>
- Propose MINIMAL refactorings — fix the violation, not the whole module
- If a context tree exists, check `.claude/context/architecture/` for project patterns before proposing
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
</task>
```

## Phase 5: Verifier

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
</task>
```

<constraint>
After the Verifier produces its results, you MUST write the Planner output and Verifier results to the plan file (path is in the system prompt) using the Write tool. Append under a `## Refactoring Plan` heading. This is mandatory — implementation depends on it surviving context clearing.
</constraint>

## Phase 6: User Approval Gate

**STOP HERE AND PRESENT THE PLAN TO THE USER**

After the Verifier validates the refactoring plan:

1. Present all proposed refactorings organized by phase
2. Show exactly what will be changed (files, patterns, code changes)
3. Explain dependencies between refactorings
4. Ask user to review and approve before proceeding
5. Wait for explicit approval: "approved", "proceed", "yes", or "go ahead"

<constraint>
Do NOT proceed to Phase 7 without explicit user approval ("approved", "proceed", "yes", or "go ahead").
</constraint>

If user requests changes:
- Revise the plan based on feedback
- Present the updated plan
- Wait for approval again

---

## Phase 7: Implementation

Once user has approved the plan:

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
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date.

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
