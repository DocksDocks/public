# Phase 4 — Planning

Merge the three input streams (dead code, duplication/reuse/modernization, SOLID) into one ordered three-tier plan. Every entry carries all 9 fields.

<constraint>
Over-engineering guard. If the proposed refactoring is more complex than the violation it resolves, SKIP it — log the skip with rationale under Skipped Findings. Prefer composition over inheritance for L and I; avoid deep hierarchies to fix abstraction problems.
</constraint>

## Tiers

| Tier | Theme | Examples |
|---|---|---|
| 1 Quick Wins | high impact, low risk | SAFE dead-code removal, unused-dep removal, commented-code removal, `var`→`const` |
| 2 Consolidation | high impact, medium risk | duplicate → shared fn; extract long methods; component/hook consolidation; OCP → Strategy/registry (switch with 5+ arms that grows per variant); ISP → split interface; contained monorepo coupling fixes |
| 3 Structural | medium impact, higher risk | module reorg (circular deps, barrels); CAUTION dead-code (verified); callbacks → async/await; SRP → Extract Class/Module; DIP → DI; LSP → fix hierarchy (prefer composition) |

## Ordering rules

Tier 1 → 2 → 3. Within a tier, independent before dependent. Dead-code removal before duplication fixes (removing dead code may erase duplicates). Group by file.

## 9 required fields per entry

| Field | Content |
|---|---|
| Priority tier | 1 / 2 / 3 |
| Category | dead-code / duplicate / extraction / component-reuse / module-reorg / modernization / solid-violation |
| Files affected | `file:line` list |
| What changes | before → after |
| Risk | low / medium / high |
| Test strategy | which tests to run after |
| Revert trigger | what failure means undo |
| Dependencies | which refactorings must precede |
| Pattern | for `solid-violation`: Strategy/Factory/Extract Class/Split Interface/DI/Composition/Adapter. Else `—` |

## Output (write under `### Phase 4: Refactoring Plan` in `## Research`)

`Refactoring Plan` (Tier 1/2/3, every entry with 9 fields) · `Estimated Impact` (files modified, lines removed, duplicates eliminated, SOLID resolved by principle, new shared modules) · `Skipped Findings` (with rationale, including over-engineering rejections).

## Gotcha

| Gotcha | Fix |
|---|---|
| A `solid-violation` entry missing the Pattern field | Pattern is mandatory for SOLID entries; `—` for all others |
| A refactoring that changes behavior | Behavior-preserving only — push behavior changes out of scope |
