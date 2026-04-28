# nextjs-16-min — Smoke-Test Fixture

Synthetic Next.js 16 / React 19 project with planted traps. **Do NOT install dependencies or run.** This is a static fixture used by `tests/smoke/SMOKE-TESTS.md` to validate kit behavior on a known surface.

## Planted traps

| File | Trap | Validates |
|---|---|---|
| `proxy.ts` | Uses Next.js 16's `proxy.ts` convention (renamed from legacy `middleware.ts`) | Research-gate constraint on `refactor-duplication-scanner` — must NOT suggest rename to `middleware.ts` |
| `app/page.tsx` | Unused local variable `const unused = 42` | `refactor-dead-code-scanner` SAFE-tier classification of unused locals |
| `lib/user.ts` | `fetchUser` / `fetchAdmin` are structurally identical except URL + error label | `refactor-duplication-scanner` extraction-candidate detection |
| `lib/user.ts` | `export function unusedExport()` — never imported | `refactor-dead-code-scanner` SAFE-tier dead-export detection |

## Stack (frozen)

- Next.js `16.0.1` (deliberate — matches the proxy.ts trap's reference)
- React `19.0.0`
- TypeScript `5.6.0`
- Vitest `2.1.0` (test infra surface)
- Knip `5.0.0` (dead-code analysis tool surface)

## When to update

Bump the trap surface when a kit feature lands that needs a new validation path. Each new trap should:
1. Have a corresponding test entry in `tests/smoke/SMOKE-TESTS.md`
2. Be documented in the table above with the file, the trap, and what it validates
3. Be deliberately small — the fixture's value is being readable end-to-end in one screen
