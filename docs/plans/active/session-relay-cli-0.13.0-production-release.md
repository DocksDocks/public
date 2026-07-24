---
title: Release docks-kit 0.10.2 with Session Relay 0.13.0
goal: Publish docks-kit 0.10.2 from the retained four-file implementation and one reviewed four-artifact expectation commit, prove the single immutable release, and preserve the Session Relay authority chain.
status: blocked
created: "2026-07-24T00:24:06-03:00"
updated: "2026-07-24T02:23:25-03:00"
started_at: "2026-07-24T04:30:00.000Z"
blocked_reason: "The first full A8 at `f562ffde3b12c98072b02166c92c85ffbc6d90f9` passed the generator check and typecheck, then `bun run test:unit` failed only because `cli/test/unit/toolchain.test.ts` and `cli/test/unit/engine-di.test.ts` still expected Session Relay `0.12.0` output after the authorized pin became `0.13.0`. No later A8 stage ran; both recorder-owned goldens also still contain generated `0.12.0` output. The current user authorized exactly the two deterministic unit expectation updates plus canonical regeneration of the two goldens. This is not behavioral weakening. The plan remains blocked until a fresh changed-input schema-6 review passes and plan-manager consumes the current user's explicit unblock intent."
blocked_since: "2026-07-24T02:23:25-03:00"
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
  - cli/test/unit/toolchain.test.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
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

Retain the reviewed four-file implementation commit `f562ffde3b12c98072b02166c92c85ffbc6d90f9`, add one separately reviewed commit containing only two deterministic unit expectation updates and the two canonical recorder outputs, then tag the passed completion-reviewed head as `cli-v0.10.2`, prove the sole workflow run, stable six-asset Release, npm publication, and preserved authority chain, and finally archive this plan in a distinct plan-only descendant.

## Context & rationale

The canonical `PublicReleaseRequestV1` is `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json`, with SHA-256 `d7ac63cbcbecc2840fd7c8e4c20e7a149b6b20c06ea53965762ec9d8308157b6`. It authorizes repository `DocksDocks/public`, docks-kit version/tag `0.10.2` / `cli-v0.10.2`, companion base `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`, and Session Relay `0.13.0` source tag `session-relay--v0.13.0` at `3fb9211f3309977f24853a10714d4b7a82b38c8f`.

The request binds the Session Relay publication receipt by SHA-256 `ebc53d1570e0124f5f27eb949af36091f3494bcca7d5cf001f646f967713c684`. The exact receipt is `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json`; it in turn binds `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/source-proof-v2.json` by SHA-256 `f9bfa06b8267b4d8f5a2489dbe515847feaee29a4c501a12f5717482fab7ed94`. Preserve this request → publication receipt → source proof chain as evidence; do not reconstruct, normalize, overwrite, or substitute any member.

`planned_at_commit` is the schema-6 workspace refresh commit `e875475a7ddc91d3ed3301789f4e1933f46d60c1`, whose parent is the immutable public companion base `6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`. The refresh changes only plan-workspace contract files and is not an implementation affected path. The release baseline is package `0.10.1`; the complete production Session Relay entry is still `0.12.0`, tag `session-relay--v0.12.0`, plugin version `0.12.0`, and the four old production assets; the generated payload declares package `0.10.1`; and `cli/test/lib/harness.ts` materializes `session-relay 0.12.0`. The source-preparation plan froze installer behavior. The current user's earlier four-file authorization produced the retained implementation commit; the present authorization adds only deterministic expectation artifacts and does not reopen product behavior.
The already observed A6 failure is the reason for this exact scope expansion, not a waiver: after the intended `0.13.0` pin, three frozen `pluginRefresh` assertions entered the reinstall branch because the shared harness still materialized `0.12.0`; the default curl stub then correctly exited without synthesizing installer artifacts. Reading the current `tools["session-relay"].verified` value in the harness restores the fixture invariant without weakening reinstall coverage or curl behavior.

`PUBLIC_IMPLEMENTATION_COMMIT=f562ffde3b12c98072b02166c92c85ffbc6d90f9` is the existing reviewed implementation commit. Its sole parent is `64757517c747b592bd566c18921e602e44a6dd5e`, its own diff is exactly `package.json`, `SoT/toolchain.json`, `cli/src/generated/sotPayload.ts`, and `cli/test/lib/harness.ts`, and those four blobs are immutable from this point forward. The fresh amendment does not reopen the Docks implementation, Session Relay protocol, pin, generator, or harness design.

The first A8 on that committed tree is superseded failed evidence, not a waiver and not final-gate credit. `bun cli/scripts/generate-sot-payload.ts --check` and `bun run typecheck` passed; `bun run test:unit` then failed exactly two stale expected strings: `cli/test/unit/toolchain.test.ts` expected Session Relay version/tag `0.12.0`, and `cli/test/unit/engine-di.test.ts` expected the corresponding dry-run log at `0.12.0`. The POSIX smoke, both normal goldens, and both prove-red checks did not run. A read-only grep also found recorder-owned `0.12.0` outputs in both golden files, so their deterministic closure is canonical recorder regeneration after the pin change.

After fresh changed-input review and explicit unblock, update only the two stale `0.12.0` expectation fragments to `0.13.0` in each named unit file. Then run `bun cli/test/golden-dryrun.ts --update-goldens` and `bun cli/test/golden-mutation.ts --update-goldens`; never hand-edit either JSON. Commit exactly those four test artifacts once as `PUBLIC_TEST_ARTIFACT_COMMIT`. `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, `.github/workflows/release-cli.yml`, and `bun.lock` remain byte-identical.

Release identity is deliberately three-stage. `PUBLIC_IMPLEMENTATION_COMMIT` is the retained exact four-file commit above. `PUBLIC_TEST_ARTIFACT_COMMIT` is the one future commit whose own diff contains exactly the two unit expectation files and two recorder-owned golden files. `PUBLIC_RELEASE_COMMIT` is the later exact `reviewed_head` from the passed reusable schema-6 `Completion-review-receipt:`; it contains both artifact commits and the exact eight affected-path closure. Only after that receipt exists may the executor prove absence, create lightweight `cli-v0.10.2` at that exact commit, and push that tag once. `PUBLIC_PLAN_COMMIT` is the later plan-manager ship/archive commit; it must be a strict descendant of `PUBLIC_RELEASE_COMMIT` and preserve the exact completion receipt. The parent session, not this child plan, may push public `main` after the finished-plan read-back.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, repository id `DocksDocks/public`; remain on the assigned branch and do not create or switch branches.
- Creation/drift base: `PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1`; companion base: `COMPANION_BASE=6c07f9bc02ef7a0a26b8ffb539c16c42a87a3172`.
- Runtime: Bun `1.3.14` from `SoT/toolchain.json`; TypeScript `7.0.2`; Vitest through `bun run test:unit`; GitHub reads/tag push through authenticated `gh`/`git`; npm reads through `npm view`.
- Disposable checkout setup, when dependencies are absent: `bun install --frozen-lockfile`. This setup must not change `bun.lock`; STOP if it does.
- Generator write/check: the retained implementation already ran `bun cli/scripts/generate-sot-payload.ts`; revalidate with `bun cli/scripts/generate-sot-payload.ts --check`.
- Golden recorder writes, after the two unit expectations change: `bun cli/test/golden-dryrun.ts --update-goldens`, then `bun cli/test/golden-mutation.ts --update-goldens`. These are the only authorized golden writers.
- Focused tests after the exact four-artifact commit: `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts`.
- Lifecycle ownership: current schema-6 `plan-manager` alone performs the fresh changed-input draft review while status remains `blocked`, consumes the current user's explicit unblock intent only after a pass, persists completion review/receipt evidence, closes post-production rows, and ships/archives. Current `plan-reviewer` is read-only and current `plan-repairer` may return only one exact accepted-blocker patch to the manager. The implementation worker never writes receipt or lifecycle state directly.
- Exact completion invocation after `PUBLIC_TEST_ARTIFACT_COMMIT` and the fresh A1–A8 pass: `plan-manager complete docs/plans/active/session-relay-cli-0.13.0-production-release.md`. Require `review_status: passed`, one reusable schema-6 `Completion-review-receipt:`, and `PUBLIC_RELEASE_COMMIT=receipt.reviewed_head`.
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

`package.json`, `SoT/toolchain.json`, `cli/src/generated/sotPayload.ts`, and `cli/test/lib/harness.ts` are fixed at `PUBLIC_IMPLEMENTATION_COMMIT`. The two unit edits replace only their stale expected Session Relay version/tag fragments from `0.12.0` to `0.13.0`; no setup, assertion structure, branch, or product behavior changes. `cli/test/goldens/dryrun.json` and `cli/test/goldens/mutation.json` are never hand-edited: their only valid new bytes are the outputs of the existing `--update-goldens` recorders after the retained source/pin change. A second recorder run on the committed artifact tree must be byte-idempotent.

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

The harness baseline blob is at `PLAN_BASE`. The two protected unit-test blobs, workflow blob, and lockfile blob are identical at `COMPANION_BASE` and remain identical at `PUBLIC_IMPLEMENTATION_COMMIT`. The creation commit is the unique add commit for this plan and must have `PLAN_BASE` as its sole parent. Every later artifact/completion head must retain both `PLAN_BASE` and `PUBLIC_IMPLEMENTATION_COMMIT` ancestry.

At `PUBLIC_IMPLEMENTATION_COMMIT`, the exact affected-path blobs are:

```text
package.json                                      1d8f41307f85c9e6a3b6e57cf08d6d4ad4df820d
SoT/toolchain.json                                f4cc4ce240cb453490224f0c5513a7e694181696
cli/src/generated/sotPayload.ts                   e55961b6b900bdf6df43c11244b52e54f4764ae1
cli/test/lib/harness.ts                            afc41cf73c914e5241ec1216230309124bef6cb0
cli/test/unit/toolchain.test.ts                    13ad37a53b4f858047e3b28ae61809c2f6507e34
cli/test/unit/engine-di.test.ts                    f0e5fb4ac6d401ea3597498ad1065da3fb4c2d5b
cli/test/goldens/dryrun.json                       08d63f34b9af6d0eb20a5333c1593b5f5f2f2f49
cli/test/goldens/mutation.json                     c912d77a3ab192b906790bee00b63aa55e755707
```

The last four are the exact pre-expectation artifact blobs. They may change only together in `PUBLIC_TEST_ARTIFACT_COMMIT` under the deterministic contract above. Protected blobs remain `cli/test/unit/sessionRelayCli.test.ts` `265e3a99a6c0e713a72c9d6b1f3d5d2638010613`, `cli/test/unit/pluginRefresh.test.ts` `7f8dd6507c8ed6ee5ac2549894aaa349cf0ef650`, `.github/workflows/release-cli.yml` `8c41f18c7dac2d4c21e359955f154f8f3f2a9342`, and `bun.lock` `1385eccc045a42485748a18613c1a98961dd54cf`.

### Release and plan identities

- `PUBLIC_IMPLEMENTATION_COMMIT`: exact `f562ffde3b12c98072b02166c92c85ffbc6d90f9`; its own diff is exactly the retained four implementation paths and its parent is exact `64757517c747b592bd566c18921e602e44a6dd5e`.
- `PUBLIC_TEST_ARTIFACT_COMMIT`: the sole commit after `PUBLIC_IMPLEMENTATION_COMMIT` that touches any test artifact; its own diff is exactly `cli/test/unit/toolchain.test.ts`, `cli/test/unit/engine-di.test.ts`, `cli/test/goldens/dryrun.json`, and `cli/test/goldens/mutation.json`.
- `PUBLIC_RELEASE_COMMIT`: exact 40-lowercase-hex `reviewed_head` in the sole passed reusable schema-6 completion receipt; contains the exact eight affected-path closure plus this plan; exact target of lightweight tag `cli-v0.10.2`.
- `PUBLIC_PLAN_COMMIT`: exact full `HEAD` after plan-manager ship; differs from and strictly descends from `PUBLIC_RELEASE_COMMIT`; the `PUBLIC_RELEASE_COMMIT..PUBLIC_PLAN_COMMIT` affected-path diff is empty; the finished plan retains a byte-identical `Completion-review-receipt:` line from its pre-ship parent.
- Finished path: exactly `docs/plans/finished/2026-07-24-session-relay-cli-0.13.0-production-release.md`.

### Public release artifacts

The sole `release-cli.yml` run for `cli-v0.10.2` must have `head_sha == PUBLIC_RELEASE_COMMIT` and conclude `success`. The stable GitHub Release inventory is exactly six assets: `SHA256SUMS`, `docks-kit-linux-x64`, `docks-kit-linux-arm64`, `docks-kit-darwin-x64`, `docks-kit-darwin-arm64`, and `docks-kit-windows-x64.exe`. `SHA256SUMS` must name exactly the five binaries once each, and `sha256sum -c SHA256SUMS` must validate all five. npm must return exact `docks-kit@0.10.2` version `0.10.2` through a fresh mode-`0700` cache.

## Steps

| # | Task | Files | Depends | Status | Done when / failure action |
|---|---|---|---|---|---|
| 1 | Preserve the reviewed implementation commit and record the first A8 outcome without treating it as acceptance credit. | `package.json`; `SoT/toolchain.json`; `cli/src/generated/sotPayload.ts`; `cli/test/lib/harness.ts`; this plan for evidence only | — | done | `PUBLIC_IMPLEMENTATION_COMMIT=f562ffde3b12c98072b02166c92c85ffbc6d90f9`; its own diff is exactly four files; generator check/typecheck passed there; full A8 stopped at exactly two stale unit expectations before later stages. |
| 2 | Obtain the fresh changed-input schema-6 draft review while the plan remains blocked; only after it passes, have plan-manager consume the current user's explicit unblock intent, then rerun A1–A3 before any artifact edit. | This plan only for manager-owned review/unblock commits; authority files and retained implementation are read-only | 1 | blocked | The plan returns to `ongoing` with its existing execution base retained only after the exact amended input passes review; A1–A3 pass; STOP on any hash, identity, ancestry, protected blob, review, or unblock mismatch. |
| 3 | Replace only the stale `0.12.0` expected version/tag fragments with `0.13.0` in the two authorized unit files, regenerate both JSON goldens only through their existing recorders, and commit exactly those four artifacts once. Then run A4–A8 on the clean committed tree before invoking completion. | `cli/test/unit/toolchain.test.ts`; `cli/test/unit/engine-di.test.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; this plan for manager-owned rows/receipt/status | 2 | planned | `PUBLIC_TEST_ARTIFACT_COMMIT` is the sole post-implementation commit touching any artifact and its own diff is exactly four files; A4 proves exact unit replacements and recorder idempotence; A6, A7, and fresh A8 pass; completion yields one passed reusable schema-6 receipt whose reviewed head contains exact eight-path closure. |
| 4 | Derive `PUBLIC_RELEASE_COMMIT` only from the receipt, run the complete absence preflight, create lightweight `cli-v0.10.2` at that exact commit, push only the tag once with nonzero reconciliation, and wait for exactly one workflow run. | Git tag, GitHub Actions, GitHub Release, and npm read surfaces only; no worktree product file | 3 | planned | All five absence surfaces pass before mutation; local/remote tag targets equal `PUBLIC_RELEASE_COMMIT`; exactly one matching run exists and succeeds at that head. STOP rather than retag, retry, or create another run. |
| 5 | Run P1–P4, have plan-manager mark Steps 4–5 done, ship/archive the plan, and run S1 against the exact finished path. | This plan for manager-owned lifecycle/archive; GitHub/npm/source Release read-only evidence | 4 | planned | Production identities, run, six assets/checksums, npm, and Session Relay chain all pass; the finished plan retains the receipt and `PUBLIC_PLAN_COMMIT` is a strict plan-only descendant of `PUBLIC_RELEASE_COMMIT`. |

## Acceptance criteria

After fresh review passes and plan-manager consumes the explicit unblock intent, run A1–A3 on the retained tree, make and commit exactly the four deterministic test artifacts, then run A4–A7 and one fresh A8 in order on the clean committed tree before completion review. The failed A8 at `PUBLIC_IMPLEMENTATION_COMMIT` is superseded evidence only. The fresh A8 is required because implementation/test-artifact bytes changed. Production P1–P4 runs only after the exact absence/tag/wait blocks above; S1 runs only after plan-manager ship.

| ID | Command | Expected |
|---|---|---|
| A1 | Run the exact `A1` block below. | Request, publication receipt, source proof, asset digests, and both repository/version/tag/commit chains are byte-hash-bound and exact. |
| A2 | Run the exact `A2` block below. | The immutable Session Relay source tag resolves exactly to `3fb9211f3309977f24853a10714d4b7a82b38c8f`. |
| A3 | Run the exact `A3` block below. | Companion → refresh → creation ancestry, exact `PUBLIC_IMPLEMENTATION_COMMIT` parent/diff/blobs, exact pre-expectation artifact blobs, and protected blobs are proven. |
| A4 | Run the exact `A4` block below. | The first four affected paths remain byte-identical to `PUBLIC_IMPLEMENTATION_COMMIT`; the two unit files contain only the exact `0.12.0` → `0.13.0` expectation replacements; rerunning both canonical recorders changes no committed golden byte. |
| A5 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; retained payload embeds package `0.10.2` and exact current SoT bytes. |
| A6 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts` | Exit 0 after `PUBLIC_TEST_ARTIFACT_COMMIT`; frozen Session Relay/plugin regressions and both corrected deterministic expectations are green without behavioral weakening. |
| A7 | Run the exact `A7` block below. | Since `PLAN_BASE`, the changed set is exactly the eight affected paths plus this plan; the retained implementation and sole four-artifact commit identities hold; protected files remain byte-identical; worktree is clean. |
| A8 | Run the exact `A8` block below once after A7. | Fresh generator check, typecheck, all unit tests, POSIX statusline smoke, both normal goldens, and both prove-red checks pass on the final eight-path tree. |

### Superseded first A8 evidence — no acceptance credit

At exact `PUBLIC_IMPLEMENTATION_COMMIT`, the first A8 passed its generator check and typecheck, then `bun run test:unit` failed exactly two stale expected outputs: `cli/test/unit/toolchain.test.ts` still expected Session Relay/tag `0.12.0`, and `cli/test/unit/engine-di.test.ts` still expected the dry-run Session Relay log at `0.12.0`. No POSIX smoke, normal golden, or prove-red stage ran. Both recorder-owned JSON files still contain generated `0.12.0` output. This evidence is superseded by the exact four-artifact closure and mandatory fresh A8; it never counts as passed completion evidence.

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
PUBLIC_IMPLEMENTATION_COMMIT=f562ffde3b12c98072b02166c92c85ffbc6d90f9
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT^")" = 64757517c747b592bd566c18921e602e44a6dd5e
PUBLIC_IMPLEMENTATION_COMMIT="$PUBLIC_IMPLEMENTATION_COMMIT" node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const changed=execFileSync("git",["diff-tree","--no-commit-id","--name-only","-r","-z",process.env.PUBLIC_IMPLEMENTATION_COMMIT],{encoding:"utf8"}).split("\0").filter(Boolean).sort(); assert.deepEqual(changed,["SoT/toolchain.json","cli/src/generated/sotPayload.ts","cli/test/lib/harness.ts","package.json"].sort());'
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:package.json")" = 1d8f41307f85c9e6a3b6e57cf08d6d4ad4df820d
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:SoT/toolchain.json")" = f4cc4ce240cb453490224f0c5513a7e694181696
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/src/generated/sotPayload.ts")" = e55961b6b900bdf6df43c11244b52e54f4764ae1
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/test/lib/harness.ts")" = afc41cf73c914e5241ec1216230309124bef6cb0
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/test/unit/toolchain.test.ts")" = 13ad37a53b4f858047e3b28ae61809c2f6507e34
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/test/unit/engine-di.test.ts")" = f0e5fb4ac6d401ea3597498ad1065da3fb4c2d5b
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/test/goldens/dryrun.json")" = 08d63f34b9af6d0eb20a5333c1593b5f5f2f2f49
test "$(git rev-parse "$PUBLIC_IMPLEMENTATION_COMMIT:cli/test/goldens/mutation.json")" = c912d77a3ab192b906790bee00b63aa55e755707
```

### A4 — exact deterministic test artifacts

```bash
set -euo pipefail
PUBLIC_IMPLEMENTATION_COMMIT=f562ffde3b12c98072b02166c92c85ffbc6d90f9
git diff --quiet "$PUBLIC_IMPLEMENTATION_COMMIT..HEAD" -- package.json SoT/toolchain.json cli/src/generated/sotPayload.ts cli/test/lib/harness.ts
PUBLIC_IMPLEMENTATION_COMMIT="$PUBLIC_IMPLEMENTATION_COMMIT" node --input-type=module <<'NODE'
import fs from "node:fs"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
const show = (path) => execFileSync("git", ["show", `${process.env.PUBLIC_IMPLEMENTATION_COMMIT}:${path}`], { encoding: "utf8" })
for (const row of [
  { path: "cli/test/unit/toolchain.test.ts", old: "0\\.12\\.0", next: "0\\.13\\.0", count: 2 },
  { path: "cli/test/unit/engine-di.test.ts", old: "0.12.0", next: "0.13.0", count: 2 },
]) {
  const before = show(row.path)
  const after = fs.readFileSync(row.path, "utf8")
  const parts = before.split(row.old)
  assert.equal(parts.length - 1, row.count)
  assert.equal(after, parts.join(row.next))
}
NODE
bun cli/test/golden-dryrun.ts --update-goldens
bun cli/test/golden-mutation.ts --update-goldens
git diff --quiet -- cli/test/goldens/dryrun.json cli/test/goldens/mutation.json
```

### A7 — exact scope, artifact commits, and protected surfaces

```bash
set -euo pipefail
PLAN_BASE=e875475a7ddc91d3ed3301789f4e1933f46d60c1
PUBLIC_IMPLEMENTATION_COMMIT=f562ffde3b12c98072b02166c92c85ffbc6d90f9
node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const actual=execFileSync("git",["diff","--name-only","--no-renames","-z","e875475a7ddc91d3ed3301789f4e1933f46d60c1","HEAD"],{encoding:"utf8"}).split("\0").filter(Boolean).sort(); const expected=["package.json","SoT/toolchain.json","cli/src/generated/sotPayload.ts","cli/test/lib/harness.ts","cli/test/unit/toolchain.test.ts","cli/test/unit/engine-di.test.ts","cli/test/goldens/dryrun.json","cli/test/goldens/mutation.json","docs/plans/active/session-relay-cli-0.13.0-production-release.md"].sort(); assert.deepEqual(actual,expected);'
git diff --quiet "$PUBLIC_IMPLEMENTATION_COMMIT..HEAD" -- package.json SoT/toolchain.json cli/src/generated/sotPayload.ts cli/test/lib/harness.ts
TEST_COMMIT_ROWS="$(git log --format=%H "$PUBLIC_IMPLEMENTATION_COMMIT..HEAD" -- cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts cli/test/goldens/dryrun.json cli/test/goldens/mutation.json)"
test "$(printf '%s\n' "$TEST_COMMIT_ROWS" | sed '/^$/d' | wc -l)" -eq 1
PUBLIC_TEST_ARTIFACT_COMMIT="$TEST_COMMIT_ROWS"
git merge-base --is-ancestor "$PUBLIC_IMPLEMENTATION_COMMIT" "$PUBLIC_TEST_ARTIFACT_COMMIT"
git merge-base --is-ancestor "$PUBLIC_TEST_ARTIFACT_COMMIT" HEAD
PUBLIC_TEST_ARTIFACT_COMMIT="$PUBLIC_TEST_ARTIFACT_COMMIT" node --input-type=module -e 'import assert from "node:assert/strict"; import {execFileSync} from "node:child_process"; const changed=execFileSync("git",["diff-tree","--no-commit-id","--name-only","-r","-z",process.env.PUBLIC_TEST_ARTIFACT_COMMIT],{encoding:"utf8"}).split("\0").filter(Boolean).sort(); assert.deepEqual(changed,["cli/test/unit/toolchain.test.ts","cli/test/unit/engine-di.test.ts","cli/test/goldens/dryrun.json","cli/test/goldens/mutation.json"].sort());'
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
git diff --quiet "$PUBLIC_RELEASE_COMMIT..$PUBLIC_PLAN_COMMIT" -- package.json SoT/toolchain.json cli/src/generated/sotPayload.ts cli/test/lib/harness.ts cli/test/unit/toolchain.test.ts cli/test/unit/engine-di.test.ts cli/test/goldens/dryrun.json cli/test/goldens/mutation.json cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts .github/workflows/release-cli.yml bun.lock
PRE_SHIP_RECEIPT="$(git show "$PUBLIC_PLAN_COMMIT^:$ACTIVE_PLAN" | sed -n '/^Completion-review-receipt: /p')"
POST_SHIP_RECEIPT="$(sed -n '/^Completion-review-receipt: /p' "$FINISHED_PLAN")"
test -n "$PRE_SHIP_RECEIPT"
test "$POST_SHIP_RECEIPT" = "$PRE_SHIP_RECEIPT"
node --input-type=module -e 'import fs from "node:fs"; import assert from "node:assert/strict"; const text=fs.readFileSync(process.argv[1],"utf8"); assert.match(text,/^status: finished$/m); assert.match(text,/^ship_commit: [0-9a-f]{40}$/m);' "$FINISHED_PLAN"
```

## Out of scope / do-NOT-touch

- Do not modify `bun.lock`, `.github/workflows/release-cli.yml`, `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, installer/runtime source, build scripts, other SoT entries, documentation, changelogs, or any product/test path beyond the exact eight affected paths.
- The first four affected paths are immutable at `PUBLIC_IMPLEMENTATION_COMMIT`. In `cli/test/unit/toolchain.test.ts` and `cli/test/unit/engine-di.test.ts`, change only the stale expected version/tag fragments from `0.12.0` to `0.13.0`. Write `cli/test/goldens/dryrun.json` and `cli/test/goldens/mutation.json` only through the existing `--update-goldens` recorders; never hand-edit them.
- Do not edit, supersede, finish, unblock, or otherwise mutate `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md`; its immutable companion role and historical blocked evidence remain truthful.
- Do not change any field of `package.json` except top-level `version`; do not change any `SoT/toolchain.json` content outside the complete Session Relay entry; do not hand-edit the generated payload.
- Do not create, amend, retarget, delete, force-update, or reuse an existing `cli-v0.10.2` tag or Release. Do not dispatch a workflow manually or create a second run.
- Do not push the branch or public `main` from this child. The sole authorized remote mutation is the one exact tag push after a passed completion receipt. The parent session may push public `main` only after the finished plan and S1 read-back if required.
- Do not mutate the Docks repository, Session Relay tag/Release, npm package metadata, or external production systems. They are evidence sources except for the canonical public tag-triggered workflow.
- Do not review, start, complete, mark production steps, or ship outside current schema-6 plan-manager ownership.

## Known gotchas

- `cli/src/generated/sotPayload.ts` is derived from both `package.json` and SoT. A manual edit, missing regeneration, or generator run before both source edits creates drift.
- The shared harness's materialized Session Relay script must derive its version from the current SoT pin. A hardcoded fixture version becomes stale on the next pin and can falsely drive frozen plugin-refresh tests into the reinstall path; the observed A6 failure demonstrates this invariant and is not a waiver.
- Golden recorders reflect generated CLI behavior across many cases; their larger deterministic diffs do not authorize manual cleanup, expectation narrowing, snapshot normalization changes, or product edits. Rerun each recorder after commit and require byte-idempotence.
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
- The authorized mutation set is exactly `package.json`, `SoT/toolchain.json`, `cli/src/generated/sotPayload.ts`, `cli/test/lib/harness.ts`, `cli/test/unit/toolchain.test.ts`, `cli/test/unit/engine-di.test.ts`, `cli/test/goldens/dryrun.json`, and `cli/test/goldens/mutation.json`; this plan is the only additional changed path since `planned_at_commit`.
- `PUBLIC_IMPLEMENTATION_COMMIT` remains exact and immutable; `PUBLIC_TEST_ARTIFACT_COMMIT` is one later commit with exactly the last four paths. `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, `.github/workflows/release-cli.yml`, and `bun.lock` retain the exact blobs recorded above. No waiver or open question is authorized.
- Manager complete must produce a passed reusable schema-6 completion receipt before any tag or release mutation.
- Tag exactly `PUBLIC_RELEASE_COMMIT`, push only the tag once, wait for exactly one `release-cli.yml` run, and require success at that exact commit.
- No branch push, force operation, destructive tag operation, workflow dispatch, second run, or remote retry is authorized.
- Every failure stops and is reported; no final identity or evidence may be fabricated.

## STOP conditions

- STOP if the target tag, remote tag, GitHub Release, npm version, or any matching historical `release-cli.yml` run already exists before tag creation.
- STOP if request, publication receipt, source proof, source tag, assets, repository ids, versions, commits, or any exact hash differs from this plan.
- STOP if `PLAN_BASE` is not the direct child of `COMPANION_BASE`, the creation commit is not an add-only direct child of `PLAN_BASE`, or any required ancestry fails.
- STOP if the baseline package/toolchain/generated/harness values or blob ids differ, if `PUBLIC_IMPLEMENTATION_COMMIT` is not exact `f562ffde3b12c98072b02166c92c85ffbc6d90f9` with the recorded parent/four-path diff, or if a protected blob drifts.
- STOP if any path beyond the exact eight changes, any required plan path besides this plan changes, any first-four affected path changes after `PUBLIC_IMPLEMENTATION_COMMIT`, or `PUBLIC_TEST_ARTIFACT_COMMIT` is absent, non-unique, or not exactly the four authorized test artifacts.
- STOP if either unit edit changes anything except the two expected `0.12.0` version/tag fragments to `0.13.0`, if either golden is hand-edited or differs after recorder regeneration, or if any behavior/assertion/setup/normalization is weakened.
- STOP if generator, focused tests, recorder idempotence, direct acceptance, the fresh full gate, completion review, receipt validation, or lifecycle operation fails or becomes stale after a later edit. The superseded first A8 never authorizes completion.
- STOP if completion does not yield exactly one passed reusable schema-6 receipt or if `reviewed_head` does not contain both exact artifact commits, the exact eight affected paths, and ancestry to current `HEAD`.
- STOP if the one tag push cannot be reconciled to the exact remote ref, if more than one matching run exists, if the sole run targets another head or fails, or if any action would require retry/retag/force/manual dispatch.
- STOP if stable six-asset inventory/checksums, npm exact version, source four-asset checksums, or the preserved receipt chain disagrees.
- STOP if post-ship `PUBLIC_PLAN_COMMIT` is not a strict descendant of `PUBLIC_RELEASE_COMMIT`, contains a post-review product diff, or does not retain the exact receipt line.

## Cold-handoff checklist

- [x] File manifest: the exact retained four implementation paths, exact four deterministic test artifacts, one lifecycle plan, protected surfaces, external tag, Release, workflow, and npm surfaces are named.
- [x] Environment and commands: repository, Bun/tool versions, generator check, two canonical recorder writes, four focused unit files, fresh full gate, manager invocations, absence fence, tag push, sole-run wait, production checks, and fresh npm caches are exact.
- [x] Interface and data contracts: closed request, receipt/source-proof chain, complete toolchain object, exact retained implementation identity/blobs, exact unit replacements, recorder-only goldens, three commit identities, four source assets, and stable six-asset inventory are explicit.
- [x] Executable acceptance: fresh review/unblock and A1–A3 precede artifact edits; A4–A7 and one fresh A8 follow the exact four-artifact commit; P1–P4 and S1 remain ordered with concrete exit-status and identity expectations.
- [x] Out of scope: protected tests/workflow/lockfile, first-four post-implementation edits, manual goldens, installer/runtime/other SoT, companion plan, branch push, force/retag, manual workflow, and external-source mutation are prohibited.
- [x] Decision rationale: superseded first-gate evidence justifies the deterministic four-artifact closure without behavioral weakening; receipt-derived tag identity, completion/production order, and strict post-ship identity separation remain explicit.
- [x] Known gotchas: generated payload, dynamic fixture version, recorder-owned broad outputs, npm warning downgrade, eventual consistency, nonzero push reconciliation, Release reuse, receipt identity, and inventory distinction are recorded.
- [x] Global constraints: all request versions, commits, hashes, asset digests, exact eight-path mutation limit, two artifact-commit identities, lifecycle ownership, and STOP rules are copied exactly.
- [x] No undefined terms or forward references: every commit variable, authority file, command block, lifecycle operation, artifact, and proof surface is defined in this plan.

## Self-review

- `standalone_executability`: pass — a cold executor can preserve and revalidate the exact four-file implementation, obtain fresh review/unblock, make the exact two unit expectation changes, regenerate only the two recorder outputs, and execute the release without conversation context.
- `actionability`: pass — each step names exact paths, immutable commit/blob identities, recorder commands, dependencies, done conditions, and failure action.
- `dependency_order`: pass — retained implementation and superseded failure are recorded first; changed-input review/unblock precedes the exact four-artifact commit; A4–A7 and one fresh A8 precede completion; production proof follows the completion receipt.
- `evidence_reverification`: pass — request, publication receipt, source proof, remote tag, implementation commit/blobs, pre-expectation artifacts, protected blobs, exact unit transforms, recorder idempotence, focused/full tests, workflow head, Release checksums, npm, and finished receipt are independently reopened.
- `goal_coverage`: pass — package version, complete Session Relay pin, generated payload, dynamic harness fixture, deterministic unit/golden expectations, exact eight-path scope, single release, six assets/checksums, npm, source chain, and post-ship identity are all proven.
- `executable_acceptance`: pass — A3 binds the retained commit, A4 proves exact test transforms and recorder bytes, A6 exercises frozen and corrected tests, A7 proves exact eight-plus-plan scope and one artifact commit, and A8 is the mandatory fresh full gate.
- `failure_modes`: pass — the first A8 is explicitly superseded rather than waived; post-implementation drift, manual goldens, broader unit changes, duplicate artifact commits, behavioral weakening, nonzero tag push, and eventual consistency all have explicit STOP handling.
- `open_questions`: pass — the current user selected the exact eight-path closure and current-review/unblock order; there are no waivers or unresolved decisions.

## Open questions

None — the current user's exact eight-path scope, retained implementation identity, deterministic unit/golden closure, signed-off request, publication receipt chain, immutable protected blobs, lifecycle order, and release contract close every execution decision.

## Sources

- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/public-request.json` — canonical public release authority; SHA-256 fixed above.
- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/publication.json` — canonical Session Relay publication receipt; SHA-256 fixed above.
- `/home/vagrant/.local/state/docks-release/session-relay-0.13.0/publication.Y2tqxo/source-proof-v2.json` — receipt-bound source proof; SHA-256 fixed above.
- The eight affected paths at `f562ffde3b12c98072b02166c92c85ffbc6d90f9` — exact retained implementation and pre-expectation artifact blob identities.
- `cli/test/unit/sessionRelayCli.test.ts`, `cli/test/unit/pluginRefresh.test.ts`, `.github/workflows/release-cli.yml`, and `bun.lock` at `f562ffde3b12c98072b02166c92c85ffbc6d90f9` — immutable protected surfaces.
- `docs/plans/active/session-relay-cli-0.13.0-release-preparation.md` — public source-preparation companion and frozen-test contract.
- `docs/plans/finished/2026-07-18-session-relay-cli-production-release.md` — proven two-phase tag/run/Release/npm mechanics, adapted here to current schema-6 manager/reviewer ownership.
- `docs/plans/AGENTS.md` — current schema-6 five-skill ownership, creation boundary, lifecycle, and review contract.

## Review

(filled by main-context plan-manager after completion evidence)
Review-orchestration-state: {"apply_state":"none","current_input_sha256":"edc8187de77daa487abc9691aa4a0ef3922b3309a5e7f1b5bfb8cc0878e6de1e","initial_input_sha256":"edc8187de77daa487abc9691aa4a0ef3922b3309a5e7f1b5bfb8cc0878e6de1e","lifecycle_intent":"none","orchestration_attempt":1,"phase":"draft","plan_path":"docs/plans/active/session-relay-cli-0.13.0-production-release.md","request_ids":["aa6013b8-8293-46c4-bf75-b4aee579951a"],"retry_authorization":null,"round_index":1,"schema":2,"series_id":"27d02585-983a-4f4a-9a55-0d8a033509ac","series_sha256":null,"state_sha256":"f4b6fe6165f1bff817476aec87fbc4f2af2715720ae74494d3ea4bd278c41b7b","status":"active","stop_reason":null,"terminal_evidence_sha256":null,"terminated_from_state":null,"terminated_from_state_sha256":null,"transitioned_from_state_sha256":null}
