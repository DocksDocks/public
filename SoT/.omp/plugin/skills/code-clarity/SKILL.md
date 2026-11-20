---
name: code-clarity
description: "Use when code is hard to understand without narration; improving names, types, function boundaries, comments, docstrings, error messages, or test names; deciding what belongs in code versus documentation; or removing prose that merely restates mechanics. Not for dead-code/duplication sweeps (use refactor), demonstrated SOLID design patterns (use solid), correctness/security review (use code-review), or type design alone (use type-safety-discipline)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "1e0bd7d6d6e2c5e7bd59e09b9c672a842f11ec8a1120cb944af4418ec34b8297"
---

# Code Clarity

Make local mechanics and invariants legible in code while preserving the
rationale and operating knowledge that only documentation can carry.
"Self-explanatory" means the next maintainer can follow behavior without a
parallel narration; it does not mean comment-free or documentation-free code.

<constraint>
Never delete rationale, public contracts, security boundaries, operational
procedures, compatibility promises, or cross-module lifecycle explanations
merely because the implementation is readable. Code explains what happens;
comments and documentation retain why the constraint exists and how the system
must be operated safely.
</constraint>

<constraint>
Treat clarity work as behavior-preserving by default. Establish current
behavior from callers and tests before editing. If clearer code requires a
behavior or public-contract change, split it into a separately named change
with its own acceptance evidence instead of hiding it inside cleanup.
</constraint>

<constraint>
Do not manufacture abstractions for appearance. Extract a Module or Interface
only when it improves Locality around a real change axis or a second Adapter
(a test fake counts) proves the Seam. Otherwise prefer a well-named function,
enum, or local helper over a trait, class, wrapper, or configuration layer.
</constraint>

## Clarity model

Classify each confusing fact before changing it. The destination matters more
than reducing line count.

| Fact | Best home | Evidence that it belongs there |
|---|---|---|
| Local mechanics | Names, control flow, small functions | A reader can follow input to output in one locality |
| Invalid state or transition | Type, constructor, parser, exhaustive match | The compiler or boundary validation rejects it |
| Behavioral example | Focused test with a specific name | The test fails when the behavior is removed |
| Non-obvious invariant | Enforcement + test; short `why` comment if needed | Code proves it and prose explains the surprising constraint |
| Design rationale or rejected alternative | Module docs / architecture docs | It answers "why this design" rather than narrating syntax |
| Public or operational guarantee | User docs / runbook / protocol docs | A consumer or operator needs it without reading source |
| Stale prose duplicating obvious code | Remove after verifying no unique rationale | Deletion loses no decision, guarantee, or recovery knowledge |

## Workflow

### 1. Establish the explanation surface

Read the target, its callers, its tests, and the relevant docs. Write a compact
inventory:

- externally observable behavior;
- state transitions and failure modes;
- names or optional-field combinations that force guessing;
- comments/docstrings/docs that carry unique rationale;
- tests that already function as executable explanation.

Trace symbols before renaming or moving them. For a public function or type,
include downstream call sites and serialized forms; a locally clearer rename
that silently breaks a wire or file format is not a clarity improvement.

### 2. Improve in leverage order

Apply the smallest useful level first. Stop when the confusion is gone.

1. Replace vague or overloaded names with domain vocabulary.
2. Replace invalid optional-field combinations with existing enums, newtypes,
   constructors, or parsers when the type pressure is real.
3. Flatten control flow with early returns and exhaustive matching.
4. Extract a function when it gives one operation a precise name and keeps its
   inputs/outputs narrow; keep tightly coupled state transitions together.
5. Make errors name the failed operation, subject, and recovery condition.
6. Make tests narrate the contract through scenario names and produced values.
7. Rewrite comments and docs only after code/tests expose what can move out.

Escalate structural smells—dead code, widespread duplication, files with
multiple change axes—to `refactor`. This skill may reuse an existing type or
identify type pressure; route a new public identifier, newtype, tagged union,
or serialized-state redesign to `type-safety-discipline`. Use `solid` only after
its smell thresholds and Seam tests are met.

### 3. Keep comments that earn their place

Comments should explain a decision the syntax cannot express: ordering,
security posture, compatibility, platform behavior, or a deliberately rejected
shortcut. Remove comments that restate the next line or preserve obsolete
history better handled by version control.

```rust
// BAD — repeats the assignment and drifts when the field changes.
record.state = FanoutState::Collected; // Mark the record collected.

// GOOD — explains why apparently simpler ordering would violate the contract.
// Persist process-reap evidence before releasing the slot; a crash between
// these writes must retain capacity rather than admit a third worker.
record.state = FanoutState::Collected;
```

Do not convert a necessary module-level lifecycle explanation into scattered
line comments. Keep one durable overview near the owning Module and let local
code use its vocabulary consistently.

### 4. Make tests executable explanation

A clarity test asserts behavior, not implementation choreography. Prefer names
that expose state, trigger, and result:

```rust
// BAD — no contract is visible, and it can pass for the wrong reason.
#[test]
fn works() { assert!(run_case().is_ok()); }

// GOOD — the name and exact value document the fail-closed capacity rule.
#[test]
fn unconfirmed_reap_keeps_the_leaf_slot_occupied() {
    let result = reserve_third_leaf(after_unconfirmed_reap());
    assert_eq!(result.unwrap_err(), "fanout cap reached (2 active descendants)");
}
```

Use the project's existing test style. Keep fixtures at the semantic level the
test needs: a helper named `active_worker` is useful; a generic builder with 14
optional setters usually hides the scenario. Assert outputs, persisted state,
or externally visible effects. A mock-call assertion alone does not explain
the behavior it protects.

## BAD / GOOD transformations

| BAD | GOOD |
|---|---|
| `data`, `item`, `handle`, `process` across a state machine | Domain nouns and verbs: `reservation`, `fence_worker`, `collect_handback` |
| Boolean parameters whose meaning appears only at call sites | Enum variants or two named functions when the modes have different contracts |
| One struct with optional fields valid only in certain states | Rust enum / tagged union when invalid combinations cause real branching |
| Helper called once that merely forwards arguments | Keep the operation local; extract only when the name hides meaningful detail |
| Trait around one concrete filesystem client and no fake | Pass the concrete dependency or function; wait for a real second Adapter |
| Comment narrates syntax | Comment explains ordering, compatibility, threat, or tradeoff |
| README duplicates every internal function | Docs state public contract, rationale, examples, and operation procedures |
| Tests named after methods | Tests named after scenario and outcome |

## Review output

For an assessment-only request, report evidenced findings without editing:

| Field | Content |
|---|---|
| Location | `path` + symbol; add line numbers only in the point-in-time report |
| Guess forced | What the reader cannot infer safely |
| Better home | Code, type, test, comment, module docs, user docs, or runbook |
| Minimal change | Smallest change that removes the guess |
| Preserved knowledge | Rationale/contract that must remain documented |
| Verification | Focused command or mutation that proves behavior stayed intact |

Distinguish required changes from taste. Formatting preference, synonym swaps,
and function extraction without a measurable Locality gain are not findings.

## Verification

Use a narrow-to-broad ladder:

1. Re-read every changed symbol and caller using the final names.
2. Run the focused tests for the behavior whose explanation changed.
3. Check that each removed comment/doc paragraph had no unique rationale,
   guarantee, recovery step, or security boundary.
4. For every rewritten test, ask which production mutation makes it fail; if
   none is concrete, strengthen or remove the test.
5. Run the project's formatter, linter/type checker, and broader CI when the
   repository requires them.
6. Inspect the diff for behavior changes, public-surface drift, and documentation
   loss; split any such change out rather than relabeling it as clarity work.

Success is fewer places where a maintainer must guess, not fewer comments,
shorter files, more abstractions, or a higher raw test count.

## Companion routing

- `refactor`: dead code, duplication, modernization, and structural SOLID work.
- `code-review`: bugs, security, performance, and general maintainability findings.
- `code-guardrails`: lint rule setup and one mapped source for constants and values.
- `type-safety-discipline`: identifier types, external parsing, tagged unions,
  exhaustiveness, and justified classes/newtypes.
- `test-coverage`: behavior already exists and needs meaningful coverage.
- `tdd-workflow`: a new behavior contract should be written test-first.
- `solid`: a demonstrated mixed change axis, fat Interface, growing dispatch,
  or concrete dependency needs a structural pattern.

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
