---
name: nextjs-conventions
description: Use when working on a Next.js 13/14/15/16 project — adding a page, route handler, middleware/proxy, Server Action, Server Component, Client Component boundary, handling SSR/CSR hydration, configuring Turbopack, debugging cookies or auth, or upgrading between Next versions. Covers the Next.js 16 middleware → proxy.ts rename (proxy() function, nodejs runtime only), App Router conventions (page.tsx / layout.tsx / loading.tsx / error.tsx / route.ts / not-found.tsx), server-first principle (Server Components read, Server Actions write, avoid client fetches), "use client" boundary rules, cookies() / headers() async access in Next 15+, searchParams / params as Promises, hydration gating (next/dynamic ssr:false, React.use, CSS-class pre-hydration), streaming + Suspense, route groups ((group)), dynamic segments [id] and catch-all [...slug], parallel routes @slot, NEXT_PUBLIC_ env prefix, Turbopack dev vs webpack prod, and the revalidatePath/revalidateTag cache API.
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-04-18"
---

# Next.js App Router Conventions

<constraint>
Server-first: every data read is a Server Component, every mutation is a Server Action. Client Components exist only for interaction (onClick, form state, keyboard handlers). Never fetch in a Client Component if the same data can be fetched on the server.
</constraint>

## When to Use

- Creating a new route, layout, loading state, or error boundary.
- Writing a Server Action or deciding if a function should be one.
- Deciding where to put `"use client"`.
- Renaming `middleware.ts` → `proxy.ts` (Next.js 16+).
- Fixing hydration mismatches or SSR/CSR render drift.
- Reading cookies / headers / searchParams in Next 15+.
- Debugging Turbopack dev behavior vs production build.
- Upgrading Next.js across major versions.

## Next.js 16 Conventions (2025-11+)

### `middleware.ts` → `proxy.ts` (2025 rename)

| Before (≤v15) | After (v16+) |
|---|---|
| `middleware.ts` at app root | `proxy.ts` at app root |
| `export function middleware(req) { }` | `export function proxy(req) { }` |
| `export const config = { matcher: [...] }` | `export const config = { matcher: [...] }` (unchanged) |
| Runs on edge runtime | **Runs on nodejs runtime only** (edge removed) |

Helper modules with "middleware" in their name (e.g., `lib/supabase/middleware.ts` exporting `updateSession`) are NOT convention files — do NOT rename those. Only the root-level convention file changed.

### Route file names (App Router)

| File | Purpose |
|---|---|
| `page.tsx` | The route itself. Default export is the page component. |
| `layout.tsx` | Wraps all children routes. Nested layouts accumulate. |
| `loading.tsx` | React Suspense boundary for the segment. |
| `error.tsx` | React ErrorBoundary. Must be `"use client"`. |
| `not-found.tsx` | Rendered when `notFound()` is called. |
| `route.ts` | API-style handler (GET/POST/etc). No `page.tsx` in same dir. |
| `proxy.ts` | Cross-cutting request processing (v16+). Root-level only. |
| `global-error.tsx` | Root-level error boundary. Must be `"use client"`. |

### Directory patterns

| Pattern | Meaning |
|---|---|
| `app/(group)/...` | Route group — URL path does NOT include `(group)`. Use for organizing without affecting URLs. |
| `app/[id]/page.tsx` | Dynamic segment. `params` is `{ id: string }`. |
| `app/[...slug]/page.tsx` | Catch-all. `params` is `{ slug: string[] }`. |
| `app/[[...slug]]/page.tsx` | Optional catch-all. `params.slug` may be undefined. |
| `app/@modal/page.tsx` | Parallel route slot. Renders into a named `{modal}` prop in the parent layout. |
| `app/.../default.tsx` | Fallback for unmatched parallel route slots. |

## Async Conventions (Next.js 15+)

`cookies()`, `headers()`, `params`, `searchParams` are all async. Always `await` them.

```tsx
// Next.js 15+
import { cookies, headers } from "next/headers"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { id } = await params
  const { date } = await searchParams
  const jar = await cookies()
  const h = await headers()
  // ...
}
```

## Server-first Architecture

```tsx
// GOOD — Server Component reads
import { createClient } from "@/lib/supabase/server"
export default async function Page() {
  const supabase = await createClient()
  const { data } = await supabase.from("items").select("*")
  return <Items data={data} />
}
```

```tsx
// GOOD — Server Action writes
"use server"
export async function createItem(formData: FormData) {
  const supabase = await createClient()
  await supabase.from("items").insert(/* ... */)
  revalidatePath("/items")
}
```

```tsx
// BAD — client fetch when a Server Component would do
"use client"
useEffect(() => { fetch("/api/items").then(setItems) }, [])
```

## `"use client"` Boundary Rules

- A `"use client"` file is a Client Component **and all its imports (that themselves use client features) must also be client-compatible**.
- Server Components can import Client Components freely (the boundary is one-way).
- Client Components CANNOT import Server Components directly — pass them as children via props.
- `async` Client Components are not allowed (use React.use or `useActionState`).
- Server Actions can be imported into Client Components — that's the canonical data-mutation channel.

## SSR / CSR Hydration

```tsx
// BAD — useEffect "mounted" flag defeats SSR entirely
const [mounted, setMounted] = useState(false)
useEffect(() => setMounted(true), [])
if (!mounted) return null

// GOOD — dynamic import with ssr:false for genuinely client-only widgets
import dynamic from "next/dynamic"
const ClientOnly = dynamic(() => import("./chart"), { ssr: false })
```

```tsx
// GOOD — driven by a pre-hydration CSS class (e.g., next-themes sets .dark on <html>)
<div className="hidden dark:block">Moon icon</div>
<div className="block dark:hidden">Sun icon</div>
```

## Caching & Revalidation

| API | When to use |
|---|---|
| `revalidatePath("/path")` | After a mutation that affects a specific route. |
| `revalidateTag("tag")` | After a mutation that affects tagged fetch calls. |
| `export const dynamic = "force-dynamic"` | Route must re-render on every request (typically auth-gated). |
| `export const revalidate = 60` | ISR — regenerate every 60 seconds. |

## Environment Variables

- **Browser-safe**: prefix with `NEXT_PUBLIC_`. Inlined at build time. Never use for secrets.
- **Server-only**: no prefix. Available in Server Components, Server Actions, Route Handlers, `proxy.ts`.
- `.env.local` is git-ignored by default. Document required vars in `.env.example`.

## Gotchas

- **`proxy.ts` runs on Node.js runtime only** in v16. If you're importing edge-only code, it breaks. Conversely, you can now use Node APIs (`crypto`, `fs`) that edge couldn't handle.
- **Server Actions don't have access to cookies set mid-response** until the next request. Use `revalidatePath` + client-side navigation.
- **`params` as a Promise breaks typed page props** — update your type declarations.
- **Turbopack dev cold-starts are slow.** `pnpm dev` compiles each route on first hit. Prod (`next build`) uses webpack and doesn't have this latency.
- **`dynamic = "force-dynamic"` disables ISR**, not just static caching. Use sparingly.
- **Auto-generated types** from Supabase or similar belong in a generated file — regenerate after migrations.

## References

- Next.js 16 release notes: https://nextjs.org/blog/next-16
- App Router docs: https://nextjs.org/docs/app
- Server Actions: https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations
- Hydration: https://nextjs.org/docs/messages/react-hydration-error
