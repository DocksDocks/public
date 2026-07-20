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
  it("makeEngineServices returns an unfiltered logger", () => {
    const lines: Array<string> = []
    const services = makeEngineServices({
      sinks: { stderr: (chunk) => void lines.push(chunk) }
    })
    services.logger.verbose("shown")
    expect(lines).toEqual(["\x1b[1;32m[ok]\x1b[0m shown\n"])
  })

  it("LoggerTest: exposes raw change and verbose methods", () => {
    const lines: Array<string> = []
    const layer = LoggerTest({ stderr: (chunk) => void lines.push(chunk) })
    const program = Effect.gen(function* () {
      const logger = yield* LoggerService
      logger.change("mutated")
      logger.verbose("no-op confirmation")
    })
    Effect.runSync(Effect.provide(program, layer))
    expect(lines).toEqual([
      "\x1b[1;32m[ok]\x1b[0m mutated\n",
      "\x1b[1;32m[ok]\x1b[0m no-op confirmation\n"
    ])
  })

  it("PlatformTest exposes the supported Linux and macOS capabilities", () => {
    const program = Effect.gen(function* () {
      const platform = yield* PlatformService
      return [platform.name(), platform.isLinux(), platform.shellRcApplicable()]
    })
    expect(Effect.runSync(Effect.provide(program, PlatformTest("linux")))).toEqual(["linux", true, true])
    expect(Effect.runSync(Effect.provide(program, PlatformTest("darwin")))).toEqual(["darwin", false, true])
  })

  it("combined graph: an injected platform drives the manager's install hints", () => {
    const linux = makeDependencyManager(makePlatform("linux"))
    expect(linux.spec("git").installHint()).toContain("apt")
    const mac = makeDependencyManager(makePlatform("darwin"))
    expect(mac.spec("git").installHint()).toBe("brew install git")
  })

  it("DependencyManager trusts the injected probe executor over the host PATH", () => {
    const manager = makeDependencyManager(makePlatform("linux"), {
      commandExists: () => false,
      capture: () => "host output must be ignored",
      which: () => "/host/tool"
    })
    expect(manager.probe("git")).toEqual({ state: "missing" })
  })

  it("DependencyManager deduplicates missing warnings per manager graph", () => {
    const lines: Array<string> = []
    const logger = makeEngineServices({ sinks: { stderr: (chunk) => void lines.push(chunk) } }).logger
    const missing = { commandExists: () => false, capture: () => "", which: () => "" }
    const first = makeDependencyManager(makePlatform("linux"), missing)
    const second = makeDependencyManager(makePlatform("linux"), missing)
    first.warnMissing("git", logger)
    first.warnMissing("git", logger)
    second.warnMissing("git", logger)
    expect(lines.filter((line) => line.includes("git not installed —"))).toHaveLength(2)
  })

  it("DependencyManagerTest: a stub manager drives missing-tool branching", () => {
    const warned: Array<string> = []
    const stub: DependencyManager = {
      spec: (id) => ({ id, requirement: "optional", versionArgs: ["--version"], installHint: () => `install ${id}` }),
      probe: () => ({ state: "missing" }),
      version: () => "",
      path: () => "",
      location: () => ({ path: "", binDir: "" }),
      latest: () => "",
      warnMissing: (id) => void warned.push(id)
    }
    const program = Effect.gen(function* () {
      const deps = yield* DependencyManagerService
      if (deps.probe("git").state === "missing") deps.warnMissing("git", makeEngineServices().logger)
      return deps.spec("git").installHint()
    })
    expect(Effect.runSync(Effect.provide(program, DependencyManagerTest(stub)))).toBe("install git")
    expect(warned).toEqual(["git"])
  })
})
