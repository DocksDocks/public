# Test types: end-to-end, property, differential, and flaky tests

Use this file in Step 2, when you choose the kind of test for each inventory item. Example-based unit tests stay the default. Add a type from this file when its trigger matches the target.

## Contents

- [Choose a test type](#choose-a-test-type)
- [End-to-end tests](#end-to-end-tests)
- [Property tests](#property-tests)
- [Differential tests](#differential-tests)
- [Flaky tests: rule for agents](#flaky-tests-rule-for-agents)
- [Sources](#sources)

## Choose a test type

| Trigger in the target | Test type |
|---|---|
| A user or another program drives a flow: a UI, a CLI command, an HTTP API, a hook | End-to-end test |
| A function has a rule that holds for all inputs: a parser, a serializer, a normalizer, a sort, a calculation | Property test |
| A change replaces an implementation and must keep its behavior: a refactor, a port, a rewrite, a dependency swap | Differential test |
| One input and one output define the behavior | Example-based unit test (Steps 3 and 4) |

Use the test framework and the libraries that the project already has. If the project has no property library or browser driver, ask the user before you add one. The first constraint of this skill forbids a new framework as a side effect.

## End-to-end tests

An end-to-end test drives the real, running system from outside, the same way a user or a client drives it. Prefer it for user flows. Keep the number small, because each test is slow. Test edge cases with unit and property tests.

1. Start the system the way the project starts it: a dev server, a built binary, or a container. Use the project `verify` skill or the documented start command when one exists.
2. Drive the surface with the matching tool:
   - Web UI: Playwright, or a browser through the Chrome DevTools Protocol (CDP).
   - Mobile app: the platform simulator or emulator.
   - CLI: run the binary with real arguments. Assert on the exit code, stdout, stderr, and the files it writes.
   - HTTP API: send requests to the running service with an API harness. Assert on the status and the body.
3. Assert on a result that the user can see: text on the page, a stored record, a response field.
4. Wait for a condition, not for a fixed time. Playwright actions wait for actionability, and its web-first assertions retry until a timeout.
5. Stop the system and remove the data that the test created.

On a failure, report the step that failed. Attach a screenshot or a trace. In Playwright, `--trace on` records a trace, and `npx playwright show-trace <trace.zip>` opens it.

## Property tests

A property test states a rule for all inputs. The library generates many inputs and checks the rule for each.

| Language | Library | Docs |
|---|---|---|
| JavaScript, TypeScript | fast-check | https://fast-check.dev/docs/introduction/ |
| Python | Hypothesis | https://hypothesis.readthedocs.io/en/latest/ |
| Rust | proptest | https://proptest-rs.github.io/proptest/intro.html |

| Property | Statement | Typical target |
|---|---|---|
| Round-trip | `decode(encode(x))` equals `x` | Parsers, serializers, encoders |
| Invariant | The output keeps a rule, for example a sorted list has the same items in order | Sorts, filters, data structures |
| Idempotency | `f(f(x))` equals `f(x)` | Normalizers, formatters, migrations |
| Equivalence | `f(x)` equals `naive(x)`, a slow and obvious version | Optimized code, caches |

1. Write a generator for valid inputs. Build valid values in the generator. Do not filter out most generated values.
2. Write the property as a function that asserts the rule for one input.
3. Keep one fixed example test for each known edge case next to the property.

Shrinking: the library reduces a failing input to a small counterexample. Report the shrunk value, not the first failing value.

Seed reporting: report the seed and the replay data with each failure, so that another run gets the same input.

- fast-check prints `{ seed, path, endOnFailure }`. Pass these values to the `fc.assert` options to replay the failure.
- Hypothesis saves failures in the `.hypothesis` example database and replays them first. `@seed(<n>)` or `--hypothesis-seed=<n>` fixes the seed. `@example(...)` keeps a found failure as a permanent case.
- proptest writes the seed of each failure under `proptest-regressions/`. Commit these files, so that CI replays the failures.

After a fix, add the counterexample as a fixed example test.

## Differential tests

A differential test runs the old and the new system on the same inputs and compares the outputs. Use it for behavior-preserving work when the existing tests cover little of the behavior.

1. Get the old version: a git worktree at the base commit, the released package, or the old service.
2. Build the inputs: generate them with a property generator, sample them from real data without secrets, or reuse the fixtures.
3. Run both versions on each input. Capture the output, the errors, and the side effects that matter.
4. Normalize fields that change without a change in behavior: timestamps, random identifiers, the order of unordered collections, absolute paths. Name each normalization in the test.
5. Compare the results. Each difference is a defect or an intended change.
6. Keep an approved-differences list. Each entry names the input class, the difference, the reason, and the approver. A difference that is not on the list fails the test.

Do not add a normalization to remove a real difference. That hides the defect.

Report the input count, the difference count, and each unapproved difference with its input.

## Flaky tests: rule for agents

A flaky test passes and fails on the same code. A pass that a retry, a sleep, or a skip produced proves nothing about the code.

<constraint>
Do not add a retry flag, a sleep, or a skip to get a pass. This includes runner retries (`--retries`, `--reruns`, `retries:`, `jest.retryTimes`), fixed waits, and skip marks (`.skip`, `#[ignore]`, `pytest.mark.skip`, `t.Skip`).
</constraint>

1. Reproduce the failure. Run the test many times, alone and in the full suite, in a shuffled order with a fixed seed. Examples: `bun test --rerun-each <n>`, `vitest run --sequence.shuffle --sequence.seed=<n>`, `go test -count=<n> -shuffle=on`.
2. Find the root cause. Check each cause in the table after this list.
3. Fix the cause. Then run the test the same number of times again. Every run must pass.
4. If you find no cause, delete the test. Record the reason in the commit message and in the report. Give the test name, the run count, the failure rate, the causes you checked, and the behavior that lost coverage.

| Cause | Sign | Fix |
|---|---|---|
| Seed | It fails only for some random values | Fix the seed, or make the generator report its seed |
| Clock | It fails near midnight, in another time zone, or on a slow machine | Inject a fake clock |
| Order | It fails alone, or only after one other test | Make the setup of each test complete |
| Shared state | It fails in parallel runs: globals, module caches, database rows, files, environment variables | Isolate the state for each test, and reset it in teardown |
| Network | It fails offline or on a slow call | Stub the network boundary, or use a local server |
| Async race | It fails on a slow machine: a missing `await` or a fixed wait | Wait for the condition |

CI retries and quarantine are a policy for the people who own CI. A quarantined test needs an owner and an end date. The `ci-speed` skill describes this policy in `references/tests.md`, section Flaky tests. An agent does not set up a retry or a quarantine to get a pass.

## Sources

- fast-check: https://fast-check.dev/docs/introduction/, https://fast-check.dev/docs/tutorials/quick-start/read-test-reports/
- Hypothesis: https://hypothesis.readthedocs.io/en/latest/reference/api.html, https://hypothesis.readthedocs.io/en/latest/tutorial/replaying-failures.html
- proptest: https://proptest-rs.github.io/proptest/intro.html, https://proptest-rs.github.io/proptest/proptest/failure-persistence.html
- Playwright: https://playwright.dev/docs/actionability, https://playwright.dev/docs/test-assertions, https://playwright.dev/docs/trace-viewer, https://playwright.dev/docs/test-retries
- Runners: https://nexte.st/docs/features/retries/, https://pytest-rerunfailures.readthedocs.io/, https://pkg.go.dev/cmd/go
