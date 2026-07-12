---
title: Harden docks-kit session-relay readiness
goal: Proactively verify session-relay's stable runtime, report Docks readiness, and make restart advice change-sensitive without moving plugin safety into docks-kit.
status: blocked
created: "2026-07-12T00:37:40-03:00"
updated: "2026-07-12T02:46:37-03:00"
started_at: null
blocked_reason: Waiting on canonical completion-reviewed Docks/session-relay releases N and N+1, owner approval, immutable producer hashes/schemas, and a pinned Codex compatibility contract.
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
  - cli/test/fixtures/docks-runtime/docks-release-catalog.json
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

The plan may unblock only through a plan-only commit that replaces every
`<FINAL_...>` placeholder in A0 with immutable literals and records their
provenance here. No release value is guessed while this plan is blocked. The
unblock commit must contain:

- two distinct, owner-approved Docks releases, identified as N and N+1, each
  with a remotely authenticated tag/commit, exact plugin version, all four
  target digests, payload/hook digests, installer/doctor schema path+blob+hash,
  release-contract fixture path+blob+hash, and exact producer hash-helper
  path+blob+hash+argv;
- for each release, the exact lifecycle-plan path/blob, `planned_at_commit`,
  `reviewed_head`, canonical completion-receipt hash, resolved policy hash,
  completion-validator path+blob+hash+argv, and the closed eligible outcome;
- one exact Codex compatibility contract: CLI version, upstream tag and commit,
  `plugin list --json` schema fixture/hash, and the upstream `PluginStore`
  layout source path/blob/content hash;
- the SHA-256 of the pre-implementation final-scope JCS oracle recorded below,
  plus the exact public plan-contract commit/blob containing that oracle and
  all unblock literals.

An eligible producer completion is exactly one of: `(outcome=dual, X=passed,
S=passed)` or `(outcome=single, one leg=passed, the other=platform_denied,
resolved policy permits single-leg completion, review_status=passed)`. A
platform denial is never rewritten as a passed review or retried through an
alternate transport. Waived, not-authorized, timed-out, malformed, zero-review,
or `review_status:null` evidence is ineligible for this consumer gate.

Before `unblock` or `start`, the orchestrator runs A0 from a clean checkout. A0
authenticates both remote Git tags rather than trusting local tags, checks both
completion receipts with the pinned producer validator, recomputes payload and
hook hashes with the pinned producer helper in detached isolated trees, and
verifies the pinned Codex source/fixtures and public scope oracle. Step 1 then
byte-copies only those verified fixtures and rechecks every blob/hash before
adapter code is written. Missing literals, mutable refs, helper/validator argv
not supplied by the released producer, a remote/local target mismatch, an
ineligible completion outcome, or a producer without a credential-free
validation mode leaves this plan blocked; no cache byte is executed.

## Interface and ownership contract

Implementation starts only after the unblock gate records canonical eligible
completion evidence for owner-approved N and N+1 released interfaces. The prior
Draft-15 candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` and the current unresolved Draft-16/Draft-17 remodel history are research context only and are **not implementation pins**:

```text
Stable runtime root: ${XDG_DATA_HOME:-$HOME/.local/share}/docks/session-relay/runtime/
runtime.json: { schema, plugin_version, target, binary_sha256, plugin_payload_sha256, hook_definitions_sha256, installed_at }
installer: relay __install-stable --plugin-root <resolved-plugin-root> --json
doctor: relay doctor --json --capabilities
```

The JSON schemas, exit taxonomy, target/version comparison rules, and provenance
fields are copied into fixtures from the two exact releases and cited here
before Step 1 starts. The public fixture is one closed catalog, never a singular
floating "current" contract:

```ts
type CompletionEligibility =
  | { outcome: "dual"; X: "passed"; S: "passed"; policySha256: string; receiptSha256: string }
  | {
      outcome: "single"
      X: "passed" | "platform_denied"
      S: "passed" | "platform_denied"
      policySha256: string
      receiptSha256: string
    } // exactly one passed and one platform_denied; pinned validator says eligible

type DocksReleaseContract = {
  role: "N" | "N+1"
  reviewedPlanCommit: string   // exact 40-hex commit carrying the passed plan review
  producerPlanPath: string
  producerPlanBlob: string     // exact reviewed lifecycle-plan blob
  plannedAtCommit: string
  reviewedHead: string
  completion: CompletionEligibility
  producerCommit: string       // exact 40-hex release/tag target containing shipped bytes
  releaseTag: string
  pluginVersion: string
  targets: Array<{ target: string; binarySha256: string }> // exact four, unique and byte-sorted
  pluginPayloadSha256: string
  hookDefinitionsSha256: string
  installerSchema: { path: string; blob: string; sha256: string }
  doctorSchema: { path: string; blob: string; sha256: string }
  releaseFixture: { path: string; blob: string; sha256: string }
  hashHelper: { path: string; blob: string; sha256: string; argv: string[]; argvSha256: string }
  completionValidator: { path: string; blob: string; sha256: string; argv: string[]; argvSha256: string }
}

type DocksReleaseCatalog = {
  schema: 1
  upgrade: { fromPluginVersion: string; toPluginVersion: string }
  releases: [DocksReleaseContract & { role: "N" }, DocksReleaseContract & { role: "N+1" }]
}

type CodexCompatibilityContract = {
  schema: 1
  codexVersion: string
  upstreamRepo: "openai/codex"
  upstreamTag: string
  upstreamCommit: string
  pluginListSchema: { value: object; sha256: string }
  pluginListFixture: { value: object; sha256: string }
  pluginStoreSourcePath: string
  pluginStoreSourceBlob: string
  pluginStoreSourceSha256: string
}
```

Catalog lookup is exact: read the validated stable record's
`(plugin_version,target)`, select exactly one catalog release whose
`pluginVersion` and unique target row both match, and reject zero or multiple
matches. N authenticates the previous stable runtime; N+1 authenticates the
candidate cache installer and replacement stable runtime. No semver-nearest,
latest, fallback, or cross-version digest reuse is legal. A7 uses these exact N
and N+1 rows; a future N+2 requires a reviewed catalog update before it can be
reported ready.

`docksRuntime.ts` selects the exact platform-native `bin/relay-<target>`, rejects a symlink/non-regular/mode-invalid candidate, and verifies it against the selected catalog row **before any cache argv execution**. It invokes that verified native file directly as `bin/relay-<target> __install-stable ...`; it never executes the cache's `bin/relay` dispatcher. It then parses the returned stable path, validates the Docks-managed relative `current` link and immutable generation beneath the resolved stable root, lstat-validates the selected regular native file/record, and externally hashes that stable native binary against the catalog row selected by the stable record's exact version+target before invoking `doctor`. Standalone `status` and `plugins list` perform this catalog selection and stable-path verification before doctor even when cache discovery is unavailable. Pre/post lstat+digest/identity mismatch is typed failure; same-UID substitution inside the final spawn window remains the explicitly stated cooperative local-trust boundary. The public adapter does not implement semver replacement, stable-binary copying, fsync, generation switching, lifecycle transitions, or proof promotion. Internal `SHA256SUMS` is a corruption cross-check only; it is never the authenticity anchor.

Active-root discovery is a fail-closed compatibility adapter, not a durable Codex API. The unblock commit pins one exact `CodexCompatibilityContract`; Step 1 copies it byte-for-byte rather than choosing a version. The adapter requires the exact `codex --version` and closed `plugin list --json` schema, reads the installed+enabled version, constructs exactly `$CODEX_HOME/plugins/cache/docks/session-relay/<version>`, canonicalizes it beneath that root, and validates regular-file manifest/id/version/digest fields. It never scans/selects among cache versions or parses `hooks/list` as an authoritative root. Unsupported Codex versions, source-schema drift, or a PluginStore source blob mismatch return typed `unavailable_codex_contract`; the standalone hook bootstrap remains available.

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

Hash inputs are closed. `sourceIdentitySha256` is SHA-256 of RFC-8785 JCS over
the exact validated `source` object emitted by the pinned plugin-list schema;
`cacheRootSha256` hashes the UTF-8 canonical absolute cache-root string;
`externalContractSha256` hashes the selected catalog row's JCS;
`runtimeRecordSha256` hashes JCS of the schema-valid runtime record. The whole
fingerprint is JCS-hashed for before/after equality. Symlinks, raw stderr,
mtimes, directory enumeration order, and fields absent from the pinned schema
never enter these hashes.

The sync command snapshots the observable fingerprint before refresh and after
ensure/doctor. It never invents a resolved marketplace commit: a commit
participates only if a future pinned Codex schema actually emits an immutable
resolved commit. Any field delta yields `effective_inputs_changed`;
failed/ambiguous observation yields `equivalence_unproven`; exact equality
yields no runtime advice. This value is not persisted, is not emitted by
read-only commands, and makes no claim about loaded-session state.

Runtime advice is a distinct channel from existing non-plugin
`codexRestart` causes. Config, model, effort, rules, AGENTS, and marketplace
changes retain their current restart behavior. Output coalescing is
deterministic: generic-only keeps the existing line; runtime-only prints one
actionable runtime line with reason and byte-sorted changed fields; when both
are present, print one consolidated line containing the byte-sorted union of
generic cause names and runtime changed fields. An unchanged plugin refresh
must not suppress a real non-plugin restart, and a non-plugin change must not
fabricate a runtime fingerprint delta.

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

- Required baseline is fixed by the unblock commit before start: Node/Bun versions from this repo, exact `CodexCompatibilityContract`, exact N/N+1 `DocksReleaseCatalog`, producer helper/validator argv hashes, plugin targets, completion receipts, and installer/doctor schema hashes. Step 1 copies these values and may not select a newer CLI/release. Any mismatch is failure or typed unsupported, never skip/pass.
- `cli/test/docks-runtime-integration.ts` owns `/tmp/docks-kit-runtime/<uuid>/{home,codex-home,data-home,artifacts}` mode 0700, exports all three root variables explicitly, records child PIDs, applies one monotonic 600-second deadline per case, kills/waits only its own children, and recursively cleans in `finally`. It refuses if any resolved path escapes the harness root.
- Authentication uses the exact safe adapter proven by the pinned Docks real-runtime harness: preflight the current CLI, then either forward the documented allowlisted secret variable by name or read-only reference the runtime-supported credential artifact at its defined location. Never copy credential bytes into the fixture/artifacts, log paths/values/hashes, or broad-copy real CODEX_HOME. If the pinned producer exposes no safe adapter for this runtime, real A6/A7 fail and the plan cannot complete.
- Raw transcripts and fixtures contain redacted argv, exit, schema result, stable/plugin digests, hook sentinels, and artifact hashes; no auth material. Human stderr is retained only as a redacted artifact and cannot classify state.
- Same-UID concurrent mutation between cache digest verification and process exec is outside the cooperative local trust boundary and is stated in status; pre/post lstat+digest mismatch fails. docks-kit makes no stronger atomic-exec/authenticity claim. The immutable reviewed/release digest—not the cache checksum—is the pre-exec trust anchor.

## Pre-implementation scope oracle

The following line is UTF-8 RFC-8785 JCS and is part of this reviewed plan.
`change` is the only allowed base-to-tip status and `mode` is the final Git mode.
The unblock commit records `PUBLIC_SCOPE_ORACLE_SHA256` over these exact bytes
without the Markdown prefix. Step 1 may copy it to
`final-scope-allowlist.json`, but A9 first proves the copy's JCS and hash equal
this pre-implementation oracle. The implementation fixture can never add an
entry or authorize itself.

Final-scope-oracle-jcs: {"base":"26ebb1c9e35986a3438bb00695832e98f256ad2e","entries":[{"change":"M","mode":"100644","path":"AGENTS.md"},{"change":"M","mode":"100644","path":"cli/docs/plugins.md"},{"change":"M","mode":"100644","path":"cli/src/commands/plugins.ts"},{"change":"M","mode":"100644","path":"cli/src/commands/status.ts"},{"change":"M","mode":"100644","path":"cli/src/engine-native/DESIGN.md"},{"change":"M","mode":"100644","path":"cli/src/engine-native/codexSync.ts"},{"change":"M","mode":"100644","path":"cli/src/engine-native/codexToml.ts"},{"change":"A","mode":"100644","path":"cli/src/engine-native/docksRuntime.ts"},{"change":"M","mode":"100644","path":"cli/src/engine-native/index.ts"},{"change":"M","mode":"100644","path":"cli/src/engine-native/modes.ts"},{"change":"M","mode":"100644","path":"cli/src/engine-native/services.ts"},{"change":"M","mode":"100644","path":"cli/src/engine.ts"},{"change":"M","mode":"100644","path":"cli/src/main.ts"},{"change":"M","mode":"100644","path":"cli/src/manifests.ts"},{"change":"M","mode":"100644","path":"cli/src/services.ts"},{"change":"A","mode":"100644","path":"cli/test/docks-runtime-integration.ts"},{"change":"A","mode":"100644","path":"cli/test/fixtures/docks-runtime/codex-plugin-store.json"},{"change":"A","mode":"100644","path":"cli/test/fixtures/docks-runtime/docks-release-catalog.json"},{"change":"A","mode":"100644","path":"cli/test/fixtures/docks-runtime/doctor-result.schema.json"},{"change":"A","mode":"100644","path":"cli/test/fixtures/docks-runtime/final-scope-allowlist.json"},{"change":"A","mode":"100644","path":"cli/test/fixtures/docks-runtime/install-result.schema.json"},{"change":"M","mode":"100644","path":"cli/test/golden-dryrun.ts"},{"change":"M","mode":"100644","path":"cli/test/golden-mutation.ts"},{"change":"M","mode":"100644","path":"cli/test/goldens/dryrun.json"},{"change":"M","mode":"100644","path":"cli/test/goldens/mutation.json"},{"change":"A","mode":"100644","path":"cli/test/unit/docksRuntime.test.ts"},{"change":"M","mode":"100644","path":"cli/test/unit/engine-di.test.ts"},{"change":"A","mode":"100644","path":"cli/test/unit/plugins.test.ts"},{"change":"A","mode":"100644","path":"cli/test/unit/status.test.ts"},{"change":"M","mode":"100644","path":"docs/plans/active/docks-integration-readiness.md"}],"schema":1}

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Re-run A0, then byte-copy the already pinned N/N+1 release catalog, schemas, completion/hash contracts, Codex compatibility fixture, and pre-implementation scope oracle into the named fixtures. Add `ResolvedRuntimePaths`, shared `CommandExecutor`/`RuntimeInspector`, exhaustive outcome mapping, closed parsers, exact catalog selection, and Effect/EngineNative DI through `engine-native/services.ts`, `cli/src/services.ts`, `cli/src/engine.ts`, `main.ts`, and `index.ts`. | — | planned | A0 and every copied fixture blob/hash match the plan-contract commit and detached producer/upstream sources. The copied scope fixture's JCS/hash equals the oracle in this plan. One injected ledger proves Effect commands and EngineNative invoke the same executor/inspector instance. Tests reject unsupported Codex versions, unknown fields/reasons/exits, malformed digest/path/version, free-form classifier guessing, path escapes/aliases/overlaps, self-reported-only authenticity, contract drift, N/N+1 ambiguity, and fixture self-authorization. **STOP:** the frontmatter is still blocked, any placeholder/literal/validator/helper argv is missing, either release completion is ineligible, remote tags or computed hashes disagree, or Codex compatibility cannot be pinned/validated; do not scan or execute cache bytes. |
| 2 | Integrate runtime ensure/doctor after successful `session-relay@docks` refresh. Resolve all paths once from `Ctx`; read installed/enabled version; derive exactly the pinned cache root; canonicalize/lstat; externally verify the selected native cache binary, execute that native file directly for install (never the dispatcher), then validate and externally hash the returned stable native binary before bounded doctor argv with explicit HOME/CODEX_HOME/XDG_DATA_HOME. Preserve a previous externally ready runtime according to the closed table when discovery/refresh/validation fails. | 1 | planned | Tests cover default/custom/empty/relative/alias/overlap roots, traversal/version injection, absent Codex/git/plugin, disabled relay, ready/no-op, upgrade, stale same-version cache, matching internal checksum with external binary/payload/hook mismatch, malicious dispatcher with valid native target, tampered stable binary, swapped `current`, pre/post identity race, malformed response, every producer exit/reason with and without previous-ready fallback, and target mismatch. **Revert:** any cache scan/copy, dispatcher execution, unverified stable execution, forbidden symlink follow, self-authentication, split home, or invalidation of a previous externally ready runtime. |
| 3 | Make runtime restart advice change-sensitive and sync-only without replacing existing non-plugin `codexRestart` causes. Snapshot the exact JCS-defined `RuntimeChangeFingerprint` before refresh and after ensure/doctor; populate distinct transient runtime advice on a field delta or unprovable equivalence, then coalesce it deterministically with config/model/effort/rules/AGENTS/marketplace causes. Never persist/emit restart state through read-only readiness, claim what a live session loaded, or stop/restart a live Codex session. | 2 | planned | Two consecutive unchanged plugin syncs produce no runtime restart line; each observable version/digest/hook/enabled/source-identity change produces one actionable line with byte-sorted fields; ambiguous refresh advises `equivalence_unproven`. Config/model/effort/rules/AGENTS/marketplace mutations still advise restart even when the runtime fingerprint is unchanged; simultaneous causes produce one deterministic consolidated line. No fake resolved commit is accepted. **Revert trigger:** plugin no-op still always advises, a non-plugin restart is suppressed, read-only output contains restart state, or a fingerprint delta is lost. |
| 4 | Add read-only Docks readiness to `status` and `plugins list` using the exact wire shapes above. Both consume the one injected inspector with resolved homes, externally verify stable native bytes before bounded doctor, and expose no loaded-session/restart claim. | 1-2 | planned | Command-layer/unit/golden tests cover ready/degraded/unavailable, exhaustive mapping, timeout/schema/external-digest failures, previous-ready continuation, no-cache stable inspection, and all root variables. Status adds top-level `docksRuntime`; plugin array adds `runtimeReadiness` only to session-relay. Existing fields and bare-array shape remain byte-compatible; neither readiness object contains `restartRequired`. |
| 5 | Update plugin/EngineNative docs and golden suites; run the deterministic isolated gate twice, then run authenticated A6 and A7 once each on the owner-approved real-runtime runner. Record exact producer/compatibility commits, receipt/helper/schema hashes, and both real-run artifacts in Sources/Notes; execute exact-range final-scope and negative matrices. | 1-4 | planned | A8's encoded deterministic two-pass gate is idempotent. A6 includes two unchanged syncs; A7 performs one exact catalog N→N+1 upgrade and proves old-session hooks remain viable. Real A6/A7 are each claimed once, never as twice-run gates; a rerun uses a fresh harness and retains both results. Exact `26ebb1c9e35986a3438bb00695832e98f256ad2e..IMPL_TIP` paths/modes equal the pre-implementation oracle, whose only docs entry is this lifecycle plan. No secrets, binaries, versions, releases, SoT prompt changes, or real-home files are committed. |

## Acceptance criteria

The block below is intentionally non-runnable while `status: blocked`: every
`<FINAL_...>` value and all four release-row `argv` arrays must be replaced by one
plan-only unblock commit using values independently read from immutable sources.
The helper/validator argv arrays are closed JSON arrays. They may contain only
literal arguments plus `{node}`, `{checkout}`, `{plugin_root}`, `{plan_path}`,
`{receipt_sha256}`, `{policy_sha256}`, `{planned_at_commit}`, and
`{reviewed_head}` tokens; substitution is argv-only, never shell evaluation.
A0 runs before the status change and again before Step 1 writes fixtures.

```bash
set -euo pipefail
DOCKS_RELEASE_CATALOG_JCS='<FINAL_DOCKS_RELEASE_CATALOG_JCS>'
CODEX_COMPATIBILITY_JCS='<FINAL_CODEX_COMPATIBILITY_JCS>'
PUBLIC_PLAN_CONTRACT_COMMIT='<FINAL_PUBLIC_PLAN_CONTRACT_COMMIT_40HEX>'
PUBLIC_PLAN_CONTRACT_BLOB='<FINAL_PUBLIC_PLAN_CONTRACT_BLOB_40HEX>'
PUBLIC_SCOPE_ORACLE_SHA256='<FINAL_PUBLIC_SCOPE_ORACLE_SHA256_64HEX>'
PUBLIC_PLAN_PATH='docs/plans/active/docks-integration-readiness.md'
PUBLIC_BASE='26ebb1c9e35986a3438bb00695832e98f256ad2e'

for value in "$DOCKS_RELEASE_CATALOG_JCS" "$CODEX_COMPATIBILITY_JCS" \
  "$PUBLIC_PLAN_CONTRACT_COMMIT" "$PUBLIC_PLAN_CONTRACT_BLOB" \
  "$PUBLIC_SCOPE_ORACLE_SHA256"
do
  case "$value" in *'<FINAL_'*) printf 'blocked placeholder: %s\n' "$value" >&2; exit 96;; esac
done
[[ "$PUBLIC_PLAN_CONTRACT_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$PUBLIC_PLAN_CONTRACT_BLOB" =~ ^[0-9a-f]{40}$ ]]
[[ "$PUBLIC_SCOPE_ORACLE_SHA256" =~ ^[0-9a-f]{64}$ ]]
test "$(jq -cS . <<<"$DOCKS_RELEASE_CATALOG_JCS")" = "$DOCKS_RELEASE_CATALOG_JCS"
test "$(jq -cS . <<<"$CODEX_COMPATIBILITY_JCS")" = "$CODEX_COMPATIBILITY_JCS"

sha256_text() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }
sha256_file() { sha256sum "$1" | cut -d' ' -f1; }

resolve_remote_tag_commit() {
  local repo="$1" tag="$2" encoded ref_json object_type object_sha hops=0
  encoded="$(jq -rn --arg value "$tag" '$value|@uri')"
  ref_json="$(gh api "repos/$repo/git/ref/tags/$encoded")"
  object_type="$(jq -er '.object.type' <<<"$ref_json")"
  object_sha="$(jq -er '.object.sha | select(test("^[0-9a-f]{40}$"))' <<<"$ref_json")"
  while [[ "$object_type" = tag ]]; do
    hops=$((hops + 1)); test "$hops" -le 8
    ref_json="$(gh api "repos/$repo/git/tags/$object_sha")"
    object_type="$(jq -er '.object.type' <<<"$ref_json")"
    object_sha="$(jq -er '.object.sha | select(test("^[0-9a-f]{40}$"))' <<<"$ref_json")"
  done
  test "$object_type" = commit
  printf '%s\n' "$object_sha"
}

run_pinned_argv() {
  local tree="$1" contract="$2" selector="$3" node_path arg i
  local -a argv=()
  node_path="$(command -v node)"; test -n "$node_path"
  jq -e "$selector.argv | type == \"array\" and length > 1 and all(.[]; type == \"string\" and (contains(\"\\n\")|not))" <<<"$contract" >/dev/null
  test "$(sha256_text "$(jq -cS "$selector.argv" <<<"$contract")")" = "$(jq -er "$selector.argvSha256" <<<"$contract")"
  mapfile -t argv < <(jq -er "$selector.argv[]" <<<"$contract")
  for i in "${!argv[@]}"; do
    arg="${argv[$i]}"
    arg="${arg//\{node\}/$node_path}"
    arg="${arg//\{checkout\}/$tree}"
    arg="${arg//\{plugin_root\}/$tree/plugins/session-relay}"
    arg="${arg//\{plan_path\}/$tree/$(jq -er .producerPlanPath <<<"$contract")}"
    arg="${arg//\{receipt_sha256\}/$(jq -er .completion.receiptSha256 <<<"$contract")}"
    arg="${arg//\{policy_sha256\}/$(jq -er .completion.policySha256 <<<"$contract")}"
    arg="${arg//\{planned_at_commit\}/$(jq -er .plannedAtCommit <<<"$contract")}"
    arg="${arg//\{reviewed_head\}/$(jq -er .reviewedHead <<<"$contract")}"
    case "$arg" in *'{'*|*'}'*) return 97;; esac
    argv[$i]="$arg"
  done
  test "${argv[0]}" = "$node_path"
  test "${argv[1]}" = "$tree/$(jq -er "$selector.path" <<<"$contract")"
  "${argv[@]}"
}

tmp="$(mktemp -d /tmp/docks-kit-a0.XXXXXX)"
trap 'rm -rf -- "$tmp"' EXIT
jq -e 'keys == ["releases","schema","upgrade"] and .schema == 1 and (.releases|length) == 2 and .releases[0].role == "N" and .releases[1].role == "N+1" and .releases[0].pluginVersion == .upgrade.fromPluginVersion and .releases[1].pluginVersion == .upgrade.toPluginVersion and .releases[0].pluginVersion != .releases[1].pluginVersion' <<<"$DOCKS_RELEASE_CATALOG_JCS" >/dev/null
jq -e '(.upgrade | keys == ["fromPluginVersion","toPluginVersion"]) and all(.releases[]; ((keys|sort) == (["completion","completionValidator","doctorSchema","hashHelper","hookDefinitionsSha256","installerSchema","plannedAtCommit","pluginPayloadSha256","pluginVersion","producerCommit","producerPlanBlob","producerPlanPath","releaseFixture","releaseTag","reviewedHead","reviewedPlanCommit","role","targets"]|sort)) and (.completion|keys == ["S","X","outcome","policySha256","receiptSha256"]) and all([.installerSchema,.doctorSchema,.releaseFixture][]; keys == ["blob","path","sha256"]) and all([.hashHelper,.completionValidator][]; keys == ["argv","argvSha256","blob","path","sha256"]))' <<<"$DOCKS_RELEASE_CATALOG_JCS" >/dev/null

for role in N N+1; do
  contract="$(jq -cS --arg role "$role" '.releases[] | select(.role == $role)' <<<"$DOCKS_RELEASE_CATALOG_JCS")"
  test -n "$contract"
  release_commit="$(jq -er '.producerCommit | select(test("^[0-9a-f]{40}$"))' <<<"$contract")"
  release_tag="$(jq -er .releaseTag <<<"$contract")"
  test "$(resolve_remote_tag_commit DocksDocks/docks "$release_tag")" = "$release_commit"
  release_json="$(gh release view "$release_tag" --repo DocksDocks/docks --json tagName,isDraft,isPrerelease)"
  test "$(jq -r .tagName <<<"$release_json")" = "$release_tag"
  test "$(jq -r .isDraft <<<"$release_json")" = false
  test "$(jq -r .isPrerelease <<<"$release_json")" = false

  tree="$tmp/docks-${role//+/_}"
  git clone --no-local --no-checkout /home/vagrant/projects/docks "$tree" >/dev/null
  git -C "$tree" checkout --detach "$release_commit" >/dev/null
  test "$(git -C "$tree" rev-parse HEAD)" = "$release_commit"
  reviewed_commit="$(jq -er '.reviewedPlanCommit | select(test("^[0-9a-f]{40}$"))' <<<"$contract")"
  plan_path="$(jq -er .producerPlanPath <<<"$contract")"
  test "$(git -C "$tree" show "$reviewed_commit:$plan_path" | git hash-object --stdin)" = "$(jq -er .producerPlanBlob <<<"$contract")"
  git -C "$tree" show "$reviewed_commit:$plan_path" | rg -q '^review_status: passed$'
  git -C "$tree" merge-base --is-ancestor "$reviewed_commit" "$release_commit"

  for selector in .installerSchema .doctorSchema .releaseFixture .hashHelper .completionValidator; do
    path="$(jq -er "$selector.path" <<<"$contract")"
    test -n "$path"; case "/$path/" in */../*|*/./*) exit 97;; esac; [[ "$path" != /* ]]
    test "$(git -C "$tree" rev-parse "HEAD:$path")" = "$(jq -er "$selector.blob" <<<"$contract")"
    test "$(sha256_file "$tree/$path")" = "$(jq -er "$selector.sha256" <<<"$contract")"
  done

  digest_json="$(run_pinned_argv "$tree" "$contract" .hashHelper)"
  jq -e 'keys == ["hookDefinitionsSha256","pluginPayloadSha256","schema"] and .schema == 1' <<<"$digest_json" >/dev/null
  test "$(jq -r .pluginPayloadSha256 <<<"$digest_json")" = "$(jq -r .pluginPayloadSha256 <<<"$contract")"
  test "$(jq -r .hookDefinitionsSha256 <<<"$digest_json")" = "$(jq -r .hookDefinitionsSha256 <<<"$contract")"

  completion_json="$(run_pinned_argv "$tree" "$contract" .completionValidator)"
  jq -e 'keys == ["S","X","outcome","plannedAtCommit","policySha256","receiptSha256","reviewStatus","reviewedHead","schema","valid"] and .schema == 1 and .valid == true and .reviewStatus == "passed"' <<<"$completion_json" >/dev/null
  test "$(jq -r .receiptSha256 <<<"$completion_json")" = "$(jq -r .completion.receiptSha256 <<<"$contract")"
  test "$(jq -r .policySha256 <<<"$completion_json")" = "$(jq -r .completion.policySha256 <<<"$contract")"
  test "$(jq -r .plannedAtCommit <<<"$completion_json")" = "$(jq -r .plannedAtCommit <<<"$contract")"
  test "$(jq -r .reviewedHead <<<"$completion_json")" = "$(jq -r .reviewedHead <<<"$contract")"
  test "$(jq -cS '{outcome,X,S}' <<<"$completion_json")" = "$(jq -cS '.completion | {outcome,X,S}' <<<"$contract")"
  jq -e 'if .outcome == "dual" then .X == "passed" and .S == "passed" elif .outcome == "single" then ([.X,.S]|sort) == ["passed","platform_denied"] else false end' <<<"$completion_json" >/dev/null

  jq -e '.targets | length == 4 and map(.target) == (map(.target)|sort) and (map(.target)|unique|length) == 4 and all(.[]; keys == ["binarySha256","target"] and (.binarySha256|test("^[0-9a-f]{64}$")))' <<<"$contract" >/dev/null
  while IFS=$'\t' read -r name expected; do
    test "$(git -C "$tree" ls-tree HEAD "plugins/session-relay/bin/$name" | cut -d' ' -f1)" = 100755
    test "$(sha256_file "$tree/plugins/session-relay/bin/$name")" = "$expected"
  done < <(jq -r '.targets[] | [.target,.binarySha256] | @tsv' <<<"$contract")
  plugin_version="$(jq -er .pluginVersion <<<"$contract")"
  test "$(jq -r .version "$tree/plugins/session-relay/.codex-plugin/plugin.json")" = "$plugin_version"
  test "$(jq -r .version "$tree/plugins/session-relay/.claude-plugin/plugin.json")" = "$plugin_version"
done

jq -e 'keys == ["codexVersion","pluginListFixture","pluginListSchema","pluginStoreSourceBlob","pluginStoreSourcePath","pluginStoreSourceSha256","schema","upstreamCommit","upstreamRepo","upstreamTag"] and .schema == 1 and .upstreamRepo == "openai/codex"' <<<"$CODEX_COMPATIBILITY_JCS" >/dev/null
codex_tag="$(jq -er .upstreamTag <<<"$CODEX_COMPATIBILITY_JCS")"
codex_commit="$(jq -er '.upstreamCommit | select(test("^[0-9a-f]{40}$"))' <<<"$CODEX_COMPATIBILITY_JCS")"
test "$(resolve_remote_tag_commit openai/codex "$codex_tag")" = "$codex_commit"
test "$(codex --version)" = "$(jq -er .codexVersion <<<"$CODEX_COMPATIBILITY_JCS")"
for selector in .pluginListSchema .pluginListFixture; do
  test "$(sha256_text "$(jq -cS "$selector.value" <<<"$CODEX_COMPATIBILITY_JCS")")" = "$(jq -er "$selector.sha256" <<<"$CODEX_COMPATIBILITY_JCS")"
done
git clone --filter=blob:none --no-checkout https://github.com/openai/codex.git "$tmp/codex" >/dev/null
git -C "$tmp/codex" checkout --detach "$codex_commit" >/dev/null
store_path="$(jq -er .pluginStoreSourcePath <<<"$CODEX_COMPATIBILITY_JCS")"
test "$(git -C "$tmp/codex" rev-parse "HEAD:$store_path")" = "$(jq -er .pluginStoreSourceBlob <<<"$CODEX_COMPATIBILITY_JCS")"
test "$(sha256_file "$tmp/codex/$store_path")" = "$(jq -er .pluginStoreSourceSha256 <<<"$CODEX_COMPATIBILITY_JCS")"

test "$(git rev-parse "$PUBLIC_PLAN_CONTRACT_COMMIT:$PUBLIC_PLAN_PATH")" = "$PUBLIC_PLAN_CONTRACT_BLOB"
oracle="$(git show "$PUBLIC_PLAN_CONTRACT_COMMIT:$PUBLIC_PLAN_PATH" | sed -n 's/^Final-scope-oracle-jcs: //p')"
test "$(printf '%s\n' "$oracle" | wc -l)" -eq 1
test "$(jq -cS . <<<"$oracle")" = "$oracle"
test "$(sha256_text "$oracle")" = "$PUBLIC_SCOPE_ORACLE_SHA256"
test "$(jq -r .base <<<"$oracle")" = "$PUBLIC_BASE"
```

| ID | Command | Expected result |
|---|---|---|
| A0 | After the unblock commit replaces every placeholder/argv, run the exact preflight above. | Exit 0 before unblock/start and again before Step 1. Remote Git refs peel to exact N, N+1, and Codex commits; both owner-approved releases are non-draft/non-prerelease; detached-tree binaries/schemas/helpers/validators match; helpers recompute payload/hook digests; canonical completion receipts validate under the exact eligible outcome; Codex compatibility and the pre-implementation public scope oracle match. Any placeholder, local-tag-only proof, ineligible receipt, mutable/mismatched source, or nonzero helper/validator result keeps the plan blocked. |
| A1 | `bun run test:unit -- docksRuntime engine-di status plugins` | Exit 0. Absolute/disjoint resolved roots, one shared Effect/EngineNative executor ledger (including `cli/src/engine.ts`), exact N/N+1 selection, direct verified-native installer argv, verified stable-before-doctor, exhaustive outcome mapping, pinned Codex adapter, previous-ready preservation, distinct/coalesced restart channels, and exact wire shapes pass. No editable booleans, dispatcher execution, self-reported checksum, singular-current fallback, or implementation-authored fixture substitutes for the catalog/oracle. |
| A2 | `bun run golden:dryrun` | Exit 0. Codex dry-run names externally verified plugin bootstrap + stable-runtime verify/doctor without writing and preserves current output contracts except reviewed additions. |
| A3 | `bun run golden:mutation` | Exit 0. First changed plugin sync records the JCS-defined fingerprint delta and one sync-only runtime line; a second unchanged plugin sync is a no-op with no runtime line. Config/model/effort/rules/AGENTS/marketplace changes still produce their existing restart advice; simultaneous generic+runtime causes coalesce deterministically. Ambiguous runtime comparison advises `equivalence_unproven`. Status/plugins output contains no restart field. |
| A4 | `bun cli/test/docks-runtime-integration.ts --case dry-run-isolation` | Exit 0; harness-owned absolute HOME/CODEX_HOME/XDG_DATA_HOME contain every access; relative/`..`/symlink-alias/equal/ancestor-overlap roots refuse before mutation; no real path changes occur; preview is explicit; cleanup/child reap runs in `finally`. |
| A5 | `bun cli/test/docks-runtime-integration.ts --case wire-compatibility` | Exit 0; status preserves its top-level object and adds `docksRuntime`; plugins remains a bare array and only session-relay adds `runtimeReadiness`; neither object contains `restartRequired`; every producer/public outcome maps exactly; human projections and typed failures match goldens. |
| A6 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case idempotent-sync --catalog cli/test/fixtures/docks-runtime/docks-release-catalog.json` | Run once on the owner-approved authenticated runner. Exit 0; isolated fixture installs/verifies catalog N+1, then a second unchanged sync is byte/idempotency clean and omits runtime advice. Missing auth is failure, never skip/pass. A rerun uses a fresh harness and retains both artifacts; it does not erase the first result. |
| A7 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case live-upgrade --from N --to N+1 --catalog cli/test/fixtures/docks-runtime/docks-release-catalog.json` | Run once after A6 on the owner-approved runner. Exit 0; harness authenticates catalog N, starts N session, syncs exact catalog N+1 and prunes N cache, then old UserPromptSubmit and new/subagent SessionStart exit 0 through stable runtime. Reported N/N+1 binary/payload/hook digests and doctor schema match their selected rows. Integration evidence only; Docks A6b remains the standalone gate. |
| A8 | `for pass in 1 2; do bun run typecheck && bun run test:unit && bun run golden:dryrun && bun run golden:mutation && bun cli/test/docks-runtime-integration.ts --case dry-run-isolation && bun cli/test/docks-runtime-integration.ts --case wire-compatibility && bun cli/test/docks-runtime-integration.ts --case final-scope --base 26ebb1c9e35986a3438bb00695832e98f256ad2e --tip "$IMPL_TIP" --allow cli/test/fixtures/docks-runtime/final-scope-allowlist.json --allow-sha "$PUBLIC_SCOPE_ORACLE_SHA256" && bun cli/test/docks-runtime-integration.ts --case final-scope-negative-matrix --base 26ebb1c9e35986a3438bb00695832e98f256ad2e --tip "$IMPL_TIP"; done` | Both deterministic isolated passes exit 0, including typecheck, unit, goldens, path/root/wire integration, exact scope, and negative scope. A6/A7 are intentionally external single-run gates and are not called twice; their separate artifacts are required. |
| A9 | `test "$(git rev-parse HEAD)" = "$IMPL_TIP" && test -z "$(git status --porcelain)" && oracle="$(git show "$PUBLIC_PLAN_CONTRACT_COMMIT:$PUBLIC_PLAN_PATH" | sed -n 's/^Final-scope-oracle-jcs: //p')" && test "$(printf '%s' "$oracle" | sha256sum | cut -d' ' -f1)" = "$PUBLIC_SCOPE_ORACLE_SHA256" && test "$(jq -cS . cli/test/fixtures/docks-runtime/final-scope-allowlist.json)" = "$oracle" && git diff --check 26ebb1c9e35986a3438bb00695832e98f256ad2e.."$IMPL_TIP" && bun cli/test/docks-runtime-integration.ts --case final-scope --base 26ebb1c9e35986a3438bb00695832e98f256ad2e --tip "$IMPL_TIP" --allow cli/test/fixtures/docks-runtime/final-scope-allowlist.json --allow-sha "$PUBLIC_SCOPE_ORACLE_SHA256" && bun cli/test/docks-runtime-integration.ts --case final-scope-negative-matrix --base 26ebb1c9e35986a3438bb00695832e98f256ad2e --tip "$IMPL_TIP"` | Exit 0 at the exact clean tip. The copied fixture is byte-equivalent JCS to the reviewed plan oracle before it is used; the implementation cannot expand it. Full-range path+mode set equals that oracle. Disposable negatives independently reject SoT/generated prompt, plugin binary, package/version, tag/release-like file, credential, deployed-home path, rename, deletion, staged/unstaged/untracked, and an unexpected otherwise-plausible `cli/src/**` path. |

## Out of scope

- Lifecycle admission, first-turn gating, hook trust/health semantics, cgroup/process proof, quiescence, supervisor/watchdog, and stable binary installation internals remain in Docks/session-relay.
- docks-kit does not write Codex internal hook trust, pass `--dangerously-bypass-hook-trust`, copy a binary from a plugin cache, reconstruct a missing stable runtime from an unverified path, or promote doctor output to lifecycle proof.
- No automatic live-session stop/restart, plugin release, version bump, tag, push, or marketplace mutation beyond the existing normal `sync` workflow.
- No persisted/read-only restart state, loaded-session inference, or claim that a later process can observe which hook bytes an existing Codex session loaded.
- No review-policy or global prompt deployment; `standing-cross-company-review-consent` owns that independent change.
- No unrelated plugin-list redesign or broad status framework.

## Self-review

Score: **96/100 Draft-4 author candidate; fresh independent candidate review pending** · trajectory **78/100 NOT READY at `26ebb1c9e35986a3438bb00695832e98f256ad2e` (plan blob `049b269cbaec29e78eebb3eb4429bb73e526ae11`) → 95 author candidate → 82/100 NOT READY at `3b523d82c0c6bac158ffecdea4b4966c88acaf99` (plan blob `460c5c0e00b2dfbf6eca5e68c891e1728886fdc9`) → 96 remodeled candidate**.

**Immutable Draft-2 review (2026-07-12):** The independent reviewer scored the exact commit/blob above **78/100 NOT READY**. The ownership split was sound, but implementation could still false-green because read-only output carried an unknowable `restartRequired`; native-cache and stable pre-exec provenance were incomplete; producer errors lacked a closed public mapping; A9 could pass without proving the exact implementation range and complete file/mode scope; the producer dependency was prose-only; payload/hook digests were not externally anchored; `cli/src/engine.ts` was absent from the DI path; plugin source change detection depended on an unobservable resolved commit; root normalization was under-specified; A8 claimed two passes without encoding them; and the stale Docks Draft-15 candidate was still presented too close to an implementation pin.

**Immutable Draft-3 re-review (2026-07-12):** A fresh reviewer read exact commit `3b523d82c0c6bac158ffecdea4b4966c88acaf99`, blob `460c5c0e00b2dfbf6eca5e68c891e1728886fdc9`, current CLI source, live Codex 0.144.1 output, and cited primary documentation, then scored **82/100 NOT READY**. Eight reproduced findings remained: (1) one release contract could not authenticate previous N during N→N+1; (2) A0 trusted a local tag rather than peeling the remote Git ref; (3) payload/hook hashes were fixture assertions rather than recomputed bytes; (4) `review_status: passed` did not prove canonical eligible completion evidence; (5) A9's implementation-authored allowlist could authorize itself; (6) Codex version/source/schema/layout selection was deferred to the implementer; (7) runtime advice could suppress existing non-plugin restart causes; and (8) the claimed full two-pass gate omitted typecheck and deterministic integrations.

**Draft-4 repair:** The external contract is now an exact two-row N/N+1 catalog selected only by stable-record version+target. A0 recursively peels GitHub tag objects through the Git refs API, checks release class, creates detached isolated producer trees, verifies helper/validator blobs and argv hashes, recomputes payload/hook digests, validates completion receipts and only the two explicit eligible outcomes, and pins/verifies an exact Codex tag/source/schema/layout contract. The reviewed plan itself contains the exact path+mode JCS oracle and A9 verifies the copied fixture against its pre-implementation hash before use. Fingerprint sub-hashes have exact JCS/UTF-8 definitions. Runtime advice is distinct from config/model/effort/rules/AGENTS/marketplace restart causes with deterministic coalescing. A8 repeats typecheck, full unit/goldens, isolated root/wire cases, and both scope matrices; authenticated A6/A7 are honestly one run each, with A6 internally exercising two syncs and A7 one exact N→N+1 upgrade. All release/catalog/compatibility values remain failing placeholders while blocked; the unblock commit must supply immutable literals and receive another fresh review before start.

- **Standalone executability:** 18/22 — the blocked handoff names every required literal, contract, command token, source check, and STOP condition; the four remaining points are intentionally withheld until the real released helper/validator argv and immutable N/N+1/Codex values replace the placeholders.
- **Actionability:** 16/16 — every implementation step has an executable done condition and revert trigger; final producer/compatibility literals are explicit blocked placeholders rather than guessed inputs.
- **Dependency order:** 12/12 — the producer review/release gate is a status-level prerequisite, A0 repeats it, and no consumer work may begin before it passes.
- **Evidence re-verify:** 10/10 — current implementation surfaces, live Codex schema, official cache contract, and both immutable review commit/blob pairs are recorded; future producer facts are marked unknown rather than guessed.
- **Goal coverage:** 12/12 — externally verified deployment, readiness, and change-sensitive sync advice each have an owning step and gate without transferring plugin safety.
- **Checkable acceptance:** 12/12 — A0, deterministic double-run A8, independent-oracle A9, and explicit one-run authenticated A6/A7 each name exact commands and expected results.
- **Failure mode:** 10/10 — unknown schema/exit, provenance mismatch, timeout, path race, stale cache, prior-runtime preservation, root escape, and secret leakage are closed failures or STOP conditions.
- **Assumption to question:** 6/6 — final producer/release/compatibility coordinates are a named external blocker with exact placeholder slots, source checks, and STOP behavior; implementation cannot choose them.

Cold-handoff result: a fresh agent can determine why work cannot start, which exact literals/argv contracts are missing, and how to authenticate both releases, Codex compatibility, completion evidence, and public scope without inventing values. This plan remains `blocked` until a plan-only transition replaces every placeholder, A0 passes, and a fresh independent plan-review marks that exact input READY before `start`. Starting against Draft-15, an unreviewed Draft-16/Draft-17 candidate, a singular release, or an implementation-authored scope expansion is forbidden.

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
- [GitHub REST Git references and annotated tags](https://docs.github.com/en/rest/git/refs) — A0 resolves the remote `refs/tags/<tag>` object and recursively peels annotated tag objects; a local checkout tag and release `targetCommitish` are not exact remote authority.
- `/home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md` — the producer lifecycle plan is still under post-Draft-16 remodel. Historical Draft-15 candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` is research context only; no producer commit, blob, schema, or digest becomes a pin until the final plan passes dual review and the owner approves its release.
- `3b523d82c0c6bac158ffecdea4b4966c88acaf99:docs/plans/active/docks-integration-readiness.md` (blob `460c5c0e00b2dfbf6eca5e68c891e1728886fdc9`) — immutable 82/100 NOT READY Draft-3 input whose eight reproduced findings drive this remodel.

## Review

*(filled by plan-review on completion)*
