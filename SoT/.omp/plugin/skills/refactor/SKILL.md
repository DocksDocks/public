---
name: refactor
description: "Use when auditing a codebase for structural issues — dead code, duplication, missing abstractions, SOLID violations (all 5 incl. Liskov), modernization candidates. Runs exploration → dead-code scan → duplication scan → SOLID analysis → planning → pre-verify sequentially, gates on the plan lifecycle, then implements one change at a time with test-revert and a post-verify SOLID delta. Not for security audits (use security) or single bug fixes (use fix-workflow)."
user-invocable: true
metadata:
  pattern: pipeline
  updated: "2026-11-20"
  content_hash: "8388bf888844dd2b70f35bd782fbd41ba53352d4ca1dbd2f79b38d0c0961f470"
---

# Refactor (sequential pipeline)

Detect and fix structural issues — dead code, duplication, evidenced SOLID violations, modernization — as one sequential pass with a tiered plan, an intent-aware review handoff, and test-guarded implementation. Single-agent by default — no slash command, no Plan Mode; the only subagent dispatch is the optional omp isolated-executor mode (see constraint 1). Each phase's expertise lives in `references/<phase>.md`; this body is the orchestration.

<constraint>
Single-agent sequential **by default**. Execute the phases IN ORDER, in THIS context; the analysis phases (1–5) never dispatch subagents. Before running each phase, read its `references/<phase>.md` and apply it. Hand each phase's output to `plan-manager` as you finish it so the plan issue remains resumable after compaction. Implementation has ONE optional exception — the omp isolated-executor mode in `references/executor-dispatch.md`; it is opt-in, never the default, and when it is not available you always fall back to the in-context path (Phases 7–8).
</constraint>

<constraint>
Phases 1–5 are READ-ONLY analysis. If the user asked only for an assessment or plan, the reviewed plan is the deliverable and the run stops after reporting it. If the user asked to refactor or implement, hand the plan to `plan-manager` for the six manager lifecycle phases — decide, draft, research, plan review, implement, and code review — which are separate from this skill's internal phases. The manager owns the canonical GitHub issue, lifecycle transitions, delegation, verification, and archive; continue into Phases 7–8 without requiring another user-issued lifecycle command. Stop only for a real unresolved user decision or persisted blocker.
</constraint>

Prerequisite: the docks-kit kit plugin (`docks-kit-omp`) must be installed. If `plan-workspace` or `plan-manager` is unavailable, STOP, name the missing docks-kit kit plugin, and do not create or mutate a plan.

<constraint>
Implementation discipline (Phases 7–8). ONE refactoring at a time — never batch before testing. Run tests after each change; on failure REVERT immediately (`git restore`, or `git restore --staged` + `git restore` for a re-staged `git rm`) and log `REVERTED: <reason>` — do not try to "fix" it. Delete files with `git rm` only (never raw `rm`). Do not touch code beyond the planned change.
</constraint>

<constraint>
Reuse before abstraction. In Phase 1, inventory existing modules, exports, registries, dependencies, components, and design tokens before proposing an equivalent. Apply SOLID guidance only when a documented smell exists: a 300+ line mixed-concern unit, a growing switch/if chain, runtime `instanceof` branching, a fat interface, or a hard-coded concrete SDK dependency. Route React composition/effects/RSC work to `react-component-patterns`; Tailwind/color/theme work to `design-tokenization`; and Effect work only after resolving `package.json` plus the lockfile, choosing exactly one matching Effect setup/port/v3/v4 skill. Do not load these companions as an umbrella checklist.
</constraint>

## When to use

- A structural cleanup pass over a module, package, or whole repo.
- After a feature leaves behind dead code, duplication, or a growing switch.
- When you want a reviewed, tiered plan before implementation changes.

## When NOT to use

| Situation | Use instead |
|---|---|
| Security audit (OWASP, injection, authz) | `security` |
| One known bug to fix | `fix-workflow` |
| Dependency / CVE triage | `dep-vuln-workflow` |
| Style / maintainability review only | `code-review` |
| Commit-splitting / PR hygiene beyond the per-change revert protocol | `commit-discipline` |

## Pipeline

Run in order. Each phase reads its reference, then hands its output to `plan-manager` for the plan issue under the exact subheading in the section shown. The plan helper accepts only its fixed `##` sections (see `skills/plan-manager/references/plan-contract.md` inside the installed docks-kit kit plugin), so every phase writes a `###` subheading inside `## Research` or `## Verification Results`. The subheading is the resume anchor — keep it verbatim.

| # | Phase | Reference | Output section → subheading |
|---|---|---|---|
| 1 | Exploration (stack, tools, abstractions, DI) | `references/explorer.md` | `## Research` → `### Phase 1: Exploration Results` |
| 2a | Dead-code scan (safety-tiered) | `references/dead-code-scanner.md` | `## Research` → `### Phase 2a: Dead Code Findings` |
| 2b | Duplication & modernization scan | `references/duplication-scanner.md` | `## Research` → `### Phase 2b: Duplication Findings` |
| 3 | SOLID analysis (only evidenced S/O/L/I/D smells + monorepo) | `references/solid-analyzer.md` | `## Research` → `### Phase 3: SOLID Analysis Results` |
| 4 | Planning (3 tiers, 9 fields/change) | `references/planner.md` | `## Research` → `### Phase 4: Refactoring Plan` |
| 5 | Pre-implementation verification | `references/pre-verifier.md` | `## Research` → `### Phase 5: Pre-Verifier Results` |
| — | **HANDOFF** — assessment stops; implementation enters manager review | (this body) | `## Research` → `### Phase 6: Plan Presentation` |
| 7 | Implementation (one change at a time) | (this body) | `## Verification Results` → `### Phase 7: Implementation Log` |
| 8 | Post-implementation verification | `references/post-verifier.md` | `## Verification Results` → `### Phase 8: Post-Verifier Results` |

Phase 3 uses Phase 2a's SAFE tier to skip files about to be deleted. Phase 4 merges 2a + 2b + 3.

## How to run each phase

1. Anchor the date once (`date "+%Y-%m-%d"`), record scope (a path, or the whole project).
2. Ask `plan-manager` to create the canonical plan issue with `docks-kit plan new --title <t> --goal <g>` and own every lifecycle write. If no GitHub-backed plan lifecycle is available, stop and report; never write a tracked or untracked plan file. Write a `### Environment` block (date, branch, short git status) at the top of `## Research`.
3. For each read-only row (1 → 5), in order: read `references/<phase>.md`, perform it, write under the row's subheading, confirm the subheading landed before the next phase. If a phase finds nothing, write "no findings" — never silently skip.
4. At the HANDOFF, follow the request intent below. Resume at Phase 7 after the manager sets the plan `ongoing`; no user lifecycle command is required.

## The plan record (IPC + deliverable)

```text
GitHub issue #<n> labeled plan, created with plan:drafting;
plan-manager owns every later phase transition.
```

Hand phase output to `plan-manager` as you go — do not hold all of it in context and dump it at the end. Downstream phases and a resumed run read the issue with `docks-kit plan show <issue> --body` and locate prior output by grepping the `### Phase` subheadings. Never add a new `##` heading: the helper rejects any `##` heading outside its fixed sections.

## Review handoff (replaces Plan Mode)

After Phase 5, write `### Phase 6: Plan Presentation` under `## Research` in the report handed to `plan-manager`:

1. Refactorings by tier (1 Quick Wins / 2 Consolidation / 3 Structural) — each with `file:line`, what-changes, Pattern (SOLID entries), risk.
2. Estimated impact: files modified, lines removed, duplicates eliminated, SOLID resolved by principle.
3. Skipped findings (including over-engineering and unreproducible drops).
4. Any MUST FIX from the pre-verifier requiring plan adjustment first.

For an assessment-only or plan-only request, report the reviewed plan issue and summary, then stop. For an implementation request, hand the complete report to the unified `plan-manager`; it files the report in the plan issue, performs the single pre-implementation plan review, and sets the plan `ongoing`, then this orchestration continues directly into Phases 7–8 without a manual lifecycle prompt. Ask only when the manager identifies a genuine unresolved decision.

After the plan reaches `status: ongoing`, implement via **Phases 7–8 in-context (the default)** — or, on omp with `task.isolation.enabled` true, `task.isolation.apply` false, and plan mode off, opt into the **dispatched-executor mode** (`references/executor-dispatch.md`): one isolated `task` subagent, with its model from `task.agentModelOverrides.task`, runs the plan in its own checkout, and you review its patch like a tech lead. Same plan, same issue verdict; just who does the edits.

## Implementation (Phases 7–8, while the plan is ongoing)

1. Run the full test suite first to establish a baseline. If tests already fail, note which and proceed carefully.
2. For each refactoring in tier order (1 → 2 → 3):

```bash
# per change: characterize → change → test → keep or revert
# edit-only change → edit tool; file deletion → git rm <path>  (never raw rm)
# on test failure → git restore <path>  (staged deletion: git restore --staged <path> && git restore <path>)
```

   - Write characterization tests first if the change needs them; verify they pass.
   - Make the change. Run the test suite. On failure, REVERT immediately and log `REVERTED: <reason>`; continue to the next.
   - Run the linter; fix issues introduced. Log `APPLIED: <description>`.
3. After all changes, run the full suite once more. Then Phase 8: read `references/post-verifier.md`, verify the diff against the plan, run tests/linter/type-checker, re-analyze every changed file for NEW SOLID violations, and report the compliance delta. Any new violation → revert the offending change.

| | Example finding (any phase) |
|---|---|
| BAD | "This file has some duplication and could be cleaner." |
| GOOD | "`src/utils/format.ts:45` + `src/api/fmt.ts:12` — 18-line duplicate of currency formatting; consolidate into `src/shared/money.ts`. Risk: low. Tests: `pnpm test money`." |

## References

| Read before running | File |
|---|---|
| Phase 1 — stack, tools, abstractions, DI | `references/explorer.md` |
| Phase 2a — dead-code scan + safety tiers | `references/dead-code-scanner.md` |
| Phase 2b — duplication, reuse, modernization | `references/duplication-scanner.md` |
| Phase 3 — per-principle SOLID + TS class gate | `references/solid-analyzer.md` |
| Phase 4 — tiered plan, 9 fields, over-engineering guard | `references/planner.md` |
| Phase 5 — pre-impl checks + reproduction | `references/pre-verifier.md` |
| Phase 8 — post-impl verify + SOLID delta | `references/post-verifier.md` |
| Optional (omp isolated `task` item) — dispatched executor + tech-lead review | `references/executor-dispatch.md` |

## Verification (Phase 8 — scope + no unplanned loss)

Phase 8 is where a refactor can silently delete or rewrite code outside the plan. Enforce scope mechanically instead of trusting the prose rule in constraint 3:

```bash
# changed files must be a SUBSET of the union of Steps Files cells — no scope bleed
git diff --name-only | while read -r f; do
  grep -qFx "$f" <plan-steps-files-union> || echo "OUT OF SCOPE: $f"
done
```

No content loss outside the planned diff: every deletion must be a planned dead-code removal (Phase 2a SAFE tier) or a consolidation whose target you can point to. An `OUT OF SCOPE` line ⇒ `git restore` that change and do not report success. Full post-impl checks (tests, SOLID delta): `references/post-verifier.md`.

Old-against-new check: when characterization tests cover little of a changed unit, run a differential test. Run the base version and the changed version on the same generated or sampled inputs, and compare the outputs. Report each difference as a behavior change. The method is in `references/post-verifier.md`, step Old-against-new check.

## Gotchas

| Gotcha | Consequence | Right move |
|---|---|---|
| Editing code during Phases 1–5 | Invalidates the analysis input before review | Keep analysis read-only; implementation begins after the manager sets the plan `ongoing` |
| Batching several changes before testing | Can't tell which change broke the suite | One refactoring → test → keep/revert |
| Raw `rm` to delete dead code | Unstaged, harder to recover | `git rm` only; revert via `git restore` |
| Flagging modernization from memory | Ships a backwards "fix" (e.g. Next.js `proxy.ts`) | Verify against current docs for the installed version |
| Resolving one SOLID violation but adding another | Net-negative refactor ships | Phase 8 re-checks all 5 principles; revert on any new violation |
| Assuming a GitHub plan issue is available in a repository with no GitHub remote | The report cannot be filed | Stop and report the missing GitHub remote; do not create a plan file |

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
