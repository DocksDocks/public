---
name: design-tokenization
description: "Use when working with colors, Tailwind classes, CSS variables, dark mode, semantic/brand tokens, or theming shadcn/ui, Base UI, or Radix components. Also audits hex literals, soft tints, paired foreground tokens, and Tailwind v4 @source. Preserve the project's bg-X/text-on-X or bg-X/text-X-foreground convention. Not for accessibility semantics/keyboard/ARIA (use accessibility), React composition/effects/RSC (use react-component-patterns), or spacing/motion/radius polish (use make-interfaces-feel-better)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "3c341f36e34da1d5c1d065b2caab992a96916ad6531f6c24b2cb12c606019161"
---

# Design Tokenization

<constraint>
No hex color literals in application code. Every visible color routes through a token — either `var(--token)` or a Tailwind utility that resolves to one (`bg-primary`, its project-convention foreground utility, `bg-whatsapp`). Hex literals belong in exactly one place: the token DEFINITIONS in the canonical stylesheet (`:root` and `.dark` blocks). Anywhere else, hex is a bug.
</constraint>

<constraint>
Every token defined in `:root` must also be defined in `.dark`. A token defined in only one block silently breaks contrast in the other mode. Custom properties inherit: a token only in `:root` keeps its light value in dark mode. A token only in `.dark` is undefined in light mode, so `var()` is invalid and the property falls back to its inherited or initial value. Treat the two blocks as a contract: edit both in the same change.
</constraint>

<constraint>
Brand tokens and semantic tokens never mix. A token named after a third-party company (`whatsapp`, `stripe`, `google`) must never be used for a non-brand surface. A semantic token (`primary`, `destructive`, `success`) must never carry a vendor's official hex value. Mixing the two layers makes future redesigns drag third-party brands along, or causes brand drift on a future success-state recolor.
</constraint>

<constraint>
Inventory before adding tokens or tooling. Read the canonical stylesheet, Tailwind configuration, `components.json`/registry when present, installed primitive dependencies, and existing token usages; reuse what exists. Preserve the repository's `on-*` versus `*-foreground` naming and its established Radix, ARIA/headless, or non-shadcn component convention. Only when the task establishes a new compatible React/Tailwind system and no convention exists, use shadcn/ui with a current `base-*` style backed by Base UI and semantic CSS variables. Never imply a migration from an existing system.
</constraint>

## When to Use

- Adding a new color anywhere — if your hand reaches for `#abcdef` outside the token stylesheet, stop here first
- Building a button / badge / surface that ties to a third-party brand (WhatsApp share, Stripe pay, Google sign-in)
- Setting up dark mode for a new project, or fixing dark-mode contrast bugs
- Auditing a project for hex literals, alpha-modifier soft tints, or missing paired tokens
- Reviewing a PR that touches `index.css`, `globals.css`, `tailwind.config.*`, or any styled component
- Migrating a project from hardcoded colors to a tokenized system
- Tailwind v4 questions about `@source`, `@custom-variant`, `@theme inline`, or class-purge regressions
- Theming shadcn/ui, Base UI, or Radix primitives without changing their React composition API

## The Two-Layer Token System

Every color in the app falls into exactly one of two layers. Mixing them is the most common drift mode.

### Layer 1 — Semantic tokens (intent, not appearance)

Names describe *what the color means in the app*, not what it looks like.

| Token family | Intent | Examples |
|---|---|---|
| `background` / `on-background` | Default page surface | App body, modals, sheets |
| `primary` / `on-primary` | Main brand action color | Primary CTA, active nav |
| `secondary` / `on-secondary` | Subordinate action | Secondary buttons, chips |
| `destructive` / `on-destructive` | Dangerous/irreversible action | Delete, drop, force-cancel |
| `success` / `on-success` | Confirmed positive outcome | Save toast, "deployed" badge |
| `warning` / `on-warning` | Attention required, not error | Quota near, rate-limit advisory |
| `muted` / `on-muted` | Disabled or de-emphasized | Disabled buttons, secondary text |

Rule: **never use a generic visual name** (`bg-blue`, `bg-red`, `bg-green`) for a semantic role. If a button means "delete," it's `bg-destructive`, not `bg-red`.

### Layer 2 — Brand tokens (third-party identity)

When you display a third-party service's brand color, use a brand-named token. Brand tokens are still tokens — vendor-fixed values, defined in the canonical stylesheet, used through utilities.
The table below illustrates the `on-*` form; in a `*-foreground` project, use the corresponding `<brand>-foreground` name instead.

| Brand token | Hex (def-only) | Use case |
|---|---|---|
| `whatsapp` / `on-whatsapp` | `#25D366` | Share-to-WhatsApp |
| `stripe` / `on-stripe` | `#635BFF` | Stripe-branded checkout |
| `google` / `on-google` | `#4285F4` | "Sign in with Google" |
| `github` / `on-github` | `#181717` | "Continue with GitHub" |
| `spotify` / `on-spotify` | `#1ED760` | "Listen on Spotify" |
| `discord` / `on-discord` | `#5865F2` | "Join our Discord" |

Why brand tokens, not generic `bg-green` for WhatsApp:

1. **Identity drift** — WhatsApp's brand green ≠ your `success` green. A future "success" recolor would silently rebrand WhatsApp.
2. **Searchability** — `grep "bg-whatsapp"` finds every WhatsApp surface. `grep "bg-green-500"` returns ambiguous noise.
3. **Vendor compliance** — many brand guidelines require the exact official hex; the brand token freezes it.
4. **Per-brand dark mode** — some brands publish dark-mode variants. The token gives you the slot.

## The Paired-Token Contract (`bg-X` ↔ project foreground)

Every background token has a paired foreground guaranteed legible against it. This prevents the classic dark-mode contrast bug where `bg-primary` flips dark but the text on top doesn't.

```css
:root {
  --primary: 222 80% 50%;
  --on-primary: 0 0% 100%;        /* white on blue */
}
.dark {
  --primary: 222 70% 60%;
  --on-primary: 222 50% 10%;      /* dark text now reads */
}
```

In components: **never write `bg-primary` without its paired foreground utility** (`text-on-primary` or `text-primary-foreground`, matching the project), unless the surface has no text on it (decorative bar, divider, progress fill).

Two naming conventions exist. Detect the repository's established form and preserve it project-wide:
- `bg-X` / `text-on-X` (`on-*` convention)
- `bg-X` / `text-X-foreground` (shadcn/ui convention, including current Base UI-backed `base-*` styles)

If neither exists and the task explicitly establishes a new compatible shadcn/ui system, use its `*-foreground` convention. Never mix forms or silently migrate an established `on-*` project.

## Soft Tints — X-Tint Triple, Not Alpha Modifiers

```html
<!-- Wrong fix: alpha modifier produces unpredictable contrast in dark mode -->
<div class="bg-destructive/15 text-destructive border-destructive/30">…</div>

<!-- Right fix: triple of dedicated tokens, each with :root + .dark values -->
<div class="bg-destructive-tint text-on-destructive-tint border-destructive-tint-border">…</div>
```

`bg-destructive/15` collapses the destructive HSL with 15% alpha against whatever sits behind it — pink on a white card, near-invisible on a dark card. The X-tint triple gives full control over the *resolved* color in each mode.

Exception — alpha modifiers ARE allowed for hover/active states on the same base token (`bg-primary hover:bg-primary/90`). Same color, modulated transparency for state feedback — no contrast drift.

## Tailwind v4 — @source and Class-Purge

Tailwind v4 (`@tailwindcss/vite`) auto-detects sources from the current working directory. It skips `.gitignore`'d paths, `node_modules`, binary files, CSS files, and package-manager lock files. In a monorepo where the build runs from the repo root, set the scan base with `@import "tailwindcss" source("../src");`. Add `@source` (relative to the stylesheet) for every directory the heuristic misses (monorepo siblings, `shared/`, gitignored build trees):

```css
/* Wrong fix: misses src/shared/ — classes there get purged */
@source "../../renderer";

/* Right fix: cover every directory with class names */
@source "../../renderer";
@source "../../shared";
```

Symptom of missing `@source`: layout/button "collapses" because `w-12` / `left-1/2` / `-translate-x-1/2` resolved at dev time but disappeared in prod. Always check `@source` coverage when a class works in dev but not prod.

## Decision Tree — Adding a New Color

```
Need a new color in a component →
  ├─ Is it a third-party brand (Google, Stripe, WhatsApp, etc.)?
  │   └─ YES → brand token. Define in :root AND .dark (same value unless the vendor publishes a dark variant).
  │           Use bg-{brand} + the project's paired foreground. Done.
  │   └─ NO → continue
  ├─ Does an existing semantic token cover the intent?
  │   └─ YES → use the existing token. Don't create a new one.
  │   └─ NO → continue
  ├─ Is the color genuinely new app intent that isn't already named?
  │   └─ YES → propose a new semantic token. Add to :root AND .dark.
  │           Add @theme inline entry. Pair it using the project's established naming.
  │   └─ NO → reuse existing.
```

## Audit & Migration Playbook

Four-step procedure. Don't skip the audit — proposing token names without seeing actual usage produces wrong abstractions.

1. **Audit (read-only)** — run the four greps in `references/audit-and-greps.md` against the project root. Categorize matches: hex-in-app, generic-palette-as-semantic, brand colors hidden as hex, alpha-modifier tints, unpaired backgrounds.
2. **Propose** — list every distinct hex, group near-duplicates (within ~3% HSL), and produce a token table classified as semantic or brand. Preserve the existing foreground naming. An audit-only or proposal-only request stops after this table. For an implementation request, continue without a blanket confirmation pause; ask only if no project evidence resolves a materially different naming or brand-identity choice.
3. **Apply** — add tokens to BOTH `:root` and `.dark` in the canonical stylesheet (see `references/canonical-stylesheet.md` for the full shape). Update `@theme inline`. Replace hex in app code. Add paired foregrounds. Convert alpha tints to X-tint triples. Reuse existing components and tokens rather than creating a parallel theme surface.
4. **Lock** — gate greps 1 and 2 in pre-commit / CI. Greps 3 and 4 need manual review, so keep them in the audit only. Script in `references/audit-and-greps.md`.

## Common Traps

| Trap | Wrong fix | Right fix |
|---|---|---|
| "Save successful" toast | `bg-green-500` | `bg-success`, defined once with the project's paired foreground |
| WhatsApp share button | `bg-green-500` (same color, but coincidence) | `bg-whatsapp` brand token — different identity |
| Inline brand color | `style={{ color: '#25D366' }}` | `text-whatsapp`, brand token in stylesheet |
| Token added to `:root` only | "I'll add the dark variant later" | Edit `:root` AND `.dark` in the same change |
| Soft "danger zone" panel | `bg-destructive/15` | `bg-destructive-tint` triple |
| Mixed `text-on-*` and `text-*-foreground` in one project | Add the missing form alongside | Preserve the established convention; migrate only when explicitly requested |
| Class works in dev but disappears in prod | Re-add `bg-success` to a global stylesheet | Add `@source "../../shared";` for the missing directory |
| "Just for now, will tokenize later" | One hex literal in a component | Tokenize on first use. Cost is identical; later it's harder. |

## References

- `references/canonical-stylesheet.md` — full `:root` + `.dark` + `@theme inline` shape with both layers
- `references/audit-and-greps.md` — four audit greps + pre-commit lock script + CI variant
- Tailwind v4 `@source` (automatic source detection + explicit registration): https://tailwindcss.com/docs/detecting-classes-in-source-files
- shadcn/ui design tokens: https://ui.shadcn.com/docs/theming (uses the `*-foreground` convention)
- Brandfetch / logo.dev — verify official hex before adding a brand token
- Companion skills: `accessibility` (semantics, keyboard behavior, and ARIA), `make-interfaces-feel-better` (visual polish), `lint-no-suppressions` (when CI greps feel "annoying" — fix the violation, don't disable)

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
