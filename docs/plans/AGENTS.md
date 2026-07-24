# AGENTS.md — docs/plans/

Canonical plans are complete cold handoffs for work that benefits from durable
coordination. The Markdown plan is the only tracked artifact; rendered views are
disposable. `active/` is multi-occupancy and `finished/` is the terminal archive.

Use direct implementation for one clear, reversible, low-risk local diff with one
bounded acceptance path. Direct work creates no plan, reviewer invocation, or
automatic commit. Use a canonical plan for an explicit planning request,
multi-commit or cross-repository work, scheduling, cold handoff, an unresolved
decision, a cross-subsystem or public-contract change, security-sensitive or
destructive work, or any requested external effect. Never create a placeholder
plan merely to unlock review.

<constraint>
There are exactly three live owners. `plan-workspace` maintains this workspace.
Main-context `plan-manager` owns goal classification, drafting, bounded review,
one accepted repair, lifecycle, implementation/delegation, observed acceptance,
archive, and guarded GitHub issue publication. Internal `plan-reviewer` reads one
immutable bundle and returns `PlanReviewV1` evidence only. Only the reviewer has
Claude/Codex wrappers; main invokes `plan-manager` directly.
</constraint>

<constraint>
Current plans contain exactly one unfenced `Plan-run: <compact JCS PlanRunV1>`
line. Schemas 1–6 are historical validation/quarantine formats only: preserve
their bytes and validation behavior, but never emit one as current authority.
Malformed, crossed, active, prepared, committed, cancelled, or otherwise
unsettled legacy evidence never blocks an unrelated goal and never authorizes a
current dispatch or external effect.
</constraint>

## Skill routing

| Request | Owner |
|---|---|
| Bootstrap, migrate, audit, or explicitly refresh `docs/plans/` | `plan-workspace` |
| Decide direct work versus a canonical plan; create, review, repair, execute, verify, block, schedule, finish, archive, list, show, or publish a plan | main-context `plan-manager` |
| Inspect one immutable draft-review bundle and return typed findings | internal `plan-reviewer` |

No creator, repairer, improver, or manager wrapper is live. A missing reviewer
wrapper does not create another role: dispatch a fresh read-only task with the
same `PlanReviewV1` contract.

## Directory and frontmatter

```text
docs/plans/
├── AGENTS.md
├── CLAUDE.md      # exactly @AGENTS.md
├── active/        # every nonterminal plan; status is frontmatter
└── finished/      # terminal archive, unique date-prefixed filename
```

Every current plan starts with a closed frontmatter map. Project-specific fields
may extend this shape only when the nested contract names them.

```yaml
---
title: Short imperative title, ≤70 chars
goal: One observable sentence, ≤200 chars
status: drafting | planned | scheduled | ongoing | blocked | finished
created: "2026-07-24T12:00:00+00:00"
updated: "2026-07-24T12:00:00+00:00"
started_at: null
finished_at: null
assignee: null
tags: []
affected_paths: []
related_plans: []
---
```

`blocked` adds `blocked_reason` and `blocked_since`. `scheduled` adds
`trigger: date | manual-approval`, and a date trigger adds `scheduled_date` plus
`auto_execute`. Set `started_at` once on first `ongoing`; set `finished_at` only
when archiving. All timestamps are quoted ISO 8601 with an offset.

## Cold-handoff body

Every canonical plan contains `## Goal`, `## Context & rationale`,
`## Environment & how-to-run`, `## Steps`, `## Acceptance criteria`,
`## Out of scope / do-NOT-touch`, `## STOP conditions`, `## Open questions`,
`## Review`, and manager-written `## Verification Results`. Use a specific
`N/A — <reason>` only when a section truly does not apply.

The Steps table is exact:

| # | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|
| 1 | concrete action | exact paths | — | `local` | `planned` | observable proof or STOP |

`Effect` is exactly `local | probe | production_access | publish | push |
release | deploy`. Status is exactly `planned | in-flight | done | blocked |
skipped`. Every row names exact paths and an observable done condition.
Acceptance uses ordered unique ids in an `ID | Command | Expected` table. Plans
must not contain `TBD`, `TODO`, vague follow-ups, or undefined forward references.

## Current record

```text
ReviewPhaseV1 = {
  state: "not_required"|"not_started"|"reserved"|"retryable"|"repairing"|"passed"|"degraded"|"blocked"|"cancelled",
  invocations: 0|1|2,
  input_sha256: null|64hex,
  result_sha256: null|64hex
}

PlanRunV1 = {
  schema: 1,
  goal_id: uuid,
  run_id: uuid,
  repository_id: string,
  plan_path: normalized-relative-path,
  requested_effects: ["local", ...("probe"|"production_access"|"publish"|"push"|"release"|"deploy")],
  risk: "local"|"sensitive"|"external",
  plan_sha256: 64hex,
  source_base: null|40hex,
  source_sha256: 64hex,
  draft_review: ReviewPhaseV1,
  execution_parent: null|40hex,
  implementation_commit: null|40hex,
  completion_review: ReviewPhaseV1,
  acceptance: null|{source_sha256:64hex,verification_sha256:64hex},
  blocker: null|{kind:"user_decision"|"missing_authority"|"concurrent_change"|"user_cancelled"|"verification_failed"|"review_failed"|"legacy_invalid",evidence_sha256:64hex}
}
```

Compact JCS is byte-authoritative. `repository_id + plan_path + run_id` is the
run identity. Cross-repository goals use one child run per repository joined by
`goal_id`; never record an unqualified commit as cross-repository identity.
`requested_effects` is unique and canonical-ordered, always beginning with
`local`. It records intended scope, never authority.

`plan_sha256` covers the canonical plan after excluding only lifecycle status and
timestamps, the `Plan-run` line, `## Review`, and `## Verification Results`.
Goal, scope, paths, steps, effects, safety, acceptance, and open decisions remain
bound. `source_base` plus `source_sha256` binds a canonical sorted existence,
kind, mode, and content manifest for every affected path at review time,
including dirty/untracked bytes and tombstones. `acceptance.source_sha256` binds
the final affected-path manifest; `verification_sha256` binds canonical
Verification Results bytes.
`source_base` is null only before draft review starts and is required thereafter.
`execution_parent` is null before start and is required, immutable, and exclusive
to `ongoing`, post-start `blocked`, and `finished` tuples.

## Closed phase table and transitions

| Phase state | Invocations | Input | Result | Extra rule |
|---|---:|---|---|---|
| `not_required` | 0 | null | null | completion only, local risk |
| `not_started` | 0 | null | null | draft, or sensitive/external completion |
| `reserved` | 1–2 | hash | null | one live launch only |
| `retryable` | 1 | hash | failure hash | transport failure only |
| `repairing` | 1 | hash | reviewer-result hash | accepted repair verdict only |
| `passed` | 1–2 | hash | reviewer-result hash | validated matching output |
| `degraded` | 2 | hash | failure-set hash | draft only, local risk only |
| `blocked` | 1–2 | hash | evidence/result hash | terminal for this run |
| `cancelled` | 1–2 | hash | cancellation hash | terminal for this run |

Legal phase transitions are only `not_started → reserved`; `reserved → passed |
repairing | blocked | cancelled | retryable | degraded`; `retryable → reserved |
blocked | cancelled`; and `repairing → reserved | blocked | cancelled`.
`reserved → retryable` is invocation 1 only. `reserved → degraded` is invocation
2, draft/local transport failure only. The second `reserved` consumes the final
permit. `not_required`, `passed`, `degraded`, `blocked`, and `cancelled` are
terminal.

Before spawning, transactionally increment the invocation count and persist
`reserved` with the exact input digest. A lost result still consumes that permit.
An arriving result may mutate only the matching phase while it remains
`reserved` with the same run id, invocation, and input hash; stale results are
discarded. Cold entry into `reserved` changes it to `blocked` with dangling-launch
evidence and never redispatches.

## Closed lifecycle and tuple matrix

Lifecycle transitions are only absent → `drafting`; `drafting` → `planned |
scheduled | ongoing | blocked`; `planned` ↔ `scheduled`; `planned | scheduled` →
`ongoing | blocked`; and `ongoing` → `finished | blocked`. `finished` is terminal.

| Frontmatter status | Draft phase | Completion phase | Implementation / acceptance | Blocker |
|---|---|---|---|---|
| `drafting` | active states through `passed`, plus local-only `degraded` | risk baseline | both null | null |
| `planned` / `scheduled` | `passed`, or local-only `degraded` | risk baseline | both null | null |
| `ongoing` local | `passed | degraded` | `not_required` | implementation null; acceptance null | null |
| `ongoing` sensitive/external before completion | `passed` | `not_started` | both null | null |
| `ongoing` sensitive/external during/after completion | `passed` | `reserved | retryable | repairing | passed` | implementation required; acceptance required except that replacement clears stale acceptance while `repairing`, then the next reservation rebinds it | null |
| `blocked` before start | baseline or terminal draft | risk baseline | both null | required |
| `blocked` local before acceptance | `passed | degraded` | `not_required` | both null | required |
| `blocked` local after acceptance | `passed | degraded` | `not_required` | implementation null; acceptance required | `concurrent_change` only |
| `blocked` sensitive/external before completion | `passed` | `not_started` | both null | required |
| `blocked` sensitive/external during completion | `passed` | `blocked | cancelled` | implementation and acceptance required | required |
| `blocked` sensitive/external after completion | `passed` | `passed` | implementation and acceptance required | `missing_authority | concurrent_change` only |
| `finished` local | `passed | degraded` | `not_required` | implementation null; acceptance required | null |
| `finished` sensitive/external | `passed` | `passed` | implementation and acceptance required | null |

Draft baseline is `not_started`. Completion baseline is local `not_required` or
sensitive/external `not_started`. A pre-dispatch `user_decision` or
`missing_authority` blocker whose phases remain baseline may return to
`drafting` or `ongoing` when new current-user input answers it; consumed permits
never reset. Every other blocked or cancelled run is terminal. Continuation uses
a new `run_id` and treats old output as non-authoritative.

## Main-context orchestration

1. Classify the goal. Direct local work stays untracked. Otherwise create one
   canonical `drafting` plan and current record in the working tree.
2. Research repository facts, bind the plan/source manifests, reserve draft
   invocation 1, and launch one fresh `plan-reviewer` over a private immutable
   bundle. The prompt carries only bundle path plus run/invocation/hash bindings.
3. On `pass`, continue. On a repository-grounded `repair`, patch only the exact
   accepted blocking set, recompute both hashes, reserve invocation 2, and use a
   fresh reviewer. On a real missing decision/authority, block with evidence.
   A first transport failure may spend invocation 2 as a retry instead of repair.
   Two transport failures may degrade only reversible local draft work; sensitive,
   destructive, public-contract, security, or external work blocks.
4. A plan-only request writes `planned` or `scheduled` and makes one owned-path
   checkpoint commit/read-back. A canonical implementation writes `ongoing`,
   captures `execution_parent`, and makes one reviewed start checkpoint.
5. Implement or delegate local steps, run their requested smoke/acceptance paths,
   and write canonical Verification Results. Diagnose ordinary verification
   failures inside the implementation loop; repeated same-signature failure with
   no relevant-byte progress blocks and never reopens draft review.
6. Ordinary local work records acceptance, writes `finished`, moves once to a
   unique archive path, and commits implementation plus finished plan as one final
   checkpoint. It has no completion reviewer.
7. Sensitive, destructive, public-contract, security, or external work first
   commits the implementation checkpoint, binds its exact diff, and runs a fresh
   code-review agent returning `CompletionReviewV1`. One accepted blocker fix
   replaces/amends the unpublished checkpoint, reruns invalidated checks, and
   consumes invocation 2 on the replacement SHA. Only a matching pass may create
   the archive checkpoint.

No numeric score, finding quota, fallback provider/model, resumed reviewer,
third invocation, completion-plan recursion, automatic push, or per-round
state/request/receipt commit exists.

## Transactions and checkpoint commits

Every plan mutation acquires an atomic exclusive lock keyed by repository and
normalized plan path; verifies exact bytes and run preimage; reduces one closed
transition; writes and fsyncs a sibling; atomically renames; reads back; then
releases. A checkpoint additionally acquires the repository lock, verifies
expected HEAD, index, and owned-path preimage, commits only owned paths, and
reads the commit back before release. Any mismatch fails before write, dispatch,
or external action and records `concurrent_change` when the tuple permits.

A same-host dead-owner lock may be reclaimed only after matching owner PID,
`run_id`, and unchanged preimages. A live, foreign, ambiguous, or changed stale
lock blocks. Never weaken a lock, reset the index, include unrelated changes, or
infer that another session owns a change.

Checkpoint ceilings: direct local work 0 automatic commits; reviewed plan-only 1;
ordinary canonical implementation 2 (start, final); sensitive/external work 3
(start, implementation, archive). A real terminal blocker may add one cold-handoff
blocker commit. No automatic push follows any checkpoint.

## Reviewer records

```text
PlanReviewV1 = {
  schema:1, run_id:uuid, invocation:1|2,
  plan_sha256:64hex, source_sha256:64hex,
  verdict:"pass"|"repair"|"blocked",
  findings:[{id,kind:"missing_decision"|"contradiction"|"unsafe_scope"|"missing_acceptance",locator,defect,fix}]
}

CompletionReviewV1 = {
  schema:1, run_id:uuid, invocation:1|2,
  implementation_commit:40hex, diff_sha256:64hex,
  verdict:"pass"|"repair"|"blocked",
  findings:[{id,kind,locator,defect,fix}]
}

ReviewInvalidInputV1 = {
  schema:1,
  error:"invalid_input",
  reason:"bundle_unavailable"|"bundle_integrity_failed"|"bundle_binding_mismatch"
}
```

The two verdict records are closed compact JCS objects capped at 32 KiB. `pass`
has no findings; other verdicts have at least one. Draft `repair` contains only
defects resolvable from already-grounded repository facts. Draft `blocked`
contains only a required user decision or missing safety authority. The manager
validates every binding and accepts only reproducible findings; reviewer prose
never mutates state.

`ReviewInvalidInputV1` is a closed failure result, never a review verdict.
Classify it before generic transport, parse/output, or verdict handling. The
manager consumes it only through `review_invalid_input` against the exact
reserved `run_id`, invocation, and `input_sha256`; it hashes the closed result
and immediately records the review phase and plan status as terminal `blocked`
with blocker `review_failed`. It never retries, degrades, repairs, changes any
other lifecycle state, or infers authority from this result.

## Effects and live authority

Local planning, edits, verification, and lifecycle may continue without external
authority. Every non-local row requires a live value derived from the exact
current-user message still present in main context:

```text
ExternalAuthorityV1 = {
  scopes: ["probe"|"production_access"|"publish"|"push"|"release"|"deploy", ...],
  mode: "read"|"mutate",
  targets: [exact-target, ...],
  source_sha256: sha256(exact-current-user-message-bytes)
}
```

Scopes are unique and canonical-ordered. `probe` must be the sole scope and
`mode:"read"`; every other scope requires `mode:"mutate"`. Scope, mode, target,
and live source digest must match at the instant of action. Persisted plan intent,
an old prompt digest, a schedule, a passed review/test, or a receipt grants
nothing. Cold recovery requires a new explicit current-user instruction.

A named `release` authorizes only that repository's documented atomic release
recipe, including its necessary tag/push/artifact publication; it grants no
deployment or production access. Standalone `push`, `publish`, `deploy`, or
production mutation needs its own literal scope and target. A probe never grants
mutation. Without authority, skip and report the external row while continuing
safe local rows; block only when the missing effect is acceptance-critical.

## GitHub issue publication

`--issues` or `publish <slug> as an issue` is a `publish` effect. Require an
existing canonical plan plus exact live publish authority for the repository.
Before creating anything, require successful `gh auth status`, a GitHub remote,
and `gh repo view --json visibility`. For a public repository, warn that the
issue is public and require explicit confirmation when the plan names a
vulnerability, credential location, or other sensitive finding. A failed check,
missing authority, or declined confirmation creates no issue and writes nothing.

Create the issue with the canonical title/body, record the returned URL in
`## Notes` through the plan transaction, and read it back. Publication never
changes lifecycle status, dispatches review, or makes the issue authoritative.
Report success only after the owned Notes checkpoint succeeds.

## Legacy quarantine and views

List, show, and workspace audit scan frontmatter first; they do not validate every
active plan as a prerequisite. Classify legacy evidence only for the requested
target. A record-free plan or complete settled terminal schema-1–6 family may be
migrated target-locally during an explicitly requested local start. Active,
prepared, commitment, cancellation, crossed, malformed, or otherwise unsettled
evidence is `legacy-quarantined`: render it, but never dispatch, resume, abandon,
repair, consume, or rewrite it.

An unrelated fresh local goal may create a new `PlanRunV1`; dangling legacy
records provide no authority. External recovery always requires new live
`ExternalAuthorityV1`. Never edit a historical finished plan during migration,
audit, list, show, or current orchestration.

## Audit checks

Before claiming success, verify the exact path, closed frontmatter, one valid
Plan-run line, repository/path/run identity, status tuple, plan/source hashes,
transaction read-back, owned commit path set, review permit count, and observed
acceptance bindings. Never claim a wrapper ran merely because its file exists,
claim review passed from reservation, translate stale output into state, or
translate persisted intent into external authority.
