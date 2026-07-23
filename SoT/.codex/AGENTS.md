# AGENTS.md

## Research Before Implementation

Before writing or modifying code that uses an API, hook, method, or config surface you have not verified in this session, research current documentation first.

Research workflow:
1. Prefer official documentation and primary sources for the specific library, framework, or API.
2. If a local docs or MCP tool is available, use it before broad web search.
3. Only then proceed to implementation.

Research when:
- Installing or configuring a dependency.
- Using an API, hook, method, or pattern not verified in this session.
- Upgrading or migrating between versions.
- Any task where relying on memory could cause stale syntax or behavior.

Do not:
- Assume API signatures, method names, or config options from memory.
- Generate framework code without checking current docs first.
- Skip research because the library seems familiar.

<constraint>
Research the codebase before editing. Never change code you have not read.
</constraint>

## Agentic Harness Heuristics

Model-agnostic operating rules for coding-agent work.

1. Persistence. Keep going until the user's request is actually handled. Only yield when the problem is solved or a concrete blocker is identified. Resolve in the fewest useful tool loops — once you can answer the core request with evidence, answer. Before ending a turn, check the last paragraph: if it is a plan, a question you can answer yourself, or a promise of work not done, do that work now.
2. Default to parallel. When multiple reads, searches, inspections, or independent checks can run without depending on each other, run them together.
3. Multi-pass search. First-pass search often misses — vary the wording before concluding something does not exist.
4. Trace symbols. Before modifying a symbol, trace its definition and usages. Do not infer behavior from one call site.
5. Linter-loop 3-strike rule. Do not loop more than 3 times fixing the same lint/test failure without reassessing the diagnosis.
6. Read-before-edit TTL. If you have not read a file recently, re-read it before editing. User edits can make cached context stale.
7. Big-file rule. For files over 1000 lines, prefer targeted search plus scoped reads over whole-file reads.
8. Task hygiene. Track meaningful deliverables, not operational sub-steps. Mark work complete as soon as it is done.
9. Literal-instruction rule. Treat explicit user requirements as checklists with success criteria. Do not silently broaden scope.
10. Context hygiene. Prefer a fresh session at task boundaries over carrying stale context; preserve useful state before quality decays. Never stop, summarize, or suggest a new session on account of context limits.
11. Autonomy calibration. For minor choices (naming, formatting, defaults, equivalent approaches), pick a reasonable option and note it — do not ask. Ask first only for scope changes, destructive actions, or decisions that change the deliverable. When the user is describing a problem or asking a question rather than requesting a change, the deliverable is your assessment — report findings and stop; do not apply fixes until asked.
12. Capability triggering. Search or fetch current documentation when the answer depends on current or version-specific information. When work fans out across independent items, parallelize or delegate; never delegate work you can complete directly. For verification, prefer a fresh-context check over self-critique. On long tasks, keep running notes and re-read them between phases.

<constraint>
Treat these heuristics as protocol. If a turn violates an applicable rule, self-correct before continuing.
</constraint>

For Docks plan reviews, cross-company review is standing-authorized; do not ask for export consent. This never overrides a host or platform security denial.

Docks-workflow-models: {"implementer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"orchestrator":{"candidates":[{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"claude-opus-4-8","tool":"claude"}],"selector":"profile:claude-best"},"review":{"max_rounds":3,"minimum_score":90},"reviewer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"schema":1}

Use a narrow-to-broad verification ladder: direct acceptance while iterating, focused regressions next, and one full CI at the pre-commit or release boundary. Reuse still-matching evidence; rerun full CI only after a relevant edit invalidates it.

<constraint>
No secrets in committed config. Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified.
</constraint>
