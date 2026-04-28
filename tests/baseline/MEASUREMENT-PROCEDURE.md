# Pipeline Baseline Measurement (T3-01)

Procedure for capturing per-phase token cost. **Default: plan-only measurement** (decline at `ExitPlanMode`), which captures ~70–80% of total command cost for analysis-heavy pipelines (`/refactor`, `/security`, `/review`) without modifying any code. Execution-phase cost can be calibrated separately with one-off full runs.

## Two valid measurement targets

| Target | Use when | Trade-off |
|---|---|---|
| `tests/fixtures/nextjs-16-baseline/` | Tracking kit *changes* — same fixture before + after lets you see deltas cleanly | Synthetic; absolute numbers don't generalize to production projects |
| Real mid-sized project (e.g. japones) | Absolute cost data + representative usage patterns | Project changes between runs, so deltas are confounded |

**Pick one and stick with it within a measurement series.** Don't mix targets in the same baseline file.

## Plan-only measurement (default)

Captures all read-only phases (exploration → scanners → analyzers → planners → pre-verifiers) and wall-clock + plan-file growth per phase. Misses the implementation phase.

```bash
# Setup against the baseline fixture
cp -r tests/fixtures/nextjs-16-baseline /tmp/baseline-target
cd /tmp/baseline-target && git init -q && git add -A && git commit -qm "fixture state"
touch /tmp/baseline-target/.measure          # marker for capture.sh (option 3)

# In Claude Code (kit session, fresh /clear):
# /refactor /tmp/baseline-target/
# (Pipeline runs Plan Mode through Phase N → ExitPlanMode prompt)
# DECLINE the ExitPlanMode prompt — plan-only run

# After: capture data from session JSONL
bash tests/baseline/capture.sh <session-uuid>

# Repeat for /security, /review, /test (fresh /clear between)

# Cleanup
rm -rf /tmp/baseline-target
```

The `.measure` marker is a forward-compatibility hook: today, `capture.sh` doesn't strictly need it (you pass the session UUID); later, if we add `SubagentStop`-hook auto-capture, the marker tells the hook "yes, log this run."

## Optional: execution-phase calibration

To get the missing ~20-30%: run ONE full pipeline with approval at `ExitPlanMode`. Edits target the fixture copy at `/tmp` — kit repo unaffected.

```bash
cp -r tests/fixtures/nextjs-16-baseline /tmp/baseline-target-calib
cd /tmp/baseline-target-calib && git init -q && git add -A && git commit -qm "fixture state"

# /refactor /tmp/baseline-target-calib/
# (run pipeline → APPROVE at ExitPlanMode → execution phase runs)

bash tests/baseline/capture.sh <session-uuid> --include-implementation

rm -rf /tmp/baseline-target-calib
```

One calibration run per command is enough. The execution-phase ratio (impl-cost ÷ analysis-cost) tends to be stable across runs of the same command, so you can apply the ratio to subsequent plan-only measurements.

## What capture.sh produces

A markdown table per command:

| Phase | Agent | Model | In tok | Out tok | Cache reads | Wall-clock | Plan-file growth |
|---|---|---|---|---|---|---|---|

Plus a summary row with totals + bootstrap-cost ratio (= input tokens consumed before the phase produced its first plan-file write, ÷ total input tokens for the phase). High ratio = lots of re-discovery; low ratio = phase did real work fast — flag for T3-02 phase-merge analysis.

## Output format (saved findings)

When ready to publish, save to `docs/roadmap/finished/YYYY-MM-DD-pipeline-baseline-measurement.md` and `git mv` the parent plan from `ongoing/` to `finished/`. Skeleton:

```markdown
---
created: <ISO timestamp>
updated: <ISO timestamp>
finished: <ISO timestamp>
status: finished
---

# Pipeline Baseline Measurement — <date>

## Target
- Fixture path / project commit SHA / file count / primary stack

## Per-command totals (plan-only, unless noted)
| Command | Phases | Total in | Total out | Cache hit % | Wall-clock | Cost (est.) |
|---|---|---|---|---|---|---|
| /refactor | 8 | … | … | … | … | … |
| ...

## Per-phase breakdown (worst 3 by bootstrap-cost ratio)
For each: phase, agent, model, in/out, plan-file growth, bootstrap ratio.

## Execution-phase calibration (one-shot per command)
| Command | Impl in tok | Impl out tok | Ratio (impl ÷ analysis) |
|---|---|---|---|

## Findings
- Surprises (phases costing more than expected)
- Phase-merge candidates surfaced by the data → feeds T3-02
- Model-tier mismatches (Opus phase doing mechanical work, Sonnet doing synthesis)
```

## Pre-conditions

- Run on a clean session (`/clear` first)
- No other Claude sessions active (RTK history would interleave)
- Note kit commit SHA at run time so the measurement can be re-run on the same kit version later
- For real-project measurement: project must be on a recent commit (last 24h) so `git log` produces stable output

## Post-conditions

- Append findings to the saved file
- High bootstrap-cost ratio → flag as T3-02 candidate
- Model-tier mismatch suspicion → don't change agents on a single data point; let evidence accumulate across multiple measurements before tweaking
