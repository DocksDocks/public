---
title: Archive and hand back docks-kit 0.14.0 with Relay 0.16.0
goal: Archive the already-published docks-kit 0.14.0 child so the Docks parent can read it back, and record the disclosed README divergence in the historical record.
status: finished
created: "2026-08-03T00:00:00+00:00"
updated: "2026-08-04T00:54:34.442+00:00"
started_at: "2026-08-04T00:47:51.326+00:00"
finished_at: "2026-08-04T00:54:34.442+00:00"
assignee: null
tags: [session-relay, docks-kit, supply-chain, release, handback]
affected_paths:
  - AGENTS.md
  - README.md
  - SoT/toolchain.json
  - cli/docs/platforms.md
  - cli/docs/toolchain.md
  - cli/src/engine-native/sessionRelayCli.ts
  - cli/src/generated/sotPayload.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/sessionRelayCli.test.ts
  - cli/test/unit/toolchain.test.ts
  - package.json
related_plans: []
---

# Archive and hand back docks-kit 0.14.0 with Relay 0.16.0

## Goal

docks-kit 0.14.0 is already implemented, reviewed, tagged, released and published. One thing is
left: archive this plan so the Docks parent lane can read the child back by its stable identity.

This run claims no new implementation and no complete documentation surface. Two `README.md` lines
are stale in the published bytes and stay stale here.

## Context & rationale

Every fact below is inherited, irreversible, and stated once. No step re-creates any of it.

| Fact | Value |
|---|---|
| Implementation commit | `23e9995173c72f6a32e947a39fca8bf433c46f4d` |
| Remote `main` | contains that commit |
| Tag | `cli-v0.14.0`, resolving to that commit |
| GitHub release | published, not a draft |
| npm | `docks-kit@0.14.0` with SLSA provenance from the release workflow |
| Relay pin | `session-relay` 0.16.0, tag `session-relay--v0.16.0`, exactly three assets |
| Retired | `x86_64-apple-darwin`, removed from the pin, the closed manifest and host mapping |

### Disclosed divergence {mechanism}

`README.md` at the published commit still shows a Session Relay prebuilt for macOS x64 in its
platform matrix, and still says `docks-kit` 0.13.0 in its Releases section. Both were found by the
predecessor's completion review AFTER the release boundary was crossed. Binding a repair commit was
rejected because it is a child of the published one, which would stop the tag and the npm
provenance containing the bound implementation. Republishing as 0.14.1 was rejected because it
mints a new supply-chain artifact to correct two lines that appear in no executable path.

The repair is preserved as commit `e201a5412bc925d50bddac7c718fdbcc409e8f8c` on branch
`parked/readme-0140`, and is carried by a separate plan whose slug is exactly
`docks-kit-readme-macos-x64-retirement`, with its own declared `push` effect and live authority.
This run neither lands nor verifies it. That plan is registered at
`docs/plans/active/docks-kit-readme-macos-x64-retirement.md`, declares `README.md` as its only
affected path, and carries a `push` row for `main`; the predecessor asserted its existence
before it existed, which its completion review correctly refused. The mechanism that keeps the disclosure honest is A5: it
requires the archive to name that follow-up plan AND to record both stale lines verbatim, and it
re-reads `README.md` at the published commit to confirm those exact lines are still there. If
anyone corrects the README without a new release, the archive's claim becomes false and A5 fails.

The two stale lines, recorded verbatim so the archive itself carries them:

```
| macOS | x64 | ✅ | ✅ | ✅ native |
Package `docks-kit` 0.13.0 bundles the CLI + generated payload
```

Authority for the archive push is the operator's standing session grant, digest
`0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641`.

## Environment & how-to-run

Run from the repository root with `gh` and `npm` authenticated. A1-A4 read `IMPLEMENTATION_COMMIT`; export it before running them. A5 reads no environment
variable at all - every identity it checks is a literal in the row itself:

```bash
export IMPLEMENTATION_COMMIT=23e9995173c72f6a32e947a39fca8bf433c46f4d
```

A1-A4 run before the completion review. A5 is the post-archive read-back and is the last thing the
handback does.

## Steps

| # | Id | Task | Files | Depends | Effect | Status | Done when / failure action |
|---:|---|---|---|---|---|---|---|
| 1 | published_implementation | Inherited implementation of the Relay 0.16.0 pin cutover and the 0.14.0 version bump, already released. This run performs none of it. | `AGENTS.md`; `README.md`; `SoT/toolchain.json`; `cli/docs/platforms.md`; `cli/docs/toolchain.md`; `cli/src/engine-native/sessionRelayCli.ts`; `cli/src/generated/sotPayload.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; `cli/test/unit/engine-di.test.ts`; `cli/test/unit/sessionRelayCli.test.ts`; `cli/test/unit/toolchain.test.ts`; `package.json` | — | `local` | `done` | The published commit `23e9995173c72f6a32e947a39fca8bf433c46f4d` carries exactly these declared paths and nothing else, and A1-A4 pass against it. Two `README.md` lines remain stale there by decision. Failure: STOP; this row is historical and cannot be re-executed. |
| 2 | archive_handback | Bind acceptance on the published commit, pass a fresh completion review, finish, archive, commit the archive checkpoint, push it to `main`, and read it back. | — | 1 | `push` | `planned` | A1-A4 pass and acceptance is bound to `23e9995173c72f6a32e947a39fca8bf433c46f4d`; a fresh CompletionReviewV1 passes that exact commit and diff; the plan moves once to its finish-dated archive; the archive checkpoint is pushed to `main` under live push authority; the archive names `docks-kit-readme-macos-x64-retirement` and records both stale `README.md` lines verbatim; and A5 then passes as the final read-back. Failure is boundary-specific. BEFORE the archive push: STOP with the plan unarchived. AFTER the push, if A5 fails: leave the pushed archive exactly as it is, do not revert or force the branch, stop the parent handback, and report the failed read-back. In every case never retag, replace an asset, or republish. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const impl = process.env.IMPLEMENTATION_COMMIT; assert.ok(impl, "IMPLEMENTATION_COMMIT must be set"); assert.match(impl, /^[0-9a-f]{40}$/); const want = { "aarch64-apple-darwin": "da8b114216c3f2301ad582df8e59b49e91953abcc1112b510466b31637fda825", "aarch64-unknown-linux-musl": "816b6b8bd2d2c2518ea359a5a21502213347b387a1cc576a0fb9cf541e5646ed", "x86_64-unknown-linux-musl": "b3ca082dc5ea51e8322be407cdb4bbcaaa05d80bd62c3553f82ab98c1a95498a" }; const pin = JSON.parse(cp.execFileSync("git", ["show", impl + ":SoT/toolchain.json"], { encoding: "utf8", maxBuffer: 1 << 28 })).tools["session-relay"]; assert.deepEqual(pin.assets, want, "the pinned Relay asset map is not the exact three-asset set"); assert.equal(pin.tag, "session-relay--v0.16.0", "pinned tag is " + pin.tag); assert.equal(pin.verified, "0.16.0", "pinned verified is " + pin.verified); assert.equal(pin.policy, "exact", "pinned policy is " + pin.policy); assert.equal(pin.repository, "DocksDocks/docks", "pinned repository is " + pin.repository); console.log("pin exact at " + impl.slice(0, 12));'` | Exit 0; the Relay pin at the published commit is exactly the three named assets with the named digests, tag `session-relay--v0.16.0`, verified `0.16.0`, policy `exact`, repository `DocksDocks/docks`. A fourth asset or one wrong digest fails. |
| A2 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const impl = process.env.IMPLEMENTATION_COMMIT; assert.ok(impl, "IMPLEMENTATION_COMMIT must be set"); const gh = (p) => JSON.parse(cp.execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 1 << 28 })); let obj = gh("repos/DocksDocks/public/git/ref/tags/cli-v0.14.0").object; if (obj.type === "tag") obj = gh("repos/DocksDocks/public/git/tags/" + obj.sha).object; assert.equal(obj.sha, impl, "tag cli-v0.14.0 resolves to " + obj.sha); const rel = gh("repos/DocksDocks/public/releases/tags/cli-v0.14.0"); assert.equal(rel.draft, false, "the cli-v0.14.0 release is a draft"); const meta = JSON.parse(cp.execFileSync("npm", ["view", "docks-kit@0.14.0", "--json"], { encoding: "utf8", maxBuffer: 1 << 28 })); assert.equal(meta.version, "0.14.0", "npm version is " + meta.version); assert.ok(meta.dist && meta.dist.attestations && meta.dist.attestations.url, "no provenance attestation"); (async () => { const bundle = await (await fetch(meta.dist.attestations.url)).json(); const slsa = (bundle.attestations || []).map((a) => JSON.parse(Buffer.from(a.bundle.dsseEnvelope.payload, "base64").toString("utf8"))).find((s) => s.predicateType === "https://slsa.dev/provenance/v1"); assert.ok(slsa, "no SLSA v1 provenance statement"); assert.ok(slsa.subject.some((s) => s.name === "pkg:npm/docks-kit@0.14.0"), "provenance subject is not docks-kit 0.14.0"); const wf = slsa.predicate.buildDefinition.externalParameters.workflow; assert.equal(wf.repository, "https://github.com/DocksDocks/public", "provenance repository is " + wf.repository); assert.equal(wf.path, ".github/workflows/release-cli.yml", "provenance workflow path is " + wf.path); const built = slsa.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit; const st = gh("repos/DocksDocks/public/compare/" + impl + "..." + built).status; assert.ok(st === "identical" || st === "ahead", "provenance build commit does not contain the published commit (compare " + st + ")"); console.log("tag, release and npm provenance all bind " + impl.slice(0, 12)); })();'` | Exit 0; tag `cli-v0.14.0` dereferences to `IMPLEMENTATION_COMMIT`, its GitHub release exists and is not a draft, and `docks-kit@0.14.0` is on npm with a SLSA provenance statement whose subject is `pkg:npm/docks-kit@0.14.0`, whose workflow is `DocksDocks/public` `.github/workflows/release-cli.yml`, and whose build commit contains the published commit. |
| A3 | `node -e 'const assert = require("assert/strict"), fs = require("fs"), cp = require("child_process"); const impl = process.env.IMPLEMENTATION_COMMIT; assert.ok(impl, "IMPLEMENTATION_COMMIT must be set"); const parent = cp.execFileSync("git", ["rev-parse", impl + "^"], { encoding: "utf8" }).trim(); const changed = cp.execFileSync("git", ["diff", "--name-only", parent, impl], { encoding: "utf8" }).split("\n").filter(Boolean).filter((p) => !p.startsWith("docs/plans/")).sort(); const text = fs.readFileSync("docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md", "utf8"); const front = text.match(/^---\n([\s\S]*?)\n---/); assert.ok(front, "plan has no frontmatter"); const block = front[1].match(/^affected_paths:\n((?:[ \t]+-[ \t]+.*(?:\n|$))+)/m); assert.ok(block, "plan declares no affected_paths"); const declared = block[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean).sort(); assert.deepEqual(changed, declared, "the published surface is not exactly the declared affected_paths"); console.log("published surface matches " + declared.length + " declared paths");'` | Exit 0; the surface of the published commit against its parent equals the declared `affected_paths` exactly, ignoring `docs/plans/` which the lifecycle owns rather than the plan. A missing or extra implementation path fails. |
| A4 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const impl = process.env.IMPLEMENTATION_COMMIT; assert.ok(impl, "IMPLEMENTATION_COMMIT must be set"); const stale = ["| macOS | x64 | \u2705 | \u2705 | \u2705 native |", "Package `docks-kit` 0.13.0 bundles the CLI + generated payload"]; const readme = cp.execFileSync("git", ["show", impl + ":README.md"], { encoding: "utf8", maxBuffer: 1 << 28 }); for (const line of stale) assert.ok(readme.includes(line), "the disclosed stale README line is absent at the published commit: " + line); console.log("both disclosed stale README lines are present at " + impl.slice(0, 12));'` | Exit 0; both stale `README.md` lines are still present at the published commit, so the divergence this plan discloses is real and unchanged at the moment acceptance binds. |
| A5 | `node -e 'const assert = require("assert/strict"), cp = require("child_process"); const OWNER = "DocksDocks/public"; const SUFFIX = "-session-relay-0.16.0-docks-kit-0.14.0-release.md"; const FOLLOWUP = "docks-kit-readme-macos-x64-retirement"; const PARENT_GOAL = "cef66d21-5bd3-4e07-a0e8-e393822dcfb0"; const BOUND_RUN = "fb5a6880-9bca-45c5-9136-d0424a020d5a"; const PUBLISHED = "23e9995173c72f6a32e947a39fca8bf433c46f4d"; const STALE = ["| macOS | x64 | \u2705 | \u2705 | \u2705 native |", "Package `docks-kit` 0.13.0 bundles the CLI + generated payload"]; const PIN = { "aarch64-apple-darwin": "da8b114216c3f2301ad582df8e59b49e91953abcc1112b510466b31637fda825", "aarch64-unknown-linux-musl": "816b6b8bd2d2c2518ea359a5a21502213347b387a1cc576a0fb9cf541e5646ed", "x86_64-unknown-linux-musl": "b3ca082dc5ea51e8322be407cdb4bbcaaa05d80bd62c3553f82ab98c1a95498a" }; const gh = (p) => JSON.parse(cp.execFileSync("gh", ["api", p], { encoding: "utf8", maxBuffer: 1 << 28 })); const raw = (p, ref) => cp.execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", "repos/" + OWNER + "/contents/" + p + "?ref=" + ref], { maxBuffer: 1 << 28 }).toString("utf8"); const hits = gh("repos/" + OWNER + "/contents/docs/plans/finished?ref=main").map((e) => e.name).filter((n) => n.endsWith(SUFFIX)); assert.equal(hits.length, 1, "expected exactly one finished child archive on remote main, found " + hits.length); const archivePath = "docs/plans/finished/" + hits[0]; const body = raw(archivePath, "main"); const run = JSON.parse(body.split("\n").find((l) => l.startsWith("Plan-run:")).slice(9)); assert.equal(run.plan_path, "docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md", "archived plan_path is " + run.plan_path); assert.equal(run.goal_id, PARENT_GOAL, "archived goal_id is not the shared parent goal"); assert.equal(run.run_id, BOUND_RUN, "archived run_id is " + run.run_id + ", not the bound run " + BOUND_RUN); assert.equal(run.implementation_commit, PUBLISHED, "archived implementation_commit is " + run.implementation_commit + ", not the published commit"); assert.equal(run.draft_review.state, "passed", "archived draft review is " + run.draft_review.state); assert.equal(run.completion_review.state, "passed", "archived completion review is " + run.completion_review.state); assert.match(body, /^status: finished/m, "archived plan is not finished"); assert.match(body, /^finished_at: "[^"]+"/m, "archived finished_at is unset"); let obj = gh("repos/" + OWNER + "/git/ref/tags/cli-v0.14.0").object; if (obj.type === "tag") obj = gh("repos/" + OWNER + "/git/tags/" + obj.sha).object; assert.equal(obj.sha, PUBLISHED, "tag cli-v0.14.0 resolves to " + obj.sha + ", not the published commit"); const pin = JSON.parse(raw("SoT/toolchain.json", PUBLISHED)).tools["session-relay"]; assert.deepEqual(pin.assets, PIN, "the pin at the published commit is not the exact three-asset set"); assert.equal(pin.tag, "session-relay--v0.16.0", "pinned Relay tag is " + pin.tag); const start = body.indexOf("### Disclosed divergence"); assert.ok(start >= 0, "the archive has no Disclosed divergence section"); const rest = body.slice(start + 4); const nextHeading = rest.search(/\n#{2,3} /); const section = nextHeading < 0 ? rest : rest.slice(0, nextHeading); assert.ok(section.includes(FOLLOWUP), "the Disclosed divergence section does not name the follow-up plan " + FOLLOWUP); for (const line of STALE) assert.ok(section.includes(line), "the Disclosed divergence section does not record the stale README line verbatim: " + line); const readme = raw("README.md", PUBLISHED); for (const line of STALE) assert.ok(readme.includes(line), "README at the published commit no longer contains the line the archive records as stale: " + line); console.log("archive " + archivePath + " binds run " + BOUND_RUN.slice(0, 8) + " at " + PUBLISHED.slice(0, 12) + " and discloses both stale lines");'` | Exit 0, run only AFTER the archive is pushed. It proves the handback from the REMOTE and pins every identity to a literal rather than a relation: the single suffix-matched archive on `DocksDocks/public@main` binds `plan_path`, the shared `goal_id`, `run_id` exactly `fb5a6880-9bca-45c5-9136-d0424a020d5a`, `implementation_commit` exactly `23e9995173c72f6a32e947a39fca8bf433c46f4d`, both reviews `passed`, `status: finished` and a non-null `finished_at`; tag `cli-v0.14.0` resolves to that same commit rather than merely containing it; and the pin at that commit is the exact three-asset set. The disclosure checks are scoped to the archived `### Disclosed divergence` SECTION, so they cannot be satisfied by the literals embedded in this command's own source, which the archive also carries. Finally `README.md` at the published commit must still contain both lines, so a silent correction without a new release fails the row. It reads no environment variable.    |

## Out of scope / do-NOT-touch

- Retagging, replacing a release asset, or republishing to npm. All three are forbidden.
- Landing `e201a5412bc925d50bddac7c718fdbcc409e8f8c`. It belongs to
  `docks-kit-readme-macos-x64-retirement`, which declares its own `push` effect.
- Any PRE-EXISTING file under `docs/plans/finished/`, and any historical evidence or frozen
  fixture. The single archive file this plan's own lifecycle transaction creates there is the
  one exception, because `step:archive_handback` cannot finish without it.
- Re-running the implementation. Step 1 is historical.

## STOP conditions

1. A1-A4 do not all pass on the published commit.
2. The completion review does not pass on that exact commit and diff.
3. Any acceptance row would need weakening, or a stale README line has silently disappeared
   without a new release.
4. The archive push lacks a live `ExternalAuthorityV1` whose scope is `push` and whose target is
   `DocksDocks/public:branch:main` at the archive checkpoint.
5. A5 fails after the push. The archive stays exactly as pushed, nothing is reverted or
   force-updated, and the parent handback must not proceed.

## Open questions

N/A - the binding, the retirement, the follow-up identifier and the divergence are all decided
above.

## Review

Plan-run: {"acceptance":{"source_sha256":"6d1bc9a9d9996db8256fbcb6699d749f1c6e3edea7274ba2535b102ebbb89979","verification_sha256":"1ab831956952d1037f272d5e162aaca7b64886d652362fd72cdd319c5db0cd50"},"blocker":null,"completion_review":{"accepted_classes":[],"input_sha256":"b955dce0b0fbe76449d0a1b986fd75412a909787bec2502f3c02681bf53df095","invocations":1,"result_sha256":"f7e10f629e6e80882e8b6384fc8a41b7d1450ddbc6b24f6a1aa6e16476672ee8","state":"passed"},"draft_review":{"accepted_classes":[],"input_sha256":"11efc5f11ba56b45ca6ef55b1ecdf5eb1fcb31f910f4a53878a459083ec2b65a","invocations":1,"result_sha256":"f455d124463424af0f81f4ea135efeb71f1945042cc03a452a79fa9992f10351","state":"passed"},"execution_parent":"cf7df092d068d15eee68d389a047f16c858006ca","goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"063d6575e380b1ab2ce4db44bc18e703c770940bae5234aea19cbbb7186e0aa0","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"fb5a6880-9bca-45c5-9136-d0424a020d5a","schema":1,"source_base":"23e9995173c72f6a32e947a39fca8bf433c46f4d","source_sha256":"6d1bc9a9d9996db8256fbcb6699d749f1c6e3edea7274ba2535b102ebbb89979"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"4411daaf5a7e79ffe62727f013e8adba2a5794760d5bcc759aa9017e23e374e2","replacement_run_id":"4cfa7c82-7985-4bf7-8b97-06c48cdc3bc3","run":{"acceptance":null,"blocker":{"evidence_sha256":"5440e801d62d7e159dafb0ee103873c2b17e3fbe81b585134f8ce2368d05b8d3","kind":"review_failed"},"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"accepted_classes":["v1_acceptance_coverage_incomplete"],"input_sha256":"f016ba3da6380cbcad701b80b7c361009435949b2ebcec8adfeeada874d669f6","invocations":2,"result_sha256":"5440e801d62d7e159dafb0ee103873c2b17e3fbe81b585134f8ce2368d05b8d3","state":"blocked"},"execution_parent":null,"goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":null,"plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"3ebb26ded7bc87f2ff17af1f3ce1df69b9d6f9d6695b8542b4694b713a007831","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"6727f045-7195-4d6a-af6e-330d83b1d685","schema":1,"source_base":"cf7df092d068d15eee68d389a047f16c858006ca","source_sha256":"bedcadb4869367c39fbbe28a5c2befc8e260f628372b07a2b0a81402aa4e30ee"},"schema":1,"status":"blocked","successor_run_sha256":"6b7fff9210ecc5ca9649a6d0feba7ab229fd0c383b9ef02578b4fb769464c14b"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"1d79201472598589ab45fa47470e18baba9925c6dad878bd601cd31acca584f2","replacement_run_id":"ea97d226-1eb1-4210-ac42-56dc5a0059c0","run":{"acceptance":{"source_sha256":"c6ae97e661ea2e3f804f1c3ca025ab4efd275713423a31365764b6f5a64b1f1f","verification_sha256":"46d7b08e1cf919a6e0a4ea14c95cfedd516f4012c17b434e71ab7a9a2346d482"},"blocker":{"evidence_sha256":"bb3baf00ccea6f304179ff81ebae7ab36b6bd92af74233fa7832aa48f8949280","kind":"review_failed"},"completion_review":{"accepted_classes":[],"input_sha256":"20e3746b9427ed869d944c2ca819608b61fd549a6640519ccea5564c0507f0c2","invocations":2,"result_sha256":"bb3baf00ccea6f304179ff81ebae7ab36b6bd92af74233fa7832aa48f8949280","state":"blocked"},"draft_review":{"accepted_classes":[],"input_sha256":"42c4b324f7857ed5612af01aee05d0b133e379667a6878c85b6ffab25b7233ef","invocations":1,"result_sha256":"2e3f6d7b275ba5ddc5d37e265ec542d415e84b44987e8793d514f2892f122744","state":"passed"},"execution_parent":"cf7df092d068d15eee68d389a047f16c858006ca","goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":"e201a5412bc925d50bddac7c718fdbcc409e8f8c","plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"65fb54fcd8cd98ff20ec1dcc799e7e5b808e7cc99b93a956a9f15a274baf73e4","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"4cfa7c82-7985-4bf7-8b97-06c48cdc3bc3","schema":1,"source_base":"cf7df092d068d15eee68d389a047f16c858006ca","source_sha256":"bedcadb4869367c39fbbe28a5c2befc8e260f628372b07a2b0a81402aa4e30ee"},"schema":1,"status":"blocked","successor_run_sha256":"d029f6a7717d6d51df97a04a0628be0f64085127e7fb3219d41c52cffcb8fbb5"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"e70671c03225ada0ceb1bfd1ef2164bc4a60d7f4186425cdb61009294284d068","replacement_run_id":"64dddce2-044c-4667-9f97-f7cae8309744","run":{"acceptance":null,"blocker":{"evidence_sha256":"b15dd16c092bee228e5cd06c06bd872e4bc29a429be382c69bff0d59d8341532","kind":"review_failed"},"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"accepted_classes":["v1_acceptance_coverage_incomplete","v1_contract_contradiction"],"input_sha256":"ff567d04ffd6076f26357bf9e93eae6317fd8eae88784d15ff37dce2cd75cade","invocations":2,"result_sha256":"b15dd16c092bee228e5cd06c06bd872e4bc29a429be382c69bff0d59d8341532","state":"blocked"},"execution_parent":null,"goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":null,"plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"d218128ae2347b9a15bcc9b0fc2e5c57013753e53ad64e5645623643dcfc047f","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"ea97d226-1eb1-4210-ac42-56dc5a0059c0","schema":1,"source_base":"608f9efc823079988e85f9ea76d5d7df85d596b7","source_sha256":"8889aead4a96e9a410ad90399e9f9943188b1e0b4271a6b5fb2c0e46b73f35b9"},"schema":1,"status":"blocked","successor_run_sha256":"fbe476d52906418e587d95f2a5bcdcf03b5914f9db86b3eb4ab9c6ffa90a98f8"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"2f4d20a9552da2b60e5886571f081b7d014a9c42286a22b2a2598c2739878228","replacement_run_id":"be0405c1-037c-46ff-9127-1fb776a83c44","run":{"acceptance":null,"blocker":{"evidence_sha256":"5d6917d11d7811a79fb7300dc5f388045840c2df14a6a7c45ddbe6c29291ed9e","kind":"review_failed"},"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"accepted_classes":["v1_acceptance_command_not_runnable","v1_acceptance_coverage_incomplete","v1_contract_contradiction","v1_evidence_mismatch"],"input_sha256":"cf12355c3afbf05d50040537413ce59711e27ac990014980b8984ba32c86cb20","invocations":2,"result_sha256":"5d6917d11d7811a79fb7300dc5f388045840c2df14a6a7c45ddbe6c29291ed9e","state":"blocked"},"execution_parent":null,"goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":null,"plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"4a6b5f75b177a58fe56927bf1100834acb6f38155b0bb0094d503d952785f496","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"64dddce2-044c-4667-9f97-f7cae8309744","schema":1,"source_base":"608f9efc823079988e85f9ea76d5d7df85d596b7","source_sha256":"8889aead4a96e9a410ad90399e9f9943188b1e0b4271a6b5fb2c0e46b73f35b9"},"schema":1,"status":"blocked","successor_run_sha256":"a18a81d60dcc855b8e85ec50465fe5aa9cfcb917760998b66a2d5f9416924c1c"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"0031794ae0f6c5ef0d738c81108a0412a2332075db40e2c73d3ee49753377f14","replacement_run_id":"3fb6954a-b8a2-495f-aac0-08ac27883c66","run":{"acceptance":{"source_sha256":"6d1bc9a9d9996db8256fbcb6699d749f1c6e3edea7274ba2535b102ebbb89979","verification_sha256":"5ec1c83eb7649f36b64ef605a0a260df45baab4375d3fb365fed0f73cd02a90e"},"blocker":{"evidence_sha256":"37a644887b5c59a6e385d4e417143e7eb42eef214ba80cad36614e48949afcdc","kind":"review_failed"},"completion_review":{"accepted_classes":[],"input_sha256":"04dbc7c8cbe7d3a4443a739a46ab9f4256b93b9b898813069b7b4942c16063c1","invocations":1,"result_sha256":"37a644887b5c59a6e385d4e417143e7eb42eef214ba80cad36614e48949afcdc","state":"blocked"},"draft_review":{"accepted_classes":["v1_contract_contradiction","v1_failure_action_missing"],"input_sha256":"e8f0ad6e1341c88853c0c979616b3691118e2e27917640db57d2d62842ae5312","invocations":2,"result_sha256":"c43f8b2b500cc0e64d1577e08fce223d33560d666e9825d9004f484b24c3a547","state":"passed"},"execution_parent":"cf7df092d068d15eee68d389a047f16c858006ca","goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"97d81ab85c873ae4f9bbd886f87d576e76b93105b1c6da30068e684c35a50136","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"be0405c1-037c-46ff-9127-1fb776a83c44","schema":1,"source_base":"608f9efc823079988e85f9ea76d5d7df85d596b7","source_sha256":"8889aead4a96e9a410ad90399e9f9943188b1e0b4271a6b5fb2c0e46b73f35b9"},"schema":1,"status":"blocked","successor_run_sha256":"5344b8eb75c452bc19f026f8136daf87b1169bd69c43aa6af26d0411d52b3f57"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"bff937635d0953105b2c43577b75fefd4e377cabccfa55c03a4f217d1bafaa43","replacement_run_id":"8534815d-b982-48b0-8c3b-0f127543a05e","run":{"acceptance":{"source_sha256":"6d1bc9a9d9996db8256fbcb6699d749f1c6e3edea7274ba2535b102ebbb89979","verification_sha256":"a68411d01d29364ed0c52d9347caf0aa42dc6c63f46fb78278e2691959306097"},"blocker":{"evidence_sha256":"61d95c6bc8346e6ddcfcc760dabeb9a3fe82f9aa0e30f9bd5d510a9d4a253069","kind":"review_failed"},"completion_review":{"accepted_classes":[],"input_sha256":"2372946c1b6483ab4ab4b489572bb471c84c1fd65f39b634fdab03cf33e91510","invocations":1,"result_sha256":"61d95c6bc8346e6ddcfcc760dabeb9a3fe82f9aa0e30f9bd5d510a9d4a253069","state":"blocked"},"draft_review":{"accepted_classes":[],"input_sha256":"b7cefd262022a5813d3a22ddcaf73143d7383b29982b27939aeda72ff686c85d","invocations":1,"result_sha256":"ebc68ecd7fdbcd254db31bac6f8b56deea6543427dfa78bd7f3caa90688ba5d6","state":"passed"},"execution_parent":"cf7df092d068d15eee68d389a047f16c858006ca","goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"0ce007610579429e4fb1bcd14327d61fcfe142278fcee8e21df3be51b9ac6be9","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"3fb6954a-b8a2-495f-aac0-08ac27883c66","schema":1,"source_base":"3f21b0c6b4b0a79bc9d411d3c0e7cd9f343d258a","source_sha256":"c0dd69415227879a7ae6b3a7485516c96a2fd5c7941d866217fc875e4459a31f"},"schema":1,"status":"blocked","successor_run_sha256":"58ea7882846a9a74be79963529f544f1a71ed3c27737a7e3198af1e1af8f47d3"}
Plan-attempt-history: {"authorization_source_sha256":"0889cde97525945382fbfa4f98b7f726fca77bdb38221c558412b63fb9ae6641","plan_bytes_sha256":"a11a92c0abd7c6f1b94af5df8197f27e3860cef6b681f5a5fc2b888a255fe255","replacement_run_id":"fb5a6880-9bca-45c5-9136-d0424a020d5a","run":{"acceptance":null,"blocker":{"evidence_sha256":"beaf9e4c8764e613529bb5c3b0bee0c00567a6396a8df84a45539bc078816a06","kind":"review_failed"},"completion_review":{"input_sha256":null,"invocations":0,"result_sha256":null,"state":"not_started"},"draft_review":{"accepted_classes":["v1_evidence_mismatch"],"input_sha256":"11e6bcb3908b71dd835069caa3929ac795fa013383ae6b41842fc991187e10b0","invocations":2,"result_sha256":"beaf9e4c8764e613529bb5c3b0bee0c00567a6396a8df84a45539bc078816a06","state":"blocked"},"execution_parent":null,"goal_id":"cef66d21-5bd3-4e07-a0e8-e393822dcfb0","implementation_commit":null,"plan_path":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md","plan_sha256":"59cbad15ef0992315354f56f2bc81897c4f42974f0a865f4ee1d0a8854ed5385","repository_id":"DocksDocks/public","requested_effects":["local","probe","publish","push","release"],"risk":"external","run_id":"8534815d-b982-48b0-8c3b-0f127543a05e","schema":1,"source_base":"23e9995173c72f6a32e947a39fca8bf433c46f4d","source_sha256":"6d1bc9a9d9996db8256fbcb6699d749f1c6e3edea7274ba2535b102ebbb89979"},"schema":1,"status":"blocked","successor_run_sha256":"ac7927f69a99d4649bd5df3d5d20456e0e64c386b82d874a43c39bf72b62b7ec"}






Completion review invocation 1:

Completion-review-result: {"diff_sha256":"971afae211175d4e17bf51312c62cfb4572ba34c51587097bfbb9b7493d947d3","findings":[{"defect":"The disclosure of the two stale README.md lines is inaccurate in its remediation half. `## Verification Results` states as observed fact: \"The repair is preserved as `e201a5412bc925d50bddac7c718fdbcc409e8f8c` on branch `parked/readme-0140` and is carried by the separate plan `docks-kit-readme-macos-x64-retirement`, which declares its own `push` effect\", and `## Context & rationale` states the same with \"...with its own declared `push` effect and live authority\". The commit and branch halves are true (e201a541 is a child of 23e9995 on `parked/readme-0140`, touching README.md plus the plan record), but no plan with that slug exists in any form: `docs/plans/active/` holds only ci-golden-test-modernization, effect-v4-maintainer-skill, session-relay-0.16.0-docks-kit-0.14.0-release and session-relay-cli-0.13.0-release-preparation on both the local filesystem and remote main; the 29 files in remote `docs/plans/finished?ref=main` contain no readme/retirement/macos slug; `git log --all --diff-filter=A --name-only -- 'docs/plans/*'` shows such a file was never added on any ref; and `git grep` over the worktree and all refs finds the slug only inside this plan file itself (lines 63, 106, 112, 179). Nothing therefore declares a `push` effect or holds live authority for the parked README repair. The claimed honesty mechanism cannot catch this: A5 only asserts `section.includes(FOLLOWUP)`, i.e. that the archive NAMES the slug, plus that the two lines still exist in README at the published commit — it never checks the follow-up plan exists. Because step `archive_handback` pushes this body verbatim into `docs/plans/finished/` on `main`, the false claim would be frozen into the immutable historical record while A5 still exits 0, which is exactly the inaccurate-disclosure case this review must reject.","fix":"Make the claim true before the archive push, or state the verified truth. Either (a) draft the follow-up plan with slug exactly `docks-kit-readme-macos-x64-retirement` carrying commit e201a5412bc925d50bddac7c718fdbcc409e8f8c, with its own declared `push` effect and authority, so both passages become accurate; or (b) reword lines 61-63 and 177-179 to describe only what is observable — e.g. \"The repair is preserved as commit `e201a5412bc925d50bddac7c718fdbcc409e8f8c` on branch `parked/readme-0140`; it is not carried by any plan yet, and landing it requires a separate plan with slug `docks-kit-readme-macos-x64-retirement` declaring its own `push` effect, which this run does not draft.\" — keeping A5 unchanged since it only requires the archive to name the slug. Do not retag, replace an asset, or republish; no change to the published commit is implied either way.","id":"F1","kind":"v1_evidence_mismatch","locator":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md:177-179 (identical claim at :61-63)"}],"implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","invocation":1,"run_id":"be0405c1-037c-46ff-9127-1fb776a83c44","schema":1,"verdict":"repair"}


Completion review invocation 1:

Completion-review-result: {"diff_sha256":"971afae211175d4e17bf51312c62cfb4572ba34c51587097bfbb9b7493d947d3","findings":[{"defect":"`## Verification Results` -> `### Lane history, stated plainly` states as fact: \"This is the fifth run of this child lane. The four before it were blocked\". That is off by one and is contradicted by the same section 18 lines later, where `### Lane history addendum` says \"A fifth block preceded this run\" and \"This lane has been blocked five times and every block named a real defect.\" The plan's own machine-readable ledger settles it: the file carries five `Plan-attempt-history:` lines, each `status: blocked`, chained 6727f045 -> 4cfa7c82 -> ea97d226 -> 64dddce2 -> be0405c1, and `be0405c1`'s `replacement_run_id` is the bound run `3fb6954a-b8a2-495f-aac0-08ac27883c66`. The bound run is therefore the SIXTH run of this lane with FIVE blocked runs before it, not the fifth with four. The stale count is inherited verbatim from the previous body (written when be0405c1 genuinely was the fifth run); this run appended the addendum recording the fifth block but did not update the count it invalidated. Because `step:archive_handback` freezes this body verbatim into `docs/plans/finished/` on `main`, and A5 does not inspect the lane-history prose, the immutable historical record would permanently assert two mutually exclusive counts of its own failure history. All other disclosures check out: A1-A4 re-run here exit 0 (`pin exact at 23e9995173c7`, `published surface matches 13 declared paths`, `both disclosed stale README lines are present at 23e9995173c7`, `tag, release and npm provenance all bind 23e9995173c7`); the pin is exactly the three named digests with `x86_64-apple-darwin` gone from `SoT/toolchain.json`, `TARGETS`, `sessionRelayTarget` and every doc; the follow-up plan `docks-kit-readme-macos-x64-retirement` is genuinely registered at `docs/plans/active/docks-kit-readme-macos-x64-retirement.md` with `affected_paths: [README.md]` and a `push` row for `main`; the bundle patch is byte-identical to `git diff --full-index cf7df09 23e9995` over the 13 declared paths; and nothing claims A5 already ran.","fix":"Correct the count in `### Lane history, stated plainly` before the archive push, changing nothing else. Replace line 200's \"This is the fifth run of this child lane. The four before it were blocked, and every block was a\" with \"This is the sixth run of this child lane. The five before it were blocked, and every block was a\", and renumber the enumerated blocks so the list covers all five (fold the addendum's fifth block in as item 5, or keep `### Lane history addendum` and change its opening to \"The fifth block, listed above as item 5, preceded this run:\" so the two paragraphs agree). This touches only narrative lines in the plan record: no acceptance row is weakened, no published byte changes, and no retag, asset replacement or republish is implied.","id":"F1","kind":"v1_evidence_mismatch","locator":"docs/plans/active/session-relay-0.16.0-docks-kit-0.14.0-release.md:200 (contradicted at :218 and :221)"}],"implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","invocation":1,"run_id":"3fb6954a-b8a2-495f-aac0-08ac27883c66","schema":1,"verdict":"repair"}


Completion review invocation 1:

Completion-review-result: {"diff_sha256":"971afae211175d4e17bf51312c62cfb4572ba34c51587097bfbb9b7493d947d3","findings":[],"implementation_commit":"23e9995173c72f6a32e947a39fca8bf433c46f4d","invocation":1,"run_id":"fb5a6880-9bca-45c5-9136-d0424a020d5a","schema":1,"verdict":"pass"}

## Verification Results

### Inherited implementation

This run performed no implementation. The implementation exists at
`23e9995173c72f6a32e947a39fca8bf433c46f4d`, produced and reviewed by earlier runs of this lane, and
is already published. Its surface against `cf7df092d068d15eee68d389a047f16c858006ca` is exactly the
thirteen declared `affected_paths` and nothing else.

| Boundary | Observed |
|---|---|
| `main` | contains the published commit |
| Tag | `cli-v0.14.0` resolves to `23e9995173c72f6a32e947a39fca8bf433c46f4d` |
| GitHub release | published, `draft: false` |
| npm | `docks-kit@0.14.0` with a SLSA v1 provenance statement whose subject is `pkg:npm/docks-kit@0.14.0`, whose workflow is `DocksDocks/public` `.github/workflows/release-cli.yml`, and whose build commit contains the published commit |
| Relay pin | `session-relay` verified `0.16.0`, tag `session-relay--v0.16.0`, policy `exact`, exactly three assets |

### Acceptance, observed

A1 through A4 were run against the published commit and all exited 0:

- **A1** `pin exact at 23e9995173c7`
- **A2** `tag, release and npm provenance all bind 23e9995173c7`
- **A3** `published surface matches 13 declared paths`
- **A4** `both disclosed stale README lines are present at 23e9995173c7`

A5 is the post-archive read-back. It runs after the archive push, as its Expected cell and
`step:archive_handback` both state, and its result is recorded by the handback rather than here.

### The disclosed divergence, unchanged

`README.md` at the published commit still carries both stale lines, deliberately. Binding a repair
commit would stop the tag and the npm provenance containing the bound implementation; republishing
as 0.14.1 would mint a supply-chain artifact for two lines that appear in no executable path. The
repair is preserved as `e201a5412bc925d50bddac7c718fdbcc409e8f8c` on branch `parked/readme-0140`
and is carried by `docs/plans/active/docks-kit-readme-macos-x64-retirement.md`, which declares
`README.md` as its only affected path and a `push` row for `main`. That plan was written before
this run's review, so the claim is verified rather than promised. A5 asserts the archive names it
and records both lines verbatim, and that the same lines are still in `README.md` at the published
commit, so the record cannot drift from the artifact it describes.

### Lane history, derived from the ledger

The plan carries 7 `Plan-attempt-history:` entries, so this is run number 8 and the 7
before it were blocked. Every block named a real defect:

1. an acceptance row validated the finished archive from a local checkout instead of the remote;
2. absence probes treated any `gh` or `npm` failure as absence, so an auth or rate-limit error
   could satisfy them;
3. a completion repair bound a descendant of the published commit, which made the tag and the npm
   provenance stop containing the bound implementation;
4. the body still described a pre-release world after the release, so each patch created fresh
   contradictions elsewhere - which is why it was rewritten from scratch around the one remaining
   step;
5. the disclosure named a follow-up plan that did not yet exist, so the plan was written and
   registered rather than the wording softened;
6. the lane-history prose miscounted by one, so the count is now derived from the ledger;
7. that stale prose could not be repaired in place, because a drafting body install may not move
   persisted Verification Results, so the successor carries the placeholder and the record is
   written once here.

The irreversible boundaries were crossed before any completion review of this lane existed: push,
tag, GitHub release and npm publication all completed first. That is recorded rather than hidden,
and it is why several of those blocks were unavoidable once they had happened.
