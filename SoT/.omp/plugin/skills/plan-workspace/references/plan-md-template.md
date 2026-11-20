# Workspace plan pointer

Copy the terminal fenced block to `docs/PLAN.md` and route `docs/AGENTS.md` to
it. Do not create `docs/CLAUDE.md`.
Do not copy the contract into a consuming repository. It stays at
`skills/plan-manager/references/plan-contract.md` inside the
installed `plan-lifecycle` plugin.

```markdown
# Plans

A plan records a goal, research, ordered work, and verification evidence.
The canonical record is a GitHub issue. Each review round adds one comment to
it. Work that needs more than one landing pull request uses a parent plan with
one child plan (a sub-issue) per pull request. GitHub owns its title, assignee,
labels, timestamps, and completion state.
Do not track plan bodies as repository files.

Read `skills/plan-manager/references/plan-contract.md` inside the
installed `plan-lifecycle` plugin for the v5 contract and helper commands.
Resolve this reference from the installed plugin, not a marketplace checkout.

Use `plan-workspace` to maintain workspace routing, main-context `plan-manager`
to run the lifecycle, and internal `plan-reviewer` for plan review.
The two read-only wrappers are `plan-reviewer` and `code-reviewer`.
If the plugin is missing, report that prerequisite. Do not invent a local copy.

`docs/plans/finished/` is frozen pre-GitHub history, not lifecycle input.
An optional `docs/PLAN-QUEUE.md` is a human note only. No helper reads it.
```
