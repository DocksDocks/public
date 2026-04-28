---
name: react-effect-policy
description: Use when writing or reviewing a useEffect, fixing a react-hooks/set-state-in-effect or react-hooks/exhaustive-deps lint error, debugging cascading renders, porting a class component to hooks, replacing manual useMemo/useCallback in a React-19-Compiler codebase, or adding a setTimeout/addEventListener/matchMedia subscription. Covers the 6 useEffect anti-patterns (derived state, event-handler-in-effect, state-sync-from-state, hydration-gating, external-store-reads, data-fetching-in-client), the 3 acceptable uses (DOM subscriptions, external-system sync, debounced async), and React 19 replacements: useSyncExternalStore, useDeferredValue, derived state, event handlers, next/dynamic ssr:false, React.use(), Server Actions, useDebouncedValue.
user-invocable: false
paths:
  - "**/*.tsx"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.js"
metadata:
  pattern: tool-wrapper
  updated: "2026-04-28"
---

# React useEffect Policy

<constraint>
`useEffect` is the exception, not the rule. React 19's docs are explicit: most effects in modern codebases are wrong. Before adding one, prove the code doesn't fit a faster escape hatch. Never suppress `react-hooks/set-state-in-effect` or `react-hooks/exhaustive-deps` — fix the underlying issue.
</constraint>

## When to Use

- Reviewing or writing any `useEffect` / `React.useEffect` call.
- Fixing the `react-hooks/set-state-in-effect` or `react-hooks/exhaustive-deps` lint error.
- Porting a class component with `componentDidMount` / `componentDidUpdate`.
- Debugging "my component re-renders too many times" or "my effect runs twice."
- Bridging to a DOM API (`addEventListener`, `matchMedia`, `IntersectionObserver`, `ResizeObserver`).
- Adding a `setTimeout`/`setInterval` for debouncing or polling.
- Gating content on client-only vs SSR rendering.

## Anti-patterns → Replacement

| Anti-pattern | Replacement |
|---|---|
| State derived from props or other state | Compute inline during render. No effect, no state. |
| Reacting to user events (click, submit, change) | Put logic in the event handler. Never in an effect. |
| Syncing state A from state B via `setB(transform(A))` | Derive B during render: `const b = transform(a)`. |
| `mounted` flag for SSR↔CSR hydration gating | CSS class set pre-hydration (e.g., `next-themes` writes `.dark` on `<html>`), `next/dynamic({ ssr: false })` for a whole subtree, or `React.use(clientPromise)`. |
| Reading an external store (media query, store lib, browser API) | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. |
| Fetching data in a Client Component because you "need it" | First check: can this move to a Server Component, Server Action, or route-level data fetch? If yes, do that. If truly client-only (debounced input, live filter) see acceptable cases below. |
| Deferring expensive rendering | `useDeferredValue` (CPU-priority based). Not for time-based waits. |
| Animating on mount | CSS animations (`animation: fade-in`, `@starting-style`). No effect needed. |

## Acceptable `useEffect` (the 3 allowed categories)

Every new `useEffect` in our code MUST match one of these. Document which one in a one-line comment above the effect.

### 1. Subscribing to a DOM / browser API event
- Pattern: `addEventListener` in body, `removeEventListener` in cleanup.
- Dep array is empty or stable-refs-only. Re-subscribing every render or on every state change is a bug.
- If you need current state inside the handler, either (a) read it from the DOM at handler time, or (b) hold it in a `useRef` updated during render, or (c) use functional state updaters.

```tsx
// GOOD — keyboard hotkey, empty deps, reads current state from DOM
React.useEffect(() => {
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "d") return
    const isDark = document.documentElement.classList.contains("dark")
    setTheme(isDark ? "light" : "dark")
  }
  window.addEventListener("keydown", onKeyDown)
  return () => window.removeEventListener("keydown", onKeyDown)
}, [setTheme])  // setTheme is stable from context
```

```tsx
// BAD — re-subscribes on every theme toggle
React.useEffect(() => {
  function onKeyDown(e: KeyboardEvent) {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }
  window.addEventListener("keydown", onKeyDown)
  return () => window.removeEventListener("keydown", onKeyDown)
}, [resolvedTheme, setTheme])  // ← resolvedTheme causes resubscribe
```

### 2. Synchronizing React state into an external system that has no subscription surface
- Example: writing a CSS variable, updating a canvas, pushing to a third-party widget that doesn't offer a listener.
- Rare in modern codebases. If the external system has a subscribe API, use `useSyncExternalStore` instead.

### 3. Firing an async side effect tied to a user-facing input that cannot move to a Server Action
- Example: debounced RPC call while user types, live search.
- Use `useDebouncedValue` to produce the stable trigger, then fetch inside an effect with a cancellation flag.
- Call `setLoading(true)` inside the `async function` body (not synchronously in the effect body — that trips `set-state-in-effect`).

```tsx
// GOOD — debounced async, set-state happens inside the async function
useEffect(() => {
  if (!shouldFetch) return
  let cancelled = false
  async function run() {
    setLoading(true)                    // inside async fn, ok
    try {
      const data = await fetchSomething(debouncedInput)
      if (!cancelled) setData(data)
    } finally {
      if (!cancelled) setLoading(false)
    }
  }
  run()
  return () => { cancelled = true }
}, [shouldFetch, debouncedInput])
```

## Replacement Patterns — Concrete

### `useSyncExternalStore` for media queries / browser state

```tsx
// hooks/use-mobile.ts
const MEDIA_QUERY = `(max-width: 767px)`

function subscribe(cb: () => void) {
  const mql = window.matchMedia(MEDIA_QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

function getSnapshot()       { return window.matchMedia(MEDIA_QUERY).matches }
function getServerSnapshot() { return false }

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
```

### Derived state instead of mirror-via-effect

```tsx
// BAD
const [filtered, setFiltered] = useState(items)
useEffect(() => { setFiltered(items.filter(p)) }, [items])

// GOOD
const filtered = useMemo(() => items.filter(p), [items])
// or, if cheap: const filtered = items.filter(p)
```

### SSR/CSR hydration gating — no effect needed

```tsx
// BAD — renders empty on server, then re-renders with client content
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
return mounted ? <ClientOnly /> : null

// GOOD — Next.js dynamic import with ssr:false
import dynamic from "next/dynamic"
const ClientOnly = dynamic(() => import("./client-only"), { ssr: false })
```

### Debounced value — one generic hook

```tsx
// hooks/use-debounced-value.ts — the one legitimate setTimeout-in-effect
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
```

## Gotchas

- **`setState(true)` at the top of an effect body trips `set-state-in-effect`.** Move it inside the `async function` body (the rule allows setState within a callback function scope).
- **Empty deps aren't a free pass.** If the effect references a state value, that state becomes stale. Use a ref or read from the DOM.
- **Cleanup is mandatory for subscriptions.** Always return `() => unsubscribe()`. Strict Mode double-invokes effects in dev — a missing cleanup shows up as a leak.
- **`useDeferredValue` is NOT a time-based debounce.** It's CPU-priority. For "wait 400ms then fire RPC," use `useDebouncedValue` (or any setTimeout-in-effect hook).
- **`useEffectEvent` is still experimental** in React 19 (as of 2026-04). Do not use in production; use the ref-latest pattern instead.
- **Don't "fix" an effect by burying it in a custom hook.** Extraction doesn't change correctness — it hides smell. Fix the anti-pattern first (use the replacement table above). Only extract once there's a second caller AND the logic fits one of the 3 acceptable categories. See the `react-solid` skill's Extract Hook guidance for when extraction is the right refactor.

## References

- React 19 docs: https://react.dev/reference/react/useEffect — read "You might not need an effect"
- React 19 docs: https://react.dev/learn/you-might-not-need-an-effect
- `react-hooks/set-state-in-effect` (React 19 rule) — do not suppress.
- `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
