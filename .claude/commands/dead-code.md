---
allowed-tools: Read, Grep, Glob, Edit, Bash(find:*), Bash(rm:*)
description: Find and remove dead code
---

# Dead Code Remover

Find unused code and **remove it directly**. Do not just report - delete the dead code.

## Phase 0: Project Detection

First, identify the project stack:
1. Check `tsconfig.json` for:
   - Path aliases (`@/*`, `~/*`) - needed to trace imports
   - Base URL configuration
   - Project references (monorepo)
2. Check `package.json` for frameworks (Next.js, Fastify, Expo, etc.)
3. Check `pnpm-workspace.yaml` for monorepo packages
4. Check for build/bundle config (to understand tree-shaking)
5. Identify testing patterns (to avoid flagging test-only code)
6. Check for scripts (`scripts/`, `*.sh`) - identify unused scripts

Adapt detection based on detected stack. Use path aliases when tracing imports.
For monorepos, check cross-package usage.

---

## Universal Dead Code Detection

### Unused Exports
- Functions/classes exported but never imported
- Modules with no consumers
- Public API that's never called
- Index file re-exports not used

### Unused Variables
- Declared but never read
- Assigned but value never used
- Parameters not used in function body
- Destructured but unused

### Unused Imports
- Imported modules/symbols never referenced
- Side-effect imports that may not be needed
- Type-only imports that could be removed

### Unreachable Code
- Code after return/throw/break
- Conditions that are always true/false
- Dead branches in switch/if statements
- Catch blocks that can't be reached

### Deprecated Code
- Functions marked deprecated but still present
- TODO/FIXME comments about removal
- Commented-out code blocks (remove entirely)

---

## Stack-Specific Detection

### If TypeScript Detected
- Unused type definitions
- Unused interfaces
- Unused enums and enum members
- Unused type parameters
- Unused type imports
- `@ts-ignore` comments on removed code

### If React/Next.js Detected

#### Components
- Unused components (not rendered anywhere)
- Unused props in component interfaces
- Unused context providers
- Unused custom hooks
- Unused forwardRef wrappers

#### Next.js Specific
- Unused page files (not linked/routed to)
- Unused API routes
- Unused middleware
- Unused layout/template files
- Unused loading/error files

### If Fastify/Express Detected
- Unused routes
- Unused middleware
- Unused plugins
- Unused schema definitions
- Unused error handlers

### If State Management Detected (Zustand/Redux)
- Unused store slices
- Unused actions
- Unused selectors
- Unused middleware
- Unused persist configurations

### If Database/ORM Detected
First, identify the ORM: Drizzle, Prisma, TypeORM, or raw queries.

**Universal:**
- Unused model/schema definitions
- Unused migrations (applied but code references removed)
- Unused query builders/repository methods
- Unused seeders
- Old migration files after squash

**ORM-Specific:**
- **Drizzle**: Unused table schemas, relations, prepared statements, `$inferSelect` types
- **Prisma**: Unused models in schema.prisma, unused generated types
- **TypeORM**: Unused entity classes, unused repository methods

---

## Files Analysis

### Unused Files
- Files not imported anywhere
- Test files for removed code
- Assets not referenced
- Config files for removed features
- Storybook stories for removed components
- Unused scripts in `scripts/` directory
- Unused workspace packages (monorepo)

### Partial File Usage
- Files with mostly dead code
- Files that should be split
- Legacy files superseded by new ones

---

## Safety Considerations

### May Appear Dead But Isn't
- Dynamically imported modules
- Reflection-based usage
- Framework convention files (pages, routes)
- Entry points defined in package.json
- CLI scripts
- Test utilities
- Build-time code (Babel plugins, etc.)

### Verify Before Removing
- Check git history for recent additions
- Search for string-based imports
- Check build configuration
- Verify not used in other branches

---

## Implementation

**Remove dead code directly:**

1. **High confidence** - Remove immediately:
   - Unused exports, functions, components
   - Commented-out code blocks
   - Unused imports and variables

2. **Medium confidence** - Remove after checking:
   - Verify no dynamic imports
   - Check for string-based usage
   - Then remove

3. **Skip low confidence** - Flag for review:
   - Test utilities
   - Build-time code
   - Framework convention files

**Actions:**
- Delete unused files entirely
- Remove unused exports from files
- Remove unused imports
- Clean up empty files after removal

## Output Format

After removing dead code, report:

### Code Removed
| Type | Location | Name | Action |
|------|----------|------|--------|
| Function | src/utils.ts:45 | `formatDate` | Deleted |
| File | src/legacy.ts | - | Deleted file |

### Summary
- Files deleted: X
- Functions removed: X
- Lines removed: ~X
- Estimated bundle reduction: ~X KB
