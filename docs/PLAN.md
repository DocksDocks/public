# Plans

A plan records a goal, research, ordered work, and verification evidence.
The canonical record is a GitHub issue. Each review round adds one comment to
it. Work that needs more than one landing pull request uses a parent plan with
one child plan (a sub-issue) per pull request. GitHub owns its title, assignee,
labels, timestamps, and completion state.
Do not track plan bodies as repository files.

Read `skill://plan-manager/references/plan-contract.md` for the v5 contract and
helper commands. The docks-kit kit plugin `docks-kit-omp` ships it from
`SoT/.omp/plugin/skills/plan-manager/`, and `docks-kit sync` links that plugin.

Use `plan-workspace` to maintain workspace routing, main-context `plan-manager`
to run the lifecycle, and internal `plan-reviewer` for plan review.
The two read-only wrappers are `plan-reviewer` and `code-reviewer`.
If the kit plugin is not synced, report that prerequisite. Do not invent a
local copy.

`docs/plans/finished/` is frozen pre-GitHub history, not lifecycle input.
An optional `docs/PLAN-QUEUE.md` is a human note only. No helper reads it.

## Project rules

These rules apply in this repository in addition to the contract.

1. A step that runs after the landing merge, such as a release, a deploy, or a
   sync, starts its Task with `After the landing merge`. It stays `planned`
   until that merge and runs only after an in-session `ask`. The contract
   section "Steps after the landing merge" owns the rest.
2. A `plan`-labelled issue is a record, not an invitation. Only the manager
   run that owns the plan moves it.
3. Topic labels such as `security` are project-owned. Attach them with
   `plan.mjs new --label <name>`.
4. A plan body uses repository-relative paths. Acceptance commands run from
   the repository root, with no `cd` to an absolute path. Name another
   repository as `OWNER/REPO`, and write a closing keyword for it as
   `OWNER/REPO#<issue>`.
5. An issue body has no reviewable diff, no `git blame`, no CODEOWNERS, and no
   presubmit check. This repository accepts that loss, because the reviewed
   artifact is the pull-request diff, and the plan issue points at it.
6. The `## Landing changes` section of the root `AGENTS.md` says which changes
   need a pull request.
7. Kit plugin content, such as skills, agents, extensions, rules, and
   commands, belongs in `SoT/.omp/plugin/` of this repository.
