---
name: react-solid
description: Use when designing a React or Next.js component architecture, refactoring a component or hook, reviewing a PR that adds a large component (300+ LOC), extracting a custom hook, designing a Server Action layout, splitting a "god module" of actions, writing a discriminated union for component props, eliminating a growing switch/if-else chain, or deciding whether to keep two things in the same file. Covers SOLID's 5 principles translated to function-based React (no classes) — SRP via Extract Hook / Split Module, OCP via Strategy Map (Record<string, Formatter>), LSP via discriminated unions instead of inheritance, ISP via splitting bloated props, DIP via dependency injection through props / Context / Server Action imports.
user-invocable: false
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.js"
metadata:
  pattern: tool-wrapper
  updated: "2026-04-27"
---

# SOLID in Function-Based React / Next.js

<constraint>
React/Next.js codebases typically have zero classes — so the classic OO phrasing ("class should have one responsibility") doesn't map directly. The principles still apply; the implementations change. Don't force classes to make SOLID fit.
</constraint>

## When to Use

- A component file crosses ~300 LOC.
- A switch or if-else chain is about to grow a new arm.
- Two independent state machines share one component.
- A Server Actions module has 8+ exports with different change axes.
- Props type has 10+ fields where some make others irrelevant.
- A component imports a concrete backend client directly.
- A prop type union uses `instanceof` / runtime type checks.

## S — Single Responsibility

"A module has one reason to change."

### In React

| Smell | Fix |
|---|---|
| Component has two independent state machines (e.g., calculator with two tabs) | **Extract Hook** per machine: `useSerasaCalculator()` + `useHabiteSeCalculator()`. Parent becomes a layout switcher. |
| Component fetches, transforms, and renders | Server Component owns the fetch; pass clean props to a presentational Client Component. |
| `actions.ts` has invite/update/remove + view-as + permission grants (3+ change axes) | **Split Module**: `user-crud-actions.ts`, `view-as-actions.ts`, `permission-actions.ts`. |
| Dialog component owns state, validation, commit loop, and rendering | **Extract Hook**: `usePendingPermissions({ userId, onClose })` owns state + commits; dialog becomes presentational. |

### Indicators
- File > 300 LOC
- The word "and" in the module name
- Two independent concerns changing in lockstep

## O — Open/Closed

"Open for extension, closed for modification."

### In React — the Strategy Map pattern

When a function has a growing switch/if-else over a string type (action type, status, event kind), replace it with a lookup table:

```tsx
// BAD — every new action type requires editing formatDetails()
function formatDetails(action: string, d: Details) {
  switch (action) {
    case "user_invited": return "...";
    case "role_changed": return "...";
    case "permission_granted": return "...";
    // 13 more cases
  }
}

// GOOD — Strategy Map, extensible without modification
type Formatter = (d: Details) => string

const FORMATTERS: Record<string, Formatter> = {
  user_invited: (d) => `convidou como ${d.role}`,
  role_changed: (d) => `mudou papel de ${d.from} para ${d.to}`,
  permission_granted: (d) => `concedeu ${d.resource}:${d.action}`,
  // ...
}

function formatDetails(action: string, d: Details): string {
  return (FORMATTERS[action] ?? (() => action))(d)
}
```

Split the map by actor domain if useful: `DASHBOARD_FORMATTERS` + `WORKFLOW_FORMATTERS`, merged via spread.

### Indicators
- switch statement with 5+ arms
- "Every time we add X, we edit Y"

## L — Liskov Substitution

"Subtypes must be substitutable for their base types."

### In React

LSP is mostly N/A when there are no classes. But it applies to discriminated unions and polymorphic component props: every variant must satisfy the component's contract.

```tsx
// BAD — runtime `instanceof` / duck-typing
type NavEntry = { label: string; href?: string; comingSoon?: boolean }
function render(entry: NavEntry) {
  if (entry.href) { return <Link href={entry.href}>{entry.label}</Link> }
  else { return <span>{entry.label} (soon)</span> }
}

// GOOD — discriminated union, exhaustive narrowing
type NavItem = { kind: "nav"; label: string; href: string; icon: Icon }
type ComingSoonItem = { kind: "comingSoon"; label: string; icon: Icon }
type Entry = NavItem | ComingSoonItem

function render(entry: Entry) {
  switch (entry.kind) {
    case "nav":        return <Link href={entry.href}>{entry.label}</Link>
    case "comingSoon": return <span>{entry.label} (soon)</span>
  }
}
```

### Indicators
- Same prop name carrying different semantics based on another prop's value
- Optional fields that are "required in some configurations"
- `?.` chains gating behavior at render time

## I — Interface Segregation

"No client should be forced to depend on methods it does not use."

### In React — fat props

When a component has 10+ optional props and some are only relevant in specific modes:

```tsx
// BAD — one component, two implicit modes
type Props = {
  mode: "view" | "edit"
  value: string
  onChange?: (v: string) => void    // only relevant in edit
  onSubmit?: () => void             // only relevant in edit
  isDirty?: boolean                 // only relevant in edit
  readOnlyVariant?: "muted" | "primary"  // only relevant in view
}

// GOOD — two components, one shared primitive
function FieldView({ value, variant }: { value: string; variant: "muted" | "primary" }) { ... }
function FieldEdit({ value, onChange, onSubmit, isDirty }: { ... }) { ... }
// callers pick the one they need — no optional-prop nullability gymnastics
```

### Indicators
- `Props` type has >10 optional fields
- Many props are "mutually exclusive" (documented in comments, not types)
- Conditional rendering at the top of the component based on a `mode` prop

## D — Dependency Inversion

"Depend on abstractions, not concretions."

### In React — server/client boundary as the abstraction

The React Server Component + Server Action boundary IS dependency injection. The Client Component depends on the import path, not the Supabase / API client directly:

```tsx
// GOOD — Client Component depends on the Server Action, not on the Supabase client
"use client"
import { createItem } from "./actions"   // ← abstraction

export function AddButton() {
  return <button onClick={() => createItem(...)}>Add</button>
}

// server implementation can swap between Supabase, Prisma, REST — Client Component doesn't care
```

For non-action injection, pass clients or functions as props:

```tsx
function Page({
  fetchItems,
}: {
  fetchItems: () => Promise<Item[]>
}) {
  // fetchItems is the abstraction; can be supabase.from().select() or a mock
}
```

### Indicators
- Business logic file imports a concrete SDK (`new StripeClient(...)`) directly
- Hard to test without the real backend
- "We can't swap the auth provider without rewriting X"

## Decision Tree — When to Refactor

1. **File > 300 LOC**: SRP candidate. Look for 2+ change axes.
2. **Switch with 5+ arms**: OCP → Strategy Map.
3. **`instanceof` / runtime type-checks**: LSP → discriminated union.
4. **Props type with 10+ optionals**: ISP → split component.
5. **Business logic directly instantiating SDKs**: DIP → inject via props / context / Server Action.

None of these demand classes, inheritance, or abstract base types. All of them fit a function-based React codebase.

## Gotchas

- **Don't over-split.** Two tightly-coupled 50-line functions in one file is fine. Split only when change axes genuinely diverge.
- **Don't extract a hook for one caller** unless you expect a second caller soon. Keep the logic inline until a second use-site appears.
- **Extract Hook ≠ useEffect sprawl.** See the `react-effect-policy` skill — most "hooks" should be pure functions + `useMemo`, not effects.
- **Server Action splits should follow change axes, not alphabetical filing.** "crud vs view-as vs permissions" is change-axis-based; "actions-a-to-m.ts vs actions-n-to-z.ts" is not.
- **Strategy Map entries are code, not config.** Don't move them to JSON — you lose type safety and tree-shaking.

## References

- Uncle Bob's SOLID (original): https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html
- React docs on composition: https://react.dev/learn/thinking-in-react
- TypeScript discriminated unions: https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions
