---
title: Release docks-kit 0.13.0 with Relay 0.15.0
goal: Pin verified Session Relay 0.15.0 assets, release docks-kit 0.13.0, and archive remotely readable evidence for the Docks parent.
status: ongoing
created: "2026-08-01T16:15:24.358Z"
updated: "2026-08-02T05:14:03.278Z"
started_at: "2026-08-02T05:14:03.278Z"
finished_at: null
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

Plan-run: {"acceptance":null,"blocker":null,"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"input_sha256":"4323bf9b9f12a69e99db47a2ab194f7790504a1a095cd49640a5156f9cc069a6","invocations":2,"result_sha256":"503017d09c9861bec3e2b2e5c8fa4738b42d5d58d8bd64d2bc7323c465e7a45b","state":"passed"},"execution_parent":"3e4eddec347e51189f1a13b3a48c0ca737520d94","goal_id":"258b44c2-c3b2-4902-862c-7461724ca078","implementation_commit":null,"plan_path":"docs/plans/active/session-relay-0.15.0-docks-kit-0.13.0-release.md","plan_sha256":"f2807e0eab3646ec1552b26d220114594b6ef6282d4bd6c22de1e41e31ca1920","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"ad7f3b75-dfff-4bcd-8d1f-c8c11555b119","schema":1,"source_base":"3e4eddec347e51189f1a13b3a48c0ca737520d94","source_sha256":"b305c22587e38015f94bc485ab61125ff291bef37b593673851782440a67f13a"}
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

## Verification Results

N/A — plan-only creation; implementation has not started.
