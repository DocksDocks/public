# npx skills@<verified> add - Source-First Arg Order

## Critical Constraint

`<slug>` must be the first positional argument. The `-a/--agent` flag is
variadic and consumes following tokens as agent names.

## The Trap

```text
WRONG:   npx --yes skills@<verified> add -g -y -a claude-code codex <slug>
CORRECT: npx --yes skills@<verified> add <slug> -g -y -a claude-code codex
```

`<verified>` is the `skills-cli.verified` pin in `SoT/toolchain.json`. With the
slug after `-a`, the variadic flag takes the slug as an agent name, and
skills@1.7.0 exits 1 with `Missing required argument: source`.

## Good / Bad Comparison

| Good | Bad | Why |
|------|-----|-----|
| `skills@<verified> add <slug> -g -y -a claude-code codex` | `skills@<verified> add -a claude-code codex <slug>` | Variadic `-a` swallows the slug. |
| `-a claude-code codex` | `-a claude-code` | Single-agent mode can skip the canonical universal path. |
| `-a claude-code codex` | `-a '*'` | skills@1.7.0 accepts it but installs to every supported agent. |

## Remove Invocation

The kit does not call `skills remove`. `skillsPrune.ts reconcileRemovals`
deletes only the kit-created canonical directory and the kit-managed Claude
entry. The pinned CLI behavior below explains this rule.

Remove is positional in the CLI:

```text
npx --yes skills@<verified> remove --global <basename> -y
```

In skills@1.7.0, `remove` without `-a` targets every known agent, not only the
detected agents. It recursively deletes each same-named skill directory, real
directory or link. That includes an unmarked real `~/.claude/skills/<basename>`
and unrelated directories of other agents. `skills remove` rejects `-a '*'`
(`Invalid agents: *`, exit 1). A remove scoped with `-a claude-code codex` still
deletes `~/.codex/skills/<basename>`. It also keeps the canonical directory when
another detected agent uses `~/.agents/skills/`.
