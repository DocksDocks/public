# Phase 2b — Logic Analysis

Find flaws that pattern scanning cannot: business-logic abuse, trust-boundary violations, races, and edge cases. Read business-critical paths; verify by reading context, not by inferring from function names.

<constraint>
Every finding needs `file:line` and a concrete trigger scenario (the exact sequence of actions that causes the flaw). Verify by reading the surrounding code — never infer a logic flaw from a name alone.
</constraint>

## Evaluation categories

| Category | Look for |
|---|---|
| Business logic | price/quantity/discount manipulated client-side; double-spend / double-register races; TOCTOU at the app layer; state-machine violations; workflow steps skippable or reorderable |
| Input validation | missing validation on critical inputs (amounts, IDs, roles from client); server vs. client validation drift; string↔number type confusion; integer overflow/underflow; off-by-one in slice/substring |
| Error handling | uncaught exceptions leaking traces/state; catch blocks that grant access on failure; fail-open vs. fail-closed in auth checks; missing null/undefined guards before sensitive ops |
| Concurrency | races on shared mutable state (counters, caches, sessions); TOCTOU check-then-act; missing locks/atomics on critical sections; unhandled promise rejections skipping error paths |
| Edge cases | empty/null/undefined at decision points; MAX_INT / MAX_SAFE_INTEGER boundaries; unicode/encoding (homograph, null byte, RTL override); timezone/DST/leap/epoch; float precision in money math |
| Trust boundaries | server accepting role/permission/price from client without re-verification; service trusting a header set by another service; external API responses used without sanitization/type checks |

## Method

Trace user input from the Phase 1 entry points through handlers to sinks. For each suspicious path, construct the trigger sequence and the attack flow before writing it up.

## Output (write under `## Research` → `### Phase 2b: Logic Findings`)

Group by category. Per finding: `file:line` · Category · Evidence (quote if short) · Trigger scenario · Attack flow (numbered) · Impact · Suggested fix/pattern · Risk tier (low/medium/high). Document a full attack flow for every high-risk finding.

## Gotchas

| Gotcha | Fix |
|---|---|
| Calling something a race without a concrete interleaving | State the two operations and the window between them; if you can't, it's not a finding |
| Flagging "missing validation" the framework enforces | Confirm no upstream middleware/schema validates it first |
