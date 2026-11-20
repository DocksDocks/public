# Delta round

A delta round reviews the repairs since the previous round. The dispatch gives
the delta diff, from the previous round's reviewed head to the current reviewed
head. It also gives the previous round's comment file, the manager's rejection
comment file and repair record file for that round if they exist, the plan
export, the issue number, and the round number. The repair record lists each
finding that the manager fixed and each class instance that it repaired.

The previous comment file can hold several lens blocks.
Every finding line in it is a previous finding.

## Duties

1. Settle each previous finding from the repository state at the current head.
   Do not rely on the manager's summary or on commit messages. Give each
   previous finding one status:
   - `fixed`: the defect no longer reproduces. When the finding names a class,
     every instance of the class is fixed, not only the listed locators. Check
     the repair record's list against the current head: each listed instance,
     and each instance of the class that the list leaves out. An instance that
     still has the defect keeps the finding `open`, with that instance as a
     locator.
   - `open`: the delta does not fix the defect, or it fixes only part of it.
     Repeat the finding as a normal finding line under its axis, with its
     severity and the locators that remain.
   - `rejected`: the rejection comment rejects the finding with evidence. Do not
     repeat the finding. Treat a rejection without evidence as `open`.
2. Review every delta hunk on both axes. Load a lens reference when a hunk
   needs its checklist. Trace each changed symbol to its callers and callees,
   also in unchanged code, because a fix can break code that the delta does not touch.
3. Leave unchanged code alone unless the delta changes its behavior. A defect
   that the delta neither adds nor changes is outside the round, also when the
   previous round missed it.
4. Report a new finding only when no previous finding covers it.

Some hunks can repair findings of a self-review that the dispatch does not
supply. Review them like every other hunk.

## Output

Use the delta heading from the output contract of the skill. Put a
`## Previous findings` section between the verdict line and `## Standards`,
with one line per previous finding:

```markdown
## Previous findings

- Round-1 finding on src/sync.mjs:40: fixed - <what the current head does, with its locator>
- Round-1 finding on src/pull.mjs:18: open - repeated under Standards
- Round-1 finding on docs/usage.md:12: rejected - <the evidence that the rejection comment gives>
```

- Use the round number of the previous round in each line.
- Do not copy a severity tag into this section, because the helper reads
  `[CRITICAL]` or `[HIGH]` anywhere in the comment as a standing finding.
- Write `None.` in this section when the previous round had no findings.

The verdict counts the open previous findings and the new findings together.
