---
name: toolchain-context
description: "Use when modifying cli/src/commands/toolchain.ts MANAGED; cli/src/engine-native/modes.ts modeToolchain; cli/src/engine-native/toolchain.ts report, installedVersion, belowFloor, latestUpstream, or outdatedReport; cli/src/engine-native/bun.ts bunBootstrap; SoT/toolchain.json tool entries, verified pins, or upstream fields; or the Bun managed install. Not for the pi-intercom install pass (use omp-sync-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/commands/toolchain.ts
      lines: "1-72"
    - path: cli/src/engine-native/modes.ts
      lines: "1-67"
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-253"
    - path: cli/src/engine-native/bun.ts
      lines: "1-120"
    - path: cli/src/engine-native/deps.ts
      lines: "1-224"
    - path: cli/src/engine-native/kitDb.ts
      lines: "1-240"
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-146"
    - path: cli/src/engine-native/sharedTypes.d.ts
      lines: "1-23"
    - path: SoT/toolchain.json
      lines: "1-18"
  updated: "2026-11-19"
---

# Toolchain Verified-Version Floors

`SoT/toolchain.json` is data; `toolchain.ts` owns manifest field reads, version
probes and comparison, and the doctor report table. `bun.ts bunBootstrap` owns
the only managed install.

Pointers here name concepts, not coordinates — if a path or symbol moved, trust the stated purpose and re-locate it (grep the symbol) before acting.

<constraint>
Version probes must be best-effort. A missing command or parse miss must return
an empty or unknown version and let `report` continue; it must not abort
unrelated sync work.
verify: `bunx vitest run cli/test/unit/toolchain.test.ts -t "unreadable version as unknown"`
(a stub `git --version` that exits 9 must report `unknown` and exit 0).
</constraint>

<constraint>
Never add a kit-driven floating install. Every kit-driven package install uses
the exact `verified` pin from `SoT/toolchain.json`. The exemptions and their
reasons live in that file's `$comment` (supply-chain stance). Any new install
surface, a new marketplace or plugin source included, needs a manifest pin first.
verify: `grep -rn '"verified")' cli/src/engine-native` lists every `verified`
read; each install site (`bun.ts`, `ompPlugins.ts`) must
appear there. `deps.ts` also appears: its Bun install hint prints the same pin
and installs nothing.
verify: `bunx vitest run cli/test/unit/deps.test.ts -t "pinned download-then-run Bun hint"`.
</constraint>

## Manifest Split

- `kind: check/managed/pin` describes whether the tool is reported, managed by
  the kit, or a version pin for a package installed through another tool
  (`omp install`, named by the required `via` field). `check` rows such as jq and curl are report-only;
  consumers decide whether a missing optional tool prevents an operation.
- `policy: present` installs a missing managed tool and leaves a present tool
  alone.
- `floor` is the minimum acceptable version. `report` marks an older install
  `below-floor`, and `toolchain.ts belowFloor` also gates the
  `toolchain ensure bun` warning. A row's `note` says where its floor comes
  from.
  verify: `bunx vitest run cli/test/unit/toolchain.test.ts -t "below the kit floor"`.
- `verified` is the kit-tested version shown in the doctor table and used for
  exact kit-driven installs.
- `pinnable` marks a managed tool whose bootstrap can install `verified` by
  exact tag.

## Report Flow

1. `field` reads manifest values without making the JSON shape part of callers.
2. `present` probes whether a tool exists.
3. `installedVersion` normalizes each tool's version output.
4. `isNewer` compares dotted versions for floor and verified status.
5. `report` prints the installed version against the manifest `floor` and
   `verified` columns.

verify: `bunx vitest run cli/test/unit/toolchain.test.ts -t "engine toolchain version report"`
(classifies `below-floor`, `above-verified`, and `unknown`).

## Outdated Report

`toolchain outdated [--refresh]` runs `modeToolchain` -> `outdatedReport`.

1. `outdatedReport` selects the manifest tools that have both `verified` and
   `upstream`, in manifest order.
2. `latestUpstream` reads the kit cache (`kitDb.ts readCache`, key
   `upstream:<tool>`, max age `toolchain.ts UPSTREAM_CACHE_MS`) unless
   `--refresh` is set.
3. On a miss it reads the npm registry `latest` version, or the GitHub latest
   release tag with `tagPrefix` stripped (a tag without that prefix fails the
   lookup). `GITHUB_TOKEN` or `GH_TOKEN` adds a bearer token.
4. Only a successful lookup is cached. A failure prints
   `lookup failed: <reason>` in the row, and the command still exits 0.
5. `isNewer(latest, verified)` sets `newer`; anything else is `current`.

The report never installs anything and never edits a pin. `toolchain check`
stays offline.
verify: `bunx vitest run cli/test/unit/toolchainOutdated.test.ts -t "toolchain outdated"`
(failed lookup still exits 0; a transport failure is retried, not cached).

## Managed Install

| Tool | Owner | Notes |
|------|-------|-------|
| `bun` | `bun.ts bunBootstrap, per-engine-run memo` | Resolves an existing Bun or download-then-runs the pinned installer once per EngineNative invocation; every caller shares the memoized result: `modes.ts modeToolchain` (`toolchain ensure bun`) and `ompSync.ts ompSync` (Bun bootstrap before the omp file deploys). |

verify: `grep -rn 'bunBootstrap(' cli/src/engine-native` lists the callers;
`bunx vitest run cli/test/unit/bun.test.ts -t "per-run Bun bootstrap"`.

## Gotchas

- `isNewer` is strictly newer; equal versions do not change report status.
- `report` is read-only. It never changes an installed version.
- `outdatedReport` uses the network. Tests inject `fetchImpl` (`FetchLike`)
  and never call the real registry or GitHub.
- Keep `cli/src/commands/toolchain.ts MANAGED` aligned with the `modeToolchain`
  ensure `switch`; both must name the same managed tools.
  The cue pins `MANAGED` to `bun` and proves that `ensure bun` reaches the
  `bun` case.
  verify: `bunx vitest run cli/test/unit/toolchain.test.ts -t "public toolchain ensure"`.
  Unprobed: no test fails on a new `modeToolchain` case that `MANAGED` lacks.
  Compare both lists by hand (verify: `grep -n "MANAGED = " cli/src/commands/toolchain.ts`
  and `grep -nE 'case "|managed tools only' cli/src/engine-native/modes.ts`).
- Installer downloads and pinned npm and `omp install` packages are supply-chain
  sensitive. Bump `verified` only after testing the release.
- The public CLI reaches Bun bootstrap only after the supported-host check
  (`engine.ts requireSupportedHost`).
  `bunBootstrap` checks curl only when Bun is actually missing.
