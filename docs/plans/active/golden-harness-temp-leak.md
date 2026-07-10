---
title: Stop the golden harness /tmp temp-dir leak
goal: Make golden/unit harness temp dirs (golden-home-*, golden-stubs-*, golden-mask-*) clean up on every exit path and self-heal stale leftovers, so /tmp never accumulates them again.
status: ongoing
created: "2026-07-10T18:09:47-03:00"
updated: "2026-07-10T18:39:57-03:00"
started_at: "2026-07-10T18:22:39-03:00"
assignee: dockskit-defaults-worker (codex gpt-5.6-sol relay session)
tags: [test, harness, tmp-leak]
affected_paths:
  - cli/test/lib/harness.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/unit/claudeMigration.test.ts
  - docs/plans/active/golden-harness-temp-leak.md
related_plans:
  - statusline-direct-bun-median.md
review_status: null
planned_at_commit: 1cf3a404fcc6d3e358b3a6cef15fcbf613706ada
---

## Goal

On 2026-07-10 a day of repeated golden/unit runs leaked **1,212** `golden-{home,stubs,mask}-*` dirs into `/tmp`, exhausting its inodes (1,048,576 total, 59 free, 100%) and blocking test runs with ENOSPC despite 2.4G free bytes. The harness already registers cleanup — `cli/test/lib/harness.ts:46-56`: every `temporaryDir()` result goes into `TEMP_DIRS` and a `process.on("exit")` handler `rmSync`s them — yet the leak happened. Find the exit paths that skip the handler, fix them, and add a self-heal so externally-killed runs can't poison `/tmp` permanently.

## Context & rationale

- User approval (2026-07-10, via picker): "approve cleanup and fix the leaks as well". The one-time cleanup was executed separately by the worker; this plan is the durable fix.
- **This is a recurring leak, not a one-off** — user (2026-07-10): "this aint the first time a leak happens with this golden". Prior occurrences predate today's known causes, so the fix must not merely patch the paths Step 1 attributes: the age-guarded self-heal sweep (Step 2c) is the load-bearing property because it heals *unknown and future* exit paths too. Do not deliver eager-cleanup-only.
- Creator sites, all in `cli/test/lib/harness.ts`: `makeStubDir` → `golden-stubs-` (line 110), PATH mask → `golden-mask-` (line 174), fixture homes → `golden-home-<kind>-` (line 202). All funnel through `temporaryDir()` (line 48).
- Harness consumers: `cli/test/golden-dryrun.ts`, `cli/test/golden-mutation.ts` (plain `bun` scripts — exit handler SHOULD fire), and `cli/test/unit/claudeMigration.test.ts` (runs inside **vitest worker threads**).
- Leak hypotheses, in suspected order of volume — Step 1 must confirm/refute each with a counted experiment, not assumption:
  1. vitest/tinypool terminates worker threads (`worker.terminate()`) without running `process.on("exit")` handlers → every `bun run test:unit` leaks claudeMigration's dirs.
  2. Runs killed externally (SIGKILL, orchestrator Bash timeouts, ENOSPC crashes mid-run) skip the handler → golden script leftovers.
  3. A creator whose dirs never enter `TEMP_DIRS` (audit: all three sites call `temporaryDir`, but verify no other `mkdtempSync` exists under `cli/`).
- Gotcha for the fix design: `normalizeTreeBody` (harness.ts:351) iterates `TEMP_DIRS` to scrub `golden-stubs-` paths from tree snapshots — eager per-case deletion must not remove a dir from `TEMP_DIRS` before the last snapshot that needs its path string, or golden normalization breaks. Deleting the directory contents is fine; the *path string* must stay available to `normalizeTreeBody` for the run's remaining cases (or keep a separate name registry).

## Environment & how-to-run

- Repo `/home/vagrant/projects/public`; work on branch `codex/golden-harness-temp-leak`; never push.
- Leak counting: `ls -d /tmp/golden-* 2>/dev/null | wc -l` before/after each experiment (record both numbers).
- Suites: `bun run golden:dryrun` (25), `bun run golden:mutation` (70), `bun run test:unit` (114), prove-red legs `bun cli/test/golden-{dryrun,mutation}.ts --prove-red` (must stay exit 1).

## Steps

| # | Task | Status |
|---|------|--------|
| 1 | Reproduce and attribute: with `/tmp` clean of `golden-*`, run each of (a) `bun run golden:mutation`, (b) `bun run test:unit`, (c) `bun run golden:mutation` killed mid-run with SIGKILL — record leaked-dir count and prefixes per experiment. Confirms which hypotheses are real; record results in `## Notes`. | done |
| 2 | Fix the confirmed paths in `cli/test/lib/harness.ts` (and consumers only if required). Required properties: (a) normal completion leaks 0 dirs (eager cleanup preferred over exit-handler-only, respecting the `normalizeTreeBody` gotcha); (b) vitest worker-thread runs leak 0 dirs (e.g. afterAll/finally-based cleanup — worker threads cannot rely on process exit); (c) self-heal: harness startup removes stale `golden-{home,stubs,mask}-*` dirs in `tmpdir()` older than an age threshold (≥60min, mtime-based) so externally-killed runs are healed by the next run — NEVER touch any other `/tmp` name, NEVER remove young dirs (concurrent-run safety). | done |
| 3 | Prove: rerun Step 1's three experiments — (a) and (b) leak 0; (c) leaks transiently, then one subsequent normal run self-heals the stale dirs (after aging them: `touch -d '2 hours ago' <dirs>`). Full gates green: dryrun 25, mutation 70, unit 114 (3 consecutive), both prove-red exit 1, `git diff cli/test/goldens/` empty (byte-identical goldens — the fix must not change any recorded output). | done |

## Acceptance criteria

- Step 1's counted attribution table exists in `## Notes` (experiment → leaked count → prefix breakdown).
- After the fix: experiments (a) and (b) leak exactly 0 dirs (`wc -l` unchanged from pre-run baseline of 0).
- SIGKILL experiment followed by one aged-dir self-heal run ends at 0 stale `golden-*` dirs.
- `git diff cli/test/goldens/` is empty; dryrun 25 OK; mutation 70 OK; `bun run test:unit` exit 0 ×3 consecutive; both prove-red legs exit 1 with their "prove-red OK" markers.
- The self-heal path provably never matches non-golden names: unit or inline proof that the sweep glob is anchored to `golden-home-|golden-stubs-|golden-mask-` prefixes inside `tmpdir()` with the age guard applied.

## Out of scope / do-NOT-touch

- `cli/test/goldens/*.json` — zero byte changes.
- The statusline median plan (separate, in flight).
- Any `/tmp` hygiene beyond the three harness-owned prefixes.
- CI workflow files (GitHub runners get fresh /tmp; this is a dev-machine problem — do not add CI steps).

## Cold-handoff checklist

- File manifest: exact creator lines and consumers listed in Context. ✔
- Environment & commands: leak-count probe + all suite commands with expected counts. ✔
- Interface/data contracts: `normalizeTreeBody`/`TEMP_DIRS` coupling documented as the design gotcha. ✔
- Executable acceptance: counted experiments + suite exits + empty-goldens-diff. ✔
- Out of scope: listed. ✔
- Decision rationale: eager-cleanup + age-guarded self-heal chosen over exit-handler hardening alone because SIGKILL can never be handled in-process. ✔
- Known gotchas: worker threads skip process exit handlers; TEMP_DIRS path strings needed by normalization after deletion; concurrent runs must not sweep each other's young dirs. ✔

## Self-review

Score: 93/100 · trajectory 93 · stopped: single-pass (3 steps, no hill-climb trigger). Standalone-executability: creator lines, consumers, coupling gotcha, and counted experiments are all named; the executor investigates before fixing (hypotheses are labeled as hypotheses). Residual uncertainty is deliberate: the exact fix mechanics depend on Step 1's attribution, and the required end-state properties (a)–(c) plus acceptance make any mechanics verifiable. No open questions — scope, prefixes, age guard, and goldens-immutability were fixed by user approval or existing convention.

## Notes

The original full `planned_at_commit` suffix was invalid in this checkout. The observed short SHA `1cf3a40` resolves unambiguously to `1cf3a404fcc6d3e358b3a6cef15fcbf613706ada`; the scoped drift check against that verified object was empty, and frontmatter now records the valid full SHA.

### Step 1 attribution (pre-fix)

Each experiment started with `find /tmp -maxdepth 1 -type d -name 'golden-*'` at zero after removing only the three user-approved harness prefixes. Inode values are from `df --output=iused,iavail /tmp`.

| Experiment | Exit/result | Leaked dirs (before → after) | Prefix breakdown | Inodes used (before → after; delta) | Attribution |
|---|---|---:|---|---:|---|
| `bun run golden:mutation` normal completion | `0`; 70 cases OK | `0 → 0` | none | `71,519 → 71,519; +0` | Plain Bun process exit runs the existing handler; hypothesis 1 does not apply to this consumer. |
| `bun run test:unit` normal completion | `0`; 114 tests OK | `0 → 25` | 9 `golden-stubs-*`; 16 `golden-mask-*`; 0 home/fixture | `71,519 → 92,462; +20,943` | Vitest worker termination skips the process-level exit cleanup; hypothesis 1 confirmed. Per-test `finally` cleanup explains zero homes/fixtures. |
| `bun cli/test/golden-mutation.ts` killed after 3s with SIGKILL | `137` | `0 → 2` | 1 `golden-home-*`; 1 `golden-stubs-*`; 0 mask/fixture | `71,519 → 71,581; +62` | An external kill bypasses all in-process cleanup; hypothesis 2 confirmed and the startup self-heal is required. |

Creator audit found no unregistered harness temp path: `makeStubDir`, `shadowDir`, `materializeHome`, and `materializeVariant` all call `temporaryDir()`. Other `mkdtempSync` calls under `cli/` are independent tests/smokes with their own cleanup; hypothesis 3 is refuted for the golden harness.

### Step 2 implementation

- `cleanupTemporaryDirs()` eagerly removes every path created through `temporaryDir()` but deliberately does **not** clear `TEMP_DIRS`; deleted stub path strings therefore remain available to `normalizeTreeBody` for byte-stable snapshot normalization. The existing process-exit hook now delegates to this idempotent function.
- `claudeMigration.test.ts` registers `cleanupTemporaryDirs` with Vitest `afterAll`, covering the confirmed worker-thread path without changing test count or individual assertions. A focused 8/8 run left all `golden-*` prefixes at zero.
- Harness startup calls `sweepStaleTemporaryDirs()`, which scans direct directory children of `tmpdir()`, matches only `golden-home-`, `golden-stubs-`, or `golden-mask-`, and removes entries only when `mtime` age is at least 60 minutes. Missing-path races are ignored; other errors remain visible.
- Inline safety proof: three aged allowed-prefix dirs were removed; three young allowed-prefix dirs and two aged near-miss dirs (`golden-fixture-*`, `golden-homeX-*`) were preserved. The proof exited `0` and cleaned its surviving fixtures.

### Step 3 verification (post-fix)

| Experiment | Exit/result | Golden dirs (before → after) | Prefix breakdown / recovery | Inode evidence |
|---|---|---:|---|---|
| `bun run golden:mutation` normal completion | `0`; 70 cases OK | `0 → 0` | home/stubs/mask/fixture all zero | No persistent harness dirs; subsequent baseline returned to 71,545 used. |
| `bun run test:unit` normal completion | `0`; 114 tests OK | `0 → 0` | home/stubs/mask/fixture all zero | `71,545 → 71,545; +0`, versus pre-fix `+20,943`. |
| `bun cli/test/golden-mutation.ts` killed after 3s with SIGKILL | `137` | `0 → 2` transient | 1 home, 1 stub; both intentionally young | `71,545 → 71,603` before healing. |
| Age the two killed-run dirs by two hours, then `bun run golden:mutation` | `0`; 70 cases OK | `2 → 0` | startup sweep removed stale leftovers; normal run cleaned its own dirs | Returned to `71,545` used. |

Gate evidence:

- `bunx tsc --noEmit -p cli` exited `0`; focused `claudeMigration.test.ts` passed 8/8 and left zero golden dirs.
- `bun run golden:dryrun` passed 25 cases; `bun run golden:mutation` passed 70 cases.
- Three consecutive post-fix `bun run test:unit` invocations each exited `0` with 114/114 tests; after all three, golden-dir count was zero and inode usage was still `71,545`.
- Dry-run prove-red exited `1` with `prove-red OK: golden-dryrun detected 25 planted mismatch(es)`; mutation prove-red exited `1` with `prove-red OK: golden-mutation detected 67 planted mismatch(es)`.
- `git diff -- cli/test/goldens/` and `git diff --check` both exited `0` with empty output; no golden JSON bytes changed.

## Review

(placeholder — completion review writes this)
