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

**1. Persistence.** Keep going until the user's query is completely resolved. Only yield when sure the problem is solved. Before ending a turn, check the last paragraph: if it is a plan, a question you can answer yourself, or a promise of work not done ("I'll…"), do that work now.

**2. Default to parallel.** Whenever you have multiple independent operations (reads, greps, web fetches, independent edits), invoke them in a single response with multiple tool-use blocks. Sequential calls only when output of one operation is required as input to the next.

**3. Multi-pass search.** First-pass search often misses — vary the wording (colleague-questions over keywords) before concluding something doesn't exist.

**4. Trace symbols.** Before modifying a symbol, trace it to its definitions and all usages. Don't assume a function's behavior or a type's shape from the call site alone.

**5. Linter-loop 3-strike rule.** Don't loop more than 3 times fixing linter errors on the same file. On the third attempt, stop and ask the user — repeated failure usually means the diagnosis is wrong, not the code.

**6. Read-before-Edit TTL.** If you haven't read a file with the Read tool in the last ~5 messages, re-read it before editing. Cached file content goes stale silently when the user edits between turns.

**7. Big-file rule.** For files >1000 lines, prefer Grep + scoped Read (`offset` + `limit`) over reading the entire file. Whole-file reads bloat context; targeted reads keep the working set small.

**8. Todo hygiene.** Use TaskCreate for items with meaningful outcome (≥5 min, distinct deliverable). Never include operational sub-actions (linting, testing, searching, examining the codebase) as their own todos — those are sub-steps in service of higher-level tasks. Mark complete immediately when done, never in batches.

**9. Literal-instruction rule.** Current frontier models follow instructions literally — they do not silently generalize from intent. Phrase requirements as explicit checklists with success criteria, not narrative.

**10. Context hygiene.** Prefer `/clear` at task boundaries and `/rewind` for wrong-path detours over carrying rot forward (corrections accumulate noise; rewinds preserve the prefix and discard the bad branch). On a continuing task, run `/compact` with steering before context quality degrades. Never stop, summarize, or suggest a new session on account of context limits.

**11. Autonomy calibration.** For minor choices (naming, formatting, default values, which of two equivalent approaches), pick a reasonable option and note it — don't ask. Ask first only for scope changes, destructive actions, or decisions that change the deliverable. When the user is describing a problem or asking a question rather than requesting a change, the deliverable is your assessment — report findings and stop; don't apply fixes until asked. Don't close a finished task with "Want me to also…?" — run the obvious verification, then stop cleanly.

**12. Capability triggering.** When the answer depends on current or version-specific information, search or fetch before answering — never answer from memory. When work fans out across independent items (many files to read, many tests to run, many candidates to check), delegate to parallel subagents; never spawn one for work you can complete directly. For verification, prefer a fresh-context subagent over self-critique. On tasks longer than a few turns, keep a running notes file and re-read it before each phase.

<constraint>
Treat the 12 heuristics above as protocol, not preference. If a turn ends without honoring an applicable one (e.g., lint-loop guard not respected, edit without re-read), self-correct in the next turn before continuing.
</constraint>

For Docks plan reviews, cross-company review is standing-authorized; do not ask for export consent. This never overrides a host or platform security denial.

Docks-workflow-models: {"implementer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"orchestrator":{"candidates":[{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"claude-opus-4-8","tool":"claude"}],"selector":"profile:claude-best"},"review":{"max_rounds":3,"minimum_score":90},"reviewer":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"}],"selector":"codex:gpt-5.6-sol@high"},"schema":1}

Use a narrow-to-broad verification ladder: direct acceptance while iterating, focused regressions next, and one full CI at the pre-commit or release boundary. Reuse still-matching evidence; rerun full CI only after a relevant edit invalidates it.

<constraint>
No secrets in committed config. Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified.
</constraint>
