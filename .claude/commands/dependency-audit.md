---
allowed-tools: Read, Bash(npm:*), Bash(yarn:*), Bash(pip:*), Bash(cargo:*), Bash(cat:*)
description: Audit dependencies for security, updates, and optimization
---

# Dependency Audit

Analyze project dependencies for security vulnerabilities, updates, and optimization.

## Checks to Perform

### Security
- Known vulnerabilities (CVEs)
- Deprecated packages
- Unmaintained packages (no updates > 2 years)
- Packages with security advisories

### Updates
- Outdated dependencies
- Major version updates available
- Breaking changes in updates
- Migration guides for major updates

### Optimization
- Unused dependencies
- Duplicate dependencies (different versions)
- Dependencies that can be replaced with native features
- Heavy dependencies with lighter alternatives
- Dev dependencies in production

### License Compliance
- License types in use
- License compatibility
- Commercial use restrictions
- Attribution requirements

## Commands to Run (based on project type)
- Node.js: `npm audit`, `npm outdated`, `npx depcheck`
- Python: `pip-audit`, `pip list --outdated`
- Rust: `cargo audit`, `cargo outdated`

## Output
1. **Critical Security Issues** (fix immediately)
2. **Recommended Updates** with risk assessment
3. **Dependencies to Remove** (unused/redundant)
4. **Optimization Opportunities** (lighter alternatives)
5. **License Summary** (any concerns)
