---
created: 2026-04-28T02:42:49-03:00
updated: 2026-04-28T02:42:49-03:00
finished: 2026-04-28T02:42:49-03:00
status: finished
---

# Pipeline Baseline Measurement — `/refactor` (2026-04-28)

First T3-01 baseline run. Captures plan-only token cost for `/refactor` against the canonical baseline fixture (`tests/fixtures/nextjs-16-baseline/`, 16 source files, ~600 LOC). Subsequent runs against `/security`, `/review`, `/test` deferred — not blocking; this single run already surfaces the structural cost shape.

## Setup

- Kit commit: `06deb2d`
- Target: copy of `tests/fixtures/nextjs-16-baseline/` at `/tmp/baseline-target/` (git-init'd, single-commit)
- Auth: Claude Max subscription (no `ANTHROPIC_API_KEY` in env)
- Invocation: `claude -p "/refactor /tmp/baseline-target/" --permission-mode plan --output-format json --max-turns 50`
- Run terminated via SIGTERM at ~48 min wall-clock when the pipeline hung at `ExitPlanMode`. All 6 analysis-phase agents had already completed before the hang — the captured data covers the full plan-only pipeline.

## Per-agent breakdown

| # | Agent | Model | Tool calls | In | Out | Cache read | Cache create | Total | Wall-clock |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | refactor-explorer | sonnet | 53 | 1 | 1,464 | 52,476 | 4,012 | 57,953 | 219s |
| 2a | refactor-dead-code-scanner | sonnet | 40 | 1 | 1,319 | 48,966 | 324 | 50,610 | 142s |
| 2b | refactor-duplication-scanner | sonnet | 44 | 1 | 2,127 | 49,240 | 3,729 | 55,097 | 271s |
| 3 | refactor-solid-analyzer | **opus** | 36 | 1 | 4,745 | 83,999 | 1,858 | 90,603 | 688s |
| 4 | refactor-planner | **opus** | 50 | 1 | 4,084 | 105,412 | 209 | 109,706 | 933s |
| 5 | refactor-pre-verifier | **opus** | 54 | 1 | 1,362 | 91,680 | 358 | 93,401 | 643s |
| | **Total (6 phases)** | | **277** | **6** | **15,101** | **431,773** | **10,490** | **457,370** | **2,896s (48m 16s)** |

## Cost concentration

| Tier | Agents | Tokens | % of total | Wall-clock | % of wall-clock |
|---|---|---:|---:|---:|---:|
| Sonnet (Phase 1, 2a, 2b) | 3 | 163,660 | 36% | 632s | 22% |
| Opus (Phase 3, 4, 5) | 3 | 293,710 | **64%** | 2,264s | **78%** |

The 3 Opus phases dominate both spend and wall-clock — consistent with the kit's tiering rationale (Opus for synthesis/architecture/creative reasoning), but the magnitude is striking: each Opus phase costs roughly 2× a Sonnet phase in tokens and 3× in wall-clock.

## Cache efficiency

Cache reads = 431,773 of 457,370 total tokens = **94%**. The prompt-caching is doing real work — without it, the same pipeline would cost roughly 16× more (cache reads bill at ~10% of standard input rate). The `cache_creation` column shows ~10K tokens per run for setup; on a *second* run against the same fixture, those would also become cache reads, dropping marginal cost slightly.

## Output token count

Output is **15,101 tokens** total — under 4% of input. The pipeline is overwhelmingly **read-heavy** (analyzing the codebase) rather than **write-heavy** (producing a long plan). This is the expected shape for plan-only measurement: scanners enumerate, analyzer synthesizes, planner produces a structured plan, pre-verifier sanity-checks. None of these need to generate large amounts of prose.

## Phase-merge candidates (preliminary, feeds T3-02)

Two pairs stand out as having similar consumers and overlapping inputs:

1. **Phase 4 (planner) → Phase 5 (pre-verifier)**: planner consumes Phase 1+2+3 outputs and produces a plan; pre-verifier consumes the same outputs *plus* the planner's plan, and re-validates everything. Combined: 203K tokens, 26 min — over 44% of the entire pipeline. Worth investigating whether the verifier could check incrementally during plan generation rather than as a separate pass.

2. **Phase 1 (explorer) → Phase 2a (dead-code scanner)**: explorer maps stack and tooling; dead-code scanner uses tooling and re-maps surface to identify dead code. Some explorer output is discarded by the time 2a runs. Less impactful (109K combined, 6 min) but worth a look.

## Findings worth acting on

1. **`ExitPlanMode` hangs in `-p` mode** — confirmed. The kit's commands call `ExitPlanMode` after the analysis phases; in headless mode the gate has no UI to approve, so it waits indefinitely. **Action**: update `tests/baseline/MEASUREMENT-PROCEDURE.md` to note this; recommend running with a `timeout 30m` wrapper in the future, or detecting the gate via `--max-turns` ceiling. `--max-turns 50` was set but did not fire — Phase 6 may not count toward agentic-turn budget the same way.

2. **Wall-clock far exceeded estimate** — predicted ~22 min, actual 48 min. Sources of underestimate:
   - Phase 4 (planner) took 15.5 min, not 4-5 min as guessed
   - Phase 5 (pre-verifier) took 10.7 min, not estimated
   - Both are Opus phases doing semantic synthesis; the 16-file fixture surface is enough to keep them busy
   - Future estimates: budget **~5-8 min per Opus phase** on a fixture this size, not 3-4 min

3. **Token cost higher than estimate** — predicted 330K, actual 457K. Same source: Opus phases consume more than budgeted. Future runs against this fixture: budget **~500K tokens** for `/refactor`.

4. **Bootstrap-cost ratio is uniformly low** — all 6 agents have cache-read >85% of total. Prompt caching is healthy. No agent stands out as needing memory-style caching to fix.

5. **Cache-creation column on Phase 4 and 5 is suspicious** — Phase 4 = 209 tokens, Phase 5 = 358 tokens. Almost no new cache. This means subsequent calls within these phases share the same prefix as the first call. Good — indicates the agents stay focused on a single context across their tool-call iterations.

## What we learned about the kit

- **Custom slash commands DO work in `claude -p`** — empirically confirmed. The doc-page contradiction between the headless page (interactive-only) and the SDK slash-commands page (custom commands available) is resolved: SDK page is correct.
- **`--permission-mode plan` is honored** — no Edit/Write/Bash-write tool ever fired against the kit repo. Safety property holds.
- **The kit's pipeline is robust under SIGTERM** — killing `claude -p` mid-Phase-6 left a clean JSONL with all completed phases captured. `capture.sh` extracted everything.
- **Pre-flight `!`-shell injection (the `git status` / `git log` blocks) appears to have worked** — no errors observed during Phase 1 about missing context. (This had been a known unknown.)

## Recommendations for next runs

- Wrap with `timeout 60m` to enforce a hard ceiling on `ExitPlanMode` hangs
- Don't run `/security`, `/review`, `/test` baselines yet — diminishing returns; this run gives the structural shape, others would just confirm
- For T3-02 (phase-merge audit), start with the planner→pre-verifier pair identified above
- If a future kit change is meant to reduce per-phase cost, re-run this fixture and diff the per-agent table — same kit commit + same fixture = clean A/B
