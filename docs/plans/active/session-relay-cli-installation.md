---
title: Install the verified Session Relay CLI
goal: Add a source-pinned, failure-preserving Session Relay CLI installer that runs before Claude or Codex plugin sync without requiring Rust.
status: ongoing
created: "2026-07-17T14:47:36-03:00"
updated: "2026-07-17T15:28:42-03:00"
started_at: "2026-07-17T15:28:42-03:00"
blocked_reason: null
blocked_since: null
assignee: null
review_author_company: openai
review_author_tool: codex
review_author_model: gpt-5.6-sol
review_author_effort: high
review_waivers: []
tags: [session-relay, toolchain, installer, supply-chain]
affected_paths:
  - AGENTS.md
  - README.md
  - SoT/toolchain.json
  - cli/docs/sync-layers.md
  - cli/docs/toolchain.md
  - cli/src/engine-native/claudeSync.ts
  - cli/src/engine-native/codexSync.ts
  - cli/src/engine-native/deps.ts
  - cli/src/engine-native/modes.ts
  - cli/src/engine-native/sessionRelayCli.ts
  - cli/src/generated/sotPayload.ts
  - cli/test/golden-dryrun.ts
  - cli/test/golden-mutation.ts
  - cli/test/goldens/dryrun.json
  - cli/test/goldens/mutation.json
  - cli/test/unit/pluginRefresh.test.ts
  - cli/test/unit/sessionRelayCli.test.ts
related_plans:
  - /home/vagrant/projects/docks/docs/plans/active/session-relay-prebuilt-cli-distribution.md
review_status: ready
planned_at_commit: 84beca95947aba7813881d277cb693bb018e2879
execution_base_commit: add253bbe43011e1cd8c1333f4e0b2c19883e4e9
---

# Install the verified Session Relay CLI

## Goal

Make `docks-kit` install or upgrade the precompiled Session Relay `0.12.0` CLI for the exact supported host before it installs or refreshes `session-relay@docks` for Claude or Codex. The installer must require the repository pin and downloaded checksum to agree, smoke-test a staged executable before atomic replacement, preserve any prior executable on every failure, and remain explicitly blocked from production use until the four Docks release digests exist. Users must not need Rust.

## Context & rationale

The reviewed producer contract in `/home/vagrant/projects/docks/docs/plans/active/session-relay-prebuilt-cli-distribution.md` removes embedded Rust executables from the plugin payload. This repository therefore becomes the installation boundary. Keeping the installer in a dedicated EngineNative module prevents network, checksum, and atomic-filesystem behavior from leaking into Claude/Codex plugin reconciliation, while small calls at the plugin boundaries make ordering explicit and testable.

The manifest is the source pin: repository `DocksDocks/docks`, tag and CLI version `session-relay--v0.12.0` / `0.12.0`, plugin identity/version `session-relay@docks` / `0.12.0`, install path `~/.local/bin/session-relay`, and four target digest fields. Until Docks publishes immutable assets, each digest is a deterministic fixture-only 64-hex value used solely on this validation branch. The plan finishes implementation in `blocked` state so no production release can treat fixture pins as live evidence.

`claudeSync.ts` must keep RTK first because `rtk init --global` can rewrite settings. Session Relay CLI ensure therefore runs later, immediately before the Claude plugin pass. `codexSync.ts` runs the same ensure immediately before its plugin pass. An `agents`-only sync never enters either tool-specific pipeline and must not ensure the CLI.

## Environment & how-to-run

- Repository: `/home/vagrant/projects/public`, branch `worker-session-relay-cli-installation`.
- Runtime: Bun from the repository launcher; Vitest `3.2.7`; TypeScript `7.0.2`; Node-compatible filesystem/crypto/child-process APIs already used by EngineNative.
- Install transport: existing `curl` dependency boundary, invoked with an argv array and no shell. The installer downloads only the pinned GitHub Release asset and its same-release `SHA256SUMS`.
- Focused red/green command: `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts`.
- Generated payload: `bun cli/scripts/generate-sot-payload.ts`, followed by `bun cli/scripts/generate-sot-payload.ts --check`.
- Focused golden checks: `GOLDEN_FILTER='sync (claude|codex|agents)|toolchain ensure session-relay' bun run golden:dryrun` and the same filter with `bun run golden:mutation`.
- Full pre-commit gate: `./sync.sh --ci`.
- Dry-run smoke: `./docks-kit sync claude codex --dry-run --skip-rtk` must show Session Relay CLI ensure before each tool's plugin pass; `./docks-kit sync agents --dry-run --skip-rtk` must not show it.

## Interfaces & data shapes

### Closed manifest entry

`SoT/toolchain.json` gains exactly one `tools["session-relay"]` object with these keys and no others:

```json
{
  "kind": "managed-release",
  "policy": "exact",
  "verified": "0.12.0",
  "repository": "DocksDocks/docks",
  "tag": "session-relay--v0.12.0",
  "plugin_id": "session-relay@docks",
  "plugin_version": "0.12.0",
  "install_path": "~/.local/bin/session-relay",
  "assets": {
    "x86_64-unknown-linux-musl": "<64 lowercase hex>",
    "aarch64-unknown-linux-musl": "<64 lowercase hex>",
    "x86_64-apple-darwin": "<64 lowercase hex>",
    "aarch64-apple-darwin": "<64 lowercase hex>"
  }
}
```

The asset filename is derived only as `session-relay-<target>`. The Release base URL is derived only from the pinned repository and tag. Manifest validation rejects missing, extra, mistyped, noncanonical, or mismatched repository/tag/plugin/version/path/target/digest data before any download or filesystem mutation.

### Deterministic host mapping

`sessionRelayTarget(platform, arch)` is a pure closed mapping:

| `platform` | `arch` | target |
|---|---|---|
| `linux` | `x64` | `x86_64-unknown-linux-musl` |
| `linux` | `arm64` | `aarch64-unknown-linux-musl` |
| `darwin` | `x64` | `x86_64-apple-darwin` |
| `darwin` | `arm64` | `aarch64-apple-darwin` |

Every other pair throws one actionable unsupported-platform error before probing or downloading.

### Install transaction

`ensureSessionRelayCli(ctx)` returns `0` only when the exact staged or already-installed command reports `session-relay 0.12.0`; otherwise it throws `ExitError(1)` after a clear error. Its ordered transaction is:

1. Validate the closed manifest and host target.
2. If the installed path exists and exact `--version` succeeds, return without network access.
3. Prepare the stable path's parent with recursive mode `0755`; fail closed if the resolved parent is not a directory. This may create `~/.local/bin` on a fresh home, but may not touch an existing stable executable.
4. Require `curl`, create only uniquely named sibling stage/checksum paths, and download the pinned asset plus `SHA256SUMS` from the same tag.
5. Parse exactly one checksum row for the selected asset and require its digest to equal the source pin.
6. SHA-256 the downloaded stage bytes and require equality with both the checksum row and source pin.
7. Apply mode `0755` to the stage and run the staged path with `--version`; require exact stdout `session-relay 0.12.0` after trimming one trailing line ending and exit 0.
8. Atomically rename the staged sibling over the stable path.
9. Remove only owned temporary siblings in all outcomes. No failure may alter the prior stable path bytes or mode.

Dry-run validates manifest/mapping and reports the intended pinned ensure without download, chmod, smoke, or rename. Direct `docks-kit toolchain ensure session-relay` uses the same function.

### TDD-red receipt

Before production edits, create a fresh directory with `mktemp -d /tmp/session-relay-public-red.XXXXXXXX`, immediately resolve it with `realpath`, require the canonical path prefix `/tmp/session-relay-public-red.`, set mode `0700`, record its literal `stat -Lc '%d:%i'` device/inode identity, and choose a receipt path that is a direct child. From the repository root, run exactly:

```bash
node /home/vagrant/projects/docks/scripts/capture-tdd-red.mjs \
  --repo "$PWD" \
  --repository-id DocksDocks/public \
  --pre-production-commit "$(git rev-parse HEAD)" \
  --test cli/test/unit/pluginRefresh.test.ts \
  --test cli/test/unit/sessionRelayCli.test.ts \
  --receipt-out "$PUBLIC_RED_PATH" \
  -- bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts
```

The helper must exit nonzero because the new behavior is absent while still producing one direct-child mode-`0600` canonical `TddRedReceiptV1`. Read the receipt once as opaque bytes, require exactly one nonempty line, compute SHA-256 over those exact JCS bytes excluding the trailing newline, and replace only the two fixed `Companion TDD-red receipt` Notes values through plan-manager/apply-patch. Verify the bytes following `Companion TDD-red receipt JCS bytes: ` are byte-identical to the receipt and that the recorded SHA-256 matches. Before removing anything, re-resolve the literal directory and receipt paths, revalidate prefix, direct-child ownership, mode, and the recorded device/inode; then remove only that receipt and directory. Store resolved literals in operation state rather than depending on cross-shell environment variables or traps. The capture runs once and is never regenerated after production edits.

## Steps

| # | Task | Files | Depends | Status | Done condition |
|---|---|---|---|---|---|
| 1 | Add complete installer and sync-order tests, commit them, run the one canonical failing baseline, and embed the exact red receipt before production edits. | `cli/test/unit/sessionRelayCli.test.ts`; `cli/test/unit/pluginRefresh.test.ts`; this plan Notes only through plan-manager | — | planned | The focused command fails only because the new installer/ordering contract is absent; the two test blobs, capture-helper blob, pre-production commit, command, nonzero exit, and stdout/stderr hashes are sealed in the fixed Notes receipt fields. |
| 2 | Add the closed Session Relay release pin and the minimal dedicated installer transaction. | `SoT/toolchain.json`; `cli/src/engine-native/sessionRelayCli.ts`; `cli/src/engine-native/deps.ts`; `cli/src/engine-native/modes.ts` | 1 | planned | Frozen tests pass for mapping, source/checksum equality, exact version, a fresh home with no `~/.local/bin`, offline/unsupported/checksum/version/chmod/download/rename failures, upgrade success, cleanup, and byte-for-byte preservation. |
| 3 | Place CLI ensure immediately before Session Relay plugin work for each supported tool sync, never for agents-only sync. | `cli/src/engine-native/claudeSync.ts`; `cli/src/engine-native/codexSync.ts`; frozen sync-order tests | 1, 2 | planned | Argv/event evidence proves ensure completes before any `session-relay@docks` install/add/update and failure prevents that plugin operation; agents-only output contains no ensure/download/smoke event. |
| 4 | Regenerate embedded SoT data and update user-facing ownership/order documentation. | `cli/src/generated/sotPayload.ts`; `AGENTS.md`; `README.md`; `cli/docs/toolchain.md`; `cli/docs/sync-layers.md` | 2, 3 | planned | Payload check passes; docs name the four targets, pinned install path, direct ensure command, plugin ordering, failure preservation, and pending-production-digest boundary. |
| 5 | Refresh intentional golden surfaces, run focused checks and full CI, commit a clean implementation identity `I`, persist `I` in Notes, push one create-once validation ref, then make a distinct plan-only blocked transition `B`. | `cli/test/golden-dryrun.ts`; `cli/test/golden-mutation.ts`; `cli/test/goldens/dryrun.json`; `cli/test/goldens/mutation.json`; this plan lifecycle fields | 2–4 | planned | All implementation gates pass at clean `I`; `refs/heads/preflight/session-relay-cli-0.9.0-<I first12>` resolves to exactly `I`; later `B` changes only this plan to `status: blocked` with exact `blocked_reason` and non-null `blocked_since`; no tag, Release, npm publication, or `main` update occurs. |

## Acceptance criteria

| ID | Command | Expected |
|---|---|---|
| A1 | `bun run test:unit -- cli/test/unit/sessionRelayCli.test.ts cli/test/unit/pluginRefresh.test.ts` | Exit 0; all installer and exact sync-order fixtures pass with the frozen assertions unchanged after the red capture. |
| A2 | `bun cli/scripts/generate-sot-payload.ts --check` | Exit 0; the embedded `SoT/toolchain.json` bytes and launcher pin are current. |
| A3 | `GOLDEN_FILTER='sync (claude|codex|agents)|toolchain ensure session-relay' bun run golden:dryrun` | Exit 0; dry-run output contains pinned Session Relay ensure for Claude/Codex before plugin work and none for agents-only. |
| A4 | `GOLDEN_FILTER='sync (claude|codex|agents)|toolchain ensure session-relay' bun run golden:mutation` | Exit 0; mutation snapshots and argv ordering match the reviewed contract. |
| A5 | `./docks-kit sync claude codex --dry-run --skip-rtk` | Exit 0; each selected tool reports the pinned CLI ensure before its plugin pass, with no mutation. |
| A6 | `./docks-kit sync agents --dry-run --skip-rtk` | Exit 0; output contains no Session Relay CLI ensure or plugin refresh. |
| A7 | `./sync.sh --ci` | Exit 0; full repository typecheck, unit, golden, generated-payload, prove-red, and related gates pass. |
| A8 | `base=$(sed -n 's/^execution_base_commit: //p' docs/plans/active/session-relay-cli-installation.md); test "${#base}" -eq 40; printf '%s' "$base" | grep -Eq '^[0-9a-f]{40}$'; git cat-file -e "$base^{commit}"; git diff --check "$base..HEAD"; test -z "$(git status --porcelain=v1)"` | Exit 0; the persisted execution base is a valid commit, the implementation range has no whitespace errors, and the final validation worktree is clean. |
| A9 | `impl=$(sed -n 's/^- Implementation commit: //p' docs/plans/active/session-relay-cli-installation.md); test "${#impl}" -eq 40; printf '%s' "$impl" \| grep -Eq '^[0-9a-f]{40}$'; git cat-file -e "$impl^{commit}"; git merge-base --is-ancestor "$impl" HEAD; git diff --exit-code "$impl..HEAD" -- . ':(exclude)docs/plans/active/session-relay-cli-installation.md'; ref="refs/heads/preflight/session-relay-cli-0.9.0-${impl:0:12}"; remote=$(git ls-remote --exit-code origin "$ref"); test "$(printf '%s\n' "$remote" \| awk '{print $1}')" = "$impl"` | Exit 0; the create-once immutable validation ref named from persisted clean implementation identity `I` resolves to exactly `I`, and every later commit through blocked-plan identity `B` changes only this companion plan. |
| A10 | `node -e 'const fs=require("node:fs"); const p=fs.readFileSync("docs/plans/active/session-relay-cli-installation.md","utf8"); const reason="Awaiting the four independently hashed `session-relay--v0.12.0` production asset digests."; if(!/^status: blocked$/m.test(p)||!p.includes(`blocked_reason: "${reason}"`)||!/^blocked_since: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z\|[+-]\d{2}:\d{2})"?$/m.test(p)||!p.includes(`- Blocked reason: ${reason}`)) process.exit(1)'` | Exit 0; the companion plan has the exact producer-required lifecycle fields and display note. |

## Out of scope / do-NOT-touch

- Do not publish/tag/release, push `main`, edit the Docks repository, or replace fixture pins with guessed production hashes.
- Do not compile Rust, add Rust to the public repository, or make plugin hooks/MCP startup download an executable.
- Do not add Windows support; unsupported hosts fail before mutation.
- Do not alter Session Relay message, lifecycle, wake, fanout, or app-server behavior.
- Do not refactor generic toolchain policy or plugin reconciliation beyond the exact new managed-release surface and ordering call.
- Do not let checksum download substitute for the repository source pin; both must match independently.

## Known gotchas

- RTK remains the first Claude sync step; moving Session Relay ensure ahead of RTK violates the existing settings-normalization contract.
- A default all-target sync enters both Claude and Codex pipelines. The second ensure must recognize the exact installed version and avoid a second download while still occurring before Codex plugin work.
- `--skip-plugin-refresh` still installs missing plugins. It does not skip the CLI ensure for Claude/Codex.
- The checksum manifest uses exactly `<64 lowercase hex><two spaces><asset-name>`; ambiguous, duplicate, extra-selected-name, uppercase, or malformed selected rows fail closed.
- The stage must be a sibling of the stable path so the final rename is same-filesystem atomic.
- Fixture-only digests are intentionally non-production. This branch/plan must remain blocked until all four live Docks assets are independently hashed and pinned in a separately reviewed change.

## Global constraints

- Treat plugin marketplaces, installers, and downloaded artifacts as untrusted until verified.
- No secrets in committed config.
- User installation must not require a Rust compiler.
- `docks-kit sync` must automatically install or update the verified precompiled Session Relay CLI for the current supported OS/architecture whenever it installs or refreshes the Session Relay plugin.
- Every downloaded executable must be checksummed before installation and smoke-tested before replacing an existing executable.
- The stable installed command is `session-relay`; the plugin-internal compatibility launcher remains `plugins/session-relay/bin/relay`.
- Supported release targets are exactly `x86_64-unknown-linux-musl`, `aarch64-unknown-linux-musl`, `x86_64-apple-darwin`, and `aarch64-apple-darwin`.
- Production blocked reason is exactly: `Awaiting the four independently hashed \`session-relay--v0.12.0\` production asset digests.`

## STOP conditions

- STOP before production edits if the focused test baseline does not fail for missing installer/order behavior or the canonical red receipt cannot be captured and embedded exactly once.
- STOP if the installer cannot prove source pin = checksum row = downloaded bytes before chmod/smoke/rename.
- STOP if any failure can truncate, unlink, chmod, or otherwise change a pre-existing stable executable.
- STOP if Claude/Codex plugin work can occur after an ensure failure or before ensure success.
- STOP if full CI requires changing a frozen test assertion rather than production behavior.
- STOP if the validation ref already exists at a different commit; never force or advance it.

## Cold-handoff checklist

- **File manifest:** Present; each step names exact repository paths and external plan ownership.
- **Environment & commands:** Present; Bun/Vitest/TypeScript, focused/golden/full commands, payload generation, and validation-ref grammar are exact.
- **Interface & data contracts:** Present; the closed manifest, four-target mapping, transaction order, exact version output, and TDD receipt are defined.
- **Executable acceptance:** Present; A1–A10 are ordered, nonempty commands with expected outcomes.
- **Out of scope:** Present; publication, Docks edits, Rust, Windows, runtime semantics, and broad refactors are prohibited.
- **Decision rationale:** Present; a dedicated installer module plus tool-owned ordering calls preserves existing ownership and makes failure atomicity testable.
- **Known gotchas:** Present; RTK ordering, default dual-tool sync, skip-refresh semantics, checksum grammar, sibling staging, and fixture-pin blocking are explicit.
- **Global constraints verbatim:** Present; security, Rust-free install, automatic sync, checksum/smoke, command names, supported targets, and exact blocked reason are copied into this plan.
- **No undefined terms / forward refs:** Present; every new function, schema, path, status, receipt, and command is defined here or cited from current repository code.

## Self-review

Score: 99/100 · four local passes · caught: made the fixture-pin/non-production boundary explicit, preserved RTK-first ordering, required the second default-sync ensure to avoid a duplicate download, and added replacement-failure preservation plus create-once ref gates. Independent sealed S review findings S1–S4 were reproduced and accepted: the plan now fixes the red-capture command and byte lifecycle, fresh-home parent creation, persisted execution-base resolution, and executable block/ref gates. Its S5 was reproduced and rejected because the reviewed producer contract explicitly requires `preflight/session-relay-cli-0.9.0-<first12>`; `0.9.0` is the validating Docks-kit release line, not the installed Session Relay version. A separate fresh-context recheck then caught and repaired the implementation-commit-versus-blocked-plan identity split, exact `blocked_reason`/`blocked_since` validation, and proof that every post-`I` change is plan-only. No known execution gap remains.

## Review

Review-receipt: {"input_sha256":"1889f3d99d63646b8757597e6016db9f4e224f588f13e580b8f24f8ca0287c8e","outcome":"single","phase":"draft","reviewed_commit":"1621c93610830a700ef8f8d3c948af8ad050a3a6","reviewer":{"company":"openai","mode":"fresh_subagent","verdict":"ready"},"schema":1}

Fresh-context independent review reproduced the sealed-review repairs, then accepted the plan at `1621c93610830a700ef8f8d3c948af8ad050a3a6` with no remaining concrete finding.

## Sources

- `cli/src/engine-native/claudeSync.ts` — `claudeSync` runs RTK first and currently reaches `syncPlugins` without a Session Relay CLI prerequisite.
- `cli/src/engine-native/codexSync.ts` — `codexSync` currently reaches `syncPlugins` after marketplace reconciliation with no CLI prerequisite.
- `cli/src/engine-native/toolchain.ts` — manifest access and direct managed-tool reporting/ensure patterns are centralized here.
- `cli/src/engine-native/modes.ts` — `modeToolchain` owns the closed direct-ensure allow-list.
- `cli/src/engine-native/deps.ts` — `ToolId` and executable presence/version/install-hint ownership live here.
- `cli/test/lib/harness.ts` — golden fixtures provide stub PATH executables, argv logs, disposable homes, and mutation snapshots.
- `SoT/toolchain.json` — current verified pins contain no Session Relay release asset schema.
- `cli/scripts/generate-sot-payload.ts` — `SoT/toolchain.json` is embedded in `cli/src/generated/sotPayload.ts` and has an explicit freshness check.
- `/home/vagrant/projects/docks/docs/plans/active/session-relay-prebuilt-cli-distribution.md` — reviewed producer contract fixes the version, repository/tag, four targets, install path, checksum/version/atomicity requirements, red-receipt handoff, and blocked-production boundary.

## Notes

- Repository ID: `DocksDocks/public`.
- Immutable validation ref: pending
- Implementation commit: pending
- Plan input SHA-256: 1889f3d99d63646b8757597e6016db9f4e224f588f13e580b8f24f8ca0287c8e
- Execution base commit: add253bbe43011e1cd8c1333f4e0b2c19883e4e9
- Review receipt SHA-256: 01114385d963fd04870465d64ecea948e81f0e5381b3ba4ad35513d09dab1246
- Companion TDD-red receipt JCS bytes: pending
- Companion TDD-red receipt SHA-256: pending
- Status: ongoing
- Blocked reason: pending

## Mistakes & Dead Ends

- N/A — no failed implementation attempt has occurred.
