# Test speed and proof

Use this file to make test jobs faster in continuous integration (CI). Each change must keep every test. Find the slow phase before you change a setting.

## Contents

- [Find the slow phase](#find-the-slow-phase)
- [Vitest](#vitest)
- [bun test](#bun-test)
- [Playwright and Jest](#playwright-and-jest)
- [Other ecosystems](#other-ecosystems)
- [Shards and fixed cost](#shards-and-fixed-cost)
- [Flaky tests](#flaky-tests)
- [Proof checklist](#proof-checklist)
- [Sources](#sources)

## Find the slow phase

| Runner | Probe | What it shows |
|---|---|---|
| Vitest | `Duration` line at the end of a run | Time per phase: environment, import, transform, setup, worker, tests |
| Vitest | `vitest doctor` | Timings under other configurations, including `isolate: false` |
| Vitest | `--reporter=verbose` | Each test with its duration. `slowTestThreshold` marks slow tests |
| Bun | `bun test --timings=<file> --update-timings` | A JSON file of durations. Sort it slowest first |
| Jest | `--verbose` | Each test with its duration |
| pytest | `--durations=<n> --durations-min=<seconds>` | The slowest test phases |

- If the `tests` phase is small and `import` or `environment` is large, change the configuration, not the tests. More cores help when module loading takes most of the time.
- `NODE_COMPILE_CACHE` reuses V8 bytecode when you cache its directory between runs.

## Vitest

| Pool | Use it for | Risk |
|---|---|---|
| `forks` (default) | Most suites | None specific |
| `threads` | Many small files | No `process.chdir`. Native modules (Prisma, bcrypt, canvas) can crash the worker |
| `vmForks`, `vmThreads` | Document Object Model (DOM) suites where each file needs a fresh `window` | Memory leaks. Cross-realm `instanceof` and `toStrictEqual` errors. `isolate` has no effect. Prefer `vmForks` for large suites |

Isolation is on by default: each test file gets a fresh worker or context. `isolate: false` lets files in one worker share module state, mocks, globals, and singletons.

- Warning: shared state makes tests depend on order. Turn isolation off only in a separate project of proven files. Keep files that use fake timers or change globals in the isolated project.
- In the shared project, set `restoreMocks`, `unstubGlobals`, and `unstubEnvs`. Vitest 5 clears mock calls by default, but spy implementations persist.
- Use the `node` environment by default. Give `jsdom` or `happy-dom` only to the files that need it. `happy-dom` starts faster than `jsdom`.

```ts
// vitest.config.ts. Files opt in by name. Inline projects inherit root options (Vitest 4: add extends: true).
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', projects: [
  { test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.{dom,shared}.test.ts'] } },
  { test: { name: 'dom', include: ['src/**/*.dom.test.ts'], environment: 'happy-dom' } },
  { test: { name: 'shared', include: ['src/**/*.shared.test.ts'], isolate: false,
    restoreMocks: true, unstubGlobals: true, unstubEnvs: true } },
] } })
```

- `maxWorkers` defaults to all available parallelism in run mode, and `VITEST_MAX_WORKERS` sets it. Keep workers at or below the runner core count: too many workers on few cores cause timeouts and flaky tests.
- On a runner with many cores, the one Vite server in the main thread can limit speed. Run several shards on that machine, each with a lower `VITEST_MAX_WORKERS`.
- Vitest 4 moved pool options to the top level. `poolOptions` is gone, and `maxThreads` and `maxForks` became `maxWorkers`. Old guides show the old keys.
- Shard by file with `vitest run --reporter=blob --shard=<i>/<n>`. Merge with `vitest --merge-reports`. Vitest 5 writes the blobs to `.vitest/blob/`, and Vitest 4 writes them to `.vitest-reports/` ([Vitest 4 guide](https://v4.vitest.dev/guide/improving-performance)). Read the folder for the installed major.
- In the sketch, `<report-dir>` is `.vitest` on Vitest 5 and `.vitest-reports` on Vitest 4. Verify each action major first: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

```yaml
permissions: { contents: read }
jobs:
  test:
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
    timeout-minutes: 20
    strategy: { matrix: { shard: [1, 2, 3, 4] } }
    steps:   # install steps follow the checkout
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - run: pnpm exec vitest run --reporter=blob --shard=${{ matrix.shard }}/${{ strategy.job-total }}
      - if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v7
        with: { name: "blob-${{ matrix.shard }}", path: <report-dir>, include-hidden-files: true, retention-days: 1 }
  report:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
    timeout-minutes: 10
    steps:   # install steps follow the checkout
      - if: needs.test.result != 'success' # a missing blob still merges with exit 0
        run: exit 1
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - uses: actions/download-artifact@v8
        with: { pattern: blob-*, path: <report-dir>, merge-multiple: true }
      - run: pnpm exec vitest --merge-reports
```

## bun test

- By default, `bun test` runs all files in one process with one shared global. It is fast but not isolated.
- `--parallel[=<n>]` runs files in worker processes and implies `--isolate`. On a single-core runner, it gives no gain.
- Warning: `--parallel --no-isolate` is the fastest mode. It has the same leak risk as Vitest `isolate: false`.
- `--isolate=modules` keeps just-in-time (JIT) compiled code but gives each file fresh modules.
- `--shard=<i>/<n>` splits files across jobs. Add `--timings=<file> --update-timings` to balance the shards by duration.
- `--concurrent` runs the tests inside one file at the same time. It helps input/output-bound tests. `--max-concurrency` caps it.
- `--reporter=junit --reporter-outfile=<path>` writes JUnit XML. With `--parallel`, the coordinator merges the output.

## Playwright and Jest

- Playwright: set `workers: process.env.CI ? 1 : undefined` for stable CI runs. Add shards for more parallel work. A larger runner helps only when you raise `workers` and the app under test keeps up.
- With `fullyParallel: true`, Playwright shards balance per test. Without it, they balance per file.
- Use the `blob` reporter in each shard. Put all blob files in one directory. Run `pnpm exec playwright merge-reports --reporter html <dir>`.
- Install only the browsers that the tests use, for example `pnpm exec playwright install --with-deps chromium`. Add `--only-shell` for headless-only runs.
- As an alternative, run the job in `mcr.microsoft.com/playwright:v<version>-noble`. Match `<version>` to `@playwright/test`.
- Do not cache browser binaries. The Playwright docs say a restore takes about as long as a download.
- Jest: `--shard=<i>/<n>` is 1-based. A custom `testSequencer` must implement `shard`.
- Jest: `--maxWorkers` takes a number or a percentage. Lower it on small runners. Keep the cache on: do not pass `--no-cache`. `--showConfig` prints the `cacheDirectory`.

## Other ecosystems

| Ecosystem | Parallel in one job | Split across jobs | Cache |
|---|---|---|---|
| Python | pytest-xdist `-n auto`. `--dist loadscope`, `loadfile`, or `loadgroup` keeps costly fixtures on one worker | pytest-split: commit `.test_durations` from `--store-durations`. Run `--splits <n> --group <i>` | uv cache keyed on `uv.lock` |
| Go | `-p <n>` for packages, `-parallel <n>` for `t.Parallel()` tests | Split the package list | `go test ./...` reuses passing results. Cache `GOCACHE`. `-count=1` turns reuse off |
| Rust | cargo-nextest runs tests in parallel | Build once with `cargo nextest archive`. Run `--partition slice:<m>/<n>` or `hash:<m>/<n>` | Swatinem/rust-cache keeps dependencies, not workspace crates. sccache caches compiler output |

Warning: the default pytest-split algorithm breaks with order-randomizing plugins. Use one seed in every job.

## Shards and fixed cost

- Each shard repeats checkout, toolchain setup, install, and service start. If setup is a large part of a shard, cut setup first. Then add shards.
- When the fixed cost is high, prefer fewer, larger runners to more shards.
- Shards split by file. Split a very large test file so that the shards stay balanced.
- Give each shard its own database or service instance. For each worker, add `VITEST_POOL_ID` to the database name. Vitest 5 counts it from 1.
- Each shard adds billed minutes. Report the wall-time gain and the billed-time cost together.

## Flaky tests

- Retries hide real races and add wall time on each failure. Use one or two retries in CI only. Playwright `--fail-on-flaky-tests` and cargo-nextest `--flaky-result fail` fail a run when a test passes only on retry.
- Move a known-flaky test to a separate non-blocking job. Give it an owner and an end date.
- Reproduce order problems with `bun test --rerun-each <n>`, `bun test --randomize --seed <n>`, or `vitest run --sequence.shuffle --sequence.seed=<n>`.
- People own these retries and quarantines as CI policy. The agent rule for flaky tests is in the `test-coverage` skill, `references/test-types.md`, section Flaky tests. An agent finds the root cause and never adds a retry, a sleep, or a skip to get a pass.

## Proof checklist

Run these checks on the same commit before and after a test-speed change:

1. The test file list is the same. Save the output of `vitest list --filesOnly`, `jest --listTests`, or `playwright test --list` before and after. Check that neither file is empty. Then `diff` the two files. For shards, combine the lists of all shards or read the merged report.
2. The passed, skipped, and todo counts are the same.
3. After an isolation or pool change, run the suite several times. Also run it in shuffled order with a fixed seed. Every run passes.
4. The required check still reports. A matrix changes job names, so keep one aggregator job with the required name.
5. Wall time and billed time moved in the expected direction against the baseline from `measure.md`.

## Sources

- Vitest: https://vitest.dev/guide/improving-performance, https://v4.vitest.dev/guide/improving-performance, https://vitest.dev/guide/projects, https://vitest.dev/guide/cli, https://vitest.dev/config/isolate, https://vitest.dev/config/pool, https://vitest.dev/config/restoremocks, https://vitest.dev/config/clearmocks, https://vitest.dev/config/sequence, https://vitest.dev/guide/reporters, https://v4.vitest.dev/guide/migration, https://vitest.dev/guide/migration, https://github.com/actions/upload-artifact
- Bun and Playwright: https://bun.com/docs/test, https://bun.com/docs/test/parallel, https://bun.com/docs/test/reporters, https://playwright.dev/docs/test-sharding, https://playwright.dev/docs/ci, https://playwright.dev/docs/browsers, https://playwright.dev/docs/test-retries
- Jest, Python, Go, and Rust: https://jestjs.io/docs/cli, https://pytest-xdist.readthedocs.io/en/stable/distribution.html, https://github.com/jerry-git/pytest-split, https://docs.pytest.org/en/stable/how-to/usage.html, https://docs.astral.sh/uv/guides/integration/github/, https://pkg.go.dev/cmd/go, https://github.com/actions/setup-go, https://nexte.st/docs/ci-features/partitioning/, https://nexte.st/docs/features/retries/, https://github.com/Swatinem/rust-cache, https://github.com/mozilla/sccache
