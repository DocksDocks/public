# Command guards

The kit ships one destructive-command policy to omp, Claude Code, and Codex.
It sorts shell commands into three tiers:

- **Deny**: the command never runs, and nobody can approve it in the session.
- **Ask**: a person must approve the command. omp runs subagents headless, so
  omp rejects an ask in a subagent. Claude Code asks even in auto mode. Codex
  sends the prompt to the configured approvals reviewer, which is the
  `auto_review` reviewer subagent in the kit's `config.toml`.
- **Allow**: the agent may run the command alone.

The omp `eval` tool stays unrestricted: `bash.patterns` does not gate a shell
that `eval` starts.

## Tiers per tool

| Command | omp `bash.patterns` | Claude Code `permissions` | Codex `docks.rules` |
| --- | --- | --- | --- |
| `rm` of `/`, `~`, `~/`, `$HOME`, `${HOME}`, quoted or with a trailing `/` | deny | deny | deny for `/` as argv; deny for the exact scripts listed in `docks.rules` |
| `rm` of `/*` | ask through the recursive rule; plain `rm /*` is free (gap) | deny | deny for the exact scripts listed |
| `export HOME=`, `HOME=... cmd`, `env HOME=...` | deny | deny | deny for `export HOME=$(mktemp -d)` and three spellings of it; `env` asks |
| `git push --force` or `-f` to `origin main` or `origin master` | deny | deny | deny |
| `rm -r`, `-R`, `-rf`, `-fr`, `--recursive`, any path | ask | ask | ask |
| `rm` of a `~/...`, `$HOME/...`, or `${HOME}/...` path | ask | auto-mode classifier; ask when recursive | ask |
| `find ... -delete`, `find ... -exec rm` | ask | ask | ask |
| `git clean`, `git reset --hard` | ask | ask | ask |
| `git push --force`, `-f`, `--force-with-lease`, `+refspec`, any branch | ask | ask | ask (every `git push` asks) |
| `gio trash --empty` | ask | ask | ask |
| `gio trash <path>`, `trash <path>` | allow | allow | allow |
| `rm <file>` without recursive flags | allow | auto-mode classifier | ask (every `rm` asks) |
| `git rm`, `git worktree remove` | allow | allow | allow |

`trash` is `/usr/bin/trash`, which first appeared in macOS 15.0. It has no
option that empties the trash. On Linux, `gio trash` comes with GLib.

## How an agent removes files

1. Move a file or a directory to the trash with `gio trash <path>` on Linux or
   `trash <path>` on macOS.
2. Use `rm <file>` without flags only for one file that the agent created.
3. For a recursive or bulk deletion, ask the user in the main session. A
   subagent cannot get approval, so it lists the paths in its final report.
4. Write literal absolute paths. Never use `~` or `$HOME`, and never set or
   export `HOME`.

The deployed agent prompts (`~/.omp/agent/AGENTS.md`, `~/.claude/CLAUDE.md`,
and the Codex `AGENTS.md`) carry the same rules.

## Matching rules per tool

- **omp**: the rules are ordered, and the first match wins. `*` matches any
  text, spaces included, and no escape spells a literal `*`. Deny and prompt
  rules test the whole command and each segment between `;`, `&&`, `|`, and
  similar operators, with quotes removed. So `rm -rf "$HOME"` matches
  `rm * $HOME`. Allow rules apply only to a simple command. The kit also denies
  `sudo rm`, `/bin/rm`, and other wrapped `rm` forms of the deny targets.
- **Claude Code**: deny beats ask, and ask beats allow, whatever the order. The
  rules match the command text as written, quotes included, so the kit lists
  each quoted spelling. `\*` is a literal `*`. Claude Code strips wrappers such
  as `timeout` and `xargs` and leading variable assignments, and it applies a
  deny or ask rule to every subcommand.
- **Codex**: a rule matches argv tokens from the start, and the strictest
  matching rule wins. Codex splits a `bash -lc` script into argv only when every
  word is a plain literal. A script with `~`, `$HOME`, a glob, or a substitution
  stays one `[shell, -lc, script]` invocation, so a rule can match only that
  exact script.

## Gaps

- omp cannot write `/*`, `~/*`, or `$HOME/*` literally. A recursive form such as
  `rm -rf /*` asks; a plain `rm /*` stays free. Any `rm` of a `~/`, `$HOME/`, or
  `${HOME}/` path asks instead, recursive or not.
- omp tests deny rules against the whole command line too, so a pattern can
  span segments: `rm x && cd ~` is denied. Split such a command.
- The recursive-flag rules in omp and Claude Code match a dash followed later by
  `r` or `R`. They also ask for some non-recursive forms, such as
  `rm -f readme.md`.
- omp and Claude Code do not catch a short-option cluster that puts `f` after
  another letter, such as `git push -vf`. `-f`, `-fu`, `-uf`, and `--force*` are
  caught.
- Claude Code strips a leading `VAR=value` before it matches deny rules. The
  `Bash(HOME=*)` rule is therefore best effort; `export HOME=...` and
  `env HOME=...` are commands and always match.
- Codex prefix rules cannot see a recursive flag after other flags, so every
  `rm` asks, a single-file `rm` too. A home or root deletion inside a longer
  script, such as `cd x && rm -rf ~`, falls to Codex's built-in forced-`rm`
  heuristic (ask when `-f` is present) and to the workspace-write sandbox.
- Codex cannot match `HOME=...` reassignment in a script except as an exact
  script.
- No rule covers a program that removes files itself, such as a Python or Node
  script, or a shell started by omp `eval`.

## Sync behavior

- omp: the config merge keeps user `bash.patterns` rules. The merged list holds
  the kit deny and prompt rules, then the user rules in their order, then the
  kit allow rules. A user rule can tighten a kit allow rule, but no rule can
  loosen a kit deny or prompt rule. A repeat sync changes nothing.
- Claude Code: sync unions each permissions array with the deployed one, so
  user rules stay. `--reconcile` replaces the arrays with the SoT arrays.
- Codex: sync writes `~/.codex/rules/docks.rules` whole. Keep your own rules in
  another `.rules` file, such as `default.rules`.

## Check the deployed rules

Each check below is safe: the shell never runs `rm` even if no rule matches.

- Codex: `codex execpolicy check --pretty --rules ~/.codex/rules/docks.rules -- rm -rf /`
  prints the decision and runs nothing.
- omp and Claude Code: ask the agent to run `true || rm -rf "$HOME"`. The `true ||`
  short-circuit stops the shell before `rm`. omp reports
  `Blocked by bash pattern: rm * $HOME`, and Claude Code reports a denial.

## Sources

- omp: `omp://tools/bash.md` and `omp://approval-mode.md`.
- Claude Code: https://code.claude.com/docs/en/permissions and
  https://code.claude.com/docs/en/permission-modes
- Codex: https://learn.chatgpt.com/docs/agent-configuration/rules and
  https://github.com/openai/codex/blob/main/codex-rs/execpolicy/README.md
- macOS `trash`: https://keith.github.io/xcode-man-pages/trash.8.html
