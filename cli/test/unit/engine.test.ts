import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  runEngineNative: vi.fn(),
  spawnSync: vi.fn()
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
vi.mock("../../src/engine-native", () => ({ runEngineNative: mocks.runEngineNative }))

import { engine, engineCapture } from "../../src/engine"
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
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("unsupported host boundary", () => {
  it("rejects engine before EngineNative execution", async () => {
    await expect(Effect.runPromise(Effect.provide(engine(["status"]), EngineServicesLive))).rejects.toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(
      "unsupported host win32/x64; docks-kit supports only Linux and macOS on x64 or arm64"
    )

    expect(mocks.runEngineNative).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it("rejects engineCapture before spawning the Bun source fallback", async () => {
    await expect(Effect.runPromise(engineCapture(["models", "workflow"]))).rejects.toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(
      "unsupported host win32/x64; docks-kit supports only Linux and macOS on x64 or arm64"
    )

    expect(mocks.runEngineNative).not.toHaveBeenCalled()
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })

  it.each([
    ["freebsd", "arm64"],
    ["linux", "ia32"]
  ] as const)("rejects unsupported %s/%s hosts", async (platform, arch) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform)
    vi.spyOn(process, "arch", "get").mockReturnValue(arch)

    await expect(Effect.runPromise(engineCapture(["status"]))).rejects.toThrow("exit 2")
    expect(console.error).toHaveBeenCalledWith(
      `unsupported host ${platform}/${arch}; docks-kit supports only Linux and macOS on x64 or arm64`
    )
    expect(mocks.spawnSync).not.toHaveBeenCalled()
  })
})
