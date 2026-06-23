# AGENTS.md — docs/plans/

Tactical work-item tracker. Every non-trivial work item — anything that
takes more than one commit, or whose progress needs to survive an
auto-compact — lives here as a plan file. **Every plan file is a complete
handoff document**: any agent can pick one up cold, without conversation
context, and continue.

The `.md` is the only tracked artifact. There is no committed HTML, no data
file, no dashboard — views are generated on demand (see "On-demand views").
Operations are skill-driven (cross-tool: Codex and Claude both work via
natural language); the skills are also user-invocable directly.

| User says | Skill triggered |
|---|---|
| "create docs/plans", "bootstrap planning", "migrate my plans" | `plan-init` |
| "list plans", "show <slug>", "start/block/ship <slug>", "new plan <slug>", "fire scheduled" | `plan-manager` |
| "review plan <slug>", auto on `→ finished` move | `plan-review` |

## Directory layout

```
docs/plans/
├── AGENTS.md      # this file — rules (cross-tool source of truth)
├── CLAUDE.md      # one-line @AGENTS.md import for Claude Code discovery
├── active/        # every non-finished plan — status lives in frontmatter
└── finished/      # shipped or superseded — terminal archive
```

**Two folders, not five.** A plan's lifecycle stage (`planned` / `ongoing` /
`blocked` / `scheduled`) is the `status:` frontmatter field, not its
directory. A transition is a one-line field edit — no `git mv` — until the
plan ships, when its `.md` moves `active/ → finished/` (gaining a date prefix).
Status is stored in exactly one place; the folder only answers "is this live or
archived." Each folder has a `.gitkeep` so it survives empty. `ls active/` is
the live list; `plan-manager` renders the rich status/age/progress glance on
demand.

## Multi-occupancy

`active/` holds an arbitrary number of plans at any status, simultaneously.
There is no "current plan" slot, no cap, no "finish this before starting
another." Parallel work is the default — never block an operation because
other plans exist.

## Frontmatter

Every plan file has frontmatter + body. Base frontmatter:

```markdown
---
title: Short imperative title, ≤70 chars
goal: One-sentence precise summary, ≤200 chars
status: planned | ongoing | blocked | scheduled | finished
created: "2026-06-14T05:09:31+00:00"
updated: "2026-06-14T05:09:31+00:00"
started_at: null
assignee: null
tags: []
affected_paths: []
related_plans: []
review_status: null
---
```

Status-specific keys are added only when that status applies:

| Added when | Keys |
|---|---|
| `status: blocked` | `blocked_reason` (external actor + input needed), `blocked_since` (ISO datetime) |
| `status: scheduled` | `trigger` (`date` \| `manual-approval`), `scheduled_date` (ISO, required for `date`), `auto_execute` (default `false`) |
| `status: finished` | `ship_commit` (full SHA under review — branch-agnostic) |

All time-valued keys are ISO 8601 datetimes with offset, captured at write time
via `date '+%Y-%m-%dT%H:%M:%S%:z'` and quoted. `started_at` is set ONCE (first
move to `ongoing`), never re-set. `scheduled` fires when `now > scheduled_date`;
`auto_execute: true` fires silently, else the DUE plan is surfaced for approval.

## Body — lean spine, optional rest

Include an optional section only when it carries content.

| Section | Required? | Holds |
|---|---|---|
| `## Goal` | yes | what success looks like, why it matters |
| `## Steps` | yes | the `# / Task / Depends / Status` table; status enum `planned/in-flight/done/blocked/skipped` |
| `## Acceptance criteria` | yes | checkable conditions — prefer a command + expected output |
| `## Review` | yes (placeholder) | `(filled by plan-review on completion)` until shipped |
| `## Context` | when useful | why now, what it unblocks, verbatim user decisions |
| `## Out of scope` | when useful | adjacent work explicitly NOT included |
| `## Open questions` | when decisions pending | agent→user residue (see below) |
| `## Self-review` | on substantive plans | what the rubric pass caught |
| `## Mistakes & Dead Ends` | as they happen | append-only `- **<ISO>**: <tried> → <why> → <avoid>` |
| `## Sources` | when it cites code | `file:line` / URL paired with one-line evidence |
| `## Notes` | when useful | design decisions, links |

`plan-review` fills `## Review` with: `Goal met: yes|partial|no`, `Regressions`,
`CI`, `Follow-ups`, `Filed by`.

## Self-review — drafted plans arrive already hole-checked

Drafting runs in produce mode (optimistic); reviewing runs in critique mode
(adversarial). Verification is easier than generation, so a plan is drafted,
then red-teamed against the rubric below, before it reaches the user — making
"review each detail and revalidate" automatic. Two question layers: agent→agent
(this rubric, resolved internally) and agent→user (`## Open questions`).

| Check | Hole it catches |
|---|---|
| Actionability | every step has a verifiable done-condition |
| Dependency order | no step needs a later step's output; prerequisites exist |
| Evidence re-verify | every cited `file:line` was opened this session and says what's claimed |
| Goal coverage | with every step done, is the Goal actually met? name the gap |
| Checkable acceptance | criteria are a command + expected output where natural |
| Failure mode | each risky step has a revert trigger |
| Assumption → question | anything guessed becomes an `## Open question`, not a silent default |

Then the cold-handoff meta-frame: "Could a fresh agent execute this with ONLY
this file? Where would it guess?" Every guess → fix it or make it an open
question. Proportional: small plans (≤6 steps, no risk) get the inline rubric;
big/risky plans also get a fresh-context subagent review.

## Open questions — bounded decisions for the user

List a pending decision under `## Open questions`: an `id`, a type (`choice`
with options — mark one `(recommended)`, note `custom allowed` — or `text`),
and enough context to decide. This block is the canonical structured list; how
it's surfaced:

- **Native multiple-choice — the default for every question.** The user just
  clicks an option. Claude Code: `AskUserQuestion`. Codex: `ask_user_question`
  (interactive questionnaire — single/multi-choice + custom option; interactive
  mode only). Use whichever the runtime provides.
- **Visual choice** (component look, layout, palette) → the agent renders the
  options as a self-contained, throwaway `.html` and surfaces it; ephemeral and
  gitignored. No display → hands back the file path.

Answers are encoded into the plan (`## Context` / `## Notes` / `## Steps`), the
answered questions removed, and `updated` bumped. A genuinely non-interactive
run (CI / `codex exec`, where the question tools are disabled) is the floor:
present the options inline and read the reply.

## Lifecycle transitions

A transition is a frontmatter edit; `plan-manager` auto-commits the `.md` after
each one so a fresh session resumes from committed state (the user can amend).

| Transition | What plan-manager does |
|---|---|
| New plan | Draft + self-review, then write `active/<slug>.md`, `status: planned`. `created`+`updated` = now. |
| Start | `status: ongoing`, set `started_at` (first time only), dispatch. No `git mv`. |
| Block | `status: blocked`, set `blocked_reason` + `blocked_since`. No `git mv`. |
| Unblock | `status: ongoing`, clear `blocked_reason`/`blocked_since`. `started_at` unchanged. |
| Schedule fires | `status: ongoing`, drop scheduled keys, set `started_at`, dispatch. |
| Ship | `git mv active/<slug>.md → finished/<YYYY-MM-DD>-<slug>.md`, `status: finished`, bump `updated`, set `ship_commit`. Auto-dispatch `plan-review`. |
| Supersede | Move to `finished/` with "Superseded by `<slug>`" in `## Notes`. |

## On-demand views

No committed dashboard. The view is `ls active/` / `ls finished/` (the set),
`plan-manager` in chat (the rich glance, computed live from frontmatter), or a
throwaway `.html` for a visual open question (gitignored).

## Pretty-print preview contract

After any agent writes or ships a plan, it MUST render the file in chat. Tiers:
Tier 1 goal-listing (`  <slug>: <goal>`, sorted by `(status, age desc)`);
Tier 2 bulk listing (adds assignee + age token + `M/N steps` + `K mistakes`);
Tier 3 single-plan (header strip + body verbatim + file path).

### Age tokens (status-specific; bare `X days` is forbidden)

Computed from frontmatter ISO datetimes vs "now" (anchored once per turn).
Largest unit ≥ 1: `<60s → just now`, `<60min → <X>m`, `<24h → <X>h`,
`<365d → <X>d`, `≥365d → <Y>mo`.

| Status | Age token | Source |
|---|---|---|
| `planned` | `<X> queued` | now − `created` |
| `ongoing` | `<X> in flight` (`(approx)` from `created` if `started_at` null) | now − `started_at` |
| `blocked` | `blocked <X> · waiting on <name>` | now − `blocked_since` |
| `scheduled` | `fires in <X>` / `DUE` / `OVERDUE by <X>` | `scheduled_date` − now |
| `finished` | `shipped <X> ago` | now − `updated` |

Optional `stale <X>` for `ongoing` when `now − updated > 3 days`. Legacy
date-only frontmatter is treated as `T00:00:00<offset>`.

## Audit-first scaffolding

A plan is only as good as the evidence it cites. Before scaffolding a
substantive plan: open/grep every file you intend to cite (every `file:line` in
`## Sources` and `affected_paths` comes from code read this session); pair each
Source with one-line evidence; record verbatim user decisions; prefer
executable acceptance criteria. Proportionality: a 20-line stub needs only a
light audit.

## Auto-compact resilience

The plan file on disk is the source of truth — auto-compact never touches it.
Re-read before resuming after a gap; update the file as you go (not just chat);
the `## Steps` table, `## Mistakes & Dead Ends`, and `## Sources` mean an
incoming agent has everything to continue.

## When to create a plan

Create one for: multi-commit work, work crossing subsystems, work blocked on
external info, "plan first" requests, anything time-triggered. Skip for:
single-file tweaks, lint fixes, typos, one-shot ops. Reference docs and API
contracts belong in skills / agent files / the root AGENTS.md, not here.
