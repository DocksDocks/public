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
RTK (native binaries via GitHub releases/winget — but its PreToolUse hook
mechanism is Unix-only; Windows falls back to RTK's `--claude-md` mode).

The kit's engine is bash+jq, so on Windows it runs under Git Bash. Status:
**experimental and not yet verified on a real Windows machine** — expect
rough edges around:

- shell-rc env exports (needs `setx` translation)
- the notification hook (ffplay)
- bubblewrap (Linux-only; skipped)

For full fidelity (RTK hooks included), run the kit inside WSL.

## Roadmap

A native TypeScript engine (module-by-module port inside the CLI, swappable
behind the same seam) would remove the Git Bash requirement entirely. Tracked
as a follow-up plan — not part of the current CLI.
