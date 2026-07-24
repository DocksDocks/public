---
title: Release docks-kit 0.10.2 with Session Relay 0.13.0
goal: Publish docks-kit 0.10.2 from a reviewed four-file pin and fixture update, prove the single immutable release, and preserve the Session Relay authority chain.
status: blocked
created: "2026-07-24T00:24:06-03:00"
updated: "2026-07-24T01:33:02-03:00"
started_at: "2026-07-24T04:30:00.000Z"
blocked_reason: "The current user selected `Expand harness scope` after the already observed A6 failure: three `pluginRefresh` assertions failed because `cli/test/lib/harness.ts` hardcoded materialized `session-relay 0.12.0` while the intended SoT pin was `0.13.0`, causing an unauthorized reinstall path whose default curl stub correctly does not create installer files. The exact authorized implementation now adds only one dynamic harness source correction to the three production paths; the named tests, curl behavior, workflow, lockfile, and goldens stay byte-frozen. This failure is rationale, not a waiver. The plan remains blocked until a fresh changed-input schema-6 review passes and plan-manager consumes the current user's unblock intent."
blocked_since: "2026-07-24T01:13:06-03:00"
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: high
review_waivers: []
tags: [session-relay, toolchain, release, supply-chain]
affected_paths:
  - package.json
  - SoT/toolchain.json
  - cli/src/generated/sotPayload.ts
  - cli/test/lib/harness.ts
related_plans:
  - docs/plans/active/session-relay-cli-0.13.0-release-preparation.md
  - docs/plans/finished/2026-07-18-session-relay-cli-production-release.md
  - /home/vagrant/projects/docks/docs/plans/active/session-relay-linux-workspace-release.md
review_status: null
planned_at_commit: e875475a7ddc91d3ed3301789f4e1933f46d60c1
execution_base_commit: d94c10544e98b027d80ebde02a451605dca108f4
---

# Release docks-kit 0.10.2 with Session Relay 0.13.0

## Goal

Create one reviewed public release commit that changes only the package version, the complete production Session Relay pin, its generated payload, and the harness's materialized Session Relay version source; then tag that exact reviewed commit as `cli-v0.10.2`, prove the sole workflow run, stable six-asset Release, npm publication, and preserved authority chain, and finally archive this plan in a distinct plan-only descendant.

## Context & rationale

The canonical `PublicReleaseRequestV1` is `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json`, with SHA-256 `d7ac63cbcbecc2840fd7c8e4c20e7a149b6b20c06ea53965762ec9d8308157b6`. It authorizes repository `DocksDocks/public`, docks-kit version/tag `0.10.2` / `cli-v0.10.2`, companion base `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`, and Session Relay `0.13.0` source tag `session-relay--v0.13.0` at `3fb9211f3309977f24853a10714d4b7a82b38c8f`.

The request binds the Session Relay publication receipt by SHA-256 `ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684`. The exact receipt is `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json`; it in turn binds `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/source-proof-v2.json` by SHA-256 `f9bfa06b8267b4d8f5a2489dbe515847feaee29a4c501a12f5717482fab7ed94`. Preserve this request → publication receipt → source proof chain as evidence; do not reconstruct, normalize, overwrite, or substitute any member.

`planned_at_commit` is the schema-6 workspace refresh commit `e875475a7ddc91d3ed3301789f4e1933f46d60c1`, whose parent is the immutable public companion base `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`. The refresh changes only plan-workspace contract files and is not an implementation affected path. The release baseline is package `0.10.1`; the complete production Session Relay entry is still `0.12.0`, tag `session-relay--v0.12.0`, plugin version `0.12.0`, and the four old production assets; the generated payload declares package `0.10.1`; and `cli/test/lib/harness.ts` materializes `session-relay 0.12.0`. The source-preparation plan froze installer behavior and the named unit tests. The current user now authorizes only the focused harness source correction described here; this child performs no installer, unit-test, lockfile, workflow, golden, or other SoT change.
The already observed A6 failure is the reason for this exact scope expansion, not a waiver: after the intended `0.13.0` pin, three frozen `pluginRefresh` assertions entered the reinstall branch because the shared harness still materialized `0.12.0`; the default curl stub then correctly exited without synthesizing installer artifacts. Reading the current `tools["session-relay"].verified` value in the harness restores the fixture invariant without weakening reinstall coverage or curl behavior.

Release identity is deliberately two-phase. `PUBLIC_RELEASE_COMMIT` is the exact `reviewed_head` from the passed reusable schema-6 `Completion-review-receipt:` and contains the four-file implementation. Only after that receipt exists may the executor prove absence, create a lightweight `cli-v0.10.2` tag at that exact commit, and push that tag once. `PUBLIC_PLAN_COMMIT` is the later plan-manager ship/archive commit; it must be a strict descendant of `PUBLIC_RELEASE_COMMIT` and preserve the exact completion receipt. The parent session, not this child plan, may push public `main` after the finished-plan read-back.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, repository id `DocksDocks/public`; remain on the assigned branch and do not create or switch branches.
- Creation/drift base: `PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1`; companion base: `COMPANION_BASE=6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`.
- Runtime: Bun `1.3.14` from `SoT/toolchain.json`; TypeScript `7.0.2`; Vitest through `bun run test:unit`; GitHub reads/tag push through authenticated `gh`/`git`; npm reads through `npm view`.
- Disposable checkout setup, when dependencies are absent: `bun install --frozen-lockfile`. This setup must not change `bun.lock`; STOP if it does.
- Generator write/check: `bun cli/scripts/generate-sot-payload.ts`, then `bun cli/scripts/generate-sot-payload.ts --check`.
- Focused frozen tests: `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts`.
- Lifecycle ownership: current schema-6 `plan-manager` alone performs the fresh changed-input draft review, consumes the current user's unblock intent only after a pass, persists completion review/receipt evidence, closes post-production rows, and ships/archives. Current `plan-reviewer` is read-only and current `plan-repairer` may return only one exact accepted-blocker patch to the manager. The implementation worker never writes receipt or lifecycle state directly.
- Exact completion invocation after the implementation commit and A1–A8 pass: `plan-manager complete docs/plans/active/session-relay-cli-0.13.0-production-release.md`. Require `review_status: passed`, one reusable schema-6 `Completion-review-receipt:`, and `PUBLIC_RELEASE_COMMIT=receipt.reviewed_head`.
- Exact ship invocation after P1–P4 pass and manager-owned Step 4/5 row closure: `plan-manager ship docs/plans/active/session-relay-cli-0.13.0-production-release.md`. Require `docs/plans/finished/2026-07-24-session-relay-cli-0.13.0-production-release.md` with `status: finished`.
- Every npm read creates a new directory using `mktemp -d /tmp/docks-npm-read.XXXXXX`, applies `chmod 700`, asserts mode `700`, uses it only through `NPM_CONFIG_CACHE`, and removes it. Never use the default cache or reuse a prior temporary cache.

### Completion-receipt identity and tag-only push

After completion passes, run this exact block. It parses the sole schema-6 receipt, performs the complete absence preflight before any mutation, creates one lightweight tag, pushes only its exact refspec once, and reconciles a nonzero push without retry:

```bash
set -euo pipefail
umask 077
PLAN_PATH=docs/plans/active/session-relay-cli-0.13.0-production-release.md
test -z "$(git status --porcelain=v1 --untracked-files=all)"
PUBLIC_RELEASE_COMMIT="$(PLAN_PATH="$PLAN_PATH" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const prefix="Completion-review-receipt: "; const lines=fs.readFileSync(process.env.PLAN_PATH,"utf8").split(/\r?\n/).filter((line)=>line.startsWith(prefix)); assert.equal(lines.length,1); const receipt=JSON.parse(lines[0].slice(prefix.length)); assert.equal(receipt.schema,6); assert.equal(receipt.phase,"completion"); assert.equal(receipt.completion_verdict,"passed"); assert.equal(receipt.outcome,"passed"); assert.match(receipt.reviewed_head,/^[0-9a-f]{40}$/); process.stdout.write(receipt.reviewed_head);')"
test "$(git rev-parse --verify "${PUBLIC_RELEASE_COMMIT}^{commit}")" = "$PUBLIC_RELEASE_COMMIT"
git merge-base --is-ancestor "$PUBLIC_RELEASE_COMMIT" HEAD
test -z "$(git tag --list cli-v0.10.2)"
test -z "$(git ls-remote --tags origin refs/tags/cli-v0.10.2)"
PREFLIGHT_DIR="$(mktemp -d /tmp/docks-cli-preflight.XXXXXX)"
trap 'rm -rf -- "$PREFLIGHT_DIR"' EXIT
if gh release view cli-v0.10.2 --repo DocksDocks/public >"$PREFLIGHT_DIR/release.stdout" 2>"$PREFLIGHT_DIR/release.stderr"; then
  exit 1
fi
test ! -s "$PREFLIGHT_DIR/release.stdout"
grep -Fxq 'release not found' "$PREFLIGHT_DIR/release.stderr"
gh api --paginate --slurp 'repos/DocksDocks/public/actions/workflows/release-cli.yml/runs?per_page=100' >"$PREFLIGHT_DIR/runs.json"
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const pages=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const runs=pages.flatMap((page)=>page.workflow_runs).filter((run)=>run.event==="push"&&run.head_branch==="cli-v0.10.2"); assert.equal(runs.length,0);' "$PREFLIGHT_DIR/runs.json"
NPM_READ_CACHE="$PREFLIGHT_DIR/npm-cache"
mkdir -m 700 "$NPM_READ_CACHE"
test "$(stat -c '%a' "$NPM_READ_CACHE")" = 700
NPM_CONFIG_CACHE="$NPM_READ_CACHE" npm view docks-kit versions --json >"$PREFLIGHT_DIR/npm-versions.json"
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const versions=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); assert.ok(Array.isArray(versions)); assert.ok(!versions.includes("0.10.2"));' "$PREFLIGHT_DIR/npm-versions.json"
git tag cli-v0.10.2 "$PUBLIC_RELEASE_COMMIT"
test "$(git cat-file -t refs/tags/cli-v0.10.2)" = commit
PUSH_STATUS=0
git push origin refs/tags/cli-v0.10.2:refs/tags/cli-v0.10.2 || PUSH_STATUS=$?
REMOTE_TAG_REF=refs/tags/cli-v0.10.2
if ! REMOTE_TAG_ROW="$(git ls-remote --tags origin "$REMOTE_TAG_REF")"; then
  echo "cannot reconcile cli-v0.10.2 remote state after push status $PUSH_STATUS" >&2
  exit 1
fi
EXPECTED_REMOTE_TAG_ROW="$(printf '%s\t%s' "$PUBLIC_RELEASE_COMMIT" "$REMOTE_TAG_REF")"
if test -z "$REMOTE_TAG_ROW"; then
  echo "cli-v0.10.2 is absent after push status $PUSH_STATUS; do not retry" >&2
  exit 1
fi
if test "$REMOTE_TAG_ROW" != "$EXPECTED_REMOTE_TAG_ROW"; then
  echo "cli-v0.10.2 remote target conflicts with PUBLIC_RELEASE_COMMIT" >&2
  exit 1
fi
if test "$PUSH_STATUS" -ne 0; then
  echo "git push exited $PUSH_STATUS but the remote exact ref is correct; continuing without retry" >&2
fi
```

After the one tag push, discover exactly one workflow run and watch it once:

```bash
set -euo pipefail
umask 077
RUN_ID=""
RUNS_FILE="$(mktemp /tmp/docks-cli-runs.XXXXXX)"
trap 'rm -f -- "$RUNS_FILE"' EXIT
for attempt in $(seq 1 60); do
  gh api --paginate --slurp 'repos/DocksDocks/public/actions/workflows/release-cli.yml/runs?per_page=100' >"$RUNS_FILE"
  RUN_COUNT="$(RUNS_FILE="$RUNS_FILE" node --input-type=module -e 'import fs from "node:fs"; const pages=JSON.parse(fs.readFileSync(process.env.RUNS_FILE,"utf8")); const runs=pages.flatMap((page)=>page.workflow_runs).filter((run)=>run.event==="push"&&run.head_branch==="cli-v0.10.2"); process.stdout.write(String(runs.length));')"
  test "$RUN_COUNT" -le 1
  if test "$RUN_COUNT" -eq 1; then
    RUN_ID="$(RUNS_FILE="$RUNS_FILE" node --input-type=module -e 'import fs from "node:fs"; const pages=JSON.parse(fs.readFileSync(process.env.RUNS_FILE,"utf8")); const runs=pages.flatMap((page)=>page.workflow_runs).filter((run)=>run.event==="push"&&run.head_branch==="cli-v0.10.2"); process.stdout.write(String(runs[0].id));')"
    break
  fi
  test "$attempt" -lt 60 || { echo 'timed out waiting for cli-v0.10.2 workflow discovery' >&2; exit 1; }
  sleep 5
done
test -n "$RUN_ID"
gh run watch "$RUN_ID" --repo DocksDocks/public --exit-status
```

## Interfaces & data shapes

### Canonical request and publication chain

The request is closed `PublicReleaseRequestV1` schema `1`. Its exact production asset map is:

```json
{
  "aarch64-apple-darwin": "0686e68e3a88dd0dee647fc18211e941dd0d8012818d0bcfb79fac142b5baf21",
  "aarch64-unknown-linux-musl": "6ebc6d9a38a8c3d1f191647d3ab679d56b69cffba36c3bc3c8eb99b0e163852e",
  "x86_64-apple-darwin": "06c046182922c6897e81278fecd7280008fa8040a489910993283017101f1be3",
  "x86_64-unknown-linux-musl": "f8c6374c2c704f48135cd646028fbd9e53fd43f9800b4a255fa36a0818744b7b"
}
```

The implementation target is the exact complete object below. No field is added, removed, reordered by hand, or independently sourced:

```json
{
  "kind": "managed-release",
  "policy": "exact",
  "verified": "0.13.0",
  "repository": "DocksDocks/docks",
  "tag": "session-relay--v0.13.0",
  "plugin_id": "session-relay@docks",
  "plugin_version": "0.13.0",
  "install_path": "~/.local/bin/session-relay",
  "assets": {
    "x86_64-unknown-linux-musl": "f8c6374c2c704f48135cd646028fbd9e53fd43f9800b4a255fa36a0818744b7b",
    "aarch64-unknown-linux-musl": "6ebc6d9a38a8c3d1f191647d3ab679d56b69cffba36c3bc3c8eb99b0e163852e",
    "x86_64-apple-darwin": "06c046182922c6897e81278fecd7280008fa8040a489910993283017101f1be3",
    "aarch64-apple-darwin": "0686e68e3a88dd0dee647fc18211e941dd0d8012818d0bcfb79fac142b5baf21"
  }
}
```

`package.json` changes only its top-level `version` value from `0.10.1` to `0.10.2`. `SoT/toolchain.json` changes only the complete `tools["session-relay"]` entry from the established `0.12.0` entry to the exact object above. `cli/src/generated/sotPayload.ts` is never hand-edited; the generator must produce `GENERATED_PACKAGE_VERSION = "0.10.2"` and embed the exact current SoT bytes. `cli/test/lib/harness.ts` adds one module-level `SESSION_RELAY_VERSION` derived by parsing the repository's current `SoT/toolchain.json` and reading `tools["session-relay"].verified`, then substitutes that value into the existing materialized `session-relay <version>` script. It changes no stub, curl, reinstall, snapshot-normalization, or other harness behavior and contains no hardcoded replacement Session Relay version.

### Immutable baseline identities

At `PLAN_BASE`, the exact Git blob ids are:

```text
package.json                                      d89f843f085585cbc3c655edceeafebfad910546
SoT/toolchain.json                                a851c156ce478ea044d07ceccd618512bf11b334
cli/src/generated/sotPayload.ts                   f6f9a223c8409c8c98fbade18e411bd0492b92f6
cli/test/lib/harness.ts                            4232cb5b08c823ab11bb08ee054c89bfe26bab67
cli/test/unit/sessionRelayCli.test.ts             265e3a99a6c0e713a72c9d6b1f3d5d2638010613
cli/test/unit/pluginRefresh.test.ts               7f8dd6507c8ed6ee5ac2549894aaa349cf0ef650
.github/workflows/release-cli.yml                 8c41f18c7dac2d4c21e359955f154f8f3f2a9342
bun.lock                                          1385eccc045a42485748a18613c1a98961dd54cf
```

The harness baseline blob is at `PLAN_BASE`. The two frozen test blobs, workflow blob, and lockfile blob are identical at `COMPANION_BASE`. The creation commit is the unique add commit for this plan and must have `PLAN_BASE` as its sole parent. Every later implementation/completion head must retain `PLAN_BASE` ancestry.

### Release and plan identities

- `PUBLIC_RELEASE_COMMIT`: exact 40-lowercase-hex `reviewed_head` in the sole passed reusable schema-6 completion receipt; contains the plan plus exactly the four implementation-path changes; exact target of lightweight tag `cli-v0.10.2`.
- `PUBLIC_PLAN_COMMIT`: exact full `HEAD` after plan-manager ship; differs from and strictly descends from `PUBLIC_RELEASE_COMMIT`; the `PUBLIC_RELEASE_COMMIT..PUBLIC_PLAN_COMMIT` product diff is empty; the finished plan retains a byte-identical `Completion-review-receipt:` line from its pre-ship parent.
- Finished path: exactly `docs/plans/finished/2026-07-24-session-relay-cli-0.13.0-production-release.md`.

### Public release artifacts

The sole `release-cli.yml` run for `cli-v0.10.2` must have `head_sha == PUBLIC_RELEASE_COMMIT` and conclude `success`. The stable GitHub Release inventory is exactly six assets: `SHA256SUMS`, `docks-kit-linux-x64`, `docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`, and `docks-kit-windows-x64.exe`. `SHA256SUMS` must name exactly the five binaries once each, and `sha256sum -c SHA256SUMS` must validate all five. npm must return exact `docks-kit@0.10.2` version `0.10.2` through a fresh mode-`0700` cache.

## Steps

| # | Task | Files | Depends | Status | Done when / failure action |
|---|---|---|---|---|---|
| 1 | Obtain the fresh changed-input schema-6 draft review while the plan remains blocked; only after it passes, have plan-manager consume the current user's unblock intent, then validate the exact request, publication receipt/source-proof chain, source tag, ancestry, baseline values, and immutable blobs before editing. | This plan only for manager-owned review/unblock commits; authority files are read-only | — | planned | The plan is `ongoing` with its existing valid execution base retained; A1–A3 prerequisites pass; STOP on any hash, identity, ancestry, baseline, frozen blob, waiver, review, or unblock mismatch. |
| 2 | Change only `package.json` version to `0.10.2`, replace the complete Session Relay toolchain entry with the exact authorized `0.13.0` object, regenerate the payload using the canonical generator, and make the one exact dynamic harness source correction. | `package.json`; `SoT/toolchain.json`; `cli/src/generated/sotPayload.ts`; `cli/test/lib/harness.ts` | 1 | planned | A4 proves only the intended package field, complete tool entry, generated payload, and dynamic harness fixture source changed; A5 passes; no other file or harness behavior is edited. |
| 3 | Run A1–A5, commit exactly the four-file implementation, then run focused A6, A7, and the one A8 full gate in that order on the clean committed tree before closing Steps 1–3 through manager-owned plan bookkeeping and invoking exactly the completion operation. | Four implementation paths; this plan for manager-owned rows/receipt/status | 2 | planned | Focused A6 and full A8 are green after the four-file commit; completion review is passed with one reusable schema-6 receipt; `PUBLIC_RELEASE_COMMIT` is its exact reviewed head, contains all four changes, and remains an ancestor of current `HEAD`. |
| 4 | Derive `PUBLIC_RELEASE_COMMIT` only from the receipt, run the complete absence preflight, create lightweight `cli-v0.10.2` at that exact commit, push only the tag once with nonzero reconciliation, and wait for exactly one workflow run. | Git tag, GitHub Actions, GitHub Release, and npm read surfaces only; no worktree product file | 3 | planned | All five absence surfaces pass before mutation; local/remote tag targets equal `PUBLIC_RELEASE_COMMIT`; exactly one matching run exists and succeeds at that head. STOP rather than retag, retry, or create another run. |
| 5 | Run P1–P4, have plan-manager mark Steps 4–5 done, ship/archive the plan, and run S1 against the exact finished path. | This plan for manager-owned lifecycle/archive; GitHub/npm/source Release read-only evidence | 4 | planned | Production identities, run, six assets/checksums, npm, and Session Relay chain all pass; the finished plan retains the receipt and `PUBLIC_PLAN_COMMIT` is a strict plan-only descendant of `PUBLIC_RELEASE_COMMIT`. |

## Acceptance criteria

Run A1–A5 in order after Step 2, commit exactly the four-file implementation, then run focused A6, A7, and A8 in that order on the clean committed tree before completion review. The A8 block is the single full project gate. Production P1–P4 runs only after the exact absence/tag/wait blocks above; S1 runs only after plan-manager ship.

| ID | Command | Expected |
|---|---|---|
| A1 | Run the exact `A1` block below. | Request, publication receipt, source proof, asset digests, and both repository/version/tag/commit chains are byte-hash-bound and exact. |
| A2 | Run the exact `A2` block below. | The immutable Session Relay source tag resolves exactly to `3fb9211f3309977f24853a10714d4b7a82b38c8f`. |
| A3 | Run the exact `A3` block below. | Companion → refresh → creation ancestry, unique add-only creation, exact four implementation baselines, and frozen test/workflow/lockfile blobs are proven. |
| A4 | Run the exact `A4` block below. | Only package version, the complete Session Relay entry, generator-owned payload, and the exact dynamic harness fixture source differ as authorized. |
| A5 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; payload embeds package `0.10.2` and exact current SoT bytes. |
| A6 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts` | After the four-file commit, exit 0; frozen Session Relay parsing/install/checksum/atomicity and plugin-order regressions stay green without changing either test or curl behavior. |
| A7 | Run the exact `A7` block below. | Since `PLAN_BASE`, the changed set is exactly the four implementation paths plus this plan; named tests, workflow, and `bun.lock` are byte-frozen; worktree is clean. |
| A8 | Run the exact `A8` block below once. | After the four-file commit, generator check, typecheck, all unit tests, POSIX statusline smoke, both goldens, and both prove-red checks pass. |

### A1 — authority chain

```bash
set -euo pipefail
REQUEST=/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json
PUBLICATION=/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json
SOURCE_PROOF=/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/source-proof-v2.json
test "$(sha256sum "$REQUEST" | cut -d' ' -f1)" = d7ac63cbcbecc2840fd7c8e4c20e7a149b6b20c06ea53965762ec9d8308157b6
test "$(sha256sum "$PUBLICATION" | cut -d' ' -f1)" = ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684
test "$(sha256sum "$SOURCE_PROOF" | cut -d' ' -f1)" = f9bfa06b8267b4d8f5a2489dbe515847feaee29a4c501a12f5717482fab7ed94
REQUEST="$REQUEST" PUBLICATION="$PUBLICATION" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const request=JSON.parse(fs.readFileSync(process.env.REQUEST,"utf8")); const receipt=JSON.parse(fs.readFileSync(process.env.PUBLICATION,"utf8")); const assets={"aarch64-apple-darwin":"0686e68e3a88dd0dee647fc18211e941dd0d8012818d0bcfb79fac142b5baf21","aarch64-unknown-linux-musl":"6ebc6d9a38a8c3d1f191647d3ab679d56b69cffba36c3bc3c8eb99b0e163852e","x86_64-apple-darwin":"06c046182922c6897e81278fecd7280008fa8040a489910993283017101f1be3","x86_64-unknown-linux-musl":"f8c6374c2c704f48135cd646028fbd9e53fd43f9800b4a255fa36a0818744b7b"}; assert.equal(request.type,"PublicReleaseRequestV1"); assert.equal(request.schema,1); assert.equal(request.repository_id,"DocksDocks/public"); assert.equal(request.companion_base_commit,"6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172"); assert.equal(request.version,"0.10.2"); assert.equal(request.tag,"cli-v0.10.2"); assert.deepEqual(request.assets,assets); assert.deepEqual(request.session_relay,{publication_receipt_sha256:"ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684",repository_id:"DocksDocks/docks",tag:"session-relay--v0.13.0",tag_commit:"3fb9211f3309977f24853a10714d4b7a82b38c8f",version:"0.13.0"}); assert.equal(receipt.type,"SessionRelayPublicationReceiptV1"); assert.equal(receipt.schema,1); assert.equal(receipt.repository_id,"DocksDocks/docks"); assert.equal(receipt.version,"0.13.0"); assert.equal(receipt.tag,"session-relay--v0.13.0"); assert.equal(receipt.tag_commit,"3fb9211f3309977f24853a10714d4b7a82b38c8f"); assert.equal(receipt.source_proof_sha256,"f9bfa06b8267b4d8f5a2489dbe515847feaee29a4c501a12f5717482fab7ed94"); assert.equal(receipt.workflow.conclusion,"success"); assert.equal(receipt.workflow.head_sha,receipt.tag_commit); assert.deepEqual(Object.fromEntries(receipt.assets.filter((asset)=>asset.name!=="SHA256SUMS").map((asset)=>[asset.name.replace("session-relay-",""),asset.digest])),assets);'
```

### A2 — immutable source tag

```bash
set -euo pipefail
SOURCE_TAG_ROWS="$(git ls-remote --exit-code --tags https://github.com/DocksDocks/docks.git refs/tags/session-relay--v0.13.0 'refs/tags/session-relay--v0.13.0^{}')"
SOURCE_TAG_ROWS="$SOURCE_TAG_ROWS" node --input-type=module -e 'import assert from "node:assert/strict"; const rows=new Map(process.env.SOURCE_TAG_ROWS.trim().split("\n").map((line)=>{const [sha,ref]=line.split("\t"); return [ref,sha];})); const direct=rows.get("refs/tags/session-relay--v0.13.0"); const peeled=rows.get("refs/tags/session-relay--v0.13.0^{}"); assert.ok(direct); assert.equal(peeled??direct,"3fb9211f3309977f24853a10714d4b7a82b38c8f");'
```

### A3 — ancestry and exact baseline

```bash
set -euo pipefail
PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1
COMPANION_BASE=6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172
PLAN_PATH=docs/plans/active/session-relay-cli-0.13.0-production-release.md
test "$(git rev-parse "$PLAN_BASE^")" = "$COMPANION_BASE"
git merge-base --is-ancestor "$PLAN_BASE" HEAD
CREATION_ROWS="$(git log --format=%H --diff-filter=A -- "$PLAN_PATH")"
test "$(printf '%s\n' "$CREATION_ROWS" | wc -l)" -eq 1
PLAN_CREATION_COMMIT="$CREATION_ROWS"
test "$(git rev-parse "$PLAN_CREATION_COMMIT^")" = "$PLAN_BASE"
test "$(git diff-tree --no-commit-id --name-status -r "$PLAN_CREATION_COMMIT")" = "$(printf 'A\t%s' "$PLAN_PATH")"
test "$(git rev-parse "$PLAN_BASE:package.json")" = d89f843f085585cbc3c655edceeafebfad910546
test "$(git rev-parse "$PLAN_BASE:SoT/toolchain.json")" = a851c156ce478ea044d07ceccd618512bf11b334
test "$(git rev-parse "$PLAN_BASE:cli/src/generated/sotPayload.ts")" = f6f9a223c8409c8c98fbade18e411bd0492b92f6
test "$(git rev-parse "$PLAN_BASE:cli/test/lib/harness.ts")" = 4232cb5b08c823ab11bb08ee054c89bfe26bab67
test "$(git rev-parse "$COMPANION_BASE:cli/test/unit/sessionRelayCli.test.ts")" = 265e3a99a6c0e713a72c9d6b1f3d5d2638010613
test "$(git rev-parse "$COMPANION_BASE:cli/test/unit/pluginRefresh.test.ts")" = 7f8dd6507c8ed6ee5ac2549894aaa349cf0ef650
test "$(git rev-parse "$COMPANION_BASE:.github/workflows/release-cli.yml")" = 8c41f18c7dac2d4c21e359955f154f8f3f2a9342
test "$(git rev-parse "$COMPANION_BASE:bun.lock")" = 1385eccc045a42485748a18613c1a98961dd54cf
PLAN_BASE="$PLAN_BASE" node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const show=(path)=>execFileSync("git",["show",`${process.env.PLAN_BASE}:${path}`],{encoding:"utf8"}); const pkg=JSON.parse(show("package.json")); const tc=JSON.parse(show("SoT/toolchain.json")); assert.equal(pkg.version,"0.10.1"); assert.deepEqual(tc.tools["session-relay"],{kind:"managed-release",policy:"exact",verified:"0.12.0",repository:"DocksDocks/docks",tag:"session-relay--v0.12.0",plugin_id:"session-relay@docks",plugin_version:"0.12.0",install_path:"~/.local/bin/session-relay",assets:{"x86_64-unknown-linux-musl":"ead7faead73ba5835879e4823bc4bca6b6d1003d8a9bcbdbea6cf9f266ce5b42","aarch64-unknown-linux-musl":"d7171bbaa33c4da8b0a9e15f9bfe7a3fb31930a1fad95cc9f682f153369b421b","x86_64-apple-darwin":"be12a6f782453d8cc90d98ab77f408f0e7c61b55f8ccdf36bf0584c8cec2f1d8","aarch64-apple-darwin":"5022354025d0c639406cf8b027d824724d8366f74e2b778c37d705e7e9f53889"}}); assert.match(show("cli/src/generated/sotPayload.ts"),/^export const GENERATED_PACKAGE_VERSION = "0\.10\.1"$/m);'
```

### A4 — exact implementation structure

```bash
set -euo pipefail
PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1
PLAN_BASE="$PLAN_BASE" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const show=(path)=>execFileSync("git",["show",`${process.env.PLAN_BASE}:${path}`],{encoding:"utf8"}); const beforePkg=JSON.parse(show("package.json")); const afterPkg=JSON.parse(fs.readFileSync("package.json","utf8")); assert.equal(beforePkg.version,"0.10.1"); assert.equal(afterPkg.version,"0.10.2"); assert.deepEqual({...afterPkg,version:null},{...beforePkg,version:null}); const beforeTc=JSON.parse(show("SoT/toolchain.json")); const afterTc=JSON.parse(fs.readFileSync("SoT/toolchain.json","utf8")); const expected={kind:"managed-release",policy:"exact",verified:"0.13.0",repository:"DocksDocks/docks",tag:"session-relay--v0.13.0",plugin_id:"session-relay@docks",plugin_version:"0.13.0",install_path:"~/.local/bin/session-relay",assets:{"x86_64-unknown-linux-musl":"f8c6374c2c704f48135cd646028fbd9e53fd43f9800b4a255fa36a0818744b7b","aarch64-unknown-linux-musl":"6ebc6d9a38a8c3d1f191647d3ab679d56b69cffba36c3bc3c8eb99b0e163852e","x86_64-apple-darwin":"06c046182922c6897e81278fecd7280008fa8040a489910993283017101f1be3","aarch64-apple-darwin":"0686e68e3a88dd0dee647fc18211e941dd0d8012818d0bcfb79fac142b5baf21"}}; assert.deepEqual(afterTc.tools["session-relay"],expected); afterTc.tools["session-relay"]=beforeTc.tools["session-relay"]; assert.deepEqual(afterTc,beforeTc); assert.match(fs.readFileSync("cli/src/generated/sotPayload.ts","utf8"),/^export const GENERATED_PACKAGE_VERSION = "0\.10\.2"$/m); const beforeHarness=show("cli/test/lib/harness.ts"); const afterHarness=fs.readFileSync("cli/test/lib/harness.ts","utf8"); const anchor="export const FIXTURES_DIR = join(REPO_DIR, \"cli\", \"test\", \"fixtures\")\n"; const versionBlock="const SESSION_RELAY_VERSION = (\n  JSON.parse(readFileSync(join(REPO_DIR, \"SoT\", \"toolchain.json\"), \"utf8\")) as {\n    tools: { \"session-relay\": { verified: string } }\n  }\n).tools[\"session-relay\"].verified\n"; const hardcoded="  writeFileSync(sessionRelay, \"#!/bin/sh\\nprintf 'session-relay 0.12.0\\\\n'\\n\")"; const dynamic="  writeFileSync(sessionRelay, `#!/bin/sh\\nprintf 'session-relay ${SESSION_RELAY_VERSION}\\\\n'\\n`)"; assert.equal(afterHarness,beforeHarness.replace(anchor,anchor+"\n"+versionBlock).replace(hardcoded,dynamic));'
```

### A7 — exact scope and frozen surfaces

```bash
set -euo pipefail
PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1
COMPANION_BASE=6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172
node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const actual=execFileSync("git",["diff","--name-only","--no-renames","-z","e875475a7ddc91d3ed3301789f4e1933f46d60c1","HEAD"],{encoding:"utf8"}).split("\0").filter(Boolean).sort(); const expected=["package.json","SoT/toolchain.json","cli/src/generated/sotPayload.ts","cli/test/lib/harness.ts","docs/plans/active/session-relay-cli-0.13.0-production-release.md"].sort(); assert.deepEqual(actual,expected);'
git diff --quiet "$COMPANION_BASE..HEAD" -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts .github/workflows/release-cli.yml bun.lock
test "$(git rev-parse HEAD:cli/test/unit/sessionRelayCli.test.ts)" = 265e3a99a6c0e713a72c9d6b1f3d5d2638010613
test "$(git rev-parse HEAD:cli/test/unit/pluginRefresh.test.ts)" = 7f8dd6507c8ed6ee5ac2549894aaa349cf0ef650
test "$(git rev-parse HEAD:.github/workflows/release-cli.yml)" = 8c41f18c7dac2d4c21e359955f154f8f3f2a9342
test "$(git rev-parse HEAD:bun.lock)" = 1385eccc045a42485748a18613c1a98961dd54cf
test -z "$(git status --porcelain=v1 --untracked-files=all)"
git diff --check "$PLAN_BASE..HEAD"
```

### A8 — one full gate

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

## Production verification

The absence assertions are part of the completion-receipt identity/tag-only block and must pass before the tag is created. After the tag-only push and exact single-run wait, run P1–P4 once in order.

| ID | Command | Expected |
|---|---|---|
| P1 | Run the exact `P1` block below. | Local/remote tag, sole workflow run, workflow file, head SHA, event, and successful conclusion all bind to `PUBLIC_RELEASE_COMMIT`. |
| P2 | Run the exact `P2` block below. | Stable Release has exactly six named assets; `SHA256SUMS` names and validates exactly five binaries. |
| P3 | Run the exact `P3` block below. | A fresh mode-`0700` cache returns exact npm version `0.10.2` within the bounded visibility window. |
| P4 | Run the exact `P4` block below. | Live Session Relay source Release, publication receipt, request map, and downloaded four-binary checksums agree exactly. |

### P1 — tag and sole run

```bash
set -euo pipefail
PLAN_PATH=docs/plans/active/session-relay-cli-0.13.0-production-release.md
PUBLIC_RELEASE_COMMIT="$(PLAN_PATH="$PLAN_PATH" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const prefix="Completion-review-receipt: "; const lines=fs.readFileSync(process.env.PLAN_PATH,"utf8").split(/\r?\n/).filter((line)=>line.startsWith(prefix)); assert.equal(lines.length,1); const r=JSON.parse(lines[0].slice(prefix.length)); assert.equal(r.schema,6); assert.equal(r.phase,"completion"); assert.equal(r.completion_verdict,"passed"); assert.match(r.reviewed_head,/^[0-9a-f]{40}$/); process.stdout.write(r.reviewed_head);')"
test "$(git rev-parse refs/tags/cli-v0.10.2)" = "$PUBLIC_RELEASE_COMMIT"
test "$(git ls-remote --tags origin refs/tags/cli-v0.10.2)" = "$(printf '%s\t%s' "$PUBLIC_RELEASE_COMMIT" refs/tags/cli-v0.10.2)"
RUNS_FILE="$(mktemp /tmp/docks-cli-p1-runs.XXXXXX)"
trap 'rm -f -- "$RUNS_FILE"' EXIT
gh api --paginate --slurp 'repos/DocksDocks/public/actions/workflows/release-cli.yml/runs?per_page=100' >"$RUNS_FILE"
RUNS_FILE="$RUNS_FILE" PUBLIC_RELEASE_COMMIT="$PUBLIC_RELEASE_COMMIT" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const pages=JSON.parse(fs.readFileSync(process.env.RUNS_FILE,"utf8")); const runs=pages.flatMap((page)=>page.workflow_runs).filter((run)=>run.event==="push"&&run.head_branch==="cli-v0.10.2"); assert.equal(runs.length,1); const run=runs[0]; assert.equal(run.path,".github/workflows/release-cli.yml"); assert.equal(run.event,"push"); assert.equal(run.head_sha,process.env.PUBLIC_RELEASE_COMMIT); assert.equal(run.status,"completed"); assert.equal(run.conclusion,"success");'
```

### P2 — stable six-asset Release

```bash
set -euo pipefail
umask 077
RELEASE_DIR="$(mktemp -d /tmp/docks-cli-release.XXXXXX)"
META_FILE="$(mktemp /tmp/docks-cli-release-meta.XXXXXX)"
trap 'rm -rf -- "$RELEASE_DIR"; rm -f -- "$META_FILE"' EXIT
gh release view cli-v0.10.2 --repo DocksDocks/public --json tagName,isDraft,isPrerelease,assets,targetCommitish,url >"$META_FILE"
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const meta=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); assert.equal(meta.tagName,"cli-v0.10.2"); assert.equal(meta.isDraft,false); assert.equal(meta.isPrerelease,false); assert.deepEqual(meta.assets.map((asset)=>asset.name).sort(),["SHA256SUMS","docks-kit-darwin-arm64","docks-kit-darwin-x64","docks-kit-linux-arm64","docks-kit-linux-x64","docks-kit-windows-x64.exe"].sort());' "$META_FILE"
gh release download cli-v0.10.2 --repo DocksDocks/public --dir "$RELEASE_DIR"
RELEASE_DIR="$RELEASE_DIR" node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict"; const expected=["docks-kit-darwin-arm64","docks-kit-darwin-x64","docks-kit-linux-arm64","docks-kit-linux-x64","docks-kit-windows-x64.exe"].sort(); const rows=fs.readFileSync(path.join(process.env.RELEASE_DIR,"SHA256SUMS"),"utf8").trim().split(/\r?\n/); assert.equal(rows.length,5); const names=rows.map((row)=>{const match=row.match(/^[0-9a-f]{64} [ *](.+)$/); assert.ok(match); return match[1];}).sort(); assert.deepEqual(names,expected);'
(cd "$RELEASE_DIR" && sha256sum -c SHA256SUMS)
```

### P3 — npm exact version

```bash
set -euo pipefail
NPM_DEADLINE=$((SECONDS + 300))
while :; do
  NPM_READ_CACHE="$(mktemp -d /tmp/docks-npm-read.XXXXXX)"
  chmod 700 "$NPM_READ_CACHE"
  test "$(stat -c '%a' "$NPM_READ_CACHE")" = 700
  if NPM_VERSION="$(NPM_CONFIG_CACHE="$NPM_READ_CACHE" npm view docks-kit@0.10.2 version 2>/dev/null)"; then
    rm -rf -- "$NPM_READ_CACHE"
    test "$NPM_VERSION" = 0.10.2
    break
  fi
  rm -rf -- "$NPM_READ_CACHE"
  test "$SECONDS" -lt "$NPM_DEADLINE" || { echo 'timed out waiting for docks-kit@0.10.2 npm visibility' >&2; exit 1; }
  sleep 5
done
```

### P4 — Session Relay live checksum chain

```bash
set -euo pipefail
umask 077
REQUEST=/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json
PUBLICATION=/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json
SOURCE_DIR="$(mktemp -d /tmp/docks-session-relay-release.XXXXXX)"
SOURCE_META="$(mktemp /tmp/docks-session-relay-meta.XXXXXX)"
trap 'rm -rf -- "$SOURCE_DIR"; rm -f -- "$SOURCE_META"' EXIT
gh release view session-relay--v0.13.0 --repo DocksDocks/docks --json tagName,isDraft,isPrerelease,assets >"$SOURCE_META"
gh release download session-relay--v0.13.0 --repo DocksDocks/docks --dir "$SOURCE_DIR"
REQUEST="$REQUEST" PUBLICATION="$PUBLICATION" SOURCE_DIR="$SOURCE_DIR" SOURCE_META="$SOURCE_META" node --input-type=module -e 'import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import assert from "node:assert/strict"; const request=JSON.parse(fs.readFileSync(process.env.REQUEST,"utf8")); const receipt=JSON.parse(fs.readFileSync(process.env.PUBLICATION,"utf8")); const meta=JSON.parse(fs.readFileSync(process.env.SOURCE_META,"utf8")); assert.equal(meta.tagName,"session-relay--v0.13.0"); assert.equal(meta.isDraft,false); const expectedNames=["SHA256SUMS",...Object.keys(request.assets).map((target)=>`session-relay-${target}`)].sort(); assert.deepEqual(meta.assets.map((asset)=>asset.name).sort(),expectedNames); const sums=fs.readFileSync(path.join(process.env.SOURCE_DIR,"SHA256SUMS"),"utf8").trim().split(/\r?\n/); const rows=new Map(sums.map((row)=>{const match=row.match(/^([0-9a-f]{64}) [ *](.+)$/); assert.ok(match); return [match[2],match[1]];})); assert.equal(rows.size,4); for(const [target,digest] of Object.entries(request.assets)){const name=`session-relay-${target}`; const bytes=fs.readFileSync(path.join(process.env.SOURCE_DIR,name)); const live=crypto.createHash("sha256").update(bytes).digest("hex"); assert.equal(rows.get(name),digest); assert.equal(live,digest); const receiptAsset=receipt.assets.find((asset)=>asset.name===name); assert.equal(receiptAsset?.digest,digest);} assert.equal(request.session_relay.publication_receipt_sha256,"ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684");'
```

## Post-ship verification

| ID | Command | Expected |
|---|---|---|
| S1 | Run the exact `S1` block below once after ship. | `PUBLIC_PLAN_COMMIT` strictly descends from `PUBLIC_RELEASE_COMMIT`, changes no product path after review, archives exactly this plan, and retains the exact completion receipt line. |

### S1 — strict descendant and receipt retention

```bash
set -euo pipefail
test -z "$(git status --porcelain=v1 --untracked-files=all)"
FINISHED_PLAN=docs/plans/finished/2026-07-24-session-relay-cli-0.13.0-production-release.md
ACTIVE_PLAN=docs/plans/active/session-relay-cli-0.13.0-production-release.md
test -f "$FINISHED_PLAN"
test ! -e "$ACTIVE_PLAN"
PUBLIC_PLAN_COMMIT="$(git rev-parse HEAD)"
PUBLIC_RELEASE_COMMIT="$(PLAN_PATH="$FINISHED_PLAN" node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const prefix="Completion-review-receipt: "; const lines=fs.readFileSync(process.env.PLAN_PATH,"utf8").split(/\r?\n/).filter((line)=>line.startsWith(prefix)); assert.equal(lines.length,1); const r=JSON.parse(lines[0].slice(prefix.length)); assert.equal(r.schema,6); assert.equal(r.phase,"completion"); assert.equal(r.completion_verdict,"passed"); assert.match(r.reviewed_head,/^[0-9a-f]{40}$/); process.stdout.write(r.reviewed_head);')"
test "$PUBLIC_PLAN_COMMIT" != "$PUBLIC_RELEASE_COMMIT"
git merge-base --is-ancestor "$PUBLIC_RELEASE_COMMIT" "$PUBLIC_PLAN_COMMIT"
git diff --quiet "$PUBLIC_RELEASE_COMMIT..$PUBLIC_PLAN_COMMIT" -- package.json SoT/toolchain.json cli/src/generated/sotPayload.ts cli/test/lib/harness.ts cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts .github/workflows/release-cli.yml bun.lock
PRE_SHIP_RECEIPT="$(git show "$PUBLIC_PLAN_COMMIT^:$ACTIVE_PLAN" | sed -n '/^Completion-review-receipt: /p')"
POST_SHIP_RECEIPT="$(sed -n '/^Completion-review-receipt: /p' "$FINISHED_PLAN")"
test -n "$PRE_SHIP_RECEIPT"
test "$POST_SHIP_RECEIPT" = "$PRE_SHIP_RECEIPT"
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const text=fs.readFileSync(process.argv[1],"utf8"); assert.match(text,/^status: finished$/m); assert.match(text,/^ship_commit: [0-9a-f]{40}$/m);' "$FINISHED_PLAN"
```

## Out of scope / do-NOT-touch

- Do not modify `bun.lock`, `.github/workflows/release-cli.yml`, `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, installer/runtime source, build scripts, goldens, other SoT entries, documentation, changelogs, or any product path beyond the exact four affected paths.
- Within `cli/test/lib/harness.ts`, do not change any source except adding the current SoT-derived verified Session Relay version and substituting it into the existing materialized script. Do not weaken reinstall coverage, change curl behavior, alter stubs, edit snapshot normalization, or hardcode `0.13.0`.
- Do not edit, supersede, finish, unblock, or otherwise mutate `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md`; its immutable companion role and historical blocked evidence remain truthful.
- Do not change any field of `package.json` except top-level `version`; do not change any `SoT/toolchain.json` content outside the complete Session Relay entry; do not hand-edit the generated payload.
- Do not create, amend, retarget, delete, force-update, or reuse an existing `cli-v0.10.2` tag or Release. Do not dispatch a workflow manually or create a second run.
- Do not push the branch or public `main` from this child. The sole authorized remote mutation is the one exact tag push after a passed completion receipt. The parent session may push public `main` only after the finished plan and S1 read-back if required.
- Do not mutate the Docks repository, Session Relay tag/Release, npm package metadata, or external production systems. They are evidence sources except for the canonical public tag-triggered workflow.
- Do not review, start, complete, mark production steps, or ship outside current schema-6 plan-manager ownership.

## Known gotchas

- `cli/src/generated/sotPayload.ts` is derived from both `package.json` and SoT. A manual edit, missing regeneration, or generator run before both source edits creates drift.
- The shared harness's materialized Session Relay script must derive its version from the current SoT pin. A hardcoded fixture version becomes stale on the next pin and can falsely drive frozen plugin-refresh tests into the reinstall path; the observed A6 failure demonstrates this invariant and is not a waiver.
- The public workflow may conclude successfully while npm publish is downgraded to a warning; P3 is mandatory independent npm proof.
- GitHub Actions, Release assets, and npm visibility are eventually consistent. Only the bounded discovery/readiness loops are allowed; timeout is terminal and never authorizes a second run, tag replacement, or cache reuse.
- A tag push may reach the remote even when the client exits nonzero. Reconcile the exact remote ref once; continue only when it equals `PUBLIC_RELEASE_COMMIT`, otherwise STOP. Never retry the push.
- `gh release create ... || true` can reuse an old Release. The pre-existing tag/Release/run/npm absence fence prevents reuse from being accepted.
- Plan-only start, receipt, step-row, and ship commits make ambient `HEAD` differ from `PUBLIC_RELEASE_COMMIT`; derive the tag target only from the receipt's `reviewed_head`.
- The Session Relay Release contains `SHA256SUMS` plus four source binaries; the public docks-kit stable Release contract contains `SHA256SUMS` plus five binaries. Never conflate the inventories or their checksum rows.
- `Completion-review-receipt:` is one compact machine-record line. Preserve the entire line byte-for-byte through ship; the payload hash and whole-line hash are different values.
- npm attempts cache writes even for `npm view`; every read requires its own writable mode-`0700` cache.

## Global constraints

- Exact public version/tag: `0.10.2` / `cli-v0.10.2`.
- Exact Session Relay version/tag/commit: `0.13.0` / `session-relay--v0.13.0` / `3fb9211f3309977f24853a10714d4b7a82b38c8f`.
- Exact request/receipt/source-proof SHA-256 chain: `d7ac63cbcbecc2840fd7c8e4c20e7a149b6b20c06ea53965762ec9d8308157b6` → `ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684` → `f9bfa06b8267b4d8f5a2489dbe515847feaee29a4c501a12f5717482fab7ed94`.
- Exact companion/refresh ancestry: `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172` → `e875475a7ddc91d3ed3301789f4e1933f46d60c1` → this plan's add-only creation commit.
- Product mutation set is exactly `package.json`, `SoT/toolchain.json`, `cli/src/generated/sotPayload.ts`, and `cli/test/lib/harness.ts`; this plan is the only additional changed path since `planned_at_commit`.
- The two named unit tests, workflow, and lockfile retain their exact companion-base blobs. The harness changes only the dynamic version source described above. No waiver or open question is authorized.
- Manager complete must produce a passed reusable schema-6 completion receipt before any tag or release mutation.
- Tag exactly `PUBLIC_RELEASE_COMMIT`, push only the tag once, wait for exactly one `release-cli.yml` run, and require success at that exact commit.
- No branch push, force operation, destructive tag operation, workflow dispatch, second run, or remote retry is authorized.
- Every failure stops and is reported; no final identity or evidence may be fabricated.

## STOP conditions

- STOP if the target tag, remote tag, GitHub Release, npm version, or any matching historical `release-cli.yml` run already exists before tag creation.
- STOP if request, publication receipt, source proof, source tag, assets, repository ids, versions, commits, or any exact hash differs from this plan.
- STOP if `PLAN_BASE` is not the direct child of `COMPANION_BASE`, the creation commit is not an add-only direct child of `PLAN_BASE`, or any required ancestry fails.
- STOP if the baseline package/toolchain/generated/harness values or blob ids differ, or if either frozen test, `.github/workflows/release-cli.yml`, or `bun.lock` drifts from `COMPANION_BASE`.
- STOP if any product path beyond the exact four changes, any required plan path besides this plan changes, the complete Session Relay entry differs from the request-derived object, or the harness diff is not the exact SoT-derived version correction.
- STOP if the harness retains a hardcoded materialized Session Relay version, weakens reinstall coverage, changes curl/stub/snapshot behavior, or requires a named test or golden edit.
- STOP if generator, focused tests, direct acceptance, full gate, completion review, receipt validation, or lifecycle operation fails or becomes stale after a later edit.
- STOP if completion does not yield exactly one passed reusable schema-6 receipt or if `reviewed_head` is not the exact implementation commit and ancestor of current `HEAD`.
- STOP if the one tag push cannot be reconciled to the exact remote ref, if more than one matching run exists, if the sole run targets another head or fails, or if any action would require retry/retag/force/manual dispatch.
- STOP if stable six-asset inventory/checksums, npm exact version, source four-asset checksums, or the preserved receipt chain disagrees.
- STOP if post-ship `PUBLIC_PLAN_COMMIT` is not a strict descendant of `PUBLIC_RELEASE_COMMIT`, contains a post-review product diff, or does not retain the exact receipt line.

## Cold-handoff checklist

- [x] File manifest: the exact four implementation paths, one lifecycle plan, frozen surfaces, external tag, Release, workflow, and npm surfaces are named.
- [x] Environment and commands: repository, Bun/tool versions, setup, generator, focused tests after the implementation commit, full gate, manager invocations, absence fence, tag push, sole-run wait, production checks, and fresh npm caches are exact.
- [x] Interface and data contracts: closed request, receipt/source-proof chain, complete toolchain object, SoT-derived harness version, four source assets, two commit identities, and stable six-asset inventory are explicit.
- [x] Executable acceptance: A1–A5 precede the exact four-file commit; focused A6, A7, and full A8 follow it; P1–P4 and S1 remain ordered with concrete exit-status and identity expectations.
- [x] Out of scope: named tests/workflow/lockfile/goldens/installer/other harness behavior/other SoT, companion plan, branch push, force/retag, manual workflow, and external-source mutation are prohibited.
- [x] Decision rationale: the observed A6 failure justifies one dynamic fixture-source correction without waiving the gate; receipt-derived tag identity, two-phase completion/production order, and strict post-ship identity separation remain explicit.
- [x] Known gotchas: generated payload, dynamic fixture version, npm warning downgrade, eventual consistency, nonzero push reconciliation, Release reuse, receipt identity, and inventory distinction are recorded.
- [x] Global constraints: all request versions, commits, hashes, asset digests, exact four-file mutation limit, lifecycle ownership, and STOP rules are copied exactly.
- [x] No undefined terms or forward references: every commit variable, authority file, command block, lifecycle operation, artifact, and proof surface is defined in this plan.

## Self-review

- `standalone_executability`: pass — a cold executor can revalidate all local/external authority, perform the exact four-file edit including the SoT-derived harness correction, invoke manager lifecycle operations, and execute the release without conversation context.
- `actionability`: pass — each step names exact paths, dependencies, commands, done conditions, and failure action; the harness source shape is explicit.
- `dependency_order`: pass — A1–A5 precede the exact four-file commit; focused A6, A7, and the one full A8 gate run on that committed tree before completion; production proof follows the completion receipt.
- `evidence_reverification`: pass — request, publication receipt, source proof, remote tag, four baseline blobs/values, frozen surfaces, generated payload, focused/full tests, workflow head, Release checksums, npm, and finished receipt are independently re-opened.
- `goal_coverage`: pass — package version, complete Session Relay pin, generated payload, dynamic harness fixture source, exact scope, single release, six assets/checksums, npm, source chain, and post-ship identity are all proven.
- `executable_acceptance`: pass — A4 proves the exact dynamic harness source correction, A6 exercises both frozen regression files after commit, A7 proves exact scope and immutable blobs, and A8 is the single full gate.
- `failure_modes`: pass — the observed A6 failure is recorded as rationale rather than waived; hardcoded fixture drift, weakened reinstall/curl behavior, nonzero tag push, and eventual consistency all have explicit STOP handling.
- `open_questions`: pass — the current user selected the exact four-file expansion; there are no waivers or unresolved decisions.

## Open questions

None — the current user's exact four-file scope decision, signed-off request, publication receipt chain, immutable companion baseline, lifecycle order, and release contract close every execution decision.

## Sources

- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json` — canonical public release authority; SHA-256 fixed above.
- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json` — canonical Session Relay publication receipt; SHA-256 fixed above.
- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/source-proof-v2.json` — receipt-bound source proof; SHA-256 fixed above.
- `package.json`, `SoT/toolchain.json`, `cli/src/generated/sotPayload.ts`, and `cli/test/lib/harness.ts` at `e875475a7ddc91d3ed3301789f4e1933f46d60c1` — exact implementation baseline and blob identities.
- `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, `.github/workflows/release-cli.yml`, and `bun.lock` at `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172` — immutable frozen surfaces.
- `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` — public source-preparation companion and frozen-test contract.
- `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md` — proven two-phase tag/run/Release/npm mechanics, adapted here to current schema-6 manager/reviewer ownership.
- `docs/plans/AGENTS.md` — current schema-6 five-skill ownership, creation boundary, lifecycle, and review contract.

## Review

(filled by main-context plan-manager after completion evidence)
Review-orchestration-state: {"apply_state":"none","current_input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","initial_input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_attempt":1,"phase":"draft","plan_path":"docs/plans/active/session-relay-cli-0.13.0-production-release.md","request_ids":["52b76e09-7cb3-4c5d-b7dd-8a65c91beec6"],"retry_authorization":null,"round_index":1,"schema":2,"series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","series_sha256":"de659b5457d23c7c57a21de254b28919e99da70f9cb300ab52bac8a8d252b7c6","state_sha256":"83f667740e54e27052d42efbff26000c5035ecd1d25d025581112546009c76a6","status":"passed","stop_reason":null,"terminal_evidence_sha256":null,"terminated_from_state":null,"terminated_from_state_sha256":null,"transitioned_from_state_sha256":null}
Review-receipt: {"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","outcome":"passed","phase":"draft","policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","pre_execution_eligible":true,"reproduced":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"reviewed_at":"2026-07-24T01:46:06-03:00","reviewed_commit":"62423ce4e74b93199696002389baaf6ca6b0c19c","reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"PublicFixtureAmendReviewer","denial_source":null,"exit_code":0,"output_started":true,"reason":"typed reviewer output returned by fresh sealed-bundle plan-reviewer task","result":"passed","schema":6,"signal":null,"started":true,"stderr_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","stdout_sha256":"23998ab91bc6d28f660d2c0d93caa6893c806289484e472ce7909c6f1b76f3b1","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reason":null,"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"result":"passed","reviewer_output":{"checklist":{"actionability":{"evidence":"Step 2 and A4 specify a byte-exact harness change: parse the repository's current SoT/toolchain.json, read tools[\"session-relay\"].verified into one module-level constant, and substitute only that value into the existing materialized script; the plan simultaneously fixes the package, tool entry, and generator-owned payload edits and prohibits every other harness change.","status":"pass"},"dependency_order":{"evidence":"The sealed Steps and Acceptance criteria order the fresh draft review and manager-owned unblock before authority checks and editing, place the SoT/package edits before payload generation and the dynamic harness correction, require A1-A5 before the exact four-file commit, require focused A6 then A7 and the single A8 gate on the committed tree before completion, and permit the tag mutation only after a passed completion receipt.","status":"pass"},"evidence_reverification":{"evidence":"A3 reopens pinned baseline and frozen-surface blob identities, A4 compares the implementation to the exact baseline and exact permitted harness transformation, A5 checks generated payload drift, A6 selects both unchanged named test files, and A7 rechecks the complete changed-path set plus the exact blobs for both tests, release-cli.yml, and bun.lock before completion.","status":"pass"},"executable_acceptance":{"evidence":"The plan supplies concrete exit-status checks for the exact structural harness replacement (A4), generator consistency (A5), the two frozen regression suites (A6), aggregate scope and immutable blobs (A7), and one full project gate (A8), followed by separately ordered receipt, tag, workflow, artifact, npm, source-chain, and post-ship identity checks.","status":"pass"},"failure_modes":{"evidence":"The sealed Known gotchas and STOP conditions expressly reject a hardcoded replacement version, any named-test/workflow/lockfile drift, weakened reinstall coverage, curl/stub/snapshot changes, generator drift, extra paths, stale or failed review evidence, retag/retry/manual dispatch, duplicate workflow runs, and inconsistent release or authority identities.","status":"pass"},"goal_coverage":{"evidence":"The affected-path manifest, Goal, Interfaces, Step 2, Out of scope, Global constraints, and STOP conditions consistently permit exactly package.json, SoT/toolchain.json, generated sotPayload.ts, and the one SoT-derived harness fixture correction while explicitly fencing the two named unit tests, workflow, lockfile, installer behavior, curl/stubs, snapshots, goldens, and every other product path.","status":"pass"},"open_questions":{"evidence":"The sealed plan records the current user's exact four-file scope authorization, states that the observed frozen-test failure motivates rather than waives the one harness correction, defines its exact source shape, and closes Open questions with no unresolved interface, scope, or safety decision.","status":"pass"},"standalone_executability":{"evidence":"The sealed plan defines the public repository, immutable companion and plan bases, exact four affected implementation paths, exact SoT-derived harness transformation, lifecycle owner, release identity, and ordered local and production commands with STOP behavior, so a cold executor does not need unstated amendment context.","status":"pass"}},"findings":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"role":"primary","schema":6,"verdict":"pass"},"role":"primary","schema":6,"selected":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"waiver":null,"waiver_sha256":null},"rejected":[]},"schema":6,"series":{"current_input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","initial_input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","repairs":[],"rounds":[{"kind":"draft","outcome":"passed","pre_execution_eligible":true,"reproduced":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"reviewer":{"accepted_finding_ids":[],"raw":{"attempts":[{"candidate":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"child_id":"PublicFixtureAmendReviewer","denial_source":null,"exit_code":0,"output_started":true,"reason":"typed reviewer output returned by fresh sealed-bundle plan-reviewer task","result":"passed","schema":6,"signal":null,"started":true,"stderr_sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","stdout_sha256":"23998ab91bc6d28f660d2c0d93caa6893c806289484e472ce7909c6f1b76f3b1","timeout_mode":"orchestrator_tool","timeout_seconds":600}],"findings_sha256":"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945","reason":null,"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"result":"passed","reviewer_output":{"checklist":{"actionability":{"evidence":"Step 2 and A4 specify a byte-exact harness change: parse the repository's current SoT/toolchain.json, read tools[\"session-relay\"].verified into one module-level constant, and substitute only that value into the existing materialized script; the plan simultaneously fixes the package, tool entry, and generator-owned payload edits and prohibits every other harness change.","status":"pass"},"dependency_order":{"evidence":"The sealed Steps and Acceptance criteria order the fresh draft review and manager-owned unblock before authority checks and editing, place the SoT/package edits before payload generation and the dynamic harness correction, require A1-A5 before the exact four-file commit, require focused A6 then A7 and the single A8 gate on the committed tree before completion, and permit the tag mutation only after a passed completion receipt.","status":"pass"},"evidence_reverification":{"evidence":"A3 reopens pinned baseline and frozen-surface blob identities, A4 compares the implementation to the exact baseline and exact permitted harness transformation, A5 checks generated payload drift, A6 selects both unchanged named test files, and A7 rechecks the complete changed-path set plus the exact blobs for both tests, release-cli.yml, and bun.lock before completion.","status":"pass"},"executable_acceptance":{"evidence":"The plan supplies concrete exit-status checks for the exact structural harness replacement (A4), generator consistency (A5), the two frozen regression suites (A6), aggregate scope and immutable blobs (A7), and one full project gate (A8), followed by separately ordered receipt, tag, workflow, artifact, npm, source-chain, and post-ship identity checks.","status":"pass"},"failure_modes":{"evidence":"The sealed Known gotchas and STOP conditions expressly reject a hardcoded replacement version, any named-test/workflow/lockfile drift, weakened reinstall coverage, curl/stub/snapshot changes, generator drift, extra paths, stale or failed review evidence, retag/retry/manual dispatch, duplicate workflow runs, and inconsistent release or authority identities.","status":"pass"},"goal_coverage":{"evidence":"The affected-path manifest, Goal, Interfaces, Step 2, Out of scope, Global constraints, and STOP conditions consistently permit exactly package.json, SoT/toolchain.json, generated sotPayload.ts, and the one SoT-derived harness fixture correction while explicitly fencing the two named unit tests, workflow, lockfile, installer behavior, curl/stubs, snapshots, goldens, and every other product path.","status":"pass"},"open_questions":{"evidence":"The sealed plan records the current user's exact four-file scope authorization, states that the observed frozen-test failure motivates rather than waives the one harness correction, defines its exact source shape, and closes Open questions with no unresolved interface, scope, or safety decision.","status":"pass"},"standalone_executability":{"evidence":"The sealed plan defines the public repository, immutable companion and plan bases, exact four affected implementation paths, exact SoT-derived harness transformation, lifecycle owner, release identity, and ordered local and production commands with STOP behavior, so a cold executor does not need unstated amendment context.","status":"pass"}},"findings":[],"request":{"acceptance_inventory_sha256":null,"author":{"company":"openai","effort":"high","model":"gpt-5.6-sol","tool":"codex"},"bundle_sha256":"7cca621d6336a2f3eaa49e4b0fcf5d260c71bd72c5af7f2443fe8ab7ea751545","diff_sha256":null,"execution_base_commit":null,"input_sha256":"f6cdb8ac4ebe7faff146ce49c01b19300172e7e58100a769beae6018e66fb5e2","lifecycle_intent":"none","orchestration_series_id":"c4b6c738-f72f-4799-be1f-cd3d28e110e4","orchestration_state_sha256":"ecb9f9d0759f25533a5070ce3f3c69c9d4e70b45293286134bab89b7bd2eb6a4","phase":"draft","planned_at_commit":null,"policy":{"candidates":[{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"}],"fallback":"none","max_rounds":2,"provenance":{"candidates":"runtime_global","fallback":"skill_default","max_rounds":"skill_default","role":"skill_default"},"role":"primary","schema":6},"policy_sha256":"4317663e576334beacd0f174120385311e3f9d36f86101ee888437eab438800f","previous_input_sha256":null,"repair_targets_sha256":null,"request_id":"52b76e09-7cb3-4c5d-b7dd-8a65c91beec6","review_mode":"full","reviewed_commit_or_head":"62423ce4e74b93199696002389baaf6ca6b0c19c","round_index":1,"schema":6},"role":"primary","schema":6,"verdict":"pass"},"role":"primary","schema":6,"selected":{"company":"openai","effort":"high","model":"gpt-5.6-sol","service_tier":"default","tool":"codex"},"waiver":null,"waiver_sha256":null},"rejected":[]},"schema":6}],"schema":6},"settled_orchestration_state_sha256":"83f667740e54e27052d42efbff26000c5035ecd1d25d025581112546009c76a6"}
