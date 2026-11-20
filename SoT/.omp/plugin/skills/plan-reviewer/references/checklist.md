# Plan review checklist

These checks direct your attention to plan defects that reviews often miss.
They do not limit the review. Report any defect that meets the finding bar in
`SKILL.md`, also when no check below names it. Report a failed check only when
the failure meets that bar. The kind after each check is the usual kind. Use
the kind that fits the defect.

## Steps

- The Files cell of each step names every file that the step changes. Look for
  manifests, lock files, generated hashes and indexes, docs, changelogs, and
  tests that the change makes stale. (`goal_fit`)
- Each Depends cell names every step whose output the step uses. Two steps that
  list the same path have a Depends chain, or one of them owns the shared edit.
  (`goal_fit`)
- Each Effect cell matches what the step does. A step that pushes, publishes,
  releases, deploys, or reaches production data does not carry `local`.
  (`security_risk` when the cell hides a non-local effect, otherwise `goal_fit`)
- Each Done when cell names an observable result that a reader can check, not
  an activity. (`goal_fit`)

## Acceptance

- Acceptance holds a row for every check that the repository instruction files
  (`AGENTS.md` and similar files) require for the paths in the Files cells.
  Read the instruction files of each directory that a step touches, not only
  the root file. (`goal_fit`)
- When a step's Files cell changes the code or configuration of a surface that
  a user or another program drives, such as a CLI command, a hook, a service,
  or a UI, at least one row runs that surface end to end the way its user does,
  and it names the observable result. A test file that starts the real surface
  and checks its output counts. A unit-test command that only calls internal
  functions does not. A change to prose, a skill text, or a reviewer prompt
  alone has no driven surface, so it needs no such row. The plan contract
  (Steps, acceptance, and effects) states it. (`goal_fit`)
- Each command runs as written in the stated environment. The binary, the
  flags, the paths, the working directory, and the runtime exist where the plan
  runs the command, and the expected result is what the command prints or
  returns. (`goal_fit`)
- Each row that checks a Goal outcome can fail. Read the command and each file
  that the command reads in the repository. Predict the result on the tree
  before the steps, and on a partial change that does not make the outcome.
  Look for:
  - a pattern that already matches, or that cannot match because the text
    spans two lines;
  - a parser or a regex that already accepts the input;
  - a command that reads a fixed path, not the copy that the row changes;
  - an assertion that uses only the first match;
  - a test that does not assert the property that the row or Research says it
    checks.

  Cite the `path:line` that makes the row pass. The fix changes the row. A row
  that is a regression guard, or a gate that must pass before and after the
  change, is not a finding. (`goal_fit`)

## Research

- Each decision in Research states facts that match the repository and
  official documentation, and its effects keep the Goal, the steps, the
  Acceptance checks, the repository instructions, and the plan contract.
  (`research_gap`, or `goal_fit` for an effect)
- Each load-bearing claim about the repository matches the repository: symbol
  names, signatures, callers, and the instruction files. (`research_gap`)
- Each load-bearing claim about a library, tool, runtime, or external API
  matches current official documentation. Check the semantics too: ordering,
  defaults, parameter handling, error behavior, and version limits.
  (`research_gap`)
- No unchecked assumption carries a step. A step that relies on a fact that
  Research does not establish is a finding. (`research_gap`)

## Whole plan

- No step contradicts another step, the Goal, a recorded decision, or the Do
  not touch section. Cite both lines. (`goal_fit`)
- When a step changes a format, a grammar, a location, a key, a default, or a
  rule text, search the repository for each reader of the old form: scripts,
  tests, fixtures, stored records and queue files that a reader reads again,
  text that states the rule again, and the tools or agents that load that
  text. A reader on a supported path that no step updates is a finding only
  when evidence shows that the reader misreads the new form or that a
  supported outcome breaks. Cite the reader as `path:line` and the line that
  misreads the new form. A reader that handles the new form, for example one
  that lists entries generically, is not a finding. (`goal_fit`)
- The plan keeps the invariants of the plan contract, which is
  `plan-manager/references/plan-contract.md` in this plugin. Read the contract
  when a step touches one of these areas. (`security_risk` or `goal_fit`)
  - Ownership: the issue is the canonical plan record, a write refuses a
    foreign assignee, and the manager owns plan edits, review publication, and
    lifecycle changes.
  - Publication safety: no secret, credential location, private data, or
    sensitive finding becomes public without the confirmation that the contract
    requires, and machine paths stay out of durable records.
  - Confirmation: each destructive, publish, release, or other non-local effect
    waits for the confirmation that the contract requires before it runs. In a
    yolo run, the effect table of the contract's Yolo runs section applies.
