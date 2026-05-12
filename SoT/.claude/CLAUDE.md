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

<constraint>
Research the codebase before editing. Never change code you haven't read.
</constraint>

## Agentic Harness Heuristics

**1. Persistence.** Keep going until the user's query is completely resolved. Only yield when sure the problem is solved. Autonomously resolve to the best of your ability before returning to the user.

**2. Default to parallel.** Whenever you have multiple independent operations (reads, greps, web fetches, independent edits), invoke them in a single response with multiple tool-use blocks. Sequential calls only when output of one operation is required as input to the next. Cap at ~5 concurrent calls to avoid timeouts.

**3. Multi-pass search.** First-pass results often miss key details. Run multiple searches with varied wording. Frame queries as colleague-questions ("How does authentication work?", "Where are user roles checked?") rather than keywords ("AuthService"). Look past the first plausible result; explore alternative implementations and edge cases.

**4. Trace symbols.** Before modifying a symbol, trace it to its definitions and all usages. Don't assume a function's behavior or a type's shape from the call site alone.

**5. Linter-loop 3-strike rule.** Don't loop more than 3 times fixing linter errors on the same file. On the third attempt, stop and ask the user — repeated failure usually means the diagnosis is wrong, not the code.

**6. Read-before-Edit TTL.** If you haven't read a file with the Read tool in the last ~5 messages, re-read it before editing. Cached file content goes stale silently when the user edits between turns.

**7. Big-file rule.** For files >1000 lines, prefer Grep + scoped Read (`offset` + `limit`) over reading the entire file. Whole-file reads bloat context; targeted reads keep the working set small.

**8. Todo hygiene.** Use TaskCreate for items with meaningful outcome (≥5 min, distinct deliverable). Never include operational sub-actions (linting, testing, searching, examining the codebase) as their own todos — those are sub-steps in service of higher-level tasks. Mark complete immediately when done, never in batches.

**9. Literal-instruction rule (Opus 4.7-specific).** Opus 4.7 follows instructions literally — it does not silently generalize from intent. Phrase requirements as explicit checklists with success criteria, not narrative.

**10. Cache-invariance.** Don't insert timestamps, mutable state, or rotating tool definitions into the cached prefix (system prompt, tool sets, opening user message) — they break cache and force cold-start writes. Put dynamic context inside `<system-reminder>` tags within user messages instead. Cache breaks cost ~5× over a clean session. Caches are also per-model: switching Opus→Sonnet mid-session forces a cold-start cache write — use subagents for cross-model work instead.

**11. Compact proactively, not reactively.** Run `/compact` at 50–60% of the compact window rather than waiting for autocompact. The model is at its least intelligent when compaction fires under context rot — reactive compaction loses the very signal you wanted preserved. For wrong-path detours, prefer `/rewind` to a previous turn over chained corrections (corrections accumulate noise; rewinds preserve the prefix and discard the bad branch).

<constraint>
Treat the 11 heuristics above as protocol, not preference. If a turn ends without honoring an applicable one (e.g., lint-loop guard not respected, edit without re-read), self-correct in the next turn before continuing.
</constraint>

## Project Skills

Projects may have a `.claude/skills/` directory with Tool Wrapper skills managed by `/docs`. Claude Code auto-discovers these at session start — only descriptions are loaded, full content loads on demand via the Skill tool.

Skills follow the [agentskills.io](https://agentskills.io) open standard:
- **SKILL.md**: frontmatter (`name`, `description`, `user-invocable: false`, `metadata`) + body (≤500 lines)
- **references/**: on-demand detail files (30-150 lines each), loaded when the skill instructs Claude to read them
- **Discovery**: Claude Code scans `.claude/skills/*/SKILL.md` at session start, loads only `name` + `description` (~100 tokens per skill)
- **Triggering**: Claude semantically matches descriptions against user tasks, invokes via `Skill` tool — no `@import` or pointer tables needed
- **CSO (Claude Search Optimization)**: descriptions MUST start with "Use when..." and describe trigger conditions, not capabilities
- **Third-party / vendored skills**: add an `upstream:` frontmatter block (`source`, `license`, `vendored_at: "YYYY-MM-DD"`) when vendoring a skill from an external repo. This signals `guard-skills.sh` / `score-skills.sh` to relax kit-specific checks (CSO start-prefix, `user-invocable`, `metadata.updated`) so the skill's body can be preserved verbatim from upstream. Universal structural checks (fenced frontmatter, name matches directory, description length, 500-line body cap) still apply.

<constraint>
After any code change affecting documented patterns, update the relevant skill in `.claude/skills/` and its `metadata.updated` frontmatter field. When introducing something new, create a skill or add a `references/` file to an existing skill.
</constraint>

## Project Agents

Projects and the global kit may have a `.claude/agents/` directory containing subagent definitions. Each agent file declares its `model` (`sonnet`/`opus`/`haiku`/`inherit`/full model ID), `tools`, and system prompt. Claude Code auto-discovers them at session start and delegates when a `subagent_type` matches or when a slash command explicitly invokes them.

Agent files follow this structure:
- **Frontmatter**: `name` (kebab-case, matches filename), `description` (CSO — starts "Use when…" with a "Not for…" exclusion clause), `tools`, `model`
- **Body** (≤500 lines): `<constraint>` blocks for non-negotiable rules, `## Workflow` with context-acknowledgment as step 1, `## Output Format`, `## Anti-Hallucination Checks`, `## Success Criteria`
- **Model-selection resolution** (per Claude Code docs): `CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` param → agent frontmatter `model:` → parent conversation. The env var is NOT set in this kit, so per-agent frontmatter controls selection.

<constraint>
When adding a new agent: use kebab-case name matching filename, CSO-compliant description (starts "Use when…", contains a "Not" exclusion clause), explicit `model` and `tools`. Run `bash guard-agents.sh` to verify.
</constraint>

**Validators:** `bash guard-agents.sh` (structural), `bash score-agents.sh` (quality, mirrors `score-skills.sh`).

## Agentic Engineering Discipline

1. **State assumptions before coding.** If a requirement is ambiguous, surface the ambiguity and propose 1–2 concrete interpretations in your first message. Do not silently pick one and proceed.
2. **Minimum code that solves the stated problem.** No speculative features, no abstractions without a second caller, no comments that restate what the code says.
3. **Surgical changes only.** Do not modify code, comments, or formatting outside the explicit scope of the request. Surface unrelated issues as follow-ups — do not fix inline.
4. **State how success will be verified before implementing.** Name the test, build, smoke check, or diff inspection that will prove the change works.

<constraint>
Treat the four rules above as preventive (during generation), not remedial (after the fact). Self-correct if a turn drifts.
</constraint>
