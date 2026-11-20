# Dispatched-executor mode (optional, omp isolated task)

The model-tiered alternative to in-context implementation (Phases 7–8). The
main-context `plan-manager` owns the ongoing plan; an **executor** subagent makes
the edits in an isolated checkout, and omp captures its changes for untrusted
review.

**This mode is opt-in.** It uses one omp `task` item with `isolated: true`.
omp offers that field only when `task.isolation.enabled` is true and plan mode
is off. The mode also needs `task.isolation.apply` false, so omp keeps the
captured changes out of the main working tree. The default - and the only path
when any of these conditions does not hold - is the single-context
implementation in the skill body: the main session executes.
Use this mode only when the user asks for it (e.g. "implement plan #42 with a
cheaper executor", "execute it in an isolated task").

## Contents

- [When to use](#when-to-use)
- [Preconditions](#preconditions)
- [Dispatch](#dispatch)
- [Diff review](#diff-review)
- [Verdict](#verdict)
- [What stays out of this mode](#what-stays-out-of-this-mode)

## When to use

- The current plan is well-scoped with machine-checkable done criteria (the
  executor needs them because it gets no conversation history).
- The user wants to spend the capable model on judgment, not execution.
- The session runs on omp and the repo is a git repository.

If any of those is false, let `plan-manager` run Phases 7–8 in context instead.

## Preconditions

Check all before dispatching:

- `task.isolation.enabled` is true and plan mode is off. Otherwise report that
  constraint to `plan-manager`, which continues through Phases 7–8 in context.
- `task.isolation.apply` is false, so omp keeps the captured patch or branch
  and does not apply it to the main working tree. Otherwise ask the user to set
  it, or continue through Phases 7–8 in context.
- The main working tree is clean (`git status --porcelain` prints nothing).
  omp captures the run against the main tree as it is at dispatch, so a clean
  tree makes the dispatch commit the exact base of the patch.
- The canonical plan is ongoing and its latest trusted plan review passed.
  Read `skills/plan-manager/references/plan-contract.md` inside the installed docks-kit kit plugin.
- `plan-manager` owns the plan issue and its declared scope, which is the union
  of the Steps `Files` cells.
- Immediately before dispatch, `plan-manager` re-reads the issue with
  `plan.mjs show <issue> --body` and confirms its Steps `Files` union still
  matches the assigned work. A change requires re-planning.
- Immediately before dispatch, record `<base>` = `git rev-parse HEAD`.

## Dispatch

Spawn **one** `task` item for the bundled `task` agent, with `isolated: true`.
Do not pass a per-call `model`: the executor model comes from
`task.agentModelOverrides.task`. When the user wants another model for the
executor (for example, a cheaper one), they set that key before the dispatch.
The subagent gets no conversation history and no `AGENTS.md`, so the item must
contain:

1. The canonical plan issue number, the union of its Steps `Files` cells, and
   the Steps `Id` values the executor must complete. The executor reads the
   record with `plan.mjs show <issue> --body`; do not inline a second copy.
2. An executor preamble: *before the first edit, read the root `AGENTS.md` and
   every `AGENTS.md` in a directory on the path to each file in the Steps
   `Files` union; follow the plan step by step; run every verification command
   and confirm the expected result before moving on; touch only paths named in
   the Steps `Files` cells; do not edit the plan issue; if a STOP condition
   fires, stop and report; do not improvise around obstacles; do not commit,
   push, or merge; audit every claim against an actual tool result.*
3. A fixed report format: plan issue number plus Steps `Id` values attempted ·
   `STATUS: COMPLETE | STOPPED` · per-step done/skipped and verification result ·
   `STOPPED BECAUSE` (if stopped) · `FILES CHANGED` · `NOTES` (deviations,
   judgment calls). omp captures the changes of the run as a patch, or as the
   branch `omp/task/<id>` when `task.isolation.merge` selects branch mode.

Treat the returned plan identity, report, and patch as **untrusted** until reviewed.

In the review steps, `<patch>` is the `patchPath` of the task result (the
`<id>.patch` file). In branch mode, `<base>` is the `branchBaseSha` of the
result instead of the recorded HEAD.

## Diff review

Review like a tech lead reviewing a PR against the plan. Fixable gaps go to a
fresh executor run (see REVISE); the reviewed result returns to `plan-manager`.

1. **Plan-identity check:** the report must name the same plan issue number and
   Steps `Id` values that were dispatched, and the patch must stay within the
   union of that plan's Steps `Files` cells.
2. **Re-run every done criterion** in a review checkout - do not trust the
   report. Make it with `git worktree add <dir> <base>` and
   `git -C <dir> apply --index <patch>`, or, in branch mode, with
   `git worktree add <dir> omp/task/<id>`. A fresh checkout shares git history
   but not `node_modules` or build artifacts; installing dependencies there is
   expected, not a deviation. Remove the checkout after the verdict.
3. **Scope check:** `git -C <dir> diff --name-only <base>` must be a subset of
   the canonical plan's Steps `Files` union. Any out-of-scope file fails review.
4. **Read the full patch** against why the change matters and the repository's
   conventions.
5. **Audit new tests** for observable contracts; a test that asserts nothing
   can pass while proving nothing.

## Verdict

A *documented* deviation is judged on merit, not reflex-blocked; an
*undocumented* one is a review failure.

| Verdict | When | Action |
|---|---|---|
| **APPROVE** | plan identity matches, criteria pass, scope is clean, and quality holds | Return the reviewed patch and executor result to main-context `plan-manager`. It applies the reviewed patch, reruns verification, records `## Verification Results`, dispatches the single post-implementation code review, and follows the manager's full Landing flow. It archives only after an approved merge lands the closing pull request. |
| **REVISE** | fixable gaps | Dispatch a fresh isolated `task` item with the original item content plus specific, actionable feedback and the previous report; do not rely on resuming an isolated run. The fresh run starts again from the unchanged main tree, so its result has its own `<patch>` (or branch and `branchBaseSha`); review it in full. Allow at most two revision rounds, then return a failure result to `plan-manager`. |
| **BLOCK** | STOP hit, scope violated unrecoverably, or revisions exhausted | Return the evidence to `plan-manager`; it sets the plan `blocked` with a reason and does not re-run the plan review. |

Verification in the review checkout is evidence for review, not final
acceptance. `plan-manager` reruns the invalidated checks after applying the
approved patch to the main working tree.

## What stays out of this mode

- The executor never writes lifecycle state, review comments, or
  `## Verification Results`; main-context `plan-manager` owns them.
- The executor creates no commit, pushes nothing, and never merges or applies
  directly to the main working tree. Its only handoff is the reviewed patch and
  result; main-context `plan-manager` owns landing.
- When `task.isolation.enabled` is false, `task.isolation.apply` is true, or
  plan mode is on, this mode is skipped; `plan-manager` runs Phases 7–8 in
  context.
