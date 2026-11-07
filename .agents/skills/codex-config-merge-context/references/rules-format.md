# Codex Rules Format - docks.rules

## Constraint

`~/.codex/rules/default.rules` is user-learned state and is never deployed by
the kit. Only files under `SoT/.codex/rules/` are kit-managed.

## Syntax

```text
prefix_rule(pattern=["cmd", "subcmd"], decision="<allow|prompt|forbidden>")
prefix_rule(pattern=["cmd", ["-a", "-b"]], decision="forbidden", justification="<reason>")
```

- `pattern` is an argv-prefix array. A nested list at one position lists
  alternative tokens for that position, for example `["rm", ["-r", "-rf"], "/"]`.
- `decision` is `allow`, `prompt`, or `forbidden`.
- `justification` is optional and states the reason for the decision.

When more than one rule matches, Codex applies the strictest decision
(`forbidden` > `prompt` > `allow`). An allow rule in another `.rules` file
therefore cannot loosen a `prompt` or `forbidden` rule.

Verify: `bunx vitest run cli/test/unit/codexSyncRules.test.ts -t "parses every prefix_rule line"`.

## Decision Tiers

| Tier | Value | Meaning |
|------|-------|---------|
| Safe without a prompt | `allow` | Runs outside the sandbox without a prompt. Mostly read-only commands; `trash`, which moves files to the trash, is also `allow`. |
| Mutating | `prompt` | Approval required. The approvals reviewer that `approvals_reviewer` in `SoT/.codex/config.toml` selects gets the request, not always a person (verify: `grep -n approvals_reviewer SoT/.codex/config.toml`). |
| Destructive/escalation | `forbidden` | Always blocked. |

## Pattern Matching

`pattern=["git", "status"]` matches `git status --short`, but not `git stash`.
Adding tokens narrows the prefix.

Only allow-list a command prefix when no reachable later flag can turn it into a
write or exec. For example, broad `sed` and `rg` prefixes are risky because later
flags can execute commands or preprocessors.

A command with no rule runs inside the SoT `workspace-write` sandbox with no
prompt. A read command with a reachable write or exec flag therefore stays
without a rule or gets `prompt`. The comment block above the `rg` rule in
`SoT/.codex/rules/docks.rules` lists those commands and their write or exec
flags, and `cli/test/unit/codexSyncRules.test.ts` holds one "does not allow"
case per flag (verify:
`bunx vitest run cli/test/unit/codexSyncRules.test.ts -t "does not allow"`).
Add a new excluded command to both places.

`git mv` is `prompt`, not `allow`. An allowed `git mv` runs outside the sandbox
and can move workspace files into the read-only `.git` directory, for example
`.git/hooks` (verify:
`bunx vitest run cli/test/unit/codexSyncRules.test.ts -t "prompts before git mv"`).

## Kit-Managed vs User-Learned

| File | Owner | Sync behavior |
|------|-------|---------------|
| `~/.codex/rules/docks.rules` | Kit | Copied wholesale from SoT and recorded in `~/.codex/.kit-managed-rules`. |
| A recorded rules file that the SoT dropped | Kit | Removed while it holds the recorded kit bytes; kept with a warning after a user edit. |
| `~/.codex/rules/default.rules` | User/Codex | Never read or removed, because no sync records it. |

Verify: `bunx vitest run cli/test/unit/codexRulesDeploy.test.ts -t "Codex rules deploy"`.

## Gotchas

- Prefix is not exact. `["git"]` would match every git command.
- There is no `deny`; use `forbidden`.
- Claude Code permissions use a different settings schema and are not deployed
  through Codex rules.
