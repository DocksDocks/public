@RTK.md

## Research Before Implementation

IMPORTANT: Before writing or modifying code that uses any framework, library, or external API, you MUST research current documentation first.

**Research workflow:**
1. Use `resolve-library-id` → `query-docs` (context7) to fetch up-to-date docs for the specific library/framework
2. If context7 doesn't cover it, use `WebFetch` on official documentation
3. Only then proceed to implementation

**When to research:**
- Installing or configuring a dependency
- Using an API, hook, method, or pattern you haven't verified in this session
- Upgrading or migrating between versions
- Any task where you'd otherwise rely on training data for syntax/behavior

**Do NOT:**
- Assume API signatures, method names, or config options from memory
- Generate framework code without checking current docs first
- Skip research because the library "seems familiar"

This prevents hallucinated APIs, deprecated patterns, and version mismatches.

## Context Tree

Projects may have a `.claude/context/` directory with a B-tree knowledge hierarchy managed by `/docs`.

<constraint>
If the project's CLAUDE.md contains `@context/` imports, those branch files are auto-loaded at session start. When you need topic-specific details, follow the branch's pointer table to read the leaf file. After any code change affecting documented patterns, follow the Context Tree Maintenance protocol in the project's CLAUDE.md.
</constraint>
