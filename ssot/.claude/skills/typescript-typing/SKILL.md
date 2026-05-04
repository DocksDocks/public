---
name: typescript-typing
description: Use when writing or modifying TypeScript (.ts/.tsx), defining a function signature or exported API, choosing between `interface` and `type`, tempted to write `any` or a type assertion (`as Foo`), introducing a string or number literal that already exists elsewhere, designing variant props or API response shapes, working with IDs that could be mixed up across entities, validating external input (form/API/env), or writing a switch over a discriminated union and needing exhaustiveness. Covers `any` vs `unknown`, `interface` vs `type` (object shapes vs unions/aliases), discriminated unions over optional-flag bags, `as const` literal narrowing, branded types for IDs, exhaustive `never` checks, the `satisfies` operator, and parsing-not-asserting at I/O boundaries.
user-invocable: false
paths:
  - "**/*.ts"
  - "**/*.tsx"
metadata:
  pattern: tool-wrapper
  updated: "2026-05-04"
---

# Lean on the Type System

<constraint>
TypeScript's type system exists to make invalid states unrepresentable. `any`, raw string/number literals, and `as Foo` casts each undo that work in different ways. Reach for them only when an irreducible reason exists, and document it on the same line.
</constraint>

## When to Use

- Writing or modifying any `.ts` / `.tsx` file.
- Defining a function signature, props type, or exported API.
- About to choose between `interface` and `type`.
- Tempted to write `any`, leave a parameter untyped, or use a type assertion (`as Foo`).
- A string or number literal is appearing in 2+ places.
- Designing variant component props or an API response with multiple shapes.
- Two ID-shaped strings (`UserId`, `OrgId`, `InvoiceId`) flow through the same code path.
- Parsing external data: form input, API response, environment variables, JSON file.
- Writing a `switch` over a string union and wanting the compiler to enforce exhaustiveness.

## Quick Reference

| Smell | Replace with | Why |
|---|---|---|
| `any` | `unknown` + narrowing, or the real type | `any` propagates; `unknown` forces a check |
| Magic string literal in 2+ places | `type Status = "pending" \| "done"` (or `as const` array + `typeof X[number]`) | Single source of truth, rename-safe |
| `type User = { ... }` for a plain object shape | `interface User { ... }` | Declaration merging, better extension errors |
| `{ mode: string; userId?; guestEmail? }` | `{ mode: "user"; userId } \| { mode: "guest"; guestEmail }` | Optional-flag bags allow invalid states |
| `string` for `userId` and `orgId` | Branded types (`type UserId = string & { __brand: "UserId" }`) | Compiler catches `OrgId` passed where `UserId` is expected |
| `JSON.parse(raw) as Foo` | Schema parser (zod / valibot / arktype) returning `Foo` | Casts lie; parsers prove |
| `switch (x.kind)` with no default | `default: const _: never = x; throw …` | Compiler flags every new variant |
| `Object`, `Function`, `Number`, `String` | `object` / specific signature / `number` / `string` | Uppercase forms are global wrapper objects |

## 1. `any` is poison — use `unknown`

`any` removes the type from a value AND from every consumer. `unknown` keeps the value opaque until you narrow it.

```ts
// BAD — `data.user.id` is `any`, propagates through every consumer
function fromJson(raw: string) {
  const data: any = JSON.parse(raw)
  return data.user.id
}

// GOOD — `unknown` forces a parser/check at the boundary
import { z } from "zod"

const Payload = z.object({ user: z.object({ id: z.string() }) })

function fromJson(raw: string) {
  const data: unknown = JSON.parse(raw)
  return Payload.parse(data).user.id
}
```

When you don't have a parser handy, narrow with `typeof` / `in` / `instanceof` / type predicates — never with `as`.

### Indicators

- `: any` annotation in production code
- `as any` cast (worse — silently widens)
- Property chains like `obj.maybe?.deeply.nested` without a check

## 2. `interface` for object shapes, `type` for unions

The TypeScript team's house rule: prefer `interface` for object shapes; reach for `type` for unions, intersections, mapped types, function aliases, or anything that isn't strictly an object.

```ts
// GOOD — interface for an object you'll likely extend
interface User { id: string; email: string }
interface AdminUser extends User { permissions: Permission[] }

// GOOD — type for a union (interfaces can't express unions directly)
type Result<T> = { ok: true; value: T } | { ok: false; error: string }

// GOOD — type for a function alias
type Handler = (req: Request) => Promise<Response>

// AVOID — type alias for a plain object shape that could be an interface
type User = { id: string; email: string }
```

Why: interfaces support declaration merging (occasionally needed for global augmentation) and give clearer error messages on extension chains. For unions/intersections/mapped types, `type` is the only option.

## 3. No magic literals — name them with a type

If a string or number literal carries meaning that's referenced in more than one place, give it a name. The type IS the documentation, and rename-refactor follows it.

```ts
// BAD — "pending" / "active" / "cancelled" sprinkled across the codebase
function setStatus(s: string) { /* ... */ }
setStatus("activ")  // typo compiles

// GOOD — single source of truth, compiler-enforced
type SubscriptionStatus = "pending" | "active" | "cancelled"
function setStatus(s: SubscriptionStatus) { /* ... */ }
setStatus("activ")  // ✗ compile error

// GOOD — when values come from a runtime list, derive the union with `as const`
const STATUSES = ["pending", "active", "cancelled"] as const
type SubscriptionStatus = typeof STATUSES[number]
```

For numeric magic constants (timeouts, limits, retry counts), gather them in an `as const` config object:

```ts
// BAD
setTimeout(retry, 30000)
if (attempts > 3) abort()

// GOOD
const POLLING = { intervalMs: 30_000, maxAttempts: 3 } as const
setTimeout(retry, POLLING.intervalMs)
if (attempts > POLLING.maxAttempts) abort()
```

### Indicators

- Same string literal in 2+ files
- A magic number with a comment explaining what it means
- A function parameter typed as plain `string` when only a few values are valid

## 4. Discriminated unions over optional-flag bags

When a value has multiple shapes — different fields valid in different modes — model it as a tagged union. Optional fields with "required when X" rules are bugs waiting to happen.

```ts
// BAD — invalid states are representable
type Invite = {
  mode: "user" | "guest"
  userId?: string       // required when mode === "user"
  guestEmail?: string   // required when mode === "guest"
  guestName?: string    // required when mode === "guest"
}
// Caller can pass { mode: "user", guestEmail: "a@b.c" } and the compiler is happy.

// GOOD — invalid states are unrepresentable
type Invite =
  | { mode: "user"; userId: string }
  | { mode: "guest"; guestEmail: string; guestName: string }

function send(invite: Invite) {
  if (invite.mode === "user") {
    return inviteUser(invite.userId)        // narrowed
  }
  return inviteGuest(invite.guestEmail, invite.guestName)
}
```

This is the type-level version of the Liskov rule from `react-solid`: every variant satisfies the contract on its own terms.

## 5. Branded types for IDs

Plain `string` lets `UserId` and `OrgId` swap silently. Brand them so the compiler treats them as distinct.

```ts
// BAD — caller can pass an OrgId where UserId is expected
function loadUser(id: string) { /* ... */ }

// GOOD — branded types catch the mix-up at compile time
type Brand<T, B> = T & { readonly __brand: B }
type UserId = Brand<string, "UserId">
type OrgId  = Brand<string, "OrgId">

function loadUser(id: UserId) { /* ... */ }

const orgId = "..." as OrgId
loadUser(orgId)  // ✗ Argument of type 'OrgId' is not assignable to parameter of type 'UserId'
```

Construct branded values at the boundary (DB query, parser, login flow) — once. From then on the type carries the proof.

## 6. `as const` narrows; `as Foo` lies

`as const` is the one assertion that's almost always safe — it narrows literal types and freezes structures. `as Foo` is a smell: it tells the compiler to trust you in a place where narrowing or parsing would prove the claim.

<constraint>
`as Foo` is forbidden except: (1) `as const` for literal narrowing, (2) double-assertion through `unknown` (`x as unknown as Foo`) when interfacing with a known-broken third-party type — and only with a same-line comment naming the library + issue link. Everything else has a parser, a type guard, or a `satisfies` clause that does the job without lying.
</constraint>

```ts
// BAD — compiler now told to trust the JSON.parse result
const config = JSON.parse(raw) as Config  // wrong shape? you find out at runtime

// GOOD — schema parser proves the shape
const config = ConfigSchema.parse(JSON.parse(raw))

// GOOD — `satisfies` (TS 4.9+) checks conformance without widening literals
const palette = {
  primary: "#2b6cb0",
  danger:  "#c53030",
} satisfies Record<string, `#${string}`>
// `palette.primary` is still the literal `"#2b6cb0"`, not `string`
```

## 7. Exhaustive switches via `never`

When you switch over a discriminated union, ask the compiler to fail loudly the day a new variant appears.

```ts
type Event =
  | { kind: "click"; x: number; y: number }
  | { kind: "key"; code: string }
  | { kind: "scroll"; delta: number }

function handle(e: Event) {
  switch (e.kind) {
    case "click":  return onClick(e.x, e.y)
    case "key":    return onKey(e.code)
    case "scroll": return onScroll(e.delta)
    default: {
      const _exhaustive: never = e
      throw new Error(`unhandled event: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
// Add `{ kind: "drag"; ... }` to Event → compile error in `handle()`. Fix forced.
```

The runtime `throw` covers the off-chance the compiler is bypassed (data crossing a JSON boundary, `as` cast upstream). Tests cover the happy path; `never` covers the future.

## 8. Parse, don't assert, at I/O boundaries

Every entry point that brings data into your typed code is a place where types and reality can diverge: HTTP handlers, form actions, env vars, file reads, message queues, third-party SDK responses. Parse there, once; the rest of the code can trust the types.

```ts
// BAD — env access typed as `string | undefined`, casted away
const apiKey = process.env.API_KEY as string  // crashes silently if unset

// GOOD — schema validates at startup
import { z } from "zod"

const Env = z.object({
  API_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535),
})

export const env = Env.parse(process.env)  // throws on boot if misconfigured
// `env.API_KEY` is `string`, `env.PORT` is `number` — no `as`, no `?? defaultPort`
```

Same pattern for: API request bodies (Server Actions, route handlers), `JSON.parse` results, database row reads if your driver doesn't already type them, message payloads.

<constraint>
Boundaries get parsers, not casts. Inside the typed core, never use `as` to widen or to "tell the compiler this is fine" — narrow with type guards or refactor the type. The type system is only as honest as the boundary.
</constraint>

## Decision Tree — When You're Stuck

1. **Tempted to write `any`?** → Use `unknown` and narrow. If the shape is dynamic JSON, parse at the boundary.
2. **Tempted to write `as Foo`?** → 99% chance there's a type guard, `satisfies`, or parser that does it without lying.
3. **Same string in 2+ places?** → Extract to a `type` (or `as const` array + `typeof X[number]`).
4. **Optional fields with "required when X" rules?** → Discriminated union with a `kind`/`mode` discriminator.
5. **Two ID-shaped strings flowing through the same function?** → Brand them.
6. **`switch` over a union?** → Add a `default: const _: never = x` arm.

None of these requires a fancy type-level trick — they're all standard TS in 2026.

## Gotchas

- **Don't type `useState<string>("")` as plain `string` if only a few values are valid.** Use the union: `useState<Status>("pending")`. Same for `useReducer` action types.
- **`enum` is mostly avoided in modern TS.** It generates runtime objects and has narrowing quirks. Prefer `as const` arrays + `typeof X[number]` unions, or string literal unions.
- **`Record<string, X>` widens to "any string is a valid key".** Prefer `Record<KnownKey, X>` (where `KnownKey` is a union) or `Map<string, X>` if keys are truly dynamic — the lookup result will be `X | undefined`, which the compiler then forces you to handle.
- **Don't over-brand.** Brand IDs and security-critical strings. Branding every `email`/`name`/`title` is noise — the compiler can't catch a "wrong title" bug because there's no semantic constraint to enforce.
- **`satisfies` is not a replacement for explicit return types on exported functions.** Keep `export function fn(): ReturnType { ... }` for public APIs — it stops accidental contract changes from typing-by-inference.
- **Don't suppress with `@ts-expect-error` to "fix" a typing problem.** See the `lint-no-suppressions` skill — fix the type.

## References

- TypeScript handbook — `unknown` vs `any`: https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#unknown
- TypeScript handbook — discriminated unions + `never`: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
- TypeScript 4.9 — `satisfies` operator: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator
- TS team — interface vs intersection performance: https://github.com/microsoft/TypeScript/wiki/Performance#preferring-interfaces-over-intersections
- Branded types pattern: https://egghead.io/blog/using-branded-types-in-typescript
