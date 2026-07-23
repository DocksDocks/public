---
title: Prepare Session Relay CLI 0.13.0 source
goal: Decouple the installer from 0.12.0 using fixture-only 0.13.0 tests, seal an immutable validation identity, and remain blocked until four production digests exist.
status: planned
created: "2026-07-22T23:07:51-03:00"
updated: "2026-07-22T23:22:45-03:00"
started_at: null
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: high
review_waivers: []
tags: [session-relay, installer, release-preparation, supply-chain]
affected_paths:
  - cli/src/engine-native/sessionRelayCli.ts
  - cli/test/unit/sessionRelayCli.test.ts
  - cli/test/unit/pluginRefresh.test.ts
related_plans:
  - /home/vagrant/projects/docks/docs/plans/active/session-relay-linux-workspace-release.md
  - docs/plans/finished/2026-07-18-session-relay-cli-installation.md
  - docs/plans/finished/2026-07-18-session-relay-cli-production-release.md
review_status: null
planned_at_commit: 6f9691cc19349ccd0ce81e8c8bf5cc573f76f3f1
execution_base_commit: null
---

# Prepare Session Relay CLI 0.13.0 source

## Goal

Prepare independently reviewable `DocksDocks/public` source for Session Relay `0.13.0` without publishing or guessing production hashes. Frozen fixture tests must prove that the installer accepts a closed `0.13.0` manifest and derives every version-coupled check/output from that manifest, while the production `SoT/toolchain.json` entry and generated payload remain pinned byte-for-byte to `0.12.0`. Capture the clean implementation-source commit, apply the exact plan-only blocked transition, and then bind those blocked plan bytes to one create-once validation ref until a later, separately reviewed publication plan supplies four independently hashed `session-relay--v0.13.0` assets.

## Context & rationale

The reviewed Docks source-preparation plan at `/home/vagrant/projects/docks/docs/plans/active/session-relay-linux-workspace-release.md` requires an independently reviewed public companion identity before Docks seals its `0.13.0` candidate. This plan prepares only the installer source seam. It deliberately separates “the installer can consume a future exact version” from “the future version is authorized for production.”

`cli/src/engine-native/sessionRelayCli.ts` currently declares module constants `VERSION = "0.12.0"` and `TAG = "session-relay--v0.12.0"`. Those constants constrain manifest parsing, stable/staged `--version` checks, error text, and success output even when a test supplies a different closed manifest. The safe cut is not to loosen the manifest. Instead, validate one canonical stable SemVer from `manifest.verified`, derive the only accepted tag and plugin version from it, and pass that same validated value to all smoke/log paths. Repository, plugin id, install path, four target keys, digest grammar, same-release checksum agreement, and atomic replacement remain exact.

The production pin must not move during source preparation because the four real `0.13.0` asset digests do not exist yet. `SoT/toolchain.json` therefore remains the production authority for `0.12.0`, and `cli/src/generated/sotPayload.ts` remains unchanged. Only test-owned fixture manifests exercise `0.13.0`. This gives Docks reviewable source evidence without creating an installable production claim.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, repository id `DocksDocks/public`, on a clean worktree.
- Runtime: Bun `1.3.14` from `SoT/toolchain.json`; Vitest `3.2.7`; TypeScript `7.0.2`.
- Install dependencies when a disposable checkout lacks them: `bun install --frozen-lockfile`.
- Canonical frozen tests: exactly `cli/test/unit/sessionRelayCli.test.ts` and `cli/test/unit/pluginRefresh.test.ts`.
- Canonical focused command: exactly `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts`.
- Canonical red-capture helper: `/home/vagrant/projects/docks/scripts/capture-tdd-red.mjs`.
- Exact blocked reason: `Awaiting the four independently hashed \`session-relay--v0.13.0\` production asset digests.`
- Immutable validation ref: `refs/heads/preflight/session-relay-cli-0.13.0-<first 12 hex of PUBLIC_COMMIT>`.
- Project CI command, run once after A1–A4 pass and before `SOURCE_COMMIT` is captured:

```bash
set -euo pipefail
bun cli/scripts/generate-sot-payload.ts --check
bun run test:unit
bun cli/test/statusline-runtime-smoke.mjs posix
bun run golden:dryrun
dry_out="$(bun run golden:dryrun --prove-red 2>&1)" && exit 1 || true
printf '%s\n' "$dry_out" | grep -q 'prove-red OK: golden-dryrun'
bun run golden:mutation
mutation_out="$(bun run golden:mutation --prove-red 2>&1)" && exit 1 || true
printf '%s\n' "$mutation_out" | grep -q 'prove-red OK: golden-mutation'
```

The ordered acceptance inventory below intentionally does not duplicate this full project CI command; public plan-manager completion runs the recorded project CI command separately once under the local plan contract.

## Interfaces & data shapes

### Closed manifest and single version authority

Keep the exported boundary names unchanged:

```ts
export interface SessionRelayManifest {
  readonly kind: "managed-release"
  readonly policy: "exact"
  readonly verified: string
  readonly repository: "DocksDocks/docks"
  readonly tag: string
  readonly plugin_id: "session-relay@docks"
  readonly plugin_version: string
  readonly install_path: "~/.local/bin/session-relay"
  readonly assets: Readonly<Record<SessionRelayTarget, string>>
}

export function parseSessionRelayManifest(text: string): SessionRelayManifest
export function installSessionRelayCli(
  input: SessionRelayInstallInput,
  ops?: SessionRelayInstallOps
): void
```

`parseSessionRelayManifest` must implement this exact relationship:

```text
version = manifest.verified
version grammar = canonical stable SemVer core only:
  (0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)
expected tag = "session-relay--v" + version
expected plugin_version = version
expected repository = "DocksDocks/docks"
expected plugin_id = "session-relay@docks"
expected install_path = "~/.local/bin/session-relay"
expected targets = {
  x86_64-unknown-linux-musl,
  aarch64-unknown-linux-musl,
  x86_64-apple-darwin,
  aarch64-apple-darwin
}
digest grammar = exactly 64 lowercase hexadecimal characters
```

The parser still rejects every missing/extra top-level or target key, malformed version/digest, mismatched derived tag/plugin version, substituted repository/plugin/install path, or unsupported target. It returns the validated version and derived exact values. `exactVersion` receives that version explicitly; the stable short-circuit, staged smoke error, dry-run line, and ready log all use the same `manifest.verified`. No ambient package version or second version constant may participate.

`sessionRelayTarget`, `SessionRelayInstallInput`, `SessionRelayInstallOps`, URL/asset derivation, checksum-row grammar, source-pin = checksum-row = downloaded-bytes equality, `0755` staged chmod, sibling staging, atomic rename, and failure-preserving cleanup remain unchanged.

### Production-versus-fixture boundary

At `planned_at_commit`, production is exactly:

```text
SoT/toolchain.json tools["session-relay"].verified = "0.12.0"
SoT/toolchain.json tools["session-relay"].tag = "session-relay--v0.12.0"
SoT/toolchain.json tools["session-relay"].plugin_version = "0.12.0"
```

All four existing production `0.12.0` digests remain unchanged. `cli/src/generated/sotPayload.ts` remains generator-current and byte-identical across `execution_base_commit..SOURCE_COMMIT`; the later plan-only `SOURCE_COMMIT..PUBLIC_COMMIT` range cannot change it. The `0.13.0` value and any deterministic digest used before publication exist only inside test fixture construction in `cli/test/unit/sessionRelayCli.test.ts`. `cli/test/unit/pluginRefresh.test.ts` reads or derives its ensure marker from the current production SoT rather than hard-coding a future version, so its dry-run integration continues to prove production `0.12.0` ordering.

### TDD receipt byte lifecycle

After a passed draft review and the two plan-only start identity commits, but before the first production-source edit:

1. Update and commit the two frozen test paths. `sessionRelayCli.test.ts` uses a closed fixture version/tag/plugin-version of `0.13.0`; `pluginRefresh.test.ts` removes its literal production-version coupling while preserving the exact Claude-before-plugin, Codex-before-plugin, and agents-only-negative assertions. Record this clean commit as `PRE_PRODUCTION_COMMIT`. Do not edit either test after this commit.
2. Create a persistent owner-only receipt directory and a nonexistent direct-child output:

```bash
set -euo pipefail
umask 077
RECEIPT_ROOT="${XDG_STATE_HOME:-$HOME/.local/state}/docks-release/session-relay-0.13.0"
install -d -m 700 "$RECEIPT_ROOT"
RECEIPT_DIR="$(mktemp -d "$RECEIPT_ROOT/public-preparation.XXXXXX")"
RECEIPT_DIR="$(realpath -e -- "$RECEIPT_DIR")"
chmod 700 "$RECEIPT_DIR"
test "$(stat -Lc '%a' -- "$RECEIPT_DIR")" = 700
test "$(stat -Lc '%u' -- "$RECEIPT_DIR")" = "$(id -u)"
PUBLIC_RED_PATH="$RECEIPT_DIR/public-red.json"
test ! -e "$PUBLIC_RED_PATH"
PRE_PRODUCTION_COMMIT="$(git rev-parse HEAD)"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

3. Capture exactly one canonical red receipt with both frozen blobs and the exact command:

```bash
CAPTURE_SHA256="$(node /home/vagrant/projects/docks/scripts/capture-tdd-red.mjs \
  --repo /home/vagrant/projects/public \
  --repository-id DocksDocks/public \
  --pre-production-commit "$PRE_PRODUCTION_COMMIT" \
  --test cli/test/unit/sessionRelayCli.test.ts \
  --test cli/test/unit/pluginRefresh.test.ts \
  --receipt-out "$PUBLIC_RED_PATH" \
  -- bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts)"
```

The helper succeeds only when the focused command exits nonzero, both working test blobs equal their tracked blobs at `PRE_PRODUCTION_COMMIT`, and it exclusively creates mode-`0600`, no-trailing-newline RFC 8785 JCS bytes for one closed `TddRedReceiptV1`. Require `CAPTURE_SHA256` to be 64 lowercase hex, `sha256sum "$PUBLIC_RED_PATH"` to equal it, the file to be nonempty and mode `0600`, the receipt `pre_production_commit` and sorted `test_paths` to match, and the failure to be the intended missing manifest-derived `0.13.0` behavior rather than setup, signal, timeout, or unrelated failure.
4. Public plan-manager copies the exact file bytes without parse/reserialize/newline immediately after the literal prefix `Public TDD-red receipt JCS bytes: ` and records the adjacent `Public TDD-red receipt SHA-256: ` prefix followed by `CAPTURE_SHA256`. It commits that plan-only evidence before `sessionRelayCli.ts` changes. Read the committed substring back and prove byte/hash equality. Never overwrite, regenerate, normalize, or conversationally reconstruct the receipt. Retain the original no-clobber file until Docks has materialized and bound the same bytes.
5. At `SOURCE_COMMIT`, require each frozen test blob id to equal its `TddRedReceiptV1.test_paths[].blob_id`, require `PRE_PRODUCTION_COMMIT` to be a strict ancestor, and require the focused command to exit zero. Any needed frozen-test edit invalidates the receipt and is a STOP, not an invitation to recapture silently.

### Immutable identities consumed by Docks

Public plan-manager owns the lifecycle writes and machine records. Docks records and independently verifies this exact tuple:

```text
repository_id = DocksDocks/public
plan_path = docs/plans/active/session-relay-cli-0.13.0-release-preparation.md
plan_input_sha256 = passed draft Review-receipt.input_sha256
execution_base_commit = frontmatter execution_base_commit
review_receipt_sha256 = SHA-256 of the exact compact-JCS payload bytes after "Review-receipt: "
red_receipt_bytes = exact bytes after "Public TDD-red receipt JCS bytes: "
red_receipt_sha256 = adjacent SHA-256 and SHA-256(red_receipt_bytes)
validation_ref = refs/heads/preflight/session-relay-cli-0.13.0-<PUBLIC_COMMIT first12>
commit = PUBLIC_COMMIT, the exact full ref tip
status = blocked
blocked_reason = Awaiting the four independently hashed `session-relay--v0.13.0` production asset digests.
```

`plan_input_sha256` is the canonical input accepted by the passed pre-execution draft review; later manager-owned receipt/lifecycle evidence does not redefine that review identity. The draft `Review-receipt:` must be the one canonical passed schema-6 receipt produced by public plan-manager, and its `reviewed_commit` must be an ancestor of `execution_base_commit`. `execution_base_commit` is the exact first-start transition commit recorded by the required second plan-only identity commit.

`SOURCE_COMMIT` is captured only after implementation, A1–A4, and the separate full project CI gate pass on a clean worktree. Public plan-manager then applies the exact block transition in one plan-only commit: `status: blocked`, quoted `blocked_reason` above, non-null quoted `blocked_since`, bumped `updated`, unchanged `started_at`, and unchanged `execution_base_commit`. That blocked descendant is `PUBLIC_COMMIT`; the create-once validation ref is derived from and resolves exactly to it. Docks therefore fetches one immutable commit whose plan bytes already carry the independently reviewed input identity, execution base, receipt evidence, red evidence, exact blocked status, and exact reason. `SOURCE_COMMIT` remains the distinct clean implementation-source identity used to prove the intervening plan-only block delta. No branch, tag, release, or mutable branch tip is pushed; the create-once validation ref is the only permitted remote mutation.

## Steps

| # | Task | Files | Depends | Status | Done when / failure action |
|---|---|---|---|---|---|
| 1 | Obtain the one independent schema-6 draft review and start through public plan-manager. | `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` only (manager-owned review/lifecycle commits) | — | planned | The exact canonical plan input has one passed schema-6 draft `Review-receipt:`, `status: ongoing`, non-null `started_at`, and a full 40-hex `execution_base_commit` recorded by the required second plan-only identity commit. STOP on unavailable/not-ready/stale evidence or any waiver not explicitly authorized by the current user. |
| 2 | Freeze the future-version contract in the exact two test blobs and capture/embed canonical red evidence before source edits. | `cli/test/unit/sessionRelayCli.test.ts`; `cli/test/unit/pluginRefresh.test.ts`; this plan only for manager-owned receipt lines | 1 | planned | The tests commit cleanly as `PRE_PRODUCTION_COMMIT`; the exact focused command fails only because production code still couples parsing/smoke/output to `0.12.0`; the helper emits one no-clobber `TddRedReceiptV1`; its exact bytes/hash are committed in this plan; both test blobs never change afterward. |
| 3 | Derive all version-coupled validation, smoke checks, and output from one validated manifest version without loosening any other closure. | `cli/src/engine-native/sessionRelayCli.ts` | 2 | planned | A `0.13.0` fixture passes; malformed versions and mismatched tag/plugin version fail before mutation; production `0.12.0` still passes; repository/plugin/install path/targets/digests/checksum/atomicity behavior is unchanged; no module-level `0.12.0`/version tag authority remains. |
| 4 | Run ordered acceptance and the separate full gate, then capture the clean implementation-source identity. | The three affected implementation/test paths; this plan for manager-owned evidence/status rows | 3 | planned | A1–A4 and the full project CI command pass; the execution diff changes exactly this plan plus the three affected paths and leaves `SoT/toolchain.json`/`cli/src/generated/sotPayload.ts` unchanged; clean `SOURCE_COMMIT` is captured before the blocked lifecycle transition. |
| 5 | Apply the exact blocked handoff, bind that blocked plan commit to the immutable validation ref, and return both identities to Docks. | `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` only (public plan-manager-owned transition) | 4 | planned | Public plan-manager creates plan-only `PUBLIC_COMMIT` with the exact blocked fields/reason; `SOURCE_COMMIT` is its strict ancestor; the local and remote create-once ref resolve exactly to `PUBLIC_COMMIT`; and Docks can independently bind the passed plan input, execution base, draft receipt hash, red bytes/hash and ancestry, clean source identity, blocked ref/commit, status, and reason. No production digest or release mutation occurs. |

### Clean source commit, blocked plan commit, and create-once validation-ref sequence

Run after Step 4 acceptance and full CI pass:

```bash
set -euo pipefail
test -z "$(git status --porcelain=v1 --untracked-files=all)"
SOURCE_COMMIT="$(git rev-parse HEAD)"
test "$(git rev-parse --verify "${SOURCE_COMMIT}^{commit}")" = "$SOURCE_COMMIT"
```

Invoke public `plan-manager block docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` with the exact blocked reason. It must commit only this plan. After that manager-owned transition, bind the resulting blocked plan bytes:

```bash
set -euo pipefail
test -z "$(git status --porcelain=v1 --untracked-files=all)"
PUBLIC_COMMIT="$(git rev-parse HEAD)"
test "$SOURCE_COMMIT" != "$PUBLIC_COMMIT"
git merge-base --is-ancestor "$SOURCE_COMMIT" "$PUBLIC_COMMIT"
test "$(git diff --name-only "$SOURCE_COMMIT..$PUBLIC_COMMIT")" = docs/plans/active/session-relay-cli-0.13.0-release-preparation.md
PUBLIC_REF="refs/heads/preflight/session-relay-cli-0.13.0-${PUBLIC_COMMIT:0:12}"
ZERO=0000000000000000000000000000000000000000
if git show-ref --verify --quiet "$PUBLIC_REF"; then
  test "$(git rev-parse "$PUBLIC_REF")" = "$PUBLIC_COMMIT"
else
  git update-ref "$PUBLIC_REF" "$PUBLIC_COMMIT" "$ZERO"
fi
REMOTE_ROWS="$(git ls-remote --heads origin "$PUBLIC_REF")"
if test -z "$REMOTE_ROWS"; then
  PUSH_STATUS=0
  git push origin "$PUBLIC_REF:$PUBLIC_REF" || PUSH_STATUS=$?
  REMOTE_ROWS="$(git ls-remote --heads origin "$PUBLIC_REF")"
  test "$PUSH_STATUS" -eq 0 || test "$REMOTE_ROWS" = "$(printf '%s\t%s' "$PUBLIC_COMMIT" "$PUBLIC_REF")"
fi
test "$REMOTE_ROWS" = "$(printf '%s\t%s' "$PUBLIC_COMMIT" "$PUBLIC_REF")"
```

No force flag is permitted. A push error is reconciled once by exact remote read-back; if the ref is absent or differs afterward, STOP and do not retry, delete, advance, or replace it. `PUBLIC_COMMIT` and the immutable ref tip must remain the same blocked plan commit; never point the ref at `SOURCE_COMMIT` or a later lifecycle commit.

## Acceptance criteria

Run A1–A4 in order before the separately recorded full project CI command. Run A5–A6 only after their named lifecycle/ref dependency exists.

| ID | Command | Expected |
|---|---|---|
| A1 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts` | Exit 0; the frozen `0.13.0` fixture proves derived manifest/tag/plugin/smoke/log behavior, all failure-preservation cases remain green, and live production `0.12.0` ensure ordering remains before Claude/Codex plugin work and absent for agents-only. |
| A2 | `bun run typecheck` | Exit 0; the widened manifest version type and explicit version flow are type-safe without suppression. |
| A3 | `bun cli/scripts/generate-sot-payload.ts --check && node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const m=JSON.parse(fs.readFileSync("SoT/toolchain.json","utf8")).tools["session-relay"]; assert.equal(m.verified,"0.12.0"); assert.equal(m.tag,"session-relay--v0.12.0"); assert.equal(m.plugin_version,"0.12.0"); assert.deepEqual(Object.keys(m.assets).sort(),["aarch64-apple-darwin","aarch64-unknown-linux-musl","x86_64-apple-darwin","x86_64-unknown-linux-musl"]);'` | Exit 0; generated payload is current and the production manifest remains the exact four-target `0.12.0` pin. |
| A4 | `./docks-kit sync claude codex --dry-run --skip-rtk && ./docks-kit sync agents --dry-run --skip-rtk` | Exit 0; production `0.12.0` ensure appears before each selected tool plugin pass, agents-only emits no Session Relay ensure, and no mutation occurs. |
| A5 | `set -euo pipefail; base="$(sed -n 's/^execution_base_commit: //p' docs/plans/active/session-relay-cli-0.13.0-release-preparation.md)"; test "${#base}" -eq 40; git merge-base --is-ancestor "$base" "$SOURCE_COMMIT"; git diff --quiet "$base..$SOURCE_COMMIT" -- SoT/toolchain.json cli/src/generated/sotPayload.ts; actual="$(git diff --name-only "$base..$SOURCE_COMMIT" \| LC_ALL=C sort)"; expected="$(printf '%s\n' cli/src/engine-native/sessionRelayCli.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/sessionRelayCli.test.ts docs/plans/active/session-relay-cli-0.13.0-release-preparation.md \| LC_ALL=C sort)"; test "$actual" = "$expected"; test -z "$(git status --porcelain=v1 --untracked-files=all)"` | Exit 0; the exact implementation range contains only this plan and the three declared source/test paths, production SoT/generated payload are unchanged, and `SOURCE_COMMIT` was captured cleanly before blocking. |
| A6 | `set -euo pipefail; test "$(git rev-parse HEAD)" = "$PUBLIC_COMMIT"; test "$SOURCE_COMMIT" != "$PUBLIC_COMMIT"; git merge-base --is-ancestor "$SOURCE_COMMIT" "$PUBLIC_COMMIT"; test "$(git diff --name-only "$SOURCE_COMMIT..$PUBLIC_COMMIT")" = docs/plans/active/session-relay-cli-0.13.0-release-preparation.md; test "$(git rev-parse "$PUBLIC_REF")" = "$PUBLIC_COMMIT"; test "$(git ls-remote --heads origin "$PUBLIC_REF")" = "$(printf '%s\t%s' "$PUBLIC_COMMIT" "$PUBLIC_REF")"; PLAN_PATH=docs/plans/active/session-relay-cli-0.13.0-release-preparation.md PUBLIC_COMMIT="$PUBLIC_COMMIT" node --input-type=module -e 'import {execFileSync} from "node:child_process"; import assert from "node:assert/strict"; const p=execFileSync("git",["show",`${process.env.PUBLIC_COMMIT}:${process.env.PLAN_PATH}`],{encoding:"utf8"}); const reason="Awaiting the four independently hashed `session-relay--v0.13.0` production asset digests."; assert.match(p,/^status: blocked$/m); assert.ok(p.includes(`blocked_reason: "${reason}"`)); assert.match(p,/^blocked_since: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z\|[+-]\d{2}:\d{2})"$/m);' && test -z "$(git status --porcelain=v1 --untracked-files=all)"` | Exit 0; `PUBLIC_COMMIT` is the checked-out strict plan-only descendant of clean `SOURCE_COMMIT`, exact committed bytes are blocked for the four real digests, and the local/remote immutable ref resolves exactly to those blocked bytes. |

## Out of scope / do-NOT-touch

- Do not edit `SoT/toolchain.json`, its four existing production digests, or `cli/src/generated/sotPayload.ts`; this plan keeps production on `0.12.0`.
- Do not place `0.13.0` in production manifests, generated payloads, goldens, docs pins, changelogs, package versions, plugin manifests, or install output outside fixture-driven unit execution.
- Do not create or consume a guessed/placeholder production digest. Fixture digests must be computed only from deterministic fixture bytes and never copied into production SoT.
- Do not edit Claude/Codex sync orchestration, Session Relay install paths, target mapping, checksum closure, plugin reconciliation, Rust source, Docks source, or release workflows.
- Do not tag, publish a GitHub Release, install a `0.13.0` executable, promote or push `main`, advance/delete/force-update the validation ref, push another branch, or release docks-kit. The one create-once validation-ref push of blocked `PUBLIC_COMMIT` is the sole remote mutation.
- Do not independently review, start, block, unblock, complete, or ship from an implementation worker; public plan-manager owns those lifecycle operations.

## Known gotchas

- A flexible manifest version is not a floating version. The source accepts only one version supplied by an already closed manifest; production remains pinned.
- `tag` and `plugin_version` are redundant security checks by design. They must equal values derived from `verified`, not become independent inputs.
- The stable-installed short-circuit must compare against the current manifest version. Leaving `exactVersion` on a module constant makes fixture parsing appear fixed while installation remains wrong.
- The dry-run line already reads manifest fields, but staged smoke failure and final ready output currently use the module constant; tests must cover every one of these paths.
- `pluginRefresh.test.ts` executes against the embedded production payload. It must continue to observe `0.12.0`; only `sessionRelayCli.test.ts` supplies the future fixture.
- A red receipt binds tracked blob ids, not filenames alone. Either test changing after capture destroys the Docks ancestry proof even if the command still passes.
- `Review-receipt:` payload bytes and the whole markdown line have different hashes. Docks records SHA-256 of the exact compact-JCS payload bytes after the prefix.
- `SOURCE_COMMIT` is the clean implementation-source identity. `PUBLIC_COMMIT` is its strict plan-only blocked descendant and the immutable validation-ref tip; Docks fetches and verifies the blocked plan bytes at that exact commit.
- The validation-ref push is the only remote mutation in this plan and is create-once. Network ambiguity is reconciled by one exact remote read, never by force or blind retry.

## Global constraints

- The source-preparation version is exactly `0.13.0`; the reserved future tag is exactly `session-relay--v0.13.0`.
- The production SoT remains exactly `0.12.0` throughout this plan.
- Supported targets remain exactly `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, and `aarch64-apple-darwin`.
- Repository, plugin id, install path, target set, digest grammar, checksum equality, staged smoke, and atomic replacement remain closed and failure-preserving.
- Every downloaded or published executable requires an independently established production digest before installation; fixture evidence is never production authority.
- Frozen test paths are exactly `cli/test/unit/sessionRelayCli.test.ts` and `cli/test/unit/pluginRefresh.test.ts`.
- The red command is exactly `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts`.
- The blocked reason is exactly `Awaiting the four independently hashed \`session-relay--v0.13.0\` production asset digests.`
- Public plan-manager alone owns review receipts, lifecycle transitions, receipt embedding, and plan commits after creation.
- No secret may enter source, fixtures, plan prose, receipts, commands, logs, or remote refs.

## STOP conditions

- STOP if the draft review is unavailable, not passed, stale for the start input, waived without exact current-user authority, or cannot provide a canonical `plan_input_sha256` and receipt payload.
- STOP if the two plan-only start commits do not establish an exact `execution_base_commit` before test/source work.
- STOP if the focused baseline exits zero, is signaled/timed out, or fails for setup/unrelated behavior rather than the intended manifest-derived `0.13.0` contract.
- STOP if the capture helper or either frozen test blob differs from the blob bound in `TddRedReceiptV1`, if receipt bytes/hash cannot be read back exactly, or if a frozen test needs another edit after capture.
- STOP if implementation requires any `SoT/toolchain.json`, generated payload, golden, documentation, sync-orchestration, target, digest, install-path, plugin-id, repository, checksum, or atomic-install change.
- STOP if accepting a manifest version would require prerelease/build metadata, a floating range, coercion, or more than one version authority.
- STOP if A1–A4 or the full project CI command fails; fix only production source unless the frozen test was proven wrong, in which case stop and return for plan amendment instead of weakening it.
- STOP if the worktree is dirty when `SOURCE_COMMIT` is captured, the implementation range contains any undeclared path, or production SoT/generated payload differs from `execution_base_commit`.
- STOP if the validation ref already exists locally or remotely at another commit, if push/read-back is ambiguous, or if any force/update/delete/retry would be required.
- STOP if the exact block transition would alter any non-plan path, reset `started_at`/`execution_base_commit`, use a different reason, or fail to make `PUBLIC_COMMIT` a strict plan-only descendant of `SOURCE_COMMIT`.
- STOP before any production digest, SoT pin, generated payload, docs pin, tag, Release, install, promotion, Docks edit, mutable-branch push, validation-ref update/delete/force, or docks-kit release. Preserve any real digest input for the later independently reviewed publication plan.

## Open questions

None. The reviewed cross-repository contract fixes the future version, fixture-only boundary, red evidence, immutable ref grammar, lifecycle order, exact blocked reason, and later publication ownership.

## Cold-handoff checklist

- **File manifest:** The only implementation/test paths are `cli/src/engine-native/sessionRelayCli.ts`, `cli/test/unit/sessionRelayCli.test.ts`, and `cli/test/unit/pluginRefresh.test.ts`; every plan-only manager write is named separately.
- **Environment & commands:** Repository, runtime/tool versions, dependency setup, exact focused/red/full commands, persistent receipt directory, validation ref, and create-once push sequence are explicit.
- **Interface & data contracts:** Stable SemVer grammar, derived tag/plugin version, unchanged closures, exact receipt byte lifecycle, and every Docks identity are defined before use.
- **Executable acceptance:** A1–A6 cover focused behavior, type safety, production-pin/payload invariance, sync smoke, exact execution diff/clean commit, remote ref, and blocked lifecycle; full project CI is separately executable once.
- **Out of scope:** Production pins/digests/payload/docs, sync orchestration, Rust/Docks source, publication, installation, promotion, branch/tag release, and lifecycle-owner violations are prohibited.
- **Decision rationale:** Manifest-derived source capability allows future exact versions without moving production authority before real artifacts exist.
- **Known gotchas:** Floating-vs-derived versions, redundant equality checks, all smoke/log sites, embedded production payload, blob-bound red evidence, payload-vs-line receipt hashes, clean source versus blocked ref-tip identities, and push ambiguity are recorded.
- **Global constraints:** Exact version/tag/reason, production `0.12.0`, four targets, failure-preserving installer closure, frozen tests/command, ownership, and secret hygiene are copied explicitly.
- **No undefined terms / forward refs:** `PRE_PRODUCTION_COMMIT`, `PUBLIC_RED_PATH`, `CAPTURE_SHA256`, `plan_input_sha256`, `SOURCE_COMMIT`, `PUBLIC_COMMIT`, and `PUBLIC_REF` are defined before operational use.

## Self-review

- `standalone_executability` — caught/fixed: added the persistent receipt setup, exact capture/read-back lifecycle, full gate, separate clean source identity, blocked ref-tip identity, and create-once reconciliation.
- `actionability` — caught/fixed: each step names exact paths, owner, dependencies, executable command, observable done condition, and failure action.
- `dependency_order` — pass: review/start precede tests; frozen red evidence precedes source edits; acceptance and full CI precede `SOURCE_COMMIT`; the exact plan-only block transition creates `PUBLIC_COMMIT` before its create-once ref.
- `evidence_reverification` — pass: current installer constants/parser/smoke/log sites, both unit tests, production manifest, payload generation command, parity workflow, capture helper, prior public plans, and the reviewed Docks prerequisite were reopened at `planned_at_commit`.
- `goal_coverage` — caught/fixed: production SoT and generated payload are protected both by scope and executable blob/diff checks while fixture `0.13.0` covers every version-coupled path.
- `executable_acceptance` — caught/fixed: ordered focused/type/pin/smoke/range/ref/block checks have concrete exits and expected evidence; full CI is recorded separately per workspace policy.
- `failure_modes` — caught/fixed: unintended red causes, receipt/blob drift, version loosening, undeclared diffs, dirty identity, ref conflict/network ambiguity, lifecycle drift, and premature publication all STOP.
- `open_questions` — pass: no implementation or lifecycle decision remains unresolved; the reviewed Docks plan and current user contract supply every fixed value.

## Review

(filled by plan-manager from plan-review evidence on completion)

## Sources

- `cli/src/engine-native/sessionRelayCli.ts:19-43` — current `VERSION`/`TAG` constants constrain the exported closed manifest type.
- `cli/src/engine-native/sessionRelayCli.ts:78-110` — parser enforces exact fields, four targets, and lowercase 64-hex digests.
- `cli/src/engine-native/sessionRelayCli.ts:121-145` — host mapping and stable exact-version check are closed and currently constant-coupled.
- `cli/src/engine-native/sessionRelayCli.ts:164-243` — install transaction derives URLs from the manifest but uses the constant in staged smoke and ready output.
- `cli/test/unit/sessionRelayCli.test.ts:24-59` — current fixture is fixed to `0.12.0` and constructs the closed four-target manifest.
- `cli/test/unit/sessionRelayCli.test.ts:140-255` — parser, install, atomicity, cleanup, and failure-preservation regression surfaces.
- `cli/test/unit/pluginRefresh.test.ts:30-50` — Claude/Codex ordering and agents-only exclusion currently hard-code the production ensure marker.
- `SoT/toolchain.json:24-30` — production Session Relay SoT is exact `0.12.0` with four real target digests.
- `package.json:26-44` — typecheck, payload, golden, unit commands and current Vitest/TypeScript versions.
- `.github/workflows/parity.yml:30-86` — authoritative Bun `1.3.14` full golden job and both prove-red assertions.
- `/home/vagrant/projects/docks/scripts/capture-tdd-red.mjs:49-109,122-205` — helper argv, frozen-blob validation, exclusive mode-`0600` canonical receipt writer, nonzero requirement, closed receipt shape, and exact-byte SHA-256 output.
- `/home/vagrant/projects/docks/docs/plans/active/session-relay-linux-workspace-release.md:64-79,100-127,139-159,222-235` — reviewed companion path/ref, fixture-only public contract, required identity tuple, source-preparation order, exact block reason, and STOP boundaries.
- `docs/plans/finished/2026-07-18-session-relay-cli-installation.md:70-141` — original closed installer, transaction, focused tests, and TDD receipt protocol.
- `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md:30-42,152-178` — prior fixture-to-production separation and exact digest-authority precedent.

Review-orchestration-state: {"apply_state":"pending","current_input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","initial_input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_attempt":1,"phase":"draft","plan_path":"docs/plans/active/session-relay-cli-0.13.0-release-preparation.md","request_ids":["186267d9-44fe-4b3a-a381-4ff44c414a34"],"retry_authorization":null,"round_index":1,"schema":2,"series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","series_sha256":"1ab7aba1de1bc33607ba20d2d0379e0986470a3bdb152bde723788bf09799ad5","state_sha256":"49c5f53cb7fb8b8742b8d77b5c9510f222dc251ebb7fd3e86504a0effbf40802","status":"passed","stop_reason":null,"terminal_evidence_sha256":null,"terminated_from_state":null,"terminated_from_state_sha256":null,"transitioned_from_state_sha256":null}


Review-receipt: {"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","outcome":"passed","phase":"draft","policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","pre_execution_eligible":true,"reproduced":[{"id":"P1","reproduction":{"command":null,"evidence_sha256":"981560c13cb96b7cec23694a5c3ea6930549f30298bd08df5e471667979199ba","exit_code":null,"method":"read"}}],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"reviewed_at":"2026-07-23T02:20:57.755Z","reviewed_commit":"346e6d24d237c9ae80cf94d23f4d5d728784e605","reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"2060742","denial_source":null,"exit_code":0,"output_started":true,"reason":"Reviewer returned valid schema-6 output.","result":"passed","schema":6,"signal":null,"started":true,"stderr_sha256":"84c236ea228b8e01abc8cfe901c7928e2f321801fb1bb4f4d99f954d8befa25d","stdout_sha256":"14ea81649b3b8465789fad372244302270ac538bbe18689d4e8695717b66c219","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":"67835e3268ee116c347529d2e8d02128b75f158febfc05514f825bdd48f4622e","reason":null,"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"result":"passed","reviewer_output":{"checklist":{"actionability":{"evidence":"Steps 1–5 name concrete files, owners, commands, completion conditions, and STOP behavior; the implementation change is precisely specified as deriving tag, plugin version, smoke checks, and output from the validated manifest version.","status":"pass"},"dependency_order":{"evidence":"The plan orders review/start before frozen tests, red-receipt capture before production-source edits, implementation before acceptance/full CI, immutable-ref creation before blocking, and the blocked lifecycle commit after PUBLIC_COMMIT.","status":"pass"},"evidence_reverification":{"evidence":"The plan requires receipt byte/hash read-back, frozen test-blob comparison, focused and full test reruns, generated-payload and production-pin checks, execution-range inspection, clean-worktree checks, and exact local/remote ref read-back.","status":"pass"},"executable_acceptance":{"evidence":"A1–A5 and the full CI gate are concrete and outcome-based. A6 is executable but does not prove its stated strict-descendant relationship or bind the inspected working tree to BLOCKED_PLAN_COMMIT, leaving a non-blocking identity-verification gap before handoff.","status":"non_blocking_gap"},"failure_modes":{"evidence":"Explicit STOP conditions cover stale review evidence, unintended red causes, receipt/blob drift, frozen-test changes, version-contract loosening, undeclared diffs, dirty commits, ref conflicts, ambiguous pushes, lifecycle drift, and premature production or release mutation.","status":"pass"},"goal_coverage":{"evidence":"The plan covers fixture-only 0.13.0 behavior, preservation of production 0.12.0 SoT and generated payload, every identified version-coupled installer path, immutable validation-ref creation, and the exact blocked handoff pending four production digests.","status":"pass"},"open_questions":{"evidence":"The version, fixture boundary, target set, ownership, receipt lifecycle, validation-ref grammar, blocked reason, and later publication boundary are fixed; no user decision is required before implementation starts.","status":"pass"},"standalone_executability":{"evidence":"The plan supplies the repository, tool versions, dependency setup, exact affected paths, manifest contract, receipt procedure, focused/full commands, ref sequence, lifecycle ownership, expected outputs, and STOP conditions needed for a cold handoff.","status":"pass"}},"findings":[{"criterion":"executable_acceptance","defect":"A6 does not execute the plan’s required proof that BLOCKED_PLAN_COMMIT is a strict descendant of PUBLIC_COMMIT, and it inspects the current working-tree plan without proving HEAD equals BLOCKED_PLAN_COMMIT. Consequently, A6 can pass while the immutable source-to-blocked-lifecycle identity chain required by the handoff is not established.","evidence":"The lifecycle section requires BLOCKED_PLAN_COMMIT to be a strict descendant of PUBLIC_COMMIT. A6 only runs `git diff --name-only \"$PUBLIC_COMMIT..$BLOCKED_PLAN_COMMIT\"`, then reads the current plan path and checks for a clean worktree; neither operation proves ancestry, commit inequality, or that the checked-out bytes belong to BLOCKED_PLAN_COMMIT.","fix":"Extend A6 with executable identity checks such as `test \"$PUBLIC_COMMIT\" != \"$BLOCKED_PLAN_COMMIT\"`, `git merge-base --is-ancestor \"$PUBLIC_COMMIT\" \"$BLOCKED_PLAN_COMMIT\"`, and either `test \"$(git rev-parse HEAD)\" = \"$BLOCKED_PLAN_COMMIT\"` before inspecting the working tree or inspect the plan bytes directly from BLOCKED_PLAN_COMMIT.","id":"P1","locator":"Acceptance criteria, A6","path":"plan.review.md","section":"Executable acceptance for the blocked lifecycle identity","status":"non_blocking_gap"}],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"role":"primary","schema":6,"verdict":"non_blocking_gap"},"role":"primary","schema":6,"selected":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"waiver":null,"waiver_sha256":null},"rejected":[{"id":"P1","reason":"not_plan_blocking"}]},"schema":6,"series":{"current_input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","initial_input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","repairs":[],"rounds":[{"kind":"draft","outcome":"passed","pre_execution_eligible":true,"reproduced":[{"id":"P1","reproduction":{"command":null,"evidence_sha256":"981560c13cb96b7cec23694a5c3ea6930549f30298bd08df5e471667979199ba","exit_code":null,"method":"read"}}],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"2060742","denial_source":null,"exit_code":0,"output_started":true,"reason":"Reviewer returned valid schema-6 output.","result":"passed","schema":6,"signal":null,"started":true,"stderr_sha256":"84c236ea228b8e01abc8cfe901c7928e2f321801fb1bb4f4d99f954d8befa25d","stdout_sha256":"14ea81649b3b8465789fad372244302270ac538bbe18689d4e8695717b66c219","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":"67835e3268ee116c347529d2e8d02128b75f158febfc05514f825bdd48f4622e","reason":null,"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"result":"passed","reviewer_output":{"checklist":{"actionability":{"evidence":"Steps 1–5 name concrete files, owners, commands, completion conditions, and STOP behavior; the implementation change is precisely specified as deriving tag, plugin version, smoke checks, and output from the validated manifest version.","status":"pass"},"dependency_order":{"evidence":"The plan orders review/start before frozen tests, red-receipt capture before production-source edits, implementation before acceptance/full CI, immutable-ref creation before blocking, and the blocked lifecycle commit after PUBLIC_COMMIT.","status":"pass"},"evidence_reverification":{"evidence":"The plan requires receipt byte/hash read-back, frozen test-blob comparison, focused and full test reruns, generated-payload and production-pin checks, execution-range inspection, clean-worktree checks, and exact local/remote ref read-back.","status":"pass"},"executable_acceptance":{"evidence":"A1–A5 and the full CI gate are concrete and outcome-based. A6 is executable but does not prove its stated strict-descendant relationship or bind the inspected working tree to BLOCKED_PLAN_COMMIT, leaving a non-blocking identity-verification gap before handoff.","status":"non_blocking_gap"},"failure_modes":{"evidence":"Explicit STOP conditions cover stale review evidence, unintended red causes, receipt/blob drift, frozen-test changes, version-contract loosening, undeclared diffs, dirty commits, ref conflicts, ambiguous pushes, lifecycle drift, and premature production or release mutation.","status":"pass"},"goal_coverage":{"evidence":"The plan covers fixture-only 0.13.0 behavior, preservation of production 0.12.0 SoT and generated payload, every identified version-coupled installer path, immutable validation-ref creation, and the exact blocked handoff pending four production digests.","status":"pass"},"open_questions":{"evidence":"The version, fixture boundary, target set, ownership, receipt lifecycle, validation-ref grammar, blocked reason, and later publication boundary are fixed; no user decision is required before implementation starts.","status":"pass"},"standalone_executability":{"evidence":"The plan supplies the repository, tool versions, dependency setup, exact affected paths, manifest contract, receipt procedure, focused/full commands, ref sequence, lifecycle ownership, expected outputs, and STOP conditions needed for a cold handoff.","status":"pass"}},"findings":[{"criterion":"executable_acceptance","defect":"A6 does not execute the plan’s required proof that BLOCKED_PLAN_COMMIT is a strict descendant of PUBLIC_COMMIT, and it inspects the current working-tree plan without proving HEAD equals BLOCKED_PLAN_COMMIT. Consequently, A6 can pass while the immutable source-to-blocked-lifecycle identity chain required by the handoff is not established.","evidence":"The lifecycle section requires BLOCKED_PLAN_COMMIT to be a strict descendant of PUBLIC_COMMIT. A6 only runs `git diff --name-only \"$PUBLIC_COMMIT..$BLOCKED_PLAN_COMMIT\"`, then reads the current plan path and checks for a clean worktree; neither operation proves ancestry, commit inequality, or that the checked-out bytes belong to BLOCKED_PLAN_COMMIT.","fix":"Extend A6 with executable identity checks such as `test \"$PUBLIC_COMMIT\" != \"$BLOCKED_PLAN_COMMIT\"`, `git merge-base --is-ancestor \"$PUBLIC_COMMIT\" \"$BLOCKED_PLAN_COMMIT\"`, and either `test \"$(git rev-parse HEAD)\" = \"$BLOCKED_PLAN_COMMIT\"` before inspecting the working tree or inspect the plan bytes directly from BLOCKED_PLAN_COMMIT.","id":"P1","locator":"Acceptance criteria, A6","path":"plan.review.md","section":"Executable acceptance for the blocked lifecycle identity","status":"non_blocking_gap"}],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"a3fdc05e449e3863994bf8afcf4ea874c155903205707bab111763ce7d70da16","diff_sha256":null,"execution_base_commit":null,"input_sha256":"a0004e5f40d49f3e0849f0a5d8423836cc2c9baa128e11e862ebae00637af908","lifecycle_intent":"start","orchestration_series_id":"5cc8ed6d-700f-49aa-b402-ca0b45597ab8","orchestration_state_sha256":"0302a18939eb5269bb941c804d93f80ecccb50f6b097320604eb0e7d67082df8","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},{"company":"anthropic","effort":"high","model":"fable","tool":"claude"},{"company":"anthropic","effort":"xhigh","model":"opus","tool":"claude"}],"fallback":"availability_only","max_rounds":2,"provenance":{"candidates":"skill_default","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"bb95e1516f9fc1b6f4d8a75991d4650428428dc35d842db1710f4d64dc082a1b","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"186267d9-44fe-4b3a-a381-4ff44c414a34","review_mode":"full","reviewed_commit_or_head":"346e6d24d237c9ae80cf94d23f4d5d728784e605","round_index":1,"schema":6},"role":"primary","schema":6,"verdict":"non_blocking_gap"},"role":"primary","schema":6,"selected":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"waiver":null,"waiver_sha256":null},"rejected":[{"id":"P1","reason":"not_plan_blocking"}]},"schema":6}],"schema":6},"settled_orchestration_state_sha256":"49c5f53cb7fb8b8742b8d77b5c9510f222dc251ebb7fd3e86504a0effbf40802"}
