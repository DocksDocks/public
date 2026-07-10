import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rmSync: vi.fn(),
  spawnSync: vi.fn(),
  tmpdir: vi.fn(() => "/tmp")
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
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
import { decodePowerShellCommand } from "../../src/engine-native/powershell"

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

function executor(state: ProbeState, platform: NodeJS.Platform, home: string): ProbeExecutor {
  const fallback = platform === "win32" ? `${home}/.bun/bin/bun.exe` : `${home}/.bun/bin/bun`
  const customRoot = process.env["BUN_INSTALL"]
  const custom = customRoot === undefined || customRoot === ""
    ? fallback
    : `${customRoot}/bin/${platform === "win32" ? "bun.exe" : "bun"}`
  return {
    commandExists: (name) => name === "curl" ? state.curl : false,
    capture: (cmd, args) => {
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
  const home = platformId === "win32" ? "C:/Users/First Last" : "/home/test"
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
    deps: makeDependencyManager(platform, executor(state, platformId, home)),
    platform
  }
  const ctx: Ctx = {
    repoDir: "/repo",
    home,
    agentsDir: `${home}/.agents`,
    dryRun,
    verbose: false,
    skipRtk: false,
    reconcile: false,
    prune: false,
    assumeYes: false,
    claudeCompactWindow: "",
    claudePermissive: false,
    claudePlugins: [],
    claudeModel: "",
    codexModel: "",
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
  mocks.spawnSync.mockReset().mockReturnValue({ error: undefined, status: 0 })
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
  it("returns and memoizes an existing resolved executable", () => {
    const test = rig("linux", { curl: true, installed: false, pathBun: "/usr/local/bin/bun" })
    expect(expectReady(bunBootstrap(test.ctx, test.services))).toBe("/usr/local/bin/bun")
    expect(expectReady(bunBootstrap(test.ctx, test.services))).toBe("/usr/local/bin/bun")
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("memoizes a deferred result without duplicate warnings or attempts", () => {
    const test = rig("linux", { curl: false, installed: false })
    expect(bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "missing-curl" })
    expect(bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "missing-curl" })
    expect(test.lines.join("")).toContain("curl not installed")
    expect(test.lines.join("").match(/curl not installed/g)).toHaveLength(1)
    expect(test.lines.join("")).toContain("cannot bootstrap Bun; install Bun manually, then re-run sync")
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("predicts the pinned POSIX path in dry-run without spawning or removing", () => {
    process.env["BUN_INSTALL"] = "/custom bun"
    const test = rig("linux", { curl: true, installed: false }, true)
    expect(expectReady(bunBootstrap(test.ctx, test.services))).toBe("/custom bun/bin/bun")
    expect(test.lines.join("")).toContain("[dry-run] install Bun 1.3.14 (kit-verified) -> /custom bun/bin/bun")
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("defers a POSIX dry-run when curl cannot satisfy the planned bootstrap", () => {
    const test = rig("linux", { curl: false, installed: false }, true)
    expect(bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "missing-curl" })
    expect(test.lines.join("")).toContain("cannot bootstrap Bun; install Bun manually, then re-run sync")
    expect(test.lines.join("")).not.toContain("[dry-run] install Bun")
    expect(mocks.spawnSync).not.toHaveBeenCalled()
    expect(mocks.rmSync).not.toHaveBeenCalled()
  })

  it("downloads then runs the pinned POSIX installer and always removes it", () => {
    const test = rig("linux", { curl: true, installed: false })
    mocks.spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "bash") test.state.installed = true
      return { error: undefined, status: 0 }
    })
    expect(expectReady(bunBootstrap(test.ctx, test.services))).toBe("/home/test/.bun/bin/bun")
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(1, "curl", ["-fsSL", "https://bun.sh/install", "-o", expect.stringMatching(/bun-install-\d+\.sh$/)], { stdio: "ignore" })
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(2, "bash", [expect.stringMatching(/bun-install-\d+\.sh$/), "bun-v1.3.14"], { stdio: "ignore" })
    expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/bun-install-\d+\.sh$/), { force: true })
  })

  it("downloads and runs the Windows installer without curl", () => {
    process.env["BUN_INSTALL"] = "C:/Users/O'Brien Bun"
    mocks.tmpdir.mockReturnValue("C:/Temp/O'Brien Folder")
    const test = rig("win32", { curl: false, installed: false })
    mocks.spawnSync.mockImplementation((cmd: string, args: Array<string>) => {
      if (cmd === "powershell.exe" && args.includes("-File")) test.state.installed = true
      return { error: undefined, status: 0 }
    })

    expect(expectReady(bunBootstrap(test.ctx, test.services))).toBe("C:/Users/O'Brien Bun/bin/bun.exe")
    const downloadArgs = mocks.spawnSync.mock.calls[0]?.[1]
    expect(downloadArgs?.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-EncodedCommand"])
    const download = decodePowerShellCommand(downloadArgs?.[3] ?? "")
    expect(download).toContain("Invoke-WebRequest -Uri 'https://bun.sh/install.ps1'")
    expect(download).toContain("-OutFile 'C:/Temp/O''Brien Folder/")
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(2, "powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      expect.stringContaining("O'Brien Folder/bun-install-"),
      "-Version",
      "1.3.14",
      "-DownloadWithoutCurl"
    ], { stdio: "ignore" })
    expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(/bun-install-\d+\.ps1$/), { force: true })
    expect(test.lines.join("")).not.toContain("curl not installed")
  })

  it("returns install-failed after a successful download that produces no Bun", () => {
    const test = rig("linux", { curl: true, installed: false })
    expect(bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "install-failed" })
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    expect(test.lines.join("")).toContain("Bun install failed")
  })
})
