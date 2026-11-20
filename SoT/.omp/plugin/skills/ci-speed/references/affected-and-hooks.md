# Affected-only runs and pre-push hooks

Use this file to run only the work that a change affects, and to give fast feedback before a push. Continuous integration (CI) stays the gate in both cases.

## Contents

- [Fetch a merge base](#fetch-a-merge-base)
- [Nx](#nx)
- [Turborepo](#turborepo)
- [pnpm filters](#pnpm-filters)
- [Changed-file test modes](#changed-file-test-modes)
- [Prove the skip logic](#prove-the-skip-logic)
- [Pre-push hooks](#pre-push-hooks)
- [Sources](#sources)

## Fetch a merge base

Affected-only tools compare the change with a base commit. The default `actions/checkout` depth of 1 has no merge base.

- Fetch full history cheaply: `fetch-depth: 0` with `filter: blob:none`, or `filter: tree:0` (the Nx docs use it).
- Do not use `--depth=0`. Some Turborepo docs show it, but git rejects it: "depth 0 is not a positive number".
- As an alternative, fetch the base branch explicitly.
- Verify each action major before you copy the snippet: `git ls-remote --tags --refs https://github.com/<owner>/<repo> | sed 's|.*/||' | grep -E '^v[0-9]+(\.[0-9]+)*$' | sort -V | tail -1`.

| Tool | Result without a merge base |
|---|---|
| Nx | No base commit to compare against |
| Turborepo | All packages count as changed: safe, but slow |
| pnpm | Compares against `<since>` directly: the selection is wrong |

```yaml
  affected:
    runs-on: ${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}
    timeout-minutes: 30
    permissions: { contents: read, actions: read } # nx-set-shas reads past runs; merge queues also need pull-requests: read
    steps:
      - uses: actions/checkout@v7 # keep the credentials: the partial clone fetches file contents on demand
        with:
          fetch-depth: 0        # affected tools need the merge base
          filter: blob:none     # commits and trees only; file contents load on demand
      - uses: nrwl/nx-set-shas@v5   # Nx only: sets NX_BASE and NX_HEAD
      - run: pnpm exec nx affected -t lint test build
```

## Nx

- Run `nx affected -t <targets> --base=<ref> --head=<ref>`, or set `NX_BASE` and `NX_HEAD`.
- In CI, run `nrwl/nx-set-shas` first. It sets both variables. On `pull_request`, the base is the commit that the pull request started from. On a push to the main branch, the base is the last successful commit.
- Nx 24 selects by task inputs by default. `affected.legacy` keeps the selection by project.
- A lockfile change affects all projects unless `projectsAffectedByDependencyUpdates` is `"auto"`.
- Add `--explain` to see why Nx selected each task. Nx prints the reasons and runs nothing.
- `nx show projects --affected -t <target>` lists the selection without a run.

## Turborepo

- Run `turbo run lint test build --affected`. It equals `--filter=...[main...HEAD]`.
- Set `TURBO_SCM_BASE` and `TURBO_SCM_HEAD` to change the comparison. If every run selects all packages, check the clone depth first.
- Turborepo selects by package by default. `futureFlags.affectedUsingTaskInputs` narrows it to task inputs.
- `--dry=json` prints the selection without a run.

## pnpm filters

- `pnpm --filter "...[origin/main]" test` selects the changed packages and their dependents.
- Since pnpm 12.7, `[<since>]` compares against the merge base. It needs Git 2.24 or later.
- A version change in a catalog in `pnpm-workspace.yaml` marks the package as changed.
- `--fail-if-no-match` fails when the filter matches no package. Add it where an empty selection is a bug, such as a canary.
- `pnpm ls -r --depth -1 --filter "...[<base>]"` lists the selection without a run.

## Changed-file test modes

`vitest --changed`, `bun test --changed`, Jest `--changedSince`, and Playwright `--only-changed` give fast local feedback. Do not use them for a required check. They can miss a change that no test imports, such as a configuration or data file.

## Prove the skip logic

A skip that hides a real change gives a false green. Test the selector like other code.

- Warning: a job that `if:` skips reports "Success" to a required check. Never make a skippable job the required check.
- Make one aggregator job the required check. Run it with `always()`. Fail it when a selected suite did not pass.
- Fail closed: when the selector job fails, fail the aggregator.
- Run the full suite on each push to the default branch, or on a schedule. It catches what the selector missed.

```yaml
  ci-ok:                                   # the only required check
    if: ${{ always() }}                    # runs when a needed job failed or was skipped
    needs: [changes, server-tests]
    runs-on: ubuntu-slim                   # a gate job must run when the runner vendor is down
    timeout-minutes: 5
    steps:
      - env:
          SELECTOR: ${{ needs.changes.result }}
          WANTED: ${{ needs.changes.outputs.server }}
          RESULT: ${{ needs.server-tests.result }}
        run: |
          test "$SELECTOR" = success           # a broken selector must not pass
          if [ "$WANTED" = true ]; then test "$RESULT" = success; fi
```

Add a canary check for the selector. Run it on a schedule:

1. For each required suite, pick a file whose change must select that suite.
2. Make a throwaway commit that changes that file.
3. Read the selection for that commit into a variable, with the list or dry-run command above.
4. Fail the canary when the list command fails or when the suite is not in the selection.

Warning: do not pipe the list command into `grep -q` inside a test. Under `pipefail`, the list command can die of SIGPIPE and flip the result.

```bash
selection=$(<list command>) || { echo "the selector failed" >&2; exit 2; }   # one name per line
grep -qxF -- '<suite>' <<<"$selection" || { echo "<suite> is not selected" >&2; exit 1; }
```

## Pre-push hooks

A pre-push hook checks the changed files before CI starts. An agent can skip a step that `AGENTS.md` asks for. A hook runs on each push without a reminder.

| Hook manager | Pre-push setup | Notes |
|---|---|---|
| lefthook | `pre-push:` with `parallel: true` and `{push_files}` | `{push_files}` lists the files that are committed but not pushed. Run `lefthook install` once per clone |
| husky | `.husky/pre-push` | Set `HUSKY=0` in CI and Docker to turn hooks off |
| pre-commit | `default_install_hook_types: [pre-commit, pre-push]` and `stages: [pre-push]` per hook | `PRE_COMMIT_FROM_REF` and `PRE_COMMIT_TO_REF` give the pushed range |

Hooks never replace CI:

- `git push --no-verify` skips the hook. A fresh clone has no hooks until the hook manager installs them.
- A check of changed files misses breakage in the files that import them. So the type check runs on the whole project.

```yaml
# lefthook.yml: fast checks before a push. Use the project's own tools. CI runs the full checks again.
pre-push:
  parallel: true
  commands:
    format:
      glob: "*.{js,jsx,ts,tsx,json,md,yml,yaml}"
      run: bun fmt --no-script --check {push_files}
    lint:
      glob: "*.{js,jsx,ts,tsx}"
      run: bun x --no-install oxlint --deny-warnings {push_files}
    types:
      run: bun x --no-install tsc --noEmit   # whole project: a changed file can break its importers
```

## Sources

- Checkout and history: https://github.com/actions/checkout, https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/, https://github.com/nrwl/nx-set-shas
- Nx: https://nx.dev/docs/features/ci-features/affected
- Turborepo: https://turborepo.com/docs/reference/run
- pnpm: https://pnpm.io/filtering, https://pnpm.io/cli/list
- Changed-file modes: https://vitest.dev/guide/cli, https://bun.com/docs/test, https://jestjs.io/docs/cli, https://playwright.dev/docs/test-cli
- Required checks: https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#handling-skipped-but-required-checks, https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-jobs-with-conditions
- Hooks: https://lefthook.dev/configuration/run, https://lefthook.dev/configuration/parallel, https://typicode.github.io/husky/how-to.html, https://pre-commit.com/, https://git-scm.com/docs/git-push, https://git-scm.com/docs/githooks
