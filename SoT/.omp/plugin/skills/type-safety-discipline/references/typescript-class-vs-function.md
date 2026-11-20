# TypeScript — `class` vs Function

## Contents

- [When this applies](#when-this-applies)
- [The rule](#the-rule)
- [BAD / GOOD](#bad-good)
- [Anti-patterns that should not be classes](#anti-patterns-that-should-not-be-classes)
- ["But I need private fields"](#but-i-need-private-fields)
- ["But I want dependency injection"](#but-i-want-dependency-injection)
- [Equivalency](#equivalency)
- [Decision Tree](#decision-tree)
- [References](#references)

Deep reference for the "Classes — narrow sweet spot" trigger in the parent `SKILL.md`. When TypeScript justifies a `class`, when it doesn't, and what to write instead.

## When this applies

- About to type `class Foo` in a `.ts` / `.tsx` file.
- Reviewing a PR that introduces a new class — does it match one of the three sweet spots?
- A refactoring plan proposes "Extract Class", "Strategy as classes", "Factory as classes", "Builder pattern" — verify the chosen pattern matches the rule below before approving.
- Migrating Java/C#/Python OO code into TypeScript and reflexively reaching for `class`.
- Deciding whether to keep a `class FooService` introduced years ago or fold it into top-level functions.

## The rule

Default to a top-level function or a factory closure. A TypeScript `class` is the right tool in exactly three situations:

1. **Error subtypes** — `class NotFoundError extends Error`. Preserves the prototype chain so `instanceof` works in a `catch`, preserves the captured stack, and is what every observability tool (Sentry, OpenTelemetry, browser devtools) expects. A tagged plain-object error is strictly worse here — `throw` machinery and source maps assume real `Error` instances.
2. **Long-lived stateful objects with invariants** — a connection pool, a parser holding a tokenizer position, a finite state machine, a `Map`-backed cache with eviction, a `Subject`-like event bus. Methods share `this` and a documented lifecycle (`open`/`close`, `subscribe`/`dispose`); rebuilding that with a closure means a returned record-of-functions with worse types and no obvious place to put the lifecycle methods.
3. **Framework-mandated shapes** — NestJS controllers/providers (`@Injectable()` reads metadata off the class via `Reflect.metadata`), TypeORM / Mikro-ORM entities (decorators + `instanceof` at the ORM level), `class-validator` DTOs, `RxJS` operators that subclass `Subject`, Angular components. Fighting the framework here is more ceremony than embracing it.

Everything else is a closure with extra ceremony that:

- doesn't tree-shake well (every method ships even when only one is called),
- doesn't survive `structuredClone` / `postMessage` / `JSON.stringify` (methods are silently dropped, leaving a half-object),
- can't cross the React Server Components boundary as a prop (see `react-component-patterns/references/rsc-boundary.md` — class instances of non-built-in classes are explicitly non-serializable per React's `use client` rules),
- invites the inheritance hierarchies that the `solid` skill flags as smells (god classes, deep `extends` chains, Liskov violations).

## BAD / GOOD

```ts
// BAD — class as a namespace for related functions; instance state is just config
class UserService {
  constructor(private db: Db, private logger: Logger) {}
  async findById(id: UserId) { return this.db.users.find(id) }
  async deactivate(id: UserId) {
    this.logger.info("deactivating", id)
    return this.db.users.update(id, { active: false })
  }
}
// Caller: `new UserService(db, logger).findById(id)` — `new` ceremony, harder to
// tree-shake `deactivate` if unused, can't cross RSC boundary as a prop.

// GOOD — functions that take their deps; every export tree-shakable, plain values
export function findUser(db: Db, id: UserId) {
  return db.users.find(id)
}
export function deactivateUser(db: Db, logger: Logger, id: UserId) {
  logger.info("deactivating", id)
  return db.users.update(id, { active: false })
}

// GOOD — class for an Error subtype (exception #1)
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const
  constructor(public readonly entity: string, public readonly id: string) {
    super(`${entity} ${id} not found`)
    this.name = "NotFoundError"
  }
}

// GOOD — class for a long-lived stateful object (exception #2)
export class TokenBucket {
  private tokens: number
  constructor(private capacity: number, private refillPerMs: number) {
    this.tokens = capacity
  }
  tryConsume(n = 1): boolean {
    // shared this.tokens, this.capacity invariant; refill timer in constructor
    return false
  }
}
```

## Anti-patterns that should not be classes

| Tempting class shape | Better shape |
|---|---|
| `class FooService { constructor(deps) {} async doIt() {} }` (no shared state, no lifecycle) | Top-level function(s) taking deps; or a factory `createFooClient(deps) => ({ doIt })` if you need a closure boundary |
| `class FooBuilder { withX().withY().build() }` for object construction | Plain object literal or a function `makeFoo({ x, y }: Opts)` |
| `class FooUtils { static format() {} static parse() {} }` (all-static utility class) | Module of top-level functions; no `new` needed, tree-shakes per export |
| `class Foo extends Bar extends Baz` deep inheritance | Composition: pass collaborators in, or use `Foo & Bar` intersection / discriminated union |
| `class Repository<T>` abstract base + concrete subclasses per entity | Generic function set: `findById<T>(table, id)`, `update<T>(table, id, patch)` |
| `class Strategy { execute() {} }` with one subclass per case | `Record<Key, (input) => Output>` dispatch map — same Open/Closed property, less code |
| `class State` with mutable fields representing a state machine | Discriminated union `type State = { kind: "idle" } \| { kind: "loading"; since: Date } \| ...` |

## "But I need private fields"

`#privateField` is class-only syntax, true. But you almost never need it — `readonly` on `interface`/`type` shapes prevents external mutation at the type level, and a factory closure captures variables as truly private at runtime:

```ts
// GOOD — closure captures `tokens` as truly private; no `class` needed
export function createTokenBucket(capacity: number, refillPerMs: number) {
  let tokens = capacity
  return {
    tryConsume(n = 1) { /* mutate `tokens`; outside callers can't see it */ }
  } as const
}
```

Reach for `#private` only when the value also needs the other class properties (Error subtype, long-lived stateful object, framework shape).

## "But I want dependency injection"

DI doesn't require classes. Pass deps as parameters (or curry them via a factory) — the result composes more cleanly than constructor injection because each function names exactly the deps it uses, making test doubles trivial:

```ts
// GOOD — explicit deps per function, easy to test
export function findUser(db: Db, id: UserId) { ... }

// In a test: `findUser(fakeDb, "u-1")` — no `new`, no container, no mock framework.
```

If the framework supplies a DI container (Nest, Inversify), then class is the right shape — exception #3 applies.

## Equivalency

- **Rust:** the default IS `struct` + `impl` blocks — there's no "function vs struct" dilemma; pick whichever expresses the data. Reach for traits when you need polymorphism, not subclasses (Rust has none). See `rust-newtype.md`.
- **Kotlin:** classes are idiomatic — `data class` for shapes (free `equals`/`hashCode`/`copy`), `class` for stateful objects, `object` for singletons. The "default function" rule does not apply; Kotlin tooling expects classes. See `kotlin-value-class.md`.
- **Python:** `@dataclass` for shapes, top-level functions for behavior; reach for `class` when the same three exceptions apply (custom `Exception` subclass, stateful object with `__enter__`/`__exit__`, framework that reads via decorators — Django models, Pydantic `BaseModel`, FastAPI dependency classes). See `python-typing.md`.

## Decision Tree

1. **`extends Error`?** → Class, exception #1. Done.
2. **Long-lived `this`-shared state + lifecycle (`open`/`close`, `subscribe`/`dispose`)?** → Class, exception #2.
3. **Framework reads metadata off the class (`@Injectable`, `@Entity`, `@Controller`)?** → Class, exception #3.
4. **Everything else** → function. If it groups related behavior, that's a module, not a class. If you need a closure boundary for private state, factory function returning an object literal.

## References

- TypeScript handbook — classes: <https://www.typescriptlang.org/docs/handbook/2/classes.html>
- React 19 `use client` (class instances are non-serializable): <https://react.dev/reference/rsc/use-client>
- Sister skill — the `solid` skill (warns about Strategy-as-classes, god classes, deep `extends`)
- Sister reference — `react-component-patterns/references/rsc-boundary.md` (why class instances die at the RSC boundary)
