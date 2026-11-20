---
name: accessibility
description: "Use when making UI accessible: focus trap + restore-on-close in modals, roving tabindex, :focus-visible, skip links, Escape/Enter/Space + arrow-key handling, ARIA roles/states, accessible names, live regions, landmarks, visually-hidden text, prefers-reduced-motion guards; APG dialog/menu/combobox/tabs/disclosure; WCAG 2.2. Not for color contrast (use design-tokenization), touch-target size or visual polish (use make-interfaces-feel-better), or composition APIs (use react-component-patterns)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-10-23"
  content_hash: "5ef4ee5bbf865ad959c5c41fcec507c056878b618fab21a212750a29610a9c44"
---

# Accessibility

Accessibility work is behavioral, not visual: can a keyboard-only user reach and operate every control, does a screen reader announce what things are and when they change, does the interface respect the user's motion setting. This skill covers the five surfaces that work always touches — focus, keyboard, ARIA, screen-reader semantics, and `prefers-reduced-motion`.

<constraint>
Semantic HTML first — no ARIA is better than bad ARIA. A native `<button>`, `<a href>`, `<label>`, `<dialog>`, or `<select>` ships focusability, keyboard activation, and announcements for free. An ARIA role is a promise: `role="button"` on a `<div>` announces "button" but implements nothing — you now owe `tabindex`, Enter AND Space activation, and the disabled state by hand, and a missed key turns the widget into a lie for screen-reader users. Reach for ARIA only when no native element expresses the pattern (tabs, combobox, live regions). (Source: APG Read Me First — https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/)
</constraint>

<constraint>
Never remove a focus indicator without replacing it. `outline: none` on `:focus` makes keyboard navigation invisible to sighted keyboard users; style `:focus-visible` instead — the ring shows on keyboard focus and skips mouse clicks (Baseline since 2022; verify: https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible). Same family of invariant: focus order is DOM order — never use a positive `tabindex`, and never let CSS (`order`, `row-reverse`, absolute positioning) make the visual order contradict the tab order.
</constraint>

<constraint>
Every animation ships with a `prefers-reduced-motion` guard. Scaling, panning, parallax, and auto-playing motion can physically sicken users with vestibular disorders. Reduce does not mean remove: swap motion for opacity/color so the state change stays perceivable. The guard COMPLEMENTS motion-polish recipes — tuned press/cross-fade/stagger values (e.g. make-interfaces-feel-better's) stay as the `no-preference` branch; wrap them, don't retune them.
</constraint>

## Boundary with companion skills

| Ask | Owner |
|---|---|
| "this tap target is too small", hit-area sizing | `make-interfaces-feel-better` (owns the hit-area rule) |
| "text is unreadable in dark mode", contrast ratios, WCAG 1.4.x contrast audits | `design-tokenization` (owns the paired-token contrast contract) |
| Compound / slot / `asChild` / polymorphic component API design | `react-component-patterns` |
| Animation values, easing, springs, enter/exit polish | `make-interfaces-feel-better` — then come back here for the reduced-motion guard |

## Semantic HTML first

```html
<!-- BAD — announces nothing, not focusable, no keyboard activation -->
<div class="btn" onclick="save()">Save</div>

<!-- GOOD — focusable, announced as "button", Enter AND Space work, free disabled state -->
<button type="button" onclick="save()">Save</button>
```

Native-element decision line: navigates → `<a href>`; performs an action → `<button>`; form field → `<input>`/`<select>`/`<textarea>` with a real `<label>`; modal → `<dialog>`; collapsible section → `<details>`/`<summary>` or button + `aria-expanded`. Only past those: ARIA per the widget table below.

## Focus management

**Modals: prefer native `<dialog>` + `showModal()`.** It supplies `::backdrop`, makes everything outside `inert`, closes on Escape, exposes modal semantics, and moves initial focus inside (Baseline since 2022; verify: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog). Focus restoration to the invoker is not guaranteed: capture the invoking element reference and restore focus explicitly on close.

```html
<dialog id="confirm" aria-labelledby="confirm-title">
  <h2 id="confirm-title">Discard draft?</h2>
  <button autofocus>Cancel</button>  <!-- explicit, least-destructive initial focus -->
  <button data-action="discard">Discard</button>
</dialog>
```

- `autofocus` the least-destructive control; never put `tabindex` on `<dialog>` itself.
- `dialog.show()` (non-modal) does NOT trap focus or make the page inert — different tool.
- Hand-rolled overlay (portal, no `<dialog>`)? Then you own the whole trap: Tab/Shift+Tab wrap inside, Escape closes, focus restored to the invoker *element reference* on close (an id lookup breaks if the trigger re-rendered). Implementation: [references/focus-management.md](references/focus-management.md).

**Composite widgets are ONE tab stop.** Tabs, menus, listboxes, radio groups: Tab enters the widget, arrow keys move inside it, Tab leaves. Two mechanisms — roving tabindex (active item `tabindex="0"`, all others `-1`, arrows move the `0` and call `.focus()`; browsers scroll the item into view for free) or `aria-activedescendant` (DOM focus stays on the container). Code + tradeoffs: [references/focus-management.md](references/focus-management.md).

```css
/* BAD — kills the ring for keyboard users too */
button:focus { outline: none; }

/* GOOD — ring on keyboard focus only, offset so it never hugs the edge */
button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```

## Keyboard navigation

Key conventions (APG keyboard interface; verify: https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/):

| Key | Convention |
|---|---|
| Tab / Shift+Tab | move between widgets and standalone controls — never within a composite |
| Arrow keys | move within a composite (tabs, menu, listbox, radio group, grid) |
| Enter | activate link/button, submit form, open the focused item |
| Space | activate button, toggle checkbox/switch, select option |
| Escape | close the nearest dismissible layer (dialog, menu, popover) — one layer per press |
| Home / End | first / last item inside a composite |

- A `<button>` fires on Enter and Space natively; a `role="button"` div fires on neither until you wire both — and Space must `preventDefault()` so it doesn't scroll the page.
- **Skip link** — first focusable element on the page, visually hidden until focused:

```css
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 8px; top: 8px; }   /* <a class="skip-link" href="#main"> */
```

Give the target `<main id="main" tabindex="-1">` so focus actually moves there.

## ARIA

**Accessible names** — precedence: `aria-labelledby` beats `aria-label` beats native content (label text, alt, button text).

- Icon-only button → `aria-label="Close"` (or visually-hidden text inside).
- A control with visible text must have that text INSIDE its accessible name (WCAG 2.5.3 Label in Name — voice-control users say what they see; a diverging `aria-label` breaks "click Save").
- `aria-label` on a plain `<div>`/`<span>` with no role is ignored by most assistive tech — name things that have a role.

**State and relationship attributes:**

| Attribute | Goes on | Gotcha |
|---|---|---|
| `aria-expanded` | the TRIGGER (button), not the panel | flip it in JS; forgetting is the #1 disclosure bug |
| `aria-controls` | trigger, pointing at panel id | weak AT support; harmless, don't rely on it |
| `aria-selected` | active tab / listbox option | pairs with roving tabindex |
| `aria-current="page"` | current nav link | nav is not a tablist — don't use `aria-selected` |
| `aria-hidden="true"` | decorative or visually-duplicated content | NEVER on a focusable element — creates a ghost tab stop |
| `aria-disabled="true"` | control that should stay discoverable | unlike `disabled` it stays focusable and announced; still block the action in JS |

**Live regions** — how screen readers hear async updates:

- `role="status"` (implicit `aria-live="polite"`): result counts, toasts, "saved".
- `role="alert"` (implicit `assertive`): errors only — assertive interrupts current speech.
- The region must exist in the DOM BEFORE the update. Render the empty container up front, then set its text content — injecting the container together with its message is the classic silently-dead live region.

**Widget patterns** (roles, keys, and skeletons per widget: [references/aria-widget-patterns.md](references/aria-widget-patterns.md)):

| Widget | Core contract |
|---|---|
| Dialog (modal) | `role="dialog"` + `aria-modal="true"` + accessible name; trap + restore — or just use `<dialog>` |
| Menu / menubar | `role="menu"` is for ACTION menus only; site navigation is `<nav>` + list, never `menu` |
| Combobox | `<input role="combobox">` + `aria-expanded` + popup + `aria-activedescendant` |
| Tabs | `tablist`/`tab`/`tabpanel`, arrows move between tabs, roving tabindex |
| Disclosure | button + `aria-expanded` (+ `aria-controls`); or native `<details>`/`<summary>` |

## Screen-reader semantics

- **Landmarks**: exactly one `<main>`; `<header>`/`<footer>`/`<nav>`/`<aside>` map to banner/contentinfo/navigation/complementary. Multiple `<nav>`s need distinguishing labels (`aria-label="Primary"`, `aria-label="Breadcrumb"`). Headings descend h1→h2→h3 without skipping — screen-reader users navigate by landmark and heading list, not by scrolling.
- **Three hiding modes — pick by audience:**

| Goal | Technique |
|---|---|
| Hidden from everyone | `hidden` attribute / `display: none` |
| Visible, silent for assistive tech (decorative icon) | `aria-hidden="true"` |
| Invisible, still announced (extra context for screen readers) | visually-hidden class below |

```css
.visually-hidden { /* Tailwind ships this as `sr-only` */
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
```

## prefers-reduced-motion — the guard every animation needs

Media feature values: `no-preference` / `reduce`; Baseline since 2020 (verify: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

```css
/* GOOD — swap the vestibular trigger (translate/scale) for a calm equivalent */
.toast { animation: slide-up 0.3s ease-out; }
@media (prefers-reduced-motion: reduce) {
  .toast { animation: fade-in 0.3s linear; }  /* same state change, no motion */
}
```

- Prefer per-animation swaps. The global kill-switch (`* { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }`) is a retrofit safety net only — it can't tell decorative motion from state-conveying motion. Use `0.01ms`, not `0`, so `transitionend` handlers still fire (a transition with a combined duration of 0s never starts).
- JS: `matchMedia("(prefers-reduced-motion: reduce)")` — read `.matches`, subscribe to `change`.
- Motion / framer-motion: wrap the tree in `MotionConfig` with `reducedMotion="user"` (auto-disables transform/layout animations, keeps opacity/color), or branch per component with `useReducedMotion()` (verify: https://motion.dev/docs/react-accessibility).
- Tailwind: `motion-safe:` / `motion-reduce:` variants — `motion-safe:transition-transform motion-reduce:transition-none`.
- `scroll-behavior: smooth` is motion too — gate it behind the same query.

## React specifics

- ARIA attributes keep their dashes in JSX — `aria-label`, `aria-expanded` — unlike other camelCased props; `htmlFor` replaces `for` on `<label>` (verify: https://react.dev/reference/react-dom/components/common).
- `tabIndex`: stick to `0` and `-1` (the React docs give the same advice as APG).
- Move focus imperatively via refs (`ref.current?.focus()`) after route changes and item deletions — focus doesn't follow state updates by itself.
- Portalled popovers escape DOM order and break the Tab sequence — manage focus across the portal boundary ([references/focus-management.md](references/focus-management.md)).

## Common traps

| Trap | Fix |
|---|---|
| `outline: none` because the ring "looks bad" | style `:focus-visible` instead |
| Clickable `<div>` / `<span>` | `<button>`; if truly impossible: role + tabindex + Enter + Space handlers |
| `role="menu"` on site navigation | `<nav>` + `<ul>`; `menu` demands the full APG action-menu key contract |
| Positive `tabindex` to "fix" order | reorder the DOM |
| `aria-hidden="true"` on a focusable element | remove it, or also make the element unfocusable |
| Icon-only button with no name | `aria-label` or visually-hidden text |
| Live region injected together with its message | pre-render the empty container |
| Placeholder as the only label | real `<label htmlFor>` — placeholders vanish on input |
| `disabled` on a button users need to discover | `aria-disabled="true"` + block in JS |
| Modal built from divs + z-index | `<dialog>.showModal()`, or own the full trap contract |
| Animation with no reduced-motion branch | wrap it per the section above |
| `aria-label` contradicting the visible text | accessible name must contain the visible label (WCAG 2.5.3) |

## WCAG 2.2 — what changed (audit vocabulary)

W3C Recommendation since 2023-10-05; nine new criteria over 2.1, and 4.1.1 Parsing REMOVED (verify: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/):

| New in 2.2 | Level | One-liner |
|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA | sticky headers/footers must not fully hide the focused element |
| 2.5.7 Dragging Movements | AA | every drag interaction needs a single-pointer alternative |
| 2.5.8 Target Size (Minimum) | AA | pointer-target floor — the sizing rule itself lives in `make-interfaces-feel-better` |
| 3.2.6 Consistent Help | A | help entry points sit in the same place on every page |
| 3.3.7 Redundant Entry | A | don't ask for the same information twice in one flow |
| 3.3.8 Accessible Authentication (Minimum) | AA | no cognitive test (transcription, puzzles) to log in |
| 2.4.12 / 2.4.13 / 3.3.9 | AAA | enhanced focus-not-obscured / focus-appearance / auth variants |

Contrast criteria (1.4.x) audits route to `design-tokenization`.

## References

- [references/focus-management.md](references/focus-management.md) — manual focus trap, restore-on-close, roving tabindex vs `aria-activedescendant`, portal gotchas
- [references/aria-widget-patterns.md](references/aria-widget-patterns.md) — APG contracts + skeletons: dialog, menu/menubar, combobox, tabs, disclosure
- APG patterns index: https://www.w3.org/WAI/ARIA/apg/patterns/ · Read Me First: https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/
- WCAG 2.2 changes: https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- Companion skills: `design-tokenization` (contrast/tokens), `make-interfaces-feel-better` (motion values, hit areas), `react-component-patterns` (component APIs)

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
