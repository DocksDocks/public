/**
 * Platform capability seam (Output Policy in DESIGN.md) — the only engine
 * module that reads process.platform besides exec.ts's PATH/executability
 * primitives. Per-tool package identifiers stay in deps.ts; symlink handling
 * stays try-then-fallback at the call site (capability-driven, not predicted).
 */

export type PlatformName = "linux" | "darwin" | "windows" | "unknown"

export function rawPlatform(): NodeJS.Platform {
  return process.platform
}

export function platformName(pf: NodeJS.Platform = rawPlatform()): PlatformName {
  return pf === "linux" ? "linux" : pf === "darwin" ? "darwin" : pf === "win32" ? "windows" : "unknown"
}

export function isWindows(): boolean {
  return rawPlatform() === "win32"
}

export function isLinux(): boolean {
  return rawPlatform() === "linux"
}

/** Shell-rc exports (bashrc/zshrc) apply only off Windows. */
export function shellRcApplicable(): boolean {
  return !isWindows()
}
