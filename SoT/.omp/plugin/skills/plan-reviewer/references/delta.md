# Plan delta mode

The manager may choose the `delta` mode for a re-review after a repair. Use
this mode only when the dispatch names it. A delta round reviews the repair and
the parts of the plan that the repair can affect, because earlier rounds
reviewed the rest of the plan.

## Input

| Input | Content |
|---|---|
| Plan diff | The change from the export that the previous round reviewed to the current export |
| Previous round's comment file | The block that the manager posted for the previous round |
| Rejection comment file | The manager's evidence against findings of the previous round, when the manager rejected a finding. Its first line is `Rejected review findings, round <k>`. |
| Repair record file | The manager's list of the findings of the previous round that it fixed, each with its plan line and the class instances that it repaired. Its first line is `Repaired review findings, round <k>`. |
| Current export | The whole plan as it is now |
| Issue number and round number | The values for the heading |

Read the files that the dispatch names. Do not fetch the issue. When the plan
diff or the previous round's comment file is missing or cannot be read, run a
full review and use the full heading.

## Duties

1. Check each finding of the previous round. Decide from the current export and
   the repository whether the repair resolves it, and do not rely on the
   manager's summary of the repair. Mark the finding `resolved` or `open`.
   Repeat an open finding as a finding line with its kind. For a finding that
   names a class, check each instance that the repair record lists, and search
   the export for instances that the list leaves out. An instance that still
   has the defect keeps the finding `open`, with that instance as a locator.
2. Review every changed line of the plan diff with the finding bar and the
   checklist. Also review the sections that depend on a changed line, because
   a repair can break a part of the plan that the diff does not change. For
   example, a new path in a Files cell can need a new Acceptance check, and a
   changed Research claim can remove the support for a step.
3. Do not verify an unchanged claim again when no changed line affects it.
4. Do not repeat a finding that the manager rejected with evidence. Mark it
   `rejected`.

Choose the verdict with the verdict rules of `SKILL.md`. The open findings and
the new findings count toward it.

## Output

```markdown
### Plan review round <N>, delta

Plan-review: <pass|repair|blocked>

- goal_fit - <locator> - <defect> - <fix> - class: <defect class>

Previous findings:

- Round-<k> finding on <locator>: resolved - <evidence from the current export>
- Round-<k> finding on <locator>: open - repeated above
- Round-<k> finding on <locator>: rejected - not repeated
```

Write one previous-findings line for each finding of the previous round, where
`<k>` is that round's number and `<locator>` is the locator of that finding.
The other output rules of `SKILL.md` (Output Format) apply.
