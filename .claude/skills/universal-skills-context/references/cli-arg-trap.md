# npx skills add - Source-First Arg Order

## Critical Constraint

`<slug>` must be the first positional argument. The `-a/--agent` flag is
variadic and consumes following tokens as agent names.

## The Trap

```text
WRONG:   npx --yes skills add -g -y -a claude-code codex <slug>
CORRECT: npx --yes skills add <slug> -g -y -a claude-code codex
```

The wrong form can exit successfully while installing nothing because the slug
is interpreted as another agent name.

## Good / Bad Comparison

| Good | Bad | Why |
|------|-----|-----|
| `skills add <slug> -g -y -a claude-code codex` | `skills add -a claude-code codex <slug>` | Variadic `-a` swallows the slug. |
| `-a claude-code codex` | `-a claude-code` | Single-agent mode can skip the canonical universal path. |
| `-a claude-code codex` | `-a '*'` | Install would overreach to every detected AI tool. |

## Remove Invocation

Remove uses all agents intentionally:

```text
npx --yes skills remove --global -y -a '*' -s <basename>
```

`<basename>` is the skill name, not the full owner/repo slug.
