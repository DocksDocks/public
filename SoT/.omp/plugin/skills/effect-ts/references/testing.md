# Testing Effect code with @effect/vitest

`@effect/vitest` runs Effect programs as Vitest tests. It provides test services, a scope per test, shared layers, and property tests.

## Contents

- [Install and run](#install-and-run)
- [Helpers](#helpers)
- [Minimal test](#minimal-test)
- [Test doubles as layers](#test-doubles-as-layers)
- [Assert failures](#assert-failures)
- [Names and helpers that do not exist](#names-and-helpers-that-do-not-exist)

## Install and run

Install `@effect/vitest` at the exact `effect` version. Install the Vitest major that its `vitest` peer range allows (Vitest 5).

```sh
npm view @effect/vitest@<effect-version> peerDependencies   # shows the vitest range
# Bun
bun add -d -E @effect/vitest@<effect-version> vitest@<vitest-version>
# pnpm
pnpm add -D -E @effect/vitest@<effect-version> vitest@<vitest-version>
```

- Effect tests need no Effect-specific Vitest configuration. `vitest run` finds `*.test.ts` files.
- On Node, run `vitest run`. On Bun, run `bun --bun vitest run`.
- Do not use `bun test` for Effect tests. `@effect/vitest` needs Vitest.
- Vitest 5 needs a recent Node release. Read the range with `npm view vitest@5 engines`.

## Helpers

| Helper | Use |
|---|---|
| `it.effect(name, () => effect)` | The default. It provides `TestClock`, `TestConsole`, and a fresh `Scope` that closes when the test ends |
| `it.live(name, () => effect)` | Live services: the real clock and the real console |
| `layer(L)("name", (it) => {...})`, `it.layer(L)` | One shared layer for the block. `{ buildPerTest: true }` builds fresh services for each test |
| `it.effect.prop(name, [Schema.String], ([s]) => effect)` | A property test with an Effect body. `it.prop` takes only a synchronous body |
| `it.flakyTest(effect, "5 seconds")` | Retries the effect until it succeeds or the timeout ends |
| `it.effect.each`, `.skip`, `.only`, `.fails` | The same behavior as in Vitest |

- `TestClock` comes from `effect/testing`. Fork the effect, call `TestClock.adjust`, then join the fiber.
- `it.effect` sends logs to `TestConsole`. Use `it.live` to see logs in the test output.
- `@effect/vitest` re-exports Vitest, so import `assert`, `expect`, and `describe` from it.

## Minimal test

```ts
// src/Greeter.ts
import { Context, Effect, Layer, Schema } from "effect"

export class EmptyName extends Schema.TaggedError<EmptyName>()("EmptyName", {}) {}

export class Greeter extends Context.Service<Greeter, {
  greet(name: string): Effect.Effect<string, EmptyName>
}>()("app/Greeter") {
  static readonly layer = Layer.effect(
    Greeter,
    Effect.gen(function*() {
      const greet = Effect.fn("Greeter.greet")(function*(name: string) {
        if (name === "") return yield* new EmptyName()
        yield* Effect.sleep("1 second")
        return `Hello, ${name}!`
      })
      return Greeter.of({ greet })
    })
  )
}
```

```ts
// test/Greeter.test.ts
import { assert, describe, it, layer } from "@effect/vitest"
import { Effect, Fiber, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Greeter } from "../src/Greeter" // use the project's import-extension style

layer(Greeter.layer)("Greeter", (it) => {
  it.effect("greets after the clock advances", () =>
    Effect.gen(function*() {
      const greeter = yield* Greeter
      const fiber = yield* Effect.forkChild(greeter.greet("Ada"))
      yield* TestClock.adjust("1 second")
      assert.strictEqual(yield* Fiber.join(fiber), "Hello, Ada!")
    }))
  it.effect("fails with a typed error", () =>
    Effect.gen(function*() {
      // flip moves the typed error to the success channel; a defect still fails the test
      const error = yield* Effect.flip((yield* Greeter).greet(""))
      assert.strictEqual(error._tag, "EmptyName")
    }))
})
describe("props", () => {
  it.effect.prop("trim is idempotent", [Schema.String], ([s]) =>
    Effect.sync(() => assert.strictEqual(s.trim().trim(), s.trim())))
})
```

## Test doubles as layers

Replace each service with a layer. A test never calls the real network.

```ts
import { assert, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Greeter } from "../src/Greeter" // use the project's import-extension style

// A double has the same interface, so the code under test does not change
const GreeterTest = Layer.succeed(Greeter, Greeter.of({ greet: (name) => Effect.succeed(`Hi ${name}`) }))

layer(GreeterTest)("with a double", (it) => {
  it.effect("uses the double", () =>
    Effect.gen(function*() {
      assert.strictEqual(yield* (yield* Greeter).greet("Bo"), "Hi Bo")
    }))
})
```

- Provide doubles with `layer(...)`, not with `Effect.provide` in the test body. The `strictEffectProvide` rule warns on `Effect.provide` outside an entry point.
- For HTTP, give `HttpClient.HttpClient` a layer built with `HttpClient.make`. Build each response with `HttpClientResponse.fromWeb`.

## Assert failures

- `Effect.flip` moves the typed error into the success channel. Then assert on `error._tag` and the error fields. A defect or an interruption still fails the test.
- Do not stop at `Exit.isFailure`: it also accepts defects and interruptions. Assert the error tag.
- `@effect/vitest/utils` gives `assertExitSuccess` and `assertExitFailure` for an `Exit`, and `assertSuccess` and `assertFailure` for a `Result`.

## Names and helpers that do not exist

- `it.scoped` and `it.scopedLive` do not exist. `it.effect` and `it.live` already give each test a scope. Do not wrap a test body in `Effect.scoped`.
- Vitest 5 removed `it.sequential`, `describe.sequential`, and `{ sequential: true }`. Use `{ concurrent: false }`. In concurrent tests, use `ctx.expect`.
- A plain Vitest `it(...)` that returns an Effect never runs the Effect. The `floatingEffectInVitest` diagnostic reports this as an error.

## Sources

- https://github.com/Effect-TS/effect/blob/main/packages/vitest/README.md: install, helpers, logs, Vitest 5 changes
- https://github.com/Effect-TS/effect/tree/main/ai-docs/src: `09_testing` examples (also in `node_modules/effect/ai-docs/src`)
- https://github.com/Effect-TS/tsgo: `floatingEffectInVitest` and `strictEffectProvide`
- https://vitest.dev/guide/migration/: Vitest 5 migration
