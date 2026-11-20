# Spec-and-tests lens

This lens reports every Spec finding, and test defects as Bug or Maintainability findings.
In a `panel` round, report no other Standards finding.
In a `full` round, this checklist runs next to the other two lens references.

The lists below direct your attention. They do not limit it.
A defect that meets the finding bar and fits this lens counts even when no list names it.

## Spec axis

Read the plan export first: `## Goal`, `## Steps`, `## Acceptance`,
`## Do not touch`, `## Open questions`, and every decision that the plan records.
Map each Goal outcome, each Step task, and each Acceptance row to the diff.
Cite the plan line and the code line in each Spec finding.

Look for:

- Missing or partial work: the diff does not deliver a stated outcome, task, or
  row, or it delivers only part of it.
- Scope creep: the diff adds behavior that the plan does not ask for, or it
  changes a path that `## Do not touch` names.
- Implemented but wrong: the diff resembles the requested change, but its
  behavior differs from the stated result.
- A temporary workaround in place of the root-cause fix, a caller left on a
  replaced path, or an obsolete path that stays, unless `## Open questions`
  records user approval.
- Code that departs from a decision that the plan records.

A step that runs after the landing merge, such as a deploy, is not missing from the diff.

## Tests

Report a test that cannot fail, or a fixture that hides a real defect, as a Bug.
Report missing coverage, or a test of wiring or source text, as Maintainability.

Look for:

- A new branch, refusal, or message without a test of behavior that a consumer
  sees, such as output, an exit code, or file state.
- A test that still passes when its implementation is reverted, for example
  because it asserts on a mock, on a value that the test itself sets, or on
  output that the old code also produced.
- A test that does not run: the runner does not register it, a file pattern
  does not match it, or a skip stays in place.
- A fixture or fake that behaves unlike the real dependency: it returns fields
  that the real query does not select, it ignores a filter, limit, or order, or
  it returns a shape that the real tool never returns.
- A registry, table, schema, or help text that disagrees with what the code
  runs, such as a test list that omits a new test file or a command table that
  names a removed flag.
- A test that checks wiring or source text in place of behavior, such as a grep
  of a source file or an assertion that one module imports another.
- A test that depends on order, time, network, locale, or machine paths, and
  so fails on another machine.

## With the docks skills installed

When the docks skills are installed, you may load the `test-coverage` skill
(`skill://test-coverage`) for test patterns. Keep the output format of this
skill.
