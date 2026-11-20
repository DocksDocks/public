---
name: plan-manager
description: "Use when a goal may need the six-phase plan flow: decide, draft, research, plan review, implement, code review; an issue-backed canonical plan; or lifecycle handling. Not for workspace setup (use plan-workspace), plan criticism (use plan-reviewer), or code-review agent work."
user-invocable: true
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "d9b120999666b33ea8678e983b352a67507174f41dc1547508429d984773f76b"
---

# Plan Manager

Own the user goal through six phases. Read
[`references/plan-contract.md`](references/plan-contract.md) before phase 1.
The contract owns the path criteria, record shapes, commands, normalization,
ownership, the review loop, review trust, and landing safeguards. This skill
owns the phase order and what each phase must finish. Do not copy contract rules here.

<constraint>
Before phase 1, read the Safety rules of
[`references/practices.md`](references/practices.md), which owns the named
practices. Apply them to every issue, comment, commit, and pull request write.
</constraint>

<constraint>
Main context owns mode selection, questions, edits, implementation, review
publication, and lifecycle changes. Reviewers stay read-only. Use
`plan-workspace` for repository setup and `plan-reviewer` for plan review.
Deliver the durable solution that the contract defines.
</constraint>

<constraint>
Ask in-session immediately before running a non-local Effect step. Persisted
intent is not permission. If confirmation is unavailable, block the step and
plan with a reason. The settled mode covers routine issue publication and
linked-branch landing work. Every merge needs a fresh `Merge now` answer. A
production cleanup in the contract's Teardown needs its own in-session question.
A grant in the contract's Delegated decisions answers none of these questions.
In a yolo run, the contract's Yolo runs section replaces every question in this
skill except the merge and production cleanup questions.
</constraint>

## Resolve the helper

`plan.mjs` ships in the installed plugin at
`skill://plan-manager/scripts/plan.mjs`. Run it as
`node skill://plan-manager/scripts/plan.mjs <command>` from the target
repository root. Never copy it into the project or recreate it when the plugin
is unavailable.
Use the contract's command and refusal lists for arguments and recovery.

## Six phases

### 1. Decide

Apply the path criteria in the contract (Record and mode). If the request does
not settle the path and the Mode, ask with these options: `Plan and implement now`,
`Plan only, stop at planned`, `Implement directly`. Do not ask only for
permission to begin.

If `ask` is unavailable, implement directly only when the request meets the
direct-implementation criteria, and report that assumption. Otherwise create no
plan issue and report the missing decision.

Done when: the path is direct implementation, or a plan with a settled Mode.

### 2. Draft

Complete the preflight in
[`references/github-issue-publication.md`](references/github-issue-publication.md).
Create the issue with `new` and the settled mode. Report its number. Draft the
outcome, research hypothesis, provisional steps, scope, and acceptance proof. Keep
the plan drafting while those claims remain provisional. When the work needs more
than one landing pull request, draft a parent plan with no linked branch, and
create one child per pull request with `new --parent <n>`, as the contract's
Record and mode says. The parent runs phases 3 and 4 only. Each child runs these
six phases as its own plan, and starts only after the parent passes plan review.

Done when: `show <n>` prints the header strip with status `drafting`, and for a
parent, one `child #<c>` line per child.

### 3. Research

Export the issue and edit the exported file. Follow the practices Research order,
Decisions and corrections, and Engineering standards. Bind research findings to
repository paths and symbols or official URLs. Name the durable fix and the
temporary approach it replaces. Make the Files cells cover the intended scope.

Fill acceptance with runnable proof, then use `edit` to publish the export.
Read all advice and resolve any decision it exposes. A defaulted plan-only
mode never authorizes implementation. Use a fresh export for each later body
edit, and keep its provenance sidecar intact.

Done when: `status <n> planned` succeeds and no advice needs a decision.

### 4. Plan review

Run the contract's review loop with `plan-reviewer`. For each round, export fresh
input and dispatch `plan-reviewer` with the issue number, export path, and round
number. A re-review round after a repair may use the plan `delta` mode, as the
contract's review loop allows. If no wrapper exists, dispatch a fresh read-only
reviewer with the `plan-reviewer` skill. Each reviewer dispatch of a round or a
re-review round follows the practices Delegated work; item 1 uses the session
checkout until the plan worktree exists. Route a user-only decision through Open
questions and `ask`, unless a grant answers it (the contract's Delegated
decisions; its Grant check reads the `grant:` line of `show <n>`).
Never implement a repaired plan that has not passed review.

A plan-only run stops after the pass, at planned. Report the issue and verdict.
Do not create a branch or implement without a new instruction.

Done when: `show <n>` reports `plan=pass`.

### 5. Implement

Move the plan to ongoing. Set up the linked branch with the contract's Linked
branch steps before you change code. Set each step in-flight, implement or
delegate it, run its proof, then mark it done. Honor the Effect confirmation
gate. Follow the practices Engineering standards, Red baseline, Commits,
Checks that fail outside the goal, and Delegated work. Before you mark
acceptance, run each Acceptance row that runs a driven surface end to end.
Run it through a flow of the project `verify` skill
(`.agents/skills/verify/SKILL.md`) when a flow covers that row, and directly
otherwise, as the practices Research order says. Run all acceptance commands and
record real results in Verification Results through the export/edit flow.
Review plan edits after the pass as the contract's Phases and review comments
says. Once work starts, put new work into a child plan, and act on split
advice, as the contract's Status, ownership, and frozen state says.

Every commit that you make, also each candidate and repair commit, carries a
`Verified:` trailer. The `commit-discipline` skill owns the trailer format. List
the commands that ran on the committed bytes, as `Verified: <command>[; <command>]`.
When no command ran on them, write `Verified: none - <reason>`.

Done when: every step that can run before the merge is done or skipped, and
Verification Results hold real acceptance results.

### 6. Code review

Run the contract's review loop with `code-reviewer`. The contract's Code-review
rounds section picks the mode of each round and names its inputs. Before each
round, commit the candidate on the linked branch, as that section says. Then
build the full diff in the review scratch directory. It holds every change
since the merge base with the default branch. Build it for every round, because
the delta rule compares the delta diff with it:

```bash
scratch=$(git rev-parse --git-path docks-review)
mkdir -p "$scratch" && chmod 700 "$scratch"
git fetch origin <default>
base=$(git merge-base "origin/<default>" HEAD)
review_diff="$scratch/code-review-<n>-round-<k>.diff"
git diff --binary "$base" > "$review_diff"
git ls-files --others --exclude-standard -z |
  while IFS= read -r -d '' file; do git diff --no-index --binary -- /dev/null "$file"; done >> "$review_diff"
```

`git diff --no-index` exits 1 when the files differ, so that exit status is
expected here. Build the base-instructions folder for every round too. It holds
the merge-base copy of each `AGENTS.md`, `CLAUDE.md`, and `REVIEW.md` at the
root and in each parent folder of a changed path. The changed paths are the
paths of the full diff and, in a later round, also the paths of the delta diff.
A file that the branch added and a repair then deleted is in the delta diff
only. Set `prev` to the previous round's reviewed head, or leave it empty in
round 1. Put the folder of this skill, which holds `scripts/plan.mjs`, in place
of `<skill-dir>`. Its `scripts/base-blob.sh` reads each file. A symlink, also a
folder link on the path, gives the text of its target in the merge-base tree,
under the path of the link. A path is absent when it is missing or names a
folder, or when a link on it has a target outside the tree or more than 40
links away. The folder's `MANIFEST` lists each checked path as `copied <path>`
or `absent <path>`. When git or the script fails, the block writes no
`MANIFEST`, prints an error, and exits with a non-zero status. Then do not
dispatch the round; a failed read is not an absent file:

```bash
inst="$scratch/code-review-<n>-round-<k>-base-instructions"
prev="<previous-reviewed-head or empty>"
rm -rf "$inst" && mkdir -p "$inst" && (
  set -o pipefail
  { git diff --name-only --no-renames -z "$base" &&
      { [ -z "$prev" ] || git diff --name-only --no-renames -z "$prev"; } &&
      git ls-files --others --exclude-standard -z; } |
  while IFS= read -r -d '' path; do
    dir=$path
    while [ "$dir" != . ]; do
      case $dir in */*) dir=${dir%/*} ;; *) dir=. ;; esac
      for name in AGENTS.md CLAUDE.md REVIEW.md; do
        if [ "$dir" = . ]; then printf '%s\0' "$name"; else printf '%s\0' "$dir/$name"; fi
      done
    done
  done | sort -zu |
  while IFS= read -r -d '' file; do
    oid=$(sh "<skill-dir>/scripts/base-blob.sh" "$base" "$file")
    case $? in
      0) copy="$inst/$file"
        mkdir -p "${copy%/*}" && git cat-file blob "$oid" > "$copy" || exit 1
        printf 'copied %s\n' "$file" ;;
      1) printf 'absent %s\n' "$file" ;;
      *) exit 1 ;;
    esac
  done > "$inst/MANIFEST.part"
) && mv "$inst/MANIFEST.part" "$inst/MANIFEST" ||
  { echo "base instructions: a read failed; $inst has no MANIFEST" >&2; false; }
```

Name the folder in every dispatch, because the reviewer reads instruction files
only from it. A `panel` round also needs one focus diff per lens. A `delta`
round gives its reviewer the delta diff instead of the full diff:

```bash
git diff --binary "$base" -- <paths> > "$scratch/code-review-<n>-round-<k>-<lens>.diff"
git diff --binary <previous-reviewed-head> HEAD > "$scratch/code-review-<n>-round-<k>-delta.diff"
```

Dispatch the three lens reviewers of a `panel` round in one message, so they
run at the same time. In each dispatch message, name each changed path that is
outside the Steps Files cells. Post one comment per round: the blocks of the
round, then the manager response to the previous round, as the contract's
review loop says. Write the reviewer's repair record and rejection files from
that response. While round 1 runs, run the practices Self-review in code
review. While any round runs, do the practices Work during a round. Follow the
practices Delegated work for each dispatch of a round and of its repairs.

Before the next round, fix or reject every finding of the round, as the
contract's Repairs says. A pass can carry MEDIUM and LOW findings. The posted
comment is their record; do not change reviewed bytes for them. When a finding
returns after a repair, redesign the fix yourself and ask the user only in the
cases that item 5 of the contract's review loop names.

Make each repair complete, as the contract's Repairs says, before you commit
it. When a repair adds a branch, a list split, a parser rule, or a refusal, add
a test that fails when that branch is removed. When a repair changes a parser
or a matcher, list its input forms, such as delimiters, white space, quotes,
`--`, aliases, and nested fields, and test each form before the commit. Prefer
a property test with generated inputs for those forms, for example with
fast-check, Hypothesis, or proptest. Test round-trip and idempotency first. In
recorded plans, more than half of the later code findings were faults in the
repair of an earlier finding.

When a code reviewer returns `blocked` because it left hunks unread, dispatch it
again as the contract's Code-review rounds says. Resolve unreadable input before
you request a verdict. If you block after implementation, commit and push
current work to the linked branch before you record the blocker, so repairs are
not stranded. When a pull request is open, update its body right after the push,
as the contract's Checklist says. Post the pending manager response first, as
the contract's review loop says. A hook that refuses that commit or push follows
the contract's Repository hooks. Then run the contract's Teardown for an exit
without a merge.

Done when: `show <n>` reports `code=pass`.

## Landing and reporting

After code review passes, follow the contract's Landing and archive proof:
commit and push the reviewed bytes, open or update the pull request, wait for
checks, ask afresh for `Merge now` or `Leave pull request open`, and merge only
on `Merge now`. Write the description from `references/run-summary.md`, as the
practices Run summary says. Build the `## Checklist` section and run the landing
self-check as the contract's Checklist and Checks and merge say. After each push,
rebuild the ticks and update the body before any wait for checks. The merge
question and its `Merge now` option state what the contract's Checks and merge
lists. A v5 plan has no partial merge; each part lands as a child
plan. Only a v4 plan whose work started runs `reopen <n> --pr <pr>` after a
partial merge, as the contract states. After the landing merge, run each step that
runs after the merge. Once every step is terminal, run `archive <n> --pr <pr>`
with the landing pull request. For a child, then set its parent row done; when
`show <parent>` lists no open child, run `archive <parent>`, as the contract's
Archive says. After archive, run the contract's Teardown. Without `Merge now`, run
Teardown's exit without a merge. Report Kept resources in both cases.

Render the body only when the user names the plan and asks to see it. After a
write, report the header strip and changed lines.

Done when: `archive <n> --pr <pr>` prints `plan #<n> finished (closed by <pr-url>)`
(and for the last child, `archive <parent>` prints
`plan #<parent> finished (all <k> children finished)`) and you reported Kept
resources, or the user chose `Leave pull request open` and you reported the
open pull request and Kept resources.

## Recover after compaction

Rebuild the run state as the practices Recover after compaction says.

## BAD / GOOD

```text
BAD: Repair the plan and implement without another review.
GOOD: Export the changed plan and get a fresh pass.

BAD: Merge because checks passed earlier.
GOOD: Verify the reviewed head and obtain a fresh Merge now answer.

BAD: Merge a partial pull request on a v5 plan.
GOOD: Open a child plan with `new --parent <n>`; each child lands with `Closes #<c>`.

BAD: Post the repairs of a round as a separate issue comment.
GOOD: Put them in the manager response after the blocks of the next round comment.

BAD: Run `git branch -D` after `git branch -d` refuses.
GOOD: Keep the branch and list it under Kept resources.
```

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
