import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  lstatSync: vi.fn(),
  spawnSync: vi.fn(),
  symlinkSync: vi.fn()
}))

vi.mock("node:child_process", () => ({ spawnSync: mocks.spawnSync }))
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return { ...actual, lstatSync: mocks.lstatSync, symlinkSync: mocks.symlinkSync }
})

import { agentBrowserInstall, linkOrCopy } from "../../src/engine-native/skillsSync"
import { makeEngineServices, makePlatform } from "../../src/engine-native/services"

function servicesFor(platform: NodeJS.Platform) {
  return {
    ...makeEngineServices({
      sinks: { stderr: () => {}, stdout: () => {} }
    }),
    platform: makePlatform(platform)
  }
}

describe("skills platform injection", () => {
  beforeEach(() => {
    mocks.lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => true })
    mocks.symlinkSync.mockReset()
    mocks.spawnSync.mockReset().mockImplementation((cmd: string, args: Array<string>) => ({
      error: undefined,
      status: 0,
      stdout: cmd === "agent-browser" && args[0] === "--version" ? "agent-browser 0.31.1\n" : ""
    }))
  })

  it("uses the injected win32 symlink type", () => {
    expect(linkOrCopy("target", "link", makePlatform("win32"))).toBe(true)
    expect(mocks.symlinkSync).toHaveBeenCalledWith("target", "link", "dir")
  })

  it("adds --with-deps only for an injected Linux platform", () => {
    const installArgv = (platform: NodeJS.Platform): Array<string> | undefined => {
      mocks.spawnSync.mockClear()
      expect(agentBrowserInstall("install", "0.31.1", servicesFor(platform))).toBe(0)
      return mocks.spawnSync.mock.calls.find(([cmd, args]) => cmd === "agent-browser" && args[0] === "install")?.[1]
    }

    expect(installArgv("linux")).toEqual(["install", "--with-deps"])
    expect(installArgv("darwin")).toEqual(["install"])
  })
})
