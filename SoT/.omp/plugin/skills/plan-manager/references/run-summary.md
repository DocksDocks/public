# Run summary

Keep the summary short. Use this shape:

```markdown
## Plan run: #<n> <title>

Pull request: <url>. Checks: <state>. Reviewed head: `<sha>`.

### What changed
- <behavior change> (`<path>`)

### Decisions and corrections
- <decision or request correction, with its evidence>

### Delegated decisions
- <question>: <choice>. Rejected: <option, with its reason>. Reversibility: <how to undo it>. Record: <Research decision, `Redesigned` entry, or Verification Results entry>; or none

### Reviews
Plan review passed in round <k>. Code review passed in round <k>.
Open findings: <unreached LOW findings that landed, with the follow-up issue; MEDIUM or LOW findings left at the ceiling; or none>.

### Verification
- `<command>`: <result>

### Limits and failures
- <failed or partial check, check not run, skipped platform, or baseline failure, with its cause; or none>

### Kept resources
- <resource that stays, with its reason; or none>

### After merge
- <steps that need their own question, child plans that a later run lands, or none>

## Checklist
- [x] <item with evidence on the reviewed head>
- [ ] <item without evidence> - <reason>

Closes #<n>
```

Fill the Checklist from the contract's Pull requests: the template items of
the repository, then the required checks, the tested-locally item with the IDs
of its Acceptance rows, and code review. Use only top-level task items, so that
GitHub shows `k of n tasks`.

Copy each failure and limitation from Verification Results into Limits and
failures. Report a check that partly failed as a failure with its cause, not as
a pass.

In Delegated decisions, list each decision that a grant answered (the
contract's Delegated decisions): the question, the choice, each rejected option
with its reason, the reversibility, and the locator of its deliberation record.
Write `none` when no grant is in force. With a grant, the merge question
states `<d> delegated decisions` and points to this section.

In Kept resources, list what stays after `Merge now`: the recorded compose
volumes, the resources that Teardown keeps, and the production resources that
need their own question. Also list what stays after `Leave pull request open`:
the worktree, the branch, and the remote resources. Name each resource without
an absolute machine path. After the merge answer, report the actual Kept
resources in the final report.
