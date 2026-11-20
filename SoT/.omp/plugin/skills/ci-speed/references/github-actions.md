# GitHub Actions levers

## Contents

- [Triggers and concurrency](#triggers-and-concurrency)
- [Path filters and required checks](#path-filters-and-required-checks)
- [Job graph](#job-graph)
- [Checkout](#checkout)
- [Caching](#caching)
- [Artifacts and timeouts](#artifacts-and-timeouts)
- [Runner classes and merge queue](#runner-classes-and-merge-queue)

Snippets pin action majors. The release marked Latest can be an older major. So read the highest release tag of each action before you copy a snippet: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

## Triggers and concurrency

- If `push` has no branch filter, each push to a pull request branch also starts a `pull_request` run. Limit `push` to the default branch ([events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
- If you skip draft pull requests, add `ready_for_review` to `pull_request.types`. Otherwise the ready pull request gets no run.
- Bot and `schedule` runs use the same minutes. Find them in the usage metrics before you cut other work.

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}
  cancel-in-progress: true # stale pull request runs stop; default-branch runs never share a group
```

- Warning: in one group, GitHub replaces an older pending run with the newer one, even with `cancel-in-progress: false`. So never put default-branch runs in a shared group.
- Pull request events carry `github.event.pull_request.number`, so each pull request gets one group. This also holds for a `closed` event of a merged pull request, whose `github.ref` is the target branch ([`pull_request`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)). Every other run gets its own group through `github.run_id`. Never key the group on the source branch name (`github.head_ref`): two fork pull requests from branches with the same name then cancel each other.
- Keep `github.workflow` in the group. Without it, two workflows cancel each other. A group can use only the `github`, `inputs`, and `vars` contexts ([concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#concurrency)).

## Path filters and required checks

| Skip type | Required check result |
|---|---|
| Workflow skipped by `paths`, `branches`, or a commit-message filter | "Pending". The pull request cannot merge. |
| Job skipped by `if:` | "Success" |
| Job skipped because a needed job failed | It may not block the merge |

- Do not put `paths` on a workflow that holds a required check ([skipped but required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#handling-skipped-but-required-checks)). Path filters also do not apply to tag pushes or to `merge_group`.
- Before you add a filter, replay it on recent pull requests: `gh api --paginate "repos/OWNER/REPO/pulls/<N>/files" -q '.[].filename'`.
- If the filter matches almost every pull request, drop it. Lockfile and version bumps touch every package.
- Use a changes job and one aggregate job. The changes job runs [`dorny/paths-filter`](https://github.com/dorny/paths-filter), or a script with `git diff --name-only <base-sha>...HEAD` after a checkout with history. `dorny/paths-filter` needs a checkout only for `push` and `merge_group`.

```yaml
jobs:
  changes:
    runs-on: ubuntu-slim
    timeout-minutes: 5
    permissions: { contents: read, pull-requests: read }
    outputs: { app: "${{ steps.filter.outputs.app }}" }
    steps:
      - if: github.event_name != 'pull_request' # push and merge_group runs: paths-filter runs git fetch, so keep the credentials
        uses: actions/checkout@v7
      - id: filter
        uses: dorny/paths-filter@v4
        with:
          filters: |
            app:
              - 'src/**'
              - '<lockfile>'
  ci-ok: # the only required check, so list every gating job in needs
    needs: [changes, lint, test]
    if: always() # a skipped job passes; a failed or cancelled job fails the check
    runs-on: ubuntu-slim
    timeout-minutes: 5
    steps:
      - if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')
        run: exit 1
```

Heavy jobs use `needs: changes` and `if: needs.changes.outputs.app == 'true'`. If you rename a required check, update the ruleset in the same change.

## Job graph

- Wall time equals the critical path: the longest `needs:` chain. Independent jobs run in parallel up to the plan concurrency limit.
- Each job pays queue, runner start, checkout, and install again. Move work that gates nothing (reports, coverage uploads) off the critical path.
- Merge tiny jobs that are mostly setup. This cuts billed minutes, because each job rounds up to a whole minute. It can raise wall time.
- In-job parallel steps (`background: true`, `wait`, `wait-all`, `cancel`, `parallel:` groups) run several checks in one job with one setup.
- At most 10 background steps run at the same time in one job; more wait in a queue. Composite actions cannot contain them, and their outputs appear only after `wait` ([parallel steps](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsparallel)).
- Run Windows and macOS legs only for code that depends on the platform. Their per-minute rates are higher ([pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)).

## Checkout

| The job needs | Setting ([`actions/checkout`](https://github.com/actions/checkout)) |
|---|---|
| Files at the tip commit | The default `fetch-depth: 1` |
| History for a merge base (affected runs, changelogs) | `fetch-depth: 0` with `filter: blob:none`, or `filter: tree:0` for diff-only jobs |
| A few directories (gate jobs) | `sparse-checkout: <patterns>` |
| No files (aggregate, label, or API-only jobs) | No checkout step |

- `filter` does not change `fetch-depth`. With the default depth, `filter: blob:none` is still a shallow clone. `filter` overrides `sparse-checkout`.
- In a blobless clone, `git log -- <path>` uses the local commits and trees, but `git blame` and patch output (`git log -p`) fetch file contents over the network. Treeless clones work poorly with submodules ([partial clones](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/)).
- If no later step runs git against the remote, set `persist-credentials: false`. Pair it with `permissions: { contents: read }` at the workflow level.
- Keep the default credentials when a later step fetches. A partial clone (`filter`) fetches missing objects on demand. `dorny/paths-filter` runs `git fetch` on `push` and `merge_group`. Affected-only tools fetch history.
- `lfs` is off by default. Turn it on only in jobs that read the large files.

## Caching

- A run restores caches from its own branch and the default branch. A `pull_request` run also restores from its base branch ([dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).
- A `pull_request` run saves its cache to `refs/pull/<N>/merge`. Only re-runs of the same pull request restore it. So seed caches from `push` on the default branch, and only restore on pull requests.
- Only `push`, `workflow_dispatch`, `repository_dispatch`, `delete`, `registry_package`, `page_build`, and `schedule` write default-branch caches. Other triggers, such as `pull_request_target`, get read-only access. A denied save logs a warning and does not fail.
- The `cache-mode:` key (workflow or job level) takes `read`, `write`, `write-only`, or `none`. The job value wins.
- Warning: `cache-mode: write` on a low-trust trigger brings back the cache-poisoning risk. Do not set it there.

```yaml
- id: deps
  uses: actions/cache/restore@v6
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
    restore-keys: bun-${{ runner.os }}-
- run: bun ci
- if: github.event_name == 'push' && steps.deps.outputs.cache-hit != 'true' # only default-branch pushes write
  uses: actions/cache/save@v6
  with: { path: ~/.bun/install/cache, key: "${{ steps.deps.outputs.cache-primary-key }}" }
```

| Setup action | Cache input | On by default | What it caches |
|---|---|---|---|
| [`actions/setup-node`](https://github.com/actions/setup-node) | `cache: npm`, `yarn`, or `pnpm` | Only npm, when `packageManager` or `devEngines.packageManager` names npm | The package store, not `node_modules` |
| [`actions/setup-python`](https://github.com/actions/setup-python) | `cache: pip`, `pipenv`, or `poetry` | No | The pip cache or the virtual environments |
| [`actions/setup-go`](https://github.com/actions/setup-go) | `cache` | Yes | Modules and build outputs. The key uses `go.mod`; set `cache-dependency-path: go.sum` to use the sum file. |
| [`oven-sh/setup-bun`](https://github.com/oven-sh/setup-bun) | `no-cache` | Yes | Only the Bun executable. Cache `~/.bun/install/cache` with `actions/cache`. |

- Key on the lockfile and `runner.os`. Add the architecture or tool version when they change the content.
- Never key on `github.sha`, a timestamp, or a build output. Each run then misses, and the new entries evict useful ones.
- Entries are immutable, so change the key to change the content. `cache-hit` is `'true'` only on an exact key match.
- `lookup-only: true` checks for an entry without a download. A gate job can use it to skip an install ([`actions/cache`](https://github.com/actions/cache)).
- Do not cache `node_modules` with `npm ci` ([examples](https://github.com/actions/cache/blob/main/examples.md)). Cache the package store, or measure a filtered install. Never cache secrets.
- The default limit is 10 GB per repository. Entries unused for 7 days are deleted. Over the limit, the entries with the oldest last access go first ([eviction policy](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy)).
- Docker layers: set `cache-from: type=gha,scope=<image>` and `cache-to: type=gha,mode=max,scope=<image>`. Use the same scope on both. One scope per image stops images from overwriting each other ([gha cache](https://docs.docker.com/build/cache/backends/gha/)).

## Artifacts and timeouts

- Upload only the files that the next job reads. Each upload and download adds zip, network, and unzip time. If a large artifact only passes between two jobs, merge the two jobs ([`upload-artifact`](https://github.com/actions/upload-artifact)).
- Set `compression-level: 0` for data that is already compressed (the default level is 6). Set a short `retention-days` for files that only pass between jobs (the default is 90 days).
- Set `timeout-minutes` on every job, a little above the measured p90. The default is 360 minutes. Do not rely on it to limit queue time ([timeouts](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idtimeout-minutes)).
- On `ubuntu-slim`, set `timeout-minutes` to 15 or less. GitHub terminates longer jobs.

## Runner classes and merge queue

- Standard runner specs differ for public and private repositories. Read the [spec table](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) before you set worker counts.
- `ubuntu-slim` is 1 virtual CPU in an unprivileged container: no Docker-in-Docker, and a 15-minute job limit. Use it for gate jobs.
- Standard arm64 Linux labels, such as `ubuntu-24.04-arm`, exist for public and private repositories. Compare their rates on the pricing page.
- [Larger runners](https://docs.github.com/en/actions/reference/runners/larger-runners) need a Team or Enterprise Cloud plan, and GitHub bills them in public repositories too. Their pools are smaller than standard pools, so a job can wait for a new virtual machine.
- `ubuntu-latest` moves to newer Ubuntu releases over time. If the image matters, pin a label such as `ubuntu-24.04`.
- Add `merge_group:` next to `pull_request`. Without it, required checks never report and the merge fails ([`merge_group`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group)).
- In private repositories, a merge queue needs GitHub Enterprise Cloud ([merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).
- Drop a slow suite from `push` on the default branch only when a merge queue or the up-to-date rule runs it first.
