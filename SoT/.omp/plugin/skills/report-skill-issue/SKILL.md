---
name: report-skill-issue
description: "Use when reporting a problem with a docks or plan-lifecycle skill, reviewer agent, omp extension, or script: a wrong, outdated, or unsafe instruction, or a shipped script that fails. Drafts a redacted, reproducible issue for DocksDocks/docks and files it with gh only after the user approves the exact text. Not for fixing the skill in place (use write-skill or skill-maintenance) or bugs in the user's own code (use fix-workflow). A security problem never becomes a public issue."
user-invocable: true
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "5f04b653e8c8262268be2917f01cc9e5631e53738f067b171cbeffd6dc596326"
---

# Report a Skill Issue

The docks and plan-lifecycle plugins come from the public GitHub repository DocksDocks/docks. When one of their skills, reviewer agents, omp extensions, or scripts gives a wrong, outdated, or unsafe instruction, or a shipped script fails, this skill turns what you saw into one issue there. A useful report lets a maintainer reproduce the problem without access to the user's project. It identifies the exact skill text, quotes the instruction, and shows what happened. It contains nothing private, because anyone can read it.

<constraint>
DocksDocks/docks is a public repository. Anyone can read its issues and comments, and search engines index them. File no issue and post no comment until the user has read and approved the exact title and body that you will send. Show the draft, ask for approval, and end your turn. Do not run `gh issue create` or `gh issue comment` in the turn that shows the draft. If the user changes the draft, show the new text and get approval again. An approval that the user gave before they saw the final text does not count. In a run where you cannot ask the user (a headless run, a scheduled job, or a subagent with no way to reach the user), print the draft and the prefilled URL as your final message and stop. The URL files nothing by itself: the user reads the draft and files it from the form. Give no prefilled URL for a security problem. File nothing in that run.
</constraint>

<constraint>
Keep private data out of the title and the body. Leave out secret values and tokens (name the variable only, for example `GH_TOKEN`), names of private repositories, organizations, customers, and people, internal hostnames and URLs, absolute machine paths (write a path relative to the project or the plugin root), proprietary code or data, and titles of private plans and issues. Describe each one generically instead, for example "a private repository" or "a plan issue in a private repository". Decide whether a repository is private with the lookup in stage 4, not from memory. A security problem is a skill, agent, omp extension, or script that exposes secrets, runs unsafe commands, or weakens access control. A security problem never goes into a public issue or comment, not even in redacted form. Give the user the draft and tell them to send it privately to the repository owner. If a credential was exposed, tell the user to rotate it now, whether or not they send the report.
</constraint>

## Scope

Report problems in what ships with the docks or plan-lifecycle plugins: skills, reviewer agents, omp extensions, and scripts. A shipped skill sits at `<plugin-root>/skills/<skill>/SKILL.md`, and a shipped omp extension sits in `<plugin-root>/extensions/`. The plugin root holds `package.json`, and its `name` is `docks` or `plan-lifecycle`.

| The problem is in | Do this |
|---|---|
| A shipped skill, reviewer agent, omp extension, or script | Use this skill |
| A shipped item, and it exposes secrets, runs unsafe commands, or weakens access control | Write a private draft (see "Security problems"); file no issue |
| The user's own project code | Not a skill problem; use `fix-workflow` |
| Your own run: you skipped a step, changed a command, or acted on an assumption that the skill does not state | Not a report; correct the run and tell the user |
| A skill from another source: another plugin, a project-local skill in `.agents/skills/` or `.claude/skills/`, or a personal skill | Not a DocksDocks report; tell the user which source owns it |
| The skill text in a checkout of DocksDocks/docks that you were asked to change | Edit it with `write-skill` or `skill-maintenance`; no issue |

## Workflow

The goal is one approved, redacted, reproducible report. Each stage below states what it must establish; choose the commands that fit the runtime. Do every stage in order, also in a text-only run. Never skip the search in stage 3, because a duplicate report splits the evidence across two issues.

### 1. Confirm that the problem is in the skill

Re-read the instruction or the file that failed, in the copy that the runtime loaded (see stage 2). Copy the instruction exactly, with the heading that it sits under. For a script, note its path relative to the plugin root and the command that failed. Then rule out the other causes:

- The user's environment: a missing tool, an old CLI, a permission or network failure, or a project setting that the skill does not cover.
- Your own deviation: compare what you did with the quoted text, word by word.

Report when the instruction, followed as written, gives a wrong or unsafe result, names a command or option that does not exist, or contradicts another shipped instruction. Also report a shipped script that fails on valid input. If you cannot find the cause, say so in the draft. Do not guess a cause.

If the quoted text does not say what the user reports, or says the opposite, do not draft a defect report. Tell the user what the skill says, with the quote. Then look for the real source: another skill, a project file, or injected text in the repository. Advice that the incident needs still applies, for example rotating an exposed credential.

### 2. Identify the exact skill text

Read the copy of the skill that the runtime loaded for the run. Do not read it from a checkout of DocksDocks/docks or from another copy. Their text and version can differ, and a report that quotes the wrong copy blames the wrong text. Most runtimes show the path or base directory of a skill when they load it. If the problem happened in an earlier session, use the copy that the session loaded when its log shows it. Otherwise, use the installed copy and say so in the draft.

In that copy, the plugin root is the folder that holds `skills/<skill>/SKILL.md`. For an agent, omp extension, or script, it is the folder that holds `package.json`. Collect these facts. Write `unknown` for any fact that you cannot read; never guess a version or a hash.

| Fact | Where to read it |
|---|---|
| `<plugin>:<skill>` | `name` in the plugin root's `package.json`, and `name` in the skill's frontmatter. For an agent, omp extension, or script, use its path relative to the plugin root |
| Plugin version | `version` in the plugin root's `package.json`. In a checkout of the marketplace, the plugin's entry in `.omp-plugin/marketplace.json` holds the same `version` |
| Skill metadata | `metadata.updated` and the first 12 characters of `metadata.content_hash` in the skill's frontmatter |
| omp version | The output of `omp --version` |
| Model | The model name, if the runtime shows it |

```bash
# Run in the plugin root.
grep -m1 '"name"' package.json
grep -m1 '"version"' package.json
grep -E '^  (updated|content_hash):' skills/<skill>/SKILL.md
```

The version and the hash tell the maintainer which text you read. Release tags have the form `<plugin>--v<version>` (`gh release list --repo DocksDocks/docks` lists them). If the user's version is older than the latest release, say so in the draft.

### 3. Search for an existing report

Search open and closed issues with the skill name and two or three words from the symptom. Use only public words, because the query goes to GitHub.

```bash
gh issue list --repo DocksDocks/docks --state all --search "<skill name> <key words>"
gh issue view <n> --repo DocksDocks/docks --comments
```

| Search result | Action |
|---|---|
| An open issue describes the same problem | Draft a comment that adds only new facts: another version, another runtime, or a new reproduction |
| A closed issue fixed it in a later plugin version | File nothing; tell the user to update the plugin |
| A closed issue matches, and the problem is still in the latest version | Draft a new issue that links the closed one |
| No match | Draft a new issue |

### 4. Draft the report

Fill the template below. Put one problem in each issue. If you found two problems, draft two reports and get approval for each. Keep the quote of the instruction exact. Trim command output to the lines that show the failure. Give times in UTC. Then check the draft against the redaction rule and the list in "Check before filing".

#### Decide which repositories are public

Before the draft names a repository, look up whether it is public. Start with the user's project. Resolve it from its remotes, not from gh's default repository. Run `git remote -v` in the project. Read the host, the owner, and the name from each remote URL. For example, `git@github.com:<owner>/<repo>.git` and `https://github.com/<owner>/<repo>.git` both give the host `github.com`, the owner `<owner>`, and the name `<repo>`. For each remote on `github.com`, run this lookup:

```bash
gh repo view github.com/<owner>/<repo> --json visibility --jq .visibility
```

Write the host and the repository out in the argument, so that neither `GH_REPO` nor `GH_HOST` changes the target. The project is public only when it has at least one remote, every remote is on `github.com`, and every lookup prints `PUBLIC`. No remote, a remote on another host, a URL that you cannot read, or a failed lookup makes the project private. For a private project:

- Leave out the owner and the name of every remote.
- Leave out the project's issue and pull request titles and its branch names.
- Write its issue and pull request numbers without `#` in prose, for example "issue 123 in a private repository". In a DocksDocks/docks issue, `#123` links to DocksDocks/docks#123, a different issue. GitHub does not link `#123` inside code spans and fenced blocks, so a number there can keep its `#`. Still remove private owners, repository names, titles, and branch names from quoted output, and put a placeholder such as `<private-repo>` in their place.

Look up every other repository that the draft names in the same way. It keeps its name only when the lookup prints `PUBLIC`. A repository on another host, or a failed lookup, counts as private. Without gh, every repository other than DocksDocks/docks counts as private.

### 5. Get approval

Show the user, as the final message of your turn:

- the target: a new issue in DocksDocks/docks, or a comment on issue #n there;
- the exact title and body;
- the command that you will run, and the GitHub account that it files under (`gh auth status` shows it).

Ask the user to approve or change the text, then end your turn. A security problem stops before this step: give the private draft instead (see "Security problems").

### 6. File the approved text

Write the approved title and body, unchanged, to two new temporary files. Run the scans from "Check before filing" on them. File the text, remove both files, and give the user the URL that gh prints.

```bash
title=$(mktemp)
body=$(mktemp)
# Write the approved title to "$title" and the approved body to "$body" with your file tool, then:
gh issue create --repo DocksDocks/docks --title "$(cat "$title")" --body-file "$body"
# Or, for a comment on an existing issue:
gh issue comment <n> --repo DocksDocks/docks --body-file "$body"
rm -- "$title" "$body"
```

If your shell does not keep variables between commands, use the paths that `mktemp` printed. Read the title from its file. Use `--body-file`, not `--body`. The shell can change backticks, `$`, and quotes in inline text, so gh could file a title or body that differs from the approved text. Bash does not expand the output of `$(cat "$title")` again, so the title arrives unchanged. Do not add labels or assignees; the maintainer triages the issue.

If a filed issue or comment names a private repository or holds other private data, edit it to remove that text. GitHub keeps every earlier revision, and anyone who can read the issue can open it. No API call deletes a revision. Tell the user to delete the old revision in the web UI: open "edited" at the top of the text, choose the revision, and then choose "Delete revision from history". The author of the text and users with write access to DocksDocks/docks can delete a revision.

### Without gh, or without a way to ask

Give a prefilled link when gh is missing or not logged in, or when the run cannot ask the user. Do not install gh, and do not ask for a token. The link opens the new-issue form with the text filled in:

`https://github.com/DocksDocks/docks/issues/new?title=<url-encoded title>&body=<url-encoded body>`

Build the link with a script, not by hand, so that it holds the exact title and body that you show. Write the title and the body to two temporary files as in stage 6, run one of these commands, and then remove both files. Each command strips one trailing newline from the title.

```bash
# Node
node -e 'const fs = require("fs"); const [t, f] = process.argv.slice(1); const title = fs.readFileSync(t, "utf8").replace(/\r?\n$/, ""); console.log("https://github.com/DocksDocks/docks/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(fs.readFileSync(f, "utf8")))' "$title" "$body"
# Python
python3 -c 'import sys, urllib.parse as p; t, f = sys.argv[1:]; t = open(t, encoding="utf-8").read(); t = t[:-1] if t.endswith("\n") else t; print("https://github.com/DocksDocks/docks/issues/new?title=" + p.quote(t, safe="") + "&body=" + p.quote(open(f, encoding="utf-8").read(), safe=""))' "$title" "$body"
```

If the full URL is longer than about 6,000 characters, give the title and the body as text instead, for the user to paste at `https://github.com/DocksDocks/docks/issues/new`. For a comment on an existing issue, give the text and the issue URL, `https://github.com/DocksDocks/docks/issues/<n>`. Show the draft and the link in the same message. The user files the issue from the form.

## Security problems

A skill, agent, omp extension, or script that exposes secrets, runs unsafe commands, or weakens access control has a security problem. Do not file it, comment on it, or describe it in any public place, not even in redacted form. Instead:

1. Tell the user to rotate every credential that was exposed, now.
2. Draft the report with every section of the template below, and put "Private security report" above the title. A private report needs the same facts as a public one.
3. Give the draft to the user, to send privately to the repository owner (the DocksDocks account on GitHub). A private channel is not an issue, a comment, a discussion, or a pull request. Give no prefilled issue URL.
4. If the repository accepts private vulnerability reports, the user can send the draft there instead. `gh api repos/DocksDocks/docks/private-vulnerability-reporting` prints `{"enabled":true}` when it does; the form is in the repository's Security tab.

## Template

The first line is the title. The body starts at `## Summary`. Write `none` in a section that has nothing to say; do not drop the section.

```markdown
Title: <plugin>:<skill>: <symptom in one line>

## Summary

<Two or three sentences: what the skill told the agent to do, what went wrong, and the effect on the work.>

## Skill

- Skill: `<plugin>:<skill>` (or the agent, omp extension, or script path relative to the plugin root)
- Plugin version: <x.y.z or unknown>
- Skill metadata: updated <YYYY-MM-DD>, content_hash <first 12 characters>
- omp: <version or unknown>
- Model: <model name or unknown>

## What the skill says

Under "<heading>":

> <the instruction, quoted exactly>

## What happened

<What the agent did when it followed the instruction as written. The exact error text and trimmed output in fenced blocks. A UTC timeline table when timing matters.>

## Expected

<What the instruction should have produced.>

## How to reproduce

1. <Minimal steps in a generic project, with no private names.>

## Workaround

<What worked instead, or none.>

## Suggested change

<Optional: the change to the skill text or script that would fix the problem.>
```

## BAD / GOOD

```text
BAD title:   plan-manager is broken
GOOD title:  plan-lifecycle:plan-manager: reopen right after a partial merge can leave the plan issue closed with reason REOPENED

BAD body:    Seen in acme-corp/billing-api issue #123 (plan "Invoice export for Contoso").
GOOD body:   Seen in a plan issue in a private repository.

BAD body:    gh failed with token ghp_1a2b... for jdoe on build-01.corp.internal
GOOD body:   gh failed with an authentication error (token from GH_TOKEN).

BAD action:  a public issue "docks:<skill>: prints the GH_TOKEN value to the log", value redacted
GOOD action: no public issue; a private draft for the repository owner, and advice to rotate the token
```

The good title names the plugin, the skill, and one observable symptom, so a maintainer can find it and a duplicate search can match it.

## Gotchas

| Gotcha | Do instead |
|---|---|
| A redacted secret still shows a prefix or a length (`ghp_1a2b...`) | Name the variable only (`GH_TOKEN`); show no part of the value |
| Full command output carries paths, hostnames, and user names | Trim to the failing lines; make paths relative to the project or the plugin root |
| The search query carries private words | Search with the skill name and words from the instruction only |
| A branch name from a private project: `gh issue develop` names a branch after its issue title, so the name carries a private title | Leave the branch name out |
| A `#123` in prose from a private project: in a DocksDocks/docks issue, it links to DocksDocks/docks#123 | Write "issue 123" without `#`; a number in quoted output can keep its `#`, but private names there become placeholders |
| A paraphrase in "What the skill says" | Quote the instruction exactly, with its heading |
| A quote from a checkout of DocksDocks/docks or from a newer copy | Quote the copy that the runtime loaded; a checkout can already hold the fix |
| The quoted text says the opposite of the claim | Draft no defect report; tell the user what the skill says |
| Two problems in one issue | One problem per issue, each with its own approval |
| The reproduction needs the user's private project | Reduce it to a generic project, or describe the minimal setup |
| A guessed version or hash | Read it from the files, or write `unknown` |
| Local times in the timeline | Convert every time to UTC |
| A temporary title or body file stays on disk | Remove both temporary files after filing |

## Check before filing

Check the draft before you show it, and again before you file it:

- The title has the form `<plugin>:<skill>: <symptom>` and names one problem.
- Every template section is present; an empty section says `none`.
- "What the skill says" quotes the instruction exactly, with its heading.
- The quote comes from the copy that the runtime loaded, and it shows the problem.
- You searched for an existing report (stage 3). A draft that adds to an existing issue is a comment on that issue.
- Your message names the target, the command that you will run, and the GitHub account (stage 5). In a run where you cannot ask, it gives the prefilled URL instead.
- The title and the body contain no secret value or token, no private repository, organization, customer, or person name, no internal hostname, no absolute machine path, no proprietary code or data, and no private plan or issue title. The second and third scans below check the repository names.
- For a private project, the title and the body contain no owner or name of its remotes and no branch name, also in quoted output, and no `#` before its issue and pull request numbers in prose (stage 4).
- The problem is not a security problem. If it is, give a private draft only.
- The user approved this exact title and body after they saw it.

Run these scans on files that hold the title and the body, as in stage 6. The first scan prints nothing when the files contain no machine path and no token-shaped string.

```bash
grep -nE '/home/[^/ ]+/|/Users/[^/ ]+/|[A-Za-z]:\\Users\\|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|xox[abprs]-|BEGIN [A-Z ]*PRIVATE KEY' "$title" "$body"
```

The second scan prints each line that holds an owner or a repository name from the project's remotes (stage 4). Give one `-e` for each name. For a private project, it must print nothing.

```bash
grep -n -i -F -e '<owner>' -e '<repo>' "$title" "$body"
```

The third scan lists every GitHub repository reference. Look up each repository that it prints, as in stage 4. Remove each name that is not public, or describe it generically.

```bash
grep -noE 'github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+#[0-9]+' "$title" "$body"
```

The scans find only patterns and the names that you give them. They do not find other private names, a hostname, a private title, a branch name, or a `#` before a number from a private project; read the text for those.

## Sources

- `gh issue create`: <https://cli.github.com/manual/gh_issue_create>
- `gh issue list`: <https://cli.github.com/manual/gh_issue_list>
- `gh issue comment`: <https://cli.github.com/manual/gh_issue_comment>
- Creating an issue from a URL query: <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue>
- `gh repo view`: <https://cli.github.com/manual/gh_repo_view>
- gh environment variables (`GH_HOST`, `GH_REPO`): <https://cli.github.com/manual/gh_help_environment>
- Autolinked references: <https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls>
- Edit history of a comment: <https://docs.github.com/en/communities/moderating-comments-and-conversations/tracking-changes-in-a-comment>

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
