# Phase 3 — SOLID Analysis

Deep per-principle analysis of surviving code (skip files the dead-code scan marked SAFE — they're about to be deleted). Read the Phase 1 abstractions map and Phase 2 findings first.

<constraint>
TypeScript class-justification gate. Before suggesting a pattern that introduces a NEW class in `.ts`/`.tsx` (Extract Class, Strategy/Factory-as-classes, Builder, Repository hierarchy, abstract base + subclasses), it must match one of three sweet spots: (1) `Error` subtype, (2) long-lived stateful object with invariants + lifecycle (pool, parser, FSM, evicting cache), (3) framework-mandated shape (NestJS `@Injectable`, TypeORM/Mikro-ORM `@Entity`, class-validator DTO, RxJS `Subject`). Otherwise switch to the function form. Does NOT apply to `.rs`/`.kt`/`.py` — classes/structs are idiomatic there.
</constraint>

## Step 1 — Component inventory

Catalog classes/modules, interfaces/abstracts/protocols, top-level + factory functions, import + DI relationships — each with `file:line`. Exclude SAFE-for-deletion files.

## Step 2 — Priority ordering

Highest first: classes >200 lines, >10 methods, most inbound imports (hot paths), abstract bases with many descendants. Lowest: small utilities, leaf components, pure data types.

## Step 3 — Per-principle evaluation

| Principle | Signs | Example violation |
|---|---|---|
| S (SRP) | multiple responsibilities; >3 reasons to change; "and" in names; god class (>300 lines) | `UserService` handles auth + profile CRUD + email + billing |
| O (OCP) | switch/if-else chains modified per new variant; growing enum dispatch | `switch(plan.type)` with 7 cases, edited for each new plan |
| L (LSP) | subclass throws on inherited method; override breaks parent contract; `instanceof` gating | `Square extends Rectangle` overrides `setWidth` to also set height |
| I (ISP) | fat interface forcing unused stubs; "not supported" throws; props >10 optional mixed | `IRepo` 14 methods; `UserRepo` throws on `archive/restore/purge` |
| D (DIP) | `new Concrete()` in business logic; importing impls not abstractions; singleton coupling | `new StripeClient()` inside `processOrder()` |

Monorepo (if detected): cross-package coupling — backend importing frontend types, shared package depending on app code, cross-app imports. Report as principle `X`.

## Step 4 — Pattern suggestion

Strategy, Factory, Adapter, Extract Class/Module, Split Interface, Dependency Injection, Composition-over-Inheritance. Prefer composition for L and I. Research-gate framework-specific suggestions. Apply the TS class gate; function-form equivalents: Strategy → `Record<Key, fn>` map; Factory → factory function; Repository → generic function set; Extract Class (no shared state) → Extract Module.

## Output (write under `### Phase 3: SOLID Analysis Results` in `## Research`)

`Component Inventory` · `Analysis Priority` · `SOLID Violations` (Critical/High/Medium/Low; each: `file:line`, principle, evidence, impact, suggested pattern, risk tier) · `Summary` (counts by principle, files affected).

## Gotcha

| Gotcha | Fix |
|---|---|
| Flagging a 2-case switch as an OCP violation | Reserve OCP for chains that genuinely grow per variant; small switches are fine |
| Suggesting a new TS class without a justification | Name the sweet-spot exception or switch to the function form |

Maintenance: the per-principle rubric here is a condensed twin of the `solid` skill's, and the TS class-justification gate above twins with `type-safety-discipline` (§9 + its `references/typescript-class-vs-function.md`) — a change to any copy must land in the others in the same commit.
