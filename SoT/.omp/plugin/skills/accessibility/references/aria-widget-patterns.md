# ARIA widget patterns — APG contracts and skeletons

Five widgets cover most product UI. Each entry lists the role structure, the key
contract you must implement, and the trap seen most in reviews. Canonical source for
every pattern: https://www.w3.org/WAI/ARIA/apg/patterns/ (re-check there before
implementing — the APG evolves and its examples are normative-adjacent, not tested
against every screen reader).

## Contents

- [Dialog (modal)](#dialog-modal)
- [Menu and menubar](#menu-and-menubar)
- [Combobox](#combobox)
- [Tabs](#tabs)
- [Disclosure](#disclosure)

## Dialog (modal)

Prefer native `<dialog>.showModal()` — it implements this whole contract. Hand-rolled:

```html
<div role="dialog" aria-modal="true" aria-labelledby="dlg-title">
  <h2 id="dlg-title">Rename file</h2>
  ...
</div>
```

- Keys: Tab/Shift+Tab wrap inside; Escape closes.
- Initial focus: first focusable element — or a static element via `tabindex="-1"` when
  the dialog opens on long scrollable text or a destructive default.
- On close: focus returns to the invoker (unless it's gone — see the focus-management
  reference).
- Trap: `aria-modal="true"` without actually making the background inert/trapped —
  screen-reader users Tab out into a page that claims to be blocked.

## Menu and menubar

`role="menu"` means an ACTION menu (right-click menu, a toolbar's dropdown of commands).

```html
<button aria-haspopup="menu" aria-expanded="false" aria-controls="file-menu">File</button>
<ul id="file-menu" role="menu" hidden>
  <li role="menuitem" tabindex="-1">Rename</li>
  <li role="menuitem" tabindex="-1">Delete</li>
</ul>
```

- Keys: Enter/Space/ArrowDown on the button opens and focuses the first item; Up/Down
  move (wrapping optional; without it, support Home/End); Escape closes and refocuses the button; Tab closes and moves on;
  typing a character jumps to the next item starting with it.
- Checkable items: `role="menuitemcheckbox"` / `role="menuitemradio"` + `aria-checked`.
- Trap: site navigation marked `role="menu"`. Navigation is `<nav>` + `<ul>` + links —
  screen readers switch into menu interaction mode for `role="menu"` and users expect
  the full key contract above; a plain link list with menu roles is strictly worse than
  no ARIA.

## Combobox

The ARIA 1.2 shape — the input itself carries the combobox role:

```html
<input role="combobox" aria-expanded="false" aria-controls="city-list"
       aria-autocomplete="list" />
<ul id="city-list" role="listbox" hidden>
  <li id="city-1" role="option">Lisbon</li>
</ul>
```

- Keys: ArrowDown opens/moves into the list; Escape closes (second Escape clears);
  Enter selects and closes; the user keeps typing throughout.
- Focus NEVER leaves the input — highlight moves via `aria-activedescendant`
  (see the focus-management reference for scroll caveats).
- `aria-expanded` flips on the input; the popup can be `listbox`, `grid`, `tree`,
  or `dialog`.
- Trap: pre-1.2 markup (`role="combobox"` on a wrapper div) — screen-reader support is
  measurably worse; use the input-carries-the-role shape.

## Tabs

```html
<div role="tablist" aria-label="Settings sections">
  <button role="tab" id="tab-a" aria-selected="true" aria-controls="panel-a">General</button>
  <button role="tab" id="tab-b" aria-selected="false" aria-controls="panel-b" tabindex="-1">Billing</button>
</div>
<div role="tabpanel" id="panel-a" aria-labelledby="tab-a">...</div>
<div role="tabpanel" id="panel-b" aria-labelledby="tab-b" hidden>...</div>
```

- Keys: Left/Right arrows move between tabs (roving tabindex); Tab moves from the active
  tab INTO the visible panel, never to the next tab; Home/End jump to first/last.
- Activation choice: automatic (panel switches as arrows move — fine when panels render
  instantly) vs manual (arrow moves focus, Enter/Space activates — use when switching is
  expensive or destroys form state). Pick one, per APG.
- Trap: `aria-selected` updated but `tabindex` not roved (or vice versa) — the two must
  move together with focus.

## Disclosure

The simplest pattern — a button that toggles content visibility:

```html
<button aria-expanded="false" aria-controls="details-1">Show details</button>
<div id="details-1" hidden>...</div>
```

- Keys: Enter/Space toggle. That's the whole contract.
- `aria-expanded` lives on the BUTTON, flipped in JS alongside the `hidden` attribute.
- Native alternative: `<details>/<summary>` — free toggling and state, styling is the
  only cost.
- Accordion = a set of disclosures; arrow-key movement between headers is optional
  per APG, not required.
- Trap: putting `aria-expanded` on the panel, or reaching for `role="menu"`/`tablist`
  when a disclosure is all the interaction requires. When in doubt, this is the pattern
  you want — it has the least ARIA to get wrong.
