# Platform support

| Platform | CLI (docks-kit) | Sync engine | Notes |
|----------|-----------------|-------------|-------|
| Linux | native | native | Primary target |
| macOS | native (x64 + arm64) | native | bash 3.2-compatible engine |
| Windows | native (binary/Bun) | **experimental via Git Bash**; full hooks under WSL | See below |

## Windows detail

The managed tools all run natively on Windows: Claude Code (requires Git
Bash for its Bash tool — so Git Bash is present on any Windows machine
running Claude Code), Codex CLI (native PowerShell + Windows sandbox),
RTK (native binaries via GitHub releases/winget; since rtk 0.37.2 the
PreToolUse hook is a native binary command — `rtk hook claude`, no shell
or jq — so the hook works on Windows too. Only the kit's *auto-installer*
is Unix-only: install rtk natively, then sync).

The kit's bash engine runs under Git Bash on Windows. Status:
**experimental and not yet verified on a real Windows machine** — known
gates are in place (LF-pinned scripts, Windows launcher binary selection,
bwrap skip, symlink copy-fallback), with rough edges expected around
shell-rc env exports (`setx` translation pending).

## Roadmap

The engine is being ported to native TypeScript (EngineNative) behind the
CLI's `engine.ts` seam, gated by dry-run parity against the bash engine.
Once parity holds it becomes the default on all platforms — removing the
Git Bash requirement on Windows entirely. The bash engine is feature-frozen
(bug fixes only) and remains as the no-Bun escape hatch. Tracked in the
`windows-support` plan.
