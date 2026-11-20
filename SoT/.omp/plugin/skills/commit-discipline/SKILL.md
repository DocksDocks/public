---
name: commit-discipline
description: "Use when splitting work into small reviewable/atomic commits, deciding one commit vs several, writing commit messages (imperative subject, why-not-what body, Conventional Commits prefixes), writing a PR description, self-reviewing or splitting an oversized PR, choosing squash vs merge vs rebase, or running a fixup/autosquash cleanup. Not for dependency-vuln commit splits (use dep-vuln-workflow), fix planning or tier grouping (use fix-workflow), or refactoring cadence/reverts (use refactor)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "d61df9a29c2b2c66a33bc8c6541e5a0d8d5e76d724ada21de61771901d01554a"
---

# Commit & PR Discipline

Generic commit and pull-request hygiene: how to slice work into commits, what a
commit message owes its future reader, and how to keep a PR reviewable. This is
the kit's single home for those rules — the specialized splits (security-vs-hygiene
dependency commits, per-tier fix commits, per-refactoring commits) stay with their
owning skills and are routed to below, not restated here.

<constraint>
One logical change per commit. Never mix a refactor with a behavior change, or a
security patch with hygiene bumps, in the same commit — reverting one must not roll
back the other, and a reviewer must be able to hold the whole diff as one idea. The
specialized split rules live with their owners: security-vs-hygiene dependency
splits in `dep-vuln-workflow`, one-commit-per-tier fix grouping in `fix-workflow`,
one-refactoring-at-a-time cadence in `refactor` — defer to them in their domains.
</constraint>

<constraint>
Every commit leaves the tree green (build + tests + lint pass at that commit). A
red intermediate commit breaks `git bisect` and makes `git revert` unusable — the
two tools commit atomicity exists to serve. If two changes cannot be separated
into independently green commits, they are one commit, not two.
</constraint>

<constraint>
Never rewrite history others may have built on. Never force-push or rewrite any
history without explicit user confirmation, even on your own PR branch. Once
confirmed, amend, autosquash, and rebase are limited to your own not-yet-merged
branch. Push rewritten history only with `git push --force-with-lease` (never
bare `--force` — it silently discards a collaborator's or CI bot's newer commits).
</constraint>

## When to use / when NOT

| Situation | Skill |
|---|---|
| Split staged work into reviewable commits; message or PR wording; merge strategy | this skill |
| Splitting a dependency bump into security vs hygiene commits | `dep-vuln-workflow` |
| Grouping bug/security fixes into commits by blast-radius tier | `fix-workflow` |
| Commit-per-refactoring cadence, test-revert discipline | `refactor` |
| Reviewing the diff's *content* (bugs, security, slop) | `code-review` |

## Atomic commits — the one-sentence test

A commit is one logical change if you can name it in a single imperative sentence
with no "and": *"Add rate limiting to the login endpoint."* If the honest subject
needs "and" ("add rate limiting AND fix the logger AND format user.ts"), split it.

| Smell in the staged diff | Split into |
|---|---|
| Feature + drive-by rename/format of untouched-logic files | behavior commit, then (or first) a mechanical commit |
| Bug fix + the test that proves it | ONE commit — the test is part of the fix, not a separate change |
| Two unrelated fixes found while reading | one commit each, even at 2 lines |
| Generated files (lockfile, snapshots) + the change that caused them | same commit as their cause — never orphaned |
| Rename/move + edits to the moved file | rename-only commit first (keeps `git log --follow` and blame usable), edits second |

Slice with `git add -p` (stage hunks, not files); verify each slice is green before
committing it. `git status --short` + `git diff --cached` before every commit —
know exactly what is going in.

```text
# BAD — one commit, three unrelated ideas; reverting the fix reverts the rename
fix login rate limit, rename utils, bump eslint

# GOOD — three commits, each independently green and revertable
fix: rate-limit login attempts per IP
refactor: rename utils.ts to http-helpers.ts
chore: bump eslint to 9.x
```

## Commit messages

Subject line: imperative mood ("Add", "Fix", "Remove" — not "Added"/"Adds"), ~50
chars target, 72 hard max, no trailing period. Then a blank line, then a body
wrapped at 72 columns. Git's own tooling assumes this shape (`git log --oneline`,
shortlog, format-patch subjects).

The body answers **why, not what** — the diff already shows what. State the
problem, why this approach over the plausible alternative, and any non-obvious
consequence. A future `git blame` reader has the code but not your context.

```text
# BAD — restates the diff, no why, past tense
Updated the session code. Changed timeout value and fixed some issues.

# GOOD — imperative subject, body carries the why
fix: expire sessions server-side on logout

Client-side token deletion left sessions valid until TTL expiry, so a
stolen token outlived logout. Revoke server-side instead; TTL stays as
defense-in-depth. Alternative (short TTL + refresh) rejected: breaks
long-running uploads.

Closes #482
```

### Conventional Commits — where the repo uses them

Spec: **v1.0.0** (re-verify: <https://www.conventionalcommits.org>
— the homepage serves the latest version). Format:
`<type>[optional scope][!]: <description>`, then optional body and footers.

| Type | SemVer effect | Use for |
|---|---|---|
| `feat` | MINOR | new user-facing capability |
| `fix` | PATCH | bug fix |
| `feat!` / `fix!` or `BREAKING CHANGE:` footer | MAJOR | breaking API change — `!` after type/scope, or a `BREAKING CHANGE: <description>` footer (both spec-valid) |
| `build` `chore` `ci` `docs` `style` `refactor` `perf` `test` | none | allowed by the spec, not mandated; this list is what `@commitlint/config-conventional` (Angular convention) recommends; no version effect unless marked breaking |

Footers follow git-trailer form: `Token: value` or `Token #value` (e.g. `Closes #482`).
Multi-word tokens use hyphens (`Reviewed-by:`); `BREAKING-CHANGE` is synonymous
with `BREAKING CHANGE`.

**Adopt the repo's convention, don't impose one.** Detect before writing:
`git log --oneline -20` — if prefixes are in use, match them (types AND scopes in
use); if not, don't introduce them in a one-off commit. Release tooling
(semantic-release, changesets, release-please) parses these prefixes — a mistyped
type or missed `!` mis-versions the next release.

### `Verified:` trailer — record how the commit was verified

Each commit records the checks that verified it, as a git trailer in the last
paragraph of the message:

```text
fix: expire sessions server-side on logout

Client-side token deletion left sessions valid until TTL expiry.

Closes #482

Verified: bun test src/session; bun run lint
```

- Write `Verified: <command>[; <command>]`. Name each check command that you ran on the tree of this commit. Separate two commands with `; `.
- When no check applies, write `Verified: none - <reason>`, for example `Verified: none - comment-only change`. A bare `none` does not count.
- Write the trailer after the checks pass. Do not name a check that you did not run.
- Put the trailer in the last paragraph, alone or with other `Token: value` trailers. Git reads no trailers from a paragraph that also holds a `Closes #482` line, so put that line in a paragraph above. A `Verified:` subject line is not a trailer either. `git interpret-trailers --parse` shows the trailers that git reads.
- A squash merge writes one new message from the pull request, as the repository settings choose. That message can drop the trailers of the branch commits. Put the `Verified:` line in the pull-request description too, and check that the squash message keeps it.

The docks-kit kit plugin (`docks-kit-omp`) ships the `verify-gate` omp extension. It checks each `git commit` that runs through the bash tool, before
the command runs. A commit that another tool makes does not pass through the gate. After an upgrade of docks-kit, restart omp:
omp loads extensions only when a session starts.
The `DOCKS_VERIFY_GATE` environment variable of omp selects its mode. The gate checks each `bash` command that holds a
`git commit`. A command whose commits all carry the trailer writes nothing. A `git commit --dry-run` counts as no commit.
`observe` is the default: the gate allows the command, and a command with a commit without the trailer writes one log line
for that command to `${XDG_STATE_HOME:-~/.local/state}/docks/verify-gate.jsonl`.
The line holds metadata only: `time`, `session_id`, `cwd`, `mode`, and `message_sources`, the message sources of its first
commit without the trailer (for example `-m`, `-F`, `--amend`, or `none`). No line holds the command or the message text.
`enforce` denies such a command the first two times in a session. The third time, it allows the command, writes one log
line for that command with `allowed_after_denials`, and starts the count again. A denial count older than seven days
expires, so the cycle starts again at the first denial.
When a check fails, for example because the gate cannot write its state folder, or runs past its deadline, the gate allows
the command. It can then write no log line and count no denial, so a missing log line does not prove a trailer.
`off` turns the gate off.

## Fixup / autosquash — clean up before review, not after

Address review feedback and self-caught mistakes as fixups while the PR is open,
then, after explicit user confirmation, fold them before merge (or let
squash-merge do it — see the merge table):

```bash
git commit --fixup=<sha>            # fix goes into <sha> on autosquash
git commit --fixup=amend:<sha>      # also reword <sha>'s message (editor opens)
git commit --fixup=reword:<sha>     # reword ONLY — no content change
git rebase -i --autosquash <base>   # explicit user confirmation required first
git push --force-with-lease         # own PR branch; explicit confirmation required
```

- `--autosquash` matches on the `fixup!`/`squash!`/`amend!` subject prefix
  against earlier subjects or the given hash — always create fixups via
  `--fixup=<sha>` (or `amend:`/`reword:`), never by hand-typing the prefix (a
  paraphrased subject won't match).
- `rebase.autoSquash=true` makes interactive rebases autosquash by default; for a
  non-interactive rebase, pass `--autosquash` explicitly.
- After explicit user confirmation, stacked branches may use
  `git rebase --update-refs` to force-update the other branches pointing at
  rebased commits (checked-out worktrees excluded).
- During review, PREFER pushing fixup commits over force-pushing rewrites:
  reviewers see what changed since their last pass; rewriting mid-review destroys
  their per-commit anchor points.

## PR hygiene
Plan-lifecycle branches are excluded from the generic landing guidance below.
Defer landing them to `plan-manager`, which must obtain fresh explicit user
approval to "Merge now"; do not apply generic merge, squash, or rebase advice to
those branches.

GitHub's guidance (re-verify:
<https://docs.github.com/en/pull-requests/concepts/helping-others-review-your-changes>):
"Small, focused pull requests are easier to review and safer to merge"; when a
change grows large, split it into smaller PRs "that each serve one purpose". Working heuristic
(judgment, not a sourced number): if a reviewer can't hold the diff in one
sitting, or your description needs "also", split.

**Description structure** — it's a briefing, not a commit-log paste:

1. **What & why** — the problem, the approach, why this approach (1–3 paragraphs).
2. **Review order** — for multi-file diffs, tell the reviewer where to start
   ("start with the schema change; everything else is fallout").
3. **Linked issues** — `Closes #N` / `Fixes #N` auto-close the issue only on
   merge into the repo's default branch; on any other base the keyword is
   ignored and no link is created, so it fails silently for stacked PRs
   (verify: GitHub Docs → "Linking a pull request to an issue").
4. **Verification** — what you ran and what it showed (test output, screenshots
   for UI); a reviewer shouldn't have to re-derive your evidence.
5. **Out of scope** — adjacent work deliberately not done, so review comments
   don't relitigate it.
6. **Checklist** — a `## Checklist` section of top-level task items: template
   items first, then the required checks and code review. Tick an item only on
   evidence for the pushed head; the order, defaults, and rules are in
   [references/pull-request-checklist.md](references/pull-request-checklist.md).

**Self-review before requesting review** — open your own diff in the PR view and
read it as the reviewer: leave inline comments on anything non-obvious you'd
question in someone else's PR, catch debug leftovers/stray files/missing tests,
and check the security/CI signals before a human spends time on it. Self-review is
also the moment you notice the PR is two PRs. Use a draft PR until it's ready —
CI runs, but nobody is summoned.

**When to split a PR:**

| Signal | Split |
|---|---|
| Mechanical noise (rename, format, codegen) buries the behavioral diff | mechanical PR first — near-zero review cost — then the real change |
| Two reviewers needed for two unrelated areas | one PR per area of ownership |
| A risky core change + safe periphery | land periphery first; keep the risky diff small and alone |
| Dependent changes stack up | stacked PRs, each targeting the previous branch; retarget as they merge (after explicit user confirmation, `--update-refs` keeps the stack rebased) |

## Squash vs merge vs rebase

The three GitHub merge methods (re-verify:
<https://docs.github.com/en/pull-requests/reference/pull-request-merges>).
Each method, merge commits included, can be allowed or disabled per repo, and a
merge queue or ruleset can fix the method; follow the repo's configured norm.

| Method | History result | Caveats |
|---|---|---|
| Merge commit (default) | all branch commits + a merge commit (`--no-ff`) | history keeps WIP noise unless the branch was curated — pairs with atomic-commit series worth preserving |
| Squash and merge | one commit on the base branch | default message: single-commit PR → that commit's title+body; multi-commit → PR title + list of subjects (repo-configurable). **Continuing work on the squashed branch re-introduces its commits in the next PR and breeds conflicts** — start a fresh branch after squash-merge |
| Rebase and merge | branch commits replayed linearly, no merge commit | **always updates committer info and creates new SHAs**, even where a local rebase onto an ancestor keeps the committer; drops originally-empty commits; results are unsigned (no signature verification); not offered when GitHub can't rebase safely |

Choosing: curated atomic commits deserve merge-commit or rebase (squash flattens
the series you built); a messy WIP branch is exactly what squash is for — put the
craft into the PR title/description, which become the squashed message.

## Gotchas

| Gotcha | Consequence | Right move |
|---|---|---|
| `git commit -am` as reflex | stages everything tracked — unrelated edits ride along | `git add -p`, review `git diff --cached`, then commit |
| Amending or rebasing after pushing to a shared branch | collaborators' pulls diverge; their work needs manual rescue | never rewrite shared history; on your own PR branch, rewrite only after explicit user confirmation and use `--force-with-lease` |
| Conventional-commit type chosen by vibe (`chore` for a bug fix) | release tooling mis-versions or drops the change from the changelog | `fix`/`feat` per actual effect; check what the repo's tooling parses |
| PR description = pasted commit list | reviewer gets no narrative, reads the diff cold | write the briefing (what/why, review order, verification) |
| Force-pushing a rewrite mid-review | reviewer's inline comments detach; they re-review from scratch | push fixup commits during review; after explicit confirmation, fold them at merge time |
| Merging with "fixup!" commits still unfolded | noise commits land on the base branch permanently | after explicit confirmation, `rebase -i --autosquash` before merge, or use squash-merge |
| Splitting so far that a commit is not independently green | bisect lands on red commits; revert takes multiple steps | the green-tree constraint bounds the split |

## Verification

Before pushing a commit series, check it stands on its own — no kit tooling
required (use the project's CI/validators too, if present):

```bash
git log --oneline @{upstream}..     # each subject: imperative, one idea, no "and"
git rebase --exec '<project build+test+lint>' @{upstream}   # after confirmation; green at every commit
git diff @{upstream}.. --stat       # size sanity: is this one reviewable unit?
```

## Sources

- Conventional Commits v1.0.0 — <https://www.conventionalcommits.org> (spec version,
  type/SemVer mapping, `!` and `BREAKING CHANGE` footer, footer separators).
- GitHub Docs, "Helping others review your changes" — small/focused/single-purpose,
  self-review, review-order guidance.
- GitHub Docs, "Pull request merges" and "About merge methods on GitHub" —
  per-repo method settings, squashed-branch re-inclusion caveat, rebase-merge
  committer/SHA, empty-commit, and signature caveats.
- GitHub Docs, "Configuring commit squashing for pull requests" — squash
  default-message behavior
  (<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests>).
- `git-rebase(1)` — `--autosquash`, `rebase.autoSquash`, `--exec`, `--update-refs`;
  `git-commit(1)` — `--fixup=amend:`/`reword:` (re-verify against your installed
  Git's man pages).
- `git-interpret-trailers(1)` — the trailer block is the last paragraph. A
  paragraph with non-trailer lines counts only when at least 25% of its lines are
  trailers and one is git-generated or user-configured
  (<https://git-scm.com/docs/git-interpret-trailers>).

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks-kit repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
