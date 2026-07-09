---
name: toolchain-context
description: "Use when modifying cli/src/engine-native/toolchain.ts ensure, gate, installedVersion, latestVersion, report, isNewer, SoT/toolchain.json entries, verified-version gate semantics, --yes behavior, or the install callbacks in claudeSync.ts and skillsSync.ts for rtk, bun, agent-browser, and effect-solutions. Not for settings merge or plugin reconcile."
user-invocable: false
metadata:
  source_files:
    - path: cli/src/engine-native/toolchain.ts
      lines: "1-250"
    - path: cli/src/engine-native/claudeSync.ts
      lines: "60-125"
    - path: cli/src/engine-native/skillsSync.ts
      lines: "190-315"
    - path: SoT/toolchain.json
      lines: "1-80"
  updated: "2026-07-09"
---

# Toolchain Verified-Version Floors

`SoT/toolchain.json` is data; `toolchain.ts` owns version probes, comparison,
verified-pin gating, `ensure`, and the report table. Tool-specific callbacks
stay with the owning sync module.

<constraint>
Version probes must be best-effort. A missing command, parse miss, npm outage,
or registry error must return an empty/unknown version and let `ensure` decide;
it must not abort unrelated sync work.
</constraint>

<constraint>
RTK must remain the first Claude sync step. `rtk init --global` can rewrite
settings, so it has to run before `syncSettings` normalizes the file and before
deploy-time modifiers land.
</constraint>

<constraint>
Never add a kit-driven floating install. Installs are pinned to a verified
version or gated by the verified version in `SoT/toolchain.json`.
</constraint>

## Manifest Split

- `kind: required/check/managed/pin` describes whether the tool is required,
  reported, managed by sync, or a manifest pin for an `npx`-style tool.
- `policy: present` installs when missing and leaves present tools alone.
- `policy: track` compares installed against latest and upgrades only when
  latest is strictly newer and gate-approved.
- `verified` is the kit-reviewed ceiling used for supply-chain gating.
- `pinnable` allows a non-TTY install to fall back to the verified version when
  latest is above the reviewed ceiling or unavailable.

## Ensure Flow

`ensure(ctx, tool, installFn)`:

1. Read manifest fields.
2. If missing: probe latest, run `gate(..., "install", latest)`, then callback.
3. If present and policy is `present`: report no action.
4. If present and policy is `track`: probe latest; when strictly newer, gate and
   callback in upgrade mode.
5. Print `[dry-run]` and return before callback when `ctx.dryRun` is set.

The callback signature is `(mode, version)`. The version is the exact
gate-approved target, not an unchecked mutable latest.

## Gate Policy

| Context | Candidate above `verified` |
|---------|----------------------------|
| TTY | Prompt before proceeding. |
| `--yes` | Proceed with a warning. |
| Non-TTY install and pinnable | Install the pinned verified version. |
| Non-TTY upgrade | Stay on installed and warn. |

If latest is unknown, install falls back to verified when pinnable; upgrade does
nothing. Do not treat unknown latest as permission to install a floating latest.

## Managed Callbacks

| Tool | Callback owner | Notes |
|------|----------------|-------|
| `rtk` | `rtkInstall(ctx)` in `claudeSync.ts` | Downloads installer, pins `RTK_VERSION`, then runs `rtk init --global` when needed. |
| `agent-browser` | `agentBrowserInstall` in `skillsSync.ts` | npm global package; first install also downloads browser deps. |
| `effect-solutions` | `effectSolutionsInstall(ctx)` in `skillsSync.ts` | Uses Bun, then links Bun and CLI into `~/.local/bin`. |
| `bun` | `bunBootstrap(ctx)` in `skillsSync.ts` | Download-then-run installer pinned by manifest. |

## Gotchas

- `isNewer` is strictly newer; equal versions do not trigger an upgrade.
- Locally newer prereleases should not be downgraded by a lower latest probe.
- `modeToolchain` must stay in sync with CLI command options when adding a
  standalone managed tool.
- RTK, hooks, and npm global packages are supply-chain sensitive. Bump
  `verified` only after testing the release.
