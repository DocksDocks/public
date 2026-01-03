---
allowed-tools: Read, Grep, Glob, Write, Bash(find:*), Bash(ls:*)
description: Investigate and improve project documentation including CLAUDE.md
---

# Documentation Audit & Improvement Task

First analyze the codebase, then propose documentation changes before implementing.

## Phase 1: Investigation
1. Scan the entire project structure to understand architecture
2. Identify all existing documentation files (README.md, CLAUDE.md, docs/, *.md, inline comments)
3. Analyze code to understand:
   - Project purpose and main functionality
   - Tech stack and dependencies
   - Key modules and their responsibilities
   - Build/run/test commands
   - Environment setup requirements

## Phase 2: Documentation Gap Analysis
Identify what's missing or outdated:
- [ ] Project overview and purpose
- [ ] Installation and setup instructions
- [ ] Architecture documentation
- [ ] API documentation
- [ ] Code style guidelines
- [ ] Testing instructions
- [ ] Common bash commands
- [ ] Environment variables
- [ ] Deployment procedures
- [ ] Contributing guidelines
- [ ] Troubleshooting guide

## Phase 3: CLAUDE.md Optimization
Update or create CLAUDE.md with:
- Project structure overview
- Key files and their purposes
- Common development commands
- Code conventions specific to this project
- Testing approach
- Known quirks or gotchas
- Dependencies and their purposes

## Phase 4: Implementation
Present a detailed plan of changes before making them. For each documentation file:
- What will be added/updated/removed
- Why this change improves the docs
- Priority level (critical/important/nice-to-have)

Wait for approval before implementing changes.
