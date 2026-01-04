---
allowed-tools: Read, Grep, Glob, Task, Bash(git:*), Bash(ls:*), Bash(find:*)
description: Summarize git activity and generate changelog
---

# Git Activity Summary

Analyze recent git activity and provide useful summaries.

## Phase 0: Exploration

Use the **Task tool with `subagent_type=Explore`** to understand the repository.

1. **Launch explore agent** to:
   - Map repository structure
   - Identify commit patterns
   - Find CI/CD configuration
   - Understand branching strategy

## Phase 1: Repository Analysis

First, understand the repository:
1. Check current branch and status
2. Identify main/master branch
3. Check for conventional commit usage
4. Identify tag/versioning pattern
5. Check for CI/CD configuration

---

## Tasks

### 1. Recent Activity Summary
- Last 10-20 commits with context
- Authors and their contributions
- Files most frequently changed
- Patterns in commit messages
- Active branches

### 2. Branch Status
- Current branch info
- Uncommitted changes summary
- Ahead/behind status vs main
- Stale branches that could be cleaned
- Feature branches in progress

### 3. Code Churn Analysis
- Files with most changes (potential hot spots)
- Areas of high activity
- Stability indicators
- Recently added files
- Recently removed files

---

## Generate Changelog

Based on commits since last tag or specified period.

### Conventional Commits Detection
If using conventional commits, parse automatically:
- `feat:` → Features
- `fix:` → Bug Fixes
- `docs:` → Documentation
- `refactor:` → Refactoring
- `perf:` → Performance
- `test:` → Tests
- `chore:` → Maintenance
- `BREAKING CHANGE:` → Breaking Changes

### Changelog Format

```markdown
# Changelog

## [Unreleased]

### Features
- feat(auth): Add OAuth2 support (#123)
- feat(ui): New dashboard layout

### Bug Fixes
- fix(api): Handle null response correctly
- fix(db): Connection pool timeout

### Breaking Changes
- refactor(api)!: Change response format

### Other Changes
- docs: Update API documentation
- refactor: Simplify error handling
- test: Add integration tests

## [v1.2.0] - 2024-01-15

### Features
- Previous release features...

---

## Contributors
- @user1 (5 commits)
- @user2 (3 commits)
```

---

## Suggested Commit Format

If not using conventional commits, suggest adoption:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, no code change
- `refactor` - Code change, no feature/fix
- `perf` - Performance improvement
- `test` - Adding tests
- `chore` - Maintenance tasks

### Examples
```
feat(auth): add password reset flow

Implements the forgot password functionality with
email verification.

Closes #123
```

```
fix(api): handle rate limit errors gracefully

Previously the app would crash when rate limited.
Now it shows a user-friendly message and retries.

Fixes #456
```

---

## Branch Cleanup Suggestions

List branches that can potentially be cleaned:
- Merged branches not deleted
- Stale branches (no commits in 30+ days)
- Branches with closed PRs

```bash
# Branches merged into main
git branch --merged main

# Remote branches that are gone
git remote prune origin --dry-run
```

---

## Output Format

### Current Status
```
Branch: feature/new-feature
Ahead of main: 5 commits
Behind main: 2 commits
Uncommitted changes: 3 files
```

### Recent Activity
| Date | Author | Message |
|------|--------|---------|
| 2024-01-20 | @dev | feat: Add new feature |
| 2024-01-19 | @dev | fix: Bug fix |

### Hot Spots (Most Changed Files)
| File | Changes | Last Modified |
|------|---------|---------------|
| src/api.ts | 15 | 2 days ago |
| src/utils.ts | 12 | 1 week ago |

### Changelog Preview
[Generated changelog for unreleased changes]

### Cleanup Recommendations
- X branches can be deleted
- X stale branches to review
