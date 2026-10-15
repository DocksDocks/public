# Command guards

The kit ships one destructive-command policy to omp, Claude Code, and Codex.
The short rule for agents: **to remove, use the trash**. Run
`gio trash -- <path>` on Linux or `trash <path>` on macOS.

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
| `rm` of `/`, `~`, `~/`, `$HOME`, `${HOME}`, quoted or with a trailing `/` | deny | deny, also through `/bin/rm` and other `*/rm` paths | deny for `/` as argv; deny for the exact scripts listed in `docks.rules` |
| `rm` of `/*` | deny when it has an option; plain `rm /*` asks | deny | deny for the exact scripts listed |
| `HOME=...`, `export HOME=...`, `env HOME=...` | deny | deny `export` and `env`; `HOME=... cmd` goes to the classifier (gap) | deny `export HOME=$(mktemp -d)` and three spellings; `env` asks |
| `git push --force` or `-f` to `origin main` or `origin master` | deny | deny | deny |
| Recursive `rm` (`-r`, `-R`, `-rf`, `-fr`, `-rfv`, `--recursive`, other listed clusters) | deny | ask | ask (every `rm` asks) |
| `sudo rm`, any `rm` with an option before an absolute path, `--no-preserve-root` | deny | `sudo` is denied; the rest asks if recursive, else classifier | ask (every `rm` asks); `sudo` is denied |
| Any other `rm`: one file, several files, a glob, `-f` | ask | glob asks; the rest goes to the classifier | ask |
| `find ... -delete`, `find ... -exec rm` | ask | ask | ask (every `find` asks) |
| `git clean`, `git reset --hard` | ask | ask | ask |
| Force push to any branch: `--force*`, `-f`, a short-option cluster with `f` such as `-vf` or `-uf`, `+refspec` | ask | ask | ask (every `git push` asks) |
| `git rm` or `git worktree remove` with `--force`, `-f`, or a cluster such as `-rf` | ask | ask | ask (every `git rm` and `git worktree remove` asks) |
| `gio trash --empty`, `gio trash --restore`, in any argument position | ask | ask | ask when the option comes first |
| `gio trash -- <path>` | allow | allow | allow |
| `trash <path>` (macOS) | allow | allow | allow |
| `git rm <path>`, `git worktree remove <path>` without force | allow | allow | ask |

## How an agent removes files

1. Move a file or a directory to the trash with `gio trash -- <path>` on Linux
   or `trash <path>` on macOS. The `--` ends option parsing, so `gio` reads
   every later argument as a path. A path such as `--empty` cannot empty the
   trash.
2. In omp, do not use `rm`. omp denies a recursive `rm` and asks before any
   other `rm`, so a subagent cannot run `rm` at all.
3. In Claude Code and Codex, use `rm <file>` without flags only for one file
   that the agent created.
4. For a recursive or bulk deletion, ask the user in the main session. A
   subagent lists the paths in its final report. In omp, the user runs a
   recursive deletion by hand.
5. Do not pass `--force` to `git rm` or `git worktree remove`.
6. Write literal absolute paths. Never use `~` or `$HOME`, and never set or
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
- With `--force`, both commands discard uncommitted changes, so every forced
  form asks.

## Why omp denies instead of asking

omp has a built-in check for critical commands. It flags, for example, an
`rm` with `-r` or `-f` before an absolute path, and `sudo rm`. For a critical
command, omp returns a bare safety override before it returns a matching
prompt rule. Under the kit's `tools.approvalMode: yolo`, omp ignores a bare
override, so the command runs. This applies in subagents too. Only a deny rule
stops a critical command (`omp://approval-mode.md`). The kit therefore denies
every `rm` shape that the check can flag:

- a recursive `rm`;
- an `rm` with any option before an absolute path;
- `sudo rm`;
- `--no-preserve-root`.

A prompt rule then never meets a critical command.

## Matching rules per tool

- **omp**:
  - The rules are ordered, and the first match wins.
  - `*` matches any text, spaces included, and no escape spells a literal `*`.
  - Deny and prompt rules test the whole line and each segment between `;`,
    `&&`, `|`, and similar operators, with quotes removed. So
    `rm -rf "$HOME"` matches `rm * $HOME`.
  - Allow rules apply only to a simple command.
  - A single option token such as `-vf` is matched by listing each token as
    its own word, `git push *-vf *`.
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
  - Codex resolves `/bin/rm` to the `rm` rules.

## Gaps

- **omp, literal `*`**: omp cannot match a literal `*`, so it cannot tell a
  glob from a file name. The kit therefore asks before every `rm` that it does
  not deny.
- **omp, whole-line matching**: omp tests deny rules against the whole command
  line too, so a pattern can span commands. For example, `rm x && cd ~` and
  `rm -f a && ls /tmp` are denied. Run `rm` as its own command.
- **omp, critical patterns in a compound line**: a line that holds one of
  omp's other critical patterns, such as `curl ... | sh`, turns any matching
  prompt rule on that line into an allow.
- **omp, wrapped `rm`**: a recursive `rm` behind `xargs`, `env`, `nice`, or
  `timeout` asks instead of being denied. With an option before an absolute
  path, it is denied.
- **omp, text arguments**: the `* rm -* /*` deny also matches text such as
  `git commit -m "rm -f /tmp/x"`. Write such a message with `git commit -F`.
- **Option clusters**: omp and Claude Code match only the listed short-option
  clusters:
  - recursive `rm`: `r` or `R` alone or with `f` and `v`, in any order;
  - `git push`: any cluster that starts with `f`, and two- or three-letter
    clusters of `f` with `u`, `v`, or `q`, such as `-vf` or `-ufv`;
  - `git rm`: any cluster that starts with `f`, and two- or three-letter
    clusters of `f` with `r` or `q`, such as `-rf`.

  Another cluster, such as `rm -ri`, falls back to the tool's next tier. In
  omp, that tier is ask. In Claude Code, the classifier decides.
- **Claude Code, `HOME=` before a command**: Claude Code matches deny rules
  past a leading assignment. So `HOME=/tmp/x cmd` reaches the classifier.
  `export HOME=...`, `env HOME=...`, a bare `HOME=...` line, and any `rm` of
  `$HOME` stay denied.
- **Claude Code, unlisted `rm` forms**: a multi-file `rm` and an `rm -f` of
  one file go to the auto-mode classifier. Claude Code does not strip `env`, so
  `env X=1 rm -rf ~` also goes to the classifier.
- **Claude Code and omp, `git -C`**: neither tool matches a git subcommand
  that does not follow `git` directly. For example, `git -C . push --force`
  is not matched.
- **Codex, options after an operand**: prefix rules cannot see an option after
  an operand. So every `rm`, `git rm`, and `git worktree remove` asks. A
  `gio trash` command that does not start with `--` or a listed option runs in
  the workspace-write sandbox. An example is `gio trash build --empty`. GLib
  empties the trash through the GVfs daemon, which runs outside that sandbox,
  so the sandbox is not a guaranteed stop for it.
- **Codex, scripts**: a home or root deletion inside a longer script, such as
  `cd x && rm -rf ~`, falls to Codex's built-in forced-`rm` prompt and to the
  sandbox. Codex matches `HOME=` reassignment only as an exact script, and
  `export HOME=/tmp` runs sandboxed. Each Codex command runs in a new shell.
- **Codex, prompt reviewer**: a Codex prompt reaches the `auto_review`
  reviewer subagent, not always a person.
- **All tools**: no rule covers a program that removes files itself, such as a
  Python or Node script, or a shell started by omp `eval`.

## Sync behavior

- **omp**:
  - The config merge keeps user `bash.patterns` rules and groups all rules by
    approval: kit deny, user deny, kit prompt, user prompt, the other user
    rules, then kit allow.
  - The first match is then always the strictest matching rule, as in Claude
    Code and Codex. A user deny stays ahead of a kit prompt, and no allow can
    loosen a deny or a prompt.
  - A repeat sync changes nothing.
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
- Git: https://git-scm.com/docs/git-rm, https://git-scm.com/docs/git-worktree,
  and https://github.com/git/git/blob/master/builtin/worktree.c
  (`check_clean_worktree` runs `git status --porcelain` without `--ignored`).
- macOS `trash`: https://keith.github.io/xcode-man-pages/trash.8.html
