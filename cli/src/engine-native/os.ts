/**
 * Platform capability seam (Output Policy in DESIGN.md). Per-tool package
 * identifiers stay in deps.ts; symlink handling stays try-then-fallback at
 * the call site (capability-driven, not predicted).
 */

export type PlatformName = "linux" | "darwin" | "unknown"

export function rawPlatform(): NodeJS.Platform {
  return process.platform
}

export function platformName(pf: NodeJS.Platform = rawPlatform()): PlatformName {
  return pf === "linux" ? "linux" : pf === "darwin" ? "darwin" : "unknown"
}

export function isLinux(): boolean {
  return rawPlatform() === "linux"
}

/** Shell-rc exports apply only on supported hosts. */
export function shellRcApplicable(): boolean {
  return platformName() !== "unknown"
}
