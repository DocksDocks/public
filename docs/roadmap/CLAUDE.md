# Roadmap Conventions

All non-trivial plans live here. A plan is anything that takes more than one
commit to finish and/or needs checkbox tracking across sessions.

## Lifecycle folders

| Folder | When a plan lives here |
|--------|------------------------|
| `planned/` | Plan is written + approved, but no code has landed yet |
| `ongoing/` | At least one commit toward the plan has landed |
| `finished/` | All tasks checked off; prefixed with completion date `YYYY-MM-DD-<slug>.md` |

Move the file with `git mv` between folders so history is preserved.

## File header (required)

Every plan starts with a YAML-style metadata block and a status line:

```markdown
---
created: 2026-04-27T23:00:32-03:00
updated: 2026-04-27T23:00:32-03:00
finished: null
status: planned
---

# <Plan Title>
```

Rules:
- **`created`** — set once, never change.
- **`updated`** — bump to the current timestamp on every edit, including task
  check-offs.
- **`finished`** — `null` until the plan moves to `finished/`, then set to the
  completion timestamp.
- **`status`** — one of `planned`, `ongoing`, `finished`. Must match the folder.

Timestamps are ISO 8601 with explicit `America/Sao_Paulo` offset
(`YYYY-MM-DDTHH:MM:SS-03:00`). Never use relative phrasing like "today" or
"last week" inside the plan. To fetch a fresh timestamp:

```bash
TZ=America/Sao_Paulo date +"%Y-%m-%dT%H:%M:%S%:z"
```

## Real-time task tracking (hard rule)

- Every actionable step is a GitHub-style checkbox: `- [ ] …`.
- **Flip `[ ]` → `[x]` in the same commit that lands the step.** Not a batch
  pass later. Not "I'll check them off at the end." The diff should show code +
  checkbox flip together so the plan always matches reality.
- If a step is abandoned mid-flight, strike it through (`~~…~~`) with a
  one-line reason rather than silently deleting it.
- If scope changes, update the plan in the same commit that enacts the change.

## Lifecycle transitions

| Transition | What to do |
|------------|------------|
| New plan | Create in `planned/<slug>.md` with the header, status `planned`. |
| First commit toward plan | `git mv` to `ongoing/`, flip status to `ongoing`, bump `updated`. |
| Last checkbox flips | `git mv` to `finished/YYYY-MM-DD-<slug>.md`, set `finished`, flip status to `finished`, bump `updated`. |
| Plan superseded | Move to `finished/` with `status: superseded` and a one-paragraph note explaining what replaces it. |

## Slugs

Lowercase, hyphenated, descriptive. Match the primary commit scope where
possible (e.g. `subagent-pipeline-improvements`, `research-gate-rollout`).

When a plan lands in `finished/`, prefix with the completion date to keep the
folder chronologically browsable:

```
finished/2026-04-27-subagent-pipeline-improvements.md
```

## Not a plan

Reference docs, architecture notes, conventions, and rubric explanations do
**not** belong here — they belong in `ssot/.claude/skills/`,
`ssot/.claude/agents/`, or the kit's root `CLAUDE.md`. This folder is strictly
for time-boxed work items where progress needs to be tracked across sessions.

Open Concerns in the root CLAUDE.md (kit-level bugs / wait-on-upstream items)
are also not plans — they document conditions for resolution rather than
checkbox-driven work.
