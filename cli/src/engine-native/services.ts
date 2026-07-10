/**
 * Shared service factory — the single construction point for the engine's
 * injectable capabilities (Output Policy in DESIGN.md). The Effect rim wraps
 * these in Layers (cli/src/services.ts); the harness-private native-raw entry
 * and engineCapture's parent-side warn call it directly, so every execution
 * path shares one implementation.
 */
import {
  DEPENDENCIES,
  defaultProbeExecutor,
  resolveDependency,
  resolveLocation,
  resolvePath,
  resolveVersion,
  type DependencySpec,
  type DependencyLocation,
  type ProbeExecutor,
  type ProbeResult,
  type ToolId
} from "./deps"
import { makeLogger, type Logger, type LoggerSinks } from "./logger"
import { platformName, rawPlatform, type PlatformName } from "./os"

export type { Logger } from "./logger"

export interface DependencyManager {
  readonly spec: (id: ToolId) => DependencySpec
  readonly probe: (id: ToolId) => ProbeResult
  readonly version: (id: ToolId) => string
  readonly path: (id: ToolId) => string
  readonly location: (id: ToolId) => DependencyLocation
  readonly latest: (id: ToolId) => string
  readonly warnMissing: (id: ToolId, logger: Logger, context?: string) => void
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

export interface EngineServiceOptions {
  readonly sinks?: LoggerSinks
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
export const makeDependencyManager = (
  platform: Platform,
  exec: ProbeExecutor = defaultProbeExecutor
): DependencyManager => {
  const warned = new Set<ToolId>()
  return {
    spec: (id) => {
      const s = DEPENDENCIES[id]
      return { ...s, installHint: (pf = platform.raw()) => s.installHint(pf) }
    },
    probe: (id) => resolveDependency(DEPENDENCIES[id], exec, platform.raw()),
    version: (id) => resolveVersion(DEPENDENCIES[id], exec),
    path: (id) => resolvePath(DEPENDENCIES[id], exec, platform.raw()),
    location: (id) => resolveLocation(DEPENDENCIES[id], exec, platform.raw()),
    latest: (id) => DEPENDENCIES[id].latest?.(exec) ?? "",
    warnMissing: (id, logger, context) => {
      if (warned.has(id)) return
      warned.add(id)
      const suffix = context !== undefined && context !== "" ? ` (${context})` : ""
      logger.warn(`${id} not installed — ${DEPENDENCIES[id].installHint(platform.raw())}${suffix}`)
    }
  }
}

export const makeEngineServices = (opts?: EngineServiceOptions): EngineServices => {
  const platform = makePlatform()
  const logger = makeLogger(opts?.sinks ?? {})
  return {
    logger,
    deps: makeDependencyManager(platform),
    platform
  }
}
