---
title: Release Session Relay CLI production pins
goal: Replace fixture Session Relay hashes with the four authorized production digests, prove the immutable cli-v0.9.0 release, and archive the superseded installer plan.
status: planned
created: "2026-07-18T19:47:14-03:00"
updated: "2026-07-18T21:15:38-03:00"
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
- npm read isolation: before every npm read, create a fresh cache with `NPM_READ_CACHE="$(mktemp -d /tmp/docks-npm-read.XXXXXX)"`, require `chmod 700 "$NPM_READ_CACHE"`, and invoke only that read as `NPM_CONFIG_CACHE="$NPM_READ_CACHE" npm ...`. Never reuse the default npm cache or a cache from another read.
- Pinned plan-review helper boundary for every draft, repair, and completion helper operation: use only `/home/vagrant/projects/docks/plugins/docks/skills/productivity/plan-review/scripts/review-policy.mjs` from Docks source commit `813c74bb3ffde67c8cb20688bfa377962b86314f`, whose exact file SHA-256 is `c75413803f18f3807bc288183dcbcf559e790a4ce6ffeb89fcb1614df817a1cc`. This pin covers canonical-plan rendering, current-schema generation, full/repair bundle sealing, bundle verification/destruction, reviewer-workspace prepare/cleanup, reviewer argv generation, reviewer-output/run/series/receipt validation, completion prepare/cleanup, and receipt reuse. Before each draft, repair, or completion review, re-run all three fail-closed checks: exact Docks `HEAD`, exact helper file hash, and a fresh `currentReviewerSchema()` traversal proving at least one `anyOf` key and zero `oneOf` keys. Invoke or import only that absolute source file for the whole review. The installed Codex cache helper under `/home/vagrant/.codex/plugins/cache/docks/docks/0.12.9/` is stale and forbidden for every operation.
- Primary Codex review launch, for every draft, repair, and completion attempt: after the pinned source helper's `reviewer-workspace-prepare <request-id> primary` returns its helper-owned reviewer workspace outside the Git worktree, create that attempt's unique home with `CODEX_HOME="$(mktemp -d "$REVIEWER_WORKSPACE/codex-home.XXXXXX")" && chmod 700 "$CODEX_HOME" && test "$(stat -c '%a' "$CODEX_HOME")" = 700`. Without printing, hashing, parsing, or logging any credential bytes, stage authentication only with `install -m 600 /home/vagrant/.codex/auth.json "$CODEX_HOME/auth.json"`, assert `test "$(stat -c '%a' "$CODEX_HOME/auth.json")" = 600`, and run `CODEX_HOME="$CODEX_HOME" codex login status`; a missing source credential, failed copy/mode assertion, or unavailable login aborts before reviewer launch. Then prefix the unchanged source-helper-derived argv with only `CODEX_HOME="$CODEX_HOME"` and attach the Codex process's stdin exactly from `/dev/null` with `</dev/null`; preserve all helper-derived model, effort, explicit `service_tier="default"`, `--ephemeral`, `--ignore-user-config`, `-s read-only`, sealed-bundle, output-schema, and policy arguments byte-for-byte. This exact noninteractive stdin attachment is mandatory even when the process is backgrounded to capture `child_id`; inherited stdin is forbidden. Whether preflight or launch succeeds or fails, invoke the matching pinned-source `reviewer-workspace-cleanup` and require it to remove the workspace, staged credential, and `CODEX_HOME` together. Never directly clean the home or credential, copy credentials into the repository or sealed bundle, retain a persistent copy, inherit stdin, or add another launch-environment override.
- Exact lifecycle invocations: after the release-preparation commit and Steps 1–3 are `done`, invoke `plan-manager complete docs/plans/active/session-relay-cli-production-release.md`; require `status: in_review`, `review_status: passed`, and one reusable `Completion-review-receipt:`. After all P1–P5 commands pass and Steps 4–5 are `done`, invoke `plan-manager ship docs/plans/active/session-relay-cli-production-release.md`; require the auto-committed destination `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md` with `status: finished` and the exact retained completion receipt. These are plan-manager skill invocations in the current Codex session, not shell aliases.
- Immediately before creating any local tag, run this fail-closed absence preflight from the repository root; only an exact `release not found` response is accepted for the GitHub Release absence:

```bash
set -euo pipefail
test -z "$(git tag --list cli-v0.9.0)"
test -z "$(git ls-remote --tags origin refs/tags/cli-v0.9.0)"
PUBLIC_PREFLIGHT_DIR="$(mktemp -d /tmp/docks-cli-preflight.XXXXXX)"
trap 'rm -rf -- "$PUBLIC_PREFLIGHT_DIR"' EXIT
if gh release view cli-v0.9.0 --repo DocksDocks/public >"$PUBLIC_PREFLIGHT_DIR/stdout" 2>"$PUBLIC_PREFLIGHT_DIR/stderr"; then
  exit 1
fi
test ! -s "$PUBLIC_PREFLIGHT_DIR/stdout"
grep -Fxq 'release not found' "$PUBLIC_PREFLIGHT_DIR/stderr"
```

- After the tag-only push, wait for the sole matching workflow run with `RUN_ID="$(gh run list --repo DocksDocks/public --workflow release-cli.yml --event push --limit 100 --json databaseId,headBranch --jq '[.[] | select(.headBranch == "cli-v0.9.0")] | if length == 1 then .[0].databaseId else error("expected exactly one cli-v0.9.0 run") end')" && gh run watch "$RUN_ID" --repo DocksDocks/public --exit-status`; do not start a second run.
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
- Finished plan path: exactly `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md`.
- Final reply fields: `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md <PUBLIC_RELEASE_COMMIT> <PUBLIC_PLAN_COMMIT> <sha256-of-the-exact-Completion-review-receipt-line>`.

### Release artifacts

The one `release-cli.yml` run for `cli-v0.9.0` must succeed at `PUBLIC_RELEASE_COMMIT`. The GitHub Release must contain exactly `SHA256SUMS`, four POSIX binaries (`docks-kit-linux-x64`, `docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`), and `docks-kit-windows-x64.exe`. `sha256sum -c SHA256SUMS` must validate all five binaries. P4's uniquely cached `npm view docks-kit@0.9.0 version` must return exactly `0.9.0`.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Supersede the blocked installer plan truthfully: move it to the dated finished path, set its terminal lifecycle fields, and append `Superseded by \`session-relay-cli-production-release\`` without changing its historical blocked/review evidence into a production-success claim. | `docs/plans/active/session-relay-cli-installation.md`; `docs/plans/finished/2026-07-18-session-relay-cli-installation.md` | — | planned | The active path is absent; the finished path retains the old evidence and explicitly says superseded, while no prose says the fixture-pin plan itself completed production publication. |
| 2 | Validate the canonical request hash/type/repository/version/tag/source identities, then replace exactly the four Session Relay asset digest values and regenerate the embedded payload. | `SoT/toolchain.json:24-30`; `cli/src/generated/sotPayload.ts` via `cli/scripts/generate-sot-payload.ts:38-74,126-175` | 1 | planned | A structural comparison proves every non-asset manifest field is unchanged, the four assets equal the request map exactly, no fixture digest remains, and generated-payload freshness passes. |
| 3 | Run ordered direct acceptance and the full public gate, commit the release-preparation implementation, mark Steps 1–3 done, and invoke exactly `plan-manager complete docs/plans/active/session-relay-cli-production-release.md`; retain the passed `Completion-review-receipt:` unchanged thereafter. | This plan lifecycle/status rows; affected implementation paths above | 1, 2 | planned | Completion review is `passed`; its exact receipt line names a valid `reviewed_head` that contains Steps 1–2, the four pins, and generated payload, and is an ancestor of current `HEAD`. |
| 4 | Derive and validate `PUBLIC_RELEASE_COMMIT` from the receipt; run the exact local-tag, remote-tag, and GitHub Release absence preflight in Environment & how-to-run; only then create lightweight tag `cli-v0.9.0` at exactly that commit, push only the tag, and run the exact single-run wait command. | Git tag and GitHub Actions only; no worktree file | 3 | planned | The preflight proves all three reuse surfaces absent before mutation; local/remote tag targets equal `PUBLIC_RELEASE_COMMIT`; exactly one matching run exists, has `headSha` equal to it, and concludes `success`. |
| 5 | Independently run P1–P5, then mark Steps 4–5 done and invoke exactly `plan-manager ship docs/plans/active/session-relay-cli-production-release.md` with its auto-commit. | This plan lifecycle/status rows; GitHub/npm read-only evidence | 4 | planned | All live proof commands pass; exact finished path `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md` retains the completion receipt; post-ship `PUBLIC_PLAN_COMMIT` is a different strict descendant of `PUBLIC_RELEASE_COMMIT`. |

## Acceptance criteria

The ordered completion inventory is exactly A1–A6. Production checks P1–P5 are in the separate `## Production verification` table and run only after the passed completion receipt and tag push; they are not part of the completion inventory or fabricated as pre-release completion evidence.

| ID | Command | Expected |
|---|---|---|
| A1 | `sha256sum /home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json` | Exit 0 and exact digest `a9eafbb16b72825b44be6cfa8819373b539ac4d0016028c2a01c4c6d0cb41ea1`. |
| A2 | `node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const request=JSON.parse(fs.readFileSync("/home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json","utf8")); assert.equal(request.type,"PublicReleaseRequestV1"); assert.equal(request.schema,1); assert.equal(request.repository_id,"DocksDocks/public"); assert.equal(request.version,"0.9.0"); assert.equal(request.tag,"cli-v0.9.0"); const current=JSON.parse(fs.readFileSync("SoT/toolchain.json","utf8")).tools["session-relay"]; const before=JSON.parse(execFileSync("git",["show","af01903d9e418abaee9beae014b2f9864be78a73:SoT/toolchain.json"],{encoding:"utf8"})).tools["session-relay"]; const {assets:currentAssets,...currentRest}=current; const {assets:beforeAssets,...beforeRest}=before; assert.deepEqual(currentRest,beforeRest); assert.deepEqual(currentAssets,request.assets); assert.equal(Object.keys(currentAssets).length,4); assert.equal(new Set(Object.values(currentAssets)).size,4); for(const digest of Object.values(currentAssets)) assert.match(digest,/^[0-9a-f]{64}$/);'` | Exit 0; the request identity and exactly four production pins match, with no unrelated manifest drift against `af01903d9e418abaee9beae014b2f9864be78a73:SoT/toolchain.json`. |
| A3 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; generated payload embeds current SoT and package `0.9.0`. |
| A4 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts` | Exit 0; closed manifest, exact target mapping, checksum/source agreement, atomic install, and plugin-order regressions remain green. |
| A5 | `./docks-kit sync claude codex --dry-run --skip-rtk && ./docks-kit sync agents --dry-run --skip-rtk` | Exit 0; Claude/Codex retain pinned CLI ensure before plugin work and agents-only does not enter that boundary. |
| A6 | `git diff --check` | Exit 0; release-preparation changes have no whitespace errors. |

## Production verification

Run P1–P5 exactly once and in order after the tag-only push and successful workflow wait. Each row is a complete exit-status assertion.

| ID | Command | Expected |
|---|---|---|
| P1 | `test "$PUBLIC_RELEASE_COMMIT" = "$(git rev-parse refs/tags/cli-v0.9.0)" && test "$(git ls-remote --exit-code origin refs/tags/cli-v0.9.0)" = "$(printf '%s\trefs/tags/cli-v0.9.0' "$PUBLIC_RELEASE_COMMIT")" && git merge-base --is-ancestor "$PUBLIC_RELEASE_COMMIT" HEAD` | Exit 0; the local and remote lightweight tag targets equal the 40-lowercase-hex `PUBLIC_RELEASE_COMMIT`, which is an ancestor of current `HEAD`. |
| P2 | `gh run list --repo DocksDocks/public --workflow release-cli.yml --event push --limit 100 --json databaseId,headBranch,headSha,status,conclusion,url \| jq -e --arg sha "$PUBLIC_RELEASE_COMMIT" '[.[] \| select(.headBranch == "cli-v0.9.0")] as $runs \| (($runs \| length) == 1 and $runs[0].headSha == $sha and $runs[0].status == "completed" and $runs[0].conclusion == "success")'` | Exit 0 and JSON boolean `true`; exactly one matching run exists, targets `PUBLIC_RELEASE_COMMIT`, is completed, and concluded success. |
| P3 | `PUBLIC_RELEASE_DIR="$(mktemp -d /tmp/docks-cli-release.XXXXXX)" && PUBLIC_RELEASE_META="$(mktemp /tmp/docks-cli-release-meta.XXXXXX)" && trap 'rm -rf -- "$PUBLIC_RELEASE_DIR"; rm -f -- "$PUBLIC_RELEASE_META"' EXIT && gh release view cli-v0.9.0 --repo DocksDocks/public --json tagName,isDraft,isPrerelease,assets,url >"$PUBLIC_RELEASE_META" && jq -e '(.tagName == "cli-v0.9.0") and (.isDraft == false) and (.isPrerelease == false) and (([.assets[].name] \| sort) == (["SHA256SUMS","docks-kit-darwin-arm64","docks-kit-darwin-x64","docks-kit-linux-arm64","docks-kit-linux-x64","docks-kit-windows-x64.exe"] \| sort))' "$PUBLIC_RELEASE_META" && gh release download cli-v0.9.0 --repo DocksDocks/public --dir "$PUBLIC_RELEASE_DIR" && diff -u <(printf '%s\n' SHA256SUMS docks-kit-darwin-arm64 docks-kit-darwin-x64 docks-kit-linux-arm64 docks-kit-linux-x64 docks-kit-windows-x64.exe \| sort) <(find "$PUBLIC_RELEASE_DIR" -maxdepth 1 -type f -printf '%f\n' \| sort) && (cd "$PUBLIC_RELEASE_DIR" && sha256sum -c SHA256SUMS)` | Exit 0; the published non-draft/non-prerelease Release has exactly the six named files and all five binary checksum rows pass. |
| P4 | `NPM_READ_CACHE="$(mktemp -d /tmp/docks-npm-read.XXXXXX)" && trap 'rm -rf -- "$NPM_READ_CACHE"' EXIT && chmod 700 "$NPM_READ_CACHE" && test "$(stat -c '%a' "$NPM_READ_CACHE")" = 700 && NPM_VERSION="$(NPM_CONFIG_CACHE="$NPM_READ_CACHE" npm view docks-kit@0.9.0 version)" && test "$NPM_VERSION" = 0.9.0` | Exit 0; exact registry version is `0.9.0` through a unique writable mode-`0700` cache under `/tmp`. |
| P5 | `SOURCE_RELEASE_DIR="$(mktemp -d /tmp/docks-session-relay-release.XXXXXX)" && trap 'rm -rf -- "$SOURCE_RELEASE_DIR"' EXIT && gh release download session-relay--v0.12.0 --repo DocksDocks/docks --dir "$SOURCE_RELEASE_DIR" --pattern SHA256SUMS --pattern 'session-relay-*' && diff -u <(printf '%s\n' SHA256SUMS session-relay-aarch64-apple-darwin session-relay-aarch64-unknown-linux-musl session-relay-x86_64-apple-darwin session-relay-x86_64-unknown-linux-musl \| sort) <(find "$SOURCE_RELEASE_DIR" -maxdepth 1 -type f -printf '%f\n' \| sort) && (cd "$SOURCE_RELEASE_DIR" && sha256sum -c SHA256SUMS) && SOURCE_RELEASE_DIR="$SOURCE_RELEASE_DIR" PUBLIC_RELEASE_COMMIT="$PUBLIC_RELEASE_COMMIT" node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict"; import {createHash} from "node:crypto"; import {execFileSync} from "node:child_process"; const request=JSON.parse(fs.readFileSync("/home/vagrant/.local/state/docks-release/session-relay-0.12.0/run.UA6vob/public-release-request.json","utf8")); const pins=JSON.parse(execFileSync("git",["show",`${process.env.PUBLIC_RELEASE_COMMIT}:SoT/toolchain.json`],{encoding:"utf8"})).tools["session-relay"].assets; const lines=fs.readFileSync(path.join(process.env.SOURCE_RELEASE_DIR,"SHA256SUMS"),"utf8").trim().split(/\r?\n/); assert.equal(lines.length,4); const actual={}; for(const line of lines){ const match=/^([0-9a-f]{64})\s+\*?(session-relay-(.+))$/.exec(line); assert.ok(match); const target=match[3]; assert.ok(Object.hasOwn(request.assets,target)); const bytes=fs.readFileSync(path.join(process.env.SOURCE_RELEASE_DIR,match[2])); assert.equal(createHash("sha256").update(bytes).digest("hex"),match[1]); actual[target]=match[1]; } assert.deepEqual(actual,request.assets); assert.deepEqual(actual,pins);'` | Exit 0; exactly four source binaries and `SHA256SUMS` were downloaded, all four file hashes pass, and the canonical rows, request digests, and `PUBLIC_RELEASE_COMMIT` pins agree exactly. |

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
- `--ignore-user-config` does not provide credentials or make Codex runtime state writable. Every primary Codex attempt needs its own helper-workspace-local mode-`0700` `CODEX_HOME`, a mode-`0600` `auth.json` copied only with `install -m 600`, and a successful `codex login status` under that home before launch; only helper cleanup may remove the staged credential and home.
- A background Codex child inherits the caller's stdin unless the launch redirects it. Every draft, repair, and completion primary launch must attach stdin exactly from `/dev/null` with `</dev/null`, including a background launch used to capture `child_id`; inherited stdin can make the unattended child fail before reviewer output with `stdin is not a terminal`.
- The installed Docks `0.12.9` plan-review helper still emits the API-forbidden `oneOf` candidate union. Never invoke, import, copy, or fall back to that cached helper; the pinned source commit/hash and freshly generated no-`oneOf`/has-`anyOf` schema are mandatory for each review.
- npm may try to write cache metadata even for `npm view`; every npm read must use its own mode-`0700` `/tmp/docks-npm-read.XXXXXX` cache.

## Global constraints

- Work only in the already assigned isolated worktree and branch; do not create or switch branches.
- Never modify live/production systems over SSH; all external release verification is read-only except the explicitly authorized tag push.
- Destructive or irreversible operations require parent approval; no force push, tag replacement, or branch push is authorized.
- Tag exactly `PUBLIC_RELEASE_COMMIT` as `cli-v0.9.0`; push the tag; wait for the single `release-cli.yml` run.
- `PUBLIC_RELEASE_COMMIT` must be 40 lowercase hex, contain implementation and digest pins, and be an ancestor of current `HEAD`.
- `PUBLIC_PLAN_COMMIT` must be the full post-ship `HEAD`, descend from and differ from `PUBLIC_RELEASE_COMMIT`.
- Every primary Codex attempt stages `/home/vagrant/.codex/auth.json` only as a mode-`0600` copy inside its unique mode-`0700` helper-workspace `CODEX_HOME`, verifies `codex login status` under that home before launch, sets only `CODEX_HOME` on the unchanged pinned-source-helper-derived reviewer argv, attaches the Codex process's stdin exactly from `/dev/null` with `</dev/null` even when backgrounded to capture `child_id`, and relies exclusively on helper cleanup to remove both copy and workspace; inherited stdin is forbidden, and credential bytes must never be printed, hashed, parsed, logged, copied into the repository/bundle, or persisted.
- Every draft, repair, and completion plan-review operation uses only the pinned Docks source helper path at commit `813c74bb3ffde67c8cb20688bfa377962b86314f` and file SHA-256 `c75413803f18f3807bc288183dcbcf559e790a4ce6ffeb89fcb1614df817a1cc`; immediately before each review, revalidate commit, hash, zero generated `oneOf` keys, and at least one generated `anyOf` key.
- Every npm read uses a unique writable mode-`0700` cache under `/tmp`; the default cache and previously used temp caches are forbidden.
- If any invariant, review, test, tag, workflow, Release, npm, or lifecycle operation fails, STOP and report; never fabricate final fields.
- Do not push the branch; the parent owns branch push.

## STOP conditions

- The request hash or any closed request identity differs from the values above.
- A primary Codex attempt cannot create its helper-workspace-local `CODEX_HOME`, stage the credential at mode `0600`, pass `codex login status`, preserve the pinned-source-helper-derived argv/policy unchanged, attach stdin exactly from `/dev/null`, or complete helper-owned cleanup; abort before launch when the preflight fails and never retry the same canonical input.
- The pinned Docks source helper commit/hash differs, its freshly generated current schema contains any `oneOf` key or no `anyOf` key, or any operation resolves to the installed `0.12.9` helper.
- The existing tag or Release `cli-v0.9.0` is present before authorized tag creation, or the tag cannot be proven to point exactly at the receipt-reviewed commit.
- Draft/completion review is unavailable, invalid, not ready, or does not yield a reusable passed receipt.
- Any A/P command fails, any later edit invalidates the reviewed implementation, or more/less than one matching release workflow run exists.
- GitHub Release assets/checksums, npm state, or live Session Relay checksums disagree with the request/pins.
- The old plan cannot be archived while preserving its historical evidence without a false production-completion statement.

## Cold-handoff checklist

- [x] File manifest: every worktree mutation names exact source/target paths; external tag/Release/npm surfaces are explicit.
- [x] Environment & commands: request path/hash, Bun/package versions, generator, setup, ordered acceptance, CI, production proof commands, unique writable npm caches, and helper-local `CODEX_HOME` review isolation are fixed.
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

Primary review (2026-07-18): [primary: openai gpt-5.6-sol high] blocking_gap — accepted P1,P2,P3,P4 / rejected none (all four blockers independently reproduced); [plan-manager openai codex gpt-5.6-sol high] independently reproduced accepted blocking ids P1,P2,P3,P4.

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

- **2026-07-18T20:00:47-03:00**: A prior canonical-review orchestration reached a nested Codex reviewer without a writable managed HOME and terminated before reviewer execution -> the launch environment omitted a writable runtime-home prerequisite even though the argv and sealed bundle were otherwise fixed -> never reuse that old canonical input; for each new primary Codex attempt create a unique mode-`0700` `CODEX_HOME` child inside the helper-created reviewer workspace and let only the helper clean it.
- **2026-07-18T20:00:47-03:00**: A later Claude orchestrator spawn failed OAuth before doing any plan or review work -> no review evidence or lifecycle authority resulted, and retrying that orchestration would not repair the Codex runtime-home prerequisite -> change and commit the canonical plan input first, then run the public plan-manager review over the new sealed input without routing around a terminal result.
- **2026-07-18T20:12:28-03:00**: The fresh primary review over plan input `c48fd71cb164af4eb13aa00e1ee5d3207391e5fa` used a writable isolated `CODEX_HOME` but had no staged authentication, so Codex terminated with HTTP 401 before emitting reviewer output; the candidate was exhausted and no review receipt, start, release, tag, or branch push occurred -> a writable runtime home is insufficient when it omits the authenticated state -> never retry that canonical input; every new primary Codex attempt must stage the source credential ephemerally at mode `0600`, prove `codex login status`, preserve only `CODEX_HOME` as the launch override, and let helper cleanup remove the copy with the workspace.
- **2026-07-18T20:19:18-03:00**: The first credential-staged review passed `codex login status` and preserved the helper-derived argv, but the API rejected the sealed schema with HTTP 400 `invalid_json_schema` because `oneOf` is forbidden at `policy.candidates.items`; no reviewer output was emitted -> the attempt ended `nonzero_exit` and remains terminal for that canonical input -> never retry that input or its installed `0.12.9` helper; only a changed, committed plan input reviewed through the exact pinned source helper may proceed.
- **2026-07-18T20:42:43-03:00**: The pinned source-helper/auth attempt at `7ce5938a4100d503f6d64e5a0674f1ff33c581e0` launched its background Codex child with inherited nonterminal stdin, so the child exited before reviewer output with `stdin is not a terminal`; no review receipt, start, release, tag, or push occurred -> helper, argv, and authentication correctness do not make a background launch noninteractive -> never retry that canonical input; every fresh draft, repair, or completion primary Codex process must preserve the same pinned source helper/argv/auth rules and attach stdin exactly from `/dev/null`, including when backgrounded to capture `child_id`.
