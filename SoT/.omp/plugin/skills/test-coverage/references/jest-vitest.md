# Jest / Vitest Conventions

## Contents

- [Detection](#detection)
- [File Naming Conventions](#file-naming-conventions)
- [Assertion Idioms](#assertion-idioms)
- [Mocking](#mocking)
- [Common Mock-Shape Mismatches](#common-mock-shape-mismatches)
- [React Testing Library (when React is in the project)](#react-testing-library-when-react-is-in-the-project)
- [Coverage](#coverage)
- [Perf Tuning & Parallelism](#perf-tuning-parallelism)
- [Coverage Scope — What NOT to Test](#coverage-scope-what-not-to-test)
- [See Also](#see-also)

Per-framework expansion of the parent SKILL.md. Load when the project's test runner is Jest or Vitest. Pairs with the universal 6-step procedure and `<constraint>` rules in `../SKILL.md`.

## Detection

| Signal | Framework |
|---|---|
| `vitest.config.ts` / `vite.config.*` with a `test:` block | Vitest |
| `jest.config.js` / `jest.config.ts` / `"jest": {}` in package.json | Jest |
| `"test": "vitest run"` in `package.json` `scripts` | Vitest |
| `"test": "jest"` | Jest |
| Imports use `from "vitest"` (`vi.mock`, `vi.fn`) | Vitest |
| Imports use globals (`jest.fn()`, no `from "jest"`) | Jest |

The APIs are similar but not identical — Vitest uses `vi.*`, Jest uses `jest.*` and globals.

## File Naming Conventions

- Co-located: `parseDuration.ts` + `parseDuration.test.ts` in the same directory (most common, Vitest default)
- `__tests__/` folder: `src/utils/__tests__/parseDuration.test.ts` (matched by Jest's default `testMatch`)
- `.spec.ts` extension: some projects prefer for "spec" vs "unit"
- Read the project's existing files; match exactly.

## Assertion Idioms

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"; // or "@jest/globals"

describe("parseDuration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ms for '1h30m'", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
  });

  it("throws on invalid input", () => {
    expect(() => parseDuration("furlongs")).toThrow(/invalid/i);
  });

  it("resolves async", async () => {
    await expect(asyncFn()).resolves.toEqual({ ok: true });
    await expect(asyncFails()).rejects.toThrow(/specific/);
  });
});
```

Common matchers (both): `toBe`, `toEqual` (deep), `toContain`, `toMatch`, `toHaveLength`, `toBeNull`, `toThrow`, `.resolves` / `.rejects`.

## Mocking

```ts
// Vitest — auto-mocked module
vi.mock("./api", () => ({
  fetchUser: vi.fn(() => Promise.resolve({ id: 1, name: "x" }))
}));

// Vitest — partial mock with importActual
vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, fetchUser: vi.fn() };
});

// Jest equivalent
jest.mock("./api", () => ({
  fetchUser: jest.fn(() => Promise.resolve({ id: 1, name: "x" }))
}));
```

ES-modules gotcha: `vi.mock` / `jest.mock` are hoisted to the top of the file. Variables defined before the call aren't available inside the factory — use `vi.hoisted` (Vitest) or define mocks inside the factory.

## Common Mock-Shape Mismatches

| Real function returns | Easy-to-get-wrong mock |
|---|---|
| `Promise<User>` | Mock returning `User` (not wrapped) → `await` returns undefined |
| `{ data: User[] }` (axios-style) | Mock returning `User[]` directly |
| `[User, ...]` (tuple/array) | Mock returning `{ data: [...] }` |
| Default-exported function | `vi.mock("./api", () => ({ fetchUser: vi.fn() }))` — missing `default:` key |

Always read the real function's signature BEFORE writing the mock.

## React Testing Library (when React is in the project)

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("submits on click", async () => {
  const onSubmit = vi.fn();
  render(<Form onSubmit={onSubmit} />);
  await userEvent.type(screen.getByLabelText(/name/i), "Alice");
  await userEvent.click(screen.getByRole("button", { name: /submit/i }));
  expect(onSubmit).toHaveBeenCalledWith({ name: "Alice" });
});
```

Use `userEvent` (async) over `fireEvent` (sync) for anything user-facing — it dispatches the full event sequence (focus, keydown, keyup, input) rather than just one event.

## Coverage

```bash
# Vitest
pnpm vitest run --coverage                       # CLI
# or in vitest.config.ts:
# test: { coverage: { provider: 'v8', thresholds: { lines: 80 } } }

# Jest
pnpm jest --coverage --coverageThreshold='{"global":{"lines":80}}'
```

Both default to v8 / istanbul providers. Check `coverage/index.html` for line-level uncovered branches.

## Perf Tuning & Parallelism

The right flags drift across versions — run `vitest --help` / `jest --help` for the version-correct set, OR `resolve-library-id` + `query-docs` via context7 to fetch the current docs before tuning.

Stable knobs (recent majors):

| Vitest | Jest | What |
|---|---|---|
| `--pool=forks` (default since Vitest 2.0) / `--pool=threads` | n/a (always forks) | Forks = isolated but slower; threads = faster, shared globals |
| `--maxWorkers=N` (Vitest 4 removed `poolOptions`; older majors used `--poolOptions.<pool>.maxThreads`/`maxForks`) | `--maxWorkers=N` or `--maxWorkers=50%` | Cap parallel workers; CI default leaves room for runner overhead |
| `--no-isolate` | n/a | Reuse same context across files in a worker — fast but module state leaks |
| `--shard=1/4` | `--shard=1/4` | Run 1 of 4 disjoint slices; ideal for CI matrix |
| `--bail=1` (takes a failure count) | `--bail` | Stop on first failure — faster local iteration |
| `--changed [since]` | `--onlyChanged` / `--changedSince` | Tests touching changed files only |

Per-machine guidance:
- **Laptop (4–8 cores), local iteration:** leave defaults; layer `--changed --bail=1` (Vitest) or `--onlyChanged --bail` (Jest) for tight loops.
- **CI runner with N vCPU:** explicit `--maxWorkers=N` (Jest and Vitest) — don't let the runner thrash.
- **DB-sharing integration tests:** drop to `--maxWorkers=1` (or run them as a separate `:integration` suite); shared connections + parallel tests = flake. For a flaky test, find the root cause; do not add `retry` (see `test-types.md`, Flaky tests).
- **CI matrix:** prefer `--shard=` over manually splitting test files; the runner handles balanced distribution.

## Coverage Scope — What NOT to Test

```ts
// BAD — testing a barrel; asserts no behavior
// src/utils/index.ts
export { parseDuration } from "./parse-duration";
export { formatDate } from "./format-date";
// src/utils/index.test.ts
import * as utils from "./index";
it("exports parseDuration", () => { expect(typeof utils.parseDuration).toBe("function"); });
```

```ts
// GOOD — exclude barrels/types/generated from coverage; test the implementations directly
// vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      exclude: [
        "**/index.ts",              // re-export barrels
        "**/*.types.ts",
        "**/*.d.ts",
        "**/generated/**",          // codegen output
        "**/prisma/**",             // prisma client
        "**/migrations/**",
        "**/*.config.{ts,js,mjs}",  // framework config
        "**/__tests__/**",
        "**/__mocks__/**",
      ],
      thresholds: { lines: 80, branches: 75 },
    },
  },
});
```

Jest equivalent: `coveragePathIgnorePatterns: [...]` in `jest.config.js`. Per-file `/* istanbul ignore file */` is a smell — prefer config-level exclusion so reviewers can see the rule.

## See Also

- `../SKILL.md` — universal 6-step procedure + constraints
- Vitest docs: https://vitest.dev/
- Jest docs: https://jestjs.io/
- React Testing Library: https://testing-library.com/docs/react-testing-library/intro
