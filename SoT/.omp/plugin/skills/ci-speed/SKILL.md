---
name: ci-speed
description: "Use when CI or test runs are slow or costly: GitHub Actions queue time, slow checkout or installs, caches that miss, slow lint, type-check, or test jobs, sharding, affected-only runs, pre-push hooks, or moving to Blacksmith or other faster runners with a GitHub-hosted fallback. Measures queue, setup, and work per job, then ranks changes by measured savings and risk. Not for writing tests (use test-coverage or tdd-workflow), lint rule design (use code-guardrails), or CVEs (use dep-vuln-workflow)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  updated: "2026-11-17"
  content_hash: "beee07a4e4b05b211066c459f119316c3d5912a31ef62f1c33b35326b7c722b6"
---

# CI Speed

This skill makes continuous integration (CI) runs faster and cheaper. It targets two numbers: the wall time of each pull request and the billed runner minutes. Measure both numbers before you change anything.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
Measure before and after each change. Measure each job, and split its time into queue, setup, and work. Compare several runs by the median and the 90th percentile (p90). One run is noise. The first run after a cache change is cold, so do not count it.
</constraint>

<constraint>
A speed change must not lose coverage. Required checks must still report. The same test files and the same test count must still run. A suite that the change must run must never be skipped while the required check reports green. Before you keep an isolation change or an affected-only change, prove that it still catches a known failure.
</constraint>

<constraint>
Speed and cost move separately, so report both for each change. A tool swap or a new runner vendor is a proposal with its measured gain. Make the swap only when the user asks. A third-party runner runs the repository code and receives its secrets, so the user must approve the vendor.
</constraint>

## When to use

- Pull request checks take too long, or agents wait for CI between pushes.
- The GitHub Actions bill grows.
- Jobs wait for a runner before they start.
- Checkout, toolchain setup, or dependency installs take a large share of a job.
- Dependency caches miss on pull request runs.
- Format, lint, type check, or test jobs are slow.
- You plan test sharding, affected-only runs, or a pre-push hook.
- You plan a move to Blacksmith or another runner vendor with a GitHub-hosted fallback.

## When not to use

| Task | Use instead |
|---|---|
| Write tests or add coverage | `test-coverage`, `tdd-workflow` |
| Design lint rules and strictness | `code-guardrails` |
| Suppression comments and the suppression hook | `lint-no-suppressions` |
| Security advisories for dependencies | `dep-vuln-workflow` |
| Effect code and Effect diagnostics | `effect-ts` |

## Workflow

1. **Measure.** Get queue, setup, and work seconds for each job over recent successful runs. Get the billed minutes too. Follow [references/measure.md](references/measure.md).
2. **Map the critical path and what each job protects.**
   - Find the longest `needs:` chain. It sets the wall time of the run.
   - List the required checks in the rulesets and the branch protection of the default branch.
   - List the deploy and release jobs that depend on each job.
   - Find tests that parse the workflow files:

   ```bash
   grep -rln --exclude-dir=node_modules '\.github/workflows' <test-dir>
   ```

3. **Pick levers.** Start with the largest measured bucket on the critical path. Use the [bottleneck table](#bottleneck-to-lever).
4. **Change one lever at a time and prove it.** Put the reason in a YAML comment. Lint the workflow files with [`actionlint`](https://github.com/rhysd/actionlint). Run the proof from the table.
   - actionlint can reject keys that are newer than its release, for example `cache-mode` and in-job parallel steps.
   - If actionlint rejects a key, confirm the key on the [workflow syntax page](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). Do not remove a valid key to satisfy the linter.
5. **Measure again and report.** Leave out the cold first run. Use the report template in [references/measure.md](references/measure.md).

A faster job off the critical path saves billed minutes only. It does not cut the wall time.

## Bottleneck to lever

| Measured bottleneck | First lever | Proof | Reference |
|---|---|---|---|
| Queue time | Check the plan concurrency limit and the runner label. Then try a third-party runner. | Queue median and p90 per label fall | [references/measure.md](references/measure.md), [references/blacksmith.md](references/blacksmith.md) |
| Duplicate or stale runs | Limit `push` to the default branch. Cancel stale pull request runs with a `concurrency` group keyed on the pull request number, and give every other run its own group (`github.run_id`). | One run per pull request head; every default-branch run finishes | [references/github-actions.md](references/github-actions.md) |
| Serial single job | Split independent checks into parallel jobs or in-job parallel steps | Critical path falls; billed minutes reported | [references/github-actions.md](references/github-actions.md) |
| Checkout | Keep `fetch-depth: 1`. If the job needs history, use `fetch-depth: 0` with `filter: blob:none`. | Checkout step falls; history commands still work | [references/github-actions.md](references/github-actions.md) |
| Install | Frozen install of only the packages that the job needs | Install step falls; lockfile unchanged | [references/js-toolchain.md](references/js-toolchain.md) |
| Cache misses | Key on the lockfile. Seed the cache from `push` on the default branch. | Hit rate on pull request runs rises | [references/github-actions.md](references/github-actions.md) |
| Format | If the formatter needs no install, run its check before the install | A known bad file still fails | [references/js-toolchain.md](references/js-toolchain.md) |
| Lint | Measure the rule cost: [`TIMING=all eslint .`](https://eslint.org/docs/latest/extend/custom-rules#profile-rule-performance) prints time per rule, and [`eslint --stats`](https://eslint.org/docs/latest/use/command-line-interface#--stats) adds statistics. Propose a faster linter with its measured gain; swap only on request. | Same findings on a commit with one planted violation per enabled rule family; rules that oxlint lacks stay in ESLint | [references/js-toolchain.md](references/js-toolchain.md) |
| Type check | TypeScript 7 `tsc` with one fixed `--checkers` value in every environment. `bun check` is a faster option. | Same errors on a commit with a known type error | [references/js-toolchain.md](references/js-toolchain.md) |
| Unit tests | Read the phase breakdown. Cut setup and import time before you add shards. | Same test files and same test count | [references/tests.md](references/tests.md) |
| Browser tests | Shard by file. Install only the browsers that the suite uses. | Same test count over all shards | [references/tests.md](references/tests.md) |
| Every suite on every pull request | Affected-only runs, plus the full suite on the default branch | A planted change in each area still runs its suite | [references/affected-and-hooks.md](references/affected-and-hooks.md) |
| Slow agent feedback loop | Pre-push hook for format, lint, and type check on changed files | Hook time; CI still runs the full checks | [references/affected-and-hooks.md](references/affected-and-hooks.md) |
| Docker builds | Order layers by change rate. Cache layers per image. Build only when image inputs change. | Build step falls; CI tests the image that it publishes | [references/github-actions.md](references/github-actions.md), [references/blacksmith.md](references/blacksmith.md) |

## Runner choice

| Runner class | Use it for | Limits |
|---|---|---|
| GitHub-hosted standard (`ubuntu-latest`, `ubuntu-24.04`, `ubuntu-24.04-arm`) | The default for every job | Specs differ for public and private repositories. Free in public repositories. |
| `ubuntu-slim` | Gate jobs only: change detection, aggregate checks, labelers, small format checks | 1 vCPU, 15-minute job limit, unprivileged container, no Docker-in-Docker |
| GitHub larger runners | CPU-bound jobs on Team or Enterprise Cloud plans | Billed in public repositories too. Smaller pools can add queue time. |
| Blacksmith and other vendors | Queue time or CPU time, after the user approves the vendor | Separate bill. The vendor runs your code with your secrets. |

- If standard jobs queue for minutes, check the [concurrency limit of the plan](https://docs.github.com/en/actions/reference/limits) first.
- Read the specs in the [GitHub-hosted runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and the [larger runner reference](https://docs.github.com/en/actions/reference/runners/larger-runners).
- Read the per-minute rates on the [runner pricing page](https://docs.github.com/en/billing/reference/actions-runner-pricing).
- For Blacksmith setup, read [references/blacksmith.md](references/blacksmith.md).
- For one workflow that runs on both runner types, read [references/runner-fallback.md](references/runner-fallback.md).

Rule: each `runs-on` that reads a variable keeps a literal GitHub-hosted fallback. GitHub passes no configuration variables to `pull_request` runs from forks, and an empty `runs-on` fails ([community discussion](https://github.com/orgs/community/discussions/44322)).

## BAD / GOOD

Snippets pin action majors. The release marked Latest can be an older major. So before you copy a snippet, read the highest release tag of each action:

```bash
git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1
```

Cache key ([dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)):

```yaml
# BAD: a new key on every commit, so every run misses and uploads a new entry
- uses: actions/cache@v6
  with:
    path: ~/.bun/install/cache
    key: deps-${{ github.sha }}
```

```yaml
# GOOD: the key changes only with the lockfile, and only default-branch pushes save it
on:
  pull_request:
  push:
    branches: [main] # pull request runs restore caches from the default branch
permissions: { contents: read }
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false } # no later step talks to the remote
      - id: deps
        uses: actions/cache/restore@v6
        with:
          path: ~/.bun/install/cache
          key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
          restore-keys: bun-${{ runner.os }}-
      - run: bun ci
      - if: github.event_name == 'push' && steps.deps.outputs.cache-hit != 'true' # untrusted runs never write
        uses: actions/cache/save@v6
        with: { path: ~/.bun/install/cache, key: "${{ steps.deps.outputs.cache-primary-key }}" }
```

Required check and path filter ([skipped but required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#handling-skipped-but-required-checks), [`dorny/paths-filter`](https://github.com/dorny/paths-filter)):

```yaml
# BAD: a docs-only pull request skips the workflow, so the required check stays Pending
on:
  pull_request:
    paths: ["src/**"]
```

```yaml
# GOOD: the workflow always runs, and one aggregate job is the only required check
on:
  pull_request:
permissions: { contents: read }
jobs:
  changes:
    runs-on: ubuntu-slim
    timeout-minutes: 5
    permissions: { contents: read, pull-requests: read }
    outputs:
      app: ${{ steps.filter.outputs.app }}
    steps:
      - if: github.event_name != 'pull_request' # push and merge_group runs: paths-filter runs git fetch, so keep the credentials
        uses: actions/checkout@v7
      - id: filter
        uses: dorny/paths-filter@v4
        with:
          filters: |
            app:
              - 'src/**'
              - 'package.json'
              - '<lockfile>'
  test:
    needs: changes
    if: needs.changes.outputs.app == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
        with: { persist-credentials: false }
      - run: <test command>
  ci-ok:
    needs: [changes, test]
    if: always() # a skipped test job is fine; a failed or cancelled one is not
    runs-on: ubuntu-slim
    timeout-minutes: 5
    steps:
      - if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
        run: exit 1
```

Runner variable ([`vars` context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#vars-context)):

```yaml
# BAD: fork pull requests get no variables, so the job cannot start
runs-on: ${{ vars.CI_RUNNER_LINUX }}
```

```yaml
# GOOD: an unset or empty variable falls back to a GitHub-hosted label
runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
```

## Gotchas

| Symptom | Cause | Fix |
|---|---|---|
| Each push to a pull request branch starts two runs | `push` has no branch filter, so `push` and `pull_request` both fire | Limit `push` to the default branch |
| Pull request runs miss caches that other pull requests saved | A pull request cache is scoped to `refs/pull/<N>/merge` ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)) | Seed caches from `push` on the default branch |
| `bun check` or `bun fmt` runs something unexpected | A `package.json` script with the same name runs instead ([check](https://bun.com/docs/runtime/check), [fmt](https://bun.com/docs/format)) | Use `bun check --no-script` and `bun fmt --no-script --check` |
| An `ubuntu-slim` job fails at 15 minutes despite a higher `timeout-minutes` | `ubuntu-slim` terminates jobs at 15 minutes ([docs](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#single-cpu-runners), [report](https://github.com/orgs/community/discussions/185983)) | Set `timeout-minutes: 15` or less, or move the job to `ubuntu-latest` |
| `oxlint --type-aware` reports thousands of findings in dependencies | No `.gitignore` covers `node_modules`, so oxlint lints it | Add `node_modules` and build output to `.gitignore`, or set `ignorePatterns` ([config](https://oxc.rs/docs/guide/usage/linter/config)) |
| A copied snippet pins an old action major | Doc examples lag behind action releases, and the release marked Latest can be an older major | Read the highest tag with the `git ls-remote` command in [BAD / GOOD](#bad--good) |
| A tool started with `bun x` or `npx` is a different program | When the tool is not installed, `bun x` and `npx` fetch the npm package whose name equals the binary name. That package is not always the tool you mean: the npm package named `tsc` is not TypeScript ([bun x](https://bun.com/docs/pm/bunx), [npx](https://docs.npmjs.com/cli/v11/commands/npx)). | Run tools through a package script (`bun run <script>`, `pnpm run <script>`), `pnpm exec <binary>`, or `bun x --no-install <binary>` |
| A merge queue never merges | The workflow has no `merge_group` trigger, so required checks never report ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)) | Add `merge_group:` next to `pull_request` |
| `filter: blob:none` gives no history | `filter` does not change `fetch-depth`, which stays 1 ([checkout](https://github.com/actions/checkout)) | Set `fetch-depth: 0` too |
| Bun packages download on every run | `oven-sh/setup-bun` caches only the Bun executable ([setup-bun](https://github.com/oven-sh/setup-bun)) | Restore `~/.bun/install/cache` with `actions/cache/restore`, and save it on default-branch pushes, as in the GOOD cache key snippet |
| A job that waits for an absent runner does not fail | GitHub keeps the job queued until a matching runner comes online ([routing](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#routing-precedence-for-self-hosted-runners)) | Use the fallback rule and the scheduled guard in [references/runner-fallback.md](references/runner-fallback.md) |

## References

- [references/measure.md](references/measure.md): queue, setup, and work per job; billed minutes and wall time; the report template.
- [references/github-actions.md](references/github-actions.md): triggers, concurrency, path filters, job graph, checkout, caching, artifacts, timeouts, runner classes, and merge queue.
- [references/js-toolchain.md](references/js-toolchain.md): install, format, lint, and type check for JavaScript and TypeScript projects (Bun, pnpm, npm).
- [references/tests.md](references/tests.md): test runner speed, isolation, sharding, and proof that no test was lost.
- [references/affected-and-hooks.md](references/affected-and-hooks.md): affected-only runs, skip-logic proof, and pre-push hooks.
- [references/blacksmith.md](references/blacksmith.md): Blacksmith runners.
- [references/runner-fallback.md](references/runner-fallback.md): one workflow for Blacksmith and GitHub-hosted runners, with a fallback.

Ideas restated, no text copied: enesgules `optimise-github-actions` (https://github.com/enesgules/dotfiles/tree/main/skills/optimise-github-actions), Owen Gretzinger's CI post (https://x.com/owengretzinger/status/2117003552472355024), and Linear's CI post (https://linear.app/now/ci-bottleneck-reworked).

## Report a problem with this skill

When this skill gives a wrong, outdated, or unsafe instruction, or a script that it ships fails, report the problem in the public DocksDocks/docks repository. Use the docks `report-skill-issue` skill for the report. If that skill is not installed, do not file anything: give the user a draft instead. The draft names this skill and its plugin version, quotes the instruction, and states what happened and what you expected. Leave out secrets and private names.
