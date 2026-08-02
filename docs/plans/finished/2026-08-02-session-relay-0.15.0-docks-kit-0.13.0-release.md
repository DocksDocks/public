---
title: Release docks-kit 0.13.0 with Relay 0.15.0
goal: Pin verified Session Relay 0.15.0 assets, release docks-kit 0.13.0, and archive remotely readable evidence for the Docks parent.
status: finished
created: "2026-08-01T16:15:24.358Z"
updated: "2026-08-02T16:02:30.963Z"
started_at: "2026-08-02T05:14:03.278Z"
finished_at: "2026-08-02T16:02:30.963Z"
assignee: null
tags: [session-relay, docks-kit, supply-chain, release]
affected_paths:
  - .github/workflows/release-cli.yml
  - AGENTS.md
  - README.md
  - SoT/toolchain.json
  - cli/docs/toolchain.md
  - cli/src/generated/sotPayload.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/toolchain.test.ts
  - package.json
related_plans: []
---

# Release docks-kit 0.13.0 with Relay 0.15.0

Plan-run: {"acceptance":{"source_sha256":"41ecf372babf6432e617808ded4d72841e88586cf2b6273552f9ef73588831b6","verification_sha256":"1b59c10b1d6d3f19bfb1d1d530e4d2deaa50f0e4a8da9e75805afeab64497050"},"blocker":null,"completion_review":{"input_sha256":"48fde2ec8e7d8fa465c2b7080792f90c5f65329944e701a4924b5cbe4a7f5a8a","invocations":1,"result_sha256":"e1a69821daeb4b6e3c8064c5e56e64cf4f92663db150047b75e49414cd56f643","state":"passed"},"draft_review":{"input_sha256":"4323bf9b9f12a69e99db47a2ab194f7790504a1a095cd49640a5156f9cc069a6","invocations":2,"result_sha256":"503017d09c9861bec3e2b2e5c8fa4738b42d5d58d8bd64d2bc7323c465e7a45b","state":"passed"},"execution_parent":"3e4eddec347e51189f1a13b3a48c0ca737520d94","goal_id":"258b44c2-c3b2-4902-862c-7461724ca078","implementation_commit":"7ea0611958b85cd98123a8131189ddf950ce6fb9","plan_path":"docs/plans/active/session-relay-0.15.0-docks-kit-0.13.0-release.md","plan_sha256":"f2807e0eab3646ec1552b26d220114594b6ef6282d4bd6c22de1e41e31ca1920","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"ad7f3b75-dfff-4bcd-8d1f-c8c11555b119","schema":1,"source_base":"3e4eddec347e51189f1a13b3a48c0ca737520d94","source_sha256":"b305c22587e38015f94bc485ab61125ff291bef37b593673851782440a67f13a"}
## Goal

After Docks stages the Session Relay 0.15.0 five-asset prerelease, independently verify and pin its four native binary SHA-256 digests, bump docks-kit from 0.12.0 to 0.13.0, update every current published pin surface and hardcoded expectation, regenerate generated payload and recorder-owned goldens, enforce the full gate on both local and tag workflows, release `cli-v0.13.0` plus npm `docks-kit@0.13.0`, then finish and archive a remotely readable public child for the Docks parent.

## Context & rationale

The public repository starts at `3e4eddec347e51189f1a13b3a48c0ca737520d94`, two commits ahead of `origin/main` and zero behind. Those two commits are intentionally retained in the release ancestry and must reach remote `main` before tagging; do not rebase, reset, or tag an unreadable commit.

Current production source pins docks-kit 0.12.0 and Session Relay 0.14.0. Session Relay 0.15.0 digests do not exist locally yet. Obtain each value only after Docks publishes the four target binaries plus `SHA256SUMS`, hash the downloaded binary bytes independently, and require equality with the corresponding checksum row. Never copy prior digests, guess, add Windows, or edit pins before those assets exist.

The moving live surfaces measured at planning time are `package.json`, `SoT/toolchain.json`, generated `cli/src/generated/sotPayload.ts`, `README.md`, `AGENTS.md`, `cli/docs/toolchain.md`, hardcoded expectations in `cli/test/unit/toolchain.test.ts` and `cli/test/unit/engine-di.test.ts`, and both recorder-owned goldens. Discovery must re-sweep current shipped paths before editing and classify each hit by meaning; historical prose and self-contained fixture versions remain byte-identical. `CLAUDE.md` is only a root import and has no moving pin.

`.github/workflows/release-cli.yml` currently validates tag/package identity, builds four Linux/macOS binaries plus `SHA256SUMS`, creates the GitHub release, and publishes npm through OIDC provenance, but does not run the repository's unit, runtime, or golden gate on the tag. Add the same `bun run test:ci` release prerequisite before any build/publication job can proceed. npm trusted publishing must already authorize this repository/workflow; never add a long-lived npm token fallback.

`requested_effects` records intent only and is never live authority. Every non-local step requires a fresh `ExternalAuthorityV1` derived from the operator's exact message at execution time and matching that step's exact effect, mode, target, and source digest. `probe` is read-only and never authorizes mutation. Because pushing `cli-v0.13.0` triggers both the GitHub release and npm publication, matching live `release` and `publish` authorities must both exist before the tag boundary; persisted plan text, prior prompts, tests, reviews, or receipts grant nothing.

`docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` is an unrelated blocked legacy-quarantined plan for Session Relay's old CLI versioning. Do not edit, resume, cite, migrate, or consume it.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`; source base: `3e4eddec347e51189f1a13b3a48c0ca737520d94`.
- Relay asset targets: `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, and `aarch64-apple-darwin`; release assets are `session-relay-<target>` plus `SHA256SUMS`.
- Payload: regenerate with `bun cli/scripts/generate-sot-payload.ts`; verify with `bun run check:generated`.
- Goldens: update only with `bun cli/test/golden-dryrun.ts --update-goldens` and `bun cli/test/golden-mutation.ts --update-goldens`; verify normal and `--prove-red` modes afterward.
- Full local gate: `bun run test:ci`.
- User-facing smoke: `./docks-kit sync claude codex --dry-run --skip-rtk` and `./docks-kit sync agents --dry-run --skip-rtk`.
- Release: the exact `cli-v0.13.0` tag triggers `.github/workflows/release-cli.yml`; expected GitHub assets are exactly four docks-kit Linux/macOS x64/arm64 binaries plus `SHA256SUMS`, and npm publication is `docks-kit@0.13.0` with OIDC provenance.
- Archive: move only at finish to `docs/plans/finished/<finish-date>-session-relay-0.15.0-docks-kit-0.13.0-release.md`, using the finish date.

## Steps

| # | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|
| 1 | Read-only preflight the exact Docks Relay 0.15.0 prerelease, independently hash all four downloaded binaries against `SHA256SUMS`, confirm target release/npm nonexistence, and re-check public ancestry. | `DocksDocks/docks` tag `session-relay--v0.15.0`; `DocksDocks/public` tag `cli-v0.13.0`; npm `docks-kit@0.13.0`; `origin/main` | — | `probe` | `planned` | Exactly four supported Relay binaries plus `SHA256SUMS` agree byte-for-row; target tag/release/npm are absent; local main remains two ahead and zero behind or an explicitly reviewed successor; any mismatch, ambiguity, existing target, or missing live probe authority is STOP. |
| 2 | Pin Relay 0.15.0 and the four observed digests, bump package to 0.13.0, update every current published pin surface and hardcoded expectation, make the tag workflow run the full gate, regenerate payload, and record goldens through their recorders. | `.github/workflows/release-cli.yml`; `AGENTS.md`; `README.md`; `SoT/toolchain.json`; `cli/docs/toolchain.md`; `cli/src/generated/sotPayload.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; `cli/test/unit/engine-di.test.ts`; `cli/test/unit/toolchain.test.ts`; `package.json` | 1 | `local` | `planned` | All live pins agree on Relay 0.15.0/tag/plugin/four digests and docks-kit 0.13.0; generated and golden files have recorder provenance; tag jobs cannot build or publish before `bun run test:ci`; history and unrelated fixtures are unchanged. |
| 3 | Run generated freshness, focused expectations, the full local gate, both prove-red modes, direct dry-run sync, and an exact moving-value sweep. | all affected paths from frontmatter | 2 | `local` | `planned` | Every ordinary command exits 0; prove-red modes exit nonzero with their exact success markers; dry-runs report Relay 0.15.0 without user mutation; no stale live pin remains. Failure is repaired locally and the invalidated checks rerun. |
| 4 | Commit the owned implementation and obtain a fresh exact-diff completion review, repairing at most once without publishing. | all affected paths from frontmatter; this plan record | 3 | `local` | `planned` | One unpublished implementation commit binds the exact affected-path diff and a matching CompletionReviewV1 passes; review failure or concurrent bytes is STOP. |
| 5 | Re-probe target absence, four Relay asset digests, workflow/OIDC preconditions, exact reviewed commit, and remote-main ancestry immediately before mutation. | `session-relay--v0.15.0`; `.github/workflows/release-cli.yml`; `origin/main`; `cli-v0.13.0`; npm `docks-kit@0.13.0` | 4 | `probe` | `planned` | Inputs still match reviewed evidence, target identities remain absent, and exact live probe authority matches these read-only targets; drift, ambiguity, or npm OIDC uncertainty is STOP. |
| 6 | Push the reviewed implementation ancestry, including the two pre-existing local commits, to public `main` and read it back. | `DocksDocks/public` branch `main` | 5 | `push` | `planned` | Remote `main` resolves to the reviewed implementation, contains the two starting commits, and is readable through the remote API; missing exact live push authority or non-fast-forward divergence is STOP. |
| 7 | Create and push exact tag `cli-v0.13.0` to run the repository release recipe and create the GitHub release. | `DocksDocks/public` ref `refs/tags/cli-v0.13.0`; GitHub release `cli-v0.13.0` | 6 | `release` | `planned` | Exact live release and publish authorities were both checked before the tag push; the sole tag workflow reaches a successful GitHub release with exactly four supported binaries plus `SHA256SUMS`, matching tag/commit identity, and no Windows asset. Never retag, replace, or clobber. |
| 8 | Allow the same tag workflow's OIDC job to publish npm and independently verify the registry result. | npm package `docks-kit@0.13.0`; `.github/workflows/release-cli.yml` job `npm-publish` | 7 | `publish` | `planned` | Exact live publish authority existed at the tag boundary; OIDC provenance publication succeeds once and a fresh isolated-cache registry read returns exactly 0.13.0. Any failure is STOP; never fall back to a token or republish. |
| 9 | Record observed release evidence, bind acceptance and completion review, finish and archive under the finish date, commit the archive checkpoint, push it, and read back the finished plan for the Docks parent handback. | `docs/plans/active/session-relay-0.15.0-docks-kit-0.13.0-release.md`; `docs/plans/finished/<finish-date>-session-relay-0.15.0-docks-kit-0.13.0-release.md`; `DocksDocks/public` branch `main` | 8 | `push` | `planned` | Exact live push authority matches the archive target; PlanRunV1 is finished with acceptance and passed completion review, the active file moved once, and remote `main` contains the finished plan with remotely readable release commit, plan commit, finished path, and completion-review SHA-256. No plan step remains after terminal finish. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| P1 | Independently SHA-256 each downloaded `session-relay--v0.15.0` binary and compare to its `SHA256SUMS` row | Four lowercase 64-hex values agree one-to-one for the supported targets; no Windows target. |
| P2 | `node -e "console.log(require('./package.json').version)"` and `node -e "console.log(JSON.stringify(require('./SoT/toolchain.json').tools['session-relay'],null,2))"` | Package is 0.13.0; Relay verified/tag/plugin are 0.15.0 and all four assets equal P1. |
| P3 | `bun run check:generated` | Exit 0; generated package version is 0.13.0 and embedded toolchain bytes are fresh. |
| P4 | Recorder update commands, then `bun run golden:dryrun`, `bun run golden:mutation`, and each `--prove-red` mode | Recorder owns both JSON files; normal gates pass; each planted mismatch exits nonzero with its exact `prove-red OK` marker. |
| P5 | `bun run test:ci` | Exit 0 across generated freshness, typecheck, unit, POSIX runtime, dry-run golden, and mutation golden gates. |
| P6 | `./docks-kit sync claude codex --dry-run --skip-rtk` and `./docks-kit sync agents --dry-run --skip-rtk` | Exit 0, report the exact Relay 0.15.0 production pin on applicable targets, and do not mutate user state. |
| P7 | Moving-value sweep over `README.md AGENTS.md CLAUDE.md cli/docs SoT/ cli/src cli/test package.json .github/workflows/release-cli.yml` | Every current production/doc/test/golden hit is 0.15.0 or 0.13.0 as appropriate; historical prose and self-contained fixtures are unchanged. |
| P8 | Inspect the successful `cli-v0.13.0` workflow and independently download its GitHub release assets | Tag resolves to the reviewed remote commit; release has exactly four docks-kit binaries plus `SHA256SUMS`; all rows match downloaded bytes; no Windows. |
| P9 | Fresh mode-0700-cache `npm view docks-kit@0.13.0 version` plus provenance inspection | Returns exactly 0.13.0 and OIDC provenance is present. |
| P10 | Current PlanRunV1 validator, finished-plan remote read-back, and `git rev-list --count` ancestry checks | Finished archive validates; public main is zero behind its remote; reported handback identities are remotely readable and mutually bound. |

## Out of scope / do-NOT-touch

- Do not modify DocksDocks/docks, perform the Session Relay release, guess digests, or write any pin before the Relay 0.15.0 assets exist.
- Do not edit, resume, cite, migrate, archive, or consume `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` or any historical finished plan.
- Do not hand-edit `cli/src/generated/sotPayload.ts` or either golden; use their generators/recorders. Do not rewrite historical prose or self-contained test fixtures merely because a literal resembles a moving version.
- Do not add Windows, built binaries, `SHA256SUMS`, generated payload artifacts beyond the owned generated source, token-based npm credentials, or new release assets.
- Do not rebase, reset, force-push, retag, replace release assets, republish npm, deploy, or cross any external boundary without exact live authorization.

## STOP conditions

- Relay 0.15.0 lacks the exact four binaries plus `SHA256SUMS`, any binary digest disagrees with its row, a target identity already exists, or a Windows/unexpected asset appears.
- The Docks parent has not confirmed its 0.15.0 instance accepts docks-kit 0.13.0 and this exact public `run_id`/plan path before the tag boundary.
- Source/index/owned paths or remote ancestry change unexpectedly; the reviewed implementation is not reachable on remote `main`; a push would be non-fast-forward.
- Generated freshness, focused expectations, `bun run test:ci`, normal/prove-red goldens, dry-run smoke, completion review, workflow gate, release assets, npm provenance, plan validator, or remote read-back is not green.
- Any required live `probe`, `push`, `release`, or `publish` authority is absent or mismatched. Release and publish authority must both exist before pushing the tag.
- Recovery would require force/delete/retag/reupload/republish or a long-lived npm credential.

## Open questions

N/A — versions, target matrix, digest source, parent ordering, inclusion of the two starting commits, generator/recorders, release workflow gate, OIDC-only publication, and finish-date archive convention are fixed.


## Review

Draft review invocation 1:\n\nReview-result: {"findings":[{"defect":"Step 9 binds final acceptance and marks PlanRunV1 finished before step 10 performs the required archive push and remote read-back, so terminal lifecycle state precedes a dependent plan action and P10 cannot yet be observed when acceptance is bound.","fix":"Make archive commit, authorized push, remote read-back, and P10 validation one finalization step whose done condition is satisfied before the run is declared complete; no plan step may remain after terminal finish.","id":"F1","kind":"contradiction","locator":"plan.md § Steps rows 9–10; § Acceptance criteria P10"}],"invocation":1,"plan_sha256":"6fd8e0d1d253ae0dfd1867d8a341cb0a9862046179ddd92dfee9698b301c7b56","run_id":"ad7f3b75-dfff-4bcd-8d1f-c8c11555b119","schema":1,"source_sha256":"b305c22587e38015f94bc485ab61125ff291bef37b593673851782440a67f13a","verdict":"repair"}


Draft review invocation 2:

Review-result: {"findings":[],"invocation":2,"plan_sha256":"f2807e0eab3646ec1552b26d220114594b6ef6282d4bd6c22de1e41e31ca1920","run_id":"ad7f3b75-dfff-4bcd-8d1f-c8c11555b119","schema":1,"source_sha256":"b305c22587e38015f94bc485ab61125ff291bef37b593673851782440a67f13a","verdict":"pass"}

Completion review invocation 1:

Completion-review-result: {"diff_sha256":"5ece7d5067249a3153326fdd231b307a35b164bca1c477130fb34eadb7be5776","findings":[],"implementation_commit":"7ea0611958b85cd98123a8131189ddf950ce6fb9","invocation":1,"run_id":"ad7f3b75-dfff-4bcd-8d1f-c8c11555b119","schema":1,"verdict":"pass"}

## Verification Results

### Row 1 — authorized read-only probe

- Authority was derived from the exact operator bytes Grant probe/read now - I will wake it with the grant; independently computed source SHA-256: 25ca5dd7cba38544f1e3be3704b4a91a16c1903e0e3dff81187f9d95447d9549. The validated boundary was scopes:[probe], mode:read, limited to the named Relay prerelease assets and read-only public/GitHub/npm identities.
- Parent files independently confirmed run ad7f3b75-dfff-4bcd-8d1f-c8c11555b119, public child 0.13.0, tag cli-v0.13.0, and the exact active-plan derivation.
- Downloaded SHA256SUMS SHA-256: e37a5eb76951aa4afe264e8e6b01e4944f4f35487743b90b27833597645bb63b. Independent binary hashes matched its rows one-for-one: aarch64-apple-darwin 24ef2cc98a4034391fef60bc3c13a672511b024f0d6493395bb61562936ac5c7; aarch64-unknown-linux-musl ee52d7757a22febe3fcb4e00dbb81ec1fb1a1d5769c5eeda903f11a765029a06; x86_64-apple-darwin 8f4b11be831d5fc232965264c354f202c67c2260f383fba3e8c811eb6ea8ca39; x86_64-unknown-linux-musl 875ca460a21d4f205833db5629bcf249413da77e444f4927107a44e63b71acab.
- The parent release was prerelease/non-draft at commit 4c372a8dec2daca5bf4327fa6eee09539b1b7b56, with exactly the four supported binaries plus SHA256SUMS and no Windows asset. Public origin/main was 1933990db21062c4c3639b5bb5c13908d40d1342; cli-v0.13.0, its GitHub release, and npm docks-kit@0.13.0 were absent. Source base was zero behind and two ahead of live remote main.

### Rows 2–3 — local implementation and verification

- Updated exactly the 11 frontmatter affected paths. All live surfaces agree on docks-kit 0.13.0, Relay/tag/plugin 0.15.0, and the four verified digests. .github/workflows/release-cli.yml runs bun run test:ci in the build job before builds; release and npm publication remain downstream. No external effect occurred.
- Regenerated cli/src/generated/sotPayload.ts with bun cli/scripts/generate-sot-payload.ts; generated payload hash is 0638cd72865264d86838a2615bce6a5395c4c01bd90dac811399cbdb3f7ad334. Re-recorded dry-run and mutation goldens only with their --update-goldens recorders.
- bun run check:generated: exit 0.
- bun run test:unit -- cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts: exit 0, 2 files and 18 tests passed.
- bun run golden:dryrun: exit 0, 25 cases. bun run golden:mutation: exit 0, 71 cases.
- bun cli/test/golden-dryrun.ts --prove-red: expected exit 1 with prove-red OK: golden-dryrun detected 25 planted mismatch(es); intentionally exiting 1.
- bun cli/test/golden-mutation.ts --prove-red: expected exit 1 with prove-red OK: golden-mutation detected 68 planted mismatch(es); intentionally exiting 1.
- bun run test:ci: exit 0; generated freshness, typecheck, 26 unit files / 192 tests, POSIX runtime smoke, 25 dry-run golden cases, and 71 mutation golden cases passed.
- ./docks-kit sync claude codex --dry-run --skip-rtk: exit 0; source 0.13.0 used and both applicable Relay ensures reported 0.15.0. ./docks-kit sync agents --dry-run --skip-rtk: exit 0. Both were dry-run only.
- Exact moving-value sweep found no stale live 0.14.0, Relay 0.12.0, or NPM_TOKEN hit across the planned shipped surfaces. git diff --check passed before the checkpoint.
- Transaction-guarded unpublished implementation commit: 7ea0611958b85cd98123a8131189ddf950ce6fb9; its parent is start checkpoint 57e5d5b8e0d85b78093ed5f58d37976a835d8557, and its committed path set is exactly the 11 affected paths.

### Row 4 — implementation checkpoint and completion review

- Transaction-guarded implementation commit `7ea0611958b85cd98123a8131189ddf950ce6fb9` contains exactly the 11 affected paths. Completion review invocation 1 passed that exact implementation/diff; CompletionReviewV1 result SHA-256 is `e1a69821daeb4b6e3c8064c5e56e64cf4f92663db150047b75e49414cd56f643`.

### Rows 5–7 — mutation-boundary probe, main push, tag, and GitHub release

- Row 5 re-derived the exact read authority with source SHA-256 `0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641`. A fresh download reproduced `SHA256SUMS` `e37a5eb76951aa4afe264e8e6b01e4944f4f35487743b90b27833597645bb63b` and all four Relay digests recorded in Row 1; committed pins matched. Target tag/release/npm were absent, public remote main was `1933990db21062c4c3639b5bb5c13908d40d1342`, and workflow/OIDC gates were present.
- Row 6 revalidated exact push authority and ordinarily fast-forwarded public `main` to reviewed implementation `7ea0611958b85cd98123a8131189ddf950ce6fb9`; Git and GitHub API read-backs agreed.
- Row 7 created annotated tag `cli-v0.13.0` once (tag object `1a1de15ced89f6fbe286b0a79d125662a0ee3761`, peeled commit `7ea0611958b85cd98123a8131189ddf950ce6fb9`). Release `https://github.com/DocksDocks/public/releases/tag/cli-v0.13.0` is non-draft/non-prerelease, database id `363812012`, with exactly four supported binaries plus `SHA256SUMS` and no Windows asset.

### Row 8 — publication failure and authorized durable recovery

- Original tag-push workflow run `30752771211` passed build and GitHub release but its npm job failed at exit 128. The reviewed implementation had passed `release-dist/docks-kit-0.13.0.tgz` without a leading `./`; npm-package-arg parsed that bare relative string as GitHub shorthand and invoked `git ls-remote ssh://git@github.com/release-dist/docks-kit-0.13.0.tgz.git`, which failed with `Permission denied (publickey)`. A fresh registry read remained E404, so version 0.13.0 was not burned.
- Exact current-user recovery authority retained run `ad7f3b75-dfff-4bcd-8d1f-c8c11555b119` and source digest `0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641`. The reviewed replacement workflow SHA-256 is `a1c6327cfe1c7974cc42b14e54c022ad00dadc2d1f05f5841a6b29bd036f3e1a`; `actionlint -shellcheck=shellcheck` exited 0 and `bun run test:ci` passed 26 files / 192 tests plus both goldens.
- Durable workflow repair `cf8c125efd4399111b33a4f8a61c0ef983251592` touches only `.github/workflows/release-cli.yml` and is a direct child of `7ea0611958b85cd98123a8131189ddf950ce6fb9`. It landed under exact current-user authority as a separate commit. The reviewed implementation commit remains `7ea0611958b85cd98123a8131189ddf950ce6fb9`; the completion-review budget was already spent and the completion phase already passed, so the repair carries no CompletionReviewV1.
- Recovery dispatch `https://github.com/DocksDocks/public/actions/runs/30755294349` completed successfully at `cf8c125efd4399111b33a4f8a61c0ef983251592`. Its dispatch-only packaged-content proof passed against `cli-v0.13.0`; its release job reported all five assets already present. Release database id and every asset id, timestamp, size, and digest remained unchanged.
- Fresh mode-0700-cache `npm view docks-kit@0.13.0 version` returned exactly `0.13.0`. Registry attestations expose SLSA provenance v1; `npm audit signatures` verified the package's publish and SLSA bundles with no invalid or missing entry. Provenance binds `DocksDocks/public`, `.github/workflows/release-cli.yml`, `refs/heads/main`, commit `cf8c125efd4399111b33a4f8a61c0ef983251592`, and invocation `https://github.com/DocksDocks/public/actions/runs/30755294349/attempts/1`.
- Rerunning only the failed jobs of run `30752771211` produced `run_attempt: 2` and final `conclusion: success`; its npm job logged `docks-kit@0.13.0 is already published`. Exactly one run matches the parent predicate: path `.github/workflows/release-cli.yml`, branch `cli-v0.13.0`, event `push`, completed/success, head `7ea0611958b85cd98123a8131189ddf950ce6fb9`, id `30752771211`, attempt 2. Release asset metadata remained identical after this rerun.

### P8–P10 final acceptance

- P8 independently downloaded the five public release assets. `SHA256SUMS` verified all four binaries: darwin-arm64 `b60964ce55b82d3717ce4ec21112fe5c4bb1fad7857978d42f0dc2eb5f980e4f`; darwin-x64 `df43801d7e60864250ae2ec33876fbed37358d95a16eae00b4001a4d85ba0bcc`; linux-arm64 `dee0af690df001d309dc2b50dac9793068bfdaaaff9562bcf51aeb71992022d8`; linux-x64 `5a9a0e0c23228a586518e0ac8c09a3ad93058a222493fbb887195863d8ba5769`. `SHA256SUMS` itself is `5f6cfe3334ef8bc1fc7de6a46642483a1ee9bf7e5141414ed6498fcffd2b80a8`.
- P9 passed with exact version `0.13.0`, integrity `sha512-VUU7/IXhWdm6ZMxqAM/tiupxx+XC/3jw/FMooJ+nMh0mvKox2GLNyYNn97mdvVqsKkipg4FwhutTy4ewYnCw5w==`, and verified OIDC provenance.
- P10 pre-archive validation preserves `source_base == execution_parent == 3e4eddec347e51189f1a13b3a48c0ca737520d94`, run id `ad7f3b75-dfff-4bcd-8d1f-c8c11555b119`, goal id `258b44c2-c3b2-4902-862c-7461724ca078`, implementation commit `7ea0611958b85cd98123a8131189ddf950ce6fb9`, and passed completion-review result `e1a69821daeb4b6e3c8064c5e56e64cf4f92663db150047b75e49414cd56f643`. Final acceptance is rebound to the repaired affected-path manifest. The archive commit, push, ancestry check, and finished-plan remote read-back are the terminal handback performed after these immutable finished bytes are created.
- All P1–P10 observations are complete; this child is ready for its archive checkpoint and remote read-back before the Docks parent consumes it.
