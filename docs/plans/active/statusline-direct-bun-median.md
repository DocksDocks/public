---
title: Gate the direct-Bun statusline benchmark on median, not p95
goal: Stop the load-induced flake in the direct-Bun statusline latency test by gating the median (same 100ms ceiling), mirroring the outer-shell median switch from 671831c.
status: in_review
created: "2026-07-10T17:57:10-03:00"
updated: "2026-07-10T18:18:30-03:00"
in_review_since: "2026-07-10T18:14:34-03:00"
started_at: "2026-07-10T17:58:30-03:00"
assignee: dockskit-defaults-worker (codex gpt-5.6-sol relay session)
tags: [test, statusline, flake]
affected_paths:
  - cli/test/unit/statusline.test.mjs
  - docs/plans/active/statusline-direct-bun-median.md
related_plans:
  - 2026-07-10-sync-effort-defaults.md
review_status: passed
planned_at_commit: 40b3ae26ce96e25099db556f6a34951188958c48
---

## Goal

`cli/test/unit/statusline.test.mjs` has one wall-clock benchmark left on a p95 gate: "keeps direct-Bun p95 below 100ms after warmup" (lines 208–222). Switch its gate from p95 to median with the ceiling unchanged at 100ms, exactly as commit `671831c` did for the two outer-shell legs in `cli/test/statusline-runtime-smoke.mjs` (250/750ms ceilings kept, p95 → median). Rename the test accordingly.

## Context & rationale

- 2026-07-10 evidence (this box, identical code across runs): the test failed at p95 = 100.58 / 113.05 / 155.45 / 193.47 / 197.35 ms and passed on other runs of the same tree — including a quiet-box failure, so it is marginal on this hardware, not merely contention from parallel test files. GitHub runners pass it consistently (parity CI green on 671831c, 50b99db, eb1ca3c, 40b3ae2).
- p95 of 25 post-warmup samples is the second-worst run: a single load-induced slow spawn fails the gate. The median only moves when the program got systematically slower — which is the regression the test exists to catch (671831c's rationale, user-approved that morning: "why median and not average" → median is robust to outlier spikes; average is dragged by one slow spawn).
- The direct-Bun leg deliberately kept p95 in 671831c because it had not yet flaked; today's evidence (6 of 8 local runs failed) removes that reason.
- User decision (2026-07-10): "plan it and fix that too then" — after the follow-up offer "the same median switch there is a two-line change".

## Environment & how-to-run

- Repo: `/home/vagrant/projects/public`, branch `main` (single-commit test change; no feature branch — matches the 671831c precedent).
- Focused run: `bunx vitest run cli/test/unit/statusline.test.mjs` (root config; do NOT pass `--config cli/vitest.config.ts`, it does not exist).
- Full suite: `bun run test:unit` (root `package.json`, `vitest run`).

## Steps

| # | Task | Status |
|---|------|--------|
| 1 | In `cli/test/unit/statusline.test.mjs` (lines 208–222): rename the test to "keeps direct-Bun median below 100ms after warmup"; replace the p95 computation `measured[Math.ceil(measured.length * 0.95) - 1]` with the median `measured[Math.floor(measured.length / 2)]` (keep the existing `timings.slice(5).sort((a, b) => a - b)` warmup trim); assert `expect(median).toBeLessThanOrEqual(100)`; add the same one-line rationale comment style used in `671831c` (spawn time is load-dominated; median only moves on systematic slowdown). No other test, threshold, sample count, or file changes. | done |

## Acceptance criteria

- `git diff` touches only the single test block in `cli/test/unit/statusline.test.mjs`: name, comment, percentile computation, assertion variable. Sample count (30), warmup trim (5), and ceiling (100) unchanged.
- `bunx vitest run cli/test/unit/statusline.test.mjs` → exit 0.
- `bun run test:unit` → exit 0 on 3 consecutive runs (baseline today: p95 gate failed ~6 of 8 such runs on this box, so 3/3 green is the executable flake-fix proof).
- `grep -n "0.95" cli/test/unit/statusline.test.mjs` returns nothing (the p95 computation is gone; the word "p95" legitimately survives in the rationale comment, same as 671831c's — criterion amended during execution, original wording was over-strict).

## Out of scope / do-NOT-touch

- `cli/test/statusline-runtime-smoke.mjs` — already median-gated (671831c).
- The statusline implementation, fixtures, and every other test in the file.
- The 100ms ceiling — this plan changes the statistic, not the budget.

## Cold-handoff checklist

- File manifest: `cli/test/unit/statusline.test.mjs` lines 208–222 (exact target quoted in Steps). ✔
- Environment & commands: above, with the config-flag gotcha. ✔
- Interface/data contracts: N/A — test-internal statistic change only.
- Executable acceptance: 4 binary checks above. ✔
- Out of scope: listed. ✔
- Decision rationale: median-vs-p95 and median-vs-average recorded in Context. ✔
- Known gotchas: `bunx vitest run` with a nonexistent `cli/vitest.config.ts` silently misbehaves — use the root config. The benchmark can still fail legitimately if `runDirect` gets systematically slower; a median failure is a real regression, do not raise the ceiling to pass. ✔

## Self-review

Score: 96/100 · trajectory 96 · stopped: single-pass (1-step plan, no hill-climb trigger: <6 steps, no risk flag). Checked: standalone executability (exact lines, exact expressions, both run commands), executable acceptance (all four checks binary), failure mode (legit-slowdown case in gotchas), no open questions — the statistic, ceiling, and naming were all decided by user or precedent.

## Review

- **Goal met:** yes — direct-Bun latency gate switched p95 → median at the unchanged 100ms ceiling (`measured[Math.floor(25/2)]` = 13th of 25 post-warmup samples), mirroring 671831c; sample count (30), warmup trim (`slice(5)`), the per-run status/stderr/stdout assertions, and the 100ms budget all unchanged.
- **Regressions:** none
- **CI:** pass — `bunx vitest run cli/test/unit/statusline.test.mjs` 18/18 exit 0 (renamed test "keeps direct-Bun median below 100ms after warmup" green); full `bun run test:unit` 114/114 exit 0.
- **Cross-check:** Cross-check (2026-07-10): [codex gpt-5.6-sol high] 0 findings — verdict READY, focused test 18/18; [claude] independently verified the median-index switch (13th of 25 ordered vs p95's 24th), the unchanged 100ms ceiling, and the per-run status/stderr/stdout assertions against source before accepting.
- **Follow-ups:** none
- Filed by: plan-review on 2026-07-10T18:18:30-03:00
