# Phase 5 — Agents Builder

> Drafts each omp task agent as `.omp/agents/<name>.md`. omp discovers project agents only in `.omp/agents/`; it skips `.claude/agents/`, so this phase never writes there.

Assemble complete agent file content (frontmatter + system prompt) for every create/update/regenerate action from the Role Mapper, using Pattern Extractor content for the bodies.

<constraint>
Before writing system-prompt content that references a library / framework / external API, fetch current docs (context7 `resolve-library-id` → `query-docs`, plus official docs). Agent prompts persist across sessions; a hallucinated API propagates to every future interaction that agent handles.
</constraint>

<constraint>
A task subagent gets no `AGENTS.md` context file and no conversation history. The body names every source the agent needs: `autoload-skills` in the frontmatter, a `skill://<name>/references/<file>.md` read, or an explicit file read. A rule that lives only in `AGENTS.md` does not reach the agent.
</constraint>

## Agent frontmatter

```yaml
---
name: api-reviewer                     # string, kebab-case, equal to the file name; not main or sub
description: "Use when reviewing checkout route changes … Not for …"   # string, 3rd person, ≤1024 chars
tools: read, grep, glob                # omp tool names; omit the key for the default tool set
spawns: scout                          # only for an agent that delegates; names the agents it may spawn
autoload-skills: api-context           # skills loaded into the agent before its first prompt
thinking-level: medium                 # optional
---
```

| Key | Rule |
|---|---|
| `name` | Required string, kebab-case, ≤64 chars, equal to the file name. omp refuses `main` and `sub` (reserved) and skips the file. A bundled name (`task`, `scout`, `sonic`, `reviewer`, `security-reviewer`) replaces the bundled agent; use one only when the override is the goal |
| `description` | Required string. omp marks a non-string value invalid and skips the file |
| `tools` | omp tool names (`read`, `grep`, `glob`, `bash`, `edit`, `write`, `web_search`, `task`, …), minimal. Omit the key for the default set. omp adds MCP, extension, and custom tools to every explicit list, so a list is not a hard sandbox |
| `spawns` | The child agents of a delegating agent (`*`, a list, or one name). With `spawns` and an explicit `tools` list, omp adds `task` while the depth allows it. Nested delegation stops at `task.maxRecursionDepth` (default 2) |
| `autoload-skills` | Phase 3 skill names. Unknown names are ignored, so a misspelled name fails silently |
| `thinking-level` | Optional. Omit it unless the role needs a set effort |

Do not emit these keys:

- `model`: a pinned model ID goes stale. omp falls back to the parent session model when the key is absent. The user pins a model per agent with `task.agentModelOverrides.<agent>` in the omp settings, not in the agent file.
- `maxTurns`, `disallowedTools`: omp has no such key.

## System prompt structure (100–200 lines, excl. frontmatter)

`# Role` → one-sentence summary → `<constraint>` (3–5 rules) → `## Context` (skill reads: `skill://<name>/…` paths) → `## Workflow` (numbered) → `## Patterns` (code w/ file:line) → `## Integration` (hand-offs, and the `spawns` children) → `## Gotchas`.

## AI-optimization rules

Constraints at START, gotchas at END. Bullets/tables, no prose. Every claim has a `file:line` OR a skill reference. Positive framing. Codebase code only. No slop. `| Good | Bad | Why |` tables for complex rules. Skill-reference paths MUST be Phase 3 proposed paths, written as `skill://<name>/references/<file>.md` or as the `.agents/skills/<name>/…` file path.

## Special actions

| Action | Handling |
|---|---|
| regenerate | draft fresh file; back up original to `<name>.md.bak` (note in output) |
| delete | list the file under "files to delete" in the plan with the reason; remove it in Phase 7 only after explicit user approval |
| legacy `.claude/agents/<name>.md` | do not draft from it; route it to `agent-first-setup` (`convert-agent`), which prints the omp text for the user to approve |

## Output (write under `### Phase 5: Agents Plan`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

Per agent: `#### File: .omp/agents/<name>.md`, then put the full content in a fenced block whose fence is longer than any fence inside the content (for example four backticks), so the plan helper ignores the file's own `##` headings. For a delegating agent, list its `spawns` children and state whether a child delegates again (depth `task.maxRecursionDepth`).

## Gotcha

| Gotcha | Fix |
|---|---|
| System prompt >200 lines | Move detail into the referenced skills; the prompt is a workflow guide |
| Skill ref to a removed path | Use Phase 3 proposed paths only |
| Body says "follow the project rules" | The subagent has no `AGENTS.md`; name the skill or file to read |
| Explicit `tools` list sold as read-only | omp adds MCP, extension, and custom tools; state that in the report |
| Delegating agent with `tools` and no `spawns` | Without `task` in `tools` it cannot delegate; with `task` in `tools`, omp sets `spawns: *` and it may spawn any agent. Add `spawns` with the child agents to limit the scope |
| `name` differs from the file name, or is `main`/`sub` | Rename; omp skips a reserved name |
