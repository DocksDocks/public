# Measure CI time and cost

Measure each continuous integration (CI) job before you change it. Split each job into three buckets. Keep wall time and billed minutes apart.

## Contents

- [Three buckets per job](#three-buckets-per-job)
- [Commands](#commands)
- [Jobs with needs](#jobs-with-needs)
- [Insights pages](#insights-pages)
- [Wall time and billed minutes](#wall-time-and-billed-minutes)
- [Time inside a test run](#time-inside-a-test-run)
- [How many runs to compare](#how-many-runs-to-compare)
- [Report template](#report-template)
- [Sources](#sources)

## Three buckets per job

| Bucket | What it holds | How to get it |
|---|---|---|
| Queue | The wait for a runner after GitHub creates the job | `started_at - created_at` of the job |
| Setup | `Set up job`, checkout, toolchain, cache restore, install, and post steps such as cache save | The sum of those step durations |
| Work | The steps that run the checks: format, lint, type check, tests, build | Job run time minus setup |

- If queue time is large, the lever is the runner or the plan concurrency limit.
- If setup is large, the levers are checkout, caching, and install.
- If work is large, the levers are the tool and the test configuration.

## Commands

These commands need `gh` with read access to the repository. Replace `OWNER/REPO`, `RUN_ID`, and `ci.yml`.

```bash
# Per-job queue and run seconds for one run (TSV: job, queue_s, run_s, labels)
gh api --paginate "repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100" \
  --jq '.jobs[] | select(.completed_at != null)
        | [.name, ((.started_at|fromdate)-(.created_at|fromdate)),
           ((.completed_at|fromdate)-(.started_at|fromdate)), (.labels|join(","))] | @tsv'

# Per-step seconds for every job in the run (find the slow step)
gh api --paginate "repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100" \
  --jq '.jobs[] | .name as $j | .steps[] | select(.completed_at != null)
        | [$j, .number, .name, ((.completed_at|fromdate)-(.started_at|fromdate))] | @tsv'

# Last 10 successful runs of one workflow (TSV: run_id, job, queue_s, run_s)
for id in $(gh run list -R OWNER/REPO -w ci.yml -s success -L 10 --json databaseId -q '.[].databaseId'); do
  gh api --paginate "repos/OWNER/REPO/actions/runs/$id/jobs?per_page=100" \
    --jq ".jobs[] | select(.completed_at != null) | [\"$id\", .name,
      ((.started_at|fromdate)-(.created_at|fromdate)), ((.completed_at|fromdate)-(.started_at|fromdate))] | @tsv"
done
```

- `gh run view <run-id> --json jobs` has no job `createdAt` field. It cannot give queue time, so use `gh api`.
- To include earlier attempts of a re-run, add `filter=all` to the jobs query. The default is `latest`.
- Do not build on `GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing`. GitHub documents it as closing down.
- Wall time of one run: the last job `completed_at` minus the first job `created_at`.

## Jobs with needs

In one observed public run, a job with `needs:` got its `created_at` when its upstream jobs finished. So its queue time excludes the `needs` wait. The docs do not state this. Check it on your repository:

```bash
# A downstream created_at close to the upstream completed_at confirms the behavior
gh api "repos/OWNER/REPO/actions/runs/RUN_ID/jobs?per_page=100" \
  --jq '.jobs[] | [.name, .created_at, .started_at, .completed_at] | @tsv'
```

If the check confirms it, read the `needs` wait from the critical path, not from the queue time.

## Insights pages

Open the repository or the organization, then open Insights.

| Page | Shows |
|---|---|
| Actions Usage Metrics | Minutes by workflow, job, repository, operating system, and runner type |
| Actions Performance Metrics | Average run time, average queue time, and failure rate per workflow and job |

- Both pages export comma-separated values (CSV). They leave out skipped runs and zero-minute runs.
- Organization owners grant access with the "View organization Actions metrics" custom role.
- If a page is missing for your plan, use the commands above.

## Wall time and billed minutes

| Number | Definition | Who waits or pays |
|---|---|---|
| Wall time | Run start to the end of the last job on the critical path | Pull request authors and agents |
| Billed minutes | Run time of each job, rounded up to a whole minute, at the rate of its runner class | The account owner |

- GitHub rounds each job up to the next whole minute. So many short jobs cost more than one merged job.
- Each runner class has its own per-minute rate. Read the rates on the [runner pricing page](https://docs.github.com/en/billing/reference/actions-runner-pricing). Do not use fixed multipliers between operating systems.
- Standard GitHub-hosted runners are free in public repositories. Larger runners are billed in public repositories too.
- GitHub lists self-hosted runner minutes as free. Before you compare vendors, read the [billing page](https://docs.github.com/en/billing/concepts/product-billing/github-actions) for self-hosted charges.
- A third-party runner vendor sends its own bill.
- Cancelled and failed jobs also use minutes. Count them.
- Sharding and larger runners cut wall time and can raise billed minutes. Merged jobs cut billed minutes and can raise wall time.

## Time inside a test run

| Runner | Command | What it shows |
|---|---|---|
| Vitest | Read the `Duration` line at the end of `vitest run` | Time per phase: environment, import, transform, setup, worker, tests |
| Vitest | `vitest run --reporter=verbose` | The duration of each test |
| Vitest | `vitest doctor` | Timings under other configurations, and whether the tests pass with `isolate: false` |
| Bun | `bun test --timings=<file> --update-timings` | Per-file durations as JSON. `--shard` uses the same file to balance shards. |
| pytest | `pytest --durations=20 --durations-min=1.0` | The slowest test calls, setups, and teardowns |

If the `tests` phase is small next to import and setup, tune the configuration before you touch the tests. For the levers, read [tests.md](tests.md).

## How many runs to compare

- Compare runs of the same workflow, event, and runner label. `pull_request` runs and `push` runs use different cache scopes.
- Baseline: take at least 10 successful runs. For a cost audit, take at least two weeks of runs.
- After a change, leave out the first run after a cache key change. Then take as many runs as the baseline.
- Compare the median and the 90th percentile (p90) for each job and each bucket. Do not compare means or single runs.
- If the p90 values spread wide, add more runs before you decide.
- Mark each estimate that you did not measure as "unmeasured".

## Report template

Give the parts in this order: where the time goes, why, the changes, and what you did not do.

```markdown
## CI speed report: <workflow>
Baseline: <N> successful <event> runs. After: <N> runs, cold runs left out.

### Where the time goes
| Job | On critical path | Queue median/p90 (s) | Setup median/p90 (s) | Work median/p90 (s) |
|---|---|---|---|---|
| <job> | <yes or no> | <median>/<p90> | <median>/<p90> | <median>/<p90> |

Why: <one line per slow bucket>

### Changes
| Change | Wall time median before → after | Billed minutes per run before → after | Risk | Coverage proof |
|---|---|---|---|---|
| <change> | <before> → <after> | <before> → <after> | <risk> | <proof> |

### Not done
- <lever>: <reason, for example unmeasured, needs user approval, or out of scope>
```

## Sources

- Jobs and runs REST API: https://docs.github.com/en/rest/actions/workflow-jobs, https://docs.github.com/en/rest/actions/workflow-runs
- GitHub CLI: https://cli.github.com/manual/gh_run_view, https://cli.github.com/manual/gh_run_list
- Actions metrics: https://docs.github.com/en/actions/concepts/metrics, https://docs.github.com/en/actions/how-tos/administer/view-metrics
- Billing: https://docs.github.com/en/billing/reference/actions-runner-pricing, https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Vitest: https://vitest.dev/guide/improving-performance, https://vitest.dev/guide/cli, https://vitest.dev/guide/reporters
- Bun test: https://bun.com/docs/test. pytest: https://docs.pytest.org/en/stable/how-to/usage.html
