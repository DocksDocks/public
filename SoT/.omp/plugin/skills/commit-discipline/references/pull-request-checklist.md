# Pull-request checklist

The `## Checklist` section of a pull-request description holds top-level task
items (`- [ ] <text>` or `- [x] <text>`), so that GitHub shows its progress as
`k of n tasks`. Do not nest items: GitHub does not document how it counts
nested items.

## Items

`gh pr create --body-file` uses the file as given and copies no template, so
build the items in this order:

1. The task items of a usable pull-request template of the repository, as
   written. GitHub reads a `pull_request_template` file (`.md` or `.txt`, in
   any letter case) in the root, in `docs/`, or in `.github/`, or a
   `PULL_REQUEST_TEMPLATE/` folder. A usable template is a regular file with
   one of these names, a symlink with one of these names that resolves to a
   regular file, or a `PULL_REQUEST_TEMPLATE/` folder (or a symlink to one)
   that holds at least one regular `.md` or `.txt` file. Any other entry with
   one of these names is unusable, for example a broken symlink, a folder with
   a file name, or an empty template folder. When no template is usable, use
   the defaults: "`<check command>` passes" (from the root instruction file,
   or "Checks pass" when it names none) and "Code review passed". Name each
   unusable entry to the user.
2. One item for each check that the repository instructions require, as
   "`<command>` passes".
3. "Tested locally end to end (<checks>)" when the change touches a surface
   that a user or another program drives. `<checks>` names each end-to-end
   check that the touched surface needs, also a check that has not run yet,
   for example each flow of the project `verify` skill that covers it. When no
   such check exists, write the item without the suffix, and keep it unticked
   with the reason `no end-to-end check exists`. Leave this item out when the
   change touches no such surface.
4. "Code review passed".

Skip an item of 2 to 4 when a template item or a default item already covers
it, so that no check and no review shows twice.

A template item that covers local or end-to-end testing, such as "Tested
locally end to end", covers item 3. Keep its text as written, and add
` (<checks>)` after it. `<checks>` names the checks of item 3. When the change
touches no driven surface, `<checks>` names each check that proves the text of
the item, such as a flow of the project `verify` skill. Add this suffix to no
other template item. When no check proves the item, add no suffix, and keep it
unticked with the reason `no end-to-end check exists`, or
`the change touches no driven surface` when the change touches none.

## Ticks

Tick an item (`- [x]`) only when its check passed on the head that you push
now, or, for the code-review item, when a review passed on that head. Tick the
tested-locally item only when it names at least one check, and each check that
it names passed on that head. Run a check through a flow of the project
`verify` skill when a flow covers it, and directly otherwise. A template item
that names the `verify` skill also needs each named check to run through a
flow of that skill. When a named check did not pass on that head, keep the
tested-locally item unticked with the reason
`<checks> did not pass on <short-sha>`, where `<checks>` lists those checks.
When a named check ran without the skill, keep a template item that names that
skill unticked. Give
it the reason `<checks> ran without the verify skill`, where `<checks>` lists
those checks. Leave every other item without its evidence unticked, and end
its line with ` - <reason>`.

After each push, untick each item whose evidence is for an older head, with the
reason `not checked on <short-sha>`, until it passes again on the new head.
Update the body with `gh pr edit <pr> --body-file <file>` right after the push,
before any wait for checks.

## Sources

- GitHub Docs, "Creating a pull request template for your repository":
  <https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository>
- GitHub Docs, "About issue and pull request templates" (names are not case
  sensitive; `.md` or `.txt`):
  <https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates>
- GitHub Docs, "About tasklists" (`- [ ]` and `- [x]` task items):
  <https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-tasklists>
- `gh pr create` manual (`--body-file` takes the body as given):
  <https://cli.github.com/manual/gh_pr_create>
