/**
 * Host-to-artifact map (Platform seam in DESIGN.md). The two launchers select
 * a compiled binary from this table, `cli/build-binaries.sh` builds its
 * targets, and `release-cli.yml` publishes its artifacts. Each of these files
 * lists the names by hand, so `cli/test/unit/hostTargets.test.ts` checks them
 * against this table:
 * - the artifact names and `uname` keys in the Bash launcher `docks-kit`;
 * - the artifact name and processor architecture in `docks-kit.ps1`;
 * - the default `TARGETS` list of `cli/build-binaries.sh`;
 * - the four artifact names in `.github/workflows/release-cli.yml`.
 * The same test also checks two facts outside this table: the generated Bun
 * pin in the two launchers and the two installers equals the
 * `SoT/toolchain.json` pin, and `docks-kit.ps1` and `install.ps1` hold only
 * ASCII bytes.
 *
 * Membership here is the support matrix: adding a row is how a host becomes
 * supported, and `requireSupportedHost` in cli/src/engine.ts admits exactly the
 * platform/arch pairs this table names.
 */
import { platformName, type PlatformName } from "./index";

export type TargetId = "linux-x64" | "linux-arm64" | "darwin-arm64" | "windows-x64";

export type TargetArch = "x64" | "arm64";

export interface HostTarget {
  readonly id: TargetId;
  readonly platform: PlatformName;
  readonly arch: TargetArch;
  /** `bun build --compile --target=` value. */
  readonly bunTarget: string;
  /** Compiled binary file name, including the Windows `.exe` suffix. */
  readonly artifact: string;
  /** `uname -s`-`uname -m` keys the Bash launcher matches; empty on Windows. */
  readonly unameKeys: ReadonlyArray<string>;
  /**
   * `$env:PROCESSOR_ARCHITECTURE` values the PowerShell launcher matches; empty
   * off Windows. A 32-bit shell on an x64 host reports `x86` there, so a
   * launcher must read `PROCESSOR_ARCHITEW6432` first.
   */
  readonly processorArchitectures: ReadonlyArray<string>;
}

const target = (
  id: TargetId,
  platform: PlatformName,
  arch: TargetArch,
  unameKeys: ReadonlyArray<string>,
  processorArchitectures: ReadonlyArray<string>,
): HostTarget => ({
  id,
  platform,
  arch,
  bunTarget: `bun-${id}`,
  artifact: platform === "windows" ? `docks-kit-${id}.exe` : `docks-kit-${id}`,
  unameKeys,
  processorArchitectures,
});

export const HOST_TARGETS: ReadonlyArray<HostTarget> = [
  target("linux-x64", "linux", "x64", ["Linux-x86_64"], []),
  target("linux-arm64", "linux", "arm64", ["Linux-aarch64"], []),
  target("darwin-arm64", "darwin", "arm64", ["Darwin-arm64"], []),
  target("windows-x64", "windows", "x64", [], ["AMD64"]),
];

function targetFor(platform: PlatformName, arch: string): HostTarget | undefined {
  return HOST_TARGETS.find((t) => t.platform === platform && t.arch === arch);
}

/** Resolve the artifact for a raw Node platform/arch pair. */
export function targetForHost(platform: NodeJS.Platform, arch: string): HostTarget | undefined {
  return targetFor(platformName(platform), arch);
}
