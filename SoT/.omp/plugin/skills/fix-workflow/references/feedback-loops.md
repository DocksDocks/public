# Feedback Loops — The Real Skill

Deep reference for the Step 0 trigger in the parent `SKILL.md`. If you have a tight pass/fail signal for the bug — one that goes red on *this* bug — you will find the cause. Everything else — bisection, hypothesis testing, instrumentation, careful reading — just consumes that signal. No loop, no fix; staring at code without a loop is theatre.

This file owes a debt to Matt Pocock's `diagnosing-bugs` skill (formerly `diagnose`; `github.com/mattpocock/skills`, MIT) — the framing is his; the ranked menu and gotchas are adapted to docks conventions.

## Contents

- [When this applies](#when-this-applies)
- [Redact first](#redact-first)
- [The 10 ways to build a loop, ranked](#the-10-ways-to-build-a-loop-ranked)
- [Tighten the loop](#tighten-the-loop)
- [Non-deterministic bugs — raise the reproduction rate](#non-deterministic-bugs--raise-the-reproduction-rate)
- [Exit check: tight and red-capable](#exit-check-tight-and-red-capable)
- [Minimise](#minimise)
- [When you genuinely cannot build a loop](#when-you-genuinely-cannot-build-a-loop)
- [Anti-patterns](#anti-patterns)
- [Gotchas](#gotchas)
- [References](#references)

## When this applies

- A bug is reported and you are tempted to start reading code immediately.
- A previous attempt at "fix → run full test suite → wait 90s → maybe failing" feels like progress and isn't.
- A flaky test reproduces 5% of the time.
- A perf regression that nobody can measure consistently.
- You've been staring at the file for 10 minutes generating hypotheses without testing any.

## Redact first

Loop work shows commands, outputs, and captured artifacts. Replace every secret with `<REDACTED>` before you show it. Build loops that read credentials from environment variables, so the secret stays in the environment and never appears in a command or its output. Captured artifacts (HAR files, logs, request dumps) carry auth headers and tokens: quote only the lines that carry the signal. If the redacted output is not enough to diagnose the bug, say so and ask the user.

## The 10 ways to build a loop, ranked

Try in roughly this order — earlier methods are usually cheaper and sharper.

1. **Failing test** at whichever seam reaches the bug (unit, integration, e2e). Cheapest signal you can have.
2. **curl / HTTP script** against a running dev server. Often 30 seconds to set up; replays cleanly.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot. Diff = sharp signal.
4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM / console / network.
5. **Replay a captured trace.** Save a real network request, payload, event log, HAR file, or webhook body to disk; replay through the code path in isolation.
6. **Throwaway harness.** Minimal subset of the system (one service, mocked deps) that hits the bug code path via a single function call.
7. **Property / fuzz loop.** "Sometimes wrong output" → 1000 random inputs, look for the failure pattern.
8. **Bisection harness.** Bug appeared between two known states (commit, dataset, dependency version) → automate "boot at state X, check, repeat", feed to `git bisect run`.
9. **Differential loop.** Same input through old-version vs new-version (or two configs) and diff outputs.
10. **HITL bash script (last resort).** If a human has to click, drive *them* with a structured loop (`scripts/hitl-loop.sh`-style) so captured output still feeds back to you. Plain "ask the user to try again" is not a loop.

## Tighten the loop

Treat the loop as a product. Once you have *a* loop, ask:

- **Faster?** Cache setup, skip unrelated init, narrow the test scope, use path or name filters (Jest `--testPathPatterns` on Jest 30+, `--testPathPattern` before it; pytest `-k`).
- **Sharper?** Assert on the specific symptom ("expected 200 OK, got 401"), not "didn't crash" / "exit code 0".
- **More deterministic?** Pin the clock (`vi.useFakeTimers`, `freezegun`), seed RNG, isolate filesystem (`tmp_path`, `mktemp -d`), freeze network (record-replay, MSW), mock external services.

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

## Non-deterministic bugs — raise the reproduction rate

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject `await sleep(1)` between operations to expose races. A 50%-flake bug is debuggable; a 1%-flake bug is not — keep raising the rate until it crosses the debuggable threshold.

```bash
# BAD — re-run the original test and hope
pnpm test session-expiry.test.ts

# GOOD — stress-loop until the bug surfaces predictably
for i in {1..100}; do pnpm test session-expiry.test.ts || break; done
# Add `--repeat-each=20` (Playwright), `pytest --count=20` (pytest-repeat),
# `cargo test -- --test-threads=1 --nocapture` for ordering issues.
```

## Exit check: tight and red-capable

Step 0 is done only when you can name **one command** (a script path, a test invocation, a curl) that you have **already run at least once** — show the invocation and its redacted output — and that is:

- [ ] **Red-capable** — it drives the real bug code path and asserts the user's exact symptom, so it goes red on this bug and green once fixed. "Runs without erroring" does not qualify.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — runs unattended; a human in the loop only through a structured HITL script (method 10).

If you catch yourself reading code to build a theory before this command exists, stop: that is the failure this file prevents. No red-capable command, no Step 2.

## Minimise

Once the loop is red, shrink the repro to the smallest scenario that still goes red. Cut inputs, callers, config, data, and steps **one at a time**, and re-run the loop after each cut. Keep only what the failure needs.

A minimal repro leaves fewer parts to suspect in Step 3 and becomes the clean regression test. Done when every remaining element is load-bearing: removing any one of them turns the loop green.

## When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried (which 3+ methods from the ranked menu, why each failed). Then ask the user for one of:

- (a) Access to whatever environment reproduces it.
- (b) A redacted captured artifact — HAR file, log dump, core dump, screen recording with timestamps, sentry trace, OpenTelemetry span dump.
- (c) Permission to add temporary production instrumentation (with a removal commit pre-staged).

Do **not** proceed to hypothesise without a loop. Generating hypotheses against no signal is how you "fix" three things, ship two new bugs, and never know which one of your changes actually mattered.

## Anti-patterns

| Anti-pattern | Better |
|---|---|
| "I'll add `console.log` and re-run the full suite" | Targeted log with a tag (`[DEBUG-a4f2]`) so cleanup is one grep, run only the specific test |
| Log-everything-and-grep | One probe per hypothesis, mapped to its prediction, inside the Step 2 loop |
| Re-run the same flaky test and hope | Stress-loop 100× to raise the rate, OR pin timing/RNG/clock to make it deterministic |
| "Reproduced it on my machine" with no captured artifact | Save the inputs (curl command, payload file, env vars) so the loop survives session restart |
| Perf regression debugged via logs | Logs lie about perf. Establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect against the baseline. |
| Writing the regression test AFTER the fix lands | Write the failing test first (against the loop), watch it fail, then fix, then watch it pass. The order is the contract. |
| HITL "can you click and tell me what happens" | A structured HITL script that captures stdout/network/screenshots automatically and feeds back into the loop |

## Gotchas

- **`[DEBUG-prefix]` tagging is load-bearing for cleanup.** Untagged debug logs survive into production. A grep for your prefix at Step 6's final verification sweep is one command; reading the diff line-by-line is not.
- **The "correct seam" for the regression test isn't always where the bug surfaced.** If the bug needs 3 callers in sequence, a unit test on the 3rd caller is false confidence. If no correct seam exists, that's itself a finding — flag it for the `refactor` skill (see `solid/references/depth-and-seams.md`).
- **Performance loops measure what they measure.** A 1% regression on a hot path matters; a 50% regression on cold init at boot may not. Baseline the right scenario.
- **Loop construction time is fix-completion time.** A 20-min investment in a 2-sec deterministic loop beats a 2-min investment in a 90-sec flaky one — the difference compounds across every iteration of the fix.
- **Stop and re-Read changed files between iterations of the loop.** If the loop is 90s and the file is 200 lines, you'll forget what you changed by the time it finishes; re-Read before reasoning.

## References

- Parent: `fix-workflow/SKILL.md` — Step 0 (this constraint) and Step 2 (Reproduce, which consumes the loop you build here).
- Companion: `tdd-workflow` — the regression test you write at Step 2 (Reproduce) follows the same red-green-refactor discipline.
- Companion: `solid/references/depth-and-seams.md` — when "no correct seam exists" is the finding, that's an architecture signal.
- Source attribution: framing from Matt Pocock's `diagnosing-bugs` skill (formerly `diagnose`; MIT, `https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md`). The original text of this file was adapted from the `diagnose` version pinned at `https://github.com/mattpocock/skills/blob/694fa30311e02c2639942308513555e61ee84a6f/skills/engineering/diagnose/SKILL.md`; the Redact rule, the exit check, and Minimise come from the current `diagnosing-bugs`.
