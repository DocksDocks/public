# Maintainability & AI-Slop Finding Catalog

## Contents

- [Pattern Catalog](#pattern-catalog)
  - [Dead Code](#dead-code)
  - [Duplication](#duplication)
  - ["Smart" Abstractions](#smart-abstractions)
  - [AI-Slop Tells](#ai-slop-tells)
  - [Smell Baseline (Fowler)](#smell-baseline-fowler)
- [Severity Calibration](#severity-calibration)
- [False-Positive Guards](#false-positive-guards)
- [Output Template (extends the parent SKILL.md format)](#output-template-extends-the-parent-skillmd-format)
- [See Also](#see-also)

Per-axis expansion of the parent SKILL.md Step 3 (maintainability / AI-slop bucket). Load when triaging dead code, duplication, "smart" abstractions, contradictory comments, defensive code for impossible cases, or made-up error messages. Pairs with the universal `<constraint>` rules: evidence-bearing file:line, articulated failure scenario, calibrated severity (cap MEDIUM for maintainability findings).

## Pattern Catalog

### Dead Code

| Symptom | Starting severity |
|---|---|
| Exported function with zero in-repo callers (no test, no usage) — verified via `grep -r` on the symbol | LOW-MEDIUM |
| Unreachable branch — `if (false)` / `if (NODE_ENV === 'never')` | LOW |
| Commented-out blocks > 5 lines | LOW (cap; comments persist for a reason — but cite for cleanup) |
| Import never used | LOW |
| Function declared but never exported and never called locally | LOW-MEDIUM |
| Whole file unreferenced (no import, no entry-point glob, no test) | MEDIUM |

False-positive guard: a public package export may have no in-repo callers because it's consumed externally. Always confirm by checking `package.json` `exports` / `main` / library entry points.

### Duplication

| Symptom | Starting severity |
|---|---|
| Same 10+ line block in 3+ files | MEDIUM |
| Same regex / magic number or string / config object in 2+ files | LOW-MEDIUM |
| Near-duplicates with 1-2 line diff that could be parameterized | LOW |
| `if-else-if` chain of ≥5 branches mapping enum → behavior | MEDIUM |

Fix for a repeated magic number or string: apply `code-guardrails` (one owning module per value, derived constants, imports instead of copies).

False-positive guard: similarity isn't duplication. Two functions doing the same thing for different domains (user vs. order) may justify staying separate — coupling is worse than duplication when the change-frequency differs.

### "Smart" Abstractions

| Symptom | Why it's a smell |
|---|---|
| Generic abstraction created for a single call site | Premature; concrete code is clearer until the second caller arrives |
| Class hierarchy 3+ deep with overrides | Inheritance is rigid; usually composition + functions is clearer |
| Factory factory / builder builder | Indirection without value; ask "what does this give us" — if no answer, flatten |
| Configuration with 20+ flags / strategy enum | Each flag is a future bug surface; split into separate functions |
| Magic property names (`obj['__internal_thing']`) | Bypasses static analysis + IDE refactoring tools |

### AI-Slop Tells

These patterns appear disproportionately in AI-generated code. Each is a finding when present:

| Tell | What to look for | Why it's a problem |
|---|---|---|
| **Made-up error messages** | "ErrorFooException: An error occurred while processing" | Never produced by the underlying library; either fabricated or paraphrased |
| **Defensive code for impossible cases** | `if (typeof Array.isArray !== 'function')` / null-check on a freshly-constructed object | Adds noise; the case is unreachable; suggests the model lacks confidence in its own scope |
| **Re-exports for no reason** | `export { foo } from './foo'; export { foo as foo2 } from './foo';` | Redundant; no consumer needs the alias |
| **Comments that restate the code** | `// increment count by 1` above `count++` | Adds reading cost without adding meaning |
| **Catch-and-rethrow with the same message** | `catch (e) { throw new Error(e.message) }` | Loses stack trace + cause chain |
| **Inline migration / cleanup notes** | `// TODO: refactor this someday` / `// Old code, leaving for reference` | Either fix it or delete it; comments rot |
| **Backward-compatibility scaffolding for code that was never released** | `// keep legacy <name> for compat` on a one-day-old function | Premature compatibility freeze |
| **Try/catch where every branch returns the same shape** | `try { return f() } catch { return null }` silently in 5 places | Hides errors; should be a typed Result or explicit error path |
| **Mock data left in production code** | `if (user.id === 'demo-user') return { name: 'Demo' }` | Test fixture leaked into prod path |
| **Variable name + comment disagreeing** | `const isActive = false  // user is active` | One of them is stale; review history to know which |
| **Boilerplate JSDoc that adds nothing** | `/** Get the user. @returns User */ function getUser(): User` | Pure noise; types already convey it |

### Smell Baseline (Fowler)

A fixed set of code smells from Martin Fowler's *Refactoring* (chapter 3). The Standards axis applies this baseline to every diff, even when the repo documents no standards. Two rules bind it:

- **The repo overrides.** A documented repo standard wins. If the repo endorses a pattern that the baseline flags, do not report the smell.
- **Always a judgement call.** Label each hit as a heuristic ("possible Feature Envy"), never as a hard violation. Skip what tooling already enforces.

| Smell | What to look for in the diff | Suggested fix |
|---|---|---|
| Mysterious Name | A function, variable, or type name that does not say what it does or holds | Rename; if no honest name fits, the design is unclear |
| Duplicated Code | The same logic shape in more than one hunk or file | Extract the shared shape; call it from each site |
| Feature Envy | A method that uses another object's data more than its own | Move the method to the data it uses |
| Data Clumps | The same few fields or parameters always travel together | Bundle them into one type; pass that type |
| Primitive Obsession | A primitive or string stands in for a domain concept | Give the concept its own small type |
| Repeated Switches | The same `switch` / `if` chain on the same type in several places | One shared lookup map, or polymorphism |
| Shotgun Surgery | One logical change forces edits scattered across many files | Gather what changes together into one module |
| Divergent Change | One file or module changes for several unrelated reasons | Split it so each module changes for one reason |
| Speculative Generality | Abstractions, parameters, or hooks for needs the spec does not have | Delete; inline until a real need exists |
| Message Chains | Long `a.b().c().d()` navigation the caller should not depend on | Hide the walk behind one method on the first object |
| Middle Man | A class or function that mostly delegates onward | Remove it; call the real target directly |
| Refused Bequest | A subclass or implementer that ignores or overrides most of what it inherits | Drop the inheritance; use composition |

Severity follows the calibration below (cap MEDIUM). Smell baseline adapted from Matt Pocock's `code-review` skill (MIT): <https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md>.

## Severity Calibration

Maintainability findings cap at MEDIUM. The calibration knob is:

- **HIGH cap** never — maintainability doesn't cause outages directly (those become bugs)
- **MEDIUM** — change-frequency is high (touched ≥ once per month historically per `git log`) → noise hurts
- **LOW** — all other code (touched less than once per month) → cleanup is nice-to-have, not urgent

If the same maintainability finding appears in code that's about to be deleted / refactored anyway, drop the finding — the cleanup will subsume it.

## False-Positive Guards

| Pattern | Why it triggers | Why it's not a bug |
|---|---|---|
| Comment seems contradictory | Doc says X, code does Y | Doc may describe the *contract*; code is the *implementation* of a different aspect |
| "Unused" export | grep finds zero callers | Public API consumed by external users (library mode), or wired via dynamic import |
| Defensive null check looks redundant | Type says non-null | Type may be from a JSON parser / external boundary — the check is justified |
| Duplicated regex | Same pattern in 2 files | Patterns may evolve independently (e.g., email validation in `auth` vs. in `contact-form`) — splitting is fine |

## Output Template (extends the parent SKILL.md format)

```text
MEDIUM · Maintainability · src/utils/format.ts:23, src/api/users.ts:88, src/api/orders.ts:54
  Evidence: same 14-line `formatCurrency` block duplicated across 3 files
  Why it's a problem: Each new currency or locale change requires 3 edits.
    Adding KRW support last month touched only 2 of the 3 sites — production
    showed mixed formatting until the third was found.
  Suggested fix: extract to `src/utils/format.ts` and import; remove copies.

LOW · AI slop · src/api/auth.ts:42
  Evidence:
    } catch (e) {
      throw new Error(e.message)  // re-throw to preserve type
    }
  Why it's a problem: Loses stack trace and `cause` chain. Comment is wrong —
    a re-throw doesn't preserve type; original error became a plain Error.
  Suggested fix: `} catch (e) { throw new Error('auth failed', { cause: e }) }`
    or just `throw e;` if no wrapping is needed.
```

## See Also

- `../SKILL.md` — universal 5-step review procedure + constraints
- `refactor` skill — when findings exceed ≥ 10 and a sweep is needed
- `lint-no-suppressions` skill — if a fix involves removing a suppression
- `fix-workflow` references/bug-fix-templates.md — when a maintainability finding hides a real bug
