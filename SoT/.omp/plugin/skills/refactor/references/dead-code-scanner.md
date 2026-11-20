# Phase 2a — Dead Code Scan

Find unused exports, unreachable code, unused dependencies, and orphaned files — tools first, then manual verification, classified by safety tier.

<constraint>
Dynamic-reference check before SAFE. Before marking any export SAFE-to-remove, search for dynamic references — `require(...)`, `import(...)` with variables/templates, registry/string-lookup tables, decorator-based DI, reflection. Any match moves it to CAUTION or DANGER. "Zero static importers" alone is insufficient — dynamic references are exactly what static analyzers miss.
</constraint>

## Step 1 — Tool-augmented scan (if available)

| Tool | Command |
|---|---|
| knip | `npx knip --reporter compact` (files, exports, deps, types) |
| depcheck | `npx depcheck --json` (unused deps) |
| ts-prune | `npx ts-prune` (unused exports) |
| vulture | `vulture <scope> --min-confidence 80` |
| ruff | `ruff check --select F811,F841 <scope>` |
| Go | `deadcode -test ./...` |
| Rust | `cargo +nightly udeps` (needs a nightly toolchain) |

## Step 2 — Manual scan (always)

Exported symbols cross-referenced with imports; files with zero inbound imports; unreachable code after `return`/`throw`/`break`; commented-out blocks (>3 lines); unused parameters; TODO/FIXME for removed features.

## Step 3 — Classify by safety tier

| Tier | What | Rule |
|---|---|---|
| SAFE | unused utilities, test helpers, internal modules with zero importers | safe to remove |
| CAUTION | components, API routes, middleware | dynamic-import check REQUIRED before removable |
| DANGER | config, entry points, type defs, build-referenced files | manual review only |

## Output (write under `### Phase 2a: Dead Code Findings` in `## Research`)

Per finding: `file:line` · Category (unused export/dep/unreachable/orphaned/param/commented) · Safety tier · Evidence · Dynamic-reference check result (SAFE and CAUTION items).

| | Example |
|---|---|
| BAD | "There are some unused functions." |
| GOOD | "`src/utils/format.ts:45` — `formatCurrency()` — SAFE — zero static importers (0 matches across src/); dynamic-reference check: 0 matches for `formatCurrency` in string lookups, `require`/`import()` calls, or registries." |

End with counts: SAFE / CAUTION / DANGER, tool output yes/no.

## Gotcha

| Gotcha | Fix |
|---|---|
| Trusting ts-prune "unused" on a DI-registered class | Grep for string/decorator references first — those are dynamic |
