---
name: solid
description: Use when designing a module / service / class with multiple concerns, refactoring a 300+ LOC file with mixed change axes, replacing a growing switch/if-else with a strategy map, converting runtime instanceof checks into discriminated unions, splitting a fat interface, or breaking a hard-coded dependency on a concrete SDK. Generic SOLID across TS / Rust / Python / Go — React-component composition lives in react-component-patterns; type-level union/`class` design in type-safety-discipline. Not for readability-only naming or prose (use code-clarity).
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-20"
  content_hash: "dfeafb3147cb6ff22a4bf8e4605552e66aa706a9c85c3f03fda6d1539fda440d"
---

# SOLID — Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion

Five design pressures for keeping modules cohesive, extensible, and substitutable. Originally framed for OO, but each one applies to function-based code (TypeScript modules, Python packages, Go interfaces, Rust traits) — only the implementations change.

<constraint>
SOLID describes design pressure, not a checklist. Don't apply a principle until the smell it addresses appears: file > 300 LOC with mixed change axes, switch with 5+ arms, runtime type checks gating behavior, fat interface, hard-coded SDK. Premature application is over-engineering. Wait for the second use-site or a second independent change axis before splitting.
</constraint>

<constraint>
Don't add classes / inheritance just to "make SOLID fit." If a codebase is function-first — pure functions, ESM modules, structural types — the principles still apply via discriminated unions, strategy maps, and module splits. Adding an `abstract class FormatterBase` to an otherwise-functional codebase is the opposite of SRP.
</constraint>

<constraint>
The Strategy Map (the Open/Closed pattern in this skill) is code, not config. Never move map entries to JSON / YAML — you trade type safety and exhaustiveness checks for a "data-driven" win that becomes parallel duplication the moment a variant needs custom logic.
</constraint>

<constraint>
Before proposing any structural split, run the three tests from [`references/depth-and-seams.md`](references/depth-and-seams.md): (a) **Deletion test** — would deleting the module concentrate complexity or just scatter it? (b) **The interface IS the test surface** — if tests reach past the interface, the module is the wrong shape. (c) **One adapter = hypothetical seam, two adapters = real seam** — don't introduce an abstraction unless a second adapter (test fake counts when it exists) genuinely varies across it. Use the locked vocabulary (Module / Interface / Depth / Seam / Adapter / Leverage / Locality) — don't drift into "component," "service," "API," "wrapper," "boundary." Vocabulary drift makes reviews longer and conversations looser.
</constraint>

## When to Use

- A module or file has crossed ~300 LOC and two change axes share the file.
- A switch / if-else chain has 5+ arms and is about to grow another.
- An interface or class has 10+ methods, with subsets only relevant in specific modes.
- Business logic instantiates a concrete SDK (`new StripeClient(...)`) directly.
- Runtime type checks (`instanceof`, `typeof`, duck-typed `if (x.method)`) gate behavior at multiple call sites.

## When to Load Per-Language Examples

The principles below are universal. For idiomatic BAD/GOOD code per language, load the matching reference:

| Language | Reference file |
|---|---|
| TypeScript / JavaScript | `references/typescript-solid.md` |
| Rust | `references/rust-solid.md` |
| Python | `references/python-solid.md` |
| Go | `references/go-solid.md` |

## S — Single Responsibility

"A module has one reason to change."

| Smell | Fix |
|---|---|
| `userService.ts` covers CRUD + permissions + invitations + view-as | **Split by change axis**: `user-crud.ts`, `permissions.ts`, `invitations.ts`, `view-as.ts`. Different stakeholders, different change cadences. |
| One module both fetches and formats data for display | **Layer split**: data layer returns clean records; presentation layer formats. Changes to the API call differ from those to the format. |
| `OrderProcessor.process()` validates, charges, emails, audits | **Extract step functions**: `validateOrder`, `chargeCard`, `sendConfirmation`, `recordAudit`. The orchestrator becomes a 4-line composition. |

The word "and" in a function or module name is an SRP red flag.

**Indicators:** file > 300 LOC with two unrelated concerns; two pull requests touching the same file for unrelated reasons; tests for one concern fail when the other is changed.

## O — Open/Closed (Strategy Map)

"Open for extension, closed for modification." Reach for a lookup table when a switch grows past four arms. The pattern is the same across languages:

```ts
// BAD — every new event type means editing formatEvent()
function formatEvent(type: string, e: Event): string {
  switch (type) {
    case "user_invited":       return `${e.actor} invited ${e.target}`;
    case "role_changed":       return `${e.actor} changed role`;
    case "permission_granted": return `${e.actor} granted ${e.resource}`;
    // 13 more cases
  }
}
```

```ts
// GOOD — Strategy Map; new variants drop in without editing the dispatcher
type EventKind = "user_invited" | "role_changed" | "permission_granted";
type Formatter = (e: Event) => string;

const FORMATTERS: Record<EventKind, Formatter> = {
  user_invited:       (e) => `${e.actor} invited ${e.target}`,
  role_changed:       (e) => `${e.actor} changed role`,
  permission_granted: (e) => `${e.actor} granted ${e.resource}`,
};

function formatEvent(type: EventKind, e: Event): string {
  return FORMATTERS[type](e);
}
```

Split the map by domain when it grows further: `DASHBOARD_FORMATTERS` + `WORKFLOW_FORMATTERS`, merged via spread. Language-specific equivalents (Rust `HashMap<Kind, fn>`, Python dict-of-functions, Go map-of-funcs) live in the per-language references.

**Indicators:** switch with 5+ arms, adds outpacing removes; a `default:` arm that swallows unknown variants instead of failing closed; review comments of the form "every time we add X we have to edit Y."

## L — Liskov Substitution

"Subtypes must be substitutable for the base contract." In function-first code this maps to **discriminated unions** over runtime type checks: a shared `kind` tag carries which variant of a sum type a value is, and the compiler enforces exhaustiveness in every consumer.

**Indicators:** the same field carries different semantics depending on another field's value; optional fields that are "required in some configurations" (documented in comments, not types); `?.` chains gating behavior at runtime instead of types narrowing it at compile time.

Per-language idioms: TS discriminated unions, Rust `enum` + pattern matching, Python dataclass tagged unions / `match` statement, Go interface-as-sum-type + type switch. Deep examples in the per-language references.

## I — Interface Segregation

"No client should depend on methods it does not use." Don't merge two callers' contracts into one fat interface.

Split the interface along the **caller boundary**: read-only callers get a read interface; admin operations live behind an admin interface. A request handler that only reads doesn't need to mock 8 admin methods to be tested.

**Indicators:** interface has 10+ methods; some methods are "only relevant in mode X" (documented in comments, not types); tests need stub placeholders for methods the unit under test never calls.

## D — Dependency Inversion

"Depend on abstractions, not concretions." Pass dependencies as parameters; let the composition root pick the implementation.

In codebases without a DI container, **function arguments are the abstraction**. A `checkout(amount, charge)` function takes the charge fn — tests pass a stub, prod passes the SDK adapter.

**Indicators:** a business-logic file imports a concrete SDK directly (`new StripeClient`, `new PrismaClient`, `redis.createClient`); "we can't run this in tests without a real database / API"; "we can't swap providers without rewriting half the codebase."

## Decision Tree

| Smell | Fix | Principle |
|---|---|---|
| File > 300 LOC, multiple change axes | Split module along change axes | S |
| Switch with 5+ arms, growing | Strategy Map (`Record<key, fn>`) | O |
| `instanceof` / duck-type checks gating behavior | Discriminated union + exhaustive switch | L |
| Interface > 10 methods with mutually-exclusive subsets | Split interface along caller groups | I |
| Business logic imports concrete SDK | Inject via interface / function parameter | D |
| About to introduce a new abstraction / interface / wrapper | Run the deletion test + 2-adapter rule first | `references/depth-and-seams.md` |
| Refactor moves code around without changing depth | Stop — moved depth is not earned depth | `references/depth-and-seams.md` |

## Common Traps

| Wrong fix | Right fix |
|---|---|
| Add an `abstract class Formatter` and a subclass per variant | Strategy Map (`Record<string, (x: T) => U>`) — same Open/Closed property, no inheritance tax |
| Move switch arms to `formatters.json` | Keep them as code; otherwise you lose type safety and exhaustiveness |
| Wrap every dependency in an interface "for testability" | Wrap only at the seam you actually want to swap (the SDK, the network, the clock) — and only when a second adapter (test fake, alt provider) actually exists |
| Split a 200-line module into 4 × 50-line modules to "obey SRP" | Leave it; don't split until two genuinely independent change axes share the file |
| Use `extends` / inheritance to share method implementations | Composition: extract a function, call it from both places |
| Add a `?` to every optional field "for flexibility" | Discriminated union — the variant carries which fields are required |

## References

- Companion skill: `react-component-patterns` for React component composition patterns (compound, polymorphic, headless, slots) — distinct from SOLID's structural concerns
- Companion skill: `type-safety-discipline` for discriminated-union ergonomics referenced in the L section
- Per-language deep examples: `references/typescript-solid.md`, `references/rust-solid.md`, `references/python-solid.md`, `references/go-solid.md`
- Structural vocabulary + the three tests: `references/depth-and-seams.md`
- Maintenance twin: the `refactor` skill's `references/solid-analyzer.md` carries a condensed copy of this per-principle rubric and of the TypeScript class-justification gate (canonical deep form in `type-safety-discipline`) — sync the twins in the same commit when either changes.
- Uncle Bob's original SOLID essays: https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html
- Depth/seam vocabulary, the three tests, dependency categories, and "replace, don't layer" adapted from Matt Pocock's `codebase-design` skill (MIT; the vocabulary was first part of his `improve-codebase-architecture` skill): https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/public repository. Use the `report-skill-issue` skill of the docks-kit kit plugin for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and the docks-kit version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
