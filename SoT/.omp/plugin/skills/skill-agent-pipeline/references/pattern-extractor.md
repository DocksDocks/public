# Phase 4b — Pattern Extractor

> Produces the agent system-prompt content that feeds the body of each omp agent file (`.omp/agents/<name>.md`).

Extract concrete patterns, workflows, and constraints for each proposed agent role's system prompt — referencing skills rather than inlining their content.

<constraint>
Reference, do not duplicate. Instead of inlining 150 lines of route patterns, write "Read `skill://api-context/references/routes.md` for the full pattern", or list the skill in `autoload-skills`. The system prompt is a workflow guide, not a knowledge dump. Inlined skill content rots the moment the skill changes. A subagent gets no `AGENTS.md`, so every rule the agent needs comes from a named skill or file.
</constraint>

## Per agent role candidate — extract 7 dimensions

Derive role candidates independently from the Phase 3 Skills Plan (don't wait for the Role Mapper — Phase 4 reconciles in Phase 5).

| Dimension | Content |
|---|---|
| Critical constraints | non-negotiable rules for `<constraint>` blocks |
| Workflow steps | numbered procedure with conditions/branching |
| Key file paths | files the agent reads/writes (concrete, from Phase 2b) |
| Patterns with code | short excerpts with `file:line` refs |
| Gotchas | concrete failure scenarios — what breaks, how, why silently |
| Skill references | which SKILL.md + references/ to read (Phase 3 paths as `skill://<name>/…`; explicit read instruction or `autoload-skills`) |
| Integration points | when to hand off, to which agent |

## Sizing

Target 100–200 lines per agent system prompt (excl. frontmatter). Flag any role that would exceed 200.

## Output (write under `### Phase 4b: Pattern Extractor Content`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

Per role: `#### Agent: <name>`, estimated size, then the 7 dimensions as labeled blocks (see the agent-builder reference for the assembled shape).

## Gotcha

| Gotcha | Fix |
|---|---|
| Inlining a skill's body into the prompt | Replace with a Read pointer to the Phase 3 path |
| Skill ref to a pre-existing path | Confirm the path is in the Phase 3 Skills Plan, not just on disk |
