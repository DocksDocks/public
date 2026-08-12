# AGENTS.md — docs/plans/

The markdown plan is the only tracked artifact. `active/` is multi-occupancy, `finished/` is the terminal archive, and rendered views are disposable.

Use direct implementation for one clear, reversible, low-risk local diff with one
bounded acceptance path; it creates no tracked plan, reviewer, or automatic
commit. Use a canonical plan for explicit planning, multi-commit or
cross-repository work, cold handoff, an unresolved decision, a cross-subsystem or
public-contract change, security-sensitive or destructive work, or any
non-`local` effect.

## Skill routing

| Request | Owner |
|---|---|
| Maintain, bootstrap, migrate, audit, or explicitly refresh the workspace | `plan-workspace` |
| Run the six phases and archive the plan | main-context `plan-manager` |
| Return a readable pre-implementation verdict | internal `plan-reviewer` |

The two read-only wrappers are `plan-reviewer` and `code-reviewer`. Main context invokes `plan-manager` directly. A missing wrapper never creates another role. Dispatch one fresh read-only subagent with the same three-kind contract.

## Directory and frontmatter

```text
docs/plans/
├── AGENTS.md
├── CLAUDE.md
├── active/
├── finished/
└── QUEUE.md (optional)
```

A v2 plan uses exactly this closed frontmatter map. Key order is not significant:

```yaml
---
plan_contract: v2
title: Short imperative title, at most 70 characters
goal: One observable sentence, at most 200 characters
status: drafting | planned | ongoing | blocked | finished
created: "2026-08-08T12:00:00+00:00"
updated: "2026-08-08T12:00:00+00:00"
assignee: null
---
```

`status: blocked` adds exactly one key, `blocked_reason: <non-empty text>`. No other status carries it.

`created` and `updated` are double-quoted ISO timestamps that carry an explicit offset. `updated` never precedes `created`.

The CLI reports `check 1: frontmatter keys and plan_contract must match the closed v2 map` when this closed-map contract fails.

Every v2 plan declares `plan_contract: v2` in a closed frontmatter map and carries exactly these eight `##` sections, in this order, each present once: `## Goal`, `## Research`, `## Steps`, `## Acceptance`, `## Do not touch`, `## Open questions`, `## Review`, `## Verification Results`.

`## Goal` contains exactly one `Mode: plan-and-implement` or `Mode: plan-only` line.

Once the plan leaves `drafting`, `## Research` must no longer carry the template placeholder `_Not researched yet._`.

The CLI reports `check 11: Research must be filled once the plan leaves drafting` when this research rule fails.

The body contains no absolute machine path. A plan is a cold handoff, and a path from one machine is not portable.

## Plan tables

The Steps table uses this exact header:

```text
| # | Id | Task | Files | Depends | Effect | Status | Done when |
|---:|---|---|---|---|---|---|---|
```

`#` is the positive display number. `Id` matches `[a-z][a-z0-9_]{0,63}` and is unique. `Task`, `Files`, and `Done when` are non-empty. `Depends` is `—` or a comma-separated list of lower display numbers from the same table. `Effect` is exactly one of `local`, `probe`, `production_access`, `publish`, `push`, `release`, or `deploy`. `Status` is exactly one of `planned`, `in-flight`, `done`, `blocked`, or `skipped`; `done` and `skipped` are terminal. `Done when` names one observable proof and carries no "or STOP" clause. Step citations use `step:<id>` and resolve to a declared id.

No Steps `Files` cell names the plan's own path. Writing lifecycle state into the record is the CLI's job, not an implementation step.

When a step cannot complete, first run `plan.mjs step <slug> <step-id> blocked`, then record the reason with `plan.mjs status <slug> blocked --reason <text>`.

The Acceptance table uses this exact header:

```text
| ID | Command | Expected |
|---|---|---|
```

Acceptance IDs are unique. `Command` and `Expected` are non-empty.

## Lifecycle transitions

The legal plan status transitions are:

```text
drafting  -> planned | ongoing | blocked
planned   -> drafting | ongoing | blocked
ongoing   -> finished | blocked
blocked   -> drafting | planned | ongoing
finished  -> (terminal, no transition)
```

The `planned -> drafting` transition returns a plan to drafting after substantive review repair.

An absent plan begins at `drafting`. A finished plan lives in `docs/plans/finished/`.

The single exemption is `plan.mjs retire`: it sets `finished` from any non-`finished` status, writes a final `## Retirement` section with the reason, and is the only path to `finished` without a passed code review.

## Lifecycle commands

`plan.mjs` is plugin payload, not project payload. It ships inside the installed `plan-lifecycle` plugin at `skills/productivity/plan-manager/scripts/plan.mjs`. A project never vendors, copies, or re-creates it, and an unresolvable tool means the plugin is not installed. Never report it as a file missing from the repository. Resolve it from the loaded `plan-manager` skill directory, or from the runtime plugin cache. Run it with the repository root as the working directory, because it resolves `docs/plans/` relative to the current directory.

| Command | Semantics |
|---|---|
| `plan.mjs new <slug> --title <t> --goal <g> [--mode plan-and-implement\|plan-only]` | Create `docs/plans/active/<slug>.md` from the v2 template with `status: drafting`. |
| `plan.mjs check <slug-or-path>` | Run the 13 byte-level validations and print `plan check passed: <path>` on success. |
| `plan.mjs status <slug> <status> [--reason <text>]` | Validate and apply one lifecycle transition. |
| `plan.mjs step <slug> <step-id> <status>` | Rewrite one Steps `Status` cell after checking the plan state and dependencies. |
| `plan.mjs list [--status <s>]` | Print `<status>\t<slug>\t<title>` for active plans, then finished plans. The filter accepts `drafting`, `planned`, `ongoing`, `blocked`, `finished`, `v1`, or `unreadable`. |
| `plan.mjs next` | Print startable plans, using the queue when it is present and valid. |
| `plan.mjs archive <slug>` | Require an ongoing plan, terminal steps, and a passed code review; set `finished` and move the file to `docs/plans/finished/<YYYY-MM-DD>-<slug>.md`. |
| `plan.mjs retire <slug> --reason <text>` | Record abandonment in `## Retirement`, set `finished`, and move the file to `docs/plans/finished/<YYYY-MM-DD>-<slug>.md`. |

Legal step transitions are `planned → in-flight | done | blocked | skipped`, `in-flight → done | blocked | skipped`, and `blocked → in-flight | done | skipped`.

A file whose frontmatter does not declare `plan_contract: v2` is a v1 plan. `list` reports it as `v1` and no command parses it further, so archived history stays visible without a migration path. `unreadable` is reserved for a plan that declares v2 and then fails to parse. A dependency counts as finished when its slug is present in `docs/plans/finished/`, because that directory is the terminal archive.

## Review records

Append review records in these readable shapes:

```markdown
### Plan review — <date>
Plan-review: pass|repair|blocked
- [goal_fit] `## Steps` row 4 — the step removes the validator without replacing it — add the replacement before removal

### Code review round <n> — <date>
Code-review: pass|fixes-required|blocked
- HIGH · Security · plugins/x/y.mjs:41 — user input reaches a shell command unquoted — pass an argument array
```

A `pass` record has no finding lines. Every other verdict has at least one finding line.

A plan-review finding is exactly one of `goal_fit`, `research_gap`, or `security_risk`; nothing else is a finding. A sufficient plan passes.

## Phases

1. **Decide.** Phase 1 asks exactly one question with exactly three options, in this order and wording: `Plan and implement now`, `Plan only, stop at planned`, `Implement directly` — and skips the question only when the request already settles the mode.
2. **Draft.** Create the plan, write the goal and research hypothesis, and keep provisional Steps and Acceptance tables while status remains `drafting`.
3. **Research.** Verify repository facts and external claims, record their sources, choose the durable fix, bind the exact files, complete Acceptance, pass `plan.mjs check`, and set the plan `planned`.
4. **Plan review.** Dispatch exactly one pre-implementation review. Append its verdict and findings. Fix reproduced findings before implementation. A user-only decision goes in `## Open questions`. A plan-only run stops at `planned` after this review.
5. **Implement.** Set the plan `ongoing`, move each step through its legal states, and record real Acceptance output in `## Verification Results`.
6. **Code review.** Review the declared change, fix every critical and high finding, and review again only after such a fix. Archive only after a passed code review.

Build the review diff from what actually changed: `git status --porcelain` names the paths and the diff covers exactly those. Name every changed path that no Steps `Files` cell mentions in the review request, so the reviewer judges undeclared scope instead of the manager blocking on bookkeeping.

If a code-review round returns the same finding-id set as the previous round and no file changed between the two rounds, stop, append `Code-review: blocked` naming that set, and set the plan `blocked`.

A step whose `Effect` is not `local` requires an in-session `ask` confirmation immediately before it runs; when `ask` is unavailable the step is set `blocked` with `blocked_reason` naming the unconfirmed effect.

This lifecycle creates zero commits and never pushes.

## Portability

Cite repository-relative paths only; acceptance rows run from the repository root and carry no `cd <absolute path>` prefix. A cross-repository reference names the other repository by its portable identifier, such as `DocksDocks/docks`, never a local checkout path. Never rewrite a path already captured inside an archived record.

## Legacy plans

A plan carrying a `Plan-run:` line is a v1 plan. Render it, but never parse or migrate it. Finish it by hand by moving the file byte-unchanged to `docs/plans/finished/<YYYY-MM-DD>-<slug>.md` and appending a `## Retirement` section. `plan.mjs` refuses to parse it, and there is no migration path in either direction.

## Queue

`docs/plans/QUEUE.md` is optional and classification-neutral. Its table is `| Stage | Plan | Depends on | Why |`, with `Plan` holding the slug. A row is eligible only when its full direct and transitive dependency closure is finished. Stages give deterministic priority. The queue is a discovery and prioritization view only and grants no lifecycle, review, mutation, or external-effect authority. A workspace without it stays valid.
