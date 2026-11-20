# Blacksmith runners

## Contents

- [What it is](#what-it-is)
- [Onboarding](#onboarding)
- [Labels and sizing](#labels-and-sizing)
- [Caches](#caches)
- [Docker builds](#docker-builds)
- [Sticky disks and checkout](#sticky-disks-and-checkout)
- [Observability](#observability)
- [Limits and trade-offs](#limits-and-trade-offs)
- [Cost](#cost)
- [Alternatives](#alternatives)

Read this file when a continuous integration (CI) workflow uses Blacksmith runners, or when the user asks about them. A runner vendor swap is a proposal with a measured gain. Make it only when the user asks. For one workflow that also runs on GitHub-hosted runners, read [runner-fallback.md](runner-fallback.md).

## What it is

Blacksmith runs each GitHub Actions job in an ephemeral micro virtual machine (microVM) on bare-metal servers. Each runner registers with GitHub as a just-in-time self-hosted runner, so GitHub rules for self-hosted runners apply. The Linux images match GitHub's `actions/runner-images`. The Windows image ships Visual Studio Build Tools, not the full Visual Studio application. Sources: https://docs.blacksmith.sh/blacksmith-runners/overview, https://docs.blacksmith.sh/blacksmith-administration/github-app

## Onboarding

1. Check that the repository belongs to a GitHub organization. Blacksmith does not support repositories in personal accounts.
2. Install the `blacksmith.sh` GitHub App from https://app.blacksmith.sh.
3. Warning: runners register at the organization level, and jobs from a repository without the app stay queued. Install the app on every repository that uses a `blacksmith-` label.
4. Change `runs-on` in each job. The Migration Wizard in the dashboard can do this: it opens a pull request that rewrites `runs-on`.
5. If the organization has a GitHub Internet Protocol (IP) allowlist, add the Blacksmith control-plane addresses from Settings > Features.
6. Warning: by default a pull request job can commit a sticky disk, which allows cache poisoning. Turn on Branch Protection (Settings) before you use sticky disks, the Docker builder, or the git mirror. Keep "Branch Protected Caches" on, so each cache entry stays scoped to its branch (https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks, https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions).
7. Warning: in a public repository, a fork pull request runs its own copy of the workflow file, so it can ask for a `blacksmith-` label. GitHub advises against self-hosted runners in public repositories (https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners). In a public repository, require approval for all external contributors in Settings > Actions > General (https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository). Keep both protections of step 6 on.

Read the app permissions page before you approve the vendor (https://docs.blacksmith.sh/blacksmith-administration/github-app). Running jobs needs only the organization permission for self-hosted runners and webhook events. The app also asks for write access: Actions (cancel and re-dispatch runs), Contents, Workflows, and Pull requests (Migration Wizard and [code]smith), and Checks ([code]smith). It asks for no secrets, variables, environments, or administration permission. Sources: https://docs.blacksmith.sh/introduction/quickstart, https://docs.blacksmith.sh/blacksmith-administration/network-allowlisting

## Labels and sizing

Label format: `blacksmith-<N>vcpu-<os>-<version>[-arm]`, where `<N>` is the virtual CPU (vCPU) count. Copy each full label from the runner overview (https://docs.blacksmith.sh/blacksmith-runners/overview). Do not invent a short label.

| Family | Label pattern | GitHub-hosted counterpart ([reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)) | Note |
|---|---|---|---|
| Linux x64 | `blacksmith-<N>vcpu-ubuntu-2404`, `blacksmith-<N>vcpu-ubuntu-2604` | `ubuntu-latest`, `ubuntu-24.04`, `ubuntu-26.04`. For more vCPUs, a larger runner with a custom label (Team or Enterprise plan) | Quickstart maps `ubuntu-latest` to `blacksmith-2vcpu-ubuntu-2404`, the same size in private repositories. Public repositories get a larger GitHub-hosted runner. Pin a release, because `ubuntu-latest` follows GitHub image rollouts. The largest sizes differ |
| Linux arm64 | `blacksmith-<N>vcpu-ubuntu-2404-arm`, `blacksmith-<N>vcpu-ubuntu-2604-arm` | `ubuntu-24.04-arm`, `ubuntu-26.04-arm` | Less memory per vCPU than x64 and than the GitHub-hosted runner. No nested virtualization |
| Ubuntu 22.04 | `blacksmith-<N>vcpu-ubuntu-2204`, `blacksmith-<N>vcpu-ubuntu-2204-arm` | `ubuntu-22.04` | Deprecated (verify: https://docs.blacksmith.sh/blacksmith-runners/overview). Move to 24.04 or 26.04 |
| Windows Server 2025 | `blacksmith-<N>vcpu-windows-2025` | `windows-latest`, `windows-2025` | Public beta (verify: https://docs.blacksmith.sh/blacksmith-runners/overview). No Linux containers and no full Visual Studio application |
| macOS on Apple silicon | `blacksmith-<N>vcpu-macos-<version>` | `macos-latest`, `macos-15`, `macos-26` | Quickstart maps `macos-latest` to `blacksmith-6vcpu-macos-latest`. The smallest Blacksmith size is larger, so compare cost per job |

- Read the processor and memory use of each job on the Metrics page before you pick a size (https://docs.blacksmith.sh/blacksmith-observability/metrics).
- Use the Rightsize page or `blacksmith jobs diagnose rightsize`. Both read recent use and open a pull request that changes sizes (https://docs.blacksmith.sh/blacksmith-runners/rightsizing, https://docs.blacksmith.sh/blacksmith-cli/jobs).
- Blacksmith can move a job to the next size at no charge when it has spare capacity ("free upgrades"). So the timing of one run is noisy. Compare the median job time over several runs ([measure.md](measure.md)).

## Caches

| Cache | On a Blacksmith runner | What to do |
|---|---|---|
| `actions/cache`, `actions/setup-node`, `actions/setup-go`, `actions/setup-python`, `actions/setup-java`, `ruby/setup-ruby` | Goes to the Blacksmith cache with no workflow change | Keep the upstream actions |
| Rust `sccache`, Docker `cache-from` and `cache-to` with `type=gha` | Still goes to the GitHub cache | For Docker, use the Blacksmith builder ([Docker builds](#docker-builds)) |
| `useblacksmith/cache`, `useblacksmith/setup-*`, `useblacksmith/rust-cache` | Archived: no updates and no security fixes (verify: the archive notice on https://github.com/useblacksmith/cache) | Replace each one with its upstream action. Do not copy them from Blacksmith docs examples |
| Go (`GOCACHEPROG`, Go 1.24 or later), Turborepo remote cache, Bazel remote cache | Server-side. An admin turns each one on in Settings > Caching | Remove the duplicate cache step after an admin turns it on |
| Docker images for pulls, `services:`, and `container:` jobs | On by default | Nothing |
| `astral-sh/setup-uv` with `enable-cache: auto` (the default) | Off, because the runner is not GitHub-hosted | Set `enable-cache: true` |

- The Turborepo cache is not reachable from `container:` jobs or from `turbo` inside `docker build`. An existing `TURBO_API` or `TURBO_TOKEN` setting wins.
- An explicit Bazel `--remote_cache` flag wins over the Blacksmith cache. The Blacksmith cache replaces remote caching, not remote execution.
- Blacksmith docs show older majors of `actions/cache` and `actions/setup-node`. For a newer major, run `gh cache list -R OWNER/REPO --key <key-prefix>` after one Blacksmith run. An entry from that run means the cache went to GitHub.
- Other actions can branch on `RUNNER_ENVIRONMENT` like `setup-uv`. Search the source of each third-party action for `RUNNER_ENVIRONMENT`. Print `echo "$RUNNER_ENVIRONMENT"` in one job to see the value.

Sources: https://docs.blacksmith.sh/blacksmith-caching/dependencies-actions, https://github.com/useblacksmith/cache, https://docs.blacksmith.sh/blacksmith-caching/go-build-caching, https://docs.blacksmith.sh/blacksmith-caching/turborepo-build-caching, https://docs.blacksmith.sh/blacksmith-caching/bazel-build-caching, https://docs.blacksmith.sh/blacksmith-caching/docker-container-caching, https://github.com/astral-sh/setup-uv/blob/main/src/utils/inputs.ts

## Docker builds

Replace the two Docker steps. Remove `cache-from` and `cache-to` (https://docs.blacksmith.sh/blacksmith-caching/docker-builds). Before you copy the snippet, read the highest release tag of each action: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

```yaml
- uses: useblacksmith/setup-docker-builder@v2   # replaces docker/setup-buildx-action
  with:
    cache-key: <image-name>                     # required in v2; use one key per unrelated image
- uses: useblacksmith/build-push-action@v2      # replaces docker/build-push-action
  with:
    push: true
    tags: <registry>/<image>:<tag>
```

- The builder keeps the whole BuildKit state on a sticky disk per `cache-key`. That state holds the layers and the `RUN --mount=type=cache` contents. All runners of the repository share it (https://github.com/useblacksmith/setup-docker-builder).
- Blacksmith commits the state only when the job succeeds. When two jobs commit, the last write wins.
- `useblacksmith/build-push-action` works only on Blacksmith runners (https://github.com/useblacksmith/build-push-action). For a workflow that must also run on GitHub-hosted runners, read [runner-fallback.md](runner-fallback.md).
- The quickstart shows `setup-docker-builder@v1` without `cache-key`. Use v2 with `cache-key`. `build-push-action@v1` is deprecated (verify: https://docs.blacksmith.sh/blacksmith-caching/docker-builds).
- Order Dockerfile layers from least changed to most changed. Use cache mounts for package-manager caches. Prefer `push: true` to `load: true`.
- For a multi-platform image, build each platform in a matrix on native x64 and arm64 runners. Then join the images with `docker manifest`.

## Sticky disks and checkout

`useblacksmith/stickydisk` (beta; verify: https://github.com/useblacksmith/stickydisk) mounts a disk snapshot per `key` at `path`. It commits the snapshot after the job. Sources: https://github.com/useblacksmith/stickydisk, https://docs.blacksmith.sh/blacksmith-caching/dependencies-sticky-disks

- Each job gets its own clone of the disk. Two jobs never share a live disk.
- The docs and the README state different per-job disk limits. Plan for the lower limit.
- With Branch Protection on ([Onboarding](#onboarding) step 6), only default-branch `push`, `schedule`, and `workflow_dispatch` jobs commit a disk. Other jobs use the disk, and Blacksmith discards their changes. Branch Protection also covers Docker builder disks and git mirrors.
- In a `container:` job, a sticky disk needs `--privileged`, the Blacksmith environment variables, and `sudo`.
- Delete a disk with `useblacksmith/stickydisk-delete`, the dashboard, or `blacksmith stickydisk`.
- Idle disks expire. Storage is billed. Read the rate on https://www.blacksmith.sh/pricing. Read the use with `blacksmith usage storage`.

`useblacksmith/checkout` (beta; verify: https://github.com/useblacksmith/checkout) is a fork of `actions/checkout`. It keeps a bare mirror of the repository on a sticky disk. It falls back to a normal clone on any failure. It forks an older upstream line, so compare its inputs with `actions/checkout` before the swap. A small shallow clone can gain nothing. The Colocated Git proxy (Settings > Caching) needs no workflow change. Sources: https://github.com/useblacksmith/checkout, https://docs.blacksmith.sh/blacksmith-caching/git-checkout-caching

## Observability

| Feature | What it gives | Source |
|---|---|---|
| Run History | Logs, metrics, and run comparison for jobs on Blacksmith runners only | https://docs.blacksmith.sh/blacksmith-observability/history |
| Log search | Organization-wide search with filters such as `branch:` and `step_name:` | https://docs.blacksmith.sh/blacksmith-observability/logs |
| Metrics | Processor, memory, and network use per job, plus a step timeline | https://docs.blacksmith.sh/blacksmith-observability/metrics |
| Test Analytics | Reads JUnit XML reports from the job. It can comment failures on the pull request | https://docs.blacksmith.sh/blacksmith-observability/test-analytics |
| Monitors | Slack alerts on job result, duration, or log patterns | https://docs.blacksmith.sh/blacksmith-observability/monitors |
| Secure Shell (SSH) | An admin turns it on. Only the user who triggered the job can connect, with their GitHub SSH keys | https://docs.blacksmith.sh/blacksmith-observability/ssh-access |
| `blacksmith` command-line interface (CLI) | `jobs`, `logs`, `cache`, `stickydisk`, and `usage`. An organization token serves bots. In CI, set `BLACKSMITH_DISABLE_AUTO_UPDATE=1` | https://docs.blacksmith.sh/blacksmith-cli/overview |

- The SSH port appears in the "Setup runner" step. Access ends a short time after the job ends. Warning: a held machine keeps the job secrets. To hold a failed machine, add a last step on a debug branch only: `- { if: failure(), run: sleep 900, timeout-minutes: 16 }`. Remove the step after use.

## Limits and trade-offs

| Topic | Fact | Source |
|---|---|---|
| Concurrency | The docs state no concurrency limit. For very large bursts, confirm the limit with Blacksmith | https://docs.blacksmith.sh/blacksmith-runners/concurrency |
| Regions | Regions in the United States and Europe. A region move goes through support | https://docs.blacksmith.sh/blacksmith-runners/overview |
| Isolation | Each Linux or Windows job runs in its own Firecracker microVM. The runner token is valid for one job | https://www.blacksmith.sh/security |
| Nested virtualization | Kernel-based Virtual Machine (KVM) works on x64 Linux only, not on arm64 | https://docs.blacksmith.sh/blacksmith-runners/overview |
| Windows | No Linux containers. Only process-isolated Windows Server containers | https://docs.blacksmith.sh/blacksmith-runners/overview |
| Docker Hub | Self-hosted runner rules apply, so Docker Hub rate limits apply. Log in to Docker Hub or use a registry mirror | https://docs.github.com/en/actions/reference/limits |
| Spend | No hard spend cap. Spending Alerts send an email at a monthly threshold and do not stop jobs | https://docs.blacksmith.sh/introduction/settings |
| Accounts | Repositories in personal accounts are not supported | https://docs.blacksmith.sh/introduction/quickstart |
| Trust | A third party runs your code and receives the job's secrets. Review the security page and the trust center first | https://www.blacksmith.sh/security, https://trust.oneleet.com/blacksmith-sh |

## Cost

- Read the rates on https://www.blacksmith.sh/pricing and https://docs.github.com/en/billing/reference/actions-runner-pricing.
- Compare cost per job, not rate alone, and do not trust a headline savings claim. Cost per job is the rate times the job minutes that you measure on each runner. A larger size has a higher rate, so it saves money only when it cuts the minutes by a larger factor.
- Check the GitHub billing page for free cases, for example standard runners in public repositories. Check it also for a charge on self-hosted runner minutes, because GitHub counts Blacksmith jobs as self-hosted: https://docs.github.com/en/billing/concepts/product-billing/github-actions
- Read Blacksmith minutes and estimated cost with `blacksmith usage --since 30d`: https://docs.blacksmith.sh/blacksmith-cli/usage

## Alternatives

| Option | URL | Note |
|---|---|---|
| GitHub larger runners | https://docs.github.com/en/actions/concepts/runners/larger-runners | Team or Enterprise plan only. Billed for public repositories too |
| Depot | https://depot.dev/docs/github-actions/overview | Ephemeral single-tenant runners |
| Namespace | https://namespace.so/docs/solutions/github-actions | Linux, Windows, and macOS runners |
| Ubicloud | https://www.ubicloud.com/docs/github-actions-integration/quickstart | Open source. x64 and arm64 Linux |
| RunsOn | https://runs-on.com/ | Runs in your own Amazon Web Services (AWS) account |
| WarpBuild | https://www.warpbuild.com/docs/ci/what-is-warpbuild | Hosted, or in your own cloud account |
| actions-runner-controller | https://docs.github.com/en/actions/concepts/runners/actions-runner-controller | Kubernetes operator. You own capacity, images, and security |

BuildJet is not an alternative: it shut down (https://buildjet.com/for-github-actions/blog/we-are-shutting-down).
