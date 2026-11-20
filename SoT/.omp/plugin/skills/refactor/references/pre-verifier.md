# Phase 5 — Pre-Implementation Verification

Validate the Phase 4 plan BEFORE any code changes: reference accuracy, safety, ordering, completeness, over-engineering. Gate to the implementation phase.

<constraint>
Per-finding reproduction (every entry, not a sample). Dead-code: search the symbol, confirm zero remaining references. Duplicate: read both instances, confirm still similar. Extraction: read the function, confirm still long enough. SOLID: read the `file:line`, confirm the pattern exists. Modernization: read the lockfile, confirm the version still matches the premise. DROP anything that fails reproduction — log under a `#### Dropped (failed reproduction)` subheading inside the `### Phase 5: Pre-Verifier Results` block; never pass it to MUST FIX / SHOULD FIX.
</constraint>

## Checks

| # | Check | What |
|---|---|---|
| 1 | Reference accuracy | read every `file:line` ref in the plan; confirm the described issue is really there |
| 2 | Safety | CAUTION dead-code dynamic-import check thorough; export changes have no external consumers; consolidations truly interchangeable; modernizations preserve return types/error semantics |
| 3 | Dependency ordering | dependencies correct; no Tier-1 change breaks a Tier-2 change; file-grouped changes safe sequentially |
| 4 | Completeness | no high-impact finding dropped without reason; test strategies actually runnable |
| 5 | Over-engineering | pattern matches violation scope (no Strategy for a 2-case switch); a minimal in-place fix isn't sufficient. **TS class audit**: any new `.ts`/`.tsx` class must cite an `Error`-subtype / stateful-lifecycle / framework-mandated justification, else MUST FIX with the function-shaped replacement |
| 6 | Research backing | modernization/migration entries verified against current docs for the installed major version; MUST FIX anything contradicted (e.g. "migrate `proxy.ts` → `middleware.ts`" in Next.js 16 is backwards) |
| 7 | RSC boundary (Next.js App Router only) | for extraction/consolidation/shared-module entries, confirm no non-serializable value (functions, component refs, icon imports, class instances) crosses a Server→Client prop boundary. See `react-component-patterns/references/rsc-boundary.md`. Marking the shared file `"use client"` does NOT cure an upstream Server Component importer. Skip entirely if not App Router |

## Output (write under `### Phase 5: Pre-Verifier Results` in `## Research`)

`Reference Accuracy` · `Safety Verification` (SAFE / NEEDS ADJUSTMENT / UNSAFE) · `Dependency Ordering` · `Over-Engineering Check` (per SOLID entry: APPROVED / REJECTED / MODIFIED + TS class verdict) · `Research Backing` (per modernization entry, with citation) · `RSC Boundary Check` (or N/A) · `Issues to Fix` (MUST FIX / SHOULD FIX / MINOR).

## Gotcha

| Gotcha | Fix |
|---|---|
| Spot-checking a sample of refs | Read every ref; the plan's accuracy is the gate's whole job |
| Passing a finding you couldn't reproduce | Drop it explicitly — unreproduced findings poison the implementation phase |
