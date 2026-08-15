import { darwin } from "./darwin"
import { linux } from "./linux"
import type { HostOs, PlatformName } from "./types"
import { windows } from "./windows"

export * from "./types"

export function rawPlatform(): NodeJS.Platform {
  return process.platform
}

export function platformName(pf: NodeJS.Platform = rawPlatform()): PlatformName {
  switch (pf) {
    case "linux":
      return "linux"
    case "darwin":
      return "darwin"
    case "win32":
      return "windows"
    default:
      return "unknown"
  }
}

// An unrecognized host keeps Linux hint text, filters no toolchain row, and never claims bubblewrap — exactly today's behavior.
const unknown: HostOs = {
  ...linux,
  id: "unknown",
  toolchainOs: "",
  supportsBubblewrap: false
}

const HOSTS: Readonly<Record<PlatformName, HostOs>> = {
  linux,
  darwin,
  windows,
  unknown
}

export function hostOs(id: PlatformName = platformName()): HostOs {
  return HOSTS[id]
}
