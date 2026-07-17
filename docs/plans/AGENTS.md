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
| "review plan <slug>", auto on steps-complete (`→ in_review`) | `plan-review` |

## Runtime agent dispatch

The `plan-*` skills are canonical. Runtime agents are thin convenience wrappers:
Claude plugins may provide `plugins/docks/agents/plan-manager.md` and
`plan-review.md`, while Codex projects may provide `.codex/agents/plan-manager.toml`
and `plan-review.toml` seeded by `plan-init` or scaffold. Use an agent only when
it resolves and explicit user delegation or runtime policy allows it; otherwise
run the matching skill inline.

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
status: planned | ongoing | blocked | scheduled | in_review | finished
created: "2026-06-14T05:09:31+00:00"
updated: "2026-06-14T05:09:31+00:00"
started_at: null
assignee: null
review_author_company: openai | anthropic | unknown
review_author_tool: <string>
review_author_model: <string>
review_author_effort: <string>
review_waivers: []
tags: []
affected_paths: []
related_plans: []
review_status: null
planned_at_commit: null
execution_base_commit: null
---
```

Status-specific keys are added only when that status applies:

| Added when | Keys |
|---|---|
| `status: blocked` | `blocked_reason` (external actor + input needed), `blocked_since` (ISO datetime) |
| `status: scheduled` | `trigger` (`date` \| `manual-approval`), `scheduled_date` (ISO, required for `date`), `auto_execute` (default `false`) |
| `status: in_review` | `in_review_since` (ISO datetime, set once on `→ in_review`); completion review diffs `execution_base_commit..HEAD` |
| `status: finished` | `ship_commit` (full SHA under review — branch-agnostic) |

`planned_at_commit` is the scaffold/drift base. `execution_base_commit` is the
exact plan-only commit that first changes `planned|scheduled → ongoing`; capture
it, then record its SHA in a second plan-only identity commit before work.
Completion validates that ancestry/start transition and diffs
`execution_base_commit..HEAD`, excluding concurrent pre-start work.

All time-valued keys are ISO 8601 datetimes with offset, captured at write time
via `date '+%Y-%m-%dT%H:%M:%S%:z'` and quoted. `started_at` is set ONCE (first
move to `ongoing`), never re-set. `scheduled` fires when `now > scheduled_date`;
`auto_execute: true` fires silently, else the DUE plan is surfaced for approval.

## Body — spine, plus the sections a cold executor needs

A plan is read cold: a fresh, weaker executor (or a thin subagent) acts on it
with no conversation context. The test for a section is "would its absence force
the executor to guess?" — if yes, it is required; omit a section only when it is
genuinely inapplicable, and then say so explicitly (`N/A — <reason>`), never
silently. Tier by size so a parked idea isn't drowned in empty headings:

- Base spine (every plan): `## Goal`, `## Steps`, `## Acceptance criteria`,
  `## Cold-handoff checklist`, `## Review`.
- Substantive / multi-commit / handoff plans also require (or `N/A — reason`):
  `## Context & rationale`, `## Environment & how-to-run`,
  `## Out of scope / do-NOT-touch`, and — when work crosses files —
  `## Interfaces & data shapes`. Add `## Known gotchas` / `## Global constraints`
  whenever such traps or hard limits exist.

| Section | Required? | Holds |
|---|---|---|
| `## Goal` | yes | what success looks like, why it matters |
| `## Context & rationale` | substantive | why now, what it unblocks, verbatim user decisions — AND the *why* behind each non-obvious choice (rationale dies with the drafting session) |
| `## Environment & how-to-run` | substantive | runtime/tool versions, env vars, and the exact install/build/test/lint commands with flags (`pnpm test`, `pytest -v`) |
| `## Steps` | yes | the `# / Task / Files / Depends / Status` table — every row names the exact path(s) it creates/modifies (`path:line-range` when editing); status enum `planned/in-flight/done/blocked/skipped` |
| `## Interfaces & data shapes` | multi-file | exact signatures / types / JSON shapes a neighboring task consumes or produces |
| `## Acceptance criteria` | yes | each criterion is a command + its expected output, not a prose judgment (EARS phrasing optional) |
| `## Out of scope / do-NOT-touch` | substantive | adjacent work excluded, stated positively (an agent can't infer it from omission); per-file do-NOT-touch with one-line blast-radius rationale |
| `## Known gotchas` | when traps exist | framework/repo pitfalls that otherwise live only in conversation |
| `## Global constraints` | when limits exist | version floors, dependency limits, naming/copy rules, platform reqs — one line each, copied verbatim from the spec |
| `## Cold-handoff checklist` | yes | the binary required-content gate (see below) — each item present & specific or `N/A — reason` |
| `## STOP conditions` | on risky/handoff plans | named escape hatches — "if assumption X turns out false, STOP and report; do not improvise" |
| `## Open questions` | when decisions pending | agent→user residue; `NEEDS CLARIFICATION` marks a genuine unknown, not a silent default |
| `## Self-review` | on substantive plans | what the local evidence checklist caught |
| `## Review` | yes (placeholder) | `(filled by plan-manager from plan-review evidence on completion)` until shipped |
| `## Mistakes & Dead Ends` | as they happen | append-only `- **<ISO>**: <tried> → <why> → <avoid>` |
| `## Sources` | when it cites code | `file:line` / URL paired with one-line evidence |
| `## Notes` | when useful | design decisions, links |

`plan-manager` fills `## Review` from evidence-only `plan-review` output with:
`Goal met: yes|partial|no`, `Regressions`, `CI`, `Follow-ups`, `Filed by`, and
the primary-review attribution.

### Cold-handoff checklist — the required-content gate

The cold-handoff test is a binary contract, not a reflective question (a draft
can satisfy that superficially). Before a plan is shown, walk this list — each
item is present & specific, or marked `N/A — reason` where the reason proves a
cold executor needs nothing there (a generic "N/A — not needed" is a miss, not a
pass — an unjustified N/A is how any checklist gets gamed); a bare gap is a defect:

1. File manifest — every step names exact path(s) (`path:line-range` to edit).
2. Environment & commands — versions, env vars, exact build/test/lint commands with flags.
3. Interface & data contracts — exact signatures/types/shapes for anything crossing a task boundary.
4. Executable acceptance — a nonempty ordered table containing required
   `ID | Command | Expected` columns (optional descriptive columns are allowed),
   with unique `A1…` IDs; every criterion is executable.
5. Out of scope — what NOT to touch, stated positively.
6. Decision rationale — the *why* behind each non-obvious choice.
7. Known gotchas — the traps that lived only in conversation.
8. Global constraints verbatim — exact values copied from the spec.
9. No undefined terms / forward refs — no `TBD`/`TODO`/"implement later", no reference to a type/function/file defined nowhere in the plan or in cited code.

Then the adversarial cold-read: read ONLY this file and, at each step, enumerate
every decision it does not answer — and challenge every `N/A` (truly
inapplicable, or quietly skipped?). Each unanswered decision or unjustified `N/A`
is a defect — fix it or turn it into an `## Open question` (mark genuine unknowns
`NEEDS CLARIFICATION`).

## Self-review — drafted plans arrive already hole-checked

Drafting runs in produce mode; self-review runs in critique mode. Before showing
a plan, perform one local evidence-backed pass over the same eight criteria as
the independent reviewer:

1. `standalone_executability`
2. `actionability`
3. `dependency_order`
4. `evidence_reverification`
5. `goal_coverage`
6. `executable_acceptance`
7. `failure_modes`
8. `open_questions`

For each criterion record a specific pass or repair the gap. A genuine unknown
becomes an `## Open question`, never a silent default. Record the short finding
list in `## Self-review` and stop after this one local pass. Do not assign a
numeric score or weighted rubric. This author check is not canonical primary
review evidence.

### Strong-default independent review

Every new plan is reviewed before execution by one fresh primary reviewer over
one sealed non-git bundle. `plan-review` is read-only and evidence-only.
Main-context plan-manager alone dispatches, independently reproduces findings,
records the exact accepted/rejected partition, writes receipts, and changes
lifecycle state. Session Relay never transports review evidence.

New policy/request/output/run/receipt records use schema 5:

```text
CurrentReviewPolicyV5 = {
  schema: 5,
  role: "primary",
  fallback: "availability_only",
  max_rounds: 2,
  candidates: [
    {company:"openai", tool:"codex", model:"gpt-5.6-sol",
     effort:"high", service_tier:"default"},
    {company:"anthropic", tool:"claude", model:"fable", effort:"high"},
    {company:"anthropic", tool:"claude", model:"opus", effort:"xhigh"}
  ],
  provenance: {role, fallback, max_rounds, candidates}
}
```

The candidate array and objects are closed and ordered. A current-turn user may
pin one eligible candidate for one review; that narrows the array and never
adds another reviewer. Provenance for each policy field is exactly
`current_user | runtime_global | skill_default`.

Attempt GPT first, then Fable, then Opus. The first valid output wins. Advance
only after `tool_unavailable`, `auth_failed`, or `model_unavailable` with
`output_started:false` and no parsed reviewer result. `platform_denied`,
deadline/timeout, transient transport, signal, nonzero exit,
output/parse/schema failure, any parsed finding, or any substantive output or
verdict is terminal. Never route around host policy, retry a terminal failure,
rotate after output, or shop for a favorable verdict.

The argv builder derives the exact next candidate from the validated
prior-attempt ledger and rejects any skipped or substituted
tool/model/effort/service-tier tuple.

The schema-5 reviewer output is recursively closed:

```text
{
  schema:5,
  role:"primary",
  request:<exact request>,
  verdict:"pass"|"non_blocking_gap"|"blocking_gap",
  checklist:{
    standalone_executability:{status,evidence},
    actionability:{status,evidence},
    dependency_order:{status,evidence},
    evidence_reverification:{status,evidence},
    goal_coverage:{status,evidence},
    executable_acceptance:{status,evidence},
    failure_modes:{status,evidence},
    open_questions:{status,evidence}
  },
  findings:[{id,criterion,status,section,path,locator,defect,fix,evidence}]
}
```

Every status is exactly `pass|non_blocking_gap|blocking_gap` and every evidence
string is nonempty. Verdict equals the strongest checklist status. Every gap
criterion has at least one matching finding; every finding matches its
criterion/status; `pass` has no findings. Any blocking finding makes the run
`not_ready`, even if plan-manager rejects it during reconciliation.

Round 1 is full.
The request field is `review_mode: full` for round 1 and `review_mode: repair` for round 2.
A `pass` or `non_blocking_gap` result is terminal without
repair. Only when every raw `blocking_gap` is independently reproduced and
accepted may plan-manager invoke `plan-improver` once; one rejected blocker
terminates the series. After a minimal applied repair, round 2 requires changed
input and binds the previous-input hash plus the exact accepted-target digest.
Its sealed bundle includes `previous-plan.review.md` and compact-JCS
`repair-targets.json`; it may inspect only those targets and blocking
regressions introduced by the repair. Round 2 passes only with no blocking
findings. There is no round 3, continuation batch, reset, unchanged-input
repair, or fallback after output.
Current outcomes are `passed | not_ready | unavailable | waived`. Zero
successful candidates never fabricate `passed`; preserve the plan's state
unless the current user explicitly waives the exact primary role and input. A
new one-line JCS waiver binds phase, canonical input hash, exactly
`roles:["primary"]`, actor, nonempty reason, and ISO time.

Creation commits `planned` or `scheduled` first. `start`, schedule fire, and
auto execution use `prepare(intent) → main dispatch → apply`; missing, stale,
unavailable, or not-ready evidence never reaches `ongoing`, and an eligible
intent is consumed once. The start transition is a plan-only commit whose SHA
is recorded as `execution_base_commit` in a second plan-only commit before
work. Completion commits `in_review` before an unlinked disposable-clone check.

Current schema-5 receipts bind the exact request, immutable commit/head,
canonical input, bundle, resolved policy/provenance, primary attempt/output,
waiver, accepted/rejected partition, independent reproduction, outcome, time,
and complete `ReviewSeriesV5`; the series final round equals the receipt-derived
run exactly. Completion rounds retain identical `planned_at_commit` and
`execution_base_commit`; completion additionally binds canonical diff
bytes/hash, the exact nonempty ordered acceptance inventory, and one-to-one
evidence. Current full/repair bundle manifests are schema 3/4 with
`review_schema:5` and only the primary v5 output schema. Historical manifest
schemas 1/2 and their X/S files remain byte-compatible. Canonical input excludes
lifecycle/waiver fields and exact machine records; ordinary prose changes
invalidate reuse.

Current completion Review rendering uses a schema-5 primary-review summary;
historical receipts retain their exact X/S Cross-check rendering. Every
schema-5 generic-series, draft/completion reuse, render, and apply path receives
and validates the exact authoritative waiver set.

### Historical policy v1-v4 compatibility

Policy v1-v4, record schemas 1-3, X/S legs, numeric scores and weighted rubrics,
cross-company consent, zero-review progression, and the policy-v4 five-round
lifetime series retain their exact persisted validation meanings. Historical
policy v1/v2 use outer schema 1; policy v3 uses outer schema 2 and explicit
OpenAI service tiers; policy v4 uses outer schema 3 with full/repair identity
and the non-renewable lifetime cap. Historical waivers keep
`legs:["X","S"]`. Historical X/S receipts keep their author-company mapping,
leg-namespaced ids, consent and degradation evidence, ready/score gates,
accepted/rejected reconciliation, and original completion derivation. Never
rewrite them as schema 5 or add keys to their closed request, bundle, output,
run, receipt, prepared-result, or cleanup shapes.

Historical schema-1 policy v1 alone retains its bounded typed transient retry.
Historical policy v2-v4 retain their candidate-specific rotation and attempt
bounds. Historical policy-v4 round 1 is full and later rounds are repair, with
the dated five-round cap and no continuation batch. These instructions validate
old evidence only; new work never launches X/S, asks cross-company consent,
applies a numeric gate, or creates a third review round.

Historical schema-3 Codex reviewers retain their helper-owned disposable
workdirs outside the sealed bundle with `--ephemeral --ignore-user-config`,
explicit model/effort/service tier, and read-only sandbox. Main context verifies
the bundle and removes the workdir only through the helper.

### Docks-only legacy start compatibility

Legacy start compatibility is a closed Docks exception, not a plan-authored
escape hatch. Ordinary execution-range validation runs first and preserves its
existing error order and closed schema-v1 result. Only the helper's exact
abbreviated historical shape may enter compatibility validation; prose,
frontmatter, waivers, or a broadly similar start commit cannot opt another plan
in.

For an eligible historical plan, plan-manager alone writes and commits the
contiguous `E → R → B → Q → F` chain: E applies the helper-generated historical
material, exact diff, and receipt; R records ordinary historical X/S review of
E; B binds the exact E/R evidence; Q applies the helper-generated Docks
release/cache prerequisite after the compatibility source plan has passed and
the immutable patch release is active in both supported caches; F performs a
fresh ordinary historical review of Q. R and F are eligible only as
`dual|single`, with at least one passed leg and every passed leg `ready` with
zero findings. Waivers, `zero_degraded`, `blocked`, `not_ready`, or a
finding-bearing passed leg cannot authorize compatibility. Plan-review and its
helper remain read-only, evidence-only producers throughout.

The application, binding, prerequisite, and both attributed review lines remain
canonical plan input. Completion revalidates their immutable commit chain and
the full execution range; its stable-view reuse removes only the complete
`## Review` partition and still requires the exact rendered receipt block. No
historical review request, bundle, prepared result, completion receipt, or
cleanup schema gains a key. Source readiness is not runtime activation: the
separately authorized Docks release/refresh prerequisite owns immutable release
and cache equality, while a later docks-kit stage may propagate only the generic
execution ladder to consumer-global `AGENTS.md`, never compatibility
eligibility.

### Evidence-complete execution ladder

Use this order to remove redundant work without removing evidence:

1. Assign one writer to each shared worktree. Plan-manager remains the sole
   writer of plan prose, receipts, lifecycle fields, and lifecycle commits;
   every reviewer or auditor is read-only.
2. Run independent read-only audits only when each receives the same immutable
   input and reports evidence separately.
3. After an edit, run syntax/structural checks and direct acceptance first,
   focused regressions next, and broader project/plugin gates last. Run the
   required broad/full gate once at the pre-commit boundary after narrower
   checks pass; any later relevant edit invalidates that run.
4. Reuse evidence only while every bound identity still matches: canonical
   plan input, author, policy/provenance, waiver, sealed bundle, immutable
   commit/head/tree, diff, ordered acceptance inventory, and compatibility
   source/release/cache/application identities.
5. Optimization never skips the current primary review, nonempty ordered
   acceptance inventory or one-to-one primary evidence, start and
   `execution_base_commit` identity commits, plan-only `in_review`, required
   broad gate, or final completion verification, receipt, and reuse. Historical
   compatibility retains its exact X/S evidence. Completion runs each inventory
   row exactly once in order.

Acceptance inventories remain nonempty and task-specific. Omit a broad check
only when the plan records the exact project CI command and retains a fast
independent acceptance row that proves that command's composition or strict
containment of the omitted surface; if containment is uncertain or the
independent proof is absent, retain the row. Newly authored inventories omit
the project CI command itself because completion executes that exact recorded
command separately once after the ordered inventory. This is
plan-manager/plan-review evidence only; historical validators and receipts
remain unchanged.

Completion-review repairs remain `in_review`, preserve the original
`in_review_since`, reopen affected Step rows, and invalidate prior completion
input without inventing an undocumented lifecycle transition.
Main-context completion runs any plan-documented repository setup inside the
disposable checkout before acceptance/CI; setup failure stops without a receipt;
the generic helper never selects a package manager or copies/symlinks
dependencies.

Preserve current attribution:

```markdown
Primary review (<YYYY-MM-DD>): [primary: <company> <model> <effort>] <verdict> — accepted <ids> / rejected <ids> (<reasons>); [<orchestrator>] independently reproduced accepted blocking ids.
```

- Draft reviews append this line inside `## Self-review`; completion reviews
  put a `- **Primary review:** …` bullet inside `## Review`.
- Accepted and rejected ids exactly partition every reproduced finding.
- Historical policy-v1-v4 receipts retain their X/S cross-check and disagreement
  grammar unchanged.

## Open questions — bounded decisions for the user

List a pending decision under `## Open questions`: an `id`, a type (`choice`
with options — mark one `(recommended)`, note `custom allowed` — or `text`),
and enough context to decide. This block is the canonical structured list; how
it's surfaced:

- **Native multiple-choice — mandatory for every question, on every render.**
  Whenever a plan with unresolved `## Open questions` is presented or rendered
  (Tier-3, after ANY write/transition — not only at scaffold), surface each one
  through the runtime's picker in the SAME turn; never leave them as prose for
  the user to answer in free text. Claude Code: `AskUserQuestion`. Codex:
  `ask_user_question` (interactive questionnaire — single/multi-choice + custom
  option; interactive mode only). Use whichever the runtime provides.
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
| New plan | Draft + self-review, then write `active/<slug>.md`, `status: planned`. `created`+`updated` = now; set `planned_at_commit` (`git rev-parse HEAD`). |
| Start | Commit `status: ongoing` + first `started_at`, capture the commit SHA, then record it as `execution_base_commit` in a second plan-only commit before dispatch. No `git mv`. |
| Block | `status: blocked`, set `blocked_reason` + `blocked_since`. No `git mv`. |
| Unblock | `status: ongoing`, clear `blocked_reason`/`blocked_since`. `started_at` unchanged. |
| Schedule fires | `status: ongoing`, drop scheduled keys, set `started_at`, dispatch. (`auto_execute` still halts at `in_review`.) |
| Steps complete → review | All `## Steps` rows `done` → `status: in_review`, set `in_review_since`, dispatch `plan-review` through the current runtime when a resolved agent and explicit delegation/policy allow it (Claude `Agent(subagent_type=...)`; Codex `.codex/agents/plan-review.toml`); otherwise run the `plan-review` skill inline. Completion validates planned/start ancestry, diffs `execution_base_commit..HEAD`, writes `## Review` + `review_status`, and keeps the file in `active/`. No `git mv`. |
| Ship | Only when `review_status: passed` matches a current derived-passed completion receipt (else fix first; if `null`, dispatch review inline). `git mv active/<slug>.md → finished/<YYYY-MM-DD>-<slug>.md`, `status: finished`, bump `updated`, set `ship_commit`. Carries `## Review` forward — no re-dispatch. |
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
| `in_review` | `<X> in review` | now − `in_review_since` |
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
