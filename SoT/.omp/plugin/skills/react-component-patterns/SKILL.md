---
name: react-component-patterns
description: "Use when designing or reviewing React components — `useEffect`/`react-hooks` errors, composition APIs, Next.js RSC boundaries, or reusable shadcn/ui, Base UI, and Radix primitives. Inventory and reuse existing components first; React 19 uses ref-as-prop. Not for accessibility semantics/keyboard/ARIA (use accessibility), Tailwind/color/theme token work (use design-tokenization), visual polish (use make-interfaces-feel-better), or speculative one-caller abstractions."
user-invocable: false
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.js"
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "5ab177592d79aafa89439210627d3892305ce699cebd106e35b7e37599591ff9"
---

# React Component Patterns

Three related sub-domains:

1. **Effect discipline** — when writing or reviewing a `useEffect`, fixing `react-hooks/set-state-in-effect`, debugging cascading renders. Deep examples in [`references/effects.md`](references/effects.md).
2. **Composition patterns** — when designing a component meant to be reused or composed (compound, slot/`asChild`, polymorphic, headless, provider+hook, variant systems). Deep examples in [`references/composition.md`](references/composition.md).
3. **RSC boundary** (Next.js App Router) — when refactoring code across the Server/Client divide, debugging `Functions cannot be passed to Client Components`, or deciding where `"use client"` goes. Deep examples in [`references/rsc-boundary.md`](references/rsc-boundary.md).

<constraint>
`useEffect` is the exception, not the rule. React's "You Might Not Need an Effect" page shows that many effects are unnecessary, and that removing them makes code easier to follow and faster. Before adding one, prove the code doesn't fit a faster escape hatch. Never suppress `react-hooks/set-state-in-effect` or `react-hooks/exhaustive-deps` — fix the underlying issue.
</constraint>

<constraint>
Don't make a component reusable until a second caller genuinely needs it. The 1-callsite reuse trap costs more than the duplication it prevents — a compound or polymorphic API on a single use site is over-engineering. "We might need this elsewhere later" is not a second caller.
</constraint>

<constraint>
Inventory before invention. Search the repository's components, exports, registries (`components.json` when present), dependencies, primitives, and semantic tokens before adding an equivalent; reuse or extend what exists. Preserve an established Radix, ARIA/headless, or non-shadcn convention unless migration was explicitly requested. Only when the task establishes a new compatible React/Tailwind component system and the repository has no convention, initialize shadcn/ui with a current `base-*` style backed by Base UI and semantic CSS variables. This default never overrides the real-second-caller rule for a reusable abstraction.
</constraint>

<constraint>
React 19 made `ref` a regular prop on function components — `forwardRef` is no longer needed for new code (slated for deprecation per the React 19 release notes). Wrapping a component in `forwardRef` "for the future" adds noise and breaks devtools display names.
</constraint>

<constraint>
In Next.js App Router, a Server Component must never forward a non-serializable value (function, class instance, JSX component reference like a `lucide-react` icon) as a prop to a Client Component. Two kinds of function reference cross: Server Functions (`"use server"`), and a function or component exported from a `"use client"` module and passed through unchanged. Closures, and objects or arrays built from those exports, do not cross. Marking the shared file `"use client"` does not fix a shared data array — the array is neither a component nor a serializable value. The fix is to remove the Server Component from the import chain (Client owns the import) or to project to plain data before passing. See [`references/rsc-boundary.md`](references/rsc-boundary.md).
</constraint>

## Quick BAD/GOOD — derived state via effect

```tsx
// BAD — effect mirrors derivable state
const [filtered, setFiltered] = useState(items)
useEffect(() => { setFiltered(items.filter(p)) }, [items])

// GOOD — derive during render
const filtered = useMemo(() => items.filter(p), [items])
// or, if cheap: const filtered = items.filter(p)
```

This is the single home of the derived-state example. The full anti-pattern → replacement table for effects lives in [`references/effects.md`](references/effects.md).

## Decision Tree

| Triggered by | Read |
|---|---|
| Writing a `useEffect` or fixing a `react-hooks/*` lint error | `references/effects.md` |
| "My component re-renders too many times" / "my effect runs twice" | `references/effects.md` |
| Porting a class component with `componentDidMount` / `componentDidUpdate` | `references/effects.md` |
| Adding `addEventListener` / `IntersectionObserver` / `ResizeObserver` | `references/effects.md` § 1. Subscribing to a DOM / browser API event |
| Reading `matchMedia` or other browser state | `references/effects.md` § `useSyncExternalStore` for media queries / browser state |
| Adding `setTimeout` / `setInterval` for debouncing or polling | `references/effects.md` § Debounced value — one generic hook and § 3. Timers and async work tied to user input |
| Building a primitive callers will compose differently (Tabs, Dialog, Accordion) | `references/composition.md` § Compound |
| Existing shadcn/ui, Base UI, Radix, or project-local primitive covers the need | Reuse or extend its exported component; do not create a parallel primitive |
| Explicitly establishing a new React/Tailwind system with no repository convention | Current shadcn/ui `base-*` style backed by Base UI; route token naming/theme work to `design-tokenization` |
| Choosing wrapping tag flexibility (button vs anchor vs Link) | `references/composition.md` § Slot/`asChild` or § Polymorphic |
| Same logic, different markup (combobox, table, picker) | `references/composition.md` § Headless |
| Context value consumed in 3+ places | `references/composition.md` § Provider + Hook |
| 5+ visual variants × 3+ sizes | `references/composition.md` § Variant Systems |
| Replacing `forwardRef` in new code | `references/composition.md` § React 19 ref-as-prop |
| `Functions cannot be passed directly to Client Components` error | `references/rsc-boundary.md` § The extraction trap |
| `{$$typeof: ..., render: function, displayName: ...}` in error stack | `references/rsc-boundary.md` § What can and cannot cross |
| Extracting data/types out of a `"use client"` file into a new shared module | `references/rsc-boundary.md` § Three valid patterns |
| Deciding whether a Server Component can import an icon-using module | `references/rsc-boundary.md` § Decision Tree |

## Top Anti-Patterns (Quick-Hit)

| Anti-pattern | Fix | Reference |
|---|---|---|
| State derived from props/state via `useEffect` | Compute inline during render — no effect, no state | `effects.md` |
| Reacting to user events in `useEffect` | Move logic into the event handler | `effects.md` |
| `useEffect` `mounted` flag for SSR/CSR gating | `next/dynamic({ ssr: false })` or pre-hydration CSS class | `effects.md` |
| Reading external store via `useEffect` + `useState` | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` | `effects.md` |
| `forwardRef` for new code | React 19 ref-as-prop | `composition.md` |
| Polymorphic `as` on a 2-tag component | Two named components | `composition.md` |
| Compound components with no shared state | Children-as-prop with discriminated `kind` | `composition.md` |
| `cva` for 2 variants | `clsx` ternary — `cva` earns its keep at 5+ variants | `composition.md` |
| Server Component forwards Client-Component data (icons, `onSelect`) as a prop | Client owns the import; Server forwards only plain data, JSX, Server Functions, or unchanged `"use client"` exports | `rsc-boundary.md` |
| Rebuilding a primitive already exported by the repository or registry | Inventory first; extend the existing shadcn/ui, Base UI, Radix, or project-local primitive | SKILL.md constraint (Inventory before invention) |
| Migrating an established Radix/ARIA/non-shadcn system just to use the default | Preserve the repository convention; migrate only when explicitly requested | SKILL.md constraint (Inventory before invention) |
| Add `"use client"` to the shared file and leave the Server-Component import | Remove the Server-side import; the Server Component has no business with that data | `rsc-boundary.md` |

## When to Load Each Reference

- **`references/effects.md`** — the long-form effect policy: the 3 acceptable categories (DOM subscription, external system sync, debounced async), full anti-pattern → replacement table, concrete `useSyncExternalStore` and debounced-value implementations, gotchas around `set-state-in-effect`, `useEffectEvent`, and Strict Mode double-invocation.
- **`references/composition.md`** — the long-form composition guide: full code for all 6 patterns (compound, slot/`asChild`, polymorphic, headless, provider+hook, cva variants), React 19 ref-as-prop migration, and a Common Traps table.
- **`references/rsc-boundary.md`** — the long-form Next.js Server↔Client serialization guide: serializable-types table (paraphrased from the React docs, with local-guidance rows marked), the NAV_GROUPS-style extraction trap with BAD/GOOD code, the three valid sharing patterns (client-only module, plain-data projection, children slot), decision tree for `"use client"` placement, and gotchas around `"use client"` contagion direction and JSX-element vs component-reference confusion.

## Companion Skills

- `solid` — module/interface/dependency-injection structure (composition is component-shape; SOLID is module-shape).
- `design-tokenization` — variant systems consume semantic tokens, not hex colors.
- `type-safety-discipline` — branded IDs, discriminated unions, `parse-don't-validate` at boundaries.

## References

- React 19 release notes (ref-as-prop): https://react.dev/blog/2024/12/05/react-19#ref-as-a-prop
- React 19 "You might not need an effect": https://react.dev/learn/you-might-not-need-an-effect
- React 19 `use client` (serialization rules): https://react.dev/reference/rsc/use-client
- Next.js Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
- Radix UI Slot source: https://github.com/radix-ui/primitives/blob/main/packages/react/slot/src/slot.tsx
- TanStack Table headless docs: https://tanstack.com/table/latest/docs/introduction

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
