# Phase 8 — Post-Implementation Verification

Verify applied refactorings against the plan via `git diff`, run tests/linter/type-checker, and re-analyze every changed file for NEW SOLID violations introduced while fixing old ones.

<constraint>
Per-finding reproduction before reporting. New SOLID violation: read the `file:line`, confirm the pattern is currently present, quote it. Lint violation: re-run the linter on the file, confirm the rule still fires. Test failure: re-run the specific test, capture output. Type error: re-run the type-checker on the file. DROP any claim that fails reproduction — log under a `#### Dropped (failed reproduction)` subheading inside the `### Phase 8: Post-Verifier Results` block.
</constraint>

## Steps

1. **Applied-change verification** (per diff hunk): dead-code removals leave no dangling refs (search the removed symbol); consolidations updated all call sites; extractions are called from the original location; SOLID refactors actually resolve the stated violation; each change matches the approved plan.
2. **Test suite**: `bun run test` / `npm test` / `pnpm test` / `pytest` / `cargo test` / `go test ./...` — capture full output.
3. **Old-against-new check** (behavior-preserving changes with thin characterization tests): a differential test compares the base version with the changed version. Use it when the existing tests cover little of a changed unit.
   - Put the base commit in a separate worktree: `git worktree add <dir> <base>`.
   - Generate inputs with the project's property library, or sample them from fixtures or real data without secrets.
   - Run both versions on each input. Compare the outputs, the errors, and the side effects that matter.
   - Normalize only fields that change without a change in behavior, such as timestamps and random identifiers. Name each normalization.
   - Each difference that is not on the approved-differences list is a behavior change. Revert the change that caused it.
   - Record the input count and the difference count. Remove the worktree after the check. The method is in the `test-coverage` skill, `references/test-types.md`, section Differential tests.
4. **Linter + type-checker**: `npx eslint` / `ruff check` / `golangci-lint`; `npx tsc --noEmit` / `mypy`.
5. **New SOLID violation check** (the differentiator): re-analyze every refactored file against all 5 principles. Did Extract Class create a new god module? Did Strategy introduce a new enum dispatch? Did composition break a parent contract? Did interface splits create inconsistent impls? Did DI changes add new concrete coupling?
6. **Compliance delta**: by identity `(file, symbol, principle)` — `symbol` is the enclosing class/function/module. Line numbers shift when code moves, so use `line` only as a locator hint, never as part of the key. `surviving` = in both pre and post; `resolved` = pre not surviving; `new` = post not surviving.

## Output (write under `### Phase 8: Post-Verifier Results` in `## Verification Results`)

`Verified Correct` (by plan entry #) · `ERRORS FOUND - Must Revert` (entry, problem, evidence, action) · `New Violations Introduced` (`file:line`, principle, evidence, action: revert) · `Old-Against-New Differences` (input count, difference count, each unapproved difference with its input, or "not run: <reason>") · `SOLID Compliance Delta` · `Summary` (applied/reverted counts, lines removed, files modified/deleted, test/lint/type-check status).

```text
SOLID violations — before: N | after: M | resolved: R | new: N_new
```

Any new violation triggers an immediate revert recommendation for the offending refactoring.

## Gotcha

| Gotcha | Fix |
|---|---|
| Reporting a test failure from a stale run | Re-run the specific test now and capture fresh output before claiming failure |
| Accepting a refactor that resolved one violation but added another | Zero new violations is the bar — revert the offending change |
