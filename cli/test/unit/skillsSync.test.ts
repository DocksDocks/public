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

import type { Ctx } from "../../src/engine-native"
import { agentBrowserInstall, effectSolutionsInstall, linkOrCopy } from "../../src/engine-native/skillsSync"
import { makeDependencyManager, makeEngineServices, makePlatform } from "../../src/engine-native/services"

function servicesFor(platform: NodeJS.Platform) {
  return {
    ...makeEngineServices({
      sinks: { stderr: () => {}, stdout: () => {} }
    }),
    platform: makePlatform(platform)
  }
}

describe("skills platform behavior", () => {
  beforeEach(() => {
    mocks.lstatSync.mockReset().mockReturnValue({ isSymbolicLink: () => true })
    mocks.symlinkSync.mockReset()
    mocks.spawnSync.mockReset().mockImplementation((cmd: string, args: Array<string>) => ({
      error: undefined,
      status: 0,
      stdout: cmd === "agent-browser" && args[0] === "--version" ? "agent-browser 0.32.0\n" : ""
    }))
  })

  it("uses a portable directory symlink", () => {
    expect(linkOrCopy("target", "link")).toBe(true)
    expect(mocks.symlinkSync).toHaveBeenCalledWith("target", "link")
  })

  it("adds --with-deps only for an injected Linux platform", () => {
    const installArgv = (platform: NodeJS.Platform): Array<string> | undefined => {
      mocks.spawnSync.mockClear()
      expect(agentBrowserInstall("install", "0.32.0", servicesFor(platform))).toBe(0)
      return mocks.spawnSync.mock.calls.find(([cmd, args]) => cmd === "agent-browser" && args[0] === "install")?.[1]
    }

    expect(installArgv("linux")).toEqual(["install", "--with-deps"])
    expect(installArgv("darwin")).toEqual(["install"])
  })

  it("retains the known Bun bin directory when effect-solutions has no executable", () => {
    const globalBin = "/bun/global/bin"
    const lines: Array<string> = []
    const platform = makePlatform("linux")
    const deps = makeDependencyManager(platform, {
      commandExists: () => false,
      capture: (cmd, args) => (cmd === "bun" && args.join(" ") === "pm -g bin" ? globalBin : ""),
      which: (name) => (name === "bun" ? "/usr/bin/bun" : "")
    })
    const services = {
      ...makeEngineServices({ sinks: { stderr: (chunk) => void lines.push(chunk), stdout: () => {} } }),
      deps,
      platform
    }
    const ctx = { home: "/fixture-home", services } as Ctx

    expect(effectSolutionsInstall(ctx)("install", "0.5.3", services)).toBe(0)
    expect(lines).toEqual([
      `\x1b[1;32m[ok]\x1b[0m Installing effect-solutions CLI via bun (pinned 0.5.3)...\n`,
      `\x1b[1;33m[warn]\x1b[0m effect-solutions installed but binary not found under '${globalBin}' — link it onto PATH manually\n`
    ])
  })
})
