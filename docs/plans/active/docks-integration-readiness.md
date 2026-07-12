---
title: Harden docks-kit Docks integration readiness
goal: Proactively verify session-relay's stable runtime, report Docks readiness, improve restart advice, and deploy standing cross-company review consent without owning plugin safety.
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
  - cli/src/commands/status.ts
  - cli/src/commands/plugins.ts
  - cli/src/manifests.ts
  - cli/test/unit/engine-di.test.ts
  - cli/test/unit/docksRuntime.test.ts
  - cli/test/docks-runtime-integration.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/docs/plugins.md
  - cli/src/engine-native/DESIGN.md
  - SoT/.codex/AGENTS.md
  - SoT/.claude/CLAUDE.md
  - AGENTS.md
related_plans:
  - /home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md
  - /home/vagrant/projects/docks/docs/plans/active/cross-company-review-policy.md
review_status: null
---

# Harden docks-kit Docks integration readiness

## Goal

Make `docks-kit sync codex`, `docks-kit status`, and `docks-kit plugins list` reliable consumers of Docks' released session-relay runtime contract: proactively ensure/verify the plugin-owned stable relay executable without copying unverified cache bytes, expose machine-readable readiness, and print a Codex restart instruction only when effective deployed plugin/runtime inputs changed. Also deploy the owner's standing `cross_company_consent=always` preference through both runtime-global prompt SoTs so the Docks review policy does not ask again.

Success preserves the ownership boundary: **Docks/session-relay owns hook execution durability, binary provenance, lifecycle admission, and the versioned doctor schema; docks-kit invokes and reports that contract.** A standalone plugin install remains safe without docks-kit. docks-kit never reconstructs lifecycle state, writes Codex hook trust state, bypasses host policy, or treats a diagnostic result as worker-quiescence proof.

## Context

- **Owner decision (2026-07-12):** cross-company plan review is always authorized for this user's global configuration; Docks should not prompt for consent on each review. Host/platform denial remains authoritative and must be recorded, not bypassed.
- **Owner decision (2026-07-12):** session-relay safety belongs in Docks, while the personal `docks-kit` CLI should proactively deploy and verify it where that improves upgrades and status UX.
- A live Codex session produced repeated SessionStart/UserPromptSubmit exit 127 after `docks-kit sync codex`: the old process retained an absolute hook command into a pruned versioned plugin cache. Fresh hooks and a fresh Codex session were green. Docks Draft-13 therefore owns a monotonic stable runtime; this plan consumes it.
- Current `codexSync.ts::syncPlugins` reruns `codex plugin add` for every enabled plugin and sets `codexRestart` after every successful add, even when the effective plugin payload did not change. Current status/plugin views report counts and installation state but no session-relay runtime readiness.
- The Docks cross-company policy resolves `cross_company_consent` from already-loaded runtime-global guidance. The global SoT prompt surfaces are therefore the correct user-specific deployment home; this repo does not add a new env var or consumer config schema.

## Interface and ownership contract

Implementation starts only after the Docks plans publish an exact reviewed commit and versioned interface fixture for:

```text
Stable runtime root: ${XDG_DATA_HOME:-$HOME/.local/share}/docks/session-relay/runtime/
runtime.json: { schema, plugin_version, target, binary_sha256, installed_at }
installer: relay __install-stable --plugin-root <resolved-plugin-root> --json
doctor: relay doctor --json --capabilities
```

The JSON schemas, exit taxonomy, target/version comparison rules, and provenance fields are copied into a fixture from the exact Docks contract commit and cited in this plan before Step 1 moves to in-flight. `docksRuntime.ts` invokes the plugin-owned installer/doctor by argv, validates the closed JSON schema, and reports it; it does not implement semver replacement, hashing, copying, fsync, owner/mode/symlink policy, lifecycle transitions, or proof promotion itself.

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
  capabilities: Record<string, "available" | "unavailable" | "unknown">
  reasonCode: string | null
  restartRequired: boolean
}
```

Every field is derived from the versioned plugin response or an explicit absence/typed failure. Free-form stderr is display evidence, never a reason classifier. `ready` requires valid stable-runtime provenance plus a schema-valid doctor result. Hook health may degrade readiness but never becomes managed-admission or quiescence authority. JSON output is stable and closed; human output is a projection.

## Steps

| # | Task | Depends | Status | Done condition / revert trigger |
|---|---|---|---|---|
| 1 | Freeze the cross-repo consumer contract: record exact Docks and Codex source commits, stable-runtime/doctor schemas, installer exit taxonomy, `plugin list --json` fields, and the active-cache layout contract in checked-in fixtures. Add `docksRuntime.ts` with closed-schema parsing and injectable argv execution; no fallback binary copying. | — | planned | Fixture hashes match reviewed primary source. Parsers reject unknown schema/keys, malformed digests/paths, free-form failure guessing, and contract drift. **STOP:** Docks lacks the stable installer plus machine-readable doctor/effective-payload contract, or current Codex no longer provides a validated way to identify the active plugin root; remodel the producing contract instead of scanning arbitrary directories. |
| 2 | Integrate runtime ensure/doctor after successful `session-relay@docks` refresh. Read installed/enabled version from `codex plugin list --json`; derive the active cache root only through the version-pinned Codex `PluginStore` layout, then require exact canonical containment plus matching plugin id/version/manifest/SHA256SUMS before invoking the plugin installer by argv. Doctor the stable binary afterward. Preserve an already-valid stable runtime when discovery/refresh/validation fails; dry-run reports intended checks without mutation. | 1 | planned | Unit tests cover custom/empty `CODEX_HOME`, path traversal/version injection, absent Codex/git/plugin, disabled session-relay, ready/no-op, upgrade, lower-version race, stale same-version cache, malformed/tampered response, installer failure with valid old runtime, and platform mismatch. **Revert trigger:** docks-kit copies a cache binary, follows a symlink, scans/selects among versions, trusts a noncanonical escape, or can invalidate a working old runtime. |
| 3 | Make restart advice change-sensitive. Snapshot effective plugin identity plus stable runtime manifest before refresh, compare after ensure, and set `codexRestart` only when plugin/runtime/hook inputs changed or the result cannot prove equivalence. Never stop or restart a live Codex session automatically; warn that existing sessions may retain prior loaded hook definitions. | 2 | planned | Two consecutive unchanged syncs produce no restart line; a plugin commit/version/digest/hook-command change produces exactly one actionable restart line; ambiguous refresh safely advises restart. Golden mutation tests prove no silent automatic restart/kill. **Revert trigger:** idempotent sync still always says restart or a changed runtime suppresses it. |
| 4 | Add read-only Docks readiness to `status` and `plugins list`, including their `--json` forms. Use one shared gatherer that takes explicit HOME/CODEX_HOME and an injected bounded argv executor; status prints a compact overall row and plugins adds session-relay detail without changing existing fields for other plugins. Doctor never mutates. | 1-2 | planned | Unit/CLI tests cover ready/degraded/unavailable/timeout/schema mismatch and prove fixture HOME isolation. JSON is deterministic and contains the same `DocksRuntimeReadiness`; human output names a recovery command. Existing model/toolchain/plugin/skill fields remain compatible except intentional additions. |
| 5 | Deploy this exact concise action rule once in both `SoT/.codex/AGENTS.md` and `SoT/.claude/CLAUDE.md`: **“For Docks plan reviews, cross-company review is standing-authorized; do not ask for export consent. This never overrides a host or platform security denial.”** Document precedence in root `AGENTS.md`. Do not add timestamp, implementation history, env var, or duplicate policy machinery. | Docks cross-company policy contract | planned | Payload/unit and dry-run/mutation goldens prove both global files deploy the same rule. Prompt diagnostics show it loaded. It suppresses only Docks' consent question; platform denial remains degraded evidence. **Revert trigger:** it authorizes unrelated external actions, bypasses host denial, or materially duplicates the shipped skill. |
| 6 | Update plugin/EngineNative docs and the golden suites; run the full repo gates and targeted real CLI smoke in an isolated HOME. Record the exact Docks contract commit and runtime schema in Sources/Notes, not in user-global prompt prose. | 1-5 | planned | All acceptance commands pass twice for idempotency; isolated upgrade keeps old session hook execution viable through the Docks-owned stable runtime. No secrets, binaries, versions, releases, or deployed user-home files are committed. |

## Acceptance criteria

| ID | Command | Expected result |
|---|---|---|
| A1 | `bun run test:unit -- docksRuntime engine-di` | Exit 0. Closed-schema parser, argv boundary, plugin-root discovery, ready/degraded/unavailable results, old-runtime preservation, restart delta, and standing-consent payload tests pass. No test substitutes editable booleans for plugin JSON. |
| A2 | `bun run golden:dryrun` | Exit 0. Codex dry-run names plugin refresh + stable-runtime verify/doctor without writing, and deploys the global consent rule through the existing SoT copy/merge paths. |
| A3 | `bun run golden:mutation` | Exit 0. First changed sync records plugin/runtime delta and restart advice; a second unchanged sync is a no-op with no restart line. Status/plugins human+JSON output matches reviewed goldens. |
| A4 | `bun cli/test/docks-runtime-integration.ts --case dry-run-isolation` | Exit 0; a harness-owned temporary HOME/CODEX_HOME observes no mutation and prints an explicit stable-runtime readiness preview; cleanup runs in `finally`. |
| A5 | `./docks-kit status --json` and `./docks-kit plugins list --json` | Exit 0; both include the same schema-valid session-relay readiness object and preserve existing fields. Any bounded doctor failure produces typed degraded/unavailable output, not command failure or guessed proof. |
| A6 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case idempotent-sync` | Exit 0; isolated authenticated fixture first installs/verifies, second is byte/idempotency clean and omits restart advice. Existing sessions are not stopped. Missing auth is failure, never skip/pass. |
| A7 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case live-upgrade` | Exit 0; harness starts N session, syncs reviewed N+1 and prunes N cache, then old UserPromptSubmit and new/subagent SessionStart both exit 0 through stable runtime. Reported manifest/payload/hook digests and doctor schema match. Integration evidence only; Docks A6b is standalone gate. |
| A8 | `RELAY_REAL_RUNTIME_TEST=1 bun cli/test/docks-runtime-integration.ts --case global-consent` | Exit 0; isolated Codex/Claude global prompts contain exactly one concise standing consent rule. Docks resolver records `runtime_global`, asks no consent, and an injected host denial remains `platform_denied`. |
| A9 | `bun run test:unit && bun run golden:dryrun && bun run golden:mutation` | Exit 0 twice. No flaky state, stray child, modified real HOME, or golden drift remains. |
| A10 | `git diff --check && git status --short` | Diff is scoped to `affected_paths`; no plugin binary, version bump, tag, release, credential, or deployed home mutation. |

## Out of scope

- Lifecycle admission, first-turn gating, hook trust/health semantics, cgroup/process proof, quiescence, supervisor/watchdog, and stable binary installation internals remain in Docks/session-relay.
- docks-kit does not write Codex internal hook trust, pass `--dangerously-bypass-hook-trust`, copy a binary from a plugin cache, reconstruct a missing stable runtime from an unverified path, or promote doctor output to lifecycle proof.
- No automatic live-session stop/restart, plugin release, version bump, tag, push, or marketplace mutation beyond the existing normal `sync` workflow.
- No generic per-user review-policy config/env schema. This plan deploys this owner's standing preference through the existing global prompt SoTs; Docks owns the portable default/resolver.
- No unrelated plugin-list redesign or broad status framework.

## Self-review

Score: **91/100 author candidate; fresh-context review pending**.

- **Actionability:** 15/16 — each step has an executable done condition and revert trigger; exact Docks response schemas must be frozen before implementation.
- **Dependency order:** 11/12 — Docks must land its stable installer/doctor contract before Steps 1-4; the plan explicitly stops rather than inventing it.
- **Evidence re-verify:** 10/10 — every source below was opened in this session; current sync/restart/status behavior is quoted from the actual checkout.
- **Goal coverage:** 12/12 — proactive runtime integration, readiness, restart UX, and standing consent each have an owning step and acceptance row.
- **Checkable acceptance:** 11/12 — most gates are executable; the real old-session hook upgrade requires authenticated integration infrastructure.
- **Failure mode:** 10/10 — old runtime preservation, no-copy boundary, typed degradation, no automatic restart, and host-policy limits are STOP/revert conditions.
- **Assumption to question:** 5/6 — no owner choice remains; the only external dependency is the exact Docks schema and is a hard prerequisite, not silently guessed.

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
- `SoT/.claude/CLAUDE.md:104-111` — existing review/model guidance is the narrow insertion point for standing consent; it currently says the Claude second perspective is optional and routes cross-tool work through relay.
- `SoT/.codex/AGENTS.md:27-45` — Codex global harness heuristics are the narrow tool-agnostic insertion area; no current cross-company consent rule exists.
- `codex plugin list --json` on Codex 0.144.1 — current primary CLI output exposes installed/enabled `session-relay@docks` version and source identity, but no cache root path.
- [OpenAI Codex app-server plugin/hook inventory](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) — `hooks/list` exposes command/source/hash health and `plugin/list` exposes plugin state; neither is an atomic lifecycle proof.
- [OpenAI Codex PluginStore cache behavior](https://github.com/openai/codex/issues/21138) — primary-source pointers identify `PluginStore::plugin_root()` as `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>` and document same-version staleness risk, so discovery is version-pinned and every root is revalidated.
- `/home/vagrant/projects/docks/docs/plans/active/relay-worker-lifecycle-primitives.md` at reviewed Draft-13 commit — Docks owns app-server admission, stable runtime, hook health, and standalone upgrade safety.
- `/home/vagrant/projects/docks/docs/plans/active/cross-company-review-policy.md` at reviewed implementation commit — Docks resolves standing cross-company consent from runtime-global guidance while respecting platform denial.

## Review

*(filled by plan-review on completion)*
