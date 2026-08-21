---
plan_contract: v2
title: Release docks-kit 0.15.4 with the Bun 1.4.0 upgrade
goal: The verified Bun 1.4.0 upgrade lands on main as reviewable atomic commits, and tag cli-v0.15.4 publishes the GitHub release and the npm package.
status: ongoing
created: "2026-08-21T02:43:18.302+00:00"
updated: "2026-08-21T03:08:26.067+00:00"
assignee: null
---

## Goal

The verified Bun 1.4.0 upgrade lands on main as reviewable atomic commits, and tag cli-v0.15.4 publishes the GitHub release and the npm package.

The working tree holds 28 uncommitted files: the completed Bun 1.3.14 to 1.4.0 upgrade whose record is archived at `docs/plans/finished/2026-08-21-bun-140-upgrade.md`. That work is fully verified but entirely unpublished. This plan carries it to `main` and to consumers. It exists as a canonical plan because it is multi-commit and because four of its steps have a non-`local` effect, two of them irreversible.

Mode: plan-and-implement

## Research

Repository facts verified by reading:

- `package.json:3` is the authoring version, currently `0.15.3`. `README.md:139` repeats it in release prose. `cli/src/generated/sotPayload.ts:4` carries it as `GENERATED_PACKAGE_VERSION`, and `cli/scripts/generate-sot-payload.ts` derives that symbol from `package.json` at generation time: `packageVersion` parses and validates the manifest and `generatedModule` emits the constant. Bumping `package.json` and rerunning the generator is therefore sufficient for the generated surface; no second edit exists.
- No test hardcodes the current release. `cli/test/unit/payload.test.ts` asserts the source CLI `--version` against a dynamically parsed `package.json`, `cli/test/lib/goldenSnapshot.ts` `packageVersion` normalises the live value to `<VERSION>`, `cli/test/goldens/dryrun.json` stores that placeholder rather than a literal, and `cli/test/unit/launcher.test.ts` reads `CURRENT_VERSION` dynamically. The other version literals in the suite are unrelated fixtures: `update.test.ts` uses `0.15.1` inside a Bun global-listing fixture and asserts a resolved path, `launcher.test.ts` uses `0.4.0` as a deliberately stale binary, and `commandsReporting.test.ts` writes `0.0.0`. A version bump therefore breaks no test.
- The only tracked occurrences of `0.15.3` outside those three files are in `docs/plans/finished/`, which is byte-frozen history. `cli/dist/` does not match and is untracked.
- Built-binary parity is enforced in three places: `cli/scripts/native-smoke.ts` `main` compares the compiled artifact's `--version` to `package.json`, and both checkout launchers inline the same comparison at `docks-kit:32-40` and `docks-kit.ps1:39-68`. A bump therefore makes any stale `cli/dist/` binary be ignored rather than trusted, which is the intended behaviour.
- `.github/workflows/release-cli.yml` resolves the release identity once in `resolve`, requiring the tag to match `^cli-v[0-9]+\.[0-9]+\.[0-9]+$`, and its `build` job fails unless the tag version equals `package.json` version. The bump must therefore be committed before the tag is pushed.
- The release workflow's own comments record two irreversibility facts that shape this plan: a tag is burned on first push and can never be recreated, which is why a `workflow_dispatch` recovery path exists; and a published release asset is immutable evidence that the parent Docks release lane pins, so the upload loop never replaces an existing asset.
- `npm publish` is likewise irreversible: the `npm-publish` job publishes only when `npm view` returns E404 for the exact version, so a mistaken 0.15.4 cannot be replaced, only superseded by 0.15.5.
- Commit convention, from `git log --oneline -20`: Conventional Commits with scopes, including `docs(plans)`, `test(unit)`, `test(host)`, `fix(engine)`, and `chore(release)`. The previous release-prep commit `4760973` is the exact template: message `chore(release): prepare docks-kit 0.15.3` with an empty body, touching four files at one line each.
- `CHANGELOG.md` is not Keep a Changelog. Line 1 is `# Changelog`, then the newest section heading. Sections are dated topic headings of the form `## YYYY-MM-DD - <description>` holding flat bullets wrapped near 78 columns with two-space continuation indent. Commit `4760973` shows the release ritual: it renamed `## Unreleased` to the dated heading. No `## Unreleased` section exists at present, so the Bun 1.4.0 work is currently absent from the changelog.

Commit-split analysis, against the `commit-discipline` constraint that every commit leaves the tree green.

- The golden harness stubs the Bun version probe, which is what decides where the CI action bump belongs. `cli/src/engine-native/toolchain.ts:114` prints a doctor row whose `installed` column comes from `installedVersion`, a spawned probe, while `floor` and `verified` are manifest fields. Under the golden harness that probe does not reach the host: `cli/test/lib/goldenResources.ts:213` stubs `bun --version` to a literal, `1.3.14` at HEAD and `1.4.0` in the working tree, and `cli/test/golden-mutation.ts` passes `defaultStubs` to every matrix case. The recorded row in `cli/test/goldens/mutation.json` is therefore harness data, independent of whichever Bun actually executes the gate.
- **Atomic unit.** `SoT/toolchain.json`, `cli/scripts/generate-sot-payload.ts`, the five generated outputs, the stub literal, and the re-recorded mutation golden are one commit. Bumping the manifest alone fails `check:generated`; committing a generated floor block before the manifest that feeds it fails the same gate; and `cli/test/unit/launcher.test.ts:137` asserts the exact string `Bun 1.3.14 is below the required floor 1.4.0`, naming the old version and the new floor in one literal. Splitting these would require writing intermediate states that exist only to be split.
- **Separable, in this order.** The transitive advisory fix in `bun.lock`. The standalone-build predicate with its `@types/bun` bump, because `typeof Bun !== "undefined" && Bun.isStandaloneExecutable === true` evaluates to `false` on an older runtime exactly as the previous `process.argv[1]` heuristic did. The CI action bump, because the mutation golden reads the stub rather than the runtime, so moving CI to 1.4.0 changes no expectation. The one-line `lockfileVersion` field, because Bun 1.4 loads existing v1 lockfiles, and the archived upgrade record already proves the v2 graph resolves identically and installs frozen.
- Ordering constraints, all satisfied below: the `bun audit` gate lands after the advisory fix it would otherwise fail on, and the v2 lockfile lands after the CI action reaches 1.4.0, because Bun 1.3.x cannot read a v2 lockfile.
- Version effect: this ships as a patch on the user's explicit instruction. The repository is on the `0.x` line, and no consumer contract changes. The floor guard lives in the checkout launchers, not the npm `bin` path, and the predicate swap is behaviour-preserving on older runtimes, so a global npm install of 0.15.4 requires nothing new of its user.

Release-path risks, measured rather than assumed:

- The packed-content proof was conditional, and this series makes it unconditional. `.github/workflows/release-cli.yml:123-124` gates the whole proof on `github.event_name == 'workflow_dispatch'`, so on a tag push nothing checked that `bun pm pack` packed the tag's bytes. The step's own comment at lines 144-145 states the exposure: the tarball is packed from the working tree, not from HEAD. The working-tree cleanliness check at line 146 is valuable on every run, and on a tag run the tag-versus-HEAD diff is trivially satisfied because both paths check out the triggering ref. Removing the condition therefore adds a real guarantee at no cost, and it is the one release-path change this series carries.
- The npm trusted-publisher configuration cannot be verified before the attempt. `npm owner ls docks-kit` reports `docksdocks`, but `npm view docks-kit --json` exposes no trusted-publisher, OIDC, or provenance-policy field, so the registry-side configuration that authorises the keyless publish is mutable state outside this repository. The 0.15.3 publish proves only that it was valid then. Mitigation, not elimination: the `npm-publish` job publishes only after `npm view` returns E404, so a misconfiguration fails the job without publishing anything, and the burned tag stays recoverable through the `workflow_dispatch` path whose packed-content proof this series has just strengthened.
- Push preconditions verified: `main` reports `Branch not protected` with no active ruleset, and repository permissions report `admin` and `push`, so the series can land as a direct push with no pull request.

External facts verified against primary sources:

- Conventional Commits v1.0.0, https://www.conventionalcommits.org - `<type>[scope][!]: <description>`; `!` or a `BREAKING CHANGE:` footer marks a major change. No commit in this series carries `!`, per the version-effect analysis above.
- Bun 1.4.0 release notes and the official breaking-change list, https://bun.com/blog/bun-v1.4 and https://github.com/oven-sh/bun/issues/28792 - new lockfiles default to `lockfileVersion: 2` while existing v0 and v1 lockfiles still load, which is what makes the one-line field a separable commit.

## Steps

| # | Id | Task | Files | Depends | Effect | Status | Done when |
|---:|---|---|---|---|---|---|---|
| 1 | commit_deps | Commit the transitive advisory fix alone, opening the changelog section it belongs to | bun.lock, CHANGELOG.md | — | `local` | `planned` | One commit named `fix(deps)` contains only the nanoid and postcss lockfile hunks plus an `## Unreleased` heading with its own bullet, and `bun audit` exits 0 at that commit |
| 2 | commit_engine | Commit the standalone-build predicate together with the types bump that makes it typed | cli/src/engine.ts, cli/test/unit/engine.test.ts, package.json, bun.lock, CHANGELOG.md | 1 | `local` | `planned` | One commit named `refactor(engine)` contains the predicate, its test, the `@types/bun` range, the matching lockfile hunks, and its changelog bullet |
| 3 | commit_ci_bun | Move CI to Bun 1.4.0 on its own, before any tree state requires that runtime | .github/actions/setup-bun-cache/action.yml, CHANGELOG.md | 2 | `local` | `planned` | One commit named `ci(setup)` changes only the installed Bun version and its cache keys plus its changelog bullet, and no golden expectation moves with it |
| 4 | commit_toolchain | Commit the Bun 1.4.0 target as one atomic derivation: manifest pin, generator floor block, regenerated outputs, launcher guard, stub literal, test literals, and the re-recorded golden | SoT/toolchain.json, cli/scripts/generate-sot-payload.ts, cli/src/generated/sotPayload.ts, docks-kit, docks-kit.ps1, install.sh, install.ps1, cli/docs/toolchain.md, cli/test/lib/goldenResources.ts, cli/test/goldens/mutation.json, cli/test/unit/bun.test.ts, cli/test/unit/deps.test.ts, cli/test/unit/engine-di.test.ts, cli/test/unit/install.test.ts, cli/test/unit/launcher.test.ts, cli/test/unit/modifierValidation.test.ts, cli/test/unit/payload.test.ts, cli/test/unit/os/darwin.test.ts, cli/test/unit/os/linux.test.ts, cli/test/unit/os/windows.test.ts, CHANGELOG.md | 3 | `local` | `planned` | One commit named `feat(toolchain)` carries the whole derivation, leaves `bun.lock` untouched, exits 0 on `bun cli/scripts/generate-sot-payload.ts --check`, and uses no `!` breaking marker |
| 5 | commit_lockfile_v2 | Commit the lockfile format field on its own, now that CI runs Bun 1.4.0 | bun.lock, CHANGELOG.md | 4 | `local` | `planned` | One commit named `build(deps)` changes only `lockfileVersion` and its changelog bullet, and `bun install --frozen-lockfile` exits 0 at that commit |
| 6 | commit_ci_audit | Commit the blocking audit gate after the advisory fix it depends on | .github/workflows/parity.yml, CHANGELOG.md | 5 | `local` | `planned` | One commit named `ci(parity)` adds the guarded full-scope `bun audit` step and nothing else |
| 7 | commit_parallel | Commit the local gate parallelization | package.json, CHANGELOG.md | 6 | `local` | `planned` | One commit named `perf(gate)` changes only the `test:ci` script and its changelog bullet |
| 8 | commit_release_proof | Make the packed-content proof unconditional so a tag-triggered release also proves the tarball came from a pristine tree | .github/workflows/release-cli.yml, CHANGELOG.md | 7 | `local` | `planned` | One commit named `ci(release)` removes the `workflow_dispatch` condition and restates the step comment, the workflow still passes the repository's pinned actionlint, and no other job changes |
| 9 | commit_docs | Commit the rewritten install-output documentation | cli/docs/install.md | 8 | `local` | `planned` | One commit named `docs(install)` contains only that topic |
| 10 | commit_plans_archive | Commit the archived upgrade record | docs/plans/finished/2026-08-21-bun-140-upgrade.md | 9 | `local` | `planned` | One commit named `docs(plans)` adds only the archived record |
| 11 | commit_plans_release | Commit this release plan | this plan record | 10 | `local` | `planned` | One commit named `docs(plans)` adds only this record |
| 12 | verify_series | Prove the gate is green at every commit in the series, not only at its head, without altering any commit on main | none | 11 | `local` | `planned` | A detached worktree checks out each commit of the series in turn, runs a frozen dependency install and the full gate at each one, reports success for all of them, and `main` still resolves to the same hashes afterwards |
| 13 | release_prep | Bump the version across its three surfaces, regenerate the payload, and date the changelog section | package.json, README.md, CHANGELOG.md, cli/src/generated/sotPayload.ts | 12 | `local` | `planned` | One commit named `chore(release): prepare docks-kit 0.15.4` touches exactly those four files, the generator check exits 0, and no `## Unreleased` heading remains |
| 14 | push_main | Push the series to origin main after an in-session confirmation naming every outward effect | none | 13 | `push` | `planned` | `origin/main` resolves to the local HEAD and the push reported no rejection |
| 15 | tag_release | Create and push the annotated tag cli-v0.15.4, which triggers the GitHub release and the irreversible npm publish | none | 14 | `release` | `planned` | The tag exists on origin and the release-cli workflow run has started for it |
| 16 | watch_release | Watch the release run to completion and confirm the release carries every expected artifact | none | 15 | `probe` | `planned` | The run concluded successfully and the release lists the six platform binaries plus SHA256SUMS |
| 17 | verify_published | Prove the registry serves the exact bytes the tagged run built, rather than only that some 0.15.4 exists | none | 16 | `probe` | `planned` | The published tarball's sha512 integrity equals the integrity of the tarball downloaded from that run's artifact, and the published CLI prints 0.15.4 |
| 18 | archive_plan | Archive this plan after the release is verified and push that final documentation commit | this plan record | 17 | `push` | `planned` | The record lives under `docs/plans/finished/` with status finished and the archive commit is on origin main |

## Acceptance

| ID | Command | Expected |
|---|---|---|
| R1 | `git log --oneline @{u}..` | Before the push: twelve subjects, each imperative, each one idea, each carrying a Conventional Commits type and scope this repository already uses |
| R2 | `git worktree add --detach /tmp/verify-series HEAD` then, for each commit in `git rev-list --reverse @{u}..HEAD`, `git -C /tmp/verify-series checkout --detach <sha> && bun install --frozen-lockfile && bun run test:ci` | Exit 0 at every commit in the series rather than only at its head, with `git rev-list @{u}..HEAD` unchanged before and after, proving no commit on `main` was rewritten |
| R3 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0, so the committed payload matches the bumped manifest |
| R4 | `bun -p 'require("./package.json").version'` | Prints `0.15.4` |
| R5 | `grep -c "0.15.4 bundles the CLI" README.md` | Prints 1, so the release prose at line 139 names the new version |
| R6 | `grep -q "^## Unreleased" CHANGELOG.md; echo $?` | Prints 1, so no unreleased section survived the release commit |
| R7 | `sed -n '3p' CHANGELOG.md` | A dated topic heading naming the Bun 1.4.0 release, in the file's existing style |
| R8 | `git status --porcelain` | Empty, so nothing intended for the release was left behind |
| R9 | `bun run test:ci` | Exit 0 at the release commit |
| R10 | `bash cli/build-binaries.sh linux-x64 && ./cli/dist/docks-kit-linux-x64 --version` | Exit 0, prints `0.15.4`, proving the compiled payload carries the bumped version |
| R11 | `git rev-parse HEAD origin/main` | Both hashes identical after the push |
| R12 | `git ls-remote --tags origin cli-v0.15.4` | Lists exactly the pushed tag |
| R13 | `gh run list --workflow release-cli.yml --limit 1` | The newest run targets cli-v0.15.4 and concludes success |
| R14 | `gh release view cli-v0.15.4 --json assets` | Lists the six platform binaries and SHA256SUMS |
| R15 | `npm view docks-kit@0.15.4 dist.integrity` | Prints a `sha512-` integrity string for the published tarball |
| R16 | `bun -e 'const c = await import("node:crypto"); const h = c.createHash("sha512"); h.update(new Uint8Array(await Bun.file(process.argv[2]).arrayBuffer())); console.log("sha512-" + h.digest("base64"))' /tmp/release-artifact/docks-kit-0.15.4.tgz` | Prints exactly the R15 string for the tarball downloaded from the tagged run, proving the registry serves the bytes that run built |
| R17 | `bun x docks-kit@0.15.4 --version` | Prints `0.15.4` from the published package rather than the checkout |

## Do not touch

- `docs/plans/finished/`. Both archived records legitimately contain `0.15.3` as historical evidence and are byte-frozen. The only permitted write under `docs/plans/` is this plan and its own archive move.
- `cli/src/generated/sotPayload.ts` and the marked pin and floor blocks in the four launcher and installer scripts, by hand. Only `cli/scripts/generate-sot-payload.ts` writes them.
- `SoT/.claude/CLAUDE.md` and `SoT/.codex/AGENTS.md`. These are per-turn prompt surfaces and must stay cache-invariant, so no version watermark belongs in them.
- Every job in `.github/workflows/release-cli.yml` other than the packed-content proof step. The tag regex, the version-equality gate, the missing-only asset loop, and the E404-guarded publish are load-bearing irreversibility protections.
- Existing tags `cli-v0.15.0` through `cli-v0.15.3`, every published release asset, and every published npm version. Assets are immutable evidence and a tag is burned on first push.
- The `effect`, `@effect/platform-bun`, `@effect/vitest`, `typescript`, and `vitest` pins. The peer warning the consumer install prints is deliberate and documented.
- `git push --force` in any form, and any history rewrite of `main`. The series is append-only.
- The version numbers in unrelated test fixtures: `update.test.ts` `0.15.1`, `launcher.test.ts` `0.4.0`, and `commandsReporting.test.ts` `0.0.0`. Each is deliberate test data, not a stale release reference.

## Open questions

None blocking. The user instructed a patch release, which settles the version effect, and the commit split is settled by the stubbed-probe evidence recorded in `## Research`.

Carried forward, unchanged, from the archived upgrade plan: the installed `plan-lifecycle` plugin at 0.5.0 is GitHub-issue backed while this repository's root `AGENTS.md` and `docs/plans/AGENTS.md` mandate tracked markdown under `docs/plans/active/`. This plan again ran on the cached 0.4.1 `plan.mjs`, the newest installed version implementing the documented markdown contract. That contradiction is the user's to resolve and does not block this release.

## Review

### Plan review - 2026-08-20

Plan-review: repair

- [research_gap] The atomicity claim was too broad. Disposition: **partially accepted**. The CI action bump and the one-line `lockfileVersion` field are now separate ordered commits, and the narrowed indivisibility claim in `## Research` names its real evidence. The reviewer's stated reason for the action split was wrong in one respect and right in the outcome: a first repair attempt reordered the derivation to the head of the series on the theory that the mutation golden records the live runtime, which `cli/test/lib/goldenResources.ts:213` and `cli/test/golden-mutation.ts` `defaultStubs` refute - the probe is stubbed to a literal, so CI's runtime never reaches the golden. The action commit is separable, the original order stands, and the corrected mechanism is recorded rather than the guess.
- [goal_fit] The changelog step contradicted the per-commit bullets, and the commit count was stale. Disposition: accepted. The separate `changelog_open` step is gone; the first commit opens the section with its own bullet and each later commit appends only its own, so no commit contains a bullet for work it does not carry. R1 now expects twelve subjects.
- [research_gap] `grep -c "^## Unreleased"` exits 1 on zero matches, so the old R6 asserted failure and never checked the replacement heading. Disposition: accepted, split into R6 as an explicit exit-status check and R7 asserting the dated heading.
- [research_gap] The npm trusted-publisher configuration was treated as proven by the 0.15.3 publish. Disposition: accepted. It is registry-side mutable state, invisible to `npm view --json`, so `## Research` records the exposure and the E404-plus-dispatch mitigation instead of claiming a guarantee.
- [security_risk] The packed-content proof runs only on `workflow_dispatch`, so a tag-triggered publish never proved the tarball came from a pristine tree. Disposition: accepted and brought into scope as `step:commit_release_proof`, a single-condition removal in the one release-path file this series touches.

## Verification Results

_Not implemented yet._
