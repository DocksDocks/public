---
name: toolchain-context
description: "Use when modifying cli/src/commands/toolchain.ts MANAGED; cli/src/engine-native/modes.ts modeToolchain; cli/src/engine-native/toolchain.ts report/version probes, latestUpstream, or outdatedReport; cli/src/engine-native/bun.ts bunBootstrap; SoT/toolchain.json tool entries or their upstream field; or the Bun managed install. Not for settings merge or plugin reconcile."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/commands/toolchain.ts
      lines: "1-55"
    - path: cli/src/engine-native/modes.ts
      lines: "1-171"
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-292"
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-276"
    - path: cli/src/engine-native/bun.ts
      lines: "1-96"
    - path: SoT/toolchain.json
      lines: "1-38"
  updated: "2026-09-24"
---

# Toolchain Verified-Version Floors

`SoT/toolchain.json` is data; `toolchain.ts` owns manifest field reads, version
probes and comparison, and the doctor report table. `bun.ts bunBootstrap` owns
the only managed install.

<constraint>
Version probes must be best-effort. A missing command or parse miss must return
an empty or unknown version and let `report` continue; it must not abort
unrelated sync work.
</constraint>

<constraint>
Never add a kit-driven floating install. Every kit-driven install uses the exact
`verified` version from `SoT/toolchain.json`.
</constraint>

## Manifest Split

- `kind: check/managed/pin` describes whether the tool is reported, managed by
  the kit, or a manifest pin for an `npx`-style tool. jq and curl are check-only;
  consumers decide whether a missing optional tool prevents an operation.
- `policy: present` installs a missing managed tool and leaves a present tool
  alone.
- `floor` is the minimum kit-tested version shown in the doctor table.
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

## Outdated Report

`toolchain outdated [--refresh]` runs `modeToolchain` -> `outdatedReport`.

1. `outdatedReport` selects the manifest tools that have both `verified` and
   `upstream`, in manifest order.
2. `latestUpstream` reads the kit cache (`kitDb.ts readCache`, key
   `upstream:<tool>`, 24 h) unless `--refresh` is set.
3. On a miss it reads npm `latest`, the newest npm release on `upstream.line`
   (packument with the install-v1 `Accept` header), or the GitHub latest
   release tag with `tagPrefix` stripped. `GITHUB_TOKEN` or `GH_TOKEN` adds a
   bearer token.
4. Only a successful lookup is cached. A failure prints
   `lookup failed: <reason>` in the row, and the command still exits 0.
5. `isNewer(latest, verified)` sets `newer`; anything else is `current`.

The report never installs anything and never edits a pin. `toolchain check`
stays offline.

## Managed Install

| Tool | Owner | Notes |
|------|-------|-------|
| `bun` | `bun.ts bunBootstrap, per-engine-run memo` | Resolves an existing Bun or download-then-runs the pinned installer once per EngineNative invocation; shared by the Claude runtime and direct `toolchain ensure bun`. |

## Gotchas

- `isNewer` is strictly newer; equal versions do not change report status.
- `report` is read-only. It never changes an installed version.
- `outdatedReport` uses the network. Tests inject `fetchImpl` (`FetchLike`)
  and never call the real registry or GitHub.
- Keep `cli/src/commands/toolchain.ts MANAGED` aligned with `modeToolchain`;
  Bun is the only supported managed tool.
- Installer downloads and npm global packages are supply-chain sensitive. Bump
  `verified` only after testing the release.
- The public CLI reaches Bun bootstrap only after the supported-host check.
  `bunBootstrap` checks curl only when Bun is actually missing.
