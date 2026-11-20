---
name: yolo
description: "Use when the user explicitly invokes yolo with a request and wants the whole plan lifecycle run without questions: issue, linked branch, codebase and web research, plan review, implementation with docks engineering skills, code review until pass, and a pull request, then one merge question with a run summary. Not for runs that need user checkpoints (use plan-manager), workspace setup (use plan-workspace), or production deploys, publishing, and releases."
user-invocable: true
disable-model-invocation: true
metadata:
  pattern: pipeline
  updated: "2026-11-20"
  content_hash: "dfb708c9766b5e4629b7490b182e88e7950a76a570c392fcb8897df1a3b48d53"
---

# Yolo

Run one user request through the whole plan lifecycle without questions. The
user invokes this skill, and that invocation answers every routine lifecycle
question before the merge. Ask the user once, after the pull request exists.

Read these files from this skill's directory before you start. They are in the
same installed docks-kit kit plugin (`docks-kit-omp`):

- `../plan-manager/SKILL.md` owns the six phases.
- `../plan-manager/references/plan-contract.md` owns the rules. Its Yolo runs
  section replaces the contract questions for this run.
- `../plan-manager/references/github-issue-publication.md` owns the preflight.
- `../plan-manager/references/practices.md` owns the practices of every run.
  This skill names each practice where the run uses it. The contract's
  Delegated decisions section owns each question that the grant of this run
  answers in them.

Run the helper as `docks-kit plan` from the target
repository root. If these files are missing, stop and name the missing
docks-kit kit plugin.

<constraint>
Start only when the user's own message invokes yolo: `/skill:yolo` or a
sentence that names the yolo skill. Otherwise stop and use `plan-manager`. Do
not call `ask` before the merge question. The only
exception is the stall question of the Stall rule in the contract's Delegated
decisions, which this run asks as the contract's Round ceiling says.
After the merge, each production cleanup in the contract's Teardown needs its
own question. Resolve every unknown from the codebase, current official
documentation on the web, or a throwaway experiment.
</constraint>

<constraint>
Do not access production, deploy to production, publish, or release before the
merge. Do not force-push or rewrite history. Do not skip or turn off a
repository hook. Do not stash, move, commit, or delete work that the user made.
Do not merge without a fresh `Merge now` answer.
Do not run a production cleanup without its own question. This invocation does
not answer it.
Before each issue, comment, commit, or pull request write, remove secrets,
tokens, credentials, private hostnames, environment values, and absolute machine
paths. Name a secret by its variable name, not its value. The repository can be
public, so treat every published word as public.
</constraint>

<constraint>
Deliver the most durable solution to the goal behind the request. Fix the root
cause, move every caller, and remove obsolete paths. Do not use a temporary
workaround. Do not reduce scope without a record. When the request has a flaw,
record a correction, do the durable alternative, and continue. A flaw is a
wrong premise, a conflict with the repository, a security risk, or a weak
practice.
</constraint>

## Run order

| Phase | Yolo action | Done when |
|---|---|---|
| Decide | Apply Existing plans and incomplete requests below. Otherwise the path is a new plan with Mode `plan-and-implement`. Ask nothing. | The run adopted a plan, or the goal fits in one sentence |
| Draft | Skip when the run adopted a plan. Run the preflight, create the issue, and set up the linked branch, or for a parent create its children, as Draft below says | The run adopted a plan, or `show <n>` reads drafting and the branch is listed, or for a parent each child is listed |
| Research | Follow Research below | `status <n> planned` succeeds, or `show <n>` of an adopted plan already reads planned or ongoing. No advice needs a decision |
| Plan review | Run Review loops below | `show <n>` reads `plan=pass` |
| Implement | Follow plan-manager phase 5 and Implement below | Verification Results hold real results, and the candidate is committed |
| Code review | Run Review loops below | `show <n>` reads `code=pass` |
| Land | Follow Landing below | The merge question has an answer, or no answer is possible |

Until the run posts its grant event (Draft step 4, or adoption step 3), the
user's invoking message is the authority, and the run makes only the
delegated decisions that Decide and Draft name. From then on, run the Grant
check of the contract's Delegated decisions right before each delegated
decision and each write that relies on the grant: read the `grant:` line of
`show <n>`. When the grant has ended, stop as the contract's Ended grant (Yolo
runs) says.

## Existing plans and incomplete requests

Before Draft, run `list` and `gh pr list --repo <owner/repo> --state open`.

- When the request names an open plan issue, or an open pull request that
  closes one, adopt that plan. Do not run `new`.
- When the request text is incomplete, act on the one reading that the
  repository state supports, such as the only open plan. Record that reading as
  a request correction. When no reading or more than one reading has support,
  stop before any write and report the readings.
- Otherwise go to Draft.

To adopt a plan:

1. Run `show <n>`. Adopt only an open plan. When the helper reports that
   another login owns the plan, stop and report. When the plan is a parent
   (the contract's Record and mode), adopt it with steps 2 to 4 and skip
   step 5. Then get a plan pass that covers the current parent body: when
   `show <n>` does not read `plan=pass`, run Research and Plan review on the
   parent; when, after `plan=pass`, step 2 replaced a `Delegated:` line or
   step 4 changed the parent, run the re-review round that the step names,
   and wait for its pass. The earlier pass does not cover the edited body.
   After that pass, adopt the child that the contract's
   Yolo runs table names with these steps.
2. Export the plan. Add the yolo delegation line to Goal when it is missing.
   When Goal has a live `Delegated:` line, replace that line with the yolo
   line, so Goal keeps exactly one delegation line. Set
   `Mode: plan-and-implement`, and publish that edit with `edit` at once. An
   edit that only sets the Mode line or adds the yolo line needs no
   plan-review round, as the contract's Phases and review comments says.
   After `plan=pass`, a replaced `Delegated:` line needs that round; the
   helper advises it.
3. Post the grant event of this invocation, `Delegation grant: yolo: <quote>`,
   as the contract's Authority events says.
4. Run the Grant check: `show <n>` now reads
   `grant: in force (yolo) by comment <id>`, where `<id>` is the step 3 event.
   Then replace each Goal or Do not touch line that conflicts with this run,
   such as "leave the pull request open". Record a request correction whose
   `Asked:` part quotes the old line, and publish the change with `edit`. After
   `plan=pass`, this change needs a plan-review round, as the contract's Phases
   and review comments says.
5. Reuse the branch that `gh issue develop <n> --list` shows, or the head branch
   of the open pull request. When neither exists, use the contract's Linked
   branch steps.
6. Continue at the first Run order phase whose Done when is not met.

## Draft

1. Run the publication preflight. If it fails, stop and create nothing.
2. If the request would make an undisclosed vulnerability, credential location,
   or other sensitive finding public, stop before any write. Report that a yolo
   run never publishes sensitive findings. Suggest `plan-manager`.
3. Write the goal: outcome, scope, and this exact delegation line.

```text
Yolo: the user delegated every decision except the merge to the agent.
```

4. Create the issue with `new --title <t> --goal <g> --mode plan-and-implement`.
   Post its grant event, `Delegation grant: yolo: <quote>`, as the contract's
   Authority events says.
5. When the request needs more than one landing pull request, that issue is the
   parent, and it gets no linked branch. Create one child per pull request with
   `new --title <t> --goal <g> --mode plan-and-implement --parent <n>`, with the
   delegation line in each goal. Right before you create each child, and again
   right before its grant event, read the parent's `grant:` line in
   `show <parent>`; when it does not read `in force` by the parent grant event
   of step 4, create or post nothing more and stop as the contract's Ended
   grant says. Otherwise post the child's grant event once, with the parent's
   quote and a second line `Parent event: <comment id>` that names that parent
   event, as the contract's Authority events says. Give the parent one Steps
   row per child, as the contract's Record and mode says. Run Research
   and Plan review on the parent. After that pass, start the child that the
   contract's Yolo runs table names: set up its linked branch, and run
   Research to Land on it.
6. Otherwise set up the linked branch now, as the contract's Yolo runs section
   says.

## Research

Follow the practices Research order, Decisions and corrections, and
Engineering standards. Settle each question from the codebase, the web, or an
experiment; do not ask. This run holds the grant of the contract's Delegated
decisions through its grant event: decide each question that the practices
send to the user as that section says, with a deliberation record. Open
questions holds only a `Blocked:` line, as the contract's Delegation line says.
Run the Grant check before each delegated decision, as Run order says.

## Implement

Follow the practices Engineering standards, Red baseline, Commits, Checks that
fail outside the goal, and Delegated work.

A wrong spec test follows the grant, as the practices Red baseline item 4 and
the contract's Delegated decisions say.

A repository hook failure that blocks the plan stops the run, as the hook row
of the contract's Yolo runs table says.

## Review loops

Use the contract's review loop with its Yolo runs ceiling. Dispatch the
`plan-reviewer` and `code-reviewer` wrappers with fresh input in each round. If
a wrapper is missing, dispatch a fresh read-only agent with the matching
instructions. Post one comment per round: the blocks of the round, then the
manager response to the previous round, as the contract's review loop says.
That comment counts as one round of the ceiling.

Dispatch code review round 1 first, and run the practices Self-review in code
review while it runs. Its `Self-review` comment does not count as a round of
the ceiling. While any round runs, do the practices Work during a round. Follow
the practices Delegated work for each dispatch of a round and of its repairs.

Review plan edits after `plan=pass` as the contract's Phases and review
comments says. The helper advises when an edit needs that round.

| Verdict | Yolo action |
|---|---|
| Plan `repair` | Reproduce each finding, repair a fresh export, and review again |
| Plan `blocked` | Decide it as the contract's Delegated decisions says, and review again |
| Code `fixes-required` | Fix each reproduced finding, rerun its proof, and review again |
| Code `blocked` for unread hunks | Dispatch that reviewer again with the unread paths before you post the round, as the contract's Code-review rounds says |
| Code `blocked` for another input | Resolve that input, as plan-manager phase 6 says, and review again |
| Code `pass` from round 3 whose open findings are all `Unreached:` LOW findings | Land with the follow-up issue, as the contract's Round ceiling says |
| Code `pass` with other MEDIUM or LOW findings | Fix each reproduced finding and review again, as a `delta` round when the contract's Code-review rounds allows it |
| Code `pass` with no open finding | Go to Landing |

Make and record each repair as the contract's Repairs says, in both phases. A
code repair also gets the tests that plan-manager phase 6 asks for. Reject a
finding only with evidence, in the `Rejected` list of the manager response.
When a finding returns after a repair, redesign the fix and record it under
`Redesigned`, as item 5 of the contract's review loop says. A tradeoff follows
the contract's Delegated decisions and the effect table of Yolo runs.

When a review phase stalls, as the contract's Round ceiling says, apply the
Stall rule of the contract's Delegated decisions first. When that rule asks,
post the pending manager response first. When the answer is `Leave plan
blocked`, or no answer is possible, run the contract's Teardown for an exit
without a merge. The contract's Round ceiling also says this.

## Landing

1. Confirm that `git status --porcelain` prints nothing. The reviewed head is
   `HEAD`.
2. Fetch the default branch. If it is not an ancestor of `HEAD`, merge
   `origin/<default>` into the linked branch. Do not rebase. Rerun acceptance,
   and run a code-review round on the result. Commit each repair.
3. Push the linked branch with a normal push. When a repository hook fails,
   follow the contract's Repository hooks. Never skip the hook.
4. Write the run summary from `../plan-manager/references/run-summary.md`, as
   the practices Run summary says.
5. When `gh pr list --repo <owner/repo> --head <branch> --state open` shows a
   pull request, update its body with `gh pr edit <pr> --repo <owner/repo>
   --body-file <file>`. Otherwise open the pull request with `gh pr create
   --repo <owner/repo> --base <default> --head <branch> --title <title>
   --body-file <file>`.
6. Wait for checks as the contract says. If a check fails, fix it, rerun
   acceptance, review again, and push. Right after the push, build the
   Checklist again from the evidence for the new head, and update the body
   with `gh pr edit <pr> --repo <owner/repo> --body-file <file>`. Then wait
   again. When the same check still fails after the third fix attempt, stop
   fixing it. That is a stall: apply the Stall rule of the contract's Delegated
   decisions, then the contract's Round ceiling, as its Checks and merge says.
7. Confirm that `gh pr view <pr> --repo <owner/repo> --json headRefOid` shows
   the reviewed head. Write the pull request URL and the check result into the
   summary file, as the practices Run summary says. Run the landing self-check
   in the contract's Checks and merge: untick each item without evidence, add
   its reason, and update the body again.
8. Print the run summary. In the same response, state
   `<k> of <n> checklist items ticked` and `<d> delegated decisions`, point to
   Delegated decisions in the run summary, list each unticked item with its
   reason, and ask one question:
   `Merge pull request #<pr> into <default>?`, with the options `Merge now` and
   `Leave pull request open`. An unticked item does not block the question.
   The `Merge now` option states the teardown, as the
   contract's Checks and merge says, including `git branch -d <branch>`.
9. On `Merge now`, merge as the contract says. Ask separately before each plan
   step that runs after the merge, and run it. Then archive with
   `archive <n> --pr <pr>`. For a child, set its parent row done; when
   `show <parent>` lists no open child, run `archive <parent>`. Run the
   contract's Teardown, and report Kept resources. Ask separately before each
   production cleanup.
10. On any other answer, or when no answer is possible, leave the pull request
    and the issue open. Run Teardown's exit without a merge. Report both links
    and Kept resources.
11. When the message that answers the merge question also starts a new yolo
    run, finish this run first. On `Merge now`, follow step 9. On any other
    answer, follow step 10. Then start the new run.

## Recover after compaction

Follow the practices Recover after compaction.

## BAD / GOOD

```text
BAD: Ask the user which library to use during research.
GOOD: Read the official docs, test both in scratch, and record the decision with its URL.

BAD: Write the requested test that checks source text.
GOOD: Record a correction and test the behavior that a consumer sees.

BAD: Ask the user how to fix a finding that returned after a repair.
GOOD: Research the class again, pick a different approach, and record it under `Redesigned`.

BAD: Paste an error log that contains a token into the issue.
GOOD: Remove the token and name its variable.

BAD: Run the push with `--no-verify` when the pre-push hook fails.
GOOD: Fix the cause, or record the baseline failure and block, as the contract's Repository hooks says.
```

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks-kit repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
