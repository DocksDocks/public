# AGENTS.md

@RTK.md

## Research Before Implementation

IMPORTANT: Before writing or modifying code that uses any framework, library, or external API, research current documentation first.

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

1. Persistence. Keep going until the user's request is actually handled. Only yield when the problem is solved or a concrete blocker is identified.
2. Default to parallel. When multiple reads, searches, inspections, or independent checks can run without depending on each other, run them together.
3. Multi-pass search. First-pass search results often miss key details. Search with varied wording and trace alternative implementations before settling.
4. Trace symbols. Before modifying a symbol, trace its definition and usages. Do not infer behavior from one call site.
5. Linter-loop 3-strike rule. Do not loop more than 3 times fixing the same lint/test failure without reassessing the diagnosis.
6. Read-before-edit TTL. If you have not read a file recently, re-read it before editing. User edits can make cached context stale.
7. Big-file rule. For files over 1000 lines, prefer targeted search plus scoped reads over whole-file reads.
8. Task hygiene. Track meaningful deliverables, not operational sub-steps. Mark work complete as soon as it is done.
9. Literal-instruction rule. Treat explicit user requirements as checklists with success criteria. Do not silently broaden scope.
10. Cache-invariance. Avoid inserting volatile timestamps or mutable status into long-lived instruction text.
11. Compact proactively. Preserve useful state before context quality decays; prefer clean summaries over chained corrections.

<constraint>
Treat these heuristics as protocol. If a turn violates an applicable rule, self-correct before continuing.
</constraint>

## Engineering Discipline

- Prefer the repository's existing patterns and helpers over new abstractions.
- Keep edits scoped to the user's request and the surrounding ownership boundary.
- Add abstractions only when they remove real complexity or match an established local pattern.
- Preserve user changes. Never revert unrelated dirty work unless explicitly asked.
- Verify with the narrowest useful command first, then broaden if risk warrants it.
- Surface any test or verification you could not run.

<constraint>
No secrets in committed config. Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified.
</constraint>

## Agentic Engineering Discipline

1. **State assumptions before coding.** If a requirement is ambiguous, surface the ambiguity and propose 1–2 concrete interpretations in your first message. Do not silently pick one and proceed.
2. **Minimum code that solves the stated problem.** No speculative features, no abstractions without a second caller, no comments that restate what the code says.
3. **Surgical changes only.** Do not modify code, comments, or formatting outside the explicit scope of the request. Surface unrelated issues as follow-ups — do not fix inline.
4. **State how success will be verified before implementing.** Name the test, build, smoke check, or diff inspection that will prove the change works.

<constraint>
Treat the four rules above as preventive (during generation), not remedial (after the fact). Self-correct if a turn drifts.
</constraint>
