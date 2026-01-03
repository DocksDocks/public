---
allowed-tools: Read, Bash(pnpm:*), Bash(npm:*), Bash(yarn:*), Bash(cat:*)
description: Audit dependencies with auto-detected package manager
---

# Dependency Audit

Analyze project dependencies for security, updates, and optimization using the detected package manager.

## Phase 0: Project Detection

First, identify the package manager and project type:
1. Check for lock files:
   - `pnpm-lock.yaml` → pnpm
   - `yarn.lock` → yarn
   - `package-lock.json` → npm
2. Check `package.json` for frameworks (Next.js, Expo, Fastify, etc.)
3. Check for monorepo setup (workspaces, turborepo, nx)

Use detected package manager for all commands.

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

## Output Format

### 1. Critical Security Issues
Packages requiring immediate action:
| Package | Severity | CVE | Fix |
|---------|----------|-----|-----|
| name | Critical | CVE-XXXX | Upgrade to vX.X.X |

### 2. Recommended Updates
Safe updates to apply:
| Package | Current | Latest | Type |
|---------|---------|--------|------|
| name | 1.0.0 | 1.2.0 | minor |

### 3. Major Updates (Review Required)
Breaking changes to evaluate:
| Package | Current | Latest | Breaking Changes |
|---------|---------|--------|------------------|
| name | 1.0.0 | 2.0.0 | [Link to changelog] |

### 4. Dependencies to Remove
Unused or redundant packages:
- `package-name`: Not imported anywhere
- `other-package`: Duplicate of X

### 5. Optimization Opportunities
Size or performance improvements:
| Current | Suggested | Savings |
|---------|-----------|---------|
| moment | date-fns | ~200KB |

### 6. License Summary
| License | Count | Packages |
|---------|-------|----------|
| MIT | 45 | ... |
| Apache-2.0 | 12 | ... |
