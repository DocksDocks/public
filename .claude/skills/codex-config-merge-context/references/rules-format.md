# Codex Rules Format — `docks.rules`

## Critical Constraint

`~/.codex/rules/default.rules` (user-learned approvals) is NEVER overwritten by the kit. Only kit-managed `*.rules` files from `SoT/.codex/rules/` are deployed. (lib/codex.sh:107-129)

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
| Destructive/escalation | `forbidden` | Never approved, always blocked | `sudo`, `eval`, `mkfs`, `dd`, `git push --force-with-lease` (to main) |

## Pattern Matching Rules

```
prefix_rule(pattern=["git", "status"], decision="allow")
```

Matches: `git status`, `git status --short`, `git status -sb`
Does not match: `git stash` (different second token)

```
prefix_rule(pattern=["sed", "-n"], decision="allow")
```

Matches: `sed -n '/pattern/p' file` (read-only sed)
Does not match: `sed -i 's/a/b/' file` (in-place edit; different second token → falls through to `prompt`)

## Real Examples from `docks.rules` (lines 1-50)

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
2. `lib/codex.sh:codex::sync_rules` automatically deploys any `*.rules` file in `SoT/.codex/rules/` (lib/codex.sh:124)
3. Backup of the old `<name>.rules` is written to `<name>.rules.bak` before overwrite (lib/codex.sh:123)

## Gotchas

- Pattern matching is PREFIX, not exact. `["git"]` alone would match ALL git commands. Always include enough tokens to be specific.
- There is no `deny` tier — `forbidden` is the closest equivalent. A `forbidden` rule is enforced even if a `prompt` rule would also match (precedence is `forbidden` > `prompt` > `allow` in Codex's rule engine).
- The rules file format is Codex-specific. Claude Code uses `permissions.{allow,deny,ask}` arrays in `settings.json` for the equivalent policy — different format, different file.
