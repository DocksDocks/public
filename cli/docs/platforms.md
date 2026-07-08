# Platform support

| Platform | CLI (docks-kit) | Sync engine | Notes |
|----------|-----------------|-------------|-------|
| Linux | native | EngineNative (TS) | Primary target |
| macOS | native (x64 + arm64) | EngineNative (TS) | bash escape hatch is 3.2-compatible |
| Windows | native (`.exe` / `bun add -g`, CI-verified) | EngineNative (TS) — no Git Bash | Real-machine verify pending |

EngineNative is the default engine on all platforms; `DOCKS_KIT_ENGINE=bash`
opts a machine back onto the feature-frozen bash engine (`lib/engine.sh`),
which also remains the zero-dependency escape hatch.

## Windows detail

Supported entrypoints (both verified in CI on windows-2025 under native
PowerShell — see `.github/workflows/windows-entrypoints.yml`):

- **`docks-kit-windows-x64.exe`** (release asset) — the no-toolchain path.
  No Bun, no Git Bash; the exe embeds the runtime and EngineNative runs
  in-process. It still needs the SoT it deploys: run from a kit checkout or
  set `DOCKS_KIT_HOME`.
- **`bun add -g docks-kit`** — bun creates a working Windows shim for the
  `#!/usr/bin/env bun` bin; outside a checkout kit-home resolves to the
  package's own bundled SoT.
- `install.sh` is **Unix-only** and not a Windows path.

The managed tools all run natively on Windows: Claude Code (requires Git
Bash for its own Bash tool — that requirement is Claude Code's, not this
kit's), Codex CLI (native PowerShell + Windows sandbox), RTK (native
binaries; since rtk 0.37.2 the PreToolUse hook is a native binary command —
`rtk hook claude`, no shell or jq. Only the kit's *auto-installer* is
Unix-only: install rtk natively, then sync).

CI coverage (all on the pinned windows-2025 label): EngineNative PowerShell
smoke with `HOME` unset — `%USERPROFILE%` path resolution, `.cmd` tool
spawning (npm), toolchain gate branches (`.github/workflows/parity.yml`,
`native-windows` job); the bash escape hatch under Git Bash
(`windows-smoke.yml`); the two entrypoints above
(`windows-entrypoints.yml`). Deployed hook/statusline assets stay bash by
design — Claude Code on Windows executes them through its own Git Bash.

**Status: supported, pending one manual gate** — a real-machine interactive
verify (Claude Code loads the synced `%USERPROFILE%\.claude`, the rtk hook
fires, hook/statusline commands run or are knowingly skipped) tracked as
step 9 of the `windows-support` plan.
