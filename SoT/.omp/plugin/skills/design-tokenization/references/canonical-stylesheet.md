# Canonical Stylesheet Anatomy

Reference example of the single canonical stylesheet the design-tokenization skill assumes. One file per project — no per-route or per-renderer divergence. Both `:root` and `.dark` define every token.

```css
/* src/styles/index.css (or src/shared/styles/index.css) */
@import "tailwindcss";

@source "../components";
@source "../app";
@source "../shared";        /* dirs v4's auto-detection misses: gitignored, outside the scan base (cwd, or source() on @import) */

@custom-variant dark (&:is(.dark *));

:root {
  /* Semantic — intent, not appearance */
  --background: 0 0% 100%;
  --on-background: 222 47% 11%;
  --primary: 222 80% 50%;
  --on-primary: 0 0% 100%;
  --destructive: 0 84% 60%;
  --on-destructive: 0 0% 100%;
  --destructive-tint: 0 84% 95%;
  --on-destructive-tint: 0 84% 30%;
  --destructive-tint-border: 0 84% 85%;
  --success: 142 71% 45%;
  --on-success: 0 0% 100%;
  /* Brand — vendor-fixed, never used for app surfaces */
  --whatsapp: 142.4 70.2% 48.6%;  /* #25D366 — keep one decimal so the value round-trips to the vendor hex */
  --on-whatsapp: 0 0% 100%;
  --stripe: 243 100% 67.8%;       /* #635BFF */
  --on-stripe: 0 0% 100%;
}

.dark {
  /* Every :root token has a .dark counterpart — parity is the contract */
  --background: 222 47% 11%;
  --on-background: 0 0% 96%;
  --primary: 222 70% 60%;
  --on-primary: 222 50% 10%;
  --destructive: 0 70% 60%;
  --on-destructive: 0 0% 100%;
  --destructive-tint: 0 70% 18%;
  --on-destructive-tint: 0 70% 80%;
  --destructive-tint-border: 0 70% 30%;
  --success: 142 60% 50%;
  --on-success: 0 0% 100%;
  --whatsapp: 142.4 70.2% 48.6%;  /* same — vendor-fixed */
  --on-whatsapp: 0 0% 100%;
  --stripe: 243 100% 67.8%;       /* same — vendor-fixed */
  --on-stripe: 0 0% 100%;
}

@theme inline {
  --color-background: hsl(var(--background));
  --color-on-background: hsl(var(--on-background));
  --color-primary: hsl(var(--primary));
  --color-on-primary: hsl(var(--on-primary));
  --color-destructive: hsl(var(--destructive));
  --color-on-destructive: hsl(var(--on-destructive));
  --color-destructive-tint: hsl(var(--destructive-tint));
  --color-on-destructive-tint: hsl(var(--on-destructive-tint));
  --color-destructive-tint-border: hsl(var(--destructive-tint-border));
  --color-success: hsl(var(--success));
  --color-on-success: hsl(var(--on-success));
  --color-whatsapp: hsl(var(--whatsapp));
  --color-on-whatsapp: hsl(var(--on-whatsapp));
  --color-stripe: hsl(var(--stripe));
  --color-on-stripe: hsl(var(--on-stripe));
}
```

## Activation

```ts
// theme-init.ts — imported as the FIRST line of the renderer entry, before React mounts
const stored = localStorage.getItem("theme");
const isDark = stored !== "light";  // default dark; only "light" string opts out
document.documentElement.classList.toggle("dark", isDark);
```

Default-mode choice (dark vs light) is project-specific. What's universal: read `localStorage` synchronously *before React mounts* to avoid the flash-of-wrong-theme.
