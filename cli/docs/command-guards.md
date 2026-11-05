# Command guards

The kit ships one destructive-command policy to omp, Claude Code, and Codex.
The short rule for agents: **to remove, use the trash**. Run
`gio trash -- <path>` on Linux or `trash <path>` on macOS. In omp, remove a
temporary file or directory with `docks-kit scratch remove <path>` instead.
To remove a path from the git index, run `git rm -- <path>`.

Claude Code and Codex follow one principle: **fail closed**. A command is
allowed only in a canonical form that is safe by construction, and every other
form that could force, empty, or delete asks. omp keeps only the deny part of
that principle. Where omp's critical-command check acts, the form is denied
instead of asked. omp also denies a `$` or a backtick after `git push`,
because the agent can always write the ref literally. A false positive in the
ask tier is accepted.

omp is the exception: by owner decision (0.22.8, #126), the kit ships no omp
prompt rule. The kit's `bash.patterns` holds only deny rules and the `trash *`
allow. Under the kit's `tools.approvalMode: yolo`, omp runs every command
that no deny matches without a question, in the main session and in
subagents. This includes any `rm` that omp does not deny, `git clean`,
`git reset --hard`, a force push that no deny matches, and a git command
that skips the repository's hooks. A prompt rule that the user adds to
`~/.omp/agent/config.yml` survives sync and still asks; a subagent rejects
it. The deployed omp agent prompt forbids `--force`, `-f`, and their
abbreviations with `git push`, and it forbids each hook skip. It tells the
agent to use `ask` before a force push, and to ask the user before
`git clean` or `git reset --hard`.

The policy sorts shell commands into three tiers. omp uses two of them: deny
and allow.

- **Deny**: the command never runs, and nobody can approve it in the session.
- **Ask**: the command needs approval before it runs. The kit ships no omp
  rule in this tier.
  - Claude Code asks a person, even in auto mode.
  - Codex sends the prompt to the approvals reviewer in the kit's
    `config.toml`. That reviewer is `auto_review`, a reviewer subagent, so a
    Codex ask can be approved without a person.
- **Allow**: the agent may run the command alone. In omp, a command that no
  rule matches runs too. The table below calls this `run`.

The omp `eval` tool stays unrestricted: `bash.patterns` does not gate a shell
that `eval` starts.

## Tiers per tool

| Command | omp `bash.patterns` | Claude Code `permissions` | Codex `docks.rules` |
| --- | --- | --- | --- |
| `rm` of `/`, `~`, `~/`, `$HOME`, `${HOME}`, quoted or with a trailing `/` | deny | deny, also through `/bin/rm` and other `*/rm` paths | deny `/` as argv; deny the exact scripts listed in `docks.rules` |
| `rm` of `/*` | deny with an `r` or `f` option; plain `rm /*` runs | deny | deny the exact scripts listed |
| `HOME=...`, `export HOME=...`, `env HOME=...` | deny | deny `export`, `env`, and a bare `HOME=...` line; `HOME=... cmd` goes to the classifier | deny `export HOME=$(mktemp -d)` and three spellings; `env` asks |
| `sudo` before `rm`, plain or by path (`/usr/bin/sudo`) | deny | deny (`sudo *`, `*/sudo *`) | deny (`sudo`, resolved by path) |
| `git push --force` or `-f` to `origin main` or `origin master` | deny | deny | deny |
| Recursive `rm` (`-r`, `-R`, `-rf`, `-fr`, `-rfv`, `-ri`, `-ir`, `-Ri`, `-iR`, `--recursive`, other listed clusters) | deny, also behind any prefix (`env`, `xargs`, `nice`, `find -exec`, `git rm -r`) | ask | ask (every `rm` asks) |
| `rm` with an `r` or `f` option before an absolute path, `--no-preserve-root` | deny | ask if recursive, else classifier | ask |
| Any other `rm`: one file, several files, a glob, `-f` | run | glob asks; the rest goes to the classifier | ask |
| `find ... -delete`, `find ... -exec rm` (also `-execdir`, `-ok`, `-okdir`), `xargs rm` | deny, in every position and by path | ask | ask (every `find` asks) |
| `git clean`, `git reset --hard` | run | ask | ask |
| `git push` that could force: see below | run, unless a deny above matches | ask | ask (every `git push` asks) |
| A `$` or a backtick anywhere after `git push` in the same command | deny, also after a shell keyword, a wrapper, or a path before `git`: see below | ask for a word that starts with `$` or a backtick | ask (every `git push` asks) |
| A git command that skips the repository's hooks: see below | run | no rule; the classifier decides | ask for each `git push`, `git merge`, and `git rebase` that starts the command; no rule for `git commit`, `git am`, or `git pull` |
| `git rm -- <path>`, `git worktree remove -- <path>` | run | ask | ask |
| `git worktree remove --force -- <path>` | run; the omp agent prompt permits it once, after the commits are on the remote | ask | ask |
| `docks-kit scratch remove <path>` | run; the command removes only a path inside the scratch root, the system temporary directory, or `/var/tmp` | no rule | no rule |
| Any other non-recursive `git rm` or `git worktree remove` | run | ask | ask |
| `gio trash -- <path>` | run | allow | ask |
| Any other `gio trash` | run | ask with `--empty` or `--restore`; the rest goes to the classifier | ask |
| `trash <path>` (macOS) | allow | allow | allow |

In Claude Code, a `git push` asks when it holds any of these words. Codex
asks for every `git push`. omp runs each of these forms. Its force-push deny
matches only `git push --force` or `git push -f` directly before
`origin main` or `origin master`:

- a `+` refspec;
- any long option that starts with `--f`, such as `--force`,
  `--force-with-lease`, or an abbreviation like `--for`;
- `--mirror` or an abbreviation of it;
- `-f`, or a short-option cluster that starts with two of git push's
  no-argument flags (`v`, `q`, `d`, `n`, `u`, `4`, `6`, `f`), such as `-vf`,
  `-vvf`, or `-uvfq`;
- a word that starts with `$`, a backtick, a quote, or a backslash. omp
  denies a `$` or a backtick anywhere after `git push`.

Each of these must begin a word: `feat/cache-vf` is a branch name, not an
option. In Claude Code, `--follow-tags` also asks. This is an accepted false
positive, because it shares the `--f` prefix.

A `$` or a backtick hides the ref until the shell expands it, so the matcher
cannot tell `$b` from `+main` or `--force`. An unquoted value inside a word
also splits into more words: with `b="main --force"`, `HEAD:$b` becomes
`HEAD:main --force`. omp never applies an allow rule to a command that holds a
`$` that the shell expands. So the kit cannot add an exception for a plain
branch name.

omp therefore denies a `$` or a backtick anywhere after `git push` in the same
command. The agent reads a refusal such as
`Blocked by bash pattern: *git push *$*`, writes the ref literally, and runs
the push without a question. The omp agent prompt names the literal forms:
`git push -u origin HEAD` for the current branch, and
`git push origin --delete <branch-a> <branch-b>` for several branches. The two
omp rules start with `*`. So a shell keyword such as `do` in a loop, a wrapper
such as `env`, or a path such as `/usr/bin/git` does not hide the push.

## Commands that skip the repository's hooks

A git command can skip the repository's hooks, for example with
`--no-verify`, `git commit -n`, `git am -n`, or a `core.hooksPath` change.
The kit ships no omp rule for these commands, so omp runs them without a
question. The deployed omp agent prompt forbids each hook skip. Claude Code
has no rule either, so its classifier decides. Codex asks for each
`git push`, `git merge`, and `git rebase` that starts the command. Codex has
no rule for `git commit`, `git am`, or `git pull`.

## Why the tools differ

| Topic | omp | Claude Code | Codex |
| --- | --- | --- | --- |
| Rule order | First match wins | Deny, then ask, then allow, whatever the order | Strictest matching rule wins |
| Exception for one form | The kit ships no omp prompt rule, so it needs no exception | An allow never beats a matching ask, so every `git rm` asks | An allow never beats a matching prompt, so every `gio trash` asks |
| Pattern | Glob on the whole line and on each quote-stripped segment; `*` crosses spaces; no literal `*` | Glob on each subcommand as written, quotes included; `\*` is a literal `*` | Exact argv tokens from the start, with alternatives |
| `rm` by path (`/bin/rm`) | Matched by `*/rm` forms | Matched by `*/rm` forms | Resolved to the `rm` rules |
| Leading assignment `X=1 cmd` | Part of the line | Stripped before deny and ask rules | A script with it is not split |
| What an ask means | The kit ships no ask; a user prompt rule asks a person in the main session, and a subagent rejects it | A person | The `auto_review` reviewer subagent |
| Critical-command check | Turns a prompt into an allow under yolo, so the kit denies those shapes | Asks or denies for an `rm` of a critical path | Prompts for a forced `rm` that no rule matches |

## How an agent removes files

1. In omp, remove a temporary file or directory with the `scratch_remove`
   tool or `docks-kit scratch remove <path>`. The command removes only a path
   inside the scratch root, the system temporary directory, or `/var/tmp`.
   `gio trash` does not trash on a system internal mount, such as a `tmpfs`
   `/tmp`.
2. Move every other file or directory to the trash with `gio trash -- <path>`
   on Linux or `trash <path>` on macOS. The `--` ends option parsing, so `gio`
   reads every later argument as a path, and a path such as `--empty` cannot
   empty the trash. In Claude Code and Codex, leave a temporary file in
   `/tmp`; the system clears it.
3. To remove a path from the git index, run `git rm -- <path>`. To remove a
   worktree, run `git worktree remove -- <path>`. In omp, when git refuses
   because the worktree has changes, the agent may pass `--force` once, after
   each commit is on the remote and `git status --porcelain` lists only
   generated files. Never pass `--force` two times.
4. In omp, do not use `rm`. omp denies a recursive `rm`, `find -delete`,
   `find -exec rm`, and `xargs rm`. It runs any other `rm` without a prompt.
5. In Claude Code and Codex, use `rm <file>` without flags only for one file
   that the agent created.
6. For a recursive or bulk deletion, ask the user in the main session. A
   subagent lists the paths in its final report. In omp, the user runs a
   recursive deletion by hand.
7. Write literal absolute paths. Never use `~` or `$HOME`, and never set or
   export `HOME`.

The deployed agent prompts (`~/.omp/agent/AGENTS.md`, `~/.claude/CLAUDE.md`,
and the Codex `AGENTS.md`) carry the same rules.

### What the git removals keep

- `git rm` without `--force` refuses a file whose content differs from the
  last commit. The removed content stays in the repository history.
- `git worktree remove` without `--force` refuses a worktree with untracked
  files or tracked changes. It does delete the files that `.gitignore` covers,
  such as `node_modules`, build output, or a local `.env`. Git keeps no copy of
  those files.
- Git accepts an abbreviated long option, such as `--for` for `--force`, and a
  short-option cluster, such as `-rff`. After `--`, git reads every argument as
  a path. So the `--` form is the only one that cannot force.

## Why omp denies instead of asking

omp has a built-in check for critical commands. For example, it flags:

- an `rm` with an `r` or `f` option before an absolute path;
- `sudo rm`, also when `sudo` is called by its path.

For a critical command, omp returns a bare safety override before it returns
a matching prompt rule. Under the kit's `tools.approvalMode: yolo`, omp
ignores a bare override, so the command runs. This applies in subagents too.
Only a deny rule stops a critical command (`omp://approval-mode.md`).

The kit therefore denies every `rm` shape that the check can flag:

- a recursive `rm`;
- an `rm` with an option that holds `r` or `f` before an absolute path;
- `sudo` anywhere before `rm`;
- `--no-preserve-root`.

The kit also denies bulk removal through `find -delete`, `find -exec rm`, and
`xargs rm`. omp's critical check does not flag these forms, but they can empty
the home directory, and no glob can express "inside the temporary directory".
`docks-kit scratch remove` checks the path in code instead.

## Matching rules per tool

- **omp**:
  - The rules are ordered, and the first match wins.
  - `*` matches any text, spaces included, and no escape spells a literal `*`.
  - Deny rules test the whole line and each segment between `;`, `&&`, `|`,
    and similar operators, with quotes and escapes removed. So
    `rm -rf "$HOME"` matches `rm * $HOME`.
  - Allow rules apply only to a simple command.
  - The kit ships no prompt rule. It lists rules as deny, then the `trash *`
    allow.
- **Claude Code**:
  - Deny beats ask, and ask beats allow, whatever the order.
  - The rules match the command text as written, quotes included, so the kit
    lists each quoted spelling. `\*` is a literal `*`.
  - Claude Code strips wrappers such as `timeout` and bare `xargs`. It matches
    deny and ask rules past a leading variable assignment, and it applies them
    to every subcommand.
  - A rule for `rm` does not match `/bin/rm`, so the kit adds `*/rm` forms.
- **Codex**:
  - A rule matches argv tokens from the start, and the strictest matching rule
    wins.
  - Codex splits a `bash -lc` script into argv only when every word is a plain
    literal. A script with `~`, `$HOME`, a glob, or a substitution stays one
    `[shell, -lc, script]` invocation, so a rule can match only that exact
    script.
  - Codex resolves `/bin/rm` and `/usr/bin/sudo` to the `rm` and `sudo` rules.

## Gaps

- **omp, literal `*`**: omp cannot match a literal `*`, so it cannot tell a
  glob from a file name. The kit therefore runs every `rm` that it does not
  deny without a prompt. This includes `rm ~/*`, `rm $HOME/*`, and `rm /*`
  without an `r` or `f` option, because a deny rule for them would also deny
  `rm ~/notes.txt` (owner decision, 0.20.9).
- **omp, whole-line matching**: omp tests deny rules against the whole command
  line too, so a pattern can span commands. For example, `rm x && cd ~`,
  `rm -i a && ls -R /tmp`, and `sudo apt update && rm x` are denied. Run `rm`
  as its own command. In the same way, a `$` or a backtick after `git push`
  denies the whole command, such as `git push origin HEAD && echo $?`. omp
  joins the lines of a command first, so `echo $?` on a later line is denied
  too. Run `git push` as its own command.
- **omp, text arguments**: the critical-shape deny also matches text such as
  `git commit -m "rm -f /tmp/x"`. The `git push` deny matches text that names
  `git push` before a `$`, such as `git commit -m "git push $b fails"`. Write
  such a message with `git commit -F`.
- **omp, prefixed `rm`**: the kit denies a recursive `rm` behind any prefix,
  such as `env X=1 rm -rf b`, `xargs rm -rf`, `find . -exec rm -rf {} +`, or
  `git rm -r dir`. A `* rm ` rule also matches text, so a line such as
  `echo do not rm -rf b` is denied too.
- **omp, bulk-removal text**: the `* find *-delete*`, `*-exec rm *`, and
  `*xargs rm` rules also match text, so a line such as
  `echo use find with -delete` is denied. Write such text to a file instead.
- **Recursive `rm` clusters**: omp and Claude Code match only the listed
  recursive-`rm` clusters. In omp, these are `r` or `R` alone or with `f` and
  `v`, plus `-ri`, `-ir`, `-Ri`, and `-iR`. In Claude Code, they are `r` or `R`
  alone or with `f` and `v`. Another cluster falls back to the tool's next
  tier. In omp, the command runs. In Claude Code, the classifier decides.
- **`git push` beyond the listed words**: a configured `+` refspec in
  `remote.<name>.push` makes a plain `git push` force. No rule sees git
  configuration. `git push --delete` and `git push --prune` remove remote
  branches without force; they ask only in Codex.
- **omp, force push to `main` in another spelling**: the force-push deny
  rules match only `git push --force` or `git push -f`, then
  `origin main` or `origin master`. Every other force push to `main` runs
  without a question, such as `git push origin main --force`,
  `git push -vf origin main`, `git push --force-with-lease origin main`,
  `git push origin +main`, `git push -f origin HEAD:main`, or
  `git push --mirror origin`. Until 0.22.8 these forms asked.
- **omp, force push after a prefix**: the force-push deny rules start with
  `git push`, not `*`. So a force push to `origin main` after a shell keyword,
  a wrapper, or a path runs without a check, such as
  `for r in a; do git push --force origin main; done`,
  `env git push --force origin main`, or `/usr/bin/git push --force origin main`.
- **`git -C`**: no tool matches a git subcommand that does not follow `git`
  directly, such as `git -C . push --force origin main` or
  `git -C . push origin $b`.
- **Claude Code, `HOME=` before a command**: Claude Code matches deny rules
  past a leading assignment. So `HOME=/tmp/x cmd` reaches the classifier.
  `export HOME=...`, `env HOME=...`, a bare `HOME=...` line, and any `rm` of
  `$HOME` stay denied.
- **Claude Code, unlisted `rm` forms**: a multi-file `rm` and an `rm -f` of
  one file go to the auto-mode classifier. Claude Code does not strip `env`, so
  `env X=1 rm -rf ~` also goes to the classifier.
- **Claude Code, `gio trash`**: a `gio trash` form other than `-- <path>` that
  holds neither `--empty` nor `--restore` goes to the classifier. GLib's
  `gio trash` supports no abbreviated long options.
- **Codex, scripts**: a home or root deletion inside a longer script, such as
  `cd x && rm -rf ~`, falls to Codex's built-in forced-`rm` prompt and to the
  sandbox. Codex matches `HOME=` reassignment only as an exact script, and
  `export HOME=/tmp` runs sandboxed. Each Codex command runs in a new shell.
- **Codex, prompt reviewer**: a Codex prompt reaches the `auto_review`
  reviewer subagent, not always a person.
- **All tools**: no rule covers a program that removes files itself, such as a
  Python or Node script, or a shell started by omp `eval`.

### How `gio trash` empties the trash

GLib's `gio trash` handles operands first. With at least one path, it trashes
or restores the paths, and `--empty` has no effect. Without a path, it empties
the trash when `--empty` is set. `-f` can repeat. So `gio trash -ff --empty`
empties the trash, while `gio trash build --empty` only trashes `build`.

In Codex, every `gio trash` asks, because a prefix rule cannot tell
`-ff --empty` from `-- <path>`. In omp, every `gio trash` runs without a
prompt. In Claude Code, any form with `--empty` or `--restore` asks.

## Sync behavior

- **omp**:
  - The config merge keeps user `bash.patterns` rules and groups all rules in
    this order:
    1. kit deny;
    2. user deny;
    3. user prompt;
    4. kit prompt (the kit ships none since 0.22.8);
    5. the other user rules;
    6. kit allow.
  - A user deny or prompt thus precedes every kit allow, and no allow can
    loosen a deny or a prompt.
  - A repeat sync changes nothing.
  - After the merge, `ompRemovals.ts syncOmpRemovals, retired bash-rule
    inventory` removes the retired kit rules in `OMP_RETIRED_BASH_RULES` from
    the deployed `bash.patterns` on every sync. The inventory also holds the
    492 prompt rules that the kit retired in 0.22.8. It removes a rule only
    when its `match` and `approval` equal a retired pair, so a different user
    rule stays.
- **Claude Code**: sync unions each permissions array with the deployed one,
  so user rules stay. `--reconcile` replaces the arrays with the SoT arrays.
- **Codex**: sync writes `~/.codex/rules/docks.rules` whole. Keep your own
  rules in another `.rules` file, such as `default.rules`. Codex applies the
  strictest rule across all files.

## Check the deployed rules

Each check below is safe, because the shell never reaches `rm`.

- **Codex**: run
  `codex execpolicy check --pretty --rules ~/.codex/rules/docks.rules -- rm -rf /`.
  It prints the decision and runs nothing.
- **omp and Claude Code**: ask the agent to run `true || rm -rf "$HOME"`. The
  `true ||` short-circuit stops the shell before `rm`. omp reports
  `Blocked by bash pattern: rm * $HOME`, and Claude Code reports a denial.

## Sources

- omp: `omp://tools/bash.md`, `omp://approval-mode.md`, and the
  `@oh-my-pi/pi-coding-agent` 18.11.1 source `src/tools/bash.ts`
  (`CRITICAL_BASH_PATTERNS`, `BashTool.approval`).
- Claude Code: https://code.claude.com/docs/en/permissions and
  https://code.claude.com/docs/en/permission-modes
- Codex: https://learn.chatgpt.com/docs/agent-configuration/rules,
  https://github.com/openai/codex/blob/main/codex-rs/execpolicy/README.md, and
  https://learn.chatgpt.com/docs/config-file/config-reference (`approvals_reviewer`).
- GLib `gio trash`: https://github.com/GNOME/glib/blob/main/gio/gio-tool-trash.c
- Git: https://git-scm.com/docs/gitcli (abbreviated and clustered options),
  https://git-scm.com/docs/git-rm, https://git-scm.com/docs/git-worktree,
  https://github.com/git/git/blob/master/builtin/push.c (short options), and
  https://github.com/git/git/blob/master/builtin/worktree.c
  (`remove_worktree` parses `--`; `check_clean_worktree` runs
  `git status --porcelain` without `--ignored`).
- Git hooks: https://git-scm.com/docs/githooks (`--no-verify`,
  `core.hooksPath`), https://git-scm.com/docs/git-commit and
  https://git-scm.com/docs/git-am (`-n`).
- macOS `trash`: https://keith.github.io/xcode-man-pages/trash.8.html
