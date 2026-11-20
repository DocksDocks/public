# Pull-request template

Offer this template only when the repository has no usable pull-request
template. GitHub reads a template from the root, from `docs/`, or from
`.github/`. A template there is a file named `pull_request_template`, with an
extension such as `.md` or `.txt`, in any letter case, or a
`PULL_REQUEST_TEMPLATE/` folder that holds several templates
(<https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository>,
<https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates>).
The detection below looks only at the names that these pages give:
`pull_request_template`, `pull_request_template.md`, and
`pull_request_template.txt`, in any letter case. The folder name
`PULL_REQUEST_TEMPLATE` is the first of these. Other names, for example
`pull_request_template.md.bak`, are not templates.

The detection answers two questions apart:

- Is there a usable template? A usable entry is a regular file with a supported
  name, a symlink with a supported name that resolves to a regular file, or a
  `PULL_REQUEST_TEMPLATE` folder (or a symlink to one) that holds at least one
  regular `.md` or `.txt` file. This answer drives the offer, each check of the
  template, and the checklist items.
- Is the target path occupied? Any entry with a supported name occupies its
  path, also an unusable one: a broken symlink, a folder with a file name, or
  an empty template folder. This answer guards each write.

`<skill-dir>` is the folder of the skill that holds this reference. Run the
detection from any folder inside the repository:

```bash
node <skill-dir>/scripts/pr-template.mjs detect
```

It prints one `pull-request template: <path> (<kind>)` line for each usable
entry, for example
`pull-request template: .github/pull_request_template.md (symlink to file)`,
and one `pull-request template: unusable <path> (<reason>)` line for each
unusable entry. It prints `pull-request template: none` when no usable entry
exists, also when unusable entries exist. Paths are relative to the
repository root. When it prints an `ERROR` line, for example outside a git
repository, report the error and write nothing. An error is not a missing
template. After an `ERROR` line, the command exits with status 2, and the
cause is on stderr.

Offer the template only on `pull-request template: none`. Never overwrite or
edit an existing entry, and never write through a symlink. Right before the
write, run this gate:

```bash
node <skill-dir>/scripts/pr-template.mjs gate
```

It prints exactly one line: `target occupied: write nothing`, `target free`,
`no write: a usable template exists, or .github is a symlink`, or the `ERROR`
line of the detection.

Write only on `target free`. On `target occupied`, report the entry that
occupies `.github/pull_request_template.md` and write nothing; the user
resolves it.

Write the terminal fenced block to `.github/pull_request_template.md`. Replace
`<check command>` with the check command that the root instruction file names,
for example `bun run check`. When the root instruction file names no check
command, write the first item as `- [ ] Checks pass`. Keep each item a
top-level task item, so that GitHub shows the progress as `k of n tasks`. The
repository can add its own items later. GitHub uses the template only after it
is on the default branch. The `plan-manager` landing pull request copies these
items into its `## Checklist` section.

```markdown
## Checklist

- [ ] `<check command>` passes
- [ ] Tested locally end to end
- [ ] Code review passed
```
