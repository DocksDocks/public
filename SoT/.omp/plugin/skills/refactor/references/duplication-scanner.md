# Phase 2b — Duplication & Modernization Scan

Find duplicate code, extraction opportunities, frontend reuse candidates, module-organization issues, and modernization candidates. SOLID violations are out of scope (Phase 3).

<constraint>
Do NOT flag SOLID violations here — that is Phase 3 (solid-analyzer). Flagging them here duplicates findings and degrades planner input.
</constraint>

<constraint>
Research-gate before any "modernization" / "deprecated API" / "outdated pattern" finding. Read the installed version (`package.json` / `requirements.txt` / `Cargo.toml`), then verify against current official docs (context7 + a docs fetch) that the pattern is deprecated FOR THAT major version. Recent flips that catch training-data drift: Next.js 16 renamed `middleware.ts` → `proxy.ts`; React 19 lets function components take `ref` directly (no `forwardRef`); Tailwind 4 is CSS-first. A relevant project skill outranks memory. No citation → drop the finding.
</constraint>

## Six categories

| # | Category | Look for |
|---|---|---|
| 1 | Duplicate blocks (>5 lines, >80% similar) | same logic / different names; copy-paste with minor param changes; repeated error-handling or validation |
| 2 | Extraction candidates | methods >30 lines; nesting >3 deep; repeated inline logic; param lists >4 (missing data object) |
| 3 | Frontend reuse | similar buttons/forms/cards/modals; duplicate className patterns; repeated useState/useEffect combos; similar fetch patterns → custom hook |
| 4 | Module organization | circular deps; barrel files re-exporting everything; relative vs alias inconsistency; many files importing the same set (missing shared module) |
| 5 | Modernization | callbacks → async/await; `var` → `const`/`let`; class → function components; manual loops → array methods; deprecated APIs (research-gated) |
| 6 | Scattered values | same number/string/unit/limit/path literal in 2+ files; a value defined in 2+ places; a raw value used where a named constant exists; derived values written as raw results (`1048576` instead of `1024 * KIB`). Fix: one owning module per domain; apply `code-guardrails`. |

## Output (write under `### Phase 2b: Duplication Findings` in `## Research`)

`Duplicate Code` (list ALL instances per group + suggested consolidation) · `Extraction Candidates` (`file:line`, length, suggested fn) · `Component Reuse` (similar components + shared component/hook) · `Module Organization` (type + files + fix) · `Modernization` (`file:line`, current → modern, migration risk, **docs citation**) · `Scattered Values` (`file:line` for every instance + owning module).

## Gotchas

| Gotcha | Fix |
|---|---|
| Duplicate group lists only 2 of N instances | List every instance — the planner needs the full set |
| Modernization based on memory | Cite current docs for the installed major version, or drop it |
| Suggesting sync→async "modernization" | That changes return types/behavior — out of scope; behavior-preserving only |
