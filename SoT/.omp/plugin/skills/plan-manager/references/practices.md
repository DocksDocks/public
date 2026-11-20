# Practices for every plan run

These practices apply to every plan run: a `plan-manager` run and a `yolo` run.
The contract (`plan-contract.md`) states what a record holds and what must
happen. This reference states how to do the work. A grant in the contract's
Delegated decisions answers some questions in these practices. A `yolo` run
holds that grant. Each practice names the question that the grant answers.

## Contents

- [Safety rules](#safety-rules)
- [Research order](#research-order)
- [Decisions and corrections](#decisions-and-corrections)
- [Engineering standards](#engineering-standards)
- [Red baseline](#red-baseline)
- [Commits](#commits)
- [Checks that fail outside the goal](#checks-that-fail-outside-the-goal)
- [Delegated work](#delegated-work)
- [Self-review in code review](#self-review-in-code-review)
- [Work during a round](#work-during-a-round)
- [Run summary](#run-summary)
- [Recover after compaction](#recover-after-compaction)

## Safety rules

- Do not force-push or rewrite history.
- Do not skip or turn off a repository hook.
- Do not stash, move, commit, or delete work that the user made.
- Do not merge without a fresh `Merge now` answer.
- Before each issue, comment, commit, or pull request write, remove secrets,
  tokens, credentials, private hostnames, environment values, and absolute
  machine paths. Name a secret by its variable name, not its value. The
  repository can be public, so treat every published word as public.

## Research order

Answer each open question in this order. Stop at the first step that settles it.

1. Codebase: read callers, tests, configuration, and local instructions. Use
   language server references before you change an exported symbol.
2. Web: read current official documentation, release notes, specifications, or
   upstream issues. Do this for every claim about a library, framework, API,
   tool, standard, or version. Record each URL.
3. Experiment: when sources disagree or say nothing, test the behavior in the
   scratch directory `$(git rev-parse --git-path docks-review)/plan-<n>/`.
   Record the command and its output. Write the scratch expression, not its
   absolute path.

Read the instruction files that apply to each path in the Files cells:
`AGENTS.md`, `CLAUDE.md`, and `CONTRIBUTING.md` in that folder and its parent
folders. Add one Acceptance row for each check that they require for the change.
When a step's Files change the code or configuration of a surface that a user
or another program drives, such as a CLI command, a hook, a service, or a UI,
add at least one Acceptance row that runs that surface end to end and names
the observable result. A test file that starts the real surface counts; a
unit-test command that only calls internal functions does not. A change to
prose or skill text alone needs no such row. The contract's Steps, acceptance,
and effects states the rule.

When the plan has such a row, run
`node skill://plan-workspace/scripts/verify-skill.mjs detect` from the
repository root. The `references/verify-skill-template.md` of the installed
`plan-workspace` skill describes
the lines. Record the output in Research.
A flow of the project `verify` skill is the preferred way to run such a row,
because the next plan can reuse it. A plan step can run the Create or
re-verify section of that reference. Such a step creates the skill, verifies
it again, or adds a flow. Ask whether the plan adds such a step when the skill
is missing, is not verified, or has no flow for a row. A grant answers this
question (the contract's Delegated decisions). Some facts only the user holds,
such as a start command or a test account. When the run cannot ask for such a
fact, add no such step, and record why. A row that runs the surface directly
is still proof. Do not keep an end-to-end check only in the review scratch
directory. Put its command in the Acceptance row. Keep each script that the
command runs in the repository: in a flow of the skill, or in a file that a
step of the plan adds.

## Decisions and corrections

Record each decision in Research: the decision, its evidence, and the rejected
options. A repository fact needs no web source. Every other claim needs one.
Record the tool facts that the contract's Record and mode asks for.

When the request has a flaw, record a request correction under
`### Request corrections` in Research. A flaw is a wrong premise, a conflict
with the repository, a security risk, or a weak practice. Use this line:

```text
Asked: <what the request said>. Did: <what the run does>. Reason: <evidence>.
```

A decision that only the user can make goes through Open questions and `ask`,
as plan-manager phase 4 says. When a grant is in force (the contract's
Delegated decisions), decide each question that the grant answers, and record
it with a full deliberation record. Ask only the questions that the grant does
not answer.

### Deliberation record

Think each decision through before you act on it, and write the result down.
Write the record before you act on the choice. A full record has these parts:

1. Question: the decision to make.
2. Options: at least two real options. Include "keep the current state" when
   it applies.
3. Evidence for each option: code, official documentation with its URL, or an
   experiment with its command and output.
4. Failure modes and second-order effects of each option.
5. Reversibility and cost.
6. Durability test: the option fixes the root cause, moves every caller, and
   leaves no shim, alias, or temporary workaround.
7. Pre-mortem: assume that the choice failed after six months. Name the most
   likely cause and the guard against it.
8. Choice: the chosen option, and each rejected option with its reason.

Choose the depth of the record:

- One line, with the choice, the reason, and the rejected option: a cheap,
  reversible, local choice.
- The full record: a choice that is hard to reverse, such as a public contract,
  published text, data, a dependency, a new convention, or a non-local effect;
  a choice that the user would otherwise own; each delegated decision; and each
  `Redesigned` entry.

Put the record in Research decisions, in the `Redesigned` entry of a manager
response, or, for a wrong spec test (Red baseline item 4), in a Verification
Results entry. The run summary lists each delegated decision with the locator
of its record. Write each part as short bullets. A long record pushes the body
toward the split advice of the contract's Normalization, advice, and refusals.

A full record:

```text
- Question: how the `--since` option parses a date.
  - Options: (a) keep `Date.parse`; (b) the strict ISO 8601 parser that three
    other commands use; (c) a new date library.
  - Evidence: (a) accepts formats that each engine defines
    (<https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/parse>);
    the scratch run `node -e "console.log(Date.parse('2026-1-2'))"` printed a
    local-time value. (b) the parser and its tests exist. (c) adds a dependency.
  - Failure modes: (a) a date shifts by the time zone of the machine. (b) a
    user who typed `2026-1-2` gets an error. (c) a supply-chain risk and an
    upgrade cost.
  - Reversibility: (b) and (c) change the accepted input, a public contract.
  - Durability: (b) moves the last caller to the shared parser and removes the
    second path.
  - Pre-mortem: (b) failed because users pass dates without zero padding.
    Guard: the error names the expected form `YYYY-MM-DD`.
  - Choice: (b). Rejected: (a), because of the time-zone shift; (c), because
    (b) covers every form that the commands accept.
```

A one-line record:

```text
Choice: name the flag `--since`, as the other commands do. Rejected: `--from`, because no command uses it.
```

## Engineering standards

Load each matching docks skill when the runtime has it. A runtime can show it as
`docks-kit-omp:<name>` or as `<name>`. Read each matching skill during Research, before
you write Steps. Under `### Engineering standards` in Research, record which
skill each step applies. When a standard defines completion, put it in that
step's `Done when`. Apply each step's skills again while you implement that
step. Run the self-review during code review round 1, as Self-review in code
review says.

Apply `code-clarity` to every step that changes code, tests, comments, or error
messages, together with the other matching skills. Record it for each such
step, and check its rules again in the self-review. When the docks skills are not
installed, the rules at the end of this section replace the docks skills,
`code-clarity` included.

| Work in a step | docks skill |
|---|---|
| New behavior specified by inputs and outputs | `tdd-workflow` |
| Tests for code that already exists | `test-coverage` |
| A bug, regression, or review finding | `fix-workflow` |
| Module, class, or service boundaries | `solid` |
| Every change to code, tests, comments, or error messages | `code-clarity` |
| Identifier types, input parsing, tagged unions | `type-safety-discipline` |
| A linter or type-checker error | `lint-no-suppressions` |
| Lint rules or repeated literal values | `code-guardrails` |
| Dependency upgrades or advisories | `dep-vuln-workflow` |
| Commits | `commit-discipline` |
| React components | `react-component-patterns` |
| Colors, tokens, and themes | `design-tokenization` |
| Keyboard, focus, and ARIA | `accessibility` |
| Visual polish and motion | `make-interfaces-feel-better` |
| Self-review during code review round 1 | `code-review` |

Do not start `security`, `refactor`, or `skill-agent-pipeline`. Each one opens
its own plan. Put that work into the Steps of this plan.

When the docks skills are not installed, apply these rules:

- Write a test only for behavior that a consumer sees: results, boundaries,
  errors, and transitions.
- Do not test wiring, copies, forwarding, mock echoes, or source text. Do not
  add a second test for the same path.
- Fix each lint or type error. Do not add a suppression comment.
- Reuse the pattern that the repository has. Do not add a second convention.
- Leave no dead code, compatibility alias, or shim.
- Name things with domain words. Write comments that give the reason, not the
  mechanics. Make each error name the failed operation, its subject, and the
  recovery.

## Red baseline

The main context owns the red baseline of each step that adds new behavior
specified by inputs and outputs (the `tdd-workflow` row above), also when the docks skills
are not installed. A subagent can write the spec tests.

1. Write the spec tests before the production code of the step.
2. Run them. Each new test must fail because the behavior is missing: on an
   assertion, or on an export or symbol that this step adds. A failure from any
   other import, setup, or syntax error is not a red baseline. Do not add an
   empty stub to change a missing export into an assertion failure.
3. Stage the spec tests with `git add`. Add this line to Verification Results:
   `Red baseline, step <id>: <command>: <k> failed, <m> passed`. When a missing
   export stops a test file, write `<file> failed: missing <symbol>` instead of
   the counts for that file.
4. Keep the staged spec tests unchanged while you write production code:
   `git diff -- <spec files>` prints nothing. When a spec test is wrong, stop
   and ask the user, as `tdd-workflow` also says. Record the answer and the
   reason in Verification Results, fix the test, and run the baseline again.
   When a grant is in force (the contract's Delegated decisions), do not
   ask: write the full deliberation record in a Verification Results entry,
   fix the test, run the baseline again, and list the decision under
   Delegated decisions in the run summary. That record replaces the user
   escalation that `tdd-workflow` asks for.
5. A review fix that changes a spec assertion follows item 4. Run the changed
   test against the code before the fix. It must fail on the changed assertion.
   Add this line to Verification Results:
   `Red baseline, step <id>, review round <r>: <command>: <k> failed, <m> passed`.

## Commits

1. Commit each step on the linked branch when its proof passes, as
   `commit-discipline` says when the runtime has it. Each commit must pass the
   focused tests, the type check, and the lint for its files. When a commit
   hook fails, follow the contract's Repository hooks.
2. When you split finished work into commits, check each commit in a temporary
   worktree: `git worktree add --detach <path> <sha>`, run the checks, then
   `git worktree remove -- <path>` and `git worktree prune`. `<path>` is
   `${XDG_DATA_HOME:-$HOME/.local/share}/agent-worktrees/<repository-name>/check-<short-sha>`.
   Do not put it under `/tmp` or inside `.git`.
3. Commit the candidate before each code-review round, as the contract's
   Code-review rounds says. Leave no staged, unstaged, or untracked change of
   the candidate.
4. Add each review fix as a new commit. Do not amend, squash, or rebase.
5. The reviewed head is `HEAD` after the last passing code-review round.

## Checks that fail outside the goal

When a required check fails on files that the plan does not change:

1. Run `git fetch origin <default>`. Then run the same check on
   `origin/<default>` in a temporary worktree, as Commits item 2 says.
2. When it fails the same way there, it is a baseline failure. Record the
   command, the failing files, and the default-branch result in Verification
   Results. Do not fix it unless the Goal covers it.
3. When it passes there, this change causes the failure. Fix it in this plan.

A repository hook that fails, such as a pre-push hook, is a required check too.
Follow the contract's Repository hooks for it.

## Delegated work

Follow this practice for each subagent that the run dispatches, in every phase.

1. Give each subagent the absolute path of the plan worktree. Require an
   absolute path in each read and edit, and `cd <worktree> &&` at the start of
   each shell command, so that redirects and later commands also run there.
   `git -C <worktree>` moves git only, not a redirect. Require a report of the
   absolute path of each file that the subagent changed. Before the plan
   worktree exists, as in plan review or in a plan-only run, the session
   checkout is the working folder: use the absolute path of the session
   checkout in this item. From the creation of the plan worktree on, use the
   worktree.
2. Items 3 to 8 apply only when the plan worktree exists and the session
   checkout and the plan worktree are different folders, as the contract's
   Linked branch says. When the session checkout holds the plan branch, plan
   work changes it by design.
3. Before a dispatch, or before a group of dispatches that run at the same
   time, write the listing of the session checkout. Use one `<label>` per
   group. `<checkout>` is the absolute path of the session checkout. The
   command `docks-kit plan checkout-state <checkout>` prints one
   line per tracked or untracked path with the raw state on disk, so a dirty
   checkout or a filter does not hide a change. It does not list ignored files.

   ```sh
   checkout='<checkout>'
   dir=$(git -C "$checkout" rev-parse --path-format=absolute --git-path docks-review) &&
     mkdir -p -m 0700 "$dir" &&
     state="$dir/checkout-state-<n>-<label>" &&
     { docks-kit plan checkout-state "$checkout" > "$state.txt.part" &&
       mv "$state.txt.part" "$state.txt" ||
       { rm -f "$state.txt.part"; false; }; }
   ```

   The listing gets its name only when the command exits with status 0. When a
   setup command or `docks-kit plan checkout-state` fails, the block removes the
   `.part` file, writes no listing, and exits with a status other than 0; follow
   item 8. A shell that does not keep variables between commands needs
   `checkout`, `dir`, and `state` again, with the same values, before each
   later block.
4. After each agent of the group returns, write the listing again and compare
   it with the first listing of the group. Each changed line names a path that
   changed during the group. The user can edit the checkout at the same time,
   so a change is a signal to inspect, not proof. Also check each path that the
   subagent reported: a path outside the worktree is a stray edit, also when
   the listing did not change. The block writes the new listing to its own
   `.part` file, gives it the name `checkout-state-<n>-<label>.now` only when
   the command exits with status 0, and compares the two files byte for byte.
   An empty listing stays empty, so two equal listings give no diff.

   ```sh
   if docks-kit plan checkout-state "$checkout" > "$state.now.part" &&
     mv "$state.now.part" "$state.now"; then
     diff "$state.txt" "$state.now"
   else
     rm -f "$state.now.part"
     false
   fi
   ```

   Status 0 means no change, and status 1 with diff lines means a change. When
   the command or `mv` fails, the block removes the `.part` file, runs no
   `diff`, and exits with status 1; follow item 8. Status 2 means that `diff`
   could not read a file; also follow item 8. After you report the changes as
   item 6 says, remove the `.now` file with `rm -f "$state.now"`.

5. Undo nothing in the session checkout: no edit tool, no `git restore`, no
   shell redirect from `HEAD`, and no trash. Redo in the worktree, with
   absolute paths, each reported change that the subagent made outside the
   worktree and that the worktree still lacks.
6. Report each changed path to the user in the first report after the group,
   and in the run summary under Kept resources, with the subagent that reported
   it, if any. The user decides what to do with it.
7. Keep each listing until Teardown. In Teardown, for each complete listing,
   `checkout-state-<n>-*.txt`, set `state` to its path without `.txt`, compare
   it again as item 4 says, and report each new path as item 6 says. Ignore
   each `.part` file and each `.now` file: they are not baselines. Then remove
   this plan's listing, `.part`, and `.now` files, `checkout-state-<n>-*`, and
   no other file.
8. When a block of item 3 or 4 fails before `diff` runs, or `diff` exits with
   status 2, the check has no result. Undo nothing, check each reported path as
   item 4 says, and report the failure and each change that this leaves under
   Kept resources.

## Self-review in code review

Dispatch code review round 1 first. While it runs, review your own candidate
diff as one self-review per lens of the code-review panel: `correctness`,
`spec-and-tests`, and `text-and-safety`. Run the three at the same time, or
one after another when the runtime cannot. Give each one the full candidate
diff and its lens scope from the `code-reviewer` skill of this plugin.

- With the docks skills installed, run each self-review with the docks `code-review`
  skill, and apply `code-clarity` in each.
- Without the docks skills, apply the lens reference of this plugin's `code-reviewer`
  skill in each self-review: `correctness.md`, `spec-and-tests.md`, and
  `text-and-safety.md` in `../../code-reviewer/references/`. Apply the rules at
  the end of Engineering standards in each.

Post the findings as one issue comment whose first line is `Self-review`, with
one section per lens; write `No findings.` for a lens that finds nothing. The
helper does not read that comment as a review, so it is not a round. In the
plugin's benchmark, one self-review per lens found more known defects than one
self-review (0.67 against 0.50 per run) in about the same time, but also more
wrong findings. Reproduce each one before you fix it, and reject a wrong one
with evidence. The self-review does not replace round 1.

After round 1 returns, fix the self-review findings together with the findings
of round 1. Use `fix-workflow` when the runtime has it, and commit the fixes.
List the self-review findings, named by lens, in the manager response to
round 1 with the findings of round 1. When the self-review found anything,
review again, also when round 1 passed. That round is a `delta` round when the
contract's Code-review rounds allows it.

## Work during a round

While any review round runs, do the work that does not depend on its verdict,
such as the acceptance records and the run summary draft.

## Run summary

The run summary is the whole pull request description. Do not add the
`commit-discipline` description sections. Write it from
[`run-summary.md`](run-summary.md) to a file in the review scratch directory.
Write `pending` for the pull request URL and the checks. Include Kept
resources, as the template says. Under Delegated decisions, list each decision
that a grant answered, as the template says, or write `none`. Fill its
`## Checklist` section as the contract's Pull requests says: tick an item only
with its evidence on the reviewed head, and end each unticked item with its
reason. End the file with
`Closes #<n>` on its own line. After the checks finish, write the pull request
URL and the check result into the file, and update the body with
`gh pr edit <pr> --repo <owner/repo> --body-file <file>`.

## Recover after compaction

The issue is the run record. Run `show <n>` for the status and verdicts. Run
`gh issue develop <n> --list --repo <owner/repo>` for the branch. After the pull
request exists, GitHub lists no branch there. Then read the pull request number
from `gh issue view <n> --repo <owner/repo> --json closedByPullRequestsReferences`,
and read the branch from `gh pr view <pr> --repo <owner/repo> --json headRefName`.
Run `git worktree list` for a worktree. Count review rounds from round
comments: a comment whose first line names the review kind. One round comment
can hold several lens blocks and the manager response to the previous round.
A `Self-review` comment, an authority event (`Delegation grant:` or
`Delegation revoked`), or a comment that holds only a pending manager response,
is not a round. Check the latest trusted authority event, as the contract's
Delegated decisions says, before you act on a grant. For a parent, `show <n>`
lists each child; run `show <c>` for each child to find the one that this run
works on.

When the review scratch folder of the session checkout holds complete listing
files of this plan, `checkout-state-<n>-*.txt`, set `checkout` and `dir` as
Delegated work item 3 says. For each file, set `state` to its path
without `.txt`, and run the block of Delegated work item 4. Ignore each `.part`
file and each `.now` file: they are not baselines. Report each changed path
and leave it, as Delegated work says. Keep each listing, and compare it again
in Teardown, because an agent that still runs can change the checkout later.
