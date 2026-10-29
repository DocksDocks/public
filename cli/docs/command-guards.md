# Command guards

The kit ships one destructive-command policy to omp, Claude Code, and Codex.
The short rule for agents: **to remove, use the trash**. Run
`gio trash -- <path>` on Linux or `trash <path>` on macOS. In omp, remove a
temporary file or directory with `docks-kit scratch remove <path>` instead.
To remove a path from the git index, run `git rm -- <path>`.

The policy follows one principle: **fail closed**. A command is allowed only
in a canonical form that is safe by construction. Every other form that could
force, empty, or delete asks. Where omp's critical-command check acts, the
form is denied instead. omp also denies a `git push` ref that a `$` variable
or a backtick substitution supplies, because the agent can always write that
ref literally. A false positive in the ask tier is accepted. omp is
the exception for file removal: by owner decision, omp runs any removal that
it does not deny without a prompt. omp still asks before a removal that loses
history: `git clean`, `git reset --hard`, and a force push. omp also asks
before a git command that skips the repository's hooks.

The policy sorts shell commands into three tiers:

- **Deny**: the command never runs, and nobody can approve it in the session.
- **Ask**: the command needs approval before it runs.
  - omp asks a person in the main session. omp runs subagents headless, so it
    rejects every ask in a subagent.
  - Claude Code asks a person, even in auto mode.
  - Codex sends the prompt to the approvals reviewer in the kit's
    `config.toml`. That reviewer is `auto_review`, a reviewer subagent, so a
    Codex ask can be approved without a person.
- **Allow**: the agent may run the command alone.

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
| Any other `rm`: one file, several files, a glob, `-f` | allow | glob asks; the rest goes to the classifier | ask |
| `find ... -delete`, `find ... -exec rm` (also `-execdir`, `-ok`, `-okdir`), `xargs rm` | deny, in every position and by path | ask | ask (every `find` asks) |
| `git clean`, `git reset --hard` | ask | ask | ask |
| `git push` that could force: see below | ask | ask | ask (every `git push` asks) |
| A word after `git push` that starts with `$` or a backtick | deny, also after a shell keyword, a wrapper, or a path before `git`: see below | ask | ask (every `git push` asks) |
| A git command that skips the repository's hooks: see below | ask | no rule; the classifier decides | ask for each `git push`, `git merge`, and `git rebase` that starts the command; no rule for `git commit`, `git am`, or `git pull` |
| `git rm -- <path>`, `git worktree remove -- <path>` | allow | ask | ask |
| `git worktree remove --force -- <path>` | allow; the omp prompt permits it once, after the commits are on the remote | ask | ask |
| `docks-kit scratch remove <path>` | allow; the command removes only a path inside the scratch root, the system temporary directory, or `/var/tmp` | no rule | no rule |
| Any other non-recursive `git rm` or `git worktree remove` | allow | ask | ask |
| `gio trash -- <path>` | allow | allow | ask |
| Any other `gio trash` | allow | ask with `--empty` or `--restore`; the rest goes to the classifier | ask |
| `trash <path>` (macOS) | allow | allow | allow |

A `git push` asks when it holds any of these words:

- a `+` refspec;
- any long option that starts with `--f`, such as `--force`,
  `--force-with-lease`, or an abbreviation like `--for`;
- `--mirror` or an abbreviation of it;
- `-f`, or a short-option cluster that starts with two of git push's
  no-argument flags (`v`, `q`, `d`, `n`, `u`, `4`, `6`, `f`), such as `-vf`,
  `-vvf`, or `-uvfq`;
- in Claude Code, a word that starts with `$`, a backtick, a quote, or a
  backslash. omp denies a word that starts with `$` or a backtick instead.

Each of these must begin a word: `feat/cache-vf` is a branch name, not an
option. `--follow-tags` also asks. This is an accepted false positive, because
it shares the `--f` prefix.

A word that starts with `$` or a backtick hides the ref until the shell
expands it, so the matcher cannot tell `$b` from `+main` or `--force`. omp
never applies an allow rule to a command that holds a `$` that the shell
expands, so the kit cannot add an exception for a plain branch name. omp
therefore denies this form instead of asking. The agent reads the refusal,
`Blocked by bash pattern: *git push * $*`, writes the ref literally, and runs
the push without a question. The omp agent prompt names the literal forms:
`git push -u origin HEAD` for the current branch, and
`git push origin --delete <branch-a> <branch-b>` for several branches. Each of
these omp rules starts with `*`, so a shell keyword such as `do` in a loop, a
wrapper such as `env`, or a path such as `/usr/bin/git` does not hide the push.

## Commands that skip the repository's hooks

In omp, a command asks when it can skip the repository's hooks. Each of
these rules also matches after a word before `git`, such as `X=1`, `env`,
`timeout`, or a path like `/usr/bin/git`:

- a word after `git` that starts with `--no-v`. Git accepts each unique
  prefix of `--no-verify`, and `git am` accepts the shortest, `--no-v`. This
  covers `git push`, `git commit`, `git merge`, `git pull`, `git rebase`, and
  `git am`, also after `git -C <dir>`;
- `-n`, or a short-option cluster that starts with two no-argument options,
  in `git commit` or `git am`. Both read `-n` as `--no-verify`, also inside a
  cluster such as `-anm`. The no-argument options are `q`, `v`, `s`, `e`, `a`,
  `i`, `p`, `o`, `n`, and `z` for `git commit`, and `i`, `n`, `3`, `q`, `s`,
  `u`, `k`, `m`, `c`, and `r` for `git am`;
- `core.hooksPath` or `core.hookspath` after `git`, as in `git -c`,
  `git --config-env`, or `git config`;
- `GIT_CONFIG_COUNT` or `GIT_CONFIG_PARAMETERS` anywhere in the line, in any
  assignment form such as `=`, `+=`, or `export`. These variables can
  override any configuration key, `core.hooksPath` included, whatever its
  spelling. A line that sets them does not start with `git`, and a
  `GIT_CONFIG_PARAMETERS` entry keeps its inner quotes, as in
  `'core.hooksPath'='/dev/null'`.

`git commit -m x`, `git commit -am x`, `git commit -sm x`, and
`git commit -mn x` (the message `n`) run without a prompt. These forms ask as
accepted false positives:

- another option that starts with `--no-v`, such as `--no-verbose`,
  `--no-verify-signatures`, or `git send-email --no-validate`;
- a cluster of two no-argument options without `n`, such as
  `git commit -aqm x`;
- a read such as `git config --get core.hooksPath`. To read the hooks
  directory without a prompt, run `git rev-parse --git-path hooks`;
- message or search text that holds ` -n`, a two-letter cluster, or `--no-v`,
  such as `git commit -m "use head -n 5"` or `git grep -- --no-verify`. Write
  such a message with `git commit -F <file>`;
- a line with a later command, because omp tests the whole line:
  `git commit -m x && git log -n 1` asks. Run the commit as its own command.

## Why the tools differ

| Topic | omp | Claude Code | Codex |
| --- | --- | --- | --- |
| Rule order | First match wins | Deny, then ask, then allow, whatever the order | Strictest matching rule wins |
| Exception for one form | An allow before a broader prompt works; the kit ships no such exception now | An allow never beats a matching ask, so every `git rm` asks | An allow never beats a matching prompt, so every `gio trash` asks |
| Pattern | Glob on the whole line and on each quote-stripped segment; `*` crosses spaces; no literal `*` | Glob on each subcommand as written, quotes included; `\*` is a literal `*` | Exact argv tokens from the start, with alternatives |
| `rm` by path (`/bin/rm`) | Matched by `*/rm` forms | Matched by `*/rm` forms | Resolved to the `rm` rules |
| Leading assignment `X=1 cmd` | Part of the line | Stripped before deny and ask rules | A script with it is not split |
| What an ask means | A person in the main session; rejected in a subagent | A person | The `auto_review` reviewer subagent |
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
  - Deny and prompt rules test the whole line and each segment between `;`,
    `&&`, `|`, and similar operators, with quotes and escapes removed. So
    `rm -rf "$HOME"` matches `rm * $HOME`.
  - Allow rules apply only to a simple command.
  - The kit lists rules as deny, then prompts, then the `trash *` allow.
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
  as its own command. In the same way, `git push origin HEAD && echo $?` is
  denied, because a word that starts with `$` follows `git push` on the line.
  Run `git push` as its own command.
- **omp, text arguments**: the critical-shape deny also matches text such as
  `git commit -m "rm -f /tmp/x"`. Write such a message with `git commit -F`.
- **omp, critical patterns in a line**: a line that holds one of omp's other
  critical patterns turns any matching prompt rule on that line into an
  allow. This applies to a compound line, such as one with `curl ... | sh`,
  and to message text: `git commit -n -m "fix reboot loop"` runs, because
  `reboot`, `shutdown`, `halt`, `mkfs`, `cryptsetup`, and `init 0` are
  critical words.
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
- **`git -C`**: no tool matches a git subcommand that does not follow `git`
  directly, such as `git -C . push --force` or `git -C . push origin $b`. omp
  also lets `git -C . commit -n` run without a prompt. In omp, the
  `--no-verify` and `core.hooksPath` forms still ask after `git -C`.
- **omp, `core.hooksPath` spelling**: git reads section and variable names
  without case, but omp matches with case. A key in another case, such as
  `CORE.HOOKSPATH` or `Core.HooksPath`, after `git -c`, `git --config-env`, or
  `git config` runs without a prompt.
- **omp, configuration files**: a configuration file can set
  `core.hooksPath` without a rule seeing the key. This includes a file named
  through `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, `XDG_CONFIG_HOME`,
  `include.path`, or `includeIf`, and a direct edit of `.git/config`. The kit
  does not ask for these variables, because test scripts set
  `GIT_CONFIG_GLOBAL=/dev/null` routinely.
- **omp on Windows, variable names**: Windows reads variable names without
  case, so a name such as `git_config_count` also overrides configuration and
  runs without a prompt.
- **omp, git aliases**: an alias for `commit` or `am`, such as `git ci -n` or
  `git -c alias.ci=commit ci -n`, runs without a prompt.
- **omp, other hook skips**: no rule covers a hook-manager switch, such as
  `HUSKY=0`, `SKIP=...`, or `LEFTHOOK=0`, or a change to the files in the
  hooks directory. `git commit --no-post-rewrite` also runs: the
  `post-rewrite` hook runs after the commit and cannot stop it. The deployed
  omp prompt forbids each hook skip.
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
    4. kit allow exceptions (the kit allows listed before the first kit
       prompt; the kit currently ships none);
    5. kit prompt;
    6. the other user rules;
    7. kit allow.
  - A user deny or prompt thus precedes every kit allow, and no allow can
    loosen a deny or a prompt.
  - A repeat sync changes nothing.
  - After the merge, `ompRemovals.ts syncOmpRemovals, retired bash-rule
    inventory` removes the retired kit rules in `OMP_RETIRED_BASH_RULES` from
    the deployed `bash.patterns` on every sync. It removes a rule only when
    its `match` and `approval` equal a retired pair, so a different user rule
    stays.
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
  https://git-scm.com/docs/git-am (`-n`), https://git-scm.com/docs/git
  (`-c`, `--config-env`), and https://git-scm.com/docs/git-config (names
  without case, `GIT_CONFIG_COUNT`, `GIT_CONFIG_PARAMETERS`,
  `GIT_CONFIG_GLOBAL`).
- macOS `trash`: https://keith.github.io/xcode-man-pages/trash.8.html
