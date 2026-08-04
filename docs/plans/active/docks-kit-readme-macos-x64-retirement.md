---
title: Retire the macOS x64 Relay prebuilt in README and state docks-kit 0.14.0
goal: Land the two README corrections that docks-kit 0.14.0 disclosed as stale, so main stops advertising a retired Session Relay prebuilt and stops naming the previous package version.
status: drafting
created: "2026-08-03T00:00:00+00:00"
updated: "2026-08-03T00:00:00+00:00"
started_at: null
finished_at: null
assignee: null
tags: [docks-kit, documentation, follow-up]
affected_paths:
  - README.md
related_plans: []
---

# Retire the macOS x64 Relay prebuilt in README and state docks-kit 0.14.0

## Goal

`README.md` on `main` still advertises a Session Relay prebuilt for macOS x64 that Relay 0.16.0
retired, and still says the npm package is `docks-kit` 0.13.0 after 0.14.0 shipped. Both lines were
found by the docks-kit 0.14.0 completion review AFTER that release boundary was crossed, so they
could not be corrected inside that lane without unbinding its published implementation commit. This
plan lands them.

## Context & rationale

The correction already exists as commit `e201a5412bc925d50bddac7c718fdbcc409e8f8c`, preserved on
branch `parked/readme-0140`. It changes exactly two lines of `README.md`:

```
| macOS | x64 | ✅ | ✅ | ✅ native |          ->  | macOS | x64 | ✅ | — retired | ✅ native |
Package `docks-kit` 0.13.0 bundles ...   ->  Package `docks-kit` 0.14.0 bundles ...
```

The retirement marker matches the one `cli/docs/platforms.md` already uses, so the two documents
agree after this lands.

### Why this is a separate plan {mechanism}

docks-kit 0.14.0 is tagged `cli-v0.14.0` and published to npm from
`23e9995173c72f6a32e947a39fca8bf433c46f4d`. Binding this correction into that lane would have made
the tag and the npm provenance stop containing its own bound implementation commit, and
republishing as 0.14.1 would mint a supply-chain artifact for two documentation lines. The lane
therefore disclosed the divergence and named this plan. The mechanism that keeps that honest is
this plan's own A2: it asserts the tag still resolves to the published commit, so landing the
README fix cannot quietly move the release it was excluded from.

## Environment & how-to-run

Run from the repository root with `gh` authenticated. No environment variables are needed.

```bash
git cherry-pick e201a5412bc925d50bddac7c718fdbcc409e8f8c   # or apply the same two-line change
```

## Steps

| # | Id | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|---|
| 1 | land_readme | Apply the two-line README correction preserved on `parked/readme-0140` and verify it locally. | `README.md` | — | `local` | `planned` | A1 passes: neither stale line remains and both corrected lines are present. Failure: STOP; do not hand-edit around the preserved commit. |
| 2 | push_readme | Push the correction to `main` under live push authority and read it back from the remote. | — | 1 | `push` | `planned` | A2 passes: remote `main` no longer serves either stale line and tag `cli-v0.14.0` still resolves to `23e9995173c72f6a32e947a39fca8bf433c46f4d`. Failure: STOP with the branch unpushed; never move the tag or touch a release asset. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const stale = ["| macOS | x64 | \u2705 | \u2705 | \u2705 native |", "Package `docks-kit` 0.13.0 bundles the CLI + generated payload"]; const fresh = ["| macOS | x64 | \u2705 | \u2014 retired | \u2705 native |", "Package `docks-kit` 0.14.0 bundles the CLI + generated payload"]; const readme = cp.execFileSync("git", ["show", "HEAD:README.md"], { encoding: "utf8", maxBuffer: 1 << 28 }); for (const line of stale) assert.ok(!readme.includes(line), "the stale README line is still present: " + line); for (const line of fresh) assert.ok(readme.includes(line), "the corrected README line is missing: " + line); console.log("README carries both corrected lines and neither stale line");'` | Exit 0; `README.md` at HEAD contains both corrected lines and neither stale line. |
| A2 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const remote = cp.execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], { encoding: "utf8" }).split(/\s+/)[0]; assert.match(remote || "", /^[0-9a-f]{40}$/, "origin/main is unreadable"); const gh = (p) => JSON.parse(cp.execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 1 << 28 })); const readme = cp.execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", "repos/DocksDocks/public/contents/README.md?ref=" + remote], { maxBuffer: 1 << 28 }).toString("utf8"); const stale = ["| macOS | x64 | \u2705 | \u2705 | \u2705 native |", "Package `docks-kit` 0.13.0 bundles the CLI + generated payload"]; for (const line of stale) assert.ok(!readme.includes(line), "remote main README still carries the stale line: " + line); let obj = gh("repos/DocksDocks/public/git/ref/tags/cli-v0.14.0").object; if (obj.type === "tag") obj = gh("repos/DocksDocks/public/git/tags/" + obj.sha).object; assert.equal(obj.sha, "23e9995173c72f6a32e947a39fca8bf433c46f4d", "tag cli-v0.14.0 moved; it must stay at the published commit"); console.log("remote main README corrected and cli-v0.14.0 unmoved");'` | Exit 0; `README.md` on remote `main` contains neither stale line, and tag `cli-v0.14.0` still resolves to the published docks-kit 0.14.0 commit, proving this documentation change did not disturb the release. |

## Out of scope / do-NOT-touch

- Moving tag `cli-v0.14.0`, replacing a release asset, or republishing `docks-kit` to npm.
- Any file other than `README.md`.
- Any file under `docs/plans/finished/`, and the archived docks-kit 0.14.0 record in particular:
  it states these two lines were stale at the published commit, which remains true forever.

## STOP conditions

1. A1 or A2 fails.
2. The push lacks a live `ExternalAuthorityV1` with scope `push` and target
   `DocksDocks/public:branch:main`.
3. Landing the change would require moving the tag or a release asset.

## Open questions

N/A.

## Review

N/A - no review has been dispatched for this run.

Plan-run: {"acceptance":null,"blocker":null,"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"execution_parent":null,"goal_id":"7fef7034-640b-445e-a8dd-6ecda5fd4afd","implementation_commit":null,"plan_path":"docs/plans/active/docks-kit-readme-macos-x64-retirement.md","plan_sha256":"508a5107c453e9b85c400d7b09a24dd78a996d579cedc8b744dd9240bc6889cd","repository_id":"DocksDocks/public","requested_effects":["local","push"],"risk":"external","run_id":"c2be57d9-36d5-4eca-b365-8722a039e2d7","schema":1,"source_base":"23e9995173c72f6a32e947a39fca8bf433c46f4d","source_sha256":"f4516aaf51b407d634e205bb9f7ea8036b1aefcd4a022f7603cd578e6db776fa"}

## Verification Results

N/A - manager-written after execution.
