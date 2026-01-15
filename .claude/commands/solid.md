# SOLID Architecture Enforcer

Analyze, identify, and fix SOLID principle violations across the codebase. Uses an extended 7-phase agent pipeline for thorough analysis and safe refactoring.

## Phase 0: Environment Check

```bash
# ALWAYS run this first to get the actual current date
date "+%Y-%m-%d"
```

Use this date for any date-related operations. Do NOT assume the year from training data.

## Phase 1: Exploration

```xml
<task>
Use the Task tool to launch an explore agent:
- Run `date "+%Y-%m-%d"` first to confirm current date
- Identify the project stack and architecture patterns
- Find the main source directories
- Understand existing abstractions, interfaces, and class hierarchies
- Note dependency injection patterns if present
- Identify the target scope (use $ARGUMENTS if provided, otherwise analyze key modules)
</task>
```

## Phase 2: Discovery

### Discovery Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the DISCOVERY agent:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

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

### Analyzer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the ANALYZER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

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

## Phase 4: Committee Discussion

### Round 1 - Proposer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the PROPOSER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the PROPOSER. For each SOLID violation, propose a specific refactoring.

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

### Round 2 - Critic Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the CRITIC:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the CRITIC. Challenge each proposed refactoring:

For each refactoring:
1. **Over-engineering Check**: Is this refactoring necessary or is it adding unnecessary complexity?
2. **Breaking Changes**: Will this break existing functionality or APIs?
3. **Test Impact**: Will existing tests need significant changes?
4. **Pattern Appropriateness**: Is the proposed pattern the right choice?
5. **Alternative Approach**: Is there a simpler way to fix this violation?

Also check:
- Are there SOLID violations the Analyzer missed?
- Are any proposed refactorings actually making things worse?
- Are the risk levels accurate?
- Is the scope of each refactoring appropriate?

**Watch for:**
- Premature abstraction (YAGNI)
- Pattern overuse
- Refactorings that don't actually fix the violation
- Changes that would require rewriting half the codebase

Output:
**Refactoring Critiques** (for each: Approve/Modify/Reject with reasoning)
**Missed Violations** (SOLID issues not identified)
**Warnings** (risks to watch during implementation)
</task>
```

### Round 3 - Synthesizer Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the SYNTHESIZER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

You are the SYNTHESIZER. Produce the final refactoring plan.

Review proposer's refactorings and critic's challenges:

1. **Approve** refactorings that passed criticism
2. **Modify** refactorings based on valid concerns
3. **Reject** refactorings that are over-engineered or risky
4. **Add** fixes for violations the critic identified
5. **Order** by dependency (what must be done first)

Output the FINAL REFACTORING PLAN:

## Phase 1: Foundation (Do First)
[Refactorings that other changes depend on]

## Phase 2: Core Violations (Critical)
[Most impactful SOLID fixes]

## Phase 3: Secondary Violations (High Priority)
[Important but less critical fixes]

## Phase 4: Polish (If Time Permits)
[Nice-to-have improvements]

## Rejected Refactorings
[Proposals that shouldn't be done, with reasons]

## Implementation Notes
[Dependencies between refactorings, order matters]
</task>
```

## Phase 5: Implementation

Execute the synthesized refactoring plan:

1. Present the plan to user for approval
2. Implement refactorings in the specified order
3. For each refactoring:
   - Make the code changes
   - Update any affected imports
   - Update tests if needed
4. Run tests after each significant change
5. If a refactoring causes issues, revert and report

## Phase 6: Post-Implementation Verification

### Verifier Agent (Opus 4.5)

```xml
<task>
Launch a Task agent with model="opus" to act as the VERIFIER:

First, run `date "+%Y-%m-%d"` to confirm current date. Use this for any date references.

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
