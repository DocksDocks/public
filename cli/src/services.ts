/**
 * Effect rim over the engine's injectable capabilities: Context.Tags with
 * live layers built from the shared factory (engine-native/services.ts) plus
 * named test-layer constructors. Composed ONCE at main.ts — command code
 * accesses services via `yield*`, never by re-providing.
 */
import { Context, Layer } from "effect"
import { makeLogger, type Logger, type LoggerSinks } from "./engine-native/logger"
import { makeEngineServices, makePlatform, type DependencyManager, type Platform } from "./engine-native/services"

export class LoggerService extends Context.Tag("docks-kit/Logger")<LoggerService, Logger>() {}

export class DependencyManagerService extends Context.Tag("docks-kit/DependencyManager")<
  DependencyManagerService,
  DependencyManager
>() {}

export class PlatformService extends Context.Tag("docks-kit/Platform")<PlatformService, Platform>() {}

// EngineNative applies its run-scoped ctx.verbose gate before calling this
// live logger; keep the underlying sink unfiltered so --verbose can pass.
const live = makeEngineServices({ isVerbose: () => true })

export const LoggerLive = Layer.succeed(LoggerService, live.logger)
export const DependencyManagerLive = Layer.succeed(DependencyManagerService, live.deps)
export const PlatformLive = Layer.succeed(PlatformService, live.platform)
export const EngineServicesLive = Layer.mergeAll(LoggerLive, DependencyManagerLive, PlatformLive)

export const LoggerTest = (sinks: LoggerSinks): Layer.Layer<LoggerService> =>
  Layer.succeed(LoggerService, makeLogger(sinks))

export const PlatformTest = (pf: NodeJS.Platform): Layer.Layer<PlatformService> =>
  Layer.succeed(PlatformService, makePlatform(pf))

export const DependencyManagerTest = (impl: DependencyManager): Layer.Layer<DependencyManagerService> =>
  Layer.succeed(DependencyManagerService, impl)
