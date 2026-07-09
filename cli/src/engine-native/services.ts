/**
 * Shared service factory — the single construction point for the engine's
 * injectable capabilities (Output Policy in DESIGN.md). The Effect rim wraps
 * these in Layers (cli/src/services.ts); the harness-private native-raw entry
 * and engineCapture's parent-side warn call it directly, so every execution
 * path shares one implementation.
 */
import { DEPENDENCIES, probe, warnMissing, type DependencySpec, type ProbeResult, type ToolId } from "./deps"
import { change, echo, err, verbose, warn, type Logger } from "./logger"
import { platformName, rawPlatform, type PlatformName } from "./os"

export interface DependencyManager {
  readonly spec: (id: ToolId) => DependencySpec
  readonly probe: (id: ToolId) => ProbeResult
  readonly warnMissing: (id: ToolId, context?: string) => void
}

export interface Platform {
  readonly raw: () => NodeJS.Platform
  readonly name: () => PlatformName
  readonly isWindows: () => boolean
  readonly isLinux: () => boolean
  readonly shellRcApplicable: () => boolean
}

export interface EngineServices {
  readonly logger: Logger
  readonly deps: DependencyManager
  readonly platform: Platform
}

/** Platform view over an injectable platform id (tests pass e.g. "win32"). */
export const makePlatform = (pf: NodeJS.Platform = rawPlatform()): Platform => ({
  raw: () => pf,
  name: () => platformName(pf),
  isWindows: () => pf === "win32",
  isLinux: () => pf === "linux",
  shellRcApplicable: () => pf !== "win32"
})

/** DependencyManager whose hints default to the INJECTED platform, not the host. */
export const makeDependencyManager = (platform: Platform): DependencyManager => ({
  spec: (id) => {
    const s = DEPENDENCIES[id]
    return { ...s, installHint: (pf = platform.raw()) => s.installHint(pf) }
  },
  probe,
  warnMissing: (id, context) => warnMissing(id, context, platform.raw())
})

export const makeEngineServices = (): EngineServices => {
  const platform = makePlatform()
  return {
    logger: { change, verbose, warn, err, echo },
    deps: makeDependencyManager(platform),
    platform
  }
}
