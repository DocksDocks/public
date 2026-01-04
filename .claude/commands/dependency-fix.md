---
allowed-tools: Read, Edit, Task, Bash(git:*), Bash(pnpm:*), Bash(npm:*), Bash(yarn:*), Bash(cat:*)
description: Fix dependency issues
---

# Dependency Fixer

Analyze dependencies and **fix issues directly** - update vulnerable packages, remove unused deps, and apply safe updates.

## Phase 0: Project Detection & Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the codebase before making changes.

First, identify the package manager and project type:
1. Check for lock files:
   - `pnpm-lock.yaml` → pnpm
   - `yarn.lock` → yarn
   - `package-lock.json` → npm
2. Check `package.json` for:
   - Frameworks (Next.js, Expo, Fastify, etc.)
   - Workspaces configuration
3. Check `pnpm-workspace.yaml` for monorepo packages
4. Check for monorepo tools (Turborepo, Nx, Lerna)
5. Check for shared packages in workspace

Use detected package manager for all commands. For monorepos, audit each workspace.

---

## Phase 1: Planning

Before implementing any fixes, create a plan:

1. **Use Task tool** with `subagent_type=Explore` to:
   - Understand how dependencies are used
   - Check for breaking change impacts
   - Identify test coverage for affected areas

2. **Create a dependency fix plan** listing:
   - Vulnerabilities to fix (with CVE references)
   - Packages to update (current → target version)
   - Packages to remove (with reason)
   - Breaking changes requiring code updates

3. **Present plan to user** for approval before implementing

---

## Security Checks

### Vulnerability Scan
Run the appropriate audit command:
- **pnpm**: `pnpm audit`
- **yarn**: `yarn audit`
- **npm**: `npm audit`

Check for:
- Known CVEs in dependencies
- Deprecated packages
- Packages with security advisories
- Unmaintained packages (no updates > 2 years)

### Severity Levels
- **Critical**: Actively exploited, patch immediately
- **High**: Exploitable, patch soon
- **Moderate**: Needs specific conditions
- **Low**: Defense in depth

---

## Update Analysis

### Check Outdated
Run the appropriate command:
- **pnpm**: `pnpm outdated`
- **yarn**: `yarn outdated`
- **npm**: `npm outdated`

Categorize updates:
- **Patch updates**: Safe, bug fixes only
- **Minor updates**: New features, backward compatible
- **Major updates**: Breaking changes, review needed

### Breaking Change Assessment
For major updates, note:
- Migration guides available
- Breaking changes listed
- Ecosystem compatibility

---

## Stack-Specific Checks

### If Next.js Detected
- Check React version compatibility
- Verify Next.js peer dependencies
- Check for deprecated Next.js APIs in deps
- Verify Turbopack compatibility if using

### If Expo Detected
- Check Expo SDK compatibility
- Verify native module versions
- Check for incompatible React Native versions
- Verify Expo Go compatibility

### If Fastify Detected
- Check plugin compatibility
- Verify TypeScript types versions
- Check for deprecated plugins

### If UI Library Detected (shadcn, etc.)
- Check component dependencies
- Verify Tailwind CSS version
- Check Radix UI versions

### If Database/ORM Detected
- Check driver versions
- Verify type definition versions
- Check for breaking schema changes

---

## Optimization Analysis

### Unused Dependencies
Run dependency check:
- **pnpm**: Check with `depcheck` or analyze imports
- Identify packages in package.json but not imported
- Check for phantom dependencies

### Duplicate Dependencies
- Different versions of same package
- Peer dependency conflicts
- Hoisting issues in monorepos

### If Monorepo/Workspaces Detected
- Check each workspace for vulnerabilities
- Verify `workspace:*` protocol usage for internal deps
- Check for version mismatches across workspaces
- Identify shared vs workspace-specific deps
- Run: `pnpm -r audit` for recursive audit

### Bundle Impact
For frontend projects:
- Large dependencies with smaller alternatives
- Dependencies that could be dev-only
- Polyfills no longer needed

### Suggested Replacements
| Heavy Package | Lighter Alternative |
|---------------|---------------------|
| moment | date-fns, dayjs |
| lodash | lodash-es, native methods |
| axios | fetch, ky |
| uuid | crypto.randomUUID() |

---

## License Compliance

Check licenses for:
- GPL/AGPL (copyleft concerns)
- Commercial use restrictions
- Attribution requirements
- License compatibility with project

---

## Implementation

**Fix dependency issues directly:**

1. **Critical vulnerabilities** - Fix immediately:
   ```bash
   pnpm update vulnerable-package
   ```

2. **Safe updates** (patch/minor) - Apply:
   ```bash
   pnpm update
   ```

3. **Remove unused** - Delete:
   ```bash
   pnpm remove unused-package
   ```

4. **Major updates** - Apply if no breaking changes affect project

**Actions to take:**
- Run `pnpm audit fix` for automatic fixes
- Update vulnerable packages to safe versions
- Remove packages not imported anywhere
- Replace heavy packages with lighter alternatives

## Output Format

After fixing dependencies, report:

### Actions Taken
| Action | Package | Details |
|--------|---------|---------|
| Updated | lodash | 4.17.20 → 4.17.21 (CVE fix) |
| Removed | unused-lib | Not imported |
| Replaced | moment | Switched to date-fns |

### Summary
- Vulnerabilities fixed: X
- Packages updated: X
- Packages removed: X
- Bundle size saved: ~X KB
