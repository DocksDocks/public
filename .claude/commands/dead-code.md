---
allowed-tools: Read, Grep, Glob, Bash(find:*)
description: Find unused code, functions, variables, and imports
---

# Dead Code Analysis

Identify and report unused code that can be safely removed.

## Analysis Targets

### Unused Exports
- Functions/classes exported but never imported
- Modules with no consumers
- Public API that's never called

### Unused Variables
- Declared but never read
- Assigned but value never used
- Parameters not used in function body

### Unused Imports
- Imported modules/symbols never referenced
- Side-effect imports that may not be needed

### Unreachable Code
- Code after return/throw/break
- Conditions that are always true/false
- Dead branches in switch/if statements

### Deprecated Code
- Functions marked deprecated but still present
- TODO/FIXME comments about removal
- Commented-out code blocks

### Unused Files
- Files not imported anywhere
- Test files for removed code
- Assets not referenced

## Output Format

### Summary
- Total dead code found
- Estimated lines removable
- Risk assessment

### Detailed Report
For each item:
1. **Type**: Variable/Function/Import/File
2. **Location**: File:line
3. **Name**: Identifier name
4. **Confidence**: High/Medium/Low
5. **Safe to Remove**: Yes/Review needed

### Cleanup Script (optional)
Generate commands or a script to remove dead code safely.

⚠️ Note: Some "dead" code might be used dynamically or through reflection. Review before removing.
