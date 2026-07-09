# Platform support

| Platform | CLI (docks-kit) | Sync engine | Notes |
|----------|-----------------|-------------|-------|
| Linux | native | EngineNative (TS) | Primary target |
| macOS | native (x64 + arm64) | EngineNative (TS) | Release binary or Bun source path |
| Windows | native (`.exe` / `bun add -g`, CI-verified) | EngineNative (TS) — no Git Bash | Real-machine verified 2026-07-09 |

EngineNative is the only supported engine on all platforms. `DOCKS_KIT_ENGINE=bash`
now exits with the removed-engine message and points at the `bash-engine-final`
tag for historical recovery.

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
`native-windows` job); the two entrypoints above (`windows-entrypoints.yml`).
Deployed hook/statusline assets stay shell scripts by design — Claude Code on
Windows executes them through its own Git Bash.

**Status: supported** — real-machine verified 2026-07-09 (Claude Code loads
the synced `%USERPROFILE%\.claude`; full sync, self-update, plugin passes,
universal skills, and agent-browser all green on native PowerShell). Needs
git on PATH for plugin marketplaces; rtk installs natively via its Windows
release (the kit's auto-install is Unix-only).
