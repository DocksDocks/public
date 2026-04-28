# Pipeline Baseline Measurement (T3-01)

Procedure for capturing per-phase token cost on a real project. **Don't measure on the synthetic fixture** (`tests/fixtures/nextjs-16-min/`) — it's too small to exercise pipeline depth, and the numbers would mislead. Use a real mid-sized project (japones is the obvious target) so the data reflects actual usage patterns.

## What to capture per command

Run each of these on the same target project, in the same session, with a fresh context (`/clear` between):

- `/refactor`
- `/security`
- `/review`
- `/test src/` (or a representative subdirectory)

For each command, record:

| Field | Source |
|---|---|
| Phase name | from the command's `## Phase N:` headers in the plan file |
| Agent invoked | from the orchestrator's `subagent_type:` |
| Model (sonnet/opus) | from the agent file's `model:` frontmatter |
| Input tokens | `rtk gain --history` (per-command) — read from the most recent run row |
| Output tokens | same |
| Wall-clock | per-phase agent return shows `duration_ms` in the tool output |
| Plan file size at end of phase | `wc -c <plan-file>` after each phase |

## How to capture

Two complementary sources:

1. **`rtk gain --history`** — already running per the kit's hook. After each command, `rtk gain --history | head -20` shows the most recent operations with savings/totals. The numbers are post-RTK-compression; the actual API send is what got billed.

2. **Session JSONL transcript** — `~/.claude/projects/<project-slug>/<session-uuid>.jsonl` has the full per-message token counts in `usage` blocks. `jq '.usage' <session>.jsonl | head -50` extracts the raw numbers.

If `rtk gain` and the JSONL disagree by more than ~5%, prefer the JSONL — RTK reports compressed-input savings, not absolute API spend.

## Output format

Save findings to `docs/roadmap/finished/YYYY-MM-DD-pipeline-baseline-measurement.md` (move the parent plan from `ongoing/` once T3-01 is checked off). Use this skeleton:

```markdown
---
created: <ISO timestamp>
updated: <ISO timestamp>
finished: <ISO timestamp>
status: finished
---

# Pipeline Baseline Measurement — <date>

## Project measured
- Path, commit SHA, file count, primary stack

## Per-command totals
| Command | Phases | Total in | Total out | Wall-clock | Cost (est.) |
|---|---|---|---|---|---|
| /refactor | 8 | … | … | … | … |
| /security | 4 | … | … | … | … |
| ...

## Per-phase breakdown (worst 3 by bootstrap-cost ratio)
For each: phase name, agent, model, in/out, plan-file size delta, and **bootstrap-cost ratio** = (input tokens consumed before the phase produced its first plan-file write) ÷ (total input tokens for the phase). High ratio = lots of re-discovery / re-reading; low ratio = phase did real work fast.

## Findings
- Surprises (phases that cost more than expected)
- Phase-merge candidates surfaced by the data (feeds T3-02)
- Anything that suggests revisiting the model tiering
```

## Pre-conditions for a clean measurement

- Run on a project with a recent commit (last 24h) so `git log` and friends produce stable output
- Don't have other Claude sessions running (RTK history will interleave)
- Note kit commit SHA at run time so the measurement can be re-run on the same kit version later
- `/clear` between commands to avoid context-window contamination affecting the per-command numbers

## Post-conditions

- Append findings to the file above
- If a phase shows a high bootstrap-cost ratio, note it as a candidate for T3-02 (phase-merge audit)
- If a model tier feels mismatched (Opus phase doing mechanical work, or Sonnet phase doing synthesis), flag it — but don't change the agent yet; let evidence accumulate over multiple measurements
