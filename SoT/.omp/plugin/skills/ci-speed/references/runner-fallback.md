# One workflow for Blacksmith and GitHub-hosted runners

## Contents

- [Facts that shape the design](#facts-that-shape-the-design)
- [Pattern 1: one variable per runner class](#pattern-1-one-variable-per-runner-class)
- [Pattern 2: picker job](#pattern-2-picker-job)
- [Pattern 3: scheduled guard](#pattern-3-scheduled-guard)
- [Portable steps](#portable-steps)
- [Proof](#proof)

Read this file when a Blacksmith workflow must still run on GitHub-hosted runners without the Blacksmith budget, account, or service. Pattern 1 is required. Patterns 2 and 3 are optional. Blacksmith facts and the label pairs of both vendors are in [blacksmith.md](blacksmith.md#labels-and-sizing). Before you copy a snippet, read the highest release tag of each action: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

## Facts that shape the design

| Fact | Effect on the design | Source |
|---|---|---|
| GitHub has no runner fallback. A `runs-on` label list means AND, not OR | `[blacksmith-<…>, ubuntu-latest]` is not a fallback: one runner must carry both labels | https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax |
| A job with no matching runner waits, up to 24 hours for self-hosted runners. For `timeout-minutes`, the docs bound run time only | A missing backend shows queued jobs, not failed jobs | https://docs.github.com/en/actions/reference/runners/self-hosted-runners |
| Blacksmith has no hard spend cap. It can suspend an account that is behind on payment | A budget stop looks like stuck queued jobs, not red jobs | https://docs.blacksmith.sh/introduction/settings, https://docs.blacksmith.sh/about/terms-of-service |
| `runs-on` accepts only the `github`, `needs`, `strategy`, `matrix`, `vars`, and `inputs` contexts | `secrets`, `env`, `runner`, and `steps` cannot choose the runner | https://docs.github.com/en/actions/reference/workflows-and-actions/contexts |
| Configuration variables are empty in fork pull request runs. Dependabot runs get them. An empty `runs-on` fails | Every `runs-on` expression needs a literal fallback | https://github.com/orgs/community/discussions/44322, https://github.com/orgs/community/discussions/44088 |

## Pattern 1: one variable per runner class

Required. Give each runner class one configuration variable. Put a GitHub-hosted literal after `||` in each `runs-on`.

```yaml
jobs:
  test:
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}    # the literal serves fork pull requests and the fallback
    timeout-minutes: 30
  e2e:
    runs-on: ${{ vars.CI_RUNNER_LINUX_LARGE || '<github-large-label>' }}
    timeout-minutes: 45
```

Switch a class with `gh`, the GitHub command-line interface (CLI), in a clone. Outside a clone, add `-R OWNER/REPO` (https://cli.github.com/manual/gh_variable_set). A repository variable overrides an organization variable of the same name. Environment-level variables cannot choose the runner (https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

```bash
gh variable set CI_RUNNER_LINUX --body blacksmith-4vcpu-ubuntu-2404   # this repository to Blacksmith
gh variable delete CI_RUNNER_LINUX                                     # back to the organization value or the literal
gh variable set CI_RUNNER_LINUX --org <org> --repos <repo-a>,<repo-b> --body blacksmith-4vcpu-ubuntu-2404  # only repositories with the Blacksmith app
```
- GitHub larger runners need a Team or Enterprise plan and a custom label that you create. Without them, use `ubuntu-latest` as the literal (https://docs.github.com/en/actions/concepts/runners/larger-runners).
- Keep gate jobs on `ubuntu-slim` in both modes when they fit its limits (https://docs.github.com/en/actions/reference/runners/github-hosted-runners). It has no Blacksmith twin. It is a small unprivileged container with no Docker and a short job time cap.

## Pattern 2: picker job

Optional. A picker job on `ubuntu-slim` writes the label to a job output. It holds no secret: it reads only `CI_FORCE_GITHUB` and the Blacksmith status page. Later jobs set `needs: pick` and `runs-on: ${{ needs.pick.outputs.linux }}`. Cost: one more job on the critical path of every run.

```yaml
jobs:
  pick:
    runs-on: ubuntu-slim                                  # GitHub-hosted, so it runs when Blacksmith does not
    timeout-minutes: 5
    outputs: { linux: '${{ steps.pick.outputs.linux }}' }
    steps:
      - id: pick
        env: { FORCE: '${{ vars.CI_FORCE_GITHUB }}', IS_FORK: '${{ github.event.pull_request.head.repo.fork }}' }
        run: |
          use() { echo "linux=$1" >> "$GITHUB_OUTPUT"; exit 0; }
          # Fork code never runs on the Blacksmith bill; Pattern 1 sends forks to the literal too
          [ "$IS_FORK" != true ] || use ubuntu-latest
          [ "$FORCE" != 1 ] || use ubuntu-latest
          status=$(curl -fsS -m 5 https://status.blacksmith.sh/summary.json | jq -r .page.status) || status=error
          [ "$status" = UP ] || use ubuntu-latest
          use blacksmith-4vcpu-ubuntu-2404
```
- `CI_FORCE_GITHUB=1` forces GitHub-hosted runners. `page.status` is `UP` when the status page reports no problem. Any other value or a failed probe falls back (https://status.blacksmith.sh, https://instatus.com/help/api/public-data).
- Warning: when `pick` fails, the jobs that need it are skipped, and a skipped job reports success to a required check (https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions). Add `pick` to the `needs` of the aggregate required job ([affected-and-hooks.md](affected-and-hooks.md#prove-the-skip-logic)).

## Pattern 3: scheduled guard

Optional. Use Pattern 3 only in a repository that can use environments, because the guard keeps its secrets in an environment. Public repositories have environments on every plan. Private repositories need GitHub Pro, Team, or Enterprise (https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments, https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets). Without environments, set a Spending Alerts threshold in Blacksmith (https://docs.blacksmith.sh/introduction/settings). When its email arrives, switch the variables with the Pattern 1 commands.

A scheduled workflow on a GitHub-hosted runner checks two things: the month-to-date Blacksmith cost against `CI_BLACKSMITH_BUDGET`, and jobs that wait too long for a `blacksmith-` label. Set `CI_BLACKSMITH_BUDGET` to a plain-number copy of the Spending Alerts threshold, because the `blacksmith` CLI cannot read the threshold. On either finding, the guard sets `CI_FORCE_GITHUB=1` for Pattern 2 and switches the label variables of Pattern 1 to GitHub-hosted labels. Then it cancels and re-runs the stuck runs. A re-run serves the required checks of a pull request, and a `workflow_dispatch` run does not (https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

- Warning: a Blacksmith organization token can manage the cache entries and sticky disks of every installed repository (https://docs.blacksmith.sh/blacksmith-cli/overview). So store it only as the secret `BLACKSMITH_ORG_TOKEN` of an environment that only the default branch can deploy to. Add no required reviewers, because a reviewer blocks each scheduled run (https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments). Pull request runs never receive the token. An admin creates it with `blacksmith org-token create`.
- `GITHUB_TOKEN` cannot write variables (https://docs.github.com/en/rest/actions/variables). Create a GitHub App with the repository permission Variables (read and write). Install it on the repository. Put its client ID in the variable `CI_GUARD_APP_CLIENT_ID` and its private key in the environment secret `CI_GUARD_APP_KEY`. The job mints a token each run, because installation tokens expire after 1 hour (https://github.com/actions/create-github-app-token).

```yaml
on:
  schedule: [{ cron: '3-59/10 * * * *' }]                 # off minute 0, when GitHub delays scheduled runs most
  workflow_dispatch: { inputs: { dry_run: { type: boolean, default: true } } }   # prints the decision and switches nothing
permissions: { actions: write }                           # list, cancel, and re-run workflow runs
concurrency: runner-guard
jobs:
  guard:
    runs-on: ubuntu-slim                                  # never a variable: it must run when Blacksmith does not
    timeout-minutes: 15
    environment: { name: runner-guard, deployment: false }   # default branch only; no deployment record per run
    env: { GH_TOKEN: '${{ github.token }}', GH_REPO: '${{ github.repository }}' }
    steps:
      - continue-on-error: true                           # a failed or hung install, for example in a Blacksmith outage, must not stop the guard
        timeout-minutes: 3                                # a stalled download ends here, and the decide step then counts the cost as unknown
        run: curl -fsSL --max-time 60 https://get.blacksmith.sh | BLACKSMITH_INSTALL_DIR="$RUNNER_TEMP/bin" sh && echo "$RUNNER_TEMP/bin" >> "$GITHUB_PATH"   # no secret in this step
      - id: decide
        env: { BLACKSMITH_TOKEN: '${{ secrets.BLACKSMITH_ORG_TOKEN }}', BLACKSMITH_DISABLE_AUTO_UPDATE: '1', BUDGET: '${{ vars.CI_BLACKSMITH_BUDGET }}' }
        run: |
          cost=$(command -v blacksmith > /dev/null && printf '%s\n' "$BLACKSMITH_TOKEN" | blacksmith auth login --api-token - --non-interactive --organization <org> > /dev/null &&
            blacksmith usage --start-time "$(date -u +%Y-%m-01T00:00:00Z)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | jq -r '<cost-path>') || cost=invalid
          num='^[0-9]+([.][0-9]+)?$'; over=true            # no CLI, a failed login, or an invalid number counts as over budget
          if [[ $cost =~ $num && $BUDGET =~ $num ]] && awk -v c="$cost" -v b="$BUDGET" 'BEGIN { exit !(c+0 < b+0) }'; then over=false; fi
          for s in queued in_progress; do gh api --paginate "repos/$GH_REPO/actions/runs?status=$s&per_page=100" --jq '.workflow_runs[].id'; done > runs.txt
          while read -r id; do                            # runs with a job that waits over 900 s for a blacksmith- label
            gh api --paginate "repos/$GH_REPO/actions/runs/$id/jobs?per_page=100" \
              --jq "if any(.jobs[]; .status == \"queued\" and any(.labels[]; startswith(\"blacksmith-\")) and now - (.created_at | fromdate) > 900) then $id else empty end"
          done < runs.txt > hits.txt; sort -u hits.txt > stuck.txt
          switch=false; if [ "$over" = true ] || [ -s stuck.txt ]; then switch=true; fi
          echo "cost=$cost budget=$BUDGET over=$over stuck_runs=$(wc -l < stuck.txt) switch=$switch"; echo "switch=$switch" >> "$GITHUB_OUTPUT"
      - id: app
        if: steps.decide.outputs.switch == 'true' && !inputs.dry_run
        uses: actions/create-github-app-token@v3
        with: { client-id: '${{ vars.CI_GUARD_APP_CLIENT_ID }}', private-key: '${{ secrets.CI_GUARD_APP_KEY }}' }
      - if: steps.app.outcome == 'success'
        env: { VARS_TOKEN: '${{ steps.app.outputs.token }}' }
        run: |
          # Switch every variable before any cancel. A failed switch ends the step before the cancels.
          GH_TOKEN="$VARS_TOKEN" gh variable set CI_FORCE_GITHUB --body 1
          GH_TOKEN="$VARS_TOKEN" gh variable set CI_RUNNER_LINUX --body ubuntu-latest
          GH_TOKEN="$VARS_TOKEN" gh variable set CI_RUNNER_LINUX_LARGE --body '<github-large-label>'
          while read -r id; do gh run cancel "$id"; done < stuck.txt
          while read -r id; do gh run watch "$id" > /dev/null; gh run rerun "$id"; done < stuck.txt   # a run must stop before it can re-run
```
- The usage output schema is not documented. Run `blacksmith usage --since 30d` once. Copy the path of the estimated cost into `<cost-path>` (https://docs.blacksmith.sh/blacksmith-cli/usage). Then check that `blacksmith usage --since 30d | jq -r '<cost-path>'` prints a number. After a switch, check the runner label of each re-run with the command in [Proof](#proof). If a re-run still asks for a `blacksmith-` label, push a new commit.
- The guard never switches back. When Blacksmith works again and the budget allows, run `gh variable delete CI_FORCE_GITHUB`, then delete the label variables or set them back to the Blacksmith labels. The schedule starts 144 runs per day. In private repositories, GitHub bills each job at least one minute (https://docs.github.com/en/billing/reference/actions-runner-pricing). Scheduled runs can start late or drop at high load. GitHub disables a schedule in a public repository after 60 days without repository activity (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Portable steps

| Feature | On Blacksmith | On GitHub-hosted | Portable choice |
|---|---|---|---|
| `actions/cache`, `actions/setup-*` caches | Blacksmith cache ([docs](https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions)) | GitHub cache | Keep the upstream actions. The backends do not share entries, so the first run after each switch is cold |
| Docker `cache-from`/`cache-to` `type=gha` | GitHub cache (same docs) | GitHub cache | Works on both. Set `scope=<image>` on both keys ([docs](https://docs.docker.com/build/cache/backends/gha/)). Write `cache-to` only in default-branch `push` jobs |
| `useblacksmith/build-push-action` | Works | Not supported: it works only on Blacksmith runners ([README](https://github.com/useblacksmith/build-push-action)) | Gate it with `if: startsWith(vars.CI_RUNNER_LINUX, 'blacksmith-')`. Add a `docker/build-push-action` twin with `if: ${{ !startsWith(vars.CI_RUNNER_LINUX, 'blacksmith-') }}`: a leading `!` needs `${{ }}`. With Pattern 2, test `needs.pick.outputs.linux` |
| `useblacksmith/setup-docker-builder` | Sticky-disk builder | Falls back to a local builder unless `nofallback: true` ([README](https://github.com/useblacksmith/setup-docker-builder)) | Gate it the same way. Add a `docker/setup-buildx-action` twin, so `type=gha` gets a builder that exports cache |
| `useblacksmith/stickydisk` | Persistent disk | Plain directory that does not persist ([source](https://github.com/useblacksmith/stickydisk/blob/main/src/main.ts)) | Gate it. Use `actions/cache` on GitHub-hosted runners |
| `astral-sh/setup-uv` | `enable-cache: auto` is off ([source](https://github.com/astral-sh/setup-uv/blob/main/src/utils/inputs.ts)) | `enable-cache: auto` is on | Set `enable-cache: true` |
| Go, Turborepo, Bazel server-side caches | Transparent ([blacksmith.md](blacksmith.md#caches)) | Absent | Keep a cache step for GitHub-hosted runners |
| Docker Hub pulls | Rate limits apply ([limits](https://docs.github.com/en/actions/reference/limits)) | Public pulls are not limited | Log in to Docker Hub or use a registry mirror |
| Matrix width | No documented concurrency limit ([docs](https://docs.blacksmith.sh/blacksmith-runners/concurrency)) | Plan concurrency limit ([limits](https://docs.github.com/en/actions/reference/limits)) | Set `max-parallel` to a value that the GitHub plan allows |
| Tool worker counts | Blacksmith runner size | GitHub-hosted runner size | `tsc --checkers` takes one fixed value everywhere, because different values can rarely change results ([js-toolchain.md](js-toolchain.md)). Other tools detect cores |
| Run History, Test Analytics, Monitors, Secure Shell (SSH) access | Available ([blacksmith.md](blacksmith.md#observability)) | Absent | Do not let them decide a required check |

## Proof

1. Pattern 1: run `gh variable set CI_RUNNER_LINUX --body blacksmith-4vcpu-ubuntu-2404`. Push a commit. Then run `gh variable delete CI_RUNNER_LINUX` and push again.
2. Pattern 2: run `gh variable set CI_FORCE_GITHUB --body 1`. Push a commit. Then run `gh variable delete CI_FORCE_GITHUB` and push again.
3. For each run, print the label and the runner of every job: `gh api "repos/OWNER/REPO/actions/runs/<run-id>/jobs" --jq '.jobs[] | [.name, (.labels | join(",")), .runner_name] | @tsv'`. Check each label against the mode. The "Set up job" log also names the runner.
4. Pattern 3: run `gh workflow run <guard-file>.yml -f dry_run=true`. Read the `over=` and `switch=` lines with `gh run view <run-id> --log`. Check with `gh variable list` that no variable changed.
