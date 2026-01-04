---
allowed-tools: Read, Grep, Glob, Edit, Write, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Code refactoring analysis with SOLID principles
---

# Code Refactoring Analysis

Identify refactoring opportunities to improve code quality, maintainability, and adherence to SOLID principles.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before making changes.

1. **Launch explore agent** to:
   - Map dependencies and coupling
   - Identify code smells and patterns
   - Find SOLID violations
   - Understand test coverage

## Phase 0.5: Project Detection

Analyze the project to identify the tech stack:
1. Check `tsconfig.json` / `jsconfig.json` for:
   - Path aliases (`@/*`, `~/*`, `@lib/*`, `@components/*`)
   - Compiler options and strict mode
   - Project references (monorepo)
2. Check `package.json` for frameworks (Next.js, Fastify, Express, Expo, etc.)
3. Check `pnpm-workspace.yaml` for monorepo structure
4. Check lock files for package manager (pnpm-lock.yaml, yarn.lock, package-lock.json)
5. Check for state management (Zustand, Redux, MobX, Jotai, etc.)
6. Check for ORM (Prisma, Drizzle, TypeORM, etc.)
7. Check for scripts (`scripts/`, `*.sh`) that could be improved

Adapt refactoring suggestions based on detected stack and use project's path aliases in examples.

---

## Phase 1: Planning

Before implementing any refactoring, create a plan:

1. **Use Task tool** with `subagent_type=Explore` to:
   - Map dependencies and coupling
   - Identify code smells and patterns
   - Understand test coverage

2. **Create a refactoring plan** listing:
   - Each refactoring with affected files
   - SOLID principle or code smell addressed
   - Step-by-step approach
   - Risk assessment and testing needs

3. **Present plan to user** for approval before implementing

---

## Phase 2: Verification (Multi-Agent)

Before refactoring, **launch multiple agents in parallel** to verify:

```
Use Task tool to launch these agents simultaneously:
```

1. **Agent 1 - Code Smell Verification**: Confirm issues warrant refactoring
2. **Agent 2 - Dependency Impact**: Map all code that will be affected
3. **Agent 3 - Test Coverage Check**: Verify tests exist to catch regressions

**Cross-check results:**
- All agents must agree on refactoring necessity
- High-risk changes require comprehensive tests
- Only proceed when impact is understood

---

## SOLID Principles Analysis (Primary Focus)

### Single Responsibility Principle (SRP)
- Classes/modules doing too many things
- Functions with multiple reasons to change
- Components mixing UI, logic, and data fetching
- Files that are "god objects"

### Open/Closed Principle (OCP)
- Code requiring modification instead of extension
- Missing abstractions for varying behavior
- Hardcoded conditionals that should be polymorphic
- Switch statements that grow with new cases

### Liskov Substitution Principle (LSP)
- Subclasses breaking parent contracts
- Overridden methods changing expected behavior
- Type checks for specific subclasses
- Exceptions thrown by derived classes unexpectedly

### Interface Segregation Principle (ISP)
- Large interfaces forcing unused implementations
- Clients depending on methods they don't use
- "Fat" interfaces that should be split
- Optional properties that should be separate types

### Dependency Inversion Principle (DIP)
- High-level modules depending on low-level details
- Missing dependency injection
- Concrete classes instead of abstractions
- Tight coupling to external services

---

## Code Smells

### Structural Issues
- Long methods/functions (> 30-50 lines)
- Large files with too many responsibilities
- Deep nesting (> 3 levels)
- Long parameter lists (> 4 parameters)
- Duplicated code across files

### Design Issues
- Feature envy (methods using other class data extensively)
- Data clumps (groups of data that appear together)
- Primitive obsession (using primitives instead of small objects)
- Inappropriate intimacy (classes too tightly coupled)

---

## Stack-Specific Refactoring

### If TypeScript Detected
- Replace `any` with proper types
- Add generics where type relationships exist
- Extract shared types to dedicated files
- Use discriminated unions over type assertions
- Leverage utility types (Partial, Pick, Omit, etc.)
- Convert relative imports (`../../`) to path aliases (`@/lib/`, `@/components/`)
- Organize types using project's alias structure

### If React/Next.js Detected
- Extract custom hooks for reusable logic
- Split large components into smaller ones
- Move business logic out of components
- Use composition over prop drilling
- Extract shared UI patterns to components

### If Fastify/Express Detected
- Extract route handlers to controllers
- Create service layer for business logic
- Use plugins/middleware for cross-cutting concerns
- Implement repository pattern for data access
- Extract validation schemas

### If State Management Detected (Zustand/Redux/etc.)
- Split large stores into slices
- Extract selectors for derived state
- Separate sync and async actions
- Colocate related state and actions

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

**Universal Refactoring:**
- Extract queries to repository layer
- Implement unit of work pattern for transactions
- Create data transfer objects (DTOs)
- Separate entity models from domain models
- Organize schemas/models by domain

**Repository Pattern (works with any ORM):**
```typescript
// Generic repository interface
interface UserRepository {
  findById(id: string): Promise<User | null>
  create(data: CreateUserDTO): Promise<User>
  update(id: string, data: UpdateUserDTO): Promise<User>
  delete(id: string): Promise<void>
}

// Implement with your ORM
// - Drizzle: db.query.users.findFirst(), db.insert()
// - Prisma: prisma.user.findUnique(), prisma.user.create()
// - TypeORM: repo.findOne(), repo.save()
```

This allows swapping ORMs without changing business logic.

---

## Clean Code Opportunities

- Unclear variable/function names
- Magic numbers and strings → named constants
- Commented-out code → remove entirely
- Inconsistent naming conventions
- Missing error boundaries/handling

## Modernization

- Deprecated API usage
- Old patterns with better alternatives
- Missing modern language features
- Legacy code that can be simplified

---

## Output Format

For each refactoring opportunity:
1. **Location**: File and lines affected
2. **Principle**: Which SOLID principle or code smell
3. **Issue**: Current problem description
4. **Refactoring**: Specific technique to apply
5. **Before/After**: Code comparison showing the change
6. **Benefits**: Maintainability, testability, readability gains

Prioritize by:
1. SOLID violations (architectural impact)
2. Code smells affecting maintainability
3. Modernization opportunities
