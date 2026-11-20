# Phase 2b — Pattern Scan

Extract concrete codebase patterns, conventions, and decisions with `file:line` evidence, grouped by domain, for the Skills Builder (Phase 3).

<constraint>
Evidence requirement: every finding carries a `file:line` reference plus a verifiable excerpt or pattern signature. Abstract observations ("good error handling", "uses async") without a source anchor are noise the builder cannot act on. If you cannot point at it, omit it.
</constraint>

Scope note: 2b findings are point-in-time WORKING NOTES consumed by the builder in this same run — `file:line` precision is correct here. The builder (Phase 3) converts them to durable anchors (`path` — `symbol` — purpose — `verify:` command) in the long-lived skill bodies it emits; line numbers never land in a generated SKILL.md.

## Five extraction domains

| Domain | Look for |
|---|---|
| Architecture | entry points + request lifecycle (config/main → handler); module boundaries (import graph); state management (globals, context, stores); error propagation (throw vs return vs middleware) |
| Conventions | file/function/variable naming; import organization (grouped/sorted/aliased); error-handling idioms; logging patterns (levels, structured vs not) |
| API contracts | route definitions (method + path); auth/middleware chains; request/response shapes (types/interfaces); versioning strategy |
| Testing | test file naming + location (colocated vs `__tests__`); mocking approach (`jest.mock`, sinon, factories); fixtures (factories/seeds/snapshots); coverage thresholds |
| Gotchas | non-obvious inter-module deps; legacy patterns NOT to copy; things that break silently (missing env var, wrong import, bad assertion); async traps; env-specific behavior |

## Method

Scan the Phase-1 source directories. Record the exact `file:line` for each finding. Read existing skills first to avoid duplicating what's already documented.

## Output (write under `### Phase 2b: Pattern Scanner Findings`)

Write this subheading inside `## Research`. Use `####` or lower for every block inside it; never write a `##` heading (the plan helper rejects it).

One `####` block per domain (Architecture / Conventions / API / Testing / Gotchas), each finding `file:line` + description + short excerpt. End with a per-domain finding count. Every domain needs ≥1 finding; gotchas need concrete failure scenarios, not abstract warnings.

## Gotcha

| Gotcha | Fix |
|---|---|
| A finding with no `file:line` | Omit it — the builder can't anchor a skill claim to "the project seems to…" |
| Re-documenting what an existing skill already covers | Read current skills in step 1; only record net-new patterns |
