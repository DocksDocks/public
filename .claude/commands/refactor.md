---
allowed-tools: Read, Grep, Glob, Write
description: Code quality improvement and refactoring analysis
---

# Code Refactoring Analysis

Identify refactoring opportunities to improve code quality, maintainability, and readability.

## Refactoring Categories

### Code Smells
- Long methods/functions (> 50 lines)
- Large classes with too many responsibilities
- Duplicated code across files
- Deep nesting (> 3 levels)
- Long parameter lists (> 4 parameters)
- Feature envy (methods using other class data extensively)
- Data clumps (groups of data that appear together)

### Design Patterns
- Identify where patterns could simplify code
- Remove unnecessary patterns (over-engineering)
- Suggest appropriate patterns for current problems

### SOLID Principles Violations
- Single Responsibility violations
- Open/Closed principle violations
- Liskov Substitution violations
- Interface Segregation issues
- Dependency Inversion problems

### Clean Code Opportunities
- Unclear variable/function names
- Magic numbers and strings
- Missing constants
- Dead code removal
- Commented-out code cleanup
- Inconsistent naming conventions

### Modernization
- Deprecated API usage
- Old syntax that can be modernized
- Missing use of new language features
- Legacy patterns that have better alternatives

## Output Format
For each refactoring:
1. **Location**: File and lines affected
2. **Issue**: Current code smell or problem
3. **Refactoring**: Specific technique to apply
4. **Before/After**: Code comparison
5. **Benefits**: Maintainability, readability, testability improvements

Prioritize refactorings by impact and risk level.
