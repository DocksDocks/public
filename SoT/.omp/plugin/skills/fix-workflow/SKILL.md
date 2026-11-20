---
name: fix-workflow
description: Use when fixing a specific bug, security finding, performance regression, dependency vulnerability, or dead-code report — given either a path to scan, a bug description, or a list of findings (e.g. from the security skill or code-review). Produces a tiered fix plan with blast-radius analysis, test strategy, and revert triggers per change. Not for full security audits (use the security skill). Not for refactoring-driven cleanup (use the refactor skill).
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "012c56bdf5d80f6566cfc7a4f3711e5d6961512a965302b7a36e7bdbbdbf8016"
---

# Fix Workflow

<constraint>
Step 0 — before anything else: build a feedback loop. If you have a tight pass/fail signal for the bug — one that goes red on *this* bug — you will find the cause; bisection, hypothesis testing, and instrumentation all just consume that signal. Without one, "fixing" is speculation. The ranked menu of 10 loop-construction methods, the Redact rule, the tighten rules, non-deterministic-bug handling, the "tight / red-capable" exit check, and the "when you genuinely cannot build a loop" stop-and-ask procedure live in [`references/feedback-loops.md`](references/feedback-loops.md). Step 0 ends only when that exit check passes. Spend disproportionate effort here — a 2-second deterministic loop is a debugging superpower; a 90-second flaky one is barely better than nothing.
</constraint>

<constraint>
Each fix MUST have a revert trigger declared up-front. "If test X fails after this change, run `git restore <file>`" — written down before the fix lands. A fix without a pre-declared revert trigger is a fix you cannot back out cleanly when CI flips red, and that's how regressions ship.
</constraint>

<constraint>
Reproduce a reported bug BEFORE fixing it. If the user describes a specific failure ("session expires immediately after login"), write or run an existing test that demonstrates the failure first. A "fix" without a reproduction is speculation — it may move the bug rather than eliminate it. Reproduction is the contract that says the fix actually fixes something.
</constraint>

<constraint>
Tier fixes by blast radius. Tier 1 = local change, single file, has a test (low risk). Tier 2 = cross-file change touching ≤5 files (medium risk). Tier 3 = architectural change touching shared interfaces or multiple modules (high risk). Apply Tier 1 first; require explicit approval per Tier 3 fix. Bundling tiers in one go makes the revert mechanic unworkable when one tier breaks.
</constraint>

## When to Use

- A bug is reported — user describes a failure mode, you want to find and fix root cause
- A security finding (from the `security` skill, the `code-review` skill, or a dependency advisory) needs a fix
- Dependency audit (`bun audit` / `pnpm audit` / `npm audit` / `pip-audit`) returns vulnerable packages
- A linter / type-checker reports issues across a path and the user wants them resolved
- Dead-code report (`knip` / `depcheck` / `ts-prune` / `vulture`) needs cleanup

NOT for:
- Full adversarial security audits — see the `security` skill (sequential 5-phase OWASP pipeline with adversarial hunt + synthesis)
- Architectural refactors with SOLID and per-principle analysis — see the `refactor` skill
- Adding new features (use `tdd-workflow` for test-first or just write the code)

## When to Load Per-Finding-Type Templates

The universal 6-step procedure below applies to every fix. For finding-type-specific test strategies, revert triggers, and anti-patterns, load one of these:

| Finding type | Reference file |
|---|---|
| Building / iterating / debugging the loop itself (Step 0 + Step 2) | `references/feedback-loops.md` |
| CVE / GHSA / dependency vulnerability / security audit finding | `references/security-fix-templates.md` |
| Performance regression / slow query / N+1 / render cascade | `references/perf-fix-templates.md` |
| Functional bug reproducible via test / crash / wrong-output | `references/bug-fix-templates.md` |

## The Six-Step Procedure

### Step 1 — Stack and scope

Establish what runs and what's in scope:

- Test runner: `package.json` `scripts.test` / `pytest.ini` / `cargo test` / `go test ./...`
- Type-checker: `npx tsc --noEmit` / `mypy` / `ruff check`
- Linter: `npx eslint` / `ruff` / `golangci-lint`
- Audit tool: `bun audit` / `pnpm audit` / `npm audit` / `pip-audit` / `cargo audit`

Run `git status --short` and `git log --oneline -5` for context. If the working tree isn't clean, ask the user whether to stash, commit, or proceed — fixing on a dirty tree pollutes the diff.

### Step 2 — Reproduce (only when fixing a specific bug)

Skip this step if scope is "scan a directory" or "fix the audit report." Run it when the user gave you a bug description.

This step consumes the feedback loop you built per the Step 0 constraint (`references/feedback-loops.md`). If you skipped Step 0 because the loop "felt obvious," check the ranked menu — odds are there's a sharper, more deterministic option than the one you would have written by reflex.

- Find or write a failing test that demonstrates the bug (or whichever loop method from the menu fits this bug)
- If existing test infrastructure exists: try the smallest possible test first (single function, mocked dependencies)
- If no test infrastructure: STOP and discuss with the user — adding a test framework is a separate task
- Confirm the failure before continuing. "I think I see why this happens" is not reproduction.
- For non-deterministic bugs: raise the reproduction rate before debugging (loop 100×, pin clock/RNG, freeze network). 1%-flake is not debuggable; 50% is. See `references/feedback-loops.md` § Non-deterministic bugs.
- Once the loop is red, minimise the repro before Step 3 — see `references/feedback-loops.md` § Minimise.

### Step 3 — Discover (parallel by default)

Run two passes against the scope, ideally in the same turn — whenever you have multiple independent operations (reads, greps, fetches, independent edits), invoke them concurrently rather than sequentially:

**Code-quality pass** — find bugs, dead code, refactoring opportunities, performance issues:

```bash
# Adapt to project's actual tools — these are starting points
npx tsc --noEmit                            # type errors
npx eslint src/ --max-warnings=0            # lint errors
npx knip --reporter=compact                 # dead exports
ruff check . && mypy .                      # python equivalent
go vet ./... && staticcheck ./...           # go equivalent
```

**Dependency pass** — vulnerabilities, outdated, unused, missing peers:

```bash
bun audit --audit-level=high                # high-and-critical JS CVEs
pnpm audit --prod                           # runtime CVEs
pip-audit                                   # python CVEs
cargo audit                                 # rust CVEs
govulncheck ./...                           # go CVEs (reachability-aware)
```

Capture each tool's actual output (stderr + stdout, exit code). Don't paraphrase.

### Step 4 — Plan tiered fixes

For each finding, fill in this template before writing any code:

| Field | Required content |
|---|---|
| Tier | 1 (local), 2 (cross-file ≤5), or 3 (architectural) |
| Files | Exact file:line refs |
| Before | The current code |
| After | The proposed code |
| Why | Root cause, in one sentence |
| Test strategy | Existing test that covers it, or new test to add |
| Revert trigger | Specific test/lint that, if it flips, triggers `git restore` |
| Blast radius | What else touches this code path |

Normalize upstream findings into these fields before planning. For a `security` finding, map `location` plus `evidence` to **Files/Before**, `remediation` to **After**, `CWE` plus `exploitation` to **Why/Blast radius**, and derive **Test strategy/Revert trigger** from the exploitation path and its narrowest deterministic signal. For a `code-review` line (`SEVERITY / category / locator / defect / fix`), map `locator` plus `defect` to **Files/Before**, `fix` to **After**, `SEVERITY` plus `category` and `defect` to **Why/Blast radius**, and derive **Test strategy/Revert trigger** from the defect's observable behavior.

Route any fix with non-local effects through the `plan-manager` skill (from the docks-kit kit plugin); do not treat the local fix table as approval to bypass that lifecycle.
Show the user the table grouped by tier. If the plan contains any Tier 2/3 fix, ask for approval with the omp `ask` tool. Put all open questions for this plan in one form; `ask` takes one form per call. Do not call `edit` or `write` until the user approves. An error, a cancel, or a timeout result is not approval: write nothing and end the turn. Silence is not consent; an ambiguous answer means show the table again. A plain-text "Approve? yes/no" in the reply is wrong when `ask` is available. If `ask` is not available or returns an error (for example, in a headless subagent or a print-mode run), put the table and the open questions in your final answer and end the turn. Do not invent a tool call. A Tier-1-only plan may proceed directly.

**For finding-type-specific test strategies and revert triggers**, load the matching reference file from the routing table above.

### Step 5 — Pre-verify against the codebase

Before applying, validate each proposed fix:

- **Read every cited file:line** — confirm the "before" code matches what's actually there
- **Spot-check 5+ refs** — if any are wrong, redo the analysis (your search may have been stale)
- **Validate the "after" code** — does it compile? Does it import correctly? Do referenced symbols exist?
- **Check the test strategy** — does the named test actually exist and exercise this path? Run it BEFORE the fix to confirm it's currently passing (or failing as expected, for bug reproductions)

Reject any fix that fails these checks. A fix list with rejected items is fine; a fix list of fragile guesses is not.

### Step 6 — Apply, verify, revert if needed

```bash
# 1. Apply Tier 1 fixes first (lowest blast radius)
# Use Edit for in-place changes, git rm for dead-code removal

# 2. After each fix (or each tier), run the verification:
pnpm test path/to/affected.test.ts && \
  npx tsc --noEmit && \
  npx eslint <changed-files>

# 3. If the revert trigger fires, restore immediately:
git restore <file>
# Document in the plan: "Tier 2 fix #3 reverted — broke unrelated.test.ts"

# 4. Move to next tier only if previous tier's verification passed
```

After all approved fixes land, run the full verification sweep (tests + lint + type-check). Report final state: what landed, what was reverted, what's still pending.

## Common Traps

| Trap | Wrong fix | Right fix |
|---|---|---|
| "Fix" applied without reproducing | Skip Step 2; just rewrite suspicious code | Reproduce first; the fix proves it works only if the reproduction now passes |
| All fixes lumped into one commit | "Apply all 23 findings in one big PR" | Tier-based grouping, one commit per tier minimum |
| Revert trigger declared after the fact | "If anything breaks, we'll figure it out" | Pre-declare the specific test/lint that, if it flips, triggers revert |
| Fix changes a public API to dodge a private failure | Mutate signature of exported function to make tests pass | Keep API stable; fix internally; if API must change, that's a separate Tier 3 fix |
| Dependency upgrade bundled with feature work | "Bumped React + added the new feature" | Security-driven dependency bumps go in their OWN commit (see `dep-vuln-workflow` skill) |
| Treating linter warnings as fixes | Sweep all `// eslint-disable` to silence warnings | Fix the underlying issue; suppression is not a fix (see `lint-no-suppressions` skill) |
| Pre-verifier skipped because "I just read the code" | Memory-based reference checking | Re-read files before applying fixes; cited line numbers rot fast |
| Test missing → write a fix anyway | "I'll add a test in the next commit" | The test that proves the fix IS the contract; without it, the fix is unverified |

## Pairing With Other Skills

| Situation | Skill / command |
|---|---|
| Lint or type errors flagged, tempted to add suppressions | `lint-no-suppressions` (always fix root cause) |
| Splitting fix work into reviewable commits, messages, PR descriptions | `commit-discipline` (generic commit/PR hygiene; tier grouping stays here) |
| CVE / GHSA advisory, package upgrade decision | `dep-vuln-workflow` (severity triage + ecosystem-readiness) |
| Code review surfaced findings, want them fixed | This skill — `code-review` produces the input list |
| Adversarial security audit needed first | `security` skill (sequential OWASP pipeline), then this skill on the findings |
| Architectural cleanup beyond bug-fixing | `refactor` skill (SOLID, per-principle, dead code at scale) |

## Anti-Hallucination Checks

- Re-Read every file:line before reporting a fix as applied
- Run the test the plan named, capture actual output (not paraphrase) — claim "fixed" only on observed green
- If git diff shows a change you didn't intend, that's a bug in your edit; revert and redo, don't accept it
- The "revert trigger" line in the plan is binding — if that test fails, revert immediately; do not patch the patch
- 3-strike rule: after 3 failed fix attempts on the same file, stop and ask the user — the diagnosis is probably wrong

## References

- Companion skills: `dep-vuln-workflow`, `lint-no-suppressions`, `code-review`, `tdd-workflow`
- Companion pipeline skills: `security`, `refactor` (user-invocable pipeline skills)
- Per-finding-type templates: `references/security-fix-templates.md`, `references/perf-fix-templates.md`, `references/bug-fix-templates.md`
- Feedback-loop construction (Step 0): `references/feedback-loops.md`
- Framing for feedback-loops.md adapted from Matt Pocock's `diagnosing-bugs` skill (formerly `diagnose`; MIT): https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md — the original text was adapted from the `diagnose` version pinned at https://github.com/mattpocock/skills/blob/694fa30311e02c2639942308513555e61ee84a6f/skills/engineering/diagnose/SKILL.md

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks-kit repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
