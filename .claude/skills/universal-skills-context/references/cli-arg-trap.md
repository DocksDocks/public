# `npx skills add` — Source-First Arg Order Trap

## Critical Constraint

`<slug>` MUST be the FIRST positional argument. The `-a/--agent` flag is variadic and consumes everything after it as agent names. (skills::sync_universal (the slug-before-`-a` comment))

## The Trap

```bash
# WRONG — slug consumed as agent name; installs nothing; exits 0
npx --yes skills add -g -y -a claude-code codex "$slug"

# CORRECT — slug is positional before variadic -a
npx --yes skills add "$slug" -g -y -a claude-code codex
```

Failure mode is silent: the command exits 0, no error is printed, `~/.agents/skills/<name>/` is never created. On the next sync pass, `[[ -d "$SKILLS_DIR/$basename" ]]` (skills::sync_universal (idempotency pre-check)) returns false, so the add is retried — and fails again silently every time.

## Regression History

This trap was hit once before (documented in `docs/plans/finished/2026-05-14-skills-cli-storage-model-doc-sync.md`). The comment at skills::sync_universal (the slug-before-`-a` comment) documents the reason:

```bash
# <source> is positional and MUST precede the variadic -a/--agent flag,
# or --agent swallows the slug. Naming both agents (claude-code codex)
# makes the CLI keep the canonical ~/.agents/skills/ copy and symlink it
# into ~/.claude/skills/; a single agent would copy-direct instead.
```

## Correct Invocation (skills::sync_universal (the npx skills add invocation))

```bash
npx --yes skills add "$slug" -g -y -a claude-code codex
```

## Good / Bad Comparison

| Good | Bad | Why |
|------|-----|-----|
| `npx skills add "$slug" -g -y -a claude-code codex` | `npx skills add -a claude-code codex "$slug"` | Variadic `-a` swallows slug |
| `-a claude-code codex` (two agents) | `-a claude-code` (one agent) | Single agent = copy-direct, no canonical path |
| `-a claude-code codex` (two agents) | `-a '*'` (all agents) | Over-reaches to all detected AI tools |

## Corresponding Remove Invocation (skills::_remove_one_slug (the npx skills remove))

```bash
npx --yes skills remove --global -y -a '*' -s "$basename"
```

Remove uses `-a '*'` (all agents) to clean up all per-tool entries, and `-s <basename>` (not the full slug).
