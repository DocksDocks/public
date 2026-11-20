# Phase 4a — Role Mapper

> Maps the proposed skill set to logical agent roles. Phase 5 emits each role as one omp task agent, `.omp/agents/<name>.md`; this phase just defines the roles.

Map the Phase 3 proposed skill set to agent roles with single-responsibility boundaries, specific trigger descriptions, and minimal tool sets. Audit existing agents against the new skill paths.

<constraint>
Phase 3 boundary: every proposed agent's domain MUST reference paths from the Phase 3 Skills Plan, not pre-existing or speculative paths. Read Phase 3 first; if a path isn't in that plan, don't list it — otherwise agents land with broken references the moment Phase 3's split/merge/refresh applies.
</constraint>

## Per proposed skill (≥3 distinct claims, clear domain)

Determine an agent role:

| Field | Rule |
|---|---|
| name | kebab-case, ≤64 chars, equal to the agent file name; not `main` or `sub` (omp reserves them); not a bundled agent name (`task`, `scout`, `sonic`, `reviewer`, `security-reviewer`) unless the role overrides that agent |
| description | 3rd person, ≤1024 chars, specific WHAT + WHEN to delegate + scope-exclusion clause; never generic |
| tools | minimal omp tool names — read-only agents get `read`/`grep`/`glob`/`bash`; implementation agents add `edit`/`write`; omit the list for the default set |
| spawns | only for a role that delegates: the child agents it may spawn |
| autoload-skills | the Phase 3 skills the agent needs before its first prompt; a subagent gets no `AGENTS.md` |
| model | never in the agent file; a user pin goes to `task.agentModelOverrides.<agent>` (see `agents-builder.md`) |
| domain | which Phase 3 skills + references/ it covers (Phase-3 paths only) |
| scope boundaries | what it must NOT do, and which agent handles that |

## Method

SRP test: if the agent's scope can't be stated in one sentence, split it. Allow cross-cutting agents (spanning >1 skill) only when scope stays single-responsibility. Skip skills with <3 distinct claims — no agent needed.

## Audit existing agents

Broken skill references (paths gone in Phase 3) → path fix or regenerate. Inlined skill content (long prose, no references) → rewrite-to-reference. Generic/overlapping description → consolidate or split. Audit only `.omp/agents/*.md`; a legacy `.claude/agents/*.md` from Phase 1 goes to `agent-first-setup` (`convert-agent`), not to this roster.

## Output (write under `### Phase 4a: Role Mapper Proposals`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

`Agent Roster (Proposed)` (action create/update/regenerate/delete + the fields above) · `Existing Agent Audit` · `Skipped Skills` · `Cross-Cutting Agents`.

## Gotcha

| Gotcha | Fix |
|---|---|
| Domain cites a current on-disk path | Use the Phase 3 *proposed* path — the current one may be split/merged away |
| Two agents owning the same file domain | Merge or re-bound — overlapping scopes break delegation routing |
