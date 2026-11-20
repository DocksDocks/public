# useEffect — Discipline & Replacement Patterns

## Contents

- [When this applies](#when-this-applies)
- [Anti-patterns → Replacement](#anti-patterns-replacement)
- [Acceptable `useEffect` (the 3 allowed categories)](#acceptable-useeffect-the-3-allowed-categories)
  - [1. Subscribing to a DOM / browser API event](#1-subscribing-to-a-dom-browser-api-event)
  - [2. Synchronizing React state into an external system that has no subscription surface](#2-synchronizing-react-state-into-an-external-system-that-has-no-subscription-surface)
  - [3. Timers and async work tied to user input](#3-timers-and-async-work-tied-to-user-input)
- [Replacement Patterns — Concrete](#replacement-patterns-concrete)
  - [`useSyncExternalStore` for media queries / browser state](#usesyncexternalstore-for-media-queries-browser-state)
  - [Derived state instead of mirror-via-effect](#derived-state-instead-of-mirror-via-effect)
  - [SSR/CSR hydration gating — no effect needed](#ssrcsr-hydration-gating-no-effect-needed)
  - [Debounced value — one generic hook](#debounced-value-one-generic-hook)
- [Gotchas](#gotchas)
- [References](#references)

Deep reference for effect-related triggers in the parent `SKILL.md`. The 3 acceptable `useEffect` categories, the anti-pattern → replacement table, and concrete code for `useSyncExternalStore`, debounced-value, and SSR/CSR gating.

## When this applies

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
| `mounted` flag for SSR↔CSR hydration gating | A CSS class or attribute set before hydration (e.g., `next-themes` with `attribute="class"` sets `.dark` on `<html>`), or `dynamic(() => import(...), { ssr: false })` for a whole subtree. |
| Reading an external store (media query, store lib, browser API) | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. |
| Fetching data in a Client Component because you "need it" | First check: can this move to a Server Component, Server Action, or route-level data fetch? If yes, do that. If truly client-only (debounced input, live filter) see acceptable cases below. |
| Loading flag set synchronously at the top of an effect | Derive `loading` during render from state you already have, or set it in the event handler that starts the work. Call setState only in the async callback (`.then`). |
| Deferring expensive rendering | `useDeferredValue` (CPU-priority based). Not for time-based waits. |
| Animating on mount | CSS animations (`animation: fade-in`, `@starting-style`). No effect needed. |

## Acceptable `useEffect` (the 3 allowed categories)

<constraint>
Every new `useEffect` must match exactly one of the 3 categories below (DOM/browser subscription, syncing into a no-subscribe external system, or timers and async work tied to user input). Document which one with a one-line comment above the effect (e.g., `// effect category 1: DOM subscription`). If it doesn't match any, the code belongs in a render-time computation, an event handler, or a Server Action — not an effect.
</constraint>

### 1. Subscribing to a DOM / browser API event

- Pattern: `addEventListener` in body, `removeEventListener` in cleanup.
- Keep deps to values that really change the subscription. Re-subscribing on every state change is wasteful, not wrong.
- If you need current state inside the handler, either (a) read it from the DOM at handler time, (b) wrap the handler in `useEffectEvent` (stable since React 19.2), or (c) use a functional state updater. On React <19.2, (c) can also be a latest-value ref that you update in `useLayoutEffect`/`useEffect` — never during render.

```tsx
// GOOD — keyboard hotkey, reads current state from DOM
// effect category 1: DOM subscription
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
// WASTEFUL — unnecessary resubscribe on every theme toggle
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

### 3. Timers and async work tied to user input

- Examples: the timer inside `useDebouncedValue`, polling with `setInterval`, a debounced RPC call while the user types, live search that cannot move to a Server Action.
- Use `useDebouncedValue` to produce the stable trigger, then fetch inside an effect with a cancellation flag.
- Do not call setState synchronously in the effect body, and do not hide it in a local function that the effect calls (the lint follows local functions). Derive `loading` during render. Call setState only in the async callback.
- For polling, clear the interval in cleanup. Read changing values in the tick with `useEffectEvent` so the interval does not restart.

```tsx
// GOOD — debounced async; loading is derived, setState runs only in .then
// Store failures the same way (keyed by input) so `loading` ends on error.
const [result, setResult] = useState<{ input: string; data: Data } | null>(null)
const loading = shouldFetch && result?.input !== debouncedInput

// effect category 3: async work tied to user input
useEffect(() => {
  if (!shouldFetch) return
  let cancelled = false
  fetchSomething(debouncedInput).then((data) => {
    if (!cancelled) setResult({ input: debouncedInput, data })
  })
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

The BAD/GOOD example lives in the parent `SKILL.md` § Quick BAD/GOOD — derived state via effect. The rule is the first row of the anti-pattern table above.

### SSR/CSR hydration gating — no effect needed

```tsx
// BAD — renders empty on server, then re-renders with client content
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
return mounted ? <ClientOnly /> : null

// GOOD — Next.js dynamic import with ssr:false
// Next 15+: `ssr: false` is Client-Component-only — call it in a "use client" file
// (a Server Component rejects it at build time)
import dynamic from "next/dynamic"
const ClientOnly = dynamic(() => import("./client-only"), { ssr: false })
```

### Debounced value — one generic hook

```tsx
// hooks/use-debounced-value.ts — the one legitimate setTimeout-in-effect
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  // effect category 3: timer tied to user input
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}
```

<constraint>
Cleanup is mandatory for every subscription effect. Always return `() => unsubscribe()` (or `() => clearTimeout(id)`, `() => mql.removeEventListener(...)`, etc.). Strict Mode double-invokes effects in development; a missing cleanup surfaces as a leak in dev and is a real leak in production.
</constraint>

## Gotchas

- **`setLoading(true)` at the top of an effect body trips `set-state-in-effect`.** Moving it into an async function that the effect calls does not fix it: the call is still synchronous, and the lint follows local functions. Derive `loading` during render (see § 3), or set it in the event handler that starts the work.
- **Empty deps aren't a free pass.** If the effect references a state value, that state becomes stale, and `exhaustive-deps` flags it. Use `useEffectEvent` (React ≥19.2), read from the DOM, or use a functional updater. On older React, use a latest-value ref that you update in an effect.
- **`useDeferredValue` is NOT a time-based debounce.** It's CPU-priority. For "wait 400ms then fire RPC," use `useDebouncedValue` (or any setTimeout-in-effect hook).
- **`useEffectEvent` is stable since React 19.2** (eslint-plugin-react-hooks v6 understands it). Use it for non-reactive logic that is really an event fired from the effect (e.g., a listener that reads the latest theme). Values that must re-run the effect stay in the dependency array; never use it only to silence `exhaustive-deps`. On React <19.2, use a latest-value ref that you update in an effect, never during render. https://react.dev/reference/react/useEffectEvent
- **Don't "fix" an effect by burying it in a custom hook.** Extraction doesn't change correctness — it hides smell. Fix the anti-pattern first (use the replacement table above). Only extract once there's a second caller AND the logic fits one of the 3 acceptable categories. Generic utilities such as `useDebouncedValue` and `useIsMobile` are exempt. See `composition.md` § Common Traps for the 1-callsite-trap rule.

## References

- React 19 docs: https://react.dev/reference/react/useEffect — read "You might not need an effect"
- React 19 docs: https://react.dev/learn/you-might-not-need-an-effect
- `react-hooks/set-state-in-effect` (compiler-powered `eslint-plugin-react-hooks` rule, in `recommended` since plugin v7) — do not suppress. https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
- `react-hooks/refs` (never read or write `ref.current` during render): https://react.dev/reference/eslint-plugin-react-hooks/lints/refs
- `useSyncExternalStore`: https://react.dev/reference/react/useSyncExternalStore
