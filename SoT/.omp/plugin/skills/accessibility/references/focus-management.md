# Focus management — traps, restore, roving tabindex

## Contents

- [Manual focus trap (when `<dialog>` is not an option)](#manual-focus-trap-when-dialog-is-not-an-option)
- [Restore-on-close](#restore-on-close)
- [Roving tabindex](#roving-tabindex)
- [`aria-activedescendant`](#aria-activedescendant)
- [Choosing between the two](#choosing-between-the-two)
- [Portals and focus order](#portals-and-focus-order)

## Manual focus trap (when `<dialog>` is not an option)

Native `<dialog>.showModal()` traps by making the rest of the document `inert`. A
hand-rolled overlay can reuse exactly that mechanism — it is simpler and sturdier than
intercepting Tab:

```js
// GOOD — inert-based trap: nothing outside the overlay is focusable or clickable
function openOverlay(overlay) {
  for (const sibling of document.body.children) {
    if (!sibling.contains(overlay)) sibling.inert = true;
  }
  overlay.querySelector("[autofocus], button, [href], input, select, textarea")?.focus();
}
function closeOverlay() {
  for (const sibling of document.body.children) sibling.inert = false;
}
```

`inert` is Baseline (verify: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert).
Only fall back to a keydown Tab-wrap when you cannot mark siblings inert:

```js
// Fallback — wrap Tab/Shift+Tab at the edges of the overlay's tabbables
overlay.addEventListener("keydown", (e) => {
  if (e.key === "Escape") return close();
  if (e.key !== "Tab") return;
  const items = [...overlay.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.disabled && el.offsetParent !== null);
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
  else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
});
```

The tabbable query above misses edge cases (visibility, shadow DOM, `contenteditable`) —
if the project already ships a focus-trap utility or a headless-UI dialog, use that
instead of extending the query.

## Restore-on-close

Save the invoker **element reference** before moving focus, restore it on close:

```js
// BAD — id lookup: breaks when the trigger re-rendered or the id changed
const opener = document.getElementById("open-btn");

// GOOD — capture whatever actually had focus at open time
let invoker = null;
function open() {
  invoker = document.activeElement;
  showOverlay();
}
function close() {
  hideOverlay();
  invoker?.isConnected ? invoker.focus() : document.querySelector("main")?.focus();
}
```

If the invoker was destroyed while the overlay was open (deleted row, logged-out menu),
fall back to the nearest stable ancestor — never let focus drop to `<body>`, which resets
a screen-reader user to the top of the page.

## Roving tabindex

One tab stop for the whole composite; arrows move a single `tabindex="0"` between items:

```js
// items: the widget's focusable children in DOM order
function onArrow(items, current, dir) {
  const next = items[(items.indexOf(current) + dir + items.length) % items.length];
  current.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();          // real DOM focus — browser scrolls it into view for free
  return next;
}
```

- Initial state: active item `tabindex="0"`, every other item `tabindex="-1"`.
- Tab from outside lands on the active item (not the first item) — state survives leaving.
- Pair with the matching state attribute (`aria-selected` on tabs, `aria-checked` on radios).
- Arrow wrapping is per-pattern. APG: tabs wrap (last → first, first → last). Menus may wrap; a menu that does not wrap must support Home/End. For tabs, Home/End are optional.

## `aria-activedescendant`

DOM focus stays on the container; assistive tech treats the referenced child as focused:

```html
<input role="combobox" aria-expanded="true" aria-controls="opts"
       aria-activedescendant="opt-2" />
<ul id="opts" role="listbox">
  <li id="opt-1" role="option">Ada</li>
  <li id="opt-2" role="option" aria-selected="true">Grace</li>
</ul>
```

Arrow keys only update the `aria-activedescendant` value and the visual highlight. Because
no real focus moves, YOU must scroll the highlighted option into view
(`el.scrollIntoView({ block: "nearest" })`) — the browser won't.

## Choosing between the two

| Criterion | Roving tabindex | `aria-activedescendant` |
|---|---|---|
| DOM focus | moves per item | stays on the container |
| Scroll-into-view | free | manual |
| Focus must stay in a text input (combobox) | ✗ | ✓ — the reason comboboxes use it |
| Virtualized/windowed lists | awkward (item must exist to focus) | fine (only the id must resolve) |
| Implementation surface | tabIndex flips + `.focus()` | id bookkeeping + scroll + highlight styling |

Default to roving tabindex; switch to `aria-activedescendant` when focus must remain on an
input (combobox, searchable list) or items are virtualized.

## Portals and focus order

A portalled popover/menu renders outside its trigger's DOM position, so Tab after the
trigger goes to the trigger's DOM sibling — not into the popover. Options, in order:

1. Move focus INTO the popover on open (menus, dialogs — arrow/trap patterns apply).
2. Keep focus on the trigger and drive the popup via `aria-activedescendant` (combobox).
3. Non-modal popovers that don't take focus (tooltips): dismiss on `Escape` and on blur.

On close, restore per [Restore-on-close](#restore-on-close). Never leave focus inside a
now-hidden subtree — screen readers go silent and the next Tab starts from `<body>`.
