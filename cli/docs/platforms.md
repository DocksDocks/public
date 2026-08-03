# Platform support

The supported host matrix is exact:

| Platform | Architecture | docks-kit binary | Session Relay prebuilt | Sync engine |
|----------|--------------|------------------|------------------------|-------------|
| Linux | x64 | `docks-kit-linux-x64` | `x86_64-unknown-linux-musl` | EngineNative (TS) |
| Linux | arm64 | `docks-kit-linux-arm64` | `aarch64-unknown-linux-musl` | EngineNative (TS) |
| macOS | x64 | `docks-kit-darwin-x64` | — retired | EngineNative (TS) |
| macOS | arm64 | `docks-kit-darwin-arm64` | `aarch64-apple-darwin` | EngineNative (TS) |

x86_64-apple-darwin is no longer published as of Session Relay 0.16.0; macOS
support is aarch64-apple-darwin. Intel macOS keeps its docks-kit binary but
fails closed at the Session Relay install boundary.

Windows and every other host are unsupported. The launcher fails before any
Bun-from-source fallback, and Session Relay installation reports the unsupported
host without downloading an asset.

EngineNative is the only supported engine on supported hosts.
`DOCKS_KIT_ENGINE=bash` exits with the removed-engine message and points at the
`bash-engine-final` tag for historical recovery.
