---
allowed-tools: Read, Grep, Glob, Bash(find:*), Bash(wc:*)
description: Architecture review with SOLID principles analysis
---

# Architecture Review

Analyze project architecture, evaluate SOLID principles adherence, and provide improvement recommendations.

## Phase 0: Project Detection

First, identify the project stack and structure:
1. Check `package.json` for frameworks (Next.js, Fastify, Expo, etc.)
2. Check `tsconfig.json` for TypeScript configuration
3. Check directory structure for architecture patterns
4. Check `docker-compose.yml` / `Dockerfile` for infrastructure
5. Check for ORM/database configurations
6. Check for state management setup

Document detected stack before analysis.

---

## SOLID Principles Architecture Analysis

### Single Responsibility (SRP)
- Does each module/directory have a clear, single purpose?
- Are concerns properly separated (UI, business logic, data access)?
- Are there "god modules" doing too much?

### Open/Closed (OCP)
- Can new features be added without modifying existing code?
- Are extension points provided (plugins, hooks, middleware)?
- Is behavior configurable without code changes?

### Liskov Substitution (LSP)
- Are abstractions properly implemented?
- Can implementations be swapped without breaking code?
- Are contracts clearly defined and followed?

### Interface Segregation (ISP)
- Are module interfaces focused and minimal?
- Are clients forced to depend on things they don't use?
- Should large modules be split?

### Dependency Inversion (DIP)
- Do high-level modules depend on abstractions?
- Is dependency injection used appropriately?
- Are external services properly abstracted?

---

## Project Structure Analysis

### Directory Organization
- Is the structure logical and discoverable?
- Are related files colocated?
- Is there a clear separation of layers?

### Module Boundaries
- Are module boundaries clear?
- Is there proper encapsulation?
- Are public APIs well-defined?

### Dependency Graph
- Are there circular dependencies?
- Is the dependency direction correct (inward)?
- Are external dependencies isolated?

---

## Stack-Specific Architecture

### If Next.js Detected
- App Router vs Pages Router consistency
- Server Components vs Client Components separation
- API routes organization
- Middleware usage
- Static vs dynamic rendering strategy

### If Fastify/Express Detected
- Plugin/middleware architecture
- Route organization
- Controller/Service/Repository layers
- Error handling strategy
- Validation approach

### If Expo/React Native Detected
- Navigation structure
- Platform-specific code organization
- Native module handling
- Asset management

### If State Management Detected (Zustand/Redux)
- Store organization and slicing
- Action/selector patterns
- Persistence strategy
- DevTools integration

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, Sequelize, Knex, or raw queries.

**Universal Checks:**
- Schema/model organization
- Migration strategy and tooling
- Connection pooling configuration
- Repository pattern usage
- Transaction handling patterns

**ORM-Specific:**
- **Drizzle**: Schema files, drizzle-kit migrations, `relations()`, prepared statements
- **Prisma**: Schema.prisma organization, prisma migrate, client generation
- **TypeORM**: Entity decorators, migration generation, repository pattern
- **Knex**: Migration files, query builder patterns, seed files

### If Docker Detected
- Service composition
- Network configuration
- Volume management
- Multi-stage build efficiency
- Development vs production configs

---

## Scalability Assessment

- Single points of failure
- Horizontal scaling readiness
- State management approach
- Caching strategy
- Database design and indexing
- Connection pooling

## Maintainability Assessment

- Code coupling levels
- Component cohesion
- Abstraction appropriateness
- Configuration management
- Environment handling
- Documentation coverage

## Technical Debt Inventory

- Areas needing refactoring
- Deprecated patterns in use
- Inconsistent implementations
- Missing abstractions
- Test coverage gaps

---

## Output Format

1. **Architecture Diagram** (Mermaid format)
   ```mermaid
   graph TD
     A[Layer] --> B[Layer]
   ```

2. **SOLID Compliance Summary**
   - SRP: Score and findings
   - OCP: Score and findings
   - LSP: Score and findings
   - ISP: Score and findings
   - DIP: Score and findings

3. **Strengths** of current architecture

4. **Weaknesses and Risks** prioritized by impact

5. **Recommendations** with implementation approach

6. **Migration Path** for major changes (if needed)
