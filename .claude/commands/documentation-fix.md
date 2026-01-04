---
allowed-tools: Read, Grep, Glob, Write, Task, Bash(git:*), Bash(find:*), Bash(ls:*)
description: Fix and improve project documentation directly
---

# Documentation Fixer

Analyze the codebase, identify documentation gaps, and **implement fixes directly**. Do not just suggest - write the documentation.

## Phase 0: Project Detection & Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before making changes.

First, identify the project stack and existing docs:
1. Check `package.json` for project type, scripts, and workspaces
2. Check `pnpm-workspace.yaml` for monorepo structure
3. Check `tsconfig.json` for path aliases (document in CLAUDE.md)
4. Check for existing docs (README.md, CLAUDE.md, docs/, etc.)
5. Identify documentation tools (Storybook, TypeDoc, Swagger, etc.)
6. Check for TypeScript (enables JSDoc/TSDoc)
7. Check for API framework (for API documentation)
8. Check for scripts (`scripts/`, `*.sh`) that need documentation

Document detected setup before analysis.

---

## Phase 1: Planning

Before implementing any documentation, create a plan:

1. **Use Task tool** with `subagent_type=Explore` to:
   - Understand the project architecture
   - Identify key modules and their purposes
   - Find existing documentation patterns

2. **Create a documentation plan** listing:
   - Documentation gaps identified
   - Priority order (CLAUDE.md, README, etc.)
   - Content outline for each document
   - Code areas needing JSDoc/TSDoc

3. **Present plan to user** for approval before implementing

---

## Phase 2: Investigation

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

## Phase 3: Documentation Gap Analysis

### Essential Documentation Checklist
- [ ] Project overview and purpose
- [ ] Installation and setup instructions
- [ ] Development workflow (scripts, commands)
- [ ] Architecture overview
- [ ] Environment variables (.env.example)
- [ ] Testing instructions
- [ ] Deployment procedures
- [ ] Contributing guidelines
- [ ] Monorepo structure (if applicable)
- [ ] Script documentation (scripts/*.sh)

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

## Phase 4: CLAUDE.md Optimization

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

## Phase 5: Implement Fixes

**Do not just suggest - implement directly.**

### Priority Order
1. **Critical**: Create/fix CLAUDE.md, README.md, .env.example
2. **High**: Add missing JSDoc/TSDoc to exported functions
3. **Medium**: Document complex logic, add inline comments
4. **Low**: Polish and extended docs

### Implementation Actions

1. **CLAUDE.md** - Create or update with:
   - Project overview
   - Tech stack
   - Project structure
   - Development commands
   - Architecture patterns
   - Key files

2. **README.md** - Ensure it has:
   - Project description
   - Installation steps
   - Usage examples
   - Development setup

3. **.env.example** - Create/update with:
   - All required environment variables
   - Descriptions as comments
   - Example values (non-sensitive)

4. **Code Documentation** - Add directly:
   - JSDoc/TSDoc to public functions
   - Comments for complex logic
   - Type descriptions

---

## Output Format

After implementing fixes, report:

### Changes Made
| File | Action | Description |
|------|--------|-------------|
| CLAUDE.md | Created | Added project context |
| README.md | Updated | Added setup instructions |

### Summary
- Files created: X
- Files updated: X
- Functions documented: X
