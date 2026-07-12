---
title: Harden docks-kit session-relay readiness
goal: Proactively verify session-relay's stable runtime, report Docks readiness, and make restart advice change-sensitive without moving plugin safety into docks-kit.
status: blocked
created: "2026-07-12T00:37:40-03:00"
updated: "2026-07-12T02:24:33-03:00"
started_at: null
blocked_reason: Waiting on a final dual-reviewed READY Docks/session-relay contract plus an owner-approved release with immutable producer schemas and target digests.
blocked_since: "2026-07-12T02:24:33-03:00"
assignee: null
tags: [docks-kit, codex, session-relay, review-policy, reliability]
affected_paths:
  - docs/plans/active/docks-integration-readiness.md
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/docksRuntime.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/services.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine.ts
  - cli/src/commands/status.ts
  - cli/src/commands/plugins.ts
  - cli/src/manifests.ts
  - cli/src/services.ts
  - cli/src/main.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/docksRuntime.test.ts
  - cli/test/unit/status.test.ts
  - cli/test/unit/plugins.test.ts
  - cli/test/docks-runtime-integration.ts
  - cli/test/fixtures/docks-runtime/install-result.schema.json
  - cli/test/fixtures/docks-runtime/doctor-result.schema.json
  - cli/test/fixtures/docks-runtime/docks-binary-digests.json
  - cli/test/fixtures/docks-runtime/codex-plugin-store.json
  - cli/test/fixtures/docks-runtime/final-scope-allowlist.json
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/docs/plugins.md
  - cli/src/engine-native/DESIGN.md
  - AGENTS.md
related_plans:
  - /home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md
  - standing-cross-company-review-consent
review_status: null
---

# Harden docks-kit session-relay readiness

## Goal

Make `docks-kit sync codex`, `docks-kit status`, and `docks-kit plugins list` reliable consumers of Docks' released session-relay runtime contract: proactively ensure/verify the plugin-owned stable relay executable only after externally anchored binary verification, expose machine-readable readiness, and print a Codex restart instruction only when effective deployed plugin/runtime inputs changed.

Success preserves the ownership boundary: **Docks/session-relay owns hook execution durability, binary provenance, lifecycle admission, and the versioned doctor schema; docks-kit invokes and reports that contract.** A standalone plugin install remains safe without docks-kit. docks-kit never reconstructs lifecycle state, writes Codex hook trust state, bypasses host policy, or treats a diagnostic result as worker-quiescence proof.

## Context

- **Owner decision (2026-07-12):** session-relay safety belongs in Docks, while the personal `docks-kit` CLI should proactively deploy and verify it where that improves upgrades and status UX.
- A live Codex session produced repeated SessionStart/UserPromptSubmit exit 127 after `docks-kit sync codex`: the old process retained an absolute hook command into a pruned versioned plugin cache. Fresh hooks and a fresh Codex session were green. Docks Draft-13 therefore owns a monotonic stable runtime; this plan consumes it.
- Current `codexSync.ts::syncPlugins` reruns `codex plugin add` for every enabled plugin and sets `codexRestart` after every successful add, even when the effective plugin payload did not change. Current status/plugin views report counts and installation state but no session-relay runtime readiness.
- Standing cross-company consent is independent config deployment and lives in `standing-cross-company-review-consent`; it is not blocked by this runtime contract and has a separate commit/revert boundary.
- **Current blocker (2026-07-12):** the Docks lifecycle contract is still being remodeled after immutable Draft-16 review; neither Draft-15 `48fec8b12296166be247eb6cee45c038f4d4dce5` nor any Draft-16/Draft-17 working candidate is an implementation pin. There is no owner-approved producer release carrying the final schemas and four target binaries. This plan therefore remains `blocked`; no CLI implementation step may start.

## Blocker and unblock gate

The plan may unblock only after a plan-only transition records all of these as literal immutable values in this section and records every fixture source blob/hash that Step 1 must copy:

- the full Docks contract commit and exact lifecycle-plan blob whose `review_status` is `passed`;
- the owner-approved release tag and its target commit, neither draft nor prerelease unless the owner explicitly selected that release class;
- the plugin version, exact producer installer-schema blob/hash, doctor-schema blob/hash, and release-contract fixture path/blob/hash;
- the externally reviewed SHA-256 for each of `relay-x86_64-unknown-linux-musl`, `relay-aarch64-unknown-linux-musl`, `relay-x86_64-apple-darwin`, and `relay-aarch64-apple-darwin`;
- the reviewed canonical `plugin_payload_sha256` and `hook_definitions_sha256` for that exact released payload.

Before `unblock` or `start`, the orchestrator independently verifies the local Docks plan commit/blob/review, the GitHub release/tag target and release class, hashes the four binaries at that exact release commit, and validates the producer schema/fixture blobs and closed fixture fields. A0 encodes those checks from literal values; Step 1 then byte-copies the verified sources into public fixtures and rechecks their hashes before any adapter code is written. A missing value, mutable ref, mismatched target, dirty producer fixture, or unapproved release leaves this plan blocked; no cache byte is executed.

## Interface and ownership contract

Implementation starts only after the unblock gate records a final dual-reviewed READY Docks commit and owner-approved released interface. The prior Draft-15 candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` and the current unresolved Draft-16/Draft-17 remodel history are research context only and are **not implementation pins**:

```text
Stable runtime root: ${XDG_DATA_HOME:-$HOME/.local/share}/docks/session-relay/runtime/
runtime.json: { schema, plugin_version, target, binary_sha256, plugin_payload_sha256, hook_definitions_sha256, installed_at }
installer: relay __install-stable --plugin-root <resolved-plugin-root> --json
doctor: relay doctor --json --capabilities
```

The JSON schemas, exit taxonomy, target/version comparison rules, and provenance fields are copied into fixtures from the final exact Docks contract commit and cited here before Step 1 starts. The closed external release fixture is:

```ts
type DocksReleaseContract = {
  schema: 1
  reviewedPlanCommit: string   // exact 40-hex commit carrying the passed plan review
  producerPlanBlob: string     // exact reviewed lifecycle-plan blob
  producerCommit: string       // exact 40-hex release/tag target containing shipped bytes
  releaseTag: string
  pluginVersion: string
  targets: Array<{ target: string; binarySha256: string }> // exact four, unique and byte-sorted
  pluginPayloadSha256: string
  hookDefinitionsSha256: string
  installerSchemaSha256: string
  doctorSchemaSha256: string
}
```

`docksRuntime.ts` selects the exact platform-native `bin/relay-<target>`, rejects a symlink/non-regular/mode-invalid candidate, and verifies it against `targets` **before any cache argv execution**. It invokes that verified native file directly as `bin/relay-<target> __install-stable ...`; it never executes the cache's `bin/relay` dispatcher. It then parses the returned stable path, validates the Docks-managed relative `current` link and immutable generation beneath the resolved stable root, lstat-validates the selected regular native file/record, and externally hashes that stable native binary against the same target fixture before invoking `doctor`. Standalone `status` and `plugins list` perform this stable-path verification before doctor even when cache discovery is unavailable. Pre/post lstat+digest/identity mismatch is typed failure; same-UID substitution inside the final spawn window remains the explicitly stated cooperative local-trust boundary. The public adapter does not implement semver replacement, stable-binary copying, fsync, generation switching, lifecycle transitions, or proof promotion. Internal `SHA256SUMS` is a corruption cross-check only; it is never the authenticity anchor.

Active-root discovery is a fail-closed compatibility adapter, not a durable Codex API. For each explicitly supported Codex release, a fixture pins `codex --version`, the upstream source/tag/commit, `plugin list --json` schema, and `PluginStore` root layout. The adapter reads the installed+enabled version, constructs exactly `$CODEX_HOME/plugins/cache/docks/session-relay/<version>`, canonicalizes it beneath that root, and validates regular-file manifest/id/version/digest fields. It never scans/selects among cache versions or parses `hooks/list` as an authoritative root. Unsupported Codex versions return typed `unavailable_codex_contract`; the standalone hook bootstrap remains available.

Runtime paths are resolved once and injected everywhere:

```text
home      = non-empty HOME, else platform homedir
codexHome = non-empty CODEX_HOME, else <home>/.codex
dataHome  = non-empty XDG_DATA_HOME, else <home>/.local/share
```

Resolution is closed and platform-aware. An explicit environment value must be absolute, NUL-free, lexically normalized, and contain no `.`/`..` component; relative or normalization-changing values fail before mutation. Existing roots are `realpath`-canonicalized. For an absent root, resolve the nearest existing ancestor, reject any symlink/non-directory component, and append only the already-normalized suffix. `codexHome` and `dataHome` must be disjoint—neither equal to nor an ancestor of the other—while each may normally be beneath `home`; symlink aliases are compared after canonicalization. `home` may not equal either specialized root. The resolved roots must remain stable across pre/post lstat checks for the operation.

`Ctx` carries the exact canonical `ResolvedRuntimePaths { home, codexHome, dataHome }`. Every Codex config/model/plugin/cache read/write uses `codexHome`; every child receives those same explicit `HOME`, `CODEX_HOME`, and `XDG_DATA_HOME` strings; stable relay paths use `dataHome`. `codexToml.ts`, `modes.ts`, `codexSync.ts`, `manifests.ts`, and status/plugin readers must not fall back independently to `homedir()`. Tests isolate all three roots and cover relative, `..`, symlink-alias, absent-parent, equal-root, and ancestor-overlap negatives. If a platform cannot honor a non-default split consistently, fail before mutation rather than mixing homes.

Required docks-kit result:

```ts
type DocksRuntimeReadiness = {
  schema: 1
  plugin: "session-relay@docks"
  state: "ready" | "degraded" | "unavailable"
  pluginVersion: string | null
  pluginPayloadSha256: string | null
  hookDefinitionsSha256: string | null
  target: string | null
  binarySha256: string | null
  stablePath: string | null
  hookHealth: "healthy" | "degraded" | "unknown"
  capabilities: {
    stableRuntime: "available" | "unavailable" | "unknown"
    hookSessionStart: "available" | "unavailable" | "unknown"
    hookUserPromptSubmit: "available" | "unavailable" | "unknown"
    managedAppserver: "available" | "unavailable" | "unknown"
    cooperativeCgroup: "available" | "unavailable" | "unknown"
    filteredHardening: "available" | "unavailable" | "unknown"
  }
  reasonCode:
    | "ready" | "hook_health_degraded" | "capability_unavailable"
    | "stable_runtime_absent" | "unsupported_runtime_contract"
    | "unavailable_codex_contract" | "plugin_disabled"
    | "external_digest_mismatch" | "command_timed_out" | "schema_mismatch"
    | "unsupported_target" | "unsupported_install_source" | "validation_failed"
    | "tamper_detected" | "owner_mode_invalid" | "lock_failed" | "io_failed"
    | "refresh_failed_previous_ready"
    | null
}
```

Every field is derived from the versioned plugin response or an explicit absence/typed failure. Free-form stderr is display evidence, never a reason classifier. `ready` requires an exact external release-contract match for the selected stable binary, plugin payload, and hook definitions plus a schema-valid doctor result. Hook health may degrade readiness but never becomes managed-admission or quiescence authority. JSON output is stable and closed; human output is a projection. Read-only readiness deliberately contains no restart field: a later `status`/`plugins` process cannot know what an already-running Codex session loaded.

Restart advice is transient and sync-only:

```ts
type RuntimeChangeFingerprint = {
  schema: 1
  plugin: null | {
    installed: boolean
    enabled: boolean
    pluginVersion: string
    sourceIdentitySha256: string // only fields actually emitted by the pinned plugin-list schema
    cacheRootSha256: string
    target: string
    binarySha256: string
    pluginPayloadSha256: string
    hookDefinitionsSha256: string
    externalContractSha256: string
  }
  stable: null | {
    selectedGeneration: string
    pluginVersion: string
    target: string
    binarySha256: string
    pluginPayloadSha256: string
    hookDefinitionsSha256: string
    runtimeRecordSha256: string
  }
}

type SyncRestartAdvice = {
  required: boolean
  reason: "effective_inputs_changed" | "equivalence_unproven" | null
  changedFields: string[] // byte-sorted closed field paths; empty iff required=false
}
```

The sync command snapshots and canonical-hashes the observable fingerprint before refresh and after ensure/doctor. It never invents a resolved marketplace commit: a commit participates only if a future pinned Codex schema actually emits an immutable resolved commit. Any field delta yields `effective_inputs_changed`; failed/ambiguous observation yields `equivalence_unproven`; exact equality yields no advice. This value is not persisted, is not emitted by read-only commands, and makes no claim about loaded-session state.

### Closed outcome mapping

Step 1 copies the final producer reason/exit sets and fails if they differ from this exhaustive mapping. `previous externally ready` means the pre-refresh stable path independently passes the external release fixture and schema-valid doctor before the failing refresh; a merely present record is not enough.

| Input | Public state/reason | Continue previous? | Sync restart advice |
|---|---|---:|---|
| Installer exit 0: `installed|already_current|lower_version_ignored|previous_retained` | Run doctor; doctor row below is authoritative. | `lower_version_ignored|previous_retained` only when previous is externally ready | Fingerprint delta; `equivalence_unproven` if either snapshot is incomplete |
| Doctor exit 0 `ready/ready` | `ready/ready` | yes | Fingerprint delta only |
| Doctor exit 0 `degraded/hook_health_degraded` | `degraded/hook_health_degraded` | yes | Fingerprint delta only |
| Doctor exit 0 `unavailable/capability_unavailable|stable_runtime_absent|unsupported_runtime_contract` | `unavailable/<same reason>` | no | `equivalence_unproven` |
| Installer exit 2 `usage|schema_mismatch` | With previous externally ready: `degraded/refresh_failed_previous_ready`; otherwise `unavailable/schema_mismatch`. | conditional | `equivalence_unproven` |
| Installer exit 3 `unsupported_target|unsupported_install_source` | With previous externally ready: `degraded/refresh_failed_previous_ready`; otherwise `unavailable/<same reason>`. | conditional | `equivalence_unproven` |
| Installer exit 4 `validation_failed|tamper_detected|owner_mode_invalid` | With previous externally ready: `degraded/refresh_failed_previous_ready`; otherwise `unavailable/<same reason>`. | conditional | `equivalence_unproven` |
| Installer exit 5 `lock_failed|io_failed` | With previous externally ready: `degraded/refresh_failed_previous_ready`; otherwise `unavailable/<same reason>`. | conditional | `equivalence_unproven` |
| Cache/stable external hash, release-contract, path, or post-check mismatch | With previous externally ready: `degraded/external_digest_mismatch`; otherwise `unavailable/external_digest_mismatch`. | conditional | `equivalence_unproven` |
| Bounded installer/doctor timeout | With a separately preflighted previous externally ready runtime: `degraded/command_timed_out`; otherwise `unavailable/command_timed_out`. | conditional; timed-out child is killed/reaped | `equivalence_unproven` |
| Closed JSON/schema mismatch from any producer command | With previous externally ready: `degraded/schema_mismatch`; otherwise `unavailable/schema_mismatch`. | conditional | `equivalence_unproven` |
| Unsupported pinned Codex adapter, but stable runtime is externally ready and doctor succeeds | `degraded/unavailable_codex_contract` | yes; no cache refresh | `equivalence_unproven` for sync, none for read-only commands |
| Unsupported Codex adapter without externally ready stable runtime | `unavailable/unavailable_codex_contract` | no | `equivalence_unproven` |
| Plugin explicitly disabled | `unavailable/plugin_disabled` | no proactive install/use | Fingerprint delta if sync changed enabled state |
| Unknown exit, reason, state, key, or extra field | With previous externally ready: `degraded/schema_mismatch`; otherwise `unavailable/schema_mismatch`. | conditional | `equivalence_unproven` |

No stderr substring, editable boolean, or self-reported cache checksum selects a row. A refresh failure never deletes/invalidates a previous externally ready runtime, but `refresh_failed_previous_ready` is never reported as fully ready.

Wire compatibility is exact:

- `status --json` preserves its existing top-level keys and adds exactly `docksRuntime: DocksRuntimeReadiness`.
- `plugins list --json` remains a bare array. Existing row fields remain unchanged; only the `session-relay@docks` row adds optional `runtimeReadiness: DocksRuntimeReadiness`. All other rows omit that key.
- Human status adds one compact `Docks runtime:` row; human plugin output adds a detail line only for session-relay. No wrapper object or heterogeneous standalone array element is permitted.

One shared `RuntimeInspector` accepts resolved paths plus a bounded `CommandExecutor`. `engine-native/services.ts` owns the injectable argv executor/deadline/environment implementation; `cli/src/services.ts` exposes the same capability as an Effect `Context.Tag` and live/test layers composed once by `main.ts`. `cli/src/engine.ts` yields and passes that same service when it reconstructs `EngineServices` for the in-process EngineNative seam. EngineNative and Effect commands therefore use one implementation, proven with one shared test double/call ledger. `manifests.ts` takes explicit resolved paths; it never reads process-global homes for these rows.

## Environment and real-runtime harness

- Required baseline is recorded from the producer fixtures before start: Node/Bun versions from this repo, exact supported Codex release, final reviewed Docks commit/release, plugin target, and installer/doctor schema hashes. Any mismatch is failure or typed unsupported, never skip/pass.
- `cli/test/docks-runtime-integration.ts` owns `/tmp/docks-kit-runtime/<uuid>/{home,codex-home,data-home,artifacts}` mode 0700, exports all three root variables explicitly, records child PIDs, applies one monotonic 600-second deadline per case, kills/waits only its own children, and recursively cleans in `finally`. It refuses if any resolved path escapes the harness root.
- Authentication uses the exact safe adapter proven by the pinned Docks real-runtime harness: preflight the current CLI, then either forward the documented allowlisted secret variable by name or read-only reference the runtime-supported credential artifact at its defined location. Never copy credential bytes into the fixture/artifacts, log paths/values/hashes, or broad-copy real CODEX_HOME. If the pinned producer exposes no safe adapter for this runtime, real A6/A7 fail and the plan cannot complete.
- Raw transcripts and fixtures contain redacted argv, exit, schema result, stable/plugin digests, hook sentinels, and artifact hashes; no auth material. Human stderr is retained only as a redacted artifact and cannot classify state.
- Same-UID concurrent mutation between cache digest verification and process exec is outside the cooperative local trust boundary and is stated in status; pre/post lstat+digest mismatch fails. docks-kit makes no stronger atomic-exec/authenticity claim. The immutable reviewed/release digest—not the cache checksum—is the pre-exec trust anchor.

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Run A0, then freeze the producer/compatibility contracts: pin the unblocked final reviewed Docks commit/release, exact four-target binaries, payload/hook digests, installer+doctor schemas/exit taxonomy, exact supported Codex release/source, `plugin list --json`, and PluginStore layout in named fixtures. Add `ResolvedRuntimePaths`, shared `CommandExecutor`/`RuntimeInspector`, exhaustive outcome mapping, closed parsers, and Effect/EngineNative DI through `engine-native/services.ts`, `cli/src/services.ts`, `cli/src/engine.ts`, `main.ts`, and `index.ts`. Commit the exact path/mode allowlist. | — | planned | A0 and fixture hashes match reviewed primary/release source. One injected ledger proves Effect commands and EngineNative invoke the same executor/inspector instance. Tests reject unsupported Codex versions, unknown fields/reasons/exits, malformed digest/path/version, free-form classifier guessing, path escapes/aliases/overlaps, self-reported-only authenticity, and contract drift. **STOP:** the frontmatter is still blocked, any producer literal is missing, Docks is not READY/released with owner approval, or Codex root discovery cannot be pinned/validated; do not scan or execute cache bytes. |
| 2 | Integrate runtime ensure/doctor after successful `session-relay@docks` refresh. Resolve all paths once from `Ctx`; read installed/enabled version; derive exactly the pinned cache root; canonicalize/lstat; externally verify the selected native cache binary, execute that native file directly for install (never the dispatcher), then validate and externally hash the returned stable native binary before bounded doctor argv with explicit HOME/CODEX_HOME/XDG_DATA_HOME. Preserve a previous externally ready runtime according to the closed table when discovery/refresh/validation fails. | 1 | planned | Tests cover default/custom/empty/relative/alias/overlap roots, traversal/version injection, absent Codex/git/plugin, disabled relay, ready/no-op, upgrade, stale same-version cache, matching internal checksum with external binary/payload/hook mismatch, malicious dispatcher with valid native target, tampered stable binary, swapped `current`, pre/post identity race, malformed response, every producer exit/reason with and without previous-ready fallback, and target mismatch. **Revert:** any cache scan/copy, dispatcher execution, unverified stable execution, forbidden symlink follow, self-authentication, split home, or invalidation of a previous externally ready runtime. |
| 3 | Make restart advice change-sensitive and sync-only. Snapshot the exact observable `RuntimeChangeFingerprint` before refresh and after ensure/doctor; set transient `SyncRestartAdvice`/`codexRestart` only on a field delta or unprovable equivalence. Never persist/emit restart state through read-only readiness, claim what a live session loaded, or stop/restart a live Codex session; warn that existing sessions may retain prior loaded hook definitions. | 2 | planned | Two consecutive unchanged syncs produce no restart line; each observable version/digest/hook/enabled/source-identity change produces exactly one actionable line with byte-sorted changed fields; ambiguous refresh advises `equivalence_unproven`. No fake resolved commit is accepted. Golden mutation tests prove no persisted restart flag or automatic restart/kill. **Revert trigger:** idempotent sync still always says restart, read-only output contains restart state, or a fingerprint delta suppresses advice. |
| 4 | Add read-only Docks readiness to `status` and `plugins list` using the exact wire shapes above. Both consume the one injected inspector with resolved homes, externally verify stable native bytes before bounded doctor, and expose no loaded-session/restart claim. | 1-2 | planned | Command-layer/unit/golden tests cover ready/degraded/unavailable, exhaustive mapping, timeout/schema/external-digest failures, previous-ready continuation, no-cache stable inspection, and all root variables. Status adds top-level `docksRuntime`; plugin array adds `runtimeReadiness` only to session-relay. Existing fields and bare-array shape remain byte-compatible; neither readiness object contains `restartRequired`. |
| 5 | Update plugin/EngineNative docs and golden suites; run full gates and targeted real CLI smoke in harness-owned HOME/CODEX_HOME/XDG_DATA_HOME. Record exact producer/compatibility commits and schema hashes in Sources/Notes; execute exact-range final-scope and negative matrices. | 1-4 | planned | Acceptance's encoded two-pass gate is idempotent; isolated upgrade keeps old-session hooks viable through Docks stable runtime. Exact `26ebb1c9e35986a3438bb00695832e98f256ad2e..IMPL_TIP` paths/modes equal the closed allowlist, whose only docs entry is this lifecycle plan. No secrets, binaries, versions, releases, SoT prompt changes, or real-home files are committed. |

## Acceptance criteria

At unblock, replace the blocker prose with literal values for the variables below; do not source them from a mutable ref or cache response. A0 is run by the orchestrator before status changes, and again by the Step-1 worker before any fixture write:

```bash
set -euo pipefail
test "${#DOCKS_REVIEWED_PLAN_COMMIT}" -eq 40
test "${#DOCKS_RELEASE_COMMIT}" -eq 40
test "${#DOCKS_PLAN_BLOB}" -eq 40
for value in "$DOCKS_PLAN_PATH" "$DOCKS_RELEASE_TAG" "$DOCKS_PLUGIN_VERSION" "$DOCKS_INSTALL_SCHEMA_PATH" "$DOCKS_DOCTOR_SCHEMA_PATH" "$DOCKS_RELEASE_FIXTURE_PATH"; do test -n "$value"; done
for digest in "$DOCKS_PLUGIN_PAYLOAD_SHA256" "$DOCKS_HOOK_DEFINITIONS_SHA256" "$DOCKS_INSTALL_SCHEMA_SHA256" "$DOCKS_DOCTOR_SCHEMA_SHA256" "$DOCKS_RELEASE_FIXTURE_SHA256"; do [[ "$digest" =~ ^[0-9a-f]{64}$ ]]; done
test "$(git -C /home/vagrant/projects/docks rev-parse "$DOCKS_RELEASE_TAG^{commit}")" = "$DOCKS_RELEASE_COMMIT"
git -C /home/vagrant/projects/docks merge-base --is-ancestor "$DOCKS_REVIEWED_PLAN_COMMIT" "$DOCKS_RELEASE_COMMIT"
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_REVIEWED_PLAN_COMMIT:$DOCKS_PLAN_PATH" | git hash-object --stdin)" = "$DOCKS_PLAN_BLOB"
git -C /home/vagrant/projects/docks show "$DOCKS_REVIEWED_PLAN_COMMIT:$DOCKS_PLAN_PATH" | rg -q '^review_status: passed$'
test "$(git -C /home/vagrant/projects/docks rev-parse "$DOCKS_RELEASE_COMMIT:$DOCKS_INSTALL_SCHEMA_PATH")" = "$DOCKS_INSTALL_SCHEMA_BLOB"
test "$(git -C /home/vagrant/projects/docks rev-parse "$DOCKS_RELEASE_COMMIT:$DOCKS_DOCTOR_SCHEMA_PATH")" = "$DOCKS_DOCTOR_SCHEMA_BLOB"
test "$(git -C /home/vagrant/projects/docks rev-parse "$DOCKS_RELEASE_COMMIT:$DOCKS_RELEASE_FIXTURE_PATH")" = "$DOCKS_RELEASE_FIXTURE_BLOB"
release_contract="$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:$DOCKS_RELEASE_FIXTURE_PATH")"
jq -e 'keys == ["doctorSchemaSha256","hookDefinitionsSha256","installerSchemaSha256","pluginPayloadSha256","pluginVersion","producerCommit","producerPlanBlob","releaseTag","reviewedPlanCommit","schema","targets"]' <<<"$release_contract" >/dev/null
jq -e 'all(.targets[]; keys == ["binarySha256","target"])' <<<"$release_contract" >/dev/null
jq -e '.targets | map(.target) as $names | $names == ($names | sort)' <<<"$release_contract" >/dev/null
test "$(jq -r .schema <<<"$release_contract")" = 1
test "$(jq -r .reviewedPlanCommit <<<"$release_contract")" = "$DOCKS_REVIEWED_PLAN_COMMIT"
test "$(jq -r .producerPlanBlob <<<"$release_contract")" = "$DOCKS_PLAN_BLOB"
test "$(jq -r .producerCommit <<<"$release_contract")" = "$DOCKS_RELEASE_COMMIT"
test "$(jq -r .releaseTag <<<"$release_contract")" = "$DOCKS_RELEASE_TAG"
test "$(jq -r .pluginVersion <<<"$release_contract")" = "$DOCKS_PLUGIN_VERSION"
test "$(jq -r .pluginPayloadSha256 <<<"$release_contract")" = "$DOCKS_PLUGIN_PAYLOAD_SHA256"
test "$(jq -r .hookDefinitionsSha256 <<<"$release_contract")" = "$DOCKS_HOOK_DEFINITIONS_SHA256"
test "$(jq -r .installerSchemaSha256 <<<"$release_contract")" = "$DOCKS_INSTALL_SCHEMA_SHA256"
test "$(jq -r .doctorSchemaSha256 <<<"$release_contract")" = "$DOCKS_DOCTOR_SCHEMA_SHA256"
test "$(jq -r '.targets | length' <<<"$release_contract")" = 4
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:plugins/session-relay/.codex-plugin/plugin.json" | jq -r .version)" = "$DOCKS_PLUGIN_VERSION"
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:plugins/session-relay/.claude-plugin/plugin.json" | jq -r .version)" = "$DOCKS_PLUGIN_VERSION"
release_json="$(gh release view "$DOCKS_RELEASE_TAG" --repo DocksDocks/docks --json tagName,isDraft,isPrerelease)"
test "$(jq -r .tagName <<<"$release_json")" = "$DOCKS_RELEASE_TAG"
test "$(jq -r .isDraft <<<"$release_json")" = false
test "$(jq -r .isPrerelease <<<"$release_json")" = false
for row in \
  "relay-x86_64-unknown-linux-musl:$DOCKS_SHA_LINUX_X86_64" \
  "relay-aarch64-unknown-linux-musl:$DOCKS_SHA_LINUX_AARCH64" \
  "relay-x86_64-apple-darwin:$DOCKS_SHA_DARWIN_X86_64" \
  "relay-aarch64-apple-darwin:$DOCKS_SHA_DARWIN_AARCH64"
do
  name="${row%%:*}"; expected="${row#*:}"
  test "${#expected}" -eq 64
  test "$(git -C /home/vagrant/projects/docks ls-tree "$DOCKS_RELEASE_COMMIT" "plugins/session-relay/bin/$name" | cut -d' ' -f1)" = 100755
  test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:plugins/session-relay/bin/$name" | sha256sum | cut -d' ' -f1)" = "$expected"
  test "$(jq -r --arg name "$name" '[.targets[] | select(.target == $name) | .binarySha256] | if length == 1 then .[0] else empty end' <<<"$release_contract")" = "$expected"
done
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:$DOCKS_INSTALL_SCHEMA_PATH" | sha256sum | cut -d' ' -f1)" = "$DOCKS_INSTALL_SCHEMA_SHA256"
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:$DOCKS_DOCTOR_SCHEMA_PATH" | sha256sum | cut -d' ' -f1)" = "$DOCKS_DOCTOR_SCHEMA_SHA256"
test "$(git -C /home/vagrant/projects/docks show "$DOCKS_RELEASE_COMMIT:$DOCKS_RELEASE_FIXTURE_PATH" | sha256sum | cut -d' ' -f1)" = "$DOCKS_RELEASE_FIXTURE_SHA256"
```

| ID | Command | Expected result |
|---|---|---|
| A0 | Run the exact producer/release preflight above with the literal values recorded by the unblock commit. | Exit 0 before unblock/start and again before Step 1. Exact Docks commit, plan blob with `review_status: passed`, owner-approved non-draft/non-prerelease release tag, producer schema blob/hashes, and four target bytes/digests match. Any missing/mutable/mismatched value keeps the plan blocked. |
| A1 | `bun run test:unit -- docksRuntime engine-di status plugins` | Exit 0. Absolute/disjoint resolved roots, one shared Effect/EngineNative executor ledger (including `cli/src/engine.ts`), full external release contract, direct verified-native installer argv, verified stable-before-doctor, exhaustive outcome mapping, pinned root adapter, previous-ready preservation, transient sync fingerprint/advice, and exact wire shapes pass. No editable booleans, dispatcher execution, or self-reported checksum substitutes for producer JSON+external fixture. |
| A2 | `bun run golden:dryrun` | Exit 0. Codex dry-run names externally verified plugin bootstrap + stable-runtime verify/doctor without writing and preserves current output contracts except reviewed additions. |
| A3 | `bun run golden:mutation` | Exit 0. First changed sync records the observable fingerprint delta and one sync-only restart line; a second unchanged sync is a no-op with no line. Ambiguous comparison advises `equivalence_unproven`. Status/plugins human+JSON output matches reviewed goldens and contains no restart field. |
| A4 | `bun cli/test/docks-runtime-integration.ts --case dry-run-isolation` | Exit 0; harness-owned absolute HOME/CODEX_HOME/XDG_DATA_HOME contain every access; relative/`..`/symlink-alias/equal/ancestor-overlap roots refuse before mutation; no real path changes occur; preview is explicit; cleanup/child reap runs in `finally`. |
| A5 | `bun cli/test/docks-runtime-integration.ts --case wire-compatibility` | Exit 0; status preserves its top-level object and adds `docksRuntime`; plugins remains a bare array and only session-relay adds `runtimeReadiness`; neither object contains `restartRequired`; every producer/public outcome maps exactly; human projections and typed failures match goldens. |
| A6 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case idempotent-sync` | Exit 0; isolated authenticated fixture first installs/verifies, second is byte/idempotency clean and omits restart advice. Existing sessions are not stopped. Missing auth is failure, never skip/pass. |
| A7 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case live-upgrade` | Exit 0; harness starts N session, syncs reviewed N+1 and prunes N cache, then old UserPromptSubmit and new/subagent SessionStart both exit 0 through stable runtime. Reported manifest/payload/hook digests and doctor schema match. Integration evidence only; Docks A6b is standalone gate. |
| A8 | `for pass in 1 2; do bun run test:unit && bun run golden:dryrun && bun run golden:mutation; done` | Both encoded passes exit 0. No flaky state, stray child, real HOME/CODEX_HOME/XDG mutation, or golden drift remains. |
| A9 | `test "$(git rev-parse HEAD)" = "$IMPL_TIP" && test -z "$(git status --porcelain)" && git diff --check 26ebb1c9e35986a3438bb00695832e98f256ad2e.."$IMPL_TIP" && bun cli/test/docks-runtime-integration.ts --case final-scope --base 26ebb1c9e35986a3438bb00695832e98f256ad2e --tip "$IMPL_TIP" --allow cli/test/fixtures/docks-runtime/final-scope-allowlist.json && bun cli/test/docks-runtime-integration.ts --case final-scope-negative-matrix --base 26ebb1c9e35986a3438bb00695832e98f256ad2e` | Exit 0 at exact clean tip. Full range path+mode set equals the closed allowlist (including this plan as the sole docs path). Disposable negatives independently reject SoT/generated prompt, plugin binary, package/version, tag/release-like file, credential, deployed-home path, rename, deletion, staged/unstaged/untracked, and an unexpected otherwise-plausible `cli/src/**` path. |

## Out of scope

- Lifecycle admission, first-turn gating, hook trust/health semantics, cgroup/process proof, quiescence, supervisor/watchdog, and stable binary installation internals remain in Docks/session-relay.
- docks-kit does not write Codex internal hook trust, pass `--dangerously-bypass-hook-trust`, copy a binary from a plugin cache, reconstruct a missing stable runtime from an unverified path, or promote doctor output to lifecycle proof.
- No automatic live-session stop/restart, plugin release, version bump, tag, push, or marketplace mutation beyond the existing normal `sync` workflow.
- No persisted/read-only restart state, loaded-session inference, or claim that a later process can observe which hook bytes an existing Codex session loaded.
- No review-policy or global prompt deployment; `standing-cross-company-review-consent` owns that independent change.
- No unrelated plugin-list redesign or broad status framework.

## Self-review

Score: **95/100 Draft-3 author candidate; independent candidate re-review pending** · trajectory **78/100 NOT READY at `26ebb1c9e35986a3438bb00695832e98f256ad2e` (plan blob `049b269cbaec29e78eebb3eb4429bb73e526ae11`) → 95/100 after closed-contract repair**.

**Immutable Draft-2 review (2026-07-12):** The independent reviewer scored the exact commit/blob above **78/100 NOT READY**. The ownership split was sound, but implementation could still false-green because read-only output carried an unknowable `restartRequired`; native-cache and stable pre-exec provenance were incomplete; producer errors lacked a closed public mapping; A9 could pass without proving the exact implementation range and complete file/mode scope; the producer dependency was prose-only; payload/hook digests were not externally anchored; `cli/src/engine.ts` was absent from the DI path; plugin source change detection depended on an unobservable resolved commit; root normalization was under-specified; A8 claimed two passes without encoding them; and the stale Docks Draft-15 candidate was still presented too close to an implementation pin.

**Draft-3 repair:** Read-only readiness has no restart field; restart advice is a transient sync-only before/after fingerprint with an explicit `equivalence_unproven` branch. The direct target-native installer and returned stable native binary are independently path/mode/digest checked before execution, with the dispatcher forbidden. The exhaustive outcome table maps every known/unknown installer, doctor, timeout, schema, path, and digest result, including previous-ready continuation. The plan is now `blocked` on literal final dual-reviewed producer and owner-approved release coordinates; A0 verifies distinct reviewed-plan and release commits, both schema blobs/hashes, the release fixture, both manifests, release class, and all four target bytes. Payload and hook-definition digests are part of the immutable external contract. The shared Effect/EngineNative ledger explicitly traverses `cli/src/engine.ts`. Source identity uses only observable pinned-schema fields and never invents a resolved commit. Root resolution closes normalization, absent-parent, alias, equality, and ancestor-overlap cases. A8 executes the full suite twice. A9 fixes base/tip cleanliness and validates the entire path+mode set against a closed allowlist plus independent negative cases.

- **Actionability:** 15/16 — every implementation step has an executable done condition and revert trigger; final producer literals are intentionally absent while blocked.
- **Dependency order:** 12/12 — the producer review/release gate is a status-level prerequisite, A0 repeats it, and no consumer work may begin before it passes.
- **Evidence re-verify:** 10/10 — the current public implementation surfaces and exact immutable review commit/blob are recorded; future producer facts are marked unknown rather than guessed.
- **Goal coverage:** 12/12 — externally verified deployment, readiness, and change-sensitive sync advice each have an owning step and gate without transferring plugin safety.
- **Checkable acceptance:** 11/12 — unit/golden/scope gates are exact; authenticated real-runtime A6/A7 remain necessarily contingent on the producer's documented safe credential adapter.
- **Failure mode:** 10/10 — unknown schema/exit, provenance mismatch, timeout, path race, stale cache, prior-runtime preservation, root escape, and secret leakage are closed failures or STOP conditions.
- **Assumption to question:** 5/6 — no design choice remains open, but final producer/release coordinates and the supported Codex compatibility fixture must still be independently supplied and reviewed.

Cold-handoff result: a fresh agent can determine why work cannot start and can reproduce the exact unblock checks without inventing producer fields. This plan remains `blocked` until a plan-only transition records all immutable values and A0 passes; starting implementation against Draft-15 or any unreviewed Draft-16/Draft-17 candidate is forbidden. After that transition, an independent plan-review pass must still mark the candidate READY before `start`.

## Sources

- `cli/src/engine-native/codexSync.ts:433-480` — current sync reruns `codex plugin add` for every enabled plugin and marks restart after every successful refresh.
- `cli/src/engine-native/codexSync.ts:495-498` — current next-step policy prints restart whenever `codexRestart` is set (or verbose).
- `cli/src/commands/status.ts:45-78` — status currently gathers model drift, toolchain, plugin count, and skill count only.
- `cli/src/commands/plugins.ts:14-34` — plugin list currently exposes SoT tri-state plus Claude installed state only.
- `cli/src/manifests.ts:50-72` — current plugin view is derived from Claude installed state and has no Docks runtime readiness.
- `cli/src/engine-native/index.ts:31-75,89-119` — `Ctx.nextStepTriggers` owns restart output and EngineNative runs Codex sync before summaries/next steps.
- `AGENTS.md:35-41` — Codex plugin refresh and global SoT ownership are documented repo contracts.
- `AGENTS.md:47-56` — sync must be idempotent and global prompt files must remain concise action rules.
- `cli/src/engine-native/services.ts`, `cli/src/services.ts`, and `cli/src/engine.ts:28-38` — current injectable capability factory, Effect rim, and engine yield path expose logger/dependency/platform only; runtime inspection/argv execution needs one shared added capability end to end.
- `cli/src/engine-native/codexToml.ts:60-77` and `cli/src/engine-native/modes.ts:47-54` — current Codex config/model paths hard-code `ctx.home/.codex`, proving the CODEX_HOME split-brain to repair.
- `codex plugin list --json` on Codex 0.144.1 — current primary CLI output exposes installed/enabled `session-relay@docks` version and source identity, but no cache root path.
- [OpenAI Codex app-server plugin/hook inventory](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — `hooks/list` exposes command/source/hash health and `plugin/list` exposes plugin state; neither is an atomic lifecycle proof.
- [OpenAI Codex PluginStore cache behavior](https://github.com/openai/codex/issues/21138) — primary-source pointers identify `PluginStore::plugin_root()` as `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` and document same-version staleness risk, so discovery is version-pinned and every root is revalidated.
- [Official Codex Build Plugins](https://learn.chatgpt.com/docs/build-plugins) — current cache layout is documented but still consumed only through an exact-version compatibility fixture.
- `/home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md` — the producer lifecycle plan is still under post-Draft-16 remodel. Historical Draft-15 candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` is research context only; no producer commit, blob, schema, or digest becomes a pin until the final plan passes dual review and the owner approves its release.

## Review

*(filled by plan-review on completion)*
