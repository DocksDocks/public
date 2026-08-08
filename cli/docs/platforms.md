# Platform support

The supported host matrix is exact:

| Platform | Architecture | docks-kit binary | Sync engine |
|----------|--------------|------------------|-------------|
| Linux | x64 | `docks-kit-linux-x64` | EngineNative (TS) |
| Linux | arm64 | `docks-kit-linux-arm64` | EngineNative (TS) |
| macOS | x64 | `docks-kit-darwin-x64` | EngineNative (TS) |
| macOS | arm64 | `docks-kit-darwin-arm64` | EngineNative (TS) |

Windows and every other host are unsupported. The launcher fails before any
Bun-from-source fallback.

EngineNative is the only supported engine on supported hosts.
`DOCKS_KIT_ENGINE=bash` exits with the removed-engine message and points at the
`bash-engine-final` tag for historical recovery.
