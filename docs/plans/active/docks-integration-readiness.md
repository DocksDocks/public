---
title: Harden docks-kit session-relay readiness
goal: Proactively verify session-relay's stable runtime, report Docks readiness, and make restart advice change-sensitive without moving plugin safety into docks-kit.
status: planned
created: "2026-07-12T00:37:40-03:00"
updated: "2026-07-12T00:37:40-03:00"
started_at: null
assignee: null
tags: [docks-kit, codex, session-relay, review-policy, reliability]
affected_paths:
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/docksRuntime.ts
  - cli/src/engine-native/index.ts
  - cli/src/engine-native/services.ts
  - cli/src/engine-native/codexToml.ts
  - cli/src/engine-native/modes.ts
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

## Interface and ownership contract

Implementation starts only after the Docks lifecycle plan publishes an exact dual-reviewed READY commit and versioned interface fixture. Producer candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` defines the interface below but is still under immutable review and is **not yet an implementation pin**:

```text
Stable runtime root: ${XDG_DATA_HOME:-$HOME/.local/share}/docks/session-relay/runtime/
runtime.json: { schema, plugin_version, target, binary_sha256, plugin_payload_sha256, hook_definitions_sha256, installed_at }
installer: relay __install-stable --plugin-root <resolved-plugin-root> --json
doctor: relay doctor --json --capabilities
```

The JSON schemas, exit taxonomy, target/version comparison rules, and provenance fields are copied into fixtures from the final exact Docks contract commit and cited here before Step 1 starts. The external digest fixture pins every supported target binary digest from that reviewed Docks commit/release. `docksRuntime.ts` verifies a cache candidate against that external fixture **before** argv execution, then invokes the plugin-owned installer/doctor and validates their closed JSON. It does not implement semver replacement, stable-binary copying, fsync, generation switching, lifecycle transitions, or proof promotion. Internal `SHA256SUMS` is a corruption cross-check only; it is never the authenticity anchor.

Active-root discovery is a fail-closed compatibility adapter, not a durable Codex API. For each explicitly supported Codex release, a fixture pins `codex --version`, the upstream source/tag/commit, `plugin list --json` schema, and `PluginStore` root layout. The adapter reads the installed+enabled version, constructs exactly `$CODEX_HOME/plugins/cache/docks/session-relay/<version>`, canonicalizes it beneath that root, and validates regular-file manifest/id/version/digest fields. It never scans/selects among cache versions or parses `hooks/list` as an authoritative root. Unsupported Codex versions return typed `unavailable_codex_contract`; the standalone hook bootstrap remains available.

Runtime paths are resolved once and injected everywhere:

```text
home      = non-empty HOME, else platform homedir
codexHome = non-empty CODEX_HOME, else <home>/.codex
dataHome  = non-empty XDG_DATA_HOME, else <home>/.local/share
```

`Ctx` carries all three. Every Codex config/model/plugin/cache read/write uses `codexHome`; every child receives the same explicit `HOME`, `CODEX_HOME`, and `XDG_DATA_HOME`; stable relay paths use `dataHome`. `codexToml.ts`, `modes.ts`, `codexSync.ts`, and manifest/status readers must not fall back independently to `homedir()`. Tests isolate all three roots. If a platform cannot honor a non-default split consistently, fail before mutation rather than mixing homes.

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
    | null
  restartRequired: boolean
}
```

Every field is derived from the versioned plugin response or an explicit absence/typed failure. Free-form stderr is display evidence, never a reason classifier. `ready` requires valid stable-runtime provenance plus a schema-valid doctor result. Hook health may degrade readiness but never becomes managed-admission or quiescence authority. JSON output is stable and closed; human output is a projection.

Wire compatibility is exact:

- `status --json` preserves its existing top-level keys and adds exactly `docksRuntime: DocksRuntimeReadiness`.
- `plugins list --json` remains a bare array. Existing row fields remain unchanged; only the `session-relay@docks` row adds optional `runtimeReadiness: DocksRuntimeReadiness`. All other rows omit that key.
- Human status adds one compact `Docks runtime:` row; human plugin output adds a detail line only for session-relay. No wrapper object or heterogeneous standalone array element is permitted.

One shared `RuntimeInspector` accepts resolved paths plus a bounded `CommandExecutor`. `engine-native/services.ts` owns the injectable argv executor/deadline/environment implementation; `cli/src/services.ts` exposes the same capability as an Effect `Context.Tag` and live/test layers composed once by `main.ts`. EngineNative and Effect commands use that one implementation. `manifests.ts` takes explicit resolved paths; it never reads process-global homes for these rows.

## Environment and real-runtime harness

- Required baseline is recorded from the producer fixtures before start: Node/Bun versions from this repo, exact supported Codex release, final reviewed Docks commit/release, plugin target, and installer/doctor schema hashes. Any mismatch is failure or typed unsupported, never skip/pass.
- `cli/test/docks-runtime-integration.ts` owns `/tmp/docks-kit-runtime/<uuid>/{home,codex-home,data-home,artifacts}` mode 0700, exports all three root variables explicitly, records child PIDs, applies one monotonic 600-second deadline per case, kills/waits only its own children, and recursively cleans in `finally`. It refuses if any resolved path escapes the harness root.
- Authentication uses the exact safe adapter proven by the pinned Docks real-runtime harness: preflight the current CLI, then either forward the documented allowlisted secret variable by name or read-only reference the runtime-supported credential artifact at its defined location. Never copy credential bytes into the fixture/artifacts, log paths/values/hashes, or broad-copy real CODEX_HOME. If the pinned producer exposes no safe adapter for this runtime, real A6/A7 fail and the plan cannot complete.
- Raw transcripts and fixtures contain redacted argv, exit, schema result, stable/plugin digests, hook sentinels, and artifact hashes; no auth material. Human stderr is retained only as a redacted artifact and cannot classify state.
- Same-UID concurrent mutation between cache digest verification and process exec is outside the cooperative local trust boundary and is stated in status; pre/post lstat+digest mismatch fails. docks-kit makes no stronger atomic-exec/authenticity claim. The immutable reviewed/release digest—not the cache checksum—is the pre-exec trust anchor.

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Freeze the producer/compatibility contracts: pin final reviewed Docks commit/release, external per-target binary digests, installer+doctor schemas/exit taxonomy, exact supported Codex release/source, `plugin list --json`, and PluginStore layout in named fixtures. Add resolved runtime paths, shared `CommandExecutor`/`RuntimeInspector`, closed parsers, and Effect/EngineNative DI. | — | planned | Fixture hashes match reviewed primary source. Tests reject unsupported Codex versions, unknown fields, malformed digest/path/version, free-form classifier guessing, path escapes, self-reported-only authenticity, and contract drift. **STOP:** Docks producer is not READY/released with exact digests, or Codex root discovery cannot be pinned/validated; do not scan or execute cache bytes. |
| 2 | Integrate runtime ensure/doctor after successful `session-relay@docks` refresh. Resolve all paths from `Ctx`; read installed/enabled version; derive exactly the pinned cache root; canonicalize/lstat; verify the target binary against the external Docks digest fixture before executing it; then invoke plugin-owned installer and stable doctor by bounded argv with explicit HOME/CODEX_HOME/XDG_DATA_HOME. Preserve a valid old stable runtime when discovery/refresh/validation fails. | 1 | planned | Tests cover default/custom/empty roots, traversal/version injection, concurrent same-user mutation boundary, absent Codex/git/plugin, disabled relay, ready/no-op, upgrade, stale same-version cache, external digest mismatch despite matching internal checksum, malformed response, installer failure with valid old runtime, and target mismatch. **Revert:** any cache scan/copy, symlink follow, self-authentication, split home, or invalidation of working old runtime. |
| 3 | Make restart advice change-sensitive. Snapshot effective plugin identity plus stable runtime manifest before refresh, compare after ensure, and set `codexRestart` only when plugin/runtime/hook inputs changed or the result cannot prove equivalence. Never stop or restart a live Codex session automatically; warn that existing sessions may retain prior loaded hook definitions. | 2 | planned | Two consecutive unchanged syncs produce no restart line; a plugin commit/version/digest/hook-command change produces exactly one actionable restart line; ambiguous refresh safely advises restart. Golden mutation tests prove no silent automatic restart/kill. **Revert trigger:** idempotent sync still always says restart or a changed runtime suppresses it. |
| 4 | Add read-only Docks readiness to `status` and `plugins list` using the exact wire shapes above. Both consume one injected inspector with resolved homes; doctor is bounded and read-only. | 1-2 | planned | Command-layer/unit/golden tests cover ready/degraded/unavailable/timeout/schema mismatch and all three root variables. Status adds top-level `docksRuntime`; plugin array adds `runtimeReadiness` only to session-relay. Existing fields and bare-array shape remain byte-compatible. |
| 5 | Update plugin/EngineNative docs and golden suites; run full gates and targeted real CLI smoke in harness-owned HOME/CODEX_HOME/XDG_DATA_HOME. Record exact producer/compatibility commits and schema hashes in Sources/Notes. | 1-4 | planned | Acceptance passes twice for idempotency; isolated upgrade keeps old-session hooks viable through Docks stable runtime. No secrets, binaries, versions, releases, SoT prompt changes, or real-home files are committed. |

## Acceptance criteria

| ID | Command | Expected result |
|---|---|---|
| A1 | `bun run test:unit -- docksRuntime engine-di status plugins` | Exit 0. Resolved roots, shared Effect/EngineNative executor, external digest anchor, closed schemas, pinned root adapter, readiness, old-runtime preservation, restart delta, and exact wire shapes pass. No editable booleans/self-reported checksum substitute for producer JSON+external fixture. |
| A2 | `bun run golden:dryrun` | Exit 0. Codex dry-run names externally verified plugin bootstrap + stable-runtime verify/doctor without writing and preserves current output contracts except reviewed additions. |
| A3 | `bun run golden:mutation` | Exit 0. First changed sync records plugin/runtime delta and restart advice; a second unchanged sync is a no-op with no restart line. Status/plugins human+JSON output matches reviewed goldens. |
| A4 | `bun cli/test/docks-runtime-integration.ts --case dry-run-isolation` | Exit 0; harness-owned HOME/CODEX_HOME/XDG_DATA_HOME contain every access, no real path changes, preview is explicit, and cleanup/child reap runs in `finally`. |
| A5 | `bun cli/test/docks-runtime-integration.ts --case wire-compatibility` | Exit 0; status preserves top-level object and adds `docksRuntime`; plugins remains bare array and only session-relay adds `runtimeReadiness`; human projections and typed doctor failures match goldens. |
| A6 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case idempotent-sync` | Exit 0; isolated authenticated fixture first installs/verifies, second is byte/idempotency clean and omits restart advice. Existing sessions are not stopped. Missing auth is failure, never skip/pass. |
| A7 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case live-upgrade` | Exit 0; harness starts N session, syncs reviewed N+1 and prunes N cache, then old UserPromptSubmit and new/subagent SessionStart both exit 0 through stable runtime. Reported manifest/payload/hook digests and doctor schema match. Integration evidence only; Docks A6b is standalone gate. |
| A8 | `bun run test:unit && bun run golden:dryrun && bun run golden:mutation` | Exit 0 twice. No flaky state, stray child, real HOME/CODEX_HOME/XDG mutation, or golden drift remains. |
| A9 | `git diff --check && git status --short` | Diff is scoped to `affected_paths`; no plugin binary, SoT prompt, generated prompt payload, version bump, tag, release, credential, or deployed home mutation. |

## Out of scope

- Lifecycle admission, first-turn gating, hook trust/health semantics, cgroup/process proof, quiescence, supervisor/watchdog, and stable binary installation internals remain in Docks/session-relay.
- docks-kit does not write Codex internal hook trust, pass `--dangerously-bypass-hook-trust`, copy a binary from a plugin cache, reconstruct a missing stable runtime from an unverified path, or promote doctor output to lifecycle proof.
- No automatic live-session stop/restart, plugin release, version bump, tag, push, or marketplace mutation beyond the existing normal `sync` workflow.
- No review-policy or global prompt deployment; `standing-cross-company-review-consent` owns that independent change.
- No unrelated plugin-list redesign or broad status framework.

## Self-review

Score: **93/100 Draft-2 author candidate; immutable re-review pending** · trajectory **91 author → 70 NOT READY → 93 split/provenance/environment/wire/DI repair**.

**Draft-2 repair (2026-07-12):** The immutable reviewer confirmed the repo ownership split but found the consumer contract absent, cache authenticity circular, HOME/CODEX_HOME/XDG split-brain, JSON shapes ambiguous, Effect/EngineNative DI incomplete, affected paths incomplete, and real gates not cold-runnable. It also correctly rejected bundling standing consent with a future-blocked runtime program. Draft-2 adds the Docks producer candidate and required final pin, external per-target digest before cache execution, version-pinned fail-closed Codex compatibility adapter, injected three-root path contract, exact status/plugin wire shapes, shared command/inspector capability, named fixtures/paths, and a bounded isolated auth harness. Standing consent moves to its own plan.

- **Actionability:** 15/16 — each step has an executable done condition and revert trigger; exact Docks response schemas must be frozen before implementation.
- **Dependency order:** 11/12 — Docks must land its stable installer/doctor contract before Steps 1-4; the plan explicitly stops rather than inventing it.
- **Evidence re-verify:** 10/10 — every source below was opened in this session; current sync/restart/status behavior is quoted from the actual checkout.
- **Goal coverage:** 12/12 — proactive verified runtime integration, readiness, and restart UX each have an owning step and acceptance row.
- **Checkable acceptance:** 11/12 — most gates are executable; the real old-session hook upgrade requires authenticated integration infrastructure.
- **Failure mode:** 10/10 — old runtime preservation, no-copy boundary, typed degradation, no automatic restart, and host-policy limits are STOP/revert conditions.
- **Assumption to question:** 5/6 — no owner choice remains; final reviewed/released Docks and supported Codex contracts are hard prerequisites, not silently guessed.

Cold-handoff result: a fresh agent can execute only after inserting the reviewed Docks contract commit/schema fixture in Step 1. Until then this plan remains `planned`; starting implementation against guessed CLI fields is forbidden.

## Sources

- `cli/src/engine-native/codexSync.ts:433-480` — current sync reruns `codex plugin add` for every enabled plugin and marks restart after every successful refresh.
- `cli/src/engine-native/codexSync.ts:495-498` — current next-step policy prints restart whenever `codexRestart` is set (or verbose).
- `cli/src/commands/status.ts:45-78` — status currently gathers model drift, toolchain, plugin count, and skill count only.
- `cli/src/commands/plugins.ts:14-34` — plugin list currently exposes SoT tri-state plus Claude installed state only.
- `cli/src/manifests.ts:50-72` — current plugin view is derived from Claude installed state and has no Docks runtime readiness.
- `cli/src/engine-native/index.ts:31-75,89-119` — `Ctx.nextStepTriggers` owns restart output and EngineNative runs Codex sync before summaries/next steps.
- `AGENTS.md:35-41` — Codex plugin refresh and global SoT ownership are documented repo contracts.
- `AGENTS.md:47-56` — sync must be idempotent and global prompt files must remain concise action rules.
- `cli/src/engine-native/services.ts` and `cli/src/services.ts` — current injectable capability factory and Effect rim expose logger/dependency/platform only; runtime inspection/argv execution needs one shared added capability.
- `cli/src/engine-native/codexToml.ts:60-77` and `cli/src/engine-native/modes.ts:47-54` — current Codex config/model paths hard-code `ctx.home/.codex`, proving the CODEX_HOME split-brain to repair.
- `codex plugin list --json` on Codex 0.144.1 — current primary CLI output exposes installed/enabled `session-relay@docks` version and source identity, but no cache root path.
- [OpenAI Codex app-server plugin/hook inventory](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — `hooks/list` exposes command/source/hash health and `plugin/list` exposes plugin state; neither is an atomic lifecycle proof.
- [OpenAI Codex PluginStore cache behavior](https://github.com/openai/codex/issues/21138) — primary-source pointers identify `PluginStore::plugin_root()` as `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` and document same-version staleness risk, so discovery is version-pinned and every root is revalidated.
- [Official Codex Build Plugins](https://learn.chatgpt.com/docs/build-plugins) — current cache layout is documented but still consumed only through an exact-version compatibility fixture.
- `/home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md` candidate `48fec8b12296166be247eb6cee45c038f4d4dce5` — Draft-15 defines the producer installer/doctor/digest contract but is not an implementation pin until its immutable review is READY and a release digest is available.

## Review

*(filled by plan-review on completion)*
