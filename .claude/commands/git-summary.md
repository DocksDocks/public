---
allowed-tools: Bash(git:*)
description: Summarize recent git activity and generate changelog
---

# Git Activity Summary

Analyze recent git activity and provide useful summaries.

## Tasks

### 1. Recent Activity Summary
- Last 10-20 commits with context
- Authors and their contributions
- Files most frequently changed
- Patterns in commit messages

### 2. Generate Changelog
Based on commits since last tag or specified period:
- Group by type (feat, fix, docs, refactor, etc.)
- Extract meaningful descriptions
- Note breaking changes
- Include contributor credits

### 3. Branch Status
- Current branch info
- Uncommitted changes summary
- Ahead/behind status vs main/master
- Stale branches that could be cleaned

### 4. Code Churn Analysis
- Files with most changes (potential hot spots)
- Areas of high activity
- Stability indicators

## Output Format
```markdown
# Changelog

## [Unreleased]

### Added
- Feature descriptions...

### Fixed
- Bug fix descriptions...

### Changed
- Change descriptions...

### Breaking Changes
- Any breaking changes...

## Contributors
- @author1, @author2...
```
