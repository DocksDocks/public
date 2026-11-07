---
name: toolchain-context
description: "Use when modifying cli/src/commands/toolchain.ts MANAGED; cli/src/engine-native/modes.ts modeToolchain; cli/src/engine-native/toolchain.ts report, installedVersion, belowFloor, latestUpstream, or outdatedReport; cli/src/engine-native/claudeLsp.ts upgradeLspServers; cli/src/engine-native/bun.ts bunBootstrap; SoT/toolchain.json tool entries, verified pins, or upstream fields; or the Bun managed install. Not for settings merge (use settings-merge-context), plugin or LSP first-install passes (use plugin-bootstrap-context), or the skills-cli and pi-intercom install passes (use universal-skills-context or omp-sync-context)."
user-invocable: false
metadata:
  pattern: tool-wrapper
  source_files:
    - path: cli/src/commands/toolchain.ts
      lines: "1-80"
    - path: cli/src/engine-native/modes.ts
      lines: "1-178"
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-292"
    - path: cli/src/engine-native/claudeSync.ts
      lines: "1-89"
    - path: cli/src/engine-native/bun.ts
      lines: "1-120"
    - path: cli/src/engine-native/claudeLsp.ts
      lines: "1-301"
    - path: cli/src/engine-native/deps.ts
      lines: "1-309"
    - path: cli/src/engine-native/kitDb.ts
      lines: "1-256"
    - path: cli/src/engine-native/ompSync.ts
      lines: "1-137"
    - path: cli/src/engine-native/sharedTypes.d.ts
      lines: "1-65"
    - path: SoT/toolchain.json
      lines: "1-38"
  updated: "2026-11-07"
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
(a stub `claude --version` that exits 9 must report `unknown` and exit 0).
</constraint>

<constraint>
Never add a kit-driven floating install. Every kit-driven package install uses
the exact `verified` pin from `SoT/toolchain.json`. The exemptions and their
reasons live in that file's `$comment` (supply-chain stance). Any new install
surface, a new marketplace or plugin source included, needs a manifest pin first.
verify: `grep -rn '"verified")' cli/src/engine-native` lists every `verified`
read; each install site (`bun.ts`, `claudeLsp.ts`, `skillsInstall.ts`,
`ompPlugins.ts`) must appear there. `deps.ts` also appears: its Bun install
hint prints the same pin and installs nothing.
verify: `bunx vitest run cli/test/unit/deps.test.ts -t "pinned download-then-run Bun hint"`.
</constraint>

## Manifest Split

- `kind: check/managed/pin` describes whether the tool is reported, managed by
  the kit, or a version pin for a package installed through another tool (`npx`
  or `omp install`). `check` rows such as jq and curl are report-only;
  consumers decide whether a missing optional tool prevents an operation.
- `policy: present` installs a missing managed tool and leaves a present tool
  alone.
- `floor` is the minimum acceptable version. `report` marks an older install
  `below-floor`, and `toolchain.ts belowFloor` also gates the
  typescript-language-server install and the `toolchain ensure bun` warning.
  A row's `note` says where its floor comes from.
  verify: `bunx vitest run cli/test/unit/toolchain.test.ts -t "below the kit floor"`
  and `bunx vitest run cli/test/unit/lspNodeFloor.test.ts`.
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
3. On a miss it reads npm `latest`, the newest npm release on `upstream.line`
   (packument with the install-v1 `Accept` header), or the GitHub latest
   release tag with `tagPrefix` stripped. `GITHUB_TOKEN` or `GH_TOKEN` adds a
   bearer token.
4. Only a successful lookup is cached. A failure prints
   `lookup failed: <reason>` in the row, and the command still exits 0.
5. `isNewer(latest, verified)` sets `newer`; anything else is `current`.

The report never installs anything and never edits a pin. `toolchain check`
stays offline.
verify: `bunx vitest run cli/test/unit/toolchainOutdated.test.ts -t "toolchain outdated"`
(failed lookup still exits 0; a transport failure is retried, not cached).

## Upgrade

`toolchain upgrade [--dry-run]` runs `modeToolchain` -> `claudeLsp.ts
upgradeLspServers`.

1. `deps.ts npmGlobalVersions` (`npm ls -g`) decides which `claudeLsp.ts
   NPM_SERVERS` packages npm owns.
2. An npm-owned package below `verified` joins one exact
   `npm install -g <pkg>@<verified>` call. A package at or above its pin
   stays.
3. A PATH binary that npm does not own is skipped with a warning naming its
   path. A missing package stays missing: `sync claude` owns first installs.
4. `typescript-language-server` is skipped below the `node` floor, the same
   gate as the sync install.
5. A PATH copy outside `npm prefix -g` gets a warning; only the npm copy moves.
   The check follows links (`realpathSync`) and accepts only a file inside
   `<prefix>/lib/node_modules/<pkg>` (POSIX) or a shim in `<prefix>`
   (Windows). Any other file under the prefix, such as a distro binary under
   a `/usr` prefix, still warns.
6. A failed npm call exits 1. After the install, a fresh `npm ls -g` (new
   executor object, because the inventory is memoized) must show every pin,
   or the command exits 1.

verify: `bunx vitest run cli/test/unit/toolchainUpgrade.test.ts`
(includes "never downgrades a package above its pin" and "reports an error when
npm exits 0 but the pin did not land").

## Managed Install

| Tool | Owner | Notes |
|------|-------|-------|
| `bun` | `bun.ts bunBootstrap, per-engine-run memo` | Resolves an existing Bun or download-then-runs the pinned installer once per EngineNative invocation; every caller shares the memoized result, the Claude runtime (`claudeSync.ts claudeSync`, Bun bootstrap before the settings merge) included. |

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
- Installer downloads and npm global packages are supply-chain sensitive. Bump
  `verified` only after testing the release.
- The public CLI reaches Bun bootstrap only after the supported-host check
  (`engine.ts requireSupportedHost`).
  `bunBootstrap` checks curl only when Bun is actually missing.
