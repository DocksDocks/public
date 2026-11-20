# React Component Composition — 6 Patterns

## Contents

- [When this applies](#when-this-applies)
- [Pattern 1 — Compound Components](#pattern-1-compound-components)
  - [When this fits](#when-this-fits)
- [Pattern 2 — Slot / `asChild`](#pattern-2-slot-aschild)
  - [When this fits](#when-this-fits-1)
- [Pattern 3 — Polymorphic `as` Prop](#pattern-3-polymorphic-as-prop)
  - [When this fits](#when-this-fits-2)
- [Pattern 4 — Headless Components (Logic-Only Hooks)](#pattern-4-headless-components-logic-only-hooks)
  - [When this fits](#when-this-fits-3)
- [Pattern 5 — Provider + Hook](#pattern-5-provider-hook)
  - [When this fits](#when-this-fits-4)
- [Pattern 6 — Variant Systems (cva / tailwind-variants)](#pattern-6-variant-systems-cva-tailwind-variants)
- [React 19 — ref-as-prop](#react-19-ref-as-prop)
- [Decision Tree](#decision-tree)
- [Common Traps](#common-traps)
- [Companion content](#companion-content)
- [References](#references)

Deep reference for composition triggers in the parent `SKILL.md`. Six composition patterns for building components that scale across callers without leaking implementation. Function-first React (React 19+ / Next.js App Router); no class components or HOCs.

## When this applies

- Building a UI primitive callers will compose differently (Tabs, Dialog, Accordion).
- A component already has 5+ optional props for visual variants (`primary | secondary | ghost | …`) — variant system territory.
- Two callers want the same logic but different markup — headless component territory.
- A wrapper element is forcing callers into a fixed tag (`<button>` when they need `<Link>`) — polymorphic or `asChild` territory.
- The same context value is consumed in 3+ places with the same boilerplate — provider + hook territory.

<constraint>
Slots / `asChild` (the Radix `<Slot>` pattern) require `React.cloneElement` and assume the child accepts the parent's props. Use them only when the parent's API is "behavior, not markup" — buttons, tooltips, links, dropdowns. Don't reach for `asChild` to avoid styling indirection; that's what variant systems are for. Match the primitive library's composition prop: Radix uses `asChild`; Base UI uses `render` (`render={<Link href="/x" />}`), and the rendered component must forward `ref` and spread all received props onto its DOM node.
</constraint>

## Pattern 1 — Compound Components

Parent owns shared state via Context; children are dot-namespaced subcomponents that read it.

```tsx
"use client";
import { createContext, useContext, useState } from "react";

const TabsContext = createContext<{ active: string; setActive: (v: string) => void } | null>(null);

function useTabs() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.* must be inside <Tabs>");
  return ctx;
}

export function Tabs({ defaultValue, children }: { defaultValue: string; children: React.ReactNode }) {
  const [active, setActive] = useState(defaultValue);
  return <TabsContext.Provider value={{ active, setActive }}>{children}</TabsContext.Provider>;
}

Tabs.List = function List({ children }: { children: React.ReactNode }) {
  return <div role="tablist">{children}</div>;
};
Tabs.Trigger = function Trigger({ value, children }: { value: string; children: React.ReactNode }) {
  const { active, setActive } = useTabs();
  return <button role="tab" aria-selected={active === value} onClick={() => setActive(value)}>{children}</button>;
};
Tabs.Panel = function Panel({ value, children }: { value: string; children: React.ReactNode }) {
  const { active } = useTabs();
  return active === value ? <div role="tabpanel">{children}</div> : null;
};
```

Caller:

```tsx
<Tabs defaultValue="overview">
  <Tabs.List>
    <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
    <Tabs.Trigger value="details">Details</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="overview">…</Tabs.Panel>
  <Tabs.Panel value="details">…</Tabs.Panel>
</Tabs>
```

### When this fits

- Parent has shared state every child reads (active tab, accordion expansion, dropdown open).
- Caller wants flexibility in layout (markup between subcomponents).
- 3+ subcomponents make sense as siblings.

## Pattern 2 — Slot / `asChild`

Parent owns behavior (handlers, ARIA, ref), child renders the markup. Implemented with `React.cloneElement`.

```tsx
import { cloneElement, isValidElement } from "react";

type SlotProps = { children: React.ReactNode } & Record<string, unknown>;

export function Slot({ children, ...rest }: SlotProps) {
  // @types/react 19: bare isValidElement() narrows props to `unknown`, which breaks the
  // spread — narrow the element type explicitly (or cast children.props) so the merge typechecks.
  if (isValidElement<Record<string, unknown>>(children)) {
    return cloneElement(children, { ...rest, ...children.props });
  }
  return null;
}

export function Button({
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp: any = asChild ? Slot : "button";
  return <Comp data-button {...props} />;
}
```

Caller picks the wrapping tag:

```tsx
// renders as <button>
<Button onClick={handleSave}>Save</Button>

// renders as <a> via Next.js Link, still gets Button's behavior + styling
<Button asChild>
  <Link href="/dashboard">Dashboard</Link>
</Button>
```

### When this fits

- Component is "behavior + styling" but the wrapping tag varies (button vs anchor vs Link).
- Avoiding the polymorphic `as` prop because Next.js Link / Remix Link have their own APIs and conflict with the `as` typing.

## Pattern 3 — Polymorphic `as` Prop

The component renders an arbitrary tag with prop types narrowed to that tag's HTML attributes.

```tsx
type AsProp<T extends React.ElementType> = { as?: T };
type PolymorphicProps<T extends React.ElementType, P> =
  AsProp<T> & P & Omit<React.ComponentPropsWithRef<T>, keyof (AsProp<T> & P)>;

export function Box<T extends React.ElementType = "div">({
  as,
  ...rest
}: PolymorphicProps<T, { padding?: number }>) {
  const Comp = as ?? "div";
  return <Comp {...rest} />;
}
```

Caller:

```tsx
<Box as="section" aria-labelledby="…">…</Box>
<Box as="a" href="/x">…</Box>
```

### When this fits

- A presentational primitive (Box, Stack, Text, Heading) that should accept any HTML tag.
- The wrapping tag is decided by the caller, not the component.

Trade-off: TS inference gets heavy and falls apart on third-party components (Next Link, framer-motion). Use `asChild` instead in those cases.

## Pattern 4 — Headless Components (Logic-Only Hooks)

The "component" is a hook returning state, derived data, and prop spreaders. Markup is 100% the caller's.

```tsx
export function useCombobox<T>({
  items,
  itemToString,
}: {
  items: T[];
  itemToString: (i: T) => string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = items.filter((i) =>
    itemToString(i).toLowerCase().includes(query.toLowerCase()),
  );

  return {
    inputProps: {
      value: query,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
      onFocus: () => setOpen(true),
    },
    listProps: { role: "listbox", hidden: !open },
    items: filtered,
  };
}
```

Caller owns markup, focus order, animations, every visual decision. This is how TanStack Table, Headless UI, and Downshift work.

### When this fits

- Two callers need the same logic but different markup.
- The component library should be headless-by-default and ship a styled layer separately (shadcn-style separation).
- The logic involves keyboard navigation, ARIA, async state — non-trivial enough that copy-pasting it would drift.

## Pattern 5 — Provider + Hook

Encapsulate Context creation, a Provider, and a typed `useFoo()` hook in one module. Callers never touch `createContext` directly.

```tsx
"use client";
import { createContext, useContext } from "react";

type ThemeValue = { mode: "light" | "dark"; toggle: () => void };
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ value, children }: { value: ThemeValue; children: React.ReactNode }) {
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
```

The `null` initial + thrown error inside the hook is the type-narrowing trick: callers always get a non-null value.

### When this fits

- Context value is consumed in 3+ places with the same boilerplate.
- `useContext(SomeContext)` returns `T | undefined` and callers always have to narrow — push the narrow into the hook.

## Pattern 6 — Variant Systems (cva / tailwind-variants)

When a component has 5+ visual variants and 3+ sizes, replace prop-driven className concatenation with a variant table.

```ts
import { cva, type VariantProps } from "class-variance-authority";

export const buttonStyles = cva(
  "inline-flex items-center rounded-md font-medium transition",
  {
    variants: {
      intent: {
        primary:     "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary:   "bg-secondary text-secondary-foreground",
        ghost:       "bg-transparent hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-lg",
      },
    },
    defaultVariants: { intent: "primary", size: "md" },
  },
);

type ButtonProps =
  React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonStyles>;

export function Button({ className, intent, size, ...rest }: ButtonProps) {
  return <button className={buttonStyles({ intent, size, className })} {...rest} />;
}
```

Pairs with the `design-tokenization` skill — variants reference semantic token classnames (`bg-primary`), never hex values.

## React 19 — ref-as-prop

```tsx
// React 18 (legacy)
const Input = forwardRef<HTMLInputElement, Props>((props, ref) => (
  <input ref={ref} {...props} />
));

// React 19 — ref is a regular prop on function components
function Input({ ref, ...props }: Props & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```

`forwardRef` still works for backwards compatibility but is slated for deprecation. New code uses ref-as-prop. Devtools display names work without the wrapper.

## Decision Tree

| Want to compose | Use |
|---|---|
| Multi-part UI with shared state (tabs, accordion, dialog) | **Compound Components** |
| Behavior + styling, caller picks the wrapping tag (Link, anchor, button) | **Slot / `asChild`** |
| Same component renders any HTML tag with typed attrs | **Polymorphic `as`** |
| Same logic, different markup (combobox, table, picker) | **Headless** (logic-only hook) |
| Context value consumed in 3+ places | **Provider + Hook** |
| 5+ visual variants × 3+ sizes | **Variant system (cva / tailwind-variants)** |

## Common Traps

| Wrong fix | Right fix |
|---|---|
| Wrap a single-callsite component in `forwardRef` "for the future" | Add ref-as-prop the moment a caller needs imperative access; not before |
| Build a polymorphic `as` API for a 2-tag component | Two named components is fine. Polymorphic earns its keep at 5+ tags |
| Fight third-party Link components with polymorphic `as` | Use `asChild` + Slot — the third party owns its markup, you own the behavior |
| Create context for 1 consumer | Pass props directly. Provider + hook earns its keep at 3+ consumers |
| Reach for compound components when there's no shared state | Children-as-prop with a discriminated `kind` — no Context overhead |
| Use cva for 2 variants | A `clsx` ternary is fine. cva earns its keep at 5+ variants |
| Add `displayName` to every component "for devtools" | Function components show their name automatically; only set it on `React.memo` / forwardRef wrappers |
| Extract an effect into a custom hook to "fix" it | Fix the anti-pattern first (see `effects.md`). Only extract once there's a second caller. 1-callsite-trap. |

## Companion content

- `effects.md` — the 3 acceptable `useEffect` categories. Composition often eliminates effects, doesn't add them.
- `solid` skill — module/interface/dependency-injection structure (composition is component-shape; SOLID is module-shape).
- `design-tokenization` skill — variant systems consume semantic tokens, not hex colors.

## References

- Radix UI Slot source: https://github.com/radix-ui/primitives/blob/main/packages/react/slot/src/slot.tsx
- TanStack Table headless docs: https://tanstack.com/table/latest/docs/introduction
- React 19 ref-as-prop release notes: https://react.dev/blog/2024/12/05/react-19#ref-as-a-prop
