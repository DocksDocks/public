# RSC Boundary — Server↔Client Serialization

## Contents

- [When this applies](#when-this-applies)
- [What can and cannot cross Server→Client as props](#what-can-and-cannot-cross-serverclient-as-props)
- [The extraction trap (NAV_GROUPS-style)](#the-extraction-trap-nav_groups-style)
- [Three valid patterns for sharing across the boundary](#three-valid-patterns-for-sharing-across-the-boundary)
  - [Pattern A — Client-only shared module](#pattern-a-client-only-shared-module)
  - [Pattern B — Server-fetched plain data](#pattern-b-server-fetched-plain-data)
  - [Pattern C — Children-as-slot interleaving](#pattern-c-children-as-slot-interleaving)
- [Decision Tree](#decision-tree)
- [Common Traps](#common-traps)
- [Gotchas](#gotchas)
- [References](#references)

Deep reference for the React Server Components serialization boundary in Next.js App Router. Covers what crosses Server→Client as props, what doesn't, the extraction trap that crashes Lucide-icon-style nav data, and the three valid patterns for sharing code across the boundary.

## When this applies

- Refactoring a Client Component into multiple files (extracting data, types, helpers).
- Seeing `Error: Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server"`.
- Seeing `{$$typeof: ..., render: function, displayName: ...}` in an error stack from `stringify` — a React component reference (often `lucide-react`, `react-icons`, `@radix-ui`) is being serialized.
- Touching a file in `app/**` that imports something from a Client Component or vice versa.
- Adding `"use client"` to a file and wondering whether existing Server Component importers still work.
- Reviewing a Server Component prop list (`<ClientThing foo={X} />`) where `X` came from an `import`.

## What can and cannot cross Server→Client as props

Authoritative source: <https://react.dev/reference/rsc/use-client> § Serializable types and § Caveats. The table paraphrases those sections. Rows marked *(local guidance)* are not in the React docs.

| Crosses (serializable) | Does NOT cross |
|---|---|
| Primitives: `string`, `number`, `bigint`, `boolean`, `undefined`, `null`, globally-registered `Symbol.for(...)` | Locally-created symbols (`Symbol('x')`) |
| `Array`, `Map`, `Set`, `TypedArray`, `ArrayBuffer`, `Date`, `Promise` | Classes and instances of any user-defined class |
| Plain objects (object literals, only serializable properties) | Objects with a `null` prototype, or any non-built-in class instance |
| Server Functions — functions in a `"use server"`-marked module or with a top-of-function `'use server'` directive | Regular functions, closures, methods, arrow functions that are not exported from a `"use client"` module |
| Client or Server Component **elements** (JSX you have already rendered: `<Foo bar={1} />`) | Component **references** that are not exported from a `"use client"` module (the bare `Foo` identifier — `$$typeof` + `render` / `displayName` shape) *(local guidance)* |
| A function or component **exported from a `"use client"` module**, passed through unchanged (it crosses as a client reference) | An array or object built from `"use client"` exports (for example `[{ icon: Building2, onSelect }]`): it is neither a component nor a serializable value |

Rule: a Server Component can forward a value it imported from a `"use client"` module only when that value is a React component or a serializable value. Any other value throws. Marking a file `"use client"` does not serialize its exports; it only puts the file in the client module graph.

## The extraction trap (NAV_GROUPS-style)

Pattern: a Client Component owns some data with non-serializable contents (icon component refs, `onSelect` closures). A refactor extracts the data into a new file `nav-groups.ts`, then has the Server Component (`app-shell.tsx`) import and forward it as a prop. Boom.

```tsx
// BAD — Server Component forwards non-serializable data
// app/(app)/nav-groups.ts        (no directive — ambient)
import { Building2, Users } from "lucide-react"
export const NAV_GROUPS = [
  { label: "Admin", items: [
    { kind: "link",   label: "Buildings", icon: Building2, href: "/admin/buildings" },
    { kind: "action", label: "Calculadora", icon: Users, onSelect: () => store.toggle() },
  ]},
]

// app/(app)/app-shell.tsx        (Server Component — default)
import { NAV_GROUPS } from "./nav-groups"
import { SidebarNav } from "@/components/sidebar-nav"   // "use client"
export default function AppShell() {
  return <SidebarNav navGroups={NAV_GROUPS} />          // ← icons + onSelect serialize → crash
}
```

Adding `"use client"` to `nav-groups.ts` does NOT fix it. `NAV_GROUPS` is an array of objects that holds component references and closures. It is neither a React component nor a serializable value, so the Server Component cannot forward it as a prop.

```tsx
// GOOD — Client Component owns the import; Server is out of the loop
// app/(app)/nav-groups.ts        ("use client" — see Pattern A below)
"use client"
import { Building2, Users } from "lucide-react"
export const NAV_GROUPS = [ /* ...same as above... */ ]

// components/sidebar-nav.tsx     ("use client")
"use client"
import { NAV_GROUPS } from "@/app/(app)/nav-groups"     // client → client, fine
export function SidebarNav({ effectivePermissions }: { /* ... */ }) {
  return <>{NAV_GROUPS.map(/* ... */)}</>
}

// app/(app)/app-shell.tsx        (Server Component)
import { SidebarNav } from "@/components/sidebar-nav"
export default function AppShell() {
  return <SidebarNav effectivePermissions={perms} />    // ← only plain data crosses
}
```

## Three valid patterns for sharing across the boundary

### Pattern A — Client-only shared module
The module contains functions, component refs, JSX, or class instances. Mark it `"use client"` and import it **only** from `"use client"` files. The Server Component must not touch it. Add a load-bearing comment to the module explaining the constraint so the next refactor doesn't re-introduce the Server import.

### Pattern B — Server-fetched plain data
The Server Component reads from a DB / API / config, then passes the result as a prop. The data must be plain (primitives, plain objects/arrays, `Date`, `Map`, `Set`, Server Functions). Strip everything else before passing: no class instances (convert ORM rows to plain objects), no methods (extract to top-level functions or to Server Functions), no icon refs (pass an enum key — `icon: "users"` — and let the Client Component look up the component locally).

### Pattern C — Children-as-slot interleaving
A Client Component takes `children: React.ReactNode`; the Server Component renders other Server Components as that child. Server-rendered JSX **elements** cross fine; component **references** do not. This is the Next.js-documented `<Modal>{<Cart />}</Modal>` pattern.

## Decision Tree

| Situation | Pattern |
|---|---|
| Module contains icon refs / event closures / class instances, consumed only by Client UI | Pattern A — mark `"use client"`, never import from a Server Component |
| Server-side data (DB row, config) consumed by Client UI | Pattern B — pass plain data only; strip non-serializable fields |
| Need to nest a Server-rendered subtree inside a Client wrapper | Pattern C — accept `children` in the Client Component |
| Need to pass a server-side mutation to a Client Component | `'use server'` Server Function. The only other function references that cross are exports of a `"use client"` module passed through unchanged; closures built in server code never cross |
| Need React Context (theme, store, query client) on the server | Create a `"use client"` provider; render it from a layout that wraps `{children}` |

## Common Traps

| Wrong fix | Right fix |
|---|---|
| Add `"use client"` to the shared data file and leave the Server Component import | Remove the Server Component import; have the Client Component import directly (Pattern A) |
| Pass the function as `() => someClient()` from a Server Component | Make it a Server Function with `'use server'`, OR import it inside the Client Component |
| Pass an icon component ref (`icon: BuildingIcon`) as a prop from Server→Client | Pass an enum key (`icon: "building"`) and let the Client Component map key→component locally |
| Wrap the Server Component in `"use client"` to "fix" the error | Keep the boundary where it belongs; the Server Component shouldn't have been touching the data |
| Mark every file `"use client"` to be safe | Shrinks the Server bundle benefit; data and secrets that should stay server-side leak into the client bundle |
| Pass an ORM/Mongoose/Prisma instance from `getX()` to a Client Component | Project to a plain DTO at the Server Component boundary (`.toJSON()`, `JSON.parse(JSON.stringify(...))`, or an explicit mapper) |

## Gotchas

- **`"use client"` is contagious downward, not upward.** A `"use client"` module's *imports* enter the client module graph automatically — but a Server Component upstream that imports the same module still operates in the server graph and will try to serialize values when forwarding them as props.
- **`children` in a Client Component is special.** Server Components rendered as `children` are rendered on the server **as JSX elements** and cross the boundary fine. This is why context providers work — the provider is `"use client"`, its `{children}` is whatever the layout passes (often Server-rendered).
- **The error's `digest` is opaque on purpose.** In production, Next.js hides the full error and shows a digest. Reproduce in dev (`pnpm dev`) to see the `{$$typeof: ..., render: function}` shape — that's the smoking gun pointing at a component reference being serialized.
- **`lucide-react`, `react-icons`, `@heroicons/react`, `@radix-ui/react-icons`, `@tabler/icons-react` are all `forwardRef` / function components.** Their exported identifiers are component references with `$$typeof`; they crash the same way `Building2` crashes if forwarded from a Server Component as a prop value.
- **A Server Component CAN render `<Building2 />` directly** — that's a JSX element, which serializes as rendered output, not as the bare reference. The crash is only when the bare identifier (or an object containing it) is the prop value.
- **`server-only` and `client-only` (npm packages) add a build-time fence.** Import `'server-only'` in a module that must never enter the client bundle; import `'client-only'` in a module that must never enter the server bundle. Useful belt-and-suspenders for the "Pattern A file must never be Server-imported" rule.

## References

- React 19 `use client` directive (serializable types): <https://react.dev/reference/rsc/use-client>
- React 19 `use server` directive (Server Functions): <https://react.dev/reference/rsc/use-server>
- Next.js Server and Client Components: <https://nextjs.org/docs/app/getting-started/server-and-client-components>
- Next.js `use client` API reference: <https://nextjs.org/docs/app/api-reference/directives/use-client>
- `server-only` / `client-only` packages: <https://www.npmjs.com/package/server-only>
