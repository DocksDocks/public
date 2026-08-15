/**
 * Host-to-artifact map (Platform seam in DESIGN.md). Every launcher, installer,
 * build script, and release workflow selects a compiled binary from this one
 * table; cli/test/unit/hostTargets.test.ts parses those scripts and fails when
 * any of them drifts from it.
 *
 * Membership here is the support matrix: adding a row is how a host becomes
 * supported, and `requireSupportedHost` in cli/src/engine.ts admits exactly the
 * platform/arch pairs this table names.
 */
import { platformName, type PlatformName } from "./index"

export type TargetId =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-x64"
  | "darwin-arm64"
  | "windows-x64"
  | "windows-arm64"

export type TargetArch = "x64" | "arm64"

export interface HostTarget {
  readonly id: TargetId
  readonly platform: PlatformName
  readonly arch: TargetArch
  /** `bun build --compile --target=` value. */
  readonly bunTarget: string
  /** Compiled binary file name, including the Windows `.exe` suffix. */
  readonly artifact: string
  /** `uname -s`-`uname -m` keys the Bash launcher matches; empty on Windows. */
  readonly unameKeys: ReadonlyArray<string>
  /**
   * `$env:PROCESSOR_ARCHITECTURE` values the PowerShell launcher matches; empty
   * off Windows. Windows PowerShell 5.1 runs emulated on ARM64 and reports
   * `AMD64` there, so a launcher must read `PROCESSOR_ARCHITEW6432` first.
   */
  readonly processorArchitectures: ReadonlyArray<string>
}

const target = (
  id: TargetId,
  platform: PlatformName,
  arch: TargetArch,
  unameKeys: ReadonlyArray<string>,
  processorArchitectures: ReadonlyArray<string>
): HostTarget => ({
  id,
  platform,
  arch,
  bunTarget: `bun-${id}`,
  artifact: platform === "windows" ? `docks-kit-${id}.exe` : `docks-kit-${id}`,
  unameKeys,
  processorArchitectures
})

export const HOST_TARGETS: ReadonlyArray<HostTarget> = [
  target("linux-x64", "linux", "x64", ["Linux-x86_64"], []),
  target("linux-arm64", "linux", "arm64", ["Linux-aarch64"], []),
  target("darwin-x64", "darwin", "x64", ["Darwin-x86_64"], []),
  target("darwin-arm64", "darwin", "arm64", ["Darwin-arm64"], []),
  target("windows-x64", "windows", "x64", [], ["AMD64"]),
  target("windows-arm64", "windows", "arm64", [], ["ARM64"])
]

export function targetFor(platform: PlatformName, arch: string): HostTarget | undefined {
  return HOST_TARGETS.find((t) => t.platform === platform && t.arch === arch)
}

/** Resolve the artifact for a raw Node platform/arch pair. */
export function targetForHost(platform: NodeJS.Platform, arch: string): HostTarget | undefined {
  return targetFor(platformName(platform), arch)
}
