# Codex Rules Format - docks.rules

## Critical Constraint

`~/.codex/rules/default.rules` is user-learned state and is never deployed by
the kit. Only files under `SoT/.codex/rules/` are kit-managed.

## Syntax

```text
prefix_rule(pattern=["cmd", "subcmd"], decision="<allow|prompt|forbidden>")
```

- `pattern` is an argv-prefix array.
- `decision` is `allow`, `prompt`, or `forbidden`.

## Decision Tiers

| Tier | Value | Meaning |
|------|-------|---------|
| Read-only | `allow` | Runs outside the sandbox without a prompt. |
| Mutating | `prompt` | User confirmation required. |
| Destructive/escalation | `forbidden` | Always blocked. |

## Pattern Matching

`pattern=["git", "status"]` matches `git status --short`, but not `git stash`.
Adding tokens narrows the prefix.

Only allow-list a command prefix when no reachable later flag can turn it into a
write or exec. For example, broad `sed` and `rg` prefixes are risky because later
flags can execute commands or preprocessors.

A command with no rule runs inside the SoT `workspace-write` sandbox with no
prompt. A read command with a reachable write or exec flag therefore stays
without a rule. For this reason, `sort`, `uniq`, `tree`, `git diff`, `git log`,
`git show`, and `git grep` have no allow rule:

| Command | Reachable write or exec form |
|---------|------------------------------|
| `sort` | `-o FILE`, `--compress-program=CMD` |
| `uniq` | OUTPUT operand (`uniq INPUT OUTPUT`) |
| `tree` | `-o FILE` |
| `git diff`, `git log`, `git show` | `--output=FILE` |
| `git grep` | `--open-files-in-pager=CMD`, `-O` |

`git mv` is `prompt`, not `allow`. An allowed `git mv` runs outside the sandbox
and can move workspace files into the read-only `.git` directory, for example
`.git/hooks`.

## Kit-Managed vs User-Learned

| File | Owner | Sync behavior |
|------|-------|---------------|
| `~/.codex/rules/docks.rules` | Kit | Copied wholesale from SoT. |
| `~/.codex/rules/default.rules` | User/Codex | Never touched. |

## Gotchas

- Prefix is not exact. `["git"]` would match every git command.
- There is no `deny`; use `forbidden`.
- Claude Code permissions use a different settings schema and are not deployed
  through Codex rules.
