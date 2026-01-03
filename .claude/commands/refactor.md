---
allowed-tools: Read, Grep, Glob, Write
description: Code refactoring analysis with SOLID principles
---

# Code Refactoring Analysis

Identify refactoring opportunities to improve code quality, maintainability, and adherence to SOLID principles.

## Phase 0: Project Detection

First, analyze the project to identify the tech stack:
1. Check `tsconfig.json` / `jsconfig.json` for language
2. Check `package.json` for frameworks (Next.js, Fastify, Express, Expo, etc.)
3. Check lock files for package manager (pnpm-lock.yaml, yarn.lock, package-lock.json)
4. Check for state management (Zustand, Redux, MobX, Jotai, etc.)
5. Check for ORM (Prisma, Drizzle, TypeORM, etc.)

Adapt refactoring suggestions based on detected stack.

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
- Extract queries to repository layer
- Implement unit of work pattern
- Create data transfer objects (DTOs)
- Separate entity models from domain models

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
