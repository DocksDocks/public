import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as ExecModule from "../../src/engine-native/exec"

const mocks = vi.hoisted(() => ({
  rmSync: vi.fn(),
  spawnProcess: vi.fn(),
  tmpdir: vi.fn(() => "/tmp")
}))

vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, rmSync: mocks.rmSync }
})
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os")
  return { ...actual, tmpdir: mocks.tmpdir }
})

import { bunBootstrap, type BunRuntimeState } from "../../src/engine-native/bun"
import type { Ctx } from "../../src/engine-native"
import type { ProbeExecutor } from "../../src/engine-native/deps"
import { makeDependencyManager, makeEngineServices, makePlatform, type EngineServices } from "../../src/engine-native/services"

interface ProbeState {
  curl: boolean
  installed: boolean
  pathBun?: string
  bunVersion?: string
}

interface TestRig {
  readonly ctx: Ctx
  readonly lines: Array<string>
  readonly services: EngineServices
  readonly state: ProbeState
}

const originalHome = process.env["HOME"]
const originalBunInstall = process.env["BUN_INSTALL"]

function executor(state: ProbeState, home: string): ProbeExecutor {
  const fallback = `${home}/.bun/bin/bun`
  const customRoot = process.env["BUN_INSTALL"]
  const custom = customRoot === undefined || customRoot === ""
    ? fallback
    : `${customRoot}/bin/bun`
  return {
    commandExists: (name) => name === "curl" ? state.curl : false,
    capture: async (cmd, args) => {
      if ((cmd === custom || cmd === fallback || cmd === "bun") && args.join(" ") === "--version") {
        return state.bunVersion ?? "1.3.14"
      }
      return ""
    },
    which: (name) => {
      if (name === "bun") return state.pathBun ?? ""
      if (state.installed && (name === custom || name === fallback)) return name
      return ""
    }
  }
}

function rig(platformId: NodeJS.Platform, state: ProbeState, dryRun = false): TestRig {
  const home = "/home/test"
  process.env["HOME"] = home
  const platform = makePlatform(platformId)
  const lines: Array<string> = []
  const base = makeEngineServices({
    sinks: {
      stderr: (chunk) => void lines.push(chunk),
      stdout: (chunk) => void lines.push(chunk)
    }
  })
  const services: EngineServices = {
    logger: base.logger,
    deps: makeDependencyManager(platform, executor(state, home)),
    platform
  }
  const ctx: Ctx = {
    repoDir: "/repo",
    home,
    agentsDir: `${home}/.agents`,
    dryRun,
    verbose: false,
    skipBubblewrap: false,
    reconcile: false,
    prune: false,
    assumeYes: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    claudeEffort: "",
    claudeAdvisor: "",
    codexModel: "",
    codexEffort: "",
    syncConcurrency: 3,
    services,
    targetFilterSet: false,
    syncClaude: true,
    syncCodex: true,
    syncAgents: true,
    bunRuntime: undefined,
    nextStepTriggers: { claudePlugins: false, claudeRestart: false, codexRestart: false, skillsRestart: false }
  }
  return { ctx, lines, services, state }
}

function expectReady(state: BunRuntimeState): string {
  expect(state.kind).toBe("ready")
  if (state.kind !== "ready") throw new Error("expected ready Bun state")
  return state.executable
}

beforeEach(() => {
  mocks.rmSync.mockReset()
  mocks.spawnProcess.mockReset().mockResolvedValue({ error: undefined, exitCode: 0, stdout: "", stderr: "" })
  mocks.tmpdir.mockReset().mockReturnValue("/tmp")
  delete process.env["BUN_INSTALL"]
})

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"]
  else process.env["HOME"] = originalHome
  if (originalBunInstall === undefined) delete process.env["BUN_INSTALL"]
  else process.env["BUN_INSTALL"] = originalBunInstall
})

describe("per-run Bun bootstrap", () => {
  it("returns and memoizes an existing resolved executable", async () => {
    const test = rig("linux", { curl: true, installed: false, pathBun: "/usr/local/bin/bun" })
    expect(expectReady(await bunBootstrap(test.ctx, test.services))).toBe("/usr/local/bin/bun")
    expect(expectReady(await bunBootstrap(test.ctx, test.services))).toBe("/usr/local/bin/bun")
    expect(mocks.spawnProcess).not.toHaveBeenCalled()
  })

  it("shares one in-flight deferred result without duplicate warnings or attempts", async () => {
    const test = rig("linux", { curl: false, installed: false })
    const first = bunBootstrap(test.ctx, test.services)
    const second = bunBootstrap(test.ctx, test.services)
    expect(first).toBe(second)
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: "deferred", reason: "missing-curl" },
      { kind: "deferred", reason: "missing-curl" }
    ])
    expect(test.lines.join("")).toContain("curl not installed")
    expect(test.lines.join("").match(/curl not installed/g)).toHaveLength(1)
    expect(test.lines.join("")).toContain("cannot bootstrap Bun; install Bun manually, then re-run sync")
    expect(mocks.spawnProcess).not.toHaveBeenCalled()
  })

  it("predicts the pinned POSIX path in dry-run without spawning or removing", async () => {
    process.env["BUN_INSTALL"] = "/custom bun"
    const test = rig("linux", { curl: true, installed: false }, true)
    expect(expectReady(await bunBootstrap(test.ctx, test.services))).toBe("/custom bun/bin/bun")
    expect(test.lines.join("")).toContain("[dry-run] install Bun 1.3.14 (kit-verified) -> /custom bun/bin/bun")
    expect(mocks.spawnProcess).not.toHaveBeenCalled()
    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("defers a POSIX dry-run when curl cannot satisfy the planned bootstrap", async () => {
    const test = rig("linux", { curl: false, installed: false }, true)
    expect(await bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "missing-curl" })
    expect(test.lines.join("")).toContain("cannot bootstrap Bun; install Bun manually, then re-run sync")
    expect(test.lines.join("")).not.toContain("[dry-run] install Bun")
    expect(mocks.spawnProcess).not.toHaveBeenCalled()
    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("downloads then runs the pinned POSIX installer and always removes it", async () => {
    const test = rig("linux", { curl: true, installed: false })
    mocks.spawnProcess.mockImplementation(async (cmd: string) => {
      if (cmd === "bash") test.state.installed = true
      return { error: undefined, exitCode: 0, stdout: "", stderr: "" }
    })
    expect(expectReady(await bunBootstrap(test.ctx, test.services))).toBe("/home/test/.bun/bin/bun")
    expect(mocks.spawnProcess).toHaveBeenNthCalledWith(1, "curl", ["-fsSL", "https://bun.sh/install", "-o", expect.stringMatching(/bun-install-\d+\.sh$/)], { stdio: "ignore" })
    expect(mocks.spawnProcess).toHaveBeenNthCalledWith(2, "bash", [expect.stringMatching(/bun-install-\d+\.sh$/), "bun-v1.3.14"], { stdio: "ignore" })
    expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/bun-install-\d+\.sh$/), { force: true })
  })


  it("returns install-failed after a successful download that produces no Bun", async () => {
    const test = rig("linux", { curl: true, installed: false })
    expect(await bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "install-failed" })
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    expect(test.lines.join("")).toContain("Bun install failed")
  })
})
