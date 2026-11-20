# Depth, Seams, and the Deletion Test

Deep reference for the three-tests constraint in the parent `SKILL.md`. Use these terms exactly when proposing or reviewing structural refactors — vocabulary drift ("component," "service," "API," "boundary") makes every review longer and every conversation looser. Adapted from Matt Pocock's `codebase-design` skill (`https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md` and its `DEEPENING.md`, MIT).

## Contents

- [When this applies](#when-this-applies)
- [Vocabulary lock — use exactly](#vocabulary-lock--use-exactly)
- [The three tests](#the-three-tests)
- [When applying the three tests to SOLID violations](#when-applying-the-three-tests-to-solid-violations)
- [Dependency categories — how to test across the seam](#dependency-categories--how-to-test-across-the-seam)
- [Testing strategy: replace, don't layer](#testing-strategy-replace-dont-layer)
- [Rejected framings (don't use these)](#rejected-framings-dont-use-these)
- [Relationships (one-line ontology)](#relationships-one-line-ontology)
- [Gotchas](#gotchas)
- [References](#references)

## When this applies

- Reviewing a SOLID violation and asking "is the proposed split actually an improvement, or just movement?"
- Deciding whether to introduce an interface / trait / protocol for a value that has one implementation today.
- Justifying a refactor: writing the "why this is better" line on a PR description, plan file, or review comment.
- An agent's refactoring suggestion uses "service," "boundary," or "wrapper" — words that sound architectural but resolve to nothing testable.

## Vocabulary lock — use exactly

| Term | Meaning | Don't substitute |
|---|---|---|
| **Module** | Anything with an interface + an implementation. Scale-agnostic: a function, class, package, slice, microservice. | "unit", "component", "service" |
| **Interface** | Everything a caller must know to use the module correctly — types, invariants, ordering, error modes, required config, perf characteristics. | "API", "signature" (too narrow — those name only the type-level surface) |
| **Implementation** | What's inside the module — its body of code. | (use as-is) |
| **Depth** | Leverage at the interface — behaviour a caller / test can exercise per unit of interface they have to learn. **Deep** = lots of behaviour behind a small interface. **Shallow** = interface nearly as complex as the implementation. | "abstraction", "encapsulation" (both too vague) |
| **Seam** *(Feathers)* | A place where you can alter behaviour without editing in that place. The *location* of a module's interface. | "boundary" (overloaded with DDD's bounded context) |
| **Adapter** | A concrete thing that satisfies an interface at a seam. Names a *role*, not a substance. | "wrapper", "implementation" (an in-memory fake is a small-implementation, small-interface adapter — still an adapter) |
| **Leverage** | What *callers* get from depth — more capability per unit of interface they have to learn. | "reuse" |
| **Locality** | What *maintainers* get from depth — change, bugs, knowledge concentrated at one place rather than spreading across callers. | "DRY", "single point of change" |

## The three tests

### 1. The deletion test

> Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.

Apply to anything that looks shallow. A `formatCurrency(n)` that calls `n.toFixed(2)` and prepends `$` — delete it. The complexity (knowing about currency formatting) is so trivial it concentrates into one new line at each caller. A `chargeCustomer(amount, cardToken)` that wraps 14 lines of Stripe API calls, idempotency-key generation, and retry policy — keep it. Inlining at 6 call sites recreates 14 × 6 = 84 lines of duplicated logic.

This is the test that distinguishes **earning depth** from **moved depth**.

### 2. The interface IS the test surface

> Callers and tests cross the same seam. If you want to test *past* the interface, the module is the wrong shape.

If your test reaches inside the module to assert on a private helper, the test will rot under refactor. Either:
- the private helper has independent value (extract it as its own module — its own interface), or
- the test should reach the same way callers reach (the public interface)

This rule kills "extract a pure function for testability" half-measures that leave the real bug-causing chain untested at its real call site.

### 3. One adapter = hypothetical seam, two adapters = real seam

> Don't introduce a seam unless something actually varies across it.

A `PaymentProcessor` interface with one implementation (`StripeProcessor`) is YAGNI — the interface is a hypothetical seam, costing real interface-design tax for no actual swap. Become a real seam when you add the second adapter (an in-memory fake for tests, a Paddle implementation, a sandbox-vs-prod split). Until then, just call Stripe directly and refactor when the second caller arrives.

Corollary: an in-memory test fake **counts as the second adapter** if you write it; YAGNI doesn't apply when the test itself needs the swap. But the test fake must be a real thing you wrote, not "we could write one later."

## When applying the three tests to SOLID violations

| Smell | Apply the test | Resolution |
|---|---|---|
| File > 300 LOC, two change axes share it (S) | Deletion test on the smaller axis — if deleting it concentrates complexity into one new module, split. If it scatters complexity, the original module was the right home; the LOC count is not the violation. | Split only if deletion concentrates. |
| Switch with 5+ arms (O) | First ask what the proposal adds. A same-module Strategy Map (`Record<key, fn>` next to the dispatcher) adds no new interface and no adapter — it is an in-process change (category 1 below), so the two-adapter test does not apply. Apply the two-adapter test only when the proposal adds a new interface, class hierarchy, or module per variant: if only the current dispatcher picks branches, that seam is hypothetical; if a second consumer (test fixture, alternate dispatcher) also picks branches by key, it is real. | Growing switch → same-module strategy map. New interface / hierarchy / per-variant module → only on a real seam; otherwise keep the map in one module. |
| Interface > 10 methods (I) | Interface IS test surface — do tests reach past the interface to set up just one method? That's an I-violation signal. If every test exercises ≥ half the methods, it's not an I-violation, it's just a wide interface. | Split when test reach exceeds what the test needs. |
| Hard-coded SDK in business logic (D) | Two adapters? Real SDK in prod + a fake in tests is two real adapters → inject. Hypothetical "we might swap providers someday" is not. | Inject when a test fake is real, not aspirational. |
| `instanceof` gating behaviour (L) | Interface IS test surface — if the switch on type IS the contract, the discriminated union *is* the interface. | Discriminated union + exhaustive switch (compiler enforces the contract). |

## Dependency categories — how to test across the seam

Before you deepen a cluster of shallow modules, classify each dependency. The category decides how the deepened module is tested across its seam.

| Category | What it is | How to deepen and test |
|---|---|---|
| **1. In-process** | Pure computation, in-memory state, no I/O | Always deepenable. Merge the modules and test through the new interface directly. No adapter. |
| **2. Local-substitutable** | Has a local test stand-in (PGLite for Postgres, an in-memory filesystem) | Deepenable if the stand-in exists. Run the stand-in in the test suite. The seam stays internal; no port at the module's external interface. |
| **3. Remote but owned** (ports & adapters) | Your own services across a network boundary (internal APIs, microservices) | Define a **port** (interface) at the seam. The deep module owns the logic; inject the transport as an adapter — HTTP/gRPC/queue in production, in-memory in tests. |
| **4. True external** | Third-party services you do not control (payment, SMS providers) | The deepened module takes the dependency as an injected port; tests supply a mock adapter. |

Categories 3 and 4 satisfy the two-adapter rule by construction (production + test). Category 1 needs no seam at all; do not add a port to it.

## Testing strategy: replace, don't layer

- Once tests exist at the deepened module's interface, the old unit tests on the shallow modules are waste — delete them. Do not keep both layers.
- Write the new tests at the deepened module's interface (test 2: the interface IS the test surface) and assert on observable outcomes, not internal state.
- A test that must change when only the implementation changes is testing past the interface; rewrite it against the interface.

## Rejected framings (don't use these)

- **Depth-as-line-count ratio.** Ousterhout originally framed depth as "implementation lines ÷ interface lines." That rewards padding the implementation with no extra behaviour. We use **depth-as-leverage**: behaviour per unit of interface, judged at the call sites.
- **"Interface" as the TypeScript `interface` keyword.** Too narrow. The interface here includes every fact a caller must know — invariants, error modes, ordering — not just the type signature.
- **"Boundary" for "seam."** "Boundary" is overloaded with DDD's bounded context. Say **seam** when you mean the location where behaviour can be altered, **interface** when you mean the contract that lives there.

## Relationships (one-line ontology)

- A **Module** has exactly one **Interface**.
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module's Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Gotchas

- **A deep module can be internally composed of small, mockable parts** — they just aren't part of the *external* interface. Internal seams are fine; they don't show up in the depth calculation. Do not expose an internal seam through the interface just because tests use it.
- **"Shallow" is not an insult.** A genuinely tiny module (a `range(n)` utility) is shallow because the problem is shallow. The violation is shallow modules pretending to be deep — wrappers that exist to "abstract" but provide no leverage and no locality.
- **The deletion test is run mentally, not literally.** You're asking "what would happen if this module didn't exist," not actually deleting code. The signal is "does complexity concentrate or scatter."
- **The seam isn't free even when real.** Two adapters means the interface design tax is paid back; it doesn't mean the design is correct. The interface still has to express what both adapters need without leaking either's specifics.

## References

- Parent: `solid/SKILL.md` — apply these tests to every solid-violation entry before proposing a refactor.
- Companion: `fix-workflow/references/feedback-loops.md` — when "no correct test seam exists" surfaces during a bug fix, that's the depth/seam signal escalating into a refactor.
- Companion: `refactor/references/pre-verifier.md` Check 5 (Over-Engineering) — apply the deletion test + 2-adapter rule there to reject hypothetical-seam proposals.
- Source attribution: vocabulary and three tests from Matt Pocock's `codebase-design` skill (MIT, `https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md`; this vocabulary was first part of his `improve-codebase-architecture` skill); dependency categories and "replace, don't layer" from its companion `https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/DEEPENING.md`. Both build on John Ousterhout's *A Philosophy of Software Design* (depth concept) and Michael Feathers' *Working Effectively with Legacy Code* (seam concept).
