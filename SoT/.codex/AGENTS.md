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

## Engineering Discipline

- Prefer the repository's existing patterns and helpers over new abstractions.
- Keep edits scoped to the user's request and the surrounding ownership boundary.
- Add abstractions only when they remove real complexity or match an established local pattern.
- Preserve user changes. Never revert unrelated dirty work unless explicitly asked.
- Verify with the narrowest useful command first, then broaden if risk warrants it.
- Surface any test or verification you could not run.
- Before the first tool call, state in one or two sentences what you are about to do; give a brief progress update every few execution steps.
- Concise teammate tone: no status tics, no log-style updates; reference file paths instead of dumping contents; lead with what changed and why, not a "Summary" heading.
- The final message is for a reader who did not watch the work: outcome first, complete sentences. Shorten by dropping detail, never by compressing into fragments or arrow chains.
- Use a narrow-to-broad verification ladder: direct acceptance while iterating, focused regressions next, and one full CI at the pre-commit or release boundary. Reuse still-matching evidence; rerun full CI only after a relevant edit invalidates it.

<constraint>
No secrets in committed config. Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified.
</constraint>

## Agentic Engineering Discipline

1. **State assumptions; push back when warranted.** If a requirement is ambiguous in a way that changes the deliverable, surface the ambiguity and propose 1–2 concrete interpretations in your first message — do not silently pick one. Surface inconsistencies instead of guessing past them; present tradeoffs when approaches genuinely differ; push back when the request looks wrong.
2. **Minimum code that solves the stated problem.** No speculative features, no abstractions without a second caller, no broad exception handling around internally-trusted calls, no dead code left behind after a refactor, no comments that restate what the code says.
3. **Surgical changes only.** Do not modify code, comments, or formatting outside the explicit scope of the request. Surface unrelated issues as follow-ups — do not fix inline.
4. **State how success will be verified before implementing.** Name the test, build, smoke check, or diff inspection that will prove the change works. Prefer executable criteria — a test that fails before and passes after, a command with expected output — and keep each change small enough that its diff is reviewable in one sitting.
5. **Review scope follows the pipeline.** In pipeline reviews with a downstream filter, report every issue found with confidence and severity — filtering happens downstream. In ad-hoc reviews, flag only gaps that affect correctness or the stated requirements; treat the rest as optional.
6. **Ground every progress claim in evidence.** Before reporting progress or completion, audit each claim against a tool result from this session — show the test output, the command and what it returned. If something is unverified, say so explicitly; if tests fail, say so with the output.

<constraint>
Treat the six rules above as preventive (during generation), not remedial (after the fact). Self-correct if a turn drifts.
</constraint>
