/**
 * Golden platform pin (test-only; loaded via `bun --preload`).
 *
 * The engine reads the host OS through `os.ts rawPlatform`, and the manifest
 * gates at least one tool on it (`bwrap` is `os: linux`), so an unpinned run
 * records a different `toolchain check` table, a different probe argv order,
 * and different install hints on macOS than on Linux. The recorded snapshots
 * are shared by every host and by CI, so they must not depend on who recorded
 * them. Pinning here rather than behind an engine-read environment variable
 * keeps the override entirely inside the harness: production code has no way
 * to spoof the platform.
 */
Object.defineProperty(process, "platform", {
  value: "linux",
  configurable: true,
  enumerable: true,
  writable: false
})
