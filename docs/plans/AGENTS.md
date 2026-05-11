# AGENTS.md — docs/plans/

Tactical work-item tracker. Every non-trivial work item — anything that
takes more than one commit, or whose progress needs to survive an
auto-compact — lives here as a plan file. The `plan-manager` agent
(invoked via `/docks:plan`) reads plans, evaluates schedule triggers, and
dispatches to assignee agents.

## Directory layout

```
docs/plans/
├── AGENTS.md       # this file — rules (canonical, multi-tool)
├── CLAUDE.md       # one-line @AGENTS.md shim for Claude Code discovery
├── planned/        # specced, not started — actionable when picked up
├── ongoing/        # actively being worked on
├── blocked/        # waiting on a specific external input
├── scheduled/      # queued for date- or approval-triggered auto-execution
└── finished/       # shipped
```

A plan is a single `.md` file that moves between directories as its status
changes. Each category has a `.gitkeep` so empty directories survive in git.

## Multi-occupancy — every category, always

**Every lifecycle directory holds an arbitrary number of plans
simultaneously.** There is no "current plan" slot, no per-category cap, no
"finish or block this one before starting another." Parallel work is the
default — multiple ongoing plans, multiple scheduled plans, multiple
blocked plans all coexist. The directory name describes lifecycle stage,
not occupancy.

When `plan-manager` moves a plan between directories, it never checks
whether the destination is "occupied." If three plans are already ongoing
and a fourth moves from `planned/` to `ongoing/`, that's expected, not a
conflict.

## Category semantics

| Category | Why a plan lives here | Who moves it out |
|---|---|---|
| `planned/` | Internal queue — could start tomorrow. | Human picks it up |
| `ongoing/` | At least one assignee is actively working it. | Human or agent, on ship or block |
| `blocked/` | External dependency named in `blocked_reason`. | Human, when external input lands |
| `scheduled/` | Auto-execution queued for date or manual approval. | `plan-manager`, when trigger fires |
| `finished/` | Shipped or superseded — terminal. | (terminal) |

## File conventions

Every plan file has frontmatter + body. Base frontmatter (all categories):

```markdown
---
title: Short imperative title, ≤70 chars
status: planned | ongoing | blocked | scheduled | finished
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee: null | <agent-name-from-.claude/agents/>
blockers: []
blocked_reason: null
blocked_since: null
ship_commit: null
---

## Context
One short paragraph: why this work, what it unblocks.

## Scope
Bullet list of concrete changes — files, migrations, workflows, RPCs.

## Acceptance criteria
What "done" looks like. Specific enough to verify. Tri-state checkboxes
work well here: `- [ ]` planned, `- [~]` in flight (uncommitted scratch),
`- [x]` shipped — `[x]` is binding, `[~]` is freely toggled.

## Out of scope
Anything adjacent that is NOT in this plan.

## Blockers
Empty, or bulleted list of specific external inputs needed.

## Notes
Design decisions, open questions, related plans.
```

### `scheduled/` adds three fields

```markdown
---
trigger: date | manual-approval
scheduled_date: "2026-06-01T09:00:00-03:00"   # required when trigger: date
auto_execute: false                            # true → plan-manager fires silently
---
```

`plan-manager` fires the plan when `now > scheduled_date`. With
`auto_execute: false` (default), it lists the DUE plan for user approval
first. With `auto_execute: true`, it moves the file to `ongoing/` and
dispatches to the assignee agent without asking.

### Frontmatter rules

| Key | Rule |
|---|---|
| `title` | Imperative, ≤70 chars, no trailing period. First line of body must repeat as `# Title`. |
| `status` | Must match the containing directory. |
| `created` | Never changes after the file exists. |
| `updated` | Bump to today's date on every substantive edit. |
| `assignee` | Name of an agent under `.claude/agents/` (no `.md` suffix). `null` = plan-manager picks or asks. |
| `blockers` | Array of short strings. Empty → actionable immediately. |
| `blocked_reason` | One-line reason naming the external actor + the specific input needed. Required when `status: blocked`. |
| `blocked_since` | Date the plan first moved into `blocked/`. Cleared only when leaving `blocked/`. |
| `ship_commit` | Full SHA once the work lands on `main`. Only populated for `finished/`. |
| `trigger` | `date` or `manual-approval`. Required for `scheduled/`; absent elsewhere. |
| `scheduled_date` | ISO 8601 with offset. Required when `trigger: date`. |
| `auto_execute` | `true` = silent fire; `false` (default) = surface for approval. |

## Lifecycle transitions

| Transition | What to do |
|---|---|
| New plan | Create in `planned/<slug>.md` (or `scheduled/<slug>.md` if it has a trigger). |
| First commit toward plan | `git mv` to `ongoing/`, flip status, bump `updated`. |
| Block | `git mv ongoing/ → blocked/`, set `blocked_reason`, `blocked_since`. |
| Unblock | `git mv blocked/ → ongoing/`, clear `blocked_reason` and `blocked_since`. |
| Schedule trigger fires | `plan-manager` does `git mv scheduled/ → ongoing/`, removes scheduled-only keys, dispatches to assignee. |
| Ship | `git mv` to `finished/<YYYY-MM-DD>-<slug>.md`, set `status: finished`, paste SHA into `ship_commit`. |
| Supersede | Move to `finished/` with "Superseded by `<slug>`" in Notes. Don't delete. |

## Pretty-print preview contract

After any agent writes a plan or moves it between directories, it MUST
render the file content in chat — never leave the user to open the file:

```
Created docs/plans/planned/20260511-w2-whatsapp-send.md

  title       Wire W2 send_whatsapp branch
  status      planned (just now)
  assignee    supabase
  blockers    none
  created     2026-05-11

---

# Wire W2 send_whatsapp branch

(body rendered verbatim — markdown headings render natively in the chat)

---

docs/plans/planned/20260511-w2-whatsapp-send.md
```

Computed fields the renderer adds (not stored in frontmatter): age strings
("4 days in queue", "blocked 47 days · waiting on Bruno"), trigger state
for scheduled ("date · in 2 days" / "OVERDUE by 6 hours").

For bulk listings ("any plans planned?" with N > 1), use a one-line digest
per plan instead of full previews:

```
docs/plans/planned/ (3)
  20260511-w2-whatsapp-send.md     supabase   Wire W2 send_whatsapp branch
  20260509-image-cdn-migration.md  null       Migrate image CDN to R2
```

## Auto-compact resilience

The plan file on disk is the source of truth — it isn't part of
conversation context, so auto-compact never touches it.

- **Re-read before resume** when picking up after a gap.
- **Update as you go** in the file, not just in chat.
- **Don't track state only in chat** — mirror anything important to the plan file.

## Slugs and naming

`<YYYYMMDD>-<kebab-slug>.md` (e.g., `20260511-w2-whatsapp-send.md`). Date
prefix keeps `ls` chronological. On ship, change the prefix to the
completion date: `finished/2026-05-04-auth-rate-limit.md`.

## When to create a plan

Create a plan for: multi-commit work, work that crosses subsystems, work
blocked on external info, work the user says "plan first", anything
time-triggered. Skip for: single-file tweaks, lint fixes, typo
corrections, one-shot ops tasks.

Reference docs, architecture notes, and API contracts do not belong here
— they belong in `.claude/skills/`, `.claude/agents/`, or the project's
root `AGENTS.md` / `CLAUDE.md`.

(Template generated by `plan-init` on 2026-05-11T18:42:48-03:00; converted
to AGENTS.md canonical layout on 2026-05-11T19:17 after plan-init skill
update.)
