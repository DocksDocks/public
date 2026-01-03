---
allowed-tools: Read, Grep, Glob, Write, Bash(find:*), Bash(ls:*)
description: Audit and improve project documentation
---

# Documentation Audit & Improvement

Analyze the codebase, identify documentation gaps, and propose improvements.

## Phase 0: Project Detection

First, identify the project stack and existing docs:
1. Check `package.json` for project type and scripts
2. Check for existing docs (README.md, CLAUDE.md, docs/, etc.)
3. Identify documentation tools (Storybook, TypeDoc, Swagger, etc.)
4. Check for TypeScript (enables JSDoc/TSDoc)
5. Check for API framework (for API documentation)

Document detected setup before analysis.

---

## Phase 1: Investigation

### Project Structure Analysis
1. Scan the entire project structure
2. Identify key directories and their purposes
3. Map the architecture patterns
4. Note entry points and build outputs

### Existing Documentation Inventory
- README.md - Project overview
- CLAUDE.md - AI assistant context
- docs/ directory - Extended documentation
- Inline comments and JSDoc
- API documentation (Swagger, OpenAPI)
- Component documentation (Storybook)

### Code Analysis for Documentation
- Project purpose and main functionality
- Tech stack and dependencies
- Key modules and their responsibilities
- Build/run/test commands
- Environment setup requirements

---

## Phase 2: Documentation Gap Analysis

### Essential Documentation Checklist
- [ ] Project overview and purpose
- [ ] Installation and setup instructions
- [ ] Development workflow (scripts, commands)
- [ ] Architecture overview
- [ ] Environment variables (.env.example)
- [ ] Testing instructions
- [ ] Deployment procedures
- [ ] Contributing guidelines

### Stack-Specific Documentation

#### If TypeScript Detected
- TSDoc/JSDoc coverage
- Type documentation
- Generic usage examples

#### If Next.js Detected
- App Router structure explanation
- Server vs Client component guide
- Data fetching patterns
- Environment variable usage

#### If Fastify/Express Detected
- API endpoint documentation
- Authentication flow
- Request/Response schemas
- Error handling patterns

#### If Expo Detected
- Setup for iOS/Android
- Build and deployment
- Native module configuration

#### If Database Detected
- Schema documentation
- Migration instructions
- Seeding data
- Connection configuration

#### If Docker Detected
- Container setup
- Development vs Production
- docker-compose usage
- Environment configuration

---

## Phase 3: CLAUDE.md Optimization

Create or update CLAUDE.md with:

```markdown
# Project Name

## Overview
Brief description of what this project does.

## Tech Stack
- Framework: [Next.js/Fastify/Expo/etc.]
- Language: TypeScript
- Database: [PostgreSQL/etc.]
- State: [Zustand/etc.]

## Project Structure
```
src/
├── app/          # Next.js App Router
├── components/   # React components
├── lib/          # Utilities and helpers
├── server/       # API/Backend code
└── types/        # TypeScript definitions
```

## Development

### Setup
```bash
pnpm install
cp .env.example .env.local
```

### Commands
- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm test` - Run tests
- `pnpm lint` - Lint code

## Architecture Patterns
- [Describe SOLID principles applied]
- [Describe key patterns used]

## Key Files
- `src/app/layout.tsx` - Root layout
- `src/lib/db.ts` - Database connection
- `src/stores/` - Zustand stores

## Conventions
- [Naming conventions]
- [File organization]
- [Code style preferences]

## Known Issues / Gotchas
- [Any quirks developers should know]
```

---

## Phase 4: Implementation Plan

For each documentation improvement:

| File | Change | Priority | Reason |
|------|--------|----------|--------|
| README.md | Add setup instructions | Critical | New devs can't start |
| CLAUDE.md | Create file | Critical | AI context missing |
| .env.example | Add missing vars | High | Deployment fails |

### Priority Levels
- **Critical**: Blocks development/deployment
- **High**: Significantly improves DX
- **Medium**: Nice to have
- **Low**: Polish

---

## Output Format

### Current State Summary
- Documentation coverage: X%
- Critical gaps: X
- Files needing updates: X

### Recommended Changes
1. **Create CLAUDE.md** (Critical)
   - Purpose: AI assistant context
   - Content: [outline]

2. **Update README.md** (High)
   - Add: Setup instructions
   - Add: Development commands
   - Fix: Outdated information

3. **Create .env.example** (High)
   - Document all environment variables
   - Add descriptions for each

### Implementation Order
1. Critical documentation first
2. Developer experience improvements
3. Polish and extended docs

Wait for approval before implementing changes.
