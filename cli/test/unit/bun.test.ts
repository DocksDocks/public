import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type * as FsModule from "node:fs"
import type * as OsModule from "node:os"
import type * as ExecModule from "../../src/engine-native/exec"

const mocks = vi.hoisted(() => ({
  mkdtempSync: vi.fn((_prefix: string) => "/tmp/docks-kit-bun-private"),
  rmSync: vi.fn(),
  spawnProcess: vi.fn(),
  tmpdir: vi.fn(() => "/tmp")
}))

vi.mock("../../src/engine-native/exec", async () => {
  const actual = await vi.importActual<typeof ExecModule>("../../src/engine-native/exec")
  return { ...actual, spawnProcess: mocks.spawnProcess }
})
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof FsModule>("node:fs")
  return { ...actual, mkdtempSync: mocks.mkdtempSync, rmSync: mocks.rmSync }
})
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof OsModule>("node:os")
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
  mocks.mkdtempSync.mockReset().mockReturnValue("/tmp/docks-kit-bun-private")
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

  it("uses a fresh private directory and never follows the predictable shared-temp symlink", async () => {
    const fs = await vi.importActual<typeof FsModule>("node:fs")
    const testRoot = fs.mkdtempSync("/tmp/docks-kit-bun-security-")
    const sentinel = `${testRoot}/sentinel`
    const predictableSymlink = `${testRoot}/bun-install-${process.pid}.sh`
    fs.writeFileSync(sentinel, "unchanged")
    fs.symlinkSync(sentinel, predictableSymlink)
    mocks.tmpdir.mockReturnValue(testRoot)
    mocks.mkdtempSync.mockImplementation((prefix: string) => fs.mkdtempSync(prefix))
    const test = rig("linux", { curl: true, installed: false })
    let downloadedTo = ""
    let executed = ""
    mocks.spawnProcess.mockImplementation(async (cmd: string, args: ReadonlyArray<string>) => {
      if (cmd === "curl") {
        const flag = args.indexOf("-o")
        const target = flag === -1 ? undefined : args[flag + 1]
        // Never write outside this test's own temporary root. Reading the
        // operand positionally let an argument change send the write to the
        // relative path "undefined", which created a junk file in the
        // repository root.
        if (target === undefined || !target.startsWith(`${testRoot}/`)) {
          throw new Error(`curl stub expected an -o target under ${testRoot}, received ${String(target)}`)
        }
        downloadedTo = target
        fs.writeFileSync(downloadedTo, "installer")
      }
      if (cmd === "bash") {
        executed = String(args[0])
        test.state.installed = true
      }
      return { error: undefined, exitCode: 0, stdout: "", stderr: "" }
    })

    try {
      expect(expectReady(await bunBootstrap(test.ctx, test.services))).toBe("/home/test/.bun/bin/bun")
      expect(mocks.mkdtempSync).toHaveBeenCalledWith(`${testRoot}/docks-kit-bun-`)
      expect(downloadedTo).toMatch(new RegExp(`^${testRoot}/docks-kit-bun-[^/]+/install\\.sh$`))
      expect(executed).toBe(downloadedTo)
      expect(downloadedTo).not.toBe(predictableSymlink)
      expect(fs.readFileSync(sentinel, "utf8")).toBe("unchanged")
      expect(mocks.rmSync).toHaveBeenCalledWith(downloadedTo.replace(/\/install\.sh$/, ""), {
        recursive: true,
        force: true
      })
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it("reports transport diagnostics when the Bun installer download fails", async () => {
    const test = rig("linux", { curl: true, installed: false })
    mocks.spawnProcess.mockResolvedValueOnce({
      error: undefined,
      exitCode: 22,
      stdout: "",
      stderr: "curl: (22) server returned 503"
    })

    expect(await bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "download-failed" })
    expect(mocks.spawnProcess).toHaveBeenCalledTimes(1)
    expect(test.lines.join("")).toContain("Bun installer download failed (curl: (22) server returned 503)")
  })

  it("reports installer diagnostics when Bash rejects the downloaded installer", async () => {
    const test = rig("linux", { curl: true, installed: false })
    mocks.spawnProcess
      .mockResolvedValueOnce({ error: undefined, exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ error: undefined, exitCode: 2, stdout: "", stderr: "install: unsupported platform" })

    expect(await bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "installer-failed" })
    expect(test.lines.join("")).toContain("Bun installer failed (install: unsupported platform)")
  })


  it("returns install-failed after a successful download that produces no Bun", async () => {
    const test = rig("linux", { curl: true, installed: false })
    expect(await bunBootstrap(test.ctx, test.services)).toEqual({ kind: "deferred", reason: "install-failed" })
    expect(mocks.rmSync).toHaveBeenCalledTimes(1)
    expect(test.lines.join("")).toContain("Bun install failed")
  })
})
