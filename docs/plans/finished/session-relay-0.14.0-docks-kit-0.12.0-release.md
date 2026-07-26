---
title: Release docks-kit 0.12.0 with Relay 0.14.0
goal: Pin independently verified Session Relay 0.14.0 assets, release docks-kit 0.12.0, and archive evidence for the related Docks child.
status: finished
created: "2026-07-25T12:54:02.572Z"
updated: "2026-07-26T01:36:05.859Z"
started_at: "2026-07-25T13:30:30.017Z"
finished_at: "2026-07-26T01:36:05.859Z"
assignee: null
tags: [session-relay, docks-kit, supply-chain, release]
affected_paths:
  - .github/workflows/release-cli.yml
  - AGENTS.md
  - CHANGELOG.md
  - README.md
  - SoT/toolchain.json
  - cli/docs/toolchain.md
  - cli/scripts/generate-sot-payload.ts
  - cli/src/engine-native/sessionRelayCli.ts
  - cli/src/engine-native/toolchain.ts
  - cli/src/generated/sotPayload.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/sessionRelayCli.test.ts
  - cli/test/unit/toolchain.test.ts
  - package.json
related_plans:
  - docs/plans/active/session-relay-cli-0.13.0-release-preparation.md
  - "DocksDocks/docks:docs/plans/active/session-relay-correlated-results-release.md"
---

# Release docks-kit 0.12.0 with Relay 0.14.0

Plan-run: {"acceptance":{"source_sha256":"dc7197d41cbe999b02c3a986265889e057f432a3e67651dd284d480413b3ee3e","verification_sha256":"d362924976d06cfb8c787cf8e52771937b1b7303a63c40ba8d67719b6c0b27df"},"blocker":null,"completion_review":{"input_sha256":"be55e2171e6eb9f65fc3fac0e655720276e432b4c46c6cc6008b159a65a4bc48","invocations":2,"result_sha256":"8034b252d665e71271e932384318585e14cdc0f3ed9452e911a6136aff5739cb","state":"passed"},"draft_review":{"input_sha256":"87944f070d9d218217ddf8aef348d14797f6a2314f20160516486e63bc2083c8","invocations":2,"result_sha256":"52710388a2408c0d27cb3bcb732f7f4ef2985f3a5e252d011ca7710f3657fb20","state":"passed"},"execution_parent":"c36c8ae33722607fb705a46743da38e8b1644ef8","goal_id":"8b89aabf-7336-4352-bc11-225bab67f9aa","implementation_commit":"88ab1911490edad83b387514bb8e899f02338d69","plan_path":"docs/plans/active/session-relay-0.14.0-docks-kit-0.12.0-release.md","plan_sha256":"340dfe9c67ce347ef9b94807c89409198e0bd7588864b30549c5baee5329afce","repository_id":"DocksDocks/public","requested_effects":["local","probe","push","release"],"risk":"external","run_id":"1f801952-705e-4c7e-a533-91026c013383","schema":1,"source_base":"c36c8ae33722607fb705a46743da38e8b1644ef8","source_sha256":"55839090880fd113a215e48ca766de2479ea4fc105bf49956d297a6f3d44909d"}

## Goal

After Docks stages the reviewed Session Relay 0.14.0 five-asset prerelease, independently pin its four native binary SHA-256 digests in the public SoT, bump and regenerate docks-kit 0.12.0, prove installer/package/golden behavior, publish `cli-v0.12.0` plus npm `docks-kit@0.12.0`, and archive a repository-qualified finished child before Docks promotes Relay stable.

## Context & rationale

Public source base is `c36c8ae33722607fb705a46743da38e8b1644ef8`. `package.json` and generated payload are 0.11.0. `SoT/toolchain.json` pins Relay 0.13.0/tag `session-relay--v0.13.0`/plugin version 0.13.0 with four historical digests. The requested `cli-v0.12.0` release/tag and npm `docks-kit@0.12.0` were probed before drafting and returned HTTP 404.

`docs/plans/active/session-relay-cli-0.13.0-release-preparation.md`, bytes SHA-256 `e0b1d183122def14a3f4bd6f05605c6aa7de3fb2dccf4330e8956acc3e0db9ff`, is an immutable `legacy-quarantined` active family. Its schema-1 TDD receipt and schema-2/schema-6 review evidence are settled records inside an unsettled/malformed historical family and grant no current authority. Do not edit or resume it. Carry forward only: production SoT/generated-payload protection until exact native digests exist; four targets and no Windows; checksum-file/download agreement; closed manifest and atomic replacement behavior; red proof before production edits; exact source/test-blob ancestry; and separation of source, implementation, plan, validation-ref, release, and archive identities.

Current relevant values are:

- Relay `verified`, plugin version, and tag: 0.13.0 / 0.13.0 / `session-relay--v0.13.0`.
- Historical digests: Linux x64 `f8c6374c2c704f48135cd646028fbd9e53fd43f9800b4a255fa36a0818744b7b`; Linux arm64 `6ebc6d9a38a8c3d1f191647d3ab679d56b69cffba36c3bc3c8eb99b0e163852e`; macOS x64 `06c046182922c6897e81278fecd7280008fa8040a489910993283017101f1be3`; macOS arm64 `0686e68e3a88dd0dee647fc18211e941dd0d8012818d0bcfb79fac142b5baf21`.
- Generated payload package version 0.11.0 and payload hash `940ea805811b304c9bb4da1d35b4ead0e9b653b7641632042cf298e97d88b789`.

The new Relay digests must come from independently hashing the four staged `session-relay--v0.14.0` binaries and comparing them to that release's `SHA256SUMS`. They must never be guessed, copied from 0.13.0, or written before the red tests fail against the unchanged public tree.

The installer seams are manifest-driven: `sessionRelayCli.ts` validates the closed entry, target mapping, release/checksum/download agreement, staged `--version`, failure preservation, and atomic replacement; `toolchain.ts` consumes embedded SoT. Change these modules only if frozen red assertions require behavior beyond new data. `cli/src/generated/sotPayload.ts` is generated and must only be rewritten by `bun cli/scripts/generate-sot-payload.ts`.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`; source base: `c36c8ae33722607fb705a46743da38e8b1644ef8`.
- Focused tests: `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts`.
- Payload: regenerate with `bun cli/scripts/generate-sot-payload.ts`; verify with `bun cli/scripts/generate-sot-payload.ts --check`.
- Goldens are recorder-owned: update only through `bun cli/test/golden-dryrun.ts --update-goldens` and `bun cli/test/golden-mutation.ts --update-goldens`; then run normal and prove-red gates.
- Full local checks: `bun run typecheck`, `bun run test:unit`, `bun cli/test/statusline-runtime-smoke.mjs posix`, `bun run golden:dryrun`, and `bun run golden:mutation`.
- User smoke: `./docks-kit sync claude codex --dry-run --skip-rtk` and `./docks-kit sync agents --dry-run --skip-rtk`.
- Release recipe: create and push exact reviewed tag `cli-v0.12.0`; `.github/workflows/release-cli.yml` builds four binaries plus `SHA256SUMS`, creates/uploads the GitHub release, and publishes npm with provenance. Post-verification must prove npm 0.12.0 even though the workflow currently downgrades npm publication failure to a warning.

## Steps

| # | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|
| 1 | Receive the four independently observed Relay 0.14.0 digests and write frozen red assertions before any production edit. | unit tests and expected golden rows only | — | `local` | `planned` | Tests assert Relay version/tag/plugin/digests, package 0.12.0, generated package/hash, docs, and goldens; unchanged 0.13.0/0.11.0 tree fails only for those mismatches. Record commands, exits, signatures, outputs, and test blob hashes. |
| 2 | Pin Relay 0.14.0 and all four observed digests; bump package to 0.12.0; regenerate payload; update current docs and recorder-owned goldens. | SoT/package/generated/docs/goldens | 1 | `local` | No generated file is hand-edited; SoT, package, payload, tests, docs, and goldens agree exactly. Installer/toolchain source changes only when frozen tests demand behavior beyond data. |
| 3 | Run focused tests, payload freshness, full type/unit/smoke/golden/prove-red gates, direct dry-run sync, and downloaded prerelease request/reply smoke. | all affected paths and staged Relay asset | 2 | `local` | Every local command exits as specified; prove-red commands fail with their exact marker; downloaded Relay reports 0.14.0 and performs correlated request/reply. |
| 4 | Commit the owned implementation and run a fresh exact-diff completion review, repairing at most once. | all affected paths; this plan | 3 | `local` | Matching CompletionReviewV1 passes for the exact unpublished public implementation commit and diff. |
| 5 | Verify target nonexistence, exact staged Relay release/assets/digests, and remote-main ancestry. | GitHub/npm read-only endpoints | 4 | `probe` | `cli-v0.12.0` and npm 0.12.0 are absent, Docks prerelease is exact, and public remote main equals execution parent; ambiguity/divergence STOP. |
| 6 | Fast-forward the reviewed public implementation and release `cli-v0.12.0` through the repository workflow. | public main/tag/GitHub release/npm | 5 | `release` | Exact implementation is remote; tag-triggered workflow succeeds; four docks-kit binaries plus SHA256SUMS, tag/commit identity, npm 0.12.0, and installer Relay pins are independently observed. |
| 7 | Record release verification, bind acceptance, finish/archive this child, and push/read back its exact archive checkpoint. | Verification Results; finished plan; public origin | 6 | `push` | Finished PlanRunV1, implementation/release/archive commits, tag, npm, asset digests, and Relay pins are repository-qualified and remotely readable. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| P1 | Focused four-file unit command | Closed manifest, four targets, exact 0.14.0 values, checksum/download agreement, staged smoke, atomic replacement, dry-run, and failure preservation pass. |
| P2 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; generated package version is 0.12.0 and embedded SoT bytes/hash are fresh. |
| P3 | `bun run typecheck && bun run test:unit` | Exit 0. |
| P4 | Normal dry-run/mutation goldens plus each `--prove-red` marker check | Normal gates pass; planted mismatch gates fail and print exact `prove-red OK` markers. |
| P5 | Direct `./docks-kit sync ... --dry-run --skip-rtk` for claude/codex and agents | Exit 0 and reports Relay 0.14.0/tag without mutating user state. |
| P6 | Download staged Relay Linux x64; compare SHA256SUMS; run `--version` and isolated request/reply | Digest matches the SoT candidate, version is 0.14.0, and correlated smoke succeeds. |
| P7 | GitHub release/workflow APIs and downloaded `cli-v0.12.0` assets | Sole tag push run succeeds; release has exactly four docks-kit binaries plus SHA256SUMS; four rows independently verify; no Windows. |
| P8 | Fresh mode-0700-cache `npm view docks-kit@0.12.0 version` | Returns exactly 0.12.0. |
| P9 | Current PlanRunV1 validator plus origin read-back | Finished archived child binds exact final manifest/Verification Results/completion review/commits/release and is remotely readable before Docks consumes it. |
| P10 | SHA-256 of legacy active plan | Remains `e0b1d183122def14a3f4bd6f05605c6aa7de3fb2dccf4330e8956acc3e0db9ff`. |

## Out of scope / do-NOT-touch

- Do not edit, migrate, resume, consume, abandon, delete, or rewrite the legacy 0.13 active plan, historical receipts/refs, old release/tag/assets, old finished plans, or old changelog entries.
- Do not guess hashes, add placeholders/Windows, hand-edit generated payload or golden JSON, broaden installer behavior without a frozen failing test, or modify deployed user configuration.
- Do not deploy, force-push, rebase around divergence, retag, replace release assets, or publish outside the exact public release recipe.

## STOP conditions

- Any target identity already exists, staged Relay asset count/hash/run identity is ambiguous, a new digest disagrees with SHA256SUMS, Windows appears, remote main/owned paths/index/HEAD change concurrently, or exact live external authority is absent.
- Red assertions were not observed against unchanged production bytes, fail for setup/harness reasons, or would need weakening after production edits.
- Payload/golden recorder freshness, type/unit/prove-red/dry-run/downloaded smoke, release workflow/assets/npm, completion review, or plan validator is not green.
- Release recovery would require force/delete/retag/reupload, the public child cannot be archived/read back, or Docks attempts stable promotion before this child is finished and pushed.

## Open questions

N/A — versions, target matrix, digest source, generator, release recipe, and cross-repository ordering are fixed.

## Review

Draft review invocation 1 ended in a pre-model transport failure; its bound failure digest is retained in PlanRunV1.

Draft review invocation 2:

Review-result: {"findings":[],"invocation":2,"plan_sha256":"340dfe9c67ce347ef9b94807c89409198e0bd7588864b30549c5baee5329afce","run_id":"1f801952-705e-4c7e-a533-91026c013383","schema":1,"source_sha256":"55839090880fd113a215e48ca766de2479ea4fc105bf49956d297a6f3d44909d","verdict":"pass"}

## Verification Results

Implementation evidence captured before completion review:

- TDD red at commit `424ee50f389215537e0dc09f490d1e4cf7c27276`: `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts` exited 1 with exactly three intended assertions: package 0.11.0 instead of 0.12.0 and Relay version/tag 0.13.0 instead of 0.14.0 in toolchain and engine output. Frozen test SHA-256 values are `d0a45c5eff566c28c73e55a64ec01ab09f9062063b497976980ffd23ed51c5ac` for `toolchain.test.ts` and `6772c685a13b26515e82cbd9213ef1b9a911bc69920e757bd8b29868ffe7f1cc` for `engine-di.test.ts`; both remained byte-identical after implementation.
- The independently downloaded `session-relay--v0.14.0` assets matched `SHA256SUMS`: Linux x64 `140ea11b700b307c07219616ca6e9b3c4fe552916871af54c3bb15712efd4ee3`, Linux arm64 `726aa5e4f112310a360ab0291600947404d885055844b2041d4f76b5fbeedd30`, macOS x64 `5cc8c7d77c5d93f2873841497171efd6ed3c981466625b0370817e094194e4f0`, and macOS arm64 `9256e96d0757f1ffbb2c7ee8aafa1b8bf5de7ee782ab85c30377a5d836ccee87`; `SHA256SUMS` itself hashed to `92b4f823278853ed4b33dd2adc416ebef6ab1431e8cfe40623641dd5912bddd8`.
- Implementation commit `88ab1911490edad83b387514bb8e899f02338d69` pins package 0.12.0 and Relay 0.14.0, regenerates the embedded payload, updates only recorder-owned goldens, and updates current documentation.
- Payload freshness exited 0. The focused four-file run passed 53 tests. `bun run typecheck` exited 0. The full unit suite passed 184 tests in 24 files. The POSIX statusline smoke passed exact bytes and latency ceilings. Normal dry-run and mutation goldens passed 25 and 71 cases.
- Both planted mismatch modes intentionally exited 1 with exact markers: `prove-red OK: golden-dryrun detected 25 planted mismatch(es)` and `prove-red OK: golden-mutation detected 68 planted mismatch(es)`.
- Direct `./docks-kit sync claude codex --dry-run --skip-rtk` and `./docks-kit sync agents --dry-run --skip-rtk` exited 0; the Claude/Codex path reported exact Relay 0.14.0/tag pins and neither command mutated user state.
- The downloaded Linux x64 Relay printed `session-relay 0.14.0`; an isolated schema-2 request from `11111111-1111-4111-8111-111111111111` to `22222222-2222-4222-8222-222222222222` produced correlation `17a6e6ab-959c-45f0-860e-3c872446426c`, and the requester drained the matching `terminal_reply` with status `completed`.
- The quarantined legacy plan remains SHA-256 `e0b1d183122def14a3f4bd6f05605c6aa7de3fb2dccf4330e8956acc3e0db9ff`.
- Completion review invocation 1 ended in pre-model transport failure `cb35df3daeaa424a7cdfce31ddccb5988969434060d8b7e839b301110a6ff9a1`; invocation 2 passed the exact implementation/diff with CompletionReviewV1 SHA-256 `8034b252d665e71271e932384318585e14cdc0f3ed9452e911a6136aff5739cb`.
- Public remote `main` and tag `cli-v0.12.0` both resolve to reviewed implementation `88ab1911490edad83b387514bb8e899f02338d69`. GitHub Actions release run `30183062456` completed successfully. Stable GitHub release database id `359900427` contains exactly four native binaries plus `SHA256SUMS` and no Windows asset.
- Independently downloaded release digests equal both GitHub asset metadata and checksum rows: Linux x64 `36ad0aa22143e60250dacb8fb93e0deb65588d2f6d613242d6ffc9c935701ea6`, Linux arm64 `95c962f850f9079b4abaab92a7a3b9dea2458f419e357fd72e88f8a7bd22a1b8`, macOS x64 `45e49bd53145dec422265123151566fe64032307d6a9c677b2f9074d7695ebd2`, macOS arm64 `7ad016621f6454bf9b4fb983088ff1d31a1b5bcd6228ade3c5abaf30f6ad33ea`; `SHA256SUMS` is `d040a0920120caebf53ec743f14c7665c3241ee5c8fc7828a951dd329cde8b21`.
- A downloaded Linux x64 binary printed `0.12.0` and its packaged `toolchain ensure session-relay` dry run reported exact Relay 0.14.0/tag pins. Fresh-cache `npm view docks-kit@0.12.0` returned version `0.12.0`, integrity `sha512-nbdTmhmhFfYYQtmuZdv8ZT3wspEsMcSeB1Q2i8uLjaWl5fph0oaohxVyjicTagB5LQjXSK4zRv4OfAEnOlTxoQ==`, and the expected registry tarball.
- All P1-P10 observations are now complete; this finished child is ready for archive commit and remote read-back before Docks consumes it.
