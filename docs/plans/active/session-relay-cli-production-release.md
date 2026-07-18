---
title: Release Session Relay CLI production pins
goal: Replace fixture Session Relay hashes with the four authorized production digests, prove the immutable cli-v0.9.0 release, and archive the superseded installer plan.
status: planned
created: "2026-07-18T19:47:14-03:00"
updated: "2026-07-18T19:47:14-03:00"
started_at: null
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: high
review_waivers: []
tags: [session-relay, toolchain, release, supply-chain]
affected_paths:
  - SoT/toolchain.json
  - cli/src/generated/sotPayload.ts
  - docs/plans/active/session-relay-cli-installation.md
  - docs/plans/finished/2026-07-18-session-relay-cli-installation.md
related_plans:
  - docs/plans/active/session-relay-cli-installation.md
  - /home/vagrant/projects/docks/docs/plans/finished/2026-07-18-session-relay-prebuilt-cli-distribution.md
review_status: null
planned_at_commit: 0616e5bb50e064ba6f009c161678f5a7d99ca479
execution_base_commit: null
---

# Release Session Relay CLI production pins

## Goal

Prepare one immutable public release commit that replaces the four fixture-only Session Relay `0.12.0` hashes with the exact authorized production digests, regenerates the embedded SoT, and archives the blocked installer plan as superseded without claiming that it completed production publication. After a passed completion review binds that commit, tag exactly that reviewed commit as `cli-v0.9.0`, push only the tag, prove the single release workflow, GitHub Release, six artifacts/checksums, npm publication, and live digest agreement, then ship this plan in a distinct later plan-only commit.

## Context & rationale

The canonical `PublicReleaseRequestV1` at `/home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json` has SHA-256 `a9eafbb16b72825b44be6cfa8819373b539ac4d0016028c2a01c4c6d0cb41ea1`. It authorizes repository `DocksDocks/public`, version/tag `0.9.0` / `cli-v0.9.0`, companion base `c3b542220d5a24a98ca05383bbe28afc2319b7e2`, and source tag `session-relay--v0.12.0` at `00284a84acb96d64b357a083258177fca239428f`. The request is the only authority for the four digest substitutions.

The existing installer implementation and blocked plan already establish closed target mapping, same-release `SHA256SUMS` agreement, staged smoke testing, atomic replacement, and failure preservation. This plan changes no installer code. It closes only the fixture-to-production handoff, while retaining historical truth: `session-relay-cli-installation.md` was a blocked implementation/validation plan and is archived as **superseded**, not rewritten as a successfully published production plan.

Release identity is deliberately split. `PUBLIC_RELEASE_COMMIT` is read from the exact `Completion-review-receipt:` line's `reviewed_head`; it must be 40 lowercase hex, contain the digest-pin/generated-payload/supersession implementation, and be an ancestor of current `HEAD`. The lightweight tag points exactly there. `PUBLIC_PLAN_COMMIT` is the full post-ship `HEAD`, must differ from and descend from `PUBLIC_RELEASE_COMMIT`, and contains the finished plan plus the retained completion receipt. No branch push is part of this plan.

The user-directed lifecycle has two phases: Steps 1–3 are the implementation slice reviewed by `complete`; Steps 4–5 are post-completion production closure. Their status changes are lifecycle bookkeeping after live proof and do not rewrite the reviewed implementation or receipt.

## Environment & how-to-run

- Repository/worktree: assigned isolated `DocksDocks/public` relay worktree; do not create or switch branches.
- Request: `/home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json`; verify with `sha256sum` before using it.
- Runtime pins: Bun `1.3.14` from `SoT/toolchain.json`; package version `0.9.0`; Vitest through `bun run test:unit`; GitHub operations through authenticated `gh`; npm read-back through `npm view`.
- Generated payload: `bun cli/scripts/generate-sot-payload.ts`, then `bun cli/scripts/generate-sot-payload.ts --check`.
- Disposable completion checkout setup: `bun install --frozen-lockfile` before acceptance or CI.
- Project CI command, run exactly once by completion after the ordered acceptance inventory:

```bash
set -euo pipefail
bun cli/scripts/generate-sot-payload.ts --check
bun run typecheck
bun run test:unit
bun cli/test/statusline-runtime-smoke.mjs posix
bun run golden:dryrun
dry_out="$(bun run golden:dryrun --prove-red 2>&1)" && exit 1 || true
printf '%s\n' "$dry_out" | grep -q 'prove-red OK: golden-dryrun'
bun run golden:mutation
mutation_out="$(bun run golden:mutation --prove-red 2>&1)" && exit 1 || true
printf '%s\n' "$mutation_out" | grep -q 'prove-red OK: golden-mutation'
```

## Interfaces & data shapes

### Canonical request boundary

The request is closed to `PublicReleaseRequestV1` schema `1`. Its exact asset map is:

```json
{
  "aarch64-apple-darwin": "5022354025d0c639406cf8b027d824724d8366f74e2b778c37d705e7e9f53889",
  "aarch64-unknown-linux-musl": "d7171bbaa33c4da8b0a9e15f9bfe7a3fb31930a1fad95cc9f682f153369b421b",
  "x86_64-apple-darwin": "be12a6f782453d8cc90d98ab77f408f0e7c61b55f8ccdf36bf0584c8cec2f1d8",
  "x86_64-unknown-linux-musl": "ead7faead73ba5835879e4823bc4bca6b6d1003d8a9bcbdbea6cf9f266ce5b42"
}
```

`SoT/toolchain.json` retains every `tools["session-relay"]` field and target key; only these four string values change. `cli/src/generated/sotPayload.ts` is generator-owned and must embed those exact source bytes.

### Release and plan identities

- `PUBLIC_RELEASE_COMMIT`: exact `reviewed_head` parsed from the one compact-JCS `Completion-review-receipt:` line; regex `^[0-9a-f]{40}$`; implementation/digest-pin tree; tag target.
- `PUBLIC_PLAN_COMMIT`: exact full `git rev-parse HEAD` after plan-manager `ship`; regex `^[0-9a-f]{40}$`; strict descendant of and unequal to `PUBLIC_RELEASE_COMMIT`.
- Final reply fields: `<finished-plan-path> <PUBLIC_RELEASE_COMMIT> <PUBLIC_PLAN_COMMIT> <sha256-of-the-exact-Completion-review-receipt-line>`.

### Release artifacts

The one `release-cli.yml` run for `cli-v0.9.0` must succeed at `PUBLIC_RELEASE_COMMIT`. The GitHub Release must contain exactly `SHA256SUMS`, four POSIX binaries (`docks-kit-linux-x64`, `docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`), and `docks-kit-windows-x64.exe`. `sha256sum -c SHA256SUMS` must validate all five binaries. `npm view docks-kit@0.9.0 version` must return exactly `0.9.0`.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Supersede the blocked installer plan truthfully: move it to the dated finished path, set its terminal lifecycle fields, and append `Superseded by \`session-relay-cli-production-release\`` without changing its historical blocked/review evidence into a production-success claim. | `docs/plans/active/session-relay-cli-installation.md`; `docs/plans/finished/2026-07-18-session-relay-cli-installation.md` | — | planned | The active path is absent; the finished path retains the old evidence and explicitly says superseded, while no prose says the fixture-pin plan itself completed production publication. |
| 2 | Validate the canonical request hash/type/repository/version/tag/source identities, then replace exactly the four Session Relay asset digest values and regenerate the embedded payload. | `SoT/toolchain.json:24-30`; `cli/src/generated/sotPayload.ts` via `cli/scripts/generate-sot-payload.ts:38-74,126-175` | 1 | planned | A structural comparison proves every non-asset manifest field is unchanged, the four assets equal the request map exactly, no fixture digest remains, and generated-payload freshness passes. |
| 3 | Run ordered direct acceptance and the full public gate, commit the release-preparation implementation, mark Steps 1–3 done, and invoke plan-manager `complete`; retain the passed `Completion-review-receipt:` unchanged thereafter. | This plan lifecycle/status rows; affected implementation paths above | 1, 2 | planned | Completion review is `passed`; its exact receipt line names a valid `reviewed_head` that contains Steps 1–2, the four pins, and generated payload, and is an ancestor of current `HEAD`. |
| 4 | Derive and validate `PUBLIC_RELEASE_COMMIT` from the receipt, create lightweight tag `cli-v0.9.0` at exactly that commit, push only the tag, and wait for exactly one `release-cli.yml` run for that tag. | Git tag and GitHub Actions only; no worktree file | 3 | planned | Local/remote tag targets equal `PUBLIC_RELEASE_COMMIT`; exactly one matching run exists, has `headSha` equal to it, and concludes `success`. |
| 5 | Independently verify the live Release, six assets/checksums, npm `0.9.0`, source Release checksum agreement with all four request/pinned digests, then mark Steps 4–5 done and run plan-manager `ship` with auto-commit. | This plan lifecycle/status rows; GitHub/npm read-only evidence | 4 | planned | All live proof commands pass; finished plan retains the exact completion receipt; post-ship `PUBLIC_PLAN_COMMIT` is a different strict descendant of `PUBLIC_RELEASE_COMMIT`. |

## Acceptance criteria

The ordered completion inventory is A1–A6. Production checks P1–P5 run only after the passed completion receipt and tag push; they are not fabricated as pre-release completion evidence.

| ID | Command | Expected |
|---|---|---|
| A1 | `sha256sum /home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json` | Exit 0 and exact digest `a9eafbb16b72825b44be6cfa8819373b539ac4d0016028c2a01c4c6d0cb41ea1`. |
| A2 | `node -e '<read request and SoT JSON; require PublicReleaseRequestV1/schema 1/repository DocksDocks/public/version 0.9.0/tag cli-v0.9.0; require deep equality of request.assets and tools["session-relay"].assets; require exactly four keys and four distinct lowercase-hex digests; require all other Session Relay manifest fields equal the pre-change reviewed manifest>'` | Exit 0; the request identity and exactly four production pins match, with no unrelated manifest drift. The executor must materialize the pre-change manifest from `af01903d9e418abaee9beae014b2f9864be78a73:SoT/toolchain.json`, not from memory. |
| A3 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; generated payload embeds current SoT and package `0.9.0`. |
| A4 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts` | Exit 0; closed manifest, exact target mapping, checksum/source agreement, atomic install, and plugin-order regressions remain green. |
| A5 | `./docks-kit sync claude codex --dry-run --skip-rtk && ./docks-kit sync agents --dry-run --skip-rtk` | Exit 0; Claude/Codex retain pinned CLI ensure before plugin work and agents-only does not enter that boundary. |
| A6 | `git diff --check` | Exit 0; release-preparation changes have no whitespace errors. |
| P1 | `git show-ref --verify refs/tags/cli-v0.9.0 && git ls-remote --exit-code origin refs/tags/cli-v0.9.0` | Both resolve exactly to `PUBLIC_RELEASE_COMMIT`, which is 40 lowercase hex and an ancestor of current `HEAD`. |
| P2 | `gh run list --workflow release-cli.yml --event push --json databaseId,headBranch,headSha,status,conclusion,url` | Filtering exact `headBranch == "cli-v0.9.0"` yields exactly one run; `headSha == PUBLIC_RELEASE_COMMIT`, `status == completed`, `conclusion == success`. |
| P3 | `gh release view cli-v0.9.0 --json tagName,isDraft,isPrerelease,assets,url` plus `gh release download cli-v0.9.0 --dir <fresh-mktemp-dir>` and `(cd <dir> && sha256sum -c SHA256SUMS)` | Release is published, not draft/prerelease, has exactly the six named assets, and all five checksum rows pass. |
| P4 | `npm view docks-kit@0.9.0 version` | Exact stdout `0.9.0`; absence, another version, or registry failure is STOP. |
| P5 | `curl -fsSL https://github.com/DocksDocks/docks/releases/download/session-relay--v0.12.0/SHA256SUMS` plus structural comparison against the canonical request, `SoT/toolchain.json` at `PUBLIC_RELEASE_COMMIT`, and the four named Session Relay assets | Exactly one canonical checksum row per asset; every row equals the corresponding request and released public pin. |

## Out of scope / do-NOT-touch

- Do not change installer/runtime behavior, tests, goldens, workflow YAML, package version, lockfile, documentation prose, or any toolchain entry other than the four Session Relay digest strings.
- Do not amend, retarget, force-update, or reuse an existing `cli-v0.9.0`; any pre-existing local/remote tag or extra matching workflow run is STOP.
- Do not push the branch or `main`; the parent session owns branch publication. Push only the new tag after the receipt invariant passes.
- Do not edit the Docks repository, its Release, or npm; those are read-only proof sources after the public tag triggers its canonical workflow.
- Do not claim the superseded installer plan completed production release; preserve its historical blocked boundary and evidence.

## Known gotchas

- `cli/src/generated/sotPayload.ts` is derived. Hand-editing it or forgetting regeneration creates source/binary drift.
- The release workflow deliberately downgrades npm publish failure to a warning; workflow success alone is not npm proof, so P4 is mandatory.
- `gh release create ... || true` means an old Release could be reused; the pre-existing tag/Release check and exactly-one-run invariant prevent accidental reuse from being accepted.
- Plan-only receipt/start/ship commits may make current `HEAD` differ from `PUBLIC_RELEASE_COMMIT`; the tag must use the receipt's exact `reviewed_head`, never ambient `HEAD`.
- The source Session Relay Release has five assets, whereas the public docks-kit Release must have six; do not conflate the inventories.
- `Completion-review-receipt:` is one exact line. Hash the full line bytes including the literal label and payload, excluding the terminating newline.

## Global constraints

- Work only in the already assigned isolated worktree and branch; do not create or switch branches.
- Never modify live/production systems over SSH; all external release verification is read-only except the explicitly authorized tag push.
- Destructive or irreversible operations require parent approval; no force push, tag replacement, or branch push is authorized.
- Tag exactly `PUBLIC_RELEASE_COMMIT` as `cli-v0.9.0`; push the tag; wait for the single `release-cli.yml` run.
- `PUBLIC_RELEASE_COMMIT` must be 40 lowercase hex, contain implementation and digest pins, and be an ancestor of current `HEAD`.
- `PUBLIC_PLAN_COMMIT` must be the full post-ship `HEAD`, descend from and differ from `PUBLIC_RELEASE_COMMIT`.
- If any invariant, review, test, tag, workflow, Release, npm, or lifecycle operation fails, STOP and report; never fabricate final fields.
- Do not push the branch; the parent owns branch push.

## STOP conditions

- The request hash or any closed request identity differs from the values above.
- The existing tag or Release `cli-v0.9.0` is present before authorized tag creation, or the tag cannot be proven to point exactly at the receipt-reviewed commit.
- Draft/completion review is unavailable, invalid, not ready, or does not yield a reusable passed receipt.
- Any A/P command fails, any later edit invalidates the reviewed implementation, or more/less than one matching release workflow run exists.
- GitHub Release assets/checksums, npm state, or live Session Relay checksums disagree with the request/pins.
- The old plan cannot be archived while preserving its historical evidence without a false production-completion statement.

## Cold-handoff checklist

- [x] File manifest: every worktree mutation names exact source/target paths; external tag/Release/npm surfaces are explicit.
- [x] Environment & commands: request path/hash, Bun/package versions, generator, setup, ordered acceptance, CI, and production proof commands are fixed.
- [x] Interface & data contracts: closed request, four target/digest pairs, two commit identities, final reply, and six-asset inventory are exact.
- [x] Executable acceptance: A1–A6 are ordered completion rows; P1–P5 are explicit post-completion live proof rows.
- [x] Out of scope: branch push, workflow/runtime edits, producer/npm mutation, and false superseded-plan claims are prohibited.
- [x] Decision rationale: receipt-derived tag identity, distinct plan identity, and post-completion production closure are explained.
- [x] Known gotchas: generated payload, optional npm warning, Release reuse, identity split, and receipt-line hashing are recorded.
- [x] Global constraints: the user-supplied worktree, tag, ancestry, lifecycle, STOP, and no-branch-push requirements are copied.
- [x] No undefined terms/forward refs: every commit variable, request, artifact, workflow, and proof surface is defined in this file.

## Self-review

- `standalone_executability`: pass — a cold executor has the exact request authority, paths, lifecycle order, commands, and terminal response contract.
- `actionability`: pass — each mutation and external operation has a bounded step, dependency, and binary done condition.
- `dependency_order`: pass — review binds implementation before tag creation; production evidence precedes final step closure and ship.
- `evidence_reverification`: pass — request hash, baseline manifest, receipt-reviewed commit, remote tag, workflow head, Release assets, npm, and source checksums are independently re-read.
- `goal_coverage`: pass — fixture replacement, payload regeneration, truthful supersession, release, live verification, and distinct post-ship identity are all represented.
- `executable_acceptance`: pass — A1–A6 plus project CI cover completion; P1–P5 cover all live proof requirements.
- `failure_modes`: pass — pre-existing tags/releases, extra workflow runs, npm's warning downgrade, stale payload, identity drift, and checksum disagreement are named STOPs.
- `open_questions`: pass — the canonical request and user instructions fix every material choice; no unresolved decision remains.

## Review

(filled by plan-manager from plan-review evidence on completion)

## Sources

- `/home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json` — canonical closed request supplies the release/tag/source identities and exactly four production digests.
- `SoT/toolchain.json:24-30` — current Session Relay entry has exactly four identical fixture values and no other production field to change.
- `cli/scripts/generate-sot-payload.ts:38-74,126-175` — SoT bytes feed the payload hash/generated module and `--check` detects drift.
- `.github/workflows/release-cli.yml:10-66` — `cli-v*` tag push builds five binaries, uploads them with `SHA256SUMS`, then attempts npm OIDC publication.
- `.github/workflows/parity.yml:19-76` — Linux public gate defines dependency setup, payload, unit/runtime, golden, and prove-red requirements.
- `cli/src/engine-native/sessionRelayCli.ts:14-46,62-104,123-224` — runtime pins the closed source tag/targets and requires source/checksum/download agreement before atomic replacement.
- `docs/plans/active/session-relay-cli-installation.md` — superseded historical plan records the fixture-only validation boundary and must not be rewritten as production success.

## Notes

- Canonical PublicReleaseRequestV1 SHA-256: `a9eafbb16b72825b44be6cfa8819373b539ac4d0016028c2a01c4c6d0cb41ea1`.
- No branch push is authorized.

## Mistakes & Dead Ends

None.
