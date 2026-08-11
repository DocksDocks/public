---
title: Resolve kit home from the running install, not the cwd
goal: docks-kit update targets the installation that is running, from any working directory, shipped as 0.15.1
status: ongoing
created: "2026-08-11T18:09:08-03:00"
updated: "2026-08-11T18:24:06-03:00"
started_at: "2026-08-11T18:24:06-03:00"
finished_at: null
assignee: null
tags: []
affected_paths:
  - README.md
  - cli/dist/SHA256SUMS
  - cli/dist/docks-kit-linux-x64
  - cli/docs/install.md
  - cli/src/generated/sotPayload.ts
  - cli/src/kitHome.ts
  - cli/test/unit/kitHome.test.ts
  - package.json
related_plans: []
---

## Goal

`kitHome()` must identify the docks-kit installation that is executing. Today the
current working directory outranks the install, so two user-visible defects exist
on a normal machine.

The observable outcome is three-part. A globally installed `docks-kit` run from
inside an unrelated docks-kit checkout resolves the global package. A compiled
standalone binary inside `<checkout>/cli/dist` resolves that checkout from any
working directory. Both behaviors ship to users as `docks-kit` 0.15.1 on npm and
as GitHub release binaries.

## Context & rationale

Both defects were reproduced on this host before drafting.

Defect 1, cwd hijack. `cli/src/kitHome.ts kitHome` walks the ancestors of
`process.cwd()` before it probes the package root. A global install therefore
adopts any checkout it happens to run inside:

```text
cd ~                      -> /home/<user>/.bun/install/global/node_modules/docks-kit
cd <checkout>             -> <checkout>
```

`cli/src/commands/update.ts updateCommand` then routes the global install into
`updateCheckout`, which runs `git pull --ff-only` against the repository the user
is editing. `cli/src/engine.ts` compounds it: the non-compiled branch spawns
`${kitHome()}/cli/src/main.ts`, so a global 0.15.0 can re-enter a checkout at a
different version.

Defect 2, compiled fallback. Inside a Bun standalone executable `import.meta.dir`
is a virtual bunfs path, so the `resolve(import.meta.dir, "..", "..")` probe cannot
match. Resolution falls through to `dirname(process.execPath)`, which for the
launcher-preferred binary is `<checkout>/cli/dist`. That directory holds no `.git`
and no `node_modules` segment, so `update` bails:

```text
kit home <checkout>/cli/dist is neither a git checkout nor a global package
install - update it the way it was installed
```

Durable fix chosen over the temporary one: reorder resolution so the running
install wins, and walk ancestors from `process.execPath` so a compiled binary
finds its own checkout. The temporary fix it replaces is special-casing the
`cli/dist` suffix inside `update`, which would leave the cwd hijack and the
`engine.ts` cross-version spawn untouched.

`kitHome()` never gates payload availability. `cli/src/engine-native/index.ts`
carries it as `Ctx.repoDir`, consumed only by `payloadDisplayPath` and the
`Repo:` summary line, so the blast radius is display strings, `update` routing,
and the `sync` behind-upstream nudge.

The user granted release authority for 0.15.1 in the current session message and
directed that no further confirmation be requested.

## Environment & how-to-run

Linux x64, Bun 1.3.14, repository root `DocksDocks/public` on `main` tracking
`origin/main`. All commands run from the repository root.

```sh
bun run test:ci                 # check:generated, typecheck, unit, runtime, both goldens
bun cli/scripts/generate-sot-payload.ts   # regenerate after a version bump
bash cli/build-binaries.sh linux-x64      # local launcher fast path only
```

Release recipe, as documented by `.github/workflows/release-cli.yml`: push the
version-bump commit to `main`, then push the annotated tag `cli-v0.15.1`. The
`release-cli` workflow validates that the tag version equals `package.json`,
runs `test:ci`, builds all four binaries, packs the tarball, creates the GitHub
release, and publishes to npm through OIDC provenance. `cli/dist/` is gitignored,
so no build artifact is committed.

Building a single target rewrites `cli/dist/SHA256SUMS` to cover only that
target. That file is a local artifact; the release workflow builds all four and
writes the full manifest.

The host launcher this plan replaces in step 8 currently holds exactly these two
lines. This block is the restore source named by that step's failure action:

```sh
#!/bin/sh
exec /home/docks/projects/public/docks-kit "$@"
```

Digest recipes used by this plan's record:

- `plan_sha256` is sha256 over this file after removing the frontmatter
  `status`, `created`, `updated`, `started_at` and `finished_at` lines, the
  `Plan-run:` line, and the `## Review` and `## Verification Results` sections.
- `source_sha256` is sha256 over a manifest of `affected_paths`, sorted, one
  `<path>\t<kind>\t<octal mode>\t<sha256 or ->` line each, newline terminated,
  where an absent path is `<path>\tabsent\t-\t-`.

## Steps

| # | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|
| 1 | Extract `KitHomeSources` and pure `resolveKitHome`; order resolution as `DOCKS_KIT_HOME`, module-dir ancestor walk, exec-path ancestor walk, cwd ancestor walk, `dirname(execPath)`; keep the `DOCKS_KIT_HOME` throw text byte-identical | `cli/src/kitHome.ts` | — | `local` | `planned` | `resolveKitHome` is exported and reads nothing from `process`; failure action: revert the file and re-derive the order from the defects above |
| 2 | Add regression tests for every precedence branch, including the global-package-inside-a-checkout case and the `cli/dist` compiled-binary case | `cli/test/unit/kitHome.test.ts` | 1 | `local` | `planned` | `bun run test:unit` passes with the new cases present; failure action: fix the implementation, never relax an assertion |
| 3 | Document the five resolution sources in the order step 1 implements them, and the consequence for a global install run inside a checkout | `cli/docs/install.md` | 1 | `local` | `planned` | The autodetection section lists all five sources in implementation order; failure action: rewrite the section |
| 4 | Bump the package to 0.15.1 and regenerate the payload module | `package.json`, `README.md`, `cli/src/generated/sotPayload.ts` | 1, 2, 3 | `local` | `planned` | `bun cli/scripts/generate-sot-payload.ts --check` exits 0 with `GENERATED_PACKAGE_VERSION = "0.15.1"`; failure action: rerun the generator without `--check` |
| 5 | Rebuild the local linux-x64 binary so acceptance exercises a post-change artifact instead of the 0.15.0 build already in `cli/dist` | `cli/dist/docks-kit-linux-x64`, `cli/dist/SHA256SUMS` | 4 | `local` | `planned` | `cli/dist/docks-kit-linux-x64 --version` prints `0.15.1`; failure action: fix the cause reported by `generate-sot-payload.ts --check` and rebuild |
| 6 | Run the full local gate on the exact tree that step 7 will tag, before any irreversible action | `package.json`, `README.md`, `cli/src/kitHome.ts`, `cli/test/unit/kitHome.test.ts`, `cli/src/generated/sotPayload.ts`, `cli/docs/install.md` | 5 | `local` | `planned` | `bun run test:ci` exits 0 on the commit that will be tagged; failure action: fix the cause and rerun; never push while it fails |
| 7 | Push the bump commit to `main`, then push the annotated tag `cli-v0.15.1`, and watch `release-cli` to completion | `package.json`, `README.md`, `cli/src/generated/sotPayload.ts`, `cli/src/kitHome.ts`, `cli/test/unit/kitHome.test.ts`, `cli/docs/install.md` | 6 | `release` | `planned` | The `release-cli` run for tag `cli-v0.15.1` reports success for `build`, `github-release` and `npm-publish`; failure action: re-drive the workflow through `workflow_dispatch` with the same tag |
| 8 | Upgrade the host global install with `bun add -g docks-kit@latest`, copy the existing launcher to `~/.local/bin/docks-kit.bak`, then relink `~/.local/bin/docks-kit` to the `docks-kit` entry under `bun pm bin -g`, matching `install.sh` | `~/.local/bin/docks-kit`, `~/.local/bin/docks-kit.bak` | 7 | `local` | `planned` | `docks-kit --version` prints `0.15.1` from any directory and resolves to the global package; failure action: restore the two-line shim recorded verbatim in `## Environment & how-to-run` |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `bun run test:ci` | Exit 0; unit, runtime, dry-run golden and mutation golden all pass |
| A2 | `bun cli/src/main.ts status --json \| jq -r .kitHome` | The repository root |
| A3 | `(cd "$HOME" && "$OLDPWD/cli/dist/docks-kit-linux-x64" status --json \| jq -r .kitHome)` | The repository root, not its `cli/dist` subdirectory. Requires the step 5 rebuild, so a wrong step 1 fails this row |
| A4 | `"$HOME/.bun/bin/docks-kit" status --json \| jq -r .kitHome` | `$HOME/.bun/install/global/node_modules/docks-kit`, while the working directory is the checkout. Requires the step 8 global upgrade |
| A5 | `npm view docks-kit@0.15.1 version` | `0.15.1` |
| A6 | `gh release view cli-v0.15.1 --json assets --jq '.assets[].name'` | The four platform binaries plus `SHA256SUMS` |
| A7 | `(cd "$HOME" && docks-kit update --no-sync)` | Reports the global package already current at 0.15.1; the checkout receives no `git pull`. Requires the step 8 relink |

## Out of scope / do-NOT-touch

- `docs/plans/AGENTS.md` and the v1-versus-v2 plan-contract drift between this
  workspace and the installed `plan-lifecycle` skill. That is a separate
  `plan-workspace` goal.
- `cli/src/commands/update.ts`. Its `.git`-versus-`node_modules` classification
  is correct once the kit home is correct.
- `cli/src/engine.ts`, `cli/src/engine-native/index.ts`, and every payload read.
  They consume `kitHome()` and need no change.
- `install.sh`. It already links the Bun global bin entry; only this host drifted.
- `SoT/` prompt surfaces, toolchain pins, and plugin manifests.

## STOP conditions

- `bun run test:ci` fails for a reason the diff did not introduce.
- The `release-cli` workflow fails after the tag is pushed and a
  `workflow_dispatch` re-drive also fails. The tag is burned on first push and
  cannot be recreated.
- `npm view docks-kit@0.15.1` reports a version other than `0.15.1`.
- The host launcher at `~/.local/bin/docks-kit` turns out to be tracked by
  another tool that would rewrite it.

## Open questions

None. Release authority for 0.15.1 was granted in the current session and no
further confirmation was requested.

## Review

Plan-run: {"acceptance":null,"blocker":null,"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"input_sha256":"6c3e73ab6ff4bed9a236062ca123cec831d0ee1703ed3a6c3a8ab1364ab509f1","invocations":2,"result_sha256":"d1039e3811787da31bb66a5bb6c00a4fdbe934f61c27c7029dd5f72f7b642354","state":"passed"},"execution_parent":"b3a285c7c15902ccca40f2cd715076f6bdf60748","goal_id":"76673ad0-81ad-48eb-9e91-458fefbd6795","implementation_commit":null,"plan_path":"docs/plans/active/kithome-install-root-precedence.md","plan_sha256":"3bd0e72c23bc1c6054897921f54595c17a630e9c749546f8dd42607de7172a95","repository_id":"github.com/DocksDocks/public","requested_effects":["local","release"],"risk":"external","run_id":"f76e1056-4f46-47e5-8226-d4f7b18e3d24","schema":1,"source_base":"b3a285c7c15902ccca40f2cd715076f6bdf60748","source_sha256":"86d9d0f7cc04a191d7ecb999e82551bc53149033cf6b6eb9ce85c9fe8483090b"}


Draft review invocation 1 — verdict `repair`, five findings, all accepted and repaired:
F1 the host global install was never upgraded to 0.15.1; F2 no step rebuilt the
`cli/dist` binary that acceptance A3 invokes; F3 the full `bun run test:ci` gate was
not bound before the irreversible tag push; F4 the docs step said four resolution
sources while the implementation step defines five; F5 the host launcher was
overwritten with no recorded restore bytes.

Plan-review-result: {"findings":[{"defect":"Row 6 only repoints ~/.local/bin/docks-kit at the Bun global bin entry, yet its done-when requires docks-kit --version to print 0.15.1 and A4 requires $HOME/.bun/bin/docks-kit to run the fixed resolver. The Bun global package on this host is still 0.15.0 (/home/docks/.bun/install/global/node_modules/docks-kit/package.json version field) and no Steps row upgrades it; install.sh performs that upgrade as a separate bun add -g docks-kit@latest before it links ~/.local/bin/docks-kit. Publishing 0.15.1 to npm in row 5 does not change the installed global tree, so row 6 as written relinks to 0.15.0 code and both its own done-when and A4 fail.","fix":"Extend row 6 to upgrade the global install first: run bun add -g docks-kit@latest after A5 confirms 0.15.1 is on npm, then relink ~/.local/bin/docks-kit to the docks-kit entry under the directory printed by bun pm -g bin, and record A4 and A7 as depending on that upgraded global install.","id":"F1","kind":"contradiction","locator":"docs/plans/active/kithome-install-root-precedence.md ## Steps row 6 and ## Acceptance criteria A4 (host global install)"},{"defect":"A3 is the only acceptance that exercises the exec-path ancestor walk added by row 1, but no Steps row builds the binary it invokes. cli/dist already contains docks-kit-linux-x64 plus the other three targets and SHA256SUMS compiled from current 0.15.0 source, and cli/dist/ is gitignored (.gitignore line 8), so A3 as written runs a pre-change artifact and its result is independent of row 1. cli/build-binaries.sh additionally runs generate-sot-payload.ts --check, so the artifact must be rebuilt after the row 4 version bump for the launcher fast path to accept it at all.","fix":"Add a local Steps row after row 4 that runs bash cli/build-binaries.sh linux-x64, name cli/dist/docks-kit-linux-x64 as its artifact, and make A3 depend on that row so a skipped or wrong row 1 makes A3 fail.","id":"F2","kind":"missing_acceptance","locator":"docs/plans/active/kithome-install-root-precedence.md ## Acceptance criteria A3 against ## Steps rows 1-5 (cli/dist/docks-kit-linux-x64)"},{"defect":"Row 5 pushes the annotated tag cli-v0.15.1, which the plan STOP conditions correctly describe as burned on first push, but the only gates bound before it are row 2 (bun run test:unit) and row 4 (generate-sot-payload.ts --check). The full local gate A1 (bun run test:ci, which per package.json also runs typecheck, test:runtime:posix, golden:dryrun and golden:mutation) is never bound to any step preceding the irreversible push. The row 5 failure action, a workflow_dispatch re-drive, cannot recover from a test:ci failure inside the build job of .github/workflows/release-cli.yml, because that job re-runs the same gate on the same tag content and would require a new version.","fix":"Bind the local gate ahead of the burn: add a row between 4 and 5 (or a precondition inside row 5 done-when) whose gate is bun run test:ci exit 0 on the exact commit to be tagged, and make row 5 depend on it.","id":"F3","kind":"unsafe_scope","locator":"docs/plans/active/kithome-install-root-precedence.md ## Steps row 5 and ## Acceptance criteria A1"},{"defect":"Row 1 defines five resolution sources in order: DOCKS_KIT_HOME, module-dir ancestor walk, exec-path ancestor walk, cwd ancestor walk, dirname(execPath). Row 3 instructs documenting a four-step resolution order in cli/docs/install.md, so the shipped documentation would omit one implemented branch. cli/docs/install.md currently states no resolution order at all, so row 3 is the sole source for that section.","fix":"Change row 3 to document the five sources row 1 implements, in row 1 order, so cli/docs/install.md matches cli/src/kitHome.ts after the change.","id":"F4","kind":"contradiction","locator":"docs/plans/active/kithome-install-root-precedence.md ## Steps row 3 versus row 1 (resolution-order arity)"},{"defect":"Row 6 overwrites a host file outside the repository and its failure action is to restore the previous file from the recorded bytes, but no step records those bytes and the plan record contains no copy. The current file is a two-line sh shim (shebang plus exec of /home/docks/projects/public/docks-kit), which becomes unrecoverable from the plan once the file is replaced.","fix":"Make the capture part of row 6: copy the existing file to ~/.local/bin/docks-kit.bak and paste its two-line content into the row 6 cell before the replacement, so the stated restore is executable from the plan alone.","id":"F5","kind":"unsafe_scope","locator":"docs/plans/active/kithome-install-root-precedence.md ## Steps row 6 failure action (~/.local/bin/docks-kit)"}],"invocation":1,"plan_sha256":"af2fa7e4b68af53186b08b5a28a95b5523fdb3a4a0f9065a4136f032b70d1077","run_id":"f76e1056-4f46-47e5-8226-d4f7b18e3d24","schema":1,"source_sha256":"3e41c8371a75e8a9b3a932070ae0048c81ece9959a0eec91ece21f252e796a5f","verdict":"repair"}

Draft review invocation 2 — verdict `pass`, no findings. The reviewer confirmed all
five repairs landed and that renumbering the table from six to eight rows introduced
no dangling `Depends` reference, no ungated irreversible action, and no contradiction
with Environment, Out of scope, or STOP conditions.

Plan-review-result: {"findings":[],"invocation":2,"plan_sha256":"3bd0e72c23bc1c6054897921f54595c17a630e9c749546f8dd42607de7172a95","run_id":"f76e1056-4f46-47e5-8226-d4f7b18e3d24","schema":1,"source_sha256":"86d9d0f7cc04a191d7ecb999e82551bc53149033cf6b6eb9ce85c9fe8483090b","verdict":"pass"}





## Verification Results
