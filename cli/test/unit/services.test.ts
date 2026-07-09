import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { makeDependencyManager, makeEngineServices, makePlatform, type DependencyManager } from "../../src/engine-native/services"
import {
  DependencyManagerService,
  DependencyManagerTest,
  LoggerService,
  LoggerTest,
  PlatformService,
  PlatformTest
} from "../../src/services"

describe("engine service layers", () => {
  it("makeEngineServices gates verbose output through the run callback", () => {
    const lines: Array<string> = []
    let verbose = false
    const services = makeEngineServices({
      isVerbose: () => verbose,
      sinks: { stderr: (chunk) => void lines.push(chunk) }
    })
    services.logger.verbose("hidden")
    verbose = true
    services.logger.verbose("shown")
    expect(lines).toEqual(["\x1b[1;32m[ok]\x1b[0m shown\n"])
  })

  it("LoggerTest: verbose is gated by the injected sink, change is not", () => {
    const lines: Array<string> = []
    const layer = LoggerTest({ isVerbose: () => false, stderr: (chunk) => void lines.push(chunk) })
    const program = Effect.gen(function* () {
      const logger = yield* LoggerService
      logger.change("mutated")
      logger.verbose("no-op confirmation")
    })
    Effect.runSync(Effect.provide(program, layer))
    expect(lines).toEqual(["\x1b[1;32m[ok]\x1b[0m mutated\n"])
  })

  it("PlatformTest: win32 maps to windows and disables shell-rc handling", () => {
    const program = Effect.gen(function* () {
      const platform = yield* PlatformService
      return [platform.name(), platform.isWindows(), platform.isLinux(), platform.shellRcApplicable()]
    })
    expect(Effect.runSync(Effect.provide(program, PlatformTest("win32")))).toEqual(["windows", true, false, false])
    expect(Effect.runSync(Effect.provide(program, PlatformTest("linux")))).toEqual(["linux", false, true, true])
  })

  it("combined graph: an injected platform drives the manager's install hints", () => {
    const logger = makeEngineServices().logger
    const win = makeDependencyManager(makePlatform("win32"), logger)
    expect(win.spec("git").installHint()).toBe("winget install Git.Git (then open a new terminal)")
    const mac = makeDependencyManager(makePlatform("darwin"), logger)
    expect(mac.spec("git").installHint()).toBe("brew install git")
  })

  it("DependencyManagerTest: a stub manager drives missing-tool branching", () => {
    const warned: Array<string> = []
    const stub: DependencyManager = {
      spec: (id) => ({ id, requirement: "optional", versionArgs: ["--version"], installHint: () => `install ${id}` }),
      probe: () => ({ state: "missing" }),
      warnMissing: (id) => void warned.push(id)
    }
    const program = Effect.gen(function* () {
      const deps = yield* DependencyManagerService
      if (deps.probe("git").state === "missing") deps.warnMissing("git")
      return deps.spec("git").installHint()
    })
    expect(Effect.runSync(Effect.provide(program, DependencyManagerTest(stub)))).toBe("install git")
    expect(warned).toEqual(["git"])
  })
})
