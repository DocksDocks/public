import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const bun = { isStandaloneExecutable: false }
  Object.defineProperty(globalThis, "Bun", { configurable: true, value: bun })
  return {
    bun,
    runEngineNative: vi.fn(),
    spawnSync: vi.fn()
  }
})

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
vi.mock("../../src/engine-native", () => ({ runEngineNative: mocks.runEngineNative }))

import { EngineCaptureError, engine, engineCapture } from "../../src/engine"
import { EngineServicesLive } from "../../src/services"

beforeEach(() => {
  mocks.runEngineNative.mockReset()
  mocks.spawnSync.mockReset()
  vi.spyOn(process, "platform", "get").mockReturnValue("win32")
  vi.spyOn(process, "arch", "get").mockReturnValue("x64")
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`exit ${String(code)}`)
  })
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(process.stderr, "write").mockImplementation(() => true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("compiled runtime detection", () => {
  it("uses Bun's standalone-executable predicate", async () => {
    mocks.bun.isStandaloneExecutable = true
    try {
      vi.resetModules()
      // Re-evaluate the module after changing the runtime predicate; a static import runs before test setup.
      const { compiled } = await import("../../src/engine")

      expect(compiled).toBe(true)
    } finally {
      mocks.bun.isStandaloneExecutable = false
    }
  })
})

describe("supported host boundary", () => {
  it.each(["x64", "arm64"] as const)("admits win32/%s to EngineNative", async (arch) => {
    vi.spyOn(process, "arch", "get").mockReturnValue(arch)
    mocks.runEngineNative.mockResolvedValue(0)

    await expect(Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive))).resolves.toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
    expect(mocks.runEngineNative).toHaveBeenCalledWith(
      ["status"],
      expect.objectContaining({
        deps: expect.any(Object),
        logger: expect.any(Object),
        platform: expect.any(Object)
      })
    )
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })
})

describe("unsupported host boundary", () => {
  it.each([
    ["freebsd", "arm64"],
    ["linux", "ia32"],
    ["win32", "ia32"]
  ] as const)("rejects unsupported %s/%s hosts", async (platform, arch) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform)
    vi.spyOn(process, "arch", "get").mockReturnValue(arch)

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(
      `unsupported host ${platform}/${arch}; docks-kit supports only Linux, macOS, and Windows on x64 or arm64`
    )
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })
})

describe("EngineNative Effect seam", () => {
  beforeEach(() => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux")
    vi.spyOn(process, "arch", "get").mockReturnValue("x64")
  })

  it("completes successfully when EngineNative resolves zero", async () => {
    mocks.runEngineNative.mockResolvedValue(0)

    await expect(Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive))).resolves.toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
  })

  it("exits with the EngineNative non-zero code", async () => {
    mocks.runEngineNative.mockResolvedValue(3)

    await expect(Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive))).rejects.toThrow("exit 3")
  })

  it("maps a rejected EngineNative Promise to a user-facing CLI failure", async () => {
    mocks.runEngineNative.mockRejectedValue(new Error("native engine failed"))

    await expect(Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive))).rejects.toMatchObject({
      _tag: "UserError",
      message: "engine operation 'status' failed: native engine failed"
    })
  })

  it("fails capture with the child status instead of returning plausible stdout", async () => {
    const diagnostic = "engine capture failed for 'toolchain check --json': exit 7"
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "{\"toolchain\":[]}\n", null],
      pid: 123,
      signal: null,
      status: 7,
      stderr: null,
      stdout: "{\"toolchain\":[]}\n"
    })

    await expect(Effect.runPromise(engineCapture(["toolchain", "check", "--json"]))).rejects.toMatchObject({
      name: "EngineCaptureError",
      code: 7,
      diagnostic
    } satisfies Partial<EngineCaptureError>)
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(diagnostic))
  })

  it("includes the spawn error message in capture diagnostics", async () => {
    mocks.spawnSync.mockReturnValue({
      error: new Error("spawn docks-kit ENOENT"),
      output: [null, "", null],
      pid: 0,
      signal: null,
      status: null,
      stderr: null,
      stdout: ""
    })

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toMatchObject({
      code: 1,
      diagnostic: expect.stringContaining("spawn error: spawn docks-kit ENOENT")
    })
  })

  it("includes the terminating signal in capture diagnostics", async () => {
    mocks.spawnSync.mockReturnValue({
      error: undefined,
      output: [null, "", null],
      pid: 123,
      signal: "SIGTERM",
      status: null,
      stderr: null,
      stdout: ""
    })

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toMatchObject({
      code: 1,
      diagnostic: expect.stringContaining("signal SIGTERM")
    })
  })
})
