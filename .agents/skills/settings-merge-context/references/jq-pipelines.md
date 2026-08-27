# Settings Merge Compatibility Spec

The production implementation is TypeScript (`settings.ts` and
`claudeSync.ts`). The jq snippets below are the compatibility spec preserved in
tests, because they define the historical merge behavior.

## Critical Constraints

- Write to a temporary file first, then replace the target.
- Validate deployed JSON before merging.
- `$user * $repo` means repo wins on conflicts because jq object merge uses the
  right operand on scalar/object conflicts.

## Default Additive Merge

```jq
.[0] as $repo | .[1] as $user |
($user * $repo) |
.permissions.allow = (($user.permissions.allow // []) + ($repo.permissions.allow // []) | unique) |
.permissions.deny  = (($user.permissions.deny  // []) + ($repo.permissions.deny  // []) | unique) |
.permissions.ask   = (($user.permissions.ask   // []) + ($repo.permissions.ask   // []) | unique)
```

Result: SoT scalar/object values win, user-only keys survive, and permission
arrays are unioned and sorted/deduped.

## Reconcile Merge

```jq
.[0] as $repo | .[1] as $user | $user * $repo
```

Result: SoT scalar/object values win, user-only keys survive, and permissions
arrays are replaced wholesale by the SoT arrays.

## Why Operand Order Matters

| Expression | Conflict winner |
|------------|-----------------|
| `$user * $repo` | SoT/repo |
| `$repo * $user` | User |

The kit uses repo-wins so prompt/config changes propagate forward.

## `~/.claude.json`

`syncClaudeJson` patches `showTurnDuration` and additive `mcpServers` into
`~/.claude.json`. It must not replace the whole file because Claude Code stores
project state and user-owned data there.

## Removed-Key Prune

Removed dotted paths are counted against the root document, then deleted with
path semantics equivalent to jq `delpaths`. The present-count must bind the root
document before iterating path strings; otherwise every key appears absent.

## Good / Bad Patterns

| Good | Bad | Why |
|------|-----|-----|
| temp file then replace | direct write to target | Direct write can truncate on error. |
| repo-wins merge | user-wins merge | SoT changes would not land. |
| array fallback before union | raw nullable concat | Missing arrays can become null or throw. |

## Gotchas

- jq `unique` sorts as it dedupes; permission array order is not insertion order.
- jq slurp order matters: repo is first, user is second.
- jq `//` treats both `null` and `false` as fallback triggers; TypeScript ports
  must account for that where relevant.
