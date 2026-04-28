---
created: 2026-04-28T03:04:50-03:00
updated: 2026-04-28T03:04:50-03:00
finished: 2026-04-28T03:04:50-03:00
status: finished
---

# Pipeline Phase-Merge Audit (T3-02)

Closes T3-02 in `subagent-pipeline-improvements`. Audits the kit's 41 agents for phase-merge opportunities suggested by the 2026-04-28 baseline, where Phase 4 (planner) + Phase 5 (pre-verifier) of `/refactor` consumed **203K tokens / 26 min — 44% of the entire pipeline**.

## Method

Read agent definitions for every Builder→Verifier pair in the kit (`refactor-planner`/`refactor-pre-verifier`, plus the 4 analogous pairs across `/fix`, `/review`, `/test`, `/human-docs`). Inspected explorer→scanner edges and the `/security` fan-in. Cross-referenced against baseline cost data (`docs/roadmap/finished/2026-04-28-pipeline-baseline-refactor.md`). No new measurement runs.

## Headline finding

**No phase-merge worth pursuing.** The 44% cost concentration is structural to the kit's Builder-Verifier pattern, which is the dominant quality mechanism documented in root `CLAUDE.md`. Merging the planner into the pre-verifier (or vice versa) would:
1. Force one Opus-tier agent to do work currently split between Opus (synthesis) and Sonnet (verification) — losing the per-phase tiering savings (~5× cost ratio).
2. Eliminate independent-eyes verification — the planner's own anti-hallucination checks pass at write-time; the verifier's pass is meant to catch errors the planner missed.
3. Push the agent's body past the kit's 500-line ceiling and the model's effective context budget for high-quality output.

Cost reduction in this concentration must come from **scope reduction inside the verifier**, not from fusing the phases.

## Edge-by-edge audit

### Builder → Pre-Verifier (5 commands)

Same shape across `/refactor`, `/fix`, `/review`, `/test`, `/human-docs`:

| Pair | Builder model | Verifier model | Output handoff | Mergeable? |
|---|---|---|---|---|
| `refactor-planner` → `refactor-pre-verifier` | opus | sonnet | plan-file (Phase 4 → Phase 5) | **No** |
| `fix-planner` → `fix-pre-verifier` | opus | sonnet | plan-file | **No** |
| `review-analyzer` → `review-pre-verifier` | opus | sonnet | plan-file | **No** |
| `test-generator` → `test-pre-verifier` | opus | sonnet | plan-file | **No** |
| `human-docs-writer` → `human-docs-pre-verifier` | opus | sonnet | plan-file | **No** |

All five pairs cross a model-tier boundary (Opus → Sonnet). All five intentionally separate write/synthesis from independent verification. Merging any of them collapses the tiering and the Builder-Verifier pattern in one move.

### Explorer → Scanner pairs

`refactor-explorer` → `refactor-dead-code-scanner` (and the analogous edges in other commands): explorer maps the project (stack, conventions, tooling, build commands); the dead-code scanner uses some of that and re-discovers surface for its own scan. **Not a clean N→N+1 pair** — the explorer's output is consumed by every downstream phase (2a, 2b, 3, 4, 5), not just the next one. Merging would force the scanner to also produce profile/conventions output for everyone else, ballooning its scope. Reject.

### Parallel scanner siblings

`refactor-dead-code-scanner` ‖ `refactor-duplication-scanner`: parallel for wall-clock reasons (each ~2.5 min Sonnet). Both feed Phase 3 + Phase 4. Merging them sequentially would double their wall-clock without saving tokens. Reject.

### `/security` fan-in

Phase 2 = `[security-vulnerability-scanner ‖ security-logic-analyzer ‖ security-adversarial-hunter]` → Phase 3 = `security-synthesizer`. The synthesizer's job is precisely to reconcile three independent perspectives — three sub-agents that intentionally don't see each other's work. Merging defeats the design. Reject.

### `/docs` DAG

`/docs` has the most complex topology (skills + agents + cross-layer verifier). Audit deferred — the cost shape is unknown without a `/docs` baseline run, and the DAG's branches are already tightly scoped to single-readers. Revisit if a future baseline run shows similar cost concentration.

## Real overlap inside the verifier

The 44% concentration is real, but it sits **inside** the verifier rather than at the seam between phases. Comparing `refactor-planner` (Opus) to `refactor-pre-verifier` (Sonnet) line-by-line:

| Concern | Planner has it? | Pre-verifier has it? | Independent? |
|---|---|---|---|
| Read each referenced `file:line` | Yes (anti-hallucination block) | Yes (Reference Accuracy spot-check) | Mostly yes — verifier samples random entries the planner already self-checked |
| Research-gate (context7 + WebFetch) | Yes (constraint at top) | Yes (Check 6 — for every `category: modernization` entry) | **No — duplicate work on the same entries** |
| Over-engineering check | Yes (constraint at top) | Yes (Check 5 — for every `solid-violation` entry) | Partially — verifier independently challenges Pattern choices |
| Anti-Hallucination Checks block at bottom | Yes (6 bullets) | Yes (same 6 bullets verbatim) | Self-check on each agent's own output; not work-doubled |

The duplicate-work cell — research-gate on the same entries — is the only place where slimming saves tokens without losing an independent angle. The verifier currently fetches docs for **every** modernization entry; sampling (e.g., 1 in 3, randomized) preserves the independent-verification mechanism for the population while cutting per-run cost.

Estimated savings (planner side): zero (planner's research-gate stays full).
Estimated savings (verifier side): ~30–50K tokens per run (each context7 + WebFetch round-trip is ~5–10K).
Estimated quality cost: catch rate drops from 100% to ~33% on modernization-claim errors *that the planner's own research-gate missed*. Since the planner's research-gate is the primary filter, residual errors at the verifier are rare to begin with — sampling catches a useful proxy of the residual without paying full cost.

## What this audit does NOT recommend

- **Do not merge** any Builder→Verifier pair across the kit. The 44% concentration buys the kit's primary quality mechanism.
- **Do not remove** the verifier's research-gate. Sampling, not removal.
- **Do not collapse** parallel scanner siblings or the `/security` fan-in.
- **Do not touch** the `## Anti-Hallucination Checks` block at the bottom of any agent. It looks redundant but its execution cost is already paid by the spot-check work in the main workflow — it's a self-check checklist, not new tool calls. Removing it would harm score-agents.sh dimension and offer ~zero token savings.

## What this audit recommends (surface to parent plan as new sub-items)

### T3-02a — Sample the verifier's research-gate (5 agents)

For all 5 pre-verifiers (`refactor`, `fix`, `review`, `test`, `human-docs`):
- Change "for every modernization / framework-migration entry" → "for a random sample of ⌈N/3⌉ modernization entries (minimum 2, maximum 5)" in the research-gate constraint.
- Note in the rejected/approved output that the entry was **sampled** so the user knows uncovered entries weren't independently verified.
- Estimated savings: ~30–50K tokens per command run (varies with how many modernization entries the planner produced).
- Quality risk: small — planner-side research-gate is still 100%; verifier-side sampling adds independent eyes on a population.
- Validate by re-running `/refactor` on `tests/fixtures/nextjs-16-baseline/` after the change; expected pre-verifier delta ~−30K tokens, ~−2 min wall-clock.

### T3-02b — Document non-merge as a deliberate kit policy

Add a one-line note to the `## Why sequential subagent pipelines?` section in root `CLAUDE.md` explaining that even known-expensive Builder→Verifier pairs (e.g., 44% of `/refactor` cost) are NOT merged, because the cost is structural to the quality pattern.

This is documentation only — it locks in the audit's conclusion so future maintainers don't re-litigate the same question after seeing the cost concentration.

## Files referenced

- `ssot/.claude/agents/refactor-planner.md` — body 129 lines, Opus, 9-field plan output.
- `ssot/.claude/agents/refactor-pre-verifier.md` — body 115 lines, Sonnet, 6-check output.
- `ssot/.claude/agents/{fix,review,test,human-docs}-pre-verifier.md` — same shape.
- `docs/roadmap/finished/2026-04-28-pipeline-baseline-refactor.md` — cost data backing the 44% figure.

## Closeout

T3-02 closes with a non-merge conclusion and two tactical follow-ups (T3-02a + T3-02b) added to the parent plan. No code changed in this audit.
