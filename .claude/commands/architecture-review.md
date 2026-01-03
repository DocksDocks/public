---
allowed-tools: Read, Grep, Glob, Bash(find:*), Bash(wc:*)
description: Architecture and design analysis
---

# Architecture Review

Analyze the project architecture and provide recommendations for improvement.

## Analysis Areas

### Project Structure
- Directory organization
- Module boundaries
- Dependency graph
- Circular dependencies
- Layer separation (presentation, business, data)

### Design Patterns
- Patterns currently in use
- Consistency of pattern usage
- Appropriateness of patterns
- Missing patterns that would help

### Scalability Concerns
- Single points of failure
- Bottlenecks
- State management approach
- Caching strategy
- Database design

### Maintainability
- Code coupling
- Component cohesion
- Abstraction levels
- Configuration management
- Environment handling

### Technical Debt
- Areas needing refactoring
- Deprecated approaches
- Inconsistent implementations
- Documentation gaps

## Output
1. Architecture diagram (Mermaid format)
2. Strengths of current architecture
3. Weaknesses and risks
4. Prioritized improvement recommendations
5. Migration path for major changes
