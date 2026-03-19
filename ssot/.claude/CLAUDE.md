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

## Project Skills

Projects may have a `.claude/skills/` directory with Tool Wrapper skills managed by `/docs`. Claude Code auto-discovers these at session start — only descriptions are loaded, full content loads on demand via the Skill tool.

Skills follow the [agentskills.io](https://agentskills.io) open standard (works across Claude Code, Gemini CLI, Cursor, and 30+ tools):
- **SKILL.md**: frontmatter (`name`, `description`, `user-invocable: false`, `metadata`) + body (≤500 lines)
- **references/**: on-demand detail files (30-150 lines each), loaded when the skill instructs Claude to read them
- **Discovery**: Claude Code scans `.claude/skills/*/SKILL.md` at session start, loads only `name` + `description` (~100 tokens per skill)
- **Triggering**: Claude semantically matches descriptions against user tasks, invokes via `Skill` tool — no `@import` or pointer tables needed
- **CSO (Claude Search Optimization)**: descriptions MUST start with "Use when..." and describe trigger conditions, not capabilities

<constraint>
After any code change affecting documented patterns, update the relevant skill in `.claude/skills/` and its `metadata.updated` frontmatter field. When introducing something new, create a skill or add a `references/` file to an existing skill.
</constraint>
