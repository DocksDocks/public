# Codex Rules Format — `docks.rules`

## Critical Constraint

`~/.codex/rules/default.rules` (user-learned approvals) is NEVER overwritten by the kit. Only kit-managed `*.rules` files from `SoT/.codex/rules/` are deployed. (`codex::sync_rules`)

## `prefix_rule` Syntax

```
prefix_rule(pattern=[<argv>], decision="<allow|prompt|forbidden>")
```

- `pattern`: JSON-style array of strings — exact prefix match on command argv
- `decision`: one of `allow`, `prompt`, `forbidden`

## Decision Tiers

| Tier | Value | Meaning | Examples from docks.rules |
|------|-------|---------|--------------------------|
| Read-only ops | `allow` | Auto-approved, no user prompt | `ls`, `cat`, `git status`, `git diff`, `grep`, `jq` |
| Mutating ops | `prompt` | User must confirm before execution | `rm`, `git push`, `sed -i`, `docker run`, `mv` |
| Destructive/escalation | `forbidden` | Never approved, always blocked | `sudo`, `eval`, `mkfs`, `dd`, `git push --force origin main` |

## Pattern Matching Rules

```
prefix_rule(pattern=["git", "status"], decision="allow")
```

Matches: `git status`, `git status --short`, `git status -sb`
Does not match: `git stash` (different second token)

```
prefix_rule(pattern=["git", "branch", "--show-current"], decision="allow")
```

Matches: `git branch --show-current` (read-only)
Does not match: `git branch -D feat` (no allow rule for it → falls through to `prompt`)

Adding tokens narrows the match — but a prefix rule can only gate a flag that appears as a **distinct later argv token**. It cannot gate a flag folded into an earlier token, nor one that turns a read into an exec. That is why `sed -n` and `rg` are `prompt`, NOT `allow`: `sed -n '/p/p' f` (read) and `sed -n 'e reboot' f` (runs a shell command via GNU sed's `e`) share the identical prefix `["sed", "-n"]`, and `rg pat --pre=CMD` runs an arbitrary preprocessor binary. Only allow-list a command when NO reachable flag can turn it into a write or an exec.

## Real Examples from `docks.rules`

```
prefix_rule(pattern=["pwd"], decision="allow")
prefix_rule(pattern=["git", "status"], decision="allow")
prefix_rule(pattern=["git", "diff"], decision="allow")
prefix_rule(pattern=["git", "mv"], decision="allow")
prefix_rule(pattern=["gh", "pr", "view"], decision="allow")
prefix_rule(pattern=["gh", "pr", "list"], decision="allow")
```

## Kit-Managed vs User-Learned Rules

| File | Owner | Sync behavior |
|------|-------|--------------|
| `~/.codex/rules/docks.rules` | Kit | Copied wholesale from SoT on every sync |
| `~/.codex/rules/default.rules` | User (Codex writes) | NEVER touched by sync |

## Adding New Kit-Managed Rules

1. Add `SoT/.codex/rules/<name>.rules` with `prefix_rule(…)` entries
2. `codex::sync_rules` automatically deploys any `*.rules` file in `SoT/.codex/rules/`
3. Backup of the old `<name>.rules` is written to `<name>.rules.bak` before overwrite (`codex::sync_rules`)

## Gotchas

- Pattern matching is PREFIX, not exact. `["git"]` alone would match ALL git commands. Always include enough tokens to be specific.
- There is no `deny` tier — `forbidden` is the closest equivalent. A `forbidden` rule is enforced even if a `prompt` rule would also match (precedence is `forbidden` > `prompt` > `allow` in Codex's rule engine).
- The rules file format is Codex-specific. Claude Code uses `permissions.{allow,deny,ask}` arrays in `settings.json` for the equivalent policy — different format, different file.
